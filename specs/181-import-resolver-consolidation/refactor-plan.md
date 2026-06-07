# Feature 181 — import-resolver 单一权威收口 · 分批规划（Phase 2/5）

- **依据**: `impact-report.md`（Phase 1，已过 Codex 对抗审查）
- **用户拍板**（2026-06-07）: **彻底合一（kg 语义）** — 统一为一套 alias 算法（kg/TS 官方语义：baseUrl 叠加 paths、精确 key 优先通配），两条 graph 路径都迁过去，tsconfig loader 合一。接受用别名的第三方项目 alias 边解析结果变（更正确），由 alias 单测固化；baseline 不用别名故 byte-identical 不受影响。

---

## 1. 架构决策（主线程收口）

### 1.1 单一权威 resolver 的归属：`src/core/import-resolver.ts`（最低层）

实测：**0 个 `src/core/` 文件 import 自 `knowledge-graph/`**（当前层级干净，core 不依赖 kg）。若把权威 resolver 放 kg、让 3 个 core AST 消费方上行 import kg → 引入 core→kg 层级倒置。故：

- **权威 TS/JS resolver 落 `core/import-resolver.ts`**（最低层工具）。AST 消费方同目录 `./import-resolver.js`（无倒置）；kg / batch / module-derivation 下行 import core（干净方向）。
- 删 detectImportType 后 core/import-resolver.ts **不再依赖 ts-morph**，退化为纯 `node:fs`/`node:path` 工具，定位更纯净。
- `resolvePythonImport` **不在本次收口范围**，留在 `kg/import-resolver.ts`；其依赖的 `ResolveResult` 类型 + 共享 helper（`toPosix`/`isInsideProjectRoot`）随 TS resolver 迁到 core，kg 下行 import（kg→core，干净）。

### 1.2 单一权威实现 = core 相对解析能力 ∪ kg 别名/守卫语义（超集）

| 能力 | 来源 | 收口后处理 |
|------|------|-----------|
| ESM TS ext map（`.js`→`.ts` 等，**216 文件主导**） | core | **必须并入**相对解析分支 |
| 直接命中（specifier 已含扩展名，如 `./x.json`） | core | 并入（先试 base 本身） |
| `.mjs`/`.cjs` 扩展名 | core | 并入 `TS_EXTENSIONS` |
| `isInsideProjectRoot` guard | kg | 保留，**条件化**（projectRoot falsy 时跳过，见 1.3） |
| `kind` 分类 + external/unresolved | kg | 保留 |
| `.json`/`.d.ts`→external（R7） | kg | 保留为权威语义；baseline 不触发，补单测固化期望 |
| alias 解析算法（exact 优先 wildcard + baseUrl 叠加） | kg | **唯一保留**（用户拍板），core 算法弃用 |
| tsconfig loader | 合一 | 用 `ts.parseJsonConfigFileContent`（保 extends 链）+ 每文件 nearest（monorepo-aware）适配为 `TsConfigResolutionContext`（见 1.4） |

### 1.3 返回类型 + 绝对/相对 + guard 条件化（byte-identical 核心）

- 权威 `resolveTsJsImport` 返回 `ResolveResult`（`resolvedPath` 为相对 projectRoot 的 POSIX；external/unresolved 为 null）。
- **AST 三消费方**：取 `result.resolvedPath` → 归一为**绝对路径**写入 `CodeSkeleton.imports[].resolvedPath`（保持今日 core 行为；`module-derivation.normalizeSkeletonPaths:445` 期望绝对输入再相对化，故必须绝对）。归一规则：`rel ? path.resolve(projectRoot||fromDir, rel) : null`。
- **projectRoot falsy 边界**（collect step1 调 analyzeFile **不传 projectRoot** → `?? ''`）：权威 resolver 须在 projectRoot falsy 时**跳过 guard、相对解析仍走 `path.resolve(fromDir, spec)` 得绝对候选**，并令 `resolvedPath` 直接为该绝对路径（消费方原样用，不再 path.resolve）。消费方归一统一写：`path.isAbsolute(rp) ? rp : path.resolve(projectRoot, rp)`，两种情况都正确。
- **guard 逐分支精确复刻 kg（Codex W#4）**：kg 当前 guard **仅在 relative 分支 + disk-absolute（`/` 前缀）分支**启用，**paths-alias / baseUrl 分支无 guard**（`kg/import-resolver.ts:445/453/469/477` 命中即返回，不查 guard）。统一实现须**逐分支保持一致**：relative + disk-absolute 启用 guard（且 projectRoot 为真才启用，护 R5）；paths-alias / baseUrl 分支**不加 guard**（否则改 alias 语义）。baseUrl 解析不依赖 projectRoot（Codex caveat）。

### 1.4 tsconfig loader 合一（Codex W#2 收窄 scope）

- **统一 loader 的"解析实现"**：单一函数基于 `ts.parseJsonConfigFileContent`（保 extends 链；优于 kg `buildTsConfigContext` 的 YAGNI 无 extends），产出 `TsConfigResolutionContext { configDir, baseUrl, paths }` 喂 kg 算法。
- **保留各路径现有"选哪个 tsconfig"策略**（Codex W#2，避免扩 scope 破 byte-identical）：
  - 路径 A（collect）：维持 kg `findNearestTsConfig` 的**每文件 nearest 上溯**（monorepo-aware，现状）
  - 路径 B（module-derivation）：维持**单 root tsconfig**（`module-derivation.ts:349` 现状）
  - 「nearest 全量统一」是独立语义变更 → **本次不做**，defer。两路径共享同一 loader 实现 + 同一 alias 算法即满足「单一权威」；tsconfig 选取策略差异保持现状（self-dogfood 单 root → 两策略等价，byte-identical 安全）。
- **loader 适配避免双重 resolve（Codex INFO#3）**：`ts.parseJsonConfigFileContent` 可能已对 paths replacement 做解析；适配层喂 kg 算法时须确认 paths/baseUrl 不被「预解析 + kg 再叠加」二次 resolve 算错路径。倾向：适配层只取 raw `baseUrl`/`paths`（相对字符串）交 kg 算法做唯一一次 `path.resolve(configDir, baseUrl, replacement)`；extends 链由 ts API 合并后回吐 raw 值。
- **最高风险点 + 唯一防线**：alias 解析正确性 byte gate 不覆盖（baseline 不用 alias）→ **alias 单测（baseUrl 叠加 / exact-first / extends 链 / wildcard）是唯一防线**，必须充分。回退策略见 §4。

---

## 2. 回归护栏（先建 golden，再重构）

| 护栏 | 实现 | 守护 |
|------|------|------|
| **跨路径一致性测试**（新增） | 同一确定性 TS fixture：AST 路径（analyzeFileInternal）与 batch 路径（collectTsJsCodeSkeletons）解析同一 import → resolvedPath 归一后一致 | 收口正确性 |
| **graph.json byte-identical**（新增 golden） | 确定性 TS fixture（小型，无 LLM）跑 `buildModuleGraphForProject` + `collectTsJsCodeSkeletons` → 提取 imports[].resolvedPath + module depends-on 边 → **按 filePath/source/target 显式排序**（Codex W#1：`walkTsJsFiles` 用无序 `readdirSync`，不排序快照会文件系统抖动伪红）→ `JSON.stringify(.,2)` 快照。**Batch 0 在当前 HEAD 行为下落 golden**，重构全程保持 byte-identical | R1-R5 总闸（ESM map / 绝对路径 / 候选序 / guard） |
| ESM map 专项单测 | `./x.js`→`x.ts`、`.jsx/.mjs/.cjs`、直接命中、候选顺序 | R2/R3 |
| alias 专项单测 | exact-first-wildcard、baseUrl 叠加、extends 链、`~/`/`@/`/`#/` unresolved、scoped/bare external | 1.4 唯一防线 |
| guard 条件化单测 | projectRoot 非空越界→null；projectRoot=''→绝对无 guard | R4/R5 |
| `.json`/`.d.ts` 单测 | 相对 .json/.d.ts→external（固化 R7 期望） | R7 |
| 全量 | `npx vitest run`（现 4111）+ `npm run build` + `npm run repo:check` | 合约不破 |

---

## 3. 分批计划

### Batch 0 — 回归 golden 先行（不动生产代码）
1. 新增 `tests/integration/import-resolver-consolidation.test.ts`（或就近）：
   - 跨路径一致性测试骨架（先对当前双实现跑，确认当前已一致——验证短路逻辑前提）
   - graph.json byte-identical golden：对确定性 TS fixture 落当前行为快照
2. 中间验证：新测试在**当前 HEAD** 全绿（golden 建立）。
3. Codex 对抗审查：golden 是否真覆盖 ESM map / 绝对路径 / 别名缺位场景，有无伪护栏。

> ⚠️ fixture 选择：优先自带小型 TS fixture（含 `./x.js`→`x.ts`、index、相对越界用例）保证确定性 + 快；若复用 src/ 子集需保证无 LLM 依赖。Batch 0 实现时确认。

### Batch 1 — core 权威 resolver + AST 三消费方迁移 + 删死代码（原子批，保 tsc 绿）
1. `core/import-resolver.ts`：
   - 替换为权威 `resolveTsJsImport`（ResolveResult，kg 语义 + ESM map + .mjs/.cjs + 直接命中 + guard 条件化）
   - 迁入 `ResolveResult` / `TsConfigResolutionContext` 类型、统一 loader（`findNearestTsConfig` 升级为 ts.parseJsonConfigFileContent）、共享 helper（`toPosix`/`isInsideProjectRoot`/`isNonSourceTarget`）
   - 删 `detectImportType` / `resolveImportsForFile` / `ImportType` / `ResolveTsJsImportOptions` / 旧 string|null resolveTsJsImport
2. `ast-analyzer.ts`（extractImports 2 调用点）/ `tree-sitter-analyzer.ts`（postProcessTsJsImports）/ `tree-sitter-fallback.ts`（2 调用点）：改用权威 resolver，取 .resolvedPath 归一绝对，签名收 `tsConfigContext`
   - **fallback 透传策略明确（Codex W#3）**：`ast-analyzer.ts:505` ts-morph 失败降级 `analyzeFallback(filePath)` **当前不传 options**（projectRoot/alias 在降级路径本就丢失）。本次**保持现状不新传 options**（护 byte-identical：新传会改 graph）。在计划/代码注释显式记录此为「现状保留，非本次改善点」，并补 fallback 路径单测固化「降级时 alias 失效」期望。
3. `AnalyzeOptions`（language-adapter.ts）：新增 `tsConfigContext?`；**临时保留** pathAliases/baseUrl 兼容（module-derivation 仍传，Batch 2 清理），extractImports 内部旧选项→tsConfigContext 适配或双支持
4. `models/code-skeleton.ts:126`：修正失真注释
5. 测试：删 detectImportType/resolveImportsForFile 测试块；core resolveTsJsImport 测试迁新 API + 补 ESM/ext/guard/.json 用例
6. 中间验证：`tsc --noEmit` + core/ast/tree-sitter 相关单测 + Batch 0 golden 保持绿
7. Codex 对抗审查：ESM map 候选顺序是否逐字节复刻；guard 条件化是否漏 projectRoot='' 分支；删除是否波及 ImportType 外部消费

### Batch 2 — kg 收口 + batch 切源 + module-derivation loader 统一
1. `kg/import-resolver.ts`：删 TS resolver + TS 专属 helper/类型/loader，保留 `resolvePythonImport`（+ PYTHON_BUILTINS + countLeadingDots），下行 import `ResolveResult`/`toPosix`/`isInsideProjectRoot` from core
2. `batch-orchestrator.ts`：`resolveTsJsImport`/`findNearestTsConfig`/`buildTsConfigContext`/`TsConfigResolutionContext` 改 import from `core/import-resolver.js`；`resolvePythonImport` 仍 kg
3. `module-derivation.ts`：删 `loadTsconfigAliases`，改用统一 loader 建 `tsConfigContext`，`analyzerOpts` 由 pathAliases/baseUrl 改为 `tsConfigContext`
4. `AnalyzeOptions`：移除 Batch 1 临时 pathAliases/baseUrl 兼容（彻底切 tsConfigContext）
5. 测试：kg 测试文件 TS 用例迁移/合并到 core 测试；保留 Python 用例
6. 中间验证：`tsc --noEmit` + kg/batch/module-derivation 相关测试 + Batch 0 golden 绿
7. Codex 对抗审查：两条 graph 路径是否都已切权威 resolver；loader 适配（绝对 baseUrl vs kg 相对语义）有无 alias 解析漂移；批 import 切源无 dangling

### Batch 3 — 残留扫描衔接 + 跨路径一致性强化 + 全量验证（Phase 4/5 衔接）
1. 跨路径一致性测试转为「重构后」断言（两路径都走权威 resolver 后仍一致）
2. 全量 `npx vitest run` + `npm run build` + `npm run repo:check`
3. 准备进入 Phase 4 残留扫描

---

## 4. 风险与回滚

- **最高风险**：1.4 loader 适配（绝对 vs 相对 baseUrl 语义）→ alias 单测充分性是唯一防线（baseline 不覆盖）。若适配复杂度超预期，回退策略：保留 `ts.parseJsonConfigFileContent` 解析后**自行做 baseUrl 叠加**（不依赖 kg path.resolve 语义），等价复刻 TS 官方解析。
- **byte-identical 红**：若 golden 在重构后变红，逐条对比 resolvedPath diff，区分 (a) ESM map/候选序回归（必修）vs (b) guard 新拒越界 import（预期改进，确认 baseline 确有越界再决定保留 guard + 更新 golden 说明）。
- **回滚粒度**：每 Batch 独立 commit，红则回退单 Batch。

---

## 4b. Codex 对抗审查采纳（Phase 2，0 critical / 5 warning / 3 info）

| 档 | 发现 | 采纳 |
|----|------|------|
| W#1 | golden 快照受 `walkTsJsFiles` 无序 readdirSync 抖动 | ✅ Batch 0 快照前显式排序（已写入 §2） |
| W#2 | 「nearest 全量统一」扩 scope 会破 byte-identical | ✅ 收窄：仅合一 loader 实现 + alias 算法，保留各路径 tsconfig 选取策略（已写入 §1.4） |
| W#3 | fallback 降级路径 options 丢失 | ✅ 明确保持现状不新传 + 补单测（已写入 Batch 1） |
| W#4 | guard 范围未定义，全局加 guard 会改 alias 语义 | ✅ 逐分支精确复刻 kg（relative+disk-abs 启用，alias/baseUrl 不加）（已写入 §1.3） |
| W#5 | collect 文件扫描扩展（.ts/.tsx/.js/.jsx）与 resolver 处理的 .mjs/.cjs 不齐 | ✅ 本次**不动 collect 扫描扩展**；scope = import **target 解析**对齐（含 .mjs/.cjs target），不保证 .mjs/.cjs 文件被 collect 成节点。golden fixture 不引入 .mjs/.cjs 节点期望 |
| INFO#1 | 循环依赖不成立（module-derivation 已 import core/ast-analyzer，kg→core 早已存在） | ✅ 佐证 §1.1 层级决策安全 |
| INFO#2 | 测试 import 须同步删（import-resolver.test.ts） | ✅ 已在 Batch 1 |
| INFO#3 | paths 双重 resolve 风险 | ✅ 适配层只取 raw 值交 kg 唯一一次 resolve（已写入 §1.4） |

## 5. 估时（修订）

用户选 A（彻底合一）→ **~2-2.5d**（高于规格原估 1.5-2d）：多出 module-derivation loader 统一 + 两套 alias 算法合并 + extends 链适配 + alias 单测补全。规格原估基于「core alias 仅顺手并入」的现已纠正假设。
