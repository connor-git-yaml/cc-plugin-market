# Feature 181 — import-resolver 单一权威收口 · 影响分析报告（Phase 1/5）

- **模式**: spec-driver-refactor
- **目标类型**: concept（跨文件同名函数 `resolveTsJsImport` 双实现收口）
- **重构目标**: `src/` 内消除两套 `resolveTsJsImport`，收口为单一权威实现
- **规格来源**: `docs/design/M7-stepback-revision-2.md` §3
- **风险评级**: **medium**（多文件合约变更 + graph.json byte-identical 硬护栏；非 critical，见下文短路分析）
- **影响文件数**: 生产 6 + 测试 2 + 文档注释 1 = 9（远低于 100 阈值，无需超阈值暂停）

---

## 1. 现状：两套 `resolveTsJsImport` 精确差异

| 维度 | `core/import-resolver.ts:115` | `knowledge-graph/import-resolver.ts:344` |
|------|------|------|
| 签名第 4 参 | `options?: ResolveTsJsImportOptions` | `tsConfigContext?: TsConfigResolutionContext \| null` |
| 返回类型 | `string \| null`（**绝对**路径） | `ResolveResult`（`resolvedPath` 为**相对 projectRoot 的 POSIX** + `kind`） |
| projectRoot 边界守卫 | ❌ 无 `isInsideProjectRoot` | ✅ 强制（防图污染，C-4/C-5/N-2） |
| 扩展名集合 | `.ts .tsx .js .jsx .mjs .cjs`（6） | `.ts .tsx .js .jsx`（4，**无 .mjs/.cjs**） |
| ESM TS ext map（`./foo.js`→`foo.ts`） | ✅ `ESM_TS_EXT_MAP`（.js→.ts/.tsx、.jsx→.tsx、.mjs→.mts、.cjs→.cts） | ❌ 无（`./foo.js` 会尝试 `foo.js.ts` 等 → unresolved） |
| 直接命中（specifier 已含扩展名） | ✅ `tryFilePathVariants` 先试 base 本身 | ❌ 仅试 `base+ext`（不试 base 本身） |
| alias 配置形态 | `pathAliases: Record<string, string\|string[]>`（已扁平化）+ `baseUrl: string`（**已解析为绝对**） | `tsConfigContext: { configDir, baseUrl: string\|null（相对）, paths: Map }`（**原始 tsconfig 语义**，paths 叠加 baseUrl，exact 优先 wildcard） |
| kind 分类 | 无（只有 path/null） | `module/package-init/relative-sibling/relative/paths-alias/absolute/external/unresolved` |
| `.json`/`.d.ts` 处理 | 作为普通文件可命中 | W-1：→ `external`（不入 callSites graph） |
| `node:` 内置 | → null | 走 external 分支（bare 包名规则）|
| Python 支持 | 无 | `resolvePythonImport`（同文件，**不在本次收口范围**） |

> **结论**：两者并非简单重复，而是**能力互补**。统一实现必须是 **core 的相对解析能力（ESM ext map + 直接命中 + .mjs/.cjs）** ∪ **kg 的 alias/baseUrl/guard/kind/external 语义** 的超集，否则任一侧能力丢失都会引入回归。

---

## 2. 全部调用点清单（grep 全仓含 tests 复核）

### 2.1 `core/resolveTsJsImport` — 生产消费 5 处（不可删）

| 文件:行 | 消费函数 | 传入第 4 参 | 用途 |
|---------|---------|-----------|------|
| `core/ast-analyzer.ts:417` | `extractImports`（静态 import） | `resolverOpts`（pathAliases+baseUrl） | ts-morph 主路径 |
| `core/ast-analyzer.ts:458` | `extractImports`（动态/require） | `resolverOpts` | ts-morph 主路径 |
| `core/tree-sitter-analyzer.ts:318` | `postProcessTsJsImports` | `resolverOpts`（仅 pathAliases） | tree-sitter 路径 |
| `core/tree-sitter-fallback.ts:128` | 正则降级（static import） | `resolverOpts`（仅 pathAliases） | 正则降级路径 |
| `core/tree-sitter-fallback.ts:261` | 正则降级（dynamic/require） | `resolverOpts` | 正则降级路径 |

**3 个逻辑消费方**（ast-analyzer / tree-sitter-analyzer / tree-sitter-fallback），全部 `import './import-resolver.js'`，均将返回值（绝对路径 string|null）直接写入 `CodeSkeleton.imports[].resolvedPath`。

### 2.2 `kg/resolveTsJsImport` — 生产消费 1 处

| 文件:行 | 消费函数 | 用途 |
|---------|---------|------|
| `batch/batch-orchestrator.ts:2305`（import @ 91） | `collectTsJsCodeSkeletons` | batch 路径，**仅对 core 留空的 import 兜底**（见 §3 短路逻辑） |

### 2.2b 🔴 Codex 纠正：core resolver 经 module-derivation 也进 graph.json（第二条 graph 路径）

原报告（§5 初稿）声称「无任何生产代码给 `AnalyzeOptions` 设置 pathAliases/baseUrl」，**这是 over-claim**。实测存在第二条 graph 生产路径：

```
batch-orchestrator.ts:472/477  buildModuleGraphForProject(resolvedRoot)
  → module-derivation.ts:353  loadTsconfigAliases(tsConfigPath)   ← 第二个 tsconfig loader！
  → module-derivation.ts:360  analyzerOpts = { projectRoot, pathAliases, baseUrl }  ← 传 alias！
  → module-derivation.ts:371  analyzeFileInternal(absPath, analyzerOpts)  ← core resolver 带 alias
  → deriveImportEdges → ModuleGraph depends-on 边 → graph.json
```

**结论修正**：core 的 alias/baseUrl 分支**确实在 graph.json 生产路径中被触发**（经 module-derivation），不是仅单测覆盖。因此存在**两条独立 graph 路径 + 两个 tsconfig loader + 两套 alias 解析算法**：

| | 路径 A：collectTsJsCodeSkeletons | 路径 B：buildModuleGraphForProject |
|--|--|--|
| relative 解析 | core（analyzeFile 不传 alias）→ 短路 | core（analyzeFileInternal 传 alias）|
| alias/baseUrl 解析 | kg（兜底，`findNearestTsConfig`+`buildTsConfigContext`，相对 baseUrl，exact 优先 wildcard，baseUrl 叠加 paths）| core（`loadTsconfigAliases`，扁平 pathAliases + 绝对 baseUrl，最长前缀匹配，baseUrl 独立 fallback）|
| 产物 | codeSkeletons → buildKnowledgeGraph | ModuleGraph depends-on 边 |

两套 alias 算法语义**不同**（前缀匹配规则 + baseUrl 叠加方式），这是本次收口最大的合约风险点（见 R6 修订）。

### 2.3 测试调用点

| 文件 | 测试数 | 目标 |
|------|--------|------|
| `tests/unit/core/import-resolver.test.ts` | 19 it | core `resolveTsJsImport`(8) + `detectImportType`(6) + `resolveImportsForFile`(2) + 其他 |
| `tests/unit/knowledge-graph/import-resolver.test.ts` | 32 it | kg `resolveTsJsImport` + `resolvePythonImport` + `findNearestTsConfig` + `buildTsConfigContext` |

---

## 3. 🔴 严重度定位：medium（不是 critical）— 短路逻辑实证

`collectTsJsCodeSkeletons`（batch 唯一写 graph.json 的路径）流程（`batch-orchestrator.ts:2300-2316`）：

```
1. adapter.analyzeFile(filePath, {extractCallSites})  ← 不传 pathAliases/baseUrl
   → core resolveTsJsImport：仅解析相对 import（绝对路径，ESM ext map，无 guard）；
     alias/baseUrl/bare 全返回 null（因为没传 pathAliases）
2. imports.map: if (imp.resolvedPath) return imp;     ← core 已解析则短路，保留绝对路径
   else result = kg.resolveTsJsImport(..., tsConfigContext)   ← 仅对 core 留空的兜底
        resolvedPath = result.resolvedPath ? path.resolve(root, result.resolvedPath) : null  ← 相对转回绝对（EC-10）
```

**关键事实**：同一 graph 构建中，每条 import 只由一个 resolver 终解析（core 先解析相对、短路；kg 仅兜底 alias/baseUrl/external）。**不存在双解析冲突**，故原架构扫描报的「critical 威胁 graph.json 一致性」**不成立**，已降级为「消除重复实现的可维护性 refactor」。

---

## 4. 删除清单确认（死代码）

| 符号 | 生产消费 | 测试消费 | 文档/注释引用 | 结论 |
|------|---------|---------|--------------|------|
| `core/resolveImportsForFile` | ❌ 零（grep 确认） | ✅ `import-resolver.test.ts:249`（**1 个 it** describe 块） | `import-resolver.ts:327` 自注释 | **真死代码，可删**（连同其测试块） |
| `core/detectImportType` | ❌ 零（ast-analyzer 行内派生 importType，`ast-analyzer.ts:399-415`，**不调用此函数**） | ✅ `import-resolver.test.ts:72`（describe 块 **5 个 expect**，1 个 it） | `models/code-skeleton.ts:126` 注释「由 import-resolver.detectImportType 派生」（**失真注释**，实际行内派生） | **死代码，可删**（连同测试块 + 修正 code-skeleton.ts:126 失真注释） |

> ⚠️ **对规格的纠正**：规格 §3 称 `detectImportType` / `resolveImportsForFile`「仅文档注释引用」。实测**二者均有专属单元测试块**（Codex 复核：detectImportType describe 块 5 个 expect、resolveImportsForFile 1 个 it）。删除时必须同步删除对应测试块，并修正 `code-skeleton.ts:126` 的失真注释。这不影响「可删」结论，但删除工作量比规格描述更大。

---

## 5. 🔴 byte-identical 回归风险矩阵（收口后 graph.json 必须逐字节不变）

统一 resolver 替换 core 后，**batch 路径产出的 resolvedPath 必须完全一致**。逐风险项：

| # | 风险 | 现状（core 在 batch 路径） | 收口后若处理不当 | 缓解 |
|---|------|--------|--------|------|
| R1 | **绝对 vs 相对路径格式** | core 返回绝对 → 短路存绝对 | 若 AST 消费方改存 kg 的相对 POSIX → CodeSkeleton.resolvedPath 形态变 → graph 变 | AST 消费方必须把统一结果 `path.resolve(projectRoot, rel)` **转回绝对**（与今日一致） |
| R2 | **ESM ext map 丢失** | core 解析 `./foo.js`→`foo.ts`（短路） | 若统一实现仅搬 kg（无 ESM map）→ 相对 `.js` import 变 unresolved → 边消失 | 统一实现**必须并入 ESM_TS_EXT_MAP + 直接命中 + .mjs/.cjs** |
| R3 | **候选顺序差异** | core: ESM候选→直接命中→[.ts.tsx.js.jsx.mjs.cjs]→index | 顺序变 → 同名多候选时命中不同文件 | 统一实现的相对解析候选顺序**严格复刻 core `tryFilePathVariants`** |
| R4 | **guard 新增到相对 import** | core 相对 import **无 guard** | 统一实现给相对 import 加 guard → 越界相对 import 由「绝对路径」变「null」 | 收口后跑 baseline graph.json diff 验证 self-dogfood **无越界相对 import**（理论上 src/ 内全在树内）；diff 红则需保留 guard 但记录行为差异 |
| R5 | **projectRoot='' 边界** | core 用 `path.resolve(fromDir, spec)` 解析相对，**与 projectRoot 无关**；guard 不存在 | kg `isInsideProjectRoot(cand, '')` 行为未定义 → 可能误判越界 | 统一实现：`projectRoot` falsy 时**跳过 guard + 返回绝对路径**（复刻 core 标准独立行为） |
| R6 | **两套 alias 算法都进 graph**（Codex 纠正）| 路径 A alias 走 kg；路径 B alias 走 core（module-derivation 传 alias）— 见 §2.2b | 若统一为单一 alias 算法 → 两路径之一的 alias 边解析结果变 → graph.json 变 | 收口须**同时复现两套 alias 语义**，或迁移两条路径到同一语义后跑 byte gate 验证；**baseline 不触发 alias（见下）降低实测风险** |
| R7 | **`.json`/`.d.ts` 相对 import 翻转**（Codex 补）| core 把相对 `./x.json`/`.d.ts` 当普通文件命中 → 绝对路径（`import-resolver.ts:224` 直接命中分支） | 若统一实现复用 kg 的 `isNonSourceTarget`（.json/.d.ts→external/null）→ resolvedPath 绝对→null、节点 kind 翻转 | baseline 实测**无**被抽取的相对 `.json`/`.d.ts` import（仅 `_require('../../package.json')`，`_require`≠`require` 不被 AST 抽取），byte gate 不受影响；但属其他项目的潜在行为差异，须补单测固化期望语义 |

**baseline alias 触发实测（关键降险）**：
- 本仓 tsconfig 虽定义 `baseUrl:"."` + `paths`（`@core/*` 等 7 条），但 **grep 确认 0 个源文件用 @-alias import**（全部相对 import）。
- TS baseline（hono）tsconfig **无 paths/baseUrl**。
- 故 **alias 解析分支在 self-dogfood / hono baseline 上从不被实际 import 触发**。byte-identical gate 实测只验证 **relative 解析**（R1-R5）；两套 alias 算法的语义差异（R6）只影响真正用 alias 的第三方项目，由**单元测试**而非 byte gate 守护。
- **ESM ext map（R2）是 baseline 上的绝对主导分支**：grep 实测 **216 个文件**含 `from './...js'` 形态（TS ESM 惯例 `.js`→`.ts`）。统一实现若丢 ESM map，graph.json 会灾难性破坏。这是收口第一优先保真项。

**R5 补充 caveat（Codex）**：core 的 baseUrl 分支（非相对 specifier）解析**不依赖 projectRoot**——只要传了 `options.baseUrl` 即可解析。projectRoot falsy 仅令 alias 候选为空（`import-resolver.ts:174`）+ 相对解析仍走 `path.resolve(fromDir, spec)`。统一实现的 guard 条件化须区分「guard 关闭」与「baseUrl 仍可用」。

---

## 6. 收口方案的关键约束（供 Phase 2 设计）

1. **单一权威实现位置**：建议落在 `core/import-resolver.ts` 还是 `kg/import-resolver.ts` 由 Phase 2 决策；倾向放 kg（已含 guard/kind/external/Python 邻居），把 core 的 ESM/ext/直接命中能力并入 kg 的相对解析分支。
2. **统一返回类型 `ResolveResult`**（含 kind + guard）。AST 三消费方：取 `.resolvedPath`（相对 POSIX）→ `projectRoot` 非空时 `path.resolve` 转绝对、为空时直接用绝对候选 → 写入 CodeSkeleton（保持今日绝对路径形态，护 R1）。
3. **签名统一 + 两套 alias 算法**（本次最大合约设计点）：AST 消费方今日传 `ResolveTsJsImportOptions`（扁平 pathAliases + 绝对 baseUrl，core 算法），batch 兜底传 `tsConfigContext`（raw paths Map + 相对 baseUrl，kg 算法）。且二者经 module-derivation/collect **都进 graph.json**（§2.2b）。统一签名需同时容纳两种 alias 输入，**且 Phase 2 须决策：是否把两套 alias 语义合并为一套**（合并 → 更彻底但需 byte gate + alias 单测双重验证语义不漂；保两套模式 → byte 安全但「单一权威」打折）。这是需用户拍板的 scope/风险点。
4. **相对解析候选顺序与扩展名**：严格复刻 core（护 R2/R3）。
5. **guard 条件化**：`projectRoot` 非空才启用（护 R4/R5）。

---

## 7. 验收守回归手段

| 手段 | 命令/方式 | 守护 |
|------|----------|------|
| 跨路径一致性测试（新增） | 同一 fixture 经 AST 路径（analyzeFile）与 batch 路径（collectTsJsCodeSkeletons）解析，断言 resolvedPath 一致 | 收口正确性 |
| graph.json byte-identical | 收口前后对确定性 TS fixture 跑 collect→buildKnowledgeGraph→normalizeGraphForWrite(stripTimestamps) 快照 deepEqual（复用 F179 epoch byte-stable 机制） | R1-R5 总闸 |
| 全量单测 | `npx vitest run`（现 4111 pass，迁移后数量会变：删 8 + 新增跨路径用例） | 合约不破 |
| 类型检查 | `npm run build` | 合约一致 |
| 仓库同步 | `npm run repo:check` | source-of-truth/包装层同步 |

---

## 8. 影响文件清单（Phase 3 改动面）

**生产（7）**：
- `src/core/import-resolver.ts`（删死代码 / 视方案保留或迁出 resolveTsJsImport）
- `src/knowledge-graph/import-resolver.ts`（并入 core 能力，成单一权威）
- `src/core/ast-analyzer.ts`（迁移 2 调用点 + 返回值适配绝对路径）
- `src/core/tree-sitter-analyzer.ts`（迁移 1 调用点）
- `src/core/tree-sitter-fallback.ts`（迁移 2 调用点）
- `src/knowledge-graph/module-derivation.ts`（路径 B：`loadTsconfigAliases` + analyzerOpts 透传 alias；视 alias 合并方案可能需迁移到统一 tsConfigContext loader）
- `src/models/code-skeleton.ts`（修正 :126 失真注释）

**潜在波及（视方案）**：`src/adapters/ts-js-adapter.ts`、`src/adapters/language-adapter.ts`（签名/选项类型）。

**测试（2）**：
- `tests/unit/core/import-resolver.test.ts`（删 detectImportType/resolveImportsForFile 用例 + resolveTsJsImport 用例迁移到新签名/返回）
- `tests/unit/knowledge-graph/import-resolver.test.ts`（补 ESM ext map / .mjs.cjs / 直接命中 / guard 条件化 用例）
- 新增跨路径一致性测试文件

**潜在波及**：`src/adapters/ts-js-adapter.ts`、`src/adapters/language-adapter.ts`（若签名/选项类型变动需同步类型）。

---

## 9. 残留扫描预案（Phase 4）

Phase 4 全仓 grep 两套 resolver 的所有标识符（`resolveTsJsImport` / `resolveImportsForFile` / `detectImportType` / `ResolveTsJsImportOptions` / 从 `core/import-resolver.js` 的 import）确认：
- 无遗漏的旧 core resolver 调用点
- 无 dangling import
- 文档/注释引用已同步（含 `language-adapter.ts:49` 注释提及 import-resolver）
