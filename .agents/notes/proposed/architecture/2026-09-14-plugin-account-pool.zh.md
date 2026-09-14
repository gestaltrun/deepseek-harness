# Agent Note: 产品包拥有的 CLIProxyAPI 账号池

Status: proposed

[English](2026-09-14-plugin-account-pool.md) | 中文

## 问题

Desktop 用户需要在常规设置和模型选择流程中管理供应商账号、查看配额并使用池内模型。由 Electron 拥有账号业务会迫使 Web 采用另一套实现，并把业务凭据放入 shell IPC。现有[能力架构](../../../../docs/architecture.zh.md)要求可释放的插件注册，以及完整的 Service Definition、Service Provider 和 Consumer 组合。

## 提案

完整功能实现在 `product/packages/account-pool`，作为单一产品自有包 `@gestaltrun/dsh-account-pool`。其内部 service、provider、RPC、client 和 quota 模块保持各自职责，不增加上游工作区包。该包声明自己的 bundle，仅使用既有公共依赖。它通过 `ctx.llm` 注册稳定的 `gestalt-account-pool` LLM（大语言模型）供应商；每个活动请求保留所属进程代次的私有推理权限。

Desktop 默认包含该组合。Web 可以显式选择同一 bundle。账号池 UI 拥有独立设置页，并向既有模型页页脚贡献只读的活动路由信息。页脚不增加导航回调，用户通过既有设置导航进入账号池。账号池不修改模型中心或设置导航 API，不写入 `llm-pi-ai` 设置命名空间，不恢复已移除的桌面客户端包，也不新增账号管理 Electron IPC。

持久账号配置和凭据存储必须在进程代次停止后保留。尤其是 GLM 账号变更，必须在实现再次启动时恢复；代次清理删除临时进程文件，不删除已提交的账号配置。渲染器只接收账号摘要和类型化操作，不接收管理凭据、推理密钥或通用管理 URL。

### 所有权与禁止修改的范围

全部功能实现、公共产品导出、测试、生成类型、配额版权声明、Go 构建工具和二进制资源均归 `product/packages/account-pool`。现有独立 product 工作区拥有依赖安装、自己的锁文件、编译配置、构建、测试和包产物。Desktop 仅允许修改既有产品胶水 `apps/desktop/src/product-profile.ts`、`apps/desktop/scripts/product-artifacts.ts`、`apps/desktop/tests/product-profile.spec.ts` 和 `apps/desktop/tests/product-artifacts.spec.ts`。前者加入 bundle，后者扩展产品产物清单校验；其余 `apps/**` 默认禁止修改，Electron 不增加账号业务逻辑。

禁止在 `packages/**` 或 `vendor/**` 修改、新增或发布该功能代码。禁止新增根工作区成员、根 TypeScript references 或 paths，以及根锁文件依赖。禁止通过 `patchedDependencies`、postinstall、修改 `node_modules`、上游 `/src` 导入或复制内部实现来补丁化上游依赖。尤其是上游 PiAi 适配器、选项、导出和 profile resolver 均保持不变。CLIProxyAPI 来源/构建所有权和平台二进制保留在产品包内，不向上游应用添加账号池构建逻辑。其 `UPSTREAM.json` 固定构建时来源缓存，不新增根 `.gitmodules` 或 catalog gitlink。目标平台构建只证明该目标产物，不宣称已完成全平台 npm 发布。

产品包内部声明 `ctx.accountPool`，拥有 CLIProxyAPI 实现、`accountPool` Remote 命名空间和共享 Client。[交付记录](../../../../docs/scratch/2026-09-14-account-pool-migration.zh.md)拥有冻结来源标识、保留草稿和验证状态。已有未提交的上游工作区脚手架保留，但排除在本方案及任何提交之外。

公共 Typert 生成器只发现其自身根目录下 `packages` 中由编译面引用的包。独立 product 工作区拥有这些汇总配置和 `packages/account-pool` 成员。已发布生成器在分析时需要可识别的协议声明，因此产品构建汇总精确版本的公共协议类型，并使用正常 TypeScript AMD 声明输出。两个独立严格程序比较全部导出名称和声明闭包，然后隔离分析配置仅把该协议模块映射到生成声明。正常 Host/Client 编译和运行时解析未修改的 npm 包，不含分析映射，也不跳过库检查。原样公共生成器输出十六个严格 Host 和 Client 操作；方法缺失、非严格 codec 或声明漂移均使构建失败。已发布协议或编译器变化时必须重新验证该适配，临时输入不进入产物。正常 Typert 装载注册 Host 贡献，Client 通过公共 API 挂载自己的生成 Remote 贡献。

产品构建把 core 二进制、许可证和身份清单放入自己的 `resources`，通过公共 `import.meta.resolve` 解析安装包。既有 Desktop 准备和运行时文件策略原样消费产品产物及资源。已执行的产品范围检查对照已核验基线允许清单比较已跟踪新增、修改、删除和重命名，并拒绝上游路径、依赖补丁、替换 override 和私有源码导入。产品构建、类型检查和打包调用该检查，反例验证拒绝行为。唯一分析映射是上述隔离的生成协议输入。公共能力缺失不能扩大允许清单。

用户已批准实施本纯产品包方案。交付记录区分已完成的源码/构建检查、真实 Desktop 观测和依赖账号的验收。

### 公共操作

领域品牌包括表示不透明产品身份的 `AccountPoolAccountRef`、用于凭据文件操作的 `AccountPoolAccountName`，以及表示不透明登录操作的 `AccountPoolLoginState`。Core 认证索引保留在实现内部。`AccountPoolCapabilities` 区分账号/供应商模型范围、配额可用性、导出种类和支持的编辑字段。不可用计数保持缺省。其余公共 DTO 由包的纯类型 `./types` 导出定义；快照保留配额状态、观测时间、最后有效采样和独立的失败/过期信息，不含凭据或代次端点。

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

Remote 暴露管理操作，以 `watch(signal?)` 取代 `subscribe`，先发送当前快照再发送后续已提交变更，并排除 `downloadAuthFile`。产品 RPC 模块在 `/api/account-pool.export?name=...` 拥有经过认证的 `ctx.connection.fetch.register` 处理器。实际处理器强制执行 Config `allowCredentialExport`、安全的单段文件名、`Content-Disposition: attachment` 和 `Cache-Control: no-store`。Desktop 显式启用这项用户请求的凭据文件导出，Web 组合显式选择自己的策略。普通 RPC 和快照绝不返回其原始内容。不存在通用导入或原始 URL/method/header 代理。

内部不依赖 React 的控制器拥有 watch 订阅和已提交快照，在资源释放时取消并等待 watch 结束，并提供注入 hooks；store 只保存视图状态。`AccountPoolClientActions` 为组件解包生成的 Remote 结果，组件既不使用 `window.dshDesktop`，也不使用管理 URL。编辑采用明确字段白名单；代理 userinfo 被脱敏，含凭据的 header 只暴露是否已配置以及保留/替换/删除意图。账号身份和操作代次阻止先前读取填入另一账号的弹窗。保存失败保留弹窗并显示本地化错误。过期登录状态不能完成或关闭后来的操作。

### 进程和持久状态

产品自有 `resolve(config)` 通过 `import.meta.url` 取得安装资源目录，并从产品来源记录/manifest 取得固定来源 SHA。Provider Config 校验私有 `stateRoot` 和部署选项；普通 Desktop 启动不需要新增环境变量或资源路径 API。Bundle 默认值为 `startupTimeoutMs=15000`、`restartLimit=2`、`stopGraceMs=2000`、`readinessIntervalMs=50`、`requestTimeoutMs=15000`、`maxResponseBytes=1048576`、`catalogRefreshIntervalMs=2000` 和 `quotaConcurrency=4`。凭据、端口和证书属于私有运行时状态。Desktop 选择 `$DSH_HOME/desktop/account-pool`，显式启用的 Web profile 选择自己的根目录。

根目录排他锁拒绝并发所有者。`stateRoot/auth/` 存放 core 拥有的 OAuth 文件。产品 `glm-accounts.json` 是 GLM 凭据、启停状态和支持字段的权威，core 只接收活动子集投影。Journal 在 core 更新及 ledger 原子提交之前记录每次变更。失败或重启在就绪前恢复已提交 ledger 的投影。GLM 支持备注、前缀、代理 URL、优先级和权重，其余账号字段明确不支持。其导出为产品凭据 JSON，模型目录属于供应商级别，不合成不可用的配额、健康状态和请求计数。在支持的平台上，私有目录权限为 0700，文件权限为 0600。清理仅删除 `stateRoot/generations/` 下已终止代次的随机目录；稳定凭据及无关数据保留。不读取用户默认 CLIProxyAPI home。

Provider 拥有 `ctx.subprocess` 启动、环境清理、有界诊断、终止和 `waitForExit`。Bundle 显式组合隔离的本地 subprocess 实现，使二进制、TLS 探测和子进程处于同一本地执行环境；不增加执行环境探测 API。二进制 manifest（元数据清单）绑定来源 SHA、平台、架构、文件名和 SHA-256；缺失或不匹配的资源在 spawn 前失败。启动既不搜索 PATH，也不下载代码。维护中的 X509 库生成证书，不要求用户安装 Go 或 openssl。

### 代次 TLS 与模型请求

每个代次拥有新管理密钥、推理密钥、证书、abort controller，以及只信任该证书的 `undici.Agent`。每个管理、目录、就绪和推理请求都限制精确的本地 origin、允许的路径及方法，拒绝重定向，并在发送凭据前验证同一证书。预留后关闭端口不能证明所有权。读取时即限制响应体大小；错误 JSON 和传输失败保持为错误，不伪装为空结果。

产品使用已发布的 `PiAiAdapterOptions.profiles` 和 `ResolvedPiAiProviderProfile.piProvider` 扩展点。它通过公开 `createProvider({ api: productOwnedProviderStreams })` 创建供应商；其私有 `stream` 和 `streamSimple` 包装将原始选项连同代次 fetch 和取消 signal 分别转发给公开 `openAICompletionsApi().stream` 和 `.streamSimple` 方法。原样的上游适配器继续拥有模型转换、请求准备和流转换。不需要新增适配器选项、profile-resolver 导出、复制实现或修改上游代码。每个已准备调用保留其原始不可变 profile 和代次权限。关停撤回路由并关闭准入，中止已准入调用并等待结束，终止并等待子进程，关闭 dispatcher，最后删除代次文件。不修改全局 TLS 或 fetch 设置。

产品只为自有路由组装公开的 resolved-profile DTO，不复制上游通用 resolver。产品 Config 拥有明确的限制和默认值，并继续复用公共 retry-policy 解析。产品维护目录到模型的投影和受支持 reasoning level 映射；未知能力保持未知，未支持等级保持不支持，SDK 必填 cost 字段不转化为已核验账号价格声明。薄产品适配器在请求元数据记录前选择每模型 reasoning 默认值，并完整委托公共适配器接口。公共依赖/peer 图必须通过严格编译闭合；探测需要已发布 MCP SDK `1.29.0`，它属于产品依赖验证，不是上游修改。

可行性探测在独立 npm 项目安装已发布的 dsh LLM/PiAi `0.1.5-rc.2` 和 pi-ai `0.85.1`，不使用仓库 TypeScript 别名，且设置 `skipLibCheck: false`。TypeScript 编译和本地 TLS/SSE 请求均通过。探测观测到上下文/reasoning 元数据、profile map 后续移除后已准备调用仍保留原始权限，以及错误 CA 或已退出代次均不产生 HTTP 请求。探测不使用真实供应商账号，仅证明公共 API 可行性，不是迁移账号池或产品验收证据。

目录保留来源支持的 Grokshell listing 元数据，并在 `prepareCall` 前设置 reasoning、上下文、输出限制和模态，使现有 Session 日志记录实际请求。有效且非空的目录注册 `gestalt-account-pool`；空目录或不可用目录原子撤回它。重复路由所有权明确失败。配额接收 Host 拥有的 xAI tier/user 元数据和 GLM 被动信号，保留未知/不支持/失败/过期的区分，且仅作观测：它绝不改变账号启停、调度、冷却或 reset credits。删除账号按账号引用清理配额缓存。

## 考虑过的替代方案

**复制 Electron 实现。** 其业务 IPC 和桌面专有控件与共享 Host 服务冲突，也无法提供已接受的 Web 账号管理体验。

**向模型中心设置写入普通自定义供应商。** 进程代次会改变推理凭据及其生命周期。把这些值持久化到用户模型设置会暴露私有运行时状态，并使账号池的资源释放依赖另一设置所有者。

**新增上游功能包或修改 PiAi 包装层。** 这违反用户要求上游包保持不变的硬约束。产品本地组合必须适配公共扩展点；缺少公共能力属于设计约束，不构成修改上游代码的许可。

**合并来源 fork。** 来源分支包含无关的产品、发布和工作流变更。迁移采用已接受的账号池行为和引擎版本，同时保留本仓库架构与产品默认值。

## 验收标准

- 实现 diff 不包含 `packages/**` 或 `vendor/**` 修改，不新增根依赖/编译配置，也不补丁化上游依赖或导入私有源码。产品源码和产物从独立 product 工作区解析。
- 常规 Desktop profile 启动固定版本的 CLIProxyAPI 引擎，展示账号池设置页，并通过 `ctx.llm` 注册可用模型；Web 可以显式组合相同实现。
- 账号创建、OAuth 发起与取消、API-key 账号管理、启停、模型排除、配额展示和账号删除通过类型化 Host 操作完成，并提供本地化产品反馈。
- 重启恢复持久账号配置，包括 GLM 变更；过期进程代次被拒绝，其私有凭据和所属子进程不被保留。
- 聚焦行为测试、Loader 组合、公共类型、包与构建检查以及录制输出覆盖迁移行为；原生 Desktop 交互单独记录真实产品路径，与 fixture（测试前置数据）区分。
- 回归用例观测错误 pin 的监听者收不到凭据、调用准备后的代次变更、根目录锁竞争、启动中资源释放、抛错订阅者隔离、完整进程树清理、有界 HTTP body、下载处理器拒绝未授权导出，以及通过实际 Desktop scheme 显式下载凭据文件。
- UI 保留六种供应商登录、管理/配额卡片翻面、筛选、二十格近期请求、弹窗、重置时间和配额指针。未知空轨不显示虚构填充或标记；过期/错误状态、登录关闭、弹窗身份竞态和保存失败保持可见。无密钥 Session 录制覆盖模型选择、工具调用/结果和 reasoning，不向模型输入添加配额，也不修改 Session 格式。

## 风险

所选引擎和传输需要精确的来源及可执行文件身份检查。账号凭据需要私有持久存储，进程代次则需要及时撤销及完成资源清理。供应商可用性限制真实推理验证；原生空池运行证明启动和账号管理入口状态，无法证明已认证推理。签名发布打包需要另行配置的发布环境。
