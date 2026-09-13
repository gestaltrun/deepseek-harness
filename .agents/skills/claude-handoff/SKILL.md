---
name: claude-handoff
description: Hand the current conversation off to a fresh background agent that picks up the work immediately.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a concise handoff for the explicitly requested next agent. Verify the target harness and installed CLI capability before using the upstream Claude example `claude --bg --name "<name>" "<summary>"`. In DSH/Codex use the available subagent/handoff mechanism within ODD ownership. Create a user-owned Codex task only when the user explicitly requests one; do not turn a background subtask into a sidebar task automatically.

When using the verified Claude CLI path, pass `-n`/`--name` with a descriptive name (e.g. `--name "Fix login bug"`); it sets the display name shown in the job list, session picker, and terminal title.

Include a "suggested skills" section in the summary, linking the installed skill instructions the next agent should read and use within their invocation policies.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information, since the summary becomes the agent's prompt.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the summary accordingly.
