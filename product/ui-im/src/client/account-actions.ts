/** Account operation drafts retain the exact observed revision and uncertain operation identity. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { IImClient, ImAccountId, ImAccountLifecycleRequest, ImOperationId, ImSetAccountPausedRequest } from '@gestaltrun/dsh-api-im/client'

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

type AccountUiState = { operations: Record<string, AccountActionState | undefined> }
type AccountUiActions = {
  begin: (state: AccountUiState, action: AccountAction) => void
  finish: (state: AccountUiState, accountId: ImAccountId, operationId: ImOperationId, outcome: AccountActionOutcome) => void
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
    },
  })
}

/** @param result - authoritative command acknowledgement. @returns known business outcome or a requirement to query before retrying. */
export function accountOutcome(result: Awaited<ReturnType<IImClient['setAccountPaused']>>): AccountActionOutcome {
  if (result.ok) return {
    status: result.value.status === 'unchanged' ? 'applied' : result.value.status,
    ...result.value.message === undefined ? {} : { message: result.value.message },
  }
  const code = result.error.code
  const rejected = code === 'im/configuration' || code === 'gateway/input-invalid'
    || code === 'gateway/arguments-invalid' || code === 'gateway/service-unavailable'
    || code === 'gateway/definition-unavailable' || code === 'gateway/method-unavailable'
    || code === 'gateway/invocation-unavailable'
  return { status: rejected ? 'rejected' : 'unknown', message: result.error.message }
}
