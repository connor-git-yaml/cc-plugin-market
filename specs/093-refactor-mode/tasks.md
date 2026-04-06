---
title: Feature 093 任务清单 - 大规模重构模式
feature_id: 093
version: 1.0
created: 2026-04-06
status: pending
---

# Tasks: 大规模重构模式（spec-driver-refactor Skill）

**Input**: `specs/093-refactor-mode/` 下的 spec.md + plan.md
**Prerequisites**: plan.md（必须）、spec.md（必须）

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1-US5）

---

## Phase 1: Setup（配置层准备）

**Purpose**: 激活 orchestration.yaml refactor 模式定义，更新 fallback 配置

- [ ] T001 [US4] 修改 `plugins/spec-driver/config/orchestration.yaml`：将文末注释化的 refactor 模板替换为 spec 定义的 5 Phase 正式配置
  - 替换 `# refactor:` 注释块为正式 `refactor:` 模式定义
  - 5 Phase: impact_analysis, batch_planning, batch_implement, residual_scan, final_verify
  - 确保 `name`, `description`, `phases[]` 结构与现有模式一致
  - 在 gates 块中为 GATE_TASKS 和 GATE_VERIFY 的 `applicable_modes` 添加 `refactor`
  - 确认现有 7 种模式的定义不受影响

- [ ] T002 [US4] 修改 `plugins/spec-driver/lib/orchestrator-fallback.mjs`：在 `modes` 对象中新增 `refactor` fallback 定义
  - 添加 refactor 模式的最小化 fallback Phase 序列（3 Phase: implement -> residual_scan -> verify）
  - 确认现有 7 种模式的 fallback 定义不变

**Checkpoint**: orchestration.yaml 和 fallback 配置就绪，可通过 `npm run repo:check` 验证文件格式

---

## Phase 2: Foundational（Agent 层构建）

**Purpose**: 创建 refactor-plan agent，为影响分析和分批规划提供 LLM 行为定义

- [ ] T003 [US1][US2] 新建 `plugins/spec-driver/agents/refactor-plan.md`：定义影响分析和分批规划 agent 的完整行为规范
  - frontmatter: `model: opus`, `tools: [Read, Bash, Grep, Glob]`, `effort: high`
  - **角色定义**：重构规划师，负责全仓库影响分析和分批策略
  - **Phase 1 行为（impact_analysis）**:
    - 从编排器接收 `--target` 参数（文件路径/模块名/概念名）
    - 使用 Grep/Glob 扫描全仓库直接引用（import/require/re-export）
    - 分析间接引用（通过中间模块的传递引用链）
    - 检测跨包引用（monorepo workspace 间的引用路径）
    - 生成风险评级（low/medium/high/critical，基于影响文件数和跨包标记）
    - 输出 `impact-report.md` 至 `{feature_dir}/`
  - **Phase 2 行为（batch_planning）**:
    - 读取 Phase 1 产出的 impact-report.md
    - 按依赖拓扑将影响文件划分为有序批次
    - 每批文件数不超过默认上限（10 个），可通过 `--batch-size` 覆盖
    - 确保批次间依赖正确（不出现先改者依赖后改者）
    - 输出 `refactor-plan.md` 至 `{feature_dir}/`
  - **输出格式**：impact-report.md 和 refactor-plan.md 的 Markdown 结构定义
  - **边界处理**：目标不存在时报错终止；影响文件数为 0 时提示确认；>100 文件时提升风险等级

**Checkpoint**: agent 定义完成，可独立阅读验证行为规范的完整性

---

## Phase 3: User Story 4 - SKILL.md 与 orchestration.yaml 集成（Priority: P2）

**Goal**: 创建 spec-driver-refactor Skill 编排器入口，驱动 5 Phase 序列

### Implementation

- [ ] T004 [US4] 新建 `plugins/spec-driver/skills/spec-driver-refactor/SKILL.md`：编排器入口文件
  - **frontmatter**: `name: spec-driver-refactor`, `description: "大规模代码重构 — 5 阶段完成：影响分析-分批规划-逐批实现-残留扫描-最终验证"`, `disable-model-invocation: true`, `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`, `model: opus`, `effort: high`
  - **触发方式**: `/spec-driver:spec-driver-refactor --target <重构目标> [描述]`
  - **参数解析**:
    - `--target`（必选）：重构目标
    - `--preset`（可选）：模型预设覆盖
    - `--batch-size`（可选）：每批最大文件数
    - `--dry-run`（可选）：仅执行 Phase 1-2
    - 描述文本（可选）：首个非 flag 参数
  - **初始化阶段**: 插件路径发现 -> 项目环境检查 -> Constitution 处理 -> 配置加载 -> Project Context 注入（与现有 SKILL 模式一致）
  - **Phase 1 编排**: 加载 orchestration.yaml refactor 模式 Phase 1 定义 -> 派遣 refactor-plan agent（传递 `--target` 和 phase=impact_analysis）-> 接收 impact-report.md
  - **Phase 2 编排**: 派遣 refactor-plan agent（传递 phase=batch_planning + impact-report.md 路径）-> 接收 refactor-plan.md -> 执行 GATE_TASKS
  - **dry-run 短路**: 若 `--dry-run`，在 Phase 2 完成后输出报告并终止
  - **高风险暂停**: 若 impact-report.md 风险评级为 critical，暂停要求用户确认后再进入 Phase 3
  - **Phase 3 编排（batch_loop）**:
    - 读取 refactor-plan.md 中的批次列表
    - 对每个 batch 依次：派遣 implement agent（传递 batch scope）-> 中间验证（类型检查 + 当前批次残留扫描）
    - 中间验证失败 -> 暂停，报告失败详情，等待用户决策（继续/中止/修复后重试）
    - 连续 2 个 batch 验证失败 -> 建议中止
  - **Phase 4 编排（残留扫描）**: 编排器内联执行 `grep -rn` 扫描旧名称/旧路径 -> 输出残留报告 -> 零残留则继续，否则列出残留位置
  - **Phase 5 编排**: 派遣 verify agent -> 执行 GATE_VERIFY -> 输出最终验证报告
  - **完成报告**: 输出重构执行摘要（批次数、修改文件数、残留检查结果、验证状态）
  - **行数控制**: 不超过 500 行（NFR-001）

**Checkpoint**: SKILL.md 创建完成，可通过 `/spec-driver:spec-driver-refactor --help` 验证参数解析

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: 验证向后兼容性和全模式回归

- [ ] T005 验证 orchestration.yaml 变更的向后兼容性
  - 运行 `npm run repo:check`，确认文件同步状态正常
  - 确认现有 7 种模式（feature/story/implement/fix/resume/sync/doc）的 Phase 序列定义未被修改
  - 确认 GATE_TASKS 和 GATE_VERIFY 的 `applicable_modes` 数组新增了 `refactor` 但其他条目未变

- [ ] T006 验证 orchestrator-fallback.mjs 的完整性
  - 确认新增的 refactor fallback 定义结构正确
  - 确认 `generateFallbackConfig()` 函数返回的对象包含 `modes.refactor`
  - 确认现有 7 种模式的 fallback 定义未被修改

- [ ] T007 验证新建文件的规范合规性
  - SKILL.md: frontmatter 完整（name, description, disable-model-invocation, allowed-tools, model, effort）
  - SKILL.md: 行数不超过 500 行（NFR-001）
  - refactor-plan.md: frontmatter 完整（model, tools, effort）
  - 所有新建文件的目录结构符合插件规范（agents/*.md, skills/spec-driver-*/SKILL.md）

- [ ] T008 运行全局验证命令
  - 执行 `npm run repo:check`，确认全部通过
  - 执行 `npm run repo:sync`（如适用），确认无同步漂移

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无前置依赖，可立即开始
- **Phase 2 (Foundational)**: 无强依赖于 Phase 1（agent 定义独立于配置），但建议 T001 先完成以便 T003 参考 Phase 名称
- **Phase 3 (SKILL.md)**: 依赖 T001（orchestration.yaml Phase 定义）和 T003（agent 文件路径引用）
- **Phase 4 (Polish)**: 依赖所有前序 Phase 完成

### 任务依赖图

```
T001 ─┐
      ├── T004 ── T005/T006/T007/T008
T002 ─┘     │
T003 ───────┘
```

- T001 和 T002 可并行（不同文件）
- T003 可与 T001/T002 并行（独立文件），但 T004 需等待 T001 和 T003 完成
- T005-T008 全部依赖 T004 完成后方可执行

### Parallel Opportunities

- T001 + T002: 不同文件，可并行
- T001/T002 + T003: 不同文件，可并行
- T005 + T006 + T007: 验证检查独立，可并行
- T008 依赖 T005-T007 全部通过

---

## Implementation Strategy

### MVP First

1. 完成 T001 + T002（配置层就绪）
2. 完成 T003（agent 层就绪）
3. 完成 T004（编排器就绪 -- 核心交付物）
4. 验证 T005-T008（兼容性确认）

### 工时估计

| 任务 | 估计工时 | 说明 |
|------|---------|------|
| T001 | 15 分钟 | 替换注释块为正式 YAML 定义，更新 Gate applicable_modes |
| T002 | 10 分钟 | 在现有 fallback 对象中新增 refactor 条目 |
| T003 | 40 分钟 | 新建 agent 文件，定义影响分析和分批规划的完整行为规范 |
| T004 | 60 分钟 | 新建 SKILL.md，实现 5 Phase 编排循环（最复杂任务） |
| T005-T007 | 15 分钟 | 回归验证检查 |
| T008 | 5 分钟 | 运行全局验证命令 |
| **总计** | **~2.5 小时** | |

---

## Notes

- 所有新建文件使用中文散文 + 英文代码标识符
- SKILL.md 参考现有 spec-driver-fix/SKILL.md 和 spec-driver-implement/SKILL.md 的结构
- refactor-plan.md 参考现有 agents/implement.md 的 frontmatter 格式
- 不引入 spec.md 中未定义的功能（如 FR-018 可视化依赖图标注为 MAY，本次不实现）
- `--batch-size`（FR-012, SHOULD）和 `--dry-run`（FR-011, SHOULD）在 SKILL.md 中实现参数解析
- 影响文件 >100 自动提升风险（FR-013, SHOULD）在 refactor-plan.md agent 中实现
