/**
 * Codex rate-limit reset-credit parsing ported from the official CLIProxyAPI
 * management center (`src/utils/quota/resetCredits.ts` at ed5f1c48, MIT).
 * Read-only: this module parses the listing endpoint's counts; no consume
 * request exists anywhere in this package.
 * @module account-pool/quota/reset-credits
 */

import { normalizeNumberValue, asRecord } from './normalize.ts'
import type { CodexResetCreditsObservation } from './types.ts'

/** Parse result: counts plus a flag for payloads missing the expected shape. */
export interface CodexResetCreditsParse {
  readonly observation: CodexResetCreditsObservation
  /** True when the payload carried none of the expected fields. */
  readonly invalidPayload: boolean
}

/**
 * Parse the reset-credits listing payload.
 * @param payload - decoded response (already an object at this boundary).
 * @returns the counts, with `invalidPayload` marking shape mismatches.
 */
export function parseCodexResetCredits(payload: unknown): CodexResetCreditsParse {
  const record = asRecord(payload)
  if (record === null) {
    return {
      observation: { availableCount: null, applicableAvailableCount: null, creditCount: 0 },
      invalidPayload: true,
    }
  }

  const hasExpectedShape =
    'credits' in record ||
    'available_count' in record ||
    'availableCount' in record ||
    'applicable_available_count' in record ||
    'applicableAvailableCount' in record
  // A present-but-non-array `credits` is a shape violation, not an empty list:
  // reporting zero credits as a known fact would misrepresent the account.
  const creditsFieldValid = !('credits' in record) || Array.isArray(record['credits'])
  const credits = Array.isArray(record['credits']) ? record['credits'] : []

  return {
    observation: {
      availableCount: normalizeNumberValue(record['available_count'] ?? record['availableCount']),
      applicableAvailableCount: normalizeNumberValue(
        record['applicable_available_count'] ?? record['applicableAvailableCount'],
      ),
      creditCount: credits.length,
    },
    invalidPayload: !hasExpectedShape || !creditsFieldValid,
  }
}
