/** Reserved provider routes whose catalogs and runtime adapters belong to product plugins. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmRuntime,
} from '@deepseek-ai/dsh-llm'
import { SettingsConflictError, type SettingsProvider, type SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import type { ProductModelProfile, ProductProviderProfile } from './index.ts'

const SETTINGS_NS = 'llm-pi-ai'

/** One provider route reserved before the generic pi-ai adapter reads settings. */
export interface ManagedProviderReservation {
  readonly id: string
  readonly displayName: string
}

/** Runtime owner for one reserved provider route. */
export interface ManagedProviderConsumer {
  /** @param profile - Candidate effective profile to reject when the runtime owner cannot serve it. */
  validate(profile: ProductProviderProfile): void
  /** @param profile - Effective committed profile, or absence after provider removal. */
  changed(profile: ProductProviderProfile | undefined): void | Promise<void>
  /** @param signal - Optional caller cancellation. @returns Current source catalog without interrogating a draft endpoint. */
  discover(signal?: AbortSignal): Promise<readonly ProductModelProfile[]>
}

/** Source-side handle for publishing one reserved provider catalog. */
export interface ManagedProviderHandle {
  /** @param models - Complete source catalog. @returns Settlement after source-owned fields persist. */
  syncCatalog(models: readonly ProductModelProfile[]): Promise<void>
  /** Stop this producer without deleting its persisted provider profile. */
  dispose(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-owned coordination for provider routes excluded from generic pi-ai. */
    modelCenter: ModelCenter
  }
}

interface Config {
  managedProviders: readonly ManagedProviderReservation[]
}

function profileOf(value: unknown, id: string): ProductProviderProfile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const providers = (value as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return undefined
  const profile = (providers as Record<string, unknown>)[id]
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile)
    ? profile as ProductProviderProfile
    : undefined
}

function assertReservation(reservation: ManagedProviderReservation): void {
  if (reservation.id.length === 0 || reservation.displayName.length === 0) {
    throw new Error('model-center: managed provider reservations require a non-empty id and displayName')
  }
}

/** Own managed-route validation, discovery dispatch, and source publication. */
export class ModelCenter extends Service {
  static inject = ['llm', 'settings']
  private readonly reservations = new Map<string, ManagedProviderReservation>()
  private readonly consumers = new Map<string, ManagedProviderConsumer>()
  private source: () => unknown = () => ({ providers: {} })
  private ordinaryDiscovery: ((request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>) | undefined

  /** @param ctx - product LLM and Settings services. @param config - startup-time managed-route reservations. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'modelCenter')
    for (const reservation of config.managedProviders) {
      assertReservation(reservation)
      if (this.reservations.has(reservation.id)) {
        throw new Error(`model-center: managed provider "${reservation.id}" is reserved more than once`)
      }
      this.reservations.set(reservation.id, { ...reservation })
    }
    if (this.reservations.size > 0) {
      ctx.llm.registerConfigurableProviders([...this.reservations.values()].map(reservation => ({
        provider: reservation.id,
        displayName: reservation.displayName,
        settingsNs: SETTINGS_NS,
        settingsPath: ['providers', reservation.id],
        declared: false,
      })))
    }
    ctx.llm.registerModelDiscovery(SETTINGS_NS, (request, signal) => this.discover(request, signal))
  }

  /** @param id - Provider route. @returns Whether generic pi-ai must omit it from every source and validation view. */
  manages(id: string): boolean { return this.reservations.has(id) }

  /** @param source - Full resolved Settings source used by managed consumers. */
  setSource(source: () => unknown): void { this.source = source }

  /** @param discover - Official pi-ai discovery implementation for ordinary routes. @returns Its disposer. */
  setOrdinaryDiscovery(
    discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>,
  ): () => void {
    if (this.ordinaryDiscovery !== undefined) throw new Error('model-center: ordinary model discovery is already registered')
    this.ordinaryDiscovery = discover
    return () => { if (this.ordinaryDiscovery === discover) this.ordinaryDiscovery = undefined }
  }

  /** @param value - Candidate resolved Settings value containing every reserved profile to validate. */
  validate(value: unknown): void {
    for (const [id] of this.reservations) {
      const profile = profileOf(value, id)
      if (profile === undefined) continue
      this.validateConnectionFields(id, profile)
      this.consumers.get(id)?.validate(profile)
    }
  }

  /** Notify active runtime owners after Settings commits. */
  changed(): void {
    for (const [id, consumer] of this.consumers) this.notify(id, consumer)
  }

  /**
   * Register the sole source and runtime owner for one startup-reserved route.
   * @param owner - Context whose disposal releases the registration.
   * @param id - Startup-reserved provider route.
   * @param consumer - Source, validation, and runtime reconciliation owner.
   * @returns Handle for publishing catalogs and explicitly disposing the producer.
   */
  registerManagedProvider(owner: Context, id: string, consumer: ManagedProviderConsumer): ManagedProviderHandle {
    const reservation = this.reservations.get(id)
    if (reservation === undefined) throw new Error(`model-center: provider "${id}" was not reserved at startup`)
    if (this.consumers.has(id)) throw new Error(`model-center: provider "${id}" already has a managed producer`)
    const current = profileOf(this.source(), id)
    if (current !== undefined) {
      this.validateConnectionFields(id, current)
      consumer.validate(current)
    }
    let active = false
    const dispose = owner.effect(function* (this: ModelCenter) {
      if (this.consumers.has(id)) throw new Error(`model-center: provider "${id}" already has a managed producer`)
      active = true
      this.consumers.set(id, consumer)
      this.notify(id, consumer)
      yield () => {
        active = false
        if (this.consumers.get(id) === consumer) this.consumers.delete(id)
      }
    }.bind(this), `modelCenter.registerManagedProvider(${JSON.stringify(id)})`)
    return {
      syncCatalog: models => {
        if (!active) return Promise.reject(new Error(`model-center: provider "${id}" producer is disposed`))
        return this.syncCatalog(reservation, models, () => active)
      },
      dispose: () => { void dispose() },
    }
  }

  private notify(id: string, consumer: ManagedProviderConsumer): void {
    let changed: void | Promise<void>
    try {
      changed = consumer.changed(profileOf(this.source(), id))
    } catch (error) {
      this.ctx.logger.warn(`model-center: managed provider "${id}" rejected a committed profile`, error)
      return
    }
    Promise.resolve(changed).catch(error => {
      this.ctx.logger.warn(`model-center: managed provider "${id}" rejected a committed profile`, error)
    })
  }

  private validateConnectionFields(id: string, profile: ProductProviderProfile): void {
    if (profile.api !== undefined && profile.api !== 'openai-completions') {
      throw new Error(`model-center: managed provider "${id}" requires api openai-completions`)
    }
    if (profile.baseURL !== undefined && profile.baseURL.length > 0) {
      throw new Error(`model-center: managed provider "${id}" does not accept a baseURL`)
    }
    if (profile.apiKeyEnv !== undefined && profile.apiKeyEnv.length > 0) {
      throw new Error(`model-center: managed provider "${id}" does not accept apiKeyEnv`)
    }
    if (profile.headers !== undefined && Object.keys(profile.headers).length > 0) {
      throw new Error(`model-center: managed provider "${id}" does not accept request headers`)
    }
    if (profile.modelOverrides !== undefined && Object.keys(profile.modelOverrides).length > 0) {
      throw new Error(`model-center: managed provider "${id}" stores model edits in models, not modelOverrides`)
    }
  }

  private async syncCatalog(
    reservation: ManagedProviderReservation,
    models: readonly ProductModelProfile[],
    active: () => boolean,
  ): Promise<void> {
    const detached = models.map(model => structuredClone(model))
    for (;;) {
      if (!active()) throw new Error(`model-center: provider "${reservation.id}" producer is disposed`)
      const descriptor = this.ctx.settings.describe().find(entry => entry.ns === SETTINGS_NS)
      if (descriptor === undefined) throw new Error('model-center: llm-pi-ai settings are not registered')
      const stored = profileOf(descriptor.user, reservation.id)
      const ops: SettingsPathOp[] = []
      if (stored?.displayName !== reservation.displayName) ops.push({
        op: 'set', path: ['providers', reservation.id, 'displayName'], value: reservation.displayName,
      })
      if (stored?.api !== 'openai-completions') ops.push({
        op: 'set', path: ['providers', reservation.id, 'api'], value: 'openai-completions',
      })
      if (!deepEqualJson(stored?.models, detached)) ops.push({
        op: 'set', path: ['providers', reservation.id, 'models'], value: detached,
      })
      if (ops.length === 0) {
        const consumer = this.consumers.get(reservation.id)
        if (consumer !== undefined) this.notify(reservation.id, consumer)
        return
      }
      try {
        await this.ctx.settings.mutate(SETTINGS_NS, ops, descriptor.revision)
        return
      } catch (error) {
        if (error instanceof SettingsConflictError && active()) continue
        throw error
      }
    }
  }

  private discover(request: LlmModelDiscoveryRequest, signal?: AbortSignal): Promise<readonly LlmDiscoveredModel[]> {
    if (request.provider !== undefined && this.manages(request.provider)) {
      const consumer = this.consumers.get(request.provider)
      if (consumer === undefined) return Promise.resolve([])
      return consumer.discover(signal).then(models => models.map(model => ({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })))
    }
    if (this.ordinaryDiscovery === undefined) throw new Error('model-center: ordinary model discovery is unavailable')
    return this.ordinaryDiscovery(request, signal)
  }
}

/** LLM methods bridged into the isolated official pi-ai plugin. */
export type ModelCenterLlmRegistrations = Pick<LlmRuntime,
  'registerAdapter' | 'registerConfigurableProviders' | 'registerModelDiscovery'>

/** Settings method bridged into the isolated official pi-ai plugin. */
export type ModelCenterSettingsSections = Pick<SettingsProvider, 'installSection'>
