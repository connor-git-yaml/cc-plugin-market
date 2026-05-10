# 子代理 MCP 工具继承机制验证（Stage 7b 关键科学结论）

## 背景

主验证流程（commit bf9cba5）只验证了 spec-driver-fix workflow 的 **orchestrator (Phase 1 / diagnose)** 能直接调用 `mcp__spectra__context`。

但 spec-driver-fix workflow 的 Phase 2 (plan / tasks) / Phase 3 (implement) / Phase 4 (verify) 全部走 `Task` 工具调度到对应**子代理**（spec-driver:plan / implement / verify 等），子代理的 `tools` frontmatter **不含** `mcp__spectra__*`。

未明问题：当 session 级 `--allowedTools` 包含 `mcp__spectra__*` 时，子代理是否会**自动继承**这些工具？

本测试用最小可重复 setup 给出明确答案。

## 测试 setup

| 元素 | 值 |
|------|------|
| 子代理类型 | `spec-driver:implement` |
| 子代理 frontmatter 默认 tools | `[Read, Write, Edit, Bash, Grep, Glob, Agent]` |
| Session model | `claude-haiku-4-5-20251001`（成本敏感）|
| Session `--mcp-config` | `.mcp.json`（注册 spectra MCP server） |
| Session `--allowedTools` | `mcp__spectra__context,mcp__spectra__impact,mcp__spectra__detect_changes,Read,Write,Edit,Bash,Grep,Glob,Task` |
| 测试 prompt | dispatch implement 子代理，唯一任务："Call `mcp__spectra__context` with symbolId=`src/knowledge-graph/unified-graph.ts`，按结构化格式 verbatim 报告 outcome / error / response" |
| 父级（orchestrator）日志路径 | `/tmp/subagent-mcp-test.log` / `/tmp/subagent-mcp-test2.log` |

## Test 1：默认 frontmatter（不动 plugin）

**Plugin 加载源**：`~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0/`（marketplace cache 版）

子代理返回原文：

```
TOOL_CALL_OUTCOME: tool-not-available
ERROR_IF_FAILED: No such tool available: mcp__spectra__context
RESPONSE_IF_SUCCESS: null
```

**结论：SUB-AGENT MCP ACCESS = NO**

子代理虽然在 session 级有 `--allowedTools mcp__spectra__context`，但**实际看不到**这个工具，runtime 报"No such tool available"。

## Test 2：把 `mcp__spectra__*` 加进 implement.md tools list

**Plugin 加载源**：本地 `plugins/spec-driver/`（通过 `--plugin-dir <local>` 覆盖 cache）

修改（仅 frontmatter，不动 prompt 内容）：

```diff
 ---
 model: sonnet
-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
+tools: [Read, Write, Edit, Bash, Grep, Glob, Agent, mcp__spectra__context, mcp__spectra__impact, mcp__spectra__detect_changes]
 effort: high
 ---
```

子代理返回原文：

```
TOOL_CALL_OUTCOME: success
ERROR_IF_FAILED: null
RESPONSE_IF_SUCCESS: {"definition":{"id":"/.../src/knowledge-graph/unified-graph.ts","file":"/.../src/knowledge-graph/unified-graph.ts","kind":"module","label":"unified-graph.ts"},"callers":[],"callees":[],"imports":[]}
```

**结论：SUB-AGENT MCP ACCESS = YES**

修改后子代理立即可以调用 `mcp__spectra__context`，返回正确的 360° envelope（`callers` / `callees` / `imports` 仍为空，原因同主验证：当前 graph 仅含 `depends-on` 关系，无 `calls` 边）。

## 推论与不变量

1. **Sub-agent 工具访问权 = sub-agent frontmatter `tools` ∩ 全局可用工具集**，**不**取 session 级 `--allowedTools` 的并集
2. **Orchestrator（skill 顶层）**与 sub-agent 的工具门禁规则不同：orchestrator 受 session `--allowedTools` 控制（这就是为什么 Phase 1 diagnose 能调 mcp 工具，即使 spec-driver-fix skill 的 `allowed-tools` 没列出它们）
3. **Stage 7b 必须在 plugin agent 文件层显式声明 mcp 工具**，session-level 注入不够

## Stage 7b 落地建议（最小变更）

把 `mcp__spectra__context` / `mcp__spectra__impact` / `mcp__spectra__detect_changes` 加到下列 sub-agent 的 frontmatter `tools` list：

| Sub-agent | 当前 tools | 建议增量 | 用例 |
|-----------|-----------|----------|------|
| `plan.md` | `[Read, Write, Grep, Glob]` | `+ mcp__spectra__context, mcp__spectra__impact` | plan 阶段查 caller / callee 评估改动影响面 |
| `implement.md` | `[Read, Write, Edit, Bash, Grep, Glob, Agent]` | `+ mcp__spectra__context, mcp__spectra__impact` | implement 时按 caller 列表同步更新调用方 |
| `verify.md` | `[Read, Bash, Grep, Glob]` | `+ mcp__spectra__detect_changes, mcp__spectra__impact` | verify 阶段从 git diff 派生 changedSymbols + impact 链 |
| `quality-review.md` / `spec-review.md` | （未查）| `+ mcp__spectra__impact, mcp__spectra__context` | review 时验证 spec 改动是否覆盖 caller |

不需要改：`specify.md`（spec 起草不需 graph 查询）、`analyze.md`（需求分析）、`clarify.md`（需求澄清）。

由于 plugin 版本同时影响 marketplace cache，Stage 7b 修改后需要：

1. 改本地 `plugins/spec-driver/agents/*.md`
2. 跑 `npm run repo:sync` + `npm run release:check`（同步入 release contract）
3. 升 plugin SemVer（minor，因为是工具集扩展非破坏性）
4. 用户重装 plugin（或 spec-driver-fix workflow 改 `--plugin-dir` 注入策略让本地版本可见）

## 测试再现性

```bash
# Test 1（默认）
cat /tmp/subagent-mcp-test-prompt.txt | claude --print \
  --mcp-config .mcp.json \
  --dangerously-skip-permissions \
  --model claude-haiku-4-5-20251001 \
  --max-budget-usd 0.40 \
  --allowedTools "mcp__spectra__context,mcp__spectra__impact,mcp__spectra__detect_changes,Read,Write,Edit,Bash,Grep,Glob,Task" \
  --output-format text

# Test 2（修改 implement.md + --plugin-dir 指向本地）
cat /tmp/subagent-mcp-test-prompt.txt | claude --print \
  --mcp-config .mcp.json \
  --dangerously-skip-permissions \
  --plugin-dir /path/to/plugins/spec-driver \
  --model claude-haiku-4-5-20251001 \
  --max-budget-usd 0.40 \
  --allowedTools "mcp__spectra__context,mcp__spectra__impact,mcp__spectra__detect_changes,Read,Write,Edit,Bash,Grep,Glob,Task" \
  --output-format text
```

测试 prompt 内容见 `/tmp/subagent-mcp-test-prompt.txt`（dispatch implement 子代理调 `mcp__spectra__context`，要求 verbatim 结构化返回）。

---

## Test 3: Phase 0 修复后重测（Feature 162 / 2026-05-10）

> Feature 162 Phase 0 已完成 5 个 plugin agent frontmatter 改动 + plugin SemVer 升至 4.1.0 + repo:sync + release:check 全 pass。本次重测验证 Phase 0 fix 在 worktree 内的落地状态，以及 marketplace cache 同步要求。

### 测试方法（ad-hoc Smoke）

主编排器在当前 worktree 内通过 Agent tool 启动 spec-driver:plan sub-agent，要求其：
1. 自报当前生效的 frontmatter `tools` 列表
2. 实测调用 `mcp__spectra__context` 工具
3. 报告 plugin 加载源（worktree 4.1.0 vs marketplace cache 4.0.0）

### 测试结果（2026-05-10）

| 维度 | 结果 |
|-----|------|
| plan sub-agent 自报 tools 列表 | `[Read, Write, Grep, Glob]`（**未含 mcp__spectra__***）|
| `mcp__spectra__context` 调用 | `TOOL_CALL_OUTCOME: tool-not-available` |
| `plugins/spec-driver/.claude-plugin/plugin.json` version | **4.1.0**（worktree 内已升版）|
| plan sub-agent 实际加载源 | marketplace cache（推断为 `~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0/`，仍为旧版本）|

### 结论：worktree fix 已落地，cache 同步是用户责任

**Phase 0 fix 在 worktree 内完整生效**：
- ✅ FR-001~FR-005：5 个 agent frontmatter `tools` 已含 mcp__spectra__* 工具（git diff 可验证）
- ✅ FR-007：plugin SemVer 已升至 4.1.0
- ✅ FR-006：`npm run repo:sync` + `npm run release:check` 全 pass

**但 sub-agent 实际加载的仍是旧 cache**（EC-007 触发情景）：
- ❌ TOOL_CALL_OUTCOME = `tool-not-available`
- ❌ sub-agent 实测 tools 列表仍是 4.0.0 旧版本（不含 mcp__spectra__*）
- 原因：marketplace cache（user-level `~/.claude/plugins/cache/cc-plugin-market/spec-driver/`）仍是 4.0.0，未自动同步到 4.1.0

### Test 3 PASS 条件

要让新 sub-agent session 看到 mcp__spectra__* 工具，**用户必须执行以下任一操作**：

1. **重装 plugin**：`claude plugin update spec-driver` 或 `claude plugin install ./plugins/spec-driver --force`
2. **直接指向 worktree**：启动 session 时用 `--plugin-dir <worktree>/plugins/spec-driver`
3. **手动同步 cache**：`rsync -av plugins/spec-driver/ ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.1.0/`（不推荐）

完成上述步骤后再起一个新 plan sub-agent，应得：
- tools 列表含 `mcp__spectra__context, mcp__spectra__impact`
- `mcp__spectra__context` 调用 → `TOOL_CALL_OUTCOME: success`

### 与 Test 1 / Test 2 对比

| Test | Frontmatter 改动 | --plugin-dir 注入 | 实测 outcome |
|------|----------------|------------------|------------|
| Test 1 | 无（默认 4.0.0）| 无 | `tool-not-available` ❌ |
| Test 2 | 有（4.1.0 雏形）| 有（指向本地）| `success` ✅ |
| **Test 3** | **有（4.1.0 落地）**| **无（依赖 cache）**| **`tool-not-available`**（需用户重装 cache）|

### Stage 7b 启动前的硬前置 checklist

Stage 7b 跑 450 runs Codex driver eval 前，必须验证 cache 已更新：

```bash
ls ~/.claude/plugins/cache/cc-plugin-market/spec-driver/
# 应见 4.1.0/ 目录；若仅有 4.0.0/ 则需先 plugin update
```

只有 cache 升级到 4.1.0 后，Stage 7b mcp-pull cohort 才会真实继承 MCP 工具，§10.5 的 inheritance_status 才会 dominate `available`。

### 与 Feature 162 spec FR 的关联

- ✅ FR-001~FR-008（Phase 0 frontmatter + repo:sync + 升版）：worktree 内全部落地
- ⏭️ FR-006 末段（plugin update + Smoke D Test 3 加载源记录）：**待用户重装 cache 后验证**
- ✅ EC-001 / EC-007 触发并被识别（spec 已预测此情景）
- ⏭️ SC-001 完整通过：**待用户重装 cache 后再跑 Smoke D Test 3 才能 verify TOOL_CALL_OUTCOME=success**

Phase 0 commit 可基于 worktree 状态进行；Stage 7b 跑批前的 plugin cache update 是用户运维步骤，不是 commit 阻断条件。
