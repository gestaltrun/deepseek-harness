# IM 接管迁移交付

[English](migration-delivery.md) | 中文

## Summary

2026-09-14 已授权按认可的 [product 架构](../../notes/proposed/architecture/2026-09-14-im-takeover-plugin-migration.zh.md) 实施。[当前规格 #44](https://github.com/gestaltrun/deepseek-harness/issues/44) 及新子票持有本次交付。需求与原型继续有效，本交接不重开设计。

## 已认可输入

[冻结 archive](frozen-inputs.tar.gz) 保留原相对路径及字节，可解包到空目录，含 48 个设计/原型/例证图片文件、历史方案三件套和 79 项 UI 契约清单。[frozen-inputs.json](frozen-inputs.json) 记录逐文件 SHA256 与来源身份。旧方案仅位于设计档案内，不进入目标仓库活动 Agent Note 目录。

- [当前已认可规格](https://github.com/gestaltrun/deepseek-harness/issues/44) 保留全部已认可用户故事；archive 内含原规格与工作单元图。[公开冻结原型](https://github.com/gestaltrun/deepseek-harness-gestalt/tree/54a56df8ca8ed1f2e0493224936bf18cc1505645/.agents/design/im-takeover/prototype) 与归档原型字节一致。
- [UI 契约清单](acceptance-checklist.md)：A 24、B 16、C 9、D 30，共 79 个不同条目，不作为完成率。
- [公开例证截图](https://github.com/gestaltrun/deepseek-harness-gestalt/tree/54a56df8ca8ed1f2e0493224936bf18cc1505645/.agents/design/im-takeover/screenshots) 同样包含在 archive 内。不含私人 GUI captures、凭据、依赖目录或原始执行日志。冻结原型不是可移植产品构建，其历史本机 file 依赖保持原样。

优先级为当前用户授权、已认可 product 架构、本迁移交接、已认可功能/体验需求。冻结文件中的旧基线、tracker、实施阻塞和审批状态不覆盖当前迁移。旧[根议题](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/613)与[规格 PR](https://github.com/gestaltrun/deepseek-harness-gestalt/pull/623)仅为只读历史。

## 当前工作单元

保留已认可的八个工作单元，使用新议题身份及原生 sub-issue/blocking 关系。固定基线架构审阅已完成，不再制造设计阻塞。

| 单元 | 当前议题 | 阻塞项 | 历史来源 |
|---|---|---|---|
| T1 | [#45 IM：配置账号与工作区路由，完成条件改绑](https://github.com/gestaltrun/deepseek-harness/issues/45) | 无 | [legacy T1](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/615) |
| T2 | [#46 IM：恢复消息历史、游标与发送结果](https://github.com/gestaltrun/deepseek-harness/issues/46) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45) | [legacy T2](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/616) |
| T3 | [#47 IM：接入 DWS 钉钉员工账号与消息投递](https://github.com/gestaltrun/deepseek-harness/issues/47) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T3](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/617) |
| T4 | [#48 IM：接入已准入旺旺商家与消息投递](https://github.com/gestaltrun/deepseek-harness/issues/48) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T4](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/618) |
| T5 | [#49 IM：让入站触发普通 Agent 并共享发信工具](https://github.com/gestaltrun/deepseek-harness/issues/49) | [#46](https://github.com/gestaltrun/deepseek-harness/issues/46) | [legacy T5](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/619) |
| T6 | [#50 IM：完成双 Session 模拟、隔离与终态停止](https://github.com/gestaltrun/deepseek-harness/issues/50) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45), [#49](https://github.com/gestaltrun/deepseek-harness/issues/49) | [legacy T6](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/620) |
| T7 | [#51 IM：接入认可的账号、工作区与会话界面](https://github.com/gestaltrun/deepseek-harness/issues/51) | [#45](https://github.com/gestaltrun/deepseek-harness/issues/45) | [legacy T7](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/621) |
| T8 | [#52 IM：打包安装并完成 Web/Desktop 可验收候选](https://github.com/gestaltrun/deepseek-harness/issues/52) | [#47](https://github.com/gestaltrun/deepseek-harness/issues/47), [#48](https://github.com/gestaltrun/deepseek-harness/issues/48), [#49](https://github.com/gestaltrun/deepseek-harness/issues/49), [#50](https://github.com/gestaltrun/deepseek-harness/issues/50), [#51](https://github.com/gestaltrun/deepseek-harness/issues/51) | [legacy T8](https://github.com/gestaltrun/deepseek-harness-gestalt/issues/622) |

## Runtime、API 与 UI 交接

| Owner | 交接义务 |
|---|---|
| Runtime 与 Provider | 冻结公共领域类型、完整路由身份、凭据引用规则、持久操作结果、执行绑定与 Session/模拟生命周期；保留平台证据和稳定消息身份，作用域工具读取可信 caller。 |
| Host BFF 与 Client 对象 | 交付生成 Remote/Client 入口，包括安全账号视图、逐目标保存结果、权威实例/Session 关联和 follow 快照/增量。UI 消费前交接精确接口提交，不手抄旧 Remote 类型。 |
| UI | 仅实现 product-owned props/locale Consumer。账号使用 settings.section；IM 右侧内容使用 sidebarRightTabs 和 sidebar.right.pane.tab。左侧工作区浏览区适配保留原入口及无关既有行为，并记录来源和回归。 |
| Delivery | 集成包含已保全 Host/UI 脏成果的稳定提交，准备精确 product 包，验证 Loader 与安装后产品路径，维护逐条功能/保真证据；候选可供验收时通知用户。 |

包发布、profile 装配、实时账号启用和产品验收分开。Desktop 经既有产品清单消费 product 产物，Web 使用显式产品 overlay。任何必要的上游 `packages/` 修改，必须先让用户看到不改的具体影响与 product-only 替代，再确认具体例外；实施授权不撤销此条件。

## 验收记录

使用当前规格体验路线和冻结 79 项清单。分别报告 focused tests、真实组合、recorded-session snapshots、持久新进程恢复、打包安装、Web/Desktop GUI 保真和已授权真实平台证据。源码存在和历史通过不证明当前候选通过。原始日志和个人账号证据留在指定本地证据目录，仅发布已授权且脱敏的证据。
