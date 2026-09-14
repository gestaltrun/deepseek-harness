# CLIProxyAPI 账号池交付记录

[English](2026-09-14-account-pool-migration.md) | 中文

## 摘要

本临时交付参考记录提议中的账号池能力向 `gestaltrun/deepseek-harness` 的迁移。[提议中的 Agent Note](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有架构和验收标准。当迁移的已接受候选版本及最终证据记入交付 PR（Pull Request）后，本记录到期。

## 目录

- [冻结输入](#input-revisions)
- [交付所有权](#owner-assignments)
- [证据与交接](#acceptance-evidence)
- [开发笔记](#execution-scratch)

<a id="input-revisions"></a>

## 冻结输入

| 输入 | 标识 |
| --- | --- |
| 目标基线 | `gestaltrun/master` 上的 `375e2838dec1ff3fba7730256b9bfda2a17c1983`；原始干净的 `c291e7961a515f6d7af9304e7fd1d257929aef26` 通过 `--ff-only` 前移。 |
| 集成分支 | `codex/migrate-cliproxyapi-account-pool-20260914` |
| 来源工作区 | `cliproxyapi-merger`，来源 HEAD `0f11d3e411de41b1eeff69dbb08f8c65d803b4be` 加十个已跟踪的工作区修改。 |
| 引擎 | `gestaltrun/CLIProxyAPI` 的 `1d25ceb7f38736880880a5a0d9e08ebb5349d950`；来源子模块干净。 |
| 本地来源快照 | `tmp/account-pool-migration-20260914/source-freeze`，109 个已跟踪的源文件；不包含个人账号或环境文件。 |
| 来源清单 SHA-256 | `9985e7c6bd3383928cb3fb1b510f2a3b20fc1bb7c0ae27623c4c92c1a2213165` |
| 工作区补丁 SHA-256 | `c881c3a4de8c53aaa24f870be3883af13af54d21029ab495bd8815e2ebaedfc4` |

来源保持只读。迁移排除无关 fork 能力和个人凭据。后续主线前移需要明确的集成决定，不能静默替换本输入版本。

<a id="owner-assignments"></a>

## 交付所有权

一个端到端迁移 ticket 拥有完整账号管理和模型使用路径。实施暂停，等待用户审阅修订后的纯产品包方案；没有负责人处于可实施状态。既有 worktree 和未提交脚手架原地保留，不移动或删除。

| 职责 | 负责人 | 未来允许的实施范围 | 当前状态 | 下一检查 |
| --- | --- | --- | --- | --- |
| 领域、运行时和 RPC | 后端负责人 | 仅限 `product/packages/account-pool` 内部模块 | 暂停；旧新增包脚手架被排除 | 已验证发布版适配器/传输可行性；等待用户审阅方案。 |
| 共享设置 UI | UI 负责人 | 产品包 Client、控制器、字典和测试 | 暂停；旧上游客户端脚手架被排除 | 已核验公共 package-mode Remote 和 Client 装载方案；等待用户审阅。 |
| 产品产物与集成 | 交付/环境负责人 | 产品拥有的来源固定、Go 资源/构建、独立 product 锁文件/构建、两个准许的 Desktop 产品胶水文件及其测试 | 规划修订中；本轮未授权 Go 构建或打包 | 发布完整修订所有权和公共 API 方案供用户审阅。 |

硬约束排除所有 `packages/**` 和 `vendor/**` 实现修改、根工作区/编译/依赖新增、上游 `patchedDependencies` 或 postinstall 补丁、修改上游 `node_modules`，以及上游 `/src` 导入。CLIProxyAPI 代码和资源归 `product/packages/account-pool`；上游应用不拥有其业务逻辑或构建工具。

范围审计时，integration、backend 和 UI 工作区均停留在规划提交 `5dfe635bc7cfc70b665e0c76825f1b1b6061b7d0`，`packages/**` 和 `vendor/**` 下没有已跟踪或已暂存修改。Integration 保留未跟踪的 `catalog/` 和构建测试脚手架；backend 保留未跟踪的账号池服务/API 目录；UI 保留未跟踪的账号池客户端目录。这些保留路径不是实施输入，不得纳入提交。

<a id="acceptance-evidence"></a>

## 证据与交接

准备检查观测到 Node `24.18.0`、pnpm `11.7.0`、macOS arm64 上的 Go `1.26.0`、Xcode `26.4`，以及存在的 Electron `44.0.0` 可执行文件。两次冻结锁文件安装均已完成，第二次与前移后的基线匹配。原生 CUA 成功读取了运行中 DSH 应用的 `dsh-app://` 无障碍树。这证明驱动可调用，不代表迁移验收完成。

任务环境中不存在 `DEEPSEEK_API_KEY`，本工作区和正常 Harness home 也没有 `.env` 文件。未读取或复制个人凭据存储。隔离且受支持的 Desktop 开发启动可以验证真实引擎的空池和 OAuth 初始状态。已认证模型推理需要获得授权的账号环境。签名、公证和正式发布与本次迁移的开发验收分别记录。

验证记录必须标明精确候选版本、启动模式、私有状态目录、操作、可见结果和保留证据。单元 fixture（测试前置数据）不能证明原生产品验收。冻结验收工作区与实施和本地 CI 保持隔离。

<a id="execution-scratch"></a>

## 开发笔记

非权威规划草稿：公共推理组合已通过隔离 TLS/SSE 可行性探测，不使用真实供应商账号，也不修改上游。此前已发布方案不再作为实施指导。PR 保持 draft，issue 的 ready 状态已移除，本轮仅授权方案修订及审阅后的文档检查/发布。
