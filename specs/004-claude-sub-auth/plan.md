# Implementation Plan: Claude 订阅账号认证支持

**Branch**: `004-claude-sub-auth` | **Date**: 2026-02-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-claude-sub-auth/spec.md`

## Summary

让 Claude Max/Pro 订阅用户无需设置 `ANTHROPIC_API_KEY` 即可使用 reverse-spec 的所有 LLM 功能。技术方案为 spawn Claude Code CLI 子进程间接调用 API（与 OpenClaw/claude-max-api-proxy 相同），保持与现有 API Key 方式完全向后兼容。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: @anthropic-ai/sdk（现有）, Node.js child_process（内置，新增使用）
**Storage**: N/A（无新增存储需求）
**Testing**: vitest（现有）
**Target Platform**: macOS, Linux（Windows 排除）
**Project Type**: Single project（CLI 工具）
**Performance Goals**: CLI 代理方式延迟 ≤ API Key 方式的 2x
**Constraints**: 无新增运行时依赖（仅使用 Node.js 内置模块）; batch 模式并发 CLI 进程数 ≤ 3
**Scale/Scope**: 单用户 CLI 工具，LLM 调用为串行（batch 除外）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
| ---- | ---- | ---- |
| I. AST 精确性优先 | PASS | 不涉及 AST 变更，仅修改 LLM 调用路径 |
| II. 混合分析流水线 | PASS | 三阶段流水线不变，仅替换阶段 3 的 LLM 调用方式 |
| III. 诚实标注不确定性 | PASS | 不涉及标注机制变更 |
| IV. 只读安全性 | PASS | 不涉及写操作变更 |
| V. 纯 Node.js 生态 | PASS | 仅使用 Node.js 内置 `child_process`，无新增运行时依赖 |
| VI. 双语文档规范 | PASS | 不涉及文档格式变更 |

所有原则通过，无违规需要记录。

## Project Structure

### Documentation (this feature)

```text
specs/004-claude-sub-auth/
├── plan.md              # 本文件
├── spec.md              # 功能规格（已完成）
├── research.md          # Phase 0 研究（已完成）
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速开始
├── checklists/
│   └── requirements.md  # 需求检查清单
└── tasks.md             # Phase 2 任务分解（待 /speckit.tasks）
```

### Source Code (repository root)

```text
src/
├── auth/                          # 新增：认证模块
│   ├── auth-detector.ts           # 检测 API Key / CLI 可用性
│   └── cli-proxy.ts               # Claude CLI 子进程管理、I/O 解析
├── core/
│   └── llm-client.ts              # 修改：抽象 LLM 调用策略
├── cli/
│   ├── index.ts                   # 修改：注册 auth-status 命令
│   ├── utils/
│   │   ├── error-handler.ts       # 修改：checkApiKey() → checkAuth()
│   │   └── parse-args.ts          # 修改：添加 auth-status 子命令
│   └── commands/
│       ├── generate.ts            # 修改：替换认证检查
│       ├── batch.ts               # 修改：替换认证检查
│       ├── diff.ts                # 修改：替换认证检查
│       └── auth-status.ts         # 新增：auth-status 命令
tests/
├── unit/
│   ├── auth-detector.test.ts      # 新增
│   ├── cli-proxy.test.ts          # 新增
│   └── auth-status.test.ts        # 新增
└── integration/
    └── cli-proxy-e2e.test.ts      # 新增（需要 Claude CLI 安装）
```

**Structure Decision**: 新增 `src/auth/` 目录封装认证相关逻辑，与现有 `src/core/`（LLM 客户端）和 `src/cli/`（命令处理）分离。遵循现有项目的模块化结构。

## 设计方案

### 1. 认证检测（Auth Detector）

```
检测流程：
  1. 检查 ANTHROPIC_API_KEY 环境变量 → 有则返回 { type: 'api-key' }
  2. 检查 claude CLI 是否在 PATH 中 → which claude
  3. 检查 claude CLI 是否已认证 → claude auth status（或等效命令）
  4. 都没有 → 返回 { type: 'none', diagnostics: [...] }
```

### 2. LLM 调用策略抽象

现有 `callLLM()` 函数直接使用 Anthropic SDK。改为策略模式：

```
callLLM(context, config?)
  ├── 有 API Key → callLLMviaSdk(context, config)      [现有逻辑]
  └── 有 CLI    → callLLMviaCli(context, config)       [新增]
```

`callLLMviaCli` 核心逻辑：
1. 将 `context.prompt` 通过 stdin 传给 `claude --print --output-format stream-json`
2. 收集 stdout 输出，解析 JSON stream
3. 提取文本内容，构造与 SDK 相同的 `LLMResponse` 结构
4. 超时/错误处理与 SDK 方式保持一致

### 3. CLI 代理（CLI Proxy）

```
spawn('claude', ['--print', '--output-format', 'stream-json', '--model', model])
  stdin  ← context.prompt（系统提示 + 用户内容）
  stdout → JSON stream 解析 → LLMResponse
  stderr → 错误信息收集

超时: 与 LLMConfig.timeout 一致（默认 120s）
重试: 与现有 SDK 重试逻辑一致（3 次，指数退避）
环境变量: 移除 ANTHROPIC_API_KEY（确保 CLI 使用 OAuth 认证）
```

### 4. 命令层修改

所有需要 LLM 的命令（generate、batch、diff）：
- `checkApiKey()` → `checkAuth()`
- `checkAuth()` 检查 API Key 或 CLI 可用性，至少一个可用即通过
- 错误提示改为列出两种认证方式

### 5. auth-status 子命令

```
reverse-spec auth-status [--verify]

输出示例（无 --verify）:
  认证状态:
    ✓ ANTHROPIC_API_KEY: 已设置 (sk-ant-...****)
    ✓ Claude CLI: 已安装 (v2.1.0), 已登录
    优先级: API Key > CLI 代理

输出示例（有 --verify）:
  认证状态:
    ✓ ANTHROPIC_API_KEY: 已设置，已验证可用
    ✓ Claude CLI: 已安装 (v2.1.0), 已登录，已验证可用
```

## Complexity Tracking

无 Constitution 违规，无需记录。
