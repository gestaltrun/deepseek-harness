/**
 * Output sanitization for observations. Probes never receive credentials, so
 * this is the defensive boundary for error text that could still echo an
 * Authorization header or token-shaped fragment from an upstream message.
 * @module account-pool/quota/sanitize
 */

/** Maximum length of a sanitized observation error, in characters. */
export const SANITIZED_ERROR_MAX_CHARS = 300

const BEARER_PATTERN = /bearer\s+\S+/gi
const TOKEN_SHAPE_PATTERN = /\b(?:sk|tok|key|pat|xai|jwt|eyJ)[\w.-]{12,}/g

/**
 * Sanitize an arbitrary error value for observation output: credential-shaped
 * fragments are redacted and the result is bounded.
 * @param value - caught error or upstream message.
 * @returns a bounded, credential-free message.
 */
export function sanitizeProbeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value)
  const redacted = raw
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(TOKEN_SHAPE_PATTERN, '[redacted]')
  return redacted.length > SANITIZED_ERROR_MAX_CHARS
    ? redacted.slice(0, SANITIZED_ERROR_MAX_CHARS)
    : redacted
}
