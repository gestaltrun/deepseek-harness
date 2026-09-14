/** Durable receive, history, Session reconciliation, and outbox state. */
import { createHash, randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ImBeginOutboundAttemptRequest,
  ImBeginOutboundAttemptResult,
  ImCancelPendingAiRequest,
  ImCommitProviderCursorRequest,
  ImConversationCursor,
  ImDeliveryOperationId,
  ImDeliveryScope,
  ImGetOutboundRequest,
  ImHistoryPage,
  ImHistoryQueryRequest,
  ImImportJsonlHistoryRequest,
  ImImportJsonlHistoryResult,
  ImInboundMessageInput,
  ImInboundMessageView,
  ImInboundOperationQuery,
  ImInboundPageResult,
  ImIngestInboundPageRequest,
  ImMarkSubmittedRequest,
  ImMarkSubmittedResult,
  ImMessageId,
  ImMessageSource,
  ImOutboundAttemptId,
  ImOutboundPage,
  ImOutboundQueryRequest,
  ImOutboundRequestId,
  ImOutboundRouteBinding,
  ImOutboundView,
  ImPendingInboundRequest,
  ImProviderCursorCommitResult,
  ImProviderCursorId,
  ImProviderCursorOperationQuery,
  ImProviderCursorOwner,
  ImProviderCursorView,
  ImRealDeliveryScope,
  ImRegisterOutboundRequest,
  ImScopeId,
  ImSettleOutboundAttemptRequest,
  ImSettleSimulationOutboundRequest,
} from './delivery-types.ts'
import { imInboundMessageInputSchema, type ImDeliveryAggregate, type ImProviderCursorAggregate } from './delivery-schema.ts'
import { ImRuntimeError } from './errors.ts'
import type { ImAccountId, ImPlatform, ImRouteResolution } from './types.ts'

interface ImDeliveryHost {
  inspectAccount(id: ImAccountId): { readonly platform: ImPlatform; readonly paused: boolean; readonly revision: import('./types.ts').ImRevision } | undefined
  resolveRoute(scope: ImRealDeliveryScope): ImRouteResolution | undefined
  publish(change: {
    readonly scope: ImDeliveryScope
    readonly scopeId: ImScopeId
    readonly kind: 'inbound' | 'submitted' | 'outbound'
    readonly messageIds?: readonly ImMessageId[]
    readonly requestId?: ImOutboundRequestId
  }): void
}

interface Mutation<T> {
  readonly aggregate: ImDeliveryAggregate
  readonly value: T
  readonly changed: boolean
}

const settled = async (promise: Promise<unknown>): Promise<void> => { try { await promise } catch { /* preserve queue progress after the caller observes the failure */ } }

function timestamp(): string { return new Date().toISOString() }

/**
 * Encode every scope component in an ordered JSON tuple before hashing.
 * @param scope - complete real or simulation conversation identity.
 * @returns stable scope identifier shared by history, Session sources, and outbox rows.
 */
export function encodeImScopeId(scope: ImDeliveryScope): ImScopeId {
  const tuple = scope.kind === 'real'
    ? [scope.kind, scope.platform, scope.accountId, scope.conversationKind, scope.conversationId]
    : [scope.kind, scope.instanceId, scope.platform, scope.accountId, scope.conversationKind, scope.conversationId]
  return brandString<ImScopeId>(`im-scope:${createHash('sha256').update(JSON.stringify(tuple)).digest('base64url')}`)
}

/**
 * Encode the platform account and provider feed name that jointly own a cursor.
 * @param owner - provider cursor owner.
 * @returns stable provider cursor identifier.
 */
export function encodeImProviderCursorId(owner: ImProviderCursorOwner): ImProviderCursorId {
  return brandString<ImProviderCursorId>(`im-provider-cursor:${createHash('sha256').update(JSON.stringify([owner.platform, owner.accountId, owner.streamId])).digest('base64url')}`)
}

function messageIdentity(scopeId: ImScopeId, externalMessageId: string): ImMessageId {
  return brandString<ImMessageId>(`im-message:${createHash('sha256').update(JSON.stringify([scopeId, externalMessageId])).digest('base64url')}`)
}

function attemptIdentity(): ImOutboundAttemptId {
  return brandString<ImOutboundAttemptId>(`im-attempt:${randomUUID()}`)
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'IM delivery query limit must be an integer from 1 through 1000')
  }
}

function sameScope(left: ImDeliveryScope, right: ImDeliveryScope): boolean {
  return encodeImScopeId(left) === encodeImScopeId(right)
}

function initialAggregate(scope: ImDeliveryScope): ImDeliveryAggregate {
  const scopeId = encodeImScopeId(scope)
  return {
    scope,
    scopeId,
    nextMessageSequenceNumber: 1,
    nextOutboundSequenceNumber: 1,
    cursor: {
      scopeId,
      platformCursor: null,
      lastReceivedSequenceNumber: 0,
      lastSubmittedSequenceNumber: 0,
      pendingCount: 0,
      updatedAt: timestamp(),
    },
    messages: {},
    messageIdsByExternalId: {},
    operations: {},
    outbounds: {},
  }
}

function sortedMessages(aggregate: ImDeliveryAggregate): ImInboundMessageView[] {
  return Object.values(aggregate.messages).sort((left, right) => left.sequenceNumber - right.sequenceNumber)
}

function pendingCount(aggregate: ImDeliveryAggregate): number {
  return Object.values(aggregate.messages).filter(message => message.origin === 'live' && message.stage === 'received').length
}

function submittedWatermark(aggregate: ImDeliveryAggregate): number {
  let watermark = 0
  for (const message of sortedMessages(aggregate)) {
    if (message.origin !== 'live') continue
    if (message.stage !== 'submitted') break
    watermark = message.sequenceNumber
  }
  return watermark
}

function pageFingerprint(request: ImIngestInboundPageRequest): string {
  return JSON.stringify(['page', request.scope, request.observedCursor, request.nextCursor, request.messages])
}

function importFingerprint(request: ImImportJsonlHistoryRequest, messages: readonly ImInboundMessageInput[]): string {
  return JSON.stringify(['jsonl-import', request.scope, messages])
}

function assertOperation(existing: { readonly fingerprint: string } | undefined, fingerprint: string, operationId: ImDeliveryOperationId): void {
  if (existing !== undefined && existing.fingerprint !== fingerprint) {
    throw new ImRuntimeError('IM_DELIVERY_OPERATION_REUSED', `IM delivery operation '${operationId}' was already used for a different request`)
  }
}

function assertOutbound(existing: ImOutboundView | undefined, request: ImRegisterOutboundRequest): void {
  if (existing === undefined) return
  const stored = JSON.stringify([existing.intent, existing.content, existing.replyToExternalMessageId ?? null])
  const incoming = JSON.stringify([request.intent, request.content, request.replyToExternalMessageId ?? null])
  if (stored !== incoming) {
    throw new ImRuntimeError('IM_OUTBOUND_REQUEST_REUSED', `IM outbound request '${request.requestId}' was already used for a different intent`)
  }
}

/** One-record mutations for complete conversation scopes. */
export class ImDeliveryStore {
  private readonly tails = new Map<ImScopeId, Promise<void>>()
  private readonly cursorTails = new Map<ImProviderCursorId, Promise<void>>()

  /** @param table - durable scope table. @param host - account policy and post-commit publisher. */
  constructor(
    private readonly table: KvTable<ImScopeId, ImDeliveryAggregate>,
    private readonly providerCursors: KvTable<ImProviderCursorId, ImProviderCursorAggregate>,
    private readonly host: ImDeliveryHost,
  ) {}

  /** Mark interrupted platform calls uncertain before new work can claim them. */
  async recoverInterruptedAttempts(): Promise<void> {
    for (const [scopeId, aggregate] of this.table.entries()) {
      if (!Object.values(aggregate.outbounds).some(outbound => outbound.status === 'dispatching')) continue
      await this.enqueue(scopeId, async () => {
        const current = this.require(scopeId)
        const changedAt = timestamp()
        const outbounds = Object.fromEntries(Object.entries(current.outbounds).map(([id, outbound]) => [id,
          outbound.status === 'dispatching'
            ? { ...outbound, status: 'result-unknown' as const, receipt: outbound.receipt ?? { providerStatus: 'interrupted', observedAt: changedAt }, updatedAt: changedAt }
            : outbound,
        ]))
        await this.table.put(scopeId, { ...current, outbounds })
      })
    }
  }

  async ingestInboundPage(request: ImIngestInboundPageRequest): Promise<ImInboundPageResult> {
    if (request.scope.kind === 'real') this.assertRealScope(request.scope)
    const scopeId = encodeImScopeId(request.scope)
    const fingerprint = pageFingerprint(request)
    return this.mutate<ImInboundPageResult>(request.scope, (current) => {
      const existing = current.operations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) {
        if (existing.result.kind !== 'page') throw new ImRuntimeError('IM_DELIVERY_OPERATION_REUSED', `IM delivery operation '${request.operationId}' is not a page operation`)
        return { aggregate: current, value: existing.result, changed: false }
      }
      if (current.cursor.platformCursor !== request.observedCursor) {
        const result: ImInboundPageResult = {
          kind: 'page', operationId: request.operationId, status: 'conflict', acceptedCount: 0,
          evidenceMergedCount: 0, duplicateCount: 0, messages: [], cursor: current.cursor,
        }
        return {
          aggregate: { ...current, operations: { ...current.operations, [request.operationId]: { fingerprint, result } } },
          value: result,
          changed: true,
        }
      }
      let nextSequence = current.nextMessageSequenceNumber
      const messages = { ...current.messages }
      const byExternalId = { ...current.messageIdsByExternalId }
      const accepted: ImInboundMessageView[] = []
      const evidenceMerged: ImInboundMessageView[] = []
      let duplicateCount = 0
      const ordered = [...request.messages].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.externalMessageId.localeCompare(right.externalMessageId))
      const receivedAt = timestamp()
      for (const input of ordered) {
        const existingId = byExternalId[input.externalMessageId]
        if (existingId !== undefined) {
          duplicateCount++
          const existingMessage = messages[existingId]
          if (existingMessage !== undefined && existingMessage.mentionedConfiguredAccount !== true && input.mentionedConfiguredAccount === true) {
            const enriched = { ...existingMessage, mentionedConfiguredAccount: true }
            messages[existingId] = enriched
            evidenceMerged.push(enriched)
          }
          continue
        }
        const id = messageIdentity(scopeId, input.externalMessageId)
        const message: ImInboundMessageView = {
          ...input,
          messageId: id,
          scopeId,
          origin: 'live',
          stage: 'received',
          sequenceNumber: nextSequence++,
          receivedAt,
        }
        messages[id] = message
        byExternalId[input.externalMessageId] = id
        accepted.push(message)
      }
      const cursor: ImConversationCursor = {
        ...current.cursor,
        platformCursor: request.nextCursor,
        lastReceivedSequenceNumber: accepted.at(-1)?.sequenceNumber ?? current.cursor.lastReceivedSequenceNumber,
        pendingCount: current.cursor.pendingCount + accepted.length,
        updatedAt: receivedAt,
      }
      const result: ImInboundPageResult = {
        kind: 'page', operationId: request.operationId, status: 'applied', acceptedCount: accepted.length,
        evidenceMergedCount: evidenceMerged.length, duplicateCount, messages: [...accepted, ...evidenceMerged], cursor,
      }
      return {
        aggregate: {
          ...current, nextMessageSequenceNumber: nextSequence, cursor, messages, messageIdsByExternalId: byExternalId,
          operations: { ...current.operations, [request.operationId]: { fingerprint, result } },
        },
        value: result,
        changed: true,
      }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'inbound', messageIds: result.value.messages.map(message => message.messageId) })
      return result.value
    })
  }

  queryInboundOperation(scope: ImDeliveryScope, operationId: ImDeliveryOperationId): ImInboundOperationQuery {
    const result = this.lookup(scope)?.operations[operationId]?.result
    return result === undefined ? { state: 'not-found' } : { state: 'known', result }
  }

  getConversationCursor(scope: ImDeliveryScope): ImConversationCursor {
    return this.lookup(scope)?.cursor ?? initialAggregate(scope).cursor
  }

  getProviderCursor(owner: ImProviderCursorOwner): ImProviderCursorView {
    const id = encodeImProviderCursorId(owner)
    const aggregate = this.providerCursors.get(id)
    if (aggregate !== undefined) return { id, owner: aggregate.owner, cursor: aggregate.cursor, updatedAt: aggregate.updatedAt }
    return { id, owner, cursor: null, updatedAt: timestamp() }
  }

  async commitProviderCursor(request: ImCommitProviderCursorRequest): Promise<ImProviderCursorCommitResult> {
    const account = this.host.inspectAccount(request.owner.accountId)
    if (account === undefined) throw new ImRuntimeError('IM_ACCOUNT_NOT_FOUND', `IM account '${request.owner.accountId}' is unknown`)
    if (account.platform !== request.owner.platform || request.owner.streamId.trim() === '') {
      throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'provider cursor owner must use the configured account platform and a non-empty streamId')
    }
    const id = encodeImProviderCursorId(request.owner)
    const fingerprint = JSON.stringify(['provider-cursor', request.owner, request.observedCursor, request.nextCursor,
      request.pages.map(page => [page.scope, page.operationId])])
    return this.enqueueCursor(id, async () => {
      const current = this.providerCursors.get(id) ?? {
        id, owner: request.owner, cursor: null, updatedAt: timestamp(), operations: {},
      }
      const existing = current.operations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) return existing.result
      let status: ImProviderCursorCommitResult['status']
      let code: ImProviderCursorCommitResult['code']
      let message: string | undefined
      if (current.cursor !== request.observedCursor) {
        status = 'conflict'
      } else {
        const missing = request.pages.find(page => {
          const receipt = this.lookup(page.scope)?.operations[page.operationId]?.result
          return receipt?.kind !== 'page' || receipt.status !== 'applied'
        })
        if (missing !== undefined) {
          status = 'rejected'
          code = 'IM_PROVIDER_PAGE_NOT_DURABLE'
          message = `conversation page '${missing.operationId}' is not durably applied`
        } else {
          status = current.cursor === request.nextCursor ? 'unchanged' : 'applied'
        }
      }
      const updatedAt = timestamp()
      const cursor: ImProviderCursorView = {
        id,
        owner: current.owner,
        cursor: status === 'applied' ? request.nextCursor : current.cursor,
        updatedAt: status === 'applied' ? updatedAt : current.updatedAt,
      }
      const result: ImProviderCursorCommitResult = {
        operationId: request.operationId,
        status,
        cursor,
        ...(code === undefined ? {} : { code }),
        ...(message === undefined ? {} : { message }),
      }
      await this.providerCursors.put(id, {
        id,
        owner: current.owner,
        cursor: cursor.cursor,
        updatedAt: cursor.updatedAt,
        operations: { ...current.operations, [request.operationId]: { fingerprint, result } },
      })
      return result
    })
  }

  queryProviderCursorOperation(owner: ImProviderCursorOwner, operationId: ImDeliveryOperationId): ImProviderCursorOperationQuery {
    const result = this.providerCursors.get(encodeImProviderCursorId(owner))?.operations[operationId]?.result
    return result === undefined ? { state: 'not-found' } : { state: 'known', result }
  }

  queryHistory(request: ImHistoryQueryRequest): ImHistoryPage {
    assertLimit(request.limit)
    const aggregate = this.lookup(request.scope)
    if (aggregate === undefined) return { items: [], hasMore: false }
    const acceptedOrigins = request.origins === undefined ? undefined : new Set(request.origins)
    const before = request.beforeSequenceNumber ?? Number.POSITIVE_INFINITY
    const candidates = sortedMessages(aggregate).filter(message => message.sequenceNumber < before && (acceptedOrigins?.has(message.origin) ?? true))
    const offset = Math.max(0, candidates.length - request.limit)
    const items = candidates.slice(offset)
    return {
      items,
      hasMore: offset > 0,
      ...(offset > 0 && items[0] !== undefined ? { nextBeforeSequenceNumber: items[0].sequenceNumber } : {}),
    }
  }

  pendingInbound(request: ImPendingInboundRequest): readonly ImInboundMessageView[] {
    assertLimit(request.limit)
    const aggregate = this.lookup(request.scope)
    if (aggregate === undefined) return []
    return sortedMessages(aggregate).filter(message => message.origin === 'live' && message.stage === 'received').slice(0, request.limit)
  }

  messageSource(scope: ImDeliveryScope, messageId: ImMessageId): ImMessageSource {
    const aggregate = this.lookup(scope)
    const message = aggregate?.messages[messageId]
    if (message === undefined) throw new ImRuntimeError('IM_MESSAGE_NOT_FOUND', `IM message '${messageId}' is unknown for scope '${encodeImScopeId(scope)}'`)
    return { kind: 'im', scopeId: message.scopeId, messageId: message.messageId, sequenceNumber: message.sequenceNumber }
  }

  /** @param source - durable Session message source. @returns matched scope, or absence for stale or foreign evidence. */
  matchMessageSource(source: ImMessageSource): { readonly scope: ImDeliveryScope; readonly messageId: ImMessageId } | undefined {
    const aggregate = this.table.get(source.scopeId)
    const message = aggregate?.messages[source.messageId]
    if (aggregate === undefined || message === undefined || message.origin !== 'live' || message.sequenceNumber !== source.sequenceNumber) return undefined
    return { scope: aggregate.scope, messageId: message.messageId }
  }

  /** @param scope - complete scope. @param messageId - inbound identity. @returns stored row. */
  getInbound(scope: ImDeliveryScope, messageId: ImMessageId): ImInboundMessageView {
    const message = this.lookup(scope)?.messages[messageId]
    if (message === undefined) throw new ImRuntimeError('IM_MESSAGE_NOT_FOUND', `IM message '${messageId}' is unknown for scope '${encodeImScopeId(scope)}'`)
    return message
  }

  markSubmitted(request: ImMarkSubmittedRequest): Promise<ImMarkSubmittedResult> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate(request.scope, (current) => {
      const submittedAt = request.submittedAt ?? timestamp()
      const messages = { ...current.messages }
      const changed: ImInboundMessageView[] = []
      for (const id of new Set(request.messageIds)) {
        const message = messages[id]
        if (message === undefined || message.origin !== 'live') {
          throw new ImRuntimeError('IM_MESSAGE_NOT_FOUND', `live IM message '${id}' is unknown for scope '${scopeId}'`)
        }
        if (message.submission !== undefined && message.submission.sessionId !== request.sessionId) {
          throw new ImRuntimeError('IM_MESSAGE_ALREADY_SUBMITTED', `IM message '${id}' is already submitted to Session '${message.submission.sessionId}'`)
        }
        if (message.stage === 'submitted') continue
        const submitted: ImInboundMessageView = { ...message, stage: 'submitted', submission: { sessionId: request.sessionId, submittedAt } }
        messages[id] = submitted
        changed.push(submitted)
      }
      if (changed.length === 0) return { aggregate: current, value: { messages: [], cursor: current.cursor }, changed: false }
      const next = { ...current, messages }
      const cursor: ImConversationCursor = {
        ...current.cursor,
        lastSubmittedSequenceNumber: submittedWatermark(next),
        pendingCount: pendingCount(next),
        updatedAt: submittedAt,
      }
      return { aggregate: { ...next, cursor }, value: { messages: changed, cursor }, changed: true }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'submitted', messageIds: result.value.messages.map(message => message.messageId) })
      return result.value
    })
  }

  async importJsonlHistory(request: ImImportJsonlHistoryRequest): Promise<ImImportJsonlHistoryResult> {
    const parsed: ImInboundMessageInput[] = []
    for (const [index, line] of request.jsonl.split(/\r?\n/u).entries()) {
      if (line.trim() === '') continue
      let value: unknown
      try { value = JSON.parse(line) } catch (error) {
        throw new ImRuntimeError('IM_JSONL_INVALID', `IM JSONL line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
      const admitted = imInboundMessageInputSchema.safeParse(value)
      if (!admitted.success) throw new ImRuntimeError('IM_JSONL_INVALID', `IM JSONL line ${index + 1} is invalid: ${admitted.error.message}`)
      parsed.push(admitted.data)
    }
    const scopeId = encodeImScopeId(request.scope)
    const fingerprint = importFingerprint(request, parsed)
    return this.mutate(request.scope, (current) => {
      const existing = current.operations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) {
        if (existing.result.kind !== 'jsonl-import') throw new ImRuntimeError('IM_DELIVERY_OPERATION_REUSED', `IM delivery operation '${request.operationId}' is not an import operation`)
        return { aggregate: current, value: existing.result, changed: false }
      }
      let nextSequence = current.nextMessageSequenceNumber
      const messages = { ...current.messages }
      const byExternalId = { ...current.messageIdsByExternalId }
      let importedCount = 0
      let duplicateCount = 0
      const receivedAt = timestamp()
      for (const input of parsed) {
        if (byExternalId[input.externalMessageId] !== undefined) { duplicateCount++; continue }
        const id = messageIdentity(scopeId, input.externalMessageId)
        messages[id] = {
          ...input, messageId: id, scopeId, origin: 'jsonl-import', stage: 'submitted',
          sequenceNumber: nextSequence++, receivedAt,
        }
        byExternalId[input.externalMessageId] = id
        importedCount++
      }
      const result: ImImportJsonlHistoryResult = {
        kind: 'jsonl-import', operationId: request.operationId, status: 'applied', importedCount, duplicateCount,
      }
      return {
        aggregate: {
          ...current, nextMessageSequenceNumber: nextSequence, messages, messageIdsByExternalId: byExternalId,
          operations: { ...current.operations, [request.operationId]: { fingerprint, result } },
        },
        value: result,
        changed: true,
      }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'inbound' })
      return result.value
    })
  }

  registerOutbound(request: ImRegisterOutboundRequest, frozenBinding?: ImOutboundRouteBinding): Promise<ImOutboundView> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate(request.scope, (current) => {
      const existing = current.outbounds[request.requestId]
      assertOutbound(existing, request)
      if (existing !== undefined) return { aggregate: current, value: existing, changed: false }
      const policy = this.registrationPolicy(request, frozenBinding)
      const createdAt = timestamp()
      const outbound: ImOutboundView = {
        requestId: request.requestId,
        scopeId,
        intent: request.intent,
        content: request.content,
        status: policy.reason === undefined ? 'pending' : 'pre-send-failed',
        sequenceNumber: current.nextOutboundSequenceNumber,
        ...(policy.binding === undefined ? {} : { routeBinding: policy.binding }),
        ...(policy.reason === undefined ? {} : { preSendFailureReason: policy.reason }),
        ...(request.replyToExternalMessageId === undefined ? {} : { replyToExternalMessageId: request.replyToExternalMessageId }),
        createdAt,
        updatedAt: createdAt,
      }
      return {
        aggregate: {
          ...current,
          nextOutboundSequenceNumber: current.nextOutboundSequenceNumber + 1,
          outbounds: { ...current.outbounds, [request.requestId]: outbound },
        },
        value: outbound,
        changed: true,
      }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'outbound', requestId: request.requestId })
      return result.value
    })
  }

  beginOutboundAttempt(request: ImBeginOutboundAttemptRequest): Promise<ImBeginOutboundAttemptResult> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate<ImBeginOutboundAttemptResult>(request.scope, (current) => {
      const outbound = current.outbounds[request.requestId]
      if (outbound === undefined) throw new ImRuntimeError('IM_OUTBOUND_NOT_FOUND', `IM outbound request '${request.requestId}' is unknown`)
      if (outbound.status === 'result-unknown') return { aggregate: current, value: { state: 'result-unknown' as const, outbound }, changed: false }
      if (outbound.status === 'dispatching') {
        const updated: ImOutboundView = { ...outbound, status: 'result-unknown', receipt: outbound.receipt ?? { providerStatus: 'repeated-begin', observedAt: timestamp() }, updatedAt: timestamp() }
        return { aggregate: { ...current, outbounds: { ...current.outbounds, [request.requestId]: updated } }, value: { state: 'result-unknown' as const, outbound: updated }, changed: true }
      }
      if (outbound.status !== 'pending') return { aggregate: current, value: { state: 'blocked' as const, outbound }, changed: false }
      const reason = this.dispatchFailure(request.scope, outbound)
      if (reason !== undefined) {
        const updated: ImOutboundView = { ...outbound, status: 'pre-send-failed', preSendFailureReason: reason, updatedAt: timestamp() }
        return { aggregate: { ...current, outbounds: { ...current.outbounds, [request.requestId]: updated } }, value: { state: 'blocked' as const, outbound: updated }, changed: true }
      }
      const attempt = { attemptId: attemptIdentity(), startedAt: timestamp() }
      const updated: ImOutboundView = { ...outbound, status: 'dispatching', attempt, updatedAt: attempt.startedAt }
      return { aggregate: { ...current, outbounds: { ...current.outbounds, [request.requestId]: updated } }, value: { state: 'ready' as const, attemptId: attempt.attemptId, outbound: updated }, changed: true }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'outbound', requestId: request.requestId })
      return result.value
    })
  }

  settleOutboundAttempt(request: ImSettleOutboundAttemptRequest): Promise<ImOutboundView> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate(request.scope, (current) => {
      const outbound = current.outbounds[request.requestId]
      if (outbound === undefined) throw new ImRuntimeError('IM_OUTBOUND_NOT_FOUND', `IM outbound request '${request.requestId}' is unknown`)
      if (outbound.attempt?.attemptId !== request.attemptId) {
        throw new ImRuntimeError('IM_OUTBOUND_ATTEMPT_MISMATCH', `IM outbound request '${request.requestId}' does not own attempt '${request.attemptId}'`)
      }
      if (outbound.status === request.status && outbound.externalMessageId === request.externalMessageId && JSON.stringify(outbound.receipt) === JSON.stringify(request.receipt)) {
        return { aggregate: current, value: outbound, changed: false }
      }
      if (outbound.status !== 'dispatching' && outbound.status !== 'result-unknown') {
        throw new ImRuntimeError('IM_OUTBOUND_STATE_INVALID', `IM outbound request '${request.requestId}' cannot settle from '${outbound.status}'`)
      }
      const updated: ImOutboundView = {
        ...outbound,
        status: request.status,
        ...(request.receipt === undefined ? {} : { receipt: request.receipt }),
        ...(request.externalMessageId === undefined ? {} : { externalMessageId: request.externalMessageId }),
        updatedAt: timestamp(),
      }
      return { aggregate: { ...current, outbounds: { ...current.outbounds, [request.requestId]: updated } }, value: updated, changed: true }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'outbound', requestId: request.requestId })
      return result.value
    })
  }

  settleSimulationOutbound(request: ImSettleSimulationOutboundRequest): Promise<ImOutboundView> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate(request.scope, (current) => {
      const outbound = current.outbounds[request.requestId]
      if (outbound === undefined) throw new ImRuntimeError('IM_OUTBOUND_NOT_FOUND', `IM outbound request '${request.requestId}' is unknown`)
      if (outbound.status === 'sent') return { aggregate: current, value: outbound, changed: false }
      if (outbound.status !== 'pending') throw new ImRuntimeError('IM_OUTBOUND_STATE_INVALID', `simulation outbound request '${request.requestId}' cannot settle from '${outbound.status}'`)
      const updated: ImOutboundView = { ...outbound, status: 'sent', receipt: { providerStatus: 'simulation', observedAt: timestamp() }, updatedAt: timestamp() }
      return { aggregate: { ...current, outbounds: { ...current.outbounds, [request.requestId]: updated } }, value: updated, changed: true }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'outbound', requestId: request.requestId })
      return result.value
    })
  }

  getOutbound(request: ImGetOutboundRequest): ImOutboundView | undefined {
    return this.lookup(request.scope)?.outbounds[request.requestId]
  }

  queryOutbound(request: ImOutboundQueryRequest): ImOutboundPage {
    assertLimit(request.limit)
    const aggregate = this.lookup(request.scope)
    if (aggregate === undefined) return { items: [], hasMore: false }
    const before = request.beforeSequenceNumber ?? Number.POSITIVE_INFINITY
    const candidates = Object.values(aggregate.outbounds)
      .filter(outbound => outbound.sequenceNumber < before)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    const offset = Math.max(0, candidates.length - request.limit)
    const items = candidates.slice(offset)
    return { items, hasMore: offset > 0, ...(offset > 0 && items[0] !== undefined ? { nextBeforeSequenceNumber: items[0].sequenceNumber } : {}) }
  }

  cancelPendingAi(request: ImCancelPendingAiRequest): Promise<readonly ImOutboundView[]> {
    const scopeId = encodeImScopeId(request.scope)
    return this.mutate(request.scope, (current) => {
      const updatedAt = timestamp()
      const cancelled: ImOutboundView[] = []
      const outbounds = Object.fromEntries(Object.entries(current.outbounds).map(([id, outbound]) => {
        if (outbound.intent !== 'ai' || outbound.status !== 'pending') return [id, outbound]
        const updated: ImOutboundView = { ...outbound, status: 'pre-send-failed', preSendFailureReason: request.reason, updatedAt }
        cancelled.push(updated)
        return [id, updated]
      }))
      return { aggregate: cancelled.length === 0 ? current : { ...current, outbounds }, value: cancelled, changed: cancelled.length > 0 }
    }).then(result => {
      if (result.changed) this.host.publish({ scope: request.scope, scopeId, kind: 'outbound' })
      return result.value
    })
  }

  findSentOutbound(scope: ImRealDeliveryScope, externalMessageId: string): ImOutboundView | undefined {
    return Object.values(this.lookup(scope)?.outbounds ?? {}).find(outbound => outbound.status === 'sent'
      && (outbound.externalMessageId === externalMessageId || outbound.receipt?.providerReceiptId === externalMessageId))
  }

  private registrationPolicy(request: ImRegisterOutboundRequest, frozenBinding?: ImOutboundRouteBinding): { readonly binding?: ImOutboundView['routeBinding']; readonly reason?: NonNullable<ImOutboundView['preSendFailureReason']> } {
    const account = this.host.inspectAccount(request.scope.accountId)
    if (account === undefined) return { reason: 'account-not-found' }
    if (account.platform !== request.scope.platform) return { reason: 'platform-mismatch' }
    if (request.scope.kind === 'simulation' || request.intent === 'human-manual') return {}
    if (account.paused) return { reason: 'account-paused' }
    const resolution = this.host.resolveRoute(request.scope)
    if (frozenBinding !== undefined) {
      const unchanged = resolution?.state === 'matched'
        && account.revision === frozenBinding.accountRevision
        && resolution.route.id === frozenBinding.routeId
        && resolution.route.revision === frozenBinding.routeRevision
        && resolution.route.workspaceId === frozenBinding.workspaceId
      return unchanged ? { binding: frozenBinding } : { binding: frozenBinding, reason: 'route-changed' }
    }
    if (resolution?.state === 'matched') return { binding: { routeId: resolution.route.id, routeRevision: resolution.route.revision, workspaceId: resolution.route.workspaceId, accountRevision: account.revision } }
    if (resolution?.state === 'disabled') return { reason: 'route-disabled' }
    return { reason: 'route-unmatched' }
  }

  private dispatchFailure(scope: ImRealDeliveryScope, outbound: ImOutboundView): NonNullable<ImOutboundView['preSendFailureReason']> | undefined {
    const account = this.host.inspectAccount(scope.accountId)
    if (account === undefined) return 'account-not-found'
    if (account.platform !== scope.platform) return 'platform-mismatch'
    if (outbound.intent === 'human-manual') return undefined
    if (account.paused) return 'account-paused'
    const resolution = this.host.resolveRoute(scope)
    if (resolution?.state !== 'matched' || outbound.routeBinding === undefined) return 'route-changed'
    const binding = outbound.routeBinding
    return account.revision === binding.accountRevision && resolution.route.id === binding.routeId && resolution.route.revision === binding.routeRevision && resolution.route.workspaceId === binding.workspaceId
      ? undefined
      : 'route-changed'
  }

  private assertRealScope(scope: ImRealDeliveryScope): void {
    if (scope.conversationId.trim() === '') throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'IM conversationId must be non-empty')
    const account = this.host.inspectAccount(scope.accountId)
    if (account === undefined) throw new ImRuntimeError('IM_ACCOUNT_NOT_FOUND', `IM account '${scope.accountId}' is unknown`)
    if (account.platform !== scope.platform) throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'IM delivery scope platform does not match its account')
  }

  private lookup(scope: ImDeliveryScope): ImDeliveryAggregate | undefined {
    const aggregate = this.table.get(encodeImScopeId(scope))
    if (aggregate !== undefined && !sameScope(aggregate.scope, scope)) throw new Error('IM scope hash collision')
    return aggregate
  }

  private require(scopeId: ImScopeId): ImDeliveryAggregate {
    const aggregate = this.table.get(scopeId)
    if (aggregate === undefined) throw new Error(`IM delivery scope '${scopeId}' disappeared during a serialized mutation`)
    return aggregate
  }

  private mutate<T>(scope: ImDeliveryScope, fn: (current: ImDeliveryAggregate) => Mutation<T>): Promise<Mutation<T>> {
    const scopeId = encodeImScopeId(scope)
    return this.enqueue(scopeId, async () => {
      const current = this.lookup(scope) ?? initialAggregate(scope)
      const result = fn(current)
      if (result.changed) await this.table.put(scopeId, result.aggregate)
      return result
    })
  }

  private enqueue<T>(scopeId: ImScopeId, job: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(scopeId) ?? Promise.resolve()
    const result = prior.then(job)
    const tail = settled(result)
    this.tails.set(scopeId, tail)
    void tail.finally(() => { if (this.tails.get(scopeId) === tail) this.tails.delete(scopeId) })
    return result
  }

  private enqueueCursor<T>(id: ImProviderCursorId, job: () => Promise<T>): Promise<T> {
    const prior = this.cursorTails.get(id) ?? Promise.resolve()
    const result = prior.then(job)
    const tail = settled(result)
    this.cursorTails.set(id, tail)
    void tail.finally(() => { if (this.cursorTails.get(id) === tail) this.cursorTails.delete(id) })
    return result
  }
}
