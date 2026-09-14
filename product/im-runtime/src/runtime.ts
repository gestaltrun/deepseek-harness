/** Durable IM account, route, and simulation-target service. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ImRuntimeError } from './errors.ts'
import { imRuntimeDomainSpec } from './schema.ts'
import type { ImAccountAggregate, ImAccountRecord, ImSimulationTargetAggregate } from './schema.ts'
import { ImTransports } from './transports.ts'
import type {
  ImAccountId,
  ImAccountCandidate,
  ImAccountSetupRequest,
  ImAccountMutationResult,
  ImAccountView,
  ImConversationKind,
  ImCreateRouteRequest,
  ImDeleteRouteRequest,
  ImOperationId,
  ImPlatform,
  ImRebindRouteRequest,
  ImRemoveSimulationTargetRequest,
  ImRevision,
  ImRouteId,
  ImRouteMutationResult,
  ImRouteOperationQuery,
  ImRouteResolution,
  ImRouteTarget,
  ImRouteView,
  ImRuntimeChange,
  ImRuntimeSnapshot,
  ImSaveRouteRequest,
  ImSaveSimulationTargetRequest,
  ImSetAccountPausedRequest,
  ImSimulationTargetMutationResult,
  ImSimulationTargetOperationQuery,
} from './types.ts'
import type { ImRuntimeService } from './service-types.ts'

const settled = (promise: Promise<unknown>): Promise<void> => promise.then(() => {}, () => {})
const now = (): string => new Date().toISOString()
const accountId = (): ImAccountId => brandString<ImAccountId>(`account-${randomUUID()}`)
const routeId = (): ImRouteId => brandString<ImRouteId>(`route-${randomUUID()}`)
const revision = (): ImRevision => brandString<ImRevision>(randomUUID())

const targetFingerprint = (target: ImRouteTarget): readonly unknown[] =>
  [target.kind, target.kind === 'specific' ? target.conversationId : null]
const triggerFingerprint = (trigger: ImRouteView['groupTrigger']): readonly unknown[] =>
  [trigger?.mention ?? null, trigger?.everyN ?? null, trigger?.fixedIntervalSeconds ?? null]
const createRouteFingerprint = (request: ImCreateRouteRequest): string =>
  JSON.stringify(['create', request.accountId, request.conversationKind, ...targetFingerprint(request.target), request.workspaceId, request.enabled, ...triggerFingerprint(request.groupTrigger)])
const saveRouteFingerprint = (request: ImSaveRouteRequest): string =>
  JSON.stringify(['save', request.accountId, request.routeId, request.observedRevision, request.enabled, ...triggerFingerprint(request.groupTrigger)])
const rebindRouteFingerprint = (request: ImRebindRouteRequest): string =>
  JSON.stringify(['rebind', request.accountId, request.routeId, request.observedRevision, request.observedWorkspaceId, request.workspaceId])
const deleteRouteFingerprint = (request: ImDeleteRouteRequest): string =>
  JSON.stringify(['delete', request.accountId, request.routeId, request.observedRevision, request.observedWorkspaceId])

function routeTupleKey(platform: ImRouteView['platform'], account: ImAccountId, kind: ImConversationKind, target: ImRouteTarget): string {
  return JSON.stringify([platform, account, kind, target.kind, target.kind === 'specific' ? target.conversationId : null])
}

function triggerError(conversationKind: ImConversationKind, trigger: ImRouteView['groupTrigger']): string | undefined {
  if (conversationKind === 'direct') return trigger === undefined ? undefined : 'direct routes cannot carry group trigger settings'
  if (trigger === undefined) return 'group routes require a group trigger'
  if (trigger.mention !== true && trigger.everyN === undefined && trigger.fixedIntervalSeconds === undefined) return 'group trigger must enable mention, everyN, or fixedIntervalSeconds'
  if (trigger.everyN !== undefined && (!Number.isSafeInteger(trigger.everyN) || trigger.everyN < 1)) return 'group trigger everyN must be a positive safe integer'
  if (trigger.fixedIntervalSeconds !== undefined && (!Number.isSafeInteger(trigger.fixedIntervalSeconds) || trigger.fixedIntervalSeconds < 1)) return 'group trigger fixedIntervalSeconds must be a positive safe integer'
  return undefined
}

function accountView(record: ImAccountRecord, routes: Readonly<Record<string, ImRouteView>>): ImAccountView {
  const listener: ImAccountView['listener'] = record.paused
    ? { state: 'stopped', reason: 'account-paused' }
    : Object.values(routes).some(route => route.enabled)
      ? { state: 'stopped', reason: 'disconnected' }
      : { state: 'stopped', reason: 'no-enabled-route' }
  return { ...record, listener }
}

function routeResult(operationId: ImOperationId, status: ImRouteMutationResult['status'], options: Omit<ImRouteMutationResult, 'operationId' | 'status'> = {}): ImRouteMutationResult {
  return { operationId, status, ...options }
}

function targetResult(operationId: ImOperationId, status: ImSimulationTargetMutationResult['status'], options: Omit<ImSimulationTargetMutationResult, 'operationId' | 'status'> = {}): ImSimulationTargetMutationResult {
  return { operationId, status, ...options }
}

function assertOperation(existing: { readonly fingerprint: string } | undefined, fingerprint: string, operationId: ImOperationId): void {
  if (existing !== undefined && existing.fingerprint !== fingerprint) {
    throw new ImRuntimeError('IM_OPERATION_REUSED', `IM operation '${operationId}' was already used for a different request`)
  }
}

/** Host service implementing the durable configuration half of IM takeover. */
export class ImRuntime extends Service implements ImRuntimeService {
  static inject = ['storageDomain', 'credentials']

  private accounts?: KvTable<ImAccountId, ImAccountAggregate>
  private simulationTargets?: KvTable<WorkspaceId, ImSimulationTargetAggregate>
  private generation = 0
  private simulationTail: Promise<void> = Promise.resolve()
  readonly transports: ImTransports

  /** @param ctx - Cordis context carrying StorageDomain and Credentials. */
  constructor(ctx: Context) {
    super(ctx, 'imRuntime')
    this.transports = new ImTransports(ctx)
  }

  /** Open the authoritative configuration domain before publishing the service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(imRuntimeDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'imRuntime.domainClose')
    this.accounts = domain.table('accounts')
    this.simulationTargets = domain.table('simulation_targets')
  }

  snapshot(): ImRuntimeSnapshot {
    const accounts = [...this.accountTable().entries()].sort(([left], [right]) => left.localeCompare(right))
    const routes = accounts.flatMap(([, aggregate]) => Object.values(aggregate.routes))
      .sort((left, right) => left.id.localeCompare(right.id))
    return {
      revision: this.generation,
      accounts: accounts.map(([, aggregate]) => accountView(aggregate.account, aggregate.routes)),
      routes,
      simulationTargets: [...this.simulationTargetTable().entries()].flatMap(([, aggregate]) => aggregate.target === undefined ? [] : [aggregate.target])
        .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
    }
  }

  subscribe(listener: (change: ImRuntimeChange) => void): () => void {
    return this.ctx.on('imRuntime/changed', listener)
  }

  async listAccountCandidates(platform: ImPlatform, signal = new AbortController().signal): Promise<readonly ImAccountCandidate[]> {
    const candidates = await this.transports.require(platform).listAccountCandidates(signal)
    for (const candidate of candidates) {
      if (candidate.platform !== platform) {
        throw new ImRuntimeError('IM_IDENTITY_MISMATCH', `IM transport '${platform}' returned '${candidate.platform}' candidate`)
      }
    }
    return candidates
  }

  async addAccount(request: ImAccountSetupRequest, signal = new AbortController().signal): Promise<ImAccountView> {
    const transport = this.transports.require(request.platform)
    const prepared = await transport.prepareAccount(request, signal)
    if (prepared.identity.platform !== request.platform) {
      throw new ImRuntimeError('IM_IDENTITY_MISMATCH', `IM transport '${request.platform}' returned '${prepared.identity.platform}' identity`)
    }
    const id = accountId()
    const createdAt = now()
    let storedKey: CredentialKey | undefined
    if (prepared.credentialRecord !== undefined) {
      storedKey = credentialKey('gestaltrun-im', id)
      await this.ctx.credentials.modifyRecord(storedKey, () => Promise.resolve(prepared.credentialRecord))
    }
    const record: ImAccountRecord = {
      id,
      platform: request.platform,
      displayName: prepared.displayName,
      identity: prepared.identity,
      ...(storedKey === undefined ? {} : { credentialKey: storedKey }),
      authorization: prepared.authorization,
      paused: false,
      revision: revision(),
      createdAt,
      updatedAt: createdAt,
    }
    try {
      await this.accountTable().put(id, { account: record, routes: {}, routeOperations: {}, accountOperations: {} })
    } catch (error) {
      if (storedKey !== undefined) {
        try { await this.ctx.credentials.deleteRecord(storedKey) } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `IM account '${id}' persistence and credential rollback both failed`)
        }
      }
      throw error
    }
    this.publish({ kind: 'account', accountId: id })
    return accountView(record, {})
  }

  async setAccountPaused(request: ImSetAccountPausedRequest): Promise<ImAccountMutationResult> {
    const fingerprint = JSON.stringify(['pause', request.accountId, request.observedRevision, request.paused])
    const nextRevision = revision()
    const updatedAt = now()
    let replayed = false
    const aggregate = await this.accountTable().update(request.accountId, (current) => {
      const existing = current.accountOperations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) { replayed = true; return current }
      const status: ImAccountMutationResult['status'] = current.account.revision !== request.observedRevision
        ? 'conflict'
        : current.account.paused === request.paused ? 'unchanged' : 'applied'
      const account = status === 'applied'
        ? { ...current.account, paused: request.paused, revision: nextRevision, updatedAt }
        : current.account
      return {
        ...current,
        account,
        accountOperations: { ...current.accountOperations, [request.operationId]: { fingerprint, result: { operationId: request.operationId, status, account } } },
      }
    }).catch(error => { throw this.accountError(request.accountId, error) })
    const stored = aggregate.accountOperations[request.operationId]
    if (stored === undefined) throw new Error(`IM account operation '${request.operationId}' was not recorded`)
    const result: ImAccountMutationResult = { ...stored.result, account: accountView(stored.result.account, aggregate.routes) }
    if (!replayed) this.publish({ kind: 'account', accountId: request.accountId, operationId: request.operationId })
    return result
  }

  async createRoute(request: ImCreateRouteRequest): Promise<ImRouteMutationResult> {
    const fingerprint = createRouteFingerprint(request)
    const id = routeId()
    const nextRevision = revision()
    const timestamp = now()
    let replayed = false
    const aggregate = await this.updateAccountRoute(request.accountId, request.operationId, fingerprint, (current) => {
      const invalid = request.target.kind === 'specific' && request.target.conversationId.trim() === ''
        ? 'specific route conversationId must be non-empty'
        : triggerError(request.conversationKind, request.groupTrigger)
      if (invalid !== undefined) return [current, routeResult(request.operationId, 'rejected', { code: 'IM_ROUTE_INVALID', message: invalid })]
      const tuple = routeTupleKey(current.account.platform, current.account.id, request.conversationKind, request.target)
      const duplicate = Object.values(current.routes).find(route => routeTupleKey(route.platform, route.accountId, route.conversationKind, route.target) === tuple)
      if (duplicate !== undefined) return [current, routeResult(request.operationId, 'rejected', { route: duplicate, code: 'IM_ROUTE_TUPLE_EXISTS', message: 'this account already has the route tuple' })]
      const route: ImRouteView = {
        id,
        platform: current.account.platform,
        accountId: current.account.id,
        conversationKind: request.conversationKind,
        target: request.target,
        workspaceId: request.workspaceId,
        enabled: request.enabled,
        ...(request.groupTrigger === undefined ? {} : { groupTrigger: request.groupTrigger }),
        revision: nextRevision,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      return [{ ...current, routes: { ...current.routes, [id]: route } }, routeResult(request.operationId, 'applied', { route })]
    }, value => { replayed = value })
    const result = aggregate.routeOperations[request.operationId]?.result
    if (result === undefined) throw new Error(`IM route operation '${request.operationId}' was not recorded`)
    if (!replayed) this.publish({ kind: 'route', accountId: request.accountId, ...(result.route === undefined ? {} : { routeId: result.route.id }), operationId: request.operationId })
    return result
  }

  async saveRoute(request: ImSaveRouteRequest): Promise<ImRouteMutationResult> {
    const fingerprint = saveRouteFingerprint(request)
    const nextRevision = revision()
    const updatedAt = now()
    let replayed = false
    const aggregate = await this.updateAccountRoute(request.accountId, request.operationId, fingerprint, (current) => {
      const route = current.routes[request.routeId]
      if (route === undefined) return [current, routeResult(request.operationId, 'rejected', { code: 'IM_ROUTE_NOT_FOUND', message: `route '${request.routeId}' is unknown` })]
      const invalid = triggerError(route.conversationKind, request.groupTrigger)
      if (invalid !== undefined) return [current, routeResult(request.operationId, 'rejected', { route, code: 'IM_ROUTE_INVALID', message: invalid })]
      if (route.revision !== request.observedRevision) return [current, routeResult(request.operationId, 'conflict', { route, code: 'IM_ROUTE_STALE', message: 'route revision changed' })]
      const unchanged = route.enabled === request.enabled && JSON.stringify(route.groupTrigger ?? null) === JSON.stringify(request.groupTrigger ?? null)
      if (unchanged) return [current, routeResult(request.operationId, 'unchanged', { route })]
      const { groupTrigger: _priorGroupTrigger, ...routeWithoutTrigger } = route
      const replacement: ImRouteView = { ...routeWithoutTrigger, enabled: request.enabled, ...(request.groupTrigger === undefined ? {} : { groupTrigger: request.groupTrigger }), revision: nextRevision, updatedAt }
      return [{ ...current, routes: { ...current.routes, [route.id]: replacement } }, routeResult(request.operationId, 'applied', { route: replacement })]
    }, value => { replayed = value })
    const result = aggregate.routeOperations[request.operationId]?.result
    if (result === undefined) throw new Error(`IM route operation '${request.operationId}' was not recorded`)
    if (!replayed) this.publish({ kind: 'route', accountId: request.accountId, routeId: request.routeId, operationId: request.operationId })
    return result
  }

  async rebindRoute(request: ImRebindRouteRequest): Promise<ImRouteMutationResult> {
    const fingerprint = rebindRouteFingerprint(request)
    const nextRevision = revision()
    const updatedAt = now()
    let replayed = false
    const aggregate = await this.updateAccountRoute(request.accountId, request.operationId, fingerprint, (current) => {
      const route = current.routes[request.routeId]
      if (route === undefined) return [current, routeResult(request.operationId, 'rejected', { code: 'IM_ROUTE_NOT_FOUND', message: `route '${request.routeId}' is unknown` })]
      if (route.revision !== request.observedRevision || route.workspaceId !== request.observedWorkspaceId) {
        return [current, routeResult(request.operationId, 'conflict', { route, code: 'IM_ROUTE_STALE', message: 'route revision or workspace owner changed' })]
      }
      if (route.workspaceId === request.workspaceId) return [current, routeResult(request.operationId, 'unchanged', { route })]
      const replacement: ImRouteView = { ...route, workspaceId: request.workspaceId, revision: nextRevision, updatedAt }
      return [{ ...current, routes: { ...current.routes, [route.id]: replacement } }, routeResult(request.operationId, 'applied', { route: replacement })]
    }, value => { replayed = value })
    const result = aggregate.routeOperations[request.operationId]?.result
    if (result === undefined) throw new Error(`IM route operation '${request.operationId}' was not recorded`)
    if (!replayed) this.publish({ kind: 'route', accountId: request.accountId, routeId: request.routeId, operationId: request.operationId })
    return result
  }

  async deleteRoute(request: ImDeleteRouteRequest): Promise<ImRouteMutationResult> {
    const fingerprint = deleteRouteFingerprint(request)
    const deletedRevision = revision()
    let replayed = false
    const aggregate = await this.updateAccountRoute(request.accountId, request.operationId, fingerprint, (current) => {
      const route = current.routes[request.routeId]
      if (route === undefined) return [current, routeResult(request.operationId, 'rejected', { code: 'IM_ROUTE_NOT_FOUND', message: `route '${request.routeId}' is unknown` })]
      if (route.revision !== request.observedRevision || route.workspaceId !== request.observedWorkspaceId) {
        return [current, routeResult(request.operationId, 'conflict', { route, code: 'IM_ROUTE_STALE', message: 'route revision or workspace owner changed' })]
      }
      const routes = { ...current.routes }
      delete routes[route.id]
      return [{ ...current, routes }, routeResult(request.operationId, 'applied', { deletedRevision })]
    }, value => { replayed = value })
    const result = aggregate.routeOperations[request.operationId]?.result
    if (result === undefined) throw new Error(`IM route operation '${request.operationId}' was not recorded`)
    if (!replayed) this.publish({ kind: 'route', accountId: request.accountId, routeId: request.routeId, operationId: request.operationId })
    return result
  }

  queryRouteOperation(account: ImAccountId, operationId: ImOperationId): ImRouteOperationQuery {
    const result = this.accountTable().get(account)?.routeOperations[operationId]?.result
    return result === undefined ? { state: 'not-found' } : { state: 'known', result }
  }

  resolveRoute(account: ImAccountId, conversationKind: ImConversationKind, conversationId: string): ImRouteResolution {
    const aggregate = this.requireAccount(account)
    if (aggregate.account.paused) return { state: 'account-paused' }
    const routes = Object.values(aggregate.routes).filter(route => route.conversationKind === conversationKind)
    const specific = routes.find(route => route.target.kind === 'specific' && route.target.conversationId === conversationId)
    if (specific !== undefined) return specific.enabled ? { state: 'matched', route: specific } : { state: 'disabled', route: specific }
    const all = routes.find(route => route.target.kind === 'all')
    if (all !== undefined) return all.enabled ? { state: 'matched', route: all } : { state: 'disabled', route: all }
    return { state: 'unmatched' }
  }

  saveSimulationTarget(request: ImSaveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return this.enqueueSimulation(async () => {
      const fingerprint = JSON.stringify(['save', request.workspaceId, request.observedRevision, request.accountId, request.routeId])
      const current = this.simulationTargetTable().get(request.workspaceId)
      const existing = current?.operations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) return existing.result
      const route = this.accountTable().get(request.accountId)?.routes[request.routeId]
      let result: ImSimulationTargetMutationResult
      let target = current?.target
      if (route === undefined) {
        result = targetResult(request.operationId, 'rejected', { code: 'IM_ROUTE_NOT_FOUND', message: `route '${request.routeId}' is unknown for account '${request.accountId}'` })
      } else if ((target?.revision ?? null) !== request.observedRevision) {
        result = targetResult(request.operationId, 'conflict', { ...(target === undefined ? {} : { target }), code: 'IM_SIMULATION_TARGET_STALE', message: 'simulation target revision changed' })
      } else if (target?.accountId === request.accountId && target.routeId === request.routeId) {
        result = targetResult(request.operationId, 'unchanged', { target })
      } else {
        target = { workspaceId: request.workspaceId, accountId: request.accountId, routeId: request.routeId, revision: revision(), updatedAt: now() }
        result = targetResult(request.operationId, 'applied', { target })
      }
      await this.simulationTargetTable().put(request.workspaceId, {
        workspaceId: request.workspaceId,
        ...(target === undefined ? {} : { target }),
        operations: { ...(current?.operations ?? {}), [request.operationId]: { fingerprint, result } },
      })
      this.publish({ kind: 'simulation-target', workspaceId: request.workspaceId, operationId: request.operationId })
      return result
    })
  }

  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return this.enqueueSimulation(async () => {
      const fingerprint = JSON.stringify(['remove', request.workspaceId, request.observedRevision])
      const current = this.simulationTargetTable().get(request.workspaceId)
      const existing = current?.operations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) return existing.result
      const target = current?.target
      let result: ImSimulationTargetMutationResult
      if (target === undefined) {
        result = targetResult(request.operationId, 'rejected', { code: 'IM_SIMULATION_TARGET_NOT_FOUND', message: `workspace '${request.workspaceId}' has no simulation target` })
      } else if (target.revision !== request.observedRevision) {
        result = targetResult(request.operationId, 'conflict', { target, code: 'IM_SIMULATION_TARGET_STALE', message: 'simulation target revision changed' })
      } else {
        result = targetResult(request.operationId, 'applied', { deletedRevision: revision() })
      }
      await this.simulationTargetTable().put(request.workspaceId, {
        workspaceId: request.workspaceId,
        ...(result.status === 'applied' ? {} : target === undefined ? {} : { target }),
        operations: { ...(current?.operations ?? {}), [request.operationId]: { fingerprint, result } },
      })
      this.publish({ kind: 'simulation-target', workspaceId: request.workspaceId, operationId: request.operationId })
      return result
    })
  }

  querySimulationTargetOperation(workspaceId: WorkspaceId, operationId: ImOperationId): ImSimulationTargetOperationQuery {
    const result = this.simulationTargetTable().get(workspaceId)?.operations[operationId]?.result
    return result === undefined ? { state: 'not-found' } : { state: 'known', result }
  }

  private accountTable(): KvTable<ImAccountId, ImAccountAggregate> {
    if (this.accounts === undefined) throw new Error('IM runtime domain is not ready')
    return this.accounts
  }

  private simulationTargetTable(): KvTable<WorkspaceId, ImSimulationTargetAggregate> {
    if (this.simulationTargets === undefined) throw new Error('IM runtime domain is not ready')
    return this.simulationTargets
  }

  private requireAccount(id: ImAccountId): ImAccountAggregate {
    const aggregate = this.accountTable().get(id)
    if (aggregate === undefined) throw new ImRuntimeError('IM_ACCOUNT_NOT_FOUND', `IM account '${id}' is unknown`)
    return aggregate
  }

  private accountError(id: ImAccountId, error: unknown): unknown {
    if ((error as { code?: unknown } | null)?.code === 'missing-key') return new ImRuntimeError('IM_ACCOUNT_NOT_FOUND', `IM account '${id}' is unknown`)
    return error
  }

  private async updateAccountRoute(
    id: ImAccountId,
    operationId: ImOperationId,
    fingerprint: string,
    mutate: (current: ImAccountAggregate) => readonly [ImAccountAggregate, ImRouteMutationResult],
    replayed: (value: boolean) => void,
  ): Promise<ImAccountAggregate> {
    return this.accountTable().update(id, (current) => {
      const existing = current.routeOperations[operationId]
      assertOperation(existing, fingerprint, operationId)
      if (existing !== undefined) { replayed(true); return current }
      const [changed, result] = mutate(current)
      return { ...changed, routeOperations: { ...current.routeOperations, [operationId]: { fingerprint, result } } }
    }).catch(error => { throw this.accountError(id, error) })
  }

  private enqueueSimulation<T>(job: () => Promise<T>): Promise<T> {
    const result = this.simulationTail.then(job)
    this.simulationTail = settled(result)
    return result
  }

  private publish(change: Omit<ImRuntimeChange, 'revision'>): void {
    const event: ImRuntimeChange = { revision: ++this.generation, ...change }
    try { this.ctx.emit('imRuntime/changed', event) } catch (error) {
      this.ctx.logger.warn(`IM runtime change listener failed after commit: ${String(error)}`)
    }
  }
}

export default ImRuntime
