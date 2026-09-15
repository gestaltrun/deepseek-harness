/**
 * Read-only CLIProxyAPI account quota observation.
 *
 * One public entry: {@link createQuotaObserver} assembles per-provider
 * read-only probes over an injected trusted transport and returns sanitized
 * observations (`known` / `partial` / `unsupported` / `failure` plus the
 * sampling instant). The package holds no management secret and no account
 * credential, sends no inference request, and performs no mutation; window
 * fields the source did not supply stay absent rather than reading as zero
 * or full.
 *
 * Probe construction and payload normalization are ported from the official
 * CLIProxyAPI management center (router-for-me/Cli-Proxy-API-Management-Center
 * at ed5f1c48e11ba7335f1e8f676f228c280196af85, MIT); see NOTICE.
 * @module account-pool/quota
 */

export { createQuotaObserver } from './observer.ts'
export type { QuotaObserver, QuotaObserverOptions } from './observer.ts'
export {
  QUOTA_TOKEN_PLACEHOLDER,
  type QuotaObservationTransport,
  type QuotaProbeRequest,
  type QuotaProbeResponse,
} from './transport.ts'
export { isPaidXaiCredential } from './xai-tier.ts'
export {
  GLM_QUOTA_SIGNAL_KEYS,
  parseGlmQuotaSignals,
  type GlmQuotaEnvelope,
  type GlmQuotaSignalParse,
} from './signals-glm.ts'
export type {
  CodexResetCreditsObservation,
  QuotaObservation,
  QuotaObservationStatus,
  QuotaProbeInput,
  QuotaProvider,
  QuotaWindowObservation,
} from './types.ts'
