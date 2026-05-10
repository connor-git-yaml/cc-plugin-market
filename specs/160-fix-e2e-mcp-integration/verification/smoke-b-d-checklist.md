# 手动验证清单 — Smoke B / D（需 LLM API）

> **执行前提**：`npm run build` + `npx vitest run` 全 pass。
> 预估成本：~$1-2 LLM 调用。

---

## Smoke B: Claude Code + spectra MCP 子进程集成

**目标**：验证 `claude --print --mcp-config` + `mcp__spectra__impact` 真实 E2E 链路

### 步骤

```bash
# 1. 构建（必须）
npm run build

# 2. 创建临时 mcp-config
TMP_DIR=$(mktemp -d)
TMP_GRAPH_DIR="$TMP_DIR/specs/_meta"
mkdir -p "$TMP_GRAPH_DIR"

# 3. 复制 micrograd graph（需 baseline 已 clone）
BASELINE_GRAPH=~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json
if [ ! -f "$BASELINE_GRAPH" ]; then
  echo "❌ micrograd baseline 不存在，先跑: npm run baseline:collect -- --target karpathy/micrograd"
  exit 1
fi
cp "$BASELINE_GRAPH" "$TMP_GRAPH_DIR/graph.json"

# 4. 写 mcp-config
cat > "$TMP_DIR/.mcp.json" <<EOF
{
  "mcpServers": {
    "spectra": {
      "command": "node",
      "args": ["$(pwd)/dist/cli/index.js", "mcp-server"]
    }
  }
}
EOF

# 5. 跑单次 claude + MCP
claude \
  --print \
  --model claude-sonnet-4-6 \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --permission-mode acceptEdits \
  --mcp-config "$TMP_DIR/.mcp.json" \
  --allowedTools "mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read" \
  "请用 mcp__spectra__impact 查询 $(ls ~/.spectra-baselines/micrograd/micrograd/engine.py)::Value.relu 的 callers（depth=2，projectRoot=$TMP_DIR）" \
  > /tmp/smoke-b-output.ndjson 2>&1
```

### 验证检查点

- [ ] claude 启动后 5-10 秒内 MCP server 就绪（无 timeout / race condition）
- [ ] stream-json 输出含 `"type":"assistant"` + `"type":"tool_use"` + `name:"mcp__spectra__impact"`
- [ ] 验证解析器：

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('/tmp/smoke-b-output.ndjson','utf-8').split('\n');
let toolCalls = 0;
for (const l of lines) {
  try {
    const e = JSON.parse(l);
    if (e.type === 'assistant') {
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use' && b.name?.startsWith('mcp__spectra__')) {
          console.log('✅ MCP tool_use:', b.name);
          toolCalls++;
        }
      }
    }
  } catch {}
}
console.log('Total spectra tool calls:', toolCalls);
if (toolCalls === 0) console.log('❌ FAIL: no mcp__spectra__ tool calls found');
"
```

- [ ] `parseMcpToolCallTrace` 从真实 ndjson 正确解析

```bash
# package.json 是 "type":"module"，必须用 await import()（W-5 修复：不能用 require()）
node --input-type=module <<'ESEOF'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { parseMcpToolCallTrace } = await import(pathToFileURL(resolve('scripts/eval-task-runner.mjs')).href);
const stdout = readFileSync('/tmp/smoke-b-output.ndjson', 'utf-8');
const { trace, w3Flag } = parseMcpToolCallTrace(stdout);
console.log('trace:', JSON.stringify(trace, null, 2));
console.log('w3Flag:', w3Flag);
if (w3Flag) console.log('❌ FAIL: w3Flag=true（没调 spectra tool）');
else console.log('✅ PASS: w3Flag=false');
ESEOF
```

- [ ] 清理临时目录：`rm -rf "$TMP_DIR"`

---

## Smoke D: spec-driver workflow + MCP 结合

**目标**：验证 spec-driver-fix 子代理可访问 `mcp__spectra` tools

> **注意**：当前 spec-driver 是 spec.md push 模式，MCP 集成需要在运行时通过 Claude Code 的 `--mcp-config` 传入。
> Smoke D 验证的是：spec-driver 子代理（通过 Task tool 启动）是否能在 MCP 配置注入后调用 spectra tools。

### 当前现状

经分析，spec-driver 通过 Claude Code 的 Task tool 启动子代理时，MCP 配置来自父进程的 `--mcp-config`。若父进程启动时已配置 `spectra` MCP server，子代理自然继承该配置（MCP 在 Claude Code 进程级共享）。

**验证步骤（手动，使用 Claude Code 本身）**：

1. 确认当前 Claude Code session 已配置 spectra MCP server（检查 `~/.claude/mcp.json` 或项目 `.mcp.json`）
2. 在 Claude Code 中输入：

```
用 spec-driver-fix 修复一个简单 bug（如 scripts/ 下找一个已知小问题）。
在 diagnose 阶段，尝试用 mcp__spectra__context 查询相关 symbol。
```

3. 验证 Claude Code 的工具调用日志中出现 `mcp__spectra__context` 或同类调用

### 结论

Smoke D 依赖 Claude Code runtime 环境，无法在 vitest 中自动化。建议：
- 在 Stage 7b 启动前，手动在 Claude Code 中执行上述验证
- 或者：Feature 162 落地 spec-driver-feature + MCP 完整集成后再自动化

---

## 验证状态记录

| Smoke | 状态 | 执行时间 | 备注 |
|-------|------|----------|------|
| A (自动) | ⏳ 待 CI 运行 | — | 需 build + micrograd baseline |
| B (手动) | ⏳ 待执行 | — | 需 LLM ~$0.5 |
| C (自动) | ⏳ 待 CI 运行 | — | 无 LLM 依赖 |
| D (手动) | ⏳ 待执行 | — | 需 Claude Code + MCP 环境 |
| E (自动) | ⏳ 待 CI 运行 | — | 无 LLM 依赖 |
