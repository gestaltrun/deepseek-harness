# Agent Note: Engine-owned GLM accounts over existing auth-files

Status: proposed

English | [中文](2026-09-15-account-pool-engine-owned-glm.zh.md)

## Problem

The current [product-owned account pool](2026-09-14-plugin-account-pool.md) treats GLM Coding Plan as a second persistence model. CLIProxyAPI already stores OAuth accounts as JSON files under `auth-dir` and lists them through `/v0/management/auth-files`. GLM instead lives in `config.yaml` as `glm-coding-plan[]`, with a separate management protocol, while the product package keeps `glm-accounts.json`, a journal, and a projection into that config array so a generation rewrite of `config.yaml` does not drop keys.

That split is not a UI requirement. Gestaltrun should not own a second credential ledger, a second GLM HTTP surface, per-generation TLS pinning, or credential-file export. CLIProxyAPI already persists credentials on disk; the product Host should start the engine and forward the existing management and inference HTTP, not re-implement account kinds.

## Proposal

### Engine: one auth-file protocol for every account kind

GLM Coding Plan becomes a file-backed auth of `type: "glm"` under the existing `auth-dir` and `/v0/management/auth-files` routes. Upload, list, patch fields, enable/disable, delete, and quota observation use the same paths as Claude and Codex.

The file synthesizer, not the product package, maps that JSON onto the runtime attributes the GLM executor and quota poller already read (`api_key`, `glm_site`, `base_url`, optional organization/project). A Host that POSTs a GLM JSON through `auth-files` must see the account in `GET auth-files` with `provider: glm` and a quota envelope.

There is no YAML `glm-coding-plan` ingest and no GLM-specific management routes.

### Product package: process host plus BFF plus Settings UI

`@gestaltrun/dsh-account-pool` keeps:

- spawning the pinned engine against a private `stateRoot` / `auth-dir`
- typed Remote for roster, login, fields, quota refresh, and model list
- Host-owned HTTPS authorization open
- Settings UI
- one catalog projection onto `ctx.llm` `gestalt-account-pool`

It deletes:

- `glm-accounts.json`, the GLM journal, `GlmAccounts`, `submitGlmKey` as a distinct persistence path, and `glmCard` as a second roster
- `/api/account-pool.export`, `downloadAuthFile`, `allowCredentialExport`, and the download control
- per-generation TLS certificates, the `selfsigned` dependency, and the custom CA `undici.Agent`

GLM enrollment uses the same login/submit path as other API-key accounts: the Client sends a GLM JSON, the Host uploads it through `auth-files`, and the engine owns the file. Quota refresh is `GET auth-files` (passive envelope) or the engine's existing per-auth probe, not a product-side parser of a second protocol.

### Loopback without TLS

The engine listens on `http://127.0.0.1:<port>` with `remote-management.allow-remote: false` and a generation-private management and inference key. Host requests stay on that origin and the existing path allowlist. Binding localhost plus bearer keys is the isolation; a throwaway certificate is not.

## Alternatives considered

**Keep `glm-accounts.json` as the product authority and project into `glm-coding-plan`.** Rejected. It exists only because the engine stores GLM in a config array that `configure()` rewrites each generation. Putting GLM on `auth-dir` removes the rewrite hazard without a second ledger.

**Keep generation TLS while dropping the GLM ledger.** Rejected. The certificate is a fresh self-signed server cert written under `generations/` and pinned in-memory as the sole `undici` CA. It is not a long-lived CA, and localhost plus management keys already bound the process. The cert, key files, and `selfsigned` dependency are extra moving parts.

**Keep credential export as a Desktop-only download.** Rejected. The user does not need it. Auth files remain in the engine `auth-dir` for the Host; the renderer never receives bodies.

**Invent a new `/v0/management/accounts` resource.** Rejected. `auth-files` already lists runtime auths, patches fields, and carries quota envelopes. GLM should appear there once it has a `path`.

## Acceptance criteria

- Uploading a GLM Coding Plan JSON through `/v0/management/auth-files` persists it under `auth-dir` and returns the account from `GET /v0/management/auth-files` with `provider: glm`.
- GLM quota polling and inference work from that file-backed auth without `config.yaml` `glm-coding-plan` entries.
- The product package has no GLM ledger, journal, or GLM-only management client; its roster is the auth-files list.
- The product package does not generate TLS material and speaks HTTP to the loopback engine.
- Settings has no download/export control; `/api/account-pool.export` is absent.
- Existing OAuth login, field edits, quota cards, and `gestalt-account-pool` model registration still work.

## Risks

Existing Desktop GLM keys stored only in `glm-accounts.json` must be migrated once onto `auth-dir` JSON files, or those keys are lost on upgrade. Loopback HTTP exposes management and inference keys to other processes on the same machine that can reach the bound port; the generation keys and `allow-remote: false` remain required. File synthesizer mapping must copy `api_key` / `glm_site` onto Attributes, or quota and inference silently fail while the roster looks healthy.
