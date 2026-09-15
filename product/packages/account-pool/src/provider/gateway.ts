/** Account lifecycle and committed management state over a generation-private core gateway. */
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import {
  AccountPool, AccountPoolError, type AccountPoolAccount, type AccountPoolAccountName,
  type AccountPoolAccountRef, type AccountPoolCallback, type AccountPoolEditableFields,
  type AccountPoolFieldPatch, type AccountPoolGlmKey, type AccountPoolLoginKind,
  type AccountPoolLoginStart, type AccountPoolLoginState, type AccountPoolModel,
  type AccountPoolSnapshot,
} from '../account-pool.ts'
import { createQuotaObserver, isPaidXaiCredential, type QuotaObservation, type QuotaProvider } from '../quota/index.ts'
import type { QuotaProbeInput } from '../quota/types.ts'
import { ACCOUNT_POOL_ROUTE, GenerationAdapter, LiveAccountAdapter } from '../llm/adapter.ts'
import { parseAccountPoolCatalog, mergeAccountPoolCatalogs, type AccountPoolCatalogModel } from '../llm/catalog.ts'
import { Config, resolve, type Spec } from './config.ts'
import { coreFieldPatch, editableFields, oauthRef, roster } from './redaction.ts'
import { projectQuotaWindows } from './quota-view.ts'
import { Supervisor, type Generation } from './supervisor.ts'
import { decodeCoreJson, type CoreMethod } from './transport.ts'
import { callbackSchema, glmSchema, kindSchema, nameSchema, parseInput, patchSchema, recordSchema, stateSchema } from './validation.ts'

const LOGIN_PATH = {
  anthropic: 'anthropic-auth-url', codex: 'codex-auth-url', antigravity: 'antigravity-auth-url',
  kimi: 'kimi-auth-url', xai: 'xai-auth-url',
} as const
const QUOTA_PROVIDER: Readonly<Record<string, QuotaProvider>> = {
  anthropic: 'claude', claude: 'claude', codex: 'codex', antigravity: 'antigravity', kimi: 'kimi', xai: 'xai', glm: 'glm',
}
const DEFINITION_CHANNEL: Readonly<Record<string, string>> = {
  anthropic: 'claude', claude: 'claude', codex: 'codex', antigravity: 'antigravity', kimi: 'kimi', xai: 'xai', glm: 'glm',
}
interface QuotaCache { latest: QuotaObservation; successful?: QuotaObservation }
interface LoginOperation { readonly controller: AbortController; readonly generation: Generation; readonly kind: AccountPoolLoginKind; state?: AccountPoolLoginState }

/** CLIProxyAPI account provider; the enclosing composition supplies an isolated local subprocess service. */
export class CLIProxyAccountPool extends AccountPool {
  static inject = ['llm', 'subprocess']
  static Config = Config
  private snapshot: AccountPoolSnapshot = Object.freeze({ state: 'starting', accounts: [] })
  private readonly listeners = new Set<(snapshot: AccountPoolSnapshot) => void>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly quotas = new Map<AccountPoolAccountRef, QuotaCache>()
  private readonly rawAccounts = new Map<AccountPoolAccountRef, Record<string, unknown>>()
  private readonly lifetime = new AbortController()
  private readonly liveAdapter = new LiveAccountAdapter(() => {
    if (this.adapter === undefined) throw new AccountPoolError('unavailable', 'Account models are unavailable.')
    return this.adapter
  })
  private generation: Generation | undefined
  private adapter: GenerationAdapter | undefined
  private registration: (() => void) | undefined
  private supervisor: Supervisor | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private login: LoginOperation | undefined
  private catalogKey: string | undefined

  /**
   * @param ctx - public LLM and explicitly local subprocess services.
   * @param config - validated product deployment policy.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    const startup = resolve(config).then(spec => this.start(spec)).catch(error => { this.failed(error) })
    ctx.effect(() => async () => {
      this.listeners.clear()
      this.lifetime.abort()
      this.login?.controller.abort()
      this.withdraw()
      await startup
      await this.supervisor?.stop()
      await this.quiesce()
    }, 'account pool lifetime')
  }

  override getSnapshot(): AccountPoolSnapshot { return this.snapshot }
  override subscribe(listener: (snapshot: AccountPoolSnapshot) => void): () => void {
    if (this.lifetime.signal.aborted) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  override refresh(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    return this.serial(signal, async generation => {
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override setEnabled(name: AccountPoolAccountName, enabled: boolean, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(nameSchema, name)
    return this.serial(signal, async generation => {
      this.account(name)
      await this.json(generation, 'PATCH', 'auth-files/status', { name, disabled: !enabled }, signal)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override deleteAccount(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(nameSchema, name)
    return this.serial(signal, async generation => {
      const account = this.account(name)
      await this.json(generation, 'DELETE', `auth-files?name=${encodeURIComponent(name)}`, undefined, signal)
      this.quotas.delete(account.ref)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override startLogin(kind: AccountPoolLoginKind, signal?: AbortSignal): Promise<AccountPoolLoginStart> {
    parseInput(kindSchema, kind)
    signal?.throwIfAborted()
    const generation = this.current()
    const previous = this.login
    previous?.controller.abort()
    const operation: LoginOperation = { kind, generation, controller: new AbortController() }
    this.login = operation
    const flow = kind === 'glm' ? 'glm-key' : kind === 'kimi' || kind === 'xai' ? 'device' : 'pkce'
    this.publish({ ...this.snapshot, login: { kind, flow, status: 'pending' } })
    return this.track((async () => {
      try {
        if (previous?.state !== undefined && !previous.generation.signal.aborted) {
          await this.json(previous.generation, 'DELETE', `oauth-session?state=${encodeURIComponent(previous.state)}`,
            undefined, previous.generation.signal)
        }
        this.loginSignal(operation, signal).throwIfAborted()
        if (this.login !== operation) throw new AccountPoolError('conflict', 'The login operation was superseded.')
        if (kind === 'glm') return this.snapshot.login!
        const payload = parseInput(recordSchema, await this.json(generation, 'GET', LOGIN_PATH[kind], undefined,
          this.loginSignal(operation, signal)))
        const state = brandString<AccountPoolLoginState>(parseInput(stateSchema, payload.state))
        const url = z.string().url().parse(payload.url)
        if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new AccountPoolError('failed', 'The enrollment URL is invalid.')
        if (this.login !== operation) throw new AccountPoolError('conflict', 'The login operation was superseded.')
        operation.state = state
        const login: AccountPoolLoginStart = { kind, flow, state, url, status: 'pending',
          ...typeof payload.user_code === 'string' ? { userCode: payload.user_code } : {},
          ...typeof payload.expires_in === 'number' ? { expiresIn: payload.expires_in } : {},
        }
        this.publish({ ...this.snapshot, login })
        void this.track(this.pollLogin(operation)).catch(() => undefined)
        return login
      } catch (error) {
        if (this.login === operation && !operation.controller.signal.aborted) {
          const login: AccountPoolLoginStart = { kind, flow, status: 'error', error: 'Account login could not be started.' }
          this.publish({ ...this.snapshot, login })
          return login
        }
        throw error
      }
    })())
  }

  override loginStatus(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(stateSchema, state)
    const operation = this.login
    if (operation?.state !== state) return Promise.reject(new AccountPoolError('conflict', 'The login operation is no longer current.'))
    return this.track(this.readLogin(operation, signal))
  }

  override cancelLogin(state: AccountPoolLoginState, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(stateSchema, state)
    const operation = this.login
    if (operation?.state !== state) return Promise.reject(new AccountPoolError('conflict', 'The login operation is no longer current.'))
    return this.cancel(operation, signal)
  }

  override dismissLogin(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    const operation = this.login
    return operation === undefined ? Promise.resolve(this.snapshot) : this.cancel(operation, signal)
  }

  override submitCallback(input: AccountPoolCallback, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(callbackSchema, input)
    const operation = this.login
    const url = new URL(input.redirectUrl)
    if (operation === undefined || operation.kind !== input.provider || operation.state === undefined
      || url.searchParams.get('state') !== operation.state) {
      return Promise.reject(new AccountPoolError('conflict', 'The callback does not match the active login.'))
    }
    return this.track((async () => {
      await this.json(operation.generation, 'POST', 'oauth-callback', { provider: input.provider, redirect_url: input.redirectUrl },
        this.loginSignal(operation, signal))
      return this.readLogin(operation, signal)
    })())
  }

  override submitGlmKey(input: AccountPoolGlmKey, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    const value = parseInput(glmSchema, input)
    const operation = this.login
    return this.serial(signal, async generation => {
      const name = `glm-${crypto.randomUUID()}.json`
      await this.json(generation, 'POST', `auth-files?name=${encodeURIComponent(name)}`, {
        type: 'glm', api_key: value.apiKey, site: value.site,
        ...value.organization === undefined ? {} : { organization: value.organization },
        ...value.project === undefined ? {} : { project: value.project },
      }, signal)
      if (this.login === operation) this.clearLogin(operation)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override refreshQuota(ref: AccountPoolAccountRef, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    const generation = this.current()
    const account = this.snapshot.accounts.find(account => account.ref === ref)
    if (account === undefined) return Promise.reject(new AccountPoolError('not-found', 'The quota account is no longer present.'))
    return this.track((async () => { await this.observe(generation, account, signal); return this.snapshot })())
  }

  override refreshAllQuota(signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    const generation = this.current()
    const accounts = [...this.snapshot.accounts]
    return this.track((async () => {
      let index = 0
      await Promise.all(Array.from({ length: Math.min(this.config.quotaConcurrency, accounts.length) }, async () => {
        while (index < accounts.length) {
          const account = accounts[index++]!
          await this.observe(generation, account, signal)
        }
      }))
      return this.snapshot
    })())
  }

  override listModels(name: AccountPoolAccountName, signal?: AbortSignal): Promise<readonly AccountPoolModel[]> {
    parseInput(nameSchema, name)
    return this.track((async () => {
      this.account(name)
      if (this.account(name).capabilities.models === 'provider') {
        const payload = parseInput(recordSchema, await this.current().transport.providerCatalog(signal))
        return z.array(z.object({ id: z.string(), owned_by: z.string().optional() })).parse(payload.data)
          .filter(model => model.owned_by === 'zhipu')
          .map(model => ({ id: model.id, ...model.owned_by === undefined ? {} : { ownedBy: model.owned_by } }))
      }
      const payload = parseInput(recordSchema, await this.json(this.current(), 'GET', `auth-files/models?name=${encodeURIComponent(name)}`, undefined, signal))
      return z.array(z.object({ id: z.string().min(1), display_name: z.string().optional(), owned_by: z.string().optional() }))
        .parse(payload.models).map(model => ({ id: model.id,
          ...model.display_name === undefined ? {} : { name: model.display_name },
          ...model.owned_by === undefined ? {} : { ownedBy: model.owned_by } }))
    })())
  }

  override readFields(name: AccountPoolAccountName, signal?: AbortSignal): Promise<AccountPoolEditableFields> {
    return this.track((async () => editableFields(name, await this.readAuth(this.current(), name, signal)))())
  }

  override patchFields(name: AccountPoolAccountName, fields: AccountPoolFieldPatch, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(nameSchema, name)
    parseInput(patchSchema, fields)
    return this.serial(signal, async generation => {
      const existing = await this.readAuth(generation, name, signal)
      await this.json(generation, 'PATCH', 'auth-files/fields', { name, ...coreFieldPatch(fields, existing) }, signal)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  private start(spec: Spec): void {
    if (this.lifetime.signal.aborted) return
    this.supervisor = new Supervisor(this.ctx.subprocess, spec, {
      ready: async generation => {
        this.generation = generation
        await this.refresh()
        void this.track(this.pollCatalog(generation)).catch(() => undefined)
      },
      withdraw: () => { this.withdraw() }, quiesce: () => this.quiesce(), failed: error => { this.failed(error) },
    })
    this.supervisor.start()
  }

  private current(): Generation {
    const generation = this.generation
    if (generation === undefined || generation.signal.aborted || this.lifetime.signal.aborted) {
      throw new AccountPoolError('unavailable', 'The account engine is unavailable.')
    }
    return generation
  }

  private account(name: AccountPoolAccountName): AccountPoolAccount {
    parseInput(nameSchema, name)
    const account = this.snapshot.accounts.find(account => account.name === name)
    if (account === undefined) throw new AccountPoolError('not-found', 'The account is no longer present.')
    return account
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.operations.add(promise)
    void promise.then(() => this.operations.delete(promise), () => this.operations.delete(promise))
    return promise
  }

  private serial<T>(signal: AbortSignal | undefined, operation: (generation: Generation) => Promise<T>): Promise<T> {
    const generation = this.current()
    const task = this.queue.then(async () => {
      signal?.throwIfAborted()
      generation.signal.throwIfAborted()
      return operation(generation)
    })
    this.queue = task.catch(() => undefined)
    return this.track(task)
  }

  private async json(generation: Generation, method: CoreMethod, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return decodeCoreJson(await generation.transport.management(method, `/v0/management/${path}`,
      body === undefined ? undefined : JSON.stringify(body), signal))
  }

  private async readAuth(generation: Generation, name: AccountPoolAccountName, signal?: AbortSignal): Promise<Record<string, unknown>> {
    this.account(name)
    return parseInput(recordSchema, await this.json(generation, 'GET', `auth-files/download?name=${encodeURIComponent(name)}`, undefined, signal))
  }

  private async refreshRoster(generation: Generation, signal?: AbortSignal): Promise<void> {
    const payload = await this.json(generation, 'GET', 'auth-files', undefined, signal)
    const accounts = roster(payload)
    generation.signal.throwIfAborted()
    if (this.generation !== generation) return
    const raw = parseInput(recordSchema, payload).files as unknown[]
    this.rawAccounts.clear()
    for (const value of raw) {
      const record = parseInput(recordSchema, value)
      this.rawAccounts.set(oauthRef(String(record.auth_index)), record)
    }
    const refs = new Set(accounts.map(account => account.ref))
    for (const ref of this.quotas.keys()) if (!refs.has(ref)) this.quotas.delete(ref)
    for (const account of accounts.filter(account => account.provider === 'glm')) {
      const envelope = this.rawAccounts.get(account.ref)
      const quota = envelope === undefined ? undefined : recordSchema.safeParse(envelope.quota)
      const signals = quota?.success === true ? z.record(z.string(), z.string()).safeParse(quota.data.signals) : undefined
      if (signals?.success === true && signals.data['GLM-Quota-Status'] !== undefined) {
        await this.applyQuotaObservation(generation, account, envelope!, signal, false)
      }
    }
    this.publish({ state: 'ready', accounts: accounts.map(account => this.withQuota(account)),
      ...this.snapshot.login === undefined ? {} : { login: this.snapshot.login } })
  }

  private async refreshCatalog(generation: Generation, signal?: AbortSignal): Promise<void> {
    try {
      let catalog = parseAccountPoolCatalog(await generation.transport.catalog(signal))
      const definitions: (readonly AccountPoolCatalogModel[])[] = []
      for (const provider of new Set(this.snapshot.accounts.map(account => account.provider))) {
        const channel = Object.hasOwn(DEFINITION_CHANNEL, provider) ? DEFINITION_CHANNEL[provider] : undefined
        if (channel === undefined) continue
        const payload = await this.json(generation, 'GET', `model-definitions/${channel}`, undefined, signal)
        definitions.push(parseAccountPoolCatalog(payload))
      }
      const availableIds = new Set(catalog.map(model => model.id))
      catalog = mergeAccountPoolCatalogs(catalog, mergeAccountPoolCatalogs(...definitions).filter(model => availableIds.has(model.id)))
      generation.signal.throwIfAborted()
      if (this.generation !== generation) return
      const key = JSON.stringify(catalog)
      if (key === this.catalogKey) return
      if (catalog.length === 0) {
        this.registration?.()
        this.registration = undefined
        this.adapter = undefined
      } else {
        const next = new GenerationAdapter(this.ctx, generation.transport, catalog, this.config)
        this.adapter = next
        if (this.registration === undefined) {
          if (this.ctx.llm.listProviders().some(provider => provider.id === ACCOUNT_POOL_ROUTE)) {
            throw new AccountPoolError('conflict', 'The account-pool model route is already owned by another plugin.')
          }
          this.registration = this.ctx.llm.registerAdapter([ACCOUNT_POOL_ROUTE], this.liveAdapter)
        }
      }
      this.catalogKey = key
    } catch (error) {
      this.registration?.()
      this.registration = undefined
      this.adapter = undefined
      this.catalogKey = undefined
      throw error
    }
  }

  private async pollCatalog(generation: Generation): Promise<void> {
    while (!generation.signal.aborted) {
      await delay(this.config.catalogRefreshIntervalMs, undefined, { signal: generation.signal })
      try { await this.refresh(generation.signal) } catch (error) {
        if (!generation.signal.aborted) this.failed(error)
      }
    }
  }

  private async observe(generation: Generation, account: AccountPoolAccount, signal?: AbortSignal): Promise<void> {
    if (!account.capabilities.quota) return
    const provider = Object.hasOwn(QUOTA_PROVIDER, account.provider) ? QUOTA_PROVIDER[account.provider] : undefined
    if (provider === undefined) throw new AccountPoolError('invalid-input', 'This account has no supported quota observation.')
    let metadata = this.rawAccounts.get(account.ref) ?? {}
    if (provider === 'xai') metadata = { ...metadata, ...await this.readAuth(generation, account.name, signal) }
    if (provider === 'glm') metadata = { ...metadata, ...await this.refreshGlmQuotaEnvelope(generation, account, signal) }
    await this.applyQuotaObservation(generation, account, metadata, signal, true)
  }

  private async applyQuotaObservation(
    generation: Generation, account: AccountPoolAccount, metadata: Record<string, unknown>,
    signal: AbortSignal | undefined, publish: boolean,
  ): Promise<void> {
    const provider = Object.hasOwn(QUOTA_PROVIDER, account.provider) ? QUOTA_PROVIDER[account.provider] : undefined
    if (provider === undefined) return
    const quota = recordSchema.safeParse(metadata.quota)
    const signals = quota.success ? z.record(z.string(), z.string()).safeParse(quota.data.signals) : undefined
    const authIndex = typeof metadata.auth_index === 'string' && metadata.auth_index.length > 0 ? metadata.auth_index : account.ref
    const input: QuotaProbeInput = {
      provider, authIndex: brandString<QuotaProbeInput['authIndex']>(authIndex),
      ...account.projectId === undefined ? {} : { projectId: account.projectId },
      ...provider !== 'xai' ? {} : { xaiAccountKind: isPaidXaiCredential(metadata) ? 'paid' : 'unknown',
        ...typeof metadata.user_id === 'string' ? { xaiUserId: metadata.user_id } : {} },
      ...!signals?.success ? {} : { quotaSignals: { signals: signals.data,
        ...quota.success && typeof quota.data.observed_at === 'string' ? { observedAt: quota.data.observed_at } : {} } },
    }
    // TODO(reuse-observer): reconstructs a generation-scoped factory per account; see 2026-09-15-account-pool-reuse-quota-observer.
    const observation = await createQuotaObserver({ transport: { request: async request => {
      const payload = parseInput(recordSchema, await this.json(generation, 'POST', 'api-call', {
        auth_index: request.authIndex, method: request.method, url: request.url, header: request.headers,
        ...request.body === undefined ? {} : { data: request.body },
      }, signal))
      const response = z.object({ status_code: z.number().int(), body: z.string() }).parse(payload)
      return { statusCode: response.status_code, bodyText: response.body }
    } } }).observe(input)
    generation.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.generation !== generation || (publish && !this.snapshot.accounts.some(candidate => candidate.ref === account.ref))) return
    const previous = this.quotas.get(account.ref)
    this.quotas.set(account.ref, { latest: observation,
      ...observation.status === 'known' || observation.status === 'partial'
        ? { successful: observation } : previous?.successful === undefined ? {} : { successful: previous.successful } })
    if (publish) this.publish({ ...this.snapshot, accounts: this.snapshot.accounts.map(value => this.withQuota(value)) })
  }

  private async refreshGlmQuotaEnvelope(
    generation: Generation, account: AccountPoolAccount, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const payload = parseInput(recordSchema, await this.json(generation, 'POST', `auth-files/quota?name=${encodeURIComponent(account.name)}`, undefined, signal))
    const envelope = {
      auth_index: typeof payload.auth_index === 'string' ? payload.auth_index : '',
      ...payload.quota === undefined ? {} : { quota: payload.quota },
    }
    this.rawAccounts.set(account.ref, envelope)
    return envelope
  }

  private withQuota(account: AccountPoolAccount): AccountPoolAccount {
    const cache = this.quotas.get(account.ref)
    if (cache === undefined) return account
    const source = cache.latest.status === 'known' || cache.latest.status === 'partial' ? cache.latest : cache.successful
    return { ...account, quota: source === undefined ? [] : projectQuotaWindows(source), quotaState: {
      status: cache.latest.status, observedAt: cache.latest.observedAt,
      stale: source !== undefined && source !== cache.latest,
      ...cache.successful === undefined ? {} : { lastSuccessAt: cache.successful.observedAt },
      ...cache.latest.error === undefined ? {} : { error: cache.latest.error },
    }, ...source?.planType === undefined ? {} : { planType: source.planType },
    ...source?.resetCredits?.availableCount === undefined || source.resetCredits.availableCount === null
      ? {} : { resetCreditsAvailable: source.resetCredits.availableCount } }
  }

  private loginSignal(operation: LoginOperation, signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([operation.controller.signal, operation.generation.signal, ...signal ? [signal] : []])
  }

  private async pollLogin(operation: LoginOperation): Promise<void> {
    while (this.login === operation && !operation.controller.signal.aborted && this.snapshot.login?.status === 'pending') {
      await delay(this.config.catalogRefreshIntervalMs, undefined, { signal: this.loginSignal(operation) })
      try { await this.readLogin(operation) } catch (error) {
        if (!operation.controller.signal.aborted && !operation.generation.signal.aborted && this.login === operation) {
          this.publish({ ...this.snapshot, login: { ...this.snapshot.login!, status: 'error', error: 'Account login could not be completed.' } })
        }
        throw error
      }
    }
  }

  private async readLogin(operation: LoginOperation, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    const payload = parseInput(recordSchema, await this.json(operation.generation, 'GET',
      `get-auth-status?state=${encodeURIComponent(operation.state!)}`, undefined, this.loginSignal(operation, signal)))
    if (this.login !== operation) return this.snapshot
    if (payload.status === 'ok') {
      this.clearLogin(operation)
      await this.refresh(signal)
    } else if (payload.status === 'error') {
      this.publish({ ...this.snapshot, login: { ...this.snapshot.login!, status: 'error', error: 'Account login was refused.' } })
    }
    return this.snapshot
  }

  private cancel(operation: LoginOperation, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    operation.controller.abort()
    return this.track((async () => {
      if (operation.state !== undefined && !operation.generation.signal.aborted) {
        await this.json(operation.generation, 'DELETE', `oauth-session?state=${encodeURIComponent(operation.state)}`, undefined, signal)
      }
      this.clearLogin(operation)
      return this.snapshot
    })())
  }

  private clearLogin(operation: LoginOperation | undefined): void {
    if (this.login !== operation) return
    operation?.controller.abort()
    this.login = undefined
    const { login: _login, ...rest } = this.snapshot
    this.publish(rest)
  }

  private publish(snapshot: AccountPoolSnapshot): void {
    if (this.lifetime.signal.aborted) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of this.listeners) {
      try { listener(this.snapshot) } catch (error) { this.ctx.logger.warn('An account snapshot listener failed.', error) }
    }
  }

  private withdraw(): void {
    this.registration?.()
    this.registration = undefined
    this.generation = undefined
    this.adapter = undefined
    this.catalogKey = undefined
    this.login?.controller.abort()
  }

  private async quiesce(): Promise<void> {
    await Promise.allSettled([...this.operations])
  }

  private failed(error: unknown): void {
    if (this.lifetime.signal.aborted) return
    this.registration?.()
    this.registration = undefined
    this.adapter = undefined
    this.catalogKey = undefined
    this.ctx.logger.warn('Account engine operation failed.', error)
    this.publish({ ...this.snapshot, state: 'error', error: error instanceof AccountPoolError
      ? error.message : 'The account engine is unavailable.' })
  }
}

export default CLIProxyAccountPool
