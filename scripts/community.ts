/** Build the pinned community forks into the npm artifacts consumed by this product. */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** One independently versioned plugin source in the product composition. */
export interface CommunityPlugin {
  readonly path: string
  readonly repository: string
  readonly package: string
  readonly version: string
  readonly defaultBundle: boolean
}

/** Immutable npm artifact with the source commit that produced it. */
export interface CommunityArtifact {
  readonly name: string
  readonly version: string
  readonly filename: string
  readonly integrity: string
  readonly repository: string
  readonly commit: string
}

const ROOT = resolve(import.meta.dirname, '..')
/** Shared build destination for verified community npm archives. */
export const COMMUNITY_OUTPUT = resolve(ROOT, '.artifacts/community')
const SCOPE = '@gestaltrun/'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read the product's explicit community package versions and default bundle roots.
 * @param root - Harness repository root.
 * @returns Validated plugin records in build dependency order.
 */
export function readCommunityPlugins(root = ROOT): readonly CommunityPlugin[] {
  const value: unknown = JSON.parse(readFileSync(join(root, 'product/community.json'), 'utf8'))
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length === 0) {
    throw new Error('community: invalid product manifest')
  }
  const plugins = value.plugins.map((entry: unknown): CommunityPlugin => {
    if (!record(entry) || typeof entry.path !== 'string' || !/^community\/[a-z0-9-]+$/u.test(entry.path)
      || typeof entry.repository !== 'string' || !/^gestaltrun\/[a-z0-9-]+$/u.test(entry.repository)
      || typeof entry.package !== 'string' || !/^@gestaltrun\/[a-z0-9-]+$/u.test(entry.package)
      || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(entry.version)
      || typeof entry.defaultBundle !== 'boolean') {
      throw new Error('community: invalid plugin record')
    }
    return { path: entry.path, repository: entry.repository, package: entry.package,
      version: entry.version, defaultBundle: entry.defaultBundle }
  })
  if (new Set(plugins.map(entry => entry.path)).size !== plugins.length
    || new Set(plugins.map(entry => entry.package)).size !== plugins.length
    || !plugins.some(entry => entry.defaultBundle)) throw new Error('community: duplicate source/package or no default bundle')
  return plugins
}

function manifest(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!record(value)) throw new Error(`community: invalid package manifest ${path}`)
  return value
}

/**
 * Reject upstream community names and development-only dependency references in a packed package.
 * @param value - Manifest extracted from an npm tarball.
 */
export function verifyCommunityPackage(value: Readonly<Record<string, unknown>>): void {
  if (typeof value.name !== 'string' || !value.name.startsWith(SCOPE) || typeof value.version !== 'string') {
    throw new Error('community: artifact must have a versioned @gestaltrun package name')
  }
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const entries = value[section]
    if (entries === undefined) continue
    if (!record(entries)) throw new Error(`community: invalid ${section}`)
    for (const [name, version] of Object.entries(entries)) {
      if (name.startsWith('@linxin666/') || name === 'dsh-better-sidebar' || name.startsWith('@gestalt/')) {
        throw new Error(`community: ${value.name} still resolves upstream community package ${name}`)
      }
      if (typeof version !== 'string' || /^(?:workspace|link|file):/u.test(version)) {
        throw new Error(`community: ${value.name} has unpublished dependency ${name}`)
      }
      if (name.startsWith(SCOPE) && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
        throw new Error(`community: ${value.name} must pin ${name} to an exact version`)
      }
    }
  }
}

/**
 * Verify submodule origins, pinned commits, and the configured package identities.
 * @param root - Harness checkout whose Git index owns the submodule pins.
 */
export function checkCommunitySources(root = ROOT): void {
  for (const plugin of readCommunityPlugins(root)) {
    const directory = join(root, plugin.path)
    const configured = execFileSync('git', ['config', '-f', '.gitmodules', '--get', `submodule.${plugin.path}.url`],
      { cwd: root, encoding: 'utf8' }).trim()
    if (configured !== `https://github.com/${plugin.repository}.git`) throw new Error(`community: wrong origin for ${plugin.path}`)
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: directory, encoding: 'utf8' }).trim()
    if (dirty !== '') throw new Error(`community: ${plugin.path} contains uncommitted source changes`)
    const index = execFileSync('git', ['ls-files', '--stage', '--', plugin.path], { cwd: root, encoding: 'utf8' }).trim()
    if (!index.startsWith(`160000 ${head} 0\t`)) throw new Error(`community: ${plugin.path} differs from its recorded Git pin`)
    const files = [join(directory, 'package.json'), ...globSync('packages/**/package.json', {
      cwd: directory, exclude: ['**/node_modules/**'],
    }).map(path => join(directory, path))]
    const found = files.map(path => manifest(path)).find(value => value.name === plugin.package)
    if (found?.version !== plugin.version) throw new Error(`community: ${plugin.package} does not match ${plugin.version}`)
  }
}

function runPnpm(args: string[], cwd = ROOT): void {
  const invocation = pnpmInvocation(args)
  const child = spawnSync(invocation.command, invocation.args, { cwd, stdio: 'inherit', env: process.env })
  if (child.error !== undefined) throw child.error
  if (child.status !== 0 || child.signal !== null) throw new Error(`community: pnpm failed (${String(child.status ?? child.signal)})`)
}

function runPluginPnpm(plugin: CommunityPlugin, args: string[]): void {
  const packageManager = manifest(join(ROOT, plugin.path, 'package.json')).packageManager
  if (typeof packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager)) {
    throw new Error(`community: ${plugin.path} must pin its pnpm version`)
  }
  runPnpm(['dlx', packageManager, '--dir', plugin.path, ...args])
}

/**
 * Build both forks and inventory the exact npm archives used by Desktop and composition tests.
 * @param output - Destination containing one package tarball per name.
 * @returns Verified artifacts, including source commit and content integrity.
 */
export function packCommunity(output = COMMUNITY_OUTPUT): readonly CommunityArtifact[] {
  checkCommunitySources()
  mkdirSync(output, { recursive: true })
  const artifacts: CommunityArtifact[] = []
  let sidebar: string | undefined
  for (const plugin of readCommunityPlugins()) {
    if (sidebar === undefined) runPluginPnpm(plugin, ['install', '--frozen-lockfile', '--ignore-scripts'])
    const staging = mkdtempSync(join(output, '.pack-'))
    try {
      const args = ['run', 'release:pack', '--', '--out', staging]
      if (sidebar !== undefined) args.push('--sidebar-tarball', sidebar)
      runPluginPnpm(plugin, args)
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(ROOT, plugin.path), encoding: 'utf8' }).trim()
      for (const filename of readdirSync(staging).filter(file => file.endsWith('.tgz')).sort()) {
        const path = join(staging, filename)
        const value: unknown = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' }))
        if (!record(value)) throw new Error(`community: invalid tarball ${filename}`)
        verifyCommunityPackage(value)
        const name = String(value.name)
        const version = String(value.version)
        if (version !== plugin.version) throw new Error(`community: ${filename} has unexpected version ${version}`)
        artifacts.push({ name, version, filename, repository: plugin.repository, commit,
          integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}` })
        copyFileSync(path, join(output, filename))
        if (name === '@gestaltrun/dsh-better-sidebar') sidebar = join(output, filename)
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
    if (!artifacts.some(entry => entry.name === plugin.package && entry.version === plugin.version)) {
      throw new Error(`community: pack omitted ${plugin.package}@${plugin.version}`)
    }
  }
  if (new Set(artifacts.map(entry => entry.name)).size !== artifacts.length) throw new Error('community: duplicate packed name')
  writeFileSync(join(output, 'product-community.json'), `${JSON.stringify({ schemaVersion: 1, packages: artifacts }, null, 2)}\n`)
  return artifacts
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } })
  if (positionals.length !== 1) throw new Error('community: expected check or pack')
  if (positionals[0] === 'check') {
    checkCommunitySources()
    console.log('community: pinned fork package identities verified')
  } else if (positionals[0] === 'pack') {
    const artifacts = packCommunity(values.out === undefined ? COMMUNITY_OUTPUT : resolve(values.out))
    console.log(`community: packed ${String(artifacts.length)} isolated npm packages`)
  } else throw new Error(`community: unknown command ${positionals[0]}`)
}
