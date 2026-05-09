# Spike — claude --print + MCP non-interactive 兼容性验证

**目的**：解决 Codex 审查 C-2（path-critical 单点死穴）— claude CLI 在 `--print` 非交互模式下能否真正触发 MCP tool call。

**日期**：2026-05-09  
**结论**：**通过**（C-2 解除，MCP pull 路径技术可行）

## 实验设置

最小可复现 stdio MCP server（`/tmp/spike-mcp-print/echo-mcp-server.mjs`），暴露单一 `echo_tool`，server 端 stderr 记录 tool 是否被实际调用。

```jsonc
// /tmp/spike-mcp-print/mcp-config.json
{
  "mcpServers": {
    "echo": { "command": "node", "args": ["/tmp/spike-mcp-print/echo-mcp-server.mjs"] }
  }
}
```

## 命令

```bash
claude --print \
  --mcp-config /tmp/spike-mcp-print/mcp-config.json \
  --allowedTools "mcp__echo__echo_tool" \
  --output-format stream-json --include-partial-messages --verbose \
  --model sonnet \
  -p "Please call the echo_tool with text='spike-validation-12345' and report what it returns."
```

## 实测结果

| 指标 | 值 |
|------|----|
| 退出码 | 0（success） |
| 耗时 | 8.36 s |
| 成本 | \$0.136 |
| Turns | 3（先 ToolSearch 加载 deferred tool schema，再调 echo_tool） |
| `tool_use` block in stream-json | ✅ id=`toolu_01KSSPbSpz4rYNhiRMSBEGZs` name=`mcp__echo__echo_tool` input=`{"text":"spike-validation-12345"}` |
| `tool_result` block in stream-json | ✅ `[{"type":"text","text":"ECHO_RESULT: spike-validation-12345"}]` |
| `permission_denials` | `[]`（空，无被拒） |
| MCP server stderr 验证 | `[echo-server] tool called with text="spike-validation-12345"` 实际写入 stderr，确认 tool 真正被执行 |
| Final `result.subtype` | `success` |

## 关键发现（对 specify phase 的输入）

1. **claude --print + --mcp-config + --allowedTools 在 sonnet 4.6 上稳定工作**；`permissionMode=default` 下 MCP tool 自动允许（无需 `--allow-dangerously-skip-permissions`）。
2. **stream-json 输出含完整 `tool_use` + `tool_result` block**，可作为对照组 trace 数据源（Codex W-3 缓解：直接观测"no tools called" trap）。
3. **deferred tool schema 通过 ToolSearch 自动加载**：sonnet 第一轮先调 `ToolSearch select:mcp__echo__echo_tool` 拿 schema，第二轮才调 `echo_tool` 本体。这增加 1 turn / ~30k cache tokens，但**不影响 task pass rate 实验**（所有对照组都受相同 overhead 影响）。
4. **session_id / total_cost_usd / num_turns / `permission_denials` / token usage** 都在结果末尾的 `result` event 中，可直接 parse 用于 fixture 字段。
5. **harness 可走 Node-only 路线**：spawn `claude --print` 子进程读 stdout JSON 流即可，不需要 Python orchestrator。

## 对 Codex 审查的回应

- **C-2（path-critical risk）**：解除。tool call 真实触发 + stdout 可观测。
- **W-3（baseline 不裸 confound）**：缓解。stream-json `tool_use` block 序列可记录"agent 实际调了什么 tool"，对照组之间公平对比"何时第一次调 spectra MCP"。
- **W-1（统计功效）**：仍需 specify phase 做正式功效分析；spike 不直接答这个。

## 复现命令（保留供后续 phase 验证）

```bash
# 1. 创建 spike 文件
mkdir -p /tmp/spike-mcp-print
# echo-mcp-server.mjs 与 mcp-config.json 见仓库 specs/158-.../research/spike-claude-print-mcp.md

# 2. 跑 spike
claude --print --mcp-config /tmp/spike-mcp-print/mcp-config.json \
  --allowedTools "mcp__echo__echo_tool" --output-format stream-json \
  --include-partial-messages --verbose --model sonnet \
  -p "Please call the echo_tool with text='X' and report what it returns."

# 3. 检查 tool_use block
grep -c "echo_tool\|tool_use" /tmp/spike-output.json
```
