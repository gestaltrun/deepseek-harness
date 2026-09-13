# Rejected-request records

Rejected decisions prevent repeatedly proposing the same unsuitable feature. In DSH, [Agent Notes](../../notes/README.md) own these records. Use the rejected-note format and [dsh-archive-agent-notes](../dsh-archive-agent-notes/SKILL.md) for retention, supersession, and archival; do not create a second `.out-of-scope/` knowledge base.

## During triage

Read relevant active rejected decisions by concept, including different names for the same request. Surface the prior decision with its current rationale and ask whether it still applies only when the user's direction has not already settled that choice. Archived notes are historical evidence, not current policy.

If the feature already exists, point to its implementation instead of recording a rejection. Distinguish a durable rejection from a temporary deferral. A decision merits a retained note when it prevents a plausible future mistake; do not create a permanent record for every closed issue.

## Record and reconsider

For an accepted rejection, update the existing concept's active record or create the required note with its decision, rationale, and relevant issue references. Follow the note's metadata and bilingual rules. Posting an external explanation or closing an issue requires the applicable user authorization; a local decision record alone does not authorize those actions.

When the decision changes, record the accepted successor and classify the previous record under the Agent Note lifecycle. Do not automatically delete it, edit a frozen archive, or reopen historical issues. Preserve partial decisions that still constrain future work and remove rejected records only under the repository's retention rules.

In a repository with an established `.out-of-scope/` convention, retain that existing owner and its format. DSH's imported triage workflow uses Agent Notes.
