# Contract: MCP Server 工具定义

**Feature Branch**: `009-plugin-marketplace`
**Date**: 2026-02-14

---

## 1. Server 信息

| 属性 | 值 |
|------|-----|
| **名称** | `reverse-spec` |
| **版本** | `2.0.0`（与 package.json 同步） |
| **传输方式** | stdio（stdin/stdout JSON-RPC 2.0） |
| **入口命令** | `reverse-spec mcp-server` |
| **源码位置** | `src/mcp/server.ts`、`src/mcp/index.ts` |

---

## 2. 工具定义

### 2.1 `prepare` — AST 预处理

**映射函数**：`prepareContext()` from `src/core/single-spec-orchestrator.ts`

**inputSchema**:

```json
{
  "type": "object",
  "properties": {
    "targetPath": {
      "type": "string",
      "description": "目标文件或目录路径（绝对或相对于 cwd）"
    },
    "deep": {
      "type": "boolean",
      "description": "深度分析模式（包含函数体）",
      "default": false
    }
  },
  "required": ["targetPath"]
}
```

**成功响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "<JSON 字符串：PrepareResult 对象，包含 skeletons、mergedSkeleton、context、filePaths>"
  }]
}
```

**错误响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "prepare 失败: <错误详情>"
  }],
  "isError": true
}
```

---

### 2.2 `generate` — 完整 Spec 生成

**映射函数**：`generateSpec()` from `src/core/single-spec-orchestrator.ts`

**inputSchema**:

```json
{
  "type": "object",
  "properties": {
    "targetPath": {
      "type": "string",
      "description": "目标文件或目录路径"
    },
    "deep": {
      "type": "boolean",
      "description": "深度分析模式",
      "default": false
    },
    "outputDir": {
      "type": "string",
      "description": "输出目录",
      "default": "specs"
    }
  },
  "required": ["targetPath"]
}
```

**成功响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "<JSON 字符串：{ specPath, tokenUsage, confidence, warnings }>"
  }]
}
```

**错误响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "generate 失败: <错误详情>"
  }],
  "isError": true
}
```

---

### 2.3 `batch` — 批量 Spec 生成

**映射函数**：`runBatch()` from `src/batch/batch-orchestrator.ts`

**inputSchema**:

```json
{
  "type": "object",
  "properties": {
    "projectRoot": {
      "type": "string",
      "description": "项目根目录（默认为当前工作目录）"
    },
    "force": {
      "type": "boolean",
      "description": "强制重新生成所有 spec",
      "default": false
    }
  },
  "required": []
}
```

**成功响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "<JSON 字符串：BatchResult 对象>"
  }]
}
```

---

### 2.4 `diff` — Spec 漂移检测

**映射函数**：`detectDrift()` from `src/diff/drift-orchestrator.ts`

**inputSchema**:

```json
{
  "type": "object",
  "properties": {
    "specPath": {
      "type": "string",
      "description": "Spec 文件路径（.spec.md）"
    },
    "sourcePath": {
      "type": "string",
      "description": "源代码文件或目录路径"
    }
  },
  "required": ["specPath", "sourcePath"]
}
```

**成功响应**：
```json
{
  "content": [{
    "type": "text",
    "text": "<JSON 字符串：DriftReport 摘要>"
  }]
}
```

---

## 3. 协议消息示例

### 3.1 初始化握手

**请求**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "claude-code", "version": "1.0.0" }
  }
}
```

**响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "reverse-spec", "version": "2.0.0" }
  }
}
```

### 3.2 工具列表

**请求**：
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

**响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      { "name": "prepare", "description": "AST 预处理 + 上下文组装", "inputSchema": { ... } },
      { "name": "generate", "description": "完整 Spec 生成流水线", "inputSchema": { ... } },
      { "name": "batch", "description": "批量 Spec 生成", "inputSchema": { ... } },
      { "name": "diff", "description": "Spec 漂移检测", "inputSchema": { ... } }
    ]
  }
}
```

### 3.3 工具调用

**请求**：
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "prepare",
    "arguments": { "targetPath": "src/auth/", "deep": true }
  }
}
```

**成功响应**：
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{ \"skeletons\": [...], ... }" }]
  }
}
```

---

## 4. 错误处理策略

| 错误类型 | 处理方式 | 示例 |
|---------|---------|------|
| 目标路径不存在 | `isError: true` + 友好提示 | `"目标路径不存在: src/nonexistent/"` |
| AST 解析失败 | `isError: true` + 降级建议 | `"AST 解析失败，建议使用 --deep 模式"` |
| LLM API 调用失败 | `isError: true` + 具体错误 | `"Claude API 返回 429: 速率限制"` |
| 认证缺失 | `isError: true` + 配置提示 | `"未检测到 ANTHROPIC_API_KEY"` |
| 内部异常 | `isError: true` + 栈信息 | `"内部错误: <错误消息>"` |

---

## 5. 实现约束

1. **stdout 纯净性**：MCP server 运行期间，stdout 仅输出 JSON-RPC 消息。所有日志写入 stderr。
2. **进程模型**：每次 Claude Code 启动会话时作为子进程启动，会话结束时终止。
3. **无状态性**：每次工具调用独立执行，不在工具调用间维持状态（文件系统是唯一持久化层）。
4. **认证透传**：MCP server 继承父进程的环境变量（`ANTHROPIC_API_KEY` 等）。
