# Research: Claude 订阅账号认证支持

**日期**: 2026-02-12
**分支**: `004-claude-sub-auth`

## 关键发现：OAuth Token 使用限制

### 发现

Anthropic **明确限制 OAuth token（`sk-ant-oat01-`）仅授权给 Claude Code 使用**。第三方工具直接使用 OAuth token 调用 Anthropic API 会收到错误：

> "This credential is only authorized for use with Claude Code and cannot be used for other API requests"

**来源**: [GitHub Issue #6536](https://github.com/anthropics/claude-code/issues/6536)

2026-01-09，Anthropic 进一步封杀了直接 OAuth 伪装方式（注入 system prompt + header），OpenCode 等工具的 OAuth 认证立即失效。

### 影响

原方案（读取 Keychain/credentials.json 中的 OAuth token → 传给 SDK → 调用 API）**不可行**。

### 替代方案评估

| 方案 | 可行性 | 说明 |
|------|--------|------|
| A. 直接用 OAuth token 调 SDK | **不可行** | Anthropic 限制 OAuth token 仅限 Claude Code，2026-01-09 加强封锁 |
| B. spawn Claude CLI 子进程 | **可行（已选）** | 社区项目（claude-max-api-proxy、CLIProxyAPI）采用的方式，目前稳定运行 |
| C. 扩展 Claude Code 原生模式 | 可行 | 已有 `prepare` 子命令模式，但受限于 Claude Code 环境 |
| D. setup-token 生成 API Key | 部分可行 | 需要额外交互流程，用户体验不佳 |

## 最终决策：方案 B — spawn Claude CLI 子进程

### 理由

1. **用户体验最佳**：已登录 Claude Code 的订阅用户零配置即可使用所有功能
2. **社区验证**：claude-max-api-proxy、CLIProxyAPI 等项目长期稳定运行
3. **技术可行性高**：从 Anthropic 角度看，请求来自正版 Claude Code CLI
4. **完整功能**：不像方案 C 受限于 Claude Code 环境，CLI 独立使用也能享受订阅

### 风险

- TOS 灰色地带，Anthropic 可能加强限制
- 依赖 Claude Code CLI 安装和版本兼容性
- 每次请求 spawn 进程有性能开销

## SDK 技术细节

### @anthropic-ai/sdk 认证支持

SDK (v0.39.0) 原生支持两种认证参数：

```typescript
new Anthropic({
  apiKey: 'sk-ant-api03-...',     // → x-api-key header
  authToken: 'sk-ant-oat01-...',  // → Authorization: Bearer header
});
```

- `apiKey` → 通过 `x-api-key` HTTP header 发送（当前使用）
- `authToken` → 通过 `Authorization: Bearer` HTTP header 发送（被限制）
- OAuth 还需要 `anthropic-beta: oauth-2025-04-20` header

### 环境变量

| 环境变量 | 用途 | SDK 参数 |
|----------|------|----------|
| `ANTHROPIC_API_KEY` | API key 认证 | `apiKey` |
| `ANTHROPIC_AUTH_TOKEN` | OAuth token 认证 | `authToken` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth | `authToken` |

## 社区方案分析

### claude-max-api-proxy（关键参考）

- **不通过 SDK 传递 OAuth token**
- 用 Node.js `spawn()` 启动 Claude CLI 子进程
- 删除 `ANTHROPIC_API_KEY` 环境变量，让 CLI 回退到 Keychain 中的 OAuth 凭证
- 本质是 CLI wrapper，不是 SDK 调用
- 架构：Express HTTP 服务器 → Adapter 层转换格式 → spawn CLI → 解析输出

### CLIProxyAPI

- Go 语言编写，支持多提供商
- 支持多账号负载均衡
- 类似 spawn CLI 架构

### OpenClaw

- 本身**不直接绕过限制**
- 通过集成 claude-max-api-proxy 来支持 Max 订阅
- 官方文档有专门的 claude-max-api-proxy 集成页面

## Claude CLI 非交互模式参数

```bash
# 基本用法：发送 prompt 并获取输出
claude --print "你的 prompt"

# 指定输出格式
claude --print --output-format stream-json "你的 prompt"

# 指定模型
claude --print --model claude-sonnet-4-5-20250929 "你的 prompt"

# 从 stdin 读取 prompt
echo "你的 prompt" | claude --print --output-format stream-json
```

### 输出格式（stream-json）

每行一个 JSON 对象，包含 `type` 和 `content` 字段。最终响应包含 `result` 类型。

## 现有代码架构影响

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/core/llm-client.ts` | 抽象 LLM 调用为策略模式，新增 CLI proxy 实现 |
| `src/cli/utils/error-handler.ts` | `checkApiKey()` 改为 `checkAuth()` |
| `src/cli/commands/generate.ts` | 替换 `checkApiKey()` |
| `src/cli/commands/batch.ts` | 替换 `checkApiKey()` |
| `src/cli/commands/diff.ts` | 替换 `checkApiKey()` |
| `src/cli/utils/parse-args.ts` | 添加 `auth-status` 子命令 |
| `src/cli/index.ts` | 注册 `auth-status` 命令 |

### 新增文件

| 文件 | 内容 |
|------|------|
| `src/auth/auth-detector.ts` | 检测 API Key 和 CLI 可用性 |
| `src/auth/cli-proxy.ts` | Claude CLI 子进程管理、输入/输出格式转换 |
| `src/cli/commands/auth-status.ts` | auth-status 子命令处理 |
