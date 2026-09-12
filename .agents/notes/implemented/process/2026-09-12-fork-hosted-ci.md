# Agent Note: Hosted CI configuration for independent repositories

Status: implemented

English | [中文](2026-09-12-fork-hosted-ci.zh.md)

## Problem

Independent repositories cannot schedule jobs on another organization's private runner fleet. The primary Linux and Windows jobs need reachable runners, while the serial Linux browser setup and Windows package store need to work on ephemeral images.

## Decision

The primary jobs accept `DSH_CI_LINUX_RUNNER` and `DSH_CI_WINDOWS_RUNNER` as their hosted fallback labels. The existing [failover switches](2026-07-26-ci-failover-runbook.md) retain precedence, including the Dependabot exclusion from persistent runners. The serial master jobs accept `DSH_CI_LINUX_SERIAL_RUNNER` and `DSH_CI_WINDOWS_SERIAL_RUNNER`; empty values preserve the self-hosted standby pools. Their displayed names identify the selected runner. Hosted Linux installs Playwright system dependencies, and hosted Windows puts its pnpm store in runner temporary storage instead of requiring the fleet's ReFS volume.

`DSH_CI_GATE_CONCURRENCY`, `DSH_CI_COVERAGE_WORKERS`, `DSH_CI_PUBLINT_CONCURRENCY`, and `DSH_CI_SNAPSHOT_CONCURRENCY` configure parallelism for the primary jobs. Empty values preserve each job's existing budget. The repository variables configure capacity without removing tests, changing failure predicates, or marking missing credentials as success. Manual runner benchmarks retain their original machine tiers; a standard hosted result cannot represent a private 16–96-core pool.

## Alternatives considered

**Replace every runner label.** This would remove the operational failover choices and change the meaning of the benchmark matrix. Explicit fallback and serial-job variables preserve those choices.

**Skip jobs that cannot find a runner.** This would lose the build, coverage, and platform evidence. Configuring reachable runners keeps the same executed checks.

## Consequences

A repository can run the primary and serial jobs without registering the upstream fleet. Hosted images have different resource limits, so their parallelism needs an explicit budget. A hosted serial result proves the code on that image and does not prove self-hosted standby readiness. External provider tests and publication still require their own credentials and authorization. The workflow regression tests exercise configured labels, default pools, both failover modes, and Dependabot fallback.
