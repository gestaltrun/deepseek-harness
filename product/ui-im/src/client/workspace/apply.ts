/** Product workspace browser adaptation using the existing public navigation services. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locale-types.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import { createWorkspaceViewStore } from './stores.ts'
import type { WorkspaceBrowserInjected } from './contract/slots.ts'
import { NativeDirectoryFlow } from '../directory/native.ts'
import { BrowseDirectoryFlow } from '../directory/browse.ts'
import { en as directoryEn, zh as directoryZh } from '../directory/locales.ts'
import { en, zh } from './locales.ts'

/** @param ctx - owning UI plugin context. @param directoryPicker - explicit product composition choice. */
export function registerWorkspaceBrowser(ctx: Context, directoryPicker: 'native' | 'browse'): void {
  ctx.effect(() => ctx.locale.register('gestaltrun.imWorkspace', { en, zh }), 'im-ui: workspace copy')
  const directoryFlow: HostObservable<boolean> = {
    getSnapshot: () => ctx.slots.entries('sidebar.workspaces.imDirectoryFlow').length > 0,
    subscribe: listener => ctx.slots.subscribe('sidebar.workspaces.imDirectoryFlow', listener),
  }
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const injected = (): WorkspaceBrowserInjected => ({
    startSession: workspaceId => { ctx.uiWorkspace.startSession(workspaceId) },
    open: sessionId => { ctx.uiWorkspace.openSession(sessionId) },
    searchSessions: async (query, signal) => {
      const result = await ctx.sessions.search(query, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`Unknown Session ${sessionId}`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: sessionId => { void ctx.uiWorkspace.forkSession(sessionId).catch(error => { ctx.logger.warn(error) }) },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: workspaceId => ctx.workspaces.delete(workspaceId),
    insertWorkspaceBefore: (workspaceId, beforeWorkspaceId) => ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId),
    archiveSession: sessionId => ctx.uiWorkspace.archiveSession(sessionId),
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => { await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId) },
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow, hostInfo },
  })
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces', priority: -10, locale: 'gestaltrun.imWorkspace', store: createWorkspaceViewStore(), inject: injected,
    children: {
      'sidebar.workspaces.imDirectoryFlow': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.imSettings': { kind: 'list', scope: 'root' },
    },
  }, WorkspaceBrowser))
  if (directoryPicker === 'native') {
    ctx.slots.inject('sidebar.workspaces.imDirectoryFlow', () => ctx.slots.register({ name: 'sidebar.workspaces.imDirectoryFlow', inject: () => ({ pick: () => ctx.uiWorkspace.pickDirectory() }) }, NativeDirectoryFlow))
  } else {
    ctx.effect(() => ctx.locale.register('gestaltrun.imDirectory', { en: directoryEn, zh: directoryZh }), 'im-ui: directory copy')
    ctx.slots.inject('sidebar.workspaces.imDirectoryFlow', () => ctx.slots.register({ name: 'sidebar.workspaces.imDirectoryFlow', inject: () => ({
      listDirectory: (path?: string, signal?: AbortSignal) => ctx.uiWorkspace.listDirectory(path, signal),
      createDirectory: (path: string, name: string) => ctx.uiWorkspace.createDirectory(path, name),
      t: ctx.locale.bind('gestaltrun.imDirectory'),
    }) }, BrowseDirectoryFlow))
  }
}
