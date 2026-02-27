# Feature Specification: Parallel Subagent Speedup

**Feature Branch**: `feat/019-parallel-subagent-speedup`
**Created**: 2026-02-27
**Status**: Draft
**Input**: User description: "调研 Claude 的多 Subagent 和 Agent Team 能力，review 从 Feature 到 Doc 的所有流程，识别可并行化的阶段，在保证输出质量不下滑的情况下加速任务推进。具体变更范围：修改 SKILL.md 编排 prompt 中的子代理调用模式，将可并行的阶段改为并行委派。"
**Research Mode**: story（无调研制品，基于代码上下文摘要直接生成）

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 验证闭环三并行（Feature/Story/Fix 全模式） (Priority: P1)

作为 Spec Driver 用户，我希望在验证闭环阶段（Phase 7 / Phase 5 / Phase 4），spec-review、quality-review 和 verify 三个子代理能够并行执行，从而将验证阶段的等待时间从三次串行缩短到约一次的时长。

**Why this priority**: 验证闭环是所有模式（Feature/Story/Fix）的公共收尾阶段，三个子代理之间无数据依赖（spec-review 审查 spec 合规、quality-review 审查代码质量、verify 执行工具链验证），改造风险最低、覆盖面最广、收益最高。当前 SKILL.md 中已有"可串行或并行执行"的注释但未转化为明确的并行调度指令。

**Independent Test**: 执行任意模式（Feature/Story/Fix）流程至验证阶段，观察编排器是否在同一时间段启动三个验证子代理，验证总耗时约等于最慢的单个子代理耗时而非三者之和。

**Acceptance Scenarios**:

1. **Given** Feature 模式流程进入 Phase 7（验证闭环），**When** 编排器开始执行验证，**Then** spec-review、quality-review 和 verify 三个 Task 调用在同一消息中发出或使用 `run_in_background` 并行启动，三者执行时间窗口重叠。
2. **Given** Story 模式流程进入 Phase 5（验证闭环），**When** 编排器开始执行验证，**Then** 三个验证子代理并行启动，GATE_VERIFY 在三者全部完成后才执行汇合检查。
3. **Given** Fix 模式流程进入 Phase 4（验证闭环），**When** 编排器开始执行验证，**Then** 三个验证子代理并行启动，验证报告在所有子代理完成后合并。
4. **Given** 并行执行的某个验证子代理失败，**When** 失败发生，**Then** 编排器等待其余子代理完成后统一报告失败，不中断其他正在运行的验证子代理。

---

### User Story 2 - 调研阶段并行（Feature full 模式） (Priority: P2)

作为 Spec Driver 用户，我希望在 Feature 模式的 full 调研模式下，product-research 和 tech-research 能够并行启动，从而将调研阶段的总耗时减少约 50%。

**Why this priority**: 调研阶段是 Feature 模式中耗时最长的部分之一。当前编排 prompt 要求 tech-research 在 product-research 完成后才启动（因为 full 模式下 tech-research 接收 product-research.md 作为输入）。但实际分析表明，tech-research 可以在不依赖 product-research 输出的情况下独立产出有价值的技术调研结果——就像 tech-only 模式已经证明的那样。产研汇总阶段（Phase 1c）仍需等待两者完成后再执行，这构成天然的汇合点。

**Independent Test**: 执行 Feature 模式 `--research full`，观察 product-research 和 tech-research 是否在同一时间段启动并行执行，产研汇总在两者完成后才开始。

**Acceptance Scenarios**:

1. **Given** Feature 模式 `--research full` 进入调研阶段，**When** Phase 1a 和 Phase 1b 开始执行，**Then** product-research 和 tech-research 两个 Task 并行启动，不再等待 product-research 完成后才启动 tech-research。
2. **Given** product-research 和 tech-research 并行执行，**When** 两者均完成，**Then** Phase 1c（产研汇总）读取两份报告后生成 research-synthesis.md，汇总质量不因并行而降低。
3. **Given** 并行执行的 product-research 失败，**When** 失败发生，**Then** tech-research 继续执行完成，编排器在汇合点报告 product-research 失败并触发重试逻辑。
4. **Given** tech-research 并行执行时无 product-research.md 输入，**When** tech-research 完成，**Then** 其产出质量与 tech-only 模式下的独立执行结果一致（不依赖 product-research.md）。

---

### User Story 3 - Clarify + Checklist 并行（Feature 模式） (Priority: P2)

作为 Spec Driver 用户，我希望在 Feature 模式 Phase 3 中，需求澄清（clarify）和质量检查表（checklist）能够并行执行，从而减少 Phase 3 的等待时间。

**Why this priority**: clarify 和 checklist 都依赖 spec.md 作为输入，但两者之间无相互依赖。clarify 负责发现歧义并生成澄清建议，checklist 负责生成质量检查项。二者可以同时启动，在两者完成后再进入 GATE_DESIGN 门禁。

**Independent Test**: 执行 Feature 模式至 Phase 3，观察 clarify 和 checklist 是否并行启动，GATE_DESIGN 在两者完成后才执行。

**Acceptance Scenarios**:

1. **Given** Feature 模式 Phase 2（需求规范）完成后生成 spec.md，**When** Phase 3 开始执行，**Then** clarify 和 checklist 两个 Task 并行启动。
2. **Given** clarify 发现 CRITICAL 问题需要用户交互，**When** clarify 返回 CRITICAL，**Then** 编排器等待 checklist 也完成后，统一向用户展示 clarify 结果和 checklist 结果，再由用户决策。
3. **Given** clarify 和 checklist 都正常完成，**When** 两者结果汇合，**Then** GATE_DESIGN 检查两者的综合结果后决定是否暂停。

---

### User Story 4 - 并行失败串行回退（全模式安全网） (Priority: P1)

作为 Spec Driver 用户，我希望当并行执行遇到异常（如 Claude Code Task tool 不支持预期的并行模式、超时、资源竞争等）时，编排器能自动回退到串行执行模式，确保流程不中断。

**Why this priority**: Constitution 检查已明确 WARNING（W2: 向后兼容），并行化必须提供安全回退。这是保证输出质量不下滑的核心保障。如果并行调度失败但无回退机制，整个流程将中断，用户体验急剧恶化。

**Independent Test**: 模拟并行调度失败场景（如 Task 超时），验证编排器是否自动切换到串行模式继续执行。

**Acceptance Scenarios**:

1. **Given** 编排器尝试并行启动多个 Task，**When** 并行调度失败（如 Task tool 返回错误或超时），**Then** 编排器输出 `[并行回退] 并行调度失败，切换到串行模式` 日志，并按原有串行顺序依次执行子代理。
2. **Given** 编排器在串行回退模式下执行，**When** 所有阶段完成，**Then** 最终产出质量与纯串行模式完全一致，完成报告中标注 `[回退] 以下阶段使用串行模式执行: {阶段列表}`。

---

### Edge Cases

- **并行子代理写入同一文件**: 并行执行的子代理是否可能同时写入同一输出文件？根据分析，验证闭环的三个子代理写入不同文件（spec-review 报告、quality-review 报告、verification-report.md），因此不存在写冲突。调研阶段的两个子代理也写入不同文件（product-research.md、tech-research.md），同样安全。
- **并行子代理的上下文窗口压力**: 多个子代理同时运行会增加并发 API 调用数，可能导致 rate limit。编排 prompt 应提示"如遇 rate limit 错误，自动降级为串行"。
- **GATE 汇合时部分子代理未返回**: 如果并行子代理中有一个长时间无响应，门禁汇合点需要等待策略——当前设计为"等待所有完成"，不设超时（由 Task tool 自身的超时机制保障）。
- **Doc 模式和 Sync 模式的并行化**: Doc 模式为完全编排器驱动（无 Task 委派），Sync 模式仅 1 个 Task 委派。两者不存在并行化机会，无需修改。
- **`--rerun` 与并行化的交互**: 选择性重跑某个阶段时，该阶段如果属于并行组的一部分（如仅重跑 spec-review），应单独执行而非触发整组并行。

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 编排器 MUST 在验证闭环阶段（Feature Phase 7 / Story Phase 5 / Fix Phase 4）将 spec-review 和 quality-review 并行委派，verify 在两者完成后串行启动并读取两者报告，最终形成 `parallel(spec-review, quality-review) → verify → GATE_VERIFY` 的依赖链。[AUTO-CLARIFIED: parallel(spec-review, quality-review) → verify 串行 — verify 子代理在现有 SKILL.md 中接收前两者的报告路径作为输入，若三者完全并行则 verify 将丧失对 spec-review/quality-review 结果的检查能力，降低验证深度；选择两者并行 + verify 串行跟随可获约 50% 加速，且与现有 prompt 设计兼容，US1 验收标准中"执行时间窗口重叠"仍满足]
  - 追溯: User Story 1

- **FR-002**: 编排器 MUST 在所有并行子代理完成后才执行门禁（GATE）汇合检查，不得在部分子代理完成时提前触发门禁。
  - 追溯: User Story 1, User Story 2, User Story 3

- **FR-003**: 编排器 MUST 在 Feature 模式 `--research full` 下将 product-research 和 tech-research 改为并行启动，Phase 1c（产研汇总）作为汇合点在两者完成后执行。
  - 追溯: User Story 2

- **FR-004**: 并行模式下的 tech-research MUST 以独立模式运行（不传入 product-research.md 路径），与 tech-only 模式下的行为一致。
  - 追溯: User Story 2

- **FR-005**: 编排器 MUST 在 Feature 模式 Phase 3 中将 clarify 和 checklist 改为并行委派，GATE_DESIGN 在两者完成后执行。
  - 追溯: User Story 3

- **FR-006**: 编排器 MUST 在并行调度遭遇异常时（如 Task 整体返回不可恢复错误、rate limit 导致所有并行 Task 失败、编排器判断无法完成并行调度）自动回退到串行执行模式，并输出回退日志。回退触发由编排器 LLM 根据上下文语义判断，不要求程序化区分"调度失败"与"业务失败"——正常的子代理业务失败仍由现有重试机制处理（FR-010）。[AUTO-CLARIFIED: 编排器 LLM 语义判断回退 — Claude Code Task tool 不提供可编程区分"调度失败"与"业务失败"的接口；将回退逻辑设计为 prompt 级指令，由编排器 LLM 判断何时降级，与现有重试机制互补且不冲突；若强制要求精确错误分类将使 prompt 过度复杂化]
  - 追溯: User Story 5

- **FR-007**: 编排器 MUST 在完成报告中标注哪些阶段使用了并行执行、哪些因回退而使用串行执行。
  - 追溯: User Story 1, User Story 5

- **FR-008**: 并行化变更 MUST 仅修改 SKILL.md 编排 prompt 文件，不得修改子代理 prompt（agents/*.md）或脚本文件。
  - 追溯: 需求描述（"修改 SKILL.md 编排 prompt 中的子代理调用模式"）

- **FR-009**: 编排器 MUST 在并行子代理中某个失败时，不中断其他正在运行的并行子代理，而是等待所有子代理完成后统一处理失败。
  - 追溯: User Story 1, User Story 2

- **FR-011**: Doc 模式（speckit-doc）和 Sync 模式（speckit-sync）MAY 不进行任何并行化修改（因其不存在可并行化的 Task 委派）。
  - 追溯: Edge Case 分析

- **FR-012**: 并行化 MUST 不改变任何质量门禁的行为语义——门禁的暂停/通过/失败逻辑保持不变，仅门禁的触发时机从"最后一个串行子代理完成后"变为"所有并行子代理完成后"。
  - 追溯: Constitution WARNING W1

- **FR-013**: `--rerun` 选择性重跑 SHOULD 以单个子代理为粒度执行，不因该子代理属于并行组而触发整组重跑。
  - 追溯: Edge Case 分析

### Key Entities

- **并行组（Parallel Group）**: 一组可同时启动的子代理 Task，共享一个汇合点。本需求定义 3 个并行组：
  - `VERIFY_GROUP`: spec-review + quality-review 并行（汇合后 verify 串行读取两者报告，再汇合至 GATE_VERIFY）。依赖链: `parallel(spec-review, quality-review) → verify → GATE_VERIFY`
  - `RESEARCH_GROUP`: product-research + tech-research（汇合点: Phase 1c 产研汇总，仅 Feature full 模式）
  - `DESIGN_PREP_GROUP`: clarify + checklist（汇合点: GATE_DESIGN，仅 Feature 模式）

- **汇合点（Join Point）**: 并行组中所有子代理完成后的检查点，通常对应一个质量门禁（GATE）或编排器亲自执行的步骤。

- **回退标记（Fallback Flag）**: 标识某个并行组是否因调度失败而回退到串行执行。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Feature 模式（full 调研）的验证闭环阶段（Phase 7）总耗时减少 30% 以上（对比串行执行的三次子代理调用耗时之和）。
- **SC-002**: Feature 模式（full 调研）的调研阶段（Phase 1a + 1b）总耗时减少 40% 以上（对比当前串行执行）。
- **SC-003**: Story 模式和 Fix 模式的验证闭环阶段同样实现并行化，耗时减少 30% 以上。
- **SC-004**: 并行化后生成的所有制品（spec.md、plan.md、tasks.md、verification-report.md 等）质量不低于串行执行的产出——通过 GATE_VERIFY 的通过率不下降。
- **SC-005**: 当并行调度失败时，100% 的情况能成功回退到串行模式并完成流程，无流程中断。
- **SC-006**: 变更范围严格限制在 5 个 SKILL.md 文件内（speckit-feature、speckit-story、speckit-fix、speckit-doc、speckit-sync），其中 Doc 和 Sync 仅需确认无需修改。

---

## Clarifications

### Session 2026-02-27

#### 澄清 1: verify 与 spec-review/quality-review 的依赖关系

**问题**: 验证闭环中 verify 子代理在现有 SKILL.md 里接收 spec-review/quality-review 报告路径作为输入，而 spec 描述三者"无数据依赖"可完全并行——两者存在矛盾。

**自动解决**: [AUTO-CLARIFIED: parallel(spec-review, quality-review) → verify 串行]

采用 `parallel(spec-review, quality-review) → verify → GATE_VERIFY` 依赖链。spec-review 和 quality-review 并行执行，verify 在两者完成后串行启动并读取两者报告。理由：

- 与现有 SKILL.md prompt 设计兼容，不降低 verify 检查深度
- 可获验证阶段约 50% 加速（对比完全串行的三次调用）
- User Story 1 验收标准"执行时间窗口重叠"仍满足（7a/7b 确实并行）
- VERIFY_GROUP 实体定义已同步更新

#### 澄清 2: FR-006 并行调度失败的检测机制

**问题**: Claude Code Task tool 在运行时无法程序化区分"并行调度失败"与"子代理业务失败"，两者均表现为 Task 返回错误，spec 未定义如何区分。

**自动解决**: [AUTO-CLARIFIED: 编排器 LLM 语义判断回退]

FR-006 的回退触发由编排器 LLM 根据上下文语义判断，不要求精确的程序化错误分类。正常的子代理业务失败（如代码编译错误、验证失败）仍由现有重试机制（FR-010）处理；仅当编排器判断异常属于"调度层级"问题（如多个 Task 同时不可用、rate limit 导致无法启动并行 Task）时才触发串行回退。FR-006 实现为 prompt 层指令语义，与现有重试机制互补。
