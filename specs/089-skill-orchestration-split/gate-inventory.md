# 反向工程清单 —— Gate 配置清单

## Gate 定义汇总

| Gate ID | Type | Applicable Modes | Default Behavior | Severity | Hard Gate Modes | 触发条件 | 前置/后置 Phase |
|---------|------|------------------|------------------|----------|-----------------|---------|-----------------|
| GATE_RESEARCH | research_checkpoint | [feature] | auto | non_critical | 无 | research_mode 非 skip 时，调研阶段完成后 | 前置: Phase 1d（在线调研）; 后置: Phase 2（需求规范） |
| GATE_DESIGN | design_checkpoint | [feature, story, implement, fix, resume, sync, doc] | always | critical | [feature] | 始终触发（spec.md 规范质量门禁） | 后置: Phase 3.5（需求澄清后） |
| GATE_ANALYSIS | quality_analysis | [feature, implement] | on_failure | non_critical | 无 | 一致性分析完成后 | 后置: Phase 5.5（analyze 后） |
| GATE_TASKS | task_generation | [feature, story, implement, fix, resume, sync, doc] | always | critical | 无 | 任务分解完成后，进入实现前 | 后置: Phase 5（tasks 生成后） |
| GATE_IMPLEMENT_MID | implementation_checkpoint | [implement] | on_failure | non_critical | 无 | 实现任务数 > 50% 时触发 | 内嵌: Phase 6（implementation 中期，insertion_point: after_task_50_percent） |
| GATE_VERIFY | verification_checkpoint | [feature, story, implement, fix, resume, sync, doc] | always | critical | 无 | 所有验证报告完成后 | 后置: Phase 7c（verify 后）|

---

## Gate 行为详解

### GATE_RESEARCH

**类型**：research_checkpoint

**职责**：调研完整性和质量检查

**触发时机**：Phase 1（调研阶段）完成后、Phase 2（需求规范）前

**行为表** (feature 模式):

| policy | Default Behavior | 行为说明 | 条件 |
|--------|------------------|--------|------|
| strict | always | 始终暂停，展示调研制品摘要，用户决策 | 无 |
| balanced | auto | 自动继续（仅记录摘要） | 无 |
| autonomous | on_failure | 检查 research_mode：skip 时自动继续；否则检查 online_research_required，若为 true 但无证据则暂停 | 无 |

**模式感知**：

- research_mode == "skip" → 输出 "SKIPPED | 调研模式为 skip"
- research_mode == "full" → 检查所有三个制品 (product-research.md, tech-research.md, research-synthesis.md)
- research_mode == "tech-only" → 仅检查 tech-research.md
- research_mode == "product-only" → 仅检查 product-research.md
- research_mode == "codebase-scan" → 检查代码上下文摘要（内嵌）
- online_research_required == true && research_skip_reason == "..." → 检查 online-research.md 及证据

**输出格式**：

```
[GATE] GATE_RESEARCH | policy={gate_policy} | mode={research_mode} | decision={PAUSE|AUTO_CONTINUE|SKIPPED} | reason={理由}
```

---

### GATE_DESIGN

**类型**：design_checkpoint

**职责**：需求规范（spec.md）的质量和完整性门禁

**触发时机**：Phase 3.5（需求澄清后）

**行为表**：

| Mode | Hard Gate? | Default Behavior | 覆盖可能? | 行为说明 |
|------|-----------|------------------|----------|---------|
| feature | YES | always | 否 | 强制暂停，不可覆盖（硬门禁） |
| story | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |
| implement | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |
| fix | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |
| resume | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |
| sync | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |
| doc | NO | always | 是 | 暂停展示 spec 摘要，用户决策 |

**输出格式**：

```
[GATE] GATE_DESIGN | mode={mode} | policy={gate_policy} | decision=PAUSE | reason={"硬门禁，feature 模式不可跳过" 或 "规范质量审核"}
```

---

### GATE_ANALYSIS

**类型**：quality_analysis

**职责**：spec.md + plan.md + tasks.md 的一致性分析门禁

**触发时机**：Phase 5.5（analyze 完成后）

**行为表**：

| behavior | 条件 | 暂停? | 说明 |
|----------|------|------|------|
| always | 无 | 是 | 始终展示发现和修复建议 |
| auto | 无 | 否 | 仅在日志中记录 |
| on_failure | 检查 analyze 报告 | 有 CRITICAL? 是:否 | 有 CRITICAL 则暂停；仅 WARNING 或零发现则自动继续 |

**输出格式**：

```
[GATE] GATE_ANALYSIS | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

---

### GATE_TASKS

**类型**：task_generation

**职责**：任务分解（tasks.md）的完整性和可行性门禁

**触发时机**：Phase 5（tasks 生成后）

**行为表**：

| behavior | 条件 | 暂停? | 说明 |
|----------|------|------|------|
| always | 无 | 是 | 暂停展示任务摘要（数量、并行机会、MVP 范围等） |
| auto | 无 | 否 | 仅在日志中记录摘要 |
| on_failure | 检查 tasks.md | 有问题? 是:否 | 有明显问题则暂停；否则自动继续 |

**输出格式**：

```
[GATE] GATE_TASKS | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

---

### GATE_IMPLEMENT_MID

**类型**：implementation_checkpoint

**职责**：实现中期检查（Feature 090），确保前半部分实现质量达标

**触发时机**：Phase 6（implement）执行到 50% 任务时

**行为表**：

| behavior | 条件 | 暂停? | 说明 |
|----------|------|------|------|
| on_failure | 检查前 50% 实现质量 | 有问题? 是:否 | 有问题则暂停；否则继续后 50% |
| auto | 无 | 否 | 仅记录日志 |
| always | 无 | 是 | 始终暂停，展示进度和质量数据 |

**insertion_point**：after_task_50_percent（在 tasks 数量达 50% 后触发）

**输出格式**：

```
[GATE] GATE_IMPLEMENT_MID | policy={gate_policy} | progress=50% | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

---

### GATE_VERIFY

**类型**：verification_checkpoint

**职责**：最终验证（spec 合规、代码质量、工具链）的综合门禁

**触发时机**：Phase 7c（verify 完成后），所有验证报告完成时

**行为表**：

| behavior | 条件 | 暂停? | 说明 |
|----------|------|------|------|
| always | 无 | 是 | 暂停展示三份报告合并结果，用户选择修复或接受 |
| auto | 无 | 否 | 仅在日志中记录结果 |
| on_failure | 检查报告 | 任一 CRITICAL? 是:否 | 有 CRITICAL 则暂停；仅 WARNING 或全通过则自动继续 |

**输出格式**：

```
[GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | reason={理由}
```

---

## 门禁优先级机制（Gate Priority）

**4 层优先级**：

1. **user_config**（最高）：用户在 spec-driver.config.yaml 中显式配置的覆盖值（gates.GATE_X.pause）
2. **hard_gate**：硬门禁（如 feature 模式下的 GATE_DESIGN）
3. **gate_policy**：全局策略（balanced/strict/autonomous）
4. **default_behavior**（最低）：各 Gate 定义中的默认行为

**解析顺序**：

```javascript
// orchestrator 中的伪代码
for (const gate of gates) {
  if (userConfig.gates[gate.id]?.pause) {
    // 1. 使用用户配置
    behavior = userConfig.gates[gate.id].pause;
  } else if (isHardGate(gate, currentMode)) {
    // 2. 硬门禁约束（可能覆盖用户配置，见下文）
    if (gate.id === 'GATE_DESIGN' && currentMode === 'feature') {
      behavior = 'always'; // 不可覆盖
    } else {
      behavior = getUserOrPolicyBehavior();
    }
  } else {
    // 3. 应用全局策略默认值
    behavior = getPolicyDefault(gate_policy, gate.id);
  }
}
```

**特殊规则**：

- GATE_DESIGN 在 feature 模式下不可被任何配置覆盖，始终为 always
- 其他硬门禁模式若用户配置，可覆盖（但不推荐）

---

## 修改指南

- 新增 Gate 时需在此清单和 orchestration.yaml 中同步定义
- 修改 Gate 行为时需同时更新 orchestration.yaml gates.{GATE_ID} 块
- 若引入新的 hard_gate_modes，需更新编排器中的硬门禁检查逻辑

