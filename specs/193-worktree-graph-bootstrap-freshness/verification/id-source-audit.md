# T001 — graph.json 五路 source id 形态审计

**采集日期**: 2026-06-13 | **方法**: 逐路读 `src/panoramic/graph/graph-builder.ts::buildKnowledgeGraph` + 各 producer 源码

## 结论速览

| # | source | id / source / target 取值 | 形态（绝对 / 相对 / 逻辑名） | 是否需相对化 | 改点 |
|---|--------|---------------------------|------------------------------|--------------|------|
| 1 | docGraph（graph-builder.ts:141-171） | node.id = `specNode.specPath`；edge = `fromSpecPath`/`toSpecPath` | **相对**（`specs/alpha.spec.md` 形态，repo-relative） | 否 | 无 |
| 2 | architectureIR（192-234） | node.id = `element.id`（逻辑 id，如 `comp-x` / `specs/alpha.spec.md`）；edge = `sourceId`/`destinationId` | **逻辑名 / 相对** | 否 | 无 |
| 3 | crossReferenceLinks（252-264） | edge = `targetSpecPath`/`targetSourceTarget` | **相对**（spec 路径 / sourceTarget 逻辑名） | 否 | 无 |
| 4 | extractionResults（284-310） | node.id = `node.id`（`doc:<relPath>` / `diagram:<relPath>`，extractor 内已用 relPath 构造）；**但 metadata.sourceFile = `node.source_file` = 绝对 filePath** | id 相对，**sourceFile 绝对** | **是（sourceFile）** | markdown-extractor.ts:226 / image-extractor.ts:245：`source_file: filePath` → `source_file: relPath`（T011b） |
| 5 | unifiedGraph（348-407） | node.id / edge.source / edge.target 全部派生自 `codeSkeletons` 的**绝对** key | **绝对** | **是（全部）** | buildUnifiedGraph 出口统一相对化 pass（T011）；写入 graph-builder 时 `ugNode.filePath` → `metadata.sourcePath`（373）随之相对 |

## 逐路细节

### 路 1 — docGraph
- `specNode.specPath`（line 143）= repo-relative spec 路径（如 `specs/alpha.spec.md`），由 doc-graph-builder 产出。byte-stable 测试 fixture（`specs/alpha.spec.md`）印证已相对。**免改**。

### 路 2 — architectureIR
- `element.id`（line 196）是 ArchitectureIR 逻辑 id（workspace-index / container / component 等抽象 id），非文件系统绝对路径。relationship 的 `sourceId`/`destinationId` 同为逻辑 id。**免改**。

### 路 3 — crossReferenceLinks
- `targetSpecPath`（相对 spec 路径）+ `targetSourceTarget`（sourceTarget 逻辑名）。**免改**。

### 路 4 — extractionResults
- node.id：`extractMarkdown` 用 `doc:${relPath}`（markdown-extractor.ts:210，relPath = `path.relative(projectRoot, filePath)`）；`extractImage` 用 `diagram:${relPath}`（image-extractor.ts:194）。**id 已相对**。
- **但** `source_file: filePath`（markdown:226 / image:245）传入**绝对路径**，graph-builder.ts:293 写入 `metadata.sourceFile`。→ **泄漏点**，T011b 修复（producer 改用 relPath，两处 relPath 变量已存在）。

### 路 5 — unifiedGraph（主泄漏面）
- `buildUnifiedGraph`（index.ts:51-65）的所有 id 来自 `codeSkeletons` 的 map key（绝对路径，index.ts:36 注释 `absoluteFilePath → CodeSkeleton`）：
  - `deriveNodesFromSkeletons`：module id = filePath（144）；symbol id = `${filePath}::${name}`（154）；member id = `${symbolId}.${m.name}`（165）；node.filePath = filePath（148/160/169）。
  - `deriveImportEdges`：edge.source = callerFile（98）；edge.target = imp.resolvedPath（99）。均绝对。
  - `resolveCalls`（call-resolver.ts）：source = `${cs.callerFile}::...`（绝对）；cross-module target = `${target}::...`（target 来自 importIndex.aliasToTarget，绝对路径）。**未解析的 target 形如 `?::name`（非绝对，免动）**。
  - graph-builder 注入第五路时把 `ugNode.filePath` 写入 `metadata.sourcePath`（373）。
- **修复**：T011 在 buildUnifiedGraph 出口对装配完的 `{nodes, edges}` 做统一相对化 pass，覆盖以上全部。`call-resolver.ts` 零改动（出口 pass 全覆盖其输出）。`metadata.projectRoot` 持久化为 `'.'`。

## 写入边界守卫（T012 / 决策 1d）

producer 侧相对化后，`writeKnowledgeGraph` 内置 portable 守卫 tripwire（path.isAbsolute 扫描 node.id / link.source/target / metadata.sourcePath/sourceFile/sourceTarget / hyperedge 节点引用），发现绝对路径 → console warning + 计数返回。守卫不转换（转换责任在 producer），故无需 projectRoot，不碰 batch-orchestrator 调用签名。覆盖 CLI graph/community 两条不经 normalizeGraphForWrite 的写盘路径。

## external 边界（FR-004 / 决策 2）

projectRoot 之外的路径（node_modules / 跨仓绝对引用）由 `relativizePosix` 保留绝对原样并由调用方在节点 metadata 标 `external: true`，不产生 `../` 越界链。守卫扫描时 external 节点仍会因绝对 id 触发警告——T012 守卫对带 `external` 标记的节点豁免计数（仅 producer 侧 unifiedGraph 节点能标 external；其余四路本就相对）。
