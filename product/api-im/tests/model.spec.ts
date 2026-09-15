import { describe, expect, it } from 'vitest'
import { ImConfigurationModel } from '../src/client/model.ts'
import type { ImRuntimeSnapshot } from '../src/types.ts'

const value = (revision: number): ImRuntimeSnapshot => ({ revision, accounts: [], routes: [], simulationTargets: [] })

describe('Client IM configuration projection', () => {
  it('replaces every reconnect baseline and rejects skipped increments', () => {
    const model = new ImConfigurationModel()
    expect(model.getSnapshot()).toBe(model.getSnapshot())
    model.replaceBaseline({ type: 'baseline', sequence: 0, value: value(8) })
    model.replace({ type: 'replace', sequence: 1, value: value(9) })
    model.reconnecting()
    expect(model.getSnapshot()).toEqual({ phase: 'reconnecting', value: value(9), error: undefined })
    model.replaceBaseline({ type: 'baseline', sequence: 0, value: value(1) })
    expect(model.getSnapshot().value?.revision).toBe(1)
    expect(() => model.replace({ type: 'replace', sequence: 2, value: value(3) })).toThrow('contiguous')
    expect(model.getSnapshot().value?.revision).toBe(1)
  })

  it('does not notify or install a late baseline after disposal', async () => {
    const model = new ImConfigurationModel()
    let notices = 0
    model.subscribe(() => { notices++ })
    model.replaceBaseline({ type: 'baseline', sequence: 0, value: value(1) })
    model.dispose()
    model.replaceBaseline({ type: 'baseline', sequence: 0, value: value(2) })
    await Promise.resolve()
    expect(notices).toBe(0)
    expect(model.getSnapshot().value?.revision).toBe(1)
  })
})
