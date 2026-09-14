/** Product labels and reset copy for account-pool quota windows. */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountPoolKey } from './locales.ts'
import type { AccountPoolQuotaWindow } from '../account-pool.ts'

/** Account-pool locale translator used by account-pool quota copy. */
export type AccountPoolCopy = Translate<AccountPoolKey>

/** One window the quota face should draw. */
export interface VisibleQuotaWindow {
  readonly key: string
  readonly title: string
  readonly remainingPercent?: number
  readonly timeRemainingPercent?: number
  readonly resetAtMs?: number
  readonly group?: string
  readonly groupDescription?: string
  readonly status: AccountPoolQuotaWindow['status']
}

/**
 * Map observed windows to their provider titles
 * and keep group headings when the source supplied them.
 * @param windows - Host quota windows in observation order.
 * @param t - Account-pool locale translator for period labels.
 * @returns windows the quota face should draw, omitting untitled rows.
 */
export function visibleQuotaWindows(
  windows: readonly AccountPoolQuotaWindow[],
  t: AccountPoolCopy,
): readonly VisibleQuotaWindow[] {
  return windows.flatMap((window) => {
    const title = quotaWindowTitle(window, t)
    if (title === undefined) return []
    return [{
      key: window.key,
      title,
      status: window.status,
      ...window.remainingPercent === undefined ? {} : { remainingPercent: window.remainingPercent },
      ...window.timeRemainingPercent === undefined ? {} : { timeRemainingPercent: window.timeRemainingPercent },
      ...window.resetAtMs === undefined ? {} : { resetAtMs: window.resetAtMs },
      ...window.group === undefined ? {} : { group: window.group },
      ...window.groupDescription === undefined ? {} : { groupDescription: window.groupDescription },
    }]
  })
}

/**
 * Human title for one quota window, or undefined to hide it.
 * @param window - one observed quota window.
 * @param t - Account-pool locale translator for period labels.
 * @returns the provider title, or undefined when the window should stay hidden.
 */
export function quotaWindowTitle(window: AccountPoolQuotaWindow, t: AccountPoolCopy): string | undefined {
  const named = namedLimit(window, t)
  if (named !== undefined) return named
  if (window.label.length > 0 && window.label !== window.key) return window.label
  const hours = window.periodHours
  if (hours === 5) return t('limit5h')
  if (hours !== undefined && hours >= 23 && hours <= 25) return t('limitDaily')
  if (hours !== undefined && hours >= 167 && hours <= 169) return t('limitWeekly')
  if (hours !== undefined && hours >= 28 * 24 && hours <= 31 * 24) return t('limitMonthly')
  const key = window.key.toLowerCase()
  if (key === 'weekly' || key.includes('week')) return t('limitWeekly')
  if (key === 'monthly' || key.includes('month')) return t('limitMonthly')
  if (key === '5h' || key.includes('five_hour') || key.includes('five-hour')) return t('limit5h')
  if (key === 'summary') return t('limitWeekly')
  if (key === 'limit-0') return t('limit5h')
  if (/^limit-\d+$/.test(key)) return hours === undefined ? undefined : t('limitHours', { hours })
  if (window.label.length > 0 && window.label !== window.key) return window.label
  return undefined
}

/**
 * Provider plan badge text.
 * @param planType - vendor plan identifier from the quota observation.
 * @returns the badge text, or undefined when the observation omitted a plan.
 */
export function quotaPlanLabel(planType: string | undefined): string | undefined {
  if (planType === undefined || planType.length === 0) return undefined
  switch (planType.toLowerCase()) {
    case 'pro': return 'Pro 20x'
    case 'prolite': return 'Pro 5x'
    case 'plus': return 'Plus'
    case 'team': return 'Team'
    case 'free': return 'Free'
    case 'ultra': return 'Ultra'
    case 'ultralite': return 'Ultra Lite'
    default: return planType
  }
}

/**
 * Reset stamp plus relative remainder, matching `09/11 13:17 · 1 hour ago`.
 * @param resetAtMs - Unix millisecond reset instant, if the observation supplied one.
 * @param t - Account-pool locale translator for relative remainder copy.
 * @param now - comparison instant; defaults to `Date.now()`.
 * @returns formatted stamp and remainder, or an empty string when the reset is missing.
 */
export function quotaResetText(resetAtMs: number | undefined, t: AccountPoolCopy, now = Date.now()): string {
  if (resetAtMs === undefined) return ''
  const date = new Date(resetAtMs)
  if (Number.isNaN(date.getTime())) return ''
  const stamp = `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  const delta = resetAtMs - now
  const relativeText = relative(Math.abs(delta), t)
  return t(delta >= 0 ? 'relativeAfter' : 'relativeBefore', { stamp, relative: relativeText })
}

function namedLimit(window: AccountPoolQuotaWindow, t: AccountPoolCopy): string | undefined {
  const match = /^(?:additional-)(.+?)-(five-hour|weekly|monthly|primary|secondary)$/.exec(window.key)
  if (match === null) return undefined
  const name = window.label.length > 0 && window.label !== window.key ? window.label : match[1] ?? ''
  if (name.length === 0) return undefined
  const suffix = periodSuffix(window, t, match[2])
  return suffix === undefined ? name : `${name} ${suffix}`
}

function periodSuffix(window: AccountPoolQuotaWindow, t: AccountPoolCopy, kind?: string): string | undefined {
  const hours = window.periodHours
  if (hours === 5 || kind === 'five-hour') return t('limit5h')
  if ((hours !== undefined && hours >= 167 && hours <= 169) || kind === 'weekly') return t('limitWeekly')
  if ((hours !== undefined && hours >= 28 * 24 && hours <= 31 * 24) || kind === 'monthly') return t('limitMonthly')
  return undefined
}

function relative(ms: number, t: AccountPoolCopy): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return t('relativeMinute')
  if (minutes < 60) return t('relativeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('relativeHours', { count: hours })
  return t('relativeDays', { count: Math.floor(hours / 24) })
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
