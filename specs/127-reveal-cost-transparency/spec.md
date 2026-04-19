# Feature Specification: Reveal & Cost Transparency

**Feature Branch**: `127-reveal-cost-transparency`
**Created**: 2026-04-19
**Status**: Draft
**Input**: User description: "F1 Reveal & Cost Transparency — 让 Spectra 已实现但被隐藏的图查询能力浮到首屏，并让 LLM 成本透明化、可预测、可审计。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 图能力发现（Priority: P1）

一个刚接触 Spectra 的开发者（或外部评审者）在仓库跑完 batch 后，打开生成的文档索引，能立即看到本项目的核心代码抽象（core abstractions）、意外连接（surprising cross-module connections）、和如何用结构化查询工具追问更多问题的入口。他们不需要翻阅多个文件或阅读源代码才知道 Spectra 提供了图查询能力。

**Why this priority**: 这是本次对比测试暴露的**首要问题** — Spectra 已实现的图能力因为没有在主要输出里展示，被外部评审者直接归为"Graphify 独有"。修复这个认知盲区**零架构改动、零 LLM 成本、立竿见影**，是 ROI 最高的改进。

**Independent Test**: 在 graphify 示例测试项目（5 个 Python 文件）跑完 batch 后，一个从未接触过 Spectra 的人只打开生成的 README 入口文档，应能在 30 秒内：
1. 看到项目中被识别为"核心抽象"的前几个函数或类
2. 看到至少一条"你可能没意识到"的跨模块依赖
3. 找到如何发起进一步查询（"这个节点连接了谁"、"从 A 到 B 的路径是什么"）的明确入口

**Acceptance Scenarios**:

1. **Given** 已经跑完 `spectra batch`，**When** 用户打开 `specs/README.md`，**Then** 在首屏能看到"代码核心抽象"和"意外连接"两个摘要小节，且每个摘要都指向完整分析报告的具体锚点
2. **Given** 用户已安装 Spectra 插件到支持 MCP 的 AI 助手，**When** 用户查看插件文档或 `/help` 输出，**Then** 能看到图查询能力的至少 5 种用法（按节点查、按路径查、按社区查、识别核心节点、自然语言查），每种都有使用示例
3. **Given** 用户想追踪某个具体函数的影响范围，**When** 用户从 README 的图摘要点击对应节点链接，**Then** 能跳转到完整 graph 报告的该节点详细信息

---

### User Story 2 - LLM 成本透明化（Priority: P1）

一个正在为团队评估是否引入 Spectra 的工程师，跑完一次 batch 后想向团队汇报"这次文档生成消耗了多少 LLM 成本"。他们需要从生成的产物里直接读到：总输入/输出 token、总耗时、哪个模块最贵、和项目规模（文件数/代码行数）的性价比。不需要自己去翻日志或运行附加分析。

**Why this priority**: Spectra 目前对"LLM 成本"是**完全黑盒**。用户对 5 文件小项目跑了 776 秒却不知道花了多少 token。这让 Spectra 在和"零 token"的同类工具（Graphify AST 模式）对比时缺乏说服力。透明化是采纳决策的关键前提，也是后续所有需要追踪 LLM 使用的 Feature（F3 技术债抽取、F4 语义锚定、F5 问答）的**共享基础设施**。

**Independent Test**: 在任意跑过 LLM 的 batch 之后，不查看任何源代码或日志，仅读产出的文档，应能在 1 分钟内回答以下问题：
1. 本次 batch 总共调用了多少 input token / output token / 花了多少毫秒？
2. 哪个模块的 LLM 开销最大？
3. 按每千行代码的 token 消耗来看，这个项目的 Spectra 成本效率如何？
4. 哪些文档是 AST-only 降级产生的（LLM 没跑）？为什么降级？

**Acceptance Scenarios**:

1. **Given** LLM 成功调用产出一个 module spec，**When** 用户打开该 spec 文件查看头部元数据，**Then** 能看到该次生成消耗的 input tokens、output tokens、毫秒耗时三项数据
2. **Given** LLM 在某个生成器上降级（如 API 限流、context 超限、无可用 model），**When** 用户查看对应产物，**Then** 元数据中仍有成本字段（为 0）但附带可读的降级原因说明
3. **Given** 一次完整 batch 完成，**When** 用户查看 batch 汇总报告或质量报告，**Then** 能看到按模块分组的成本明细表（从大到小排序）和按生成器分组的成本占比
4. **Given** 同一项目连续跑两次 batch，**When** 用户对比两次的成本数据，**Then** 能识别出哪个模块在第二次跑得更贵或更便宜

---

### User Story 3 - 预算控制（Priority: P2）

一个负责在 CI/CD 流水线中集成 Spectra 的 DevOps 工程师，希望能够：(a) 在 PR 检查中跑 Spectra 的"预览模式"（不实际调用 LLM，只估算成本）验证 PR 是否会导致文档生成成本暴涨；(b) 在生产 batch 中设置预算上限，超预算时要求人工确认或自动降级，避免意外的大账单。

**Why this priority**: 基于 Story 2 的基础设施，属于**进阶能力**。没有 Story 2 先交付，Story 3 无法做出准确的预估。但 Story 3 是面向大型项目和团队规模化使用的关键能力 — 小项目单次测试不一定用得上，但缺了它，Spectra 就难以在组织级别推广。

**Independent Test**: 在一个已知会消耗约 30k token 的项目上跑两种模式并验证结果：
1. "仅预估"模式：不调用 LLM，应在秒级产出一份预估报告（覆盖所有模块、每个模块的预估 input/output token、预估总耗时）
2. "预算 5000 token"模式：批处理应在开始执行 LLM 调用之前就发现超预算，并给出明确的选择提示（继续 / 降级到更便宜的 model / 跳过语义增强 / 取消）

**Acceptance Scenarios**:

1. **Given** 用户想评估成本而不产生实际消耗，**When** 用户启动 batch 的"仅预估"模式，**Then** 流程在 AST 分析完成后停止，产出一份包含每模块预估 token 数和总预估的报告，**且**没有任何实际 LLM 调用发生
2. **Given** 用户设置预算低于项目预估需求，**When** batch 开始时的预估步骤发现超预算，**Then** 流程暂停并以结构化方式呈现选择：继续 / 切换到更便宜的 model 重估 / 跳过可选的增强阶段 / 取消
3. **Given** 用户设置预算高于项目预估需求，**When** batch 正常完成，**Then** 汇总报告会对比"预估值 vs 实际值"，且偏差超 20% 时给出 warning（说明估算模型需要调整）
4. **Given** 用户在 MCP 或 CI 自动化场景下调用 batch 工具，**When** 传入预算和 dry-run 参数，**Then** 参数行为和命令行保持一致，且所有交互式提示都能通过结构化参数替代（例如 `--on-over-budget=skip-enrichment`）

---

### Edge Cases

- **AST-only 项目（无 LLM 调用）**：图摘要和成本字段都应存在但值为 0，降级原因字段说明"未启用 LLM"或"LLM 不可用"
- **项目太小没有 God Node**（所有节点度数接近平均）：首屏图摘要应优雅说明"本项目规模较小，未识别到显著核心抽象节点"，而不是留空或报错
- **项目没有 Surprising Connections**（所有连接都在同一社区）：首屏摘要同样应给出可读的占位说明
- **LLM 实际成本偏离估算**：估算准确性不保证，首次跑后应记录实际值以校准后续估算；若多次运行偏差持续 > 50%，应在质量报告中标注"成本估算可靠性低"
- **历史 spec 没有 tokenUsage 字段**：读取历史 spec 时必须向后兼容，缺失字段视为"未知"而非报错
- **同一 spec 跨多次 batch 累积成本**：spec 的成本字段反映**本次生成**的消耗，不是累积值；累积值（如有需要）由批汇总或单独报告提供
- **dry-run 产物和实际产物不一致**：dry-run 不产生 .spec.md 文件，只产生单独的 dry-run 报告，避免用户误以为 dry-run 等于实际运行
- **预算超限时用户选择"降级到更便宜的 model"**：降级后的重估可能仍然超预算，需要允许二次提示，避免无限循环（最多 2 次选择后强制取消或继续）

## Requirements *(mandatory)*

### Functional Requirements

**图能力发现（P1）**

- **FR-001**: 系统必须在 batch 生成的入口索引文档的首屏位置（在产品概览之后、架构接口之前）包含"核心代码抽象"摘要，列出图谱中度数最高的前 5 个节点及其简要说明
- **FR-002**: 系统必须在同一首屏位置包含"意外连接"摘要，列出至少前 3 条跨社区或低置信度的连接
- **FR-003**: 两个摘要节的每个条目必须提供指向完整图报告对应详细信息的可点击链接
- **FR-004**: 系统必须在入口索引文档的"架构与接口"节末尾或同等突出位置，明确指引用户使用图查询能力（按节点查、按路径查、按社区查、识别核心节点、自然语言查）
- **FR-005**: 系统必须在插件文档（SKILL.md 或等同入口文档）中以用户可发现的方式列出所有图查询工具，每个工具至少包含：名称、用途一句话、典型调用参数示例、预期输出形态示例

**成本透明化（P1）**

- **FR-006**: 系统必须在每个通过 LLM 生成的产物（module spec、project doc）的元数据头部记录该次生成的 input token 数、output token 数、毫秒级耗时
- **FR-007**: 系统必须对 AST-only 降级生成的产物同样记录成本字段（token 数为 0），并附带可读的降级原因（如"LLM 不可用"、"context 超限"、"被显式跳过"）
- **FR-008**: 系统必须在 batch 完成后的汇总日志中包含"LLM 成本汇总"节，至少展示：总 input token、总 output token、总耗时、按模块/文档分组的明细表（从高到低排序）、按生成器分组的明细
- **FR-009**: 系统必须在质量报告中包含"LLM 成本与预算"节，至少展示：本次总成本、按生成器的成本占比、性价比指标（token 数 / 代码千行数）
- **FR-010**: 系统读取历史产物时必须向后兼容，缺少成本字段的产物不得引发解析错误，且在汇总中标注为"成本未知"

**预算控制（P2）**

- **FR-011**: 系统必须提供"仅预估"模式：执行到 AST 分析和文件清单完成后停止，不调用任何 LLM，产出独立的预估报告（不产生实际 spec 文件）
- **FR-012**: 预估报告必须包含：每个待生成模块/文档的预估 input/output token、每个生成器的预估总开销、本次 batch 的预估总开销、预估模型所依据的假设（如"基于历史平均 token/LOC 比率 X"）
- **FR-013**: 系统必须支持"预算上限"参数：在 AST 分析后、LLM 调用前执行预估，若预估值超过用户设定上限，必须暂停并以结构化方式让用户选择后续动作（继续 / 切换更便宜的 model / 跳过可选增强 / 取消）
- **FR-014**: 预算检查的结构化选择必须同时支持交互式（命令行 prompt）和非交互式（参数传入预设决策，如 CI 场景）两种使用方式
- **FR-015**: 实际执行完成后，汇总报告必须对比"预估值 vs 实际值"，若偏差超过 20% 必须明确标注 warning，以帮助后续估算模型迭代
- **FR-016**: MCP 批处理工具入口必须同步支持预算和 dry-run 参数，参数行为与命令行保持一致

### Key Entities *(include if feature involves data)*

- **Cost Metadata**：每个 LLM 生成产物（或其降级替代）所携带的成本记录。包含输入/输出 token 数、毫秒耗时、使用的模型标识、降级状态和原因。是成本透明化的原子数据单元。
- **Budget Preview Report**：dry-run 模式产出的预估报告，独立于实际产物。包含按模块/按生成器的预估成本、所用预估模型的假设、基准数据（如历史平均 tokens/kLOC）。
- **Graph Summary Block**：生成到入口索引首屏的图摘要结构化内容。包含核心抽象节点列表、意外连接列表、指向完整图报告的锚点链接。
- **Batch Cost Summary**：批处理完成后汇总的整体成本记录。包含总计、分组明细（按模块/按生成器）、预估-实际对比、偏差 warning。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在所有跑过 LLM 的 batch 产出上，用户能在**不看源代码、不查日志**的情况下，仅通过阅读入口索引文档在 30 秒内说出"本项目的 3 个核心代码抽象"和"1 条意外跨模块连接"
- **SC-002**: 在 5 个不同规模的测试项目（小/中/大/含多语言/含 design-doc）上验证，用户能从插件文档直接找到并成功触发所有 5 种图查询方式，且成功率 ≥ 95%
- **SC-003**: 跑完 batch 后，用户能在 1 分钟内从产物中回答"本次生成消耗的总 token 数"、"哪个模块最贵"、"和上次相比贵了还是便宜了"这 3 个问题，信息齐全度 100%
- **SC-004**: dry-run 模式在任意项目上的执行时间 ≤ 同项目实际 batch 时间的 5%（即预估本身不引入显著开销），且预估值和实际值的**单模块偏差** ≤ 30%（超出则视为估算模型需改进）
- **SC-005**: 在超预算的项目上，"预算上限"参数必须在 AST 阶段完成 + LLM 阶段启动前就触发交互；若用户选择取消，不得有任何 LLM 调用实际发生（通过 token 消耗审计验证）
- **SC-006**: 历史产物（本 Feature 之前生成的 spec）能够无错误读取，所有现有 batch 测试套件在不修改 fixture 的前提下仍全部通过（向后兼容性验证）
- **SC-007**: 外部评审者（未参与 Feature 开发的第三方）在阅读插件文档和首屏索引后，对 Spectra 的主要能力认知正确率 ≥ 85%（特别是：能正确说出 Spectra **有**图查询、社区检测、核心节点识别能力）

## Assumptions

1. **图报告已经存在且质量足够**：首屏摘要直接从已生成的图分析报告提取，不改变底层图分析逻辑。若底层图分析质量不足（如 Fix 128 之前的 bundle 污染问题），应在本 Feature 之外独立修复。
2. **Token 计数由底层 LLM 客户端提供**：主流 LLM SDK 在响应中返回 token 使用信息；本 Feature 只负责聚合和呈现，不重新实现 tokenization。
3. **预估模型可以不完美**：首次实现只需基于"代码规模 × 历史平均 token/LOC"的简单模型；后续 Feature 可基于实际运行数据迭代。
4. **降级原因的描述以现有降级决策点为准**：不扩展新的降级场景，只为现有降级路径补充可读描述。
5. **MCP 工具宣传不改变工具本身**：只在文档层面补全说明；5 个图工具的实际行为、参数、返回格式在本 Feature 中保持不变。

## Out of Scope *(explicit non-goals)*

- **SpecStore / source_kind 重构** → F2 Harden
- **Open Questions / TODO 扫描** → F3 Debt Intelligence
- **函数级语义锚定 / Hyperedges** → F4 Anchor
- **自然语言问答 operation / `--mode=reading` 轻量模式 / graph.html 交互可视化** → F5 Reading UX
- **和 Graphify 的深度双向集成** → F6 Integrate (Vision)
- **优化底层图分析算法**（本 Feature 只暴露已有输出，不修改图构建逻辑）
- **优化 LLM 调用效率**（本 Feature 只记录和呈现成本，不做成本优化）

## Dependencies

- **无其他 Feature 依赖**（可独立启动）
- **外部依赖**：已有的图分析产物（`_meta/GRAPH_REPORT.md`、`_meta/graph.json`）必须在 batch 完成后可用
- **Phase 1 能力保留**：必须不破坏现有的 AST-only 降级路径、多语言支持、panoramic pipeline

## Future Feature Integration

本 Feature 建立的基础设施被后续 Feature 直接复用：

- **F3 Debt Intelligence**：技术债图节点的生成器会使用本 Feature 的 tokenUsage 字段追踪债务提取本身的 LLM 成本
- **F4 Anchor**：函数级语义锚定会通过 embedding 生成，这部分成本归入 tokenUsage 统计体系
- **F5 Reading UX**：`--mode=reading` 轻量模式会复用本 Feature 的 budget 机制来做"默认低预算"行为
