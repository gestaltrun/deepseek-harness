---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Use [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) and the repository's changed-behavior policy to select the narrowest red/green test and pre-push evidence. Do not default to a full suite or repeat a passing check solely because commit or push follows.

Once the scoped behavior is implemented, report the complete committed and dirty scope to ODD. The writer self-checks locally; ODD schedules independent Standards/Spec review after initial product acceptance and returns findings to the same owner.

Commit your work to the current branch.
