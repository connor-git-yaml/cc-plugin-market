---
feature_id: 187
artifact: tasks
created: 2026-06-14
plan_version: "1.0"
---

# Tasks: F187 评测设施 v2 — FAIL_TO_PASS Oracle

**Input**: `specs/187-eval-harness-v2-failtopass-oracle/`（spec.md + plan.md + data-model.md + verification/codex-review-plan.md）
**测试策略**: TDD（每个 lib 任务先写测试、确认失败、再实现）；默认跑测试 vs opt-in smoke（`RUN_SWEBENCH_SMOKE=1`）明确分离

## 格式说明

- `[P]`：可并行（不同文件，无依赖关系）
- `[US1..US6]`：所属 User Story
- `[BLOCKING]`：Phase 0 阻断 gate，结果决定后续方案 A/B
- 任务粒度：0.5–1 天，独立可验证
- SC 编号（SC-001~SC-016）、Edge Case（E-01~E-13）、Codex 条目（C-1~C-6）作为验收锚点

---

## Phase 0：数据源可行性 Hard Gate（BLOCKING，先于一切编码）

**目的**：验证本地 JSONL dataset 能被 `swebench.harness.run_evaluation` 接受（方案 A），否则切方案 B（HF revision + 逐字段比对）。Phase 0 阻断后续所有 Phase，结果直接决定 freezeBlock 字段和 FR-001-f 实现路径。

**⚠️ BLOCKING**：Phase 0 全部完成并有明确 A/B 裁定后，才可开始 Phase A 及以后任务。

- [ ] T001 新建 `scripts/setup-swebench-venv.sh`：检测 python3.11/python3.12，创建 `scripts/.swebench-venv/`，`pip install swebench`；脚本幂等可重复跑；验收：`scripts/.swebench-venv/bin/python -m swebench.harness.run_evaluation --help` 无报错（C-4；文件：`scripts/setup-swebench-venv.sh`）

- [ ] T002 新建 `scripts/lib/swebench-dataset-build.mjs`：从 fixture 的 `swebenchMeta`（failToPass / passToPass / testPatch / goldPatch / baseCommit / instanceId）合成单行本地 dataset JSONL；接受 `--fixture <glob>` + `--out <path>` 参数；验收：对 `tests/baseline/swe-bench-lite/fixtures/SWE-L003-*.json` 运行，产出 `/tmp/swe-l003.jsonl`，格式有效（C-4；文件：`scripts/lib/swebench-dataset-build.mjs`）

- [ ] T003 **[BLOCKING] Phase 0 真跑验证**：用 T001 venv + T002 产出 JSONL 执行端到端验证命令（见 plan Decision 1 框体），断言 harness 接受本地路径且 `report.json` 含 `resolved` 字段；记录：实测 log marker 文本（用于更新 phase-markers.mjs 常量）+ 是否接受本地 JSONL；产出决策文档 `specs/187-eval-harness-v2-failtopass-oracle/verification/phase0-gate-result.md`（方案 A 通过/失败 + 依据），存档供后续 Phase A 参考（C-4；验收：SC-014 的 W1 不变量可闭合，决策文件存在）

**Phase 0 Checkpoint**：`phase0-gate-result.md` 存在 + 方案（A 或 B）已确认 → 解锁 Phase A

---

## Phase A：核心 lib 层（P1 前置依赖，纯函数，无 docker）

**目的**：建立无外部依赖的纯函数 lib 层，可独立 merge 验证。所有测试默认跑，无需 docker。

**独立测试**：`npx vitest run tests/unit/feature-187-*.test.ts`（含 Phase A 新增测试文件）全绿

### A1：phase-markers（C-3、C-6 落地）

- [ ] T004 **[先写测试]** 新建 `tests/unit/feature-187-phase-markers.test.ts`：覆盖每个 log marker → 期望 phase 映射；阶段单调前进（不回退）；缺失 marker 但 log 含 `pytest`/`OOMKilled`/test node id 证据 → `test_exec`；无任何证据 → `unknown` + 告警标记；确认测试**失败**（C-3、C-6；文件：`tests/unit/feature-187-phase-markers.test.ts`）

- [ ] T005 新建 `scripts/lib/phase-markers.mjs`：log marker 常量表（基于 Phase 0 T003 实测 marker 更新）+ 纯函数 `parsePhaseFromLog(logText: string) → {phaseReached, phaseMarkerMatched, phaseEvidence}`；evidence-based 判定：有 pytest/OOM 证据 → `test_exec`；真无证据 → `unknown` + 告警（C-3、C-6；验收：T004 测试全绿；文件：`scripts/lib/phase-markers.mjs`）

### A2：classify-oracle（SC-002~004、C-1 落地）

- [ ] T006 **[先写测试]** 新建 `tests/unit/feature-187-classify-oracle.test.ts`：表驱动覆盖 14 行决策表 + fallback（exitCode 125/126/127/139、SIGSEGV/SIGKILL/SIGTERM、timedOut×phaseReached 前/后、OOMKilled、pytest exit 2/3/4/5、completed=false、resolved true/false、report 缺失、未知 fallback）；每行至少一个 mock case；确认测试**失败**（SC-002~004；文件：`tests/unit/feature-187-classify-oracle.test.ts`）

- [ ] T007 新建 `scripts/lib/classify-oracle.mjs`：实现 `classifySwebenchResult({exitCode, signal, timedOut, phaseReached, logText, report}) → {classification, failureSource}`；穷尽式 14 行决策表 + fallback；不依赖 details 字段；fallback 必须 log 原始信号（SC-002~004；验收：T006 测试全绿；文件：`scripts/lib/classify-oracle.mjs`）

### A3：ranking classifier（C-1 落地）

- [ ] T008 **[先写测试]** 新建 `tests/unit/feature-187-ranking.test.ts`：断言 `classifyRunForRanking`：`pass→true`、`fail→false`、`error→null`、`unavailable→null`；模拟 `:289` 行为：error 不计入 fail 分母（SC-003；C-1；文件：`tests/unit/feature-187-ranking.test.ts`）

- [ ] T009 在 `scripts/lib/classify-oracle.mjs` 追加导出 `classifyRunForRanking(primaryOracle) → true | false | null`（pass→true / fail→false / error→null / unavailable→null）；同时把 `swe-bench-verified-cohort-batch.mjs` 中 `classifyOracle`（行 179-193）重命名为 `classifyLegacyOracle` 保留旧签名，仅服务 legacy 路径（C-1；验收：T008 测试全绿；文件：`scripts/lib/classify-oracle.mjs`、`scripts/swe-bench-verified-cohort-batch.mjs`）

### A4：cohort-registry（SC-007~008、SC-013 落地）

- [ ] T010 **[先写测试]** 新建 `tests/unit/feature-187-cohort-registry.test.ts`：① registry 派生 `COHORT_IDS`/`COHORT_TO_TOOL` 正确性；② 无 `promptBuilder` 的 cohort 调用 `buildDriverPrompt` → throw 含 cohort id（SC-007）；③ 正确注册 cohort 返回正确 prompt；④ 竞品 cohort（graphify/aider/superpowers/gstack）golden 测试：promptBuilder/claudeArgsProfile 逐字等价（SC-013）；确认测试**失败**（SC-007、SC-008、SC-013；文件：`tests/unit/feature-187-cohort-registry.test.ts`）

- [ ] T011 新建 `scripts/lib/cohort-registry.mjs`：声明 5 个 cohort（baseline-claude + 4 个竞品），每个含 `{id, tool, promptBuilder, claudeArgsProfile, prepSteps, stdinPolicy}`；导出 `REGISTRY`、`COHORT_IDS`、`COHORT_TO_TOOL`；竞品 cohort promptBuilder 从 `swe-bench-verified-cohort-batch.mjs` 逐字迁入（SC-008、SC-013；验收：T010 测试全绿；文件：`scripts/lib/cohort-registry.mjs`）

### A5：preregistration-check 扩展（SC-009、C-2 落地）

- [ ] T012 **[先写测试]** 新建 `tests/unit/feature-187-freeze-block.test.ts`：① `oracleSpecHash` 覆盖 3 个语义模块（classify-oracle.mjs + phase-markers.mjs + swebench-oracle.mjs 内容 sha256）；② 改任一模块文件内容 → 重算 hash 必须变化（C-2 关键断言）；③ `fixtureContentHash` 计算正确；④ `schemaVersion = "1.0"`；⑤ `checkPreregistration` swebench-execution 缺 oracleSpecHash → hard-fail；非 swebench-execution 缺 oracleSpecHash → warn（SC-009、C-2；文件：`tests/unit/feature-187-freeze-block.test.ts`）

- [ ] T013 扩展 `scripts/lib/preregistration-check.mjs`（+60 行）：新增字段计算（oracleSpecHash 覆盖 3 模块 sha256 + stableStringify 按字母序 sort key + 固定 `\n` + UTF-8 sha256 hex；fixtureContentHash；promptSha256；schemaVersion="1.0"；datasetSourceDigest/datasetHFRevision）；`checkPreregistration` 新签名 `checkPreregistration(taskIds, PREREG, {oracleKind, oracleSpecInput, manifest})`；swebench-execution 缺 oracleSpecHash → hard-fail；其他 kind → warn（SC-009、C-2、C-5；验收：T012 测试全绿；文件：`scripts/lib/preregistration-check.mjs`）

### A6：fake-subprocess 全链路集成测试（C-6 落地）

- [ ] T014 **[先写测试]** 新建 `tests/unit/feature-187-oracle-pipeline.test.ts`（默认跑，不依赖 docker）：用预录 stdout/stderr/log 夹具喂 `parsePhaseFromLog` + `classifySwebenchResult` 全链路，覆盖：① "marker 后 timedOut → fail/candidate"；② "无 marker 有 pytest evidence → fail/candidate + 告警"；③ "无任何 evidence → unknown 告警"；④ "image 阶段 timeout → error/infra"（C-6；SC-004；文件：`tests/unit/feature-187-oracle-pipeline.test.ts`）

**Phase A Checkpoint**：`npx vitest run tests/unit/feature-187-phase-markers.test.ts tests/unit/feature-187-classify-oracle.test.ts tests/unit/feature-187-ranking.test.ts tests/unit/feature-187-cohort-registry.test.ts tests/unit/feature-187-freeze-block.test.ts tests/unit/feature-187-oracle-pipeline.test.ts` 全绿 → 解锁 Phase B

---

## Phase B：swebench Oracle Runner（P1 核心）

**目的**：新建 `swebench-oracle.mjs`，接入 `eval-task-runner.mjs`，提供 smoke 测试入口。依赖 Phase A 的 phase-markers 和 classify-oracle。

**独立测试**：`RUN_SWEBENCH_SMOKE=1 npx vitest run tests/unit/feature-187-swebench-oracle.test.ts`（SWE-L003 单实例，需 docker）

### B1：swebench-oracle lib（SC-001、SC-011、E-01~E-05 落地）

- [ ] T015 **[先写测试]** 新建 `tests/unit/feature-187-patch-persistence.test.ts`（默认跑，mock fs）：① 写盘失败 → cleanup 未调用 + worktree 保留（SC-012，E-07）；② 原子 rename（temp file + rename）；③ `extractDiff` 优先读 `patch.diff`（SC-006）；④ `assembleTaskFixture` 写完整 `OracleResult`（含 classification / failureSource / phaseReached / exitCode / signal / timedOut / stdoutTail / stderrTail）不截断（C-5）；确认测试**失败**（SC-006、SC-012；文件：`tests/unit/feature-187-patch-persistence.test.ts`）

- [ ] T016 新建 `scripts/lib/swebench-oracle.mjs`（~250 行）：导出 `runSwebenchInstance({instanceId, candidatePatch, swebenchMeta, artifactsDir, runId, timeoutMs, venvPath})`；实现 ① predictions JSONL 构造（model_patch = candidatePatch，记录 candidatePatchSha，严禁 goldPatch 混入常规路径，FR-001-e）；② spawnSync 调用 `python -m swebench.harness.run_evaluation`（保持同步，C-5）；③ 解析 stdout/stderr/log → 调用 `parsePhaseFromLog`；④ 读 report.json；⑤ 调用 `classifySwebenchResult` 得 classification；⑥ arm64 fallback（docker manifest inspect + `--platform linux/amd64`，E-01）；⑦ SIGSEGV 重试一次（E-02）；⑧ timeout 后清理可能残留 docker 容器（`docker rm -f` by run_id label）；⑨ 返回完整 OracleResult（C-5；SC-001、SC-011；验收：T015 测试全绿；文件：`scripts/lib/swebench-oracle.mjs`）

### B2：eval-task-runner.mjs 集成（C-5 落地）

- [ ] T017 改动 `scripts/eval-task-runner.mjs`（+30 行，不改同步签名，C-5）：① `runPrimaryOracle` 新增 `swebench-execution` 分支，调用 `runSwebenchInstance`（保持 export function 同步，**7 处调用方一律不改**）；② `buildDriverPrompt` default 分支从 return 改为 throw（FR-004-a）；③ `SUPPORTED_TOOLS` 新增 `swebench-execution` 种类标识；④ `assembleTaskFixture:741` 改写为完整 OracleResult 不截断（含 secondaryOracle 字段并列，C-5，FR-001-c）（SC-001、C-5；文件：`scripts/eval-task-runner.mjs`）

### B3：smoke 测试（opt-in，默认 skip）

- [ ] T018 新建 `tests/unit/feature-187-swebench-oracle.test.ts`（`RUN_SWEBENCH_SMOKE=1` gate，默认 skip）：用 `describe.skipIf(!process.env.RUN_SWEBENCH_SMOKE)` gate；断言 SWE-L003 真实执行 + OracleResult 结构完整 + marker 命中率 + `details.failToPassExecuted` 与 fixture 一致（SC-001、SC-005、SC-011、SC-014）（文件：`tests/unit/feature-187-swebench-oracle.test.ts`）

**Phase B Checkpoint**：① 默认跑测试全绿（T015 patch-persistence）；② `RUN_SWEBENCH_SMOKE=1 npx vitest run tests/unit/feature-187-swebench-oracle.test.ts` SWE-L003 可执行（smoke 可选，但需本地验证一次）

---

## Phase C：上游脚本迁移 + jury 改动

**目的**：将 cohort-batch、cohort-aggregate、eval-judge-jury 切换到 lib 层，完成 6 处 cohort 散布配置归一，patch 持久化，freezeBlock 重冻结。

**独立测试**：`npx vitest run tests/unit/feature-176-*.test.ts tests/unit/feature-187-*.test.ts` 全绿（F176 测试不回退）

### C1：cohort-batch 改动（SC-008、SC-013、C-1 落地）

- [ ] T019 改动 `scripts/swe-bench-verified-cohort-batch.mjs`（+50 行）：① 旧 `classifyOracle` 已在 T009 重命名为 `classifyLegacyOracle`，此处在 `swebench-execution` 排名路径调用新 `classifyRunForRanking`，修 `:289` 行为（error → null，剔除分母，C-1）；② `COHORT_TO_TOOL` / `COHORT_IDS` 改从 cohort-registry 派生；③ runner 固定参数（model / outputFormat / stdinPolicy）从 registry 各 cohort 的 `claudeArgsProfile` / `stdinPolicy` 读取；④ `checkPreregistration` 调用扩展为 `checkPreregistration(taskIds, PREREG, {oracleKind, oracleSpecInput, manifest})`（C-5）（SC-008、C-1、C-5；文件：`scripts/swe-bench-verified-cohort-batch.mjs`）

- [ ] T020 改动 `scripts/lib/cohort-aggregate.mjs`：`COHORT_IDS` 改从 cohort-registry 导入，删除原 hardcode 常量（SC-008；文件：`scripts/lib/cohort-aggregate.mjs`）

- [ ] T021 更新 `tests/unit/feature-176-batch.test.ts`：把直接测 `classifyOracle` 的用例改为测 `classifyLegacyOracle`（保留旧语义），新增 F187 用例覆盖 `phaseReached='test_exec' && timedOut → fail`（Q1）和 `classification='error' → ranking=null`（C-1）；确保 F176 测试全绿（C-1；文件：`tests/unit/feature-176-batch.test.ts`）

### C2：patch 持久化实现（SC-005~006、SC-012 落地）

- [ ] T022 在 `scripts/eval-task-runner.mjs` 补全 patch 持久化逻辑（写盘与 cleanup 顺序保障）：run 完成后按 spec 顺序 ① 原子写 stdout.log + stderr.log（所有 run）；② 仅 PASS 原子写 patch.diff；③ 写入成功后执行 cleanup；④ 写入失败不执行 cleanup + 记录错误（SC-005、SC-012、E-07；文件：`scripts/eval-task-runner.mjs`）

### C3：eval-judge-jury extractDiff 改动（SC-006 落地）

- [ ] T023 改动 `scripts/eval-judge-jury.mjs`（+15 行）：`extractDiff` 函数新增第一优先检查：若 `<run_artifacts_dir>/<run_id>/patch.diff` 存在则优先读取；不存在时回退 wtDir git diff；再回退 diffStat（SC-006、FR-003-a；文件：`scripts/eval-judge-jury.mjs`）

### C4：manifest loader（FR-006，P3，可推后）

> **注**：FR-006 为 P3（SHOULD），与 P1/P2 核心无硬依赖。GATE_TASKS 决策：如时间紧张可将 T024~T025 推后独立交付。

- [ ] T024 [P3] 在 `scripts/swe-bench-verified-cohort-batch.mjs` 新增 `loadExperimentManifest(manifestPath)` 函数（约 30 行，inline，YAGNI 不单独建 lib）：读 YAML manifest，覆盖 model / outputFormat / cleanup / repeat / skipJury / quotaCheckInterval / swebench.timeoutMs / swebench.venvPath；字段缺失时保留现有默认值（FR-006-a；文件：`scripts/swe-bench-verified-cohort-batch.mjs`）

- [ ] T025 [P3] CLI 参数 `--manifest <path>` 接入 `scripts/swe-bench-verified-cohort-batch.mjs`，与 `loadExperimentManifest` 联动；添加 mock 单测（参数覆盖、字段缺失回退默认值、manifest 不存在报错）（FR-006；SC 无直接编号，验收：manifest repeat/skipJury 参数读取正确；文件：`scripts/swe-bench-verified-cohort-batch.mjs`）

### C5：freezeBlock 重冻结（C-5 落地）

- [ ] T026 扩展 `scripts/freeze-preregistration.mjs`：加 oracle / dataset / manifest 参数渲染新 schema 字段（schemaVersion / oracleSpecHash / fixtureContentHash / promptSha256 / datasetSourceDigest 或 datasetHFRevision）；验收：运行 freeze 脚本后 `specs/176-.../verification/preregistration.md` 更新为包含新字段的 v1.0 schema（C-5；FR-005；文件：`scripts/freeze-preregistration.mjs`）

- [ ] T027 用扩展后 freeze 脚本重新冻结现有 `specs/176-.../verification/preregistration.md`：记录 oracleSpecHash（初始以 legacy kind + 三模块 sha256 计算）；验收：重跑 `checkPreregistration` 不报字段缺失 warning（C-5；文件：`specs/176-*/verification/preregistration.md`）

**Phase C Checkpoint**：`npx vitest run tests/unit/feature-176-*.test.ts tests/unit/feature-187-*.test.ts`（含 patch-persistence）全绿

---

## Phase D：验收护栏

**目的**：全量质量门、可执行回归护栏、产物隔离确认。

### D1：回归护栏（SC-015 落地）

- [ ] T028 [P] 可执行护栏 ①：`git diff --exit-code -- scripts/swe-bench-fixture-import.py` 验证 importer 零改动（SC-015①；文件：无，shell 断言）

- [ ] T029 [P] 可执行护栏 ②：`rg -l "ANTHROPIC_API_KEY\|OPENAI_API_KEY" scripts/ --include="*.mjs" --include="*.sh"` 确认无"必选 API key"前提写入脚本帮助文本（SC-015②、FR-C01）

- [ ] T030 [P] 可执行护栏 ③：`git check-ignore -v run_artifacts/ scripts/.swebench-venv/` 确认两个产物路径均被 .gitignore 忽略（SC-015③）

- [ ] T031 [P] 可执行护栏 ④：allowlist 校验——用 `git diff --name-only HEAD~1` 确认竞品评估脚本（graphify/aider/superpowers/gstack 相关 mjs）无意外改动（SC-015④）

### D2：.gitignore 追加

- [ ] T032 追加 `.gitignore` 条目：`scripts/.swebench-venv/`（Python venv 不入库）和 `run_artifacts/`（patch 持久化运行产物不入库）；验收：T030 通过（文件：`.gitignore`）

### D3：全量质量门（SC-016 落地）

- [ ] T033 `npx vitest run` 全量零失败（含 feature-176-* 和 feature-187-* 所有默认跑测试，smoke skip 除外）（SC-016）

- [ ] T034 `npm run build` 零类型错误（SC-016；注：评测脚本层 .mjs 无 tsc 覆盖，此步验证 src/ TypeScript 无回归）

- [ ] T035 `npm run repo:check` 零告警（SC-016）

**Phase D Checkpoint**：T028~T035 全绿 → F187 验收完成

---

## FR 覆盖映射表

| 功能需求 | 对应任务 |
|---------|---------|
| FR-001（oracle dispatch 支持 swebench-execution）| T017 |
| FR-001-a（向官方 harness 提交 predictions JSONL + phaseReached 打点）| T016 |
| FR-001-b（arm64 fallback Rosetta）| T016 |
| FR-001-c（fuzzy-match 降级 secondary，secondaryOracle 字段）| T017 |
| FR-001-d（TS watchdog 独立计时）| T016 |
| FR-001-e（candidatePatch 来源合同，candidatePatchSha）| T016、T018 |
| FR-001-f（执行 test 集校验，failToPassExecuted 比对 W1）| T003、T016、T018 |
| FR-002（OracleResult 统一合同，details 不截断）| T017 |
| FR-002-a（穷尽决策表 14 行 + fallback）| T007、T006 |
| FR-002-b（error 不计 fail 分母）| T009、T019 |
| FR-002-c（分阶段归因 Q1，test_exec 前后区分）| T005、T007、T014 |
| FR-002-d（未知组合 fallback + log 原始信号）| T007 |
| FR-003（patch 持久化，原子写，cleanup 顺序）| T022、T015 |
| FR-003-a（jury extractDiff 优先读持久化文件）| T023 |
| FR-003-b（写盘失败 cleanup 不执行）| T022、T015 |
| FR-003-c（stdout/stderr log 所有 run 落盘）| T022 |
| FR-004（单一 cohort registry，6 处归一）| T011、T019、T020 |
| FR-004-a（buildDriverPrompt default → throw）| T017 |
| FR-004-b（COHORT_IDS/COHORT_TO_TOOL 从 registry 派生）| T011、T019、T020 |
| FR-004-c（竞品 golden 护栏）| T010、T011 |
| FR-005（freezeBlock 新增 schemaVersion/oracleSpecHash/fixtureContentHash/promptSha256）| T013、T026、T027 |
| FR-005-a（checkPreregistration 校验新字段，不匹配拦截）| T013 |
| FR-005-b（oracleSpecHash 覆盖 3 语义模块源码摘要，Q2）| T013、T012 |
| FR-005-c（freezeBlock 记录数据源标识）| T013、T026 |
| FR-005-d（git commit 核对 + worktree clean 检查）| T013 |
| FR-006（experiment manifest 参数化，P3）| T024、T025 |
| FR-006-a（manifest 字段缺失回退默认值）| T024、T025 |
| FR-C01（不得写必选 API key 前提）| T029 |

**FR 覆盖率**：16 条 FR（含子项 25 条）全部覆盖，100%。

---

## Codex CRITICAL 条目落地映射

| Codex 编号 | 处置要点 | 落地任务 |
|-----------|---------|---------|
| C-1 | ranking classifier（pass→true/fail→false/error→null）+ 旧 classifyOracle 重命名 classifyLegacyOracle + 修 :289 error 漏判 + F176 测试更新 | T009、T008、T019、T021 |
| C-2 | oracleSpecHash 覆盖 3 语义模块（classify-oracle + phase-markers + swebench-oracle）+ 改模块 → hash 变化断言 | T012、T013 |
| C-3 | evidence-based 判定（缺 marker 有证据→test_exec；无证据→unknown+告警，不保守判 image）| T005、T004 |
| C-4 | Phase 0 真跑 run_evaluation（非 --help）验证本地 JSONL；方案 B 逐字段比对兜底 | T001、T002、T003 |
| C-5 | spawnSync 同步路径（7 处调用方不改）+ assembleTaskFixture:741 完整 OracleResult + checkPreregistration 加 {oracleKind,oracleSpecInput,manifest} + freeze 脚本重冻结 | T016、T017、T022、T013、T026、T027 |
| C-6 | phase-markers 纯函数单测 + fake-subprocess 全链路集成测试（默认跑，不依赖 docker）| T004、T005、T014 |

**Codex CRITICAL 落地率**：6/6，100%。

---

## 依赖关系与并行说明

### Phase 依赖

```
Phase 0 (BLOCKING)
  └── Phase A（依赖 Phase 0 gate 结果，marker 常量从 T003 更新）
       ├── Phase B（依赖 Phase A：phase-markers + classify-oracle）
       │    └── Phase C（依赖 Phase B：swebench-oracle + 上游改动）
       │         └── Phase D（依赖 Phase C：全量质量门）
```

### User Story 间依赖

| User Story | 核心前置 | 说明 |
|-----------|---------|------|
| US-1（oracle 执行）| Phase A + Phase B | swebench-oracle 依赖 phase-markers + classify-oracle |
| US-2（三分类）| Phase A | classify-oracle 纯 lib，无 docker 依赖 |
| US-3（patch 持久化）| Phase B | 依赖 swebench-oracle 和 eval-task-runner |
| US-4（cohort registry）| Phase A | cohort-registry 纯 lib，可与 Phase B 并行 |
| US-5（freezeBlock 冻结）| Phase A + Phase C | checkPreregistration 扩展 + freeze 脚本重冻结 |
| US-6（manifest 参数化，P3）| Phase C | 可推后，无 P1/P2 硬依赖 |

### Phase A 内部并行机会

Phase A 内 4 个子方向（A2 classify-oracle / A3 ranking / A4 cohort-registry / A5 preregistration）**操作不同文件，互相独立**，可并行推进（标注 `[P]`）。A1 phase-markers 是 A2 classify-oracle 的逻辑前置，需先完成。

| 并行组 | 任务 | 条件 |
|-------|------|------|
| 组 1 | T006、T007（classify-oracle）| 依赖 T004、T005 完成 |
| 组 2 | T008、T009（ranking classifier）| 依赖 T007 导出基础类型 |
| 组 3（可并行）| T010、T011（cohort-registry）| 独立，可与组 1/2 并行 |
| 组 4（可并行）| T012、T013（preregistration）| 独立，可与组 1/2/3 并行 |
| 组 5（可并行）| T015（patch-persistence 测试）| 独立，可与 Phase A 并行 |

### 推荐实现策略

**MVP First（仅 US-1 + US-2）**：
1. Phase 0 → Phase A（A1+A2+A3）→ Phase B → Phase D 基础质量门
2. 验证 oracle 三分类可用（mock 矩阵全绿 + SWE-L003 smoke）

**完整交付顺序**：
1. Phase 0（硬 gate）→ Phase A 全部 → Phase B → Phase C（含 US-4/5 迁移）→ Phase D
2. US-6（P3 manifest）独立最后交付或推后 feature

**FR-006（P3）推后决策**：T024、T025 标为可选，GATE_TASKS 按资源决定是否并入本次 tasks。

---

## 任务统计

| Phase | 任务数 | 默认跑测试 | opt-in smoke |
|-------|-------|-----------|-------------|
| Phase 0（BLOCKING）| 3（T001~T003）| — | — |
| Phase A（lib 核心）| 11（T004~T014）| 7 个测试文件 | 0 |
| Phase B（oracle runner）| 4（T015~T018）| 1 个测试文件 | 1 个 smoke |
| Phase C（上游迁移）| 9（T019~T027）| — | — |
| Phase D（验收护栏）| 8（T028~T035）| — | — |
| **合计** | **35** | **8 测试文件（默认跑）** | **1 smoke（opt-in）** |

可并行任务（[P]）：Phase A 内组 3/4/5（约 6 个任务）+ Phase D 护栏任务（T028~T031，4 个）= **约 10 个可并行**，占总任务 ~29%。

---

## 注意事项

- Phase 0 hard gate（T003）结论若为方案 B（HF dataset），需在 Phase A T005 更新 phase-markers 常量前，先明确 W1 逐字段比对方案，tasks 范围视方案 B 差异补充 1–2 个额外任务（当前任务假设方案 A 通过）
- smoke 测试（T018）需要 docker + arm64 镜像可用，**不得进入 `npx vitest run` 默认路径**
- F176 测试文件（`tests/unit/feature-176-batch.test.ts`）由 T021 更新，需在 T009 重命名 classifyLegacyOracle 之后执行
- `freeze-preregistration.mjs` 改动（T026）和 `preregistration.md` 重冻结（T027）是 **swebench-execution kind 可用的前提**，缺此两步会 hard-fail
- FR-006（T024、T025）标注 P3 可推后，不阻塞 P1/P2 验收
