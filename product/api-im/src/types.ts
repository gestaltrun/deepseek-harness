/** IM Remote payloads reuse the runtime's public configuration records. */
import type {
  ImAccountId, ImCreateRouteRequest, ImDeleteRouteRequest, ImOperationId,
  ImRebindRouteRequest, ImRouteMutationResult, ImRuntimeSnapshot, ImSaveRouteRequest,
  ImDeliveryScope, ImConversationCursor, ImHistoryPage, ImOutboundPage,
} from '@gestaltrun/dsh-im-runtime/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type * from '@gestaltrun/dsh-im-runtime/types'

/** Stable configuration failure details, with no provider exception payload. */
export interface ImConfigurationFailure {
  readonly code: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A documented runtime or provider-registry configuration failure. */
    'im/configuration': ImConfigurationFailure
  }
}

/** Complete configuration at the beginning of one follow generation. */
export interface ImConfigurationBaseline {
  readonly type: 'baseline'
  readonly sequence: number
  readonly value: ImRuntimeSnapshot
}

/** Coalesced complete configuration after one or more committed changes. */
export interface ImConfigurationReplacement {
  readonly type: 'replace'
  readonly sequence: number
  readonly value: ImRuntimeSnapshot
}

/** One ordered frame in a configuration follow generation. */
export type ImConfigurationFrame = ImConfigurationBaseline | ImConfigurationReplacement

/** Bounded latest history window for one complete conversation identity. */
export interface ImDeliveryFollowRequest {
  readonly scope: ImDeliveryScope
  readonly limit: number
  readonly inboundBeforeSequenceNumber?: number
  readonly outboundBeforeSequenceNumber?: number
}

/** Latest inbound and outbound pages; numeric cursors remain independent. */
export interface ImDeliverySnapshot {
  readonly scope: ImDeliveryScope
  readonly cursor: ImConversationCursor
  readonly inbound: ImHistoryPage
  readonly outbound: ImOutboundPage
}

/** Opening or replacement delivery window within one follow generation. */
export type ImDeliveryFollowFrame =
  | { readonly type: 'baseline'; readonly sequence: number; readonly value: ImDeliverySnapshot }
  | { readonly type: 'replace'; readonly sequence: number; readonly value: ImDeliverySnapshot }

/** Explicit operation intent; only rebind carries a new owner for an existing route. */
export type ImRouteOperation =
  | { readonly kind: 'create'; readonly request: ImCreateRouteRequest }
  | { readonly kind: 'save'; readonly request: ImSaveRouteRequest }
  | { readonly kind: 'rebind'; readonly request: ImRebindRouteRequest }
  | { readonly kind: 'delete'; readonly request: ImDeleteRouteRequest }

/** Independent route operations submitted from one editor draft. */
export interface ImRouteBatchRequest {
  readonly operations: readonly ImRouteOperation[]
}

/** Each route's own durable receipt, or a requirement to query before retrying. */
export type ImRouteBatchItem =
  | { readonly state: 'known'; readonly accountId: ImAccountId; readonly result: ImRouteMutationResult }
  | { readonly state: 'rejected'; readonly accountId: ImAccountId; readonly operationId: ImOperationId; readonly code: string; readonly message: string }
  | { readonly state: 'unknown'; readonly accountId: ImAccountId; readonly operationId: ImOperationId }

/** A batch does not promise atomicity across targets or accounts. */
export interface ImRouteBatchResult {
  readonly items: readonly ImRouteBatchItem[]
}

/** Account aggregate and operation identity required for receipt reconciliation. */
export interface ImRouteOperationQueryRequest {
  readonly accountId: ImAccountId
  readonly operationId: ImOperationId
}

/** Account aggregate and operation identity required for lifecycle receipt reconciliation. */
export interface ImAccountOperationQueryRequest {
  readonly accountId: ImAccountId
  readonly operationId: ImOperationId
}

/** Workspace aggregate and operation identity required for target reconciliation. */
export interface ImTargetOperationQueryRequest {
  readonly workspaceId: WorkspaceId
  readonly operationId: ImOperationId
}
