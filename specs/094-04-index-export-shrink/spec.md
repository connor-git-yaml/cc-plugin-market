---
feature: F-094-04
title: index.ts 导出收口与 API 分层
status: Draft
created: 2026-04-11
priority: P1
milestone: M-094
depends_on: []
---

# Feature Specification: F-094-04 — index.ts 导出收口与 API 分层

**Feature Branch**: `claude/admiring-engelbart`
**Created**: 2026-04-11
**Status**: Draft

## 背景与问题陈述

`src/panoramic/index.ts` 目前导出约 120 个符号，包含大量内部实现细节类型（细粒度模型类型、工具函数、内部常量）。外部消费者无法区分哪些属于稳定公共 API、哪些属于内部实现，导致：

1. 桶文件体积膨胀，影响 TypeScript 编译速度和 IDE 性能
2. 外部代码可以意外依赖内部类型，破坏封装边界
3. API 曲面模糊，维护者难以安全重构内部实现

**调研揭示的关键事实**：当前外部 `src/` 代码（batch-orchestrator、delta-regenerator、cli/index、mcp/server）完全绕过 `index.ts`，直接通过子模块路径（如 `../panoramic/xxx.js`）导入所需符号。这意味着：

- `index.ts` 对内部调用链实际无约束力
- 约 100+ 符号在 `index.ts` 中导出，但实际上没有任何外部消费者通过桶文件使用
- 8 个被外部实际使用的符号甚至未包含在当前 `index.ts` 导出中

本特性不依赖 F-094-02（目录结构重组）即可独立执行。若 F-094-02 在本特性之后执行，导入路径需随之更新，但 API 分层决策本身不受影响。

---

## User Scenarios & Testing

### User Story 1 — 公共 API 明确化（Priority: P1）

作为 panoramic 模块的外部消费者（如 cli、mcp、batch 层），我希望通过 `index.ts` 就能找到所有需要使用的稳定公共 API，而不需要猜测或搜索内部子模块路径，从而降低错误依赖内部实现的风险。

**Why this priority**: 这是本特性的核心价值。公共 API 集合明确后，消费者才能建立稳定的依赖关系，维护者才能安全重构内部实现。

**Independent Test**: 可通过检查 `index.ts` 的导出列表，验证全部 15 个已知公共符号（7 个当前已导出 + 8 个遗漏补充）均可从 `index.ts` 导入，且 `npm run build` 无错误。

**Acceptance Scenarios**:

1. **Given** `src/panoramic/index.ts` 完成收口，**When** 外部消费者通过 `import { bootstrapGenerators, buildProjectContext, buildDocGraph } from './panoramic/index.js'` 导入，**Then** TypeScript 编译通过，所有 15 个公共符号均可解析。

2. **Given** `src/panoramic/index.ts` 完成收口，**When** 统计其 export 行数，**Then** 行数不超过 60 行。

3. **Given** 8 个此前未在 `index.ts` 中导出的外部使用符号（`buildDocGraph`、`scanStoredModuleSpecs`、`StoredModuleSpecSummary`、`buildCrossReferenceIndex`、`generateBatchProjectDocs`、`generateDocsQualityReport`、`BatchProjectDocsResult`、`resolveSpecForSource`），**When** 外部消费者通过 `index.ts` 导入，**Then** 导入成功，无需修改外部调用方代码逻辑（仅路径变更）。

---

### User Story 2 — 内部 API 隔离与标注（Priority: P1）

作为 panoramic 模块的内部开发者（测试代码、内部跨子模块引用），我希望有一个明确标注为内部的 `internal.ts` 文件，可以导入细粒度模型类型和工具函数，同时清楚地知道这些符号不承诺外部稳定性。

**Why this priority**: 与 User Story 1 并列 P1——没有内部 API 的承接层，收口 `index.ts` 后内部依赖将无处引用。

**Independent Test**: 可通过检查 `src/panoramic/internal.ts` 是否存在、包含 `@internal` JSDoc 标注，以及全量 vitest 测试通过来验证。

**Acceptance Scenarios**:

1. **Given** `src/panoramic/internal.ts` 已创建，**When** 查看文件头部，**Then** 存在 `@internal` JSDoc 注释，明确说明该文件不承诺外部 API 稳定性。

2. **Given** 原 `index.ts` 中被归类为内部的符号已迁移至 `internal.ts`，**When** 内部测试文件或 panoramic 内部子模块从 `internal.ts` 导入，**Then** 导入成功，TypeScript 编译无错误。

3. **Given** 完成分层后，**When** 运行 `vitest run` 全量测试，**Then** 所有测试通过，无新增失败用例。

---

### User Story 3 — 导入路径策略澄清（Priority: P2）

作为项目维护者，我希望对"外部代码是否应该被强制通过 `index.ts` 导入、禁止直接引用子模块"有明确的策略决策，从而避免遗留的直接子模块导入路径在未来制造混乱。

**Why this priority**: 调研发现当前外部代码全部绕过 `index.ts` 直接引用子模块，强制收口需要同步修改多处外部调用方（batch-orchestrator、delta-regenerator、cli、mcp）。这是影响范围和工期的关键决策点，但不影响 index.ts/internal.ts 本身的创建。

**Independent Test**: 通过代码审查确认外部调用方的导入路径策略已被记录为决策，无论选择哪种策略，build 均通过。

**Acceptance Scenarios**:

1. **Given** 本特性执行完毕，**When** 审查外部 `src/` 代码的 panoramic 导入路径，**Then** 所选策略（保留直接子模块导入 OR 迁移至 index.ts）在 spec 中已明确记录，实现与决策一致。

2. [AUTO-RESOLVED: 基于调研事实——外部代码当前全部使用直接子模块路径，强制迁移至 index.ts 属于额外范围扩大，本特性 MVP 阶段保留现有直接子模块导入路径，仅完成 index.ts/internal.ts 分层本身。外部路径迁移可作为后续独立特性执行。]

---

### Edge Cases

- **Edge Case 1**（关联 FR-003）：8 个遗漏符号补充到 `index.ts` 后，若其源模块存在循环依赖，可能导致 barrel 导入时的初始化顺序问题。需在实现时验证 build 产物无循环依赖警告。

- **Edge Case 2**（关联 FR-002）：4 个使用 `import * as panoramic from 'index.js'` 的测试文件依赖桶文件的完整导出范围。收口后若测试引用的符号被迁移至 `internal.ts`，测试需同步更新导入路径。

- **Edge Case 3**（关联 FR-004）：F-094-02 执行后子模块路径将发生变化，`index.ts` 和 `internal.ts` 的内部 `export ... from './xxx.js'` 路径需随之更新。本特性应使用当前路径，不预先适配 F-094-02 的新目录结构。

- **Edge Case 4**（关联 FR-001）：`index.ts` 行数限制（≤60 行）与导出符号数量的关系需在实现时确认——若使用 `export type { A, B, C }` 多符号合并导出，15 个符号可在远少于 60 行内完成；若每行一个符号则约需 15–20 行，有足够余量。

---

## Requirements

### Functional Requirements

- **FR-001**：`src/panoramic/index.ts` 的 export 行数 MUST 不超过 60 行。[必须]
  - 可测试方式：`wc -l src/panoramic/index.ts` 并审计 export 语句行数，或通过 AST 工具统计。

- **FR-002**：`index.ts` MUST 导出全部 15 个公共 API 符号（当前已在 index.ts 的 7 个 + 遗漏的 8 个），具体包括：`bootstrapGenerators`、`bootstrapParsers`、`buildProjectContext`、`CoverageAuditor`、`orchestrateDocsBundle`、`DocsBundleProfileSummary`、`loadTemplate`、`buildDocGraph`、`scanStoredModuleSpecs`、`StoredModuleSpecSummary`、`buildCrossReferenceIndex`、`generateBatchProjectDocs`、`generateDocsQualityReport`、`BatchProjectDocsResult`、`resolveSpecForSource`。[必须]
  - 可测试方式：TypeScript 编译通过，且对上述每个符号执行 `import { X } from './panoramic/index.js'` 无错误。

- **FR-003**：`src/panoramic/internal.ts` MUST 存在，文件头部包含说明内部 API 性质的 `@internal` JSDoc 注释块。[必须]
  - 可测试方式：检查文件存在性及头部 JSDoc 内容。

- **FR-004**：`internal.ts` MUST 导出原 `index.ts` 中不属于公共 API 的全部符号（约 100+ 个细粒度模型类型、工具函数、内部常量），以确保 panoramic 内部模块和测试代码的导入不中断。[必须]
  - 可测试方式：全量 `vitest run` 通过，无新增测试失败。

- **FR-005**：`npm run build` MUST 在完成分层后无编译错误。[必须]
  - 可测试方式：`npm run build` 命令成功退出（exit code 0）。

- **FR-006**：4 个使用 `import * as panoramic from 'index.js'` 的测试文件 MUST 在收口后仍能通过，必要时同步更新其导入来源（从 `index.ts` 或 `internal.ts` 按符号归属导入）。[必须]
  - 可测试方式：全量 `vitest run` 通过。

- **FR-007**：外部 `src/` 代码（batch-orchestrator、delta-regenerator、cli/index、mcp/server）现有的直接子模块导入路径 MAY 保持不变，无需强制迁移至 `index.ts`。[可选]
  - 理由：本特性 MVP 聚焦 API 分层本身，外部路径迁移不是当前迭代必须目标；强制迁移扩大改动范围，不符合 YAGNI 原则。

- **FR-008**：`internal.ts` 中的任何符号 SHOULD NOT 被 `src/` 外部代码（panoramic 目录外）通过桶文件路径直接引用。[可选]
  - 理由：通过命名和 @internal 标注传递语义约束，正式 lint 规则可在后续迭代中补充；当前迭代不引入新的 ESLint plugin 依赖。[YAGNI-移除：强制 lint 规则，当前迭代不实现]

### Key Entities

- **`index.ts`（公共 API 层）**：仅导出经过审计的 15 个公共符号，作为外部消费者的稳定导入入口。

- **`internal.ts`（内部 API 层）**：导出全部非公共符号，供 panoramic 内部模块和测试代码使用，头部标注 `@internal`，明示不承诺外部稳定性。

- **公共符号集合（Public API Set）**：经调研确认的 15 个符号，包含 Registry 启动函数、上下文构建函数、核心业务类和文档 bundle 相关类型。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**：`src/panoramic/index.ts` 的 export 语句行数 ≤ 60 行（从约 120 个符号缩减至约 15 个公共符号）。

- **SC-002**：`src/panoramic/internal.ts` 文件存在，包含 `@internal` JSDoc，并可导出原 index.ts 中的全部内部符号。

- **SC-003**：`npm run build` 无错误完成。

- **SC-004**：全量 `vitest run` 通过，无新增测试失败（相较于分层前的测试基线）。

- **SC-005**：15 个公共 API 符号均可通过 `index.ts` 单一入口导入，无需外部消费者直接引用子模块路径。

---

## 歧义处理记录

1. [AUTO-RESOLVED: 外部代码是否需强制迁移至 index.ts 导入 — 基于调研事实，当前外部代码全部使用直接子模块路径，强制迁移属于额外工作量且超出本特性范围。本 spec 决策为：MVP 阶段保留现有直接子模块导入，仅建立 index.ts/internal.ts 分层。]

2. [AUTO-RESOLVED: F-094-02 依赖关系 — 蓝图标注"在 F-094-02 之后"，但调研确认本特性可独立执行，API 分层决策不受目录结构影响。本 spec 在当前目录结构下定义需求，F-094-02 执行后路径更新作为联动任务处理。]

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 |
|------|----|
| 组件总数 | 2（index.ts 重写 + internal.ts 新建） |
| 接口数量 | 0（无新增接口，仅重新组织现有导出） |
| 依赖新引入数 | 0 |
| 跨模块耦合 | 是（需同步更新 4 个测试文件的导入路径） |
| 复杂度信号 | 无（无递归结构、状态机、并发控制、数据迁移） |
| **总体复杂度** | **LOW** |

**判定理由**：组件数 2 < 3，接口数 0 < 4，无复杂度信号。跨模块耦合仅限于测试文件导入路径调整，属于机械性变更，不涉及逻辑修改。GATE_DESIGN 无需人工审查，可直接推进实现阶段。
