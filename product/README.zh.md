# 产品工作区

[English](README.md) | 中文

## 概述

产品包使用这个独立的 pnpm 工作区和已发布的 DSH 对等依赖。使用 `pnpm --dir product install --frozen-lockfile --ignore-scripts` 安装依赖。工作区把 Zod 固定为 `4.4.3`，使产品 schema 与已发布 DSH schema 接口解析到同一实现。默认 `build`、`test`、`typecheck` 和 `pack` 脚本包括 [Model Center](model-center/README.zh.md)、IM Runtime、钉钉与旺旺 Provider、API 和 UI；`test` 还运行产品构建辅助检查，`pack` 包括 IM bundle。

## 目录

- [IM 构建输入](#im-build-inputs)
- [开发备注](#dev-note)

<a id="im-build-inputs"></a>
## IM 构建输入

[已认可的 IM 架构](../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) 分配运行时、API、UI 和分发职责。`tsconfig.host.json` 与 `tsconfig.client.json` 分别选择独立编译面。产品源码导入通过共享基础配置解析；Client Remote 导入消费 Host 生成的产物。

`pnpm --dir product run build:im-api` 依次构建运行时、两个平台 Provider、API Host、生成的 Remote 产物和 API Client。`pnpm --dir product run pack:im-api` 执行相同构建，并把运行时和 API npm 归档写入 `product/dist`。

`pnpm --dir product run build:im` 在运行时/API 顺序之后增加 UI 构建。`pnpm --dir product run pack:im-bundle` 构建这些包，并把它们和[配置 bundle](im-bundle/README.zh.md)一起打包。`typecheck` 在检查所有产品包前准备生成的 Remote 声明。bundle 定义已安装 profile 的检查和当前组合限制。

构建 IM 运行时和 API Host 后，运行 `pnpm --dir product run generate:im`。所有引用的工作区成员及其已安装对等依赖都必须存在；缺少输入会使命令失败。它在 API Client 和 UI 构建之前生成 API 包的 Host 反射及 Remote Client 产物。`pnpm --dir product run test:build` 使用真实已发布的 npm 声明验证该构建步骤。

构建后，`pnpm --dir product run smoke:im-loader` 检查通过包名进行的 Loader 发现、生成反射、公开 RPC 输入校验和资源释放。`DSH_IM_SMOKE_INSTALL_ROOT` 为相同检查选择独立安装的消费者。[API 包](api-im/README.zh.md) 定义配置及 Client 生命周期冒烟检查。

`DSH_IM_SMOKE_INSTALL_ROOT=<installed-consumer> pnpm --dir product run smoke:im-agent-profile` 使用公开 `dsh` CLI 创建私有且基于 base 的 profile，安装已构建的运行时归档，并通过随附的 `standard` preset 运行一次确定性 IM 准入。检查会匹配归档、已安装运行时与消费者入口的哈希，并使用合成 Provider 与脚本 LLM 验证自动创建 Agent、历史与发送工具、Session 持久化及一个已结算的 outbox 项。它是离线的已安装 profile smoke，不是录制的 Session replay，也不是真实账号或模型证据。

仓库 snapshot corpus 包含同一运行时自主准入路径的 Web authored replay。合成 transport 仅通过 `receivePage` 提交一页消息；产品运行时创建唯一根 Session，随附的 `standard` preset 使用三次脚本模型响应，依次执行历史查询、发送和最终回复。adapter 比较完整 Session、system prompt 与工具 schema，并单独检查已发送的 outbox 项。这个无密钥场景不使用真实账号或模型。

固定版本 `@deepseek-ai/dsh-typert-generator@0.1.5-rc.2` 要求项目位于 `packages` 目录，并注册协议声明项目。构建辅助程序把未修改的产品源码和已发布的协议声明复制到私有临时编译工作区。它只生成 IM API 包，保留正式包导入和相对于包的声明映射，拒绝空输出或私有绝对路径，并在生成后删除编译工作区。生成的诊断源码位置使用该编译工作区内的相对包路径。运行时包不包含生成器或复制的协议声明。

<a id="dev-note"></a>
## 开发备注

无。
