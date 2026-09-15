import { describe, expect, it } from 'vitest'
import { ImAccountCandidatesModel } from '../src/client/candidates.ts'
import type { ImAccountCandidate } from '../src/types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}

describe('account candidate objects', () => {
  it('does not replace a newer discovery with a late response', async () => {
    const old = deferred<RemoteResult<readonly ImAccountCandidate[]>>()
    const current = deferred<RemoteResult<readonly ImAccountCandidate[]>>()
    let first = true
    const model = new ImAccountCandidatesModel(() => {
      if (first) { first = false; return old.promise }
      return current.promise
    })
    const previous = model.load('dingtalk')
    const latest = model.load('dingtalk')
    current.resolve({ ok: true, value: [{ platform: 'dingtalk', profile: 'current', displayName: 'Current' }] })
    await latest
    old.resolve({ ok: true, value: [{ platform: 'dingtalk', profile: 'old', displayName: 'Old' }] })
    await previous
    expect(model.getSnapshot().dingtalk).toEqual({
      phase: 'ready', items: [{ platform: 'dingtalk', profile: 'current', displayName: 'Current' }], error: undefined,
    })
    expect(model.getSnapshot().wangwang.phase).toBe('idle')
    model.dispose()
  })

  it('withdraws observers and discards discovery after disposal', async () => {
    const result = deferred<RemoteResult<readonly ImAccountCandidate[]>>()
    const model = new ImAccountCandidatesModel(() => result.promise)
    let notices = 0
    model.subscribe(() => { notices++ })
    const loading = model.load('wangwang')
    model.dispose()
    result.resolve({ ok: true, value: [{ platform: 'wangwang', candidateId: 'late', endpoint: 'https://wangwang.invalid', displayName: 'Late' }] })
    await loading
    expect(notices).toBe(0)
    expect(model.getSnapshot().wangwang.items).toEqual([])
  })

  it('retains available choices when a refresh is cancelled', async () => {
    const pending = deferred<RemoteResult<readonly ImAccountCandidate[]>>()
    let first = true
    const model = new ImAccountCandidatesModel(async () => {
      if (!first) return pending.promise
      first = false
      return { ok: true, value: [{ platform: 'dingtalk', profile: 'employee', displayName: 'Employee' }] }
    })
    await model.load('dingtalk')
    const stable = model.getSnapshot().dingtalk
    const signal = new AbortController()
    const refreshing = model.load('dingtalk', signal.signal)
    signal.abort()
    pending.resolve({ ok: true, value: [] })
    await refreshing
    expect(model.getSnapshot().dingtalk).toBe(stable)
    model.dispose()
  })
})
