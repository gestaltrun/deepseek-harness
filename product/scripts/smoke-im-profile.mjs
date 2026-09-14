/** Verify candidate bundle installation, profile composition, and removal through dsh. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const anchor = process.env.DSH_IM_SMOKE_INSTALL_ROOT
assert.ok(anchor, 'DSH_IM_SMOKE_INSTALL_ROOT must name an isolated installed dsh consumer')
const archives = process.env.DSH_IM_SMOKE_ARTIFACTS ?? resolve(import.meta.dirname, '../dist')
const require = createRequire(join(anchor, 'package.json'))
const { load } = require('js-yaml')
const { entryListSchema } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-include')).href)
const cliManifest = require.resolve('@deepseek-ai/dsh/package.json')
const cli = join(cliManifest, '..', 'lib/bin.js')
const root = await mkdtemp(join(anchor, '.im-profile-smoke-'))
const home = join(root, 'home')
const profile = 'im-profile-smoke'
const environment = { ...process.env, DSH_HOME: home }
const commands = []
for (const key of Object.keys(environment)) {
  if (/KEY|SECRET|TOKEN|PASSWORD/iu.test(key) || key === 'NODE_PATH' || key === 'NODE_OPTIONS') delete environment[key]
}

async function run(label, args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  })
  await writeFile(join(root, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`)
  commands.push({ label, executable: process.execPath, args: [cli, ...args], status: result.status, signal: result.signal })
  await writeFile(join(root, 'commands.json'), `${JSON.stringify(commands, null, 2)}\n`)
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${label} was terminated`)
  assert.equal(result.status, expected, `${label}: ${result.stderr ?? result.stdout}`)
  return result.stdout
}

function imRows(output) {
  const rows = load(output, { schema: entryListSchema })
  assert.ok(Array.isArray(rows))
  return rows.filter(row => ['gestaltrun-im-runtime', 'gestaltrun-im-api', 'gestaltrun-im-ui'].includes(row.id))
}

function pickerNames(rows) {
  return rows.filter(row => row.disabled !== true && [
    '@deepseek-ai/dsh-host-directory-picker-auto', '@deepseek-ai/dsh-host-directory-picker-browse',
    '@deepseek-ai/dsh-host-directory-picker-native',
  ].includes(row.name)).map(row => row.name)
}

try {
  const baseline = await run('baseline', ['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
  assert.deepEqual(imRows(baseline), [])
  const manifestPath = join(home, 'profiles', profile, 'package.json')
  const baselineManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const tarballs = []
  const identities = []
  for (const name of ['im-runtime', 'api-im', 'ui-im', 'im-bundle']) {
    const filename = `gestaltrun-dsh-${name}-0.1.0-gestaltrun.0.tgz`
    const target = join(root, filename)
    await copyFile(join(archives, filename), target)
    const tar = spawnSync('tar', ['-xOzf', target, 'package/package.json'], { encoding: 'utf8', timeout: 10_000 })
    assert.ifError(tar.error)
    assert.equal(tar.signal, null)
    assert.equal(tar.status, 0)
    const packed = JSON.parse(tar.stdout)
    assert.equal(packed.name, `@gestaltrun/dsh-${name}`)
    assert.equal(packed.version, '0.1.0-gestaltrun.0')
    identities.push({ name: packed.name, version: packed.version, filename,
      sha256: createHash('sha256').update(await readFile(target)).digest('hex') })
    tarballs.push(target)
  }
  await writeFile(join(root, 'candidate-inputs.json'), `${JSON.stringify(identities, null, 2)}\n`)
  await writeFile(join(home, 'profiles', profile, 'pnpm-workspace.yaml'), `${JSON.stringify({
    packages: [],
    autoInstallPeers: false,
    nodeLinker: 'hoisted',
    overrides: Object.fromEntries(['im-runtime', 'api-im', 'ui-im'].map((name, index) => [
      `@gestaltrun/dsh-${name}@0.1.0-gestaltrun.0`, `file:${tarballs[index]}`,
    ])),
  }, null, 2)}\n`)
  await run('install', ['plugin', '--profile', profile, 'add', '--ignore-scripts', '--offline', ...tarballs])
  const installed = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeFile(join(root, 'installed-profile.json'), `${JSON.stringify(installed, null, 2)}\n`)
  assert.deepEqual(installed.dsh.profile.bundles, [...baselineManifest.dsh.profile.bundles, '@gestaltrun/dsh-im-bundle'])
  const composed = await run('installed', ['--profile', profile, '--dump-config'])
  assert.deepEqual(pickerNames(load(composed, { schema: entryListSchema })), ['@deepseek-ai/dsh-host-directory-picker-browse'])
  assert.deepEqual(imRows(composed).map(row => [row.id, row.name]), [
    ['gestaltrun-im-runtime', '@gestaltrun/dsh-im-runtime'],
    ['gestaltrun-im-api', '@gestaltrun/dsh-api-im'],
    ['gestaltrun-im-ui', '@gestaltrun/dsh-ui-im'],
  ])
  const profileRequire = createRequire(manifestPath)
  const webOverlay = profileRequire.resolve('@gestaltrun/dsh-im-bundle/web.patch.yml')
  const webComposed = load(await run('web-overlay', ['--profile', profile, '--patch', webOverlay, '--dump-config']), { schema: entryListSchema })
  assert.deepEqual(pickerNames(webComposed), ['@deepseek-ai/dsh-host-directory-picker-browse'])
  assert.equal(webComposed.find(row => row.id === 'gestaltrun-im-ui').config.directoryPicker, 'browse')
  const desktopOverlay = profileRequire.resolve('@gestaltrun/dsh-im-bundle/desktop.patch.yml')
  const desktopBase = resolve(import.meta.dirname, '../../apps/desktop-host/config/desktop.cordis.patch.yml')
  const desktopComposed = load(await run('desktop-overlay', ['--profile', profile, '--patch', desktopOverlay, '--patch', desktopBase, '--dump-config']), { schema: entryListSchema })
  assert.deepEqual(pickerNames(desktopComposed), ['@deepseek-ai/dsh-host-directory-picker-native'])
  assert.equal(desktopComposed.find(row => row.id === 'gestaltrun-im-ui').config.directoryPicker, 'native')
  const bundleRequire = createRequire(profileRequire.resolve('@gestaltrun/dsh-im-bundle/package.json'))
  const hostCordis = await realpath(require.resolve('@deepseek-ai/cordis/package.json'))
  const installedPackages = []
  for (const name of ['@gestaltrun/dsh-api-im', '@gestaltrun/dsh-im-runtime', '@gestaltrun/dsh-ui-im']) {
    const ownerManifest = profileRequire.resolve(`${name}/package.json`)
    assert.equal(await realpath(bundleRequire.resolve(`${name}/package.json`)), await realpath(ownerManifest))
    const ownerRequire = createRequire(ownerManifest)
    assert.equal(await realpath(ownerRequire.resolve('@deepseek-ai/cordis/package.json')), hostCordis)
    installedPackages.push({ ...JSON.parse(await readFile(ownerManifest, 'utf8')), resolvedCordis: hostCordis })
  }
  await writeFile(join(root, 'installed-packages.json'), `${JSON.stringify(installedPackages, null, 2)}\n`)
  const invalid = join(root, 'invalid.patch.yml')
  await writeFile(invalid, '- insert: [unterminated\n')
  await run('invalid-overlay', ['--profile', profile, '--patch', invalid, '--dump-config'], 1)
  const retained = join(home, 'retained-configuration.txt')
  await writeFile(retained, 'profile removal preserves shared state\n')
  await run('remove', ['plugin', '--profile', profile, 'remove', '@gestaltrun/dsh-im-bundle'])
  const removed = await run('removed', ['--profile', profile, '--dump-config'])
  assert.deepEqual(imRows(removed), [])
  assert.equal(await readFile(retained, 'utf8'), 'profile removal preserves shared state\n')
  console.log(JSON.stringify({ publicCli: true, profile: 'web template with product bundle', installed: true,
    rows: 3, invalidOverlayRejected: true, removed: true, sharedStateRetained: true,
    candidateTarballBindings: true, sharedCordis: true, matchedWebDirectoryPicker: true, matchedDesktopDirectoryPicker: true, providerCalls: 0, modelCalls: 0, appLaunched: false,
    ...(process.env.DSH_IM_SMOKE_KEEP_ROOT === '1' ? { evidenceRoot: root } : {}),
  }))
} finally {
  if (process.env.DSH_IM_SMOKE_KEEP_ROOT !== '1') await rm(root, { recursive: true, force: true })
}
