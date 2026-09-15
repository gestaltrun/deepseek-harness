/** Build the exact reviewed CLIProxyAPI source into this product package's target resources. */
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { verifyAccountPoolScope } from '../../../scripts/account-pool-scope.mjs'

/**
 * Resolve a supported Go cross-compilation target.
 * @param {string} platform - Node platform identifier.
 * @param {string} arch - Node architecture identifier.
 * @returns {{goos: string, goarch: string, filename: string}} Go target and executable filename.
 */
export function engineTarget(platform, arch) {
  const goos = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[platform]
  const goarch = { arm64: 'arm64', x64: 'amd64' }[arch]
  if (!goos || !goarch) throw new Error(`account-pool engine: unsupported target ${platform}/${arch}`)
  return { goos, goarch, filename: platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api' }
}

/**
 * Verify the reviewed repository and complete source identity before compiling it.
 * @param {unknown} value - Parsed product provenance document.
 * @returns {{repository: string, submodule: string, commit: string, scopeBase: string}} Validated build inputs.
 */
export function engineIdentity(value) {
  if (value?.engine?.repository !== 'https://github.com/gestaltrun/CLIProxyAPI.git'
    || value?.engine?.submodule !== 'community/cliproxyapi'
    || !/^[a-f0-9]{40}$/u.test(value?.engine?.commit ?? '')
    || !/^[a-f0-9]{40}$/u.test(value?.harness?.scopeBase ?? '')) {
    throw new Error('account-pool engine: UPSTREAM.json must pin the reviewed repository, gitlink, source SHA, and scope base')
  }
  return {
    repository: value.engine.repository,
    submodule: value.engine.submodule,
    commit: value.engine.commit,
    scopeBase: value.harness.scopeBase,
  }
}

function run(command, args, cwd, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`account-pool build: ${command} exited ${String(code ?? signal)}`)))
  })
}

/**
 * Build one target and publish its binary, license, and verified identity manifest.
 * @param {{packageRoot: string, platform: string, arch: string}} options - Product checkout and selected target.
 * @returns {Promise<{sourceSHA: string, platform: string, arch: string, filename: string, sha256: string}>} Published runtime identity.
 */
export async function buildEngine({ packageRoot, platform, arch }) {
  const root = resolve(packageRoot)
  const identity = engineIdentity(JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8')))
  const target = engineTarget(platform, arch)
  verifyAccountPoolScope({ repositoryRoot: resolve(root, '../../..'), base: identity.scopeBase })
  const source = resolve(root, '../../..', identity.submodule)
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
  if (!existsSync(join(source, '.git'))) {
    throw new Error('account-pool engine: community/cliproxyapi submodule is missing')
  }
  const origin = git('config', '--get', 'remote.origin.url')
  if (origin !== identity.repository) throw new Error('account-pool engine: community/cliproxyapi origin differs from UPSTREAM.json')
  if (git('rev-parse', 'HEAD') !== identity.commit) throw new Error('account-pool engine: community/cliproxyapi differs from UPSTREAM.json')
  if (git('status', '--porcelain=v1', '--untracked-files=all') !== '') throw new Error('account-pool engine: community/cliproxyapi contains changes')
  const cache = join(root, '.build')
  const staging = mkdtempSync(join(cache, 'target-'))
  try {
    const binary = join(staging, target.filename)
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
    Object.assign(env, { GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0', GOENV: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local' })
    await run('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', binary, './cmd/server'], source, env)
    if (platform !== 'win32') chmodSync(binary, 0o755)
    const sha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')
    const manifest = { sourceSHA: identity.commit, platform, arch, filename: target.filename, sha256 }
    copyFileSync(join(source, 'LICENSE'), join(staging, 'LICENSE'))
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const output = join(root, 'resources', 'cliproxyapi', `${platform}-${arch}`)
    mkdirSync(output, { recursive: true })
    for (const file of [target.filename, 'LICENSE', 'manifest.json']) renameSync(join(staging, file), join(output, file))
    console.log(JSON.stringify({ resourceDirectory: output, ...manifest }))
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { platform: { type: 'string' }, arch: { type: 'string' } } })
  await buildEngine({ packageRoot: resolve(import.meta.dirname, '..'), platform: values.platform ?? process.platform, arch: values.arch ?? process.arch })
}
