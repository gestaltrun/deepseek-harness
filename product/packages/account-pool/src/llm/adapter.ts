/** Public PiAi provider composition with immutable catalog and generation authority. */
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy, resolveImageAttachmentAccess,
  type GenerateOptions, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider, InMemoryCredentialStore, type Api, type Model, type ProviderStreams, type ThinkingLevelMap } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type {} from '@deepseek-ai/dsh-fs'
import type { Config } from '../provider/config.ts'
import type { GenerationTransport } from '../provider/transport.ts'
import type { AccountPoolCatalogModel } from './catalog.ts'

/** Stable route id; generation credentials never become provider settings. */
export const ACCOUNT_POOL_ROUTE = 'gestalt-account-pool'

/** Generation consumer that retains its prepared calls and awaits admitted stream settlement. */
export class GenerationAdapter extends LlmAdapter {
  private readonly delegate: PiAiAdapter
  private readonly models: ReadonlyMap<string, AccountPoolCatalogModel>

  /**
   * @param ctx - public attachment and filesystem services.
   * @param transport - generation-private HTTP/SSE authority.
   * @param catalog - available model metadata from this generation's catalog.
   * @param config - product-owned request budgets and retry policy.
   */
  constructor(ctx: Context, private readonly transport: GenerationTransport, catalog: readonly AccountPoolCatalogModel[], config: Config) {
    super()
    this.models = new Map(catalog.map(model => [model.id, model]))
    const official = openAICompletionsApi()
    const ownedStreams: ProviderStreams = {
      stream(model, context, options) {
        transport.signal.throwIfAborted()
        return official.stream(model, context, { ...options, fetch: transport.fetch,
          signal: options?.signal ? AbortSignal.any([options.signal, transport.signal]) : transport.signal })
      },
      streamSimple(model, context, options) {
        transport.signal.throwIfAborted()
        return official.streamSimple(model, context, { ...options, fetch: transport.fetch,
          signal: options?.signal ? AbortSignal.any([options.signal, transport.signal]) : transport.signal })
      },
    }
    const models: Model<Api>[] = catalog.map(model => {
      const thinkingLevelMap: ThinkingLevelMap = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null }
      if (model.reasoningEfforts) {
        for (const [level, wire] of Object.entries(model.reasoningEfforts)) {
          if (level in thinkingLevelMap) {
            // A source off entry is supported with wire omission; null means unsupported to pi-ai.
            Object.assign(thinkingLevelMap, { [level]: wire === null ? '' : wire })
          }
        }
      }
      return {
        id: model.id, name: model.name ?? model.id, provider: ACCOUNT_POOL_ROUTE, api: 'openai-completions',
        baseUrl: `${transport.origin}/v1`, input: [...model.input ?? ['text']],
        contextWindow: model.contextWindow ?? config.unknownContextBudget,
        maxTokens: model.maxTokens ?? config.requestTokenBudget,
        reasoning: Boolean(model.reasoningEfforts), thinkingLevelMap,
        // The SDK requires arithmetic costs; no product pricing metadata is derived from these placeholders.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }
    })
    const piProvider = createProvider<Api>({ id: ACCOUNT_POOL_ROUTE, name: 'Account pool', models, api: ownedStreams,
      auth: { apiKey: { name: 'Owned inference credential', resolve: () => Promise.resolve({ auth: { apiKey: transport.inferenceKey } }) } },
    })
    const profile: ResolvedPiAiProviderProfile = {
      provider: ACCOUNT_POOL_ROUTE, displayName: 'Account pool', api: 'openai-completions', baseURL: `${transport.origin}/v1`,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs, maxRequestImageBytes: config.maxRequestImageBytes,
      requestImagePixelBudget: config.requestImagePixelBudget, requestImageMaxBytes: config.requestImageMaxBytes,
      retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: config.maxRetries }, 'account-pool'), piProvider,
      modelErrors: new Map(), configuredMaxTokens: new Map(catalog.map(model => [model.id,
        Math.min(model.maxTokens ?? config.requestTokenBudget, config.requestTokenBudget)])),
    }
    const profiles = new Map([[ACCOUNT_POOL_ROUTE, profile]])
    this.delegate = new PiAiAdapter({
      profiles: () => profiles, resolveApiKey: () => Promise.resolve(transport.inferenceKey),
      auth: { credentials: new InMemoryCredentialStore(), authContext: {
        env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false),
      } },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
        path => ctx.get('fs')?.processPathFromHostPath(path), ref),
    })
  }

  override providerInfo(provider: string) { return this.delegate.providerInfo(provider) }
  override providerRetryPolicy(provider: string) { return this.delegate.providerRetryPolicy(provider) }
  override imageRequestPricing(provider: string, model: string) { return this.delegate.imageRequestPricing(provider, model) }
  override listModels(provider: string) { return this.delegate.listModels(provider) }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.transport.signal.throwIfAborted()
    return this.metadata(await this.delegate.resolveModel(provider, model, signal))
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    this.transport.signal.throwIfAborted()
    const prepared = await this.delegate.prepareCall(provider, model, signal)
    const metadata = this.metadata(prepared.model)
    return { model: metadata, stream: options => this.admitted(prepared, metadata, options) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal)
    yield* prepared.stream(options)
  }

  /** Await every admitted stream after its generation has been revoked. */
  async quiesce(): Promise<void> { await this.transport.quiesce() }

  private metadata(info: LlmResolvedModelInfo): LlmResolvedModelInfo {
    const catalog = this.models.get(info.id)
    if (catalog === undefined) throw new LlmError('The account model is not in this catalog generation.', 'MODEL_NOT_FOUND')
    const { context: _context, inputModalities: _input, reasoning, ...rest } = info
    const selected = catalog.defaultReasoningLevel
    return { ...rest,
      ...catalog.contextWindow === undefined ? {} : { context: { contextWindow: catalog.contextWindow } },
      ...catalog.input === undefined ? {} : { inputModalities: catalog.input },
      ...reasoning === undefined ? {} : { reasoning: { ...reasoning,
        ...selected === undefined ? {} : { defaultEffort: ReasoningEffortId(selected) } } },
    }
  }

  private admitted(prepared: PreparedAdapterCall, metadata: LlmResolvedModelInfo, options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.transport.signal.throwIfAborted()
    const effort = options.reasoningEffort ?? metadata.reasoning?.defaultEffort
    return this.transport.ownStream(prepared.stream({ ...options,
      signal: options.signal ? AbortSignal.any([options.signal, this.transport.signal]) : this.transport.signal,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }))
  }

}

/** Stable registration wrapper; preparation captures the complete immutable delegate. */
export class LiveAccountAdapter extends LlmAdapter {
  /** @param current - current admitted catalog or an explicit unavailable failure. */
  constructor(private readonly current: () => GenerationAdapter) { super() }
  override providerInfo(provider: string) { return this.current().providerInfo(provider) }
  override providerRetryPolicy(provider: string) { return this.current().providerRetryPolicy(provider) }
  override imageRequestPricing(provider: string, model: string) { return this.current().imageRequestPricing(provider, model) }
  override listModels(provider: string) { return this.current().listModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) { return this.current().resolveModel(provider, model, signal) }
  override prepareCall(provider: string, model: string, signal?: AbortSignal) { return this.current().prepareCall(provider, model, signal) }
  override stream(options: GenerateOptions) { return this.current().stream(options) }
}
