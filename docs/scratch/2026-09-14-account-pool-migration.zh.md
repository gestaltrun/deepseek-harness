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
| 引擎 | `gestaltrun/CLIProxyAPI` 的 `7c34408fba879202c892d7beb788b1fd84138cfc`（`v7.2.155-glm.2`），记录为 `community/cliproxyapi` gitlink；来源子模块干净。 |
| 本地来源快照 | `tmp/account-pool-migration-20260914/source-freeze`，109 个已跟踪的源文件；不包含个人账号或环境文件。 |
| 来源清单 SHA-256 | `9985e7c6bd3383928cb3fb1b510f2a3b20fc1bb7c0ae27623c4c92c1a2213165` |
| 工作区补丁 SHA-256 | `c881c3a4de8c53aaa24f870be3883af13af54d21029ab495bd8815e2ebaedfc4` |

来源保持只读。迁移排除无关 fork 能力和个人凭据。后续主线前移需要明确的集成决定，不能静默替换本输入版本。

<a id="owner-assignments"></a>

## 交付所有权

一个端到端迁移 ticket 拥有完整账号管理和模型使用路径。用户已批准修订后的纯产品包方案并要求实施。集成和两个实施负责人使用干净 worktree；排除的上游脚手架在原工作区保持不动。

| 职责 | 负责人 | 实施范围 | 当前状态 | 下一检查 |
| --- | --- | --- | --- | --- |
| 领域、运行时和 RPC | 后端负责人 | 仅限 `product/packages/account-pool` 内部模块 | 已集成；真实 core、profile Loader、TLS、生命周期和 Session 回放通过 | 审查组合后的产品行为。 |
| 共享设置 UI | UI 负责人 | 产品 Client、控制器、字典和测试 | 已集成；真实 Gateway 注入回归、聚焦交互、公共 Client 构建和原生入口检查通过 | 依赖账号的卡片和登录完成验收。 |
| 产品产物与集成 | 交付/环境负责人 | 产品来源固定、Go 资源、独立锁文件/构建和四个准许的 Desktop 胶水/测试文件 | 构建、打包、范围拒绝测试、安装消费检查和原生空池通过 | 发布候选，并保留真实账号验收待办。 |

硬约束排除所有 `packages/**` 和 `vendor/**` 实现修改、根工作区/编译/依赖新增、上游 `patchedDependencies` 或 postinstall 补丁、修改上游 `node_modules`，以及上游 `/src` 导入。CLIProxyAPI 代码和资源归 `product/packages/account-pool`；上游应用不拥有其业务逻辑或构建工具。

范围审计时，integration、backend 和 UI 工作区均停留在规划提交 `5dfe635bc7cfc70b665e0c76825f1b1b6061b7d0`，`packages/**` 和 `vendor/**` 下没有已跟踪或已暂存修改。Integration 保留未跟踪的 `catalog/` 和构建测试脚手架；backend 保留未跟踪的账号池服务/API 目录；UI 保留未跟踪的账号池客户端目录。这些保留路径不是实施输入，不得纳入提交。

<a id="acceptance-evidence"></a>

## 证据与交接

准备检查观测到 Node `24.18.0`、pnpm `11.7.0`、macOS arm64 上的 Go `1.26.0`、Xcode `26.4` 和 Electron `44.0.0`。产品 Host/Client 编译采用正常 npm 解析和严格库检查并已通过。生成 Remote 每个编译面包含十六个严格操作。darwin-arm64 core 二进制 SHA-256 为 `cd869d0aecfd3e54b7dc4800d6c96ee3dfa12846b5457f64786c27c483b8bbf0`。独立安装的 tarball 已通过正常公共类型、Host 导入、Client factory 准入、描述符和资源身份检查。

任务环境中不存在 `DEEPSEEK_API_KEY`，本工作区和正常 Harness home 也没有 `.env` 文件。未读取或复制个人凭据存储。隔离且受支持的 Desktop 开发启动可以验证真实引擎的空池和 OAuth 初始状态。已认证模型推理需要获得授权的账号环境。签名、公证和正式发布与本次迁移的开发验收分别记录。

原生源码组合使用既有 Desktop 准备和 Electron 启动步骤，显式配置私有 base/Web/model-center/account-pool profile。真实 `dsh-app://` 交互验证运行中空池、六供应商选择器、空 GLM 表单禁保存，以及 Codex PKCE 发起和取消。产品显式声明可执行文件，使正常 pnpm 打包和安装保留 Go 资源执行权限。私有项目、home、用户数据、端口、进程日志和截图保留在验收工作区的 `.desktop-build/development` 目录。这些属于部分原生 UI 观测，不能证明已认证推理、已填充卡片、凭据下载、原始开发默认配置或签名发布。

<a id="execution-scratch"></a>

## 开发笔记

非权威执行草稿：实施进行中，PR 保持 draft，等待原生验收和审查。产品组合测试通过 169 项；刷新已声明 SDK 的安装后，最后的 Session 录制用例单独通过。Session 录制含十八条持久记录，通过公共 SDK/profile 与本地 TLS/SSE fixture 覆盖模型选择、图片准入、reasoning、真实工具执行和工具结果，不能证明供应商认证。
