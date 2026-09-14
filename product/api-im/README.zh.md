---
description: "IM 配置命令、生成 Remote 方法及可重连的 Client 对象。"
kind: "package-plugin"
---

# @gestaltrun/dsh-api-im

[English](README.md) | 中文

## Summary

本包连接产品 IM 运行时与 Client 配置对象。Host 持有变更结果；Client 仅通过有序 follow 流发布配置。UI 插件消费 `ctx.im`，不持有账号或路由记录。

## Table of Contents

- [Configuration API](#configuration-api)
- [Client state](#client-state)
- [Delivery reads](#delivery-reads)
- [Build inputs](#build-inputs)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Configuration API

Host 入口依赖 `imRuntime`，提供 `im` Remote 命名空间。账号接入先返回安全的已验证身份与授权事实，不持久化账号或 Credentials 记录。确认操作使用一个保留的操作身份提交 Host 持有的同一 setup；取消操作如实报告 setup 已释放、正在确认或已经确认。账号生命周期回执查询区分持久结果与明确未找到。路由创建、编辑、显式改绑、删除和回执查询复用运行时请求类型。普通编辑不能转移归属。已定义的运行时错误使用 `im/configuration`，并在 `details.code` 保留稳定的领域错误码；未定义的供应方异常仍由 Gateway 脱敏。

路由批次保留每个操作身份与结果。各目标独立提交。拒绝或冲突回执与结果未知的操作保持区分；未知操作须先查询，再重试。模拟目标命令使用已观察版本，并提供自己的回执查询。

## Client state

Client 入口通过公开 Gateway 挂载自身生成的 contribution。每个 follow 代次先发送完整基线，再发送有序的完整替换。慢读者合并失效通知。重连保留最后可用配置，直到新基线到达。一元响应返回操作结果，不能覆盖更新的流数据。

可观察对象保持稳定身份，批量发送结构变更通知，并在销毁时移除观察者。连接取消关闭 Host 订阅。候选发现为每个平台保留独立 Client 对象；已取消或已被替代的读取不能覆盖更新的选项。UI 草稿与选择由消费本包的 UI 插件持有。

## Delivery reads

只读的历史、outbox 和投递 follow 方法要求完整的真实或模拟 scope。Client reader 在整个生命周期中固定该 scope 及入站、出站分页游标。每个代次发布完整的有界窗口；匹配的持久变更刷新该窗口。导航在绑定其他 scope 前销毁当前 reader。分页游标是独立的数值序号，结果未知的发送保持 `result-unknown`。

供应方入站、游标提交、提交标记、发信尝试和回执结算不是 Remote 方法。这些动作由运行时与可信 Provider 持有。构建后的 smoke 使用持久测试输入，不联系供应方；它通过生成 Gateway 验证实时页面、scope 隔离、非法输入和 reader 销毁。

## Build inputs

Host 与 Client 独立编译。Host 声明及 JavaScript 先于 `lib/typert.host.*` 和 `lib/typert.remote-client.*` 生成；Client 编译消费这些生成声明。打包的 Client 请求共享 Cordis、Client store 和 Gateway 身份。生成器与安装检查由产品组合负责。包内测试覆盖 follow 顺序和独立结果；构建后的 API smoke 通过仅供配置测试的 Provider，驱动分阶段接入、确认响应丢失后的重放、回执查询、真实 Gateway 调用、JSON 持久化、重连、迟到响应和新进程恢复。

## Model Experience

这些配置命令不增加模型输入。运行时持有后续 Session 与工具行为。

### KV Cache effect

无直接影响。

## Dev Note

本包不发布运行时 invariant companion。BFF 将持久归属委托给 `imRuntime`；有序 follow 断言和运行时变更回执约束本包消费的关系。安装后的 profile 与 GUI 验收独立于这些包内测试。
