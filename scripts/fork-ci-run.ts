/** Execute selected upstream checks and reject empty test runs or incomplete job results. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  COVERAGE_PARTITIONS_ENV,
  COVERAGE_TEST_TIMEOUT_ENV,
  CoveragePartitionCoordinator,
  coverageTestTimeoutArgs,
  parseCoveragePartitionCount,
  projectIncludesForFiles,
} from './coverage-partitions.ts'
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

/** Keep CreateProcess and cmd.exe argument lists under Windows' command-line limit. */
export const WINDOWS_SAFE_ARG_BUDGET = 6000

/**
 * Split path arguments so each pnpm invocation stays under the Windows command-line budget.
 * @param targets - Repository-relative paths to pass as trailing arguments.
 * @param budget - Maximum joined length of those trailing arguments, in characters.
 * @returns Non-empty batches that preserve `targets` order.
 */
export function chunkCommandTargets(targets: readonly string[], budget = WINDOWS_SAFE_ARG_BUDGET): string[][] {
  if (targets.length === 0) return []
  const batches: string[][] = []
  let current: string[] = []
  let used = 0
  for (const target of targets) {
    const extra = target.length + (current.length === 0 ? 0 : 1)
    if (current.length > 0 && used + extra > budget) {
      batches.push(current)
      current = []
      used = 0
    }
    current.push(target)
    used += current.length === 1 ? target.length : extra
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function command(args: string[], env: NodeJS.ProcessEnv = {}): void {
  const invocation = pnpmInvocation(args)
  console.log(`pnpm ${args.join(' ')}`)
  const result = spawnSync(invocation.command, invocation.args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error) throw result.error
  if (result.status !== 0 || result.signal !== null) throw new Error(`Selected command failed: ${args.join(' ')} (${result.signal ?? result.status})`)
}

/**
 * Write a Vitest config that selects files and coverage includes without argv.
 * @param scratch - Temporary directory owned by the caller.
 * @param config - Repository-relative Vitest config to merge.
 * @param files - Test files selected by the CI plan.
 * @param coverage - Optional coverage include globs; empty means coverage stays off.
 * @returns Path to the generated config.
 */
export function writeForkCiVitestConfig(
  scratch: string,
  config: string,
  files: readonly string[],
  coverage: readonly string[] = [],
): string {
  const filesPath = join(scratch, 'files.json')
  const coveragePath = join(scratch, 'coverage.json')
  const configPath = join(scratch, 'vitest.fork.config.ts')
  writeFileSync(filesPath, `${JSON.stringify(files)}\n`)
  writeFileSync(coveragePath, `${JSON.stringify(coverage)}\n`)
  writeFileSync(configPath, `import { readFileSync } from 'node:fs'
import { mergeConfig } from 'vitest/config'
import base from ${JSON.stringify(pathToFileURL(resolve(config)).href)}

const files = JSON.parse(readFileSync(${JSON.stringify(filesPath)}, 'utf8')) as string[]
const merged = mergeConfig(base, {})
const includes = ${JSON.stringify(projectIncludesForFiles(files))}
merged.test.include = files
for (const project of merged.test.projects ?? []) {
  if (project?.test !== undefined) {
    project.test.include = project.test.name === 'process-bound' ? includes.processBound : includes.threadSafe
  }
}
${coverage.length === 0 ? '' : `const coverage = JSON.parse(readFileSync(${JSON.stringify(coveragePath)}, 'utf8')) as string[]
merged.test.coverage.include = coverage
`}export default merged
`)
  return configPath
}

function tests(files: string[], config = 'vitest.config.ts', coverage: string[] = [], requireFiles = false): void {
  if (files.length === 0) return
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  const scratch = mkdtempSync(join(process.cwd(), 'tmp', 'dsh-fork-ci-'))
  try {
    const output = join(scratch, 'vitest.json')
    const generated = writeForkCiVitestConfig(scratch, config, files, coverage)
    command(['exec', 'vitest', 'run', '--config', generated,
      ...(coverage.length ? ['--coverage'] : []),
      '--reporter=default', '--reporter=json', `--outputFile.json=${output}`], { DSH_SNAPSHOT: 'replay' })
    verifyTestExecution(JSON.parse(readFileSync(output, 'utf8')) as Parameters<typeof verifyTestExecution>[0], requireFiles ? files : [])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Use partitioned coverage only when the planner asked for more than one shard
 * and selected at least that many files.
 * @param fileCount - Planned unit-test count.
 * @param raw - Optional `DSH_COVERAGE_PARTITIONS` value.
 * @returns Partition count, or undefined for a single coverage invocation.
 */
export function forkCiCoveragePartitions(fileCount: number, raw: string | undefined): number | undefined {
  const requested = parseCoveragePartitionCount(raw)
  if (requested === undefined || fileCount < requested) return undefined
  return requested
}

/**
 * Run planned unit tests through partitioned coverage when the inventory is
 * large enough, otherwise keep a single Vitest coverage invocation.
 * @param files - Planned unit tests.
 * @param coverage - Planned coverage include globs.
 */
async function coverageTests(files: string[], coverage: string[]): Promise<void> {
  const pnpmEntrypoint = process.env.npm_execpath
  if (pnpmEntrypoint === undefined || pnpmEntrypoint === '') {
    throw new Error('Fork CI coverage must be invoked through a pnpm package script.')
  }
  const partitions = forkCiCoveragePartitions(files.length, process.env[COVERAGE_PARTITIONS_ENV])
  if (partitions === undefined) {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    const scratch = mkdtempSync(join(process.cwd(), 'tmp', 'dsh-fork-ci-'))
    try {
      const output = join(scratch, 'vitest.json')
      const generated = writeForkCiVitestConfig(scratch, 'vitest.config.ts', files, coverage)
      command(['exec', 'vitest', 'run', '--config', generated, '--coverage',
        '--reporter=default', '--reporter=json', `--outputFile.json=${output}`], { DSH_SNAPSHOT: 'replay' })
      verifyTestExecution(JSON.parse(readFileSync(output, 'utf8')) as Parameters<typeof verifyTestExecution>[0])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
    return
  }
  const coordinator = new CoveragePartitionCoordinator({
    root: process.cwd(),
    partitions,
    pnpmEntrypoint,
    files,
    coverageInclude: coverage,
    vitestArgs: coverageTestTimeoutArgs(process.env[COVERAGE_TEST_TIMEOUT_ENV]),
  })
  const status = await coordinator.run()
  if (status !== 0) throw new Error(`Partitioned coverage failed (${status})`)
}

function lintPackages(plan: ForkCiPlan): void {
  const targets = [...plan.affectedPackages, ...plan.scripts].filter(path => !path.startsWith('native/') && !path.startsWith('vendor/'))
  const prefix = ['exec', 'tsx', 'scripts/run-oxlint.ts']
  const budget = Math.max(1, WINDOWS_SAFE_ARG_BUDGET - prefix.join(' ').length)
  for (const batch of chunkCommandTargets(targets, budget)) command([...prefix, ...batch])
}

/** Select changed TypeScript files whose checks execute in the quality lane.
 * @param plan - Planned changed files and quality-owned tests.
 * @returns Changed scripts plus changed tests explicitly routed to quality.
 */
export function qualityLintFiles(plan: Pick<ForkCiPlan, 'changed' | 'scripts'>): string[] {
  const selected = new Set(plan.scripts)
  return [...new Set(plan.changed.filter(path => path.endsWith('.ts')
    && (path.startsWith('scripts/') || selected.has(path))))].sort()
}

async function execute(plan: ForkCiPlan, lane: string): Promise<void> {
  if (!plan.jobs[lane as keyof ForkCiPlan['jobs']]) throw new Error(`CI lane is not selected: ${lane}`)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== plan.head) throw new Error(`Plan head ${plan.head} does not match checkout ${head}`)
  if (lane === 'quality') {
    execFileSync('git', ['diff', '--check', plan.mergeBase, plan.head], { stdio: 'inherit' })
    const lintFiles = qualityLintFiles(plan).filter(path => existsSync(path))
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
    if (plan.coverage.length > 0) await coverageTests(plan.unit, plan.coverage)
    else tests(plan.unit)
    tests(plan.expected, 'vitest.expected.config.ts')
    tests(plan.snapshots, 'vitest.snapshot.config.ts')
    if (lane === 'windows') tests(plan.windowsE2e, 'vitest.e2e.config.ts', [], true)
    if (lane === 'affected' && plan.web.length) {
      command(['--filter', '@deepseek-ai/dsh-web-frontend', 'exec', 'playwright', 'install', 'chromium'])
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
    await execute(plan as ForkCiPlan, values.lane)
  }
}
