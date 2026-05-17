# 技术规划: Eval CLI Infrastructure Uplift

**Feature Branch**: `166-eval-cli-infra-uplift`
**Status**: Draft（已过 Phase 3 Codex 对抗审查 round 1：2 CRITICAL + 10 WARNING + 1 INFO 全修；等待 GATE_TASKS / IMPLEMENT_AUTH）
**GATE_DESIGN 决策落地**: C-001 = A（claude-opus-4-7），预算 $1.5/run，需 preflight check
**关联 spec**: [spec.md](./spec.md)
**模式**: story（直接复用代码上下文）
**Codex Plan/Tasks 阶段 review 范围**: 本次 review 一次覆盖 plan + tasks 合并制品（符合 CLAUDE.local.md 五 phase 表中 plan 阶段；tasks 阶段不再单独跑 Codex，节省 round-trip）

---

## 1. 总体方案

### 1.1 架构概览

本 Feature 是一个**纯 evaluation 工具层修改**，不动 spectra 主线（`src/`）也不动 spec-driver plugin（`plugins/`）。改动集中在 3 处：

```
scripts/
├── eval-mcp-augmented.mjs        # 修改：3 行 hardcode + runOne() cohort C 分支 ~10 行
└── lib/
    └── parse-claude-stream-json.mjs   # 新增：1 个模块（~150 行）

tests/unit/
└── parse-claude-stream-json.test.ts   # 新增：≥13 个测试用例（~250 行）
```

依赖关系：

```
scripts/eval-mcp-augmented.mjs::runOne (cohort C 分支)
  ├── buildClaudeArgsWithMcp ─ 修改 model + output-format
  ├── spawnClaudeAndWait      ─ 沿用，timeoutMs 由 DEFAULT_TIMEOUT_MS 升级
  ├── [新增] parseClaudeStreamJson(runOutcome.stdout)
  │     └── 来自 scripts/lib/parse-claude-stream-json.mjs
  ├── parseTelemetryJsonl     ─ 沿用，不变
  └── extractConsumptionSignals({ stdout: <reasoningTrace 替代> })
```

### 1.2 实施策略

采用 **3 个原子可独立验证的改动 + 1 个端到端验证** 的分批策略：

| 阶段 | 改动 | 单测验证 | Codex review |
|------|------|---------|--------------|
| **Step A** | DEFAULT_TIMEOUT_MS 30→45 min | 现有单测全 PASS（无 timeout 硬编码断言） | 不单独 review（commit 合并到 Step C） |
| **Step B** | Driver model sonnet-4-6 → opus-4-7 | 新增 / 修改 ≥1 个 buildClaudeArgsWithMcp 单测 | 不单独 review（commit 合并到 Step C） |
| **Step C** | --output-format text → stream-json + 新 parser + runOne 集成 + extractConsumptionSignals 适配 | 新增 ≥13 个 parser 单测 + 现有单测全 PASS | implement 阶段 commit 前必跑 |
| **Step D** | preflight opus-4-7 + 1 个真实 cohort C run 端到端验证 | 真实 stream-json 解析无 fatal error、cost ≤ $1.5 | verify 阶段 commit 前 |

Step A/B/C 全部合并为 **1 个 implement commit**（因为 Step A/B 不可独立产生价值；只有 Step C 落地后 timeout + model 升级才有意义）。Step D 是验证步骤，输出 verify-report.md 后单独 commit。

---

## 2. 详细设计

### 2.1 Step A：DEFAULT_TIMEOUT_MS 升级

**改动点**: `scripts/eval-mcp-augmented.mjs:82`

```diff
- const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min hard ceiling，沿用 runner 默认
+ const DEFAULT_TIMEOUT_MS = 2_700_000; // 45 min hard ceiling（Feature 166 提升，缓解 Feature 165 §10.5.1 3/9 SIGTERM）
```

**潜在影响**:
- `spawnClaudeAndWait({ ..., timeoutMs: DEFAULT_TIMEOUT_MS })` 在 `runOne()` line 1272 是唯一调用方，自动生效。
- dry-run 模式（`args.dryRun`）不调 spawn，不受影响。
- 单测：搜索现有单测确认无硬编码 `1_800_000` / `1800000` / `30 * 60 * 1000` 断言。

**风险**: LOW
- 仅延长上限，已运行任务的最大耗时也只是 +15 min。

---

### 2.2 Step B：Driver model 升级

**改动点**: `scripts/eval-mcp-augmented.mjs:926`

```diff
  function buildClaudeArgsWithMcp({ prompt, mcpConfigPath = null }) {
    const args = [
      '--print',
      '--model',
-     'claude-sonnet-4-6',
+     'claude-opus-4-7', // Feature 166 GATE_DESIGN C-001=A: opus-4-7 解题能力提升（解决 §10.5.1 oracle 7/9 vs 实际 2/9 差距）
      '--output-format',
-     'text',
+     'stream-json', // Feature 166 Step C: 完整 reasoning trace + tool_use 捕获
      ...
```

**单测**: 修改或新增 `tests/unit/eval-mcp-augmented-classic.test.ts`（已含 buildClaudeArgsWithMcp 相关测试），断言 args 包含连续的 `['--model', 'claude-opus-4-7']` 和 `['--output-format', 'stream-json']`。

**风险**: MEDIUM
- opus-4-7 API quota 可用性（FR-017 preflight 处理）
- 单 run cost 升至 ~$1.25（依用户已确认预算 $1.5/run）

---

### 2.3 Step C：stream-json + parser（核心改动）

#### 2.3.1 buildClaudeArgsWithMcp `--verbose` 决策（硬决策，加）

**[已硬决策：加 `--verbose`]** — 依据：`scripts/eval-task-runner.mjs:224` 已有明确注释 `'--verbose', // stream-json 需要 --verbose 才能完整 dump tool_use block`，这是仓内既有的实证决策。沿用此决策不需要 implement 阶段再实测。

**args 顺序**:

```js
const args = [
  '--print',
  '--model',
  'claude-opus-4-7',
  '--output-format',
  'stream-json',
  '--verbose', // 新增（Feature 166 + 沿用 eval-task-runner.mjs:224 决策）
  '--permission-mode',
  'bypassPermissions',
  '--dangerously-skip-permissions',
];
```

`--verbose` 单测：buildClaudeArgsWithMcp 返回数组中必须包含 `--verbose`（FR-018 简化为单测断言）。

FR-018 在 spec 中保留作为"verify 阶段实测确认"，但 plan 不再延后决策，从一开始就加 `--verbose`。

#### 2.3.2 parse-claude-stream-json.mjs 设计

**模块路径**: `scripts/lib/parse-claude-stream-json.mjs`

**核心 API**:

```js
/**
 * 解析 claude CLI stream-json 输出。
 *
 * stream-json 格式：stdout 每行一个 JSON object（NDJSON），按时序对应：
 * - 1 行 type:'system' subtype:'init'（session 初始化）
 * - 0..N 行 type:'assistant'（assistant 消息，含 content[] = text/thinking/tool_use blocks）
 * - 0..N 行 type:'user'（user 消息，含 content[] = tool_result blocks）
 * - 1 行 type:'result' subtype:'success'|'error'（最终汇总）
 *
 * @param {string} stdout - claude CLI 完整 stdout
 * @returns {{
 *   events: Array<object>,
 *   reasoningTrace: string,
 *   malformedLineCount: number,
 *   totalLineCount: number
 * }}
 */
export function parseClaudeStreamJson(stdout) {
  // 1. 空 stdout / 非 string → 返回空结构
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return { events: [], reasoningTrace: '', malformedLineCount: 0, totalLineCount: 0 };
  }

  // 2. 按 \n split，过滤空行不计入 totalLineCount/malformed
  const rawLines = stdout.split('\n');
  const events = [];
  let malformedLineCount = 0;
  let totalLineCount = 0;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    totalLineCount += 1;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
        events.push(obj);
      } else {
        malformedLineCount += 1; // 合法 JSON 但不是 event object
      }
    } catch {
      malformedLineCount += 1; // malformed JSON 或 partial line
    }
  }

  // 3. 聚合 reasoningTrace：仅 type:'assistant' 事件的 message.content[] 中的 text + thinking
  const reasoningParts = [];
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        reasoningParts.push(block.text);
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        reasoningParts.push(block.thinking);
      }
      // 排除 tool_use / redacted_thinking blocks（EC-010）
    }
  }
  const reasoningTrace = reasoningParts.join('\n');

  return { events, reasoningTrace, malformedLineCount, totalLineCount };
}
```

**关键设计选择**:

- **流式按行解析**（EC-008）：用 `split('\n')` + 逐行 `JSON.parse` 而非整体 parse，避免 OOM；对超大 stdout（>10 MB）退化为 O(n) 时间 O(n) 空间，无栈风险。
- **JSON object schema 校验**：仅当顶层 `type: string` 存在才计入 events，否则视为 malformed。
- **空行不计入 totalLineCount**：避免分母被空行污染影响 SC-005 的 < 5% malformed 比例断言。
- **错误处理纯函数风格**：parser 不抛错、不写日志；caller 决定如何处理 malformedLineCount。

#### 2.3.3 runOne() 集成

**改动点**: `scripts/eval-mcp-augmented.mjs` cohort C 分支（约 line 1336+）+ realCostUsd 派生（line 1399-1400）

```diff
  if (group === 'C' && telemetryPath) {
    const t = parseTelemetryJsonl(telemetryPath);
    mcpToolCalls = t.mcpToolCalls;
    ...
  }

+ // Feature 166 FR-011: 解析 stream-json driver events（cohort C 专用）
+ let driverEvents = null;
+ if (group === 'C') {
+   driverEvents = parseClaudeStreamJson(runOutcome.stdout ?? '');
+ }

  if (group === 'C' && graphInjection?.status === 'success') {
    let patchText = '';
    ...
    const signals = extractConsumptionSignals({
      changedSymbols,
      mcpToolCalls,
-     stdout: runOutcome.stdout ?? '',
+     stdout: driverEvents?.reasoningTrace ?? '', // Feature 166 FR-012: reasoning trace 替代 stdout
      patchText,
    });
  }

  ...

- // 估算 cost：实跑暂置 null 待未来 LLM token usage 集成（FR-B-006）
- const realCostUsd = null;
+ // Feature 166 FR-019：从 stream-json result event 提取 total_cost_usd（cohort C 专用）。
+ // claude CLI stream-json result event schema 含 total_cost_usd / usage / duration_ms 字段。
+ // 非 cohort C 沿用 null（与之前一致）。
+ let realCostUsd = null;
+ if (group === 'C' && driverEvents) {
+   const resultEvent = driverEvents.events.find((e) => e?.type === 'result');
+   if (resultEvent && typeof resultEvent.total_cost_usd === 'number') {
+     realCostUsd = resultEvent.total_cost_usd;
+   }
+ }

  // runResult 写入新增字段
  return {
    ...,
+   driverEvents, // Feature 166 SC-004（cohort A/B 为 null）
  };
```

**关键设计**:
- `extractConsumptionSignals` 函数签名**不变**（保持 stdout 参数名向后兼容），但 cohort C 路径传入的语义是 reasoningTrace。
- `driverEvents` 字段无条件挂载（cohort A/B 为 null，cohort C 为 ParsedClaudeStream 对象）。
- 不修改 extractConsumptionSignals 内部逻辑（YAGNI；它的字符串匹配算法对 reasoning trace 同样适用）。
- **realCostUsd 派生（Codex C-010 修复）**：runOne 不增加 parser API 复杂度（YAGNI），从 events 数组直接 filter 出 result event 提取 `total_cost_usd`。如未来其他 cohort 也需要 cost，可复用同一逻辑。

#### 2.3.4 单测设计（FR-010 + (a)-(m)）

**文件**: `tests/unit/parse-claude-stream-json.test.ts`（≥13 测试用例）

| ID | 场景 | 验证点 |
|----|------|--------|
| (a) | 单条 type:'assistant' 含 text block | events.length=1, reasoningTrace='hello' |
| (b) | 单条 type:'user' content array | events.length=1, reasoningTrace='' (user 不计入 trace) |
| (c) | type:'assistant' 含 tool_use block | events 含该 block，但 reasoningTrace 不含 tool_use input |
| (d) | type:'user' 含 tool_result block | events 含 tool_result（caller 可 filter） |
| (e) | malformed JSON line（如 `{abc`） | malformedLineCount=1, totalLineCount=1, events.length=0 |
| (f) | 空字符串输入 | 返回 { events: [], reasoningTrace: '', malformedLineCount: 0, totalLineCount: 0 } |
| (g) | 仅 type:'system' init event | events.length=1, reasoningTrace='' |
| (h) | reasoningTrace 聚合多 assistant 多 text block | 聚合按事件顺序拼接（\n 分隔） |
| (i) | tool_use input 不进 reasoningTrace | 含 tool_use 但 input 字符串不在 trace 中 |
| (j) | end-to-end 复合 fixture（system + assistant×2 + user + result） | events.length=5, reasoningTrace 含 assistant text |
| (k) | redacted_thinking block 保留在 events 但不进 reasoningTrace | events 含 redacted_thinking，reasoningTrace 排除 |
| (l) | partial last line（无换行结尾） | 最后一行 malformed JSON 计 malformedLineCount，前面行正常 |
| (m) | 大输出（mock 1000 lines） | 按行流式解析无 OOM，events.length=1000（or 按 type 过滤后的数量） |

**单测风格**：参考现有 `tests/unit/eval-mcp-augmented-prompt.test.ts` 风格（vitest + import esm + describe/it）。

---

### 2.4 Step D：preflight + 1 个真实 cohort C run

**preflight check**（FR-017）:

```bash
claude --print --model claude-opus-4-7 --max-turns 1 --output-format text "ok"
```

- 在 verify 阶段（实际跑真实 run 前）执行。
- 成功 → 进入真实 run。
- 失败（401 / model not found / quota exceeded）→ 按 EC-012 处理：standalone 报错并提示用户。

**真实 cohort C run**（FR-013）:

```bash
node scripts/eval-mcp-augmented.mjs \
  --group C \
  --task <SWE-L001 或 SWE-L003> \
  --repeat 1 \
  --keep-temp  # 调试用
```

**验收检查**:

1. `tests/baseline/swe-bench-lite/runs/<group>/<taskId>/run-1.json` 存在
2. JSON 合法 + 含 `driverEvents.events.length > 0` + `driverEvents.reasoningTrace.length > 0`
3. malformedLineCount / totalLineCount < 5%
4. cost ≤ $1.5（从 `runResult.costUsd` 或 telemetry 读）
5. exit code 0（无 SIGTERM）

---

## 3. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| opus-4-7 quota 不够 | MEDIUM | FR-017 preflight + EC-012 fallback 决策路径（暂停等用户） |
| stream-json 实际 schema 与文档不符 | MEDIUM | parser 设计宽松（仅校验 type:string），EC-008 / EC-009 / EC-010 覆盖边界 |
| `--verbose` 决策错误 | LOW | 已硬决策加（沿用 eval-task-runner.mjs:224）；FR-018 simplified 为单测断言 |
| 1 个真实 run 超出 $1.5 预算 | LOW | EC-006 硬上限；超出按 SC-005 FAIL 处理；realCostUsd 已从 result event 派生（plan §2.3.3） |
| extractConsumptionSignals 签名变更打破调用方 | LOW | 保持函数签名不变，仅语义升级（stdout 参数传 reasoning trace） |
| 现有单测断言 timeout / model / output-format 字面值 | LOW | grep 检查 + Step A/B/C 单测更新同步 |
| cohort A/B stdout 也变 NDJSON 影响 parseSubAgentSelfReport | LOW | runOne.subAgentStdout 字段沿用原 runOutcome.stdout（line 1422），parseSubAgentSelfReport 在上游 finalize 阶段读，不在 runOne 内部消费；如发现回归在 T-005 全量 vitest 暴露 |
| dry-run 模式 args preview 输出格式变化打破 snapshot 测试 | LOW | T-003.5 子步骤显式验证 dry-run snapshot；若有断言变化，同步更新 |

---

## 4. 验证计划

### 4.1 单测验证（implement 阶段）

```bash
# 新增 parser 单测
npx vitest run tests/unit/parse-claude-stream-json.test.ts

# 现有 eval-mcp-augmented 单测全 PASS
npx vitest run tests/unit/eval-mcp-augmented

# 全量回归
npx vitest run
```

### 4.2 编排器独立验证（Phase 4.5）

```bash
npm run build        # TypeScript 零错误
npm run repo:check   # release contract + plugin sync 零警告
npm run release:check # 如果触及发布合同（本 Feature 不涉及，但 repo:check 已包含）
```

### 4.3 端到端验证（Phase 5）

执行真实 cohort C run（见 Step D）。

---

## 5. 不在范围（重申）

- ❌ T052 全量 450 runs 实跑
- ❌ §10.5.1 已有报告内容修改
- ❌ Cohort A / B prompt 内容改动（args 共享 EC-011 已处理）
- ❌ Driver model env var 抽象（YAGNI）
- ❌ parser 扩展到 toolUses / toolResults 显式字段（YAGNI；调用方自行 filter events）
- ❌ extractConsumptionSignals 算法改进
- ❌ telemetry schema 变更

---

## 6. 提交策略 + rebase 时机

| commit | 范围 | 何时 | rebase 时机 |
|--------|------|------|------------|
| `docs(166): Phase 2 specify ...` | spec.md | 已完成（7d1b663） | commit 前已确认与 origin/master 一致 |
| `docs(166): Phase 3 plan + tasks` | plan.md + tasks.md | 本次 | commit 前 rebase 最新 master（若有新 commit 且影响 eval-mcp-augmented.mjs 需重审 plan） |
| `feat(166): Step A+B+C 实现 + 单测` | 改 eval-mcp-augmented.mjs + 新 parser + 新单测 | implement 阶段，pass Phase 4.5 后 | T-007 commit 前 `git fetch origin master && git rebase origin/master`；若 master 有改动 eval-mcp-augmented.mjs 则**必须重跑 T-005..T-007** |
| `docs(166): Step D verify 真实 run + verification-report.md` | verification-report.md（不入库 run fixture） | verify 阶段，pass GATE_VERIFY 后 | T-012 commit 前 rebase；若 master 已变需重跑 T-005 全量验证（不需要重跑真实 run） |
| **push origin master**（如用户决定交付到 master） | 上面 3 commit 合并 | verify 完成后，**必须用户明确授权 push** | push 前最后一次 rebase 确认线性历史 |

**每个 commit 前 Codex 对抗审查**:

| Phase | Codex review 任务 |
|-------|------------------|
| specify | 已完成（commit 7d1b663 前 round 1：3 CRITICAL + 5 WARNING + 1 INFO） |
| plan + tasks | **本次合并 review**（plan 阶段 1 次覆盖 plan + tasks 两份制品）— 节省 1 次 round-trip，符合 CLAUDE.local.md 五 phase 表 |
| implement | T-006（implement commit 前必跑） |
| verify | T-011（verify commit 前必跑） |

**Codex review 最大轮次约束**:
- 每个 phase 的 Codex review 最多 **2 轮**（round 1 + round 2 fix 确认）
- 第 3 轮仍有 CRITICAL → **必须暂停**并向用户报告，决策是否降级到部分交付
- WARNING 第 2 轮可记录原因不修复（commit message 标注）
- INFO 始终可选
