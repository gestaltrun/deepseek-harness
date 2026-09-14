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

One end-to-end migration ticket owns the complete account-management and model-use path. The user approved the revised product-only plan and requested implementation. Integration and both writers use clean worktrees; the excluded upstream scaffolds remain untouched in the original worktrees.

| Responsibility | Owner | Implementation scope | Current state | Next check |
| --- | --- | --- | --- | --- |
| Domain, runtime and RPC | Backend owner | Internal modules of `product/packages/account-pool` only | Integrated; real core, profile Loader, TLS, lifecycle and Session replay checks pass | Review combined product behavior. |
| Shared Settings UI | UI owner | Product Client, controller, locales and tests | Integrated; real Gateway injection regression, focused interactions, public Client build and native entry checks pass | Account-dependent card and login-completion acceptance. |
| Product artifact and integration | Delivery/environment owner | Product pin, Go resources, independent lock/build and four permitted Desktop glue/test files | Build, pack, scope rejection tests, installed consumer and native empty pool pass | Publish the candidate and retain live-account acceptance as pending. |

The hard constraint excludes all `packages/**` and `vendor/**` implementation changes, root workspace/compiler/dependency additions, upstream `patchedDependencies` or postinstall patches, edited upstream `node_modules`, and upstream `/src` imports. CLIProxyAPI code and resources belong to `product/packages/account-pool`; no upstream application owns its business logic or build tools.

At the scope audit, integration, backend, and UI worktrees all remained at planning commit `5dfe635bc7cfc70b665e0c76825f1b1b6061b7d0`, with no tracked or staged changes under `packages/**` or `vendor/**`. Integration retained untracked `catalog/` and a build-test scaffold. Backend retained untracked account-pool service/API directories, and UI retained an untracked account-pool client directory. These retained paths are not implementation inputs and must not enter a commit.

<a id="acceptance-evidence"></a>

## Evidence and handoff

The preparation check observed Node `24.18.0`, pnpm `11.7.0`, Go `1.26.0` on macOS arm64, Xcode `26.4`, and Electron `44.0.0`. Product Host/Client compilation passes with normal npm resolution and strict library checking. The generated Remote contains sixteen strict operations per face. The darwin-arm64 core binary has SHA-256 `cd869d0aecfd3e54b7dc4800d6c96ee3dfa12846b5457f64786c27c483b8bbf0`. The independent installed tarball passes normal public typing, Host imports, Client factory admission, descriptor checks, and resource identity verification.

No `DEEPSEEK_API_KEY` is present in the task environment, and neither this checkout nor the normal Harness home has a `.env` file. No personal credential storage was read or copied. An isolated supported Desktop development launch can verify the real engine's empty-pool and OAuth starting states. Authenticated model inference requires an authorized account environment. Signing, notarization, and formal release publication remain separate from this migration's development acceptance.

The native source composition uses the existing Desktop preparation and Electron launch steps with an explicit private base/Web/model-center/account-pool profile. Real `dsh-app://` interaction verifies the running empty pool, six-provider chooser, empty GLM form with disabled save, and Codex PKCE initiation and cancellation. The product's explicit executable-file declaration preserves Go resource permissions through normal pnpm packaging and installation. Private project, home, user data, ports, process logs and screenshots remain in the acceptance checkout's `.desktop-build/development` directory. These are partial native UI observations; they do not establish authenticated inference, populated cards, credential download, the stock development default, or signed release.

<a id="execution-scratch"></a>

## Dev Note

Non-authoritative execution scratch: the implementation is active and the PR remains draft pending native acceptance and review. The combined product tests passed 169 cases; after refreshing the declared SDK installation, the final recorded-Session case passed separately. The Session recording contains eighteen durable records covering model selection, image admission, reasoning, actual tool execution, and tool results through the public SDK/profile with a local TLS/SSE fixture. It does not prove provider authentication.
