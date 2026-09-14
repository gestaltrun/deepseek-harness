# Agent Note: Select static workflow owner tests without packaging

Status: implemented

English | [中文](2026-09-14-static-workflow-ci-ownership.zh.md)

## Problem

A test stored under an application can inspect only a GitHub workflow. Treating every such test as an application change selects the complete Desktop test set, product assembly, and both platform jobs even though no packaged input changed.

## Decision

The fork CI planner keeps a reviewed explicit table from a workflow to tests that inspect repository text. It recognizes a complete workflow-owner pair before package ownership, runs those tests and lints a changed owner in the quality job, and leaves build, product, and Desktop jobs unselected. As a guard on each listed test, the planner rejects TypeScript-discoverable relative, private-alias, and workspace-package imports; review remains responsible for dynamic reads and subprocess behavior. Source files, manifests, assets, shared fixtures, lockfiles, submodules, and tests outside the table retain their existing package and consumer selection.

The workflow and every listed owner must exist together. A partial pair fails planning. Removal of the complete pair falls through to the existing before-and-after owners, so it expands rather than disappearing from the plan. A rename retains that conservative removal and rejects the new workflow path until it receives an explicit owner mapping. Changes to the planner, runner, registered repository policy, or their fixed regressions select the complete fork CI regression set. The job summary records one bounded reason for each selected or skipped job; the artifact retains the complete plan.

## Alternatives considered

**Treat every test-only application change as quality-only.** Rejected because application tests can import runtime code or shared fixtures and therefore own product behavior.

**Keep every application test on full Desktop and product checks.** Rejected because an explicitly reviewed workflow-text owner cannot change packaged inputs and its real release behavior remains verified by the signed release workflow.

**Infer ownership from arbitrary test imports.** Rejected because dynamic reads and subprocesses prevent a general import graph from proving ownership. The reviewed table stays explicit; import scanning is only an additional guard against an evident package-code dependency.

## Consequences

A Desktop Release workflow edit and its mapped static test run through quality without rebuilding the product. The fixed aggregate still rejects a missing, failed, cancelled, or unexpectedly executed job. Adding an owner requires a reviewed table entry and focused positive, deletion, rename, unknown-path, shared-fixture, and planner-self regression cases.
