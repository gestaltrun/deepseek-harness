# Agent Note: 独立仓库的托管 CI 配置

Status: implemented

[English](2026-09-12-fork-hosted-ci.md) | 中文

## Problem

独立仓库无法在另一组织的私有 runner 集群上调度任务。主要 Linux 和 Windows 任务需要可用的 runner，而串行 Linux 的浏览器安装和 Windows 的包存储需要适配临时镜像。

## Decision

主要任务使用 `DSH_CI_LINUX_RUNNER` 和 `DSH_CI_WINDOWS_RUNNER` 指定托管后备标签。现有[故障转移开关](2026-07-26-ci-failover-runbook.zh.md)仍优先，包括禁止 Dependabot 使用持久 runner 的限制。master 串行任务使用 `DSH_CI_LINUX_SERIAL_RUNNER` 和 `DSH_CI_WINDOWS_SERIAL_RUNNER`；空值保留自托管备用池。显示名称标明选定的 runner。托管 Linux 安装 Playwright 系统依赖，托管 Windows 将 pnpm 存储放在 runner 临时目录，不要求集群使用的 ReFS 卷。

`DSH_CI_GATE_CONCURRENCY`、`DSH_CI_COVERAGE_WORKERS`、`DSH_CI_PUBLINT_CONCURRENCY` 和 `DSH_CI_SNAPSHOT_CONCURRENCY` 配置主要任务的并行度。空值保留各任务原有预算。仓库变量调整容量，不移除测试、不改变失败条件，也不将缺少凭据标记为成功。手动 runner 基准保留原有机器档位；标准托管机器的结果不能代表私有的 16–96 核池。

## Alternatives considered

**替换全部 runner 标签。** 这会移除运维故障转移选项，并改变基准矩阵的含义。显式后备变量和串行任务变量保留这些选项。

**跳过找不到 runner 的任务。** 这会丢失构建、覆盖率和平台证据。配置可用 runner 保留相同的执行检查。

## Consequences

仓库无需注册上游集群即可运行主要任务和串行任务。托管镜像的资源限制不同，因此并行度需要明确预算。托管串行结果证明代码在该镜像上的表现，不证明自托管备用池已经就绪。外部提供者测试和发布仍需各自的凭据与授权。workflow 回归测试覆盖指定标签、默认池、两种故障转移模式及 Dependabot 后备选择。
