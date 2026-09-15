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

设置页拥有登录、启停、字段、模型列表和配额刷新。设备或 PKCE 登录，以及用浏览器打开授权页，都会让 Host 用系统浏览器打开 HTTPS 授权 URL。未知、不支持、失败和过期配额观测保持区分。

Kimi 的用量汇总对应提供方的[七天配额](https://www.kimi.com/help/kimi-code/benefits)；响应省略窗口元数据时，时间指针使用该周期。有效的显式元数据优先；元数据无效或缺少重置时间时不显示时间指针，显示标签不用于推断周期。

[Bundle 补丁](cordis.patch.yml) 在隔离 scope 中选择本地 subprocess 实现，并把 Desktop 账号存储在 `$DSH_HOME/desktop/account-pool`。Web profile 必须选择自己的绝对 `stateRoot`。并发进程不能共享同一状态根。profile/plugin 安装激活 bundle，仅复制目录不会激活。

账号文件（包括 GLM Coding Plan JSON）存放在引擎 `auth-dir`。GLM 卡片标明供应商级模型列表，并把不可用的健康/历史值显示为未知。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

一个产品包拥有账号服务、引擎 supervisor、管理映射、LLM 适配器、Remote 控制器和 Client。Go 引擎从 [UPSTREAM.json](UPSTREAM.json) 中的来源构建。每代拥有独立回环 HTTP 凭据和取消能力。关停撤回模型路由、等待请求结束、停止所属进程树，并仅删除代次文件。

账号文件仍由引擎拥有，存放在 `auth-dir`。GLM 身份来自引擎花名册。Host 打开 HTTPS 授权 URL；渲染器不打开。

[已接受架构](../../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有替代方案和产品专属修改范围。配额解析器是观测模块，来源声明在 [NOTICE](NOTICE)。Host 快照是业务状态来源；生命周期和传输测试验证其外部效果。

</details>

-----

<a id="build-and-verification"></a>
## 构建与验证

独立的 `product/` 工作区安装已发布 DSH 依赖。产品构建、类型检查和打包命令对照 `UPSTREAM.json` 中的已核验基线运行范围检查。

产品构建生成 Host 入口、非空严格 Remote 贡献，并编译 Client factory。引擎构建器编译 `UPSTREAM.json` 钉住的 `community/cliproxyapi` gitlink，并输出来源/平台/架构/文件名/SHA-256 元数据。`publishConfig.executableFiles` 保留执行权限，不暴露 package bin。

原生 Desktop 交互、已认证供应商推理和单元 fixture（测试前置数据）属于不同证据路径。假 GLM key 可以验证持久化和管理，不能证明供应商认证。

-----

<a id="model-experience"></a>
## 模型体验

通过注册的 `gestalt-account-pool` LLM 路由间接产生影响。模型选择和 reasoning 默认值在流开始前进入请求元数据。账号凭据及配额观测不会新增模型可见提示词内容，也不改变 Session 格式。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 一个目标产物包含该目标的 Go 二进制，不能证明已发布跨平台版本。
- 真实 OAuth 和已认证推理依赖可用供应商账号及网络。空池启动和 fixture key 不能证明这些结果。
- GLM 配额观测来自引擎的 auth-files 信封。Host 只解析该信封，不自行探测 GLM 用量端点。
- 签名 Desktop 发布、公证和更新发布需要各自的发布环境及授权。

<a id="dev-note"></a>
## 开发笔记

在安装及原生验收证据完成前，此包仍是开发候选。遗留的 `glm-accounts.json` 会在获取锁时一次性迁到 `auth-dir`。
