# Agent Note: Plugin-owned CLIProxyAPI account pool

Status: proposed

English | [中文](2026-09-14-plugin-account-pool.zh.md)

## Problem

Desktop users need to manage provider accounts, inspect quota, and use pooled models from the normal Settings and model-selection flows. Electron-owned account logic would give Web a different implementation and put business credentials in shell IPC. The existing [capability architecture](../../../../docs/architecture.md) requires reversible plugin registrations and a complete Service Definition, Service Provider, and Consumer composition.

## Proposal

Compose five packages: a provider-neutral account-pool service with branded identifiers, a CLIProxyAPI provider that owns its Go process and private management operations, a read-only quota library, a narrow Typert account-pool API, and a shared account-pool Settings client. The CLIProxyAPI provider registers the stable `gestalt-account-pool` LLM provider through `ctx.llm`. Each live adapter holds its process generation's inference credential privately.

Desktop includes the composition by default. Web can select the same bundle explicitly. Account-pool UI owns a separate Settings section and contributes read-only live route information to the existing Models footer. The footer adds no navigation callback: users enter the account pool through the existing Settings navigation. The account pool does not change the model center or Settings navigation APIs, write the `llm-pi-ai` settings namespace, restore the removed desktop client package, or add account-management Electron IPC.

Persistent account configuration and credential storage must survive a stopped generation. In particular, GLM account changes must be restored when the provider starts again; generation cleanup removes temporary process files, not committed account configuration. The renderer receives only account summaries and typed operations, never management credentials, inference keys, or general management URLs.

### Package ownership

The behavior packages are `packages/llm/account-pool`, `packages/llm/account-pool-cliproxy`, `packages/llm/cliproxy-quota`, `packages/api/account-pool`, and `packages/client/ui-account-pool`. Their names are respectively `@deepseek-ai/dsh-account-pool`, `@deepseek-ai/dsh-account-pool-cliproxy`, `@deepseek-ai/dsh-cliproxy-quota`, `@deepseek-ai/dsh-api-account-pool`, and `@deepseek-ai/dsh-client-ui-account-pool`. A sixth package, `packages/bundle/account-pool` named `@deepseek-ai/dsh-account-pool-bundle`, only mounts the Provider, API, and UI. The abstract service and library are dependencies, not mounted plugins.

`AccountPool extends Service` is the default export declaring `ctx.accountPool`. `CLIProxyAccountPool extends AccountPool` is the provider's default export. `AccountPoolController extends TypertRemoteService` exposes the `accountPool` namespace. Domain exports have no Client, Electron, Go, or HTTP dependency. The [delivery record](../../../../docs/scratch/2026-09-14-account-pool-migration.md) owns frozen source identities and verification state.

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

Remote exposes the management operations, replaces `subscribe` with `watch(signal?)` yielding the current snapshot and subsequent committed changes, and excludes `downloadAuthFile`. The API owns an authenticated `ctx.connection.fetch.register` handler at `/api/account-pool.export?name=...`. It enforces Config `allowCredentialExport` inside the actual handler, a safe single-segment filename, `Content-Disposition: attachment`, and `Cache-Control: no-store`. Desktop explicitly enables this user-requested credential-file export; Web composition explicitly chooses its policy. Ordinary RPC and snapshots never return its raw body. There is no generic import or raw URL/method/header proxy.

An internal React-free controller owns the watch subscription and committed snapshots, cancels and awaits watch completion during disposal, and supplies injected hooks; the store holds view state only. `AccountPoolClientActions` unwraps generated Remote results for components, which use neither `window.dshDesktop` nor management URLs. Editing uses an explicit field allowlist; proxy userinfo is redacted, and credential-bearing headers expose only presence plus preserve/replace/remove intent. Account identity and operation generation prevent an earlier read from populating another account's dialog. Save failures retain the dialog and show a localized error. Stale login states cannot finish or dismiss a later operation.

### Process and durable state

Provider Config validates absolute `resourceDirectory` and `stateRoot`, `expectedSourceSHA`, and deployment choices. Bundle defaults are `startupTimeoutMs=15000`, `restartLimit=2`, `stopGraceMs=2000`, `readinessIntervalMs=50`, `requestTimeoutMs=15000`, `maxResponseBytes=1048576`, `catalogRefreshIntervalMs=2000`, and `quotaConcurrency=4`. Credentials, ports, and certificates are private runtime state. Desktop selects `$DSH_HOME/desktop/account-pool`; an explicitly enabled Web profile chooses its own root.

An exclusive root lock rejects concurrent owners. `stateRoot/auth/` holds core-owned OAuth files; `stateRoot/config.yaml` preserves validated core account configuration, including GLM management writes. Private directories use mode 0700 and files use 0600 where supported. A stopped generation's runtime fields are replaced before startup while account fields survive. Only the terminated generation's random directory below `stateRoot/generations/` is removed; stable configuration and unrelated data remain. No default user CLIProxyAPI home is read.

The Provider owns `ctx.subprocess` launch, environment scrubbing, bounded diagnostics, termination, and `waitForExit`. The bundle explicitly composes an isolated local subprocess provider so the binary, TLS probes, and child share one local execution world; it adds no execution-world probing API. The binary manifest binds source SHA, platform, architecture, filename, and SHA-256; missing or mismatched resources fail before spawn. Startup neither searches PATH nor downloads code. A maintained X509 library generates certificates without requiring user-installed Go or openssl.

### Generation TLS and model requests

Each generation owns fresh management and inference keys, a certificate, an abort controller, and an `undici.Agent` trusting that certificate only. Every management, catalog, readiness, and inference request restricts the exact loopback origin, allowed path and method, rejects redirects, and verifies the same certificate before sending credentials. Reserving then closing a port is not ownership evidence. Response bodies are bounded while reading; malformed JSON and transport failures remain errors rather than empty results.

The existing `PiAiAdapter` gains only an optional `fetch` option forwarded to `streamSimple`, and its package publicly exports the existing profile resolver as `resolvePiAiProviderProfiles`. The pinned pi-ai artifact supports `ProviderRequestOptions.fetch` for HTTP; this does not establish WebSocket support. Each account-pool generation uses its own immutable profile map, API-key resolver, custom fetch, and OpenAI completions/SSE adapter. Prepared calls retain their original generation authority. Shutdown withdraws routes and closes admission, aborts admitted calls and awaits their settlement, terminates and awaits the child, closes the dispatcher, then removes generation files. No global TLS or fetch setting changes.

The catalog keeps the source's supported Grokshell listing metadata and sets reasoning, context, output limits, and modalities before `prepareCall` so existing Session logging records the actual request. A valid nonempty catalog registers `gestalt-account-pool`; empty or unavailable catalogs atomically withdraw it. Duplicate route ownership fails explicitly. Quota receives Host-owned xAI tier/user metadata and GLM passive signals, retains unknown/unsupported/failed/stale distinctions, and only observes: it never changes account enablement, scheduling, cooldown, or reset credits. Deletion clears quota cache by account ref.

## Alternatives considered

**Copy the Electron implementation.** Its business IPC and desktop-only controls conflict with shared Host services and leave Web without the accepted account-management experience.

**Write an ordinary custom provider into model-center settings.** A process generation changes inference credentials and lifetime. Persisting those values in user model settings would expose private runtime state and make account-pool disposal depend on another settings owner.

**Merge the source fork.** The source branch contains unrelated product, release, and workflow changes. The migration takes the accepted account-pool behavior and engine revision while retaining this repository's architecture and product defaults.

## Acceptance criteria

- The normal Desktop profile starts the pinned CLIProxyAPI engine, exposes the account-pool Settings section, and registers its available models through `ctx.llm`; Web can compose the same implementation explicitly.
- Account creation, OAuth initiation and cancellation, API-key account management, enablement, model exclusions, quota display, and account removal use typed Host operations with localized product feedback.
- A restart restores durable account configuration, including GLM changes, and rejects stale process generations without retaining their private credentials or owned subprocesses.
- Focused behavior tests, Loader composition, public typing, package/build checks, and recorded output cover the migrated behavior; native Desktop interaction records the real product route separately from fixtures.
- Regression cases observe wrong-pin listeners receiving no credentials, generation changes after call preparation, root-lock contention, startup disposal, throwing subscriber containment, complete process-tree teardown, bounded HTTP bodies, export-policy rejection in the download handler, and explicit credential-file download through the actual Desktop scheme.
- The UI preserves six-provider login, management/quota card flips, filtering, twenty recent-request cells, dialogs, reset timing and quota needles. Unknown empty tracks have no fabricated fill or marker; stale/error states, login dismissal, dialog identity races, and failed saves remain visible. A keyless Session recording covers model selection, tool calls/results, and reasoning without adding quota to model input or changing Session format.

## Risks

The selected engine and transport require exact source and executable identity checks. Account credentials need durable private storage while process generations need prompt revocation and quiescent teardown. Provider availability limits live inference verification; an empty-pool native run proves startup and account-management entry states without proving authenticated inference. Signed release packaging requires a separately configured release environment.
