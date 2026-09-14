/** Execute selected upstream checks and reject empty test runs or incomplete job results. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from './pnpm-invocation.ts'
import type { ForkCiPlan } from './fork-ci-plan.ts'

/** Check the verdict from the planner and every selected job.
 * @param selected - Planner job selections.
 * @param results - GitHub needs results, including the planner.
 * @returns Normally only when all selected jobs succeeded and every omission was planned.
 */
export function verifyForkCiResults(selected: Record<string, boolean>, results: Record<string, { result: string }>): void {
  if (results.plan?.result !== 'success') throw new Error('CI planner did not succeed')
  if (selected.quality !== true) throw new Error('CI plan must select quality checks')
  for (const [job, required] of Object.entries(selected)) {
    const result = results[job]?.result
    if (required ? result !== 'success' : result !== 'skipped') {
      throw new Error(`${job}: expected ${required ? 'success' : 'planned skip'}, received ${result ?? 'missing'}`)
    }
  }
  for (const job of Object.keys(results)) {
    if (job !== 'plan' && !(job in selected)) throw new Error(`Unplanned CI result: ${job}`)
  }
}

/** Reject a selected test invocation that reports success without executing assertions.
 * @param report - Vitest JSON report from the selected invocation.
 * @param requiredFiles - Provider test files that must execute at least one assertion each.
 * @returns Normally only when the invocation succeeded with at least one passing test.
 */
export function verifyTestExecution(report: {
  success?: boolean
  numPassedTests?: number
  numFailedTests?: number
  testResults?: Array<{ name: string; assertionResults: Array<{ status: string }> }>
}, requiredFiles: string[] = []): void {
  if (report.success !== true || !(typeof report.numPassedTests === 'number' && report.numPassedTests > 0) || report.numFailedTests !== 0) {
    throw new Error('Selected test invocation failed or executed no passing tests')
  }
  for (const file of requiredFiles) {
    const result = report.testResults?.find(result => result.name.replaceAll('\\', '/').endsWith('/' + file))
    if (result === undefined || !result.assertionResults.some(assertion => assertion.status === 'passed')) {
      throw new Error(`Selected test file is missing or entirely skipped: ${file}`)
    }
  }
}

function command(args: string[], env: NodeJS.ProcessEnv = {}): void {
  const invocation = pnpmInvocation(args)
  console.log(`pnpm ${args.join(' ')}`)
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error) throw result.error
  if (result.status !== 0 || result.signal !== null) throw new Error(`Selected command failed: ${args.join(' ')} (${result.signal ?? result.status})`)
}

function tests(files: string[], config = 'vitest.config.ts', coverage: string[] = [], requireFiles = false): void {
  if (files.length === 0) return
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-fork-ci-'))
  try {
    const output = join(scratch, 'vitest.json')
    command(['exec', 'vitest', 'run', '--config', config, ...files,
      ...(coverage.length ? ['--coverage', ...coverage.map(path => `--coverage.include=${path}`)] : []),
      '--reporter=default', '--reporter=json', `--outputFile.json=${output}`], { DSH_SNAPSHOT: 'replay' })
    verifyTestExecution(JSON.parse(readFileSync(output, 'utf8')) as Parameters<typeof verifyTestExecution>[0], requireFiles ? files : [])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function lintPackages(plan: ForkCiPlan): void {
  const targets = [...plan.affectedPackages, ...plan.scripts].filter(path => !path.startsWith('native/') && !path.startsWith('vendor/'))
  if (targets.length) command(['exec', 'tsx', 'scripts/run-oxlint.ts', ...targets])
}

function execute(plan: ForkCiPlan, lane: string): void {
  if (!plan.jobs[lane as keyof ForkCiPlan['jobs']]) throw new Error(`CI lane is not selected: ${lane}`)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== plan.head) throw new Error(`Plan head ${plan.head} does not match checkout ${head}`)
  if (lane === 'quality') {
    execFileSync('git', ['diff', '--check', plan.mergeBase, plan.head], { stdio: 'inherit' })
    const lintFiles = plan.changed.filter(path => path.startsWith('scripts/') && path.endsWith('.ts') && existsSync(path))
    if (lintFiles.length) command(['exec', 'tsx', 'scripts/run-oxlint.ts', '--config', '.oxlintrc.staged.json', ...lintFiles])
    tests(plan.scripts)
    if (plan.changed.some(path => path.startsWith('.github/issue-management/'))) command(['run', 'test:issue-management'])
    if (plan.changed.some(path => path.startsWith('.github/review-ownership/'))) command(['run', 'test:approval-policy'])
    if (plan.docs) command(['run', 'doc-sync'], { DSH_ARCHIVE_BASE_REF: plan.base })
    return
  }
  if (lane === 'desktop') {
    if (plan.desktop.length === 0) throw new Error('Desktop lane has no selected tests')
    tests(plan.desktop)
    return
  }
  if (lane === 'product') {
    lintPackages(plan)
    return
  }
  if (lane === 'provider') {
    if (plan.e2e.length === 0) throw new Error('Provider lane has no selected tests')
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('Selected real-API checks require DEEPSEEK_API_KEY')
    command(['run', 'build:official'])
    tests(plan.e2e, 'vitest.e2e.config.ts', [], true)
    return
  }
  if (lane === 'benchmark') {
    if (plan.bench.length === 0) throw new Error('Benchmark lane has no selected tests')
    command(['run', 'build:bench'])
    command(['run', 'build:web'])
    command(['--filter', '@deepseek-ai/dsh-benchmarks', 'exec', 'playwright', 'install', '--with-deps', 'chromium'])
    tests(plan.bench, 'vitest.bench.config.ts', [], true)
    return
  }
  if (lane === 'affected' || lane === 'windows') {
    if (plan.build) {
      command(['run', 'build:official'])
      command(['run', 'typecheck:contracts-ready'])
      lintPackages(plan)
    }
    tests(plan.unit, 'vitest.config.ts', plan.coverage)
    tests(plan.expected, 'vitest.expected.config.ts')
    tests(plan.snapshots, 'vitest.snapshot.config.ts')
    if (lane === 'windows') tests(plan.windowsE2e, 'vitest.e2e.config.ts', [], true)
    if (lane === 'affected' && plan.web.length) {
      command(['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'playwright', 'install', '--with-deps', 'chromium'])
      tests(plan.web, 'vitest.web.config.ts')
    }
    return
  }
  throw new Error(`Unsupported script lane: ${lane}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, lane: { type: 'string' }, summary: { type: 'boolean' } } })
  if (values.summary) {
    verifyForkCiResults(JSON.parse(process.env.SELECTED_JOBS ?? '{}') as Record<string, boolean>,
      JSON.parse(process.env.JOB_RESULTS ?? '{}') as Record<string, { result: string }>)
  } else {
    if (!values.plan || !values.lane) throw new Error('Usage: fork-ci-run --plan <file> --lane <job>')
    const plan: unknown = JSON.parse(readFileSync(values.plan, 'utf8'))
    if (typeof plan !== 'object' || plan === null || !('version' in plan) || plan.version !== 1) throw new Error('Invalid CI plan version')
    execute(plan as ForkCiPlan, values.lane)
  }
}
