# Quickstart: 重构为 Claude Code Plugin Marketplace 架构

**Feature Branch**: `009-plugin-marketplace`
**Date**: 2026-02-14

---

## 场景 1: Marketplace 结构创建（US1）

### 预期行为

在仓库根目录创建 marketplace 清单和 plugin 目录结构后，Claude Code 可以识别本仓库为 marketplace。

### 验证步骤

```bash
# 1. 检查 marketplace.json 存在且格式正确
cat .claude-plugin/marketplace.json | python3 -m json.tool

# 2. 验证 plugins 数组包含 reverse-spec
cat .claude-plugin/marketplace.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['name'] == 'cc-plugin-market'
assert len(data['plugins']) >= 1
assert data['plugins'][0]['name'] == 'reverse-spec'
assert data['plugins'][0]['source'] == './plugins/reverse-spec'
print('✓ marketplace.json 验证通过')
"

# 3. 验证 plugin 目录结构存在
ls plugins/reverse-spec/plugin.json
ls plugins/reverse-spec/skills/reverse-spec/SKILL.md
ls plugins/reverse-spec/skills/reverse-spec-batch/SKILL.md
ls plugins/reverse-spec/skills/reverse-spec-diff/SKILL.md
ls plugins/reverse-spec/.mcp.json
```

### 期望输出

```
✓ marketplace.json 验证通过
plugins/reverse-spec/plugin.json
plugins/reverse-spec/skills/reverse-spec/SKILL.md
plugins/reverse-spec/skills/reverse-spec-batch/SKILL.md
plugins/reverse-spec/skills/reverse-spec-diff/SKILL.md
plugins/reverse-spec/.mcp.json
```

---

## 场景 2: Plugin 封装验证（US2）

### 预期行为

`plugins/reverse-spec/plugin.json` 包含完整的 plugin 声明，skills 目录包含 3 个 SKILL.md。

### 验证步骤

```bash
# 1. 验证 plugin.json 结构
cat plugins/reverse-spec/plugin.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert data['name'] == 'reverse-spec'
assert 'version' in data
assert 'description' in data
assert 'author' in data
assert 'mcpServers' in data
print('✓ plugin.json 字段完整')
"

# 2. 验证 skill 文件内容（检查 frontmatter）
head -5 plugins/reverse-spec/skills/reverse-spec/SKILL.md
# 应包含 ---\nname: reverse-spec\n...

# 3. 验证 .mcp.json
cat plugins/reverse-spec/.mcp.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'mcpServers' in data
assert 'reverse-spec' in data['mcpServers']
server = data['mcpServers']['reverse-spec']
assert server['command'] == 'npx'
assert 'reverse-spec' in server['args']
assert 'mcp-server' in server['args']
print('✓ .mcp.json 验证通过')
"

# 4. 验证 hooks.json
cat plugins/reverse-spec/hooks/hooks.json | python3 -m json.tool
```

---

## 场景 3: MCP Server 功能验证（US3）

### 预期行为

`reverse-spec mcp-server` 子命令启动 MCP stdio server，正确响应协议消息。

### 验证步骤

```bash
# 1. 确认 mcp-server 子命令存在
npm run build
node dist/cli/index.js mcp-server --help 2>/dev/null || echo "子命令已注册"

# 2. 通过 stdin 发送 initialize 并检查 stdout 响应
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | \
  timeout 5 node dist/cli/index.js mcp-server 2>/dev/null | \
  python3 -c "
import json, sys
for line in sys.stdin:
    data = json.loads(line)
    if 'result' in data:
        assert data['result']['serverInfo']['name'] == 'reverse-spec'
        print('✓ MCP initialize 握手成功')
        break
"

# 3. 发送 tools/list 请求
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | \
  timeout 5 node dist/cli/index.js mcp-server 2>/dev/null | \
  python3 -c "
import json, sys
tools = []
for line in sys.stdin:
    data = json.loads(line)
    if 'result' in data and 'tools' in data.get('result', {}):
        tools = [t['name'] for t in data['result']['tools']]
        break
expected = ['prepare', 'generate', 'batch', 'diff']
for name in expected:
    assert name in tools, f'缺少工具: {name}'
print(f'✓ MCP server 暴露了 {len(tools)} 个工具: {tools}')
"
```

### 期望输出

```
✓ MCP initialize 握手成功
✓ MCP server 暴露了 4 个工具: ['prepare', 'generate', 'batch', 'diff']
```

---

## 场景 4: 现有功能回归验证

### 预期行为

重构后，所有现有 CLI 命令和测试保持正常工作。

### 验证步骤

```bash
# 1. 现有测试全部通过
npm test

# 2. TypeScript 编译通过
npm run build

# 3. CLI 命令正常工作
node dist/cli/index.js --version
node dist/cli/index.js --help
node dist/cli/index.js prepare src/utils/ 2>/dev/null || echo "prepare 命令可用"

# 4. npm 全局安装流程不受影响（模拟 postinstall）
node dist/scripts/postinstall.js --help 2>/dev/null || echo "postinstall 脚本存在"
```

---

## 场景 5: Marketplace 安装流程（US4 — 文档验证）

### 预期行为

README 或安装文档中清晰描述了从 marketplace 安装 plugin 的步骤。

### 验证要点

1. 文档中包含添加 marketplace 源的命令示例
2. 文档中包含安装 plugin 的命令示例
3. 文档中包含安装后验证 skill 可用性的说明
4. 文档中包含 MCP server 自动启动的说明

---

## 新增依赖

| 包名 | 版本 | 用途 | 类型 |
|------|------|------|------|
| `@modelcontextprotocol/sdk` | ^1.26.0 | MCP server 实现 | 运行时依赖 |

注意：`zod` 是现有依赖，MCP SDK 的 peer dependency，无需额外添加。
