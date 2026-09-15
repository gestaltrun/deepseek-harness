# 模型中心

[English](README.md) | 中文

`@gestaltrun/dsh-model-center` 提供模型设置页和逐模型默认思考档位。bundle 选择产品提供方和编辑器，继续使用官方 LLM 服务、pi-ai 实现、Settings 与 Credentials 服务。Desktop 携带此包并为新 profile 默认启用；停用后恢复官方提供方和模型页面，保留已保存配置。

## 配置

模型页面在同一模型行编辑输入类型、支持的思考档位、请求值和默认档位。新建与编辑提供方时也可以设置 `defaultInput`。配置继续保存在 `llm-pi-ai.providers`，API 密钥仍由 Credentials 服务管理。

模型中心启用时，内联控件接管 pi-ai 提供方卡片的扩展槽位，已安装的旧模型能力插件不会重复显示面板。其他提供方扩展和已禁用提供方的存档仍可使用。关闭模型中心后恢复旧扩展，不卸载旧插件或删除其数据。

```yaml
llm-pi-ai:
  providers:
    gateway:
      api: openai-completions
      baseURL: https://gateway.example/v1
      apiKeyEnv: GATEWAY_API_KEY
      models:
        - id: vision-model
          input: [text, image]
          reasoningEfforts: {off: null, low: low, high: high}
          defaultReasoningLevel: high
```

本次请求显式选择优先于模型默认值，模型默认值优先于提供方的 `reasoning`。移除 `defaultReasoningLevel` 即恢复继承。声明档位必须包含默认档位；继承模型目录时，在发送前依据解析后的模型能力验证。`off: null` 表示提供关闭选项，但不发送思考参数。能力由用户声明，不是自动探测端点。

设置写入保留未编辑的模型字段，携带页面读取的命名空间版本，并原子保存模型数组。已有 `defaultReasoningLevel` 字段直接生效，不复制密钥，不执行破坏性迁移。请求准备后，其默认档位不受后续设置变更影响。提供方错误、取消、重试、图片与重放状态继续由官方实现处理。

产品 bundle 可以在 pi-ai 读取初始设置前，通过 `managedProviders` 预约提供方路由。运行时所有者通过 `ctx.modelCenter` 发布来源模型字段；发布写入既有 `llm-pi-ai.providers.<id>.models` 用户层，并保留其他提供方和非来源字段。通用 pi-ai 适配器不占用或校验预约路由。运行时所有者继续负责其适配器、凭据、发现与生命周期。重复发布相同来源目录不会写入 Settings；后续来源刷新会替换来源拥有的模型字段手动编辑。

## 构建与装配

独立工作区位于 `product/`。运行 `pnpm --dir product install --frozen-lockfile --ignore-scripts`，再执行 `pnpm --dir product run build`、`test` 或 `typecheck`。`pnpm --dir product run pack` 将 npm 归档写入 `product/dist`。Desktop 打包读取此目录和 `apps/desktop/src/product-profile.ts` 中的产品 bundle 清单。

bundle 停用标准 pi-ai 和模型 UI 行，并插入产品行。使用组合层 pi-ai 默认值时，将其配置在产品行；已有用户设置沿用原命名空间。模型中心默认不声明受管路由；拥有受管运行时的 bundle 在模型中心行中添加预约。提供方的隔离注册视图转发官方三个 LLM 注册方法和设置安装方法，并通过组合测试约束与固定 DSH 版本的兼容性。产品包不替换应用 LLM 服务，不在中间件中修改冻结请求。

模型页面与输入标签控件由产品包维护适配，源码身份记录在 `UPSTREAM.json`。新增公共接口需要明确适配，不从未发布的内部路径导入实现。
