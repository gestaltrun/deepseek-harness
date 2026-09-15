/** Strict Wangwang OpenAPI parsing and request classification. */
import { z } from 'zod'
import { signWangwangRequest } from './auth.ts'

/** Per-operation secret values read from the credential record. */
export interface WangwangCredentials {
  readonly accessKeyId: string
  readonly accessKeySecret: string
}

/** Stable failure reported without upstream response text. */
export class WangwangProtocolError extends Error {
  /** @param code - stable local code. @param message - safe diagnostic. @param facts - provider response facts. */
  constructor(
    readonly code: string,
    message: string,
    readonly facts: {
      readonly httpStatus?: number
      readonly ambiguous?: boolean
      readonly authorization?: 'expired' | 'revoked'
    } = {},
  ) {
    super(message)
    this.name = 'WangwangProtocolError'
  }
}

/** Sender claim preserved from the provider wire response. */
export type WangwangSenderClaim = 1 | 2 | 3 | 'unknown'

/** Strict normalized event from one merchant feed. */
export interface WangwangEvent {
  readonly eventId: string
  readonly merchantId: string
  readonly messageId: string
  readonly customerId: string
  readonly customerNick?: string
  readonly conversationId: string
  readonly sender: { readonly kind: 'external-actor'; readonly senderId: string; readonly senderDisplayName?: string }
    | { readonly kind: 'configured-native' }
    | { readonly kind: 'configured-echo'; readonly externalMessageId: string; readonly observedSenderId?: string }
    | { readonly kind: 'provider-unknown'; readonly observedSenderId?: string }
  readonly text: string
  readonly format: 'text' | 'markdown'
  readonly occurredAt: string
}

/** One provider feed page. */
export interface WangwangEventPage {
  readonly events: readonly WangwangEvent[]
  readonly nextCursor: number
  readonly hasMore: boolean
}

const nonempty = z.string().min(1)
const wireEventSchema = z.object({
  eventId: nonempty,
  merchantId: nonempty,
  senderType: z.unknown(),
  messageId: nonempty,
  customerId: nonempty,
  customerNick: z.string().min(1).optional(),
  conversationId: nonempty,
  msgType: z.unknown(),
  textContent: z.string().optional(),
  content: z.string().optional(),
  msgTime: z.number().int().nonnegative(),
})

const responseSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  success: z.boolean().optional(),
  status: z.string().optional(),
  data: z.unknown().optional(),
})

function responseSucceeded(body: z.infer<typeof responseSchema>): boolean {
  return body.code === 0 || body.code === '0' || body.success === true || body.status === 'success'
}

function providerCode(body: z.infer<typeof responseSchema>): string {
  return body.code === undefined ? 'WANGWANG_PROVIDER_REJECTED' : `WANGWANG_PROVIDER_${String(body.code)}`
}

function authorization(code: unknown): 'expired' | 'revoked' | undefined {
  if (code === 'TOKEN_EXPIRED' || code === 'CREDENTIAL_EXPIRED') return 'expired'
  if (code === 'TOKEN_REVOKED' || code === 'CREDENTIAL_REVOKED') return 'revoked'
  return undefined
}

function senderClaim(value: unknown): WangwangSenderClaim {
  return value === 1 || value === 2 || value === 3 ? value : 'unknown'
}

function parseEvent(value: unknown, merchantId: string): WangwangEvent {
  const parsed = wireEventSchema.safeParse(value)
  if (!parsed.success) throw new WangwangProtocolError('WANGWANG_EVENT_INVALID', 'Wangwang event fields are invalid')
  const event = parsed.data
  if (event.merchantId !== merchantId) {
    throw new WangwangProtocolError('WANGWANG_MERCHANT_MISMATCH', 'Wangwang event belongs to another merchant')
  }
  const text = event.textContent ?? event.content
  if (text === undefined) throw new WangwangProtocolError('WANGWANG_EVENT_INVALID', 'Wangwang text content is missing')
  const format = event.msgType === 1 ? 'text' : event.msgType === 2 ? 'markdown' : undefined
  if (format === undefined) throw new WangwangProtocolError('WANGWANG_EVENT_INVALID', 'Wangwang message type is unsupported')
  const claim = senderClaim(event.senderType)
  const sender: WangwangEvent['sender'] = claim === 1
    ? { kind: 'external-actor', senderId: event.customerId, ...(event.customerNick === undefined ? {} : { senderDisplayName: event.customerNick }) }
    : claim === 2
      ? { kind: 'configured-native' }
      : claim === 3
        ? { kind: 'configured-echo', externalMessageId: event.messageId }
        : { kind: 'provider-unknown', observedSenderId: event.customerId }
  return {
    eventId: event.eventId,
    merchantId: event.merchantId,
    messageId: event.messageId,
    customerId: event.customerId,
    ...(event.customerNick === undefined ? {} : { customerNick: event.customerNick }),
    conversationId: event.conversationId,
    sender,
    text,
    format,
    occurredAt: new Date(event.msgTime).toISOString(),
  }
}

/** Wangwang send or confirmation result at the protocol layer. */
export type WangwangReceipt =
  | { readonly state: 'sent'; readonly messageId: string; readonly rawStatus?: string }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'unknown'; readonly messageId?: string }

function receiptStatus(receipt: {
  readonly status?: string | undefined
  readonly producerId?: string | undefined
  readonly producerRevision?: string | undefined
}): string | undefined {
  if (receipt.producerId === undefined && receipt.producerRevision === undefined) return receipt.status
  return JSON.stringify({
    ...(receipt.status === undefined ? {} : { status: receipt.status }),
    ...(receipt.producerId === undefined ? {} : { producerId: receipt.producerId }),
    ...(receipt.producerRevision === undefined ? {} : { producerRevision: receipt.producerRevision }),
  })
}

/** Fetch client whose calls take credentials and cancellation per operation. */
export class WangwangProtocolClient {
  private readonly endpoint: string
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number

  /** @param options - admitted endpoint and injectable process dependencies. */
  constructor(options: { readonly endpoint: string; readonly fetch?: typeof globalThis.fetch; readonly now?: () => number }) {
    this.endpoint = options.endpoint.replace(/\/+$/u, '')
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  private async request(input: {
    readonly method: 'GET' | 'POST'
    readonly path: string
    readonly credentials: WangwangCredentials
    readonly query?: Readonly<Record<string, string | number | undefined>>
    readonly requestId?: string
    readonly body?: unknown
    readonly signal?: AbortSignal
    readonly send?: boolean
  }): Promise<z.infer<typeof responseSchema>> {
    const signed = signWangwangRequest({
      method: input.method,
      path: input.path,
      timestamp: this.now(),
      accessKeyId: input.credentials.accessKeyId,
      accessKeySecret: input.credentials.accessKeySecret,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    })
    const url = `${this.endpoint}${input.path}${signed.query === '' ? '' : `?${signed.query}`}`
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: input.method,
        headers: {
          Accept: 'application/json',
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json;charset=utf-8' }),
          ...signed.headers,
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
    } catch (error) {
      if (input.signal?.aborted === true) throw error
      throw new WangwangProtocolError(
        input.send === true ? 'WANGWANG_SEND_RESULT_UNKNOWN' : 'WANGWANG_NETWORK_ERROR',
        input.send === true ? 'Wangwang send result is unknown' : 'Wangwang request failed before a response',
        input.send === true ? { ambiguous: true } : {},
      )
    }
    if (!response.ok) {
      throw new WangwangProtocolError(
        input.send === true && (response.status === 408 || response.status === 429 || response.status >= 500)
          ? 'WANGWANG_SEND_RESULT_UNKNOWN'
          : `WANGWANG_HTTP_${String(response.status)}`,
        `Wangwang request failed with HTTP ${String(response.status)}`,
        { httpStatus: response.status, ...(input.send === true && (response.status === 408 || response.status === 429 || response.status >= 500) ? { ambiguous: true } : {}) },
      )
    }
    let unknown: unknown
    try {
      unknown = await response.json()
    } catch {
      throw new WangwangProtocolError(input.send === true ? 'WANGWANG_SEND_RESULT_UNKNOWN' : 'WANGWANG_RESPONSE_INVALID', input.send === true ? 'Wangwang send result is unknown' : 'Wangwang response is not JSON', input.send === true ? { ambiguous: true } : {})
    }
    const body = responseSchema.safeParse(unknown)
    if (!body.success) throw new WangwangProtocolError(input.send === true ? 'WANGWANG_SEND_RESULT_UNKNOWN' : 'WANGWANG_RESPONSE_INVALID', input.send === true ? 'Wangwang send result is unknown' : 'Wangwang response fields are invalid', input.send === true ? { ambiguous: true } : {})
    if (!responseSucceeded(body.data)) {
      const code = providerCode(body.data)
      const authorizationFact = authorization(body.data.code)
      throw new WangwangProtocolError(code, 'Wangwang provider rejected the request', authorizationFact === undefined ? {} : { authorization: authorizationFact })
    }
    return body.data
  }

  /**
   * Pull one admitted merchant feed page.
   * @param request - feed identity, current cursor, limits, credentials, and cancellation.
   * @returns a strictly parsed provider page.
   */
  async pullEvents(request: {
    readonly merchantId: string
    readonly credentials: WangwangCredentials
    readonly cursor: number
    readonly limit: number
    readonly waitSeconds: number
    readonly signal?: AbortSignal
  }): Promise<WangwangEventPage> {
    const body = await this.request({
      method: 'GET', path: '/openapi/wangwang/events', credentials: request.credentials,
      query: { merchantId: request.merchantId, sinceId: request.cursor, limit: request.limit, waitSeconds: request.waitSeconds },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const data = z.object({ events: z.array(z.unknown()), nextSinceId: z.number().int().nonnegative(), hasMore: z.boolean() }).safeParse(body.data ?? body)
    if (!data.success) throw new WangwangProtocolError('WANGWANG_PAGE_INVALID', 'Wangwang event page fields are invalid')
    if (data.data.nextSinceId < request.cursor) throw new WangwangProtocolError('WANGWANG_CURSOR_REGRESSION', 'Wangwang event cursor moved backwards')
    return {
      events: data.data.events.map(event => parseEvent(event, request.merchantId)),
      nextCursor: data.data.nextSinceId,
      hasMore: data.data.hasMore,
    }
  }

  /**
   * Send one text message using the caller's stable request id.
   * @param request - admitted merchant, target, content, credentials, and cancellation.
   * @returns a confirmed receipt or an explicit uncertain result.
   */
  async sendMessage(request: {
    readonly merchantId: string
    readonly customerId: string
    readonly userId: string
    readonly text: string
    readonly requestId: string
    readonly credentials: WangwangCredentials
    readonly signal?: AbortSignal
  }): Promise<WangwangReceipt> {
    let body: z.infer<typeof responseSchema>
    try {
      body = await this.request({
        method: 'POST', path: '/openapi/wangwang/messages', credentials: request.credentials,
        requestId: request.requestId, body: { merchantId: request.merchantId, customerId: request.customerId, content: request.text, userId: request.userId }, send: true,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      if (error instanceof WangwangProtocolError && error.facts.ambiguous === true) return { state: 'unknown' }
      if (error instanceof WangwangProtocolError) return { state: 'failed', code: error.code }
      throw error
    }
    const data = z.object({
      messageId: z.string().min(1).optional(),
      status: z.string().optional(),
      producerId: z.string().min(1).optional(),
      producerRevision: z.string().min(1).optional(),
    }).safeParse(body.data ?? body)
    if (!data.success || data.data.messageId === undefined) return { state: 'unknown' }
    const rawStatus = receiptStatus(data.data)
    return { state: 'sent', messageId: data.data.messageId, ...(rawStatus === undefined ? {} : { rawStatus }) }
  }

  /**
   * Query provider receipt evidence for one uncertain send.
   * @param request - admitted merchant, stable request identity, optional message id, credentials, and cancellation.
   * @returns only provider-confirmed sent or failed facts; all other results remain unknown.
   */
  async confirmMessage(request: {
    readonly merchantId: string
    readonly requestId: string
    readonly messageId?: string
    readonly credentials: WangwangCredentials
    readonly signal?: AbortSignal
  }): Promise<WangwangReceipt> {
    let body: z.infer<typeof responseSchema>
    try {
      body = await this.request({
        method: 'GET', path: '/openapi/wangwang/messages/status', credentials: request.credentials,
        query: { merchantId: request.merchantId, requestId: request.requestId, messageId: request.messageId },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      if (request.signal?.aborted === true) throw error
      return { state: 'unknown', ...(request.messageId === undefined ? {} : { messageId: request.messageId }) }
    }
    const data = z.object({ state: z.string(), messageId: z.string().min(1).optional(), code: z.string().optional() }).safeParse(body.data ?? body)
    if (!data.success) return { state: 'unknown', ...(request.messageId === undefined ? {} : { messageId: request.messageId }) }
    if (data.data.state === 'sent' && data.data.messageId !== undefined) return { state: 'sent', messageId: data.data.messageId, rawStatus: 'sent' }
    if (data.data.state === 'failed' && data.data.code !== undefined) return { state: 'failed', code: data.data.code }
    return { state: 'unknown', ...(data.data.messageId ?? request.messageId) === undefined ? {} : { messageId: data.data.messageId ?? request.messageId } }
  }
}
