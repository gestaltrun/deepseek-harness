# Agent Note: Publish Gestaltrun Desktop releases

Status: implemented

English | [中文](2026-09-14-gestaltrun-desktop-release.zh.md)

## Problem

The Gestaltrun fork builds the complete Desktop and dsh unit but has no repository-owned path from signed target artifacts to the public update feed. The existing upload path targets DeepSeek infrastructure, and GitHub does not list Gestaltrun Desktop versions.

## Decision

Keep the existing Desktop version coupling and `electron-updater` interaction. A manually dispatched workflow validates an exact commit and version, packages the required macOS arm64 and macOS x64 targets with the existing signing requirements, and retains credential-free unpublished candidates as workflow artifacts without adding them to an update channel. Windows x64 remains explicitly selectable and fails unless its hardware-backed signing inputs are available.

Signed candidate packaging and publication accept only a commit contained in `master`. Publication obtains short-lived Alibaba Cloud credentials through the repository's dedicated OIDC role, uploads immutable installers and blockmaps to a dedicated OSS prefix, and replaces each target's standard generic-feed metadata last. The test and production deployments use separate public prefixes. A production publication also creates one `gestalt-v<version>` GitHub Release with OSS download links, so GitHub Releases is the human-readable version list.

DeepSeek Gestalt uses its existing reference artwork and application name. The update coordinator, confirmation dialog, download flow, Host shutdown, installation, and restart remain unchanged.

## Alternatives considered

**Copy the reference fork's complete product-release system.** Rejected because its Platform, Mobile, recovery, and release-plan machinery does not belong to this fork's Desktop-only publication path.

**Add a custom update service or application UI.** Rejected because the standard generic feed and current update interaction already provide discovery and installation. Another version service or state machine would conflict with upstream behavior.

**Reuse an existing private product bucket or long-lived access keys.** Rejected because Desktop artifacts require deliberate public read access, while a dedicated bucket and repository-scoped OIDC role confine publication authority.

## Verification

- Credential-free checks validate dispatch inputs, target coverage, artifact names, checksums, object order, and release links.
- macOS publication requires signing and notarization. Selecting Windows requires the existing hardware-backed signing inputs; omitting it leaves the Release target list Mac-only.
- Packaging does not receive OSS credentials, and publication does not accept a commit outside `master`.
- Every selected target's immutable payloads exist before any selected channel metadata is replaced.
- Test publication does not create a GitHub Release; production publication creates one release and updates the production feed without a separate version service.

## Consequences

OSS has no transaction spanning all three target metadata files. A failed publication can expose a valid update to an earlier target while a later target remains on the previous version; rerunning the same validated candidate repairs that state. Missing signing hardware or credentials blocks the affected target instead of producing an unsigned release.
