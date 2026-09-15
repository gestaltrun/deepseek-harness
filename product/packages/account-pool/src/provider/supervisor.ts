/** Embedded CLIProxyAPI generations owned through the public local subprocess service. */
import { randomBytes } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { scrubbedParentEnv, type SubprocessRuntime, type SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { AccountPoolError } from '../account-pool.ts'
import type { Spec } from './config.ts'
import { AccountState, removeGeneration, verifyResource } from './state.ts'
import { GenerationTransport } from './transport.ts'

/** One ready private engine generation. */
export interface Generation {
  readonly signal: AbortSignal
  readonly transport: GenerationTransport
  readonly directory: string
  readonly retire: () => void
}

/** Current generation callbacks; withdrawal closes request admission synchronously. */
export interface SupervisorObserver {
  ready(generation: Generation): Promise<void>
  withdraw(): void
  quiesce(): Promise<void>
  failed(error: unknown): void
}

class GenerationCleanupError extends Error {}

/** Owns exclusive state, readiness, bounded replacement, and quiescent shutdown. */
export class Supervisor {
  private readonly lifetime = new AbortController()
  private task: Promise<void> | undefined
  private cleanupFailure: GenerationCleanupError | undefined
  private releaseState = true

  /**
   * @param subprocess - explicitly local isolated subprocess implementation.
   * @param spec - validated instance policy.
   * @param observer - account and inference admission owner.
   */
  constructor(private readonly subprocess: SubprocessRuntime, private readonly spec: Spec, private readonly observer: SupervisorObserver) {}

  /** Start the supervisor once; readiness and errors are reported through the observer. */
  start(): void {
    if (this.task !== undefined) return
    this.task = this.run().catch(error => {
      if (error instanceof GenerationCleanupError) this.cleanupFailure = error
      this.observer.failed(error)
    })
  }

  /** Withdraw requests, cancel work, and wait until all owned processes and dispatchers have stopped. */
  async stop(): Promise<void> {
    this.observer.withdraw()
    this.lifetime.abort()
    await this.task
    if (this.cleanupFailure !== undefined) throw this.cleanupFailure
  }

  private async run(): Promise<void> {
    const binary = await verifyResource(this.spec)
    this.lifetime.signal.throwIfAborted()
    const state = await AccountState.acquire(this.spec.stateRoot, this.spec.maxResponseBytes)
    try {
      for (let attempt = 0; attempt <= this.spec.restartLimit && !this.lifetime.signal.aborted; attempt += 1) {
        try {
          await this.runGeneration(attempt === 0 ? binary : await verifyResource(this.spec), state)
        } catch (error) {
          if (error instanceof GenerationCleanupError) throw error
          if (this.lifetime.signal.aborted) return
          if (attempt === this.spec.restartLimit) throw error
          this.observer.failed(new AccountPoolError('unavailable', 'The account engine is restarting.'))
        }
      }
    } finally { if (this.releaseState) await state.release() }
  }

  private async runGeneration(binary: string, state: AccountState): Promise<void> {
    const directory = await state.generationDirectory()
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, this.lifetime.signal])
    let child: SubprocessHandle | undefined
    let transport: GenerationTransport | undefined
    let quiescent = true
    try {
      if (process.platform !== 'win32') await chmod(directory, 0o700)
      const port = await reservePort()
      const managementKey = randomBytes(32).toString('hex')
      const inferenceKey = randomBytes(32).toString('hex')
      await state.configure({
        host: '127.0.0.1', port,
        'remote-management': { 'allow-remote': false, 'secret-key': managementKey, 'disable-control-panel': true },
        'auth-dir': state.authDirectory, 'api-keys': [inferenceKey],
        debug: false, 'logging-to-file': false, 'usage-statistics-enabled': false,
      }, this.spec.maxResponseBytes)
      signal.throwIfAborted()
      transport = new GenerationTransport(`http://127.0.0.1:${port}`,
        managementKey, inferenceKey, signal, this.spec)
      child = this.subprocess.spawn({
        argv: [binary, '--config', state.configFile, '--local-model'], cwd: directory,
        env: privateEnvironment(directory), graceMs: this.spec.stopGraceMs,
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.spec.maxResponseBytes }, stderr: { maxBytes: this.spec.maxResponseBytes } },
      })
      quiescent = false
      const outcome = child.done.then(
        value => { lifetime.abort(new Error('Account engine exited.')); return value },
        error => { lifetime.abort(new Error('Account engine failed.')); throw error },
      )
      // Attach rejection handling before readiness awaits the same process lifetime.
      void outcome.catch(() => undefined)
      const readySignal = AbortSignal.any([signal, AbortSignal.timeout(this.spec.startupTimeoutMs)])
      while (true) {
        readySignal.throwIfAborted()
        try { await transport.catalog(readySignal); break } catch (error) {
          readySignal.throwIfAborted()
          if (error instanceof AccountPoolError && error.code === 'failed') throw error
          await delay(this.spec.readinessIntervalMs, undefined, { signal: readySignal })
        }
      }
      await this.observer.ready({ signal, transport, directory, retire: () => { lifetime.abort() } })
      await Promise.race([outcome, cancelled(signal)])
      if (!this.lifetime.signal.aborted) throw new AccountPoolError('unavailable', 'The account engine exited unexpectedly.')
    } finally {
      this.observer.withdraw()
      lifetime.abort()
      try {
        await this.observer.quiesce()
        await transport?.quiesce()
        if (child !== undefined) {
          child.terminate()
          quiescent = await child.waitForExit()
          if (!quiescent) throw new Error('The account engine process range did not become empty.')
        }
        await transport?.close()
        if (quiescent) await removeGeneration(directory)
      } catch (cause) {
        if (!quiescent) this.releaseState = false
        throw new GenerationCleanupError('The account engine could not complete generation cleanup.', { cause })
      }
    }
  }
}


function privateEnvironment(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TZ'])
  for (const [key, value] of Object.entries(scrubbedParentEnv())) {
    env[key] = allowed.has(key.toUpperCase()) ? value : undefined
  }
  return { ...env, HOME: directory, USERPROFILE: directory, TMPDIR: directory, TMP: directory, TEMP: directory }
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Account engine port allocation failed.')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

function cancelled(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}
