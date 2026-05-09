# Feature 158 — Analysis Report (一致性分析)

**Phase**: analyze（在 implement 之前）
**Date**: 2026-05-09
**输入**: spec.md / plan.md / tasks.md / clarification.md / quality-checklist.md
**总体一致性评分**: WARN（0 CRITICAL / 3 HIGH / 6 MEDIUM / 4 LOW）

---

## 执行摘要

三件套（spec / plan / tasks）在**核心架构决策、覆盖率、依赖 DAG** 层面高度一致：
- FR 覆盖率 24/24（100%）
- SC 覆盖率 9/9（100%）
- EC 覆盖率 14/14（100%）
- CRITICAL = 0

WARN 原因主要在 quality-checklist 与 plan/tasks 的局部偏差（CHECK-23 / CHECK-18 命名漂移），以及 T-044 worktree 隔离 EC-11 的验收项不完整。

---

## 关键发现表

| ID | 严重性 | 摘要 | 修复策略 |
|----|--------|------|---------|
| F-001 | HIGH | quality-checklist CHECK-23 命令 `grep loadSpectraContext` 与 plan/tasks 自实现 `loadSpectraContextForSweBench` 不一致 | **修复**：改 CHECK-23 grep 关键字为 `loadSpectraContextForSweBench` |
| F-002 | HIGH | T-051 检查点 ⑥ 依赖 T-054（§6 章节已添加）；T-054 必须先于 T-051 | DAG 已正确，无需修改，仅记录 |
| F-003 | HIGH | T-046 / T-060 已加 T-031 依赖（codex 修复后）；现状一致 | 已修复（前一轮 codex tasks review）|
| F-004 | MEDIUM | T-044 缺 EC-11 worktree 唯一性验收项 | **修复**：在 T-044 加 worktree 路径唯一性验收 |
| F-005 | MEDIUM | T-041 缺 `loadSpectraContextForSweBench` 实测返回非 null 验收 | **修复**：在 T-041 acceptance 加返回值检查 |
| F-006 | MEDIUM | quality-checklist CHECK-18 标题用旧名 `full.json`（M-8 后已废） | **修复**：CHECK-18 标题改为 `run-<N>.json` |
| F-007 | MEDIUM | T-031 acceptance 未检查 plan §阈值校准节占位符已被填充 | **修复**：T-031 加占位符 audit |
| F-008 | MEDIUM | EC-13 build cache check 仅在 T-044 实现，verify 脚本无直接 grep 覆盖 | 接受现状（dry-run 间接验证已足够）|
| F-009 | LOW | tasks.md frontmatter 任务总数标 27，正文实际 28 (含 T-014) | **修复**：frontmatter 同步为 28 |
| F-010 | LOW | spec FR-B-001 import 清单仍含 `loadSpectraContext`，与 plan 决定不 import 字面有偏差 | **修复**：FR-B-001 加注 plan 阶段精化决定 |
| F-011 | LOW | spec FR-F-002 verify 边界遗漏 SC-008（M-11 应用时漏掉，但 plan 正确认为可自动） | 接受现状（plan 正确，verify 设计无问题）|
| F-012 | LOW | constitution 原则 VIII（npm only）vs Python 转换脚本 — plan 标"条件通过"已明确豁免 | 已记录，无需修改 |

---

## FR / SC / EC 覆盖统计

### FR 覆盖
- **24/24（100%）** 全部 FR 在 plan 有对应章节、在 tasks 有任务 ID

### SC 覆盖
- **9/9（100%）** SC-001/002/003/005/007/008/009a 由 verify 脚本自动覆盖；SC-004/006/009b 标 post-eval 人工确认（边界已明确）

### EC 覆盖
- **14/14（100%）** EC-1~EC-14 全部在 plan 风险登记册 + 至少 1 个 task 处理；EC-11 处理略浅（F-004）

---

## 关键决策 Trace（spec → plan → tasks）

| 决策 | 一致性 |
|------|-------|
| Telemetry 方案 A（侵入式 hook）| ✅ |
| ast-diff 60% 阈值 + 9 场景校准 | ✅（占位符是设计意图）|
| Group B 自实现 `loadSpectraContextForSweBench` | ⚠️ spec 字面偏差（F-010）但实质一致 |
| Stage 7a pilot 拆分 | ✅ |
| run 文件名 `run-<N>.json` | ✅（CHECK-18 残留 F-006）|
| P5 循环依赖解决（T-005 smoke + T-014 端到端）| ✅ |

---

## 跨 Feature 冲突检测

Feature 158 修改 `src/mcp/agent-context-tools.ts`（Feature 155 已 ship 文件，加 telemetry hook）。
- Feature 155：上游依赖（已 ship 到 master），非并行竞争
- Feature 156：无冲突（不触及 mcp/）

**结论**: CLEAN — 无并行 Feature 冲突。

---

## 处置建议

### 必修（HIGH/MEDIUM 中合理 ≤30 min 工时的）
1. quality-checklist CHECK-23 修 grep 关键字
2. quality-checklist CHECK-18 修标题
3. T-044 加 worktree 唯一性验收
4. T-041 加 `loadSpectraContextForSweBench` 返回值验收
5. T-031 加 plan 占位符 audit 验收
6. tasks.md frontmatter 任务计数同步
7. spec FR-B-001 加 plan 精化注记

### 接受现状
- F-002 / F-008 / F-011 / F-012：DAG 或 plan 已处理，无功能性影响

完成后整体一致性评分应升至 PASS（无 HIGH，仅 LOW info）。
