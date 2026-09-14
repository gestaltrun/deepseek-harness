# Agent Note: Windows unsigned manual installer workflow

Status: implemented

English | [中文](2026-09-14-desktop-unsigned-release-workflow.zh.md)

## Problem

Windows installation diagnosis sometimes needs the complete Desktop payload without an EV token. The signed release job must continue to fail closed when its certificate or hardware-backed key is unavailable, while a local unsigned package must never look like an update release.

## Decision

The manual Desktop Release workflow has a dedicated `windows-unsigned` operation. It requires a source commit contained in `master` and the `test` deployment, runs the existing unsigned Windows package command on the controlled Windows runner, and uploads only the installer from `unsigned-artifacts/` as a workflow artifact. The operation does not receive signing or OSS credentials, does not produce a completion record or updater metadata, and cannot enter the OSS or GitHub Release publication jobs. Signed Windows packaging remains a separate job with its existing certificate, token, and SignTool requirements.

The six signed upload invocations pass `--phase` directly to their package scripts. An extra argument delimiter caused pnpm to forward a literal `--` to the parser; removing it keeps immutable uploads ahead of channel metadata without changing the upload phases.

## Consequences

Reviewers can request a reproducible Windows installer for manual installation from a test-only workflow run without weakening signed release checks or creating an update feed. The Actions artifact expires under the workflow retention period and is not an OSS release object. Production distribution still requires the signed `publish` operation.

## Alternatives considered

**Allow unsigned mode through the signed Windows job.** This would mix certificate-free and signed credentials in one path and make a missing signer easier to overlook.

**Upload unsigned bytes to OSS.** Without updater metadata and a completion record, OSS publication would create an unsupported update surface and blur manual-install artifacts with release channels.
