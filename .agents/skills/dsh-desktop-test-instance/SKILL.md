---
name: dsh-desktop-test-instance
description: Prepare, operate, replace, or clean an isolated DSH Electron acceptance instance, or an explicit baseline/candidate A/B pair. Use for native Desktop product checks and human comparison; preserve the other side and user-created data during replacement.
---

# Desktop test instances

Use one instance for ordinary acceptance and two named instances (`baseline` and `candidate`) for an explicit comparison. Read the current [Desktop documentation](../../../apps/desktop/README.md), launcher, and available native computer-use instructions before launching. A source development run, packaged application, mock-provider run, and real-model run are different evidence lanes.

## Establish identity and isolation

Inspect existing goal-owned instances before creating another. Maintain a gitignored runtime record under the task's artifact directory with the application/checkout path, commit and package identity, launch mode, Harness home, Electron user-data, writable profile/package tree, PIDs, ports, comparison side, input owner, evidence paths, and retained data. Keep ordinary and comparison records distinct.

Use fresh private state roots, not the user's normal Harness home or browser profile. Copies of settings/credentials require the existing explicit source/target authorization; never expose values or copy unrelated user state. Give each side its own writable profile, workspace/test data, logs, user-data, and dependent processes. Seed equivalent independent scenario data and use the same relevant model/provider references, locale, and parameters.

Verify the actual launcher options instead of copying another fork's Platform, PostgreSQL, Sidecar, URL, or credential-sanitizer recipe. This repository's development launcher fixes its development project and Electron user-data under its checkout; changing only `DSH_HOME` therefore does not isolate two development instances. Use separate checkouts for that launcher and distinct inspector ports. A packaged run must likewise prove its actual application, backend, and profile identities. Do not rewrite signed bundle metadata to label A/B.

Launch through the repository's supported Desktop path. Do not invent an application bin, bypass the normal profile composition, or describe a standalone Web page or direct IPC probe as native acceptance. If native computer use is unavailable, state that gap; keep other valid evidence and do not silently substitute a different mode for an explicitly requested Electron comparison.

## Walk and hand off

One accountable environment owner maintains the instance or pair. Each application has at most one active input driver. Verify that both comparison records correspond to separate live backends and state roots, not merely two windows.

Walk the accepted experience route through actual native user input. Check the starting state, actions, visible results, relevant failures, and frozen UI draft. During combination verification, use [record-browser-gif](../record-browser-gif/SKILL.md) for the ticket routes and follow [ticket evidence and acceptance](../orchestrate-dsh-delivery/references/ticket-evidence.md). Compare both sides under equivalent conditions, retaining separate A/B recordings, and identify uncertain or nondeterministic observations honestly. Performance claims use the owning performance skill rather than a single favorable run.

Before the first human handoff, the main ODD session checks ticket completeness from the linked recordings and supporting evidence, and the original UI design session confirms fidelity against the frozen draft. After both applicable reviews pass, provide the exact version/application paths, A/B identities, ticket GIFs and review conclusions, starting state, reproducible route, known differences, and truthful evidence lane. Final independent code review follows this initial human acceptance. Keep the frozen instance available during the user's acceptance; unrelated branch progress does not invalidate it.

## Replace one side

For A/B work, retain the baseline when replacing the candidate. Name the selected record explicitly, save its evidence outside disposable roots, preserve user-created content, stop only its recorded processes, and verify its ports are released before replacement. A newly discovered upstream version is another adoption choice, not permission to retarget the frozen pair.

Recheck the changed route and record the replacement's exact identity. Refresh affected ticket GIFs and functional/fidelity reviews before user reacceptance. Earlier screenshots/GIFs keep their original provenance. Final PR evidence follows [record-browser-gif](../record-browser-gif/SKILL.md), including its live-head checks; later relevant changes invalidate the corresponding storyboard.

## Clean up without losing work

Before deleting any selected scratch or application copy, inspect it for user-created notes/files, unique changes, and evidence not already retained. Save authorized retained content outside disposable roots; preserve the directory with an owner and reason when its contents are uncertain or not disposable. Never delete the user's normal state, shared checkout, or another comparison side under a generic cleanup instruction.

Stop only recorded, identity-verified PIDs and verify associated ports/resources are released. Remove exact disposable paths after preservation. Completion means processes are stopped and every selected data path is either safely removed or explicitly retained with its owner, reason, and location. Route success and cleanup success are reported separately.
