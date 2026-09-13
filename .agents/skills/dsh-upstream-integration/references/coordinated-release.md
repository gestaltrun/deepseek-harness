# Coordinated Gestaltrun release

Use this reference when one Gestaltrun mainline demand changes more than one Gestaltrun repository, including a forked external engine, its DSH wrapper, community-plugin composition, or the main product. Only repositories affected by that demand join the release set. Their versions may differ; the shared record binds the exact compatible revisions and artifacts.

## Build the release set

Keep each repository's own history, checks, package ownership, and release mechanism. Add one release-set row per affected repository or product unit, ordered by dependency. Record repository, role, dependency rows, exact source and fork commits, package or product version, candidate artifact identity and digest, adoption decisions, required per-repository CI, required composition and upgrade scenarios, owner, artifact state, promotion state, overall status, and blocker.

Use the existing Product Release Plan and final machine-readable manifest as the release owner when the main product repository provides them. Extend that owner or attach an exact referenced cross-repository record rather than creating a parallel release authority. If its schema cannot carry the required rows, schema support is release work and must land before formal publication; prose in a ticket is not the final release manifest.

Build local and CI candidate artifacts without independently publishing stable child packages. Every repository passes its required checks at the recorded revision. The assembled product then installs the exact candidate artifacts by digest and passes its real composition, supported-platform, and upgrade checks. A branch, submodule pointer, upstream CI badge, local link, or package name does not replace this evidence.

## Authorize and publish

Keep the existing explicit per-release authorization stop. One user approval may cover the complete manifest's exact repository, revision, version, artifact, target, and channel set; do not ask again for each child in that unchanged set. A changed artifact, added repository, different channel, or expanded target requires a new or amended approval. Protected Environment approvals and repository release controls still apply.

Publish only after every required candidate and final-composition check passes. Where a registry supports non-promoting or non-default staged publication, create immutable dependency artifacts in dependency order without advancing the public default channel or tag, verify each artifact, and record artifact and promotion progress separately. A staged version can still be publicly visible and must be reported as such. If a required registry or release mechanism cannot stage without default promotion, record a release-implementation gap and resolve it through ODD; do not silently publish to the default channel.

After every required immutable artifact exists and verifies, promote public default channels or tags in dependency order and advance the main product release pointer and final release manifest last. Registry and channel promotions are not atomic. Declare the coordinated release complete only when every required artifact, promotion, and platform row is verified at its recorded identity.

If a later artifact or promotion step fails, preserve every immutable version and record the actual built, staged, publicly visible, published, and promoted state of each row before marking the release set blocked. Do not delete versions, repoint evidence, claim rollback from an unpublished replacement, or mark the product release complete. An unchanged retry uses the same approved manifest identities and the owning repository's supported release mechanism. A superseding manifest binds every changed version or artifact, revalidates affected repository rows plus final composition and upgrade behavior, and obtains amended approval before further publication or promotion.

## Workflow boundary

This repository skill supplies coordination guidance and records. It does not add CI or registry enforcement to another Gestaltrun repository, configure monitoring, publish a package, or perform a release. A delivery that needs mechanical enforcement creates repository-specific work through ODD instead of weakening the release conditions in prose.
