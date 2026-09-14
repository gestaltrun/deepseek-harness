/** IM settings and sidebar contributions consume product API objects through Cordis. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import type { ImOperationId } from '@gestaltrun/dsh-api-im/client'
import type {} from '@gestaltrun/dsh-api-im/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locale-types.ts'
import { AccountsSection } from './AccountsSection.tsx'
import { TakeoverSection } from './TakeoverSection.tsx'
import { SimulationSection } from './SimulationSection.tsx'
import { submitTarget } from './target-operation.ts'
import type { SimulationTargetCommand } from './stores.ts'
import { ConversationTab } from './ConversationTab.tsx'
import { accountFace } from './faces.ts'
import { createRouteUiStore } from './stores.ts'
import { submitRouteDraft } from './route-editor.ts'
import { registerWorkspaceBrowser } from './workspace/apply.ts'
import { en, NS, zh } from './locales.ts'

export type { ImKey } from './locales.ts'

/** Product composition selects the directory interaction supported by its Host. */
export interface Config { readonly directoryPicker?: 'native' | 'browse' }
/** Explicit browser default; Desktop composition supplies native. */
export const Config: z<Config> = z.object({ directoryPicker: z.union(['native', 'browse']).default('browse') })

/** Every service read by this UI contribution is an explicit activation dependency. */
export const inject = ['slots', 'locale', 'im', 'sidebarRightTabs', 'uiWorkspace', 'sessions', 'workspaces', 'remote', 'layout']

/** @param ctx - Client context supplying product objects and public composition services. @param config - product directory interaction. */
export function apply(ctx: Context, config: Config): void {
  const directoryPicker = config.directoryPicker ?? 'browse'
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'im-ui: pending operations')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'im-ui: copy')
  const operationId = (): ImOperationId => brandString<ImOperationId>(crypto.randomUUID())
  const accounts = accountFace(ctx.im, operationId)
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'im-accounts', order: 45, locale: NS, label: () => ctx.locale.bind(NS)('nav'), inject: () => accounts }, AccountsSection))
  registerWorkspaceBrowser(ctx, directoryPicker)
  const routes = createRouteUiStore()
  ctx.slots.inject('sidebar.workspaces.imSettings', () => ctx.slots.register({
    name: 'sidebar.workspaces.imSettings', id: 'takeover', locale: NS, order: 10, store: routes,
    inject: () => ({ hooks: { configuration: ctx.im.configuration }, operationId, submit: (items: Parameters<typeof submitRouteDraft>[1]) => submitRouteDraft(ctx.im, items, operationId, lifetime.signal) }),
  }, TakeoverSection))
  ctx.slots.inject('sidebar.workspaces.imSettings', () => ctx.slots.register({
    name: 'sidebar.workspaces.imSettings', id: 'simulation', locale: NS, order: 20, store: routes,
    inject: () => ({ hooks: { configuration: ctx.im.configuration }, operationId, submit: (command: SimulationTargetCommand, queryFirst: boolean) => submitTarget(ctx.im, command, queryFirst) }),
  }, SimulationSection))
  const definition = '@gestaltrun/dsh-ui-im/conversation'
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: definition, kind: 'im-conversation', priority: 'extension', title: () => ctx.locale.bind(NS)('tab'), guide: [{ order: 56, title: () => ctx.locale.bind(NS)('tab'), description: () => ctx.locale.bind(NS)('tabGuide') }] }), 'im-ui: conversation tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition, locale: NS }, ConversationTab))
}
