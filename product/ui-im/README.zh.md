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

账号分别展示授权与监听事实。接入使用供应方发现的身份，只向只写验证操作发送凭据字段。供应方验证返回或失败后，UI 会清除 Secret 输入，并在确认前显示已验证的身份与授权事实。取消操作区分已释放、正在确认与已经确认的 setup。确认结果未知时，UI 复用同一 Host setup 与操作身份。暂停、断开、重连与刷新授权会使用已显示的账号版本发送生命周期命令。断开确认使用打开时捕获的账号名称、路由数量与版本。生命周期操作处于待完成或结果未知状态时，其他账号命令保持禁用；保留的操作身份用于查询回执，不会重复命令。

路由编辑器保留所有指定目标。新路由默认停用。现有归属转移要求确认已观察的工作区和版本。每个目标保留操作身份与结果；部分及未知结果保留草稿。未知结果先查询再重试，已确认目标不重发。改绑保留已有启用状态，并使用返回版本应用请求的触发设置。

## Workspace presentation

产品仅通过更高 slot 优先级替换公开的 `sidebar.workspaces` 呈现。设置动作携带实际点击的工作区身份。搜索、分组、拖拽排序、重命名、删除、Session 操作、导航及目录选择保留 [UPSTREAM.json](UPSTREAM.json) 记录的固定上游呈现。产品子 slots 不重复声明上游目录流 slot；卸载会恢复原 browser，并保留其目录贡献。工作区设置的标题保持在视口内，卡片在有界内容区滚动；窄卡片将操作区移到正文下方。[浏览器布局检查](tests/browser/check-settings-layout.mjs) 覆盖窄、宽视口中的长列表选择、确认和关闭。

定向测试覆盖接入点准入、凭据清除、身份确认、setup 取消竞态、确认重放、生命周期回执查询、多目标部分结果和适配后的 Workspace browser。这些检查不等于完整安装版 GUI 验收。模拟目标选择和清除使用运行时的条件路由引用与回执查询；未知响应保留操作身份供后续核对。Session 列表跟随持久实例并标记双方，包括已停止状态。IM tab 从已选模拟用户 Session 创建实例，使用 Host 提供的对端与投递 scope，注入已准入参与者或受控人工消息，并在确认停止后等待终态结果。冻结目标事实与后续配置漂移持续可见，已停止及失败实例保持只读。

## Model Experience

UI 不增加模型可见输入。Host 运行时命令持有后续 Session 行为。

### KV Cache effect

无直接影响。

## Dev Note

本包不发布 invariant companion：UI 持有呈现和可编辑草稿，权威记录仍在 IM Client 对象中。Slot 归属、恢复测试和类型化 props 约束呈现组合。账号供应方及模拟验收独立于这些测试。
