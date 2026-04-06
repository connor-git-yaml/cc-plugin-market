# 反向工程清单 —— 并行组定义清单

## 并行组汇总

| Group ID | 成员（Phase IDs） | 汇合点（Convergence Point） | 最大并发数 | 降级策略 | 适用模式 | 说明 |
|----------|-----------------|--------------------------|----------|---------|--------|------|
| RESEARCH_GROUP | [1a (product_research), 1b (tech_research)] | Phase 1c (research_synthesis) | 2 | serial_fallback | feature | 产品调研+技术调研并行，需研汇总 |
| DESIGN_PREP_GROUP | [clarify, quality_checklist] (Phase 3 内部) | GATE_DESIGN (Phase 3.5) | 2 | serial_fallback | feature | 需求澄清+质量检查并行 |
| VERIFY_GROUP | [7a (spec_review), 7b (quality_review)] | Phase 7c (verify) | 2 | serial_fallback | feature | 规范审查+代码质量审查并行 |

---

## 并行组详解

### RESEARCH_GROUP

**成员**：
- product-research (Phase 1a)
- tech-research (Phase 1b)

**汇合点**：Phase 1c (research_synthesis)

**适用条件**：
- 模式：feature 仅有
- research_mode 在 [full] 时触发

**调度策略**：

```
1. 触发条件检查：research_mode == 'full'
2. 在同一消息中同时发出两个 Task 调用：
   - Task(description: "产品调研", prompt: "{product-research prompt}" + context)
   - Task(description: "技术调研", prompt: "{tech-research prompt}" + context)
3. 使用 Promise.allSettled() 等待两个 Task 完成
4. 汇合点：Phase 1c 接收两个制品路径作为输入
```

**降级策略**（fallback_to_serial_on_failure）：

- 若无法在同一消息中发出两个 Task（如上下文/rate limit 限制）
- 回退到串行执行：先 product-research 完成，再 tech-research
- 串行模式下可选传入 product-research.md 路径给 tech-research（增加上下文）
- 在完成报告中标注 `[回退:串行] product-research, tech-research`

**并行失败处理**：

- 若两个 Task 中一个失败：不中断另一个，等待两者均完成，再统一处理失败
- 若两个 Task 均失败：回退到串行重试

**制品依赖**：

- 制品：research/product-research.md, research/tech-research.md
- Phase 1c 需两个制品均完成才能生成 research-synthesis.md

**完成报告标注**：

- 并行成功：`Phase 1a+1b [并行] product-research, tech-research`
- 并行回退：`Phase 1a+1b [回退:串行] product-research, tech-research`
- 任一失败：`Phase 1a+1b [失败] product-research 失败原因 / tech-research 失败原因`

---

### DESIGN_PREP_GROUP

**成员**：
- clarify (Phase 3 的子任务)
- quality_checklist (Phase 3 的子任务)

**汇合点**：GATE_DESIGN (Phase 3.5)

**适用条件**：
- 模式：feature
- 始终触发（非条件触发）

**调度策略**：

```
1. Phase 3 初始化，同时发出两个 Task 调用：
   - Task(description: "执行需求澄清", prompt: "{clarify prompt}" + context)
   - Task(description: "生成质量检查表", prompt: "{checklist prompt}" + context)
2. 使用 Promise.allSettled() 等待两个 Task 完成
3. 汇合点：GATE_DESIGN 接收两个报告（clarify.md, checklist.md）作为输入
```

**降级策略**（fallback_to_serial_on_failure）：

- 若无法同时发出两个 Task，回退到串行：先 clarify，再 quality_checklist
- 在完成报告中标注 `[回退:串行] clarify, quality_checklist`

**汇合处理逻辑**：

```javascript
// 两个 Task 均完成后
if (clarify.has_CRITICAL_issues) {
  // 展示 clarify 结果给用户，用户决策后重新调用 clarify
  show_clarify_results_to_user();
  // 同时展示 checklist 结果供参考
  show_checklist_results();
} else if (checklist.has_failed_items) {
  // 回到 specify/clarify 修复
  goto_phase_2_or_3();
} else {
  // 两者均正常，继续进入 GATE_DESIGN
  proceed_to_gate_design();
}
```

**制品依赖**：

- 制品：(在 spec.md 基础上) clarify.md, checklists/requirements.md
- GATE_DESIGN 需两个报告均完成

**完成报告标注**：

- 并行成功：`Phase 3 [并行] clarify, quality_checklist`
- 并行回退：`Phase 3 [回退:串行] clarify, quality_checklist`

---

### VERIFY_GROUP

**成员**：
- spec-review (Phase 7a)
- quality-review (Phase 7b)

**汇合点**：Phase 7c (verify)

**适用条件**：
- 模式：feature
- 始终触发（非条件触发）

**调度策略**：

```
1. Phase 7a+7b 初始化，同时发出两个 Task 调用：
   - Task(description: "Spec 合规审查", prompt: "{spec-review prompt}" + context)
   - Task(description: "代码质量审查", prompt: "{quality-review prompt}" + context)
2. 使用 Promise.allSettled() 等待两个 Task 完成
3. 汇合点：Phase 7c 接收两个报告作为输入
```

**降级策略**（fallback_to_serial_on_failure）：

- 若无法同时发出两个 Task，回退到串行：先 spec-review，再 quality-review
- 在完成报告中标注 `[回退:串行] spec-review, quality-review`

**汇合处理逻辑**：

```javascript
// 7a+7b 均完成后进入 7c
// 7c (verify) 接收两个报告路径，进行最终综合验证
// 生成 verification-report.md，合并三份报告结果
```

**制品依赖**：

- 制品：verification/spec-review.md, verification/quality-review.md, verification/verification-report.md (最终)
- Phase 7c 需 7a 和 7b 的报告才能生成最终报告

**完成报告标注**：

- 并行成功：`Phase 7a+7b [并行] spec-review, quality-review`
- 并行回退：`Phase 7a+7b [回退:串行] spec-review, quality-review`
- 7c 串行：`Phase 7c [串行] verify（依赖 7a/7b 报告）`

---

## 其他模式中的并行组

### Story 模式

[待扫描 story SKILL.md] 预期 0-1 个并行组

### Implement 模式

[待扫描 implement SKILL.md] 预期 0-1 个并行组（通常无）

### Fix/Resume/Sync/Doc 模式

[待扫描各模式 SKILL.md] 预期各 0 个并行组（通常无）

---

## 并行调度实现细节

### 消息级并行

**条件**：在同一 Claude assistant 消息中同时发出多个 Task 调用

```javascript
// SKILL.md 中的伪代码示例
const results = await Promise.all([
  Task(description: "产品调研", prompt: productResearchPrompt),
  Task(description: "技术调研", prompt: techResearchPrompt)
]);
```

**限制因素**：
- 单消息 function calling 数量限制（通常 10+）
- 单消息上下文大小限制
- Rate limit 对并行调用的影响

### 串行降级

**触发条件**：
- 无法在同一消息中发出多个 Task（上下文溢出、rate limit 等）

**执行方式**：
```javascript
// 回退方案：按顺序串行执行
for (const task of tasks) {
  const result = await Task(task);
  results.push(result);
}
```

**日志标注**：`[并行回退] {group_name} 无法并行调度，切换到串行模式`

### Fail-Fast 处理

**当前实现**：
- 不立即中止另一个并行任务
- 等待所有任务均完成，再统一处理失败

**监控逻辑**：
```javascript
const results = await Promise.allSettled([...]);
const failed = results.filter(r => r.status === 'rejected');
if (failed.length > 0) {
  // 统一处理所有失败，而非立即中止
}
```

---

## 修改指南

1. **新增并行组**：在 orchestration.yaml parallel_groups 块中添加条目
2. **修改汇合点**：需同时更新 Phase 定义中的依赖关系
3. **调整降级策略**：修改 fallback_strategy 字段，编排器自动应用
4. **扩展并发数**：修改 max_concurrent 字段（慎重，考虑上下文和 rate limit）

