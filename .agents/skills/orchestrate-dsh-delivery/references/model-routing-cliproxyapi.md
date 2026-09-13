# CLIProxyAPI delivery model routing

Use this mapping only when the user permits `cliproxyapi` and the live catalog confirms the exact id and required capabilities. The root has no fallback and never routes or changes itself.

| Role | Priority |
| --- | --- |
| UI | `kimi-k3` > `gpt-6-astra` > `grok-4.6` |
| Scheme and simplification | `gpt-5.6-sol` > `grok-4.6`; do not use Kimi K3 |
| Main implementation | `grok-4.6` > `gpt-5.6-sol` > `kimi-k3`; visual frontend work may use the UI chain |
| Quality | `gemini-3.8-flash-high` > `glm-5.3-flash` |
| Delivery | `glm-5.3-flash` > `gemini-3.8-flash-high` |
| Independent code review | Choose a non-primary-author model: Grok author → Sol; Sol or Astra author → Grok; Kimi K3 author → Sol |

Do not use Terra or Luna for this workflow. Reserve Codex spending mainly for Astra and Sol, but do not claim an Astra-exclusive quota. On confirmed quota exhaustion or route unavailability, use the next available candidate in that role's priority order. Keep quota exhaustion, rate limiting, authentication, network transport, and code failure as distinct diagnoses; rate, auth, network, or code failure requires diagnosis rather than automatic downgrade.

Prefer a safe turn-boundary model change in the same stable owner session when the host explicitly supports it. Otherwise report the limitation and let the root decide whether independence or capability justifies replacement; do not create fresh sessions automatically. `send_message` cannot switch provider/model or cwd. A host model switch may persist as the user's global default, so verify scope before using it. Do not implement or imply a product router, automatic failover, static account count, or credential inspection.
