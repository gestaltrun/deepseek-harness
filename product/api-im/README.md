---
description: "IM configuration commands, generated Remote methods, and reconnecting Client objects."
kind: "package-plugin"
---

# @gestaltrun/dsh-api-im

English | [中文](README.zh.md)

## Summary

This package connects the product IM runtime to Client configuration objects. The Host owns mutation results; the Client publishes configuration only from its ordered follow stream. UI plugins consume `ctx.im` without owning accounts or routing records.

## Table of Contents

- [Configuration API](#configuration-api)
- [Client state](#client-state)
- [Build inputs](#build-inputs)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration API

The Host entry requires `imRuntime` and exposes the `im` Remote namespace. Account setup passes write-only credentials to the runtime and returns safe provider facts. Route creation, editing, explicit rebinding, deletion, and receipt lookup reuse runtime request types. Ordinary editing cannot transfer ownership. Documented runtime failures use `im/configuration` with their stable domain code in `details.code`; unexpected provider exceptions remain subject to Gateway sanitization.

A route batch preserves every operation identity and outcome. Targets commit independently. Rejected or conflicting receipts remain distinct from operations whose result is unknown; an unknown operation requires lookup before retry. Simulation-target commands use observed revisions and have their own receipt lookup.

## Client state

The Client entry mounts its own generated contribution through the public Gateway. Each follow generation starts with a complete baseline and then ordered complete replacements. Slow readers coalesce invalidations. Reconnection retains the last usable configuration until a new baseline arrives. Unary responses return operation outcomes and never overwrite newer stream data.

The observable has stable identity, batches structural notifications, and removes observers during disposal. Connection cancellation closes the Host subscription. Candidate discovery has an independent Client object for each platform; cancelled or superseded reads cannot replace newer choices. UI drafts and selection belong to the consuming UI plugin.

## Build inputs

Host and Client compile independently. Host declarations and JavaScript precede generation of `lib/typert.host.*` and `lib/typert.remote-client.*`; Client compilation consumes those generated declarations. The packaged Client requests the shared Cordis, Client store, and Gateway identities. Generator and installation checks belong to the product composition. Package tests cover follow ordering and independent results; the built API smoke drives real Gateway calls, JSON persistence, reconnection, delayed responses, and a fresh recovery process through a configuration-only test provider.

## Model Experience

These configuration commands do not add model input. The runtime owns any subsequent Session and tool behavior.

### KV Cache effect

None directly.

## Dev Note

No runtime invariant companion is published. The BFF delegates durable ownership to `imRuntime`; ordered follow assertions and runtime mutation receipts enforce the relationships consumed here. Installed profile and GUI acceptance remain separate from these package tests.
