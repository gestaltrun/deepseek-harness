# Agent Note: 每次 Desktop 发布都打包未签名 Windows

Status: implemented

[English](2026-09-15-desktop-unsigned-windows-required.md) | 中文

本决策修正 [未签名 Windows 工作流](2026-09-14-desktop-unsigned-release-workflow.zh.md) 和 [Gestaltrun Desktop 发布路径](2026-09-14-gestaltrun-desktop-release.zh.md)。

## Problem

Windows 用户需要在每个 Gestaltrun 版本中获得完整的 Desktop 安装包。硬件 EV 签名器经常不可用，因此签名 Windows 任务不能作为必选发布目标。独立的 `windows-unsigned` 操作允许在 `candidate` 和 `publish` 运行中完全跳过 Windows。

## Decision

每次 Desktop Release 的 `candidate` 和 `publish` 运行都会打包未签名 Windows x64 安装包，以及必选的已签名 macOS arm64 和 macOS x64 目标。未签名任务使用 GitHub 托管的 `windows-latest`、现有未签名打包命令和 `desktop-dry-run`。它仍然省略签名凭据。它会写入更新元数据和完成记录，并且 `publish` 会把该安装包上传到所选 OSS 更新 feed。

生产 `publish` 还会把该安装包附加到 `gestalt-v<version>` GitHub Release。签名 Windows x64 仍是显式的 `include_windows` 任务，并保留原有的证书、Token 和 SignTool 要求。选择签名 Windows 时，其产物会替换同一 `win-x64` OSS 前缀中的未签名 Windows 对象。

独立的 `windows-unsigned` 操作已退役。`validate` 仍然不打包任何产物。

## Alternatives considered

**保留独立的 `windows-unsigned` 操作。** 操作者可以在用户实际消费的发布路径上跳过 Windows。

**要求每次发布都打包签名 Windows。** 缺少 EV 硬件会阻断 macOS 和 GitHub Release 发布。

**不把未签名 Windows 放入 OSS。** Windows 用户会得到 GitHub Release 安装包，但在没有 EV 签名器时没有应用内更新频道。

## Consequences

未签名 Windows 打包失败时，`candidate` 或 `publish` 运行会失败。所选 OSS feed 始终包含 Windows 安装包。自动更新会使用该未签名安装包，直到签名 Windows 目标替换同一组 `win-x64` 对象。
