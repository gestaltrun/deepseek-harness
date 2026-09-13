# Desktop comparison

Use this reference when an upstream decision changes an affected supported Desktop route or the user asks for a side-by-side Electron comparison. Keep one frozen product baseline and one candidate. Test later alternatives by replacing the candidate only after its identity and evidence are saved. A missing supported Desktop route is a reported comparison gap, not permission to substitute Web, Mobile, a fixture, or another driver for the requested Electron evidence.

## Establish the named pair

Follow [`dsh-desktop-test-instance`](../../dsh-desktop-test-instance/SKILL.md) in comparison mode. Use one accountable acceptance-environment owner and two named memo records, `baseline` and `candidate`. Each record has an independent application path, `DSH_HOME`, Electron user-data directory, writable profile and plugin installation, logs, scratch data, ports, and dependent processes. Shared inputs must be immutable. Verify each window is attached to its own Host and runtime; two windows backed by one service are not an isolated pair.

Record exact source commits, plugin and wrapper revisions, package versions, artifact digests, application paths, installed and loaded locations, profiles, launch mode, processes, ports, state roots, environment choices, scenario, input owner, and evidence paths. Preserve application signatures and do not rewrite bundle metadata to label A and B.

Use equivalent independently seeded data and the same route, locale, provider/model references, configuration parameters, and relevant external-service conditions. Keep fixture, live-provider, source-run, CI-artifact, and packaged-product evidence explicit. Copy credentials only within existing authorization and never record values.

## Compare the route

Define each route step with its starting state, action, expected result, and the difference under review. Cover affected existing behavior as well as the new capability. Walk both applications through native user input before handoff, capture the actual screens and results, and record backend or artifact observations needed to explain the visible result. Repeat a materially uncertain nondeterministic result under comparable conditions; performance claims use the owning performance workflow.

Give the user both application paths, baseline and candidate identities, starting states, the common route, known differences, and unresolved limits. Keep the pair running for review. Only the recorded owner drives the applications, and only one side receives input at a time.

## Revise and retire

Preserve the baseline while revising the candidate. Save the candidate's evidence and identity before replacement, then re-run every affected route step. A newer upstream revision is a new candidate and does not relabel existing evidence.

After comparison or an explicit cleanup request, retain evidence outside disposable roots, stop only the recorded processes for the named side or pair, verify ports and resources are released, and remove only those exact scratch paths. Preserve uncommitted user work and shared resources. Report route and teardown results separately.
