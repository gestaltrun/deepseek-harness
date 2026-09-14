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
import { afterEach, describe, expect, it } from 'vitest'
import ImRuntime, {
  type ImAccountId,
  type ImOperationId,
  type ImRevision,
  type ImRouteId,
  type ImTransport,
} from '../src/index.ts'

const roots: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function operation(value: string): ImOperationId { return brandString<ImOperationId>(value) }

function fixtureTransport(): ImTransport {
  return {
    platform: 'wangwang',
    listAccountCandidates: async () => [{ platform: 'wangwang', candidateId: 'merchant-1', displayName: 'Fixture merchant', merchantId: 'merchant-1' }],
    prepareAccount: async request => {
      if (request.platform !== 'wangwang') throw new Error('wrong fixture platform')
      return {
        displayName: request.displayName ?? 'Fixture merchant',
        identity: { platform: 'wangwang', merchantId: request.candidateId, displayName: 'Fixture merchant' },
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

function fixtureProvider(ctx: Context): void { ctx.imTransports.register(fixtureTransport()) }
fixtureProvider.inject = ['imTransports']

async function boot(directory?: string) {
  const root = directory ?? await mkdtemp(join(tmpdir(), 'dsh-im-runtime-'))
  if (directory === undefined) directories.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(ImRuntime)
  const provider = ctx.plugin(fixtureProvider)
  await provider
  return { ctx, root }
}

async function addAccount(ctx: Context) {
  return ctx.imRuntime.addAccount({
    platform: 'wangwang',
    candidateId: 'merchant-1',
    accessKeyId: 'key-id',
    accessKeySecret: 'secret-value',
  })
}

describe('ImRuntime configuration', () => {
  it('persists only safe account facts and reloads them from the JSON domain', async () => {
    const first = await boot()
    await expect(first.ctx.imRuntime.listAccountCandidates('wangwang')).resolves.toEqual([
      { platform: 'wangwang', candidateId: 'merchant-1', displayName: 'Fixture merchant', merchantId: 'merchant-1' },
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

    await first.ctx.fiber.dispose()
    roots.splice(roots.indexOf(first.ctx), 1)
    const second = await boot(first.root)
    expect(second.ctx.imRuntime.queryRouteOperation(account.id, operation('durable-route'))).toEqual({ state: 'known', result: routeResult })
    expect(second.ctx.imRuntime.querySimulationTargetOperation(WorkspaceId('sim-workspace'), operation('durable-target'))).toEqual({ state: 'known', result: targetResult })
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
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ operationId: operation('once'), kind: 'route' })
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
