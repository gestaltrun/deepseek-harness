/** Per-model defaults stored beside the official pi-ai model declarations. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Provider and model identity select an optional configured reasoning default. */
export type ModelDefaultReader = (provider: string, model: string) => string | undefined

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function profiles(value: unknown): Record<string, unknown> {
  return record(value) && record(value.providers) ? value.providers : {}
}

/**
 * Reject malformed defaults before the official Settings provider persists a change.
 * @param value - Resolved pi-ai namespace, including preserved product fields.
 */
export function validateModelDefaults(value: unknown): void {
  for (const [provider, profile] of Object.entries(profiles(value))) {
    if (!record(profile)) continue
    const models: Array<[string, unknown]> = Array.isArray(profile.models)
      ? profile.models.map(model => [record(model) && typeof model.id === 'string' ? model.id : '', model]) : []
    if (record(profile.modelOverrides)) models.push(...Object.entries(profile.modelOverrides))
    for (const [id, model] of models) {
      if (!record(model) || model.defaultReasoningLevel === undefined) continue
      const level = model.defaultReasoningLevel
      if (typeof level !== 'string' || !THINKING_LEVELS.some(candidate => candidate === level)) {
        throw new Error(`model-center: ${provider}/${id} defaultReasoningLevel must name a supported thinking level`)
      }
      if (model.reasoningEfforts === false || (record(model.reasoningEfforts) && !Object.hasOwn(model.reasoningEfforts, level))) {
        throw new Error(`model-center: ${provider}/${id} defaultReasoningLevel ${level} is absent from reasoningEfforts`)
      }
    }
  }
}

/**
 * Read a model default without inventing one for a missing or inherited field.
 * @param value - Current validated pi-ai settings snapshot.
 * @param provider - Registered provider route.
 * @param model - Exact model identifier.
 * @returns Product default, or undefined to retain the adapter's provider default.
 */
export function modelDefault(value: unknown, provider: string, model: string): string | undefined {
  const profile = profiles(value)[provider]
  if (!record(profile)) return undefined
  const entry: unknown = Array.isArray(profile.models)
    ? profile.models.find(item => record(item) && item.id === model)
    : record(profile.modelOverrides) ? profile.modelOverrides[model] : undefined
  return record(entry) && typeof entry.defaultReasoningLevel === 'string' ? entry.defaultReasoningLevel : undefined
}
