/** Provider-neutral account management and redacted observation values. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque product account reference; core authentication identifiers remain provider-private. */
export type AccountPoolAccountRef = Branded<'AccountPoolAccountRef'>
/** Provider-owned credential filename. */
export type AccountPoolAccountName = Branded<'AccountPoolAccountName'>
/** Opaque identity of one login operation. */
export type AccountPoolLoginState = Branded<'AccountPoolLoginState'>
/** Supported account enrollment providers. */
export type AccountPoolLoginKind = 'anthropic' | 'codex' | 'antigravity' | 'kimi' | 'xai' | 'glm'
/** Availability of the account provider. */
export type AccountPoolPhase = 'starting' | 'ready' | 'error'

/** One login operation; no account tokens or provider-management authority. */
export interface AccountPoolLoginStart {
  readonly kind: AccountPoolLoginKind
  readonly flow: 'device' | 'pkce' | 'glm-key'
  readonly state?: AccountPoolLoginState
  readonly status: 'pending' | 'complete' | 'error'
  readonly url?: string
  readonly userCode?: string
  readonly expiresIn?: number
  readonly error?: string
}

/** An observed quota window; absent numbers remain unknown. */
export interface AccountPoolQuotaWindow {
  readonly key: string
  readonly label: string
  readonly remainingPercent?: number
  readonly timeRemainingPercent?: number
  readonly periodHours?: number
  readonly resetAtMs?: number
  readonly group?: string
  readonly groupDescription?: string
  readonly status: 'known' | 'partial' | 'unsupported' | 'failure'
}

/** Latest quota attempt and the time of retained successful window data. */
export interface AccountPoolQuotaState {
  readonly status: 'unobserved' | 'known' | 'partial' | 'unsupported' | 'failure'
  readonly observedAt?: number
  readonly lastSuccessAt?: number
  readonly stale: boolean
  readonly error?: string
}

/** One account's available model. */
export interface AccountPoolModel {
  readonly id: string
  readonly name?: string
  readonly ownedBy?: string
}

/** One recent-request bucket without request contents. */
export interface AccountPoolRecentRequest {
  readonly success: number
  readonly failed: number
}

/** Header values are readable only when the provider explicitly permits their names. */
export type AccountPoolHeaderValue =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'secret'; readonly configured: true }

/** Explicit edit intent; a redacted display value is never written back implicitly. */
export type AccountPoolSecretEdit =
  | { readonly kind: 'keep' }
  | { readonly kind: 'replace'; readonly value: string }
  | { readonly kind: 'remove' }

/** Non-secret scalar edits shared by field reads and patches. */
export interface AccountPoolScalarFields {
  readonly note?: string
  readonly prefix?: string
  readonly priority?: number
  readonly weight?: number
  readonly disableCooling?: boolean
  readonly websockets?: boolean
  readonly excludedModels?: readonly string[]
}

/** Redacted current editable fields. */
export interface AccountPoolFieldValues extends AccountPoolScalarFields {
  readonly proxyUrl?: string
  readonly proxyCredentialsConfigured?: boolean
  readonly headers?: Readonly<Record<string, AccountPoolHeaderValue>>
}

/** Omitted fields retain their values; secret-bearing fields require an explicit edit intent. */
export interface AccountPoolFieldPatch extends AccountPoolScalarFields {
  readonly proxyUrl?: AccountPoolSecretEdit
  readonly headers?: Readonly<Record<string, AccountPoolSecretEdit>>
}

/** Editable field names understood by account settings. */
export type AccountPoolEditableFieldName = 'note' | 'prefix' | 'proxyUrl' | 'priority' | 'weight'
  | 'disableCooling' | 'websockets' | 'excludedModels' | 'headers'

/** Supported actions distinguish per-account model lists from provider-wide listings. */
export interface AccountPoolCapabilities {
  readonly models: 'account' | 'provider' | 'none'
  readonly quota: boolean
  readonly editableFields: readonly AccountPoolEditableFieldName[]
}

/** Redacted account card with separately observable quota freshness and failure. */
export interface AccountPoolAccount extends AccountPoolFieldValues {
  readonly ref: AccountPoolAccountRef
  readonly name: AccountPoolAccountName
  readonly provider: string
  readonly label: string
  readonly email?: string
  readonly status: string
  readonly statusMessage?: string
  readonly enabled: boolean
  readonly successCount?: number
  readonly failCount?: number
  readonly createdAt?: string
  readonly modifiedAt?: string
  readonly sizeBytes?: number
  readonly recentRequests?: readonly AccountPoolRecentRequest[]
  readonly projectId?: string
  readonly planType?: string
  readonly resetCreditsAvailable?: number
  readonly quota: readonly AccountPoolQuotaWindow[]
  readonly quotaState: AccountPoolQuotaState
  readonly capabilities: AccountPoolCapabilities
}

/** Allowlisted information and editable fields for the named account. */
export interface AccountPoolEditableFields {
  readonly name: AccountPoolAccountName
  readonly info: Readonly<Record<string, string | number | boolean>>
  readonly fields: AccountPoolFieldValues
}

/** Complete committed account-management projection. */
export interface AccountPoolSnapshot {
  readonly state: AccountPoolPhase
  readonly accounts: readonly AccountPoolAccount[]
  readonly login?: AccountPoolLoginStart
  readonly error?: string
}

/** Browser callback returned by an enrollment provider. */
export interface AccountPoolCallback {
  readonly provider: AccountPoolLoginKind
  readonly redirectUrl: string
}

/** Write-only GLM account credentials; never part of snapshots or editable reads. */
export interface AccountPoolGlmKey {
  readonly apiKey: string
  readonly site: 'cn' | 'international'
  readonly organization?: string
  readonly project?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Account enrollment, management, and read-only quota observations. */
    accountPool: AccountPool
  }
}

/** Account operation refusal with a credential-free diagnostic. */
export class AccountPoolError extends Error {
  /**
   * @param code - stable failure classification.
   * @param message - bounded diagnostic safe for account-management consumers.
   * @param options - process-local failure cause.
   */
  constructor(
    readonly code: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict' | 'failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AccountPoolError'
  }
}

/** Implementations own durable accounts and publish changes only after successful writes. */
export abstract class AccountPool extends Service {
  /** @param ctx - account service owner. */
  constructor(ctx: Context) { super(ctx, 'accountPool') }

  /**
   * Read the complete committed projection.
   * @returns the current immutable snapshot.
   */
  abstract getSnapshot(): AccountPoolSnapshot

  /**
   * Observe committed snapshots; one throwing listener must not affect other listeners.
   * @param listener - callback invoked after each state commit.
   * @returns an idempotent disposer.
   */
  abstract subscribe(listener: (snapshot: AccountPoolSnapshot) => void): () => void

  /**
   * Refresh account metadata from the provider.
   * @param signal - cancels this operation.
   * @returns the refreshed snapshot; transport failure rejects.
   */
  abstract refresh(signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Change one account admission setting.
   * @param name - account filename.
   * @param enabled - whether the provider may schedule this account.
   * @param signal - cancels this operation.
   * @returns the committed snapshot.
   */
  abstract setEnabled(name: AccountPoolAccountName, enabled: boolean, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Delete one account and its quota observations.
   * @param name - account filename.
   * @param signal - cancels this operation.
   * @returns the committed snapshot.
   */
  abstract deleteAccount(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Start one enrollment operation; a new operation supersedes the previous one.
   * @param kind - enrollment provider.
   * @param signal - cancels initiation.
   * @returns the operation descriptor without account credentials.
   */
  abstract startLogin(kind: AccountPoolLoginKind, signal?: AbortSignal): Promise<AccountPoolLoginStart>

  /**
   * Refresh the matching enrollment operation; stale identities cannot update a later login.
   * @param state - the operation identity returned by startLogin.
   * @param signal - cancels this observation.
   * @returns the committed snapshot.
   */
  abstract loginStatus(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Cancel only the matching enrollment operation.
   * @param state - the operation identity.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  abstract cancelLogin(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Dismiss the current enrollment UI and cancel its owned work.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  abstract dismissLogin(signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Submit the callback for the active matching login.
   * @param input - provider and callback URL.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  abstract submitCallback(input: AccountPoolCallback, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Persist one GLM account in the provider account configuration.
   * @param input - write-only key and account scope.
   * @param signal - cancels this request.
   * @returns the committed snapshot after persistence.
   */
  abstract submitGlmKey(input: AccountPoolGlmKey, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Observe one account quota without changing scheduling or consuming credits.
   * @param ref - account identity, not its filename.
   * @param signal - cancels this observation.
   * @returns the snapshot with latest status and retained last successful windows.
   */
  abstract refreshQuota(ref: AccountPoolAccountRef, signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Observe every current account quota under the provider concurrency limit.
   * @param signal - cancels this observation.
   * @returns the committed snapshot.
   */
  abstract refreshAllQuota(signal?: AbortSignal): Promise<AccountPoolSnapshot>

  /**
   * Read the models currently available to one account.
   * @param name - account filename.
   * @param signal - cancels this request.
   * @returns the model list; transport or decoding failure rejects.
   */
  abstract listModels(name: AccountPoolAccountName, signal?: AbortSignal): Promise<readonly AccountPoolModel[]>

  /**
   * Read allowlisted fields with secret-presence markers.
   * @param name - account filename.
   * @param signal - cancels this request.
   * @returns redacted account information.
   */
  abstract readFields(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolEditableFields>

  /**
   * Persist explicit edits; secret keep/remove intents cannot overwrite stored values with masks.
   * @param name - account filename.
   * @param fields - supplied field edits.
   * @param signal - cancels this request.
   * @returns the committed snapshot; failed writes reject.
   */
  abstract patchFields(name: AccountPoolAccountName, fields: AccountPoolFieldPatch, signal?: AbortSignal): Promise<AccountPoolSnapshot>
}

export default AccountPool
