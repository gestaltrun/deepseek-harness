/** Selected jobs and test invocations must supply actual passing evidence. */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chunkCommandTargets, forkCiCoveragePartitions, qualityLintFiles, verifyForkCiResults, verifyTestExecution, writeForkCiVitestConfig } from './fork-ci-run.ts'

describe('fork CI verdict', () => {
  it('keeps Windows command-line batches under the argument budget', () => {
    expect(chunkCommandTargets([])).toEqual([])
    expect(chunkCommandTargets(['apps/cli', 'apps/desktop'], 21)).toEqual([['apps/cli', 'apps/desktop']])
    expect(chunkCommandTargets(['apps/cli', 'apps/desktop', 'apps/web'], 21)).toEqual([
      ['apps/cli', 'apps/desktop'],
      ['apps/web'],
    ])
    const family = Array.from({ length: 280 }, (_, index) => `packages/group/pkg-${String(index).padStart(3, '0')}`)
    const batches = chunkCommandTargets(family)
    expect(batches.flat()).toEqual(family)
    expect(batches.every(batch => batch.join(' ').length <= 6000)).toBe(true)
    expect(batches.length).toBeGreaterThan(1)
  })

  it('selects planned tests and coverage includes from a generated config', () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    const scratch = mkdtempSync(join(process.cwd(), 'tmp', 'dsh-fork-ci-spec-'))
    try {
      const generated = writeForkCiVitestConfig(
        scratch,
        'vitest.config.ts',
        ['apps/cli/tests/args.spec.ts', 'packages/util/http-proxy/tests/install.spec.ts'],
        ['packages/util/http-proxy/src/**/*.{ts,tsx}'],
      )
      const source = readFileSync(generated, 'utf8')
      expect(source).toContain('merged.test.include = files')
      expect(source).toContain("project.test.name === 'process-bound'")
      expect(source).toContain('merged.test.coverage.include = coverage')
      expect(JSON.parse(readFileSync(join(scratch, 'files.json'), 'utf8'))).toEqual([
        'apps/cli/tests/args.spec.ts',
        'packages/util/http-proxy/tests/install.spec.ts',
      ])
      expect(JSON.parse(readFileSync(join(scratch, 'coverage.json'), 'utf8'))).toEqual([
        'packages/util/http-proxy/src/**/*.{ts,tsx}',
      ])

      const withoutCoverage = writeForkCiVitestConfig(scratch, 'vitest.config.ts', ['apps/cli/tests/args.spec.ts'])
      expect(readFileSync(withoutCoverage, 'utf8')).not.toContain('merged.test.coverage.include')
      expect(readFileSync(withoutCoverage, 'utf8')).toContain('__vitest_empty_include__')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('partitions family-wide coverage only when the inventory is large enough', () => {
    expect(forkCiCoveragePartitions(1, '4')).toBeUndefined()
    expect(forkCiCoveragePartitions(4, '4')).toBe(4)
    expect(forkCiCoveragePartitions(80, undefined)).toBeUndefined()
  })

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
