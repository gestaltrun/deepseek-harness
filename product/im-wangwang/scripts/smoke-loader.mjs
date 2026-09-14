/** Exercise the built Wangwang provider through a real Loader and product runtime. */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'

async function waitFor(description, predicate) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-im-wangwang-loader-'))
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ code: 0, data: { events: [], nextSinceId: 0, hasMore: false } }))
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('loopback fixture address is unavailable')

const configPath = join(root, 'cordis.yml')
const moduleUrls = [
  import.meta.resolve('@deepseek-ai/dsh-storage'),
  import.meta.resolve('@deepseek-ai/dsh-storage-json'),
  import.meta.resolve('@deepseek-ai/dsh-storage-domain'),
  import.meta.resolve('@deepseek-ai/dsh-credentials-local'),
  new URL('../../im-runtime/lib/index.js', import.meta.url).href,
  new URL('../lib/index.js', import.meta.url).href,
]
const lines = [
  `- name: '${moduleUrls[0]}'`,
  `- name: '${moduleUrls[1]}'`,
  '  config:',
  `    root: '${join(root, 'storage')}'`,
  `- name: '${moduleUrls[2]}'`,
  '  config:',
  "    backend: 'json'",
  `- name: '${moduleUrls[3]}'`,
  '  config:',
  `    path: '${join(root, 'credentials.yaml')}'`,
  '    watch: false',
  `- name: '${moduleUrls[4]}'`,
  `- name: '${moduleUrls[5]}'`,
  '  config:',
  '    admittedMerchants:',
  "      - candidateId: 'fixture-store'",
  `        endpoint: 'http://127.0.0.1:${String(address.port)}'`,
  "        merchantId: 'fixture-merchant'",
  "        displayName: 'Fixture Store'",
  "        mainServiceAccountId: 'fixture-service'",
  '    pollIntervalMs: 60000',
  '    pollLimit: 10',
  '    pollWaitSeconds: 0',
  '',
]
await writeFile(configPath, lines.join('\n'))

const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
try {
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
  if (unloaded.length > 0) throw new Error(`Loader left plugins inactive: ${unloaded.map(entry => entry.options.name).join(', ')}`)
  const runtime = ctx.get('imRuntime')
  if (runtime === undefined) throw new Error('Loader did not publish ctx.imRuntime')
  const candidates = await runtime.listAccountCandidates('wangwang')
  if (candidates.length !== 1 || candidates[0]?.platform !== 'wangwang' || candidates[0].candidateId !== 'fixture-store') {
    throw new Error('Loader did not register the admitted Wangwang candidate')
  }
  const account = await runtime.addAccount({
    platform: 'wangwang', candidateId: 'fixture-store', accessKeyId: 'fixture-access', accessKeySecret: 'fixture-secret',
  })
  if (account.authorization.state !== 'ready' || account.identity.platform !== 'wangwang' || account.identity.merchantId !== 'fixture-merchant') {
    throw new Error('runtime did not persist provider-verified Wangwang identity')
  }
  if (JSON.stringify(runtime.snapshot()).includes('fixture-secret')) throw new Error('runtime snapshot exposed Wangwang credentials')
  const record = await ctx.credentials.readRecord(account.credentialKey)
  if (record?.kind !== 'grant') throw new Error('runtime did not store the Wangwang credential record')
  const route = await runtime.createRoute({
    operationId: 'fixture-create-route',
    accountId: account.id,
    conversationKind: 'direct',
    target: { kind: 'all' },
    workspaceId: 'fixture-workspace',
    enabled: true,
  })
  if (route.status !== 'applied') throw new Error(`runtime did not create the fixture route: ${route.status}`)
  await waitFor('provider listener readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  const owner = { platform: 'wangwang', accountId: account.id, streamId: 'fixture-merchant' }
  if (runtime.getProviderCursor(owner).cursor !== '0') throw new Error('provider listener did not commit the fixture merchant cursor')
  const current = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (current === undefined) throw new Error('runtime lost the fixture Wangwang account')
  const disconnected = await runtime.disconnectAccount({
    operationId: 'fixture-disconnect', accountId: account.id, observedRevision: current.revision,
  })
  if (disconnected.status !== 'applied') throw new Error(`runtime did not persist disconnect intent: ${disconnected.status}`)
  await waitFor('provider listener teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
} finally {
  await ctx.fiber.dispose()
  await new Promise((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error) }) })
  await rm(root, { recursive: true, force: true })
}
