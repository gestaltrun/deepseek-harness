import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImRuntime, {
  type ImAccountId,
  type ImDeliveryOperationId,
  type ImMessageId,
  type ImOperationId,
  type ImOutboundRequestId,
  type ImRealDeliveryScope,
  type ImSimulationDeliveryScope,
  type ImSimulationInstanceId,
  type ImTransport,
} from '../src/index.ts'

vi.mock('@deepseek-ai/node-addon-system/flock', () => ({ tryLockExclusive: async () => {} }))

const roots: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const deliveryOperation = (value: string): ImDeliveryOperationId => brandString<ImDeliveryOperationId>(value)
const operation = (value: string): ImOperationId => brandString<ImOperationId>(value)
const outboundRequest = (value: string): ImOutboundRequestId => brandString<ImOutboundRequestId>(value)

function transport(): ImTransport {
  return {
    platform: 'wangwang',
    listAccountCandidates: async () => [{ platform: 'wangwang', candidateId: 'merchant-1', displayName: 'Merchant', merchantId: 'merchant-1' }],
    prepareAccount: async request => {
      if (request.platform !== 'wangwang') throw new Error('wrong fixture platform')
      return {
        displayName: 'Merchant',
        identity: { platform: 'wangwang', merchantId: request.candidateId, displayName: 'Merchant' },
        authorization: { state: 'unchecked' },
        credentialRecord: { kind: 'grant', payload: { accessKeyId: request.accessKeyId, accessKeySecret: request.accessKeySecret } },
      }
    },
    discoverConversations: async () => ({ items: [] }),
    listen: async () => async () => {},
    send: async () => ({ state: 'unknown' }),
    confirm: async () => ({ state: 'unknown' }),
  }
}

function provider(ctx: Context): void { ctx.imTransports.register(transport()) }
provider.inject = ['imTransports']

async function boot(directory?: string, withSessions = false) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'dsh-im-delivery-'))
  if (directory === undefined) directories.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  if (withSessions) await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(ImRuntime)
  await ctx.plugin(provider)
  return { ctx, root }
}

async function configured(ctx: Context) {
  const account = await ctx.imRuntime.addAccount({ platform: 'wangwang', candidateId: 'merchant-1', accessKeyId: 'key', accessKeySecret: 'secret' })
  const route = (await ctx.imRuntime.createRoute({
    operationId: operation('route'), accountId: account.id, conversationKind: 'direct',
    target: { kind: 'specific', conversationId: 'buyer-1' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
  })).route!
  const scope: ImRealDeliveryScope = {
    kind: 'real', platform: 'wangwang', accountId: account.id,
    conversationKind: 'direct', conversationId: 'buyer-1',
  }
  return { account, route, scope }
}

const external = (id: string, occurredAt: string) => ({
  externalMessageId: id,
  sender: { kind: 'external' as const, senderId: `sender-${id}`, senderDisplayName: 'Buyer' },
  content: { text: `message-${id}`, format: 'text' as const },
  occurredAt,
})

describe('inbound delivery', () => {
  it('commits a whole page, orders it, and deduplicates concurrent or repeated provider input', async () => {
    const { ctx } = await boot()
    const { scope } = await configured(ctx)
    const first = await ctx.imRuntime.ingestInboundPage({
      operationId: deliveryOperation('page-1'), scope, observedCursor: null, nextCursor: 'cursor-1',
      messages: [external('later', '2026-09-14T02:00:00.000Z'), external('earlier', '2026-09-14T01:00:00.000Z')],
    })
    expect(first).toMatchObject({ status: 'applied', acceptedCount: 2, duplicateCount: 0, cursor: { platformCursor: 'cursor-1', lastReceivedSequenceNumber: 2, pendingCount: 2 } })
    expect(first.messages.map(message => [message.externalMessageId, message.sequenceNumber])).toEqual([['earlier', 1], ['later', 2]])

    const repeated = await Promise.all([
      ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('page-2a'), scope, observedCursor: 'cursor-1', nextCursor: 'cursor-2', messages: [external('third', '2026-09-14T03:00:00.000Z')] }),
      ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('page-2b'), scope, observedCursor: 'cursor-1', nextCursor: 'cursor-2', messages: [external('third', '2026-09-14T03:00:00.000Z')] }),
    ])
    expect(repeated.map(result => result.status).sort()).toEqual(['applied', 'conflict'])
    expect(ctx.imRuntime.getConversationCursor(scope)).toMatchObject({ lastReceivedSequenceNumber: 3, pendingCount: 3, platformCursor: 'cursor-2' })
    expect(ctx.imRuntime.queryHistory({ scope, limit: 10 }).items).toHaveLength(3)
  })

  it('keeps page receipts, deduplication, and cursors across restart', async () => {
    const first = await boot()
    const { account, scope } = await configured(first.ctx)
    const result = await first.ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('durable-page'), scope, observedCursor: null, nextCursor: 'cursor-1', messages: [external('one', '2026-09-14T01:00:00.000Z')] })
    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)

    const second = await boot(first.root)
    expect(second.ctx.imRuntime.queryInboundOperation(scope, deliveryOperation('durable-page'))).toEqual({ state: 'known', result })
    expect(second.ctx.imRuntime.queryInboundOperation(scope, deliveryOperation('missing'))).toEqual({ state: 'not-found' })
    const replay = await second.ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('replay'), scope, observedCursor: 'cursor-1', nextCursor: 'cursor-1', messages: [external('one', '2026-09-14T01:00:00.000Z')] })
    expect(replay).toMatchObject({ status: 'applied', acceptedCount: 0, duplicateCount: 1 })
    expect(second.ctx.imRuntime.snapshot().accounts[0]?.id).toBe(account.id)
  })

  it('advances an account feed cursor only after every conversation page receipt is durable', async () => {
    const { ctx } = await boot()
    const { account, scope } = await configured(ctx)
    const otherScope: ImRealDeliveryScope = { ...scope, conversationId: 'buyer-2' }
    const firstPage = deliveryOperation('merchant-page-buyer-1')
    const secondPage = deliveryOperation('merchant-page-buyer-2')
    await ctx.imRuntime.ingestInboundPage({ operationId: firstPage, scope, observedCursor: null, nextCursor: null, messages: [external('one', '2026-09-14T01:00:00.000Z')] })
    const owner = { platform: 'wangwang' as const, accountId: account.id, streamId: 'merchant-inbox' }
    const missing = await ctx.imRuntime.commitProviderCursor({
      operationId: deliveryOperation('cursor-missing-page'), owner, observedCursor: null, nextCursor: 'merchant-cursor-1',
      pages: [{ scope, operationId: firstPage }, { scope: otherScope, operationId: secondPage }],
    })
    expect(missing).toMatchObject({ status: 'rejected', code: 'IM_PROVIDER_PAGE_NOT_DURABLE', cursor: { cursor: null } })

    await ctx.imRuntime.ingestInboundPage({ operationId: secondPage, scope: otherScope, observedCursor: null, nextCursor: null, messages: [external('two', '2026-09-14T02:00:00.000Z')] })
    const applied = await ctx.imRuntime.commitProviderCursor({
      operationId: deliveryOperation('cursor-applied'), owner, observedCursor: null, nextCursor: 'merchant-cursor-1',
      pages: [{ scope, operationId: firstPage }, { scope: otherScope, operationId: secondPage }],
    })
    expect(applied).toMatchObject({ status: 'applied', cursor: { cursor: 'merchant-cursor-1' } })
    expect(ctx.imRuntime.queryProviderCursorOperation(owner, deliveryOperation('cursor-applied'))).toEqual({ state: 'known', result: applied })
    await expect(ctx.imRuntime.commitProviderCursor({
      operationId: deliveryOperation('cursor-stale'), owner, observedCursor: null, nextCursor: 'merchant-cursor-2', pages: [],
    })).resolves.toMatchObject({ status: 'conflict', cursor: { cursor: 'merchant-cursor-1' } })
  })

  it('imports JSONL for query only and paginates without admitting imported rows', async () => {
    const { ctx } = await boot()
    const { scope } = await configured(ctx)
    await ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('live'), scope, observedCursor: null, nextCursor: null, messages: [external('live', '2026-09-14T03:00:00.000Z')] })
    const jsonl = [
      external('import-1', '2026-09-14T01:00:00.000Z'),
      external('import-2', '2026-09-14T02:00:00.000Z'),
      external('live', '2026-09-14T03:00:00.000Z'),
    ].map(value => JSON.stringify(value)).join('\n')
    await expect(ctx.imRuntime.importJsonlHistory({ operationId: deliveryOperation('import'), scope, jsonl }))
      .resolves.toMatchObject({ importedCount: 2, duplicateCount: 1 })
    expect(ctx.imRuntime.pendingInbound({ scope, limit: 10 })).toHaveLength(1)
    const latest = ctx.imRuntime.queryHistory({ scope, limit: 2 })
    expect(latest.items.map(item => item.externalMessageId)).toEqual(['import-1', 'import-2'])
    expect(latest.hasMore).toBe(true)
    expect(ctx.imRuntime.queryHistory({ scope, limit: 10, origins: ['jsonl-import'] }).items).toHaveLength(2)
  })

  it('marks only stored live messages and exposes a stable Session source for crash reconciliation', async () => {
    const { ctx } = await boot()
    const { scope } = await configured(ctx)
    const page = await ctx.imRuntime.ingestInboundPage({ operationId: deliveryOperation('submit'), scope, observedCursor: null, nextCursor: null, messages: [external('one', '2026-09-14T01:00:00.000Z'), external('two', '2026-09-14T02:00:00.000Z')] })
    const [one, two] = page.messages as readonly [typeof page.messages[number], typeof page.messages[number]]
    expect(ctx.imRuntime.messageSource(scope, one.messageId)).toEqual({ kind: 'im', scopeId: one.scopeId, messageId: one.messageId, sequenceNumber: 1 })

    const sessionId = SessionId('session-im')
    const secondOnly = await ctx.imRuntime.markSubmitted({ scope, messageIds: [two.messageId], sessionId })
    expect(secondOnly.cursor).toMatchObject({ lastSubmittedSequenceNumber: 0, pendingCount: 1 })
    const completed = await ctx.imRuntime.markSubmitted({ scope, messageIds: [one.messageId], sessionId })
    expect(completed.cursor).toMatchObject({ lastSubmittedSequenceNumber: 2, pendingCount: 0 })
    await expect(ctx.imRuntime.markSubmitted({ scope, messageIds: [one.messageId], sessionId: SessionId('different-session') }))
      .rejects.toMatchObject({ code: 'IM_MESSAGE_ALREADY_SUBMITTED' })
    expect(() => ctx.imRuntime.messageSource(scope, brandString<ImMessageId>('missing')))
      .toThrowError(/unknown/)
  })

  it('reconciles a durable user/message after both domains restart', async () => {
    const first = await boot(undefined, true)
    const { scope } = await configured(first.ctx)
    const page = await first.ctx.imRuntime.ingestInboundPage({
      operationId: deliveryOperation('session-crash-window'), scope, observedCursor: null, nextCursor: null,
      messages: [external('session-message', '2026-09-14T01:00:00.000Z')],
    })
    const inbound = page.messages[0]!
    const session = Session.create(SessionId('session-im-durable'))
    const userMessage = first.ctx.imRuntime.sessionUserMessage(scope, inbound.messageId)
    session.append('user/message', userMessage, { surfaceOp: 'append' })
    const writer = await first.ctx.sessionPersistence.create(session.header)
    await writer.append(session.snapshotEvents())
    await writer.flush()
    await writer.close()
    expect(first.ctx.imRuntime.pendingInbound({ scope, limit: 10 })).toHaveLength(1)

    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)
    const second = await boot(first.root, true)
    const reader = await second.ctx.sessionPersistence.open(session.id, 'read')
    const persisted = (await reader.read()).events
    await reader.close()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.type === 'user/message' && persisted[0].data).toMatchObject({
      id: userMessage.id,
      source: { kind: 'im', scopeId: inbound.scopeId, messageId: inbound.messageId, sequenceNumber: inbound.sequenceNumber },
    })
    await expect(second.ctx.imRuntime.reconcileSession(session.id)).resolves.toEqual({
      sessionId: session.id, submittedMessageIds: [inbound.messageId], ignoredEvidenceCount: 0,
    })
    expect(second.ctx.imRuntime.pendingInbound({ scope, limit: 10 })).toEqual([])
    await expect(second.ctx.imRuntime.reconcileSession(session.id)).resolves.toEqual({
      sessionId: session.id, submittedMessageIds: [], ignoredEvidenceCount: 0,
    })
  })
})

describe('outbound delivery', () => {
  it('persists intent before one attempt and never starts a second attempt after an unknown result', async () => {
    const { ctx } = await boot()
    const { scope, route } = await configured(ctx)
    const requestId = outboundRequest('ai-1')
    const registered = await ctx.imRuntime.registerOutbound({ requestId, scope, intent: 'ai', content: { text: 'reply', format: 'text' } })
    expect(registered).toMatchObject({ status: 'pending', routeBinding: { routeId: route.id, routeRevision: route.revision } })
    const begun = await ctx.imRuntime.beginOutboundAttempt({ scope, requestId })
    expect(begun.state).toBe('ready')
    if (begun.state !== 'ready') throw new Error('fixture did not begin an attempt')
    const uncertain = await ctx.imRuntime.settleOutboundAttempt({ scope, requestId, attemptId: begun.attemptId, status: 'result-unknown', receipt: { providerStatus: 'timeout', observedAt: '2026-09-14T04:00:00.000Z' } })
    expect(uncertain.status).toBe('result-unknown')
    await expect(ctx.imRuntime.beginOutboundAttempt({ scope, requestId })).resolves.toMatchObject({ state: 'result-unknown', outbound: { attempt: { attemptId: begun.attemptId } } })
    const confirmed = await ctx.imRuntime.settleOutboundAttempt({ scope, requestId, attemptId: begun.attemptId, status: 'sent', externalMessageId: 'platform-message', receipt: { providerReceiptId: 'receipt-1', observedAt: '2026-09-14T04:01:00.000Z' } })
    expect(confirmed.status).toBe('sent')
    expect(ctx.imRuntime.findSentOutbound(scope, 'platform-message')?.requestId).toBe(requestId)
  })

  it('turns an interrupted dispatch into result-unknown on restart', async () => {
    const first = await boot()
    const { scope } = await configured(first.ctx)
    const requestId = outboundRequest('crash-window')
    await first.ctx.imRuntime.registerOutbound({ requestId, scope, intent: 'human-manual', content: { text: 'manual', format: 'text' } })
    const begun = await first.ctx.imRuntime.beginOutboundAttempt({ scope, requestId })
    expect(begun.state).toBe('ready')
    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)

    const second = await boot(first.root)
    expect(second.ctx.imRuntime.getOutbound({ scope, requestId })).toMatchObject({ status: 'result-unknown' })
    await expect(second.ctx.imRuntime.beginOutboundAttempt({ scope, requestId })).resolves.toMatchObject({ state: 'result-unknown' })
  })

  it('blocks stale automated sends while preserving manual and simulation sends', async () => {
    const { ctx } = await boot()
    const { account, scope, route } = await configured(ctx)
    const ai = outboundRequest('ai-stale')
    await ctx.imRuntime.registerOutbound({ requestId: ai, scope, intent: 'ai', content: { text: 'automated', format: 'text' } })
    await ctx.imRuntime.saveRoute({ operationId: operation('disable'), accountId: account.id, routeId: route.id, observedRevision: route.revision, enabled: false })
    await expect(ctx.imRuntime.beginOutboundAttempt({ scope, requestId: ai })).resolves.toMatchObject({ state: 'blocked', outbound: { status: 'pre-send-failed', preSendFailureReason: 'route-changed' } })

    const manual = outboundRequest('manual-disabled')
    await ctx.imRuntime.registerOutbound({ requestId: manual, scope, intent: 'human-manual', content: { text: 'manual', format: 'text' } })
    await expect(ctx.imRuntime.beginOutboundAttempt({ scope, requestId: manual })).resolves.toMatchObject({ state: 'ready' })

    const simulation: ImSimulationDeliveryScope = {
      kind: 'simulation', instanceId: brandString<ImSimulationInstanceId>('simulation-1'),
      platform: 'wangwang', accountId: account.id, conversationKind: 'direct', conversationId: 'buyer-1',
    }
    const simulated = outboundRequest('simulation')
    await ctx.imRuntime.registerOutbound({ requestId: simulated, scope: simulation, intent: 'ai', content: { text: 'local', format: 'text' } })
    await expect(ctx.imRuntime.settleSimulationOutbound({ scope: simulation, requestId: simulated })).resolves.toMatchObject({ status: 'sent' })
  })

  it('does not flush an automated intent created before an account pause cycle', async () => {
    const { ctx } = await boot()
    const { account, scope } = await configured(ctx)
    const requestId = outboundRequest('before-pause')
    await ctx.imRuntime.registerOutbound({ requestId, scope, intent: 'ai', content: { text: 'stale', format: 'text' } })
    const paused = await ctx.imRuntime.setAccountPaused({
      operationId: operation('pause-account'), accountId: account.id, observedRevision: account.revision, paused: true,
    })
    await ctx.imRuntime.setAccountPaused({
      operationId: operation('resume-account'), accountId: account.id, observedRevision: paused.account.revision, paused: false,
    })
    await expect(ctx.imRuntime.beginOutboundAttempt({ scope, requestId })).resolves.toMatchObject({
      state: 'blocked', outbound: { status: 'pre-send-failed', preSendFailureReason: 'route-changed' },
    })
  })

  it('cancels only pending AI intents and does not restore them when a route is enabled again', async () => {
    const { ctx } = await boot()
    const { scope } = await configured(ctx)
    const ai = outboundRequest('cancel-ai')
    const manual = outboundRequest('keep-manual')
    await ctx.imRuntime.registerOutbound({ requestId: ai, scope, intent: 'ai', content: { text: 'ai', format: 'text' } })
    await ctx.imRuntime.registerOutbound({ requestId: manual, scope, intent: 'human-manual', content: { text: 'manual', format: 'text' } })
    const cancelled = await ctx.imRuntime.cancelPendingAi({ scope, reason: 'cancelled' })
    expect(cancelled.map(item => item.requestId)).toEqual([ai])
    expect(ctx.imRuntime.getOutbound({ scope, requestId: ai })?.status).toBe('pre-send-failed')
    expect(ctx.imRuntime.getOutbound({ scope, requestId: manual })?.status).toBe('pending')
  })
})
