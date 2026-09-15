/** React-free account observations and typed, cancellable management commands. */
import type { RemoteStream } from '@deepseek-ai/dsh-api-gateway/client'
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@gestaltrun/dsh-account-pool/remote'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AccountPoolSnapshot } from '../account-pool.ts'
import type { AccountPoolClientActions } from './contract.ts'

type Remote = Pick<ClientRemote, 'accountPool' | '$stream'>
type Navigation = {
  openExternal(url: string, signal: AbortSignal): Promise<void>
}

/** Owns the Remote stream and in-flight commands for one Client plugin fiber. */
export class AccountPoolClientController {
  readonly snapshot = createSnapshotStore<AccountPoolSnapshot>({ state: 'starting', accounts: [] })
  readonly actions: AccountPoolClientActions
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly stream: RemoteStream<AccountPoolSnapshot>
  private readonly done: Promise<void>

  /**
   * @param remote - generated account namespace and public LLM directory.
   * @param navigation - Host-owned browser open for authorization URLs.
   */
  constructor(private readonly remote: Remote, navigation: Navigation) {
    const rpc = remote.accountPool
    this.actions = {
      refresh: signal => this.call(next => rpc.refresh(next), signal),
      setEnabled: (name, enabled, signal) => this.call(next => rpc.setEnabled(name, enabled, next), signal),
      deleteAccount: (name, signal) => this.call(next => rpc.deleteAccount(name, next), signal),
      startLogin: (kind, signal) => this.call(next => rpc.startLogin(kind, next), signal),
      loginStatus: (state, signal) => this.call(next => rpc.loginStatus(state, next), signal),
      cancelLogin: (state, signal) => this.call(next => rpc.cancelLogin(state, next), signal),
      dismissLogin: signal => this.call(next => rpc.dismissLogin(next), signal),
      submitCallback: (input, signal) => this.call(next => rpc.submitCallback(input, next), signal),
      submitGlmKey: (input, signal) => this.call(next => rpc.submitGlmKey(input, next), signal),
      refreshQuota: (ref, signal) => this.call(next => rpc.refreshQuota(ref, next), signal),
      refreshAllQuota: signal => this.call(next => rpc.refreshAllQuota(next), signal),
      listModels: (name, signal) => this.call(next => rpc.listModels(name, next), signal),
      readFields: (name, signal) => this.call(next => rpc.readFields(name, next), signal),
      patchFields: (name, fields, signal) => this.call(next => rpc.patchFields(name, fields, next), signal),
      openExternal: url => this.track(() => navigation.openExternal(url, this.lifetime.signal)),
    }
    this.stream = remote.$stream<AccountPoolSnapshot>({
      name: 'Account-pool observations',
      open: signal => rpc.watch(signal),
      ended: () => new Error('Account-pool observations ended'),
      carrierFailed: error => { this.publishFailure(error) },
    })
    this.done = this.consume()
  }

  /**
   * Abort stream and commands, then wait until no callbacks remain.
   * @returns when the Client controller is quiescent.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await this.stream.dispose()
    await this.done
    await Promise.allSettled([...this.pending])
  }

  private async consume(): Promise<void> {
    try {
      for await (const item of this.stream) {
        if (this.lifetime.signal.aborted) return
        this.snapshot.set(item.value)
        item.accept()
      }
    } catch (error) {
      this.publishFailure(error)
    }
  }

  private publishFailure(error: unknown): void {
    if (!this.lifetime.signal.aborted) this.snapshot.set({ ...this.snapshot.getSnapshot(), state: 'error', error: messageOf(error) })
  }

  private call<T>(request: (signal: AbortSignal) => Promise<RemoteResult<T>>, signal?: AbortSignal): Promise<T> {
    return this.track(async () => {
      const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
      combined.throwIfAborted()
      const result = await request(combined)
      if (!result.ok) throw result.error
      return result.value
    })
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    const done = Promise.resolve().then(() => { this.lifetime.signal.throwIfAborted(); return operation() })
    this.pending.add(done)
    void done.then(() => this.pending.delete(done), () => this.pending.delete(done))
    return done
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
