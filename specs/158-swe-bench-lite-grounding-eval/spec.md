---
feature: 158
title: SWE-Bench Lite Grounding Eval — MCP Pull vs Push vs Control
branch: claude/focused-sutherland-5ccdfb
created: 2026-05-09
status: Draft
budget: ~$50 / ~2 weeks
---

# Feature 158 — SWE-Bench Lite Grounding Eval

## 背景与目标

Sprint 3 Phase 5 已通过 cross-LLM jury 实测：**spec.md push 模式 grounding lift = 0**（相对裸 baseline 无显著差异，n=3 task × 4 cohort）。本 Feature 验证 Spectra MCP **pull** 模式（Claude Code agent 按需调用 `impact` / `context` / `detect_changes` 三个 tool）是否能突破这一瓶颈。

### 核心 Hypothesis

- **H₀**：MCP pull 模式的 task pass rate 与裸 Claude Code baseline 无显著差异
- **H₁**：MCP pull 模式 task pass rate 显著高于裸 baseline（grounding lift > 0）

### 关键前提（已收口）

| 决策 | 结论 | 依据 |
|------|------|------|
| `claude --print` + MCP 是否可行 | ✅ 可行，已 spike 解除 C-2 | [spike-claude-print-mcp.md](research/spike-claude-print-mcp.md) |
| task fixture 类型 | micrograd/nanoGPT-style 简化 task（非 SWE-Bench docker harness） | C-3 预算保护；$50 内可控 |
| 工具栈 | Node-only，不引入 Python / Docker | W-5 缓解；spike 已证可行 |
| 评分方式 | functional oracle（pytest / 真实代码执行），不靠 LLM judge | W-6；差异化 Sprint 3 judge-heavy 实验 |

---

## User Stories

### US-1 — 三对照组 Task Pass Rate 对比（P1）

研究者希望在同一批 task 上，分别以三种 agent 模式跑评，得到可对比的 pass rate + bootstrap 95% CI，从而判断 MCP pull 是否带来统计上显著的 grounding lift。

**优先级理由**：这是 Feature 158 唯一核心 hypothesis 的直接验证，其他所有 story 都是它的基础设施。

**独立测试方式**：执行 `node scripts/eval-mcp-augmented.mjs --task T158-X --tool mcp-pull --repeats 3`，可看到 control / spectra-push / spectra-mcp-pull 三组 pass rate 与 CI。

**验收场景**：
1. **Given** 6 个 T158-* task fixture 已入库，**When** 以 `control` 模式跑全部 task × N=3，**Then** 每个 task 输出 `{ taskId, tool: "control", passRate, bootstrapCI95 }` 结构化结果
2. **Given** `spectra-push` 模式跑完，**When** 与 `control` 对比，**Then** pass rate 差值如实记录（无论正负），不预设 lift 必为 0；若差值 > 5pp 在报告 §6 附注说明并讨论与 Sprint 3 结论的差异
3. **Given** `spectra-mcp-pull` 模式跑完，**When** agent session 内 spectra tool 调用次数 > 0，**Then** fixture 含 `mcpToolCallTrace` 字段且 `callCount > 0`

---

### US-2 — MCP Tool Call Trace 监控（P1）

研究者希望验证 MCP pull 模式下 agent 确实调用了 spectra tool，而非"注册了 MCP 但从未触发"，以证伪 "no tools called" trap（MCP-Atlas 报告 36-42% 失败来自此 trap）。

**优先级理由**：若 agent 从未调用 spectra tool，则 pass rate 差异无法归因于 grounding，实验结论无效。

**独立测试方式**：执行单个 task 的 mcp-pull 模式，检查 stdout stream-json 中是否含 `tool_use` block，名称为 `mcp__spectra__*`。

**验收场景**：
1. **Given** mcp-pull 模式启动，**When** stream-json 输出解析完毕，**Then** `mcpToolCallTrace` 字段记录每次 spectra tool 调用的 `toolName / callCount / firstCallTurn / totalDurationMs`
2. **Given** 某个 task 的 spectra tool `callCount = 0`，**When** 汇总报告生成，**Then** 该 task 被标记为 `W-3-FLAGGED` 异常并在报告中突出显示

---

### US-3 — Task Fixture 库（P1）

研究者需要 4-6 个新 task fixture（T158-*），其中至少 2 个含 caller graph 跨函数依赖，适合突出 MCP grounding 的优势（单函数补全任务无法体现 graph 查询价值）。

**优先级理由**：没有合适的 task fixture，三对照组的实验结论对 grounding 假设毫无区分力（天花板 / 地板效应）。

**独立测试方式**：对每个 T158-* 运行 `eval-task-fixture-check.mjs`，确认 oracle 在 setup 后不立即 PASS（即 fixture sanity check 通过）。

**验收场景**：
1. **Given** T158-* fixture 文件放入 `specs/158-.../research/task-fixtures/`，**When** 运行 `eval-task-fixture-check.mjs --task T158-X`，**Then** 输出 `sanity: ok`（setup 后 oracle FAIL，改动后才 PASS）
2. **Given** 一个含 caller graph 依赖的 task，**When** `control` 模式以 Read/Grep 解题，**Then** pass rate 预期低于 `mcp-pull` 模式（因为 graph 上下文缩小了搜索范围）

---

### US-4 — 统计聚合与报告输出（P2）

研究者希望将 3 对照组 × 6 task × N=3 重测的 90 次运行结果，聚合为可读的对比矩阵，并写入既有总报告 §6 章节，结论包含 bootstrap 95% CI。

**优先级理由**：是科学结论输出的最后一步，但不影响实验本身是否可运行。

**独立测试方式**：检查 `competitive-evaluation-report.md §6` 是否存在，并含 pass rate 矩阵 + CI + tool call trace 统计。

**验收场景**：
1. **Given** 90 次运行 fixture 落盘，**When** 聚合报告生成，**Then** §6 包含：pass rate 矩阵（3 cohort × 6 task）、bootstrap 95% CI、token 效率对比（MCP pull 相对 push 节省比例）
2. **Given** MCP pull 模式 grounding lift 不显著（lift < 5pp），**When** 报告定稿，**Then** §6 明确声明"sonnet 4.6 + micrograd 量级任务下 grounding lift 整体不显著"，并提出 follow-up 方向

---

### US-5 — verify-feature-158.mjs 自动验收（P2）

研究者希望所有 Success Criteria 能通过一条命令自动验收，输出结构化 PASS/FAIL。

**优先级理由**：是交付质量门禁，减少人工检查成本。

**独立测试方式**：`node scripts/verify-feature-158.mjs` 退出码 0 即全部 SC PASS。

**验收场景**：
1. **Given** 所有制品已生成，**When** 执行 `node scripts/verify-feature-158.mjs`，**Then** 每个 SC 输出 `[SC-00N] PASS: ...`，process 退出码为 0
2. **Given** 任一 SC 失败（如 fixture 缺失），**When** 执行 verify 脚本，**Then** 输出 `[SC-00N] FAIL: ...` 并 process.exit(1)

---

## 功能需求 (Functional Requirements)

### FR-001 Task Fixture 设计 `[必须]`

| 项 | 要求 |
|----|------|
| 数量 | 4-6 个新 T158-* fixture，覆盖 2+ 个含 caller graph 跨函数依赖的中等难度 task |
| Target | karpathy/micrograd 和/或 karpathy/nanoGPT（与既有 baseline 对齐） |
| Oracle | `kind: "functional"`（pytest / shell 命令验证，不靠 LLM judge） |
| 难度校准 | `control` 组不得全部 100% PASS（天花板效应），也不得全部 0% PASS（地板效应）；以 T1-T4 历史数据作为难度参考 |
| 新增字段 | `expectedSpectraToolCalls?: string[]`（声明 mcp-pull 模式预期应调用的 tool 名） |
| Sanity check | 每个 fixture 必须通过 `eval-task-fixture-check.mjs` 验证（setup 后 oracle FAIL） |
| 入库路径 | `specs/158-swe-bench-lite-grounding-eval/research/task-fixtures/T158-*.json` |

**FR-001 验收信号**：`eval-task-fixture-check.mjs --task T158-*` 全部输出 `sanity: ok`

---

### FR-002 MCP Pull 对照组接入 `[必须]`

系统 MUST 在 `scripts/eval-task-runner.mjs` 中新增 `'mcp-pull'` 作为 `SUPPORTED_TOOLS` 的枚举值，对应 `buildClaudeArgs` 分支注入以下参数：
- `--mcp-config <worktree>/.mcp.json`（`spectra mcp-server` stdio JSON-RPC）
- `--allowedTools "mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob,Bash"`
- `--output-format stream-json --include-partial-messages`（供 trace 解析）

MCP server 的 `projectRoot` MUST 指向 worktree 内 target 项目（策略 2：graph 来自 target baseline），且 worktree setup 阶段 MUST 预先生成 target 的 spectra graph（`spectra batch`）。

**FR-002 验收信号**：执行 `node scripts/eval-task-runner.mjs --tool mcp-pull --task T158-X`，stream-json 输出含 `tool_use` block 且 name 以 `mcp__spectra__` 开头

---

### FR-003 三对照组并行跑 `[必须]`

`scripts/eval-mcp-augmented.mjs` MUST 支持以下三个 cohort 顺序（或并行）执行：

| cohort | 注入方式 | 复用的现有实现 |
|--------|---------|-------------|
| `control` | 裸 Claude Code（Read/Grep/Glob/Bash） | `eval-task-runner.mjs` control case |
| `spectra-push` | spec.md 注入 system prompt（12 KB cap） | `eval-task-runner.mjs` spectra-push case |
| `spectra-mcp-pull` | MCP pull（FR-002） | **新增 case** |

脚本 MUST 支持 `--task <T158-X>` / `--cohort <control|spectra-push|spectra-mcp-pull|all>` / `--repeats <N>` 参数。

**FR-003 验收信号**：`node scripts/eval-mcp-augmented.mjs --cohort all --task T158-X --repeats 1` 产出三个 fixture 文件，每个 cohort 各一份

---

### FR-004 N=3 重测 + Bootstrap 95% CI 聚合 `[必须]`

系统 MUST 对每个（task × cohort）组合执行 N=3 次独立重测，通过 `scripts/lib/bootstrap-ci.mjs`（1000 resample）计算 pass rate 中位数与 95% CI。

统计功效要求：目标可检测 lift ≥ 30pp（在 6 task × N=3 bootstrap 框架下，30pp lift 的 95% CI 不与 control 重叠为拒绝 H₀ 的判定依据）。

**FR-004 验收信号**：聚合结果含 `{ passRate, ci95Lower, ci95Upper, repeats: 3 }` 结构

---

### FR-005 Token / Cost / Wall Time / Tool Call Trace 监控 `[必须]`

每次 task 运行的 fixture MUST 记录以下字段（schema 1.2 扩展，向后兼容 schema 1.1）：

```jsonc
{
  // 现有字段（schema 1.1）
  "costUsd": number,
  "wallTimeMs": number,
  "tokensInput": number,
  "tokensOutput": number,
  
  // 新增字段（schema 1.2，仅 mcp-pull cohort 填充，其余为 null）
  "mcpToolCallTrace": [
    {
      "toolName": "mcp__spectra__impact",
      "callCount": number,
      "firstCallTurn": number,       // 第几轮首次调用
      "totalDurationMs": number
    }
  ] | null,
  
  // W-3 监控字段
  "w3Flag": boolean  // mcp-pull 模式下若 mcpToolCallTrace 全部 callCount=0，标为 true
}
```

**FR-005 验收信号**：mcp-pull 模式 fixture 中 `mcpToolCallTrace` 非 null；`callCount = 0` 时 `w3Flag = true`

---

### FR-006 报告输出到 §6 章节 `[必须]`

系统 MUST 将最终对比结果**人工撰写**到 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 的 **§6 SWE-Bench-Style Grounding Lift** 新增章节，包含：

- 3 对照组 × 6 task 的 pass rate 矩阵（含 bootstrap 95% CI），表格行至少 3 行（每 cohort 一行汇总）
- Tool call trace 统计（MCP pull 平均 spectra call 次数 / 首次调用轮次 / W-3-FLAGGED task 比例）
- Token 效率对比：`spectra-push`（spec.md 约 10k+ token）vs `spectra-mcp-pull`（3 tool 输出约 1-2k token 总和），明确量化 ratio 与方向（不强制 ≥ 5x，按实测如实记录）
- **Limitation 小节**（必须）：(a) single-turn only，未测 long horizon；(b) micrograd 量级外部效度局限，未测中大型项目；(c) N=6 task × N=3 重测的统计功效局限
- 结论段：明确"是否拒绝 H₀ / 数据方向 / 后续 follow-up 建议"

**FR-006 验收信号**：`grep -ci "SWE-Bench-Style Grounding Lift" competitive-evaluation-report.md > 0` **且** §6 内含至少 3 行表格数据 **且** 含 "Limitation" 子标题

---

### FR-007 verify-feature-158.mjs SC 验收脚本 `[必须]`

新建 `scripts/verify-feature-158.mjs`，参考 verify-feature-151/153 pattern，自动验收以下 SC（详见 Success Criteria 章节）。脚本 MUST：
- 接受 `--target <path>` / `--out <file>` / `--repeats N` 参数
- 输出 `[SC-00N] PASS/FAIL: ...` 格式
- 全部 PASS 时 process.exit(0)，任一 FAIL 时 process.exit(1)

**FR-007 验收信号**：`node scripts/verify-feature-158.mjs` 执行后 exit code 0

---

## 非功能需求 (Non-Functional Requirements)

| ID | 要求 | 度量 |
|----|------|------|
| NFR-001 | 总成本 ≤ $50 | 估算分项：(a) **6 task 共享同一份 micrograd graph**（spectra batch 一次 ~$0.55，**不重复**）；(b) 3 cohort × 6 task × N=3 = 54 run × $0.20-$0.40 ≈ $11-$22；(c) judge 评分（仅辅助，可选）≈ $3-5；(d) **调试迭代缓冲 1.5x 系数**：base $20 × 1.5 = **$30**。总估算 ≤ $35，留 ≥ $15 余量 |
| NFR-002 | 开发时间 ≤ 2 周（含 milestone） | **Week 1**（Day 1-7）：T158-* fixture 设计 + sanity check（D1-2）；`eval-task-runner.mjs` 新增 `mcp-pull` case + `eval-mcp-augmented.mjs` 入口 spike（D3-5）；`verify-feature-158.mjs` 框架（D6-7）。**Week 2**（Day 8-14）：完整跑 3 cohort × 6 task × N=3 + 调试（D8-11）；§6 报告撰写 + verify 全 PASS（D12-13）；codex review + push 准备（D14） |
| NFR-003 | 可复现性 | task fixture 定义（T158-*.json）和 MCP config 入库；90 次运行产物按 CLAUDE.local.md 不入库（落 `tests/baseline/tasks/T158-*/`）；**verify 脚本读取 fixture 路径锁定**：`tests/baseline/tasks/T158-*/<cohort>/full.json`（与 Feature 147 task fixture pattern 一致） |
| NFR-004 | 工具栈 Node-only | 不引入 Python / Docker；spike 已证 Node-only 路径可行 |
| NFR-005 | Schema 向后兼容 + 消费方清单 | schema 1.2 新增 `mcpToolCallTrace` / `w3Flag` 字段均可为 null，不破坏现有 12 个 perf anchor fixture 的 schema 1.1。**消费方兼容清单**（plan phase 必须验证每条）：(a) `scripts/baseline-diff.mjs` — 新字段不应触发 "drift" 误报，需在 plan 任务中加 schema migration 子任务；(b) `scripts/eval-task-fixture-check.mjs` — 不读这两个新字段，自动兼容；(c) `scripts/eval-report.mjs` — 需扩展 §6 章节的 mcpToolCallTrace 聚合逻辑；(d) `scripts/eval-cost-backfill.mjs` — 不读这两个新字段，自动兼容 |

---

## Key Entities

### T158-* Task Fixture

schema 与 T1-T4 对齐，新增：

```jsonc
{
  "taskId": "T158-micrograd-X",
  "target": "karpathy/micrograd",
  "startCommit": "<sha>",
  "prompt": "<自然语言任务描述，含明确的改动目标>",
  "setupCommands": ["<bash 注入 bug 或 strip 实现>"],
  "primaryOracle": {
    "kind": "functional",
    "checks": [{ "cmd": "<pytest 或 bash>", "mustPass": true, "timeoutMs": 10000 }]
  },
  "expectedSpectraToolCalls": ["impact", "context"]  // 可选，声明 mcp-pull 预期 tool
}
```

### mcpAugmentedFixture 字段（schema 1.2 扩展）

在现有 task fixture 产物（落 `tests/baseline/tasks/T158-*/`）中新增 `mcpToolCallTrace` 和 `w3Flag` 字段（详见 FR-005）。

### 报告章节锚点

`competitive-evaluation-report.md §6`（新增章节，不要新建独立报告文件）

---

## Out of Scope

| 排除项 | 理由 |
|--------|------|
| I-1 多语言 grounding 验证（Python 以外） | Feature 158+ |
| I-2 SWE-Bench 真实 instance 跑分（docker harness） | C-3 预算不够；Feature 158+ |
| I-3 Long horizon 多 turn agent 任务 | F158 只测 single-turn task pass rate |
| I-4 Opus / Haiku 模型对比 | F158 主要用 Sonnet（与 Sprint 3 对齐）；Opus 对比留 follow-up |

---

## Edge Cases & Failure Modes

### W-1 统计功效不足

**风险**：N=3 × 6 task 的样本量，若 lift 仅 10-20pp，95% CI 区间极宽（± 30pp），无法拒绝 H₀。

**缓解策略**：
- 标准统计判定：**lift ≥ 5pp 且 95% CI 下界 > 0** 视为 grounding 显著
- bootstrap 1000 resample 计算 95% CI；当 N=6 task × N=3 重测 = 18 sample 不足以收敛 CI 时（即 CI 宽度 > 30pp），报告明确声明"统计功效不足，不得声称 lift 显著"，但允许声明"point estimate 方向"（如"mcp-pull 中位数高于 control X pp，但 CI 重叠"）
- F158 不预设 lift 阈值；**lift = 0 也是合法科学结论**，不构成 verify FAIL（详见末尾 "verify 失败定义"）

### W-2 Confound：token / wall time 同时带 lift

**风险**："MCP pull 更慢但 pass rate 更高"无法区分"更多 token = 更高通过率"还是"graph 知识 = 更高通过率"。

**缓解策略**：
- 记录 `tokensInput / tokensOutput / wallTimeMs` 并在报告中展示 token 效率对比
- 对照组 token budget 不强行对齐（反映真实使用场景）
- 在报告 §6 中分析"单位 token 对应的 pass rate 增量"，量化 graph 知识相对于 token 量的边际贡献
- [推断] 若 token 效率分析结论仍不明确，建议 follow-up 做 token-budget-equalized 子实验

### W-3 "No Tools Called" Trap + Tool Mismatch

**风险**：(a) MCP server 已注册但 agent 在整个 session 中从未调用 spectra tool；(b) agent 调了 1 次但 tool 不匹配 task 所需（如调 `context` 但 task 需要 `impact`）。两者都会让 pass rate 差异被错误归因于 grounding。

**缓解策略**：
- stream-json `tool_use` block 可观测（spike 已实证）
- fixture 显式记录 `mcpToolCallTrace`，`w3Flag` 计算规则：
  - `callCount = 0` → `w3Flag = true`（trap 命中）
  - `callCount > 0` 但 toolName **不在** `expectedSpectraToolCalls` 列表中（FR-001 task fixture 字段） → `w3Flag = true`（tool mismatch）
  - 至少一次 toolName 在 `expectedSpectraToolCalls` 中 → `w3Flag = false`（trigger 成功）
- 报告汇总 W-3-FLAGGED task 的比例；若 > 50% 任务 trap，结论降级为"trigger awareness 不足，非 grounding 失效"

### W-4 Oracle Expectation 错位

**风险**：oracle 期望不明确（如"修复某个 bug"但 oracle 未精确标定哪些 test 应 FAIL→PASS），agent 提交的 patch 无法判定为 PASS 或 FAIL。

**缓解策略**：
- 选小型、明确的 task（"实现某个具体函数" / "修复已知的单一 bug"），不选大型 monorepo 模糊描述
- oracle 必须为 `kind: "functional"`，checks 必须包含可自动执行的 pytest / shell 命令
- 每个 fixture 必须通过 `eval-task-fixture-check.mjs` sanity check（setup 后立即 FAIL）

### W-5 Node-only 架构约束（已缓解）

**风险**：MCP pull 需要 spectra graph 预先生成（需跑 `spectra batch`），在 worktree setup 阶段增加成本和时间。

**缓解策略**：spike 已证 Node-only 路径（`claude --print` + `--mcp-config`）技术可行（退出码 0，MCP tool 真实调用）。worktree setup 阶段预生成 micrograd graph（约 $0.55 / 3 min，仅 task 维度不重复，cohort 维度复用同一 graph）。

### W-6 Sprint 3 Grounding Lift = 0 样本量小 + Oracle False Positive

**风险**：(a) Sprint 3 n=3 task × 4 cohort × jury judge 的结论虽 honest，但样本量过小，不排除"未选到适合 grounding 的 task"；(b) functional oracle 自身仍有 false positive 风险（patch 通过 oracle 测试但破坏其他场景）。

**缓解策略**：
- F158 用 functional oracle（不靠 LLM judge），提供更客观的 pass/fail 判定
- task fixture 刻意选含 caller graph 依赖的场景（期望体现 MCP 的差异优势）
- **每个 T158-* fixture MUST 有 ≥ 2 个 `primaryOracle.checks`**（multi-check 缓解 oracle false positive；single-check 不足以判定 patch 不破坏其他场景）
- 若 F158 也得 lift = 0，在报告 §6 中明确声明："当前 sonnet 4.6 + micrograd 量级任务下，spec.md push 和 MCP pull 两种 grounding 模式相对裸 baseline 均无显著 lift"，并提出 follow-up：更大型任务 / Opus 模型 / 多语言场景

---

## Success Criteria

> 所有 SC 由 `scripts/verify-feature-158.mjs` 自动验收。

| ID | 验收标准 | 验收信号（verify 脚本可机器验证） |
|----|----------|---------|
| SC-001 | 4-6 个 T158-* task fixture 入库 `specs/158-.../research/task-fixtures/`，通过 `eval-task-fixture-check.mjs` sanity check；每个 fixture `primaryOracle.checks.length >= 2`（W-6 multi-check） | `fs.readdirSync` 验证文件数 ≥ 4 + `eval-task-fixture-check.mjs` 输出 `sanity: ok` + 解析 JSON 验证 `checks.length >= 2` |
| SC-002 | `scripts/eval-mcp-augmented.mjs` 存在并可运行 `--task T158-X --cohort all --repeats 1 --dry-run` | `fs.existsSync` + `child_process.execSync` `--dry-run` 模式返回 0（不实际跑 LLM） |
| SC-003 | `scripts/eval-task-runner.mjs` 新增 `'mcp-pull'` 作为 `SUPPORTED_TOOLS` 枚举值，`buildClaudeArgs` 注入 `--mcp-config` + `--allowedTools` | `grep -ci "mcp-pull" scripts/eval-task-runner.mjs > 0` + `grep -ci "mcp-config" scripts/eval-task-runner.mjs > 0`（case-insensitive） |
| SC-004 | 完成至少 1 个 task 的 mcp-pull cohort 跑通，产出 fixture 含 `mcpToolCallTrace`（非 null）和 `w3Flag`（boolean） | 解析 `tests/baseline/tasks/T158-*/spectra-mcp-pull/full.json` 验证字段存在且类型正确 |
| SC-005 | `competitive-evaluation-report.md` 新增 §6 "SWE-Bench-Style Grounding Lift"，含至少 3 行数据表格（每 cohort 一行 task pass rate / CI / tool call 统计） | `grep -ci "SWE-Bench-Style Grounding Lift" ...report.md > 0` **且** `grep -c "^|.*\\bcontrol\\b\\|" ...report.md >= 1` **且** §6 内含 `\\d+(\\.\\d+)?%` 数据行 ≥ 3（验证非空章节） |
| SC-006 | 报告 §6 量化 token 效率：MCP pull cohort 累计 token 总量（`tokensInput + tokensOutput`，避免话痨 confound）相对 spec.md push 的 ratio；预期方向 push 更多（push 注入 spec.md 大块 token），mcp-pull 更精简（按需查询）。**若 control 组 token 字段为 null 则该 SC 标 SKIP（不算 FAIL）** | 解析 fixture `tokensInput + tokensOutput` 字段计算 ratio；若 control 组 token 字段为 null，verify 输出 `[SC-006] SKIP` |
| SC-007 | 总成本 ≤ $50（在 `tests/baseline/tasks/T158-*/<cohort>/full.json` 中 `costUsd` 字段 sum） | verify 脚本遍历 `tests/baseline/tasks/T158-*/` 累加 `costUsd` ≤ 50；若任一 fixture 无 `costUsd` 字段，输出 `[SC-007] WARN` 并跳过该 fixture |
| SC-008 | `node scripts/verify-feature-158.mjs` 完整跑过 SC-001 到 SC-007，每条都有明确 PASS / SKIP / WARN / FAIL 输出（非空 stdout），且至少 6/8 PASS（其余可 SKIP，但不能 FAIL） | verify 脚本 stdout 含 8 行 `[SC-00N]` 输出，且没有 FAIL；退出码：FAIL 数 == 0 → 0；否则 1 |

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估 |
|------|------|
| 组件总数（新增） | 3（`eval-mcp-augmented.mjs` / `verify-feature-158.mjs` / T158-* fixture 集合） |
| 接口数量（新增或修改） | 2（`eval-task-runner.mjs` 新增 `mcp-pull` case；fixture schema 1.1 → 1.2 扩展） |
| 依赖新引入数 | 0（复用 spectra MCP server + claude --print；无新 npm 依赖） |
| 跨模块耦合 | 低（仅修改 `eval-task-runner.mjs` 一个文件；`competitive-evaluation-report.md` 追加章节） |
| 复杂度信号 | 无递归结构；无状态机；无并发控制；无数据迁移 |
| **总体复杂度** | **LOW**（组件 < 5，接口 < 4，无复杂度信号） |

---

## YAGNI 检验结果

| FR | 必要性 | 理由 |
|----|--------|------|
| FR-001 Task Fixture | `[必须]` | 无 fixture 无法跑实验 |
| FR-002 MCP Pull 接入 | `[必须]` | 核心 hypothesis 验证的唯一路径 |
| FR-003 三对照组 | `[必须]` | 需要 control 和 push 作为对照基线 |
| FR-004 N=3 + CI | `[必须]` | 无统计聚合则结论不可信 |
| FR-005 Tool Call Trace | `[必须]` | W-3 trap 没有 trace 无法归因 grounding lift |
| FR-006 §6 报告 | `[必须]` | 最终结论载体；沿用既有报告不增加新文件 |
| FR-007 verify 脚本 | `[必须]` | 交付质量门禁，参考既有 pattern 成本低 |

**附注（W-6 multi-check 处置）**：W-6 缓解策略要求每个 fixture `primaryOracle.checks.length >= 2`，已在 FR-001 / SC-001 中明确为 `[必须]`，不是 optional MVP feature。

---

## 歧义处置

- `[AUTO-RESOLVED: task 数量范围定为 4-6 个]`：task prompt 要求"4-6 个"；plan 阶段基于预算和难度校准做最终决策。
- `[AUTO-RESOLVED: MCP server projectRoot 策略采用策略 2（graph 来自 target baseline）]`：策略 1 仅对 self-dogfood 有效；micrograd graph 生成成本可控（$0.55，6 task 共享同一份 graph，不重复生成）。
- `[AUTO-RESOLVED: §6 报告内容由人类作者撰写，非 eval-report.mjs 自动生成]`：F158 §6 是科学结论章节（含分析判断），不适合机器自动生成；plan 阶段在 implement task 中显式标记"人工撰写"。
- `[AUTO-RESOLVED: cohort 之间 prompt 仅 grounding context 注入方式不同，主体 prompt 保持一致]`：control / spectra-push / spectra-mcp-pull 三组共用同一 task prompt 主体（来自 fixture `prompt` 字段），grounding 注入方式之外不引入额外 prompt 差异（避免 confound）。

---

## Verify 失败定义（重要）

为避免"科学结论被误读为 Feature 失败"，明文界定 verify FAIL 的唯一判定条件：

**verify FAIL 唯一条件**：`scripts/verify-feature-158.mjs` 中 SC-001 到 SC-007 任一 SC **由于技术性原因无法完成**而报 `FAIL`。

**verify 不构成 FAIL 的情况**（明文兜底）：
- lift = 0 / lift < 5pp / 95% CI 重叠（这是合法的科学结论，不是 Feature 失败）
- W-3 trap 触发率 > 50%（这是 grounding 觉知问题，不是工程失败）
- spectra-push 与 control 差值 > 5pp（差值是观测事实，不预设方向）
- 个别 task fixture 的 control 组 100% PASS 或 0% PASS（plan 阶段重新校准 fixture 难度，不阻断 verify）

**verify FAIL 的合法情况**：
- T158-* fixture 文件缺失或损坏（无法解析 JSON）
- `eval-task-fixture-check.mjs` 报 sanity FAIL（setup 后 oracle 立即 PASS）
- `eval-task-runner.mjs` 没有 `mcp-pull` case（grep 不到关键字）
- `verify-feature-158.mjs` 自身 crash 或退出码非 0
- §6 章节缺失或为空（grep 不到标题或数据行）
