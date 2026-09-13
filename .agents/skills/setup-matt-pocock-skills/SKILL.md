---
name: setup-matt-pocock-skills
description: Configure missing repository issue-tracker, triage-role, and domain-document settings, or reconfigure them when explicitly requested. Preserve existing repository owners and policies.
disable-model-invocation: true
---

# Setup Matt Pocock's skills

Inspect the repository's existing setup before creating anything. In DSH, [repository context](../orchestrate-dsh-delivery/references/repository-context.md) already defines how engineering skills discover the tracker, domain documents, and decision owners. A missing generic `docs/agents/` directory does not mean setup is missing. Report an already usable setup without asking the user to choose it again.

## Inspect existing owners

Read the applicable repository instructions, Git remotes, actual tracker metadata, domain glossary, and decision records. Check whether `AGENTS.md` or `CLAUDE.md` is a symlink and identify the real instruction owner. Inspect existing issue types, labels, dependency conventions, and any triage-role mapping before proposing new configuration.

Do not substitute an upstream repository for the product fork's tracker. Monorepo layout alone does not justify a new glossary or ADR system. DSH uses its existing glossary, subsystem documentation, and Agent Notes; preserve their lifecycle and bilingual rules.

## Resolve only missing choices

For a genuinely missing tracker, use the user's accepted choice or recommend the actual project tracker discovered from its configuration. Support GitHub, GitLab, local Markdown, or a described external tracker. Ask only when the remaining choice changes where work will be published. Local investigation and drafting can continue while that choice is unresolved.

If triage roles are needed, map the conceptual roles to existing tracker labels or states. Do not install five default labels over the repository's native issue type and label taxonomy. A label change or external comment must stay within the user's authorized scope.

For domain documents, reuse the existing terminology and decision owners. Create a new owner only when the required information has no suitable home, using the repository's documentation conventions. Do not create parallel `CONTEXT.md` and `docs/adr/` trees in DSH.

## Apply the scoped configuration

Prepare a concrete draft for unresolved policy choices. Already accepted configuration and reversible local edits need no second confirmation. Edit the real instruction owner, preserving symlinks, surrounding user content, and document budgets. Prefer one concise link to the existing repository context over copying its policies into root instructions.

The bundled templates provide examples for missing configuration:

- [issue-tracker-github.md](issue-tracker-github.md), [issue-tracker-gitlab.md](issue-tracker-gitlab.md), and [issue-tracker-local.md](issue-tracker-local.md): tracker operations.
- [triage-labels.md](triage-labels.md): conceptual triage roles.
- [domain.md](domain.md): domain-document consumer rules.

Adapt only the needed portions to the actual repository. Never overwrite ODD's shared repository context with an entire tracker or domain template. Do not enable external PR triage, create remote labels, or replace an existing tracker merely because a template contains those examples.

Verify the affected links and repository documentation checks. Report the configured owners, any unresolved publication choice, and which engineering skills consume the result. Importing these skills does not itself require rerunning setup.
