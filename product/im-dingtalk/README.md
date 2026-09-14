---
description: "Connect installed DWS employee profiles to product IM with explicit authorization, event, recipient, and send evidence."
kind: "package-reference"
---

# @gestaltrun/dsh-im-dingtalk

English | [中文](README.zh.md)

## Summary

Use this package to connect installed DingTalk Workspace CLI employee profiles to the product IM runtime. Each configured account keeps the exact `corpId:userId` profile, and every identity-sensitive command passes that profile explicitly. A listener becomes running only after DWS prints its public ready marker. DWS asynchronous sends remain unknown until the status command returns a final message id.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install DWS `1.0.61` or later, complete employee OAuth outside DSH, then mount Subprocess, `@gestaltrun/dsh-im-runtime`, and this package. Account setup selects one value returned by `listAccountCandidates`; it does not accept tokens and does not change DWS's current profile.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@gestaltrun/dsh-im-runtime'
- name: '@gestaltrun/dsh-im-dingtalk'
  config:
    dwsPath: dws
    home: /home/operator
    cwd: /srv/dsh
    graceMs: 5000
    commandTimeoutMs: 15000
    readinessTimeoutMs: 30000
    maxOutputBytes: 1048576
    maxLineBytes: 1048576
    conversationPageSize: 100
```

| Field | Default | Meaning |
|---|---:|---|
| `dwsPath` | `dws` | Absolute executable or bare command resolved by the Subprocess provider. |
| `home` | OS login home | Explicit child `HOME` containing DWS profile state. |
| `cwd` | current directory | Child working directory. |
| `graceMs` | `5000` | Managed process termination and quiescence bound. |
| `commandTimeoutMs` | `15000` | Batch command deadline. |
| `readinessTimeoutMs` | `30000` | Deadline for the exact `[event] ready` marker. |
| `maxOutputBytes` | `1048576` | Per-stream batch output cap. |
| `maxLineBytes` | `1048576` | NDJSON and diagnostic line cap. |
| `conversationPageSize` | `100` | Conversation discovery page size from 1 through 100. |

`listAccountCandidates` reads `dws profile list --format json` and requires the stable selector to equal `corpId:userId`. `inspectAccount` reads the profile status without refreshing it. `refreshAccount` runs `dws auth status --profile <exact> --format json`, verifies returned organization and employee facts, and never changes the ambient current profile. Only explicit status facts become ready, expired, or revoked; missing status and generic command errors remain failed checks.

Conversation discovery retains the DingTalk `openConversationId` for both group and direct conversations. DWS direct sending separately requires the peer `openDingTalkId`; the listener retains both fields from direct message events rather than replacing the conversation identity with its recipient.

One public `event consume` process subscribes to `user_im_message_receive_at`, `user_im_message_receive_o2o_all`, and `user_im_message_receive_group_all`. This covers every applicable current and future direct or group conversation. The parser accepts only the pinned flattened message fields, derives mention evidence only from the at-me event key, and relies on DWS's ordinary self-loop filter before attributing a frame to an external actor. It never parses message text for mention or sender facts.

Group send passes the real conversation id, text, runtime request id, AI tag, and exact profile to `chat message send`. An `openTaskId` is an uncertain receipt. `confirm` calls `chat message query-send-status` and reports sent only when a success status includes `openMessageId`; explicit failure remains failed, and every incomplete or lost result remains unknown without a second send.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The reviewed DWS source is pinned at [`50eb73a0906c5911c5c25f9c7106b6ead4f14f62`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/tree/50eb73a0906c5911c5c25f9c7106b6ead4f14f62). Its [message output DTO](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/event/personal/output.go#L24-L43) gives mention, all-direct, and all-group events the same stable message and conversation identifiers. The [listener facade](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/app/event_listen_im.go#L44-L139) defines the all-conversation event keys and delegates to the ready-marked NDJSON lifecycle. The [send command](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/helpers/chat.go#L3290-L3352) distinguishes group conversation ids from direct peer ids and documents status confirmation.

The process layer resolves and starts DWS only through `ctx.subprocess`, bounds batch output and stream lines, gates readiness on stderr, serializes inbound handling, and awaits managed-range quiescence during teardown. Captured output is never copied into provider diagnostics.

| Source | Purpose |
|---|---|
| `src/config.ts` | Process, output, readiness, and page limits |
| `src/process.ts` | Common Subprocess execution and stream lifecycle |
| `src/protocol.ts` | Strict public JSON, NDJSON, identity, mention, and receipt parsing |
| `src/client.ts` | Exact public DWS argv and capability probe |
| `src/transport.ts` | Runtime transport registration and durable page delivery |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product IM runtime](../im-runtime/README.md) — durable accounts, routes, pages, provider cursors, and outbox behavior
- [Subprocess](../../packages/subprocess/subprocess/README.md) — managed child-process ranges and quiescent teardown
- [IM migration decision](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.md) — product package ownership and Provider requirements

-----

<a id="model-experience"></a>
## Model Experience

Indirect. This package supplies provider messages and send results to the product runtime. It registers no model tool or prompt and cannot submit an Agent turn by itself.

#### KV Cache effect

None; profile checks and event consumption do not assemble a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The product package never reads real profiles or messages during build, tests, or Loader smoke. Real employee access, sends, status confirmation, and GUI acceptance require a separately authorized test scope.
- The current runtime interface cannot durably retain the direct peer `openDingTalkId` with the route, so direct outbound is rejected instead of using the conversation id as the wrong recipient type.
- A group message can appear first on the all-group subscription and later on the at-me subscription. The current runtime deduplicates the second frame but cannot yet supplement its durable mention evidence. Mention-trigger acceptance remains pending the runtime's monotonic evidence update.
- A DWS stream that exits after readiness is terminated and logged by the Provider, while the current runtime listener interface cannot observe that later completion to publish reconnecting or failed state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Migration provenance, the reviewed DWS commit, license, and source paths are recorded in `UPSTREAM.json`. Build the product runtime first, then run this package's test, typecheck, and build scripts. `smoke:loader` uses a synthetic executable and local JSON storage; it must never point at an operator's DWS home.

</details>
