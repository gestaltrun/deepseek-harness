/** Typed account-management Remote controller and authenticated download registration. */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AccountPoolAccountName, AccountPoolAccountRef, AccountPoolCallback,
  AccountPoolEditableFields, AccountPoolFieldPatch, AccountPoolGlmKey,
  AccountPoolLoginKind, AccountPoolLoginStart, AccountPoolLoginState,
  AccountPoolModel, AccountPoolSnapshot,
} from '../account-pool.ts'
import { ACCOUNT_POOL_EXPORT_PATH, accountPoolExportResponse } from './export.ts'
import { accountPoolRemoteError } from './errors.ts'
import { watchAccountPool } from './watch.ts'

/** Explicit credential export policy; no implicit Web enablement. */
export interface Config {
  readonly allowCredentialExport: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the accountPool Remote namespace. */
    accountPoolController: AccountPoolController
  }
}

/** Only narrow account intents are remotely callable; credential bytes use the download route. */
export class AccountPoolController extends TypertRemoteService {
  static inject = ['typert', 'accountPool', 'connection']
  static Config: Schema<Config> = Schema.object({ allowCredentialExport: Schema.boolean().required() })
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - authenticated carrier and account service owner.
   * @param config - explicit export policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'accountPoolController', { namespace: 'accountPool' })
    ctx.effect(() => () => { this.lifetime.abort() }, 'account pool RPC lifetime')
    ctx.connection.fetch.register({
      path: ACCOUNT_POOL_EXPORT_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered',
      fetch: request => accountPoolExportResponse(ctx.accountPool, config.allowCredentialExport, request),
    })
  }

  /**
   * Read the complete committed projection.
   * @returns the current immutable snapshot.
   */
  @Remote
  getSnapshot(): AccountPoolSnapshot {
    return this.ctx.accountPool.getSnapshot()
  }

  /**
   * Refresh account metadata from the provider.
   * @param signal - cancels this operation.
   * @returns the refreshed snapshot; transport failure rejects.
   */
  @Remote
  refresh(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.refresh(signal))
  }

  /**
   * Change one account admission setting.
   * @param name - account filename.
   * @param enabled - whether the provider may schedule this account.
   * @param signal - cancels this operation.
   * @returns the committed snapshot.
   */
  @Remote
  setEnabled(name: AccountPoolAccountName, enabled: boolean, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.setEnabled(name, enabled, signal))
  }

  /**
   * Delete one account and its quota observations.
   * @param name - account filename.
   * @param signal - cancels this operation.
   * @returns the committed snapshot.
   */
  @Remote
  deleteAccount(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.deleteAccount(name, signal))
  }

  /**
   * Start one enrollment operation; a new operation supersedes the previous one.
   * @param kind - enrollment provider.
   * @param signal - cancels initiation.
   * @returns the operation descriptor without account credentials.
   */
  @Remote
  startLogin(kind: AccountPoolLoginKind, signal?: AbortSignal): Promise<AccountPoolLoginStart> {
    return this.call(() => this.ctx.accountPool.startLogin(kind, signal))
  }

  /**
   * Refresh the matching enrollment operation; stale identities cannot update a later login.
   * @param state - the operation identity returned by startLogin.
   * @param signal - cancels this observation.
   * @returns the committed snapshot.
   */
  @Remote
  loginStatus(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.loginStatus(state, signal))
  }

  /**
   * Cancel only the matching enrollment operation.
   * @param state - the operation identity.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  @Remote
  cancelLogin(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.cancelLogin(state, signal))
  }

  /**
   * Dismiss the current enrollment UI and cancel its owned work.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  @Remote
  dismissLogin(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.dismissLogin(signal))
  }

  /**
   * Submit the callback for the active matching login.
   * @param input - provider and callback URL.
   * @param signal - cancels this request.
   * @returns the committed snapshot.
   */
  @Remote
  submitCallback(input: AccountPoolCallback, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.submitCallback(input, signal))
  }

  /**
   * Persist one GLM account in the provider account configuration.
   * @param input - write-only key and account scope.
   * @param signal - cancels this request.
   * @returns the committed snapshot after persistence.
   */
  @Remote
  submitGlmKey(input: AccountPoolGlmKey, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.submitGlmKey(input, signal))
  }

  /**
   * Observe one account quota without changing scheduling or consuming credits.
   * @param ref - account identity, not its filename.
   * @param signal - cancels this observation.
   * @returns the snapshot with latest status and retained last successful windows.
   */
  @Remote
  refreshQuota(ref: AccountPoolAccountRef, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.refreshQuota(ref, signal))
  }

  /**
   * Observe every current account quota under the provider concurrency limit.
   * @param signal - cancels this observation.
   * @returns the committed snapshot.
   */
  @Remote
  refreshAllQuota(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.refreshAllQuota(signal))
  }

  /**
   * Read the models currently available to one account.
   * @param name - account filename.
   * @param signal - cancels this request.
   * @returns the model list; transport or decoding failure rejects.
   */
  @Remote
  listModels(name: AccountPoolAccountName, signal?: AbortSignal): Promise<readonly AccountPoolModel[]> {
    return this.call(() => this.ctx.accountPool.listModels(name, signal))
  }

  /**
   * Read allowlisted fields with secret-presence markers.
   * @param name - account filename.
   * @param signal - cancels this request.
   * @returns redacted account information.
   */
  @Remote
  readFields(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolEditableFields> {
    return this.call(() => this.ctx.accountPool.readFields(name, signal))
  }

  /**
   * Persist explicit edits; secret keep/remove intents cannot overwrite stored values with masks.
   * @param name - account filename.
   * @param fields - supplied field edits.
   * @param signal - cancels this request.
   * @returns the committed snapshot; failed writes reject.
   */
  @Remote
  patchFields(name: AccountPoolAccountName, fields: AccountPoolFieldPatch, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.call(() => this.ctx.accountPool.patchFields(name, fields, signal))
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) { throw accountPoolRemoteError(error) }
  }

  /**
   * Follow the current snapshot and committed replacements; slow readers receive the latest state.
   * @param signal - connection request lifetime.
   * @returns a stream that ends when the caller or controller is disposed.
   */
  @Remote({ mode: 'stream' })
  watch(signal?: AbortSignal): AsyncIterable<AccountPoolSnapshot> {
    return watchAccountPool(this.ctx.accountPool, signal === undefined
      ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]))
  }
}

export default AccountPoolController
