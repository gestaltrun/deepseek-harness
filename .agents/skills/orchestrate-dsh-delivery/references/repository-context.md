# Repository context for delivery skills

Read this reference when a Matt workflow needs the issue tracker, domain documents, delegation rules, or retrospective owner. These policies belong to the current checkout; identities and commands from an imported fork are not configuration for this repository.

## Issue tracker

Use an explicitly identified issue/PR repository when the user supplied one. Otherwise inspect the current Git remote, repository instructions, and live metadata before selecting a tracker. An upstream repository is not automatically the product fork's tracker. If that evidence leaves a material ambiguity, ask once before publishing; local drafting and investigation can continue.

Read issue bodies, comments, acceptance criteria, current PRs, labels, and dependency relationships. Resolve ambiguous GitHub issue/PR numbers rather than assuming their type. Reuse the repository's labels and native relationships; do not copy another fork's Project ids, tokens, readiness labels, merge-queue check names, or helper commands. Use existing repository wrappers only after verifying they exist and apply. Otherwise use supported tracker tools within the task's authorization, with multiline bodies passed as structured fields or body files.

`to-spec` and `to-tickets` publish only within the authorized tracker scope. Publish blockers before dependents and preserve accepted criteria. Already structured implementation tickets need no second triage pass. External messages to other people require explicit authorization.

## Domain documents

Start from [architecture](../../../../docs/architecture.md), the [glossary](../../../../docs/glossary.md), and the owning package/subsystem documentation. Use a `CONTEXT.md` or `CONTEXT-MAP.md` if the repository actually has one; do not manufacture a parallel glossary merely because a generic skill mentions that filename.

[Agent Notes](../../../notes/README.md) own durable design decisions. Apply their scope, lifecycle, and bilingual rules rather than creating a second `docs/adr/` tree. Proposed scheme records describe alternatives and observable acceptance; implemented records state shipped behavior. The [documentation rules](../../../../docs/AGENTS.md) govern placement and routine translation.

## Delegation and context reuse

Use the available collaboration/subagent mechanism for bounded independent work. Parallel writers require explicit disjoint filesystem ownership; a new agent or forked conversation does not itself create a worktree. Reuse the module owner, reviewer, and environment owner through coherent fixes. Start a replacement only for unavailable capability, required independence, or an owner that cannot continue, and record the handoff.

Use actual provider/tool availability rather than imported model-routing tables. A user-owned task is created only when the user explicitly requests it. Keep live executor identities in the current delivery state, wait for completion, and do not infer success from dispatch. The coordinator preserves completed evidence and all outstanding user requirements across context compaction or handoff.

## Retrospectives

An owner reviews only its own session and reports candidate environment improvements. The user decides which to keep; implementation follows the normal ownership and verification flow. Record accepted durable lessons in the repository's existing owner or a gitignored local lesson record when appropriate. Do not read other sessions' logs or change global memories under a generic retrospective request.
