---
feature: 158
title: SWE-Bench Lite Grounding Eval — 技术实现计划
branch: claude/focused-sutherland-5ccdfb
created: 2026-05-09
status: Draft
phase: plan
---

# Feature 158 — 技术实现计划

## 1. 实现策略概述

### 核心架构

```
eval-mcp-augmented.mjs（入口，3 对照组调度）
    │
    ├─ cohort: control          → tool=control                → output: tests/baseline/tasks/T158-X/control/full.json
    │
    ├─ cohort: spectra-push     → tool=spec-driver-spectra    → output: tests/baseline/tasks/T158-X/spec-driver-spectra/full.json
    │
    └─ cohort: spectra-mcp-pull → tool=mcp-pull (新增枚举)     → output: tests/baseline/tasks/T158-X/mcp-pull/full.json
            │
            └── spawn: claude --print --model sonnet
                          --mcp-config <wtDir>/.mcp.json
                          --allowedTools mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob,Bash
                          --output-format stream-json --include-partial-messages
                          │
                          └── spectra mcp-server（stdio JSON-RPC，cwd = wtDir）
                                    projectRoot 默认 cwd（fallback）；agent 调用时可显式传 projectRoot=<wtDir>
```

### Cohort → tool name → output dir 完整映射（必须用此 canonical 名）

| cohort 显示名 | runner tool name | fixture output dir | 模型 |
|--------------|-----------------|-------------------|------|
| `control` | `control` | `tests/baseline/tasks/T158-{N}/control/full.json` | sonnet |
| `spectra-push` | `spec-driver-spectra` | `tests/baseline/tasks/T158-{N}/spec-driver-spectra/full.json` | sonnet |
| `spectra-mcp-pull` | `mcp-pull` | `tests/baseline/tasks/T158-{N}/mcp-pull/full.json` | sonnet |

**[已确认 W-03]** 三 cohort 一律用 sonnet（spec Out of Scope I-4 明确排除 Opus / Haiku 对比；与 Sprint 3 grounding=0 实验对齐）。

### 三阶段切片

| 阶段 | 周期 | 内容 |
|------|------|------|
| (a) Fixture & Harness | Week 1，D1-7 | T158-* fixture 设计 + sanity check；T2 spectra MCP 连通性 spike（**T5/T6 硬前置**）；eval-task-runner.mjs 新增 mcp-pull；eval-mcp-augmented.mjs 入口；verify-feature-158.mjs 框架 |
| (b) Eval & Aggregation | Week 2，D8-11 | 完整跑 3 cohort × 6 task × N=3 = **54 runs**；调试 W-3 trap；bootstrap CI 聚合 |
| (c) Report & Verify | Week 2，D12-13 | §6 报告人工撰写；verify-feature-158.mjs 全 SC 通过；codex review |

> **[已修订 C-01]** 总运行次数为 3 × 6 × 3 = **54**（不是 90）；之前文中所有"90 runs"已统一更正。

### 复用 vs 新增对比

| 组件 | 状态 | 复用程度 |
|------|------|---------|
| `eval-task-runner.mjs` 主流程（loadTaskFixture / prepareWorktree / runPrimaryOracle / assembleTaskFixture） | 已有 | 全量复用，约改 40 行（新增 mcp-pull case） |
| `eval-task-runner.mjs` spectra-push 注入逻辑（loadSpectraContext / buildDriverPrompt spec-driver-spectra case） | 已有 | 直接复用；PL-003 [已确认] push 注入的是 target 项目 spectra spec.md（不是 F158 spec.md） |
| `scripts/lib/bootstrap-ci.mjs` | 已有 | 直接引用；1000 resample 默认值已收口（CL-003） |
| `eval-task-fixture-check.mjs` | 已有 [已确认 PL-004] | 对每个 T158-* fixture 直接调用 |
| `eval-mcp-augmented.mjs` | **新建** | ~150 行；3 对照组封装入口 |
| `verify-feature-158.mjs` | **新建** | ~200 行；SC-001 到 SC-008 自动验收 |
| T158-* fixture（6 个） | **新建** | 基于 T1-T4 设计模式，新增 `expectedSpectraToolCalls` 字段 |

---

## 2. 文件改动清单

### 新建

| 文件路径 | 行数估算 | 关键意图 | 测试要求 |
|----------|---------|---------|---------|
| `scripts/eval-mcp-augmented.mjs` | ~150 | 3 对照组调度入口；支持 `--task / --cohort / --repeats / --dry-run` 参数；串行（或可选并行）spawn eval-task-runner；聚合 pass rate 写入 fixture；`--dry-run` 模式不实际调 LLM | vitest stub 测 `--dry-run` 返回 0；手动 smoke `--task T158-X --cohort all --repeats 1` |
| `scripts/verify-feature-158.mjs` | ~200 | SC-001 到 SC-008 自动验收；接受 `--target / --out / --repeats` 参数；输出 `[SC-00N] PASS/SKIP/WARN/FAIL` 格式；全部 PASS 则 exit 0 | 脚本 `--dry-run` 自测；手动 `node scripts/verify-feature-158.mjs` 跑全 SC |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-1.json` | ~80 | 单函数补全 task（基准难度，参照 T1；control 组预期 60-80% PASS）；`primaryOracle.checks` ≥ 2；functional oracle（pytest）；`expectedSpectraToolCalls: ["impact"]` | eval-task-fixture-check.mjs sanity check；oracle setup 后须 FAIL |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-2.json` | ~80 | caller graph 跨函数依赖 task（MCP 优势场景；control 组预期 30-50% PASS）；`expectedSpectraToolCalls: ["impact", "context"]` | 同上 |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-3.json` | ~80 | bug fix task（含 caller graph 传播链）；`expectedSpectraToolCalls: ["detect_changes", "context"]` | 同上 |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-4.json` | ~80 | 中等难度 refactor task；control 组预期 40-60% PASS；≥ 2 checks | 同上 |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-nanoGPT-5.json` | ~80 | nanoGPT target（扩大 target 多样性）；中等难度；`expectedSpectraToolCalls: ["context"]` | 同上 |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-micrograd-6.json` | ~80 | 难度偏高 task（control 组预期 20-40% PASS）；确保不出现地板效应 | 同上 |
| `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/.mcp.json.template` | ~20 | worktree 内 MCP server 配置模板；spectra mcp-server stdio JSON-RPC；projectRoot 通过 env var 或调用时参数注入；供 eval-mcp-augmented.mjs 渲染后写入 worktree | 手动 spike 验证 spectra MCP 可达 |

### 修改

| 文件路径 | 变更类型 | 关键修改点 | 行数估算 | 测试要求 |
|----------|---------|-----------|---------|---------|
| `scripts/eval-task-runner.mjs` | modify | (1) `SUPPORTED_TOOLS` 数组追加 `'mcp-pull'`（line 27）；(2) **`buildClaudeArgs` 接口签名新增 `wtDir` 参数**（变为 `({ tool, prompt, wtDir, bypassPermissions })`），调用方 `runTask` 已有 wtDir，直接透传；(3) mcp-pull case 注入 `--mcp-config ${wtDir}/.mcp.json` / `--allowedTools mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob,Bash` / `--output-format stream-json --include-partial-messages` / `--model sonnet`；(4) `assembleTaskFixture` 在 `perf` 子对象内写入 `mcpToolCallTrace` / `w3Flag` schema 1.2 字段；(5) `buildDriverPrompt` 在 mcp-pull case 返回纯 taskPrompt（与 control prompt 主体一致，避免 confound）；(6) loadTaskFixture 查找路径扩展：优先 `specs/158-.../research/task-fixtures/` 再 `specs/147-.../research/task-fixtures/`（向后兼容）；(7) **prepareWorktree 后写入 `${wtDir}/.mcp.json`**（mcp-pull cohort 才写）；(8) **runTask 调用前 spectra batch 一次**（micrograd 共享，nanoGPT 单独一次） | +90 行，改 ~20 行 | vitest: `SUPPORTED_TOOLS.includes('mcp-pull')` 断言；parseArgs 对 mcp-pull 不 throw；`buildClaudeArgs({ tool: 'mcp-pull', wtDir: '/tmp/x' })` 输出含 `--mcp-config /tmp/x/.mcp.json` |
| `scripts/eval-task-runner.mjs`（stream-json 解析） | modify | 新增 `parseMcpToolCallTrace(stdout)` 纯函数：从 `--output-format stream-json` stdout 文本提取 `tool_use` block（name 以 `mcp__spectra__` 开头）；输出形如 `[{ toolName, callCount, firstCallTurn, totalDurationMs }]` 的数组；并计算 `w3Flag`（CL-001 短名 endsWith 匹配 `expectedSpectraToolCalls`） | +40 行 | vitest: 给定 fixture stream-json 文本，验证解析结果字段类型正确；callCount=0 时 w3Flag=true；toolName 不在 expected 列表时 w3Flag=true |
| `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` | modify | 追加 §6 SWE-Bench-Style Grounding Lift 章节（~150 行）：**必须使用 markdown table（管道 `\|...\|...\|` 语法）**，至少 3 行 cohort 数据行；包含 pass rate 矩阵、bootstrap 95% CI、tool call trace 统计、token 效率对比、Limitation 小节、结论段 | +~150 行 | 人工撰写；SC-005 grep 验证标题 + 表格管道行 ≥ 3 |
| `scripts/baseline-diff.mjs`（NFR-005 plan-level 必做验证） | modify | **必做**：验证新增 `mcpToolCallTrace` / `w3Flag` 字段不被 baseline-diff 误报为 drift；现有 baseline-diff 应对 schema 1.1 的 perf 字段做白名单字段比对；plan task T8 中包含针对现有 12 个 perf anchor fixture 的回归跑 + 新增 mcp-pull fixture 的兼容跑 | +0 至 +10 行 | T8 子任务：`npm run baseline:diff` 对 12 个 perf anchor 全跑无 drift 误报 |

### 不入库（运行时产物）

- `tests/baseline/tasks/T158-*/control/full.json`（54 次运行产物，NFR-003，CLAUDE.local.md 明确不入库）
- `tests/baseline/tasks/T158-*/spec-driver-spectra/full.json`（spectra-push cohort 产物；目录名遵循 runner tool name，见 §1 cohort 映射表）
- `tests/baseline/tasks/T158-*/mcp-pull/full.json`（spectra-mcp-pull cohort 产物；SC-004 验收时读取此路径，**[已修订 C-02]** 不是 spectra-mcp-pull/）
- `~/.spec-driver-bench-worktrees/T158-*/`（worktree 目录，不入库）

---

## 3. 任务依赖图

```
T1 [eval-task-runner.mjs 添加 'mcp-pull' stub + buildClaudeArgs wtDir 参数]
  │
  ├─ T2 [spectra MCP server 连通性 smoke：T5/T6 硬前置]   ← [已修订 C-03]
  │   step 1: 在 ~/.spec-driver-bench-worktrees/spike-T2/ 内 rsync micrograd 源码
  │   step 2: spectra batch（micrograd）→ 生成 graph.json
  │   step 3: 写入 .mcp.json（spectra mcp-server cwd=wtDir）
  │   step 4: spawn claude --print --mcp-config --allowedTools mcp__spectra__impact
  │           --output-format stream-json --include-partial-messages
  │           -p "Use mcp__spectra__impact with target='Value.relu' and report"
  │   PASS 条件：stream-json 含 tool_use block name=mcp__spectra__impact，
  │              且 result.is_error==false，permission_denials==[]
  │   FAIL 条件：tool 不触发 / spectra graph 加载失败 → 暂停 plan，重新 review FR-002
  │
  T3 [T158-micrograd-1 fixture 设计（最简 baseline）]  依赖 T1
  │   验证 eval-task-runner.mjs mcp-pull 可 run（接通 T2 spike 路径）
  │
  ├─── T4a [T158-micrograd-2 fixture（caller graph 场景）]  ─┐
  ├─── T4b [T158-micrograd-3 fixture（bug fix + detect_changes）]─┤ 可并行（T3 完成后）
  ├─── T4c [T158-micrograd-4 fixture（refactor）]            │
  ├─── T4d [T158-nanoGPT-5 fixture（nanoGPT target）]        ─┘
  └─── T4e [T158-micrograd-6 fixture（高难度锚点）]
  │
  T5 [eval-mcp-augmented.mjs 入口脚本]  依赖 T1 + T2 + T3
  │   功能：3 对照组 dispatch + --dry-run 模式 + repeats 支持
  │   resume 策略：fixture 输出文件已存在则 skip 该 run（覆盖通过 --force flag）
  │
  T6 [完整 3 cohort × 6 task × N=3 = 54 runs]  依赖 T2 + T4a-e + T5
  │   - **并发度**：默认 concurrency=1（串行）；--concurrency=2 可选并行（注意 Anthropic API rate limit）
  │   - **batch boundary**：每个 task × cohort × N=3 = 3 runs 视为 1 batch；每 batch 完成后检查 W-3 trap 比率
  │   - **W-3 trap 暂停规则**：单 task 的 mcp-pull cohort 3 runs 中 ≥ 2 runs 触发 w3Flag=true，暂停继续，回到 fixture prompt 调整
  │   - **resume**：T5 fixture 输出文件存在自动 skip；中断后重跑只补缺失的 runs
  │   - **预算 pause**：累计 costUsd ≥ $35（70%）时主动 pause，review 是否调降 N 或 task 数量
  │   - **wall clock 估算**：54 runs × 5min = 4.5h（concurrency=1）；如分两天跑可分 27/27 batch
  │
  T7 [§6 报告章节（人工撰写）]  依赖 T6 数据
  │   输出：pass rate 矩阵（markdown table）+ CI + token 效率对比 + Limitation + 结论
  │   注意：§6 不由脚本自动生成（CL-AUTO-RESOLVED）；T7 是 implement phase 任务（人工撰写）
  │
  T8 [verify-feature-158.mjs 完整实现 + baseline-diff.mjs 兼容性回归]  依赖 T1 + T5 + T6 + T7
  │   SC-001 到 SC-008 逐条实现 + exit code 逻辑
  │   **NFR-005 plan-level 验证**：跑 `npm run baseline:diff` 对 12 个 perf anchor，确认 schema 1.2
  │   新字段不触发 drift 误报；若触发，加白名单或修 baseline-diff
  │
  T9 [全量验收 + lint + build + repo:check]  依赖 T8
      npm run build（0 TypeScript error）
      npx vitest run（0 failed）
      npm run repo:check
      npm run baseline:diff（12 perf anchor 无 drift 误报）
      node scripts/verify-feature-158.mjs（exit 0）
```

**关键串行路径**：T1 → T2 → T3 → T5 → T6 → T7/T8 → T9（**T2 是 T5/T6 硬前置，不与 T3 并行**）

**可并行段**：T4a-e 可并行（五个 fixture 互不依赖）；T7 与 T8 早期框架可并行（T7 等数据，T8 框架不等数据）

---

## 4. Codebase Reality Check

### eval-task-runner.mjs 状态

| 维度 | 数值 | 说明 |
|------|------|------|
| 文件 LOC | ~420 行 | 含注释、空行 |
| 公开函数数 | 9（parseArgs / loadTaskFixture / prepareWorktree / buildDriverPrompt / loadSpectraContext / buildClaudeArgs / runTask / runPrimaryOracle / assembleTaskFixture / captureProductMetrics） | 全部已测或直接可调 |
| TODO/FIXME 标记 | 0（已扫描） | 无需前置 cleanup |
| 超长函数 | assembleTaskFixture（约 60 行）— 可读，不触发 cleanup 规则 | — |
| 本次新增行估算 | +90 行（50 行 mcp-pull case + 40 行 parseMcpToolCallTrace） | 满足前置清理豁免（< 200 行增量且 LOC < 500） |

**前置 cleanup 判定**：文件 LOC 420 < 500，且本次增量 90 行，**不触发前置 cleanup 规则**。

### competitive-evaluation-report.md 状态

| 维度 | 数值 |
|------|------|
| 当前 LOC（估算） | ~200-300 行 |
| 现有章节数 | §1-§5（§6 为本次新增） |
| 本次追加 | +~150 行（§6 全章） |

**前置 cleanup 判定**：追加章节不修改现有内容，**不触发前置 cleanup 规则**。

---

## 5. Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 2（eval-task-runner.mjs + competitive-evaluation-report.md） |
| 新建文件数 | 9（2 脚本 + 6 fixture + 1 MCP config 模板） |
| 间接受影响文件 | baseline-diff.mjs（NFR-005 消费方，**T8 plan-level 必做**回归验证）；eval-report.mjs（NFR-005 消费方，**不改**，仅需读旧 fixture 不报错；§6 完全人工撰写） |
| 跨包影响 | 无（仅 scripts/ 和 specs/ 目录，未触及 src/ 或 plugins/） |
| 数据迁移 | 无（schema 1.2 新字段可 null，向后兼容 schema 1.1；现有 12 个 perf anchor fixture 不受影响） |
| API/契约变更 | NONE（eval-task-runner.mjs 新增枚举值，不修改已有接口签名；fixture schema 向后兼容） |
| **风险等级** | **LOW**（影响文件 < 10；无跨包影响；无数据迁移；无公共 API 变更） |

**HIGH 风险强制分阶段**：本次风险等级为 LOW，无需强制分阶段。三阶段切片（§1）是开发节奏安排，非风险防护门槛。

---

## 6. 验证子任务（SC 对应关系）

> **[已修订 C-07] verify 退出语义统一**：每条 SC 输出 `[SC-00N] PASS / SKIP / WARN / FAIL` 之一。退出码逻辑：`FAIL_count == 0 → exit 0`；`FAIL_count > 0 → exit 1`。SKIP 与 WARN 不计入 FAIL，但必须在 stdout 显式输出（不可静默）。spec FR-007 中"全部 PASS"修订意为"无 FAIL"；spec SC-008 "至少 6/8 PASS"修订为"FAIL_count == 0 且每条都有显式输出"。

| SC | 输出值（PASS / SKIP / WARN / FAIL） | 验证手段 | 备注 |
|----|----|---------|------|
| SC-001 | PASS：6 个 fixture 入库 + sanity ok + checks.length >= 2；FAIL：任一 fixture 缺失或 sanity FAIL | `fs.readdirSync` 计数 ≥ 4；对每个 fixture 调 `eval-task-fixture-check.mjs`；JSON.parse 验证 checks 数组 | 复用 eval-task-fixture-check.mjs [PL-004 已确认存在] |
| SC-002 | PASS：脚本存在 + --dry-run exit 0；FAIL：脚本缺失或 dry-run 非 0 | `fs.existsSync` + `execSync --dry-run` | 新建脚本 |
| SC-003 | PASS：grep 通过；FAIL：关键字未找到 | `grep -ci "mcp-pull"` > 0 且 `grep -ci "mcp-config"` > 0 | grep 检查 |
| SC-004 | PASS：mcp-pull fixture 含 mcpToolCallTrace（数组）和 w3Flag（bool）；**SKIP**：fixture 不存在（NFR-003 不入库，干净 repo 上正常）；FAIL：fixture 存在但字段错位/类型错 | 路径 `tests/baseline/tasks/T158-*/mcp-pull/full.json`（**[已修订 C-02]** mcp-pull 不是 spectra-mcp-pull）；fixture 不存在则 SKIP | [已修订 W-04] mcpToolCallTrace 在 mcp-pull cohort 是数组（可空 []）；control / spectra-push cohort 该字段为 null（不要空数组） |
| SC-005 | PASS：§6 标题 + ≥ 3 行管道 markdown 表格行 + "Limitation" 子节；FAIL：缺标题 / 缺数据行 / 缺 Limitation | grep 标题 > 0；用 `grep -c "^\\| .* \\| .* \\| .*\\|$"` 在 §6 范围内 ≥ 3；grep "## .*Limitation" > 0 | [已修订 W-06] 表格使用管道 markdown 语法 |
| SC-006 | PASS：token ratio 已量化；**SKIP**：control 组 tokensInput/Output 字段为 null（claude --print text mode 当前返回 null，是已知限制）；FAIL：MCP pull cohort 字段缺失 | 解析 `perf.tokensInput + perf.tokensOutput`；分母用 total tokens（不只 output） | [已修订 W-04] 字段位置在 perf 子对象 |
| SC-007 | PASS：累加 costUsd ≤ 50；**SKIP**：fixture 不存在（干净 repo）；WARN：部分 fixture 无 costUsd 字段 → 累加跳过；FAIL：cost > 50 | 遍历 `tests/baseline/tasks/T158-*/<cohort>/full.json`，sum `perf.costUsd`；fixture 路径不存在 → SKIP（[已修订 W-05] 干净 repo 友好） | — |
| SC-008 | PASS：上面 7 条 stdout 输出齐全 + FAIL count = 0 | 检查 stdout 含 7 行 `[SC-00N]` 输出（PASS/SKIP/WARN/FAIL 任一）；FAIL count == 0 → exit 0 | 退出码合同：见上方说明 |

**verify 脚本与 spec-review / quality-review 衔接**：全量 verify 通过后，依 CLAUDE.local.md 约定进行 Codex 对抗审查（plan phase），再进入 tasks 阶段。

---

## 7. 风险缓解（工程化处置 W-1 到 W-6 + Codex round-2 round-2 W-01 到 W-08）

### Codex round-2（针对 spec.md）的 W-1 到 W-6

| 风险 | 工程化处置 |
|------|----------|
| **W-1 统计功效不足** | [已确认] `lib/bootstrap-ci.mjs` 默认 1000 resample（CL-003）；N=6 task × N=3 重测 = 18 sample；若 CI 宽度 > 30pp，报告明确标注"统计功效不足"，不阻断 verify；lift = 0 是合法科学结论（spec §Verify 失败定义） |
| **W-2 token confound** | [已确认] 记录 `perf.tokensInput + perf.tokensOutput` 总量（不只是 output；FR-005 + SC-006）；报告 §6 量化"单位 token 对应 pass rate 增量"；对照组间 token budget 不强行对齐（反映真实场景） |
| **W-3 no tools called trap + tool mismatch** | [已确认] fixture 新增 `expectedSpectraToolCalls` 字段（CL-001 短名，endsWith 匹配）；`parseMcpToolCallTrace` 函数从 stream-json 提取 tool_use block；`w3Flag` 计算：callCount = 0 或所有 toolName 不在 expectedSpectraToolCalls → true；报告汇总 W-3-FLAGGED task 比例 |
| **W-4 oracle false positive** | [已确认] 每个 T158-* fixture 强制 `eval-task-fixture-check.mjs` sanity check（SC-001）；每个 fixture `primaryOracle.checks.length >= 2`（AND 语义，CL-002）；oracle.kind 强制 `"functional"` |
| **W-5 spectra batch 重复跑** | [已确认] worktree setup 阶段预生成 micrograd graph 一次（$0.55，~3 min）；6 个 T158-micrograd-* task 复用同一份 graph（不重复跑 batch）；T158-nanoGPT-5 单独一次 nanoGPT batch（~$0.40） |
| **W-6 oracle 多 check 缓解** | [已确认] 每个 fixture `primaryOracle.checks.length >= 2`（CL-002 AND 语义）；任一 mustPass=true check 失败即任务 FAIL；不允许 single-check oracle 通过 SC-001 验收 |

### Codex round-3（针对 plan.md）的 W-01 到 W-08

| 风险 | 工程化处置 |
|------|----------|
| **W-01 wall clock + concurrency + resume** | [已修订] T6 默认 concurrency=1（串行），可选 `--concurrency=2`；resume 通过 fixture 输出文件存在性 skip；预算 pause 在 70%（$35） |
| **W-02 W-3 trap 批边界** | [已修订] 1 batch = 1 task × 1 cohort × N=3 = 3 runs；mcp-pull cohort 单 task 中 ≥ 2/3 runs w3Flag=true 即暂停 |
| **W-03 mcp-pull 模型固定** | [已修订] 三 cohort 一律 `--model sonnet`（spec Out of Scope I-4）；plan §1 cohort 映射表明示 |
| **W-04 mcpToolCallTrace null vs []** | [已修订] mcp-pull cohort：数组（可空 []）；control / spectra-push cohort：null；w3Flag 在 control / spectra-push 也为 null |
| **W-05 干净 repo 上 SC 行为** | [已修订] SC-004 / SC-007 fixture 不存在 → SKIP（不算 FAIL）；表格已更新 |
| **W-06 §6 表格语法** | [已修订] §6 必须使用管道 markdown table 语法（`\| col \| col \|`）；SC-005 用 grep 表格行计数 |
| **W-07 .mcp.json cwd 验证** | [已修订] D-1 决策段补充：T2 spike step 4 显式验证不传 projectRoot 时 server cwd fallback 行为；失败则 fixture prompt 显式传 projectRoot |
| **W-08 eval-report.mjs 与 §6 矛盾** | [已修订] eval-report.mjs **不扩展**；§6 完全人工撰写；NFR-005 中 eval-report.mjs 消费方兼容仅指"读旧 fixture 不报错"，不要求生成 §6 |

### 预算触发点

- 预算达 70%（$35）时主动 pause，review 是否调降 N 或 task 数量（spec NFR-001）
- 成本估算分项（**[已修订 C-01]** 54 runs，按 cohort 分项）：
  - control cohort：18 runs × ~$0.10 (sonnet text mode) = $1.8
  - spec-driver-spectra cohort：18 runs × ~$0.20 (含 12KB spec.md push) = $3.6
  - mcp-pull cohort：18 runs × ~$0.40 (含 stream-json + tool call 多轮) = $7.2
  - spectra batch setup（micrograd $0.55 + nanoGPT $0.40，6 task 共享）= $0.95
  - 调试 + sanity check 缓冲 1.5x = ($1.8 + $3.6 + $7.2 + $0.95) × 1.5 = **$20.3**
  - 总估算：~$20，余量 $30（spec NFR-001 上限 $50）

---

## 8. 技术决策研究

### 决策 D-1：`projectRoot` 传入机制（PL-002）

**结论 [已确认]**：通过 tool call 参数传入（方案 B，每次调用携带可选 `projectRoot` 字段）。**`.mcp.json` 在 prepareWorktree 后由 eval-task-runner 写入 wtDir**（[已修订 W-07]），cwd 验证：claude --print 启动时 cwd = wtDir，spectra mcp-server 继承此 cwd，其 `getCachedGraphData(projectRoot ?? process.cwd())` 调用拿到 wtDir 内的 graph.json。

**理由**：MCP tool schema（tech-research.md §1.1）已确认 `impact / context / detect_changes` 均接受可选 `projectRoot: z.string().optional()`；server 无状态；`.mcp.json` 内容为 `{"mcpServers":{"spectra":{"command":"spectra","args":["mcp-server"]}}}`，server cwd 默认继承 spawn parent cwd（即 wtDir）；agent 调用时不传 projectRoot 即使用 server cwd（graph.json 在 wtDir/.spectra/ 或同等路径）。

**T2 spike PASS 条件验证 cwd 行为**：T2 spike step 4 显式不传 projectRoot 给 impact tool，期望 spectra mcp-server 自动用 cwd（wtDir）找到 graph。如 T2 失败，回退方案：fixture 中要求 agent 显式传 `projectRoot=$wtDir`（在 prompt 中告知）。

**替代方案**：方案 A（启动时 CLI 参数传入）需为每个 task 生成不同 `.mcp.json`，文件管理成本高；此 Feature 复杂度不值。

### 决策 D-2：task 数量（PL-001）

**结论 [已确认]**：锁定 **6 个**（与 US-1/US-4 的 54 次（3×6×3）计算对齐）。

**理由**：6 task × N=3 重测 = 18 sample，bootstrap CI 覆盖足够；成本在预算范围内（$18 估算）；若第 5-6 个 fixture 设计困难，可降为 5 个（不低于 spec FR-001 下限 4）。

### 决策 D-3：spectra-push cohort 的 context 来源（PL-003）

**结论 [已确认]**：push 模式注入的是 target 项目（micrograd/nanoGPT）的 spectra spec.md 分析输出，不是 F158 spec.md。

**理由**：`eval-task-runner.mjs` `spec-driver-spectra` case 已有 `loadSpectraContext(targetSpec, maxBytes=12000)` 实现（line 157）；该函数从 `~/.spectra-baselines/<target>-output/spectra-full/modules/*.spec.md` 加载，与 taskTargetFiles 相关性排序。F158 直接复用此逻辑，cohort 名映射 `spectra-push → spec-driver-spectra` tool。

### 决策 D-4：mcp-pull 对照组的 output-format

**结论 [已确认]**：使用 `--output-format stream-json --include-partial-messages`，其余对照组（control / spectra-push）保持 `--output-format text`。

**理由**：stream-json 是 W-3 trace 监控的唯一可靠来源（spike 已实证 tool_use block 在 stream-json 中可观测）；其余对照组无需 trace，text 格式更紧凑（减少 maxBuffer 消耗）。对照组间 output-format 不同不影响 pass rate 公平性（oracle 基于 git diff / pytest，不基于 stdout 格式）。

---

## 9. 与约束的兼容性检查

| 约束 | 状态 | 说明 |
|------|------|------|
| AGENTS.md：不直接改 .codex/.claude/commands | ✓ | 只改 scripts/ 和 specs/；不碰 .claude/commands |
| AGENTS.md：fixture 不入库 | ✓ | 54 次运行产物落 tests/baseline/tasks/T158-*/（.gitignore 已覆盖）；T158-*.json fixture 定义入库（specs/158-.../research/task-fixtures/） |
| CLAUDE.local.md baseline 入库边界 | ✓ | perf anchor（tests/baseline/<project>/spectra/full.json）不受影响；task fixture 不入库；competitive-evaluation-report.md 入库（Manual report） |
| CLAUDE.md：每 phase 跑 Codex review | ✓ | plan 阶段 Codex review 在本 plan commit 后立即执行 |
| NFR-004 Node-only | ✓ | 全链路 Node.js；不引入 Python / Docker；oracle 中的 pytest 是在 worktree 内 spawn bash 调用，属于 eval 流程的一部分，不是 harness 本身的 Python 依赖 |
| spec §Out of Scope I-2 docker harness 排除 | ✓ | Task fixture 设计为简化版（非 SWE-Bench 官方 docker harness）；oracle 是自定义 pytest / shell 命令，不依赖 SWE-bench 官方 grading 服务 |

---

## 10. Complexity Tracking

| 决策 | 选择 | 偏离"更简单方案"的理由 |
|------|------|----------------------|
| mcp-pull cohort 使用 stream-json 而非 text format | stream-json | W-3 trace 监控需要 tool_use block；text format 无法观测 |
| fixture `expectedSpectraToolCalls` 字段使用短名而非全限定名 | 短名 + endsWith 匹配 | 人类可读性优先；endsWith 匹配对三个唯一后缀无误判风险（CL-001） |
| oracle 多 check AND 语义 | AND（全部 mustPass 须通过） | W-6 缓解：比 OR 更严格，防止 patch 通过一个 check 但破坏另一个场景 |
| spectra batch 只跑一次（6 task 共享 graph） | 共享 graph | W-5 成本控制：$0.55 vs $0.55×6 = $3.3；graph 在 startCommit 层面不变，安全共享 |
| §6 报告人工撰写而非 eval-report.mjs 自动生成 | 人工撰写 | §6 是科学结论章节（含归因判断），不适合机器自动生成（spec §歧义处置 AUTO-RESOLVED） |
