---
feature_id: F-094-06
feature_name: 进度报告改善与错误信息完善
branch: claude/festive-hofstadter
created: 2026-04-11
status: Draft
spec: ./spec.md
---

# Implementation Plan: F-094-06 进度报告改善与错误信息完善

## Summary

本特性解决两个用户体验问题：(A) `process.stdout.write`（进度条）与 `console.log`（模块日志）在终端混用，在交互终端产生视觉混乱，在管道/CI 环境输出 `\r` 控制码污染日志流；(B) `src/panoramic/` 下存在 26 个无可执行语句的 empty catch 块，其中 5 个关键失败场景完全静默，21 个合理降级场景缺少调试信息。

技术方案分两部分：

**Part A**：重构 `src/batch/progress-reporter.ts`，引入 `ProgressMode`（`tty` / `pipe`）枚举，通过 `process.stdout.isTTY` 自动选择输出模式；在 `createReporter(total, mode?)` 工厂函数中实现两套输出策略；移除 `src/cli/commands/batch.ts` 中的手写进度条。

**Part B**：新建 `src/panoramic/utils/logger.ts`，提供纯函数工厂实现的四级日志（`debug/info/warn/error`），默认 `warn` 级别，通过环境变量 `REVERSE_SPEC_LOG_LEVEL` 惰性控制；对 26 个 empty catch 块分类治理（5 个增加 `logger.warn`，21 个增加 `logger.debug`）。

---

## Technical Context

- **Language/Version**: TypeScript 5.x / Node.js 20.x LTS
- **Primary Dependencies**: 无新增 npm 依赖（零运行时依赖原则）；使用 Node.js 内置 `process.stdout.isTTY`、`process.stderr`、`process.env`
- **Testing**: Vitest
- **Target Platform**: macOS / Linux（Windows 终端不做 ANSI 特殊处理，自动降级为 pipe 模式）

---

## Codebase Reality Check

| 文件 | LOC | 本次修改内容 | 已知 Debt |
|------|-----|-------------|-----------|
| `src/batch/progress-reporter.ts` | 149 | 扩展 createReporter 签名，新增 tty/pipe 双模式 | 全部 console.log，无 isTTY 检测 |
| `src/cli/commands/batch.ts` | 84 | 移除 L41-46 手写进度条 | 手写进度条与 reporter 职责不分 |
| `src/batch/batch-orchestrator.ts` | 794 | createReporter 调用增加 mode 参数（约 3 行） | LOC 794 但本次新增 < 5 行 |
| `src/panoramic/utils/logger.ts` | 0（新建） | 全新文件，约 50 行 | — |
| 26 个含 empty catch 的文件 | 各异 | 分别增加 logger.warn/debug | empty catch 无可执行语句 |

**前置清理评估**：不需要增加前置 `[CLEANUP]` task。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 约 30 个（3 batch + 1 新建 logger + ~26 panoramic） |
| 跨包影响 | 仅 `src/batch/` 和 `src/panoramic/utils/`，同一顶层包 |
| API/契约变更 | `createReporter(total, mode?)` 新增可选参数，向后兼容 |
| **风险等级** | **MEDIUM** |

---

## Architecture

### 组件交互图

```
batch.ts → runBatch() → batch-orchestrator.ts
                            ↓
                      createReporter(total, mode)
                            ↓
              ┌─────────────┴─────────────┐
         mode === 'tty'              mode === 'pipe'
         ANSI 清行控制码             纯文本行日志
         进度条固定底部              [N/Total] path ... status
         日志从上方滚动              无 ANSI 控制码
              └─────────────┬─────────────┘

src/panoramic/ 各模块
         ↓ catch 块内调用
   logger.ts createLogger(namespace)
         ↓ 惰性读取 REVERSE_SPEC_LOG_LEVEL
    level >= 阈值 → process.stderr 输出
    level < 阈值  → 静默不输出
```

### 关键接口设计

#### 1. ProgressMode 与 createReporter 扩展

```typescript
/** 进度报告输出模式 */
export type ProgressMode = 'tty' | 'pipe';

/**
 * 创建终端进度报告器
 * @param total - 模块总数
 * @param mode  - 输出模式（默认根据 process.stdout.isTTY 自动检测）
 */
export function createReporter(total: number, mode?: ProgressMode): ProgressReporter
```

**TTY 模式行为**：
- `start/stage`：先 `\x1b[2K\r` 清除当前行，输出日志后重绘进度条
- `complete`：清行 → 输出完成行 → 重绘进度条
- `finish`：清除进度行 → 输出摘要统计

**Pipe 模式行为**：
- `start/stage`：不输出（避免噪音）
- `complete`：`[N/Total] module-path ... status\n`（纯文本）
- `finish`：摘要统计

#### 2. Logger 工厂（新建）

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, context?: string): void;
  info(message: string, context?: string): void;
  warn(message: string, context?: string): void;
  error(message: string, context?: string): void;
}

/**
 * 创建分级日志工具实例
 * 输出到 process.stderr，默认 warn 级别
 * @param namespace - 日志命名空间（如 'data-model-generator'）
 */
export function createLogger(namespace?: string): Logger
```

- 输出统一到 `process.stderr`
- 日志级别惰性读取 `process.env.REVERSE_SPEC_LOG_LEVEL`
- 输出格式：`[namespace] WARN: message`
- 级别顺序：debug(0) < info(1) < warn(2) < error(3)
- 约 50 行实现，零外部依赖

#### 3. batch.ts 修改

移除 L41-46 手写进度条回调和 L49 手动换行。

#### 4. catch 块治理模式

**5 处 warn（默认可见）**：
```typescript
} catch (err) {
  logger.warn(`Python 文件解析失败，已跳过: ${path.relative(context.projectRoot, filePath)}`, String(err));
}
```

**21 处 debug（仅 debug 级别可见）**：
```typescript
} catch (err) {
  logger.debug(`JSON 解析失败，使用默认值: ${String(err)}`);
}
```

---

## 实施顺序

### 步骤 1 — 新建 Logger（Part B 基础）

- 实现 `src/panoramic/utils/logger.ts`
- 新建 `tests/unit/logger.test.ts`
- 验证：`vitest run tests/unit/logger.test.ts`

### 步骤 2 — 重构进度报告（Part A）

- 重构 `progress-reporter.ts`（引入 ProgressMode）
- 修改 `batch.ts`（移除手写进度条）
- 更新 `batch-orchestrator.ts`（传入 mode 参数）
- 新建 `tests/unit/progress-reporter.test.ts`
- 验证：`vitest run tests/unit/progress-reporter.test.ts tests/unit/batch-orchestrator.test.ts`

### 步骤 3 — 治理 catch 块（Part B 主体）

- 先处理 5 处 warn 场景
- 再处理 21 处 debug 场景
- 验证：`vitest run tests/panoramic/ --run`
- 验证：`grep -rn "catch {" src/panoramic/ | wc -l` → 0

---

## Complexity Tracking

| 取舍点 | 选择 | 拒绝的替代方案 | 理由 |
|--------|------|---------------|------|
| TTY 清行 | `\x1b[2K\r` ANSI 清行 | 仅用 `\r` 不清行 | 进度条短于前次日志时会残留字符 |
| mode 注入方式 | `createReporter(total, mode?)` 可选参数 | 修改 ProgressReporter 接口 | 接口修改影响所有实现方，可选参数向后兼容 |
| Logger 环境变量读取 | 惰性（每次调用读取） | 模块加载时一次读取 | 测试需动态覆盖环境变量 |

---

## Constitution Check

所有适用原则均通过，无 VIOLATION。关键通过点：
- **原则 III (YAGNI)**：Logger 约 50 行，无持久化、无 Windows 特殊处理、无并发锁
- **原则 VIII (纯 Node.js 生态)**：零新增 npm 依赖
- **原则 XIV (可观测性)**：本特性本身即为增强可观测性
