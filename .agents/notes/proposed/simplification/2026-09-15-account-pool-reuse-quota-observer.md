# Agent Note: Reuse one quota observer per generation

Status: proposed

English | [中文](2026-09-15-account-pool-reuse-quota-observer.zh.md)

## Problem

[`CLIProxyAccountPool.applyQuotaObservation`](../../../../product/packages/account-pool/src/provider/gateway.ts) calls [`createQuotaObserver`](../../../../product/packages/account-pool/src/quota/observer.ts) on every account observation and builds a fresh `api-call` transport closure even when the provider is GLM.

Production consumers of `createQuotaObserver` are only this gateway method and the quota tests. The observer is a pure assembler over an injected transport and clock; it holds no per-account state. `refreshAllQuota` already fans out under `quotaConcurrency`, so each account currently reconstructs the same factory and the same Host `api-call` binder.

GLM observations no longer probe. [`observeGlm`](../../../../product/packages/account-pool/src/quota/observer.ts) parses `input.quotaSignals` and never reads `ctx.transport`. The gateway still fetches that envelope in `refreshGlmQuotaEnvelope` or roster refresh, then wraps it as `QuotaProbeInput` and constructs the unused probe transport. Tests and docs remain the only extra consumers of the public `parseGlmQuotaSignals` / `GLM_QUOTA_SIGNAL_KEYS` barrel re-exports.

## Proposal

Keep one `QuotaObserver` for the current generation, bound to that generation's `api-call` transport and disposed with the generation. `observe` and `refreshAllQuota` reuse it.

For GLM, parse the already-fetched envelope with `parseGlmQuotaSignals` and write the observation cache directly. Do not construct `QuotaProbeInput` or an `api-call` transport for that provider. Leave Claude, Codex, Antigravity, Kimi, and xAI on the existing probe path.

Stop re-exporting GLM parser symbols from [`quota/index.ts`](../../../../product/packages/account-pool/src/quota/index.ts) unless a production module imports them. Tests import the parser from `signals-glm.ts`.

## Alternatives considered

**Keep reconstructing the observer.** The factory is cheap relative to a provider HTTP probe, but GLM no longer probes and `refreshAllQuota` still pays the construction and closure on every card. The current call site also hides that GLM does not use the transport it always receives.

**Give GLM its own Host observer type.** A second observation API would duplicate status, window, plan, and cache publication already owned by `applyQuotaObservation` / `withQuota`. Routing GLM out of the probe factory is enough.

**Merge `providerCatalog` into `catalog`.** Rejected. [`catalog`](../../../../product/packages/account-pool/src/provider/transport.ts) sends the grok-shell User-Agent so CLIProxyAPI emits the extended listing used for `gestalt-account-pool` registration. [`providerCatalog`](../../../../product/packages/account-pool/src/provider/transport.ts) omits that header so GLM card model lists stay provider-labelled and are not a Grok projection.

## Acceptance criteria

- One observer instance is created when a generation becomes ready and is reused for every quota observation of that generation.
- GLM quota refresh and roster hydration parse the `glm-coding-plan` envelope without posting `api-call`.
- Non-GLM providers still probe through the trusted transport and `$TOKEN$` placeholder.
- Existing GLM envelope, Kimi window, xAI tier, and refresh-all concurrency tests keep covering those behaviors.

## Risks

The observer currently closes over the caller's `signal` inside the transport. A generation-scoped observer must still pass the current operation signal into each `api-call`, so a cancelled single-account refresh cannot abort a later observation on the same generation. GLM envelope parsing stays Host-only; the renderer still receives projected windows, never raw signals.