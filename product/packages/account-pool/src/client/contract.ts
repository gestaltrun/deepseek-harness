/** Public account-management values and callbacks, independent from Client transport assembly. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountPool, AccountPoolAccountName, AccountPoolSnapshot } from '../account-pool.ts'

/** Component operations use unwrapped results and never expose Remote or credential-file bodies. */
export type AccountPoolClientActions = Pick<AccountPool,
  | 'refresh' | 'setEnabled' | 'deleteAccount' | 'startLogin' | 'loginStatus' | 'cancelLogin' | 'dismissLogin'
  | 'submitCallback' | 'submitGlmKey' | 'refreshQuota' | 'refreshAllQuota' | 'listModels' | 'readFields' | 'patchFields'
> & {
  /** Begin the authenticated credential-file download after a successful policy check. */
  download(name: AccountPoolAccountName): Promise<void>
  /** Ask the Host to open a provider authorization page in the system browser. */
  openExternal(url: string): Promise<void>
}

/** Registrant-owned observables and management callbacks. */
export interface AccountPoolInjected {
  readonly accountPoolActions: AccountPoolClientActions
  readonly hooks: {
    readonly accountPool: HostObservable<AccountPoolSnapshot>
  }
}
