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

账号池设置页拥有登录、账号启停、字段、模型列表和配额刷新。开始设备或 PKCE 登录，以及再次点击用浏览器打开授权页，都会让 Host 用系统浏览器打开 HTTPS 授权 URL。既有设置导航进入账号管理。未知、不支持、失败和过期配额观测保持区分。

Kimi 的用量汇总对应提供方的[七天配额](https://www.kimi.com/help/kimi-code/benefits)；响应省略窗口元数据时，时间指针使用该周期。有效的显式元数据优先；元数据无效或缺少重置时间时不显示时间指针，显示标签不用于推断周期。

[Bundle 补丁](cordis.patch.yml) 在隔离 scope 中选择本地 subprocess 实现，并把 Desktop 账号存储在 `$DSH_HOME/desktop/account-pool`。Web profile 应用此 bundle 时必须显式选择自己的绝对 `stateRoot`。并发进程不能共享同一状态根。常规 profile/plugin 安装机制拥有 bundle 激活，仅复制目录不会激活它。

账号文件（包括 GLM Coding Plan JSON）存放在引擎 `auth-dir`。GLM 卡片标明供应商级模型列表，并把不可用的健康/历史值显示为未知。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

一个产品包拥有账号服务、core supervisor、私有管理映射、LLM 适配器、Remote 控制器和共享 Client。Go 引擎从 [UPSTREAM.json](UPSTREAM.json) 中的精确来源构建；安装后的二进制、许可证和 manifest（元数据清单）位于包资源中。每代拥有独立回环 HTTP 凭据和取消能力。关停撤回模型路由、等待请求结束、停止所属进程树，并仅删除代次文件。

账号文件仍由引擎拥有，存放在 `auth-dir`，包括 GLM Coding Plan JSON。遗留的产品 `glm-accounts.json` 会一次性迁到该目录。GLM 身份来自引擎花名册。

Client 使用类型化操作和拥有 watch 取消及命令生命周期的控制器。源码 DTO 通过仅类型的公共 `./types` 导出。Host/Client 描述符来自原样的公共 Typert 生成器，并使用严格 codec。仅供构建的公开 protocol 声明 rollup 在独立严格 TypeScript 程序中与原声明比较，随后提供给隔离分析项目。正常 Host/Client 编译及运行时解析原始 npm 包；分析输入不进入产物。

[已接受架构](../../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有替代方案和精确的产品专属修改范围。配额解析器是纯观测模块，其来源声明及打包 Client 许可证保留在 [NOTICE](NOTICE)。没有独立运行时 invariant：Host 快照是唯一业务状态来源，生命周期/传输测试验证其外部效果。

</details>

-----

<a id="build-and-verification"></a>
## 构建与验证

独立的 `product/` 工作区安装精确发布版 DSH 依赖。正常编译配置不包含仓库源码别名。产品构建、类型检查和打包命令对照 `UPSTREAM.json` 中记录的已核验基线运行范围检查；有意采用新基线必须显式提供并审阅。

产品构建生成 Host 入口、非空严格 Remote 贡献，并编译 Client module-loader factory。引擎编译与 Node 编译分开。引擎构建器编译 `UPSTREAM.json` 钉住的 `community/cliproxyapi` gitlink，校验该检出的 Git 身份，在禁止修改 Go module 的条件下编译，并输出来源/平台/架构/文件名/SHA-256 元数据。包声明 `publishConfig.executableFiles`，让 pnpm 保留资源的执行权限，不暴露 package bin。包准备构建所选主机目标，并把 npm 产物放入 `product/dist`。

原生 Desktop 交互、已认证供应商推理、本地 TLS/SSE 测试和单元 fixture（测试前置数据）属于不同证据路径。假 GLM key 可以验证持久化和管理，不能证明供应商认证。

-----

<a id="model-experience"></a>
## 模型体验

通过注册的 `gestalt-account-pool` LLM 路由间接产生影响。模型选择和 reasoning 默认值在流开始前进入请求元数据。账号凭据及配额观测不会新增模型可见提示词内容，也不改变 Session 格式。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 一个目标产物包含该目标的 Go 二进制，不能证明已发布跨平台版本。
- 真实 OAuth 和已认证推理依赖可用供应商账号及网络。空池启动和 fixture key 不能证明这些结果。
- GLM 配额观测来自引擎的 `glm-coding-plan` 信封。Host 只解析该信封，不自行探测 GLM 用量端点。
- 签名 Desktop 发布、公证和更新发布需要各自的发布环境及授权。

<a id="dev-note"></a>
## 开发笔记

实施和组合验证由迁移交付记录跟踪。在安装及原生验收证据完成前，此包仍是开发候选。
