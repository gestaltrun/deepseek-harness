/** Load the packed product against installed official npm packages, without source aliases. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const archive = resolve(root, '../dist', `gestaltrun-dsh-model-center-${manifest.version}.tgz`)
const directory = await mkdtemp(resolve(root, '../dist/package-smoke-'))
const ctx = new Context()
const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
})
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory])
  const packed = JSON.parse(await readFile(join(directory, 'package/package.json'), 'utf8'))
  assert.equal(packed.name, manifest.name)
  assert.equal(packed.version, manifest.version)
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const range of Object.values(packed[section] ?? {})) assert(!/^(file|link|workspace):/.test(range))
  }
  const product = await import(pathToFileURL(join(directory, 'package/lib/index.js')).href)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ 'llm-pi-ai': { providers: { packed: {
    api: 'openai-completions', baseURL: `http://127.0.0.1:${port}/v1`, apiKeyEnv: 'PACKED_TEST_KEY',
    compat: { thinkingFormat: 'openai' }, models: [{ id: 'model', input: ['text', 'image'],
      reasoningEfforts: { low: 'low', high: 'high' }, defaultReasoningLevel: 'high' }],
  } } } }))
  await writeFile(join(directory, 'credentials.yaml'), 'version: 1\nrefs:\n  PACKED_TEST_KEY: artifact-fixture-key\n', { mode: 0o600 })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(directory, 'settings.json'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(directory, 'credentials.yaml'), watch: false })
  const fiber = ctx.plugin(product, {})
  await fiber
  for (const runtime of ctx.registry.values()) for (const child of runtime.fibers) await child.await()
  const call = await ctx.llm.prepareCall({ provider: 'packed', model: 'model' })
  assert.equal(call.config.reasoningEffort, 'high')
  for await (const chunk of call.stream({ ...call.config, messages: [] })) {
    if (chunk.type === 'finish') assert.notEqual(chunk.reason.kind, 'error')
  }
  assert.equal(requests[0].reasoning_effort, 'high')
  let entry
  const client = await readFile(join(directory, 'package/lib/client.js'), 'utf8')
  assert(!client.includes(root), 'client archive contains the build checkout path')
  runInNewContext(client, {
    window: { __ModuleLoader__: { load: value => { entry = value } } },
  })
  assert.equal(entry.id, manifest.name)
  assert.equal(typeof entry.factory, 'function')
  const require = createRequire(import.meta.url)
  const parentRequire = createRequire(join(directory, 'package/package.json'))
  assert.equal(require.resolve('@deepseek-ai/cordis'), parentRequire.resolve('@deepseek-ai/cordis'))
  await fiber.dispose()
  assert.deepEqual(ctx.llm.listProviders(), [])
  const report = { package: `${packed.name}@${packed.version}`, integrity: `sha512-${createHash('sha512').update(await readFile(archive)).digest('base64')}`,
    host: 'packed JavaScript loaded with installed official npm modules; no tsx or source aliases',
    clientFactory: entry.id, oneCordis: true, actualRequestEffort: requests[0].reasoning_effort,
    disposed: true, provider: 'local HTTP fixture', nativeDesktop: false }
  await writeFile(resolve(root, '../dist/package-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
