/** Product reasoning defaults resolved before official request preparation and logging. */
import {
  LlmAdapter, LlmError, ReasoningEffortId,
  type GenerateOptions, type LlmResolvedModelInfo, type PreparedAdapterCall,
} from '@deepseek-ai/dsh-llm'
import type { ModelDefaultReader } from './model-defaults.ts'

function withDefault(info: LlmResolvedModelInfo, selected: string | undefined): LlmResolvedModelInfo {
  if (selected === undefined) return info
  if (!info.reasoning?.efforts.some(effort => effort.id === selected)) {
    throw new LlmError(`model-center: ${info.provider}/${info.id} does not offer default effort ${selected}`,
      'UNSUPPORTED_REASONING_EFFORT')
  }
  return { ...info, reasoning: { ...info.reasoning, defaultEffort: ReasoningEffortId(selected) } }
}

/** Delegate provider behavior and retain one delegate generation for each prepared request. */
export class ModelDefaultsAdapter extends LlmAdapter {
  constructor(private readonly delegate: LlmAdapter, private readonly readDefault: ModelDefaultReader) { super() }

  override providerInfo(provider: string) { return this.delegate.providerInfo(provider) }
  override providerRetryPolicy(provider: string) { return this.delegate.providerRetryPolicy(provider) }
  override imageRequestPricing(provider: string, model: string) { return this.delegate.imageRequestPricing(provider, model) }
  override listModels(provider: string) { return this.delegate.listModels(provider) }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const selected = this.readDefault(provider, model)
    return withDefault(await this.delegate.resolveModel(provider, model, signal), selected)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const selected = this.readDefault(provider, model)
    const prepared = await this.delegate.prepareCall(provider, model, signal)
    return { model: withDefault(prepared.model, selected), stream: options => prepared.stream(options) }
  }

  override async * stream(options: GenerateOptions) {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal)
    const effort = options.reasoningEffort ?? prepared.model.reasoning?.defaultEffort
    yield* prepared.stream({ ...options, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
  }
}
