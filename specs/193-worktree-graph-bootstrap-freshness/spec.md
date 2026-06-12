# Feature Specification: worktree graph 开箱可用 + 增量保活

**Feature Branch**: `193-worktree-graph-bootstrap-freshness`
**Created**: 2026-06-13
**Status**: Draft
**Mode**: spec-driver-story（跳过调研，基于已预供方案候选 + 主编排器代码扫描）
**Input**: M8 dogfooding 阻塞修复 —— 新 worktree 天生无图导致 17 个 Spectra MCP 工具全废

## 背景与动机

本仓库采用「每 feature 一个 git worktree」的并行工作流。2026-06-13 实测：F182 窗口的子代理在新 worktree 调用 `impact` 报 `graph-not-built`，导致全部 17 个 Spectra MCP 工具不可用，dogfooding（自用 Spectra 做结构化上下文）无法进行。根因有四（详见 `research/code-context-summary.md`），本 feature 是 dogfooding policy 反馈直接转化的需求。

核心约束：图节点 id 当前内嵌**绝对路径**（`src/knowledge-graph/index.ts:144` `id: filePath`，filePath 为绝对路径），使得图既不入库也不可跨 worktree 移植。**id 相对化（🅐）是一切的前提**——只有 id 相对化后，主仓/缓存的图才能 copy 到任意 worktree 直接生效，跨 worktree byte 一致才有可能。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 新 worktree 开箱即用 MCP（Priority: P1）

作为在新 worktree 启动 feature 的开发者（或其子代理），我希望**不手动跑 batch 构图**，就能直接调用 `impact` / `context` 等 MCP 工具拿到结构化上下文。

**Why this priority**: 这是本 feature 的核心痛点与 dogfooding 阻塞点；不解决则多 worktree 工作流每次都裸奔。其余故事都服务于这一目标的「正确性」与「可持续性」。

**Independent Test**: 在一个全新 worktree（无 `specs/_meta/graph.json`）执行 bootstrap 钩子后，调用 `impact <某 symbol>` 返回非空、且 id 指向**当前 worktree 的相对路径**（而非主仓绝对路径），即视为通过。

**Acceptance Scenarios**:

1. **Given** 新建 worktree 且 `specs/_meta/graph.json` 不存在、主仓/共享缓存存在已构建的图，**When** 执行 bootstrap 钩子（`sync-worktree-local-state.sh` 或等价入口），**Then** worktree 获得 `specs/_meta/graph.json` 且 `impact`/`context` 返回有效结果，无需跑 batch。
2. **Given** 新建 worktree 且主仓与共享缓存均无可用图，**When** 执行 bootstrap 钩子，**Then** 钩子不报错、明确提示「无缓存图，请运行 `<构建命令>` 构建」，且不留下损坏的半成品图。
3. **Given** bootstrap 已 copy 图到 worktree，**When** 在该 worktree 调用任一受影响 MCP 工具，**Then** 返回的节点 id / filePath 解析到当前 worktree 路径，查询结果正确。

### User Story 2 - 图可移植 + 跨 worktree byte 一致（Priority: P1）

作为维护者，我希望同一 commit 下、不同 worktree 构建出的 `graph.json` **byte 完全一致**，使图可缓存、可共享、可入库决策有依据。

**Why this priority**: 这是 US1 bootstrap「copy 即生效」的正确性前提；也是 F179/F180 byte-stable gate 的自然延伸。与 US1 同为 P1，因为 bootstrap 若拿到不可移植的图等于没修。

**Independent Test**: 在两个不同路径的 worktree（同一 commit）各自构建图，比较 `graph.json` 的 byte（或规范化后的语义等价 + id 字段逐一相对化校验），一致即通过。

**Acceptance Scenarios**:

1. **Given** 同一 commit 的两个 worktree（路径不同），**When** 各自从零构建 graph.json，**Then** 两份 graph.json 的全部节点 id / filePath / 边 source / 边 target 均为相对 projectRoot 的 POSIX 路径，且两份文件 byte 一致（或在排除 `metadata.generatedAt` 等已知时间戳字段后 byte 一致）。
2. **Given** 一份新格式（相对 id）的 graph.json，**When** 17 个 MCP 工具逐一查询，**Then** 全部正常工作（id 解析、fuzzy match、BFS impact、context 等），F180 的 44 个 E2E 用例零回归。
3. **Given** 存量旧格式（绝对 id）graph.json，**When** MCP 工具加载，**Then** 要么经查询侧 canonicalize 相对化 fallback 正常工作，要么给出明确的「图格式过期，请重建」提示——不得静默返回错误结果。

### User Story 3 - 改代码 commit 后图增量保活（Priority: P2）

作为开发者，我希望改完一个 src 文件并 commit 后，图能**增量更新**反映新状态，无需全量重构。

**Why this priority**: 保活是「开箱可用」的可持续保障，但优先级低于「首次可用 + 正确」。这也是 F175 增量链的真实 dogfooding（改代码→图增量迁移）。

**Independent Test**: 在 bootstrap（含快照）后的 worktree 改一个 src 文件（增/删一个 export）后触发增量更新，**走增量路径（非 full reindex）**，查询新 symbol 能命中 / 删除的 symbol 不再命中。

**前置依赖（Codex C1）**: F175 增量链 `buildIncremental` 依赖 `.spectra/unified-graph.json` 快照（`loadSnapshot` 失败 → `runFullReindex`，fallbackReason='no-snapshot'）；快照内嵌 `graph: UnifiedGraph`（含 `metadata.projectRoot` 绝对）+ `fileHashes`（**绝对路径 → SHA-256**）。故 bootstrap 必须同时搬运并相对化快照，否则首次 commit 退化为全量重建，违背 US3「无需全量重构」。

**Acceptance Scenarios**:

1. **Given** worktree 已 bootstrap（含相对化的 graph.json **和** `.spectra/unified-graph.json` 快照）且激活了保活机制，**When** 修改一个 src 文件并 commit，**Then** `buildIncremental` 走增量路径（fallbackToFull=false）、图增量更新、后续查询反映新状态（新增 symbol 可查、删除 symbol 不可查）。
2. **Given** worktree 只有 graph.json 但无快照（或快照为旧绝对 key 格式），**When** 改代码 commit，**Then** 系统明确退化为 full reindex 并记录 fallbackReason（'no-snapshot' / 'snapshot-format-stale'），不静默产生错误增量结果。
3. **Given** 保活机制未激活，**When** 用户查阅文档，**Then** 能找到明确的激活步骤（`spectra install --git` 或 watch 用法）。

### User Story 4 - bootstrap 性能根因诊断（Priority: P3）

作为维护者，我希望理解 code-only 构建 27.5min / CPU 11% 的空等根因，以便量化改善或留作后续。

**Why this priority**: 性能是体验改善项而非阻塞项（bootstrap copy 已绕开首次构图耗时）；且修复可能触碰 F182 在飞的 batch-orchestrator，需谨慎分流。

**Independent Test**: 产出一份 profiling 报告，定位 CPU 11% 的空等根因（串行 await / sleep）；若修复在 scope 内则给出量化前后对比，否则给出分流结论。

**Acceptance Scenarios**:

1. **Given** code-only 构建路径，**When** 执行 profiling，**Then** 产出根因诊断报告（空等位置 + 是否触碰 F182 护栏文件）。
2. **Given** 根因落在非 F182 护栏文件且修复成本可控，**When** 实施修复，**Then** 给出构建时长量化改善数据；否则记录发现并分流为独立 fix 候选。

### Edge Cases

- **主仓图也是旧绝对格式**：bootstrap copy 来的旧图在 worktree 无法正确解析 → 必须经 US2-AS3 的相对化 fallback 或「重建」提示处理，不得静默错误。
- **共享缓存 stale**（缓存图对应的 commit ≠ worktree 当前 commit）：bootstrap 需检测并提示 / 增量迁移，不得返回错误 commit 的图结果。
- **id 相对化遇到 projectRoot 外的文件**（如 monorepo 跨包绝对引用、node_modules）：需定义保留绝对 / 跳过 / 标记的策略，不得产生越界的 `../../..` 链导致跨 worktree 不一致。
- **Windows 路径分隔符**：相对化必须 POSIX 化（`/`），保证跨平台 byte 一致。
- **符号 id 内含 `::` 或 `.` 与路径分隔符冲突**：相对化只能改路径前缀部分，不得破坏 `${filePath}::${name}` / `.${member}` 的结构分隔符。
- **bootstrap 与保活竞态**：copy 图的同时 post-commit hook 触发增量 → 需保证不产生半成品 / 损坏图（copy 用原子写）。
- **快照旧格式（绝对 key）**：copy 自主仓的旧快照 fileHashes 是绝对 key，与新 worktree 文件不匹配 → 必须判 `snapshot-format-stale` 退化 full reindex，不静默错误增量（Codex C1/C2）。
- **graph.json copy 覆盖**：worktree 已有本地增量后的图时，bootstrap 重跑 MUST 跳过不覆盖（copy-if-absent，Codex W4）。
- **graph 工具 exact 匹配**：`graph_path`/`graph_node` 不走 canonicalize、直接 exact nodeMap → 相对 id 图必须保证查询输入与节点 id 同形（Codex W5）。
- **calls 边绝对路径泄漏**：`resolveCalls` 的 mkEdge 直接拼绝对 `callerFile`/target（call-resolver.ts:409-420/238/250/297）→ 出口统一相对化 pass 必须覆盖 calls 边，不只 import 边（Codex plan-C1）。
- **extraction source_file 泄漏**：markdown/image extractor 把绝对路径写入 `source_file` → 最终落 graph.json `metadata.sourceFile` → producer 相对化 + writeKnowledgeGraph 守卫 tripwire 兜底（Codex plan-C5）。

## Requirements *(mandatory)*

### Functional Requirements

#### 🅐 id 相对化（前提）
- **FR-001**: 图写入侧 MUST 将全部持久化 path-like 值生成为**相对 projectRoot 的 POSIX 路径**（不再内嵌绝对路径）。字段清单（Codex plan-C1/C5/W4 修正）：graph.json 的 node.id、edge.source/target（**含 call-resolver 产生的 calls 边**，不只 depends-on 边）、path-like metadata（`sourcePath` / `sourceFile` / `sourceTarget`）、hyperedge 节点引用；快照的 UnifiedNode.id/filePath、UnifiedEdge.source/target、fileHashes key。注：graph.json 的 GraphNode **无顶层 filePath 字段**，filePath 仅存在于快照 UnifiedNode。
- **FR-002**: 相对化 MUST 保持 symbol id 结构分隔符不变（`<relPath>::<name>`、`<relPath>::<name>.<member>`），仅相对化其中的路径部分。
- **FR-003**: 相对化 MUST POSIX 化路径分隔符（统一 `/`），保证跨平台 byte 一致。
- **FR-004**: 对 projectRoot 之外的文件路径（node_modules / 跨仓绝对引用 / monorepo 外部），系统 MUST **保留绝对路径并标记 `external: true` metadata**，不得生成 `../` 越界相对链（越界链内嵌 worktree 目录深度，跨不同深度 worktree 不一致）。external 节点 MUST 排除出跨 worktree byte 一致断言（见 FR-016），单独核对数量 + 相对语义一致。
- **FR-005**: 17 个 MCP 工具 MUST 在新相对 id 格式下全部正常工作。实现侧 MUST 产出**逐工具矩阵**（Codex W5），标注每个工具：是否经 `canonicalizeSymbolId`、是否接受相对 id 输入、是否对旧绝对图返回 stale——尤其 graph 工具（`graph_path` / `graph_node` 等）直接用 exact `nodeMap`/adjacency，不走 canonicalize（graph-tools.ts），需单独验证相对 id 匹配。
- **FR-006**: 系统 MUST 在**加载期**检测旧格式（绝对 id）图：若图中存在绝对路径 id 且其前缀不在当前 projectRoot 下（典型：copy 自主仓的旧图），MUST 返回明确 `graph-format-stale`（Codex C2），不得经 canonicalize 静默退化为 not-found。检测 MUST **全量扫描** node ids（判定 = file part 绝对 且 非当前 projectRoot 前缀，可命中即短路）；不得用首批抽样启发式（前 N 节点恰为相对/doc 形态时 100% 漏判，Codex plan-W3），不得依赖 canonicalize。
- **FR-006a**: 增量快照 `.spectra/unified-graph.json` MUST 同步相对化：内嵌 `graph` 随 🅐 自动相对化；`metadata.projectRoot` MUST 持久化为相对标记（如 `'.'`）或剥除；`fileHashes` 的 key MUST 相对化为 POSIX 相对路径。**路径域合同（Codex plan-C3）**：快照持久化域 = 相对，运行时 IO/analyze 域 = 绝对，转换集中在明确边界（computeAllFileHashes / detectStaleFiles / expandCallers / mergeIncremental / changedFilesOverride 归一）。MUST bump `SNAPSHOT_WRAPPER_VERSION`（升版同步 CLI index 产出、incremental merge 校验、既有 fixture——Codex plan-W5）；快照加载 MUST 提供带原因 API（`loadSnapshotDetailed` → `{snapshot, reason}`，Codex plan-C4），`IncrementalFallbackReason` 扩展 `'snapshot-format-stale'`（区别于 `'no-snapshot'`）→ 安全退化为 full reindex，不静默产生错误增量。

#### 🅑 bootstrap
- **FR-007**: bootstrap 钩子 MUST 在新 worktree 缺图且存在可用源（主仓 `specs/_meta/graph.json` + `.spectra/unified-graph.json`，或共享缓存）时，以 **copy-if-absent 原子语义**将图**与快照**置入 worktree。MUST NOT 复用现有 `COPY_TARGETS`（其每次 sync `cp -p` 覆盖，会写穿 worktree 本地增量后的图——Codex W4）；需独立 `copy_if_absent_atomic` 分支：目标已存在真实图则跳过。
- **FR-008**: bootstrap 钩子 MUST 在无可用源时不报错、明确提示构建命令，且不留下损坏的半成品图（idempotent，可重复执行）。
- **FR-009**: bootstrap copy 时 MUST 记录源图对应的 **commit hash**（写入 worktree 侧 sidecar，如 `specs/_meta/.graph-source-commit`）。**bootstrap 重跑或保活 hook 触发时**若 worktree HEAD ≠ 记录值 MUST 提示「图可能 stale，建议增量更新或重建」——**不阻断**（stale 图仍优于无图；增量保活会逐步收敛）。查询期 per-tool stale warning 需要统一 tool-warning 返回合同，列**二期**（Codex plan-W6：`GraphQueryEngine.loadFromFile` 当前无 sidecar/HEAD 检查路径）。SC-001 验收增加「源 commit ≠ worktree commit 时 bootstrap 给出 stale 提示，不静默返回错误 commit 的图」。
- **FR-010**: graph.json **不入库**（裁决）。论据：体量大（主仓实测 11.6MB）随代码频变 → git 历史膨胀 + diff 噪声；属派生产物（源码+batch 可重建），违反「派生产物不入库」惯例；bootstrap copy + 增量保活已覆盖「开箱可用」，无需入库。保持 `.gitignore:71 specs/_meta/` 不变。

#### 🅒 保活
- **FR-011**: 系统 MUST 提供激活增量保活的明确路径：激活 `spectra install --git`（post-commit 增量）或文档化 `spectra watch` 用法。
- **FR-012**: 增量保活 MUST 复用 F175 增量链（`incremental.ts`），改代码 commit 后图反映新状态。

#### 🅓 性能
- **FR-013**: 系统 MUST 产出 code-only 构建路径的 profiling 根因诊断报告（CPU 11% 空等定位）。
- **FR-014**: 性能修复 MUST NOT 触碰 F182 在飞的增量语义文件（`delta-regenerator.ts` / `regen-plan.ts` / `batch-orchestrator.ts`）；若根因落在这些文件，记录发现并分流，等 F182 ship 后处理。

#### 回归护栏
- **FR-015**: 现有 4157+ vitest 用例 MUST 全绿；`npm run build` / `npm run repo:check` MUST 零错误。
- **FR-016**: F179/F180 byte-stable gate MUST 全绿，并**新增**「同 commit 跨 worktree byte 一致」断言。断言范围 MUST 覆盖**所有持久化路径字段**（Codex W1 + plan-C5/W4 修正清单）：graph.json 的 node.id / edge.source / edge.target / metadata.sourcePath / metadata.sourceFile / metadata.sourceTarget / hyperedge 节点引用（GraphNode 无顶层 filePath），以及快照 `.spectra/unified-graph.json` 的 fileHashes key / 内嵌 graph 的 UnifiedNode.id/filePath 与 UnifiedEdge.source/target / metadata.projectRoot；MUST 排除已知时间戳字段（generatedAt 等）与 external 节点（FR-004）。写入边界 MUST 有 portable 守卫 tripwire（writeKnowledgeGraph 内扫描绝对路径，测试态断言 0 违例——覆盖 CLI graph/community 不经 normalize 的写盘路径）。
- **FR-017**: F180 的 44 个 17-工具 E2E 用例 MUST 零回归。

### Key Entities

- **UnifiedNode**: 图节点（module / symbol）。关键字段 `id`、`filePath`——本 feature 将其路径部分从绝对改为相对 projectRoot 的 POSIX 路径。
- **UnifiedEdge**: 图边（calls / depends-on）。关键字段 `source`、`target`——同样相对化。
- **graph.json**: 图序列化产物（`specs/_meta/graph.json`，gitignored）。bootstrap 的 copy 单元；byte 一致性的校验对象。
- **bootstrap 源**: 主仓 `specs/_meta/graph.json` 或共享缓存 `~/.spectra-graph-cache/<repo>/`（仿 `~/.spectra-baselines` 先例）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在一个全新 worktree（无 graph.json）执行 bootstrap 后，`impact` / `context` 立即可用，**无需跑 batch**——验收 US1。
- **SC-002**: 同一 commit 的两个不同路径 worktree 各自构建的 graph.json **与快照**，全部持久化路径字段（FR-016 列举范围）为相对 POSIX 路径，且（排除时间戳 + external 后）byte 一致——验收 US2。
- **SC-003**: 17 个 MCP 工具在新相对 id 格式下零回归（F180 的 44 个 E2E 用例全绿）+ 产出逐工具 canonicalize/相对 id/stale 矩阵——验收 US2。
- **SC-004**: bootstrap（含快照）后的 worktree，改一个 src 文件 commit 后，`buildIncremental` **走增量路径（fallbackToFull=false）**、图更新且查询反映新状态；快照缺失/旧格式时明确退化 full reindex 并记 fallbackReason——验收 US3。
- **SC-005**: 产出 code-only 27.5min 构建的 profiling 根因诊断报告；若修复在 scope 内，给出量化前后对比——验收 US4。
- **SC-006**: Codex 阶段性对抗审查 critical 全修。
- **SC-007**: 现有 4157+ vitest + build + repo:check 全绿（FR-015）。

## 范围与非目标

**In scope**（全量，含快照可移植 — 用户 2026-06-13 裁决）: 🅐 id 相对化（写入侧 graph + **快照** + 查询侧兼容 + 加载期 stale 检测）、🅑 bootstrap 钩子（copy graph.json **+ 快照** + commit sidecar）、🅒 保活激活/文档化（依赖可移植快照真增量）、🅓 profiling 诊断（修复视规模）、新增跨 worktree byte 一致断言（含快照字段）、快照 schema 升版 + 旧快照兼容。

**Out of scope（移交备忘）**:
- `regen-plan.ts::resolveSourceTarget` call 边 recall 缺口（grep 实测 2 个调用方，impact 报 0）→ graph-accuracy 域，留给 F191 全期 review。
- F182 增量语义文件的任何改动。
- 大项目（500+ 文件）bootstrap 性能专项。
