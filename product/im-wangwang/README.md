---
description: "Connect an admitted Wangwang merchant with write-only credentials, poll durable conversation pages, and send with explicit delivery outcomes."
kind: "package-reference"
---

# @gestaltrun/dsh-im-wangwang

English | [中文](README.zh.md)

## Summary

Use this package to connect an admitted Wangwang merchant to the product IM runtime. The merchant catalog fixes the endpoint and identity before setup; the account form supplies write-only access-key values. Polling sends complete multi-conversation pages to the runtime before the merchant cursor advances. Outbound calls preserve confirmed, failed, and unknown results without blind retries.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount StorageDomain, Credentials, `@gestaltrun/dsh-im-runtime`, and this package in that order. The admitted catalog belongs to deployment configuration. `listAccountCandidates` returns each admitted `candidateId` with its safe endpoint; a UI must submit both values unchanged and must not accept an arbitrary merchant id or endpoint. The Host rejects a setup endpoint that differs from the selected candidate.

### When to choose it

Choose this package for direct buyer conversations served by a statically admitted Wangwang or QianNiu merchant. Use a different provider when the platform does not implement the reviewed HMAC event, message, and receipt endpoints.

### Minimal configuration

```yaml
- name: '@gestaltrun/dsh-im-runtime'
- name: '@gestaltrun/dsh-im-wangwang'
  config:
    admittedMerchants:
      - candidateId: travel-store
        endpoint: https://openapi.example.invalid
        merchantId: merchant-001
        displayName: Travel Store
        mainServiceAccountId: service-001
    pollIntervalMs: 1000
    pollLimit: 50
    pollWaitSeconds: 15
```

| Field | Default | Meaning |
|---|---:|---|
| `admittedMerchants` | required | Static candidate, endpoint, merchant identity, display name, and service-account identity. Candidate and merchant ids must be unique. |
| `pollIntervalMs` | `1000` | Delay before each subsequent polling request. |
| `pollLimit` | `50` | Page size from 1 through 100. |
| `pollWaitSeconds` | `15` | Provider long-poll wait from 0 through 30 seconds. |

Account setup submits the selected `candidateId` and endpoint with `accessKeyId` and `accessKeySecret`; only the access-key fields are secret. The provider checks those credentials through the configured endpoint and returns the observed authorization fact plus a Credentials grant to the runtime. During interactive setup, the Host keeps that grant in memory after `previewAccountSetup` and stores it only through `confirmAccountSetup`; cancellation, expiration, and shutdown release an unconfirmed grant. Every inspect, discovery, listener, send, and confirmation operation reads the stored grant again, so credential rotation reaches the next operation without restarting the plugin.

Authorization and listener facts remain separate. A generic HTTP 401 or 403 is a failed check; only an explicit provider expiry or revocation code becomes `required`. Listener readiness follows a successful provider page request and durable runtime receipt, rather than timer creation.

Each polled merchant page is filtered by the current listener plan, grouped by conversation, and submitted once through `receivePage`. An `all` route includes applicable future buyer conversations; a specific route admits only its stable conversation id. Stable page and conversation operation ids let the runtime retain completed groups after a partial failure. The provider advances the merchant cursor only after every applicable group is durable, including a page with no matching groups. A restart may replay from zero once, receive the persisted cursor conflict, and continue from the runtime-owned position without dropping or duplicating durable messages.

The sender parser preserves external, configured-native, configured-echo, and provider-unknown evidence. Unsupported `senderType` values remain unknown. The stable conversation id stays separate from the buyer customer id; discovery and inbound evidence retain that peer for direct sending across runtime restarts. The provider never treats text equality as self or Agent evidence and does not fall back to another merchant.

Outbound send uses the durable buyer identity and the runtime request id as the platform request id; it never guesses a customer id from the conversation id. A network failure, HTTP 408 or 429, 5xx, invalid JSON, or missing receipt stays `unknown`. Confirmed send receipts retain optional provider producer and revision evidence in the durable raw status. `confirm` queries the provider status endpoint and changes the result only when the provider explicitly confirms sent or failed.

The listener returns only after the initial provider request and runtime cursor receipt. Its terminal handle settles normally for disconnect, plan restart, and shutdown, and rejects when later polling fails so the runtime does not retain stale running state.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The protocol layer canonicalizes query values and signs `METHOD`, path, query, and timestamp with HMAC-SHA256. It validates merchant identity, cursor monotonicity, message type, timestamp, and required identifiers at the HTTP boundary. Provider response bodies are not copied into errors.

The transport layer owns the admitted directory, per-operation credential reads, account checks, polling lifetime, page grouping, sender evidence, and outbound results. The product runtime owns account state, durable conversation receipts, provider cursors, outbox attempts, and routing.

| Source | Purpose |
|---|---|
| `src/auth.ts` | Canonical query and HMAC headers |
| `src/protocol.ts` | HTTP calls, strict wire parsing, and receipt classification |
| `src/config.ts` | Admitted merchant and polling configuration |
| `src/transport.ts` | Runtime transport registration and lifecycle |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product IM runtime](../im-runtime/README.md) — durable account, page, cursor, and outbox behavior
- [Credentials](../../packages/credentials/credentials/README.md) — opaque record ownership and per-operation reads
- [IM migration decision](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md) — product package ownership and provider boundaries

-----

<a id="model-experience"></a>
## Model Experience

Indirect. This package supplies provider messages and send results to the product runtime. It registers no model tool or prompt and cannot submit an Agent turn by itself.

#### KV Cache effect

None; provider polling and account checks do not assemble a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The reviewed protocol has no `whoami`; merchant identity comes only from the admitted catalog and successful credential-bound calls.
- This candidate has local protocol, runtime, and Loader evidence. Real merchant reads, sends, receipt confirmation, and GUI acceptance remain pending an explicitly authorized test account.
- Only direct conversations and text or markdown payloads are admitted. Unsupported message formats stop page progression for safe replay.
- A provider deployment without the reviewed message-status endpoint cannot turn an unknown send into sent or failed evidence.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Migration provenance and the retained legacy behavior are recorded in `UPSTREAM.json`. Run this package's test, typecheck, and build scripts after building `@gestaltrun/dsh-im-runtime`; then run `smoke:loader` against the built entries. The controlled HTTP and JSON Storage smoke covers multi-conversation page admission, future conversations under `all`, replay deduplication, disconnect, reconnect, and teardown.

</details>
