# Quickstart: Claude 订阅账号认证支持

**Branch**: `004-claude-sub-auth` | **Date**: 2026-02-12

## 前置条件

- Node.js ≥ 20.x
- 本项目已克隆并安装依赖（`npm install`）
- 切换到功能分支：`git checkout 004-claude-sub-auth`

## 快速验证

### 1. 构建项目

```bash
npm run build
```

### 2. 检查认证状态

```bash
# 查看当前可用的认证方式
npx reverse-spec auth-status

# 在线验证（实际测试连接）
npx reverse-spec auth-status --verify
```

### 3. 使用 API Key（现有方式，不变）

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
npx reverse-spec generate src/core/
```

### 4. 使用 Claude 订阅（新方式）

```bash
# 确保 Claude Code CLI 已安装并登录
claude auth login

# 不设置 API Key，直接运行（自动通过 CLI 代理）
unset ANTHROPIC_API_KEY
npx reverse-spec generate src/core/
```

### 5. 运行测试

```bash
# 全部测试
npm test

# 仅认证相关测试
npx vitest run tests/unit/auth-detector.test.ts tests/unit/cli-proxy.test.ts
```

## 关键文件

| 文件 | 说明 |
| ---- | ---- |
| `src/auth/auth-detector.ts` | 认证检测器（API Key / CLI 可用性） |
| `src/auth/cli-proxy.ts` | Claude CLI 子进程管理 |
| `src/core/llm-client.ts` | LLM 调用策略（SDK / CLI 代理） |
| `src/cli/commands/auth-status.ts` | auth-status 子命令 |
| `src/cli/utils/error-handler.ts` | checkAuth()（替代 checkApiKey()） |

## 调试

```bash
# 查看认证检测详情
REVERSE_SPEC_DEBUG=1 npx reverse-spec generate src/core/

# 强制使用 CLI 代理（即使有 API Key）
REVERSE_SPEC_FORCE_CLI=1 npx reverse-spec generate src/core/
```
