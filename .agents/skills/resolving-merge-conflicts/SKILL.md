---
name: resolving-merge-conflicts
description: "Resolve an in-progress merge/rebase conflict, a PR conflict with its verified master target, or conflicts from a user-requested merge of master."
---

In ODD, reuse the integration owner and affected module owners. If a PR reports a conflict before a local operation exists, verify its actual base/head and reproduce the authorized merge strategy in the isolated delivery worktree, preserving unrelated user changes. An unknown mergeability status is not a confirmed conflict. A user request to merge `master` does not authorize substituting a rebase or changing another branch.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where compatible and do not invent behavior. When the primary sources establish incompatible intent or do not authorize a choice, leave that conflict unresolved and report the exact decision needed. Abort only when the user or owning workflow authorizes returning to the pre-operation state.

4. Discover the project's **automated checks** and run the narrow checks affected by the resolution. Fix regressions introduced by the merge; preserve unrelated failures as evidence.

5. **Finish the merge/rebase.** Stage only files and hunks owned by this resolution, preserving pre-existing user changes. Continue only when every remaining conflict is resolved and the index contains no unrelated work.

Return the exact resulting commits, resolved intent, affected behavior, checks actually run, and any remaining decision to ODD. The existing owners refresh affected ticket GIFs, functional/fidelity reviews, and regression evidence before readiness. Follow the outgoing pre-push workflow; conflict resolution alone does not authorize merging the PR or publishing a release.
