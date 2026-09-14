/** Plain callback and observable inputs assembled by the IM UI plugin. */
import type {
  IImClient, ImAccountLifecycleRequest, ImAccountSetupRequest, ImOperationId, ImSetAccountPausedRequest,
  ImAccountCandidatesSource, ImConfigurationSource, ImPlatform,
} from '@gestaltrun/dsh-api-im/client'
import { accountOutcome, type AccountActionOutcome } from './account-actions.ts'

/** User operation acknowledgement; business state remains on its Client object. */
export type UiOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Account settings bindings, without a Context or a whole service object. */
export interface AccountsFace {
  readonly hooks: {
    readonly configuration: ImConfigurationSource
    readonly candidates: ImAccountCandidatesSource
  }
  /** Read installed or admitted account choices from the provider. */
  readonly loadCandidates: (platform: ImPlatform, signal: AbortSignal) => Promise<void>
  /** Persist write-only account setup after provider validation. */
  readonly connect: (request: ImAccountSetupRequest, signal: AbortSignal) => Promise<UiOutcome>
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
}

/** @param im - authoritative Client object. @param operationId - mutation id factory. @returns account settings inputs. */
export function accountFace(im: IImClient, operationId: () => Parameters<IImClient['setAccountPaused']>[0]['operationId']): AccountsFace {
  return {
    hooks: { configuration: im.configuration, candidates: im.accountCandidates },
    operationId,
    loadCandidates: async (platform, signal) => { await im.listAccountCandidates(platform, signal) },
    connect: async (request, signal) => {
      const result = await im.connectAccount(request, signal)
      return result.ok ? { ok: true } : { ok: false, message: result.error.message }
    },
    setPaused: async request => accountOutcome(await im.setAccountPaused(request)),
    disconnect: async request => accountOutcome(await im.disconnectAccount(request)),
    reconnect: async request => accountOutcome(await im.reconnectAccount(request)),
    refresh: async request => accountOutcome(await im.refreshAccount(request)),
  }
}
