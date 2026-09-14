import { describe, expect, it } from 'vitest'
import { buildXaiWindow } from '../../src/quota/windows-xai.ts'

describe('buildXaiWindow', () => {
  it('prefers the credit usage percent and reads period instants from the payload span', () => {
    const payload = {
      config: {
        currentPeriod: { type: 'WEEKLY', start: '2027-01-01T00:00:00Z', end: '2027-01-08T00:00:00Z' },
        creditUsagePercent: 42,
      },
    }
    const window = buildXaiWindow(payload, 'weekly')
    expect(window).toMatchObject({
      key: 'weekly',
      usedPercent: 42,
      resetAtMs: Date.parse('2027-01-08T00:00:00Z'),
      periodHours: 168,
    })
    expect(window).not.toHaveProperty('used')
    expect(window).not.toHaveProperty('limit')
  })

  it('derives the monthly percentage from used and limit cents, capped at the limit', () => {
    const payload = {
      config: {
        current_period: { type: 'monthly', end: '2027-02-01T00:00:00Z' },
        monthlyLimit: { val: 10_000 },
        used: 12_500,
      },
    }
    const window = buildXaiWindow(payload, 'monthly')
    expect(window).toMatchObject({
      key: 'monthly',
      used: 12_500,
      limit: 10_000,
      usedPercent: 100,
      resetAtMs: Date.parse('2027-02-01T00:00:00Z'),
    })
    expect(window?.periodHours).toBeNull()
  })

  it('uses the fallback key when the payload does not state its period type', () => {
    const payload = { config: { credit_usage_percent: 5 } }
    expect(buildXaiWindow(payload, 'weekly')?.key).toBe('weekly')
    expect(buildXaiWindow(payload, 'monthly')?.key).toBe('monthly')
  })

  it('accepts plain-value cents and numeric strings', () => {
    const payload = { config: { monthly_limit: 2000, used: '500' } }
    const window = buildXaiWindow(payload, 'monthly')
    expect(window).toMatchObject({ used: 500, limit: 2000, usedPercent: 25 })
  })

  it('yields null for payloads without quota counters', () => {
    expect(buildXaiWindow({}, 'weekly')).toBeNull()
    expect(buildXaiWindow({ config: null }, 'weekly')).toBeNull()
    expect(buildXaiWindow({ config: {} }, 'weekly')).toBeNull()
  })

  it('keeps a bare reset hint and an inverted span honest when counters exist', () => {
    const bareEnd = buildXaiWindow(
      { config: { used: 100, billing_period_end: '2027-03-01T00:00:00Z' } },
      'monthly',
    )
    expect(bareEnd).toMatchObject({
      used: 100,
      resetAtMs: Date.parse('2027-03-01T00:00:00Z'),
      periodHours: null,
    })

    const inverted = buildXaiWindow(
      {
        config: {
          used: 100,
          billingPeriodStart: '2027-03-02T00:00:00Z',
          billingPeriodEnd: '2027-03-01T00:00:00Z',
        },
      },
      'monthly',
    )
    expect(inverted?.periodHours).toBeNull()
  })

  it('refuses a period-only payload as a quota fact', () => {
    expect(
      buildXaiWindow(
        { config: { currentPeriod: { type: 'weekly', end: '2027-01-08T00:00:00Z' } } },
        'weekly',
      ),
    ).toBeNull()
    expect(
      buildXaiWindow({ config: { billing_period_end: '2027-03-01T00:00:00Z' } }, 'monthly'),
    ).toBeNull()
  })
})
