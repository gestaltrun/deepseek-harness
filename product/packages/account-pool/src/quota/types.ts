/**
 * Observation model for read-only CLIProxyAPI account quota probing.
 *
 * The observation vocabulary distinguishes verified facts from absent ones: a
 * missing window field stays absent so no consumer can render it as zero,
 * full, or a fabricated balance. Provenance and freshness ride on every
 * observation through `observedAt`.
 *
 * Provider payload types mirror the upstream response fields the probes parse;
 * they are structural validations at the transport boundary, not guarantees
 * about upstream stability.
 * @module account-pool/quota/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Account-pool providers with a verified read-only quota observation path. */
export type QuotaProvider = 'claude' | 'codex' | 'antigravity' | 'kimi' | 'xai' | 'glm'

/**
 * Opaque CLIProxyAPI account reference (`auth_index`), branded because it
 * crosses the Host/transport boundary. The owning supervisor maps it to one
 * auth file it supervises; this package never resolves it itself.
 */
export type QuotaAccountRef = Branded<'QuotaAccountRef'>

/**
 * Narrow observation input: one provider, one opaque account reference, and
 * non-secret metadata. Credentials never enter this structure; the trusted
 * transport substitutes the CLIProxyAPI `$TOKEN$` placeholder server-side.
 *
 * This is a Host-side-only structure. The metadata fields are derived by the
 * Host from the same auth file `authIndex` names, and the transport belongs
 * to the supervisor that owns that account; nothing here is renderer-reachable
 * and no caller-supplied field is forwarded upstream verbatim (probe headers
 * are fixed per-provider constants).
 */
export interface QuotaProbeInput {
  /** Provider selecting the probe. */
  readonly provider: QuotaProvider
  /** CLIProxyAPI `auth_index`: an opaque account reference, never a secret. */
  readonly authIndex: QuotaAccountRef
  /** Antigravity GCP project id from auth-file metadata; required for that provider's probe. */
  readonly projectId?: string
  /**
   * xAI account tier derived Host-side (see `isPaidXaiCredential`). Paid
   * accounts have no read-only quota probe and report `unsupported`; `unknown`
   * attempts the free billing endpoints and degrades honestly.
   */
  readonly xaiAccountKind?: 'free' | 'paid' | 'unknown'
  /** xAI user id from auth-file metadata, sent as the `x-userid` header when present. */
  readonly xaiUserId?: string
  /**
   * GLM only: the core-polled passive quota envelope from the auth file
   * (`observed_at` plus the string `signals` map). The GLM path parses this
   * envelope and issues no probe request; every other provider ignores it.
   */
  readonly quotaSignals?: {
    readonly observedAt?: string
    readonly signals: Record<string, string>
  }
}

/** Truth state of one observation. */
export type QuotaObservationStatus = 'known' | 'partial' | 'unsupported' | 'failure'

/**
 * One quota window fact. Every numeric field is optional: the source either
 * supplied it or the field is absent. `periodHours: null` marks a window whose
 * duration the source did not establish (Antigravity unknown window spellings),
 * distinct from an absent `periodHours` where the concept does not apply.
 */
export interface QuotaWindowObservation {
  /** Stable per-provider window key (`five_hour`, `primary`, a bucket id, `weekly`). */
  readonly key: string
  /** Source-supplied display name when one exists. */
  readonly label?: string
  /** Antigravity quota-group title when the window belongs to one. */
  readonly group?: string
  /** Antigravity quota-group description when the source supplied one. */
  readonly groupDescription?: string
  /** Used percentage 0–100 when the source supplied it or both `used` and `limit`. */
  readonly usedPercent?: number
  /** Remaining fraction 0–1 when the source supplied it (Antigravity buckets). */
  readonly remainingFraction?: number
  /** Absolute used amount in the source's own units. */
  readonly used?: number
  /** Absolute limit in the source's own units. */
  readonly limit?: number
  /** Absolute remaining amount in the source's own units. */
  readonly remaining?: number
  /** Window length in hours, or `null` when the source did not establish one. */
  readonly periodHours?: number | null
  /** Absolute reset instant in epoch ms, or `null` when only a relative hint existed. */
  readonly resetAtMs?: number | null
}

/** Read-only Codex rate-limit reset-credit counts. No consume operation exists here. */
export interface CodexResetCreditsObservation {
  /** Credits the account holds, when the source supplied the count. */
  readonly availableCount: number | null
  /** Credits applicable to the current limit, when the source supplied the count. */
  readonly applicableAvailableCount: number | null
  /** Number of credit records listed. */
  readonly creditCount: number
}

/**
 * One sanitized observation. `error` carries a bounded, credential-free
 * message on `unsupported` and `failure`, and may accompany `partial`.
 *
 * Observations are display and diagnostic facts only: they never disable an
 * account, alter routing, or mark exhaustion. A credential-validity signal
 * reflects the quota interface's current observation, not the inference
 * key's overall health. Consumers distinguish `stale` from `failed` through
 * `status` plus `observedAt` and may retain the last known-good observation.
 */
export interface QuotaObservation {
  /** Probed provider. */
  readonly provider: QuotaProvider
  /** Echo of the input `authIndex` for consumer correlation. */
  readonly accountRef: QuotaAccountRef
  /** Truth state of this observation. */
  readonly status: QuotaObservationStatus
  /** Sampling instant in epoch ms; consumers derive staleness from it. */
  readonly observedAt: number
  /** Observed windows; empty on `unsupported` and `failure`. */
  readonly windows: readonly QuotaWindowObservation[]
  /** Source-supplied plan marker when one exists (Codex `plan_type`). */
  readonly planType?: string
  /** Codex reset-credit counts when that sub-request succeeded. */
  readonly resetCredits?: CodexResetCreditsObservation
  /** Bounded, credential-free failure or degradation detail. */
  readonly error?: string
}

/** Claude usage window as reported by `api.anthropic.com/api/oauth/usage`. */
export interface ClaudeUsageWindow {
  readonly utilization?: unknown
  readonly resets_at?: unknown
}

/** One entry of the Claude `limits` array used for model-scoped weekly limits. */
export interface ClaudeUsageLimit {
  readonly kind?: unknown
  readonly percent?: unknown
  readonly resets_at?: unknown
  readonly is_active?: unknown
  readonly scope?: {
    readonly model?: {
      readonly display_name?: unknown
    } | null
  } | null
}

/** Claude usage payload (`five_hour`, `seven_day*`, `iguana_necktie`, `limits`). */
export interface ClaudeUsagePayload {
  readonly [windowKey: string]: unknown
}

/** Codex usage window as reported by `chatgpt.com/backend-api/wham/usage`. */
export interface CodexUsageWindow {
  readonly used_percent?: unknown
  readonly usedPercent?: unknown
  readonly limit_window_seconds?: unknown
  readonly limitWindowSeconds?: unknown
  readonly reset_after_seconds?: unknown
  readonly resetAfterSeconds?: unknown
  readonly reset_at?: unknown
  readonly resetAt?: unknown
}

/** Codex rate-limit block pairing a primary and a secondary window. */
export interface CodexRateLimitInfo {
  readonly allowed?: unknown
  readonly limit_reached?: unknown
  readonly limitReached?: unknown
  readonly primary_window?: CodexUsageWindow | null
  readonly primaryWindow?: CodexUsageWindow | null
  readonly secondary_window?: CodexUsageWindow | null
  readonly secondaryWindow?: CodexUsageWindow | null
}

/** Codex additional named rate limit (for example code review). */
export interface CodexAdditionalRateLimit {
  readonly limit_name?: unknown
  readonly limitName?: unknown
  readonly rate_limit?: CodexRateLimitInfo | null
  readonly rateLimit?: CodexRateLimitInfo | null
}

/** Codex usage payload. */
export interface CodexUsagePayload {
  readonly plan_type?: unknown
  readonly planType?: unknown
  readonly rate_limit?: CodexRateLimitInfo | null
  readonly rateLimit?: CodexRateLimitInfo | null
  readonly code_review_rate_limit?: CodexRateLimitInfo | null
  readonly codeReviewRateLimit?: CodexRateLimitInfo | null
  readonly additional_rate_limits?: readonly CodexAdditionalRateLimit[] | null
  readonly additionalRateLimits?: readonly CodexAdditionalRateLimit[] | null
}

/** Antigravity quota bucket inside `retrieveUserQuotaSummary` groups. */
export interface AntigravityQuotaBucketPayload {
  readonly bucketId?: unknown
  readonly bucket_id?: unknown
  readonly displayName?: unknown
  readonly display_name?: unknown
  readonly remainingFraction?: unknown
  readonly remaining_fraction?: unknown
  readonly window?: unknown
  readonly resetTime?: unknown
  readonly reset_time?: unknown
}

/** Antigravity quota group of buckets. */
export interface AntigravityQuotaGroupPayload {
  readonly displayName?: unknown
  readonly display_name?: unknown
  readonly description?: unknown
  readonly buckets?: unknown
}

/** Antigravity `retrieveUserQuotaSummary` payload. */
export interface AntigravityQuotaSummaryPayload {
  readonly groups?: unknown
}

/** Kimi usage detail: counters plus reset hints in absolute or relative form. */
export interface KimiUsageDetail {
  readonly used?: unknown
  readonly limit?: unknown
  readonly remaining?: unknown
  readonly name?: unknown
  readonly title?: unknown
  readonly resetAt?: unknown
  readonly reset_at?: unknown
  readonly resetTime?: unknown
  readonly reset_time?: unknown
  readonly resetIn?: unknown
  readonly reset_in?: unknown
  readonly ttl?: unknown
  readonly duration?: unknown
  readonly timeUnit?: unknown
}

/** Kimi explicit window metadata (`duration` plus protobuf-style `timeUnit`). */
export interface KimiLimitWindow {
  readonly duration?: unknown
  readonly timeUnit?: unknown
}

/** Kimi named limit item. */
export interface KimiLimitItem extends KimiUsageDetail {
  readonly scope?: unknown
  readonly detail?: KimiUsageDetail
  readonly window?: KimiLimitWindow
}

/** Kimi usage payload (`api.kimi.com/coding/v1/usages`). */
export interface KimiUsagePayload {
  readonly usage?: KimiUsageDetail
  readonly limits?: unknown
}

/** xAI billing period with optional explicit start/end instants. */
export interface XaiBillingPeriod {
  readonly type?: unknown
  readonly start?: unknown
  readonly end?: unknown
}

/** xAI per-product usage entry. */
export interface XaiProductUsageEntry {
  readonly product?: unknown
  readonly usagePercent?: unknown
  readonly usage_percent?: unknown
}

/** xAI billing config inside the `cli-chat-proxy.grok.com/v1/billing` payload. */
export interface XaiBillingConfig {
  readonly currentPeriod?: XaiBillingPeriod | null
  readonly current_period?: XaiBillingPeriod | null
  readonly creditUsagePercent?: unknown
  readonly credit_usage_percent?: unknown
  readonly billingPeriodStart?: unknown
  readonly billing_period_start?: unknown
  readonly billingPeriodEnd?: unknown
  readonly billing_period_end?: unknown
  readonly productUsage?: unknown
  readonly product_usage?: unknown
  readonly monthlyLimit?: unknown
  readonly monthly_limit?: unknown
  readonly used?: unknown
  readonly onDemandCap?: unknown
  readonly on_demand_cap?: unknown
  readonly onDemandUsed?: unknown
  readonly on_demand_used?: unknown
}

/** xAI billing payload wrapper (`config` carries the counters). */
export interface XaiBillingPayload {
  readonly config?: XaiBillingConfig | null
}
