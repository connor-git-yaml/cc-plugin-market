# Feature 156 — Tech Research（codebase-scan）

[独立模式] 本次技术调研未参考产品调研结论，基于需求描述和 codebase 直接扫描执行。

---

## 1. 现状盘点

### 1.1 UnifiedGraph 已 ship 的 schema 与入口

**文件**：`src/knowledge-graph/unified-graph.ts` + `src/knowledge-graph/index.ts`

- **schemaVersion**：`'1.0'`（常量 `UNIFIED_GRAPH_SCHEMA_VERSION`，`unified-graph.ts:203`）
- **顶层结构**：`UnifiedGraph = { nodes: UnifiedNode[], edges: UnifiedEdge[], metadata: { generatedAt, projectRoot, schemaVersion } }`
- **节点 kind**：`module | package | component | service | spec | document | api | api-schema | event | diagram | symbol`
- **边 relation**：`calls | depends-on | cross-module | contains | documents | references | conceptually_related_to | rationale_for | groups | deploys`
- **directional 合同**：`calls / depends-on / cross-module / contains` 强制 `directional=true`，违反则 Zod superRefine 报错
- **主入口**：`buildUnifiedGraph(input: BuildUnifiedGraphInput): UnifiedGraph`（`index.ts:51`）
  - 输入：`{ projectRoot, codeSkeletons: ReadonlyMap<string, CodeSkeleton>, preBuiltNodes? }`
  - 同时产出 `calls` 边（call-resolver）+ `depends-on` 边（`deriveImportEdges`）
- **单例 cache**：`setCurrentUnifiedGraph` / `getCurrentUnifiedGraph`（DI 机制，batch-orchestrator 调用后 panoramic 阶段使用）
- **import 边来源**：`deriveImportEdges(codeSkeletons)`，遍历 `CodeSkeleton.imports[].resolvedPath`（`index.ts:81`）

### 1.2 DependencyGraph 当前 API 与源文件

两个文件职责不同：

| 文件 | 职责 |
|------|------|
| `src/models/dependency-graph.ts` | Zod schema 定义（`GraphNodeSchema`, `DependencyEdgeSchema`, `SCCSchema`, `DependencyGraphSchema`）|
| `src/graph/dependency-graph.ts` | 运行时构建（使用 dependency-cruiser 的 `cruise()`，TS/JS 专用）|

**DependencyGraph 字段**（`models/dependency-graph.ts:75-86`）：
```
projectRoot: string
modules: GraphNode[]          // { source, isOrphan, inDegree, outDegree, level, language? }
edges: DependencyEdge[]       // { from, to, isCircular, importType }
topologicalOrder: string[]
sccs: SCC[]
totalModules: number
totalEdges: number
analyzedAt: string (datetime)
mermaidSource: string
```

**构建入口**：
- TS/JS：`buildGraph(projectRoot, options)` → `src/graph/dependency-graph.ts:56`（依赖 dependency-cruiser）
- 非 TS/JS：`buildDirectoryGraph(files, projectRoot, skeletons)` → `src/graph/directory-graph.ts:29`（import 推断）
- Python：`PythonAdapter.buildDependencyGraph()` → `src/adapters/python-adapter.ts:224`（自研 basename map）

### 1.3 17 个 consumer 分类（按改造难度）

改造为消费 UnifiedGraph 时，所有 `depends-on` 边可替代现有 `DependencyEdge`（`from/to` 对应 `source/target`）；`GraphNode.inDegree / outDegree / level` 需在 shim 层从 UnifiedGraph 邻接表重算。

| File | 用法摘要 | 改造类型 |
|------|---------|---------|
| `src/graph/dependency-graph.ts` | 产出方，使用 dependency-cruiser 构建 DependencyGraph；TS/JS 路径 | **rewrite**（调用 `buildUnifiedGraph` + 派生 DependencyGraph 兼容视图，或直接删除） |
| `src/graph/directory-graph.ts:29` | 产出方，CodeSkeleton import 推断构建；非 TS/JS 路径 | **rewrite**（同上，改为从 UnifiedGraph `depends-on` 边派生） |
| `src/graph/topological-sort.ts:32` | `detectSCCs(graph)` + `topologicalSort(graph)` 消费 `graph.modules` / `graph.edges` | **shape-map**（需要 shim 从 UnifiedGraph 边重组 `modules/edges` 结构传入） |
| `src/graph/mermaid-renderer.ts:61` | `renderDependencyGraph(graph)` 遍历 `graph.modules` + `graph.edges` | **shape-map**（同上，或直接新写 `renderUnifiedGraph`） |
| `src/models/dependency-graph.ts` | 源文件，仅 Zod schema | **删除**（shim 完成后删除） |
| `src/adapters/language-adapter.ts` | 接口定义 `buildDependencyGraph?(): Promise<DependencyGraph>` | **shape-map**（接口改为返回 UnifiedGraph 或删除该方法） |
| `src/adapters/index.ts` | re-export `DependencyGraphOptions` | **trivial**（改 re-export 类型） |
| `src/adapters/ts-js-adapter.ts:22` | 实现 `buildDependencyGraph` 委托给 `buildGraph` | **rewrite**（改委托 `buildUnifiedGraph`） |
| `src/adapters/python-adapter.ts:224` | 实现 `buildDependencyGraph`，自研 basename map 扫描 | **rewrite**（逻辑已有，改输出 UnifiedGraph 或派生） |
| `src/panoramic/builders/doc-graph-builder.ts:100` | `BuildDocGraphOptions.dependencyGraph: DependencyGraph` 参数贯穿 spec 节点解析 | **shape-map**（入参改为 UnifiedGraph + shim 适配器） |
| `src/panoramic/generators/cross-package-analyzer.ts:48` | 构建包级 `DependencyGraph` + 传入 `detectSCCs` / `topologicalSort` | **shape-map**（包级图结构较简单，改为直接构造 UnifiedGraph 子图） |
| `src/generator/index-generator.ts:29` | `identifyCrossCuttingConcerns(graph)` 遍历 `graph.modules.inDegree` + `graph.edges` | **shape-map**（需要 inDegree 计算，从 UnifiedGraph 邻接表派生） |
| `src/cli/commands/graph.ts` | 不直接消费 DependencyGraph（使用 panoramic graph builder 路径） | **trivial**（检查 import 是否有残留引用） |
| `src/batch/delta-regenerator.ts:48` | `options.dependencyGraph: DependencyGraph`，消费 `edges[].from/to` 判定依赖传播 | **shape-map**（from/to → source/target，只需字段映射） |
| `src/batch/module-grouper.ts:8` | `groupFilesToModules(graph, options)` 遍历 `graph.modules/edges` | **shape-map**（遍历 UnifiedGraph `depends-on` 边 + 重算节点度数） |
| `src/batch/batch-orchestrator.ts:423` | `buildGraphForLanguageGroup` 调用 `adapter.buildDependencyGraph()`，得到 `mergedGraph: DependencyGraph` | **rewrite**（核心 pipeline 路径，改为 `buildUnifiedGraph` + 派生兼容视图或直接传 UnifiedGraph） |
| `src/knowledge-graph/unified-graph.ts` | 文件注释引用 DependencyGraph shim 说明（`unified-graph.ts:14`） | **trivial**（更新注释） |

**改造分布**：trivial 3 个 / shape-map 8 个 / rewrite 6 个

**关键阻断**：`batch-orchestrator.ts` 是最核心的 rewrite，几乎所有 shape-map 类 consumer 都从这里拿到 `mergedGraph`；如果 orchestrator 先完成改造，下游 consumer 可以按新接口顺序改。

### 1.4 现有 git diff / file watcher / cache 设施

**file watcher**：
- `src/watcher/file-watcher.ts` — 封装 chokidar v4（`package.json:chokidar: ^4.0.3`），带 debounce + .gitignore 过滤 + 变更分类（code/docs/config）
- `src/cli/commands/watch.ts` — 现有 `spectra watch` 命令，监听文件变更触发 `spectra batch --incremental`
- `FileWatcher` 类对外暴露 `FileChangeEvent.path`（绝对路径）— 可直接用于 incremental indexing 触发

**git diff helper**：未找到独立的 git diff 工具函数。`src/cli/commands/watch.ts` 用 `execSync('pgrep -f "spectra batch"')` 做进程检查，没有调用 `git diff`。incremental.ts 需要自建 `execSync('git diff --name-only HEAD')` 或 `git diff --name-only ORIG_HEAD HEAD`（post-commit hook 上下文）。

**cache / checkpoint 设施**：
- `src/batch/checkpoint.ts` — `specs/.spectra-checkpoint.json`（原子写入），批量生成断点恢复
- `tests/baseline/` — perf anchor fixture 目录（入库的 JSON，不用于运行时 cache）
- 无现有 `.spectra/` 目录约定；`.gitignore` 中看到 `specs/_meta/`（不入库）、`specs/.spectra-checkpoint.json`（不入库）

**snapshot 落地点建议**（基于约定推断）：
- `specs/_meta/unified-graph-snapshot.json`（不入库，遵循 `_meta/` 惯例）
- 或 `.spectra-snapshot.json`（与 checkpoint 同级），加入 `.gitignore`

---

## 2. 设计决策已锁定的事实

1. **不引入 sqlite**：`package.json engines.node >= 20`，sqlite 留给 Node 22 LTS 升版后的 Feature（Feature 151 verification report §仍待 follow-up 第 1 条明确决议不是"Feature 156"，而是另一 Feature）
2. **JSON snapshot 格式**：schema 镜像 UnifiedGraph（已有 Zod schema，`UnifiedGraphSchema`，直接序列化）
3. **不动 schema / adapter / call-resolver**：`unified-graph.ts` + `call-resolver.ts` + mapper 层冻结
4. **DependencyGraph shim 策略**：Feature 151 Codex Plan C-1/C-2 决议 — `buildDependencyGraph` 内部从 CodeSkeleton 直接派生（不依赖全局 cache），shim 完成后删除 `src/models/dependency-graph.ts`
5. **worktree 现状**：branch `claude/musing-dewdney-c4018f`，base `761488f`（master），干净状态
6. **17 consumer 中 `src/knowledge-graph/unified-graph.ts` 实际是注释引用**，不是真正的消费方（已确认只有 `unified-graph.ts:14` 注释描述 shim 方向）

---

## 3. 风险与待澄清点

**风险 A（HIGH）：batch-orchestrator.ts 是核心阻断点**
- `mergedGraph: DependencyGraph` 被 delta-regenerator / module-grouper / delta-report 全链路消费
- 如果 orchestrator 改为返回 `UnifiedGraph`，下游 `DeltaRegeneratorOptions.dependencyGraph` + `groupFilesToModules` 都需同步改
- 建议：先在 orchestrator 内部保留 DependencyGraph 派生视图作为临时 shim，再逐步替换下游

**风险 B（MEDIUM）：topologicalSort + detectSCCs 需要 DependencyGraph 字段**
- `src/graph/topological-sort.ts:32` 使用 `graph.modules.map(m => m.source)` + 邻接表
- UnifiedGraph 没有 `modules` 字段（只有 `nodes`），且 `nodes` 含 symbol 级节点，不只是 module 级
- 需要在 shim 层过滤 `kind === 'module'` 节点 + 过滤 `relation === 'depends-on'` 边，重建结构
- `inDegree / outDegree / level` 需重算（UnifiedGraph 边只有 source/target，没有聚合度数）

**风险 C（MEDIUM）：incremental indexing 的 "changed files + direct callers" 范围定义**
- git diff 只给 changed files，但 call-resolver 的 `Stage 3 cross-module` 依赖 caller import 表
- 如果 A 调用 B，B 改了，A 没改 — call graph 可能失效但不在 changed files 集合里
- 需要在 incremental.ts 中实现 "changed files + 所有 direct caller 的 reverse edges"

**风险 D（LOW）：JSON snapshot 文件大小**
- self-dogfood（~250 .ts）完整 UnifiedGraph 大约 nodes ≈ 2000+（含 symbol 节点），大小估算 ~500 KB–1 MB
- 需要确认 schema 裁剪策略（是否保留 symbol 级节点，还是只持久化 module 级）

**待澄清**：
- Q1：`spectra index --watch` 是新子命令还是复用 `spectra watch`？（现有 watch 是 batch 增量触发，不是 UnifiedGraph 增量）
- Q2：JSON snapshot 落地在 `specs/_meta/` 还是 `.spectra/`？需要用户确认 `.gitignore` 约定
- Q3：DependencyGraph shim 完成后，`src/graph/dependency-graph.ts`（使用 dependency-cruiser）是否同步删除，还是保留作为 TS/JS fallback？

---

## 4. 测试 / 验证策略雏形

**测试目录约定**（基于现有 `tests/unit/knowledge-graph/` 结构）：
- persistence 单测 → `tests/unit/knowledge-graph/persistence.test.ts`（4 个：save / load / schema roundtrip / stale detection）
- incremental 单测 → `tests/unit/knowledge-graph/incremental.test.ts`（4 个：changed files 提取 / caller expansion / graph merge / unchanged skip）

**vitest 写法参照**：`tests/unit/knowledge-graph/build-unified-graph.test.ts`（有 `afterEach` 清理单例 cache，fixture 用工厂函数 `mkSk()`）

**full vs incremental 对比验证**：
- 在 micrograd（5 .py）/ nanoGPT（15 .py）上跑 `buildUnifiedGraph(all files)` → snapshot A
- 改 1 个文件后跑 incremental → snapshot B
- 对比：`snapshot_B.edges.filter(depends-on)` 的 changed 部分 diff snapshot_A 同文件的边
- 工具：扩展现有 `scripts/verify-feature-151.mjs` 或新建 `scripts/verify-feature-156.mjs`

**< 30 sec 验收**：用 `Date.now()` 计时，micrograd 改 1 文件后 incremental 路径（AST + call-resolver 只跑 changed + callers）应远低于 30 sec

---

## 5. 设计文档 §3.3 + §4 引用

未找到独立设计文档。在 `specs/`、`docs/`、`CLAUDE*` 文件中未发现名为 "Feature 156" 的 §3.3 / §4 incremental indexing 设计描述。需求来自用户 prompt（本次调研输入）。

Feature 151 verification report（`specs/151-knowledge-graph-python/verification/verification-report.md`）§仍待 follow-up 列出了与 Feature 156 相关的两个前置决议：
- 第 1 条：T-014 DependencyGraph 完整 shim 留给 Feature 156（文档原文写"Feature 156"，应为笔误，本次任务即 152）
- 第 4 条：Python import resolution 智能化（basename map 不识别 package 路径）也是 F152 潜在工作

---

## 6. 项目规则提醒

来自 `CLAUDE.local.md` + `CLAUDE.md`：

1. **提交前 Codex 对抗审查**（CLAUDE.local.md）：每次 `git commit` 前必须启动 `codex:codex-rescue` 子代理做对抗性审查；spec-driver feature 每个 phase 完成后也必须 review
2. **阶段性 Codex review 时机**：Specify / Plan / Tasks / Implement / Verify 每 phase 一次，不只最终 commit
3. **master push 需用户确认**：push 到 origin master 前必须列 deliverable report 等待明确授权（CLAUDE.local.md）
4. **代码质量**：不追求最小改动；DependencyGraph shim 要一步到位，不留"旧 + 新并存"过渡态
5. **测试强制**：`npx vitest run` 零失败 + `npm run build` 零 type error 才能提交；新功能单测同 commit 包含
6. **不动 schema / adapter**：`unified-graph.ts` + `call-resolver.ts` 冻结，不引入新依赖（无 sqlite）
7. **分支同步**：此 worktree branch `claude/musing-dewdney-c4018f` 基于 master `761488f`，交付前 `git rebase master` + fast-forward

---

## 7. 进入 specify 之前的建议

1. **优先确认 Q1 / Q2**（5 分钟用户澄清）：`spectra index --watch` 命令边界 + snapshot 落地路径，避免 spec 写完后重新拆分
2. **DependencyGraph shim 先行**：17 consumer 改造是依赖链最清晰的部分，且不依赖 incremental 功能；可先 spec / plan / tasks 拆分 shim 改造为独立 phase，再接 incremental indexing
3. **batch-orchestrator rewrite 需重点 review**：这个文件 ~900 行，改动影响全 pipeline，建议在 plan 阶段标注为 critical path，tasks 阶段单独一个任务
4. **persistence.ts schema 设计**：`UnifiedGraph` 直接序列化已足够（有 Zod schema），加一个 `generatedAt` + `fileHashes: Record<string, string>` 字段用于 stale 检测即可，无需另设 schema
5. **incremental.ts 的 caller expansion 策略**：需要在 spec 中明确"changed files + 深度 N 的 reverse edges"，防止实现时出现边界遗漏（Codex 会揪这个点）
