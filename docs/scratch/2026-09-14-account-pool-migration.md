# CLIProxyAPI account-pool delivery record

English | [中文](2026-09-14-account-pool-migration.zh.md)

## Summary

This temporary delivery reference tracks the account-pool product package on `gestaltrun/deepseek-harness`. The [architecture note](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.md) owns architecture and acceptance criteria. The record expires when the accepted candidate and final evidence are recorded in its delivery PR.

## Table of Contents

- [Identities](#input-revisions)
- [Ownership](#owner-assignments)
- [Evidence](#acceptance-evidence)
- [Dev Note](#execution-scratch)

<a id="input-revisions"></a>

## Identities

| Input | Identity |
| --- | --- |
| Target baseline | `375e2838dec1ff3fba7730256b9bfda2a17c1983` on `gestaltrun/master` |
| Integration branch | `codex/migrate-cliproxyapi-account-pool-20260914` |
| Product PR | [gestaltrun/deepseek-harness#42](https://github.com/gestaltrun/deepseek-harness/pull/42) |
| Engine | `gestaltrun/CLIProxyAPI` at `4bc4119e1d3353593dc25f8d24e7d55afad33f33`, recorded as the `community/cliproxyapi` gitlink |

The migration excludes unrelated fork capabilities and personal credentials. Later mainline movement requires an explicit integration decision.

<a id="owner-assignments"></a>

## Ownership

One product package owns account management and pooled model use. Implementation stays in `product/packages/account-pool`. Desktop glue is limited to the four existing product-registration files.

The hard constraint excludes `packages/**` and `vendor/**` implementation changes, root workspace/compiler/dependency additions, and upstream source imports. CLIProxyAPI source and resources belong to the product package; it is not a Desktop community plugin.

<a id="acceptance-evidence"></a>

## Evidence

Product Host/Client compilation uses normal npm resolution and strict library checking. The generated Remote contains sixteen strict operations per face. Isolated Desktop development launch can verify empty-pool and OAuth starting states. Authenticated model inference requires an authorized account environment. Signing, notarization, and formal release publication remain separate.

<a id="execution-scratch"></a>

## Dev Note

Non-authoritative: the PR remains draft pending native acceptance and review. A recorded Session covers model selection, image admission, reasoning, and tool execution through a local fixture; it does not prove provider authentication.
