/** Provider-facing IM transport capability registered with the runtime. */
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ImAccountCandidate, ImAccountIdentity, ImAccountSetupRequest, ImAccountView, ImConversationKind, ImPlatform } from './types.ts'
export type { ImAccountSetupRequest, ImDingTalkAccountSetupRequest, ImWangwangAccountSetupRequest } from './types.ts'

/** Safe provider result plus an optional opaque credential record for durable storage. */
export interface ImPreparedAccount { readonly displayName: string; readonly identity: ImAccountIdentity; readonly authorization: ImAccountView['authorization']; readonly credentialRecord?: CredentialRecord }
/** Safe conversation candidate returned for route configuration. */
export interface ImConversationCandidate { readonly conversationId: string; readonly conversationKind: ImConversationKind; readonly displayName: string }
/** Provider page of conversation candidates. */
export interface ImConversationCandidatePage { readonly items: readonly ImConversationCandidate[]; readonly cursor?: string }
/** Normalized provider inbound event. */
export interface ImTransportInbound { readonly externalMessageId: string; readonly conversationId: string; readonly conversationKind: ImConversationKind; readonly senderId: string; readonly senderName?: string; readonly text: string; readonly receivedAt: string; readonly cursor?: string }
/** Sink owned by the runtime while a provider listener is active. */
export interface ImTransportSink { /** @param message - normalized inbound event. @returns resolution after durable admission. */ receive(message: ImTransportInbound): Promise<void> }
/** Provider outbound request. */
export interface ImTransportSendRequest { readonly account: ImAccountView; readonly conversationId: string; readonly conversationKind: ImConversationKind; readonly requestId: string; readonly text: string }
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
  /** @param account - safe configured account. @param cursor - provider cursor. @param signal - caller lifetime. @returns one candidate page. */
  discoverConversations(account: ImAccountView, cursor: string | undefined, signal: AbortSignal): Promise<ImConversationCandidatePage>
  /** @param account - account to listen on. @param sink - runtime-owned durable sink. @param signal - listener lifetime. @returns disposer after readiness. */
  listen(account: ImAccountView, sink: ImTransportSink, signal: AbortSignal): Promise<() => Promise<void>>
  /** @param request - normalized outbound request. @param signal - caller lifetime. @returns provider result. */
  send(request: ImTransportSendRequest, signal: AbortSignal): Promise<ImTransportSendResult>
  /** @param request - uncertain delivery to inspect. @param signal - caller lifetime. @returns current provider result. */
  confirm(request: ImTransportConfirmRequest, signal: AbortSignal): Promise<ImTransportSendResult>
}
