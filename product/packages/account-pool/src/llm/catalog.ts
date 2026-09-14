/** Parse CLIProxyAPI `/v1/models` rows into pi-ai provider model profiles. */

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** One catalog model the Models page can adopt. */
export interface AccountPoolCatalogModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly input?: readonly ('text' | 'image')[]
  readonly reasoningEfforts?: false | Readonly<Record<string, string | null>>
  readonly defaultReasoningLevel?: ThinkingLevel
}

/**
 * Read one OpenAI-compatible or Codex-client listing, keeping gateway capacity and think-level fields.
 * @param value - JSON body of `GET /v1/models` (`data`) or `GET /v1/models?client_version=` (`models`).
 * @returns usable catalog rows in endpoint order.
 */
export function parseAccountPoolCatalog(value: unknown): readonly AccountPoolCatalogModel[] {
  const rows = listingRows(value)
  if (rows === undefined) throw new Error('account-pool catalog JSON is invalid')
  const models: AccountPoolCatalogModel[] = []
  for (const entry of rows) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = label(record.id, record.slug)
    if (id === undefined) continue
    const name = label(record.name, record.display_name)
    const contextWindow = capacity(record.context_window, record.context_length, record.max_context_length, record.inputTokenLimit)
    const maxTokens = capacity(record.max_output_tokens, record.max_tokens, record.max_completion_tokens, record.outputTokenLimit)
    const input = modalities(record.input_modalities ?? record.supportedInputModalities)
    const reasoning = reasoningProfile(record)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...input === undefined ? {} : { input },
      ...reasoning,
    })
  }
  return models
}

/**
 * Union catalog rows by id, keeping the first listing's order and filling gaps from later listings.
 * @param listings - Catalogs in preference order; earlier rows win on the same id.
 * @returns merged catalog.
 */
export function mergeAccountPoolCatalogs(
  ...listings: readonly (readonly AccountPoolCatalogModel[])[]
): readonly AccountPoolCatalogModel[] {
  const merged: AccountPoolCatalogModel[] = []
  const indexById = new Map<string, number>()
  for (const listing of listings) {
    for (const model of listing) {
      const existing = indexById.get(model.id)
      if (existing === undefined) {
        indexById.set(model.id, merged.length)
        merged.push(model)
        continue
      }
      const current = merged[existing]
      if (current === undefined) continue
      merged[existing] = fillCatalogModel(current, model)
    }
  }
  return merged
}

function listingRows(value: unknown): readonly unknown[] | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if ('data' in value && Array.isArray(value.data)) return value.data
  if ('models' in value && Array.isArray(value.models)) return value.models
  return undefined
}

function fillCatalogModel(
  current: AccountPoolCatalogModel,
  extra: AccountPoolCatalogModel,
): AccountPoolCatalogModel {
  const name = current.name ?? extra.name
  const contextWindow = current.contextWindow ?? extra.contextWindow
  const maxTokens = current.maxTokens ?? extra.maxTokens
  const input = current.input ?? extra.input
  const reasoningEfforts = current.reasoningEfforts ?? extra.reasoningEfforts
  const defaultReasoningLevel = current.defaultReasoningLevel ?? extra.defaultReasoningLevel
  return {
    id: current.id,
    ...name === undefined ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...input === undefined ? {} : { input },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    ...defaultReasoningLevel === undefined ? {} : { defaultReasoningLevel },
  }
}

function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

function modalities(value: unknown): readonly ('text' | 'image')[] | undefined {
  if (!Array.isArray(value)) return undefined
  const input = new Set<'text' | 'image'>()
  for (const entry of value) {
    const normalized = typeof entry === 'string' ? entry.toLowerCase() : entry
    if (normalized === 'text' || normalized === 'image') input.add(normalized)
  }
  if (input.size === 0) return undefined
  return [...input]
}

function reasoningProfile(record: Record<string, unknown>): Pick<AccountPoolCatalogModel, 'reasoningEfforts' | 'defaultReasoningLevel'> {
  if (record.reasoning === false) return { reasoningEfforts: false }
  const levels = Array.isArray(record.supported_reasoning_levels)
    ? record.supported_reasoning_levels
    : Array.isArray(record.reasoning_efforts)
      ? record.reasoning_efforts
      : undefined
  if (levels === undefined) return {}
  const efforts: Record<string, string | null> = {}
  for (const entry of levels) {
    const mapped = mapThinkingLevel(entry)
    if (mapped === undefined) continue
    efforts[mapped.level] = mapped.wire
  }
  if (!Object.keys(efforts).some(level => level !== 'off')) return { reasoningEfforts: false }
  const defaultLevel = mapThinkingLevel(record.default_reasoning_level)?.level
  return {
    reasoningEfforts: efforts,
    ...defaultLevel === undefined || efforts[defaultLevel] === undefined ? {} : { defaultReasoningLevel: defaultLevel },
  }
}

function mapThinkingLevel(value: unknown): { level: ThinkingLevel; wire: string | null } | undefined {
  const raw = typeof value === 'string'
    ? value
    : value !== null && typeof value === 'object'
      ? label((value as Record<string, unknown>).effort, (value as Record<string, unknown>).value)
      : undefined
  if (raw === undefined) return undefined
  if (raw === 'none' || raw === 'off') return { level: 'off', wire: null }
  if (raw === 'ultra') return { level: 'max', wire: 'ultra' }
  if ((THINKING_LEVELS as readonly string[]).includes(raw)) return { level: raw as ThinkingLevel, wire: raw }
  return undefined
}
