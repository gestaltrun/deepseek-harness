/** Host service and event declarations kept out of the client-safe DTO entry. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ImBeginOutboundAttemptRequest,
  ImBeginOutboundAttemptResult,
  ImAgentTaskView,
  ImCancelPendingAiRequest,
  ImCommitProviderCursorRequest,
  ImConversationCursor,
  ImDeliveryChange,
  ImDeliveryOperationId,
  ImDeliveryScope,
  ImGetOutboundRequest,
  ImHistoryPage,
  ImHistoryQueryRequest,
  ImImportJsonlHistoryRequest,
  ImImportJsonlHistoryResult,
  ImInboundMessageView,
  ImInboundSenderEvidence,
  ImInboundOperationQuery,
  ImInboundPageResult,
  ImIngestInboundPageRequest,
  ImMarkSubmittedRequest,
  ImMarkSubmittedResult,
  ImMessageId,
  ImMessageSource,
  ImOutboundPage,
  ImOutboundQueryRequest,
  ImOutboundView,
  ImPendingInboundRequest,
  ImProviderCursorCommitResult,
  ImProviderCursorOperationQuery,
  ImProviderCursorOwner,
  ImProviderCursorView,
  ImRealDeliveryScope,
  ImRegisterOutboundRequest,
  ImSettleOutboundAttemptRequest,
  ImSettleSimulationOutboundRequest,
  ImSessionReconciliationResult,
  ImSenderAttribution,
} from './delivery-types.ts'
import type {
  ImAccountId,
  ImAccountCandidate,
  ImAccountSetupId,
  ImAccountSetupPreview,
  ImCancelAccountSetupResult,
  ImConfirmAccountSetupRequest,
  ImAccountLifecycleRequest,
  ImAccountMutationResult,
  ImAccountOperationQuery,
  ImAccountSetupRequest,
  ImAccountView,
  ImConversationKind,
  ImCreateRouteRequest,
  ImDeleteRouteRequest,
  ImOperationId,
  ImPlatform,
  ImRebindRouteRequest,
  ImRemoveSimulationTargetRequest,
  ImRouteMutationResult,
  ImRouteOperationQuery,
  ImRouteResolution,
  ImRuntimeChange,
  ImRuntimeSnapshot,
  ImSaveRouteRequest,
  ImSaveSimulationTargetRequest,
  ImSetAccountPausedRequest,
  ImSimulationTargetMutationResult,
  ImSimulationTargetOperationQuery,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { imRuntime: ImRuntimeService }
  interface Events {
    /**
     * IM configuration or process listener state changed. The emitted revision is newer than every prior event from this process.
     * @param change - changed account, route, target, or listener and its process generation revision.
     * @mode emit
     */
    'imRuntime/changed'(change: ImRuntimeChange): void
    /**
     * Durable inbound, submission, or outbox state changed.
     * @param change - committed scope and affected message or request identities.
     * @mode emit
     */
    'imRuntime/delivery-changed'(change: ImDeliveryChange): void
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Stable IM identity used to reconcile a Session append with the delivery domain. */
    im: ImMessageSource
  }
}

/** Read and mutation surface consumed by the product BFF. */
export interface ImRuntimeService {
  /** @returns the current durable configuration projection. */
  snapshot(): ImRuntimeSnapshot
  /** @param listener - post-commit change observer. @returns disposer for this subscription. */
  subscribe(listener: (change: ImRuntimeChange) => void): () => void
  /** @param platform - provider whose installed or admitted identities are requested. @param signal - caller lifetime. @returns safe selectable candidates. */
  listAccountCandidates(platform: ImPlatform, signal?: AbortSignal): Promise<readonly ImAccountCandidate[]>
  /** @param request - candidate-bound write-only setup input. @param signal - caller lifetime. @returns safe verified facts and a short-lived Host setup identifier. */
  previewAccountSetup(request: ImAccountSetupRequest, signal?: AbortSignal): Promise<ImAccountSetupPreview>
  /** @param request - setup identifier and idempotency identifier. @returns the durable account-creation outcome. */
  confirmAccountSetup(request: ImConfirmAccountSetupRequest): Promise<ImAccountMutationResult>
  /** @param setupId - unconfirmed setup to release. @returns whether it was released or had already advanced. */
  cancelAccountSetup(setupId: ImAccountSetupId): ImCancelAccountSetupResult
  /** @param accountId - receiving account. @param conversationKind - provider category. @param conversationId - provider conversation. @returns precedence-ordered route resolution. */
  resolveRoute(accountId: ImAccountId, conversationKind: ImConversationKind, conversationId: string): ImRouteResolution
  /** @param request - candidate-bound setup input for non-interactive Host consumers. @param signal - caller lifetime. @returns the persisted safe account. */
  addAccount(request: ImAccountSetupRequest, signal?: AbortSignal): Promise<ImAccountView>
  /** @param request - guarded account pause mutation. @returns its durable outcome. */
  setAccountPaused(request: ImSetAccountPausedRequest): Promise<ImAccountMutationResult>
  /** @param request - guarded persistent disconnect intent. @returns its durable outcome. */
  disconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult>
  /** @param request - guarded persistent reconnect intent. @returns its durable outcome. */
  reconnectAccount(request: ImAccountLifecycleRequest): Promise<ImAccountMutationResult>
  /** @param request - guarded provider authorization refresh. @param signal - caller lifetime. @returns its durable outcome. */
  refreshAccount(request: ImAccountLifecycleRequest, signal?: AbortSignal): Promise<ImAccountMutationResult>
  /** @param accountId - owning account. @param operationId - idempotency identifier. @returns stored result or an explicit miss. */
  queryAccountOperation(accountId: ImAccountId, operationId: ImOperationId): ImAccountOperationQuery
  /** @param request - new route tuple and workspace owner. @returns its durable outcome. */
  createRoute(request: ImCreateRouteRequest): Promise<ImRouteMutationResult>
  /** @param request - guarded non-ownership route edit. @returns its durable outcome. */
  saveRoute(request: ImSaveRouteRequest): Promise<ImRouteMutationResult>
  /** @param request - guarded ownership transfer. @returns its durable outcome. */
  rebindRoute(request: ImRebindRouteRequest): Promise<ImRouteMutationResult>
  /** @param request - guarded route deletion. @returns its durable outcome. */
  deleteRoute(request: ImDeleteRouteRequest): Promise<ImRouteMutationResult>
  /** @param accountId - owning account. @param operationId - idempotency identifier. @returns stored result or an explicit miss. */
  queryRouteOperation(accountId: ImAccountId, operationId: ImOperationId): ImRouteOperationQuery
  /** @param request - guarded simulation-target save. @returns its durable outcome. */
  saveSimulationTarget(request: ImSaveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult>
  /** @param request - guarded simulation-target removal. @returns its durable outcome. */
  removeSimulationTarget(request: ImRemoveSimulationTargetRequest): Promise<ImSimulationTargetMutationResult>
  /** @param workspaceId - target-owning workspace. @param operationId - idempotency identifier. @returns stored result or an explicit miss. */
  querySimulationTargetOperation(workspaceId: WorkspaceId, operationId: ImOperationId): ImSimulationTargetOperationQuery
  /** @param listener - post-commit delivery observer. @returns disposer for this subscription. */
  subscribeDelivery(listener: (change: ImDeliveryChange) => void): () => void
  /** @param request - complete real scope, cursor CAS, and provider page. @returns durable page receipt. */
  ingestInboundPage(request: ImIngestInboundPageRequest): Promise<ImInboundPageResult>
  /** @param scope - complete conversation identity. @param operationId - page or import operation. @returns durable receipt or explicit miss. */
  queryInboundOperation(scope: ImDeliveryScope, operationId: ImDeliveryOperationId): ImInboundOperationQuery
  /** @param scope - complete conversation identity. @returns current live-delivery cursor. */
  getConversationCursor(scope: ImDeliveryScope): ImConversationCursor
  /** @param owner - platform account and provider feed identity. @returns current feed cursor without claiming conversation ownership. */
  getProviderCursor(owner: ImProviderCursorOwner): ImProviderCursorView
  /** @param request - feed cursor CAS and every durable conversation-page receipt. @returns stored cursor outcome. */
  commitProviderCursor(request: ImCommitProviderCursorRequest): Promise<ImProviderCursorCommitResult>
  /** @param owner - provider feed identity. @param operationId - uncertain cursor operation. @returns durable receipt or explicit miss. */
  queryProviderCursorOperation(owner: ImProviderCursorOwner, operationId: ImDeliveryOperationId): ImProviderCursorOperationQuery
  /** @param request - bounded history cursor and origin filter. @returns ascending message page. */
  queryHistory(request: ImHistoryQueryRequest): ImHistoryPage
  /** @param request - scope and maximum pending live messages. @returns oldest received rows. */
  pendingInbound(request: ImPendingInboundRequest): readonly ImInboundMessageView[]
  /** @param scope - complete conversation identity. @returns frozen Agent task assignment, or absence before admission. */
  getAgentTask(scope: ImDeliveryScope): ImAgentTaskView | undefined
  /** @param scope - complete conversation identity. @param messageId - stored inbound identity. @returns source for an existing Session user/message event. */
  messageSource(scope: ImDeliveryScope, messageId: ImMessageId): ImMessageSource
  /** @param scope - complete conversation identity. @param messageId - stored inbound identity. @returns identified Session user message with durable IM source. */
  sessionUserMessage(scope: ImDeliveryScope, messageId: ImMessageId): UserMessage
  /** @param sessionId - durable Session log to compare with pending delivery rows. @returns matched submissions and ignored stale evidence. */
  reconcileSession(sessionId: SessionId): Promise<ImSessionReconciliationResult>
  /** @param request - Session evidence for atomically submitted inbound rows. @returns committed rows and cursor. */
  markSubmitted(request: ImMarkSubmittedRequest): Promise<ImMarkSubmittedResult>
  /** @param request - query-only JSONL history and idempotency identity. @returns durable import receipt. */
  importJsonlHistory(request: ImImportJsonlHistoryRequest): Promise<ImImportJsonlHistoryResult>
  /** @param request - outbound intent persisted before any send. @returns durable safe outbox row. */
  registerOutbound(request: ImRegisterOutboundRequest): Promise<ImOutboundView>
  /** @param request - real scope and pending request. @returns sole attempt or durable block. */
  beginOutboundAttempt(request: ImBeginOutboundAttemptRequest): Promise<ImBeginOutboundAttemptResult>
  /** @param request - provider attempt and observed outcome. @returns settled outbox row. */
  settleOutboundAttempt(request: ImSettleOutboundAttemptRequest): Promise<ImOutboundView>
  /** @param request - simulation scope and local request. @returns locally sent outbox row. */
  settleSimulationOutbound(request: ImSettleSimulationOutboundRequest): Promise<ImOutboundView>
  /** @param request - complete scope and request identity. @returns outbox row or absence. */
  getOutbound(request: ImGetOutboundRequest): ImOutboundView | undefined
  /** @param request - bounded outbox history cursor. @returns ascending outbox page. */
  queryOutbound(request: ImOutboundQueryRequest): ImOutboundPage
  /** @param request - scope and terminal reason. @returns discarded automated rows. */
  cancelPendingAi(request: ImCancelPendingAiRequest): Promise<readonly ImOutboundView[]>
  /** @param scope - complete real scope. @param externalMessageId - provider message identity. @returns matching sent outbox evidence. */
  findSentOutbound(scope: ImRealDeliveryScope, externalMessageId: string): ImOutboundView | undefined
  /** @param scope - complete real conversation. @param evidence - provider actor or echo facts without message-text heuristics. @returns evidence-backed sender category. */
  classifyInboundSender(scope: ImRealDeliveryScope, evidence: ImInboundSenderEvidence): ImSenderAttribution
}
