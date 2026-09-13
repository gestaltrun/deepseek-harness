# Skill migration audit

This audit compares the selected skill trees from `cliproxyapi-merger` at source revision `0f11d3e411de41b1eeff69dbb08f8c65d803b4be` with this repository, as well as the pinned Matt upstream recorded in [SOURCES.json](SOURCES.json). Source-only local metadata is identified separately from files tracked at that revision. Coverage means every selected source file has a destination; adapted instructions are not claimed to be byte-identical.

## Selected source coverage

The selected source contains 41 skill directories and 114 files: 37 Matt skills, the referenced `show-me` and `unslop` helpers, ODD, and the Desktop acceptance skill. Every file has a destination. Additional current-repository references and per-skill licenses remain included.

| Source resource | Destination and treatment |
|---|---|
| Matt skill bodies, references, scripts, templates, and Codex metadata | All 37 directory trees retained, refreshed against the pinned official revision; file-level local adaptations recorded in `SOURCES.json` |
| `show-me`, `unslop` | Retained with their separate provenance and licenses |
| ODD `references/model-routing-cliproxyapi.md` | Retained byte-for-byte; ODD reaches it only for permitted CLIProxyAPI with a verified live catalog |
| ODD `references/session-roles.md` | Retained and adapted to the accepted ticket-GIF reviews, independent simplification, isolated writers, and supported current-host APIs |
| ODD `agents/openai.yaml` | Retained; presentation text matches current delivery behavior |
| Desktop `CUA-AVAILABILITY.md` | Retained with configured/connected/registered/native-callable/background-accepted levels; current service metadata and permission semantics govern execution |
| Desktop `agents/openai.yaml` | Retained; presentation text covers ordinary acceptance and explicit A/B comparison |
| `docs/agents/session-retro.md` | Consolidated into [repository retrospective rules](orchestrate-dsh-delivery/references/repository-context.md#retrospectives), [retro](retro/SKILL.md), and its [local lesson archive](retro/references/lessons.md); kept ids and repeat counts are retained |
| `docs/agents/delegation-routing.md` | Relocated to [ODD delegation routing](orchestrate-dsh-delivery/references/delegation-routing.md); preserves explicit route selection, continuation, replacement criteria, and supervision without assuming all hosts share DSH queue semantics |

[SOURCES.json](SOURCES.json) records source hashes and retained/adapted status for the local workflow files. The model priority table is unchanged from the supplied source. Restoring that table does not prove a provider is enabled or a listed model is available in the current runtime.

## Referenced policies

[ODD](orchestrate-dsh-delivery/SKILL.md) preserves the normal implementation/fix/continue/land delivery authority, subject to explicit user limits and the applicable message/release authorization. Root remains the coordinator for small and large work; unavailable writer isolation is a capability gap rather than permission for Root to implement. [The delivery ledger](orchestrate-dsh-delivery/references/delivery-ledger.md) preserves clean planning, remote-visible accepted inputs and exact-SHA handoff, one draft delivery PR, fixed owner/evidence/state rows, and centralized integration before the ready frontier advances. Explicit local-only requests keep an equivalent local record.

The source ODD's targeted prerequisite check before expensive operations and its second-identical-failure diagnosis rule live in [delegation supervision](orchestrate-dsh-delivery/references/delegation-routing.md#supervise-and-accept). The latter reaches `diagnosing-bugs` when cause is unestablished. It does not restart owners or silently downgrade a model.

Source `docs/agents/issue-tracker.md` and `docs/agents/domain.md` are represented by [repository context](orchestrate-dsh-delivery/references/repository-context.md): current tracker discovery, existing glossary/Agent Notes, accepted criteria, and dependency relationships. Old repository ids, Project configuration, and launcher/CI commands are not copied as current configuration. Source process Notes are historical rationale; the current [delivery decision](../notes/implemented/process/2026-09-13-matt-skills-and-dsh-delivery.md) owns the applicable migrated workflow. Source Desktop helper scripts and historical acceptance proofs do not establish this checkout's launch or product acceptance.

## Other source-only directories

These four directories are outside the selected Matt/custom-delivery import. Their absence is explicit rather than counted as completed migration:

| Directory | Disposition |
|---|---|
| `dsh-doc-standards` | The current official [dsh-doc](dsh-doc/SKILL.md) owns document placement, audits, budgets, and validation; retain that current owner rather than the older fork skill |
| `dsh-doc-site-sync` | The current [dsh-doc website reference](dsh-doc/references/website-sync.md) owns this workflow; old fork-specific commands do not become current build requirements |
| `ego-browser` | Host-installed browser skill, not a Matt skill or a required repository-local import; select the available current browser integration rather than copying a host-specific recipe |
| `skill-doctor` | Separate non-Matt transcript-audit workflow, not a dependency of the selected delivery skills; not imported |

The old tracker settings, Platform-specific launch recipe, merge-check names, forced user-owned task creation, and post-acceptance-only GIF order are adapted to the current repository and accepted delivery requirements. Their source wording is not silently treated as an executable configuration here.
