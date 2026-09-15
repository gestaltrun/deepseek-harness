/** Select fork checks from an explicit Git diff, dependency consumers, and product composition. */
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'
import ts from 'typescript'

const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
const workspaceManifest = /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+|vendor\/[^/]+)\/package\.json$/u
const supportManifest = /^(?:native\/system(?:\/packages\/[^/]+)?|benchmarks|website|python\/sdk-runtime)\/package\.json$/u
const unitTest = /^(?:packages\/[^/]+\/[^/]+\/tests\/|apps\/[^/]+\/tests\/|scripts\/).*\.spec\.(?:ts|tsx)$/u
const desktopRoot = /^apps\/desktop(?:-host)?$/u
const posixOnly = /^packages\/(?:shell\/(?:bash-local|bash-sandbox|tool-bash)|sandbox\/sandbox-local|terminal\/terminal-bash)$/u
const composition = /^(?:community(?:\/|$)|product\/|\.gitmodules$|scripts\/community(?:[./-]|$))/u
const ciTests = [
  'scripts/fork-ci-plan.spec.ts', 'scripts/fork-ci-run.spec.ts', 'scripts/fork-ci-workflow.spec.ts',
  'scripts/ci-workflow.spec.ts', 'scripts/ci-compatible-selfhosted.spec.ts',
  'scripts/tests/ci-master-platforms.spec.ts', 'scripts/tests/ci-release-selfhosted.spec.ts',
]
// CLI subprocesses do not create static TypeScript import edges to their entry points.
const cliScriptTests = new Map<string, readonly string[]>([
  ['scripts/verify-translation-pairing.ts', ['scripts/translation-pairing.spec.ts', 'scripts/git-submodules.spec.ts']],
])

/** Inputs read from the two committed revisions; missing files represent additions or deletions. */
export interface ScopeInput {
  changed: string[]
  files: string[]
  before: Record<string, string>
  after: Record<string, string>
}

/** Selected checks and exact test/coverage scopes, persisted as the CI plan artifact. */
export interface ForkCiPlan {
  version: 1
  base: string
  head: string
  mergeBase: string
  changed: string[]
  affectedPackages: string[]
  unit: string[]
  coverage: string[]
  desktop: string[]
  expected: string[]
  web: string[]
  snapshots: string[]
  e2e: string[]
  windowsE2e: string[]
  bench: string[]
  scripts: string[]
  docs: boolean
  build: boolean
  jobs: Record<
    'quality' | 'affected' | 'product' | 'desktop' | 'windows' | 'native' | 'python' | 'pythonSdk' | 'provider' | 'sandbox' | 'benchmark',
    boolean
  >
  reasons: string[]
}

interface Manifest {
  name: string
  root: string
  dependencies: Set<string>
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a mapping')
  return value as Record<string, unknown>
}

function json(text: string): Record<string, unknown> {
  return record(JSON.parse(text))
}

function isWorkspaceManifest(path: string): boolean {
  return workspaceManifest.test(path) || supportManifest.test(path)
}

function testIncludeOwners(path: string, before: string | undefined, after: string | undefined): string[] | undefined {
  if (before === undefined || after === undefined) return undefined
  const parse = (text: string): Record<string, unknown> => {
    const parsed = ts.parseConfigFileTextToJson(path, text)
    if (parsed.error !== undefined) throw new Error(`Invalid TypeScript configuration: ${path}`)
    const value: unknown = parsed.config
    return record(value)
  }
  const oldConfig = parse(before)
  const newConfig = parse(after)
  if (changedKeys(oldConfig, newConfig).some(key => key !== 'include')) return undefined
  const oldIncludes = oldConfig.include ?? []
  const newIncludes = newConfig.include ?? []
  if (!Array.isArray(oldIncludes) || !Array.isArray(newIncludes)
    || !oldIncludes.every(value => typeof value === 'string') || !newIncludes.every(value => typeof value === 'string')) return undefined
  const changed = unique([...oldIncludes, ...newIncludes]).filter(value => oldIncludes.includes(value) !== newIncludes.includes(value))
  if (changed.length === 0 && changedKeys(oldConfig, newConfig).length > 0) return undefined
  const owners: string[] = []
  for (const pattern of changed) {
    const owner = /^(apps\/[^/]+|packages\/[^/]+\/[^/]+)\/tests\/\*\*\/\*\.(?:ts|tsx|\{ts,tsx\})$/u.exec(pattern)?.[1]
    if (owner === undefined) return undefined
    owners.push(owner)
  }
  return unique(owners)
}

function dependencyNames(manifest: Record<string, unknown>): string[] {
  return sections.flatMap(section => Object.keys(record(manifest[section] ?? {})))
}

function packageNameFromSnapshotKey(key: string): string | undefined {
  return /^(@[^/]+\/[^@]+|[^@]+)@/u.exec(key)?.[1]
}

function dependencySnapshotKey(
  name: string,
  reference: unknown,
  snapshots: Record<string, unknown>,
): string | undefined {
  if (typeof reference !== 'string') return undefined
  const key = reference.startsWith('npm:') ? reference.slice('npm:'.length) : `${name}@${reference}`
  return Object.hasOwn(snapshots, key) ? key : undefined
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return unique([...Object.keys(before), ...Object.keys(after)])
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

function docsOnly(path: string): boolean {
  return /(?:^|\/)(?:README|AGENTS|CLAUDE|LICENSE)(?:\.[^/]*)?$/u.test(path)
    || /\.(?:md|mdx|i18n\.yaml)$/u.test(path)
    || /^(?:docs\/|\.agents\/|website\/)/u.test(path)
}

/** Compute selected checks without reading files, launching tools, or changing process state.
 * @param input - Committed file inventory and relevant before/after contents.
 * @returns A deterministic plan; unowned implementation changes throw instead of passing unchecked.
 */
export function planForkCi(input: ScopeInput): ForkCiPlan {
  const plan: ForkCiPlan = {
    version: 1, base: '', head: '', mergeBase: '', changed: unique(input.changed), affectedPackages: [],
    unit: [], coverage: [], desktop: [], expected: [], web: [], snapshots: [], e2e: [], windowsE2e: [], bench: [], scripts: [],
    docs: false, build: false,
    jobs: {
      quality: true, affected: false, product: false, desktop: false,
      windows: false, native: false, python: false, pythonSdk: false, provider: false, sandbox: false, benchmark: false,
    },
    reasons: [],
  }
  const files = new Set(input.files)
  const manifests = new Map<string, Manifest>()
  for (const path of unique([...Object.keys(input.before), ...Object.keys(input.after)]).filter(isWorkspaceManifest)) {
    const root = dirname(path)
    for (const text of [input.before[path], input.after[path]]) {
      if (text === undefined) continue
      const manifest = json(text)
      if (typeof manifest.name !== 'string') throw new Error(`${path}: missing package name`)
      const prior = manifests.get(root)
      manifests.set(root, {
        root, name: manifest.name,
        dependencies: new Set([...(prior?.dependencies ?? []), ...dependencyNames(manifest)]),
      })
    }
  }
  const roots = [...manifests.keys()].sort((a, b) => b.length - a.length)
  const owner = (path: string): string | undefined => roots.find(root => path === root || path.startsWith(root + '/'))
  const affected = new Set<string>()
  const selectedScripts = new Set<string>()
  const scriptsChanged: string[] = []
  const selectProduct = (reason: string): void => {
    plan.jobs.product = true
    plan.reasons.push(reason)
  }
  const affectAll = (reason: string): void => {
    for (const root of roots) affected.add(root)
    plan.build = true
    plan.reasons.push(reason)
  }
  for (const path of plan.changed) {
    if (composition.test(path)) {
      selectProduct(`product composition: ${path}`)
      continue
    }
    if (docsOnly(path)) {
      plan.docs = true
      continue
    }
    if (path.startsWith('.github/')) {
      for (const test of ciTests) if (files.has(test)) selectedScripts.add(test)
      continue
    }
    if (path === 'pnpm-lock.yaml') continue
    if (path === 'package.json') {
      const before = json(input.before[path] ?? '{}')
      const after = json(input.after[path] ?? '{}')
      const keys = changedKeys(before, after)
      const scripts = changedKeys(record(before.scripts ?? {}), record(after.scripts ?? {}))
      if (scripts.some(name => name.startsWith('community:'))) selectProduct('community package scripts')
      if (scripts.some(name => ['ci:plan', 'ci:run'].includes(name))) {
        for (const test of ciTests) if (files.has(test)) selectedScripts.add(test)
      }
      if (keys.some(key => key !== 'scripts') || scripts.some(name => !name.startsWith('community:') && !['ci:plan', 'ci:run'].includes(name))) {
        affectAll('shared root manifest/toolchain changed')
      }
      continue
    }
    if (/^tsconfig[^/]*\.json$/u.test(path)) {
      const owners = testIncludeOwners(path, input.before[path], input.after[path])
      if (owners !== undefined && owners.every(root => manifests.has(root))) {
        for (const root of owners) affected.add(root)
        plan.reasons.push(`compiler test includes: ${owners.join(', ') || 'no semantic change'}`)
        continue
      }
    }
    if (/^(?:pnpm-workspace\.yaml|tsconfig[^/]*\.json|tsdown[^/]*\.ts|vitest[^/]*\.ts|\.oxlint[^/]*|patches\/)/u.test(path)) {
      affectAll(`shared build/test configuration: ${path}`)
      selectProduct(`shared build/test configuration: ${path}`)
      continue
    }
    if (/^(?:\.gitignore|\.gitattributes|\.npmrc|lefthook\.yml|\.jscpd\.json)$/u.test(path)) {
      for (const test of ciTests) if (files.has(test)) selectedScripts.add(test)
      continue
    }
    if (path.startsWith('snapshots/')) {
      plan.snapshots = ['scripts/session-snapshot-corpus.corpus.ts', ...input.files.filter(file => file.startsWith('snapshots/') && file.endsWith('.snapshot.ts'))]
      plan.build = true
      continue
    }
    if (path.startsWith('python/')) {
      plan.jobs.python = true
      plan.reasons.push(`Python SDK/runtime: ${path}`)
      continue
    }
    if (path.startsWith('scripts/')) {
      scriptsChanged.push(path)
      continue
    }
    const root = owner(path)
    if (root === undefined) throw new Error(`No CI owner for ${path}; add an explicit affected-check mapping`)
    affected.add(root)
    if (path.startsWith('native/system/')) plan.jobs.native = true
  }

  // Importer changes identify direct lockfile owners; transitive resolutions identify
  // packages consuming a changed external dependency even when importers stay identical.
  if (plan.changed.includes('pnpm-lock.yaml')) {
    const oldLock = record(load(input.before['pnpm-lock.yaml'] ?? '{}'))
    const newLock = record(load(input.after['pnpm-lock.yaml'] ?? '{}'))
    const beforeImporters = record(oldLock.importers ?? {})
    const afterImporters = record(newLock.importers ?? {})
    for (const root of changedKeys(beforeImporters, afterImporters)) {
      if (composition.test(root)) selectProduct(`lockfile importer: ${root}`)
      else if (root === '.') affectAll('root toolchain lockfile importer changed')
      else if (manifests.has(root)) affected.add(root)
      else throw new Error(`No CI owner for lockfile importer ${root}`)
    }
    const changedSnapshotKeys = new Set<string>()
    for (const section of ['packages', 'snapshots']) {
      for (const key of changedKeys(record(oldLock[section] ?? {}), record(newLock[section] ?? {}))) {
        if (packageNameFromSnapshotKey(key) !== undefined) changedSnapshotKeys.add(key)
      }
    }
    // Walk exact resolved identities backwards. A newly added `statuses@1` must
    // not invalidate an unchanged consumer of `statuses@2` merely because the
    // package names match.
    for (const lock of [oldLock, newLock]) {
      const snapshots = record(lock.snapshots ?? {})
      let grew = true
      while (grew) {
        grew = false
        for (const [key, value] of Object.entries(snapshots)) {
          if (!changedSnapshotKeys.has(key)
            && sections.some(section => Object.entries(record(record(value)[section] ?? {}))
              .some(([name, reference]) => changedSnapshotKeys.has(
                dependencySnapshotKey(name, reference, snapshots) ?? '',
              )))) {
            changedSnapshotKeys.add(key)
            grew = true
          }
        }
      }
    }
    const changedDependencies = new Set(
      [...changedSnapshotKeys].map(packageNameFromSnapshotKey).filter(name => name !== undefined),
    )
    for (const manifest of manifests.values()) {
      if ([...manifest.dependencies].some(dep => changedDependencies.has(dep))) affected.add(manifest.root)
    }
    const metadata = changedKeys(oldLock, newLock).filter(key => !['importers', 'packages', 'snapshots'].includes(key))
    if (metadata.length > 0) affectAll(`lockfile policy changed: ${metadata.join(', ')}`)
    plan.reasons.push('lockfile direct importers and transitive consumers inspected')
  }

  for (const changedScript of scriptsChanged) {
    if (changedScript === 'scripts/session-snapshot-corpus.corpus.ts') {
      plan.snapshots = ['scripts/session-snapshot-corpus.corpus.ts', ...input.files.filter(file => file.startsWith('snapshots/') && file.endsWith('.snapshot.ts'))]
      plan.build = true
      continue
    }
    const consumers = new Set([changedScript])
    let changed = true
    while (changed) {
      changed = false
      for (const [path, text] of Object.entries(input.after)) {
        if (!path.startsWith('scripts/') || consumers.has(path)) continue
        const imports = [...text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/gu)]
        if (imports.some(match => match[1] !== undefined && consumers.has(resolve('/', dirname(path), match[1]).slice(1)))) {
          consumers.add(path)
          changed = true
        }
      }
    }
    const tests = new Set<string>()
    for (const path of consumers) {
      if (unitTest.test(path) && files.has(path)) tests.add(path)
      const test = path.replace(/\.(?:ts|mjs|cjs|sh)$/u, '.spec.ts')
      if (files.has(test)) tests.add(test)
      for (const owner of cliScriptTests.get(path) ?? []) {
        if (!files.has(owner)) throw new Error(`Missing CLI regression owner ${owner} for ${path}`)
        tests.add(owner)
      }
    }
    if (files.has(changedScript) && tests.size === 0) throw new Error(`No tests selected for script ${changedScript}`)
    for (const test of tests) selectedScripts.add(test)
    if (/^scripts\/(?:build[^/]*|release\/|gen-tsconfig|package-graph|verify-package-dependencies)/u.test(changedScript)) {
      affectAll(`shared artifact tooling: ${changedScript}`)
      selectProduct(`shared artifact tooling: ${changedScript}`)
    }
  }

  // The desktop package script bundles desktop-host without a manifest dependency.
  if (affected.has('apps/desktop-host') && manifests.has('apps/desktop')) affected.add('apps/desktop')
  if (plan.jobs.product) {
    for (const path of input.files) {
      if (/^scripts\/community.*\.spec\.ts$/u.test(path)) selectedScripts.add(path)
      if (/^apps\/desktop\/tests\/(?:.*community.*|.*plugin.*|.*profile.*|.*package.*)\.spec\.ts$/u.test(path)) {
        plan.desktop.push(path)
      }
    }
  }

  let grew = true
  while (grew) {
    grew = false
    const names = new Set([...affected].map((root) => {
      const manifest = manifests.get(root)
      if (manifest === undefined) throw new Error(`Missing affected package manifest: ${root}`)
      return manifest.name
    }))
    for (const manifest of manifests.values()) {
      if (!affected.has(manifest.root) && [...manifest.dependencies].some(dep => names.has(dep))) {
        affected.add(manifest.root)
        grew = true
      }
    }
  }
  plan.affectedPackages = unique(affected)
  for (const root of affected) {
    const owned = input.files.filter(path => path.startsWith(root + '/'))
    const tests = owned.filter(path => unitTest.test(path))
    if (desktopRoot.test(root)) {
      plan.desktop.push(...tests)
      selectProduct(`desktop composition: ${root}`)
    } else {
      plan.unit.push(...tests)
      if (root.startsWith('packages/') && owned.some(path => path.startsWith(root + '/src/'))) plan.coverage.push(root + '/src/**/*.{ts,tsx}')
    }
    plan.expected.push(...owned.filter(path => path.endsWith('.expected.e2e.ts')))
    plan.web.push(...owned.filter(path => path.startsWith('apps/web/tests/') && /\.(?:e2e|snapshot)\.ts$/u.test(path)))
    for (const path of owned.filter(path => /^(?:packages\/[^/]+\/[^/]+\/tests\/|apps\/cli\/tests\/)/u.test(path)
      && path.endsWith('.e2e.ts') && !path.endsWith('.expected.e2e.ts') && !path.endsWith('/client-browser.e2e.ts'))) {
      if (/^packages\/(?:sandbox\/sandbox-local|shell\/bash-sandbox)\//u.test(path)) continue
      if (/^packages\/(?:shell\/pwsh-sandbox|host\/directory-picker-native)\//u.test(path)) plan.windowsE2e.push(path)
      else plan.e2e.push(path)
    }
    if (/^packages\/(?:core|session|sdk)\//u.test(root)) plan.jobs.python = true
    if (!posixOnly.test(root) && (/^(?:native\/|packages\/(?:subprocess|terminal|shell|sandbox|fs|lsp|boot|settings)\/)/u.test(root)
      || /(?:native|win32)(?:\/|$)/u.test(root))) plan.jobs.windows = true
    if (root.startsWith('native/system')) plan.jobs.native = true
    if (root === 'benchmarks') {
      plan.bench.push(...owned.filter(path => /\.bench(?:\.client)?\.ts$/u.test(path)))
      if (!plan.bench.length) throw new Error('Affected benchmark package has no selected benchmark tests')
    }
    if (/^packages\/(?:sandbox|shell\/bash-sandbox)/u.test(root)) plan.jobs.sandbox = true
  }
  if (affected.has('apps/cli')) {
    plan.snapshots = ['scripts/session-snapshot-corpus.corpus.ts', ...input.files.filter(path => path.startsWith('snapshots/') && path.endsWith('.snapshot.ts'))]
  }
  plan.scripts = unique(selectedScripts)
  for (const key of ['unit', 'coverage', 'desktop', 'expected', 'web', 'snapshots', 'e2e', 'windowsE2e', 'bench'] as const) {
    plan[key] = unique(plan[key])
  }
  plan.build ||= affected.size > 0 || plan.web.length > 0
  plan.jobs.desktop = plan.desktop.length > 0
  plan.jobs.pythonSdk = plan.jobs.python
  plan.jobs.benchmark = plan.bench.length > 0
  plan.jobs.provider = plan.e2e.length > 0
  plan.jobs.affected = plan.unit.length + plan.expected.length + plan.web.length + plan.snapshots.length > 0
    || (plan.build && [...affected].some(root => !desktopRoot.test(root)))
  if (plan.coverage.length > 0 && plan.unit.length === 0) throw new Error('Affected package sources have no selected unit tests')
  if (plan.reasons.length === 0) plan.reasons.push('only changed repository policy and its owning checks')
  return plan
}

/** Read an immutable Git change and its package manifests.
 * @param root - Repository checkout whose HEAD must equal the requested head.
 * @param base - Explicit comparison base.
 * @param head - Explicit commit under test.
 * @returns The plan with resolved commit identities.
 */
export function planGitChange(root: string, base: string, head: string): ForkCiPlan {
  const git = (args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const headSha = git(['rev-parse', '--verify', `${head}^{commit}`]).trim()
  if (git(['rev-parse', 'HEAD']).trim() !== headSha) throw new Error('Checkout HEAD must match the requested plan head')
  const baseSha = git(['rev-parse', '--verify', `${base}^{commit}`]).trim()
  const mergeBase = git(['merge-base', baseSha, headSha]).trim()
  const changed = git(['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', mergeBase, headSha]).split('\0').filter(Boolean)
  const files = git(['ls-tree', '-r', '--name-only', '-z', headSha]).split('\0').filter(Boolean)
  const baseFiles = new Set(git(['ls-tree', '-r', '--name-only', '-z', mergeBase]).split('\0').filter(Boolean))
  const before: Record<string, string> = {}
  const after: Record<string, string> = {}
  const relevant = unique([...baseFiles, ...files]).filter(path => isWorkspaceManifest(path)
    || ['package.json', 'pnpm-lock.yaml'].includes(path) || /^tsconfig[^/]*\.json$/u.test(path)
    || /^scripts\/.*\.(?:ts|mjs|cjs)$/u.test(path))
  for (const path of relevant) {
    if (files.includes(path)) after[path] = git(['show', `${headSha}:${path}`])
    const current = after[path]
    if (baseFiles.has(path)) before[path] = changed.includes(path) || current === undefined ? git(['show', `${mergeBase}:${path}`]) : current
  }
  return { ...planForkCi({ changed, files, before, after }), base: baseSha, head: headSha, mergeBase }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' }, output: { type: 'string' } } })
  if (!values.base || !values.head || !values.output) throw new Error('Usage: fork-ci-plan --base <sha> --head <sha> --output <file>')
  const plan = planGitChange(process.cwd(), values.base, values.head)
  writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${JSON.stringify(plan.jobs)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Selected fork checks\n\nBase: ${plan.mergeBase}\n\nHead: ${plan.head}\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`)
  console.log(JSON.stringify(plan, null, 2))
}
