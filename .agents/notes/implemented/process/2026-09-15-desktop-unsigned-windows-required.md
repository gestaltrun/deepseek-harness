# Agent Note: Require unsigned Windows on every Desktop release

Status: implemented

English | [中文](2026-09-15-desktop-unsigned-windows-required.zh.md)

This decision amends the [unsigned Windows workflow](2026-09-14-desktop-unsigned-release-workflow.md) and the [Gestaltrun Desktop publication path](2026-09-14-gestaltrun-desktop-release.md).

## Problem

Windows users need a complete Desktop installer on every Gestaltrun release. The hardware-backed EV signer is often unavailable, so a signed Windows job cannot be a required publication target. A dedicated `windows-unsigned` operation let operators skip Windows entirely on `candidate` and `publish` runs.

## Decision

Every Desktop Release `candidate` and `publish` run packages an unsigned Windows x64 installer with the required signed macOS arm64 and macOS x64 targets. The unsigned job uses GitHub-hosted `windows-latest`, the existing unsigned package command, and `desktop-dry-run`. It still omits signing credentials. It writes updater metadata and a completion record, and `publish` uploads that installer to the selected OSS update feed.

Production `publish` also attaches that installer to the `gestalt-v<version>` GitHub Release. Signed Windows x64 remains an explicit `include_windows` job with its existing certificate, token, and SignTool requirements. When signed Windows is selected, its artifacts replace the unsigned Windows objects in the same `win-x64` OSS prefix.

The dedicated `windows-unsigned` operation is retired. `validate` still packages nothing.

## Alternatives considered

**Keep a dedicated `windows-unsigned` operation.** Operators can skip Windows on the publication path that users actually consume.

**Require signed Windows on every publication.** Missing EV hardware would block macOS and GitHub Release publication.

**Keep unsigned Windows off OSS.** Windows users would receive a GitHub Release installer but no in-app update channel unless an EV signer is available.

## Consequences

A `candidate` or `publish` run fails if unsigned Windows packaging fails. The selected OSS feed always has a Windows installer. Automatic updates work from that unsigned installer until a signed Windows target replaces the same `win-x64` objects.
