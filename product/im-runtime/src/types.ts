/** Client-safe identifiers, views, and mutation requests for the IM runtime. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ImDeliveryOperationId, ImSimulationDeliveryScope, ImSimulationInstanceId } from './delivery-types.ts'

export type * from './delivery-types.ts'

/** Identifier minted by the Host for one configured account. */
export type ImAccountId = Branded<'ImAccountId'>
/** Identifier minted by the Host for one route lifecycle. */
export type ImRouteId = Branded<'ImRouteId'>
/** Caller-minted idempotency identifier for one configuration mutation. */
export type ImOperationId = Branded<'ImOperationId'>
/** Opaque token replaced by every successful aggregate mutation. */
export type ImRevision = Branded<'ImRevision'>
/** Host-minted identifier for one short-lived account setup attempt. */
export type ImAccountSetupId = Branded<'ImAccountSetupId'>

/** Supported product IM platforms. */
export type ImPlatform = 'dingtalk' | 'wangwang'
/** Supported conversation categories. */
export type ImConversationKind = 'direct' | 'group'

/** Installed DingTalk employee profile available for explicit account setup. */
export interface ImDingTalkAccountCandidate {
  readonly platform: 'dingtalk'
  readonly profile: string
  readonly displayName: string
}

/** Admitted Wangwang merchant available for explicit account setup. */
export interface ImWangwangAccountCandidate {
  readonly platform: 'wangwang'
  readonly candidateId: string
  readonly endpoint: string
  readonly displayName: string
  readonly merchantId?: string
}

/** Safe provider-discovered account candidate. */
export type ImAccountCandidate = ImDingTalkAccountCandidate | ImWangwangAccountCandidate

/** DingTalk employee-profile setup input. */
export interface ImDingTalkAccountSetupRequest {
  readonly platform: 'dingtalk'
  readonly profile: string
  readonly displayName?: string
}

/** Wangwang admitted-candidate setup input. Secret fields are write-only. */
export interface ImWangwangAccountSetupRequest {
  readonly platform: 'wangwang'
  readonly candidateId: string
  readonly endpoint: string
  readonly accessKeyId: string
  readonly accessKeySecret: string
  readonly displayName?: string
}

/** Client-safe account setup union dispatched by platform. */
export type ImAccountSetupRequest = ImDingTalkAccountSetupRequest | ImWangwangAccountSetupRequest

/** Safe verified facts returned before the caller confirms durable account creation. */
export interface ImAccountSetupPreview {
  readonly setupId: ImAccountSetupId
  readonly displayName: string
  readonly identity: ImAccountIdentity
  readonly authorization: ImAccountAuthorization
  readonly expiresAt: string
}

/** Idempotent confirmation of one Host-held setup attempt. */
export interface ImConfirmAccountSetupRequest {
  readonly setupId: ImAccountSetupId
  readonly operationId: ImOperationId
}

/** Result of releasing one unconfirmed setup attempt. */
export type ImCancelAccountSetupResult =
  | { readonly state: 'cancelled' }
  | { readonly state: 'not-found' }
  | { readonly state: 'confirming' }
  | { readonly state: 'confirmed'; readonly accountId: ImAccountId }

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

/** Durable operator intent; process listener facts are projected separately. */
export type ImAccountConnectionIntent = 'connected' | 'disconnected'

/** Process listener state projected separately from authorization. */
export type ImAccountListener =
  | { readonly state: 'stopped'; readonly reason: 'no-enabled-route' | 'account-paused' | 'authorization-required' | 'disconnected' | 'manual' }
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
  readonly connectionIntent: ImAccountConnectionIntent
  readonly paused: boolean
  readonly revision: ImRevision
  readonly createdAt: string
  readonly updatedAt: string
}

/** Match every conversation of one account and category, including future conversations. */
export interface ImAllConversationsTarget { readonly kind: 'all' }
/** Provider peer identifiers retained separately from the stable platform conversation id. */
export interface ImDirectRecipient {
  readonly providerActorId: string
  readonly userId?: string
  readonly openDingTalkId?: string
}
/** Match one provider conversation identifier and retain its direct-send peer when known. */
export interface ImSpecificConversationTarget { readonly kind: 'specific'; readonly conversationId: string; readonly directRecipient?: ImDirectRecipient }
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

/** Guarded disconnect, reconnect, or refresh account request. */
export interface ImAccountLifecycleRequest {
  readonly operationId: ImOperationId
  readonly accountId: ImAccountId
  readonly observedRevision: ImRevision
}

/** Stable account mutation outcome. */
export interface ImAccountMutationResult {
  readonly operationId: ImOperationId
  readonly status: 'applied' | 'unchanged' | 'conflict' | 'rejected'
  readonly account: ImAccountView
  readonly code?: string
  readonly message?: string
}

/** Query result distinguishing an unknown account operation from its durable receipt. */
export type ImAccountOperationQuery =
  | { readonly state: 'not-found' }
  | { readonly state: 'known'; readonly result: ImAccountMutationResult }

/** Configured route used when a workspace opens a channel simulation. */
export interface ImSimulationTargetView {
  readonly workspaceId: WorkspaceId
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly revision: ImRevision
  readonly updatedAt: string
}

/** One simulated participant whose identity may be used for inbound injection. */
export interface ImSimulationParticipant {
  readonly actorId: string
  readonly displayName?: string
}

/** Target and execution policy frozen when one simulation instance is created. */
export interface ImSimulationFrozenTarget {
  readonly platform: ImPlatform
  readonly accountId: ImAccountId
  readonly routeId: ImRouteId
  readonly routeRevision: ImRevision
  readonly accountRevision: ImRevision
  readonly conversationKind: ImConversationKind
  readonly conversationId: string
  readonly workspaceId: WorkspaceId
  readonly agentPreset: string
  readonly groupTrigger?: ImGroupTrigger
  readonly directRecipient?: ImDirectRecipient
}

/** Durable two-Session simulation instance. `stopped` and `failed` are terminal. */
export interface ImSimulationInstanceView {
  readonly instanceId: ImSimulationInstanceId
  readonly status: 'creating' | 'running' | 'stopping' | 'stopped' | 'failed'
  readonly simUserSessionId: SessionId
  readonly simUserWorkspaceId: WorkspaceId
  readonly testedSessionId: SessionId
  readonly target: ImSimulationFrozenTarget
  readonly speakingMembers: readonly ImSimulationParticipant[]
  readonly historyImports: readonly ImSimulationHistoryImport[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly stoppedAt?: string
  readonly failure?: { readonly code: string; readonly message: string }
}

/** Durable display facts for one query-only simulation history import. */
export interface ImSimulationHistoryImport {
  readonly operationId: ImDeliveryOperationId
  readonly fileName: string
  readonly messageCount: number
  readonly importedCount: number
  readonly duplicateCount: number
}

/** Scope-free local history import; the Host derives the frozen instance scope. */
export interface ImImportSimulationHistoryRequest {
  readonly instanceId: ImSimulationInstanceId
  readonly operationId: ImDeliveryOperationId
  readonly fileName: string
  readonly jsonl: string
}

/** Updated instance and exact durable receipt for one local history import. */
export interface ImImportSimulationHistoryResult {
  readonly source: ImSimulationHistoryImport
  readonly instance: ImSimulationInstanceView
}

/** Create a simulation from one live, workspace-owned simulated-user Session. */
export interface ImCreateSimulationInstanceRequest {
  readonly simUserSessionId: SessionId
  /** Required only when the configured route targets every conversation. */
  readonly conversationId?: string
  readonly speakingMembers?: readonly ImSimulationParticipant[]
}

/** Trusted navigation and delivery facts for either Session in one instance. */
export interface ImSimulationSessionScope {
  readonly instanceId: ImSimulationInstanceId
  readonly role: 'sim-user' | 'tested'
  readonly sessionId: SessionId
  readonly peerSessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly peerWorkspaceId: WorkspaceId
  readonly deliveryScope: ImSimulationDeliveryScope
  readonly status: ImSimulationInstanceView['status']
}

/** Inject one allow-listed simulated participant message through normal IM admission. */
export interface ImInjectSimulationMemberRequest {
  readonly instanceId: ImSimulationInstanceId
  readonly actorId: string
  readonly text: string
}

/** Inject the managed human actor through normal IM admission. */
export interface ImInjectSimulationManagedHumanRequest {
  readonly instanceId: ImSimulationInstanceId
  readonly text: string
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
  readonly kind: 'account' | 'account-listener' | 'route' | 'simulation-target' | 'simulation-instance'
  readonly accountId?: ImAccountId
  readonly routeId?: ImRouteId
  readonly workspaceId?: WorkspaceId
  readonly operationId?: ImOperationId
  readonly instanceId?: ImSimulationInstanceId
}

/** Result of resolving the precedence-ordered routes for one inbound conversation. */
export type ImRouteResolution =
  | { readonly state: 'matched'; readonly route: ImRouteView }
  | { readonly state: 'disabled'; readonly route: ImRouteView }
  | { readonly state: 'account-paused' }
  | { readonly state: 'unmatched' }
