/**
 * xAI billing-window extraction ported from the official CLIProxyAPI
 * management center (`src/utils/quota/builders.ts` `buildXaiBillingSummary`
 * at ed5f1c48, MIT), restricted to the read-only billing endpoints. The paid
 * health probe (`/v1/me` plus a chat completion) is deliberately absent: this
 * package never sends an inference request. Window length comes from the
 * period's own start→end span rather than an assumed cycle.
 * @module account-pool/quota/windows-xai
 */

import { normalizeNumberValue, normalizeStringValue, asRecord } from './normalize.ts'
import { resolveResetMs } from './reset-instants.ts'
import { QUOTA_TOKEN_PLACEHOLDER } from './transport.ts'
import type { XaiBillingConfig, XaiBillingPayload, QuotaWindowObservation } from './types.ts'

/** Weekly-credits billing endpoint (read-only). */
export const XAI_BILLING_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

/** Monthly billing endpoint (read-only). */
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing'

/** Grok CLI client version the billing endpoint expects. */
export const XAI_GROK_CLIENT_VERSION = '0.2.91'

/** Headers for xAI billing probes; the token placeholder stays literal. */
export const XAI_PROBE_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${QUOTA_TOKEN_PLACEHOLDER}`,
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
  accept: '*/*',
  'user-agent': `grok-pager/${XAI_GROK_CLIENT_VERSION} grok-shell/${XAI_GROK_CLIENT_VERSION} (macos; aarch64)`,
}

function centValue(value: unknown): number | null {
  const record = asRecord(value)
  if (record !== null) return normalizeNumberValue(record['val'])
  return normalizeNumberValue(value)
}

function periodTypeOf(config: XaiBillingConfig): 'weekly' | 'monthly' | 'unknown' {
  const period = config.currentPeriod ?? config.current_period ?? null
  const rawType = (normalizeStringValue(period?.type) ?? '').toLowerCase()
  if (rawType.includes('weekly')) return 'weekly'
  if (rawType.includes('monthly')) return 'monthly'
  return 'unknown'
}

function periodInstants(
  periodStart: string | null,
  periodEnd: string | null,
): { resetAtMs: number | null; periodHours: number | null } {
  const resetAtMs = resolveResetMs([periodEnd])
  const startMs = resolveResetMs([periodStart])
  const periodHours =
    resetAtMs !== null && startMs !== null && resetAtMs > startMs
      ? (resetAtMs - startMs) / 3_600_000
      : null
  return { resetAtMs, periodHours }
}

/**
 * Extract one quota window from one xAI billing payload.
 * @param payload - parsed billing response.
 * @param fallbackKey - window key when the payload does not state its period type.
 * @returns the window, or `null` when the payload carries no quota counters.
 */
export function buildXaiWindow(
  payload: XaiBillingPayload,
  fallbackKey: 'weekly' | 'monthly',
): QuotaWindowObservation | null {
  const config = asRecord(payload.config) as XaiBillingConfig | null
  if (config === null) return null

  const periodType = periodTypeOf(config)
  const currentPeriod = config.currentPeriod ?? config.current_period ?? null
  const periodStart =
    normalizeStringValue(currentPeriod?.start) ??
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start)
  const periodEnd =
    normalizeStringValue(currentPeriod?.end) ??
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end)

  const creditUsagePercent = normalizeNumberValue(
    config.creditUsagePercent ?? config.credit_usage_percent,
  )
  const monthlyLimitCents = centValue(config.monthlyLimit ?? config.monthly_limit)
  const usedCents = centValue(config.used)
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && usedCents !== null
      ? (Math.min(usedCents, monthlyLimitCents) / monthlyLimitCents) * 100
      : null

  const effectivePercent = creditUsagePercent ?? usedPercent
  // A period without any quota counter is not a quota fact: it must not
  // produce a window that reads as known or partial balance.
  const hasCounters =
    effectivePercent !== null || monthlyLimitCents !== null || usedCents !== null
  if (!hasCounters) return null

  const { resetAtMs, periodHours } = periodInstants(periodStart, periodEnd)
  const key = periodType === 'unknown' ? fallbackKey : periodType

  return {
    key,
    ...(effectivePercent === null ? {} : { usedPercent: effectivePercent }),
    ...(usedCents === null ? {} : { used: usedCents }),
    ...(monthlyLimitCents === null ? {} : { limit: monthlyLimitCents }),
    resetAtMs,
    periodHours,
  }
}
