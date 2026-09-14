/** React-free account observations and typed, cancellable management commands. */
import type { RemoteStream } from '@deepseek-ai/dsh-api-gateway/client'
import type { ClientRemote, LlmProviderInfo, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@gestaltrun/dsh-account-pool/remote'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountPool, AccountPoolAccountName, AccountPoolSnapshot } from '../account-pool.ts'

/** Component operations use unwrapped results and never expose Remote or credential-file bodies. */
export type AccountPoolClientActions = Pick<AccountPool,
  | 'refresh' | 'setEnabled' | 'deleteAccount' | 'startLogin' | 'loginStatus' | 'cancelLogin' | 'dismissLogin'
  | 'submitCallback' | 'submitGlmKey' | 'refreshQuota' | 'refreshAllQuota' | 'listModels' | 'readFields' | 'patchFields'
> & {
  /** Begin the authenticated credential-file download after a successful policy check. */
  download(name: AccountPoolAccountName): Promise<void>
  /** Open a provider authorization page through the browser's normal external navigation. */
  openExternal(url: string): Promise<void>
}

/** Live route information, separate from persistent Models settings. */
export interface AccountPoolDirectory {
  readonly loaded: boolean
  readonly provider?: LlmProviderInfo
  readonly error?: string
}

/** Registrant-owned observables and management callbacks. */
export interface AccountPoolInjected {
  readonly accountPoolActions: AccountPoolClientActions
  readonly hooks: {
    readonly accountPool: HostObservable<AccountPoolSnapshot>
    readonly accountPoolDirectory: HostObservable<AccountPoolDirectory>
  }
}

type Remote = Pick<ClientRemote, 'accountPool' | 'llm' | '$stream'>
type Navigation = {
  download(name: AccountPoolAccountName, signal: AbortSignal): Promise<void>
  openExternal(url: string): Promise<void>
}

const ROUTE = 'gestalt-account-pool'

/** Owns the Remote stream and in-flight commands for one Client plugin fiber. */
export class AccountPoolClientController {
  readonly snapshot = createSnapshotStore<AccountPoolSnapshot>({ state: 'starting', accounts: [] })
  readonly directory = createSnapshotStore<AccountPoolDirectory>({ loaded: false })
  readonly actions: AccountPoolClientActions
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly stream: RemoteStream<AccountPoolSnapshot>
  private readonly done: Promise<void>
  private directoryRevision = 0

  /**
   * @param remote - generated account namespace and public LLM directory.
   * @param navigation - browser navigation and authenticated download operations.
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
      download: name => this.track(() => navigation.download(name, this.lifetime.signal)),
      openExternal: url => this.track(() => navigation.openExternal(url)),
    }
    this.stream = remote.$stream<AccountPoolSnapshot>({
      name: 'Account-pool observations',
      open: signal => rpc.watch(signal),
      ended: () => new Error('Account-pool observations ended'),
      carrierFailed: error => { this.publishFailure(error) },
    })
    this.done = this.consume()
    void this.refreshDirectory()
  }

  /**
   * Read the current LLM route; late reads cannot overwrite a newer directory result.
   * @returns after the latest result or its error is published.
   */
  async refreshDirectory(): Promise<void> {
    const revision = ++this.directoryRevision
    try {
      const providers = await this.call(() => this.remote.llm.listProviders())
      if (this.lifetime.signal.aborted || revision !== this.directoryRevision) return
      const provider = providers.find(item => item.id === ROUTE)
      this.directory.set({ loaded: true, ...provider === undefined ? {} : { provider } })
    } catch (error) {
      if (this.lifetime.signal.aborted || revision !== this.directoryRevision) return
      this.directory.set({ ...this.directory.getSnapshot(), loaded: true, error: messageOf(error) })
    }
  }

  /**
   * Abort stream and commands, then wait until no callbacks remain.
   * @returns when the Client controller is quiescent.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.directoryRevision++
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
