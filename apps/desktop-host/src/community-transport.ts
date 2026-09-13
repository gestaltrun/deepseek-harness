/** Desktop plugin routes carried over in-memory HTTP sockets and the existing Fetch pipe. */
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { duplexPair, Readable, type Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { renderIndexInjections, type IndexInjection, type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebSocket, type RawData } from 'ws'

/** Local-only carrier reserved by the Desktop host. */
export const COMMUNITY_WEBSOCKET_PATH = '/.dsh/community-websocket'
const FRAME_LIMIT = 1024 * 1024
const QUEUE_BYTES = 64 * 1024
const LOCAL_ORIGIN = 'http://127.0.0.1'

interface SocketConnection {
  readonly socket: WebSocket
  readonly closed: Promise<void>
  nextSequence: number
  tail: Promise<void>
}

/** Application-owned index events and diagnostics supplied to the adapter. */
export interface CommunityTransportOptions {
  /** Collect current plugin index rows on each render. */
  readonly collectIndexInjections: () => IndexInjection[]
  /** Report a failed plugin handler without terminating other requests. */
  readonly onError: (error: Error) => void
}

function disposeOnce(action: () => void): () => void {
  let active = true
  return () => {
    if (!active) return
    active = false
    action()
  }
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAppUrl(url: URL): boolean {
  return url.protocol === 'dsh-app:' && url.host === 'app' && url.username === '' && url.password === ''
}

function trustedRequest(request: Request): boolean {
  if (!isAppUrl(new URL(request.url)) || request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return origin === null || origin === 'dsh-app://app'
}

function corePath(path: string): boolean {
  return path === '/' || path === '/index.html' || ['/api', '/plugins', '/assets', '/.dsh'].some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function rawBytes(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
}

async function readJson(request: Request): Promise<unknown> {
  if (request.body === null) throw new Error('Missing command body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > FRAME_LIMIT * 2) {
        await reader.cancel('Desktop WebSocket command exceeds the frame limit')
        throw new Error('Desktop WebSocket command exceeds the frame limit')
      }
      chunks.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Node-compatible webServer implementation; it never binds a TCP or Unix listener. */
export class DesktopCommunityTransport {
  /** Virtual authority used only inside this process. */
  readonly host = '127.0.0.1' as const
  /** No listening port exists. Consumers requiring a network URL must remain disabled. */
  readonly port = 0
  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly taps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined
  private readonly pairs = new Set<Duplex>()
  private readonly connections = new Map<string, SocketConnection>()
  private readonly server = createServer((request, response) => {
    void this.dispatch(request, response).catch((error: unknown) => {
      this.options.onError(errorOf(error))
      if (response.headersSent) response.destroy()
      else { response.writeHead(400); response.end() }
    })
  })
  private disposing: Promise<void> | undefined

  /** @param options - Application index events and plugin error reporting. */
  constructor(private readonly options: CommunityTransportOptions) {
    this.server.on('upgrade', (request, socket, head) => {
      const route = this.upgrades.get(new URL(request.url ?? '/', LOCAL_ORIGIN).pathname)
      if (route === undefined) { socket.destroy(); return }
      void Promise.resolve().then(() => route.handler(request, socket, head)).catch((error: unknown) => {
        this.options.onError(errorOf(error))
        socket.destroy()
      })
    })
  }

  private assertActive(): void {
    if (this.disposing !== undefined) throw new Error('Desktop community transport is disposed')
  }

  private assertPath(path: string): void {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#') || (path.length > 1 && path.endsWith('/'))) {
      throw new Error('Community route must be an absolute pathname without a trailing slash')
    }
    if (path === COMMUNITY_WEBSOCKET_PATH || path.startsWith(`${COMMUNITY_WEBSOCKET_PATH}/`)) {
      throw new Error(`Desktop reserves route ${path}`)
    }
  }

  /**
   * Register an exact or segment-prefix route; duplicates fail during composition.
   * @param route - Named route and its Node HTTP response owner.
   * @returns disposer removing this registration.
   */
  register(route: WebRoute): () => void {
    this.assertActive()
    this.assertPath(route.path)
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    table.set(route.path, route)
    return disposeOnce(() => { if (table.get(route.path) === route) table.delete(route.path) })
  }

  /**
   * Register a WebSocket upgrade owned by a real Node protocol handler.
   * @param route - Exact pathname and protocol handler.
   * @returns disposer removing this registration.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    this.assertActive()
    this.assertPath(route.path)
    if (this.upgrades.has(route.path)) throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    this.upgrades.set(route.path, route)
    return disposeOnce(() => { if (this.upgrades.get(route.path) === route) this.upgrades.delete(route.path) })
  }

  /**
   * Claim the fallback seat; Desktop assets retain priority outside named community routes.
   * @param handler - Response owner for unmatched adapter requests.
   * @returns disposer releasing the fallback seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    this.assertActive()
    if (this.fallback !== undefined) throw new Error('webserver: fallback already registered')
    this.fallback = handler
    return disposeOnce(() => { if (this.fallback === handler) this.fallback = undefined })
  }

  /**
   * Register an index transform.
   * @param transform - Pure HTML transform applied after structured injections.
   * @returns disposer removing this transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.assertActive()
    this.taps.push(transform)
    return disposeOnce(() => { const index = this.taps.indexOf(transform); if (index !== -1) this.taps.splice(index, 1) })
  }

  /**
   * Apply current raw HTML transforms in registration order.
   * @param html - Index markup with structured injections already rendered.
   * @returns transformed markup.
   */
  applyIndexTaps(html: string): string {
    return this.taps.reduce((value, transform) => transform(value), html)
  }

  /**
   * Collect the application's current structured index rows.
   * @returns rows emitted by the active plugins.
   */
  collectIndexInjections(): IndexInjection[] {
    return this.options.collectIndexInjections()
  }

  /**
   * Render structured injections followed by plugin HTML transforms.
   * @param html - Raw index markup.
   * @returns complete index markup.
   */
  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))
  }

  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let result: WebRoute | undefined
    for (const route of this.prefixes.values()) {
      if ((pathname === route.path || pathname.startsWith(`${route.path}/`)) && (result === undefined || result.path.length < route.path.length)) result = route
    }
    return result
  }

  /**
   * Determine whether a pathname belongs to a plugin or the private WebSocket carrier.
   * @param pathname - URL pathname.
   * @returns whether Desktop should dispatch this path through the adapter.
   */
  owns(pathname: string): boolean {
    return pathname === COMMUNITY_WEBSOCKET_PATH || pathname.startsWith(`${COMMUNITY_WEBSOCKET_PATH}/`) || (!corePath(pathname) && this.match(pathname) !== undefined)
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const handler = this.match(new URL(request.url ?? '/', LOCAL_ORIGIN).pathname)?.handler ?? this.fallback
    if (handler === undefined) { response.writeHead(404); response.end(); return }
    await handler(request, response)
  }

  private createConnection = (): Socket => {
    this.assertActive()
    const [client, peer] = duplexPair()
    for (const side of [client, peer]) {
      this.pairs.add(side)
      side.on('error', () => { /* The owning HTTP request or WebSocket reports transport errors. */ })
      side.once('close', () => { this.pairs.delete(side) })
    }
    client.once('close', () => { peer.destroy() })
    peer.once('close', () => { client.destroy() })
    this.server.emit('connection', peer)
    // node:http and ws only need Duplex operations; no net.Socket ever connects.
    return client as Socket
  }

  /**
   * Dispatch a trusted Desktop request while preserving streaming and cancellation.
   * @param request - Request received on the application's existing Fetch pipe.
   * @returns response whose body retains socket backpressure and cancellation.
   */
  async fetch(request: Request): Promise<Response> {
    this.assertActive()
    if (!trustedRequest(request)) return new Response('Desktop origin required', { status: 403 })
    const url = new URL(request.url)
    if (url.pathname === COMMUNITY_WEBSOCKET_PATH || url.pathname.startsWith(`${COMMUNITY_WEBSOCKET_PATH}/`)) {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      let command: unknown
      try { command = await readJson(request) } catch { return new Response('Invalid WebSocket command', { status: 400 }) }
      if (!isRecord(command)) return new Response('Invalid WebSocket command', { status: 400 })
      if (url.pathname === `${COMMUNITY_WEBSOCKET_PATH}/open`) return this.openWebSocket(request, command)
      if (url.pathname === `${COMMUNITY_WEBSOCKET_PATH}/send` || url.pathname === `${COMMUNITY_WEBSOCKET_PATH}/close`) {
        return this.controlWebSocket(url.pathname, command)
      }
      return new Response(null, { status: 404 })
    }
    if (corePath(url.pathname)) return new Response('Route belongs to the Desktop host', { status: 403 })
    return this.fetchHttp(request)
  }

  private fetchHttp(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const headers = Object.fromEntries(request.headers)
    headers.host = '127.0.0.1'
    headers.origin = LOCAL_ORIGIN
    headers['sec-fetch-site'] = 'same-origin'
    headers.connection = 'close'
    delete headers['transfer-encoding']
    return new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest({ method: request.method, path: `${url.pathname}${url.search}`, headers, createConnection: this.createConnection, signal: request.signal }, (incoming) => {
        const responseHeaders = new Headers()
        let headerName = ''
        for (const [index, value] of incoming.rawHeaders.entries()) {
          if (index % 2 === 0) headerName = value
          else responseHeaders.append(headerName, value)
        }
        responseHeaders.delete('connection')
        responseHeaders.delete('transfer-encoding')
        const status = incoming.statusCode
        if (status === undefined) {
          incoming.destroy()
          reject(new Error('Community response has no HTTP status'))
          return
        }
        const empty = request.method === 'HEAD' || status === 204 || status === 304
        if (empty) incoming.resume()
        const body = empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
        resolve(new Response(body, { status, headers: responseHeaders }))
      })
      outgoing.on('error', reject)
      if (request.body === null) outgoing.end()
      else {
        // Node and DOM typings disagree on BYOB reader buffers for this same runtime stream.
        const upload = Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0])
        upload.on('error', (error) => { outgoing.destroy(error) })
        outgoing.once('close', () => { upload.destroy() })
        upload.pipe(outgoing)
      }
    })
  }

  private openWebSocket(request: Request, command: Record<string, unknown>): Response {
    let url: URL
    try { url = new URL(typeof command.url === 'string' ? command.url : '') } catch { return new Response('Invalid WebSocket URL', { status: 400 }) }
    if (!['dsh-app:', 'ws:', 'wss:'].includes(url.protocol) || url.host !== 'app' || url.username !== '' || url.password !== '' || url.hash !== '') {
      return new Response('Only Desktop-local WebSockets are supported', { status: 403 })
    }
    if (corePath(url.pathname)) return new Response('Route belongs to the Desktop host', { status: 403 })
    if (!this.upgrades.has(url.pathname)) return new Response('Unknown upgrade route', { status: 404 })
    const protocols = command.protocols
    if (!Array.isArray(protocols) || !protocols.every((value): value is string => typeof value === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) || new Set(protocols).size !== protocols.length) {
      return new Response('Invalid WebSocket protocols', { status: 400 })
    }
    const id = randomUUID()
    const socket = new WebSocket(`ws://127.0.0.1${url.pathname}${url.search}`, protocols, {
      createConnection: this.createConnection,
      headers: { host: '127.0.0.1', origin: LOCAL_ORIGIN, 'sec-fetch-site': 'same-origin' },
      maxPayload: FRAME_LIMIT,
      perMessageDeflate: false,
    })
    const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    const connection: SocketConnection = { socket, closed, nextSequence: 0, tail: Promise.resolve() }
    this.connections.set(id, connection)
    const encoder = new TextEncoder()
    let finished = false
    let output: ReadableStreamDefaultController<Uint8Array>
    const emit = (event: object): void => {
      if (finished) return
      output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      if ((output.desiredSize ?? 0) <= 0) socket.pause()
    }
    const cancel = (): void => {
      if (finished) return
      finished = true
      socket.terminate()
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { output = controller },
      pull() { if (socket.readyState === WebSocket.OPEN) socket.resume() },
      async cancel() { cancel(); await closed },
    }, { highWaterMark: QUEUE_BYTES, size: chunk => chunk.byteLength })
    const abort = (): void => {
      if (!finished) output.error(request.signal.reason)
      cancel()
    }
    request.signal.addEventListener('abort', abort, { once: true })
    socket.on('open', () => { emit({ type: 'open', id, protocol: socket.protocol, extensions: socket.extensions }) })
    socket.on('message', (data, binary) => { emit({ type: 'message', binary, data: rawBytes(data).toString(binary ? 'base64' : 'utf8') }) })
    socket.on('error', () => { emit({ type: 'error' }) })
    socket.once('close', (code, reason) => {
      request.signal.removeEventListener('abort', abort)
      this.connections.delete(id)
      if (!finished) {
        emit({ type: 'close', code, reason: reason.toString('utf8'), wasClean: code !== 1006 })
        finished = true
        output.close()
      }
    })
    if (request.signal.aborted) abort()
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
  }

  private async controlWebSocket(pathname: string, command: Record<string, unknown>): Promise<Response> {
    if (typeof command.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(command.id)) return new Response('Invalid connection id', { status: 400 })
    const connection = this.connections.get(command.id)
    if (connection === undefined) return new Response('Unknown connection', { status: 404 })
    if (!Number.isSafeInteger(command.sequence) || command.sequence !== connection.nextSequence) return new Response('Unexpected sequence', { status: 409 })
    let action: () => Promise<void>
    if (pathname.endsWith('/send')) {
      if (typeof command.data !== 'string' || typeof command.binary !== 'boolean') return new Response('Invalid message', { status: 400 })
      if (command.binary && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(command.data)) return new Response('Invalid binary message', { status: 400 })
      const bytes = Buffer.from(command.data, command.binary ? 'base64' : 'utf8')
      if (bytes.byteLength > FRAME_LIMIT) return new Response('Message exceeds frame limit', { status: 413 })
      const binary = command.binary
      action = () => new Promise<void>((resolve, reject) => {
        connection.socket.send(bytes, { binary }, (error) => { if (error) reject(error); else resolve() })
      })
    } else {
      if (typeof command.code !== 'number' || (command.code !== 1000 && (!Number.isInteger(command.code) || command.code < 3000 || command.code > 4999)) || typeof command.reason !== 'string' || Buffer.byteLength(command.reason) > 123) return new Response('Invalid close frame', { status: 400 })
      const { code, reason } = command
      action = async () => { connection.socket.resume(); connection.socket.close(code, reason); await connection.closed }
    }
    connection.nextSequence += 1
    const task = connection.tail.then(action)
    connection.tail = task.catch(() => { connection.socket.terminate() })
    try { await task; return new Response(null, { status: 204 }) } catch { return new Response('WebSocket command failed', { status: 410 }) }
  }

  /**
   * Stop every virtual connection before releasing routes.
   * @returns completion after all owned sockets close.
   */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      const closed = [...this.connections.values()].map((connection) => {
        connection.socket.terminate()
        return Promise.all([connection.closed, connection.tail])
      })
      const pairsClosed = [...this.pairs].map(socket => new Promise<void>((resolve) => {
        socket.once('close', () => { resolve() })
        socket.destroy()
      }))
      await Promise.all([...closed, ...pairsClosed])
      this.server.removeAllListeners()
      this.exact.clear()
      this.prefixes.clear()
      this.upgrades.clear()
      this.taps.length = 0
      this.fallback = undefined
    })()
    return this.disposing
  }
}

/**
 * Provide Desktop-local carriers before community plugins activate.
 * @param ctx - Boot context owning the carriers and their disposal.
 * @returns adapter used by the Desktop Fetch dispatcher.
 */
export function installDesktopCommunityTransport(ctx: Context): DesktopCommunityTransport {
  const transport = new DesktopCommunityTransport({
    collectIndexInjections: () => {
      const rows: IndexInjection[] = []
      ctx.emit('webserver/index-inject', rows)
      return rows
    },
    onError: (error) => { ctx.logger.warn(error) },
  })
  ctx.effect(() => () => transport.dispose(), 'Desktop community transport')
  ctx.effect(() => ctx.reflect.provide('webServer', transport), 'Desktop community webServer')
  ctx.effect(() => ctx.reflect.provide('webRuntime', { lanAddresses: [], trustedHosts: [] }), 'Desktop community webRuntime')
  return transport
}
