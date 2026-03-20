# 技术调研报告: 架构概览与系统上下文视图

**特性分支**: `045-architecture-overview-system-context`  
**调研日期**: 2026-03-20  
**调研模式**: 离线 / 独立模式  
**产品调研基础**: 无（本次为 `tech-only`，未执行产品调研）

## 1. 调研目标

**核心问题**:
- 如何在不重复解析 Dockerfile / Compose / workspace 的前提下落地 `ArchitectureOverviewGenerator`
- 如何把 `RuntimeTopology`、`WorkspaceOutput`、`CrossPackageOutput` 组合为统一的架构视图模型
- 如何为 050 预留结构化输出边界，而不提前实现模式提示

**需求范围（来自需求描述与蓝图）**:
- 必须生成系统上下文视图、部署视图、packages/apps 分层视图和模块职责摘要
- 必须与 043 的运行时拓扑和 041 的跨包依赖结果保持一致
- 必须沿用 panoramic 现有抽象与注册机制，不新增平行基础设施

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: Composite 组合上游 Generator | 方案 B: 045 直接重解析原始文件 | 方案 C: 045 仅读取已生成文档/JSON |
|------|-------------------------------------|-------------------------------|----------------------------------|
| 概述 | 045 内部调用 043/040/041 的结构化输出，再组合为视图模型 | 045 自己再次解析 Compose、workspace、依赖图 | 045 依赖批量产出的中间文件或渲染后文档 |
| 性能 | 中等，可接受；复用现有逻辑 | 理论可控，但重复解析成本更高 | 运行快，但强依赖外部产物是否已存在 |
| 可维护性 | 高；职责清晰，避免重复逻辑 | 低；会复制解析逻辑并制造漂移 | 中；但输入协议脆弱，文档格式变更容易破坏 |
| 学习曲线 | 低；符合当前 panoramic 抽象 | 中；需要重新理解多套解析语义 | 中；需要定义额外产物契约 |
| 社区支持 | 高；符合典型 Composite / View Model 模式 | 低；违背“共享抽取、不同渲染”原则 | 中；像缓存层，但当前仓库未建立稳定物化契约 |
| 适用规模 | 适合当前 Phase 2 范围 | 适合临时实验，不适合主线 | 适合未来缓存/增量重生成场景 |
| 与现有项目兼容性 | 最佳；完全沿用现有 generator / registry / template 机制 | 差；与蓝图约束冲突 | 一般；需要额外 orchestration 支持 |

### 推荐方案

**推荐**: 方案 A — Composite 组合上游 Generator

**理由**:
1. 它最符合蓝图“共享抽取、不同渲染”的路线，能直接消费 043 的 `RuntimeTopology`，避免重复解析部署制品。
2. 它与当前 panoramic 架构最一致：045 只新增组合层和渲染层，不破坏 `DocumentGenerator` / `GeneratorRegistry` 的既有边界。
3. 它自然为 050 预留中间结构化模型，避免把未来模式提示耦合到 Markdown 模板里。

## 3. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 版本 | 评级 |
|------|------|------|------|
| `handlebars` | 渲染 `architecture-overview.hbs` 模板 | 现有依赖 | ⭐⭐⭐ |
| `zod` | 延续现有 panoramic 输入输出 schema 风格（如需要） | 现有依赖 | ⭐⭐⭐ |
| `node:fs` / `node:path` | 读取本地文件与上下文发现 | Node 内置 | ⭐⭐⭐ |
| 无新增第三方依赖 | 保持 Node-only 和最小变更 | N/A | ⭐⭐⭐ |

### 推荐依赖集

**核心依赖**:
- 复用现有 `RuntimeTopologyGenerator`、`WorkspaceIndexGenerator`、`CrossPackageAnalyzer`
- 复用现有 `loadTemplate()`、`sanitizeMermaidId()`、`GeneratorRegistry`

**可选依赖**:
- 不建议为 045 新增任何外部 npm 包；当前需求完全可以在现有依赖内完成

### 与现有项目的兼容性

| 现有能力 | 兼容性 | 说明 |
|---------|--------|------|
| `RuntimeTopologyGenerator` | ✅ 兼容 | 043 已落地，且共享 `RuntimeTopology` 正是 045 的直接输入 |
| `WorkspaceIndexGenerator` | ✅ 兼容 | 可直接提供 workspace 分组和包职责基础信息 |
| `CrossPackageAnalyzer` | ✅ 兼容 | 可直接提供跨包依赖、层级和循环依赖信息 |
| `GeneratorRegistry` | ✅ 兼容 | 只需新增注册项，不需要改 registry 基础设施 |
| `writeMultiFormat` | ⚠️ 需注意 | 若后续希望输出 JSON / Mermaid 文件，可再接入；045 首次落地不以此为必需范围 |

## 4. 设计模式推荐

### 推荐模式

1. **Composite Generator**: 045 作为组合层，聚合多个上游 generator 的结构化输出，负责统一视图建模与渲染。
2. **View Model / Presenter**: 在 `generate()` 阶段把运行时关系、workspace 分组和跨包依赖转成模板无关的 `ArchitectureOverviewModel`。
3. **Graceful Degradation**: 某些输入缺失时，仅降级受影响版块并保留 warning，而不让整份架构概览失败。

### 应用案例

- 当前仓库中 `CrossPackageAnalyzer` 已体现“提取结构化数据 -> 生成 Mermaid/Markdown”的模式；045 可以在更高一层延续这一设计。
- 043 已将共享运行时模型与模板分离，045 应对这一实践做进一步复用，而不是退回到“每个文档类型各自解析一遍”的模式。

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 045 重新实现 043/040/041 的解析逻辑，导致事实漂移 | 中 | 高 | 强制通过组合现有 generator / helper 构建输入，避免平行解析 |
| 2 | 大型 monorepo 的 Mermaid 图过于复杂，文档可读性下降 | 中 | 中 | 在视图模型中先做聚合，只展示入口、关键服务、workspace 组和核心依赖 |
| 3 | 非 monorepo 或无运行时信号项目导致某些版块为空 | 高 | 中 | 明确设计 warning 和 missing section 机制，允许部分版块降级 |
| 4 | 未来 050 需要证据链，但 045 输出只剩 Markdown | 中 | 高 | 在 045 中新增结构化 `ArchitectureOverviewModel` 与来源证据字段 |
| 5 | 批量流程对非 TS/JS 单语言项目仍有上下文缺口 | 低 | 中 | 当前仓库已存在单语言依赖图修复主线，可在 045 测试中覆盖相关场景的最小回归 |

## 6. 需求-技术对齐度

### 覆盖评估

| 需求 | 技术方案覆盖 | 说明 |
|------|-------------|------|
| 生成系统上下文 + 部署视图 + 分层视图 | ✅ 完全覆盖 | 由 `ArchitectureOverviewModel` 统一承载三类视图 |
| 与 043 / 041 输出保持一致 | ✅ 完全覆盖 | 通过组合上游结构化输出实现，不额外重推导关系 |
| 对缺失输入静默降级 | ✅ 完全覆盖 | 在输入聚合层保留 availability / warning 状态 |
| 为 050 预留共享结构 | ✅ 完全覆盖 | 通过结构化 view model 与来源证据字段实现 |

### 扩展性评估

当前方案对 050 的扩展友好：

- 050 可以直接读取 `ArchitectureOverviewModel` 的节点、关系、职责和来源证据
- 无需重新组合 043/040/041 的结果
- 只需在 045 的结构化输出上追加模式提示、证据链解释和替代方案摘要

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 双语文档规范 | ✅ 兼容 | 文档中文说明，代码标识符和路径保持英文 |
| Spec-Driven Development | ✅ 兼容 | 按 spec -> plan -> tasks -> implement -> verify 执行 |
| AST / 静态提取优先 | ✅ 兼容 | 045 不直接解析源码 AST；复用已有静态分析 / 结构化输出 |
| 纯 Node.js 生态 | ✅ 兼容 | 无新增外部运行时依赖 |
| 质量门控不可绕过 | ✅ 兼容 | 保留 design/tasks/verify 门禁，不跳过关键确认点 |

## 7. 结论与建议

### 总结

Feature 045 最合理的落地方式是实现一个 **Composite / View Renderer** 型 `ArchitectureOverviewGenerator`：内部复用 043、040、041 的结构化输出，生成模板无关的 `ArchitectureOverviewModel`，再渲染为 Markdown + Mermaid 视图。这样既满足蓝图的“共享中间模型”要求，也为 050 预留了稳定的增强接入点。

### 对后续规划的建议

- 规划中应明确 045 的输出边界分为两层：`ArchitectureOverviewModel`（共享）和 `architecture-overview.hbs`（渲染）
- 实现阶段优先验证“与 043 / 041 一致性”和“缺失输入降级”两类测试，因为它们最容易在组合层出错
- 不要把 050 的模式检测或解释逻辑提前塞进 045，只保留证据来源和关系结构即可
