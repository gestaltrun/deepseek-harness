/**
 * Quota observer: assembles one sanitized observation per probe input.
 *
 * Every provider probe is read-only — GET requests, plus the Antigravity
 * quota-summary POST that carries only the project id. No probe sends an
 * inference request, consumes a credit, or mutates account state; the xAI
 * paid health check and the Codex reset-credit consume operation from the
 * upstream management center are deliberately not ported.
 * @module account-pool/quota/observer
 */

import { sanitizeProbeError } from './sanitize.ts'
import {
  QUOTA_MAX_WINDOWS,
  QUOTA_PROBE_MAX_BODY_BYTES,
  type QuotaObservationTransport,
  type QuotaProbeRequest,
  type QuotaProbeResponse,
} from './transport.ts'
import { asRecord } from './normalize.ts'
import {
  CLAUDE_PROBE_HEADERS,
  CLAUDE_USAGE_URL,
  CLAUDE_USAGE_WINDOW_KEYS,
  buildClaudeWindows,
} from './windows-claude.ts'
import {
  CODEX_PROBE_HEADERS,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
  buildCodexWindows,
} from './windows-codex.ts'
import {
  ANTIGRAVITY_PROBE_HEADERS,
  ANTIGRAVITY_QUOTA_URLS,
  buildAntigravityWindows,
} from './windows-antigravity.ts'
import { KIMI_PROBE_HEADERS, KIMI_USAGE_URL, buildKimiWindows } from './windows-kimi.ts'
import {
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_PROBE_HEADERS,
  buildXaiWindow,
} from './windows-xai.ts'
import { parseCodexResetCredits } from './reset-credits.ts'
import { parseGlmQuotaSignals } from './signals-glm.ts'
import { assertNever } from './assert-never.ts'
import type {
  CodexResetCreditsObservation,
  QuotaObservation,
  QuotaObservationStatus,
  QuotaProbeInput,
  QuotaWindowObservation,
} from './types.ts'

/** Observer construction dependencies. */
export interface QuotaObserverOptions {
  /** Host-owned trusted transport; the only outbound channel probes use. */
  readonly transport: QuotaObservationTransport
  /** Reference clock for sampling stamps and relative reset offsets. */
  readonly now?: () => number
}

/** Assembled read-only quota observer. */
export interface QuotaObserver {
  /**
   * Probe one account's quota and return the sanitized observation. The
   * method never throws: transport, boundary, and parse failures become
   * `failure` observations.
   * @param input - provider, opaque account reference, and non-secret metadata.
   * @returns the observation with `observedAt` set at assembly time.
   */
  readonly observe: (input: QuotaProbeInput) => Promise<QuotaObservation>
}

type ProbeOutcome =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly error: string }

interface ProbeContext {
  readonly transport: QuotaObservationTransport
  readonly now: () => number
}

const textEncoder = new TextEncoder()

type DecodeOutcome =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly error: string }

function decodeBoundedPayload(response: QuotaProbeResponse): DecodeOutcome {
  if (response.body !== undefined && response.body !== null && typeof response.body === 'object') {
    // An already-decoded body bypasses the raw-text bound, so the complete
    // retained result is measured after re-serialization.
    let serialized: string
    try {
      serialized = JSON.stringify(response.body)
    } catch {
      return { ok: false, error: 'provider response was not parseable JSON' }
    }
    if (textEncoder.encode(serialized).length > QUOTA_PROBE_MAX_BODY_BYTES) {
      return { ok: false, error: 'provider response exceeded the bounded body limit' }
    }
    return { ok: true, payload: response.body }
  }
  if (typeof response.bodyText !== 'string' || response.bodyText.trim() === '') {
    return { ok: false, error: 'provider response was not parseable JSON' }
  }
  // A char count over the byte bound rejects without encoding; the exact
  // multibyte length decides otherwise.
  if (
    response.bodyText.length > QUOTA_PROBE_MAX_BODY_BYTES ||
    textEncoder.encode(response.bodyText).length > QUOTA_PROBE_MAX_BODY_BYTES
  ) {
    return { ok: false, error: 'provider response exceeded the bounded body limit' }
  }
  try {
    return { ok: true, payload: JSON.parse(response.bodyText) as unknown }
  } catch {
    return { ok: false, error: 'provider response was not parseable JSON' }
  }
}

async function callProbe(ctx: ProbeContext, request: QuotaProbeRequest): Promise<ProbeOutcome> {
  let response
  try {
    response = await ctx.transport.request(request)
  } catch (error) {
    return { ok: false, error: sanitizeProbeError(error) }
  }
  if (response.error !== undefined && response.statusCode === 0) {
    return { ok: false, error: sanitizeProbeError(response.error) }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { ok: false, error: `provider answered status ${String(response.statusCode)}` }
  }
  return decodeBoundedPayload(response)
}

function observation(
  input: QuotaProbeInput,
  now: () => number,
  status: QuotaObservationStatus,
  windows: readonly QuotaWindowObservation[],
  extras: Partial<Pick<QuotaObservation, 'planType' | 'resetCredits' | 'error'>> = {},
): QuotaObservation {
  // The retained output is bounded like the input: an over-limit window set
  // fails loud instead of emitting an unbounded array.
  if (windows.length > QUOTA_MAX_WINDOWS) {
    return {
      provider: input.provider,
      accountRef: input.authIndex,
      status: 'failure',
      observedAt: now(),
      windows: [],
      error: `provider payload claimed more than ${String(QUOTA_MAX_WINDOWS)} quota windows`,
    }
  }
  return {
    provider: input.provider,
    accountRef: input.authIndex,
    status,
    observedAt: now(),
    windows,
    ...extras,
  }
}

async function observeClaude(ctx: ProbeContext, input: QuotaProbeInput): Promise<QuotaObservation> {
  const outcome = await callProbe(ctx, {
    authIndex: input.authIndex,
    method: 'GET',
    url: CLAUDE_USAGE_URL,
    headers: { ...CLAUDE_PROBE_HEADERS },
  })
  if (!outcome.ok) return observation(input, ctx.now, 'failure', [], { error: outcome.error })

  const windows = buildClaudeWindows(asRecord(outcome.payload) ?? {})
  if (windows.length === 0) {
    return observation(input, ctx.now, 'failure', [], { error: 'usage payload carried no windows' })
  }
  const named = windows.filter(window =>
    (CLAUDE_USAGE_WINDOW_KEYS as readonly string[]).includes(window.key),
  ).length
  const hasFable = windows.some(window => window.key === 'seven_day_fable')
  const complete = hasFable
    ? named === CLAUDE_USAGE_WINDOW_KEYS.length - 1
    : named === CLAUDE_USAGE_WINDOW_KEYS.length
  return observation(input, ctx.now, complete ? 'known' : 'partial', windows)
}

async function observeCodex(ctx: ProbeContext, input: QuotaProbeInput): Promise<QuotaObservation> {
  // callProbe never rejects: it converts transport throws into outcomes.
  const [usage, credits] = await Promise.all([
    callProbe(ctx, {
      authIndex: input.authIndex,
      method: 'GET',
      url: CODEX_USAGE_URL,
      headers: { ...CODEX_PROBE_HEADERS },
    }),
    callProbe(ctx, {
      authIndex: input.authIndex,
      method: 'GET',
      url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
      headers: { ...CODEX_PROBE_HEADERS },
    }),
  ])

  if (!usage.ok) {
    return observation(input, ctx.now, 'failure', [], { error: usage.error })
  }
  const { windows, planType } = buildCodexWindows(asRecord(usage.payload) ?? {}, ctx.now())
  if (windows.length === 0) {
    return observation(input, ctx.now, 'failure', [], {
      error: 'usage payload carried no windows',
      ...(planType === undefined ? {} : { planType }),
    })
  }

  let resetCredits: CodexResetCreditsObservation | undefined
  let creditsError: string | undefined
  if (credits.ok) {
    const parsed = parseCodexResetCredits(credits.payload)
    if (parsed.invalidPayload) {
      creditsError = 'reset-credits payload had an unexpected shape'
    } else {
      resetCredits = parsed.observation
    }
  } else {
    creditsError = credits.error
  }

  return observation(
    input,
    ctx.now,
    resetCredits === undefined ? 'partial' : 'known',
    windows,
    {
      ...(planType === undefined ? {} : { planType }),
      ...(resetCredits === undefined ? {} : { resetCredits }),
      ...(creditsError === undefined ? {} : { error: creditsError }),
    },
  )
}

async function observeAntigravity(
  ctx: ProbeContext,
  input: QuotaProbeInput,
): Promise<QuotaObservation> {
  if (input.projectId === undefined || input.projectId.trim() === '') {
    return observation(input, ctx.now, 'failure', [], {
      error: 'antigravity account metadata lacks a project id',
    })
  }
  const body = JSON.stringify({ project: input.projectId })

  let lastError = 'every quota-summary endpoint failed'
  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    const outcome = await callProbe(ctx, {
      authIndex: input.authIndex,
      method: 'POST',
      url,
      headers: { ...ANTIGRAVITY_PROBE_HEADERS },
      body,
    })
    if (!outcome.ok) {
      lastError = outcome.error
      continue
    }
    // The management request facility may wrap the provider body one level deep.
    const direct = asRecord(outcome.payload)
    const nested = direct !== null && 'groups' in direct ? direct : asRecord(direct?.['body'])
    const windows = buildAntigravityWindows(nested ?? direct)
    if (windows.length === 0) {
      lastError = 'quota-summary payload carried no buckets'
      continue
    }
    return observation(input, ctx.now, 'known', windows)
  }
  return observation(input, ctx.now, 'failure', [], { error: lastError })
}

async function observeKimi(ctx: ProbeContext, input: QuotaProbeInput): Promise<QuotaObservation> {
  const outcome = await callProbe(ctx, {
    authIndex: input.authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    headers: { ...KIMI_PROBE_HEADERS },
  })
  if (!outcome.ok) return observation(input, ctx.now, 'failure', [], { error: outcome.error })

  const windows = buildKimiWindows(asRecord(outcome.payload) ?? {}, ctx.now())
  if (windows.length === 0) {
    return observation(input, ctx.now, 'failure', [], { error: 'usage payload carried no limits' })
  }
  return observation(input, ctx.now, 'known', windows)
}

async function observeXai(ctx: ProbeContext, input: QuotaProbeInput): Promise<QuotaObservation> {
  if (input.xaiAccountKind === 'paid') {
    return observation(input, ctx.now, 'unsupported', [], {
      error: 'paid xAI accounts have no read-only quota probe; inference probing stays disabled',
    })
  }

  const headers = { ...XAI_PROBE_HEADERS }
  if (input.xaiUserId !== undefined && input.xaiUserId.trim() !== '') {
    headers['x-userid'] = input.xaiUserId
  }
  const [weekly, monthly] = await Promise.all([
    callProbe(ctx, { authIndex: input.authIndex, method: 'GET', url: XAI_BILLING_WEEKLY_URL, headers }),
    callProbe(ctx, { authIndex: input.authIndex, method: 'GET', url: XAI_BILLING_MONTHLY_URL, headers }),
  ])

  const windows: QuotaWindowObservation[] = []
  for (const [result, fallbackKey] of [
    [weekly, 'weekly'],
    [monthly, 'monthly'],
  ] as const) {
    if (!result.ok) continue
    const window = buildXaiWindow(asRecord(result.payload) ?? {}, fallbackKey)
    if (window !== null && !windows.some(existing => existing.key === window.key)) {
      windows.push(window)
    }
  }

  if (windows.length === 2) return observation(input, ctx.now, 'known', windows)
  if (windows.length === 1) return observation(input, ctx.now, 'partial', windows)
  const tierNote =
    input.xaiAccountKind === 'unknown'
      ? '; account tier is unknown, so a paid account cannot be ruled out'
      : ''
  return observation(input, ctx.now, 'failure', [], {
    error: `billing endpoints returned no quota data${tierNote}`,
  })
}

function observeGlm(ctx: ProbeContext, input: QuotaProbeInput): QuotaObservation {
  // The fork core polls GLM quota itself; this path only parses the existing
  // envelope and never touches the transport.
  if (input.quotaSignals === undefined) {
    return observation(input, ctx.now, 'failure', [], {
      error: 'glm observation requires the core-polled quota signals envelope',
    })
  }
  const parsed = parseGlmQuotaSignals(input.quotaSignals, ctx.now())
  return observation(input, () => parsed.observedAt, parsed.status, parsed.windows, {
    ...(parsed.planType === undefined ? {} : { planType: parsed.planType }),
    ...(parsed.error === undefined ? {} : { error: parsed.error }),
  })
}

/**
 * Assemble a read-only quota observer over an injected trusted transport.
 * @param options - transport and optional reference clock.
 * @returns the observer.
 */
export function createQuotaObserver(options: QuotaObserverOptions): QuotaObserver {
  const ctx: ProbeContext = { transport: options.transport, now: options.now ?? Date.now }
  return {
    observe: async (input) => {
      // The one runtime boundary check on caller input: a branded reference
      // can still be an empty string, and probing with one is meaningless.
      if (input.authIndex.trim() === '') {
        return observation(input, ctx.now, 'failure', [], { error: 'empty account reference' })
      }
      try {
        switch (input.provider) {
          case 'claude':
            return await observeClaude(ctx, input)
          case 'codex':
            return await observeCodex(ctx, input)
          case 'antigravity':
            return await observeAntigravity(ctx, input)
          case 'kimi':
            return await observeKimi(ctx, input)
          case 'xai':
            return await observeXai(ctx, input)
          case 'glm':
            return observeGlm(ctx, input)
          default:
            return assertNever(input.provider)
        }
      } catch (error) {
        return observation(input, ctx.now, 'failure', [], { error: sanitizeProbeError(error) })
      }
    },
  }
}
