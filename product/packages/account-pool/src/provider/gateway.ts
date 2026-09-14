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
  type AccountPoolQuotaWindow, type AccountPoolSnapshot,
} from '../account-pool.ts'
import { createQuotaObserver, isPaidXaiCredential, type QuotaObservation, type QuotaProvider } from '../quota/index.ts'
import type { QuotaProbeInput } from '../quota/types.ts'
import { ACCOUNT_POOL_ROUTE, GenerationAdapter, LiveAccountAdapter } from '../llm/adapter.ts'
import { parseAccountPoolCatalog, mergeAccountPoolCatalogs, type AccountPoolCatalogModel } from '../llm/catalog.ts'
import { activeGlmEntries, glmCard, newGlmAccount, patchGlmAccount, type GlmAccount } from './glm.ts'
import { Config, resolve, type Spec } from './config.ts'
import { coreFieldPatch, editableFields, roster } from './redaction.ts'
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
  anthropic: 'claude', claude: 'claude', codex: 'codex', antigravity: 'antigravity', kimi: 'kimi', xai: 'xai',
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
  private readonly definitions = new Map<string, readonly AccountPoolCatalogModel[]>()
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
      const account = this.account(name)
      if (account.provider === 'glm') return this.changeGlm(generation, rows => rows.map(row =>
        glmCard(row).name === name ? { ...row, enabled } : row), signal)
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
      if (account.provider === 'glm') return this.changeGlm(generation, rows => rows.filter(row => glmCard(row).name !== name), signal)
      await this.json(generation, 'DELETE', `auth-files?name=${encodeURIComponent(name)}`, undefined, signal)
      this.quotas.delete(account.ref)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override startLogin(kind: AccountPoolLoginKind, signal?: AbortSignal): Promise<AccountPoolLoginStart> {
    parseInput(kindSchema, kind)
    const generation = this.current()
    this.login?.controller.abort()
    const operation: LoginOperation = { kind, generation, controller: new AbortController() }
    this.login = operation
    const flow = kind === 'glm' ? 'glm-key' : kind === 'kimi' || kind === 'xai' ? 'device' : 'pkce'
    this.publish({ ...this.snapshot, login: { kind, flow, status: 'pending' } })
    return this.track((async () => {
      if (kind === 'glm') return this.snapshot.login!
      try {
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
      await this.changeGlm(generation, rows => [...rows, newGlmAccount({ apiKey: value.apiKey, site: value.site,
        ...value.organization === undefined ? {} : { organization: value.organization },
        ...value.project === undefined ? {} : { project: value.project } })], signal)
      if (this.login === operation) this.clearLogin(operation)
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
    return this.track((async () => {
      if (this.account(name).provider === 'glm') {
        const account = await this.glmAccount(this.current(), name)
        return { name, info: { provider: 'glm', site: account.site,
          ...account.organization === undefined ? {} : { organization: account.organization },
          ...account.project === undefined ? {} : { project: account.project } }, fields: glmCard(account) }
      }
      return editableFields(name, await this.readAuth(this.current(), name, signal))
    })())
  }

  override patchFields(name: AccountPoolAccountName, fields: AccountPoolFieldPatch, signal?: AbortSignal): Promise<AccountPoolSnapshot> {
    parseInput(nameSchema, name)
    parseInput(patchSchema, fields)
    return this.serial(signal, async generation => {
      if (this.account(name).provider === 'glm') return this.changeGlm(generation, rows => rows.map(row =>
        glmCard(row).name === name ? patchGlmAccount(row, fields) : row), signal)
      const existing = await this.readAuth(generation, name, signal)
      await this.json(generation, 'PATCH', 'auth-files/fields', { name, ...coreFieldPatch(fields, existing) }, signal)
      await this.refreshRoster(generation, signal)
      await this.refreshCatalog(generation, signal)
      return this.snapshot
    })
  }

  override downloadAuthFile(name: AccountPoolAccountName, signal?: AbortSignal): Promise<{ name: string; body: string }> {
    parseInput(nameSchema, name)
    const generation = this.current()
    this.account(name)
    return this.track((async () => {
      if (this.account(name).provider === 'glm') {
        const account = await this.glmAccount(generation, name)
        signal?.throwIfAborted()
        return { name, body: JSON.stringify({ type: 'glm-coding-plan', 'api-key': account.apiKey, site: account.site,
          ...account.organization === undefined ? {} : { organization: account.organization },
          ...account.project === undefined ? {} : { project: account.project } }, null, 2) + '\n' }
      }
      const response = await generation.transport.management('GET', `/v0/management/auth-files/download?name=${encodeURIComponent(name)}`, undefined, signal)
      decodeCoreJson(response)
      return { name, body: response.body }
    })())
  }

  private start(spec: Spec): void {
    if (this.lifetime.signal.aborted) return
    this.supervisor = new Supervisor(this.ctx.subprocess, spec, {
      ready: async generation => {
        this.generation = generation
        this.definitions.clear()
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
    const accounts = [...roster(payload), ...(await generation.glm.read()).accounts.map(glmCard)]
    generation.signal.throwIfAborted()
    if (this.generation !== generation) return
    const raw = parseInput(recordSchema, payload).files as unknown[]
    this.rawAccounts.clear()
    for (const value of raw) {
      const record = parseInput(recordSchema, value)
      this.rawAccounts.set(brandString<AccountPoolAccountRef>(`oauth:${String(record.auth_index)}`), record)
    }
    const refs = new Set(accounts.map(account => account.ref))
    for (const ref of this.quotas.keys()) if (!refs.has(ref)) this.quotas.delete(ref)
    this.publish({ state: 'ready', accounts: accounts.map(account => this.withQuota(account)),
      ...this.snapshot.login === undefined ? {} : { login: this.snapshot.login } })
  }

  private async refreshCatalog(generation: Generation, signal?: AbortSignal): Promise<void> {
    try {
      let catalog = parseAccountPoolCatalog(await generation.transport.catalog(signal))
      for (const provider of new Set(this.snapshot.accounts.map(account => account.provider))) {
        const channel = DEFINITION_CHANNEL[provider]
        if (channel === undefined || this.definitions.has(channel)) continue
        const payload = await this.json(generation, 'GET', `model-definitions/${channel}`, undefined, signal)
        this.definitions.set(channel, parseAccountPoolCatalog(payload))
      }
      const definitions = mergeAccountPoolCatalogs(...this.definitions.values())
      const availableIds = new Set(catalog.map(model => model.id))
      catalog = mergeAccountPoolCatalogs(catalog, definitions.filter(model => availableIds.has(model.id)))
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
    const provider = QUOTA_PROVIDER[account.provider]
    if (provider === undefined) throw new AccountPoolError('invalid-input', 'This account has no supported quota observation.')
    let metadata = this.rawAccounts.get(account.ref) ?? {}
    if (provider === 'xai') metadata = { ...metadata, ...await this.readAuth(generation, account.name, signal) }
    const quota = recordSchema.safeParse(metadata.quota)
    const signals = quota.success ? z.record(z.string(), z.string()).safeParse(quota.data.signals) : undefined
    const input: QuotaProbeInput = {
      provider, authIndex: brandString<QuotaProbeInput['authIndex']>(String(metadata.auth_index)),
      ...account.projectId === undefined ? {} : { projectId: account.projectId },
      ...provider !== 'xai' ? {} : { xaiAccountKind: isPaidXaiCredential(metadata) ? 'paid' : 'unknown',
        ...typeof metadata.user_id === 'string' ? { xaiUserId: metadata.user_id } : {} },
      ...!signals?.success ? {} : { quotaSignals: { signals: signals.data,
        ...quota.success && typeof quota.data.observed_at === 'string' ? { observedAt: quota.data.observed_at } : {} } },
    }
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
    if (this.generation !== generation || !this.snapshot.accounts.some(candidate => candidate.ref === account.ref)) return
    const previous = this.quotas.get(account.ref)
    this.quotas.set(account.ref, { latest: observation,
      ...observation.status === 'known' || observation.status === 'partial'
        ? { successful: observation } : previous?.successful === undefined ? {} : { successful: previous.successful } })
    this.publish({ ...this.snapshot, accounts: this.snapshot.accounts.map(value => this.withQuota(value)) })
  }

  private withQuota(account: AccountPoolAccount): AccountPoolAccount {
    const cache = this.quotas.get(account.ref)
    if (cache === undefined) return account
    const source = cache.latest.status === 'known' || cache.latest.status === 'partial' ? cache.latest : cache.successful
    return { ...account, quota: source === undefined ? [] : windows(source), quotaState: {
      status: cache.latest.status, observedAt: cache.latest.observedAt,
      stale: source !== undefined && source !== cache.latest,
      ...cache.successful === undefined ? {} : { lastSuccessAt: cache.successful.observedAt },
      ...cache.latest.error === undefined ? {} : { error: cache.latest.error },
    }, ...source?.planType === undefined ? {} : { planType: source.planType },
    ...source?.resetCredits?.availableCount === undefined || source.resetCredits.availableCount === null
      ? {} : { resetCreditsAvailable: source.resetCredits.availableCount } }
  }

  private async glmAccount(generation: Generation, name: AccountPoolAccountName): Promise<GlmAccount> {
    const account = (await generation.glm.read()).accounts.find(account => glmCard(account).name === name)
    if (account === undefined) throw new AccountPoolError('not-found', 'The GLM account is no longer present.')
    return account
  }

  private async changeGlm(
    generation: Generation, mutate: (accounts: readonly GlmAccount[]) => readonly GlmAccount[], signal?: AbortSignal,
  ): Promise<AccountPoolSnapshot> {
    try {
      await generation.glm.update(mutate, async (accounts, recovery) => {
        await this.json(generation, 'PUT', 'glm-coding-plan', activeGlmEntries(accounts), recovery ? generation.signal : signal)
        if (!recovery) signal?.throwIfAborted()
      })
    } catch (error) {
      if (error instanceof AccountPoolError && error.code === 'unavailable') generation.retire()
      throw error
    }
    await this.refreshRoster(generation, generation.signal)
    await this.refreshCatalog(generation, generation.signal)
    return this.snapshot
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

function windows(observation: QuotaObservation): AccountPoolQuotaWindow[] {
  return observation.windows.map(window => {
    const remaining = window.remainingFraction === undefined
      ? window.usedPercent === undefined ? undefined : 100 - window.usedPercent : window.remainingFraction * 100
    const reset = window.resetAtMs
    const period = window.periodHours
    return { key: window.key, label: window.label ?? window.key, status: observation.status,
      ...remaining === undefined ? {} : { remainingPercent: Math.min(100, Math.max(0, remaining)) },
      ...typeof reset !== 'number' ? {} : { resetAtMs: reset },
      ...typeof period !== 'number' ? {} : { periodHours: period },
      ...remaining === undefined || typeof period !== 'number' || period <= 0 || typeof reset !== 'number' ? {}
        : { timeRemainingPercent: Math.min(100, Math.max(0, (reset - observation.observedAt) / (period * 3600000) * 100)) },
      ...window.group === undefined ? {} : { group: window.group },
      ...window.groupDescription === undefined ? {} : { groupDescription: window.groupDescription },
    }
  })
}
