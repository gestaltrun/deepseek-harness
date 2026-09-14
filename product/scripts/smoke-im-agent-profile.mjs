/** Exercise automatic IM admission through the installed public dsh profile launcher. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const anchor = process.env.DSH_IM_SMOKE_INSTALL_ROOT
assert.ok(anchor, 'DSH_IM_SMOKE_INSTALL_ROOT must identify an isolated installed candidate consumer')
const require = createRequire(join(anchor, 'package.json'))
const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')
const root = await mkdtemp(join(anchor, '.im-agent-profile-'))
const home = join(root, 'home')
const output = join(root, 'evidence')
await mkdir(output)
const fixture = join(root, 'im-agent-profile.mjs')
await copyFile(resolve(import.meta.dirname, 'fixtures/im-agent-profile.mjs'), fixture)
const environment = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents') }
for (const key of Object.keys(environment)) {
  if (/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/iu.test(key) || key === 'NODE_PATH' || key === 'NODE_OPTIONS') delete environment[key]
}
const commands = []
async function run(label, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  })
  await writeFile(join(output, `${label}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`)
  commands.push({ label, executable: process.execPath, args: [cli, ...args], status: result.status, signal: result.signal })
  await writeFile(join(output, 'commands.json'), JSON.stringify(commands, null, 2) + '\n')
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${label} must finish through the dsh lifecycle`)
  assert.equal(result.status, 0, `${label} failed; evidence: ${output}`)
}

const profile = 'im-agent-offline-smoke'
const runtimeManifest = require.resolve('@gestaltrun/dsh-im-runtime/package.json')
const runtime = JSON.parse(await readFile(runtimeManifest, 'utf8'))
const officialCordis = await realpath(require.resolve('@deepseek-ai/cordis/package.json'))
assert.equal(await realpath(createRequire(runtimeManifest).resolve('@deepseek-ai/cordis/package.json')), officialCordis)
const archive = process.env.DSH_IM_SMOKE_RUNTIME_ARCHIVE ?? resolve(import.meta.dirname, '../dist/gestaltrun-dsh-im-runtime-0.1.0-gestaltrun.0.tgz')
const archiveBytes = await readFile(archive)
const packedManifestResult = spawnSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', timeout: 10000 })
assert.ifError(packedManifestResult.error)
assert.equal(packedManifestResult.signal, null, 'runtime archive manifest read must finish')
assert.equal(packedManifestResult.status, 0, 'runtime archive must contain package/package.json')
const packedRuntime = JSON.parse(packedManifestResult.stdout)
assert.equal(packedRuntime.name, '@gestaltrun/dsh-im-runtime')
assert.equal(packedRuntime.version, runtime.version)
const packedEntryResult = spawnSync('tar', ['-xOzf', archive, 'package/lib/index.js'], { encoding: null, timeout: 10000 })
assert.ifError(packedEntryResult.error)
assert.equal(packedEntryResult.signal, null, 'runtime archive entry read must finish')
assert.equal(packedEntryResult.status, 0, 'runtime archive must contain package/lib/index.js')
const archiveEntrySha256 = createHash('sha256').update(packedEntryResult.stdout).digest('hex')
const runtimeEntrySha256 = createHash('sha256').update(await readFile(join(dirname(runtimeManifest), 'lib/index.js'))).digest('hex')
assert.equal(archiveEntrySha256, runtimeEntrySha256, 'installed consumer and runtime archive must contain the same entry')
await run('init', ['plugin', '--profile', profile, 'add', '--ignore-scripts', '--offline', archive])
const patch = join(root, 'im-agent.patch.yml')
await writeFile(patch, [
  '- id: agent-default-model', '  config:', '    provider: im-offline-fixture', '    model: deterministic-im',
  '- id: session-title-llm', '  disabled: true',
  '- id: llm-deepseek', '  disabled: true',
  '- insert:',
  "    - id: im-fixture-workspace", "      name: '@deepseek-ai/dsh-workspace'",
  "    - id: im-fixture-presets", "      name: '@deepseek-ai/dsh-agent-presets'", '      config:', '        default: standard', '        includeUserRoot: false',
  "    - id: im-fixture-subagent-model-selection", "      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'",
  "    - id: im-fixture-runtime", "      name: '@gestaltrun/dsh-im-runtime'",
  '    - id: im-fixture-driver', `      name: ${JSON.stringify(pathToFileURL(fixture).href)}`, '      config:',
  `        workspace: ${JSON.stringify(join(root, 'workspace'))}`, `        output: ${JSON.stringify(output)}`, '',
].join('\n'))
const manifestPath = join(home, 'profiles', profile, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const profileRequire = createRequire(manifestPath)
const installedRuntimeManifest = profileRequire.resolve('@gestaltrun/dsh-im-runtime/package.json')
const installedRuntime = JSON.parse(await readFile(installedRuntimeManifest, 'utf8'))
assert.equal(installedRuntime.name, packedRuntime.name)
assert.equal(installedRuntime.version, packedRuntime.version)
const installedEntrySha256 = createHash('sha256').update(await readFile(join(dirname(installedRuntimeManifest), 'lib/index.js'))).digest('hex')
assert.equal(installedEntrySha256, archiveEntrySha256, 'profile must execute the supplied runtime archive')
assert.equal(await realpath(createRequire(installedRuntimeManifest).resolve('@deepseek-ai/cordis/package.json')), officialCordis)
manifest.dependencies['@gestaltrun/dsh-im-runtime'] = runtime.version
manifest.dependencies['@deepseek-ai/dsh-workspace'] = '0.1.5-rc.2'
manifest.dependencies['@deepseek-ai/dsh-agent-presets'] = '0.1.5-rc.2'
manifest.dependencies['@deepseek-ai/dsh-tool-subagent'] = '0.1.5-rc.2'
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(output, 'inputs.json'), JSON.stringify({
  fixtureKind: 'synthetic Provider and scripted LLM; not a live recording',
  runtime: { path: await realpath(runtimeManifest), version: runtime.version, entrySha256: runtimeEntrySha256 },
  archive: { path: await realpath(archive), name: packedRuntime.name, version: packedRuntime.version,
    sha256: createHash('sha256').update(archiveBytes).digest('hex'), entrySha256: archiveEntrySha256 },
  installedRuntime: { path: await realpath(installedRuntimeManifest), version: installedRuntime.version,
    entrySha256: installedEntrySha256 },
  cli, cordis: officialCordis, profile, profileManifest: manifest, patch,
  fixtureSha256: createHash('sha256').update(await readFile(fixture)).digest('hex'),
}, null, 2) + '\n')
await run('execute', ['--profile', profile, '--patch', patch])
const proof = JSON.parse(await readFile(join(output, 'proof.json'), 'utf8'))
assert.equal(proof.automaticAgent, true)
assert.equal(proof.modelRequests, 3)
assert.equal(proof.rejectedWrongOwner, true)
assert.ok(proof.tools.includes('im_query_history') && proof.tools.includes('im_send_message'))
assert.ok(proof.persistedSession)
console.log(JSON.stringify({ state: 'passed', root, proof: join(output, 'proof.json'), fixture: proof.fixture }))
