---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording a durable project decision in the repository's established decision-doc system.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Follow the repository's existing domain and decision owners. A root `CONTEXT.md` usually denotes one context; a `CONTEXT-MAP.md` routes a multi-context repository. In DSH, start from the existing [glossary](../../../docs/glossary.md), subsystem references, and [Agent Notes](../../notes/README.md); a generic filename is not a reason to duplicate their facts. Existing instructions may name Agent Notes, ADRs, RFCs, or another decision-doc tree; extend that system rather than creating a parallel `docs/adr/` hierarchy.

Create files lazily. Add a context document only when durable terminology needs an owner, and add a decision record only when the repository's decision criteria are met.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update CONTEXT.md inline

When a term is resolved, update the owning glossary/context document right there; use `CONTEXT.md` only when it is the established owner. Don't batch these up: capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer decision records sparingly

Follow the repository's decision-record requirements first, including DSH's non-trivial-change Agent Note rule. Where no project rule already requires a record, use these criteria:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any condition is missing, skip the record. When the repository has no established owner, use [ADR-FORMAT.md](./ADR-FORMAT.md) as a fallback only after confirming the location.
