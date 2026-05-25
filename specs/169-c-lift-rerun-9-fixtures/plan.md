# Implementation Plan: F169 — Cohort C lift 复现验证

**Feature**: 169
**Spec**: [spec.md](./spec.md)
**Created**: 2026-05-25
**Mode**: spec-driver-story（5 阶段轻量交付）

---

## 0. Design Overview

F169 是数据补强 + 报告更新型 feature，**不修改产品代码**。整体设计 3 个交付点：

1. **`scripts/f169-c-lift-rerun.sh`** — wrapper script，循环 6 fixture × 2 cohort = 12 batch 调用 `eval-mcp-augmented.mjs`，每 batch repeat=3 → 36 runs。负责全局累计成本/wall stop-loss + fixture-level 早停 + 配额信息日志
2. **`scripts/verify-feature-169.mjs`** — 按 verify-feature-15x.mjs pattern 实现：读 F169 manifest + 解析 36 run-N.json + 计算 cohort × fixture aggregate + 输出 verdict（强/弱/反信号）+ 检查 SC-001 数据完整性
3. **`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`** — 新增 §10.5.1.10 章节 + 更新 §10.4 + 更新 §1 Executive Summary

---

## 1. 复用决策矩阵（YAGNI）

| 现有 infra | 复用 / 改造 / 新增 | 理由 |
|---|---|---|
| `scripts/eval-mcp-augmented.mjs` 主流程 | **复用，不动** | F167 ship 后已 stable，主流程改动 = 引入回归风险 |
| `scripts/t052-full-batch.sh` wrapper pattern | **fork 出 f169-c-lift-rerun.sh** | 借 t052 的 env / log / progress 形态；但 F169 需要 wrapper 层全局累计 stop-loss（t052 是 per-batch） |
| `scripts/verify-feature-15x.mjs` 系列 pattern | **复用模式，新增 verify-feature-169.mjs** | argv 解析 + JSON output + exit code 约定 |
| Cohort A/C prompt template (`buildGroupAPrompt` / `buildGroupCPrompt`) | **复用，不动** | F164 ship 后 stable，改动 = 与 §10.5.1.9 数据不可比 |
| Judge jury 配置 (F162 Phase B) | **复用，不动** | 评分稳定性已确认 |
| Run record schema (`tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`) | **复用** | F169 verify 用同 schema 解析，不引入新格式 |
| `tests/baseline/swe-bench-lite/fixtures/SWE-L*.json` (10 fixtures) | **复用** | 6 个 F169 目标 fixture (L004, L006-L010) 全部已存在 |

**不引入**：
- 新 npm package
- 新 cohort 类型
- 新 MCP tool
- 新 telemetry 字段
- src/ 任何源码修改

---

## 2. wrapper script 设计：`scripts/f169-c-lift-rerun.sh`

### 2.1 CLI 接口

```bash
# 默认配置：6 fixture × 2 cohort × N=3 = 36 runs
bash scripts/f169-c-lift-rerun.sh

# 可选环境变量覆盖（CI / 调试）
SPECTRA_F169_LOG_DIR=/tmp/spectra-f169        # 默认 /tmp/spectra-f169
SPECTRA_F169_STOP_LOSS_USD=20                 # 默认 20，全局累计
SPECTRA_F169_STOP_LOSS_WALL_MIN=270           # 默认 270 min（4.5h）
SPECTRA_F169_FIXTURE_EARLY_STOP_N=2           # 默认 2 (fixture-level)
SPECTRA_F169_QUOTA_CHECK_EVERY=6              # 默认每 6 runs 输出配额信息
```

### 2.2 跑批循环结构

```text
FIXTURES = [SWE-L004, SWE-L006, SWE-L007, SWE-L008, SWE-L009, SWE-L010]
COHORTS  = [A, C]
REPEAT   = 3

manifest = {feature: "F169", start_ts: <epoch>, fixtures: FIXTURES, cohorts: COHORTS, repeat: REPEAT}
write manifest → $LOG_DIR/manifest.json

global_cost_usd_total = 0
fixture_c_consec_fail = {}   # {fixture: count}

for fixture in FIXTURES:
  for cohort in COHORTS:
    # fixture-level 早停检查（仅对 C cohort 生效；语义：上游 fixture C batch 已确认系统性 grounding 失败）
    if cohort == "C" and SKIP_REMAINING_C:
      log "[stop-loss-3 cascaded] skip $fixture cohort C (systemic grounding failure detected earlier)"
      continue

    batch_log = $LOG_DIR/<fixture>-<cohort>.log
    log "[$batch_idx/12] group=$cohort task=$fixture repeat=$REPEAT"

    node scripts/eval-mcp-augmented.mjs \
      --group $cohort \
      --task $fixture \
      --repeat $REPEAT \
      --stop-loss 10 \           # 单 batch 防护下沿
      > $batch_log 2>&1
    batch_exit=$?

    # 解析 batch 实付：读最新的 tests/baseline/swe-bench-lite/runs/$cohort/$fixture/run-*.json
    # 字段为 costUsd（不是 totalCostUsd，stdout summary 是 "cost=$..." 格式不稳定，必须从 JSON 解析）
    batch_cost = sum_cost_from_run_jsons(cohort, fixture)
    global_cost_usd_total += batch_cost

    # stop-loss 3（重新定义）：F169 wrapper 每 fixture 仅一次 C batch（N=3 atomic），
    # 不能 mid-batch kill；唯一可做的是检测"系统性 grounding 失败"后跳过剩余 fixture 的 C cohort
    if cohort == "C":
      # 解析本 batch 3 个 run-*.json：
      #   "全 graph-not-built" = 3/3 runs 的 graphInjection.errorCode != null
      #   "全 SIGTERM/timeout"  = 3/3 runs 的 claudeTimedOut == true
      systemic_grounding_fail = all_3_runs_failed_with_graph_or_timeout(cohort, fixture)
      if systemic_grounding_fail:
        log "[stop-loss-3] $fixture cohort C 全 N=3 graph-not-built/SIGTERM — 推断系统性问题，跳过剩余 fixture 的 C batch"
        write $LOG_DIR/stop-loss-triggered.txt with cause="systemic-grounding-fail"
        SKIP_REMAINING_C = true   # 用于后续 fixture 循环的 cohort C 分支

    # global stop-loss
    if global_cost_usd_total > $SPECTRA_F169_STOP_LOSS_USD:
      log "[stop-loss-1] global cost $${global_cost_usd_total} > \$$SPECTRA_F169_STOP_LOSS_USD — abort remaining"
      write $LOG_DIR/stop-loss-triggered.txt with cause
      break 2  # exit both loops

    elapsed_min = (now - start_ts) / 60
    if elapsed_min > $SPECTRA_F169_STOP_LOSS_WALL_MIN:
      log "[stop-loss-2] wall $${elapsed_min}min > $SPECTRA_F169_STOP_LOSS_WALL_MIN — abort remaining"
      write $LOG_DIR/stop-loss-triggered.txt with cause
      break 2

    # 每 6 runs 配额信息日志（不阻断）
    if $batch_idx * $REPEAT % $SPECTRA_F169_QUOTA_CHECK_EVERY == 0:
      log "[quota] ChatGPT Pro Max 20x usage — check https://chat.openai.com/usage (manual)"

write final summary → $LOG_DIR/final-summary.json
  { runs_attempted, runs_finalized, runs_skipped_by_stop_loss, global_cost_usd, wall_min }
```

### 2.3 Exit code 约定

- `0`: 36/36 完成 success
- `0`: stop-loss 触发但 partial 数据 ≥ 4 fixture（不算 fail，verify 仍跑）
- `1`: 启动前置检查失败（fixture 不存在、cwd 错误、dist 缺失）
- `2`: stop-loss 触发且 partial 数据 < 4 fixture（verify 仍跑但 verdict 可能 SKIP）

### 2.4 失败处理分类（plan-level contract）

| 失败类型 | wrapper 行为 | 是否计入 partial |
|---|---|---|
| eval-mcp-augmented.mjs 单 batch nonzero exit（infra failure） | log warning + continue 下一 batch | 该 batch runs 标 anomaly，不计 lift |
| 单 run graph-not-built / SIGTERM | 由 eval 主流程 record 到 run-*.json status | 计入 partial，verify 解析 |
| stop-loss 1/2/3 触发 | 立即停 + 写 stop-loss-triggered.txt | 完成 runs 计入 partial |
| dist/cli/index.js 缺失 | wrapper 启动前检查 + 立即 exit 1 + 提示 `npm run build` | N/A |

---

## 3. verify script 设计：`scripts/verify-feature-169.mjs`

### 3.1 CLI 接口

```bash
node scripts/verify-feature-169.mjs \
  --manifest /tmp/spectra-f169/manifest.json \
  --runs-dir tests/baseline/swe-bench-lite/runs \
  [--report-out /tmp/f169-verify-report.json]
```

### 3.2 Verification 步骤

```text
1. 读 manifest → 知道 expected (fixtures, cohorts, repeat)
2. 扫描 runs-dir 对应 cohort/fixture/run-N.json
3. 对每个 run 解析：
   - status (success / failedFinalized / partialStale)
   - oraclePass (boolean)
   - mcpToolCallCount (number, cohort C only)
   - costUsd, wallMs
4. SC-001 数据完整性检查：
   - expected = len(fixtures) * len(cohorts) * repeat = 36
   - finalize_success / expected == 1.0 → PASS（无 stop-loss）
   - finalize_success / expected < 1.0 → 检查 stop-loss-triggered.txt
     - 存在 → PASS with caveat (n=X/36 stop-loss <ID>)
     - 不存在 → FAIL（数据缺口非预期）
5. SC-001 mcpToolCallCount 检查（仅 cohort C runs）：
   - 任一 cohort C run 的 mcpToolCallCount == 0 → 标 anomaly
   - anomaly count > 0 → 输出 warning 但不阻断 verdict
6. SC-002 lift verdict 计算：
   - per_fixture_a = aggregate pass rate per fixture for cohort A
   - per_fixture_c = aggregate pass rate per fixture for cohort C
   - count_c_gt_a = sum(1 for f in fixtures if per_fixture_c[f] > per_fixture_a[f])
   - aggregate_a = sum(passes_a) / sum(total_a)
   - aggregate_c = sum(passes_c) / sum(total_c)
   - if count_c_gt_a >= 3 → verdict = "strong"
   - elif aggregate_c >= aggregate_a → verdict = "weak"
   - elif sum(1 for f if per_fixture_c[f] < per_fixture_a[f]) >= 4 → verdict = "negative"
   - else → verdict = "ambiguous"

   **N=3 离散值 caveat（必须随 verdict 输出）**：每 cell n=3 → per_fixture pass rate ∈ {0, 1/3, 2/3, 1}；`count_c_gt_a` 在 LLM 随机方差 ±1 pass 下可整票漂移。verdict report 必须额外输出：
   - per-fixture C vs A 整数差值 (例如 +1, -1, 0 表示 pass 数差)
   - aggregate n=18 vs 18 下 95% CI 半宽估算（参考 §10.5.1.9 n=43 都不构成 significance，n=18 更宽）
   - 显式 disclaimer："verdict 是 directional 启发式分类，不代表 statistical significance"
7. 写 JSON report:
   {
     "feature": "F169",
     "sc_001": { "pass": bool, "details": {...} },
     "sc_002": { "verdict": "strong|weak|negative|ambiguous", "matrix": {...}, "aggregate": {...} },
     "anomalies": [{...}],
     "stop_loss": null | { "id": 1|2|3, "trigger_value": ... },
     "timestamp": "<iso>"
   }
8. Exit code:
   - 0: SC-001 + SC-002 全 pass（含 partial 豁免）
   - 1: SC-001 数据完整性 fail（非 stop-loss 原因）
   - 0 + verdict=ambiguous: 输出 caveat，由人工决策（不阻断）
```

### 3.3 partial 数据下的 verdict 规则

- 完成 fixture 子集 ≥ 4 → verdict 按已完成 fixture 算（SC-002 满足）
- 完成 fixture 子集 < 4 → verdict = SKIP，输出 "partial 数据不足以判定 lift"

---

## 4. 报告更新策略

### 4.1 §10.5.1.10 插入点

**精确位置**：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 第 1298 行附近，即 §10.5.1.9 末尾 "**Follow-up Features 建议**" 列表之后、`---` 分隔符之前。新增章节标题：

```markdown
##### 10.5.1.10 F169 6-fixture C-lift 复现验证（2026-05-25）
```

**不改动**：§10.5.1.6-10.5.1.9 任何原文 + §10.5.5 跑批失败统计章节（保持 freeze）。

### 4.2 §10.5.1.10 内容结构

```markdown
##### 10.5.1.10 F169 6-fixture C-lift 复现验证（2026-05-25）

**背景**：§10.5.1.9 数据集中在 L001-L003 + L005 共 4/10 fixture，外部容易质疑 C 100% pass 是 L003/L005 cherry-pick outlier。F169 在剩余 6 个 fixture (L004 + L006-L010) 跑 cohort A/C × N=3 = 36 runs，独立验证 C lift 复现性。

**真实成本与时长**（实测填入）:
| 维度 | F169 预算 | 实测 |
|------|--------|------|
| LLM token cost | ~$86 | $X |
| 实付 (SiliconFlow GLM+Kimi) | $5-10 | $X |
| Wall time | ~3.6h | X min |
| Runs finalized | 36/36 | X/36 |

**Cohort × Fixture × Oracle Pass Rate**（6 新 fixture，n=3 per cell）：
| Fixture | Cohort A | Cohort C | C > A? |
|---|---|---|---|
| SWE-L004 | X/3 | X/3 | ✓/✗ |
| SWE-L006 | X/3 | X/3 | ✓/✗ |
| SWE-L007 | X/3 | X/3 | ✓/✗ |
| SWE-L008 | X/3 | X/3 | ✓/✗ |
| SWE-L009 | X/3 | X/3 | ✓/✗ |
| SWE-L010 | X/3 | X/3 | ✓/✗ |
| **6-fixture aggregate** | X/18 | X/18 | — |

**与 §10.5.1.9 合并 aggregate**（10/10 fixture 覆盖，避免双重计数）：
| Scope | Cohort A | Cohort B | Cohort C |
|---|---|---|---|
| §10.5.1.9 (L001/L002/L003/L005, n=107) | 4/43 (9%) | 1/33 (3%) | 6/31 (19%) |
| §10.5.1.10 (L004/L006-L010, n=36) | X/18 | — (F169 不跑) | X/18 |
| **10/10 fixture 合并** | (4+X)/(43+18) | 1/33 (unchanged) | (6+X)/(31+18) |

> ⚠️ **合并口径声明**：本合并只对 cohort A 和 C 做（B 在 §10.5.1.9 已稳定结论）；L003/L005 数据不重复计入新 6 fixture aggregate，仅在"10/10 合并"行参与。

**SC-002 Verdict**：[strong | weak | negative | ambiguous]（由 `scripts/verify-feature-169.mjs` 实算）

**核心结论**：[根据 verdict 实测填入]
1. **复现性**：L003/L005 的 100% C-pass 在 6 新 fixture 上 [复现 / 部分复现 / 未复现]
2. **lift 量化**：10/10 fixture aggregate C/A = X.X×（vs §10.5.1.9 partial 2.1×）
3. **统计 caveat**：n=143 仍不足以做 95% CI 推断，结论维持 **directional signal**

**stop-loss 触发记录**（如有）：
- 触发 ID: [1=cost / 2=wall / 3=fixture-early]
- 触发时点: [n=X/36 完成]
- 实际影响: [partial 数据范围]
```

### 4.3 §10.4 修订（最小 diff）

仅在 §10.4 "战略结论" 段尾追加一小段（不删旧文）:

```markdown
**F169 数据补强后修订（2026-05-25）**：§10.4 上方表格基于 Pilot 27 (n=27) + T052 partial (n=107)，未含 F169 的 6 fixture × A/C × N=3 = 36 新 runs（详见 §10.5.1.10）。F169 完成 10/10 fixture 覆盖后，cohort C 整体 pass rate 修订为 X% (n=49)，vs A X% (n=61)，C/A = X.X×（directional signal）。L003/L005 100% pass 信号在 6 新 fixture [复现 / 部分复现 / 未复现] — [简短 4-5 行结论]
```

### 4.4 §1 Executive Summary 修订（scope-bounded，不 over-claim）

**位置**：§1.1 "Spectra 类" 表格之后、§1.2 之前新增一小段。**不删除** Sprint 3 关于 micrograd grounding=0 的旧叙事，明确两者实验对象不同。

```markdown
### 1.1.1 SWE-Bench-Lite cohort C lift directional signal（Feature 162 → 169，2026-05-25）

**Scope**：本结论仅适用于 SWE-Bench-Lite Python 真实 issue (pytest/astropy/sympy 三 repo, 10 fixture)，与 §1.1 Sprint 3 micrograd-scale 单函数 task 的 grounding=0 结论 **共存且实验对象不同**（前者真实代码漂移情境，后者设计严格 fixture 上的天花板效应）。

**核心 directional signal**（10/10 fixture, n=143, 由 verify 实算）:
- Cohort C (MCP-pull grounding): X% pass rate
- Cohort A (bare baseline): X% pass rate
- C/A = X.X× directional lift（**仅 directional signal，非 statistical significance** — n=143 + per-cell n=3-15 不足以做 95% CI 推断）
- L003/L005 的 100% C-pass 信号在 6 新 fixture (L004/L006-L010) [复现 / 部分复现 / 未复现]
- L001/L002 boundary 全 fail（任务复杂度超 claude-opus-4-7 上限，留给 F168）

**对 §1.1 grounding 叙事的影响**：本结论 **不替代** Sprint 3 在 micrograd-scale 简单 task 上 grounding=0 的结论（实验对象不同 — micrograd 是单函数补全 / SWE-Bench-Lite 是真实 issue 修复）。**两者方向不冲突**：micrograd 上 task 简单到不需要 grounding（control 100% PASS 天花板效应），SWE-Bench-Lite 上 task 复杂到 grounding 能贡献 directional lift。spec.md 的 grounding 价值在 **真实代码漂移 + multi-file caller graph 依赖的中等复杂度任务** 上首次得到实证。
```

---

## 5. Codex 阶段性对抗审查计划

按 CLAUDE.local.md 约定 + 用户确认每 phase 都跑：

| Phase | Codex Review 重点 |
|---|---|
| spec.md (已跑) | 5 CRITICAL 全修（详见 spec 修订记录） |
| plan.md (本 phase 结束后) | stop-loss 阈值是否合理 / §10.5.1.10 合并是否避免双重计数 / wrapper 失败处理是否完整 |
| tasks.md (生成后) | 任务分解可测性 / 依赖关系 |
| implement (跑批 + 报告更新后) | scripts 是否引入回归 / §1 修订是否 over-claim / §10.5.1.10 数据合并算式 |
| verify (verify 完成后) | 全部 SC 是否真实达成 |

---

## 6. 执行环境前置（implement startup checks）

```bash
# 1. cwd 切换到主仓 root（重要 — worktree 不能跑实际 batch）
cd /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/

# 2. 重新 fetch master 确认 ≥ 2e0f2d2
git fetch origin master:master
git log -1 --oneline master  # 期望 ≥ 2e0f2d2

# 3. dist 检查
ls -la dist/cli/index.js  # 若 missing 或比 src 旧 → npm run build (~5min)

# 4. .env.local 加载
source .env.local  # 确认 SILICONFLOW_API_KEY 已 set

# 5. vitest 基线确认
npx vitest run --reporter=basic  # 期望 3708 passing

# 6. fixture 文件存在性
for f in SWE-L004 SWE-L006 SWE-L007 SWE-L008 SWE-L009 SWE-L010; do
  ls tests/baseline/swe-bench-lite/fixtures/${f}-*.json || exit 1
done

# 7. claude CLI auth 验证
claude --print "say ok"  # 期望返回 ok
```

---

## 7. 验收与门禁

### Phase 4 完成 = (FR-001 ~ FR-014) + (SC-001 ~ SC-004) 全部 pass

- 36/36 runs finalize success（含 partial 豁免）
- §10.5.1.10 + §10.4 + §1 修订完成
- scripts/f169-c-lift-rerun.sh + scripts/verify-feature-169.mjs 存在并可执行
- vitest + build + repo:check + release:check 零回归

### Phase 5 verify = SC-005 Codex 全 phase critical 清零

---

## 8. 风险与 mitigation

| 风险 | mitigation |
|---|---|
| 跑批中途断电 / SSH 断开 | wrapper 写 manifest + 每 batch flush log，重启可基于 eval-mcp-augmented.mjs `--accept-partial` resume |
| SiliconFlow API rate limit | jury 配置已含 retry；stop-loss 1 ($20) 保护 |
| 报告 markdown 误改 freeze 章节 | §10.5.1.10 插入点严格在 §10.5.1.9 末尾 + §10.5.5 之前；只 Edit 受限段 |
| §1 修订过宽影响其他章节 | 只新增 §1.1.1 子节，不修改 §1.1 / §1.2 表格 |
| F169 跑批与 §10.5.1.9 数据不可比 | F169 复用 F164/F167 ship 后的 prompt template + judge config，不变更 |
| verify 算 verdict 时 partial 数据 ambiguous | 输出 caveat 不阻断，人工决策（写入 §10.5.1.10）|
