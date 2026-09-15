# Agent Note: Host 打开账号池授权页

Status: implemented

[English](2026-09-15-account-pool-host-authorization-open.md) | 中文

## Problem

Desktop 开始设备与 PKCE 登录，并提供用浏览器打开授权页，但 Client 用 `window.open` 打开这些 HTTPS URL。Electron 壳拒绝所有 `window.open`，因此开始登录和再次点击按钮都打不开系统浏览器。

## Decision

产品 Client 把已准入的 HTTPS URL POST 到经过认证的 Host 路由。Host 启动操作系统协议处理器（`open`、`rundll32` 或 `xdg-open`），不做 shell 插值。Client 仍在请求前拒绝非 HTTPS 和带用户信息的 URL；Host 拒绝是错误，而不是被拦截的弹窗。开始登录并返回 URL 时也会立即打开该 URL。

[账号池架构](../../proposed/architecture/2026-09-14-plugin-account-pool.zh.md) 仍禁止 `window.dshDesktop` 和通用 URL 代理。新路由只准入并启动 HTTPS 授权 URL，不返回凭据，也不接受任意方法。

## Alternatives considered

**通过 `window.dshDesktop` 调用 Electron `shell.openExternal`。** 产品架构禁止该桥，Web 仍需要第二种打开器。

**把 Desktop `setWindowOpenHandler` 改成允许 HTTPS 弹窗。** 这会重新打开渲染器中每一次 `window.open`，包括不受信任的插件页，并且仍不会把用户默认浏览器作为独立应用启动。

**只把 URL 留在屏幕上供复制。** 设备和 PKCE 流程期望打开浏览器；每次登录都手动复制正是用户报告的缺陷。

## Consequences

Desktop 与 Web 共用一个 Host 打开器。渲染器弹窗策略仍全部拒绝。测试覆盖 Client Host POST、Host URL 准入，以及登录开始与重试打开。启动失败仍返回不含凭据的 502。
