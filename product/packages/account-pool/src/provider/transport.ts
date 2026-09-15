/** Generation-private loopback HTTP transport; no ambient proxy or fetch changes. */
import { Agent, fetch as httpFetch } from 'undici'
import { AccountPoolError } from '../account-pool.ts'
import type { Config } from './config.ts'

/** Methods admitted by the embedded management gateway. */
export type CoreMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const MANAGEMENT_PATHS: Readonly<Record<string, readonly CoreMethod[]>> = {
  '/v0/management/auth-files': ['GET', 'POST', 'DELETE'],
  '/v0/management/auth-files/status': ['PATCH'],
  '/v0/management/auth-files/models': ['GET'],
  '/v0/management/auth-files/download': ['GET'],
  '/v0/management/auth-files/fields': ['PATCH'],
  '/v0/management/auth-files/quota': ['POST'],
  '/v0/management/oauth-callback': ['POST'],
  '/v0/management/anthropic-auth-url': ['GET'],
  '/v0/management/codex-auth-url': ['GET'],
  '/v0/management/antigravity-auth-url': ['GET'],
  '/v0/management/kimi-auth-url': ['GET'],
  '/v0/management/xai-auth-url': ['GET'],
  '/v0/management/get-auth-status': ['GET'],
  '/v0/management/oauth-session': ['DELETE'],
  '/v0/management/api-call': ['POST'],
}

/** A bounded response emitted by the trusted local engine. */
export interface CoreResponse { readonly status: number; readonly body: string }

/** Per-generation authority shared only by Host management and inference consumers. */
export class GenerationTransport {
  private readonly dispatcher: Agent
  private readonly streams = new Set<Promise<void>>()
  readonly fetch: typeof globalThis.fetch

  /**
   * @param origin - this generation's exact HTTP loopback origin.
   * @param managementKey - private management bearer.
   * @param inferenceKey - private inference bearer.
   * @param signal - generation revocation signal.
   * @param config - complete response and timeout bounds.
   */
  constructor(
    readonly origin: string,
    private readonly managementKey: string,
    readonly inferenceKey: string,
    readonly signal: AbortSignal,
    private readonly config: Pick<Config, 'requestTimeoutMs' | 'maxResponseBytes'>,
  ) {
    const url = new URL(origin)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin) {
      throw new AccountPoolError('failed', 'The account engine must use an exact local HTTP origin.')
    }
    this.dispatcher = new Agent()
    this.fetch = async (input, init) => {
      this.signal.throwIfAborted()
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.origin !== this.origin || url.pathname !== '/v1/chat/completions' || request.method !== 'POST'
        || url.username !== '' || url.password !== '' || url.search !== '') {
        throw new AccountPoolError('invalid-input', 'The inference request is outside the owned engine endpoint.')
      }
      const signal = AbortSignal.any([request.signal, this.signal])
      const response = await httpFetch(url, {
        method: 'POST', body: await request.text(), headers: Object.fromEntries(request.headers),
        signal, redirect: 'error', dispatcher: this.dispatcher,
      })
      return boundedResponse(response as unknown as Response, this.config.maxResponseBytes, signal)
    }
  }

  /**
   * Execute one allowlisted management operation with this generation's management credential.
   * @param method - allowed operation verb.
   * @param path - allowlisted management path and query.
   * @param body - serialized JSON input, when required.
   * @param caller - operation cancellation.
   * @returns bounded response text; transport and parse errors remain failures.
   */
  management(method: CoreMethod, path: string, body?: string, caller?: AbortSignal): Promise<CoreResponse> {
    const url = new URL(path, this.origin)
    const definitions = method === 'GET' && /^\/v0\/management\/model-definitions\/(claude|codex|antigravity|kimi|xai)$/u.test(url.pathname)
    if (url.origin !== this.origin || !(definitions || MANAGEMENT_PATHS[url.pathname]?.includes(method))) {
      return Promise.reject(new AccountPoolError('invalid-input', 'The management request is outside the account operations.'))
    }
    return this.request(method, url, this.managementKey, body, caller)
  }

  /**
   * Read the authenticated model catalog, retaining CLIProxyAPI's extended listing metadata.
   * @param caller - request cancellation.
   * @returns the decoded listing; an empty valid list remains distinct from a failed response.
   */
  async catalog(caller?: AbortSignal): Promise<unknown> {
    const response = await this.request('GET', new URL('/v1/models', this.origin), this.inferenceKey, undefined, caller,
      { 'user-agent': 'Gestaltrun-Account-Pool grok-shell/0.2.119' })
    return decodeCoreJson(response)
  }

  /**
   * Read the provider-labelled available directory without the extended Grok projection.
   * @param caller - request cancellation.
   * @returns the core's provider-labelled catalog, not proof that one GLM account authenticated.
   */
  async providerCatalog(caller?: AbortSignal): Promise<unknown> {
    return decodeCoreJson(await this.request('GET', new URL('/v1/models', this.origin), this.inferenceKey, undefined, caller))
  }

  private async request(
    method: CoreMethod, url: URL, key: string, body?: string, caller?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<CoreResponse> {
    this.signal.throwIfAborted()
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(this.config.requestTimeoutMs), ...caller ? [caller] : []])
    const response = await httpFetch(url, {
      method, ...body === undefined ? {} : { body },
      headers: { ...extraHeaders, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal, redirect: 'error', dispatcher: this.dispatcher,
    })
    const bounded = boundedResponse(response as unknown as Response, this.config.maxResponseBytes, signal)
    return { status: response.status, body: await bounded.text() }
  }

  /**
   * Retain a live inference iterator until completion or generation cancellation closes it.
   * @param values - official adapter stream bound to this generation.
   * @returns a cancellable iterator whose settlement is owned by the generation.
   */
  ownStream<T>(values: AsyncIterable<T>): AsyncIterable<T> {
    const owner = this
    return { [Symbol.asyncIterator]() {
      owner.signal.throwIfAborted()
      const iterator = values[Symbol.asyncIterator]()
      let settle!: () => void
      let closed = false
      let closing: Promise<IteratorResult<T>> | undefined
      const done = new Promise<void>(resolve => { settle = resolve })
      owner.streams.add(done)
      const finish = (): void => {
        if (closed) return
        closed = true
        owner.signal.removeEventListener('abort', aborted)
        owner.streams.delete(done)
        settle()
      }
      const close = (): Promise<IteratorResult<T>> => {
        if (closing !== undefined) return closing
        closing = (async () => {
          try { await iterator.return?.() } finally { finish() }
          return { done: true, value: undefined }
        })()
        return closing
      }
      const aborted = (): void => {
        // The generation signal already cancels SDK I/O; iterator return can report that same abort.
        void close().catch(() => undefined)
      }
      owner.signal.addEventListener('abort', aborted, { once: true })
      return {
        async next(): Promise<IteratorResult<T>> {
          if (closed) return { done: true, value: undefined }
          try {
            const value = await iterator.next()
            if (value.done) finish()
            return value
          } catch (error) { finish(); throw error }
        },
        return: close,
      }
    } }
  }

  /** Wait for admitted inference iterators after revoking this generation. */
  async quiesce(): Promise<void> { await Promise.all([...this.streams]) }

  /** Destroy outstanding sockets after generation revocation; awaits dispatcher completion. */
  async close(): Promise<void> { await this.dispatcher.destroy() }
}

/**
 * Decode a successful core reply without echoing credential-bearing error bodies.
 * @param response - bounded core response.
 * @returns decoded JSON, or undefined for a successful empty response.
 */
export function decodeCoreJson(response: CoreResponse): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw new AccountPoolError('failed', `The account engine refused the operation (HTTP ${response.status}).`)
  }
  if (response.body.length === 0) return undefined
  try { return JSON.parse(response.body) as unknown } catch {
    throw new AccountPoolError('failed', 'The account engine returned invalid JSON.')
  }
}

/** Apply a byte bound while reading, including oversized individual chunks and multibyte text. */
function boundedResponse(response: Response, limit: number, signal: AbortSignal): Response {
  const reader = response.body?.getReader()
  if (reader === undefined) return new Response(null, { status: response.status, headers: Object.fromEntries(response.headers) })
  let total = 0
  const abort = (): void => { void reader.cancel(signal.reason).catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  const detach = (): void => { signal.removeEventListener('abort', abort) }
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted()
        const next = await reader.read()
        signal.throwIfAborted()
        if (next.done) { detach(); controller.close(); return }
        total += next.value.byteLength
        if (total > limit) {
          await reader.cancel()
          throw new AccountPoolError('failed', 'The account engine response exceeded its byte limit.')
        }
        controller.enqueue(next.value)
      } catch (error) { detach(); controller.error(error) }
    },
    async cancel(reason) { detach(); await reader.cancel(reason) },
  }), { status: response.status, headers: Object.fromEntries(response.headers) })
}
