---
feature_id: F-094-06
feature_name: 进度报告改善与错误信息完善
created: 2026-04-11
status: Done
spec: ./spec.md
plan: ./plan.md
---

# Tasks: F-094-06 进度报告改善与错误信息完善

**Input**: `specs/094-06-progress-error-reporting/`
**Prerequisites**: plan.md, spec.md, research/tech-research.md

**实施顺序**（与 plan.md 三步骤对齐）：
1. 新建 Logger（Part B 基础，阻塞 catch 治理）
2. 重构进度报告（Part A，US1 + US2，可与步骤 1 并行）
3. 治理 catch 块（Part B 主体，US3 + US4，依赖步骤 1）

---

## Phase 1: Foundational — 新建 Logger（步骤 1）

**目的**：创建分级日志工具，是所有 catch 块治理任务（Phase 3）的前置依赖。

**关键约束**：零 npm 依赖；惰性读取 `process.env.REVERSE_SPEC_LOG_LEVEL`；统一输出到 `process.stderr`；输出格式 `[namespace] LEVEL: message`。

- [x] T001 新建 Logger 接口与工厂函数，实现四级输出（debug/info/warn/error）、默认 warn 级别、惰性环境变量读取、namespace 前缀，写入 `src/panoramic/utils/logger.ts`（约 50 行，零外部依赖）

- [x] T002 新建 Logger 单元测试，覆盖：4 个日志级别的级别过滤行为、`REVERSE_SPEC_LOG_LEVEL` 环境变量读取（debug/info/warn/error 四个值）、命名空间前缀格式验证、stderr 输出验证（非 stdout），写入 `tests/unit/logger.test.ts`

**Checkpoint**：`vitest run tests/unit/logger.test.ts` 全部通过 → Phase 3 解锁

---

## Phase 2: US1 + US2 — 进度报告分离（步骤 2，Priority: P1）

**目标（US1）**：交互终端下进度条固定底部、模块日志在上方滚动，不发生视觉交叉。
**目标（US2）**：CI/管道环境下输出干净的行日志，无 ANSI 控制码。
**注意**：本 Phase 不依赖 Phase 1（Logger），可与 Phase 1 并行启动。

### 测试先行（FR-C-003）

- [x] T003 [P] [US1] [US2] 新建进度报告器单元测试，覆盖：TTY 模式下输出含 `\x1b[2K\r` 清行控制码、pipe 模式下输出格式 `[N/Total] path ... status\n`、pipe 模式无 ANSI 序列和 `\r`，写入 `tests/unit/progress-reporter.test.ts`

### 实现 — progress-reporter.ts 重构

- [x] T004 [US1] [US2] 在 `src/batch/progress-reporter.ts` 顶部新增 `ProgressMode` 类型定义（`export type ProgressMode = 'tty' | 'pipe'`）并导出

- [x] T005 [US1] [US2] 重构 `createReporter(total, mode?)` 工厂函数签名，新增可选 `mode?: ProgressMode` 参数（默认根据 `process.stdout.isTTY` 自动检测），向后兼容（依赖 T004）

- [x] T006 [US1] 实现 TTY 模式策略：`start/stage` 先 `\x1b[2K\r` 清行后输出日志再重绘进度条；`complete` 清行后输出状态行再重绘；`finish` 清除进度行后输出摘要（依赖 T005）

- [x] T007 [US2] 实现 Pipe 模式策略：`start/stage` 不输出；`complete` 输出纯文本 `[N/Total] module-path ... status\n`；`finish` 输出摘要；全程禁止 ANSI 序列和 `\r`（依赖 T005）

### 实现 — 调用方更新

- [x] T008 [US1] [US2] 移除 `src/cli/commands/batch.ts` L41-46 手写进度条回调和 L49 手动换行，进度输出改由 reporter 统一管理（依赖 T005）

- [x] T009 [US1] [US2] 更新 `src/batch/batch-orchestrator.ts` 的 `createReporter` 调用，增加 mode 参数（依赖 T005）

**Checkpoint**：`vitest run tests/unit/progress-reporter.test.ts tests/unit/batch-orchestrator.test.ts` 全部通过

---

## Phase 3: US3 + US4 — catch 块治理（步骤 3，Priority: P2）

**前置依赖**：T001（Logger 实现）必须完成。

### US4 — 5 处警告场景治理（默认级别可见）

- [x] T010 [US4] `src/panoramic/generators/data-model-generator.ts` L578/L599 两处 empty catch 添加 `logger.warn(...)` 记录文件解析失败（依赖 T001）

- [x] T011 [US4] `src/panoramic/generators/event-surface-generator.ts` L145 catch 块补充 `logger.warn(...)`，与已有 `warnings.add()` 并存（依赖 T001）

- [x] T012 [US4] `src/panoramic/generators/troubleshooting-generator.ts` ~L100 catch 块补充 `logger.warn(...)`，与已有 `warnings.add()` 并存（依赖 T001）

- [x] T013 [US4] `src/panoramic/api-surface/framework-introspection.ts` L119 empty catch 添加 `logger.warn(...)` 记录文件路径（依赖 T001）

- [x] T014 [US4] `src/panoramic/api-surface/index.ts` L117 empty catch 添加 `logger.warn(...)` 记录文件路径（依赖 T001）

### US3 — 21 处 debug 降级场景治理（批量，可并行）

- [x] T015 [P] [US3] `src/panoramic/project-context.ts` 3 处 empty catch 添加 `logger.debug(...)` 记录降级原因（依赖 T001）

- [x] T016 [P] [US3] `src/panoramic/generators/config-reference-generator.ts` 4 处 empty catch 添加 `logger.debug(...)` 记录目录路径（依赖 T001）

- [x] T017 [P] [US3] `src/panoramic/api-surface/` 下 express-extractor、openapi-extractor、utils、endpoint-utils、fastapi-extractor 等约 9 处 empty catch 添加 `logger.debug(...)`（依赖 T001）

- [x] T018 [P] [US3] `src/panoramic/generators/` 下 architecture-overview、pattern-hints、runtime-topology、mock-readme、workspace-index 等约 5 处 empty catch 添加 `logger.debug(...)`（依赖 T001）

- [x] T019 [P] [US3] `src/panoramic/utils/llm-enricher.ts`、`stored-module-specs.ts` 及 `pipelines/` 下多文件的 empty catch 添加 `logger.debug(...)`（依赖 T001）

- [x] T020 [P] [US3] `src/panoramic/parsers/` 下 dockerfile-parser、behavior-yaml-parser、abstract-artifact-parser 等文件的 empty catch 添加 `logger.debug(...)`（依赖 T001）

**Checkpoint**：`vitest run tests/panoramic/ --run` 全部通过；所有 catch 块均含至少一条可执行语句

---

## Phase 4: Polish & 验收

- [x] T021 [P] 运行完整测试套件 `vitest run tests/unit/ tests/panoramic/`，确认无新增失败

- [x] T022 [P] 执行 SC-003 验收：`grep -rn "catch {" src/panoramic/` 确认 0 匹配

- [x] T023 更新 `progress-reporter.ts` 顶部 JSDoc 注释，补充 ProgressMode 说明

- [x] T024 更新 `logger.ts` 顶部 JSDoc 注释，说明 REVERSE_SPEC_LOG_LEVEL 用法

---

## 依赖关系

- **Phase 1（T001~T002）**：无前置依赖，立即开始
- **Phase 2（T003~T009）**：无前置依赖，可与 Phase 1 **并行**
- **Phase 3（T010~T020）**：依赖 T001 完成；内部 11 个任务可全部并行
- **Phase 4（T021~T024）**：依赖 Phase 1 + 2 + 3 全部完成

## FR 覆盖映射

| FR | 覆盖任务 |
|----|---------|
| FR-A-001~007 | T003~T009 |
| FR-B-001~003 | T001 |
| FR-B-004 | T015~T020 |
| FR-B-005 | T010~T014 |
| FR-B-006 | T001, T015~T020 |
| FR-B-007 | T010~T020, T022 |
| FR-B-008 | T001 |
| FR-C-001~003 | T001~T003 |

**FR 覆盖率：19/19（100%）** | **总任务数：24** | **可并行任务：13（54%）**
