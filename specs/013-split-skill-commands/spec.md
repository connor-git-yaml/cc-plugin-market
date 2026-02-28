# Feature Specification: 拆分 Speckit Driver Pro 技能命令

**Feature Branch**: `013-split-skill-commands`
**Created**: 2026-02-15
**Status**: Draft
**Input**: User description: "将 speckit-driver-pro Plugin 的单一技能 speckit-driver-pro 拆分为三个独立技能：run（主编排流程）、resume（恢复中断流程）、sync（产品规范聚合）"
**Research Basis**: [research-synthesis.md](research/research-synthesis.md)

## User Scenarios & Testing

### User Story 1 - 独立执行产品规范聚合 (Priority: P1)

作为技术主管，我希望通过一个独立的 `/speckit-driver-pro:sync` 命令执行产品规范聚合，而不需要加载完整的 10 阶段编排逻辑，这样我可以在最小上下文开销下快速完成日常的规范同步工作。

**Why this priority**: sync 是最轻量、使用频率最高的操作，也是新用户接触 Speckit Driver Pro 的最低门槛入口。将其独立出来可立即验证拆分的核心价值——上下文预算优化和命令可发现性提升。sync 的独立可用性是验证整个拆分方案可行性的最快路径。

**Independent Test**: 在安装了 Speckit Driver Pro Plugin 的 Claude Code 环境中，输入 `/speckit-driver-pro:sync` 即可独立执行规范聚合流程，无需先运行 run 或 resume。整个聚合流程（扫描 specs/ 目录、合并为 current-spec.md、生成报告）可在不涉及其他技能的情况下完整完成。

**Acceptance Scenarios**:

1. **Given** 用户已安装 Speckit Driver Pro Plugin 且项目中存在 `specs/` 目录下的增量 spec 文件，**When** 用户输入 `/speckit-driver-pro:sync`，**Then** 系统仅加载 sync 技能的内容（约 120 行），执行规范聚合流程并生成产品级活文档 `current-spec.md`
2. **Given** 用户在 Claude Code 中输入 `/speckit-driver-pro:` 并查看补全菜单，**When** 补全菜单展示可用技能列表，**Then** sync 命令独立显示，其 description 为"聚合功能规范为产品级活文档"
3. **Given** sync 技能的 `disable-model-invocation` 设为 false，**When** 用户在对话中讨论"规范聚合"或"产品文档同步"相关话题，**Then** Claude 可自动判断是否加载 sync 技能（支持渐进式功能发现）

---

### User Story 2 - 通过独立命令启动完整研发流程 (Priority: P1)

作为全栈开发者，我希望通过语义清晰的 `/speckit-driver-pro:run` 命令启动 Spec-Driven Development 的完整 10 阶段编排流程，而不是使用一个承载了所有功能的单体命令，这样命令意图更明确，Claude 加载的上下文也更精准。

**Why this priority**: run 是 Speckit Driver Pro 的核心功能载体，承载主编排流程的全部逻辑。将其作为独立技能是拆分的基础性工作，也是用户最频繁使用的命令。run 技能必须包含 10 阶段编排、初始化、失败重试、选择性重跑（`--rerun`）和模型选择的完整逻辑。

**Independent Test**: 在 Claude Code 环境中输入 `/speckit-driver-pro:run 添加用户认证功能` 即可触发完整的 10 阶段编排流程（调研、规范、规划、实现、验证等），流程运行不依赖 resume 或 sync 技能的存在。

**Acceptance Scenarios**:

1. **Given** 用户已安装 Speckit Driver Pro Plugin，**When** 用户输入 `/speckit-driver-pro:run 添加用户认证功能`，**Then** 系统加载 run 技能（约 350 行），执行完整的 10 阶段编排流程
2. **Given** 用户需要选择性重跑某个阶段，**When** 用户输入 `/speckit-driver-pro:run --rerun specify`，**Then** 系统在 run 技能的上下文中执行指定阶段的重跑逻辑
3. **Given** run 技能的 `disable-model-invocation` 设为 true，**When** 用户在普通对话中讨论项目需求，**Then** Claude 不会自动触发 run 技能（避免重量级编排流程的意外执行）

---

### User Story 3 - 通过独立命令恢复中断的研发流程 (Priority: P1)

作为开发者，我希望通过独立的 `/speckit-driver-pro:resume` 命令恢复中断的研发流程，而不是通过主命令的 `--resume` 参数来触发恢复，这样恢复功能在 `/` 菜单中直接可见，我不需要记忆参数语法。

**Why this priority**: resume 是 Speckit Driver Pro 的差异化功能——市场上竞品（Cursor、GitHub Copilot、Windsurf、Aider）均未提供独立的工作流恢复命令。将 resume 提升为独立命令直接提升了这一差异化功能的可见性和可发现性。resume 必须包含精简的初始化逻辑（环境检查、配置加载、prompt 来源映射）和完整的制品扫描与恢复执行逻辑。

**Independent Test**: 在 Claude Code 环境中，当某个功能的编排流程在中途中断后（如网络断开或手动中止），输入 `/speckit-driver-pro:resume` 即可扫描已有制品并从断点恢复执行，无需重新启动完整的 run 流程。

**Acceptance Scenarios**:

1. **Given** 用户之前通过 run 启动的编排流程在中途中断，特性目录中已有部分阶段的制品文件，**When** 用户输入 `/speckit-driver-pro:resume`，**Then** 系统加载 resume 技能（约 150 行），扫描已有制品确定恢复点，从断点阶段继续执行
2. **Given** 用户在 `/` 菜单中浏览可用命令，**When** 用户输入 `/speckit-driver-pro:` 查看补全菜单，**Then** resume 命令独立显示，其 description 为"恢复中断的 Speckit 研发流程"
3. **Given** resume 技能的 `disable-model-invocation` 设为 true，**When** 用户在对话中提到"继续之前的工作"，**Then** Claude 不会自动触发 resume 技能（避免意外执行恢复操作）

---

### User Story 4 - 新成员通过命令菜单发现功能 (Priority: P2)

作为新加入团队的成员，我希望在 Claude Code 的 `/` 补全菜单中看到 Speckit Driver Pro 的三个独立命令（run、resume、sync）及各自的功能描述，这样我无需阅读完整文档就能理解可用功能并选择合适的命令。

**Why this priority**: 命令可发现性是拆分的关键产品价值之一，但它是拆分完成后的自然结果而非独立的功能实现。此 Story 验证拆分后的整体用户体验，而非某个具体技能的功能正确性。

**Independent Test**: 在安装了 Speckit Driver Pro Plugin 的 Claude Code 环境中输入 `/speckit-driver-pro:`，验证补全菜单中展示三个命令及各自的 description，且旧的 `/speckit-driver-pro:speckit-driver-pro` 命令不再存在。

**Acceptance Scenarios**:

1. **Given** 用户已安装拆分后的 Speckit Driver Pro Plugin，**When** 用户在 Claude Code 中输入 `/speckit-driver-pro:`，**Then** 补全菜单中展示 run、resume、sync 三个命令，每个命令附带独立且语义清晰的 description
2. **Given** 旧的 `skills/speckit-driver-pro/` 目录已被删除，**When** 用户尝试输入 `/speckit-driver-pro:speckit-driver-pro`，**Then** 该命令不存在，系统不识别此调用

---

### User Story 5 - 删除旧技能完成迁移闭环 (Priority: P1)

作为 Plugin 维护者，我需要在三个新技能创建并验证可用后，删除旧的 `skills/speckit-driver-pro/` 目录，确保新旧命令不会共存引起用户混淆，且删除操作不影响 Plugin 的其他组件（agents/、hooks/、scripts/、templates/）。

**Why this priority**: 删除旧技能是完成迁移闭环的必要步骤。如果旧技能目录保留，用户将在 `/` 菜单中同时看到新旧命令，导致功能重叠和使用困惑。此步骤是拆分 MVP 的必要组成部分。

**Independent Test**: 删除 `skills/speckit-driver-pro/` 目录后，验证 Plugin 的 agents/、hooks/、scripts/、templates/ 等组件仍然正常工作，且 `/speckit-driver-pro:` 补全菜单中不再出现旧的 `speckit-driver-pro` 技能。

**Acceptance Scenarios**:

1. **Given** 三个新技能（run、resume、sync）已创建并通过验证，**When** 维护者删除 `skills/speckit-driver-pro/` 目录，**Then** Plugin 的 agents/、hooks/、scripts/、templates/ 目录及其内容不受影响
2. **Given** 旧技能目录已删除，**When** Claude Code 重新加载 Plugin，**Then** Plugin 正常注册，`/speckit-driver-pro:` 补全菜单仅显示 run、resume、sync 三个命令

---

### Edge Cases

- **制品目录不存在时执行 resume**: 用户在没有任何已有制品的情况下执行 `/speckit-driver-pro:resume`，resume 技能应检测到无可恢复的制品并给出明确提示，建议用户使用 `/speckit-driver-pro:run` 启动新流程（关联 FR-006）
- **specs/ 目录为空时执行 sync**: 用户在项目中尚无任何 spec 文件时执行 `/speckit-driver-pro:sync`，sync 技能应检测到空目录并给出明确提示（关联 FR-007）
- **三个技能在同一会话中连续调用**: 用户在同一 Claude Code 会话中先后执行 run、resume、sync，每个技能应独立加载自身上下文，不受前一个技能的上下文残留影响（关联 FR-010）
- **旧命令路径尝试**: 用户习惯性输入旧的 `/speckit-driver-pro:speckit-driver-pro` 或 `/speckit-driver-pro --resume` 格式，系统应无法识别这些命令（因旧技能目录已删除），用户需使用新的命令格式（关联 US-5）
- **run 技能中 `--rerun` 指定不存在的阶段**: 用户执行 `/speckit-driver-pro:run --rerun invalidphase`，run 技能应识别无效阶段名称并给出错误提示，列出有效的阶段名称（关联 FR-005）
- **Plugin 其他组件存在对旧技能路径的意外引用**: 虽然技术调研已验证 agents/、hooks/、scripts/、templates/ 与 skills/ 独立，但实施阶段应逐一检查所有 Plugin 组件文件中是否包含对 `skills/speckit-driver-pro/` 的引用，以排除意外的路径依赖（关联 US-5、FR-009）
- **Strangler Fig 共存期间新旧技能并存**: 在迁移过程中，新技能（run/resume/sync）创建后、旧技能（speckit-driver-pro）删除前，四个技能将短暂共存于 `/speckit-driver-pro:` 补全菜单中。此阶段用户可能看到新旧命令同时存在。共存期间仅用于验证新技能的功能正确性，验证通过后应立即删除旧技能目录，不应长时间保持共存状态 [AUTO-CLARIFIED: 共存仅为过渡态 -- 技术调研推荐 Strangler Fig 模式的核心目的是降低回滚风险，而非长期并行运行]（关联 FR-012、US-5）

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `skills/run/` 目录下创建独立的 `SKILL.md` 文件，包含完整的 10 阶段编排流程、初始化逻辑、子代理失败重试、选择性重跑（`--rerun`）、模型选择逻辑和阶段进度编号映射（关联 US-2）
- **FR-002**: 系统 MUST 在 `skills/resume/` 目录下创建独立的 `SKILL.md` 文件，包含精简的初始化逻辑（环境检查、配置加载、prompt 来源映射）和完整的中断恢复机制（制品扫描、恢复点确定、恢复执行）。resume 的初始化 MUST 不包含"特性目录准备"步骤（因目录已存在），但 MUST 包含额外的制品扫描逻辑。resume 技能 MUST 包含模型选择逻辑的配置加载部分（读取 spec-driver.config.yaml 中的模型配置），以便恢复执行时使用正确的模型设置，但 MUST NOT 重复完整的模型选择决策表（该表仅在 run 技能中维护） [AUTO-CLARIFIED: resume 需配置加载而非完整决策表 -- 技术调研 L238-239 指出 resume 仅需"配置加载"，run 才需要"完整表"]（关联 US-3）
- **FR-003**: 系统 MUST 在 `skills/sync/` 目录下创建独立的 `SKILL.md` 文件，包含产品规范聚合模式的完整流程（扫描 specs/ 目录、合并增量 spec、生成 current-spec.md 活文档）。sync 技能 MUST 不包含编排流程或恢复逻辑，职责单一（关联 US-1）
- **FR-004**: 每个 SKILL.md MUST 配置正确的 frontmatter 字段：`name`（分别为 run、resume、sync）、`description`（使用具体动作词和技术术语的语义描述）、`disable-model-invocation`（run 和 resume 设为 true，sync 设为 false）（关联 US-1、US-2、US-3、US-4）
- **FR-005**: run 技能 MUST 包含 `--rerun <phase>` 选择性重跑功能。resume 技能 MUST NOT 包含重跑逻辑 [AUTO-RESOLVED: 产研汇总已明确决策 `--rerun` 归入 run 技能，因为 rerun 需要完整的编排流程上下文（10 阶段定义、质量门）]（关联 US-2）
- **FR-006**: resume 技能 MUST 在无可恢复制品时给出明确提示，建议用户使用 `/speckit-driver-pro:run` 启动新流程（关联 Edge Case: 制品目录不存在）
- **FR-007**: sync 技能 MUST 在 specs/ 目录为空或不存在时给出明确提示，而非静默失败（关联 Edge Case: specs/ 目录为空）
- **FR-008**: 系统 MUST 删除旧的 `skills/speckit-driver-pro/` 目录及其内容，确保旧的 `/speckit-driver-pro:speckit-driver-pro` 命令不再可用（关联 US-5）
- **FR-009**: 删除旧技能目录 MUST NOT 影响 Plugin 的其他组件目录：`agents/`、`hooks/`、`scripts/`、`templates/`、`.claude-plugin/`、`spec-driver.config.yaml`（关联 US-5）
- **FR-010**: 三个新技能 MUST 各自自包含（完全独立拆分），不依赖其他技能文件或共享引用文件 [AUTO-RESOLVED: 产研汇总一致推荐方案 A（完全独立拆分），共享模块 `_shared/` 明确归入二期]（关联 US-1、US-2、US-3）
- **FR-011**: 三个技能文件中引用的模板路径和子代理 prompt 路径 MUST 使用与拆分前相同的路径格式（如 `plugins/speckit-driver-pro/templates/...`、`plugins/speckit-driver-pro/agents/...`），确保 Claude Code 能正确定位外部资源（关联 US-2、US-3）
- **FR-012**: 迁移过程 SHOULD 采用 Strangler Fig 模式：先创建三个新技能并验证可用，再删除旧技能目录，以降低回滚风险（关联 US-5）
- **FR-013**: sync 技能的 `description` SHOULD 包含具体技术术语（如"specs/"、"current-spec.md"），以提高 Claude 自动触发的精确度，避免泛化词汇导致误触发（关联 US-1）

### Non-Functional Requirements

- **NFR-001**: 每个 SKILL.md 文件 SHOULD 控制在 Claude Code 官方建议的 1,500-2,000 words（约 200-400 行）最佳实践范围内。预估行数分布：run 约 350 行、resume 约 150 行、sync 约 120 行。resume 和 sync 低于 200 行是合理的（职责范围较小），关键约束为不超过 400 行上限 [AUTO-CLARIFIED: 一致性分析 F-001 修正——原 200-350 行下限与 resume/sync 预估矛盾，改为以官方 words 建议为主、行数上限为辅]

### Key Entities

- **SKILL.md**: 技能定义文件，包含 frontmatter 配置和技能逻辑的 Markdown 文件。Claude Code Plugin 通过自动发现 `skills/*/SKILL.md` 注册可调用命令
- **Frontmatter**: SKILL.md 文件头部的 YAML 配置块，包含 name（技能名）、description（功能描述，影响命令补全菜单展示和自动触发判断）、disable-model-invocation（是否禁止 Claude 基于对话内容自动加载该技能）
- **Feature Directory**: `specs/{feature-branch}/` 下的特性目录，存放编排流程产生的制品文件（spec.md、tasks.md 等），是 run 和 resume 技能操作的核心数据目录
- **Plugin Components**: Plugin 的非技能组件，包括 agents/（子代理 prompt）、hooks/（生命周期钩子）、scripts/（初始化脚本）、templates/（文档模板），与 skills/ 目录独立

## Success Criteria

### Measurable Outcomes

- **SC-001**: 在 Claude Code 的 `/speckit-driver-pro:` 补全菜单中，run、resume、sync 三个命令各自独立可见，且每个命令的 description 准确反映其功能职责
- **SC-002**: `/speckit-driver-pro:sync` 可独立完成产品规范聚合流程（扫描、合并、生成报告），执行过程中 Claude 仅加载 sync 技能内容（约 120 行），而非原有的 706 行单体文件
- **SC-003**: `/speckit-driver-pro:run <需求描述>` 可执行完整的 10 阶段编排流程，功能与拆分前等价，包括初始化、编排、重试、重跑和模型选择的全部能力
- **SC-004**: `/speckit-driver-pro:resume` 可扫描已有制品并从断点恢复编排流程，功能与拆分前的 `--resume` 参数等价
- **SC-005**: 旧的 `/speckit-driver-pro:speckit-driver-pro` 命令不再存在，旧技能目录已被完整删除
- **SC-006**: Plugin 的其他组件（agents/、hooks/、scripts/、templates/）在拆分前后功能无变化，子代理 prompt 引用路径正常工作

## Clarifications

### Session 2026-02-15

| # | 问题 | 自动选择 | 理由 | 关联需求 |
| --- | ------ | --------- | ------ | --------- |
| 1 | Strangler Fig 共存期间（新旧技能并存时），四个技能同时出现在补全菜单中的行为是否需要特殊处理？ | 无需特殊处理，共存仅为短暂过渡态 | 技术调研推荐 Strangler Fig 模式的核心目的是降低回滚风险。Claude Code 自动发现机制天然支持新旧技能共存。共存期间仅用于功能验证，验证通过后立即删除旧技能目录 | FR-012, US-5, Edge Cases |
| 2 | resume 技能中应包含模型选择逻辑的哪些部分？完整的模型选择决策表还是仅配置加载？ | 仅包含配置加载部分，不重复完整决策表 | 技术调研内容归属表（L238-239）明确指出 run 需要"完整表"，resume 仅需"配置加载"。resume 从 spec-driver.config.yaml 读取模型配置即可恢复执行，不需要重复 run 中的模型选择决策逻辑 | FR-002 |
| 3 | SKILL.md 文件行数是否需要设置明确的上限约束？ | 是，添加 NFR-001 明确行数建议范围 | Claude Code 官方文档建议 SKILL.md 控制在 1,500-2,000 words（约 200-300 行）。技术调研预估三个技能分别为 350/150/120 行，均在合理范围内。将此建议转化为 SHOULD 级别约束（而非 MUST），保留实现灵活性 | NFR-001 |
