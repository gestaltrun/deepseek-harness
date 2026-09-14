/** Host service and event declarations kept out of the client-safe DTO entry. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ImAccountSetupRequest } from './transport.ts'
import type {
  ImAccountId,
  ImAccountCandidate,
  ImAccountMutationResult,
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
  /** @param platform - provider whose installed or admitted identities are requested. @param signal - caller lifetime. @returns safe selectable candidates. */
  listAccountCandidates(platform: ImPlatform, signal?: AbortSignal): Promise<readonly ImAccountCandidate[]>
  /** @param accountId - receiving account. @param conversationKind - provider category. @param conversationId - provider conversation. @returns precedence-ordered route resolution. */
  resolveRoute(accountId: ImAccountId, conversationKind: ImConversationKind, conversationId: string): ImRouteResolution
  /** @param request - transport-owned account setup input. @param signal - caller lifetime. @returns the persisted safe account. */
  addAccount(request: ImAccountSetupRequest, signal?: AbortSignal): Promise<ImAccountView>
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
