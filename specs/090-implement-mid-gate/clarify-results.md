---
feature: 090-implement-mid-gate
type: clarify-results
created: 2026-04-06
---

# 澄清结果: 090 实现中期门禁

## Q1: Feature 模式下 GATE_IMPLEMENT_MID 的 balanced 默认行为应该是什么？

**严重等级**: CRITICAL

**关联**: FR-006, FR-008, Scenario 3.2

**问题描述**: FR-006 定义了 GATE_IMPLEMENT_MID 在三种 gate_policy 下的默认行为：balanced 对应 `auto`，strict 对应 `always`，autonomous 对应 `on_failure`。但现有门禁体系中，Implement 模式和 Feature 模式对同一门禁的 balanced 默认值可以不同——例如 Feature 模式中 GATE_TASKS 和 GATE_VERIFY 在 balanced 下均为 `always`（关键门禁），而 GATE_RESEARCH 为 `auto`（非关键）。spec 只笼统说"balanced 默认 auto"，未区分 Implement 模式与 Feature 模式是否应使用相同默认值。Feature 模式的实施阶段（Phase 6）涉及更长的完整链路，GATE_IMPLEMENT_MID 若也默认 `auto` 可能过于宽松。

**选项**:

- **A) 两种模式统一使用 `auto`**：与 spec FR-006 字面一致，NFR-001 向后兼容性最好（balanced 时自动继续，无感知差异）。
- **B) Implement 模式 `auto`，Feature 模式 `on_failure`**：Feature 模式链路更长，仅在发现问题时才暂停，平衡效率与安全。
- **C) 两种模式统一使用 `on_failure`**：中期门禁本身就是为了拦截问题，`on_failure` 比 `auto` 更能体现其价值。

**推荐**: A。理由：FR-006 和 NFR-001 已明确 balanced 下行为为 `auto`，且 GATE_IMPLEMENT_MID 定位是"轻量级信号检测"而非关键决策门禁；两种模式统一 `auto` 保持简单，避免引入新的模式差异。

---

## Q2: EC-006 "本次 run 中实际需要执行的 task 数"如何精确定义？

**严重等级**: CRITICAL

**关联**: FR-002, FR-004, EC-006

**问题描述**: EC-006 规定"若 tasks.md 中已有部分 `[x]` 标记，编排器应基于'本次 run 中实际需要执行的 task 数'决定 50% 触发点和 <=5 跳过判断。已完成的 task 不计入分母"。但 spec 未明确"本次 run"的范围界定——implement SKILL.md 的 Step 6.5 自适应入口检测（检测已有制品并跳过阶段）在 implement 模式中是"扫描 tasks.md 中已有 `[x]`"来判断需执行的 task。问题是：

1. 分母是否为 `total_tasks - already_completed_tasks`（即仅未完成 task 数）？
2. 若分母为 3（12 个 task，已完成 9 个），是否仍触发门禁（3 <= 5 → 跳过）？这意味着大型 Feature 的后续 resume run 可能永远跳过门禁。

**选项**:

- **A) 分母 = 未完成 task 数，<=5 时跳过**：严格遵循 EC-006 字面描述。副作用：大型 Feature 的后续恢复运行中若剩余任务 <=5 则跳过门禁。
- **B) 分母 = 未完成 task 数，但 <=5 跳过判断使用 total_tasks**：50% 触发点基于剩余任务，但 <=5 跳过阈值基于 tasks.md 原始总数，避免大型 Feature 恢复时误跳。
- **C) 分母 = total_tasks（忽略已完成），始终基于总数计算**：最简单，但与 EC-006 矛盾。

**推荐**: A。理由：EC-006 的设计意图是"本次 run 只做剩余任务"，若剩余仅 3 个 task，确实不值得中途暂停检查。大型 Feature 的恢复场景中若只剩少量任务，中期门禁的价值也确实有限。保持逻辑一致性优先。

---

## Q3: Feature 模式下 GATE_IMPLEMENT_MID 应插入在哪个 Phase 位置？

**严重等级**: MODERATE

**关联**: FR-008, SC-004

**问题描述**: spec 对 Implement 模式描述了详细的 Phase 4a/GATE/4b 拆分结构（FR-001），但对 Feature 模式仅在 FR-008 中说"将 GATE_IMPLEMENT_MID 加入 Feature 模式门禁子集和行为表"。Feature 模式的实现阶段是 Phase 6（[9/10] 代码实现），其后紧跟 Phase 6.5（编排器独立验证）和 Phase 7（验证闭环 + GATE_VERIFY）。spec 未说明 Feature 模式是否也需要将 Phase 6 拆分为 6a/GATE/6b 结构，还是仅在门禁配置加载阶段将 GATE_IMPLEMENT_MID 加入行为表（使其可被配置），但实际拆分逻辑复用 Implement 模式的 implement 子代理调用。

**选项**:

- **A) Feature 模式也将 Phase 6 拆分为 6a/GATE_IMPLEMENT_MID/6b**：与 Implement 模式完全对称，Feature 模式同样获得中期门禁保护。
- **B) Feature 模式仅在门禁子集和行为表中注册 GATE_IMPLEMENT_MID，Phase 6 拆分逻辑与 Implement 模式共享相同的 implement 子代理 prompt 模板**：减少 Feature SKILL.md 的改动量——Feature 模式调用的是同一个 implement 子代理 prompt，拆分逻辑由 implement prompt 模板控制。
- **C) Feature 模式仅注册但不拆分 Phase**：GATE_IMPLEMENT_MID 在 Feature 模式下可被配置但不实际执行，保持 Feature SKILL.md 最小改动。

**推荐**: A。理由：Feature 模式的大型 Feature 恰恰是 GATE_IMPLEMENT_MID 的核心使用场景（>10 tasks 的完整研发流程）。仅注册不拆分会使门禁形同虚设，违背 User Story 1 的核心价值。

---

## Q4: Phase 4a implement 子代理的"前 N 个任务"如何传达？

**严重等级**: MODERATE

**关联**: FR-010, FR-011

**问题描述**: FR-010 要求 Phase 4a 的 implement 子代理 prompt 中"明确告知执行 tasks.md 中前 N 个任务后返回中间进度报告"。但 spec 未明确"前 N 个任务"是按 tasks.md 中的物理顺序（从上到下第 1~N 个 top-level checkbox），还是需要考虑任务间的依赖关系。tasks.md 中的任务可能存在依赖链——若前 N 个任务中第 3 个依赖第 7 个的输出，强制按物理顺序切割可能导致 4a 阶段无法完成。

**选项**:

- **A) 严格按物理顺序切割**：简单明确。tasks.md 本身应已按依赖顺序排列（这是 task refinement 阶段的职责），若出现依赖问题属于 tasks.md 质量问题而非门禁设计问题。
- **B) 在 prompt 中追加"按依赖顺序执行前 N 个可独立完成的任务"**：更灵活，但增加 prompt 复杂度，且"可独立完成"的判断全靠子代理自行裁定，可能导致实际完成数远偏离 N。
- **C) prompt 中传达"目标是完成约 50% 的任务后返回"，不硬性限定 N**：最灵活，但 50% 触发点变得不精确，与 FR-002 的 `floor(total_tasks * 0.5)` 精确计算矛盾。

**推荐**: A。理由：tasks.md 在 Phase 3（Task Refinement）中已经过依赖排序，按物理顺序切割是对任务分解质量的合理假设。FR-010 是 SHOULD 级别，实现时应在 prompt 中明确"执行 tasks.md 中前 N 个 top-level task（按文档顺序）"即可。

---

## Q5: GATE_IMPLEMENT_MID 检查发现问题后用户选择"修复后继续"的执行流程是什么？

**严重等级**: MODERATE

**关联**: FR-003, Scenario 1.2, FR-009

**问题描述**: Scenario 1.2 描述了门禁检查发现 CRITICAL 问题时，用户可选择"A) 修复后继续 | B) 强制继续 | C) 中止"。但 spec 未定义选项 A "修复后继续"的具体行为——修复动作由谁执行？是编排器暂停等待用户手动修复后重新触发，还是编排器调度子代理自动修复？修复完成后是重新执行 GATE_IMPLEMENT_MID 检查，还是直接进入 Phase 4b？这会直接影响 SKILL.md 中该段落的 prompt 编写。

**选项**:

- **A) 暂停等待用户手动修复，用户确认后重新执行 GATE_IMPLEMENT_MID 检查**：与 GATE_VERIFY 中"A) 修复重验"的模式一致——编排器不代替用户修复，只负责检查和报告。
- **B) 暂停等待用户手动修复，用户确认后直接进入 Phase 4b（不重新检查）**：减少一次检查循环，但用户可能修复不完整。
- **C) 编排器调度子代理自动修复后重新检查**：自动化程度最高，但超出"轻量级检查点"定位，且需要新的修复子代理 prompt。

**推荐**: A。理由：与现有 GATE_VERIFY 的"修复重验"模式保持一致（暂停 → 用户修复 → 重新检查），不引入新的修复子代理（符合 YAGNI），且 FR-009 明确"编排器亲自执行"，重新检查的成本很低。
