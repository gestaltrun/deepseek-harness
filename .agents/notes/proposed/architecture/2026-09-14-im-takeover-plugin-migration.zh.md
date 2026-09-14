# Agent Note: 将 IM 接管迁入 product 工作区

Status: proposed

[English](2026-09-14-im-takeover-plugin-migration.md) | 中文

## Problem

旧 `gestaltrun/deepseek-harness-gestalt` 项目已认可的 IM 接管规格与原型涵盖 DWS 钉钉员工账号、旺旺账号、工作区路由和隔离的双 Session 模拟。产品设计继续有效。目标仓库 `375e2838dec1ff3fba7730256b9bfda2a17c1983` 的 Client 组合与插件分发规则不同；整支合并还会引入无关应用、依赖和构建改动。

迁移输入为已保全的总入口 `e49ef377`、Host 树 `17ce1b29` 加五个已跟踪脏文件，以及 UI 树 `8380c365` 加六个已跟踪脏文件。已认可档案位于旧树 `.agents/design/im-takeover/`。源码保全和已有测试证明输入可恢复，不证明在目标仓库已经完成或验收；旧议题编号不指向新仓库议题。

## Proposal

用户于 2026-09-14 认可本 product 架构方向并授权实施。本文保持 proposed，直到实现与产品验收证明交付行为。[迁移交付说明](../../../design/im-takeover/migration-delivery.md) 保留已认可的旧规格、原型和工作单元。上游包例外仍须单独说明不改的具体影响并取得确认。

IM 主体放在本仓库独立的 `product/` 工作区，遵循现有 [Model Center](../../../../product/model-center/README.zh.md) 模板。尽可能保留上游 fork 进来的 `packages/` 实现。产品模块消费公共服务与 slots；公开组合无法保留已认可入口时，可在 product 内维护记录精确来源的有限源码适配。任何确有必要的上游包修改，必须先说明不修改的具体功能影响、product-only 替代方案和最小改动，再由用户确认。Web 与 Desktop 共用领域实现、生成 API 和 UI。需求与原型继续有效，本稿整体替代此前另建独立插件仓库的建议。

建议在 `product/` 下组织五个代码包与一个分发 bundle：`im-runtime`、`im-dingtalk`、`im-wangwang`、`api-im`、`ui-im`、`im-bundle`。包名采用既有 `@gestaltrun/dsh-*` 命名，`repository.directory` 指向对应 `product/<name>`。独立 workspace 显式纳入目录，build/test/typecheck/pack 脚本选择这些包，产物进入 `product/dist`。账号、路由、投递、执行和模拟保持包内私有模块，不按概念层机械拆包；包名是方案建议，不表示已发布。

| 建议包 | 职责与能力角色 |
|---|---|
| `product/im-runtime` | Host 领域服务、持久记录、Session 编排、独立 subpath 的作用域工具 Consumer，以及本地模拟 Provider。具体 Cordis 注册服务 `ImTransports` 是平台注册的 Service Definition；不导入 GUI 或平台 Provider。 |
| `product/im-dingtalk` | Provider，负责已安装 DWS 的公开命令、员工登录态、供应方证据、事件消费生命周期与回执。 |
| `product/im-wangwang` | Provider，负责已准入商家目录、endpoint 与凭据解析、轮询和回执。 |
| `product/api-im` | Host BFF Consumer、生成 Remote 入口，以及提供快照和订阅的无框架 Client 对象。领域服务不携带 GUI 专用 Remote 方法。 |
| `product/ui-im` | 已认可的账号、工作区和会话组件、类型化词典、slots、草稿与选择状态。业务记录留在 Client 对象层。 |
| `product/im-bundle` | 有序 Host、Client 配置行及显式依赖，不增加运行时服务。 |

transport 注册服务接收供应方能力说明，并为账号检查、会话发现、入站投递、出站发送和回执确认提供可撤销注册。运行时 Consumer 使用标准身份、消息证据、取消信号和明确发送结果；平台登录步骤留在 Provider。真实与模拟共用入站与发信工具，由可信执行绑定选择 Provider；模型参数不能任意指定真实账号或其他模拟实例。

## Host 与 Client 集成

| 已认可入口 | 接入方式与上游影响 |
|---|---|
| 右侧 IM 会话/模拟面板 | 通过 `sidebarRightTabs` 加 `sidebar.right.pane.tab` 注册 product UI，不替换侧栏、不修改上游包。 |
| 全局 IM Accounts | 通过现有 `settings.section` 注册 product UI。 |
| 工作区设置入口与弹层 | 单独评审工作区行菜单接入；product 整区适配仅针对左侧工作区浏览区，绝非 IM 右侧面板需要。 |

当前 [Client 规则](../../../../packages/client/AGENTS.md) 要求业务数据位于对象层、组件只接收 props、功能插件不互相运行时导入、Host/Client 编译面分离，并通过 `ctx.slots.inject` 注册。BFF 串行化、稳定错误、完整基线后有序增量和重连替换基线沿用 [Workspace Controller](../../../../packages/api/workspace-controller/README.zh.md) 模式。`follow()` 随连接代次关闭并清理订阅；迟到的一元响应不能覆盖较新的流状态。

现有 `settings.section`、`sidebarRightTabs` 和 `sidebar.right.pane.tab` 支持 product 持有全局与会话入口。目标 Better Sidebar pin `e656717672d83f9c21879d4ba8439799d9acf9ba` 使用同一原生右侧栏能力。工作区行菜单没有公开 action slot，但 `sidebar.workspaces` 是可替换的公开 single slot。建议在 product 内维护整块 Workspace browser 呈现适配，保留实际被点击的 Workspace id 和认可设置入口。上游源码不变，`UPSTREAM.json` 记录适配来源与许可；搜索、拖拽/排序、重命名/删除、Session 行、导航和目录选择均须保留并回归。这会扩大 product 的维护责任；全局 Settings 里另选工作区会改变已认可体验，不作为替代。

产品接入改动包括 `product/package.json`、workspace/lock/build 声明、包清单与 bundle patch，以及 `apps/desktop/src/product-profile.ts` 的产品 bundle 清单。这些是产品交付接入，与修改上游业务包分开。Web 通过显式 product bundle/profile overlay 装配，不默认改上游 `base` 或 `web-app`。product 自有生成步骤已解决公开编译器的构建期 workspace 约束，未修改运行时 Loader。仍须用干净打包安装 smoke 证明 Host 注册、真实 Remote 调用和浏览器模块发现，再决定是否存在运行时 loader 例外。Electron 壳、上游 API、工作区和 agent-loop 包不持有 IM 表、凭据、平台代码或业务分支。

### 需明确 review 的上游例外

| 可能的上游修改 | 保持不改的具体影响 | product-only 路径与决定 |
|---|---|---|
| `ui-workspace` 的工作区行动作 slot | 由 product 维护整块 browser 适配时不丢必需功能，但上游同步与回归范围更大。 | 默认采用 product 适配。少量 typed 行动作 slot 可降低维护成本，但只是可选例外，并非不可避免，须用户确认。 |
| Typert 构建输入与运行时 Loader | 固定编译器要求 workspace 布局和 protocol 声明项目，product 自有暂存已提供两者；打包后运行时调用仍待验证。 | 保持上游编译器和 Loader 不变，在私有构建输入中使用公开声明生成，再验证打包产物和真实 Remote 调用；仅复现运行时缺口后才提出上游例外。 |
| `base` / `web-app` 默认值 | 原版上游 profile 不显示产品 IM 入口。 | 交付显式 Web product overlay 与 Desktop 产品清单，不提议修改上游默认 bundle。 |

任何 `packages/` 例外都必须先展示以上不改影响，再取得用户对具体改动的确认。product 源码适配不能通过 DOM 注入、未公开导入或未记录的私有实现依赖伪装零修改。

### Product 自有 Remote 生成

固定公开版本 `@deepseek-ai/dsh-typert-generator@0.1.5-rc.2` 从编译根的 `packages` 目录发现项目，并通过已注册的 workspace protocol 声明项目识别 Remote marker。直接选择 product 项目，或仅迁移源码位置但不提供该声明项目，都可能得到零 Remote 产物。这是构建期发现与声明身份约束，不证明运行时 Loader 无法加载外置插件。

product 构建 helper 将未改写的 API 及被引用 product 源码、真实已发布 protocol 声明复制到私有临时编译树，仅选择 API 包生成 Host reflection 与 Remote Client 产物，之后删除临时树。生成文件保留正式包导入及相对声明映射。检查拒绝缺失或空 Remote 输出，要求完整预期方法集、无私有绝对路径，并比对两个独立根的输出字节；无效导出与并发构建亦有覆盖。已验证的首个真实 API 检查点包含 13 个 Remote 方法；增加方法必须更新预期集合并重跑生成检查。此检查点证明生成，不代表打包调用或 GUI 验收。

DTO 必须由所属包声明并通过公开、Client-safe 的非根入口导出，例如 `./types`，同时交付真实 JavaScript 与声明产物。仅在 Client 增加 type-only re-export，不能为生成器建立 DTO 的公开 owner。product workspace 通过 override 固定 Zod 为 `4.4.3`，与基线 schema 接口一致，上游包实现保持不变。helper、复制的 protocol 声明和编译器属于构建输入，不进入运行时包内容。

## 配置与路由

可校验 Cordis Config 持有 executable、endpoint、轮询周期、重试上限和已准入商家目录等部署选项。[StorageDomain](../../../../packages/storage/storage-domain/README.zh.md) 持有账号、路由、工作区模拟目标、操作结果和投递进度；设置页面位置不意味着这些记录是普通偏好。[Credentials](../../../../packages/credentials/credentials/README.zh.md) 持有秘密记录与引用。只写账号接入动作保存凭据、验证供应方身份，再发布安全账号元数据；失败或部分接入有明确状态，表单不伪造 `connected` 或凭据引用。DWS 环境登录态与旺旺配置身份保持区分。

路由键包含平台、账号、会话类型与全部/指定目标，完整元组编码不得发生分隔符碰撞。指定规则即使停用也优先；全部规则动态覆盖未来会话。运行时统一解析路由，并把 Workspace id、规则身份、变更令牌和目标固定到每次已接收执行；改绑影响后续接收，运行任务保留原工作区与普通权限。停用抑制待发 AI 消息，重启用不补发；账号暂停保留人工发送与模拟。

采用单账号路由聚合记录，使唯一性校验与条件替换发生在同一个串行记录更新内。显式改绑必须携带观察到的不透明变更令牌，每次变更均生成新令牌，包括删除后重建；普通保存不能转移归属。多目标编辑保留逐项目请求 id 与结果：已应用、冲突、拒绝或结果未知。每项目操作身份及可查询结果与路由变更在同一次账号聚合原子记录更新中提交，不另表补写结果。确认所有受影响目标、保留未完成草稿，未知操作先查询再重试。本方案选择可见的部分结果，不承诺跨目标全有或全无；StorageDomain 不提供跨表事务。

## 投递与 Session 归属

运行时持有从供应方入站落盘到路由解析、触发判定、Agent 创建/恢复、输入接收和出站投递的生产链路。即使之后没有新入站事件，也调度固定周期检查。提及触发使用供应方证据，不靠正文匹配 `@bot`。OR 条件提交一个有身份的批次、统计未提交消息，并保留已认可的最近安全 step 边界，不取消正在运行的模型或工具。

业务记录持有入站/出站证据、游标和仅查询的导入历史。模型可见来源、发送者分类、触发原因与执行绑定必须能从 Session 事件重建。插件扩展 `MessageSourceMap`，在普通有身份的 `user/message` 与持久 inbox 事件足以承载时复用；额外事实使用类型化 Session 事件，不走不可见的实时 prompt 旁路。本人消息证据未知则保留未知，IM 文本不产生 owner 审批。

Session 日志与领域记录不能跨库原子提交。先保存带稳定消息身份的批次意图，通过普通 Agent 入队，等待 Session 持久化，再记录业务提交。恢复时按身份比对持久 inbox 与 Session 已接收消息，之后才决定是否再次入队。被拒绝或取消的输入单独记录处置，入队不证明模型已经读取。单会话控制器串行接收并持有关闭流程。出站先保存意图；外部结果不明保留 `result_unknown`，不盲目重试。

## 模拟生命周期

创建校验真实模拟用户 Session 及其工作区归属、为该模拟用户 Session 保留当前活动实例关系，其他 Session 仍可独立并行测试同一目标，通过 `ctx.agents.create` 创建被测 Agent、挂载目标 preset 与工作区策略、关联并落盘 Session，最后发布运行中的双端关联。实例持有被测 Agent handle 与归属于该实例的派生工作。可恢复创建记录区分部分创建和运行实例；失败时收敛或销毁所持工作，不伪造 Session id、不删除用户 Session。

创建时固定目标、被测工作区、身份名单和来自规则的触发配置。清除或更改模拟设置只影响新实例。模拟工具仅向符合条件的模拟用户 Agent 注册，且保留操作既有实例的能力。被测 Agent 使用与真实接管相同的发信/历史工具及可信实例绑定。每条模拟输出只回本实例，并可经同一日志输入链路唤醒模拟用户侧。导入 JSONL 保持历史用途，不唤醒任何一端。

单实例生命周期控制器先持久化 `stopping`，关闭新投递，再仅取消归属于本实例的双端活动与派生工作，静止后发布 `stopped`。GUI 调用等待终态；实际作用域 stop-tool 调用方得到 `stopping`，不等待自身 turn，终态在其完成后收敛。调用者身份来自可信 Agent/initiator 上下文，不接受 Remote 字段。停止操作去重，但各调用者等待策略分开，保证 GUI 先/工具后和工具先/GUI 后均收敛。保留模拟用户 Session 与无关活动。

重载恢复记录并校验真实 Session 关联；普通 Session 恢复策略决定 Agent 是否运行，打开 IM UI 不自动恢复执行。持久 `stopping` 根据实际未收敛工作核对，显式 `stopped` 永不恢复。已发布 Session 各代文件遵循[现有迁移规则](../../../../docs/session-format-status.zh.md)，保持不可变。旧实验领域数据在核清实际 schema 后单独决定导入方式，不静默覆盖。

## 分发与复用

包发布、profile 装配和账号实时接管分开。建议 Desktop 经既有产品清单携带打包的 IM bundle，Web 使用显式产品 profile/overlay，在两个交付产品路径中保留已认可入口，不静默改上游 base/web-app 默认值。新账号配置前没有启用路由，Provider 激活前校验凭据和商家准入。Headless 产品组合只选择 Host 行与作用域工具，preset 不复制共享账号服务。

在独立 `product/` workspace 构建和打包。各包按 Model Center 模板，在 `UPSTREAM.json` 记录来源仓库、旧精确 commit、保全脏 patch 身份、许可和必要的源码适配。运行代码、生成 Typert、Client 资源与声明只用公共 Host 导出及匹配 peers。CLI/Web 通过受支持的 `dsh plugin` 与 profile 组合安装产品 bundle；Desktop 通过壳持有的事务和保留 profile 消费 `product/dist`。[Desktop 插件规则](../../implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md) 继续管理共享模块身份。须验证源目录不可用时的干净安装。

对齐接口后复用认可布局、类型化词典、发送者/结果术语、适配器解析夹具和有效路由/投递测试。重建生产入站协调器、账号接入 BFF、条件多目标保存、Client 对象订阅与停止操作归属。不带入旧根 lockfile、整份 base/web 配置、侧栏私有传输、仅夹具使用的控制器、虚构连接状态或旧 tracker 流程。

## Alternatives considered

**把旧分支直接合入上游包，或另建插件仓库。** 两者均不符合已指定的 product 归属：前者把 fork 功能混入上游，后者绕开本仓库既有 product workspace。选择性迁移保全功能差量到 `product/`，保留来源身份，沿既有产品构建与分发路径交付。

**每个概念层各建一个包。** 账号、路由、触发、outbox 和模拟共同持有接收与恢复规则，私有模块可保持局部性；独立平台 Provider、GUI API 与 UI 才有实际的独立 Consumer 和编译需要。

**用钉钉机器人 SDK 替代 DWS。** 已认可功能要求授权员工身份；应用事件 SDK 不证明该身份或 DWS 登录语义。保留既定 CLI adapter，仅在证据审阅后参考 SDK 回调生命周期机制。

**增加数据库/队列服务以获得分布式事务。** 第二个持久化权威不能把平台回执与 Session 日志变成同一事务。复用现有领域写入、稳定请求身份和显式核对，本次不引入 Redis 或第二套 Session 存储。

## Acceptance criteria

- 领域与可控并发测试证明完整路由元组隔离、停用指定优先、动态全部匹配、包含 ABA 的新令牌 CAS、多目标部分/未知结果、运行工作固定归属、投递去重及所有停止调用顺序；崩溃探针覆盖领域/Session 各提交间隙与部分双端创建。
- 真实 Loader/profile 组合证明 adapter 入站自动到达普通 Agent，模拟返回正确双端；真实 Session JSONL 加持久领域后端须跨新进程恢复，Memory domain 与 `flush=true` 桩不足以证明。错误配置和冲突注册必须明确失败。
- recorded-session snapshots 覆盖来源/权限标记、发送者分类、steer、共享发信/历史工具、模拟终态和 transcript 呈现；Session 事件或生命周期变化同步两套 SDK expected 投影。包内 assembled 测试单独列证据。
- 打包安装验证精确版本、Host/Client 共享身份、生成 RPC、资源、重启、插件停用和所选 Web/Desktop profile 组合。GUI 按认可的 79 项清单走查真实双 Session 导航、订阅重连、多目标冲突和账号接入。真实供应方/模型调用与外发限定在指定且已授权的测试范围。

## Risks

保全代码存在未完成的生产接线。静态检查未发现 `admitInbound` 的生产调用或事件订阅，平台和模拟方法写入消息但未调用它；UI 账号映射丢弃表单凭据并声明 `connected`，保存路径仍发送一个路由请求。这些是限定范围的源码观察，不是产品运行失败报告；历史测试仍证明其实际执行过的层次。

已确定的归属是 `product/`，默认保留上游包。已认可的实施方向包括 runtime/Provider/API/UI 内部分层、product 自有工作区设置适配、聚合 CAS 与部分结果语义，以及 Desktop/Web 产品组合。product-only 入口保真、打包后 Host/Client Remote 调用、旧数据导入范围、真实平台回执与派生工作归属仍需证据；已验证的生成检查点不替代这些运行时义务。任何上游例外必须先展示不改影响与 product-only 替代，再请求用户对具体修改确认；本方案不授权任何此类例外。

本方案保留活动的 capability-seam、Client 组合、profile bundle、Desktop 插件与 Session 迁移决议，不取代或归档任何一篇。架构认可后仍保持 proposed，直到实施和验收证明实际交付行为。
