/**
 * Antigravity quota-bucket extraction ported from the official CLIProxyAPI
 * management center (`src/utils/quota/builders.ts` `buildAntigravityQuotaGroups`
 * at ed5f1c48, MIT). Buckets state their period explicitly in `window`; the
 * accepted spellings are `5h`/`five-hour`/`five_hour` and `weekly`/`week`.
 * An unknown spelling keeps the balance and reset fact but yields
 * `periodHours: null` — no duration is ever guessed.
 * @module account-pool/quota/windows-antigravity
 */

import { normalizeQuotaFraction, normalizeStringValue, asRecord } from './normalize.ts'
import { resolveResetMs } from './reset-instants.ts'
import { QUOTA_TOKEN_PLACEHOLDER } from './transport.ts'
import type { QuotaWindowObservation } from './types.ts'

/** Quota-summary endpoints probed in order until one answers with groups. */
export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
] as const

/** User-Agent the Antigravity quota endpoint expects from its CLI. */
export const ANTIGRAVITY_USER_AGENT = 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)'

/** Headers for the Antigravity quota probe; the token placeholder stays literal. */
export const ANTIGRAVITY_PROBE_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${QUOTA_TOKEN_PLACEHOLDER}`,
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
}

/**
 * Window length in hours for an Antigravity bucket window spelling.
 * @param window - the bucket's `window` string.
 * @returns 5 or 168 hours, or `null` for any other spelling.
 */
export function antigravityPeriodHours(window: string | undefined): number | null {
  switch ((window ?? '').trim().toLowerCase()) {
    case '5h':
    case 'five-hour':
    case 'five_hour':
      return 5
    case 'weekly':
    case 'week':
      return 24 * 7
    default:
      return null
  }
}

function windowOrder(periodHours: number | null): number {
  if (periodHours === 5) return 0
  if (periodHours === 24 * 7) return 1
  return Number.MAX_SAFE_INTEGER
}

function toStableKey(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? fallback : normalized
}

/**
 * Extract quota windows from a `retrieveUserQuotaSummary` payload.
 * @param payload - parsed response (object form; the observer unwraps text).
 * @returns one observation per bucket with a source-supplied remaining fraction,
 *   ordered 5-hour first, weekly second, unknown windows last.
 */
export function buildAntigravityWindows(payload: unknown): QuotaWindowObservation[] {
  const root = asRecord(payload)
  const groups = Array.isArray(root?.['groups']) ? root['groups'] : []
  const windows: QuotaWindowObservation[] = []

  for (const [groupIndex, groupValue] of groups.entries()) {
    const group = asRecord(groupValue)
    if (group === null) continue
    const groupLabel =
      normalizeStringValue(group['displayName'] ?? group['display_name']) ??
      `Quota Group ${String(groupIndex + 1)}`
    const groupDescription = normalizeStringValue(group['description']) ?? undefined
    const groupKey = toStableKey(groupLabel, `quota-group-${String(groupIndex + 1)}`)
    const buckets = Array.isArray(group['buckets']) ? group['buckets'] : []
    const groupWindows: QuotaWindowObservation[] = []

    for (const [bucketIndex, bucketValue] of buckets.entries()) {
      const bucket = asRecord(bucketValue)
      if (bucket === null) continue
      const remainingFraction = normalizeQuotaFraction(
        bucket['remainingFraction'] ?? bucket['remaining_fraction'],
      )
      if (remainingFraction === null) continue

      const windowName = normalizeStringValue(bucket['window']) ?? undefined
      const key =
        normalizeStringValue(bucket['bucketId'] ?? bucket['bucket_id']) ??
        `${groupKey}-${windowName ?? `bucket-${String(bucketIndex + 1)}`}`
      const label = normalizeStringValue(bucket['displayName'] ?? bucket['display_name']) ?? key
      const periodHours = antigravityPeriodHours(windowName)

      groupWindows.push({
        key,
        label,
        remainingFraction,
        resetAtMs: resolveResetMs([bucket['resetTime'] ?? bucket['reset_time']]),
        periodHours,
        group: groupLabel,
        ...groupDescription === undefined ? {} : { groupDescription },
      })
    }
    groupWindows.sort((a, b) => {
      const orderDiff = windowOrder(a.periodHours ?? null) - windowOrder(b.periodHours ?? null)
      return orderDiff === 0 ? a.key.localeCompare(b.key) : orderDiff
    })
    windows.push(...groupWindows)
  }

  return windows
}
