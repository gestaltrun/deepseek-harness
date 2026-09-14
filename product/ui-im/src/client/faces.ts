/** Plain callback and observable inputs assembled by the IM UI plugin. */
import type {
  IImClient, ImAccountLifecycleRequest, ImAccountOperationQueryRequest, ImAccountSetupId,
  ImAccountSetupPreview, ImAccountSetupRequest, ImCancelAccountSetupResult,
  ImConfirmAccountSetupRequest, ImOperationId, ImSetAccountPausedRequest,
  ImAccountCandidatesSource, ImConfigurationSource, ImPlatform,
} from '@gestaltrun/dsh-api-im/client'
import {
  accountFailureOutcome, accountMutationOutcome, accountOutcome, type AccountActionOutcome,
} from './account-actions.ts'

/** Safe Remote value or a user-visible failure. */
export type UiResult<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly message: string }

/** Account settings bindings, without a Context or a whole service object. */
export interface AccountsFace {
  readonly hooks: {
    readonly configuration: ImConfigurationSource
    readonly candidates: ImAccountCandidatesSource
  }
  /** Read installed or admitted account choices from the provider. */
  readonly loadCandidates: (platform: ImPlatform, signal: AbortSignal) => Promise<void>
  /** Verify write-only fields without persisting an account. */
  readonly previewSetup: (request: ImAccountSetupRequest, signal: AbortSignal) => Promise<UiResult<ImAccountSetupPreview>>
  /** Persist the exact Host-held setup under one retained operation identity. */
  readonly confirmSetup: (request: ImConfirmAccountSetupRequest) => Promise<AccountActionOutcome>
  /** Release an unconfirmed Host-held setup and report any confirmation race. */
  readonly cancelSetup: (setupId: ImAccountSetupId) => Promise<UiResult<ImCancelAccountSetupResult>>
  /** Mint an operation identity once when the operator initiates an account command. */
  readonly operationId: () => ImOperationId
  /** Submit a pause change using the displayed account revision. */
  readonly setPaused: (request: ImSetAccountPausedRequest) => Promise<AccountActionOutcome>
  /** Persist disconnection using the revision captured before confirmation. */
  readonly disconnect: (request: ImAccountLifecycleRequest) => Promise<AccountActionOutcome>
  /** Persist reconnection independently of pause and listener state. */
  readonly reconnect: (request: ImAccountLifecycleRequest) => Promise<AccountActionOutcome>
  /** Ask the provider to refresh authorization without exposing credentials. */
  readonly refresh: (request: ImAccountLifecycleRequest) => Promise<AccountActionOutcome>
  /** Query a lifecycle operation whose response was not confirmed. */
  readonly queryOperation: (request: ImAccountOperationQueryRequest) => Promise<AccountActionOutcome>
}

/** @param im - authoritative Client object. @param operationId - mutation id factory. @returns account settings inputs. */
export function accountFace(im: IImClient, operationId: () => Parameters<IImClient['setAccountPaused']>[0]['operationId']): AccountsFace {
  return {
    hooks: { configuration: im.configuration, candidates: im.accountCandidates },
    operationId,
    loadCandidates: async (platform, signal) => { await im.listAccountCandidates(platform, signal) },
    previewSetup: async (request, signal) => {
      const result = await im.previewAccountSetup(request, signal)
      return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
    },
    confirmSetup: async request => accountOutcome(await im.confirmAccountSetup(request)),
    cancelSetup: async setupId => {
      const result = await im.cancelAccountSetup(setupId)
      return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
    },
    setPaused: async request => accountOutcome(await im.setAccountPaused(request)),
    disconnect: async request => accountOutcome(await im.disconnectAccount(request)),
    reconnect: async request => accountOutcome(await im.reconnectAccount(request)),
    refresh: async request => accountOutcome(await im.refreshAccount(request)),
    queryOperation: async request => {
      const result = await im.queryAccountOperation(request)
      if (!result.ok) return accountFailureOutcome(result.error)
      return result.value.state === 'known'
        ? accountMutationOutcome(result.value.result)
        : { status: 'unknown' }
    },
  }
}
