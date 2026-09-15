# Agent Note: 引擎通过现有 auth-files 拥有 GLM 账号

Status: proposed

[English](2026-09-15-account-pool-engine-owned-glm.md) | 中文

## 问题

GLM Coding Plan 必须与其他 CLIProxyAPI 账号使用同一套持久化和管理协议。第二份产品账本、第二套 GLM HTTP、按代次 TLS 或凭据文件导出，都会再实现引擎已经在磁盘上拥有的账号种类。

## 提案

### 引擎：所有账号种类共用一套 auth-file 协议

GLM Coding Plan 是 `type: "glm"` 的文件型 auth，走 `auth-dir` 和 `/v0/management/auth-files`。上传、列表、改字段、启停、删除和配额观测与 Claude、Codex 使用同一组路径。

文件合成器把该 JSON 映射到 GLM 执行器和配额轮询已经读取的运行时属性（`api_key`、`glm_site`、`base_url`，以及可选的 organization/project）。Host 经 `auth-files` POST 一份 GLM JSON 后，必须能在 `GET auth-files` 里看到 `provider: glm` 和配额信封。

没有 YAML `glm-coding-plan` 摄入，也没有 GLM 专用管理路由。

### 产品包：进程宿主 + BFF + 设置页

`@gestaltrun/dsh-account-pool` 在私有 `stateRoot` / `auth-dir` 上拉起钉住的引擎，提供花名册、登录、字段、配额刷新和模型列表的类型化 Remote，由 Host 打开 HTTPS 授权，并把一次 catalog 投影到 `ctx.llm` 的 `gestalt-account-pool`。

GLM 录入与其他 API key 账号走同一提交路径：Client 提交 GLM JSON，Host 经 `auth-files` 上传，文件由引擎拥有。配额刷新是 auth-files 信封或 `POST /v0/management/auth-files/quota?name=`。

### 无 TLS 的回环

引擎监听 `http://127.0.0.1:<port>`，`remote-management.allow-remote: false`，并使用代次私有的管理和推理密钥。Host 请求留在该 origin 和既有路径白名单上。隔离靠本机绑定加上 bearer 密钥。

## 考虑过的替代方案

**保留产品 GLM 账本并投影进 `config.yaml`。** 否决。文件型 auth 去掉重写风险，无需第二份账本。

**保留代次 TLS。** 否决。本机回环加上管理密钥已经约束进程。

**把凭据导出保留为仅 Desktop 的下载。** 否决。Auth 文件仍在引擎 `auth-dir` 供 Host 使用；渲染器不接收文件体。

**新造 `/v0/management/accounts`。** 否决。`auth-files` 已经列出运行时 auth、改字段，并携带配额信封。

## 验收标准

- 经 `/v0/management/auth-files` 上传 GLM Coding Plan JSON 后，文件落在 `auth-dir`，且 `GET /v0/management/auth-files` 返回 `provider: glm` 的账号。
- 该文件型 auth 上的 GLM 配额轮询和推理可用。
- 产品包没有 GLM 账本或 GLM 专用管理客户端；花名册就是 auth-files 列表。
- 产品包不生成 TLS 材料，用 HTTP 访问回环引擎。
- 设置页没有下载/导出控件。
- 既有 OAuth 登录、字段编辑、配额卡片和 `gestalt-account-pool` 模型注册仍然可用。

## 风险

遗留的产品 `glm-accounts.json` 会在获取锁时一次性迁到 `auth-dir`，否则密钥丢失。回环 HTTP 会把管理和推理密钥暴露给本机能连上该端口的其他进程；代次密钥和 `allow-remote: false` 仍必需。文件合成器必须把 `api_key` / `glm_site` 写到 Attributes，否则花名册看起来正常，配额和推理会静默失败。
