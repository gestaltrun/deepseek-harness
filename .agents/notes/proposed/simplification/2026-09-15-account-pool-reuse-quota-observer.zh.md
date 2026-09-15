# Agent Note: 每个代次复用一个配额观察器

Status: proposed

[English](2026-09-15-account-pool-reuse-quota-observer.md) | 中文

## 问题

[`CLIProxyAccountPool.applyQuotaObservation`](../../../../product/packages/account-pool/src/provider/gateway.ts) 每次观测一个账号都会调用 [`createQuotaObserver`](../../../../product/packages/account-pool/src/quota/observer.ts)，并新建一个 `api-call` 传输闭包，即使该账号是 GLM。

`createQuotaObserver` 的生产调用方只有这个 gateway 方法；其余是配额测试。观察器只是注入传输和时钟后的纯组装器，不保存按账号状态。`refreshAllQuota` 已按 `quotaConcurrency` 并发，因此每个账号都会重复构造同一工厂和同一 Host `api-call` 绑定。

GLM 观测不再探测。[`observeGlm`](../../../../product/packages/account-pool/src/quota/observer.ts) 只解析 `input.quotaSignals`，从不读取 `ctx.transport`。gateway 仍在 `refreshGlmQuotaEnvelope` 或花名册刷新中取到该信封，再包装成 `QuotaProbeInput` 并构造用不到的探测传输。公开的 `parseGlmQuotaSignals` / `GLM_QUOTA_SIGNAL_KEYS` barrel 再导出只剩测试和文档消费。

## 提案

为当前代次保留一个绑定该代次 `api-call` 传输的 `QuotaObserver`，随代次释放。`observe` 和 `refreshAllQuota` 复用它。

对 GLM，用 `parseGlmQuotaSignals` 解析已取到的信封并直接写入观测缓存。不要为该供应商构造 `QuotaProbeInput` 或 `api-call` 传输。Claude、Codex、Antigravity、Kimi 和 xAI 仍走现有探测路径。

除非有生产模块导入，否则停止从 [`quota/index.ts`](../../../../product/packages/account-pool/src/quota/index.ts) 再导出 GLM 解析符号。测试从 `signals-glm.ts` 导入解析器。

## 考虑过的替代方案

**继续每次重建观察器。** 相对供应商 HTTP 探测，工厂成本不高，但 GLM 已不再探测，`refreshAllQuota` 仍为每张卡片支付构造和闭包。当前调用点也掩盖了 GLM 并不使用它总是收到的传输。

**给 GLM 单独的 Host 观察类型。** 第二套观测 API 会重复 `applyQuotaObservation` / `withQuota` 已拥有的状态、窗口、套餐和缓存发布。把 GLM 移出探测工厂就够。

**把 `providerCatalog` 并入 `catalog`。** 否决。[`catalog`](../../../../product/packages/account-pool/src/provider/transport.ts) 发送 grok-shell User-Agent，让 CLIProxyAPI 发出用于注册 `gestalt-account-pool` 的扩展列表。[`providerCatalog`](../../../../product/packages/account-pool/src/provider/transport.ts) 省略该头，使 GLM 卡片模型列表保持供应商标注，而不是 Grok 投影。

## 验收标准

- 代次就绪时创建一次观察器实例，该代次的每次配额观测都复用它。
- GLM 配额刷新和花名册灌入解析 `glm-coding-plan` 信封，不 POST `api-call`。
- 非 GLM 供应商仍通过受信任传输和 `$TOKEN$` 占位符探测。
- 现有 GLM 信封、Kimi 窗口、xAI 档位和全部刷新并发测试继续覆盖这些行为。

## 风险

观察器目前把调用方 `signal` 关进传输闭包。代次级观察器仍须把当前操作的 signal 传入每次 `api-call`，这样取消单账号刷新不能中止同一代次上的后续观测。GLM 信封解析仍只在 Host；渲染器仍只收到投影后的窗口，不收到原始 signals。
