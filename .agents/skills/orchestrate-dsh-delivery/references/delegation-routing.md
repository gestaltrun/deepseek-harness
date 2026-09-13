# Delegation routing and context reuse

Use this provider-neutral reference before dispatching or continuing a subagent. [Session roles](session-roles.md) defines delivery responsibilities. Apply the [CLIProxyAPI model priorities](model-routing-cliproxyapi.md) only when that provider is permitted and its live catalog verifies the exact identifiers and required capabilities.

## Decide and select

Use deterministic tools directly for discovery, status, exact transformations, and small local checks. Delegate bounded work for separate context, useful parallel execution, a required capability, or independent review. Define the deliverable, read/write scope, risk, accepted observations, necessary context, and independence before selecting a route. Preserve the user's task language in user-facing descriptions and todos.

Choose an available provider/model using the user's restrictions, installation priorities, verified input/tool capabilities, and evidence from comparable work. Pass explicit route fields when the runtime supports them and the applicable instructions permit overrides; otherwise state the effective inherited or fixed route. A model name does not establish image input, computer use, quota, billing, cache behavior, or benchmark rank. Root model selection remains the user's decision.

Preserve excluded routes and the applicable fallback order. Check live catalog entries rather than static account counts. Distinguish quota exhaustion and unavailable routes from rate limits, authentication, network, and code failures; repeated failure alone does not justify a downgrade. The installation-specific reference owns fallback eligibility. For a different runtime or unapproved provider, do not pretend its priority list has been applied or silently activate it.

## Continue or replace

Inspect the runtime's actual catalog of continuable children before spawning. Reuse a suitable owner through implementation, CI, integration, review findings, and acceptance fixes. Batch coherent findings and send a delta brief containing the current base, new objective, retained constraints, invalidated evidence, and next completion check.

Use only the host's documented continuation API. In DSH, `send_message` queues a later turn and cannot redirect the active turn, change provider/model, or move cwd. Other hosts may have different message delivery semantics; inspect their current tool contract. Prefer a same-session model change at a safe turn boundary only when supported and its scope is known. A host-level switch may affect a global default. Otherwise record the limitation and let Root decide whether capability or independence requires replacement.

Start a fresh child for required independence, unrelated work, an unavailable or systematically stale owner, or a capability that the current owner cannot gain safely. Record the reason and hand off accepted decisions, exact revisions, evidence, open findings, and next checks. Fork only when completed parent history contains necessary context that a concise brief would lose; inherited author context is not independent review, and an in-flight turn may not be included.

A child session does not by itself isolate cwd, worktrees, processes, disk, credentials, or authority. Verify the actual writer environment. Follow up only with children the host can address; never read private session storage or foreign logs to manufacture continuity. Specifications, tickets, and Agent Notes hold durable decisions. User-owned task creation requires the user's explicit request.

## Supervise and accept

Keep active executors in the delivery state and use completion/attention events or a bounded managed wait. Re-read Git, CI, or child state after a result or change notification; dispatch is not completion. Send coherent feedback at a natural checkpoint. Use interruption only through the host's documented semantics and preserve pending work; DSH interruption may leave queued turns parked until a later waking send.

Before the first expensive build, Electron run, model call, or recording, the assigned owner checks the known prerequisites that can fail late in that target environment. Keep the check proportional to the planned operation: verify the required cache or executable, selected provider capability, callable session, target application, or scenario configuration as applicable. Record prerequisite evidence without displaying credential values; a generic checklist does not replace the target-specific check.

When the same failure signature occurs a second time, pause blind reruns and keep diagnosis with the current owner. Record observations, plausible causes, and the smallest experiment that distinguishes them; use [diagnosing-bugs](../../diagnosing-bugs/SKILL.md) while the cause remains unestablished. Repeat the expensive operation only after the experiment or a changed prerequisite adds evidence. A new worker or model is not a retry strategy.

The brief and return identify the deliverable, current source or worktree delta, read/write scope, exclusions, primary references, checks actually run, observable results, and remaining limitations. Reuse an owner while retained context is more useful than its stale assumptions or correction cost. Keep the accepted demand and outstanding requirements across compaction; do not claim a persistent KV cache or treat a context boundary as task completion.
