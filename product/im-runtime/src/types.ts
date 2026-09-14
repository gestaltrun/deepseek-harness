/** Client-safe identifiers, views, and mutation requests for the IM runtime. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Identifier minted by the Host for one configured account. */
export type ImAccountId = Branded<'ImAccountId'>
/** Identifier minted by the Host for one route lifecycle. */
export type ImRouteId = Branded<'ImRouteId'>
/** Caller-minted idempotency identifier for one configuration mutation. */
export type ImOperationId = Branded<'ImOperationId'>
/** Opaque token replaced by every successful aggregate mutation. */
export type ImRevision = Branded<'ImRevision'>

/** Supported product IM platforms. */
export type ImPlatform = 'dingtalk' | 'wangwang'
/** Supported conversation categories. */
export type ImConversationKind = 'direct' | 'group'

/** Safe DingTalk employee identity returned by the registered transport. */
export interface ImDingTalkIdentity {
  readonly platform: 'dingtalk'
  readonly profile: string
  readonly corpId: string
  readonly userId: string
  readonly displayName: string
}

/** Safe Wangwang merchant identity returned by the registered transport. */
export interface ImWangwangIdentity {
  readonly platform: 'wangwang'
  readonly merchantId: string
  readonly displayName: string
  readonly mainServiceAccountId?: string
}

/** Platform identity safe to persist and project to clients. */
export type ImAccountIdentity = ImDingTalkIdentity | ImWangwangIdentity

/** Durable authorization fact. It never implies a listener is running. */
export type ImAccountAuthorization =
  | { readonly state: 'unchecked' }
  | { readonly state: 'ready'; readonly checkedAt: string }
  | { readonly state: 'required'; readonly reason: 'missing' | 'expired' | 'revoked'; readonly checkedAt?: string }
  | { readonly state: 'failed'; readonly code: string; readonly message: string; readonly checkedAt: string }

/** Process listener state projected separately from authorization. */
export type ImAccountListener =
  | { readonly state: 'stopped'; readonly reason: 'no-enabled-route' | 'account-paused' | 'disconnected' | 'manual' }
  | { readonly state: 'starting'; readonly since: string }
  | { readonly state: 'running'; readonly readyAt: string; readonly lastEventAt?: string }
  | { readonly state: 'reconnecting'; readonly attempt: number; readonly since: string; readonly lastError: string }
  | { readonly state: 'failed'; readonly attempts: number; readonly lastError: string }

/** Safe account projection. Secret values never have a field in this value. */
export interface ImAccountView {
  readonly id: ImAccountId
  readonly platform: ImPlatform
  readonly displayName: string
  readonly identity: ImAccountIdentity
  readonly credentialKey?: CredentialKey
  readonly authorization: ImAccountAuthorization
  readonly listener: ImAccountListener
  readonly paused: boolean
  readonly revision: ImRevision
  readonly createdAt: string
  readonly updatedAt: string
}

/** Match every conversation of one account and category, including future conversations. */
export interface ImAllConversationsTarget { readonly kind: 'all' }
/** Match one provider conversation identifier. */
export interface ImSpecificConversationTarget { readonly kind: 'specific'; readonly conversationId: string }
/** Conversation selection component of a route tuple. */
export type ImRouteTarget = ImAllConversationsTarget | ImSpecificConversationTarget

/** OR-combined group activation settings. Numeric conditions are positive integers. */
export interface ImGroupTrigger {
  readonly mention?: boolean
  readonly everyN?: number
  readonly fixedIntervalSeconds?: number
}

/** Complete route tuple and its bound workspace. */
export interface ImRouteView {
  readonly id: ImRouteId
  readonly platform: ImPlatform
  readonly accountId: ImAccountId
  readonly conversationKind: ImConversationKind
  readonly target: ImRouteTarget
  readonly workspaceId: WorkspaceId
  readonly enabled: boolean
  readonly groupTrigger?: ImGroupTrigger
  readonly revision: ImRevision
  readonly createdAt: string
  readonly updatedAt: string
}

/** Input that creates one route under an existing account aggregate. */
export interface ImCreateRouteRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly conversationKind: ImConversationKind
  readonly target: ImRouteTarget
  readonly workspaceId: WorkspaceId
  readonly enabled: boolean
  readonly groupTrigger?: ImGroupTrigger
}

/** Input that edits route behavior without changing its workspace owner. */
export interface ImSaveRouteRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly observedRevision: ImRevision
  readonly enabled: boolean
  readonly groupTrigger?: ImGroupTrigger
}

/** Explicit route ownership transfer guarded by both observed values. */
export interface ImRebindRouteRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly observedRevision: ImRevision
  readonly observedWorkspaceId: WorkspaceId
  readonly workspaceId: WorkspaceId
}

/** Route deletion guarded by the current lifecycle and workspace owner. */
export interface ImDeleteRouteRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly observedRevision: ImRevision
  readonly observedWorkspaceId: WorkspaceId
}

/** Stable mutation outcome stored with the account aggregate. */
export interface ImRouteMutationResult {
  readonly operationId: ImOperationId
  readonly status: 'applied' | 'unchanged' | 'conflict' | 'rejected'
  readonly route?: ImRouteView
  readonly deletedRevision?: ImRevision
  readonly code?: string
  readonly message?: string
}

/** Query result distinguishing an unknown operation from its durable receipt. */
export type ImRouteOperationQuery =
  | { readonly state: 'not-found' }
  | { readonly state: 'known'; readonly result: ImRouteMutationResult }

/** Account pause mutation guarded by the account revision. */
export interface ImSetAccountPausedRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly observedRevision: ImRevision
  readonly paused: boolean
}

/** Stable account mutation outcome. */
export interface ImAccountMutationResult {
  readonly operationId: ImOperationId
  readonly status: 'applied' | 'unchanged' | 'conflict' | 'rejected'
  readonly account: ImAccountView
  readonly code?: string
  readonly message?: string
}

/** Configured route used when a workspace opens a channel simulation. */
export interface ImSimulationTargetView {
  readonly workspaceId: WorkspaceId
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly revision: ImRevision
  readonly updatedAt: string
}

/** Save or replace a simulation target with absent-or-current CAS. */
export interface ImSaveSimulationTargetRequest {
  readonly operationId: ImOperationId
  readonly workspaceId: WorkspaceId
  readonly observedRevision: ImRevision | null
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
}

/** Remove a simulation target guarded by its current revision. */
export interface ImRemoveSimulationTargetRequest {
  readonly operationId: ImOperationId
  readonly workspaceId: WorkspaceId
  readonly observedRevision: ImRevision
}

/** Stable simulation-target mutation outcome. */
export interface ImSimulationTargetMutationResult {
  readonly operationId: ImOperationId
  readonly status: 'applied' | 'unchanged' | 'conflict' | 'rejected'
  readonly target?: ImSimulationTargetView
  readonly deletedRevision?: ImRevision
  readonly code?: string
  readonly message?: string
}

/** Query result for one durable simulation-target operation. */
export type ImSimulationTargetOperationQuery =
  | { readonly state: 'not-found' }
  | { readonly state: 'known'; readonly result: ImSimulationTargetMutationResult }

/** Current durable configuration with a process-generation revision. */
export interface ImRuntimeSnapshot {
  readonly revision: number
  readonly accounts: readonly ImAccountView[]
  readonly routes: readonly ImRouteView[]
  readonly simulationTargets: readonly ImSimulationTargetView[]
}

/** Post-commit configuration change notification. */
export interface ImRuntimeChange {
  readonly revision: number
  readonly kind: 'account' | 'route' | 'simulation-target'
  readonly accountId?: ImAccountId
  readonly routeId?: ImRouteId
  readonly workspaceId?: WorkspaceId
  readonly operationId?: ImOperationId
}

/** Result of resolving the precedence-ordered routes for one inbound conversation. */
export type ImRouteResolution =
  | { readonly state: 'matched'; readonly route: ImRouteView }
  | { readonly state: 'disabled'; readonly route: ImRouteView }
  | { readonly state: 'account-paused' }
  | { readonly state: 'unmatched' }

declare module '@deepseek-ai/cordis' {
  interface Context {
    imRuntime: ImRuntimeService
  }
  interface Events {
    /**
     * Durable IM configuration changed. The emitted revision is newer than every prior event from this process.
     * @param change - committed configuration subject and generation revision.
     * @mode emit
     */
    'imRuntime/changed'(change: ImRuntimeChange): void
  }
}

/** Read and mutation surface consumed by the product BFF. */
export interface ImRuntimeService {
  /** @returns the current durable configuration projection. */
  snapshot(): ImRuntimeSnapshot
  /** @param listener - post-commit change observer. @returns disposer for this subscription. */
  subscribe(listener: (change: ImRuntimeChange) => void): () => void
  /** @param accountId - receiving account. @param conversationKind - provider category. @param conversationId - provider conversation. @returns precedence-ordered route resolution. */
  resolveRoute(accountId: ImAccountId, conversationKind: ImConversationKind, conversationId: string): ImRouteResolution
  /** @param request - transport-owned account setup input. @param signal - caller lifetime. @returns the persisted safe account. */
  addAccount(request: import('./transport.ts').ImAccountSetupRequest, signal?: AbortSignal): Promise<ImAccountView>
  /** @param request - guarded account pause mutation. @returns its durable outcome. */
  setAccountPaused(request: ImSetAccountPausedRequest): Promise<ImAccountMutationResult>
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
}
