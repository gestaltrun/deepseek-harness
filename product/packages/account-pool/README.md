---
description: "Manage CLIProxyAPI accounts and quota observations in Gestaltrun, and build the isolated product bundle without changing upstream packages."
kind: "package-bundle"
---
# Account Pool

English | [中文](README.zh.md)

## Summary

`@gestaltrun/dsh-account-pool` manages provider accounts in Settings and makes available pool models selectable through the existing LLM service. It supports Claude, Codex, Antigravity, Kimi, xAI, and GLM Coding Plan enrollment. Desktop product composition includes the bundle; Web installations combine `@gestaltrun/dsh-model-center` with this bundle for the complete Models experience. Account credentials stay in private product storage, and quota refresh never changes account scheduling or consumes reset credits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Build and verification](#build-and-verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Settings section owns login, enablement, fields, model lists, and quota refresh. Device and PKCE login, and Open authorization in browser, ask the Host to open the HTTPS authorization URL in the system browser. Unknown, unsupported, failed, and stale quota observations remain distinct.

Kimi's usage summary follows the provider's [seven-day quota](https://www.kimi.com/help/kimi-code/benefits); its time needle uses that period when the response omits window metadata. Valid explicit metadata takes precedence. Invalid metadata or a missing reset instant leaves the time needle absent; display labels never supply a period.

The [bundle patch](cordis.patch.yml) selects a local subprocess implementation in an isolated scope and stores Desktop accounts under `$DSH_HOME/desktop/account-pool`. A Web profile must choose its own absolute `stateRoot`. Concurrent processes cannot share one state root. Profile/plugin installation activates the bundle; copying a directory does not.

Account files, including GLM Coding Plan JSON, live in the engine `auth-dir`. GLM cards identify provider-wide model listings and show unavailable health/history values as unknown.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

One product package owns the account service, engine supervisor, management mapping, LLM adapter, Remote controller, and Client. The Go engine is built from the source in [UPSTREAM.json](UPSTREAM.json). Each generation has independent loopback HTTP credentials and cancellation. Shutdown withdraws model routes, settles requests, stops the owned process tree, and removes only generation files.

Account files remain engine-owned under `auth-dir`. GLM identities come from the engine roster. The Host opens HTTPS authorization URLs; the renderer does not.

The bundle reserves `gestalt-account-pool` on the existing Model Center row. The account pool publishes catalog fields to `llm-pi-ai.providers.gestalt-account-pool.models` and owns the matching runtime adapter. Source refreshes replace manual edits to catalog-owned fields while preserving other providers and provider fields. An empty catalog keeps the configurable provider entry with `models: []` and withdraws the runtime route. A model with no explicit input list inherits the provider's `defaultInput`, or text when that list is also absent.

The [accepted architecture](../../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.md) owns alternatives and the product-only change scope. Quota parsers are observation modules; attribution is in [NOTICE](NOTICE). The Host snapshot is the business-state authority; lifecycle and transport tests verify its external effects.

</details>

-----

<a id="build-and-verification"></a>
## Build and verification

The independent `product/` workspace installs published DSH dependencies. Product build, typecheck, and pack commands run the scope check against the verified base in `UPSTREAM.json`.

The product build creates the Host entry, generates nonempty strict Remote contributions, and compiles the Client factory. The engine builder compiles the `community/cliproxyapi` gitlink pinned in `UPSTREAM.json` and emits source/platform/architecture/filename/SHA-256 metadata. `publishConfig.executableFiles` preserves executable permissions without exposing a package bin.

Native Desktop interaction, authenticated provider inference, and unit fixtures are separate evidence lanes. A fake GLM key can verify persistence and management without proving provider authentication.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the registered `gestalt-account-pool` LLM route. Model selection and reasoning defaults enter request metadata before streaming. Account credentials and quota observations do not add model-visible prompt content or change the Session format.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- A target archive contains that target's Go binary; it does not establish a published cross-platform release.
- Real OAuth and authenticated inference depend on available provider accounts and network access. Empty-pool startup and fixture keys do not establish those results.
- GLM quota observations come from the engine's auth-files envelope. The Host parses that envelope and does not probe the GLM usage endpoint itself.
- Signed Desktop release, notarization, and update publication require their separate release environment and authorization.

<a id="dev-note"></a>
## Dev Note

The package is a development candidate until installed and native acceptance evidence is complete. A leftover `glm-accounts.json` is migrated onto `auth-dir` once at lock acquisition.
