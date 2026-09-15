# Agent Note: Windows unsigned manual installer workflow

Status: implemented

English | [中文](2026-09-14-desktop-unsigned-release-workflow.zh.md)

## Problem

Windows installation diagnosis sometimes needs the complete Desktop payload without an EV token. The signed release job must continue to fail closed when its certificate or hardware-backed key is unavailable, while a local unsigned package must never look like an update release.

## Decision

The unsigned Windows package command remains a separate job from signed Windows packaging. `candidate` and `publish` run that job on GitHub-hosted `windows-latest`, write updater metadata and a completion record, and keep the installer as a workflow artifact. The job does not receive signing credentials. The [unsigned Windows requirement](2026-09-15-desktop-unsigned-windows-required.md) owns when that installer ships to OSS and how a production GitHub Release attaches it. Signed Windows packaging remains a separate job with its existing certificate, token, and SignTool requirements.

The six signed upload invocations pass `--phase` directly to their package scripts. An extra argument delimiter caused pnpm to forward a literal `--` to the parser; removing it keeps immutable uploads ahead of channel metadata without changing the upload phases.

## Consequences

Reviewers get a reproducible Windows installer on every `candidate` and `publish` run without mixing unsigned credentials into the signed Windows job. The Actions artifact expires under the workflow retention period. `publish` also uploads that installer to the selected OSS feed.

## Alternatives considered

**Allow unsigned mode through the signed Windows job.** This would mix certificate-free and signed credentials in one path and make a missing signer easier to overlook.

**Upload unsigned bytes to OSS without updater metadata.** Without a completion record and channel metadata, OSS publication would create an unsupported update surface. The unsigned package command now writes those files before `publish` uploads the installer.
