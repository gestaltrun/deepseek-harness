import { expect, it } from 'vitest'
import type { AccountPoolSnapshot } from '../../src/account-pool.ts'
import { watchAccountPool } from '../../src/rpc/watch.ts'

it('starts with current state, coalesces slow readers, and unregisters a pending read on cancellation', async () => {
  const listeners = new Set<(snapshot: AccountPoolSnapshot) => void>()
  const initial: AccountPoolSnapshot = { state: 'starting', accounts: [] }
  const pool = { getSnapshot: () => initial, subscribe(listener: (snapshot: AccountPoolSnapshot) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } }
  const lifetime = new AbortController()
  const reader = watchAccountPool(pool, lifetime.signal)[Symbol.asyncIterator]()
  expect((await reader.next()).value).toBe(initial)
  for (const listener of listeners) listener({ state: 'ready', accounts: [] })
  for (const listener of listeners) listener({ state: 'error', accounts: [], error: 'unavailable' })
  expect((await reader.next()).value).toMatchObject({ state: 'error' })
  const pending = reader.next()
  lifetime.abort()
  expect(await pending).toEqual({ done: true, value: undefined })
  expect(listeners.size).toBe(0)
  expect((await reader.next()).done).toBe(true)
})
