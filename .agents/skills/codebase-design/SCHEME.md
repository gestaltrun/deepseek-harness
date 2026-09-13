# Technical scheme review

Use this reference when a demand changes interfaces, capability roles, lifecycle ownership, durable formats, or process/security boundaries. A mechanical edit or an accepted unchanged design does not need another scheme review.

ODD assigns an existing scheme owner or a bounded collaboration subagent with the accepted scope and source pointers. Independent writers use isolated worktrees; create a user-owned Codex task only when explicitly requested. A large unresolved decision map may use an explicitly invoked `wayfinder` before the scheme is ready.

## Record the design

Read current architecture, consumers, failure paths, and Agent Notes. Use DSH's precise service, event, API, slot, and capability terminology alongside [SKILL.md](SKILL.md). Existing capability obligations take precedence over an adapter-count heuristic.

Use [research](../research/SKILL.md) during scheme design to identify open-source implementations worth referencing or adopting. The scheme owner supplies the bounded question, consumes primary-source findings and integration obligations, and records how they affect the selected design. Reuse existing current findings; a discovered project is a candidate, not authorization to adopt it.

Use the [Agent Note format](../../notes/README.md): a proposal includes Problem, Proposal, Alternatives considered, Acceptance criteria, and Risks. Identify ownership, lifecycle/cancellation/disposal, configuration and data obligations, observable tests, and extension points. Use [dsh-prose-standard](../dsh-prose-standard/SKILL.md) and check related old notes through [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md).

Self-check accepted behavior, justified interfaces, failure and lifetime requirements, and real alternatives before human review. Do not turn a file list into a design or silently add requirements.

## Present the decision

When a visual helps, create a gitignored review artifact with the decision, one focused diagram, tradeoffs, and the observation that will establish success. Use [show-me](../show-me/SKILL.md) and [unslop](../unslop/SKILL.md) for human explanation; the linked Agent Note remains the technical authority. No additional presentation skill is required.

Present the concrete proposal before asking about an unresolved material choice. Preserve accepted choices. A frozen proposed Note remains proposed until implementation establishes shipped behavior; design approval is not product acceptance.

## Hand off

[to-spec](../to-spec/SKILL.md) records accepted decisions and links the Note; [to-tickets](../to-tickets/SKILL.md) creates the necessary vertical slices. After initial product acceptance, ODD assigns scoped simplification to an owner independent of the affected implementation authors. Reuse the scheme owner when that condition holds; otherwise assign a bounded collaboration subagent. Route independent code review through [dsh-code-review](../dsh-code-review/SKILL.md).
