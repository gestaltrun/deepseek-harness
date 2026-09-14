# 产品工作区

[English](README.md) | 中文

## 概述

产品包使用这个独立的 pnpm 工作区和已发布的 DSH 对等依赖。使用 `pnpm --dir product install --frozen-lockfile --ignore-scripts` 安装依赖。`build`、`test`、`typecheck` 和 `pack` 脚本选择 [Model Center](model-center/README.zh.md)；对应命令和运行时行为由该包定义。

## 目录

- [IM 构建输入](#im-build-inputs)
- [开发备注](#dev-note)

<a id="im-build-inputs"></a>
## IM 构建输入

[已认可的 IM 架构](../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) 分配运行时、API、UI 和分发职责。`tsconfig.host.json` 与 `tsconfig.client.json` 分别选择独立编译面。产品源码导入通过共享基础配置解析；Client Remote 导入消费 Host 生成的产物。

构建 IM 运行时和 API Host 后，运行 `pnpm --dir product run generate:im`。所有引用的工作区成员及其已安装对等依赖都必须存在；缺少输入会使命令失败。它在 API Client 和 UI 构建之前生成 API 包的 Host 反射及 Remote Client 产物。`pnpm --dir product run test:build` 使用真实已发布的 npm 声明验证该构建步骤。

固定版本 `@deepseek-ai/dsh-typert-generator@0.1.5-rc.2` 要求项目位于 `packages` 目录，并注册协议声明项目。构建辅助程序把未修改的产品源码和已发布的协议声明复制到私有临时编译工作区。它只生成 IM API 包，保留正式包导入和相对于包的声明映射，拒绝空输出或私有绝对路径，并在生成后删除编译工作区。生成的诊断源码位置使用该编译工作区内的相对包路径。运行时包不包含生成器或复制的协议声明。

<a id="dev-note"></a>
## 开发备注

无。
