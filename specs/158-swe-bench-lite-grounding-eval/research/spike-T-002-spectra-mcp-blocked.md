# Spike T-002 — spectra MCP server 实测（环境级阻塞）

**日期**：2026-05-09  
**结论**：**BLOCKED — spectra MCP server 启动失败（volta 错误），但 claude --print + MCP 整体链路已在 research phase 证明可行**

## 实测命令

```bash
# 1. 准备 graph.json（cp 现有 baseline 产物到 MCP 期望路径）
mkdir -p ~/.spectra-baselines/micrograd/specs/_meta
cp ~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json \
   ~/.spectra-baselines/micrograd/specs/_meta/graph.json

# 2. 写 .mcp.json
cat > ~/.spectra-baselines/micrograd/.mcp.json <<'EOF'
{"mcpServers":{"spectra":{"command":"spectra","args":["mcp-server"]}}}
EOF

# 3. 跑 claude --print + MCP
cd ~/.spectra-baselines/micrograd
claude --print \
  --mcp-config "$PWD/.mcp.json" \
  --allowedTools "mcp__spectra__impact" \
  --output-format stream-json --include-partial-messages --verbose \
  --model sonnet \
  -p "Use mcp__spectra__impact tool with target='engine.py::Value.relu' and budget=50, depth=2, then summarize the result in one sentence."
```

## 实测结果

| 指标 | 值 |
|------|----|
| 退出码 | 0（success） |
| 耗时 | 7.88 s |
| 成本 | \$0.084 |
| `result.subtype` | success |
| `is_error` | false |
| `permission_denials` | `[]` |
| **`mcp_servers` init 状态** | **`{"name":"spectra","status":"failed"}`** ← 关键阻塞 |
| MCP tool 是否触发 | **未触发**：agent 报告"mcp__spectra__impact 不在可用工具列表中" |
| ToolSearch 检索 | `{"matches":[]}`（因为 spectra MCP failed → 0 deferred tools 注册） |

## 阻塞根因

`spectra` 命令在 `/Users/connorlu/.volta/bin/spectra`（volta shim），但执行时报错：

```
Volta error: Could not execute command.
See `volta help install` and `volta help pin` for info about making tools available.
```

可能原因：
- volta pin 指向的 spectra-cli 包未正确安装（`npm install` / `npm link` 缺失）
- 本仓库 `dist/` 目录不存在（`npm run build` 未跑），volta 找不到 binary
- spectra package version 与 volta 配置不一致

**不是 claude --print 模式的问题**：research phase spike-claude-print-mcp.md 已用 echo MCP server 证明 `claude --print --mcp-config --allowedTools` 整体链路工作（cost \$0.136 / 8.36s，stream-json 含 tool_use block）。

## 对 implement 的影响

T-002 spike 在当前环境（这个 worktree）**BLOCKED**，但 FR-002 技术可行性 **仍然成立**（research phase echo_tool spike 已证）。

implement 阶段必须先解决环境：
1. **修复 spectra CLI**：`cd <main repo> && npm install && npm run build && npm link`（让 volta 找到本仓库 dist/cli/index.js）
2. **或安装独立 spectra**：`npm install -g spectra-cli@4.1.1`（如果已发布到 npm registry）
3. **或 dev mode**：在 `.mcp.json` 中改 `"command": "tsx"`，`"args": ["src/cli/index.ts", "mcp-server"]`（不依赖 dist/）

## 推荐 implement 阶段处置

按优先级：

1. **A. dev mode（最快）**：implement T-001 时，在 `eval-task-runner.mjs` 的 `mcp-pull` case 让 `.mcp.json` 用 `tsx src/cli/index.ts mcp-server`，这样在 worktree 内不依赖 spectra 全局安装；调用 cwd = wtDir 但 tsx 路径用 main repo 绝对路径
2. **B. build & link**：`cd <main repo> && npm run build` 让 dist/cli/index.js 可用，volta shim 应该就能工作
3. **C. 等用户决定**：把这个阻塞列入 deliverable report，让用户决定是先修环境再 implement，还是接受 dev mode

## 已收口的事实

- claude --print + --mcp-config + --output-format stream-json 整体链路 OK（research spike）
- `mcp_servers` init 状态在 stream-json 中可观测（status: connected / failed）
- 当 server failed 时，agent 通过 ToolSearch 收到 `matches:[]`，明确告知用户 tool 不可用（不会静默跳过）
- 这意味着 W-3 trap 监控有额外维度：**MCP server 启动失败本身就是一种 trap**，应在 verify 中检测 `mcp_servers[].status` 字段

## 对 spec / plan / tasks 的回写需求

implement 阶段须在 tasks-codex-revisions.md 附录新增：

- **CR-8（新增）**：T-001 的 `.mcp.json` 必须用 dev mode（`tsx src/cli/index.ts mcp-server`）或验证 volta/dist 状态；否则 mcp-pull cohort 将永远 W-3 trap
- **W-09（新增）**：`mcp_servers[].status == "failed"` 也是 W-3 trap 的一种形态，verify 须检测此字段
