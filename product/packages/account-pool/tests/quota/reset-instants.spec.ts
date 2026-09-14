import { describe, expect, it } from 'vitest'
import {
  claudePeriodHours,
  parseIsoToMs,
  parseOffsetSecondsToMs,
  parseUnixToMs,
  periodHoursFromSeconds,
  resolveResetMs,
} from '../../src/quota/reset-instants.ts'

describe('parseIsoToMs', () => {
  it('parses ISO timestamps and truncates over-precise fractions', () => {
    expect(parseIsoToMs('2027-01-02T03:04:05Z')).toBe(Date.parse('2027-01-02T03:04:05Z'))
    expect(parseIsoToMs('2027-01-02T03:04:05.123456789Z')).toBe(
      Date.parse('2027-01-02T03:04:05.123456Z'),
    )
  })

  it('declines non-strings, blanks, and garbage', () => {
    expect(parseIsoToMs(123)).toBeNull()
    expect(parseIsoToMs('  ')).toBeNull()
    expect(parseIsoToMs('not a date')).toBeNull()
  })
})

describe('parseUnixToMs', () => {
  it('accepts seconds and milliseconds by magnitude', () => {
    expect(parseUnixToMs(1_800_000_000)).toBe(1_800_000_000_000)
    expect(parseUnixToMs(1_800_000_000_000)).toBe(1_800_000_000_000)
    expect(parseUnixToMs('1800000000')).toBe(1_800_000_000_000)
  })

  it('declines non-positive and non-numeric values', () => {
    expect(parseUnixToMs(0)).toBeNull()
    expect(parseUnixToMs(-5)).toBeNull()
    expect(parseUnixToMs('abc')).toBeNull()
    expect(parseUnixToMs({})).toBeNull()
  })
})

describe('parseOffsetSecondsToMs', () => {
  it('adds positive offsets to the reference instant', () => {
    expect(parseOffsetSecondsToMs(3600, 1_000_000)).toBe(1_000_000 + 3_600_000)
    expect(parseOffsetSecondsToMs('60', 0)).toBe(60_000)
  })

  it('declines non-positive and non-numeric offsets', () => {
    expect(parseOffsetSecondsToMs(0, 0)).toBeNull()
    expect(parseOffsetSecondsToMs(-3, 0)).toBeNull()
    expect(parseOffsetSecondsToMs(null, 0)).toBeNull()
  })
})

describe('resolveResetMs', () => {
  it('prefers the first parseable candidate, ISO before Unix per candidate', () => {
    expect(resolveResetMs([null, '2027-01-02T03:04:05Z', 1_800_000_000])).toBe(
      Date.parse('2027-01-02T03:04:05Z'),
    )
    expect(resolveResetMs(['2027-01-02T03:04:05Z', 1_800_000_000])).toBe(
      Date.parse('2027-01-02T03:04:05Z'),
    )
    expect(resolveResetMs([1_800_000_000, 'bad'])).toBe(1_800_000_000_000)
  })

  it('returns null when nothing parses', () => {
    expect(resolveResetMs([undefined, 'nope'])).toBeNull()
  })
})

describe('periodHoursFromSeconds', () => {
  it('converts seconds to hours and declines bad input', () => {
    expect(periodHoursFromSeconds(18_000)).toBe(5)
    expect(periodHoursFromSeconds('604800')).toBe(168)
    expect(periodHoursFromSeconds(0)).toBeNull()
    expect(periodHoursFromSeconds('x')).toBeNull()
  })
})

describe('claudePeriodHours', () => {
  it('maps five_hour to 5 and every other key to 168', () => {
    expect(claudePeriodHours('five_hour')).toBe(5)
    expect(claudePeriodHours('seven_day_opus')).toBe(168)
  })
})
