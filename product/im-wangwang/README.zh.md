---
description: "用只写凭据连接已准入旺旺商家，轮询持久会话页，并以明确投递结果发送消息。"
kind: "package-reference"
---

# @gestaltrun/dsh-im-wangwang

[English](README.md) | 中文

## 概述

使用本包可将已准入旺旺商家连接到产品 IM runtime。商家目录在设置前固定 endpoint 与身份；账号表单只提交只写 AccessKey 值。轮询会先把覆盖多个会话的完整页面交给 runtime，再推进商家游标。出站调用保留已确认、失败与未知结果，绝不盲目重试。

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

依次挂载 StorageDomain、Credentials、`@gestaltrun/dsh-im-runtime` 与本包。准入目录属于部署配置。`listAccountCandidates` 返回每个已准入 `candidateId` 及其安全 endpoint；UI 必须原样提交这两个值，不能接受任意 merchant id 或 endpoint。若设置请求中的 endpoint 与所选候选不一致，Host 会拒绝该请求。

### 适用场景

本包适用于静态准入旺旺或千牛商家的买家单聊。若平台没有实现经评审的 HMAC 事件、消息与回执 endpoint，请选择其他 Provider。

### 最小配置

```yaml
- name: '@gestaltrun/dsh-im-runtime'
- name: '@gestaltrun/dsh-im-wangwang'
  config:
    admittedMerchants:
      - candidateId: travel-store
        endpoint: https://openapi.example.invalid
        merchantId: merchant-001
        displayName: Travel Store
        mainServiceAccountId: service-001
    pollIntervalMs: 1000
    pollLimit: 50
    pollWaitSeconds: 15
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `admittedMerchants` | 必填 | 静态候选、endpoint、商家身份、展示名与客服账号身份。候选与商家 id 必须唯一。 |
| `pollIntervalMs` | `1000` | 后续每次轮询请求前的等待时间。 |
| `pollLimit` | `50` | 1 到 100 的页面大小。 |
| `pollWaitSeconds` | `15` | 0 到 30 秒的供应方长轮询等待时间。 |

账号设置会同时提交所选 `candidateId`、endpoint、`accessKeyId` 和 `accessKeySecret`；只有两个 AccessKey 字段属于密钥。Provider 通过已配置 endpoint 检查这些凭据，并把观测到的授权事实与 Credentials grant 返回给 runtime。在交互式设置中，Host 会在 `previewAccountSetup` 后把该 grant 保留在内存中，只通过 `confirmAccountSetup` 持久化；取消、过期与关闭会释放未确认 grant。每次检查、会话发现、监听、发送和确认操作都会重新读取已存储 grant，因此轮换后的凭据无需重启插件即可用于下一次操作。

授权事实与监听事实保持分离。通用 HTTP 401 或 403 属于检查失败；只有明确的供应方过期或撤销代码才变成 `required`。监听就绪要求一次供应方页面请求成功并取得 runtime 持久回执，不能由定时器创建代替。

每个商家轮询页先按当前监听计划过滤，再按会话分组并通过 `receivePage` 一次提交。`all` 路由包含未来出现的适用买家会话；特定路由只接收其稳定会话 id。稳定页面与会话 operation id 允许 runtime 在部分失败后保留已完成分组。Provider 只在每个适用分组持久化后推进商家游标，没有匹配分组的页面也遵循同一规则。重启后可以从零重拉一次，取得持久游标冲突后从 runtime 持有的位置继续，不丢失或重复持久消息。

发送者解析器保留外部参与者、配置账号原生发送、配置账号回显与供应方未知证据。不支持的 `senderType` 保持未知。稳定会话 id 与买家 customer id 保持分离；会话发现和入站证据会保留该对端，以便 runtime 重启后继续单聊发送。Provider 不会用文本相等判断本人或 Agent，也不会回退到另一个商家。

出站发送使用持久买家身份，并把 runtime request id 用作平台 request id；它绝不会从会话 id 猜测 customer id。网络故障、HTTP 408 或 429、5xx、无效 JSON 或缺少回执都会保持 `unknown`。已确认发送的回执会在持久原始状态中保留可选的供应方 producer 与 revision 证据。`confirm` 查询供应方状态 endpoint，只有供应方明确确认已发送或失败时才改变结果。

监听器只在首次供应方请求和 runtime 游标回执完成后返回。其终结 handle 会在断开、计划重启与关闭时正常结束，并在后续轮询失败时拒绝，因此 runtime 不会保留过期的运行状态。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部 — 点击展开</summary>

协议层规范化查询值，并用 HMAC-SHA256 对 `METHOD`、路径、查询和时间戳签名。它在 HTTP 边界校验商家身份、游标单调性、消息类型、时间戳与必填标识。错误不会复制供应方响应正文。

Transport 层负责准入目录、逐操作凭据读取、账号检查、轮询生命周期、页面分组、发送者证据与出站结果。产品 runtime 负责账号状态、持久会话回执、供应方游标、outbox 尝试与路由。

| 源文件 | 用途 |
|---|---|
| `src/auth.ts` | 规范查询与 HMAC headers |
| `src/protocol.ts` | HTTP 调用、严格 wire 解析与回执分类 |
| `src/config.ts` | 准入商家与轮询配置 |
| `src/transport.ts` | Runtime transport 注册与生命周期 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [产品 IM runtime](../im-runtime/README.zh.md) — 持久账号、页面、游标与 outbox 行为
- [Credentials](../../packages/credentials/credentials/README.zh.md) — 不透明记录所有权与逐操作读取
- [IM 迁移决策](../../.agents/notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) — 产品包归属与 Provider 边界

-----

<a id="model-experience"></a>
## 模型体验

间接。本包向产品 runtime 提供供应方消息与发送结果。它不注册模型工具或 prompt，也不能自行提交 Agent turn。

#### KV Cache 影响

无；供应方轮询与账号检查不会组装模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 经评审的协议没有 `whoami`；商家身份只来自准入目录和成功的凭据绑定调用。
- 当前候选已有本地协议、runtime 与 Loader 证据。真实商家读取、发送、回执确认与 GUI 验收仍等待明确授权的测试账号。
- 只接收单聊及文本或 Markdown 载荷。不支持的消息格式会停止页面推进，以便安全重拉。
- 未实现经评审消息状态 endpoint 的供应方部署无法把未知发送变成已发送或失败证据。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护上下文 — 点击展开</summary>

迁移来源与保留的旧行为记录在 `UPSTREAM.json`。先构建 `@gestaltrun/dsh-im-runtime`，再运行本包的测试、类型检查与构建脚本；之后针对构建产物运行 `smoke:loader`。受控 HTTP 与 JSON Storage smoke 覆盖多会话页面接收、`all` 下的未来会话、重拉去重、断开、重连与 teardown。

</details>
