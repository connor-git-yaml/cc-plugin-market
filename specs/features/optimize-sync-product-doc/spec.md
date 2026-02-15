# 功能规范：优化 Sync 产品文档质量与结构

**Feature Branch**: `feature/optimize-sync-product-doc`
**Created**: 2026-02-15
**Status**: Draft
**Input**: 优化 sync 命令，基于行业最佳实践提升产品级活文档的内容质量和结构完整性

---

## 概述

当前 sync 命令生成的产品级活文档（current-spec.md）仅包含 7 个章节（产品概述、功能全集、技术架构、已知限制、废弃功能、变更历史、附录），缺少行业标准产品文档中的多个关键章节，如目标与成功指标、用户画像与场景、非功能需求、假设与风险、范围与边界、术语表、设计原则与决策记录等。本次优化的目标是将产品文档模板扩展至行业最规范水平，同时优化 sync 子代理 prompt 以确保生成质量。

**涉及修改的文件**（均为声明式 Plugin 文件，无编译型代码）：
1. `plugins/spec-driver/templates/product-spec-template.md` -- 产品文档模板
2. `plugins/spec-driver/agents/sync.md` -- sync 子代理 prompt
3. `plugins/spec-driver/skills/speckit-sync/SKILL.md` -- sync 技能入口（微调）

---

## User Scenarios & Testing

### User Story 1 - 生成结构完整的产品活文档 (Priority: P1)

作为**产品负责人或技术 Leader**，我希望 sync 命令生成的产品文档包含行业标准的完整章节结构（目标与成功指标、用户画像与场景、非功能需求、范围与边界、术语表等），以便我能用一份文档全面了解产品的当前状态，而不需要翻阅多份零散的增量 spec。

**Why this priority**: 这是本次优化的核心目标。当前模板缺少关键章节导致产品文档信息不完整，无法作为单一信息源（Single Source of Truth）使用。补全章节结构是所有后续优化的前提。

**Independent Test**: 运行 sync 命令后检查生成的 current-spec.md，验证其包含所有预期章节且各章节内容非空。

**Acceptance Scenarios**:

1. **Given** 项目中存在至少 3 个增量功能 spec，**When** 用户执行 `/spec-driver:speckit-sync`，**Then** 生成的 current-spec.md 包含以下全部顶级章节：产品概述、目标与成功指标、用户画像与场景、范围与边界、当前功能全集、非功能需求、当前技术架构、设计原则与决策记录、已知限制与技术债、假设与风险、被废弃的功能、变更历史、术语表、附录。

2. **Given** 增量 spec 中未显式提及某些章节的信息（如用户画像），**When** sync 子代理执行聚合，**Then** 子代理应从 spec 内容中推断并填充，或标注 `[待补充: 增量 spec 中缺少此类信息]` 而非留空。

3. **Given** 生成的产品文档，**When** 非技术背景的产品利益相关者阅读该文档，**Then** 文档应使用中文撰写（代码标识符保持英文），内容面向业务可理解，不包含纯技术实现细节。

---

### User Story 2 - sync 子代理高质量聚合能力 (Priority: P1)

作为**研发团队成员**，我希望 sync 子代理的 prompt 能指导 LLM 按照优化后的模板结构进行高质量的内容聚合，确保新增章节的信息能从已有增量 spec 中智能提取和推断，而非产生空洞的占位符内容。

**Why this priority**: 模板扩展后，若子代理 prompt 不同步更新，生成的文档新增章节将只有空壳结构而无实质内容，反而降低文档质量。模板和 prompt 必须同步优化。

**Independent Test**: 对比优化前后 sync 命令产出的 current-spec.md，验证新增章节有实质内容且与增量 spec 信息一致。

**Acceptance Scenarios**:

1. **Given** sync 子代理 prompt 已更新为包含新章节的聚合指导，**When** 子代理处理包含用户场景描述的增量 spec，**Then** 生成文档的「用户画像与场景」章节应包含从 spec 中提取的目标用户和使用场景信息。

2. **Given** 多个增量 spec 中出现了相同的技术术语但描述略有差异，**When** 子代理执行聚合，**Then** 生成文档的「术语表」章节应包含该术语的统一定义，并标注信息来源。

3. **Given** 增量 spec 中包含性能要求、兼容性说明等非功能需求，**When** 子代理执行聚合，**Then** 生成文档的「非功能需求」章节应汇总这些需求并按类别（性能、兼容性、安全等）分组。

4. **Given** 增量 spec 中的 plan.md 包含关键设计决策，**When** 子代理执行聚合，**Then** 生成文档的「设计原则与决策记录」章节应提取这些决策并注明来源 spec 编号。

---

### User Story 3 - 产品映射数据完整性修复 (Priority: P2)

作为**使用 sync 命令的开发者**，我希望 product-mapping.yaml 中的产品名和 spec 列表与代码库现状保持一致（产品名 `speckitdriver` 更新为 `spec-driver`，缺失的 spec 013/014 被补全），以便 sync 命令能正确识别和归属所有功能 spec。

**Why this priority**: 映射数据不完整会导致部分 spec 在聚合时被遗漏，影响产品文档的完整性。但这属于数据修正而非结构优化，优先级略低于核心模板和 prompt 的改进。

**Independent Test**: 检查 product-mapping.yaml 中 spec-driver 产品下是否包含 013、014 条目，且产品名为 `spec-driver` 而非 `speckitdriver`。

**Acceptance Scenarios**:

1. **Given** product-mapping.yaml 中 `speckitdriver` 产品条目，**When** sync 子代理执行聚合，**Then** 产品名应更新为 `spec-driver`，描述应体现 v3.0.0 版本信息。

2. **Given** specs 目录中存在 013-split-skill-commands 和 014-rename-spec-driver 目录，**When** sync 子代理扫描功能目录，**Then** 这两个 spec 应被正确归属到 spec-driver 产品并出现在映射文件中。

---

### User Story 4 - 文档质量门控 (Priority: P2)

作为**产品文档维护者**，我希望 sync 命令在生成完产品文档后，能对文档进行基本的质量检查并在报告中反馈质量状态，以便我快速判断文档是否需要人工补充。

**Why this priority**: 质量门控能在自动化流程中发现文档缺陷，减少人工审核成本。但它不直接提升文档内容质量，依赖于模板和 prompt 优化先行，因此为 P2。

**Independent Test**: 运行 sync 命令后查看输出报告中的质量检查部分，验证其正确报告了各章节的填充状态。

**Acceptance Scenarios**:

1. **Given** sync 命令执行完毕，**When** 输出聚合完成报告，**Then** 报告中应包含「文档质量」部分，列出每个顶级章节的填充状态（已填充 / 待补充 / 不适用）。

2. **Given** 某个章节内容为占位符或信息不足，**When** 质量检查执行，**Then** 该章节应被标记为「待补充」，并给出补充建议。

---

### Edge Cases

- **增量 spec 数量极少（仅 1 个 INITIAL spec）时**：新增章节（如设计原则、术语表）可能缺乏足够的信息来源。sync 子代理应标注 `[待补充: 产品尚处早期阶段，建议在后续迭代中逐步完善]` 而非留空或虚构内容。
- **增量 spec 之间存在术语不一致**：术语表章节应识别并统一，以最新 spec 的定义为准，注明历史用法的差异。
- **非功能需求散布在多个 spec 中且相互矛盾**：以编号更大的 spec 为准，在非功能需求章节中标注冲突解决记录。
- **产品映射手动编辑后与自动推断冲突**：手动条目优先，自动推断仅补充手动映射中缺失的条目（现有约束，需保持）。
- **模板章节过多导致短期产品文档臃肿**：对于 spec 数量少于 3 个的产品，sync 子代理应自动折叠信息不足的章节（保留标题但标注「待补充」），避免空洞章节影响阅读体验。

---

## Requirements

### Functional Requirements

#### 模板扩展（product-spec-template.md）

- **FR-001**: 模板 MUST 新增「目标与成功指标」章节，包含产品级 KPI 定义、基线值、目标值的结构化占位符。
- **FR-002**: 模板 MUST 新增「用户画像与场景」章节，包含目标用户描述、用户痛点、核心使用场景的结构化占位符。
- **FR-003**: 模板 MUST 新增「非功能需求」章节，按性能、安全、可扩展性、可用性、兼容性分类组织。
- **FR-004**: 模板 MUST 新增「假设与风险」章节，包含关键假设列表和风险矩阵（影响 x 概率）结构。
- **FR-005**: 模板 MUST 新增「范围与边界」章节，明确区分「范围内」与「范围外」的功能边界。
- **FR-006**: 模板 MUST 新增「术语表」章节，提供术语-定义-来源的表格结构。
- **FR-007**: 模板 MUST 新增「设计原则与决策记录」章节，包含产品设计原则和关键决策（类 ADR 格式：决策 / 上下文 / 理由 / 来源 spec）的结构。
- **FR-008**: 模板 SHOULD 将现有的「关键设计决策」从「当前技术架构」章节中迁移至新增的「设计原则与决策记录」章节，避免信息重复。[AUTO-CLARIFIED: 迁移后技术架构章节保留交叉引用链接（"详见【设计原则与决策记录】"），避免信息孤岛]
- **FR-009**: 模板中所有章节的占位符文本 MUST 使用中文，代码标识符和变量名保持英文，遵循双语规范。
- **FR-010**: 模板 MUST 保持向后兼容——现有 7 个章节的结构和占位符不得删除，仅允许增强和重新排序。

#### 子代理 Prompt 优化（agents/sync.md）

- **FR-011**: sync 子代理 prompt MUST 新增对新增章节（FR-001 至 FR-007）的聚合指导，说明如何从增量 spec 中提取信息填充每个新章节。
- **FR-012**: sync 子代理 prompt MUST 包含「信息推断规则」——当增量 spec 中无显式信息时，指导子代理如何从上下文推断（如从 User Stories 推断用户画像，从边界条件推断非功能需求）。
- **FR-013**: sync 子代理 prompt MUST 包含「内容质量标准」——定义每个章节的最低内容要求（如术语表至少包含 5 个关键术语，非功能需求至少覆盖性能和兼容性两个维度）。[AUTO-CLARIFIED: 非功能需求维度要求为建议性而非强制，若增量 spec 中无对应信息则标注"待补充"而非臆造] [NEEDS USER DECISION: 术语表"至少 5 个术语"是否允许在信息不足时降级为标注"待补充"——详见澄清会话]
- **FR-014**: sync 子代理 prompt SHOULD 在输出结构中新增「质量评估」部分，报告每个章节的填充完整度（完整 / 部分 / 待补充）。
- **FR-015**: sync 子代理 prompt MUST 更新产品映射维护逻辑，确保产品名 `speckitdriver` 更新为 `spec-driver`，并能识别 013、014 编号的 spec。[AUTO-RESOLVED: 从代码上下文可知产品已于 v3.0.0 重命名为 spec-driver，映射文件中的旧名称应在 sync 执行时自动修正] [AUTO-CLARIFIED: sync 子代理在加载映射时自动检测并替换旧产品名，同时写回 product-mapping.yaml，无需人工预先修改]

#### 技能入口微调（SKILL.md）

- **FR-016**: SKILL.md 的聚合完成报告 SHOULD 新增「文档质量」字段，展示各章节的填充状态统计。

### Key Entities

- **产品文档模板 (product-spec-template.md)**: 定义产品级活文档的完整章节结构和占位符，是 sync 子代理的生成蓝图。从 7 章节扩展至约 14 章节。
- **sync 子代理 Prompt (agents/sync.md)**: 指导 LLM 如何将增量 spec 聚合为产品活文档的完整指令集。需与模板结构同步。
- **产品映射 (product-mapping.yaml)**: 记录产品与功能 spec 的归属关系，是 sync 聚合的元数据基础。
- **产品活文档 (current-spec.md)**: sync 命令的最终产出物，反映产品当前完整状态的单一信息源。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 优化后生成的 current-spec.md 包含不少于 14 个顶级章节（覆盖行业标准的完整产品文档结构）。
- **SC-002**: 每个非空章节的内容长度不少于 3 行有效文本（排除标题和占位符标记），确保内容有实质性。
- **SC-003**: 新增章节中至少 70% 能从已有增量 spec 中提取到实质内容（而非全部标注「待补充」），验证推断能力。
- **SC-004**: product-mapping.yaml 中所有产品名与代码库现状一致，无遗漏 spec 条目。
- **SC-005**: 聚合完成报告包含质量状态信息，使用者无需逐章节人工检查即可了解文档完整度。

---

## Constraints & Boundaries

### 范围内

- 修改 product-spec-template.md 模板，新增行业最佳实践章节
- 修改 agents/sync.md 子代理 prompt，新增聚合指导和质量标准
- 微调 SKILL.md 中的输出报告格式
- 修正 product-mapping.yaml 中的产品名和缺失条目

### 范围外

- 不修改 sync 命令的编排流程逻辑（SKILL.md 中的步骤 1/2/3 保持不变）
- 不修改增量 spec 的文件结构或内容
- 不新增运行时依赖或编译型代码
- 不涉及其他子代理（research、spec、plan、tasks、implement、checklist 等）的修改
- 不重构 sync 子代理的产品归属判定算法

### 注意事项

- [无调研基础] 本 spec 基于需求描述中注入的代码上下文摘要和行业调研结论生成，未通过独立的 research 阶段。
- 所有修改仅涉及 Markdown 和 YAML 声明式文件，无需编译或测试执行。

---

## Dependencies & Impacts

### 依赖

- 现有增量 spec（specs/001-xxx 至 specs/014-xxx）作为 sync 聚合的输入源
- Claude LLM (Opus 模型) 作为 sync 子代理的执行引擎

### 影响范围

- 所有后续执行 `/spec-driver:speckit-sync` 命令的产品文档输出将采用新模板结构
- 已有产品文档（specs/products/reverse-spec/current-spec.md 和 specs/products/spec-driver/current-spec.md）将在下次 sync 执行时被新格式覆盖
- 文档章节数增加可能导致单次 sync 的 LLM token 消耗略有增长

---

## Clarifications

### Session 2026-02-15

#### 自动澄清记录

1. **新增章节的排序位置**
   - **决策**: 按行业标准文档流程排序：概述 → 目标 → 用户 → 范围 → 功能 → 非功能 → 架构 → 设计决策 → 限制 → 风险 → 废弃 → 变更 → 术语 → 附录
   - **理由**: 符合 PRD/Technical Spec 最佳实践（从战略 → 战术 → 实施 → 追溯的阅读顺序），且 FR-010 允许重新排序
   - **影响**: 需在 product-spec-template.md 中按此顺序组织顶级章节

2. **关键设计决策的交叉引用策略**
   - **决策**: 迁移至新章节后，技术架构章节保留交叉引用链接（"详见【设计原则与决策记录】"）
   - **理由**: 提升文档可导航性，符合单一信息源原则但允许多入口访问
   - **影响**: FR-008 已更新，sync 子代理需生成引用链接

3. **非功能需求最低覆盖维度的强制性**
   - **决策**: FR-013 中"至少覆盖性能和兼容性"为建议性要求，若增量 spec 无对应信息则标注"[待补充: 增量 spec 中未明确此维度]"
   - **理由**: 与 Edge Cases 中"标注待补充而非虚构"的原则一致，避免 LLM 臆造非功能需求
   - **影响**: FR-013 已更新标注，sync 子代理 prompt 需包含此容错逻辑

4. **产品映射修正的执行时机**
   - **决策**: sync 子代理在加载映射时自动检测旧产品名（speckitdriver）并替换为 spec-driver，同时写回 product-mapping.yaml
   - **理由**: FR-015 已明确为 MUST 要求且标注了 AUTO-RESOLVED，应由自动化流程处理以减少人工成本
   - **影响**: FR-015 已更新标注，agents/sync.md 需包含产品名自动修正逻辑

#### 待用户决策的 CRITICAL 问题

1. **术语表最低要求的实施策略**
   - **问题**: FR-013 要求"术语表至少包含 5 个关键术语"，但 Edge Cases 提到"仅 1 个 INITIAL spec 时可能缺乏足够信息来源，应标注待补充而非虚构内容"。当增量 spec 中可提取的术语少于 5 个时，应如何处理？
   - **推荐**: 选项 B — 以真实性为先，允许术语表在增量 spec 信息不足时少于 5 个术语，标注"待补充"
   - **选项**:
     - A: 严格执行"至少 5 个术语"要求，信息不足时由 LLM 从通用领域推断补充至 5 个（可能引入非产品专有的冗余术语）
     - B: 以真实性为先，允许术语表在增量 spec 信息不足时少于 5 个，标注"待补充"（避免虚构内容但早期产品术语表可能较短）
     - C: 设定分层要求：增量 spec ≥3 个时要求 5 个术语，<3 个时允许 3 个术语（平衡质量和真实性但增加判断逻辑复杂度）
   - **状态**: 待用户回复（已在 FR-013 中标注 NEEDS USER DECISION）
