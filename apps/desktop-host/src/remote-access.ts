/** Optional authenticated HTTP access alongside the private Desktop Fetch carrier. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import WebServer, { type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type { DesktopCommunityTransport } from './community-transport.ts'

/** Binding facts shared with the remote-access settings and pairing plugin. */
export interface DesktopRemoteAccessState {
  readonly host: '127.0.0.1' | '0.0.0.0'
  readonly port: number
  readonly listening: boolean
  readonly error?: string
}

/** User-controlled exposure; the initial port is selected by initialize(). */
export interface DesktopRemoteAccessSelection {
  readonly enabled: boolean
  readonly lanBind: boolean
}

type HttpRegistration = { readonly route: WebRoute; release: (() => void) | undefined }
type UpgradeRegistration = { readonly route: WebUpgradeRoute; release: (() => void) | undefined }
type FallbackRegistration = { readonly handler: WebRoute['handler']; release: (() => void) | undefined }

const PAIR_PATHS = new Set(['/api/pair/accept', '/api/pair/heartbeat', '/api/pair/status', '/pair-accept', '/pair-app', '/pair-app.sw.js'])

function loopback(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/gu, '').replace(/^::ffff:/u, '')
  if (value === 'localhost' || value === '::1') return true
  const parts = value.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Keep real HTTP clients outside native-only routes and the ungated API channel.
 * @param request - Original network request, including its unmodified socket address.
 * @param upgrade - Whether this request asks for a WebSocket upgrade.
 * @returns Whether the registered handler may apply its own authentication.
 */
export function desktopRemoteRequestAllowed(request: IncomingMessage, upgrade: boolean): boolean {
  const raw = request.url ?? '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return false
  let authority: URL
  try { authority = new URL(`http://${request.headers.host ?? ''}`) } catch { return false }
  if (authority.username !== '' || authority.password !== '' || authority.pathname !== '/' || authority.search !== '' || authority.hash !== '') return false
  const path = new URL(raw, authority).pathname
  if (path === '/.dsh' || path.startsWith('/.dsh/')) return false
  // Pairing pages own their token/navigation fence; mobile browsers can mark a QR navigation cross-site.
  if (!upgrade && PAIR_PATHS.has(path)) return true
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== authority.host) return false
    } catch { return false }
  }
  if (loopback(request.socket.remoteAddress ?? '') && loopback(authority.hostname)) return true
  if (path.startsWith('/remote/')) return true
  return !upgrade && (request.method === 'GET' || request.method === 'HEAD')
    && (path.startsWith('/plugins/') || path.startsWith('/assets/') || path === '/favicon.svg' || path === '/manifest.webmanifest')
}

/** Owns a real HTTP listener while retaining the existing private Desktop route owners. */
export class DesktopRemoteAccess {
  private readonly routes = new Map<string, HttpRegistration>()
  private readonly upgrades = new Map<string, UpgradeRegistration>()
  private readonly observers = new Set<(state: DesktopRemoteAccessState) => void>()
  private fallback: FallbackRegistration | undefined
  private network: { context: Context; server: WebServer } | undefined
  private state: DesktopRemoteAccessState = { host: '127.0.0.1', port: 0, listening: false }
  private pending: Promise<void> = Promise.resolve()
  private disposed = false
  private ready = false
  private initialization: Promise<DesktopRemoteAccessState> | undefined

  /** @param onError - Application-owned error reporting for observers and failed transitions. */
  constructor(private readonly onError: (error: Error) => void) {}

  /** Actual bind host; the native carrier retains its separate virtual loopback identity. */
  get host(): DesktopRemoteAccessState['host'] { return this.state.host }

  /** Actual port after initialization; retained while disabled for stable reactivation. */
  get port(): number { return this.state.port }

  /** @returns Current listener facts, including any failed bind attempt. */
  status(): DesktopRemoteAccessState { return this.state }

  /**
   * Observe bind transitions without taking ownership of the listener.
   * @param listener - Called after binding facts change.
   * @returns Disposer removing the observer.
   */
  onChange(listener: (state: DesktopRemoteAccessState) => void): () => void {
    this.observers.add(listener)
    return () => { this.observers.delete(listener) }
  }

  private publish(state: DesktopRemoteAccessState): void {
    this.state = state
    for (const listener of this.observers) {
      try { listener(state) } catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))) }
    }
  }

  /** Release network requests once the complete Host composition and authenticated frontend are ready. */
  markReady(): void { this.ready = true }

  /**
   * Allocate a local listener before the pairing plugin captures its proxy port.
   * @param port - Startup port; zero requests an OS-assigned port.
   * @returns Current listener facts after binding loopback.
   */
  async initialize(port = 0): Promise<DesktopRemoteAccessState> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Desktop remote port must be an integer from 0 to 65535')
    if (this.initialization !== undefined) return this.initialization
    this.state = { host: '127.0.0.1', port, listening: false }
    this.initialization = this.configure({ enabled: true, lanBind: false }).catch((error: unknown) => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  /**
   * Apply the user's LAN or enabled setting while preserving the allocated port.
   * @param selection - Desired listener exposure.
   * @returns Listener facts after the serialized transition completes.
   */
  configure(selection: DesktopRemoteAccessSelection): Promise<DesktopRemoteAccessState> {
    if (this.disposed) return selection.enabled ? Promise.reject(new Error('Desktop remote access is disposed')) : Promise.resolve(this.state)
    const next = this.pending.then(async () => {
      if (this.disposed) throw new Error('Desktop remote access is disposed')
      const host = selection.lanBind ? '0.0.0.0' : '127.0.0.1'
      if (this.network !== undefined && selection.enabled && this.state.host === host) return this.state
      await this.closeListener()
      if (!selection.enabled) { this.publish({ host, port: this.state.port, listening: false }); return this.state }
      const context = new Context()
      try {
        await context.plugin(WebServer, { host, port: this.state.port })
        const server = context.webServer
        this.network = { context, server }
        for (const registration of this.routes.values()) registration.release = server.register(this.networkRoute(registration.route))
        for (const registration of this.upgrades.values()) {
          registration.release = server.registerUpgrade(this.networkUpgrade(registration.route))
        }
        if (this.fallback !== undefined) this.fallback.release = server.registerFallback(this.networkFallback(this.fallback.handler))
        this.publish({ host, port: server.port, listening: true })
        return this.state
      } catch (error) {
        await context.fiber.dispose()
        this.network = undefined
        const failure = error instanceof Error ? error : new Error(String(error))
        this.publish({ host, port: this.state.port, listening: false, error: failure.message })
        throw failure
      }
    })
    this.pending = next.then(() => {}, (error: unknown) => { this.onError(error instanceof Error ? error : new Error(String(error))) })
    return next
  }

  private permit(request: IncomingMessage, response: ServerResponse): boolean {
    if (!this.ready) { request.resume(); response.writeHead(503).end(); return false }
    if (!desktopRemoteRequestAllowed(request, false)) { request.resume(); response.writeHead(403).end(); return false }
    return true
  }

  private networkRoute(route: WebRoute): WebRoute {
    return { ...route, handler: (request, response) => {
      if (this.permit(request, response)) return route.handler(request, response)
    } }
  }

  private networkUpgrade(route: WebUpgradeRoute): WebUpgradeRoute {
    return { ...route, handler: (request, socket, head) => {
      if (!this.ready || !desktopRemoteRequestAllowed(request, true)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      return route.handler(request, socket, head)
    } }
  }

  private networkFallback(handler: WebRoute['handler']): WebRoute['handler'] {
    return (request, response) => {
      if (!this.permit(request, response)) return
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/api' || path.startsWith('/api/') || path === '/remote' || path.startsWith('/remote/')) {
        request.resume(); response.writeHead(404).end(); return
      }
      return handler(request, response)
    }
  }

  /**
   * Share registrations with the real HTTP listener without changing native request provenance.
   * @param native - Existing private Desktop carrier.
   * @returns The webServer facade supplied to plugins in this Host.
   */
  webServer(native: DesktopCommunityTransport) {
    const currentState = () => this.status()
    return {
      get host() { return currentState().host },
      get port() { return currentState().port },
      register: (route: WebRoute): (() => void) => {
        const removeNative = native.register(route)
        const key = `${route.kind}:${route.path}`
        const registration: HttpRegistration = { route, release: undefined }
        try {
          registration.release = this.network?.server.register(this.networkRoute(route))
        } catch (error) { removeNative(); throw error }
        this.routes.set(key, registration)
        return () => {
          if (this.routes.get(key) !== registration) return
          this.routes.delete(key); registration.release?.(); removeNative()
        }
      },
      registerUpgrade: (route: WebUpgradeRoute): (() => void) => {
        const removeNative = native.registerUpgrade(route)
        const registration: UpgradeRegistration = { route, release: undefined }
        try {
          registration.release = this.network?.server.registerUpgrade(this.networkUpgrade(route))
        } catch (error) { removeNative(); throw error }
        this.upgrades.set(route.path, registration)
        return () => {
          if (this.upgrades.get(route.path) !== registration) return
          this.upgrades.delete(route.path); registration.release?.(); removeNative()
        }
      },
      registerFallback: (handler: WebRoute['handler']): (() => void) => {
        const removeNative = native.registerFallback(handler)
        const registration: FallbackRegistration = { handler, release: undefined }
        try {
          registration.release = this.network?.server.registerFallback(this.networkFallback(handler))
        } catch (error) { removeNative(); throw error }
        this.fallback = registration
        return () => {
          if (this.fallback !== registration) return
          this.fallback = undefined; registration.release?.(); removeNative()
        }
      },
      tapIndex: native.tapIndex.bind(native),
      applyIndexTaps: native.applyIndexTaps.bind(native),
      collectIndexInjections: native.collectIndexInjections.bind(native),
      renderIndex: native.renderIndex.bind(native),
    }
  }

  private async closeListener(): Promise<void> {
    const network = this.network
    this.network = undefined
    if (network !== undefined) await network.context.fiber.dispose()
    for (const registration of this.routes.values()) registration.release = undefined
    for (const registration of this.upgrades.values()) registration.release = undefined
    if (this.fallback !== undefined) this.fallback.release = undefined
  }

  /** Close listeners and all HTTP/WS connections after pending transitions settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.ready = false
    this.observers.clear()
    await this.pending
    await this.closeListener()
    this.state = { host: this.state.host, port: this.state.port, listening: false }
  }
}
