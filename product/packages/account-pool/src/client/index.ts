/** Product-owned Remote assembly and shared account-pool Settings contributions. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import remoteContribution from '@gestaltrun/dsh-account-pool/remote'
import { AccountPoolClientController, type AccountPoolInjected } from './controller.ts'
import { AccountPoolControl } from './AccountPoolControl.tsx'
import { ModelsFooter } from './ModelsFooter.tsx'
import { createAccountPoolViewStore } from './view-store.ts'
import { downloadAccount, openAuthorization } from './navigation.ts'
import { en, zh, type AccountPoolKey } from './locales.ts'

export { createAccountPoolViewStore } from './view-store.ts'
export type { AccountPoolClientActions, AccountPoolInjected } from './controller.ts'
export type { AccountPoolControlProps } from './AccountPoolControl.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account management and quota observation copy. */
    accountPool: AccountPoolKey
  }
}

/** Client services used by the product's own Remote assembly and Settings entries. */
export const inject = ['slots', 'locale', 'remote', 'remote.llm']

/**
 * Mount the product namespace and feature entries for this Client fiber.
 * @param ctx - Client plugin context.
 * @returns after the product namespace and Settings entries are installed.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(remoteContribution)
  const controller = new AccountPoolClientController(ctx.remote, { download: downloadAccount, openExternal: openAuthorization })
  ctx.effect(() => async () => { await controller.dispose(); await unmount() }, 'account-pool Client lifetime')
  ctx.effect(() => ctx.locale.register('accountPool', { zh, en }), 'account-pool locale')
  const t = ctx.locale.bind('accountPool')
  const view = createAccountPoolViewStore()
  const injected = (): AccountPoolInjected => ({
    accountPoolActions: controller.actions,
    hooks: { accountPool: controller.snapshot, accountPoolDirectory: controller.directory },
  })
  ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { void controller.refreshDirectory() }), 'account-pool directory updates')
  ctx.on('connection/reset', () => { void controller.refreshDirectory() })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account-pool', order: 12,
    label: () => t('settingsNav'), locale: 'accountPool', store: view, inject: injected,
  }, AccountPoolControl))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'account-pool', order: 20,
    locale: 'accountPool', inject: injected,
  }, ModelsFooter))
}
