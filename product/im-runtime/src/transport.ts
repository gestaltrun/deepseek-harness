/** Provider-facing IM transport capability registered with the runtime. */
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ImDeliveryOperationId,
  ImInboundMessageInput,
  ImInboundPageResult,
  ImInboundSenderEvidence,
  ImProviderCursorCommitResult,
  ImProviderCursorOwner,
} from './delivery-types.ts'
import type { ImAccountCandidate, ImAccountIdentity, ImAccountSetupRequest, ImAccountView, ImConversationKind, ImDirectRecipient, ImPlatform, ImRevision, ImRouteId, ImRouteTarget } from './types.ts'
export type { ImAccountSetupRequest, ImDingTalkAccountSetupRequest, ImWangwangAccountSetupRequest } from './types.ts'

/** Safe provider result plus an optional opaque credential record for durable storage. */
export interface ImPreparedAccount { readonly displayName: string; readonly identity: ImAccountIdentity; readonly authorization: ImAccountView['authorization']; readonly credentialRecord?: CredentialRecord }
/** Safe conversation candidate returned for route configuration. */
export interface ImConversationCandidate { readonly conversationId: string; readonly conversationKind: ImConversationKind; readonly displayName: string; readonly directRecipient?: ImDirectRecipient }
/** Provider page of conversation candidates. */
export interface ImConversationCandidatePage { readonly items: readonly ImConversationCandidate[]; readonly cursor?: string }
/** Authorization facts observed by a provider without changing the configured identity. */
export interface ImTransportAccountInspection { readonly authorization: ImAccountView['authorization'] }
/** Provider message before the runtime classifies sender evidence. */
export interface ImTransportInboundMessage {
  readonly externalMessageId: string
  readonly senderEvidence: ImInboundSenderEvidence
  readonly text: string
  readonly format: ImInboundMessageInput['content']['format']
  readonly occurredAt: string
  /** True only when the provider protocol identifies this configured account in its mention metadata. */
  readonly mentionedConfiguredAccount?: boolean
}
/** One conversation group within a provider-owned receive page. */
export interface ImTransportConversationPage {
  readonly operationId: ImDeliveryOperationId
  readonly conversationId: string
  readonly conversationKind: ImConversationKind
  readonly messages: readonly ImTransportInboundMessage[]
}
/** One provider page that may span multiple conversations. */
export interface ImTransportInboundPage {
  readonly operationId: ImDeliveryOperationId
  readonly owner: ImProviderCursorOwner
  readonly observedCursor: string | null
  readonly nextCursor: string | null
  readonly conversations: readonly ImTransportConversationPage[]
}
/** Durable per-conversation receipts followed by the provider-cursor result. */
export interface ImTransportInboundPageReceipt {
  readonly conversations: readonly ImInboundPageResult[]
  readonly cursor: ImProviderCursorCommitResult
}
/** Enabled route facts needed to choose provider subscriptions and evidence feeds. */
export interface ImTransportRoutePlan {
  readonly routeId: ImRouteId
  readonly routeRevision: ImRevision
  readonly conversationKind: ImConversationKind
  readonly target: ImRouteTarget
  readonly needsMentionEvidence: boolean
}
/** Listener plan computed from the account's enabled routes. */
export interface ImTransportListenPlan { readonly routes: readonly ImTransportRoutePlan[] }
/** Sink owned by the runtime while a provider listener is active. */
export interface ImTransportSink {
  /**
   * Persist every conversation group before advancing the provider-owned cursor.
   * A partial failure leaves successful groups durable so a replay can deduplicate them.
   * @param page - stable provider/page identities, cursor CAS, and normalized groups.
   * @returns every durable group receipt and the final cursor result.
   */
  receivePage(page: ImTransportInboundPage): Promise<ImTransportInboundPageReceipt>
}
/** Provider outbound request. */
export interface ImTransportSendRequest { readonly account: ImAccountView; readonly conversationId: string; readonly conversationKind: ImConversationKind; readonly directRecipient?: ImDirectRecipient; readonly requestId: string; readonly text: string }
/** Provider send outcome before or after receipt confirmation. */
export type ImTransportSendResult =
  | { readonly state: 'sent'; readonly externalMessageId: string; readonly rawStatus?: string }
  | { readonly state: 'failed'; readonly code: string; readonly message: string }
  | { readonly state: 'unknown'; readonly externalMessageId?: string }
/** Receipt lookup input for an uncertain outbound result. */
export interface ImTransportConfirmRequest { readonly account: ImAccountView; readonly requestId: string; readonly externalMessageId?: string }

/** Complete provider capability registered under one platform. */
export interface ImTransport {
  readonly platform: ImPlatform
  /** @param signal - caller lifetime. @returns installed or admitted identities safe for account selection. */
  listAccountCandidates(signal: AbortSignal): Promise<readonly ImAccountCandidate[]>
  /** @param request - write-only setup input. @param signal - caller lifetime. @returns verified safe facts and credential payload. */
  prepareAccount(request: ImAccountSetupRequest, signal: AbortSignal): Promise<ImPreparedAccount>
  /** @param account - configured safe identity. @param signal - caller lifetime. @returns current provider authorization facts. */
  inspectAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection>
  /** @param account - configured safe identity. @param signal - caller lifetime. @returns refreshed authorization facts. */
  refreshAccount(account: ImAccountView, signal: AbortSignal): Promise<ImTransportAccountInspection>
  /** @param account - safe configured account. @param cursor - provider cursor. @param signal - caller lifetime. @returns one candidate page. */
  discoverConversations(account: ImAccountView, cursor: string | undefined, signal: AbortSignal): Promise<ImConversationCandidatePage>
  /** @param account - account to listen on. @param plan - enabled routes and required provider evidence. @param sink - runtime-owned durable sink. @param signal - listener lifetime. @returns disposer only after the provider has established and verified the usable listener. */
  listen(account: ImAccountView, plan: ImTransportListenPlan, sink: ImTransportSink, signal: AbortSignal): Promise<() => Promise<void>>
  /** @param request - normalized outbound request. @param signal - caller lifetime. @returns provider result. */
  send(request: ImTransportSendRequest, signal: AbortSignal): Promise<ImTransportSendResult>
  /** @param request - uncertain delivery to inspect. @param signal - caller lifetime. @returns current provider result. */
  confirm(request: ImTransportConfirmRequest, signal: AbortSignal): Promise<ImTransportSendResult>
}
