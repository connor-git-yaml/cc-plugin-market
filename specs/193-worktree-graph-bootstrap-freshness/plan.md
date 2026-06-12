# Implementation Plan: worktree graph 开箱可用 + 增量保活

**Branch**: `193-worktree-graph-bootstrap-freshness` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Mode**: spec-driver-story

## Summary

四组改动按依赖排序：🅐 id 相对化（前提）→ 🅑 bootstrap copy → 🅒 保活激活 → 🅓 性能诊断。核心技术决策：**在上游 source 构建处（`buildUnifiedGraph`，持有 `projectRoot`）将节点/边 id 的路径部分相对化为 POSIX 相对路径**，使 id 在进入 `graph-builder.buildKnowledgeGraph` 与 `normalizeGraphForWrite` 的排序之前就已相对化。该决策由硬约束反推得出（见下「关键架构决策」），可同时满足 byte-stable + 不触碰 F182 护栏文件。

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20.x+
**Primary Dependencies**: 现有 knowledge-graph / panoramic/graph / mcp / cli 模块；vitest
**Storage**: `specs/_meta/graph.json`（gitignored）；可选共享缓存 `~/.spectra-graph-cache/<repo>/`
**Testing**: vitest（现有 4157+ 用例 + F179 byte-stable + F180 44 E2E）
**Project Type**: single（spectra CLI + MCP server）
**Performance Goals**: bootstrap copy 路径 < 数秒（绕开首次构图）；profiling 量化 code-only 27.5min 根因
**Constraints**: 不得修改 `delta-regenerator.ts` / `regen-plan.ts` / `batch-orchestrator.ts`（F182 在飞）；byte-stable 全绿 + 跨 worktree byte 一致

## 关键架构决策

### 决策 1：id 相对化插入点 = 上游 source 构建处（不动护栏文件）

**调用链实测**:
- `batch-orchestrator.ts:1367` 调 `buildKnowledgeGraph({unifiedGraph, docGraph, ...})`
- `batch-orchestrator.ts:1567` 调 `normalizeGraphForWrite(graphJson, {stripTimestamps:true})` —— **此函数按 `node.id` 字典序排序 nodes、按 `source+target+relation` 排序 links**（graph-builder.ts:567-572）
- `batch-orchestrator.ts:1570` 调 `writeKnowledgeGraph(graphJson, outputDir)`

**约束推导**（plan 轮 Codex W1/W2 修正后）:
1. **首要论据**：持久化值本身必须 portable——id 字符串内嵌 worktree 绝对前缀，即使两个 worktree 排序结果完全相同，文件内容也已不同，byte 一致天然不成立。排序漂移只是混合 source/external 场景下的次级风险（Codex plan-W2 修正：不再以"排序漂移"为主论证）。
2. **插入点约束**：`normalizeGraphForWrite` 在 graph-builder.ts（**非护栏文件，本可以改**——Codex plan-W1 修正了上一版"patch normalize = 碰 batch-orchestrator"的错误推理）。真正的障碍是：batch 调用形态为 `normalizeGraphForWrite(graphJson, {stripTimestamps:true})`（batch-orchestrator.ts:1567），签名里**没有 projectRoot**，补传参数必须改 batch-orchestrator 调用点 → 违反 F182 护栏。且 CLI `graph` / `community` 写盘路径根本不经过 normalizeGraphForWrite（graph.ts:192-198、community.ts:89-100 直接 `writeKnowledgeGraph`）。
3. **结论**：相对化放 **producer 侧**（各 source 构建处，天然持有 projectRoot）；写入边界放一个**无需 projectRoot 的 portable 守卫**（决策 1d）兜底全部五路 source 与全部三条写盘路径。
4. **事实注记（2026-06-13 设计期间）**：F182 已 ship 到 master（a56346c），"在飞冲突"护栏转为软约束。但本决策**不依赖**护栏成立：即使可改 batch-orchestrator 调用签名，写入点方案仍不完整——CLI graph/community 两路不经 normalizeGraphForWrite，且快照域（.spectra/unified-graph.json，不走 writeKnowledgeGraph）需要 producer 侧相对化。producer 侧 + 写入守卫的组合按自身论据成立。F182 ship 同时意味着：🅓 profiling 若指向 batch 核心，修复可不再强制分流（implement 阶段按发现规模与用户确认定）。

**改点**（plan 轮 Codex C1 修正：覆盖 calls 边）:
- `src/knowledge-graph/index.ts`：**不**逐个改 derive 函数，而是在 `buildUnifiedGraph` 出口对装配完的 `{nodes, edges}` 做**统一相对化 pass**，覆盖全部四条值来源：`deriveNodesFromSkeletons` 节点、`resolveCalls` 产生的 **calls 边**（call-resolver.ts:409-420 用 `${cs.callerFile}::...` 作 source，238/250/297 直接拼绝对 target——上一版遗漏，Codex plan-C1）、`deriveImportEdges` 边、`preBuiltNodes` 注入路径。`call-resolver.ts` 本身零改动（出口 pass 全覆盖其输出）。`metadata.projectRoot`（line 61）持久化为 `'.'`。
- 抽取共享 helper `relativizePosix(absPath, projectRoot)`（放 `src/knowledge-graph/` 或 `src/utils/`），统一 strip 前缀 + POSIX 化 + external 策略（FR-004：projectRoot 外保留绝对 + `external:true`），供所有 source 构建处复用。symbol id 结构分隔符（`::` / `.`）保持不变，仅相对化路径前缀部分。
- **枚举其余 source 的 id 形态**（tasks T001 审计）：docGraph spec 节点 id = `specPath`（graph-builder.ts:143）、architectureIR element id、crossReferenceLinks、extraction 节点。若已是相对/逻辑名则免改；发现绝对路径则同样 producer 处相对化（见决策 1d）。

### 决策 1b：快照可移植化（Codex C1，全量范围 — 用户裁决）

F175 增量链 `buildIncremental`（incremental.ts:344-347）`loadSnapshot` 失败即 `runFullReindex`；快照 `.spectra/unified-graph.json`（persistence.ts）含内嵌 `graph: UnifiedGraph` + `fileHashes: 绝对路径→SHA-256`（persistence.ts:40）。
**改点**:
- `src/knowledge-graph/persistence.ts`：`saveSnapshot` 写 `fileHashes` 时 key 相对化为 POSIX 相对路径。内嵌 `graph` 随决策 1 自动相对化。
- **路径域合同（Codex plan-C3）**：快照**持久化域**（fileHashes key、内嵌 graph 的 node.id/filePath、edge.source/target）= repo-relative POSIX；**运行时 IO/analyze 域** = absolute。绝对↔相对转换集中在明确边界，逐一改：`computeAllFileHashes`（persistence.ts:87-99，写入时相对化 key，`_projectRoot` 参数现成未用）、`detectStaleFiles`（215-247，比对时 currentFiles 相对化后查 key + 旧 key 反查转绝对判存在性）、`expandCallers`（incremental.ts:170-189，changedFiles 与 node.filePath 匹配前转同域）、`mergeIncremental`（237-245，changedSet 与 n.filePath 同域比对）、`buildIncremental` changedFilesOverride 归一（361-364）。上一版只写了 save/compare，遗漏了增量链 3 个绝对域调用点。
- **API 形态（Codex plan-C4）**：`loadSnapshot` 当前只返回 `SnapshotWrapper | null`（persistence.ts:155），schema 不匹配仅 stdout 降级，调用方无法区分。新增 `loadSnapshotDetailed(): {snapshot: SnapshotWrapper|null, reason: 'ok'|'not-found'|'corrupt'|'format-stale'}`（旧 `loadSnapshot` 保留为薄壳）；`IncrementalFallbackReason` union（incremental.ts:287-291）扩展 `'snapshot-format-stale'`；CLI 输出透传。
- bump `SNAPSHOT_WRAPPER_VERSION`（persistence.ts:31，'1.0' → '2.0'）。**升版消费面（Codex plan-W5）**：literal version 同时被 CLI index 产出（cli/commands/index.ts:164-168 `buildSnapshotWrapper`/`saveSnapshot`）、incremental merge 后 safeParse（incremental.ts:460-462）、既有 fixture/test 的 '1.0' 字面值消费——升版任务必须同步全部三类消费方，不只 persistence 读写。
- **护栏确认**：persistence.ts / incremental.ts **不是** F182 三护栏文件（护栏仅 batch/delta-regenerator.ts、batch/regen-plan.ts、batch/batch-orchestrator.ts），可改。

### 决策 1c：加载期旧绝对图 stale 检测（Codex C2，plan-W3 修正）

`canonicalizeSymbolId`（query-helpers.ts:183-198）仅基于当前 projectRoot 构造 candidate；copy 自主仓的旧绝对 id 图前缀 ≠ 当前 worktree → 静默 not-found。且 canonicalize 对直接命中节点原样返回（161-164）、对非 projectRoot 前缀的绝对 id 无能为力——stale 检测**不得依赖 canonicalize**。
**改点**: 在 graph 加载入口（graph-query.ts `loadFromFile`/`fromJSON` 或 graph-tools lazy load）增加检测。判定规则 = node id 的 file part `path.isAbsolute()` 且 `!startsWith(当前 projectRoot)` → `graph-format-stale`。**全量扫描 node ids**（5k 节点字符串前缀检查 <10ms，无需抽样；可在命中首个违例时短路）。Codex plan-W3 否决了上一版"抽样首批"启发式：若前 N 个节点恰为相对/doc/external 形态而其余为旧绝对路径，抽样 100% 漏判。

### 决策 1d：GraphJSON 写入前 portable 合同（Codex plan-C2/C5/W1）

`buildUnifiedGraph` 只是 `buildKnowledgeGraph` **五路 source 之一**（docGraph graph-builder.ts:141-171 / architectureIR 192-234 / crossReferenceLinks 252-264 / extractionResults 284-310 / unifiedGraph 348-407）——上一版把相对化前提只放 buildUnifiedGraph 是范围遗漏。portable 路径归一化升格为 **GraphJSON 写入前合同**：

- **producer 侧**：五路 source 各自产 portable 值。代码路 = 决策 1 出口 pass；**extraction 路** = markdown-extractor.ts:222-227 / image-extractor.ts:240-246 当前把绝对 filePath 写入 `source_file`（最终落 `metadata.sourceFile`，graph-builder.ts:290-294）→ producer 处相对化（Codex plan-C5）；docGraph（specPath）/ architectureIR（逻辑 id）/ crossReferenceLinks 按 T001 审计确认（预期已相对/逻辑名，发现绝对则同样 producer 处修）。
- **写入边界守卫**：`writeKnowledgeGraph`（被 batch:1570 / cli graph.ts:198 / community.ts:99 **三路**调用——CLI 两路不经过 normalizeGraphForWrite）内置 portable 守卫：扫描 node.id / edge.source/target / `metadata.sourcePath`（graph-builder.ts:370-374 写入 ugNode.filePath）/ `metadata.sourceFile` / `metadata.sourceTarget` / hyperedge 节点引用中的绝对路径（`path.isAbsolute`，**无需 projectRoot**），发现即 warning + 计数（测试态断言为 0）。守卫是 tripwire 不做转换（转换责任在 producer），故不需要 projectRoot 也就不碰 batch-orchestrator 调用签名。
- **byte 断言字段清单修正（Codex plan-C5/W4）**：graph.json 的 `GraphNode` **没有顶层 filePath 字段**（graph-types.ts:53-63）——上一版/spec 初稿写"node.filePath 相对化"与 schema 不符。实际 path-like 字段 = `metadata.sourcePath` / `metadata.sourceFile` / `metadata.sourceTarget`；`UnifiedNode.filePath` 仅在快照域校验。

### 决策 2：external path（projectRoot 之外）策略 — 解决 spec FR-004 NEEDS CLARIFICATION

**裁决：保留绝对路径 + 标记 `external: true` metadata，不产生 `../` 越界链。**
- 理由：`../../..` 相对链会内嵌 worktree 目录层级深度，跨不同深度的 worktree 不一致；而 node_modules / 跨仓绝对引用本就跨机器不可移植，强行相对化无意义。保留绝对 + 标记，让查询侧明确这是 external（F174 canonicalize 已能处理绝对形态）。
- byte 一致影响：external 节点的绝对路径在不同 worktree 不同 → 会破坏 byte 一致。**故 SC-002 的 byte 一致断言限定在「projectRoot 内节点」**；external 节点单独计数核对（数量 + 相对语义一致即可）。tasks 阶段需在断言里显式排除 external。

### 决策 3：stale 校验粒度 — 解决 spec FR-009 NEEDS CLARIFICATION

**裁决：bootstrap copy 时记录源图对应的 commit hash（写入 worktree 侧 sidecar `specs/_meta/.graph-source-commit`），bootstrap 重跑 / 保活 hook 触发时若 worktree HEAD ≠ 记录值则提示 "图可能 stale，建议增量更新或重建"，不阻断。**
- 理由：commit hash 比 mtime 可靠；不阻断符合 dogfooding「开箱即用」体验（stale 图仍比无图强）；增量保活（🅒）会逐步收敛到当前 commit。
- **集成点收敛（Codex plan-W6）**：MVP 的 stale 提示只在 bootstrap 脚本与保活 hook 两个 shell 触点实现；**查询期 per-tool warning 列二期**——`GraphQueryEngine.loadFromFile` 当前没有 sidecar/HEAD 检查路径（graph-query.ts:222-242），加查询期提示需要先定义统一的 tool-warning 返回合同，超出本 feature 范围。

### 决策 4：graph.json 是否入库 — 解决 spec FR-010

**裁决：不入库。** 论据：
1. 体量大（主仓实测 11.6MB），频繁随代码变更 → git 历史膨胀 + 每次 diff 噪声巨大。
2. 即便 id 相对化后可移植，graph.json 仍是**派生产物**（可由源码 + batch 重建），入库违反「派生产物不入库」惯例（参 CLAUDE.local.md baseline fixture 边界）。
3. 替代方案更优：bootstrap 从主仓/共享缓存 copy（🅑）+ 增量保活（🅒）已覆盖「开箱可用」需求，无需入库。
- 保留 `.gitignore:71 specs/_meta/` 不变。

### 决策 5：bootstrap 钩子落点

- 在 `scripts/sync-worktree-local-state.sh` 新增**独立 `copy_if_absent_atomic` 分支**（不复用 COPY_TARGETS——其每次 `cp -p` 覆盖会写穿 worktree 本地增量图，Codex W4）。copy 单元 = `specs/_meta/graph.json` **+ `.spectra/unified-graph.json` 快照**（决策 1b）。
- copy 用临时文件 + rename 原子写，避免与 post-commit 增量竞态产生半成品。
- 源优先级：worktree 无图时 → 主仓 `specs/_meta/graph.json` + `.spectra/unified-graph.json` → 共享缓存 `~/.spectra-graph-cache/<repo>/`（可选，二期）→ 均无则提示构建命令。
- copy 后写 `specs/_meta/.graph-source-commit` sidecar（决策 3）。
- idempotent：目标已有真实图/快照则跳过（copy-if-absent，不覆盖 worktree 本地增量）。

### 决策 6：保活激活方式（🅒）

- 文档化 `spectra install --git`（已存在 `src/cli/commands/install.ts` + `git-hook-installer.ts`）+ `spectra watch` 用法，写入 README / docs。
- 不默认强制激活（避免对未预期用户产生 git hook 副作用）；提供一条 worktree bootstrap 后的可选激活提示。

### 决策 7：性能诊断（🅓）

- 仅做 profiling + 根因诊断报告（不在本 feature 改 batch 核心）。
- 若根因落在 `batch-orchestrator.ts` 等护栏文件 → 记录发现，分流为 F182 ship 后的独立 fix，符合 FR-014。
- 产出 `verification/perf-profiling-report.md`。

## Project Structure

### 改动文件清单（预估）

```text
src/knowledge-graph/index.ts            # 🅐 buildUnifiedGraph 出口统一相对化 pass（覆盖 calls/imports/nodes/preBuiltNodes）+ metadata.projectRoot
src/knowledge-graph/<relativize helper> # 🅐 共享 relativizePosix helper（新增，含 external 策略）
src/knowledge-graph/persistence.ts      # 🅐 fileHashes key 相对化 + 域转换 + loadSnapshotDetailed + VERSION bump（C1/C3/C4）
src/knowledge-graph/incremental.ts      # 🅐 expandCallers/mergeIncremental/override 域转换 + fallbackReason 扩展（C3/C4，非护栏）
src/knowledge-graph/query-helpers.ts    # 🅐 查询侧兼容核对（F174 已大体就绪，按需微调）
src/panoramic/graph/graph-query.ts (或 graph-tools lazy load)  # 🅐 加载期 graph-format-stale 全量扫描检测（C2/W3）
src/panoramic/graph/graph-builder.ts    # 🅐 writeKnowledgeGraph portable 守卫 + 其余 source 按 T001 审计（1d）
src/panoramic/extractors/markdown-extractor.ts  # 🅐 source_file 相对化（plan-C5）
src/panoramic/extractors/image-extractor.ts     # 🅐 source_file 相对化（plan-C5）
src/cli/commands/index.ts               # 🅐 快照升版消费面核对（plan-W5，预期零改动或微调）
scripts/sync-worktree-local-state.sh    # 🅑 graph + snapshot bootstrap copy-if-absent-atomic + sidecar
docs / README                           # 🅒 保活激活文档 + 17 工具 canonicalize 矩阵（W5）
tests/unit/graph/graph-builder-bytestable.test.ts  # 🅐 更新 + 新增跨 worktree byte 一致断言（字段清单见 1d）
tests/integration/mcp-server-stdio.test.ts (F180)  # 🅐 17 工具 E2E 回归（应零改动通过）
tests/<new>/worktree-bootstrap.test.ts  # 🅑 bootstrap 钩子测试（含 copy-if-absent 不覆盖）
tests/<new>/snapshot-portability.test.ts # 🅐 快照相对化 + 旧快照 stale 退化 + 域转换测试
specs/193-.../verification/perf-profiling-report.md # 🅓 性能诊断报告
specs/193-.../verification/mcp-tools-canonicalize-matrix.md # 🅐 W5 逐工具矩阵
specs/193-.../verification/id-source-audit.md       # 🅐 T001 五路 source id 形态审计
```

**禁改**: `src/batch/delta-regenerator.ts`、`src/batch/regen-plan.ts`、`src/batch/batch-orchestrator.ts`（F182 护栏）。注：`src/knowledge-graph/incremental.ts`、`persistence.ts`、`src/panoramic/graph/graph-builder.ts`（normalizeGraphForWrite 所在文件）**均不在**护栏内，可改——护栏约束的是 batch-orchestrator **调用点签名**不能动，不是 graph-builder 函数本身。

## Constitution Check

- 原则 VIII（修改 src/ 源码）：本 feature 经 spec-driver 流程，合规。
- 原则 IX（新增运行时依赖）：无新增运行时依赖（zod symlink 仅为本地工具链补丁，不入库）。
- 原则 X（绕过质量门）：不绕过，全量 vitest + build + repo:check + byte-stable gate。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| id 相对化分散到多个 source 构建处 | F182 硬护栏禁止在 batch choke point 插入相对化 | 单点（normalizeGraphForWrite / buildKnowledgeGraph 入参）方案需改 batch-orchestrator → 违反 F182 护栏 + merge 冲突风险 |
| external 节点排除出 byte 一致断言 | external 绝对路径跨机器/worktree 本就不可移植 | 强行相对化产生 `../` 越界链，跨不同深度 worktree 反而不一致 |
