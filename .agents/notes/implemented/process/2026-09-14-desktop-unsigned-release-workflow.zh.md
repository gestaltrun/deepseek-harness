# Agent Note：Windows 未签名手动安装包工作流

状态：已实现

[English](2026-09-14-desktop-unsigned-release-workflow.md) | 中文

## 问题

Windows 安装诊断有时需要完整的 Desktop 载荷，但没有 EV Token。签名发布任务必须在证书或硬件私钥不可用时继续快速失败，同时本地未签名安装包不能被当作更新发布。

## 决策

手动 Desktop Release 工作流新增独立的 `windows-unsigned` 操作。它要求源提交已包含在 `master` 中并使用 `test` 部署，在受控 Windows runner 上运行现有的未签名 Windows 打包命令，并且只把 `unsigned-artifacts/` 中的安装包上传为工作流产物。该操作不会获得签名或 OSS 凭据，不会生成完成记录或更新元数据，也不能进入 OSS 或 GitHub Release 发布任务。签名 Windows 打包仍由独立任务执行，并保留原有的证书、Token 和 SignTool 要求。

六个已签名上传调用会把 `--phase` 直接传给包脚本。多余的参数分隔符会使 pnpm 向解析器转发一个字面量 `--`；删除它可以在不改变上传阶段的情况下，让不可变内容继续先于频道元数据上传。

## 结果

审阅者可以从仅限测试的工作流运行中获取可复现的 Windows 安装包进行手动安装，而不会削弱签名发布检查或创建更新 feed。Actions 产物遵循工作流保留期限，并不是 OSS 发布对象。生产分发仍必须使用签名的 `publish` 操作。

## 备选方案

**让未签名模式进入签名 Windows 任务。** 这会把无证书和签名凭据混在同一条路径中，更容易忽略签名器缺失。

**把未签名文件上传到 OSS。** 未签名路径没有更新元数据和完成记录，上传到 OSS 会创建不受支持的更新面，并混淆手动安装产物与发布频道。
