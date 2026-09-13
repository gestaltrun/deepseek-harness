---
name: dsh-upstream-integration
description: Evaluate official DSH, community plugin, and wrapped external-fork updates before changing an adopted revision, local implementation, or default plugin policy. Use for upstream synchronization and capability overlap; ordinary same-repository merge conflicts stay with the merge workflow.
---

# DSH upstream integration

Compare the adopted product combination with an exact upstream candidate, decide each affected capability separately, and return accepted work to the existing delivery owner. Connect source revisions to built artifacts, installed packages, composition, and observed runtime behavior. Discovery does not authorize adoption or release.

Use this workflow for official DSH synchronization, a community plugin addition or update, an update to an external project maintained as a fork and wrapped as a plugin, or an upstream capability that overlaps a fork modification or Gestaltrun-owned plugin. When [`orchestrate-dsh-delivery`](../orchestrate-dsh-delivery/SKILL.md) owns the demand, read [the ODD integration reference](references/odd-integration.md) and keep its stable owners, specification, and delivery ledger. Do not start a competing delivery.

## Pin the compared combinations

Discover the adopted combination from verified remotes, submodule pointers, package manifests, lockfiles, profiles, bundle configuration, release records, existing decisions, and the running product when relevant. Record the source repository, adopted and target commits, retained fork commit or patch set, consuming plugin or wrapper, package version, artifact digest, installation location, runtime resolution, and affected product composition. Resolve tags and branches to commits. A moving branch creates a separate candidate; it does not rename saved evidence.

A submodule pins source only. Trace each side through source commit, build input, package or binary, installation, Loader/profile selection, and the code actually loaded at runtime. Keep fixtures, source runs, CI artifacts, packaged candidates, and released products visibly distinct. Missing access, history, artifact identity, or runtime provenance is a gap rather than evidence that nothing changed.

## Compare capabilities

Read the release notes and changed source, interfaces, tests, configuration, dependencies, and package metadata. For a related fork, verify the common ancestor and separate upstream work from the retained fork patch set. For unrelated repositories, compare interfaces and behavior without describing the change as a Git merge.

Account for supported workflows, lifecycle and failure behavior, persistence or migration, accessibility and localization where affected, and material performance. A shared feature name does not establish equivalence. Record one row per affected capability:

| Capability | Upstream change | Current fork or plugin behavior | Gap | Recommendation | Migration or adaptation | Evidence |
|---|---|---|---|---|---|---|

Choose one result per capability:

- **Adopt upstream and retire local code:** prove accepted behavior is covered and identify data, configuration, migration, and retained-extension obligations before removal.
- **Combine capabilities:** name whether supported composition, a public-service adapter, or an intentional fork patch supplies each part; keep product behavior with its owner.
- **Retain the local implementation:** name the unmet requirement and the evidence or upstream change that would trigger reconsideration.
- **Defer or decline:** record the missing evidence, compatibility failure, or insufficient benefit while keeping the adopted revision fixed.

Use [`dsh-find-simplifications`](../dsh-find-simplifications/SKILL.md) for the net-removal decision and applicable Agent Notes for constraints. Prefer supported services, events, and slots. Record copied upstream implementation, private-layout dependencies, or unavoidable Host changes as maintained liabilities rather than hiding them behind plugin packaging.

For a community addition or aggregate-package update, decide separately whether the package is distributed, activated in the default profile, and exposed as a tool or capability in default Agent presets. Inspect newly added transitive plugins and activation changes; a version bump must not silently decide any default.

For an external fork wrapped as a plugin, assess the upstream engine revision, retained fork patch set, wrapper interface, shipped binaries, distribution obligations, and product composition separately. Upstream engine CI does not prove the wrapper or product candidate.

## Make the decision reviewable

When the affected product has a supported native Desktop route and the decision changes its visible behavior, or the user explicitly requests an Electron comparison, read [Desktop comparison](references/desktop-comparison.md). Use two genuinely isolated Electron instances with the same scenario, one frozen baseline and one candidate. Web-only, Mobile-only, and backend-only changes use their real supported routes and artifact evidence. If an explicitly requested Electron route is unavailable, report that capability gap instead of silently substituting another mode; two windows alone cannot prove backend behavior.

Present the recommendation, gained and lost behavior, compatibility and migration work, three default-policy decisions, evidence gaps, and candidate identity before requesting an unresolved product choice. Preserve a choice already made for the exact candidate and evidence. Reopen only the affected choice when new evidence changes it.

Record accepted, retained, declined, and deferred results at capability level. A pending human choice is not adoption. A deferred result names a reconsideration condition so the same revision is not repeatedly proposed without new evidence.

## Integrate and release the accepted combination

Return accepted commits, capability decisions, default policies, affected owners, tickets, and required checks to the existing delivery. Related repositories retain independent histories. Use exact package or artifact versions in the delivery graph rather than forcing cross-repository dependencies into a same-repository PR stack.

Select checks from the combined impact: plugin behavior and cleanup, real Loader/profile composition, built-package installation and runtime source, supported Web/Desktop routes, required model/session snapshots, and old-profile or released-data upgrade behavior. Reuse upstream evidence only when its revision, inputs, and asserted behavior match. Isolate a changed upstream when several revisions move together, then validate the selected combined candidate; do not build an exhaustive version matrix.

When one Gestaltrun mainline demand affects multiple repositories, read [Coordinated release](references/coordinated-release.md). Those affected repositories form one demand release set. Candidate construction and CI may proceed in each repository, while stable publication waits for the exact compatible set, final composition and upgrade evidence, and the existing release authorization.

At delivery close, inspect affected local implementations for obsolete duplication, classify superseded Agent Notes through [`dsh-archive-agent-notes`](../dsh-archive-agent-notes/SKILL.md), and verify README, JSDoc, configuration, bilingual, and generated documentation against the accepted combination. Use the existing DSH review, prose, archive, and pre-push workflows instead of duplicating their rules.

## Return the outcome

Report the exact baseline and target, source-to-runtime provenance, meaningful changes, per-capability recommendations and decisions, distribution/default-activation/default-exposure policies, comparison pair and evidence, release-set state when applicable, checks actually run, unresolved gaps, and the next owner or action. Distinguish an assessed candidate, an accepted plan, an integrated commit, a CI-verified release set, and a released product.
