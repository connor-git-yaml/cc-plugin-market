---
type: spec-review
feature: 101-graph-persistence
date: 2026-04-12
---

# Spec 合规审查

## AC 逐项检查

### AC-101-01：置信度字段向后兼容

- [x] 通过
- 证据：`src/panoramic/models/architecture-ir-model.ts` L62–65，`confidence?: ConfidenceLevel` 和 `confidenceScore?: number` 均为可选字段，旧数据缺失时值为 `undefined`，无运行时强校验。

---

### AC-101-02：置信度映射正确性

- [x] 通过
- 证据：`src/panoramic/graph/confidence-mapper.ts`
  - `mapDocConfidence`：`'high'→EXTRACTED`、`'medium'→INFERRED`、`'low'→AMBIGUOUS` ✓
  - `CONFIDENCE_SCORES`：`EXTRACTED=0.95`（≥0.9）、`INFERRED=0.65`（0.5–0.8）、`AMBIGUOUS=0.25`（≤0.4）✓
  - `mapEvidenceConfidence`：`>=3→EXTRACTED`、`>=1→INFERRED`、`<1→AMBIGUOUS` ✓
  - `DocGraphReference` 和 `CrossReferenceLink` 共用 `mapEvidenceConfidence` ✓

---

### AC-101-03：图构建输出格式

- [x] 通过（静态结构符合，NetworkX 兼容性未自动验证）
- 证据：`src/panoramic/graph/graph-builder.ts` L281–298，`GraphJSON` 含 `directed`（boolean）、`nodes`（含 id/kind/label/metadata）、`links`（含 source/target/relation/confidence/confidenceScore）、`graph.nodeCount === nodes.length`（L284）、`graph.edgeCount === links.length`（L285）✓
- **潜在问题**：`links` 数组使用 `filteredEdges`（悬空边已过滤），而 `graph.edgeCount` 赋值为 `links.length`（L285），两者一致 ✓。但 Python 端 NetworkX 兼容测试无法通过代码静态确认。

---

### AC-101-04：节点去重

- [✗] **不满足**——合并 metadata 要求未实现
- 问题：spec 要求"合并后的 metadata 包含所有数据源中该节点的非空 metadata 字段"，但实现采用纯 last-write-wins（`nodeMap.set(id, node)` 直接覆盖），未做跨数据源 metadata 合并。
- 证据：`src/panoramic/graph/graph-builder.ts` L163–165：`nodeMap.set(element.id, node)` 直接覆盖，DocGraph 节点的 metadata（如 `confidence`、`relatedFiles`）在 ArchitectureIR 覆盖后丢失。

---

### AC-101-05：graph.json 原子写入

- [x] 通过
- 证据：`src/panoramic/graph/graph-builder.ts` L316，`writeAtomicJson(graphJsonPath, graphJson)` 直接复用 Feature 100 的原子写入工具，写入路径为 `{outputDir}/_meta/graph.json`（L314）。原子性由 `.tmp` 临时文件机制保证。

---

### AC-101-06：batch 集成

- [✗] **部分不满足**——`architectureIR` 未注入 batch 流程
- 问题 1：`src/batch/batch-orchestrator.ts` L586–589，`buildKnowledgeGraph` 调用仅传入 `docGraph` 和 `crossReferenceLinks`，**未传 `architectureIR`**。spec L147、L588 明确要求三个数据源参与 batch 图构建。`architecture-ir` 数据源在 batch 时被 graceful skip（写入 `skippedSources`），导致 batch 产出的图谱缺失 IR 节点和关系。
- 问题 2：注入时机在 L575–595（spec render 写盘之后），晚于 docs-bundle（L667–677）。spec AC-101-06 要求"docs-bundle 完成之后，quality report 之前"，但实际代码中 graph 在 L577，docs-bundle 在 L667，graph 注入早于 docs-bundle——与 spec 描述的时序不符。
- 证据：`batch-orchestrator.ts` L577–595 vs L667–693。

---

### AC-101-07：容错降级

- [x] 通过
- 证据：`src/panoramic/graph/graph-builder.ts` L134–135（docGraph 缺失）、L205–207（architectureIR 缺失）、L242–243（crossReferenceLinks 缺失），均追加 `skippedSources` 条目并继续构建。L128–133、L199–204、L235–239 捕获各数据源解析异常。

---

### AC-101-08：CLI 命令

- [x] 通过（接口合规，独立运行实现存在简化）
- 证据：
  - `src/cli/utils/parse-args.ts` L8：`CLICommand.subcommand` 含 `'graph'` ✓
  - `parse-args.ts` L39–42：`graphOperation?: 'build'`、`directed?: boolean` 字段已添加 ✓
  - `parse-args.ts` L177–203：graph 分支解析 `--directed`、`--output-dir`、`--help` ✓
  - `src/cli/index.ts` L21、L44、L57、L79、L145–147：import、用法行、子命令说明、`--directed` 说明、`case 'graph'` 均已添加 ✓
  - `src/cli/commands/graph.ts` L128–186：`runGraphCommand` 实现，`--help` 输出 `GRAPH_HELP` 后 return，`--directed` 通过 `command.directed` 传递，失败时 `process.exit(1)` ✓
- **潜在问题**：graph.ts 中 CLI 独立运行时 DocGraph 构建路径（L141–166）依赖 `scanStoredModuleSpecs` 动态导入，若该函数不存在会 graceful skip，但非 batch 产出的新鲜 docGraph，图谱质量依赖已有 spec 文件。这属于设计取舍，不构成 AC 违反。

---

### AC-101-09：性能指标

- [~] 无法静态验证（需运行时测试）
- 节点去重使用 `Map<string, GraphNode>`（O(1)）✓（`graph-builder.ts` L72–73）
- 悬空边过滤为线性扫描 O(n)（L248–255）✓
- 5,000 节点 / 10,000 边场景、文件大小 <5 MB、<3 秒冷启动：需单元测试 mock 数据验证，未见对应测试文件（`tests/unit/graph-builder.test.ts` 目录结构 spec 中列出但未在实现文件中确认存在）。

---

## 合规结论

**不通过**，以下 AC 存在问题：

| AC | 严重程度 | 问题 |
|----|----------|------|
| AC-101-04 | 中 | 节点去重实现为 last-write-wins，未合并跨数据源 metadata；DocGraph 节点 metadata 字段（confidence、relatedFiles 等）在被 ArchitectureIR 节点覆盖后丢失 |
| AC-101-06 | 高 | batch 流程中 `buildKnowledgeGraph` 未传入 `architectureIR`，三数据源合并实际只有两个；注入时机（L577）早于 docs-bundle（L667），与 spec 要求的"docs-bundle 之后"时序不符 |
| AC-101-09 | 低 | 对应单元测试文件未确认存在，性能边界无法验证 |
