---
description: "在 Gestaltrun 中管理 CLIProxyAPI 账号和配额观测，并在不修改上游包的条件下构建独立产品 bundle。"
kind: "package-bundle"
---
# 账号池

[English](README.md) | 中文

## 摘要

`@gestaltrun/dsh-account-pool` 在设置中管理供应商账号，并通过既有 LLM（大语言模型）服务提供可选择的池内模型。它支持 Claude、Codex、Antigravity、Kimi、xAI 和 GLM Coding Plan 接入。Desktop 产品组合包含此 bundle，Web 安装显式选择它。账号凭据保存在私有产品存储中，配额刷新不会改变账号调度或消耗 reset credits。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [构建与验证](#build-and-verification)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

账号池设置页拥有登录、账号启停、字段、模型列表、配额刷新和显式凭据文件下载。模型页页脚展示只读路由信息，既有设置导航进入账号管理。未知、不支持、失败和过期配额观测保持区分。

Kimi 的用量汇总对应提供方的[七天配额](https://www.kimi.com/help/kimi-code/benefits)；响应省略窗口元数据时，时间指针使用该周期。有效的显式元数据优先；元数据无效或缺少重置时间时不显示时间指针，显示标签不用于推断周期。

[Bundle 补丁](cordis.patch.yml) 在隔离 scope 中选择本地 subprocess 实现，并把 Desktop 账号存储在 `$DSH_HOME/desktop/account-pool`。Web profile 应用此 bundle 时必须显式选择自己的绝对 `stateRoot` 和凭据导出策略。并发进程不能共享同一状态根。常规 profile/plugin 安装机制拥有 bundle 激活，仅复制目录不会激活它。

凭据导出是一项显式下载操作。OAuth 账号导出 core 拥有的 auth 文件，GLM 账号导出产品凭据 JSON 文档。普通快照、模型设置和 Remote 响应不会返回这些文件内容。GLM 卡片标明供应商级模型列表，并把不可用的健康/历史值显示为未知。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

一个产品包拥有账号服务、core supervisor、私有管理映射、LLM 适配器、Remote 控制器和共享 Client。Go 引擎从 [UPSTREAM.json](UPSTREAM.json) 中的精确来源构建；安装后的二进制、许可证和 manifest（元数据清单）位于包资源中。每代拥有独立 TLS 信任、凭据和取消能力。关停撤回模型路由、等待请求结束、停止所属进程树，并仅删除代次文件。

OAuth 账号文件仍由 core 拥有。GLM 凭据和支持字段拥有私有产品台账，活动子集投影到 core 配置。Journal 保护台账更新，恢复在发布就绪状态前重建已提交台账。GLM 身份是产品引用，不是虚构的 core auth index 或请求计数。

Client 使用类型化操作和拥有 watch 取消及命令生命周期的控制器。源码 DTO 通过仅类型的公共 `./types` 导出。Host/Client 描述符来自原样的公共 Typert 生成器，并使用严格 codec。仅供构建的公开 protocol 声明 rollup 在独立严格 TypeScript 程序中与原声明比较，随后提供给隔离分析项目。正常 Host/Client 编译及运行时解析原始 npm 包；分析输入不进入产物。

[已接受架构](../../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有替代方案和精确的产品专属修改范围。配额解析器是纯观测模块，其来源声明及打包 Client 许可证保留在 [NOTICE](NOTICE)。没有独立运行时 invariant：Host 快照是唯一业务状态来源，生命周期/传输测试验证其外部效果。

</details>

-----

<a id="build-and-verification"></a>
## 构建与验证

独立的 `product/` 工作区安装精确发布版 DSH 依赖。正常编译配置不包含仓库源码别名。产品构建、类型检查和打包命令对照 `UPSTREAM.json` 中记录的已核验基线运行范围检查；有意采用新基线必须显式提供并审阅。

产品构建生成 Host 入口、非空严格 Remote 贡献，并编译 Client module-loader factory。引擎编译与 Node 编译分开。引擎构建器校验 Git 身份，在禁止修改 Go module 的条件下编译，并输出来源/平台/架构/文件名/SHA-256 元数据。包声明 `publishConfig.executableFiles`，让 pnpm 保留资源的执行权限，不暴露 package bin。包准备构建所选主机目标，并把 npm 产物放入 `product/dist`。

原生 Desktop 交互、已认证供应商推理、本地 TLS/SSE 测试和单元 fixture（测试前置数据）属于不同证据路径。假 GLM key 可以验证持久化和管理，不能证明供应商认证。

-----

<a id="model-experience"></a>
## 模型体验

通过注册的 `gestalt-account-pool` LLM 路由间接产生影响。模型选择和 reasoning 默认值在流开始前进入请求元数据。账号凭据及配额观测不会新增模型可见提示词内容，也不改变 Session 格式。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 一个目标产物包含该目标的 Go 二进制，不能证明已发布跨平台版本。
- 真实 OAuth 和已认证推理依赖可用供应商账号及网络。空池启动和 fixture key 不能证明这些结果。
- GLM 支持其声明的产品字段。不支持的账号级能力保持禁用，不由供应商级数据合成。
- 签名 Desktop 发布、公证和更新发布需要各自的发布环境及授权。

<a id="dev-note"></a>
## 开发笔记

实施和组合验证由迁移交付记录跟踪。在安装及原生验收证据完成前，此包仍是开发候选。
