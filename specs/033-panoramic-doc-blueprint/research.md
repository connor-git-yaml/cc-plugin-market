# 技术决策研究: 033-panoramic-doc-blueprint

**Feature Branch**: `033-panoramic-doc-blueprint`
**Date**: 2026-03-18
**Status**: Resolved

---

## Decision 1: 蓝图文档的组织方式——单文件 vs 多文件

### 问题

blueprint.md 预估 500-800 行，17 个 Feature 条目 + 依赖图 + 风险清单 + 验证计划，是否应拆分为多个文件？

### 结论

**单一 blueprint.md 文件**，不拆分。

### 理由

1. spec.md FR-019 明确要求"单一 Markdown 文件输出"
2. 蓝图的核心价值是"全景可见性"——单文件支持 Ctrl+F 全文搜索、GitHub 在线预览、一次性阅读
3. 预估 600-700 行在单文件可管理范围内（相当于一个中等规模的技术文档）
4. 多文件拆分会引入导航成本，与蓝图的全景定位矛盾

### 替代方案

- **多文件方案**（每 Phase 一个文件 + 总览文件）：信息分散，读者需在文件间跳转，不利于全景浏览。REJECTED。
- **单文件 + 独立附件**（核心正文 + 接口契约单独文件）：增加维护同步成本。REJECTED。

---

## Decision 2: Feature 编号系统——specs 编号 vs 调研编号

### 问题

tech-research.md 使用内部编号 F-000~F-016，spec.md 分配了 specs 目录编号 034-050。蓝图正文中应使用哪种编号？

### 结论

**specs 目录编号（034-050）为唯一主标识符**，调研编号仅在"编号映射表"中出现一次作为参照。

### 理由

1. spec.md FR-002a 明确要求 specs 编号为主标识符
2. specs 编号是后续 Feature 实际使用的标识符（`specs/034-xxx/`、`specs/035-xxx/` 等）
3. 双编号系统会在引用时造成混淆（"F-003 还是 037？"）
4. 映射表保留调研编号的可追溯性，但正文不再使用

### 替代方案

- **双编号并行**（正文中同时展示两种编号）：信息冗余，读者困惑。REJECTED。
- **仅调研编号**（F-000~F-016）：与下游 specs 目录不对齐，后续引用不一致。REJECTED。

---

## Decision 3: 依赖关系的呈现方式

### 问题

spec.md 要求 Mermaid 依赖图 + 依赖矩阵表格。两者的信息组织方式如何设计？

### 结论

**Mermaid 有向图展示全局依赖拓扑 + 表格提供逐 Feature 的快速查阅**。两者互补，不重复。

### 理由

1. Mermaid 图适合"鸟瞰"——快速识别关键路径、并行分组、Phase 边界
2. 表格适合"查阅"——按 Feature 编号快速定位其前置依赖，无需在图中寻找箭头
3. spec.md FR-006 / FR-007 分别要求两种格式
4. Mermaid 图使用 subgraph 按 Phase 分组，视觉上强化层次感

### 替代方案

- **仅 Mermaid 图**：非线性阅读场景下查找不便。不满足 FR-007。REJECTED。
- **仅表格**：无法直观展示全局拓扑和并行可能性。不满足 FR-006。REJECTED。

---

## Decision 4: 验证标准的详细程度

### 问题

spec.md FR-010 要求每个 Feature 至少 2 条验证标准，FR-011 要求可转化为 Given-When-Then。在蓝图阶段应写到什么详细程度？

### 结论

**概要级验证标准**——描述可观测的预期结果，提供足够的上下文使后续 spec 编写者能直接展开为 Given-When-Then，但不在蓝图中写出完整的 Given-When-Then 格式。

### 理由

1. 蓝图是规划文档而非详细设计文档，每个 Feature 后续有独立的 spec.md
2. 过度详细的验证标准会使蓝图文档膨胀（17 Feature x 2+ 条 x Given-When-Then = 100+ 行纯验证文本）
3. 概要级标准描述"验证什么"和"预期结果"，足够指导后续 spec 编写
4. spec.md FR-011 使用 MUST 要求"可转化"而非"已转化"

### 替代方案

- **完整 Given-When-Then 格式**：蓝图膨胀严重，且 Feature 实施时必然需要调整细节。REJECTED。
- **仅标题级验证标准**（如"验证接口正确性"）：过于模糊，无法指导后续 spec。REJECTED。

---

## Decision 5: 核心抽象接口契约的展示方式

### 问题

spec.md FR-012 要求包含 4 个核心抽象的接口契约概要，FR-013 要求"概要"但"不包含完整 TypeScript 类型定义"。如何在蓝图中呈现？

### 结论

**自然语言描述 + 核心方法列表**（方法名 + 一句话职责描述），不包含 TypeScript 语法的参数类型和返回值类型。

### 理由

1. spec.md FR-013 明确禁止完整 TypeScript 类型定义
2. tech-research.md 第 2.4 节已提供详细 TypeScript 接口定义，蓝图中重复无益
3. 蓝图的受众不仅是实施者，也包括项目管理者和利益相关者（Story 5/6）
4. 核心方法列表 + 一句话描述足以建立接口设计的共识

### 替代方案

- **伪代码格式**：可能与实际 TypeScript 实现产生歧义。REJECTED。
- **完整 TypeScript 接口**：违反 FR-013 的 MUST NOT 约束。REJECTED。
- **纯文字描述不列方法名**：过于抽象，实施者无法建立具体的设计参照。REJECTED。

---

## Decision 6: 蓝图文档的章节结构

### 问题

如何组织蓝图文档的章节，使其同时满足"全景浏览"（Story 1）、"依赖追踪"（Story 2）、"验证查阅"（Story 3）、"接口预览"（Story 4）、"风险管理"（Story 5）、"验证计划"（Story 6）六个使用场景？

### 结论

采用以下章节结构（详见 plan.md 的 Architecture 章节）：

```
1. 概览与目标
2. 编号映射表（F-xxx → 034-050，仅出现一次）
3. MVP 范围定义
4. Phase 分解与 Feature 详情（Phase 0 → 3，每个 Feature 含验证标准）
5. 依赖关系（Mermaid 图 + 依赖矩阵 + 并行分组）
6. 核心抽象接口契约概要
7. 风险清单
8. OctoAgent 验证计划
9. 变更日志与维护指南
```

### 理由

1. 章节按"先全景、后细节、再风险与验证"的阅读心智模型组织
2. Feature 详情嵌入 Phase 分组中（而非独立平铺），强化层次感
3. 依赖关系独立成章（而非散布在各 Phase 中），便于专题查阅
4. 核心抽象放在 Feature 详情之后，因为需要先理解 Phase 0 的 Feature 上下文
5. 风险和验证计划放在末尾，因为它们是"元规划"性质，读者通常在理解全貌后查阅

### 替代方案

- **按使用场景分章**（浏览章、追踪章、验证章...）：同一 Feature 信息会分散到多个章节，读者需反复跳转。REJECTED。
- **Feature 平铺不分 Phase**：失去层次感和实施节奏，与 spec.md FR-001 的 Phase 划分要求矛盾。REJECTED。

---

## Decision 7: 工作量预估的呈现方式

### 问题

spec.md FR-003 要求"人天为单位，给出区间"。如何从 tech-research.md 的预估数据转换为蓝图格式？

### 结论

**直接采用 tech-research.md 的工作量预估**，以"人天"为单位展示区间（如"1-2 天"），并在 Phase 级别汇总总工作量区间。

### 理由

1. tech-research.md 第 9 节已按 Feature 给出预估工作量（天），数据来源可靠
2. 区间格式（如"1.5-2 天"）比单一数值更诚实地反映不确定性
3. Phase 级汇总帮助项目管理者评估整体资源需求
4. spec.md Clarifications 中确认"人天"为单位

### 替代方案

- **T-shirt sizing（S/M/L/XL）**：精度不足，无法支持排期。REJECTED。
- **故事点**：spec.md Clarifications 中已明确拒绝。REJECTED。
