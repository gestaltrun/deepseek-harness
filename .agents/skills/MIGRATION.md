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
| `docs/agents/delegation-routing.md` | Relocated to [ODD delegation routing](orchestrate-dsh-delivery/references/delegation-routing.md); preserves explicit route selection, continuation, replacement criteria, and supervision without assuming all hosts share DSH queue semantics |

[SOURCES.json](SOURCES.json) records source hashes and retained/adapted status for the local workflow files. The model priority table is unchanged from the supplied source. Restoring that table does not prove a provider is enabled or a listed model is available in the current runtime.

## Other source-only directories

These four directories are outside the selected Matt/custom-delivery import. Their absence is explicit rather than counted as completed migration:

| Directory | Disposition |
|---|---|
| `dsh-doc-standards` | The current official [dsh-doc](dsh-doc/SKILL.md) owns document placement, audits, budgets, and validation; retain that current owner rather than the older fork skill |
| `dsh-doc-site-sync` | The current [dsh-doc website reference](dsh-doc/references/website-sync.md) owns this workflow; old fork-specific commands do not become current build requirements |
| `ego-browser` | Host-installed browser skill, not a Matt skill or a required repository-local import; select the available current browser integration rather than copying a host-specific recipe |
| `skill-doctor` | Separate non-Matt transcript-audit workflow, not a dependency of the selected delivery skills; not imported |

The old tracker settings, Platform-specific launch recipe, merge-check names, forced user-owned task creation, and post-acceptance-only GIF order are adapted to the current repository and accepted delivery requirements. Their source wording is not silently treated as an executable configuration here.
