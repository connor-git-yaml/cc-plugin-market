---
feature_id: F-094-06
feature_name: 进度报告改善与错误信息完善
milestone: M-094 Panoramic 架构整洁化与产品能力对齐
branch: claude/festive-hofstadter
created: 2026-04-11
status: Draft
depends_on:
  - F-094-02
related_files:
  - src/batch/progress-reporter.ts
  - src/cli/commands/batch.ts
  - src/batch/batch-orchestrator.ts
  - src/panoramic/utils/logger.ts
---

# Feature Specification: F-094-06 进度报告改善与错误信息完善

## 背景

本特性是 M-094 里程碑的第 6 个子特性，解决两个影响用户体验的问题：

1. **进度条与模块日志交叉输出**：`process.stdout.write`（进度条）与 `console.log`（模块日志）混用，在终端中产生视觉混乱；在管道/CI 环境中输出原始 `\r` 控制码，造成日志污染。

2. **错误信息完全静默**：`src/panoramic/` 下存在 26 个 empty catch 块，其中 5 个应当上报警告的场景目前无任何输出，导致调试困难；21 个合理降级场景也缺少可见的调试信息。

调研发现（见 `research/tech-research.md`）：实际 empty catch 总数为 26 个（非 blueprint 预估的 50+），其中 5 个应增加警告、21 个应添加 debug 日志，无需从头改造的情况。

---

## User Scenarios & Testing

### User Story 1 — 交互终端下进度条不再打断模块日志（Priority: P1）

开发者在本地终端执行批量分析时，期望看到整洁的输出：进度条固定显示在底部，模块日志在进度条上方滚动，二者不互相覆盖。

**Why this priority**：这是最直接影响日常使用体验的问题。进度条与日志交叉导致输出内容无法阅读，是当前最高优先级痛点。

**Independent Test**：执行包含 3 个以上模块的批量分析，在 TTY 终端中观察输出，进度条与模块日志可独立验证是否交叉。

**Acceptance Scenarios**:

1. **Given** 开发者在交互终端（`isTTY === true`）执行批量分析，**When** 处理过程中有模块日志输出，**Then** 进度条始终固定在最后一行，模块日志从进度条上方输出，视觉上不发生覆盖或乱码。

2. **Given** 批量分析完成，**When** 终端恢复正常输入，**Then** 最终进度（100%）正确显示，不留下残余的 `\r` 光标偏移。

3. **Given** 分析中途某个模块失败，**When** 错误信息被记录，**Then** 错误信息在进度条上方正常输出，进度条状态同步更新。

---

### User Story 2 — CI / 管道环境下输出干净的行日志（Priority: P1）

在 CI 环境或通过管道处理（如 `reverse-spec-batch ... | tee log.txt`）时，用户期望输出为标准的、无 ANSI 控制码的行日志，每行格式为 `[N/Total] module-path ... status`，方便后续解析或存档。

**Why this priority**：与 User Story 1 并列 P1。自动化流水线中的乱码输出会导致日志解析失败、报警误报，直接影响 CI 可用性。

**Independent Test**：执行 `reverse-spec-batch ... | cat` 或在非 TTY 环境运行，检查标准输出是否不含 ANSI 控制码、每个模块占一行。

**Acceptance Scenarios**:

1. **Given** 在非 TTY 环境（`isTTY === false`，如 CI 或管道）执行批量分析，**When** 进度更新触发，**Then** 输出格式为 `[N/Total] module-path ... status`，每条记录占独立一行，无 `\r`、无 ANSI 转义序列。

2. **Given** 通过 `| cat` 管道捕获输出，**When** 检查捕获内容，**Then** 内容为纯文本，可被 grep、awk 等工具直接处理，无乱码字符。

3. **Given** pipe 模式下进度更新，**When** 某模块耗时较长，**Then** 每个模块的开始行和完成行都各自输出，不出现进度条刷新覆盖行为。

---

### User Story 3 — 调试模式下可见降级原因（Priority: P2）

开发者在调试分析结果异常时，通过设置 `REVERSE_SPEC_LOG_LEVEL=debug` 能看到所有降级事件的原因（例如"无法读取文件 X，跳过"、"LLM 调用超时，使用 AST-only 输出"），而不是静默地跳过。

**Why this priority**：当前完全静默的降级让调试极为困难。debug 日志是提升可维护性的关键，但不影响默认运行时的用户体验，因此优先级低于进度报告修复。

**Independent Test**：执行包含会触发降级的场景（如某个文件格式不支持），分别在默认级别和 `REVERSE_SPEC_LOG_LEVEL=debug` 下运行，对比输出差异。

**Acceptance Scenarios**:

1. **Given** 默认运行（未设置 `REVERSE_SPEC_LOG_LEVEL`），**When** 发生文件解析失败等降级事件，**Then** 终端无任何关于降级原因的输出，行为与变更前一致（静默降级）。

2. **Given** 设置 `REVERSE_SPEC_LOG_LEVEL=debug`，**When** 发生文件解析失败等降级事件，**Then** 可以看到 debug 级别日志，说明降级原因（如文件路径、错误类型）。

3. **Given** 设置 `REVERSE_SPEC_LOG_LEVEL=debug`，**When** LLM 增强不可用时触发静默降级，**Then** 输出 debug 日志说明降级原因，但分析流程不中断、最终结果仍包含 AST-only 输出。

---

### User Story 4 — 应上报警告的解析失败不再静默（Priority: P2）

当 `data-model-generator`、`event-surface-generator` 等 5 处关键解析失败时，用户在 warn 级别（默认级别）下能看到 warning 输出，而不是完全静默，从而意识到输出可能不完整。

**Why this priority**：5 处应上报警告的关键解析失败中，`data-model-generator.ts`（L578、L599）、`framework-introspection.ts`（L119）和 `api-surface/index.ts`（L117）目前完全静默；`event-surface-generator.ts`（L145）和 `troubleshooting-generator.ts`（L121）虽已有 `warnings.add()` 但未接入统一 Logger 机制。[AUTO-CLARIFIED] 统一这 5 处的输出机制是 Part B 的核心价值。

**Independent Test**：构造会触发这 5 处 catch 块的输入场景（如格式损坏的 Python 文件），在默认级别下运行，验证是否有 warning 输出。

**Acceptance Scenarios**:

1. **Given** 默认运行（`warn` 级别），**When** `data-model-generator` 遇到无法解析的 Python/TS 文件，**Then** 在标准错误或日志中出现 warning 级别记录，说明哪个文件解析失败。

2. **Given** 默认运行，**When** `event-surface-generator`、`troubleshooting-generator`、`framework-introspection`、`api-surface/index` 遇到无法解析的文件，**Then** 各自输出 warning，不抛出未捕获异常，分析流程继续。[CLARIFIED: interface-surface-generator 调研中已有 warnings.add() 且调用路径已可见，此处与 FR-B-005 对齐]

3. **Given** 设置 `REVERSE_SPEC_LOG_LEVEL=error`，**When** 发生上述警告场景，**Then** warning 不输出（级别过滤正常工作），降级行为不变。

---

### Edge Cases

- **isTTY 检测不可靠**：某些 CI 环境会伪造 TTY，导致错误启用进度条模式。用户应可通过环境变量或 CLI 参数强制指定 `pipe` 模式。[AUTO-RESOLVED: 根据 `process.stdout.isTTY` 自动判断，不额外引入 override 参数，以保持接口简洁。当前无明确用户反馈要求强制覆盖，符合 YAGNI 原则]

- **并发模块同时输出日志**：batch-orchestrator 可能并发处理多个模块，并发 `console.log` 与进度条刷新可能仍发生交错。本特性仅保证"顺序执行时无交叉"，并发场景的严格同步超出 MVP 范围。

- **logger 实例的创建时机**：若 `REVERSE_SPEC_LOG_LEVEL` 在进程启动后修改，logger 应使用惰性读取环境变量，确保测试可覆盖。

- **windows 终端兼容性**：ANSI 控制码在 Windows 命令提示符下可能不支持。TTY 模式的 ANSI 输出暂不做 Windows 特殊处理，降级为 pipe 模式输出。[AUTO-RESOLVED: 本项目主要运行在 macOS/Linux CI 环境，Windows 支持为可选]

- **原有降级行为保持不变**：添加 debug 日志和 warning 后，21 个静默降级场景仍必须在非 debug 级别下保持静默，不得改变用户可见行为。

---

## Requirements

### Functional Requirements

**Part A — 进度报告分离**

- **FR-A-001**：系统 MUST 根据 `process.stdout.isTTY` 自动选择输出模式（`tty` 或 `pipe`）。`[必须]` `[关联: US-1, US-2]`

- **FR-A-002**：在 `tty` 模式下，进度更新 MUST 使用行内刷新（`\r` 加 ANSI 清行控制码）输出到标准输出，不换行。`[必须]` `[关联: US-1]`

- **FR-A-003**：在 `tty` 模式下，模块日志（`reporter.start/stage/complete`）MUST 在输出前先清除当前进度行，输出日志后重新绘制进度行。`ProgressMode` 通过扩展 `createReporter(total, mode)` 工厂函数第二参数注入，不修改 `ProgressReporter` 接口类型。`[必须]` `[关联: US-1]` [AUTO-CLARIFIED]

- **FR-A-004**：在 `pipe` 模式下，系统 MUST 禁用进度条，每个模块完成时输出一行 `[N/Total] module-path ... status` 格式的纯文本日志。`[必须]` `[关联: US-2]`

- **FR-A-005**：在 `pipe` 模式下，系统 MUST NOT 输出任何 ANSI 转义序列或 `\r` 回车符。`[必须]` `[关联: US-2]`

- **FR-A-006**：`batch.ts` 中的手写进度条（`process.stdout.write(\r[===] N/M)`）MUST 被移除，改由 `progress-reporter` 的 `onProgress` 回调统一管理。`[必须]` `[关联: US-1, US-2]`

- **FR-A-007**：`ProgressMode` 枚举（`tty` / `pipe`）SHOULD 在 `progress-reporter.ts` 中定义，供 `batch-orchestrator.ts` 和 `batch.ts` 共用。`[必须]`

**Part B — 错误信息完善**

- **FR-B-001**：系统 MUST 在 `src/panoramic/utils/logger.ts` 中提供一个轻量级分级日志工具，支持 `debug` / `info` / `warn` / `error` 四个级别。`[必须]` `[关联: US-3, US-4]`

- **FR-B-002**：logger 的默认输出级别 MUST 为 `warn`，即默认只输出 warn 和 error 级别的消息。`[必须]` `[关联: US-3]`

- **FR-B-003**：logger MUST 支持通过环境变量 `REVERSE_SPEC_LOG_LEVEL` 调整输出级别（可选值：`debug`、`info`、`warn`、`error`）。`[必须]` `[关联: US-3]`

- **FR-B-004**：`src/panoramic/` 下 21 个应静默降级的 empty catch 块 MUST 添加 `logger.debug(...)` 调用，记录降级原因（文件路径、异常类型等关键上下文）。`[必须]` `[关联: US-3]`

- **FR-B-005**：`src/panoramic/` 下 5 处应上报警告的关键解析失败 MUST 确保在默认 warn 级别下有可见输出：3 处（`data-model-generator.ts` L578/L599、`framework-introspection.ts` L119 或 `api-surface/index.ts` L117）需新增 `logger.warn(...)` 调用；2 处（`event-surface-generator.ts` L145、`troubleshooting-generator.ts` L121）已有 `warnings.add()` 但需补充 `logger.warn(...)`。`[必须]` `[关联: US-4]` [AUTO-CLARIFIED]

- **FR-B-006**：添加 logger 后，原有的 21 个静默降级场景 MUST 在默认级别（warn）下保持静默，不改变用户可见的运行时行为。`[必须]` `[关联: US-3]`

- **FR-B-007**：`src/panoramic/` 下 MUST NOT 再存在无可执行语句的 `catch` 块，包括完全空的 `catch {}` 和仅含注释但无可执行语句的 catch 块。`[必须]` [AUTO-CLARIFIED]

- **FR-B-008**：logger SHOULD 将所有级别（debug/info/warn/error）输出到 `process.stderr`，避免污染 `stdout` 的主输出流。`[可选]` [CLARIFIED: 统一 stderr 输出，避免日志混入结构化输出]

**非功能需求**

- **FR-C-001**：logger 工具 MUST 为纯函数工厂模式，不引入任何新的 npm 依赖（零运行时依赖原则）。`[必须]`

- **FR-C-002**：新增 logger 单元测试 MUST 覆盖级别过滤、环境变量读取两个核心行为。`[必须]`

- **FR-C-003**：进度报告模式切换 SHOULD 有对应的单元测试，验证 tty/pipe 两种模式的输出格式。`[必须]`

### Key Entities

- **ProgressMode**：枚举类型，值为 `tty`（交互终端，启用进度条）或 `pipe`（非交互/CI，行日志模式）。由 `isTTY` 检测在运行时确定。

- **Logger**：分级日志工具，支持 `debug/info/warn/error` 四个级别。通过环境变量控制输出级别，默认 `warn`。轻量实现，无外部依赖。

- **ProgressReporter**（已有）：批量处理的进度报告接口，本次需扩展支持 `ProgressMode`，统一管理进度条和模块日志的输出。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**：在 TTY 终端执行包含 5 个模块的批量分析，进度条与模块日志零交叉——目测无一行被覆盖或显示乱码。

- **SC-002**：执行 `reverse-spec-batch ... | cat` 捕获输出，grep 检查不含 `\r`（0x0D）和 ANSI CSI 序列（`\x1b[`），结果为 0 匹配。

- **SC-003**：`src/panoramic/` 下无可执行语句的 catch 块数量从 26 个降为 0 个（所有 catch 块含至少一条可执行语句）。[AUTO-CLARIFIED]

- **SC-004**：设置 `REVERSE_SPEC_LOG_LEVEL=debug` 后，可在输出中找到至少 21 条 debug 日志，对应 21 个静默降级场景。

- **SC-005**：在默认级别下执行触发 5 个 warning catch 块的场景，可在 stderr 中找到对应的 warning 输出（至少 5 条）。

- **SC-006**：原有降级行为不变——在默认级别下，LLM 不可用时分析流程不中断，最终仍生成 AST-only 输出。

- **SC-007**：logger 单元测试覆盖率达到 100%（4 个日志级别 × 2 个环境变量配置场景）。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估值 | 说明 |
|------|--------|------|
| 组件总数 | 2 | 新增 `Logger`，扩展 `ProgressReporter`（`ProgressMode` 枚举） |
| 接口数量 | 3 | `ProgressMode` 枚举、`Logger` 接口/工厂函数、`ProgressReporter` 扩展签名 |
| 依赖新引入数 | 0 | 零 npm 依赖，纯 Node.js 内置 |
| 跨模块耦合 | 是 | 修改 `progress-reporter.ts` + `batch.ts` + `batch-orchestrator.ts` 三处调用方 |
| 复杂度信号 | 无 | 无递归、状态机、并发控制或数据迁移 |
| **总体复杂度** | **MEDIUM** | 跨 3 个现有模块调用方，但改动性质为补充日志/替换输出方式，无架构重组 |

**GATE_DESIGN 备注**：组件数（2）和接口数（3）均低于 HIGH 阈值，但涉及 `batch.ts`、`progress-reporter.ts`、`batch-orchestrator.ts` 三个文件的协调修改，建议在 plan 阶段明确改动顺序（先实现 Logger → 再改进度报告 → 最后治理 catch 块），降低中间状态的测试难度。

---

## YAGNI 检验摘要

| 组件/能力 | 标注 | 说明 |
|-----------|------|------|
| `ProgressMode` 枚举（tty/pipe） | `[必须]` | 核心需求：进度报告分离依赖此判断 |
| `Logger`（debug/info/warn/error） | `[必须]` | 核心需求：catch 块治理和环境变量控制依赖此工具 |
| `REVERSE_SPEC_LOG_LEVEL` 环境变量 | `[必须]` | 核心需求：无此机制 debug 日志无法在默认级别下静默 |
| ANSI 清行控制码（tty 模式） | `[必须]` | 核心需求：无清行操作无法实现进度条与日志不交叉 |
| isTTY 强制覆盖参数（CLI flag） | `[YAGNI-移除]` | 自动检测足够，无明确用户场景要求手动覆盖，符合 YAGNI 原则 |
| Logger 持久化到文件 | `[YAGNI-移除]` | 当前无日志文件需求，内存+stderr 输出已满足调试需求 |
| 并发日志同步锁 | `[YAGNI-移除]` | batch-orchestrator 当前为顺序执行，无需引入同步机制 |
