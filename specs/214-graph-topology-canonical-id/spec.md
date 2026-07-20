# Feature Specification: Graph Topology / Canonical Symbol ID（M9 轨道 B1）

**Feature Branch**: `claude/graph-topology-canonical-id-1de3ab`
**Created**: 2026-07-20
**Status**: Draft
**输入**: M9 路线图 `docs/design/milestone-M9-codex-trusted-live-graph.md` §4 B1（Trusted Live Graph 底座件）
**调研基础**: `specs/214-graph-topology-canonical-id/research/tech-research.md`（codebase-scan 模式，8+2 处锚点核实，无产品调研）
**修订记录**: 2026-07-20 经 Codex（gpt-5.6-sol）对抗审查（3 critical + 8 warning）后修订，详见文末"需求模糊点说明"

## 概述

Spectra 的知识图谱当前存在两个结构性缺陷：(1) module 与其内部 symbol 之间没有显式的 `contains` 边，层级关系只能靠 ID 字符串中的分隔符隐式推断；(2) Python 符号与 TypeScript/JavaScript 符号使用两套不同的 ID 分隔符（`file.py#symbol` vs `file.ts::symbol`），导致同一逻辑符号在图中产生重复节点，且这些重复节点会逃过 F193 已建立的相对化、可移植性扫描与新鲜度检测三道护栏。本 feature（M9 轨道 B1）修复这两个底座缺陷：补齐 module→symbol（含 class member 层级，语言无关）的 `contains` 边，并把 symbol ID 收敛为单一 canonical 格式；同时为 canonical model / derived view / persisted representation 三层之间的转换建立可验证的合同，并确保 graph-only 与 full batch 两条建图路径在共同数据源上的节点/边口径保持等价，差异只允许来自显式列举的 full-only 专属数据源。

本 feature 不引入新的顶层图抽象层，延续现有 `src/knowledge-graph`（canonical model）/ `src/graph`（derived view）/ `src/panoramic/graph`（persisted + query representation）三模块划分（调研 §5，已核实实际职责与目录名的对应关系：canonical model 事实上落在 `src/knowledge-graph`，而非字面意义上的 `src/graph`）。

**范围澄清（重要）**：本 feature 的 canonical ID 收敛与 legacy 检测只作用于**通用 symbol 生产路径**（`src/knowledge-graph` 的 `deriveNodesFromSkeletons`、`src/adapters/python-adapter.ts` 的 `extractSymbolNodes`）产出的 module/class/function/member 节点；`src/panoramic/api-surface`（FastAPI/Express 等 router 提取器）产出的 API 节点即便同样使用 `#` 分隔符，也属于不同的节点语义（api 而非 symbol），不在本 feature 的收敛与 legacy 检测范围内（见 FR-003、FR-008、Edge Cases）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 通过 contains 边追溯代码层级结构（Priority: P1）

作为使用 Spectra MCP 工具（`graph_query`/`graph_node`/`graph_path`）的 Agent 或开发者，我希望能够沿着"模块 → 类/函数 → 类成员"的层级边遍历图谱，而不是靠猜测 ID 中的分隔符来判断某个 symbol 属于哪个模块、某个方法属于哪个类；且这一能力不因语言不同（TS/JS 或 Python）而有差别。

**Why this priority**: 这是 M9 Trusted Live Graph 的底座能力，B2 质量门（duplicate/orphan/dangling 检测）与后续所有依赖图遍历的能力都建立在"层级边真实存在"这一前提上；没有 contains 边，图在结构上是"扁平节点集合 + 少量 calls/depends-on 边"，无法支撑可信的拓扑分析。

**Independent Test**: 对一个含 class（TS 与 Python 各一份，Python class 含 method/property/classmethod/staticmethod）与顶层函数（TS 与 Python 各一份）混合的项目跑 `spectra batch --mode graph-only`，用 `graph_node` 查询任意模块节点的下游邻居，断言能看到该模块下所有受支持 symbol 的 `contains` 边；对含 class member 的文件（不论语言），断言存在 module→class 与 class→member 两级边，且不存在 module→member 的扁平直连边。

**Acceptance Scenarios**:

1. **Given** 一个 TS 项目，其中某文件定义了一个含两个方法的 class，**When** 运行 `spectra batch --mode graph-only` 建图，**Then** 图中存在 `module -[contains]-> class` 边一条，以及 `class -[contains]-> method` 边两条（每个方法各一条），且不存在 `module -[contains]-> method` 的扁平直连边。
2. **Given** 一个 Python 项目，其中某文件定义了一个含 method、property、classmethod、staticmethod 各一个的 class，**When** 建图完成，**Then** 图中存在 `module -[contains]-> class` 边一条，以及 `class -[contains]-> member` 边四条（每种 member 类型各一条），层级表现与 TS class 一致。
3. **Given** 一个 Python 项目，其中某文件定义了顶层函数（不属于任何 class），**When** 建图完成，**Then** 图中存在 `module -[contains]-> function` 边，且该 function 节点没有额外的虚假 member 层级。
4. **Given** 一个混合 TS + Python 的项目，**When** 用 `graph_query` 检索该项目某模块的所有直接下游节点，**Then** 返回结果中 TS symbol 与 Python symbol 的 contains 边覆盖率一致（不因语言不同而遗漏）。

---

### User Story 2 - 查询同一符号时不再遇到重复/冲突节点（Priority: P1）

作为查询 Python 项目图谱的 Agent，我希望对同一个函数/类只得到一个节点，而不是因为 Python 用 `#` 分隔符、TS/JS 用 `::` 分隔符而看到两个 ID 不同但语义重复的节点，导致 `impact`/`context` 返回的影响面或上下文被人为拆分成两份不完整的结果。

**Why this priority**: 与 User Story 1 同级 P1——重复节点直接污染 MCP 四大导航工具（`impact`/`context`/`graph_node`/`graph_path`）的结果准确性，是本 feature 要解决的核心症状（调研 §2 锚点 9†：full batch 与 graph-only 两条路径都受影响，非 graph-only 特有）。

**Independent Test**: 对含 `.py` 文件的项目分别跑 `spectra batch`（full）与 `spectra batch --mode graph-only`，检查产出的 graph.json，断言不存在"同一符号名 + 同一文件路径，但 ID 分隔符不同"的成对重复节点。

**Acceptance Scenarios**:

1. **Given** 一个 Python 文件中定义了函数 `foo`，**When** 建图完成（full 或 graph-only 任一模式），**Then** graph.json 中只存在一个代表 `foo` 的节点，其 ID 采用与 TS/JS symbol 一致的 canonical 分隔符格式。
2. **Given** 该 canonical ID 格式的节点，**When** 通过 `impact`/`context` 工具用新 canonical 格式查询，**Then** 精确命中并返回完整的影响面/上下文；**When** 用旧的 `#` 格式字符串查询同一符号，**Then** 经既有 fuzzy resolve 机制 best-effort 兜底命中同一节点（非阻断性验证项，允许极端情况下不保证 100% 命中）。
3. **Given** 该 canonical ID 格式的节点，**When** 通过 `graph_node`/`graph_path` 用新 canonical symbol ID 或相对路径 module ID 查询，**Then** 精确匹配命中；**When** 用旧的 `#` 格式字符串查询，**Then** 不保证命中（`graph_node`/`graph_path` 按设计为精确 ID 匹配，不接入 fuzzy 层，见 FR-009）。

---

### User Story 3 - graph-only 与 full batch 产出口径可信一致（Priority: P2）

作为需要快速建图（graph-only，零 LLM，<2min）但偶尔也跑完整 full batch 的用户，我希望两条路径对"共同拥有的数据源"（AST 结构、calls/depends-on 边、Python 符号）产出等价的节点/边，只有 full batch 独有的数据源（architecture-ir、doc-graph、cross-reference、docs/images extraction、anchor semantic edges、可选 hyperedges）造成的差异才是预期的，其余差异都应被视为需要修复的缺陷。

**Why this priority**: P2——建立在 US1/US2 修复完成之后的验证性需求，确保修复是彻底的、可被自动化测试长期看护，而不是一次性人工核对。

**Independent Test**: 构造一个纯 TS 项目 fixture 与一个混合 TS+Python 项目 fixture，分别跑两种 batch 模式，按 provenance 过滤出双方共同拥有的数据源子图（module/symbol/member 节点 + calls/depends-on/contains 边）后，断言两路该子图的节点计数、边计数、ID 集合完全相等。

**Acceptance Scenarios**:

1. **Given** 一个纯 TS 项目，**When** 分别跑 full batch 与 graph-only，**Then** 按 provenance 过滤出共同数据源子图后，两路的 module/symbol/member 节点集合与 contains/calls/depends-on 边集合完全相等。
2. **Given** 一个含 Python 的项目，**When** 分别跑两种模式，**Then** 两路均不出现 `#`/`::` 成对重复节点，且 Python 符号的 contains 边覆盖率与 TS 符号一致。

---

### Edge Cases

- **旧版 `#` 格式图加载（仅限 symbol 节点）**：项目此前已用旧版本 Spectra 建过图（graph.json 中 Python symbol 节点仍是 `#` 格式），升级后不跑重建直接加载——加载期必须按 node kind/provenance 过滤，识别出这是 legacy symbol ID 格式并明确判定为 stale（而非静默当作"新鲜"图加载后返回错误/查不到的结果），触发全量重建；重建完成后该图不再有查询入口指向旧格式节点。关联调研风险 R-3：现有 `nodeIdFilePart`/`filePartOf` 的绝对路径判定逻辑不足以兜底识别 `#` 格式，需要独立的 legacy-id-format 检测，且检测规则必须限定在 symbol 节点范围，不得对 api-surface 节点误报（见下一条）。
- **API-surface `#` ID 不得触发 legacy-stale 误报**：`src/panoramic/api-surface` 的 FastAPI/Express 等 router 提取器同样用 `filePath#localName` 格式生成 API 节点 ID，但其节点语义是 `api`，与本 feature 收敛的 `symbol` 节点无关。legacy-id-format-stale 检测 MUST 按 node kind/provenance 过滤，仅识别 symbol 语义的 `#` 节点；若检测逻辑退化为对图中任意节点做全局 `#` 字符串匹配，含 API 节点的图将永久被误判为 stale，是必须避免的实现陷阱。
- **Python 无 class 的顶层函数**：Python 文件中未被任何 class 包裹的模块级函数，只应产生 module→function 一级 contains 边，不得产生虚假的 member 层级或空占位边。
- **Python class member（method/property/classmethod/staticmethod）**：Python class 内的各类 member 均须产生 class→member 一级 contains 边（不产生 module→member 的扁平直连边），与 TS class member 的两级层级表达一致，不因语言不同而遗漏或降级。
- **member 同名折叠（getter/setter、重载）**：同一 class 内同名的多个 member（如 TS 的 getter/setter 对、重载函数）沿用现有 `${Class}.${m.name}` 命名规则，**有意折叠**为单一 member 节点，不产生多个同名节点；按 kind/signature/overload-key 精细区分为独立节点属于 M10 范畴，不在本 feature 内实现（见 Out of Scope）。
- **TS/JS class member 嵌套**：TS/JS 文件中的 class 方法/属性，必须产生 module→class 与 class→member 两级 contains 边（而非扁平化为 module→member 单级），以保持"class member 层级保持可追溯"这一需求原文的字面要求。
- **graph-only 与 full 的数据源差异**：等价矩阵测试中，任何节点/边计数差异必须能明确归因到某个显式列举的 full-only 专属数据源（architecture-ir / doc-graph / cross-reference / docs-images extraction / anchor semantic edges / 可选 hyperedges）；无法归因的差异一律视为缺陷，不得记录为"预期差异"。
- **增量更新路径（F182）对新边/新 ID 的处理**：项目已有增量快照，本次改动上线后首次增量更新触发时，新增的 contains 边类型与统一后的 canonical ID 必须被增量 diff 逻辑正确识别为"新增/变更"，不能被现有增量护栏忽略或误判为噪声（调研待核实项 R-4，需在验收测试中显式覆盖，而非假定天然兼容）。
- **legacy 格式查询输入打到已重建新图**：项目图已按本 feature 重建为 canonical 格式（不存在存量旧格式节点），用户或 Agent 仍以历史习惯用 `#` 格式字符串作为 `impact`/`context` 的查询输入——系统经既有 fuzzy resolve 机制尝试 best-effort 解析到 canonical 节点；`graph_node`/`graph_path` 因是精确 ID 匹配设计，不保证对此类输入命中，此为已知且可接受的行为边界（非缺陷）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**：`buildUnifiedGraph` MUST 为每个受支持语言（TS/JS/Python）的每个 symbol 生成一条 module→symbol 的 `contains` 边。`[必须]`
  锚点：`src/knowledge-graph/index.ts:52-74`（当前只装配 calls + depends-on 边，contains 边缺失）；`src/knowledge-graph/unified-graph.ts:107`（`UnifiedEdgeRelationSchema` 已含 `contains`，schema 层无需改动）。

- **FR-002**：对存在 class 的 symbol（不限语言：TS/JS 与 Python 均适用），系统 MUST 生成 module→class 与 class→member 两级 `contains` 边；对无 class 包裹的顶层 symbol（含 Python 顶层函数），系统 MUST 只生成 module→symbol 一级边，不得产生虚假中间层级。**每个 member 节点只允许有一条来自其所属 class 的 `contains` 入边，不得同时存在 module→member 的扁平直连边**。`[必须]`
  依据：M9 原文"class member 层级保持可追溯"不限语言；`src/knowledge-graph/index.ts:201-219`（`deriveNodesFromSkeletons` 对所有语言 skeleton 均生成 member 节点）；`src/core/query-mappers/python-mapper.ts:377`（Python class member 实际被提取，含 method/property/classmethod/staticmethod）。取代原 TS/JS 限定版本（2026-07-20 Codex review C1 修订）。

- **FR-003**：系统 MUST 将 Python **symbol 节点**（`src/adapters/python-adapter.ts` 的 `extractSymbolNodes` 产出）ID 与 TypeScript/JavaScript symbol 节点 ID 收敛为单一 canonical 分隔符格式；ID 格式转换 MUST 只发生在一个明确定义的兼容边界（转换点的具体代码位置留待 plan 阶段决策，但架构上不允许存在两个及以上互相独立的转换/归一化点）。**本条 MUST NOT 影响 `src/panoramic/api-surface` 产出的 API 节点 ID 格式**（见"范围澄清"）。`[必须]`
  锚点：`src/adapters/python-adapter.ts:203`（`${relPath}#${symbol.name}`）vs `src/knowledge-graph/index.ts:202`（`${filePath}::${exp.name}`）；调研推荐方案 A（转换发生在 Python 产出端），因其是唯一能让 F193 既有 `::`-only 硬护栏无需追加逻辑即自然生效的方案（调研 §3、§9-1）。

- **FR-004**：ID 收敛后，系统 MUST 保证同一逻辑符号（同文件同符号名）在 full batch 与 graph-only 两种建图模式下都只产生一个节点，不再出现 `#`/`::` 分隔符不同但语义重复的成对节点。`[必须]`
  锚点：调研 §2 锚点 9†（`src/batch/batch-orchestrator.ts:1338-1435`，双 ID 重复在两条路径都存在，非 graph-only 特有）。

- **FR-005**：三层转换合同 MUST 覆盖两类测试：(a) **同层序列化 round-trip**——`UnifiedGraph` snapshot save→load→save 与 `GraphJSON` write→read→write 在字节/结构上保持稳定；(b) **跨层有损投影 invariant 测试**——针对 B→A（`UnifiedGraph`→`ModuleGraph`）与 B→C（`UnifiedGraph`→`GraphJSON`）等已知有损转换点，各给出字段级"保留 / 映射 / 丢弃"三列合同并断言转换结果符合该合同（而非要求逆向还原原始数据）。`[必须]`
  锚点：调研 §5.2 三个转换点清单；`src/graph/module-derivation.ts:101`（`deriveModuleGraph` 只保留 module 节点 + depends-on 边，是有损投影）；`src/panoramic/graph/graph-builder.ts:363`（B→C 把 `symbol` kind 映射为 `component` kind，同样有损）。原"round-trip 覆盖三个转换点"表述已按 2026-07-20 Codex review W3 修订为区分同层/跨层。

- **FR-006**：系统 MUST 提供一个统一的"从 canonical symbol ID 中解析出 file part 与 symbol part"的工具，替代当前分散在 `relativizeSymbolId`、`scanGraphPortabilityViolations.filePartOf`、`assertGraphFormatNotStale` 之 `nodeIdFilePart` 三处几乎相同但各自独立实现的字符串切分逻辑，作为"转换只允许发生在一个兼容边界"这一约束在代码层面的具体落地对象。`[必须]`
  锚点：`src/knowledge-graph/relativize.ts:100-110`、`src/panoramic/graph/graph-builder.ts:572-576`、`src/panoramic/graph/graph-query.ts:159-162`（三处均只识别 `::` 分隔符，调研 §5.1）。

- **FR-007**：系统 MUST 建立 graph-only 与 full batch 对"共同数据源"产出口径的等价性验证，等价性定义为：按 provenance 过滤出双方共同拥有的子图（module/symbol/member 节点 + calls/depends-on/contains 边）后完全相等。Full-only 专属数据源须显式列举（不得笼统概括）：architecture-ir、doc-graph、cross-reference、docs/images extraction、anchor semantic edges、可选 hyperedges；任何两路计数或 ID 集合的差异 MUST 能明确归因到上述列举项之一，不允许存在无法归因的隐式差异。`[必须]`
  锚点：调研 §6.1（已知合法差异源清单）、§6.2（已知非预期重复，须由 FR-004 消除）；`src/batch/batch-orchestrator.ts:1375`（docs/images extraction）、`:1437`（anchor semantic edges）、`:1513`（可选 hyperedges）均为 full-only 专属，原 spec 遗漏此三项（2026-07-20 Codex review W1 修订）。

- **FR-008**：系统 MUST 在图加载期对旧版 `#` 格式的 Python **symbol 节点** ID 进行显式识别，并将其归类为 legacy-id-format-stale，触发与 F193 既定 format-stale 相同的重建行为；检测规则 MUST 按 node kind/provenance 过滤（仅识别 `symbol` 语义节点），MUST NOT 对 `src/panoramic/api-surface` 产出的 `api` 语义节点（同样使用 `#` 分隔符）触发误报。检测顺序为：先做 wrapper 版本嗅探（persistence 层，`SNAPSHOT_WRAPPER_VERSION`），再做内容级 legacy 扫描（query 层，按 node kind 过滤的 `#` 匹配）。`[必须]`
  锚点：调研风险 R-3（`src/panoramic/graph/graph-query.ts:159-162` 的 `nodeIdFilePart` 对 `#` 格式返回整个 ID 字符串，多数情况下不满足既有绝对路径判定，导致漏检）；`src/panoramic/api-surface/fastapi-extractor.ts:124`、`express-extractor.ts:261`（API 节点同样用 `#` 但语义不同，2026-07-20 Codex review W6/C3 修订新增此约束）。

- **FR-009**：MCP 四大导航工具按工具分层遵循以下查询输入合同：`impact`/`context`（`agent-context-tools.ts:205,336`，经既有 fuzzy resolve 层）MUST 接受 canonical symbol ID 精确匹配，并 best-effort 兼容 fuzzy 变体输入（含历史遗留 `#` 格式字符串，非阻断性）；`graph_node`/`graph_path`（`graph-tools.ts:251,295`，`GraphQueryEngine` nodeMap 精确匹配，不接入 fuzzy 层）MUST 接受 canonical symbol ID 与相对路径 module ID 的精确匹配，MUST NOT 承诺对历史遗留 `#` 格式输入的命中。`[必须]`（原标注 `[可选]` 已按 2026-07-20 Codex review C2 修订为 `[必须]`，因原表述"MCP 四工具统一 fuzzy 兜底"与 `graph_node`/`graph_path` 实际的精确匹配设计相矛盾，修订为按工具分层的准确合同）
  锚点：`src/knowledge-graph/query-helpers.ts:268-281, 708-715`（`symbolSeg`/`moduleFileFromId` 已双格式兼容，仅服务于 fuzzy 层）；`src/panoramic/graph/graph-tools.ts:251,295`（精确 nodeMap 匹配）。**明确不新建 legacy→canonical 确定性翻译器**，超出本底座件范围（Out of Scope）。

- **FR-010**：ID 格式与图语义变更 MUST 伴随版本号更新：`SNAPSHOT_WRAPPER_VERSION` MUST bump（`2.0` → `3.0`）以触发旧快照的 format-stale 全量重建路径；`UNIFIED_GRAPH_SCHEMA_VERSION` SHOULD bump 以标识语义版本变化（即使 zod schema 字面结构未变）；`GraphJSON.schemaVersion` MUST 保持 `'2.0'` 不 bump——本 feature 采用 FR-008 定义的、按 node kind 限定的内容级 legacy 检测替代版本 bump 作为 GraphJSON 层的迁移识别手段，因为 ID 分隔符变更不改变 GraphJSON 的结构性 schema。`[必须]`（`SNAPSHOT_WRAPPER_VERSION` bump 与 `GraphJSON.schemaVersion` 维持不变）/ `[可选]`（`UNIFIED_GRAPH_SCHEMA_VERSION` bump，SHOULD 级）
  锚点：`src/knowledge-graph/persistence.ts:38`（`SNAPSHOT_WRAPPER_VERSION`）、`src/knowledge-graph/unified-graph.ts:210`（`UNIFIED_GRAPH_SCHEMA_VERSION`）、`src/panoramic/graph/graph-types.ts:178`（`GraphJSON.schemaVersion`）；调研 §7（2026-07-20 Codex review W7 补充版本决策进合同）。

- **FR-011**：class 内同名 member（如 TS getter/setter 对、重载函数）系统 MUST 沿用现有 `${Class}.${m.name}` 命名规则折叠为单一 member 节点，不产生重复节点；按 kind/signature/overload-key 精细区分同名 member 为独立节点不在本 feature 范围内。`[可选]`（现状行为的显式合同化，不新增能力，故标注可选校验项）
  依据：2026-07-20 Codex review W5 新增；对应 Edge Case "member 同名折叠"。

## Non-Functional Requirements / 回归护栏 *(mandatory)*

以下护栏逐条可验证，验收时须显式核对，不得以"未观察到明显异常"代替实测：

- **NFR-001（F193 相对化 + portable 守卫 + stale 检测）**：修复后，`relativizeSymbolId`/`scanGraphPortabilityViolations`/`assertGraphFormatNotStale` 三处逻辑对新 canonical 格式节点的行为保持既有正确性（绝对路径节点数=0、跨 worktree byte 一致）；对旧 `#` 格式 symbol 节点按 FR-008 触发 legacy-id-format-stale，对 API 节点不误报（见 FR-008）。
- **NFR-002（F183 三写盘出口内聚）**：`normalizeGraphForWrite` 的排序、去重、写盘出口逻辑不因新增 contains 边或 ID 格式变更而被绕过或产生第二条写盘路径。
- **NFR-003（F182 增量三护栏）**：增量构建路径下，新增边类型（contains）与统一后的 canonical ID 被增量 diff 逻辑正确识别为新增/变更节点与边，不产生漏检或误判为噪声（对应 Edge Case 增量更新路径）。
- **NFR-004（F195 graph-only 零 LLM 性能）**：`spectra batch --mode graph-only` 全部既有测试保持绿；新增 contains 边计算引入的墙钟耗时增量不得使 2.8s 量级基准发生显著劣化（以 baseline 重跑结果为准，非主观估计）。
- **NFR-005（F196 MCP 一致性防漂移）**：MCP tool description 与 fuzzy resolve 一致性测试（含 `feature-174-symbol-fuzzy-match` 相关用例）保持绿；四工具按 FR-009 定义的分层合同（`impact`/`context` fuzzy 兜底、`graph_node`/`graph_path` 精确匹配）行为保持一致，新旧图格式下 fuzzy 兜底不被误删。
- **NFR-006（全量验证零失败）**：全量 `npx vitest run`、`npm run build`、`npm run repo:check` 必须零失败；`graph.html` 前端渲染与 `panoramic-query` 消费面不得因 ID 格式变更而出现解析崩溃或视觉回归（前端是否硬编码 `#` 分隔符解析为调研待核实项，plan 阶段须先确认再决定是否需要联动改动）。
- **NFR-007（与 F212 隔离）**：本 feature 的实现与验证 MUST NOT 触碰 F212（收官评测）使用的 worktree 或评测链脚本，两者按 M9 doc §Gate 0 约定并行独立推进。
- **NFR-008（contains 边不得隐式改变耦合度统计口径）**：新增 module→symbol/class→member 的 `contains` 边 MUST NOT 隐式改变 `graph_community`/`graph_god_nodes` 的耦合度/聚类统计口径；默认预期是 contains（纯结构边）不计入耦合度/聚类度数统计，与 `src/panoramic/community/god-node-analyzer.ts:45`"过滤纯 contains 节点"的既有约定保持一致。若 plan 阶段决定将 contains 边纳入耦合统计，必须显式更新相关 baseline 并给出理由，不得静默改变统计口径。须有 relation-filter 行为测试覆盖。
  依据：2026-07-20 Codex review W2 新增。

## Key Entities *(include if feature involves data)*

- **UnifiedGraph（canonical model）**：物理位于 `src/knowledge-graph`，承载 module/symbol/member 节点与 calls/depends-on/contains 等语义关系边，是本 feature 新增 contains 边与统一 ID 格式的主要落点。
- **ModuleGraph（derived view）**：物理位于 `src/graph`，从 UnifiedGraph 派生出的模块级视图（如 `directory-graph`/`module-derivation.ts`），只保留 module 节点与 depends-on 边（有损投影，见 FR-005）；本 feature 需确认新增的 module→symbol contains 边不被误纳入模块间依赖判断。
- **GraphJSON（persisted + query representation）**：物理位于 `src/panoramic/graph`，是写盘持久化与 MCP 查询消费的最终格式，承载 schemaVersion（本 feature 维持 `'2.0'` 不变，见 FR-010）、node/edge 排序等既有护栏（F183/F193）。
- **Canonical Symbol ID**：本 feature 定义的统一符号标识格式，替代当前 `#`（Python symbol）与 `::`（TS/JS symbol）并存的双格式局面；具体分隔符字面值沿用 plan 阶段决策（调研推荐延续现有 `::`）；**不涵盖** `src/panoramic/api-surface` 的 API 节点 ID（见"范围澄清"）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：对含 `.py` 文件的项目跑 `spectra batch --mode graph-only`（dogfood 场景），产出的 graph.json 中不存在任何 `#`/`::` 分隔符不同但语义重复的成对 symbol 节点（断言值：重复对数 = 0）。
- **SC-002**：对任意受支持语言的项目建图后，每个受支持 symbol 都存在至少一条 contains 入边（顶层 symbol 为 module→symbol，class member 为 class→member）。**分母口径在 spec 内固定**：受支持集合 = TS/JS/Python `CodeSkeleton` 的 exports + class members；排除集合 = 空。coverage 断言进入自动化测试用例，覆盖率 = 100%。若实现阶段发现必须排除的符号种类，须回改本 spec 明确列出排除项，不得由测试自行定义排除口径。
- **SC-003**：三层转换合同测试全部通过，具体包括：(a) 同层序列化 round-trip（`UnifiedGraph` snapshot 与 `GraphJSON` 的 save/write→load/read→save/write 稳定性）；(b) 跨层有损投影 invariant 测试（B→A、B→C 转换点按字段级"保留/映射/丢弃"合同断言）。graph-only vs full batch 等价矩阵测试全部通过，矩阵中出现的任何计数差异都能在测试断言中明确标注其归因于 FR-007 列举的某个 full-only 数据源（不存在"未知差异"）。
- **SC-004**：MCP 四工具对同一符号的查询行为符合 FR-009 分层合同：比较字段为四工具返回的节点 id 集合 / 路径节点序列 / 影响面列表；`impact`/`context` 对 canonical ID 与相对路径两类输入返回语义一致的结果，`graph_node`/`graph_path` 对 canonical ID 与相对路径两类输入返回语义一致的结果；不承诺 legacy `#` 格式输入对 `graph_node`/`graph_path` 的命中率，该项在 `impact`/`context` 上作为非阻断性验证项记录。四工具行为均有对应 E2E 测试覆盖。
- **SC-005**：全量 `npx vitest run` + `npm run build` + `npm run repo:check` 零失败；3 个固定 baseline 项目（micrograd / nanoGPT / self-dogfood）重新采集后经 `baseline:diff` 比对，**预期变化 allowlist**（仅这些视为预期，其余任何差异 = 回归）：新增 contains 边计数、由 contains 边新增派生的节点度数字段变化（若 NFR-008 决定不计入耦合统计，则该派生变化范围为 0）；其余任何节点/边/ID 集合的变化均判定为回归。

## Out of Scope

- **B2 质量门**（duplicate/orphan/dangling/ignored/freshness 质量检测）：属于后续独立 feature，本 feature 只负责让底层图结构（contains 边 + canonical ID）具备被质量门检测的前提条件，不实现质量门本身。
- **B3 worktree 支持**（`.worktreeinclude`、`AGENTS.override.md` 与显式 setup）：与本 feature 无关联，不纳入。
- **B4 条件保活**：同上，不纳入。
- **rename-follow**（symbol 重命名后的图追踪）：属于 M10 范畴（F189 spec drift 后续），本 feature 不处理。
- **GraphRAG / symbol semantic retrieval**：M10 范畴，不纳入。
- **`query-helpers.ts` 的物理代码搬迁**（调整其模块归属以更严格对齐三层边界）：调研已评估搬迁成本高、当前 MCP 消费两端都在用，本 feature 只在合同文档层面显式承认该耦合点，不做物理搬迁（调研 §5.1）。
- **graph-builder.ts 5 路合并职责的整体重构**：本 feature 只新增/调整与 contains 边、ID 统一直接相关的最小改动面，不对该文件做超出本需求范围的结构性重构。
- **前端 `graph.html` 渲染逻辑的主动改造**：仅要求不崩溃/不回归（NFR-006），若调研发现其硬编码解析 `#` 分隔符，是否联动修改留待 plan 阶段基于实际影响面决策，不在本 spec 预先承诺具体改法。
- **legacy `#` → canonical 确定性翻译器**：`impact`/`context` 对历史遗留格式输入的兼容仅依赖既有 fuzzy resolve 机制 best-effort 兜底，不新建专用翻译层（见 FR-009）。
- **`src/panoramic/api-surface` API 节点 ID 格式统一**：FastAPI/Express 等 router 提取器产出的 `#` 格式 API 节点 ID 语义与本 feature 收敛的 symbol 节点无关，本 feature 不改动其 ID 格式（见"范围澄清"、FR-003、FR-008）。
- **同名 member 按 kind/signature/overload-key 精细区分**：getter/setter、重载函数等的同名折叠行为维持现状，精细区分属于 M10 范畴（见 FR-011、Edge Cases）。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：3-5（新增 `deriveContainsEdges` 函数、语言无关的 ID 转换逻辑改动点、共享 `parseCanonicalSymbolId` 工具函数、按 node kind 过滤的 legacy-id-format-stale 检测逻辑、relation-filter 耦合统计口径守护、若干 round-trip/invariant 测试模块）——判定区间：MEDIUM。
- **接口数量**：4-6（新增 contains 边的 schema 已存在无需新接口；新增 1 个共享 ID 解析工具函数签名；三处转换点的 round-trip/invariant 测试契约；version bump 相关的 stale 检测接口调整；FR-009 分层查询合同不新增接口，只是既有工具行为的显式约束）——判定区间：MEDIUM。
- **依赖新引入数**：0（调研已确认延续现有三模块划分，不新增外部依赖或平行 registry/graph/retrieval kernel）。
- **跨模块耦合**：是——需要同时改动 `src/knowledge-graph`（buildUnifiedGraph）、`src/adapters`（python-adapter）、`src/panoramic/graph`（graph-builder/graph-query 的 stale 检测与 filePart 解析）、`src/panoramic/community`（god-node-analyzer 的 relation 过滤确认，NFR-008）四个模块的接口/内部逻辑，满足"跨模块耦合"判定条件。
- **复杂度信号**：存在 1 个——**数据迁移**（旧 `#` 格式 graph.json 需通过 `SNAPSHOT_WRAPPER_VERSION` bump（2.0→3.0）触发的 format-stale 全量重建路径完成迁移，虽复用 F193 既有机制、不需要新写迁移代码，但仍构成数据格式迁移场景）；不存在递归结构、状态机、并发控制信号。
- **总体复杂度**：**MEDIUM**（跨模块耦合 = 是 + 存在 1 个复杂度信号，触发 MEDIUM 判定规则；组件数与接口数均落在 3-5 / 4-8 区间，未达 HIGH 阈值）。GATE_DESIGN 建议：常规评审即可，无需额外升级人工深度审查，但 plan 阶段须落实调研 §8 R-1（ID 统一与 contains 边生成列为同一原子交付单元，不允许中间态半成品）、R-4（F182 增量护栏待核实项）、以及本轮 review 新增的 W2/NFR-008（耦合统计口径守护）三项风险的具体缓解任务。

## 需求模糊点说明

- **[AUTO-RESOLVED: 转换边界的具体代码位置]** 需求原文只要求"转换只允许发生在一个兼容边界"，未指定具体位置。调研已给出方案 A/B/C 对比并明确推荐方案 A（Python 产出端），理由是唯一能让 F193 既有 `::`-only 护栏自然生效、改动面最小、消除根因而非打补丁（调研 §3、§9-1）。本 spec 采纳该推荐作为需求约束的解释依据，具体实现位置的最终确认留给 plan 阶段。
- **[已由 2026-07-20 Codex review 修订，不再是模糊点：C1 — FR-002 语言限定]** 原 FR-002 错误地把 class→member 层级限定为 TS/JS，与 M9 原文"class member 层级保持可追溯"不限语言的字面要求不符，且与 `python-mapper.ts:377` 实际提取 Python class member 的事实矛盾。修订为语言无关规则，并新增"member 只允许一条来自 class 的 contains 入边"约束，避免扁平边与层级边并存的歧义。
- **[已由 2026-07-20 Codex review 修订，不再是模糊点：C2 — FR-009 工具分层合同]** 原 FR-009 笼统声称"MCP 四工具统一 fuzzy 兜底"，与 `graph_node`/`graph_path` 实为 `GraphQueryEngine` nodeMap 精确匹配（不接入 fuzzy 层）的源码事实矛盾。修订为按工具分层的准确合同：`impact`/`context` fuzzy best-effort，`graph_node`/`graph_path` 精确匹配（canonical ID + 相对路径），且明确不新建 legacy→canonical 确定性翻译器，避免范围蔓延。
- **[已由 2026-07-20 Codex review 修订，不再是模糊点：C3 — FR-008 与"查询存量旧图"的互斥]** 原 Edge Case 中"存量旧图仍可被 fuzzy 查询"与 FR-008"legacy 图加载即 stale→重建"逻辑互斥（加载期检查先于任何查询）。修订为两个独立合同：legacy **持久化图**一律 stale→重建、无查询路径；legacy **格式的查询字符串**打到已重建的新 canonical 图上，经 fuzzy 兜底命中，二者不再冲突。
