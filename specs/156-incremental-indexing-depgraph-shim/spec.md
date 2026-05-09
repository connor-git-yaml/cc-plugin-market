---
feature_id: "156"
feature_name: "incremental-indexing-depgraph-shim"
status: "draft"
created: "2026-05-08"
parent_feature: "151-knowledge-graph-python"
estimated_weeks: "3-4"
---

# Feature 156 — Spectra Incremental Indexing + DependencyGraph T-014 Shim

## Revision Log

| 轮次 | 日期 | 修订内容摘要 |
|------|------|-------------|
| v1 | 2026-05-08 | 初版，26 FR / 10 AC / 3 OQ |
| v2 | 2026-05-08 | 吸收 Codex 对抗审查 7 CRITICAL + 5 WARNING + 3 INFO：新增 SnapshotWrapper schema 节、FR-27/FR-28/FR-29/FR-30、AC 拆分 Python/TS-JS 两套（AC-2a/2b/3a/3b）、AC-11、OQ 扩展至 6 条（OQ-3 close）、Edge Cases 补 4 条、风险 A 步骤化、INFO 3 条全补。关闭 A1/A2/A3/A4/A5/A6/A7；补全 B1/B2/B3/B4/B5；采纳 C1/C2/C3。|
| v3 | 2026-05-08 | 吸收 Codex 第二轮 re-review 3 项 PARTIAL：A4 关闭 OQ-4（决议"复用 ts-extractor 已有 import 解析"）+ 明确 AC-11 baseline 采集方法；A6 补充 AC-2b 含 .mjs 文件说明 + AC-11 末尾追加 incremental 路径等价验证；A7 在风险 A 后追加 Milestone 时间盒子节。|
| v3.1 | 2026-05-09 | 吸收 Codex 第三轮 plan review CRITICAL + WARNING：FR-28 字面修正（接管者为新增 src/core/import-resolver.ts，非 ts-extractor.ts——该文件不存在）；AC-6 grep 命令补充注释行排除逻辑；AC-11 baseline 来源与 importType 语义明确（4 类场景覆盖 importType 字段：static/dynamic/type-only，以及 circular 用 SCC 反查 isCircular）。|
| v3.2 | 2026-05-09 | 吸收 Codex 第二轮 W1.0+W1.1 回归审查 PARTIAL + 新发现：(1) NG-3 段加 amendment——UnifiedEdge metadata additive optional 字段属于对称化扩展，不破坏 NG-3 字面冻结约束；(2) WARN-2 PARTIAL 关闭——static `import ... from` 正则也改用 sanitizeForImportRegex 的 sanitized 文本，与 dynamic / require 对齐；(3) W2 handoff——T-026/T-027 DoD 追加 SnapshotWrapper 序列化路径必须保留 UnifiedEdge.metadata 字段约束（panoramic graph-builder.ts 序列化路径目前丢失 metadata，W2 自建 persistence 路径必须直接覆盖此问题）。|

---

## 1. 背景与动机

Feature 151 已将 UnifiedGraph 落地为 Spectra 的统一图结构，但遗留两个工程问题：

1. **全量重索引耗时过长**：当前每次执行均需完整扫描所有文件，在 micrograd（5 .py）约 1–2 分钟，在 nanoGPT（15 .py）约 3–5 分钟，在 self-dogfood（~250 .ts）接近 30 分钟，严重拖慢开发反馈循环。
2. **DependencyGraph T-014 shim 未完成**：`src/models/dependency-graph.ts` 及 17 个 consumer 仍引用旧的 DependencyGraph 模型，dependency-cruiser 外部依赖未清理，导致代码库存在双轨图结构，维护成本高。

本 Feature 的工程目标：缩短 dev-loop（改 1 个文件后反馈 < 30 秒），彻底删除 DependencyGraph 历史包袱，将代码库收束到唯一的 UnifiedGraph 图结构。

---

## 2. Goals 与 Non-goals

### 2.1 Goals

- **G-1**：增量索引能力——改动 1 个文件后，仅重新索引该文件及其直接 caller，完成时间 < 30 秒（micrograd / nanoGPT / self-dogfood 实测）
- **G-2**：JSON snapshot 持久化——将 UnifiedGraph 序列化为 `.spectra/unified-graph.json`，跨 run 复用；第二次运行时未变更文件不重新索引
- **G-3**：`spectra index` 新子命令——支持一次性全量索引与持续监听增量更新两种模式
- **G-4**：DependencyGraph 完全删除——17 个 consumer 全部迁移至 UnifiedGraph，删除 `src/models/dependency-graph.ts`，删除 `src/graph/dependency-graph.ts`，移除 `dependency-cruiser` 依赖
- **G-5**：全量与增量图结果一致——针对同一文件变更，full index 与 incremental index 产出的边集合（depends-on + calls + cross-module）无差异

### 2.2 Non-goals

- **NG-1**：不引入 sqlite 持久化（留给 Node 22 LTS 升版后的后续 Feature）
- **NG-2**：不支持跨 repo group mode（仅单 repo 场景）
- **NG-3**：不修改 UnifiedGraph schema（`unified-graph.ts` 冻结）
  - **v3.2 amendment（2026-05-09）**：UnifiedNode 已含 `metadata?: Record<string, unknown>` 字段（Feature 151 Codex C-4 落地），UnifiedEdge 同步补齐 `metadata?: Record<string, unknown>` 是 **additive optional 对称化扩展**，不破坏现有 fixture（旧数据无该字段时 Zod 校验仍通过）、不要求 producer 注入（消费方按 optional 读取）。该扩展用于承载结构化扩展数据（如 `importType: 'static' | 'dynamic' | 'commonjs-require' | 'type-only'`），避免在 `evidence: string` 字段中嵌入半结构化前缀字符串。NG-3 的"字面冻结"约束指既有字段语义不变 / 不改名 / 不删除；新增 optional 字段属于向前兼容范畴，不在冻结范围内。
- **NG-4**：不修改 call-resolver / mapper / adapter 层的 schema 与接口合同
- **NG-5**：不动 `spectra watch` 命令（仍保持 batch 增量路径不变）
- **NG-6**：Python import resolution 智能化（basename map 识别 package 路径）不在本次范围（留为独立 Feature）
- **NG-7**：不引入临时双 API（不允许 DependencyGraph 与 UnifiedGraph 同时公开 export 并存）

---

## 3. Scope

### 3.1 in-scope 文件清单

**新增文件**：
- `src/knowledge-graph/persistence.ts`（SnapshotWrapper 读写 + stale 检测）
- `src/knowledge-graph/incremental.ts`（git diff 解析 + changed files 提取 + caller expansion + 增量图合并）
- `src/core/import-resolver.ts`（新增：TS/JS import 路径解析，填充 CodeSkeleton.imports[].resolvedPath；被 ast-analyzer.ts / tree-sitter-fallback.ts 调用）
- `plugins/spectra/hooks/post-commit.sh`（可选安装的 git hook，触发增量索引）
- `tests/unit/knowledge-graph/persistence.test.ts`（4 个单测）
- `tests/unit/knowledge-graph/incremental.test.ts`（4 个单测）
- `tests/unit/knowledge-graph/consumer-shim.test.ts`（≥ 3 个单测，覆盖 batch-orchestrator / topological-sort / mermaid-renderer shape-map）
- `scripts/verify-feature-156.mjs`（full vs incremental 对比验证脚本）

**修改文件**：
- `src/cli/commands/index.ts`（新增 `spectra index` 子命令及 `--watch` / `--incremental` flag）
- `.gitignore`（加入 `.spectra/`）
- `src/batch/batch-orchestrator.ts`（rewrite：从 `buildDependencyGraph` 改为 `buildUnifiedGraph` 派生）
- `src/graph/dependency-graph.ts`（rewrite → 最终删除）
- `src/graph/directory-graph.ts`（rewrite：从 UnifiedGraph `depends-on` 边派生兼容视图）
- `src/adapters/ts-js-adapter.ts`（rewrite：委托改为 `buildUnifiedGraph`）
- `src/adapters/python-adapter.ts`（rewrite：输出改为 UnifiedGraph 兼容）
- `src/adapters/language-adapter.ts`（shape-map：接口签名更新）
- `src/adapters/index.ts`（trivial：re-export 类型更新）
- `src/graph/topological-sort.ts`（shape-map：输入改为 UnifiedGraph 子图）
- `src/graph/mermaid-renderer.ts`（shape-map：输入改为 UnifiedGraph）
- `src/panoramic/builders/doc-graph-builder.ts`（shape-map：入参改为 UnifiedGraph）
- `src/panoramic/generators/cross-package-analyzer.ts`（shape-map：包级图改为 UnifiedGraph 子图）
- `src/generator/index-generator.ts`（shape-map：inDegree 从 UnifiedGraph 邻接表派生）
- `src/batch/delta-regenerator.ts`（shape-map：字段映射 from/to → source/target）
- `src/batch/module-grouper.ts`（shape-map：遍历 UnifiedGraph `depends-on` 边）
- `src/cli/commands/graph.ts`（trivial：清理残余 import）
- `src/knowledge-graph/unified-graph.ts`（trivial：更新注释）
- `src/core/ast-analyzer.ts`（在 import 提取点调用 import-resolver.ts 填充 resolvedPath）
- `src/core/tree-sitter-fallback.ts`（在 import 提取点调用 import-resolver.ts 填充 resolvedPath）
- `package.json`（删除 `dependency-cruiser` 依赖）

**删除文件**：
- `src/models/dependency-graph.ts`（shim 完成后删除）
- `src/graph/dependency-graph.ts`（rewrite 完成后删除）

### 3.2 out-of-scope 显式说明

- `src/knowledge-graph/unified-graph.ts`（schema 字段冻结，仅允许更新注释）
- `src/call-resolver/`（整个目录冻结）
- `src/watcher/file-watcher.ts`（已有 chokidar 封装，直接复用，不修改）
- `src/cli/commands/watch.ts`（现有 batch 增量监听路径，不动）
- `tests/baseline/`（perf anchor fixture，不动）

---

## 4. SnapshotWrapper Schema

### 4.1 设计原则

**UnifiedGraph schema 不作任何修改**（`unified-graph.ts` 冻结，其 `metadata` 字段不扩展）。文件级 hash 索引作为持久化专用字段，定义在独立的 **SnapshotWrapper** 结构中，包裹 UnifiedGraph 对象而不侵入其 schema。

### 4.2 SnapshotWrapper 结构

```
SnapshotWrapper = {
  schemaVersion: '1.0',          // SnapshotWrapper 自身的版本（非 UnifiedGraph schema 版本）
  generatedAt: string,           // ISO 8601 datetime，snapshot 写入时间
  graph: UnifiedGraph,           // 引用已 ship 的 UnifiedGraph（结构不变）
  fileHashes: Record<string, string>  // 文件绝对路径 → SHA-256 hex digest
}
```

- `graph` 字段完整保留 UnifiedGraph（含其 `metadata.schemaVersion: '1.0'`），直接用 `UnifiedGraphSchema` Zod 校验
- `fileHashes` 独立存储，不写入 `graph.metadata`，不影响 UnifiedGraph 合同
- SnapshotWrapper 有自己的 Zod schema（`SnapshotWrapperSchema`），读取时用 `safeParse` 校验；校验失败触发 full re-index，不报错退出

### 4.3 写盘格式

snapshot 写盘格式由 plan 阶段决议为 **pretty JSON**（见 plan §2.1 / clarify Q1，OQ-5 已 close）。写盘路径为 `.spectra/unified-graph.json`；读取时若 JSON 解析或 Zod 校验失败，自动降级为 full re-index。

---

## 5. Functional Requirements

### 5.1 JSON Snapshot 持久化

**FR-1**（MUST）[必须]：系统应在项目根目录下产出 `.spectra/unified-graph.json`，执行 `spectra index` 后该文件通过 `SnapshotWrapperSchema` Zod 校验（其内嵌 `graph` 字段通过 `UnifiedGraphSchema` 校验）。

**FR-2**（MUST）[必须]：JSON snapshot 中的文件级 hash 索引（`fileHashes: Record<string, string>`）存储于 SnapshotWrapper 层，**不修改 UnifiedGraph schema**；`fileHashes` 的每个 value 为对应源文件内容的 SHA-256 hex digest。

**FR-3**（MUST）[必须]：系统在加载已有 snapshot 后，对比当前文件 hash，若文件未变更则直接复用对应节点与边，不重新执行 AST 解析；被标记为 stale 的文件才触发重索引。

**FR-4**（MUST）[必须]：`.spectra/` 目录须加入 `.gitignore`，不入版本库。

**FR-5**（MUST）[必须]：snapshot 文件写入必须为原子操作（先写临时文件再 `rename()`），防止写入中断导致 snapshot 损坏。[C2: 原子写入升 MUST，参见 INFO C2]

### 5.2 Incremental Indexing

**FR-6**（MUST）[必须]：系统应提供从 git diff 提取变更文件列表的能力；在 post-commit hook 上下文中使用 `git diff --name-only ORIG_HEAD HEAD`，在 watch 上下文中使用文件系统事件路径，两种来源均归一化为绝对路径集合。

**FR-7**（MUST）[必须]：incremental 索引应将重索引范围扩展为"变更文件 + 深度 1 的直接 reverse callers"（即所有直接调用变更文件中符号的文件）；不扩展超过深度 1（防止扇出过大，具体深度是否参数化由 plan 阶段决议，见 OQ-6）。[INFERRED: 深度 1 是最小安全边界，tech-research 风险 C 指出 caller 扩展是必要的，深度超过 1 在无测试验证的情况下风险过高]

**FR-8**（MUST）[必须]：incremental 更新完成后，系统应将重索引的节点与边合并回完整 snapshot，并更新对应文件的 hash；未变更文件的节点与边保持不变。

**FR-9**（MUST）[必须]：在 micrograd 项目（5 .py 文件）中改动 1 个文件后，incremental 索引完成时间应 < 30 秒（从触发到 snapshot 写入完成）。

**FR-10**（MUST）[必须]：在 nanoGPT 项目（15 .py 文件）中改动 1 个文件后，incremental 索引完成时间应 < 30 秒。

**FR-29**（MUST）[必须]：在 self-dogfood 项目（~250 .ts 文件 + 个别 .mjs 脚本）中改动 1 个文件后，incremental 索引完成时间应 < 30 秒。[A6: 新增 TS/JS 自测覆盖]

### 5.3 spectra index 新命令

**FR-11**（MUST）[必须]：`spectra index`（无 flag）应在当前项目根目录执行全量索引，产出 `.spectra/unified-graph.json`，命令退出码 0 表示成功。

**FR-12**（MUST）[必须]：`spectra index --watch` 应启动持续监听模式，监听项目文件变更（复用 `src/watcher/file-watcher.ts` 的 chokidar 封装），每次检测到变更时触发 incremental 索引并更新 snapshot，进程持续运行直到用户中断。`--watch` 的语义为持续监听（进程不退出）。

**FR-13**（MUST）[必须]：`spectra index --watch` 与现有 `spectra watch`（batch 增量路径）互相独立，不共享状态，不互相干扰。

**FR-14**（SHOULD）[可选]：`spectra index` 应在终端输出索引进度（被索引文件数、耗时），以便用户判断是否正常运行。

**FR-30**（MUST）[必须]：`spectra index --incremental` flag（区别于 `--watch`）用于一次性增量更新语义：读取 snapshot、检测 stale 文件、重索引、写回、进程退出（退出码 0）。`--watch` 持续运行，`--incremental` 单次运行，两者互斥。[B2: 明确 --incremental flag 语义，与 --watch 区分]

### 5.4 Git Hook（可选安装）

**FR-15**（MAY）[可选]：`plugins/spectra/hooks/post-commit.sh` 应在安装后，每次 `git commit` 完成时自动触发 `spectra index --incremental`（post-commit hook 模式），并将结果写入 `.spectra/unified-graph.json`。

**FR-16**（MAY）[可选]：git hook 的安装应为可选且非破坏性（不强制要求，不影响未安装的用户），安装脚本需检测现有 `.git/hooks/post-commit` 是否存在，避免覆盖。

### 5.5 DependencyGraph T-014 完整 Shim

**FR-17**（MUST）[必须]：`batch-orchestrator.ts` 中的 `buildGraphForLanguageGroup` 应改为调用 `buildUnifiedGraph`，产出 UnifiedGraph；下游 delta-regenerator / module-grouper 从 UnifiedGraph 取图数据。

**FR-18**（MUST）[必须]：`topological-sort.ts` 中的 `detectSCCs` 与 `topologicalSort` 应改为接受 UnifiedGraph 子图（仅 `kind === 'module'` 节点 + `relation === 'depends-on'` 边），`inDegree / outDegree / level` 字段从邻接表重算；不改变这两个函数对外暴露的语义。

**FR-19**（MUST）[必须]：`mermaid-renderer.ts` 中的 `renderDependencyGraph` 应改为接受 UnifiedGraph，遍历 `depends-on` 边渲染 Mermaid 图；产出的 Mermaid 文本与原有格式保持一致。

**FR-20**（MUST）[必须]：`ts-js-adapter.ts`、`python-adapter.ts`、`directory-graph.ts` 的图构建路径应改为产出 UnifiedGraph（或从 UnifiedGraph `depends-on` 边派生兼容视图）；`buildDependencyGraph` 方法签名对应更新或删除。

**FR-21**（MUST）[必须]：`doc-graph-builder.ts`、`cross-package-analyzer.ts`、`index-generator.ts`、`delta-regenerator.ts`、`module-grouper.ts`、`language-adapter.ts` 的入参类型应从 `DependencyGraph` 更新为 UnifiedGraph；字段映射需确保语义等价（`from/to` → `source/target`，`graph.modules` → 过滤后的 `graph.nodes`）。

**FR-22**（MUST）[必须]：`src/models/dependency-graph.ts` 和 `src/graph/dependency-graph.ts` 应在所有 consumer 迁移完成后从代码库中删除；`dependency-cruiser` 应从 `package.json` 中移除。

**FR-23**（MUST）[必须]：完成 shim 后，执行 `grep -rn "DependencyGraph" src/ --include="*.ts" | grep -v "^[^:]*:[ \t]*//" | grep -v "^[^:]*:[ \t]*\*" | wc -l` 结果应为 0（注释行排除；仅统计代码中的类型名引用）。[C1: 统一 grep 命令格式，含注释行排除]

**FR-27**（MUST）[必须]：17 个 consumer 的 DependencyGraph → UnifiedGraph 改造采用**一次性切换**（atomic switch）：同一 PR/commit 内，旧 DependencyGraph 类型引用清零（= 0），新 UnifiedGraph 引用补全（= 17 + N 覆盖所有 consumer）；切换期间 `npm run build` 与 `npx vitest run` 均须零失败。**不允许引入临时双 API**（即 DependencyGraph 与 UnifiedGraph 同时作为公开 export 共存），但允许内部 helper 函数（非 public export）在同一 commit 内作为过渡派生手段。[A3: 禁止临时双 API]

**FR-28**（MUST）[必须]：TS/JS `depends-on` 边的接管者为新增模块 **`src/core/import-resolver.ts`**，被 `src/core/ast-analyzer.ts` 与 `src/core/tree-sitter-fallback.ts` 的 import 提取点调用，以填充 `CodeSkeleton.imports[].resolvedPath`；`knowledge-graph/index.ts` 的 `deriveImportEdges` 依赖非 null 的 `resolvedPath` 产出 `depends-on` 边。**不依赖 dependency-cruiser 产出 TS/JS `depends-on` 边**。[v3.1: 修正接管者为 import-resolver.ts——src/extractors/ts-extractor.ts 在仓库中不存在]

**FR-31**（MUST）[必须]：DependencyGraph shim 改造期间如需保留任何 `buildDependencyGraph` 派生 helper，该 helper 必须从**当次输入**（本次 `buildUnifiedGraph` 结果或传入的 CodeSkeleton）派生，**禁止读取** `getCurrentUnifiedGraph()` 全局 cache；这是 Feature 151 Codex Plan C-2 决议的延续。[A5: F151 C-2 决议写入 spec]

### 5.6 测试覆盖

**FR-24**（MUST）[必须]：`tests/unit/knowledge-graph/persistence.test.ts` 应包含至少 4 个单测，覆盖：SnapshotWrapper 写入后可正确读取、schema roundtrip 通过 Zod 校验、stale 检测在文件 hash 变更时返回 stale=true、stale 检测在文件未变更时返回 stale=false。

**FR-25**（MUST）[必须]：`tests/unit/knowledge-graph/incremental.test.ts` 应包含至少 4 个单测，覆盖：changed files 从 git diff 输出正确提取、reverse caller 扩展正确识别深度 1 的 caller、图合并后变更文件的边正确更新、未变更文件的节点与边不被修改。

**FR-26**（MUST）[必须]：本 Feature 所有改动落地后，现有 3155 个单测应继续 pass（`npx vitest run` 零失败）。

**FR-32**（MUST）[必须]：`tests/unit/knowledge-graph/consumer-shim.test.ts` 应包含至少 3 个单测，覆盖 batch-orchestrator / topological-sort / mermaid-renderer 三个核心 shape-map consumer 从 DependencyGraph → UnifiedGraph 的输入输出等价性验证。[B4: 补充 consumer 回归单测]

### YAGNI 最小必要性检验总结

| FR 编号 | 标注 | 理由 |
|---------|------|------|
| FR-1 至 FR-4, FR-6 至 FR-13, FR-17 至 FR-29, FR-31, FR-32 | [必须] | 去掉后核心目标（增量索引 < 30 sec / DependencyGraph 删除 / TS 类型安全）无法实现 |
| FR-5 | [必须] | 升为 MUST（原子写入是 snapshot 可靠性的最低保证，非可选） |
| FR-14 | [可选] | 进度输出改善用户体验，不影响功能 |
| FR-15, FR-16 | [可选] | git hook 为可选安装，非必须路径 |
| FR-30 | [必须] | `--incremental` flag 语义明确是 post-commit hook 可正常工作的前提 |

---

## 6. Acceptance Criteria

**AC-1**：在 micrograd 项目中改动任意 1 个 .py 文件，执行 incremental 索引后，从触发到 `.spectra/unified-graph.json` 写入完成，耗时 < 30 秒（`Date.now()` 计时，10 次测试均值）。

**AC-2a**：在 micrograd 项目（Python）中改动任意 1 个 .py 文件，执行 incremental 索引后，耗时 < 30 秒（同 AC-1 计时方式）。[A6: 拆分 AC-2 为 Python / TS-JS 两套]

**AC-2b**：在 self-dogfood 项目（本仓库，含 .ts 主代码 + `plugins/spec-driver/scripts/*.mjs` 等 .mjs 脚本）中改动任意 1 个 .ts 文件或 .mjs 文件，执行 incremental 索引后，耗时 < 30 秒（同 AC-1 计时方式）。[A6: 显式含 .mjs 文件]

**AC-3a**：对同一 Python 文件集（micrograd）执行 full index 与 incremental index（基于 full index snapshot，再改动 1 个文件后执行），两次产出的 `depends-on` + `calls` + `cross-module` 三类边中，属于变更文件的边 diff 为零（通过 `scripts/verify-feature-156.mjs` 验证）。[A2: 三类边全覆盖]

**AC-3b**：对同一 TS/JS 文件集（self-dogfood）执行 full index 与 incremental index，两次产出的 `depends-on` + `calls` + `cross-module` 三类边中，属于变更文件的边 diff 为零（通过 `scripts/verify-feature-156.mjs` 验证）。[A2 + A6]

**AC-4**：第二次执行 `spectra index`（不改动任何文件）时，`.spectra/unified-graph.json` 中所有文件节点的 hash 与第一次相同，且 stdout 输出 JSON 包含 `"changedFiles": 0`（如 `{"changedFiles": 0, "skippedReason": "no-diff"}`），可用 `jq .changedFiles` 验证。[C3: 机器可读 JSON 输出]

**AC-5**：执行 `grep -rn "DependencyGraph" src/ --include="*.ts" | grep -v "^.*://" | wc -l`，输出为 0（注释行排除，无 TypeScript 类型名引用残留）。[C1]

**AC-6**：执行以下命令确认 dependency-cruiser 依赖已移除：
```bash
grep "dependency-cruiser" package.json \
  | grep -v "^[ \t]*//" \
  | grep -v "^[ \t]*\*" \
  | wc -l
```
输出为 0（排除注释行后确认依赖已移除）。[v3.1: 补充注释行排除，与 AC-5 grep 风格保持一致]

**AC-7**：执行 `npx vitest run`，结果显示 ≥ 3155 个测试通过，0 个失败（不含新增测试）。

**AC-8**：persistence + incremental + consumer-shim 单测数量 ≥ 11（`npx vitest run tests/unit/knowledge-graph/persistence.test.ts tests/unit/knowledge-graph/incremental.test.ts tests/unit/knowledge-graph/consumer-shim.test.ts` 显示 ≥ 11 个测试通过）。[B4: 从 8 扩展到 ≥ 11]

**AC-9**：`spectra index` 命令在项目根执行后退出码为 0，并在项目根产出 `.spectra/unified-graph.json`，文件通过 `SnapshotWrapperSchema` Zod 校验（其内嵌 `graph` 通过 `UnifiedGraphSchema` 校验）。

**AC-10**：`spectra index --watch` 启动后，当监听到文件变更时，自动触发 incremental 索引并更新 snapshot，进程持续运行（不自动退出）；`spectra watch` 命令行为不受影响。

**AC-11**：在包含 `import`（static）、`require`（CommonJS dynamic）、`type-only import`（`import type`）、`circular dependency` 4 种场景的 TypeScript/JavaScript 测试 fixture（`tests/fixtures/ts-import-scenarios/`）上：

1. **baseline 采集（shim 先行阶段中点，删除前）**：在该 fixture 上执行 dependency-cruiser，记录 4 类 import 的 `depends-on` 边数到临时文件 `tests/baseline/_temp/dep-cruiser-baseline.json`（不入库，验证完可删除）。
2. **删除后验证**：在同一 fixture 上执行 `buildUnifiedGraph`（经由 import-resolver.ts 填充 resolvedPath），产出的 `depends-on` 边数每类均 ≥ baseline；任一类场景缺边视为回归。此外验证 `CodeSkeleton.imports[].importType` 字段能区分 `static` / `dynamic` / `type-only`（syntax kind 在 import-resolver.ts 解析时保留）；`isCircular` 字段通过 SCC 反查（`detectSCCs` 返回 size > 1 的 SCC 成员之间的边标 isCircular=true）。
3. **incremental 路径等价验证**：在同一 4 类 fixture 上，改动其中 1 个文件后执行 incremental 索引，import-resolver.ts 增量产出的 `depends-on` 边数与全量产出一致（差值 = 0）。

[A4: 明确 baseline 采集方法；A6: 追加 incremental 路径等价验证；v3.1: 明确 importType/isCircular 语义与 import-resolver.ts 的职责边界]

---

## 7. Edge Cases

**EC-1（caller 扩展深度 vs 性能）**：当变更文件的 direct caller 数量过大（例如 > 50 个文件均调用同一 utility 模块），深度 1 扩展仍可能触发大量重索引。降级策略：增量索引超时阈值（可配置，默认 60 秒），超时后自动降级为 full re-index 并记录警告日志。关联 FR-7、FR-9、FR-10、FR-29。

**EC-2（snapshot stale 但无 git context）**：在 watch 模式下，文件系统事件给出的是修改文件路径，无 git 上下文（如未 commit 的修改）。系统需支持基于文件 hash 对比（非 git diff）触发 incremental 索引。关联 FR-6。

**EC-3（snapshot schema 版本不匹配）**：若 `.spectra/unified-graph.json` 的 `schemaVersion` 与当前运行时不一致（例如升版后），系统应丢弃旧 snapshot，自动触发 full re-index，而非报错退出。关联 FR-3。

**EC-4（batch-orchestrator rewrite 影响全链路）**：`batch-orchestrator.ts` 改动后，delta-regenerator / module-grouper / delta-report 的图遍历行为可能发生语义偏差（如 `from/to` → `source/target` 映射遗漏）。验收方式：全量单测 pass（AC-7）+ 针对 batch pipeline 的集成路径手动验证（`spectra batch` 在 micrograd 上无报错）。关联 FR-17。

**EC-5（topologicalSort / detectSCCs 语义等价）**：UnifiedGraph 的 `nodes` 含 symbol 级节点，过滤逻辑若不严格，会导致 topological 排序结果与原 DependencyGraph 不一致（多余的 symbol 节点混入排序）。shim 层必须在转换前过滤 `kind !== 'module'` 的节点与非 `depends-on` 的边。关联 FR-18。

**EC-6（Python adapter shim 的 import resolution）**：`python-adapter.ts` 现有的 basename map 方式不能识别 package 路径（`from package.module import X` 解析为 basename 而非绝对路径），导致部分 `depends-on` 边目标节点 id 与 TypeScript 路径约定不一致。本 Feature 范围内的修复目标：shim 完成（输出 UnifiedGraph），不要求解决 import resolution 精确度问题（留给后续 Feature）。关联 FR-20。

**EC-7（JSON snapshot 文件大小）**：self-dogfood（~250 .ts）的 UnifiedGraph 含 symbol 级节点，估算 nodes ≈ 2000+，snapshot 大小约 500 KB–1 MB。snapshot 是否裁剪 symbol 节点（只持久化 module 级），是 plan 阶段需要明确的设计决策；如不裁剪，需确认大文件读写对 incremental 路径的延迟影响。关联 FR-1、FR-2。[INFERRED: 本 spec 不预设裁剪策略，交由 plan 决议，不影响 spec 的 WHAT 定义]

**EC-8（snapshot corruption 读取降级）**：若 `.spectra/unified-graph.json` 文件存在但 JSON 解析失败或 `SnapshotWrapperSchema` Zod `safeParse` 失败（磁盘写入中断、手动编辑损坏等），系统必须自动降级为 full re-index，不报错退出，并在 stdout 记录降级原因。关联 FR-5、FR-3。[B1]

**EC-9（文件 rename / delete 后的 stale path）**：若文件被重命名或删除，旧路径的 hash 记录在 `fileHashes` 中但文件已不存在；系统应在 stale 检测时识别该情况，将该路径标记为 deleted，从 snapshot 的 `graph.nodes` 和 `graph.edges` 中移除对应节点与边，并更新 `fileHashes`。关联 FR-3、FR-8。[B1]

**EC-10（shallow clone / CI 无完整 git history）**：在 CI 环境中 `git diff --name-only ORIG_HEAD HEAD` 可能失败（shallow clone 下 ORIG_HEAD 不存在）。降级策略：git diff 命令失败时自动降级为全量 hash stale 检测（遍历所有文件比对 hash），不使用 git history；并在 stdout 记录降级原因。关联 FR-6。[B1]

**EC-11（跨 worktree snapshot 共享冲突）**：多个 worktree 共享同一 `.spectra/` 目录时，并发写入可能导致 snapshot 损坏。本 Feature 范围内通过原子写入（FR-5）降低风险；跨 worktree 锁机制列为后续 Feature 范围（NG-2 限定单 repo 场景）。[B1]

---

## 8. Open Questions（plan 阶段决议）

**OQ-1**：JSON snapshot 中是否裁剪 symbol 级节点（仅持久化 `kind === 'module' | 'package' | 'component'`），以控制文件大小和读写延迟？若裁剪，incremental 路径的 caller expansion 是否仍可工作（symbol 节点的 `calls` 边可能缺失）？

**OQ-2**：incremental 索引的 caller 扩展深度是否需要参数化（如 `--caller-depth 1`），或固定为深度 1？深度 > 1 的场景（A → B → C，C 改了，需要重索引 B 和 A）是否在本 Feature 范围内？

~~**OQ-3**~~（已关闭）：`batch-orchestrator.ts` rewrite 后，是否允许临时双 API 过渡。**决议**：不允许临时双 API（不允许 DependencyGraph 与 UnifiedGraph 同时公开 export 并存），但允许内部 helper 函数（非 public export）在同一 commit 内作为派生手段（见 FR-27）。[A3: close OQ-3]

~~**OQ-4**~~（已关闭）：TS/JS `depends-on` 边的接管者问题。**决议**：新增 `src/core/import-resolver.ts` 模块，由其提供 `resolveTsJsImport(specifier, fromFile, projectRoot, options) → string | null` 接口，被 `ast-analyzer.ts` 和 `tree-sitter-fallback.ts` 的 import 提取点调用以填充 `resolvedPath`；`deriveImportEdges` 依赖非 null 的 `resolvedPath` 产出 `depends-on` 边。[v3.1: 修正——src/extractors/ts-extractor.ts 不存在，正确接管路径是新增 import-resolver.ts]

**OQ-5**：SnapshotWrapper 的写盘格式应为 pretty JSON（调试友好）、minified JSON（空间优化），还是 gzip 压缩（大 snapshot 场景下 500 KB → ~50 KB）？plan 阶段需评估 self-dogfood 场景下的实际大小后决策。[B3]

**OQ-6**：incremental 的 caller expansion 深度是固定为 1 层（spec 推荐值），还是需要支持传递闭包（递归展开 N 层直到无新 caller）？固定深度 1 可能在 A → B → C 改 C 的场景下产生不完整图；但传递闭包在高扇出项目（如 self-dogfood）可能导致几乎全量重索引。[B3]

---

## 9. Risks

**风险 A（HIGH）：batch-orchestrator.ts 是核心阻断点**
- `mergedGraph: DependencyGraph` 被 delta-regenerator / module-grouper / delta-report 全链路消费；一旦 orchestrator 改为返回 UnifiedGraph，所有下游 shape-map consumer 需同步更新。
- **缓解步骤（具体化）**：[B5]
  1. 在 `batch-orchestrator.ts` 内部新增 UnifiedGraph 派生路径（`buildUnifiedGraph` 调用），同时保留一个私有 helper 函数将 UnifiedGraph 临时转换为 DependencyGraph 视图（非 public export）；
  2. 将 delta-regenerator / module-grouper / delta-report 三个 shape-map consumer 逐一切换为消费 UnifiedGraph（`source/target` 字段映射，`nodes` 过滤 `depends-on` 边）；
  3. 所有 shape-map consumer 切换完成并单测 pass 后，删除第 1 步的私有 helper 函数；
  4. 删除 `src/models/dependency-graph.ts` + `src/graph/dependency-graph.ts`；
  5. 移除 `dependency-cruiser` 依赖（`package.json`）。
- **Fallback**：如果步骤 1–3 超过 2 周，incremental indexing 部分（FR-6 至 FR-16）可推迟为后续 Feature，优先交付 DependencyGraph shim（FR-17 至 FR-32）。

### Milestone 时间盒（plan 阶段细化）

以下为建议时间表，plan 阶段可在此基础上细化：

| 周次 | 交付目标 | 出口条件 |
|------|---------|---------|
| 第 1 周 | DependencyGraph shim 先行：17 consumer 改造完成、dependency-cruiser 删除、现有 3155 单测全部 pass | `grep -rn "DependencyGraph" src/ --include="*.ts" \| grep -v "^.*://" \| wc -l` 输出 = 0 |
| 第 2 周 | persistence.ts + SnapshotWrapper schema + `spectra index` 命令骨架 + 单测 4 条 | AC-9 通过；persistence 单测 4 条 pass |
| 第 3 周 | incremental.ts + git diff helper + `spectra index --watch` + 单测 4 条 | AC-2b / AC-3b 通过；incremental 单测 4 条 pass |
| 第 4 周（buffer） | post-commit hook + 文档 + verify-feature-156 脚本 + 复测 < 30 sec AC | AC-1 / AC-2a / AC-7 / AC-8 全通过 |

**拆分触发条件**：若第 1 周末 17 consumer 切换仍未完成 → 暂停 incremental 工作（FR-6 至 FR-16），将 incremental indexing 拆为 Feature 153，本 Feature 仅交付 DependencyGraph shim（FR-17 至 FR-32）。

**风险 B（MEDIUM）：topologicalSort + detectSCCs 需要 DependencyGraph 字段**
- `topological-sort.ts` 使用 `graph.modules.map(m => m.source)` + `inDegree / outDegree / level` 字段，UnifiedGraph 无这些字段，需在 shim 层从邻接表重算。
- 缓解措施：shim 层单独写单测验证重算逻辑与原 DependencyGraph 构建结果等价（AC-8 + FR-32 覆盖）。

**风险 C（MEDIUM）：incremental indexing caller expansion 范围边界**
- git diff 只给出 changed files；若 A 调用 B、B 改了，A 的 call graph 可能失效但不在 diff 集合内。深度 1 的 reverse edge 扩展可部分覆盖，但深度 > 1 的场景无法保证图完整性。
- 缓解措施：在验收脚本中加入 full vs incremental 对比（AC-3a / AC-3b），发现不一致时提示用户降级为 full re-index。

**风险 D（LOW）：JSON snapshot 文件大小**
- self-dogfood 场景下 snapshot 可能达到 500 KB–1 MB；大文件的 parse / stringify 在 incremental 路径中每次都执行，可能引入不必要的延迟。
- 缓解措施：plan 阶段确认是否裁剪 symbol 节点（OQ-1 / OQ-5），或采用流式写入策略降低内存峰值。

---

## 10. 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 / 描述 |
|------|-----------|
| **组件总数** | 2 个新增组件（persistence.ts、incremental.ts）+ 1 个新命令（index command）+ 1 个新模块（import-resolver.ts）= 4 |
| **接口数量** | 新增接口 2（SnapshotWrapper read/write API、incremental run API）+ 修改接口 5+（17 consumer 涉及多处签名变更，按文件维度：language-adapter / doc-graph-builder / topological-sort / mermaid-renderer / cross-package-analyzer）= 约 7–9 |
| **依赖新引入数** | 0（无新外部依赖；git diff 用 Node.js 内置 execSync；file watcher 复用现有 chokidar 封装）|
| **跨模块耦合** | 是——需要修改 2+ 个现有模块接口（batch 层 × 3 + adapters 层 × 3 + panoramic 层 × 2 + graph 层 × 2）|
| **复杂度信号** | 状态管理（SnapshotWrapper stale 检测）；无递归结构；无并发控制；有数据迁移（DependencyGraph → UnifiedGraph 类型替换）= 2 个信号 |
| **总体复杂度** | **HIGH**（跨模块耦合涉及 10+ 文件修改 + 2 个复杂度信号 + 接口数 ≈ 7–9）|

> 建议 GATE_DESIGN 在 plan 阶段对 batch-orchestrator rewrite（风险 A）和 topological-sort shim（风险 B）进行重点人工审查，确认改造策略在实施前达成共识。特别关注 FR-27（atomic switch 约束）和风险 A 的缓解步骤 1–5 是否可以在单次 PR 内完成，或是否需要拆分为两个可独立验证的子任务。
