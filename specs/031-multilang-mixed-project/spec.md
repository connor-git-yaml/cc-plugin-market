# Feature Specification: 多语言混合项目支持

**Feature Branch**: `031-multilang-mixed-project`
**Created**: 2026-03-18
**Status**: Draft
**Input**: Blueprint 024 Phase 3 集成层 — 让 reverse-spec 能够自动检测、分组处理多语言混合项目中的各语言模块，并生成包含语言分布信息的架构索引

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 多语言混合项目的批量 Spec 生成 (Priority: P1)

作为一个维护 TypeScript + Python + Go 多语言 monorepo 的开发者，我希望对整个项目运行批量 Spec 生成时，系统能自动识别每种语言并分别为各语言的模块生成独立的 spec 文档，这样我无需手动按语言拆分项目就能获得完整的架构文档。

**Why this priority**: 这是本特性的核心价值。当前系统仅能处理单一语言项目（JS/TS），面对真实世界中常见的多语言 monorepo（如前端 TS + 后端 Go + 数据处理 Python）无法正常工作。此故事直接解决该痛点。

**Independent Test**: 准备一个包含 TS、Python、Go 三种语言源文件的测试项目，运行批量 Spec 生成，验证各语言模块均产出了独立的 spec 文档。

**Acceptance Scenarios**:

1. **Given** 一个包含 `src/api/` (TypeScript)、`services/auth/` (Go)、`scripts/` (Python) 的多语言项目，**When** 用户对该项目运行批量 Spec 生成，**Then** 系统分别为 TypeScript 模块、Go 模块、Python 模块生成独立的 spec 文档，每个 spec 中标注了该模块所属的编程语言
2. **Given** 一个包含 TS + Python 的项目，**When** 用户运行批量 Spec 生成，**Then** 系统按语言分组构建各自的依赖图，TypeScript 模块使用精确依赖分析，Python 模块使用基于目录结构的轻量级依赖推断
3. **Given** 同一目录下混合了 `.ts` 和 `.py` 文件，**When** 用户运行批量 Spec 生成，**Then** 系统将不同语言的文件分到不同的子模块，不会混为一个模块

---

### User Story 2 - 架构索引展示语言分布信息 (Priority: P1)

作为项目技术负责人，我希望生成的架构索引（`_index.spec.md`）中包含语言分布概览，这样我能快速了解项目的多语言组成、各语言的文件规模和模块分布，用于架构评审和技术决策。

**Why this priority**: 架构索引是批量生成的核心产出物之一。如果索引不能反映多语言项目的真实全貌，其参考价值将大打折扣。此故事与 P1-US1 共同构成完整的多语言处理闭环。

**Independent Test**: 对多语言项目生成架构索引，验证索引中包含语言分布表格且数据准确。

**Acceptance Scenarios**:

1. **Given** 一个包含 TypeScript (30 文件)、Python (15 文件)、Go (10 文件) 的项目，**When** 批量 Spec 生成完成后产出架构索引，**Then** 索引中包含"语言分布"章节，展示每种语言的文件数、模块数和占比
2. **Given** 一个仅包含 TypeScript 的纯单语言项目，**When** 生成架构索引，**Then** 索引中不展示"语言分布"章节（或展示为单一语言），保持与现有行为兼容

---

### User Story 3 - 批量生成支持按语言过滤 (Priority: P2)

作为开发者，我希望在批量 Spec 生成时能指定只处理某些语言（如仅生成 TypeScript 部分的 spec），这样我能针对性地更新某一语言的文档，而不必重新处理整个项目。

**Why this priority**: 这是效率优化功能。在大型多语言项目中，完整批量生成可能耗时较长。按语言过滤能让用户增量更新特定语言的文档，但不影响核心功能的完整性。

**Independent Test**: 对多语言项目运行带语言过滤参数的批量生成，验证仅指定语言的模块被处理。

**Acceptance Scenarios**:

1. **Given** 一个包含 TS + Python + Go 的项目，**When** 用户运行批量 Spec 生成并指定仅处理 `typescript`，**Then** 仅 TypeScript 模块的 spec 被生成，Python 和 Go 模块被跳过
2. **Given** 用户指定处理 `typescript` 和 `python` 两种语言，**When** 运行批量生成，**Then** 仅 TypeScript 和 Python 模块被处理，Go 模块被跳过
3. **Given** 用户指定了一个项目中不存在的语言（如 `rust`），**When** 运行批量生成，**Then** 系统返回空结果并给出友好提示

---

### User Story 4 - MCP prepare 工具返回检测到的语言列表 (Priority: P2)

作为通过 MCP 协议调用 reverse-spec 的 AI 助手（Claude Code），我希望在 `prepare` 预处理阶段就能获知项目中包含哪些编程语言，这样我能在后续对话中向用户展示项目的语言构成，并引导用户决定是否按语言过滤批量生成。

**Why this priority**: 此功能让 MCP 调用方能在批量生成之前就掌握项目的语言信息，为 US3 的语言过滤提供决策依据。它是 MCP 工具链的自然增强，但不阻塞核心处理流程。

**Independent Test**: 通过 MCP 协议调用 `prepare` 工具，验证返回结果中包含检测到的语言列表。

**Acceptance Scenarios**:

1. **Given** 一个包含 TS + Python 文件的项目，**When** 通过 MCP 调用 `prepare` 工具，**Then** 返回结果中包含检测到的语言列表 `['typescript', 'python']`
2. **Given** 一个纯 TypeScript 项目，**When** 通过 MCP 调用 `prepare` 工具，**Then** 返回结果中的语言列表为 `['typescript']`

---

### User Story 5 - 不支持语言文件的友好警告 (Priority: P2)

作为开发者，当我的项目中包含 reverse-spec 尚不支持的语言文件（如 Rust、C++ 等）时，我希望系统输出清晰的警告信息（包含跳过了哪些语言和文件数量），这样我能明确知道哪些部分未被覆盖，而不是默默忽略。

**Why this priority**: 友好的警告信息是用户体验的重要组成部分。它帮助用户理解系统的覆盖边界，但不影响核心处理逻辑。

**Independent Test**: 对包含不支持语言文件的项目运行扫描，验证输出了包含语言名称和文件数的聚合警告。

**Acceptance Scenarios**:

1. **Given** 一个包含 `.rs` (Rust) 和 `.cpp` (C++) 文件的混合项目，**When** 系统扫描文件时，**Then** 输出聚合警告，例如"跳过 12 个 .rs 文件（Rust，不支持）、5 个 .cpp 文件（C++，不支持）"，包含具体的语言名称而非仅扩展名
2. **Given** 所有文件都是系统支持的语言，**When** 系统扫描文件时，**Then** 不输出任何跳过文件的警告

---

### User Story 6 - 跨语言模块的语言边界标注 (Priority: P3)

作为架构师，我希望在生成的 spec 文档中能看到该模块与其他语言模块的潜在关联标注（语言边界），这样我能识别项目中跨语言调用的风险点并进行针对性审查。

**Why this priority**: 跨语言调用（如 TS 通过 REST 调用 Go 服务、Python 通过 FFI 调用 C 库）在 AST 层面难以精确检测。MVP 阶段仅做标注提示，精确检测留待后续迭代。此故事提供的是辅助参考信息。

**Independent Test**: 对包含多种语言模块的项目生成 spec，验证 spec 中标注了模块所属语言和跨语言引用提示。

**Acceptance Scenarios**:

1. **Given** 一个 TS 模块的 import 路径中引用了属于 Go 语言组的路径，**When** 生成该模块的 spec，**Then** spec 的元数据中标注了 `language: typescript` 和跨语言引用信息
2. **Given** 一个纯单语言模块无跨语言引用，**When** 生成 spec，**Then** spec 中仅标注语言信息，无跨语言引用标注
3. **Given** 一个 TS 模块通过 REST API 调用 Go 服务（AST 中不可见的调用方式），**When** 生成 spec，**Then** 系统不会错误标注跨语言引用，但在多语言项目的每个 spec 末尾附加通用提示："本项目包含多种编程语言，可能存在 AST 不可见的隐式跨语言调用（如 REST/gRPC/FFI），请人工审查"（参见 Clarifications CQ-001）

---

### Edge Cases

- 项目中仅包含一种语言时，系统行为应与现有单语言模式完全一致，不引入额外开销
- 同一目录下混合了不同语言文件（如 `scripts/` 目录同时有 `.py` 和 `.sh` 文件）时，分组策略需正确拆分
- 项目中包含大量不支持的语言文件（如数千个 `.c` 文件）时，警告信息应聚合展示而非逐文件输出
- 某种语言在项目中仅有极少量文件（如 1-2 个 `.go` 文件）时，仍应被检测并纳入语言统计
- 断点恢复场景中，如果上次中断时正在处理 Python 模块，恢复后应能正确继续处理
- 用户指定的语言过滤参数包含不合法的语言标识（如拼写错误）时，系统应给出清晰的错误提示
- 对于无扩展名的文件（如 `Makefile`、`Dockerfile`）和非代码文件（如 `.yaml`、`.json`），当前行为保持不变——在扫描阶段忽略，不纳入多语言统计。这些文件不属于任何编程语言的语言适配器管辖范围，不计入 `languageStats`，也不出现在不支持语言的警告中（参见 Clarifications CQ-002）

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须在文件扫描阶段自动检测项目中存在的编程语言，按文件扩展名统计各语言的文件数量
- **FR-002**: 系统必须在批量生成时按检测到的语言分组处理文件——每种语言使用各自的依赖分析策略构建依赖图
- **FR-003**: 对于缺乏精确依赖分析工具的语言（如 Python、Go、Java），系统必须提供基于目录结构和 import 语句推断的轻量级依赖图作为兜底方案
- **FR-004**: 系统必须将多语言的依赖图合并为统一的拓扑排序结果，作为模块处理顺序的依据
- **FR-005**: 同一目录下包含不同语言文件时，系统必须将它们分组到不同的子模块，避免混淆
- **FR-006**: 系统必须在每个 spec 文档的元数据中标注该模块的主要编程语言
- **FR-007**: 系统必须在架构索引中增加"语言分布"信息，展示每种语言的文件数、模块数和占比
- **FR-008**: 当项目为纯单语言时，架构索引中不展示"语言分布"章节，保持与现有行为兼容
- **FR-009**: MCP `prepare` 工具的返回结果中必须包含检测到的语言列表
- **FR-010**: MCP `batch` 工具必须支持语言过滤参数，允许用户仅处理指定语言的模块
- **FR-011**: 系统文件扫描时，必须对不支持的语言文件输出包含语言名称的聚合警告（如"跳过 12 个 .rs 文件（Rust，不支持）"），而非仅输出扩展名
- **FR-012**: 系统必须在跨语言模块的 spec 元数据中标注潜在的跨语言引用信息（基于 import 路径推断）
- **FR-013**: 批量生成的断点恢复机制必须支持多语言分组场景——恢复时能正确还原语言分组状态
- **FR-014**: 所有多语言增强功能必须向后兼容——对现有纯 TypeScript 项目的处理行为和输出格式不产生破坏性变更
- **FR-015**: 当用户通过 `--languages` 过滤参数仅处理部分语言时，架构索引中的"语言分布"章节仍展示全部检测到的语言的分布信息（基于 `scanFiles` 的 `languageStats`），但在表格中标注哪些语言在本次批量生成中被处理、哪些被跳过。这确保了索引作为项目全貌参考的完整性，同时让用户知道哪些部分有对应的 spec 文档（参见 Clarifications CQ-003）

### Key Entities

- **语言统计（Language Statistics）**: 描述项目中各编程语言的文件分布情况，包含语言标识、文件数量、文件扩展名列表。由文件扫描阶段产出，供后续分组和索引生成使用
- **语言分组（Language Group）**: 将扫描到的文件按所属语言进行分组的逻辑单元。每个分组关联一个语言适配器，用于驱动该组文件的依赖分析和 spec 生成
- **语言分布（Language Distribution）**: 架构索引中的汇总信息，描述每种语言在项目中的文件数、代码行数、模块数和占比。面向技术决策者展示项目的多语言全貌
- **跨语言引用（Cross-Language Reference）**: 标注一个模块通过 import 路径引用了属于其他语言组的模块。MVP 阶段仅基于 import 路径推断，不覆盖隐式调用（如 REST/FFI）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对包含 TypeScript + Python + Go 的混合项目运行批量 Spec 生成，三种语言的模块均成功产出独立的 spec 文档，成功率 100%
- **SC-002**: 架构索引中的语言分布统计数据（文件数、模块数、占比）与项目实际文件结构一致，准确率 100%
- **SC-003**: 对纯 TypeScript 项目运行多语言增强后的系统，输出格式和内容与增强前保持完全一致（向后兼容）
- **SC-004**: 不支持语言文件的警告信息中，语言名称识别正确率达到 100%（对常见扩展名如 .rs/.cpp/.c/.rb/.swift/.kt）
- **SC-005**: 通过 `--languages` 参数过滤后的批量生成，仅处理指定语言的模块，未指定语言的模块零处理
- **SC-006**: MCP `prepare` 返回的语言列表与项目中实际存在的已支持语言完全匹配
- **SC-007**: 同一目录下混合不同语言文件的场景，系统正确将其拆分为不同子模块，无混合分组出现

---

## Clarifications

> 本章节由需求澄清子代理自动生成，解决 spec 中标记为 [NEEDS CLARIFICATION] 的歧义点以及结构化扫描发现的隐含歧义。

### CQ-001: 多语言项目 spec 中是否增加隐式跨语言调用的通用提示 [AUTO-CLARIFIED]

**原始歧义**: US6-AC3 — 系统无法通过 AST 检测 REST/gRPC/FFI 等隐式跨语言调用，是否需要在 spec 中增加通用提示供人工审查？

**决议**: 是。当项目被检测为多语言项目（`languageStats` 包含 2 种或以上语言）时，在每个 spec 文档的 `constraints`（约束）section 末尾追加一段标准化提示文本：

> "注意：本项目包含多种编程语言（{languages}），模块间可能存在 AST 不可见的隐式跨语言调用（如 REST API、gRPC、FFI、subprocess 等），建议人工审查跨语言交互边界。"

**理由**: 成本极低（仅一行文本），但能显著提升 spec 的实用性——提醒读者关注 AST 分析的盲区。纯单语言项目不追加此提示，保持向后兼容。

---

### CQ-002: 无扩展名文件和非代码文件的多语言统计归类 [AUTO-CLARIFIED]

**原始歧义**: Edge Cases — `Makefile`、`Dockerfile`、`.yaml`、`.json` 等文件是否需要在多语言统计中归类为"配置文件"类别？

**决议**: 否。这些文件维持当前行为——在 `walkDir` 扫描时被忽略（无扩展名的文件不计入 `unsupportedExtensions`，非代码扩展名如 `.yaml`/`.json` 计入 `unsupportedExtensions` 但不纳入 `languageStats`）。多语言统计仅覆盖 `LanguageAdapterRegistry` 中已注册适配器所声明的扩展名。

**理由**: 引入"配置文件"类别会增加数据模型复杂度，且对 spec 生成流水线无实际意义——这些文件不会进入 AST 分析或 LLM 生成流程。保持现有行为最符合 YAGNI 原则。

---

### CQ-003: `--languages` 过滤时架构索引的语言分布范围 [AUTO-CLARIFIED]

**原始歧义**: FR-015 — 使用 `--languages` 过滤后，架构索引是展示全部语言还是仅展示被处理的语言？

**决议**: 展示全部检测到的语言。架构索引的"语言分布"表格始终基于 `scanFiles` 阶段的 `languageStats`（完整扫描结果），但新增一列"本次处理"状态列（`processed: boolean`），标注哪些语言在本次批量生成中被实际处理。

**理由**: 架构索引的核心价值是展示项目全貌。如果仅展示被过滤后的语言，索引会给人"项目只有这些语言"的错误印象。增加一列状态标注既保留了完整信息，又让用户清楚知道哪些语言有对应的 spec。

---

### CQ-004: 多语言依赖图合并时 SCC 和 mermaidSource 的处理策略 [CRITICAL]

**原始歧义**: FR-002/FR-004 要求按语言分组构建依赖图并合并为统一拓扑排序。但当前 `DependencyGraph` 模型包含 `sccs`（强连通分量）和 `mermaidSource`（Mermaid 图源码）字段。当 TS 的 dependency-cruiser 图与 Python/Go 的 `buildDirectoryGraph` 兜底图合并时，SCC 检测和 Mermaid 渲染应如何处理？

**选项**:

- **A) 合并后重新计算**: 将所有语言的 `modules` 和 `edges` 合并到一个 `DependencyGraph` 中，对合并图重新运行 `detectSCCs` 和 `topologicalSort`，重新渲染 Mermaid。优点：全局视图完整；缺点：跨语言没有真实的 edge 连接（不同语言的模块间不存在 import 边），合并后 SCC 不会包含跨语言循环，Mermaid 图可能因节点过多而难以阅读。
- **B) 各语言独立计算，索引中分别展示**: 每种语言保持独立的 `DependencyGraph`，SCC 和 Mermaid 按语言独立计算。架构索引中按语言分别展示依赖图。优点：每个语言的图更清晰易读；缺点：`batch-orchestrator` 需要管理 `Map<adapterId, DependencyGraph>` 而非单一图。
- **C) 合并 modules/edges 用于拓扑排序，SCC/Mermaid 按语言独立保留**: 合并仅用于确定全局处理顺序（`processingOrder`），SCC 检测和 Mermaid 渲染在各语言图上独立进行。

**推荐**: 选项 C——合并用于全局拓扑排序，SCC/Mermaid 按语言独立。这最符合实际情况（跨语言没有 import 边），且对现有 `module-grouper` 的改动最小。

**需用户确认**: 此决策影响 `DependencyGraph` 模型是否需要新增 `language` 字段、`batch-orchestrator` 的图合并策略、以及架构索引中依赖图的展示方式。

---

### CQ-005: 同目录多语言文件拆分后的子模块命名约定 [CRITICAL]

**原始歧义**: FR-005 要求同一目录下不同语言文件拆分为不同子模块。tech-research 建议使用 `services[ts]` / `services[py]` 格式，但方括号在部分文件系统和 shell 环境中是特殊字符（如 `services[ts].spec.md` 在某些 shell 中需要转义）。

**选项**:

- **A) 方括号格式**: `services[ts]`、`services[py]` — 语义清晰但文件名含特殊字符
- **B) 连字符格式**: `services--ts`、`services--py` — 双连字符作为语言后缀分隔符，文件系统友好
- **C) 点分格式**: `services.ts-lang`、`services.py-lang` — 使用 `-lang` 后缀避免与文件扩展名混淆
- **D) 斜杠嵌套格式**: `services/ts`、`services/py` — 按语言创建子目录，spec 路径变为 `specs/services/ts.spec.md`

**推荐**: 选项 B（`services--ts`）——双连字符在文件系统中无特殊含义，且在视觉上与普通连字符模块名（如 `auth-service`）易于区分。仅在同目录下检测到多种语言时才追加语言后缀；纯单语言目录的模块名保持不变。

**需用户确认**: 此决策影响 `module-grouper.ts` 的分组逻辑、spec 文件的输出路径、以及 `BatchState` 检查点中存储的 `processingOrder` 模块名格式。
