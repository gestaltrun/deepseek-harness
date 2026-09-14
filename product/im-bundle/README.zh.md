---
description: "可安装的产品配置层，为具名 profile 提供持久化 IM 账号和路由配置。"
kind: "package-bundle"
---

# @gestaltrun/dsh-im-bundle

[English](README.md) | 中文

## 概述

此 bundle 为基于 base 的 dsh profile 添加持久化 IM 账号和路由配置。它选择产品运行时和生成的配置 API。底层应用继续使用已提供的 Web 模板；此 bundle 承载后端子集，不添加 UI 或平台适配器。

## 目录

- [安装到 profile](#install-into-a-profile)
- [配置层行为](#layer-behavior)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="install-into-a-profile"></a>
## 安装到 profile

使用 `pnpm --dir product run pack:im-bundle` 构建三个候选归档。[产品工作区](../README.zh.md) 定义构建顺序和 `product/dist` 输出目录。候选包尚未发布到 registry；安装候选版本时，必须把精确的包名和版本映射到对应的本地归档。

可重复的安装检查使用独立且已安装 `@deepseek-ai/dsh@0.1.5-rc.2` 的消费者。把 `DSH_IM_SMOKE_INSTALL_ROOT` 设为该消费者目录，运行 `pnpm --dir product run smoke:im-profile`。检查从已提供的 Web 模板创建全新 profile，记录候选归档哈希，把未发布依赖绑定到本地归档，并调用 `dsh plugin --profile im-profile-smoke add`。该 profile 禁用自动安装对等依赖，并共享消费者的 Cordis 实例。

安装后，`dsh --profile im-profile-smoke --dump-config` 显示两个产品配置行。检查还会拒绝额外 overlay 中的畸形 YAML，并运行 `dsh plugin --profile im-profile-smoke remove @gestaltrun/dsh-im-bundle`；产品配置行消失，共享 profile 数据保留。它不启动 Web 服务、Electron、模型或平台适配器。

<a id="layer-behavior"></a>
## 配置层行为

[补丁](cordis.patch.yml) 各插入一次 `gestaltrun-im-runtime` 和 `gestaltrun-im-api`。底层 base 提供存储、凭据和 Typert 服务。[运行时](../im-runtime/README.zh.md) 定义持久化配置，[API](../api-im/README.zh.md) 定义安全 Remote 命令和 Client 对象。后续 profile 补丁可以按正常的有序补丁规则配置这些具名行。bundle 自身没有运行时入口或服务。

<a id="model-experience"></a>
## 模型体验

无。此配置子集不添加面向模型的工具或提示词。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 平台适配器、IM UI、执行工具和模拟组合不包含在此后端子集中。
- Desktop 的默认产品列表尚未选择此 bundle。
- 包安装和配置打印不能证明完整 IM 体验；真实平台适配器与 Web/Desktop 验收分别验证。

<a id="dev-note"></a>
## 开发备注

无。
