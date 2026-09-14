# CLIProxyAPI account-pool delivery record

English | [中文](2026-09-14-account-pool-migration.zh.md)

## Summary

This temporary delivery reference tracks the accepted account-pool migration to `gestaltrun/deepseek-harness`. The [proposed Agent Note](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.md) owns architecture and acceptance criteria. The record expires when the migration's accepted candidate and final evidence are recorded in its delivery PR.

## Table of Contents

- [Frozen inputs](#input-revisions)
- [Delivery ownership](#owner-assignments)
- [Evidence and handoff](#acceptance-evidence)
- [Dev Note](#execution-scratch)

<a id="input-revisions"></a>

## Frozen inputs

| Input | Identity |
| --- | --- |
| Target baseline | `375e2838dec1ff3fba7730256b9bfda2a17c1983` on `gestaltrun/master`; the original clean `c291e7961a515f6d7af9304e7fd1d257929aef26` was advanced with `--ff-only`. |
| Integration branch | `codex/migrate-cliproxyapi-account-pool-20260914` |
| Source checkout | `cliproxyapi-merger`, source HEAD `0f11d3e411de41b1eeff69dbb08f8c65d803b4be` plus ten tracked working-tree changes. |
| Engine | `gestaltrun/CLIProxyAPI` at `1d25ceb7f38736880880a5a0d9e08ebb5349d950`; the source submodule is clean. |
| Local source freeze | `tmp/account-pool-migration-20260914/source-freeze`, 109 tracked source files; no personal account or environment files. |
| Source manifest SHA-256 | `9985e7c6bd3383928cb3fb1b510f2a3b20fc1bb7c0ae27623c4c92c1a2213165` |
| Working-tree patch SHA-256 | `c881c3a4de8c53aaa24f870be3883af13af54d21029ab495bd8815e2ebaedfc4` |

The source remains read-only. The migration excludes unrelated fork capabilities and personal credentials. Later mainline movement requires an explicit integration decision rather than silently replacing this input revision.

<a id="owner-assignments"></a>

## Delivery ownership

One end-to-end migration ticket owns the complete account-management and model-use path. Backend, UI, and packaging are internal responsibilities of that single delivery unit.

| Responsibility | Owner | Writable scope | Input and state | Completion evidence |
| --- | --- | --- | --- | --- |
| Backend and API | Backend owner, assigned after planning publication | Account-pool service, CLIProxyAPI provider, quota library, narrow Typert API, owning tests and package docs | Accepted interfaces in the proposed Agent Note; isolated branch and worktree follow the planning revision | Generation lifetime, durable configuration, secret exclusion, adapter registration, API authorization, focused tests and Loader composition. |
| Shared Settings UI | UI owner, assigned after planning publication | Account-pool client package, locale dictionaries, owning tests and package docs | Accepted service/API declarations; isolated branch and worktree follow the planning revision | Account and quota controls, independent Settings section, Read-only Models footer, localized failures, recorded output and real product interaction. |
| Integration and packaging | Delivery/environment owner | Integration branch, bundle/profile and Desktop packaging, source pin, aggregate manifests/catalogs, delivery docs and acceptance environment | Baseline frozen; implementation awaits planning publication | Exact engine artifact, default Desktop composition, optional Web composition, built smoke, isolated native acceptance, reviewed GIF and delivery PR. |

<a id="acceptance-evidence"></a>

## Evidence and handoff

The preparation check observed Node `24.18.0`, pnpm `11.7.0`, Go `1.26.0` on macOS arm64, Xcode `26.4`, and an existing Electron `44.0.0` executable. Both frozen-lockfile installations completed; the second matched the advanced baseline. Native CUA successfully read a running DSH application's `dsh-app://` accessibility tree. This establishes a callable driver, not acceptance of the migration.

No `DEEPSEEK_API_KEY` is present in the task environment, and neither this checkout nor the normal Harness home has a `.env` file. No personal credential storage was read or copied. An isolated supported Desktop development launch can verify the real engine's empty-pool and OAuth starting states. Authenticated model inference requires an authorized account environment. Signing, notarization, and formal release publication remain separate from this migration's development acceptance.

Verification records must name the exact candidate, launch mode, private state roots, actions, visible results, and retained evidence. Unit fixtures do not establish native product acceptance. The frozen acceptance checkout remains separate from implementation and local CI.

<a id="execution-scratch"></a>

## Dev Note

Non-authoritative execution scratch: the planning revision publishes the accepted service/API, TLS, durable configuration, and owner scopes. Exact worker and acceptance identities are recorded in the delivery PR ledger as work proceeds.
