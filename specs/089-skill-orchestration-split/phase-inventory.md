# 反向工程清单 —— Phase 定义清单

## Feature 模式（feature SKILL.md）

| Phase ID | Phase 名称 | 显示名称 | Agent | 条件表达式 | 跳过条件 | 是否关键 |
|---------|-----------|--------|-------|-----------|---------|---------|
| 0 | constitution_check | 项目宪法检查 | (内联快速检查) | 无 | 无 | false |
| 0.5 | research_mode_determination | 调研模式确定 | (编排器内联) | 无 | 无 | false |
| 1a | product_research | 产品调研 | product-research | research_mode in [full, product-only] | skip_if_exists: research/product-research.md | false |
| 1b | tech_research | 技术调研 | tech-research | research_mode in [full, tech-only, codebase-scan, custom] | skip_if_exists: research/tech-research.md | false |
| 1c | research_synthesis | 产研汇总 | (null) | research_mode in [full] | skip_if_exists: research/research-synthesis.md | false |
| 1d | online_research | 在线调研补充 | (编排器/context) | online_research_required == true | skip_if_exists: research/online-research.md | false |
| 2 | specify | 需求规范 | specify | 无 | skip_if_exists: spec.md | true |
| 3 | clarify_and_checklist | 需求澄清+质量检查 | [clarify, checklist] (并行DESIGN_PREP_GROUP) | 无 | skip_if_exists: spec.md (不跳过) | false |
| 3.5 | gate_design | 规范质量门禁 | (编排器执行) | mode == feature (硬门禁) | 无 | true |
| 4 | plan | 技术规划 | plan | 无 | skip_if_exists: plan.md | true |
| 5 | tasks | 任务分解 | tasks | 无 | skip_if_exists: tasks.md | true |
| 5.5 | analyze | 一致性分析 | analyze | 无 | skip_if_exists: (无) | false |
| 6 | implement | 代码实现 | implement | 无 | skip_if_exists: (无) | true |
| 6.5 | verify_independent | 编排器独立验证 | (编排器执行) | 无 | 无 | false |
| 7a | spec_review | Spec合规审查 | spec-review | 无 | skip_if_exists: (无) | false |
| 7b | quality_review | 代码质量审查 | quality-review | 无 | skip_if_exists: (无) | false |
| 7c | verify | 工具链验证+证据核查 | verify | 无 | skip_if_exists: verification/verification-report.md | true |

**并行组**：
- RESEARCH_GROUP: [1a (product_research), 1b (tech_research)] → 汇合点: 1c (research_synthesis)
- DESIGN_PREP_GROUP: [clarify, checklist] → 汇合点: GATE_DESIGN
- VERIFY_GROUP: [7a (spec_review), 7b (quality_review)] → 汇合点: 7c (verify)

**Gate 位置**：
- GATE_RESEARCH: 在 Phase 1d 后（调研阶段完成后）
- GATE_DESIGN: Phase 3.5 自身
- GATE_ANALYSIS: Phase 5.5（analyze 后）
- GATE_TASKS: Phase 5 后
- GATE_VERIFY: Phase 7c 后

---

## Story 模式（story SKILL.md）

[待扫描现有 story SKILL.md 以填充] 预期 5-7 个 Phase

---

## Implement 模式（implement SKILL.md）

| Phase ID | Phase 名称 | 显示名称 | Agent | 条件表达式 | 跳过条件 | 是否关键 |
|---------|-----------|--------|-------|-----------|---------|---------|
| 1 | clarify | 需求澄清 | clarify | 无 | skip_if_exists: spec.md | false |
| 2 | plan | 技术规划 | plan | 无 | skip_if_exists: plan.md | true |
| 3 | tasks | 任务分解 | tasks | 无 | skip_if_exists: tasks.md | true |
| 4 | analyze | 一致性分析 | analyze | 无 | skip_if_exists: (无) | false |
| 5 | implement | 代码实现 | implement | 无 | skip_if_exists: (无) | true |
| 6 | verify | 工具链验证 | verify | 无 | skip_if_exists: verification/verification-report.md | true |

**Gate**：GATE_DESIGN (Phase 1后), GATE_ANALYSIS (Phase 4后), GATE_IMPLEMENT_MID (Phase 5 中期), GATE_VERIFY (Phase 6后)

---

## Fix/Resume/Sync/Doc 模式

[待扫描各模式 SKILL.md 以填充] 每个模式预期 3-5 个 Phase

---

## 关键观察

1. **Feature 模式最复杂**：10-12 个主要 Phase + 3 个并行组 + 5 个 Gate
2. **并行调度**：3 处并行 (RESEARCH_GROUP, DESIGN_PREP_GROUP, VERIFY_GROUP)
3. **条件执行**：Phase 1a-1d 根据 research_mode 动态条件执行
4. **硬门禁**：GATE_DESIGN 在 feature 模式下始终 always，不可覆盖
5. **回退策略**：所有并行组支持降级到串行执行
6. **独立验证**：Phase 6.5 由编排器自己执行（不委派 Agent）

---

## 修改指南

新增 Phase 时需更新此清单，并对应更新 orchestration.yaml modes.{mode}.phases 数组。
新增 Gate 时需在 orchestration.yaml gates 块中定义，包括 applicable_modes 和 hard_gate_modes。

