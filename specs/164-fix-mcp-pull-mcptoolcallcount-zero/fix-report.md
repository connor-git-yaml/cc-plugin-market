# 问题修复报告 — Feature 164

## 问题描述

Feature 162 Pilot 27 完整重跑（commit c742f44）揭示：C cohort（mcp-pull）9/9 runs 的
`mcpToolCallCount = 0`。driver 在所有 C cohort runs 中**从未调用任何 `mcp__spectra__*` 工具**，
导致 MCP pull grounding 路径未被实际触发，C 22.2% pass rate 不能解读为 MCP pull 的效果。

参考：`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.4 line 616-625

---

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | mcpToolCallCount = 0（9/9 runs）是如何产生的？ | Claude 从未调用 `mcp__spectra__*` 工具，telemetry JSONL 文件为空（`parseTelemetryJsonl` 返回空数组） |
| Why 2 | Claude 为何不调用 MCP tools？ | `buildGroupCPrompt`（L533-550）的指令不足：说"必须先调用 `mcp__spectra__context`"，但未提供 `symbolId` 参数，Claude 无法构造有效调用 |
| Why 3 | 为何没有 symbolId 导致 Claude 跳过？ | `mcp__spectra__context` 需要 `symbolId`（如 `pytest/conftest.py::test_foo`）；prompt 未告知 Claude 如何从 Python 代码中推断 symbolId；Claude 判断无法构造合法调用，直接跳过 |
| Why 4 | 为何 prompt 没有给出 symbolId 指导，且未覆盖 graph-not-built 失败路径？ | C cohort 设计假设 Claude 会"自行推断" symbolId，但 Python SWE-Bench 目标仓库（pytest/astropy/sympy）从未运行过 `spectra batch`，不存在 `specs/_meta/graph.json`；所有工具调用都会返回 `graph-not-built`，而 prompt 未提及这个预期失败路径 |
| Why 5 | 为何设计阶段没有发现此问题？ | Pilot 验收只检查"runs complete"而非"runs call MCP tools"；May 13 初次运行 C cohort 全 EC-13 失败（dist 缺失），修复 dist 后的 May 14 rerun 确实完成了 9/9 runs，但未检查 mcpToolCallCount |

**Root Cause**: `buildGroupCPrompt` prompt 设计不足 —— 指令只说"必须先调用 `mcp__spectra__context`"
但未给出 symbolId（工具必填参数）、未说明如何处理 `graph-not-built` 失败，导致 Claude 跳过工具。

**Root Cause Chain**:
`mcpToolCallCount=0` → `Claude 未调用工具` → `prompt 缺少 symbolId + 未处理错误路径` →
`C cohort 设计未包含 spectra graph pre-build 步骤` → `pilot 验收标准只检查 run 完成，不检查工具调用计数`

---

## 辅助诊断：4 个候选根因状态

| 根因候选 | 状态 | 证据 |
|---------|------|------|
| #1 codex CLI MCP server lifecycle | ✅ 已排除 | `dist/cli/index.js` 正常启动（`[spectra MCP] 启动 stdio server...`）；`--strict-mcp-config` 未导致 run 失败 |
| #2 driver prompt 引导不足 | 🚨 **ROOT CAUSE** | `buildGroupCPrompt` 未提供 symbolId，未处理 `graph-not-built` 路径；Claude 无法构造有效调用 |
| #3 sub-agent frontmatter 传递 | ✅ 无关 | C cohort 使用直接 `claude --print` 而非 spec-driver 子代理，frontmatter 机制不适用 |
| #4 mcp registration 链路 | ✅ 已排除 | MCP 工具已注册（server 起后 2s 无 crash）；工具名与 prompt 一致（`mcp__spectra__*`）；问题在 prompt 层，不在注册链路 |

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `scripts/eval-mcp-augmented.mjs` | L533-550 | `buildGroupCPrompt` | 重写 prompt：明确步骤序列 + 具体参数 + 错误处理 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/eval-mcp-augmented-classic.mjs` | L* | 可能有类似 prompt | 需检查是否有同类 cohort C prompt，但不在本次修复范围 |

### 同步更新清单

- **代码**: `scripts/eval-mcp-augmented.mjs` `buildGroupCPrompt` 函数（唯一必改处）
- **文档**: `specs/147-.../competitive-evaluation-report.md` §10.4 更新 C cohort 数据（验证后执行）
- **测试**: `scripts/eval-mcp-augmented.mjs` 相关单元测试（检查 prompt 包含 detect_changes 指令）

---

## 修复策略

### 方案 A（推荐）：Prompt 改写 — 以 detect_changes 为首个强制工具调用

**核心思路**：

1. 改变首个工具：从 `mcp__spectra__context`（需要 symbolId，无法无符号调用）→
   `mcp__spectra__detect_changes`（只需 `baseRef`，无需 symbolId）
2. 明确步骤序列：
   - 步骤 1：调用 `detect_changes`，`baseRef="HEAD~1"`（即使 graph-not-built 也记录）
   - 步骤 2：若步骤 1 返回 changedSymbols，对第一个 symbol 调 `context`
   - 步骤 3：完成 bug 修复
3. 明确 `graph-not-built` 是预期错误，告知 Claude 记录后继续

**效果**：
- Claude 调用 `detect_changes` → 返回 `graph-not-built` → telemetry 写入 → `mcpToolCallCount ≥ 1`
- 满足 pilot 验证目标：`mcpToolCallCount > 0 ≥ 5/9`（工具调用路径已验证）
- 注：工具返回 `graph-not-built` 仍是错误，不构成 MCP pull grounding 真实效果；
  若需真实 grounding 效果，需增加 pre-build spectra graph 步骤（后续 T053 范围）

**验证**：
- `detect_changes` 调用会触发 `recordAndReturn`（即使 `graph-not-built`），telemetry 写入
- 确认：`src/mcp/agent-context-tools.ts:551-556` — `graph-not-built` 路径调用了 `recordAndReturn`

### 方案 B（备选）：Pre-build spectra graph + 改 prompt

在每个 C cohort run 的 `prepareWorktree` 后，执行 `spectra batch` 生成 `specs/_meta/graph.json`，
再用改进的 prompt。工具调用会返回真实的 symbol 信息，而非 `graph-not-built`。

**缺点**：
- `spectra batch` 对 pytest（~1k Python 文件）约 5-10 分钟，astropy（~5k 文件）约 30 分钟
- 大幅增加 pilot 成本和 wall clock；不适合当前 pilot 规模
- **不在本次 Fix 范围，留 T053**

---

## Spec 影响

- 需要更新的 spec：`specs/147-.../competitive-evaluation-report.md` §10.4（验证 C cohort 重跑后）
- 方案 A 不需要更新 `specs/162-codex-driver-glm-judge-eval/spec.md`
  （spec FR-C-003 只说"mandatory tool use instruction"，不规定具体 prompt 文本）
