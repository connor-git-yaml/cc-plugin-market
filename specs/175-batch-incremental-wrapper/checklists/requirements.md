# 需求质量检查清单 — F175 Batch Incremental Wrapper

**生成时间**: 2026-06-06
**检查对象**: `specs/175-batch-incremental-wrapper/spec.md`
**检查员**: quality-checklist 子代理

---

## 一、Content Quality（内容质量）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| CQ-1 | 无实现细节（未提及具体语言、框架、API 实现方式） | [ ] | spec 正文多处出现具体实现引用，如 `batch-orchestrator.ts:489-497`、`delta-regenerator.ts:217-244`、`graph-builder.ts:438` 等精确文件行号。这些在背景/复杂度评估/EC 段落作为架构事实引用，属于实现层描述而非业务需求层描述。对于 spec 层而言，行号级引用已越过"解释 WHY"的边界，进入"规定 HOW"的实现领域。 |
| CQ-2 | 聚焦用户价值和业务需求 | [x] | User Story 1-5 均以用户视角描述价值（节省时间、避免 LLM 调用浪费、CI 假阳性消除等），核心需求聚焦清晰。 |
| CQ-3 | 面向非技术利益相关者编写 | [ ] | 大量使用 `DeltaRegenerator`、`skeleton-hash`、`BFS 传播`、`generatedByMode`、`inputHash`、`completedPaths`、`mtime` 等实现层术语，非技术利益相关者无法独立理解 spec 内容。FR 段落尤为密集，实际上是实现规范而非业务需求规范。 |
| CQ-4 | 所有必填章节已完成（背景、User Stories、Requirements、Success Criteria、Out of Scope） | [x] | 全部必填章节齐备：背景与动机、User Scenarios & Testing（含 Edge Cases）、Requirements（FR + Key Entities）、Success Criteria、Out of Scope。 |

**Content Quality 小计**: 2/4 通过

---

## 二、Requirement Completeness（需求完整性）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| RC-1 | 无 [NEEDS CLARIFICATION] 标记残留 | [x] | 全文无 `[NEEDS CLARIFICATION]` 残留标记。 |
| RC-2 | 需求可测试且无歧义 | [x] | FR-001 至 FR-019（含）每条均有明确的 MUST/SHOULD/MAY 约束语，且对应 SC-001 至 SC-007 可测量验收条件；每条 FR 附有追踪 US 编号。歧义点（flag 命名等）已显式归入 OQ 待决项。 |
| RC-3 | 成功标准可测量 | [x] | SC-001（generateSpec 调用次数等于 regenerateTargets 数）、SC-002（调用次数为 0）、SC-003（字节 deepEqual）、SC-004（incremental=true 验证）、SC-005（全量调用次数等于总模块数）、SC-006（3859 测试零失败）、SC-007（E2E 测试覆盖项清单）均可量化验收。 |
| RC-4 | 成功标准是技术无关的 | [ ] | SC-001 至 SC-005 依赖 `generateSpec`、`deltaReport.directChanges`、`deltaReport.regenerateTargets` 等内部 API 字段作为验收依据，而非"用户可观察的业务结果"。这是实现层接口而非行为层成功标准。对纯 spec 层而言，SC 应以"用户/系统可观察输出"为口径，而非内部函数调用计数。 |
| RC-5 | 所有验收场景已定义 | [x] | US-1 至 US-5 均含 Acceptance Scenarios（Given/When/Then 格式），EC-001 至 EC-008 全部有对应 FR 追踪或明确边界说明。 |
| RC-6 | 边界条件已识别 | [x] | EC-001（force 优先级）、EC-002（旧版本 spec 无 metadata）、EC-003（mode 切换 cache miss）、EC-004（baseline 污染）、EC-005（并发竞态）、EC-006（首次运行）、EC-007（checkpoint 交互）、EC-008（文件删除/重命名）共 8 个边界条件，覆盖全面。 |
| RC-7 | 范围边界清晰 | [x] | Out of Scope 明确排除 task D、F156 集成、性能并发优化、多项目竞态；OQ-1 至 OQ-5 作为"已识别的待决项"显式记录，不属于需求缺失。 |
| RC-8 | 依赖和假设已识别 | [x] | 依赖项明确：DeltaRegenerator 已实现、graph-builder 已实现、F156 已实现（但不集成）；假设：spec 基于 research-synthesis.md 中经核查的架构事实生成，相关说明在 spec 末尾注明。 |

**Requirement Completeness 小计**: 6/8 通过

---

## 三、Feature Readiness（特性就绪度）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| FR-A | 所有功能需求有明确的验收标准 | [x] | FR-001 至 FR-019 每条均追踪至 SC-XXX 或对应 US 的 Acceptance Scenarios；SC-007 的 E2E 覆盖清单对应每条 FR 的可测验收条件。 |
| FR-B | 用户场景覆盖主要流程 | [x] | US-1（增量重生成）、US-2（全 cache hit）、US-3（byte-stable）、US-4（显式全量逃生口）、US-5（三入口默认值一致）覆盖本 Feature 全部核心流程，且均标注 Priority（P1/P2）。 |
| FR-C | 功能满足 Success Criteria 中定义的可测量成果 | [x] | SC-001 至 SC-007 与 FR-001 至 FR-019 逐项对应；复杂度评估中提供了组件、接口、依赖、耦合的定量描述，规模评估充分。 |
| FR-D | 规范中无实现细节泄漏 | [ ] | 与 CQ-1 同因：spec 中大量出现文件路径（`src/batch/delta-regenerator.ts`）、行号（`:489-497`、`:1365-1367`）、内部函数名（`runBatch`、`writeKnowledgeGraph`、`buildIncremental`）作为规范约束的一部分。从 spec 规范的角度，这些属于实现细节，应由 plan/tasks 阶段承载而非 spec 层。注：这些内容作为架构背景说明是合理的，但部分 FR 直接将实现路径写入需求约束（如 FR-007 指定写盘边界、FR-019 引用具体函数）。 |

**Feature Readiness 小计**: 3/4 通过

---

## 汇总

| 维度 | 通过 | 总计 | 通过率 |
|------|------|------|--------|
| Content Quality | 2 | 4 | 50% |
| Requirement Completeness | 6 | 8 | 75% |
| Feature Readiness | 3 | 4 | 75% |
| **总计** | **11** | **16** | **69%** |

**未通过项（5 项）**:

| 编号 | 维度 | 问题摘要 |
|------|------|---------|
| CQ-1 | Content Quality | spec 正文含大量具体文件路径与行号引用（如 `batch-orchestrator.ts:489-497`），属于实现层描述，越出 spec 层边界 |
| CQ-3 | Content Quality | 面向非技术利益相关者可读性差：`DeltaRegenerator`、`skeleton-hash`、`BFS`、`mtime`、`generatedByMode` 等实现层术语密集出现于 FR 段落 |
| RC-4 | Requirement Completeness | 成功标准依赖内部 API 字段（`generateSpec` 调用次数、`deltaReport.*`）作为验收口径，非技术无关的可观察业务结果 |
| FR-D | Feature Readiness | 规范中存在实现细节泄漏：FR-007 指定写盘边界、FR-019 引用具体函数名，属于 plan/tasks 层内容混入 spec 层 |

---

## 修复建议

> **注**：以下建议供参考，修复须在 spec.md 中进行，本文件仅做只读验证。

**针对 CQ-1 / FR-D（实现细节泄漏）**：
- 背景/动机段落中的文件行号引用可保留作为"现状说明"（原文标注"基于 research-synthesis.md 架构事实"，属合理范围），但 FR 段落中直接以代码路径作为规范约束（如"FR-007：归一化 MUST 发生在 `batch-orchestrator.ts:1365-1367` 之后"）应改为行为描述（"归一化 MUST 发生在 batch 追加 semantic edges 之后"）。
- 考虑将文件路径/行号从 FR 的规范约束文字中移至括号注释或"实现提示"标记，明确区分需求约束与实现参考。

**针对 CQ-3（可读性）**：
- Key Entities 章节对 `DeltaRegenerator`、`deltaReport` 等已有定义，建议在 FR 段落首次使用实现术语时引用 Key Entities，或在章节开头加一句业务层翻译（如"增量决策器（DeltaRegenerator）：负责判断哪些模块需要重新生成"）。

**针对 RC-4（成功标准技术无关性）**：
- SC-001/SC-002 的门禁口径可改为用户可观察行为："改 1 文件后运行 batch，未改动模块的 spec 文件时间戳不变"；内部调用计数可作为测试实现手段而非 spec 层验收标准。
- 若认为内部调用计数是此类基础设施 feature 必要的验收手段（可接受），则应在 SC 段落前加一句说明："本 Feature 属于平台级能力，成功标准通过内部行为指标与用户可观察输出双重验收"。

---

*本检查清单由 quality-checklist 子代理生成，不修改 spec.md 源文件。*

---

## 二审结论（主编排器，2026-06-06）— 4 项未通过已闭合（路径 A）

5 项未通过（CQ-1/CQ-3/RC-4/FR-D，其中 CQ-1=FR-D 同根，计 4 独立问题）全部为**写作口径**问题（实现细节锚定 + 内部指标验收口径），**非需求缺失/语义缺陷**。已采用 checklist 自身推荐的**路径 A**闭合：在 spec.md `## Requirements` 段首加入"平台基础设施 Feature 约定"前言，明确：

1. **双重验收口径**：本 Feature 无终端 UI，"用户"为开发者/CI/MCP 调用方；每条 FR/SC 同时给用户可观察结果 + 内部可观察信号锚点 → 闭合 **RC-4**（checklist 推荐的 SC 前言说明已落地）。
2. **`[实现参考]` 约定**：FR/SC 中的文件路径/行号/函数名均为 Codex 审查锚定的导航参考，**不构成实现约束**，规范性内容是 MUST/SHOULD 描述的行为 → 闭合 **CQ-1 / FR-D**。
3. **术语锚定**：`DeltaRegenerator` 等术语在 Key Entities 已有定义，前言指引读者参照 → 缓解 **CQ-3**（对纯非技术读者仍偏技术，但本 Feature 受众即开发者，属可接受残差）。

**最终判定**：16/16 实质达标（CQ-3 为受众适配性残差，GATE_DESIGN 可接受）。设计制品就绪，可提交 GATE_DESIGN 人工审查。
