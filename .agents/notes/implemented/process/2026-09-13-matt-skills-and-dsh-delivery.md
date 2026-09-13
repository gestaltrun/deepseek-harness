# Agent Note: Compose Matt skills with DSH delivery

Status: implemented

English | [中文](2026-09-13-matt-skills-and-dsh-delivery.zh.md)

## Problem

Generic engineering skills can select a different tracker, test policy, agent lifecycle, or document owner from the repository using them. An upstream refresh can also remove local acceptance requirements. Plugin delivery across repositories requires source and artifact evidence beyond one repository’s CI.

## Decision

The repository includes all 37 Matt skills from the selected upstream revision. [SOURCES.json](../../../skills/SOURCES.json) records upstream repositories, paths, exact revisions, licenses, and local changes; every imported third-party skill carries its license. Two referenced presentation helpers retain their separately recorded provenance.

[ODD](../../../skills/orchestrate-dsh-delivery/SKILL.md) owns coordinated delivery, and its [workflow map](../../../skills/orchestrate-dsh-delivery/references/workflow.md) assigns Matt methods and every official DSH skill. Current DSH rules remain authoritative. `implement`, `to-spec`, `to-tickets`, and `retro` deliberately allow model invocation for ODD; both metadata formats agree. Other explicit-only entries retain that restriction, including extended translation.

Delivery proceeds through accepted demand and scheme, optional prototype, specification/tickets when needed, and stable isolated implementation owners. During combination verification, [ticket GIF evidence](../../../skills/orchestrate-dsh-delivery/references/ticket-evidence.md) supports the main session’s criterion-level functional review and the original UI design session’s fidelity review before initial human acceptance. Independent simplification and Standards/Spec review follow; affected repairs repeat the relevant recordings and reviews before reacceptance. Retrospective decisions, exact-head final GUI evidence, and the authorized merge/release endpoint complete delivery. Writing and new-note rules apply throughout; affected documentation, decisions, and redundant implementation receive a closing scoped audit.

Technical scheme design uses `research` to compare referenceable open-source implementations and maintained dependencies with primary-source evidence, integration costs, and distribution obligations. Confirmed PR/master conflicts and conflicts from a user-requested master merge use `resolving-merge-conflicts`, retaining integration/module owners and returning exact commits plus affected verification to ODD.

[Upstream integration](../../../skills/dsh-upstream-integration/SKILL.md) records capability-level adopt/combine/retain/defer choices and independent distribution, activation, and tool-exposure decisions. [Desktop comparison](../../../skills/dsh-desktop-test-instance/SKILL.md) preserves an isolated baseline and candidate; cleanup retains user-created or uncertain data with an owner and reason. Related Gestaltrun repositories bind exact candidates and combined CI in one demand release set before stable publication. Installing these instructions does not configure monitoring, registry permissions, or cross-repository CI.

## Alternatives considered

**Copy the old fork’s entire workflow.** Its tracker, launch scripts, model routes, and CI controls do not describe this checkout. Portable context and plugin references resolve the current owners.

**Replace local skills with unmodified upstream files.** This restores full-suite defaults, repeated test decisions, and competing delivery ownership. Narrow recorded adaptations preserve accepted project behavior.

**Invoke every skill in every stage.** Skills have different scopes and invocation rules. Conditional routing keeps specialized work and explicit-only workflows from becoming unrelated prerequisites.

## Consequences

The project maintains its local adaptations with reproducible upstream provenance and one delivery owner. Links, invocation metadata, documentation checks, and independent scenario review validate these instructions; actual Electron behavior, upgrades, CI enforcement, and release require separate execution evidence.
