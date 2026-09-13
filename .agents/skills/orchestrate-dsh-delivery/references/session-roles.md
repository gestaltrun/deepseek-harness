# Delivery session roles

Use the fewest sessions that preserve ownership and independent judgment. Reuse each owner through coherent fixes; do not create a session for every ticket, error, or review comment. [ODD](../SKILL.md) owns the demand and acceptance order; [delegation routing](delegation-routing.md) owns model capability and continuation, and [the delivery ledger](delivery-ledger.md) owns durable dispatch and integration. A small local change may need only one implementation owner; Root's coordination role remains unchanged.

| Role | Responsibility |
| --- | --- |
| Root | Keeps the demand, accepted scheme/design, dependency graph, decisions, evidence, and user communication. Root model selection belongs to the user; the coordinator never routes or changes itself. It assigns implementation, tests, document/environment edits, and integration to their owners, including late fixes. Without a supported isolated writer, it reports the missing capability rather than doing that work itself. It reviews ticket GIFs and supporting evidence for functional completeness and synthesizes retrospective choices. |
| Scheme and simplification | Designs the technical scheme, consumes bounded open-source research, and records the accepted alternatives. After initial human acceptance, the same session may perform simplification only when it is independent of the affected implementation authors; otherwise use a separate independent owner. |
| UI | Produces and validates the interaction design when GUI behavior is relevant, then reviews ticket recordings against that frozen draft before human acceptance. Reuse the original design session through fidelity fixes; omit the role when no UI work applies. |
| Module implementer | Owns one stable module and may deliver several related tickets. Implementation, review, CI, E2E, and acceptance fixes return to that owner. Additional implementers need independently writable module scopes and isolated worktrees. |
| Quality | Owns deterministic checks, E2E, snapshots, and combination evidence. Runs local CI separately from the frozen acceptance instance. Supplies the recording/environment owner with ticket criteria and any required runtime observations. |
| Delivery / environment | Integrates exact owner commits, operates the isolated acceptance instance or A/B pair, records and attaches ticket GIFs, prepares provider and experience instructions, maintains the draft PR, and tracks remote CI. Each live application has one input driver. This role does not replace Quality, the main session's functional review, or independent code review. |
| Independent code review | Reviews the integrated candidate after initial human acceptance, with separate Standards and Spec conclusions, and re-reviews affected deltas. It stays independent of implementation ownership. When the applicable installation routing policy requires a non-author model, verify that choice rather than treating a fresh session as model diversity. |

## Delivery sequence

1. Root scopes the demand and obtains the reviewed technical scheme and applicable UI design. Scheme uses `research` to compare open-source implementations before selecting the design.
2. Root publishes the dependency graph and assigns stable owners. Delivery integrates their exact commits; parallel writers use separate worktrees and branches.
3. Quality verifies the combined candidate. Delivery records the GUI routes and attaches them to tickets through [ticket evidence](ticket-evidence.md). Root checks functional completeness and the original UI session checks fidelity against the frozen draft.
4. After those applicable reviews pass, Delivery hands the exact frozen instance, ticket GIFs, conclusions, and experience route to the user. Local CI and unrelated work do not disturb that instance.
5. After initial human acceptance, independent simplification and code review inspect the accepted candidate. Root presents optional improvements for the user's scope decision.
6. Fixes return to original module owners. Quality reruns affected checks; Delivery refreshes affected recordings; Root, UI, and independent reviewers revisit their affected conclusions before user reacceptance. The final PR recording obeys exact live-head publication checks.
7. Every involved session retrospects only its own work. Root consolidates one keep/drop set; accepted edits pass relevant checks before the authorized merge or coordinated release.

Roles do not establish runtime isolation. Verify actual worktree, process, state-root, permission, and credential ownership. Use the current host's documented delegation and continuation APIs; the DSH message queue, Codex collaboration tools, and user-owned task APIs need not have identical timing or capabilities. Create a user-owned task only when the user explicitly requests one.
