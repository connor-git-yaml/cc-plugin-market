# 快速上手: 033-panoramic-doc-blueprint

**Feature Branch**: `033-panoramic-doc-blueprint`
**Date**: 2026-03-18

---

## 本 Feature 做什么

生成一份结构化的 Milestone 蓝图文档（`blueprint.md`），完整规划 Reverse Spec 和 Spec Driver 的全景文档化能力。蓝图覆盖 17 个后续 Feature（034-050），划分为 4 个 Phase，包含依赖关系、验证标准、风险清单和 OctoAgent 验证计划。

---

## 交付物

| 制品 | 位置 | 说明 |
|------|------|------|
| blueprint.md | `specs/033-panoramic-doc-blueprint/blueprint.md` | 唯一交付物，单一 Markdown 文件 |

---

## 实施步骤

### Step 1: 理解输入

阅读以下前序制品，建立上下文理解：

1. **spec.md** — 需求规范，包含 6 个 User Story 和 21 条 Functional Requirements
2. **research/tech-research.md** — 技术调研报告，包含 14 项改进方向的可行性分析、架构方案、依赖关系图
3. **plan.md** — 技术规划（本文件的同级制品），包含文档结构设计和 Constitution Check

### Step 2: 按章节生成 blueprint.md

按照 `contracts/blueprint-structure.md` 定义的章节结构，依次填充内容：

1. **第 1 章 概览与目标** — 从 spec.md 的用户场景提取全景文档化的愿景和目标
2. **第 2 章 编号映射表** — 从 data-model.md 的编号映射直接引用
3. **第 3 章 MVP 范围定义** — 从 spec.md FR-004/FR-005 提取，说明选择理由
4. **第 4 章 Phase 分解与 Feature 详情** — 核心章节，17 个 Feature 卡片
   - 信息来源：tech-research.md 第 5 节（可行性分析）+ 第 9 节（详细分解）
   - 格式：按 `contracts/blueprint-structure.md` 的 Feature 卡片标准格式
   - 验证标准：从 tech-research.md 的交付物和验证价值推导
5. **第 5 章 依赖关系** — Mermaid 图从 tech-research.md 第 5.3 节转换（F-xxx → 034-050 编号）
6. **第 6 章 核心抽象接口契约概要** — 从 tech-research.md 第 2.4 节提取，降级为自然语言 + 方法列表
7. **第 7 章 风险清单** — 从 tech-research.md 第 7 节转换，补充关联 Feature/Phase
8. **第 8 章 OctoAgent 验证计划** — 从 tech-research.md 第 6 节推导，按 Phase 组织
9. **第 9 章 变更日志与维护指南** — 从 spec.md FR-020 和 Edge Cases 提取

### Step 3: 自检

完成 blueprint.md 后，逐条验证 spec.md 的 21 条 Functional Requirements：

- [ ] FR-001~FR-003: Phase 划分和 Feature 信息完整性
- [ ] FR-004~FR-005: MVP 范围标注
- [ ] FR-006~FR-009: 依赖关系完整性
- [ ] FR-010~FR-011: 验证标准质量
- [ ] FR-012~FR-014: 核心抽象契约
- [ ] FR-015~FR-016: 风险清单
- [ ] FR-017~FR-018: OctoAgent 验证计划
- [ ] FR-019~FR-021: 文档格式

---

## 关键信息来源映射

| blueprint.md 章节 | 主要信息来源 | 辅助信息来源 |
|-------------------|-------------|-------------|
| 概览与目标 | spec.md (User Story 1) | - |
| 编号映射表 | data-model.md | tech-research.md 5.2 |
| MVP 范围定义 | spec.md (FR-004/005) | tech-research.md 10 |
| Phase 0 Feature 详情 | tech-research.md 9 (Phase 0) | tech-research.md 2.4 |
| Phase 1 Feature 详情 | tech-research.md 9 (Phase 1) | tech-research.md 5.1 |
| Phase 2 Feature 详情 | tech-research.md 9 (Phase 2) | tech-research.md 5.1 |
| Phase 3 Feature 详情 | tech-research.md 9 (Phase 3) | tech-research.md 5.1 |
| 依赖关系图 | tech-research.md 5.3 | spec.md (FR-006~009) |
| 核心抽象契约 | tech-research.md 2.4 | spec.md (FR-012~014) |
| 风险清单 | tech-research.md 7 | spec.md (FR-015~016) |
| OctoAgent 验证计划 | tech-research.md 6 | spec.md (FR-017~018) |
| 变更日志 | spec.md (FR-020, Edge Cases) | - |

---

## 常见错误避免

1. **不要在正文中使用调研编号（F-000~F-016）** — specs 编号（034-050）是唯一主标识符
2. **不要包含完整 TypeScript 类型定义** — 核心抽象章节只需方法名 + 一句话描述
3. **不要遗漏 Phase 3 的"实验性"标注** — FR-021 明确要求
4. **不要让验证标准过于模糊** — 每条必须描述可观测的预期结果，能转化为 Given-When-Then
5. **不要引入 spec.md 未定义的 Feature** — 严格限定在 034-050 的 17 个 Feature
