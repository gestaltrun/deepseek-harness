import { describe, expect, it } from 'vitest'
import { buildCodexWindows } from '../../src/quota/windows-codex.ts'

const NOW = 1_800_000_000_000

describe('buildCodexWindows', () => {
  it('classifies primary and secondary windows by their declared durations', () => {
    const payload = {
      plan_type: 'PRO',
      rate_limit: {
        primary_window: {
          used_percent: 30,
          limit_window_seconds: 18_000,
          reset_at: 1_800_003_600,
        },
        secondary_window: {
          used_percent: 55,
          limit_window_seconds: 604_800,
          reset_after_seconds: 86_400,
        },
      },
    }
    const { windows, planType } = buildCodexWindows(payload, NOW)
    expect(planType).toBe('pro')
    const fiveHour = windows.find(window => window.key === 'five-hour')
    expect(fiveHour).toMatchObject({
      usedPercent: 30,
      periodHours: 5,
      resetAtMs: 1_800_003_600_000,
    })
    const weekly = windows.find(window => window.key === 'weekly')
    expect(weekly).toMatchObject({ usedPercent: 55, periodHours: 168, resetAtMs: NOW + 86_400_000 })
  })

  it('labels a month-long secondary window as monthly', () => {
    const payload = {
      rate_limit: {
        secondary_window: { used_percent: 10, limit_window_seconds: 30 * 24 * 3600 },
      },
    }
    const { windows } = buildCodexWindows(payload, NOW)
    expect(windows.map(window => window.key)).toEqual(['monthly'])
  })

  it('falls back to positional names without durations, never claiming a period', () => {
    const payload = {
      rate_limit: {
        primary_window: { used_percent: 1 },
        secondary_window: { used_percent: 2 },
      },
    }
    const { windows } = buildCodexWindows(payload, NOW)
    expect(windows.map(window => window.key)).toEqual(['primary', 'secondary'])
    expect(windows[0]?.periodHours).toBeNull()
    expect(windows[1]?.periodHours).toBeNull()
  })

  it('uses 100 only when the source says the limit is reached and a reset exists', () => {
    const reached = {
      rate_limit: {
        limit_reached: true,
        primary_window: { limit_window_seconds: 18_000, reset_after_seconds: 600 },
      },
    }
    const { windows: reachedWindows } = buildCodexWindows(reached, NOW)
    expect(reachedWindows[0]).toMatchObject({ usedPercent: 100, resetAtMs: NOW + 600_000 })

    const reachedNoReset = {
      rate_limit: { limit_reached: true, primary_window: { limit_window_seconds: 18_000 } },
    }
    const { windows: noResetWindows } = buildCodexWindows(reachedNoReset, NOW)
    expect(noResetWindows[0]).not.toHaveProperty('usedPercent')
  })

  it('classifies code review and additional limits with their own keys', () => {
    const payload = {
      code_review_rate_limit: {
        primary_window: { used_percent: 5, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 6, limit_window_seconds: 604_800 },
      },
      additional_rate_limits: [
        {
          limit_name: 'codex-other',
          rate_limit: { primary_window: { used_percent: 7, limit_window_seconds: 18_000 } },
        },
        {
          rate_limit: { secondary_window: { used_percent: 8, limit_window_seconds: 604_800 } },
        },
        {
          limit_name: 'camel',
          rateLimit: { primaryWindow: { usedPercent: 9, limitWindowSeconds: 18_000 } },
        },
      ],
    }
    const { windows } = buildCodexWindows(payload, NOW)
    const keys = windows.map(window => window.key)
    expect(keys).toContain('code-review-five-hour')
    expect(keys).toContain('code-review-weekly')
    expect(keys).toContain('additional-codex-other-five-hour')
    expect(windows.find(window => window.key === 'additional-codex-other-five-hour')?.label).toBe('codex-other')
    expect(keys).toContain('additional-additional-2-weekly')
    expect(keys).toContain('additional-camel-five-hour')
  })

  it('accepts camelCase fields and reports no plan when absent', () => {
    const payload = {
      rateLimit: {
        primaryWindow: { usedPercent: 44, limitWindowSeconds: 18_000, resetAfterSeconds: 30 },
      },
    }
    const { windows, planType } = buildCodexWindows(payload, NOW)
    expect(planType).toBeUndefined()
    expect(windows[0]).toMatchObject({ usedPercent: 44, periodHours: 5, resetAtMs: NOW + 30_000 })
  })

  it('yields no windows for an empty payload', () => {
    expect(buildCodexWindows({}, NOW).windows).toHaveLength(0)
  })
})
