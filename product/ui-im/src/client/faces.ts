/** Plain callback and observable inputs assembled by the IM UI plugin. */
import type {
  IImClient, ImAccountId, ImAccountSetupRequest, ImAccountView,
  ImAccountCandidatesSource, ImConfigurationSource, ImPlatform,
} from '@gestaltrun/dsh-api-im/client'

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
  /** Submit a pause change using the displayed account revision. */
  readonly setPaused: (account: ImAccountView, paused: boolean) => Promise<UiOutcome>
  /** Real lifecycle callbacks are absent while the provider exposes no corresponding operation. */
  readonly disconnect?: (accountId: ImAccountId) => Promise<UiOutcome>
  readonly reconnect?: (accountId: ImAccountId) => Promise<UiOutcome>
}

/** @param im - authoritative Client object. @param operationId - mutation id factory. @returns account settings inputs. */
export function accountFace(im: IImClient, operationId: () => Parameters<IImClient['setAccountPaused']>[0]['operationId']): AccountsFace {
  return {
    hooks: { configuration: im.configuration, candidates: im.accountCandidates },
    loadCandidates: async (platform, signal) => { await im.listAccountCandidates(platform, signal) },
    connect: async (request, signal) => {
      const result = await im.connectAccount(request, signal)
      return result.ok ? { ok: true } : { ok: false, message: result.error.message }
    },
    setPaused: async (account, paused) => {
      const result = await im.setAccountPaused({ operationId: operationId(), accountId: account.id, observedRevision: account.revision, paused })
      if (!result.ok) return { ok: false, message: result.error.message }
      return result.value.status === 'applied' || result.value.status === 'unchanged'
        ? { ok: true }
        : { ok: false, message: result.value.message ?? 'IM_ACCOUNT_CHANGED' }
    },
  }
}
