/** Remount-surviving route drafts and operation outcomes; no authoritative business rows. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RouteEditorState, ImRouteDraft } from './route-editor.ts'
import type { ImRemoveSimulationTargetRequest, ImSaveSimulationTargetRequest } from '@gestaltrun/dsh-api-im/client'

/** Pending target command keeps its identity when the response is unknown. */
export type SimulationTargetCommand = { readonly kind: 'save'; readonly request: ImSaveSimulationTargetRequest } | { readonly kind: 'remove'; readonly request: ImRemoveSimulationTargetRequest }
/** Target selection and unresolved command survive settings remounts. */
export interface SimulationEditorState {
  readonly picking: boolean
  readonly selected: string
  readonly query: string
  readonly busy: boolean
  readonly unknown?: SimulationTargetCommand
  readonly error?: string
}

type RouteUiState = { editors: Record<string, RouteEditorState | undefined>; feedback: Record<string, string | undefined>; simulations: Record<string, SimulationEditorState | undefined> }
type RouteUiActions = {
  setEditor: (state: RouteUiState, workspaceId: string, editor: RouteEditorState | undefined) => void
  editDraft: (state: RouteUiState, workspaceId: string, patch: Partial<ImRouteDraft>) => void
  feedback: (state: RouteUiState, workspaceId: string, message: string) => void
  setSimulation: (state: RouteUiState, workspaceId: string, editor: SimulationEditorState) => void
}

/** @returns a store handle shared by product workspace settings contributions. */
export function createRouteUiStore(): EngineStoreHandle<RouteUiState, RouteUiActions> {
  return defineStore({
    init: (): RouteUiState => ({ editors: {}, feedback: {}, simulations: {} }),
    actions: {
      setEditor(state, workspaceId, editor) { state.editors[workspaceId] = editor },
      editDraft(state, workspaceId, patch) {
        const current = state.editors[workspaceId]
        if (current === undefined || current.busy) return
        state.editors[workspaceId] = { draft: { ...current.draft, ...patch }, original: current.original, items: [], confirmation: false, busy: false }
      },
      feedback(state, workspaceId, message) { state.feedback[workspaceId] = message },
      setSimulation(state, workspaceId, editor) { state.simulations[workspaceId] = editor },
    },
  })
}

/** Drafts and unresolved simulation gestures retained by one Session-scoped sidebar. */
export interface ConversationUiState {
  readonly conversationId: string
  readonly participants: string
  readonly memberId: string
  readonly memberText: string
  readonly managedText: string
  readonly creating: boolean
  readonly createUnknown: boolean
  readonly sending: boolean
  readonly sendUnknown: boolean
  readonly stopConfirmation: boolean
  readonly stopping: boolean
  readonly feedback: string | undefined
  readonly error: string | undefined
}

type ConversationUiActions = {
  patch: (state: ConversationUiState, patch: Partial<ConversationUiState>) => void
}

/** @returns Session-scoped transient simulation input and unknown-outcome state. */
export function createConversationUiStore(): EngineStoreHandle<ConversationUiState, ConversationUiActions> {
  return defineStore({
    init: (): ConversationUiState => ({
      conversationId: '', participants: '', memberId: '', memberText: '', managedText: '',
      creating: false, createUnknown: false, sending: false, sendUnknown: false,
      stopConfirmation: false, stopping: false,
      feedback: undefined, error: undefined,
    }),
    actions: {
      patch(state, patch) { Object.assign(state, patch) },
    },
  })
}
