// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createQuotaObserver } from '../src/quota/observer.ts'
import type { KimiUsagePayload, QuotaAccountRef } from '../src/quota/types.ts'
import { projectQuotaWindows } from '../src/provider/quota-view.ts'
import { AccountCard } from '../src/client/AccountCard.tsx'
import { en } from '../src/client/locales.ts'
import type { AccountPoolCopy } from '../src/client/quota-display.ts'
import type { AccountPoolAccountName, AccountPoolAccountRef } from '../src/account-pool.ts'
import { kimiUsage, kimiObservedAt } from './fixtures/kimi-usage.ts'

afterEach(cleanup)

const t: AccountPoolCopy = (key, params) => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

async function renderQuota(payload: KimiUsagePayload) {
  const observer = createQuotaObserver({
    now: () => kimiObservedAt,
    transport: { request: async () => ({ statusCode: 200, body: payload }) },
  })
  const observed = await observer.observe({ authIndex: 'fixture' as QuotaAccountRef, provider: 'kimi' })
  const quota = projectQuotaWindows(observed)
  render(<AccountCard t={t} item={{
    ref: 'kimi-fixture' as AccountPoolAccountRef, name: 'kimi-fixture.json' as AccountPoolAccountName,
    provider: 'kimi', label: 'Fixture', status: 'ready', enabled: true, quota,
    quotaState: { status: observed.status, stale: false, observedAt: observed.observedAt },
    capabilities: { models: 'account', quota: true, export: 'auth-file', editableFields: [] },
  }} globalFace="B" globalEpoch={0} onToggleStatus={() => {}} onRefreshQuota={() => {}} onDelete={() => {}} onListModels={() => {}} onRefresh={() => {}} onDownload={() => {}} onEditSettings={() => {}} />)
  return quota
}

describe('Kimi quota time needles', () => {
  it('carries weekly and five-hour time bases from the usage response through the Host into the card', async () => {
    const quota = await renderQuota(kimiUsage)
    const tracks = screen.getAllByTestId('quota-track')
    expect(tracks.map(track => track.dataset.quotaNeedle)).toEqual(['needle', 'needle'])
    expect(quota[0]?.periodHours).toBe(5)
    expect(quota[0]?.timeRemainingPercent).toBe(60)
    expect(quota[1]?.periodHours).toBe(168)
    expect(quota[1]?.timeRemainingPercent).toBeCloseTo(47.619047619)
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.getByText(en.limitWeekly)).toBeTruthy()
    expect(within(tracks[1]!).getByTitle('Time remaining 48%')).toBeTruthy()
    expect(Number.parseFloat(tracks[1]!.parentElement?.style.getPropertyValue('--quota-time') ?? '')).toBeCloseTo(47.619047619)
  })
  it('keeps the weekly quota fill but omits its needle when reset time is missing', async () => {
    await renderQuota({ usage: { used: 30, limit: 100, remaining: 70 } })
    const track = screen.getByTestId('quota-track')
    expect(track.dataset.quotaFill).toBe('fill')
    expect(track.dataset.quotaNeedle).toBe('none')
    expect(screen.getByText('70%')).toBeTruthy()
  })

  it('omits the weekly needle when explicit period metadata is invalid', async () => {
    await renderQuota({ usage: { ...kimiUsage.usage, window: { duration: 7, timeUnit: 'UNKNOWN' } } })
    const track = screen.getByTestId('quota-track')
    expect(track.dataset.quotaFill).toBe('fill')
    expect(track.dataset.quotaNeedle).toBe('none')
  })

})
