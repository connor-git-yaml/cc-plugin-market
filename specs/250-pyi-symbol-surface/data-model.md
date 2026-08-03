# Phase 1 数据模型：涉及的常量与图节点实体

本 feature 不新增数据结构（Constitution III：YAGNI），全部实体为既有类型的**取值扩展**或**字段级新增**。本文件精确定义改动前后的字段差异，供实现与验收核对。

## 实体 1：`PYTHON_SYMBOL_SCAN_SURFACE`（`src/collector-surface.ts`）

| 字段 | 改动前 | 改动后 |
|------|--------|--------|
| `extensions` | `Set(['.py'])` | `Set(['.py', '.pyi'])` |
| `matchSemantics` | `'case-sensitive'` | 不变 |

类型 `CollectorPipelineSurface` 本身不变，只是该常量的取值变化。

## 实体 2：extraction 路 module 节点（知识图谱持久化节点，`extractSymbolNodes` 产出）

**`.py` 文件（不变）**：

| 字段 | 值示例 |
|------|--------|
| `id` | `src/py/mod.py`（完整 relPath） |
| `kind` | `'module'` |
| `label` | `mod`（`path.basename(relPath, path.extname(relPath))`，本次改动前后行为等价） |
| `source_file` | `src/py/mod.py` |
| `confidence` | `'EXTRACTED'` |

**`.pyi` 文件（本次新增覆盖面）**：

| 字段 | 改动前（无此节点，仅 unified 路产出同 id 节点） | 改动后（extraction 路先写 + unified 路补缺后的合并节点） |
|------|---|---|
| `id` | `src/py/mod.pyi` | 不变 |
| `kind` | `'module'` | 不变 |
| `label`（来自 unified 路，原始文件名） | `mod.pyi` | `mod`（extraction 路先写入，覆盖 unified 路原会写入的原始文件名——因合并语义是"unified 对已存在节点只补缺不覆盖"，extraction 先到即定局） |
| `metadata.sourceTag`（来自 unified 路） | `'unified-graph'` | `'extraction'`（extraction 路先写覆盖） |
| `metadata.sourceFile`（extraction 路新写） | 无 | `src/py/mod.pyi` |
| `metadata.confidence`（extraction 路新写） | 无 | `'EXTRACTED'` |
| `metadata.unifiedKind`（unified 路补缺，不变） | `'module'` | `'module'` |
| `metadata.sourcePath`（unified 路补缺，不变） | `src/py/mod.pyi` | `src/py/mod.pyi` |
| `metadata.callSitesCount`（unified 路补缺，不变） | `0` | `0` |

## 实体 3：extraction 路 component 节点（顶层符号节点，`extractSymbolNodes` 产出）

**`.pyi` 文件符号节点（本次新增覆盖面，以 `src/py/mod.pyi::mod_fn` 为例）**：

| 字段 | 改动前（仅 unified 路产出） | 改动后（extraction 路先写 + unified 路补缺） |
|------|---|---|
| `id` | `src/py/mod.pyi::mod_fn` | 不变 |
| `kind` | `'component'` | 不变 |
| `label` | `mod_fn` | 不变（component label 恒为符号名，两路一致，无剥离逻辑） |
| `metadata.symbolKind`（extraction 路新写） | 无 | `'function'` |
| `metadata.signature`（extraction 路新写） | 无 | `[待验证]` 由 `TreeSitterAnalyzer` 对 `def mod_fn() -> int: ...` 的实际提取结果决定，实现阶段以 `regen` 脚本实跑产出为准，不预先写死（Constitution IV，见 research.md 决策 4） |
| `metadata.sourceFile`（extraction 路新写） | 无 | `src/py/mod.pyi` |
| `metadata.confidence`（extraction 路新写） | 无 | `'EXTRACTED'` |
| `metadata.unifiedKind`（unified 路补缺，不变） | `'symbol'` | `'symbol'` |
| `metadata.sourcePath`（unified 路补缺，不变） | `src/py/mod.pyi` | `src/py/mod.pyi` |
| `metadata.exportKind`（unified 路补缺，不变） | `'function'` | `'function'` |

**contains 边（`src/py/mod.pyi` → `src/py/mod.pyi::mod_fn`）**：改动前该边已存在（unified 路产出，`confidence: 'EXTRACTED'`、`confidenceScore: 0.95`、`directional: true`）；改动后 extraction 路会尝试写入同一 `(source, target, relation, directed)` 键的边，经 `upsertEdge` 去重，**不产生新边、不改变既有边字段**（该边字段本就与 extraction 路的写法一致）。

## 实体 4：`ModuleGraph`（分析视图，`buildModuleGraph` 产出，不含 `label`）

本次改动后，`.pyi` 文件会作为一个 `ModuleNode` 条目出现在 `ModuleGraph.modules` 中（因为 `scanPyFiles` 现在会返回 `.pyi` 文件，`buildModuleGraph` 对每个扫描到的文件都会产出一个 module 视图条目）。字段结构不变（`source`/`inDegree`/`outDegree`/`level`/`isCircular`，无 `label`）。**护栏 A 约束**：`.pyi` 文件不会出现在 `pyModuleMap`（绝对 import 目标解析表）中，因此不会成为任何 `import` 语句的解析目标，但它自身作为一个"节点"仍参与 `ModuleGraph.modules` 列表与拓扑/SCC 计算（若它没有出边入边，则是孤立节点，见 spec Edge Cases「stub-only 模块的孤立度」）。

## 实体 5：`CollectorFingerprint.extensionSurface.pythonSymbolScan`（`src/panoramic/graph/collector-fingerprint.ts`）

| 字段 | 改动前 | 改动后 |
|------|--------|--------|
| `extensions` | `['.py']` | `['.py', '.pyi']`（排序后数组，来自 `toSurfaceEntry(PYTHON_SYMBOL_SCAN_SURFACE)`） |
| `matchSemantics` | `'case-sensitive'` | 不变 |

`CollectorFingerprint` 顶层结构（`formatVersion`/`extensionSurface`/`behaviorVersion`）不变；`behaviorVersion` 本次不递增（FR-009：扩展名集合变化已被 `extensionSurface` 分量自动反映，不属于 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类责任范围）。
