---
description: "Configure durable IM accounts and routes, then retain scoped message history, provider cursors, Session submission evidence, and outbound outcomes."
kind: "package-reference"
---

# @gestaltrun/dsh-im-runtime

English | [中文](README.zh.md)

## Summary

Use this package to store safe DingTalk or Wangwang account facts, bind complete conversation routes to Workspaces, and retain message delivery state. Inbound pages, history imports, provider cursors, Session submission evidence, and outbound outcomes have durable query receipts. Credentials remain in the Credentials service. Platform login, actual sends, and Agent orchestration require their provider and orchestration packages.

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

Mount Storage, a KV backend, StorageDomain, Credentials, this runtime, and at least one `ImTransport` provider in that order.

### When to choose it

Choose this package for the product IM configuration authority shared by Host providers and the IM BFF. Consumers that need wire DTOs or write-only account setup request types should import `@gestaltrun/dsh-im-runtime/types`; Host code imports the root entry for `ImRuntimeService`, `ImRuntimeError`, and `ImTransports`.

### Minimal configuration

The runtime has no deployment configuration fields. StorageDomain selects the durable backend, and the Credentials implementation selects the secret store.

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /absolute/path/to/storage
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-credentials-local'
  config:
    path: /absolute/path/to/.credentials.yaml
- name: '@gestaltrun/dsh-im-runtime'
```

`listAccountCandidates` returns installed DingTalk profiles or admitted Wangwang merchants from the registered transport. The UI selects one of these identifiers and does not invent a default profile, merchant id, or endpoint. The transport then validates write-only setup input and returns safe identity facts plus an optional credential record. The runtime stores that record through `ctx.credentials` before publishing the account. It exposes authorization and listener states separately and never derives a `connected` flag.

Every route includes platform, account, conversation kind, an `all` or `specific` target, and a Workspace owner. A specific route wins over an `all` route even when the specific route is disabled. Direct routes reject group settings; group routes require at least one of `mention`, positive `everyN`, or positive `fixedIntervalSeconds`.

`createRoute`, `saveRoute`, `rebindRoute`, and `deleteRoute` store their result with the owning account aggregate. `saveRoute` cannot change the Workspace owner. `rebindRoute` and `deleteRoute` compare both the observed route revision and Workspace. Call `queryRouteOperation` after a transport-level timeout before deciding whether to submit another operation id. Simulation-target save and removal use the same explicit query pattern per Workspace.

`ingestInboundPage` durably stores one complete conversation page, deduplicated by full scope plus platform message identity. JSONL imports enter query history and never enter pending Agent delivery. Use `sessionUserMessage` to create a stable identified `user/message`; after that Session log is durable, call `markSubmitted`. `reconcileSession` scans `SessionPersistence` after a crash and confirms any matching stable sources. These are separate durable writes and do not claim a transaction across the delivery domain and Session log.

Provider polling cursors have explicit account-and-stream ownership. A provider first commits every conversation page, then passes all page operation receipts to `commitProviderCursor`. If the process stops between those steps, it re-reads the old provider cursor and safely replays the pages through durable deduplication. This permits a Wangwang merchant page to cover several conversations without assigning the merchant cursor to one conversation.

`registerOutbound` stores an intent before any platform call. `beginOutboundAttempt` grants one attempt; a restart or repeated begin while dispatch is unresolved records `result-unknown`, which callers query or confirm without a blind retry. Route and account generations are frozen for automated intents. Manual DSH sends and simulation sends remain available while an account or route is paused, while old automated intents cannot flush after a pause or route-change cycle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `gestaltrun_im_runtime` StorageDomain has one record per account aggregate and one record per Workspace simulation target. The separate `gestaltrun_im_delivery` domain has one aggregate per complete conversation scope plus provider-owned cursor records. A conversation aggregate stores inbound messages, deduplication keys, operation receipts, submission evidence, and outbox rows in one durable write. Provider cursor commits happen only after referenced page receipts exist. No operation claims atomicity across credentials, configuration, delivery, provider cursor, or Session records.

`ImTransports` reserves one live provider per platform and releases it with the registering Cordis fiber. `ctx.imRuntime.subscribe` and the typed `imRuntime/changed` event run after the matching durable write. Snapshot revisions order events within one process generation; durable operation ids and record revisions survive restart.

| Source | Purpose |
|---|---|
| `src/types.ts` | Client-safe identifiers, views, requests, and receipts |
| `src/delivery-types.ts` | Client-safe history, cursor, Session-source, and outbox DTOs |
| `src/service-types.ts` | Host Context service and typed event declarations |
| `src/runtime.ts` | Configuration behavior and Host-facing Session integration |
| `src/delivery.ts` | Scoped receive, query, submission, cursor, and outbox behavior |
| `src/schema.ts` | Durable StorageDomain records and validation |
| `src/delivery-schema.ts` | Durable conversation and provider-cursor aggregates |
| `src/transports.ts` | Reversible platform-provider registry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Architecture](../../docs/architecture.md) — persistence services used by the runtime
- [Credential service](../../packages/credentials/credentials/README.md) — opaque record ownership and write semantics
- [Workspace service](../../packages/workspace/workspace/README.md) — authoritative Workspace identifiers
- [IM migration decision](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md) — product package boundaries and later delivery slices

-----

<a id="model-experience"></a>
## Model Experience

`sessionUserMessage` returns the stored inbound text as an identified user message. Its source carries the stable scope id, message id, and delivery sequence used for crash reconciliation. The package does not register a prompt or tool and does not start an Agent by itself.

#### KV Cache effect

None; account and route configuration alone does not assemble or send a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Provider packages own live identity checks, conversation discovery, listeners, outbound sends, and receipt confirmation.
- Agent admission, automatic reply pumping, provider connection controls, and the two-Session simulation lifecycle are later product slices.
- Operation receipts remain durable without automatic pruning because pruning would make an old operation indistinguishable from one never received.
- Credentials and configuration use separate durable services. A failed account write attempts credential rollback and reports both failures if rollback also fails; it does not claim a cross-service transaction.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The migration source and dirty-patch identity are recorded in `UPSTREAM.json`. Run `pnpm --dir product --filter @gestaltrun/dsh-im-runtime test`, `typecheck`, and `build`; after `build`, run `smoke:loader` to exercise the built entry through a real Loader YAML composition.

</details>
