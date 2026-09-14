# Agent Note: 通过 Web 回放产品 IM 准入

Status: implemented

[English](2026-09-14-product-im-runtime-web-snapshot.md) | 中文

## 问题

Provider 准入消息时，产品 IM 运行时会创建 Agent 和根 Session。现有 headless 与 SDK snapshot adapter 会自行创建根 Session，因此无法在不增加第二个根或改变被测 Session 关系的情况下回放这条所有权路径。已安装 profile smoke 会执行该路径，但不提供仓库 snapshot corpus 的完整 Session、prompt、schema 和 replay 检查。

## 决策

Web snapshot adapter 挂载随附的 Web 组合，并插入产品 IM 运行时与合成测试 Provider。IM bundle manifest 提供产品包安装锚点。Provider 注册账号与路由，然后仅通过 `receivePage` 提交一页入站消息；运行时仍是 Agent 和 Session 的唯一所有者。authored replay 使用三次脚本模型响应驱动 `standard` preset，依次调用 `im_query_history`、`im_send_message` 并生成最终回复。

adapter 在触发 Provider 之前订阅下一个已结束 turn，并要求结果指向唯一的运行时自主根 Session。它比较完整持久化 Session、system prompt、工具 schema 和 replay 消费情况。独立断言覆盖三个模型步骤、工具顺序与结果、turn 完成状态、一次 transport 发送和 sent 状态的 outbox 记录。

运行时生成的 IM 标识通过共享 Session refresh 与 normalization 函数保持稳定。场景只提供准入 source 与发送结果中已知的不透明字段。它要求只有一条准入消息、source 与 admission 的消息 ID 一致、各标识互不重复、两边字段清单相等，并且 fresh 与 fixture 一一对应；其余值均以 fresh 运行结果为准。

## 考虑过的替代方案

**使用 headless 或 SDK adapter。** 未采用，因为这些 adapter 自主创建根 Session，会改变被测关系。

**仅保留已安装 profile smoke。** 未采用，因为 smoke 不执行仓库 recorded-session corpus 语义，也不比较完整的模型可见输入。

**在共享 snapshot 包中加入 IM normalizer。** 未采用，因为这些标识字段仅属于产品场景，而且现有公开 refresh 与 normalization export 已提供所需机制。

## 后果

产品 CI lane 先构建根 Web 产物与产品包，再运行这个无密钥 replay 及 corpus inventory 检查。场景使用 authored FixtureLLM 脚本与合成 Provider，因此证明 profile 组合和确定性运行时行为，但不证明真实模型或平台账号。其 Host 测试不进入 Web Client compiler face，只进入根 Host 测试程序。
