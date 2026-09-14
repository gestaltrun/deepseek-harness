/** Redacted quota windows projected from provider observations for Client cards. */
import type { AccountPoolQuotaWindow } from '../account-pool.ts'
import type { QuotaObservation } from '../quota/types.ts'

/**
 * Project measurements without supplying absent reset instants or window lengths.
 * @param observation - the provider's quota observation and sampling time.
 * @returns card windows with a time needle only when its time basis is known.
 */
export function projectQuotaWindows(observation: QuotaObservation): AccountPoolQuotaWindow[] {
  return observation.windows.map(window => {
    const remaining = window.remainingFraction === undefined
      ? window.usedPercent === undefined ? undefined : 100 - window.usedPercent : window.remainingFraction * 100
    const reset = window.resetAtMs
    const period = window.periodHours
    return { key: window.key, label: window.label ?? window.key, status: observation.status,
      ...remaining === undefined ? {} : { remainingPercent: Math.min(100, Math.max(0, remaining)) },
      ...typeof reset !== 'number' ? {} : { resetAtMs: reset },
      ...typeof period !== 'number' ? {} : { periodHours: period },
      ...remaining === undefined || typeof period !== 'number' || period <= 0 || typeof reset !== 'number' ? {}
        : { timeRemainingPercent: Math.min(100, Math.max(0, (reset - observation.observedAt) / (period * 3600000) * 100)) },
      ...window.group === undefined ? {} : { group: window.group },
      ...window.groupDescription === undefined ? {} : { groupDescription: window.groupDescription },
    }
  })
}
