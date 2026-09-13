---
name: implement-spec
description: Implement an accepted specification and its dependency-linked tickets through the repository delivery coordinator.
disable-model-invocation: true
---

# Implement a specification

Read the accepted spec and complete ticket graph. Tickets form a frontier: a ticket can start only when its blockers are satisfied. Preserve that graph and accepted requirements; do not decompose an already ticketed spec again.

For this DSH repository, invoke [orchestrate-dsh-delivery](../orchestrate-dsh-delivery/SKILL.md). Pass the spec, tickets, existing integration branch/PR, accepted decisions, completed evidence, and unresolved blockers. ODD owns stable module writers, filesystem isolation, integration, real-product acceptance, independent review, retrospective, and cleanup. This entry does not create a second PR, task tree, merger, or acceptance environment.

Communicate through durable pointers and concise delta briefs. Reuse a suitable owner through related tickets and fixes; parallelize only independent work with actual isolated ownership. Creating a subagent does not create a worktree, and a user-owned task requires an explicit request.

Completion is the endpoint authorized for the delivery, with exact evidence and remaining release state reported by ODD. Do not delete worktrees merely because implementers returned or describe a ready PR as a merged/released product.
