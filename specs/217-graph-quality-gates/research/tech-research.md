# F217 技术调研 — 图质量门机器化（M9-B2）

调研模式：纯 codebase-scan（未用 WebSearch）。每条论断附 `文件:行号` 证据。

## 1. 图产物结构 — 存在三个独立产物

| 产物 | 路径 | Schema 定义 | 版本字段 |
|---|---|---|---|
| **UnifiedGraph**（构建期内存态） | 无固定落盘 | `src/knowledge-graph/unified-graph.ts:178-183` | `UNIFIED_GRAPH_SCHEMA_VERSION='1.1'`（`unified-graph.ts:214`） |
| **SnapshotWrapper**（`spectra index` 增量缓存） | `.spectra/unified-graph.json` | `src/knowledge-graph/persistence.ts:56-61` | `SNAPSHOT_WRAPPER_VERSION='3.0'`（`persistence.ts:43`） |
| **GraphJSON**（最终 MCP/CLI 消费物） | `{outputDir}/_meta/graph.json` = `specs/_meta/graph.json`（`graph-builder.ts:537`） | `src/panoramic/graph/graph-types.ts:145-189` | `graph.schemaVersion` 恒 `'2.0'`（`graph-builder.ts:471`） |

**F217 六指标的检测对象是最终 `specs/_meta/graph.json`（GraphJSON）** —— 它是 MCP 工具与用户实际消费的产物。`.spectra/unified-graph.json` 是 `spectra index` 的构建期缓存，语义不同。

### Node / Edge 字段
- `GraphNode`（`graph-types.ts:53-63`）：`id / kind / label / metadata`。kind 枚举：`module|package|component|service|spec|document|api|api-schema|event|diagram`（无 `symbol`；UnifiedGraph 的 `symbol` 映射为 `component`，`graph-builder.ts:366`）。symbol 层粒度靠 `metadata.unifiedKind==='symbol'`（`graph-builder.ts:376`）区分。
- canonical ID 格式（F214）：`<filePath>::<symbol>` 或 `<filePath>::<Class>.<member>`，解析单点 `parseCanonicalSymbolId`（`relativize.ts:113-122`）。遗留 `#` 分隔符在加载期被 `isLegacySymbolNode` 判 stale。
- Edge relation 枚举（`unified-graph.ts:101-114`）：`calls/depends-on/cross-module/contains/documents/references/conceptually_related_to/rationale_for/groups/deploys`；`calls/depends-on/cross-module/contains` 强制 `directional=true`。
- `contains` 边由 `deriveContainsEdges`（`index.ts:268-297`）产，两级：module→symbol + class→member，生产端按 `source|target|relation` 去重。
- metadata（`unified-graph.ts:165-170`）：`generatedAt/projectRoot/schemaVersion`；GraphJSON.graph（`graph-types.ts:151-179`）：`name/generatedAt/nodeCount/edgeCount/sources/inputHash?/schemaVersion`。**两处都没有 git commit 字段**；`inputHash` 在 graph-only 模式恒 `undefined`。

## 2. 写盘链路
`writeKnowledgeGraph`（`graph-builder.ts:515-541`）三段式（顺序不可颠倒）：① `scanGraphPortabilityViolations`（F193 portable 守卫，只 warn 不阻断）→ ② `normalizeGraphForWrite`（byte-stable：剥时间戳/剥 currentRun/按 id 字典序排）→ ③ `writeAtomicJson`。
graph-only 入口（F195）在 `batch-orchestrator.ts:~2490` 起：AST 采集 → `buildUnifiedGraph`（calls+depends-on+contains）→ Python `extractSymbolNodes`（独立第四路）→ `buildKnowledgeGraph`（五路合并）→ `writeKnowledgeGraph({stripTimestamps:true})`。

## 3. 六指标数据来源逐条核实

- **(a) duplicate canonical ID = 0**：数组层字面重复结构上不可能（生产端 `deriveNodesFromSkeletons` seen-Set 折叠 `index.ts:214-219` + 五路合并 `Map` 折叠 `graph-builder.ts:125`）。真正要检测的是**语义重复**：同 `file␟sym␟kind` 却生成不同 id 字符串（F214 前 `#` vs `::` 并存）。**已有复用起点**：`scripts/graph-semantic-diff.mjs --dup-check`（`:96-111`），按 `semNodeKey`（`::`/`#` 归一化 `:29-45`）分组，组内 id 数>1 判重复。**该脚本当前未接入 repo:check / package.json / CI**。
- **(b) supported symbol contains coverage = 100%**：supported symbol = `unifiedKind==='symbol'`（ExportSymbol + members，`code-skeleton.ts:13-40`）。生产端天然保证（`deriveNodesFromSkeletons` 与 `deriveContainsEdges` 共享 `symbolNodeId/memberNodeId` `index.ts:190-195`）。分子=有 contains 入边的 symbol 节点数，分母=全部 symbol 节点数。**风险点**：`preBuiltNodes` 注入路径（`index.ts:56-63`）与 Python extraction 第四路可能产生覆盖缺口 —— 门禁跑起来才会首次真实暴露。
- **(c) source symbol orphan ratio ≤ 5%**：**当前代码库零 orphan 计算逻辑，需从零实现**。orphan 建议定义=无任何非-contains 边（degree 0，真实耦合孤立）；`graph-semantic-diff.mjs couplingDegree`（`:113-129`）逐节点统计非-contains 边数，可复用为判据。"例外分类"候选：entrypoint（`main.*`/`index.*`/`__init__.py`）、纯类型声明（interface/type，常年零 caller）、测试导出。**当前无 isEntrypoint 等分类元数据**，需新增分类逻辑或路径启发式。
- **(d) dangling edge = 0**：GraphJSON 生产端已强制过滤（`graph-builder.ts:421-431` source/target 不在 nodeMap 即丢弃）。门禁是验证不变量持续成立。注意 SnapshotWrapper 无此过滤（`deriveImportEdges` `index.ts:142-165` 不校验 target），若也要查 SnapshotWrapper 需单独实现。
- **(e) ignored path / `_reference` 节点 = 0**：ignored path 在扫描期前置解决（`file-scanner.ts isIgnored :372-382`，被忽略文件从不进 codeSkeletons），门禁价值=验证扫描器配置未被绕过。**`_reference` 节点在当前代码库不存在**（grep 无命中对应 node kind）—— 需求术语与现有实体不对应，见开放问题 #1。
- **(f) freshness — 最关键**：**graph.json/UnifiedGraph metadata 目前完全不存 git commit/源码版本**（全仓 grep `gitCommit|sourceCommit|git rev-parse` 无图产物命中）。F193 的 `assertGraphFormatNotStale`（`graph-query.ts:213-239`）只检测**格式/路径漂移**（遗留 `#` 节点 + 跨 worktree 绝对路径），**完全不检测"图比工作树旧"**——内容陈旧但格式正确的图会被静默放行。加载期（格式 stale）与门禁期（内容 freshness）是**两个不同维度**。

  | 路线 | 做法 | 代价 |
  |---|---|---|
  | **A. 新增 metadata.sourceCommit** | GraphJSON.graph 加字段，写盘调 `git rev-parse HEAD` 注入；门禁比对当前 HEAD | GraphJSON schema 是 TS interface（非 zod），加字段成本低；**触发 F215 fixture 重生**；freshness 精确到 commit，graph.json 独立自足 |
  | **B. 复用 SnapshotWrapper.fileHashes** | 门禁读 `.spectra/unified-graph.json` fileHashes，`detectStaleFiles` 对当前工作树重算 | 零 schema 改动；**但 graph-only 根本不产生 SnapshotWrapper**（F195 主流路径），二者不同步 → 语义错配 + 误报/漏报，无法区分"从未建图"vs"stale" |

  **推荐路线 A**：贴合"防静默用旧图"，graph.json 是唯一需保新鲜度的产物；一次性 fixture 重生成本有 F214/F215 成熟 SOP。

## 4. F215 pinned fixture 机制
`tests/fixtures/micrograd-baseline-graph/{graph.json,README.md}`：冻结的 micrograd graph.json（33 节点/37 边），供 6 个测试（4 e2e + 2 集成）消费。生成 SOP（README:17-34）：校验源 clone commit → rsync 只读拷贝 → `batch --mode graph-only` → cp 冻结。`installRelativizedBaseline`（`tests/e2e/helpers/stdio-client.ts`）加载。skip 由 `MICROGRAD_SOURCE` 控制（不依赖网络/LLM）。
**四语言样本现状**：`tests/fixtures/multilang/{go,java,python}/` 是单文件语法样本（非可建图迷你项目）；`tests/fixtures/multilang-project/` 含 Go+Python 组织结构（**无 Java**）；`tests/fixtures/f214-mixed/` 是 TS+Python。**四语言矩阵需新建 Java 迷你项目**并确认 Go/Python 规模足够覆盖 contains/orphan/dangling 场景。

## 5. repo:check 集成点
`scripts/repo-check.mjs`（薄壳）→ `validateRepository`（`scripts/lib/repo-maintenance-core.mjs:217-318`），聚合 `{status,checks,warnings,errors}`：errors>0→fail，warnings>0→warn，否则 pass（`:313`）。`aggregateValidation`（`:171-181`）每子检查返回 `{warnings?,errors?,checks?}` + `namespaceCheck` 加前缀。当前 11 个子检查族全是 spec-driver/marketplace 元数据一致性，**graph-quality 将是首个"产品自身产物质量"维度子检查**。**必须处理 graph.json 不存在 → graceful skip（非 error 非 warning）**（干净 clone 无图）。
F214 `scripts/graph-semantic-diff.mjs`（271 行独立脚本，fail-closed）**当前未接入任何持续门禁**，`--dup-check` 是指标 (a) 最直接复用起点。

## 6. CLI 命令现状
`CLICommand.subcommand`（`src/cli/utils/parse-args.ts:8`）是扁平字符串联合（generate/batch/diff/.../graph/community/query/direction-audit/index/scaffold-kb），**无二级子命令机制**。`src/cli/index.ts:160-217` 顶层 switch dispatch。`runGraphCommand`（`graph.ts:129-206`）只做建图写盘，无 `--check` 分支。**最贴近范式=`direction-audit`**（`src/cli/commands/direction-audit.ts`）：独立子命令、读 graph.json、输出结构化 JSON（`DirectionAuditReport :43-55`）+ `--snapshot/--compare-snapshot` CI regression guard —— F217 命令的形态/输出结构/snapshot 对比的最直接先例。

## 对 plan 阶段的关键取舍建议
1. **命令形态**：新增独立顶层子命令（参照 `direction-audit`）优于给 `graph` 加 `--check`——扁平联合无二级子命令基础设施，`direction-audit` 已跑通"独立子命令+JSON+snapshot"模式且被 CI 认可。折衷可做 `graph --check`（复用文件、加载已有图不重建），但破坏"一命令一事"惯例。倾向独立子命令。
2. **freshness 路线 A**（新增 metadata.sourceCommit）优于 B——B 存在跨产物语义错配 + graph-only 不产 SnapshotWrapper。
3. **schema 改动**：只在 GraphJSON TS interface 加 `sourceCommit?`，不动 UnifiedGraph zod schema；连锁=fixture 重生 + 逐文件核对断言；`schemaVersion` 是否 bump 按团队尺度（F214 曾 bump UnifiedGraph 层，GraphJSON 层当时未联动）。
4. **repo:check 边界**：默认 warning + graph.json 缺失 graceful skip（三态）。duplicate-id / dangling-edge 这两个"生产端天然保证、恒为 0"的强不变量，可在指标定义收敛后单独升 error（非零=代码级 bug）；orphan/freshness 依赖启发式，先 warning 磨合。

## 未解决的开放问题（需 plan 前澄清）
1. **`_reference` 节点**：代码库无对应实体，需确认指 cross-reference 边 / 遗留 `#` doc-anchor / 还是超前占位符。
2. **Python extraction 第四路 vs UnifiedGraph contains 双轨风险**：graph-only 模式 Python 符号 contains 边可能双链路，需跑真实 Python 项目人工核对计数。
3. **四语言矩阵缺 Java 迷你项目**：需新建 micrograd 规模 Java 样本。
