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
