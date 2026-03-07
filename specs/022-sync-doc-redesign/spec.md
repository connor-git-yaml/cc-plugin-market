# Feature Specification: sync / doc 文档架构重设计

**Feature Branch**: `022-sync-doc-redesign`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: User description: "[$spec-driver-feature](/Users/connorlu/.codex/skills/spec-driver-feature/SKILL.md) 使用深度搜索调研一下，面向用户的全量需求文档/项目技术文档和面向用户的使用的最佳事件和内容风格。从这个目标再调研业界通用的编写这些文档的流程和方法。结合我们 Spec Driver 行程的 Spec 等等的文档和源代码风格，重新设计 sync skill 并思考是否将它与 doc skill 合并。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - sync 成为产品级文档单一信息源 (Priority: P1)

作为 Spec Driver 维护者，我希望 `speckit-sync` 不只是生成一份“内部汇总文档”，而是生成一份能够稳定承载产品需求、技术架构和对外文档摘要的产品级活文档，这样后续所有面向用户的 README / 使用说明都能从同一个事实源派生，而不是各自重新推断。

**Why this priority**: 当前 `sync` 已经承担“产品知识聚合层”的角色，但它与 `doc` 之间没有明确的上游/下游契约，导致 README 和 `current-spec.md` 可能在受众、语言、信息粒度上各自漂移。先把 `sync` 定位成可复用的单一信息源，才有资格讨论 `doc` 的整合方式。

**Independent Test**: 在已有多个增量 spec 的项目上运行 `speckit-sync`，检查生成的 `specs/products/<product>/current-spec.md` 是否同时具备：产品级需求总结、技术架构与决策、以及可供 `speckit-doc` 直接消费的对外文档摘要。

**Acceptance Scenarios**:

1. **Given** 一个已有 `specs/NNN-*` 增量 spec 的产品，**When** 运行 `speckit-sync`，**Then** 系统继续生成原有的 `specs/products/<product>/current-spec.md`，并保持现有路径和聚合语义不变。
2. **Given** 一个已有 `current-spec.md` 的产品，**When** `sync` 完成新一轮聚合，**Then** 文档中同时存在面向产品/需求、面向工程/技术、以及面向对外文档派生的摘要层，且来源可追溯。
3. **Given** 某类信息在增量 spec 中不存在，**When** `sync` 生成对应章节，**Then** 文档必须标注 `[待补充]` 或 `[推断]`，不得为追求“完整”而编造内容。

---

### User Story 2 - doc 消费 sync 产物生成对外文档 (Priority: P1)

作为开源项目维护者，我希望 `speckit-doc` 在项目已经存在 `specs/products/*/current-spec.md` 时，优先把它当作 README 和使用文档的权威输入，而不是只依赖 `package.json`、目录树和 AST 结果，这样我只维护一份产品知识，就能得到一致的对外文档。

**Why this priority**: 这是减少文档漂移的直接抓手。`doc` 仍然负责“对外表达”，但不应再次发明产品定位、用户场景和功能价值。

**Independent Test**: 在包含 `specs/products/<product>/current-spec.md` 的项目上运行 `speckit-doc`，验证 README 的项目描述、核心价值、主要工作流和功能特性能够直接追溯到 `current-spec.md` 或其中的对外文档摘要。

**Acceptance Scenarios**:

1. **Given** 项目中存在 `specs/products/<product>/current-spec.md`，**When** 运行 `speckit-doc`，**Then** 系统优先读取该文件作为 README/使用文档的产品语义来源。
2. **Given** 项目中不存在任何 `current-spec.md`，**When** 运行 `speckit-doc`，**Then** 系统保持当前降级行为，继续基于 `scan-project.sh`、git 信息和目录结构工作。
3. **Given** `current-spec.md` 与 `package.json` 中的名称/描述存在冲突，**When** 生成 README，**Then** 系统必须显式提示冲突来源，并优先使用 `current-spec.md` 的产品定位与 `package.json` 的发行元信息，而不是静默覆盖。

---

### User Story 3 - sync 与 doc 维持分工但共享方法论 (Priority: P2)

作为 Spec Driver 维护者，我希望 `speckit-sync` 和 `speckit-doc` 不被粗暴合并为一个命令，而是在共享同一套文档信息架构、内容风格和预检逻辑的前提下保持清晰分工，这样命令语义不会混乱，代码和 Prompt 结构也能持续演进。

**Why this priority**: 调研显示两者虽然都属于“文档化能力”，但受众、输出路径和输入源明显不同。直接合并会把“内部产品知识聚合”和“外部用户文档生成”混成一个命令，反而提高复杂度。

**Independent Test**: 查看 `speckit-sync` 与 `speckit-doc` 的说明和执行流程，验证两者仍为两个命令，但共享一致的 preflight 语义、文档风格约束和输入契约。

**Acceptance Scenarios**:

1. **Given** 用户想更新产品级活文档，**When** 运行 `speckit-sync`，**Then** 命令只写入 `specs/products/` 等产品规范制品，不直接生成仓库根目录 README。
2. **Given** 用户想生成仓库根目录 README / LICENSE / CONTRIBUTING，**When** 运行 `speckit-doc`，**Then** 命令负责对外文档输出，但可读取 `sync` 产物作为上游输入。
3. **Given** `sync` 和 `doc` 都需要插件路径发现、project-context 解析和在线调研门禁，**When** 维护者修改这些规则，**Then** 至少存在明确的共享约定或契约文件，避免规则继续双份漂移。

---

### Edge Cases

- 当仓库包含多个 `specs/products/*/current-spec.md` 时，`doc` 如何确定当前 README 对应哪个产品
- 当 `current-spec.md` 是中文、README 目标输出为英文时，系统如何保持“事实一致、表达转译”，而不是逐段翻译内部文档
- 当 `sync` 可推断的信息不足时，如何保证对外文档不把 `[推断]` 内容写成确定性承诺
- 当项目只有代码元信息、尚未进入 Spec-Driven 流程时，`doc` 必须保持当前可用性，不得因缺少 `sync` 产物而失效
- 当产品活文档中的产品定位与 `package.json` 的 package description 不一致时，系统如何拆分“产品语义”和“分发元信息”

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `speckit-sync` MUST 继续将 `specs/NNN-*` 聚合为 `specs/products/<product>/current-spec.md`，保持现有输出路径和幂等语义不变。
- **FR-002**: `current-spec.md` MUST 明确区分至少三类信息层：产品/需求层、技术/架构层、对外文档摘要层。
- **FR-003**: `speckit-sync` MUST 在 `current-spec.md` 中输出可供 `speckit-doc` 直接消费的“对外文档摘要”，覆盖至少：电梯陈述、核心价值、主要用户、关键工作流、用户文档边界。
- **FR-004**: `speckit-sync` MUST 保持来源可追溯性；对外文档摘要中的所有内容必须可追溯到增量 spec、plan、tasks 或已有产品文档。
- **FR-005**: `speckit-doc` MUST 在发现 `specs/products/*/current-spec.md` 时，将其作为 README 和使用文档的高优先级产品语义输入。
- **FR-006**: `speckit-doc` MUST 在没有 `current-spec.md` 时回退到当前的 `scan-project.sh + git + 目录结构 (+ AST)` 输入链，不得降低现有可用性。
- **FR-007**: `speckit-doc` MUST 将“产品语义”和“分发元信息”区分处理：产品定位、用户价值、主要工作流来自 `current-spec.md`；版本号、许可证、包管理器入口、仓库脚本等继续来自项目元信息扫描。
- **FR-008**: `speckit-sync` 与 `speckit-doc` MUST 保持为两个独立命令；本次重设计 MUST NOT 将两者合并成一个统一入口。
- **FR-009**: `sync` 与 `doc` 的共享预检逻辑（插件路径发现、project-context 解析、在线调研门禁） MUST 使用同一套语义定义；若暂不抽取代码，至少要在 Prompt 中显式对齐。
- **FR-010**: `scan-project.sh` 的输出字段 MUST 有独立、可版本化的契约说明文件，供 `speckit-doc` 和后续模板/agent 引用。
- **FR-011**: 用户可读文档的内容风格 MUST 满足：单段单受众、标题可扫描、动作导向、避免把内部设计细节直接抄进 README。
- **FR-012**: 技术文档章节 MUST 明确承载架构、NFR、设计决策和风险，不与 README 式“快速开始”内容混写。
- **FR-013**: 当 `current-spec.md` 与仓库元信息冲突时，系统 MUST 在生成阶段提示冲突来源，并按“产品语义优先于项目元信息扫描、分发元信息优先于 AST/推断”的规则处理。

### Key Entities *(include if feature involves data)*

- **Product Living Spec**: `specs/products/<product>/current-spec.md`，由 `sync` 生成的产品级活文档，是产品需求与技术事实的权威聚合层。
- **Documentation Handoff Summary**: `current-spec.md` 中新增的对外文档摘要区块，供 `doc` 生成 README / 使用文档时直接消费。
- **External Doc Bundle**: `speckit-doc` 生成的 `README.md`、`LICENSE`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md` 等对外文档。
- **Project Scan Contract**: `scan-project.sh` 输出结构的显式契约文档，定义项目元信息扫描层的字段和语义。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在存在 `current-spec.md` 的项目中，`speckit-doc` 生成的 README 至少有 3 个核心区块（项目描述、核心价值、主要工作流）可以直接追溯到 `current-spec.md` 的对外文档摘要。
- **SC-002**: 在不存在 `current-spec.md` 的项目中，`speckit-doc` 保持当前行为可用，README 生成链路不新增阻塞步骤。
- **SC-003**: `speckit-sync` 仍然只写入 `specs/products/` 及相关规范目录，不直接写入仓库根目录文档。
- **SC-004**: 维护者无需把同一份产品定位、用户群体和功能价值手工维护两次；在验证样例中，`current-spec.md` 与 README 不再出现互相矛盾的产品定位描述。
- **SC-005**: `sync` 和 `doc` 的命令边界在 README / SKILL 描述中保持清晰，用户能区分“内部活规范聚合”和“外部文档生成”两种任务。
