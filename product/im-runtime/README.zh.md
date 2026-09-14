---
description: "配置持久化 IM 账号与路由，并保留作用域化消息历史、提供方游标、Session 提交证据和出站结果。"
kind: "package-reference"
---

# @gestaltrun/dsh-im-runtime

[English](README.md) | 中文

## 概要

使用此包保存安全的钉钉或旺旺账号事实、将完整会话路由绑定到工作区，并保留消息投递状态。入站页面、历史导入、提供方游标、Session 提交证据、Agent 任务代次与出站结果都有持久化查询收据。凭据保留在 Credentials 服务中。平台提供方负责登录、事件转换、发送和回执查询；此 runtime 负责将消息准入普通 Agent。

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

装载 Storage、一个 KV 后端、StorageDomain、Credentials、Session persistence、Workspace、AgentLoop、AgentPresets、默认 Agent 模型、此 runtime，以及至少一个 `ImTransport` 提供方。Agent 服务缺失时仍可使用配置和历史能力；自动准入只在这些服务所在的注入作用域中启用。

### 适用条件

产品 Host 提供方与 IM BFF 共享 IM 配置权威时使用此包。需要 wire DTO 或只写账号接入请求类型的使用方应导入 `@gestaltrun/dsh-im-runtime/types`；Host 代码从根入口导入 `ImRuntimeService`、`ImRuntimeError` 和 `ImTransports`。

### 最小配置

`admissionBatchSize` 限制一次模型可见批次，默认值为 1000。群聊 `everyN` 不能超过该限制。`accountSetupTtlMs` 限制未确认提供方接入材料在 Host 内存中的保留时间，默认五分钟。StorageDomain 选择持久后端，Credentials 实现选择密钥存储。

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
  config:
    admissionBatchSize: 1000
    accountSetupTtlMs: 300000
```

`listAccountCandidates` 从已注册 transport 返回已安装的钉钉 profile 或已准入的旺旺商家。已准入旺旺 candidate 包含安全 endpoint。UI 从中选择标识，Host 拒绝与所选 candidate 不一致的 endpoint。`previewAccountSetup` 要求 transport 校验只写输入，并返回安全身份、授权事实、过期时间与 Host 生成的 setup id，不创建账号，也不写入 Credentials。`confirmAccountSetup` 固定已验证身份，在同一持久操作收据中保存凭据记录与账号；相同 setup 与 operation id 会复用结果，即使 Host 重启也不会重复创建账号。`cancelAccountSetup`、请求取消、setup 过期与 runtime dispose 都会释放未确认的内存材料；JavaScript 不保证物理擦除内存。暂停、断开、重连、刷新或确认接入响应不确定时，调用 `queryAccountOperation` 查询。`inspectAccount` 和 `refreshAccount` 报告提供方观察到的授权事实，不改变账号身份。连接意图、授权状态和监听状态仍是三个独立事实。

每条路由包含平台、账号、会话类型、`all` 或 `specific` 目标以及工作区归属。指定私聊目标可在稳定平台会话 ID 之外单独保留提供方对端标识。指定会话路由始终优先于全量路由，包括指定路由被停用时。私聊路由拒绝群触发设置；群聊路由必须至少配置 `mention`、正整数 `everyN` 或正整数 `fixedIntervalSeconds` 之一。

`createRoute`、`saveRoute`、`rebindRoute` 和 `deleteRoute` 将结果与所属账号聚合记录一同保存。`saveRoute` 不能改变工作区归属。`rebindRoute` 与 `deleteRoute` 同时比较读取时的路由 revision 和工作区。传输层超时后，先调用 `queryRouteOperation`，再决定是否使用新的 operation id。模拟目标保存和移除按工作区提供相同的显式查询方式。

`ingestInboundPage` 持久保存一个完整真实会话或已配置模拟会话页面，并按完整 scope 与平台消息标识去重。后到的重复消息只能把明确 mention 证据从缺失或 false 单调补为 true；已提交记录仍保持已提交，先前 Session 事件不回写。JSONL 导入只进入查询历史，不进入待处理 Agent 投递。崩溃后，`reconcileSession` 扫描 `SessionPersistence` 并确认匹配的稳定来源。投递记录和 Session 日志仍是独立持久写入，不声称存在跨日志事务。

提供方轮询游标由明确的平台账号与 stream 共同拥有。runtime 拥有的监听 sink 接收一个带稳定逐会话 operation id 的提供方页面。它先提交每个会话分组，再带全部页面收据提交提供方游标。如果进程在这些写入之间停止，或后续分组失败，重启后仍读取旧提供方游标，并通过持久去重安全重放各分组。监听器会收到启用路由计划，其中明确是否需要 mention 证据。因此一个旺旺商家页面可以覆盖多个会话，钉钉也可组合全量群消息与 at-me 观察，而不会把提供方游标错误归给某个会话。

`registerOutbound` 在任何平台调用前保存意图。`beginOutboundAttempt` 只授予一次尝试；调度结果未决时重启或重复 begin 会记录 `result-unknown`，调用者随后查询或确认，不盲目重试。自动意图冻结路由与账号 generation。账号或路由暂停时，DSH 人工发送和模拟发送仍可用；暂停或路由变更前的自动意图不能在恢复后继续发送。

提供方把参与者和回显事实传给 `classifyInboundSender`。匹配已发送自动 outbox 时返回 `ai`，匹配已发送人工 outbox 时返回 `human-dsh`，明确的平台原生操作证据返回 `human-native`。无法匹配的已配置账号观察仍为 `unknown`；文本相等不会改变发送者归因。mention 触发只使用随消息持久保存的提供方明确 mention 元数据。

持久化真实或模拟输入会按路由代次自动启动或恢复一个普通 Agent。私聊立即触发。群聊 mention、`everyN` 与固定周期按 OR 合并成一个批次；固定周期无需等待下一条入站事件。Session source 记录 scope、精确消息标识、发送者证据、触发原因、路由 revision、账号 revision 与工作区。改绑后，在途 Agent 仍留在其已记录工作区，后续输入进入新的任务代次。未变代次的新输入使用 `steer`，在最近安全步骤进入，不取消正在执行的模型或工具工作。

`@gestaltrun/dsh-im-runtime/tools` 入口在可信 Agent 上下文注册 `im_query_history` 和 `im_send_message`。模型参数不包含账号、会话、模拟实例、路由或工作区。自动发送使用任务已记录的路由和对端身份；若该代次已过期，outbox 会在任何提供方调用前记录 `route-changed`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`gestaltrun_im_runtime` StorageDomain 为每个账号聚合保存一条记录，并为每个工作区模拟目标保存一条记录。独立的 `gestaltrun_im_delivery` 领域为每个完整会话 scope 保存一个聚合，并另存提供方拥有的游标记录与按路由绑定的 Agent 任务代次。会话聚合在一次持久写入中保存入站消息、去重键、操作收据、提交证据和 outbox。提供方游标只在引用的页面收据都存在后提交。任何操作都不声称在凭据、配置、投递、提供方游标、Agent 任务或 Session 记录之间提供原子事务。

`ImTransports` 为每个平台保留一个存活的提供方，并随注册方 Cordis fiber 释放。当账号连接意图为连接、未暂停、存在启用路由且授权状态为 `ready` 或 `unchecked` 时，runtime 启动监听器；明确的 `required` 或 `failed` 授权状态使其保持停止。`unchecked` 允许没有独立身份探针的提供方通过首次真实 listen 或 poll 完成验证，其本身不投影已就绪身份。提供方 `listen` 只在监听器已建立并验证可用后返回，其返回的 `done` promise 报告后续正常结束或失败。主动停止会中止 signal、调用 `dispose` 并等待 `done`；启用路由计划变化时也按此顺序停止旧监听器，再启动替代实例。监听器终止失败不会触发无界重试。`ctx.imRuntime.subscribe` 和类型化 `imRuntime/changed` 事件发布持久变更及后续进程监听状态变化。snapshot revision 只在当前进程 generation 内排序；持久 operation id 与记录 revision 跨重启保留。

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
| `src/agent-coordinator.ts` | 持久触发判断和普通 Agent 创建、恢复与 steer 生命周期 |
| `src/tools.ts` | scope 绑定的历史与出站 Agent 工具 |

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

每个准入批次通过目标 Agent preset 组装为一条带稳定标识的 user message。其 source 包含崩溃核对所需的完整持久证据。两个 scope 绑定的 IM 工具只暴露已准入会话的历史与出站路径。

#### KV Cache 影响

未变化的路由代次复用其 Agent Session 与 prompt cache。改绑会创建新 Session，因为工作区与任务归属已变化。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 提供方包负责在线身份检查、会话发现、监听器、出站发送和回执确认。
- 面向操作者的双 Session 模拟创建生命周期属于后续产品切片；已配置模拟输入已使用共享准入、历史与 outbox 路径。
- operation 收据不会自动清理，因为清理后无法区分旧操作与从未收到的操作。
- 凭据和配置使用不同的持久化服务。账号写入失败时会尝试回滚凭据；若回滚也失败，则同时报告两个错误，不声称存在跨服务事务。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护上下文——点击展开</summary>

迁移来源与 dirty patch 标识记录在 `UPSTREAM.json`。运行 `pnpm --dir product --filter @gestaltrun/dsh-im-runtime test`、`typecheck` 和 `build`；完成 `build` 后运行 `smoke:loader`，通过真实 Loader YAML 装配验证构建入口。

</details>
