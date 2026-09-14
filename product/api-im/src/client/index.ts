/** Generated IM namespace assembly and React-free configuration objects. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import imRemote from '@gestaltrun/dsh-api-im/remote'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ImAccountSetupRequest, ImConfigurationBaseline, ImConfigurationFrame,
  ImConfigurationReplacement, ImRemoveSimulationTargetRequest, ImRouteBatchRequest,
  ImRouteOperationQueryRequest, ImSaveSimulationTargetRequest, ImSetAccountPausedRequest,
  ImTargetOperationQueryRequest,
} from '../types.ts'
import { ImConfigurationModel } from './model.ts'
import type { ImConfigurationState } from './model.ts'

export type * from '../types.ts'
export type { ImConfigurationState } from './model.ts'
export type {} from '@gestaltrun/dsh-api-im/remote'

/** Generated IM configuration commands on the active Client connection. */
export type ImRemote = TypertClientRemote['im']

/** Snapshot source with stable identity and no React dependency. */
export interface ImConfigurationSource {
  /** @returns the latest usable configuration and follow state. */
  getSnapshot(): ImConfigurationState
  /** @param listener - observer. @returns the observer disposer. */
  subscribe(listener: () => void): () => void
}

/** Configuration object consumed by product UI adapters. */
export interface IImClient {
  readonly configuration: ImConfigurationSource
  /** @param request - write-only setup fields. @param signal - caller cancellation. @returns safe Host account facts. */
  connectAccount(request: ImAccountSetupRequest, signal?: AbortSignal): ReturnType<ImRemote['connectAccount']>
  /** @param request - account revision and desired pause state. @returns Host mutation receipt. */
  setAccountPaused(request: ImSetAccountPausedRequest): ReturnType<ImRemote['setAccountPaused']>
  /** @param request - independent route operations. @param signal - caller cancellation. @returns per-item outcomes. */
  applyRoutes(request: ImRouteBatchRequest, signal?: AbortSignal): ReturnType<ImRemote['applyRoutes']>
  /** @param request - owning account and operation identity. @returns durable receipt or absence. */
  queryRouteOperation(request: ImRouteOperationQueryRequest): ReturnType<ImRemote['queryRouteOperation']>
  /** @param request - target route and observed target revision. @returns durable receipt. */
  saveSimulationTarget(request: ImSaveSimulationTargetRequest): ReturnType<ImRemote['saveSimulationTarget']>
  /** @param request - workspace and observed target revision. @returns durable receipt. */
  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): ReturnType<ImRemote['removeSimulationTarget']>
  /** @param request - workspace and operation identity. @returns durable receipt or absence. */
  querySimulationTargetOperation(request: ImTargetOperationQueryRequest): ReturnType<ImRemote['querySimulationTargetOperation']>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Safe IM configuration projection and authoritative commands. */
    im: IImClient
  }
}

class ImClient extends Service implements IImClient {
  static inject = ['remote', 'remote.im']
  private readonly model = new ImConfigurationModel()
  readonly configuration: ImConfigurationSource = this.model
  private readonly remote: ImRemote

  constructor(ctx: Context) {
    super(ctx, 'im')
    this.remote = ctx.remote.im
    const stream = ctx.remote.$stream<ImConfigurationFrame>({
      name: 'IM configuration',
      open: signal => this.remote.follow(signal),
      ended: accepted => accepted
        ? new RemoteStreamCarrierError('IM configuration follow ended')
        : new Error('IM configuration follow ended before its baseline'),
      carrierFailed: () => { this.model.reconnecting() },
    })
    const control = new RemoteSnapshotStream<ImConfigurationBaseline, ImConfigurationReplacement>(stream, {
      name: 'IM configuration',
      isSnapshot: (frame): frame is ImConfigurationBaseline => frame.type === 'baseline',
      replace: frame => { this.model.replaceBaseline(frame) },
      update: frame => { this.model.replace(frame) },
      failed: error => { this.model.failed(error) },
    })
    ctx.effect(() => async () => {
      this.model.dispose()
      await control.dispose()
    }, 'im-client: configuration follow')
    control.start()
  }

  connectAccount(request: ImAccountSetupRequest, signal?: AbortSignal): ReturnType<ImRemote['connectAccount']> {
    return this.remote.connectAccount(request, signal)
  }

  setAccountPaused(request: ImSetAccountPausedRequest): ReturnType<ImRemote['setAccountPaused']> {
    return this.remote.setAccountPaused(request)
  }

  applyRoutes(request: ImRouteBatchRequest, signal?: AbortSignal): ReturnType<ImRemote['applyRoutes']> {
    return this.remote.applyRoutes(request, signal)
  }

  queryRouteOperation(request: ImRouteOperationQueryRequest): ReturnType<ImRemote['queryRouteOperation']> {
    return this.remote.queryRouteOperation(request)
  }

  saveSimulationTarget(request: ImSaveSimulationTargetRequest): ReturnType<ImRemote['saveSimulationTarget']> {
    return this.remote.saveSimulationTarget(request)
  }

  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): ReturnType<ImRemote['removeSimulationTarget']> {
    return this.remote.removeSimulationTarget(request)
  }

  querySimulationTargetOperation(request: ImTargetOperationQueryRequest): ReturnType<ImRemote['querySimulationTargetOperation']> {
    return this.remote.querySimulationTargetOperation(request)
  }
}

/** Only the generated namespace mount is required before assembly. */
export const inject = ['remote']

/**
 * Install generated IM commands before starting their Client object.
 * @param ctx - Client context providing the public Gateway service.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(imRemote)
  ctx.effect(() => unmount, 'im-client: generated namespace')
  await ctx.plugin(ImClient)
}
