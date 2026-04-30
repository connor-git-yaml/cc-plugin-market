# Feature 143 — Tasks

**Input**: [spec.md](./spec.md) + [plan.md](./plan.md)  
**Branch**: `feature/143-large-project-e2e-baseline`  
**Date**: 2026-04-30

> **Implement 阶段用户决策**：把 baseline 升级为"持久 perf bench platform"。Q1=C 放弃 spec §2.1 硬性 500+ 要求，最终选定 **3 项目 × spectra × full mode**（micrograd / nanoGPT / self-dogfood）。Q2=A workspace 持久化在 `~/.spectra-baselines/`。Q3=A 多 tool 架构（spectra 完整 + 竞品 stub 接口）。Phase 0/3/4 已完成；Phase 1 Wave 1（Continue / khoj 大项目）废弃，改成本 Feature 实跑 3 个固定 baseline。

---

## 任务编号约定

- `T<phase>.<seq>`：Phase 内顺序号（如 `T0.1`、`T1.3`）
- `[P]`：可与同 phase 其他 `[P]` 任务并行执行（仅文件编辑层面，**不**并行执行 spectra batch 命令）
- 每个 phase 独立 commit，commit message 末尾标 `[Phase N/4]`

---

## Phase 0：Infrastructure skeleton（约 1-2 小时）

**目标**：collector / diff / 单测 / 文档骨架全部到位，micrograd 端到端验证 collector 工作。**禁止标 SC-002 / SC-003 PASS**（产物只有空骨架）。

### T0.1 [P] 创建 baseline-collect 脚本

- 文件：`scripts/baseline-collect.mjs`
- 入口：`node scripts/baseline-collect.mjs --target <path-or-name> --mode <full|reading|code-only> [--commit <hash>] [--verify-artifacts]`
- 必含函数：
  - `parseTargetFiles(targetDir)` → `targetFileCountsByType / targetLocEstimate`
  - `runDryRun(targetDir, mode)` → `dryRun.estimatedTokens`
  - `runBatchAndCapture(targetDir, mode, env)` → `{ totalWallMs, stdoutLog, stderrLog, exitCode, memoryPeakKb? }`
    - 内部使用 `/usr/bin/time -l`（macOS）或 `/usr/bin/time -v`（Linux），不可用则 memoryPeakKb=null
  - `parseLlmCalls(stdoutLog)` → `llmCallCount, llmCallDurationsMs`（regex 提 `[LLM] start ... end ... took Xms`，具体正则在实现时根据现有 stdout 格式调整）
  - `parsePhases(stdoutLog)` → `phases.*`（依据 batch-orchestrator 已有的 phase 边界日志关键字）
  - `parseCostSummary(outputDir)` → `tokensInput / tokensOutput / tokensCacheRead / estimatedCostUsd`
  - `parseGraph(outputDir)` → `graphNodeCount / graphEdgeCount / graphHyperedgeCount / graphSizeBytes`
  - `parseBatchSummary(outputDir)` → `specModuleCount / specSuccessCount / specSkippedCount / specFailedCount`
  - `assembleFixture(...)` → 完整 schema 1.0 JSON
  - `verifyArtifacts()` → 实现 SC-001 验证（plan §10.2）
- 不依赖任何 npm 包（只用 `node:*` 内置）

### T0.2 [P] 创建 baseline-diff 脚本

- 文件：`scripts/baseline-diff.mjs`
- 入口：`node scripts/baseline-diff.mjs <old.json> <new.json> [--mode regression|reproducibility] [--ignore-quality] [--format json|text]`
- 必含函数：
  - `loadFixture(path)` → 验 schemaVersion + 返回 object
  - `compareDimensions(old, new, thresholds)` → `[{ field, oldValue, newValue, deltaPct, severity }]`
  - `REPRODUCIBILITY_THRESHOLDS` / `REGRESSION_THRESHOLDS`（plan §5.4 数值）
  - `formatJson(diff)` / `formatText(diff)`（人可读着色版）
  - 退出码：0=PASS（含黄色警告），1=FAIL（红色），2=schemaVersion mismatch

### T0.3 [P] 注册 npm scripts

- 文件：`package.json`
- 新增 `"baseline:collect": "node scripts/baseline-collect.mjs"` 和 `"baseline:diff": "node scripts/baseline-diff.mjs"`
- **不改任何 dependencies**

### T0.4 [P] 配置 gitignore

- 文件：`.gitignore`
- 新增：
  ```
  # Feature 143 baseline workspaces（运行时 clone 的大项目，不入库）
  tests/baseline/.workspaces/*
  !tests/baseline/.workspaces/.gitkeep
  ```

### T0.5 [P] 创建 fixture 目录文档

- 文件：`tests/baseline/README.md`
- 内容：
  - 用途：Feature 143 baseline 数据存储
  - 目录结构（plan §6.2）
  - schemaVersion 1.0 字段说明（精简版，详细见 plan §5.3）
  - 跑法：`npm run baseline:collect -- --target <name> --mode <mode>`
  - 不要直接编辑 fixture（应通过 collector 重跑产生）

### T0.6 [P] 创建 .gitkeep 占位

- 文件：`tests/baseline/.workspaces/.gitkeep`
- 内容：单行注释或空文件

### T0.7 创建 collector 单测

- 文件：`tests/unit/baseline-collect.test.ts`
- 单测项：
  - `parseTargetFiles` 对 micrograd 子集返回正确 fileCountsByType
  - `parseLlmCalls` 对 mock stdout 正确切分 P50/P95
  - `parseBatchSummary` 对 mock batch-summary.md 正确读 tokens（cost summary 内嵌在 batch-summary.md，无独立 cost-summary.json）
  - `parseGraph` 对 mock graph.json 正确数 node/edge
  - `assembleFixture` 输出符合 schemaVersion 1.0（所有 meta/perf/output 字段非 undefined）
  - `verifyArtifacts` 缺关键字段时返回非 0
  - 不实际 spawn batch（mock fs read）

### T0.8 创建 diff 单测

- 文件：`tests/unit/baseline-diff.test.ts`
- 单测项：
  - `compareDimensions` 在 +5% / +15% / +25% 三档输出 green / yellow / red
  - `--mode reproducibility` 对 +6% wall time 返回 FAIL
  - `--mode regression` 对同样 +6% 返回 PASS（绿色）
  - schemaVersion `2.0` vs `1.0` 退出码 2
  - `--ignore-quality` 跨 1.0 / 1.1 fixture 比较 perf 不报错

### T0.9 [P] 创建报告骨架（perf-baseline-report.md）

- 文件：`specs/143-large-project-e2e-baseline/perf-baseline-report.md`
- 章节齐全（spec §5.1 + plan 数据维度），数据用 `<待 Phase 1 回填>` 占位
- 必含一行 `<!-- SC-002: report skeleton populated, awaiting fixture data -->`

### T0.10 [P] 创建报告骨架（bottleneck-analysis.md）

- 文件：`specs/143-large-project-e2e-baseline/bottleneck-analysis.md`
- 章节齐全（spec §5.2），数据用 `<待 Phase 1 回填>` 占位
- 必含 `## F145 / F146 并发数建议` 章节（即使内容是 placeholder）

### T0.11 micrograd 端到端验证

- 跑：
  ```bash
  npm run build
  npm run baseline:collect -- --target karpathy/micrograd --mode full
  ```
- 期望：
  - `tests/baseline/.workspaces/micrograd/` 被 clone
  - `tests/baseline/micrograd/full.json` 被生成
  - 单测全绿
- **如果 ANTHROPIC_API_KEY 未配置或网络不可用**：跳过实际 spawn，但 collector 解析逻辑通过 mock fixture 单测验证（T0.7 已覆盖）；此情况下需在 verification report 标注"Phase 0 端到端实跑延迟到用户环境"

### T0.12 Phase 0 commit

- 跑 `npx vitest run tests/unit/baseline-{collect,diff}.test.ts && npm run build && npm run repo:check`
- commit message 末尾 `[Phase 0/4]`
- **不**标 SC-002 / SC-003 PASS

---

## Phase 1（修订）：3 个固定 baseline projects × spectra × full mode 采集 + 报告回填

**用户决策修订**：原计划的 Wave 1（Continue / Khoj 大项目）废弃。新计划：3 个固定 projects（micrograd / nanoGPT / self-dogfood），仅 full mode（reading / code-only 命令就绪但不入本 Feature）。

### T1.1 micrograd baseline（spectra full）

- 跑：`npm run baseline:collect -- --target karpathy/micrograd --mode full`
- 预期：~3 分钟，~$0.55
- 产物：`tests/baseline/micrograd/spectra/full.json`

### T1.2 nanoGPT baseline（spectra full）

- 跑：`npm run baseline:collect -- --target karpathy/nanoGPT --mode full`
- 预期：~5-10 分钟，~$0.40-0.80
- 产物：`tests/baseline/nanoGPT/spectra/full.json`

### T1.3 self-dogfood baseline（spectra full）

- 跑：`npm run baseline:collect -- --target self-dogfood --mode full`
- 预期：~10 分钟，~$6
- 产物：`tests/baseline/self-dogfood/spectra/full.json`

### T1.4 回填 perf-baseline-report.md

- 把所有 `<待 Phase 1 回填>` 替换为 3 个 fixture 里的具体数字
- spec §5.1 维度填齐（耗时 / LLM 调用次数+P50/P95 / token / dry-run 偏差 / graph 规模 / spec 成功率 / memory）
- 删除 Wave 2 / continue / khoj 相关章节（已由用户决策放弃）
- 跑 SC-004 校验

### T1.5 回填 bottleneck-analysis.md

- 排序至少 3 个瓶颈（按 LLM 调用 P95 / 总耗时占比 / token 总量 等维度）
- F145/F146 并发数建议章节：基于 fixture llmCallDurationsMs + tokensInput/Output 推断
- 引用 3 个 fixture 文件路径作为数据来源

### T1.6 Phase 1 commit

- commit message：`feat(143): 3 个固定 baseline 采集 + 报告回填 [Phase 1/4]`
- 跑 SC-002 / SC-003 / SC-004 / SC-005 grep 校验，全绿才 commit
- 跑 `npm run baseline:collect -- --verify-artifacts` 标 SC-001 PASS

---

## Phase 2（修订）：Reproducibility 验证（取消 Wave 2 khoj）

**用户决策修订**：Wave 2 khoj / langchain 全部废弃（cost 超预算）。Phase 2 仅保留 reproducibility 验证（同 commit 重跑稳定性）。

### T2.1 micrograd 同 commit reproducibility 抽样

- 跑：
  ```bash
  cp tests/baseline/micrograd/spectra/full.json /tmp/micrograd-run1.json
  npm run baseline:collect -- --target karpathy/micrograd --mode full
  npm run baseline:diff -- /tmp/micrograd-run1.json tests/baseline/micrograd/spectra/full.json --mode reproducibility
  ```
- 期望退出码 0（< 5% 偏差，spec §6 reproducibility tolerance）
- 如失败：collector 有不确定性 bug

### T2.2 SC-001 本地验证

- 跑：`npm run baseline:collect -- --verify-artifacts`
- 期望退出码 0；扫 3 个 fixture：micrograd / nanoGPT / self-dogfood × spectra/full.json

### T2.3 Phase 2 commit

- commit message：`feat(143): reproducibility verification + SC-001 PASS [Phase 2/4]`
- 标 SC-001 PASS

---

## Phase 3（可选）：CI workflow 模板

**目标**：提供 workflow_dispatch 模板，不绑 cron。

### T3.1 创建 baseline-weekly.yml

- 文件：`.github/workflows/baseline-weekly.yml`
- 内容：plan §7 D6 给的 yaml 骨架
- 验证：用 `actionlint` 或目视检查 yaml 语法

### T3.2 Phase 3 commit

- commit message：`feat(143): CI integration (optional workflow_dispatch) [Phase 3/4]`

---

## Verification 阶段（约 30 分钟）

### TV.1 跑全量验证

```bash
npx vitest run                                      # 全量单测，包含 baseline-{collect,diff} 两个新 test 文件
npm run build                                       # 类型检查零错误
npm run repo:check                                  # 仓库同步链路全绿
npm run baseline:collect -- --verify-artifacts      # SC-001
grep -E "(约|估计|大约)" specs/143-large-project-e2e-baseline/perf-baseline-report.md | grep -v estimatedTokens   # SC-004 应无输出
grep -q "F145" specs/143-large-project-e2e-baseline/bottleneck-analysis.md    # SC-005
grep -q "F146" specs/143-large-project-e2e-baseline/bottleneck-analysis.md    # SC-005
```

### TV.2 写 verification-report.md

- 文件：`specs/143-large-project-e2e-baseline/verification/verification-report.md`
- 章节：
  - SC-001~SC-005 验证记录（每条对应 fixture / grep 命令 / 实际输出）
  - 全量 vitest 结果摘要
  - build / repo:check / release:check（如适用）状态
  - 实际跑过的 baseline target × mode 矩阵
  - 已知偏差或未达成 SC（如有）+ 后续跟进路径

### TV.3 verification commit

- commit message：`feat(143): verification report — SC-001..005 PASS [Phase 4/4]`

---

## Push 阶段

按 [CLAUDE.md](http://CLAUDE.md) "交付到 master" 约定：

```bash
git fetch origin master:master
git rebase master
npx vitest run && npm run build && npm run repo:check
# 报告用户等待明确授权
```

不得自行 push。

---

## 任务依赖关系（DAG 简图）

```
Phase 0:
  T0.1, T0.2, T0.3, T0.4, T0.5, T0.6 (并行: 文件骨架)
  ↓
  T0.7, T0.8 (并行: 单测)
  ↓
  T0.9, T0.10 (并行: 报告骨架)
  ↓
  T0.11 (端到端验证)
  ↓
  T0.12 (Phase 0 commit)

Phase 1:
  T1.1 → T1.2 → T1.3 (顺序：避免 API rate limit)
  ↓
  T1.4 → T1.5 (顺序：报告依赖 fixture)
  ↓
  T1.6 (Phase 1 commit)

Phase 2:
  T2.1 + T2.3 (并行)
  ↓
  T2.2 (依赖 T2.1)
  ↓
  T2.4 (Wave 2 实跑)
  ↓
  T2.5 → T2.6

Phase 3 (可选):
  T3.1 → T3.2

Verification:
  TV.1 → TV.2 → TV.3
```

---

## 实跑可行性说明

部分 task（T0.11 / T1.x / T2.x）需要：
- 配置好的 `ANTHROPIC_API_KEY`
- 网络可访问 GitHub clone target 项目
- 磁盘空间（Continue ~500MB，khoj ~200MB）
- 时间预算（Continue 30-60 min，khoj 20-40 min）

**如执行环境不满足上述条件**：
- T0.1-T0.10 所有 skeleton + 单测 task 必须完成（这是本 Feature 的核心交付）
- T0.11 + Phase 1 + Phase 2 实跑 task 可在 verification report 中标注"延迟到用户环境执行"，提供完整的 reproducible 命令序列
- SC-001 / SC-002 / SC-003 / SC-004 / SC-005 在没有实数据时无法标 PASS；verification report 如实记录"infrastructure ready, data collection pending"
