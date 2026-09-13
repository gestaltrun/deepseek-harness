# Codex CUA availability evidence

Use this reference when a Desktop route selects Codex computer use. Establish the evidence lane before the isolated Electron lifecycle in [SKILL.md](SKILL.md). The current service's tool documentation owns its connection and first-call protocol.

## Evidence levels

Record the highest independently observed level; a level does not establish the next one.

| Level | Completion condition |
| --- | --- |
| `configured` | An enabled CUA integration is configured; any inspected transport information is non-secret. |
| `connected` | The selected supported client connects and obtains the service's tool directory. |
| `registered` | The client exposes those discovered tools to the active session. |
| `native-callable` | A supported agent/app-server turn makes the service-directed read-only native call successfully. Required turn metadata comes from that runtime. |
| `background-accepted` | That callable session completes the requested user-level route in the isolated Electron, records the result, and verifies background operation when required by the scenario. |

Configuration, connection, a tool directory, or kernel startup does not prove native control. Record the actual available tools for this run; do not require a historical tool list. Invoke `js`, reset, or another entry only as its current instructions specify.

## Connection and calls

Inspect only enabled configuration and necessary non-secret transport fields. Never display or persist credentials, private session logs, or environment values. Evidence can name relevant configuration keys, error categories, run-owned process identities, and cleanup results.

Use the supported MCP client or formal agent execution entry for the selected environment. An already callable host integration needs no separate probe client. A client using the existing DSH dependency graph can test registration without introducing a second Cordis instance; that alone does not prove a native turn.

When the service requires `session_id` or `turn_id`, use values supplied by its formal turn manager; never invent or replay them. A host that injects this metadata internally does not require the agent to expose it. Follow the returned first-call instructions exactly. A successful read proves only the state observed by that call, not acceptance of the whole product route.

## Failure handling

A denied required action stops that path under the current scope. Distinguish denied approval from a host whose policy disables interactive prompts but already permits the requested operation. Follow the current host's sandbox and permission rules; do not change an execution mode to evade a denial. If required turn metadata or a native-callable tool is absent, report the highest proved level and the missing capability. Re-evaluate only when the available capability or authorized scope changes.

Dispose only processes started by this run and verify their recorded identities have exited. Never target unrelated processes by a broad name or command-line pattern.

## Evidence choice

Without native-callable evidence, report the diagnostic and retain other valid evidence. Do not create a new user-owned task merely to obtain a turn. Use an alternative driver only within the accepted runtime scope, through the same isolated lifecycle, and state its identity. An explicitly requested Codex native or background path needs that evidence; a Web page, fixture, MCP registration, or different driver cannot silently substitute for it.
