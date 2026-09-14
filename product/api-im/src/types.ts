/** IM Remote payloads reuse the runtime's public configuration records. */
import type {
  ImAccountId, ImCreateRouteRequest, ImDeleteRouteRequest, ImOperationId,
  ImRebindRouteRequest, ImRouteMutationResult, ImRuntimeSnapshot, ImSaveRouteRequest,
} from '@gestaltrun/dsh-im-runtime'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export type * from '@gestaltrun/dsh-im-runtime'

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

/** Workspace aggregate and operation identity required for target reconciliation. */
export interface ImTargetOperationQueryRequest {
  readonly workspaceId: WorkspaceId
  readonly operationId: ImOperationId
}
