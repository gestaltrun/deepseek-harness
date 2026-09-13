---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.

For an ODD technical scheme, the existing scheme owner defines the research question and receives the result. Reuse its assigned research subagent; an agent already executing that research need not delegate it again. Search maintained open-source implementations and dependencies, compare the required behavior and public extension points, and record exact source references, maintenance evidence, license/distribution obligations, and integration cost. Distinguish reference-only ideas from dependency adoption, plugin composition, and retained local implementation. Return a recommendation, evidence gaps, and implications for the scheme/specification; adoption decisions remain with ODD and the upstream-integration workflow.
