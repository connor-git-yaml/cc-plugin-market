# Feature Specification: 调研模板纳入 specify-base 同步体系

**Feature Branch**: `021-add-research-templates`
**Created**: 2026-03-02
**Status**: Draft
**Input**: User description: "将调研模板补齐到 specify-base 和 .specify/templates 的同步体系中，使用户可以通过项目级目录定制调研模板。"

[无调研基础]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 调研模板自动同步到项目级目录 (Priority: P1)

作为 Spec Driver 用户，我希望在执行 `speckit feature` 流程时，系统自动将调研模板（产品调研、技术调研、产研汇总、验证报告）同步到项目的 `.specify/templates/` 目录下，使我无需手动拷贝即可拥有完整的模板集。

**Why this priority**: 这是本需求的核心价值。当前 `REQUIRED_TEMPLATES` 仅包含 6 个基础模板，调研模板被遗漏导致用户无法在项目级定制调研报告格式。补齐同步列表是后续所有定制能力的前提。

**Independent Test**: 在一个全新项目中首次运行 Spec Driver 流程，验证 `.specify/templates/` 目录下同时出现 6 个基础模板和 4 个调研模板。

**Acceptance Scenarios**:

1. **Given** 项目 `.specify/templates/` 目录不存在任何调研模板, **When** 用户首次运行触发模板同步的流程, **Then** 系统自动从 specify-base 复制 `product-research-template.md`、`tech-research-template.md`、`research-synthesis-template.md`、`verification-report-template.md` 到 `.specify/templates/` 目录
2. **Given** 项目 `.specify/templates/` 已存在用户自定义的 `product-research-template.md`, **When** 用户再次运行同步流程, **Then** 系统不覆盖用户已有的自定义模板（幂等保护）
3. **Given** specify-base 中新增了调研模板文件, **When** 用户运行同步流程, **Then** 仅缺失的模板被补齐，已有模板保持不变

---

### User Story 2 - 子代理优先使用项目级调研模板 (Priority: P1)

作为 Spec Driver 用户，我希望 product-research、tech-research 子代理以及编排器在生成调研报告时，优先使用项目级 `.specify/templates/` 下的调研模板而非 plugin 内置模板，使我可以通过修改项目级模板来定制调研报告的结构和内容。

**Why this priority**: 同步模板到项目级目录的核心目的是支持定制。如果子代理仍然硬编码引用 plugin 内置路径，用户的定制将不生效，整个功能失去意义。此 Story 与 Story 1 共同构成 MVP。

**Independent Test**: 修改项目级 `.specify/templates/product-research-template.md` 的内容（如新增一个自定义章节），运行产品调研子代理，验证生成的调研报告使用了自定义章节结构。

**Acceptance Scenarios**:

1. **Given** 项目 `.specify/templates/product-research-template.md` 存在用户自定义版本, **When** product-research 子代理执行调研, **Then** 子代理使用项目级模板而非 plugin 内置模板
2. **Given** 项目 `.specify/templates/tech-research-template.md` 存在用户自定义版本, **When** tech-research 子代理执行调研, **Then** 子代理使用项目级模板而非 plugin 内置模板
3. **Given** 项目 `.specify/templates/research-synthesis-template.md` 存在用户自定义版本, **When** 编排器执行产研汇总, **Then** 编排器使用项目级模板而非 plugin 内置模板
4. **Given** 项目 `.specify/templates/` 下不存在某调研模板, **When** 对应子代理或编排器执行调研, **Then** 回退使用 plugin 内置模板（向后兼容）

---

### User Story 3 - specify-base 包含完整调研模板 (Priority: P1)

作为 Spec Driver 维护者，我希望 `plugins/spec-driver/templates/specify-base/` 目录包含所有调研模板的基准版本，作为同步到项目级目录的源文件，保证模板同步机制有统一的源头。

**Why this priority**: specify-base 是模板同步的"单一事实源"。当前调研模板散落在 `plugins/spec-driver/templates/` 根目录而非 specify-base 子目录中，导致同步机制无法覆盖它们。将调研模板的基准版本纳入 specify-base 是同步链路的基础设施前提。

**Independent Test**: 检查 `plugins/spec-driver/templates/specify-base/` 目录，验证其中包含 4 个调研模板文件，且内容与 plugin 根目录下的对应模板一致。

**Acceptance Scenarios**:

1. **Given** specify-base 目录当前仅有 6 个基础模板, **When** 本功能实施完成, **Then** specify-base 目录新增 `product-research-template.md`、`tech-research-template.md`、`research-synthesis-template.md`、`verification-report-template.md` 共 4 个调研模板
2. **Given** specify-base 中的调研模板作为基准版本, **When** 用户运行同步流程, **Then** 这些基准版本被复制到 `.specify/templates/` 目录

---

### User Story 4 - 验证报告模板可项目级定制 (Priority: P2)

作为 Spec Driver 用户，我希望验证报告模板也纳入同步体系，使我可以根据项目的验证需求定制验证报告的结构（例如添加特定行业合规检查项）。

**Why this priority**: 验证报告模板的定制需求频率低于调研模板，但对于有特定合规要求的项目场景仍有价值。该 Story 不影响 MVP 的核心调研流程，属于同步体系的完整性补充。

**Independent Test**: 修改项目级 `.specify/templates/verification-report-template.md`，运行 verify 子代理，验证生成的验证报告使用了自定义模板。

**Acceptance Scenarios**:

1. **Given** 项目 `.specify/templates/verification-report-template.md` 存在用户自定义版本, **When** verify 子代理执行验证, **Then** 子代理使用项目级模板而非 plugin 内置模板
2. **Given** 项目级不存在该模板, **When** verify 子代理执行验证, **Then** 回退使用 plugin 内置模板

---

### Edge Cases

- **用户删除了项目级调研模板后重新同步**: 系统应重新从 specify-base 复制该模板（幂等行为，等同首次同步）
- **specify-base 中的模板与 plugin 根目录下的模板内容不一致**: specify-base 应始终是权威源，plugin 根目录下的模板作为子代理的最终回退，两者应保持内容一致
- **部分模板同步成功、部分失败（如磁盘空间不足）**: 同步函数应返回成功和失败的明细列表，不做全局回滚
- **用户在 `.specify/templates/` 中创建了同名但完全无关内容的文件**: 系统不应覆盖，遵守幂等保护原则，用户对项目级模板拥有完全控制权
- **多个 Spec Driver 实例并发执行同步**: 同步操作应为幂等的文件复制，并发场景下不会产生数据损坏（目标文件存在则跳过）

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** [Story 1, 3]: 系统 MUST 将 `product-research-template.md`、`tech-research-template.md`、`research-synthesis-template.md`、`verification-report-template.md` 纳入模板同步的必需列表（`REQUIRED_TEMPLATES`）
- **FR-002** [Story 3]: 系统 MUST 在 `plugins/spec-driver/templates/specify-base/` 目录中维护上述 4 个调研模板的基准版本
- **FR-003** [Story 1]: 模板同步函数 MUST 以幂等方式将调研模板从 specify-base 复制到项目 `.specify/templates/` 目录，已存在的模板不被覆盖
- **FR-004** [Story 2]: product-research 子代理 MUST 按照"项目级 `.specify/templates/` 优先，plugin 内置路径回退"的优先级加载 `product-research-template.md`
- **FR-005** [Story 2]: tech-research 子代理 MUST 按照相同的优先级策略加载 `tech-research-template.md`
- **FR-006** [Story 2]: 编排器 MUST 按照相同的优先级策略加载 `research-synthesis-template.md`
- **FR-007** [Story 4]: verify 子代理 SHOULD 按照相同的优先级策略加载 `verification-report-template.md`
- **FR-008** [Story 2]: 当项目级模板不存在时，子代理和编排器 MUST 回退到 plugin 内置路径，确保向后兼容
- **FR-009** [Story 1]: 同步函数 MUST 返回同步结果（已复制列表和缺失列表），供调用方获知同步状态
- **FR-010** [Story 1, 2]: 调研模板的同步和加载机制 MUST 与现有 6 个基础模板的同步和加载机制保持一致的行为模式

### Key Entities

- **调研模板 (Research Template)**: 用于规范调研报告输出结构的 Markdown 模板文件。包括产品调研、技术调研、产研汇总、验证报告四种类型。每种模板定义了章节结构和占位符。
- **specify-base**: plugin 内置的模板基准目录，是模板同步机制的"单一事实源"。当前包含 6 个基础模板，本功能将扩展至 10 个。
- **项目级模板目录 (`.specify/templates/`)**: 项目根目录下的模板目录，用户可在此定制模板。同步机制将 specify-base 的模板复制到此处，用户修改后不会被覆盖。
- **REQUIRED_TEMPLATES**: `specify-template-sync.ts` 中的常量数组，定义了同步机制需要管理的模板列表。本功能需将其从 6 项扩展为 10 项。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 执行模板同步后，`.specify/templates/` 目录包含全部 10 个模板文件（6 个基础 + 4 个调研），同步成功率 100%
- **SC-002**: 用户修改项目级调研模板后运行调研流程，生成的调研报告结构与用户自定义模板一致（定制生效率 100%）
- **SC-003**: 未配置项目级调研模板的既有项目在升级后运行调研流程，行为与升级前完全一致（向后兼容性 100%）
- **SC-004**: 重复执行模板同步操作不会覆盖用户已有的自定义模板（幂等保护率 100%）
