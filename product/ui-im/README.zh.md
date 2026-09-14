---
description: "通过公开 Client 对象与 UI slots 提供产品 IM 账号及工作区配置。"
kind: "package-plugin"
---

# @gestaltrun/dsh-ui-im

[English](README.md) | 中文

## Summary

本产品插件在设置中增加 IM 账号，并在所选工作区的设置中提供接管配置。它消费 IM API 的配置与候选对象；组件只接收本地化 props 和命令。右侧 IM 入口使用现有 tab registry 与 body slot。

## Table of Contents

- [Product composition](#product-composition)
- [Account and route operations](#account-and-route-operations)
- [Workspace presentation](#workspace-presentation)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)

## Product composition

本包与产品 IM API、既有 Workspace UI、设置、语言及右侧栏一起组合。Client 配置 `directoryPicker` 默认选择 `browse`；Host 提供原生目录选择器时可选择 `native`。Node companion 不持有领域服务。Client 请求壳共享的 React、Cordis、store、slots 和 primitives；包内工具及 CSS 随包构建。已发布 primitive 库的开发依赖只是测试和构建输入，不增加浏览器模块请求。

## Account and route operations

账号分别展示授权与监听事实。接入使用供应方发现的身份，只通过 Host 的只写操作发送凭据字段。接入失败保持可见，不会将账号标记为已连接。暂停操作携带已显示的账号版本。在供应方提供对应生命周期命令前，断开与重连控件保持禁用。

路由编辑器保留所有指定目标。新路由默认停用。现有归属转移要求确认已观察的工作区和版本。每个目标保留操作身份与结果；部分及未知结果保留草稿。未知结果先查询再重试，已确认目标不重发。改绑保留已有启用状态，并使用返回版本应用请求的触发设置。

## Workspace presentation

产品仅通过更高 slot 优先级替换公开的 `sidebar.workspaces` 呈现。设置动作携带实际点击的工作区身份。搜索、分组、拖拽排序、重命名、删除、Session 操作、导航及目录选择保留 [UPSTREAM.json](UPSTREAM.json) 记录的固定上游呈现。产品子 slots 不重复声明上游目录流 slot；卸载会恢复原 browser，并保留其目录贡献。

定向测试覆盖凭据、确认、多目标部分结果和适配后的 Workspace browser。这些检查不等于完整安装版 GUI 验收。模拟目标控件、权威会话历史、双 Session 导航和停止动作仍待对应 Host API；当前 IM tab 明确显示暂不支持会话查看。

## Model Experience

UI 不增加模型可见输入。Host 运行时命令持有后续 Session 行为。

### KV Cache effect

无直接影响。

## Dev Note

本包不发布 invariant companion：UI 持有呈现和可编辑草稿，权威记录仍在 IM Client 对象中。Slot 归属、恢复测试和类型化 props 约束呈现组合。账号供应方及模拟验收独立于这些测试。
