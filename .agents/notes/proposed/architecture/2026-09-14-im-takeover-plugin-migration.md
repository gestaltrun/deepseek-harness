# Agent Note: Migrate IM takeover into the product workspace

Status: proposed

English | [中文](2026-09-14-im-takeover-plugin-migration.zh.md)

## Problem

The accepted IM takeover specification and prototype in the legacy `gestaltrun/deepseek-harness-gestalt` project cover authorized DingTalk employee accounts through DWS, Wangwang accounts, workspace routing, and isolated two-Session simulations. Product design remains accepted. The destination repository at `375e2838dec1ff3fba7730256b9bfda2a17c1983` has different Client composition and plugin distribution rules. Porting the legacy branches wholesale would also import unrelated application, dependency, and build changes.

The migration inputs are the preserved resume tree at `e49ef377`, Host tree at `17ce1b29` plus five modified tracked files, and UI tree at `8380c365` plus six modified tracked files. Their accepted archive is `.agents/design/im-takeover/`. Source preservation and existing tests establish recoverable inputs, not completion or acceptance on this destination. Legacy issue numbers do not identify destination issues.

## Proposal

The user accepted this product architecture direction and authorized implementation on 2026-09-14. The note remains proposed until implementation and product acceptance establish shipped behavior. [Migration delivery](../../../design/im-takeover/migration-delivery.md) preserves the accepted legacy specification, prototype, and work units. Upstream-package exceptions still require separate confirmation of their concrete no-change impact.

Keep the IM implementation inside this repository's independent `product/` workspace, following [Model Center](../../../../product/model-center/README.md). Preserve upstream-forked `packages/` implementations. Product-owned modules consume public services and slots, and may maintain a bounded source adaptation with exact provenance when public composition cannot preserve the accepted entry. Any necessary upstream-package change first requires a concrete explanation of the behavior lost without it, product-only alternatives, and the smallest proposed change, followed by user confirmation. Share one domain implementation, generated API, and UI implementation across Web and Desktop. Product requirements and prototype remain accepted; this replaces the prior separate-repository recommendation.

Propose five code packages plus one distribution bundle inside `product/`: `im-runtime`, `im-dingtalk`, `im-wangwang`, `api-im`, `ui-im`, and `im-bundle`. Package names use the established `@gestaltrun/dsh-*` namespace, with `repository.directory` pointing to each `product/<name>`. The independent workspace manifest explicitly includes these directories; build/test/typecheck/pack scripts select them and pack into `product/dist`. Internal account, route, delivery, execution, and simulation modules remain private; a conceptual layer does not require a package. These names are proposals, not existing publications.

| Proposed package | Responsibility and capability role |
|---|---|
| `product/im-runtime` | Host domain service, durable records, Session orchestration, scoped tool Consumer subpath, and local simulation Provider. Its concrete `ImTransports` Cordis registry is the Service Definition for platform registration. It never imports GUI or platform providers. |
| `product/im-dingtalk` | Provider for installed DWS public commands, ambient employee authentication, provider evidence, stream lifetime, and receipts. |
| `product/im-wangwang` | Provider for the admitted merchant directory, endpoint and credential resolution, polling, and receipts. |
| `product/api-im` | Host BFF Consumer, generated Remote entries, and framework-neutral Client objects with snapshots/subscriptions. Domain services carry no GUI-specific Remote methods. |
| `product/ui-im` | Accepted account, workspace, and conversation components, typed locale dictionaries, slots, drafts, and selection. Business records remain in Client objects. |
| `product/im-bundle` | Ordered Host and Client configuration rows and explicit dependencies; no runtime service. |

The transport registry admits provider capability descriptions and reversible registrations for account checks, conversation discovery, inbound delivery, outbound send, and receipt confirmation. Runtime consumers use normalized identities, message evidence, cancellation signals, and explicit send outcomes. Provider-specific login steps stay in providers. Real and simulation delivery share the runtime admission and outbound tools; the trusted execution binding selects the provider. Model arguments cannot choose an arbitrary real account or another simulation.

## Host and Client integration

| Accepted entry | Integration and upstream impact |
|---|---|
| IM conversation and simulation panel on the right | `sidebarRightTabs` plus `sidebar.right.pane.tab`; product UI registration only, no sidebar replacement or upstream change. |
| Global IM Accounts | Existing `settings.section`; product UI registration only. |
| Workspace settings entry and dialog | Separate Workspace-row menu integration choice; whole-region product adaptation concerns the left Workspace browser only, never the IM right panel. |

The current [Client rules](../../../../packages/client/AGENTS.md) require object-layer business data, props-only components, no runtime imports between feature plugins, separate Host/Client compilation faces, and slots registered through `ctx.slots.inject`. Follow the [Workspace Controller](../../../../packages/api/workspace-controller/README.md) pattern for BFF serialization, stable errors, a full baseline followed by ordered updates, and a replacement baseline after reconnect. `follow()` owns disposal and closes with the connection generation. A late unary reply must not overwrite newer stream state.

Existing `settings.section`, `sidebarRightTabs`, and `sidebar.right.pane.tab` support product-owned global and conversation entries. Better Sidebar at the destination pin `e656717672d83f9c21879d4ba8439799d9acf9ba` uses the same native rightbar facilities. The workspace row menu has no public action slot, but `sidebar.workspaces` is a public single slot that supports replacement. Recommend a product-owned adaptation of that whole Workspace browser region to retain the exact clicked Workspace id and accepted settings entry. Keep upstream source unchanged, record the adapted source and license in `UPSTREAM.json`, and preserve search, drag/reorder, rename/delete, Session rows, navigation, and directory picking. This is a larger product maintenance responsibility; a global Settings workspace selector would change the accepted experience and is not a substitute.

Product integration changes `product/package.json`, its workspace/lock/build declarations, package manifests and bundle patches, and Desktop's product bundle list at `apps/desktop/src/product-profile.ts`. These are product delivery changes, separate from upstream business-package edits. Web receives an explicit product bundle/profile overlay rather than an automatic edit to upstream `base` or `web-app`. A clean built-plugin smoke must prove external Typert registration and browser module discovery before proposing any loader change. No IM tables, credentials, provider code, or feature branches belong in the Electron shell or upstream API, workspace, and agent-loop packages.

### Upstream exceptions requiring explicit review

| Possible upstream change | Impact if unchanged | Product-only path and decision |
|---|---|---|
| Workspace row action slot in `ui-workspace` | No required feature is lost if product owns the entire browser adaptation, but its upstream sync and regression scope is larger. | Use the product adaptation by default. A tiny typed row-action slot could reduce that cost; it is an optional exception, not an unavoidable requirement, and requires user confirmation. |
| Loader/Typert/public export | No demonstrated gap yet; failure would block loading the packed product Host/API/Client. | First prove ordinary published peers, generated artifacts and bundle discovery. Only a reproduced gap may justify a concrete export change for review. |
| `base` / `web-app` defaults | Stock upstream profiles omit product IM entries. | Deliver an explicit Web product overlay and Desktop product list; no default upstream-bundle edit is proposed. |

Do not implement any `packages/` exception before presenting this no-change impact and obtaining confirmation for the exact change. Product source adaptation must not use DOM injection, unpublished imports, or an untracked private implementation dependency.

## Configuration and routing

Validated Cordis Config owns deployment choices such as executable, endpoint, poll cadence, retry bounds, and admitted merchant directory. [StorageDomain](../../../../packages/storage/storage-domain/README.md) owns accounts, routes, workspace simulation targets, operation results, and delivery progress. UI settings placement does not make these records ordinary preferences. [Credentials](../../../../packages/credentials/credentials/README.md) owns secret records/references. A write-only account setup action persists credentials, verifies provider identity, then publishes safe account metadata. Failed or partial setup remains explicit; a form never fabricates `connected` or a credential reference. DWS ambient authentication and configured Wangwang merchant identity remain distinct.

A route key contains platform, account, conversation kind, and all/specific target. Encode the complete tuple without delimiter collisions. Specific rules win even when disabled; all rules dynamically cover future conversations. The runtime resolves one authoritative route, then pins its Workspace id, rule identity, mutation token, and target to each admitted execution. Rebinding affects future admission. Running tasks retain their original workspace and ordinary permissions; disabling suppresses pending AI sends without replaying them on re-enable. Account pause leaves manual sends and simulation available.

Use one account routing aggregate so uniqueness checks and conditional replacement occur in the same serialized record update. An explicit rebind requires the observed opaque mutation token and mints a fresh token on every mutation, including deletion and recreation. Ordinary saves cannot transfer ownership. For multi-target edits, retain per-target request ids and results: applied, conflict, rejected, or outcome unknown. Each target operation identity and its queryable result commit in the same atomic account-aggregate update as the route mutation; do not write a separate result table afterward. Confirm all affected targets, preserve unfinished drafts, and query unknown operation results before retrying. This proposal chooses visible partial results over a cross-target all-or-nothing promise; StorageDomain supplies no cross-table transaction.

## Delivery and Session ownership

The runtime owns the production path from durable provider receipt to route resolution, trigger evaluation, Agent creation/resume, input admission, and outbound delivery. It schedules fixed-interval checks even when no later inbound event arrives. Mention triggers use provider evidence rather than body matches such as `@bot`. OR triggers submit one identified batch, count unsubmitted messages, and preserve the accepted nearest safe step boundary without cancelling active model or tool work.

Business records own inbound/outbound evidence, cursors, and query-only imported history. Model-visible source, sender classification, trigger reason, and execution binding must be reconstructable from Session events. Extend `MessageSourceMap` through the plugin and use ordinary identified `user/message` plus durable inbox events where they carry all facts; additional facts need typed Session events, never an invisible live prompt side channel. Unknown self-message evidence stays unknown. IM text never creates an owner approval.

Session logs and domain records cannot commit atomically together. Persist the delivery batch intent with stable message identity, enqueue through the ordinary Agent, await Session persistence, then mark the business submission. Recovery reconciles that identity against the persisted inbox and accepted Session messages before enqueueing again. Rejected or cancelled input has a separate disposition; an enqueued message is not proof the model read it. One conversation controller serializes admission and owns shutdown. Outbound sends first persist intent; ambiguous external outcomes remain `result_unknown` and are never blindly retried.

## Simulation lifecycle

Creation validates the actual simulated-user Session and Workspace membership, reserves the current active instance for that simulated-user Session, while other Sessions may independently test the same target, creates the tested Agent through `ctx.agents.create`, mounts the target preset and workspace policy, attaches and flushes its Session, then publishes the running pair. The instance owns the tested Agent handle and instance-attributed derived work. A recoverable creation record distinguishes a partial pair from a running instance. Failure settles or disposes owned work; it never invents Session ids or deletes the user Session.

Freeze target, tested workspace, identity roster, and rule-derived trigger configuration at creation. Clearing or changing simulation settings affects new instances only. Scoped tools appear for eligible simulated-user Agents and remain available to operate their existing instance. The tested Agent uses the same send/history tools as real handling, with a trusted instance binding. Every simulated output returns only to that instance and can wake the simulated-user side through the same logged input pipeline. Imported JSONL remains history and does not wake either side.

One instance lifecycle controller persists `stopping` before closing new delivery, cancels only its attributed pair activity and derived work, and publishes `stopped` after quiescence. GUI callers await terminal settlement. An actual scoped stop-tool caller receives `stopping` without awaiting its own turn; terminal settlement follows its completion. Derive caller identity from the trusted Agent/initiator context, never a Remote field. Deduplicate the stop operation while keeping each caller's wait policy separate, so GUI-first/tool-second and tool-first/GUI-second both converge. Preserve the simulated-user Session and unrelated activity.

Reload restores records and validates real Session links. Ordinary Session resume policy decides whether Agents run; opening the IM UI does not auto-resume them. Persisted `stopping` is reconciled against actual remaining work, and explicit `stopped` never resumes. Released Session generations remain immutable under the [existing migration policy](../../../../docs/session-format-status.md). Legacy experimental domain data requires an explicit import decision after its actual schema is inventoried; do not silently overwrite it.

## Distribution and reuse

Keep package publication, profile activation, and live account takeover separate. Recommend Desktop carry the packed product IM bundle through its existing product list, and Web use an explicit product profile/overlay so the accepted entries remain visible in both delivered product paths. Do not silently change upstream base/web-app defaults. Newly connected accounts have no enabled routes until configured. Provider activation requires credentials and merchant-directory validation. Headless product composition selects Host rows and scoped tools without UI packages; presets do not duplicate shared account services.

Build and pack in the independent `product/` workspace. Record source repository, exact legacy commits, preserved dirty patch identities, licenses, and any maintained source adaptation in package-owned `UPSTREAM.json`, following Model Center. Packed runtime code, generated Typert artifacts, Client assets, and declarations use public Host exports and matching peers. CLI/Web install the product bundle through supported `dsh plugin` and profile composition; Desktop consumes `product/dist` through its shell-owned transaction and reserved profile. The [Desktop plugin rules](../../implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md) govern shared module identity. Verify a clean installation with the source directory unavailable.

Reuse accepted layouts, typed locales, sender/result vocabulary, adapter parsing fixtures, and useful routing/delivery tests after their interfaces are aligned. Rework the production admission coordinator, account setup BFF, conditional multi-target saves, Client object subscriptions, and stop operation ownership. Do not import the legacy root lockfile, base/web configuration wholesale, private sidebar transport, fixture-only controllers, fabricated connection state, or old tracker workflow.

## Alternatives considered

**Merge legacy branches into upstream packages or create a separate plugin repository.** Both lose the requested product ownership: the first mixes fork-specific behavior into upstream code, and the second bypasses this repository's established product workspace. Port the preserved feature changes selectively into `product/`, retain source identities, and use the existing product build/distribution path.

**A package for every conceptual layer.** Account, routing, trigger, outbox, and simulation modules currently co-own admission and recovery rules. Private modules retain locality; separate platform providers, GUI API, and UI have real independent consumers and compilation needs.

**Replace DWS with a DingTalk bot SDK.** The accepted feature requires the authorized employee identity. An application-event SDK does not establish that identity or its DWS login semantics. Keep the accepted CLI adapter; reference SDK callback lifetime ideas only after evidence review.

**Add a database/queue service to obtain distributed transactions.** A second persistence authority does not make platform receipts and Session logs one transaction. Reuse existing domain writes, stable request identities, and explicit reconciliation. Do not introduce Redis or a second Session store for this delivery.

## Acceptance criteria

- Domain and controlled concurrency tests prove full route tuple isolation, disabled-specific precedence, dynamic all matching, fresh-token CAS including ABA, multi-target partial/unknown outcomes, pinned running work, deduplicated delivery, and all stop caller orderings. Crash probes cover each domain/Session commit gap and partial pair creation.
- Real Loader/profile composition proves adapter receipt automatically reaches the ordinary Agent and simulation returns to the correct live pair. Real Session JSONL plus a persistent domain backend must survive a fresh process; a Memory domain and `flush=true` stub are insufficient. Bad configuration and conflicting registrations fail visibly.
- Recorded-session snapshots cover source/authority labels, sender classification, steering, shared send/history tools, terminal simulation state, and transcript presentation. Extend both SDK expected projections when Session events or lifecycle change. Package assembled tests are separate evidence.
- Packed installation verifies exact versions, shared Host/Client identity, generated RPC, assets, restart, disabled plugin behavior, and the chosen Web/Desktop profile composition. GUI acceptance walks the accepted 79-item inventory with real two-Session navigation, subscription reconnect, multi-target conflict handling, and account setup. Real provider/model calls and external sends require the designated authorized test scope.

## Risks

The preserved code contains unfinished production wiring. Static inspection finds no production caller or event subscriber for `admitInbound`; provider and simulation methods store messages without calling it. The UI account mapping discards form credentials and declares `connected`; its save path still sends one route request. These are scoped source observations, not a product execution failure report. Existing historical tests remain evidence for exactly the layers they exercised.

The confirmed placement is `product/`, with upstream packages preserved by default. The accepted implementation direction covers runtime/Provider/API/UI roles, product-owned workspace settings adaptation, aggregate CAS and partial-result semantics, and Desktop/Web product composition. Product-only entry fidelity, external Typert compatibility, legacy data import scope, live provider receipts, and derived-work attribution remain evidence obligations. Any upstream exception requires the user to see the no-change impact and product-only alternatives before approving that exact modification; this proposal authorizes no such exception.

This proposal retains the active capability-seam, Client composition, profile bundle, Desktop plugin, and Session migration decisions; none is superseded or archived. The note remains proposed after architecture approval until implementation and acceptance establish shipped behavior.
