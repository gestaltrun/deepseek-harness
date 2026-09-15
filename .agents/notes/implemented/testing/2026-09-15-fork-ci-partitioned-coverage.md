# Agent Note: Partition family-wide fork CI coverage

Status: implemented

English | [中文](2026-09-15-fork-ci-partitioned-coverage.zh.md)

## Problem

A family-wide version bump selects every package. Fork CI then ran one instrumented Vitest process over the whole inventory. On GitHub-hosted Linux that process reached the heap limit and aborted. Chunking files on argv while repeating every coverage include made the first batch fail the per-file 100% gate. `mergeConfig` also concatenates include arrays, and an empty project include tells Vitest to run the whole suite.

## Decision

Fork CI writes planned files and coverage includes into a workspace `tmp/` Vitest config. Each Vitest project receives only its own files. An empty project gets a non-matching include instead of `[]`. When `DSH_COVERAGE_PARTITIONS` is set and the planned inventory is at least that large, the affected and Windows lanes reuse the existing coverage partition coordinator and merge one thresholded report. Linux uses four partitions; Windows uses two. Desktop, quality, and other lanes keep a single generated config without coverage. Affected Web tests install Chromium without `--with-deps`, because the enterprise Linux runner already has the OS libraries and cannot sudo.

## Alternatives considered

**Raise `--max-old-space-size` and keep one process.** Rejected because the family-wide inventory already exhausted the default heap, and a larger heap still keeps one instrumented process on the critical path.

**Chunk files on argv and merge coverage later.** Rejected because repeating every coverage include on a partial file list fails the per-file 100% gate before any merge.

**Keep coverage off for family-wide fork CI.** Rejected because a version bump still changes package sources that the coverage gate measures.

## Consequences

Family-wide fork CI coverage stays one thresholded report without one process holding every instrumented file. A planned Desktop or quality file list no longer expands to the whole suite. Empty project includes no longer silently rerun the inventory. Affected Web tests no longer ask Playwright to install OS packages.
