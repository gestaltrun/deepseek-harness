---
description: "配置持久化 IM 账号与路由，并保留作用域化消息历史、提供方游标、Session 提交证据和出站结果。"
kind: "package-reference"
---

# @gestaltrun/dsh-im-runtime

[English](README.md) | 中文

## 概要

使用此包保存安全的钉钉或旺旺账号事实、将完整会话路由绑定到工作区，并保留消息投递状态。入站页面、历史导入、提供方游标、Session 提交证据与出站结果都有持久化查询收据。凭据保留在 Credentials 服务中。平台登录、实际发送和 Agent 编排由后续提供方与编排包提供。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

按顺序装载 Storage、一个 KV 后端、StorageDomain、Credentials、此 runtime，以及至少一个 `ImTransport` 提供方。

### 适用条件

产品 Host 提供方与 IM BFF 共享 IM 配置权威时使用此包。需要 wire DTO 或只写账号接入请求类型的使用方应导入 `@gestaltrun/dsh-im-runtime/types`；Host 代码从根入口导入 `ImRuntimeService`、`ImRuntimeError` 和 `ImTransports`。

### 最小配置

runtime 没有部署配置字段。StorageDomain 选择持久后端，Credentials 实现选择密钥存储。

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /absolute/path/to/storage
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-credentials-local'
  config:
    path: /absolute/path/to/.credentials.yaml
- name: '@gestaltrun/dsh-im-runtime'
```

`listAccountCandidates` 从已注册 transport 返回已安装的钉钉 profile 或已准入的旺旺商家。UI 从中选择标识，不虚构默认 profile、商家 ID 或 endpoint。transport 随后校验只写的接入输入，并返回安全身份事实与可选凭据记录。runtime 先通过 `ctx.credentials` 保存凭据记录，再发布账号。授权状态与监听状态分别展示，不推导 `connected` 标记。

每条路由包含平台、账号、会话类型、`all` 或 `specific` 目标以及工作区归属。指定会话路由始终优先于全量路由，包括指定路由被停用时。私聊路由拒绝群触发设置；群聊路由必须至少配置 `mention`、正整数 `everyN` 或正整数 `fixedIntervalSeconds` 之一。

`createRoute`、`saveRoute`、`rebindRoute` 和 `deleteRoute` 将结果与所属账号聚合记录一同保存。`saveRoute` 不能改变工作区归属。`rebindRoute` 与 `deleteRoute` 同时比较读取时的路由 revision 和工作区。传输层超时后，先调用 `queryRouteOperation`，再决定是否使用新的 operation id。模拟目标保存和移除按工作区提供相同的显式查询方式。

`ingestInboundPage` 持久保存一个完整会话页面，并按完整 scope 与平台消息标识去重。JSONL 导入只进入查询历史，不进入待处理 Agent 投递。使用 `sessionUserMessage` 创建标识稳定的 `user/message`；该 Session 日志持久后再调用 `markSubmitted`。崩溃后，`reconcileSession` 扫描 `SessionPersistence` 并确认匹配的稳定来源。这些是独立持久写入，不声称投递领域与 Session 日志之间存在事务。

提供方轮询游标由明确的平台账号与 stream 共同拥有。提供方先提交每个会话页面，再把全部页面 operation 收据传给 `commitProviderCursor`。如果进程在两步之间停止，重启后仍读取旧提供方游标，并通过持久去重安全重放页面。因此一个旺旺商家页面可以覆盖多个会话，不会把商家游标错误归给某个会话。

`registerOutbound` 在任何平台调用前保存意图。`beginOutboundAttempt` 只授予一次尝试；调度结果未决时重启或重复 begin 会记录 `result-unknown`，调用者随后查询或确认，不盲目重试。自动意图冻结路由与账号 generation。账号或路由暂停时，DSH 人工发送和模拟发送仍可用；暂停或路由变更前的自动意图不能在恢复后继续发送。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`gestaltrun_im_runtime` StorageDomain 为每个账号聚合保存一条记录，并为每个工作区模拟目标保存一条记录。独立的 `gestaltrun_im_delivery` 领域为每个完整会话 scope 保存一个聚合，并另存提供方拥有的游标记录。会话聚合在一次持久写入中保存入站消息、去重键、操作收据、提交证据和 outbox。提供方游标只在引用的页面收据都存在后提交。任何操作都不声称在凭据、配置、投递、提供方游标或 Session 记录之间提供原子事务。

`ImTransports` 为每个平台保留一个存活的提供方，并随注册方 Cordis fiber 释放。`ctx.imRuntime.subscribe` 和类型化 `imRuntime/changed` 事件在对应持久写入后触发。snapshot revision 只在当前进程 generation 内排序；持久 operation id 与记录 revision 跨重启保留。

| 源文件 | 用途 |
|---|---|
| `src/types.ts` | 客户端安全的标识、视图、请求与收据 |
| `src/delivery-types.ts` | 客户端安全的历史、游标、Session 来源与 outbox DTO |
| `src/service-types.ts` | Host Context 服务与类型化事件声明 |
| `src/runtime.ts` | 配置行为与 Host 侧 Session 集成 |
| `src/delivery.ts` | 作用域化接收、查询、提交、游标与 outbox 行为 |
| `src/schema.ts` | 持久 StorageDomain 记录与校验 |
| `src/delivery-schema.ts` | 持久会话与提供方游标聚合 |
| `src/transports.ts` | 可逆的平台提供方注册表 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [架构](../../docs/architecture.zh.md) — runtime 使用的持久化服务
- [凭据服务](../../packages/credentials/credentials/README.zh.md) — 不透明记录的归属与写入语义
- [工作区服务](../../packages/workspace/workspace/README.zh.md) — 权威工作区标识
- [IM 迁移决策](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) — 产品包边界与后续交付切片

-----

<a id="model-experience"></a>
## 模型体验

`sessionUserMessage` 把已存入站文本返回为带稳定标识的 user message。其 source 包含崩溃核对使用的稳定 scope id、message id 与投递 sequence。此包本身不注册 prompt 或 tool，也不启动 Agent。

#### KV Cache 影响

无。账号和路由配置本身不组装或发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 提供方包负责在线身份检查、会话发现、监听器、出站发送和回执确认。
- Agent 准入、自动回复 pump、提供方连接控制和双 Session 模拟生命周期属于后续产品切片。
- operation 收据不会自动清理，因为清理后无法区分旧操作与从未收到的操作。
- 凭据和配置使用不同的持久化服务。账号写入失败时会尝试回滚凭据；若回滚也失败，则同时报告两个错误，不声称存在跨服务事务。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护上下文——点击展开</summary>

迁移来源与 dirty patch 标识记录在 `UPSTREAM.json`。运行 `pnpm --dir product --filter @gestaltrun/dsh-im-runtime test`、`typecheck` 和 `build`；完成 `build` 后运行 `smoke:loader`，通过真实 Loader YAML 装配验证构建入口。

</details>
