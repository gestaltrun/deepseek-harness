/**
 * Codex usage-window extraction ported from the official CLIProxyAPI
 * management center (`src/features/quota/providers/codex/data.ts`
 * `buildCodexQuotaWindows` at ed5f1c48, MIT). Window identity follows the
 * source's own `limit_window_seconds`; the legacy primary/secondary ordering
 * fallback applies only when durations are absent.
 * @module account-pool/quota/windows-codex
 */

import { normalizeNumberValue, normalizePlanType } from './normalize.ts'
import {
  parseOffsetSecondsToMs,
  periodHoursFromSeconds,
  resolveResetMs,
} from './reset-instants.ts'
import { QUOTA_TOKEN_PLACEHOLDER } from './transport.ts'
import type {
  CodexAdditionalRateLimit,
  CodexRateLimitInfo,
  CodexUsagePayload,
  CodexUsageWindow,
  QuotaWindowObservation,
} from './types.ts'

/** Usage endpoint probed for Codex accounts. */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** Read-only reset-credits listing endpoint. The consume endpoint is never probed. */
export const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'

/** Headers for Codex probes; the token placeholder stays literal. */
export const CODEX_PROBE_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${QUOTA_TOKEN_PLACEHOLDER}`,
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
}

const FIVE_HOUR_SECONDS = 18_000
const WEEK_SECONDS = 604_800
const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60
const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60

function windowSeconds(window: CodexUsageWindow | null | undefined): number | null {
  if (window === null || window === undefined) return null
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds)
}

function isMonthlyWindow(window: CodexUsageWindow | null | undefined): boolean {
  const seconds = windowSeconds(window)
  return seconds !== null && seconds >= MIN_MONTH_SECONDS && seconds <= MAX_MONTH_SECONDS
}

interface ClassifiedWindows {
  readonly fiveHour: CodexUsageWindow | null
  readonly span: CodexUsageWindow | null
}

/** Classify a rate-limit pair by duration; fall back to source ordering when durations are absent. */
function classifyWindows(limitInfo: CodexRateLimitInfo | null | undefined): ClassifiedWindows {
  const primary = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null
  const secondary = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null

  let fiveHour: CodexUsageWindow | null = null
  let span: CodexUsageWindow | null = null
  for (const window of [primary, secondary]) {
    if (window === null) continue
    const seconds = windowSeconds(window)
    if (seconds === FIVE_HOUR_SECONDS && fiveHour === null) {
      fiveHour = window
    } else if ((seconds === WEEK_SECONDS || isMonthlyWindow(window)) && span === null) {
      span = window
    }
  }

  if (fiveHour === null && primary !== null && primary !== span) {
    fiveHour = primary
  }
  if (span === null && secondary !== null && secondary !== fiveHour) {
    span = secondary
  }
  return { fiveHour, span }
}

function toWindowObservation(
  key: string,
  window: CodexUsageWindow | null,
  limitReached: boolean,
  now: number,
  label?: string,
): QuotaWindowObservation | null {
  if (window === null) return null
  const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent)
  const resetAtMs =
    resolveResetMs([window.reset_at, window.resetAt]) ??
    parseOffsetSecondsToMs(window.reset_after_seconds ?? window.resetAfterSeconds, now)
  // `limit_reached` is source-supplied: a reached limit with a known reset is
  // the one case where 100% is a fact rather than a fabrication.
  const usedPercent = usedPercentRaw ?? (limitReached && resetAtMs !== null ? 100 : null)
  return {
    key,
    ...label === undefined ? {} : { label },
    ...(usedPercent === null ? {} : { usedPercent }),
    resetAtMs,
    periodHours: periodHoursFromSeconds(window.limit_window_seconds ?? window.limitWindowSeconds),
  }
}

function rateLimitFlags(info: CodexRateLimitInfo | null | undefined): {
  limitReached: boolean
} {
  return { limitReached: (info?.limit_reached ?? info?.limitReached) === true }
}

function additionalLimitName(limit: CodexAdditionalRateLimit, index: number): string {
  const raw = limit.limit_name ?? limit.limitName
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name === '' ? `additional-${String(index + 1)}` : name
}

/**
 * Extract quota windows from a Codex usage payload.
 * @param payload - parsed usage response.
 * @param now - reference instant for relative reset offsets, in epoch ms.
 * @returns classified windows plus the source plan marker.
 */
export function buildCodexWindows(
  payload: CodexUsagePayload,
  now: number,
): { windows: QuotaWindowObservation[]; planType?: string } {
  const windows: QuotaWindowObservation[] = []
  const rateLimit = payload.rate_limit ?? payload.rateLimit
  const codeReview = payload.code_review_rate_limit ?? payload.codeReviewRateLimit
  const additional = payload.additional_rate_limits ?? payload.additionalRateLimits ?? []

  const pushPair = (
    info: CodexRateLimitInfo | null | undefined,
    keys: { fiveHour: string; weekly: string; monthly: string; primary: string; secondary: string },
    label?: string,
  ): void => {
    const { fiveHour, span } = classifyWindows(info)
    const { limitReached } = rateLimitFlags(info)
    // A duration-derived window carries its semantic name; the legacy ordering
    // fallback names positions only — `primary`/`secondary` — and never claims
    // a 5-hour or weekly period the payload did not state.
    const firstKey = windowSeconds(fiveHour) === FIVE_HOUR_SECONDS ? keys.fiveHour : keys.primary
    const first = toWindowObservation(firstKey, fiveHour, limitReached, now, label)
    if (first !== null) windows.push(first)
    const secondKey =
      windowSeconds(span) === WEEK_SECONDS
        ? keys.weekly
        : isMonthlyWindow(span)
          ? keys.monthly
          : keys.secondary
    const second = toWindowObservation(secondKey, span, limitReached, now, label)
    if (second !== null) windows.push(second)
  }

  pushPair(rateLimit, {
    fiveHour: 'five-hour',
    weekly: 'weekly',
    monthly: 'monthly',
    primary: 'primary',
    secondary: 'secondary',
  })
  pushPair(codeReview, {
    fiveHour: 'code-review-five-hour',
    weekly: 'code-review-weekly',
    monthly: 'code-review-monthly',
    primary: 'code-review-primary',
    secondary: 'code-review-secondary',
  })

  for (const [index, limit] of additional.entries()) {
    const name = additionalLimitName(limit, index)
    pushPair(limit.rate_limit ?? limit.rateLimit, {
      fiveHour: `additional-${name}-five-hour`,
      weekly: `additional-${name}-weekly`,
      monthly: `additional-${name}-monthly`,
      primary: `additional-${name}-primary`,
      secondary: `additional-${name}-secondary`,
    }, name)
  }

  const planType = normalizePlanType(payload.plan_type ?? payload.planType) ?? undefined
  return planType === undefined ? { windows } : { windows, planType }
}
