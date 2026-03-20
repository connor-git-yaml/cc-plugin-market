# Implementation Plan: 架构模式提示与解释

**Branch**: `050-pattern-hints-explanation` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/050-pattern-hints-explanation/spec.md`

---

## Summary

实现 `PatternHintsGenerator`，以 Feature 045 的 `ArchitectureOverviewOutput` / `ArchitectureOverviewModel` 为主输入，生成规则驱动的架构模式提示、证据链、competing alternatives 和 why/why-not explanation，并将结果以内嵌附录方式追加到架构概览文档中。050 的职责是 **模式判断与解释增强**，不是重新解析 Dockerfile / Compose / workspace / import graph，也不是输出脱离上下文的黑盒模式检测报告。

本 Feature 的技术重点有四点：

1. 以 045 的共享架构视图模型作为唯一强输入边界，避免重新建模
2. 用规则 + 知识库确定模式、confidence 和 evidence，LLM 只增强 explanation 语言
3. 以“架构概览正文 + 模式提示附录”的组合渲染方式落地，而不是把 050 逻辑反向塞进 045
4. 在部分版块缺失、弱依赖不可用或 LLM 不可用时，保持 section-aware 降级与可审查输出

---

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js >= 20  
**Primary Dependencies**: 现有 panoramic generators、`handlebars`、`zod`、Node.js built-ins、现有 optional LLM auth/proxy helpers  
**Storage**: 文件系统（`specs/` 文档、`templates/`、`tests/`）  
**Testing**: `vitest`, `npm run lint`, `npm run build`  
**Target Platform**: Node.js CLI / MCP panoramic pipeline  
**Project Type**: 单仓库 TypeScript project  
**Performance Goals**: 050 的规则评估只基于 045 结构化输出，不引入高于 045 组合生成的额外文件扫描复杂度；`useLLM=false` 时应维持纯本地快速执行  
**Constraints**:

- 不新增 parser registry，也不重新解析底层项目事实
- 050 必须以 045 架构概览为主载体输出附录，而不是独立黑盒报告
- 结构化事实、confidence 和 evidence 必须由规则与共享模型决定，LLM 只能增强 explanation 文本
- 043 / 044 仅作为弱依赖增强信号；缺失时不得阻断 050 主流程
- 所有写操作限于 `specs/050-pattern-hints-explanation/`、`src/panoramic/`、`templates/`、`tests/`

**Scale/Scope**: 1 个新 generator、1 份 pattern hints 共享模型、1 份知识库 helper、1 个附录模板、若干测试与 registry / barrel 集成

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| **I. 双语文档规范** | 适用 | PASS | 文档/计划中文叙述，代码标识符与路径保持英文 |
| **II. Spec-Driven Development** | 适用 | PASS | 已按 spec -> plan -> tasks 路线推进 |
| **III. 诚实标注不确定性** | 适用 | PASS | 低置信度、弱证据和 competing alternatives 会显式标注 |
| **IV. AST / 静态提取优先** | 适用 | PASS | 050 不新建事实抽取链，只消费 045 的结构化输出 |
| **V. 混合分析流水线** | 适用 | PASS | 规则决定结构化事实，LLM 只增强 explanation 文本 |
| **VI. 只读安全性** | 适用 | PASS | 仅修改允许的源代码、模板、测试和 spec 制品 |
| **VII. 纯 Node.js 生态** | 适用 | PASS | 无新增非 Node 运行时依赖 |
| **X. 质量门控不可绕过** | 适用 | PASS | 保留 design/tasks/verify 门禁 |
| **XI. 验证铁律** | 适用 | PASS | 后续实现必须附带真实 lint/build/test 证据 |

**结论**: 当前设计通过，无需豁免。

---

## Project Structure

### Documentation (this feature)

```text
specs/050-pattern-hints-explanation/
├── spec.md
├── research/
│   └── tech-research.md
├── research.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── pattern-hints-output.md
├── checklists/
│   ├── requirements.md
│   └── architecture.md
└── tasks.md
```

### Source Code (repository root)

```text
src/panoramic/
├── pattern-hints-generator.ts          # [新增] 050 generator
├── pattern-hints-model.ts              # [新增] 050 共享 pattern hint 模型
├── pattern-knowledge-base.ts           # [新增] 050 规则 / 知识库定义与 helper
├── architecture-overview-generator.ts  # [复用] 045 强依赖输入
├── architecture-overview-model.ts      # [复用] 045 共享架构模型
├── generator-registry.ts               # [修改] 注册 pattern-hints
└── index.ts                            # [修改] 导出 generator + model + helper

templates/
└── pattern-hints.hbs                   # [新增] 050 附录模板

tests/panoramic/
└── pattern-hints-generator.test.ts     # [新增] 单元 / 组合测试
```

**Structure Decision**: 050 只在 `src/panoramic/` 新增模式提示层和知识库，不回改 045 模板为“内置模式模式”；渲染阶段直接复用 045 的 Markdown 输出，再拼接 050 附录。

---

## Phase 0: Research Decisions

### 决策 1: 050 作为独立 generator 复用 045，而不是把模式逻辑塞回 045

- **Decision**: `PatternHintsGenerator.extract()` 内部组合调用 `ArchitectureOverviewGenerator`，以其结构化输出为主输入
- **Rationale**: 保持 045/050 边界清晰，满足“045 提供事实、050 提供增强解释”的蓝图路线
- **Alternatives considered**:
  - 修改 045 模板直接内嵌模式逻辑：会让 045 的职责膨胀
  - 独立黑盒报告：违背 050 作为 045 增强层的蓝图要求

### 决策 2: 模式判断由规则和知识库决定，LLM 只增强语言

- **Decision**: 新增 `pattern-knowledge-base.ts`，用规则匹配和权重评分生成 `PatternHint`
- **Rationale**: 降低 hallucination 风险，保证 evidence 和 confidence 可追踪、可复核
- **Alternatives considered**:
  - 让 LLM 直接判定模式：无法满足“事实可追踪”的要求
  - 纯静态文案模板无 explanation 增强：why/why-not 说明会过于生硬

### 决策 3: 通过“base markdown + appendix markdown”实现附录交付

- **Decision**: `render()` 先复用 `ArchitectureOverviewGenerator.render()`，再拼接 `pattern-hints.hbs`
- **Rationale**: 不需要侵入 045 模板，也能保证用户看到的是完整架构概览主文档 + 附录
- **Alternatives considered**:
  - 直接输出仅含 pattern hints 的新文档：容易滑向黑盒报告
  - 回改 045 模板接收 optional appendix：会让 045 与 050 反向耦合

### 决策 4: section-aware 降级，而不是整体失败

- **Decision**: 根据 `ArchitectureViewSection.available` 与 evidence 丰富度调整 pattern confidence 和 warnings
- **Rationale**: 兼容缺失 deployment / layered view 的项目形态，同时保持“未识别高置信度模式”的明确结论
- **Alternatives considered**:
  - 任一版块缺失即不输出模式提示：会显著降低 050 的实际可用性

---

## Phase 1: Design & Contracts

### 1. Shared Model

新增 `src/panoramic/pattern-hints-model.ts`，定义以下共享实体：

- `PatternHintsInput`
- `PatternHintsOutput`
- `PatternHintsModel`
- `PatternHint`
- `PatternAlternative`
- `PatternEvidenceRef`
- `PatternHintStats`
- `PatternMatchLevel`

**Design Rule**: 共享模型不包含 Markdown / Handlebars 字段；只承载 050 和未来消费方共享的结构化模式判断结果。

### 2. Knowledge Base / Rule Engine

新增 `src/panoramic/pattern-knowledge-base.ts`：

- `PatternKnowledgeBaseEntry`
- `PatternSignalRule`
- `evaluatePatternHints(model)`
- `buildPatternExplanation()` 或等价 helper

首批候选模式聚焦高信号、低争议模式：

- `modular-monolith`
- `layered-architecture`
- `service-oriented-runtime`

**Rule Strategy**:

1. 读取 045 的 `sections`、`moduleSummaries`、`deploymentUnits`、`warnings`
2. 基于 section / node / edge / evidence 计算 matched signals
3. 根据缺失版块与反证信号扣分
4. 生成 competing alternatives 与最小 explanation 骨架

### 3. Generator Design

新增 `src/panoramic/pattern-hints-generator.ts`：

- `id = 'pattern-hints'`
- `isApplicable(context)`
- `extract(context)`
- `generate(input, options)`
- `render(output)`

#### `extract()` 设计

1. 调用 `ArchitectureOverviewGenerator.extract()/generate()`
2. 取其 `ArchitectureOverviewOutput` 作为强输入
3. 视情况透传 `RuntimeTopologyOutput` 或可获得的弱依赖信号元信息
4. 若 045 不适用，则 050 也不适用

#### `generate()` 设计

1. 调用知识库规则评估 pattern hints
2. 产出：
   - `matchedPatterns`
   - `alternatives`
   - `warnings`
   - `stats`
3. `useLLM=true` 时仅增强 explanation / summary 文案
4. 若无模式过阈值，生成显式 `noHighConfidenceMatch` 结论

#### `render()` 设计

1. 复用 045 的 `architecture overview` Markdown 正文
2. 使用 `templates/pattern-hints.hbs` 生成附录
3. 拼接为单份输出文档

### 4. Contracts

在 `contracts/pattern-hints-output.md` 中定义：

- 强输入边界（045 结构化输出）
- 可选弱依赖信号边界
- 结构化输出边界
- 附录渲染与降级行为约定

### 5. Agent Context Update

运行 `.specify/scripts/bash/update-agent-context.sh codex`，同步 050 的技术上下文。

---

## Verification Strategy

1. 定向单元 / 组合测试：
   - `npx vitest run tests/panoramic/pattern-hints-generator.test.ts`
2. 回归相关 panoramic 测试：
   - `tests/panoramic/architecture-overview-generator.test.ts`
   - `tests/panoramic/runtime-topology-generator.test.ts`
   - `tests/panoramic/generator-registry.test.ts`
3. 静态验证：
   - `npm run lint`
   - `npm run build`
4. 提交前主线同步：
   - `git fetch origin && git rebase origin/master`

---

## Risks & Mitigations

- **风险**: 050 变成另一个黑盒模式检测器  
  **缓解**: 强制以 045 输出为主载体渲染附录，不单独交付 detached report

- **风险**: LLM explanation 与规则结论漂移  
  **缓解**: 把 confidence / evidence / alternatives 固定在结构化层，LLM 只改写 explanation 文本

- **风险**: 模式规则过宽，出现高置信度误判  
  **缓解**: 设计 matched signals + counter-signals + minimum threshold，并展示 competing alternatives

- **风险**: 缺失 deployment 或 layered 视图时整体失败  
  **缓解**: 以 section-aware 降级方式降低 confidence，并输出显式 warning / no-match 说明

- **风险**: 044 弱依赖暂不可用，导致 explanation 深度不足  
  **缓解**: 将 044 集成设计为可选增强，不作为 MVP 阻塞项

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 无 | N/A | 当前设计未违反 Constitution |
