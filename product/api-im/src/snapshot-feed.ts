/** Complete configuration snapshots with bounded, coalesced change observation. */

/** Opening snapshot or a complete replacement within one follow generation. */
export type SnapshotFrame<Value> = {
  readonly type: 'baseline' | 'replace'
  readonly sequence: number
  readonly value: Value
}

/** Authoritative reads and post-commit invalidations owned by one runtime. */
export interface SnapshotSource<Value> {
  /** @returns the current complete configuration projection. */
  snapshot(): Value | Promise<Value>
  /**
   * Observe committed changes before starting the opening read.
   * @param listener - invalidation callback; each read obtains a complete snapshot.
   * @returns the subscription disposer.
   */
  subscribe(listener: () => void): () => void
}

/** Coalesces invalidations while each reader is suspended, without losing an opening-read race. */
export class SnapshotFeed<Value> {
  private readonly lifetime = new AbortController()

  /** @param source - authoritative snapshot and change observation. */
  constructor(private readonly source: SnapshotSource<Value>) {}

  /**
   * Begin one ordered stream with a complete snapshot.
   * @param signal - cancellation of this Remote follow generation.
   * @returns baseline followed by complete replacements; cancellation removes the subscription.
   */
  async *follow(signal: AbortSignal): AsyncIterable<SnapshotFrame<Value>> {
    if (this.lifetime.signal.aborted) throw new Error('IM configuration feed is disposed')
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    let changes = 0
    let observed = 0
    let sequence = 0
    let wake: (() => void) | undefined
    const unsubscribe = this.source.subscribe(() => { changes++; wake?.() })
    let subscribed = true
    const close = (): void => {
      if (!subscribed) return
      subscribed = false
      lifetime.removeEventListener('abort', close)
      unsubscribe()
      wake?.()
    }
    lifetime.addEventListener('abort', close, { once: true })
    try {
      const value = await this.source.snapshot()
      if (lifetime.aborted) return
      yield { type: 'baseline', sequence, value }
      while (!lifetime.aborted) {
        if (observed === changes) {
          await new Promise<void>(resolve => {
            const done = (): void => {
              lifetime.removeEventListener('abort', done)
              wake = undefined
              resolve()
            }
            wake = done
            lifetime.addEventListener('abort', done, { once: true })
          })
        }
        if (lifetime.aborted) return
        observed = changes
        const next = await this.source.snapshot()
        if (lifetime.aborted) return
        yield { type: 'replace', sequence: ++sequence, value: next }
      }
    } finally {
      close()
    }
  }

  /** End current generations and reject subsequent subscriptions. */
  dispose(): void {
    this.lifetime.abort()
  }
}
