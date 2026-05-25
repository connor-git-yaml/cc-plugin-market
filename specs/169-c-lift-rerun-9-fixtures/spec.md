# Feature Specification: F169 — Cohort C lift 复现验证（扩到 10/10 fixture）

> **fixture 计数口径澄清**：当前 §10.5.1.9 实测 4/10 fixture 有 cohort C 数据（L001 partial 10 runs + L002 + L003 + L005）；F169 补齐剩余 6 fixture (L004 + L006-L010) → **F169 完成后 10/10 fixture 全部见过 cohort C 数据**。Brief 原描述 "9/10" 是计数误差，本 spec 以此处口径为准。L001/L002 boundary 全 fail 状态不变（留给 F168），但"C cohort 是否真在多 fixture 上 lift" 的问题在 6 个新 fixture 上独立验证。

**Feature Branch**: `claude/blissful-tu-a743cd`（worktree 内开发）
**Created**: 2026-05-25
**Status**: Draft
**Mode**: spec-driver-story（5 阶段轻量交付，不改产品代码）
**Predecessor**: Feature 167 + §10.5.1.9 T052 partial 107 runs（master HEAD `2e0f2d2`）
**Input**: 扩展 SWE-Bench-Lite cohort C lift 数据到 9/10 fixture，验证 L003/L005 的 C 100% pass rate 不是 cherry-pick outlier

---

## 0. 背景与定位

Feature 167 ship 后，用户授权启动 T052 全量 450（10 fixture × 3 cohort × N=15），跑了 107 runs 后用户决策停在 4/10 fixture（详见报告 §10.5.1.9，2026-05-25）。核心 lift signal **已确认方向**：

- Cohort C **19%** pass vs A **9%** / B **3%**（C/A = 2.1×，C/B = 6.3×）
- L003/L005 上 C **100% pass**，L001/L002 全 fail（任务复杂度边界，留给 F168）

但当前数据 **sample size 不均衡** + **fixture 覆盖不足**，外部容易质疑 cherry-pick：

| 现状 | 问题 |
|------|------|
| L003-B n=2 / L005-A/B n=1 | sample 太小，CI 宽 |
| L004 + L006-L010 = 6 fixture 缺 cohort C 数据 | 6/10 fixture 未见过 C |
| 仅 4/10 fixture 见过 cohort C | "C lift 复现性"未独立验证 |

**F169 定位**：发布报告 publish 前的最小数据补强 — 6 个未覆盖 fixture × {A, C} × N=3 = 36 runs，验证 C lift 在更多 fixture 上是否复现。不修改任何产品代码，只新增 2 个脚本 + 更新 1 份报告。

---

## 1. User Scenarios & Testing

### User Story 1 — 6 个未覆盖 fixture 补 C cohort 数据（Priority: P1）

作为对外发布报告的负责人，我需要在 L004 + L006-L010 这 6 个未覆盖 fixture 上跑 cohort A/C × N=3，确认 "Cohort C 19% > A 9%" 这个核心 lift signal 不是因为只在 L003/L005 跑而 cherry-pick 出来的伪结论。

**Why this priority**: 当前 §10.5.1.9 给的 C/A = 2.1× lift 是基于 4/10 fixture 的数据。如果只在 L003/L005 这两个"简单"fixture 上 C 拿到 100%、其他 fixture C 全 fail，那 "C lift 复现" 的对外宣称就站不住。这是 publish-grade 报告的硬前置。

**Independent Test**: 可以独立通过：(a) 跑 36 runs，(b) 填 §10.5.1.10 矩阵，(c) 计算 6 新 fixture 的 aggregate pass rate，验证 directional / aggregate / 反向 三档结论。不需要触及 L001/L002 boundary（F168）或 T052 全量 450（DEFER）。

**Acceptance Scenarios**:

1. **Given** 36 runs 全部 finalize success，**When** 计算 6 新 fixture 的 aggregate pass rate by cohort，**Then** 矩阵填入 §10.5.1.10 并给出 C vs A 的 directional / aggregate 判定（强/弱/反信号三档）
2. **Given** stop-loss 任一档触发，**When** 落 partial 数据，**Then** §10.5.1.10 标注 "n=X/36 due to stop-loss"，verify 不算 fail，验证流程继续
3. **Given** 每个 cohort C run，**When** 解析 telemetry，**Then** `mcpToolCallCount > 0`（不能倒退到 F164 之前 mcpCalls=0）

---

### User Story 2 — §1 Executive Summary 顶层 lift signal 修订（Priority: P1）

作为报告读者，第一屏（§1 Executive Summary）应该看到"Spectra MCP grounding 真实有 lift"这个核心结论，而不是被 Sprint 3 时点的 "grounding=0" 旧叙事误导。

**Why this priority**: §1 当前 stale 于 Sprint 3（2026-05-01），还停留在 "spectra-control mean delta = 0" 的描述；而 §10.5.1.9 + §10.5.1.10 已经在 SWE-Bench-Lite 真实任务上确认 Cohort C 有 lift。第一屏不更新会直接降低 publish 价值。

**Independent Test**: 可独立通过：基于 9/10 fixture 数据修订 §1 一段话 + §10.4 战略结论一段话，diff 可逐字检查。

**Acceptance Scenarios**:

1. **Given** SC-002 verdict 为"强信号"或"弱信号"，**When** 更新 §1，**Then** §1 包含 "C/A = X.X×（基于 10/10 fixture, 总 n=Y 由 verify 脚本实算）"+ "L003/L005 的 100% C-pass 信号在 6 个新 fixture 中 [复现 / 部分复现 / 未复现]" + "SWE-Bench-Lite scope 内 lift 与 Sprint 3 micrograd scope grounding=0 并存（实验对象不同）"
2. **Given** SC-002 verdict 为"反信号"，**When** 更新 §1，**Then** §1 明确写 "L003/L005 是 outlier，C lift 在更多 fixture 不稳定"，§10.4 同步修订
3. **Given** 任何 verdict，**When** 写 §1 + §10.4，**Then** 不 over-claim 统计显著性，措辞限定为 "directional signal"（实际 n 由 verify 脚本计算实算 — 例如 9/10 fixture 完全跑完场景下 n ≈ 107 (§10.5.1.9) + 36 (F169) = 143，但具体值不硬编码在 spec/§1，必须由 verify 实算）

---

### User Story 3 — 三道 stop-loss 配额管控防失控（Priority: P2）

作为 driver，我需要 36 runs 在已知的 cost / wall / fixture-level 失败 risk 内运行；任一红线触发要自动停 + 落 partial 数据，**不暂停问用户**（按 brief 决策）。

**Why this priority**: F167 的教训是 T052 跑了 107 runs 才发现 cost/wall 偏差 +28% / +160%。F169 必须前置三道止损线，避免再次"跑到一半失控"。

**Independent Test**: 可独立通过：检查 `scripts/f169-c-lift-rerun.sh` 含 3 道 stop-loss 配置 + 每 6 runs 一次 quota check + verify 在 partial 数据上仍能给 verdict。

**Acceptance Scenarios**:

1. **Given** SiliconFlow 累计实付 > $20，**When** stop-loss 1 触发，**Then** 中止剩余 runs + 落 partial 数据 + 标记原因，verify 继续
2. **Given** 总 wall 超 4.5h，**When** stop-loss 2 触发，**Then** 同上
3. **Given** 某 fixture cohort C 连续 2 run 返 graph-not-built / SIGTERM，**When** stop-loss 3 触发，**Then** 暂停该 fixture 后续 C run（fixture-level 早停，其他 fixture 不受影响）
4. **Given** 每 6 runs 检查 ChatGPT Pro Max 20x usage，**When** 周配额 ≥ 60%，**Then** 输出警告（不阻断，brief 说"询问是否继续"由编排器执行）

---

### Edge Cases

- **EC-001 双重计数风险**: §10.5.1.10 写矩阵时是否把 §10.5.1.9 已存在的 L003-A/B/C, L005-A/B/C 数据再算一遍？必须明确边界：§10.5.1.10 只写 "6 新 fixture" + 与 L003/L005 老数据合并的 aggregate 必须显式标注覆盖范围
- **EC-002 partial 数据下 SC-002 判定**: 若仅完成 4/6 fixture（其中 2 个被 stop-loss 3 跳过），仍可算 SC-002 满足（brief 明确 "≥ 4 个 fixture 已能直接覆盖 cherry-pick 质疑"）
- **EC-003 worktree vs 主仓 root cwd 边界**: 主仓 root 有 fresh dist + .env.local；worktree 无。Implement phase 必须在主仓 root 跑 36 runs，spec/plan/tasks 制品仍在 worktree 写入 + commit
- **EC-004 fixture 数据格式漂移**: 现有 fixture run-*.json schema 由 §10.5 多代 feature 沉淀；F169 verify 必须用与 §10.5.1.9 一致的解析逻辑（不能新写 parser）
- **EC-005 mcpToolCallCount 倒退检测**: F164 修过 buildGroupCPrompt 让 `mcpToolCallCount > 0`；F169 跑批必须验证仍生效，单 cohort C run 若 `mcpToolCallCount == 0` 须标为 anomaly（字段名以 `eval-mcp-augmented.mjs` 实际 emit 的 `mcpToolCallCount` 为准，不引入新别名）
- **EC-006 §1 修订 over-claim 风险**: 当前 §1 + §10.4 在 grounding 上的措辞都很谨慎（"directional signal 而非 statistical significance"）；F169 修订必须保持这种谨慎，不能因 n 翻倍就升级为"显著"
- **EC-007 报告其他章节漂移**: §10.5.1.10 + §1 + §10.4 修订时不能影响 §0 / §2 / §10.5.1.6-10.5.1.9 已 freeze 的其他章节内容（仅插入 / 修改受限段落）

---

## 2. Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 6 个 fixture (`SWE-L004-sympy-bug-with-milli-prefix`, `SWE-L006-astropy-please-support-header-rows`, `SWE-L007-sympy-collect-factor-and-dimension`, `SWE-L008-sympy-bug-in-expand-of`, `SWE-L009-sympy-cannot-parse-greek-characters`, `SWE-L010-sympy-si-collect-factor-and`) × 2 cohort (`A`, `C`) × N=3 = 36 runs 上跑完。每 run 由 `eval-mcp-augmented.mjs` 写入既有路径 `tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`（不新建路径约定，复用 §10.5 历代 feature 的 run record schema）。F169 自身仅在 `/tmp/spectra-f169/` 或环境变量指定目录写 batch log + manifest（标识本次跑批属于 F169，方便 verify 脚本筛选 36 runs 子集）
- **FR-001a**: F169 选 N=3（而非 §10.5.1.9 follow-up 原建议 cohort C × N=5）的取舍：N=3 + 双 cohort (A+C) 同口径对照能直接给 "C vs A pass rate" lift 信号；N=5 仅 cohort C 则缺 A 同 fixture 对照，无法独立判断 lift 是否因 fixture 难度而非 grounding 模式导致
- **FR-002**: 系统 MUST **不跑** cohort B（spec-push）、**不跑** L001/L002（boundary fixture）、**不重跑** L003/L005（已有 100% pass）、**不跑** T052 剩余 343 runs
- **FR-003**: 系统 MUST 提供 `scripts/f169-c-lift-rerun.sh` wrapper script，封装 fixture / cohort / repeat / stop-loss 配置，调用 `scripts/eval-mcp-augmented.mjs` 主流程（**不动主流程**）
- **FR-004**: 系统 MUST 提供 `scripts/verify-feature-169.mjs`，按 `scripts/verify-feature-15x.mjs` pattern 实现：(a) 解析 36 runs telemetry，(b) 验证 SC-001 全 finalize + mcpCalls > 0，(c) 计算 cohort × fixture aggregate pass rate，(d) 输出 verdict（强/弱/反信号）
- **FR-005**: 系统 MUST 在 `f169-c-lift-rerun.sh` wrapper 层面累计跨 batch 总成本（基于 SiliconFlow 实付估算 + 每 batch eval-mcp-augmented.mjs stdout 解析）配置三道 stop-loss：(1) 全局累计实付 > $20、(2) 总 wall > 4.5h、(3) 单 fixture cohort C × N=2 全 graph-not-built/SIGTERM（fixture-level 早停，不停其他 fixture）。`eval-mcp-augmented.mjs --stop-loss <USD>` 参数仅作单 batch 防护下沿（如 $10），不替代 wrapper 层的全局累计逻辑。任一触发自动中止剩余 runs + 落 partial 数据（不暂停用户、不交互询问）
- **FR-006**: 系统 MUST 每 6 runs 输出 ChatGPT Pro Max 20x 配额信息日志（仅输出 + 不交互阻断；不问 "是否继续"）
- **FR-007**: 系统 MUST 在 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 新增 §10.5.1.10 章节，包含 6 新 fixture × {A, C} × N=3 实测矩阵 + aggregate（含 L003/L005 既有数据合并，显式标注覆盖范围避免双重计数）
- **FR-008**: 系统 MUST 更新报告 §10.4 战略结论：基于 9/10 fixture 数据修订 C lift 量化判断（不 over-claim 显著性）
- **FR-009**: 系统 MUST 更新报告 §1 Executive Summary：**在 SWE-Bench-Lite scope 范围内**新增一段，引用 §10.5.1.9 + §10.5.1.10 的 cohort C lift directional signal（C/A 倍率 + 10/10 fixture 覆盖结论 + L003/L005 信号是否在新 fixture 复现）。**禁止覆盖或删除** Sprint 3 在 micrograd / 简单 single-turn 任务上 grounding=0 的旧结论（两者实验对象不同：本结论 = SWE-Bench-Lite 真实 issue，Sprint 3 = micrograd-scale 单函数 task）。措辞必须显式标注 scope 边界，避免 over-claim
- **FR-010**: 系统 MUST 在 cohort C run 中验证 `mcpToolCallCount > 0`（不能倒退到 F164 mcpCalls=0 状态），单 run mcpCalls=0 标为 anomaly 不计入 lift 统计
- **FR-011**: 系统 MUST **不修改** `scripts/eval-mcp-augmented.mjs` 主流程、cohort A/C prompt template (F164 ship)、judge jury 配置 (F162 Phase B)、src/ 任何源码
- **FR-012**: 系统 MUST **不引入** 新源码依赖、新 npm package、新 cohort 类型；只新增 2 个 scripts/ 文件 + 修改 1 份 report markdown
- **FR-013**: stop-loss 触发的 partial 数据 MUST 写入 §10.5.1.10 并明确标注 "n=X/36 due to stop-loss <ID>"；完成的 fixture 子集 ≥ 4 个仍可算 SC-002 满足
- **FR-014**: 系统 MUST 在 implement 完成后跑：`npx vitest run`（基线 3708 pass）+ `npm run build` + `npm run repo:check` + `npm run release:check`，确认零回归

### Key Entities

- **Fixture**: SWE-Bench-Lite task fixture，由 `tests/baseline/swe-bench-lite/fixtures/` 维护；F169 涉及 6 个未覆盖 fixture（L004 + L006-L010）
- **Cohort**: 评估对照组；A=bare、B=spec-push、C=mcp-pull（grounding via spectra MCP server）。F169 只跑 A + C
- **Run record**: `tests/baseline/tasks/<feature>/<fixture>/<cohort>/run-N.json`，含 oraclePass / mcpToolCallCount / cost / wall / status 等字段
- **Stop-loss**: 三档止损配置：cost ($20) / wall (4.5h) / fixture-level early-stop (N=2 连 fail)
- **Aggregate**: cohort × fixture 维度的 pass rate 聚合，§10.5.1.10 矩阵的核心数据结构
- **Verdict**: SC-002 判定结果，三档：强信号 (≥3 fixture C>A) / 弱信号 (aggregate C≥A) / 反信号 (≥4 fixture C<A)

---

## 3. Success Criteria

### SC-001 数据完整性

- ✅ 36/36 runs finalize success（`partialStale = 0` / `failedFinalized = 0`）
- ✅ 每个 cohort C run 的 `mcpToolCallCount > 0`（防 F164 倒退）
- ✅ §10.5.1.10 章节填入 6 个新 fixture × cohort A/C × N=3 完整矩阵

> **stop-loss 豁免**: 任一 stop-loss 触发后落 partial，SC-001 改判为 "n=X/36 + 标注 stop-loss 原因"，不算 fail。

### SC-002 C lift 复现验证

验收阈值（任一满足即可）：

- **强信号** ⭐: 6 个新 fixture 中 ≥ 3 个 fixture C > A pass rate（directional lift confirmed）
- **弱信号**: 6 个新 fixture 中 aggregate C ≥ A pass rate（C 整体 ≥ A，即使个别 fixture C < A）
- **反信号**: 6 个新 fixture 中 ≥ 4 个 fixture C < A → §10.5.1.10 写 "L003/L005 是 outlier，C lift 在更多 fixture 不稳定" + 修订 §1 顶层结论

> **partial 豁免**: 完成的 fixture 子集 ≥ 4 个仍可算 SC-002 满足（brief 决策）。

### SC-003 报告 publishability

- ✅ 新增 §10.5.1.10 章节，含 6 新 fixture × A/C 实测 + aggregate update（含 L003/L005 既有数据合并，**显式标注覆盖范围避免双重计数**）
- ✅ 更新 §10.4 战略结论：基于 9/10 fixture 数据修订 C lift 量化判断
- ✅ 更新 §1 Executive Summary：把 "C/A = X.X×" 等核心 lift signal 写入顶层（当前 §1 stale 于 Sprint 3，不含 §10.5.1.9 + 10.5.1.10 新数据）
- ✅ 修订不 over-claim 统计显著性（保持 "directional signal" 而非 "significant"）

### SC-004 不回归

- ✅ `npx vitest run` 3708 pass（基线）零回归
- ✅ `npm run build` 零错误
- ✅ `npm run repo:check` + `npm run release:check` pass
- ✅ 不引入新源码依赖（仅新增 `scripts/f169-c-lift-rerun.sh` + `scripts/verify-feature-169.mjs`）
- ✅ `scripts/eval-mcp-augmented.mjs` / src/ / cohort prompt template / judge config **零修改**

### SC-005 Codex 阶段性对抗审查

- ✅ 5 个 phase（spec / plan / tasks / implement / verify）每个 phase commit 前跑 `codex:codex-rescue` 对抗审查，critical 清零
- ✅ 重点审查 §10.5.1.10 数据合并逻辑（避免 §10.5.1.9 + 10.5.1.10 双重计数）
- ✅ 重点审查 §1 Executive Summary 修订是否准确反映核心 lift signal（不 over-claim）

---

## 4. Out of Scope（明确分割）

| 项 | 留给哪个 Feature |
|---|---|
| L001/L002 boundary 研究（升 driver / 加 timeout / 改 fixture） | **F168** |
| T052 剩余 343 runs 全量补齐 | **DEFER**（§10.5.1.9 用户决策）|
| 升级 driver 模型到 opus-5 / GPT-5.5 | **F168+** |
| 新增 cohort 类型（D = constitution-push 等）或新 MCP tool | **DEFER** |
| 跨 baseline 对比（Aider / Graphify / GitNexus）| 已 ship 在 §3，F169 不动 |
| Publish-grade 对外报告 PDF/HTML 输出 | follow-up（§1 + §10 内部 markdown 已 publishable）|
| L003/L005 重扩到 N=5+ | 不必（100% pass directional signal 已达成）|
| Cohort B 数据补强 | 不必（§10.5.1.9 已确认稳定低 3% baseline）|

---

## 5. 预算与硬约束（订阅模式实测）

| 项 | 估算 | 硬上限 |
|---|---|---|
| LLM token 总成本（非实付）| 36 runs × $2.40 = ~$86 | — |
| 实付 — driver (codex:gpt-5.5) | $0（ChatGPT Pro 订阅边际）| — |
| 实付 — judge 1 (claude-opus-4-7) | $0（Claude Max 订阅边际）| — |
| 实付 — judge 2/3 (GLM + Kimi via SiliconFlow) | ~$5-10 | **$20**（stop-loss 1）|
| 合计实付 | ~$5-10 | $20 |
| Wall time | ~3.6h（单机串行）| **4.5h**（stop-loss 2）|
| ChatGPT Pro Max 20x 配额 | ~10% weekly | 60% 警告 |
| 工程时间 | ~0.5 天 | — |

---

## 6. 启动前置条件（已 verify 2026-05-25）

### 环境凭据（订阅模式）

- ✅ `SILICONFLOW_API_KEY` 已配主仓 `.env.local`
- ✅ Claude Max OAuth 已登录
- ✅ ChatGPT Pro OAuth 已登录（`~/.codex/auth.json` 存在）

### 仓库就绪（implement phase 启动前必须再次 verify，不依赖 spec 撰写时的快照）

- master HEAD ≥ `2e0f2d2`（implement 启动前 `git fetch origin master:master` 重新确认）
- 主仓 `dist/cli/index.js` 存在且 mtime ≥ src 最新 mtime（若 stale 须 `npm run build` 一次性 ~5min）
- 全套 vitest run pass count 与基线一致（基线 = 3708）

> ⚠️ 上述条目**不是 spec freeze 时的事实声明**，而是 implement startup checks；verify report 必须记录实际检查结果（含 mtime / pass count 等具体数值）

### 执行环境

- ✅ Implement phase 必须在 **主仓 root** (`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/`) 跑 36 runs（用户确认）
- ✅ spec/plan/tasks/verify 制品在 worktree 写入 + commit

---

## 7. Stop-loss 触发后的处置原则

按 brief 决策（用户已确认 "触发即停 + 自动落 partial 数据 + 继续 verify"）：

1. 不算 Feature fail
2. 落 partial 数据到 §10.5.1.10（标注 "n=X/36 due to stop-loss <ID>"）
3. §10.4 战略结论按 partial 数据修订（可能弱化 lift 量化但保留 directional signal）
4. 完成的 fixture 子集 ≥ 4 个仍算 SC-002 满足
5. **不暂停问用户**（与 brief default 一致）

---

## 8. 完成后 deliverable report 必含字段（CLAUDE.local.md 约定）

push 到 origin master 前必列：

1. **Commit hash + 一句话 summary**（每个 phase 一行）
2. **改动统计**（new/modified file 数 + 行数 +X / -Y）
3. **关键 finding / signal 总结**：36/36 runs 状态分布（含每个 stop-loss 触发原因如有）+ §10.5.1.10 矩阵 + SC-002 verdict（强/弱/反）
4. **Codex 对抗审查结论**（5 个 phase × CRITICAL / WARNING / INFO 各 N 项，全修复 / 修了几条）
5. **Verify 结果**（vitest pass count / npm build / repo:check / release:check）
6. **rebase + 冲突解决状态**（已 rebase 到最新 master，无 / 有冲突已解）
7. **下一步建议**：F168 优先级 / 是否需 T052 全量重新 budget / §1 修订 diff (before/after) + 真实 cost (SiliconFlow 实付) / wall / quota 实测 vs 预算
