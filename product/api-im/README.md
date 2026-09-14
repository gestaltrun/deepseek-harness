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
- [Delivery reads](#delivery-reads)
- [Build inputs](#build-inputs)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration API

The Host entry requires `imRuntime` and exposes the `im` Remote namespace. Account setup first returns safe verified identity and authorization facts without persisting an account or Credentials record. Confirmation commits that exact Host-held setup under one retained operation identity; cancellation reports whether the setup was released, is confirming, or was already confirmed. Account lifecycle receipt lookup distinguishes a durable result from an explicit miss. Route creation, editing, explicit rebinding, deletion, and receipt lookup reuse runtime request types. Ordinary editing cannot transfer ownership. Documented runtime failures use `im/configuration` with their stable domain code in `details.code`; unexpected provider exceptions remain subject to Gateway sanitization.

A route batch preserves every operation identity and outcome. Targets commit independently. Rejected or conflicting receipts remain distinct from operations whose result is unknown; an unknown operation requires lookup before retry. Simulation-target commands use observed revisions and have their own receipt lookup.

## Client state

The Client entry mounts its own generated contribution through the public Gateway. Each follow generation starts with a complete baseline and then ordered complete replacements. Slow readers coalesce invalidations. Reconnection retains the last usable configuration until a new baseline arrives. Unary responses return operation outcomes and never overwrite newer stream data.

The observables have stable identities, batch structural notifications, and remove observers during disposal. Connection cancellation closes Host subscriptions. Candidate discovery has an independent Client object for each platform; cancelled or superseded reads cannot replace newer choices. UI drafts and selection belong to the consuming UI plugin.

## Delivery reads

Read-only history, outbox, and delivery follow methods require the complete real or simulation scope. A Client reader fixes that scope and its inbound/outbound page cursors for its entire lifetime. Each generation publishes a complete bounded window; matching durable changes refresh that window. Navigation disposes the reader before binding a different scope. Page cursors are independent numeric sequences, and uncertain sends remain `result-unknown`.

Simulation readers project the Host's complete instance list and the authoritative role, peer Session, frozen target, and delivery scope for one selected Session. The instance list decorates Session rows; the Session reader follows one immutable Session identity until navigation disposes it. Creation, participant injection, managed-human injection, and stopping delegate to the public runtime methods. Stopping is a two-step operation: the UI awaits the durable transition to `stopping`, then waits for the Host's terminal result.

Provider admission, cursor commits, submission marking, send attempts, and receipt settlement are not Remote methods. The runtime and trusted providers own those actions. The built smoke uses durable test inputs without contacting a provider; it verifies live pages, scope isolation, invalid inputs, and reader disposal through the generated Gateway.

## Build inputs

Host and Client compile independently. Host declarations and JavaScript precede generation of `lib/typert.host.*` and `lib/typert.remote-client.*`; Client compilation consumes those generated declarations. The packaged Client requests the shared Cordis, Client store, and Gateway identities. Generator and installation checks belong to the product composition. Package tests cover follow ordering and independent results; the built API smoke drives staged setup, lost confirmation replay, receipt queries, real Gateway calls, JSON persistence, reconnection, delayed responses, and a fresh recovery process through a configuration-only test provider.

## Model Experience

These configuration commands do not add model input. The runtime owns any subsequent Session and tool behavior.

### KV Cache effect

None directly.

## Dev Note

No runtime invariant companion is published. The BFF delegates durable ownership to `imRuntime`; ordered follow assertions and runtime mutation receipts enforce the relationships consumed here. Installed profile and GUI acceptance remain separate from these package tests.
