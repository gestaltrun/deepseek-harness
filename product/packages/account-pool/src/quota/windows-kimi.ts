/**
 * Kimi usage-row extraction ported from the official CLIProxyAPI management
 * center (`src/utils/quota/builders.ts` `buildKimiQuotaRows` at ed5f1c48, MIT).
 * Limit lengths use explicit duration metadata. The endpoint's `usage` field
 * is the weekly allocation; absent summary metadata therefore means seven days.
 * Labels never determine a time basis, and invalid explicit metadata stays unknown.
 * Unlike the management center's display rows, missing counters stay absent —
 * they are never defaulted to zero.
 * @module account-pool/quota/windows-kimi
 */

import { normalizeIntValue, normalizeStringValue, asRecord } from './normalize.ts'
import { parseOffsetSecondsToMs, resolveResetMs } from './reset-instants.ts'
import { QUOTA_TOKEN_PLACEHOLDER } from './transport.ts'
import type { KimiUsagePayload, QuotaWindowObservation } from './types.ts'

/** Usage endpoint probed for Kimi accounts. */
export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages'

/** Headers for the Kimi usage probe; the token placeholder stays literal. */
export const KIMI_PROBE_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${QUOTA_TOKEN_PLACEHOLDER}`,
}

type KimiTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week'

/**
 * Kimi sends protobuf-style values such as `TIME_UNIT_MINUTE`. An absent or
 * unrecognized unit is not a fact: unlike the upstream display default, it is
 * never read as minutes.
 */
function normalizeKimiTimeUnit(rawTimeUnit: unknown): KimiTimeUnit | null {
  const unit =
    typeof rawTimeUnit === 'string'
      ? rawTimeUnit.trim().toUpperCase().replace(/^TIME_UNIT_/, '')
      : ''
  if (unit === 'SECONDS' || unit === 'SECOND') return 'second'
  if (unit === 'MINUTES' || unit === 'MINUTE') return 'minute'
  if (unit === 'HOURS' || unit === 'HOUR') return 'hour'
  if (unit === 'DAYS' || unit === 'DAY') return 'day'
  if (unit === 'WEEKS' || unit === 'WEEK') return 'week'
  return null
}

function kimiResetMs(data: Record<string, unknown>, now: number): number | null {
  const absolute = resolveResetMs([
    data['reset_at'],
    data['resetAt'],
    data['reset_time'],
    data['resetTime'],
  ])
  if (absolute !== null) return absolute
  for (const key of ['reset_in', 'resetIn', 'ttl']) {
    const relative = parseOffsetSecondsToMs(data[key], now)
    if (relative !== null) return relative
  }
  return null
}

function kimiPeriodHours(duration: number | null, rawTimeUnit: unknown): number | null {
  if (duration === null || duration <= 0) return null
  const unit = normalizeKimiTimeUnit(rawTimeUnit)
  if (unit === null) return null
  if (unit === 'second') return duration / 3600
  if (unit === 'minute') return duration / 60
  if (unit === 'hour') return duration
  if (unit === 'day') return duration * 24
  return duration * 7 * 24
}

function toKimiWindow(
  key: string,
  data: Record<string, unknown>,
  fallbackLabel: string | undefined,
  periodHours: number | null,
  now: number,
): QuotaWindowObservation | null {
  const limit = normalizeIntValue(data['limit'])
  let used = normalizeIntValue(data['used'])
  const remaining = normalizeIntValue(data['remaining'])
  if (used === null && remaining !== null && limit !== null) {
    used = limit - remaining
  }
  if (used === null && limit === null && remaining === null) return null

  const label =
    normalizeStringValue(data['name']) ?? normalizeStringValue(data['title']) ?? fallbackLabel
  const usedPercent =
    used !== null && limit !== null && limit > 0 ? (used / limit) * 100 : null

  return {
    key,
    ...(label === undefined ? {} : { label }),
    ...(used === null ? {} : { used }),
    ...(limit === null ? {} : { limit }),
    ...(remaining === null ? {} : { remaining }),
    ...(usedPercent === null ? {} : { usedPercent }),
    resetAtMs: kimiResetMs(data, now),
    periodHours,
  }
}

/**
 * Kimi CLI identifies `usage` as Weekly limit, and Kimi documents a seven-day reset.
 * Explicit metadata takes precedence, including an invalid value that keeps time unknown.
 * Sources: https://github.com/MoonshotAI/kimi-cli/blob/86f136422a0aae6b217ea49e7ea1d2e8a1defcd2/src/kimi_cli/ui/shell/usage.py#L113
 * and https://www.kimi.com/help/kimi-code/benefits.
 */
function summaryPeriodHours(usage: Record<string, unknown>): number | null {
  if (!('window' in usage) && !('duration' in usage) && !('timeUnit' in usage)) return 7 * 24
  const metadata = 'window' in usage ? asRecord(usage['window']) : usage
  if (metadata === null) return null
  const period = kimiPeriodHours(normalizeIntValue(metadata['duration']), metadata['timeUnit'])
  return period !== null && Number.isFinite(period) ? period : null
}

/**
 * Extract quota windows from a Kimi usage payload.
 * @param payload - parsed usage response.
 * @param now - reference instant for relative reset hints, in epoch ms.
 * @returns one observation per limit item plus the summary row when present.
 */
export function buildKimiWindows(payload: KimiUsagePayload, now: number): QuotaWindowObservation[] {
  const windows: QuotaWindowObservation[] = []

  const limits = Array.isArray(payload.limits) ? payload.limits : []
  for (const [index, itemValue] of limits.entries()) {
    const item = asRecord(itemValue)
    if (item === null) continue
    const detail = asRecord(item['detail']) ?? item
    const windowMeta = asRecord(item['window']) ?? {}
    const duration =
      normalizeIntValue(windowMeta['duration']) ??
      normalizeIntValue(item['duration']) ??
      normalizeIntValue(detail['duration'])
    const rawTimeUnit = windowMeta['timeUnit'] ?? item['timeUnit'] ?? detail['timeUnit']
    const fallbackLabel =
      normalizeStringValue(item['name']) ??
      normalizeStringValue(item['title']) ??
      normalizeStringValue(item['scope']) ??
      undefined
    const window = toKimiWindow(`limit-${String(index)}`, detail, fallbackLabel, kimiPeriodHours(duration, rawTimeUnit), now)
    if (window !== null) windows.push(window)
  }

  const usage = asRecord(payload.usage)
  if (usage !== null) {
    const summary = toKimiWindow('summary', usage, undefined, summaryPeriodHours(usage), now)
    if (summary !== null) windows.push(summary)
  }

  return windows
}
