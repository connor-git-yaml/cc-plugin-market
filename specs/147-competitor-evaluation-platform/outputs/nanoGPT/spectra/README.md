# nanoGPT — 技术文档索引

> 由 spectra v4.1.1 自动生成 | 2026/4/30

## 目录结构

```
modules/     模块级技术规范
project/     项目级文档（架构、产品、质量）
bundles/     文档 Bundle（按角色组织）
_meta/       系统元数据
```

## 产品与使用

- [产品定位与核心能力](project/product-overview.md)
- [架构叙事与关键设计决策](project/architecture-narrative.md)
- [用户旅程](project/user-journeys.md)
- [故障排查指南](project/troubleshooting.md)

## 代码核心抽象

> 按图谱度数排序的 Top 1 节点，完整列表见 [架构图谱分析报告](_meta/GRAPH_REPORT.md#god-nodes)。

| 节点 | 类型 | 度数 |
|------|------|------|
| [`model`](_meta/GRAPH_REPORT.md#god-nodes) | module | 7 |

## 意外连接

> 跨社区或低置信度的关系，完整列表见 [架构图谱分析报告](_meta/GRAPH_REPORT.md#surprising-connections)。

| 源 | 目标 | 关系 | 跨社区 |
|----|------|------|--------|
| [`../nanoGPT-output/spectra-full/modules/model.spec.md`](_meta/GRAPH_REPORT.md#surprising-connections) | `model.py` | cross-module | 是 |
| [`../nanoGPT-output/spectra-full/modules/train.spec.md`](_meta/GRAPH_REPORT.md#surprising-connections) | `train.py` | cross-module | 是 |
| [`../nanoGPT-output/spectra-full/modules/train.spec.md`](_meta/GRAPH_REPORT.md#surprising-connections) | `../nanoGPT-output/spectra-full/modules/model.spec.md` | cross-module | 否 |

## 架构与接口

- [数据模型](project/data-model.md)
- [事件与消息流](project/event-surface.md)

### 图查询能力（MCP）

Spectra 提供 5 个 MCP 图查询工具，可在支持 MCP 的 AI 助手（Claude Code、Cline 等）中直接调用：

- `graph_query`：按关键词查询相关模块和子图（"认证模块"、"数据库连接"）
- `graph_node`：查询指定节点的详情和邻居
- `graph_path`：查询两个节点之间的最短依赖路径
- `graph_community`：列出某个社区（模块聚类）的所有节点
- `graph_god_nodes`：识别图谱中度数最高的枢纽节点

详见各插件的 [SKILL.md](../../plugins/spectra/skills/spectra-batch/SKILL.md)。

## 质量审计

- [质量报告（评分与改进建议）](project/quality-report.md)
- [覆盖率审计](project/_coverage-report.md)
- [技术债清单（代码注释 + 设计开放问题）](project/technical-debt.md)

## 决策记录

- [Feature Briefs（从 Issues/PRs 生成）](project/feature-briefs/index.md)

## 文档 Bundle（按角色）

- 开发者入门（12 篇文档）
- 架构评审（10 篇文档）
- API 消费者（6 篇文档）
- 运维交接（3 篇文档）

---

*本索引包含 0 个模块规范 + 8 个项目级文档*