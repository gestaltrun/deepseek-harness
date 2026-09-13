---
name: orchestrate-dsh-delivery
description: Coordinate DSH feature, fix, specification, and plugin delivery from accepted requirements through implementation, real-product acceptance, review, and merge. Use for non-trivial repository delivery; route upstream adoption and coordinated multi-repository release through dsh-upstream-integration.
---

# Orchestrate DSH delivery

ODD owns the accepted demand and its delivery state. Matt skills supply requirements, design, task decomposition, implementation, and retrospective methods; the repository's DSH skills supply architecture-specific judgment and evidence. Use [the workflow map](references/workflow.md) to choose the applicable skills, not to run every skill on every change.

## Establish scope and authority

Read the user's request, applicable repository instructions, accepted specification or issue, and [repository context](references/repository-context.md). Resolve the actual repository and base from live Git/PR state; do not copy a tracker, branch, model, deployment, or CI check name from another fork.

For upstream synchronization, community plugin adoption, a wrapped-project update, or overlap with local product capabilities, invoke [dsh-upstream-integration](../dsh-upstream-integration/SKILL.md) before freezing the affected specification. Its accepted capability decisions, defaults, candidate identities, and comparison evidence become delivery inputs. A newly discovered upstream change during implementation receives a bounded delta assessment; unrelated work continues, and a frozen candidate is not silently retargeted.

Preserve the user's existing action boundaries. A request to create local files is not a request to publish them. Carry already authorized commits, PRs, merges, and release scope forward without repeated questions. Stable package publication, deployment, signing, and formal releases require the applicable release authorization. A related Gestaltrun repository follows the demand's coordinated release set, not an independent stable release.

Complete intake when the accepted outcome, non-goals, source identities, unresolved product choices, and authorized endpoint are explicit. Small local changes can use one implementation owner and focused checks without manufacturing a specification, ticket graph, or fixed team.

## Shape the demand

Use `grilling` and `domain-modeling` for unresolved product decisions; facts obtainable from code or tools are the agent's responsibility. An explicitly requested `grill-with-docs` uses those same primitives. Reuse established terminology and Agent Notes rather than creating a parallel decision system.

Use [codebase-design](../codebase-design/SKILL.md) and its scheme reference when interfaces, ownership, lifecycle, or durable formats need design. Use [prototype](../prototype/SKILL.md) when a runnable state model or UI comparison can settle a question. A UI prototype uses existing product components, is exercised by the agent before human review, and leaves a frozen design pointer plus an experience route. Prototype evidence does not establish production readiness.

Design [plugin delivery and verification](references/plugin-delivery.md) up front when the demand introduces or changes product plugins, bundles, presets, or a wrapped external project. Performance work uses [dsh-speed-up-perf](../dsh-speed-up-perf/SKILL.md) for a measured baseline before implementation. Test resource and concurrency choices use [dsh-ci-test-reliability](../dsh-ci-test-reliability/SKILL.md).

For multi-session work, call [to-spec](../to-spec/SKILL.md) and then [to-tickets](../to-tickets/SKILL.md). Keep accepted decisions and any frozen draft readable from durable references before dispatch. Tickets are independently verifiable vertical slices with real blocking edges. An already accepted spec or ticket graph needs only the relevant delta.

## Assign owners and implement

The coordinator keeps the demand, dependency graph, evidence, and user decisions. Reuse stable module owners through implementation, CI, review, and acceptance fixes. Give concurrent writers disjoint worktrees and branches; spawning a subagent alone does not isolate files. Use collaboration/subagent tools for subtasks. Create a user-owned Codex task only when the user explicitly requests a new task.

Choose only the roles the work needs: scheme, UI, module implementation, integration/environment, Quality, and independent review. The primary author is not the independent reviewer. Select tools and models from actual availability; never hardcode a provider route or assume a model name confers computer-use capability. When independent ownership cannot be provided, report that evidence gap rather than claiming independent review.

For a coordinated feature, one integration branch and PR may close the spec and its tickets. Keep independent changes separate. Use a PR stack only when actual PR dependencies require it, following [dsh-merging-stacked-prs](../dsh-merging-stacked-prs/SKILL.md). Across repositories, use exact source/package dependencies and the delivery graph instead of a same-repository stack.

Implementation uses [implement](../implement/SKILL.md) and [tdd](../tdd/SKILL.md) at already accepted observation points. Follow scoped test selection; do not run or repeat a full suite by habit. Before each outgoing push, use [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md). Integrate only identified commits, preserving all user-owned dirty files and unrelated work.

## Validate and obtain initial acceptance

Quality verifies the combined candidate through the required deterministic checks, real composition, snapshots, and E2E. Evidence names the exact source/artifact, environment, scenario, and result; a green unit suite does not establish product acceptance. Keep local CI separate from the frozen acceptance instance.

For supported Desktop behavior, the environment owner uses [dsh-desktop-test-instance](../dsh-desktop-test-instance/SKILL.md). Web and other platforms use their real supported product paths. For an upstream comparison, preserve the explicit baseline/candidate pair and replace only the named side. No generic cleanup of goal-owned instances may destroy the other side or user-created comparison data.

The agent walks the experience route and compares affected screens with the frozen draft before asking the user to accept. Hand off the verified instance, initial screenshots, exact version and starting state, known gaps, and repeatable steps. Do not delay this first handoff for final code review or GIF recording. If the task needs no human experience decision, document why that stage is inapplicable.

## Audit the accepted candidate

After initial human acceptance, an owner independent of the affected implementation authors uses [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md) to inspect the affected implementation for unnecessary duplication, obsolete local replacements, and speculative machinery. Reuse the scheme owner only when that independence holds; otherwise assign a bounded collaboration subagent. Separate optional improvements from defects that prevent accepted behavior; the user chooses which new improvements enter the demand.

An independent reviewer applies [code-review](../code-review/SKILL.md) and [dsh-code-review](../dsh-code-review/SKILL.md) to the integrated scope. Preserve separate Standards and Spec conclusions. Reuse that reviewer for delta review and route fixes back to the original module owners.

Every delivery ends with a scoped decision/document audit, even when the result is that nothing needs changing:

- [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md): classify affected old decisions as retained, partially superseded, consolidated, rejected, or eligible for archival. New notes also trigger this check when written; never archive toward a quota.
- [dsh-doc](../dsh-doc/SKILL.md) and [dsh-prose-standard](../dsh-prose-standard/SKILL.md): verify affected README, JSDoc, prompts, diagnostics, configuration instructions, bilingual pages, and generated derivatives against the final behavior. Their writing rules also apply during implementation.
- [dsh-trim-cot-leakage](../dsh-trim-cot-leakage/SKILL.md): remove authoring-session and review residue without losing factual obligations. A local audit does not prove the entire corpus is accurate.

Routine bilingual updates use the documentation rules. Load [dsh-translate-docs](../dsh-translate-docs/SKILL.md) only when the user explicitly invokes it; ODD never starts the extended workflow automatically.

## Repair, retrospect, and land

After fixes, integrate the exact delta, rerun affected checks and independent review, and have the user reaccept affected behavior. Preserve unaffected evidence at its original identity rather than relabeling it as current.

Each involved owner uses [retro](../retro/SKILL.md) on its own session to propose improvements to navigation, tools, checks, skills, or instructions. The coordinator consolidates recommendations for the user's keep/drop decision. Accepted edits stay with their owner and receive relevant revalidation; retrospective alone never authorizes unrelated changes.

For GUI changes, [record-browser-gif](../record-browser-gif/SKILL.md) records the final accepted, reviewed, regression-passing candidate before merge. Any later change affecting the storyboard invalidates that evidence. Actual product instructions, installation and upgrade paths remain with their owners.

Recheck the live PR base/head, reviews, threads, checks, and merge state. Use the repository's actual merge mechanism only within the authorized scope. Confirm merged state before closing delivery or retiring worktrees; a queued merge is pending. Remove only exact disposable, clean, merged resources with no unique work; preserve uncertain or retained artifacts with an owner and reason.

For an approved multi-repository release, use [coordinated release](../dsh-upstream-integration/references/coordinated-release.md). Candidate CI and product-combination checks precede formal publication. Record staged/published/promoted identities and partial failures; a mainline merge is not a completed release.

Report the accepted outcome, exact branch/commit or PR, checks actually run, initial and final acceptance, review and retrospective decisions, upstream/release-set status when applicable, and cleanup or retention. Name the remaining authorized endpoint rather than implying that local implementation, merge, publication, and installed upgrade are the same result.
