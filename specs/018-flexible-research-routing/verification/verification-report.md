# Verification Report: Feature 模式灵活调研路由

**特性分支**: `018-flexible-research-routing`
**验证日期**: 2026-02-27
**验证范围**: Layer 1 (Spec-Code 对齐) + 向后兼容验证 + 一致性检查 + Constitution 合规
**验证方法**: Spec 合规审查 + 文件内容交叉比对（纯 Prompt 工程项目，无构建/测试/Lint 工具链）

---

## Layer 1: Spec-Code Alignment

### 功能需求对齐

| FR | 描述 | 状态 | 对应 Task | 验证说明 |
|----|------|------|----------|----------|
| FR-001 | 6 种调研模式定义 | PASS | T009 | SKILL.md 第 254-265 行包含完整的模式-步骤映射表，定义了 `full`、`tech-only`、`product-only`、`codebase-scan`、`skip`、`custom` 共 6 种模式及其对应的调研步骤组合 |
| FR-002 | 每种模式的输出制品集合 | PASS | T009, T014 | 映射表中每种模式的步骤组合隐含了输出制品；完成报告段（第 574-599 行）按 6 种模式条件展示制品列表，`full` 输出 3 份、`tech-only` 仅 tech-research.md、`skip` 全部标注"[已跳过]"、`codebase-scan` 标注内嵌摘要 |
| FR-003 | 智能推荐逻辑 | PASS | T015 | SKILL.md 第 172-208 行实现了完整的关键词-模式推荐规则：产品信号词（15 个）、技术信号词（12 个）、市场信号词（6 个），6 条规则按优先级排列，默认回退到 `full`。覆盖了 spec.md 中列出的所有信号类型 |
| FR-004 | 推荐展示与交互确认 | PASS | T016 | SKILL.md 第 211-235 行定义了交互展示格式：推荐模式 + 推荐理由 + 6 种模式编号列表（含一行说明），支持直接回车确认、编号选择、无效输入重试 |
| FR-005 | 向后兼容（无 research 配置段时默认 full） | PASS | T018, T001, T002 | SKILL.md 第 53 行明确说明：research 段不存在时默认 `{default_mode: "auto", custom_steps: []}`，auto 模式等同智能推荐，无产品/技术/市场信号时回退到 `full`（规则 6），行为与升级前一致 |
| FR-006 | spec-driver.config.yaml 新增 research 配置段 | PASS | T001, T002, T017 | spec-driver.config.yaml 第 43-49 行和 spec-driver.config-template.yaml 第 69-75 行均包含 `research:` 顶级段，含 `default_mode: auto` 和 `custom_steps: []` 字段，注释列出全部 7 个有效 default_mode 值 |
| FR-007 | 后续阶段上下文注入适配 | PASS | T012 | SKILL.md Phase 2（第 400-414 行）和 Phase 4（第 465-478 行）均实现了 6 种模式的条件上下文注入逻辑，非 `full` 模式追加模式提示引导子代理适配 |
| FR-008 | tech-research 软依赖降级 | PASS | T003-T007 | tech-research.md 角色描述改为"基于产品调研结论（如有）或需求描述"（第 5 行）；输入定义标注 product-research.md 为可选（第 10 行）；步骤 1 包含 if/else 分支（第 22-27 行）；约束和失败处理均已更新（第 76 行、第 90 行）；步骤 6 降级为"需求-技术对齐度评估"（第 51-53 行） |
| FR-009 | GATE_RESEARCH 模式感知分级门禁 | PASS | T011 | SKILL.md 第 347-391 行实现了完整的 5 分支门禁逻辑：`full`（现有行为）、`tech-only`/`product-only`（单份报告摘要 + 切换 full 选项）、`codebase-scan`（扫描摘要 + 切换选项）、`skip`（跳过门禁）、`custom`（实际制品摘要）。每个分支含 always/auto/on_failure 三种 behavior 处理 |
| FR-010 | 进度显示跳过标注 | PASS | T013 | SKILL.md 第 684-711 行定义了完整的进度编号映射表，分母固定为 10，跳过格式为 `[{N}/10] {阶段名} [已跳过 - 调研模式: {research_mode}]`，附带 tech-only 模式示例 |
| FR-011 | `--research <mode>` 命令行参数 | PASS | T019-T021 | 触发方式（第 17-18 行）含 `--research` 示例；输入解析表格（第 30 行）包含参数说明和有效值列表；解析规则（第 32 行）含无效值错误处理和回退逻辑；Phase 0.5（第 152-154 行）实现 CLI 最高优先级 |
| FR-012 | 调研跳过决策记录 | PASS | T025 | SKILL.md 第 239-248 行定义了 skip 模式的决策记录逻辑：在 spec.md YAML Front Matter 中添加 `research_mode: skip` 和 `research_skip_reason`，记录三种来源（命令行/配置文件/用户选择） |
| FR-013 | GATE_DESIGN 在所有模式下保持启用 | PASS | T026 | SKILL.md 第 454 行显式说明"GATE_DESIGN 不因调研模式（research_mode）变化而受影响。无论调研模式为 full、skip 还是其他任何模式，GATE_DESIGN 在 feature 模式下始终保持硬门禁行为" |
| FR-014 | 完成报告动态适配 | PASS | T014 | SKILL.md 第 559-615 行完成报告包含 6 种模式的条件分支，每种模式列出实际生成的制品（标记为"已跳过"或"内嵌"），`custom` 模式根据 custom_steps 动态标记 |
| FR-015 | `--rerun research` 重新进入模式选择 | PASS | T024 | SKILL.md 第 654 行明确说明：`--rerun research` 时"重新进入调研模式确定流程（Phase 0.5），用户可选择与上次不同的调研模式。不直接重跑上次使用的模式" |

### 覆盖率摘要

- **总 FR 数**: 15
- **已实现 (PASS)**: 15
- **未实现 (FAIL)**: 0
- **部分实现 (PARTIAL)**: 0
- **覆盖率**: 100% (15/15)

### Task 完成状态

tasks.md 中共 28 个 Task（T001-T028），全部标记为 `[x]`（已完成）。
FR 覆盖映射表确认 15 条 FR 均有对应 Task 覆盖，无遗漏。

---

## 向后兼容验证

### 验证项 1: `full` 模式执行路径一致性

| 检查项 | 结果 | 说明 |
|--------|------|------|
| Phase 1a 产品调研 | PASS | `full` 模式执行条件明确包含 Phase 1a（SKILL.md 第 295 行），执行逻辑与现有行为一致 |
| Phase 1b 技术调研 | PASS | `full` 模式下串行依赖产品调研，传入 product-research.md 路径（SKILL.md 第 309 行），与现有行为一致 |
| Phase 1c 产研汇总 | PASS | `full` 模式执行条件明确包含 Phase 1c（SKILL.md 第 318 行），编排器亲自执行，逻辑未变 |
| GATE_RESEARCH | PASS | `full` 模式门禁逻辑（SKILL.md 第 352-359 行）标注"现有行为，完全保留"，展示 research-synthesis.md 摘要 |
| Phase 2 上下文注入 | PASS | `full` 模式注入 3 份调研制品路径（SKILL.md 第 402-403 行），与现有行为一致 |
| Phase 4 上下文注入 | PASS | `full` 模式注入 spec.md + 3 份调研制品路径（SKILL.md 第 466-467 行），与现有行为一致 |

**结论**: `full` 模式的执行路径与修改前 100% 一致，无行为变更。

### 验证项 2: 配置文件缺失 `research` 段时的默认行为

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 配置加载逻辑 | PASS | SKILL.md 第 53 行: "如果 `research` 段不存在，默认使用 `{default_mode: "auto", custom_steps: []}`" |
| `auto` 回退到智能推荐 | PASS | Phase 0.5 步骤 2: "auto 或未配置或 research 段不存在 -> 继续步骤 3（智能推荐）"（SKILL.md 第 159 行） |
| 智能推荐默认回退 | PASS | 规则 6（默认）: "以上规则均未命中 -> 推荐 full"（SKILL.md 第 206-208 行），确保无特征信号时等同 `full` |
| 无报错无警告 | PASS | 配置段不存在属于正常路径（非"无效值"分支），不触发任何警告输出 |

**结论**: 配置文件中不存在 `research` 段时，行为回退到 `auto` -> 智能推荐 -> 默认 `full`，与升级前完全一致。

### 验证项 3: 非调研阶段编排逻辑未变

| 阶段 | 结果 | 说明 |
|------|------|------|
| Phase 0 (Constitution 检查) | PASS | SKILL.md 第 133-137 行，逻辑未修改 |
| Phase 2 (需求规范) | PASS | 核心 Task 调用逻辑未变，仅在上下文注入中增加了条件分支（增量变更，不影响 `full` 模式路径） |
| Phase 3 (需求澄清) | PASS | SKILL.md 第 422-428 行，逻辑完全未变 |
| Phase 3.5 (GATE_DESIGN) | PASS | SKILL.md 第 432-455 行，硬门禁逻辑未变，仅增加了一行注释说明不受调研模式影响 |
| Phase 4 (技术规划) | PASS | 核心 Task 调用逻辑未变，仅在上下文注入中增加了条件分支 |
| Phase 5 (任务分解) | PASS | SKILL.md 第 486-514 行，逻辑完全未变 |
| Phase 6 (代码实现) | PASS | SKILL.md 第 518-523 行，逻辑完全未变 |
| Phase 7 (验证闭环) | PASS | SKILL.md 第 526-555 行，逻辑完全未变 |

**结论**: Phase 2-7 的核心编排逻辑完全未受调研模式变更影响。Phase 2 和 Phase 4 的变更仅为上下文注入内容的条件扩展，`full` 模式路径与原始逻辑一致。

---

## 一致性检查

### 检查项 1: 模式名拼写统一性

对 6 种模式名在所有修改文件中的拼写进行全文检索：

| 模式名 | SKILL.md | tech-research.md | spec-driver.config.yaml | template.yaml | 一致性 |
|--------|----------|-------------------|-------------------|---------------|--------|
| `full` | 出现于映射表、条件分支、完成报告、进度表 | N/A（不直接引用模式名） | 注释中列出 | 注释中列出 | PASS |
| `tech-only` | 出现于映射表、条件分支、完成报告、进度表、示例 | N/A | 注释中列出 | 注释中列出 | PASS |
| `product-only` | 出现于映射表、条件分支、完成报告、进度表 | N/A | 注释中列出 | 注释中列出 | PASS |
| `codebase-scan` | 出现于映射表、条件分支、完成报告、进度表 | N/A | 注释中列出 | 注释中列出 | PASS |
| `skip` | 出现于映射表、条件分支、完成报告、进度表、决策记录 | N/A | 注释中列出 | 注释中列出 | PASS |
| `custom` | 出现于映射表、步骤解析逻辑、条件分支、完成报告 | N/A | 注释中列出 | 注释中列出 | PASS |

**无拼写变体**: 全文未出现 `techonly`、`tech_only`、`productonly`、`codebasescan` 等非标准写法。

**结论**: 6 种模式名拼写在所有文件中保持完全一致。

### 检查项 2: 进度编号与流程一致性

| 编号 | 阶段定义 | 条件执行定义 | 跳过标注 | 进度映射表 | 完成报告 | 一致性 |
|------|----------|-------------|----------|-----------|----------|--------|
| 1/10 | Phase 0 Constitution | 始终执行 | N/A | 第 690 行 | N/A | PASS |
| 2/10 | Phase 1a / codebase-scan | 条件: full/product-only/custom/codebase-scan | 第 301 行 | 第 691 行 | N/A | PASS |
| 3/10 | Phase 1b | 条件: full/tech-only/custom | 第 314 行 | 第 692 行 | N/A | PASS |
| 4/10 | Phase 1c + GATE_RESEARCH | 条件: full/custom(synthesis) | 第 326 行 | 第 693 行 | N/A | PASS |
| 5/10 | Phase 2 需求规范 | 始终执行 | N/A | 第 694 行 | N/A | PASS |
| 6/10 | Phase 3 + 3.5 | 始终执行 | N/A | 第 695 行 | N/A | PASS |
| 7/10 | Phase 4 技术规划 | 始终执行 | N/A | 第 696 行 | N/A | PASS |
| 8/10 | Phase 5 + 5.5 | 始终执行 | N/A | 第 697 行 | N/A | PASS |
| 9/10 | Phase 6 实现 | 始终执行 | N/A | 第 698 行 | N/A | PASS |
| 10/10 | Phase 7 验证 | 始终执行 | N/A | 第 699 行 | N/A | PASS |

**分母固定**: SKILL.md 第 686 行明确"分母固定为 10"，第 571 行完成报告也使用"10/10"。

**结论**: 进度编号从 1/10 到 10/10 连续，与流程阶段一一对应，无断裂或重复。

### 检查项 3: 上下文注入格式统一性

| 维度 | Phase 2 (第 400-416 行) | Phase 4 (第 465-480 行) | 一致性 |
|------|------------------------|------------------------|--------|
| `full` 注入格式 | 前序制品: 3 份调研文件 | 前序制品: spec.md + 3 份调研文件 | PASS（Phase 4 额外含 spec.md，符合阶段依赖） |
| `tech-only` 注入格式 | 调研模式 + 前序制品: tech-research.md | 调研模式 + 前序制品: spec.md + tech-research.md | PASS |
| `product-only` 注入格式 | 调研模式 + 前序制品: product-research.md | 调研模式 + 前序制品: spec.md + product-research.md | PASS |
| `codebase-scan` 注入格式 | 调研模式 + 代码上下文摘要 | 调研模式 + 前序制品: spec.md + 代码上下文摘要 | PASS |
| `skip` 注入格式 | 调研模式: skip + 无调研制品提示 | 调研模式: skip + 前序制品: spec.md | PASS |
| `custom` 注入格式 | 调研模式 + 实际制品路径列表 | 调研模式 + 前序制品: spec.md + 实际制品路径列表 | PASS |
| 非 full 模式提示 | 有（第 416 行） | 有（第 480 行） | PASS |

**结论**: Phase 2 和 Phase 4 的上下文注入逻辑结构对称，条件分支一致，Phase 4 额外包含 spec.md 符合阶段依赖关系。

### 检查项 4: GATE_DESIGN 在所有模式下保持硬门禁

| 检查点 | 位置 | 内容 | 结果 |
|--------|------|------|------|
| 硬门禁声明 | SKILL.md 第 438 行 | "feature 模式 -> GATE_DESIGN 强制暂停（不检查配置，硬门禁）" | PASS |
| 不受配置覆盖 | SKILL.md 第 453 行 | "gates 配置中对 GATE_DESIGN 的覆盖在 feature 模式下亦不生效" | PASS |
| 不受调研模式影响 | SKILL.md 第 454 行 | "GATE_DESIGN 不因调研模式（research_mode）变化而受影响" | PASS |
| 门禁行为表默认值 | SKILL.md 第 80 行 | GATE_DESIGN: always（关键且硬门禁） | PASS |
| 门禁日志格式 | SKILL.md 第 451 行 | 包含 decision=PAUSE, reason=硬门禁 | PASS |

**结论**: GATE_DESIGN 在所有调研模式下保持硬门禁行为，无绕过路径。

---

## Constitution 合规验证

### 原则 VIII: Prompt 工程优先

> "所有编排行为通过 Markdown Prompt 和 YAML 配置实现。子代理行为由 Prompt 文件定义，不依赖编程逻辑。"

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 行为变更通过 Prompt 实现 | PASS | 本特性修改了 4 个文件：SKILL.md（主编排 Prompt）、tech-research.md（子代理 Prompt）、spec-driver.config.yaml（YAML 配置）、spec-driver.config-template.yaml（YAML 模板），均为 Markdown/YAML 文件 |
| 未引入运行时代码 | PASS | tasks.md 确认"不新增文件"，全部变更为现有 Prompt 和配置的修改 |
| 模板与逻辑分离 | PASS | 配置模板仅定义字段和注释，编排逻辑在 SKILL.md 中定义 |

**结论**: PASS -- 完全符合原则 VIII。

### 原则 IX: 零运行时依赖

> "spec-driver 插件不依赖任何 npm 包或外部运行时。全部由 Markdown Prompt、YAML 配置和 Bash 辅助脚本构成。"

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 无新增 npm 依赖 | PASS | 无 package.json 变更，无新增 import/require |
| 无新增运行时依赖 | PASS | 智能推荐使用关键词匹配 + 启发式规则实现（SKILL.md 第 176-208 行），不引入额外 LLM 调用或外部 API |
| 开箱即用 | PASS | 所有变更为 Markdown 和 YAML 文本修改，在任何 Claude Code 环境中均可直接使用 |

**结论**: PASS -- 完全符合原则 IX。

### 原则 XII: 向后兼容

> "配置文件和流程变更不得破坏现有用户的体验。"

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 未配置新字段时行为不变 | PASS | research 段不存在 -> 默认 auto -> 智能推荐 -> 默认 full（向后兼容验证项 2 已确认） |
| 无法识别的值输出警告不阻断 | PASS | 无效 default_mode 值输出警告并回退到 auto（SKILL.md 第 160 行）；无效 custom_steps 步骤名输出警告并忽略（SKILL.md 第 277 行） |
| 约定优于配置 | PASS | 用户只需修改 `research.default_mode` 一个配置项即可切换全局调研行为 |
| 不引入新运行时依赖 | PASS | 同原则 IX 检查结果 |

**结论**: PASS -- 完全符合原则 XII。

---

## Layer 2: Native Toolchain

本特性为纯 Prompt 工程项目（修改 Markdown 和 YAML 文件），无构建/测试/Lint 工具链。

| 验证项 | 状态 | 说明 |
|--------|------|------|
| Build | N/A | 纯 Prompt 工程项目，无构建步骤 |
| Lint | N/A | Markdown/YAML 文件无 Lint 工具配置 |
| Test | N/A | 无单元测试，验收通过手动端到端测试 |

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100% (15/15 FR) |
| Task Completion | 100% (28/28 Tasks) |
| 向后兼容 | PASS (full 模式路径 100% 一致，配置缺失时正确回退) |
| 一致性检查 | PASS (模式名拼写统一、进度编号连续、上下文注入格式对称、GATE_DESIGN 硬门禁完整) |
| Constitution 合规 | PASS (原则 VIII + IX + XII 全部通过) |
| Build Status | N/A (纯 Prompt 工程项目) |
| Lint Status | N/A (纯 Prompt 工程项目) |
| Test Status | N/A (纯 Prompt 工程项目) |
| **Overall** | **PASS -- READY FOR REVIEW** |

### 发现的问题

无。全部 15 条 FR 已实现，28 个 Task 已完成，向后兼容、一致性和 Constitution 合规验证均通过。

### 建议

1. **端到端验收测试**: 建议在实际 Claude Code 环境中分别以 `full`、`tech-only`、`skip` 三种模式执行 Feature 流程，验证运行时行为与 Prompt 定义一致（对应 SC-001 至 SC-006）。

2. **智能推荐效果验证**: 建议使用 spec.md US-1 Independent Test 中的三种典型需求描述进行实际测试，验证推荐结果的合理性。

---

**验证人**: Spec Driver 验证闭环子代理
**验证模型**: Claude Opus 4.6
