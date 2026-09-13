# Published plugin delivery and verification

Read this reference when product work introduces or changes a DSH plugin, community dependency, wrapped engine, profile bundle, or Agent preset. [Architecture](../../../../docs/architecture.md) owns composition and launch; [package guidance](../../../../docs/cookbook/adding-a-package.md) and [Client rules](../../../../packages/client/AGENTS.md) own repository packages. External packages follow the supported public exports and installable bundle format rather than copying this repository's internal workspace layout.

## Design the extension

Put product behavior in its plugin owner. Prefer public services, events, tool registrations, and UI slots. Classify Host versus Client responsibilities and shared Host versus per-session preset ownership. A swappable capability includes the required Service Definition, Provider, and Consumer roles; the deep-module heuristic does not erase a deliberate capability interface or demand a second provider solely to justify it.

Separate source acquisition from product adoption. A community submodule or external fork keeps its own history; do not automatically merge its entire workspace, lockfile, or build system into the Host repository. Track the exact source, built package/binary, dependency identity, and profile selection. Record unavoidable Host modifications and private-layout dependencies so future upstream assessments can reconsider them.

Package published code and all runtime assets through the owning build/manifest. Client entries, dependency identity, configuration, disposal, failure behavior, localization, and model-visible logged effects are part of the plugin's design. Dynamic `cordis_define` packages are process-local exploration artifacts, not installed packages that survive a restart.

Use profiles and ordered bundle/patch composition for supported product launches. Use the preset composition skill for session capability choices without moving cross-session services or approval policy into a preset. Treat package distribution, default profile activation, and default Agent tool exposure as independent product decisions.

## Plan observable evidence

Follow [testing policy](../../../../docs/testing.md), [CI test reliability](../../dsh-ci-test-reliability/SKILL.md), and [pre-push selection](../../dsh-pre-push-checks/SKILL.md). Select the narrow owning checks that cover the actual change:

| Layer | Required observation when affected |
|---|---|
| Plugin behavior | Accepted behavior, errors, cancellation, lifetime, and cleanup; assertions disagree with the intended regression |
| Real composition | Loader/profile resolves actual exports and dependencies, activates intended rows, rejects bad configuration, and does not duplicate registrations |
| Built installation | A clean environment installs the candidate package and loads its exact version and assets without relying on a development checkout |
| Product path | Supported Web/Desktop routes, tool/model effects and required Session-driven snapshots; a plugin unit test alone is insufficient |
| Upgrade | Previously adopted configuration/data survives the supported upgrade path, disabled/removed plugins behave as specified, and recovery respects released-data rules |

If a plugin replaces a built-in capability, verify both its replacement behavior and the specified outcome after disabling/removing it. If several upstreams change, isolate the relevant causes and then test the chosen combined artifact set. Run performance measurements only for material performance changes or explicit targets.

During combination verification, record GUI routes and attach them through [ticket evidence](ticket-evidence.md). The main session checks functional completeness and the UI design session checks fidelity before human acceptance. Initial human acceptance still precedes independent simplification/code review in ODD. Revalidate affected behavior and recordings after fixes. For multi-repository Gestaltrun work, [coordinated release](../../dsh-upstream-integration/references/coordinated-release.md) owns candidate CI, package staging, final promotion, and partial failure. These instructions do not install registry protections or CI in another repository.
