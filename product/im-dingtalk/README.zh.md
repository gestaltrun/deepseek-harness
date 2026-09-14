---
description: "以明确的授权、事件、接收方与发送证据，把已安装 DWS 员工 Profile 接入产品 IM。"
kind: "package-reference"
---

# @gestaltrun/dsh-im-dingtalk

[English](README.md) | 中文

## 概述

本包用于把已安装钉钉工作台 CLI 的员工 Profile 接入产品 IM runtime。每个配置账号保留精确的 `corpId:userId` Profile，每条身份相关命令都显式传入该 Profile。只有 DWS 输出公开 ready marker 后，监听器才进入运行状态。DWS 异步发送在状态命令返回最终消息 id 前保持未知。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

安装 DWS `1.0.61` 或更高版本，在 DSH 外完成员工 OAuth，再依次挂载 Subprocess、`@gestaltrun/dsh-im-runtime` 与本包。账号设置只能选择 `listAccountCandidates` 返回的值；它不接受 Token，也不改变 DWS 当前 Profile。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@gestaltrun/dsh-im-runtime'
- name: '@gestaltrun/dsh-im-dingtalk'
  config:
    dwsPath: dws
    home: /home/operator
    cwd: /srv/dsh
    graceMs: 5000
    commandTimeoutMs: 15000
    readinessTimeoutMs: 30000
    maxOutputBytes: 1048576
    maxLineBytes: 1048576
    conversationPageSize: 100
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `dwsPath` | `dws` | 由 Subprocess Provider 解析的绝对可执行文件或裸命令。 |
| `home` | OS 登录用户主目录 | 包含 DWS Profile 状态的显式子进程 `HOME`。 |
| `cwd` | 当前目录 | 子进程工作目录。 |
| `graceMs` | `5000` | 受管进程终止与静止等待上限。 |
| `commandTimeoutMs` | `15000` | 批处理命令截止时间。 |
| `readinessTimeoutMs` | `30000` | 精确 `[event] ready` marker 截止时间。 |
| `maxOutputBytes` | `1048576` | 每条批处理输出流上限。 |
| `maxLineBytes` | `1048576` | NDJSON 与诊断行上限。 |
| `conversationPageSize` | `100` | 1 到 100 的会话发现页面大小。 |

`listAccountCandidates` 读取 `dws profile list --format json`，并要求稳定选择器等于 `corpId:userId`。`inspectAccount` 读取 Profile 状态但不刷新。`refreshAccount` 运行 `dws auth status --profile <精确值> --format json`，核对返回的组织与员工事实，绝不改变环境中的当前 Profile。只有明确状态事实才变成就绪、过期或撤销；缺失状态与通用命令错误保持检查失败。

会话发现为群聊和单聊保留钉钉 `openConversationId`。DWS 单聊发送另需对端 `openDingTalkId` 或用户 id。特定路由和单聊消息发送者证据会单独保留对端，因此 runtime 重启后仍同时拥有稳定会话身份与真实发送接收方。Transport 绝不会用会话 id 替代缺失的对端。

一个公开 `event consume` 进程订阅 `user_im_message_receive_at`、`user_im_message_receive_o2o_all` 与 `user_im_message_receive_group_all`。Runtime 监听计划选择特定会话，或当前与未来所有适用单聊和群聊。解析器只接受固定版本的扁平消息字段，只从 at-me event key 得出 mention 证据，并在把 frame 归属为外部参与者前依赖 DWS 的普通本人回环过滤。当 all-group frame 先于对应 at-me frame 到达时，runtime 会为同一条持久消息补充 mention 证据，不会重新提交已完成的 admission。它绝不从消息文本推断 mention 或发送者。

监听器只在精确公开 ready marker 出现后返回生命周期 handle。有序断开、计划重启和关闭都会等待受管进程静止。DWS 进程随后退出时会终结 handle，使 runtime 移除运行状态或发布安全失败，而不会让账号继续显示为已连接。

群聊发送传入真实会话 id；单聊发送通过 `--open-dingtalk-id` 或 `--user` 传入持久对端。两者都向 `chat message send` 传入文本、runtime request id、AI 标记与精确 Profile。`openTaskId` 是不确定回执。`confirm` 调用 `chat message query-send-status`，仅在成功状态包含 `openMessageId` 时报告已发送；明确失败保持失败，其余不完整或丢失结果保持未知，不会二次发送。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部 — 点击展开</summary>

经评审 DWS 源码固定在 [`50eb73a0906c5911c5c25f9c7106b6ead4f14f62`](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/tree/50eb73a0906c5911c5c25f9c7106b6ead4f14f62)。它的[消息输出 DTO](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/event/personal/output.go#L24-L43)为 mention、all-direct 与 all-group 事件提供相同的稳定消息和会话标识。[监听 facade](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/app/event_listen_im.go#L44-L139)定义全会话事件键，并委托给带 ready marker 的 NDJSON 生命周期。[发送命令](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/50eb73a0906c5911c5c25f9c7106b6ead4f14f62/internal/helpers/chat.go#L3290-L3352)区分群聊会话 id 与单聊对端 id，并说明状态确认。

进程层只通过 `ctx.subprocess` 解析并启动 DWS，限制批处理输出和流式行，使用 stderr marker 控制就绪，串行处理入站消息，并在 teardown 中等待受管进程范围静止。Provider 诊断不会复制捕获输出。

| 源文件 | 用途 |
|---|---|
| `src/config.ts` | 进程、输出、就绪与页面限制 |
| `src/process.ts` | 公共 Subprocess 执行与流生命周期 |
| `src/protocol.ts` | 严格公开 JSON、NDJSON、身份、mention 与回执解析 |
| `src/client.ts` | 精确公开 DWS argv 与能力探测 |
| `src/transport.ts` | Runtime transport 注册与持久页面投递 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [产品 IM runtime](../im-runtime/README.zh.md) — 持久账号、路由、页面、供应方游标与 outbox 行为
- [Subprocess](../../packages/subprocess/subprocess/README.zh.md) — 受管子进程范围与静止 teardown
- [IM 迁移决策](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) — 产品包归属与 Provider 要求

-----

<a id="model-experience"></a>
## 模型体验

间接。本包向产品 runtime 提供供应方消息与发送结果。它不注册模型工具或 prompt，也不能自行提交 Agent turn。

#### KV Cache 影响

无；Profile 检查与事件消费不会组装模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 产品包的构建、测试或 Loader smoke 绝不读取真实 Profile 或消息。真实员工访问、发送、状态确认与 GUI 验收需要单独授权的测试范围。
- 本地交付主机在 2026-09-14 报告 `v1.0.52.1 (4fb8794, 2026-07-24T08:01:49Z)`，低于要求的 DWS `1.0.61`，且没有升级。真实接入验收必须先选择隔离的兼容可执行文件与 Profile 主目录。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护上下文 — 点击展开</summary>

迁移来源、经评审 DWS commit、许可与本地版本探测记录在 `UPSTREAM.json`。先构建产品 runtime，再运行本包的测试、类型检查与构建脚本。`smoke:loader` 使用合成可执行文件与本地 JSON Storage，覆盖监听计划、延迟 mention 证据、重启持久性、单聊接收方 argv、重连、teardown 与就绪后失败；它绝不能指向操作员的 DWS 主目录。

</details>
