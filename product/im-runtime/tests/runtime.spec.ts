import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ImRuntime, {
  type ImAccountId,
  type ImOperationId,
  type ImRevision,
  type ImRouteId,
  type ImTransport,
  type ImTransportListenPlan,
  type ImTransportSink,
  type ImRuntimeConfig,
} from '../src/index.ts'

const roots: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function operation(value: string): ImOperationId { return brandString<ImOperationId>(value) }

function fixtureTransport(onListen?: (sink: ImTransportSink) => void, onDispose?: () => void): ImTransport {
  return {
    platform: 'wangwang',
    listAccountCandidates: async () => [{ platform: 'wangwang', candidateId: 'merchant-1', endpoint: 'https://wangwang.invalid', displayName: 'Fixture merchant', merchantId: 'merchant-1' }],
    prepareAccount: async request => {
      if (request.platform !== 'wangwang') throw new Error('wrong fixture platform')
      return {
        displayName: request.displayName ?? 'Fixture merchant',
        identity: { platform: 'wangwang', merchantId: request.candidateId, displayName: 'Fixture merchant' },
        authorization: { state: 'unchecked' },
        credentialRecord: { kind: 'grant', payload: { accessKeyId: request.accessKeyId, accessKeySecret: request.accessKeySecret } },
      }
    },
    inspectAccount: async () => ({ authorization: { state: 'unchecked' } }),
    refreshAccount: async () => ({ authorization: { state: 'unchecked' } }),
    discoverConversations: async () => ({ items: [] }),
    listen: async (_account, _plan, sink) => {
      onListen?.(sink)
      const done = Promise.withResolvers<void>()
      return { done: done.promise, dispose: async () => { onDispose?.(); done.resolve() } }
    },
    send: async () => ({ state: 'unknown' }),
    confirm: async () => ({ state: 'unknown' }),
  }
}

async function boot(directory?: string, transport = fixtureTransport(), config: ImRuntimeConfig = {}) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'dsh-im-runtime-'))
  if (directory === undefined) directories.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(ImRuntime, config)
  function fixtureProvider(ctx: Context): void { ctx.imTransports.register(transport) }
  fixtureProvider.inject = ['imTransports']
  const provider = ctx.plugin(fixtureProvider)
  await provider
  return { ctx, root }
}

async function addAccount(ctx: Context) {
  return ctx.imRuntime.addAccount({
    platform: 'wangwang',
    candidateId: 'merchant-1',
    endpoint: 'https://wangwang.invalid',
    accessKeyId: 'key-id',
    accessKeySecret: 'secret-value',
  })
}

const setupRequest = {
  platform: 'wangwang' as const,
  candidateId: 'merchant-1',
  endpoint: 'https://wangwang.invalid',
  accessKeyId: 'key-id',
  accessKeySecret: 'secret-value',
}

describe('ImRuntime configuration', () => {
  it('previews a verified identity without persistence and confirms it idempotently across restart', async () => {
    const first = await boot()
    const preview = await first.ctx.imRuntime.previewAccountSetup(setupRequest)
    expect(preview).toMatchObject({
      setupId: expect.stringMatching(/^account-setup-/u),
      displayName: 'Fixture merchant',
      identity: { platform: 'wangwang', merchantId: 'merchant-1' },
      authorization: { state: 'unchecked' },
    })
    expect(JSON.stringify(preview)).not.toContain('secret-value')
    expect(first.ctx.imRuntime.snapshot().accounts).toEqual([])
    expect(await first.ctx.credentials.listRecords()).toEqual([])

    const request = { setupId: preview.setupId, operationId: operation('confirm-setup') }
    const confirmed = await first.ctx.imRuntime.confirmAccountSetup(request)
    expect(confirmed).toMatchObject({ status: 'applied', account: { identity: preview.identity } })
    await expect(first.ctx.imRuntime.confirmAccountSetup(request)).resolves.toMatchObject({ account: { id: confirmed.account.id } })
    expect(first.ctx.imRuntime.snapshot().accounts).toHaveLength(1)
    expect(first.ctx.imRuntime.queryAccountOperation(confirmed.account.id, request.operationId)).toMatchObject({
      state: 'known', result: { status: 'applied', account: { id: confirmed.account.id } },
    })

    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)
    const second = await boot(first.root)
    await expect(second.ctx.imRuntime.confirmAccountSetup(request)).resolves.toMatchObject({ account: { id: confirmed.account.id } })
    expect(second.ctx.imRuntime.snapshot().accounts).toHaveLength(1)
  })

  it('rejects an unadmitted endpoint and releases cancelled, aborted, and expired setup material', async () => {
    let prepareCalls = 0
    const fixture = fixtureTransport()
    const { ctx } = await boot(undefined, {
      ...fixture,
      prepareAccount: async (...args) => { prepareCalls++; return fixture.prepareAccount(...args) },
    }, { accountSetupTtlMs: 50 })
    await expect(ctx.imRuntime.previewAccountSetup({ ...setupRequest, endpoint: 'https://other.invalid' }))
      .rejects.toMatchObject({ code: 'IM_IDENTITY_MISMATCH' })
    expect(prepareCalls).toBe(0)

    const cancelled = await ctx.imRuntime.previewAccountSetup(setupRequest)
    expect(ctx.imRuntime.cancelAccountSetup(cancelled.setupId)).toEqual({ state: 'cancelled' })
    await expect(ctx.imRuntime.confirmAccountSetup({ setupId: cancelled.setupId, operationId: operation('cancelled') }))
      .rejects.toMatchObject({ code: 'IM_ACCOUNT_SETUP_NOT_FOUND' })

    const controller = new AbortController()
    controller.abort(new Error('cancelled by caller'))
    await expect(ctx.imRuntime.previewAccountSetup(setupRequest, controller.signal)).rejects.toThrow('cancelled by caller')

    vi.useFakeTimers()
    try {
      const expired = await ctx.imRuntime.previewAccountSetup(setupRequest)
      await vi.advanceTimersByTimeAsync(50)
      await expect(ctx.imRuntime.confirmAccountSetup({ setupId: expired.setupId, operationId: operation('expired') }))
        .rejects.toMatchObject({ code: 'IM_ACCOUNT_SETUP_NOT_FOUND' })
    } finally {
      vi.useRealTimers()
    }
    expect(ctx.imRuntime.snapshot().accounts).toEqual([])
    expect(await ctx.credentials.listRecords()).toEqual([])
  })

  it('passes enabled route and mention-evidence requirements to the provider listener', async () => {
    const plans: ImTransportListenPlan[] = []
    let stops = 0
    const fixture = fixtureTransport()
    const { ctx } = await boot(undefined, {
      ...fixture,
      listen: async (_account, nextPlan) => {
        plans.push(nextPlan)
        const done = Promise.withResolvers<void>()
        return { done: done.promise, dispose: async () => { stops++; done.resolve() } }
      },
    })
    const account = await addAccount(ctx)
    const created = await ctx.imRuntime.createRoute({
      operationId: operation('mention-plan'), accountId: account.id, conversationKind: 'group',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
      groupTrigger: { mention: true, everyN: 5 },
    })
    await expect.poll(() => plans.length).toBe(1)
    expect(plans[0]).toEqual({ routes: [expect.objectContaining({ conversationKind: 'group', target: { kind: 'all' }, needsMentionEvidence: true })] })
    const route = created.route
    if (route === undefined) throw new Error('fixture route was not created')
    await ctx.imRuntime.saveRoute({
      operationId: operation('disable-mention'), accountId: account.id, routeId: route.id,
      observedRevision: route.revision, enabled: true, groupTrigger: { everyN: 5 },
    })
    await expect.poll(() => plans.length).toBe(2)
    expect(stops).toBe(1)
    expect(plans[1]).toEqual({ routes: [expect.objectContaining({ needsMentionEvidence: false })] })
  })

  it('persists every conversation group before committing one provider cursor', async () => {
    let sink: ImTransportSink | undefined
    const { ctx } = await boot(undefined, fixtureTransport(value => { sink = value }))
    const account = await addAccount(ctx)
    await ctx.imRuntime.createRoute({
      operationId: operation('listen-route'), accountId: account.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
    })
    await expect.poll(() => sink).toBeDefined()

    const receipt = await sink!.receivePage({
      operationId: brandString('merchant-page'),
      owner: { platform: 'wangwang', accountId: account.id, streamId: 'merchant-inbox' },
      observedCursor: null,
      nextCursor: 'merchant-cursor-1',
      conversations: [
        {
          operationId: brandString('buyer-a-page'), conversationKind: 'direct', conversationId: 'buyer-a',
          messages: [{
            externalMessageId: 'message-a', senderEvidence: { kind: 'external-actor', senderId: 'buyer-a' },
            text: 'hello', format: 'text', occurredAt: '2026-09-14T01:00:00.000Z', mentionedConfiguredAccount: true,
          }],
        },
        {
          operationId: brandString('buyer-b-page'), conversationKind: 'direct', conversationId: 'buyer-b',
          messages: [{
            externalMessageId: 'message-b', senderEvidence: { kind: 'provider-unknown' },
            text: 'world', format: 'text', occurredAt: '2026-09-14T01:01:00.000Z',
          }],
        },
      ],
    })

    expect(receipt.conversations.map(value => value.acceptedCount)).toEqual([1, 1])
    expect(receipt.cursor).toMatchObject({ status: 'applied', cursor: { cursor: 'merchant-cursor-1' } })
    expect(receipt.conversations[0]?.messages[0]).toMatchObject({
      sender: { kind: 'external', senderId: 'buyer-a' }, mentionedConfiguredAccount: true,
    })
  })

  it('keeps connection intent separate from pause and refreshes provider authorization facts', async () => {
    let starts = 0
    let stops = 0
    const plans: ImTransportListenPlan[] = []
    const listenerStates: string[] = []
    const ready = Promise.withResolvers<void>()
    const fixture = fixtureTransport()
    const base: ImTransport = {
      ...fixture,
      listen: async (_account, plan) => {
        starts++
        plans.push(plan)
        await ready.promise
        const done = Promise.withResolvers<void>()
        return { done: done.promise, dispose: async () => { stops++; done.resolve() } }
      },
    }
    const { ctx } = await boot(undefined, {
      ...base,
      refreshAccount: async () => ({ authorization: { state: 'ready', checkedAt: '2026-09-14T02:00:00.000Z' } }),
    })
    ctx.imRuntime.subscribe((change) => {
      if (change.kind === 'account-listener') {
        const state = ctx.imRuntime.snapshot().accounts[0]?.listener.state
        if (state !== undefined) listenerStates.push(state)
      }
    })
    const account = await addAccount(ctx)
    await ctx.imRuntime.createRoute({
      operationId: operation('lifecycle-route'), accountId: account.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
    })
    await expect.poll(() => starts).toBe(1)
    expect(ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('starting')
    ready.resolve()
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('running')
    expect(plans[0]).toEqual({ routes: [expect.objectContaining({ conversationKind: 'direct', target: { kind: 'all' }, needsMentionEvidence: false })] })

    const disconnected = await ctx.imRuntime.disconnectAccount({
      operationId: operation('disconnect'), accountId: account.id, observedRevision: account.revision,
    })
    expect(disconnected).toMatchObject({ status: 'applied', account: { connectionIntent: 'disconnected', paused: false, listener: { state: 'stopped', reason: 'manual' } } })
    await expect.poll(() => stops).toBe(1)
    const reconnected = await ctx.imRuntime.reconnectAccount({
      operationId: operation('reconnect'), accountId: account.id, observedRevision: disconnected.account.revision,
    })
    await expect.poll(() => starts).toBe(2)
    const refreshed = await ctx.imRuntime.refreshAccount({
      operationId: operation('refresh'), accountId: account.id, observedRevision: reconnected.account.revision,
    })
    expect(refreshed).toMatchObject({ status: 'applied', account: { authorization: { state: 'ready' }, connectionIntent: 'connected' } })
    expect(ctx.imRuntime.queryAccountOperation(account.id, operation('disconnect'))).toMatchObject({
      state: 'known', result: { operationId: operation('disconnect'), status: disconnected.status, account: { revision: disconnected.account.revision, connectionIntent: 'disconnected' } },
    })
    expect(ctx.imRuntime.queryAccountOperation(account.id, operation('reconnect'))).toMatchObject({
      state: 'known', result: { operationId: operation('reconnect'), status: reconnected.status, account: { revision: reconnected.account.revision, connectionIntent: 'connected' } },
    })
    expect(ctx.imRuntime.queryAccountOperation(account.id, operation('refresh'))).toMatchObject({
      state: 'known', result: { operationId: operation('refresh'), status: refreshed.status, account: { revision: refreshed.account.revision, authorization: { state: 'ready' } } },
    })
    expect(ctx.imRuntime.queryAccountOperation(account.id, operation('unknown'))).toEqual({ state: 'not-found' })
    expect(listenerStates).toEqual(expect.arrayContaining(['starting', 'running', 'stopped']))
  })

  it('aborts an intentional stop and waits for listener completion before reconnecting', async () => {
    const listeners: Array<{
      readonly signal: AbortSignal
      readonly done: ReturnType<typeof Promise.withResolvers<void>>
      disposeCalls: number
    }> = []
    const fixture = fixtureTransport()
    const { ctx } = await boot(undefined, {
      ...fixture,
      listen: async (_account, _plan, _sink, signal) => {
        const done = Promise.withResolvers<void>()
        const listener = { signal, done, disposeCalls: 0 }
        listeners.push(listener)
        return { done: done.promise, dispose: async () => { listener.disposeCalls++ } }
      },
    })
    const account = await addAccount(ctx)
    await ctx.imRuntime.createRoute({
      operationId: operation('manual-stop-route'), accountId: account.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
    })
    await expect.poll(() => listeners.length).toBe(1)
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('running')

    const disconnected = await ctx.imRuntime.disconnectAccount({
      operationId: operation('manual-stop'), accountId: account.id, observedRevision: account.revision,
    })
    await ctx.imRuntime.reconnectAccount({
      operationId: operation('manual-reconnect'), accountId: account.id, observedRevision: disconnected.account.revision,
    })
    await expect.poll(() => listeners[0]?.signal.aborted).toBe(true)
    expect(listeners[0]?.disposeCalls).toBe(1)
    expect(listeners).toHaveLength(1)

    listeners[0]?.done.resolve()
    await expect.poll(() => listeners.length).toBe(2)
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('running')
    listeners[1]?.done.resolve()
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener).toEqual({ state: 'stopped', reason: 'disconnected' })
    expect(listeners).toHaveLength(2)
  })

  it('ignores a stopped generation failure and safely reports a current listener failure', async () => {
    const sentinel = 'post-ready-credential-sentinel'
    const listeners: Array<{
      readonly signal: AbortSignal
      readonly done: ReturnType<typeof Promise.withResolvers<void>>
      disposeCalls: number
    }> = []
    const fixture = fixtureTransport()
    const { ctx } = await boot(undefined, {
      ...fixture,
      listen: async (_account, _plan, _sink, signal) => {
        const done = Promise.withResolvers<void>()
        const listener = { signal, done, disposeCalls: 0 }
        listeners.push(listener)
        return { done: done.promise, dispose: async () => { listener.disposeCalls++ } }
      },
    })
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const states: string[] = []
    ctx.imRuntime.subscribe(change => {
      if (change.kind === 'account-listener') {
        const state = ctx.imRuntime.snapshot().accounts[0]?.listener.state
        if (state !== undefined) states.push(state)
      }
    })
    const account = await addAccount(ctx)
    const route = (await ctx.imRuntime.createRoute({
      operationId: operation('generation-route'), accountId: account.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
    })).route
    if (route === undefined) throw new Error('fixture route was not created')
    await expect.poll(() => listeners.length).toBe(1)
    const beforeRestart = states.length
    await ctx.imRuntime.rebindRoute({
      operationId: operation('generation-rebind'), accountId: account.id, routeId: route.id,
      observedRevision: route.revision, observedWorkspaceId: route.workspaceId, workspaceId: WorkspaceId('workspace-b'),
    })
    await expect.poll(() => listeners[0]?.signal.aborted).toBe(true)
    expect(listeners[0]?.disposeCalls).toBe(1)
    listeners[0]?.done.reject(new Error(sentinel))
    await expect.poll(() => listeners.length).toBe(2)
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('running')
    expect(states.slice(beforeRestart)).not.toContain('failed')

    listeners[1]?.done.reject(new Error(sentinel))
    await expect.poll(() => ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('failed')
    expect(listeners).toHaveLength(2)
    expect(JSON.stringify(ctx.imRuntime.snapshot())).not.toContain(sentinel)
    expect(JSON.stringify(states)).not.toContain(sentinel)
    expect(JSON.stringify(warnings)).not.toContain(sentinel)
    expect(warnings).toEqual([
      expect.stringContaining('listener stop failed'),
      expect.stringContaining('listener failed'),
    ])
  })

  it('does not start an unauthorized listener or expose a provider failure', async () => {
    let starts = 0
    const unauthorized = fixtureTransport(() => { starts++ })
    const required = {
      ...unauthorized,
      prepareAccount: async () => ({
        displayName: 'Merchant',
        identity: { platform: 'wangwang' as const, merchantId: 'merchant-1', displayName: 'Merchant' },
        authorization: { state: 'required' as const, reason: 'missing' as const },
      }),
    }
    const first = await boot(undefined, required)
    const account = await addAccount(first.ctx)
    await first.ctx.imRuntime.createRoute({
      operationId: operation('unauthorized-route'), accountId: account.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true,
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(starts).toBe(0)
    expect(first.ctx.imRuntime.snapshot().accounts[0]?.listener).toEqual({ state: 'stopped', reason: 'authorization-required' })

    const sentinel = 'credential-sentinel-do-not-project'
    const failing = fixtureTransport(() => { throw new Error(sentinel) })
    const second = await boot(undefined, failing)
    const warnings: string[] = []
    second.ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof second.ctx.logger.warn
    const changes: unknown[] = []
    second.ctx.imRuntime.subscribe(change => { changes.push(change) })
    const failingAccount = await addAccount(second.ctx)
    await second.ctx.imRuntime.createRoute({
      operationId: operation('failing-route'), accountId: failingAccount.id, conversationKind: 'direct',
      target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-b'), enabled: true,
    })
    await expect.poll(() => second.ctx.imRuntime.snapshot().accounts[0]?.listener.state).toBe('failed')
    expect(JSON.stringify(second.ctx.imRuntime.snapshot())).not.toContain(sentinel)
    expect(JSON.stringify(changes)).not.toContain(sentinel)
    expect(JSON.stringify(warnings)).not.toContain(sentinel)
    expect(warnings).toEqual([expect.stringContaining('listener failed')])
    expect(second.ctx.imRuntime.snapshot().accounts[0]?.listener).toEqual({ state: 'failed', attempts: 1, lastError: 'provider listener failed' })
  })

  it('persists only safe account facts and reloads them from the JSON domain', async () => {
    const first = await boot()
    await expect(first.ctx.imRuntime.listAccountCandidates('wangwang')).resolves.toEqual([
      { platform: 'wangwang', candidateId: 'merchant-1', endpoint: 'https://wangwang.invalid', displayName: 'Fixture merchant', merchantId: 'merchant-1' },
    ])
    const account = await addAccount(first.ctx)
    expect(account).toMatchObject({
      platform: 'wangwang',
      identity: { merchantId: 'merchant-1' },
      authorization: { state: 'unchecked' },
      listener: { state: 'stopped', reason: 'no-enabled-route' },
      paused: false,
    })
    expect(JSON.stringify(first.ctx.imRuntime.snapshot())).not.toContain('secret-value')
    expect(await first.ctx.credentials.readRecord(account.credentialKey!)).toMatchObject({
      kind: 'grant', payload: { accessKeySecret: 'secret-value' },
    })

    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)
    const second = await boot(first.root)
    expect(second.ctx.imRuntime.snapshot().accounts).toEqual([account])
  })

  it('resolves a disabled specific route before an enabled all route and respects account pause', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const workspace = WorkspaceId('workspace-a')
    await ctx.imRuntime.createRoute({ operationId: operation('all'), accountId: account.id, conversationKind: 'group', target: { kind: 'all' }, workspaceId: workspace, enabled: true, groupTrigger: { mention: true, everyN: 5 } })
    const specific = await ctx.imRuntime.createRoute({ operationId: operation('specific'), accountId: account.id, conversationKind: 'group', target: { kind: 'specific', conversationId: 'group-1' }, workspaceId: workspace, enabled: false, groupTrigger: { fixedIntervalSeconds: 60 } })

    expect(ctx.imRuntime.resolveRoute(account.id, 'group', 'group-1')).toEqual({ state: 'disabled', route: specific.route })
    expect(ctx.imRuntime.resolveRoute(account.id, 'group', 'group-2')).toMatchObject({ state: 'matched', route: { target: { kind: 'all' } } })
    await ctx.imRuntime.setAccountPaused({ operationId: operation('pause'), accountId: account.id, observedRevision: account.revision, paused: true })
    expect(ctx.imRuntime.resolveRoute(account.id, 'group', 'group-2')).toEqual({ state: 'account-paused' })
  })

  it('makes concurrent rebinds deterministic, preserves query receipts, and rejects operation reuse', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const created = await ctx.imRuntime.createRoute({ operationId: operation('create'), accountId: account.id, conversationKind: 'direct', target: { kind: 'specific', conversationId: 'buyer-1' }, workspaceId: WorkspaceId('workspace-a'), enabled: true })
    const route = created.route!
    const requests = ['workspace-b', 'workspace-c'].map((workspaceId, index) => ctx.imRuntime.rebindRoute({
      operationId: operation(`rebind-${String(index)}`), accountId: account.id, routeId: route.id,
      observedRevision: route.revision, observedWorkspaceId: route.workspaceId, workspaceId: WorkspaceId(workspaceId),
    }))
    const outcomes = await Promise.all(requests)
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['applied', 'conflict'])
    expect(ctx.imRuntime.queryRouteOperation(account.id, operation('rebind-0')).state).toBe('known')
    expect(ctx.imRuntime.queryRouteOperation(account.id, operation('unknown'))).toEqual({ state: 'not-found' })
    await expect(ctx.imRuntime.saveRoute({ operationId: operation('rebind-0'), accountId: account.id, routeId: route.id, observedRevision: route.revision, enabled: false }))
      .rejects.toMatchObject({ code: 'IM_OPERATION_REUSED' })
  })

  it('mints a fresh route lifecycle after delete and blocks an ABA edit', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const tuple = { accountId: account.id, conversationKind: 'direct' as const, target: { kind: 'specific' as const, conversationId: 'buyer-1' }, workspaceId: WorkspaceId('workspace-a'), enabled: true }
    const first = (await ctx.imRuntime.createRoute({ operationId: operation('create-1'), ...tuple })).route!
    await ctx.imRuntime.deleteRoute({ operationId: operation('delete-1'), accountId: account.id, routeId: first.id, observedRevision: first.revision, observedWorkspaceId: first.workspaceId })
    const second = (await ctx.imRuntime.createRoute({ operationId: operation('create-2'), ...tuple })).route!
    expect(second.id).not.toBe(first.id)
    expect(second.revision).not.toBe(first.revision)
    const stale = await ctx.imRuntime.saveRoute({ operationId: operation('stale'), accountId: account.id, routeId: first.id, observedRevision: first.revision, enabled: false })
    expect(stale).toMatchObject({ status: 'rejected', code: 'IM_ROUTE_NOT_FOUND' })
  })

  it('CAS-configures and removes a simulation target with durable operation lookup', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const route = (await ctx.imRuntime.createRoute({ operationId: operation('route'), accountId: account.id, conversationKind: 'group', target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true, groupTrigger: { mention: true } })).route!
    const saved = await ctx.imRuntime.saveSimulationTarget({ operationId: operation('target-save'), workspaceId: WorkspaceId('sim-workspace'), observedRevision: null, accountId: account.id, routeId: route.id })
    expect(saved).toMatchObject({ status: 'applied', target: { routeId: route.id } })
    const conflict = await ctx.imRuntime.saveSimulationTarget({ operationId: operation('target-conflict'), workspaceId: WorkspaceId('sim-workspace'), observedRevision: brandString<ImRevision>('stale'), accountId: account.id, routeId: route.id })
    expect(conflict.status).toBe('conflict')
    expect(ctx.imRuntime.querySimulationTargetOperation(WorkspaceId('sim-workspace'), operation('target-save')).state).toBe('known')
    const removed = await ctx.imRuntime.removeSimulationTarget({ operationId: operation('target-remove'), workspaceId: WorkspaceId('sim-workspace'), observedRevision: saved.target!.revision })
    expect(removed.status).toBe('applied')
    expect(ctx.imRuntime.snapshot().simulationTargets).toEqual([])
  })

  it('retains route and simulation operation receipts across a runtime restart', async () => {
    const first = await boot()
    const account = await addAccount(first.ctx)
    const routeResult = await first.ctx.imRuntime.createRoute({ operationId: operation('durable-route'), accountId: account.id, conversationKind: 'direct', target: { kind: 'specific', conversationId: 'buyer-durable' }, workspaceId: WorkspaceId('workspace-a'), enabled: true })
    const route = routeResult.route!
    const targetResult = await first.ctx.imRuntime.saveSimulationTarget({ operationId: operation('durable-target'), workspaceId: WorkspaceId('sim-workspace'), observedRevision: null, accountId: account.id, routeId: route.id })
    const paused = await first.ctx.imRuntime.setAccountPaused({ operationId: operation('durable-pause'), accountId: account.id, observedRevision: account.revision, paused: true })
    const disconnected = await first.ctx.imRuntime.disconnectAccount({ operationId: operation('durable-disconnect'), accountId: account.id, observedRevision: paused.account.revision })
    const reconnected = await first.ctx.imRuntime.reconnectAccount({ operationId: operation('durable-reconnect'), accountId: account.id, observedRevision: disconnected.account.revision })
    const refreshed = await first.ctx.imRuntime.refreshAccount({ operationId: operation('durable-refresh'), accountId: account.id, observedRevision: reconnected.account.revision })

    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)
    const second = await boot(first.root)
    expect(second.ctx.imRuntime.queryRouteOperation(account.id, operation('durable-route'))).toEqual({ state: 'known', result: routeResult })
    expect(second.ctx.imRuntime.querySimulationTargetOperation(WorkspaceId('sim-workspace'), operation('durable-target'))).toEqual({ state: 'known', result: targetResult })
    for (const result of [paused, disconnected, reconnected, refreshed]) {
      expect(second.ctx.imRuntime.queryAccountOperation(account.id, result.operationId)).toMatchObject({
        state: 'known', result: { operationId: result.operationId, status: result.status, account: { revision: result.account.revision } },
      })
    }
    expect(second.ctx.imRuntime.snapshot()).toMatchObject({ routes: [route], simulationTargets: [targetResult.target] })
  })

  it('publishes each new durable operation once and replays the same operation idempotently', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const changes: Array<{ readonly revision: number; readonly operationId?: ImOperationId }> = []
    const unsubscribe = ctx.imRuntime.subscribe(change => { changes.push(change) })
    const request = { operationId: operation('once'), accountId: account.id, conversationKind: 'direct' as const, target: { kind: 'specific' as const, conversationId: 'buyer-once' }, workspaceId: WorkspaceId('workspace-a'), enabled: true }
    const first = await ctx.imRuntime.createRoute(request)
    const replay = await ctx.imRuntime.createRoute(request)
    unsubscribe()
    await ctx.imRuntime.saveRoute({ operationId: operation('after-unsubscribe'), accountId: account.id, routeId: first.route!.id, observedRevision: first.route!.revision, enabled: false })

    expect(replay).toEqual(first)
    const operationChanges = changes.filter(change => change.operationId !== undefined)
    expect(operationChanges).toHaveLength(1)
    expect(operationChanges[0]).toMatchObject({ operationId: operation('once'), kind: 'route' })
  })

  it('stores invalid and duplicate route outcomes and serializes concurrent tuple creation', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const invalid = await ctx.imRuntime.createRoute({ operationId: operation('invalid-group'), accountId: account.id, conversationKind: 'group', target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true })
    expect(invalid).toMatchObject({ status: 'rejected', code: 'IM_ROUTE_INVALID' })
    expect(ctx.imRuntime.queryRouteOperation(account.id, operation('invalid-group'))).toEqual({ state: 'known', result: invalid })

    const tuple = { accountId: account.id, conversationKind: 'direct' as const, target: { kind: 'specific' as const, conversationId: 'buyer-concurrent' }, workspaceId: WorkspaceId('workspace-a'), enabled: true }
    const concurrent = await Promise.all([
      ctx.imRuntime.createRoute({ operationId: operation('tuple-a'), ...tuple }),
      ctx.imRuntime.createRoute({ operationId: operation('tuple-b'), ...tuple }),
    ])
    expect(concurrent.map(result => result.status).sort()).toEqual(['applied', 'rejected'])
    expect(ctx.imRuntime.snapshot().routes).toHaveLength(1)
  })

  it('serializes absent-target CAS so only one concurrent create applies', async () => {
    const { ctx } = await boot()
    const account = await addAccount(ctx)
    const route = (await ctx.imRuntime.createRoute({ operationId: operation('route-sim-race'), accountId: account.id, conversationKind: 'group', target: { kind: 'all' }, workspaceId: WorkspaceId('workspace-a'), enabled: true, groupTrigger: { everyN: 2 } })).route!
    const results = await Promise.all([
      ctx.imRuntime.saveSimulationTarget({ operationId: operation('target-a'), workspaceId: WorkspaceId('sim-race'), observedRevision: null, accountId: account.id, routeId: route.id }),
      ctx.imRuntime.saveSimulationTarget({ operationId: operation('target-b'), workspaceId: WorkspaceId('sim-race'), observedRevision: null, accountId: account.id, routeId: route.id }),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['applied', 'conflict'])
  })
})
