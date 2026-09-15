# Agent Note: 引擎通过现有 auth-files 拥有 GLM 账号

Status: proposed

[English](2026-09-15-account-pool-engine-owned-glm.md) | 中文

## 问题

当前[产品自有账号池](2026-09-14-plugin-account-pool.zh.md)把 GLM Coding Plan 做成第二套持久化。CLIProxyAPI 已经把 OAuth 账号写成 `auth-dir` 下的 JSON，并通过 `/v0/management/auth-files` 列出。GLM 却活在 `config.yaml` 的 `glm-coding-plan[]` 里，另有一套管理协议；产品包再持有 `glm-accounts.json`、journal，并投影进该配置数组，以免一代次重写 `config.yaml` 丢掉密钥。

这种拆分不是 UI 需求。Gestaltrun 不应再拥有第二份凭据账本、第二套 GLM HTTP、按代次钉死的 TLS，或凭据文件导出。CLIProxyAPI 已经把凭据存在磁盘上；产品 Host 应启动引擎并转发既有管理和推理 HTTP，而不是再实现账号种类。

## 提案

### 引擎：所有账号种类共用一套 auth-file 协议

GLM Coding Plan 成为 `type: "glm"` 的文件型 auth，走既有 `auth-dir` 和 `/v0/management/auth-files`。上传、列表、改字段、启停、删除和配额观测与 Claude、Codex 使用同一组路径。

由文件合成器（而不是产品包）把该 JSON 映射到 GLM 执行器和配额轮询已经读取的运行时属性（`api_key`、`glm_site`、`base_url`，以及可选的 organization/project）。Host 经 `auth-files` POST 一份 GLM JSON 后，必须能在 `GET auth-files` 里看到 `provider: glm` 和配额信封，且不必调用 `/v0/management/glm-coding-plan`。

YAML `glm-coding-plan` 数组可以保留给独立引擎的 CLI 用户。Gestaltrun Desktop 不写它，也不调用 GLM 专用管理路由。

### 产品包：进程宿主 + BFF + 设置页

`@gestaltrun/dsh-account-pool` 保留：

- 在私有 `stateRoot` / `auth-dir` 上拉起钉住的引擎
- 花名册、登录、字段、配额刷新和模型列表的类型化 Remote
- Host 拥有的 HTTPS 授权打开
- 设置页 UI
- 一次 catalog 投影到 `ctx.llm` 的 `gestalt-account-pool`

删除：

- `glm-accounts.json`、GLM journal、`GlmAccounts`、作为独立持久化路径的 `submitGlmKey`，以及作为第二套花名册的 `glmCard`
- `/api/account-pool.export`、`downloadAuthFile`、`allowCredentialExport` 和下载控件
- 按代次 TLS 证书、`selfsigned` 依赖，以及自定义 CA 的 `undici.Agent`

GLM 录入与其他 API key 账号走同一登录/提交路径：Client 提交 GLM JSON，Host 经 `auth-files` 上传，文件由引擎拥有。配额刷新是 `GET auth-files`（被动信封）或引擎既有的按账号探测，而不是产品侧解析第二套协议。

### 无 TLS 的回环

引擎监听 `http://127.0.0.1:<port>`，`remote-management.allow-remote: false`，并使用代次私有的管理和推理密钥。Host 请求留在该 origin 和既有路径白名单上。隔离靠本机绑定加上 bearer 密钥；一次性证书不是必要部分。

## 考虑过的替代方案

**继续以 `glm-accounts.json` 为产品权威并投影进 `glm-coding-plan`。** 否决。它只是因为引擎把 GLM 放在每次 `configure()` 都会重写的配置数组里。把 GLM 放到 `auth-dir` 即可去掉重写风险，无需第二份账本。

**去掉 GLM 账本但保留代次 TLS。** 否决。该证书是新鲜的自签名服务端证书，写在 `generations/` 下，并在内存里钉为 `undici` 唯一 CA。它不是长期 CA；本机回环加上管理密钥已经约束进程。证书、密钥文件和 `selfsigned` 都是多余活动件。

**把凭据导出保留为仅 Desktop 的下载。** 否决。用户不需要它。Auth 文件仍在引擎 `auth-dir` 供 Host 使用；渲染器不接收文件体。

**新造 `/v0/management/accounts`。** 否决。`auth-files` 已经列出运行时 auth、改字段，并携带配额信封。GLM 一旦有 `path`，就应出现在那里。

## 验收标准

- 经 `/v0/management/auth-files` 上传 GLM Coding Plan JSON 后，文件落在 `auth-dir`，且 `GET /v0/management/auth-files` 返回 `provider: glm` 的账号。
- 该文件型 auth 上的 GLM 配额轮询和推理不依赖 `config.yaml` 的 `glm-coding-plan` 条目。
- 产品包没有 GLM 账本、journal 或 GLM 专用管理客户端；花名册就是 auth-files 列表。
- 产品包不生成 TLS 材料，用 HTTP 访问回环引擎。
- 设置页没有下载/导出控件；不存在 `/api/account-pool.export`。
- 既有 OAuth 登录、字段编辑、配额卡片和 `gestalt-account-pool` 模型注册仍然可用。

## 风险

只存在于 `glm-accounts.json` 的既有 Desktop GLM 密钥必须一次性迁到 `auth-dir` JSON，否则升级会丢失。仍使用 YAML `glm-coding-plan` 的独立 CLI 用户保留该摄入路径；产品路径不得依赖它。回环 HTTP 会把管理和推理密钥暴露给本机能连上该端口的其他进程；代次密钥和 `allow-remote: false` 仍必需。文件合成器必须把 `api_key` / `glm_site` 写到 Attributes，否则花名册看起来正常，配额和推理会静默失败。
