/** Product-owned Remote assembly and shared account-pool Settings contributions. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import remoteContribution from '@gestaltrun/dsh-account-pool/remote'
import { AccountPoolClientController } from './controller.ts'
import type { AccountPoolInjected } from './contract.ts'
import { AccountPoolControl } from './AccountPoolControl.tsx'
import { createAccountPoolViewStore } from './view-store.ts'
import { openAuthorization } from './navigation.ts'
import { en, zh, type AccountPoolKey } from './locales.ts'

export { createAccountPoolViewStore } from './view-store.ts'
export type { AccountPoolClientActions, AccountPoolInjected } from './contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Account management and quota observation copy. */
    accountPool: AccountPoolKey
  }
}

/** Client services used by the product's own Remote assembly and Settings entries. */
export const inject = ['remote']

/**
 * Mount the product namespace and feature entries for this Client fiber.
 * @param ctx - Client plugin context.
 * @returns after the product namespace and Settings entries are installed.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(remoteContribution)
  ctx.effect(() => unmount, 'account-pool Remote contribution')
  await ctx.inject(['slots', 'locale', 'remote', 'remote.accountPool'], (inner) => {
    const controller = new AccountPoolClientController(inner.remote, { openExternal: openAuthorization })
    inner.effect(() => () => controller.dispose(), 'account-pool Client controller')
    inner.effect(() => inner.locale.register('accountPool', { zh, en }), 'account-pool locale')
    const t = inner.locale.bind('accountPool')
    const view = createAccountPoolViewStore()
    const injected = (): AccountPoolInjected => ({
      accountPoolActions: controller.actions,
      hooks: { accountPool: controller.snapshot },
    })
    inner.slots.inject('settings.section', () => inner.slots.register({
      name: 'settings.section', id: 'account-pool', order: 12,
      label: () => t('settingsNav'), locale: 'accountPool', store: view, inject: injected,
    }, AccountPoolControl))
  }).await()
}
