# 技术调研报告: Provenance 与文档质量门

**特性分支**: `059-provenance-quality-gates`  
**调研日期**: 2026-03-21  
**调研模式**: 离线 / 独立模式  
**产品调研基础**: 无，本次按 `tech-only` 执行

## 1. 调研目标

**核心问题**:
- 如何在不重复解析源码的前提下，为 `architecture-narrative`、`component-view`、`dynamic-scenarios`、ADR 等 explanation 型文档补 provenance / confidence
- 如何基于现有结构化输出实现 conflict detector，而不是新增一套事实抽取器
- 如何定义 required-doc rule set，并在 `055` bundle manifest 可用时复用其交付层元数据
- 当前分支未包含 `055` 实现时，059 应如何降级而不破坏 batch 主链路

**需求范围（来自蓝图 054 / Phase 2）**:
- provenance 标注结构
- conflict detector（code vs spec vs current-spec vs README）
- quality report
- required-doc rule set（按项目类型给出最低文档集合）

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: Markdown 后处理器 | 方案 B: 结构化 provenance / quality layer | 方案 C: 独立治理 CLI |
|------|-------------------------|-----------------------------------------|---------------------|
| 概述 | 扫描已生成 Markdown，靠标题/正则回填 provenance | 直接消费 045/050/057/058 的结构化模型，统一生成 provenance 与 quality report | 另起一套命令，在 batch 之外单独运行 |
| 性能 | 中 | 高 | 中 |
| 可维护性 | 低 | 高 | 中 |
| 学习曲线 | 低 | 中 | 低 |
| 社区支持 | 无明显优势 | 与现有 panoramic 架构一致 | 无明显优势 |
| 与现有项目兼容性 | 中 | 高 | 低 |
| 与 055 bundle 复用 | 弱 | 强 | 中 |
| 对 059 风险控制 | 低，容易把推断伪装成事实 | 高，证据边界清晰 | 中 |

### 推荐方案

**推荐**: 方案 B，新增结构化 provenance / quality layer

**理由**:
1. 现有 045 `ArchitectureOverviewModel`、050 `PatternHintsModel`、057 `ComponentViewModel` / `DynamicScenarioModel`、058 ADR 已经带 `evidence` 或 `confidence`，最稳的路线是复用这些模型，而不是回头扫描 Markdown。
2. 059 的治理目标是“可信度前置”，如果只做 Markdown 后处理，会把事实边界从 parser/graph 层退化到字符串匹配层。
3. 结构化层可以同时服务 quality report、future product docs 和 required-doc rule set；这和蓝图里“事实层优先自研，站点层 adopt”的定位一致。

## 3. 依赖与兼容性评估

### 现有能力盘点

- **045 / 056 / 057 / 058 已可复用**
  - `ArchitectureOverviewModel` / `ArchitectureIR`
  - `PatternHintsModel`
  - `ComponentViewModel` / `DynamicScenarioModel`
  - `AdrDraft` / `AdrEvidenceRef`
- **现有 batch 接点**
  - `src/panoramic/batch-project-docs.ts`
  - `src/batch/batch-orchestrator.ts`
- **现有弱点**
  - `architecture-narrative.ts` 目前是人类叙事输出，尚未产出适合 059 直接消费的 provenance block
  - 当前分支不包含 055 的 `docs-bundle-orchestrator.ts`、`docs-bundle-types.ts`

### 依赖兼容性结论

- **不建议引入新外部依赖**
  - 仓库现有 `TypeScript + Node.js + handlebars + zod + built-ins` 已足够
  - conflict detector / required-doc rules 适合用仓内 deterministic rule engine 实现
- **055 依赖现状**
  - 蓝图将 055 标记为 059 的强依赖
  - 代码层面 `055-doc-bundle-publish-orchestration` 仍停留在独立分支 `0f7a32f`
  - 因此 059 实现需要把“消费 055 manifest”写为首选路径，同时定义“manifest 缺失时输出 dependency warning 的降级路径”

## 4. 设计模式推荐

### 推荐模式

1. **Collector -> Normalizer -> Evaluator -> Renderer**
   - 先收集多源证据，再归一化到统一 provenance model，随后做 conflict / required-doc / score 评估，最后渲染 report
2. **Deterministic Rule Engine**
   - 用显式规则而不是 LLM 决定 `conflict`、`missing-doc`、`low-evidence` 等质量结论
3. **Graceful Degradation**
   - 对缺少 `055` bundle manifest、`current-spec.md` 或 README 的项目，只下调覆盖度并输出 warning，不拖垮 batch

### 应用案例

- 058 ADR pipeline 已采用 `corpus -> candidate -> finalizeDraft` 的确定性规则思路，适合在 059 中延续
- 050 `pattern-knowledge-base.ts` 已有 confidence / evidence 聚合和 warning 输出，可直接借鉴 scoring 结构
- 057 明确把 `evidence` / `confidence` 作为为 059 预留的共享字段，说明 059 应站在这些输出之上做治理，而不是再往下重复抽取

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | `architecture-narrative` 当前缺少段落级 provenance，059 只能拿到模块级证据 | 高 | 高 | 在 059 中补 narrative provenance model 或 appendix，而不是对 Markdown 做字符串猜测 |
| 2 | 055 未合入当前主线，required-doc rule set 无法直接消费 bundle manifest | 高 | 中 | 将 `DocsBundleManifest` 作为首选输入，同时定义 manifest 缺失时的 partial report / dependency warning |
| 3 | conflict detector 主题归一化过弱，容易把无关文本误判为冲突 | 中 | 高 | 先只覆盖高价值主题：产品定位、运行时宿主、协议边界、扩展机制、降级策略 |
| 4 | 质量门做得过重，导致 batch 因治理层失败而失败 | 中 | 高 | 059 必须保持 report-first；默认只写 report 和 warnings，不阻断原有文档产出 |
| 5 | provenance 结构和模板绑定过深，后续 060 产品文档难以复用 | 中 | 中 | provenance model 只放共享结构和评估结果，模板只做渲染 |

## 6. 需求-技术对齐度

### 覆盖评估

| 需求 | 技术方案覆盖 | 说明 |
|------|-------------|------|
| provenance 标注结构 | ✅ 完全覆盖 | 复用现有 evidence-bearing outputs，并补 narrative wrapper |
| conflict detector | ✅ 完全覆盖 | 通过 deterministic topic rules 对 README / current-spec / spec / generated docs 做比对 |
| quality report | ✅ 完全覆盖 | 统一输出 Markdown + JSON 报告 |
| required-doc rule set | ✅ 完全覆盖 | 结合 project context、project docs 和 055 manifest（若可用） |

### 扩展性评估

推荐方案可平滑支持 060：
- 060 新增 `current-spec`、Issue/PR、设计文档时，只需新增 provenance source types 和 topic rules
- 质量门不需要重构主流程，只需扩展 collector 和 evaluator

### Constitution / AGENTS 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 复用现有 panoramic 抽象 | ✅ 兼容 | 059 站在已有模型之上实现 |
| 不新增单一运行时依赖 | ✅ 兼容 | 无需单独服务或 tracing agent |
| 提交前 rebase 最新 master | ✅ 兼容 | 可在实现完成后执行 |
| 只做当前 Feature 范围 | ✅ 兼容 | 059 只做 provenance / quality gate，不提前实现 060 产品接入 |

## 7. 结论与建议

### 总结

059 最稳的技术路线是新增一层 **共享 provenance / quality model + batch quality orchestrator**：
- provenance 直接消费 045/050/057/058 已有 `evidence/confidence`
- quality report 负责 conflict、required-doc、coverage、warning 汇总
- narrative 这类当前还不够结构化的文档，在 059 中补 wrapper 或 appendix，而不是 Markdown 后处理

### 对后续规格与规划的建议

- 在 spec 中把“055 manifest 缺失时的降级行为”明确成 edge case，避免实现阶段再争论依赖边界
- 在 plan 中把 059 拆成三层：`provenance model`、`quality evaluator`、`batch integration / rendering`
- 在 tasks 中把 `README/current-spec 冲突 fixture` 作为必须测试项，而不是只测 happy path
