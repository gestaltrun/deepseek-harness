# Product workspace

English | [中文](README.zh.md)

## Summary

Product packages use this independent pnpm workspace and published DSH peers. Install dependencies with `pnpm --dir product install --frozen-lockfile --ignore-scripts`. The workspace pins Zod to `4.4.3` so product schemas and the published DSH schema interfaces resolve the same implementation. The default `build`, `test`, `typecheck`, and `pack` scripts include [Model Center](model-center/README.md), IM Runtime, DingTalk and Wangwang providers, API, and UI; `test` also runs the product build-helper checks, and `pack` includes the IM bundle.

## Table of Contents

- [IM build inputs](#im-build-inputs)
- [Dev Note](#dev-note)

<a id="im-build-inputs"></a>
## IM build inputs

The [accepted IM architecture](../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md) assigns runtime, API, UI, and distribution ownership. `tsconfig.host.json` and `tsconfig.client.json` select separate compiler faces. Product source imports resolve through the shared base configuration; the Client Remote import consumes the generated Host artifact.

`pnpm --dir product run build:im-api` builds the runtime, both platform providers, API Host, generated Remote artifacts, and API Client in that order. `pnpm --dir product run pack:im-api` performs the same build and writes the runtime and API npm archives into `product/dist`.

`pnpm --dir product run build:im` adds the UI build after the runtime/API sequence. `pnpm --dir product run pack:im-bundle` builds those packages and packs them with the [configuration bundle](im-bundle/README.md). `typecheck` prepares generated Remote declarations before checking every product package. The bundle owns the installed profile check and current composition limits.

Run `pnpm --dir product run generate:im` after building the IM runtime and API Host. Every referenced member and its installed peers must be present; missing inputs fail the command. It generates the API package's Host reflection and Remote Client artifacts before the API Client and UI builds. `pnpm --dir product run test:build` verifies this build step against real published npm declarations.

After the build, `pnpm --dir product run smoke:im-loader` checks package-name Loader discovery, generated reflection, public RPC input validation, and disposal. `DSH_IM_SMOKE_INSTALL_ROOT` selects a separate installed consumer for the same check. The [API package](api-im/README.md) owns the configuration and Client lifecycle smoke.

`DSH_IM_SMOKE_INSTALL_ROOT=<installed-consumer> pnpm --dir product run smoke:im-agent-profile` creates a private base-backed profile with the public `dsh` CLI, installs the built runtime archive, and runs one deterministic IM admission through the shipped `standard` preset. The check matches the archive, installed runtime, and consumer entry hashes; uses a synthetic Provider and scripted LLM; and verifies automatic Agent creation, history and send tools, Session persistence, and a settled outbox item. It is an offline installed-profile smoke, not a recorded-session replay or real account/model evidence.

The fixed `@deepseek-ai/dsh-typert-generator@0.1.5-rc.2` requires package projects under a `packages` directory and a registered protocol declaration project. The build helper copies unchanged product source and published protocol declarations into a private temporary compiler workspace. It generates only the IM API package, retains formal package imports and package-relative declaration maps, rejects empty output or private absolute paths, and removes the compiler workspace after generation. Generated diagnostic source locations use that compiler workspace's relative package paths. Runtime packages contain neither the generator nor the copied protocol declarations.

<a id="dev-note"></a>
## Dev Note

None.
