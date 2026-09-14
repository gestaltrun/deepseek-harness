# CLIProxyAPI 账号池交付记录

[English](2026-09-14-account-pool-migration.md) | 中文

## 摘要

本临时交付参考记录已接受的账号池能力向 `gestaltrun/deepseek-harness` 的迁移。[提议中的 Agent Note](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有架构和验收标准。当迁移的已接受候选版本及最终证据记入交付 PR（Pull Request）后，本记录到期。

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

一个端到端迁移 ticket 拥有完整账号管理和模型使用路径。后端、UI 和打包是同一交付单元的内部职责。

| 职责 | 负责人 | 可写范围 | 输入和状态 | 完成证据 |
| --- | --- | --- | --- | --- |
| 后端和 API | 方案发布后指定后端负责人 | 账号池服务、CLIProxyAPI 实现、配额库、窄范围 Typert API、所属测试和包文档 | 已接受接口见提议中的 Agent Note；隔离分支和 worktree 从规划版本创建 | 代次生命周期、持久配置、凭据隔离、适配器注册、API 授权、聚焦测试和 Loader 组合。 |
| 共享设置 UI | 方案发布后指定 UI 负责人 | 账号池客户端包、本地化字典、所属测试和包文档 | 已接受服务/API 声明；隔离分支和 worktree 从规划版本创建 | 账号和配额控件、独立设置页、只读模型页页脚、本地化失败反馈、录制输出及真实产品交互。 |
| 集成和打包 | 交付/环境负责人 | 集成分支、bundle/profile 与 Desktop 打包、来源固定、汇总清单/目录、交付文档和验收环境 | 基线已冻结；实施等待方案发布 | 精确引擎产物、默认 Desktop 组合、可选 Web 组合、构建产物冒烟、隔离原生验收、已审阅 GIF 和交付 PR。 |

<a id="acceptance-evidence"></a>

## 证据与交接

准备检查观测到 Node `24.18.0`、pnpm `11.7.0`、macOS arm64 上的 Go `1.26.0`、Xcode `26.4`，以及存在的 Electron `44.0.0` 可执行文件。两次冻结锁文件安装均已完成，第二次与前移后的基线匹配。原生 CUA 成功读取了运行中 DSH 应用的 `dsh-app://` 无障碍树。这证明驱动可调用，不代表迁移验收完成。

任务环境中不存在 `DEEPSEEK_API_KEY`，本工作区和正常 Harness home 也没有 `.env` 文件。未读取或复制个人凭据存储。隔离且受支持的 Desktop 开发启动可以验证真实引擎的空池和 OAuth 初始状态。已认证模型推理需要获得授权的账号环境。签名、公证和正式发布与本次迁移的开发验收分别记录。

验证记录必须标明精确候选版本、启动模式、私有状态目录、操作、可见结果和保留证据。单元 fixture（测试前置数据）不能证明原生产品验收。冻结验收工作区与实施和本地 CI 保持隔离。

<a id="execution-scratch"></a>

## 开发笔记

非权威执行草稿：规划版本发布已接受的服务/API、TLS、持久配置和负责人范围。工作进行时，精确实施及验收标识记入交付 PR 台账。
