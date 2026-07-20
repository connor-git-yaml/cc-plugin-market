# Tasks: Graph Topology / Canonical Symbol ID（M9 轨道 B1）

**Input**: `specs/214-graph-topology-canonical-id/plan.md`（修订版）、`specs/214-graph-topology-canonical-id/spec.md`（v2）
**Feature 目录**: `specs/214-graph-topology-canonical-id/`
**任务总数**: 45（T001-T040 + 修订新增 T001a/T004a/T034a/T036a/T039a）
**测试策略**: TDD——真 TDD 任务（T002/T003/T004/T004a/T015/T017）前置 RED 检查点先跑红再实现再跑绿；依赖实现完成后新建的测试标注 characterization/看护（预期绿，红即暴露缺陷）。plan.md 定义的 13 项新测试（T1-T13）逐条映射到本清单，映射关系见各任务标注 `(=plan Tn)`
**修订记录**: 2026-07-20 Codex tasks 审查 8C+5W 修订（原子组边界统一至 T022 / TDD 倒置矫正 / SC-005 三类归因载体 / 终门禁 / graph-only 性能测量），3 次委派均遇 API 中断后按委派合同降级为编排器 inline 修订

## Format: `[ID] [P?] [Story?] 描述`

- **[P]**：可与同组内其他 [P] 任务并行（不同文件、无直接依赖）
- **[US1/US2/US3]**：所属 User Story；Setup/Foundational/Polish 阶段不标
- 每个任务给出：涉及文件、depends_on、验收命令、对应 FR/SC/NFR 编号
- **不越界声明**：本清单不包含 B2/B3/B4、rename-follow、query-helpers.ts 物理搬迁、graph-builder.ts 5 路合并整体重构任何任务

---

## Phase 1: Setup

**目的**：确认执行前置条件就绪，不做任何源码改动

- [x] **T001** [P] 确认本地 baseline 项目已 clone（`bash scripts/baselines/clone-baseline-projects.sh`，若已存在跳过）；确认当前分支 `claude/graph-topology-canonical-id-1de3ab` 工作区干净；确认不会触碰 F212 worktree/评测脚本（NFR-007 硬约束贯穿全流程）
  - 涉及文件：无源码改动
  - depends_on：无
  - 验收命令：`git status --short`（应为空）+ `ls ~/.spectra-baselines/micrograd`（应存在）
  - 对应：NFR-007（前置声明，非验收项）

- [x] **T001a**【C6 前置】改动前旧图快照采集：在**任何源码改动前**，用当前 HEAD 代码对 3 项目各跑一次 graph-only 建图，保存产出 graph.json 到固定路径 `specs/214-graph-topology-canonical-id/verification/old-graphs/{micrograd,nanoGPT,self-dogfood}.graph.json`（零 LLM，单项目 ~3s；同时记录各自 3 次冷启动墙钟，取 p50 写入 `old-graphs/graph-only-perf-baseline.json`，供 T036a 对照）
  - 涉及文件：无源码改动（仅产出验证工件，不入库——verification/ 下产物按入库边界随收尾决定）
  - depends_on：T001
  - 验收命令：`ls specs/214-graph-topology-canonical-id/verification/old-graphs/`（3 个 graph.json + 1 个 perf-baseline.json 存在）
  - 对应：SC-005（三类归因的 old 侧数据源）, NFR-004（旧 p50 基线）

---

## Phase 2: Foundational — R-1 原子核心（阻塞所有 User Story）

**目的**：方案 A（ID 收敛）+ contains 边生成 + C1 生产端去重 + `parseCanonicalSymbolId` + 三处护栏收敛，**同一原子交付单元连续执行，组内不允许插入其他改动，组完成前不跑 baseline 重采集**（R-1 硬约束）

**⚠️ CRITICAL**：本组任务必须连续完成，不可与其他 Phase 任务交叉执行

### RED（先写测试，确认失败）

- [x] **T002** [P] RED：新建 `tests/unit/knowledge-graph/contains-edges.test.ts`（=plan T1）覆盖 **TS、JS、Python 三语言**各自的顶层/class/member fixture：TS 两级 module→class→member、JS 顶层+class member、Python class member 四类（method/property/classmethod/staticmethod）对称、Python 顶层函数一级边、无 module→member 扁平边、【C1】同名 getter/setter（+ 重载）fixture 断言 UnifiedGraph 节点/边 + 最终 GraphJSON 三层均唯一。**【C2】coverage oracle**：断言逻辑从输入 CodeSkeleton 自动构造固定分母（全部 exports + class members、排除集=空），逐一断言每个顶层 symbol/class/member 恰有正确层级的 contains 入边，coverage = 100%（分母非硬编码清单，杜绝"漏断言仍绿"）
  - depends_on：T001
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/contains-edges.test.ts`（RED 检查点：失败断言可收集、无编译/collection error）
  - 对应：FR-001, FR-002, FR-011, SC-002

- [x] **T003** [P] RED：新建 `tests/unit/knowledge-graph/parse-canonical-symbol-id.test.ts`（=plan T2）覆盖 `file::sym` / `file::Class.m` / `file`（无分隔符）/ `file#legacy` 四类输入的 filePart/symbolPart 断言。**【W1】compile-safe RED 写法**：`parseCanonicalSymbolId` 实现前尚不存在，测试用动态 import 探测（`const mod = await import('../../../src/knowledge-graph/relativize.js'); expect(typeof mod.parseCanonicalSymbolId).toBe('function')` 后再断言行为），保证实现前测试可收集且以断言失败呈现 RED，而非 TS 编译/collection error
  - depends_on：T001
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/parse-canonical-symbol-id.test.ts`（RED 检查点：失败断言可收集、无编译/collection error）
  - 对应：FR-006

- [x] **T004** [P] RED：扩展既有 `tests/unit/knowledge-graph/build-unified-graph.test.ts`（=plan T3）新增 contains 边并入 `buildUnifiedGraph` edges 的断言；**【C1】B→C 字段级合同**：调用真实 `buildKnowledgeGraph`（graph-builder 第五路，非 mock 结构），逐项断言 plan 字段级合同表 B→C 全部条目——kind 映射（symbol→component）、confidence、directional、filePath 保留、evidence 截断、language 丢弃
  - depends_on：T001
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/build-unified-graph.test.ts`（RED 检查点：新增断言失败可收集、无编译/collection error）
  - 对应：FR-005, FR-001, SC-003

- [x] **T004a**【C4】RED：适配 `tests/adapters/python-adapter.test.ts:307,314,386-388` 既有断言 `math.py#add`/`a.py#forward`/`b.py#forward` → `::` 并同步测试描述文案（原 T010 内容**前移为 T005 的前置 RED**）
  - depends_on：T001
  - 验收命令：`npx vitest run tests/adapters/python-adapter.test.ts`（RED 检查点：`::` 断言失败可收集、无编译错误）
  - 对应：FR-003

### 实现

- [x] **T005** 实现：`src/adapters/python-adapter.ts:203` `${relPath}#${symbol.name}` → `${relPath}::${symbol.name}`；确认 :217/:221 contains 边 target 随 `symbolId` 变量自动同步（唯一 ID 生成点，改动 1 行）
  - depends_on：T002, T003, T004, T004a
  - 验收命令：`npx vitest run tests/adapters/python-adapter.test.ts`（T004a 的 RED 断言**转绿**——验收以全绿收尾，不以预期失败收尾）
  - 对应：FR-003

- [x] **T006** 实现：`src/knowledge-graph/relativize.ts` 新增导出 `parseCanonicalSymbolId(id): { filePart, symbolPart | undefined }`（`indexOf('::')` 切分；无 `::` 则 filePart=整 id、symbolPart=undefined）；`relativizeSymbolId` 复用
  - depends_on：T003
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/parse-canonical-symbol-id.test.ts`（转绿）
  - 对应：FR-006

- [x] **T007** 实现：`src/knowledge-graph/index.ts` 新增 `deriveContainsEdges`（语言无关派生，W2，不设语言 gate）+ **C1 生产端双去重**：`deriveNodesFromSkeletons` 节点按 node id 去重、`deriveContainsEdges` 边按 `(source,target,relation)` 去重，二者共享同一 id 计算规则不各自拼串；`buildUnifiedGraph`（:65）拼入 `...deriveContainsEdges(...)`（先于 relativizeGraph）
  - depends_on：T005, T006
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/contains-edges.test.ts tests/unit/knowledge-graph/build-unified-graph.test.ts`（转绿）
  - 对应：FR-001, FR-002, FR-011, SC-002；性能侧注：contains 为 O(symbols)，远小于 O(callSites)（NFR-004 预期不劣化，最终由 T034 baseline 实测确认）

- [x] **T008** [P] 实现：`src/panoramic/graph/graph-builder.ts:572-576` `filePartOf` 改调 `parseCanonicalSymbolId(id).filePart`
  - depends_on：T006
  - 验收命令：`npx vitest run tests/unit/graph-builder.test.ts`
  - 对应：FR-006

- [x] **T009** [P] 实现：`src/panoramic/graph/graph-query.ts:159-162` `nodeIdFilePart` 改调 `parseCanonicalSymbolId(id).filePart`（本任务只做收敛，不含 isLegacySymbolNode——后者归入 Phase 4 版本 bump 原子组）
  - depends_on：T006
  - 验收命令：`npx vitest run tests/panoramic/graph-query-budget.test.ts tests/panoramic/graph-query-community-cohesion.test.ts tests/unit/graph-query-tokenize.test.ts`（W2：既有 graph-query 消费方测试三件套，唯一确定命令）
  - 对应：FR-006

### 既有测试适配

- [x] **T010** 验证（characterization，断言改写已前移至 T004a）：复核 `tests/adapters/python-adapter.test.ts` 全绿且无残留 `#` symbol 断言（`! rg -q "\.py#" tests/adapters/python-adapter.test.ts`）
  - depends_on：T005
  - 验收命令：`npx vitest run tests/adapters/python-adapter.test.ts && ! rg -q '\.py#' tests/adapters/python-adapter.test.ts`
  - 对应：FR-003

- [x] **T011** 适配：`tests/unit/graph-builder.test.ts` `#` python symbol 断言 → `::`；补充 contains 去重无重复对断言
  - depends_on：T007, T008
  - 验收命令：`npx vitest run tests/unit/graph-builder.test.ts`（全绿）
  - 对应：FR-011, C1

- [x] **T012** 适配：`tests/unit/knowledge-graph/query-helpers.test.ts` **保留** `symbolSeg`/`moduleFileFromId` 的 `#` 双格式兼容分支测试（R-6 旧图/api 容错降级不删）+ 补 `::` 主路径测试
  - depends_on：T006
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/query-helpers.test.ts`（全绿）
  - 对应：FR-009, R-6

### 验证点 P1

- [x] **T013** 验证：核心图语义检查点（**非 R-1 收口**——【C3】R-1 原子交付单元贯穿至 T022 版本组完成才收口）——`npm run build` 零错误 + T002/T003/T004/T004a/T010/T011/T012 全绿 + 同名 member fixture 三层（UnifiedGraph 节点/边、GraphJSON）唯一断言复核
  - depends_on：T002-T012 全部（含 T004a）
  - 验收命令：`npm run build && npx vitest run tests/unit/knowledge-graph tests/adapters/python-adapter.test.ts tests/unit/graph-builder.test.ts`
  - 对应：SC-001, SC-002, R-1（中间检查点）

**Checkpoint（硬门禁，C3 修订）**：R-1 原子交付单元 = Phase 2（T002-T013）+ Phase 4 版本组（T017-T022）连续执行；**T022 完成前不得开始 T014-T016、T023-T032 任何任务，不得跑 baseline 重采集**（T013 后仅允许立即接续 T017-T022）。

---

## Phase 3: User Story 1 延伸 — module-derivation 与耦合口径守护 (Priority: P1)

**目标**：确认 contains 边不污染 B→A 派生视图（module 依赖/SCC）与 community/god-node 耦合统计口径

**Independent Test**：`graph_node` 查询任意模块节点可遍历 module→class→member 层级；`graph_community`/`graph_god_nodes` 统计口径不因 contains 边新增而漂移

- [x] **T014** [P][US1] characterization（核实项④静态成立，预期直接绿；红即暴露实现缺陷）：扩展既有 `tests/unit/knowledge-graph/module-derivation.test.ts`（=plan T8）新增断言——输入含 contains 边时 `deriveModuleGraph` 不改变 module 依赖/SCC/拓扑；**【C1】B→A 字段级合同**：调用真实 `deriveModuleGraph`，逐项断言 plan 字段表 B→A 条目——importType 映射保留、symbol 节点丢弃、calls 边丢弃（非 mock）
  - depends_on：T022（C3：R-1 原子单元收口后方可开始）
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/module-derivation.test.ts`
  - 对应：核实项④、SC-003、B→A 转换合同

- [x] **T015** [P][US1] RED：新建 `tests/unit/panoramic/community/contains-relation-filter.test.ts`（=plan T7）双断言：(a) community `loadGraph` 图不含 contains 边，degree/community 口径不受影响；(b) `GraphQueryEngine`/`graph_node` 邻居仍含 contains（graph-query.ts:242，US1 依赖不可破坏）
  - depends_on：T022（C3：R-1 原子单元收口后方可开始）
  - 验收命令：`npx vitest run tests/unit/panoramic/community/contains-relation-filter.test.ts`（RED 检查点：(a) 失败可收集；(b) 应绿——现状本就含 contains）
  - 对应：NFR-008, GATE_DESIGN #4, US1

- [x] **T016** [US1] 实现：`src/panoramic/community/community-detector.ts:74-84` `loadGraph`（被 `community/index.ts:55 runCommunityAnalysis` 调用）在 `graph.addEdge` 前新增 `if (edge.relation === 'contains') continue;`；**不改** `GraphQueryEngine`（graph-query.ts:242 邻接表保留 contains）
  - depends_on：T015
  - 验收命令：`npx vitest run tests/unit/panoramic/community/contains-relation-filter.test.ts tests/unit/knowledge-graph/module-derivation.test.ts`（全绿）
  - 对应：NFR-008, R-7

**Checkpoint US1**：contains 边遍历能力 + 派生视图/耦合口径隔离均已落地并被自动化测试看护。

---

## Phase 4: User Story 2 延伸 — 版本 bump 原子组 + legacy stale + round-trip + cross-worktree byte (Priority: P1)

**目标**：ID 唯一性由 legacy 检测 + 版本迁移兜底；round-trip/跨 worktree byte 稳定性看护

**Independent Test**：旧 `#` 格式快照加载即触发 format-stale 全量重建；新格式 snapshot/GraphJSON 序列化字节稳定；Python class/member 跨 worktree byte 一致

**⚠️ 版本 bump 原子性约束（C3 统一定义）**：版本组 = **T017-T022**（T017 RED + T018/T019 版本常量 + T020 isLegacySymbolNode + T021 版本断言适配 + T022 收口），必须紧随 T013 连续执行，组内不允许插入任何其他任务；T022 是 R-1 原子交付单元的最终收口点，T014-T016 与 T023-T032 全部依赖 T022

- [x] **T017** [P] RED：新建 `tests/unit/panoramic/graph/legacy-id-stale.test.ts`（=plan T5）覆盖【C2】`#` symbol 节点（`unifiedKind='symbol'` / `sourceTag='extraction'`）→ 抛 `graph-format-stale`；**负例**：`kind='module'` 且 id 含 `#` 的 doc-anchor 节点不误报、api-surface `#` 节点不误报；wrapper 3.0 嗅探旧 2.0 快照 → format-stale
  - depends_on：T013
  - 验收命令：`npx vitest run tests/unit/panoramic/graph/legacy-id-stale.test.ts`（预期 RED）
  - 对应：FR-008, NFR-001, R-3

- [x] **T018** [US2] 实现：`src/knowledge-graph/unified-graph.ts:210` `UNIFIED_GRAPH_SCHEMA_VERSION` `'1.0'` → `'1.1'`
  - depends_on：T013
  - 验收命令：`npm run build`
  - 对应：FR-010

- [x] **T019** [US2] 实现：`src/knowledge-graph/persistence.ts:38` `SNAPSHOT_WRAPPER_VERSION` `'2.0'` → `'3.0'`（schema `z.literal` 与嗅探均引用该常量，单点 bump 全链路联动，I5 成立）
  - depends_on：T013
  - 验收命令：`npm run build`
  - 对应：FR-010

- [x] **T020** [US2] 实现：`src/panoramic/graph/graph-query.ts` 新增 `isLegacySymbolNode(node): boolean`——**正向**谓词，只认 symbol 语义节点：`node.id.includes('#')` 且（`node.metadata?.unifiedKind === 'symbol'` **或** `node.metadata?.sourceTag === 'extraction'` 结合 Python provenance）；`assertGraphFormatNotStale`（:179-196）据其识别 legacy 节点。**MUST NOT** 用负向过滤（"`includes('#') && kind !== api`"会误杀 `design-doc-anchoring.test.ts:44-48` 的合法 `kind='module'` 含 `#` 节点）
  - depends_on：T017, T018, T019
  - 验收命令：`npx vitest run tests/unit/panoramic/graph/legacy-id-stale.test.ts`（转绿）
  - 对应：FR-008, C2

- [x] **T021** [US2] 适配 W1：`tests/integration/156-w2-spectra-index.test.ts:105`、`tests/.../snapshot-portability.test.ts:141`、`tests/.../persistence.test.ts:100` 三处**加载结果类**断言改为引用 `SNAPSHOT_WRAPPER_VERSION`/`UNIFIED_GRAPH_SCHEMA_VERSION` 常量；**【W4 例外】**`tests/unit/knowledge-graph/unified-graph.test.ts:192` 直接验证版本常量本身的断言**保留字面合同值 `'1.1'`**（禁改成 CONST===CONST 恒真，否则 FR-010 的 bump 无独立看护）
  - depends_on：T018, T019
  - 验收命令：`npx vitest run tests/integration/156-w2-spectra-index.test.ts tests/unit/knowledge-graph/snapshot-portability.test.ts tests/unit/knowledge-graph/persistence.test.ts tests/unit/knowledge-graph/unified-graph.test.ts`（全绿；文件路径以仓内实际路径为准）
  - 对应：W1（版本断言防漂移）+ W4（字面合同保留）

- [x] **T022** 验证：版本 bump 原子组收口
  - depends_on：T020, T021
  - 验收命令：`npm run build && npx vitest run tests/unit/panoramic/graph/legacy-id-stale.test.ts tests/integration/156-w2-spectra-index.test.ts`
  - 对应：FR-008, FR-010

- [x] **T023** [P][US2] characterization/看护（依赖实现完成，预期绿；红即暴露缺陷）：新建 `tests/unit/knowledge-graph/snapshot-roundtrip.test.ts`（=plan T10，真实入口）——`UnifiedGraph` snapshot **save→load→save**（真实 `saveSnapshot`/`loadSnapshotDetailed`，非 mock），fixture 含 contains + 同名 member + Python canonical ID，断言两次归一化 bytes/结构相等
  - depends_on：T022（C3）
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/snapshot-roundtrip.test.ts`
  - 对应：SC-003a, FR-005a

- [x] **T024** [P][US2] characterization/看护：新建 `tests/unit/panoramic/graph/graphjson-roundtrip.test.ts`（=plan T11，真实入口）——`GraphJSON` **write→read→write**（真实 `writeKnowledgeGraph`/`normalizeGraphForWrite` 与读取入口，非 mock），同类 fixture，断言归一化 bytes 稳定
  - depends_on：T022（C3）
  - 验收命令：`npx vitest run tests/unit/panoramic/graph/graphjson-roundtrip.test.ts`
  - 对应：SC-003a, FR-005a, NFR-002

- [x] **T025** [P][US2] characterization/看护：新建 `tests/unit/knowledge-graph/python-crossworktree-byte.test.ts`（=plan T12）——含 Python class/member 的 fixture 在双 root（/a、/b）建图 → 相对化后 snapshot bytes 完全一致
  - depends_on：T022（C3）
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/python-crossworktree-byte.test.ts`
  - 对应：NFR-001, F193

**Checkpoint US2**：legacy 检测 + 版本迁移 + round-trip/跨 worktree byte 稳定性全部落地并被测试看护。

---

## Phase 5: User Story 3 — graph-only 与 full batch 等价矩阵 (Priority: P2)

**目标**：建立可长期看护的等价性验证，取代一次性人工核对

**Independent Test**：纯 TS fixture 与混合 TS+Python fixture 分别跑两种模式，按 provenance 过滤共同子图后节点/边/ID 集合完全相等

- [x] **T026** [P][US3] characterization/看护：新建 `tests/integration/graph-equivalence-matrix.test.ts`（=plan T4 + T13 合并同一文件）——纯 TS + 混合 TS+Python fixture，full vs graph-only 按 provenance 过滤共同子图（module/symbol/member 节点 + calls/depends-on/contains 边）断言节点/边/ID 集合相等；差异必须归因到 FR-007 列举的 full-only 专属数据源之一；【W7+W5】按归一化语义 key = **相对文件路径 + 完整 qualified symbol path（含 class 前缀，如 `Class.member`）+ symbol kind** 计算 duplicate-pair count，断言 = 0（SC-001 直接 oracle）；**负例**：同文件不同 class 的同名 member（如 A.render 与 B.render）不判为重复
  - depends_on：T016, T022（C3）
  - 验收命令：`npx vitest run tests/integration/graph-equivalence-matrix.test.ts`
  - 对应：SC-001, SC-003, FR-004, FR-007, FR-011, US3

**Checkpoint US3**：graph-only/full 口径等价性由自动化测试长期看护，非一次性人工核对。

---

## Phase 6: 跨 Story 收尾 — 增量护栏 + baseline fixture 防护 + MCP 分层合同 E2E

**目的**：闭合 R-4（增量护栏实测）、W3（存量 baseline fixture 防污染）、SC-004（MCP 四工具分层合同）

- [x] **T027** [P] characterization/看护（1b 静态成立待实测——本任务即实测载体）：新建 `tests/unit/knowledge-graph/incremental-contains.test.ts`（=plan T6）——文件**新增/删除/rename**、**member 删改**、**跨文件 calls caller 重建**后，断言增量 diff 正确替换旧 contains、加入新 contains，重建图无 stale/dangling endpoint，新 member 节点带 filePath 被 owning-node 识别
  - depends_on：T016, T022（C3）
  - 验收命令：`npx vitest run tests/unit/knowledge-graph/incremental-contains.test.ts`
  - 对应：NFR-003, R-4

- [x] **T028** [US2] 实现 W3 fail-fast：`tests/e2e/helpers/stdio-client.ts:40` `installRelativizedBaseline` 增加前置检查——若源 fixture 含 legacy `#` symbol 节点（复用 `isLegacySymbolNode` 判定）即抛错并给出 `baseline:collect` recollect 指引；**【C5】同任务新建隔离负向单测** `tests/unit/e2e-helpers/install-baseline-failfast.test.ts`：构造含 legacy `#` symbol 节点的最小 fixture，断言该 helper 抛错且错误信息含 recollect 指引（正常 canonical fixture 不抛）
  - depends_on：T022（C3）
  - 验收命令：`npx vitest run tests/unit/e2e-helpers/install-baseline-failfast.test.ts`（负向+正向均绿）
  - 对应：R-3, W3, C5

- [x] **T029** 本地重跑：`npm run baseline:collect -- --target karpathy/micrograd --mode full` 重生成含 `::` 符号的本地 fixture（产物在 `~/.spectra-baselines/micrograd-output/`，不入库）
  - depends_on：T022, T028（C5 顺序：负向单测先行，防本地旧 `#` baseline 让 E2E 假失败）
  - 验收命令：`! rg -q '\.py#' tests/baseline/micrograd/spectra/full.json && ! find ~/.spectra-baselines/micrograd-output -name 'graph.json' -exec rg -l '\.py#' {} + | grep -q .`（W2：机械判定，无遗留 `#` symbol id 即 exit 0）
  - 对应：W3

- [x] **T030** 适配 W3 五处调用方：`tests/e2e/feature-180-symbol-chain.e2e.test.ts`、`feature-180-graph-tools.e2e.test.ts`、`feature-180-file-nav-stdio.e2e.test.ts`、`feature-184-view-file-fuzzy.e2e.test.ts`、`feature-180-telemetry.e2e.test.ts` 硬编码 micrograd Python 符号断言 `#` → `::`
  - depends_on：T029
  - 验收命令：`npx vitest run tests/e2e/feature-180-symbol-chain.e2e.test.ts tests/e2e/feature-180-graph-tools.e2e.test.ts tests/e2e/feature-180-file-nav-stdio.e2e.test.ts tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts tests/e2e/feature-180-telemetry.e2e.test.ts`（全绿）
  - 对应：W3

- [x] **T031** [P] 适配：`tests/integration/agent-context-real-graph.test.ts` 若含 `#` python id 断言改为 `::`；核实 `tests/kb/search-core.test.ts` / `tests/debt-scanner/*` 的 `#` 命中是否为 symbol id（多为 markdown anchor `href.split('#')`，无关则不改，仅记录核实结论）
  - depends_on：T022（C3）
  - 验收命令：`npx vitest run tests/integration/agent-context-real-graph.test.ts tests/kb/search-core.test.ts`
  - 对应：FR-003（附带核实，非新增能力）

- [x] **T032** [US1][US2] characterization/看护：新建 `tests/e2e/feature-214-mcp-layered-query.e2e.test.ts`（=plan T9，SC-004 矩阵）——`impact`/`context`：同 symbol 绝对/相对 canonical ID 返回一致，legacy `#` 格式 best-effort 兜底命中（非阻断）；`graph_node`：symbol ID→symbol 节点、module ID→module 节点，邻居含 contains；`graph_path`：端点组合矩阵（symbol↔symbol/module↔module 精确）；legacy `#` 对 `graph_node`/`graph_path` 不承诺命中。**【W3】不许静默 skip**：测试开头断言 `dist/cli/index.js` 与 baseline fixture 存在，缺失=fail（不得沿用 helper 的 skip 分支）
  - depends_on：T022, T026, T030
  - 验收命令：`npx vitest run tests/e2e/feature-214-mcp-layered-query.e2e.test.ts`
  - 对应：SC-004, FR-009, NFR-005

**Checkpoint**：增量护栏、legacy fixture 防护、MCP 四工具分层合同全部落地并被测试看护。

---

## Phase 7: Polish & 收尾验证

**目的**：全量验证、baseline 升版流程、Codex 对抗审查、最终交付

- [x] **T033** 全量验证：**【W3】先 build 后测试**（保证 E2E 用当前源码构建物而非旧 dist，且 dist 就位后 E2E 不走 skip 分支）
  - depends_on：T001-T032 全部
  - 验收命令：`npm run build && npx vitest run && npm run repo:check`
  - 对应：SC-005, NFR-006

- [x] **T034** 3 baseline 重采集（R-1 原子组已完成，此时方可执行；R-2 缓解）
  - depends_on：T033
  - 验收命令：`npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full`
  - 对应：SC-005, R-2, R-5（同时核对墙钟耗时无显著劣化，NFR-004）

- [x] **T034a**【C6】实现 semantic graph diff 脚本：新建 `scripts/graph-semantic-diff.mjs`（落实 plan R-2/R-7 缓解）——输入 old/new 两个 graph.json：(1) 输出 contains 边增量（区分顶层 module→symbol 与 class→member）；(2) 输出 canonical ID 字面变化（`#`→`::` 节点/边计数）与按 W5 语义 key（相对路径+qualified symbol path+kind）判定的重复对消除量；(3) 输出按 relation 分桶的 community/god-node 度数统计变化（contains 剔除前后对照）；三类之外存在任何节点/边/ID 集合差异 → exit 非零并列出未归因差异。附 `--dup-check <graph.json>` 子命令：单图 duplicate-pair count 非零则 exit 非零（供 T036 复用）
  - depends_on：T033
  - 验收命令：`node scripts/graph-semantic-diff.mjs specs/214-graph-topology-canonical-id/verification/old-graphs/micrograd.graph.json <新 graph.json> ; echo exit=$?`（能产出三类统计报告）
  - 对应：SC-005（机械归因载体）

- [x] **T035**【C6 重写】三类 allowlist 归因核对（SC-005，全部命令确定无占位符）：
    (a) **perf anchor 对比**：对 3 项目各跑 `git show HEAD:tests/baseline/<project>/spectra/full.json > /tmp/old-<project>-full.json && npm run baseline:diff -- /tmp/old-<project>-full.json tests/baseline/<project>/spectra/full.json`（project ∈ micrograd/nanoGPT/self-dogfood 的实际 fixture 路径）；
    (b) **semantic 三类归因**：用新代码对 3 项目各重跑 graph-only 得新图，`node scripts/graph-semantic-diff.mjs specs/214-graph-topology-canonical-id/verification/old-graphs/<project>.graph.json <新图路径>` 逐项目 exit 0（三类归因齐全、无未归因差异）；
    验证摘要逐项目列全 SC-005 三类统计
  - depends_on：T034, T034a
  - 验收命令（W-1 修订）：(a) 3 项目 `baseline:diff` 报告逐项归因入 `verification/T035-attribution-report.md`（perf 启发式告警——graphNodeCount 下降=类(2)去重预期、token 变化=LLM 采样随机性——须**显式归因**，不以 exit 0 掩盖；micrograd/nanoGPT diff exit 1 为已归因预期）；(b) 3 项目 `graph-semantic-diff` 逐项归因：外部 2 项目（micrograd/nanoGPT）机械 exit 0，self-dogfood 差异=本 feature 自身新增源码（dogfood 噪声，非回归，报告已列明）。C-2 fail-closed 反例自测（删旧 contains / 注入 `#` 重复）均 exit 非零
  - 对应：SC-005

- [x] **T036**【W2 机械化】graph-only dogfood SC-001 oracle 实测：固定 target = micrograd（`~/.spectra-baselines/micrograd`），用新代码跑 graph-only 产出新图，调用 T034a 脚本的 `--dup-check` 子命令判定 duplicate-pair count = 0（版本化 oracle，非手工核对）
  - depends_on：T035
  - 验收命令：`node dist/cli/index.js batch --mode graph-only`（cwd=micrograd clone，产物路径记入验证摘要）`&& node scripts/graph-semantic-diff.mjs --dup-check <产出 graph.json 路径>`（exit 0）
  - 对应：SC-001

- [x] **T036a**【C8】graph-only 性能实测（R-5/NFR-004）：固定 target = micrograd，冷启动条件（每次运行前清空输出目录），重复 ≥3 次，记录 p50 墙钟；与 T001a 采集的旧 p50（`verification/old-graphs/graph-only-perf-baseline.json`）对照，**p50_new > p50_old × 1.5 即失败**；禁止用 full baseline 总墙钟替代
  - depends_on：T036
  - 验收命令：3 次计时运行 + 对照脚本比较（p50_new ≤ p50_old×1.5 则 exit 0），结果写入验证摘要
  - 对应：NFR-004, R-5

- [x] **T037** MCP 四工具 E2E 矩阵收尾复核：复跑 T032 确认绿，并在验证摘要中明确核对 SC-004 (a)(b)(c) 三类断言均已体现
  - depends_on：T032
  - 验收命令：`npx vitest run tests/e2e/feature-214-mcp-layered-query.e2e.test.ts`
  - 对应：SC-004

- [ ] **T038** Codex 对抗审查（implement phase，commit 前必做，按 CLAUDE.local.md 约定）：通过 `codex:codex-rescue` 子代理对本次全部改动（8 源文件 + 新测试 + 既有测试适配 + semantic diff 脚本）做对抗性审查，重点核对 R-1~R-7 缓解是否落实、C1/C2/C4/C5 是否真实生效
  - depends_on：T036, T036a, T037
  - 验收命令：Agent tool 调用 `codex:codex-rescue`，产出 critical/warning/info 分类结论
  - 对应：全量交付质量门（非 FR/SC 编号项）

- [ ] **T039** 处置 Codex 发现：真实 bug/设计缺陷/边界遗漏立即修复；风格偏好/过度抽象建议记录到 commit message 备注，不修改
  - depends_on：T038
  - 验收命令：视发现内容而定（修复后的权威重验由 T039a 终门禁承担）
  - 对应：全量交付质量门

- [ ] **T039a**【C7】终门禁（权威重验）：T039 若有**任何代码/测试改动** → 完整重跑 T033（`npm run build && npx vitest run && npm run repo:check`）；若改动影响图产出/性能/查询合同 → 追加重跑 T034-T037（baseline 重采 + 三类归因 + dogfood oracle + MCP 矩阵）；T039 零改动 → 记录"无改动，沿用 T033-T037 结果"即过
  - depends_on：T039
  - 验收命令：`npm run build && npx vitest run && npm run repo:check`（有改动时必跑；exit 0）
  - 对应：SC-005, NFR-006（最终状态权威验证）

- [ ] **T040** 提交交付：commit 全部改动 + 3 个入库 perf anchor fixture（`tests/baseline/{self-dogfood,micrograd,nanoGPT}/spectra/full.json`），commit message 含 SC-005 三类变化归因摘要 + Codex review 结论摘要（按 CLAUDE.local.md push 前 report 约定，push 到 origin master 前需用户明确确认）
  - depends_on：T039a
  - 验收命令：`git status --short`（确认改动范围符合预期）+ `git add <显式路径列表>`（不用 `git add -A`）+ `git commit`
  - 对应：SC-005（交付收口）

---

## Dependencies & Execution Order

### Phase 依赖关系（C3 修订后）

- **Phase 1（Setup）**：无依赖，立即开始（T001 → T001a 旧图快照必须先于任何源码改动）
- **Phase 2（Foundational）+ Phase 4 版本组（T017-T022）= R-1 原子交付单元**：依赖 Phase 1；T002-T013 → 立即接续 T017-T022 连续执行，全程不可穿插其他任务；**T022 收口前阻塞其余全部任务**
- **Phase 3（US1 延伸 T014-T016）**：依赖 T022
- **Phase 4 其余（round-trip/byte T023-T025）**：依赖 T022
- **Phase 5（US3 等价矩阵 T026）**：依赖 T016, T022
- **Phase 6（跨 Story 收尾 T027-T032）**：依赖 T022、T016、T026、T030（链内顺序 T028→T029→T030→T032）
- **Phase 7（Polish T033-T040）**：依赖 Phase 1-6 全部任务完成；T033→T034/T034a→T035→T036→T036a→T037→T038→T039→T039a→T040

### User Story 依赖关系

- **US1（P1，contains 边遍历）**：核心产出在 Phase 2（T007 deriveContainsEdges），延伸验证在 Phase 3（T014-T016）
- **US2（P1，ID 唯一性）**：核心产出在 Phase 2（T005/T006 ID 收敛 + T007 C1 去重），延伸验证在 Phase 4（T017-T025）
- **US1 与 US2 因 R-1 约束共享同一原子交付单元（Phase 2）**，不可独立分开 merge
- **US3（P2，等价矩阵）**：依赖 US1（contains 边存在）与 US2（ID 唯一）均已验证完成（T016, T020），本质是验证性需求

### 关键路径（Critical Path，C3 修订后）

```
T001 → T001a(旧图快照) → T002/T003/T004/T004a(并行RED) → T005 → T006 → T007 → T008/T009(并行)
  → T010/T011/T012(并行适配) → T013(核心检查点)
  → T017 → T018/T019(并行) → T020 → T021 → T022(R-1 原子单元收口)
  → T016(US1 实现，前置 T015 RED) → T026 → T028 → T029 → T030 → T032
  → T033 → T034/T034a(并行) → T035 → T036 → T036a → T037 → T038 → T039 → T039a → T040
```

关键路径长度：约 26 个串行节点。

### 并行机会（C3 修订后）

- **Phase 1**：T001a 在 T001 后立即执行（源码改动前的唯一窗口）
- **Phase 2 RED 组**：T002/T003/T004/T004a 四个测试改动互不依赖，可并行
- **Phase 2 收敛组**：T008/T009 依赖同一 T006 但改动不同文件，可并行
- **Phase 2 适配组**：T010/T011/T012 各自独立文件，可并行
- **版本组内**：T018/T019 不同文件常量修改，可并行
- **T022 收口后**：T014/T015/T017 后续分支、T023/T024/T025、T027、T031 均可并行发起（互不同文件）
- **Phase 7**：T034 与 T034a 可并行（重采集与脚本实现互不依赖）

估算并行度：45 个任务中约 17 个可并行（~38%）；C3 边界统一后 T014-T016/T023-T032 的启动点从 T013 后移至 T022，损失少量流水重叠（版本组 6 任务的窗口），换取 R-1 原子性可由依赖图机械保证——影响可接受，原子性优先。

---

## Implementation Strategy

### 分阶段交付（HIGH 风险，两个验证里程碑同一原子交付单元）

1. **R-1 原子交付单元（Phase 2 + 版本组 T017-T022）**：一次性连续完成，T022 收口前不得对外声明任何阶段性完成
2. **T022 后（迁移/口径/等价/E2E）**：可并行推进 US1 延伸（Phase 3）、round-trip/byte（T023-T025）与增量护栏（T027），US3（Phase 5）与 MCP E2E（Phase 6 链）依赖前者产出
3. **Phase 7（Polish）**：全部功能任务完成后统一执行，baseline 重采集必须在 R-1 原子单元收口后才可开始（T034 depends_on T033 → 间接晚于 T022）

### MVP 边界

本 feature 无独立 MVP 切分空间——US1（contains 边）与 US2（ID 收敛）因 R-1 架构约束必须同一原子交付，US3（等价矩阵）是验证性需求依赖前两者。**不存在"先上线 US1 再上线 US2"的增量交付路径**，这是本 feature 与常规多 Story 分批交付模式的关键差异。

---

## Notes

- `[P]` 任务 = 不同文件、无直接依赖
- `[USN]` 标记任务归属，用于追踪但不改变 Phase 2/4 的原子交付约束
- 所有新建测试任务遵循 TDD：先跑 RED 确认失败，再实现，再跑绿
- 每个任务组完成后建议提交一次逻辑 commit（但 Phase 2 R-1 原子组、Phase 4 版本 bump 原子组内部不可拆分 commit）
- 严禁范围蔓延：B2/B3/B4、rename-follow、query-helpers.ts 搬迁、graph-builder.ts 整体重构均不在本清单任何任务中出现
