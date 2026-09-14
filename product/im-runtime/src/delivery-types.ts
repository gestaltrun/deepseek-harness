/** Client-safe IM delivery, history, cursor, and outbox values. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ImAccountId, ImPlatform, ImRevision, ImRouteId } from './types.ts'

/** Collision-safe identifier of one real or simulated conversation scope. */
export type ImScopeId = Branded<'ImScopeId'>
/** Stable identity of one inbound message. */
export type ImMessageId = Branded<'ImMessageId'>
/** Caller-owned identity of one inbound page or JSONL import. */
export type ImDeliveryOperationId = Branded<'ImDeliveryOperationId'>
/** Caller-owned idempotency identity of one outbound intent. */
export type ImOutboundRequestId = Branded<'ImOutboundRequestId'>
/** Host-minted identity of the sole platform send attempt for an intent. */
export type ImOutboundAttemptId = Branded<'ImOutboundAttemptId'>
/** Host-minted identity of a future local simulation instance. */
export type ImSimulationInstanceId = Branded<'ImSimulationInstanceId'>
/** Stable identity of one provider-owned polling or stream cursor. */
export type ImProviderCursorId = Branded<'ImProviderCursorId'>

/** Complete identity of a real platform conversation. */
export interface ImRealDeliveryScope {
  readonly kind: 'real'
  readonly platform: ImPlatform
  readonly accountId: ImAccountId
  readonly conversationKind: 'direct' | 'group'
  readonly conversationId: string
}

/** Complete identity of a simulation conversation. */
export interface ImSimulationDeliveryScope {
  readonly kind: 'simulation'
  readonly instanceId: ImSimulationInstanceId
  readonly platform: ImPlatform
  readonly accountId: ImAccountId
  readonly conversationKind: 'direct' | 'group'
  readonly conversationId: string
}

/** Real and simulated conversations share the same history and outbox methods. */
export type ImDeliveryScope = ImRealDeliveryScope | ImSimulationDeliveryScope

/** Provider evidence for an external participant. */
export interface ImExternalSenderAttribution {
  readonly kind: 'external'
  readonly senderId: string
  readonly senderDisplayName?: string
}

/** Provider evidence that the configured account spoke in its native client. */
export interface ImHumanNativeSenderAttribution {
  readonly kind: 'human-native'
  readonly accountId: ImAccountId
  readonly providerActorId: string
}

/** Durable outbox evidence that a human sent through DSH. */
export interface ImHumanDshSenderAttribution {
  readonly kind: 'human-dsh'
  readonly outboundRequestId: ImOutboundRequestId
}

/** Durable outbox evidence that an Agent reply was sent. */
export interface ImAiSenderAttribution {
  readonly kind: 'ai'
  readonly outboundRequestId: ImOutboundRequestId
}

/** Honest fallback when provider facts cannot establish an actor. */
export interface ImUnknownSenderAttribution {
  readonly kind: 'unknown'
  readonly reason: 'insufficient-evidence' | 'unmatched-self' | 'unmatched-echo' | 'provider-unknown'
  readonly observedSenderId?: string
}

/** Evidence-bearing sender classification. Text equality never establishes a kind. */
export type ImSenderAttribution =
  | ImExternalSenderAttribution
  | ImHumanNativeSenderAttribution
  | ImHumanDshSenderAttribution
  | ImAiSenderAttribution
  | ImUnknownSenderAttribution

/** Provider facts admitted before the runtime assigns a sender category. */
export type ImInboundSenderEvidence =
  | { readonly kind: 'external-actor'; readonly senderId: string; readonly senderDisplayName?: string }
  | { readonly kind: 'configured-native'; readonly providerActorId: string }
  | { readonly kind: 'configured-echo'; readonly externalMessageId: string; readonly observedSenderId?: string }
  | { readonly kind: 'configured-self'; readonly observedSenderId?: string }
  | { readonly kind: 'provider-unknown'; readonly observedSenderId?: string }

/** Text accepted from a provider, manual-send UI, or Agent outbox. */
export interface ImMessageContent {
  readonly text: string
  readonly format: 'text' | 'markdown' | 'unsupported'
}

/** One normalized inbound provider message before persistence. */
export interface ImInboundMessageInput {
  readonly externalMessageId: string
  readonly sender: ImSenderAttribution
  readonly content: ImMessageContent
  readonly occurredAt: string
  /** Provider-normalized evidence that this account was explicitly mentioned. */
  readonly mentionedConfiguredAccount?: boolean
}

/** Session attribution written with the existing durable `user/message` event. */
export interface ImMessageSource {
  readonly kind: 'im'
  readonly scopeId: ImScopeId
  readonly messageId: ImMessageId
  readonly sequenceNumber: number
}

/** Durable inbound row safe for history UI and model tools. */
export interface ImInboundMessageView {
  readonly messageId: ImMessageId
  readonly scopeId: ImScopeId
  readonly externalMessageId: string
  readonly sender: ImSenderAttribution
  readonly content: ImMessageContent
  readonly origin: 'live' | 'jsonl-import'
  readonly stage: 'received' | 'submitted'
  readonly sequenceNumber: number
  readonly occurredAt: string
  /** Provider-normalized evidence; message text is never parsed to infer a mention. */
  readonly mentionedConfiguredAccount?: boolean
  readonly receivedAt: string
  readonly submission?: { readonly sessionId: SessionId; readonly submittedAt: string }
}

/** Durable conversation progress. Imported history does not advance these live-delivery values. */
export interface ImConversationCursor {
  readonly scopeId: ImScopeId
  readonly platformCursor: string | null
  readonly lastReceivedSequenceNumber: number
  readonly lastSubmittedSequenceNumber: number
  readonly pendingCount: number
  readonly updatedAt: string
}

/** Atomic provider page admission request. */
export interface ImIngestInboundPageRequest {
  readonly operationId: ImDeliveryOperationId
  readonly scope: ImRealDeliveryScope
  readonly observedCursor: string | null
  readonly nextCursor: string | null
  readonly messages: readonly ImInboundMessageInput[]
}

/** Receipt stored with the conversation aggregate before a page call resolves. */
export interface ImInboundPageResult {
  readonly kind: 'page'
  readonly operationId: ImDeliveryOperationId
  readonly status: 'applied' | 'conflict'
  readonly acceptedCount: number
  readonly duplicateCount: number
  readonly messages: readonly ImInboundMessageView[]
  readonly cursor: ImConversationCursor
}

/** Provider cursor ownership stays separate from conversation scopes. */
export interface ImProviderCursorOwner {
  readonly platform: ImPlatform
  readonly accountId: ImAccountId
  /** Provider-defined feed identity, such as one admitted merchant inbox. */
  readonly streamId: string
}

/** One durable conversation-page receipt required before a provider cursor advances. */
export interface ImProviderCursorPageReceipt {
  readonly scope: ImRealDeliveryScope
  readonly operationId: ImDeliveryOperationId
}

/** Advance one provider cursor after every referenced conversation page is durable. */
export interface ImCommitProviderCursorRequest {
  readonly operationId: ImDeliveryOperationId
  readonly owner: ImProviderCursorOwner
  readonly observedCursor: string | null
  readonly nextCursor: string | null
  readonly pages: readonly ImProviderCursorPageReceipt[]
}

/** Durable provider cursor and its last verified page set. */
export interface ImProviderCursorView {
  readonly id: ImProviderCursorId
  readonly owner: ImProviderCursorOwner
  readonly cursor: string | null
  readonly updatedAt: string
}

/** Cursor CAS result; rejected results identify incomplete durable page evidence. */
export interface ImProviderCursorCommitResult {
  readonly operationId: ImDeliveryOperationId
  readonly status: 'applied' | 'unchanged' | 'conflict' | 'rejected'
  readonly cursor: ImProviderCursorView
  readonly code?: 'IM_PROVIDER_PAGE_NOT_DURABLE'
  readonly message?: string
}

/** Lookup result for an uncertain provider-cursor response. */
export type ImProviderCursorOperationQuery =
  | { readonly state: 'not-found' }
  | { readonly state: 'known'; readonly result: ImProviderCursorCommitResult }

/** Query-only JSONL import request. Imported rows never enter pending delivery. */
export interface ImImportJsonlHistoryRequest {
  readonly operationId: ImDeliveryOperationId
  readonly scope: ImDeliveryScope
  readonly jsonl: string
}

/** Durable JSONL import receipt. */
export interface ImImportJsonlHistoryResult {
  readonly kind: 'jsonl-import'
  readonly operationId: ImDeliveryOperationId
  readonly status: 'applied'
  readonly importedCount: number
  readonly duplicateCount: number
}

/** Durable inbound operation receipt. */
export type ImInboundOperationResult = ImInboundPageResult | ImImportJsonlHistoryResult

/** Lookup result used after the caller loses an ingest or import response. */
export type ImInboundOperationQuery =
  | { readonly state: 'not-found' }
  | { readonly state: 'known'; readonly result: ImInboundOperationResult }

/** Cursor-based history request. `beforeSequenceNumber` is exclusive. */
export interface ImHistoryQueryRequest {
  readonly scope: ImDeliveryScope
  readonly limit: number
  readonly beforeSequenceNumber?: number
  readonly origins?: readonly ImInboundMessageView['origin'][]
}

/** One ascending history page plus the cursor for an older page. */
export interface ImHistoryPage {
  readonly items: readonly ImInboundMessageView[]
  readonly hasMore: boolean
  readonly nextBeforeSequenceNumber?: number
}

/** Pending live inbound request for the future Agent pump. */
export interface ImPendingInboundRequest {
  readonly scope: ImDeliveryScope
  readonly limit: number
}

/** Mark Session-appended messages submitted without claiming a cross-log transaction. */
export interface ImMarkSubmittedRequest {
  readonly scope: ImDeliveryScope
  readonly messageIds: readonly ImMessageId[]
  readonly sessionId: SessionId
  readonly submittedAt?: string
}

/** Atomic submission result with current progress. */
export interface ImMarkSubmittedResult {
  readonly messages: readonly ImInboundMessageView[]
  readonly cursor: ImConversationCursor
}

/** Outbound author and policy category. */
export type ImOutboundIntent = 'ai' | 'human-manual'
/** Durable state of one outbound intent. */
export type ImOutboundStatus =
  | 'pending'
  | 'dispatching'
  | 'pre-send-failed'
  | 'sent'
  | 'result-unknown'
  | 'confirmed-failed'

/** Shared lifecycle terms used by recorded Session and delivery projections. */
export type ImMessageStage = 'received' | 'submitted' | 'sent'

/** Safe provider receipt facts. */
export interface ImOutboundReceipt {
  readonly providerReceiptId?: string
  readonly providerStatus?: string
  readonly errorCode?: string
  readonly observedAt: string
}

/** Frozen route identity for an automated real-platform reply. */
export interface ImOutboundRouteBinding {
  readonly routeId: ImRouteId
  readonly routeRevision: ImRevision
  readonly workspaceId: WorkspaceId
  /** Account generation prevents paused automated work from flushing after resume. */
  readonly accountRevision: ImRevision
}

/** Durable outbound intent and its sole send attempt. */
export interface ImOutboundView {
  readonly requestId: ImOutboundRequestId
  readonly scopeId: ImScopeId
  readonly intent: ImOutboundIntent
  readonly content: ImMessageContent
  readonly status: ImOutboundStatus
  /** Scope-local admission order, independent of timestamps. */
  readonly sequenceNumber: number
  readonly routeBinding?: ImOutboundRouteBinding
  readonly preSendFailureReason?: 'account-not-found' | 'platform-mismatch' | 'account-paused' | 'route-disabled' | 'route-unmatched' | 'route-changed' | 'cancelled'
  readonly attempt?: { readonly attemptId: ImOutboundAttemptId; readonly startedAt: string }
  readonly receipt?: ImOutboundReceipt
  readonly externalMessageId?: string
  readonly replyToExternalMessageId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Persist an outbound intent before any platform call. */
export interface ImRegisterOutboundRequest {
  readonly requestId: ImOutboundRequestId
  readonly scope: ImDeliveryScope
  readonly intent: ImOutboundIntent
  readonly content: ImMessageContent
  readonly replyToExternalMessageId?: string
}

/** Start the sole provider attempt after a fresh route-policy check. */
export interface ImBeginOutboundAttemptRequest {
  readonly scope: ImRealDeliveryScope
  readonly requestId: ImOutboundRequestId
}

/** Provider dispatch instruction or a durable reason not to call the platform. */
export type ImBeginOutboundAttemptResult =
  | { readonly state: 'ready'; readonly attemptId: ImOutboundAttemptId; readonly outbound: ImOutboundView }
  | { readonly state: 'blocked' | 'result-unknown'; readonly outbound: ImOutboundView }

/** Final or uncertain outcome of one provider attempt. */
export interface ImSettleOutboundAttemptRequest {
  readonly scope: ImRealDeliveryScope
  readonly requestId: ImOutboundRequestId
  readonly attemptId: ImOutboundAttemptId
  readonly status: 'sent' | 'result-unknown' | 'confirmed-failed'
  readonly receipt?: ImOutboundReceipt
  readonly externalMessageId?: string
}

/** Settle a simulation outbox locally without exposing a provider attempt. */
export interface ImSettleSimulationOutboundRequest {
  readonly scope: ImSimulationDeliveryScope
  readonly requestId: ImOutboundRequestId
}

/** Query one outbound intent with its full scope identity. */
export interface ImGetOutboundRequest {
  readonly scope: ImDeliveryScope
  readonly requestId: ImOutboundRequestId
}

/** Cursor-based outbound history request. */
export interface ImOutboundQueryRequest {
  readonly scope: ImDeliveryScope
  readonly limit: number
  readonly beforeSequenceNumber?: number
}

/** Ascending outbound page. */
export interface ImOutboundPage {
  readonly items: readonly ImOutboundView[]
  readonly hasMore: boolean
  readonly nextBeforeSequenceNumber?: number
}

/** Result of comparing one durable Session log with pending IM submissions. */
export interface ImSessionReconciliationResult {
  readonly sessionId: SessionId
  readonly submittedMessageIds: readonly ImMessageId[]
  readonly ignoredEvidenceCount: number
}

/** Explicitly discard still-pending automated sends without touching manual intents. */
export interface ImCancelPendingAiRequest {
  readonly scope: ImDeliveryScope
  readonly reason: NonNullable<ImOutboundView['preSendFailureReason']>
}

/** Post-commit delivery change for BFF feeds and provider pumps. */
export interface ImDeliveryChange {
  readonly sequence: number
  readonly scope: ImDeliveryScope
  readonly scopeId: ImScopeId
  readonly kind: 'inbound' | 'submitted' | 'outbound'
  readonly messageIds?: readonly ImMessageId[]
  readonly requestId?: ImOutboundRequestId
}
