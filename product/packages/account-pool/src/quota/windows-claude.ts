/**
 * Claude usage-window extraction ported from the official CLIProxyAPI
 * management center (`src/features/quota/providers/claude/data.ts`
 * `buildClaudeQuotaWindows` at ed5f1c48, MIT). Labels stay as stable keys:
 * display naming is the consumer's locale business.
 * @module account-pool/quota/windows-claude
 */

import { normalizeNumberValue, normalizeStringValue, asRecord } from './normalize.ts'
import { claudePeriodHours, resolveResetMs } from './reset-instants.ts'
import { QUOTA_TOKEN_PLACEHOLDER } from './transport.ts'
import type { ClaudeUsagePayload, QuotaWindowObservation } from './types.ts'

/** Usage endpoint probed for Claude accounts. */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** Headers for the Claude usage probe; the token placeholder stays literal. */
export const CLAUDE_PROBE_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${QUOTA_TOKEN_PLACEHOLDER}`,
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
}

/** Named windows on the Claude usage payload, in display order. */
export const CLAUDE_USAGE_WINDOW_KEYS = [
  'five_hour',
  'seven_day',
  'seven_day_oauth_apps',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_cowork',
  'iguana_necktie',
] as const

/** Window key used for the model-scoped Fable weekly limit. */
export const CLAUDE_FABLE_WINDOW_KEY = 'seven_day_fable'

interface FableUsageLimit {
  readonly limit: Record<string, unknown>
  readonly percent: number
}

function findFableUsageLimit(payload: ClaudeUsagePayload): FableUsageLimit | null {
  const limits = payload['limits']
  if (!Array.isArray(limits)) return null

  const candidates = limits.flatMap((limitValue) => {
    const limit = asRecord(limitValue)
    if (limit === null) return []
    const percent = normalizeNumberValue(limit['percent'])
    const kind = (normalizeStringValue(limit['kind']) ?? '').toLowerCase()
    const scope = asRecord(limit['scope'])
    const model = asRecord(scope?.['model'])
    const modelName = (normalizeStringValue(model?.['display_name']) ?? '').toLowerCase()
    const isFable = modelName === 'fable' || modelName === 'fable 5'
    return kind === 'weekly_scoped' && isFable && percent !== null ? [{ limit, percent }] : []
  })

  const found = candidates.find(candidate => candidate.limit['is_active'] === true) ?? candidates[0]
  return found ?? null
}

/**
 * Extract quota windows from a Claude usage payload.
 * @param payload - parsed usage response.
 * @returns one observation per window the payload actually carries.
 */
export function buildClaudeWindows(payload: ClaudeUsagePayload): QuotaWindowObservation[] {
  const windows: QuotaWindowObservation[] = []
  const fableLimit = findFableUsageLimit(payload)

  for (const key of CLAUDE_USAGE_WINDOW_KEYS) {
    if (key === 'iguana_necktie' && fableLimit !== null) continue
    const window = asRecord(payload[key])
    if (window === null || !('utilization' in window)) continue
    const usedPercent = normalizeNumberValue(window['utilization'])
    windows.push({
      key,
      ...(usedPercent === null ? {} : { usedPercent }),
      resetAtMs: resolveResetMs([window['resets_at']]),
      periodHours: claudePeriodHours(key),
    })
  }

  if (fableLimit !== null) {
    windows.push({
      key: CLAUDE_FABLE_WINDOW_KEY,
      usedPercent: fableLimit.percent,
      resetAtMs: resolveResetMs([fableLimit.limit['resets_at']]),
      // `weekly_scoped` is a 7-day window by definition.
      periodHours: claudePeriodHours('seven_day'),
    })
  }

  return windows
}
