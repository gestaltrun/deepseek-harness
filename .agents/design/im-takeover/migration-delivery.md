# IM takeover migration delivery

English | [中文](migration-delivery.zh.md)

## Summary

Implementation is authorized on 2026-09-14 under the accepted [product architecture](../../notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md). [Current specification #44](https://github.com/gestaltrun/deepseek-harness/issues/44) and its new sub-issues own this delivery. Product requirements and the prototype remain accepted; this handoff does not reopen design.

## Accepted inputs

The [frozen archive](frozen-inputs.tar.gz) preserves original relative paths and bytes for extraction into an empty directory. It contains 48 design/prototype/example-image files, the three files of the historical proposal, and the 79-item UI contract checklist. [frozen-inputs.json](frozen-inputs.json) records every SHA256 and source identity. The old proposal stays inside this design archive; it is not an active Agent Note in the destination repository.

- [Current accepted specification](https://github.com/gestaltrun/deepseek-harness/issues/44) retains every accepted user story; the archive contains the original specification and work-unit graph. The [public frozen prototype](https://github.com/gestaltrun/deepseek-harness-gestalt/tree/54a56df8ca8ed1f2e0493224936bf18cc1505645/.agents/design/im-takeover/prototype) matches the archived prototype bytes.
- [UI contract checklist](acceptance-checklist.md): A 24, B 16, C 9, D 30; 79 distinct criteria, not a completion percentage.
- [Public example-only screenshots](https://github.com/gestaltrun/deepseek-harness-gestalt/tree/54a56df8ca8ed1f2e0493224936bf18cc1505645/.agents/design/im-takeover/screenshots) are also inside the archive. Private GUI captures, credentials, dependency stores, and raw execution logs are excluded. The frozen prototype is not a portable product build; its historical local file dependency remains untouched.

Precedence is current user authorization, the accepted product architecture, this migration handoff, then accepted feature/experience requirements. Historical baseline, tracker, implementation-blocker, and approval statements in frozen files do not override the current migration. The legacy [root issue](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/613) and [specification PR](https://github.com/gestaltrun/deepseek-harness-gestalt/pull/623) are read-only history.

## Current work units

The accepted eight-unit breakdown is retained with new issue identities and native sub-issue/blocking relationships. The fixed-baseline architecture review is complete and does not create another design blocker.

| Unit | Current issue | Blocked by | Historical source |
|---|---|---|---|
| T1 | [#45 Account and route configuration](https://github.com/gestaltrun/deepseek-harness/issues/45) | None | [legacy T1](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/615) |
| T2 | [#46 History and delivery recovery](https://github.com/gestaltrun/deepseek-harness/issues/46) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45) | [legacy T2](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/616) |
| T3 | [#47 DWS employee account adapter](https://github.com/gestaltrun/deepseek-harness/issues/47) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T3](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/617) |
| T4 | [#48 Admitted Wangwang adapter](https://github.com/gestaltrun/deepseek-harness/issues/48) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T4](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/618) |
| T5 | [#49 Agent admission and shared tools](https://github.com/gestaltrun/deepseek-harness/issues/49) | [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T5](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/619) |
| T6 | [#50 Two-Session simulation and stop](https://github.com/gestaltrun/deepseek-harness/issues/50) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#49](https://github.com/gestaltrun/deepseek-harness/issues/49) | [legacy T6](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/620) |
| T7 | [#51 Accepted product UI](https://github.com/gestaltrun/deepseek-harness/issues/51) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45) | [legacy T7](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/621) |
| T8 | [#52 Installed Web/Desktop acceptance](https://github.com/gestaltrun/deepseek-harness/issues/52) | [#47](https://github.com/gestaltrun/deepseek-harness/issues/47), [#48](https://github.com/gestaltrun/deepseek-harness/issues/48), [#49](https://github.com/gestaltrun/deepseek-harness/issues/49), [#50](https://github.com/gestaltrun/deepseek-harness/issues/50), [#51](https://github.com/gestaltrun/deepseek-harness/issues/51) | [legacy T8](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/622) |

## Runtime, API, and UI handoff

| Owner | Handoff obligation |
|---|---|
| Runtime and Provider | Freeze public domain types, complete route identity, credential-reference rules, persistent operation outcomes, execution bindings, and Session/simulation lifecycle. Retain adapter evidence and stable message identity; scoped tools derive trusted caller context. |
| Host BFF and Client objects | Publish generated Remote/Client entries with safe account views, per-target save outcomes, authoritative instance/Session links, and follow snapshots/increments. Share the exact interface commit before UI consumption; do not hand-copy old Remote types. |
| UI | Implement only product-owned props/locale consumers. Account settings use settings.section; IM right-side content uses sidebarRightTabs and sidebar.right.pane.tab. Left Workspace-browser adaptation preserves the existing entry and unrelated behavior, with source provenance and regressions. |
| Delivery | Integrate stable commits including the preserved Host/UI dirty work, stage exact product packages, verify Loader and installed product paths, and maintain criterion-level functional/fidelity evidence. Notify the user when the candidate is ready for acceptance. |

Package publication, profile activation, live-account enablement, and product acceptance remain separate. Desktop consumes product artifacts through its existing product list; Web uses an explicit product overlay. Any necessary upstream `packages/` modification requires the user to see its concrete no-change impact and product-only alternatives before confirming the exact exception. Implementation authorization does not waive that condition.

## Acceptance record

Use the current specification experience route and the frozen 79-item checklist. Report focused tests, real composition, recorded-session snapshots, persistent new-process recovery, packed installation, Web/Desktop GUI fidelity, and authorized live-provider evidence separately. Existing source and historical passing tests do not prove this candidate passed. Raw logs and personal-account evidence remain in the designated local evidence store; publish only authorized sanitized evidence.
