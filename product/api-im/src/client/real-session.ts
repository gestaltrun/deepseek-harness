/** Immutable-Session real IM binding follows authoritative sender, target, and account facts. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { ImRealSessionFrame, ImRealSessionSnapshot } from '../types.ts'

type SessionId = ImRealSessionSnapshot['sessionId']

/** State of the real IM binding for one selected Session. */
export interface ImRealSessionState {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'error'
  readonly value: ImRealSessionSnapshot | undefined
  readonly error: string | undefined
}

/** Observable whose identity and Host stream are fixed to one Session. */
export interface ImRealSessionSource {
  /** @returns stable state until the Host binding or connection changes. */
  getSnapshot(): ImRealSessionState
  /** @param listener - state observer. @returns observer disposer. */
  subscribe(listener: () => void): () => void
  /** @returns after the stream closes and late frames can no longer publish. */
  dispose(): Promise<void>
}

type Baseline = Extract<ImRealSessionFrame, { readonly type: 'baseline' }>
type Replacement = Extract<ImRealSessionFrame, { readonly type: 'replace' }>

/** React-free reader used by one sidebar Session occurrence. */
export class ImRealSessionReader implements ImRealSessionSource {
  private state: ImRealSessionState = { phase: 'loading', value: undefined, error: undefined }
  private readonly listeners = new Set<() => void>()
  private readonly control: RemoteSnapshotStream<Baseline, Replacement>
  private sequence = -1
  private closed = false
  private noticePending = false

  /** @param remote - generated Gateway. @param sessionId - immutable selected Session. */
  constructor(remote: ClientRemote, sessionId: SessionId) {
    const stream = remote.$stream<ImRealSessionFrame>({
      name: 'IM real session',
      open: signal => remote.im.followRealSession(sessionId, signal),
      ended: accepted => accepted ? new RemoteStreamCarrierError('IM real session ended') : new Error('IM real session ended before its baseline'),
      carrierFailed: () => { this.publish({ ...this.state, phase: 'reconnecting' }) },
    })
    this.control = new RemoteSnapshotStream<Baseline, Replacement>(stream, {
      name: 'IM real session',
      isSnapshot: (frame): frame is Baseline => frame.type === 'baseline',
      replace: frame => {
        if (frame.sequence !== 0 || frame.value.sessionId !== sessionId) throw new Error('IM real baseline does not match its Session')
        this.sequence = 0
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      update: frame => {
        if (frame.sequence !== this.sequence + 1 || frame.value.sessionId !== sessionId) throw new Error('IM real replacement is not contiguous for its Session')
        this.sequence = frame.sequence
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      failed: error => { this.publish({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) }) },
    })
    this.control.start()
  }

  readonly getSnapshot = (): ImRealSessionState => this.state
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

  private publish(state: ImRealSessionState): void {
    if (this.closed) return
    this.state = state
    if (this.noticePending) return
    this.noticePending = true
    queueMicrotask(() => {
      this.noticePending = false
      if (!this.closed) notifySubscribers(this.listeners, 'IM real session')
    })
  }
}
