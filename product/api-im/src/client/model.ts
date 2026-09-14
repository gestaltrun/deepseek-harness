/** React-free configuration projection; only follow frames publish business data. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { ImConfigurationBaseline, ImConfigurationReplacement, ImRuntimeSnapshot } from '../types.ts'

/** Current usable Host configuration and the state of its follow subscription. */
export interface ImConfigurationState {
  readonly phase: 'loading' | 'ready' | 'reconnecting' | 'error'
  readonly value: ImRuntimeSnapshot | undefined
  readonly error: string | undefined
}

/** Identity-stable observable consumed through renderer-bound hooks. */
export class ImConfigurationModel {
  private snapshot: ImConfigurationState = { phase: 'loading', value: undefined, error: undefined }
  private sequence = -1
  private disposed = false
  private notifyPending = false
  private readonly listeners = new Set<() => void>()

  /** @returns the same object until configuration or connection state changes. */
  readonly getSnapshot = (): ImConfigurationState => this.snapshot

  /** @param listener - change observer. @returns the observer disposer. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @param frame - the complete opening projection of the active generation. */
  replaceBaseline(frame: ImConfigurationBaseline): void {
    if (this.disposed) return
    if (frame.sequence !== 0) throw new Error('IM configuration baseline must start at sequence zero')
    this.sequence = 0
    this.publish({ phase: 'ready', value: frame.value, error: undefined })
  }

  /** @param frame - the next complete replacement in the active generation. */
  replace(frame: ImConfigurationReplacement): void {
    if (this.disposed) return
    if (this.sequence < 0 || frame.sequence !== this.sequence + 1) {
      throw new Error('IM configuration replacement sequence is not contiguous')
    }
    this.sequence = frame.sequence
    this.publish({ phase: 'ready', value: frame.value, error: undefined })
  }

  /** Retain the last usable projection while its carrier reconnects. */
  reconnecting(): void {
    if (this.disposed) return
    this.publish({ ...this.snapshot, phase: 'reconnecting' })
  }

  /** @param error - terminal follow failure; it never erases the last usable projection. */
  failed(error: unknown): void {
    if (this.disposed) return
    this.publish({ ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  /** Withdraw observers and suppress queued notifications and late responses. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private publish(value: ImConfigurationState): void {
    this.snapshot = value
    if (this.notifyPending) return
    this.notifyPending = true
    queueMicrotask(() => {
      this.notifyPending = false
      if (!this.disposed) notifySubscribers(this.listeners, 'IM configuration')
    })
  }
}
