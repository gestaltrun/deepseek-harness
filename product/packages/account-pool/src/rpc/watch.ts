/** Cancellable latest-snapshot streams without unbounded queues. */
import type { AccountPool, AccountPoolSnapshot } from '../account-pool.ts'

/**
 * Subscribe before reading the initial snapshot, coalescing updates for a slow reader.
 * @param pool - committed snapshot owner.
 * @param signal - combined request and RPC owner lifetime.
 * @returns complete snapshots; cancellation ends pending reads and unregisters immediately.
 */
export function watchAccountPool(pool: Pick<AccountPool, 'getSnapshot' | 'subscribe'>, signal: AbortSignal): AsyncIterable<AccountPoolSnapshot> {
  return {
    [Symbol.asyncIterator]() {
      let pending: AccountPoolSnapshot | undefined
      let waiting: ((result: IteratorResult<AccountPoolSnapshot>) => void) | undefined
      let closed = false
      const receive = (snapshot: AccountPoolSnapshot): void => {
        if (closed) return
        if (waiting === undefined) pending = snapshot
        else {
          const resolve = waiting
          waiting = undefined
          resolve({ done: false, value: snapshot })
        }
      }
      const unsubscribe = pool.subscribe(receive)
      const close = (): void => {
        if (closed) return
        closed = true
        unsubscribe()
        signal.removeEventListener('abort', close)
        pending = undefined
        waiting?.({ done: true, value: undefined })
        waiting = undefined
      }
      signal.addEventListener('abort', close, { once: true })
      if (signal.aborted) close()
      else receive(pool.getSnapshot())
      return {
        next(): Promise<IteratorResult<AccountPoolSnapshot>> {
          if (closed) return Promise.resolve({ done: true, value: undefined })
          if (pending !== undefined) {
            const value = pending
            pending = undefined
            return Promise.resolve({ done: false, value })
          }
          if (waiting !== undefined) return Promise.reject(new Error('Account snapshot reads must be sequential.'))
          return new Promise(resolve => { waiting = resolve })
        },
        return(): Promise<IteratorResult<AccountPoolSnapshot>> {
          close()
          return Promise.resolve({ done: true, value: undefined })
        },
      }
    },
  }
}
