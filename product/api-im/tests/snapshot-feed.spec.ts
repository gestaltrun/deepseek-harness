import { describe, expect, it } from 'vitest'
import { SnapshotFeed } from '../src/snapshot-feed.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('configuration follow lifecycle', () => {
  it('keeps a change arriving during the opening read after its baseline', async () => {
    const opening = deferred<string>()
    let notify: (() => void) | undefined
    let value = 'initial'
    let first = true
    const feed = new SnapshotFeed({
      snapshot: () => {
        if (first) { first = false; return opening.promise }
        return value
      },
      subscribe: listener => { notify = listener; return () => { notify = undefined } },
    })
    const signal = new AbortController()
    const stream = feed.follow(signal.signal)[Symbol.asyncIterator]()
    try {
      const baseline = stream.next()
      value = 'changed'
      notify?.()
      opening.resolve('initial')
      expect(await baseline).toEqual({ done: false, value: { type: 'baseline', sequence: 0, value: 'initial' } })
      expect(await stream.next()).toEqual({ done: false, value: { type: 'replace', sequence: 1, value: 'changed' } })
      const pending = stream.next()
      signal.abort()
      expect(await pending).toEqual({ done: true, value: undefined })
      expect(notify).toBeUndefined()
    } finally {
      signal.abort()
      await stream.return?.()
      feed.dispose()
    }
  })

  it('coalesces a slow reader to the latest complete snapshot', async () => {
    let value = 0
    let notify: (() => void) | undefined
    const feed = new SnapshotFeed({
      snapshot: () => value,
      subscribe: listener => { notify = listener; return () => { notify = undefined } },
    })
    const signal = new AbortController()
    const stream = feed.follow(signal.signal)[Symbol.asyncIterator]()
    try {
      expect((await stream.next()).value).toEqual({ type: 'baseline', sequence: 0, value: 0 })
      for (value = 1; value < 100; value++) notify?.()
      value = 100
      notify?.()
      expect((await stream.next()).value).toEqual({ type: 'replace', sequence: 1, value: 100 })
      const pending = stream.next()
      feed.dispose()
      expect(await pending).toEqual({ done: true, value: undefined })
      expect(notify).toBeUndefined()
    } finally {
      signal.abort()
      await stream.return?.()
      feed.dispose()
    }
  })

  it('detaches failed opening reads and rejects follow after disposal', async () => {
    const failure = new Error('storage unavailable')
    let subscribed = false
    const feed = new SnapshotFeed({
      snapshot: () => { throw failure },
      subscribe: () => { subscribed = true; return () => { subscribed = false } },
    })
    await expect(feed.follow(new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toBe(failure)
    expect(subscribed).toBe(false)
    feed.dispose()
    await expect(feed.follow(new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow('disposed')
  })

  it('detaches a reader suspended at its baseline on disposal', async () => {
    let subscribed = false
    const feed = new SnapshotFeed({
      snapshot: () => 'baseline',
      subscribe: () => { subscribed = true; return () => { subscribed = false } },
    })
    const stream = feed.follow(new AbortController().signal)[Symbol.asyncIterator]()
    await stream.next()
    feed.dispose()
    expect(subscribed).toBe(false)
    await stream.return?.()
  })
})
