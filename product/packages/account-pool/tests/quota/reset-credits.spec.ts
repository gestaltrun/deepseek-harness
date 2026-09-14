import { describe, expect, it } from 'vitest'
import { parseCodexResetCredits } from '../../src/quota/reset-credits.ts'

describe('parseCodexResetCredits', () => {
  it('parses counts and lists credit records', () => {
    const parsed = parseCodexResetCredits({
      available_count: 3,
      applicable_available_count: 2,
      credits: [{ id: 'a' }, { id: 'b' }],
    })
    expect(parsed.invalidPayload).toBe(false)
    expect(parsed.observation).toEqual({
      availableCount: 3,
      applicableAvailableCount: 2,
      creditCount: 2,
    })
  })

  it('accepts camelCase fields and a credits-only shape', () => {
    const parsed = parseCodexResetCredits({ availableCount: '5', applicableAvailableCount: 2 })
    expect(parsed.invalidPayload).toBe(false)
    expect(parsed.observation).toEqual({
      availableCount: 5,
      applicableAvailableCount: 2,
      creditCount: 0,
    })
  })

  it('flags a present-but-non-array credits field instead of counting zero', () => {
    const parsed = parseCodexResetCredits({ availableCount: '5', credits: 'not-an-array' })
    expect(parsed.invalidPayload).toBe(true)
    expect(parsed.observation).toEqual({
      availableCount: 5,
      applicableAvailableCount: null,
      creditCount: 0,
    })
  })

  it('flags payloads without the expected shape', () => {
    const parsed = parseCodexResetCredits({ something: 'else' })
    expect(parsed.invalidPayload).toBe(true)
    expect(parsed.observation).toEqual({
      availableCount: null,
      applicableAvailableCount: null,
      creditCount: 0,
    })
  })

  it('flags non-object payloads', () => {
    expect(parseCodexResetCredits(null).invalidPayload).toBe(true)
    expect(parseCodexResetCredits([1, 2]).invalidPayload).toBe(true)
    expect(parseCodexResetCredits('text').invalidPayload).toBe(true)
  })
})
