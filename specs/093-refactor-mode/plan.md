---
title: Feature 093 实现规划 - 大规模重构模式（spec-driver-refactor Skill）
feature_id: 093
version: 1.0
created: 2026-04-06
status: planning
---

# Feature 093 实现规划：大规模重构模式

## Summary

新增 `spec-driver-refactor` Skill，为 spec-driver 引入第 8 种编排模式，专门处理大规模代码重构场景。核心流程：影响分析 -> 分批规划 -> 逐批实现+中间验证 -> 全量残留扫描 -> 最终验证。

实现策略：**三阶段递进**，从配置层到 agent 层到编排器层逐层构建，每个阶段可独立验证。

## Technical Context

**Language/Version**: Markdown Prompt + YAML 配置 + MJS 辅助脚本
**Primary Dependencies**: orchestration.yaml（Phase 定义）、现有 implement/verify agent
**Storage**: 文件系统（specs/{feature_dir}/ 下的 Markdown 制品）
**Testing**: 手动 smoke test（调用 Skill 验证 Phase 序列）+ `npm run repo:check`
**Target Platform**: Claude Code 沙箱
**Constraints**: 零运行时依赖（Constitution 原则 X）；向后兼容（原则 XIII）
**Scale/Scope**: 新增 3 个文件，修改 2 个文件

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | SKILL.md、agent、文档全部中文散文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | PASS | 本 Feature 遵循 spec -> plan -> tasks -> implement 流程 |
| III. YAGNI | 适用 | PASS | 仅实现 spec 定义的 5 Phase + 核心参数，不引入额外抽象 |
| IV. 诚实标注不确定性 | 不适用 | N/A | 本 Feature 不涉及代码分析推断 |
| IX. Prompt 编排 + Harness 强制 | 适用 | PASS | 编排逻辑在 SKILL.md + orchestration.yaml，无运行时代码 |
| X. 零运行时依赖 | 适用 | PASS | 新增文件均为 Markdown/YAML，orchestrator-fallback.mjs 为已有辅助脚本 |
| XI. 质量门控不可绕过 | 适用 | PASS | refactor 模式含 GATE_TASKS + GATE_VERIFY 两个门禁 |
| XII. 验证铁律 | 适用 | PASS | Phase 5 (final_verify) 复用 verify agent 进行双重验证 |
| XIII. 向后兼容 | 适用 | PASS | orchestration.yaml 新增 modes.refactor 块，不影响现有 7 种模式 |
| XIV. 可观测性与架构守护 | 适用 | PASS | Phase 4 残留扫描即是架构守护机制的实现 |

**结论**：无 VIOLATION，计划可直接执行。

---

## 实现策略

### 三阶段划分

| 阶段 | 工作内容 | 关键产物 | 风险等级 |
|-----|--------|--------|--------|
| **阶段 1：配置与 Agent** | 激活 orchestration.yaml refactor 模式；创建 refactor-plan.md agent | orchestration.yaml 更新、refactor-plan.md、orchestrator-fallback.mjs 更新 | **低** |
| **阶段 2：SKILL.md 编排器** | 创建 spec-driver-refactor/SKILL.md，实现 5 Phase 编排循环 | SKILL.md 完整文件 | **中** |
| **阶段 3：验证与交付** | 全模式回归测试，确保向后兼容 | 验证报告 | **低** |

---

## 关键设计决策

### D1: orchestration.yaml 修改策略——原地替换注释化模板

**决策**：将文末注释化的 3 Phase 模板替换为 spec 定义的 5 Phase 正式配置。

**理由**：
- 注释化模板（reverse_spec -> refactor -> verify）是 Feature 089 预留的占位骨架
- spec.md 定义了完全不同的 5 Phase 序列（impact_analysis -> batch_planning -> batch_implement -> residual_scan -> final_verify）
- 直接替换注释块比保留旧模板更清晰

**替代方案（已否决）**：保留旧注释 + 在下方新增——增加了配置文件的认知负担。

### D2: refactor-plan.md agent 设计——单 agent 覆盖双阶段

**决策**：`refactor-plan.md` 同时服务于 Phase 1 (impact_analysis) 和 Phase 2 (batch_planning)，通过编排器传递 Phase 上下文区分行为。

**理由**：
- 影响分析和分批规划的输入输出构成连续链条（影响分析结果是分批规划的输入）
- 两个阶段共享代码库扫描、依赖图构建等核心能力
- 拆为两个 agent 会引入不必要的上下文切换开销

**替代方案（已否决）**：拆为 impact-analysis.md + batch-planning.md 两个独立 agent——违反 YAGNI 原则。

### D3: batch_loop agent_mode——编排器伪代码驱动

**决策**：`batch_loop` 在 SKILL.md 编排器中实现为对 refactor-plan.md 批次列表的迭代分发。编排器逐个 batch 调用 implement agent，每次调用后内联执行中间验证。

**理由**：
- 编排决策在 SKILL.md 层面实现，符合原则 IX
- 不需要在 orchestrator-fallback.mjs 中实现循环逻辑（fallback 只需线性 Phase 定义）
- implement agent 的 batch_loop 调用与 single 调用仅在上下文注入上有差异（batch scope vs full scope）

### D4: residual_scan Phase——编排器内联执行

**决策**：Phase 4 (residual_scan) 由编排器（SKILL.md）内联执行 `grep` 扫描，不派遣独立 agent。

**理由**：
- 残留扫描是纯机械操作（grep 旧名称/旧路径），不需要 LLM 推理
- 内联执行避免 agent 调用开销
- 与 orchestration.yaml 中 `agent: null, agent_mode: orchestrator_verify` 的定义一致

### D5: GATE 配置——复用 GATE_TASKS + GATE_VERIFY

**决策**：refactor 模式复用现有 GATE_TASKS 和 GATE_VERIFY，不新增 Gate。

**理由**：
- GATE_TASKS 用于批次规划完成后验证任务完整性
- GATE_VERIFY 用于最终验证阶段
- 中间验证（每批次后的类型检查）由编排器内联执行，不经过 Gate 系统
- 新增 Gate（如 GATE_BATCH_MID）违反 YAGNI——中间验证不需要用户配置的策略矩阵

---

## 架构概览

### Phase 序列流程

```
用户调用 /spec-driver:spec-driver-refactor --target <目标>
  │
  ├─ 参数解析 + 配置加载
  │
  ├─ Phase 1: impact_analysis
  │   └─ agent: refactor-plan → 输出 impact-report.md
  │
  ├─ Phase 2: batch_planning
  │   └─ agent: refactor-plan → 输出 refactor-plan.md
  │   └─ GATE_TASKS 检查
  │
  ├─ [--dry-run 在此终止]
  │
  ├─ Phase 3: batch_implement (batch_loop)
  │   ├─ Batch 1 → implement agent → 中间验证
  │   ├─ Batch 2 → implement agent → 中间验证
  │   └─ Batch N → implement agent → 中间验证
  │
  ├─ Phase 4: residual_scan
  │   └─ 编排器内联 grep 全仓库
  │
  └─ Phase 5: final_verify
      └─ agent: verify → npm run repo:check + 类型检查
      └─ GATE_VERIFY 检查
```

### 文件变更矩阵

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md` | **新建** | refactor 模式编排器入口（~300-400 行） |
| `plugins/spec-driver/agents/refactor-plan.md` | **新建** | 影响分析 + 分批规划 agent（~200 行） |
| `plugins/spec-driver/config/orchestration.yaml` | **修改** | 激活 refactor 模式（替换注释化模板，~40 行） |
| `plugins/spec-driver/lib/orchestrator-fallback.mjs` | **修改** | 添加 refactor 模式 fallback 定义（~15 行） |

### 产物结构（运行时生成）

```text
specs/{feature_dir}/
├── impact-report.md      # Phase 1 输出：影响分析报告
├── refactor-plan.md       # Phase 2 输出：分批重构计划
└── verification/
    └── verification-report.md  # Phase 5 输出：最终验证报告
```

---

## 风险分析

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| orchestration.yaml 修改导致现有模式回归 | 中 | 仅在 modes 块末尾新增 refactor 条目，不修改现有 7 种模式定义；阶段 3 全模式回归验证 |
| batch_loop 编排逻辑复杂度 | 中 | 在 SKILL.md 中使用清晰的伪代码结构；中间验证失败时暂停（不自动重试） |
| refactor-plan agent 的影响分析准确性 | 中 | agent prompt 中明确扫描策略（grep + import 分析）；首次使用建议 `--dry-run` 验证 |
| SKILL.md 行数超限（NFR-001: 500 行） | 低 | 编排循环逻辑精简；影响分析和分批规划逻辑下沉到 agent |

---

## 依赖关系

### 前置依赖

- **Feature 089（SKILL.md 编排拆分）**: 已完成。本 Feature 依赖 orchestration.yaml 的 modes 定义机制和 Phase 序列框架
- **现有 implement agent**: 直接复用，不做修改
- **现有 verify agent**: 直接复用，不做修改

### 无外部依赖

本 Feature 不引入任何新的 npm 包、外部 API 或运行时依赖。

---

## Complexity Tracking

> 无 Constitution Check 违规，无需复杂度偏差论证。

| 决策 | 复杂度选择 | 更简单的替代方案 | 为何不采用 |
|------|-----------|----------------|-----------|
| 单 agent 覆盖双 Phase | 简单 | （当前已是最简方案） | — |
| batch_loop 在 SKILL.md 实现 | 中等 | 不支持分批，一次性全量修改 | 全量修改违背 spec 核心需求（FR-005: 逐批实现 + 中间验证） |
| 编排器内联 residual_scan | 简单 | 新建 residual-scan.md agent | 纯 grep 操作不需要 LLM，新建 agent 违反 YAGNI |
