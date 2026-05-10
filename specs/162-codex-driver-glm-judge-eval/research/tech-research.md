# Feature 162 — 技术调研（codebase-scan 模式）

> Mode: codebase-scan-only / no-online
> Scanned at: 2026-05-10
> Base commit: 77bf166

---

## 1. Phase 0 现状：sub-agent MCP frontmatter

### 1.1 5 个 plugin agent frontmatter 现状（精确 YAML 块抄录）

**`plugins/spec-driver/agents/plan.md`**（第 1-4 行）
```yaml
---
model: sonnet
tools: [Read, Write, Grep, Glob]
effort: high
---
```
- 未含 `mcp__spectra__*`

**`plugins/spec-driver/agents/implement.md`**（第 1-4 行）
```yaml
---
model: sonnet
tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
effort: high
---
```
- 未含 `mcp__spectra__*`

**`plugins/spec-driver/agents/verify.md`**（第 1-4 行）
```yaml
---
model: sonnet
tools: [Read, Bash, Grep, Glob]
effort: medium
---
```
- 未含 `mcp__spectra__*`

**`plugins/spec-driver/agents/quality-review.md`**（第 1-4 行）
```yaml
---
model: sonnet
tools: [Read, Bash, Grep, Glob]
effort: medium
---
```
- 未含 `mcp__spectra__*`

**`plugins/spec-driver/agents/spec-review.md`**（第 1-4 行）
```yaml
---
model: sonnet
tools: [Read, Grep, Glob]
effort: medium
---
```
- 未含 `mcp__spectra__*`

**小结**：5 个 sub-agent 全部均不含 `mcp__spectra__*` 工具。与 sub-agent-mcp-test.md 结论完全吻合。

### 1.2 包装产物分布

- **plugin 源码目录**（canonical source）：`plugins/spec-driver/agents/*.md`
- **plugin manifest**：`plugins/spec-driver/.claude-plugin/plugin.json`
- **marketplace 配置**：`.claude-plugin/marketplace.json`
- **release contract**：`contracts/release-contract.yaml`（`spec-driver` product version = `4.0.0`）
- **marketplace cache 版本**（用户本地）：`~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0/`（这是 Test 1 的加载源，已在 sub-agent-mcp-test.md 验证）
- `.claude/agents/` 目录：**不存在**（glob 扫描确认为空）
- `.codex/agents/` 目录：**不存在**
- `repo:sync` 会同步 plugin 包装产物；修改 `plugins/spec-driver/agents/*.md` 后必须运行 `npm run repo:sync` 再 `npm run release:check`

### 1.3 sub-agent-mcp-test.md 关键发现摘录

（源文档：`specs/161-fix-workspace-replace-replaceall/verification/sub-agent-mcp-test.md`，commit 77bf166）

1. **Sub-agent 工具访问权 = sub-agent frontmatter `tools` ∩ 全局可用工具集**；session 级 `--allowedTools` 对 sub-agent **不生效**（Test 1 验证：`TOOL_CALL_OUTCOME: tool-not-available`）
2. **Orchestrator 与 sub-agent 门禁规则不同**：orchestrator 受 session `--allowedTools` 控制，sub-agent 只看自身 frontmatter
3. **Stage 7b 必须在 plugin agent 文件层显式声明 mcp 工具**（Test 2 验证：加入 frontmatter 后 `TOOL_CALL_OUTCOME: success`）
4. 修改后需 `npm run repo:sync + release:check`，升 plugin SemVer（minor）

---

## 2. Phase A 现状：callExecutor

### 2.1 callExecutor 函数当前签名 + body 摘要

**文件**：`scripts/eval-task-executor.mjs`，第 176-193 行

```js
export async function callExecutor({ model, prompt, baseURL = DEFAULT_BASE_URL, apiKey }) {
  if (!apiKey) throw new Error('SILICONFLOW_API_KEY not set');
  const { default: OpenAI } = await import('openai');
  const sdk = new OpenAI({ apiKey, baseURL, timeout: 240000 });
  const r = await sdk.chat.completions.create({
    model,
    max_tokens: 8000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });
  const choice = r.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    promptTokens: r.usage?.prompt_tokens ?? null,
    completionTokens: r.usage?.completion_tokens ?? null,
    finishReason: choice?.finish_reason ?? null,
  };
}
```

**特征**：
- 仅支持 SiliconFlow OpenAI-compat 后端，硬编码 `DEFAULT_BASE_URL`
- 无多 backend dispatch 逻辑（与 jury 的 `parseJudgeBackend` 不同）
- 没有 codex CLI / claude CLI 调用路径
- `apiKey` 强制从参数传入（调用方传 `process.env.SILICONFLOW_API_KEY`）

### 2.2 DEFAULT_EXECUTOR_MODEL 常量当前值

**文件**：`scripts/eval-task-executor.mjs`，第 38-39 行

```js
// 默认 executor: SiliconFlow GLM-5.1 旗舰
const DEFAULT_EXECUTOR_MODEL = 'Pro/zai-org/GLM-5.1';
const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
```

- `executeOnFixture` 函数（第 200 行）有默认值兜底：`executorModel = DEFAULT_EXECUTOR_MODEL`（Feature 149 修复）

### 2.3 parseJudgeBackend 模块路径 + 4 backend handler 现状

**文件**：`scripts/eval-judge-jury.mjs`，第 91-135 行

4 个 backend handler：

| backend prefix | provider 类型 | vendor | apiKeyEnv | baseURL |
|----------------|--------------|--------|-----------|---------|
| `siliconflow:` | `openai-compat` | siliconflow | `SILICONFLOW_API_KEY` | `https://api.siliconflow.cn/v1` |
| `openai:` | `openai-compat` | openai | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `claude-cli:` | `claude-cli` | anthropic | null（subscription）| null |
| `codex:` | `codex-cli` | openai | null（subscription）| null |
| （默认）| `anthropic` | anthropic | `ANTHROPIC_API_KEY` | null |

- `parseJudgeBackend` 只在 **jury** 模块存在；executor (`eval-task-executor.mjs`) 没有对应抽象
- `src/eval/llm-backend-dispatcher.ts` **不存在**（确认）

### 2.4 codex CLI 子进程调用现有路径

**文件**：`scripts/eval-judge-jury.mjs`，第 347-384 行（`codex-cli` provider 的 `invoke` 实现）

```js
const r = await spawnAsync('codex',
  ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
   '-c', 'model_reasoning_effort="high"',
   '-m', backend.model, '--output-last-message', tmpFile, prompt],
  { timeoutMs: 300000 });
```

- token 解析：从 stderr 正则匹配 `tokens used\n[\d,]+`（第 369 行）
- 仅 jury 侧已实现；executor 侧无 codex 调用路径

### 2.5 token usage 解析格式

**executor**（`eval-task-executor.mjs`）：OpenAI-compat 标准字段
- `r.usage?.prompt_tokens` / `r.usage?.completion_tokens` / `choice?.finish_reason`

**jury**（`eval-judge-jury.mjs`）：按 provider 分路
- `anthropic` SDK：`r.usage?.input_tokens` / `r.usage?.output_tokens` / `r.stop_reason`
- `openai-compat` SDK：`r.usage?.prompt_tokens` / `r.usage?.completion_tokens` / `choice?.finish_reason`
- `claude-cli` 子进程：`parsed.usage?.input_tokens` / `parsed.usage?.output_tokens`（`--output-format json`）
- `codex-cli` 子进程：仅 total（`completionTokens = totalTokens`），`promptTokens = null`

---

## 3. Phase B 现状：jury / judge 系统

### 3.1 jury 主模块路径 + judge prompt template 位置

- **jury 主模块**：`scripts/eval-judge-jury.mjs`
- **judge prompt template**：`buildAdversarialPrompt()` 函数，第 243-278 行（inline，无外部模板文件）
  - 评分维度：正确性、边界、测试、可读性（0-10 整数）
  - 强制匿名化（`anonymizeFixture` / `anonymizeDiff`）
  - 要求输出严格 JSON：`{ score, rationale, issues }`

### 3.2 DEFAULT_JUDGES 当前值

**文件**：`scripts/eval-judge-jury.mjs`，第 79-83 行

```js
export const DEFAULT_JUDGES = [
  'claude-cli:claude-opus-4-7',                // Anthropic Opus 4.7 (美国, Claude Max subscription)
  'codex:gpt-5.5',                             // OpenAI GPT-5.5 (美国, ChatGPT Pro, low reasoning)
  'siliconflow:Pro/moonshotai/Kimi-K2.6',      // Moonshot Kimi K2.6 (中国, SiliconFlow API)
];
```

- executor = GLM-5.1，jury 故意不含 GLM 避免 self-judge（注释说明）
- codex judge 用 `model_reasoning_effort="high"` 覆盖（非 xhigh，保留 ChatGPT Pro 周配额）

### 3.3 IoU / Pearson / oracle pass rate 计算实现现状

| 功能 | 实现状态 | 位置 |
|------|---------|------|
| **oracle pass rate** | 已实现 | `scripts/eval-report.mjs`，第 774、836 行；`scripts/eval-batch-repeat.mjs`，第 351、382 行 |
| **bootstrap 95% CI（percentile method）** | 已实现 | `scripts/lib/bootstrap-ci.mjs`，`bootstrapPercentileCi()` 函数（第 47 行）；binary 场景的 mean-percentile variant 在 `scripts/eval-mcp-augmented-classic.mjs`，第 46-72 行 |
| **caller/callee 二元组 IoU** | 已实现（独立验证脚本）| `scripts/verify-feature-153.mjs`，第 121 行（label-only matching IoU）；**非 jury 评分路径** |
| **Pearson correlation** | **未找到实现** | 搜索全 `scripts/` 未命中；judge calibration 中如需 jury score vs oracle pass rate 的 Pearson 相关，属于**需新增** |
| **IoU（jury 评分 calibration 用途）** | **未找到实现** | 搜索全 `scripts/` 未命中（`verify-feature-153.mjs` 的 IoU 用于图谱准确度，非 jury calibration）|

### 3.4 25 fixture 路径

task fixture（25 个 spec-driver 类）路径：`tests/baseline/tasks/<taskId>/<tool>/full.json`

- task fixture 定义目录（spec 配置）：`specs/147-competitor-evaluation-platform/research/task-fixtures/*.json`
- FIXTURES_ROOT（executor 写入）：`tests/baseline/tasks`（第 34 行）
- **当前 25 task fixture 不入库**（见 `CLAUDE.local.md` 入库边界：task fixture 含 LLM 随机性，git track 是噪声）

### 3.5 GLM / Kimi siliconflow model id 现有引用

| 角色 | Model ID | 位置 |
|------|---------|------|
| Executor（默认）| `Pro/zai-org/GLM-5.1` | `eval-task-executor.mjs` 第 39 行 |
| Executor pricing | `siliconflow:Pro/zai-org/GLM-5.1` | `scripts/lib/llm-pricing.mjs` 第 14 行 |
| Executor pricing（旧版）| `siliconflow:Pro/zai-org/GLM-4.5` | `scripts/lib/llm-pricing.mjs` 第 15 行 |
| Judge（Kimi）| `siliconflow:Pro/moonshotai/Kimi-K2.6` | `eval-judge-jury.mjs` 第 82 行（DEFAULT_JUDGES[2]）|
| Kimi pricing | `siliconflow:Pro/moonshotai/Kimi-K2.6` | `scripts/lib/llm-pricing.mjs` 第 16 行 |

---

## 4. Phase C 现状：SWE-Bench-Lite eval

### 4.1 eval-mcp-augmented.mjs 现状

**存在**：`scripts/eval-mcp-augmented.mjs`（Feature 158 Batch 3 实现）

主要函数：
| 函数 | 说明 |
|------|------|
| `parseArgs()` | CLI 参数解析（`--group A/B/C`, `--task`, `--repeat`, `--dry-run`, `--stop-loss`, `--max-judge-calls`, `--all-fixtures`）|
| `loadFixtureByTaskId()` | 从 `tests/baseline/swe-bench-lite/fixtures/<taskId>.json` 加载 |
| `listAllFixtureTaskIds()` | 列举 fixtures/ 下 `SWE-L\d+.*\.json` |
| `loadSpectraContextForSweBench()` | Group B 专用；从 `~/.spectra-baselines/<repo>-output/spectra-full/modules/` 加载 spec.md |
| `buildGroupAPrompt()` | 裸 fixture.prompt |
| `buildGroupBPrompt()` | spec.md 前缀注入 |
| `buildGroupCPrompt()` | MCP mandatory tool use instruction |
| `buildClaudeArgsWithMcp()` | 构造 claude CLI 参数（固定 `claude-sonnet-4-6`，bypassPermissions）|
| `spawnClaudeAndWait()` | 异步 spawn claude，等 `exit` 事件（避免 telemetry JSONL race）|
| `parseTelemetryJsonl()` | 解析 `SPECTRA_MCP_TELEMETRY_PATH` → `mcpToolCallCount / mcpResponseBytes` |
| `runOne()` | 单 run 执行（含 dry-run 路径）|
| `runForTaskList()` | stop-loss 主循环 |

**注意**：实跑骨架完整，但当前注释说明"Batch 3 仅 dry-run 集成测试"（第 631 行注释）；Stage 7b 需要移除 dry-run 限制实际运行。

### 4.2 SWE-L001~L010 fixture 实际路径

```
tests/baseline/swe-bench-lite/fixtures/
├── SWE-L001-pytest-module-imported-twice-under.json
├── SWE-L002-astropy-in-v5-nddataref-mask.json
├── SWE-L003-pytest-rewrite-fails-when-first.json
├── SWE-L004-sympy-bug-with-milli-prefix.json
├── SWE-L005-astropy-ascii-qdp-table-format.json
├── SWE-L006-astropy-please-support-header-rows.json
├── SWE-L007-sympy-collect-factor-and-dimension.json
├── SWE-L008-sympy-bug-in-expand-of.json
├── SWE-L009-sympy-cannot-parse-greek-characters.json
└── SWE-L010-sympy-si-collect-factor-and.json
```

10 个 fixture 已入库（Feature 158 落地），覆盖 sympy / astropy / pytest 三仓库。

### 4.3 cohort 定义现状

当前 `eval-mcp-augmented.mjs` 使用 Group A/B/C 命名：
- **Group A**：bare baseline（无 context，无 MCP）
- **Group B**：spec.md push（Spectra spec.md system prompt 注入）
- **Group C**：mcp pull（`--mcp-config` 注册 Spectra MCP，mandatory tool use prompt）

`eval-task-runner.mjs` 第 27 行 `SUPPORTED_TOOLS` 含 `'mcp-pull'`（用于 task fixture schema），与 A/B/C group 命名并存。

run 结果输出路径：`tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-<N>.json`

### 4.4 mcpToolCallTrace 字段定义

- **eval-mcp-augmented.mjs**（当前主脚本）：使用 `mcpToolCallCount` + `mcpResponseBytes`（从 telemetry JSONL 解析），**无 trace 数组**（第 357-378 行 `parseTelemetryJsonl`）
- **eval-task-runner.mjs**（schema 1.2）：有 `perf.mcpToolCallTrace`（数组）+ `perf.w3Flag`（boolean），第 588 行写入；仅 `mcp-pull` cohort 才填，其他为 null
- **verify-feature-158-classic.mjs**：SC-004 验证 `perf.mcpToolCallTrace` 是否为数组（第 163、183-185 行）
- **两个脚本使用不同字段命名**（mcpToolCallTrace vs mcpToolCallCount/mcpResponseBytes），plan 阶段需澄清统一

### 4.5 §10 章节当前模板

**文件**：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md`，第 520-586 行

当前状态（2026-05-09 snapshot）：
- §10.2 Pass Rate 矩阵：全部 10 个 task × 3 group 均为 `<pending Stage 7b>`
- §10.3 Token Cost：两行为 `<pending: ...>`
- §10.4 结论：占位文字，预期论证逻辑已写入但数据空缺

占位文字结构（精确摘录）：
```
| SWE-L001-... | <pending Stage 7b> | <pending> | <pending> |
```
总结论段：`> **本节状态：dry-run 阶段（2026-05-09），Pass Rate / Token Cost 实测数据待 Stage 7b 实跑后填入**`

### 4.6 配额限制现状

- **`--max-runs-per-day` flag**：`scripts/eval-mcp-augmented.mjs` **不存在**此参数（`parseArgs` 中未定义）
- **`--stop-loss USD`** 已实现（默认 $40）：第 98-100 行；主循环 stop-loss 预检在第 796 行
- **`--max-judge-calls N`** 已实现（默认 20），但当前脚本中作为预留参数，未实际接入 judge 调用计数逻辑（第 103-106 行只解析，无实际使用）
- **.codex usage cache**：`~/.codex/usage*` 路径扫描无结果，代码库中**未实现**（整个 `scripts/` 中无引用）

### 4.7 bootstrap CI / token cost 估算实现

| 功能 | 实现状态 | 文件 |
|------|---------|------|
| bootstrap 95% percentile CI | **已实现** | `scripts/lib/bootstrap-ci.mjs`（`bootstrapPercentileCi`，第 47 行）|
| mean-percentile bootstrap（binary 0/1）| **已实现** | `scripts/eval-mcp-augmented-classic.mjs`，第 46-72 行 |
| cross-task 聚合层 bootstrap | **已实现** | `scripts/eval-feature-158-summary-classic.mjs`，第 123 行（`bootstrapB: ci.b`）|
| token cost 估算 | **已实现** | `scripts/lib/llm-pricing.mjs`（`estimateCost()`，第 34 行；`PRICING_TABLE` 含 GLM/Kimi/Opus/Sonnet/codex:gpt-5.5）|
| eval-mcp-augmented.mjs 内 costUsd | **暂置 null**（第 741 行注释：`估算 cost：实跑暂置 null 待未来 LLM token usage 集成`）|

---

## 5. 项目合同与脚本

### 5.1 release-contract.yaml version 字段

**文件**：`contracts/release-contract.yaml`

| product | version |
|---------|---------|
| spectra | `4.1.1` |
| spec-driver | `4.0.0` |

整体 marketplace version：`1.0.0`（第 8 行）

### 5.2 package.json scripts（相关命令清单）

**文件**：`package.json`，第 19-58 行（精确）

| 命令类别 | 命令名 | 对应脚本 |
|---------|------|--------|
| repo 同步 | `repo:sync` | `node scripts/repo-sync.mjs` |
| repo 检查 | `repo:check` | `node scripts/repo-check.mjs` |
| release 同步 | `release:sync` | `node scripts/sync-release-contracts.mjs` |
| release 检查 | `release:check` | `node scripts/validate-release-contracts.mjs` |
| eval 竞品 | `eval:competitor` | `node scripts/eval-competitor.mjs` |
| eval judge | `eval:judge` | `node scripts/eval-judge.mjs` |
| eval jury | `eval:judge-jury` | `node scripts/eval-judge-jury.mjs` |
| eval task runner | `eval:task-runner` | `node scripts/eval-task-runner.mjs` |
| eval report | `eval:report` | `node scripts/eval-report.mjs` |
| eval repeat | `eval:repeat` | `node scripts/eval-batch-repeat.mjs` |
| baseline 采集 | `baseline:collect` | `node scripts/baseline-collect.mjs` |
| baseline diff | `baseline:diff` | `node scripts/baseline-diff.mjs` |
| eval grounding | `eval:grounding` | `node scripts/eval-grounding.mjs` |

**注意**：`eval-mcp-augmented.mjs` 没有注册为 npm script（需直接 `node scripts/eval-mcp-augmented.mjs` 调用）。

### 5.3 vitest 基线

- **vitest 配置**：`package.json` 中 `test: "vitest run"`；dev 依赖含 `vitest: ^3.0.4`
- **历史 pass count**：报告第 584 行记录"vitest 全量 3484 PASS（含新增 telemetry + fuzzy-match 测试）"（2026-05-09 数据）
- **最新已知 pass count**：commit 77bf166 message 含"Stage 7b 关键科学结论"，具体数字需运行 `npx vitest run` 确认；`CLAUDE.local.md` 提到"3549 测试基线"（基于更新后的 master 状态）

---

## 6. 改动影响面表（Phase × File 矩阵）

| Phase | 文件路径 | 改动类型 | 风险信号 |
|-------|---------|---------|---------|
| 0 | `plugins/spec-driver/agents/plan.md` | tools 字段追加 `mcp__spectra__context, mcp__spectra__impact` | 包装产物需同步（`repo:sync`）|
| 0 | `plugins/spec-driver/agents/implement.md` | tools 字段追加 `mcp__spectra__context, mcp__spectra__impact` | 同上 |
| 0 | `plugins/spec-driver/agents/verify.md` | tools 字段追加 `mcp__spectra__detect_changes, mcp__spectra__impact` | 同上 |
| 0 | `plugins/spec-driver/agents/quality-review.md` | tools 字段追加 `mcp__spectra__impact, mcp__spectra__context` | 同上 |
| 0 | `plugins/spec-driver/agents/spec-review.md` | tools 字段追加 `mcp__spectra__impact, mcp__spectra__context` | 同上 |
| 0 | `contracts/release-contract.yaml` | `spec-driver.version` 升 minor（4.0.0 → 4.1.0）| release:check / release:sync 必须同步 |
| A | `scripts/eval-task-executor.mjs` | `callExecutor` 重构为 multi-backend / 或新增 codex driver | 与 jury 的 `parseJudgeBackend` 逻辑需对齐 |
| A | `scripts/eval-judge-jury.mjs`（可选）| `DEFAULT_JUDGES` 修改 | 影响全量 `eval:judge-jury` 默认行为 |
| A | `scripts/lib/llm-pricing.mjs`（可能）| 新增 Codex executor pricing | 影响 SC-008 budget 计算 |
| B | `scripts/eval-judge-jury.mjs` | `DEFAULT_JUDGES` 替换为 GLM judge 组合 | 影响全量 25 fixture 重跑；旧 fixture juryScores 作废 |
| B | `scripts/eval-judge-jury.mjs` | `buildAdversarialPrompt` 微调 rubric | 可能影响历史分数可比性 |
| C | `scripts/eval-mcp-augmented.mjs` | 实跑路径 dry-run 限制移除；driver 改 Codex | claude-sonnet 硬编码在 `buildClaudeArgsWithMcp`（第 405 行）|
| C | `specs/147-.../competitive-evaluation-report.md` | §10 Pass Rate 矩阵填入真实数据 | 文档写入 |

---

## 7. 风险与已知 gap

1. **callExecutor 与 parseJudgeBackend 不共享 backend 抽象**：executor 当前无 multi-backend dispatch，Phase A 重构需决定是（a）在 `eval-task-executor.mjs` 内复制类似 `parseJudgeBackend` 的逻辑，还是（b）提取 `scripts/lib/llm-backend-dispatcher.mjs` 共用。两路径影响接口设计，须 plan 阶段明确。

2. **eval-mcp-augmented.mjs 的 costUsd 暂置 null**：实跑路径中 token usage 未接入（第 741 行注释），导致 §10.3 Token Cost 对比数据缺失。需在 Stage 7b 集成 `scripts/lib/llm-pricing.mjs` 的 `estimateCost()`，但 claude CLI `--output-format text` 不返回 usage（需改为 `--output-format json` 或从 stderr 解析）。

3. **mcpToolCallTrace vs mcpToolCallCount 命名不统一**：`eval-task-runner.mjs`（schema 1.2）用 `perf.mcpToolCallTrace` 数组；`eval-mcp-augmented.mjs` 用 `mcpToolCallCount` + `mcpResponseBytes` 扁平字段；两脚本产出的 run-N.json 结构不一致，后续 `eval-feature-158-summary-classic.mjs` 聚合层须统一 schema。

4. **`--max-runs-per-day` / `.codex usage cache` 均未实现**：Codex CLI 使用 ChatGPT Pro 周配额，Stage 7b 执行 Codex 作 driver 时存在超额风险（jury codex judge 已有此问题，用 `reasoning_effort=high` 缓解）。配额防护需 plan 阶段决策：是否新增 `--max-runs-per-day`，或依赖现有 `--stop-loss`。

5. **Pearson correlation（jury score vs oracle pass rate）未实现**：Phase B GLM judge calibration 若需 Pearson 相关系数验证，须从零实现或引入 `simple-statistics` 包（但 `scripts/lib/bootstrap-ci.mjs` 设计原则是"零依赖"，需确认引入第三方包是否符合约束）。

6. **spec-driver version 升级后 marketplace cache 问题**：用户本地已安装 `4.0.0` cache（`~/.claude/plugins/cache/.../4.0.0/`），升版到 `4.1.0` 后 sub-agent 工具变更在用户重装前不生效。Phase 0 完成后需给出用户操作指引（upgrade 命令）。

---

## 8. 关键事实指针

供 specify / plan 阶段直接引用，避免重复 grep：

1. **5 个 agent frontmatter 位置**：`plugins/spec-driver/agents/{plan,implement,verify,quality-review,spec-review}.md` 第 1-4 行（YAML 头）；工具列表精确内容见 §1.1

2. **callExecutor 函数**：`scripts/eval-task-executor.mjs` 第 176-193 行；只支持 OpenAI-compat；`DEFAULT_EXECUTOR_MODEL = 'Pro/zai-org/GLM-5.1'`（第 39 行）

3. **parseJudgeBackend 函数**：`scripts/eval-judge-jury.mjs` 第 91-135 行；4 backend + 1 legacy anthropic；codex CLI spawn 实现在同文件第 347-384 行

4. **DEFAULT_JUDGES 当前值**：`scripts/eval-judge-jury.mjs` 第 79-83 行（Opus + GPT-5.5 + Kimi-K2.6）

5. **buildAdversarialPrompt 内联 rubric**：`scripts/eval-judge-jury.mjs` 第 243-278 行；0-10 整数，4 维度，无外部模板文件

6. **bootstrapPercentileCi 实现**：`scripts/lib/bootstrap-ci.mjs` 第 47 行；pure function，零依赖，N<3 返回 `insufficient-samples`

7. **token cost 估算（PRICING_TABLE）**：`scripts/lib/llm-pricing.mjs` 第 12-26 行；含 GLM-5.1 / Kimi-K2.6 / claude-opus-4-7 / claude-sonnet-4-6 / codex:gpt-5.5

8. **SWE-L001~L010 fixture**：`tests/baseline/swe-bench-lite/fixtures/SWE-L00{1-10}*.json`（10 个文件已入库）

9. **§10 pass rate 矩阵**：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 第 543-555 行；全部 `<pending Stage 7b>` 占位

10. **eval-mcp-augmented.mjs Group A/B/C 定义**：第 71-125 行（parseArgs）；hardcoded `claude-sonnet-4-6`（第 405 行）；stop-loss 默认 $40（第 79 行）；`--max-runs-per-day` 不存在
