---
feature: 158
title: SWE-Bench Lite Grounding Eval — 跨制品一致性分析
phase: analyze
created: 2026-05-09
status: PASS-WITH-WARNING
---

# Feature 158 — Cross-Artifact Consistency Analysis

## 1. 总评

**状态**：⚠️ PASS WITH WARNING（0 CRITICAL / 4 HIGH / 6 MEDIUM / 3 LOW）

- **FR 覆盖率**：7/7 = 100%
- **SC 覆盖率**：8/8 = 100%
- **孤立任务**：0
- **宪法违规**：0
- **Pass G 跨 Feature 文件冲突**：CLEAN（与 F151-156 无路径重叠）
- **是否阻断 implement**：**否**

## 2. FR ↔ SC ↔ Task 三角对齐矩阵

| FR | 对应 SC | 对应 Tasks | 完整性 |
|----|---------|-----------|---------|
| FR-001 Task Fixture（4-6 个） | SC-001 | T-003、T-004a~e | ✅ |
| FR-002 MCP Pull 接入 | SC-003、SC-004 | T-001、T-002、T-002b、T-006、T-007 | ✅（T-002b 是附录新增 fallback） |
| FR-003 三对照组并行 | SC-002、SC-003 | T-005、T-008、T-009、T-010 | ✅ |
| FR-004 N=3 + Bootstrap CI | SC-004、SC-007 | T-008/T-009/T-010、T-012 | ✅（CR-1 已修订 API） |
| FR-005 Tool Call Trace | SC-004 | T-006、T-007、T-010 | ✅ |
| FR-006 §6 报告 | SC-005、SC-006 | T-013 | ✅（人工撰写） |
| FR-007 verify 脚本 | SC-008 | T-014a、T-014b | ✅（WR-6 拆分） |

## 3. Codex 4 轮审查处置闭环

| 轮次 | 对象 | 关键发现 | 处置位置 | 残余风险 |
|------|------|---------|---------|---------|
| Round 1 | research | 3 critical / 6 warning | spec/plan 已传承 | 无 |
| Round 2 | spec.md | 8 critical / 8 warning | spec 全量修订；plan 传承完整 | 无 |
| Round 3 | plan.md | 7 critical / 8 warning | plan 全量修订；tasks 传承完整 | 无 |
| Round 4 | tasks.md | 6 critical / 6 warning / 5 info | tasks-codex-revisions.md 附录（implement 硬约束） | **HIGH**：tasks.md 主体未同步覆写，implement 阶段须严格以附录为准 |

## 4. 不一致问题清单

| ID | 严重性 | 位置 | 摘要 | 处置 |
|----|--------|------|------|------|
| F-001 | HIGH | clarification.md PL-001 | 残留 "90 次" 数字（但乘积运算 3×6×3 写对了，实为 54） | 确认以 tasks.md 头部 "54 runs" 为准（clarification 是历史文档） |
| F-002 | HIGH | tasks.md T-012 vs 附录 CR-1 | tasks.md 仍写 `bootstrapCI`，附录已修订为 `bootstrapPercentileCi`；返回字段不同 | implement 严格以附录 CR-1 为准（API 错调将导致 T-012 运行时报错） |
| F-003 | HIGH | tasks.md T-007 vs 附录 WR-4 | tasks.md 写 `.test.mjs`，附录修订为 `.test.ts` | implement 以附录 WR-4 为准（路径错会让 vitest 找不到测试） |
| F-004 | HIGH | tasks.md T-008 DoD vs 附录 CR-6 | tasks.md DoD 写 `perf.wallTimeMs`，实测仓库现状 `perf.totalWallMs` | implement T-008/T-009/T-010 以附录 CR-6 字段名为准 |
| F-005 | MEDIUM | spec SC-008 vs plan §6 SC-008 | spec "8 行 [SC-00N]"，plan "7 条 stdout" | 以 spec 8 行为准（SC-001 到 SC-008） |
| F-006 | MEDIUM | spec FR-005 schema 示例 vs 附录 CR-6 | spec 字段示例为顶层，附录确认 `perf.mcpToolCallTrace` + `perf.w3Flag` | implement 以附录 CR-6 定义为准（perf 子对象） |
| F-007 | MEDIUM | tasks.md 头部 17 vs 附录末表 18 | T-014 拆 a/b 后总数 18，tasks.md 头部计数过时 | 以附录末表 18 为准 |
| F-008 | MEDIUM | tasks.md vs plan §3 任务编号体系 | plan T1-T9 vs tasks T-001~T-016 是两套编号 | implement 按 tasks.md 主体编号执行 |
| F-009 | MEDIUM | spec FR-004 lift 阈值 30pp vs W-1 缓解 5pp | 两套判定标准并列 | T-013 §6 报告中明确"5pp+CI下界>0 为显著判定" |
| F-010 | LOW | plan §2 路径 vs spec NFR-003 cohort 变量 | 路径模板 vs 具体名 | plan §1 cohort 映射表是 canonical |
| F-011 | LOW | constitution §VIII 对齐 | Node-only PASS；YAGNI PASS | 无操作 |
| F-012 | LOW | T-014 a/b 拆分依赖 | T-014b 依赖 T-013，关键路径明确 | 无操作 |

## 5. 宪法检查

| 原则 | 状态 |
|------|------|
| I. 双语文档规范 | ✅ 中文散文 + 英文标识符 |
| II. Spec-Driven Development | ✅ 流程完整 |
| III. YAGNI | ✅ 复杂度 LOW（3 组件） |
| VIII. 纯 Node.js | ✅ 不引入 Python/Docker |
| XII. 验证铁律 | ✅ verify-feature-158.mjs SC-001~008 |
| XIII. 向后兼容 | ✅ schema 1.2 新字段可 null |

**宪法违规：0**

## 6. 阻断性问题

**0 CRITICAL → 不阻断 implement。**

4 HIGH 问题（F-001 ~ F-004）均不阻断，但 implementer 必须**先通读** [`tasks-codex-revisions.md`](tasks-codex-revisions.md) 附录，特别关注：
- **CR-1**（bootstrap API：bootstrapPercentileCi，不是 bootstrapCI）
- **CR-2**（fixture loader 路径扩展到 specs/157）
- **CR-6**（perf 字段名：perf.totalWallMs / taskExecution.costUsd / perf.mcpToolCallTrace + perf.w3Flag）
- **WR-4**（单测 .ts 路径，不是 .mjs）

## 7. GATE_ANALYSIS 决策

GATE_ANALYSIS 配置为 `default_behavior: on_failure`（spec-driver orchestration.yaml）。本次 analyze 无 CRITICAL 失败信号，**Gate 自动 AUTO_CONTINUE**。

**进入 Phase 6：implement。**
