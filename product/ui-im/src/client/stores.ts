/** Remount-surviving route drafts and operation outcomes; no authoritative business rows. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RouteEditorState, ImRouteDraft } from './route-editor.ts'

type RouteUiState = { editors: Record<string, RouteEditorState | undefined>; feedback: Record<string, string | undefined> }
type RouteUiActions = {
  setEditor: (state: RouteUiState, workspaceId: string, editor: RouteEditorState | undefined) => void
  editDraft: (state: RouteUiState, workspaceId: string, patch: Partial<ImRouteDraft>) => void
  feedback: (state: RouteUiState, workspaceId: string, message: string) => void
}

/** @returns a store handle shared by product workspace settings contributions. */
export function createRouteUiStore(): EngineStoreHandle<RouteUiState, RouteUiActions> {
  return defineStore({
    init: (): RouteUiState => ({ editors: {}, feedback: {} }),
    actions: {
      setEditor(state, workspaceId, editor) { state.editors[workspaceId] = editor },
      editDraft(state, workspaceId, patch) {
        const current = state.editors[workspaceId]
        if (current === undefined || current.busy) return
        state.editors[workspaceId] = { draft: { ...current.draft, ...patch }, original: current.original, items: [], confirmation: false, busy: false }
      },
      feedback(state, workspaceId, message) { state.feedback[workspaceId] = message },
    },
  })
}
