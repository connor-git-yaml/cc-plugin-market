# orchestration.yaml 数据模式文档

## 顶层结构

```yaml
version: "1.0"                    # 配置版本（字符串），用于兼容性检查

parallel_scheduling:              # 全局并行调度配置
  max_concurrent_tasks: 3         # 最大并发 Task 数（整数，1-5）
  fallback_to_serial_on_failure: true  # 并行失败时回退到串行（布尔）
  fallback_reason_log: true       # 是否记录回退原因（布尔）

gates: {...}                      # Gate 全局定义（见下文）

parallel_groups: {...}            # 并行组定义（见下文）

modes: {...}                      # 7 种模式的 Phase 序列定义（见下文）
```

---

## 详细字段定义

### 1. parallel_scheduling 块

```yaml
parallel_scheduling:
  max_concurrent_tasks: 3
  # 说明：一次最多并行执行的 Task 数量
  # 类型：整数
  # 范围：1-5（推荐 2-3）
  # 用途：控制并行度，平衡并发和上下文压力

  fallback_to_serial_on_failure: true
  # 说明：当任一并行 Task 失败时，是否自动回退到串行执行
  # 类型：布尔
  # true（推荐）：失败后回退，确保完整性
  # false：失败立即中断整个流程

  fallback_reason_log: true
  # 说明：回退时是否输出详细原因日志
  # 类型：布尔
  # true（推荐）：便于调试和问题追溯
  # false：简化日志输出
```

---

### 2. gates 块

```yaml
gates:
  GATE_RESEARCH:
    type: research_checkpoint
    # 说明：Gate 的类型标签
    # 类型：字符串
    # 值：research_checkpoint / design_checkpoint / quality_analysis / task_generation /
    #    implementation_checkpoint / verification_checkpoint

    applicable_modes: [feature]
    # 说明：此 Gate 适用于哪些模式
    # 类型：列表
    # 值：feature / story / implement / fix / resume / sync / doc

    description: "调研完整性门禁"
    # 说明：Gate 的人类可读描述
    # 类型：字符串

    default_behavior: auto
    # 说明：Gate 的默认行为（当未被 policy 或 user_config 覆盖时）
    # 类型：字符串
    # 值：always（始终暂停）/ auto（自动继续）/ on_failure（失败时暂停）

    severity: non_critical
    # 说明：Gate 的严重级别（影响 gate_policy 应用）
    # 类型：字符串
    # 值：critical（关键，影响大）/ non_critical（非关键，可跳过）

    hard_gate_modes: []
    # 说明：此 Gate 在哪些模式下为硬门禁（不可被用户配置覆盖）
    # 类型：列表
    # 值：feature / story / implement / fix / resume / sync / doc
    # 示例：[feature] 表示在 feature 模式下此 Gate 始终 always，无法被配置覆盖

    insertion_point: null
    # 说明：Gate 的插入点（用于 GATE_IMPLEMENT_MID 等动态触发的 Gate）
    # 类型：字符串 | null
    # 值：after_task_50_percent / after_task_25_percent / ... 或 null
    # 示例：GATE_IMPLEMENT_MID 的 insertion_point 为 "after_task_50_percent"

  # 其他 Gate 定义同上（GATE_DESIGN, GATE_ANALYSIS, GATE_TASKS, GATE_IMPLEMENT_MID, GATE_VERIFY）
```

---

### 3. parallel_groups 块

```yaml
parallel_groups:
  RESEARCH_GROUP:
    members: [1a, 1b]
    # 说明：此并行组包含的 Phase ID（来自 modes.{mode}.phases[*].id）
    # 类型：列表
    # 值：Phase ID（通常为 1a, 1b, 3, 7a, 7b 等）

    convergence_point: "1c"
    # 说明：并行 Phase 汇合的地点（哪个 Phase 接收并行结果）
    # 类型：字符串（Phase ID）
    # 说明：此 Phase 会等待所有 members 完成后再执行

    fallback_strategy: serial_fallback
    # 说明：并行失败时的回退策略
    # 类型：字符串
    # 值：serial_fallback（回退到串行）/ fail_fast（立即失败）/ skip_group（跳过整个组）

    max_concurrent: 2
    # 说明：此并行组内允许的最大并发任务数
    # 类型：整数
    # 范围：1-5
    # 说明：会受到 parallel_scheduling.max_concurrent_tasks 的全局限制

  # 其他并行组定义同上（DESIGN_PREP_GROUP, VERIFY_GROUP 等）
```

---

### 4. modes 块

```yaml
modes:
  feature:
    name: "Spec-Driven Development（完整 10 阶段）"
    # 说明：此模式的人类可读名称
    # 类型：字符串

    description: "包含完整的调研、规范、规划、实现、验证流程"
    # 说明：此模式的长描述
    # 类型：字符串

    phases: [...]
    # 说明：此模式的 Phase 序列（数组）
    # 类型：列表
    # 元素类型：Phase 对象（见下文）
    # 说明：按执行顺序排列，编排器会按此顺序遍历并执行
```

---

### 5. Phase 对象（modes.{mode}.phases[*]）

```yaml
modes:
  feature:
    phases:
      - id: 1a
        # 说明：Phase 的唯一标识符
        # 类型：字符串
        # 格式：单数字（0-9）或 数字+字母（1a, 1b, 3.5）
        # 用途：在 parallel_groups 中被引用，也用于 skip_if_exists

        name: product_research
        # 说明：Phase 的机器可读名称
        # 类型：字符串
        # 格式：snake_case
        # 用途：日志、追踪和代码映射

        display_name: 产品调研
        # 说明：Phase 的人类可读名称（用户界面展示）
        # 类型：字符串
        # 用途：完成报告、进度提示中显示

        agent: product-research
        # 说明：此 Phase 对应的 Agent 名称
        # 类型：字符串 | null
        # 值：
        #   - Agent 名称（如 product-research, tech-research, specify, clarify 等）
        #   - null：此 Phase 由编排器内联执行，不委派 Agent
        # 例外：[clarify, quality_checklist] 表示此 Phase 内部并行执行两个 Agent

        agent_mode: single
        # 说明：此 Phase 的 Agent 执行模式
        # 类型：字符串
        # 值：
        #   single（默认）：单个 Agent 执行
        #   parallel_group：此 Phase 内部包含一个并行组（如 Phase 3 的 clarify+checklist）
        # 说明：若为 parallel_group，agent 字段应为列表 [agent1, agent2, ...]

        gates_before: []
        # 说明：此 Phase 执行前需要通过的 Gate 列表
        # 类型：列表
        # 元素类型：字符串（Gate ID）
        # 说明：编排器会在执行此 Phase 前检查这些 Gate，可能导致暂停或跳过

        gates_after: [GATE_RESEARCH]
        # 说明：此 Phase 执行后需要通过的 Gate 列表
        # 类型：列表
        # 元素类型：字符串（Gate ID）
        # 说明：编排器会在执行完此 Phase 后检查这些 Gate，可能导致暂停或重跑

        conditional: "research_mode in [full, product-only]"
        # 说明：此 Phase 的条件表达式（决定是否执行）
        # 类型：字符串 | null
        # 格式：简单表达式语言，支持：
        #   - 布尔条件：research_mode in [full, tech-only, ...]
        #   - 文件检查：file_exists(spec.md)
        #   - 组合：AND, OR 逻辑
        # 说明：null 表示始终执行

        skip_if_exists: "research/product-research.md"
        # 说明：若此文件已存在，则跳过此 Phase
        # 类型：字符串 | null
        # 用途：支持自适应入口检测，避免重复执行
        # 说明：路径相对于 {feature_dir}

        is_critical: false
        # 说明：此 Phase 是否为关键路径（影响 risk assessment）
        # 类型：布尔
        # true：此 Phase 失败会导致流程中断
        # false：此 Phase 失败可能被 fallback 处理

  story:
    # story 模式的 Phase 序列（预期 5-7 个）

  implement:
    # implement 模式的 Phase 序列（预期 5-6 个）

  fix:
    # fix 模式的 Phase 序列（预期 3-4 个）

  resume:
    # resume 模式的 Phase 序列（预期 3-4 个）

  sync:
    # sync 模式的 Phase 序列（预期 3-4 个）

  doc:
    # doc 模式的 Phase 序列（预期 3-4 个）

  # refactor:
  #   # refactor 模式模板（Feature 093 预留，暂时注释）
```

---

## 条件表达式语法

**支持的操作符**：

```
in [value1, value2, ...]    # 包含检查（research_mode in [full, tech-only]）
not in [...]                # 取反
file_exists(path)           # 文件存在检查
file_not_exists(path)       # 文件不存在检查
== / != / > / < / >= / <=   # 比较操作符（用于数值或枚举）
AND / OR                    # 逻辑组合（大写）
( )                         # 分组
```

**示例**：

```yaml
# 基本条件
conditional: "research_mode in [full, tech-only]"

# 文件检查
conditional: "file_exists(spec.md)"

# 组合条件
conditional: "research_mode in [full] AND file_not_exists(spec.md)"

# 无条件执行
conditional: null
```

---

## 向后兼容性和降级

### 缺失字段的默认值

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| version | string | "1.0" | 若缺失，假设为 1.0 |
| parallel_scheduling | object | {max_concurrent_tasks: 2, fallback_to_serial_on_failure: true, fallback_reason_log: true} | 若缺失，使用默认全局并行配置 |
| conditional | string | null | 若缺失，Phase 始终执行 |
| skip_if_exists | string | null | 若缺失，不跳过 |
| agent_mode | string | "single" | 若缺失，默认单 Agent 模式 |
| gates_before | list | [] | 若缺失，无前置 Gate |
| gates_after | list | [] | 若缺失，无后置 Gate |
| is_critical | boolean | false | 若缺失，默认非关键 |
| insertion_point | string | null | 若缺失，无动态插入点 |

### 配置验证失败时的降级

若 orchestration.yaml 校验失败或缺失，编排器自动加载内置 fallback 配置：

1. 输出 warn 日志："Using fallback orchestration config due to missing or invalid orchestration.yaml"
2. 加载最小化的 fallback 配置（见 T1.6 的 orchestrator-fallback.js）
3. 继续执行流程（确保向后兼容）

---

## 修改指南

### 新增 Phase

1. 在 modes.{mode}.phases 数组末尾添加新 Phase 对象
2. 填充所有必填字段（id, name, display_name, agent, gates_before, gates_after）
3. 若需条件执行，添加 conditional 字段
4. 若涉及并行，修改 parallel_groups 并添加 agent_mode: parallel_group
5. 更新 phase-inventory.md

### 新增 Gate

1. 在 gates 块中添加新 Gate 定义
2. 填充必填字段（type, applicable_modes, description, default_behavior, severity）
3. 若此 Gate 为硬门禁，设置 hard_gate_modes
4. 在相应 Phase 的 gates_before 或 gates_after 中引用此 Gate
5. 更新 gate-inventory.md

### 新增并行组

1. 在 parallel_groups 块中添加新并行组
2. 定义 members（Phase ID 列表）和 convergence_point
3. 设置 fallback_strategy 和 max_concurrent
4. 修改相应 Phase 的 agent_mode 和 agent 字段
5. 更新 parallel-groups-inventory.md

### 新增模式（如 Feature 093 的 refactor）

1. 在 modes 块中新增 refactor 块
2. 定义此模式的完整 Phase 序列
3. 列出此模式涉及的 Gate（使用 applicable_modes 过滤）
4. 若有并行组，补充到 parallel_groups 块
5. 在 orchestrator.js 中更新模式检查逻辑

---

## YAML 语法验证

**必填顶层字段**：
- version（字符串）
- modes（对象，包含至少 feature 模式）

**必填 Gate 字段**：
- type
- applicable_modes
- default_behavior

**必填 Phase 字段**：
- id（唯一性）
- name（蛇形，唯一性）
- agent（字符串或 null）
- gates_before
- gates_after

**可选字段**：
- conditional
- skip_if_exists
- is_critical
- agent_mode
- insertion_point

---

## 示例：Feature 模式的完整 Phase 序列

```yaml
modes:
  feature:
    name: "Spec-Driven Development（完整 10 阶段）"
    description: "包含完整的调研、规范、规划、实现、验证流程"
    phases:
      - id: 0
        name: constitution_check
        display_name: 项目宪法检查
        agent: null
        gates_before: []
        gates_after: []
        is_critical: false

      - id: 0.5
        name: research_mode_determination
        display_name: 调研模式确定
        agent: null
        gates_before: []
        gates_after: []
        is_critical: false

      - id: 1a
        name: product_research
        display_name: 产品调研
        agent: product-research
        gates_before: []
        gates_after: [GATE_RESEARCH]
        conditional: "research_mode in [full, product-only]"
        skip_if_exists: "research/product-research.md"
        is_critical: false

      # ... 其他 Phase ...

      - id: 7c
        name: verify
        display_name: 工具链验证+证据核查
        agent: verify
        gates_before: [GATE_RESEARCH]
        gates_after: [GATE_VERIFY]
        is_critical: true
```

