# CLIProxyAPI account-pool delivery record

English | [中文](2026-09-14-account-pool-migration.zh.md)

## Summary

This temporary delivery reference tracks the proposed account-pool migration to `gestaltrun/deepseek-harness`. The [proposed Agent Note](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.md) owns architecture and acceptance criteria. The record expires when the migration's accepted candidate and final evidence are recorded in its delivery PR.

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

One end-to-end migration ticket owns the complete account-management and model-use path. Implementation is paused for the user's review of the revised product-only plan; no owner is ready to implement. The existing worktrees and uncommitted scaffolds are retained without moving or deleting them.

| Responsibility | Owner | Authorized future implementation scope | Current state | Next check |
| --- | --- | --- | --- | --- |
| Domain, runtime and RPC | Backend owner | Internal modules of `product/packages/account-pool` only | Paused; old new-package scaffolds excluded | Published adapter/transport feasibility verified; wait for user plan review. |
| Shared Settings UI | UI owner | Product package Client, controller, locales and tests | Paused; old upstream-client scaffold excluded | Public package-mode Remote and Client loading plan verified; wait for user review. |
| Product artifact and integration | Delivery/environment owner | Product-owned source pin, Go resources/build, independent product lock/build, the two allowed Desktop product glue files and their tests | Planning revision in progress; no Go build or packaging authorized this round | Publish the complete revised ownership and public-API design for user review. |

The hard constraint excludes all `packages/**` and `vendor/**` implementation changes, root workspace/compiler/dependency additions, upstream `patchedDependencies` or postinstall patches, edited upstream `node_modules`, and upstream `/src` imports. CLIProxyAPI code and resources belong to `product/packages/account-pool`; no upstream application owns its business logic or build tools.

At the scope audit, integration, backend, and UI worktrees all remained at planning commit `5dfe635bc7cfc70b665e0c76825f1b1b6061b7d0`, with no tracked or staged changes under `packages/**` or `vendor/**`. Integration retained untracked `catalog/` and a build-test scaffold. Backend retained untracked account-pool service/API directories, and UI retained an untracked account-pool client directory. These retained paths are not implementation inputs and must not enter a commit.

<a id="acceptance-evidence"></a>

## Evidence and handoff

The preparation check observed Node `24.18.0`, pnpm `11.7.0`, Go `1.26.0` on macOS arm64, Xcode `26.4`, and an existing Electron `44.0.0` executable. Both frozen-lockfile installations completed; the second matched the advanced baseline. Native CUA successfully read a running DSH application's `dsh-app://` accessibility tree. This establishes a callable driver, not acceptance of the migration.

No `DEEPSEEK_API_KEY` is present in the task environment, and neither this checkout nor the normal Harness home has a `.env` file. No personal credential storage was read or copied. An isolated supported Desktop development launch can verify the real engine's empty-pool and OAuth starting states. Authenticated model inference requires an authorized account environment. Signing, notarization, and formal release publication remain separate from this migration's development acceptance.

Verification records must name the exact candidate, launch mode, private state roots, actions, visible results, and retained evidence. Unit fixtures do not establish native product acceptance. The frozen acceptance checkout remains separate from implementation and local CI.

<a id="execution-scratch"></a>

## Dev Note

Non-authoritative planning scratch: the public inference composition passed an isolated TLS/SSE feasibility probe without a real provider account or upstream changes. The published prior plan is superseded as implementation guidance. The PR remains draft, issue readiness is removed, and this round authorizes only plan revision and its documentation checks/publication after review.
