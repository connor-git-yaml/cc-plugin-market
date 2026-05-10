---
feature_id: 162
phase: plan
status: codex-reviewed-iter-4
generated_at: 2026-05-10
spec_status: codex-reviewed-final
base_commit: 77bf166
review_history:
  - iter: 1
    findings: "4 critical + 4 warning"
    blocked_commit: true
  - iter: 2
    findings: "0 critical + 0 warning（首轮残留全修）"
    blocked_commit: false
  - iter: 3
    findings: "1 critical + 3 warning（二轮新发现）"
    blocked_commit: false
  - iter: 4
    findings: "0 critical + 3 warning（三轮 plan 细节修订：W-8/W-9/W-10）"
    blocked_commit: false
---

# Feature 162 — Architecture Plan

> 配套 spec：`spec.md`（status: codex-reviewed-final, 0 critical / 0 warning）
> 配套调研：`research/tech-research.md`（codebase-scan-only, 含精确路径 + 行号）
> 配套清单：`checklist.md`（68 items, ~38h + ~$20 LLM 调用）

> **iter-2 修订摘要**：本版本针对第一轮 codex review 的 4 critical + 4 warning 全量修复。关键变化：
> 1. (C-1) 保留 `callExecutor({ model, prompt, baseURL, apiKey })` 兼容签名作为 thin wrapper，内部 delegate 到 `callBackend({ model, prompt, options })`，25 既有 fixture 调用链零破坏
> 2. (C-2) `normalizeModelId` 顺序改为 `trim → toLowerCase → 剥 backend prefix → 剥 vendor org prefix → alias`；MODEL_ALIASES 补全 Haiku 4.5 + Sonnet 4.6 dot/hyphen 变体
> 3. (C-3) quota lock 仅在 reservation 期间持有（<10ms），LLM spawn / judge / oracle 全部无锁运行
> 4. (C-4) `inheritance_status` 从 2 状态扩展为 3 状态（`available` / `unavailable` / `unknown`）；定义 `subAgentMeta` schema + 采集协议；spec FR-037 同步升级（由主编排器写回 spec.md）
> 5. (W-1) run-N.json atomic tmp+rename + stale threshold 30min + per-run pid lock，partial 探测无 ABA 风险
> 6. (W-2) 新增 FR-014 retry matrix 测试组（4 case：transient/quota/截断/schema-invalid），vitest 总数 21 → 25
> 7. (W-3) Phase B 拆为 B1（与 A 并行，仅配置改动）+ B2（A 完成后，跑批 + 阈值判定）
> 8. (W-4) 5 个 fixture id 定型为 `SWE-L001/L003/L005/L007/L009`，每 task type ≤ 2 个

> **iter-3 修订摘要**：本版本针对第二轮 codex review 的 1 critical + 3 warning 修复（仅修，不重设计）：
> 1. (C-5) §2.4.5 `subAgentMeta` 双轨采集冲突解决：明确 `self-report > env-injected` 优先级；新增 `confidence` 字段 + `collectIssues` 冲突探测条目
> 2. (W-5) §2.3.3 finally block 失败兜底：driver/jury/oracle 异常路径写 finalized run-N.json + `error.phase` + `status: 'failed'`，partial 三分类不再把"failed finalized"归为 stale
> 3. (W-6) §2.3.8 跨进程并发 vitest 补 child script 接口（`tests/helpers/quota-fork-helper.mjs`）+ vitest pool='forks' 配置
> 4. (W-7) §2.3.6 `const meta` scope 修正为 `let meta = null` 提到 try 外，catch 块据 meta 是否 null 区分错误源
>
> 新增 vitest case：1 个（finally 兜底 failed-finalized）。总数：26 → **27**。

> **iter-4 修订摘要**：本版本针对第三轮 codex review 的 0 critical + 3 warning 修复（仅修 plan 细节，不重设计、不增 vitest case）：
> 1. (W-8) §2.4.5 `mergeSubAgentMeta` 改字段级 fallback：每字段独立选 source（self-report 优先回退到 env），避免 self-report 仅报 version 时 tools/loadSource 被 undefined 覆盖丢失
> 2. (W-9) §2.3.3 catch block 改 nested try-catch + 二级防御：兜底写 finalized 自身失败时 log 双错误并 **rethrow 原 error**，不被 fallback 失败掩盖；run-N.json 留 partial → 30min 后 stale 探测兜底回收
> 3. (W-10) §2.6.5 异常分析模板补 §10.5.5 跑批失败 run 统计小节：列 `failedFinalized` / `partialStale` / `total_runs` 与 5% 阈值，超阈值要求分析 `error.phase` 分布
>
> 不新增 vitest case：W-8 字段级合并已被 §2.4.5 降级语义对照表覆盖；W-9 二级防御场景属于灾难态测试，由 §6 风险章节兜底；W-10 仅扩报告 schema。总 case 仍 **27**。

---

## 0. Plan 阶段 clarification 决议

承接 `clarification.md` 列出的 3 项阻断歧义 + 4 项可顺带歧义。

### 0.1 每 fixture 运行次数固化（FR-022 / FR-023 / FR-024）

- **决议**：**5 fixture × 3 runs = 15 数据点**（满足 FR-023 统计功效约束）。
- **运行编排**：每 fixture 调用同一 prompt 3 次（`--repeat 3`），收集每 run 的 `oracle.pass`（bool）与 `judgeScore.overall`（0-10 整数）。
- **5 个 fixture id 定型**（iter-2 修订 W-4，覆盖 4 种 task type，每种 ≤ 2 个）：

  | fixture id | task_type | 抽样理由 |
  |-----------|-----------|---------|
  | `SWE-L001` | bug-fix | 历史 oracle.pass=true 占多数；代表 happy path |
  | `SWE-L003` | refactor | 跨函数改动；代表中等复杂度 |
  | `SWE-L005` | feature-add | 新增功能（含新文件）；与 bug-fix 分离 |
  | `SWE-L007` | refusal-candidate | 拒答测试候选；GLM/Codex 历史拒答信号 |
  | `SWE-L009` | cross-file-edit | 跨文件修改；与 refactor 分离 |

  task type 分布：bug-fix=1, refactor=1, feature-add=1, refusal-candidate=1, cross-file-edit=1（5 类型，每类型 1 个；满足"每 task type 最多 2 个 fixture"约束）。
- **calibration artifact 字段补充**：`calibration-fixture-list.json` schema：

  ```json
  {
    "fixtures": [
      { "id": "SWE-L001", "label": "pass", "task_type": "bug-fix", "runs_per_fixture": 3 },
      { "id": "SWE-L003", "label": "pass", "task_type": "refactor", "runs_per_fixture": 3 },
      { "id": "SWE-L005", "label": "pass", "task_type": "feature-add", "runs_per_fixture": 3 },
      { "id": "SWE-L007", "label": "refusal", "task_type": "refusal-candidate", "runs_per_fixture": 3 },
      { "id": "SWE-L009", "label": "fail", "task_type": "cross-file-edit", "runs_per_fixture": 3 }
    ],
    "total_data_points": 15,
    "selection_strategy": "stratified: pass≥3, fail≥1, refusal≥1, ≥4 task types, ≤2 per type",
    "exemption_log": [],
    "frozen_at": "2026-05-10",
    "rationale_for_n3": "FR-023 要求 ≥15 数据点；n=15 时 r=0.6 对应 p≈0.018 (<0.05 显著)",
    "frozen_ids_immutable": "Phase B 启动后不允许换 fixture；如某 id 不可用须记录到 exemption_log 并 plan-revision"
  }
  ```

- **不允许**临时随机选 fixture；calibration 重测必须复用同一列表（rubric 调整后重测复用同 15 数据点保证可比性）。

### 0.2 `--accept-partial` vs `--restart-partial` 互斥语义（FR-032 / EC-008）

- **决议**：两 flag 互斥；同时传入时 **exit code 64**（sysexits.h `EX_USAGE`）。
- **错误信息**：

  ```
  error: --accept-partial and --restart-partial are mutually exclusive.
    --accept-partial:  保留 partial run-N.json，记为"已耗 1 配额但失败"
    --restart-partial: 删除 partial run-N.json，下一轮重新分配 N 编号（再耗 1 配额）
  请只选其一后重新运行。
  ```

- **不传任一 flag**：仅打印 unfinished 报告（partial run 列表 + finalized run 计数），exit 0，不修改状态。
- **stale 判定**（iter-2 修订 W-1 + iter-3 修订 W-5）：partial run 仅在 `started_at` 早于 30 分钟前 **且** 无 active per-run lock **且无 `finalized_at`** 时才视为 stale；新鲜的 partial（active writer 正在跑）打印为 `running`，**不允许 --restart-partial 删除**；含 `finalized_at` + `status:'failed'` 的 run 视为 failed-finalized（已配额已账面），**不归 partial**，仅在 reporting 阶段统计为 `failed runs`。

### 0.3 IoU / Pearson 计算粒度（FR-022 / FR-023）

- **IoU 计算粒度（决议：overall）**：基于全部 5 fixture × 3 runs = **15 数据点**，将每个 (fixture, run-id) 视作一个独立观察单元。
  - oracle pass-rate IoU：把 `{(fixture_id, run_id) | oracle.pass=true by GLM}` 与 `{... by Codex judge}` 做集合求 |交∩| / |并∪|。
  - surface refusal IoU：同上，集合元素为 (fixture_id, run_id) 中 `judge.refusal_detected=true` 的子集。
- **Pearson correlation 计算粒度（决议：15 数据点级）**：
  - X = GLM judge 给出的 quality score（per (fixture_id, run_id)，0-10 整数），共 15 个值。
  - Y = oracle.pass 对应的 0/1 二值（per (fixture_id, run_id)），共 15 个值。
  - 用 Pearson `r = Σ((Xi-X̄)(Yi-Ȳ)) / sqrt(Σ(Xi-X̄)² · Σ(Yi-Ȳ)²)`；零依赖实现。
- **不做**fixture 级聚合后再算 Pearson（n=5 统计功效不足，已在 FR-023 决议）。

### 0.4 顺带歧义决议

- **10K tokens 阈值来源**（FR-031）：标注为"经验估算（来自 Feature 158 Stage 7a 的 sonnet driver 测量基线）"；最终是否分批由 pilot 27 runs 实测决定，本 plan 不预设。
- **`claude plugin update` fallback**（FR-006）：plan 阶段验证命令存在；若不可用，等价 fallback：`rm -rf ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0 && npm run repo:sync && claude /reload`（手动删 cache 重 reload）。Smoke D Test 3 报告记录实际使用的命令路径。
- **Bootstrap B 值**（FR-034）：使用 `bootstrapPercentileCi` 库默认 B=1000；若 §10.2 单元格的 95% CI 宽度 > 0.4 则升至 B=10000 重算（仅个别极端 cell 需要）。
- **Codex driver token cost 折算**（FR-035）：§10.3 列 `costUsd: $0 (subscription)` 的同时记录 `tokensIn/tokensOut`（从 codex CLI stderr 解析），不做订阅均摊。

### 0.5 spec FR-037 同步升级（iter-2 新增, C-4）

`inheritance_status` 由 2 状态升至 3 状态。**plan 阶段产出修订版 FR-037 文本，由主编排器写回 spec.md**：

```markdown
**FR-037（iter-2 修订）**: §10.5 表格的 `inheritance_status` 字段必须采用 3 值枚举：

| 值 | 判定条件 | 语义 |
|----|---------|------|
| `unavailable` | (i) `mcpToolCalls` 含 `error='tool-not-available'`；或 (ii) `subAgentMeta.specDriverVersion` < 4.1.0 | sub-agent 没拿到 mcp 工具继承 |
| `available` | (a) `mcpToolCalls.length > 0` 且无 `tool-not-available` 错误；或 (b) `subAgentMeta.specDriverVersion` >= 4.1.0 且无 unavailable 信号 | 工具继承正常 |
| `unknown` | 既无 unavailable 信号，又无 mcp 调用迹象（length=0），且 `subAgentMeta.specDriverVersion` 缺失 | 无法判定（不再默认为 available） |

判定优先级：unavailable 信号 > available 信号 > unknown 兜底。`unknown` 占比 > 10% 视为采集质量异常，须在异常分析章节解释。
```

---

## 1. 模块拓扑

### 1.1 文件树（Phase × 影响）

```
specs/162-codex-driver-glm-judge-eval/
├── plan.md                       (本文件)
├── calibration-fixture-list.json (Phase B1 落地; 0.1 决议; 5 个 frozen ids)
└── codex-reviews/
    ├── phase-0.md
    ├── phase-a.md
    ├── phase-b.md
    └── phase-c.md

scripts/
├── eval-task-executor.mjs        [A: 保留 callExecutor 兼容签名 + 新增 callBackend delegate]
├── eval-judge-jury.mjs           [A: 抽离 dispatcher; B1: DEFAULT_JUDGES]
├── eval-mcp-augmented.mjs        [C: --max-runs-per-day + quota lock + canonical schema + subAgentMeta 注入]
├── eval-task-runner.mjs          [C: rename mcpToolCallTrace → mcpToolCalls]
├── calibrate-glm-judge.mjs       [B2: 跑批 + IoU/Pearson + 阈值判定]
└── lib/
    ├── llm-backend-dispatcher.mjs       (新建; A; 含 callBackend / normalizeModelId / MODEL_ALIASES)
    ├── llm-pricing.mjs                  (验证已含 codex:gpt-5.5)
    ├── pearson.mjs                      (新建; B2)
    └── eval-quota-store.mjs             (新建; C; quota lock + run-N.json atomic + per-run lock)

plugins/spec-driver/agents/        [0: 5 个 frontmatter]
contracts/release-contract.yaml    [0: 4.0.0 → 4.1.0]

specs/147-competitor-evaluation-platform/
└── competitive-evaluation-report.md     [C: §10.1-§10.5 数据填入]

tests/
├── eval-llm-backend-dispatcher.test.mjs (新建; A: 8 case 基础 + 4 case retry matrix = 12 case)
├── eval-self-judge-hard-fail.test.mjs   (新建; A: 5 case)
├── eval-pearson.test.mjs                (新建; B2: 5 case)
├── eval-quota-store.test.mjs            (新建; C: 4 case + 1 failed-finalized 兜底 case = 5 case, iter-3 W-5)
└── helpers/
    └── quota-fork-helper.mjs            (新建; C; iter-3 W-6; vitest 跨进程并发 child script)

~/.cache/spectra/eval-quota/       (运行时;不入库)
├── feature-162.json                     (quota state)
├── feature-162.lock                     (O_EXCL lock; 仅 reservation 期间持有)
└── feature-162-history.jsonl            (7 天 rotate)

<feature-runs-dir>/                (运行时;不入库)
├── run-1.json                           (atomic tmp+rename 写盘; 含 finalized_at + status: success|failed)
├── run-1.lock                           (per-run pid lock; 标记 active writer)
├── run-2.json
├── run-2.lock
└── ...
```

### 1.2 数据流（Phase C 主路径，iter-2 修订 C-3 + iter-3 修订 W-5）

```
eval-mcp-augmented.mjs runOne()
  ↓ [self-judge hard-fail check; 进程内 in-memory，无 IO]
  ↓ ┌─ acquireQuotaLock()                                    ← 短锁开始 (毫秒级)
  ↓ │  read store
  ↓ │  check date / runs <= max-per-day
  ↓ │  append new run_id, runs++
  ↓ │  atomic write store (tmp+rename)
  ↓ └─ releaseQuotaLock()                                    ← 短锁结束
  ↓
  ↓ [acquire per-run lock: runs/run-N.lock with PID + ts]
  ↓ atomic write run-N.json {started_at, run_id}
  ↓
  ↓ try {
  ↓   buildClaudeArgsWithMcp() → spawnClaudeAndWait()        ← 无锁，N runs 可并行
  ↓   parseTelemetryJsonl() → mcpToolCalls[] (canonical)
  ↓   collectSubAgentMeta() → {specDriverVersion, frontmatterTools, loadSource, confidence, collectedVia}
  ↓   oracle 评判 + jury 评分（callExecutor / callBackend + eval-judge-jury）
  ↓   atomic write run-N.json {finalized_at, status:'success', ...}
  ↓ } catch (err) {
  ↓   atomic write run-N.json {finalized_at, status:'failed', error:{phase,message,stack}}    ← iter-3 W-5 兜底
  ↓ } finally {
  ↓   release per-run lock
  ↓ }
```

**关键：步骤 1（quota lock）持锁时长 < 10ms（仅文件 IO），不覆盖 LLM spawn / await。450 runs 配额预留累计耗时 < 5s（远低于 LLM 总耗时 ~6h）。**
**iter-3 关键：finally 路径必写 finalized_at（success 或 failed），永远不留 partial run-N.json。**

---

## 2. 6 个核心模块详细设计

### 2.1 `scripts/lib/llm-backend-dispatcher.mjs`（Phase A）

#### 2.1.1 导出 API

```
// 主入口（新签名）
export async function callBackend({ model, prompt, options }):
  返回: { text, promptTokens, completionTokens, finishReason, raw, partial }

// model identifier 规范化（self-judge 检查 + alias 解析共用）
export function normalizeModelId(modelStr):
  返回: string  (剥离 prefix + case-fold + alias 映射后的稳定 id)

// 别名映射常量
export const MODEL_ALIASES = { ... }

// 错误分类（retry matrix 用）
export function classifyError(err, finishReason, text):
  返回: 'transient' | 'quota' | 'truncation' | 'schema-invalid' | 'unknown'
```

#### 2.1.2 兼容层：`callExecutor` 保留签名（iter-2 修订 C-1）

为保护 25 既有 fixture 与 repeat-runner 等外部调用，**`scripts/eval-task-executor.mjs` 中的 `callExecutor` 保留原签名作为 thin wrapper**：

```js
// scripts/eval-task-executor.mjs (保持现有 export)
import { callBackend } from './lib/llm-backend-dispatcher.mjs';

export async function callExecutor({ model, prompt, baseURL = DEFAULT_BASE_URL, apiKey }) {
  // 兼容层：对象参数调用，内部 delegate 到 callBackend
  // model 不带 backend prefix 时默认 'siliconflow:' (向后兼容现有 GLM 调用)
  const fullModel = model.includes(':') ? model : `siliconflow:${model}`;
  return await callBackend({
    model: fullModel,
    prompt,
    options: { baseURL, apiKey, timeoutMs: 240000, temperature: 0.3, maxTokens: 8000 },
  });
}
```

**plan 中所有"伪码 `callExecutor(driver, fixture.prompt)` 位置参数调用"全部改写为对象参数 `callExecutor({ model: driver, prompt: fixture.prompt })`**。Phase B2 calibration runner 也用对象参数。新代码（dispatcher / calibrate-glm-judge / jury）一律使用 `callBackend({ model, prompt, options })`。

#### 2.1.3 `callBackend` 签名

| 参数 | 类型 | 说明 |
|------|------|------|
| `model` | string | 形如 `siliconflow:Pro/zai-org/GLM-5.1` / `codex:gpt-5.5` / `claude-cli:claude-opus-4-7` / `openai:gpt-5` |
| `prompt` | string | 用户消息正文（callExecutor 与 jury 共用） |
| `options` | object | `{ temperature?, maxTokens?, reasoningEffort?, timeoutMs?, baseURL?, apiKey? }` |

返回 shape（4 backend 统一）：

```
{
  text:              string,                         // 模型输出
  promptTokens:      number | null,                  // codex CLI 不返回分项 → null
  completionTokens:  number | null,
  finishReason:      'stop' | 'length' | 'error',    // 标准化枚举
  raw:               object,                         // 原始 SDK 返回（便于审计）
  partial:           boolean                         // finishReason='length' 且内容截断
}
```

#### 2.1.4 4 个 backend handler 函数签名

```
internal handleSiliconflow({ model, prompt, options }) →
  调用 OpenAI SDK, baseURL='https://api.siliconflow.cn/v1', apiKey=SILICONFLOW_API_KEY
  返回: 标准 shape

internal handleOpenai({ model, prompt, options }) →
  调用 OpenAI SDK, baseURL='https://api.openai.com/v1', apiKey=OPENAI_API_KEY
  返回: 标准 shape

internal handleClaudeCli({ model, prompt, options }) →
  spawn 'claude' ['--model', model, '--output-format', 'json', '--prompt', prompt]
  parse stdout JSON: { result, usage: { input_tokens, output_tokens } }
  返回: 标准 shape

internal handleCodexCli({ model, prompt, options }) →
  spawn 'codex' ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
                 '-c', `model_reasoning_effort="${options.reasoningEffort||'medium'}"`,
                 '-m', model, '--output-last-message', tmpFile, prompt]
  read tmpFile (text)；parse stderr 正则 `/tokens used\s*\n\s*([\d,]+)/`
  返回: { ..., promptTokens: null, completionTokens: total, finishReason: 'stop' }
```

#### 2.1.5 Token usage 字段映射表

| backend | promptTokens 来源 | completionTokens 来源 | finishReason 来源 |
|---------|------------------|---------------------|------------------|
| siliconflow | `r.usage.prompt_tokens` | `r.usage.completion_tokens` | `r.choices[0].finish_reason` 直传 |
| openai | 同 siliconflow | 同 siliconflow | 同 siliconflow |
| claude-cli | `parsed.usage.input_tokens` | `parsed.usage.output_tokens` | `parsed.stop_reason` → 标准化（`end_turn`→`stop`, `max_tokens`→`length`）|
| codex-cli | **null**（CLI 不返回分项） | stderr 正则 total | 默认 `stop`；如 stderr 含 `truncated` 则 `length` |

#### 2.1.6 Retry 决策矩阵实现（iter-2 修订 W-2 强化）

错误分类识别凭据（`classifyError(err, finishReason, text)`）：

| 类别 | 识别凭据 | retry 行为 | 写入 `run-N.json.error` |
|------|---------|-----------|------------------------|
| transient | `err.code in ['ECONNRESET','ETIMEDOUT','EAI_AGAIN']` 或 HTTP 5xx | retry 1 次, 间隔 2s | retry 失败后 `{code:'transient', retryable:true}` |
| quota | HTTP 429 / 文本含 `quota_exceeded`/`rate_limit_exceeded`/`insufficient_quota` | **禁止 retry** | `{code:'quota', retryable:false}` |
| truncation | `finishReason==='length'` 且 text 末尾不闭合 JSON / 不含终止符 | **禁止 retry** | `{code:'truncated', partial:true}` |
| schema-invalid | JSON.parse 失败 / Zod 校验失败 | **禁止 retry** | `{code:'schema-invalid', rawResponse:'<snippet>'}` |
| unknown | 上述都不匹配 | **禁止 retry** | `{code:'unknown', message:err.message}` |

**iter-2 新增：FR-014 retry matrix vitest case（4 case，强制覆盖）**：

| case | 触发条件 | 期望 retry 次数 | 期望最终结果 |
|------|---------|---------------|-------------|
| RM-1 transient → success | mock fetch 第一次抛 503，第二次返回 200 | 1 retry | `{ ok: true, retried: 1 }` |
| RM-2 quota → fail | mock fetch 抛 429 | 0 retry | `{ ok: false, error.code: 'quota' }` |
| RM-3 truncation → fail | mock 返回 `finishReason='length'` 且 text 末尾 `{"diff":"--- a` | 0 retry | `{ ok: false, error.code: 'truncated', partial: true }` |
| RM-4 schema-invalid → fail | mock 返回 text 为 `not a json` | 0 retry | `{ ok: false, error.code: 'schema-invalid', rawResponse: 'not a json' }` |

#### 2.1.7 `normalizeModelId` 算法步骤（iter-2 修订 C-2，顺序更正）

**关键修订：必须先 `toLowerCase()` 再剥 prefix**（避免大小写敏感导致 `Codex:GPT-5.5` 漏剥）。

```js
function normalizeModelId(s):
  step1 = s.trim()
  step2 = step1.toLowerCase()                                                  // <-- 先 case-fold
  step3 = step2.replace(/^(siliconflow|openai|claude-cli|codex|anthropic):/, '') // 剥 backend prefix
  step4 = step3.replace(/^(pro\/zai-org\/|pro\/moonshotai\/|anthropic\/)/, '')   // 剥 vendor org prefix
  step5 = MODEL_ALIASES[step4] ?? step4                                         // 别名映射
  return step5
```

**为什么改顺序**：v1 的 `replace(/^codex:/, '')` 是大小写敏感的字符串前缀匹配。`Codex:GPT-5.5` 不会被剥 prefix，进入 alias 表后 lookup 失败，最终对比时 `'Codex:GPT-5.5' !== 'gpt-5.5'`，self-judge 漏报。改为先 `toLowerCase()` 后 `'codex:gpt-5.5'`，prefix 正常剥除，alias 命中 `gpt-5.5`。

#### 2.1.8 `MODEL_ALIASES` 常量内容（iter-2 修订 C-2，补全 Haiku 4.5 + Sonnet 4.6 dot/hyphen 变体）

**重要：所有 key 必须是 lowercase**（因 normalize 步骤已先 toLowerCase；表内若混入大写 key 永远命不中）。

```js
{
  // OpenAI 系
  'gpt-5.5': 'gpt-5.5',
  'gpt5.5':  'gpt-5.5',
  'gpt-5-5': 'gpt-5.5',
  'gpt5-5':  'gpt-5.5',

  // Zhipu GLM 系
  'glm-5.1': 'glm-5.1',
  'glm5.1':  'glm-5.1',
  'glm-5-1': 'glm-5.1',
  'glm5-1':  'glm-5.1',

  // Claude Opus 4.7
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-opus-4.7': 'claude-opus-4-7',
  'opus-4-7':        'claude-opus-4-7',
  'opus-4.7':        'claude-opus-4-7',

  // Claude Sonnet 4.6（iter-2 补全 dot/hyphen）
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet-4-6':        'claude-sonnet-4-6',
  'sonnet-4.6':        'claude-sonnet-4-6',

  // Claude Haiku 4.5（iter-2 新增）
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  'haiku-4-5':        'claude-haiku-4-5',
  'haiku-4.5':        'claude-haiku-4-5',

  // Claude Haiku 4.7（保留）
  'claude-haiku-4-7':  'claude-haiku-4-7',
  'claude-haiku-4.7':  'claude-haiku-4-7',
  'haiku-4-7':         'claude-haiku-4-7',
  'haiku-4.7':         'claude-haiku-4-7',

  // Moonshot Kimi K2.6
  'kimi-k2.6':       'kimi-k2.6',
  'kimi-k2-6':       'kimi-k2.6',
}
```

#### 2.1.9 25 既有 fixture byte-stable 回归策略

- **不要求内容相同**（GLM driver 与 Codex driver 输出文本必然不同）。
- **要求**：JSON schema 字段集合 byte-stable——
  1. `JSON.stringify(Object.keys(deepSort(obj)))` 在 GLM 旧 fixture 与 Codex 新 fixture 间相等。
  2. 字段类型（typeof）相同；nullable 字段在两版中都 nullable。
  3. 验证脚本：`scripts/verify-feature-162-fixture-schema-stable.mjs`（新建，PA-T3 用）。
- **不回填**既有 25 fixture（CLAUDE.local.md 入库边界明确：task fixture 不入库，含 LLM 随机性）。
- **callExecutor 兼容性**：因 callExecutor 保留对象参数签名 + 默认 backend=siliconflow，旧 caller `callExecutor({ model: 'Pro/zai-org/GLM-5.1', prompt, apiKey })` 无需改动即可继续工作。

---

### 2.2 self-judge hard-fail 检查实现（Phase A）

#### 2.2.1 入口位点（同一 `assertNoSelfJudge` 函数被 3 处调用）

| 文件 | 调用位点 | 触发时机 |
|------|---------|---------|
| `scripts/eval-mcp-augmented.mjs` | `parseArgs()` 之后、`runForTaskList()` 之前 | 启动 batch 前一次性检查 |
| `scripts/eval-judge-jury.mjs` | jury CLI 入口（main 函数顶部） | `eval:judge-jury` 直跑时 |
| `scripts/eval-task-executor.mjs` | `executeOnFixture()` 入口 | 单 fixture 跑批时 |

#### 2.2.2 函数签名 + 算法

```js
import { normalizeModelId } from './lib/llm-backend-dispatcher.mjs';

export function assertNoSelfJudge({ driver, judges }):
  driver: string  (e.g., 'codex:gpt-5.5')
  judges: string[] (e.g., ['claude-cli:claude-opus-4-7', 'siliconflow:Pro/zai-org/GLM-5.1', ...])

algorithm:
  driverNorm = normalizeModelId(driver)
  judgeNorms = judges.map(normalizeModelId)

  // jury 内部重复警告（不阻断）
  duplicates = findDuplicates(judgeNorms)
  if duplicates.length > 0:
    console.warn(`[warn] jury 内部重复 judge: ${duplicates}, 用户自负风险`)

  // self-judge hard-fail
  conflict = judges.find((j, i) => judgeNorms[i] === driverNorm)
  if conflict:
    throw new Error(formatSelfJudgeError(driver, conflict, driverNorm))

function formatSelfJudgeError(driverRaw, judgeRaw, normalized):
  return `
[FATAL] self-judge 禁忌触发：driver 与 jury judge 解析为同一模型。
  driver (raw):       ${driverRaw}
  jury judge (raw):   ${judgeRaw}
  normalized id:      ${normalized}
请检查 SPECTRA_EVAL_EXECUTOR / --judges / DEFAULT_JUDGES 配置。
`.trim()
```

#### 2.2.3 5 组单元测试输入输出（iter-2 修订 C-2，明确 input → expected output）

| Case | driver 输入 | judges 输入 | normalize 后 driver | normalize 后 judges | 期望行为 |
|------|------------|------------|---------------------|--------------------|---------|
| (a) | `codex:gpt-5.5` | `[claude-cli:claude-opus-4-7, codex:gpt-5.5, siliconflow:Pro/moonshotai/Kimi-K2.6]` | `gpt-5.5` | `[claude-opus-4-7, gpt-5.5, kimi-k2.6]` | **throw**, 错误信息含 `gpt-5.5` 与 raw `codex:gpt-5.5` |
| (b) | `siliconflow:Pro/zai-org/GLM-5.1` | `[siliconflow:Pro/zai-org/GLM-5.1, claude-cli:claude-opus-4-7]` | `glm-5.1` | `[glm-5.1, claude-opus-4-7]` | **throw**, normalized=`glm-5.1` |
| (c) | `codex:gpt-5.5` | `[Codex:GPT-5.5, claude-cli:claude-opus-4-7]` | `gpt-5.5` | `[gpt-5.5, claude-opus-4-7]` | **throw**, normalized=`gpt-5.5`（验证大小写归一 + alias 双重剥除）|
| (d) | `codex:gpt-5.5` | `[claude-cli:claude-opus-4-7, glm-5.1, claude-cli:claude-opus-4-7]` | `gpt-5.5` | `[claude-opus-4-7, glm-5.1, claude-opus-4-7]` | **console.warn 但不 throw**（jury 内部重复仅警告，不与 driver 冲突） |
| (e) | `codex:gpt-5.5` | `[claude-cli:claude-opus-4-7, siliconflow:Pro/zai-org/GLM-5.1, siliconflow:Pro/moonshotai/Kimi-K2.6]` | `gpt-5.5` | `[claude-opus-4-7, glm-5.1, kimi-k2.6]` | 静默通过（无 warn 无 throw）|

---

### 2.3 Quota state store + O_EXCL lock（Phase C, iter-2 修订 C-3 + W-1, iter-3 修订 W-5/W-6/W-7, iter-4 修订 W-9）

#### 2.3.1 文件路径与 schema

`~/.cache/spectra/eval-quota/feature-162.json`：

```
{
  "schemaVersion": "1.0",
  "feature": "162",
  "date": "2026-05-10",                                 // calendar day
  "timezone": "Asia/Shanghai",                          // IANA name
  "runs": 27,                                           // 当日已用 run 计数
  "run_ids": ["sweL001-A-1", "sweL001-A-2", ...],       // 已分配的 run 标识（去重）
  "updatedAt": "2026-05-10T18:23:14.512+08:00"
}
```

历史文件 `feature-162-history.jsonl`（每行一个 daily snapshot，rotate 7 天）：

```
{"date":"2026-05-09","runs":150,"run_ids":[...],"finalizedAt":"2026-05-09T23:59:00+08:00"}
```

#### 2.3.2 Lock 文件格式

`~/.cache/spectra/eval-quota/feature-162.lock`（plain text，单行）：

```
{"pid":12345,"createdAt":"2026-05-10T18:23:14.512+08:00","host":"<os.hostname()>"}
```

#### 2.3.3 关键序列：reservation 短锁 + LLM 无锁 + 失败兜底（iter-2 C-3 强化, iter-3 W-5 失败兜底, iter-4 W-9 二级防御）

```js
async function reserveQuota({ runId, maxPerDay }) {
  // ============================================
  // PHASE 1: 短锁 reservation (毫秒级，无 LLM IO)
  // ============================================
  acquireLock(QUOTA_LOCK_PATH);                           // step 1: O_EXCL
  try {
    const store = readQuotaStoreOrInit();                 // step 2: read
    if (store.date !== today()) rotateAndReset(store);    // step 3a: 跨天 rotate
    if (store.runs >= maxPerDay) {                        // step 3b: 配额检查
      throw new Error(`quota_exceeded: ${store.runs}/${maxPerDay}`);
    }
    store.run_ids.push(runId);                            // step 4: append
    store.runs += 1;
    store.updatedAt = nowIso();
    atomicWriteJson(QUOTA_STORE_PATH, store);             // step 5+6: tmp+rename
  } finally {
    releaseLock(QUOTA_LOCK_PATH);                         // step 7: unlink
  }
  // ↑ 步骤 1-7 累计 < 10ms

  // ============================================
  // PHASE 2: 写 run-N.json started_at + 拿 per-run lock
  // ============================================
  const runFile = path.join(RUNS_DIR, `run-${runId}.json`);
  const runLock = path.join(RUNS_DIR, `run-${runId}.lock`);
  acquireLock(runLock);                                   // 标记 active writer
  atomicWriteJson(runFile, { run_id: runId, started_at: nowIso() });  // step 9
  return { runFile, runLock };                            // 把 per-run lock 交给 caller
}

// caller (eval-mcp-augmented.runOne) 流程（iter-3 W-5 失败兜底, iter-4 W-9 nested catch）：
async function runOne(runId) {
  const { runFile, runLock } = await reserveQuota({ runId, maxPerDay });
  let finalizedWritten = false;
  let currentPhase = 'init';                              // iter-3: 跟踪失败阶段
  try {
    // ============================================
    // PHASE 3: LLM spawn + judge / oracle (无 quota 锁；可并行 N runs)
    // ============================================
    currentPhase = 'driver';
    const llmResult = await spawnDriverAndAwait(runId);      // step 10-11，30-120s
    currentPhase = 'jury';
    const judgeResult = await runJury(llmResult);            // step 12
    currentPhase = 'oracle';
    const oracleResult = await runOracle(llmResult);

    // ============================================
    // PHASE 4: 写 run-N.json finalized_at, status='success' (atomic)
    // ============================================
    currentPhase = 'finalize';
    atomicWriteJson(runFile, {                               // step 13
      run_id: runId,
      started_at: ...,
      finalized_at: nowIso(),
      status: 'success',                                     // iter-3 W-5
      perf: { mcpToolCalls, ... },
      subAgentMeta: { specDriverVersion, ..., confidence },  // iter-3 C-5
      judge: judgeResult, oracle: oracleResult,
    });
    finalizedWritten = true;                                 // step 14
  } catch (originalError) {
    // iter-3 W-5: 失败兜底 — 仍写 finalized_at + status='failed'，不留 partial
    // iter-4 W-9: nested try-catch 二级防御 — 兜底写自身失败时，log 双错误并 rethrow originalError
    if (!finalizedWritten) {
      try {
        atomicWriteJson(runFile, {
          run_id: runId,
          started_at: ...,
          finalized_at: nowIso(),                            // step 15: 兜底 finalized
          status: 'failed',
          error: { phase: currentPhase, message: originalError.message, stack: originalError.stack?.slice(0, 4000) },
        });
        finalizedWritten = true;
      } catch (writeFallbackError) {
        // iter-4 W-9 二级防御：双错误 log；不吞 originalError；run-N.json 留 partial
        // 降级路径 = run-N.json 留 partial 状态（quota 已扣账面），下次 startup detect
        // 在 30min 后由 stale 探测兜底回收（§2.3.6 partialStale），不阻塞续跑。
        console.error('[CRITICAL][runOne] driver 抛错 + 兜底 finalize 写盘失败:');
        console.error(`  Original error (run=${runId} phase=${currentPhase}):`, originalError);
        console.error(`  Fallback write error (path=${runFile}):`, writeFallbackError);
      }
    }
    throw originalError;                                     // 始终向上抛原 error，不被 fallback 失败掩盖
  } finally {
    releaseLock(runLock);                                    // 始终释放 per-run lock
  }
}
```

**iter-3 W-5 修复关键**：finally 之前有 catch 兜底；任一阶段（driver/jury/oracle/finalize）抛错都会写出 `finalized_at + status:'failed' + error.phase`。配额已扣（合理），但 run-N.json 不再是 partial。后续 detect 不会列为 unfinished。
**iter-4 W-9 修复关键**：catch 内嵌 try-catch；兜底写盘自身失败（disk full / IO 错误）时，console.error 双错误信息后仍 rethrow originalError（不被 writeFallbackError 掩盖）。这种灾难态下 run-N.json 留 partial → 30min 后 stale 探测（§2.3.6 partialStale）按既定路径回收，不阻塞续跑。

**核心收益**：
1. **可并行**：N 个 run 共享 quota 文件但 lock 时长极短，450 runs 并发 reservation 累计 < 5s（vs v1 把 LLM 串行化要 6h+）。
2. **不丢配额**：reservation 在 spawn 前完成，spawn 后崩溃也已记账，partial run 探测能识别（`started_at` 存在但 `finalized_at` 缺失）。
3. **partial run 区分 active / stale / failed-finalized**：per-run lock 文件存在 + PID alive 视为 `running`；不存在或 PID dead + `started_at` > 30min 才视为 stale 可清理（W-1）；含 `finalized_at + status:'failed'` 视为 failed-finalized，不归 partial（W-5）。
4. **灾难态可恢复**（iter-4 W-9）：兜底写盘失败也不吞原 error；partial run 由 stale 探测回收，配额账面已扣不丢失。

#### 2.3.4 acquireLock 退避策略（指数 + 抖动）

```js
function acquireLock(lockPath, { maxRetries=30, initialMs=50, capMs=1600, totalCapMs=30000 }):
  const startedAt = Date.now()
  let delay = initialMs
  for attempt in 1..maxRetries:
    try:
      const fd = fs.openSync(lockPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600)
      fs.writeSync(fd, JSON.stringify({pid:process.pid, createdAt:nowIso(), host:os.hostname()}))
      fs.closeSync(fd)
      return  // success
    catch err if err.code === 'EEXIST':
      if checkAndCleanOrphanLock(lockPath):
        continue
      if Date.now() - startedAt > totalCapMs:
        emitDiagnostic(lockPath)
        process.exit(73)  // EX_CANTCREAT
      sleepSync(delay + jitter())
      delay = min(delay * 2, capMs)
    catch err:
      throw err

function releaseLock(lockPath):
  fs.unlinkSync(lockPath)  // 容忍 ENOENT
```

| attempt | base delay | jitter (rand 0-50ms) | actual sleep |
|---------|-----------|---------------------|-------------|
| 1 | 50 | 0-50 | 50-100 ms |
| 2 | 100 | 0-50 | 100-150 ms |
| 3 | 200 | 0-50 | 200-250 ms |
| 4 | 400 | 0-50 | 400-450 ms |
| 5 | 800 | 0-50 | 800-850 ms |
| 6+ | 1600（cap）| 0-50 | 1600-1650 ms |

#### 2.3.5 孤儿 lock 检测

```js
function checkAndCleanOrphanLock(lockPath):
  try:
    const meta = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    const ageSec = (Date.now() - new Date(meta.createdAt).getTime()) / 1000
    if ageSec < 60: return false

    try:
      process.kill(meta.pid, 0)  // signal 0
      return false               // PID 仍在 → 真持锁
    catch err if err.code === 'ESRCH':
      console.warn(`[quota] 清理孤儿 lock: pid=${meta.pid}, age=${ageSec}s`)
      fs.unlinkSync(lockPath)
      return true
  catch:
    return false
```

#### 2.3.6 partial run 检测（iter-2 修订 W-1, iter-3 修订 W-5/W-7）

**iter-3 W-7 修复**：`meta` 必须 `let` 声明在 try 块外，避免 catch / 后续分支 ReferenceError。

```js
function classifyRuns(runsDir):
  const STALE_THRESHOLD_MS = 30 * 60 * 1000  // 30 min
  const files = fs.readdirSync(runsDir).filter(f => /^run-.+\.json$/.test(f))
  const finalized = []          // success or failed (含 finalized_at)
  const partialRunning = []     // active writer 仍在跑，不清理
  const partialStale = []       // 真正可清理的 stale partial
  const failedFinalized = []    // iter-3 W-5: status='failed' 但已 finalized

  for f in files:
    const obj = JSON.parse(fs.readFileSync(path.join(runsDir, f)))
    const lockPath = path.join(runsDir, f.replace(/\.json$/, '.lock'))

    // iter-3 W-5: failed-finalized 不归 partial
    if 'finalized_at' in obj:
      if obj.status === 'failed':
        failedFinalized.push({ id: obj.run_id, file: f, error: obj.error })
      else:
        finalized.push({ id: obj.run_id, file: f })
      continue

    if 'started_at' in obj:
      const ageMs = Date.now() - new Date(obj.started_at).getTime()
      const lockExists = fs.existsSync(lockPath)
      let writerAlive = false
      let meta = null                            // <-- iter-3 W-7: scope 提到 try 外
      if lockExists:
        try {
          meta = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          process.kill(meta.pid, 0)              // 探测 PID
          writerAlive = true
        } catch (e) {
          // meta=null 说明读 / parse 阶段失败；meta!=null 说明 PID 探测失败
          writerAlive = false
          if meta == null:
            console.warn(`[classify] lock 文件解析失败 ${lockPath}: ${e.message}`)
          // else: PID 已退出 → meta 已带 pid 信息可记录
        }

      if writerAlive:
        partialRunning.push({ id: obj.run_id, file: f, pid: meta.pid })  // meta 一定非 null
      else if ageMs > STALE_THRESHOLD_MS:
        partialStale.push({ id: obj.run_id, file: f, ageMs, lastPid: meta?.pid ?? null })
      else:
        // 新鲜 partial 但 lock 文件 / writer 状态不明 → 视为 running，保守保留
        partialRunning.push({ id: obj.run_id, file: f, pid: meta?.pid ?? 'unknown' })

  return { finalized, partialRunning, partialStale, failedFinalized }
```

#### 2.3.7 `--accept-partial` / `--restart-partial` 互斥实现

```js
const acceptPartial = args.includes('--accept-partial')
const restartPartial = args.includes('--restart-partial')
if acceptPartial && restartPartial:
  console.error(MUTEX_ERROR_MESSAGE)
  process.exit(64)

const { finalized, partialRunning, partialStale, failedFinalized } = classifyRuns(runsDir)

if partialRunning.length > 0:
  console.warn(`[quota] ${partialRunning.length} run still running (active writer detected); ignored`)

if failedFinalized.length > 0:
  console.warn(`[quota] ${failedFinalized.length} run failed (status='failed', 已 finalized; 不视为 partial)`)
  // failed-finalized 仅在 reporting 阶段统计；不进入 partial 处置分支

if partialStale.length > 0:
  if acceptPartial:
    quotaStore.run_ids = uniq([...quotaStore.run_ids, ...partialStale.map(p=>p.id)])
  else if restartPartial:
    // 二次确认：再次检查 stale + no active lock 后再删
    for p in partialStale:
      const reCheck = classifyOne(p.file)
      if reCheck.partialStale:
        fs.unlinkSync(path.join(runsDir, p.file))
        const lockFile = p.file.replace(/\.json$/, '.lock')
        try { fs.unlinkSync(path.join(runsDir, lockFile)) } catch (e) { if e.code !== 'ENOENT' throw e }
  else:
    printUnfinishedReport(finalized, partialRunning, partialStale, failedFinalized)
    process.exit(0)
```

#### 2.3.8 跨进程并发 vitest case 设计（PC-T1, iter-2 修订 + iter-3 修订 W-6）

**iter-3 W-6 修复**：补 child script 接口 + vitest config 要求。

**child script 路径**：`tests/helpers/quota-fork-helper.mjs`

**接口契约**：
- `process.argv` 接收：`--store-path <path> --lock-path <path> --max-runs <N> --run-id <id>`
- 调用 `reserveQuota({ runId, maxPerDay })`，测量 lock hold 时长
- 通过 `process.stdout.write(JSON.stringify({ ok, runs, lockHeldMs, error }))` 输出
- exit code 0 = 成功；非 0 = 失败

**helper 伪码**：

```js
// tests/helpers/quota-fork-helper.mjs
#!/usr/bin/env node
import { reserveQuota } from '../../scripts/lib/eval-quota-store.mjs';
const argv = parseArgv(process.argv.slice(2));
const t0 = process.hrtime.bigint();
try {
  const { runs } = await reserveQuota({
    runId: argv['run-id'],
    maxPerDay: Number(argv['max-runs']),
    storePath: argv['store-path'],
    lockPath: argv['lock-path'],
  });
  const lockHeldMs = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stdout.write(JSON.stringify({ ok: true, runs, lockHeldMs }));
  process.exit(0);
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
```

**vitest 配置**：`vitest.config.ts` 需启用 `pool: 'forks'`（如未启用），或在该 test 中通过 `child_process.fork()` 启动 child（不依赖 vitest pool 选项）；推荐后者（更可控）。

**测试 case**：

```js
// tests/eval-quota-store.test.mjs
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./helpers/quota-fork-helper.mjs', import.meta.url));

function forkAndIncrementQuota({ storePath, lockPath, maxRuns, runId }) {
  return new Promise((resolve, reject) => {
    const child = fork(HELPER, [
      '--store-path', storePath, '--lock-path', lockPath,
      '--max-runs', String(maxRuns), '--run-id', runId,
    ], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    let buf = '';
    child.stdout.on('data', d => buf += d.toString());
    child.on('exit', code => {
      try { resolve({ ...JSON.parse(buf), exitCode: code }); }
      catch (e) { reject(new Error(`parse fail: ${buf}`)); }
    });
    child.on('error', reject);
  });
}

// PC-T1: N 进程并发 reservation, 计数恰好为 N + 每进程 lockHeldMs<50ms
test('N 进程并发写 quota store, 计数恰好为 N + 锁短', async () => {
  const tmpDir = mkdtemp()
  const lockPath = path.join(tmpDir, 'feature-162.lock')
  const storePath = path.join(tmpDir, 'feature-162.json')
  const N = 4
  const t0 = Date.now()
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    forkAndIncrementQuota({ storePath, lockPath, maxRuns: 100, runId: `run-${i}` })
  ))
  const totalMs = Date.now() - t0

  const final = JSON.parse(fs.readFileSync(storePath))
  expect(final.runs).toBe(N)                                    // 总计无丢失
  expect(new Set(final.run_ids).size).toBe(N)                   // 无重复
  expect(results.every(r => r.ok)).toBe(true)
  expect(results.every(r => r.lockHeldMs < 50)).toBe(true)      // 每进程持锁 < 50ms
  expect(totalMs).toBeLessThan(2000)                            // 总耗时合理（含 fork overhead）
})

// PC-T2: 孤儿 lock 自动清理
test('孤儿 lock 自动清理', async () => {
  const lockPath = mktmp()
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 999999, createdAt: new Date(Date.now() - 90_000).toISOString()
  }))
  const cleaned = checkAndCleanOrphanLock(lockPath)
  expect(cleaned).toBe(true)
  expect(fs.existsSync(lockPath)).toBe(false)
})

// PC-T3: partial run classified 正确（finalized + stale + running + failed-finalized, iter-3 W-5）
test('partial run 区分 finalized / running / stale / failed-finalized', () => {
  const runsDir = mktmp()
  // case A: success finalized
  fs.writeFileSync(path.join(runsDir, 'run-1.json'),
    JSON.stringify({ run_id:'r1', started_at:'2026-05-10T10:00:00+08:00', finalized_at:'2026-05-10T10:01:00+08:00', status:'success' }))
  // case B: stale partial (started 1h ago, no lock)
  fs.writeFileSync(path.join(runsDir, 'run-2.json'),
    JSON.stringify({ run_id:'r2', started_at: new Date(Date.now() - 3600_000).toISOString() }))
  // case C: running partial (started 30s ago, lock with current PID)
  fs.writeFileSync(path.join(runsDir, 'run-3.json'),
    JSON.stringify({ run_id:'r3', started_at: new Date(Date.now() - 30_000).toISOString() }))
  fs.writeFileSync(path.join(runsDir, 'run-3.lock'),
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
  // case D (iter-3 W-5): failed-finalized — driver 抛错但已写 finalized_at
  fs.writeFileSync(path.join(runsDir, 'run-4.json'),
    JSON.stringify({ run_id:'r4', started_at:'2026-05-10T09:00:00+08:00', finalized_at:'2026-05-10T09:00:30+08:00', status:'failed', error:{phase:'driver',message:'codex CLI exit 1'} }))

  const { finalized, partialRunning, partialStale, failedFinalized } = classifyRuns(runsDir)
  expect(finalized.map(p=>p.id)).toEqual(['r1'])
  expect(partialRunning.map(p=>p.id)).toEqual(['r3'])
  expect(partialStale.map(p=>p.id)).toEqual(['r2'])
  expect(failedFinalized.map(p=>p.id)).toEqual(['r4'])         // iter-3: 不归 partial
})

// PC-T4 (iter-2 新增): active writer 写入期间扫描不误判 running 为 stale (W-1 ABA 防护)
test('active writer 中途, 扫描不误判 (ABA 防护)', async () => {
  const runsDir = mktmp()
  // 模拟 active writer 持续写 run-1.json (atomic tmp+rename)
  const writerPid = process.pid
  fs.writeFileSync(path.join(runsDir, 'run-1.json'),
    JSON.stringify({ run_id:'r1', started_at: new Date(Date.now() - 31 * 60_000).toISOString() }))  // 看似 stale (>30min)
  fs.writeFileSync(path.join(runsDir, 'run-1.lock'),
    JSON.stringify({ pid: writerPid, createdAt: new Date().toISOString() }))

  const { partialRunning, partialStale } = classifyRuns(runsDir)
  // 即使 started_at > 30min, 因 lock 文件 + writer alive，归 running 不归 stale
  expect(partialStale).toHaveLength(0)
  expect(partialRunning.map(p=>p.id)).toEqual(['r1'])
})

// PC-T5 (iter-3 新增 W-5): driver throw → finally 兜底写 finalized_at + status='failed' → 续跑时 run 不被列为 unfinished
test('driver 抛错时 finally 兜底写 failed-finalized, 续跑不视为 partial', async () => {
  const runsDir = mktmp()
  const runId = 'r-fail-1'
  // 模拟 reserveQuota 已写 started_at
  fs.writeFileSync(path.join(runsDir, `run-${runId}.json`),
    JSON.stringify({ run_id: runId, started_at: new Date().toISOString() }))
  fs.writeFileSync(path.join(runsDir, `run-${runId}.lock`),
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
  // 模拟 driver 抛错触发 catch 兜底
  await expect(runOneWithMockDriver({ runId, runsDir, mockError: 'codex CLI exit 1', failPhase: 'driver' }))
    .rejects.toThrow('codex CLI exit 1')

  // 验证 run-N.json 已被兜底改写为 finalized + status:'failed'
  const finalObj = JSON.parse(fs.readFileSync(path.join(runsDir, `run-${runId}.json`)))
  expect(finalObj.finalized_at).toBeDefined()
  expect(finalObj.status).toBe('failed')
  expect(finalObj.error.phase).toBe('driver')
  expect(finalObj.error.message).toContain('codex CLI exit 1')

  // 续跑时 classifyRuns 不把它列为 partial
  const { partialStale, partialRunning, failedFinalized } = classifyRuns(runsDir)
  expect(partialStale).toHaveLength(0)
  expect(partialRunning).toHaveLength(0)
  expect(failedFinalized.map(p=>p.id)).toEqual([runId])
})
```

---

### 2.4 canonical schema `perf.mcpToolCalls[]` 迁移（Phase C）

#### 2.4.1 新字段定义（canonical）

```
perf.mcpToolCalls: Array<{
  tool:          string,    // 'mcp__spectra__context' | 'mcp__spectra__impact' | ...
  success:       boolean,
  error:         string | null,  // 'tool-not-available' | 'timeout' | ...
  responseBytes: number,
  timestamp:     string     // ISO 8601
}>
```

#### 2.4.2 Legacy 字段派生关系

| legacy 字段 | 派生规则 | 写入位点 |
|------------|---------|---------|
| `perf.mcpToolCallCount` | `mcpToolCalls.length` | `eval-mcp-augmented.mjs` 双写 |
| `perf.mcpResponseBytes` | `sum(mcpToolCalls.map(c => c.responseBytes))` | `eval-mcp-augmented.mjs` 双写 |
| `perf.mcpToolCallTrace`（旧）| → rename 为 `mcpToolCalls`（同字段同结构）| `eval-task-runner.mjs` rename |

#### 2.4.3 `eval-task-runner.mjs` 改造点

- 当前第 588 行：`perf.mcpToolCallTrace = trace`（schema 1.2）。
- 改为：`perf.mcpToolCalls = trace`（同结构，仅字段名）。
- **读取兼容**：`perf.mcpToolCalls ?? perf.mcpToolCallTrace ?? []`。

#### 2.4.4 `eval-mcp-augmented.mjs` 改造点

- 当前 `parseTelemetryJsonl`（第 357-378 行）：返回 `{ mcpToolCallCount, mcpResponseBytes }`（标量）。
- 改为：返回 `{ mcpToolCalls: Array<{tool, success, error, responseBytes, timestamp}> }`。
- **写入双写**：

  ```
  perf: {
    mcpToolCalls,                                        // canonical (new)
    mcpToolCallCount: mcpToolCalls.length,               // legacy (派生)
    mcpResponseBytes: sumResponseBytes(mcpToolCalls),    // legacy (派生)
  }
  ```

#### 2.4.5 `subAgentMeta` schema + 采集协议（iter-2 新增 C-4, iter-3 修订 C-5 双轨优先级 + 冲突探测, iter-4 修订 W-8 字段级 fallback）

run-N.json 新增字段（**iter-3 新增 `confidence` + 顶层 `collectIssues`**）：

```
subAgentMeta: {
  specDriverVersion: string | null,        // semver, e.g., '4.1.0'; null 表示采集失败
  frontmatterTools:  string[] | null,      // 加载到 sub-agent 的工具白名单
  loadSource:        string | null,        // 加载源
  collectedVia:      'env' | 'first-tool-call' | 'merged' | 'absent',  // 采集方式（iter-3 新增 'merged'）
  confidence:        'self-report' | 'env-only' | 'self-report-only' | 'merged' | 'mixed' | 'absent',  // iter-3 新增 + iter-4 W-8 新增 'mixed'
}

// 顶层 run-N.json（iter-3 新增）
collectIssues: Array<{                       // 仅冲突时存在
  type: 'subAgentMeta-mismatch',
  envVersion: string | null,
  selfReportVersion: string | null,
  chosen: 'self-report' | 'env-injected',
  reason: string                             // e.g., '版本不一致 4.0.5 vs 4.1.0'
}>
```

**采集策略（双轨制 + 优先级 + 冲突探测）**：

1. **方式 A（env 注入）**：spawn sub-agent 时通过环境变量 `SPECTRA_PLUGIN_VERSION` / `SPECTRA_PLUGIN_PATH` 注入；sub-agent 在 telemetry 输出（stream-json metadata）回显这些值。`eval-mcp-augmented.mjs` 收集 telemetry 时解析。
2. **方式 B（first-tool-call 自报）**：在 sub-agent prompt 末尾追加约定语句"作为回答的第一步，请调用 `Read('plugins/spec-driver/.claude-plugin/plugin.json')` 并复述 version 字段"；解析 stream-json 中的首个 Read 调用结果。

**iter-3 C-5 优先级与冲突解决** + **iter-4 W-8 字段级 fallback**：

> **核心原则**：`self-report > env-injected`（每字段独立）。理由：sub-agent 实际加载的 plugin frontmatter 版本最权威，env 只是 spawn 时主进程对 plugin cache 状态的"猜测"，可能因 marketplace 升级 / 多 worktree cache 不一致而失真。
>
> **iter-4 W-8 修复**：合并不再用 spread (`...selfReportMeta`)，因为当 self-report 仅报 version 而 tools/loadSource 缺失时，`undefined` 会覆盖 env 的非空值。改为对每个字段独立选择 source（self-report 优先，缺则用 env）；confidence 由"哪些字段实际从 self-report 取"决定。

合并算法（伪码，**iter-4 字段级 fallback**）：

```js
function mergeSubAgentMeta({ envMeta, selfReportMeta }) {
  const collectIssues = []
  const FIELDS = ['specDriverVersion', 'frontmatterTools', 'loadSource']

  // 双源都失败 → absent
  if (!envMeta && !selfReportMeta) {
    return {
      meta: { specDriverVersion: null, frontmatterTools: null, loadSource: null, collectedVia: 'absent', confidence: 'absent' },
      collectIssues: []
    }
  }

  // 字段级 fallback：每字段独立选 source
  const meta = {}
  const sourceTrack = {}                                          // 记录每字段实际来源 'self-report' | 'env'
  for (const f of FIELDS) {
    const fromSelf = selfReportMeta?.[f] ?? null                  // null/undefined 都视为缺
    const fromEnv  = envMeta?.[f] ?? null
    if (fromSelf != null) { meta[f] = fromSelf; sourceTrack[f] = 'self-report' }
    else if (fromEnv != null) { meta[f] = fromEnv; sourceTrack[f] = 'env' }
    else { meta[f] = null; sourceTrack[f] = 'none' }
  }

  // 冲突探测：双源都报 specDriverVersion 但不一致 → 记 mismatch（仍取 self-report）
  if (envMeta?.specDriverVersion && selfReportMeta?.specDriverVersion
      && envMeta.specDriverVersion !== selfReportMeta.specDriverVersion) {
    collectIssues.push({
      type: 'subAgentMeta-mismatch',
      envVersion: envMeta.specDriverVersion,
      selfReportVersion: selfReportMeta.specDriverVersion,
      chosen: 'self-report',
      reason: `版本不一致 ${envMeta.specDriverVersion} vs ${selfReportMeta.specDriverVersion}`,
    })
  }

  // confidence 状态机：根据 sourceTrack 分布决定
  const sources = new Set(Object.values(sourceTrack).filter(s => s !== 'none'))
  let confidence, collectedVia
  if (sources.size === 1 && sources.has('self-report')) {
    confidence = envMeta ? 'self-report' : 'self-report-only'      // env 存在但全部字段被 self-report 覆盖 → 'self-report'；env 不存在 → 'self-report-only'
    collectedVia = 'first-tool-call'
    // 双源 version 一致且全字段都来自 self-report → 标 merged 表示双源验证
    if (envMeta?.specDriverVersion === selfReportMeta?.specDriverVersion && envMeta?.specDriverVersion) {
      confidence = 'merged'; collectedVia = 'merged'
    }
  } else if (sources.size === 1 && sources.has('env')) {
    confidence = 'env-only'; collectedVia = 'env'
  } else {
    // mixed：部分字段来自 self-report，部分来自 env（典型场景：self-report 仅报 version）
    confidence = 'mixed'; collectedVia = 'first-tool-call'
  }

  return { meta: { ...meta, collectedVia, confidence }, collectIssues }
}
```

**降级语义对照表**（iter-4 W-8 扩充 mixed 行）：

| envMeta | selfReportMeta | 字段一致性 | meta.confidence | meta.collectedVia | collectIssues |
|---------|----------------|-----------|-----------------|--------------------|----|
| ✓ 全字段 | ✓ 全字段，version 一致 | 一致 | `merged` | `merged` | [] |
| ✓ 全字段 | ✓ 全字段，version 不一致 | 不一致 | `self-report` | `first-tool-call` | [{mismatch, chosen: self-report}] |
| ✓ 全字段 | ✓ 仅 version | 字段缺失（W-8） | `mixed` | `first-tool-call` | [] (或 mismatch 若 version 不一致) |
| ✗ | ✓ 全字段 | — | `self-report-only` | `first-tool-call` | [] |
| ✓ | ✗ | — | `env-only` | `env` | [] |
| ✗ | ✗ | — | `absent` | `absent` | [] |

**inheritance_status 联动**（见 §2.6.2）：
- `confidence ∈ {merged, self-report, self-report-only, env-only, mixed}` 且其余条件成立 → `available`
- `confidence === 'absent'` 且无其他 unavailable / available 信号 → `unknown`

#### 2.4.6 既有 25 fixture 是否回填？

- **不回填**。25 task fixture 不入库（CLAUDE.local.md），且 spec-driver-track 现有 fixture 是 spec-driver 类任务（与 SWE-Bench-Lite 是不同 fixture 体系），不参与 §10.5 表格。
- §10.5 数据**仅**来自 Phase C 新跑的 450 runs（Group A/B/C 共 450 个 run-N.json，全部用 canonical schema + subAgentMeta）。

#### 2.4.7 读取兼容性 helper

```js
export function readMcpCalls(perf):
  return perf.mcpToolCalls ?? perf.mcpToolCallTrace ?? []
```

---

### 2.5 GLM judge calibration runner（Phase B, iter-2 修订 W-3 拆 B1/B2）

**Phase B 拆为 B1（与 A 并行）+ B2（A 完成后）两个 sub-step**：

#### Phase B1（与 Phase A 并行；仅配置改动，不依赖 dispatcher）

涵盖：FR-020 (DEFAULT_JUDGES 替换) / FR-021 (self-judge 注释) / 0.1 (calibration-fixture-list.json 落地)。

| 任务 | 文件 | 内容 |
|------|------|------|
| PB1-1 | `scripts/eval-judge-jury.mjs` | DEFAULT_JUDGES 数组替换：`['claude-cli:claude-opus-4-7', 'siliconflow:Pro/zai-org/GLM-5.1', 'siliconflow:Pro/moonshotai/Kimi-K2.6']` |
| PB1-2 | `scripts/eval-judge-jury.mjs` | 添加 self-judge 禁忌注释（指引未来添加 codex judge 时同步检查） |
| PB1-3 | `specs/162-.../calibration-fixture-list.json` | 落地 5 个 frozen fixture id（见 0.1） |
| PB1-V1 | — | `node -e "import('scripts/eval-judge-jury.mjs').then(m=>console.log(m.DEFAULT_JUDGES))"` 输出含 GLM-5.1 |

**B1 不依赖 Phase A 任何产出**，可独立 commit；与 Phase A 并行执行。

#### Phase B2（Phase A 完成后；calibration 跑批 + 阈值判定 + 回退）

涵盖：FR-022 (IoU) / FR-023 (Pearson) / FR-024 (refusal IoU) / FR-025 (回退路径)。

##### 2.5.1 5 fixture × 3 runs runner 实现

- runner 脚本：`scripts/calibrate-glm-judge.mjs`（新建）
- 流程（**iter-2 修订 C-1**：所有 callExecutor 调用改对象参数）：

  ```js
  for fixture in calibration-fixture-list.json:
    for run_id in 1..3:
      driver_output = await callExecutor({ model: 'codex:gpt-5.5', prompt: fixture.prompt, apiKey: null })
      glm_score   = await callBackend({ model: 'siliconflow:Pro/zai-org/GLM-5.1', prompt: judgePrompt(driver_output, fixture), options: { ... } })
      codex_score = await callBackend({ model: 'codex:gpt-5.5',                    prompt: judgePrompt(driver_output, fixture), options: { ... } })  // 旧 baseline
      oracle_pass = await runOracle(driver_output, fixture)
      records.push({ fixture_id, run_id, oracle_pass, glm_score, codex_score, glm_refusal, codex_refusal })
  // 共 5 × 3 = 15 records
  ```

- **复用 driver 输出**：每 fixture 仅调一次 driver（codex），双 judge 并行打分，避免 driver 输出本身的随机性污染 IoU。

##### 2.5.2 IoU 计算（overall, 15 数据点）

```js
function computePassRateIoU(records):
  setGlm   = new Set(records.filter(r => r.glm_score   >= 5).map(r => `${r.fixture_id}|${r.run_id}`))
  setCodex = new Set(records.filter(r => r.codex_score >= 5).map(r => `${r.fixture_id}|${r.run_id}`))
  inter = intersect(setGlm, setCodex)
  union = unionOf(setGlm, setCodex)
  return inter.size / union.size  // [0, 1]
```

##### 2.5.3 Pearson correlation 零依赖实现

`scripts/lib/pearson.mjs`：

```js
export function pearson(xs, ys):
  if xs.length !== ys.length || xs.length < 2:
    throw new Error('xs/ys length mismatch or too few points')
  const n = xs.length
  const mx = xs.reduce((a,b)=>a+b, 0) / n
  const my = ys.reduce((a,b)=>a+b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for i in 0..n-1:
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  const denom = Math.sqrt(dx2 * dy2)
  if denom === 0: return 0
  return num / denom
```

##### 2.5.4 surface refusal detection 算法

```js
function detectRefusal(driverOutput):
  const REFUSAL_PATTERNS = [
    /^I (cannot|can't|won't|am unable to)/i,
    /(我无法|我不能|抱歉.{0,20}(无法|不能))/,
    /^(Sorry|Apologies),? (I (cannot|can't))/i,
    /\bcannot (assist|help|comply)\b/i,
  ]
  return REFUSAL_PATTERNS.some(re => re.test(driverOutput.slice(0, 500)))
```

##### 2.5.5 阈值未达时的 rubric 调整 + 回退（最多 2 轮）

```js
let calibrated = false
let attempt = 0
while attempt < 3:
  records = runCalibration()
  iou_pass = computePassRateIoU(records)
  pearson_corr = pearson(records.map(r=>r.glm_score), records.map(r=>r.oracle_pass ? 1 : 0))
  iou_refusal = computeRefusalIoU(records)

  if iou_pass >= 0.7 && pearson_corr >= 0.6 && iou_refusal >= 0.5:
    calibrated = true
    break

  if attempt < 2: adjustRubric()
  attempt++

if !calibrated:
  DEFAULT_JUDGES = ['claude-cli:claude-opus-4-7', 'siliconflow:Pro/moonshotai/Kimi-K2.6']
  TIE_BREAK = 'fail-closed'
  recordFallbackInComment({ ... })
```

##### 2.5.6 milestone 顺序

```
Phase 0 → (Phase A ∥ Phase B1) → Phase B2 → Phase C
```

B2 强依赖 A 的 dispatcher 产出（callBackend / classifyError）；B1 仅修配置，无依赖。

---

### 2.6 §10.5 报告章节生成（Phase C, iter-2 修订 C-4 三状态）

#### 2.6.1 数据来源

- `run-N.json.perf.mcpToolCalls[]`（canonical schema, Phase C 全部 450 runs）
- `run-N.json.subAgentMeta`（新增字段；详见 2.4.5；含 `confidence`）

#### 2.6.2 `inheritance_status` 三状态判定算法（iter-2 修订 C-4, iter-3 修订 C-5 confidence 联动, iter-4 mixed 兼容）

```js
function deriveInheritanceStatus(run):
  const calls = run.perf.mcpToolCalls ?? []
  const meta = run.subAgentMeta

  // 优先级 1：unavailable 信号
  if calls.some(c => c.error === 'tool-not-available'):
    return 'unavailable'
  if meta && meta.specDriverVersion && compareSemver(meta.specDriverVersion, '4.1.0') < 0:
    return 'unavailable'

  // 优先级 2：available 信号
  if calls.length > 0:                                // 实际成功调用过 mcp 工具
    return 'available'
  if meta && meta.specDriverVersion && compareSemver(meta.specDriverVersion, '4.1.0') >= 0
       && meta.confidence !== 'absent':               // iter-3: confidence 显式排除 absent；iter-4: mixed 视为可信
    return 'available'                                // 版本足够，即使本次未调用 (cohort A 期望)

  // 优先级 3：unknown 兜底（既无 unavailable 信号，也无 available 信号）
  return 'unknown'
```

**与 v1 关键区别**：v1 在缺信号时默认 `available`（乐观假设）；v2 改为返回 `unknown`，避免把"采集失败"伪装成"工具继承成功"。
**iter-3 修订**：`confidence === 'absent'` 时不算 available，强制走 unknown 兜底；`merged / self-report / self-report-only / env-only` 都算可信。
**iter-4 修订**：新增 `mixed` confidence（W-8 字段级 fallback 引入）也视为可信，参与 available 判定。

#### 2.6.3 `mcp_called` 派生

```
mcp_called = (run.perf.mcpToolCalls?.length ?? 0) > 0
```

#### 2.6.4 §10.5 表格 schema（完整列）

```markdown
| run id | cohort | mcp_tool_calls | mcp_called | mcp_tools                          | mcp_response_bytes | inheritance_status |
|--------|--------|----------------|------------|------------------------------------|--------------------|--------------------|
| sweL001-A-1 | A | 0  | false | (none)                            | 0                  | available          |
| sweL001-C-1 | C | 3  | true  | mcp__spectra__context, ...impact  | 4521               | available          |
| sweL003-C-2 | C | 0  | false | (none)                            | 0                  | unavailable*       |
| sweL005-A-3 | A | 0  | false | (none)                            | 0                  | unknown†           |
```

`*` = `inheritance_status=unavailable`；`†` = `unknown` (subAgentMeta 采集失败)。两者均加脚注链至异常分析段。

字段 source field path：

```
| run id              ← run.run_id
| cohort              ← run.cohort  (A/B/C)
| mcp_tool_calls      ← run.perf.mcpToolCalls.length
| mcp_called          ← (run.perf.mcpToolCalls.length > 0)
| mcp_tools           ← run.perf.mcpToolCalls.map(c=>c.tool).join(', ') || '(none)'
| mcp_response_bytes  ← sum(run.perf.mcpToolCalls.map(c=>c.responseBytes))
| inheritance_status  ← deriveInheritanceStatus(run)  // 3 enum: available | unavailable | unknown
```

#### 2.6.5 异常分析模板（iter-4 修订 W-10 增 §10.5.5 跑批失败统计小节）

```markdown
### 异常分析（inheritance_status = unavailable 占比 X%, 阈值 30%; unknown 占比 Y%, 阈值 10%）

**unavailable 可能原因**（按概率优先级）：
1. plugin cache 未更新：用户本地仍加载 spec-driver 4.0.0；解决方案：`claude plugin update spec-driver` 后重测。
2. agent 调用失败但 telemetry 未捕获：检查 `~/.claude/logs/` 是否有 `tool-not-available` 错误。
3. subAgentMeta 字段写入异常：scripts/eval-mcp-augmented.mjs 的 subAgentMeta 写入逻辑 bug。

**unknown 可能原因**（采集质量问题）：
1. 环境变量注入失败（方式 A）：检查 spawn args 是否含 `SPECTRA_PLUGIN_VERSION`。
2. first-tool-call 自报失败（方式 B）：sub-agent 未按 prompt 约定先调用 Read。
3. telemetry 解析丢字段：`parseTelemetryJsonl` 是否正确捕获 metadata。
4. (iter-3) collectIssues 含 `subAgentMeta-mismatch`：双源版本不一致时已记录于 run-N.json.collectIssues；统计 mismatch 占比作为 cache drift 信号。

实测数据：
| cohort | unavailable 占比 | unknown 占比 | mismatch 占比 (iter-3) |
|--------|-----------------|-------------|--------------------|
| A      | <fill>%         | <fill>%     | <fill>%            |
| B      | <fill>%         | <fill>%     | <fill>%            |
| C      | <fill>%         | <fill>%     | <fill>%            |
```

##### 10.5.5 跑批失败 run 统计（iter-4 新增 W-10）

§10.5 表格仅列 finalized 成功的 run。跑批失败 run 与 partial stale run 单列于此小节，供运维侧分析跑批稳定性：

| metric | value | source |
|--------|-------|--------|
| total_runs | 450 | quota store `runs` 字段（含 success + failed） |
| finalized_success | <count> | run-N.json `status='success'` 或缺 `status` 字段 |
| failedFinalized | <count> | run-N.json `status='failed'`（含 `error.phase`）|
| partialStale | <count> | run-N.json 仅 `started_at`、无 `finalized_at` 且 > 30min 无 active lock |

**5% 阈值规则**：若 `failedFinalized / total_runs > 5%` 视为跑批稳定性异常，必须分析 `error.phase` 分布（driver / jury / oracle / finalize 各占多少），并在异常分析段说明：
- driver 占主导 → codex CLI 配额 / 网络 / sandbox 问题
- jury / oracle 占主导 → judge LLM 后端不稳定（GLM/Kimi 503）
- finalize 占主导 → 磁盘 / IO / atomic write 问题（含 W-9 兜底写盘失败的灾难态）

**partialStale 单独阈值**：`partialStale / total_runs > 1%` 视为孤儿配额积累信号；提示用户跑 `--restart-partial` 回收。

---

## 3. Phase × 文件影响矩阵

| Phase | 文件路径 | 改动类型 | 预估行数 | 依赖 |
|-------|---------|---------|---------|------|
| 0 | `plugins/spec-driver/agents/plan.md` | tools 字段追加 2 项 | +1 | — |
| 0 | `plugins/spec-driver/agents/implement.md` | tools 字段追加 2 项 | +1 | — |
| 0 | `plugins/spec-driver/agents/verify.md` | tools 字段追加 2 项 | +1 | — |
| 0 | `plugins/spec-driver/agents/quality-review.md` | tools 字段追加 2 项 | +1 | — |
| 0 | `plugins/spec-driver/agents/spec-review.md` | tools 字段追加 2 项 | +1 | — |
| 0 | `contracts/release-contract.yaml` | version 4.0.0→4.1.0 | ±1 | repo:sync |
| A | `scripts/lib/llm-backend-dispatcher.mjs` | 新建 (callBackend + normalizeModelId + MODEL_ALIASES + classifyError) | ~310 | jury 现有逻辑迁移 |
| A | `scripts/eval-task-executor.mjs` | callExecutor 保留兼容签名 (thin wrapper) + DEFAULT_EXECUTOR_MODEL | +30 / -5 | dispatcher |
| A | `scripts/eval-judge-jury.mjs` | parseJudgeBackend 迁移引用 + assertNoSelfJudge 入口 | +25 / -90 | dispatcher |
| A | `scripts/eval-mcp-augmented.mjs` | assertNoSelfJudge 入口 | +10 | dispatcher |
| A | `tests/eval-llm-backend-dispatcher.test.mjs` | 8 case 基础 + 4 case retry matrix = 12 case (W-2) | ~280 | dispatcher |
| A | `tests/eval-self-judge-hard-fail.test.mjs` | 5 case (含大小写 + alias 覆盖, C-2) | ~120 | dispatcher |
| B1 | `scripts/eval-judge-jury.mjs` | DEFAULT_JUDGES 替换 + 注释 | +5 / -3 | — |
| B1 | `specs/162-.../calibration-fixture-list.json` | 新建（5 个 frozen ids） | ~35 | — |
| B2 | `scripts/lib/pearson.mjs` | 新建 | ~30 | — |
| B2 | `scripts/calibrate-glm-judge.mjs` | 新建 (callBackend) | ~150 | dispatcher, pearson |
| B2 | `tests/eval-pearson.test.mjs` | 新建 5 case | ~40 | pearson |
| B2 | `specs/162-.../calibration-results.md` | 新建（B2 完成时） | ~80 | runner 输出 |
| C | `scripts/lib/eval-quota-store.mjs` | 新建 (短锁 + per-run lock + atomic write + classifyRuns + failed-finalized 兜底, iter-3 W-5; iter-4 W-9 nested catch) | ~250 | — |
| C | `scripts/eval-mcp-augmented.mjs` | --max-runs-per-day + quota 短锁 + canonical schema 双写 + subAgentMeta 注入 (含 confidence + collectIssues, iter-3 C-5; iter-4 W-8 字段级 fallback) + partial 处理 + finally catch 兜底 (iter-3 W-5; iter-4 W-9 二级防御) | +260 | quota-store, dispatcher |
| C | `scripts/eval-task-runner.mjs` | mcpToolCallTrace → mcpToolCalls rename + 兼容读 | +5 / -2 | — |
| C | `tests/eval-quota-store.test.mjs` | 4 case + 1 failed-finalized = 5 case (含 ABA 防护 + iter-3 W-5) | ~190 | quota-store |
| C | `tests/helpers/quota-fork-helper.mjs` | 新建 child script (iter-3 W-6) | ~40 | quota-store |
| C | `specs/147-.../competitive-evaluation-report.md` | §10.1-§10.5 数据填入 + §10.5 新建章节 (3 状态 + mismatch 列 + iter-4 W-10 §10.5.5 失败统计) | +110 / -30 | 450 runs 数据 |
| C | `specs/158-.../detail.md` | 实验配置同步 | +10 / -10 | — |

**总计**：新建 10 个文件（3 lib + 4 test + 1 test helper + 2 spec artifact），修改 9 个文件。

---

## 4. 测试策略（iter-3 修订 W-5 升至 27 case；iter-4 不增 case）

### 4.1 vitest unit case 列表（按 FR 索引）

| 测试文件 | case 数 | 覆盖 FR |
|---------|---------|---------|
| `tests/eval-llm-backend-dispatcher.test.mjs` | 8 + 4 retry = **12** | FR-010, FR-013, FR-014, FR-015 |
| `tests/eval-self-judge-hard-fail.test.mjs` | 5 | FR-027 |
| `tests/eval-pearson.test.mjs` | 5 | FR-023 |
| `tests/eval-quota-store.test.mjs` | 3 + 1 ABA + 1 failed-finalized = **5** | FR-032, iter-3 W-5 |
| **小计** | **27 新增 case** | — |

iter-4 W-8/W-9/W-10 全部为 plan 细节修订，复用现有覆盖（W-8 由 §2.4.5 降级语义对照表覆盖；W-9 灾难态由 §6 风险章节兜底；W-10 仅扩报告 schema），不增 case。

### 4.2 Integration test

- `scripts/verify-feature-162-fixture-schema-stable.mjs`（PA-T3）：以 Codex driver 重跑 25 fixture，对比 schema 字段集。
- `scripts/calibrate-glm-judge.mjs`（PB2-T1/T2/T3）：5 fixture × 3 runs = 15 数据点，计算 IoU + Pearson。

### 4.3 Smoke test

- **Smoke D Test 3**（P0-T2）：`specs/161-.../verification/sub-agent-mcp-test.md` 新增 "Test 3" 章节，验证 plan sub-agent 调用 `mcp__spectra__context` 返回 success。
- **pilot batch**（PC-T5）：3 fixture × 3 cohort × 3 repeat = 27 runs；exit code 0 + run-N.json 含有效 oracle/jury。

### 4.4 vitest 全量回归

每个 Phase 完成时跑 `npx vitest run`，期望：
- Phase 0：基线 + 0
- Phase A：基线 + 17（dispatcher 12 + self-judge 5）
- Phase B1：基线 + 17（仅配置改动；不增 case）
- Phase B2：基线 + 17 + 5 = 22
- Phase C：基线 + 22 + 5 = 27（含 iter-3 W-5 failed-finalized case）

任何阶段失败数 > 0 即 critical 阻断。

---

## 5. 验证 / 回归保护

### 5.1 25 fixture byte-stable 验证脚本

`scripts/verify-feature-162-fixture-schema-stable.mjs`：

```
1. 加载所有 25 旧 fixture
2. extractKeysDeep(obj) → sorted JSON 字段路径列表
3. 以 Codex driver 重跑 25 fixture → 新 fixture (写到 tmp dir)
4. extractKeysDeep(new) 比对 oldKeys
5. typeof + nullable 一致性
6. 任一不一致 → process.exit(1)
```

### 5.2 跨进程 quota lock + ABA + failed-finalized vitest case

见 2.3.8 详细 case 设计（5 case，含 W-1 ABA 防护 + iter-3 W-5 failed-finalized 兜底）。

### 5.3 self-judge 5 组 case

见 2.2.3 表格（含 case (c) `Codex:GPT-5.5` 大小写归一覆盖）。

### 5.4 §10.5 数据填入验证

`scripts/verify-feature-162-section-10-5.mjs`（可选辅助）：
- 扫描 §10.5 章节是否含表格 + 7 列 schema。
- 检查所有 cell 无 `<pending>` / `<fill>` 占位符。
- inheritance_status 字段值仅 `available` / `unavailable` / `unknown` 三选一。
- (iter-4 W-10) §10.5.5 跑批失败统计小节存在；`failedFinalized / total_runs` 计算正确；超 5% 阈值需含 `error.phase` 分布。

---

## 6. 风险与权衡

### 6.1 O_EXCL 跨 NFS 限制（MEDIUM）

- 已知：POSIX `O_EXCL` 在某些 NFS v3 实现下不严格原子（v4 规范修正）。
- 当前部署：本地 dev + GitHub Actions runner 都是 ext4 / APFS / NTFS（非 NFS），无影响。
- 缓解：spec FR-032 明确"若 plan 阶段确认 NFS 部署需求才引入 proper-lockfile"；本 plan 阶段无此需求 → 不引入第三方依赖。

### 6.2 5×3 数据点 Pearson 统计功效（MEDIUM）

- n=15, r=0.6 → t=2.71, df=13 → p≈0.018（双侧），显著（α=0.05）。
- 但 r=0.6 已是阈值边界；若实测 r=0.55，p≈0.034 仍显著但接近阈值——FR-025 回退路径会被触发。
- 缓解：calibration runner 同时记录置信区间（bootstrap on records）。

### 6.3 ChatGPT Pro 配额波动（HIGH）

- Codex driver 跑 450 runs，依赖订阅周配额（不公开具体数额）。
- 已实施缓解：pilot 27 runs 估算 + `--max-runs-per-day` 控制 + quota state store + partial run 处理 + LLM 无锁并行 + iter-3 失败兜底 finalize（避免 stale partial 永久积累阻塞续跑）+ iter-4 W-9 兜底写盘失败二级防御（不吞 originalError，partial 由 stale 探测回收）。
- 残余风险：周配额本身在不同账户/时段可能差异；EC-002 retry matrix 已 fail-fast 防循环消耗。

### 6.4 plugin cache 未更新（MEDIUM）

- §10.5 数据若 `inheritance_status=unavailable` 占比 > 30% 或 `unknown` 占比 > 10%，多半是 cache 未更新或 subAgentMeta 采集失败。
- 缓解：Smoke D Test 3 强制记录加载的 plugin 版本号；FR-006 要求显式 `claude plugin update`；2.4.5 双轨制采集（env + first-tool-call）+ iter-3 优先级 + 冲突探测（self-report > env，记录 mismatch）+ iter-4 W-8 字段级 fallback（self-report 部分字段缺失时退回 env，避免 confidence 误判）。

### 6.5 codex CLI stderr 解析格式漂移（LOW）

- token usage 通过 stderr 正则 `/tokens used\s*\n\s*([\d,]+)/` 抽取；codex CLI 升级可能改格式。
- 缓解：dispatcher 中 try/catch 包裹解析；解析失败返回 `completionTokens=null`（非阻断），run-N.json 留 raw stderr 便于审计。

### 6.6 subAgentMeta 双轨采集仍可能全失败（MEDIUM, iter-2 新增 / iter-3 增强 / iter-4 字段级强化）

- env 注入与 first-tool-call 都失败时，inheritance_status 归 `unknown`；若 unknown 占比 > 10% 则报告章节须解释原因。
- iter-3 新增：双源都成功但版本不一致时，`collectIssues` 记录 mismatch；mismatch 占比 > 5% 视为 cache drift 信号，提示重 `claude plugin update`。
- iter-4 W-8 新增：双源仅部分字段成功时（如 self-report 仅报 version、env 报全字段），字段级 fallback 保留 env 的 tools/loadSource，confidence 标 `mixed`，仍视为可信。
- 缓解：pilot 27 runs 阶段先验证至少一种采集路径稳定；不稳定则在 PC-7 报告生成前补充 fallback（如 telemetry 中查 spec-driver agent 加载日志）。

### 6.7 兜底 finalize 写盘失败（LOW, iter-4 新增 W-9）

- driver/jury/oracle 抛错触发 catch 兜底写 `finalized_at + status:'failed'`，若该兜底写盘自身失败（disk full / IO 错误），nested catch 仅 log 双错误，不修改 run-N.json，不阻塞主线程 rethrow originalError。
- 降级路径：run-N.json 留 partial 状态（quota 已扣账面），下次启动 `classifyRuns` 在 30min 后归入 `partialStale`，由 `--restart-partial` 或下批跑批前手动清理。
- 残余风险：极端场景（磁盘满 + run 数百时持续失败）可能积累几十个 partialStale；§10.5.5 监控（W-10）会提示运维介入。

---

## 7. 实施顺序与里程碑（iter-2 修订 W-3 拆 B1/B2）

```
Day 1 (4h):
  Phase 0 → P0-1..9 + P0-T1/T2 + P0-D1 + P0-V1/V2 → commit + codex review (phase-0.md)
  Milestone: spec-driver 4.1.0 已发版, Smoke D Test 3 pass

Day 2-3 (12h, Phase A):
  Phase A → PA-1..8 + PA-T1..4 + PA-D1 + PA-V1/V2 → commit + codex review (phase-a.md)
  Verification gate: 12 dispatcher case + 5 self-judge case pass; 25 fixture schema byte-stable

Day 2-3 (1h, Phase B1, 与 Phase A 并行):
  Phase B1 → PB1-1..3 + PB1-V1 → commit (与 A 同分支或独立 fixup commit)
  Verification gate: DEFAULT_JUDGES 替换；calibration-fixture-list.json 落地

Day 4 (4h + ~$5, Phase B2, 严格在 A 之后):
  Phase B2 → PB2-1..4 + PB2-T1..5 + PB2-D1 + PB2-V1 → commit + codex review (phase-b.md)
  Verification gate: IoU≥0.7 + Pearson≥0.6 + refusal IoU≥0.5 (或回退记录)

Day 5-N (16h + ~$15, 跨 1-3 calendar week 取决于 quota):
  Phase C 准备 → PC-1..7 + PC-T1..5 → commit (准备态)
  Phase C pilot → PC-T6 (27 runs) → 决策分批
  Phase C 全量 → PC-T7/T8 (跨日, 跑 450 runs)
  Phase C 报告 → PC-T9 + PC-D1..6 + PC-V1/V2/V3 → commit + codex review (phase-c.md)
  Milestone: §10.1-§10.5 全部数据填入

Final (2h):
  FIN-1 (spec-review) + FIN-2 (quality-review) + FIN-3 (verify gate)
  FIN-4 (push deliverable report 等待用户确认)
  FIN-5 (rebase + push origin master)
```

milestone 顺序图：

```
Day 1                Day 2-3                  Day 4         Day 5-N         Final
─────                ──────────────────       ─────         ───────         ─────
Phase 0  ───────►    Phase A      ┐          Phase B2  ───► Phase C  ───►   FIN
                             ┌───►│  (依赖)
                     Phase B1┘    │
                     (并行)       ┘
```

每个 Phase 完成 commit 前必跑 codex 对抗审查（CLAUDE.local.md 强制约定）；critical 项 = 0 才能 commit / 进入下一 Phase。

---

## 8. 不在范围（plan 层面）

继承 spec.md "Non-Goals" 章节：
1. 多 driver 对比实验（Sonnet/Haiku） → Feature 163
2. 多 MCP server 对比 → Feature 164
3. 全 25 fixture × 5 repeat 长期回归 → Feature 165

plan 层新发现的 follow-up（不在本 feature 实施）：
4. **`mcp__spectra__detect_changes` 在 verify agent 的实际行为验证**：spec FR-003 要求声明该工具，但本 plan 不验证它是否在 SWE-Bench-Lite 场景下产生有效 trace → 留待 Feature 163+ 在 spec-driver-track fixture 上验证。
5. **codex CLI stderr 格式监控**：6.5 已记录风险，但不在本 feature 加自动化告警；follow-up 在 codex CLI 升版时人工 revisit。
6. **bootstrap CI B=10000 自动升档**：0.4 决议中的 fallback 由人工判读触发，不自动；follow-up 可在 `eval-report.mjs` 加 CI 宽度检测自动升档。
7. **subAgentMeta 第三采集通道**：2.4.5 双轨制（env + first-tool-call）若 pilot 阶段稳定性不足，follow-up 引入第三通道（如解析 `~/.claude/logs/` agent-load 日志）。
8. **(iter-3 新增) subAgentMeta mismatch 自动告警**：collectIssues 的 mismatch 当前仅记录到 run-N.json，未集成到 CI 告警；follow-up 在 verify-feature-162-section-10-5.mjs 中加 mismatch 占比 > 5% 红线检查。
9. **(iter-4 新增) §10.5.5 跑批失败 5% 阈值自动告警**：W-10 的 5% 阈值当前仅文档化由人工分析；follow-up 在 verify-feature-162-section-10-5.mjs 中加 `failedFinalized / total_runs > 5%` 自动 fail。
