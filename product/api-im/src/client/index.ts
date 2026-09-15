/** Generated IM namespace assembly and React-free configuration objects. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import imRemote from '@gestaltrun/dsh-api-im/remote'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ImAccountLifecycleRequest, ImAccountOperationQueryRequest, ImAccountSetupId, ImAccountSetupRequest,
  ImConfirmAccountSetupRequest, ImConfigurationBaseline, ImConfigurationFrame, ImPlatform,
  ImConfigurationReplacement, ImRemoveSimulationTargetRequest, ImRouteBatchRequest,
  ImRouteOperationQueryRequest, ImSaveSimulationTargetRequest, ImSetAccountPausedRequest,
  ImTargetOperationQueryRequest,
  ImDeliveryFollowRequest,
  ImCreateSimulationInstanceRequest, ImInjectSimulationManagedHumanRequest, ImInjectSimulationMemberRequest,
  ImSimulationInstanceId,
  ImSessionId,
  ImImportSimulationHistoryRequest, ImManualMessageQueryRequest, ImRetryManualMessageRequest, ImSendManualMessageRequest,
} from '../types.ts'
import { ImConfigurationModel } from './model.ts'
import type { ImConfigurationState } from './model.ts'
import { ImAccountCandidatesModel } from './candidates.ts'
import type { ImAccountCandidatesSource } from './candidates.ts'
import { ImDeliveryReader } from './delivery.ts'
import type { ImDeliverySource } from './delivery.ts'
import { ImSimulationInstancesReader, ImSimulationSessionReader } from './simulation.ts'
import type { ImSimulationInstancesSource, ImSimulationSessionSource } from './simulation.ts'
import { ImRealSessionReader } from './real-session.ts'
import type { ImRealSessionSource } from './real-session.ts'

export type * from '../types.ts'
export type { ImConfigurationState } from './model.ts'
export type { ImAccountCandidateState, ImAccountCandidatesSource, ImAccountCandidatesState } from './candidates.ts'
export type { ImDeliveryState, ImDeliverySource } from './delivery.ts'
export type { ImSimulationInstancesSource, ImSimulationInstancesState, ImSimulationSessionState, ImSimulationSessionSource } from './simulation.ts'
export type { ImRealSessionSource, ImRealSessionState } from './real-session.ts'
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
  readonly accountCandidates: ImAccountCandidatesSource
  readonly simulationInstances: ImSimulationInstancesSource
  /** @param request - immutable authoritative scope and selected pages. @returns reader; the caller disposes it when navigation changes. */
  watchDelivery(request: ImDeliveryFollowRequest): ImDeliverySource
  /** @param sessionId - exact Session selected by the app. @returns immutable binding reader; the caller disposes it on navigation. */
  watchSimulationSession(sessionId: ImSessionId): ImSimulationSessionSource
  /** @param sessionId - exact real Session selected by the app. @returns authoritative binding reader. */
  watchRealSession(sessionId: ImSessionId): ImRealSessionSource
  /** @param platform - platform selected for setup. @param signal - caller cancellation. @returns safe available identities. */
  listAccountCandidates(platform: ImPlatform, signal?: AbortSignal): ReturnType<ImRemote['listAccountCandidates']>
  /** @param request - candidate-bound write-only fields. @param signal - caller cancellation. @returns safe verified identity and a short-lived Host setup identifier. */
  previewAccountSetup(request: ImAccountSetupRequest, signal?: AbortSignal): ReturnType<ImRemote['previewAccountSetup']>
  /** @param request - retained setup and operation identifiers. @returns durable account-creation receipt. */
  confirmAccountSetup(request: ImConfirmAccountSetupRequest): ReturnType<ImRemote['confirmAccountSetup']>
  /** @param setupId - unconfirmed setup. @returns the actual release or confirmation state. */
  cancelAccountSetup(setupId: ImAccountSetupId): ReturnType<ImRemote['cancelAccountSetup']>
  /** @param request - account revision and desired pause state. @returns Host mutation receipt. */
  setAccountPaused(request: ImSetAccountPausedRequest): ReturnType<ImRemote['setAccountPaused']>
  /** @param request - account and revision observed when disconnection was confirmed. @returns durable acknowledgement without merging it over the follow projection. */
  disconnectAccount(request: ImAccountLifecycleRequest): ReturnType<ImRemote['disconnectAccount']>
  /** @param request - account and observed revision. @returns durable connection intent acknowledgement. */
  reconnectAccount(request: ImAccountLifecycleRequest): ReturnType<ImRemote['reconnectAccount']>
  /** @param request - account and observed revision. @param signal - caller cancellation. @returns safe authorization refresh acknowledgement. */
  refreshAccount(request: ImAccountLifecycleRequest, signal?: AbortSignal): ReturnType<ImRemote['refreshAccount']>
  /** @param request - retained account and operation identifiers. @returns durable receipt or explicit absence. */
  queryAccountOperation(request: ImAccountOperationQueryRequest): ReturnType<ImRemote['queryAccountOperation']>
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
  /** @returns all durable simulation instances. */
  listSimulationInstances(): ReturnType<ImRemote['listSimulationInstances']>
  /** @param instanceId - Host-minted identity. @returns durable state or absence. */
  getSimulationInstance(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['getSimulationInstance']>
  /** @param sessionId - either Session in a pair. @returns Host-authoritative peer and delivery facts. */
  scopeForSession(sessionId: ImSessionId): ReturnType<ImRemote['scopeForSession']>
  /** @param sessionId - real IM Session. @returns current binding or absence. */
  realScopeForSession(sessionId: ImSessionId): ReturnType<ImRemote['realScopeForSession']>
  /** @param request - retained manual-send identity and text. @param signal - caller cancellation. @returns durable delivery result. */
  sendManualMessage(request: ImSendManualMessageRequest, signal?: AbortSignal): ReturnType<ImRemote['sendManualMessage']>
  /** @param request - retained manual-send identity. @returns durable result or explicit absence. */
  queryManualMessage(request: ImManualMessageQueryRequest): ReturnType<ImRemote['queryManualMessage']>
  /** @param request - uncertain manual-send identity. @param signal - caller cancellation. @returns checked provider result. */
  confirmManualMessage(request: ImManualMessageQueryRequest, signal?: AbortSignal): ReturnType<ImRemote['confirmManualMessage']>
  /** @param request - distinct retry identity linked to an uncertain predecessor. @param signal - caller cancellation. @returns durable retry result. */
  retryManualMessage(request: ImRetryManualMessageRequest, signal?: AbortSignal): ReturnType<ImRemote['retryManualMessage']>
  /** @param request - local JSONL background and operation identity. @returns durable import receipt. */
  importSimulationHistory(request: ImImportSimulationHistoryRequest): ReturnType<ImRemote['importSimulationHistory']>
  /** @param request - selected target inputs for the current simulated-user Session. @returns created pair. */
  createSimulationInstance(request: ImCreateSimulationInstanceRequest): ReturnType<ImRemote['createSimulationInstance']>
  /** @param request - allow-listed member input. @returns shared-path inbound message. */
  injectSimulationMember(request: ImInjectSimulationMemberRequest): ReturnType<ImRemote['injectSimulationMember']>
  /** @param request - managed human input. @returns shared-path inbound message. */
  injectSimulationManagedHuman(request: ImInjectSimulationManagedHumanRequest): ReturnType<ImRemote['injectSimulationManagedHuman']>
  /** @param instanceId - exact operator-confirmed instance. @returns durable stopping or terminal state. */
  beginStopSimulation(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['beginStopSimulation']>
  /** @param instanceId - already-stopping instance. @returns final durable state. */
  waitSimulationStopped(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['waitSimulationStopped']>
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
  private readonly openSimulationSession: (sessionId: ImSessionId) => ImSimulationSessionReader
  private readonly openRealSession: (sessionId: ImSessionId) => ImRealSessionReader
  private readonly openDelivery: (request: ImDeliveryFollowRequest) => ImDeliveryReader
  private readonly candidates: ImAccountCandidatesModel
  readonly accountCandidates: ImAccountCandidatesSource
  private readonly instances: ImSimulationInstancesReader
  readonly simulationInstances: ImSimulationInstancesSource
  private readonly readers = new Set<ImDeliverySource>()
  private readonly simulationReaders = new Set<ImSimulationSessionSource>()
  private readonly realReaders = new Set<ImRealSessionSource>()

  constructor(ctx: Context) {
    super(ctx, 'im')
    const connection: ClientRemote = ctx.remote
    this.remote = connection.im
    this.openSimulationSession = sessionId => new ImSimulationSessionReader(connection, sessionId)
    this.openRealSession = sessionId => new ImRealSessionReader(connection, sessionId)
    this.openDelivery = request => new ImDeliveryReader(connection, request)
    this.candidates = new ImAccountCandidatesModel((platform, signal) => this.remote.listAccountCandidates(platform, signal))
    this.accountCandidates = this.candidates
    this.instances = new ImSimulationInstancesReader(ctx.remote)
    this.simulationInstances = this.instances
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
      this.candidates.dispose()
      await this.instances.dispose()
      await Promise.all([...this.readers].map(reader => reader.dispose()))
      this.readers.clear()
      await Promise.all([...this.simulationReaders].map(reader => reader.dispose()))
      this.simulationReaders.clear()
      await Promise.all([...this.realReaders].map(reader => reader.dispose()))
      this.realReaders.clear()
      await control.dispose()
    }, 'im-client: configuration follow')
    control.start()
  }

  watchSimulationSession(sessionId: ImSessionId): ImSimulationSessionSource {
    const reader = this.openSimulationSession(sessionId)
    const source: ImSimulationSessionSource = {
      getSnapshot: reader.getSnapshot,
      subscribe: reader.subscribe,
      dispose: async () => { this.simulationReaders.delete(source); await reader.dispose() },
    }
    this.simulationReaders.add(source)
    return source
  }

  watchRealSession(sessionId: ImSessionId): ImRealSessionSource {
    const reader = this.openRealSession(sessionId)
    const source: ImRealSessionSource = {
      getSnapshot: reader.getSnapshot,
      subscribe: reader.subscribe,
      dispose: async () => { this.realReaders.delete(source); await reader.dispose() },
    }
    this.realReaders.add(source)
    return source
  }

  watchDelivery(request: ImDeliveryFollowRequest): ImDeliverySource {
    const reader = this.openDelivery(request)
    const source: ImDeliverySource = {
      getSnapshot: reader.getSnapshot,
      subscribe: reader.subscribe,
      dispose: async () => { this.readers.delete(source); await reader.dispose() },
    }
    this.readers.add(source)
    return source
  }

  listAccountCandidates(platform: ImPlatform, signal?: AbortSignal): ReturnType<ImRemote['listAccountCandidates']> {
    return this.candidates.load(platform, signal)
  }

  previewAccountSetup(request: ImAccountSetupRequest, signal?: AbortSignal): ReturnType<ImRemote['previewAccountSetup']> {
    return this.remote.previewAccountSetup(request, signal)
  }

  confirmAccountSetup(request: ImConfirmAccountSetupRequest): ReturnType<ImRemote['confirmAccountSetup']> {
    return this.remote.confirmAccountSetup(request)
  }

  cancelAccountSetup(setupId: ImAccountSetupId): ReturnType<ImRemote['cancelAccountSetup']> {
    return this.remote.cancelAccountSetup(setupId)
  }

  setAccountPaused(request: ImSetAccountPausedRequest): ReturnType<ImRemote['setAccountPaused']> {
    return this.remote.setAccountPaused(request)
  }

  disconnectAccount(request: ImAccountLifecycleRequest): ReturnType<ImRemote['disconnectAccount']> {
    return this.remote.disconnectAccount(request)
  }

  reconnectAccount(request: ImAccountLifecycleRequest): ReturnType<ImRemote['reconnectAccount']> {
    return this.remote.reconnectAccount(request)
  }

  refreshAccount(request: ImAccountLifecycleRequest, signal?: AbortSignal): ReturnType<ImRemote['refreshAccount']> {
    return this.remote.refreshAccount(request, signal)
  }

  queryAccountOperation(request: ImAccountOperationQueryRequest): ReturnType<ImRemote['queryAccountOperation']> {
    return this.remote.queryAccountOperation(request)
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

  listSimulationInstances(): ReturnType<ImRemote['listSimulationInstances']> { return this.remote.listSimulationInstances() }
  getSimulationInstance(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['getSimulationInstance']> { return this.remote.getSimulationInstance(instanceId) }
  scopeForSession(sessionId: ImSessionId): ReturnType<ImRemote['scopeForSession']> { return this.remote.scopeForSession(sessionId) }
  realScopeForSession(sessionId: ImSessionId): ReturnType<ImRemote['realScopeForSession']> { return this.remote.realScopeForSession(sessionId) }
  sendManualMessage(request: ImSendManualMessageRequest, signal?: AbortSignal): ReturnType<ImRemote['sendManualMessage']> { return this.remote.sendManualMessage(request, signal) }
  queryManualMessage(request: ImManualMessageQueryRequest): ReturnType<ImRemote['queryManualMessage']> { return this.remote.queryManualMessage(request) }
  confirmManualMessage(request: ImManualMessageQueryRequest, signal?: AbortSignal): ReturnType<ImRemote['confirmManualMessage']> { return this.remote.confirmManualMessage(request, signal) }
  retryManualMessage(request: ImRetryManualMessageRequest, signal?: AbortSignal): ReturnType<ImRemote['retryManualMessage']> { return this.remote.retryManualMessage(request, signal) }
  importSimulationHistory(request: ImImportSimulationHistoryRequest): ReturnType<ImRemote['importSimulationHistory']> { return this.remote.importSimulationHistory(request) }
  createSimulationInstance(request: ImCreateSimulationInstanceRequest): ReturnType<ImRemote['createSimulationInstance']> { return this.remote.createSimulationInstance(request) }
  injectSimulationMember(request: ImInjectSimulationMemberRequest): ReturnType<ImRemote['injectSimulationMember']> { return this.remote.injectSimulationMember(request) }
  injectSimulationManagedHuman(request: ImInjectSimulationManagedHumanRequest): ReturnType<ImRemote['injectSimulationManagedHuman']> { return this.remote.injectSimulationManagedHuman(request) }
  beginStopSimulation(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['beginStopSimulation']> { return this.remote.beginStopSimulation(instanceId) }
  waitSimulationStopped(instanceId: ImSimulationInstanceId): ReturnType<ImRemote['waitSimulationStopped']> { return this.remote.waitSimulationStopped(instanceId) }
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
