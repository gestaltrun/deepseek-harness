/** Account operation drafts retain the exact observed revision and uncertain operation identity. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  IImClient, ImAccountId, ImAccountLifecycleRequest, ImAccountMutationResult,
  ImAccountSetupId, ImAccountSetupPreview, ImConfirmAccountSetupRequest,
  ImOperationId, ImSetAccountPausedRequest,
} from '@gestaltrun/dsh-api-im/client'

/** Complete UI command fields reuse the Host-owned request types. */
export type AccountAction =
  | { readonly kind: 'pause'; readonly request: ImSetAccountPausedRequest }
  | { readonly kind: 'disconnect' | 'reconnect' | 'refresh'; readonly request: ImAccountLifecycleRequest }

/** Acknowledgement is separate from the authoritative account projection. */
export type AccountActionOutcome = {
  readonly status: 'applied' | 'conflict' | 'rejected' | 'unknown'
  readonly message?: string
}

/** Command state survives Accounts section remounts for receipt reconciliation. */
export interface AccountActionState {
  readonly action: AccountAction
  readonly status: 'pending' | AccountActionOutcome['status']
  readonly message?: string
}

/** Safe staged-setup state; credential fields never enter the Client store. */
export interface AccountSetupState {
  readonly preview: ImAccountSetupPreview
  readonly confirmation?: ImConfirmAccountSetupRequest
  readonly status: 'previewed' | 'pending' | 'confirming' | AccountActionOutcome['status']
  readonly message?: string
}

type AccountUiState = {
  operations: Record<string, AccountActionState | undefined>
  setup?: AccountSetupState
}
type AccountUiActions = {
  begin: (state: AccountUiState, action: AccountAction) => void
  finish: (state: AccountUiState, accountId: ImAccountId, operationId: ImOperationId, outcome: AccountActionOutcome) => void
  previewSetup: (state: AccountUiState, preview: ImAccountSetupPreview) => void
  beginSetupConfirmation: (state: AccountUiState, request: ImConfirmAccountSetupRequest) => void
  finishSetupConfirmation: (state: AccountUiState, request: ImConfirmAccountSetupRequest, outcome: AccountActionOutcome) => void
  setupConfirming: (state: AccountUiState, setupId: ImAccountSetupId) => void
  clearSetup: (state: AccountUiState, setupId: ImAccountSetupId) => void
}

/** @returns a private handle for account operation observations, never authoritative account data. */
export function createAccountActionStore(): EngineStoreHandle<AccountUiState, AccountUiActions> {
  return defineStore({
    init: (): AccountUiState => ({ operations: {} }),
    actions: {
      begin(state, action) { state.operations[action.request.accountId] = { action, status: 'pending' } },
      finish(state, accountId, operationId, outcome) {
        const current = state.operations[accountId]
        if (current?.action.request.operationId !== operationId) return
        state.operations[accountId] = { action: current.action, ...outcome }
      },
      previewSetup(state, preview) { state.setup = { preview, status: 'previewed' } },
      beginSetupConfirmation(state, request) {
        if (state.setup?.preview.setupId !== request.setupId) return
        state.setup = { preview: state.setup.preview, confirmation: request, status: 'pending' }
      },
      finishSetupConfirmation(state, request, outcome) {
        if (state.setup?.confirmation?.setupId !== request.setupId
          || state.setup.confirmation.operationId !== request.operationId) return
        state.setup = { preview: state.setup.preview, confirmation: request, ...outcome }
      },
      setupConfirming(state, setupId) {
        if (state.setup?.preview.setupId !== setupId) return
        state.setup = { ...state.setup, status: 'confirming' }
      },
      clearSetup(state, setupId) { if (state.setup?.preview.setupId === setupId) delete state.setup },
    },
  })
}

/** @param result - durable account mutation. @returns normalized UI outcome. */
export function accountMutationOutcome(result: ImAccountMutationResult): AccountActionOutcome {
  return {
    status: result.status === 'unchanged' ? 'applied' : result.status,
    ...result.message === undefined ? {} : { message: result.message },
  }
}

/** @param error - generated Remote failure. @returns whether retry requires receipt reconciliation. */
export function accountFailureOutcome(error: { readonly code: string; readonly message: string }): AccountActionOutcome {
  const rejected = error.code === 'im/configuration' || error.code === 'gateway/input-invalid'
    || error.code === 'gateway/arguments-invalid' || error.code === 'gateway/service-unavailable'
    || error.code === 'gateway/definition-unavailable' || error.code === 'gateway/method-unavailable'
    || error.code === 'gateway/invocation-unavailable'
  return { status: rejected ? 'rejected' : 'unknown', message: error.message }
}

/** @param result - authoritative command acknowledgement. @returns known business outcome or a requirement to query before retrying. */
export function accountOutcome(result: Awaited<ReturnType<IImClient['setAccountPaused']>>): AccountActionOutcome {
  return result.ok ? accountMutationOutcome(result.value) : accountFailureOutcome(result.error)
}
