# 契约：`PYTHON_SYMBOL_SCAN_SURFACE` 取值扩展 + pinned fixture delta

> **修订记录**：本版本已按 plan 阶段对抗审查结论（I2）修正契约 1 中 `ignore-oracle.ts` 归属描述的不实措辞。

本 feature 不涉及 REST/gRPC/MCP 工具级别的 I/O 契约变更（Impact Assessment 已确认 0 个函数签名/导出接口变更）。本文档记录的是**唯一实质变化的契约**：SSoT 常量取值契约，以及由此派生的 pinned fixture 字段级契约。按 Constitution III（YAGNI）不引入形式化 schema 文件，以 Markdown 表格承载即可。

## 契约 1：`PYTHON_SYMBOL_SCAN_SURFACE` 取值契约

**消费方**：`PythonLanguageAdapter.scanPyFiles`（经 `surfaceMatchesFile` 判定）。

**契约变化**：

```diff
 export const PYTHON_SYMBOL_SCAN_SURFACE: CollectorPipelineSurface = {
-  extensions: new Set(['.py']),
+  extensions: new Set(['.py', '.pyi']),
   matchSemantics: 'case-sensitive',
 };
```

**保持不变的调用约定**：
- `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, filePathOrName)` 的函数签名与匹配语义（`case-sensitive` → `endsWith` 族）不变。
- 消费方 `scanPyFiles` 不需要任何代码改动（已消费本常量）。
- 类型 `CollectorPipelineSurface` 不变。

**下游自动生效面**（无需改动，仅登记）：
- `source-commit.ts`（dirty 判定）：遍历 `ALL_PRODUCER_SURFACES` 时会读到扩展后的集合，`.pyi` 文件变更会被正确判定为 dirty。
- `ignore-oracle.ts`（**I2 订正**：原文误称"`PYTHON_SYMBOL_SCAN_SURFACE` 未在其 `DISPATCHED_SURFACES` 列表中"——`DISPATCHED_SURFACES` 实为 `collector-surface.test.ts:600` 的**测试文件局部常量**，非 `ignore-oracle.ts` 自身的标识符）：`ignore-oracle.ts` 仅 `import { GO_ADAPTER_SURFACE, JAVA_ADAPTER_SURFACE, PY_WALK_SURFACE, TSJS_SKELETON_WALK_SURFACE }`（`ignore-oracle.ts:31-36`）并按这四个 surface 分派忽略目录集合（`ignore-oracle.ts:137-140` 的 `if (surfaceHasExtension(...)) return ...IGNORE_DIRS` 四段判断），本就不 import、也不消费 `PYTHON_SYMBOL_SCAN_SURFACE`，故本次扩集对其零影响。该事实由 `collector-surface.test.ts` 中 `DISPATCHED_SURFACES` 驱动的一致性断言（`SC-005 (b) #5` 分组）锁定——该测试常量的取值本身即显式声明"只有四条管线被分派"，`PYTHON_SYMBOL_SCAN_SURFACE`（对应的 `.mjs`/`.cjs` 等 module 派生扫描专属扩展名同理）落 union 兜底分支，非本次改动的回归面。
- `computeCollectorFingerprint()`：自动反映到 `extensionSurface.pythonSymbolScan.extensions`。

## 契约 2：extraction 路 module 节点 label 契约

**消费方**：任何读取知识图谱 `graph.nodes[].label` 字段的下游（如 `graph_node`/`graph_query` MCP 工具）。

**契约变化**：`.pyi` 文件产出的 module 节点 `label` 字段值从"原始文件名"（`mod.pyi`，unified 路早期唯一来源）变为"剥离扩展名后的模块名"（`mod`，extraction 路先写入后的合并结果）。`id` 字段（`relPath`，含完整扩展名）不变，故不影响任何按 `id` 索引的下游逻辑。

## 契约 3：pinned fixture 逐字段 delta（`expected-graph-only-graph.json`）

供实现阶段与验收阶段逐字段核对（对应 data-model.md 实体 2/3）：

| 节点 id | 字段 | 改动前 | 改动后 |
|---------|------|--------|--------|
| `src/py/mod.pyi` | `label` | `"mod.pyi"` | `"mod"` |
| `src/py/mod.pyi` | `metadata.sourceTag` | `"unified-graph"` | `"extraction"` |
| `src/py/mod.pyi` | `metadata.sourceFile` | （无此键） | `"src/py/mod.pyi"`（新增） |
| `src/py/mod.pyi` | `metadata.confidence` | （无此键） | `"EXTRACTED"`（新增） |
| `src/py/mod.pyi` | `metadata.unifiedKind`/`sourcePath`/`callSitesCount` | 不变 | 不变 |
| `src/py/mod.pyi::mod_fn` | `metadata.symbolKind` | （无此键） | `"function"`（新增） |
| `src/py/mod.pyi::mod_fn` | `metadata.signature` | （无此键） | `[待验证]`（新增，参考形态见 research.md 决策 4，以 regen 实跑产出为准） |
| `src/py/mod.pyi::mod_fn` | `metadata.sourceFile` | （无此键） | `"src/py/mod.pyi"`（新增） |
| `src/py/mod.pyi::mod_fn` | `metadata.confidence` | （无此键） | `"EXTRACTED"`（新增） |
| `src/py/mod.pyi::mod_fn` | `metadata.unifiedKind`/`sourcePath`/`exportKind` | 不变 | 不变 |
| （顶层）`graph.graph.fingerprint.extensionSurface.pythonSymbolScan.extensions` | — | `[".py"]` | `[".py", ".pyi"]` |

**不应出现的 delta**（若再生产物出现以下变化，视为异常，需人工核查而非直接接受）：
- `src/py/mod.pyi` 或其 component 节点的 `id` 字段变化
- 新增/删除任何 `contains` 边（预期是既有边字段不变、无新增）
- `src/py/mod.py`（`.py` 对照组）任何字段变化
- `expected-module-graph.json` 的 `moduleGraph.modules[]` 内容变化（见契约 4）

## 契约 4：`expected-module-graph.json` delta

**核实结论**：该 fixture 的 `moduleGraph` 由 `buildModuleGraphForProject`（`src/knowledge-graph/module-derivation.ts:340`）产出，该函数直接扫描 `tsJsAdapter.extensions`（TS/JS 专属扩展名集合），**不调用** `PythonLanguageAdapter.buildModuleGraph`（后者是 `LanguageAdapter` 接口方法，服务于按语言单独构建模块图的场景，与本护栏 fixture 使用的项目级 `buildModuleGraphForProject` 是两条不同路径）。因此该资产的 `modules[]` 本就只含 ts-js 条目，护栏 A（`pyModuleMap` 显式跳过 `.pyi`）不影响本资产，也不会新增任何 python 条目。

| 字段 | 改动前 | 改动后 |
|------|--------|--------|
| `fingerprint.extensionSurface.pythonSymbolScan.extensions` | `[".py"]` | `[".py", ".pyi"]` |
| `moduleGraph.modules[]` | 零 python 条目（仅 ts-js） | 不变（仍为零 python 条目，理由见上） |
