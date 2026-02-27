# Feature Specification: Feature 模式灵活调研路由

**Feature Branch**: `018-flexible-research-routing`
**Created**: 2026-02-27
**Status**: Draft
**Input**: User description: "优化 Spec Driver 的 Feature 模式，让调研阶段更加灵活：不再强制要求固定的产品调研+技术调研+综合流水线，提供多种常见调研模式供选择，根据用户实际 Feature 需求动态规划调研路径，支持完全跳过调研。"

> [无调研基础：基于代码上下文摘要]

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 编排器智能推荐调研模式 (Priority: P1)

作为一名使用 Spec Driver Feature 模式的开发者，我希望在输入需求描述后，编排器能自动分析我的需求特征并推荐最合适的调研模式，这样我不必手动判断"这个需求要不要做产品调研"或"要不要做技术调研"，编排器替我做出合理的初始判断，我只需确认或调整即可。

**Why this priority**: 这是整个特性的核心价值。当前 Feature 模式的最大痛点是无论需求大小都执行全套调研，浪费时间和 Token。智能推荐让编排器从"固定流水线"进化为"自适应流程"，是所有后续能力的基础。如果没有推荐机制，用户就必须自己理解各种调研模式的区别并手动选择，学习成本过高。

**Independent Test**: 分别输入三种典型需求描述（"开发一个面向企业的新产品模块"、"将项目从 CommonJS 迁移到 ESM"、"给现有命令增加一个 --verbose 参数"），验证编排器推荐的调研模式分别为 `full`、`tech-only`、`skip`（或类似合理结果），且用户可以一键确认。

**Acceptance Scenarios**:

1. **Given** 用户输入了一个涉及新产品方向的需求描述（如"开发面向中小企业的 SaaS 定价模块"），**When** 编排器解析需求特征后，**Then** 编排器推荐 `full` 模式（完整产品+技术调研），并向用户展示推荐理由（如"检测到新产品方向关键词，建议完整调研"）和可选的替代模式列表，等待用户确认。

2. **Given** 用户输入了一个纯技术重构类需求（如"将构建工具从 Webpack 迁移到 Vite"），**When** 编排器解析需求特征后，**Then** 编排器推荐 `tech-only` 模式，并解释"检测到技术迁移/重构特征，产品调研价值较低"。

3. **Given** 用户输入了一个小型增量功能（如"给 CLI 增加 --json 输出格式"），**When** 编排器解析需求特征后，**Then** 编排器推荐 `codebase-scan` 或 `skip` 模式，并解释推荐理由。

4. **Given** 编排器展示了推荐模式和替代列表，**When** 用户选择了不同于推荐的模式，**Then** 编排器按用户选择的模式继续执行，不再二次询问。

---

### User Story 2 - 调研模式预设与执行 (Priority: P1)

作为一名使用 Spec Driver 的开发者，我希望系统提供一组明确定义的调研模式预设（如完整调研、仅技术调研、仅产品调研、代码扫描、跳过调研），每种模式对应清晰的调研步骤组合，这样我可以根据需求类型快速选择合适的调研路径，而不是面对一堆模糊的配置选项。

**Why this priority**: 预设模式是推荐机制的基础。没有明确定义的模式，编排器就无法推荐，用户也无法手动选择。同时，预设模式确保了"向后兼容"——`full` 模式与当前 Feature 行为完全一致，现有用户零迁移成本。

**Independent Test**: 分别以 `full`、`tech-only`、`product-only`、`codebase-scan`、`skip` 模式执行 Feature 流程，验证每种模式执行了且仅执行了该模式定义的调研步骤，且后续阶段（规范、规划等）正常运行。

**Acceptance Scenarios**:

1. **Given** 调研模式确定为 `full`，**When** 编排器执行调研阶段，**Then** 按当前行为依次执行产品调研(Phase 1a) → 技术调研(Phase 1b) → 产研汇总(Phase 1c)，输出 product-research.md、tech-research.md、research-synthesis.md 三份制品，行为与现有版本完全一致。

2. **Given** 调研模式确定为 `tech-only`，**When** 编排器执行调研阶段，**Then** 仅执行技术调研（跳过产品调研和产研汇总），输出 tech-research.md 一份制品。技术调研子代理在无 product-research.md 输入时，直接基于需求描述和代码上下文执行。

3. **Given** 调研模式确定为 `product-only`，**When** 编排器执行调研阶段，**Then** 仅执行产品调研（跳过技术调研），输出 product-research.md 一份制品，不生成产研汇总。

4. **Given** 调研模式确定为 `codebase-scan`，**When** 编排器执行调研阶段，**Then** 执行与 Story 模式相同的代码库上下文扫描，生成代码上下文摘要（内嵌在上下文注入块中），不调用任何调研子代理，不执行 Web 搜索。

5. **Given** 调研模式确定为 `skip`，**When** 编排器执行调研阶段，**Then** 完全跳过调研，不生成任何调研制品，不执行代码扫描，直接进入需求规范阶段。进度编号从 [2/10] 或 [3/10] 或 [4/10] 跳转到 [5/10]（需求规范），中间被跳过的步骤显示为"[已跳过]"。

6. **Given** 调研模式确定为 `skip` 或 `codebase-scan`，**When** 后续进入需求规范阶段（Phase 2），**Then** 规范子代理的上下文注入中不包含 research-synthesis.md 路径，而是包含"调研模式: {模式名}"和代码上下文摘要（如有）。

---

### User Story 3 - 配置文件支持调研模式默认值 (Priority: P2)

作为一名项目维护者，我希望能在 driver-config.yaml 中配置默认的调研模式，这样团队中的所有成员使用 Feature 模式时都会遵循统一的调研策略，不需要每次手动选择。

**Why this priority**: 配置化是团队协作的基础。一个团队可能长期开发内部工具（适合 `tech-only`），配置默认值避免每次都要手动选择。但它的价值建立在 US1 和 US2 之上——先有推荐和预设，才有配置默认值的意义。

**Independent Test**: 在 driver-config.yaml 中设置 `research.default_mode: tech-only`，然后执行 Feature 模式，验证编排器推荐的默认模式变为 `tech-only`（而非智能推荐的结果），但用户仍可在交互时选择其他模式覆盖。

**Acceptance Scenarios**:

1. **Given** driver-config.yaml 中配置了 `research.default_mode: tech-only`，**When** 用户执行 Feature 模式，**Then** 编排器展示的推荐模式为 `tech-only`（配置优先于智能推荐），同时仍展示完整的可选模式列表。

2. **Given** driver-config.yaml 中未配置 `research.default_mode` 字段（或字段不存在），**When** 用户执行 Feature 模式，**Then** 编排器回退到智能推荐逻辑，行为与当前默认完全一致（即推荐 `full` 或基于需求特征推荐）。

3. **Given** driver-config.yaml 中配置了 `research.default_mode: auto`，**When** 用户执行 Feature 模式，**Then** 编排器执行智能推荐逻辑（`auto` 等同于未配置，表示由编排器根据需求特征自动判断）。

4. **Given** driver-config.yaml 中配置了无效的 `research.default_mode` 值（如 `research.default_mode: foobar`），**When** 用户执行 Feature 模式，**Then** 编排器忽略无效值，回退到智能推荐逻辑，并输出一条警告："driver-config.yaml 中 research.default_mode 值 'foobar' 无效，已回退到 auto 模式。有效值: full, tech-only, product-only, codebase-scan, skip, auto"。

---

### User Story 4 - 命令行参数覆盖调研模式 (Priority: P2)

作为一名开发者，我希望能通过命令行参数 `--research <mode>` 直接指定调研模式，跳过推荐和交互选择环节，这样在我明确知道要用什么模式时可以实现全自动化执行。

**Why this priority**: 命令行覆盖是 power user 的效率工具，也是 CI/CD 集成的前提。其优先级低于 US1-US3，因为大多数用户更依赖推荐和交互，但对自动化场景不可或缺。

**Independent Test**: 执行 `/spec-driver:speckit-feature --research skip "给 CLI 增加 --verbose 参数"`，验证编排器直接跳过调研，不展示推荐和选择交互。

**Acceptance Scenarios**:

1. **Given** 用户执行 `/spec-driver:speckit-feature --research tech-only "迁移到 ESM"`，**When** 编排器解析参数，**Then** 直接以 `tech-only` 模式执行调研，不展示推荐和模式选择交互。

2. **Given** 用户执行 `/spec-driver:speckit-feature --research skip "修复按钮样式"`，**When** 编排器解析参数，**Then** 完全跳过调研阶段，直接进入需求规范。

3. **Given** 用户提供了无效的 `--research` 参数值（如 `--research foo`），**When** 编排器解析参数，**Then** 输出错误提示："无效的调研模式 'foo'。有效值: full, tech-only, product-only, codebase-scan, skip"，并回退到推荐交互流程。

---

### User Story 5 - 自定义调研步骤组合 (Priority: P3)

作为一名高级用户，我希望能自定义调研步骤的组合（例如"产品调研 + 代码扫描，但不做技术调研"），这样我可以根据特殊场景灵活编排调研流程，不受预设模式的限制。

**Why this priority**: 自定义组合满足了长尾需求，但绝大多数场景下预设模式已足够。这是一个面向 power user 的高级功能，优先级最低。其实现也依赖 US1-US2 的模式框架。

**Independent Test**: 通过配置或命令行指定 `custom` 模式并定义步骤组合为 `[product-research, codebase-scan]`，验证编排器仅执行产品调研和代码扫描两个步骤。

**Acceptance Scenarios**:

1. **Given** driver-config.yaml 中配置了自定义调研步骤：`research.custom_steps: [product-research, codebase-scan]`，**When** 调研模式为 `custom`，**Then** 编排器依次执行产品调研和代码库扫描两个步骤，跳过技术调研和产研汇总。

2. **Given** 自定义步骤中包含 `tech-research` 但不包含 `product-research`，**When** 编排器执行自定义步骤，**Then** 技术调研子代理在无 product-research.md 输入时，直接基于需求描述和代码上下文执行（与 `tech-only` 模式行为一致）。

3. **Given** 自定义步骤列表为空或仅包含无效步骤名，**When** 编排器解析配置，**Then** 输出警告并回退到 `full` 模式。

---

### Edge Cases

- **GATE_RESEARCH 在非 full 模式下的行为**: 当调研模式为 `tech-only`、`product-only` 或 `codebase-scan` 时，编排器仍应在调研完成后展示调研成果摘要供用户确认（简化版门禁），但不生成 research-synthesis.md（仅 `full` 模式生成此文件）。`skip` 模式无任何门禁。 [关联 FR-006]

- **tech-research 子代理在无 product-research.md 时的降级**: `tech-only` 和 `custom`（不含 product-research）模式下，技术调研子代理当前硬依赖 product-research.md。子代理需能在缺少此输入时正常运行，直接基于需求描述和代码上下文执行技术调研。 [关联 FR-003]

- **后续阶段的调研制品依赖**: 需求规范（specify）和技术规划（plan）阶段当前的上下文注入中引用 research-synthesis.md。当该文件不存在时（非 `full` 模式），编排器应调整上下文注入，传入实际可用的调研制品路径（如仅 tech-research.md）或代码上下文摘要。 [关联 FR-007]

- **从 skip 模式切换到 full 模式**: 如果用户在 `skip` 模式下发现规范质量不足（如 clarify 阶段报告大量 CRITICAL 问题），编排器应提示用户可以通过 `--rerun research` 回退到调研阶段，此时应重新进入调研模式选择流程。 [关联 FR-008]

- **进度编号连续性**: 不同调研模式下实际执行的步骤数不同（`full` 为 10 步，`skip` 可能仅 7 步），进度显示需保持用户体验一致。被跳过的步骤应显示为 "[已跳过]" 而非直接删除编号，避免用户困惑。 [关联 FR-009]

- **向后兼容——未升级的 driver-config.yaml**: 如果用户的 driver-config.yaml 版本较旧，不含 `research` 配置段，系统应默认行为与当前版本完全一致（即 `full` 模式），不报错。 [关联 FR-005, FR-010]

- **Constitution 检查与调研跳过的交互**: Constitution 检查始终在调研之前执行。如果 Constitution 对调研有特殊要求（如"所有新产品方向必须经过产品调研"），`skip` 模式可能触发 Constitution VIOLATION。编排器应在 Constitution 检查时将用户选择的调研模式作为上下文传入。 [关联 FR-011]

## Requirements *(mandatory)*

### Functional Requirements

#### 调研模式定义

- **FR-001**: 系统 MUST 支持以下 6 种调研模式，每种模式定义了明确的调研步骤组合：
  - `full`: 产品调研 + 技术调研 + 产研汇总（当前默认行为，向后兼容）
  - `tech-only`: 仅技术调研（跳过产品调研和产研汇总）
  - `product-only`: 仅产品调研（跳过技术调研和产研汇总）
  - `codebase-scan`: 代码库上下文扫描（与 Story 模式相同的扫描逻辑）
  - `skip`: 完全跳过调研（不执行任何调研步骤，不扫描代码库）
  - `custom`: 用户自定义调研步骤组合
  [关联 US-2]

- **FR-002**: 每种调研模式 MUST 定义明确的输出制品集合：`full` 输出 product-research.md + tech-research.md + research-synthesis.md；`tech-only` 输出 tech-research.md；`product-only` 输出 product-research.md；`codebase-scan` 输出内嵌代码上下文摘要（非独立文件）；`skip` 无输出制品；`custom` 输出与所选步骤对应的制品子集。 [关联 US-2]

#### 智能推荐

- **FR-003**: 编排器 MUST 在调研阶段开始前，基于需求描述的文本特征推荐一个调研模式。推荐逻辑应考虑以下特征信号：
  - 新产品方向（如出现"新产品"、"市场"、"用户群体"、"定价"等关键词）→ 倾向 `full`
  - 技术选型/迁移/重构（如出现"迁移"、"重构"、"架构"、"性能优化"、"技术栈"等关键词）→ 倾向 `tech-only`
  - 小型增量功能（如出现"增加参数"、"修复"、"调整"、"优化"等关键词且描述较短）→ 倾向 `codebase-scan` 或 `skip`
  - 需要市场验证但技术明确（如出现"竞品"、"对标"等但无技术选型关键词）→ 倾向 `product-only`
  [关联 US-1]

- **FR-004**: 编排器 MUST 向用户展示推荐模式及推荐理由，同时列出所有可选模式（含一行说明），等待用户确认或选择替代模式。交互格式应清晰、简洁。 [关联 US-1]

#### 向后兼容与配置

- **FR-005**: 当 driver-config.yaml 中不存在 `research` 配置段时，系统 MUST 默认行为与当前版本完全一致——即执行完整的产品调研+技术调研+产研汇总流水线（等同于 `full` 模式）。 [关联 US-3]

- **FR-006**: driver-config.yaml SHOULD 支持新增 `research` 配置段，包含以下字段：
  - `research.default_mode`: 默认调研模式（可选值: `auto`, `full`, `tech-only`, `product-only`, `codebase-scan`, `skip`；默认值: `auto`）
  - `research.custom_steps`: 自定义步骤列表（仅当 `default_mode: custom` 时生效；可选步骤: `product-research`, `tech-research`, `codebase-scan`, `synthesis`）
  [关联 US-3, US-5]

#### 子代理适配

- **FR-007**: 编排器 MUST 根据实际执行的调研模式调整后续阶段的上下文注入内容：
  - `full` 模式：注入 research-synthesis.md 路径（现有行为）
  - `tech-only`: 注入 tech-research.md 路径
  - `product-only`: 注入 product-research.md 路径
  - `codebase-scan`: 注入代码上下文摘要
  - `skip`: 注入"调研模式: skip"标记，不传入任何调研制品路径
  - `custom`: 注入实际生成的制品路径列表
  后续阶段（specify、plan 等）的子代理应能在缺少 research-synthesis.md 时正常运行。
  [关联 US-2]

- **FR-008**: 技术调研子代理（tech-research.md）MUST 支持在无 product-research.md 输入时独立执行——直接基于需求描述和代码上下文进行技术评估。其 prompt 中的"必须基于产品调研结论"约束应调整为"基于产品调研结论（如有）或需求描述"。 [关联 US-2]

#### 质量门适配

- **FR-009**: GATE_RESEARCH 的行为 MUST 根据调研模式动态调整：
  - `full`: 展示 research-synthesis.md 关键摘要（现有行为）
  - `tech-only` / `product-only`: 展示对应单份调研报告的关键摘要，用户选择 A) 确认继续 / B) 补充调研 / C) 切换到 `full` 模式
  - `codebase-scan`: 展示代码上下文扫描摘要，用户选择 A) 确认继续 / B) 切换到带调研的模式
  - `skip`: 跳过 GATE_RESEARCH，不展示任何门禁
  [关联 US-2]

#### 进度显示

- **FR-010**: 当调研步骤被跳过时，编排器 MUST 在进度输出中标注被跳过的步骤，保持进度编号的可追溯性。例如：`[2/10] 产品调研 [已跳过 - 调研模式: tech-only]`。不得静默删除步骤编号。 [关联 US-2]

#### 命令行参数

- **FR-011**: Feature 模式 MUST 支持新增 `--research <mode>` 命令行参数，用于直接指定调研模式（跳过推荐和交互选择环节）。该参数优先级高于 driver-config.yaml 中的 `research.default_mode`。 [关联 US-4]

#### 安全与决策记录

- **FR-012**: 当调研模式为 `skip` 时，编排器 SHOULD 在特性目录中记录跳过决策（如在 spec.md 头部或独立文件中标注"调研阶段已跳过，原因: 用户选择 / 命令行参数 / 配置默认"），确保决策可追溯。 [关联 Constitution WARNING]

- **FR-013**: GATE_DESIGN（需求规范后的质量门）MUST 在所有调研模式下保持启用，不因跳过调研而被间接绕过。 [关联 Constitution WARNING]

#### 完成报告适配

- **FR-014**: 完成报告中的"生成的制品"列表 MUST 根据实际调研模式动态调整，仅列出实际生成的调研制品。未执行的调研步骤对应的制品应标注为"[已跳过]"而非显示为失败。 [关联 US-2]

#### 选择性重跑兼容

- **FR-015**: `--rerun research` 命令 MUST 重新进入调研模式选择流程（展示推荐和模式列表），而非直接重跑上次使用的模式。用户可以在重跑时选择不同的调研模式。 [关联 US-1]

### Key Entities

- **调研模式 (Research Mode)**: 定义了 Feature 模式中调研阶段执行哪些步骤的配置值。有 6 种预设模式（`full`, `tech-only`, `product-only`, `codebase-scan`, `skip`, `custom`），每种模式关联一组调研步骤和输出制品集合。调研模式的确定优先级为：命令行参数 > 配置文件默认值 > 智能推荐。

- **调研步骤 (Research Step)**: 调研阶段中的最小可执行单元。目前有 4 种：`product-research`（产品调研，调用产品调研子代理）、`tech-research`（技术调研，调用技术调研子代理）、`codebase-scan`（代码库上下文扫描，编排器自行执行）、`synthesis`（产研汇总，编排器自行执行，依赖前两者的输出）。每种调研模式由调研步骤的子集组合而成。

- **调研推荐结果 (Research Recommendation)**: 编排器基于需求描述文本特征分析后生成的推荐信息。包含推荐模式名、推荐理由文本、可选替代模式列表。展示给用户后等待确认或覆盖。

## Clarifications

### Session 2026-02-27

以下问题由需求澄清子代理自动解析。所有问题均为非 CRITICAL 级别，已按"信任但验证"策略自动处理。

1. **[AUTO-CLARIFIED: synthesis 降级处理]** — `custom` 模式下若 `synthesis` 步骤被选中但 product-research 和 tech-research 均缺失，则输出警告并跳过 synthesis，不报错中断。降级策略与 US-2 Scenario 6 上下文注入逻辑一致。

2. **[AUTO-CLARIFIED: 进度分母固定为最大步骤数（10）]** — 不同调研模式下进度分母统一为最大步骤数（如 10），跳过步骤的分子仍递增，步骤描述后附加"[已跳过 - 调研模式: {mode}]"标注。符合 Edge Cases 中"保持进度编号可追溯性"的意图。

3. **[AUTO-CLARIFIED: GATE_RESEARCH 不属于"模式选择"交互]** — US-1 Scenario 4 中"不再二次询问"仅约束不重复展示调研模式推荐/选择界面。GATE_RESEARCH 门禁独立于模式选择，按 FR-009 正常执行。

4. **[AUTO-CLARIFIED: 智能推荐使用关键词 + 启发式规则，不引入额外 LLM 调用]** — FR-003 推荐逻辑基于需求描述的文本特征，通过关键词匹配和启发式规则实现，与当前 Bash/Markdown Plugin 技术栈一致，不引入额外 API 调用成本。

5. **[AUTO-CLARIFIED: `--rerun research` 为现有命令，FR-015 仅调整其行为]** — FR-015 视 `--rerun research` 为已存在命令，仅要求其重跑时重新进入调研模式选择流程（而非直接重跑上次模式）。

6. **[AUTO-CLARIFIED: 调研跳过决策记录内嵌于 spec.md YAML Front Matter]** — FR-012 中"独立文件"解释为内嵌在该特性 spec.md 头部元数据中（`research_mode: skip`、`research_skip_reason: {原因}` 字段），不新增独立文件，保持制品结构简洁。

7. **[AUTO-CLARIFIED: `codebase-scan` 输出摘要通过上下文传递，不写入磁盘]** — FR-002 和 FR-007 均说明代码上下文摘要为"非独立文件"，实现为字符串传入编排器上下文注入块；进度日志记录"[codebase-scan 完成]"标记即可。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 使用 `full` 模式执行 Feature 流程时，行为与当前版本 100% 一致——生成相同的 3 份调研制品，执行相同的门禁流程，后续阶段正常运行，验证向后兼容性。

- **SC-002**: 使用 `skip` 模式执行 Feature 流程时，调研阶段耗时降为 0（不调用任何调研子代理、不执行 Web 搜索），后续阶段（规范、规划、实现、验证）均正常完成，无因缺少调研制品而报错。

- **SC-003**: 使用 `tech-only` 模式执行 Feature 流程时，仅调用技术调研子代理一次，不调用产品调研子代理，不执行产研汇总，且后续需求规范阶段能基于 tech-research.md 正常生成 spec.md。

- **SC-004**: 编排器对 3 种典型需求描述（新产品方向、技术重构、小型增量功能）的智能推荐结果合理（分别推荐 `full`/`tech-only`/`codebase-scan` 或 `skip`），且推荐理由对用户有实际参考价值。

- **SC-005**: 在 driver-config.yaml 中不存在 `research` 配置段的项目上执行 Feature 模式，行为与升级前完全一致，无错误、无警告、无额外交互。

- **SC-006**: 命令行参数 `--research <mode>` 能正确覆盖配置文件和智能推荐，直接以指定模式执行，无需用户确认。
