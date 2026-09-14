# Agent Note: 插件拥有的 CLIProxyAPI 账号池

Status: proposed

[English](2026-09-14-plugin-account-pool.md) | 中文

## 问题

Desktop 用户需要在常规设置和模型选择流程中管理供应商账号、查看配额并使用池内模型。由 Electron 拥有账号业务会迫使 Web 采用另一套实现，并把业务凭据放入 shell IPC。现有[能力架构](../../../../docs/architecture.zh.md)要求可释放的插件注册，以及完整的 Service Definition、Service Provider 和 Consumer 组合。

## 提案

组合五个包：使用品牌标识符的供应商中立账号池服务、拥有 Go 进程和私有管理操作的 CLIProxyAPI 实现、只读配额库、窄范围 Typert 账号池 API，以及共享账号池设置客户端。CLIProxyAPI 实现通过 `ctx.llm` 注册稳定的 `gestalt-account-pool` LLM（大语言模型）供应商。每个活动适配器在内部持有所属进程代次的推理凭据。

Desktop 默认包含该组合。Web 可以显式选择同一 bundle。账号池 UI 拥有独立设置页，并向既有模型页页脚贡献只读的活动路由信息。页脚不增加导航回调，用户通过既有设置导航进入账号池。账号池不修改模型中心或设置导航 API，不写入 `llm-pi-ai` 设置命名空间，不恢复已移除的桌面客户端包，也不新增账号管理 Electron IPC。

持久账号配置和凭据存储必须在进程代次停止后保留。尤其是 GLM 账号变更，必须在实现再次启动时恢复；代次清理删除临时进程文件，不删除已提交的账号配置。渲染器只接收账号摘要和类型化操作，不接收管理凭据、推理密钥或通用管理 URL。

### 包所有权

五个行为包是 `packages/llm/account-pool`、`packages/llm/account-pool-cliproxy`、`packages/llm/cliproxy-quota`、`packages/api/account-pool` 和 `packages/client/ui-account-pool`。包名依次为 `@deepseek-ai/dsh-account-pool`、`@deepseek-ai/dsh-account-pool-cliproxy`、`@deepseek-ai/dsh-cliproxy-quota`、`@deepseek-ai/dsh-api-account-pool` 和 `@deepseek-ai/dsh-client-ui-account-pool`。第六个包 `packages/bundle/account-pool` 名为 `@deepseek-ai/dsh-account-pool-bundle`，仅挂载 Provider、API 和 UI。抽象服务与库是依赖，不是被挂载的插件。

`AccountPool extends Service` 是声明 `ctx.accountPool` 的默认导出。`CLIProxyAccountPool extends AccountPool` 是实现包的默认导出。`AccountPoolController extends TypertRemoteService` 暴露 `accountPool` 命名空间。领域导出不依赖 Client、Electron、Go 或 HTTP。[交付记录](../../../../docs/scratch/2026-09-14-account-pool-migration.zh.md)拥有冻结来源标识和验证状态。

### 公共操作

领域品牌包括对应 core `auth_index` 的 `AccountPoolAccountRef`、对应 core 文件名的 `AccountPoolAccountName`，以及对应不透明登录操作的 `AccountPoolLoginState`。它们是不同的 `Branded` 值。`AccountPoolLoginKind` 是 `anthropic | codex | antigravity | kimi | xai | glm`；`AccountPoolPhase` 是 `starting | ready | error`。领域 DTO 为 `AccountPoolSnapshot`、`AccountPoolAccount`、`AccountPoolLoginStart`、`AccountPoolQuotaWindow`、`AccountPoolEditableFields`、`AccountPoolFieldPatch` 和 `AccountPoolModel`，从冻结来源的对应桌面类型投影。快照保留配额状态、观测时间、最后有效采样及单独的失败/过期信息，不包含原始凭据或代次端点。

每个异步服务操作最后接收可选的 `AbortSignal`。下表冻结十七个服务操作；表中 `Snapshot` 表示 `AccountPoolSnapshot`，全部异步结果均为 `Promise` 值。

| 操作 | signal 前的输入 | 结果 |
| --- | --- | --- |
| `getSnapshot` | 无；同步 | `Snapshot` |
| `subscribe` | 快照监听器；同步 | 释放函数 |
| `refresh` | 无 | `Snapshot` |
| `setEnabled` | 账号名称、布尔值 | `Snapshot` |
| `deleteAccount` | 账号名称 | `Snapshot` |
| `startLogin` | 登录种类 | `AccountPoolLoginStart` |
| `loginStatus` | 登录状态 | `Snapshot` |
| `cancelLogin` | 登录状态 | `Snapshot` |
| `dismissLogin` | 无 | `Snapshot` |
| `submitCallback` | `{ provider: AccountPoolLoginKind; redirectUrl: string }` | `Snapshot` |
| `submitGlmKey` | `{ apiKey: string; site: 'cn' \| 'international'; organization?: string; project?: string }` | `Snapshot` |
| `refreshQuota` | 账号引用 | `Snapshot` |
| `refreshAllQuota` | 无 | `Snapshot` |
| `listModels` | 账号名称 | 只读 `AccountPoolModel[]` |
| `readFields` | 账号名称 | `AccountPoolEditableFields` |
| `patchFields` | 账号名称、`AccountPoolFieldPatch` | `Snapshot` |
| `downloadAuthFile` | 账号名称 | `{ name: string; body: string }`，仅限 Host |

Remote 暴露管理操作，以 `watch(signal?)` 取代 `subscribe`，先发送当前快照再发送后续已提交变更，并排除 `downloadAuthFile`。API 在 `/api/account-pool.export?name=...` 拥有经过认证的 `ctx.connection.fetch.register` 处理器。实际处理器强制执行 Config `allowCredentialExport`、安全的单段文件名、`Content-Disposition: attachment` 和 `Cache-Control: no-store`。Desktop 显式启用这项用户请求的凭据文件导出，Web 组合显式选择自己的策略。普通 RPC 和快照绝不返回其原始内容。不存在通用导入或原始 URL/method/header 代理。

内部不依赖 React 的控制器拥有 watch 订阅和已提交快照，在资源释放时取消并等待 watch 结束，并提供注入 hooks；store 只保存视图状态。`AccountPoolClientActions` 为组件解包生成的 Remote 结果，组件既不使用 `window.dshDesktop`，也不使用管理 URL。编辑采用明确字段白名单；代理 userinfo 被脱敏，含凭据的 header 只暴露是否已配置以及保留/替换/删除意图。账号身份和操作代次阻止先前读取填入另一账号的弹窗。保存失败保留弹窗并显示本地化错误。过期登录状态不能完成或关闭后来的操作。

### 进程和持久状态

Provider Config 校验绝对路径 `resourceDirectory` 和 `stateRoot`、`expectedSourceSHA` 以及部署选项。Bundle 默认值为 `startupTimeoutMs=15000`、`restartLimit=2`、`stopGraceMs=2000`、`readinessIntervalMs=50`、`requestTimeoutMs=15000`、`maxResponseBytes=1048576`、`catalogRefreshIntervalMs=2000` 和 `quotaConcurrency=4`。凭据、端口和证书属于私有运行时状态。Desktop 选择 `$DSH_HOME/desktop/account-pool`，显式启用的 Web profile 选择自己的根目录。

根目录排他锁拒绝并发所有者。`stateRoot/auth/` 存放 core 拥有的 OAuth 文件；`stateRoot/config.yaml` 保留已验证的 core 账号配置，包括 GLM 管理写入。在支持的平台上，私有目录权限为 0700，文件权限为 0600。停止代次的运行时字段在启动前替换，账号字段保留。仅删除 `stateRoot/generations/` 下已终止代次的随机目录；稳定配置及无关数据保留。不读取用户默认 CLIProxyAPI home。

Provider 拥有 `ctx.subprocess` 启动、环境清理、有界诊断、终止和 `waitForExit`。Bundle 显式组合隔离的本地 subprocess 实现，使二进制、TLS 探测和子进程处于同一本地执行环境；不增加执行环境探测 API。二进制 manifest（元数据清单）绑定来源 SHA、平台、架构、文件名和 SHA-256；缺失或不匹配的资源在 spawn 前失败。启动既不搜索 PATH，也不下载代码。维护中的 X509 库生成证书，不要求用户安装 Go 或 openssl。

### 代次 TLS 与模型请求

每个代次拥有新管理密钥、推理密钥、证书、abort controller，以及只信任该证书的 `undici.Agent`。每个管理、目录、就绪和推理请求都限制精确的本地 origin、允许的路径及方法，拒绝重定向，并在发送凭据前验证同一证书。预留后关闭端口不能证明所有权。读取时即限制响应体大小；错误 JSON 和传输失败保持为错误，不伪装为空结果。

现有 `PiAiAdapter` 仅增加转发给 `streamSimple` 的可选 `fetch` 选项，其包以 `resolvePiAiProviderProfiles` 为名公开导出现有 profile resolver。固定的 pi-ai 产物支持 HTTP 的 `ProviderRequestOptions.fetch`；这不能证明 WebSocket 支持。每个账号池代次使用独立的不可变 profile map、API-key resolver、自定义 fetch 和 OpenAI completions/SSE 适配器。已准备的调用保留原代次权限。关停撤回路由并关闭准入，中止已准入调用并等待结束，终止并等待子进程，关闭 dispatcher，最后删除代次文件。不修改全局 TLS 或 fetch 设置。

目录保留来源支持的 Grokshell listing 元数据，并在 `prepareCall` 前设置 reasoning、上下文、输出限制和模态，使现有 Session 日志记录实际请求。有效且非空的目录注册 `gestalt-account-pool`；空目录或不可用目录原子撤回它。重复路由所有权明确失败。配额接收 Host 拥有的 xAI tier/user 元数据和 GLM 被动信号，保留未知/不支持/失败/过期的区分，且仅作观测：它绝不改变账号启停、调度、冷却或 reset credits。删除账号按账号引用清理配额缓存。

## 考虑过的替代方案

**复制 Electron 实现。** 其业务 IPC 和桌面专有控件与共享 Host 服务冲突，也无法提供已接受的 Web 账号管理体验。

**向模型中心设置写入普通自定义供应商。** 进程代次会改变推理凭据及其生命周期。把这些值持久化到用户模型设置会暴露私有运行时状态，并使账号池的资源释放依赖另一设置所有者。

**合并来源 fork。** 来源分支包含无关的产品、发布和工作流变更。迁移采用已接受的账号池行为和引擎版本，同时保留本仓库架构与产品默认值。

## 验收标准

- 常规 Desktop profile 启动固定版本的 CLIProxyAPI 引擎，展示账号池设置页，并通过 `ctx.llm` 注册可用模型；Web 可以显式组合相同实现。
- 账号创建、OAuth 发起与取消、API-key 账号管理、启停、模型排除、配额展示和账号删除通过类型化 Host 操作完成，并提供本地化产品反馈。
- 重启恢复持久账号配置，包括 GLM 变更；过期进程代次被拒绝，其私有凭据和所属子进程不被保留。
- 聚焦行为测试、Loader 组合、公共类型、包与构建检查以及录制输出覆盖迁移行为；原生 Desktop 交互单独记录真实产品路径，与 fixture（测试前置数据）区分。
- 回归用例观测错误 pin 的监听者收不到凭据、调用准备后的代次变更、根目录锁竞争、启动中资源释放、抛错订阅者隔离、完整进程树清理、有界 HTTP body、下载处理器拒绝未授权导出，以及通过实际 Desktop scheme 显式下载凭据文件。
- UI 保留六种供应商登录、管理/配额卡片翻面、筛选、二十格近期请求、弹窗、重置时间和配额指针。未知空轨不显示虚构填充或标记；过期/错误状态、登录关闭、弹窗身份竞态和保存失败保持可见。无密钥 Session 录制覆盖模型选择、工具调用/结果和 reasoning，不向模型输入添加配额，也不修改 Session 格式。

## 风险

所选引擎和传输需要精确的来源及可执行文件身份检查。账号凭据需要私有持久存储，进程代次则需要及时撤销及完成资源清理。供应商可用性限制真实推理验证；原生空池运行证明启动和账号管理入口状态，无法证明已认证推理。签名发布打包需要另行配置的发布环境。
