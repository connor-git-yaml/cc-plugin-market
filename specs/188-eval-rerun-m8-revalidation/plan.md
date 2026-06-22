# 实施计划：F188 M8 评测复测

**Feature**: 188-eval-rerun-m8-revalidation
**关联 spec**: [spec.md](spec.md) · **工具链事实源**: [research/tech-research.md](research/tech-research.md)
**日期**: 2026-06-22

## 架构决策

**零方法论改动原则**：oracle 语义（`swebench-oracle.mjs` / `classify-oracle.mjs` / `phase-markers.mjs`）、importer、fuzzy 算法、cohort 注册表、jury 全部**零改动复用**。本 feature 唯一新增的 tracked 代码是一个**薄离线重判驱动**（reuse `runSwebenchInstance` 不改其语义），因为现有 `eval-task-runner` 的 `candidatePatch` 来自 worktree 的 live `git diff`（line 933-941），`--skip-run` 只写 fixture skeleton —— **无任何"喂已存 patch.diff 判分"的入口**，必须补这一薄层。

**两轨执行**（GATE_DESIGN 已定）：P1 离线重判（无凭据，先跑）→ P2 触发率复测（需用户 `claude /login`，后跑）。

**CL-1 已拍板**：candidatePatch = `patch.diff` + untracked **非测试**源码，排除候选自写测试。

## 执行环境（关键，跑批在本 worktree 而非主仓库）

| 项 | 状态 | 动作 |
|----|------|------|
| 主仓库 | stale（F171，缺 F187/F197 脚本，脏 18 项） | ❌ 不在主仓库跑 |
| 本 worktree | 有全套脚本 + `.env.local`（SiliconFlow key） | ✅ 执行根 |
| docker | RUNNING | ✅ |
| `scripts/.swebench-venv` | 缺失 | T-A0 `setup-swebench-venv.sh` |
| worktree `node_modules` | 断软链（zod 缺）→ 主仓库空树 | T-A0 `rm` 软链 + 本分支 lockfile `npm ci` |
| Claude Max OAuth | 🔴 过期 401 | **P2 前用户 `claude /login`** |
| codex OAuth | `auth.json` mtime Jun 13（9天） | P2 前复验，必要时 `codex /login` |

## Track A — P1 离线重判（无凭据，~$0 测试执行）

### A0 环境就绪
1. `bash scripts/setup-swebench-venv.sh`（建 `.swebench-venv`）。
2. 修 node_modules：`rm node_modules`（断软链）→ `npm ci`（本分支 `package-lock.json` 191KB）。
3. `docker info` 复核守护进程在跑。

### A1 重建 10 个 Verified fixtures（swebenchMeta）
- fixtures 目录 `tests/baseline/swe-bench-verified/fixtures/` gitignore 且当前为空 → 必须重建。
- 复用 F176 host 导入路径：`python3 scripts/swe-bench-fixture-import.py --dataset princeton-nlp/SWE-bench_Verified --task-prefix SWE-V --dataset-tag verified --fixtures-subdir swe-bench-verified --output-dir tests/baseline/swe-bench-verified/fixtures/`（需在带 `datasets` 的 venv；参照 [host-runbook](../176-swe-bench-verified-cross-cohort/verification/host-runbook.md) 步骤 4a）。10 个 taskIds 已确认：SWE-V001~V010（sympy×8 + pytest×2）。
- **hash 校验改确认性（非阻塞，C2）**：算 `computeFixtureContentHash(10 ids)` 与 F176 `19d8d42…` 比对：
  - **相等** → 确认同源 fixtures（最佳）。
  - **不等** → **不 dead-block**：先校验重建 fixtures 的 10 个 `swebenchMeta.instanceId` 与 F176 一致（判分有效性真不变量）；一致则用重建 fixtures 继续，报告披露 hash delta + 为 F188 重冻结自身 fixtureContentHash；instanceId 不一致才停下查（说明 import 选错 task）。
  - import 脚本按 `--repos/--limit` 启发式选 task、非按 instanceId 锚 → 若选出非这 10 个，用 `--task-ids` 子集冻结或调 `--repos` 重选（host-runbook 4c）。

### A2 冻结 + 漂移核验（FR-003 / FR-013）
1. 计算当前 `oracleSpecHash` 并与 F176 冻结值 `f4fbd0f91ca94a94a8aeae974967bb5d3f889779ab2cb175b79b2a6a10b2a274` 比对：
   - **相等** → 无漂移，最干净；直接复用既冻结锚。
   - **不等** → 披露 5 语义模块 sha 的 delta + 原因（F197 后是否有正常演进），报告 falsification 附录记录；**不静默覆盖**。
2. `node scripts/freeze-preregistration.mjs --swebench-oracle --manifest <188 manifest>`（如需为 188 单独冻结）或直接复用 F176 prereg 作 `checkPreregistration` 锚。

### A3 薄离线重判驱动（唯一新增 tracked 代码；可与 A1/A2 并行开发）
新增 `scripts/eval-offline-rejudge.mjs`（+ 单测）：
- **输入**: `--patches-root ~/.spec-driver-bench-patches/m7-f176` `--fixtures-dir tests/baseline/swe-bench-verified/fixtures` `--out <json>`。
- **硬启动前置（W1，FR-014）**: 调用前 MUST 复用 `checkPreregistration` + `oracleSpecHash` 比对 + `fixtureContentHash` 校验（同 `swe-bench-verified-cohort-batch.mjs:214` 三重拦截）；任一不过 exit 非 0，不绕过 F176 抗污染保护。
- **CL-1 candidatePatch 构造 + 三分类（W2，单测覆盖）**：
  1. 读 `{task}/{cohort}/r{N}/patch.diff`。
  2. 解包 `untracked.tgz`，按路径三分类：**测试**（`test_*.py`/`*_test.py`/顶层 `tests/`/`conftest.py`）→ 排除；**非测试源码** → 并入；**ambiguous**（`sympy/*/tests/`、`sympy/testing/`、非 `.py` test data、候选写进 `tests/` 的修复）→ 入人工复核桶，先输出 133 份分类清单供复核再定。
  3. candidatePatch = patch.diff ⊕ 非测试 untracked 转 new-file diff，排除测试。
  4. 统计该 cohort 非测试 untracked 占比 + ambiguous 计数。
- **合成可应用校验（C3）**: 合成后 `git apply --check`（对该 task base commit）：格式错=驱动 bug → 阻断修；候选 patch 本身不可应用 → 记 **fail**（非 error），**禁**剔分母。
- **判分**: 对每份调 `runSwebenchInstance({fixture, candidatePatch, artifactsDir: run_artifacts/188-rejudge, runId, ...})`，dataset tag MUST = `verified`。
- **输出 schema（W3 机器验收）**: `{ perAnswer: [{task,cohort,repeat,classification,failureSource,reason,applyOk}], perCohort: [{cohort,n_total,n_valid,n_pass,n_error,error_rate,passRate,untrackedNonTestPct,ambiguousCount}], meta:{oracleSpecHash,fixtureContentHash,frozen} }`；n_valid 用 `classifyRunForRanking` 口径。
- **健壮性**: 单份判分异常记 error 不中断整批；`--resume` 跳过已判。零改 `runSwebenchInstance`（I1 确认薄驱动方案）。

### A4 聚合 + 对照
- 按 cohort 出真 oracle passRate 排名；error_rate > 30% 的 cohort 标低置信、不入翻案排名（FR-012）。
- 逐 cohort 对照 [M7 PUBLISH-REPORT](../147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md) 的 fuzzy 排名 → 给"成立/推翻"（FR-004）。

## Track B — P2 触发率复测（需凭据，烧配额，用户 `claude /login` 后）

### B0 凭据 preflight（host shell，跑前 + 长批 resume 前）
```
grep -c "^export SILICONFLOW_API_KEY=" .env.local            # 1
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text  # ok（用户 login 后）
ls -la ~/.codex/auth.json                                    # 存在 + mtime 新
```

### B1 跑 c1/c3 × 10 × N=3（60 runs）
- `node scripts/swe-bench-verified-cohort-batch.mjs --manifest <188 c1c3 manifest> --swebench-oracle`，manifest 限 cohort = {baseline-claude, spec-driver-spectra-mcp}、repeat=3、quotaCheckInterval=6。
- telemetry：导出 `SPECTRA_MCP_TELEMETRY_PATH=<jsonl>` + `SPECTRA_MCP_RUN_ID` 采集 c3 子代理 MCP 调用（`parent_tool_use_id` 归因）。
- **配额护栏**：每 6 runs 查周配额 dashboard；≥60% weekly → 暂停问用户（FR-008）。
- driver=codex:gpt-5.5（订阅）、model=opus-4-7、jury=claude+GLM+Kimi（SiliconFlow 真实扣费）。

### B2 双指标聚合
- 指标 1：c3 触发率均值 + bootstrap 95% CI（复用 `cohort-aggregate.mjs` / `bootstrap-ci.json` 口径）；机判 vs 1.77 基线 / ≥2 阈值（SC-002）。
- 指标 2：c3/c1 真 oracle 完成率 lift。

## Track C — 报告 + 验证 + 收尾

1. **PUBLISH-REPORT-M8.md**（manual，入库）：M8 章节 = P1 真 oracle 排名 vs fuzzy 对照 + P2 触发率双指标 + 漂移核验结论 + 方法局限（CL-1 占比、ambiguous 桶、error_rate、CI 口径）；交叉链接 F176/M7。**C1 红线**：P1（M7-era 答卷重判）与 P2（post-F184 新 runs）不同 epoch + 不同构造，报告显式声明禁横向比 c3 passRate；P1 只对 M7 fuzzy，P2 只对 F176 telemetry（FR-015）。
2. **机器校验产物边界**（FR-009）：提交前断言 `git diff --cached --name-only` ⊆ `specs/188-eval-rerun-m8-revalidation/**`（含可能的 `scripts/eval-offline-rejudge.mjs` + 其单测），无 run_artifacts/fixture/patch 泄漏。
3. **验证**：`npx vitest run`（新驱动单测零失败）+ `npm run build` + `npm run repo:check`。
4. **dogfooding 四维反馈**（MCP 可用性 / 返回够用 / 流程顺畅 / 结果准确）。

## 风险登记

| 风险 | 影响 | 缓解 |
|------|------|------|
| Verified fixtures 重建偏差 | P1 判分基底错 | hash 确认性校验 + instanceId 真不变量校验（C2）；不匹配披露不 dead-block |
| oracleSpecHash 漂移 | 判分语义非 F176 同口径 | FR-013 比对 f4fbd0f9 + 披露 delta；驱动硬前置（FR-014） |
| 新驱动引入判分偏差 | P1 结论不可信 | 零改 runSwebenchInstance（I1）；单测覆盖 CL-1 构造 + 聚合；error 剔分母用既有 classifyRunForRanking |
| 合成 patch 不可应用被剔分母（C3） | passRate 系统性虚高 | 合成后 `git apply --check`；不可应用记 fail 非 error |
| untracked 分类误判（W2 sympy 盲区） | 系统性偏置某 cohort | 三分类 + ambiguous 人工复核桶；报告披露各 cohort 占比 + ambiguous 计数 |
| P1/P2 c3 passRate 误横比（C1） | 报告结论自相矛盾 | FR-015 红线：不同 epoch 禁跨轨比，各对本轨基线 |
| Claude/Codex OAuth 跑批中失效 | P2 假阴性 telemetry | 跑前 + resume 前 preflight；401 即暂停 |
| 周配额超限 | 烧穿订阅 | 每 6 runs 查，≥60% 暂停问用户 |
| docker/venv flaky（infra error） | 误剔分母 | error 态如实计数 + 重跑 1 次（既有 E-02 重试）；error_rate>30% cohort 标低置信 |

## 不做（范围外）

- 不改 oracle/fuzzy/importer/cohort 任何语义。
- 不跑 c2/c4/c5 触发率（恒零无信息量）。
- 不 ship 生产代码、不 npm publish。
- 离线重判产物（run_artifacts/188-rejudge、重建 fixtures）不入库。
