/** Product model provider and settings editor over the official pi-ai implementation. */
import type { Context } from '@deepseek-ai/cordis'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { ModelDefaultsAdapter } from './adapter.ts'
import { modelDefault, validateModelDefaults, THINKING_LEVELS } from './model-defaults.ts'
import {
  ModelCenter,
  type ManagedProviderReservation,
  type ModelCenterLlmRegistrations,
  type ModelCenterSettingsSections,
} from './managed-providers.ts'

export type {
  ManagedProviderConsumer,
  ManagedProviderHandle,
  ManagedProviderReservation,
} from './managed-providers.ts'

export const name = 'gestaltrun-model-center'
export const inject = ['llm', 'settings']
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
  /** Provider routes whose settings and runtime adapter are owned by a product plugin. */
  managedProviders?: ManagedProviderReservation[]
}

/** Runtime schema for product pi-ai composition and startup-time managed route reservations. */
export const Config: Schema<Config> = PiAi.Config.set('managedProviders', Schema.array(Schema.object({
  id: Schema.string().required(),
  displayName: Schema.string().required(),
})).default([])) as Schema<Config>

function ordinary(value: Config, modelCenter: ModelCenter): PiAi.Config {
  return {
    providers: Object.fromEntries(Object.entries(value.providers ?? {}).filter(([id]) => !modelCenter.manages(id))),
  }
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
  const modelCenter = new ModelCenter(ctx, { managedProviders: config.managedProviders ?? [] })
  modelCenter.validate(config)
  const scoped = ctx.isolate('llm').isolate('settings')
  const registrations: ModelCenterLlmRegistrations = {
    registerAdapter: (providers, adapter) => llm.registerAdapter(providers,
      new ModelDefaultsAdapter(adapter, (provider, model) => modelDefault(current(), provider, model))),
    registerConfigurableProviders: entries => llm.registerConfigurableProviders(entries),
    registerModelDiscovery: (namespace, discover) => {
      if (namespace !== 'llm-pi-ai') throw new Error(`model-center: unexpected discovery namespace ${namespace}`)
      return modelCenter.setOrdinaryDiscovery(discover)
    },
  }
  const sections: ModelCenterSettingsSections = {
    installSection(owner, namespace, schema, entry, hooks) {
      if (namespace !== 'llm-pi-ai') throw new Error(`model-center: unexpected pi-ai settings namespace ${namespace}`)
      settings.installSection(owner, namespace, schema, entry, {
        ...hooks,
        validate(value) {
          hooks.validate?.(ordinary(value as Config, modelCenter) as unknown as typeof value)
          validateModelDefaults(value)
          modelCenter.validate(value)
        },
        setSource(source) {
          current = source
          modelCenter.setSource(source)
          hooks.setSource(() => ordinary(source() as Config, modelCenter) as unknown as ReturnType<typeof source>)
        },
        onChange() {
          hooks.onChange()
          modelCenter.changed()
        },
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
  scoped.plugin(PiAi, ordinary(config, modelCenter))
}
