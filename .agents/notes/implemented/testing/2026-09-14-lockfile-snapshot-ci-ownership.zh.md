# Agent Note: 按已解析快照选择 lockfile 消费方

Status: implemented

[English](2026-09-14-lockfile-snapshot-ci-ownership.md) | 中文

## Problem

一个 pnpm lockfile 可以包含同一包名的多个版本。如果 CI 规划器将一个变化的 `name@version` 沿所有同名依赖边传播，就会把其他已解析版本的消费方误判为受影响。增加一个仅用于发布的依赖时，规划器可能因此选择依赖树并未变化的提供方、Python、基准测试、Web 和平台检查。

## Decision

fork CI 规划器使用准确的 `name@resolved-reference` 身份跟踪变化的 pnpm package key 和 snapshot key。反向遍历会先将每条依赖边解析为准确的 snapshot key，包括 peer 后缀和 `npm:` alias，再判断其父项是否发生变化。遍历结束后，规划器才将这些身份转换为包名，用于把受影响的外部依赖映射到工作区 manifest。现有 importer 变化规则和工作区反向依赖规则继续选择直接归属方及其消费方。

## Alternatives considered

**按包名传播。** 不采用，因为新增 `statuses@1` 不能使 `statuses@2` 的未变消费方失效。

**忽略传递 lockfile 变化。** 不采用，因为即使 importer 记录和 manifest 保持不变，发生变化的已解析快照仍可能改变工作区包。

**为 Desktop 发布依赖增加特例。** 不采用，因为错误来自不区分版本的依赖图遍历，任何包都可能再次触发。

## Consequences

仅修改 lockfile 时，CI 会继续保守覆盖准确解析图中的反向依赖，而不会扩展到无关版本。解析器支持本仓库 pnpm v9 使用的引用形式；出现新的 lockfile 引用形式时，必须先增加聚焦的解析用例，CI 才能依赖该形式。
