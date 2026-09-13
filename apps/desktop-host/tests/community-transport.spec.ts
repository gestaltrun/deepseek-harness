/** Real Node HTTP and ws handlers over Desktop's port-free Fetch carrier. */
import { once } from 'node:events'
import { Server } from 'node:net'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebSocket as NodeWebSocket, WebSocketServer, type WebSocket as ServerWebSocket } from 'ws'
import { COMMUNITY_WEBSOCKET_PATH, DesktopCommunityTransport, installDesktopCommunityTransport } from '../src/community-transport.ts'
import { DESKTOP_COMMUNITY_WEBSOCKET_SCRIPT } from '../src/community-websocket-client.ts'

const contexts: Context[] = []
const transports: DesktopCommunityTransport[] = []
const webSockets: WebSocketServer[] = []
const reports: Error[] = []

function transport(): DesktopCommunityTransport {
  const value = new DesktopCommunityTransport({ collectIndexInjections: () => [{ kind: 'global', name: '__community__', value: true }], onError: (error) => { reports.push(error) } })
  transports.push(value)
  return value
}

function command(path: string, value: object, signal?: AbortSignal): Request {
  return new Request(`dsh-app://app${COMMUNITY_WEBSOCKET_PATH}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), ...(signal === undefined ? {} : { signal }),
  })
}

function lines(response: Response): { read: () => Promise<Record<string, unknown>>; cancel: () => Promise<void> } {
  const reader = response.body!.getReader()
  let pending = ''
  const decoder = new TextDecoder()
  return {
    async read() {
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline !== -1) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          return JSON.parse(line) as Record<string, unknown>
        }
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Event stream ended before its expected frame')
        pending += decoder.decode(chunk.value, { stream: true })
      }
    },
    cancel: () => reader.cancel(),
  }
}

function echo(value: DesktopCommunityTransport, path = '/sidebar/ws/terminal') {
  const server = new WebSocketServer({ noServer: true })
  webSockets.push(server)
  const accepted = Promise.withResolvers<ServerWebSocket>()
  value.registerUpgrade({ path, handler(request, socket, head) {
    expect(request.headers.host).toBe('127.0.0.1')
    expect(request.headers.origin).toBe('http://127.0.0.1')
    server.handleUpgrade(request, socket, head, (ws) => {
      ws.on('message', (data, isBinary) => { ws.send(data, { binary: isBinary }) })
      accepted.resolve(ws)
    })
  } })
  return accepted.promise
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(transports.splice(0).map(value => value.dispose()))
  await Promise.all(webSockets.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  reports.length = 0
  vi.restoreAllMocks()
})

describe('Desktop community transport', () => {
  it('provides the real Cordis services before dependent plugins activate and disposes their routes', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const value = installDesktopCommunityTransport(ctx)
    await ctx.plugin({
      inject: ['webServer', 'webRuntime'],
      apply(scope: Context) {
        scope.effect(() => scope.webServer.register({ kind: 'exact', path: '/sidebar/probe', handler: (_req, res) => {
          res.end(JSON.stringify({ host: scope.webServer.host, port: scope.webServer.port }))
        } }))
        scope.on('webserver/index-inject', (rows) => { rows.push({ kind: 'global', name: '__plugin__', value: true }) })
      },
    })
    expect(await (await value.fetch(new Request('dsh-app://app/sidebar/probe'))).json()).toEqual({ host: '127.0.0.1', port: 0 })
    expect(value.renderIndex('<head></head><body></body>')).toContain('__plugin__')
    expect(ctx.get('webRuntime')).toEqual({ lanAddresses: [], trustedHosts: [] })
    await ctx.fiber.dispose()
    await expect(value.fetch(new Request('dsh-app://app/sidebar/probe'))).rejects.toThrow('disposed')
  })

  it('uses exact and longest segment-prefix routing, disposable owners, and current index taps', async () => {
    const value = transport()
    const broad = value.register({ kind: 'prefix', path: '/sidebar', handler: (_req, res) => { res.end('broad') } })
    value.register({ kind: 'prefix', path: '/sidebar/files', handler: (_req, res) => { res.end('files') } })
    const exact = value.register({ kind: 'exact', path: '/sidebar/files/a', handler: (_req, res) => { res.end('exact') } })
    expect(() => value.register({ kind: 'prefix', path: '/sidebar', handler: () => {} })).toThrow('duplicate prefix')
    expect(await (await value.fetch(new Request('dsh-app://app/sidebar/files/a'))).text()).toBe('exact')
    exact()
    expect(await (await value.fetch(new Request('dsh-app://app/sidebar/files/a'))).text()).toBe('files')
    expect(await (await value.fetch(new Request('dsh-app://app/sidebar/other'))).text()).toBe('broad')
    expect(value.owns('/sidebars')).toBe(false)
    broad()
    expect((await value.fetch(new Request('dsh-app://app/sidebar'))).status).toBe(404)
    const fallback = value.registerFallback((_req, res) => { res.end('fallback') })
    expect(() => value.registerFallback(() => {})).toThrow('fallback already registered')
    expect(await (await value.fetch(new Request('dsh-app://app/missing'))).text()).toBe('fallback')
    fallback()
    const untap = value.tapIndex(html => html.replace('<body>', '<body class="community-skin">'))
    expect(value.renderIndex('<head></head><body></body>')).toContain('globalThis["__community__"] = true')
    expect(value.renderIndex('<head></head><body></body>')).toContain('class="community-skin"')
    untap()
    expect(value.renderIndex('<head></head><body></body>')).not.toContain('community-skin')
  })

  it('keeps re-registered route ownership when an old disposer is called again', async () => {
    const value = transport()
    const route = { kind: 'exact' as const, path: '/sidebar/reused', handler: (_request: unknown, response: { end(value: string): void }) => {
      response.end('replacement')
    } }
    const oldDispose = value.register(route)
    oldDispose()
    value.register(route)
    oldDispose()
    expect(await (await value.fetch(new Request('dsh-app://app/sidebar/reused'))).text()).toBe('replacement')
  })

  it('streams HTTP upload and response bytes without waiting for the response to finish', async () => {
    const value = transport()
    const finish = Promise.withResolvers<undefined>()
    value.register({ kind: 'exact', path: '/sidebar/upload', async handler(request, response) {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      expect(request.headers.origin).toBe('http://127.0.0.1')
      response.writeHead(201, { 'content-type': 'text/plain' })
      response.write(Buffer.concat(chunks))
      await finish.promise
      response.end('tail')
    } })
    const request = new Request('dsh-app://app/sidebar/upload', { method: 'POST', body: 'head' })
    const response = await value.fetch(request)
    expect(response.status).toBe(201)
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('head')
    finish.resolve(undefined)
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('tail')
    expect((await reader.read()).done).toBe(true)
  })

  it('propagates response cancellation to the plugin HTTP socket', async () => {
    const value = transport()
    const closed = Promise.withResolvers<undefined>()
    value.register({ kind: 'exact', path: '/sidebar/events', handler(request, response) {
      request.socket.once('close', () => { closed.resolve(undefined) })
      response.write('ready')
    } })
    const response = await value.fetch(new Request('dsh-app://app/sidebar/events'))
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await closed.promise
  })

  it('runs real WebSocket upgrades, ordered terminal input and binary frames without listening', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen').mockImplementation(() => { throw new Error('Network listening is forbidden') })
    const value = transport()
    const accepted = echo(value)
    const stream = lines(await value.fetch(command('open', { url: 'ws://app/sidebar/ws/terminal?session=s1', protocols: ['terminal.v1'] })))
    const opened = await stream.read()
    expect(opened).toMatchObject({ type: 'open', protocol: 'terminal.v1' })
    const serverSocket = await accepted
    expect((await value.fetch(command('send', { id: opened.id, sequence: 1, binary: false, data: 'out of order' }))).status).toBe(409)
    for (const [sequence, text] of ['pwd\r', '{"type":"resize","cols":80,"rows":24}'].entries()) {
      expect((await value.fetch(command('send', { id: opened.id, sequence, binary: false, data: text }))).status).toBe(204)
      expect(await stream.read()).toEqual({ type: 'message', binary: false, data: text })
    }
    expect((await value.fetch(command('send', { id: opened.id, sequence: 2, binary: true, data: 'AAEC/w==' }))).status).toBe(204)
    expect(await stream.read()).toEqual({ type: 'message', binary: true, data: 'AAEC/w==' })
    const closed = once(serverSocket, 'close')
    expect((await value.fetch(command('close', { id: opened.id, sequence: 3, code: 1000, reason: 'done' }))).status).toBe(204)
    expect(await stream.read()).toMatchObject({ type: 'close', code: 1000, reason: 'done', wasClean: true })
    await closed
    expect((await value.fetch(command('send', { id: opened.id, sequence: 4, binary: false, data: 'late' }))).status).toBe(404)
    expect(listen).not.toHaveBeenCalled()
  })

  it('pauses the real WebSocket while its Fetch consumer is backpressured and resumes after consumption', async () => {
    const value = transport()
    const accepted = echo(value)
    const stream = lines(await value.fetch(command('open', { url: 'ws://app/sidebar/ws/terminal', protocols: [] })))
    await stream.read()
    const server = await accepted
    const paused = Promise.withResolvers<NodeWebSocket>()
    // The original method is deliberately rebound to the socket received by the spy.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPause = NodeWebSocket.prototype.pause
    vi.spyOn(NodeWebSocket.prototype, 'pause').mockImplementation(function (this: NodeWebSocket) {
      originalPause.call(this)
      if (this !== server) paused.resolve(this)
    })
    const payload = 'x'.repeat(128 * 1024)
    server.send(payload)
    const client = await paused.promise
    expect(client.isPaused).toBe(true)
    expect(await stream.read()).toEqual({ type: 'message', binary: false, data: payload })
    expect(client.isPaused).toBe(false)
    const closed = once(server, 'close')
    await stream.cancel()
    await closed
  })

  it('keeps connection ids inside one host and rejects malformed or oversized frames before sequencing them', async () => {
    const value = transport()
    const other = transport()
    void echo(value)
    const stream = lines(await value.fetch(command('open', { url: 'ws://app/sidebar/ws/terminal', protocols: [] })))
    const { id } = await stream.read()
    expect((await other.fetch(command('send', { id, sequence: 0, binary: false, data: 'wrong host' }))).status).toBe(404)
    expect((await value.fetch(command('send', { id, sequence: 0, binary: true, data: 'not base64!' }))).status).toBe(400)
    expect((await value.fetch(command('send', { id, sequence: 0, binary: false, data: 'x'.repeat(1024 * 1024 + 1) }))).status).toBe(413)
    expect((await value.fetch(command('close', { id, sequence: 0, code: 1006, reason: '' }))).status).toBe(400)
    expect((await value.fetch(command('send', { id, sequence: 0, binary: false, data: 'valid' }))).status).toBe(204)
    expect(await stream.read()).toMatchObject({ type: 'message', data: 'valid' })
    await stream.cancel()
  })

  it('aborts HTTP requests before headers and contains rejected plugin handlers', async () => {
    const value = transport()
    const started = Promise.withResolvers<undefined>()
    const closed = Promise.withResolvers<undefined>()
    value.register({ kind: 'exact', path: '/sidebar/wait', handler(request) {
      request.socket.once('close', () => { closed.resolve(undefined) })
      started.resolve(undefined)
    } })
    const abort = new AbortController()
    const pending = value.fetch(new Request('dsh-app://app/sidebar/wait', { signal: abort.signal }))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    abort.abort()
    await rejected
    await closed.promise
    value.register({ kind: 'exact', path: '/sidebar/error', handler: () => { throw new Error('plugin failed') } })
    expect((await value.fetch(new Request('dsh-app://app/sidebar/error'))).status).toBe(400)
    expect(reports.map(error => error.message)).toEqual(['plugin failed'])
  })

  it('rejects cross-origin requests, external targets, unknown routes, invalid messages and duplicate upgrades', async () => {
    const value = transport()
    const remove = value.registerUpgrade({ path: '/ssh/terminal', handler: (_request, socket) => { socket.destroy() } })
    expect(() => value.registerUpgrade({ path: '/ssh/terminal', handler: () => {} })).toThrow('duplicate upgrade')
    expect(() => value.register({ kind: 'prefix', path: COMMUNITY_WEBSOCKET_PATH, handler: () => {} })).toThrow('reserves route')
    value.register({ kind: 'prefix', path: '/api', handler: () => {} })
    value.register({ kind: 'prefix', path: '/plugins', handler: () => {} })
    expect(value.owns('/api/rpc')).toBe(false)
    expect(value.owns('/plugins/example.js')).toBe(false)
    expect((await value.fetch(new Request('dsh-app://app/api/rpc'))).status).toBe(403)
    expect((await value.fetch(new Request('https://example.com/sidebar'))).status).toBe(403)
    expect((await value.fetch(new Request('dsh-app://app/sidebar', { headers: { origin: 'null' } }))).status).toBe(403)
    for (const url of ['ws://example.com/ssh/terminal', 'ws://127.0.0.1/ssh/terminal', 'ws://app:9000/ssh/terminal', 'ws://user@app/ssh/terminal', 'ws://app/ssh/terminal#fragment']) {
      expect((await value.fetch(command('open', { url, protocols: [] }))).status).toBe(403)
    }
    expect((await value.fetch(command('open', { url: 'ws://app/missing', protocols: [] }))).status).toBe(404)
    expect((await value.fetch(command('open', { url: 'ws://app/ssh/terminal', protocols: ['bad protocol'] }))).status).toBe(400)
    expect((await value.fetch(command('send', { id: '../other', sequence: 0 }))).status).toBe(400)
    remove()
    expect((await value.fetch(command('open', { url: 'ws://app/ssh/terminal', protocols: [] }))).status).toBe(404)
  })

  it('cancels live WebSockets and awaits quiescent adapter disposal', async () => {
    const value = transport()
    const accepted = echo(value)
    const abort = new AbortController()
    const stream = lines(await value.fetch(command('open', { url: 'dsh-app://app/sidebar/ws/terminal', protocols: [] }, abort.signal)))
    const opened = await stream.read()
    const socket = await accepted
    const closed = once(socket, 'close')
    const pending = stream.read()
    abort.abort(new Error('page closed'))
    await expect(pending).rejects.toThrow('page closed')
    await closed
    await value.dispose()
    await expect(value.fetch(command('send', { id: opened.id, sequence: 0, binary: false, data: 'late' }))).rejects.toThrow('disposed')
    expect(() => value.register({ kind: 'exact', path: '/later', handler: () => {} })).toThrow('disposed')
  })

  it('injects a browser adapter that preserves send order, local binary delivery and external native sockets', async () => {
    const value = transport()
    void echo(value)
    class NativeSocket extends EventTarget { constructor(readonly url: string) { super() } }
    class TestCloseEvent extends Event {
      readonly code: number
      readonly reason: string
      readonly wasClean: boolean
      constructor(type: string, init: CloseEventInit) {
        super(type)
        this.code = init.code!
        this.reason = init.reason!
        this.wasClean = init.wasClean!
      }
    }
    const scope = {
      location: { protocol: 'dsh-app:', host: 'app', href: 'dsh-app://app/' },
      WebSocket: NativeSocket as unknown as typeof WebSocket,
      URL, EventTarget, Event, MessageEvent, CloseEvent: TestCloseEvent, AbortController, DOMException,
      TextEncoder, TextDecoder, Blob, Uint8Array, ArrayBuffer, atob, btoa,
      fetch: (url: string, init: RequestInit) => value.fetch(new Request(new URL(url, 'dsh-app://app/'), init)),
    }
    runInNewContext(DESKTOP_COMMUNITY_WEBSOCKET_SCRIPT, scope)
    expect(new scope.WebSocket('wss://external.example/channel')).toBeInstanceOf(NativeSocket)
    expect(() => new scope.WebSocket('ws://user@app/sidebar/ws/terminal')).toThrow('Invalid Desktop WebSocket URL')
    const socket = new scope.WebSocket('dsh-app://app/sidebar/ws/terminal')
    socket.binaryType = 'arraybuffer'
    const closed = new Promise<CloseEvent>((resolve) => { socket.onclose = resolve })
    await new Promise<void>((resolve, reject) => { socket.onopen = () => { resolve() }; socket.onerror = reject })
    const output: unknown[] = []
    const complete = Promise.withResolvers<undefined>()
    socket.onmessage = (event) => { output.push(event.data); if (output.length === 3) complete.resolve(undefined) }
    expect(() =>{  socket.close(1006) }).toThrow('Invalid WebSocket close code')
    socket.send(new Blob([new Uint8Array([0, 1, 2, 255])]))
    const mutable = new Uint8Array([7, 8])
    socket.send(mutable)
    mutable.fill(0)
    socket.send('after binary')
    expect(socket.bufferedAmount).toBeGreaterThan(0)
    await complete.promise
    expect(Buffer.from(output[0] as ArrayBuffer)).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(Buffer.from(output[1] as ArrayBuffer)).toEqual(Buffer.from([7, 8]))
    expect(output[2]).toBe('after binary')
    socket.close(1000, 'finished')
    expect(await closed).toMatchObject({ code: 1000, reason: 'finished', wasClean: true })
    expect(socket.readyState).toBe(scope.WebSocket.CLOSED)
  })
})
