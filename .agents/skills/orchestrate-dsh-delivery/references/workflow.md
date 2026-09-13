# Skill workflow map

The map assigns jobs, not mandatory invocations. Preserve each skill's invocation metadata. Explicit-only skills are entered by the user; ODD uses available model-invocable primitives and the already accepted task instead of loading an explicit-only workflow indirectly. In particular, `grilling` plus `domain-modeling` supplies ordinary design clarification; the extended translation workflow always requires its explicit user invocation.

## Delivery stages

| Stage | Matt workflow | DSH integration and result |
|---|---|---|
| Intake | `ask-matt` routes an explicit request; `triage` handles incoming unstructured work; `diagnosing-bugs` establishes a reproducible signal; `wayfinder` resolves large decision maps | Upstream changes call `dsh-upstream-integration`; performance work calls `dsh-speed-up-perf`; pin the problem and the affected combination |
| Design | `grill-with-docs` / `grilling`, `domain-modeling`, `research`, `codebase-design`, `prototype` | Public extension points, ownership, actual user route, and test observations are settled; `dsh-doc`, `dsh-prose-standard`, and new-note `dsh-archive-agent-notes` apply |
| Specification | `to-spec` then `to-tickets` for work needing decomposition | Freeze accepted scope, draft/route, and vertical dependency graph; `dsh-ci-test-reliability` checks resource-owning test plans |
| Implementation | `implement` and `tdd`; explicit `implement-spec` enters ODD | Stable owners deliver plugins and wrappers; `dsh-pre-push-checks` selects outgoing evidence, prose/doc rules accompany code |
| Quality and initial experience | Repeatable scenarios and real supported product routes | Plugin behavior, real composition, package installation, snapshots, upgrade, and targeted performance evidence precede initial human acceptance; Desktop A/B uses `dsh-desktop-test-instance` |
| Independent close audit | `code-review` keeps Standards and Spec separate | `dsh-code-review`, `dsh-find-simplifications`, `dsh-archive-agent-notes`, `dsh-doc`, `dsh-prose-standard`, and `dsh-trim-cot-leakage` inspect the affected final candidate |
| Repair and retrospective | Existing owners fix findings; `retro` proposes environment improvements | Recheck affected behavior, obtain affected reacceptance, and apply only selected retrospective changes |
| Final evidence and merge | ODD keeps live state and owners | `record-browser-gif` demonstrates the final GUI candidate; `dsh-pre-push-checks` and, for actual dependent PRs, `dsh-merging-stacked-prs` govern publication/merge evidence |
| Product release | Main demand owns related repositories | `dsh-upstream-integration` binds tested candidates and coordinated formal publication; installed upgrade remains separate evidence |
| Periodic maintenance | Explicit `improve-codebase-architecture`, using `codebase-design` | `dsh-find-simplifications` supplies evidence-backed deletion candidates; selected work enters design/specification rather than being silently added to another demand |

Use `dsh-translate-docs` only for explicitly requested extended translation. Use current `dsh-doc` for the document-structure and website responsibilities formerly split into fork-local documentation skills.

## Supporting and explicit workflows

| Skills | Placement |
|---|---|
| `grill-me`, `grill-with-docs`, `grilling`, `loop-me`, `to-questionnaire` | Clarification, workflow discovery, or questions for another decision owner; preserve explicit-only entry points and settled decisions |
| `handoff`, `claude-handoff` | Carry the accepted task to another context or harness when requested; verify destination capability, and do not discard context or create a user-owned task automatically |
| `show-me`, `unslop`, `wait-what` | Explain decisions and human review material; repository contracts and technical prose remain under `dsh-prose-standard` |
| `writing-for-agents`, `writing-fragments`, `writing-beats`, `writing-shape`, `teach` | Agent instructions or explicitly requested writing/learning work; they are not production-release prerequisites |
| `setup-matt-pocock-skills` | Initial or explicitly requested tracker/domain setup; preserve existing repository owners and symlinks |
| `setup-pre-commit`, `git-guardrails-claude-code`, `setup-ts-deep-modules`, `migrate-to-shoehorn`, `scaffold-exercises` | Explicit setup or migration in a matching repository; importing a skill does not install its tools, hooks, dependencies, or sample packages |
| `wizard` | Prepare a verified manual setup, credential, or cutover procedure only for actions the human must perform; ODD retains accepted scope and release authorization |
| `resolving-merge-conflicts` | Resolve an actual in-progress conflict by the accepted intent; unrelated user changes remain outside staging |

## Product-provided skills and fixtures

The Cordis preset's [dynamic plugin skill](../../../../packages/preset/agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md) supports runtime exploration and temporary plugin work; its [composition skill](../../../../packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md) supports presets and service isolation. They do not replace [published plugin delivery](plugin-delivery.md).

`snapshot-skill`, `model-only-skill`, and `user-only-skill` are skill-loader fixtures; `preview-tour` belongs to the Preview fixture. They are inputs to their owning tests, not workflow stages or evidence that a product plugin was accepted.
