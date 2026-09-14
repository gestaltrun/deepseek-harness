/** Product model provider and settings editor over the official pi-ai implementation. */
import type { Context } from '@deepseek-ai/cordis'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { ModelDefaultsAdapter } from './adapter.ts'
import { modelDefault, validateModelDefaults, THINKING_LEVELS } from './model-defaults.ts'

export const name = 'gestaltrun-model-center'
export const inject = ['llm', 'settings']
export const Config: typeof PiAi.Config = PiAi.Config
/** Model metadata plus the product default selected before a request is prepared. */
export interface ProductModelProfile extends PiAi.PiAiModelProfile {
  defaultReasoningLevel?: (typeof THINKING_LEVELS)[number]
}
/** A provider keeps the official configuration and the product model declarations. */
export interface ProductProviderProfile extends Omit<PiAi.PiAiProviderProfile, 'models' | 'modelOverrides'> {
  models?: ProductModelProfile[]
  modelOverrides?: Record<string, Omit<ProductModelProfile, 'id'>>
}
/** Product provider configuration stored in the existing llm-pi-ai namespace. */
export interface Config extends Omit<PiAi.Config, 'providers'> {
  providers?: Record<string, ProductProviderProfile>
}

/**
 * Compose the unchanged pi-ai plugin through product-owned registration and validation views.
 * @param ctx - Product context owning every registration and nested provider fiber.
 * @param config - pi-ai composition defaults; product fields remain in the same atomic settings namespace.
 */
export function apply(ctx: Context, config: Config): void {
  validateModelDefaults(config)
  const llm = ctx.llm
  const settings = ctx.settings
  let current: () => unknown = () => config
  const scoped = ctx.isolate('llm').isolate('settings')
  const registrations: Pick<LlmRuntime, 'registerAdapter' | 'registerConfigurableProviders' | 'registerModelDiscovery'> = {
    registerAdapter: (providers, adapter) => llm.registerAdapter(providers,
      new ModelDefaultsAdapter(adapter, (provider, model) => modelDefault(current(), provider, model))),
    registerConfigurableProviders: entries => llm.registerConfigurableProviders(entries),
    registerModelDiscovery: (namespace, discover) => llm.registerModelDiscovery(namespace, discover),
  }
  const sections: Pick<SettingsProvider, 'installSection'> = {
    installSection(owner, namespace, schema, entry, hooks) {
      if (namespace !== 'llm-pi-ai') throw new Error(`model-center: unexpected pi-ai settings namespace ${namespace}`)
      settings.installSection(owner, namespace, schema, entry, {
        ...hooks,
        validate(value) { hooks.validate?.(value); validateModelDefaults(value) },
        setSource(source) { current = source; hooks.setSource(source) },
      })
    },
  }
  scoped.plugin({
    name: 'model-center-provider-registrations',
    apply(bridge: Context) {
      bridge.reflect.provide('llm', registrations)
      bridge.reflect.provide('settings', sections)
    },
  })
  scoped.plugin(PiAi, config)
}
