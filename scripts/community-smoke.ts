/** Materialize pinned community tarballs with this checkout's runtime and boot both shipped UI carriers. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import {
  COMMUNITY_OUTPUT, checkCommunitySources, readCommunityPlugins, verifyCommunityPackage,
  type CommunityArtifact, type CommunityPlugin,
} from './community.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { prepareDesktopPackageSet } from '../apps/desktop/scripts/prepare-package-set.ts'
import { smokeCommunityPluginRoutes, smokeDesktopRuntime, type CommunityRouteSmoke } from '../apps/desktop/scripts/smoke-runtime.ts'
import { desktopRuntimeFileExclusion, prepareDesktopNativeHelpers } from '../apps/desktop/scripts/runtime-file-policy.ts'
import { createPluginProfile, createRuntimeProjectMetadata } from '../apps/desktop/src/project-manager.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../apps/desktop/src/host-protocol.ts'
import { readDesktopCorePackageSet, verifyDesktopCoreLockfile, verifyDesktopCorePackageSet } from '../apps/desktop/src/core-package-set.ts'
import { parseDesktopRelease } from '../apps/desktop/src/release.ts'
import { verifyDesktopRuntime, writeDesktopRuntime } from '../apps/desktop/src/runtime-tree.ts'

const ROOT = resolve(import.meta.dirname, '..')
const OWNER_FILE = '.community-smoke-owner.json'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function manifest(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!record(value)) throw new Error(`community smoke: invalid manifest ${path}`)
  return value
}

function digest(path: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

function candidateDigest(artifacts: unknown): string {
  if (!Array.isArray(artifacts)) throw new Error('community smoke: retained report has no artifact identities')
  const rows = artifacts.map((entry: unknown) => {
    if (!record(entry)) throw new Error('community smoke: invalid retained artifact identity')
    return ['name', 'version', 'filename', 'integrity', 'repository', 'commit'].map((field) => {
      const value = entry[field]
      if (typeof value !== 'string') throw new Error('community smoke: incomplete retained artifact identity')
      return value
    })
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

/**
 * Verify an owned retained candidate before changing any of its files.
 * @param directory - Previously retained smoke directory.
 * @param root - Checkout that created the candidate.
 * @returns Canonical owned directory and its verified previous report.
 */
export function readRetainedCandidate(directory: string, root = ROOT): { scratch: string; report: Record<string, unknown> } {
  const scratch = realpathSync(resolve(directory))
  if (dirname(scratch) !== realpathSync(tmpdir()) || !basename(scratch).startsWith('gestaltrun-community-smoke-')) {
    throw new Error('community smoke: resume only accepts its own temporary candidates')
  }
  const owner = manifest(join(scratch, OWNER_FILE))
  const report = manifest(join(scratch, 'report.json'))
  if (owner.schemaVersion !== 1 || owner.root !== realpathSync(root) || owner.scratch !== scratch
    || owner.artifacts !== candidateDigest(report.artifacts)) throw new Error('community smoke: retained candidate ownership mismatch')
  return { scratch, report }
}

/**
 * Check immutable archives before allowing an installer to execute their contents.
 * @param output - Community tarball directory and inventory.
 * @param plugins - Product-owned package names, versions, and repositories.
 * @param commits - Current Git pins indexed by repository.
 * @returns Validated tarball identities in inventory order.
 */
export function verifyCommunityArchives(
  output: string, plugins: readonly CommunityPlugin[], commits: Readonly<Record<string, string>>,
): readonly CommunityArtifact[] {
  const inventory = manifest(join(output, 'product-community.json'))
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.packages) || inventory.packages.length === 0) {
    throw new Error('community smoke: invalid artifact inventory')
  }
  const artifacts = inventory.packages.map((entry: unknown): CommunityArtifact => {
    if (!record(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string'
      || typeof entry.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(entry.filename)
      || typeof entry.integrity !== 'string' || typeof entry.repository !== 'string'
      || typeof entry.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(entry.commit)) {
      throw new Error('community smoke: invalid artifact identity')
    }
    const plugin = plugins.find(plugin => plugin.repository === entry.repository)
    if (plugin === undefined || entry.version !== plugin.version || entry.commit !== commits[entry.repository]) {
      throw new Error(`community smoke: ${entry.name} differs from its product version or source pin`)
    }
    const path = join(output, entry.filename)
    if (!lstatSync(path).isFile() || digest(path) !== entry.integrity) throw new Error(`community smoke: integrity mismatch for ${entry.filename}`)
    const packed: unknown = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' }))
    if (!record(packed)) throw new Error(`community smoke: invalid packed manifest ${entry.filename}`)
    verifyCommunityPackage(packed)
    if (packed.name !== entry.name || packed.version !== entry.version) throw new Error(`community smoke: wrong package inside ${entry.filename}`)
    return { name: entry.name, version: entry.version, filename: entry.filename,
      integrity: entry.integrity, repository: entry.repository, commit: entry.commit }
  })
  if (new Set(artifacts.map(entry => entry.name)).size !== artifacts.length
    || new Set(artifacts.map(entry => entry.filename)).size !== artifacts.length) throw new Error('community smoke: duplicate artifact identity')
  for (const plugin of plugins) {
    if (!artifacts.some(entry => entry.name === plugin.package)) throw new Error(`community smoke: missing product root ${plugin.package}`)
  }
  const files = readdirSync(output).filter(path => path.endsWith('.tgz')).sort()
  if (JSON.stringify(files) !== JSON.stringify(artifacts.map(entry => entry.filename).sort())) {
    throw new Error('community smoke: unrecorded or missing community archives')
  }
  return artifacts
}

/**
 * Require a self-contained runtime with exactly one physical Cordis package.
 * @param runtime - Materialized production directory.
 * @param artifacts - Community packages expected inside the runtime.
 * @returns Installed package count and the common Cordis module path relative to the runtime.
 */
export function verifyCommunityInstallation(
  runtime: string, artifacts: readonly CommunityArtifact[],
): { packages: number; cordis: string } {
  const installed: Array<{ name: string; path: string }> = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`community smoke: runtime contains a link: ${relative(runtime, path)}`)
      if (!entry.isDirectory()) continue
      if (basename(directory) === 'node_modules' || (basename(directory).startsWith('@') && basename(dirname(directory)) === 'node_modules')) {
        if (existsSync(join(path, 'package.json'))) {
          const value = manifest(join(path, 'package.json'))
          if (typeof value.name === 'string') installed.push({ name: value.name, path })
        }
      }
      visit(path)
    }
  }
  visit(join(runtime, 'node_modules'))
  if (installed.some(entry => entry.name.startsWith('@linxin666/') || entry.name.startsWith('dsh-')
    || entry.name === 'ego-browser' || entry.name === 'cordis' || entry.name.startsWith('@gestalt/'))) {
    throw new Error('community smoke: upstream community package remains installed')
  }
  const retiredWorkshop = new Set(['@gestaltrun/dsh-client-ui-market',
    '@gestaltrun/dsh-client-ui-preset-center', '@gestaltrun/dsh-client-ui-community-plugins'])
  if (installed.some(entry => retiredWorkshop.has(entry.name))) throw new Error('community smoke: Workshop package remains installed')
  const cordis = installed.filter(entry => entry.name === '@deepseek-ai/cordis')
  if (cordis.length !== 1) throw new Error(`community smoke: expected one Cordis package, found ${String(cordis.length)}`)
  const resolved: unknown = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
const [runtime, ...packages] = process.argv.slice(1)
console.log(JSON.stringify(['', ...packages].map(name => {
  const path = name === '' ? join(runtime, 'package.json') : join(runtime, 'node_modules', name, 'package.json')
  return realpathSync(createRequire(path).resolve('@deepseek-ai/cordis'))
})))
`, realpathSync(runtime), ...artifacts.map(artifact => artifact.name)], {
    encoding: 'utf8', timeout: 30_000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_OPTIONS' && name !== 'NODE_PATH')),
  }))
  if (!Array.isArray(resolved) || resolved.length !== artifacts.length + 1 || resolved.some(path => typeof path !== 'string')) {
    throw new Error('community smoke: invalid runtime module resolution result')
  }
  const [shared, ...consumers] = resolved as string[]
  if (shared === undefined) throw new Error('community smoke: runtime did not resolve Cordis')
  const cordisPath = relative(realpathSync(runtime), shared)
  if (cordisPath === '..' || cordisPath.startsWith('..' + sep)) throw new Error('community smoke: Cordis resolves outside the runtime')
  for (const [index, artifact] of artifacts.entries()) {
    const path = join(runtime, 'node_modules', ...artifact.name.split('/'), 'package.json')
    const value = manifest(path)
    if (value.name !== artifact.name || value.version !== artifact.version) throw new Error(`community smoke: installed identity differs for ${artifact.name}`)
    if (consumers[index] !== shared) throw new Error(`community smoke: ${artifact.name} resolves another Cordis`)
  }
  return { packages: installed.length, cordis: cordisPath.split(sep).join('/') }
}

function childEnvironment(scratch: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name)
      && name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^(?:npm|pnpm|corepack|DSH)_/iu.test(name))),
    DSH_HOME: join(scratch, 'home'), DSH_AGENTS_HOME: join(scratch, 'agents'), DSH_TELEMETRY_DISABLED: '1',
    NPM_CONFIG_USERCONFIG: join(scratch, 'npmrc'), NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    NODE_NO_WARNINGS: '1',
    XDG_CACHE_HOME: join(scratch, 'cache'), XDG_CONFIG_HOME: join(scratch, 'config'),
  }
}

function redact(text: string): string {
  return text.replace(/token=[^\s&"'<>]+/gu, 'token=<redacted>')
}

async function runPnpm(args: string[], cwd: string, scratch: string): Promise<void> {
  const invocation = pnpmInvocation(['--config.verify-deps-before-run=error', ...args])
  const child = execa(invocation.command, invocation.args, {
    cwd, env: { ...childEnvironment(scratch), CI: 'true' }, extendEnv: false, reject: false,
    input: '', timeout: 600_000, forceKillAfterDelay: 5000, maxBuffer: 16 * 1024 * 1024,
  })
  const log = join(scratch, 'pnpm.log')
  appendFileSync(log, `\npnpm ${args.join(' ')}\n`, { mode: 0o600 })
  child.stdout.on('data', (chunk: Buffer) => { appendFileSync(log, chunk) })
  child.stderr.on('data', (chunk: Buffer) => { appendFileSync(log, chunk) })
  const result = await child
  if (result.failed || result.timedOut || result.exitCode !== 0 || result.signal !== undefined) {
    throw new Error(`community smoke: pnpm ${args.join(' ')} failed (exit=${String(result.exitCode)}, timeout=${String(result.timedOut)}, signal=${String(result.signal)})\n${redact(result.stdout + '\n' + result.stderr).slice(-8000)}`)
  }
}

/**
 * Launch an isolated Web profile from a materialized runtime and exercise its community modules.
 * @param runtime - Verified installed runtime tree.
 * @param scratch - Owned temporary parent for the profile and application data.
 * @param bundles - Explicit profile composition installed in the runtime.
 * @returns Client entries, assets, and routes served by the authenticated Web Host.
 */
export async function smokeCommunityWeb(runtime: string, scratch: string, bundles: readonly string[]): Promise<CommunityRouteSmoke> {
  const home = mkdtempSync(join(scratch, 'web-home-'))
  const profile = join(home, 'profiles', 'community-smoke')
  createPluginProfile(profile, bundles)
  symlinkSync(join(runtime, 'node_modules'), join(profile, 'node_modules'), 'junction')
  const child = execa(process.execPath, [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'community-smoke', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: profile, env: { ...childEnvironment(scratch), DSH_HOME: home }, extendEnv: false,
    reject: false, timeout: 180_000, forceKillAfterDelay: 5000,
  })
  let output = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const ready = new Promise<string>((accept, reject) => {
    timer = setTimeout(() => { reject(new Error('community smoke: Web readiness timed out')) }, 120_000)
    timer.unref()
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-65536)
      const url = /dsh web: (http:\/\/[^\s]+)\r?\n/u.exec(output)?.[1]
      if (url !== undefined) accept(url)
    })
    child.then((result) => {
      reject(new Error(`community smoke: Web exited before readiness\n${redact(result.stdout + '\n' + result.stderr).slice(-8000)}`))
    }, reject)
  })
  try {
    const url = new URL(await ready)
    if (timer !== undefined) clearTimeout(timer)
    if (url.hostname !== '127.0.0.1' || url.port === '' || !url.searchParams.get('token')) throw new Error('community smoke: unexpected Web readiness URL')
    const authentication = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    const cookies = authentication.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
    await authentication.arrayBuffer()
    if (authentication.status !== 303 || cookies === '') throw new Error('community smoke: Web did not exchange the launch token for a browser cookie')
    const result = await smokeCommunityPluginRoutes((path, init) => {
      const target = new URL(path, url.origin)
      if (target.origin !== url.origin) throw new Error('community smoke: client artifact leaves the authenticated Host')
      const headers = new Headers(init?.headers)
      headers.set('cookie', cookies)
      headers.set('origin', url.origin)
      return fetch(target, { ...init, headers, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    })
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    child.kill('SIGTERM')
    const result = await child
    if (result.timedOut || result.isForcefullyTerminated || (result.exitCode !== 0 && result.signal !== 'SIGTERM')) {
      throw new Error('community smoke: Web shutdown did not complete gracefully')
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { keep: { type: 'boolean' }, resume: { type: 'string' }, artifacts: { type: 'string' } } })
  const retained = values.resume === undefined ? undefined : readRetainedCandidate(values.resume)
  const scratch = retained?.scratch ?? realpathSync(mkdtempSync(join(tmpdir(), 'gestaltrun-community-smoke-')))
  const output = join(ROOT, '.artifacts/community-smoke.json')
  const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  const report: Record<string, unknown> = { schemaVersion: 1, commit: retained?.report.commit ?? git(['rev-parse', 'HEAD']),
    dirty: retained?.report.dirty ?? git(['status', '--porcelain', '--untracked-files=normal']) !== '',
    candidate: retained === undefined ? 'current-build' : 'retained-archives', platform: process.platform, arch: process.arch,
    startedAt: new Date().toISOString(), status: 'running' }
  if (retained !== undefined) report.artifacts = retained.report.artifacts
  writeFileSync(join(scratch, 'npmrc'), '', { mode: 0o600 })
  try {
    const plugins = readCommunityPlugins()
    let communityOutput = values.artifacts === undefined ? COMMUNITY_OUTPUT : resolve(values.artifacts)
    let commits: Record<string, string>
    if (retained === undefined) {
      checkCommunitySources()
      commits = Object.fromEntries(plugins.map(plugin => [plugin.repository, git(['-C', plugin.path, 'rev-parse', 'HEAD'])]))
    } else {
      const previous = retained.report.artifacts as CommunityArtifact[]
      communityOutput = mkdtempSync(join(scratch, 'community-input-'))
      const packageSet = verifyDesktopCorePackageSet(join(scratch, 'installation'), String(manifest(join(ROOT, 'package.json')).version))
      for (const artifact of previous) {
        const record = packageSet.packages.find(record => record.name === artifact.name)
        const source = record === undefined ? join(COMMUNITY_OUTPUT, artifact.filename)
          : join(scratch, 'installation/desktop-packages', record.file)
        if (!existsSync(source) || digest(source) !== artifact.integrity) throw new Error(`community smoke: retained tarball unavailable: ${artifact.name}`)
        copyFileSync(source, join(communityOutput, artifact.filename))
      }
      writeFileSync(join(communityOutput, 'product-community.json'), JSON.stringify({ schemaVersion: 1, packages: previous }))
      commits = Object.fromEntries(previous.map(artifact => [artifact.repository, artifact.commit]))
    }
    const artifacts = verifyCommunityArchives(communityOutput, plugins, commits)
    report.artifacts = artifacts
    console.log(retained === undefined ? 'community smoke: packing the current fork runtime'
      : `community smoke: resuming verified candidate ${candidateDigest(artifacts)}`)
    const dsh = join(scratch, 'dsh-tarballs')
    const vendor = join(scratch, 'vendor-tarballs')
    const native = join(scratch, 'native-tarballs')
    const installation = join(scratch, 'installation')
    const runtime = mkdtempSync(join(scratch, 'runtime-'))
    if (retained === undefined) {
      mkdirSync(native)
      await runPnpm(['run', 'release:pack', '--family', 'dsh', '--concurrency', '4', '--out', dsh], ROOT, scratch)
      await runPnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', dsh], ROOT, scratch)
      await runPnpm(['run', 'release:pack', '--family', 'vendor', '--concurrency', '4', '--out', vendor], ROOT, scratch)
      await runPnpm(['--dir', 'native/system', 'run', 'build:ts'], ROOT, scratch)
      await runPnpm(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', native], ROOT, scratch)
    }
    const roots = plugins.filter(plugin => plugin.defaultBundle).map(plugin => plugin.package)
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...roots]
    if (retained === undefined) prepareDesktopPackageSet([dsh, vendor, native, communityOutput], installation, roots)
    const rootManifest = manifest(join(ROOT, 'package.json'))
    const release = parseDesktopRelease({ schemaVersion: 1, version: rootManifest.version,
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: process.versions.node,
      pnpmVersion: String(rootManifest.packageManager).replace(/^pnpm@/u, '') })
    createRuntimeProjectMetadata(installation, release, bundles)
    const installFlags = ['--config.enable-global-virtual-store=false', '--fetch-retries=2', '--fetch-timeout=600000',
      `--config.userconfig=${join(scratch, 'npmrc')}`]
    if (retained === undefined || existsSync(join(scratch, 'store'))) installFlags.push(`--config.store-dir=${join(scratch, 'store')}`)
    console.log('community smoke: installing isolated production tarballs')
    await runPnpm([...installFlags, 'install', '--lockfile-only'], installation, scratch)
    const packageSet = readDesktopCorePackageSet(installation, release.version)
    verifyDesktopCoreLockfile(readFileSync(join(installation, 'pnpm-lock.yaml'), 'utf8'), packageSet)
    await runPnpm([...installFlags, 'install', '--prod', '--frozen-lockfile', '--trust-lockfile'], installation, scratch)
    const modules = join(installation, 'node_modules')
    cpSync(modules, join(runtime, 'node_modules'), { recursive: true, dereference: true,
      filter: source => desktopRuntimeFileExclusion(relative(modules, source), process) === undefined })
    writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: '@gestaltrun/community-smoke-runtime', private: true,
      version: release.version, type: 'module', dependencies: Object.fromEntries(packageSet.packages.map(entry => [entry.name, entry.version])),
      dsh: { profile: { bundles } } }))
    const installedArtifacts = artifacts.filter(artifact => packageSet.packages.some(record => record.name === artifact.name))
    report.installation = {
      ...verifyCommunityInstallation(runtime, installedArtifacts),
      communityPackages: installedArtifacts.map(entry => entry.name),
    }
    prepareDesktopNativeHelpers(runtime, process)
    const descriptor = writeDesktopRuntime(runtime, release, packageSet.packages.map(entry => entry.name), process, bundles)
    report.runtimeIntegrity = createHash('sha256').update(readFileSync(join(runtime, 'desktop-runtime.json'))).digest('hex')
    report.bundles = bundles
    await verifyDesktopRuntime(runtime, release.version, process)
    console.log('community smoke: exercising packaged native dependencies')
    await execa(process.execPath, [join(ROOT, 'apps/desktop/tests/fixtures/runtime-payload-smoke.mjs'), runtime], {
      cwd: runtime, env: childEnvironment(scratch), extendEnv: false, timeout: 120_000, forceKillAfterDelay: 5000,
    })
    report.native = { passed: true }
    console.log('community smoke: booting packaged DesktopHost and community routes')
    await smokeDesktopRuntime(runtime, process.execPath, descriptor)
    report.desktop = { passed: true, routes: ['settings.get', 'terminal.deps'] }
    console.log('community smoke: booting the same artifacts through the Web profile')
    report.web = { passed: true, ...await smokeCommunityWeb(runtime, scratch, bundles) }
    await verifyDesktopRuntime(runtime, release.version, process)
    report.status = 'passed'
    report.release = release
    if (values.keep) report.runtime = runtime
    console.log('community smoke: Desktop and Web compositions passed')
  } catch (error) {
    report.status = 'failed'
    report.error = redact(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    report.finishedAt = new Date().toISOString()
    mkdirSync(dirname(output), { recursive: true })
    const temporary = join(scratch, 'report.json')
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    if (report.artifacts !== undefined) writeFileSync(join(scratch, OWNER_FILE), JSON.stringify({ schemaVersion: 1,
      root: realpathSync(ROOT), scratch, artifacts: candidateDigest(report.artifacts) }) + '\n', { mode: 0o600 })
    const staged = `${output}.${String(process.pid)}.tmp`
    cpSync(temporary, staged)
    renameSync(staged, output)
    if (values.keep) console.log(`community smoke: retained ${scratch}`)
    else rmSync(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()
