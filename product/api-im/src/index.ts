/** Host BFF for authoritative IM configuration and generated Remote methods. */
import type {} from '@gestaltrun/dsh-im-runtime'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ImAccountCandidate, ImAccountLifecycleRequest, ImAccountMutationResult, ImAccountOperationQuery,
  ImAccountOperationQueryRequest, ImAccountSetupId, ImAccountSetupPreview, ImAccountSetupRequest,
  ImCancelAccountSetupResult, ImConfirmAccountSetupRequest, ImPlatform,
  ImConfigurationFrame, ImCreateRouteRequest, ImDeleteRouteRequest,
  ImRebindRouteRequest, ImRemoveSimulationTargetRequest, ImRouteBatchRequest,
  ImRouteBatchResult, ImRouteMutationResult, ImRouteOperationQuery,
  ImRouteOperationQueryRequest, ImRuntimeSnapshot, ImSaveRouteRequest,
  ImSaveSimulationTargetRequest, ImSetAccountPausedRequest,
  ImSimulationTargetMutationResult, ImSimulationTargetOperationQuery,
  ImTargetOperationQueryRequest,
  ImDeliveryFollowFrame, ImDeliveryFollowRequest, ImHistoryQueryRequest, ImHistoryPage, ImOutboundQueryRequest, ImOutboundPage,
  ImSimulationInstanceId, ImSimulationInstanceView, ImSimulationInstancesFrame, ImSimulationSessionFrame, ImSimulationSessionScope,
  ImCreateSimulationInstanceRequest, ImInjectSimulationMemberRequest, ImInjectSimulationManagedHumanRequest,
  ImInboundMessageView,
  ImSessionId,
  ImRealSessionBinding, ImRealSessionFrame, ImSendManualMessageRequest, ImManualMessageResult,
  ImManualMessageQueryRequest, ImManualMessageQuery, ImRetryManualMessageRequest,
  ImImportSimulationHistoryRequest, ImImportSimulationHistoryResult,
} from './types.ts'
import { SnapshotFeed } from './snapshot-feed.ts'
import { applyRouteBatch } from './route-batch.ts'
import { configurationResult } from './configuration-error.ts'
import { ImDeliveryFeed } from './delivery-feed.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** IM configuration BFF and generated Remote namespace owner. */
    imApi: ImApi
  }
}

/** Root IM configuration methods; account and route truth remain in imRuntime. */
export class ImApi extends TypertRemoteService {
  static inject = ['imRuntime']
  private readonly feed: SnapshotFeed<ImRuntimeSnapshot>
  private readonly delivery: ImDeliveryFeed

  /** @param ctx - Host context containing the configured IM runtime. */
  constructor(ctx: Context) {
    super(ctx, 'imApi', { namespace: 'im' })
    this.feed = new SnapshotFeed({
      snapshot: () => ctx.imRuntime.snapshot(),
      subscribe: listener => ctx.imRuntime.subscribe(listener),
    })
    this.delivery = new ImDeliveryFeed(ctx.imRuntime)
    ctx.effect(() => () => { this.feed.dispose(); this.delivery.dispose() }, 'im-api: subscriptions')
  }

  /** @returns current safe account, route, and target records. */
  @Remote('snapshot')
  snapshot(): ImRuntimeSnapshot {
    return this.ctx.imRuntime.snapshot()
  }

  /**
   * Follow durable configuration without a separate invalidation event channel.
   * @param signal - this connection generation's cancellation.
   * @returns complete baseline followed by ordered configuration replacements.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<ImConfigurationFrame> {
    return this.feed.follow(signal)
  }

  /** @param request - complete scope and bounded history page cursor. @returns durable inbound messages in ascending order. */
  @Remote('history')
  history(request: ImHistoryQueryRequest): Promise<ImHistoryPage> {
    return configurationResult(() => this.ctx.imRuntime.queryHistory(request))
  }

  /** @param request - complete scope and independent outbox page cursor. @returns durable outbound facts in ascending order. */
  @Remote('outbound')
  outbound(request: ImOutboundQueryRequest): Promise<ImOutboundPage> {
    return configurationResult(() => this.ctx.imRuntime.queryOutbound(request))
  }

  /** @param request - complete real or simulation scope and window size. @param signal - generation cancellation. @returns scope-isolated history and outbox replacements. */
  @Remote({ mode: 'stream' })
  followDelivery(request: ImDeliveryFollowRequest, signal: AbortSignal): AsyncIterable<ImDeliveryFollowFrame> {
    return this.delivery.follow(request, signal)
  }

  /**
   * Discover installed or admitted identities for account setup.
   * @param platform - platform selected by the operator.
   * @param signal - cancellation of candidate discovery.
   * @returns safe candidates from the registered provider.
   */
  @Remote('listAccountCandidates')
  listAccountCandidates(platform: ImPlatform, signal: AbortSignal): Promise<readonly ImAccountCandidate[]> {
    return configurationResult(() => this.ctx.imRuntime.listAccountCandidates(platform, signal))
  }

  /** @param request - candidate-bound write-only fields. @param signal - caller lifetime. @returns safe verified identity and a short-lived setup identifier. */
  @Remote('previewAccountSetup')
  previewAccountSetup(request: ImAccountSetupRequest, signal: AbortSignal): Promise<ImAccountSetupPreview> {
    return configurationResult(() => this.ctx.imRuntime.previewAccountSetup(request, signal))
  }

  /** @param request - Host setup and idempotency identifiers. @returns durable account-creation receipt. */
  @Remote('confirmAccountSetup')
  confirmAccountSetup(request: ImConfirmAccountSetupRequest): Promise<ImAccountMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.confirmAccountSetup(request))
  }

  /** @param setupId - unconfirmed Host setup. @returns its actual release or confirmation state. */
  @Remote('cancelAccountSetup')
  cancelAccountSetup(setupId: ImAccountSetupId): Promise<ImCancelAccountSetupResult> {
    return configurationResult(() => this.ctx.imRuntime.cancelAccountSetup(setupId))
  }

  /** @param request - observed account revision and desired pause state. @returns durable receipt. */
  @Remote('setAccountPaused')
  setAccountPaused(request: ImSetAccountPausedRequest): Promise<ImAccountMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.setAccountPaused(request))
  }

  /** @param request - account identity and revision observed before confirming disconnection. @returns durable intent change; rules and history remain retained. */
  @Remote('disconnectAccount')
  disconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.disconnectAccount(request))
  }

  /** @param request - account identity and observed revision. @returns durable connection intent; listener facts remain independent. */
  @Remote('reconnectAccount')
  reconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.reconnectAccount(request))
  }

  /** @param request - account identity and observed revision. @param signal - caller cancellation. @returns safe provider authorization facts committed under the observed revision. */
  @Remote('refreshAccount')
  refreshAccount(request: ImAccountLifecycleRequest, signal: AbortSignal): Promise<ImAccountMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.refreshAccount(request, signal))
  }

  /** @param request - account and operation identifiers retained by the caller. @returns durable receipt or explicit absence. */
  @Remote('queryAccountOperation')
  queryAccountOperation(request: ImAccountOperationQueryRequest): Promise<ImAccountOperationQuery> {
    return configurationResult(() => this.ctx.imRuntime.queryAccountOperation(request.accountId, request.operationId))
  }

  /** @param request - new route tuple and owner. @returns durable receipt or conflict. */
  @Remote('createRoute')
  createRoute(request: ImCreateRouteRequest): Promise<ImRouteMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.createRoute(request))
  }

  /** @param request - existing route revision and behavior, without ownership fields. @returns durable receipt. */
  @Remote('saveRoute')
  saveRoute(request: ImSaveRouteRequest): Promise<ImRouteMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.saveRoute(request))
  }

  /** @param request - explicitly confirmed source owner/revision and new owner. @returns durable receipt. */
  @Remote('rebindRoute')
  rebindRoute(request: ImRebindRouteRequest): Promise<ImRouteMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.rebindRoute(request))
  }

  /** @param request - route revision and owner observed before confirmation. @returns durable receipt. */
  @Remote('deleteRoute')
  deleteRoute(request: ImDeleteRouteRequest): Promise<ImRouteMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.deleteRoute(request))
  }

  /**
   * Apply every editor target under its own operation identity.
   * @param request - independent operations preserving their observed revisions.
   * @param signal - stops starting later operations after cancellation.
   * @returns per-target receipts; unknown items must be queried before retrying.
   */
  @Remote('applyRoutes')
  applyRoutes(request: ImRouteBatchRequest, signal: AbortSignal): Promise<ImRouteBatchResult> {
    return applyRouteBatch(this.ctx.imRuntime, request, signal)
  }

  /** @param request - owning account and operation identity. @returns stored outcome or explicit absence. */
  @Remote('queryRouteOperation')
  queryRouteOperation(request: ImRouteOperationQueryRequest): Promise<ImRouteOperationQuery> {
    return configurationResult(() => this.ctx.imRuntime.queryRouteOperation(request.accountId, request.operationId))
  }

  /** @param request - target route and expected current target revision. @returns durable outcome. */
  @Remote('saveSimulationTarget')
  saveSimulationTarget(request: ImSaveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.saveSimulationTarget(request))
  }

  /** @param request - workspace and observed target revision. @returns durable outcome. */
  @Remote('removeSimulationTarget')
  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return configurationResult(() => this.ctx.imRuntime.removeSimulationTarget(request))
  }

  /** @param request - workspace and operation identity. @returns stored outcome or explicit absence. */
  @Remote('querySimulationTargetOperation')
  querySimulationTargetOperation(request: ImTargetOperationQueryRequest): Promise<ImSimulationTargetOperationQuery> {
    return configurationResult(() => this.ctx.imRuntime.querySimulationTargetOperation(request.workspaceId, request.operationId))
  }

  /** @returns every durable simulation instance in creation order. */
  @Remote('listSimulationInstances')
  listSimulationInstances(): readonly ImSimulationInstanceView[] {
    return this.ctx.imRuntime.listSimulationInstances()
  }

  /** @param signal - this connection generation's cancellation. @returns complete instance lists after each durable simulation change. */
  @Remote({ mode: 'stream' })
  followSimulationInstances(signal: AbortSignal): AsyncIterable<ImSimulationInstancesFrame> {
    const feed = new SnapshotFeed({
      snapshot: () => this.ctx.imRuntime.listSimulationInstances(),
      subscribe: listener => this.ctx.imRuntime.subscribe(change => { if (change.kind === 'simulation-instance') listener() }),
    })
    return feed.follow(signal)
  }

  /** @param instanceId - Host-minted simulation identity. @returns its durable state or absence. */
  @Remote('getSimulationInstance')
  getSimulationInstance(instanceId: ImSimulationInstanceId): ImSimulationInstanceView | undefined {
    return this.ctx.imRuntime.getSimulationInstance(instanceId)
  }

  /** @param sessionId - either side of a simulation pair. @returns Host-authoritative navigation and delivery facts. */
  @Remote('scopeForSession')
  scopeForSession(sessionId: ImSessionId): ImSimulationSessionScope | undefined {
    return this.ctx.imRuntime.scopeForSession(sessionId)
  }

  /**
   * Follow the simulation bound to one Session without inferring role or peer identity in the Client.
   * @param sessionId - immutable selected Session identity.
   * @param signal - this navigation generation's cancellation.
   * @returns complete binding baseline followed by durable instance replacements.
   */
  @Remote({ mode: 'stream' })
  followSimulationSession(sessionId: ImSessionId, signal: AbortSignal): AsyncIterable<ImSimulationSessionFrame> {
    const feed = new SnapshotFeed({
      snapshot: () => configurationResult(() => {
        const scope = this.ctx.imRuntime.scopeForSession(sessionId)
        const instance = scope === undefined ? undefined : this.ctx.imRuntime.getSimulationInstance(scope.instanceId)
        return { sessionId, ...(scope === undefined ? {} : { scope }), ...(instance === undefined ? {} : { instance }) }
      }),
      subscribe: listener => this.ctx.imRuntime.subscribe(change => { if (change.kind === 'simulation-instance') listener() }),
    })
    return feed.follow(signal)
  }

  /** @param sessionId - real IM Session. @returns durable execution binding and safe sender/target facts, or absence. */
  @Remote('realScopeForSession')
  realScopeForSession(sessionId: ImSessionId): ImRealSessionBinding | undefined {
    return this.ctx.imRuntime.realScopeForSession(sessionId)
  }

  /** @param sessionId - selected Session. @param signal - connection generation. @returns ordered binding replacements. */
  @Remote({ mode: 'stream' })
  followRealSession(sessionId: ImSessionId, signal: AbortSignal): AsyncIterable<ImRealSessionFrame> {
    const feed = new SnapshotFeed({
      snapshot: () => configurationResult(() => {
        const binding = this.ctx.imRuntime.realScopeForSession(sessionId)
        return { sessionId, ...(binding === undefined ? {} : { binding }) }
      }),
      subscribe: listener => {
        const configuration = this.ctx.imRuntime.subscribe(listener)
        const delivery = this.ctx.imRuntime.subscribeDelivery(listener)
        return () => { configuration(); delivery() }
      },
    })
    return feed.follow(signal)
  }

  /** @param request - Session-bound idempotent manual message. @param signal - caller cancellation. @returns durable send result. */
  @Remote('sendManualMessage')
  sendManualMessage(request: ImSendManualMessageRequest, signal: AbortSignal): Promise<ImManualMessageResult> {
    return configurationResult(() => this.ctx.imRuntime.sendManualMessage(request, signal))
  }

  /** @param request - retained Session and message identity. @returns durable result or explicit absence. */
  @Remote('queryManualMessage')
  queryManualMessage(request: ImManualMessageQueryRequest): Promise<ImManualMessageQuery> {
    return configurationResult(() => this.ctx.imRuntime.queryManualMessage(request))
  }

  /** @param request - uncertain Session-bound message. @param signal - caller cancellation. @returns provider-confirmed or still-unknown result. */
  @Remote('confirmManualMessage')
  confirmManualMessage(request: ImManualMessageQueryRequest, signal: AbortSignal): Promise<ImManualMessageResult> {
    return configurationResult(() => this.ctx.imRuntime.confirmManualMessage(request, signal))
  }

  /** @param request - new identity linked to one uncertain message. @param signal - caller cancellation. @returns distinct durable retry result. */
  @Remote('retryManualMessage')
  retryManualMessage(request: ImRetryManualMessageRequest, signal: AbortSignal): Promise<ImManualMessageResult> {
    return configurationResult(() => this.ctx.imRuntime.retryManualMessage(request, signal))
  }

  /** @param request - local JSONL background file and operation identity. @returns durable import receipt and instance. */
  @Remote('importSimulationHistory')
  importSimulationHistory(request: ImImportSimulationHistoryRequest): Promise<ImImportSimulationHistoryResult> {
    return configurationResult(() => this.ctx.imRuntime.importSimulationHistory(request))
  }

  /** @param request - live simulated-user Session and its bounded participant inputs. @returns durable pair after tested Session creation. */
  @Remote('createSimulationInstance')
  createSimulationInstance(request: ImCreateSimulationInstanceRequest): Promise<ImSimulationInstanceView> {
    return configurationResult(() => this.ctx.imRuntime.createSimulationInstance(request))
  }

  /** @param request - allow-listed simulated participant and text. @returns shared-path inbound message. */
  @Remote('injectSimulationMember')
  injectSimulationMember(request: ImInjectSimulationMemberRequest): Promise<ImInboundMessageView> {
    return configurationResult(() => this.ctx.imRuntime.injectSimulationMember(request))
  }

  /** @param request - instance and text; Host derives the frozen managed actor. @returns shared-path inbound message. */
  @Remote('injectSimulationManagedHuman')
  injectSimulationManagedHuman(request: ImInjectSimulationManagedHumanRequest): Promise<ImInboundMessageView> {
    return configurationResult(() => this.ctx.imRuntime.injectSimulationManagedHuman(request))
  }

  /** @param instanceId - exact instance confirmed by the operator. @returns durable stopping or terminal state. */
  @Remote('beginStopSimulation')
  beginStopSimulation(instanceId: ImSimulationInstanceId): Promise<ImSimulationInstanceView> {
    return configurationResult(() => this.ctx.imRuntime.beginStopSimulation(instanceId))
  }

  /** @param instanceId - already-stopping instance. @returns its terminal state after both Sessions quiesce. */
  @Remote('waitSimulationStopped')
  waitSimulationStopped(instanceId: ImSimulationInstanceId): Promise<ImSimulationInstanceView> {
    return configurationResult(() => this.ctx.imRuntime.waitSimulationStopped(instanceId))
  }
}

export default ImApi
