# Agent Note：Windows 未签名手动安装包工作流

状态：已实现

[English](2026-09-14-desktop-unsigned-release-workflow.md) | 中文

## 问题

Windows 安装诊断有时需要完整的 Desktop 载荷，但没有 EV Token。签名发布任务必须在证书或硬件私钥不可用时继续快速失败，同时本地未签名安装包不能被当作更新发布。

## 决策

未签名 Windows 打包命令仍与签名 Windows 打包分属不同任务。`candidate` 和 `publish` 会在 GitHub 托管的 `windows-latest` 上运行该任务，写入更新元数据和完成记录，并将安装包保留为工作流产物。该任务不会获得签名凭据。[未签名 Windows 必选决策](2026-09-15-desktop-unsigned-windows-required.zh.md)负责该安装包进入 OSS 的时机，以及生产 GitHub Release 如何附加它。签名 Windows 打包仍由独立任务执行，并保留原有的证书、Token 和 SignTool 要求。

六个已签名上传调用会把 `--phase` 直接传给包脚本。多余的参数分隔符会使 pnpm 向解析器转发一个字面量 `--`；删除它可以在不改变上传阶段的情况下，让不可变内容继续先于频道元数据上传。

## 结果

审阅者可以在每次 `candidate` 和 `publish` 运行中获取可复现的 Windows 安装包，而不会把未签名凭据混入签名 Windows 任务。Actions 产物遵循工作流保留期限。`publish` 还会把该安装包上传到所选 OSS feed。

## 备选方案

**让未签名模式进入签名 Windows 任务。** 这会把无证书和签名凭据混在同一条路径中，更容易忽略签名器缺失。

**在没有更新元数据的情况下把未签名文件上传到 OSS。** 没有完成记录和频道元数据时，上传到 OSS 会创建不受支持的更新面。未签名打包命令现在会在 `publish` 上传安装包之前写入这些文件。
