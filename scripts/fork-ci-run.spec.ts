/** Selected jobs and test invocations must supply actual passing evidence. */
import { describe, expect, it } from 'vitest'
import { qualityLintFiles, verifyForkCiResults, verifyTestExecution } from './fork-ci-run.ts'

describe('fork CI verdict', () => {
  it('lints a changed static owner routed from Desktop to quality', () => {
    expect(qualityLintFiles({
      changed: ['apps/desktop/tests/desktop-release-workflow.spec.ts', 'apps/desktop/tests/package.spec.ts'],
      scripts: ['apps/desktop/tests/desktop-release-workflow.spec.ts'],
    })).toEqual(['apps/desktop/tests/desktop-release-workflow.spec.ts'])
  })

  it('accepts required successes and only explicitly unselected skips', () => {
    expect(() =>{  verifyForkCiResults({ quality: true, product: false }, {
      plan: { result: 'success' }, quality: { result: 'success' }, product: { result: 'skipped' },
    }) }).not.toThrow()
  })

  it.each(['failure', 'cancelled', 'skipped', 'pending'])('rejects a selected %s job', (result) => {
    expect(() =>{  verifyForkCiResults({ quality: true }, { plan: { result: 'success' }, quality: { result } }) }).toThrow('quality:')
  })

  it('rejects missing selected jobs', () => {
    expect(() =>{  verifyForkCiResults({ quality: true, product: true }, { plan: { result: 'success' }, quality: { result: 'success' } }) }).toThrow('product: expected success, received missing')
  })

  it.each(['failure', 'skipped', 'cancelled'])('rejects a %s planner', (result) => {
    expect(() =>{  verifyForkCiResults({ quality: true }, { plan: { result }, quality: { result: 'success' } }) }).toThrow('planner')
  })

  it('rejects unplanned results and a missing mandatory quality job', () => {
    expect(() =>{  verifyForkCiResults({ quality: true }, { plan: { result: 'success' }, quality: { result: 'success' }, orphan: { result: 'success' } }) }).toThrow('Unplanned CI result')
    expect(() =>{  verifyForkCiResults({}, { plan: { result: 'success' } }) }).toThrow('quality')
  })

  it.each([{}, { success: true, numPassedTests: 0, numFailedTests: 0 }, { success: false, numPassedTests: 1, numFailedTests: 1 }])('rejects empty, entirely skipped, or failed tests: %j', (report) => {
    expect(() =>{  verifyTestExecution(report) }).toThrow('executed no passing tests')
  })

  it('accepts an actual successful test invocation', () => {
    expect(() =>{  verifyTestExecution({ success: true, numPassedTests: 3, numFailedTests: 0 }) }).not.toThrow()
  })

  it('rejects one entirely skipped provider file even if a sibling file passes', () => {
    expect(() =>{  verifyTestExecution({
      success: true, numPassedTests: 1, numFailedTests: 0,
      testResults: [{ name: '/repo/one.e2e.ts', assertionResults: [{ status: 'passed' }] },
        { name: '/repo/two.e2e.ts', assertionResults: [{ status: 'pending' }] }],
    }, ['one.e2e.ts', 'two.e2e.ts']) }).toThrow('entirely skipped: two.e2e.ts')
  })

  it('rejects a selected provider file absent from the report', () => {
    expect(() =>{  verifyTestExecution({ success: true, numPassedTests: 1, numFailedTests: 0, testResults: [] }, ['missing.e2e.ts']) })
      .toThrow('missing or entirely skipped: missing.e2e.ts')
  })
})
