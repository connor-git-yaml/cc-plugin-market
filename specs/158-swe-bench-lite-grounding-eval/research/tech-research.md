# Tech Research — Feature 158: SWE-Bench Lite Grounding Eval

**模式**: 独立模式（codebase-scan，未参考 product-research.md）
**日期**: 2026-05-09
**调研范围**: 仓库内扫描，在线调研留待后续 Phase 1d 补充

---

## 0. 调研目标

验证 Feature 158 核心 hypothesis：Spectra MCP `pull` 模式（Claude Code agent 按需 query `impact` / `context` / `detect_changes`）在 task pass rate 上优于 spec.md `push` 模式。

Sprint 3 Phase 5 已实测 **grounding lift = 0**（spec.md push 与裸 baseline 无显著差异）。本 Feature 通过 SWE-Bench 风格 task fixture 验证 MCP pull 是否能突破这一瓶颈。

---

## 1. 既有能力盘点

### 1.1 Feature 155 MCP Tools

**文件**: [`src/mcp/agent-context-tools.ts`](../../src/mcp/agent-context-tools.ts) + [`src/mcp/graph-tools.ts`](../../src/mcp/graph-tools.ts)

**MCP server 启动方式**:
- `spectra mcp-server`（stdio JSON-RPC 2.0）
- Claude Code 在 `.claude/settings.local.json` 或项目 MCP config 配置接入
- dev 模式：`spectra mcp-server --dev`（tsx --watch 热重载）

#### tool: `impact`

| 项 | 详情 |
|----|------|
| input | `target: string`（symbol id，格式 `path/to/file.py::Class.method`），`depth?: 0-20`（默认 2，clamp max 5），`minConfidence?: 0-1`（默认 0.65），`direction?: 'upstream'\|'downstream'\|'both'`（默认 upstream），`budget?: 0-10000`（默认 200，clamp max 1000），`projectRoot?: string` |
| output | `{ affected: BfsAffected[], summary: { directCallers, transitive, riskTier: 'low'\|'medium'\|'high' }, effectiveDepth, effectiveBudget, warnings? }` |
| 典型 token 量 | micrograd 上约 100-500 token（小型 graph 24 KB，46 nodes，4 calls 边） |
| 底层依赖 | `getCachedGraphData(projectRoot)` → `bfsTraverse` + `canonicalizeSymbolId` + `findFuzzyMatches`（来自 `src/knowledge-graph/query-helpers.ts`） |
| 已知限制 | Python dunder method（`__add__` 等）经 operator 触发的调用不被静态捕获（Feature 151 known limitation） |

#### tool: `context`

| 项 | 详情 |
|----|------|
| input | `symbolId: string`，`include?: ('callers'\|'callees'\|'imports'\|'related-spec')[]`（默认 `['callers','callees','imports']`），`projectRoot?: string` |
| output | `{ definition: { id, file, kind, label, lineStart?, lineEnd?, confidence? }, callers?, callees?, imports?, relatedSpec? }` |
| 典型 token 量 | 约 200-800 token（含 definition + neighbors） |
| 底层依赖 | `getCachedGraphData` → `findNode` + `collectNeighbors`（`links` 双向遍历）+ `deriveRelatedSpec`（查找 `.spec.md` 候选文件） |

#### tool: `detect_changes`

| 项 | 详情 |
|----|------|
| input | `diff?: string`（unified diff 文本，5 MB 上限）或 `baseRef?: string`（git ref），`depth/budget/minConfidence`（同 impact 参数），`projectRoot?: string` |
| output | `{ changedSymbols: [{file, changeKind, symbols[]}], affectedSymbols: BfsAffected[], riskSummary: { totalChanged, totalAffected, riskTier }, unmappedFiles, warnings? }` |
| 典型 token 量 | 约 300-1000 token |
| 底层依赖 | `parseUnifiedDiff` / `runGitDiffNameStatus` → `buildFileSymbolIndex` → 共享 budget BFS（复用 `bfsTraverse`） |

**Feature 155 验收数据**（来自 [`specs/155-agent-context-mcp-tools/verification/verification-report.md`](../../specs/155-agent-context-mcp-tools/verification/verification-report.md)）：
- 单测：85 new cases（query-helpers 38 + agent-context 36 + graph-tools-cache 6 + integration 5）
- 全量 vitest：3240 passed / 0 failed
- cold-start：约 30 ms（micrograd graph 24 KB）
- hot-path 延迟：< 5 ms

**关键合约**：MCP payload 上限 1 MB（`PAYLOAD_CAP_BYTES = 1_000_000`），超限自动 truncate `affected` / `affectedSymbols` 并附 `payload-truncated` warning。错误响应统一 envelope：`{ isError: true, content: [{ type: 'text', text: JSON({code, message, hint?, context?}) }] }`。

### 1.2 既有 eval 基础设施盘点

| 脚本 | 用途（一句话） | Feature 158 可复用部分 |
|------|-------------|----------------------|
| `eval-task-runner.mjs` | worktree 准备 + spawn claude CLI + oracle 验证 + fixture 组装 | **全量复用**：`loadTaskFixture` / `prepareWorktree` / `runPrimaryOracle` / `assembleTaskFixture` / `buildClaudeArgs` / `loadSpectraContext` |
| `eval-task-prepare.mjs` | 为主 session 准备 worktree + 输出 prompt（不 spawn claude） | worktree 准备逻辑可复用 |
| `eval-task-executor.mjs` | GLM single-turn 统一 executor（所有 tool 用同 model） | 单轮执行模式参考；F158 需要 multi-turn + MCP 接入 |
| `eval-task-finalize.mjs` | in-session task 完成后写 fixture（legacy） | oracle 运行 + fixture 写入逻辑 |
| `eval-task-fixture-check.mjs` | 验证 oracle 在 setup 后不立即 PASS（sanity check） | **直接复用**：新 task fixture 须通过此检查 |
| `eval-batch-repeat.mjs` | N 次重测聚合 pass rate + 95% CI（bootstrap） | **部分复用**：统计学框架（`lib/bootstrap-ci.mjs`）直接引用 |
| `eval-competitor.mjs` | 多 tool 竞品数据收集（spectra / graphify / aider） | 参考 tool dispatch 架构 |
| `eval-grounding.mjs` | 4 对照组各调 sonnet + opus judge 双盲评分 | **核心参考**：`loadControl` / `loadSpectraContext` / `runSonnetWithContext` 直接对应 F158 对照组设计 |
| `eval-judge.mjs` | LLM-as-judge（opus 双盲评分）+ rubric 加载 | `callJudge` / `parseJudgeOutput` / `loadRubric` 直接复用 |
| `eval-judge-jury.mjs` | cross-LLM jury 多模型交叉评分 | jury 评分可选引入以提升评分可信度 |
| `eval-report.mjs` | 从 fixture 聚合报告 + Feature 155 capability probe | `probeAgentContextCapability()` 直接复用验证 MCP tool 注册 |
| `eval-cost-backfill.mjs` | 回填 fixture `costUsd` 字段（基于 token 估算） | 成本追踪可复用 |
| `eval-refresh-self.mjs` | 升版后只重跑 self fixtures | 不直接复用 |

**task fixture 格式**（`specs/147-.../research/task-fixtures/T*.json`）：

```jsonc
{
  "taskId": "T1-micrograd-add-tanh",
  "target": "karpathy/micrograd",
  "startCommit": "<sha>",
  "prompt": "<自然语言任务描述>",
  "setupCommands": ["<bash cmd>", ...],  // 注入 bug / strip 已有实现
  "primaryOracle": {
    "kind": "functional",  // functional | ast-diff | stop-condition | unit-test
    "checks": [
      { "cmd": "<bash>", "description": "...", "mustPass": true, "timeoutMs": 10000 }
    ]
  }
}
```

**pass rate 计算**：`oracle.passed === true` 即 PASS；`assembleTaskFixture` 中 `taskExecution.primaryOracle.passed` 字段为唯一真值；`eval-batch-repeat.mjs` 聚合 N 次取中位数 + bootstrap 95% CI。

**runner 如何注入 context**：

```
eval-grounding.mjs 模式：
  control: 仅文件名 (80 B)
  spectra-push: spec.md 内容前置于 prompt（12 KB cap）
  
F147 eval-task-runner.mjs 模式（spec-driver-spectra tool）：
  prompt 顶部追加 spectra spec.md context header
  
F158 新增：
  mcp-pull: Claude Code agent 在 session 内自主调 impact/context/detect_changes
  → 需要 MCP server 在 worktree 内可访问（projectRoot 指向 worktree target）
```

### 1.3 tests/baseline/ fixture 结构

**4 个 baseline projects**（`tests/baseline/<project>/<tool>/full.json`）：

| project | tool fixtures | 含义 |
|---------|--------------|------|
| `hono` | spectra / graphify / aider-repomap | honojs/hono TS API 框架（~30k LOC） |
| `micrograd` | spectra / graphify / aider-repomap | karpathy/micrograd Python（248 LOC） |
| `nanoGPT` | spectra / graphify / aider-repomap | karpathy/nanoGPT Python（~1.5k LOC） |
| `self-dogfood` | spectra / graphify / aider-repomap | 本仓库（~250 .ts / 17 module） |

`full.json`：perf anchor fixture，追踪 wall time / token / graph node/edge count 等，**入库**，跨版本对比 anchor。

`truth-set.json`：外部代码 AST 抽取结果（Feature 150 graph accuracy），**不入库**，每次 graph-accuracy 重生。

**task fixtures**（`tests/baseline/tasks/T*/`）：评估流程产物，**不入库**（CLAUDE.local.md 明确）。

**已有 task fixtures**（`specs/147-.../research/task-fixtures/`）：

| fixture | target | oracle kind |
|---------|--------|-------------|
| T1-micrograd-add-tanh | micrograd | functional（5 checks，含 pytest） |
| T2-nanogpt-cosine-lr | nanoGPT | functional（strip cosine LR 后验证） |
| T3-micrograd-fix-bug | micrograd | functional |
| T4-micrograd-extract-const | micrograd | functional |
| T6-violation-refusal | micrograd | stop-condition（surface refusal 而非执行） |

### 1.4 verify-feature-{N}.mjs pattern

**现有文件**：`verify-feature-151.mjs` / `152.mjs` / `153.mjs` / `154.mjs` / `156.mjs`

**共同结构**：

```js
// 入口：node scripts/verify-feature-N.mjs [--target <path>] [--out <file>] [--repeats N]
// 参数解析：parseArgs(process.argv)

// SC 验证项形式：
// 1. npm run build 前置（动态 import dist/ 产物）
// 2. 调 dist/ 导出函数（知识图谱 / analyzer）
// 3. 比对 precision/recall 数值 vs 门槛
// 4. 文件存在 / spec 引用检查（`fs.existsSync`）

// 输出格式：
// console.log('[SC-001] PASS: ...' / '[SC-001] FAIL: ...')
// process.exit(0) = 全部 SC 通过；process.exit(1) = 任一未通过
```

**无共享 helper**：各 verify-feature 脚本各自独立，无统一 helper 模块。 F158 的 `verify-feature-158.mjs` 需从零编写，但可参考 SC 验证表达式风格。

---

## 2. 本 Feature 实现路径选择

### 2.1 核心对照组设计

Feature 158 需要验证 3 个 agent 条件下的 task pass rate：

| 对照组 | context 注入方式 | 对应 eval-grounding.mjs 中 |
|--------|----------------|--------------------------|
| `control` | 裸 Claude Code（无额外 context） | `loadControl()` |
| `spectra-push` | spec.md 注入到 system prompt | `loadSpectraContext()` |
| `spectra-mcp-pull` | Claude Code session 内自主调用 MCP tools | **新增**（无现成对照） |

Sprint 3 Phase 5 已验证：`spectra-push` grounding lift = 0（与 control 无显著差异）。  
F158 目标：验证 `spectra-mcp-pull` 是否有显著正 lift。

### 2.2 方案对比：复用 vs 新建

#### 方案 A：扩展 eval-grounding.mjs（最小修改）

**思路**：在 `eval-grounding.mjs` 的 `CONTEXT_LOADERS` 数组新增 `loadMcpPullContext`，让 Claude Code agent 在 `--permission-mode bypassPermissions` 下运行，并带 MCP server 配置。

| 维度 | 评估 |
|------|------|
| 复用度 | 高（复用现有 4 对照组框架、judge 链路、fixture 写入） |
| 改动量 | 小（新增 1 个 loader + MCP server 启动参数） |
| 风险 | `eval-grounding.mjs` 当前硬编码 `SONNET_MODEL` 单轮调用，无 multi-turn / worktree 支持 |
| 适用性 | 仅适合 grounding-style 评分（sonnet 生成代码 → opus judge）；不能跑 functional oracle |

**结论**：不适合，因为 F158 需要 functional oracle（pytest / 真实代码执行）来验证 task 真实完成，而非 LLM judge 打分。

#### 方案 B：扩展 eval-task-runner.mjs（推荐）

**思路**：新增 `mcp-pull` 作为 `SUPPORTED_TOOLS` 的第 6 个选项，`buildDriverPrompt` 新增 case，`buildClaudeArgs` 加 MCP server 参数。

| 维度 | 评估 |
|------|------|
| 复用度 | 极高（`prepareWorktree` / `runPrimaryOracle` / `assembleTaskFixture` 全量复用） |
| 改动量 | 中（eval-task-runner.mjs 新增约 30-50 行，新增 `eval-mcp-augmented.mjs` 入口约 100 行） |
| 风险 | MCP server 如何在 worktree 内访问 spectra graph（需要 projectRoot 指向 worktree target 还是仓库本身） |
| 适用性 | 完全适合：functional oracle + worktree 隔离 + fixture schema 复用 |

**结论**：推荐方案 B。

#### 方案 C：全新 eval-mcp-augmented.mjs（独立脚本）

**思路**：参考 `docs/design/spectra-mcp-evolution.md §Feature 153` 规划，新建独立脚本，不改动现有 runner。

| 维度 | 评估 |
|------|------|
| 复用度 | 低（重复实现 worktree / oracle / fixture 逻辑） |
| 改动量 | 大 |
| 风险 | 与现有 fixture schema 漂移 |

**结论**：不推荐（重复造轮子）。

### 2.3 推荐实现路径（方案 B + 少量新脚本）

```
新建 artifacts（最小成本）：
├── scripts/eval-mcp-augmented.mjs      # 入口脚本，封装 3 对照组跑法
│   （功能：spawn 3 tool 对照组 → 聚合 pass rate → 写报告）
│
├── specs/158-.../research/task-fixtures/
│   ├── T158-micrograd-mcp-X.json       # 2-3 个新 task fixture（适合 MCP 场景）
│   └── ...
│
└── scripts/verify-feature-158.mjs      # SC 验证脚本（检查 fixture 存在 + pass rate 门槛）

修改 artifacts（最小改动）：
└── scripts/eval-task-runner.mjs        # 新增 'mcp-pull' tool case（约 30-50 行）
```

---

## 3. 接入点与关键依赖

### 3.1 MCP pull 模式的 Claude Code 接入

**关键问题**：MCP pull 模式下，Claude Code agent 需要在 worktree 内运行，同时 MCP server 需要知道 `projectRoot`（graph.json 在哪里）。

```
两种接入策略：

策略 1（graph 来自仓库本身）：
  MCP server projectRoot = 本仓库（self-dogfood graph）
  worktree target = 任意代码修改目标
  限制：只对"本仓库内代码修改任务"有效；对 micrograd/nanoGPT task 无意义

策略 2（graph 来自 target baseline）：
  在 worktree 内先跑 spectra batch 生成 graph
  MCP server projectRoot = worktree 内 target 项目
  成本：每个 worktree 一次 spectra batch（micrograd 约 $0.55 / 3 min）
  限制：增加 setup 时间和成本
```

**[推断]** 策略 1 适合 self-dogfood task（本仓库代码改动场景）；策略 2 适合 micrograd/nanoGPT task。F158 初期优先策略 2（micrograd graph 小，成本可控）。

### 3.2 MCP server 在 eval 中的启动方式

```bash
# 现有 MCP server 启动（stdio JSON-RPC）
spectra mcp-server

# eval 中接入方式选项：
# A. Claude Code 的 MCP config（.claude/settings.local.json 或 worktree 内 .mcp.json）
# B. 直接通过环境变量 CLAUDE_MCP_SERVER_COMMAND 配置（Claude Code CLI 支持）
# C. 通过 --mcp-server flag（需确认 claude CLI 版本）
```

**[推断]** 最可行的接入方式是在 worktree 内写入 `.mcp.json` 配置，指定 `spectra mcp-server` 命令和 `projectRoot` 参数。需要验证 `claude --print` + MCP 配置能否在非 interactive session 中正常调用。

**关键文件**：
- [`src/mcp/server.ts`](../../src/mcp/server.ts)：`createMcpServer()` - 14 tools 注册
- [`src/mcp/index.ts`](../../src/mcp/index.ts)：`startMcpServer()` stdio 入口
- [`src/cli/commands/mcp-server.ts`](../../src/cli/commands/mcp-server.ts)：CLI 命令，含 dev 模式

### 3.3 要修改 / 新建的文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/eval-task-runner.mjs` | 修改 | 新增 `'mcp-pull'` tool case，`buildClaudeArgs` 加 MCP 配置参数 |
| `scripts/eval-mcp-augmented.mjs` | 新建 | 3 对照组入口脚本（control / spectra-push / mcp-pull） |
| `scripts/verify-feature-158.mjs` | 新建 | SC 验收脚本（fixture 存在 + pass rate 门槛） |
| `specs/158-.../research/task-fixtures/T158-*.json` | 新建 | 2-3 个适合 MCP 场景的 task fixture |
| `tests/baseline/tasks/T158-*/` | 运行时生成 | eval 产物，不入库 |

---

## 4. 风险与不确定性

### 4.1 高风险：MCP pull 接入的 non-interactive session 兼容性

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `claude --print` 模式下 MCP tool call 不触发（tool_use only in interactive mode） | 中 | 高 | 提前用 `--skip-run` 模式测试 MCP 调用是否在 stdout 有记录；若失败改用 claude SDK 直调 |
| MCP server 在 worktree 内 projectRoot 解析不正确 | 中 | 高 | 显式传 `--projectRoot` 参数；在 worktree setup 后验证 graph.json 存在 |
| spectra graph 在 target project 上不存在（需先跑 batch） | 高 | 中 | eval setup 阶段加 `spectra batch` step；micrograd $0.55 × N tasks 成本可控 |

### 4.2 中风险：task fixture 设计的 failure mode

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 新 task fixture 的 oracle 假阳性（setup 后立即 PASS） | 中 | 高 | **强制**先跑 `eval-task-fixture-check.mjs --task T158-*` 验证 |
| Task 太简单（control 组已 100% PASS）→ 天花板效应 | 中 | 高 | 选 6-10 个有 caller graph 依赖的中等复杂度任务（不只是简单函数补全） |
| Task 太难（所有 agent 0% PASS）→ 地板效应 | 低 | 高 | 基于已有 T1-T4 难度档校准；先用 T1-T4 做对照组预热跑 |

### 4.3 统计学陷阱

| 风险 | 说明 | 缓解 |
|------|------|------|
| 样本量不足（N=5 task） | 5 task 的 pass rate 方差极大；pass 4/5 vs 5/5 差距 20pp，但置信区间极宽（±30pp） | 目标 ≥ 10 task；引用 bootstrap 95% CI（`lib/bootstrap-ci.mjs` 已有实现） |
| LLM 随机性（单次跑） | 同一 task 同一 tool 多次运行 pass rate 可能差 ±20% | 每组至少 N=3 重测取中位数（`eval-batch-repeat.mjs`）；预算允许时 N=5 |
| Grounding lift = 0 可能是 confound | Sprint 3 测的是"spec.md push"，不是"MCP pull"；确实是不同 hypothesis | F158 这次区分两种接入方式，不混淆结论 |
| judge 偏差（self-bias） | 用 opus 评分可能偏向 claude 自己生成的代码 | functional oracle 是第一道客观防线；judge 仅作辅助评分 |

### 4.4 $50 预算 LLM 调用次数估算

```
前提：
  - 3 对照组（control / spectra-push / mcp-pull）
  - 10 task fixture
  - N=3 重测取中位数

估算：
  每次 claude task run（sonnet）：约 $0.10-$0.30
  MCP-pull 模式额外 spectra batch（micrograd）：$0.55 / task setup（共享，只跑 1 次）
  judge（opus）：约 $0.05-$0.10 / run

  总计：3 对照 × 10 task × 3 次重测 = 90 runs
        90 × $0.20（中位成本）= $18
        judge 运行：90 × $0.08 = $7.2
        spectra batch setup（micrograd/nanoGPT）：~$3
        总估算：约 $28-$35

  结论：$50 预算在 3 对照 × 10 task × N=3 重测场景下足够；
        如果扩到 N=5 或 15 task，需约 $60-$80（超预算）
```

---

## 5. 遗留待在线补充的开放问题

以下问题未在仓库内找到答案，需要 Phase 1d 在线调研：

| # | 开放问题 | 影响 |
|---|---------|------|
| 1 | SWE-Bench Lite 数据集获取方式和许可（Princeton-NLP/SWE-bench），是否需要 HuggingFace 账号 | task fixture 选型是否可以直接拉 SWE-bench task，还是要手工改写 |
| 2 | SWE-Bench bug fix task 是否能在 Claude Code worktree 内直接 reproduce（Python 环境 / 依赖复杂度） | worktree setup 成本；简单 task（micrograd 量级）vs 复杂 task（需要 Django/Flask 环境）差异极大 |
| 3 | Claude Code CLI `--print` 模式下 MCP tool call 的实际行为（stdout 是否包含 tool_use block / tool_result） | 决定 MCP pull 对照组是否可行；若不可行需改用 claude SDK 直调 |
| 4 | GitNexus eval/ 目录结构（内部调研报告提到 GitNexus 有 eval 框架，但仓库内无 raw 数据） | 是否有可借鉴的 task fixture 设计 / oracle 设计 |
| 5 | spectra MCP server 接受 `projectRoot` 参数的实际传递方式（通过 .mcp.json config 还是 tool 调用时传参） | 影响 worktree setup 脚本设计 |
| 6 | 现有 `eval-grounding.mjs` Sprint 3 Phase 5 grounding lift = 0 的原始数据（fixture 在哪个路径？） | 作为 F158 baseline 对比起点 |

---

## 6. 需求-技术对齐度评估

| 需求点 | 技术覆盖度 | 备注 |
|--------|-----------|------|
| 3 对照组 task pass rate 对比 | ✅ 方案 B 完整覆盖 | eval-task-runner.mjs 已有 control / spectra-push；新增 mcp-pull |
| functional oracle（不靠 LLM judge） | ✅ 已有 `kind: 'functional'` oracle | T1-T4 均已用 functional oracle |
| MCP pull 模式接入 | ⚠️ 设计上可行，实际需验证 claude --print + MCP | 最高风险点，建议 Phase 2 spec 前先做 spike |
| 统计显著性（95% CI） | ✅ `lib/bootstrap-ci.mjs` 已有实现 | eval-batch-repeat.mjs 复用 |
| $50 预算内 | ✅ 3×10×N3 = ~$28-35 | 有余量 |
| verify-feature-158.mjs SC 验收 | ✅ 参考 151/153 pattern | 新建，不复用现有 |
| SWE-Bench Lite task fixture | ⚠️ 需要在线调研确认获取方式 | Phase 1d 补充 |

---

## 附：关键文件路径速查

- MCP tools 实现：[`src/mcp/agent-context-tools.ts`](../../src/mcp/agent-context-tools.ts)
- MCP server 注册：[`src/mcp/server.ts`](../../src/mcp/server.ts)
- eval-task runner（核心复用点）：[`scripts/eval-task-runner.mjs`](../../scripts/eval-task-runner.mjs)
- eval-grounding（对照组参考）：[`scripts/eval-grounding.mjs`](../../scripts/eval-grounding.mjs)
- 已有 task fixtures：[`specs/147-competitor-evaluation-platform/research/task-fixtures/`](../../specs/147-competitor-evaluation-platform/research/task-fixtures/)
- bootstrap CI：[`scripts/lib/bootstrap-ci.mjs`](../../scripts/lib/bootstrap-ci.mjs)
- Feature 153 设计（SWE-Bench eval 原始规划）：[`docs/design/spectra-mcp-evolution.md §Feature 153`](../../docs/design/spectra-mcp-evolution.md)
- Feature 155 verification report：[`specs/155-agent-context-mcp-tools/verification/verification-report.md`](../../specs/155-agent-context-mcp-tools/verification/verification-report.md)
- Constitution 约束：[`.specify/project-context.yaml`](../../.specify/project-context.yaml)
