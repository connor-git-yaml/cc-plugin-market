# Tasks: Claude 订阅账号认证支持

**Input**: Design documents from `/specs/004-claude-sub-auth/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: 包含单元测试（plan.md 明确列出了测试文件）。

**Organization**: 按用户故事分组，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件，无依赖关系）
- **[Story]**: 任务所属的用户故事（US1, US2）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 无新增外部依赖，仅需创建目录结构

- [x] T001 创建 `src/auth/` 目录结构，确认现有依赖满足需求（Node.js 内置 `child_process`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 认证检测和 CLI 代理核心模块，所有用户故事的前置条件

**⚠️ CRITICAL**: US1 和 US2 均依赖此阶段完成

- [x] T002 [P] 实现 AuthDetector 及类型定义 in `src/auth/auth-detector.ts`
  - 定义 `AuthMethod` 接口（type: `'api-key' | 'cli-proxy'`, available, details）
  - 定义 `AuthDetectionResult` 接口（methods, preferred, diagnostics）
  - 实现 `detectAuth()` 函数：
    1. 检查 `ANTHROPIC_API_KEY` 环境变量 → `{ type: 'api-key', available: true/false }`
    2. 检查 `claude` CLI 是否在 PATH 中（`which claude`）
    3. 检查 CLI 登录状态（`claude auth status` 或等效命令）
    4. 按优先级排序：API Key > CLI Proxy
  - 实现 `verifyAuth()` 函数（--verify 模式，实际测试连接）
  - 导出所有类型和函数

- [x] T003 [P] 实现 CLI Proxy in `src/auth/cli-proxy.ts`
  - 定义 `CLIProxyConfig` 接口（model, timeout, maxConcurrency, cliPath）
  - 实现 `callLLMviaCli(prompt: string, config: CLIProxyConfig)`:
    1. spawn `claude --print --output-format stream-json --model <model>` 子进程
    2. 通过 stdin 写入 prompt
    3. 解析 stdout 的 JSON stream 输出
    4. 构造 `LLMResponse`（content, model, inputTokens, outputTokens, duration）
  - 超时处理：kill 进程 → 抛出 `LLMTimeoutError`
  - 错误处理：非零退出码 → 解析 stderr → 抛出 `LLMResponseError`
  - 进程异常处理：spawn 失败 → 抛出 `LLMUnavailableError`
  - 移除子进程环境中的 `ANTHROPIC_API_KEY`（强制 CLI 使用 OAuth 认证）

- [x] T004 重构 `checkApiKey()` → `checkAuth()` in `src/cli/utils/error-handler.ts`
  - 导入 `detectAuth` from `../auth/auth-detector.js`（注意：相对路径需从 `src/cli/utils/` 到 `src/auth/`，即 `../../auth/auth-detector.js`）
  - 新增 `checkAuth()` 函数：调用 `detectAuth()`，如果 `preferred !== null` 返回 true
  - 错误提示改为列出两种认证方式：
    ```
    未找到可用的认证方式。请选择以下方式之一：
      1. 设置环境变量: export ANTHROPIC_API_KEY=your-key-here
      2. 安装并登录 Claude Code: claude auth login
    ```
  - 保留 `checkApiKey()` 函数但标记为 deprecated（向后兼容）
  - 依赖 T002 完成

**Checkpoint**: 认证检测 + CLI 代理核心可用，可开始 US1 实现

---

## Phase 3: User Story 1 - 订阅用户通过 CLI 代理使用 generate/diff (Priority: P1) 🎯 MVP

**Goal**: 已登录 Claude Code 的订阅用户在未设置 `ANTHROPIC_API_KEY` 的情况下可直接运行 `reverse-spec generate`

**Independent Test**: `unset ANTHROPIC_API_KEY && reverse-spec generate src/core/` 通过 CLI 代理正常完成并生成 spec

### 测试 for User Story 1

- [x] T005 [P] [US1] 单元测试 AuthDetector in `tests/unit/auth-detector.test.ts`
  - 测试：有 API Key 时检测为 api-key 类型
  - 测试：无 API Key + CLI 已安装已登录 → 检测为 cli-proxy 类型
  - 测试：无 API Key + CLI 未安装 → 返回无可用方式 + 诊断信息
  - 测试：无 API Key + CLI 已安装但未登录 → 返回不可用 + 诊断信息
  - 测试：优先级排序（API Key > CLI Proxy）
  - Mock `child_process.execSync` 避免实际调用 CLI

- [x] T006 [P] [US1] 单元测试 CLI Proxy in `tests/unit/cli-proxy.test.ts`
  - 测试：正常调用 → 解析 stream-json → 返回 LLMResponse
  - 测试：超时 → 抛出 LLMTimeoutError + kill 进程
  - 测试：非零退出码 → 抛出 LLMResponseError
  - 测试：spawn 失败 → 抛出 LLMUnavailableError
  - 测试：子进程环境不包含 ANTHROPIC_API_KEY
  - 测试：stdin 正确传入 prompt
  - Mock `child_process.spawn` 避免实际 spawn CLI

### 实现 for User Story 1

- [x] T007 [US1] 重构 `callLLM()` 策略模式 in `src/core/llm-client.ts`
  - 将现有 SDK 调用逻辑提取为 `callLLMviaSdk()` 内部函数
  - 新增 `callLLMviaCli()` 内部函数，调用 `src/auth/cli-proxy.ts` 的 `callLLMviaCli`
  - 修改 `callLLM()`：
    1. 调用 `detectAuth()` 获取认证结果
    2. 如果 `preferred.type === 'api-key'` → 走 `callLLMviaSdk()`
    3. 如果 `preferred.type === 'cli-proxy'` → 走 `callLLMviaCli()`
    4. 如果 `preferred === null` → 抛出 `LLMUnavailableError`
  - 重试逻辑对两种策略都适用
  - `LLMConfig` 接口无需变更（apiKey 已是 optional）
  - 依赖 T002, T003

- [x] T008 [P] [US1] 更新 `generate.ts` 认证检查 in `src/cli/commands/generate.ts`
  - `checkApiKey()` → `checkAuth()`
  - 更新 import 语句
  - 依赖 T004

- [x] T009 [P] [US1] 更新 `batch.ts` 认证检查 in `src/cli/commands/batch.ts`
  - `checkApiKey()` → `checkAuth()`
  - 更新 import 语句
  - 注意：batch 模式的并发限制由 `CLIProxyConfig.maxConcurrency` 控制（默认 3），无需在此层处理
  - 依赖 T004

- [x] T010 [P] [US1] 更新 `diff.ts` 认证检查 in `src/cli/commands/diff.ts`
  - `checkApiKey()` → `checkAuth()`
  - 更新 import 语句
  - 依赖 T004

**Checkpoint**: 此时 US1 应完全可用——订阅用户可通过 CLI 代理运行 generate/batch/diff

---

## Phase 4: User Story 2 - 认证状态诊断 (Priority: P2)

**Goal**: 用户可通过 `reverse-spec auth-status` 快速了解当前环境的认证状态

**Independent Test**: 运行 `reverse-spec auth-status`，显示当前所有可用认证方式和优先级

### 测试 for User Story 2

- [x] T011 [P] [US2] 单元测试 auth-status 命令 in `tests/unit/auth-status.test.ts`
  - 测试：parse-args 正确解析 `auth-status` 子命令
  - 测试：parse-args 正确解析 `auth-status --verify`
  - 测试：两种方式均可用时的输出格式
  - 测试：仅 CLI 可用时的输出格式
  - 测试：无任何可用方式时的输出格式和建议
  - Mock `detectAuth()` 和 `verifyAuth()`

### 实现 for User Story 2

- [x] T012 [US2] 添加 `auth-status` 子命令解析 in `src/cli/utils/parse-args.ts`
  - `CLICommand.subcommand` 类型联合添加 `'auth-status'`
  - 新增 `CLICommand.verify` 可选 boolean 字段（`--verify` 标志）
  - 添加 `auth-status` 解析分支（无位置参数，支持 `--verify`）
  - 在子命令有效性检查中添加 `'auth-status'`（约第 122 行）

- [x] T013 [US2] 实现 auth-status 命令处理 in `src/cli/commands/auth-status.ts`
  - 导入 `detectAuth`、`verifyAuth` from `../../auth/auth-detector.js`
  - 实现 `runAuthStatus(command: CLICommand)`:
    1. 调用 `detectAuth()` 获取所有认证方式
    2. 如果 `--verify`，额外调用 `verifyAuth()` 在线验证
    3. 格式化输出：
       ```
       认证状态:
         ✓ ANTHROPIC_API_KEY: 已设置 (sk-ant-...****)
         ✓ Claude CLI: 已安装 (v2.1.0), 已登录
         优先级: API Key > CLI 代理
       ```
    4. 无可用方式时给出配置指引

- [x] T014 [US2] 注册 auth-status 命令 in `src/cli/index.ts`
  - 导入 `runAuthStatus` from `./commands/auth-status.js`
  - 在 HELP_TEXT 中添加 `auth-status` 用法说明
  - 在 switch 语句中添加 `case 'auth-status'` 分支
  - 依赖 T012, T013

**Checkpoint**: US1 和 US2 均完成，认证系统功能完整

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 验证、清理、确保所有功能协调工作

- [x] T015 构建验证：运行 `npm run build` 确保 TypeScript 编译通过
- [x] T016 测试验证：运行 `npm test` 确保所有测试通过（含新增和已有测试）
- [x] T017 Quickstart 验证：按 `quickstart.md` 执行完整验证流程
  - 验证 `auth-status` 命令正常输出
  - 验证 API Key 方式不受影响
  - 验证 CLI 代理方式可用（需要已登录 Claude Code 的环境）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — 可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 — 阻塞所有用户故事
- **US1 (Phase 3)**: 依赖 Phase 2 完成
- **US2 (Phase 4)**: 依赖 Phase 2 完成（与 US1 可并行）
- **Polish (Phase 5)**: 依赖 Phase 3 + Phase 4 完成

### User Story Dependencies

- **User Story 1 (P1)**: 依赖 Foundational (Phase 2) — 与 US2 无依赖
- **User Story 2 (P2)**: 依赖 Foundational (Phase 2) — 与 US1 无依赖

### Within Each User Story

- 测试与实现可并行编写（测试 mock 外部依赖，不依赖实现细节）
- T007（callLLM 策略重构）是 US1 的关键路径，T008-T010 依赖 T004 但彼此并行
- T014（注册命令）依赖 T012 + T013

### Task Dependency Graph

```text
T001 ─→ T002 [P] ─→ T004 ─→ T008 [P] ─→ T015
         T003 [P] ─↗       ─→ T009 [P]    T016
                   ↘        ─→ T010 [P]    T017
                    T007 ──────────────────↗

         T002 ─→ T012 ─→ T014 ──────────↗
                  T013 ─↗

         T005 [P] ──────────── 可与 T007-T010 并行
         T006 [P] ──────────── 可与 T007-T010 并行
         T011 [P] ──────────── 可与 T012-T014 并行
```

### Parallel Opportunities

**Phase 2 内部并行**:
```
T002 (auth-detector) ‖ T003 (cli-proxy) → 完成后 → T004 (checkAuth)
```

**Phase 3 US1 内部并行**:
```
T005 (auth-detector tests) ‖ T006 (cli-proxy tests)
T008 (generate.ts) ‖ T009 (batch.ts) ‖ T010 (diff.ts)
```

**Phase 4 US2 内部并行**:
```
T011 (auth-status tests) ‖ T012 (parse-args) + T013 (auth-status command)
```

**跨用户故事并行**:
```
Phase 3 (US1) ‖ Phase 4 (US2)  — 两者仅共享 Phase 2 的产出
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational（CRITICAL — 阻塞所有功能）
3. 完成 Phase 3: User Story 1
4. **STOP and VALIDATE**: 测试 CLI 代理方式是否正常工作
5. 如果通过 → MVP 可用

### Incremental Delivery

1. Phase 1 + 2 → 认证基础设施就绪
2. Phase 3 (US1) → 订阅用户可直接使用 generate/diff → **MVP!**
3. Phase 4 (US2) → 添加 auth-status 诊断
4. Phase 5 → 全面验证和清理

---

## Summary

| 指标 | 值 |
|------|-----|
| 总任务数 | 17 |
| Phase 1 (Setup) | 1 |
| Phase 2 (Foundational) | 3 |
| Phase 3 (US1) | 6 |
| Phase 4 (US2) | 4 |
| Phase 5 (Polish) | 3 |
| 可并行任务 | 10 (标记 [P]) |
| 新增文件 | 4 (`auth-detector.ts`, `cli-proxy.ts`, `auth-status.ts` + 3 测试文件) |
| 修改文件 | 6 (`llm-client.ts`, `error-handler.ts`, `parse-args.ts`, `index.ts`, `generate.ts`, `batch.ts`, `diff.ts`) |
| MVP 范围 | Phase 1-3 (10 tasks) |

## Notes

- [P] 任务 = 不同文件，无互相依赖
- [Story] 标签将任务映射到具体用户故事
- 每个用户故事可独立完成和测试
- CLI 代理依赖 `claude` CLI 安装和登录，测试中使用 mock
- batch 模式的并发限制（maxConcurrency=3）在 `cli-proxy.ts` 层面控制
- 所有新增代码遵循现有项目的中文注释 + 英文标识符约定
