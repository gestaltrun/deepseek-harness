---
description: "Configure durable IM accounts and routes, then retain scoped message history, provider cursors, Session submission evidence, and outbound outcomes."
kind: "package-reference"
---

# @gestaltrun/dsh-im-runtime

English | [中文](README.zh.md)

## Summary

Use this package to store safe DingTalk or Wangwang account facts, bind complete conversation routes to Workspaces, and retain message delivery state. Inbound pages, history imports, provider cursors, Session submission evidence, Agent task generations, and outbound outcomes have durable query receipts. Credentials remain in the Credentials service. Platform providers own login, event conversion, sends, and receipt lookup; this runtime owns admission into ordinary Agents.

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

Mount Storage, a KV backend, StorageDomain, Credentials, Session persistence, Workspace, AgentLoop, AgentPresets, a default Agent model, this runtime, and at least one `ImTransport` provider. The runtime remains usable for configuration and history when the Agent services are absent; automatic admission activates only in their injected scope.

### When to choose it

Choose this package for the product IM configuration authority shared by Host providers and the IM BFF. Consumers that need wire DTOs or write-only account setup request types should import `@gestaltrun/dsh-im-runtime/types`; Host code imports the root entry for `ImRuntimeService`, `ImRuntimeError`, and `ImTransports`.

### Minimal configuration

`admissionBatchSize` limits one model-visible batch and defaults to 1000. Group `everyN` values cannot exceed this limit. `accountSetupTtlMs` limits unconfirmed provider setup material in Host memory and defaults to five minutes. StorageDomain selects the durable backend, and the Credentials implementation selects the secret store.

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
  config:
    admissionBatchSize: 1000
    accountSetupTtlMs: 300000
```

`listAccountCandidates` returns installed DingTalk profiles or admitted Wangwang merchants from the registered transport. An admitted Wangwang candidate includes its safe endpoint. The UI selects one of these identifiers, and the Host rejects a submitted endpoint that differs from the selected candidate. `previewAccountSetup` asks the transport to verify the write-only input and returns a safe identity, authorization fact, expiration time, and Host-minted setup id without creating an account or writing Credentials. `confirmAccountSetup` fixes that verified identity, stores the credential record and account with one durable operation receipt, and replays the same setup and operation id without creating another account, including after a Host restart. `cancelAccountSetup`, request cancellation, setup expiry, and runtime disposal release unconfirmed in-memory material; JavaScript does not guarantee physical memory erasure. Call `queryAccountOperation` after an uncertain pause, disconnect, reconnect, refresh, or confirmed setup response. `inspectAccount` and `refreshAccount` report provider-observed authorization facts without changing the account identity. Connection intent, authorization, and listener state remain separate facts.

Every route includes platform, account, conversation kind, an `all` or `specific` target, and a Workspace owner. A specific direct target may retain provider peer identifiers separately from its stable platform conversation id. A specific route wins over an `all` route even when the specific route is disabled. Direct routes reject group settings; group routes require at least one of `mention`, positive `everyN`, or positive `fixedIntervalSeconds`.

`createRoute`, `saveRoute`, `rebindRoute`, and `deleteRoute` store their result with the owning account aggregate. `saveRoute` cannot change the Workspace owner. `rebindRoute` and `deleteRoute` compare both the observed route revision and Workspace. Call `queryRouteOperation` after a transport-level timeout before deciding whether to submit another operation id. Simulation-target save and removal use the same explicit query pattern per Workspace.

`ingestInboundPage` durably stores one complete real or configured simulation conversation page, deduplicated by full scope plus platform message identity. A later duplicate can only advance explicit mention evidence from absent or false to true; a submitted row stays submitted and its earlier Session event is unchanged. JSONL imports enter query history and never enter pending Agent delivery. `reconcileSession` scans `SessionPersistence` after a crash and confirms matching stable sources. Delivery records and Session logs remain separate durable writes and do not claim a cross-log transaction.

Provider polling cursors have explicit account-and-stream ownership. The runtime-owned listener sink accepts one provider page with stable per-conversation operation ids. It commits every conversation group, then commits the provider cursor with all page receipts. If the process stops or a later group fails between those writes, it re-reads the old provider cursor and safely replays the groups through durable deduplication. The listener receives an enabled-route plan that identifies whether mention evidence is required. This permits a Wangwang merchant page to cover several conversations and lets DingTalk combine all-group and at-me observations without assigning a provider cursor to one conversation.

`registerOutbound` stores an intent before any platform call. `beginOutboundAttempt` grants one attempt; a restart or repeated begin while dispatch is unresolved records `result-unknown`, which callers query or confirm without a blind retry. Route and account generations are frozen for automated intents. `realScopeForSession` resolves a real Session only from its durable task generation and returns the frozen scope, Workspace, direct recipient, safe account identity, account and listener state, last conversation sync, and provider-known conversation label or group size. Unknown labels and sizes stay absent. The GUI uses `sendManualMessage`, `queryManualMessage`, and `confirmManualMessage` with one stable request id. Confirmation only calls the provider receipt lookup. `retryManualMessage` requires a new request id and a `result-unknown` predecessor from the same Session task, and persists that relation. Manual DSH sends remain available while automatic handling is paused; disconnected, unauthorized, or unavailable-listener accounts reject a new manual intent. Automated intents remain blocked by pause and route-generation checks.

Providers pass actor and echo facts to `classifyInboundSender`. A sent automated outbox match yields `ai`, a sent manual match yields `human-dsh`, and explicit provider-native evidence yields `human-native`. An unmatched configured-account observation remains `unknown`; text equality never changes sender attribution. Mention activation uses only the provider's explicit mention metadata stored with the message.

Durable live or simulation input automatically starts or resumes one ordinary Agent per route generation. Direct messages activate immediately. Group mention, `everyN`, and fixed interval conditions are OR-combined into one batch; the interval timer fires without another inbound event. The Session source records the scope, exact message identities, sender evidence, trigger reasons, route revision, account revision, and Workspace. A rebind leaves an in-flight Agent on its recorded Workspace and sends later input to a new task generation. New input for an unchanged generation uses `steer`, so it enters at the nearest safe step without cancelling active model or tool work.

`createSimulationInstance` accepts one live simulated-user Session already owned by a Workspace with a configured target. It first persists `creating` with a Host-minted tested Session id, the exact target, both Workspace ids, route and account revisions, preset, trigger settings, and allowed participants. It then creates the tested Agent through the normal Agent and preset services, attaches its Session to the target Workspace, flushes both Session logs, and publishes `running`. A specific route fixes its conversation id; an `all` route requires the caller to name one. Target changes affect later instances only. Separate simulated-user Sessions can run isolated instances against the same target.

Member and managed-human injection enter the same durable inbound store and Agent coordinator as provider messages. The Host derives the managed actor from the frozen account identity and checks member injections against the frozen allow-list. Only the simulated-user Session receives `im_sim_*` controls; the tested Agent receives the ordinary scoped history and send tools without simulation internals. Tested-Agent replies use the same scoped outbox, settle locally, and return only to the paired simulated-user Session; no simulation path calls a platform transport. `importSimulationHistory` derives the frozen scope, stores only the source basename and Host-counted total/imported/duplicate rows on the instance, and keeps every imported row query-only. `scopeForSession` returns the authoritative role, peer Session, Workspace pair, and delivery scope for Client navigation.

Inbound content distinguishes text, Markdown, an image placeholder, and unsupported provider types. A quote carries only its available sender, external id, and text context. Unsupported content preserves the original message type and provider-normalized display-safe JSON details; provider credentials, transport headers, and connection configuration are outside this value. These fields persist unchanged for history rendering and Session reconstruction.

`beginStopSimulation` first persists `stopping`, which rejects later input and reply delivery, and returns without waiting for a tool caller's current turn. `waitSimulationStopped` is the GUI terminal barrier. The controller cancels only the paired live activities and the selected scope's coordinator work, retains the simulated-user Session and both logs, and stores `stopped` only after quiescence. Calls are deduplicated across GUI and bound `im_sim_stop` orderings. A stopped instance never resumes; loading the runtime does not resume either running Session merely to display it.

The `@gestaltrun/dsh-im-runtime/tools` entry registers `im_query_history` and `im_send_message` on a trusted tested-Agent context. Neither tool accepts account, conversation, simulation instance, route, or Workspace arguments from the model. Eligible simulated-user Agents receive `im_sim_create`; a running pair adds allow-listed member send, managed-human send, and `im_sim_stop`. These tools bind the actual calling Session and current instance rather than accepting those identities from model arguments. Automated real sends use the task's recorded route and peer identity; if that generation is stale, the outbox records `route-changed` before any provider call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `gestaltrun_im_runtime` StorageDomain has one record per account aggregate, Workspace simulation target, and two-Session simulation instance. The separate `gestaltrun_im_delivery` domain has one aggregate per complete conversation scope, provider-owned cursor records, and route-bound Agent task generations. A conversation aggregate stores inbound messages, deduplication keys, operation receipts, submission evidence, and outbox rows in one durable write. Provider cursor commits happen only after referenced page receipts exist. No operation claims atomicity across credentials, configuration, delivery, provider cursor, Agent task, simulation instance, or Session records.

`ImTransports` reserves one live provider per platform and releases it with the registering Cordis fiber. The runtime starts its listener when a connected, unpaused account has an enabled route and authorization is `ready` or `unchecked`; explicit `required` or `failed` authorization keeps it stopped. `unchecked` lets a provider without a separate identity probe verify its first real listen or poll and does not project a ready identity by itself. A provider `listen` resolves only after that listener is established and verified usable. Its returned `done` promise reports later clean termination or failure. An intentional stop aborts the signal, calls `dispose`, and waits for `done`; changing the enabled-route plan follows that sequence before starting its replacement. Terminal failures do not schedule an unbounded retry. `ctx.imRuntime.subscribe` and the typed `imRuntime/changed` event publish durable changes and later process listener transitions. Snapshot revisions order events within one process generation; durable operation ids and record revisions survive restart.

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
| `src/agent-coordinator.ts` | Durable trigger evaluation and ordinary Agent create, resume, and steer lifecycle |
| `src/simulation-controller.ts` | Persistent two-Session creation, isolated reply delivery, recovery, and terminal stop |
| `src/simulation-tools.ts` | Trusted Session-bound simulation tool registration |
| `src/tools.ts` | Scope-bound history and outbound Agent tools |

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

Each admitted batch reaches the model as one identified user message assembled by the target Agent preset. Its source carries the complete durable evidence required for crash reconciliation. The scope-bound IM tools expose only the admitted conversation's history and outbound path. Simulation tools are present only for a configured simulated-user Workspace or an existing bound instance, and their instance identity comes from the live Agent Session.

#### KV Cache effect

One unchanged route generation reuses its Agent Session and prompt cache. Rebinding creates a new Session because the Workspace and task ownership changed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Provider packages own live identity checks, conversation discovery, listeners, outbound sends, and receipt confirmation.
- A failed partial simulation creation is retained as a safe `failed` record for diagnosis and a fresh retry; the runtime does not delete either user-owned Session log or claim a cross-domain rollback.
- Operation receipts remain durable without automatic pruning because pruning would make an old operation indistinguishable from one never received.
- Credentials and configuration use separate durable services. A failed account write attempts credential rollback and reports both failures if rollback also fails; it does not claim a cross-service transaction.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The migration source and dirty-patch identity are recorded in `UPSTREAM.json`. Run `pnpm --dir product --filter @gestaltrun/dsh-im-runtime test`, `typecheck`, and `build`; after `build`, run `smoke:loader` to exercise the built entry through a real Loader YAML composition.

</details>
