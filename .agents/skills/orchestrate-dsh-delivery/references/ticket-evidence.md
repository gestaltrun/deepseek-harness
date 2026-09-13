# Ticket evidence before human acceptance

Use this reference when ODD verifies a combined candidate with product-visible GUI behavior. [record-browser-gif](../../record-browser-gif/SKILL.md) owns capture, encoding, artifact validation, and publication. Start recording during combination verification, before the main session and UI design session approve the candidate for the user's acceptance.

## Record and attach

The existing Delivery/environment owner walks the real supported product route and records its result, using the acceptance criteria and runtime observations supplied by Quality. Keep one input driver per instance and one scenario run per storyboard. Native Desktop work uses [dsh-desktop-test-instance](../../dsh-desktop-test-instance/SKILL.md); Web footage cannot substitute for required Electron behavior. An upstream A/B comparison keeps separate baseline and candidate recordings with their respective identities.

Associate every GUI ticket with evidence for its acceptance criteria. A shared end-to-end GIF may cover several tickets when each ticket identifies its demonstrated steps and expected results; a separate recording session per ticket is unnecessary. Record the exact source/artifact identity, environment and transport, initial state, scenario steps, expected and observed outcomes, GIF link, and limitations. Include the frozen UI draft and complementary checks for behavior the GIF cannot show.

Attach or link the verified GIF from the owning ticket using the authorized tracker workflow. For a remote ticket, a local absolute path alone is not attached evidence: verify that the recorded link is retrievable through the intended reviewer's access path. For a local ticket, retain a durable artifact path the reviewers can read. A pending upload is an explicit incomplete evidence item. A task without tickets uses its accepted demand record rather than creating tickets solely to store media.

## Review in the existing sessions

The main ODD session watches the recorded states and checks each ticket's acceptance criteria, expected outcomes, and contribution to the complete experience route. Combine this with the owning tests and runtime observations. Record pass, fail, or evidence missing per criterion; an author's report or a visually plausible GIF does not establish complete implementation.

The original UI design session reviews the same candidate against the frozen draft, including layout, controls, text, interaction states, and affected locale/viewport requirements. Supplement the GIF with exact screenshots or the live instance when detail is unreadable. Record fidelity pass, fail, or evidence missing with the draft reference and concrete discrepancies. This is design acceptance, separate from the later independent Standards/Spec code review.

Reuse the original reviewers and implementation owners for corrections. If the UI design owner cannot continue, hand its accepted draft and decisions to an explicitly assigned replacement and record the handoff. If no UI draft is relevant to the change, document that applicability decision and have the existing UI owner review the accepted interaction requirements; do not silently treat missing design evidence as a pass.

Present the candidate to the user only after the main session's functional review and the applicable UI design review pass and the ticket evidence is accessible. Include those conclusions, the linked GIFs, exact candidate identity, live route, and known limits. The user then performs acceptance; no final code-review prerequisite is added to this initial handoff.

## Refresh affected evidence

A fix, conflict resolution, or replaced candidate that changes a demonstrated state requires updated evidence and the affected functional/fidelity review before user reacceptance. Preserve old GIFs and their original provenance as history. The final PR recording separately obeys the recording skill's exact live-head publication checks; do not relabel an earlier ticket recording as a newer commit.
