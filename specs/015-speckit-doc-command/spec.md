# Feature Specification: speckit-doc 命令

**Feature Branch**: `015-speckit-doc-command`
**Created**: 2026-02-15
**Status**: Draft
**Input**: User description: "开发一个 speckit-doc 命令，用于生成 README 等常见的开源文档。需要文档结构清晰，涵盖从用户安装、使用、问题反馈、代码贡献等开源社区需要的方方面面。设计交互动作让用户选择开源协议类型、是否需要代码贡献文档，并提供常见文档组织模式。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 一键生成项目 README (Priority: P1)

作为一名开源项目维护者，我希望对一个已有代码但缺少文档的项目执行 speckit-doc 命令后，系统能自动分析项目结构和代码，生成一份结构完整、内容准确的 README.md 文件，这样我就不必从零开始撰写文档，也不用担心遗漏重要章节。

**Why this priority**: README.md 是开源项目最核心的文档，是用户了解项目的第一入口。93% 的开源开发者对不完整文档表示不满（产研调研数据），一份高质量 README 直接决定了项目的第一印象和采用率。这是 speckit-doc 的核心价值主张。

**Independent Test**: 可以通过在一个仅有源代码和 package.json 的 Node.js 项目上执行命令来独立验证。生成的 README.md 应包含至少 8 个标准章节，且内容应准确反映项目的真实信息（名称、描述、安装命令、使用方法等）。

**Acceptance Scenarios**:

1. **Given** 一个包含 package.json 和 src/ 目录的 Node.js 项目，**When** 用户执行 speckit-doc 命令，**Then** 系统自动提取项目名称、描述、版本、依赖、脚本命令等元信息，并生成包含标题/Badge、项目描述、功能特性、快速开始/安装、使用示例、项目结构树、技术栈、测试说明、贡献链接、License 声明共不少于 8 个标准章节的 README.md 文件。

2. **Given** 一个包含 TypeScript 源代码的项目，**When** 系统执行 AST 分析，**Then** 生成的 README.md 中的功能特性章节应反映代码中实际导出的主要模块和核心功能，而非泛化的通用描述。

3. **Given** 项目根目录已存在 README.md 文件，**When** 用户执行 speckit-doc 命令，**Then** 系统展示已有文件的检测提示和 diff 预览，默认不覆盖原文件，并提供"覆盖（自动备份为 .bak）"和"取消"两种选择。

---

### User Story 2 - 交互式选择开源协议并生成 LICENSE (Priority: P1)

作为一名开源项目维护者，我希望在生成文档时系统能展示常见开源协议列表让我选择，并自动生成对应的 LICENSE 文件，这样我就不需要去网上搜索和复制协议文本，也能确保协议内容的法律准确性。

**Why this priority**: 开源协议是开源项目的法律基础，选错或写错协议可能导致法律纠纷。LICENSE 文件必须 100% 准确（SPDX 标准），不允许任何修改或遗漏，这是一个法律合规的刚需。

**Independent Test**: 可以通过执行命令、选择任意一种协议来独立验证。验证生成的 LICENSE 文件内容与 SPDX 官方文本完全一致，且作者名称和年份已正确填充。

**Acceptance Scenarios**:

1. **Given** 用户启动 speckit-doc 命令，**When** 进入协议选择环节，**Then** 系统展示 8 种可选协议列表（MIT、Apache-2.0、GPL-3.0、BSD-2-Clause、BSD-3-Clause、ISC、MPL-2.0、Unlicense），每种协议附带一行简要说明（适用场景或核心条款摘要），等待用户回复选择。

2. **Given** 用户选择了 MIT 协议，**When** 系统生成 LICENSE 文件，**Then** 文件内容为 MIT 协议的 SPDX 标准全文，其中年份和版权持有者信息自动填充（从 git config 或 package.json author 提取），文件内容与 SPDX 标准文本 100% 一致（除填充字段外）。

3. **Given** package.json 的 license 字段已声明协议类型，**When** 用户执行命令，**Then** 系统将已声明的协议作为推荐默认选项突出展示，用户可直接确认或更换。

---

### User Story 3 - 文档组织模式选择 (Priority: P1)

作为一名开源项目维护者，我希望能在"精简模式"和"完整模式"之间选择文档组织方式，这样小型个人项目可以只生成核心文件，而面向社区的正式项目可以生成完整的文档套件。

**Why this priority**: 不同规模和阶段的项目对文档的需求不同。提供模式选择既降低了小型项目的文档负担，又确保正式开源项目不遗漏社区基础设施文档。这直接影响用户体验和命令的适用范围。

**Independent Test**: 分别以精简模式和完整模式执行命令，验证各模式生成的文件集合是否符合预期。

**Acceptance Scenarios**:

1. **Given** 用户启动 speckit-doc 命令，**When** 进入文档模式选择环节，**Then** 系统展示两种模式供选择：精简模式（README.md + LICENSE）和完整模式（README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md），各模式附带简要说明。

2. **Given** 用户选择精简模式，**When** 文档生成完成，**Then** 仅生成 README.md 和 LICENSE 两个文件，README.md 的贡献章节提供简化内容（如直接 Issue/PR 链接），不生成独立的 CONTRIBUTING.md 和 CODE_OF_CONDUCT.md。

3. **Given** 用户选择完整模式，**When** 文档生成完成，**Then** 生成 README.md、LICENSE、CONTRIBUTING.md、CODE_OF_CONDUCT.md 四个文件，README.md 的贡献章节链接到 CONTRIBUTING.md。

---

### User Story 4 - 生成 CONTRIBUTING.md 贡献指南 (Priority: P2)

作为一名开源项目维护者，我希望系统为我的项目生成一份包含开发环境搭建、代码规范、提交规范和 PR 流程的贡献指南，这样潜在贡献者能快速了解如何参与项目开发，减少不规范的 PR 和反复沟通的成本。

**Why this priority**: CONTRIBUTING.md 是开源社区的第二重要文档，直接影响项目能否吸引和留住贡献者。但它的价值建立在 README 和 LICENSE 之上，因此优先级略低于前三个 Story。

**Independent Test**: 以完整模式执行命令后，检查 CONTRIBUTING.md 是否包含项目特定的开发环境搭建指令（从 package.json scripts 提取），而非通用模板内容。

**Acceptance Scenarios**:

1. **Given** 用户选择完整模式，**When** 项目 package.json 中包含 `dev`、`test`、`lint` 等脚本命令，**Then** CONTRIBUTING.md 的开发环境搭建章节自动包含这些实际命令（如 `npm run dev`、`npm test`），而非占位符。

2. **Given** 用户选择完整模式，**When** CONTRIBUTING.md 生成完成，**Then** 文档包含以下四个核心章节：开发环境搭建（含克隆仓库、安装依赖、启动开发）、代码规范（编码风格要求）、提交规范（Conventional Commits 格式说明）、PR 流程指南（Fork → Branch → Commit → PR 步骤）。

---

### User Story 5 - 生成 CODE_OF_CONDUCT.md 行为准则 (Priority: P2)

作为一名开源项目维护者，我希望系统为我的项目生成基于 Contributor Covenant 标准的行为准则文档，这样我可以为社区建立明确的行为规范，营造包容和尊重的协作环境。

**Why this priority**: CODE_OF_CONDUCT.md 是成熟开源社区的标配文档，GitHub 官方推荐。其内容高度标准化（基于 Contributor Covenant v2.1），生成成本极低，但对社区氛围有重要保障作用。

**Independent Test**: 以完整模式执行命令后，检查 CODE_OF_CONDUCT.md 的内容是否基于 Contributor Covenant v2.1 标准模板，且联系方式字段已根据项目信息填充。

**Acceptance Scenarios**:

1. **Given** 用户选择完整模式，**When** CODE_OF_CONDUCT.md 生成完成，**Then** 文档内容基于 Contributor Covenant v2.1 标准版本，核心条款完整保留，不做删减或改写。

2. **Given** 项目 package.json 中包含 author 或 maintainers 字段的邮箱信息，**When** CODE_OF_CONDUCT.md 生成时，**Then** 文档中的联系方式（enforcement contact）自动填充该邮箱地址；若无可用邮箱，则标注为 `[INSERT CONTACT METHOD]` 占位符并提示用户手动补充。

---

### User Story 6 - 项目元信息自动提取 (Priority: P1)

作为一名开源项目维护者，我希望系统能自动从项目的 package.json、git 配置和目录结构中提取关键信息，而不是反复询问我已经存在于项目中的信息，这样文档生成过程更高效，结果也更准确。

**Why this priority**: 自动提取是所有文档生成功能的基础能力。README 中的项目名称、安装命令、技术栈信息，LICENSE 中的作者和年份，CONTRIBUTING 中的开发命令——这些全部依赖项目元信息的准确提取。没有这个基础能力，其他所有 Story 都无法高质量交付。

**Independent Test**: 在一个信息完整的项目上执行命令，检查生成文档中所有可自动提取的字段（项目名、版本号、描述、作者、license 类型、scripts 命令等）是否与源数据一致。

**Acceptance Scenarios**:

1. **Given** 项目根目录包含 package.json，**When** 系统提取元信息，**Then** 至少提取以下字段：name、version、description、license、author（或 contributors）、scripts、dependencies、devDependencies、repository。

2. **Given** 项目是一个 git 仓库，**When** 系统提取元信息，**Then** 至少提取以下信息：远程仓库 URL（用于 README 链接和 Badge）、默认分支名、当前作者信息（git config user.name 和 user.email）。

3. **Given** 项目根目录的部分元信息缺失（如没有 package.json 或 package.json 缺少 description 字段），**When** 系统提取元信息，**Then** 系统使用合理的降级策略：从目录名推断项目名称、从 git log 推断作者信息、标记缺失字段为 `[待补充]` 并在生成完成后汇总提示用户。

---

### Edge Cases

- **非 Node.js 项目**: 若项目不含 package.json（如 Python、Go、Rust 项目），系统应降级为仅使用 git config 和目录结构提取元信息，README 的安装/使用章节标注为 `[待补充]`，并提示用户项目类型不在最佳支持范围内。 [关联 FR-003, FR-012]

- **完全空项目**: 若项目既无 package.json 也无 git 初始化，系统应提示用户当前项目不满足最低元信息要求，建议先执行 `git init` 和 `npm init`，终止生成流程。 [关联 FR-003]

- **极大型项目（monorepo）**: 若 AST 分析超时（如分析时间超过 60 秒），系统应降级为仅使用 package.json 和目录结构生成文档，在 README 中标注功能特性章节为"基于包声明"而非"基于代码分析"。 [关联 FR-001]

- **多个已有文档文件**: 若项目已存在部分目标文件（如已有 README.md 但无 LICENSE），系统应逐文件检测并提示，对已有文件逐个询问是否覆盖，对不存在的文件直接生成。 [关联 FR-008]

- **git 远程仓库未配置**: 若项目无远程仓库 URL，Badge 和仓库链接等依赖远程 URL 的内容应优雅跳过或使用占位符 `[REPOSITORY_URL]`。 [关联 FR-002, FR-006]

- **package.json 格式异常**: 若 package.json 存在 JSON 语法错误，系统应捕获解析失败，降级为不使用 package.json 的模式，并向用户提示文件格式异常。 [关联 FR-003]

- **用户中断交互流程**: 若用户在交互环节（如协议选择）未给出有效回复或明确取消，系统应安全终止当前流程，不留下半成品文件。 [关联 FR-005, FR-007]

## Requirements *(mandatory)*

### Functional Requirements

#### README.md 智能生成

- **FR-001**: 系统 MUST 生成的 README.md 包含不少于 8 个标准章节：标题/Badge、项目描述、功能特性、快速开始/安装、使用示例、项目结构树、技术栈、测试说明、贡献链接、License 声明。其中"使用示例"章节 SHOULD 从 package.json 的 main/bin 字段推断项目类型（库 vs CLI 工具），生成 1-2 个与项目类型匹配的简短代码示例。 [关联 US-1] [AUTO-CLARIFIED: 轻量示例 — 从 main/bin 推断类型生成 1-2 个简短示例，平衡智能生成价值与 LLM 输出可靠性]

- **FR-002**: 系统 MUST 在 README.md 中生成 shields.io 格式的 Badge（至少包含 License Badge），且 Badge 链接基于项目实际信息。 [关联 US-1]

- **FR-003**: 系统 MUST 从 package.json 中提取 name、version、description、license、author、scripts、dependencies、devDependencies、repository 字段用于文档生成；若字段缺失，使用降级策略（目录名推断名称、git log 推断作者等）并标记 `[待补充]`。 [关联 US-6]

- **FR-004**: 系统 SHOULD 通过 AST 分析提取项目的主要导出模块和核心函数签名，用于 README.md 功能特性章节的内容增强。AST 分析支持 TypeScript（.ts）和 JavaScript（.js）项目；当 AST 分析不可用（非 TS/JS 项目、分析工具不可用）或超时（60 秒）时，统一降级为基于 package.json 描述的通用内容。 [关联 US-1] [AUTO-CLARIFIED: TS + JS 双支持 — ts-morph 原生支持 .ts/.js 解析，覆盖更广的 Node.js 项目群体，零额外成本]

#### 交互式开源协议选择

- **FR-005**: 系统 MUST 向用户展示 8 种开源协议选项（MIT、Apache-2.0、GPL-3.0、BSD-2-Clause、BSD-3-Clause、ISC、MPL-2.0、Unlicense），每项附带一行适用场景说明，采用"展示列表 → 等待用户回复"的交互模式。 [关联 US-2]

- **FR-006**: 系统 MUST 使用预置的静态协议模板文件生成 LICENSE 文件，禁止由 LLM 动态生成协议文本，确保与 SPDX 标准文本 100% 一致。 [关联 US-2]

- **FR-007**: 系统 MUST 自动将年份（当前年份）和版权持有者信息（优先从 package.json author 提取，其次从 git config user.name 提取）填充到 LICENSE 文件的对应占位字段中。 [关联 US-2, US-6]

- **FR-008**: 系统 SHOULD 检测 package.json 的 license 字段，若已声明协议类型，将其作为推荐默认选项突出展示。 [关联 US-2]

#### 文档组织模式

- **FR-009**: 系统 MUST 提供两种文档组织模式供用户选择：精简模式（生成 README.md + LICENSE）和完整模式（生成 README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md）。 [关联 US-3]

- **FR-010**: 精简模式下，README.md 的贡献相关内容 MUST 内联为简化说明（如 Issue/PR 链接），不引用独立的 CONTRIBUTING.md 文件。 [关联 US-3]

#### CONTRIBUTING.md 生成

- **FR-011**: 完整模式下生成的 CONTRIBUTING.md MUST 包含以下四个核心章节：开发环境搭建、代码规范、提交规范（Conventional Commits）、PR 流程指南。 [关联 US-4]

- **FR-012**: CONTRIBUTING.md 的开发环境搭建章节 MUST 从 package.json scripts 中提取实际可用的命令（如 `npm run dev`、`npm test`、`npm run lint`），而非通用占位符。 [关联 US-4, US-6]

#### CODE_OF_CONDUCT.md 生成

- **FR-013**: 完整模式下生成的 CODE_OF_CONDUCT.md MUST 基于 Contributor Covenant v2.1 标准版本，核心条款完整保留。 [关联 US-5]

- **FR-014**: CODE_OF_CONDUCT.md 中的联系方式字段 SHOULD 自动填充（从 package.json author 邮箱或 git config user.email 提取）；若无可用信息，标注为 `[INSERT CONTACT METHOD]` 占位符。 [关联 US-5, US-6]

#### 交互流程编排

- **FR-019**: 系统 MUST 按以下顺序编排端到端交互流程：(1) 项目元信息自动提取 → (2) 文档组织模式选择 → (3) 开源协议选择 → (4) 批量文件生成 → (5) 逐文件冲突检测与处理。交互收集阶段（步骤 1-3）完成后再进入文件生成阶段（步骤 4-5），避免用户在等待生成过程中被反复打断。 [关联 US-1, US-2, US-3, US-6] [AUTO-CLARIFIED: 先交互后生成模式 — 与 speckit-feature 等现有 Skill 的"收集参数 → 执行"模式一致，减少交互碎片化]

#### 文件安全

- **FR-015**: 系统 MUST 在生成每个目标文件前检测该文件是否已存在；若已存在，展示 diff 预览并提供"覆盖（自动备份为 .bak）"和"跳过"两种选择，默认不覆盖。MVP 阶段采用逐文件询问方式，不提供"全部跳过/全部覆盖"批量选项。 [关联 US-1, US-3] [AUTO-CLARIFIED: 逐文件询问 — 完整模式最多 4 个文件，交互负担极低，给用户更精细控制权]

- **FR-016**: 选择覆盖时，系统 MUST 在写入新内容前将原文件备份为 `{filename}.bak`，确保用户可恢复。 [关联 US-1]

#### 二期预留

- **FR-017**: 系统 SHOULD 在生成的 README.md 中预埋 HTML 注释标记（如 `<!-- speckit:section:features -->`），为二期 `--update` 功能预留结构化解析锚点，这些注释在正常渲染时不可见。 [关联 产研汇总第 4 节]

#### 文档语言

- **FR-018**: 系统生成的文档内容（README.md、CONTRIBUTING.md、CODE_OF_CONDUCT.md）MUST 默认使用英文，遵循开源社区国际化惯例。 [AUTO-RESOLVED: 产研汇总建议确认默认语言，鉴于 speckit-doc 面向开源社区场景且 awesome-readme 最佳实践以英文为主，自动选择英文为默认语言]

### Key Entities

- **项目元信息 (Project Metadata)**: 从 package.json、git config、目录结构中提取的项目描述数据集合，包括名称、版本、描述、作者、协议类型、脚本命令、依赖列表、仓库 URL、目录结构。是所有文档生成的数据基础。

- **文档组织模式 (Documentation Mode)**: 用户选择的文档生成范围配置，分为精简模式和完整模式。决定最终生成的文件集合。

- **开源协议 (License Type)**: 用户选择的开源协议标识符，对应一份静态协议模板。系统支持 8 种预置协议类型，每种关联一份 SPDX 标准文本文件。

- **AST 分析结果 (AST Analysis Result)**: 通过代码静态分析获取的项目导出模块、核心函数签名等结构化数据。用于增强 README.md 功能特性章节的内容准确性。可能不可用（超时或非支持语言），此时系统降级。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对 3 种不同类型的 Node.js 项目（CLI 工具、npm 库、Web 应用）执行 speckit-doc 命令后，每个项目均成功生成完整文档套件，无报错中断。

- **SC-002**: 生成的 README.md 包含不少于 8 个标准章节（标题/Badge、描述、功能特性、快速开始/安装、使用示例、项目结构树、技术栈、测试说明、贡献链接、License 声明），且每个章节包含与项目实际信息相关的内容（非占位符）。

- **SC-003**: 生成的 LICENSE 文件内容与所选协议的 SPDX 标准文本 100% 一致（除年份和版权持有者填充字段外），8 种协议全部通过此验证。

- **SC-004**: 完整模式下生成的 CONTRIBUTING.md 包含至少 1 条从 package.json scripts 自动提取的实际项目命令（如 `npm test`），而非通用模板文字。

- **SC-005**: 用户从执行 speckit-doc 命令到获得完整文档套件的端到端时间不超过 3 分钟（含交互选择时间，不含 AST 分析超时降级场景）。

- **SC-006**: 当项目根目录已存在目标文件时，系统 100% 触发冲突检测流程（展示提示 + diff 预览），不出现静默覆盖。

- **SC-007**: 元信息缺失场景下（如无 package.json），系统仍能完成文档生成流程（降级模式），生成的文档中缺失信息以 `[待补充]` 标记，用户可快速定位并手动补充。

## Clarifications

### Session 2026-02-15

- Q: 用户执行 speckit-doc 后各交互环节（模式选择、协议选择、元信息提取、文件生成、冲突处理）的执行顺序是什么？ → A: 采用"先交互后生成"模式——元信息自动提取 → 文档模式选择 → 协议选择 → 批量文件生成 → 逐文件冲突处理。交互收集阶段完成后再统一生成，减少用户等待中被打断的次数。
- Q: AST 分析（FR-004）支持哪些语言的项目？reverse-spec prepare 不可用时如何降级？ → A: TypeScript 和 JavaScript 项目均支持 AST 分析（ts-morph 原生支持 .ts/.js）。当 prepare 命令执行失败（非 TS/JS 项目、命令不可用、超时 60 秒）时统一降级为基于 package.json 描述的通用内容。
- Q: README "使用示例"章节的内容深度如何界定？ → A: 从 package.json 的 main/bin 字段推断项目类型（库 vs CLI 工具），生成 1-2 个与项目类型匹配的简短代码示例，而非详尽的 API 文档。
- Q: 多个目标文件已存在时，冲突处理是否提供"全部跳过/全部覆盖"批量选项？ → A: MVP 阶段采用逐文件询问，不提供批量选项。完整模式最多 4 个文件，逐文件交互负担极低，且给用户更精细的控制权。
