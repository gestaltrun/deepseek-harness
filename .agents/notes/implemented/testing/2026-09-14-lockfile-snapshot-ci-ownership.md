# Agent Note: Select lockfile consumers by resolved snapshot

Status: implemented

English | [中文](2026-09-14-lockfile-snapshot-ci-ownership.zh.md)

## Problem

A pnpm lockfile can contain several versions of one package name. A CI planner that propagates a changed `name@version` through every dependency edge with the same name treats unrelated resolved versions as consumers. Adding one release-only dependency can then select provider, Python, benchmark, Web, and platform checks whose dependency trees are unchanged.

## Decision

The fork CI planner tracks changed pnpm package and snapshot keys as exact `name@resolved-reference` identities. Reverse traversal resolves each dependency edge to its exact snapshot key, including peer suffixes and `npm:` aliases, before deciding that its parent changed. The planner converts the resulting identities to package names only after traversal, when it maps the affected external dependency to workspace manifests. Existing importer-change and workspace reverse-dependency rules continue to select direct owners and their consumers.

## Alternatives considered

**Propagate by package name.** Rejected because a new `statuses@1` must not invalidate an unchanged consumer of `statuses@2`.

**Ignore transitive lockfile changes.** Rejected because a changed resolved snapshot can alter a workspace package even when its importer record and manifest stay unchanged.

**Special-case Desktop release dependencies.** Rejected because the error comes from version-insensitive graph traversal and can recur with any package.

## Consequences

Lockfile-only changes retain conservative reverse-dependency coverage for the exact resolved graph without expanding through unrelated versions. The parser supports the pnpm v9 references stored in this repository; a new lockfile reference form requires a focused resolver case before CI may rely on it.
