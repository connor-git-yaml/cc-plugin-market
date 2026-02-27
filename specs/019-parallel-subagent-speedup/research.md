# 技术决策研究: Parallel Subagent Speedup

**Feature**: 019-parallel-subagent-speedup
**Date**: 2026-02-28
**Status**: 完成

---

## Decision 1: 并行调度机制选择

### 问题

Claude Code Task tool 支持多种并行方式，需确定最佳的并行调度策略。

### 结论

**采用"同一消息中发出多个 Task 调用"模式**，即在编排 prompt 中明确指示编排器在单次响应中同时发起多个 Task tool calls。

### 理由

1. **Claude Code 原生支持**: Claude 的 function calling 机制允许在单个 assistant 消息中发出多个 tool calls，这些 tool calls 会被并行执行
2. **Prompt 层实现**: 通过在 SKILL.md 的编排指令中写明"在同一消息中同时调用以下 Task"，编排器 LLM 将遵循指令同时发出多个 Task calls
3. **无需 `run_in_background`**: 虽然 `run_in_background: true` 也能实现后台并行，但同消息多 Task 调用更直接、更符合编排器的工作模式——一次委派、等待所有完成后处理结果
4. **回退简单**: 如果编排器未能在同一消息中发出多个 Task（如因上下文限制分多次输出），自然降级为串行，不会导致错误

### 替代方案

| 方案 | 优点 | 缺点 | 弃用原因 |
|------|------|------|----------|
| `run_in_background: true` | 明确的后台执行语义 | 需要额外的轮询/等待逻辑，编排 prompt 更复杂 | 增加 prompt 复杂度，且不保证编排器能正确管理异步状态 |
| 纯串行保持 | 无变更风险 | 无加速效果 | 不满足需求 |
| 混合模式（部分 background + 部分同消息） | 灵活 | prompt 逻辑分裂，不一致 | 维护成本高，容易出错 |

---

## Decision 2: VERIFY_GROUP 依赖链设计

### 问题

验证闭环中 spec-review、quality-review、verify 三个子代理是否能完全并行？还是存在数据依赖？

### 结论

**采用 `parallel(spec-review, quality-review) -> verify -> GATE_VERIFY` 依赖链**。spec-review 和 quality-review 并行执行，verify 在两者完成后串行启动。

### 理由

1. **现有 SKILL.md 分析**: 在三个模式的验证阶段中，verify（Phase 7c/5c/4c）的 prompt 均包含 "7a/7b 报告路径"/"5a/5b 报告路径"/"4a/4b 报告路径" 作为输入，表明 verify 依赖前两者的输出
2. **verify 子代理职责**: verify 执行"工具链验证 + 验证证据核查"，其中"验证证据核查"需要对 spec-review 和 quality-review 的报告进行二次确认
3. **加速效果仍显著**: spec-review 和 quality-review 并行可将验证阶段的前半段耗时缩减约 50%，总验证阶段耗时减少约 33%（2 个串行变 1 个并行 + 1 个串行）
4. **与 spec.md FR-001 一致**: spec 已在澄清阶段确认了此依赖链设计

### 替代方案

| 方案 | 优点 | 缺点 | 弃用原因 |
|------|------|------|----------|
| 三者完全并行 | 最大加速 | verify 丧失对前两者报告的检查能力，降低验证深度 | 违背 Constitution 原则 XI（验证铁律） |
| 完全串行保持 | 无风险 | 无加速 | 不满足需求 |

---

## Decision 3: RESEARCH_GROUP 并行化下的 tech-research 输入变更

### 问题

当前 full 模式下 tech-research 串行依赖 product-research（接收 product-research.md 路径作为输入）。并行化后 tech-research 将无法获得 product-research.md，如何处理？

### 结论

**tech-research 在并行模式下以独立模式运行（不传入 product-research.md 路径）**，与 tech-only 模式行为一致。

### 理由

1. **已有先例**: tech-only 模式已经证明 tech-research 子代理可以在不依赖 product-research.md 的情况下独立产出有价值的技术调研结果
2. **质量保障**: Phase 1c（产研汇总）作为汇合点，由编排器亲自读取两份独立报告后执行交叉分析，弥补并行执行时两者之间缺乏交互的信息损失
3. **与 spec.md FR-004 一致**: spec 明确要求并行模式下的 tech-research 以独立模式运行
4. **SKILL.md 中已有分支逻辑**: 现有 speckit-feature SKILL.md 的 Phase 1b 已有 "full 模式下传入 product-research.md"与"tech-only/custom 模式下独立执行"的分支，并行化只需将 full 模式归入"独立执行"分支

### 替代方案

| 方案 | 优点 | 缺点 | 弃用原因 |
|------|------|------|----------|
| 等待 product-research 完成再启动 tech-research | 信息更丰富 | 无法并行，违背需求 | 与并行化目标矛盾 |
| product-research 输出中间摘要供 tech-research 参考 | 部分信息共享 | 实现复杂，需修改子代理 prompt | 违背 FR-008（不修改子代理 prompt） |

---

## Decision 4: 并行失败回退机制

### 问题

如何检测并行调度失败？如何实现串行回退？

### 结论

**采用编排器 LLM 语义判断的 prompt 级回退指令**。在 SKILL.md 中添加"如果并行调度失败则按串行顺序执行"的指令，由编排器 LLM 根据上下文判断是否需要回退。

### 理由

1. **Claude Code Task tool 限制**: Task tool 不提供可编程区分"调度失败"与"业务失败"的接口，两者均表现为 Task 返回或错误
2. **Prompt 层适配**: 编排器本身是 LLM，能理解"如果无法同时发出多个 Task，请按顺序执行"的语义指令
3. **与现有重试机制互补**: 正常的子代理业务失败仍由现有重试机制处理（retry_count / max_retries），回退仅针对调度层级问题
4. **与 spec.md FR-006 一致**: spec 已在澄清阶段确认此设计

### 替代方案

| 方案 | 优点 | 缺点 | 弃用原因 |
|------|------|------|----------|
| 编程化检测（try-catch 风格） | 精确错误分类 | Prompt 层无法实现 try-catch，过度复杂化 | 技术不可行 |
| 始终串行，并行作为可选 opt-in | 最安全 | 不满足加速需求 | 需求要求默认并行 |

---

## Decision 5: DESIGN_PREP_GROUP 的汇合策略

### 问题

clarify 和 checklist 并行时，如果 clarify 发现 CRITICAL 问题需要用户交互，如何处理？

### 结论

**等待两者都完成后再统一处理**。编排器等待 clarify 和 checklist 两个 Task 都完成，然后统一评估结果，再决定是否进入 GATE_DESIGN。

### 理由

1. **简化编排逻辑**: 无论 clarify 结果如何，都等待 checklist 完成，避免"提前中断一个 Task"的复杂控制流
2. **信息更完整**: 用户在看到 CRITICAL 问题时，同时也能看到 checklist 的完整结果，做出更全面的决策
3. **与 spec.md 验收标准一致**: User Story 3 验收场景 2 明确要求"编排器等待 checklist 也完成后，统一向用户展示"

### 替代方案

| 方案 | 优点 | 缺点 | 弃用原因 |
|------|------|------|----------|
| clarify CRITICAL 时立即中断 checklist | 快速暂停 | 信息不完整，用户可能需要 checklist 结果辅助决策 | 违背 US3 验收标准 |

---

## Decision 6: `--rerun` 与并行组的交互

### 问题

如果用户使用 `--rerun` 重跑并行组中的单个子代理（如 `--rerun spec-review`），是否触发整组并行？

### 结论

**单个子代理粒度重跑，不触发整组并行**。`--rerun` 以子代理为最小单元，不因其属于并行组而触发组内其他子代理。

### 理由

1. **与 spec.md FR-013 一致**: spec 明确要求 `--rerun` 以单个子代理为粒度
2. **用户意图明确**: 用户指定重跑某个子代理时，不期望触发其他不相关的子代理
3. **实现简单**: 现有 `--rerun` 机制按阶段名匹配，并行组概念对 `--rerun` 透明

### 替代方案

无显著替代方案，此为唯一合理选择。

---

## Decision 7: 完成报告中的并行标注格式

### 问题

如何在完成报告中标注哪些阶段使用了并行执行？

### 结论

**在完成报告的阶段完成列表中，使用 `[并行]` 标签标注并行执行的阶段**。

### 理由

1. 与 spec.md FR-007 一致
2. 简洁直观，不改变现有报告结构
3. 回退时使用 `[回退:串行]` 标注，区分正常串行和回退串行

### 格式示例

```text
阶段完成: 10/10（含 0 个已跳过步骤）
执行模式:
  Phase 7a/7b: [并行] spec-review + quality-review
  Phase 7c: [串行] verify（依赖 7a/7b 报告）
```
