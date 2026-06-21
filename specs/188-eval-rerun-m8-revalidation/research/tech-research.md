# 技术调研：F188 评测复测工具链测绘（codebase-scan）

**Feature**: 188-eval-rerun-m8-revalidation
**调研模式**: codebase-scan（内部 eval 基础设施，无需 web research）
**日期**: 2026-06-22

本文档测绘 F188 离线重判 + 触发率复测所复用的现有工具链，是 spec/plan 的事实源。**所有工具零改动复用**（F197 freeze 工具已就位，跑前重冻结，不跑中换判分）。

## 1. FAIL_TO_PASS test-execution oracle（F187/F197）— 离线重判核心

| 项 | 事实 |
|----|------|
| 主执行器 | `scripts/lib/swebench-oracle.mjs` → `runSwebenchInstance({fixture, candidatePatch, artifactsDir, runId, timeoutMs, venvPath})` |
| 三分类决策 | `scripts/lib/classify-oracle.mjs` → `classifySwebenchResult()`，14 行决策表 |
| 阶段解析 | `scripts/lib/phase-markers.mjs` → `parsePhaseFromLog()` |
| 数据集映射 | `scripts/lib/swebench-dataset-build.mjs` → `datasetTagToHfId`：`verified → SWE-bench/SWE-bench_Verified`，`lite → SWE-bench/SWE-bench_Lite` |
| 输出 | `{classification: 'pass'｜'fail'｜'error', failureSource, reason}` |
| 排名口径 | `classifyRunForRanking()`：`pass→true`（分子+分母）、`fail→false`（分母）、`error/缺失→null`（**剔除分母**，不污染排名） |

**F197 三处修复点（本次复用，零改动）**：
1. **report 权威优先**（classify-oracle 行 7.5）：harness `report.completed===true` 时 `report.resolved` 为权威，跳过日志启发式 → 防 "OOMKilled"/"Killed" 残留把 resolved=true 的 PASS 误判 fail。
2. **error 剔分母**：`classification='error'`（基础设施失败）→ ranking 口径 null，不计入分母。
3. **Lite-Verified dataset 映射**：`datasetTagToHfId` 避免 Lite/Verified 错配导致 instance 静默剔除。**本次离线重判 dataset tag 必须为 `verified`**。

## 2. Freeze 工具（F197）— oracleSpecHash 防跑中换判

| 项 | 事实 |
|----|------|
| 入口 | `scripts/freeze-preregistration.mjs [--swebench-oracle] [--manifest <path>]` |
| 校验库 | `scripts/lib/preregistration-check.mjs` → `checkPreregistration()` |
| 写入 | `preregistration.md` frontmatter：`taskSetHash / oracleSpecHash / fixtureContentHash / promptSha256 / gitCommit / frozenAtIso` |
| oracleSpecHash | `computeOracleSpecHash(spec)`：对 5 个语义模块（classify-oracle / phase-markers / swebench-oracle / swebench-dataset-build / swebench_fetch_rows.py）的 sha256 摘要 → 任一变更则判分语义变，跑前 hard-fail |

**保证**：跑前 `checkPreregistration` 校验 oracleSpecHash；若不符即 exit 非 0 拦截 → **不跑中换判分**这一护栏由该字段机器强制，非靠人工自觉。

## 3. Cohort batch runner — 触发率复测

| 项 | 事实 |
|----|------|
| 主编排 | `scripts/swe-bench-verified-cohort-batch.mjs --smoke ｜ --full [--manifest <p>] [--swebench-oracle]` |
| 单 run | `scripts/eval-task-runner.mjs --task <id> --tool <cohort> [--swebench-oracle]` |
| cohort 注册表 | `scripts/lib/cohort-registry.mjs`（单一来源，`COHORT_TO_TOOL` 防漂移） |
| 路径 | `scripts/lib/swe-bench-verified-paths.mjs`，聚合落 `tests/baseline/swe-bench-verified/aggregate/cohort-aggregate.json` |

**5 cohort 定义**（1-indexed 口径，见下方 c1/c3 映射）：

| 序号 | cohort id | tool | MCP 注入 |
|------|-----------|------|----------|
| c1 | `baseline-claude` | `control` | 无 |
| c2 | `spec-driver` | `spec-driver` | 无 |
| c3 | `spec-driver-spectra-mcp` | `spec-driver-spectra-mcp` | **注册 spectra MCP** |
| c4 | `SuperPowers` | `superpowers` | 无 |
| c5 | `GStack` | `gstack` | 无 |

**F188 触发率复测取 c1（control，零 MCP 基线）+ c3（spectra-mcp，唯一注入 MCP 的 cohort）**：c3 是唯一会触发子代理调 Spectra MCP 的 cohort，c1 作零基线。这是测「MCP 触发率 + lift」的最小机制对照对。

## 4. Jury 判分（触发率复测的质量维度，需凭据）

| 项 | 事实 |
|----|------|
| 入口 | `scripts/eval-judge-jury.mjs` |
| 3 judge | `claude-cli:claude-opus-4-7`（订阅 OAuth）、`siliconflow:Pro/zai-org/GLM-5.1`、`siliconflow:Pro/moonshotai/Kimi-K2.6` |
| 凭据 | SiliconFlow 走 `SILICONFLOW_API_KEY`（`.env.local`，真实扣费）；claude judge 走 Claude Max OAuth（边际 $0） |
| batch 前置校验 | `swe-bench-verified-cohort-batch.mjs` 在 `!skipJury` 时硬校验 `.env.local` 含 `SILICONFLOW_API_KEY`，缺则 error |

## 5. Fuzzy match（被挑战对象）

| 项 | 事实 |
|----|------|
| 入口 | `scripts/eval-diff-fuzzy-match.mjs --expected <gold> --actual <actual> [--threshold 60]` |
| 算法 | 语义行抽取 → token multiset → Jaccard 相似度，≥threshold% 判 pass |
| **结构性缺陷**（M7 PUBLISH-REPORT §4.5） | 整 diff 对 goldpatch 算 Jaccard、无文件过滤 → 候选若额外补写测试（对已跟踪文件的额外修改）会稀释相似度 → 「核心修复正确」的框架 cohort run 被误判死；baseline 从不写测试零受损。这就是「fuzzy 翻案」需用真 oracle 复证的根因 |

## 6. 触发率 telemetry

| 项 | 事实 |
|----|------|
| 实现 | `src/mcp/lib/telemetry.ts`，`writeTelemetry()` / `withTelemetry()`（F177 注册层采样 11 工具） |
| 驱动 | 环境变量 `SPECTRA_MCP_TELEMETRY_PATH`（JSONL）+ `SPECTRA_MCP_RUN_ID` |
| 归因 | entry 含 `runId`；子代理调用经 `parent_tool_use_id` 归因可证 |
| **F176 基线** | c3 = **1.77 调用/run**（53 calls / 30 runs），SC-002 阈值 **≥2/run**，差 0.23 未达标；c2 = 0.00 调用/run（无 MCP 注入） |
| lift 指标 | 触发率 lift = (c3 调用/run) ÷ (c1 调用/run 基线)；c1 基线为零调用 → 实际报「c3 触发率绝对值 + 是否跨过 ≥2 阈值」并诚实标注分母为零时 lift 不可比 |

## 7. m7-f176 答卷布局（离线重判输入）— **实测确认**

```
~/.spec-driver-bench-patches/m7-f176/{task}/{cohort}/r{N}/
  ├── patch.diff            ← 候选 patch（已跟踪文件 git diff）= oracle 的 candidatePatch
  ├── untracked.tgz         ← 候选新建文件（如新测试），patch.diff 不含
  ├── status.txt
  ├── task-runner-stdout.log
  └── task-runner-stderr.log
```

- **实测计数：133 份 `patch.diff`**（非 150）。cohort 分布：control=7 任务目录、gstack/spec-driver/spec-driver-spectra-mcp/superpowers 各 10；部分 task×cohort 重复 <3 → 共 133 叶子。
- oracle 消费 `patch.diff` 作 candidatePatch；**官方测试 patch 由 harness 自行施加**（FAIL_TO_PASS 正统判法），候选自带的 untracked 测试不参与判分。

## 8. 产物入库边界（gitignore 实测）

| 路径 | 状态 |
|------|------|
| `run_artifacts/`（.gitignore:114） | 不入库（harness docker 临时产物） |
| `scripts/.swebench-venv/`（.gitignore:113） | 不入库 |
| `tests/baseline/swe-bench-verified/`（.gitignore:101） | 不入库（事实源是 specs/176 preregistration.md git 历史） |
| `~/.spec-driver-bench-patches/`（home dir） | 不入库（不在仓库树内） |
| **`specs/188-.../PUBLISH-REPORT-M8.md`**（manual） | **入库** |
| **`specs/188-.../{spec,plan,tasks}.md`** | **入库** |

## 9. PUBLISH-REPORT 现状

- M7 收官：`specs/147-competitor-evaluation-platform/PUBLISH-REPORT-M7.md`（150/150 回填，2026-06-12）
- M8 fix 候选：`specs/176-swe-bench-verified-cross-cohort/verification/m8-fix-candidates.md`
- 预注册（冻结锚）：`specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md`
- **F188 新建**：`specs/188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md`，交叉链接 F176/M7。

## 10. 凭据策略（订阅优先，**禁 API key 前提**）

| 角色 | 模型 | 凭据 | 实付 |
|------|------|------|------|
| Driver | `codex:gpt-5.5` | ChatGPT Pro OAuth（`~/.codex/auth.json`） | $0 边际 |
| Judge1 | `claude-cli:claude-opus-4-7` | Claude Max OAuth（Keychain） | $0 边际 |
| Judge2/3 | GLM-5.1 / Kimi-K2.6 | `SILICONFLOW_API_KEY`（`.env.local`） | **真实扣费 <$20** |

**严禁**写「需 ANTHROPIC_API_KEY + OPENAI_API_KEY」作前提 — 生产路径走订阅 OAuth。

### 凭据 preflight 实测（2026-06-22 启动时）

- ✅ `SILICONFLOW_API_KEY` 在 `.env.local`（grep 计数 1）
- 🔴 **Claude Max OAuth 已过期（401 Invalid authentication credentials）** → 触发率复测前必须 host shell `claude /login`
- ⚠️ `~/.codex/auth.json` 存在但 mtime 为 Jun 13（9 天前）→ 触发率复测前需复验 codex OAuth 有效性

**离线重判（子任务 1）不依赖 Claude/Codex OAuth**（纯 pytest 测试执行 oracle），不受此 401 阻塞。
