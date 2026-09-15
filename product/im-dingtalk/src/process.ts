/** Managed DWS command execution through the shared subprocess service. */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedDingTalkTransportConfig } from './config.ts'
import { DwsProtocolError } from './protocol.ts'

/** Successful bounded DWS command output. */
export interface DwsCommandOutput { readonly stdout: string; readonly outcome: SubprocessOutcome }

/** DWS execution failure that records whether the platform command started. */
export class DwsCommandError extends DwsProtocolError {
  /** @param code - stable failure code. @param message - safe diagnostic. @param started - whether a child handle was published. */
  constructor(code: string, message: string, readonly started: boolean) { super(code, message); this.name = 'DwsCommandError' }
}

/** Ready long-running DWS event process. */
export interface DwsEventStream {
  readonly ready: Promise<void>
  readonly done: Promise<void>
  /** Gracefully close stdin, terminate the managed range, and await quiescence. */
  stop(): Promise<void>
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

function safeEnd(handle: SubprocessHandle): void {
  try { handle.stdin?.end() } catch {
    // The managed handle owns further termination when a closing stdin rejects locally.
  }
}

function readCollected(handle: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  const read = handle.collected[stream]?.readFrom(0)
  if (read?.lossy === true) throw new DwsCommandError('DINGTALK_COMMAND_OUTPUT_LIMIT', 'DWS command exceeded the configured output limit', true)
  return read?.text ?? ''
}

function splitLines(
  stream: NodeJS.ReadableStream,
  maxLineBytes: number,
  onLine: (line: string) => void,
  onError: (error: unknown) => void,
): void {
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffered += chunk
    if (Buffer.byteLength(buffered) > maxLineBytes && !buffered.includes('\n')) {
      onError(new DwsProtocolError('DINGTALK_EVENT_LINE_LIMIT', 'DWS event line exceeded the configured limit'))
      return
    }
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      const line = buffered.slice(0, newline).replace(/\r$/u, '')
      buffered = buffered.slice(newline + 1)
      if (Buffer.byteLength(line) > maxLineBytes) onError(new DwsProtocolError('DINGTALK_EVENT_LINE_LIMIT', 'DWS event line exceeded the configured limit'))
      else onLine(line)
      newline = buffered.indexOf('\n')
    }
  })
  stream.on('end', () => {
    if (buffered.length === 0) return
    if (Buffer.byteLength(buffered) > maxLineBytes) onError(new DwsProtocolError('DINGTALK_EVENT_LINE_LIMIT', 'DWS event line exceeded the configured limit'))
    else onLine(buffered.replace(/\r$/u, ''))
  })
  stream.on('error', onError)
}

/** DWS process runner bound to one Cordis subprocess provider. */
export class DwsProcessRunner {
  private executable: Promise<string> | undefined

  /** @param ctx - Cordis context with the common subprocess service. @param config - validated process limits. */
  constructor(private readonly ctx: Context, private readonly config: ResolvedDingTalkTransportConfig) {}

  private environment(): Readonly<Record<string, string>> { return { HOME: this.config.home } }

  private resolve(signal: AbortSignal): Promise<string> {
    this.executable ??= this.ctx.subprocess.resolveExecutable(this.config.dwsPath, this.environment(), signal)
      .catch((error: unknown) => { this.executable = undefined; throw error })
    return this.executable
  }

  /**
   * Run one bounded public DWS command.
   * @param args - command arguments excluding argv[0].
   * @param signal - caller cancellation.
   * @returns complete stdout after clean managed-range exit.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<DwsCommandOutput> {
    let executable: string
    try { executable = await this.resolve(signal) } catch {
      throw new DwsCommandError('DINGTALK_DWS_NOT_INSTALLED', 'The configured DWS executable is unavailable', false)
    }
    const timeout = AbortSignal.timeout(this.config.commandTimeoutMs)
    const commandSignal = AbortSignal.any([signal, timeout])
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [executable, ...args],
        cwd: this.config.cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.config.maxOutputBytes },
          stderr: { maxBytes: this.config.maxOutputBytes },
        },
        graceMs: this.config.graceMs,
        signal: commandSignal,
        env: this.environment(),
      })
    } catch {
      throw new DwsCommandError('DINGTALK_COMMAND_NOT_STARTED', 'DWS command could not start', false)
    }
    let outcome: SubprocessOutcome
    try { outcome = await handle.done } catch {
      throw new DwsCommandError('DINGTALK_COMMAND_OUTCOME_UNKNOWN', 'DWS command outcome is unknown', true)
    }
    if (commandSignal.aborted) throw new DwsCommandError('DINGTALK_COMMAND_OUTCOME_UNKNOWN', 'DWS command did not complete before cancellation', true)
    const quiescent = await handle.waitForExit(AbortSignal.timeout(this.config.graceMs))
    if (!quiescent) throw new DwsCommandError('DINGTALK_COMMAND_NOT_QUIESCENT', 'DWS command left managed work running', true)
    const stdout = readCollected(handle, 'stdout')
    readCollected(handle, 'stderr')
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw new DwsCommandError('DINGTALK_COMMAND_FAILED', 'DWS command exited without a successful result', true)
    }
    return { stdout, outcome }
  }

  /**
   * Start the complete public IM event set and wait for DWS's exact ready marker.
   * @param args - event-consume arguments excluding argv[0].
   * @param signal - account listener lifetime.
   * @param onLine - sequential handler for each non-empty stdout line.
   * @returns stream readiness, completion, and teardown controls.
   */
  async stream(args: readonly string[], signal: AbortSignal, onLine: (line: string) => Promise<void>): Promise<DwsEventStream> {
    let executable: string
    try { executable = await this.resolve(signal) } catch {
      throw new DwsCommandError('DINGTALK_DWS_NOT_INSTALLED', 'The configured DWS executable is unavailable', false)
    }
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [executable, ...args],
        cwd: this.config.cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        graceMs: this.config.graceMs,
        signal,
        env: this.environment(),
      })
    } catch {
      throw new DwsCommandError('DINGTALK_COMMAND_NOT_STARTED', 'DWS event consumer could not start', false)
    }
    if (handle.stdout === undefined || handle.stderr === undefined || handle.stdin === undefined) {
      handle.terminate()
      throw new DwsCommandError('DINGTALK_STREAM_PIPE_MISSING', 'DWS event consumer did not publish its pipes', true)
    }
    const ready = deferred<void>()
    const failure = deferred<never>()
    let readySettled = false
    let stopping = false
    let processing = Promise.resolve()
    const fail = (error: unknown): void => {
      if (!readySettled) { readySettled = true; ready.reject(error) }
      failure.reject(error)
      handle.terminate()
    }
    splitLines(handle.stderr, this.config.maxLineBytes, line => {
      if (!readySettled && /^\[event\] ready(?:\s|$)/u.test(line)) {
        readySettled = true
        ready.resolve()
      }
    }, fail)
    splitLines(handle.stdout, this.config.maxLineBytes, line => {
      if (line.trim().length === 0) return
      processing = processing.then(async () => { await ready.promise; await onLine(line) })
      processing.catch(fail)
    }, fail)
    const outcome = handle.done.then(async value => {
      if (!readySettled) {
        const error = new DwsCommandError('DINGTALK_STREAM_NOT_READY', 'DWS event consumer exited before readiness', true)
        readySettled = true
        ready.reject(error)
        throw error
      }
      await processing
      if (!stopping && !signal.aborted && (value.exitCode !== 0 || value.signal !== null)) {
        throw new DwsCommandError('DINGTALK_STREAM_EXITED', 'DWS event consumer exited unexpectedly', true)
      }
    })
    const readyTimeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        const error = new DwsCommandError('DINGTALK_STREAM_READY_TIMEOUT', 'DWS event consumer did not publish readiness', true)
        fail(error)
        reject(error)
      }, this.config.readinessTimeoutMs)
      ready.promise.finally(() => { clearTimeout(timer) }).catch(() => {})
    })
    const publishedReady = Promise.race([ready.promise, readyTimeout])
    const done = Promise.race([outcome, failure.promise])
    return {
      ready: publishedReady,
      done,
      stop: async () => {
        if (stopping) { await done.catch(() => {}); return }
        stopping = true
        safeEnd(handle)
        handle.terminate()
        const quiescent = await handle.waitForExit(AbortSignal.timeout(this.config.graceMs))
        await done.catch(error => { if (!signal.aborted) throw error })
        if (!quiescent) throw new DwsCommandError('DINGTALK_STREAM_NOT_QUIESCENT', 'DWS event consumer left managed work running', true)
      },
    }
  }
}
