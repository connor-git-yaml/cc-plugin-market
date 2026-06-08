---
feature: 176
title: SWE-Bench Verified 5-cohort 横向对比 — 任务清单
branch: claude/suspicious-sinoussi-d41c88
created: 2026-06-08
status: Draft
phase: tasks
---

# Feature 176 — 任务清单

> **⚠️ implement 阶段必读硬约束**
> 1. **spike-first 硬 gate**：`T-B1` 未 PASS（证明 `--print` sub-agent 能调 `mcp__plugin_spectra_spectra__*`）**不得**进入 Phase C-F 的全量路径；失败走 spec FR-A-007c 升级用户拍板。
> 2. **不碰 `src/`**：所有改动在 `scripts/` + `specs/176/` + `tests/baseline/swe-bench-verified/`（fixture 不入库）。工具问题只记 `verification/m8-fix-candidates.md`（KD-6）。
> 3. **凭据**：driver=claude-opus-4-7（Claude Max OAuth）；judge=opus+GLM(SiliconFlow)+Kimi(SiliconFlow)。不用 codex。
> 4. **交付边界**：我搭 harness + 本地能验证的都验证；spike/smoke/full 150 runs 由 **host shell** 执行（需 claude OAuth），我从结果写报告。

> **🔒 sandbox / host 交接合同（codex CRITICAL C-3 — 防 implement 假装 gate PASS）**
> 每个 host-only gate 任务 MUST 拆成两部分，且 sandbox 侧**不得**用 synthetic 结果冒充 host 产物：
> - **[sandbox]**：脚本实现 + dry-run + 单测 + 路径/版本门禁等可本地验证项 → 我交付。
> - **[host]**：需 claude OAuth 的真实执行（spike/smoke/full）→ host 跑，回传规定 schema 的 artifact（`spike-result.md` / smoke fixtures / `aggregate/*.json`），我据此判 PASS 并写报告。
> - artifact schema / 路径 / PASS 条件在对应任务 DoD 里写死；`verify-feature-176.mjs`（T-F3）**默认拒绝 synthetic 结果**（仅 `--test-mode` 显式允许合成 fixture 自测脚本逻辑，不计入真实验收）。

**输入制品**：spec.md + plan.md + verification/codex-review-{spec,plan}-phase.md
**关键串行路径**：T-A1 → T-A2 → T-A4(build+版本门禁) → T-A5(spike 输入) → **T-B1 spike(GATE)** → T-C1 → T-C2 → T-C3 → T-D* → T-E1 → T-E2(runbook) → host 跑 spike→smoke→full → T-F1 → T-F2 → T-F3(verify)
**可并行**：T-A2/T-A3（importer 与预注册）、T-D1~T-D5（护栏各自独立文件）、T-F1 报告骨架与 T-F3 verify 脚手架
**总任务数**：19（含 T-A5 spike 输入准备）

---

## Phase A — 数据集 / 路径 / 版本门禁地基（G1 + build 前置）

### T-A1 [P] 路径常量 shared module
- **FR/SC**：FR-A-006（统一路径，codex WARNING）
- **文件**：新增 `scripts/lib/swe-bench-verified-paths.mjs` — 导出 `VERIFIED_ROOT='tests/baseline/swe-bench-verified'`、`runFixturePath(task,cohort,r)`、`aggregateDir()`、`fixturesDir()`。
- **DoD**（W-4 强化，弃弱 grep）：单测 `tests/lib/swe-bench-verified-paths.test.ts` 验路径拼接 + repeatIndex；importer/batch/report/verify 四文件**逐个**断言 `import ... swe-bench-verified-paths`（具名 import 检查，非 grep 计数）；**负向扫描**：这四文件内无硬编码 `tests/baseline/swe-bench-verified` 字面量残留（全走常量）。

### T-A2 Verified 数据集 importer
- **FR/SC**：FR-A-002
- **文件**：新增 `scripts/swe-bench-verified-fixture-import.py`（复制 Lite importer，dataset→`princeton-nlp/SWE-bench_Verified`，输出 `fixturesDir()`，schema 与 Lite 对齐：prompt/target/startCommit/primaryOracle/goldpatch）。保留可解性筛选 + 退化策略 + `_DEGRADATION_NOTE.md` + 泄漏增量风险。
- **DoD**：
  - [sandbox] `--dry-run` 列出 ≥10 候选 task id（不下载）；importer schema 单测；fixtures 目录在 `.gitignore`。
  - [host] 真实 import 产 ≥10 fixture + goldpatch.diff，且 **oracle 可执行性 smoke（C-1）**：对 ≥3 个导入 task prepare wtDir + 装依赖 + 跑 `runPrimaryOracle`（应用 goldpatch 后 FAIL_TO_PASS 测试转绿），实测可跑通比例须 ≥ 阈值（如 ≥8/10），否则**不允许冻结预注册（T-A3）**——避免全量大量 `ORACLE-UNAVAILABLE` 致 pass rate 分母失真。

### T-A3 [P] 预注册冻结
- **FR/SC**：FR-A-002b（防 falsification 规避）
- **文件**：新增 `specs/176/verification/preregistration.md`（入库）— 10 task id + 筛选规则(repos/min-date/max-patch-files) + seed + 冻结时 git commit + task 集 hash。新增 `scripts/lib/preregistration-check.mjs` 校验 batch 跑的 task 集 hash == 预注册。
- **DoD**：preregistration.md 含 10 个具体 task id + hash；batch 启动调 check，不一致 hard-fail。

### T-A4 build dist + 版本门禁 lib
- **FR/SC**：FR-A-004b、SC-001b（版本门禁可证伪）
- **文件**：新增 `scripts/lib/spectra-version-gate.mjs` — 输入 `dist/cli/index.js`，校验含 F177-F181（探测：`node dist/cli/index.js --version` ≥ 最小版本 / F177 统一响应契约 marker / F181 单一 import-resolver 运行时特征 / build source commit 是 master 含 F177-F181 的祖先链成员），记录 source commit + tree-dirty，**失败 hard-fail**。
- **DoD**：`npm run build` 后正向用例 PASS；负向用例（指向旧 dist/伪造 stale）被挡下；门禁输出含 source commit + dirty 状态。

### T-A5 spike 输入准备（最小 target + wtDir + spectra graph）
- **FR/SC**：FR-A-007b 的输入前置（codex C-2）
- **文件**：新增 `scripts/lib/spike-fixture-prep.mjs` — 选定最小 target（如 self-dogfood 子集或一个 micro repo + 1 个琐碎可解 task），prepareWorktree → `runSpectraBatchInWorktree`(code-only) 生成 `specs/_meta/graph.json`。
- **DoD**：[sandbox] graph.json 生成成功 + 可被 spectra MCP `context`/`impact` 查询返回非空（用本地 dist mcp-server dry 调一次）。让 T-B1 spike 失败时能干净归因（输入已就绪 vs plugin-MCP 不传播）。
- **依赖**：T-A4（dist + 版本门禁）。

---

## Phase B — cohort 3 wiring spike（G0 — 硬 GATE）

### T-B1 spike：非交互 sub-agent plugin-MCP 连通性（host 跑，GATE）
- **FR/SC**：FR-A-007b（最高技术风险前置验证）
- **文件**：新增 `scripts/spike-cohort3-plugin-mcp.mjs` — 在 1 个临时 wtDir（含 spectra graph）以 `claude --print --model claude-opus-4-7 --output-format stream-json --plugin-dir <spectra-built> --plugin-dir <spec-driver-4.1.0>` 跑一个最小 spec-driver workflow 任务，解析 stream-json 断言出现 ≥1 个 `mcp__plugin_spectra_spectra__*` tool_use。
- **DoD**：
  - [sandbox] spike 脚本实现 + dry-run（mock stream-json 走通解析逻辑）+ 单测（喂含/不含 plugin-namespace tool_use 的样例，断言判定正确）。
  - [host] 真实跑：PASS = 检测到 ≥1 个 `mcp__plugin_spectra_spectra__*` tool_use → 写 `verification/spike-result.md`（schema：`{status: PASS|FAIL, pluginMcpCallCount, stdoutSample, claudeVersion, rootCause?}`）PASS，解锁 Phase C。**FAIL** → spike-result FAIL + 根因（harness flag 缺失 vs 产品不传播）→ **停在 spec FR-A-007c 升级用户**，不强推后续。
  - synthetic spike-result **不算** PASS（C-3 交接合同）。
- **依赖**：T-A4（版本门禁）+ **T-A5（spike 输入就绪）**。本地无 claude OAuth → 交 host runbook 第一步执行。

---

## Phase C — cohort 3 派发集成（G2，依赖 T-B1 PASS）

### T-C1 SUPPORTED_TOOLS + buildDriverPrompt + buildClaudeArgs(cohort3)
- **FR/SC**：FR-A-003、FR-A-003b、KD-7
- **文件**：`scripts/eval-task-runner.mjs` — (1) `SUPPORTED_TOOLS` 加 `'spec-driver-spectra-mcp'`；(2) buildDriverPrompt 复用 spec-driver 主体（不注入 spec.md context）；(3) buildClaudeArgs 新分支：`--model claude-opus-4-7` + `--output-format stream-json` + 双 `--plugin-dir` + allowedTools 含 `mcp__plugin_spectra_spectra__*`；(4) 保存 effective prompt + hash（FR-A-003b 审计）。
- **DoD**：单测断言 cohort3 args 含 opus-4-7 + stream-json + 双 plugin-dir + plugin-namespace allowedTools；prompt hash 落盘。

### T-C2 mcp trace 解析扩展 plugin namespace
- **FR/SC**：FR-A-005、SC-002
- **文件**：`scripts/eval-task-runner.mjs::parseMcpToolCallTrace` — prefix 匹配 `mcp__spectra__*` ∪ `mcp__plugin_spectra_spectra__*`，callCount 合计；callCount=0 标 `W-3-FLAGGED`。
- **DoD**：单测喂 plugin-namespace tool_use 的 stream-json fixture，断言 callCount 正确 + 两种 prefix 都计入。

### T-C3 token 采集（参数化 outputFormat，**不破坏既有 Lite eval**）
- **FR/SC**：FR-B-003a、KD-7
- **文件**：`scripts/eval-task-runner.mjs` — **不全局翻转**（buildClaudeArgs 被 F158/F170c/F170d + 4 单测共用）。改为 `buildClaudeArgs` 增 `outputFormat` 入参，**默认 `'text'`（保既有行为）**；F176 batch 显式传 `'stream-json'`（+ --verbose）。所有 cohort 跑后调 `parseStreamJsonUsage` 取 token；缺失标 `TOKENS-UNAVAILABLE`。
- **DoD**（W-1 回归隔离）：
  - 新单测断言 F176 五 cohort（传 stream-json 时）args 含 stream-json；token 解析非 null（有 usage 时）。
  - **回归**：既有 `tests/unit/eval-task-runner.test.ts` / `eval-mcp-augmented-prompt.test.ts` / `eval-mcp-classic-cohort.test.ts` / `feature-170d-harness.test.ts` 不传 outputFormat 时仍走 text、全绿（`npx vitest run` 零失败）。

---

## Phase D — 完整性护栏（G3，T-D* 可并行）

### T-D1 [P] repeat 隔离（repeatIndex 入 worktree+fixture 路径）
- **FR/SC**：FR-A-006、FR-A-006b
- **文件**：`eval-task-runner.mjs::prepareWorktree` 加 `repeatIndex` → wtDir `…/<task>/<cohort>/r<i>`；fixture 写 `runFixturePath()`（T-A1）。
- **DoD**：单测 3 repeat 得 3 个独立 wtDir；验证无共享 dirty state。

### T-D2 [P] oracle 主 + jury 叠加分离
- **FR/SC**：FR-A-001b、KD-2
- **文件**：finalize 流程（`eval-task-finalize.mjs` 或 batch 内）：`runPrimaryOracle.passed`=真值写 fixture；jury 仅写 `juryScores`；`ORACLE-UNAVAILABLE` 标记 + 从分母剔除逻辑。
- **DoD**：单测：jury 全判 pass 但 oracle fail → run 记 fail；oracle 不可跑 → ORACLE-UNAVAILABLE 不计入分母。

### T-D3 [P] judge blinding
- **FR/SC**：FR-A-008b
- **文件**：jury 调用前用 `anonymizeFixture` 隐藏 cohort/tool/repeat/mcp trace，记 blinding hash。
- **DoD**：单测断言 judge 输入不含 cohort/tool 字面量；blinding hash 落 fixture。

### T-D4 [P] 配额检查点
- **FR/SC**：FR-A-009、INFO（非交互默认）
- **文件**：batch 内每 6 runs 查配额；`--on-quota=pause`(默认,写 resume checkpoint)/`split-days`/`--interactive-quota`。
- **DoD**：单测 mock 配额 ≥60% → 默认 pause 写 checkpoint 退出（非交互）。

### T-D5 [P] cross-cohort 聚合（oracle pass rate + bootstrap CI + token + lift + c3_vs_c4）
- **FR/SC**：FR-B-001/002/003/004、SC-003、**SC-004**
- **文件**：新增 `scripts/lib/cohort-aggregate.mjs` — 复用 eval-batch-repeat 的 bootstrap CI；算 per-cohort oracle passRate+CI95、`lift=c3/c1`、**`c3_vs_c4`（c3 与 cohort4 aggregate 比较 + CI 重叠/差值，对应 SC-004）**、token-per-completed-task、fixture-by-fixture 表。
- **DoD**：单测喂合成 fixture，断言 passRate/CI/lift/**c3_vs_c4**/token 计算正确；只读 oracleResult（不读 jury）；`ORACLE-UNAVAILABLE`/`TOKENS-UNAVAILABLE` 正确剔除出对应分母。

---

## Phase E — 批跑编排 + host runbook（G4）

### T-E1 batch 编排脚本（smoke/full）
- **FR/SC**：FR-A-006/007、FR-A-007c、KD-5
- **文件**：新增 `scripts/swe-bench-verified-cohort-batch.mjs`（复用 eval-batch-repeat N-repeat 内核）：入口校验（spike-result PASS + 版本门禁 + 预注册 hash + 凭据 preflight SILICONFLOW+claude）；`--smoke`(5×1×1) 断言 5/5 success + cohort3 mcpCallCount>0；`--full`(150) + 配额检查点 + `--resume`。
- **DoD**：`--dry-run` 列计划不调 LLM；入口任一校验失败 hard-fail（含负向用例）。

### T-E2 host runbook
- **FR/SC**：KD-5（干净交接）
- **文件**：新增 `specs/176/verification/host-runbook.md`（入库）— host shell 逐步：build → 版本门禁 → 凭据 verify(3 项) → import → preregister → **spike(T-B1)** → smoke → full（含 resume/split-days）→ report。每步可复制命令 + 期望输出 + 失败处置（spike FAIL→FR-A-007c）。
- **DoD**：runbook 每命令可直接粘贴；含配额 ≥60% 的分日策略；含 spike FAIL 升级路径。

---

## Phase F — 报告 + 验收（G5）

### T-F1 [P] 报告骨架（PUBLISH-REPORT-M7 + §11 + dogfooding）
- **FR/SC**：FR-C-001..C-009、**FR-D-001/002**、SC-005/006/007
- **文件**：新增 `specs/147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md`（FR-C-001，入库骨架，结果待 host 跑后填）+ `PUBLISH-REPORT.md §11` M7 章节（FR-C-002）。含全部锚点段（口径依 report-anchors.md）+ leakage 背景 + Serena peer + drift 定性栏 + Codex 两模型分类 + falsification §10.6 + token-per-completed-task + **Dogfooding 工具反馈四维度节（FR-D-001/002：Spec Driver / Spectra MCP × 可用性/信息完整性/流程顺畅度/结果准确性，未遇写"无"）**。
- **DoD**：
  - 两文件均存在（FR-C-001：`PUBLISH-REPORT-M7.md`；FR-C-002：`PUBLISH-REPORT.md` 含 `## §11`/M7 锚标题）——verify 逐个断言。
  - 骨架含 FR-C-003..C-009 全部小节标题 + 锚点占位（含正确口径）+ FR-D 四维度小节；待结果处标 `<!-- TODO: host 结果 -->`。

### T-F2 [P] 禁用词 checklist + m8-fix-candidates 模板
- **FR/SC**：SC-006/007
- **文件**：新增 `verification/forbidden-claims-checklist.md`（禁用词表 + 扫描规则）+ `verification/m8-fix-candidates.md`（dogfooding 四维度模板：可用性/信息完整性/流程顺畅度/结果准确性）。
- **DoD**：禁用词表 ≥8 词；扫描脚本对报告草稿可跑；m8 模板四维度齐。

### T-F3 verify-feature-176.mjs
- **FR/SC**：SC-001..008 全覆盖
- **文件**：新增 `scripts/verify-feature-176.mjs`（仿 verify-feature-158）：逐条断言 SC-001(smoke 5/5)、SC-001b(版本门禁负向)、SC-002(mcp≥2)、SC-003(oracle-only passRate+预注册一致+falsification 段存在)、SC-004(c3≥c4 aggregate)、SC-005(报告+§11+锚点口径)、SC-006(m8-candidates 非空)、SC-007(禁用词扫描=0/带限定)、SC-008(fixture 未入库 git status)。
- **DoD**：
  - [sandbox] `--test-mode` 下喂合成 fixture 可跑出逐条 PASS/FAIL（仅自测脚本逻辑）；fixture 未入库断言用 `git status --porcelain`。
  - **真实验收（非 --test-mode）MUST 拒绝 synthetic 结果**（C-3）：检测 spike-result/smoke/aggregate 是否为真实 host 产物（schema + 来源标记），合成则判 FAIL，杜绝 implement 假装 gate PASS。

---

## 与 SC 映射总表

| SC | 任务 |
|----|------|
| SC-001 / 001b | T-E1(smoke) / T-A4(版本门禁) |
| SC-002 | T-C2(trace) |
| SC-003 | T-D2(oracle) + T-D5(lift) + T-A3(预注册) + T-F1(falsification 段) |
| SC-004 | T-D5(c3_vs_c4) |
| SC-005 | T-F1(报告 FR-C-001/002) |
| SC-006 | T-F2(m8-candidates) + T-F1(FR-D 四维度节) |
| SC-007 | T-F2(禁用词) |
| SC-008 | T-F3(git status, 拒 synthetic) |
| FR-A-007b/c | T-A5(spike 输入) + T-B1(spike gate + 升级) |
| FR-D-001/002/003 | T-F1(四维度反馈节) + T-F2(m8-candidates) |
| 总任务数 | **19**（新增 T-A5）|
