/** Plain callback and observable inputs assembled by the IM UI plugin. */
import type {
  IImClient, ImAccountLifecycleRequest, ImAccountMutationResult, ImAccountOperationQueryRequest, ImAccountSetupId,
  ImAccountSetupPreview, ImAccountSetupRequest, ImCancelAccountSetupResult,
  ImConfirmAccountSetupRequest, ImOperationId, ImSetAccountPausedRequest,
  ImAccountCandidatesSource, ImConfigurationSource, ImPlatform,
  ImCreateSimulationInstanceRequest, ImDeliveryFollowRequest, ImDeliverySource,
  ImInjectSimulationManagedHumanRequest, ImInjectSimulationMemberRequest,
  ImSimulationInstanceId, ImSimulationInstanceView, ImSimulationSessionSource,
  ImRealSessionSource, ImSendManualMessageRequest, ImManualMessageResult, ImManualMessageQueryRequest,
  ImManualMessageQuery, ImRetryManualMessageRequest, ImImportSimulationHistoryRequest, ImImportSimulationHistoryResult,
} from '@gestaltrun/dsh-api-im/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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

/** Session-scoped simulation and delivery bindings for the IM sidebar. */
export interface ConversationFace {
  readonly hooks: { readonly configuration: ImConfigurationSource }
  readonly watchSession: (sessionId: SessionId) => ImSimulationSessionSource
  readonly watchRealSession: (sessionId: SessionId) => ImRealSessionSource
  readonly watchDelivery: (request: ImDeliveryFollowRequest) => ImDeliverySource
  readonly create: (request: ImCreateSimulationInstanceRequest) => Promise<UiResult<ImSimulationInstanceView>>
  readonly injectMember: (request: ImInjectSimulationMemberRequest) => Promise<UiResult<unknown>>
  readonly injectManagedHuman: (request: ImInjectSimulationManagedHumanRequest) => Promise<UiResult<unknown>>
  readonly beginStop: (instanceId: ImSimulationInstanceId) => Promise<UiResult<ImSimulationInstanceView>>
  readonly waitStopped: (instanceId: ImSimulationInstanceId) => Promise<UiResult<ImSimulationInstanceView>>
  readonly resolveSession: (sessionId: SessionId) => Promise<UiResult<ImSimulationInstanceView | undefined>>
  readonly sendManual: (request: ImSendManualMessageRequest) => Promise<UiResult<ImManualMessageResult>>
  readonly queryManual: (request: ImManualMessageQueryRequest) => Promise<UiResult<ImManualMessageQuery>>
  readonly confirmManual: (request: ImManualMessageQueryRequest) => Promise<UiResult<ImManualMessageResult>>
  readonly retryManual: (request: ImRetryManualMessageRequest) => Promise<UiResult<ImManualMessageResult>>
  readonly importHistory: (request: ImImportSimulationHistoryRequest) => Promise<UiResult<ImImportSimulationHistoryResult>>
  readonly setPaused: (request: ImSetAccountPausedRequest) => Promise<UiResult<ImAccountMutationResult>>
  readonly operationId: () => ImOperationId
  readonly openSession: (sessionId: SessionId) => void
}

/** @param im - authoritative Client object. @param openSession - official Session navigator. @returns sidebar inputs. */
export function conversationFace(im: IImClient, operationId: () => ImOperationId, openSession: (sessionId: SessionId) => void): ConversationFace {
  const result = async <Value>(pending: Promise<{ readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: { readonly message: string } }>): Promise<UiResult<Value>> => {
    const settled = await pending
    return settled.ok ? { ok: true, value: settled.value } : { ok: false, message: settled.error.message }
  }
  return {
    hooks: { configuration: im.configuration },
    watchSession: sessionId => im.watchSimulationSession(sessionId),
    watchRealSession: sessionId => im.watchRealSession(sessionId),
    watchDelivery: request => im.watchDelivery(request),
    create: request => result(im.createSimulationInstance(request)),
    injectMember: request => result(im.injectSimulationMember(request)),
    injectManagedHuman: request => result(im.injectSimulationManagedHuman(request)),
    beginStop: instanceId => result(im.beginStopSimulation(instanceId)),
    waitStopped: instanceId => result(im.waitSimulationStopped(instanceId)),
    sendManual: request => result(im.sendManualMessage(request)),
    queryManual: request => result(im.queryManualMessage(request)),
    confirmManual: request => result(im.confirmManualMessage(request)),
    retryManual: request => result(im.retryManualMessage(request)),
    importHistory: request => result(im.importSimulationHistory(request)),
    setPaused: request => result(im.setAccountPaused(request)),
    operationId,
    resolveSession: async sessionId => {
      const scope = await result(im.scopeForSession(sessionId))
      return !scope.ok || scope.value === undefined
        ? scope.ok ? { ok: true, value: undefined } : scope
        : result(im.getSimulationInstance(scope.value.instanceId))
    },
    openSession,
  }
}
