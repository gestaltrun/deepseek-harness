/** Durable IM account, route, and simulation-target service. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z, type ZodType } from 'zod'
import { encodeImScopeId, ImDeliveryStore } from './delivery.ts'
import { imDeliveryDomainSpec } from './delivery-schema.ts'
import type { ImDeliveryAggregate, ImExecutionAggregate, ImProviderCursorAggregate } from './delivery-schema.ts'
import { ImAgentCoordinator } from './agent-coordinator.ts'
import { ImRuntimeError } from './errors.ts'
import { imRuntimeDomainSpec } from './schema.ts'
import type { ImAccountAggregate, ImAccountRecord, ImSimulationTargetAggregate } from './schema.ts'
import { ImTransports } from './transports.ts'
import type { ImTransportInboundPage, ImTransportInboundPageReceipt, ImTransportSink } from './transport.ts'
import type {
  ImBeginOutboundAttemptRequest,
  ImBeginOutboundAttemptResult,
  ImAgentTaskId,
  ImAgentTaskView,
  ImCancelPendingAiRequest,
  ImCommitProviderCursorRequest,
  ImConversationCursor,
  ImDeliveryChange,
  ImDeliveryOperationId,
  ImDeliveryScope,
  ImGetOutboundRequest,
  ImHistoryPage,
  ImHistoryQueryRequest,
  ImImportJsonlHistoryRequest,
  ImImportJsonlHistoryResult,
  ImInboundMessageView,
  ImInboundSenderEvidence,
  ImInboundOperationQuery,
  ImInboundPageResult,
  ImIngestInboundPageRequest,
  ImMarkSubmittedRequest,
  ImMarkSubmittedResult,
  ImMessageId,
  ImMessageSource,
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
  ImSessionReconciliationResult,
  ImSenderAttribution,
  ImSettleOutboundAttemptRequest,
  ImSettleSimulationOutboundRequest,
} from './delivery-types.ts'
import type {
  ImAccountId,
  ImAccountCandidate,
  ImAccountLifecycleRequest,
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
const assertNever = (value: never): never => { throw new Error(`unhandled IM value: ${String(value)}`) }
const DEFAULT_ADMISSION_BATCH_SIZE = 1000

/** Runtime limits applied to one durable Agent admission. */
export interface Config {
  /** Maximum inbound messages copied into one Agent input. */
  readonly admissionBatchSize?: number
}

interface ResolvedConfig { readonly admissionBatchSize: number }

const targetFingerprint = (target: ImRouteTarget): readonly unknown[] =>
  [target.kind, target.kind === 'specific' ? target.conversationId : null, target.kind === 'specific' ? target.directRecipient ?? null : null]
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

function triggerError(conversationKind: ImConversationKind, trigger: ImRouteView['groupTrigger'], maximumEveryN: number): string | undefined {
  if (conversationKind === 'direct') return trigger === undefined ? undefined : 'direct routes cannot carry group trigger settings'
  if (trigger === undefined) return 'group routes require a group trigger'
  if (trigger.mention !== true && trigger.everyN === undefined && trigger.fixedIntervalSeconds === undefined) return 'group trigger must enable mention, everyN, or fixedIntervalSeconds'
  if (trigger.everyN !== undefined && (!Number.isSafeInteger(trigger.everyN) || trigger.everyN < 1)) return 'group trigger everyN must be a positive safe integer'
  if (trigger.everyN !== undefined && trigger.everyN > maximumEveryN) return `group trigger everyN must not exceed admissionBatchSize (${maximumEveryN})`
  if (trigger.fixedIntervalSeconds !== undefined && (!Number.isSafeInteger(trigger.fixedIntervalSeconds) || trigger.fixedIntervalSeconds < 1)) return 'group trigger fixedIntervalSeconds must be a positive safe integer'
  return undefined
}

function accountView(record: ImAccountRecord, routes: Readonly<Record<string, ImRouteView>>, active?: ImAccountView['listener']): ImAccountView {
  const listener: ImAccountView['listener'] = record.paused
    ? { state: 'stopped', reason: 'account-paused' }
    : record.connectionIntent === 'disconnected'
      ? { state: 'stopped', reason: 'manual' }
    : record.authorization.state === 'required' || record.authorization.state === 'failed'
      ? { state: 'stopped', reason: 'authorization-required' }
    : Object.values(routes).some(route => route.enabled)
      ? active ?? { state: 'stopped', reason: 'disconnected' }
      : { state: 'stopped', reason: 'no-enabled-route' }
  return { ...record, listener }
}

interface ActiveListener {
  readonly controller: AbortController
  readonly planFingerprint: string
  dispose?: () => Promise<void>
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
  static Config: ZodType<Config> = z.object({
    admissionBatchSize: z.number().int().positive().max(1000).default(DEFAULT_ADMISSION_BATCH_SIZE),
  }).default({ admissionBatchSize: DEFAULT_ADMISSION_BATCH_SIZE })

  private accounts?: KvTable<ImAccountId, ImAccountAggregate>
  private simulationTargets?: KvTable<WorkspaceId, ImSimulationTargetAggregate>
  private deliveryScopes?: KvTable<import('./delivery-types.ts').ImScopeId, ImDeliveryAggregate>
  private providerCursors?: KvTable<ImProviderCursorId, ImProviderCursorAggregate>
  private executions?: KvTable<ImAgentTaskId, ImExecutionAggregate>
  private delivery?: ImDeliveryStore
  private coordinator: ImAgentCoordinator | undefined
  private generation = 0
  private deliveryGeneration = 0
  private simulationTail: Promise<void> = Promise.resolve()
  private readonly activeListeners = new Map<ImAccountId, ActiveListener>()
  private readonly listenerStates = new Map<ImAccountId, ImAccountView['listener']>()
  private readonly listenerTails = new Map<ImAccountId, Promise<void>>()
  readonly transports: ImTransports
  readonly config: ResolvedConfig

  /** @param ctx - Cordis context carrying StorageDomain and Credentials. @param config - validated Agent admission limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'imRuntime')
    const admissionBatchSize = config.admissionBatchSize ?? DEFAULT_ADMISSION_BATCH_SIZE
    if (!Number.isSafeInteger(admissionBatchSize) || admissionBatchSize < 1 || admissionBatchSize > 1000) {
      throw new TypeError('im-runtime: admissionBatchSize must be an integer from 1 through 1000')
    }
    this.config = { admissionBatchSize }
    this.transports = new ImTransports(ctx)
  }

  /** Open the authoritative configuration domain before publishing the service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(imRuntimeDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'imRuntime.domainClose')
    this.accounts = domain.table('accounts')
    this.simulationTargets = domain.table('simulation_targets')
    for (const [, aggregate] of this.accountTable().entries()) {
      for (const route of Object.values(aggregate.routes)) {
        const error = triggerError(route.conversationKind, route.groupTrigger, this.config.admissionBatchSize)
        if (error !== undefined) throw new TypeError(`im-runtime: stored route '${route.id}' is invalid: ${error}`)
      }
    }
    const deliveryDomain = await this.ctx.storageDomain.open(imDeliveryDomainSpec)
    this.ctx.effect(() => () => deliveryDomain.close(), 'imRuntime.deliveryDomainClose')
    this.deliveryScopes = deliveryDomain.table('scopes')
    this.providerCursors = deliveryDomain.table('provider_cursors')
    this.executions = deliveryDomain.table('executions')
    this.delivery = new ImDeliveryStore(this.deliveryScopes, this.providerCursors, {
      inspectAccount: id => {
        const account = this.accountTable().get(id)?.account
        return account === undefined ? undefined : { platform: account.platform, paused: account.paused, revision: account.revision }
      },
      resolveRoute: scope => {
        try { return this.resolveRoute(scope.accountId, scope.conversationKind, scope.conversationId) } catch (error) {
          if (error instanceof ImRuntimeError && error.code === 'IM_ACCOUNT_NOT_FOUND') return undefined
          throw error
        }
      },
      publish: change => { this.publishDelivery(change) },
    })
    await this.delivery.recoverInterruptedAttempts()
    this.ctx.inject(['agentDefaultModel', 'agents', 'agentPresets', 'sessions', 'sessionPersistence', 'tools', 'workspaceRegistry'], (agentCtx: Context) => {
      agentCtx.effect(async () => {
        const coordinator = new ImAgentCoordinator(agentCtx, this, this.executionTable())
        this.coordinator = coordinator
        coordinator.start([...this.deliveryScopeTable().entries()].map(([, aggregate]) => aggregate.scope))
        return async () => {
          if (this.coordinator === coordinator) this.coordinator = undefined
          await coordinator.dispose()
        }
      }, 'imRuntime.agentCoordinator()')
    })
    this.ctx.on('imTransports/changed', platform => {
      for (const [id, aggregate] of this.accountTable().entries()) {
        if (aggregate.account.platform === platform) this.scheduleListener(id)
      }
    })
    this.ctx.effect(() => async () => { await this.stopAllListeners() }, 'imRuntime.listeners()')
  }

  snapshot(): ImRuntimeSnapshot {
    const accounts = [...this.accountTable().entries()].sort(([left], [right]) => left.localeCompare(right))
    const routes = accounts.flatMap(([, aggregate]) => Object.values(aggregate.routes))
      .sort((left, right) => left.id.localeCompare(right.id))
    return {
      revision: this.generation,
      accounts: accounts.map(([id, aggregate]) => accountView(aggregate.account, aggregate.routes, this.listenerStates.get(id))),
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
      connectionIntent: 'connected',
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
    return accountView(record, {}, this.listenerStates.get(record.id))
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
    const result: ImAccountMutationResult = { ...stored.result, account: accountView(stored.result.account, aggregate.routes, this.listenerStates.get(request.accountId)) }
    if (!replayed) this.publish({ kind: 'account', accountId: request.accountId, operationId: request.operationId })
    return result
  }

  disconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult> {
    return this.setConnectionIntent(request, 'disconnected')
  }

  reconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult> {
    return this.setConnectionIntent(request, 'connected')
  }

  async refreshAccount(request: ImAccountLifecycleRequest, signal = new AbortController().signal): Promise<ImAccountMutationResult> {
    const fingerprint = JSON.stringify(['refresh', request.accountId, request.observedRevision])
    const before = this.requireAccount(request.accountId)
    const existing = before.accountOperations[request.operationId]
    assertOperation(existing, fingerprint, request.operationId)
    if (existing !== undefined) {
      return { ...existing.result, account: accountView(existing.result.account, before.routes, this.listenerStates.get(request.accountId)) }
    }
    if (before.account.revision !== request.observedRevision) {
      return await this.storeRefreshResult(request, fingerprint, before.account.authorization, 'conflict')
    }
    const inspected = await this.transports.require(before.account.platform)
      .refreshAccount(accountView(before.account, before.routes, this.listenerStates.get(request.accountId)), signal)
    return await this.storeRefreshResult(request, fingerprint, inspected.authorization, undefined)
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
        : triggerError(request.conversationKind, request.groupTrigger, this.config.admissionBatchSize)
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
      const invalid = triggerError(route.conversationKind, request.groupTrigger, this.config.admissionBatchSize)
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

  subscribeDelivery(listener: (change: ImDeliveryChange) => void): () => void {
    return this.ctx.on('imRuntime/delivery-changed', listener)
  }

  ingestInboundPage(request: ImIngestInboundPageRequest): Promise<ImInboundPageResult> {
    if (request.scope.kind === 'simulation') {
      if (request.observedCursor !== null || request.nextCursor !== null) {
        throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'simulation input cannot carry a provider cursor')
      }
      const resolved = this.resolveRoute(request.scope.accountId, request.scope.conversationKind, request.scope.conversationId)
      const target = resolved.state === 'matched' ? this.simulationTargetTable().get(resolved.route.workspaceId)?.target : undefined
      if (resolved.state !== 'matched' || target === undefined || target.accountId !== request.scope.accountId || target.routeId !== resolved.route.id) {
        throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'simulation input must use an enabled configured simulation target')
      }
    }
    return this.deliveryStore().ingestInboundPage(request)
  }

  queryInboundOperation(scope: ImDeliveryScope, operationId: ImDeliveryOperationId): ImInboundOperationQuery {
    return this.deliveryStore().queryInboundOperation(scope, operationId)
  }

  getConversationCursor(scope: ImDeliveryScope): ImConversationCursor {
    return this.deliveryStore().getConversationCursor(scope)
  }

  getProviderCursor(owner: ImProviderCursorOwner): ImProviderCursorView {
    return this.deliveryStore().getProviderCursor(owner)
  }

  commitProviderCursor(request: ImCommitProviderCursorRequest): Promise<ImProviderCursorCommitResult> {
    return this.deliveryStore().commitProviderCursor(request)
  }

  queryProviderCursorOperation(owner: ImProviderCursorOwner, operationId: ImDeliveryOperationId): ImProviderCursorOperationQuery {
    return this.deliveryStore().queryProviderCursorOperation(owner, operationId)
  }

  queryHistory(request: ImHistoryQueryRequest): ImHistoryPage {
    return this.deliveryStore().queryHistory(request)
  }

  pendingInbound(request: ImPendingInboundRequest): readonly ImInboundMessageView[] {
    return this.deliveryStore().pendingInbound(request)
  }

  getAgentTask(scope: ImDeliveryScope): ImAgentTaskView | undefined {
    const scopeId = encodeImScopeId(scope)
    const task = [...this.executionTable().entries()]
      .map(([, aggregate]) => aggregate)
      .filter(aggregate => aggregate.scopeId === scopeId)
      .sort((left, right) => right.generation - left.generation)[0]
    if (task === undefined) return undefined
    const { pendingAdmission: _pending, ...view } = task
    return view
  }

  /** @param scope - complete conversation identity. @param messageId - stored inbound identity. @returns stored message. */
  getInboundMessage(scope: ImDeliveryScope, messageId: ImMessageId): ImInboundMessageView {
    return this.deliveryStore().getInbound(scope, messageId)
  }

  messageSource(scope: ImDeliveryScope, messageId: ImMessageId): ImMessageSource {
    return this.deliveryStore().messageSource(scope, messageId)
  }

  markSubmitted(request: ImMarkSubmittedRequest): Promise<ImMarkSubmittedResult> {
    return this.deliveryStore().markSubmitted(request)
  }

  sessionUserMessage(scope: ImDeliveryScope, messageId: ImMessageId): UserMessage {
    const inbound = this.deliveryStore().getInbound(scope, messageId)
    return freezeMessage({
      id: MessageId(`im:${inbound.messageId}`),
      role: 'user',
      content: [{ type: 'text', text: inbound.content.text }],
      source: this.deliveryStore().messageSource(scope, messageId),
    })
  }

  async reconcileSession(sessionId: SessionId): Promise<ImSessionReconciliationResult> {
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined
    if (persistence === undefined) throw new ImRuntimeError('IM_SESSION_PERSISTENCE_UNAVAILABLE', 'SessionPersistence is required to reconcile IM submission evidence')
    const handle = await persistence.open(sessionId, 'read')
    let events: readonly SessionEvent[]
    try { events = (await handle.read()).events } finally { await handle.close() }
    const groups = new Map<import('./delivery-types.ts').ImScopeId, { readonly scope: ImDeliveryScope; readonly messageIds: Set<ImMessageId> }>()
    let ignoredEvidenceCount = 0
    for (const event of events) {
      if (event.type !== 'user/message' || event.data.source.kind !== 'im') continue
      const imSource = event.data.source
      const sources: ImMessageSource[] = imSource.admission === undefined
        ? [imSource]
        : imSource.admission.messages.map(message => ({
            kind: 'im', scopeId: imSource.scopeId,
            messageId: message.messageId, sequenceNumber: message.sequenceNumber,
          }))
      for (const source of sources) {
        const matched = this.deliveryStore().matchMessageSource(source)
        if (matched === undefined) { ignoredEvidenceCount++; continue }
        const group = groups.get(source.scopeId) ?? { scope: matched.scope, messageIds: new Set<ImMessageId>() }
        group.messageIds.add(matched.messageId)
        groups.set(source.scopeId, group)
      }
    }
    const submittedMessageIds: ImMessageId[] = []
    for (const group of groups.values()) {
      const result = await this.deliveryStore().markSubmitted({ scope: group.scope, messageIds: [...group.messageIds], sessionId })
      submittedMessageIds.push(...result.messages.map(message => message.messageId))
    }
    return { sessionId, submittedMessageIds, ignoredEvidenceCount }
  }

  importJsonlHistory(request: ImImportJsonlHistoryRequest): Promise<ImImportJsonlHistoryResult> {
    return this.deliveryStore().importJsonlHistory(request)
  }

  registerOutbound(request: ImRegisterOutboundRequest): Promise<ImOutboundView> {
    return this.deliveryStore().registerOutbound(request)
  }

  /** @param request - scope-fixed automated intent. @param binding - task generation recorded before Agent execution. @returns durable intent or a route-changed rejection. */
  registerAgentOutbound(request: ImRegisterOutboundRequest, binding: ImOutboundRouteBinding): Promise<ImOutboundView> {
    return this.deliveryStore().registerOutbound(request, binding)
  }

  beginOutboundAttempt(request: ImBeginOutboundAttemptRequest): Promise<ImBeginOutboundAttemptResult> {
    return this.deliveryStore().beginOutboundAttempt(request)
  }

  settleOutboundAttempt(request: ImSettleOutboundAttemptRequest): Promise<ImOutboundView> {
    return this.deliveryStore().settleOutboundAttempt(request)
  }

  settleSimulationOutbound(request: ImSettleSimulationOutboundRequest): Promise<ImOutboundView> {
    return this.deliveryStore().settleSimulationOutbound(request)
  }

  getOutbound(request: ImGetOutboundRequest): ImOutboundView | undefined {
    return this.deliveryStore().getOutbound(request)
  }

  queryOutbound(request: ImOutboundQueryRequest): ImOutboundPage {
    return this.deliveryStore().queryOutbound(request)
  }

  cancelPendingAi(request: ImCancelPendingAiRequest): Promise<readonly ImOutboundView[]> {
    return this.deliveryStore().cancelPendingAi(request)
  }

  findSentOutbound(scope: ImRealDeliveryScope, externalMessageId: string): ImOutboundView | undefined {
    return this.deliveryStore().findSentOutbound(scope, externalMessageId)
  }

  classifyInboundSender(scope: ImRealDeliveryScope, evidence: ImInboundSenderEvidence): ImSenderAttribution {
    switch (evidence.kind) {
      case 'external-actor':
        return {
          kind: 'external', senderId: evidence.senderId,
          ...(evidence.senderDisplayName === undefined ? {} : { senderDisplayName: evidence.senderDisplayName }),
          ...(evidence.userId === undefined ? {} : { userId: evidence.userId }),
          ...(evidence.openDingTalkId === undefined ? {} : { openDingTalkId: evidence.openDingTalkId }),
        }
      case 'configured-native':
        return { kind: 'human-native', accountId: scope.accountId, providerActorId: evidence.providerActorId }
      case 'configured-echo': {
        const outbound = this.findSentOutbound(scope, evidence.externalMessageId)
        if (outbound === undefined) return { kind: 'unknown', reason: 'unmatched-echo', ...(evidence.observedSenderId === undefined ? {} : { observedSenderId: evidence.observedSenderId }) }
        return outbound.intent === 'ai'
          ? { kind: 'ai', outboundRequestId: outbound.requestId }
          : { kind: 'human-dsh', outboundRequestId: outbound.requestId }
      }
      case 'configured-self':
        return { kind: 'unknown', reason: 'unmatched-self', ...(evidence.observedSenderId === undefined ? {} : { observedSenderId: evidence.observedSenderId }) }
      case 'provider-unknown':
        return { kind: 'unknown', reason: 'provider-unknown', ...(evidence.observedSenderId === undefined ? {} : { observedSenderId: evidence.observedSenderId }) }
      default:
        return assertNever(evidence)
    }
  }

  private accountTable(): KvTable<ImAccountId, ImAccountAggregate> {
    if (this.accounts === undefined) throw new Error('IM runtime domain is not ready')
    return this.accounts
  }

  private simulationTargetTable(): KvTable<WorkspaceId, ImSimulationTargetAggregate> {
    if (this.simulationTargets === undefined) throw new Error('IM runtime domain is not ready')
    return this.simulationTargets
  }

  private deliveryStore(): ImDeliveryStore {
    if (this.delivery === undefined || this.deliveryScopes === undefined || this.providerCursors === undefined) throw new Error('IM delivery domain is not ready')
    return this.delivery
  }

  private deliveryScopeTable(): KvTable<import('./delivery-types.ts').ImScopeId, ImDeliveryAggregate> {
    if (this.deliveryScopes === undefined) throw new Error('IM delivery domain is not ready')
    return this.deliveryScopes
  }

  private executionTable(): KvTable<ImAgentTaskId, ImExecutionAggregate> {
    if (this.executions === undefined) throw new Error('IM execution domain is not ready')
    return this.executions
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

  /** Persist a connection intent separately from pause and process listener state. */
  private async setConnectionIntent(request: ImAccountLifecycleRequest, intent: ImAccountView['connectionIntent']): Promise<ImAccountMutationResult> {
    const fingerprint = JSON.stringify([intent, request.accountId, request.observedRevision])
    const nextRevision = revision()
    const updatedAt = now()
    let replayed = false
    const aggregate = await this.accountTable().update(request.accountId, current => {
      const existing = current.accountOperations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) { replayed = true; return current }
      const status: ImAccountMutationResult['status'] = current.account.revision !== request.observedRevision
        ? 'conflict'
        : current.account.connectionIntent === intent ? 'unchanged' : 'applied'
      const account = status === 'applied'
        ? { ...current.account, connectionIntent: intent, revision: nextRevision, updatedAt }
        : current.account
      return {
        ...current,
        account,
        accountOperations: { ...current.accountOperations, [request.operationId]: { fingerprint, result: { operationId: request.operationId, status, account } } },
      }
    }).catch(error => { throw this.accountError(request.accountId, error) })
    const stored = aggregate.accountOperations[request.operationId]
    if (stored === undefined) throw new Error(`IM account operation '${request.operationId}' was not recorded`)
    const result = { ...stored.result, account: accountView(stored.result.account, aggregate.routes, this.listenerStates.get(request.accountId)) }
    if (!replayed) this.publish({ kind: 'account', accountId: request.accountId, operationId: request.operationId })
    return result
  }

  /** Store one provider authorization observation under the account revision CAS. */
  private async storeRefreshResult(
    request: ImAccountLifecycleRequest,
    fingerprint: string,
    authorization: ImAccountView['authorization'],
    forcedStatus: 'conflict' | undefined,
  ): Promise<ImAccountMutationResult> {
    const nextRevision = revision()
    const updatedAt = now()
    const aggregate = await this.accountTable().update(request.accountId, current => {
      const existing = current.accountOperations[request.operationId]
      assertOperation(existing, fingerprint, request.operationId)
      if (existing !== undefined) return current
      const status: ImAccountMutationResult['status'] = forcedStatus ?? (current.account.revision !== request.observedRevision
        ? 'conflict'
        : JSON.stringify(current.account.authorization) === JSON.stringify(authorization) ? 'unchanged' : 'applied')
      const account = status === 'applied'
        ? { ...current.account, authorization, revision: nextRevision, updatedAt }
        : current.account
      return {
        ...current,
        account,
        accountOperations: { ...current.accountOperations, [request.operationId]: { fingerprint, result: { operationId: request.operationId, status, account } } },
      }
    }).catch(error => { throw this.accountError(request.accountId, error) })
    const stored = aggregate.accountOperations[request.operationId]
    if (stored === undefined) throw new Error(`IM account operation '${request.operationId}' was not recorded`)
    this.publish({ kind: 'account', accountId: request.accountId, operationId: request.operationId })
    return { ...stored.result, account: accountView(stored.result.account, aggregate.routes, this.listenerStates.get(request.accountId)) }
  }

  private publish(change: Omit<ImRuntimeChange, 'revision'>): void {
    const event: ImRuntimeChange = { revision: ++this.generation, ...change }
    try { this.ctx.emit('imRuntime/changed', event) } catch (error) {
      this.ctx.logger.warn(`IM runtime change listener failed after commit: ${String(error)}`)
    }
    if (change.accountId !== undefined) {
      this.scheduleListener(change.accountId)
      for (const [, aggregate] of this.deliveryScopeTable().entries()) {
        if (aggregate.scope.accountId === change.accountId) this.coordinator?.notify(aggregate.scope)
      }
    }
  }

  private publishDelivery(change: Omit<ImDeliveryChange, 'sequence'>): void {
    const event: ImDeliveryChange = { sequence: ++this.deliveryGeneration, ...change }
    try { this.ctx.emit('imRuntime/delivery-changed', event) } catch (error) {
      this.ctx.logger.warn(`IM delivery change listener failed after commit: ${String(error)}`)
    }
    if (change.kind === 'inbound') this.coordinator?.notify(change.scope)
  }

  /** Serialize listener state changes for one configured account. */
  private scheduleListener(id: ImAccountId): void {
    const prior = this.listenerTails.get(id) ?? Promise.resolve()
    const next = prior.then(() => this.reconcileListener(id))
    this.listenerTails.set(id, next.then(() => {}, error => {
      this.ctx.logger.warn(`IM account '${id}' listener reconciliation failed: ${String(error)}`)
    }))
  }

  /** Start or stop the provider listener from durable account and route facts. */
  private async reconcileListener(id: ImAccountId): Promise<void> {
    const aggregate = this.accountTable().get(id)
    const shouldRun = aggregate !== undefined
      && aggregate.account.connectionIntent === 'connected'
      && (aggregate.account.authorization.state === 'ready' || aggregate.account.authorization.state === 'unchecked')
      && !aggregate.account.paused
      && Object.values(aggregate.routes).some(route => route.enabled)
    const transport = aggregate === undefined ? undefined : this.transports.get(aggregate.account.platform)
    const current = this.activeListeners.get(id)
    if (!shouldRun || transport === undefined) {
      if (current !== undefined) await this.stopListener(id, current)
      return
    }
    const plan = {
      routes: Object.values(aggregate.routes)
        .filter(route => route.enabled)
        .map(route => ({
          routeId: route.id,
          routeRevision: route.revision,
          conversationKind: route.conversationKind,
          target: route.target,
          needsMentionEvidence: route.conversationKind === 'group' && route.groupTrigger?.mention === true,
        })),
    }
    const planFingerprint = JSON.stringify(plan)
    if (current?.planFingerprint === planFingerprint) return
    if (current !== undefined) await this.stopListener(id, current)
    const controller = new AbortController()
    const active: ActiveListener = { controller, planFingerprint }
    this.activeListeners.set(id, active)
    this.listenerStates.set(id, { state: 'starting', since: now() })
    this.publishListener(id)
    try {
      const view = accountView(aggregate.account, aggregate.routes, this.listenerStates.get(id))
      const dispose = await transport.listen(view, plan, this.transportSink(id, aggregate.account.platform), controller.signal)
      if (controller.signal.aborted) {
        await dispose()
        return
      }
      active.dispose = dispose
      this.listenerStates.set(id, { state: 'running', readyAt: now() })
      this.publishListener(id)
    } catch {
      this.activeListeners.delete(id)
      if (!controller.signal.aborted) {
        this.listenerStates.set(id, { state: 'failed', attempts: 1, lastError: 'provider listener failed' })
        this.ctx.logger.warn(`IM account '${id}' listener failed`)
        this.publishListener(id)
      }
    }
  }

  /** Stop one exact listener before publishing a later start for the same account. */
  private async stopListener(id: ImAccountId, active: ActiveListener): Promise<void> {
    active.controller.abort(new Error(`IM account '${id}' listener stopped`))
    if (active.dispose !== undefined) await active.dispose()
    if (this.activeListeners.get(id) === active) this.activeListeners.delete(id)
    this.listenerStates.delete(id)
    this.publishListener(id)
  }

  /** Drain every provider listener owned by this runtime. */
  private async stopAllListeners(): Promise<void> {
    const active = [...this.activeListeners]
    await Promise.all(active.map(([id, listener]) => this.stopListener(id, listener)))
    await Promise.all(this.listenerTails.values())
  }

  /** Bind a provider page sink to one configured account and its platform. */
  private transportSink(accountId: ImAccountId, platform: ImPlatform): ImTransportSink {
    return {
      receivePage: page => this.receiveTransportPage(accountId, platform, page),
    }
  }

  /** Persist every conversation page before committing the provider-owned cursor. */
  private async receiveTransportPage(accountId: ImAccountId, platform: ImPlatform, page: ImTransportInboundPage): Promise<ImTransportInboundPageReceipt> {
    if (page.owner.accountId !== accountId || page.owner.platform !== platform) {
      throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', 'provider page owner must match the listener account and platform')
    }
    const conversations: ImInboundPageResult[] = []
    for (const group of page.conversations) {
      const scope: ImRealDeliveryScope = {
        kind: 'real', platform, accountId,
        conversationKind: group.conversationKind,
        conversationId: group.conversationId,
      }
      const prior = this.getConversationCursor(scope).platformCursor
      const result = await this.ingestInboundPage({
        operationId: group.operationId,
        scope,
        observedCursor: prior,
        nextCursor: prior,
        messages: group.messages.map(message => ({
          externalMessageId: message.externalMessageId,
          sender: this.classifyInboundSender(scope, message.senderEvidence),
          content: { text: message.text, format: message.format },
          occurredAt: message.occurredAt,
          ...(message.mentionedConfiguredAccount === undefined ? {} : { mentionedConfiguredAccount: message.mentionedConfiguredAccount }),
        })),
      })
      if (result.status !== 'applied') {
        throw new ImRuntimeError('IM_DELIVERY_SCOPE_INVALID', `provider conversation page '${group.operationId}' lost its cursor comparison`)
      }
      conversations.push(result)
    }
    const cursor = await this.commitProviderCursor({
      operationId: page.operationId,
      owner: page.owner,
      observedCursor: page.observedCursor,
      nextCursor: page.nextCursor,
      pages: page.conversations.map(group => ({
        scope: {
          kind: 'real' as const, platform, accountId,
          conversationKind: group.conversationKind,
          conversationId: group.conversationId,
        },
        operationId: group.operationId,
      })),
    })
    return { conversations, cursor }
  }

  /** Publish process listener facts without scheduling another reconciliation. */
  private publishListener(accountId: ImAccountId): void {
    const event: ImRuntimeChange = { revision: ++this.generation, kind: 'account-listener', accountId }
    try { this.ctx.emit('imRuntime/changed', event) } catch (error) {
      this.ctx.logger.warn(`IM runtime listener-state observer failed: ${String(error)}`)
    }
  }
}

export default ImRuntime
