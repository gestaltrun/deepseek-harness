import { describe, expect, it } from 'vitest'
import { buildKimiWindows } from '../../src/quota/windows-kimi.ts'

const NOW = 1_800_000_000_000
const RESET = '2027-01-02T03:04:05Z'
const RESET_MS = Date.parse(RESET)

describe('buildKimiWindows', () => {
  it('extracts limit rows with explicit duration metadata', () => {
    const payload = {
      limits: [
        {
          name: 'Weekly quota',
          detail: { used: 300, limit: 1000, remaining: 700, reset_at: RESET },
          window: { duration: 7, timeUnit: 'TIME_UNIT_DAY' },
        },
      ],
    }
    const windows = buildKimiWindows(payload, NOW)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      key: 'limit-0',
      label: 'Weekly quota',
      used: 300,
      limit: 1000,
      remaining: 700,
      usedPercent: 30,
      resetAtMs: RESET_MS,
      periodHours: 168,
    })
  })

  it('normalizes every protobuf time unit spelling', () => {
    const cases: Array<[string, number, number]> = [
      ['TIME_UNIT_SECOND', 7200, 2],
      ['SECONDS', 1800, 0.5],
      ['TIME_UNIT_MINUTE', 120, 2],
      ['MINUTES', 60, 1],
      ['MINUTE', 30, 0.5],
      ['TIME_UNIT_HOUR', 5, 5],
      ['HOURS', 3, 3],
      ['TIME_UNIT_DAY', 2, 48],
      ['DAYS', 1, 24],
      ['TIME_UNIT_WEEK', 1, 168],
      ['WEEKS', 2, 336],
    ]
    for (const [timeUnit, duration, expectedHours] of cases) {
      const payload = {
        limits: [{ used: 1, limit: 2, window: { duration, timeUnit } }],
      }
      const windows = buildKimiWindows(payload, NOW)
      expect(windows[0]?.periodHours, `timeUnit=${timeUnit}`).toBe(expectedHours)
    }
  })

  it('never defaults an absent or unknown time unit to minutes', () => {
    for (const timeUnit of ['', 'FORTNIGHT', 'nonsense']) {
      const payload = {
        limits: [{ used: 1, limit: 2, window: { duration: 120, timeUnit } }],
      }
      expect(buildKimiWindows(payload, NOW)[0]?.periodHours, `timeUnit=${timeUnit}`).toBeNull()
    }
    const noUnit = { limits: [{ used: 1, limit: 2, duration: 120 }] }
    expect(buildKimiWindows(noUnit, NOW)[0]?.periodHours).toBeNull()
  })

  it('never derives a period from label keywords, keeping labels but null durations', () => {
    const cases = ['daily quota', 'Weekly plan', 'Monthly cap', '5h burst', 'hourly refill']
    for (const label of cases) {
      const payload = { limits: [{ title: label, used: 1, limit: 2 }] }
      const window = buildKimiWindows(payload, NOW)[0]
      expect(window?.label, label).toBe(label)
      expect(window?.periodHours, label).toBeNull()
    }
    const unlabeled = { limits: [{ used: 1, limit: 2, scope: 'compute' }] }
    const windows = buildKimiWindows(unlabeled, NOW)
    expect(windows[0]).toMatchObject({ label: 'compute', periodHours: null })
  })

  it('derives used from remaining plus limit and never invents counters', () => {
    const derived = buildKimiWindows({ limits: [{ remaining: 250, limit: 1000 }] }, NOW)
    expect(derived[0]).toMatchObject({ used: 750, remaining: 250, usedPercent: 75 })

    const limitOnly = buildKimiWindows({ limits: [{ limit: 100 }] }, NOW)
    expect(limitOnly[0]).toMatchObject({ limit: 100 })
    expect(limitOnly[0]).not.toHaveProperty('used')
    expect(limitOnly[0]).not.toHaveProperty('usedPercent')

    const remainingOnly = buildKimiWindows({ limits: [{ remaining: 40 }] }, NOW)
    expect(remainingOnly[0]).toMatchObject({ remaining: 40 })
    expect(remainingOnly[0]).not.toHaveProperty('usedPercent')

    expect(buildKimiWindows({ limits: [{ name: 'empty' }] }, NOW)).toHaveLength(0)
  })

  it('resolves relative reset hints against the reference instant', () => {
    const payload = { limits: [{ used: 1, limit: 2, reset_in: 3600 }] }
    expect(buildKimiWindows(payload, NOW)[0]?.resetAtMs).toBe(NOW + 3_600_000)
    const ttl = { limits: [{ used: 1, limit: 2, ttl: '60' }] }
    expect(buildKimiWindows(ttl, NOW)[0]?.resetAtMs).toBe(NOW + 60_000)
    const none = { limits: [{ used: 1, limit: 2 }] }
    expect(buildKimiWindows(none, NOW)[0]?.resetAtMs).toBeNull()
  })

  it('reads counters from the item itself when no detail object exists', () => {
    const payload = { limits: [{ used: 5, limit: 10, duration: 2, timeUnit: 'HOUR' }] }
    const windows = buildKimiWindows(payload, NOW)
    expect(windows[0]).toMatchObject({ used: 5, limit: 10, periodHours: 2 })
  })

  it('adds the summary row from usage and skips unusable entries', () => {
    const payload = {
      usage: { used: 9, limit: 10 },
      limits: ['not-an-item', { used: 1, limit: 2 }],
    }
    const windows = buildKimiWindows(payload, NOW)
    expect(windows.map(window => window.key)).toEqual(['limit-1', 'summary'])
    expect(windows[1]).toMatchObject({ used: 9, limit: 10, usedPercent: 90 })
    expect(windows[1]).not.toHaveProperty('label')
  })

  it('rejects a non-string time unit and skips a counterless summary', () => {
    const payload = {
      usage: { name: 'nothing countable' },
      limits: [{ used: 1, limit: 2, window: { duration: 120, timeUnit: 5 } }],
    }
    const windows = buildKimiWindows(payload, NOW)
    expect(windows).toHaveLength(1)
    expect(windows[0]?.periodHours).toBeNull()
  })

  it('uses the endpoint weekly period only when summary metadata is absent', () => {
    const window = buildKimiWindows({ usage: { used: 1, limit: 2, resetTime: RESET } }, NOW)[0]
    expect(window).toMatchObject({ key: 'summary', periodHours: 168, resetAtMs: RESET_MS })
    expect(window).not.toHaveProperty('label')
  })

  it.each([
    { duration: 2, timeUnit: 'TIME_UNIT_DAY' },
    { window: { duration: '48', timeUnit: 'TIME_UNIT_HOUR' } },
  ])('prefers explicit summary window metadata %#', metadata => {
    const window = buildKimiWindows({ usage: { used: 1, limit: 2, ...metadata } }, NOW)[0]
    expect(window?.periodHours).toBe(48)
  })

  it.each([
    { duration: 0, timeUnit: 'HOUR' },
    { duration: -1, timeUnit: 'DAY' },
    { duration: 'unknown', timeUnit: 'DAY' },
    { duration: 7, timeUnit: 'FORTNIGHT' },
    { duration: 7 },
    { timeUnit: 'DAY' },
    { window: null },
    { window: {} },
    { window: { duration: 7, timeUnit: null } },
    { window: { duration: 1e308, timeUnit: 'WEEK' } },
  ])('keeps invalid explicit summary metadata unknown %#', metadata => {
    const window = buildKimiWindows({ usage: { name: 'Weekly quota', used: 1, limit: 2, ...metadata } }, NOW)[0]
    expect(window?.periodHours).toBeNull()
  })

  it('omits usedPercent when the limit is zero', () => {
    const payload = { limits: [{ used: 0, limit: 0 }] }
    const windows = buildKimiWindows(payload, NOW)
    expect(windows[0]).not.toHaveProperty('usedPercent')
  })
})
