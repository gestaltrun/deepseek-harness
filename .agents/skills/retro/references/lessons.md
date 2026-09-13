# Retrospective lesson archive

Use this reference after the user accepts a retrospective candidate. Record only kept items from the current owner's reported evidence. Candidate proposals and dropped items do not enter the archive. Preserve the normal implementation and verification workflow for any accepted code or instruction edit.

## Storage

Use gitignored `.agents/local/lessons/` in the current repository. Create it when the first kept item is recorded. `index.json` contains a `lessons` array; each entry has `id`, `skill`, `phase`, `count`, `lastSessionId`, `lastHarness`, and `lastAt`. Record the observed session/harness identity and timestamp without copying private logs or secrets.

The first occurrence creates one Markdown file at `<skill-or-phase>/<yyyy-mm-dd>-<id>.md`. Include its harness, session id, skill/phase, observed evidence, and accepted lesson. Use the existing id for the same lesson rather than renaming it on each run.

A repeated id increments `count` and updates `lastSessionId`, `lastHarness`, and `lastAt`; it does not create another Markdown file. Record each accepted occurrence once. Keep existing entries and serialize index updates through one assigned writer when several delivery owners report lessons together.

## Completion

Verify that the index parses, the affected id has its retained first-occurrence file, and the occurrence/count metadata reflects the accepted result. Keep the archive outside Git and report its local path to ODD. Local lesson retention does not read another session's history, change global memories, or authorize further edits beyond the user's keep/drop decision.
