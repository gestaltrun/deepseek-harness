import { describe, expect, it } from 'vitest'
import { SANITIZED_ERROR_MAX_CHARS, sanitizeProbeError } from '../../src/quota/sanitize.ts'

describe('sanitizeProbeError', () => {
  it('passes through ordinary messages', () => {
    expect(sanitizeProbeError('provider answered status 503')).toBe('provider answered status 503')
  })

  it('uses the message of Error instances', () => {
    expect(sanitizeProbeError(new Error('socket closed'))).toBe('socket closed')
  })

  it('redacts bearer headers and token-shaped fragments', () => {
    expect(sanitizeProbeError('Authorization: Bearer abcdef123456')).toBe(
      'Authorization: Bearer [redacted]',
    )
    expect(sanitizeProbeError('key sk-abcdefghijklmnop rejected')).toBe('key [redacted] rejected')
    expect(sanitizeProbeError('tok_abcdefghijklmnop')).toBe('[redacted]')
    expect(sanitizeProbeError('jwt eyJhbGciOiJIUzI1NiJ9.payload')).toBe('jwt [redacted]')
  })

  it('bounds oversized messages', () => {
    const long = 'x'.repeat(SANITIZED_ERROR_MAX_CHARS + 500)
    const sanitized = sanitizeProbeError(long)
    expect(sanitized.length).toBe(SANITIZED_ERROR_MAX_CHARS)
  })
})
