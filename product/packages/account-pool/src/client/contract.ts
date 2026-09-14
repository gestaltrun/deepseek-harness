/** Public account-management values and callbacks, independent from Client transport assembly. */
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm/types'
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
