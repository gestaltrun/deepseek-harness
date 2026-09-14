import { describe, expect, it } from 'vitest'
import {
  antigravityPeriodHours,
  buildAntigravityWindows,
} from '../../src/quota/windows-antigravity.ts'

const RESET = '2027-01-02T03:04:05Z'
const RESET_MS = Date.parse(RESET)

describe('antigravityPeriodHours', () => {
  it('maps the accepted spellings and declines unknown ones', () => {
    expect(antigravityPeriodHours('5h')).toBe(5)
    expect(antigravityPeriodHours('five-hour')).toBe(5)
    expect(antigravityPeriodHours('five_hour')).toBe(5)
    expect(antigravityPeriodHours('WEEKLY')).toBe(168)
    expect(antigravityPeriodHours('week')).toBe(168)
    expect(antigravityPeriodHours('monthly')).toBeNull()
    expect(antigravityPeriodHours(undefined)).toBeNull()
    expect(antigravityPeriodHours('  ')).toBeNull()
  })
})

describe('buildAntigravityWindows', () => {
  it('extracts buckets with fractions, resets, and period lookups, ordered 5h then weekly', () => {
    const payload = {
      groups: [
        {
          displayName: 'Gemini Pro',
          buckets: [
            { bucketId: 'pro-weekly', remainingFraction: 0.4, window: 'weekly', resetTime: RESET },
            { bucketId: 'pro-5h', remainingFraction: '73%', window: '5h', resetTime: RESET },
          ],
        },
      ],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows.map(window => window.key)).toEqual(['pro-5h', 'pro-weekly'])
    expect(windows[0]).toMatchObject({
      remainingFraction: 0.73,
      periodHours: 5,
      resetAtMs: RESET_MS,
      group: 'Gemini Pro',
    })
    expect(windows[1]).toMatchObject({ remainingFraction: 0.4, periodHours: 168 })
  })

  it('keeps unknown window spellings with periodHours null and sorts them last', () => {
    const payload = {
      groups: [
        {
          display_name: 'Group',
          buckets: [
            { bucket_id: 'b-unknown', remaining_fraction: 0.5, window: 'fortnightly' },
            { bucket_id: 'b-5h', remaining_fraction: 0.5, window: 'five_hour' },
          ],
        },
      ],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows.map(window => window.key)).toEqual(['b-5h', 'b-unknown'])
    expect(windows[1]).toMatchObject({ periodHours: null, remainingFraction: 0.5, resetAtMs: null })
  })

  it('skips buckets without a remaining fraction and synthesizes ids and labels', () => {
    const payload = {
      groups: [
        'not-a-group',
        {
          buckets: [
            null,
            { window: '5h' },
            { remainingFraction: 0.9, window: '5h', reset_time: 'garbage' },
          ],
        },
      ],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows).toHaveLength(1)
    expect(windows[0]?.key).toBe('quota-group-2-5h')
    expect(windows[0]?.label).toBe('quota-group-2-5h')
    expect(windows[0]?.resetAtMs).toBeNull()
  })

  it('uses the group display name for stable key prefixes', () => {
    const payload = {
      groups: [{ displayName: 'My Group!', buckets: [{ remainingFraction: 1 }] }],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows[0]?.key).toBe('my-group-bucket-1')
    expect(windows[0]?.periodHours).toBeNull()
  })

  it('orders weekly before unknown across mixed comparisons', () => {
    const payload = {
      groups: [
        {
          displayName: 'G',
          buckets: [
            { bucketId: 'w-week', remainingFraction: 0.5, window: 'weekly' },
            { bucketId: 'u-x', remainingFraction: 0.5, window: 'mystery' },
            { bucketId: 'f-5h', remainingFraction: 0.5, window: '5h' },
          ],
        },
      ],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows.map(window => window.key)).toEqual(['f-5h', 'w-week', 'u-x'])
  })

  it('sorts same-period buckets by key and falls back when a name has no stable characters', () => {
    const payload = {
      groups: [
        {
          displayName: '!!!',
          buckets: [
            { bucketId: 'z-5h', remainingFraction: 0.1, window: '5h' },
            { bucketId: 'a-5h', remainingFraction: 0.2, window: '5h' },
          ],
        },
      ],
    }
    const windows = buildAntigravityWindows(payload)
    expect(windows.map(window => window.key)).toEqual(['a-5h', 'z-5h'])

    const fallbackKey = buildAntigravityWindows({
      groups: [{ displayName: '!!!', buckets: [{ remainingFraction: 0.5 }] }],
    })
    expect(fallbackKey[0]?.key).toBe('quota-group-1-bucket-1')
  })

  it('returns no windows for malformed payloads', () => {
    expect(buildAntigravityWindows(null)).toHaveLength(0)
    expect(buildAntigravityWindows({ groups: 'nope' })).toHaveLength(0)
    expect(buildAntigravityWindows({ groups: [{ buckets: 'nope' }] })).toHaveLength(0)
  })
})
