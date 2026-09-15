import { describe, expect, it } from 'vitest'
import {
  GLM_QUOTA_SIGNAL_KEYS,
  parseGlmQuotaSignals,
  type GlmQuotaEnvelope,
} from '../../src/quota/signals-glm.ts'

const NOW = 1_800_000_000_000
const LAST_SUCCESS = '2027-01-02T03:04:05Z'
const LAST_SUCCESS_MS = Date.parse(LAST_SUCCESS)

function envelope(signals: Record<string, string>, observedAt?: string): GlmQuotaEnvelope {
  return { signals, ...(observedAt === undefined ? {} : { observedAt }) }
}

/** Return the signals record without the named keys (lint-safe `delete` alternative). */
function omitSignals(signals: Record<string, string>, ...keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(signals).filter(([name]) => !keys.includes(name)))
}

function fullSignals(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [GLM_QUOTA_SIGNAL_KEYS.status]: 'ready',
    [GLM_QUOTA_SIGNAL_KEYS.credentialValid]: 'true',
    [GLM_QUOTA_SIGNAL_KEYS.lastSuccessAt]: LAST_SUCCESS,
    [GLM_QUOTA_SIGNAL_KEYS.planLevel]: 'PRO',
    [GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent]: '35',
    [GLM_QUOTA_SIGNAL_KEYS.fiveHourResetAt]: '2027-01-02T08:04:05Z',
    [GLM_QUOTA_SIGNAL_KEYS.weeklyUsedPercent]: '61.5',
    [GLM_QUOTA_SIGNAL_KEYS.weeklyResetAt]: '2027-01-09T03:04:05Z',
    ...overrides,
  }
}

describe('parseGlmQuotaSignals', () => {
  it('parses a ready envelope into known windows with plan and last-success stamp', () => {
    const parsed = parseGlmQuotaSignals(envelope(fullSignals()), NOW)
    expect(parsed).toMatchObject({ status: 'known', planType: 'pro', observedAt: LAST_SUCCESS_MS })
    expect(parsed.windows).toHaveLength(2)
    expect(parsed.windows[0]).toMatchObject({
      key: 'five-hour',
      usedPercent: 35,
      periodHours: 5,
      resetAtMs: Date.parse('2027-01-02T08:04:05Z'),
    })
    expect(parsed.windows[1]).toMatchObject({
      key: 'weekly',
      usedPercent: 61.5,
      periodHours: 168,
      resetAtMs: Date.parse('2027-01-09T03:04:05Z'),
    })
  })

  it('keeps the last good windows as partial when the poll is stale', () => {
    const parsed = parseGlmQuotaSignals(
      envelope(fullSignals({ [GLM_QUOTA_SIGNAL_KEYS.status]: 'stale' })),
      NOW,
    )
    expect(parsed).toMatchObject({ status: 'partial', observedAt: LAST_SUCCESS_MS })
    expect(parsed.windows).toHaveLength(2)
    expect(parsed.error).toBe('glm quota signals are stale; showing the last successful sample')
  })

  it('fails with the sanitized upstream error when the poll errors', () => {
    const parsed = parseGlmQuotaSignals(
      envelope(
        fullSignals({
          [GLM_QUOTA_SIGNAL_KEYS.status]: 'error',
          [GLM_QUOTA_SIGNAL_KEYS.error]: 'upstream rejected Bearer glm-secret-token-123456',
        }),
      ),
      NOW,
    )
    expect(parsed).toMatchObject({ status: 'failure', windows: [] })
    expect(parsed.error).toBe('upstream rejected Bearer [redacted]')
    expect(JSON.stringify(parsed)).not.toContain('glm-secret-token-123456')
  })

  it('fails when the credential is marked invalid', () => {
    const parsed = parseGlmQuotaSignals(
      envelope(fullSignals({ [GLM_QUOTA_SIGNAL_KEYS.credentialValid]: 'false' })),
      NOW,
    )
    expect(parsed).toMatchObject({
      status: 'failure',
      windows: [],
      error: 'glm quota poll marks the credential invalid; a quota-interface observation, not an inference-key verdict',
    })
  })

  it('falls back to the envelope stamp, then the reference clock', () => {
    const withoutLastSuccess = omitSignals(fullSignals(), GLM_QUOTA_SIGNAL_KEYS.lastSuccessAt)
    const fromEnvelope = parseGlmQuotaSignals(
      envelope(withoutLastSuccess, '2027-01-02T05:00:00Z'),
      NOW,
    )
    expect(fromEnvelope.observedAt).toBe(Date.parse('2027-01-02T05:00:00Z'))

    const fromClock = parseGlmQuotaSignals(envelope(withoutLastSuccess), NOW)
    expect(fromClock.observedAt).toBe(NOW)
  })

  it('omits window fields the signals do not supply', () => {
    const sparse = omitSignals(
      fullSignals(),
      GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent,
      GLM_QUOTA_SIGNAL_KEYS.weeklyResetAt,
      GLM_QUOTA_SIGNAL_KEYS.planLevel,
    )
    const parsed = parseGlmQuotaSignals(envelope(sparse), NOW)
    expect(parsed.status).toBe('known')
    expect(parsed).not.toHaveProperty('planType')
    expect(parsed.windows[0]).toMatchObject({ key: 'five-hour' })
    expect(parsed.windows[0]).not.toHaveProperty('usedPercent')
    expect(parsed.windows[1]).toMatchObject({ key: 'weekly', resetAtMs: null })
  })

  it('drops a window only when both its percent and reset are absent', () => {
    const resetOnly = fullSignals({
      [GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent]: '',
    })
    const parsed = parseGlmQuotaSignals(envelope(resetOnly), NOW)
    expect(parsed.windows).toHaveLength(2)
    expect(parsed.windows[0]).not.toHaveProperty('usedPercent')

    const empty = fullSignals({
      [GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent]: '',
      [GLM_QUOTA_SIGNAL_KEYS.fiveHourResetAt]: '',
      [GLM_QUOTA_SIGNAL_KEYS.weeklyUsedPercent]: '',
      [GLM_QUOTA_SIGNAL_KEYS.weeklyResetAt]: '',
    })
    expect(parseGlmQuotaSignals(envelope(empty), NOW).windows).toHaveLength(0)
  })

  it('handles absent plan and error signals across verdicts', () => {
    const noPlan = (overrides: Record<string, string>): Record<string, string> =>
      omitSignals(fullSignals(overrides), GLM_QUOTA_SIGNAL_KEYS.planLevel)

    const invalid = parseGlmQuotaSignals(
      envelope(noPlan({ [GLM_QUOTA_SIGNAL_KEYS.credentialValid]: 'no' })),
      NOW,
    )
    expect(invalid).toMatchObject({ status: 'failure' })
    expect(invalid).not.toHaveProperty('planType')

    const errored = parseGlmQuotaSignals(
      envelope(noPlan({ [GLM_QUOTA_SIGNAL_KEYS.status]: 'error' })),
      NOW,
    )
    expect(errored).toMatchObject({ status: 'failure', error: 'glm quota poll failed' })
    expect(errored).not.toHaveProperty('planType')

    const stale = parseGlmQuotaSignals(
      envelope(noPlan({ [GLM_QUOTA_SIGNAL_KEYS.status]: 'stale' })),
      NOW,
    )
    expect(stale).toMatchObject({ status: 'partial' })
    expect(stale).not.toHaveProperty('planType')
  })

  it('treats a missing or unrecognized status as partial with facts, failure without', () => {
    const withoutStatus = omitSignals(fullSignals(), GLM_QUOTA_SIGNAL_KEYS.status)
    const partial = parseGlmQuotaSignals(envelope(withoutStatus), NOW)
    expect(partial).toMatchObject({
      status: 'partial',
      error: 'glm quota status signal is missing or unrecognized',
    })
    expect(partial.windows).toHaveLength(2)

    const empty = fullSignals({
      [GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent]: '',
      [GLM_QUOTA_SIGNAL_KEYS.fiveHourResetAt]: '',
      [GLM_QUOTA_SIGNAL_KEYS.weeklyUsedPercent]: '',
      [GLM_QUOTA_SIGNAL_KEYS.weeklyResetAt]: '',
    })
    const withoutStatusOrPlan = omitSignals(
      empty,
      GLM_QUOTA_SIGNAL_KEYS.status,
      GLM_QUOTA_SIGNAL_KEYS.planLevel,
    )
    const failed = parseGlmQuotaSignals(envelope(withoutStatusOrPlan), NOW)
    expect(failed.status).toBe('failure')
    expect(failed).not.toHaveProperty('planType')
  })
})
