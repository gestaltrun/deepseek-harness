/** Host BFF for authoritative IM configuration and generated Remote methods. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ImAccountMutationResult, ImAccountSetupRequest, ImAccountView,
  ImConfigurationFrame, ImCreateRouteRequest, ImDeleteRouteRequest,
  ImRebindRouteRequest, ImRemoveSimulationTargetRequest, ImRouteBatchRequest,
  ImRouteBatchResult, ImRouteMutationResult, ImRouteOperationQuery,
  ImRouteOperationQueryRequest, ImRuntimeSnapshot, ImSaveRouteRequest,
  ImSaveSimulationTargetRequest, ImSetAccountPausedRequest,
  ImSimulationTargetMutationResult, ImSimulationTargetOperationQuery,
  ImTargetOperationQueryRequest,
} from './types.ts'
import { SnapshotFeed } from './snapshot-feed.ts'
import { applyRouteBatch } from './route-batch.ts'

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

  /** @param ctx - Host context containing the configured IM runtime. */
  constructor(ctx: Context) {
    super(ctx, 'imApi', { namespace: 'im' })
    this.feed = new SnapshotFeed({
      snapshot: () => ctx.imRuntime.snapshot(),
      subscribe: listener => ctx.imRuntime.subscribe(listener),
    })
    ctx.effect(() => () => { this.feed.dispose() }, 'im-api: configuration subscriptions')
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

  /**
   * Verify provider identity and persist its credentials through the Host.
   * @param request - write-only account setup fields.
   * @param signal - cancellation before account setup completes.
   * @returns only safe persisted account facts.
   */
  @Remote('connectAccount')
  connectAccount(request: ImAccountSetupRequest, signal: AbortSignal): Promise<ImAccountView> {
    return this.ctx.imRuntime.addAccount(request, signal)
  }

  /** @param request - observed account revision and desired pause state. @returns durable receipt. */
  @Remote('setAccountPaused')
  setAccountPaused(request: ImSetAccountPausedRequest): Promise<ImAccountMutationResult> {
    return this.ctx.imRuntime.setAccountPaused(request)
  }

  /** @param request - new route tuple and owner. @returns durable receipt or conflict. */
  @Remote('createRoute')
  createRoute(request: ImCreateRouteRequest): Promise<ImRouteMutationResult> {
    return this.ctx.imRuntime.createRoute(request)
  }

  /** @param request - existing route revision and behavior, without ownership fields. @returns durable receipt. */
  @Remote('saveRoute')
  saveRoute(request: ImSaveRouteRequest): Promise<ImRouteMutationResult> {
    return this.ctx.imRuntime.saveRoute(request)
  }

  /** @param request - explicitly confirmed source owner/revision and new owner. @returns durable receipt. */
  @Remote('rebindRoute')
  rebindRoute(request: ImRebindRouteRequest): Promise<ImRouteMutationResult> {
    return this.ctx.imRuntime.rebindRoute(request)
  }

  /** @param request - route revision and owner observed before confirmation. @returns durable receipt. */
  @Remote('deleteRoute')
  deleteRoute(request: ImDeleteRouteRequest): Promise<ImRouteMutationResult> {
    return this.ctx.imRuntime.deleteRoute(request)
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
  queryRouteOperation(request: ImRouteOperationQueryRequest): ImRouteOperationQuery {
    return this.ctx.imRuntime.queryRouteOperation(request.accountId, request.operationId)
  }

  /** @param request - target route and expected current target revision. @returns durable outcome. */
  @Remote('saveSimulationTarget')
  saveSimulationTarget(request: ImSaveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return this.ctx.imRuntime.saveSimulationTarget(request)
  }

  /** @param request - workspace and observed target revision. @returns durable outcome. */
  @Remote('removeSimulationTarget')
  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult> {
    return this.ctx.imRuntime.removeSimulationTarget(request)
  }

  /** @param request - workspace and operation identity. @returns stored outcome or explicit absence. */
  @Remote('querySimulationTargetOperation')
  querySimulationTargetOperation(request: ImTargetOperationQueryRequest): ImSimulationTargetOperationQuery {
    return this.ctx.imRuntime.querySimulationTargetOperation(request.workspaceId, request.operationId)
  }
}

export default ImApi
