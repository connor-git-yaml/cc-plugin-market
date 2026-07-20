# Implementation Plan: Graph Topology / Canonical Symbol ID（M9 轨道 B1）

**Branch**: `claude/graph-topology-canonical-id-1de3ab` | **Date**: 2026-07-20 | **Spec**: `specs/214-graph-topology-canonical-id/spec.md`
**Input**: `spec.md`（v2，FR×11 / NFR×8 / SC×5）、`research/tech-research.md`（v2）、`checklists/requirements.md`（v2，4 PARTIAL）
**修订记录**: 2026-07-20 经 Codex 对 plan 的对抗审查（5 critical + 7 warning）后修订：C1（UnifiedGraph 端去重）、C2（legacy 正向谓词）、C4（真实 round-trip）、C5（SC-004 矩阵）、W1-W7 已逐条落实；C3/C5/W2 的 spec 措辞问题已在 spec.md 另行修订。

> 本 plan 只做工程展开。GATE_DESIGN 已定案的 7 条架构约束（方案 A / 版本策略 / contains 两级 / NFR-008 口径 / FR-009 分层 / R-1 原子交付 / 等价矩阵）不重议，仅落实到文件级改动与任务级缓解。

---

## Summary

修复 Spectra 知识图谱两个底座缺陷并建立三层转换合同：

1. **Canonical ID 收敛（方案 A）**：把 `src/adapters/python-adapter.ts:203` 的 Python symbol ID 生成从 `${relPath}#${name}` 改为 `${relPath}::${name}`，使 Python symbol 与 TS/JS symbol 收敛为单一 `::` 分隔符格式。这是唯一能让 F193 三处 `::`-only 硬护栏（`relativizeSymbolId` / `filePartOf` / `nodeIdFilePart`）无需追加逻辑即自然生效的收敛点。
2. **Contains 边补齐（FR-001/002）**：在 `src/knowledge-graph/index.ts` 的 `buildUnifiedGraph` 内新增 `deriveContainsEdges`，**语言无关**地产出两级 `module→class→member` / 一级 `module→symbol` contains 边。
3. **单一 ID 解析工具（FR-006）**：新增 `parseCanonicalSymbolId(id)` 收敛三处重复的"取 file part"字符串切分逻辑。
4. **版本 + 迁移（FR-010）**：`SNAPSHOT_WRAPPER_VERSION` 2.0→3.0（强制旧快照 format-stale 全量重建）；`UNIFIED_GRAPH_SCHEMA_VERSION` 1.0→1.1（SHOULD）；`GraphJSON.schemaVersion` 维持 `'2.0'`，改由 FR-008 内容级 legacy 检测承担迁移识别。
5. **legacy 检测（FR-008）**、**耦合口径守护（NFR-008）**、**等价矩阵（FR-007）**、**三层转换合同（FR-005）** 配套落地与测试。

技术方案不新增顶层图抽象层，延续 `src/knowledge-graph`（canonical model）/ `src/graph`+`src/knowledge-graph/module-derivation`（derived view）/ `src/panoramic/graph`（persisted+query representation）三模块划分。

---

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20.x+
**Primary Dependencies**: zod（schema）、graphology（community/god-node UndirectedGraph）、vitest（测试）
**Storage**: `.spectra/unified-graph.json`（SnapshotWrapper）、`_meta/graph.json`（GraphJSON）— 均为本地文件持久化，无 DB
**Testing**: vitest（`npx vitest run`）+ `npm run build` + `npm run repo:check` + `baseline:diff`
**Target Platform**: CLI / MCP server（stdio），跨 worktree byte 可移植（F193 护栏）
**Project Type**: single（monorepo 单包 src/ 树）
**Performance Goals**: graph-only 建图维持 ~2.8s 量级（F195 NFR-004）；contains 边计算为 O(symbols)，远小于既有 O(callSites)
**Constraints**: 全量 `npx vitest run` / build / repo:check 零失败；跨 worktree byte 一致；不得触碰 F212 worktree（NFR-007）
**Scale/Scope**: 改动面约 8 源文件 + 约 13 新测试/多处适配；跨 4 模块（knowledge-graph / adapters / panoramic/graph / panoramic/community）

---

## Codebase Reality Check

对目标文件读取核实的 LOC / 关键结构 / debt：

| 目标文件 | LOC | 关键结构 | 本次改动意图 | 已知 debt |
|---------|-----|---------|-------------|-----------|
| `src/adapters/python-adapter.ts` | 414 | `extractSymbolNodes`（:192-224） | 改 :203 分隔符 `#`→`::` | 无重大 debt；symbol id 硬编码 `#` 是本 feature 根因 |
| `src/knowledge-graph/index.ts` | 287 | `buildUnifiedGraph`（:52-74）、`deriveNodesFromSkeletons`（:186-224） | 新增 `deriveContainsEdges` + 生产端节点/边去重；拼入 edges（:65） | contains 缺失（FR-001）；**逐 member 写入无去重（:210,213）→ 同名 member 重复节点（C1）** |
| `src/knowledge-graph/relativize.ts` | 115 | `relativizeSymbolId`（:100-110，`::`-only） | 新增/托管 `parseCanonicalSymbolId` | 三处重复 file-part 切分（FR-006 收敛对象） |
| `src/knowledge-graph/unified-graph.ts` | 210 | `UNIFIED_GRAPH_SCHEMA_VERSION`（:210=`'1.0'`）、`defaultDirectionalForRelation`（:202）、schema 含 `contains`（:107,193） | bump schema version → `'1.1'` | schema 层无需改（contains 已在枚举） |
| `src/knowledge-graph/persistence.ts` | 347 | `SNAPSHOT_WRAPPER_VERSION`（:38=`'2.0'`）、`SnapshotWrapperSchema`（:51，`z.literal(SNAPSHOT_WRAPPER_VERSION)`）、版本嗅探（:214-228） | bump 常量 `'2.0'`→`'3.0'`（schema + 嗅探单点联动） | 无；嗅探已复用常量，单点 bump 干净 |
| `src/knowledge-graph/incremental.ts` | 589 | owning-node 替换（:268-289，filePath-keyed） | 无需改（见核实项②）；新增测试 | filePath-keyed diff 对新边类型静态兼容（待实测） |
| `src/knowledge-graph/module-derivation.ts` | 504 | `deriveModuleGraph`（:97-）relation 过滤（:107 仅 `depends-on`） | 无需改（见核实项④）；新增守护测试 | B→A 有损投影，contains 天然被过滤 |
| `src/panoramic/graph/graph-builder.ts` | 741 | `edgeKey`（:72）、5 路合并（:282-410）、B→C kind 映射（:363-366，`unifiedKind` 存 :375-376）、`filePartOf`（:572-576，`::`-only） | `filePartOf` 改调 `parseCanonicalSymbolId`；抽 `unifiedNodeToGraphNode`（可选，供 round-trip 测试） | 5 路合并大函数（禁整体重构，仅最小改） |
| `src/panoramic/graph/graph-query.ts` | 861 | `nodeIdFilePart`（:159-162，`::`-only）、`assertGraphFormatNotStale`（:179-196）、`GraphQueryEngine` 邻接表（:236-248，含 contains directional） | `nodeIdFilePart` 收敛；新增正向 `isLegacySymbolNode` 检测 | stale 检测对 `#` 失真（R-3 根因） |
| `src/panoramic/community/community-detector.ts` | 244 | `loadGraph`（:63-87，**无 relation 过滤**，:74-84 加入所有边含 contains） | 新增 `relation==='contains'` skip（NFR-008） | 现状把 contains 计入 degree/Louvain（NFR-008 口径根因） |
| `src/panoramic/community/god-node-analyzer.ts` | 124 | `isContainsOnly`（:93-103，仅过滤"纯 contains 节点"） | 无需改（loadGraph 过滤后天然生效） | 现状只过滤纯 contains 节点、不过滤 contains 边度数 |

**前置清理规则评估**：无文件满足强制 cleanup 阈值。`incremental.ts`(589)/`graph-query.ts`(861)/`module-derivation.ts`(504) 虽超 500 LOC，但本 feature 对其新增行数均 <50，不触发前置 cleanup。FR-006 的三处 file-part 重复切分 + C1 的生产端去重，本身即"就地消除重复"的正向清理，纳入功能 task。

---

## Impact Assessment

- **直接修改文件数**：约 8（python-adapter / index / relativize / unified-graph / persistence / graph-builder / graph-query / community-detector）
- **间接受影响（消费方/测试）**：约 16（python-adapter.test、graph-builder.test、query-helpers.test、4 处版本断言测试[W1]、feature-180 e2e ×3、feature-184/telemetry [W3]、agent-context-real-graph、cross-worktree-byte、snapshot-portability、component-view-builder 的 `::` split 现对 Python 生效、baseline fixture ×3）
- **跨包影响**：0（全部在 `src/` 内）
- **数据迁移**：**是** — 旧 `#` graph.json / 旧 2.0 snapshot 经 wrapper 3.0 bump 触发 format-stale 全量重建（复用 F193 机制，零新迁移代码）
- **API/契约变更**：MCP 工具**行为**契约按 FR-009 分层显式化（不改签名）；SNAPSHOT_WRAPPER / UNIFIED_GRAPH schema 版本 bump；GraphJSON.schemaVersion 不变

**风险等级判定**：涉及数据迁移 → 命中 HIGH 规则。迁移复用 F193 既有机制、跨包=0、影响文件<20 → 实质 MEDIUM-HIGH。**采 HIGH 的分阶段要求**，拆 2 Phase（每阶段有验证点），落地 R-1 原子交付风险。

---

## Constitution Check

> `.specify/memory/constitution.md` 不存在（仓库以 CLAUDE.md / AGENTS.md / project-context.yaml 承载规则）。按项目宪法等价规则评估。

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| 不创建平行 registry/graph/retrieval kernel | 适用 | PASS | 延续三模块划分，零新顶层抽象层 |
| 简洁之道 / 消除重复 | 适用 | PASS | FR-006 收敛三处切分 + C1 生产端去重 |
| 零基思维 / 修正抽象而非叠 workaround | 适用 | PASS | 方案 A 产出端消除根因；C1 在生产端而非合并端救重复 |
| 类型系统第一道防线 | 适用 | PASS | contains 已在枚举；version bump 走 `z.literal` 常量单点 |
| 提交前全量验证零失败 | 适用 | PASS（待执行） | SC-005 绑定 vitest/build/repo:check/baseline:diff |
| 不越界 / 不引入 spec 外功能 | 适用 | PASS | 不实现 B2/B3/B4；不搬迁 query-helpers；不重构 5 路合并 |
| 与 F212 隔离（NFR-007） | 适用 | PASS | 不触碰 F212 worktree/评测脚本 |

**无 VIOLATION**，Constitution Check 通过。Complexity Tracking 表为空。

---

## Project Structure

```text
specs/214-graph-topology-canonical-id/
├── spec.md / plan.md（本文件） / research/tech-research.md / checklists/requirements.md
└── tasks.md（下一阶段 /spec-driver.tasks 产出）
```

> 本 feature 无新增持久化实体、无新增外部 API 契约（schema 零改、GraphJSON 结构不变），故不单独生成 data-model.md / contracts/ / quickstart.md；转换合同与字段级映射直接落在本 plan"架构设计"。

```text
src/
├── adapters/python-adapter.ts                    # 方案 A：#→:: 收敛点
├── knowledge-graph/
│   ├── index.ts                                  # + deriveContainsEdges + 生产端去重（C1）
│   ├── relativize.ts                             # + parseCanonicalSymbolId（FR-006 单点）
│   ├── unified-graph.ts                          # UNIFIED_GRAPH_SCHEMA_VERSION 1.0→1.1
│   ├── persistence.ts                            # SNAPSHOT_WRAPPER_VERSION 2.0→3.0
│   └── incremental.ts                            # 无改动，+ 增量测试
└── panoramic/
    ├── graph/graph-builder.ts                    # filePartOf → parseCanonicalSymbolId
    ├── graph/graph-query.ts                      # nodeIdFilePart 收敛 + isLegacySymbolNode（FR-008）
    └── community/community-detector.ts           # loadGraph + contains skip（NFR-008）
```

**Structure Decision**: 沿用单包 src/ 结构，改动分布在 4 个既有模块，无新目录。

---

## 架构设计

### 三层职责合同

| 层 | 物理位置 | 承载类型 | 本 feature 职责 |
|----|---------|---------|----------------|
| **A. Canonical model** | `src/knowledge-graph` | `UnifiedGraph`（module/symbol/member 节点 + calls/depends-on/**contains** 边） | contains 落点；canonical ID 决策权；**生产端去重（C1）**；`parseCanonicalSymbolId` 单点 |
| **B. Derived view** | `src/knowledge-graph/module-derivation`（+ `src/graph`） | `ModuleGraph`（仅 module 节点 + depends-on 边） | 确认 contains 不被误纳入 module 依赖（核实项④） |
| **C. Persisted + query** | `src/panoramic/graph` | `GraphJSON`（写盘 + MCP 查询） | ID 收敛后三处护栏天然生效；FR-008 legacy 检测；filePartOf 收敛 |

> `query-helpers.ts` 物理位于 A 层却消费 C 层类型的耦合点（research §5.1）：本 feature **仅文档层承认，不物理搬迁**（Out of Scope）。

### 转换点字段级 保留 / 映射 / 丢弃 合同（FR-005 跨层有损投影）

**B→A（`UnifiedGraph` → `ModuleGraph`，`deriveModuleGraph`，module-derivation.ts:97-）**

| 字段 | 处置 | 说明 |
|------|------|------|
| module 节点 id | 保留 | `kind==='module'` 才入 moduleIds（:103-104） |
| `depends-on` 边 | 保留→映射 | 仅 `relation==='depends-on'` 且两端均 module（:107,110-112）→ `ModuleEdge{from,to,importType}` |
| `metadata.importType`/evidence | 映射 | `parseImportType`（:119）→ `ModuleEdge.importType` |
| symbol/member 节点 | **丢弃** | 非 module kind |
| **contains 边** | **丢弃**（预期） | `relation!=='depends-on'` 被 :107 过滤 → 不改变 SCC/拓扑口径（核实项④） |
| calls/confidence/evidenceText | 丢弃 | 派生视图不需要 |

**B→C（`UnifiedGraph` → `GraphJSON`，graph-builder.ts 第五路，:348-410）**

| 字段 | 处置 | 说明 |
|------|------|------|
| node.id / edge.source/target | 保留 | ID 收敛后与 extraction 第四路统一 |
| edge.relation | 保留 | 含新 contains |
| `kind==='symbol'` | **映射** | → GraphNode.kind `'component'`（:366）；原 kind 存 `metadata.unifiedKind`（:375-376，**legacy 正向检测据此 gate，C2**） |
| confidence tier | 映射 | high/medium/low → EXTRACTED/INFERRED/AMBIGUOUS + confidenceScore（:389-391） |
| directional | 映射 | 缺省按 `DIRECTIONAL_RELATIONS`（含 contains，:386）；第四路空缺者由第五路升级 true（:408-409） |
| node.filePath | 映射 | → `metadata.sourcePath`（:377） |
| edge.evidence | **有损映射** | `.slice(0,200)` 截断（:406） |
| node.language | 丢弃 | 不入 GraphNode 顶层 |

**同层序列化 round-trip（FR-005a）**：`UnifiedGraph` snapshot `save→load→save`（persistence，真实写盘/加载入口）+ `GraphJSON` `write→read→write`（normalizeGraphForWrite，F183）字节/结构稳定 — **由 C4 两个真实 round-trip 测试看护（非 mock）**。

---

## 实现策略

### 分阶段（HIGH 风险；R-1 原子交付内部再切验证点）

> R-1 要求"ID 统一 + contains 生成"为**同一原子交付单元**（同一 commit/PR），两个 Phase 是同一交付单元内的验证里程碑，非可分开 merge 的发布。

**Phase 1 — 核心图语义（原子）**：方案 A（python-adapter #→::）+ `deriveContainsEdges` + **生产端去重（C1）** + `parseCanonicalSymbolId` + 三处护栏收敛 + version bump。
- **验证点 P1**：T1/T2/T3/relativize-Python 结构断言 + build 零错误；同名 member fixture 三层唯一。

**Phase 2 — 迁移/口径/等价/E2E**：`isLegacySymbolNode`（FR-008）+ NFR-008 loadGraph 过滤 + FR-007 等价矩阵 + SC-001 oracle + 增量/byte 测试 + baseline 重采集。
- **验证点 P2**：T4-T13 绿；3 baseline `baseline:diff` 差异全落 SC-005 allowlist；全量 vitest/repo:check 零失败。

### 改动文件清单（每文件意图 + file:line 锚点）

1. **`src/adapters/python-adapter.ts:203`** — `${relPath}#${name}` → `${relPath}::${name}`；:217/:221 contains 边 target 随 `symbolId` 变量自动同步。**唯一 ID 生成点**，改动 1 行。
2. **`src/knowledge-graph/index.ts`** — 新增 `deriveContainsEdges`（语言无关，W2；不做任何语言 gate）；**C1 生产端双去重**：`deriveNodesFromSkeletons` 节点按 **node id** 去重、`deriveContainsEdges` 边按 **(source,target,relation)** 去重。原因：`deriveNodesFromSkeletons` 逐 member 写入无去重（:210,213），而 `code-skeleton.ts:30,93` 允许 getter/setter 同名、`typescript-mapper.ts:646,685` 直接 append → UnifiedNode 重复；**UnifiedGraph snapshot 直接持久化该输出、不过 GraphJSON nodeMap**，故第五路合并去重救不了快照层重复。FR-011 折叠 MUST 在生产端落地（沿用 `${Class}.${m.name}` 命名 → 同名 member 天然共享 canonical id → 单节点 + 单 contains 边）；deriveContainsEdges 复用 deriveNodesFromSkeletons 的 id 计算，二者共享同一去重规则，不各自拼串。:65 拼入 `...deriveContainsEdges(...)`（先于 relativizeGraph）。
3. **`src/knowledge-graph/relativize.ts`** — 新增导出 `parseCanonicalSymbolId(id): { filePart, symbolPart | undefined }`（`indexOf('::')` 切分；无 `::` 则 filePart=整 id、symbolPart=undefined）。`relativizeSymbolId` 复用。
4. **`src/knowledge-graph/unified-graph.ts:210`** — `UNIFIED_GRAPH_SCHEMA_VERSION` `'1.0'`→`'1.1'`（SHOULD）。
5. **`src/knowledge-graph/persistence.ts:38`** — `SNAPSHOT_WRAPPER_VERSION` `'2.0'`→`'3.0'`。schema（:52 `z.literal(常量)`）与嗅探（:218）均引用常量，**单点 bump 全链路联动**（无二处硬编码 `'2.0'`，I5 成立）。
6. **`src/panoramic/graph/graph-builder.ts:572-576`** — `filePartOf` 改调 `parseCanonicalSymbolId(id).filePart`。
7. **`src/panoramic/graph/graph-query.ts`** — (a) `nodeIdFilePart`（:159-162）改调 `parseCanonicalSymbolId`；(b) **【C2 — 正向谓词】**新增 `isLegacySymbolNode(node): boolean`，`assertGraphFormatNotStale`（:179-196）据其识别 legacy `#` symbol → 抛 `graph-format-stale`。谓词**正向**只认 symbol 语义节点：`node.id.includes('#')` 且（`node.metadata?.unifiedKind === 'symbol'`（graph-builder.ts:363,375-376）**或** `node.metadata?.sourceTag === 'extraction'`（graph-builder.ts:287）结合 Python provenance，如 `.py` file part）。**MUST NOT** 用"`includes('#') && kind !== api`"负向过滤——`design-doc-anchoring.test.ts:44-48` 存在 `kind='module'` 且 id 含 `#` 的合法节点（如 `src/pipeline.ts#withRetry`），负向谓词会误杀。T5 加此类负例。
8. **`src/panoramic/community/community-detector.ts:74-84`** — `loadGraph`（被 community/index.ts:55 `runCommunityAnalysis` 调用）在 `graph.addEdge` 前新增 `if (edge.relation === 'contains') continue;` → contains 不进 UndirectedGraph → 不计入 degree/Louvain（NFR-008、GATE_DESIGN #4）。**不改 `GraphQueryEngine`**（graph-query.ts:242 邻接表仍含 contains，US1/graph_node 邻居依赖，W6）。

---

## F193 迁移设计（显式一节）

### wrapper 3.0 bump 全链路影响

| 环节 | 位置 | bump 后行为 |
|------|------|------------|
| **写入** | `saveSnapshot`（persistence.ts） | 新快照顶层 `schemaVersion='3.0'`，Python symbol 为 `::` |
| **嗅探** | `loadSnapshotDetailed`（:214-228） | 旧 2.0 `sniffedVersion('2.0')!=='3.0'` → `format-stale` → null → 全量重建（复用 F193，零新代码） |
| **重建** | batch/index 主路径 | format-stale → 完整 `buildUnifiedGraph`（含新 contains + `::`）→ 3.0 快照 |
| **跨 worktree byte 一致** | `relativizeGraph`（index.ts:86-113） | contains 边 source/target 同经 `relativizeSymbolId` 相对化（:99-103），`::` 天然识别 → byte 稳定不回归 |

**GraphJSON 层（schemaVersion 维持 '2.0'）**：ID 分隔符变更不改结构，不 bump；迁移识别改由 `isLegacySymbolNode`（改动点 7b）承担。旧 `#` GraphJSON 若 copy 进新 worktree，加载期即抛 stale 并指引重建（闭合 R-3 静默缺口）。

### `installRelativizedBaseline` e2e fixture 影响（W3）

- `tests/e2e/helpers/stdio-client.ts:40` `installRelativizedBaseline` 读本地 `~/.spectra-baselines/micrograd-output/.../graph.json`（**非入库**），relativize 后写临时 dest。micrograd 纯 Python → 当前含 `math.py#foo`。方案 A 后需**本地重跑 `baseline:collect --target karpathy/micrograd`** 重生成（`::`）。
- **W3 fail-fast**：`installRelativizedBaseline` 增加前置检查——若源 fixture 含 **legacy `#` symbol 节点**（复用 `isLegacySymbolNode` 判定）即抛错并给 `baseline:collect` recollect 指引，避免旧格式 fixture 静默污染 e2e。
- **调用方适配矩阵**（stdio-client.ts:40 定义、:47 relativize 调用）：`feature-180-{symbol-chain,graph-tools,file-nav-stdio}`、**`feature-184-view-file-fuzzy`**、**`feature-180-telemetry`** 五处调用方；硬编码 micrograd Python 符号 id 的断言 `#`→`::`。`installRelativizedBaseline` 函数本身 relativize 逻辑分隔符无关，无需改（除新增 fail-fast）。
- 入库 perf anchor `tests/baseline/micrograd/spectra/full.json` 按 CLAUDE.local.md 升版流程重采集 + `baseline:diff` 后 commit（R-2）。

---

## 测试策略（TDD）

### 新增测试清单（13 项）

| # | 测试文件 | 覆盖 | 绑定 |
|---|---------|------|------|
| T1 | `tests/unit/knowledge-graph/contains-edges.test.ts`（新建） | TS 两级 module→class→member；Python class member 四类对称；Python 顶层函数一级；无 module→member 扁平边；**【C1】同名 getter/setter（+重载）fixture → 断言 UnifiedGraph 节点/边 + 最终 GraphJSON 三层均唯一** | **SC-002**、FR-001/002/011 |
| T2 | `tests/unit/knowledge-graph/parse-canonical-symbol-id.test.ts`（新建） | `parseCanonicalSymbolId` 对 `file::sym`/`file::Class.m`/`file`/`file#legacy` 的 filePart/symbolPart | FR-006 |
| T3 | `tests/unit/knowledge-graph/build-unified-graph.test.ts`（既有，扩展） | contains 边并入 `buildUnifiedGraph` edges；B→C mock 结构断言 | FR-005、FR-001 |
| T4 | `tests/integration/graph-equivalence-matrix.test.ts`（新建） | 纯 TS + 混合 TS+Python fixture，full vs graph-only 按 provenance 过滤共同子图断言节点/边/ID 集合相等；差异归因 full-only 数据源 | **SC-003**、FR-004/007、US3 |
| T5 | `tests/unit/panoramic/graph/legacy-id-stale.test.ts`（新建） | 【C2】`#` symbol 节点（unifiedKind='symbol'/sourceTag='extraction'）→ 抛 stale；**负例：`kind='module'` 且 id 含 `#` 的 doc-anchor 节点不误报**；api-surface `#` 节点不误报；wrapper 3.0 嗅探旧 2.0→format-stale | FR-008、NFR-001、R-3 |
| T6 | `tests/unit/knowledge-graph/incremental-contains.test.ts`（新建） | 【W5】文件**新增/删除/rename**、**member 删改**、**跨文件 calls caller 重建** 后增量 diff 正确替换旧 contains、加入新 contains；**断言重建图无 stale/dangling endpoint**；新 member 节点带 filePath 被 owning-node 识别 | **NFR-003**、R-4 |
| T7 | `tests/unit/panoramic/community/contains-relation-filter.test.ts`（新建） | 【W6 双断言】(a) community `loadGraph` 图**不含** contains 边、degree/community 口径不受 contains 影响；(b) `GraphQueryEngine`/`graph_node` 邻居**仍含** contains（graph-query.ts:242；US1 依赖） | **NFR-008**、GATE_DESIGN #4、US1 |
| T8 | `tests/unit/knowledge-graph/module-derivation.test.ts`（既有，扩展） | `deriveModuleGraph` 输入含 contains 时不改变 module 依赖/SCC/拓扑 | 核实项④、B→A 合同 |
| T9 | `tests/e2e/feature-214-mcp-layered-query.e2e.test.ts`（新建） | 【C5 新 SC-004 矩阵】`impact`/`context`：同 symbol 绝对/相对 canonical ID 返回一致；`graph_node`：symbol ID→symbol 节点、module ID→module 节点、邻居含 contains；`graph_path`：端点组合矩阵（symbol↔symbol/module↔module 精确）；legacy `#` 对 impact/context best-effort（非阻断）、对 graph_node/path 不承诺 | **SC-004**、FR-009、NFR-005 |
| T10 | `tests/unit/knowledge-graph/snapshot-roundtrip.test.ts`（新建） | 【C4 真实 RED】`UnifiedGraph` snapshot **save→load→save**（真实 `saveSnapshot`/`loadSnapshotDetailed` 入口，非 mock），输入 fixture 含 contains + 同名 member + Python canonical ID，比较两次归一化 bytes/结构相等 | **SC-003a**、FR-005a |
| T11 | `tests/unit/panoramic/graph/graphjson-roundtrip.test.ts`（新建） | 【C4 真实 RED】`GraphJSON` **write→read→write**（真实 `normalizeGraphForWrite` 写盘/读回入口，非 mock），同类 fixture，比较归一化 bytes 稳定 | **SC-003a**、FR-005a、NFR-002 |
| T12 | `tests/unit/knowledge-graph/python-crossworktree-byte.test.ts`（新建） | 【W4】含 **Python class/member** 的 fixture 在双 root（/a、/b）建图 → 相对化后 snapshot bytes 完全一致（现有 cross-worktree-byte.test.ts:25、snapshot-portability.test.ts:154 均 TS-only，Python 路径无覆盖） | NFR-001、F193 |
| T13 | `tests/integration/graph-equivalence-matrix.test.ts`（并入 T4 或独立） | 【W7 SC-001 直接 oracle】graph-only 混合 Python fixture，按**归一化语义 key**（file+symbolName）计算 duplicate-pair count，断言 **=0** | **SC-001**、FR-004 |

### 既有测试适配清单（受 ID 格式/版本影响）

| 文件 | 适配 |
|------|------|
| `tests/adapters/python-adapter.test.ts:307,314,386-388` | `math.py#add`/`a.py#forward`/`b.py#forward` → `::`；T010 描述同步 |
| `tests/unit/graph-builder.test.ts` | `#` python symbol 断言 → `::`；确认 contains 去重无重复对 |
| `tests/unit/knowledge-graph/query-helpers.test.ts` | 保留 `symbolSeg`/`moduleFileFromId` 的 `#` 双格式兼容分支测试（旧图降级 R-6）；补 `::` 主路径 |
| **【W1 版本断言】** `tests/integration/156-w2-spectra-index.test.ts:105`、`tests/.../snapshot-portability.test.ts:141`、`tests/.../persistence.test.ts:100`、`tests/unit/knowledge-graph/unified-graph.test.ts:192` | 四处硬编码版本断言 → **优先改引用版本常量**（`SNAPSHOT_WRAPPER_VERSION`/`UNIFIED_GRAPH_SCHEMA_VERSION`），避免下次 bump 再漂 |
| `tests/e2e/feature-180-{symbol-chain,graph-tools,file-nav-stdio}`、`feature-184-view-file-fuzzy`、`feature-180-telemetry` | micrograd Python 符号断言 `#`→`::`；依赖重采集本地 baseline（W3） |
| `tests/integration/agent-context-real-graph.test.ts` | 若断言 `#` python id → `::` |
| `tests/kb/search-core.test.ts` / `tests/debt-scanner/*` | 逐一确认 `#` 命中是否 symbol id（多为 markdown anchor `href.split('#')`，无关则不改） |

### 验证命令（SC-005）

`npx vitest run` + `npm run build` + `npm run repo:check` 零失败；3 baseline 重采集后 `npm run baseline:diff`，差异仅允许 SC-005 allowlist。**最终验证摘要须逐条列全 SC-005 三类变化（W7）**：(1) 新增 contains 边计数；(2) contains 派生度数字段变化（NFR-008 决定不计入耦合 → 该派生对 community/god-node 为 0，但含 R-7 的 micrograd 既往 python-contains 移除口径变化）；(3) 由 (1)(2) 之外任何变化 = 回归。

---

## 风险与缓解（R-1~R-7 逐条任务级）

| # | 关联护栏 | 缓解（任务级） |
|---|---------|---------------|
| **R-1** | F193 相对化/portable/stale | 方案 A（点 1）与 contains 生成 + C1 去重（点 2）**同一 commit**（Phase 1 原子）；T2/T5/T10/relativize-Python 结构断言看护。验证点 P1 门禁。 |
| **R-2** | F183 三写盘出口 byte-stable | 升版流程：改码→build→重采 3 baseline→`baseline:diff`→确认差异仅 contains→commit 新 fixture。T11 看护 normalizeGraphForWrite 稳定。 |
| **R-3** | F193 format-stale 漏检 | 点 7b 正向 `isLegacySymbolNode`（独立于绝对路径判定）；T5 断言 symbol `#`→stale、doc-anchor/api `#`→不误报。 |
| **R-4** | F182 增量三护栏 | 核实项②静态成立（待实测）；T6 显式覆盖新增/删除/rename/member 改动 + 无 stale endpoint，不假定。 |
| **R-5** | F195 graph-only 2.8s | contains O(symbols) 远小于 O(callSites)；baseline 重采时测墙钟无显著劣化（NFR-004）。 |
| **R-6** | F196 MCP fuzzy 一致性 | `symbolSeg`/`moduleFileFromId` `#` 分支**保留降级**（旧图/api 容错，不删）；query-helpers.test 双场景；T9 覆盖 FR-009。 |
| **R-7** | NFR-008 口径 | loadGraph 过滤 contains（点 8）会移除既有 Python contains 的**既往度数计入** → micrograd community/god-node 基线会变。作为**有意口径统一**记录（结构边不膨胀耦合，符 GATE_DESIGN #4），显式扩 SC-005 allowlist 覆盖该 delta + commit 说明，**不静默改口径**。T7 看护。 |

---

## 4 个待核实项核实结论（I1-I6，Codex 确认成立，仅 W2 扩面收口）

1. **【I1】`edgeKey()` 合并语义** — 天然去重前提**成立**。第四路（python contains，`directed=false`，graph-builder.ts:123）→ `undirectedEdgeKey`；第五路（unified contains，`isDirectional=true`）→ `directedEdgeKey`；对 module→symbol 二者产**相同 key**（symbol id = `moduleId::name`，moduleId 恒为严格词典前缀 → 无向排序序==有向自然序），第五路再升级 `directional=true`（:408-409），最终单边。**注**：此为 GraphJSON 合并端去重；**UnifiedGraph 快照端重复须靠 C1 生产端去重**（edgeKey 救不了快照），T1/T13 兜底断言无重复。
2. **【I2】F182 增量护栏** — **静态成立，待 T6 实测**。incremental.ts:268-289 filePath-keyed owning-node 替换：symbol/member 均带 filePath（index.ts:208/217）→ 文件变更时旧 contains 删、新 contains 从 partial 加入；wrapper 3.0 bump 使首次升级 format-stale→全量重建，旧 2.0 不进增量。措辞降级为"静态支持，待 T6 删除/rename/member 改动 + 无 stale endpoint 实测确认（W5）"。
3. **【I3】graph.html 前端** — 无 graph.html；html-template 的 `#` 全为 CSS（`#0d1117`/`#sidebar`）非 node-id 切分。`component-view-builder.ts:274-275` `split('::')` 对 Python 由失效转生效（改进非回归）；`coverage-auditor.ts:343` `split('#')` 为 markdown anchor 无关。**无需前端联动**，NFR-006 满足。
4. **【I4】deriveModuleGraph B→A** — contains 天然被过滤。:107 仅 `depends-on` + :110-112 两端须 module，contains（relation='contains'、target=symbol）双重排除，不进 SCC/度数。T8 守护。
5. **【I5】F193 版本常量链路** — 完整。`SnapshotWrapperSchema`(:52) 与嗅探(:218) 均引用 `SNAPSHOT_WRAPPER_VERSION` 常量，单点 bump 全链路联动，无二处硬编码 `'2.0'`。
6. **【I6】无 over-engineer** — 成立；仅 **W2** 扩面收口：`deriveContainsEdges` **语言无关派生、无任何人为语言 gate**；SC-002 验收矩阵仅以 TS/JS/Python 度量（与 spec 修订一致），不新增语言分支设计。

---

## Complexity Tracking

> 无 Constitution VIOLATION，无需豁免论证。表为空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| （无） | — | — |
