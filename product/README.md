# Product workspace

English | [中文](README.zh.md)

## Summary

Product packages use this independent pnpm workspace and published DSH peers. Install dependencies with `pnpm --dir product install --frozen-lockfile --ignore-scripts`. The workspace pins Zod to `4.4.3` so product schemas and the published DSH schema interfaces resolve the same implementation. The `build`, `test`, `typecheck`, and `pack` scripts select [Model Center](model-center/README.md); its package owns those commands and runtime behavior.

## Table of Contents

- [IM build inputs](#im-build-inputs)
- [Dev Note](#dev-note)

<a id="im-build-inputs"></a>
## IM build inputs

The [accepted IM architecture](../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md) assigns runtime, API, UI, and distribution ownership. `tsconfig.host.json` and `tsconfig.client.json` select separate compiler faces. Product source imports resolve through the shared base configuration; the Client Remote import consumes the generated Host artifact.

`pnpm --dir product run build:im-api` builds the runtime, API Host, generated Remote artifacts, and API Client in that order. `pnpm --dir product run pack:im-api` performs the same build and writes both npm archives into `product/dist`.

`pnpm --dir product run pack:im-bundle` also packs the [configuration bundle](im-bundle/README.md). Its package owns the installed profile check and current composition limits.

Run `pnpm --dir product run generate:im` after building the IM runtime and API Host. Every referenced member and its installed peers must be present; missing inputs fail the command. It generates the API package's Host reflection and Remote Client artifacts before the API Client and UI builds. `pnpm --dir product run test:build` verifies this build step against real published npm declarations.

After the build, `pnpm --dir product run smoke:im-loader` checks package-name Loader discovery, generated reflection, public RPC input validation, and disposal. `DSH_IM_SMOKE_INSTALL_ROOT` selects a separate installed consumer for the same check. The [API package](api-im/README.md) owns the configuration and Client lifecycle smoke.

The fixed `@deepseek-ai/dsh-typert-generator@0.1.5-rc.2` requires package projects under a `packages` directory and a registered protocol declaration project. The build helper copies unchanged product source and published protocol declarations into a private temporary compiler workspace. It generates only the IM API package, retains formal package imports and package-relative declaration maps, rejects empty output or private absolute paths, and removes the compiler workspace after generation. Generated diagnostic source locations use that compiler workspace's relative package paths. Runtime packages contain neither the generator nor the copied protocol declarations.

<a id="dev-note"></a>
## Dev Note

None.
