---
title: Feature 089 实现规划 - SKILL.md 编排拆分与 orchestration.yaml 提取
feature_id: 089
version: 1.0
created: 2026-04-06
status: planning
---

# Feature 089 实现规划：SKILL.md 编排拆分与 orchestration.yaml 提取

## 总体策略

Feature 089 通过 **三阶段递进式工作流**，将 spec-driver 7 种模式的编排行为从 SKILL.md 中完全解耦，形成配置驱动的统一编排器。

### 三阶段划分

| 阶段 | 工作内容 | 工期 | 关键产物 | 风险等级 |
|-----|--------|------|--------|--------|
| **阶段 1：配置提取** | 从 SKILL.md 反向设计、提取编排元数据，构造 orchestration.yaml 数据模型 | 1-2 天 | orchestration.yaml 完整定义 | **中** |
| **阶段 2：编排器统一** | 新建 Orchestrator 类，改造 7 种 SKILL.md 为配置加载器 + 条件分发器 | 1 天 | orchestrator.js + 7 个 SKILL.md 适配 | **中** |
| **阶段 3：兼容性验证** | 7 种模式逐一验证，smoke test 全覆盖，确保向后兼容 | 1-2 天 | 验证报告 + test 脚本 | **中** |

**总工期**：3-5 天（3 个工作周期，可并行准备测试框架）

---

## 架构设计

### 1. 数据模型：orchestration.yaml 的结构设计

#### 为什么选择 YAML 而非 JSON

| 维度 | YAML | JSON |
|-----|------|------|
| 可读性 | 天然支持缩进和注释 | 需要序列化格式 |
| 编辑体验 | 易于手工编写和修改 | 需要工具支持 |
| 扩展性 | 支持 anchor & alias（复用） | 无原生复用机制 |
| 维护成本 | 可直接写入版本库 | 配置驱动时易产生冗余 |

**决策**：YAML 是配置驱动的首选格式，可读性和可维护性都优于 JSON。

#### orchestration.yaml 的核心块结构

```
version: "1.0"              # 配置版本，兼容性检查
parallel_scheduling: {...} # 全局并行调度策略
gates: {...}               # 5 个核心 + 1 个新 Gate 定义（共 6 个）
parallel_groups: {...}     # 3+ 个并行组定义
modes:                      # 7 种模式 + refactor 模板
  feature: {...}
  story: {...}
  implement: {...}
  fix: {...}
  resume: {...}
  sync: {...}
  doc: {...}
  # refactor: {...}         # 注释化模板，Feature 093 参考
```

**预期行数**：~350 行（包含注释和示例）

### 2. Orchestrator 加载器的设计

#### 初始化流程（位置：`lib/orchestrator.js`，~300-400 行）

```
┌─────────────────────────────────────────────────┐
│ 1. Load orchestration.yaml + Schema 校验       │
│    - 读取 plugins/spec-driver/config/orch.yaml  │
│    - 校验 version、gates、modes 必填字段       │
│    - 失败降级到内置默认配置，记录警告 warn()   │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│ 2. 提取当前 Mode 的 Phase 序列                  │
│    - 从 modes[mode].phases 读取数组             │
│    - 构建 Phase ID → 元数据的映射表             │
│    - 预处理 conditional 和 skip_if_exists      │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│ 3. 构建 Gate 行为表（优先级决策）              │
│    优先级：user_config > hard_gate > policy    │
│    - 读取 gates.* 的默认行为                    │
│    - 应用 hard_gate_modes 约束                 │
│    - 合并 user_config.gates 覆盖               │
│    - 返回 gate_id → {behavior, severity}      │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│ 4. 建立并行组的成员映射                         │
│    - 从 parallel_groups.* 读取 members         │
│    - 绑定 convergence_point（汇合点）          │
│    - 绑定 fallback_to_serial（串行降级配置）  │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│ 5. 返回 OrchestratorConfig 对象                │
│    供 SKILL.md 迭代执行 Phase 循环             │
└─────────────────────────────────────────────────┘
```

#### Phase 执行循环（SKILL.md 中的伪代码）

```javascript
// SKILL.md 的新核心流程
async function executeFeature(description, config) {
  // 初始化编排器（调用 orchestrator.js）
  const orchestrator = new Orchestrator(config, 'feature');
  const phases = orchestrator.getPhases();

  for (const phase of phases) {
    // 1. 检查制品跳过
    if (phase.skip_if_exists && fileExists(phase.skip_if_exists)) {
      trace.log(`跳过 Phase: ${phase.display_name} (制品已存在)`);
      continue;
    }

    // 2. 执行前置 Gate（always/auto 模式）
    const preGatesPass = await executeGates(phase.gates_before);
    if (!preGatesPass) {
      await handleGateFailure(phase, 'before');
      continue;
    }

    // 3. 执行 Phase 对应的 Agent（支持并行组）
    if (phase.agent_mode === 'parallel_group') {
      // 并行调度：同时发出 N 个 task 调用，汇合点前等待
      const results = await Promise.allSettled(
        phase.agent.map(agent => callAgent(agent, context))
      );
      // 降级检查：若并行失败且配置允许，回退到串行
      if (hasFailures(results) && shouldFallbackToSerial()) {
        trace.log(`并行降级: ${phase.display_name}`);
        // 串行重试逻辑
      }
    } else {
      // 单 Agent 执行
      await callAgent(phase.agent, context);
    }

    // 4. 写入 trace.md（统一格式）
    trace.log(`✅ Phase ${phase.id}: ${phase.display_name}`);

    // 5. 执行后置 Gate（always 模式，可能失败停止）
    const postGatesPass = await executeGates(phase.gates_after);
    if (!postGatesPass && isAlwaysGate()) {
      await handleGateFailure(phase, 'after');
      break; // 停止流程
    }
  }

  // 生成最终报告
  await generateVerificationReport();
}
```

### 3. Gate 优先级解析规则（关键设计决策）

当需要确定一个 Gate 的执行行为时，采用以下**四层优先级**（从高到低）：

```
优先级 1: user_config.gates[gate_id].behavior
  ↓ (若用户未配置)
优先级 2: hard_gate_modes 约束
  ├─ 若当前 mode 在 hard_gate_modes 中，behavior 固定为 always
  └─ 否则继续下层
  ↓
优先级 3: gate_policy 映射
  ├─ strict   → 所有 Gate behavior 都是 always
  ├─ balanced → critical Gate 是 always，non_critical 是 auto
  └─ autonomous → 所有 Gate 是 auto（除非 always 被明确指定）
  ↓
优先级 4: 全局默认值（gates.*.default_behavior）
```

**为什么这样设计**：
- **优先级 1** 尊重用户的显式配置（契约）
- **优先级 2** 保护关键流程（feature 模式的门禁不可绕过）
- **优先级 3** 提供易用的整体风险权衡（gate_policy）
- **优先级 4** 确保无配置时仍有合理默认

---

## 分阶段详细规划

### 阶段 1：配置提取（1-2 天）

**目标**：设计完整的 orchestration.yaml 数据模型，定义所有 7 种模式的编排元数据。

#### 1.1 反向工程现有 SKILL.md（~4 小时）

**工作内容**：
- 逐个审阅 7 种 SKILL.md，识别：
  - **Phase 定义**：各模式的执行顺序、条件判断（conditional 表达式）
  - **Gate 调用**：每个 Phase 的前置/后置 Gate 及其行为（always/auto/on_failure）
  - **并行组**：哪些 Phase 能并行执行，汇合点在哪，降级策略是什么
  - **制品跳过**：skip_if_exists 的模式（如 spec.md、plan.md 存在时跳过）

**关键发现**：
- feature 模式：10 个 Phase，3 个并行组（RESEARCH、DESIGN、VERIFY）
- story 模式：5-6 个 Phase（subset of feature）
- implement 模式：2-3 个 Phase + GATE_IMPLEMENT_MID（Feature 090）
- fix/resume/sync/doc：各 1-3 个 Phase，大多无并行

**输出**：数据结构设计文档（markdown），列出所有 Phase、Gate、并行组的元数据

#### 1.2 创建 orchestration.yaml 骨架（~2 小时）

**工作内容**：
- 新建文件 `plugins/spec-driver/config/orchestration.yaml`
- 填充顶层结构（version, parallel_scheduling, gates）
- 定义 6 个 Gate（包括 GATE_IMPLEMENT_MID）

**关键决策**：
- **Gate 分类**：按 type 分为 research_checkpoint、design_checkpoint、quality_analysis、task_generation、verification_checkpoint、implementation_checkpoint
- **Severity 属性**：critical vs non_critical，影响 hard_gate 和 gate_policy 的决策

#### 1.3 逐模式定义 Phase 序列（~4-6 小时）

**工作内容**：
- 为 7 种模式各定义 phases 数组，每个 Phase 包含：
  - id、name、display_name
  - agent（单个或数组）、agent_mode（single / parallel_group）
  - gates_before、gates_after
  - conditional（条件表达式，如 `research_mode == full`）
  - skip_if_exists（制品路径）
  - is_critical（关键 Phase，失败则停止）

**预期结果**：
- feature: 10-12 个 Phase
- story: 5-6 个 Phase
- implement, fix, resume, sync, doc: 各 1-5 个 Phase

#### 1.4 定义并行组和降级策略（~2 小时）

**工作内容**：
- 定义 parallel_groups.RESEARCH_GROUP、DESIGN_PREP_GROUP、VERIFY_GROUP
- 每个并行组包含：
  - members：Phase ID 或 Agent 列表
  - convergence_point：汇合点的 Phase ID
  - fallback_strategy：serial 或 skip
  - max_concurrent：最大并发数

**示例**：
```yaml
parallel_groups:
  RESEARCH_GROUP:
    members: [product_research, tech_research]
    convergence_point: research_summary
    fallback_strategy: serial
    max_concurrent: 2
```

#### 1.5 向后兼容的降级配置（~1 小时）

**工作内容**：
- 预留 fallback_config 块，定义 orchestration.yaml 缺失时的内置默认行为
- 设计 ValidationSchema，支持增量校验（必填 vs 可选）

**输出**：
- 完整的 `orchestration.yaml` 文件（~350 行）
- 包含 feature、story、implement、fix、resume、sync、doc 7 种模式
- 包含 6 个 Gate、3 个并行组、refactor 模板（注释）

**验收条件**：
- ✅ orchestration.yaml 按 Schema 格式正确
- ✅ 7 种模式的 Phase 序列完整且可追溯到现有 SKILL.md
- ✅ 文档顶部包含修改指南和 Feature 093 参考

---

### 阶段 2：编排器统一（1 天）

**目标**：实现 Orchestrator 类，改造 SKILL.md 为瘦身的加载器。

#### 2.1 编写 Orchestrator 类（~3-4 小时）

**位置**：`plugins/spec-driver/lib/orchestrator.js`

**工作内容**：
- **加载和校验**：
  ```javascript
  class Orchestrator {
    constructor(config, mode) {
      this.config = config;
      this.mode = mode;
      this.yaml = this.loadOrchestrationYaml();
      this.validateSchema();
      this.buildGateBehaviorMap();
      this.buildPhaseMap();
      this.buildParallelGroupMap();
    }
  }
  ```

- **核心方法**：
  - `getPhases(mode)`：返回当前模式的 Phase 序列
  - `getGateBehavior(gateId)`：返回 Gate 的执行行为（考虑用户配置、hard_gate、policy）
  - `getParallelGroupMembers(groupId)`：返回并行组的成员和汇合点
  - `evaluateConditional(expr, context)`：评估条件表达式
  - `resolveAgent(agentName)`：解析 Agent 路径

- **降级处理**：
  - 若 orchestration.yaml 缺失，加载内置默认配置
  - 若 Schema 校验失败，记录 warn 并使用最接近的默认值

**代码行数目标**：300-400 行（包含注释）

#### 2.2 改造 spec-driver-feature/SKILL.md（~2-3 小时）

**当前结构**：
- 1,000+ 行，包含：硬编码的 Phase 定义、条件判断、并行逻辑、Gate 调用

**新结构**：
- ~200-300 行，仅包含：
  - Prompt 指令（"你是 spec-driver-feature 代理，任务是..."）
  - 上下文注入逻辑（project-context 解析、suggestions 合并）
  - 调用 Orchestrator 的初始化代码（~30-40 行）
  - Phase 循环的分发逻辑（~50-80 行，大部分已在 Orchestrator 中）

**改造步骤**：
1. 提取现有 Phase 硬编码定义，验证与 orchestration.yaml 一致
2. 删除硬编码的 Phase 定义、条件判断、并行逻辑
3. 用 `await orchestrator.executeNextPhase()` 或类似模式替代
4. 保留 Prompt 指令和上下文注入（这些是 SKILL 特有的）
5. 补充必要的 error handling 和降级逻辑

**预期行数**：1,000 → 700-800（保守估计）

#### 2.3 改造其他 6 种 SKILL.md（~2-3 小时）

**模式**：story、implement、fix、resume、sync、doc

**工作内容**：
- 逐一应用与 spec-driver-feature 相同的改造模式
- 去掉各自的硬编码 Phase 定义
- 用 Orchestrator 加载对应模式的配置
- 保留各自的 Prompt 指令和特有逻辑

**预期效果**：
- spec-driver-story：590 → 400-450 行
- spec-driver-implement：600 → 450-500 行
- spec-driver-fix、resume、sync、doc：各减少 100-200 行

#### 2.4 集成配置验证和错误处理（~1-2 小时）

**工作内容**：
- 添加 orchestration.yaml 的 Schema 校验脚本（可复用的 validator）
- 改进 SKILL.md 的错误信息（若加载失败，清晰提示原因）
- 补充 trace.md 记录（Phase 启停、Gate 决策、并行事件）

**输出**：
- ✅ `lib/orchestrator.js`（300-400 行）
- ✅ 7 种 SKILL.md 改造完成（总行数不增长）
- ✅ 配置验证脚本（可独立运行）

**验收条件**：
- ✅ Orchestrator 能正确加载 orchestration.yaml
- ✅ 7 种 SKILL.md 均成功集成 Orchestrator
- ✅ Phase 序列与原有行为一致（需人工审查或简单测试）

---

### 阶段 3：兼容性验证与测试（1-2 天）

**目标**：确保 7 种模式的执行行为不变，smoke test 全通过，并确认向后兼容。

#### 3.1 准备 Smoke Test 框架（~2-3 小时）

**位置**：`test/smoke/orchestration.test.js`

**测试场景**（至少 7 个）：

| 场景 | 模式 | 输入 | 验证项 | 预期 |
|-----|------|------|--------|------|
| S1 | feature | 新的特性描述 | Phase 顺序、Gate 决策、trace.md | ✅ Phase 按 orchestration.yaml 执行 |
| S2 | story | 已有 spec.md | Phase 跳过（spec.md）、Gate 行为 | ✅ 检测到制品并跳过 |
| S3 | implement | 已有 tasks.md | 实现流程、GATE_IMPLEMENT_MID 触发 | ✅ 中期门禁正确启动 |
| S4 | fix | 缺陷描述 | 独立的 Phase 序列 | ✅ 执行 fix 模式的 Phase |
| S5 | resume | 中断恢复 | 继续执行 | ✅ 从检查点恢复 |
| S6 | sync | 配置同步 | 多个 spec 聚合 | ✅ 同步逻辑正确 |
| S7 | doc | 文档生成 | 输出格式和完整性 | ✅ 生成标准文档 |

**测试代码架构**：
```javascript
describe('Orchestrator Smoke Tests', () => {
  describe('feature mode', () => {
    it('should execute phases in correct order', async () => {
      const result = await runSkillTest('feature', {
        description: 'Add new feature...'
      });
      expect(result.phases).toMatch(orchestrationConfig.feature.phases);
      expect(result.trace).toContain('Phase 1', 'Phase 2', ...);
    });
  });
  // 其他 6 种模式类似...
});
```

#### 3.2 准备单元测试（Orchestrator 逻辑）（~2-3 小时）

**位置**：`test/unit/orchestrator.test.js`

**测试覆盖**：
- Schema 校验（有效 / 无效配置）
- Gate 优先级解析（4 层优先级的组合）
- Phase 条件评估（conditional 表达式）
- 并行组成员查询和降级逻辑
- 向后兼容降级（orchestration.yaml 缺失）

**示例**：
```javascript
describe('Gate behavior resolution', () => {
  it('should apply user_config > hard_gate > policy > default', () => {
    const behavior = orchestrator.getGateBehavior('GATE_DESIGN', {
      mode: 'feature',
      user_config: { gates: { GATE_DESIGN: { behavior: 'auto' } } },
      gate_policy: 'strict'
    });
    expect(behavior).toBe('auto'); // user_config 优先
  });
});
```

#### 3.3 执行 Smoke Test（~3-4 小时）

**工作内容**：
- 逐一运行 7 个场景
- 记录每个场景的 trace.md 和输出
- 对比现有行为（基准测试）
- 确认无回归

**成功标准**：
- ✅ 7 个场景全部通过
- ✅ trace.md 格式一致
- ✅ Phase 序列和 Gate 决策与预期一致
- ✅ 降级逻辑在异常情况下正确触发

#### 3.4 向后兼容性检查（~1-2 小时）

**检查清单**：
- ✅ 现有的 spec-driver.config.yaml（包含 gates 覆盖和 gate_policy）继续有效
- ✅ 用户现有的 Feature 执行结果不改变
- ✅ 若删除 orchestration.yaml，SKILL.md 能自动降级，仍能完成流程（警告日志）
- ✅ 文件行数减少（orchestration.yaml ~350，SKILL.md 总计不增长）

**具体验证**：
```bash
# 测试 1：保留现有配置，执行 feature 流程
spec-driver-feature "测试特性" --config my-old-config.yaml

# 测试 2：删除 orchestration.yaml，检查降级行为
rm plugins/spec-driver/config/orchestration.yaml
spec-driver-feature "测试特性"
# 预期：warn 日志 + 使用内置默认配置 + 流程正常完成

# 测试 3：检查文件行数
wc -l orchestration.yaml plugins/spec-driver/skills/*/SKILL.md
```

#### 3.5 文档更新（~1-2 小时）

**工作内容**：
- 更新 `docs/contributor-guide.md`：修改 Gate 行为时优先修改 orchestration.yaml
- orchestration.yaml 顶部添加示例注释：如何添加新模式
- 更新 CHANGELOG：Feature 089 的内容

**输出**：
- ✅ 所有 smoke test 通过，结果记录在 test report
- ✅ Unit test 覆盖关键逻辑，100% 通过
- ✅ 向后兼容性验证完成，无回归
- ✅ 文档更新完毕

**验收条件**：
- ✅ 7 种模式的 smoke test 全部通过（或 ≥2 种完整通过，其他验证方式）
- ✅ Gate 优先级和 hard_gate_modes 的 unit test 存在
- ✅ 并行调度降级的 integration test 存在
- ✅ 无新的 lint 或 test 失败

---

## 关键设计决策详解

### 决策 1：orchestration.yaml 的单一版本 vs 多版本

**选项 A**：单一 orchestration.yaml，所有模式共享一个配置文件
**选项 B**：按模式分裂，每个 SKILL.md 配套一个 orch-{mode}.yaml

**选择**：**选项 A（单一版本）**

**原因**：
- **聚合管理**：集中式修改，避免 7 个文件之间的同步债
- **复用性**：parallel_groups 和 gates 定义在多个模式间有共性，单文件便于复用
- **Feature 093 就绪**：新增 refactor 模式时，仅需在同一文件中补充 1 块配置，无需创建新文件

---

### 决策 2：Gate 优先级的四层模型

**选项 A**：Gate 优先级只有 hard_gate_modes 和 gate_policy 两层
**选项 B**：引入 user_config 显式覆盖，形成四层优先级

**选择**：**选项 B（四层优先级）**

**原因**：
- **灵活性**：用户可精细控制单个 Gate（如仅在当前任务中跳过 GATE_VERIFY）
- **向后兼容**：现有的 spec-driver.config.yaml 的 gates 覆盖能继续有效
- **易用性**：gate_policy 提供粗粒度控制，user_config 提供细粒度控制，满足不同用户需求

**优先级设计**：
```
user_config.gates[gateId].behavior
  ↓ (未指定)
hard_gate_modes[mode].includes(gateId) ? 'always' : ...
  ↓ (非 hard_gate)
gate_policy → {strict: 'always', balanced: 'auto', autonomous: 'auto', ...}
  ↓ (无 policy)
gates[gateId].default_behavior
```

---

### 决策 3：Phase 复用 vs 独立定义

**选项 A**：各模式的 Phase 定义完全独立
**选项 B**：使用 YAML anchor & alias，复用公共 Phase 定义

**选择**：**选项 B（YAML anchor & alias）**

**原因**：
- **减少冗余**：feature、story、implement 都有类似的 `specify`、`plan`、`tasks` 阶段，可共享定义
- **易于维护**：修改公共 Phase（如 GATE_DESIGN 的默认行为）只需修改一处
- **可读性**：alias 明确指出哪些 Phase 是继承的，哪些是独有的

**示例**：
```yaml
# 定义公共 Phase（anchor）
_common_phases:
  specify: &specify_phase
    name: specify
    agent: specify
    gates_after: [GATE_DESIGN]

modes:
  feature:
    phases:
      - <<: *specify_phase
        id: 6
      ...
  story:
    phases:
      - <<: *specify_phase
        id: 3
      ...
```

---

### 决策 4：Feature 093 (refactor 模式) 的扩展策略

**选项 A**：在 Feature 089 完全实现 refactor 模式的配置和 SKILL.md
**选项 B**：在 Feature 089 中仅预留 refactor 模式的配置骨架，SKILL.md 由 Feature 093 负责

**选择**：**选项 B（预留骨架，Feature 093 实现）**

**原因**：
- **单一职责**：Feature 089 专注于编排拆分，Feature 093 专注于 refactor 模式的定义
- **演进友好**：orchestration.yaml 中有清晰的注释化模板，Feature 093 易于参考
- **最小化风险**：不过度设计，确保 089 的核心目标清晰

**骨架设计**（在 orchestration.yaml 中）：
```yaml
# refactor 模式配置（Feature 093 指引）
# 删除下方的注释符，定义 Phase 序列
# refactor:
#   name: "Refactor Mode (Feature 093)"
#   description: "重构驱动工作流"
#   phases:
#     - id: 1
#       name: analyze_refactor_scope
#       ...
```

---

## 工作时间线与关键路径

### Gantt 图（工作时间线）

```mermaid
gantt
    title Feature 089 实现时间线
    dateFormat YYYY-MM-DD

    section 阶段 1：配置提取
    反向工程（~4h)           :s1a, 2026-04-07, 1d
    创建骨架（~2h)           :s1b, 2026-04-07, 1d
    Phase定义（~4-6h)        :s1c, 2026-04-08, 1d
    并行组配置（~2h)         :s1d, 2026-04-09, 1d
    降级配置（~1h)           :s1e, 2026-04-09, 1d

    section 阶段 2：编排器统一
    Orchestrator 类（~3-4h)  :s2a, 2026-04-09, 1d
    feature SKILL改造（~2-3h):s2b, 2026-04-10, 1d
    其他6种SKILL改造（~2-3h) :s2c, 2026-04-10, 1d
    集成校验（~1-2h)         :s2d, 2026-04-11, 1d

    section 阶段 3：兼容性验证
    Smoke Test框架（~2-3h)   :s3a, 2026-04-11, 1d
    Unit Test覆盖（~2-3h)    :s3b, 2026-04-12, 1d
    执行测试（~3-4h）        :s3c, 2026-04-12, 1d
    向后兼容检查（~1-2h)     :s3d, 2026-04-13, 1d
    文档更新（~1-2h）        :s3e, 2026-04-13, 1d

    section 关键路径
    CP: 阶段1完成->阶段2->阶段3  :crit, cp, 2026-04-07, 2026-04-13
```

### 关键路径分析

**关键路径（CP）**：
```
反向工程 → Phase定义 → 并行配置 → Orchestrator实现
  → SKILL改造 → Smoke Test → 兼容性验证
```

**工期**：**3-5 个工作日**（理想情况 3 天，含风险缓冲 2 天）

| 里程碑 | 日期 | Slack |
|-------|------|-------|
| 阶段 1 完成（orchestration.yaml 定稿） | 2026-04-09 | 0 天（CP） |
| 阶段 2 完成（7 个 SKILL.md 集成） | 2026-04-11 | 0 天（CP） |
| 阶段 3 完成（smoke test 全通过） | 2026-04-13 | 0 天（CP） |

**Slack 分析**：
- 阶段 3 可与阶段 2 后半段并行（提前准备 test 框架），节省 0.5-1 天
- 单元测试和烟雾测试可并行执行，进一步压缩时间

---

## 风险与缓解策略

### 1. 技术风险

#### 风险 1-1：7 种模式的完全兼容性验证（风险等级：中）

**具体风险**：
- 某个模式（如 fix 或 resume）在改造后出现行为偏差
- orchestration.yaml 的配置与实际 SKILL.md 逻辑不匹配，导致 Phase 跳过或重复执行

**影响**：功能回归，用户体验下降

**缓解策略**：
- **提前录基准测试**：Feature 089 实现前，对 7 种模式各录制 1 个参考 trace.md（使用现有代码）
- **逐个验证**：改造完成后，用相同输入重新运行，逐行对比 trace.md（Phase ID、Gate 决策）
- **双人审查**：orchestration.yaml 的 Phase 定义由另一位工程师双人审查，确保无遗漏

---

#### 风险 1-2：Gate 优先级和 hard_gate_modes 的逻辑错误（风险等级：中）

**具体风险**：
- 四层优先级的实现有 bug，导致 user_config 被忽略或 hard_gate 被绕过
- hard_gate_modes 的约束在某个模式中失效

**影响**：流程行为不可预测，安全隐患（hard_gate 被绕过）

**缓解策略**：
- **为 getGateBehavior() 编写单元测试**，覆盖所有 16 种优先级组合（4 层 × 4 个关键 Gate）
- **单独部署**：Orchestrator 的 Gate 优先级逻辑在主 code review 时单独审查，确保无逻辑漏洞
- **A/B 测试**：在 dev 环境中，同时运行新旧编排器，对比 Gate 决策结果

---

#### 风险 1-3：orchestration.yaml 的 Schema 校验不够严格（风险等级：低）

**具体风险**：
- 格式错误或缺失字段的 orchestration.yaml 被加载，但校验失败时无清晰错误提示
- 自动降级到内置默认配置，但用户不知道自己的配置被忽略了

**影响**：调试困难，用户困惑

**缓解策略**：
- **Schema 定义详细**：使用 Zod 或 JSONSchema 定义完整的 Schema，包括所有必填字段和类型约束
- **错误信息清晰**：校验失败时，明确输出缺失的字段和正确的格式示例
- **降级日志显眼**：降级到内置配置时，使用 console.warn() 输出醒目的警告信息，并建议用户修复

---

### 2. 工作量风险

#### 风险 2-1：Phase 定义的提取时间超期（风险等级：中）

**具体风险**：
- 现有 7 个 SKILL.md 中的 Phase 定义逻辑复杂，条件判断和并行调度涉及多层嵌套
- 反向工程花费超预期（可能 6-8 小时而非 4 小时）

**影响**：阶段 1 延期，后续阶段受影响

**缓解策略**：
- **提前分工**：将 7 个 SKILL.md 分配给 2-3 人，并行反向工程，每人负责 2-3 个文件
- **准备参考资料**：找出现有的 Feature 的 plan.md 或设计文档，加快上下文理解
- **时间卡口**：若反向工程在 4 小时内未完成 50%，立即召开同步会，识别卡点

---

#### 风险 2-2：7 种 SKILL.md 的改造耗时超期（风险等级：中）

**具体风险**：
- 某个 SKILL.md 与 Orchestrator 的集成出现适配问题，需要多轮修改
- 边界情况的处理（如条件表达式的求值、并行降级逻辑）需要额外编码

**影响**：阶段 2 延期，可能压缩测试时间

**缓解策略**：
- **模板化改造**：编写改造模板（如 SKILL.md 的标准结构 + Orchestrator 调用方式），7 个文件按模板改造，减少差异
- **持续集成**：每改造完 1 个 SKILL.md，立即运行快速 smoke test，及早发现适配问题
- **并行改造**：改造 spec-driver-feature 后，立即分配其他 6 个文件给不同工程师，并行改造

---

#### 风险 2-3：测试覆盖不足，遗漏关键场景（风险等级：中）

**具体风险**：
- Smoke test 仅覆盖 2-3 种模式（feature、story），遗漏 fix、resume、sync、doc 的验证
- 特殊场景（如并行降级、条件表达式无法求值）未被测试

**影响**：线上出现隐藏 bug

**缓解策略**：
- **最小测试集**：确保 feature、story、implement 3 种模式的完整 smoke test；其他 4 种可使用快速集成测试（仅验证 Phase 加载和 Gate 优先级）
- **场景清单**：提前列出所有需要测试的场景（见阶段 3 的 smoke test 表），按优先级划分（P0 必做、P1 尽力、P2 可选）
- **自动化测试**：编写 test template，支持快速添加新场景

---

### 3. 集成风险

#### 风险 3-1：与 Feature 090/091/092 的集成冲突（风险等级：低）

**具体风险**：
- GATE_IMPLEMENT_MID（Feature 090）的配置与 orchestration.yaml 冲突
- sync 合并算法（Feature 091）的脚本路径与 Orchestrator 的 Agent 解析不兼容
- config-schema.mjs（Feature 092）的验证规则与 orchestration.yaml 的 Schema 不一致

**影响**：集成失败，需要返工

**缓解策略**：
- **依赖检查**：确认 090/091/092 的实现已合并到 master，获取最新的 spec 和代码
- **提前协调**：与负责 090/091/092 的工程师同步，确认接口定义（如 GATE_IMPLEMENT_MID 的适用模式、脚本路径）
- **集成测试**：在改造 SKILL.md 时，同时测试与 090/091/092 的交互（如 GATE_IMPLEMENT_MID 是否正确触发）

---

## 依赖与前置条件

### 对其他 Feature 的依赖

| Feature | 状态 | 依赖类型 | 说明 |
|---------|------|--------|------|
| Feature 090（GATE_IMPLEMENT_MID） | ✅ 已完成 | 硬依赖 | GATE_IMPLEMENT_MID 的定义和实现必须在 orchestration.yaml 中正确配置 |
| Feature 091（sync 合并算法确定性化） | ✅ 已完成 | 软依赖 | 若使用 sync 模式，需要正确引用 Feature 091 的脚本 |
| Feature 092（配置体验 + 跨 Feature 守护） | ✅ 已完成 | 软依赖 | config-schema.mjs 的验证规则需要与 orchestration.yaml 的 Schema 协调 |

### 项目级前置条件

| 条件 | 状态 | 说明 |
|-----|------|------|
| Constitution v2.2.0 已发布 | ✅ 已完成 | 确保 PRINCIPLE III YAGNI 已纳入，指导 orchestration.yaml 的设计 |
| master 分支可构建 | ✅ 待确认 | 执行 npm run repo:check，确认无 lint/build 错误 |
| 7 个 SKILL.md 的当前测试全通过 | ✅ 待确认 | 改造前的基准测试应全部通过，作为对标 |

### 执行前的准备清单

- ✅ Clone 最新的 master，切换到 feature 分支 `feature/089-skill-orchestration-split`
- ✅ 运行 `npm run repo:check`，确认无错误
- ✅ 确认 090/091/092 的代码已在 master 中
- ✅ 为 7 个 SKILL.md 各录制一份参考 trace.md（基准测试）
- ✅ 分配工作：指定阶段 1 和阶段 2 的负责人

---

## 验收标准与质量指标

### 对应 Spec 的验收标准

| Spec 验收标准 | 实现路径 | 完成检查 |
|-------------|--------|--------|
| **1. orchestration.yaml 存在且完整** | 阶段 1.5 | ✅ 文件 + 7 种模式 + 6 个 Gate + 3 个并行组 |
| **2. SKILL.md 正确加载 orchestration.yaml** | 阶段 2.1-2.3 | ✅ 7 个 SKILL.md 均集成 Orchestrator |
| **3. 行为一致性验证** | 阶段 3.3 | ✅ Smoke test 对标基准测试 |
| **4. 向后兼容性验证** | 阶段 3.4 | ✅ user_config 继续有效、降级逻辑正确 |
| **5. 文件行数减少** | 阶段 2 完成后 | ✅ orchestration.yaml ~350 行、SKILL 总计无增长 |
| **6. 文档与示例** | 阶段 3.5 | ✅ docs 更新 + orchestration.yaml 顶部注释 |
| **7. 测试覆盖** | 阶段 3.1-3.2 | ✅ Schema test + smoke test (≥2 种模式) + unit test + integration test |

### 关键质量指标

| 指标 | 目标 | 验证方法 |
|------|------|--------|
| orchestration.yaml Schema 有效性 | 100% | 运行 Schema 校验脚本 |
| Smoke test 通过率 | ≥ 85% (5/7 种模式) | 手动或自动运行 test suite |
| 行为一致性 | Phase 序列和 Gate 决策与基准对标 | Trace.md 逐行对比 |
| 代码覆盖率（Orchestrator） | ≥ 90% | 运行 coverage report |
| 文件行数 | orchestration.yaml ~350 行、SKILL 总计不增长 | wc -l |
| 零新的 lint 错误 | 0 | npm run lint |

---

## 后续工作与延伸

### 立即后续（Feature 090/091/092 确认集成后）

1. **验证 Feature 090/091/092 的集成**
   - 确认 GATE_IMPLEMENT_MID 在 orchestration.yaml 中正确配置
   - 确认 sync 脚本路径在 Orchestrator 中正确解析
   - 确认 config-schema.mjs 与 orchestration.yaml 的 Schema 一致

2. **更新 Constitution 和共享规范**
   - 更新 Constitution 中关于 orchestration.yaml 的最佳实践
   - 为 Feature 093 (refactor 模式) 准备参考资料

### 中期工作（Feature 093）

- Feature 093 实现 refactor 模式时，仅需在 orchestration.yaml 中补充 refactor 块配置
- refactor 模式的 SKILL.md 由 Feature 093 负责编写
- 无需修改 Feature 089 的 Orchestrator 核心代码

### 长期演进方向

1. **配置驱动的深化**：
   - 支持 orchestration.yaml 的热重载（不重启 agent 可更新编排配置）
   - 支持多套编排配置（如 strict/balanced/autonomous），用户可快速切换

2. **监控和可观测性**：
   - Phase 执行时间统计
   - Gate 决策频率分析
   - 并行调度的效率评估

3. **编排图的可视化**：
   - 生成 Phase DAG（有向无环图）可视化
   - 支持交互式编排调试工具

---

## 附录：关键代码片段与模板

### A1. orchestration.yaml 的数据模型（简化版）

```yaml
version: "1.0"

# 全局并行调度策略
parallel_scheduling:
  max_concurrent_tasks: 3
  fallback_to_serial_on_failure: true
  fallback_reason_log: true

# 门禁定义（6 个 Gate）
gates:
  GATE_RESEARCH:
    type: research_checkpoint
    applicable_modes: [feature]
    severity: non_critical
    default_behavior: auto

  GATE_DESIGN:
    type: design_checkpoint
    applicable_modes: [feature, story, implement, fix, resume, sync, doc]
    severity: critical
    default_behavior: always
    hard_gate_modes: [feature]  # feature 模式下不可覆盖

  GATE_ANALYSIS:
    type: quality_analysis
    applicable_modes: [feature, implement]
    severity: non_critical
    default_behavior: on_failure

  GATE_TASKS:
    type: task_generation
    applicable_modes: [feature, story, implement, fix, resume, sync, doc]
    severity: critical
    default_behavior: always

  GATE_IMPLEMENT_MID:
    type: implementation_checkpoint
    applicable_modes: [implement]
    severity: non_critical
    default_behavior: on_failure
    insertion_point: "after_task_50_percent"

  GATE_VERIFY:
    type: verification_checkpoint
    applicable_modes: [feature, story, implement, fix, resume, sync, doc]
    severity: critical
    default_behavior: always

# 并行组定义
parallel_groups:
  RESEARCH_GROUP:
    members: [product_research, tech_research]
    convergence_point: research_summary
    fallback_strategy: serial
    applicable_condition: "research_mode == full"

  DESIGN_PREP_GROUP:
    members: [clarify, checklist]
    convergence_point: plan
    fallback_strategy: serial
    applicable_condition: "all"

  VERIFY_GROUP:
    members: [verify_acceptance, generate_report]
    convergence_point: null
    fallback_strategy: serial
    applicable_condition: "all"

# Mode 定义（仅 feature 示例）
modes:
  feature:
    name: "Spec-Driven Development（完整流程）"
    description: "包含调研、规范、规划、实现、验证 10 个阶段"
    phases:
      - id: 1
        name: constitution_check
        display_name: 检查项目宪法
        agent: null
        gates_before: []
        gates_after: []
        is_critical: false

      - id: 2
        name: research_mode_determination
        display_name: 确定调研模式
        agent: null
        gates_before: []
        gates_after: []
        is_critical: false

      # ... 其他 Phase 定义

      - id: 6
        name: specify
        display_name: 需求规范
        agent: specify
        gates_before: []
        gates_after: [GATE_DESIGN]
        is_critical: true
        skip_if_exists: "spec.md"

      # ... 更多 Phase
```

### A2. Orchestrator 类的初始化伪代码

```javascript
class Orchestrator {
  constructor(config, mode) {
    this.config = config;
    this.mode = mode;

    // 1. 加载和校验 orchestration.yaml
    try {
      this.yaml = this.loadOrchestrationYaml();
      this.validateSchema(this.yaml);
    } catch (error) {
      console.warn(`[WARN] orchestration.yaml 加载失败: ${error.message}`);
      console.warn(`[WARN] 自动降级到内置默认配置`);
      this.yaml = this.getBuiltinDefaults();
    }

    // 2. 提取当前 Mode 的 Phase 序列
    this.phases = this.extractPhases(mode);

    // 3. 构建 Gate 行为表（应用优先级）
    this.gateBehaviors = this.buildGateBehaviorMap();

    // 4. 建立并行组映射
    this.parallelGroups = this.buildParallelGroupMap();
  }

  // 获取当前 Mode 的 Phase 序列
  getPhases(mode) {
    return this.phases;
  }

  // 根据优先级确定 Gate 的行为
  getGateBehavior(gateId, userConfig, gatePolicy) {
    // 优先级 1: user_config
    if (userConfig?.gates?.[gateId]?.behavior) {
      return userConfig.gates[gateId].behavior;
    }

    // 优先级 2: hard_gate_modes
    const gate = this.yaml.gates[gateId];
    if (gate?.hard_gate_modes?.includes(this.mode)) {
      return 'always';
    }

    // 优先级 3: gate_policy
    const policyMap = {
      strict: 'always',
      balanced: gate.severity === 'critical' ? 'always' : 'auto',
      autonomous: 'auto'
    };
    if (gatePolicy && policyMap[gatePolicy]) {
      return policyMap[gatePolicy];
    }

    // 优先级 4: 全局默认
    return gate?.default_behavior || 'auto';
  }

  // 获取并行组成员
  getParallelGroupMembers(groupId) {
    return this.parallelGroups[groupId];
  }

  // 评估条件表达式
  evaluateConditional(expr, context) {
    // 简单实现（可根据需要扩展）
    return eval(expr.replace(/\b(research_mode|all)\b/g, `context.$1`));
  }
}
```

### A3. SKILL.md 的改造模板（简化版）

```markdown
## Spec-Driver Feature 模式

你是 Spec-Driver Feature 代理。任务：...

[Prompt 指令部分保持不变]

---

## 编排执行（由 Orchestrator 驱动）

[初始化代码]
const orchestrator = new Orchestrator(config, 'feature');
const phases = orchestrator.getPhases();

[Phase 循环]
for (const phase of phases) {
  // 检查制品跳过
  if (phase.skip_if_exists && fileExists(phase.skip_if_exists)) {
    trace.log(`⏭️  Phase ${phase.id}: ${phase.display_name} (已有制品)`);
    continue;
  }

  // 执行前置 Gate
  for (const gateId of phase.gates_before) {
    const behavior = orchestrator.getGateBehavior(gateId, userConfig, gatePolicy);
    await executeGate(gateId, behavior);
  }

  // 调用 Agent
  if (phase.agent_mode === 'parallel_group') {
    // 并行调度
    await executeParallel(phase.agent);
  } else {
    // 单 Agent 执行
    await callAgent(phase.agent);
  }

  // 执行后置 Gate
  // ...
}
```

---

## 总结

Feature 089 通过 **三阶段递进式**的工作流，将编排行为完全配置化：

1. **阶段 1**：反向工程现有 SKILL.md，设计 orchestration.yaml（~350 行）
2. **阶段 2**：实现 Orchestrator 类（~300-400 行），改造 7 个 SKILL.md 为配置加载器
3. **阶段 3**：全面测试和验证，确保零回归

**核心收益**：
- ✅ 消除 7 个 SKILL.md 间 60%+ 的重复代码
- ✅ 编排行为改为配置驱动，修改 orchestration.yaml 即可（无需改 SKILL.md）
- ✅ Feature 093 (refactor 模式) 仅需补充配置，无需修改核心代码
- ✅ 提升可维护性和扩展性

**工期**：3-5 个工作日（CP 上无并行空间，但可提前准备 test 框架）

