/** Exercise built Host and Client IM artifacts through the real Gateway and durable runtime. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { loadSmokeModules } from './smoke-modules.mjs'

const { Cordis, ClientStore, Storage, StorageJson, StorageDomain, Credentials, TypertRegistry, Gateway, ImRuntime, ImApi, Typert, require, apiRoot } = await loadSmokeModules()
const { TYPERT } = Typert

const directory = await mkdtemp(join(tmpdir(), 'dsh-im-api-smoke-'))
const host = new Cordis.Context()
const client = new Cordis.Context()
const calls = []
const heldPause = { received: Promise.withResolvers(), release: Promise.withResolvers() }
let apiFiber

async function bootHost() {
  await host.plugin(Storage)
  await host.plugin(StorageJson, { root: join(directory, 'storage') })
  await host.plugin(StorageDomain, { backend: 'json' })
  await host.plugin(Credentials, { path: join(directory, 'credentials.yaml'), watch: false })
  await host.plugin(TypertRegistry)
  await host.plugin(ImRuntime)
  await host.plugin({
    name: 'im-api-configuration-fixture', inject: ['imTransports'],
    apply(ctx) {
      ctx.imTransports.register({
        platform: 'wangwang',
        listAccountCandidates: async () => [{ platform: 'wangwang', candidateId: 'fixture', displayName: 'Configuration fixture' }],
        prepareAccount: async request => ({
          displayName: 'Configuration fixture',
          identity: { platform: 'wangwang', merchantId: request.candidateId, displayName: 'Configuration fixture' },
          authorization: { state: 'unchecked' },
          credentialRecord: { kind: 'grant', payload: { accessKeyId: request.accessKeyId, accessKeySecret: request.accessKeySecret } },
        }),
        discoverConversations: async () => ({ items: [] }),
        listen: async () => { throw new Error('Configuration fixture cannot listen') },
        send: async () => { throw new Error('Configuration fixture cannot send') },
        confirm: async () => { throw new Error('Configuration fixture cannot confirm delivery') },
      })
    },
  })
  host.effect(() => host.typert.register(TYPERT), 'smoke: generated IM descriptors')
  await host.plugin(ImApi)
  await host.plugin(Gateway)
  host.effect(() => host.typertGateway.registerRemoteEvents(signal => {
    const done = new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }) })
    return { async *[Symbol.asyncIterator]() { await done } }
  }, { home: directory }), 'smoke: connection generation')
}

async function bootClient() {
  const factories = new Map()
  const modules = new Map([
    ['@deepseek-ai/cordis', Cordis],
    ['@deepseek-ai/dsh-client-store', ClientStore],
  ])
  let parseInClient
  const carrierStreams = new Set()
  const sandbox = {
    console, URL, URLSearchParams, AbortController, AbortSignal, DOMException,
    crypto: webcrypto, performance, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    __DSH_TRANSPORT__: {
      ownsHost: true,
      async fetch(url, init) {
        assert.equal(url.pathname.split('/')[1], 'api')
        const request = JSON.parse(init.body)
        const endpoint = request.method
        calls.push(endpoint)
        const [namespace, method] = endpoint.split('/')
        let result
        try {
          const value = await host.typertGateway.invoke({ namespace, method, args: request.payload.args, signal: init.signal })
          result = { ok: true, value }
        } catch (error) {
          result = { ok: false, error: host.typertGateway.wireStream.failure(error) }
        }
        if (request.payload.args.request?.operations?.some(operation => operation.request.operationId === 'lost-save')) {
          throw new Error('Configuration smoke lost the committed response')
        }
        if (request.payload.args.request?.operationId === 'pause-old') {
          heldPause.received.resolve()
          await heldPause.release.promise
        }
        const response = new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
        response.json = async () => parseInClient(await response.text())
        return response
      },
      async *openStream(endpoint, payload, signal) {
        calls.push(endpoint)
        const carrier = new AbortController()
        carrierStreams.add(carrier)
        const cancelCarrier = () => { for (const active of carrierStreams) active.abort() }
        // A physical reconnect closes every logical stream carried by that generation.
        if (endpoint === '$events') signal.addEventListener('abort', cancelCarrier, { once: true })
        try {
          const lifetime = AbortSignal.any([signal, carrier.signal])
          try {
            for await (const frame of await host.typertGateway.wireStream.open(endpoint, JSON.parse(JSON.stringify(payload)), lifetime)) {
              yield parseInClient(JSON.stringify(frame))
            }
          } catch (error) {
            if (!carrier.signal.aborted || signal.aborted) throw error
          }
          if (carrier.signal.aborted && !signal.aborted) {
            const { RemoteStreamCarrierError } = modules.get('@deepseek-ai/dsh-api-gateway')
            throw new RemoteStreamCarrierError('Configuration smoke carrier closed')
          }
        } finally {
          carrierStreams.delete(carrier)
          signal.removeEventListener('abort', cancelCarrier)
        }
      },
    },
    __ModuleLoader__: { load(entry) { factories.set(entry.id, entry.factory) } },
  }
  sandbox.window = sandbox
  const context = createContext(sandbox)
  // Worker and browser messages are decoded in the receiving realm.
  parseInClient = runInContext('(text) => JSON.parse(text)', context)
  const materialize = specifier => {
    const key = specifier.endsWith('/client') ? specifier.slice(0, -7) : specifier
    if (modules.has(specifier)) return modules.get(specifier)
    if (modules.has(key)) return modules.get(key)
    const factory = factories.get(key)
    assert(factory, `Unprovided Client module ${specifier}`)
    const module = factory(materialize)
    modules.set(key, module)
    return module
  }
  for (const name of ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-api-gateway']) {
    const root = dirname(require.resolve(`${name}/package.json`))
    runInContext(await readFile(join(root, 'lib/client.js'), 'utf8'), context, { filename: `${name}/client` })
  }
  runInContext(await readFile(join(apiRoot, 'lib/client.js'), 'utf8'), context, { filename: '@gestaltrun/dsh-api-im/client' })
  await client.plugin(TypertRegistry)
  await client.plugin(materialize('@deepseek-ai/dsh-client-connection'))
  await client.plugin(materialize('@deepseek-ai/dsh-api-gateway'))
  apiFiber = client.plugin(materialize('@gestaltrun/dsh-api-im'))
  await apiFiber
}

function waitFor(source, predicate, label = 'IM Client state') {
  if (predicate(source.getSnapshot())) return Promise.resolve(source.getSnapshot())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`${label} did not converge`)) }, 15000)
    const stop = source.subscribe(() => {
      const value = source.getSnapshot()
      if (!predicate(value)) return
      clearTimeout(timer)
      stop()
      resolve(value)
    })
  })
}

try {
  await bootHost()
  await bootClient()
  await waitFor(client.im.configuration, state => state.phase === 'ready')
  const unavailable = await client.im.listAccountCandidates('dingtalk')
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.error.code, 'im/configuration')
  assert.equal(unavailable.error.details.code, 'IM_TRANSPORT_UNAVAILABLE')
  const candidates = await client.im.listAccountCandidates('wangwang')
  assert(candidates.ok)
  assert.equal(candidates.value[0].candidateId, 'fixture')
  const setup = await client.im.connectAccount({ platform: 'wangwang', candidateId: 'fixture', accessKeyId: 'fixture-key', accessKeySecret: 'fixture-secret' })
  assert(setup.ok)
  assert.equal(setup.value.authorization.state, 'unchecked')
  const accountId = setup.value.id
  const operations = ['first', 'second'].map(id => ({
    kind: 'create', request: { operationId: id, accountId, workspaceId: 'workspace-a', conversationKind: 'direct', target: { kind: 'specific', conversationId: id }, enabled: false },
  }))
  const created = await client.im.applyRoutes({ operations })
  assert(created.ok)
  assert.deepEqual(Array.from(created.value.items, item => item.result.status), ['applied', 'applied'])
  const reused = await client.im.applyRoutes({ operations: [{
    kind: 'create', request: { ...operations[0].request, workspaceId: 'workspace-c' },
  }] })
  assert(reused.ok)
  assert.equal(reused.value.items[0].state, 'rejected')
  assert.equal(reused.value.items[0].code, 'IM_OPERATION_REUSED')
  const ready = await waitFor(client.im.configuration, state => state.value?.routes.length === 2)
  assert(!JSON.stringify(ready).includes('fixture-secret'))
  const route = ready.value.routes[0]
  const rebind = await client.im.applyRoutes({ operations: [{ kind: 'rebind', request: {
    operationId: 'rebind', accountId, routeId: route.id, observedRevision: route.revision,
    observedWorkspaceId: 'workspace-a', workspaceId: 'workspace-b',
  } }] })
  assert(rebind.ok)
  assert.equal(rebind.value.items[0].result.status, 'applied')
  const conflict = await client.im.applyRoutes({ operations: [{ kind: 'rebind', request: {
    operationId: 'stale', accountId, routeId: route.id, observedRevision: route.revision,
    observedWorkspaceId: 'workspace-a', workspaceId: 'workspace-c',
  } }] })
  assert(conflict.ok)
  assert.equal(conflict.value.items[0].result.status, 'conflict')
  const receipt = await client.im.queryRouteOperation({ accountId, operationId: 'rebind' })
  assert(receipt.ok)
  assert.equal(receipt.value.result.route.workspaceId, 'workspace-b')
  const ownership = await host.typertGateway.invoke({ namespace: 'im', method: 'saveRoute', args: { request: {
    operationId: 'ordinary-save', accountId, routeId: route.id, observedRevision: receipt.value.result.route.revision,
    enabled: false, workspaceId: 'workspace-c',
  } } })
  assert.equal(ownership.route.workspaceId, 'workspace-b')
  const lost = await client.im.applyRoutes({ operations: [{ kind: 'save', request: {
    operationId: 'lost-save', accountId, routeId: route.id, observedRevision: ownership.route.revision, enabled: false,
  } }] })
  assert.equal(lost.ok, false)
  const reconciled = await client.im.queryRouteOperation({ accountId, operationId: 'lost-save' })
  assert(reconciled.ok)
  assert.equal(reconciled.value.state, 'known')
  assert.equal(reconciled.value.result.status, 'unchanged')
  await assert.rejects(host.typertGateway.invoke({ namespace: 'im', method: 'saveRoute', args: { request: {
    operationId: 'invalid-input', accountId, routeId: route.id, observedRevision: ownership.route.revision,
    enabled: 'invalid',
  } } }), error => error.code === 'gateway/input-invalid' && error.field === 'request')
  const accountBeforePause = client.im.configuration.getSnapshot().value.accounts[0]
  const oldPause = client.im.setAccountPaused({ operationId: 'pause-old', accountId, observedRevision: accountBeforePause.revision, paused: true })
  await heldPause.received.promise
  const paused = await waitFor(client.im.configuration, state => state.value?.accounts[0]?.paused === true, 'Paused account stream')
  const resumed = await client.im.setAccountPaused({ operationId: 'pause-new', accountId, observedRevision: paused.value.accounts[0].revision, paused: false })
  assert(resumed.ok)
  await waitFor(client.im.configuration, state => state.value?.accounts[0]?.paused === false, 'Resumed account stream')
  heldPause.release.resolve()
  assert((await oldPause).ok)
  assert.equal(client.im.configuration.getSnapshot().value.accounts[0].paused, false)

  const beforeReconnect = client.im.configuration.getSnapshot().value
  const generation = client.connection.generation.getSnapshot().id
  client.connection.reconnect()
  await waitFor(client.connection.generation, state => state !== undefined && state.id > generation, 'Connection generation replacement')
  await waitFor(client.im.configuration, state => state.phase === 'ready' && state.value !== beforeReconnect, 'Configuration reconnect baseline')
  assert.equal(client.im.configuration.getSnapshot().value.routes.length, 2)
  const retained = client.im.configuration
  await apiFiber.dispose()
  assert.equal(client.get('im'), undefined)
  assert.equal(client.get('remote.im'), undefined)
  assert.equal(retained.getSnapshot().value.routes.length, 2)
  assert.equal(TYPERT.invocations.length, 14)
  await client.fiber.dispose()
  await host.fiber.dispose()
  const recovered = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./read-configuration.mjs', import.meta.url)), directory], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
  }))
  assert.deepEqual(recovered, { accounts: 1, routes: 2, rebound: 'workspace-b' })
  console.log(JSON.stringify({ methods: 14, builtHost: true, builtClient: true, realGateway: true, durableRuntime: 'json', freshProcessRecovery: recovered, provider: 'configuration fixture, no delivery', targetsRetained: 2, staleRebind: 'conflict', ordinarySaveRetainsOwner: true, invalidInputRejected: true, lostResponseReconciled: true, lateUnaryIsolated: true, reconnectBaseline: true, secretInClientState: false, disposed: true, calls: [...new Set(calls)] }))
} finally {
  heldPause.release.resolve()
  await client.fiber.dispose()
  await host.fiber.dispose()
  await rm(directory, { recursive: true, force: true })
}
