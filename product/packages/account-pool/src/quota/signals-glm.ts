/**
 * GLM quota signal parsing. The fork core polls GLM quota and records the
 * result on the auth-files management envelope (`observed_at` plus a
 * string `signals` map), so the Host parses the existing envelope here —
 * this module never issues a probe request. Signal keys follow the fork
 * implementation in `community/cliproxyapi`.
 * @module account-pool/quota/signals-glm
 */

import { normalizeNumberValue, normalizePlanType } from './normalize.ts'
import { resolveResetMs } from './reset-instants.ts'
import { sanitizeProbeError } from './sanitize.ts'
import type { QuotaObservationStatus, QuotaWindowObservation } from './types.ts'

/** Signal keys the fork core writes onto the GLM auth file's quota envelope. */
export const GLM_QUOTA_SIGNAL_KEYS = {
  status: 'GLM-Quota-Status',
  credentialValid: 'GLM-Credential-Valid',
  lastSuccessAt: 'GLM-Quota-Last-Success-At',
  planLevel: 'GLM-Plan-Level',
  fiveHourUsedPercent: 'GLM-Quota-5h-Used-Percent',
  fiveHourResetAt: 'GLM-Quota-5h-Reset-At',
  weeklyUsedPercent: 'GLM-Quota-Weekly-Used-Percent',
  weeklyResetAt: 'GLM-Quota-Weekly-Reset-At',
  error: 'GLM-Quota-Error',
} as const

/** The core-polled passive quota envelope as the Host forwards it. */
export interface GlmQuotaEnvelope {
  /** Envelope sampling stamp from the auth file (`observed_at`). */
  readonly observedAt?: string
  /** String signal map from the auth file (`signals`). */
  readonly signals: Record<string, string>
}

/** Parsed GLM quota facts, ready for observation assembly. */
export interface GlmQuotaSignalParse {
  readonly status: QuotaObservationStatus
  readonly windows: readonly QuotaWindowObservation[]
  readonly planType?: string
  readonly observedAt: number
  readonly error?: string
}

function isFalseSignal(value: string | undefined): boolean {
  return value !== undefined && ['false', '0', 'no'].includes(value.trim().toLowerCase())
}

function buildWindow(
  key: string,
  usedPercentRaw: string | undefined,
  resetAtRaw: string | undefined,
  periodHours: number,
): QuotaWindowObservation | null {
  const usedPercent = normalizeNumberValue(usedPercentRaw)
  const resetAtMs = resolveResetMs([resetAtRaw])
  if (usedPercent === null && resetAtMs === null) return null
  return {
    key,
    ...(usedPercent === null ? {} : { usedPercent }),
    resetAtMs,
    periodHours,
  }
}

/**
 * Parse the core-polled GLM quota envelope into observation facts. The status
 * signal drives the verdict: `ready` is known, `stale` keeps the last good
 * windows as partial with an explicit staleness note, and `error` or an
 * invalid credential is a failure with the sanitized upstream detail.
 * @param envelope - the auth file's quota envelope forwarded by the Host.
 * @param now - fallback sampling instant when no timestamp signal exists.
 * @returns the parsed verdict, windows, plan marker, and sampling stamp.
 */
export function parseGlmQuotaSignals(envelope: GlmQuotaEnvelope, now: number): GlmQuotaSignalParse {
  const signals = envelope.signals
  const statusSignal = signals[GLM_QUOTA_SIGNAL_KEYS.status]?.trim().toLowerCase()

  const lastSuccessMs = resolveResetMs([signals[GLM_QUOTA_SIGNAL_KEYS.lastSuccessAt]])
  const envelopeMs = resolveResetMs([envelope.observedAt])
  const observedAt = lastSuccessMs ?? envelopeMs ?? now
  const planType = normalizePlanType(signals[GLM_QUOTA_SIGNAL_KEYS.planLevel]) ?? undefined

  if (isFalseSignal(signals[GLM_QUOTA_SIGNAL_KEYS.credentialValid])) {
    return {
      status: 'failure',
      windows: [],
      ...(planType === undefined ? {} : { planType }),
      observedAt,
      error: 'glm quota poll marks the credential invalid; a quota-interface observation, not an inference-key verdict',
    }
  }

  if (statusSignal === 'error') {
    return {
      status: 'failure',
      windows: [],
      ...(planType === undefined ? {} : { planType }),
      observedAt,
      error: sanitizeProbeError(signals[GLM_QUOTA_SIGNAL_KEYS.error] ?? 'glm quota poll failed'),
    }
  }

  const windows = [
    buildWindow(
      'five-hour',
      signals[GLM_QUOTA_SIGNAL_KEYS.fiveHourUsedPercent],
      signals[GLM_QUOTA_SIGNAL_KEYS.fiveHourResetAt],
      5,
    ),
    buildWindow(
      'weekly',
      signals[GLM_QUOTA_SIGNAL_KEYS.weeklyUsedPercent],
      signals[GLM_QUOTA_SIGNAL_KEYS.weeklyResetAt],
      24 * 7,
    ),
  ].filter((window): window is QuotaWindowObservation => window !== null)

  if (statusSignal === 'ready') {
    return {
      status: 'known',
      windows,
      ...(planType === undefined ? {} : { planType }),
      observedAt,
    }
  }
  if (statusSignal === 'stale') {
    return {
      status: 'partial',
      windows,
      ...(planType === undefined ? {} : { planType }),
      observedAt,
      error: 'glm quota signals are stale; showing the last successful sample',
    }
  }
  return {
    status: windows.length === 0 ? 'failure' : 'partial',
    windows,
    ...(planType === undefined ? {} : { planType }),
    observedAt,
    error: 'glm quota status signal is missing or unrecognized',
  }
}
