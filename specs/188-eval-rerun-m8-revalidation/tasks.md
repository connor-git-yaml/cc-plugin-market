# 任务分解：F188 M8 评测复测

**关联**: [spec.md](spec.md) · [plan.md](plan.md)
**日期**: 2026-06-22

依赖图（W3 修正）：A0 →{A1, A2, A3 三者可并行}→ **A4 显式 join(A1+A2+A3)**；B0 → B1（依赖 A1+A2 的 fixtures+freeze）→ B2。A3 驱动开发逻辑独立于 A1/A2（mock oracle 单测），但 A4 实跑前三者必须全就绪。B 轨需用户 `claude /login`，B1 跑批排在 A 轨后。

## Track A — P1 离线重判（无凭据，先跑）

### T-A0 执行环境就绪 〔阻塞全 A 轨〕
- [ ] `bash scripts/setup-swebench-venv.sh` → 确认 `scripts/.swebench-venv/bin/python` 存在
- [ ] `rm node_modules`（断软链）→ `npm ci` → 确认 `node_modules/zod/package.json` 存在
- [ ] `docker info` 退出 0
- **验收**: venv + zod + docker 三者就绪
- **可测**: `ls scripts/.swebench-venv/bin/python node_modules/zod/package.json && docker info >/dev/null && echo OK`

### T-A1 重建 10 个 Verified fixtures 〔依赖 T-A0〕（C2）
- [ ] 从 [F176 preregistration](../176-swe-bench-verified-cross-cohort/verification/preregistration.md) 取 10 taskIds（SWE-V001~V010 已确认）
- [ ] `python3 scripts/swe-bench-fixture-import.py --dataset princeton-nlp/SWE-bench_Verified --task-prefix SWE-V --dataset-tag verified --fixtures-subdir swe-bench-verified --output-dir tests/baseline/swe-bench-verified/fixtures/`（需 datasets venv）
- **验收（C2 改确认性非阻塞）**: 重建出的 fixtures 含正确 10 个 `swebenchMeta.instanceId`（真不变量）；`computeFixtureContentHash` == `19d8d42…` 则记"同源确认"，不等则校验 instanceId 一致后继续 + 报告披露 hash delta + 重冻结 F188 自身 fixtureContentHash；instanceId 错才停下调 `--repos/--task-ids` 重选
- **可测**: node 调 `preregistration-check.mjs` 算 hash + 列 10 instanceId 比对

### T-A2 冻结漂移核验 〔依赖 T-A1〕（FR-013）
- [ ] 计算当前 `computeOracleSpecHash` 与 F176 `f4fbd0f9...` 比对
- [ ] 相等 → 记"无漂移"；不等 → 落 delta 到 `verification/oracle-drift-check.md`（5 模块 sha + 原因）
- [ ] `checkPreregistration` 通过（用 F176 prereg 或 188 manifest 锚）
- **验收**: 漂移状态明确记录；checkPreregistration exit 0

### T-A3 薄离线重判驱动 + 单测 〔依赖 T-A0；可并行 T-A1/A2〕（FR-001/011/002/014）
- [ ] 写 `scripts/eval-offline-rejudge.mjs`：硬前置（W1：checkPreregistration+oracleSpecHash+fixtureContentHash）→ 遍历 133 → CL-1 构造 → `git apply --check` → `runSwebenchInstance` → 聚合
- [ ] CL-1 三分类（W2）：测试（`test_*.py`/`*_test.py`/顶层`tests/`/`conftest.py`）排除；非测试源码并入；**ambiguous**（`sympy/*/tests/`、`sympy/testing/`、非`.py`、候选写进`tests/`）入人工复核桶 + 输出 133 分类清单
- [ ] 可应用校验（C3）：合成后 `git apply --check`；格式错=驱动 bug 阻断；候选不可应用=记 fail 非 error
- [ ] 聚合 schema（W3）：`perCohort:{n_total,n_valid,n_pass,n_error,error_rate,passRate,untrackedNonTestPct,ambiguousCount}` + `perAnswer:{...,applyOk}` + `meta:{oracleSpecHash,fixtureContentHash}`
- [ ] 单测：CL-1 三分类（纯测试/纯源码/混合/ambiguous 四例）+ apply 失败记 fail + error 剔分母口径（mock `runSwebenchInstance`，不跑 docker）
- **验收**: `npx vitest run <新单测>` 零失败；零改 `runSwebenchInstance`；输出符合 schema
- **可测**: vitest 绿 + `git diff scripts/lib/swebench-oracle.mjs` 为空

### T-A4 跑离线重判 + 聚合对照 〔显式 join T-A1+A2+A3〕（FR-004/012/015）
- [ ] `node scripts/eval-offline-rejudge.mjs --patches-root ~/.spec-driver-bench-patches/m7-f176 --fixtures-dir tests/baseline/swe-bench-verified/fixtures --out run_artifacts/188-rejudge/result.json`
- [ ] 监控：infra error 率，error_rate>30% 的 cohort 标低置信不入排名
- [ ] 逐 cohort 对照 M7 fuzzy 排名 → "成立/推翻"（C1：只对 M7，不与 P2 横比）
- **验收（W3 机器可验）**: result.json 含全 5 cohort `perCohort` 字段齐全（n_total/n_valid/n_pass/n_error/error_rate/passRate/untrackedNonTestPct/ambiguousCount）；133 份 perAnswer 齐（含 applyOk）；真 oracle 排名 + 翻案判定产出

## Track B — P2 触发率复测（需用户 `claude /login`，后跑）

### T-B0 凭据 preflight 〔阻塞 B 轨；用户先 `claude /login`〕（FR-007）
- [ ] 用户 host shell `claude /login`（修 401）
- [ ] 三件套：SiliconFlow key=1 / `claude --print` haiku 回 ok / `~/.codex/auth.json` 新鲜（必要时 `codex /login`）
- [ ] 周配额 dashboard 基线读数记录
- **验收**: 三件套全绿；配额 < 60% weekly

### T-B1 跑 c1/c3 × 10 × N=3 〔依赖 T-B0、T-A1/A2〕（FR-005/008）
- [ ] 写 188 manifest（cohort={baseline-claude,spec-driver-spectra-mcp}、repeat=3、quotaCheckInterval=6、swebenchOracle=true、model=opus-4-7）
- [ ] `export SPECTRA_MCP_TELEMETRY_PATH=... SPECTRA_MCP_RUN_ID=...` + `node scripts/swe-bench-verified-cohort-batch.mjs --manifest <188> --swebench-oracle`
- [ ] 每 6 runs 查配额；≥60% weekly 暂停问用户
- **验收**: 60 runs 完成（或配额暂停时已问用户）；telemetry jsonl 落盘

### T-B2 双指标聚合 〔依赖 T-B1〕（FR-006/015）
- [ ] 指标 1：c3 触发率均值 + bootstrap 95% CI；机判 vs 1.77 / ≥2
- [ ] 指标 2：c3/c1 真 oracle 完成率 lift（轨内，C1：不与 P1 横比）
- **验收（W3 机器可验）**: 输出 `{c3_triggerMean, c3_triggerCI95:[lo,hi], significantVsF176:bool, meetsThreshold:bool, c3PassRate, c1PassRate, completionLift}`；显著性按 SC-002 机判口径（CI 下界 vs 1.77/2.0）

## Track C — 报告 + 验证 + 收尾

### T-C1 PUBLISH-REPORT-M8 〔依赖 T-A4；P2 完成则含 B 轨，否则标"P2 待复测"〕（FR-010）
- [ ] 写 `specs/188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md`：P1 排名对照 + P2 双指标 + 漂移核验 + 方法局限；交叉链接 F176/M7
- **验收**: 报告含成立/推翻判定 + 诚实标注（样本量/error_rate/CI/CL-1 占比）

### T-C2 机器校验 + 验证 + 提交 〔依赖 T-C1〕（FR-009 / SC-003）
- [ ] 机器校验：`git diff --cached --name-only` 对 **FR-009 单一 allowlist** 逐条核（spec/plan/tasks/PUBLISH-REPORT/research/verification *.md + scripts/eval-offline-rejudge.mjs + 单测），命中 **denylist**（run_artifacts/tests/baseline/*.tgz/*.patch/patch.diff/*.jsonl/src.spec.md）即中止
- [ ] `npx vitest run` + `npm run build` + `npm run repo:check` 零失败
- [ ] 显式路径提交（禁 `git add -A`）
- **验收**: 三验证绿；staged 集 ⊆ allowlist 且 ∩ denylist = ∅

### T-C3 dogfooding 四维反馈 〔依赖 T-C1〕
- [ ] 在交付报告追加：MCP 可用性 / 返回够用 / 流程顺畅 / 结果准确
- **验收**: 四维如实记录（无问题则显式写"无"）

## 阶段 codex 对抗审查点（CLAUDE.local 约定）

| phase | review 时机 |
|-------|------------|
| plan+tasks（本文件） | 本 commit 前 |
| implement（A3 驱动代码） | A3 commit 前（重点查判分偏差/CL-1 边界） |
| verify（C 轨） | 最终 commit 前 |

## 验收映射

| SC | 任务 |
|----|------|
| SC-004（离线重判） | T-A1~A4 |
| SC-002（触发率） | T-B0~B2 |
| SC-003（护栏） | T-A2、T-C2 |
| SC-001（交付） | T-C1~C3 |
