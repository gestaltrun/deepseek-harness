# Agent Note: Engine-owned GLM accounts over existing auth-files

Status: proposed

English | [中文](2026-09-15-account-pool-engine-owned-glm.zh.md)

## Problem

GLM Coding Plan must use the same persistence and management protocol as other CLIProxyAPI accounts. A second product ledger, a second GLM HTTP surface, per-generation TLS, or credential-file export would re-implement account kinds the engine already owns on disk.

## Proposal

### Engine: one auth-file protocol for every account kind

GLM Coding Plan is a file-backed auth of `type: "glm"` under `auth-dir` and `/v0/management/auth-files`. Upload, list, patch fields, enable/disable, delete, and quota observation use the same paths as Claude and Codex.

The file synthesizer maps that JSON onto the runtime attributes the GLM executor and quota poller already read (`api_key`, `glm_site`, `base_url`, optional organization/project). A Host that POSTs a GLM JSON through `auth-files` must see the account in `GET auth-files` with `provider: glm` and a quota envelope.

There is no YAML `glm-coding-plan` ingest and no GLM-specific management routes.

### Product package: process host plus BFF plus Settings UI

`@gestaltrun/dsh-account-pool` spawns the pinned engine against a private `stateRoot` / `auth-dir`, exposes typed Remote for roster, login, fields, quota refresh, and model list, opens HTTPS authorization in the Host, and projects one catalog onto `ctx.llm` `gestalt-account-pool`.

GLM enrollment uses the same submit path as other API-key accounts: the Client sends a GLM JSON, the Host uploads it through `auth-files`, and the engine owns the file. Quota refresh is the auth-files envelope or `POST /v0/management/auth-files/quota?name=`.

### Loopback without TLS

The engine listens on `http://127.0.0.1:<port>` with `remote-management.allow-remote: false` and a generation-private management and inference key. Host requests stay on that origin and the existing path allowlist. Binding localhost plus bearer keys is the isolation.

## Alternatives considered

**Keep a product GLM ledger and project into `config.yaml`.** Rejected. File-backed auth removes the rewrite hazard without a second ledger.

**Keep generation TLS.** Rejected. Localhost plus management keys already bound the process.

**Keep credential export as a Desktop-only download.** Rejected. Auth files remain in the engine `auth-dir` for the Host; the renderer never receives bodies.

**Invent a new `/v0/management/accounts` resource.** Rejected. `auth-files` already lists runtime auths, patches fields, and carries quota envelopes.

## Acceptance criteria

- Uploading a GLM Coding Plan JSON through `/v0/management/auth-files` persists it under `auth-dir` and returns the account from `GET /v0/management/auth-files` with `provider: glm`.
- GLM quota polling and inference work from that file-backed auth.
- The product package has no GLM ledger or GLM-only management client; its roster is the auth-files list.
- The product package does not generate TLS material and speaks HTTP to the loopback engine.
- Settings has no download/export control.
- Existing OAuth login, field edits, quota cards, and `gestalt-account-pool` model registration still work.

## Risks

A leftover product `glm-accounts.json` is migrated onto `auth-dir` once at lock acquisition, or those keys are lost. Loopback HTTP exposes management and inference keys to other processes on the same machine that can reach the bound port; the generation keys and `allow-remote: false` remain required. File synthesizer mapping must copy `api_key` / `glm_site` onto Attributes, or quota and inference silently fail while the roster looks healthy.
