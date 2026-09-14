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
  response.end(JSON.stringify({
    code: 0,
    data: {
      events: [
        { eventId: 'event-1', merchantId: 'fixture-merchant', senderType: 1, messageId: 'message-1', customerId: 'buyer-1', conversationId: 'conversation-1', msgType: 1, textContent: 'first', msgTime: 1726000000000 },
        { eventId: 'event-2', merchantId: 'fixture-merchant', senderType: 1, messageId: 'message-2', customerId: 'buyer-future', conversationId: 'conversation-future', msgType: 1, textContent: 'future', msgTime: 1726000001000 },
      ],
      nextSinceId: 2,
      hasMore: false,
    },
  }))
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
  await waitFor('complete merchant page receipt', () => runtime.getProviderCursor(owner).cursor === '2')
  const firstScope = { kind: 'real', platform: 'wangwang', accountId: account.id, conversationKind: 'direct', conversationId: 'conversation-1' }
  const futureScope = { kind: 'real', platform: 'wangwang', accountId: account.id, conversationKind: 'direct', conversationId: 'conversation-future' }
  const first = runtime.queryHistory({ scope: firstScope, limit: 10 })
  const future = runtime.queryHistory({ scope: futureScope, limit: 10 })
  if (first.items.length !== 1 || future.items.length !== 1 || future.items[0]?.sender.kind !== 'external' || future.items[0].sender.senderId !== 'buyer-future') {
    throw new Error('all-conversation route did not durably admit every conversation in the merchant page')
  }
  const current = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (current === undefined) throw new Error('runtime lost the fixture Wangwang account')
  const disconnected = await runtime.disconnectAccount({
    operationId: 'fixture-disconnect', accountId: account.id, observedRevision: current.revision,
  })
  if (disconnected.status !== 'applied') throw new Error(`runtime did not persist disconnect intent: ${disconnected.status}`)
  await waitFor('provider listener teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
  const reconnected = await runtime.reconnectAccount({
    operationId: 'fixture-reconnect', accountId: account.id, observedRevision: disconnected.account.revision,
  })
  if (reconnected.status !== 'applied') throw new Error(`runtime did not persist reconnect intent: ${reconnected.status}`)
  await waitFor('reconnected provider readiness', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'running')
  if (runtime.queryHistory({ scope: firstScope, limit: 10 }).items.length !== 1 || runtime.queryHistory({ scope: futureScope, limit: 10 }).items.length !== 1) {
    throw new Error('merchant replay after reconnect duplicated durable messages')
  }
  const connected = runtime.snapshot().accounts.find(value => value.id === account.id)
  if (connected === undefined) throw new Error('runtime lost the reconnected Wangwang account')
  const stopped = await runtime.disconnectAccount({ operationId: 'fixture-stop', accountId: account.id, observedRevision: connected.revision })
  if (stopped.status !== 'applied') throw new Error(`runtime did not stop the reconnected Wangwang account: ${stopped.status}`)
  await waitFor('reconnected provider teardown', () => runtime.snapshot().accounts.find(value => value.id === account.id)?.listener.state === 'stopped')
} finally {
  await ctx.fiber.dispose()
  await new Promise((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error) }) })
  await rm(root, { recursive: true, force: true })
}
