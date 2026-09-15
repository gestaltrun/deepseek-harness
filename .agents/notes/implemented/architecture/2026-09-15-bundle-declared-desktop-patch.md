# Agent Note: Bundle-declared Desktop patch overlay

Status: implemented

English | [中文](2026-09-15-bundle-declared-desktop-patch.zh.md)

## Problem

A profile bundle sometimes needs a different composition on Desktop than on Web. Product IM is the concrete case: on Web its bundle's `cordis.patch.yml` selects `@deepseek-ai/dsh-host-directory-picker-browse` (the public browser pairing), but Desktop already mounts `directory-picker-native` from `apps/desktop-host/config/desktop.cordis.patch.yml`, and Cordis `service "directoryPicker" has been registered at <NativeDirectoryPicker>` fails loud when both back-ends load in the same fiber. Before this note, the only way to specialize a bundle for Desktop was to have every caller add an explicit `--patch <bundle>/desktop.patch.yml` argument, which packaged Desktop launches can't do.

The narrow alternative — teach `apps/desktop-host` about `@gestaltrun/dsh-im-bundle` specifically, the way it already knows the base bundles — burns a fork-owned integration point per product bundle and gives no path forward for future bundles.

## Decision

A profile bundle may declare `dsh.bundle.desktopPatch` alongside its existing `dsh.bundle.patch`, pointing to a Desktop-only overlay file inside the same package. `apps/desktop-host/src/index.ts`'s `desktopPatches()` loads every bundle's declared Desktop overlay after its own generic patch and before the profile's user layer, so:

1. The bundle's cross-platform `cordis.patch.yml` still ships everywhere.
2. The Desktop overlay specializes the same row set with `disabled: true` and `config: {}` writes as needed.
3. A user's home-level `cordis.patch.yml` and `--patch` overlays still outrank the bundle's Desktop specialization.
4. `apps/desktop-host/config/desktop.cordis.patch.yml` (which owns the base Desktop composition — disabling web-startup, mounting `directory-picker-native`, etc.) still applies last, so a bundle cannot override the Desktop Host's own invariants.

`loadBundleDesktopPatches()` in `apps/desktop-host/src/bundle-desktop-patch.ts` reads the manifest, resolves the overlay path against the package directory, refuses paths escaping the package, and returns one patch layer or an empty array. Unit tests cover empty/present/blank/outside-of-package/real-IM-bundle cases in `apps/desktop-host/tests/bundle-desktop-patch.spec.ts`.

The IM bundle uses this to disable `gestaltrun-im-directory-picker-browse` and set `gestaltrun-im-ui.config.directoryPicker: native` on Desktop. `apps/desktop/src/product-profile.ts` adds `@gestaltrun/dsh-im-bundle` to `DESKTOP_PRODUCT_BUNDLES` and lists the client entries each bundle contributes (`DESKTOP_PRODUCT_CLIENT_ENTRIES`) for the packaged runtime smoke's client-boot-graph check. `apps/desktop/scripts/product-artifacts.ts` becomes generic over all five distributed product packages and additionally verifies the declared Desktop overlay matches between source and archive.

## Alternatives considered

**Hardcode the IM bundle in `apps/desktop-host`.** Rejected: burns one fork-owned integration point per product bundle. Model Center could get away without a Desktop-specific overlay because its rows are platform-neutral; the pattern doesn't generalize.

**Have Desktop launches always pass `--patch <bundle>/desktop.patch.yml`.** Rejected: packaged Desktop doesn't accept caller-supplied `--patch` (Electron owns the profile composition through `desktopPatches()`), so no caller could actually add it. The `smoke:im-profile` scripted composition uses this shape only because it targets the public CLI, not the Desktop Host.

**Extend `dsh.bundle.patch` to a per-platform map.** Rejected as premature: the current uses are Web-plus-Desktop, and a scalar-plus-scalar declaration matches the existing single-string field grammar without inventing a new one. `web.patch.yml` and other flavors remain caller-selected overlays.

## Consequences

The Desktop `directoryPicker` service composes without collision when the IM bundle is active. `smoke:im-profile` continues to prove the composition (`matchedDesktopDirectoryPicker: true`, `matchedWebDirectoryPicker: true`); the packaged runtime smoke includes both product bundle client entries in the client-boot-graph check.

`readProductArtifacts()` now verifies all five distributed product archives (`model-center`, `im-runtime`, `api-im`, `ui-im`, `im-bundle`); its unit tests cover a stale-version archive, an archive that drops the declared Desktop overlay, and an unpublished dependency spec.

Not covered by this decision: the client-side propagation of a bundle-declared config value. The dev Electron walkthrough recorded in `.agents/local/im-delivery/desktop-dev-8ee8a3737f/walkthrough.md` observes that ui-im's client `Config.directoryPicker` never reaches the client apply function — `BootPluginRow` (`packages/client/modules/src/client/manifest.ts`) carries no per-plugin config and `bootClient()` calls `loader.create({ name })` without a config field, so the client always sees the default `browse`. Consequently, the sidebar `添加工作区` action mounts `BrowseDirectoryFlow` and later fails with `directoryPicker.list needs the browse capability; the composed picker serves "native"`. The proper fix — either exposing picker capability through a Client-visible service or extending the boot manifest to carry server-resolved config — is a separate change with its own decision.

## Testing

`pnpm vitest run apps/desktop-host/tests/bundle-desktop-patch.spec.ts` (5 tests) — parses declared overlay, rejects blank/outside-package declarations, and asserts the shipped `product/im-bundle/desktop.patch.yml` composes to the native-picker row set.
`pnpm vitest run apps/desktop/tests/product-artifacts.spec.ts` (4 tests) — proves the generalized artifact verifier accepts all five product archives and rejects a stale version, a manifest that drops the desktopPatch declaration, and a workspace-linked dependency.
`pnpm --dir product run smoke:im-profile` — end-to-end proof through the public `dsh --profile <name> --dump-config` CLI that Web overlays compose to the browse row and Desktop overlays compose to the native row.
Dev Electron acceptance run in `.agents/local/im-delivery/desktop-dev-8ee8a3737f/` — IM Accounts settings section renders in the packaged Settings dialog; the picker collision does not occur on boot. Native directory picker itself remains gated by the client-side config-propagation gap noted under Consequences.
