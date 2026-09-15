---
description: "Manage CLIProxyAPI accounts and quota observations in Gestaltrun, and build the isolated product bundle without changing upstream packages."
kind: "package-bundle"
---
# Account Pool

English | [中文](README.zh.md)

## Summary

`@gestaltrun/dsh-account-pool` manages provider accounts in Settings and makes available pool models selectable through the existing LLM service. It supports Claude, Codex, Antigravity, Kimi, xAI, and GLM Coding Plan enrollment. Desktop product composition includes the bundle; Web installations select it explicitly. Account credentials stay in private product storage, and quota refresh never changes account scheduling or consumes reset credits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Build and verification](#build-and-verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The account-pool Settings section owns login, account enablement, fields, model lists, quota refresh, and explicit credential-file download. Starting a device or PKCE login, and retrying Open authorization in browser, asks the Host to open the HTTPS authorization URL in the system browser. The existing Settings navigation opens account management. Unknown, unsupported, failed, and stale quota observations remain distinct.

Kimi's usage summary follows the provider's [seven-day quota](https://www.kimi.com/help/kimi-code/benefits); its time needle uses that period when the response omits window metadata. Valid explicit metadata takes precedence. Invalid metadata or a missing reset instant leaves the time needle absent; display labels never supply a period.

The [bundle patch](cordis.patch.yml) selects a local subprocess implementation in an isolated scope and stores Desktop accounts under `$DSH_HOME/desktop/account-pool`. A Web profile must explicitly choose its own absolute `stateRoot` and credential-export policy when applying this bundle. Concurrent processes cannot share one state root. The normal profile/plugin installation mechanism owns bundle activation; copying a directory alone does not activate it.

Credential export is an explicit download operation. OAuth accounts export their core-owned auth file; GLM accounts export a product credential JSON document. Ordinary snapshots, model settings, and Remote responses do not return these file bodies. GLM cards identify provider-wide model listings and show unavailable health/history values as unknown.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

One product package owns the account service, core supervisor, private management mapping, LLM adapter, Remote controller, and shared Client. The Go engine is built from the exact source in [UPSTREAM.json](UPSTREAM.json); the installed binary, license, and manifest live in package resources. Every generation has independent TLS trust, credentials, and cancellation. Shutdown withdraws model routes, settles requests, stops the owned process tree, and removes only generation files.

OAuth account files remain core-owned. GLM credentials and supported fields have a private product ledger; the active subset is projected into core configuration. A journal protects ledger updates, and recovery restores the committed ledger before publishing readiness. GLM identities are product references, not fabricated core auth indexes or request counters.

The Client uses typed actions and a controller that owns watch cancellation and command lifetimes. Source DTOs have a type-only public `./types` export. Host/Client descriptors come from the unchanged public Typert generator and have strict codecs. A build-only rollup of the published protocol declarations is checked against the original in separate strict TypeScript programs, then supplies an isolated analysis project. Normal Host/Client compilation and runtime resolve the original npm packages; analysis inputs are excluded from the archive.

The [accepted architecture](../../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.md) owns the alternatives and the exact product-only change scope. Quota parsers are pure observation modules; their attribution and bundled Client licenses are retained in [NOTICE](NOTICE). There is no independent runtime-invariant companion: the Host snapshot is the single business-state authority, and lifecycle/transport tests verify its external effects.

</details>

-----

<a id="build-and-verification"></a>
## Build and verification

The independent `product/` workspace installs exact published DSH dependencies. Its normal compiler configurations contain no repository source aliases. Product build, typecheck, and pack commands run the scope check against the verified base recorded in `UPSTREAM.json`; an intentional new base must be supplied explicitly and reviewed.

The product build creates the Host entry, generates nonempty strict Remote contributions, and compiles the Client module-loader factory. Engine compilation is separate from Node compilation. The engine builder compiles the `community/cliproxyapi` gitlink pinned in `UPSTREAM.json`, verifies that checkout's Git identity, compiles with Go module changes disabled, and emits source/platform/architecture/filename/SHA-256 metadata. The package declares `publishConfig.executableFiles` so pnpm preserves executable permissions for these resources without exposing a package bin. Package preparation builds the selected host target and places its npm archive in `product/dist`.

Native Desktop interaction, authenticated provider inference, local TLS/SSE tests, and unit fixtures are separate evidence lanes. A fake GLM key can verify persistence and management without proving provider authentication.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the registered `gestalt-account-pool` LLM route. Model selection and reasoning defaults enter request metadata before streaming. Account credentials and quota observations do not add model-visible prompt content or change the Session format.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- A target archive contains that target's Go binary; it does not establish a published cross-platform release.
- Real OAuth and authenticated inference depend on available provider accounts and network access. Empty-pool startup and fixture keys do not establish those results.
- GLM quota observations come from the engine's `glm-coding-plan` envelope. The Host parses that envelope and does not probe the GLM usage endpoint itself.
- Signed Desktop release, notarization, and update publication require their separate release environment and authorization.

<a id="dev-note"></a>
## Dev Note

Implementation and combination verification are tracked in the migration delivery record. The package is a development candidate until its installed and native acceptance evidence is complete.
