---
title: Feature 089 任务清单 - SKILL.md 编排拆分与 orchestration.yaml 提取
feature_id: 089
version: 1.0
created: 2026-04-06
status: ready
---

# Feature 089 任务清单：SKILL.md 编排拆分与 orchestration.yaml 提取

## 总体概览

**总任务数**：18 个（分 3 个阶段）
**工期估计**：3-5 天
**关键路径**：T1.1 → T1.4 → T2.1 → T2.2 → T3.1 → T3.7（顺序依赖）
**可并行准备**：T3.1 的测试框架可在 T1 期间开始编写

### 阶段分布

| 阶段 | 任务数 | 关键交付物 | 工期 |
|-----|--------|-----------|------|
| **阶段 1：配置提取** | 6 个 | orchestration.yaml | 1-2 天 |
| **阶段 2：编排器统一** | 6 个 | orchestrator.js + 7 个 SKILL.md 改造 | 1 天 |
| **阶段 3：兼容性验证** | 6 个 | Smoke test 全通过 | 1-2 天 |

---

## 阶段 1：配置提取（6 个任务）

### T1.1 反向工程 feature SKILL.md 提取 Phase 定义 🔴

**标题**：反向工程现有 SKILL.md（提取 Phase 定义）
**工时估计**：4 小时
**依赖**：无
**负责方**：impl agent

**任务描述**：
通过逐行审阅 spec-driver-feature 和其他 6 种 SKILL.md，识别并记录：
- 各模式的完整 Phase 序列（执行顺序、条件判断）
- 每个 Phase 的属性：id、name、display_name、agent、conditional 表达式
- Phase 的跳过条件（skip_if_exists）和关键性标记（is_critical）

**成功标准**：
- [ ] 逐一审阅 7 个 SKILL.md，标注 Phase 定义位置（行号 + 代码块）
- [ ] 输出 `specs/089-skill-orchestration-split/phase-inventory.md`，列表格式包含：
  - 模式名、Phase ID、Phase 名称、Agent、条件表达式、跳过条件
- [ ] feature 模式：10-12 个 Phase 完整列出
- [ ] 其他 6 种模式的 Phase 序列独立编制（不超过 5 个 Phase/模式）
- [ ] 与 plan.md 的 Phase 设计对比，识别偏差或遗漏

---

### T1.2 反向工程 feature SKILL.md 提取 Gate 配置 🔴

**标题**：反向工程现有 SKILL.md（提取 Gate 配置）
**工时估计**：3 小时
**依赖**：T1.1（可并行开始）
**负责方**：impl agent

**任务描述**：
识别 SKILL.md 中的所有 Gate 调用，记录：
- 6 个 Gate 的定义：GATE_RESEARCH、GATE_DESIGN、GATE_ANALYSIS、GATE_TASKS、GATE_IMPLEMENT_MID、GATE_VERIFY
- 每个 Gate 的属性：type、applicable_modes、default_behavior、severity、hard_gate_modes
- 各 Gate 在 Phase 中的前置/后置执行位置

**成功标准**：
- [ ] 逐一梳理 7 个 SKILL.md 中的 Gate 调用，输出 `specs/089-skill-orchestration-split/gate-inventory.md`
- [ ] 表格格式包含：Gate ID、Type、Applicable Modes、Default Behavior、Severity、Hard Gate Modes
- [ ] 确认 feature 模式中的 5 个核心 Gate，implement 模式中的 GATE_IMPLEMENT_MID（Feature 090 参考）
- [ ] 记录各 Gate 与 Phase 的关联（前置 / 后置）

---

### T1.3 反向工程 feature SKILL.md 提取并行组定义 🔴

**标题**：反向工程现有 SKILL.md（提取并行组定义）
**工时估计**：2 小时
**依赖**：T1.1
**负责方**：impl agent

**任务描述**：
识别现有 SKILL.md 中的并行执行逻辑，定义并行组：
- RESEARCH_GROUP：product_research + tech_research 的并行
- DESIGN_PREP_GROUP：specify + clarify + checklist 的并行（可选）
- VERIFY_GROUP：其他模式的最终验证并行
- 每个并行组的汇合点（convergence_point）、降级策略（fallback_strategy）、最大并发数

**成功标准**：
- [ ] 输出 `specs/089-skill-orchestration-split/parallel-groups-inventory.md`
- [ ] 表格格式包含：Group ID、Members (Phase IDs)、Convergence Point、Fallback Strategy、Max Concurrent
- [ ] feature 模式中至少 2 个并行组确认（RESEARCH + DESIGN 或 RESEARCH + VERIFY）
- [ ] 其他模式是否存在并行组的记录（通常无，但需逐一确认）
- [ ] 降级逻辑的现有实现方式记录（串行重试 / 跳过 / 中止）

---

### T1.4 设计 orchestration.yaml 的数据模式

**标题**：设计 orchestration.yaml 的完整数据模式
**工时估计**：3 小时
**依赖**：T1.1、T1.2、T1.3
**负责方**：impl agent

**任务描述**：
基于前三个任务的反向工程输出，设计 orchestration.yaml 的数据结构：
- 定义顶层块：version、parallel_scheduling、gates、modes
- 确定 Phase 对象的完整字段集合
- 设计 Gate 对象的完整字段集合
- 设计 parallel_groups 的结构

**成功标准**：
- [ ] 输出 `specs/089-skill-orchestration-split/orchestration-schema.md`（Markdown 格式的 Schema 文档）
- [ ] 包含所有字段的定义、类型、必填/可选、示例值
- [ ] Phase 对象字段包含：id、name、display_name、agent、agent_mode、gates_before、gates_after、conditional、skip_if_exists、is_critical
- [ ] Gate 对象字段包含：type、applicable_modes、description、default_behavior、severity、hard_gate_modes、insertion_point（可选，用于 GATE_IMPLEMENT_MID）
- [ ] parallel_groups 对象字段包含：members、convergence_point、fallback_strategy、max_concurrent
- [ ] 设计文档包含修改指南和扩展方式（用于 Feature 093）

---

### T1.5 实现 orchestration.yaml（包含 7 种 Mode）

**标题**：实现完整的 orchestration.yaml 配置文件
**工时估计**：6 小时
**依赖**：T1.4
**负责方**：impl agent

**任务描述**：
创建并填充 `plugins/spec-driver/config/orchestration.yaml`，包含：
- version: "1.0"
- parallel_scheduling 全局配置（max_concurrent_tasks、fallback_to_serial_on_failure）
- 6 个 Gate 的完整定义（GATE_RESEARCH、GATE_DESIGN、GATE_ANALYSIS、GATE_TASKS、GATE_IMPLEMENT_MID、GATE_VERIFY）
- 3+ 个 parallel_groups 的定义
- 7 种 modes 的 Phase 序列（feature、story、implement、fix、resume、sync、doc）
- refactor 模式的模板（注释化，为 Feature 093 预留）

**成功标准**：
- [ ] `plugins/spec-driver/config/orchestration.yaml` 创建完成
- [ ] 文件大小 ~350 行（包含注释）
- [ ] YAML 语法有效（可用 YAML 验证工具检验）
- [ ] feature 模式的 Phase 序列完整（10-12 个）
- [ ] 所有 7 种模式均有对应的 modes 块
- [ ] 6 个 Gate 均已定义，applicable_modes 和 hard_gate_modes 正确映射
- [ ] parallel_groups 至少 3 个，每个均包含 members、convergence_point、fallback_strategy
- [ ] 文件顶部包含修改指南和示例（如何添加新模式）
- [ ] 文件末尾包含 refactor 模式的注释化模板

---

### T1.6 实现向后兼容的降级策略

**标题**：实现向后兼容的降级策略和验证机制
**工时估计**：2 小时
**依赖**：T1.5
**负责方**：impl agent

**任务描述**：
设计并实现当 orchestration.yaml 缺失或损坏时的降级逻辑：
- 编写 fallback 配置（内置默认值），包含最小化的 Phase 和 Gate 定义
- 编写 Schema 验证脚本，检查配置的有效性
- 定义错误处理和日志输出（warn / error 级别的区分）

**成功标准**：
- [ ] 创建 `plugins/spec-driver/lib/orchestrator-fallback.js`（~50-100 行），包含内置默认配置
- [ ] 实现 `validateOrchestrationYaml(config)` 函数，返回 { valid: boolean, errors: [], warnings: [] }
- [ ] fallback 配置包含：所有 7 种模式的最小 Phase 序列（1-2 个关键 Phase）、6 个 Gate、基本并行组
- [ ] 若 orchestration.yaml 缺失，自动加载 fallback，并输出 warn 级日志："Using fallback orchestration config due to missing or invalid orchestration.yaml"
- [ ] 若 orchestration.yaml 存在但校验失败，输出错误明细，建议修正步骤
- [ ] 验证脚本可独立运行：`node validate-orchestration.js plugins/spec-driver/config/orchestration.yaml`

---

## 阶段 2：编排器统一（6 个任务）

### T2.1 实现 Orchestrator 加载器初始化 🔴

**标题**：实现 Orchestrator 类的加载器初始化
**工时估计**：4 小时
**依赖**：T1.5、T1.6
**负责方**：impl agent

**任务描述**：
创建 `plugins/spec-driver/lib/orchestrator.js`，实现 Orchestrator 类的初始化逻辑：
- 构造函数：加载 orchestration.yaml + Schema 校验
- buildGateBehaviorMap()：建立 Gate ID → 执行行为的映射表（考虑 hard_gate、gate_policy）
- buildPhaseMap()：构建 Phase ID → 元数据的映射表
- buildParallelGroupMap()：构建并行组的成员和汇合点映射
- loadOrchestrationYaml()：读取并缓存配置文件
- validateSchema()：调用前面实现的验证函数

**成功标准**：
- [ ] `plugins/spec-driver/lib/orchestrator.js` 创建完成
- [ ] Orchestrator 类实现，包含上述 5 个私有方法
- [ ] 构造函数签名：`new Orchestrator(userConfig, mode, context)`，其中 context 是当前项目上下文
- [ ] 若 orchestration.yaml 不存在或校验失败，自动降级到 fallback 配置（warn 日志）
- [ ] 代码行数 150-200 行（含注释）

---

### T2.2 实现 Gate 优先级解析器

**标题**：实现 Gate 优先级解析器和行为决策引擎
**工时估计**：3 小时
**依赖**：T2.1
**负责方**：impl agent

**任务描述**：
实现 Orchestrator 的 Gate 优先级解析逻辑，按四层优先级确定 Gate 的执行行为：

1. user_config.gates[gate_id].behavior（用户显式配置）
2. hard_gate_modes 约束（当前 mode 在 hard_gate_modes 中 → behavior = always）
3. gate_policy 映射（strict / balanced / autonomous）
4. gates[gate_id].default_behavior（全局默认值）

添加到 Orchestrator 类的公共方法：
- `getGateBehavior(gateId, context)`：返回 { behavior, severity, reason }
- `isGateHardLocked(gateId, mode)`：检查当前 mode 是否硬锁此 Gate
- `applyGatePolicy(policy)`：根据 gate_policy 覆盖非 hard_gate 的 behavior

**成功标准**：
- [ ] 三个公共方法实现完整
- [ ] `getGateBehavior()` 返回对象包含：behavior (always/auto/on_failure/skip)、severity (critical/non_critical)、reason (优先级来源)
- [ ] hard_gate_modes 约束生效：feature 模式下 GATE_DESIGN、GATE_TASKS、GATE_VERIFY 不可绕过
- [ ] gate_policy 的三种模式正确实现：
  - strict：所有 critical Gate → always，non_critical → always
  - balanced：critical Gate → always，non_critical → auto
  - autonomous：所有 Gate → auto（除非被 user_config 或 hard_gate 覆盖）
- [ ] 优先级降级逻辑清晰（顺序测试，返回第一个非空值）
- [ ] 代码行数 100-150 行（含注释）

---

### T2.3 实现并行组调度器

**标题**：实现并行组的调度和降级逻辑
**工时估计**：3 小时
**依赖**：T2.1
**负责方**：impl agent

**任务描述**：
实现 Orchestrator 的并行组调度逻辑，添加公共方法：
- `getParallelGroupMembers(groupId)`：返回 { members, convergence_point, fallback_strategy, max_concurrent }
- `shouldParallelizeGroup(groupId, context)`：根据资源和配置判断是否执行并行
- `getParallelGroupFallbackStrategy(groupId)`：返回降级策略 (serial / skip)

实现"智能降级"逻辑：
- 若并行执行失败（≥1 个成员失败）且 fallback_strategy = serial，则自动重试为串行模式
- 记录降级事件到 trace.md（包含原因和降级策略）
- 支持条件性跳过并行组（如果并行不可用，自动跳转到 convergence_point）

**成功标准**：
- [ ] 三个公共方法实现完整
- [ ] `getParallelGroupMembers()` 返回正确的成员列表和汇合点
- [ ] 降级逻辑实现：并行失败 → 串行重试 或 跳过（取决于 fallback_strategy）
- [ ] 并行组不存在时返回 null，调用方自动降级为单 Phase 执行
- [ ] 代码行数 100-120 行（含注释）

---

### T2.4 改造 feature SKILL.md 为瘦身加载器 🔴

**标题**：改造 spec-driver-feature/SKILL.md 为瘦身加载器
**工时估计**：3 小时
**依赖**：T2.1、T2.2、T2.3
**负责方**：impl agent

**任务描述**：
改造现有 spec-driver-feature/SKILL.md：
- 删除硬编码的 Phase 定义、条件判断、并行逻辑（~400-500 行）
- 用 `await orchestrator.getPhases()` 和 `orchestrator.getGateBehavior()` 替代
- 保留 Prompt 指令、上下文注入逻辑、error handling
- 新增初始化代码（~30-40 行）：调用 Orchestrator 加载配置

改造步骤：
1. 在 SKILL.md 开头（Prompt 指令后）添加初始化块：
   ```javascript
   const { Orchestrator } = require('../lib/orchestrator');
   const orchestrator = new Orchestrator(config, 'feature', context);
   ```

2. 用统一的 Phase 循环替代原有的条件判断：
   ```javascript
   for (const phase of orchestrator.getPhases()) {
     // 执行制品检查、Gate 调用、Agent 分发
     await executePhase(phase, orchestrator, context);
   }
   ```

3. 保留上下文注入和 trace 记录逻辑

**成功标准**：
- [ ] spec-driver-feature/SKILL.md 行数从 1,000+ 降至 700-800（净减少 200+ 行）
- [ ] 硬编码的 Phase 定义完全移除，验证通过 grep 检查（不存在显式的 phase = { ... } 定义）
- [ ] Orchestrator 初始化代码正确，能成功加载 feature 模式的配置
- [ ] Prompt 指令和上下文注入逻辑保留无变化
- [ ] error handling 和 fallback 逻辑保留或增强
- [ ] 功能测试通过：调用 spec-driver-feature 时，Phase 执行顺序与改造前一致

---

### T2.5 改造其他 6 个模式的 SKILL.md 为瘦身加载器 🔴

**标题**：改造其他 6 种模式的 SKILL.md 为瘦身加载器
**工时估计**：4 小时
**依赖**：T2.4（参考改造模式）
**负责方**：impl agent

**任务描述**：
应用 T2.4 的改造模式到其他 6 种 SKILL.md：

- **spec-driver-story/SKILL.md**：Phase 序列 5-6 个，删除条件判断和并行逻辑
- **spec-driver-implement/SKILL.md**：Phase 序列 2-3 个，特别处理 GATE_IMPLEMENT_MID 的触发条件
- **spec-driver-fix/SKILL.md**：Phase 序列 1-2 个，删除独特的修复逻辑（保留 Prompt）
- **spec-driver-resume/SKILL.md**：Phase 序列 1-2 个，保留检查点恢复逻辑
- **spec-driver-sync/SKILL.md**：Phase 序列 2-3 个，保留多源汇合逻辑
- **spec-driver-doc/SKILL.md**：Phase 序列 1-2 个，保留文档生成格式化逻辑

**预期行数变化**：
| 模式 | 改造前 | 改造后 | 净减 |
|------|--------|--------|------|
| story | ~590 | 400-450 | 140-190 |
| implement | ~600 | 450-500 | 100-150 |
| fix | ~400 | 300-350 | 50-100 |
| resume | ~350 | 250-300 | 50-100 |
| sync | ~450 | 350-400 | 50-100 |
| doc | ~380 | 280-330 | 50-100 |
| **总计** | **~3,170** | **~2,230-2,480** | **~540-690** |

**成功标准**：
- [ ] 6 个 SKILL.md 均改造完成，各自行数符合预期
- [ ] 硬编码的 Phase 定义均被移除（grep 检验）
- [ ] 各模式的初始化代码正确，调用 `new Orchestrator(config, mode, context)`
- [ ] 各模式的 Prompt 指令和特有逻辑保留无变化（如 sync 的多源汇合、fix 的独特修复步骤）
- [ ] 总代码行数净减少 ≥500 行（去掉了重复的 Phase 和 Gate 定义）
- [ ] 功能测试通过：7 种模式的 Smoke test 覆盖

---

### T2.6 集成配置验证和错误处理

**标题**：集成配置验证和全局错误处理
**工时估计**：2 小时
**依赖**：T2.1-T2.5
**负责方**：impl agent

**任务描述**：
完善 Orchestrator 和 SKILL.md 的错误处理、日志输出和配置验证：

1. **配置验证脚本**（`plugins/spec-driver/bin/validate-orchestration.js`）：
   - 读取 orchestration.yaml
   - 校验 Schema、必填字段、引用的 Phase 和 Gate 是否存在
   - 输出详细的验证报告

2. **Orchestrator 的错误处理**：
   - 加载失败 → 自动降级 + warn 日志
   - Schema 校验失败 → 详细错误信息 + 建议修正步骤
   - Phase 或 Gate 不存在 → 错误堆栈和上下文

3. **SKILL.md 的 trace.md 增强**：
   - 记录 Orchestrator 初始化结果（加载源：orchestration.yaml / fallback）
   - 记录每个 Phase 的执行（跳过、并行、串行）
   - 记录 Gate 决策（优先级、最终行为）

**成功标准**：
- [ ] `plugins/spec-driver/bin/validate-orchestration.js` 创建完成，可独立执行
- [ ] 验证脚本输出：有效 / 无效，错误列表，建议修正
- [ ] Orchestrator 的 warn / error 日志清晰，包含原因和建议
- [ ] trace.md 记录 Orchestrator 初始化、降级事件、Phase 执行流程
- [ ] npm run repo:check 通过（无新的 lint 错误）

---

## 阶段 3：兼容性验证（6 个任务）

### T3.1 编写 Smoke Test 框架（7 种模式）

**标题**：编写 Smoke Test 框架和测试用例
**工时估计**：3 小时
**依赖**：T1.5（可与阶段 1 并行准备）
**负责方**：test agent

**任务描述**：
创建 `test/smoke/orchestration.test.js`，编写 7 个 Smoke Test 场景（每个模式一个）。

测试场景（参考 plan.md 的表格）：

| 场景 | 模式 | 输入场景 | 验证内容 | 预期结果 |
|-----|------|--------|---------|--------|
| S1 | feature | 新特性描述 + 完整配置 | Phase 顺序、Gate 决策、trace | ✅ 按 orchestration.yaml 执行 |
| S2 | story | 已有 spec.md 的特性 | 制品检测、跳过逻辑 | ✅ 检测到 spec.md 并跳过 Phase 1 |
| S3 | implement | 已有 tasks.md 的特性 | 实现流程、GATE_IMPLEMENT_MID | ✅ 中期门禁触发 |
| S4 | fix | 缺陷描述 | 独立 Phase 序列 | ✅ 执行 fix 模式的 Phase |
| S5 | resume | 中断恢复场景 | 检查点加载、继续执行 | ✅ 从检查点恢复 |
| S6 | sync | 多源配置同步 | 聚合逻辑、合并结果 | ✅ 同步逻辑正确 |
| S7 | doc | 文档生成 | 输出格式、完整性 | ✅ 生成标准格式文档 |

**测试代码框架**：
```javascript
describe('Orchestrator Smoke Tests', () => {
  describe('feature mode', () => {
    it('should execute phases in correct order', async () => {
      const result = await runSkillTest('feature', { ... });
      expect(result.phases).toEqual(expectedPhaseSequence);
      expect(result.trace).toContain('Phase 1', 'Phase 2', ...);
    });
  });
  // story, implement, fix, resume, sync, doc 模式的测试用例类似
});
```

**成功标准**：
- [ ] `test/smoke/orchestration.test.js` 创建完成，包含 7 个 describe 块（每个模式一个）
- [ ] 每个模式至少 2 个 test case：
  - 基础执行测试（验证 Phase 顺序、Gate 行为）
  - 制品跳过测试（如适用）
- [ ] 测试框架包含 runSkillTest() 辅助函数，支持注入测试数据和配置
- [ ] trace.md 输出验证逻辑（检查日志中的 Phase 记录）
- [ ] 代码行数 200-300 行（含注释）

---

### T3.2 验证 feature 模式（冒烟测试）

**标题**：执行 feature 模式的 Smoke Test
**工时估计**：2 小时
**依赖**：T2.4、T3.1
**负责方**：test agent

**任务描述**：
运行 feature 模式的 Smoke Test（S1），确保：
- Phase 序列按 orchestration.yaml 执行（10-12 个 Phase）
- Gate 决策逻辑正确（GATE_RESEARCH → GATE_DESIGN → GATE_ANALYSIS → GATE_TASKS → GATE_VERIFY）
- 并行组执行（RESEARCH_GROUP 中 product_research + tech_research 并行）
- trace.md 记录完整
- 与改造前的执行结果对比，无功能回归

**成功标准**：
- [ ] 执行 `npm test -- test/smoke/orchestration.test.js --grep "feature mode"` 通过
- [ ] trace.md 包含所有 10-12 个 Phase 的执行日志（✅ 符号）
- [ ] Gate 决策日志清晰（如 "GATE_RESEARCH: always → execute"）
- [ ] 并行组执行日志（如 "RESEARCH_GROUP: 2 tasks executing in parallel"）
- [ ] 若使用降级配置（非 orchestration.yaml），输出 warn 日志（❌ 此 case 应使用完整配置，不应触发降级）
- [ ] 与改造前的 spec-driver-feature 结果对比，Phase 和 Gate 行为一致（需人工审查或自动对比脚本）

---

### T3.3 验证 story 模式（冒烟测试）

**标题**：执行 story 模式的 Smoke Test
**工时估计**：1.5 小时
**依赖**：T2.5、T3.1
**负责方**：test agent

**任务描述**：
运行 story 模式的 Smoke Test（S2），确保：
- Phase 序列符合 story 模式的定义（5-6 个 Phase，subset of feature）
- 若 spec.md 存在，正确跳过 specify Phase
- Gate 行为与 feature 模式兼容（不是所有 Gate 都必须执行）
- trace.md 记录制品检测和 Phase 跳过事件

**成功标准**：
- [ ] 执行 `npm test -- test/smoke/orchestration.test.js --grep "story mode"` 通过
- [ ] trace.md 显示 5-6 个 Phase 的执行（数量符合 orchestration.yaml 的 story 配置）
- [ ] 制品检测测试（spec.md 存在）：trace.md 包含 "Skipped: specify (spec.md exists)" 日志
- [ ] Gate 行为正确（story 模式的 applicable_modes 包含 story）
- [ ] 无不预期的 warn 日志（降级、缺失配置等）

---

### T3.4 验证 implement/fix/resume/sync/doc 模式（冒烟测试）

**标题**：执行其他 5 个模式的 Smoke Test
**工时估计**：3 小时
**依赖**：T2.5、T3.1
**负责方**：test agent

**任务描述**：
批量执行 implement、fix、resume、sync、doc 模式的 Smoke Test（S3-S7）。

**每个模式的验证重点**：

- **implement (S3)**：
  - Phase 2-3 个，包含实现 + 验证
  - GATE_IMPLEMENT_MID 触发（mid-phase checkpoint）
  - trace.md 记录中期门禁的结果

- **fix (S4)**：
  - Phase 1-2 个（相对简洁）
  - 无 GATE_RESEARCH / GATE_DESIGN（fix 模式的 applicable_modes 不包含这些）
  - trace.md 记录修复流程

- **resume (S5)**：
  - Phase 1-2 个
  - 模拟检查点恢复（上次中断的状态）
  - trace.md 记录恢复点

- **sync (S6)**：
  - Phase 2-3 个
  - 涉及多源配置聚合
  - trace.md 记录同步结果

- **doc (S7)**：
  - Phase 1-2 个
  - 文档生成格式化
  - trace.md 记录生成的产物

**成功标准**：
- [ ] 执行 `npm test -- test/smoke/orchestration.test.js --grep "implement|fix|resume|sync|doc"` 全部通过
- [ ] 5 个模式的 trace.md 输出均符合各自预期（Phase 数量、Gate 适用范围、输出格式）
- [ ] 无不预期的 warn / error 日志（除非测试场景故意注入错误）
- [ ] 代码覆盖率：orchestrator.js 的 getGateBehavior、getParallelGroupMembers、getPhases 等核心方法均被调用

---

### T3.5 执行向后兼容性扫描

**标题**：执行向后兼容性测试
**工时估计**：2 小时
**依赖**：T3.2-T3.4
**负责方**：test agent

**任务描述**：
验证向后兼容性，包含以下 3 个测试用例：

1. **现有配置继续有效**：
   - 使用现有的 spec-driver.config.yaml（包含 gates 覆盖、gate_policy 等）
   - 执行 feature 模式
   - 验证 user_config 的 gates 覆盖优先级最高（T2.2 的优先级 1）

2. **orchestration.yaml 缺失时的降级**：
   - 临时移除 orchestration.yaml
   - 执行 feature 模式
   - 验证：
     - warn 日志："Using fallback orchestration config..."
     - 流程正常完成（调用降级配置的最小 Phase 序列）
     - 功能不中断，虽然 Phase 可能减少

3. **旧 SKILL.md 与新 Orchestrator 的兼容性**：
   - 若保留旧版本的 SKILL.md（未改造），验证加载 orchestration.yaml 时的错误处理
   - 验证 trace.md 的错误信息清晰（提示升级步骤）

**成功标准**：
- [ ] **Test 1**：user_config.gates 覆盖生效，getGateBehavior() 返回用户配置的值
- [ ] **Test 2**：orchestration.yaml 缺失 → warn 日志输出、降级配置加载、流程完成
- [ ] **Test 3**：旧 SKILL.md 与新 Orchestrator 不兼容时，错误信息明确指导升级步骤
- [ ] 执行 `npm test -- test/smoke/compatibility.test.js` 全部通过
- [ ] 无意外的回归（对比改造前的行为）

---

### T3.6 代码覆盖率和文件行数检查

**标题**：代码覆盖率和产物行数验证
**工时估计**：1 小时
**依赖**：T3.1-T3.5
**负责方**：test agent

**任务描述**：
运行代码覆盖率报告，检查产物文件行数变化：

1. **代码覆盖率检查**（目标 ≥80%）：
   - 运行 `npm run test:coverage`
   - 覆盖关键模块：orchestrator.js、所有 SKILL.md 的加载逻辑
   - 关键函数：getGateBehavior、getPhases、getParallelGroupMembers、executePhase 等

2. **文件行数检查**：
   - orchestration.yaml：~350 行
   - orchestrator.js：300-400 行
   - orchestrator-fallback.js：50-100 行
   - 7 个 SKILL.md：总行数 2,230-2,480（比改造前 3,170 减少 ≥500）

3. **整体产物大小**：
   - 新增产物总行数：orchestration.yaml + orchestrator.js + fallback = ~700-850 行
   - SKILL.md 净减少：≥500 行
   - **预期结果**：总代码行数略增或持平（去掉重复的 Phase、Gate 定义后）

**成功标准**：
- [ ] `npm run test:coverage` 执行完成，orchestrator.js 覆盖率 ≥80%
- [ ] 生成覆盖率报告（HTML 格式），包含：行覆盖、分支覆盖、函数覆盖
- [ ] 运行脚本 `wc -l orchestration.yaml plugins/spec-driver/lib/orchestrator*.js`，验证新增产物行数
- [ ] 运行脚本 `wc -l plugins/spec-driver/skills/*/SKILL.md`，验证 SKILL.md 总行数 ≤2,480
- [ ] 整体代码行数增长 <15%（计算公式：(新增 - SKILL.md 净减) / 原始总行数 < 15%）

---

### T3.7 最终验证：npm run repo:check PASS 🔴

**标题**：最终验证：执行全仓库检查
**工时估计**：1 小时
**依赖**：T3.1-T3.6
**负责方**：test agent

**任务描述**：
执行仓库级的完整检查，确保所有产物符合规范：

```bash
npm run repo:check
```

预期检查项：
- ✅ ESLint：无 lint 错误
- ✅ 测试：test/smoke/orchestration.test.js 及兼容性测试全部通过
- ✅ 覆盖率：orchestrator.js ≥80%
- ✅ 文件同步：orchestration.yaml 与 SKILL.md 的引用一致
- ✅ 发布合同：若涉及版本号变更，release-contract.yaml 已更新
- ✅ 文档：docs/ 中的相关文档（如 contributor-guide.md）已同步

**成功标准**：
- [ ] 执行 `npm run repo:check` 返回 **EXIT CODE 0**（全部通过）
- [ ] 无失败的检查项（若有失败，需修复后重新运行）
- [ ] 输出日志中包含："✅ Orchestration config validation"、"✅ Smoke test passed"、"✅ Code coverage check" 等
- [ ] 若涉及版本变更，运行 `npm run release:check` 也通过
- [ ] 最终可提交 PR（所有检查项绿灯）

---

## 整体验收标准

### 必须满足的条件

**配置层面**：
- [ ] `plugins/spec-driver/config/orchestration.yaml` 存在，有效 YAML，包含 7 种模式的完整 Phase 序列
- [ ] Schema 定义清晰（在 orchestration-schema.md 中），可用于向 Feature 093 扩展
- [ ] 所有 6 个 Gate 已定义，applicable_modes 正确，hard_gate_modes 保护关键模式

**代码层面**：
- [ ] `plugins/spec-driver/lib/orchestrator.js` 实现完整，包含初始化、Phase 查询、Gate 优先级、并行组调度
- [ ] `plugins/spec-driver/lib/orchestrator-fallback.js` 实现，支持降级
- [ ] 7 个 SKILL.md 均已改造，总行数 ≤2,480，硬编码的 Phase/Gate 定义已移除
- [ ] 无新的 ESLint 错误或 TypeScript 类型错误

**测试层面**：
- [ ] `test/smoke/orchestration.test.js` 包含 7 个 Smoke Test 场景，全部通过
- [ ] 向后兼容性测试通过（现有配置、缺失配置、旧版本兼容）
- [ ] 代码覆盖率 ≥80%（orchestrator.js）

**产物质量**：
- [ ] `npm run repo:check` **PASS**
- [ ] 整体代码行数增长 <15%（去掉重复定义后）
- [ ] 文档更新完毕（contributor-guide.md、CHANGELOG）

### 可选但推荐的条件

- [ ] 为 Feature 093 预留的 refactor 模式模板已在 orchestration.yaml 中注释化
- [ ] 发布合同 (release-contract.yaml) 中的版本号已更新（如需）
- [ ] 补充了 orchestration.yaml 的修改指南（顶部注释）

---

## 任务依赖关系图

```
阶段 1：配置提取
├─ T1.1 (反向工程 Phase)
├─ T1.2 (反向工程 Gate)
├─ T1.3 (反向工程并行组)
└─ T1.4 (设计 Schema) ← 依赖 T1.1 + T1.2 + T1.3
   └─ T1.5 (实现 orchestration.yaml) ← 依赖 T1.4
      └─ T1.6 (向后兼容降级) ← 依赖 T1.5

阶段 2：编排器统一
├─ T2.1 (实现 Orchestrator) ← 依赖 T1.5 + T1.6
├─ T2.2 (Gate 优先级解析) ← 依赖 T2.1
├─ T2.3 (并行组调度) ← 依赖 T2.1
└─ T2.4 (改造 feature SKILL.md) ← 依赖 T2.1 + T2.2 + T2.3
   └─ T2.5 (改造其他 6 个 SKILL.md) ← 依赖 T2.4
      └─ T2.6 (集成验证和错误处理) ← 依赖 T2.1-T2.5

阶段 3：兼容性验证
├─ T3.1 (准备 Smoke Test 框架) [可与阶段 1 并行]
├─ T3.2 (feature 模式测试) ← 依赖 T2.4 + T3.1
├─ T3.3 (story 模式测试) ← 依赖 T2.5 + T3.1
├─ T3.4 (其他 5 个模式测试) ← 依赖 T2.5 + T3.1
└─ T3.5 (向后兼容性扫描) ← 依赖 T3.2-T3.4
   └─ T3.6 (覆盖率检查) ← 依赖 T3.1-T3.5
      └─ T3.7 (最终验证 repo:check) ← 依赖 T3.1-T3.6

关键路径（串行依赖最长）：
T1.1 → T1.4 → T1.5 → T1.6 → T2.1 → T2.2 → T2.3 → T2.4 → T2.5 → T2.6 → T3.5 → T3.7
```

---

## 工时汇总

| 阶段 | 任务 | 工时 | 累计 |
|-----|------|------|------|
| **阶段 1** | T1.1-T1.6 | 4+3+2+3+6+2 = **20 小时** | 20h |
| **阶段 2** | T2.1-T2.6 | 4+3+3+3+4+2 = **19 小时** | 39h |
| **阶段 3** | T3.1-T3.7 | 3+2+1.5+3+2+1+1 = **13.5 小时** | 52.5h |
| **总计** | 18 个任务 | **52.5 小时** |  |

**预期工期**：
- 3 天（完全串行，每天 16-18 小时）
- 4-5 天（标准工作流，每天 10-12 小时）
- **推荐**：5 天，留有 buffer 和审查时间

---

## 备注与风险

### 高风险任务（🔴 标记）

1. **T1.1 - T1.4**：反向工程现有 SKILL.md，容易遗漏边界情况或并行逻辑
   - **缓解**：逐行审阅 + 与 plan.md 对比 + grep 搜索关键关键字（"concurrent", "parallel", "conditional"）

2. **T2.4 - T2.5**：改造 7 个 SKILL.md，风险最高
   - **缓解**：先改造 feature 模式，通过 Smoke Test 后再逐一改造其他 6 个；保留原始版本作为回滚点

3. **T3.7**：最终 repo:check 必须 PASS
   - **缓解**：提前运行 `npm run repo:check` 检查，及时发现和修复

### 测试覆盖盲点

- **并行组的真实并发**：Smoke Test 可能无法充分测试并行执行的竞态条件
  - **缓解**：补充 integration test，注入延迟和故障模拟

- **Gate 优先级的复杂组合**：四层优先级的所有组合未必都被 Smoke Test 覆盖
  - **缓解**：补充 unit test，明确测试四层优先级的各个分支

### 文档和维护

- orchestration.yaml 的修改需要与 SKILL.md 保持同步（契约）
  - **缓解**：补充同步脚本或工具，验证一致性

- Feature 093 (refactor 模式) 需要参考 orchestration.yaml 的扩展指南
  - **缓解**：在 orchestration.yaml 顶部补充详细的扩展示例

---

**文档版本**：1.0
**最后更新**：2026-04-06
**下一步**：启动 T1.1 的反向工程任务
