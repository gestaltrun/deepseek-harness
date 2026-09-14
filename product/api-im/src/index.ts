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
}

export default ImApi
