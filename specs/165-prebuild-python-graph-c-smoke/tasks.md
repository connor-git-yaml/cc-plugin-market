# Tasks: Feature 165 — Pre-build Python Graph & Cohort C Smoke Test

**特性目录**: `specs/165-prebuild-python-graph-c-smoke/`
**输入制品**: `spec.md`（14 FR + 5 SC + 8 EC）、`plan.md`（4 核心决策 + M1–M4 里程碑）
**生成时间**: 2026-05-16
**修订**: 2026-05-16（Codex round-1 review 后修订：T-003 单仓库参数化 / T-010 fsync / T-XX 新增 RED wire test / runtime version 改 CLI 探测 / 阶段性 Codex review checkpoint）

---

## 阶段性 Codex 对抗审查 Gate（CLAUDE.local.md 约定）

| Gate | 时机 | 状态 |
|------|------|------|
| GATE_SPEC | spec.md 完成后 | ✅ PASS（4 轮迭代收敛） |
| GATE_PLAN_TASKS | plan.md + tasks.md 完成后 | ⏳ 待执行（编排器主线程跑，本任务列表外） |
| GATE_IMPLEMENT_PRE | M2 实施前 | ⏳ 待执行（编排器主线程，T-007 后触发） |
| GATE_IMPLEMENT_POST | M2 实施完成后 | ⏳ 待执行（编排器主线程，T-012 后触发） |
| GATE_SMOKE_POST | M3 smoke 完成 + judgment 后 | ⏳ 待执行（编排器主线程，T-017 后触发） |
| GATE_VERIFY | M4 全部验证后 | ⏳ 待执行（编排器 Phase 5） |

**前置**: GATE_PLAN_TASKS 必须 PASS 才能进入 T-001。

---

## 关键路径摘要

```
[串行强依赖路径]
T-001（build）→ T-002（baseline 存在性）→ T-003（dry-run 预估）
→ T-004/005/006（graph build 各仓库，可串行）→ T-007（graph schema 验证）

[M2 并行可能]
T-008（单测 validateGraphSchema）┐
T-009（单测 injectGraph）       ├─ 可并行编写，T-011（runOne 插入）依赖 T-010
T-010（实现 injection hook）    ┘
T-011（runOne 插入点 + Cohort A/B 断言）→ T-012（M2 单测全量 PASS）

[M3 串行执行]
T-013（SWE-L001 × 3）→ T-014（SWE-L003 × 3）→ T-015（SWE-L005 × 3）
→ T-016（consumptionSignals 提取分析）→ T-017（T053 判定）

[M4 依赖 M3 完成]
T-018（§10.5.1 填写）→ T-019（§10.4 更新）→ T-020（全量 vitest/build/repo:check）
→ T-021（git status 验证；终审 Codex 由编排器 Phase 5 GATE_VERIFY 触发）
```

**并行机会**：
- T-008 / T-009 可与 T-010 并行开始（测试优先，参照 TDD）
- M1 的三个仓库 graph build（T-004/005/006）理论上可并行，但建议串行避免 spectra 资源竞争（plan.md 决策 1 注明）
- T-018 / T-019 §10.5.1 / §10.4 可在 T-017 判定完成后并行撰写

---

## M1：Graph Build Script — 为三仓库预生成 spectra graph

**目标（US1 / P1）**：`~/.spectra-baselines/{pytest,astropy,sympy}/specs/_meta/graph.json` 全部生成、schema 合法、`callSites.length > 0`、含 version 元数据，且不出现在本仓库 `git status`。

**独立测试**：对三个仓库各执行 `node -e "const g=require('path/to/graph.json'); console.log(g.callSites.length, g.spectraVersion)"` 均输出非零正整数 + 版本字符串。

---

- [ ] T-001 [M1][CRITICAL] 执行 `npm run build` 生成 `dist/cli/index.js`
  - **类型**: 前置验证
  - **前置**: 无
  - **验证**: `test -f dist/cli/index.js && echo "build ok"`
  - **预估**: 3 min
  - **关联 spec**: FR-002

- [ ] T-002 [M1][CRITICAL] 验证三个 baseline 仓库目录已 clone
  - **类型**: 前置验证
  - **前置**: T-001
  - **验证**: `ls ~/.spectra-baselines/pytest ~/.spectra-baselines/astropy ~/.spectra-baselines/sympy` 均存在
  - **预估**: 2 min
  - **关联 spec**: FR-002、EC-001

- [x] T-003 [M1][CRITICAL] 新建 `scripts/baselines/build-swe-l-graphs.sh`（含 dry-run gate + 单仓库参数化）
  - **类型**: 实施
  - **前置**: T-001、T-002
  - **文件**: `scripts/baselines/build-swe-l-graphs.sh`（新建）
  - **内容**（⚠️ Codex W-1/W-3/W-6 修复）:
    - 接受 `--repo <pytest|astropy|sympy>` 单仓库参数 + `--all` 选项（默认 `--all` 串行三仓库）
    - `set -uo pipefail` + `log_info/log_warn/log_error` 颜色函数（参照 `clone-swe-bench-upstream.sh`）
    - 前置检查 `dist/cli/index.js` 存在，否则 `exit 1`
    - 前置检查目标仓库目录存在，否则标记 `graph-build-failed` 并 `exit 1`
    - 每个仓库处理：**必须 `(cd "$repo_dir" && $SPECTRA_CLI batch . ...)` subshell 包装**（避免 cwd 错位）；(1) dry-run 预估门控（cost > budget 或 wall > 60min → 跳过）；(2) `spectra batch . --mode full --budget $budget --concurrency 3 --on-over-budget cancel --no-html`；(3) 验证 `graph.json` 存在 + `callSites.length > 0`
    - **runtime version 注入**：从 `$PROJECT_ROOT/package.json` 读 `version` 字段（不 hardcode `4.1.1`）；若 `$SPECTRA_CLI --version` 输出与 package.json 不一致，仅 `log_warn`，使用 package.json 值
    - graph.json 缺 `spectraVersion`/`graphSchemaVersion` 时，用内联 Node 脚本动态注入 `$spectra_pkg_version`
    - Budget：pytest=5 / astropy=10 / sympy=10（命令行可覆盖）
    - `FAILED_REPOS` 数组累计；任一失败则 `exit 1`
  - **验证**: `bash -n scripts/baselines/build-swe-l-graphs.sh`（语法检查）+ `bash scripts/baselines/build-swe-l-graphs.sh --help` 输出 usage
  - **预估**: 30 min
  - **关联 spec**: FR-001、FR-002、FR-008、EC-001、EC-003

- [ ] T-004 [M1][manual] 执行 `build-swe-l-graphs.sh --repo pytest` — pytest 仓库 graph build
  - **类型**: 跑批（wall-clock 等待）
  - **前置**: T-003
  - **命令**: `bash scripts/baselines/build-swe-l-graphs.sh --repo pytest`
  - **验证**: `~/.spectra-baselines/pytest/specs/_meta/graph.json` 存在 + `callSites.length > 0` + 含 `spectraVersion` 字段
  - **预估**: 5–15 min（wall clock，取决于 LLM latency）
  - **关联 spec**: FR-001、FR-002、SC-001

- [ ] T-005 [M1][manual] 执行 `build-swe-l-graphs.sh --repo astropy` — astropy 仓库 graph build
  - **类型**: 跑批（wall-clock 等待）
  - **前置**: T-004（串行，避免 spectra 资源竞争）
  - **命令**: `bash scripts/baselines/build-swe-l-graphs.sh --repo astropy`
  - **验证**: `~/.spectra-baselines/astropy/specs/_meta/graph.json` 同上
  - **预估**: 15–30 min（wall clock）
  - **关联 spec**: FR-001、FR-002、SC-001

- [ ] T-006 [M1][manual] 执行 `build-swe-l-graphs.sh --repo sympy` — sympy 仓库 graph build
  - **类型**: 跑批（wall-clock 等待）
  - **前置**: T-005
  - **命令**: `bash scripts/baselines/build-swe-l-graphs.sh --repo sympy`
  - **验证**: `~/.spectra-baselines/sympy/specs/_meta/graph.json` 同上
  - **预估**: 15–30 min（wall clock）
  - **关联 spec**: FR-001、FR-002、SC-001

- [ ] T-007 [M1][CRITICAL] 校验三仓库 graph.json：schema 合法 + version 字段 + git status 清洁
  - **类型**: 验证
  - **前置**: T-004、T-005、T-006
  - **验证**:
    ```bash
    for repo in pytest astropy sympy; do
      node -e "
        const g=JSON.parse(require('fs').readFileSync(
          process.env.HOME+'/.spectra-baselines/$repo/specs/_meta/graph.json','utf-8'));
        console.assert(g.nodes && g.links && g.callSites,'missing fields');
        console.assert(g.callSites.length>0,'callSites empty');
        console.assert(g.spectraVersion,'no spectraVersion');
        console.log('$repo ok, callSites='+g.callSites.length);
      "
    done
    git status  # 确认无 ~/.spectra-baselines 路径追踪
    ```
  - **预估**: 5 min
  - **关联 spec**: FR-001、FR-005、FR-011、SC-001、EC-005

**M1 完成检查点**：三仓库 graph.json 全部通过 schema 校验 + `callSites > 0` + version 元数据 + `git status` 清洁。

---

## M2：Injection Hook + Schema Validate + 单元测试

**目标（US2 / P1）**：`eval-mcp-augmented.mjs` 的 Cohort C 分支具备完整 injection hook（atomic copy + 双阶段 schema 校验 + telemetry 写入），Cohort A/B 前置断言落地；所有新函数有单测覆盖，`npx vitest run` 全量 PASS。

**独立测试**：`npx vitest run tests/unit/eval-mcp-augmented-prompt.test.ts`（追加用例后）全部 PASS。

> **TDD 顺序**：先写单测（T-008/T-009），确认 FAIL，再写实现（T-010），最后验证 PASS（T-011/T-012）。

---

- [x] T-008 [M2][P][TDD] 编写 `validateGraphSchema` 单测（先写，先确认失败）
  - **类型**: 测试（TDD Red）
  - **前置**: M1 完成（T-007）
  - **文件**: `tests/unit/eval-mcp-augmented-prompt.test.ts`（追加）
  - **覆盖路径**:
    - 文件不存在 → `{ ok: false, errorCode: 'graph-not-built' }`
    - 缺少 `nodes`/`links`/`callSites` 字段 → `{ ok: false, errorCode: 'graph-schema-mismatch' }`
    - `callSites = []`（空数组）→ `{ ok: false, errorCode: 'payload-empty' }`
    - `graphSchemaVersion` 与 runtimeVersion 不匹配 → `{ ok: false, errorCode: 'graph-schema-mismatch' }`
    - 所有字段合法 + version 一致 → `{ ok: true }`
  - **验证**: `npx vitest run tests/unit/eval-mcp-augmented-prompt.test.ts` 新增用例 FAIL（实现未写时）
  - **预估**: 20 min
  - **关联 spec**: FR-011、EC-006

- [x] T-009 [M2][P][TDD] 编写 `injectGraph` / `assertNoGraphInWorktree` / `extractConsumptionSignals` 单测
  - **类型**: 测试（TDD Red）
  - **前置**: M1 完成（T-007）
  - **文件**: `tests/unit/eval-mcp-augmented-prompt.test.ts`（追加）
  - **覆盖路径**:
    - `injectGraph`：source validate 失败 → `{ status: 'failed', errorCode }` 正确；atomic copy 成功 → `{ status: 'success', sourceHash === destHash }`；dest hash 不匹配（mock）→ `copy-integrity-failed`
    - `assertNoGraphInWorktree`：worktree 中有 graph.json → 抛异常；无 → 不抛
    - `extractConsumptionSignals`：空 `changedSymbols` → `[]`；patch 含 symbolName → `patch-diff-literal`；后续 mcp call 含 symbolId → `derived-mcp-call`；stdout 含因果短语 → `reasoning-trace-mention`
  - **验证**: 新增用例预期 FAIL
  - **预估**: 30 min
  - **关联 spec**: FR-011、FR-012、FR-013、FR-014、EC-002、EC-007、EC-008

- [x] T-009a [M2][P][TDD] 编写 runOne() 注入 wire RED 测试（Codex W-4 修复）
  - **类型**: 测试（TDD Red — runOne 集成 wire）
  - **前置**: T-008、T-009 完成
  - **文件**: `tests/unit/eval-mcp-augmented-classic.test.ts`（追加，因 classic test 文件已涉及 runOne 路径）
  - **覆盖路径**（mock prepareWorktree + spawnSync + spectra CLI）:
    - **Cohort C 注入路径**：mock 一个 fake source graph，调用 runOne(group='C', ...) → 断言 (i) injectGraph 被调用 (ii) runResult.graphInjection 存在且 status='success' (iii) telemetry 含 sourceHash/destHash
    - **Cohort C 注入失败路径**：mock source schema 缺字段 → 断言 runResult.graphInjection.status='failed' 且 errorCode='graph-schema-mismatch'；runOne 继续执行（不 throw）
    - **Cohort A 前置断言路径**：mock worktree 已有残留 graph.json → 断言 assertNoGraphInWorktree 抛异常 + runOne 返回 { ok: false, error: ... }
    - **Cohort B 同 A**：另起一个 case 验证 group='B' 也走 assert 路径，不走 injectGraph
  - **验证**: 新增用例 FAIL（T-010/T-011 未实现时）
  - **预估**: 30 min
  - **关联 spec**: FR-003、FR-004、FR-013、FR-014、EC-002、EC-008

- [x] T-010 [M2][CRITICAL] 在 `eval-mcp-augmented.mjs` 中实现四个新函数（exports）
  - **类型**: 实施
  - **前置**: T-008、T-009、T-009a（三个 TDD Red 测试先写完）
  - **文件**: `scripts/eval-mcp-augmented.mjs`（修改）
  - **新增内容**（内联于文件，不新建模块）:
    - `import { createHash } from 'node:crypto'` + `import { execFileSync } from 'node:child_process'`（顶部 static import 区）
    - `const GRAPH_FILENAME = 'specs/_meta/graph.json'`
    - `const RUNTIME_SPECTRA_VERSION`（⚠️ Codex W-3 修复：优先 `spectra --version` 探测 → fallback `package.json` → fallback `'unknown'`，见 plan.md 决策 3）
    - `export function validateGraphSchema(graphPath, runtimeSpectraVersion)` — 双阶段校验逻辑（见 plan.md 决策 3）
    - `export function computeFileHash(filePath)` — SHA256 hex hash
    - `export function injectGraph({ taskFixture, wtDir, runtimeSpectraVersion })` — atomic copy + **fsync(tmpFd) + rename + fsync(dirFd)** + source 校验 + dest 二次校验 + telemetry 对象返回（⚠️ Codex W-5 修复：fs.writeSync + fs.fsyncSync(tmpFd) + fs.renameSync + fs.fsyncSync(dirFd)，见 plan.md 决策 2）
    - `export function assertNoGraphInWorktree(wtDir)` — Cohort A/B 前置断言
    - `export function extractConsumptionSignals({ changedSymbols, mcpToolCalls, stdout, patchText })` — 三类机械化信号提取（见 plan.md 决策 4）
  - **验证**: `npx vitest run tests/unit/eval-mcp-augmented-prompt.test.ts`（T-008/T-009 用例由 FAIL → PASS）
  - **预估**: 50 min
  - **关联 spec**: FR-003、FR-011、FR-012、FR-013、FR-014

- [ ] T-011 [M2][CRITICAL] 在 `runOne()` 函数中插入 injection hook + Cohort A/B 断言 + telemetry 写入
  - **类型**: 实施
  - **前置**: T-010
  - **文件**: `scripts/eval-mcp-augmented.mjs`（修改）
  - **插入点**：`prepareWorktree()` 成功返回后、`buildMcpConfigFile()` 前（约 line 778 之后，见 plan.md 决策 2 说明）
  - **插入逻辑**:
    - `if (group === 'C')` → 调用 `injectGraph(...)` → 将结果写入 `runResult.graphInjection`；若 `status === 'failed'` 继续执行（fallback 路径）但 telemetry 已标注失败
    - `else` (A/B) → 调用 `assertNoGraphInWorktree(wt.wtDir)`，捕获异常则 `return { ok: false, ... }`
    - `runResult` 顶层 spread：`...(group === 'C' ? { graphInjection } : {})`
    - Cohort C 运行完成后，调用 `extractConsumptionSignals(...)` 并写入 `graphInjection.consumptionSignals` + `consumptionStatus`
  - **注意**：不修改 `prepareWorktree` 内部（baseline-runner 共享合同），仅在调用 `prepareWorktree` 的上层追加逻辑
  - **验证**: `npm run build`（零类型错误）；`npx vitest run tests/unit/eval-mcp-augmented-prompt.test.ts`（全 PASS）
  - **预估**: 30 min
  - **关联 spec**: FR-003、FR-004、FR-013、FR-014、EC-002、EC-008

- [ ] T-012 [M2] 全量单测验证 M2 实现
  - **类型**: 验证
  - **前置**: T-011
  - **验证**: `npx vitest run` — 全部 ≥3635 条 PASS，零新增失败
  - **预估**: 5 min
  - **关联 spec**: FR-009、SC-004

**M2 完成检查点**：injection hook + 单测全量 PASS。可独立验证 Cohort C 注入逻辑正确性。

---

## M3：9-run Smoke Rerun + consumptionSignals 提取

**目标（US2 / P1）**：Cohort C 9 次运行全部完成，`run-N.json` 包含 `graphInjection` + `consumptionSignals`，T053 判定有依据。

**独立测试**：读取 `tests/baseline/swe-bench-lite/runs/C/{SWE-L001,SWE-L003,SWE-L005}/run-*.json`，检查 9 个文件均含 `graphInjection.status === 'success'`、`detectChangesCallCount >= 1`、至少一次 `changedSymbolsCount > 0`。

---

- [ ] T-013 [M3][manual] 执行 Cohort C smoke — SWE-L001（pytest）× 3 次
  - **类型**: 跑批（wall-clock 等待）
  - **前置**: T-012（M2 全量通过）、T-007（graph 已生成）
  - **命令**: `node scripts/eval-mcp-augmented.mjs --group C --task SWE-L001 --repeat 3`
  - **验证**: `tests/baseline/swe-bench-lite/runs/C/SWE-L001/run-{1,2,3}.json` 存在，含 `graphInjection` 字段
  - **预估**: 15–25 min（wall clock，3 次 LLM 调用）
  - **关联 spec**: FR-010、SC-002、EC-002

- [ ] T-014 [M3][manual] 执行 Cohort C smoke — SWE-L003（astropy）× 3 次
  - **类型**: 跑批
  - **前置**: T-013（串行，避免 worktree 混乱）
  - **命令**: `node scripts/eval-mcp-augmented.mjs --group C --task SWE-L003 --repeat 3`
  - **验证**: `tests/baseline/swe-bench-lite/runs/C/SWE-L003/run-{1,2,3}.json` 存在，含 `graphInjection` 字段
  - **预估**: 15–25 min（wall clock）
  - **关联 spec**: FR-010、SC-002

- [ ] T-015 [M3][manual] 执行 Cohort C smoke — SWE-L005（sympy）× 3 次
  - **类型**: 跑批
  - **前置**: T-014
  - **命令**: `node scripts/eval-mcp-augmented.mjs --group C --task SWE-L005 --repeat 3`
  - **验证**: `tests/baseline/swe-bench-lite/runs/C/SWE-L005/run-{1,2,3}.json` 存在，含 `graphInjection` 字段
  - **预估**: 15–25 min（wall clock）
  - **关联 spec**: FR-010、SC-002

- [ ] T-016 [M3][CRITICAL] 运行 post-hoc 分析脚本：提取 consumptionSignals 并汇总 9 次运行数据
  - **类型**: 分析
  - **前置**: T-013、T-014、T-015
  - **命令**（参照 plan.md M3 分析脚本骨架）:
    ```bash
    node -e "
    const fs = require('fs'), path = require('path');
    const base = 'tests/baseline/swe-bench-lite/runs/C';
    const results = [];
    for (const task of ['SWE-L001','SWE-L003','SWE-L005']) {
      for (let i = 1; i <= 3; i++) {
        const fp = path.join(base, task, \`run-\${i}.json\`);
        const r = JSON.parse(fs.readFileSync(fp,'utf-8'));
        results.push({
          task, run: i,
          gi_status: r.graphInjection?.status,
          errorCode: r.graphInjection?.errorCode ?? null,
          detectChangesCallCount: r.detectChangesCallCount ?? 0,
          changedSymbolsCount: r.changedSymbolsCount ?? 0,
          consumptionSignals: r.graphInjection?.consumptionSignals?.length ?? 0,
          consumptionStatus: r.graphInjection?.consumptionStatus
        });
      }
    }
    console.log(JSON.stringify(results, null, 2));
    " | tee /tmp/f165-smoke-summary.json
    ```
  - **验证**: 输出 9 行记录，记录成功率、detectChangesCallCount、changedSymbolsCount、errorCode 分布
  - **预估**: 10 min
  - **关联 spec**: FR-006、FR-012、SC-002

- [ ] T-017 [M3][CRITICAL] 根据 post-hoc 数据做 T053 通过/失败判定（SC-002 四条充要标准逐一核对）
  - **类型**: 验证 + 判定
  - **前置**: T-016
  - **判定标准**（4 条，全满足 = PASS，任一不满足 = FAIL）:
    1. 9 次 `graphInjection.status === 'success'`（SC-002 a）
    2. 9 次 `detectChangesCallCount >= 1`（SC-002 b）
    3. 至少 1 次 `changedSymbolsCount > 0`（SC-002 c）
    4. 无 `graph-schema-mismatch`/`payload-empty`/`copy-integrity-failed`/`graph-not-built` errorCode（SC-002 e）
  - **产出**: 判定结论文字（PASS / FAIL / PARTIAL + 失败原因），用于 M4 §10.5.1.4 和 §10.4
  - **预估**: 5 min
  - **关联 spec**: SC-002、EC-001、EC-002、EC-007

**M3 完成检查点**：9 次 run 数据汇总完成，T053 判定结论确定，有原始证据支撑。

---

## M4：报告填写 + 全量验证

**目标（US3 / P1）**：`competitive-evaluation-report.md` §10.5.1 新建 + §10.4 末尾追加，全量 vitest/build/repo:check 零错误，git status 无 graph.json 追踪。

**独立测试**：打开 `competitive-evaluation-report.md`，验证 §10.5.1 存在且含摘要表 + ≥3 个 detect_changes 摘录 + driver trace；§10.4 含 T052 操作前提建议 + T053 定位声明 + "不构成 lift 显著性"声明。

---

- [ ] T-018 [M4][US3] 填写 `competitive-evaluation-report.md` §10.5.1 — Cohort C Smoke Test（T053）结果
  - **类型**: 文档
  - **前置**: T-017
  - **文件**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`（修改）
  - **内容（按 plan.md 决策 5 大纲）**:
    - `§10.5.1.1` 运行摘要表：注入成功率、`detectChangesCallCount` 分布、`changedSymbolsCount` 分布、errorCode 计数表（4 种）
    - `§10.5.1.2` ≥3 个真实 `detect_changes` 原始响应摘录（taskId + repeatIndex + changedSymbols 子集 + errorCode）
    - `§10.5.1.3` driver 行为 trace 子节：consumptionSignals 统计（三类信号计数 + `payload-injected-but-not-consumed` 次数）+ 与 F164 broken 时随机猜测的对比
    - `§10.5.1.4` T053 通过/失败判定：4 条充要标准逐一勾选 + 整体判定（PASS / FAIL / PARTIAL）
  - **注意**: 如 T053 失败，如实记录失败次数和 errorCode，不允许选择性过滤（FR-006 d 条要求）
  - **验证**: 文件包含 `§10.5.1` 标题，摘要表和摘录存在
  - **预估**: 30 min
  - **关联 spec**: FR-006、SC-003、EC-004

- [ ] T-019 [M4][US3] 更新 `competitive-evaluation-report.md` §10.4 — 末尾追加 T053 战略结论
  - **类型**: 文档
  - **前置**: T-018（理解 T053 判定结果后撰写）
  - **文件**: `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`（修改）
  - **追加内容**（在原 §10.4 末尾，不改原有内容）:
    - `§10.4.X T053 Smoke Test 结论（Feature 165 更新）`
    - 段落 a：T053 通过/失败/部分失败判定
    - 段落 b：T052 全量 450 runs 启动操作前提评估（注入合同稳定性 / telemetry 可信度 / graph schema 一致性 各是/否）
    - 段落 c：显式声明 "T053 为 smoke test 而非 lift gate，n=9 样本不具备统计显著性，±11pp 结果差异在 LLM 方差范围内；T052 启动决策权归用户"
  - **验证**: §10.4 末尾含上述三段落；无 lift 显著性声明
  - **预估**: 20 min
  - **关联 spec**: FR-007、SC-003

- [ ] T-020 [M4][CRITICAL] 全量质量门验证：vitest + build + repo:check
  - **类型**: 验证
  - **前置**: T-019
  - **命令**:
    ```bash
    npx vitest run          # ≥3635 条 PASS，零失败
    npm run build           # 零类型错误
    npm run repo:check      # 零错误
    ```
  - **验证**: 三个命令全部零失败
  - **预估**: 10 min
  - **关联 spec**: FR-009、SC-004

- [ ] T-021 [M4] `git status` 验证：确认无 graph.json 文件被追踪
  - **类型**: 验证
  - **前置**: T-020
  - **命令**: `git status` — 确认无 `~/.spectra-baselines/` 或 `graph.json` 相关路径出现在 tracked changes 中
  - **处置**: 若发现追踪：`git rm --cached <path>` + 补充 `.gitignore` 规则
  - **验证**: `git status` 输出中无 graph 相关路径
  - **预估**: 3 min
  - **关联 spec**: FR-005、SC-001、EC-005

> **注：本 tasks 内 Codex 阶段性审查由编排器在 Phase 5 verify 阶段统一跑（GATE_VERIFY），不作为单独任务列出**（避免重复 — T-022 已删除）。

**M4 完成检查点**：报告填写完整 + 全量质量门 PASS + git status 清洁 = Feature 165 交付就绪（Codex 终审在编排器 Phase 5 验证闭环中执行）。

---

## FR 覆盖映射表

| FR | 任务 ID |
|----|---------|
| FR-001（graph.json 三仓库 schema 合法） | T-003、T-004、T-005、T-006、T-007 |
| FR-002（spectra CLI full 模式 + npm build 前置） | T-001、T-003 |
| FR-003（Cohort C atomic copy 注入，A/B 不注入） | T-010、T-011 |
| FR-004（graph-not-built fallback 保留 + telemetry 标注） | T-011 |
| FR-005（graph.json 不出现在 git tracked changes） | T-021 |
| FR-006（§10.5.1 摘要表 + 摘录 + trace + 判定） | T-018 |
| FR-007（§10.4 T052 操作前提 + T053 定位声明） | T-019 |
| FR-008（budget 门控 + dry-run 校准 + 成本上限） | T-003、T-004、T-005、T-006 |
| FR-009（vitest ≥3635 + build + repo:check 零错误） | T-012、T-020 |
| FR-010（smoke 严格限于 SWE-L001/L003/L005 × 3） | T-013、T-014、T-015 |
| FR-011（双阶段 schema + version 校验 + 4 类 errorCode） | T-008、T-010 |
| FR-012（detectChangesCallCount + consumptionSignals 三类信号） | T-009、T-010、T-016 |
| FR-013（每 run telemetry 写入 graphInjection 结构） | T-009、T-009a、T-011 |
| FR-014（atomic copy + fsync + 注入时机合同 + prepareWorktree 不修改） | T-009、T-009a、T-010、T-011 |

**FR 覆盖率：14/14（100%）**

**新增 RED 测试任务**（Codex round 1 修复）：T-009a 覆盖 runOne() 集成 wire 的红绿循环，防止 helper 单测全过但集成断裂。

---

## 依赖关系与并行说明

### Phase 依赖关系

```
M1（T-001 → T-007）
  ↓ 全部完成
M2（T-008/T-009 可并行 → T-010 → T-011 → T-012）
  ↓ T-012 通过
M3（T-013 → T-014 → T-015 → T-016 → T-017）
  ↓ T-017 判定完成
M4（T-018/T-019 可并行 → T-020 → T-021；终审 Codex 由编排器 Phase 5 触发）
```

### User Story 间依赖

- **US1（M1）** 是 **US2（M2+M3）** 的前置（graph 文件必须存在才能注入）
- **US2（M3 完成）** 是 **US3（M4）** 的前置（需要真实数据才能写报告）
- **US4（M4 质量门）** 贯穿全程，最终在 T-020 验证

### Story 内部并行机会

| 并行组 | 任务 | 前提 |
|--------|------|------|
| M2 TDD 并行 | T-008 + T-009 | 进入 M2 后即可同时编写两组测试 |
| M4 报告并行 | T-018 + T-019 | T-017 判定完成后可同时撰写 |

### 推荐实现策略

**单人串行**（本 Feature 推荐，单人 story 模式）：

1. 完成 M1（T-001 → T-007）→ 等待 wall-clock
2. 完成 M2（T-008 → T-012）→ 单测全量验证
3. 完成 M3（T-013 → T-017）→ 等待 wall-clock + 判定
4. 完成 M4（T-018 → T-021）→ 编排器 Phase 5 终审 Codex → 交付

**MVP 范围**：US1（graph 生成）+ US2（注入 + smoke）为核心可验证交付；US3（报告）为对外传达价值的必要产出。三个 P1 故事缺一不可。

---

## 任务图谱

```
T-001──→T-002──→T-003
              ↓
         T-004(pytest)
              ↓
         T-005(astropy)
              ↓
         T-006(sympy)
              ↓
         T-007(验证)
              ↓
    ┌────────┴─────────┐
  T-008              T-009   ← 可并行（TDD Red）
    └────────┬─────────┘
             ↓
           T-010（实现函数）
             ↓
           T-011（runOne 插入点）
             ↓
           T-012（全量单测）
             ↓
           T-013（SWE-L001×3）
             ↓
           T-014（SWE-L003×3）
             ↓
           T-015（SWE-L005×3）
             ↓
           T-016（post-hoc 分析）
             ↓
           T-017（T053 判定）
             ↓
    ┌────────┴─────────┐
  T-018              T-019   ← 可并行（报告撰写）
    └────────┬─────────┘
             ↓
           T-020（质量门）
             ↓
           T-021（git status）
             ↓
   [编排器 Phase 5：GATE_VERIFY + Codex 终审]
```

**任务总数**：22 个（M1×7 + M2×6 含 T-009a + M3×5 + M4×4；本 tasks 不含 T-022，终审由编排器 Phase 5 GATE_VERIFY 触发）
**关键串行链**：T-001 → T-002 → T-003 → T-004 → T-005 → T-006 → T-007 → T-010 → T-011 → T-012 → T-013 → T-014 → T-015 → T-016 → T-017 → T-020 → T-021（17 步 + 编排器终审）
**并行节点**：T-008/T-009/T-009a（M2 进入时三路 TDD Red）、T-018/T-019（M4 进入时）
**可并行比例**：5/22 ≈ 22%（受 wall-clock 等待主导，并行收益有限）
**含 wall-clock 等待任务**：T-004、T-005、T-006（graph build，65–90 min）、T-013、T-014、T-015（smoke run，45–75 min）
**估算总人工时间（不含 wall-clock）**：约 3.5–4 小时纯编码 + 验证
