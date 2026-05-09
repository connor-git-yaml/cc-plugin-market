---
feature: 157
title: "R-1 调研报告：self-dogfood sc008Rate 现状已达标，关闭 Feature 157"
branch: "157-fix-self-dogfood"
created: 2026-05-09
status: Final
spec: ./spec.md
plan: ./plan.md
tasks: ./tasks.md
---

# R-1 调研报告 — Feature 157

**调研结论**：**结论 D — 现状已达标**（Feature 152 报告的 32% 已通过 Feature 152 fix 阶段 + Feature 156 的间接修复演变为 96%）。Feature 157 关闭，不实施代码改动。

---

## 1. 调研摘要

| 维度 | Feature 152 ship 数字（2026-05-08） | Feature 157 R-1 实测（2026-05-09） | 变化 |
|------|----------------------------------|---------------------------------|------|
| self-dogfood `sc008Rate` | 32/100 = **32%** | **96/100 = 96%** | +64 pp ✅ |
| hono `sc008Rate` | 841/841 = 100% | 841/841 = **100%** | 持平 ✅ |
| 用户验收门槛 | ≥ 70% | 96%（**已达标 +26 pp**） | 已达成 ✅ |

> **测量复刻**：使用 Feature 152 ship 当时同款脚本 `scripts/verify-feature-152.mjs --target ./src --metric sc008` 重测，verify 脚本自 ship 后无任何修改（git log 确认）。
>
> **测量是否抖动**：`measureSc008` 是 deterministic 算法（Feature 152 verification §SC-008 已证明 N=3 无抖动），单次测量结果可信。

---

## 2. 事实演化时间线（git log 重建）

调研追溯了 Feature 152 ship 后到 Feature 157 启动前对 `src/knowledge-graph/import-resolver.ts` 和 `src/batch/batch-orchestrator.ts` 的修改：

| Commit | Feature | 关键变更 | 对 SC-008 的可能影响 |
|--------|---------|---------|--------------------|
| `5f39571` | 152 P6 | baseline 跑分 + verification-report.md（写入 32% 数字） | — 基线 |
| `0a8137d` | 152 fix | Codex final 对抗审查 4 CRITICAL + W-3 修复 | 修订 import-resolver C-1/C-2/C-3/C-4 — 可能修复部分 false-negative |
| `fe6ad3b` | 152 fix | Phase 5 quality-review CRITICAL + W-2 修复 | 修订 import-resolver — 可能修复部分 false-negative |
| `cf0a131` | **156** | Spectra Incremental Indexing + DependencyGraph T-014 Shim | **修改了 import-resolver.ts + batch-orchestrator.ts** — 极可能是 sc008Rate 大幅提升的主要驱动 |

**结论**：Feature 152 ship 后到 Feature 157 启动前，import-resolver / batch-orchestrator 受 3 个 commit 影响，其中 Feature 156 的"DependencyGraph T-014 Shim"改动最大。这些改动**间接完成**了 Feature 157 原定的核心修复（barrel re-export 链路追踪 / namedImports 拆条），使 sc008Rate 从 32% → 96%。

---

## 3. R-1-A 三视角 checklist（缩减版，N=4 而非 N=68）

由于现状仅剩 **4 条** false-negative（96/100 命中），原计划 N=68 的逐条三视角分析改为 N=4 简化版（决策建议**不深挖**，理由见 §5）：

| id | resolverView（推断） | 备注 |
|----|--------------------|------|
| fn-001 ~ fn-004 | 未深挖 | 决策建议关闭 Feature 157，不再 R-1 深挖剩余 4 条 |

> **不深挖的理由**：剩余 4 条 false-negative 占总 truth-set 的 4%，每条修复需要单测 + 边界设计，ROI 远低于 Feature 152/156 已交付的 64 pp 提升。该 4 条计入 follow-up Feature（如 Feature 158+）按需处理。

---

## 4. 与 Feature 152 verification-report.md 的事实对照

Feature 152 verification-report.md 第 96-110 行明确记录：

> ### SC-008 new Foo() → class Foo graph-level 连通率 ≥ 80%
> | target | sc008Hits | sc008Total | sc008Rate |
> | self-dogfood (./src) | 32 | 100 | **32%** ⚠️ |
> ...
> **处置决策**：
> - self-dogfood 32% 记入 `TD-7 SC-008 self-dogfood 测量改进`（follow-up，不阻塞合并）

**事实演化**：TD-7 在 Feature 152 ship 时被列为 follow-up，但 Feature 152 后续 fix 修订 + Feature 156 已**间接完成** TD-7 的实质修复目标（sc008Rate ≥ 70% 阈值）。Feature 157 不再需要为 TD-7 单独立项。

**建议 follow-up**（不强制，编排器建议但用户已选不执行）：
- 在 Feature 152 verification-report.md 末尾增补一行 update note：`> 2026-05-09 update：Feature 152 ship 后通过 0a8137d / fe6ad3b / cf0a131 (Feature 156) 的间接修复，self-dogfood sc008Rate 已演化为 96%（Feature 157 R-1 调研实测），TD-7 实质完成。`
- 用户已在 IMPLEMENT_AUTH gate 选择不执行此项（保留独立选择权），编排器尊重决定。

---

## 5. Scope-Change Decision

### 决策

**关闭 Feature 157**：不实施 W2-W4 任务，不修改源代码。本 Feature 的最终交付物是 4 份设计制品（spec/plan/tasks/research）作为完整 R-1 调研记录。

### 决策依据

1. **现状已达标**（96% ≥ 70% 目标 +26 pp），不存在需要修复的功能性缺口
2. **ROI 极低**：剩余 4 条 false-negative ≤ 4%，单条修复成本（设计 + 实施 + 单测 + verify）远高于该 4% 的工程价值
3. **历史复杂度**：本 Feature 在 Codex P0 复审中暴露的 4 CRITICAL + 5 WARNING（C-1 importedName 传递链 / C-2 namedImports 数据模型 / W-5 alias 零贡献）说明若强行实施，scope 必然扩大到 batch-orchestrator，破坏 Feature 152 的 surface area；且 Feature 156 已在不同视角下间接完成同等目标
4. **YAGNI 原则**（Constitution III）：当前 master 的活跃焦点在 panoramic + 增量索引，无下游消费方需要更高 sc008Rate

### 制品保留策略

| 制品 | 状态 | 用途 |
|------|------|------|
| spec.md | Draft → **Closed-NotImplemented** | 保留作为"曾经规划过的修复路径"参考 |
| plan.md | Draft → **Closed-NotImplemented** | 保留作为"如果未来要修剩余 4 条 false-negative，可以参考的技术方向" |
| tasks.md | Draft → **Closed-NotImplemented** | 保留 27 任务清单作为参考 |
| research.md | **Final** | 本文件，记录 R-1 调研事实发现 + scope-change decision |

### 不动的代码

- `src/knowledge-graph/import-resolver.ts` — 不改动
- `src/batch/batch-orchestrator.ts` — 不改动
- `tests/unit/knowledge-graph/import-resolver.test.ts` — 不改动
- `scripts/verify-feature-152.mjs` — 不改动
- `scripts/research-feature-157-r1.mjs` — **不创建**（W1 任务跳过）

---

## 6. 验证证据

### 6.1 重测命令 + 输出（self-dogfood）

```
$ npm run build  # OK
$ node scripts/verify-feature-152.mjs --target ./src --metric sc008
[verify-152] 发现 260 个 TS/JS 文件
=== SC-008 new Foo() → class Foo 连通率 ===
[verify-152] SC-008: 762 truth constructors，过滤后 100 条属于本仓库 class（61 classes）
[verify-152] SC-008: 96/100 constructor calls 连通 class 节点 (96.0%)
{
  "target": ".../src",
  "sc008Rate": 0.96,
  "sc008Hits": 96,
  "sc008Total": 100
}
```

### 6.2 重测命令 + 输出（hono — 无回归确认）

```
$ node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src --metric sc008
[verify-152] 发现 306 个 TS/JS 文件
=== SC-008 new Foo() → class Foo 连通率 ===
[verify-152] SC-008: 1840 truth constructors，过滤后 841 条属于本仓库 class（42 classes）
[verify-152] SC-008: 841/841 constructor calls 连通 class 节点 (100.0%)
{
  "target": "/Users/connorlu/.spectra-baselines/hono/src",
  "sc008Rate": 1,
  "sc008Hits": 841,
  "sc008Total": 841
}
```

### 6.3 一致性

- self-dogfood 96/100 vs Feature 152 ship 32/100：**+64 pp**（自 ship 至今的累积改进）
- hono 841/841 vs Feature 152 ship 841/841：**0 pp**（持平，无回归）
- 测量脚本未变化（git log 确认）→ 数字变化纯由代码改动驱动，非测量漂移

---

## 7. 后续建议（follow-up，不在本 Feature 范围）

如果未来某个 Feature 决定追求更高的 SC-008 准确率（如 ≥ 99%），可以参考：

1. **本 Feature spec/plan/tasks 已包含的设计**（barrel 链追踪 + namedImports 拆条 + alias 串联）— 但需要根据当时实际剩余 false-negative 数和分布重新评估 ROI
2. **Codex P0 复审的 11 条发现**（spec.md 12 条 + plan.md 11 条）— 这些设计陷阱在未来同类型 Feature 中仍会重现，避免重蹈覆辙
3. **Feature 156 的间接修复机制** — 值得反向 trace 它具体改了什么让 sc008Rate +64 pp，作为类似优化的参考

---

## 8. Codex 对抗审查累计

| Phase | CRITICAL | WARNING | INFO | 状态 |
|-------|----------|---------|------|------|
| Spec V1 | 3 | 7 | 2 | 全修 ✅ |
| Plan V1 | 4 | 5 | 2 | 全修 ✅ |
| **总计** | **7** | **12** | **4** | **全修** |

设计制品已通过 2 轮 Codex 对抗审查，质量上达到合并标准；但**因事实变化导致代码不需要实施**，Feature 整体以"Closed-NotImplemented"状态合并。

---

*由 Spec-Driver Story Phase 4 W1 R-1 调研生成；2026-05-09。*
