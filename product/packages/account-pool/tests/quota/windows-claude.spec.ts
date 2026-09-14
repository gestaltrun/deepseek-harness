import { describe, expect, it } from 'vitest'
import {
  CLAUDE_FABLE_WINDOW_KEY,
  CLAUDE_USAGE_WINDOW_KEYS,
  buildClaudeWindows,
} from '../../src/quota/windows-claude.ts'

const RESET = '2027-01-02T03:04:05Z'
const RESET_MS = Date.parse(RESET)

function fullPayload(): Record<string, unknown> {
  const windows: Record<string, unknown> = {}
  for (const key of CLAUDE_USAGE_WINDOW_KEYS) {
    windows[key] = { utilization: 25, resets_at: RESET }
  }
  return windows
}

describe('buildClaudeWindows', () => {
  it('extracts every named window with utilization, reset, and key-derived period', () => {
    const windows = buildClaudeWindows(fullPayload())
    expect(windows).toHaveLength(CLAUDE_USAGE_WINDOW_KEYS.length)
    const fiveHour = windows.find(window => window.key === 'five_hour')
    expect(fiveHour).toMatchObject({ usedPercent: 25, resetAtMs: RESET_MS, periodHours: 5 })
    const sevenDay = windows.find(window => window.key === 'seven_day_opus')
    expect(sevenDay?.periodHours).toBe(168)
  })

  it('skips windows without a utilization field and omits a non-numeric percent', () => {
    const payload = {
      five_hour: { utilization: 'high', resets_at: 'garbage' },
      seven_day: { resets_at: RESET },
    }
    const windows = buildClaudeWindows(payload)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({ key: 'five_hour', periodHours: 5, resetAtMs: null })
    expect(windows[0]).not.toHaveProperty('usedPercent')
  })

  it('replaces iguana_necktie with an active Fable weekly_scoped limit', () => {
    const payload = {
      ...fullPayload(),
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 40,
          resets_at: RESET,
          is_active: false,
          scope: { model: { display_name: 'Fable 5' } },
        },
        {
          kind: 'weekly_scoped',
          percent: 55,
          resets_at: RESET,
          is_active: true,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    }
    const windows = buildClaudeWindows(payload)
    expect(windows.some(window => window.key === 'iguana_necktie')).toBe(false)
    const fable = windows.find(window => window.key === CLAUDE_FABLE_WINDOW_KEY)
    expect(fable).toMatchObject({ usedPercent: 55, periodHours: 168, resetAtMs: RESET_MS })
  })

  it('falls back to the first Fable candidate when none is active', () => {
    const payload = {
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 12,
          resets_at: RESET,
          is_active: false,
          scope: { model: { display_name: 'fable' } },
        },
      ],
    }
    const windows = buildClaudeWindows(payload)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({ key: CLAUDE_FABLE_WINDOW_KEY, usedPercent: 12 })
  })

  it('ignores non-Fable limits and limits without a percent', () => {
    const payload = {
      limits: [
        { kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: 'Opus' } } },
        { kind: 'daily', percent: 12, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', scope: { model: { display_name: 'Fable' } } },
        { percent: 12 },
        null,
      ],
    }
    expect(buildClaudeWindows(payload)).toHaveLength(0)
  })

  it('handles a payload without a limits array', () => {
    expect(buildClaudeWindows({ five_hour: { utilization: 1 } })).toHaveLength(1)
  })
})
