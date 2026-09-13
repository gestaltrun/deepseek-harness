# Agent Note: Compose Matt skills with DSH delivery

Status: implemented

[English](2026-09-13-matt-skills-and-dsh-delivery.md) | 中文

## 问题

通用工程技能可能选择与使用它的仓库不同的事项跟踪器、测试策略、Agent 生命周期或文档归属。上游刷新也可能移除本地验收要求。跨仓库插件交付需要超出单仓库 CI 范围的源码和制品证据。

## 决策

仓库包含选定上游版本的全部 37 个 Matt 技能。[SOURCES.json](../../../skills/SOURCES.json) 记录上游仓库、路径、准确版本、许可证和本地修改；每个导入的第三方技能附带许可证。两个被引用的展示辅助技能分别保留其来源记录。

[ODD](../../../skills/orchestrate-dsh-delivery/SKILL.md) 负责协调交付，其[工作流图](../../../skills/orchestrate-dsh-delivery/references/workflow.md) 安排 Matt 方法和全部官方 DSH 技能。当前 DSH 规则继续作为依据。`implement`、`to-spec`、`to-tickets` 和 `retro` 特意允许模型调用以供 ODD 使用；两种元数据格式保持一致。其他仅限显式调用的入口保留该限制，包括扩展翻译。

交付依次经过已接受的需求和方案、按需原型、必要的规格与任务，以及稳定且隔离的实现负责人。组合验证阶段通过 [ticket GIF 证据](../../../skills/orchestrate-dsh-delivery/references/ticket-evidence.md)，由主 session 逐项审核功能完整性、原 UI 设计 session 审核还原度，两者通过后才进行首次人工验收。随后开展独立简化检查和 Standards/Spec 审查；相关修复补录并重做受影响的审核后再验收。回顾决策、对应准确提交的最终 GUI 证据，以及获授权的合入或发布终点完成交付。写作与新增记录规则在全过程生效；收尾时对受影响的文档、决策和冗余实现进行限定范围审计。

技术方案设计使用 `research`，依据一手来源、集成成本和分发义务，对比可参考的开源实现与维护中的依赖。已确认的 PR/master 冲突，以及用户要求合并 master 时出现的冲突，使用 `resolving-merge-conflicts`，复用集成和模块负责人，并向 ODD 回传准确提交及受影响的验证结果。

[上游融合](../../../skills/dsh-upstream-integration/SKILL.md) 记录逐能力的采用、组合、保留或暂缓选择，并分别决定分发、激活和工具开放策略。[Desktop 对比](../../../skills/dsh-desktop-test-instance/SKILL.md) 保留隔离的基线与候选；清理时保留用户创建或内容不确定的数据，并记录负责人和原因。相关 Gestaltrun 仓库在正式发布前，将准确候选和组合 CI 绑定到同一需求发布集合。安装这些指令不配置监控、registry 权限或跨仓库 CI。

## 考虑过的替代方案

**复制旧 fork 的整个工作流。** 其跟踪器、启动脚本、模型路由和 CI 控制不描述当前检出版本。可移植的上下文和插件参考文档改为解析当前归属。

**用未经修改的上游文件替换本地技能。** 这会恢复默认全量测试、重复测试决策和互相竞争的交付归属。范围小且有记录的适配保留已接受的项目行为。

**每个阶段调用所有技能。** 技能具有不同范围和调用规则。条件路由避免专门任务与显式调用工作流成为无关前置条件。

## 后果

项目维护具有可复现上游来源和单一交付负责人的本地适配。链接、调用元数据、文档检查和独立情景审查验证这些指令；真实 Electron 行为、升级、CI 强制控制和发布需要单独的执行证据。
