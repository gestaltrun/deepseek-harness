# Agent Note: 由 bundle 声明的 Desktop 覆盖层

Status: implemented

[English](2026-09-15-bundle-declared-desktop-patch.md) | 中文

## Problem

一个 profile bundle 有时需要在 Desktop 上给出与 Web 不同的组合。产品 IM 就是具体案例：其 bundle 的 `cordis.patch.yml` 在 Web 上选择 `@deepseek-ai/dsh-host-directory-picker-browse`（公开的浏览目录 pairing），但 Desktop 已经通过 `apps/desktop-host/config/desktop.cordis.patch.yml` 挂载了 `directory-picker-native`，Cordis 在同一 fiber 内加载两个 back-end 时会以 `service "directoryPicker" has been registered at <NativeDirectoryPicker>` 大声失败。在本 note 之前，让一个 bundle 在 Desktop 上做出特化的唯一办法，是让每个调用方显式加一个 `--patch <bundle>/desktop.patch.yml` 参数 —— 而已打包的 Desktop 启动路径没法这样做。

窄口子的替代方案 —— 像 `apps/desktop-host` 已经认识 base bundles 那样让它认识 `@gestaltrun/dsh-im-bundle` —— 每加一个产品 bundle 就要烧一个 fork 侧的集成点，未来的 bundle 也没有一条统一路径。

## Decision

一个 profile bundle 可在既有的 `dsh.bundle.patch` 旁边声明 `dsh.bundle.desktopPatch`，指向同一个包内的一个 Desktop 专属覆盖文件。`apps/desktop-host/src/index.ts` 的 `desktopPatches()` 在每个 bundle 自身通用 patch 之后、profile 的用户层之前加载它声明的 Desktop 覆盖，于是：

1. bundle 的跨平台 `cordis.patch.yml` 依旧在所有平台上生效。
2. Desktop 覆盖在同一行集合上做 `disabled: true` 与 `config: {}` 特化。
3. 用户 home 级 `cordis.patch.yml` 与 `--patch` 覆盖仍高于 bundle 的 Desktop 特化。
4. `apps/desktop-host/config/desktop.cordis.patch.yml`（掌管 Desktop 基础组合：禁 web-startup、挂 `directory-picker-native` 等）仍最后应用，因此 bundle 不能覆盖 Desktop Host 自己的不变量。

`apps/desktop-host/src/bundle-desktop-patch.ts` 的 `loadBundleDesktopPatches()` 读取 manifest，将覆盖路径解析到包目录，拒绝逃出包外的路径，返回一个 patch 层或空数组。单测覆盖“无声明 / 有声明 / 空字符串 / 越出包外 / 真实 IM bundle”五种情况：`apps/desktop-host/tests/bundle-desktop-patch.spec.ts`。

IM bundle 用它把 `gestaltrun-im-directory-picker-browse` 在 Desktop 上禁用，并把 `gestaltrun-im-ui.config.directoryPicker` 设为 `native`。`apps/desktop/src/product-profile.ts` 把 `@gestaltrun/dsh-im-bundle` 加入 `DESKTOP_PRODUCT_BUNDLES`，并列出每个 bundle 提供的客户端条目（`DESKTOP_PRODUCT_CLIENT_ENTRIES`）供打包运行时 smoke 的客户端 boot 图检查。`apps/desktop/scripts/product-artifacts.ts` 泛化为对全部五个已分发产品包做校验，并在此基础上比对源与归档中的 Desktop 覆盖声明是否一致。

## Alternatives considered

**在 `apps/desktop-host` 里硬编码 IM bundle。** 拒绝：每加一个产品 bundle 就要烧一个 fork 侧集成点。Model Center 因为它的行本身平台无关才能不需要 Desktop 专属覆盖；这个模式并不通用。

**Desktop 启动始终显式传 `--patch <bundle>/desktop.patch.yml`。** 拒绝：已打包的 Desktop 不接受调用方提供的 `--patch`（Electron 通过 `desktopPatches()` 自己拥有 profile 组合），所以事实上没有调用方能加。`smoke:im-profile` 脚本能用这一形状是因为它面向公开 CLI，而不是 Desktop Host。

**把 `dsh.bundle.patch` 扩为按平台的映射。** 拒绝为过早的抽象：目前的用法是 Web-加-Desktop，标量-加-标量的声明与既有的单字符串字段语法一致，不必发明新语法。`web.patch.yml` 及其他形态仍作为调用方选择的覆盖文件保留。

## Consequences

当 IM bundle 激活时，Desktop 的 `directoryPicker` 服务在组合层不再冲突。`smoke:im-profile` 继续证明组合（`matchedDesktopDirectoryPicker: true`、`matchedWebDirectoryPicker: true`）；打包运行时 smoke 在客户端 boot 图检查里包含两个产品 bundle 的客户端条目。

`readProductArtifacts()` 现在验证全部五个已分发产品归档（`model-center`、`im-runtime`、`api-im`、`ui-im`、`im-bundle`）；其单测覆盖过期版本归档、丢失 Desktop 覆盖声明的归档、以及一个未发布的开发依赖。

本决策未覆盖：由 bundle 声明的 config 值向客户端的传递。`.agents/local/im-delivery/desktop-dev-8ee8a3737f/walkthrough.md` 中的 dev Electron 走查记录了：ui-im 的客户端 `Config.directoryPicker` 从未到达客户端 apply 函数 —— `BootPluginRow`（`packages/client/modules/src/client/manifest.ts`）不携带每插件 config，`bootClient()` 也以 `loader.create({ name })` 调用而没有 config 字段，因此客户端始终读到默认 `browse`。结果，侧栏 `添加工作区` 动作装载 `BrowseDirectoryFlow`，随后以 `directoryPicker.list needs the browse capability; the composed picker serves "native"` 失败。正确的修法 —— 要么通过 Client 可见的服务出口暴露 picker capability，要么扩展 boot manifest 使之携带 server 侧已解析 config —— 属于独立决策，另立记录。

## Testing

`pnpm vitest run apps/desktop-host/tests/bundle-desktop-patch.spec.ts`（5 项）—— 解析已声明覆盖、拒绝空/包外声明、断言随行的 `product/im-bundle/desktop.patch.yml` 组合为 native picker 行集合。
`pnpm vitest run apps/desktop/tests/product-artifacts.spec.ts`（4 项）—— 证明泛化后的归档校验接受五个产品归档并拒绝：过期版本、丢失 desktopPatch 声明的 manifest、以及一个 workspace 链接依赖。
`pnpm --dir product run smoke:im-profile` —— 通过公开 `dsh --profile <name> --dump-config` CLI 的端到端证明：Web 覆盖组合到 browse 行、Desktop 覆盖组合到 native 行。
`.agents/local/im-delivery/desktop-dev-8ee8a3737f/` 中的 dev Electron 验收运行 —— IM 账号设置面板在已打包 Settings 对话框中渲染；picker 冲突未在启动期出现。原生目录选择器本身仍受 Consequences 中记录的客户端配置传递缺陷所拦。
