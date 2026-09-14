import { describe, expect, it } from 'vitest'
import {
  asRecord,
  normalizeIntValue,
  normalizeNumberValue,
  normalizePlanType,
  normalizeQuotaFraction,
  normalizeStringValue,
} from '../../src/quota/normalize.ts'

describe('normalizeStringValue', () => {
  it('trims strings and rejects empty ones', () => {
    expect(normalizeStringValue('  pro ')).toBe('pro')
    expect(normalizeStringValue('   ')).toBeNull()
  })

  it('stringifies finite numbers and declines everything else', () => {
    expect(normalizeStringValue(42)).toBe('42')
    expect(normalizeStringValue(Number.NaN)).toBeNull()
    expect(normalizeStringValue(null)).toBeNull()
    expect(normalizeStringValue(undefined)).toBeNull()
    expect(normalizeStringValue(true)).toBeNull()
  })
})

describe('normalizeNumberValue', () => {
  it('accepts finite numbers and numeric strings', () => {
    expect(normalizeNumberValue(73.5)).toBe(73.5)
    expect(normalizeNumberValue(' 12.5 ')).toBe(12.5)
  })

  it('declines empty, non-numeric, and non-scalar values', () => {
    expect(normalizeNumberValue('')).toBeNull()
    expect(normalizeNumberValue('abc')).toBeNull()
    expect(normalizeNumberValue({})).toBeNull()
    expect(normalizeNumberValue(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('normalizeQuotaFraction', () => {
  it('passes through numeric fractions', () => {
    expect(normalizeQuotaFraction(0.73)).toBe(0.73)
    expect(normalizeQuotaFraction('0.5')).toBe(0.5)
  })

  it('parses percentage strings into fractions', () => {
    expect(normalizeQuotaFraction('73%')).toBe(0.73)
    expect(normalizeQuotaFraction('abc%')).toBeNull()
  })

  it('declines empty and non-scalar values', () => {
    expect(normalizeQuotaFraction('')).toBeNull()
    expect(normalizeQuotaFraction(null)).toBeNull()
  })
})

describe('normalizePlanType', () => {
  it('lowercases present plan markers', () => {
    expect(normalizePlanType('PRO')).toBe('pro')
    expect(normalizePlanType('')).toBeNull()
    expect(normalizePlanType(undefined)).toBeNull()
  })
})

describe('normalizeIntValue', () => {
  it('floors numeric values and declines non-numeric ones', () => {
    expect(normalizeIntValue(9.9)).toBe(9)
    expect(normalizeIntValue('7')).toBe(7)
    expect(normalizeIntValue('x')).toBeNull()
  })
})

describe('asRecord', () => {
  it('accepts plain objects and rejects null, arrays, and scalars', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(asRecord(null)).toBeNull()
    expect(asRecord([1])).toBeNull()
    expect(asRecord('x')).toBeNull()
    expect(asRecord(3)).toBeNull()
  })
})
