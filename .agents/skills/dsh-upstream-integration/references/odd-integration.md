# ODD integration

[`orchestrate-dsh-delivery`](../../orchestrate-dsh-delivery/SKILL.md) owns demand, stable writers, integration, acceptance, review, and delivery. `dsh-upstream-integration` owns the bounded comparison and adoption decision for affected upstream components. ODD invokes it conditionally and consumes its result instead of copying the assessment workflow.

## Invocation points

| ODD point | Trigger | Required return |
|---|---|---|
| Intake, before specification and ticket scope freeze | Official DSH synchronization, community addition or update, wrapped-project update, or upstream/local capability overlap | Exact candidate and provenance gaps; capability recommendations; distribution, default activation, and default exposure choices; comparison need; unresolved product decisions |
| Implementation or integration | A discovered upstream revision changes an accepted interface, dependency, default, artifact source, or product assumption | Bounded delta assessment, affected ledger rows and owners, and the next check or decision; unaffected work continues |
| Delivery close | Accepted upstream adoption replaces local code or changes product composition | Retirement or retention result, current Agent Notes and documentation, exact final artifacts, compatibility and upgrade evidence, and release-set state |

Do not invoke this skill for every ticket, ordinary same-repository conflict, or unrelated upstream release. A newer release discovered during a frozen delivery remains a future candidate unless it blocks an accepted requirement or the user chooses to retarget.

## Ownership and records

Reuse ODD's scheme owner for overlap analysis, module owners for wrappers and plugin adaptation, Quality for evidence, Delivery for integration, and its acceptance-environment owner for Desktop comparison. Add an owner only for an independent delivery unit, required independent judgment, or a distinct mutable repository. The upstream assessment does not independently publish tickets, replace the specification, merge, or release.

Store the return in the existing specification or delivery ledger. Include affected repositories and exact revisions, package and binary identities, composition references, capability and default-policy decisions, comparison evidence, verification gaps, affected tickets and owners, and the next action. When a mainline demand affects several Gestaltrun repositories, also identify the one coordinated release set and its release-manifest owner; repositories outside that demand remain outside the set.

An accepted behavior already covered by the specification updates only the affected rows. Otherwise route the accepted product decision through the existing specification and ticket workflow. General delivery authority does not settle an unresolved replacement or default-policy choice, while an explicit choice for the exact candidate does not require another confirmation.

## Desktop handoff

Route a change on an affected supported native Desktop route, or an explicit Electron comparison request, through [Desktop comparison](desktop-comparison.md) and [`dsh-desktop-test-instance`](../../dsh-desktop-test-instance/SKILL.md). Web-only, Mobile-only, and backend-only changes use their real supported routes. If an explicitly requested Electron route is unavailable, report that gap instead of silently substituting another mode. The Desktop comparison uses two named records under one owner; replacement and cleanup name one side or the pair explicitly. Ordinary ODD fidelity and acceptance retain the single-instance mode.

## Completion

An assessment is complete when ODD has durable inputs and clear owners; implementation and release can remain pending. A deferred result is complete only with its reason and reconsideration condition. Delivery closes after its own tests, review, retirement and documentation audit, user decisions, and cleanup obligations pass. Installing this skill or its ODD pointer does not configure an upstream monitor or authorize a release.
