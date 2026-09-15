import { describe, expect, it } from 'vitest'
import { isPaidXaiCredential } from '../../src/quota/xai-tier.ts'

/** Mint an unsigned JWT-shaped token carrying the given payload. */
function mintJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    globalThis
      .btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'none' })}.${encode(payload)}.`
}

describe('isPaidXaiCredential', () => {
  it('recognizes the documented paid pool route hints together', () => {
    expect(isPaidXaiCredential({ using_api: true, prefix: 'paid' })).toBe(true)
    expect(isPaidXaiCredential({ usingApi: 1, prefix: 'PAID' })).toBe(true)
    expect(isPaidXaiCredential({ using_api: 'yes', prefix: 'paid' })).toBe(true)
  })

  it('rejects either route hint alone', () => {
    expect(isPaidXaiCredential({ using_api: true })).toBe(false)
    expect(isPaidXaiCredential({ prefix: 'paid' })).toBe(false)
    expect(isPaidXaiCredential({ using_api: 'off', prefix: 'paid' })).toBe(false)
  })

  it('recognizes a JWT tier claim of 1 or higher on any stored token', () => {
    expect(isPaidXaiCredential({ access_token: mintJwt({ tier: 1 }) })).toBe(true)
    expect(isPaidXaiCredential({ idToken: mintJwt({ 'https://x.ai/tier': 2 }) })).toBe(true)
    expect(isPaidXaiCredential({ token: mintJwt({ 'auth:tier': 3 }) })).toBe(true)
  })

  it('rejects free and malformed credentials', () => {
    expect(isPaidXaiCredential({ access_token: mintJwt({ tier: 0 }) })).toBe(false)
    expect(isPaidXaiCredential({ access_token: 'not-a-jwt' })).toBe(false)
    expect(isPaidXaiCredential({ access_token: mintJwt({ plan: 'pro' }) })).toBe(false)
    expect(isPaidXaiCredential({ access_token: 'aaa.%%%.bbb' })).toBe(false)
    expect(isPaidXaiCredential({ using_api: true, prefix: 123 })).toBe(false)
    expect(isPaidXaiCredential({ using_api: true, prefix: '  ' })).toBe(false)
    expect(isPaidXaiCredential(null)).toBe(false)
    expect(isPaidXaiCredential('string')).toBe(false)
  })

  it('reads nested metadata records without visiting deep cycles', () => {
    const cyclic: Record<string, unknown> = { access_token: mintJwt({ tier: 1 }) }
    cyclic['metadata'] = cyclic
    expect(isPaidXaiCredential({ oauth: { attributes: { id_token: mintJwt({ tier: 2 }) } } })).toBe(true)
    expect(isPaidXaiCredential(cyclic)).toBe(true)

    const deep = { metadata: { raw: { credential: { auth: { token: mintJwt({ tier: 1 }) } } } } }
    expect(isPaidXaiCredential(deep)).toBe(false)
  })
})
