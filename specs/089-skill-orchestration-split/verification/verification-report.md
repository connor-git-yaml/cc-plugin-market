# Feature 089 验证报告：SKILL.md 编排拆分与 orchestration.yaml 提取

**生成时间**：2026-04-06
**验证模式**：四层深度验证（Spec-Code 对齐 + 代码质量 + 工具链 + 验证证据）
**总体状态**：NEEDS FIX

---

## Layer 1: Spec-Code 对齐验证

### FR 覆盖率：9/9 FR 已实现（但 FR-3 存在 Bug）

| FR | 需求 | 状态 | 证据 |
|----|------|------|------|
| FR-1 | orchestration.yaml 的创建和维护 | PASS | `plugins/spec-driver/config/orchestration.yaml` 存在，688 行，包含 version、gates、modes、parallel_groups 四大块，覆盖 7 种模式 + refactor 注释模板 |
| FR-2 | Phase 定义提取 | PASS | 7 种模式均有完整 Phase 序列：feature 18 个 Phase、story 6 个、implement 6 个、fix 3 个、resume 4 个、sync 3 个、doc 3 个。SKILL.md 通过 `orchestrator-cli.mjs get-phases` 查询 Phase 序列 |
| FR-3 | Gate 配置提取 | BUG | 6 个 Gate 已定义（GATE_RESEARCH/DESIGN/ANALYSIS/TASKS/IMPLEMENT_MID/VERIFY），但 **hard_gate_modes 字段被 simple-yaml.mjs 解析为字符串而非数组**，导致硬门禁机制失效。见 Layer 2 详述 |
| FR-4 | 并行组定义提取 | BUG | 3 个并行组已定义（RESEARCH_GROUP/DESIGN_PREP_GROUP/VERIFY_GROUP），但 **members 字段同样被解析为字符串**，`"[1a, 1b]"` 而非 `["1a", "1b"]`。并行组成员查询返回错误格式 |
| FR-5 | 统一 Orchestrator 加载器 | PASS | `orchestrator.mjs` 258 行，实现 Orchestrator 类，含 loadAndValidateConfig/buildGateBehaviorMap/buildPhaseMap/buildParallelGroupMap 四个核心方法 + 公共查询 API |
| FR-6 | 向后兼容配置覆盖 | PASS | `orchestrator-fallback.mjs` 90 行，包含全部 7 种模式的最小化 fallback 配置。Orchestrator 构造函数在配置缺失/无效时自动降级 |
| FR-7 | 条件执行与制品跳过 | PASS | `evaluateCondition()` 安全实现（基于正则匹配，不使用 eval），支持 `in [...]`、`==`、`!=`、`>` 四种运算符。`shouldExecutePhase()` 支持 skip_if_exists 检查 |
| FR-8 | Trace 日志记录 | PASS | feature SKILL.md 第 144-154 行定义了 trace.md 记录格式，包含 Phase 启停、Gate 决策、并行降级事件 |
| FR-9 | Feature 093 扩展就绪 | PASS | orchestration.yaml 第 649-684 行包含注释化的 refactor 模式模板（3 个 Phase），文件顶部第 12 行有扩展说明 |

### NFR 覆盖率：5/5 NFR 已覆盖

| NFR | 需求 | 状态 | 证据 |
|-----|------|------|------|
| NFR-1 | 可维护性 | PASS | 编排行为集中在 orchestration.yaml，SKILL.md 通过 CLI 查询 |
| NFR-2 | 向后兼容性 | PASS | fallback 配置覆盖全部 7 种模式和 6 个 Gate，降级日志输出 warn 级别 |
| NFR-3 | 可测试性 | PASS | 28 个独立测试用例，使用 node:test 框架，可独立执行 |
| NFR-4 | 文件行数优化 | INFO | orchestration.yaml 688 行（spec 预期 ~350 行，实际约为 2 倍）。feature SKILL.md 325 行（spec 预期 ~1200 行，实际显著更短）。七种 SKILL.md 总计 3243 行 |
| NFR-5 | 配置驱动 | PASS | 新增 Gate/Mode 只需修改 orchestration.yaml，CLI 工具链支持独立验证 |

---

## Layer 2: 代码质量验证

### 2.1 架构合理性

| 检查项 | 状态 | 证据 |
|--------|------|------|
| Orchestrator 类职责清晰 | PASS | 单一职责：加载配置 + 构建映射表 + 提供查询 API，258 行 |
| 构造函数参数设计 | PASS | `(userConfig, mode, context)` 三参数，context 可选默认空对象 |
| 公共 API 完整 | PASS | getPhases/getGateBehavior/getParallelGroup/getParallelGroups/shouldExecutePhase/getParallelSchedulingConfig/getSummary 7 个公共方法 |
| 私有方法封装 | PASS | loadAndValidateConfig/buildGateBehaviorMap/buildPhaseMap/buildParallelGroupMap 4 个私有方法 |
| CLI 包装器设计 | PASS | orchestrator-cli.mjs 187 行，5 个命令，JSON 输出，静默日志器 |

### 2.2 ESM 模块格式一致性

| 文件 | require/module.exports 出现 | 状态 |
|------|---------------------------|------|
| orchestrator.mjs | 无 | PASS |
| orchestrator-fallback.mjs | 无 | PASS |
| orchestrator-cli.mjs | 无 | PASS |
| orchestrator.test.mjs | 无 | PASS |

全部文件使用 `import/export` ESM 语法，无 CJS 混用。

### 2.3 Gate 4-tier 优先级实现

| 优先级层 | 代码位置 | 逻辑正确性 | 状态 |
|----------|---------|-----------|------|
| Tier 1: hard_gate | orchestrator.mjs L79-87 | `Array.isArray(gateDef.hard_gate_modes) && gateDef.hard_gate_modes.includes(this.mode)` | **BUG** - 逻辑正确但输入数据格式错误 |
| Tier 2: user_config | orchestrator.mjs L88-90 | `userGates[gateId]?.pause` 可选链访问 | PASS |
| Tier 3: gate_policy | orchestrator.mjs L92-95 | `getDefaultBehaviorForPolicy(policy, gateId)` 三策略映射 | PASS |
| Tier 4: yaml_default | orchestrator.mjs L97-98 | `gateDef.default_behavior \|\| 'on_failure'` | PASS |

**关键 Bug 详述**：

`simple-yaml.mjs` 的 `parseYamlScalar()` 函数（L61-76）不识别 YAML inline array 语法 `[feature]`，将其作为普通字符串返回。这导致：

- `hard_gate_modes: [feature]` 被解析为字符串 `"[feature]"` 而非数组 `["feature"]`
- `Array.isArray("[feature]")` 返回 `false`
- `isHardGate` 永远为 `false`
- feature 模式下 GATE_DESIGN 的硬门禁保护失效

同样影响：
- `members: [1a, 1b]` 被解析为字符串 `"[1a, 1b]"` 而非数组 `["1a", "1b"]`
- `applicable_modes: [feature]` 等所有 inline array 字段

**影响范围**：这是 simple-yaml 解析器的已知限制，不是 Feature 089 的新代码引入的问题。但 Feature 089 的核心功能（硬门禁保护、并行组成员查询）依赖于 inline array 被正确解析。

### 2.4 evaluateCondition() 安全性

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 不使用 eval() | PASS | orchestrator.mjs L213 注释明确标注"不使用 eval"，实现基于 4 个 regex match 模式 |
| 支持的运算符 | PASS | `in [...]`、`==`、`!=`、`>` 四种，覆盖 spec 中的所有条件表达式 |
| 未知条件默认返回 true | PASS | L239 未匹配任何模式时返回 true（安全降级） |
| 异常捕获 | PASS | L240 `catch { return true }` 防止异常中断流程 |

### 2.5 Fallback 配置中 Gate 引用格式

| 检查项 | 状态 | 证据 |
|--------|------|------|
| gates_after 引用为字符串数组 | PASS | fallback 中所有 gates_after 值为 `['GATE_DESIGN']`、`['GATE_VERIFY']` 等字符串数组 |
| 无裸标识符 | PASS | 所有 Gate ID 用引号包裹（如 `'GATE_DESIGN'`），不存在未引用的标识符 |
| fallback 覆盖全部 7 种模式 | PASS | feature/story/implement/fix/resume/sync/doc 全部存在 |
| fallback 包含全部 6 个 Gate | PASS | 测试用例第 231-261 行验证通过 |

---

## Layer 3: 工具链验证

### 3.1 YAML 文件语法

| 检查项 | 状态 | 证据 |
|--------|------|------|
| orchestration.yaml 结构完整 | PASS | CLI `validate-config` 返回 `{"success": true, "message": "配置有效", "is_fallback": false, "mode_count": 7, "gate_count": 6, "parallel_group_count": 3, "version": "1.0"}` |
| version 字段 | PASS | `"1.0"` |
| gates 块 | PASS | 6 个 Gate 定义 |
| modes 块 | PASS | 7 种模式 |
| parallel_groups 块 | PASS | 3 个并行组 |
| refactor 注释模板 | PASS | L649-684 注释化存在 |

### 3.2 ESM Import 链路一致性

| 导入关系 | 状态 | 证据 |
|----------|------|------|
| orchestrator.mjs -> simple-yaml.mjs | PASS | `import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs'` |
| orchestrator.mjs -> orchestrator-fallback.mjs | PASS | `import { generateFallbackConfig } from './orchestrator-fallback.mjs'` |
| orchestrator-cli.mjs -> orchestrator.mjs | PASS | `import { Orchestrator, validateOrchestrationYaml, evaluateCondition } from '../lib/orchestrator.mjs'` |
| orchestrator-cli.mjs -> orchestrator-fallback.mjs | PASS | `import { generateFallbackConfig } from '../lib/orchestrator-fallback.mjs'` |
| orchestrator.test.mjs -> orchestrator.mjs | PASS | 同上 |
| orchestrator.test.mjs -> orchestrator-fallback.mjs | PASS | 同上 |
| simple-yaml.mjs 文件存在 | PASS | `plugins/spec-driver/scripts/lib/simple-yaml.mjs` 存在 |

### 3.3 测试框架验证

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 使用 node:test 框架 | PASS | `import { describe, it } from 'node:test'` (L16) |
| 使用 node:assert/strict | PASS | `import assert from 'node:assert/strict'` (L17) |
| 测试数量 | PASS | 28 个测试用例，11 个 suite |

### 3.4 旧 CJS 文件清理

| 检查项 | 状态 | 证据 |
|--------|------|------|
| orchestrator.js (CJS) | PASS | 不存在，Glob `plugins/spec-driver/lib/orchestrator*.js` 无结果 |
| orchestrator-fallback.js (CJS) | PASS | 不存在 |
| 仅存在 .mjs 文件 | PASS | `plugins/spec-driver/lib/orchestrator.mjs` 和 `orchestrator-fallback.mjs` |

### 3.5 测试执行结果

**命令**: `node --test plugins/spec-driver/tests/orchestrator.test.mjs`

| 结果 | 数量 |
|------|------|
| 总测试数 | 28 |
| 通过 | 24 |
| 失败 | **4** |
| 跳过 | 0 |
| 总耗时 | 48ms |

**失败测试详情**：

| 测试名 | 失败原因 | 根因 |
|--------|---------|------|
| GATE_DESIGN 在 feature 模式下是硬门禁 | `isHardGate` 为 false（期望 true） | simple-yaml 不解析 inline array `[feature]` |
| 有 3 个并行组 - members 格式 | `members` 为字符串 `"[1a, 1b]"`（期望数组 `["1a","1b"]`） | simple-yaml 不解析 inline array `[1a, 1b]` |
| autonomous 策略：全部 on_failure | GATE_DESIGN behavior 为 `on_failure`（期望 `always`，硬门禁保护） | hard_gate 机制失效（同根因） |
| 用户配置覆盖策略，但硬门禁不受影响 | GATE_DESIGN behavior 为 `on_failure`（期望 `always`，硬门禁保护） | hard_gate 机制失效（同根因） |

**根因分析**：所有 4 个失败均源自 **simple-yaml.mjs 不支持 YAML inline array 语法**（`[a, b]` 格式）。这导致 `hard_gate_modes` 和 `members` 等字段被解析为字符串而非 JavaScript 数组。

---

## Layer 4: 验证证据

### 4.1 证据清单

| 验证类型 | 命令/操作 | 实际执行 | 退出码 | 结论 |
|----------|----------|---------|-------|------|
| 测试 | `node --test plugins/spec-driver/tests/orchestrator.test.mjs` | 已执行 | 1 (失败) | 24/28 通过，4 个失败 |
| 配置验证 | `node plugins/spec-driver/scripts/orchestrator-cli.mjs validate-config` | 已执行 | 0 | 配置有效，非 fallback |
| Gate 行为查询 | `node orchestrator-cli.mjs get-gate-behavior feature GATE_DESIGN` | 已执行 | 0 | behavior=always, source=gate_policy (非 hard_gate) |
| 并行组查询 | `node orchestrator-cli.mjs get-parallel-groups feature` | 已执行 | 0 | 3 个组，members 为字符串格式 |
| CJS 文件检查 | `Glob plugins/spec-driver/lib/orchestrator*.js` | 已执行 | 0 | 无匹配 |
| ESM 一致性 | `Grep require\(/module.exports` 全部 .mjs 文件 | 已执行 | 0 | 无匹配（纯 ESM） |
| eval 安全性 | `Grep \beval\b orchestrator.mjs` | 已执行 | 0 | 仅出现在注释中 |
| inline array 验证 | `node -e "parseYamlDocument('hard_gate_modes: [feature]')"` | 已执行 | 0 | 返回字符串，非数组 |

### 4.2 推测性表述检测

本报告中不包含以下推测性表述：
- "should pass" / "should work" -- 无
- "looks correct" / "looks good" -- 无
- "tests will likely pass" -- 无

所有结论均基于实际命令执行结果和文件内容检查。

---

## 总体结果

### 验证摘要

| 层级 | 结果 | 详情 |
|------|------|------|
| Layer 1: Spec-Code 对齐 | 7/9 FR PASS, 2/9 BUG | FR-3 (Gate hard_gate_modes) 和 FR-4 (并行组 members) 受 YAML 解析 Bug 影响 |
| Layer 2: 代码质量 | PASS (含 1 个已知 Bug) | 架构合理，ESM 纯净，evaluateCondition 安全，但 4-tier 优先级因输入格式错误而 Tier 1 (hard_gate) 失效 |
| Layer 3: 工具链 | FAIL (4/28 测试失败) | 根因：simple-yaml.mjs 不支持 YAML inline array |
| Layer 4: 验证证据 | COMPLIANT | 所有验证基于实际命令执行，无推测性表述 |

### NEEDS FIX -- 需修复项

**P0 - 阻塞发布**：

1. **simple-yaml.mjs inline array 解析缺陷**
   - 问题：`parseYamlScalar()` 不识别 `[a, b, c]` 格式的 YAML inline array
   - 影响：`hard_gate_modes`、`members`、`applicable_modes` 等全部 inline array 字段被解析为字符串
   - 修复方案（二选一）：
     - (A) 在 `parseYamlScalar()` 中增加 inline array 解析逻辑
     - (B) 将 orchestration.yaml 中的 inline array 改写为 YAML block sequence 格式（如 `- feature`）
   - 影响的测试：4 个（硬门禁 + 并行组 members）

**P1 - 建议修复**：

2. **4-tier 优先级 Tier 1 顺序问题**
   - 当前代码中 hard_gate 优先于 user_config（L85-90），但 spec FR-6 定义的优先级为 `user_config > hard_gate_modes > gate_policy > yaml_default`
   - 实际代码实现为 `hard_gate > user_config > gate_policy > yaml_default`
   - 这意味着硬门禁不可被用户覆盖（当前行为），而 spec 声明用户配置应优先
   - 需与产品确认：硬门禁是否应该可被用户覆盖？当前实现（硬门禁不可覆盖）更安全

### 文件清单

| 文件 | 行数 | 状态 |
|------|------|------|
| `plugins/spec-driver/config/orchestration.yaml` | 688 | 需修复 inline array |
| `plugins/spec-driver/lib/orchestrator.mjs` | 258 | PASS |
| `plugins/spec-driver/lib/orchestrator-fallback.mjs` | 90 | PASS |
| `plugins/spec-driver/scripts/orchestrator-cli.mjs` | 187 | PASS |
| `plugins/spec-driver/tests/orchestrator.test.mjs` | 296 | 24/28 PASS |
| `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` | 325 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | 575 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | 520 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` | 457 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | 334 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` | 300 | 已改造 |
| `plugins/spec-driver/skills/spec-driver-doc/SKILL.md` | 732 | 已改造 |
