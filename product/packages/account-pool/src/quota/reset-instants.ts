/**
 * Reset-instant parsing ported from the official CLIProxyAPI management center
 * (`src/utils/quota/resetInstants.ts` at ed5f1c48, MIT). Providers disagree
 * about key names and encodings; these helpers accept ISO-8601 strings, Unix
 * seconds or milliseconds, and relative offsets, and decline everything else
 * with `null` rather than guessing.
 * @module account-pool/quota/reset-instants
 */

/** Milliseconds in an hour; window periods are expressed in hours throughout. */
const HOUR_MS = 3_600_000

/**
 * Parse an ISO-8601 timestamp to epoch ms, tolerating over-precise fractional
 * seconds (`.123456789`) that some engines reject.
 * @param value - candidate timestamp.
 * @returns epoch ms, or `null` when unparseable.
 */
export function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const normalized = trimmed.replace(/(\.\d{6})\d+/, '$1')
  const ms = new Date(normalized).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Parse a Unix timestamp to epoch ms, accepting seconds or milliseconds,
 * disambiguated by magnitude: seconds stay ~1e9 well past 2200 while
 * milliseconds are ~1e12 today.
 * @param value - candidate timestamp.
 * @returns epoch ms, or `null` when absent or non-positive.
 */
export function parseUnixToMs(value: unknown): number | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric < 1e11 ? numeric * 1000 : numeric
}

/**
 * Resolve a seconds-from-now offset to an absolute instant.
 * @param value - offset in seconds.
 * @param now - reference instant in epoch ms.
 * @returns the absolute instant, or `null` when the offset is absent or non-positive.
 */
export function parseOffsetSecondsToMs(value: unknown, now: number): number | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return now + numeric * 1000
}

/**
 * Resolve the first parseable reset instant among candidates, trying ISO then
 * Unix encoding for each.
 * @param candidates - raw reset fields in priority order.
 * @returns epoch ms, or `null` when no candidate parses.
 */
export function resolveResetMs(candidates: readonly unknown[]): number | null {
  for (const candidate of candidates) {
    const iso = parseIsoToMs(candidate)
    if (iso !== null) return iso
    const unix = parseUnixToMs(candidate)
    if (unix !== null) return unix
  }
  return null
}

/**
 * Convert a window length in seconds to hours.
 * @param value - window length in seconds.
 * @returns hours, or `null` when absent or non-positive.
 */
export function periodHoursFromSeconds(value: unknown): number | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return (numeric * 1000) / HOUR_MS
}

/**
 * Window length implied by a Claude usage key: Claude reports named windows
 * rather than durations — `five_hour` is a rolling 5-hour window, every other
 * key on that payload is a 7-day one.
 * @param windowKey - Claude usage payload key.
 * @returns the window length in hours.
 */
export function claudePeriodHours(windowKey: string): number {
  return windowKey === 'five_hour' ? 5 : 24 * 7
}
