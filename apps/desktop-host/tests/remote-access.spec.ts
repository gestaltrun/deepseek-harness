/** Real HTTP/WS listeners remain separate from private Desktop request provenance. */
import { once } from 'node:events'
import { request } from 'node:http'
import { createServer, Socket } from 'node:net'
import { IncomingMessage } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { DesktopCommunityTransport } from '../src/community-transport.ts'
import { DesktopRemoteAccess, desktopRemoteRequestAllowed } from '../src/remote-access.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function fixture() {
  const errors: Error[] = []
  const native = new DesktopCommunityTransport({ collectIndexInjections: () => [], onError: (error) => { errors.push(error) } })
  const access = new DesktopRemoteAccess((error) => { errors.push(error) })
  cleanups.push(async () => { await access.dispose(); await native.dispose() })
  return { access, native, server: access.webServer(native), errors }
}

function http(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, headers: { connection: 'close', ...headers } }, (incoming) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      incoming.on('error', reject)
      incoming.on('end', () => { resolve({ status: incoming.statusCode!, body: Buffer.concat(chunks).toString() }) })
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

it('starts on an ephemeral loopback port and preserves native provenance across LAN rebinds', async () => {
  const { access, native, server } = fixture()
  server.register({ kind: 'exact', path: '/api/pair/provenance', handler(req, res) {
    res.end(JSON.stringify({ address: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin }))
  } })
  const [first, concurrent] = await Promise.all([access.initialize(), access.initialize()])
  expect(first).toEqual(concurrent)
  expect(first).toMatchObject({ host: '127.0.0.1', listening: true })
  expect(first.port).toBeGreaterThan(0)
  expect((await http(first.port, '/api/pair/provenance')).status).toBe(503)
  access.markReady()
  expect(JSON.parse((await http(first.port, '/api/pair/provenance')).body)).toMatchObject({ address: '127.0.0.1', host: `127.0.0.1:${first.port}` })
  const lan = await access.configure({ enabled: true, lanBind: true })
  expect(lan).toEqual({ host: '0.0.0.0', port: first.port, listening: true })
  const response = await native.fetch(new Request('dsh-app://app/api/pair/provenance', { headers: { origin: 'dsh-app://app' } }))
  expect(await response.json()).toEqual({ address: '127.0.0.1', host: '127.0.0.1', origin: 'http://127.0.0.1' })
  expect((await native.fetch(new Request('dsh-app://app/api/pair/provenance', { headers: { origin: 'https://elsewhere.example' } }))).status).toBe(403)
})

it('denies direct network APIs and private carriers while preserving registered pair and gated remote routes', async () => {
  const { access, server } = fixture()
  let coreCalls = 0
  server.register({ kind: 'prefix', path: '/api', handler(_req, res) { coreCalls++; res.end('core') } })
  server.register({ kind: 'exact', path: '/api/pair/accept', handler(_req, res) { res.end('pair owner') } })
  server.register({ kind: 'prefix', path: '/remote/api', handler(req, res) {
    res.writeHead(req.headers.cookie === 'paired=valid' ? 200 : 403).end('pairing owner')
  } })
  server.registerFallback((_req, res) => { res.end('frontend') })
  const { port } = await access.initialize()
  access.markReady()
  const remote = { host: `192.0.2.10:${port}`, origin: `http://192.0.2.10:${port}`, cookie: 'paired=valid' }
  for (const path of ['/api', '/api/directoryPicker/pick', '/api/pair/issue', '/.dsh/remote-stream', '/.dsh/community-websocket/open', '/']) {
    expect((await http(port, path, remote)).status).toBe(403)
  }
  expect(coreCalls).toBe(0)
  expect((await http(port, '/api/pair/accept', remote)).body).toBe('pair owner')
  expect((await http(port, '/remote/api/probe', { host: remote.host })).status).toBe(403)
  expect((await http(port, '/remote/api/probe', remote)).status).toBe(200)
  expect((await http(port, '/remote/api/probe', { ...remote, origin: 'https://elsewhere.example' })).status).toBe(403)
  expect((await http(port, '/api/directoryPicker/pick')).body).toBe('core')
  expect(coreCalls).toBe(1)
})

it('requires both the original loopback peer and loopback authority for direct API access', () => {
  const socket = new Socket()
  const incoming = new IncomingMessage(socket)
  incoming.url = '/api/probe'
  incoming.method = 'GET'
  incoming.headers = { host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234' }
  Object.defineProperty(socket, 'remoteAddress', { value: '192.0.2.10' })
  expect(desktopRemoteRequestAllowed(incoming, false)).toBe(false)
  incoming.headers['x-forwarded-for'] = '127.0.0.1'
  expect(desktopRemoteRequestAllowed(incoming, false)).toBe(false)
  incoming.url = '/remote/api/probe'
  expect(desktopRemoteRequestAllowed(incoming, false)).toBe(true)
  socket.destroy()
})

it('retains current route owners through serialized disable and reactivation', async () => {
  const { access, server } = fixture()
  const remove = server.register({ kind: 'exact', path: '/probe', handler(_req, res) { res.end('old') } })
  server.registerFallback((_req, res) => { res.end('fallback') })
  const { port } = await access.initialize()
  access.markReady()
  remove()
  server.register({ kind: 'exact', path: '/probe', handler(_req, res) { res.end('new') } })
  remove()
  const stopped = await access.configure({ enabled: false, lanBind: false })
  expect(stopped.listening).toBe(false)
  await expect(http(port, '/probe')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  const [lan, local] = await Promise.all([
    access.configure({ enabled: true, lanBind: true }),
    access.configure({ enabled: true, lanBind: false }),
  ])
  expect(lan.host).toBe('0.0.0.0')
  expect(local).toEqual({ host: '127.0.0.1', port, listening: true })
  expect((await http(port, '/probe')).body).toBe('new')
  expect((await http(port, '/other')).body).toBe('fallback')
  expect((await http(port, '/remote/unknown')).status).toBe(404)
})

it('reports a failed bind and permits a later explicit retry', async () => {
  const { access, errors } = fixture()
  const occupied = createServer()
  occupied.listen(0, '127.0.0.1')
  await once(occupied, 'listening')
  const address = occupied.address()
  if (address === null || typeof address === 'string') throw new Error('Missing TCP address')
  try {
    await expect(access.initialize(address.port)).rejects.toThrow()
    expect(access.status()).toMatchObject({ listening: false, port: address.port })
    expect(access.status().error).toContain('EADDRINUSE')
    expect(errors).toHaveLength(1)
  } finally {
    await new Promise<void>((resolve, reject) => {
      occupied.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
  }
  expect((await access.initialize(address.port)).listening).toBe(true)
})

it('gates real upgrades and closes established sockets before listener disposal resolves', async () => {
  const { access, server } = fixture()
  const upgrades = new WebSocketServer({ noServer: true })
  cleanups.unshift(() => new Promise<void>((resolve) => { upgrades.close(() => { resolve() }) }))
  server.registerUpgrade({ path: '/remote/api/echo', handler(req, socket, head) {
    if (req.headers.cookie !== 'paired=valid') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    upgrades.handleUpgrade(req, socket, head, (client) => {
      client.on('message', (data) => { client.send(data) })
    })
  } })
  const { port } = await access.initialize()
  access.markReady()
  const headers = { host: `192.0.2.10:${port}`, origin: `http://192.0.2.10:${port}`, cookie: 'paired=valid' }
  const client = new WebSocket(`ws://127.0.0.1:${port}/remote/api/echo`, { headers })
  client.on('error', () => { /* Connection shutdown is asserted through close. */ })
  await once(client, 'open')
  const message = once(client, 'message')
  client.send('native and network remain separate')
  expect(String((await message)[0])).toBe('native and network remain separate')
  const closed = once(client, 'close')
  await access.dispose()
  await closed
  expect(access.status().listening).toBe(false)
  await expect(http(port, '/')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
})
