# Agent Note: 分区运行全家 fork CI 覆盖率

Status: implemented

[English](2026-09-15-fork-ci-partitioned-coverage.md) | 中文

## Problem

全家版本号变更会选中每个包。Fork CI 随后在单个带覆盖率的 Vitest 进程中跑完整清单。GitHub 托管 Linux 上该进程触及堆上限后中止。把文件列表按 argv 分批、同时重复全部 coverage include，会让第一批未覆盖的文件先触发按文件 100% 门槛。`mergeConfig` 还会拼接 include 数组；空的 project include 会被 Vitest 当成跑全集。

## Decision

Fork CI 把计划中的文件和 coverage include 写进工作区内 `tmp/` 的 Vitest 配置。每个 Vitest project 只接收属于自己的文件。空 project 使用不会匹配的 include，而不是 `[]`。当设置了 `DSH_COVERAGE_PARTITIONS` 且计划清单至少有这么多文件时，affected 和 Windows 车道复用现有覆盖率分区协调器，并合并一次带门槛的报告。Linux 使用 4 个分区；Windows 使用 2 个。Desktop、quality 和其他车道继续使用单个生成配置，且不开启覆盖率。

## Alternatives considered

**提高 `--max-old-space-size` 并保持单进程。** 不采用，因为全家清单已经耗尽默认堆，更大的堆仍把单个带覆盖率进程留在关键路径上。

**按 argv 分批文件，稍后再合并覆盖率。** 不采用，因为在部分文件列表上重复全部 coverage include，会在任何合并之前先让按文件 100% 门槛失败。

**全家 fork CI 关闭覆盖率。** 不采用，因为版本号变更仍会改动覆盖率门槛所衡量的包源。

## Consequences

全家 fork CI 覆盖率仍是一份带门槛的报告，但不再由单个进程持有全部带覆盖率文件。计划中的 Desktop 或 quality 文件列表不会再扩展成全集。空的 project include 也不会再静默重跑清单。
