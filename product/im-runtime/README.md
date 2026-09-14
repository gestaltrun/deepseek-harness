---
description: "Configure durable IM accounts, takeover routes, and workspace simulation targets while keeping credentials out of client projections."
kind: "package-reference"
---

# @gestaltrun/dsh-im-runtime

English | [中文](README.zh.md)

## Summary

Use this package to store safe DingTalk or Wangwang account facts, bind complete conversation routes to Workspaces, and select a route for channel simulation. Route changes use durable idempotency receipts and compare-and-swap tokens, so a client can query an uncertain result without blindly repeating ownership changes. Credentials remain in the Credentials service. Platform login, message delivery, and simulation Sessions require their provider and orchestration packages.

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

Choose this package for the product IM configuration authority shared by Host providers and the IM BFF. Consumers that only need wire DTOs should import `@gestaltrun/dsh-im-runtime/types`; Host code imports the root entry for `ImRuntimeService`, `ImRuntimeError`, and `ImTransports`.

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `gestaltrun_im_runtime` StorageDomain has one record per account aggregate and one record per Workspace simulation target. An account record contains its safe metadata, route map, and operation receipts; `KvTable.update` commits route uniqueness, CAS checks, the route change, and its receipt in one durable write. Simulation-target operations are serialized in this process and write one Workspace record. No operation claims atomicity across credentials, accounts, or simulation-target records.

`ImTransports` reserves one live provider per platform and releases it with the registering Cordis fiber. `ctx.imRuntime.subscribe` and the typed `imRuntime/changed` event run after the matching durable write. Snapshot revisions order events within one process generation; durable operation ids and record revisions survive restart.

| Source | Purpose |
|---|---|
| `src/types.ts` | Client-safe identifiers, views, requests, and receipts |
| `src/service-types.ts` | Host Context service and typed event declarations |
| `src/runtime.ts` | Account, route, resolution, CAS, and simulation-target behavior |
| `src/schema.ts` | Durable StorageDomain records and validation |
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

None, as this configuration package registers no prompt, tool, or session event.

#### KV Cache effect

None; account and route configuration alone does not assemble or send a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Provider packages own live identity checks, conversation discovery, listeners, outbound sends, and receipt confirmation.
- Message cursors, outbox records, Agent admission, and the two-Session simulation lifecycle are separate runtime slices.
- Operation receipts remain durable without automatic pruning because pruning would make an old operation indistinguishable from one never received.
- Credentials and configuration use separate durable services. A failed account write attempts credential rollback and reports both failures if rollback also fails; it does not claim a cross-service transaction.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The migration source and dirty-patch identity are recorded in `UPSTREAM.json`. Run `pnpm --dir product --filter @gestaltrun/dsh-im-runtime test`, `typecheck`, and `build`; after `build`, run `smoke:loader` to exercise the built entry through a real Loader YAML composition.

</details>
