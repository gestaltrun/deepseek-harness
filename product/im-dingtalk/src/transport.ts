/** DingTalk employee OAuth transport backed by the public DWS command. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ImAccountAuthorization,
  ImAccountView,
  ImDeliveryOperationId,
  ImPreparedAccount,
  ImTransport,
  ImTransportAccountInspection,
  ImTransportConfirmRequest,
  ImTransportInboundPage,
  ImTransportInboundPageReceipt,
  ImTransportListenPlan,
  ImTransportSendRequest,
  ImTransportSendResult,
  ImTransportSink,
} from '@gestaltrun/dsh-im-runtime'
import { DwsClient } from './client.ts'
import { resolveDingTalkTransportConfig } from './config.ts'
import type { DingTalkTransportConfig, ResolvedDingTalkTransportConfig } from './config.ts'
import { DwsCommandError, DwsProcessRunner } from './process.ts'
import type { DwsEventStream } from './process.ts'
import { DwsProtocolError, authorizationFromProfile, parseDwsInboundEvent } from './protocol.ts'
import type { DwsInboundEvent, DwsProfile } from './protocol.ts'

interface ActiveListener { readonly abort: AbortController; readonly stop: () => Promise<void>; readonly done: Promise<void> }

function operationId(parts: readonly unknown[]): ImDeliveryOperationId {
  return brandString<ImDeliveryOperationId>(`dingtalk-${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`)
}

function failedAuthorization(error: unknown, checkedAt: string): ImAccountAuthorization {
  const code = error instanceof DwsProtocolError ? error.code : 'DINGTALK_AUTHORIZATION_CHECK_FAILED'
  return { state: 'failed', code, message: 'DWS could not establish DingTalk authorization', checkedAt }
}

function assertCursor(value: string | undefined): void {
  if (value === undefined) return
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw new DwsProtocolError('DINGTALK_CONVERSATION_CURSOR_INVALID', 'DingTalk conversation cursor is not a non-negative safe integer')
  }
}

function receivesEvent(plan: ImTransportListenPlan, event: DwsInboundEvent): boolean {
  return plan.routes.some(route => route.conversationKind === event.conversationKind
    && (route.target.kind === 'all' || route.target.conversationId === event.conversationId)
    && (event.mentionedConfiguredAccount !== true || route.needsMentionEvidence))
}

/** Complete DingTalk employee transport registered with the product runtime. */
export class DingTalkTransport implements ImTransport {
  readonly platform = 'dingtalk' as const
  private readonly config: ResolvedDingTalkTransportConfig
  private readonly client: DwsClient
  private readonly listeners = new Map<string, ActiveListener>()
  private readonly now: () => number

  /** @param ctx - Cordis context with runtime and subprocess services. @param config - installed DWS process settings. @param dependencies - owner-local test seams. */
  constructor(
    private readonly ctx: Context,
    config: DingTalkTransportConfig = {},
    dependencies: { readonly client?: DwsClient; readonly now?: () => number } = {},
  ) {
    this.config = resolveDingTalkTransportConfig(config)
    this.now = dependencies.now ?? Date.now
    this.client = dependencies.client ?? new DwsClient(new DwsProcessRunner(ctx, this.config), this.now)
  }

  private identity(account: ImAccountView): Extract<ImAccountView['identity'], { platform: 'dingtalk' }> {
    if (account.platform !== 'dingtalk' || account.identity.platform !== 'dingtalk') {
      throw new DwsProtocolError('DINGTALK_ACCOUNT_INVALID', 'DingTalk transport received another platform account')
    }
    if (account.identity.profile !== `${account.identity.corpId}:${account.identity.userId}`) {
      throw new DwsProtocolError('DINGTALK_ACCOUNT_IDENTITY_INVALID', 'DingTalk account does not retain a stable profile selector')
    }
    return account.identity
  }

  private findProfile(profiles: readonly DwsProfile[], profile: string): DwsProfile | undefined {
    return profiles.find(candidate => candidate.profile === profile)
  }

  /** @inheritdoc */
  async listAccountCandidates(signal: AbortSignal): Promise<readonly import('@gestaltrun/dsh-im-runtime').ImAccountCandidate[]> {
    return (await this.client.listProfiles(signal)).map(profile => ({
      platform: 'dingtalk' as const,
      profile: profile.profile,
      displayName: profile.userName === undefined ? profile.corpName : `${profile.corpName} / ${profile.userName}`,
    }))
  }

  /** @inheritdoc */
  async prepareAccount(request: import('@gestaltrun/dsh-im-runtime').ImAccountSetupRequest, signal: AbortSignal): Promise<ImPreparedAccount> {
    if (request.platform !== 'dingtalk') throw new DwsProtocolError('DINGTALK_SETUP_INVALID', 'DingTalk transport received another platform setup')
    const profile = this.findProfile(await this.client.listProfiles(signal), request.profile)
    if (profile === undefined) throw new DwsProtocolError('DINGTALK_PROFILE_NOT_FOUND', 'The selected DWS employee profile is unavailable')
    const displayName = request.displayName ?? (profile.userName === undefined ? profile.corpName : `${profile.corpName} / ${profile.userName}`)
    return {
      displayName,
      identity: { platform: 'dingtalk', profile: profile.profile, corpId: profile.corpId, userId: profile.userId, displayName },
      authorization: authorizationFromProfile(profile, new Date(this.now()).toISOString()),
    }
  }

  /** @inheritdoc */
  async inspectAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection> {
    const identity = this.identity(account)
    const checkedAt = new Date(this.now()).toISOString()
    try {
      const profile = this.findProfile(await this.client.listProfiles(signal), identity.profile)
      return { authorization: profile === undefined ? { state: 'required', reason: 'missing', checkedAt } : authorizationFromProfile(profile, checkedAt) }
    } catch (error) {
      if (signal.aborted) throw error
      return { authorization: failedAuthorization(error, checkedAt) }
    }
  }

  /** @inheritdoc */
  async refreshAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection> {
    const identity = this.identity(account)
    const checkedAt = new Date(this.now()).toISOString()
    try {
      const status = await this.client.refresh(identity.profile, signal)
      if (status.corpId !== undefined && status.corpId !== identity.corpId) {
        return { authorization: { state: 'failed', code: 'DINGTALK_REFRESH_IDENTITY_MISMATCH', message: 'DWS refresh returned another organization', checkedAt } }
      }
      if (status.userId !== undefined && status.userId !== identity.userId) {
        return { authorization: { state: 'failed', code: 'DINGTALK_REFRESH_IDENTITY_MISMATCH', message: 'DWS refresh returned another employee', checkedAt } }
      }
      return { authorization: status.authorization }
    } catch (error) {
      if (signal.aborted) throw error
      return { authorization: failedAuthorization(error, checkedAt) }
    }
  }

  /** @inheritdoc */
  async discoverConversations(account: ImAccountView, providerCursor: string | undefined, signal: AbortSignal): Promise<import('@gestaltrun/dsh-im-runtime').ImConversationCandidatePage> {
    const identity = this.identity(account)
    assertCursor(providerCursor)
    const page = await this.client.conversations(identity.profile, this.config.conversationPageSize, providerCursor, signal)
    return {
      items: page.conversations.map(conversation => ({
        conversationId: conversation.conversationId,
        conversationKind: conversation.conversationKind,
        displayName: conversation.displayName,
      })),
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
    }
  }

  private async admit(event: DwsInboundEvent, account: ImAccountView, sink: ImTransportSink, observedCursor: string | null): Promise<string | null> {
    const nextCursor = `${event.eventId}:${event.eventKey}`
    const conversationOperation = operationId(['conversation', account.id, event.eventKey, event.eventId, event.conversationId, event.messageId])
    const pageOperation = operationId(['page', account.id, event.eventKey, event.eventId, observedCursor, nextCursor])
    const page: ImTransportInboundPage = {
      operationId: pageOperation,
      owner: { platform: 'dingtalk', accountId: account.id, streamId: `${this.identity(account).profile}:messages` },
      observedCursor,
      nextCursor,
      conversations: [{
        operationId: conversationOperation,
        conversationId: event.conversationId,
        conversationKind: event.conversationKind,
        messages: [{
          externalMessageId: event.messageId,
          senderEvidence: {
            kind: 'external-actor',
            senderId: event.senderId,
            ...(event.senderName === undefined ? {} : { senderDisplayName: event.senderName }),
            ...(event.directRecipientId === undefined ? {} : { openDingTalkId: event.directRecipientId }),
          },
          text: event.text,
          format: 'text',
          occurredAt: event.occurredAt,
          ...(event.mentionedConfiguredAccount === true ? { mentionedConfiguredAccount: true } : {}),
        }],
      }],
    }
    const receipt: ImTransportInboundPageReceipt = await sink.receivePage(page)
    if (receipt.cursor.status === 'rejected') throw new DwsProtocolError(receipt.cursor.code ?? 'DINGTALK_CURSOR_REJECTED', receipt.cursor.message ?? 'DingTalk cursor receipt was rejected')
    if (receipt.cursor.status !== 'conflict' && receipt.cursor.cursor.cursor !== nextCursor) {
      throw new DwsProtocolError('DINGTALK_CURSOR_RECEIPT_INVALID', 'DingTalk cursor receipt does not match the admitted event')
    }
    return receipt.cursor.cursor.cursor
  }

  /** @inheritdoc */
  async listen(account: ImAccountView, plan: ImTransportListenPlan, sink: ImTransportSink, signal: AbortSignal): Promise<() => Promise<void>> {
    const identity = this.identity(account)
    const key = String(account.id)
    if (this.listeners.has(key)) throw new DwsProtocolError('DINGTALK_LISTENER_CONFLICT', 'DingTalk account listener is already running')
    if (!plan.routes.some(route => route.conversationKind === 'direct' || route.conversationKind === 'group')) {
      throw new DwsProtocolError('DINGTALK_LISTEN_PLAN_UNSUPPORTED', 'DingTalk listener requires an enabled direct or group route')
    }
    const abort = new AbortController()
    const relayAbort = (): void => { abort.abort(signal.reason) }
    signal.addEventListener('abort', relayAbort, { once: true })
    if (signal.aborted) relayAbort()
    let cursor: string | null = null
    let stream: DwsEventStream | undefined
    try {
      stream = await this.client.listen(identity.profile, abort.signal, async line => {
        let event: DwsInboundEvent
        try { event = parseDwsInboundEvent(line) } catch (error) {
          this.ctx.logger('imDingTalk').warn(`DingTalk event skipped: ${error instanceof DwsProtocolError ? error.code : 'DINGTALK_EVENT_INVALID'}`)
          return
        }
        if (!receivesEvent(plan, event)) return
        cursor = await this.admit(event, account, sink, cursor)
      })
      await stream.ready
      const done = stream.done.catch((error: unknown) => {
        if (!abort.signal.aborted) this.ctx.logger('imDingTalk').warn(`DingTalk listener stopped: ${error instanceof DwsProtocolError ? error.code : 'DINGTALK_STREAM_FAILED'}`)
      }).finally(() => {
        signal.removeEventListener('abort', relayAbort)
        if (this.listeners.get(key)?.abort === abort) this.listeners.delete(key)
      })
      const active: ActiveListener = { abort, stop: stream.stop, done }
      this.listeners.set(key, active)
      return async () => { abort.abort(new Error('DingTalk listener disposed')); await active.stop(); await active.done }
    } catch (error) {
      signal.removeEventListener('abort', relayAbort)
      abort.abort(error)
      await stream?.stop().catch(() => {})
      throw error
    }
  }

  /** @inheritdoc */
  async send(request: ImTransportSendRequest, signal: AbortSignal): Promise<ImTransportSendResult> {
    const identity = this.identity(request.account)
    if (request.conversationKind === 'direct') {
      const recipient = request.directRecipient
      if (recipient === undefined) return { state: 'failed', code: 'DINGTALK_DIRECT_RECIPIENT_UNAVAILABLE', message: 'DingTalk direct send requires a durable peer identifier' }
      try {
        if (recipient.openDingTalkId !== undefined) {
          return await this.client.send(identity.profile, { kind: 'direct-open', openDingTalkId: recipient.openDingTalkId }, request.text, request.requestId, signal)
        }
        if (recipient.userId !== undefined) {
          return await this.client.send(identity.profile, { kind: 'direct-user', userId: recipient.userId }, request.text, request.requestId, signal)
        }
        return { state: 'failed', code: 'DINGTALK_DIRECT_RECIPIENT_UNAVAILABLE', message: 'DingTalk direct send requires a DWS-supported peer identifier' }
      } catch (error) {
        if (error instanceof DwsCommandError && !error.started) return { state: 'failed', code: error.code, message: 'DWS did not start a DingTalk send attempt' }
        return { state: 'unknown' }
      }
    }
    try {
      return await this.client.send(identity.profile, { kind: 'group', conversationId: request.conversationId }, request.text, request.requestId, signal)
    } catch (error) {
      if (error instanceof DwsCommandError && !error.started) return { state: 'failed', code: error.code, message: 'DWS did not start a DingTalk send attempt' }
      return { state: 'unknown' }
    }
  }

  /** @inheritdoc */
  async confirm(request: ImTransportConfirmRequest, signal: AbortSignal): Promise<ImTransportSendResult> {
    const identity = this.identity(request.account)
    if (request.externalMessageId === undefined) return { state: 'unknown' }
    try { return await this.client.confirm(identity.profile, request.externalMessageId, signal) } catch { return { state: 'unknown', externalMessageId: request.externalMessageId } }
  }
}

/**
 * Register the DingTalk transport for the mounting Cordis fiber.
 * @param ctx - Cordis context with runtime registry and Subprocess.
 * @param config - installed DWS process settings.
 */
export function apply(ctx: Context, config: DingTalkTransportConfig = {}): void {
  ctx.imTransports.register(new DingTalkTransport(ctx, config))
}
apply.inject = ['imTransports', 'subprocess']

export default apply
