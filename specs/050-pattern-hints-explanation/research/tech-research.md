# 技术调研报告: 架构模式提示与解释

**特性分支**: `050-pattern-hints-explanation`  
**调研日期**: 2026-03-20  
**调研模式**: 离线 / 独立模式  
**产品调研基础**: 无（本次为 `tech-only`，未执行产品调研）

## 1. 调研目标

**核心问题**:
- 如何在不重新解析底层项目事实的前提下，实现 `PatternHintsGenerator`
- 如何基于 045 的 `ArchitectureOverviewModel` 输出可追踪的模式、置信度和证据链
- 如何把规则驱动和可选 LLM explanation 组合起来，同时保持“事实来自共享模型、语言来自增强层”的边界

**需求范围（来自需求描述与蓝图）**:
- 必须以 045 的架构概览为主载体输出模式提示附录，而不是独立黑盒报告
- 必须输出模式名称、证据链、置信度和至少一个 why/why-not explanation
- 必须允许 043 / 044 作为弱依赖增强证据，但缺失时仍可降级工作

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: 规则优先的独立 `PatternHintsGenerator` | 方案 B: 直接把模式检测塞进 045 | 方案 C: 黑盒扫描原始文件再做模式判断 |
|------|----------------------------------------------|-------------------------------|------------------------------------|
| 概述 | 050 直接消费 045 结构化模型，生成 pattern hints 与 explanation 附录 | 在 `ArchitectureOverviewGenerator` 内部顺手追加模式检测 | 050 自己重新扫描源码、Compose、workspace 或文档 |
| 性能 | 中等，可接受；只在现有共享模型上做规则评估 | 略快，但会让 045 责任膨胀 | 成本最高，重复扫描与重复建模 |
| 可维护性 | 高；050 的实验性规则与 045 主视图解耦 | 低；045/050 边界被打散，后续难演进 | 低；与蓝图“共享模型”原则冲突 |
| 学习曲线 | 中；需要建立知识库与规则模型 | 低；短期实现快 | 中；但逻辑分散、难解释 |
| 证据可追踪性 | 高；可直接引用 045 节点/边 evidence | 中；容易与 045 视图逻辑混在一起 | 低；会出现另一套证据命名体系 |
| 适用规模 | 适合当前 Phase 3 试探性增强 | 只适合一次性实验，不适合主线 | 适合研究原型，不适合作为正式 feature |
| 与现有项目兼容性 | 最佳；完全沿用 `DocumentGenerator` 和共享模型边界 | 一般；需要回改 045 已稳定边界 | 差；会重复实现解析与抽取链 |

### 推荐方案

**推荐**: 方案 A — 规则优先的独立 `PatternHintsGenerator`

**理由**:
1. 它完全符合蓝图对 050 的定位：050 是 045 的增强层，而不是把 045 再改造成“视图 + 解释”大杂烩。
2. 它能直接复用 `ArchitectureOverviewModel` 的节点、关系、evidence 和 warnings，不需要回到原始项目制品重新抽取事实。
3. 它最容易实现“规则决定事实、LLM只增强表述”的边界，能把 false positive 和 hallucination 风险控制在可审计范围内。

## 3. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 版本/来源 | 评级 |
|------|------|-----------|------|
| `handlebars` | 渲染 050 附录模板或架构概览追加版块 | 现有依赖 | ⭐⭐⭐ |
| `zod` | 若需要约束知识库与输出 schema，可沿用现有风格 | 现有依赖 | ⭐⭐⭐ |
| `@anthropic-ai/sdk` + CLI proxy 链路 | `useLLM=true` 时增强 explanation 的现有能力基础 | 现有依赖/现有工具 | ⭐⭐ |
| 无新增第三方依赖 | 保持 Node-only、低风险演进 | N/A | ⭐⭐⭐ |

### 推荐依赖集

**核心依赖**:
- 复用 `ArchitectureOverviewGenerator` / `ArchitectureOverviewModel`
- 复用现有 `GenerateOptions.useLLM` 语义和认证 / proxy 能力
- 复用 `loadTemplate()`、`GeneratorRegistry`、`sanitizeMermaidId()` 等 panoramic 基础设施

**可选依赖**:
- 不建议为 050 新增外部 npm 包；当前所需的规则匹配、证据聚合和 explanation 渲染都可在现有依赖内完成

### 与现有项目的兼容性

| 现有能力 | 兼容性 | 说明 |
|---------|--------|------|
| `ArchitectureOverviewModel` | ✅ 兼容 | 045 已将 050 所需的 sections / nodes / edges / evidence 稳定下来 |
| `RuntimeTopology` | ✅ 兼容 | 通过 045 继承其 evidence，必要时再作为弱信号辅助解释 |
| `DocGraph` / 044 | ⚠️ 弱依赖 | 可用于补充文档证据或引用链，但不应成为 050 的阻塞输入 |
| `GenerateOptions.useLLM` | ✅ 兼容 | 已有 panoramic 生成器使用同一语义，适合 050 延续 |
| `llm-enricher` 路线 | ⚠️ 需注意 | 可以借鉴其“不可用时静默降级”的策略，但 050 不应让 LLM 决定结构化事实 |

## 4. 设计模式推荐

### 推荐模式

1. **Rule Object / Knowledge Base**: 每个模式定义为一条或一组规则，描述命中信号、反证信号和 explanation 元数据。
2. **Evidence Aggregator**: 把 045 的 section / node / edge evidence 聚合成可追踪的 `PatternEvidenceRef[]`，支撑 why/why-not 输出。
3. **Progressive Enhancement**: 先得到纯规则驱动的 pattern hints，再在 `useLLM=true` 时增强 explanation 语言，不让 LLM 参与事实生成。
4. **Appendix Renderer**: 050 以附录或追加版块接到架构概览后部，而不是额外创造一个脱离上下文的文档入口。

### 应用案例

- 045 已经采用“共享模型 + 模板渲染”分层，050 只需要在其上增加另一层共享结构与附录渲染。
- 当前仓库的 `llm-enricher.ts` 已体现“可选增强、不可用则静默降级”的设计；050 可以复用该约束，但不能复用其“LLM产出事实字段”的职责。

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 模式规则过于宽泛，产生高置信度误判 | 中 | 高 | 为每个模式定义正向信号、反证信号和最低阈值；输出 competing alternatives |
| 2 | explanation 依赖 LLM 后出现超范围解释或幻觉 | 中 | 高 | 规定结构化事实与 confidence 只能由规则得出；LLM 仅改写语言并引用既有 evidence |
| 3 | 050 回头解析原始文件，破坏 043/045 共享模型边界 | 低 | 高 | 在 spec 和 plan 中明确 050 只消费 045 / 弱依赖的结构化输出 |
| 4 | 多模式并列时文档阅读成本过高 | 中 | 中 | 控制输出数量，优先显示高置信度模式，并把 alternatives 收敛到少量有区分价值的候选 |
| 5 | 045 部分版块缺失导致 050 没有足够证据 | 高 | 中 | 设计 section-aware 降级策略，允许输出“低置信度”或“未识别高置信度模式” |

## 6. 需求-技术对齐度

### 覆盖评估

| 需求 | 技术方案覆盖 | 说明 |
|------|-------------|------|
| 在架构概览中追加模式提示 | ✅ 完全覆盖 | 通过 appendix renderer 挂接到 045 主文档 |
| 输出证据链和置信度 | ✅ 完全覆盖 | 由 evidence aggregator + rule scoring 提供 |
| 至少一个 why/why-not explanation | ✅ 完全覆盖 | 通过 pattern + alternative 对照生成 explanation |
| 在弱依赖或 LLM 缺失时降级 | ✅ 完全覆盖 | 通过 progressive enhancement 与 warning 机制实现 |
| 不走黑盒报告路线 | ✅ 完全覆盖 | 方案 A 明确以内嵌附录为默认交付形态 |

### 扩展性评估

当前方案对后续实验性演进友好：

- 新增模式只需补充知识库规则，而不是改动 045 的共享模型
- 如果后续想把 050 的输出用于 JSON 或 MCP 消费，可直接复用结构化 `PatternHintsOutput`
- 若未来需要引入更细的文档证据或事件证据，可在弱依赖层扩展，不破坏主输入边界

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 双语文档规范 | ✅ 兼容 | 文档中文叙述，代码标识符保持英文 |
| Spec-Driven Development | ✅ 兼容 | 050 仍按 spec -> plan -> tasks -> implement -> verify 执行 |
| 诚实标注不确定性 | ✅ 兼容 | 低置信度或证据不足时显式标注 warning / `[推断]` |
| 纯 Node.js 生态 | ✅ 兼容 | 不新增外部运行时依赖 |
| 质量门控不可绕过 | ✅ 兼容 | 050 仍应经过 design / tasks / verify 门禁 |

## 7. 结论与建议

### 总结

Feature 050 最合理的实现方式，是在 045 已稳定的 `ArchitectureOverviewModel` 之上新增一个规则优先的 `PatternHintsGenerator`：结构化输出负责模式、confidence、evidence 和 alternatives，可选 LLM 仅负责 explanation 的语言增强。这样既满足蓝图要求的“以架构概览为主载体输出”，又能保持 shared model 的单一事实来源。

### 对后续规划的建议

- 规划中应明确 050 的输入分层：强依赖是 045 结构化输出，043 / 044 只作为弱信号增强 explanation
- 不要把“黑盒模式检测”作为目标；重点是 evidence-backed hints
- 优先实现规则驱动基线和零命中 / 弱证据降级路径，再考虑 `useLLM=true` 的 explanation 增强
