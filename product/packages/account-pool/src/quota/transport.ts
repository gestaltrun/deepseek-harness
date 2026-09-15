/**
 * Trusted transport contract for quota probes.
 *
 * The observer never holds the CLIProxyAPI management secret and never sees an
 * account credential: probe headers carry the literal `$TOKEN$` placeholder,
 * which only the Host-owned transport substitutes when it forwards the request
 * through the management API's request facility. The account-pool provider
 * injects the implementation; this package defines the narrow surface.
 * @module account-pool/quota/transport
 */

/**
 * Header value placeholder forwarded verbatim. CLIProxyAPI's management
 * request facility replaces it with the selected account's token.
 */
export const QUOTA_TOKEN_PLACEHOLDER = '$TOKEN$'

/**
 * Maximum response the observer retains from one probe, in UTF-8 bytes. The
 * bound applies to the complete decoded result: raw text is measured by
 * encoded byte length (multibyte-safe), and an already-decoded body is
 * measured after re-serialization. A larger body is a bounded `failure`,
 * never a partial parse. Security invariant, not a tunable.
 */
export const QUOTA_PROBE_MAX_BODY_BYTES = 1_048_576

/**
 * Maximum windows one observation retains. A payload claiming more fails loud
 * instead of emitting an unbounded array. Security invariant, not a tunable.
 */
export const QUOTA_MAX_WINDOWS = 256

import type { QuotaAccountRef } from './types.ts'

/** One read-only probe request handed to the trusted transport. */
export interface QuotaProbeRequest {
  /** CLIProxyAPI `auth_index` selecting the account the transport authenticates as. */
  readonly authIndex: QuotaAccountRef
  /** HTTP method; probes are read-only, so only GET and POST exist. */
  readonly method: 'GET' | 'POST'
  /** Absolute provider URL; each provider's probe builds only its verified endpoints. */
  readonly url: string
  /** Request headers; credential placeholders stay literal for the transport. */
  readonly headers: Record<string, string>
  /** Serialized request body for POST probes (Antigravity). */
  readonly body?: string
}

/** Transport reply for one probe request. */
export interface QuotaProbeResponse {
  /** HTTP status code; 0 when the request never reached the provider. */
  readonly statusCode: number
  /** Parsed JSON body when the transport already decoded one. */
  readonly body?: unknown
  /** Raw body text otherwise; the observer bounds it before parsing. */
  readonly bodyText?: string
  /** Transport-level failure detail when no HTTP exchange completed. */
  readonly error?: string
}

/**
 * Host-owned probe channel. Implementations authenticate against the local
 * CLIProxyAPI management API and forward the request as the referenced
 * account; they never expose the management secret or a generic request
 * facility to observation consumers.
 */
export interface QuotaObservationTransport {
  /**
   * Execute one read-only probe request.
   * @param request - provider endpoint, headers, and optional body built by a probe.
   * @returns the provider reply, or a status-0 response with `error` on transport failure.
   */
  readonly request: (request: QuotaProbeRequest) => Promise<QuotaProbeResponse>
}
