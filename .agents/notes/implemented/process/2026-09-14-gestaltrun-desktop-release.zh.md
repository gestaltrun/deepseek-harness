# Agent Note: 发布 Gestaltrun Desktop 版本

Status: implemented

[English](2026-09-14-gestaltrun-desktop-release.md) | 中文

## Problem

Gestaltrun fork 可以构建完整的 Desktop 与 dsh 单元，但仓库还不能将签名后的各平台产物发布到公开更新源。现有上传路径指向 DeepSeek 基础设施，GitHub 也没有列出 Gestaltrun Desktop 版本。

## Decision

保留现有 Desktop 版本绑定和 `electron-updater` 交互。手动触发的工作流验证准确的提交和版本，使用现有签名要求打包必选的 macOS arm64 和 macOS x64 目标，并将不含凭据的未发布候选保留为工作流产物，不会将其加入更新频道。Windows x64 仍可明确选择，但缺少硬件签名输入时会失败。

签名候选打包和发布只接受已包含在 `master` 中的提交。发布任务通过本仓库专用 OIDC 角色取得短期阿里云凭据，将不可变安装包和 blockmap 上传到专用 OSS 前缀，并在最后替换各目标的标准 generic feed 元数据。测试部署与生产部署使用不同的公开前缀。生产发布还会创建一个 `gestalt-v<version>` GitHub Release，其中包含 OSS 下载链接，因此 GitHub Releases 是面向用户的版本列表。

DeepSeek Gestalt 使用现有参考图标和应用名称。更新协调器、确认对话框、下载流程、Host 停止、安装和重启行为保持不变。

## Alternatives considered

**复制参考 fork 的完整产品发布系统。** 该方案包含本 fork 的 Desktop 发布路径不需要的 Platform、Mobile、恢复和发布计划机制，因此不采用。

**增加自定义更新服务或应用界面。** 标准 generic feed 和当前更新交互已经支持发现与安装更新，因此不增加会与上游行为冲突的版本服务或状态机。

**复用现有私有产品 bucket 或长期 AccessKey。** Desktop 产物需要经过明确控制的公开读取权限，因此使用专用 bucket 和仓库范围的 OIDC 角色来限制发布权限。

## Verification

- 无凭据检查验证触发参数、目标覆盖、产物名称、校验和、对象顺序和版本链接。
- macOS 发布要求签名和公证。选择 Windows 时要求现有的硬件签名输入；省略该目标时，Release 的目标列表只包含 Mac。
- 打包任务不会收到 OSS 凭据，发布任务不会接受 `master` 之外的提交。
- 在替换任何所选频道元数据之前，所有所选目标的不可变载荷都已存在。
- 测试发布不创建 GitHub Release；生产发布创建一个 Release 并更新生产 feed，不增加独立版本服务。

## Consequences

OSS 无法对三个目标的元数据文件执行跨对象事务。发布失败时，较早处理的目标可能已经看到有效更新，而较晚处理的目标仍停留在旧版本；重新运行同一个已验证候选可以修复该状态。缺少签名硬件或凭据时，相应目标会被阻断，不会生成未签名版本。
