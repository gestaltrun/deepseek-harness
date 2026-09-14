# Agent Note: Product-owned CLIProxyAPI account pool

Status: proposed

English | [中文](2026-09-14-plugin-account-pool.zh.md)

## Problem

Desktop users need to manage provider accounts, inspect quota, and use pooled models from the normal Settings and model-selection flows. Electron-owned account logic would give Web a different implementation and put business credentials in shell IPC. The existing [capability architecture](../../../../docs/architecture.md) requires reversible plugin registrations and a complete Service Definition, Service Provider, and Consumer composition.

## Proposal

Implement the complete feature in `product/packages/account-pool` as the single product-owned package `@gestaltrun/dsh-account-pool`. Its internal service, provider, RPC, client, and quota modules preserve separate responsibilities without adding upstream workspace packages. The package declares its own bundle and uses only existing public dependencies. It registers the stable `gestalt-account-pool` LLM provider through `ctx.llm`; each live request retains its process generation's private inference authority.

Desktop includes the composition by default. Web can select the same bundle explicitly. Account-pool UI owns a separate Settings section and contributes read-only live route information to the existing Models footer. The footer adds no navigation callback: users enter the account pool through the existing Settings navigation. The account pool does not change the model center or Settings navigation APIs, write the `llm-pi-ai` settings namespace, restore the removed desktop client package, or add account-management Electron IPC.

Persistent account configuration and credential storage must survive a stopped generation. In particular, GLM account changes must be restored when the provider starts again; generation cleanup removes temporary process files, not committed account configuration. The renderer receives only account summaries and typed operations, never management credentials, inference keys, or general management URLs.

### Ownership and prohibited changes

All feature implementation, public product exports, tests, generated types, quota notices, Go build tools, and binary resources belong to `product/packages/account-pool`. The existing independent product workspace owns dependency installation, its lockfile, compiler configuration, build, tests, and package archive. Desktop edits are limited to the existing product glue `apps/desktop/src/product-profile.ts`, `apps/desktop/scripts/product-artifacts.ts`, `apps/desktop/tests/product-profile.spec.ts`, and `apps/desktop/tests/product-artifacts.spec.ts`. They add the bundle and extend product artifact validation respectively; other `apps/**` edits are prohibited by default, and Electron gains no account business logic.

Do not modify, add, or publish feature code under `packages/**` or `vendor/**`. Do not add root workspace entries, root TypeScript references or paths, or root lockfile dependencies. Do not patch upstream dependencies through `patchedDependencies`, postinstall, edited `node_modules`, upstream `/src` imports, or copied internal implementation. In particular, the upstream PiAi adapter, options, exports, and profile resolver remain unchanged. Packaging keeps CLIProxyAPI source/build ownership and platform binaries inside the product package rather than adding account-pool build logic to an upstream application. Its `UPSTREAM.json` pins the build-time source cache; it adds no root `.gitmodules` or catalog gitlink. A target build proves that target's archive and does not claim an all-platform npm release.

The product package internally declares `ctx.accountPool`, owns the CLIProxyAPI provider and the `accountPool` Remote namespace, and supplies the shared Client. The [delivery record](../../../../docs/scratch/2026-09-14-account-pool-migration.md) owns frozen source identities, retained scratch, and verification state. Existing uncommitted upstream-workspace scaffolds are preserved but excluded from this plan and all commits.

The public Typert generator discovers face-referenced packages below its own root's `packages` directory. Therefore the product workspace adds only its own Host/Client aggregates and `packages/account-pool` workspace member; the existing model center stays in place. Public `typertPlugin` package mode generates the product's `./typert` and `./remote` exports. The normal Typert loader registers Host contributions, while the product Client assembly mounts its own contribution through `ctx.remote.$mount`. The Client uses the existing public module-loader factory. Upstream packages remain exact-version peer and development dependencies; no upstream Remote aggregate or private protocol code is changed or copied.

The product build places the core binary, license, and identity manifest in its own `resources` and resolves them relative to its own installed module through `import.meta.url`. Existing Desktop package-closure, preparation, and runtime-file policies already consume product archives and resources; their implementation is outside the allowed change set. A planned product-owned local/CI scope check compares every tracked addition, modification, deletion, and rename against the verified-base allowlist, unconditionally rejects root `packages/**` and `vendor/**`, and rejects product dependency patches, upstream replacement overrides, or local/private source imports. The allowlist covers `product/**`, those four fork-owned Desktop glue/test files, and this proposal/delivery-record triplet pair. Generic app loaders, IPC, `prepare-dsh`, `prepare-package-set`, and runtime policies remain unchanged. If a required public capability is unavailable, that implementation path stops and reports the gap; the writer cannot expand the allowlist. This check is a planned acceptance requirement, not an implemented guard.

An isolated feasibility probe has verified the public inference composition described below without upstream edits. This proposed design is ready for user review; implementation and Go builds remain paused.

### Public operations

The domain brands are `AccountPoolAccountRef` for core `auth_index`, `AccountPoolAccountName` for the core filename, and `AccountPoolLoginState` for an opaque login operation. They are distinct `Branded` values. `AccountPoolLoginKind` is `anthropic | codex | antigravity | kimi | xai | glm`; `AccountPoolPhase` is `starting | ready | error`. Domain DTOs are `AccountPoolSnapshot`, `AccountPoolAccount`, `AccountPoolLoginStart`, `AccountPoolQuotaWindow`, `AccountPoolEditableFields`, `AccountPoolFieldPatch`, and `AccountPoolModel`, projected from the frozen source's corresponding desktop types. Snapshots retain quota status, observation time, last valid sample, and separate failure/stale information without raw credentials or generation endpoints.

Every asynchronous service operation accepts a final optional `AbortSignal`. The following table freezes the seventeen service operations; `Snapshot` below means `AccountPoolSnapshot`, and all asynchronous results are `Promise` values.

| Operation | Inputs before signal | Result |
| --- | --- | --- |
| `getSnapshot` | None; synchronous | `Snapshot` |
| `subscribe` | Snapshot listener; synchronous | Disposer |
| `refresh` | None | `Snapshot` |
| `setEnabled` | Account name, boolean | `Snapshot` |
| `deleteAccount` | Account name | `Snapshot` |
| `startLogin` | Login kind | `AccountPoolLoginStart` |
| `loginStatus` | Login state | `Snapshot` |
| `cancelLogin` | Login state | `Snapshot` |
| `dismissLogin` | None | `Snapshot` |
| `submitCallback` | `{ provider: AccountPoolLoginKind; redirectUrl: string }` | `Snapshot` |
| `submitGlmKey` | `{ apiKey: string; site: 'cn' \| 'international'; organization?: string; project?: string }` | `Snapshot` |
| `refreshQuota` | Account ref | `Snapshot` |
| `refreshAllQuota` | None | `Snapshot` |
| `listModels` | Account name | Readonly `AccountPoolModel[]` |
| `readFields` | Account name | `AccountPoolEditableFields` |
| `patchFields` | Account name, `AccountPoolFieldPatch` | `Snapshot` |
| `downloadAuthFile` | Account name | `{ name: string; body: string }`, Host only |

Remote exposes the management operations, replaces `subscribe` with `watch(signal?)` yielding the current snapshot and subsequent committed changes, and excludes `downloadAuthFile`. The product RPC module owns an authenticated `ctx.connection.fetch.register` handler at `/api/account-pool.export?name=...`. It enforces Config `allowCredentialExport` inside the actual handler, a safe single-segment filename, `Content-Disposition: attachment`, and `Cache-Control: no-store`. Desktop explicitly enables this user-requested credential-file export; Web composition explicitly chooses its policy. Ordinary RPC and snapshots never return its raw body. There is no generic import or raw URL/method/header proxy.

An internal React-free controller owns the watch subscription and committed snapshots, cancels and awaits watch completion during disposal, and supplies injected hooks; the store holds view state only. `AccountPoolClientActions` unwraps generated Remote results for components, which use neither `window.dshDesktop` nor management URLs. Editing uses an explicit field allowlist; proxy userinfo is redacted, and credential-bearing headers expose only presence plus preserve/replace/remove intent. Account identity and operation generation prevent an earlier read from populating another account's dialog. Save failures retain the dialog and show a localized error. Stale login states cannot finish or dismiss a later operation.

### Process and durable state

A product-owned `resolve(config)` obtains the installed resource directory from `import.meta.url` and the fixed source SHA from the product provenance/manifest. Provider Config validates private `stateRoot` and deployment choices; ordinary Desktop startup needs no new environment variable or resource-path API. Bundle defaults are `startupTimeoutMs=15000`, `restartLimit=2`, `stopGraceMs=2000`, `readinessIntervalMs=50`, `requestTimeoutMs=15000`, `maxResponseBytes=1048576`, `catalogRefreshIntervalMs=2000`, and `quotaConcurrency=4`. Credentials, ports, and certificates are private runtime state. Desktop selects `$DSH_HOME/desktop/account-pool`; an explicitly enabled Web profile chooses its own root.

An exclusive root lock rejects concurrent owners. `stateRoot/auth/` holds core-owned OAuth files; `stateRoot/config.yaml` preserves validated core account configuration, including GLM management writes. Private directories use mode 0700 and files use 0600 where supported. A stopped generation's runtime fields are replaced before startup while account fields survive. Only the terminated generation's random directory below `stateRoot/generations/` is removed; stable configuration and unrelated data remain. No default user CLIProxyAPI home is read.

The Provider owns `ctx.subprocess` launch, environment scrubbing, bounded diagnostics, termination, and `waitForExit`. The bundle explicitly composes an isolated local subprocess provider so the binary, TLS probes, and child share one local execution world; it adds no execution-world probing API. The binary manifest binds source SHA, platform, architecture, filename, and SHA-256; missing or mismatched resources fail before spawn. Startup neither searches PATH nor downloads code. A maintained X509 library generates certificates without requiring user-installed Go or openssl.

### Generation TLS and model requests

Each generation owns fresh management and inference keys, a certificate, an abort controller, and an `undici.Agent` trusting that certificate only. Every management, catalog, readiness, and inference request restricts the exact loopback origin, allowed path and method, rejects redirects, and verifies the same certificate before sending credentials. Reserving then closing a port is not ownership evidence. Response bodies are bounded while reading; malformed JSON and transport failures remain errors rather than empty results.

The product uses the published `PiAiAdapterOptions.profiles` and `ResolvedPiAiProviderProfile.piProvider` extension points. It creates a provider through public `createProvider({ api: productOwnedProviderStreams })`; its private `stream` and `streamSimple` wrappers forward the original options plus the generation fetch and cancellation signal to the corresponding public `openAICompletionsApi().stream` and `.streamSimple` methods. The original upstream adapter continues to own model conversion, request preparation, and stream conversion. No adapter option, profile-resolver export, copied implementation, or upstream code change is required. Each prepared call retains its original immutable profile and generation authority. Shutdown withdraws routes and closes admission, aborts admitted calls and awaits their settlement, terminates and awaits the child, closes the dispatcher, then removes generation files. No global TLS or fetch setting changes.

The product constructs a public resolved-profile DTO for its own route only; it does not copy the general upstream resolver. Product Config owns its explicit limits and defaults, and public retry-policy resolution remains reused. The product maintains catalog-to-model projection and supported reasoning-level mapping; unknown capabilities stay unknown, unsupported levels remain unsupported, and required SDK cost fields do not become claims about verified account pricing. A thin product adapter selects per-model reasoning defaults before request metadata is logged and delegates the complete public adapter interface. The public dependency/peer graph must close under strict compilation; the probe required the published MCP SDK `1.29.0`, which belongs to product dependency verification rather than an upstream modification.

The feasibility probe installed published dsh LLM/PiAi packages at `0.1.5-rc.2` and pi-ai `0.85.1` in an independent npm project, without repository TypeScript aliases and with `skipLibCheck: false`. TypeScript compilation and local TLS/SSE requests passed. It observed context/reasoning metadata, a prepared call surviving later profile-map removal with its original authority, and zero HTTP requests for wrong-CA or retired-generation cases. The probe uses no real provider account and establishes public-API feasibility only; it is not migrated account-pool or product acceptance evidence.

The catalog keeps the source's supported Grokshell listing metadata and sets reasoning, context, output limits, and modalities before `prepareCall` so existing Session logging records the actual request. A valid nonempty catalog registers `gestalt-account-pool`; empty or unavailable catalogs atomically withdraw it. Duplicate route ownership fails explicitly. Quota receives Host-owned xAI tier/user metadata and GLM passive signals, retains unknown/unsupported/failed/stale distinctions, and only observes: it never changes account enablement, scheduling, cooldown, or reset credits. Deletion clears quota cache by account ref.

## Alternatives considered

**Copy the Electron implementation.** Its business IPC and desktop-only controls conflict with shared Host services and leave Web without the accepted account-management experience.

**Write an ordinary custom provider into model-center settings.** A process generation changes inference credentials and lifetime. Persisting those values in user model settings would expose private runtime state and make account-pool disposal depend on another settings owner.

**Add upstream feature packages or modify the PiAi wrapper.** This violates the user's hard requirement to leave upstream packages unchanged. Product-local composition must fit the public extension points; a missing public capability is a design constraint, not permission to patch upstream code.

**Merge the source fork.** The source branch contains unrelated product, release, and workflow changes. The migration takes the accepted account-pool behavior and engine revision while retaining this repository's architecture and product defaults.

## Acceptance criteria

- The implementation diff has no changes under `packages/**` or `vendor/**`, no root dependency/compiler additions, and no upstream dependency patching or upstream source imports. Product source and artifacts resolve from the independent product workspace.
- The normal Desktop profile starts the pinned CLIProxyAPI engine, exposes the account-pool Settings section, and registers its available models through `ctx.llm`; Web can compose the same implementation explicitly.
- Account creation, OAuth initiation and cancellation, API-key account management, enablement, model exclusions, quota display, and account removal use typed Host operations with localized product feedback.
- A restart restores durable account configuration, including GLM changes, and rejects stale process generations without retaining their private credentials or owned subprocesses.
- Focused behavior tests, Loader composition, public typing, package/build checks, and recorded output cover the migrated behavior; native Desktop interaction records the real product route separately from fixtures.
- Regression cases observe wrong-pin listeners receiving no credentials, generation changes after call preparation, root-lock contention, startup disposal, throwing subscriber containment, complete process-tree teardown, bounded HTTP bodies, export-policy rejection in the download handler, and explicit credential-file download through the actual Desktop scheme.
- The UI preserves six-provider login, management/quota card flips, filtering, twenty recent-request cells, dialogs, reset timing and quota needles. Unknown empty tracks have no fabricated fill or marker; stale/error states, login dismissal, dialog identity races, and failed saves remain visible. A keyless Session recording covers model selection, tool calls/results, and reasoning without adding quota to model input or changing Session format.

## Risks

The selected engine and transport require exact source and executable identity checks. Account credentials need durable private storage while process generations need prompt revocation and quiescent teardown. Provider availability limits live inference verification; an empty-pool native run proves startup and account-management entry states without proving authenticated inference. Signed release packaging requires a separately configured release environment.
