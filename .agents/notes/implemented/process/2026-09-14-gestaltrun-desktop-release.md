# Agent Note: Publish Gestaltrun Desktop releases

Status: implemented

English | [中文](2026-09-14-gestaltrun-desktop-release.zh.md)

Desktop version coupling and updater behavior follow the [Electron packaging and update decision](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md).

## Problem

The Gestaltrun fork builds the complete Desktop and dsh unit but has no repository-owned path from signed target artifacts to the public update feed. The existing upload path targets DeepSeek infrastructure, and GitHub does not list Gestaltrun Desktop versions.

## Decision

Keep the existing Desktop version coupling and `electron-updater` interaction. A manually dispatched workflow validates an exact commit and version, packages the required macOS arm64 and macOS x64 targets with the existing signing requirements, and packages an unsigned Windows x64 installer with every `candidate` and `publish` run. Credential-free unpublished candidates remain workflow artifacts without adding them to an update channel. Signed Windows x64 remains explicitly selectable and fails unless its hardware-backed signing inputs are available. Runtime materialization admits only validated pnpm network concurrency and fetch-timeout controls from ambient package-manager settings; Desktop continues to own the registry, authentication, hooks, and package-manager state.

Signed candidate packaging and publication accept only a commit contained in `master`. The macOS packaging hook resolves and writes electron-builder's standard updater configuration before signing the unpacked application, so the later prepackaged artifacts retain it. Publication obtains short-lived Alibaba Cloud credentials through the repository's dedicated OIDC role, uploads immutable installers and blockmaps to a dedicated OSS prefix with a validated configurable request timeout, and replaces each target's standard generic-feed metadata last. The test and production deployments use separate public prefixes. A production publication also creates one `gestalt-v<version>` GitHub Release with OSS download links, so GitHub Releases is the human-readable version list. The [unsigned Windows requirement](2026-09-15-desktop-unsigned-windows-required.md) owns when the Windows installer ships to that feed.

DeepSeek Gestalt uses its existing reference artwork and application name. Packaged metadata derives its internal name from the application ID, so Electron's updater cache does not share the workspace package identity; visible menus continue to use localized product copy. The update coordinator, confirmation dialog, download flow, Host shutdown, installation, and restart remain unchanged.

## Alternatives considered

**Copy the reference fork's complete product-release system.** Rejected because its Platform, Mobile, recovery, and release-plan machinery does not belong to this fork's Desktop-only publication path.

**Add a custom update service or application UI.** Rejected because the standard generic feed and current update interaction already provide discovery and installation. Another version service or state machine would conflict with upstream behavior.

**Reuse an existing private product bucket or long-lived access keys.** Rejected because Desktop artifacts require deliberate public read access, while a dedicated bucket and repository-scoped OIDC role confine publication authority.

## Verification

- Credential-free checks validate dispatch inputs, target coverage, artifact names, checksums, object order, and release links.
- macOS publication requires signing and notarization. Unsigned Windows packaging is required for every `candidate` and `publish` run and is uploaded to the selected OSS feed. Selecting signed Windows requires the existing hardware-backed signing inputs and replaces the unsigned Windows objects.
- Packaging does not receive OSS credentials, and publication does not accept a commit outside `master`.
- Every selected target's immutable payloads exist before any selected channel metadata is replaced.
- Test publication does not create a GitHub Release; production publication creates one release and updates the production feed without a separate version service.

## Consequences

OSS has no transaction spanning all three target metadata files. A failed publication can expose a valid update to an earlier target while a later target remains on the previous version; rerunning the same validated candidate repairs that state. Missing EV hardware blocks signed Windows publication; it does not omit the unsigned Windows installer from `candidate`, `publish`, or the selected OSS feed.
