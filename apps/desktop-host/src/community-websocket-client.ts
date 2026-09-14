/** Browser WebSocket adapter injected only into Desktop's trusted application document. */
import { COMMUNITY_WEBSOCKET_PATH } from './community-transport.ts'

function installDesktopWebSocket(carrier: string): void {
  if (location.protocol !== 'dsh-app:' || location.host !== 'app') return
  const NativeWebSocket = globalThis.WebSocket
  const encode = (bytes: Uint8Array): string => {
    let text = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    return btoa(text)
  }
  class DesktopWebSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly url: string
    readyState = 0
    protocol = ''
    extensions = ''
    bufferedAmount = 0
    private binary: BinaryType = 'blob'
    private id = ''
    private sequence = 0
    private tail = Promise.resolve()
    private readonly abort = new AbortController()
    onopen: ((event: Event) => unknown) | null = null
    onmessage: ((event: MessageEvent) => unknown) | null = null
    onerror: ((event: Event) => unknown) | null = null
    onclose: ((event: CloseEvent) => unknown) | null = null

    constructor(input: string | URL, protocols?: string | string[]) {
      super()
      const url = new URL(String(input), location.href)
      this.url = url.href
      if (url.host !== 'app' || !['dsh-app:', 'ws:', 'wss:'].includes(url.protocol)) return new NativeWebSocket(input, protocols) as DesktopWebSocket
      if (url.username !== '' || url.password !== '' || url.hash !== '') throw new DOMException('Invalid Desktop WebSocket URL', 'SyntaxError')
      const list = typeof protocols === 'string' ? [protocols] : protocols ?? []
      if (list.some(value => !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) || new Set(list).size !== list.length) throw new DOMException('Invalid WebSocket protocols', 'SyntaxError')
      this.addEventListener('open', (event) => { this.onopen?.call(this, event) })
      this.addEventListener('message', (event) => { this.onmessage?.call(this, event as MessageEvent) })
      this.addEventListener('error', (event) => { this.onerror?.call(this, event) })
      this.addEventListener('close', (event) => { this.onclose?.call(this, event as CloseEvent) })
      void this.connect(list)
    }

    get binaryType(): BinaryType { return this.binary }
    set binaryType(value: string) { if (value === 'blob' || value === 'arraybuffer') this.binary = value }

    private finish(code: number, reason: string, wasClean: boolean): void {
      if (this.readyState === this.CLOSED) return
      this.readyState = this.CLOSED
      this.abort.abort()
      this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean }))
    }

    private fail(): void {
      if (this.readyState === this.CLOSED) return
      this.dispatchEvent(new Event('error'))
      this.finish(1006, '', false)
    }

    private async connect(protocols: string[]): Promise<void> {
      try {
        const response = await fetch(`${carrier}/open`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: this.url, protocols }), signal: this.abort.signal,
        })
        if (!response.ok || response.body === null) throw new Error('Desktop WebSocket upgrade failed')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            pending += decoder.decode(value, { stream: !done })
            let newline: number
            while ((newline = pending.indexOf('\n')) !== -1) {
              const line = pending.slice(0, newline)
              pending = pending.slice(newline + 1)
              if (line !== '') this.receive(JSON.parse(line) as Record<string, unknown>)
            }
            if (done) break
          }
          if (this.readyState !== this.CLOSED) this.fail()
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
      } catch { this.fail() }
    }

    private receive(frame: Record<string, unknown>): void {
      if (this.readyState === this.CLOSED) return
      if (frame.type === 'open' && this.readyState === this.CONNECTING && typeof frame.id === 'string' && typeof frame.protocol === 'string' && typeof frame.extensions === 'string') {
        this.id = frame.id
        this.protocol = frame.protocol
        this.extensions = frame.extensions
        this.readyState = this.OPEN
        this.dispatchEvent(new Event('open'))
      } else if (frame.type === 'message' && typeof frame.data === 'string' && typeof frame.binary === 'boolean') {
        if (this.readyState !== this.OPEN) return
        let data: string | ArrayBuffer | Blob = frame.data
        if (frame.binary) {
          const bytes = Uint8Array.from(atob(frame.data), char => char.charCodeAt(0))
          data = this.binary === 'arraybuffer' ? bytes.buffer : new Blob([bytes])
        }
        this.dispatchEvent(new MessageEvent('message', { data }))
      } else if (frame.type === 'close' && typeof frame.code === 'number' && typeof frame.reason === 'string' && typeof frame.wasClean === 'boolean') {
        this.finish(frame.code, frame.reason, frame.wasClean)
      } else if (frame.type === 'error') this.dispatchEvent(new Event('error'))
      else throw new Error('Invalid Desktop WebSocket frame')
    }

    private async command(path: string, fields: object): Promise<void> {
      const response = await fetch(`${carrier}/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: this.id, sequence: this.sequence++, ...fields }),
        signal: this.abort.signal,
      })
      if (!response.ok) throw new Error('Desktop WebSocket command failed')
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyState === this.CONNECTING) throw new DOMException('WebSocket is connecting', 'InvalidStateError')
      const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data instanceof Blob ? data.size : data.byteLength
      this.bufferedAmount += size
      if (this.readyState !== this.OPEN) return
      const queuedData = typeof data === 'string' || data instanceof Blob
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
          : new Uint8Array(data).slice()
      this.tail = this.tail.then(async () => {
        const bytes = typeof queuedData === 'string'
          ? null
          : queuedData instanceof Blob ? new Uint8Array(await queuedData.arrayBuffer()) : queuedData
        await this.command('send', { binary: bytes !== null, data: bytes === null ? queuedData : encode(bytes) })
        this.bufferedAmount -= size
      }).catch(() => { this.fail() })
    }

    close(code = 1000, reason = ''): void {
      if (code !== 1000 && (!Number.isInteger(code) || code < 3000 || code > 4999)) throw new DOMException('Invalid WebSocket close code', 'InvalidAccessError')
      if (new TextEncoder().encode(reason).byteLength > 123) throw new DOMException('WebSocket close reason exceeds 123 bytes', 'SyntaxError')
      if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) return
      if (this.readyState === this.CONNECTING) { this.finish(1006, '', false); return }
      this.readyState = this.CLOSING
      this.tail = this.tail.then(() => this.command('close', { code, reason })).catch(() => { this.fail() })
    }
  }
  globalThis.WebSocket = DesktopWebSocket as unknown as typeof WebSocket
}

/** Self-contained JavaScript installed before any Desktop community client module executes. */
export const DESKTOP_COMMUNITY_WEBSOCKET_SCRIPT = `(${installDesktopWebSocket.toString()})(${JSON.stringify(COMMUNITY_WEBSOCKET_PATH)})`
