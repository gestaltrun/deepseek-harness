# Issue 自动管理配置

[English](README.md) | 中文

## 概述

Issue 工作流使用仓库专属的 GitHub App 和组织 Project 管理 Issue 元数据。目标组织、Project、字段和自动化执行者由 [config.json](config.json) 定义。

## 目录

- [GitHub 配置](#github-configuration)
- [验证](#validation)
- [开发备注](#dev-note)

<a id="github-configuration"></a>

## GitHub 配置

仓库变量 `DSH_ISSUE_APP_CLIENT_ID` 和密钥 `DSH_ISSUE_APP_PRIVATE_KEY` 标识 `gestaltrun-harness-issues` App。其安装仅授权访问 `gestaltrun/deepseek-harness`。App 拥有 Issue 写入、拉取请求读取、元数据读取和组织 Project 写入权限。[Issue 规则工作流](../workflows/issue-policy.yml) 请求仅可读取 Issue 和 Project 的令牌；[生命周期工作流](../workflows/issue-lifecycle.yml) 使用安装授予的写入权限。

[DSH Issue Management Project](https://github.com/orgs/gestaltrun/projects/1) 包含配置指定的 Status 选项、具有 P0–P3 选项的单选 Priority 字段，以及 Date 类型的 Start Date 字段。Issue Type 是 GitHub 原生 Issue 类型，而非 Project 自定义字段。

两个工作流都从默认分支检出规则。规则配置在默认分支生效；仅修改拉取请求分支不会替换受信任的规则。

<a id="validation"></a>

## 验证

`node --test .github/issue-management/policy.test.mjs` 验证元数据规则和生命周期转换。`pnpm exec vitest run scripts/ci-workflow.spec.ts` 检查工作流配置。这些本地检查不能验证已安装的 App 或 Project 访问权限；仓库工作流报告这部分集成结果。

<a id="dev-note"></a>

## 开发备注

无。
