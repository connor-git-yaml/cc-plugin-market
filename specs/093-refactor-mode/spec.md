---
title: 大规模重构模式（spec-driver-refactor Skill）
feature_id: 093
milestone: M-088
mode: story
created: 2026-04-06
status: specifying
related_files:
  - plugins/spec-driver/skills/spec-driver-feature/SKILL.md
  - plugins/spec-driver/skills/spec-driver-fix/SKILL.md
  - plugins/spec-driver/skills/spec-driver-story/SKILL.md
  - plugins/spec-driver/skills/spec-driver-implement/SKILL.md
  - plugins/spec-driver/config/orchestration.yaml
  - specs/089-skill-orchestration-split/spec.md
---

# Feature 093: 大规模重构模式（spec-driver-refactor Skill）

## 意图

当前 spec-driver 提供 feature、story、fix、implement 四种核心研发模式，分别覆盖"完整需求交付"、"快速需求实现"、"问题修复"、"成熟 Spec 实施"场景。但大规模代码重构（如重命名模块、拆分文件、合并概念、迁移 API）缺少专属流程：

1. **feature 模式过重**：完整调研 + 规范 + 规划对于"已知代码、已知目标"的重构是不必要的开销
2. **fix 模式过轻**：4 阶段快速修复缺少影响分析、分批执行、残留扫描等重构必需能力
3. **人工重构风险高**：无影响分析直接全量修改极易遗漏跨包引用、枚举值、类型定义等间接依赖
4. **无中间验证**：现有模式在实现阶段结束后才做最终验证，大规模重构需要每批次独立验证以限制回滚半径

**核心方案**：新增 `spec-driver-refactor` Skill，提供"影响分析 -> 分批规划 -> 逐批实现+中间验证 -> 全量残留扫描 -> 最终验证"的完整重构流程。复用 Feature 089 的 orchestration.yaml Phase 定义机制，激活 orchestration.yaml 文末预留的注释化 refactor 模式骨架。

## 接口定义

### 1. 触发方式与参数

```text
/spec-driver:spec-driver-refactor --target <重构目标> [描述]
/spec-driver:spec-driver-refactor --target src/parsers --preset balanced "将 parsers 目录拆分为 core 和 extensions"
```

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `--target` | string | 是 | 重构目标：文件路径、模块名、概念名（如 `CodeSkeleton`、`src/parsers/`） |
| 描述 | string | 否 | 重构意图的自然语言描述（首个非 flag 参数） |
| `--preset` | string | 否 | 临时覆盖模型预设（balanced / quality-first / cost-efficient） |
| `--batch-size` | number | 否 | 手动指定每批最大文件数（覆盖自动计算） |
| `--dry-run` | boolean | 否 | 仅执行影响分析和分批规划，不进入实现阶段 |

### 2. Phase 序列（5 Phase）

refactor 模式的 Phase 序列与其他模式的关键差异在于：跳过调研/规范阶段，引入影响分析、分批执行和残留扫描。

| Phase | 名称 | display_name | agent | 说明 |
|-------|------|-------------|-------|------|
| 1 | impact_analysis | 影响分析 | refactor-plan | 扫描重构目标的全部直接和间接引用 |
| 2 | batch_planning | 分批规划 | refactor-plan | 按依赖拓扑将影响文件分批，生成重构计划 |
| 3 | batch_implement | 逐批实现 | implement | 按批次顺序执行修改，每批完成后中间验证 |
| 4 | residual_scan | 残留扫描 | null (orchestrator) | 全量 grep 旧名称/旧路径，确认零残留 |
| 5 | final_verify | 最终验证 | verify | 运行 `npm run repo:check`、类型检查、测试 |

### 3. 核心数据结构

#### ImpactReport（影响分析报告）

```
impact-report.md 输出内容：
- 重构目标标识（target）
- 直接引用文件列表 + 行号
- 间接引用文件列表（跨包 import 链）
- 影响文件总数
- 跨包标记（是否涉及多个 package/workspace）
- 风险评级（low / medium / high / critical）
```

#### RefactorPlan（分批重构计划）

```
refactor-plan.md 输出内容：
- 批次列表（batch[]），每批包含：
  - batch_id: 批次序号
  - files: 本批涉及文件列表
  - description: 本批修改摘要
  - depends_on: 前置批次依赖
  - estimated_changes: 预估修改行数
- 总批次数
- 预估总修改行数
- 回滚策略描述
```

### 4. orchestration.yaml 扩展

在 orchestration.yaml 的 `modes` 块下激活 refactor 模式定义（从现有注释化模板演化）：

```yaml
refactor:
  name: "Refactor 模式（大规模代码重构）"
  description: "影响分析-分批规划-逐批实现-残留扫描-最终验证"
  phases:
    - id: "1"
      name: impact_analysis
      display_name: 影响分析
      agent: refactor-plan
      agent_mode: single
      gates_before: null
      gates_after: null
      is_critical: true

    - id: "2"
      name: batch_planning
      display_name: 分批规划
      agent: refactor-plan
      agent_mode: single
      gates_before: null
      gates_after:
        - GATE_TASKS
      is_critical: true

    - id: "3"
      name: batch_implement
      display_name: 逐批实现
      agent: implement
      agent_mode: batch_loop
      gates_before:
        - GATE_TASKS
      gates_after: null
      is_critical: true

    - id: "4"
      name: residual_scan
      display_name: 残留扫描
      agent: null
      agent_mode: orchestrator_verify
      gates_before: null
      gates_after: null
      is_critical: true

    - id: "5"
      name: final_verify
      display_name: 最终验证
      agent: verify
      agent_mode: single
      gates_before: null
      gates_after:
        - GATE_VERIFY
      is_critical: true
```

### 5. 新增 agent_mode: batch_loop

为支持"逐批实现+中间验证"循环，引入新的 agent_mode 值 `batch_loop`：

- 编排器读取 refactor-plan.md 中的批次列表
- 对每个 batch 依次派遣 implement agent 执行
- 每个 batch 完成后，编排器执行中间验证（类型检查 + 残留扫描）
- 任一 batch 中间验证失败时暂停，要求用户决策（继续/中止/修复后重试）

## User Scenarios & Testing

### User Story 1 - 基于目标的影响分析（Priority: P1）

用户指定一个重构目标（文件、模块或概念名），系统自动扫描全仓库定位所有直接和间接引用，输出结构化的影响分析报告。

**Why this priority**: 影响分析是重构安全性的基础，没有它就无法准确评估修改范围和风险，所有后续步骤都依赖此结果。

**Independent Test**: 在任意仓库中使用 `--target <模块名> --dry-run` 即可独立测试，验证输出报告是否覆盖所有引用。

**Acceptance Scenarios**:

1. **Given** 用户指定 `--target src/parsers/yaml-parser.mjs`，**When** 系统执行影响分析，**Then** 输出 `impact-report.md` 包含所有 import/require 该文件的源文件列表、行号、以及间接引用链
2. **Given** 重构目标涉及跨包引用（如 monorepo 中 packageA 引用 packageB 的导出），**When** 系统执行影响分析，**Then** 报告标注 `cross_package: true` 并列出跨包引用路径
3. **Given** 重构目标在仓库中无任何引用，**When** 系统执行影响分析，**Then** 报告标注影响文件数为 0 并提示用户确认目标是否正确

---

### User Story 2 - 分批规划与执行（Priority: P1）

系统根据影响分析结果，按依赖拓扑自动将影响文件划分为多个批次，按序执行修改，每批完成后进行中间验证。

**Why this priority**: 分批执行是大规模重构安全性的核心保障，限制了单次修改的回滚半径。与影响分析同为 MVP 必要能力。

**Independent Test**: 在已有 impact-report.md 的场景下执行分批规划和实现，验证批次划分合理性和中间验证准确性。

**Acceptance Scenarios**:

1. **Given** 影响分析报告包含 20 个文件，**When** 系统执行分批规划，**Then** 生成 `refactor-plan.md` 将文件按依赖关系分为多个批次，每批不超过默认上限（10 个文件）
2. **Given** 分批规划完成且有 3 个批次，**When** 系统开始逐批实现，**Then** 按 batch_id 顺序执行，每个 batch 完成后运行类型检查和残留扫描作为中间验证
3. **Given** 第 2 批中间验证发现类型错误，**When** 中间验证失败，**Then** 系统暂停并向用户报告失败详情，等待用户决策（继续/中止/修复后重试）

---

### User Story 3 - 全量残留扫描与零残留验证（Priority: P1）

所有批次执行完毕后，系统对全仓库进行残留扫描，确保旧名称、旧路径、旧枚举值等完全消除。

**Why this priority**: 残留扫描是重构完整性的最终防线，直接关联蓝图中"旧名称零残留"的验收标准。

**Independent Test**: 在所有批次实现完成后独立运行残留扫描，验证 grep 旧标识符返回 0 匹配。

**Acceptance Scenarios**:

1. **Given** 所有批次实现完成，**When** 系统执行全量残留扫描，**Then** 使用 grep 扫描全仓库中旧名称/旧路径的所有出现，输出残留报告
2. **Given** 残留扫描发现 3 处遗漏（如注释中的旧名称），**When** 报告输出，**Then** 系统列出每处残留的文件路径、行号和上下文，并标记为需修复项
3. **Given** 残留扫描零发现，**When** 扫描完成，**Then** 系统标记扫描通过并进入最终验证阶段

---

### User Story 4 - SKILL.md 与 orchestration.yaml 集成（Priority: P2）

新增 `spec-driver-refactor` Skill，其 SKILL.md 作为 refactor 模式编排器入口，读取 orchestration.yaml 中的 refactor Phase 定义驱动流程。

**Why this priority**: 基础设施层面的集成，是将影响分析、分批执行等核心能力串联为完整流程的必要条件。优先级低于核心功能本身。

**Independent Test**: 调用 `/spec-driver:spec-driver-refactor --target <目标>` 验证 Skill 是否正确加载并驱动 Phase 序列。

**Acceptance Scenarios**:

1. **Given** 用户调用 `/spec-driver:spec-driver-refactor --target src/parsers`，**When** Skill 加载，**Then** 正确解析 `--target` 参数并从 orchestration.yaml 读取 refactor 模式的 5 个 Phase
2. **Given** orchestration.yaml 中 refactor 模式定义已激活，**When** 编排器运行，**Then** 按 Phase 序列依次执行 impact_analysis -> batch_planning -> batch_implement -> residual_scan -> final_verify
3. **Given** 用户使用 `--dry-run` 参数，**When** Phase 2 (batch_planning) 完成后，**Then** 系统跳过 Phase 3-5 并输出影响分析报告和分批计划

---

### User Story 5 - 最终验证与仓库健康检查（Priority: P2）

残留扫描通过后，系统执行最终验证：运行 `npm run repo:check`、TypeScript 类型检查、项目测试，确保重构不引入回归。

**Why this priority**: 最终验证复用现有 verify agent 和 GATE_VERIFY 门禁，实现成本低但对交付质量至关重要。

**Independent Test**: 在残留扫描通过后独立运行最终验证 Phase，验证所有检查通过。

**Acceptance Scenarios**:

1. **Given** 残留扫描通过，**When** 系统执行最终验证，**Then** 依次运行 `npm run repo:check`、类型检查、项目测试，全部通过则标记重构成功
2. **Given** 最终验证中 `npm run repo:check` 失败，**When** 检查发现导入路径错误，**Then** 系统报告具体失败项并建议修复方向

---

### Edge Cases

- **重构目标不存在**：`--target` 指定的文件/模块在仓库中不存在时，Phase 1 应立即报错并终止流程
- **影响文件数为 0**：目标存在但无引用时，提示用户确认是否仍需继续（可能是死代码清理场景）
- **影响文件数超大（>100）**：自动提升风险评级为 critical，建议用户缩小重构范围或手动指定 `--batch-size`
- **跨包引用存在循环依赖**：影响分析阶段检测到循环引用时标注警告，分批规划将循环依赖文件归入同一批次
- **中间验证持续失败**：连续 2 个批次中间验证失败时，建议用户中止重构并回滚到上一个稳定状态
- **`--dry-run` 模式下发现高风险**：当影响分析风险评级为 critical 时，即使非 dry-run 也应暂停要求用户确认后再进入实现阶段

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `--target` 参数用于指定重构目标（文件路径、模块名或概念名）
- **FR-002**: 系统 MUST 在 Phase 1 (impact_analysis) 中扫描全仓库，识别重构目标的所有直接引用（import/require/re-export）和间接引用（通过中间模块的传递引用）
- **FR-003**: 系统 MUST 在影响分析中检测跨包引用，当重构目标被其他 workspace package 引用时标注 `cross_package: true`
- **FR-004**: 系统 MUST 在 Phase 2 (batch_planning) 中按依赖拓扑将影响文件划分为有序批次，确保每个批次内的文件可以独立修改而不破坏后续批次的依赖关系
- **FR-005**: 系统 MUST 在 Phase 3 (batch_implement) 中按批次顺序逐个执行修改，每个批次完成后执行中间验证（至少包含类型检查和该批次的残留扫描）
- **FR-006**: 系统 MUST 在中间验证失败时暂停执行并报告失败详情，等待用户决策
- **FR-007**: 系统 MUST 在 Phase 4 (residual_scan) 中使用 grep 对全仓库执行残留扫描，检查旧名称、旧路径、旧枚举值的所有出现
- **FR-008**: 系统 MUST 在 Phase 5 (final_verify) 中运行 `npm run repo:check`，验证重构后仓库健康
- **FR-009**: 系统 MUST 将影响分析结果输出到 `specs/{feature_dir}/impact-report.md`
- **FR-010**: 系统 MUST 将分批规划结果输出到 `specs/{feature_dir}/refactor-plan.md`
- **FR-011**: 系统 SHOULD 支持 `--dry-run` 参数，仅执行 Phase 1-2（影响分析 + 分批规划）而跳过实现阶段
- **FR-012**: 系统 SHOULD 支持 `--batch-size` 参数覆盖自动计算的每批文件数上限
- **FR-013**: 系统 SHOULD 在影响文件数超过 100 时自动提升风险评级并要求用户确认
- **FR-014**: 系统 MUST 复用 orchestration.yaml 的 Phase 定义机制，refactor 模式配置存储在 orchestration.yaml 的 `modes.refactor` 块中
- **FR-015**: 系统 MUST 新建 `plugins/spec-driver/agents/refactor-plan.md` 作为影响分析和分批规划阶段的 agent 定义
- **FR-016**: 系统 MUST 新建 `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md` 作为 refactor 模式的编排器入口
- **FR-017**: 系统 SHOULD 在 `batch_loop` agent_mode 中支持编排器对每个批次的独立中间验证调度
- **FR-018**: 系统 MAY 在影响分析阶段提供可视化的依赖图输出（如 Mermaid 格式）

### Key Entities

- **RefactorTarget**: 用户指定的重构目标——可以是文件路径、目录路径、模块名或概念名（如类型名、函数名）
- **ImpactReport**: 影响分析报告——包含直接引用、间接引用、跨包标记、风险评级
- **RefactorPlan**: 分批重构计划——包含有序批次列表、每批文件集合、依赖关系、回滚策略
- **Batch**: 单个执行批次——一组可独立修改的文件，执行完成后可独立验证
- **ResidualReport**: 残留扫描报告——记录旧标识符在全仓库中的残留位置

## Non-Functional Requirements

- **NFR-001**: SKILL.md 文件行数 MUST 控制在 500 行以内（不含 frontmatter），保持与其他 Skill 一致的精简风格
- **NFR-002**: 影响分析阶段 SHOULD 在 30 秒内完成对 1,000 文件规模仓库的扫描
- **NFR-003**: 分批规划的批次划分 MUST 确保依赖拓扑正确性——不会出现"先修改的批次依赖后修改的批次"的逆序情况
- **NFR-004**: refactor 模式 MUST 复用现有 implement agent 和 verify agent，不引入新的实现或验证逻辑
- **NFR-005**: orchestration.yaml 修改 MUST 向后兼容——现有 7 种模式的行为不受影响
- **NFR-006**: 新增文件 MUST 遵循项目现有目录结构和命名惯例（agents/*.md, skills/spec-driver-*/SKILL.md）

## Success Criteria

### Measurable Outcomes

- **SC-001**: `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md` 文件存在且包含完整的 frontmatter（name, description, allowed-tools, model, effort）
- **SC-002**: `plugins/spec-driver/agents/refactor-plan.md` 文件存在且定义了影响分析和分批规划的 agent 行为
- **SC-003**: `orchestration.yaml` 的 `modes` 块包含已激活（非注释）的 `refactor` 模式定义，含 5 个 Phase
- **SC-004**: 调用 `/spec-driver:spec-driver-refactor --target <目标>` 能正确触发影响分析流程
- **SC-005**: 对已知重构目标执行后，全量残留扫描（grep 旧名称）返回 0 匹配
- **SC-006**: 重构完成后 `npm run repo:check` 通过
- **SC-007**: 现有 7 种模式（feature/story/implement/fix/resume/sync/doc）的功能不受影响（回归零）

## 模式对比

下表对比 refactor 模式与现有核心模式的关键差异：

| 维度 | feature 模式 | story 模式 | fix 模式 | **refactor 模式** |
|------|-------------|-----------|---------|------------------|
| 阶段数 | 10+ | 5 | 4 | 5 |
| 是否含调研 | 是（产品+技术） | 否 | 否 | 否 |
| 是否含规范 | 是（spec.md） | 是（spec.md） | 否 | 否（直接从目标开始） |
| 是否含规划 | 是（plan.md） | 是（plan.md） | 否 | 是（refactor-plan.md，侧重分批策略） |
| 影响分析 | 无 | 无 | 局部诊断 | 全仓库影响分析 |
| 实现方式 | 单次全量 | 单次全量 | 单次全量 | 分批逐步执行 |
| 中间验证 | 无 | 无 | 无 | 每批次独立验证 |
| 残留扫描 | 无 | 无 | 无 | 全量 grep 零残留 |
| 核心输入 | 需求描述 | 需求描述 | 问题描述 | `--target` 重构目标 |
| 新增 agent | 无 | 无 | 无 | refactor-plan.md |
| 新增 agent_mode | 无 | 无 | 无 | batch_loop |
| SKILL.md model | opus | opus | sonnet | opus |
| SKILL.md effort | high | high | medium | high |
