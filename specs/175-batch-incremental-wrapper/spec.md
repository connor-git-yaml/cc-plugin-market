# Feature Specification: Batch Incremental Wrapper

**Feature Branch**: `175-batch-incremental-wrapper`
**Created**: 2026-06-06
**Status**: Draft
**Feature**: F175 — 让 spectra batch 默认走增量模式，打通两层已存在但未打通的增量能力，化解 CLI 命名/语义冲突，确保增量产物与全量字节稳定。

---

## 背景与动机

当前 spectra batch 存在两层"增量"能力但未打通：

- **F156 `buildIncremental`**（`src/knowledge-graph/incremental.ts`）：仅服务 `spectra index` CLI，从未进入 batch 流程
- **`DeltaRegenerator`**（`src/batch/delta-regenerator.ts`）：已实现基于 skeleton-hash 的变更感知，按照直接变更 + BFS 传播决策重生成范围；但 `runBatch` 的 `incremental` 选项默认为 `false`

当前默认路径（`incremental=false`）的跳过逻辑只看 spec 文件是否存在，**不感知源码改动**——源码已改但 spec 文件仍在时，默认路径不会重生成，产物 stale。`DeltaRegenerator` 才是能正确"改 1 文件只重生成受影响模块"的实现，本 Feature 的核心价值是将其设为默认。

此外，三处默认值独立编码（CLI `parse-args.ts`、MCP `server.ts`、`batch-orchestrator.ts`），存在漂移风险；regen 轴（incremental/full）与 BatchMode 质量维度（full/reading/code-only）字面近似，存在 CLI flag 语义混淆隐患。

**本 Feature 做 3 件事（task A / B / C），task D 拆 P2 单独 Feature，不纳入本 spec 范围。**

---

## User Scenarios & Testing

### User Story 1 — 改动单文件时仅重生成受影响模块（Priority: P1）

作为 spectra 用户，当我修改了项目中的一个源文件后重新运行 batch，我期望 spectra 只重新生成受该文件影响的模块 spec，而不是全量重生成，从而在 5 分钟内完成本次 batch 运行。

**为何 P1**：这是 Feature 175 的核心价值主张。DeltaRegenerator 已实现该能力，仅缺"默认开启"这一步。若不做此项，增量模式对用户完全不可见，其余 task 均无意义。

**独立可测**：可在含 git 历史的测试项目上执行两轮 `runBatch`（第一轮全量建立基线，第二轮在修改一个源文件后重新运行），验证 `generateSpec` 调用次数等于直接变更模块数加 BFS 传播命中模块数，且未改模块的 `*.spec.md` 的 mtime 不变。

**Acceptance Scenarios**:

1. **Given** 项目已完成一次全量 batch（所有 `*.spec.md` 存在），**When** 用户修改一个源文件后以默认参数再次运行 batch，**Then** `generateSpec` 的实际调用次数等于 `deltaReport.directChanges` 加 `deltaReport.propagatedChanges` 的模块总数（即受影响模块数），远小于全量模块数。

2. **Given** 同上，**When** batch 完成后检查所有 `*.spec.md` 文件，**Then** 未在 `deltaReport.regenerateTargets` 中的模块，其 `*.spec.md` 文件的 mtime 与第一轮 batch 结束后完全一致（文件未被改写）。

3. **Given** 用户未传任何 regen 轴参数，**When** 调用 batch（CLI / MCP / config 三种入口），**Then** 均默认走增量路径，行为与显式传入 incremental=true 一致。

---

### User Story 2 — 无改动时全 cache hit，极速完成（Priority: P1）

作为 spectra 用户，当项目源码自上次 batch 以来无任何变动，我再次运行 batch，期望快速完成，且**不产生任何模块级 spec 的 LLM 调用**（项目级聚合/debt 阶段是否仍执行见 SC-002/OQ-5 口径）。

**为何 P1**：无改动 cache hit 是增量模式的基础正确性保证。若此场景下仍有**模块级** LLM 调用，则增量逻辑存在根本性缺陷，会无谓消耗 token 配额并拉高 CI 运行时间。

**独立可测**：在同一项目连续执行两轮 `runBatch`（中间不修改任何文件），第二轮验证 `generateSpec` 调用次数为 0，且 `deltaReport.directChanges` 为空。

**Acceptance Scenarios**:

1. **Given** 项目已完成一次全量 batch，**When** 源码无任何改动、以默认增量参数再次运行 batch，**Then** 模块级 `generateSpec` 调用次数为 0，`deltaReport.directChanges` 为空集合，`deltaReport.propagatedChanges` 为空集合。

2. **Given** 同上，**When** 观察两轮 batch 后**模块级** `specs/**/modules/*.spec.md` 文件，**Then** 这些文件的 mtime 与第一轮 batch 结束后一致（未被改写）；项目级聚合产物（`_index.spec.md` / `graph.json`）不在本断言范围（其稳定性见 FR-006/FR-007）。

---

### User Story 3 — 增量产物与全量产物字节稳定（Priority: P1）

作为 spectra 用户（及 CI 流水线），当我对同一项目分别运行一次全量 batch 和一次无改动的增量 batch，期望两次产物在去除时间戳后字节完全一致，保证 CI diff 检测不出现假阳性。

**为何 P1**：byte-stable 是增量产物可信赖的前提。若增量产物与全量产物在内容上不一致（仅因时间戳或节点排序差异），会导致 CI 误报、产物校验失败、以及无法用 diff 判断实际变更。

**独立可测**：对同一 fixture 项目分别运行显式全量 batch 和无改动增量 batch，对比输出产物：`*.spec.md` 文件直接 diff；`graph.json` 剥去 `generatedAt` 字段后做 deepEqual 比较，节点和边按确定性 key 排序。

**Acceptance Scenarios**:

1. **Given** 同一项目运行一次显式全量 batch 产出产物集合 A，**When** 在无源码改动的情况下再运行一次默认（增量）batch 产出产物集合 B，**Then** 对应模块的 `*.spec.md` 内容字节相同（diff 为空）。

2. **Given** 同上，**When** 对 `graph.json` 剥去 `generatedAt` 字段后进行比较，**Then** 节点集合和边集合在按确定性 key 排序后 deepEqual，无额外字段差异。

3. **Given** 全量产物的 `graph.json` 中节点和边按确定性规则排序，**When** 增量 batch 产出新的 `graph.json` 同样经过相同排序归一化，**Then** 二者剥时间戳后内容一致（不依赖 Map 迭代顺序的偶发稳定性）。

---

### User Story 4 — 显式全量逃生口（Priority: P2）

作为 spectra 用户或 CI 管理员，当我需要绕过 cache 强制重新生成所有模块 spec（如怀疑 cache 状态损坏、首次建立 baseline、或升级 LLM 模型后需要全量刷新），我期望能通过一个明确的 regen 轴参数触发全量重生成，且该参数与 BatchMode 质量维度参数（full/reading/code-only）语义完全独立、不互相干扰。

**为何 P2**：逃生口是增量模式上线后必须有的安全阀，但其优先级低于增量默认翻转本身。没有逃生口，用户在 cache 损坏场景下将无法恢复，但这属于异常场景，不影响正常路径的核心价值。

**独立可测**：在有完整历史 spec 缓存的项目上，传入显式全量参数运行 batch，验证 `generateSpec` 对全部模块均被调用，且 `deltaReport` 不影响重生成决策。

**Acceptance Scenarios**:

1. **Given** 项目有完整的历史 spec 缓存且源码无改动，**When** 用户传入显式全量 regen 参数运行 batch，**Then** `generateSpec` 对所有模块均被调用（调用次数等于总模块数），cache 被完全忽略。

2. **Given** 用户同时指定显式全量 regen 参数和某个 BatchMode 质量参数（如 `mode=reading`），**When** 运行 batch，**Then** 全量重生成正常执行（regen 轴生效），且 spec 质量维度按指定的 `mode=reading` 运行，两者互不干扰。

3. **Given** regen 轴参数的 CLI / MCP / config 取值，**When** 用户检查 `--help` 或配置说明，**Then** 说明中 regen 轴参数与 `--mode` 质量参数的描述各自独立，没有语义重叠或混淆。

---

### User Story 5 — 三入口默认值一致（Priority: P2）

作为维护 spectra 集成脚本或 MCP server 的工程师，我期望 CLI、MCP tool 参数、以及 config 文件三个入口对 incremental 的默认值语义完全一致，不存在"CLI 默认增量但 MCP 默认全量"的漂移，避免不同调用路径产生行为差异而难以排查。

**为何 P2**：默认值一致是 task A 的实现质量要求，验证难度低但遗漏会造成隐蔽的行为差异。将其单独列为 User Story 以便独立验证。

**独立可测**：分别通过 CLI、MCP、以及 config 文件三条路径触发 batch（均不显式传 regen 轴参数），验证三者的 `incremental` 实际生效值均为 `true`。

**Acceptance Scenarios**:

1. **Given** 用户不传任何 regen 轴参数，**When** 分别通过 CLI（`spectra batch`）、MCP batch tool、以及 config 文件三条路径触发 batch，**Then** 三条路径最终传入 `runBatch` 的 `incremental` 参数均为 `true`。

2. **Given** config 文件未指定 `incremental` 字段，**When** 通过任意入口运行 batch，**Then** 默认为增量模式（与显式配置 `incremental: true` 等效）。

---

### Edge Cases

**EC-001 — force 与 incremental 同时给出时的优先级**
- `force=true` 与 `incremental=true` 同时传入时，现有代码中 `forceFullRegeneration = force || (incremental && deltaReport.mode === 'full')`，`force` 具有更高优先级（绕过 DeltaRegenerator 决策）。翻转 incremental 默认值后，此优先级语义**必须维持不变**，不得因新增 regen 轴 flag 引入新的优先级歧义。

**EC-002 — 旧 spec 文件无 `generatedByMode` 元数据时的 cache miss 行为**
- 若历史 spec 文件生成时未写入 `generatedByMode` 字段（旧版本产物），DeltaRegenerator 在无法判断 mode 是否一致时，应将该模块视为 cache miss（强制重生成），而不是静默跳过（产生 stale 产物）。

**EC-003 — BatchMode 切换时强制 cache miss（已决议：mode 参与 cache key）**
- 用户将 `mode` 从 `full` 切换为 `reading` 后运行增量 batch，spec 产物的质量维度已变化。若 DeltaRegenerator 仍跳过"源码未变"的模块，其 spec 将保留旧 `mode=full` 的输出——这是语义错误。
- **现状核查**：代码已实现 mode-aware cache —— `batch-orchestrator.ts:489-497` 向 DeltaRegenerator 传入 `effectiveMode`，`delta-regenerator.ts` 在 spec 的 `generatedByMode` 缺失或与当前 mode 不一致时强制视为变更（cache miss）。
- **结论**：mode 切换 MUST 触发受影响模块的 cache miss（见 FR-013，已升 MUST）。这与 FR-004 的"正交"不矛盾：regen 轴**参数解析**与 mode 正交（互不改写对方枚举/默认值），但 mode **必然参与 cache key**（否则产物语义错误）。两层语义在 spec 中显式区分。

**EC-007 — checkpoint / resume 与 force / 全量逃生口的交互**
- batch 支持 checkpoint（`batch-orchestrator.ts:612-637` 加载，`completedPaths.has(moduleName)` 在重生成决策前直接 return，`batch-orchestrator.ts:711`），checkpoint 仅在整轮成功后清理。
- 风险：存在残留 checkpoint 时，显式全量 / `force` 可能因 `completedPaths` 命中而**不重新生成全部模块**——绕过逃生口语义；增量 resume 也可能跳过"checkpoint 已完成但其后又变更"的模块。
- 要求见 FR-016。

**EC-008 — 源文件删除 / 模块重命名后的增量与产物文件集**
- DeltaRegenerator 只遍历**当前** snapshot（`delta-regenerator.ts:217-244`），删除源文件或重命名模块后，旧 `*.spec.md` 可能继续残留磁盘，导致"增量输出目录的文件集"与"干净全量输出"不一致，破坏 byte-stable（文件集维度）。
- 要求见 FR-017（本 Feature 至少须定义策略并被 byte-stable 口径覆盖；具体删除/归档实现可留 plan）。

**EC-009 — 孤儿删除的 ownership 边界（防误删用户手写 spec）**
- FR-017 将孤儿策略定为"删除"，但输出目录可能混有**用户手写**的 `*.spec.md`（无 batch 生成元数据）。若不加 ownership 判定，文件集收敛会误删用户内容。
- 要求：删除 MUST 仅限 batch 自身生成的产物（凭 **`generatedByMode`** 元数据 **且** 位于受管 `modules/` 目录判定，二者皆必要；**不用 `generatedBy`**——它对单文件 `spectra generate` 产物也写入会误判），其余一律保留。见 FR-017 ownership 边界条款。E2E（SC-007）须含"目录内混入无 `generatedByMode` 手写 spec → 增量删除不触及该文件"用例。

**EC-004 — baseline-collect 和 eval 路径被 cache 污染**
- `scripts/baseline-collect.mjs` 等性能基线采集脚本若默认走增量，则"已有缓存"的项目基线结果将反映 cache hit 速度而非真实全量处理时长，导致性能基线失真。需考虑是否在 baseline-collect 中默认加显式全量参数。

**EC-005 — 并发 batch 运行竞态**
- 多个 batch 实例并发写同一项目的 spec 输出目录时，mtime 比较和 cache skip 决策可能因竞态导致不一致。本 Feature 范围内不要求解决此场景，但应确保增量逻辑不引入比现有更严重的竞态风险。

**EC-006 — 首次运行（无历史 spec）时的行为**
- 项目从未运行过 batch（无任何 `*.spec.md`），此时 DeltaRegenerator 的 skeleton-hash 无基线可比，应退化为全量生成（等同 `incremental=false` 的首次运行），而不是报错或空跑。

---

## Requirements

> **关于本节的写作口径（平台基础设施 Feature 约定）**
> F175 是 spectra **内部 batch 引擎**的改造，没有终端 UI；其"用户"是开发者 / CI / MCP 调用方，验收对象是内部可观察行为（`generateSpec` 调用次数、`deltaReport` 字段、产物字节稳定性）。因此本节采用**双重验收口径**：每条 FR 既给出用户可观察结果（速度/产物一致性/逃生口可用），也给出内部可观察信号作为可落测锚点。
> FR/SC 中出现的具体文件路径、行号、函数名（如 `batch-orchestrator.ts:489-497`、`writeKnowledgeGraph`、`resolveRegenPlan`）均为 **`[实现参考]`**——它们是 Codex 阶段性审查为保证可追踪性而锚定的现有代码位置，**不构成对实现方式的强制约束**（plan/tasks 阶段可调整具体落点）。需求的规范性内容是 MUST/SHOULD 描述的**行为**，实现锚点仅供导航。

### Functional Requirements

**FR-001**: batch 运行 MUST 默认走增量路径（`incremental=true`），CLI、MCP tool、以及 config 文件三个入口的 incremental 默认值必须一致。 `[必须]` — 去掉此项则 task A 的核心价值（默认翻转）无法实现。（追踪：US-1, US-2, US-5）

**FR-002**: 三处独立编码的 incremental 默认值（`parse-args.ts`、`server.ts`、`batch-orchestrator.ts`）MUST 归一化为统一来源，消除默认值漂移风险。 `[必须]` — 不归一化则三入口默认值可随时再次漂移，FR-001 的保证失效。（追踪：US-5）

**FR-003**: batch MUST 保留显式全量逃生口：用户可通过 regen 轴参数（具体 flag 名称由 plan 阶段决议）触发对全部模块的 `generateSpec` 调用，绕过所有 cache 决策。 `[必须]` — 无逃生口则 cache 损坏或 baseline 场景无法恢复。（追踪：US-4）

**FR-004**: regen 轴（增量/全量控制）与 BatchMode 质量维度（`full | reading | code-only`）MUST 在**参数解析层**正交：regen 轴参数不得修改 BatchMode 枚举/默认值，BatchMode 参数不得改写 regen 轴 flag/默认值。但二者**并非完全独立**——mode MUST 参与 cache key（见 FR-013/EC-003）：mode 变更须触发受影响模块 cache miss，否则产物质量维度与请求不符。spec 显式区分"flag 解析正交"与"cache key 耦合"两层语义。 `[必须]` — 误把"正交"理解为"mode 不进 cache key"会产生 stale 产物；不满足参数解析正交则破坏 `baseline-collect.mjs`、MCP enum、`parse-args.ts` 现有取值。（追踪：US-4, EC-003）

**FR-005**: 在增量路径下，未被 `DeltaRegenerator` 纳入 `regenerateTargets` 的模块，batch MUST 不改写其模块级 `specs/**/modules/*.spec.md` 文件（mtime 不变）。**范围限定**：本 FR 仅约束模块级 spec；项目级聚合产物（如 `_index.spec.md`、`graph.json`）每轮可能重写，其稳定性由 FR-006/FR-007 的归一化口径负责，不在本 FR 的"mtime 不变"约束内。 `[必须]` — 模块级 mtime 变化会导致 CI diff 假阳性，破坏增量语义可信度。（追踪：US-1, US-2）

**FR-006**: byte-stable 比较场景下，`graph.json` 的**全部时间戳来源** MUST 被归一化，使全量产物与增量产物字节等价。归一化面 MUST 至少覆盖：(a) 顶层 `generatedAt`（`graph-builder.ts:438`）；(b) 折叠进 `inputHash` 的嵌套时间戳（`docGraph.generatedAt` / `architectureIR.generatedAt`，见 `graph-builder.ts:412-425` + `doc-graph-builder.ts:235-237`）——剥顶层 `generatedAt` 但 `inputHash` 仍随时间漂移则归一化无效。 `[必须]` — 仅剥顶层时间戳不足以达成 byte-stable。（追踪：US-3, OQ-3）

**FR-007**: `graph.json` 的节点 / 边 / 超边 MUST 在**最终写盘边界**（`writeKnowledgeGraph` 或写盘前统一 normalize）按确定性 key 排序，并定义冲突 tie-breaker，不依赖 Map 迭代顺序。归一化 MUST 发生在 batch 追加 semantic edges / hyperedges 之后（`batch-orchestrator.ts:1365-1367` 在 graph-builder 输出之后还会追加边，仅在 graph-builder 内排序不足）。 `[必须]` — 后追加的 links/hyperedges 会破坏 graph-builder 内排序的稳定性。（追踪：US-3）

**FR-008**: 在无源码改动的情况下以默认增量参数运行 batch，**模块级** `generateSpec` 调用次数 MUST 为 0，`deltaReport.directChanges` 与 `deltaReport.propagatedChanges` MUST 为空。**范围限定**：本 FR 约束模块级 spec 生成；项目级文档 / debt pipeline 等聚合阶段是否仍执行不在本 FR 保证内（其稳定性由 FR-006/FR-007 负责，其 LLM 开销由 SC-002 的口径界定）。 `[必须]` — 此为 US-2（全 cache hit）核心验收条件。（追踪：US-2）

**FR-009**: 新的 E2E 测试 MUST 覆盖增量核心路径：含 git init + 改文件 + 多轮 `runBatch` 的用例，沿用 `tests/e2e/batch-pipeline.e2e.test.ts` 的 `vi.mock` + 临时目录范式。 `[必须]` — 无 E2E 覆盖则增量逻辑的正确性无法通过自动化回归保证。（追踪：US-1, US-2, US-3）

**FR-010**: 本 Feature 的改动 SHOULD NOT 引入现有 vitest 测试集的任何回归（当前全部 vitest 测试零失败目标）。 `[必须]` — 仓库级质量门要求。（追踪：所有 US）

**FR-011**: `force=true` 与 `incremental=true` 同时传入时，`force` MUST 具有更高优先级（绕过 DeltaRegenerator 决策，等同全量重生成），此语义 MUST 维持不变。 `[必须]` — 现有代码已如此实现，新增 regen 轴 flag 不得破坏此优先级语义。（追踪：EC-001）

**FR-012**: 无历史 spec 文件（首次运行）时，增量路径 MUST 退化为全量生成，不得报错或空跑。 `[必须]` — 首次运行是基础使用场景，必须正确处理。（追踪：EC-006）

**FR-013**: 当 spec 的 `generatedByMode` 缺失（旧版本产物）或与当前 `effectiveMode` 不一致时，DeltaRegenerator MUST 将该模块视为 cache miss（强制重生成），而非静默跳过。 `[必须]` — 静默跳过会产生质量维度与请求 mode 不符的 stale 产物（见 EC-002/EC-003）；代码现已如此实现，本 FR 锁定该行为并要求 E2E 覆盖。（追踪：EC-002, EC-003）

**FR-016**: 显式全量 / `force` 路径 MUST 不被残留 checkpoint 绕过：force / 全量逃生口生效时，MUST 清理或忽略 `completedPaths`，确保对全部模块调用 `generateSpec`。增量 resume 时，若 checkpoint 中"已完成"的模块在本轮 delta 中命中变更，MUST 使该模块 checkpoint 失效并重新生成。 `[必须]` — 否则 FR-003/FR-011 的逃生口语义在有 checkpoint 时失效（见 EC-007）。（追踪：US-4, EC-007）

**FR-017**: byte-stable 口径 MUST 覆盖**输出目录文件集**维度（不仅是单文件内容）：源文件删除 / 模块重命名后，增量产物的 `*.spec.md` 文件集 MUST 与同状态下的干净全量产物文件集一致（即对残留/孤儿 spec 须有明确策略——删除、归档或从索引过滤——并使两条路径收敛）。具体删除/归档实现可由 plan 决定，但策略与验收口径 MUST 在本 Feature 内确定。[AUTO-CLARIFIED: 默认策略倾向"删除孤儿 spec" — 理由见 Clarifications/Session 2026-06-06]
- **ownership 边界（MUST）**：孤儿删除 MUST 仅作用于 **batch 自身生成的产物**——判定依据为 spec frontmatter 的 **`generatedByMode`** 字段存在（batch 特有标记，由 runBatch 写入）**且** 位于 batch 受管的 `modules/` 输出目录内（两者皆为必要条件）。**不能用 `generatedBy` 判定**——`generatedBy` 对所有 spectra 生成的 spec（含 `spectra generate` 单文件产物）都会写入，会误判；只有 `generatedByMode` 是 batch 专属。无 `generatedByMode`、人工手写、或受管目录之外的 `*.spec.md` MUST NOT 被删除（宁可保留为孤儿也不得误删用户内容）。删除前 SHOULD 记录日志，便于审计与回滚。
`[必须]` — 不处理则增量与全量产物在文件集维度漂移（见 EC-008）；无 ownership 边界则有误删用户手写 spec 的风险（见 EC-009）。（追踪：US-3, EC-008, EC-009）

**FR-018**: 增量传播正确性 MUST 由**独立于 deltaReport 的断言**验收：构造"模块 A 依赖模块 B"的 fixture，改 B 后 MUST 重生成 A；并覆盖多跳传播、diamond 依赖、cyclic 依赖（BFS MUST 终止）。验收断言 MUST 比对**预期 target 集合**，而非仅"generateSpec 调用次数 == deltaReport.regenerateTargets"（后者在 deltaReport 自身错误时会同义反复地通过）。 `[必须]` — 否则 BFS 方向/owner 归属/环处理错误无法被测试捕获。（追踪：US-1, EC-001）

**FR-019**: DeltaRegenerator 计算 `regenerateTargets` 时的 sourceTarget 口径 MUST 与 runBatch 重生成决策时的 sourceTarget 口径一致（含单文件目录冲突场景：`delta-regenerator.ts:236-239` 用 `group.dirPath` vs `batch-orchestrator.ts:713-720` 在冲突时改用文件路径）。两处 target 解析 SHOULD 抽取为共享函数复用（与 REFACTOR 阶段的 `resolveRegenPlan` 一并），并由含目录冲突的 fixture 覆盖。 `[必须]` — 口径错位会导致模块出现在 deltaReport 却不触发生成（或反之），增量结果错误。（追踪：US-1）

**FR-014**: `baseline-collect.mjs` 等性能基线采集脚本 SHOULD 支持显式传入 regen 轴全量参数，防止性能基线因 cache hit 失真。具体是否默认强制全量，由 openQuestion OQ-4 决议。 `[可选]` — 去掉后 baseline 脚本仍可运行，但基线数据质量受影响。（追踪：EC-004, OQ-4）

**FR-015**: task D（增量路径复用 F156 snapshot 消除冗余 AST 全扫）MAY 在后续独立 Feature 中实现，不纳入本 Feature 范围。 `[YAGNI-移除]` — 正确性风险高（扫描口径差异：includeOnly `/^src/` + tsconfig alias），当前迭代移除以降低复杂度和回归风险。（Out of Scope）

### Key Entities

- **regen 轴（Regen Plan）**：控制本次 batch 是走增量（DeltaRegenerator 决策）还是全量（全部模块重生成）的参数维度，与 BatchMode 质量维度正交。包含至少两个状态：默认增量、显式全量。
- **DeltaRegenerator**：基于 skeleton-hash 比对产出 `deltaReport`，包含 `directChanges`（直接变更模块）、`propagatedChanges`（BFS 传播命中模块）、`unchangedTargets`（跳过模块）、`regenerateTargets`（需重生成模块集合）。
- **BatchMode**：质量维度枚举（`full | reading | code-only`），控制 spec 生成的详细程度，与 regen 轴独立。
- **byte-stable 产物**：`*.spec.md`（跳过模块不改写，直接稳定）+ `graph.json`（需归一化 `generatedAt` + 确定性节点/边排序后稳定）。

---

## Success Criteria

### Measurable Outcomes

**SC-001**: 改动 1 个源文件后运行 batch，模块级 `generateSpec` 实际调用次数等于 `deltaReport.regenerateTargets` 的模块数（且该集合经 FR-018 的独立断言验证为"直接变更 + 真实依赖传播"而非全量）。**性能目标**（goal，非门禁）：相对全量基线，增量 wall-clock 显著下降；blueprint 设定的"改 1 文件 < 5 min"作为在指定 fixture（中型 TS 项目，约 250 模块）上的目标值，测量口径与硬件在 plan/verify 阶段固定，绝对数字达不到不阻塞交付，但增量 wall < 全量 wall MUST 成立。

**SC-002**: 无源码改动时再次运行 batch，模块级 `generateSpec` 调用次数为 0，`deltaReport.directChanges`/`propagatedChanges` 为空。**性能目标**（goal）：blueprint 设定"cache hit < 30 sec"为指定 fixture 上的目标；本 Feature 的**门禁口径**为"无模块级 LLM 调用 + 增量 wall 显著低于全量"。注：项目级聚合/debt 阶段若仍执行可能产生少量非模块级 LLM 调用，是否纳入 fast-path 跳过由 OQ-5 决议。

**SC-003**: 同一项目的全量产物与无改动增量产物：模块级 `*.spec.md` 字节 diff 为空；`graph.json` 在按 FR-006 归一化全部时间戳来源（含 `inputHash` 嵌套时间戳）+ FR-007 确定性排序后 deepEqual。验收口径为严格 deepEqual（见 OQ-3 已倾向收敛为方案 A）。

**SC-004**: CLI、MCP、config 三入口均不传 regen 轴参数时，实际生效的 `incremental` 值均为 `true`（可通过日志或 deltaReport 验证）。

**SC-005**: 显式全量参数触发时（即使存在残留 checkpoint，见 FR-016），`generateSpec` 对全部模块调用，调用次数等于项目总模块数。

**SC-006**: 现有 vitest 测试集全部通过（零新增失败），零新增失败；`npm run build` + `npm run repo:check` 零错误。

**SC-007**: 新增 E2E 测试覆盖增量核心路径，沿用现有 `vi.mock('@anthropic-ai/sdk')` + `mkdtempSync` + git init 范式（不产生真实 LLM 调用），至少覆盖：改文件→仅受影响模块重生成、无改动→零模块级调用、显式全量→全量调用、依赖传播正确性（FR-018）、mode 切换→cache miss（FR-013）、删除/重命名文件集收敛（FR-017）、孤儿删除 ownership 边界即"混入无元数据手写 spec 不被删除"（FR-017/EC-009）、含 checkpoint 的 force（FR-016）、目录冲突 target 口径（FR-019）。

---

## Out of Scope

- **task D — 增量路径复用 F156 snapshot 消除冗余 AST 全扫**：现有主流程存在 2 次全量重扫（`buildModuleGraphForProject` + `collectTsJsCodeSkeletons`），与 F156 snapshot 口径存在差异（includeOnly `/^src/` + tsconfig alias），正确性风险高。拆出为后续独立 Feature，待正确性验证后再集成。
- **F156 `buildIncremental` 与 batch 流程的集成**：F156 当前仅服务 `spectra index` CLI，将其接入 batch 是 task D 的范畴，不在本 Feature 内。
- **性能优化（并行化、流式输出等）**：本 Feature 聚焦正确性（默认翻转 + byte-stable），不涉及架构层面的并发优化。
- **多项目 / monorepo 并发 batch 竞态处理**：EC-005 已识别此风险，但解决方案不在本 Feature 范围内。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 / 描述 |
|------|------------|
| **组件总数** | 6 个改动组件：`parse-args.ts`（CLI 默认值 + 新 regen flag）、`server.ts`（MCP 默认值归一化）、`batch-orchestrator.ts`（默认值 + checkpoint 交互 + 写盘归一化 + 文件集收敛）、`delta-regenerator.ts`（mode-aware cache + target 口径）、graph 写盘层（`graph-builder.ts`/`writeKnowledgeGraph` 排序归一化 + `inputHash` 稳定化）、`spec-store.ts`（删除/重命名孤儿策略，FR-017）。新增统一 `resolveRegenPlan`（REFACTOR）。 |
| **接口数量** | 5-6 个：`runBatch` options（regen 轴参数）、CLI parse-args、MCP batch tool schema、graph 写盘 normalize 接口、DeltaRegenerator/runBatch 共享 target 解析、checkpoint 与 regen 决策交互 |
| **依赖新引入数** | 0 — 所有能力（DeltaRegenerator、graph-builder、incremental.ts、checkpoint、spec-store）已存在 |
| **跨模块耦合** | 高 — 改动涉及 `src/cli/`、`src/batch/`、`src/panoramic/graph/`、`src/panoramic/qa/`(spec-store) 四个模块；多为"接通/归一化已有能力"，但 checkpoint × regen、delta target × runBatch target 是真实的跨组件不变量耦合 |
| **复杂度信号** | 含 1 个复杂度信号：BFS 依赖传播 + 环终止（FR-018）；无新状态机/数据迁移；图归一化与 cache 决策属确定性算法 |
| **总体复杂度** | **MEDIUM-HIGH** — 经 Codex 审查后组件数升至 6（>5）、接口 5-6、含 1 个复杂度信号（BFS）。判定接近 HIGH 边界。核心风险：(1) byte-stable 归一化面比初判更宽（`inputHash` 嵌套时间戳 + 写盘后追加边）；(2) checkpoint/mode/target 三处跨组件不变量；(3) 翻转默认值对全部存量测试 + baseline/eval 的涟漪。**建议 GATE_DESIGN 人工审查并要求 plan 阶段先关闭 OQ-1。** |

---

## 待 plan 阶段决议（openQuestions）

**OQ-1 — regen 轴 CLI flag 命名与 `--force` 语义边界 ✅ 已决议（GATE_DESIGN，2026-06-06）**

**决议（用户）**：regen 轴显式全量逃生口采用新增 **`--full`** flag。
plan 阶段仍须收尾以下落点（不再是开放问题，而是实现细节）：
- `--full` 与现有 `--force` 的语义边界：plan 须明确 `--full`（regen 轴=全量重生成、绕过 cache）与 `--force`（现"强制重新生成所有 spec"）的关系——二选一收敛（建议 `--full` 取代/成为 `--force` 的语义，或 `--force` 作为 `--full` 的别名以保后向兼容），避免两个 flag 语义重叠。
- `--full` 在 `--help` 中的措辞 MUST 与 `--mode full`（质量维度）明确区分（如 "`--full`: 全量重生成所有模块（regen 轴），不同于 `--mode full` 的文档完整度"）。
- 三入口映射：CLI `--full` ↔ MCP 参数 ↔ config 字段语义一致。

**OQ-2 — MCP batch tool incremental 默认翻转的影响评估 ✅ 已决议（GATE_DESIGN，2026-06-06）**

**决议（用户）**：MCP batch tool 的 `incremental` 默认**同步翻为 true**（三入口完全一致，符合 FR-001 原意）。
- SWE-Bench cohort 3 等需要全量基线的评测，MCP 调用方须**显式传 `--full`/全量参数**（不依赖默认值）。
- plan 阶段须在 OQ-4 一并确认 cohort 3 / eval 脚本的 batch 调用点已加显式全量，防 cache 污染评测基线。

**OQ-3 — byte-stable 验收的严格性口径**

plan / verify 阶段需约定 byte-stable 的验收口径：
- 方案 A：严格 deepEqual（剥去 `generatedAt` 后节点/边完全一致，zero-diff）
- 方案 B：≤10 nodes 容差（允许极小数量的非确定性差异）

推荐方案 A（严格 deepEqual），理由：容差难以界定合理上限且掩盖潜在 bug。**已收敛**：FR-006（归一化全部时间戳来源，含 `inputHash` 嵌套）+ FR-007（写盘边界确定性排序）使方案 A 成为可达目标，故 SC-003 锁定严格 deepEqual。若 plan 阶段发现多数据源合并存在无法消除的非确定性（即 FR-007 无法在写盘边界完全归一化），方可回退评估容差，但须在 plan 记录具体不可消除项。

**OQ-4 — baseline-collect / eval 是否同步加显式全量 flag**

`scripts/baseline-collect.mjs` 是性能基线采集工具，默认改为增量后，已有缓存的项目将 cache hit，基线结果反映 cache 速度而非全量处理速度，导致跨版本基线对比失真。plan 阶段需决议：
- `baseline-collect.mjs` 是否默认加显式全量 flag（每次基线采集强制全量）？
- 还是增加"基线模式"开关，由调用者显式选择？
- eval 脚本（`eval-task-runner.mjs` 等）是否有同样的污染风险？

**OQ-5 — 无改动时项目级聚合 / debt pipeline 是否走 fast-path 跳过**

即使全部模块 cache hit（模块级 `generateSpec=0`），现有代码仍会执行项目级文档（`batch-orchestrator.ts:1149-1158`）、debt pipeline（`batch-orchestrator.ts:1607-1625`）、并重写 `_index.spec.md`（`batch-orchestrator.ts:1559-1563`），且在有 `ANTHROPIC_API_KEY` 时会创建 LLM client。plan 阶段需决议：
- "cache hit < 30 sec" 目标是否要求为无改动场景增加 fast-path，跳过/稳定化项目级聚合阶段？
- 若不加 fast-path，SC-002 的门禁口径锁定为"无**模块级** LLM 调用"，项目级开销作为已知 cost 记录（当前 spec 取此口径）。
- 此决议直接影响 FR-005/FR-008 的范围限定是否需要进一步收紧。

---

*本 spec 基于 `research-synthesis.md`（主编排器亲自核查 7 条架构主张，含 file:line 证据）生成，架构事实不作重新猜测。openQuestion 中涉及具体实现决策（flag 命名、语义边界、验收口径）留 plan 阶段拍板，spec 层不强行决定。*

---

## Clarifications

### Session 2026-06-06

**C-001 — FR-017 孤儿 spec 处理策略的默认倾向**

**问题**：FR-017 要求"策略与验收口径 MUST 在本 Feature 内确定"，但正文仅列出三个候选策略（删除、归档、从索引过滤）未拍板，导致 SC-007 的"删除/重命名文件集收敛"E2E 测试无具体策略可落测。

[AUTO-CLARIFIED: 默认策略倾向为"删除孤儿 spec 文件" — 理由：(1) 归档策略引入额外目录结构，复杂度高且非必要；(2) "从索引过滤"不删文件，产物文件集仍与全量不一致，不满足 FR-017 的 byte-stable 文件集收敛要求；(3) 删除是最直接使两条路径（增量 vs 全量）产物文件集一致的手段，且与 `spec-store.ts` 已有的文件管理能力对齐。plan 阶段可在此基础上评估删除前是否需要 dry-run 确认或日志记录，但策略方向固定为"删除"。]

**影响**：SC-007 的 E2E 测试可以具体验证：删除源文件后运行增量 batch，旧 `*.spec.md` 须被移除；增量产物文件集与同状态干净全量产物文件集一致。
