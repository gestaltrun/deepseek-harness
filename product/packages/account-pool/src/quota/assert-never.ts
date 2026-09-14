/**
 * Compile-time exhaustiveness guard for closed unions.
 * @module account-pool/quota/assert-never
 */

/**
 * Reject an unhandled union member.
 * @param value - the member the switch did not handle.
 * @returns never; always throws.
 */
export function assertNever(value: never): never {
  throw new Error(`cliproxy-quota: unhandled provider ${String(value)}`)
}
