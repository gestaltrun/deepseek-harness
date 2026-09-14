/** Immutable-Session simulation subscriptions preserve Host role and peer facts. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { ImSimulationInstanceView, ImSimulationInstancesFrame, ImSimulationSessionFrame, ImSimulationSessionSnapshot } from '../types.ts'

type SessionId = ImSimulationSessionSnapshot['sessionId']

/** State of the durable simulation-instance list. */
export interface ImSimulationInstancesState {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'error'
  readonly value: readonly ImSimulationInstanceView[] | undefined
  readonly error: string | undefined
}

/** Stable global source used to decorate every visible Session row. */
export interface ImSimulationInstancesSource {
  /** @returns the latest complete durable instance list. */
  getSnapshot(): ImSimulationInstancesState
  /** @param listener - state observer. @returns observer disposer. */
  subscribe(listener: () => void): () => void
}

/** State of the simulation binding for one selected Session. */
export interface ImSimulationSessionState {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'error'
  readonly value: ImSimulationSessionSnapshot | undefined
  readonly error: string | undefined
}

/** Observable whose identity and Host stream are fixed to one Session. */
export interface ImSimulationSessionSource {
  /** @returns stable state until the Host binding or connection changes. */
  getSnapshot(): ImSimulationSessionState
  /** @param listener - state observer. @returns observer disposer. */
  subscribe(listener: () => void): () => void
  /** @returns after the stream closes and late frames can no longer publish. */
  dispose(): Promise<void>
}

type Baseline = Extract<ImSimulationSessionFrame, { readonly type: 'baseline' }>
type Replacement = Extract<ImSimulationSessionFrame, { readonly type: 'replace' }>

type InstancesBaseline = Extract<ImSimulationInstancesFrame, { readonly type: 'baseline' }>
type InstancesReplacement = Extract<ImSimulationInstancesFrame, { readonly type: 'replace' }>

/** React-free process-lifetime projection of every durable simulation instance. */
export class ImSimulationInstancesReader implements ImSimulationInstancesSource {
  private state: ImSimulationInstancesState = { phase: 'loading', value: undefined, error: undefined }
  private readonly listeners = new Set<() => void>()
  private readonly control: RemoteSnapshotStream<InstancesBaseline, InstancesReplacement>
  private sequence = -1
  private closed = false
  private noticePending = false

  /** @param remote - generated Gateway carrying the instance-list follow. */
  constructor(remote: ClientRemote) {
    const stream = remote.$stream<ImSimulationInstancesFrame>({
      name: 'IM simulation instances',
      open: signal => remote.im.followSimulationInstances(signal),
      ended: accepted => accepted ? new RemoteStreamCarrierError('IM simulation instances ended') : new Error('IM simulation instances ended before its baseline'),
      carrierFailed: () => { this.publish({ ...this.state, phase: 'reconnecting' }) },
    })
    this.control = new RemoteSnapshotStream<InstancesBaseline, InstancesReplacement>(stream, {
      name: 'IM simulation instances',
      isSnapshot: (frame): frame is InstancesBaseline => frame.type === 'baseline',
      replace: frame => {
        if (frame.sequence !== 0) throw new Error('IM simulation instances baseline does not start at zero')
        this.sequence = 0
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      update: frame => {
        if (frame.sequence !== this.sequence + 1) throw new Error('IM simulation instances replacement is not contiguous')
        this.sequence = frame.sequence
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      failed: error => { this.publish({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) }) },
    })
    this.control.start()
  }

  readonly getSnapshot = (): ImSimulationInstancesState => this.state
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.listeners.clear()
    await this.control.dispose()
  }

  private publish(state: ImSimulationInstancesState): void {
    if (this.closed) return
    this.state = state
    if (this.noticePending) return
    this.noticePending = true
    queueMicrotask(() => {
      this.noticePending = false
      if (!this.closed) notifySubscribers(this.listeners, 'IM simulation instances')
    })
  }
}

/** React-free reader used by one sidebar Session occurrence. */
export class ImSimulationSessionReader implements ImSimulationSessionSource {
  private state: ImSimulationSessionState = { phase: 'loading', value: undefined, error: undefined }
  private readonly listeners = new Set<() => void>()
  private readonly control: RemoteSnapshotStream<Baseline, Replacement>
  private sequence = -1
  private closed = false
  private noticePending = false

  /** @param remote - generated Gateway. @param sessionId - immutable selected Session. */
  constructor(remote: ClientRemote, sessionId: SessionId) {
    const stream = remote.$stream<ImSimulationSessionFrame>({
      name: 'IM simulation session',
      open: signal => remote.im.followSimulationSession(sessionId, signal),
      ended: accepted => accepted ? new RemoteStreamCarrierError('IM simulation session ended') : new Error('IM simulation session ended before its baseline'),
      carrierFailed: () => { this.publish({ ...this.state, phase: 'reconnecting' }) },
    })
    this.control = new RemoteSnapshotStream<Baseline, Replacement>(stream, {
      name: 'IM simulation session',
      isSnapshot: (frame): frame is Baseline => frame.type === 'baseline',
      replace: frame => {
        if (frame.sequence !== 0 || frame.value.sessionId !== sessionId) throw new Error('IM simulation baseline does not match its Session')
        this.sequence = 0
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      update: frame => {
        if (frame.sequence !== this.sequence + 1 || frame.value.sessionId !== sessionId) throw new Error('IM simulation replacement is not contiguous for its Session')
        this.sequence = frame.sequence
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      failed: error => { this.publish({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) }) },
    })
    this.control.start()
  }

  readonly getSnapshot = (): ImSimulationSessionState => this.state
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.listeners.clear()
    await this.control.dispose()
  }

  private publish(state: ImSimulationSessionState): void {
    if (this.closed) return
    this.state = state
    if (this.noticePending) return
    this.noticePending = true
    queueMicrotask(() => {
      this.noticePending = false
      if (!this.closed) notifySubscribers(this.listeners, 'IM simulation session')
    })
  }
}
