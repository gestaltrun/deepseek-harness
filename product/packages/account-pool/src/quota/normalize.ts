/**
 * Payload field normalization ported from the official CLIProxyAPI management
 * center (`Cli-Proxy-API-Management-Center` `src/utils/quota/parsers.ts` and
 * `builders.ts` at ed5f1c48, MIT). Providers encode the same fact as numbers,
 * numeric strings, or percentage strings; these helpers collapse that variance
 * without inventing values.
 * @module account-pool/quota/normalize
 */

/**
 * Normalize a string-or-number field to a trimmed string.
 * @param value - raw payload field.
 * @returns the trimmed string, or `null` when absent or empty.
 */
export function normalizeStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString()
  }
  return null
}

/**
 * Normalize a number-or-numeric-string field.
 * @param value - raw payload field.
 * @returns the finite number, or `null` when absent or non-numeric.
 */
export function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Normalize a fraction field that may arrive as a number, a numeric string, or
 * a percentage string (`"73%"` → 0.73).
 * @param value - raw payload field.
 * @returns the fraction, or `null` when absent or non-numeric.
 */
export function normalizeQuotaFraction(value: unknown): number | null {
  const normalized = normalizeNumberValue(value)
  if (normalized !== null) return normalized
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1))
      return Number.isFinite(parsed) ? parsed / 100 : null
    }
  }
  return null
}

/**
 * Normalize a plan marker to lowercase.
 * @param value - raw payload field.
 * @returns the lowercase plan marker, or `null` when absent.
 */
export function normalizePlanType(value: unknown): string | null {
  const normalized = normalizeStringValue(value)
  return normalized === null ? null : normalized.toLowerCase()
}

/**
 * Normalize an integer counter field.
 * @param value - raw payload field.
 * @returns the floored number, or `null` when absent or non-numeric.
 */
export function normalizeIntValue(value: unknown): number | null {
  const numeric = normalizeNumberValue(value)
  return numeric === null ? null : Math.floor(numeric)
}

/**
 * Read a record field when the value is a plain object.
 * @param value - candidate object.
 * @returns the value as a record, or `null` for non-objects and arrays.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
