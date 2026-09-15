# CLIProxyAPI 账号池交付记录

[English](2026-09-14-account-pool-migration.md) | 中文

## 摘要

本临时交付参考记录 `gestaltrun/deepseek-harness` 上的账号池产品包。[架构笔记](../../.agents/notes/proposed/architecture/2026-09-14-plugin-account-pool.zh.md)拥有架构和验收标准。当已接受候选版本及最终证据记入交付 PR（Pull Request）后，本记录到期。

## 目录

- [标识](#input-revisions)
- [所有权](#owner-assignments)
- [证据](#acceptance-evidence)
- [开发笔记](#execution-scratch)

<a id="input-revisions"></a>

## 标识

| 输入 | 标识 |
| --- | --- |
| 目标基线 | `gestaltrun/master` 上的 `375e2838dec1ff3fba7730256b9bfda2a17c1983` |
| 集成分支 | `codex/migrate-cliproxyapi-account-pool-20260914` |
| 产品 PR | [gestaltrun/deepseek-harness#42](https://github.com/gestaltrun/deepseek-harness/pull/42) |
| 引擎 | `gestaltrun/CLIProxyAPI` 的 `4bc4119e1d3353593dc25f8d24e7d55afad33f33`，记录为 `community/cliproxyapi` gitlink |

迁移排除无关 fork 能力和个人凭据。后续主线前移需要明确的集成决定。

<a id="owner-assignments"></a>

## 所有权

一个产品包拥有账号管理和池内模型使用。实现位于 `product/packages/account-pool`。Desktop 胶水仅限既有的四个产品注册文件。

硬约束排除 `packages/**` 和 `vendor/**` 实现修改、根工作区/编译/依赖新增，以及上游源码导入。CLIProxyAPI 源码和资源归产品包；它不是 Desktop 社区插件。

<a id="acceptance-evidence"></a>

## 证据

产品 Host/Client 编译采用正常 npm 解析和严格库检查。生成 Remote 每个编译面包含十六个严格操作。隔离 Desktop 开发启动可以验证空池和 OAuth 初始状态。已认证模型推理需要获得授权的账号环境。签名、公证和正式发布另行记录。

<a id="execution-scratch"></a>

## 开发笔记

非权威：PR 保持 draft，等待原生验收和审查。录制 Session 通过本地 fixture 覆盖模型选择、图片准入、reasoning 和工具执行，不能证明供应商认证。
