/** Product Wangwang transport backed by an admitted merchant OpenAPI endpoint. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ImAccountAuthorization,
  ImAccountView,
  ImDeliveryOperationId,
  ImInboundSenderEvidence,
  ImPreparedAccount,
  ImTransportAccountInspection,
  ImTransport,
  ImTransportConfirmRequest,
  ImTransportConversationPage,
  ImTransportInboundMessage,
  ImTransportInboundPage,
  ImTransportInboundPageReceipt,
  ImTransportSendRequest,
  ImTransportSendResult,
  ImTransportListenPlan,
  ImTransportSink,
} from '@gestaltrun/dsh-im-runtime'
import { z } from 'zod'
import { resolveWangwangTransportConfig } from './config.ts'
import type { ResolvedWangwangTransportConfig, WangwangAdmittedMerchant, WangwangTransportConfig } from './config.ts'
import { WangwangProtocolClient, WangwangProtocolError } from './protocol.ts'
import type { WangwangCredentials, WangwangEvent, WangwangEventPage, WangwangReceipt } from './protocol.ts'

const credentialPayloadSchema = z.object({
  version: z.literal(1),
  candidateId: z.string().min(1),
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
}).strict()

interface ActiveListener {
  readonly abort: AbortController
  readonly done: Promise<void>
}

function cursor(value: string | undefined): number {
  if (value === undefined) return 0
  if (!/^\d+$/u.test(value)) throw new WangwangProtocolError('WANGWANG_CURSOR_INVALID', 'Wangwang cursor is not a non-negative integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new WangwangProtocolError('WANGWANG_CURSOR_INVALID', 'Wangwang cursor exceeds the safe integer range')
  return parsed
}

function operationId(parts: readonly unknown[]): ImDeliveryOperationId {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return brandString<ImDeliveryOperationId>(`wangwang-${digest}`)
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, milliseconds)
    const aborted = (): void => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason) }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

function safeAuthorization(error: unknown, checkedAt: string): ImAccountAuthorization {
  if (error instanceof WangwangProtocolError && error.facts.authorization !== undefined) {
    return { state: 'required', reason: error.facts.authorization, checkedAt }
  }
  const code = error instanceof WangwangProtocolError ? error.code : 'WANGWANG_AUTHORIZATION_CHECK_FAILED'
  return { state: 'failed', code, message: 'Wangwang authorization check failed', checkedAt }
}

function transportResult(receipt: WangwangReceipt): ImTransportSendResult {
  if (receipt.state === 'sent') return { state: 'sent', externalMessageId: receipt.messageId, ...(receipt.rawStatus === undefined ? {} : { rawStatus: receipt.rawStatus }) }
  if (receipt.state === 'failed') return { state: 'failed', code: receipt.code, message: 'Wangwang provider rejected the message' }
  return { state: 'unknown', ...(receipt.messageId === undefined ? {} : { externalMessageId: receipt.messageId }) }
}

function receivesConversation(plan: ImTransportListenPlan, conversationId: string): boolean {
  return plan.routes.some(route => route.conversationKind === 'direct'
    && (route.target.kind === 'all' || route.target.conversationId === conversationId))
}

/** Complete Wangwang platform transport registered with the product runtime. */
export class WangwangTransport implements ImTransport {
  readonly platform = 'wangwang' as const
  private readonly config: ResolvedWangwangTransportConfig
  private readonly candidatesById = new Map<string, WangwangAdmittedMerchant>()
  private readonly candidatesByMerchantId = new Map<string, WangwangAdmittedMerchant>()
  private readonly clients = new Map<string, WangwangProtocolClient>()
  private readonly listeners = new Map<string, ActiveListener>()
  private readonly fetch: typeof globalThis.fetch | undefined
  private readonly now: () => number

  /** @param ctx - Cordis context with Credentials. @param config - admitted merchant catalog. @param dependencies - process adapters used by owner-local tests. */
  constructor(
    private readonly ctx: Context,
    config: WangwangTransportConfig,
    dependencies: { readonly fetch?: typeof globalThis.fetch; readonly now?: () => number } = {},
  ) {
    this.config = resolveWangwangTransportConfig(config)
    this.fetch = dependencies.fetch
    this.now = dependencies.now ?? Date.now
    for (const candidate of this.config.admittedMerchants) {
      this.candidatesById.set(candidate.candidateId, candidate)
      this.candidatesByMerchantId.set(candidate.merchantId, candidate)
    }
  }

  private client(candidate: WangwangAdmittedMerchant): WangwangProtocolClient {
    let client = this.clients.get(candidate.candidateId)
    if (client === undefined) {
      client = new WangwangProtocolClient({ endpoint: candidate.endpoint, ...(this.fetch === undefined ? {} : { fetch: this.fetch }), now: this.now })
      this.clients.set(candidate.candidateId, client)
    }
    return client
  }

  private candidateById(candidateId: string): WangwangAdmittedMerchant {
    const candidate = this.candidatesById.get(candidateId)
    if (candidate === undefined) throw new WangwangProtocolError('WANGWANG_MERCHANT_NOT_ADMITTED', 'Wangwang merchant is not in the admitted catalog')
    return candidate
  }

  private candidateForAccount(account: ImAccountView): WangwangAdmittedMerchant {
    if (account.platform !== 'wangwang' || account.identity.platform !== 'wangwang') {
      throw new WangwangProtocolError('WANGWANG_ACCOUNT_INVALID', 'Wangwang transport received another platform account')
    }
    const candidate = this.candidatesByMerchantId.get(account.identity.merchantId)
    if (candidate === undefined) throw new WangwangProtocolError('WANGWANG_MERCHANT_NOT_ADMITTED', 'Wangwang merchant is not in the admitted catalog')
    return candidate
  }

  private async credentials(account: ImAccountView, candidate: WangwangAdmittedMerchant): Promise<WangwangCredentials> {
    if (account.credentialKey === undefined) throw new WangwangProtocolError('WANGWANG_CREDENTIAL_MISSING', 'Wangwang credential record is missing')
    const record = await this.ctx.credentials.readRecord(account.credentialKey)
    if (record?.kind !== 'grant') throw new WangwangProtocolError('WANGWANG_CREDENTIAL_MISSING', 'Wangwang credential record is missing')
    const payload = credentialPayloadSchema.safeParse(record.payload)
    if (!payload.success || payload.data.candidateId !== candidate.candidateId) {
      throw new WangwangProtocolError('WANGWANG_CREDENTIAL_INVALID', 'Wangwang credential record does not match the admitted merchant')
    }
    return { accessKeyId: payload.data.accessKeyId, accessKeySecret: payload.data.accessKeySecret }
  }

  private async inspect(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection> {
    const candidate = this.candidateForAccount(account)
    const checkedAt = new Date(this.now()).toISOString()
    let credentials: WangwangCredentials
    try {
      credentials = await this.credentials(account, candidate)
    } catch (error) {
      if (error instanceof WangwangProtocolError && error.code === 'WANGWANG_CREDENTIAL_MISSING') {
        return { authorization: { state: 'required', reason: 'missing', checkedAt } }
      }
      return { authorization: safeAuthorization(error, checkedAt) }
    }
    try {
      await this.client(candidate).pullEvents({ merchantId: candidate.merchantId, credentials, cursor: 0, limit: 1, waitSeconds: 0, signal })
      return { authorization: { state: 'ready', checkedAt } }
    } catch (error) {
      if (signal.aborted) throw error
      return { authorization: safeAuthorization(error, checkedAt) }
    }
  }

  /** @inheritdoc */
  listAccountCandidates(_signal: AbortSignal): Promise<readonly import('@gestaltrun/dsh-im-runtime').ImAccountCandidate[]> {
    return Promise.resolve(this.config.admittedMerchants.map(candidate => ({
      platform: 'wangwang' as const,
      candidateId: candidate.candidateId,
      displayName: candidate.displayName,
      merchantId: candidate.merchantId,
    })))
  }

  /** @inheritdoc */
  async prepareAccount(request: import('@gestaltrun/dsh-im-runtime').ImAccountSetupRequest, signal: AbortSignal): Promise<ImPreparedAccount> {
    if (request.platform !== 'wangwang') throw new WangwangProtocolError('WANGWANG_SETUP_INVALID', 'Wangwang transport received another platform setup')
    const candidate = this.candidateById(request.candidateId)
    const payload = credentialPayloadSchema.parse({ version: 1, candidateId: candidate.candidateId, accessKeyId: request.accessKeyId, accessKeySecret: request.accessKeySecret })
    const checkedAt = new Date(this.now()).toISOString()
    let authorization: ImAccountAuthorization
    try {
      await this.client(candidate).pullEvents({ merchantId: candidate.merchantId, credentials: payload, cursor: 0, limit: 1, waitSeconds: 0, signal })
      authorization = { state: 'ready', checkedAt }
    } catch (error) {
      if (signal.aborted) throw error
      authorization = safeAuthorization(error, checkedAt)
    }
    const credentialRecord: CredentialRecord = { kind: 'grant', payload }
    return {
      displayName: request.displayName ?? candidate.displayName,
      identity: {
        platform: 'wangwang', merchantId: candidate.merchantId,
        displayName: request.displayName ?? candidate.displayName,
        mainServiceAccountId: candidate.mainServiceAccountId,
      },
      authorization,
      credentialRecord,
    }
  }

  /** @inheritdoc */
  inspectAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection> {
    return this.inspect(account, signal)
  }

  /** @inheritdoc */
  refreshAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection> {
    return this.inspect(account, signal)
  }

  /** @inheritdoc */
  async discoverConversations(account: ImAccountView, providerCursor: string | undefined, signal: AbortSignal): Promise<import('@gestaltrun/dsh-im-runtime').ImConversationCandidatePage> {
    const candidate = this.candidateForAccount(account)
    const credentials = await this.credentials(account, candidate)
    const page = await this.client(candidate).pullEvents({
      merchantId: candidate.merchantId, credentials, cursor: cursor(providerCursor),
      limit: this.config.pollLimit, waitSeconds: 0, signal,
    })
    const seen = new Set<string>()
    const items: import('@gestaltrun/dsh-im-runtime').ImConversationCandidate[] = []
    for (const event of page.events) {
      if (seen.has(event.conversationId)) continue
      seen.add(event.conversationId)
      items.push({
        conversationId: event.conversationId,
        conversationKind: 'direct',
        displayName: event.customerNick ?? event.customerId,
        directRecipient: { providerActorId: event.customerId },
      })
    }
    return { items, cursor: String(page.nextCursor) }
  }

  private senderEvidence(event: WangwangEvent, candidate: WangwangAdmittedMerchant): ImInboundSenderEvidence {
    if (event.sender.kind === 'configured-native') return { kind: 'configured-native', providerActorId: candidate.mainServiceAccountId }
    return event.sender
  }

  private inboundMessage(event: WangwangEvent, candidate: WangwangAdmittedMerchant): ImTransportInboundMessage {
    const senderEvidence = this.senderEvidence(event, candidate)
    return {
      externalMessageId: event.messageId,
      senderEvidence,
      text: event.text,
      format: event.format,
      occurredAt: event.occurredAt,
    }
  }

  private async admitPage(
    page: WangwangEventPage,
    sink: ImTransportSink,
    candidate: WangwangAdmittedMerchant,
    account: ImAccountView,
    plan: ImTransportListenPlan,
    observedCursor: string | null,
  ): Promise<string | null> {
    const nextCursor = String(page.nextCursor)
    const pageOperationId = operationId([
      'page', account.id, candidate.merchantId, observedCursor, nextCursor,
      ...page.events.map(event => event.eventId),
    ])
    const grouped = new Map<string, WangwangEvent[]>()
    for (const event of page.events) {
      if (!receivesConversation(plan, event.conversationId)) continue
      const events = grouped.get(event.conversationId)
      if (events === undefined) grouped.set(event.conversationId, [event])
      else events.push(event)
    }
    const conversations: ImTransportConversationPage[] = [...grouped.entries()].map(([conversationId, events]) => ({
      operationId: operationId(['conversation', pageOperationId, conversationId, ...events.map(event => event.messageId)]),
      conversationId,
      conversationKind: 'direct',
      messages: events.map(event => this.inboundMessage(event, candidate)),
    }))
    const inboundPage: ImTransportInboundPage = {
      operationId: pageOperationId,
      owner: { platform: 'wangwang', accountId: account.id, streamId: candidate.merchantId },
      observedCursor,
      nextCursor,
      conversations,
    }
    const receipt: ImTransportInboundPageReceipt = await sink.receivePage(inboundPage)
    if (receipt.cursor.status === 'rejected') {
      throw new WangwangProtocolError(receipt.cursor.code ?? 'WANGWANG_CURSOR_REJECTED', receipt.cursor.message ?? 'Wangwang cursor receipt was rejected')
    }
    if (receipt.cursor.status !== 'conflict' && receipt.cursor.cursor.cursor !== nextCursor) {
      throw new WangwangProtocolError('WANGWANG_CURSOR_RECEIPT_INVALID', 'Wangwang cursor receipt does not match the admitted page')
    }
    return receipt.cursor.cursor.cursor
  }

  private async poll(candidate: WangwangAdmittedMerchant, account: ImAccountView, plan: ImTransportListenPlan, sink: ImTransportSink, startCursor: string | null, signal: AbortSignal): Promise<void> {
    let current = startCursor
    while (!signal.aborted) {
      await wait(this.config.pollIntervalMs, signal)
      const credentials = await this.credentials(account, candidate)
      const page = await this.client(candidate).pullEvents({
        merchantId: candidate.merchantId, credentials, cursor: cursor(current ?? undefined),
        limit: this.config.pollLimit, waitSeconds: this.config.pollWaitSeconds, signal,
      })
      current = await this.admitPage(page, sink, candidate, account, plan, current)
      if (page.hasMore) continue
    }
  }

  /** @inheritdoc */
  async listen(account: ImAccountView, plan: ImTransportListenPlan, sink: ImTransportSink, signal: AbortSignal): Promise<() => Promise<void>> {
    const key = String(account.id)
    if (this.listeners.has(key)) throw new WangwangProtocolError('WANGWANG_LISTENER_CONFLICT', 'Wangwang account listener is already running')
    if (!plan.routes.some(route => route.conversationKind === 'direct')) {
      throw new WangwangProtocolError('WANGWANG_LISTEN_PLAN_UNSUPPORTED', 'Wangwang listener requires an enabled direct-conversation route')
    }
    const candidate = this.candidateForAccount(account)
    const abort = new AbortController()
    const relayAbort = (): void => { abort.abort(signal.reason) }
    signal.addEventListener('abort', relayAbort, { once: true })
    if (signal.aborted) relayAbort()
    try {
      const credentials = await this.credentials(account, candidate)
      const first = await this.client(candidate).pullEvents({
        merchantId: candidate.merchantId, credentials, cursor: 0,
        limit: this.config.pollLimit, waitSeconds: 0, signal: abort.signal,
      })
      const resumedCursor = await this.admitPage(first, sink, candidate, account, plan, null)
      const done = this.poll(candidate, account, plan, sink, resumedCursor, abort.signal)
        .catch((error: unknown) => {
          if (!abort.signal.aborted) this.ctx.logger('imWangwang').warn(`Wangwang listener stopped: ${error instanceof Error ? error.message : 'unknown failure'}`)
        })
        .finally(() => {
          signal.removeEventListener('abort', relayAbort)
          if (this.listeners.get(key)?.abort === abort) this.listeners.delete(key)
        })
      this.listeners.set(key, { abort, done })
      return async () => { abort.abort(new Error('Wangwang listener disposed')); await done }
    } catch (error) {
      signal.removeEventListener('abort', relayAbort)
      abort.abort(error)
      throw error
    }
  }

  /** @inheritdoc */
  async send(request: ImTransportSendRequest, signal: AbortSignal): Promise<ImTransportSendResult> {
    if (request.conversationKind !== 'direct') return { state: 'failed', code: 'WANGWANG_CONVERSATION_UNSUPPORTED', message: 'Wangwang transport supports direct conversations' }
    if (request.directRecipient === undefined) return { state: 'failed', code: 'WANGWANG_DIRECT_RECIPIENT_UNAVAILABLE', message: 'Wangwang direct send requires the durable customer identity' }
    const candidate = this.candidateForAccount(request.account)
    const credentials = await this.credentials(request.account, candidate)
    return transportResult(await this.client(candidate).sendMessage({
      merchantId: candidate.merchantId, customerId: request.directRecipient.providerActorId,
      userId: candidate.mainServiceAccountId, text: request.text, requestId: request.requestId,
      credentials, signal,
    }))
  }

  /** @inheritdoc */
  async confirm(request: ImTransportConfirmRequest, signal: AbortSignal): Promise<ImTransportSendResult> {
    const candidate = this.candidateForAccount(request.account)
    const credentials = await this.credentials(request.account, candidate)
    return transportResult(await this.client(candidate).confirmMessage({
      merchantId: candidate.merchantId, requestId: request.requestId,
      ...(request.externalMessageId === undefined ? {} : { messageId: request.externalMessageId }),
      credentials, signal,
    }))
  }
}

/**
 * Register the admitted Wangwang transport for the mounting Cordis fiber.
 * @param ctx - Cordis context with runtime registry and Credentials.
 * @param config - admitted merchant catalog and polling settings.
 */
export function apply(ctx: Context, config: WangwangTransportConfig): void {
  ctx.imTransports.register(new WangwangTransport(ctx, config))
}
apply.inject = ['imTransports', 'credentials']

export default apply
