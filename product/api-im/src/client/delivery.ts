/** Immutable-scope delivery subscriptions own all live and historical page state. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import { RemoteSnapshotStream, RemoteStreamCarrierError, type ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { ImDeliveryFollowFrame, ImDeliveryFollowRequest, ImDeliverySnapshot } from '../types.ts'

/** State of one scope and its independently selected inbound and outbound pages. */
export interface ImDeliveryState {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'error'
  readonly value: ImDeliverySnapshot | undefined
  readonly error: string | undefined
}

/** Observable delivery reader whose caller owns its disposal. */
export interface ImDeliverySource {
  /** @returns identity-stable current state until a page or connection changes. */
  getSnapshot(): ImDeliveryState
  /** @param listener - state observer. @returns the observer disposer. */
  subscribe(listener: () => void): () => void
  /** @returns after the stream closes and no late callback can publish. */
  dispose(): Promise<void>
}

type Baseline = Extract<ImDeliveryFollowFrame, { readonly type: 'baseline' }>
type Replacement = Extract<ImDeliveryFollowFrame, { readonly type: 'replace' }>

/** One read model never changes scopes; navigation replaces and disposes the reader. */
export class ImDeliveryReader implements ImDeliverySource {
  private state: ImDeliveryState = { phase: 'loading', value: undefined, error: undefined }
  private readonly listeners = new Set<() => void>()
  private readonly control: RemoteSnapshotStream<Baseline, Replacement>
  private sequence = -1
  private closed = false
  private noticePending = false

  /** @param remote - generated Gateway. @param request - immutable complete scope and selected pages. */
  constructor(remote: ClientRemote, request: ImDeliveryFollowRequest) {
    const stream = remote.$stream<ImDeliveryFollowFrame>({
      name: 'IM conversation history',
      open: signal => remote.im.followDelivery(request, signal),
      ended: accepted => accepted ? new RemoteStreamCarrierError('IM conversation history ended') : new Error('IM conversation history ended before its baseline'),
      carrierFailed: () => { this.publish({ ...this.state, phase: 'reconnecting' }) },
    })
    this.control = new RemoteSnapshotStream<Baseline, Replacement>(stream, {
      name: 'IM conversation history',
      isSnapshot: (frame): frame is Baseline => frame.type === 'baseline',
      replace: frame => {
        if (frame.sequence !== 0) throw new Error('IM conversation baseline must start at sequence zero')
        this.sequence = 0
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      update: frame => {
        if (frame.sequence !== this.sequence + 1) throw new Error('IM conversation replacement sequence is not contiguous')
        this.sequence = frame.sequence
        this.publish({ phase: 'ready', value: frame.value, error: undefined })
      },
      failed: error => { this.publish({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : String(error) }) },
    })
    this.control.start()
  }

  /** @returns the latest state of this immutable scope reader. */
  readonly getSnapshot = (): ImDeliveryState => this.state

  /** @param listener - observer. @returns observer disposer. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.closed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Close this reader before navigation binds another scope. */
  async dispose(): Promise<void> {
    this.closed = true
    this.listeners.clear()
    await this.control.dispose()
  }

  private publish(state: ImDeliveryState): void {
    if (this.closed) return
    this.state = state
    if (this.noticePending) return
    this.noticePending = true
    queueMicrotask(() => {
      this.noticePending = false
      if (!this.closed) notifySubscribers(this.listeners, 'IM conversation')
    })
  }
}
