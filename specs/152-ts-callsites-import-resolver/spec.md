# Feature Specification: TypeScript callSites + 通用 Import Path 智能解析

**Feature Branch**: `152-ts-callsites-import-resolver`
**Created**: 2026-05-08
**Status**: Draft
**Feature ID**: 152
**前置 Feature**: 151-knowledge-graph-python（已 ship，commit 761488f）

---

## 1. 意图

Feature 151 已建立 UnifiedGraph + call-resolver + Python adapter callSites 框架，但存在两个已知限制：

1. **TypeScript callSites 缺失**：`TypeScriptMapper` 尚未实现 `extractCallSites`，`TsJsLanguageAdapter` 完全不走 TreeSitterAnalyzer，导致 TS 项目 graph.json 中没有 `calls` 边。
2. **Python import 路径解析不完整**：当前 `collectPythonCodeSkeletons` 使用 basename map 临时算法，`from pkg.engine import Value` 等 package 层级导入无法定位到正确文件（`pkg/engine.py`），同名 basename 也存在覆盖风险。

本 Feature 的目标：
- 为 TypeScript 补齐 callSites 抽取能力，与 Python 路径对称
- 实现 Python + TypeScript 共享的 import path 智能解析模块（`src/knowledge-graph/import-resolver.ts`），替换 Python basename map，并为 TS callSites 提供跨模块边解析基础

**本 Feature 不改变**：CallSite schema 字段（沿用 Feature 151 ship 的 `calleeQualifier`）、python-adapter / go-adapter / java-adapter / call-resolver.ts / unified-graph.ts schema / src/mcp/。

---

## 2. 用户场景与验收

### User Story US-001 — TypeScript 项目在 graph.json 中产生 calls 边（优先级：P1）

作为一名在 hono 或自身仓库（self-dogfood）上运行 spectra 的开发者，我希望 graph.json 中能看到函数调用关系（calls 边），而不只有 import 和导出节点，这样我才能基于 graph 进行调用链查询和影响面分析。

**为什么是 P1**：这是本 Feature 的核心交付物。没有 TS callSites，整个 UnifiedGraph 对 TypeScript 项目实际上是空的调用图，其余工作都依赖这一基础能力。

**独立测试**：在 hono 仓库根目录运行 `node scripts/verify-feature-152.mjs --target <hono-root>`，检查输出 graph.json 中 calls 边数量 > 0，precision ≥ 70%，recall ≥ 30%（对比 ts-call-extractor.mjs 产生的 truth set）。

**验收场景**：

1. **Given** hono 仓库包含 150+ 个 `.ts` 文件，**When** 运行 spectra analyze（开启 callSites 模式），**Then** graph.json 的 `edges` 数组中出现 `type: "calls"` 的边，数量 > 0。
2. **Given** self-dogfood 仓库中某 `.ts` 文件含有 `method call`（如 `adapter.analyzeFile()`），**When** spectra 产出 CodeSkeleton，**Then** 该文件的 `callSites` 数组包含对应的 `CallSite`（`calleeKind: "member"`，`calleeQualifier` 填 object 名）。
3. **Given** 某 `.ts` 文件含有 dynamic import（`import('./engine').then(...)`），**When** 抽取 callSites，**Then** 对应 `CallSite` 的 `calleeKind` 为 `"unresolved"`，不抛异常。

---

### User Story US-002 — Python 项目 package 层级导入解析正确命中目标文件（优先级：P1）

作为一名在 micrograd / nanoGPT 上运行 spectra 的用户，我希望 `from micrograd.engine import Value` 这类 package 层级导入能正确被解析到 `micrograd/engine.py`，而不是因为 basename map 只取 `micrograd` 模块名而解析失败，导致跨文件调用边丢失。

**为什么是 P1**：Feature 151 验收报告 follow-up #4 明确将此列为已知限制，是本 Feature 的直接动因。Python import 解析质量直接影响 precision/recall 数值。

**独立测试**：构造 import-resolver 单元测试，输入 `moduleSpec="micrograd.engine"`、`callerFile="micrograd/nn.py"`、`projectRoot="<micrograd-root>"`，断言 `resolvedPath` 等于 `"micrograd/engine.py"` 且 `kind` 为 `"module"`。

**验收场景**：

1. **Given** micrograd 项目，**When** `collectPythonCodeSkeletons` 处理 `from micrograd.engine import Value`，**Then** 该 import 的 `resolvedPath` 正确指向 `micrograd/engine.py`，而非 null。
2. **Given** 某 Python 文件包含 `from . import nn`（相对 import），**When** import-resolver 处理，**Then** 返回同 package 下的 `nn.py` 路径（`kind: "relative-sibling"`）。
3. **Given** 两个文件均叫 `utils.py`（路径 `a/utils.py` 和 `b/utils.py`），**When** 从 `a/main.py` 导入 `from .utils import X`，**Then** 解析到 `a/utils.py` 而非 `b/utils.py`（相对路径优先于 basename 冲突）。

---

### User Story US-003 — TypeScript monorepo 跑 spectra 时 import resolver 正确区分相对路径、tsconfig paths 别名和外部包（优先级：P2）

作为一名在大型 TypeScript monorepo（如 self-dogfood）上运行 spectra 的工程师，我希望 import resolver 能区分 `./engine`（相对路径）、`~/utils`（tsconfig paths 别名）和 `express`（外部包），使 cross-module calls 边只建立在仓库内文件之间，不误将外部包导入标记为仓库内调用。

**为什么是 P2**：这是 TS callSites 的解析质量保障，但不阻塞 US-001 的基础交付（即使 resolver 只处理相对路径，也能产出部分 calls 边）。

**Monorepo 支持取舍（I-1 修复，明确告知）**：本 Feature 仅支持以下 monorepo 解析模式：
- 多个 `tsconfig.json` 通过 nearest-config 选择规则（FR-3.5）
- tsconfig 内 `compilerOptions.paths` wildcard 与 `baseUrl`

**不支持**：
- Webpack alias（仅 webpack.config.js / vite.config.ts 中定义的别名）
- Jest moduleDirectories / moduleNameMapper
- pnpm workspace protocol（`workspace:*`）/ npm workspaces 跨包符号链接
- TypeScript Project References (`references: [{ path: "..." }]`)

如本仓库实际依赖以上模式，需在使用前确认其是否影响 graph.json 准确性；不在本 Feature 范围。

**独立测试**：import-resolver 单元测试覆盖三条路径：相对路径（`./engine` → `src/engine.ts`）、tsconfig paths 别名（`~/utils` → `src/utils/index.ts`）、外部包（`express` → `null`，`kind: "external"`）。

**验收场景**：

1. **Given** tsconfig.json 含 `paths: { "~/*": ["src/*"] }`，**When** import-resolver 处理 `~/utils`，**Then** 返回 `src/utils/index.ts`（或 `src/utils.ts`），`kind: "paths-alias"`。
2. **Given** import specifier 为 `express`，**When** import-resolver 处理，**Then** 返回 `{ resolvedPath: null, kind: "external" }`，不抛异常，不进入文件系统查找。
3. **Given** tsconfig.json 不存在或 paths 字段缺失，**When** 处理 `~/utils`，**Then** resolver fallback 到相对路径逻辑，返回 `{ resolvedPath: null, kind: "unresolved" }`，不崩溃。

---

## 3. 功能需求（Functional Requirements）

### FR-1 TypeScript callSites 抽取 [必须]

**FR-1.1**：`TypeScriptMapper`（`src/core/query-mappers/typescript-mapper.ts`）MUST 实现 `extractCallSites(tree, sourceCode)` 方法，输出符合 `CallSite` schema 的数组。

**FR-1.2**：tree-sitter query 覆盖范围 MUST 完整覆盖 `CalleeKind` enum 全部 7 个值（`free | member | cross-module | dunder | super | decorator | unresolved`）— TS extractor 实际产出的 subset 与触发规则如下：

| 调用形态 | tree-sitter 节点 | `calleeKind` | `calleeQualifier` | 触发规则 |
|----------|------------------|-------------|-------------------|----------|
| `foo()` identifier 调用 | `call_expression > identifier` | `free` | undefined | mapper 始终输出 `free`；call-resolver Stage 1 命中本地 export 高置信，未命中 fallthrough 到 Stage 3 用 importIndex 决策升级为 `cross-module` |
| `this.method()` / `super.method()` 内的 `this`/`super` 形态 | `call_expression > member_expression` | `member`（this） / `super`（super） | undefined | mapper 见 `this`/`super` 直接定 kind，参考 Python mapper L924-936 |
| `Class.method()`（calleeQualifier 大写首字母） | `call_expression > member_expression` | `member` | `Class` 文本（**首字母大写**） | mapper 用首字母大写判定为类成员调用；resolver Stage 2 用 calleeQualifier 在 importIndex / classMemberIndex 定位类 |
| `mod.fn()`（calleeQualifier 小写首字母） | `call_expression > member_expression` | **`cross-module`** | `mod` 文本（**首字母小写**） | **N-1 修复**：与 Python mapper L949-951 严格对齐，mapper **不**把 `obj.method()` 一律输出为 `member`，而是按首字母大小写分流；小写视为模块名/变量名，由 resolver Stage 3 用 importIndex 解析跨模块 |
| `obj?.method()` optional call | `call_expression > optional_chain > member_expression` | 按 `obj` 首字母大小写分流（同上规则） | object 文本 | `[AUTO-RESOLVED: 与普通成员调用同语义，extractor 按首字母大小写规则分流到 member 或 cross-module]` |
| `() => foo()` 箭头函数内部调用 | `arrow_function > body > call_expression` | `free` / `member` | 同上规则 | callerContext 用 enclosing 最近 scope（参考 ts-call-extractor.mjs `_resolveCaller` 嵌套语义） |
| `class Foo { bar() { baz() } }` 类方法内调用 | `method_definition > body > call_expression` | `free` / `member` | 同上规则 | callerContext 形如 `Foo.bar` |
| `import('./engine')` / `import('./engine').then(cb)` 动态 import | `call_expression > 'import' token` | `unresolved` | undefined | extractor 输出 1 个 callSite（`calleeName="import"` + dynamicReason=`dynamic-import`），不为 `.then` 链额外产生 callSite — `[AUTO-RESOLVED W-5: 链式 .then(cb) 的 cb 调用本身归属外层 caller，与 `Promise.then` 语义一致]` |
| `super.method()` / `super()` 构造 | `call_expression > member_expression > 'super'` 或 `call_expression > 'super'` | `super` | undefined | call-resolver Stage 4 走 MRO（与 Python 对齐） |
| `@Decorator` 不带参 / `@Decorator(...)` 带参 | `decorator > call_expression` | `decorator` | undefined | 仅"带参 decorator"产出 callSite（`decorator > call_expression`）；bare decorator (`decorator > identifier`) 与 Python CL-04 对齐 — 不产 callSite |
| `tag\`template\`` tagged template | `call_expression > template_string` 或 `tagged_template_expression` | `free` / `member` | 取 tag 名 | tag 是 identifier → `free`；tag 是 member_expression → `member` |
| `<Foo />` JSX 组件 | `jsx_element > jsx_opening_element > identifier` | scope-out | — | `[AUTO-RESOLVED W-1: JSX 组件调用本质是 React.createElement(Foo, props)，但 tree-sitter 未生成 call_expression，本 Feature 不抽取 JSX 组件调用，留作 Feature 153+ 增量；EC-9 记录]` |
| `eval(...)` / `Function(...)` / `new Function(...)` 动态求值 | `call_expression > identifier='eval'` 等 | `unresolved` | undefined | extractor 标 `dynamicReason='eval-call' | 'new-Function-ctor'`，与 ts-call-extractor.mjs Phase 4D 对齐 |

**TS extractor 不产出的 calleeKind 值**：
- `dunder` — Python 专属（`__add__` 等运算符重载），TS 无对应 AST 节点，不产出（见 CL-08）

**TS extractor 产出的 6 个 calleeKind**：
- `free`：identifier 调用 + IIFE arrow + tagged template (tag 为 identifier) + new Foo() + bare eval-fallback
- `member`：`this.method()` / `Class.method()`（首字母大写 qualifier） / tagged template (tag 为 member_expression) — resolver Stage 2 处理
- `cross-module`：`mod.fn()`（首字母小写 qualifier） — **N-1 修复**：mapper 直接产出，与 Python mapper 严格对齐，resolver Stage 3 用 importIndex 解析；mapper 同时对 `foo()` identifier 调用输出 `free`，由 resolver 在 Stage 1 不命中时 fallthrough 到 Stage 3 用 importIndex 决策升级为 cross-module（与 Feature 151 Python 行为对齐）
- `super`：`super.method()` / `super()` — resolver Stage 4 走 MRO
- `decorator`：带参 decorator (`@Foo()`) — resolver Stage 4
- `unresolved`：dynamic import / eval / chained-callee 等动态/不可静态解析 — resolver Stage 4 兜底

**FR-1.3**：`new Foo()` 构造调用 MUST 映射为 `calleeKind: "free"`（`calleeName` 取构造函数名，类似 Python 的 `Class()`），不新增 kind（`[AUTO-RESOLVED: CallSite schema 不可改，7 种 kind 固定；同时 W-6 验收要求加测试用例确认 `new Foo()` 的 calls 边能与 `class Foo` 节点连通 — 见 SC-008]`）。

**FR-1.4**：`TsJsLanguageAdapter.analyzeFile`（`src/adapters/ts-js-adapter.ts`）MUST 透传 `extractCallSites` flag，当 flag 为 true 时调用 TreeSitterAnalyzer 抽取 callSites 并 merge 到现有分析结果（方案 B，见第 6 节架构决策）。

**FR-1.5**：`callSites` 数组中每个元素 MUST 包含 `calleeName`、`calleeKind`、`line`；`column`、`callerContext`、`calleeQualifier` 为条件必填（类方法上下文时 MUST 填 `callerContext`）。

---

### FR-2 ImportResolver — Python package 路径解析 [必须]

**FR-2.1**：新增模块 `src/knowledge-graph/import-resolver.ts`，MUST 导出函数 `resolvePythonImport(moduleSpec: string, callerFile: string, projectRoot: string): ResolveResult`。

**FR-2.2**：`ResolveResult` 类型定义见 **§4 数据结构**（**N-3 修复**：唯一定义点，避免 FR-2.2 / §4 重复声明导致类型合同歧义）。Python 路径会产出的 `kind` subset：`{'module', 'package-init', 'relative-sibling', 'external', 'unresolved'}`；TS 路径会产出的 subset：`{'relative', 'paths-alias', 'absolute', 'external', 'unresolved'}`。两个 subset 不交叉，但共享同一 ResolveResult 类型（kind union 完整列表见 §4）。

**FR-2.3**：`resolvePythonImport` MUST 支持以下解析场景：
- `from pkg.engine import X` → 尝试 `<root>/pkg/engine.py`，若不存在则尝试 `<root>/pkg/engine/__init__.py`，成功则 `kind: "module"`
- `from pkg import engine`（仅 package 顶层）→ 尝试 `<root>/pkg/__init__.py`，成功则 `kind: "package-init"`
- `from . import nn`（相对 import，以 1 个 `.` 开头）→ 解析为 caller 同目录 `nn.py`，`kind: "relative-sibling"`
- `from .submodule import X` → 同目录 `submodule.py` 或 `submodule/__init__.py`，`kind: "relative-sibling"`
- **`from .. import X` / `from ...module import X`（祖先包，C-4 修复）** → 按 `.` 个数 N 计算 level（PEP 328 语义）：caller 所在目录向上 (N-1) 级 → 同目录 / 子模块查找；上溯越过 `projectRoot` 时 MUST 返回 `{ resolvedPath: null, kind: "unresolved" }`，不抛异常
- 内置模块（`os`、`sys`、`re` 等，仅 Python stdlib）→ `{ resolvedPath: null, kind: "external" }`

**FR-2.4**：解析失败时 MUST 返回 `{ resolvedPath: null, kind: "unresolved" }`，不抛异常。

---

### FR-3 ImportResolver — TypeScript/JS 路径解析 [必须]

**FR-3.1**：`import-resolver.ts` MUST 同时导出 `resolveTsJsImport(moduleSpec: string, callerFile: string, projectRoot: string, tsConfigContext?: TsConfigResolutionContext): ResolveResult`。

**FR-3.1.1**：`TsConfigResolutionContext` 类型定义 MUST 至少包含以下字段（C-3 修复，N-4 修复）：
```
TsConfigResolutionContext = {
  /** tsconfig.json 所在目录的绝对路径（paths 解析的 base） */
  configDir: string;
  /**
   * baseUrl 配置（相对 configDir 的子目录路径）。
   *
   * N-4 修复：调用方负责显式语义化转换：
   * - 用户 tsconfig 未配置 baseUrl → 调用方传 `null`
   * - 用户 tsconfig 设置了 baseUrl → 调用方传相对 configDir 的字符串（如 `"."`、`"src"`）
   *
   * resolver 内部规则（FR-3.2）：
   * - `baseUrl == null` → 跳过 baseUrl 解析（既不 fallback 到 configDir，也不 throw）
   * - `baseUrl != null` → 按 `<configDir>/<baseUrl>/<moduleSpec>` 解析
   */
  baseUrl: string | null;
  /** paths 映射（含 wildcard），key 与 value 保留原始 tsconfig 字符串 */
  paths: Map<string, string[]>;
}
```

**FR-3.2**：`resolveTsJsImport` MUST 支持以下解析场景：
- **相对路径**（`./engine`、`../utils`）→ 按 callerFile 目录计算绝对路径，按 Node.js / TS resolution 顺序候补 `.ts` → `.tsx` → `.js` → `.jsx` → `<dir>/index.ts` → `<dir>/index.tsx` → `<dir>/index.js` → `<dir>/index.jsx`；命中即返回 `kind: "relative"`
- **tsconfig paths 别名**（如 `~/utils` → `src/utils`）→ 命中规则按 wildcard-aware 匹配（C-3 修复）：
  - 无 wildcard（精确 key）：moduleSpec 完全等于 key 时命中
  - wildcard key（如 `~/*`）：moduleSpec 前缀等于 key 去掉 `*` 部分；尾缀替换 value 中的 `*` 占位
  - **多 candidates**：按 paths value 数组顺序逐个尝试，返回首个文件系统命中；全部不命中走 fallback 到下一规则
  - 命中后 `kind: "paths-alias"`
- **baseUrl 解析**（C-3 修复）：当 `baseUrl != null` 且 moduleSpec 不以 `.` 或 `/` 开头时，作为 baseUrl 相对 import（如 `import x from "utils/foo"` → `${baseUrl}/utils/foo.ts`），`kind: "absolute"`
- **node_modules 包**：上述全部 fallback 后，moduleSpec 不以 `.` 或 `/` 开头且无文件命中 → `{ resolvedPath: null, kind: "external" }`
- **磁盘绝对路径**（如 `/src/utils`，罕见但合法）→ 直接尝试文件存在，命中则 `kind: "absolute"`

**FR-3.3**：`tsConfigContext` 为 null/undefined 时，MUST fallback 到仅相对路径 + 磁盘绝对路径解析，不崩溃；tsconfig.json 不存在或解析失败时调用方传入 `null`，resolver 行为相同。

**FR-3.4**：`import-resolver.ts` MUST 为纯函数模块，不依赖全局状态，不引入新的 npm 依赖（Constitution VIII: 纯 Node.js 生态）。

**FR-3.5（monorepo nearest-config 选择规则，C-3 修复）**：当存在多个 `tsconfig.json` 时（如 monorepo），MUST 由调用方（`collectTsJsCodeSkeletons` 或 verify script）按 callerFile 选择 **nearest-config**：
- 算法：从 `path.dirname(callerFile)` 起，逐级向上（`..`）查找最近的 `tsconfig.json` 文件
- 上溯至 projectRoot 仍未命中则返回 `tsConfigContext = null`
- resolver 本身只接收单一 `TsConfigResolutionContext`，不在内部做多 config 切换 — `[YAGNI: 多 config 选择是 batch 调用方职责，resolver 接口保持纯函数]`

---

### FR-4 collectPythonCodeSkeletons 替换 basename map [必须]

**FR-4.1**：`src/batch/batch-orchestrator.ts` 中的 `collectPythonCodeSkeletons` MUST 将当前 basename map 算法替换为调用 `resolvePythonImport`。

**FR-4.2**：替换后，`from pkg.engine import Value` 形态导入 MUST 能正确解析到对应文件，不再只取 topModule 的 basename。

**FR-4.3**：替换后，同名 basename 冲突（`a/utils.py` vs `b/utils.py`）MUST 不再相互覆盖，解析逻辑以相对路径优先。

---

### FR-5 ts-js-adapter 透传 extractCallSites flag [必须]

**FR-5.1**：`TsJsLanguageAdapter.analyzeFile` MUST 接受并透传 `options.extractCallSites` flag 到 callSites 抽取流程。

**FR-5.2**：当 `extractCallSites: false`（默认值）时，TS 分析路径 MUST 与当前行为完全一致，不引入性能回归（Constitution V: AST 精确性优先，CL-05：callSites 仅 panoramic 流水线开启）。

**FR-5.3**：当 `extractCallSites: true` 时，ts-js-adapter MUST 在完成现有 ts-morph 分析后，**额外**调用 TreeSitterAnalyzer 抽取 callSites 并 merge 到结果（方案 B）。

---

### FR-6 collectTsJsCodeSkeletons 新增（与 Python 对称）[必须]

**FR-6.1**：`batch-orchestrator.ts` MUST 新增 `collectTsJsCodeSkeletons` 函数，处理 `.ts`、`.tsx`、`.js`、`.jsx` 文件，与 `collectPythonCodeSkeletons` 结构对称。

**FR-6.2**：`collectTsJsCodeSkeletons` MUST 调用 `resolveTsJsImport` 进行 import 路径解析，将解析结果写入 `CodeSkeleton.imports[].resolvedPath`。**`CodeSkeleton.imports[].resolvedPath` 字段已在 Feature 151 时存在于 `ImportReference` 中**（参见 `src/core/query-mappers/typescript-mapper.ts:772 resolvedPath: null`），TypeScriptMapper 当前总输出 null。本 Feature **不**扩展 schema，仅在 collectTsJsCodeSkeletons 入口对 imports 做一次 map，把 null 替换为 resolver 输出（与 collectPythonCodeSkeletons 处理 Python imports 的方式严格对齐）— 该字段写入是 schema 合规的更新，不引入新字段。

**FR-6.3**：`collectTsJsCodeSkeletons` MUST 在开启 callSites 模式时，通过 TreeSitterAnalyzer（`extractCallSites: true`）收集每个文件的 callSites 并写入 CodeSkeleton。

---

### FR-7 verify script [必须]

**FR-7.1**：MUST 新增 `scripts/verify-feature-152.mjs`，可独立运行（不依赖 LLM batch），验证：
- TS callSites 填充率（SC-001）
- TS call edges precision/recall（SC-002，N=3 中位数）
- Python import 解析正确率（SC-003）
- 单测总数（SC-004）

**FR-7.2**：verify script MUST 复用 `scripts/verify-feature-151.mjs` 的架构（target → analyze → buildUnifiedGraph → graph-accuracy.mjs），并按 `--language ts` 路径调用（**N-5 修复**：与 graph-accuracy.mjs 实际接口字面量一致）。

**FR-7.3**：verify script MUST 支持 `--target <project-root>` 参数，支持 hono 和 self-dogfood 作为 target。

---

### FR-8 graph-accuracy.mjs TypeScript 评估路径 [复用，已交付] (W-3 修复)

**重要修订**：scripts/graph-accuracy.mjs 已经在 **Feature 150 Phase 4D** 交付了 `--language ts` 路径（参见 `scripts/graph-accuracy.mjs:282 analyzeGraphAccuracyTs`），调用 `extractTsCallSites` 已落地（Feature 150 deliverable-report 显示 ts-call-extractor.mjs coverage 100%）。本 Feature 仅需**复用**该路径，**不修改** graph-accuracy.mjs 主流程。

**FR-8.1**：`verify-feature-152.mjs` MUST 通过 `node scripts/graph-accuracy.mjs --language ts --source <root> --graph <graph.json>` 调用现有路径，不修改 graph-accuracy.mjs。

**FR-8.2**：TypeScript precision/recall 计算逻辑沿用 graph-accuracy.mjs 已有的 label-only 匹配实现（与 Python 路径对称）。N=3 中位数由 verify-feature-152.mjs 在脚本层重复 3 次调用 graph-accuracy 实现。

**FR-8.3**：truth set 的 `kind` 字段 MUST 按以下映射对应到 `CallSite.calleeKind`（在 spectra graph 输出层做映射）：
- `method` → `member`
- `function` → `free`（同模块）/ `cross-module`（跨模块，由 call-resolver Stage 3 决策升级）
- `arrow` → `free`（IIFE）或 `member`（callback，calleeQualifier=变量名）
- `constructor` → `free`
- `unresolved` → `unresolved`

**FR-8.4（Python 路径回归保护，W-3 修复）**：本 Feature **不修改** graph-accuracy.mjs 的 Python 路径（`analyzeGraphAccuracyPython`）；verify 阶段 MUST 跑一次 `node scripts/graph-accuracy.mjs --language python --source <micrograd-root>` smoke test，确认 Python 路径输出 schema 与 master HEAD 完全一致（byte-level 比对前后两次输出）。

---

## 4. 数据结构（不改变 schema，仅说明使用方式）

### CallSite（沿用，不改字段）

```
CallSite = {
  calleeName: string;           // 被调用的函数/方法名
  calleeKind: CalleeKind;       // 调用类型（7 种，见 FR-1.2）
  line: number;                 // 调用发生的行号
  column?: number;              // 可选，列号
  callerContext?: string;       // 调用者上下文，如 "ClassName.method"
  calleeQualifier?: string;     // 限定符，如 obj.method 中的 "obj"
}
```

### ResolveResult（新增，import-resolver 输出）

```
ResolveResult = {
  /**
   * 解析后的目标文件路径。
   *
   * 规范（C-6 修复，统一 Python + TS 两个 resolver）：
   * - 路径形式 = 相对于 projectRoot 的 POSIX 风格相对路径（例：`"micrograd/engine.py"`、`"src/utils/foo.ts"`）
   * - 与 Feature 151 python-adapter 行为一致；跨平台/跨机器可复现，便于测试断言
   * - 未命中目标（external 包 / Python 内置 / 解析失败）一律为 null
   * - resolver 不返回绝对路径；调用方需要绝对路径时自行 path.join(projectRoot, resolvedPath)
   */
  resolvedPath: string | null;
  /**
   * 解析路径的语义分类。null 路径必须搭配 'external' 或 'unresolved' kind；
   * 非 null 路径必须搭配下面 5 种"已命中"kind 之一。
   */
  kind:
    // 已命中（resolvedPath 非 null）
    | 'module'              // Python: pkg.engine → pkg/engine.py（含 dotted package）
    | 'package-init'        // Python: from pkg import X → pkg/__init__.py
    | 'relative-sibling'    // Python 相对 import（含祖先包 from .. import）
    | 'relative'            // TS 相对路径（./engine、../utils）
    | 'paths-alias'         // TS tsconfig.compilerOptions.paths 命中
    | 'absolute'            // TS baseUrl 解析或磁盘绝对路径
    // 未命中（resolvedPath 为 null）
    | 'external'            // 明确是外部包/内置（npm 包 / Python stdlib），不再尝试文件查找
    | 'unresolved';         // 解析失败 / 越过 projectRoot / 文件不存在
}
```

**kind ↔ resolvedPath 不变量（C-6 修复）**：
- `resolvedPath != null` ⟺ `kind ∈ {module, package-init, relative-sibling, relative, paths-alias, absolute}`
- `resolvedPath == null` ⟺ `kind ∈ {external, unresolved}`
- `external` 与 `unresolved` 区分语义：
  - `external` = 显式确认（Python stdlib 列表命中 / TS 无 `.` 前缀且 paths 未命中），不再 fall through
  - `unresolved` = 尝试过文件系统但未命中（包括语法不识别 / 越过 projectRoot / 文件 stat 失败）

---

## 5. 约束条件

**CL-01**：`import-resolver.ts` 不引入任何新的 npm 依赖。文件系统访问使用 Node.js 内置 `fs/promises`。

**CL-02**：`CallSite` schema 字段不可修改（`calleeKind` 枚举值固定为 Feature 151 ship 的 7 种）。

**CL-03**：TS callSites 抽取采用方案 B（双路径并行后 merge）：ts-morph 继续主导 exports/imports，TreeSitterAnalyzer 仅在 `extractCallSites: true` 时额外运行产出 callSites。这样不破坏现有 ts-morph 给的高质量静态分析结果。`[推断：方案 B 比方案 A 实现复杂度更低，且明确保留 NFR-1 性能边界（CL-05）]`

**CL-04**：import-resolver 仅实现当前必要范围（Python pkg 路径 / TS 相对路径 / TS tsconfig paths），不支持 Webpack alias、Jest moduleDirectories、monorepo workspace protocol（Constitution III: YAGNI）。

**CL-05**：`extractCallSites: true` 仅在 panoramic 流水线（spectra batch 模式）下开启，默认不影响 MCP 工具的常规调用路径。

**CL-06**：不修改 `python-adapter.ts`、`go-adapter.ts`、`java-adapter.ts`、`call-resolver.ts`、`unified-graph.ts`、`src/mcp/` 下任何文件。

**CL-07**：tree-sitter query 仅用于 callSites 抽取，不替换 ts-morph 在 exports/imports 上的主路径。

**CL-08（C-1 修复）**：TypeScriptMapper.extractCallSites 在本 Feature 中**不产出** `dunder` calleeKind。dunder 是 Python 专属语义（`__add__` / `__sub__` 等运算符重载），TS 无对应 AST 节点。`CallSite.calleeKind` enum 沿用 Feature 151 的 7 种值；TS extractor 实际产出 6 种（free / member / cross-module / super / decorator / unresolved）— `cross-module` 由 call-resolver Stage 3 决策升级而非 mapper 直接产出。

---

## 6. 关键架构决策

### Feature 151 兼容合约（C-8 修复）

**call-resolver 输入合同**（`src/knowledge-graph/call-resolver.ts`，本 Feature 不改）：
```
resolveCalls(callSites: CallSiteWithFile[], codeSkeletons: Map<string, CodeSkeleton>): UnifiedEdge[]
```
- `CallSiteWithFile = CallSite & { callerFile: string }`
- 内部派生 4 个索引（moduleSymbolIndex / classMemberIndex / importIndex / classMroIndex）

**importIndex 建立方式**（已由 call-resolver 内部 `buildImportIndex` 完成，本 Feature 不改）：
- 输入：`codeSkeletons[file].imports[]`
- 关键字段：`namedImports[]`、`defaultImport`、`moduleSpecifier`、**`resolvedPath`**
- 旧（Feature 151）：`resolvedPath` 在 `collectPythonCodeSkeletons` 中由 basename map 派生
- 新（本 Feature）：`resolvedPath` 改由 `resolvePythonImport` / `resolveTsJsImport` 派生（FR-4 / FR-6.2）
- importIndex 期望 `resolvedPath` 是项目内文件路径（**call-resolver 期望相对 callerFile 还是绝对路径，必须由实现验证 — 见 EC-10 修复描述**）

**EC-10 importIndex resolvedPath 路径形态对齐（C-8 修复，下移到 §7 Edge Cases）**：
- 触发：FR-2.2 / FR-3.x / FR-6.2 写入 `resolvedPath` 时使用什么路径形态
- 决议：**统一相对 projectRoot 的相对路径**（与 ResolveResult.resolvedPath 同源），保证：
  - call-resolver 的 importIndex / starImportTargets Set 比较时与 codeSkeletons Map key 形态一致 — 这要求 codeSkeletons Map key 也使用相对 projectRoot 路径
  - implement 阶段 MUST 在 `collectPythonCodeSkeletons` / `collectTsJsCodeSkeletons` 入口做一次显式 normalize（path.relative + POSIX 化）
  - 若 Feature 151 既有 codeSkeletons Map key 是绝对路径（实测代码：`out.set(filePath, resolvedSkeleton)` — `filePath` 是绝对路径），则本 Feature **不修改 Map key 形态**，而是把 `resolvedPath` 写成绝对路径（与 Map key 同形态），这与 ResolveResult 对外约定（相对路径）解耦 — `[AUTO-RESOLVED: 对外接口（ResolveResult）保留相对路径，对内桥接（写入 imports.resolvedPath）转换为与 codeSkeletons Map key 同形态的绝对路径，由 collect* 函数内显式 path.resolve（implementation detail）]`

**calleeQualifier 不变性合约（C-8 修复）**：
- 本 Feature 不修改 `CallSite.calleeQualifier` 字段语义（沿用 Feature 151 P1 C-2）
- TS extractor 的 calleeQualifier 取值规则与 Python 对齐：
  - `obj.method()` → `calleeQualifier = "obj"`（小写=变量/模块名 → resolver Stage 3 cross-module 决策）
  - `Class.method()` → `calleeQualifier = "Class"`（大写首字母 → resolver Stage 2 member 决策）
  - `this.method()` / `super.method()` / 顶层 `foo()` → `calleeQualifier = undefined`

### 决策 1：TS callSites 路由方案（方案 B）`[推断]`

**背景**：`TsJsLanguageAdapter.analyzeFile` 当前完全走 ts-morph（`analyzeFileInternal`），不经过 TreeSitterAnalyzer。引入 callSites 抽取有两种方案：

- **方案 A**：当 `extractCallSites: true` 时，整体切换到 TreeSitterAnalyzer（与 Python 一致）
- **方案 B**：ts-morph 路径继续处理 exports/imports，仅当需要 callSites 时**额外**调用 TreeSitterAnalyzer 并 merge

**选择方案 B 的理由**：
1. ts-morph 提供类型推断，给 exports/imports 更高质量（类型信息、接口解析），切换到 tree-sitter 会降级这部分质量
2. TreeSitterAnalyzer 已注册 TypeScriptMapper（`tree-sitter-analyzer.ts L102`），额外调用路径已就绪
3. 方案 A 需要重写 ts-morph 路径的全部调用方（风险面大），方案 B 是最小侵入式改动
4. 性能：callSites 是可选特性（CL-05），额外的 tree-sitter pass 只在 panoramic 模式下发生

**权衡**：方案 B 对同一文件运行两次（ts-morph + tree-sitter），有轻微性能开销。NFR-2 给出 ≤ 3s 限制（150 文件），可接受。

### 决策 2：动态 import 映射为 unresolved `[AUTO-RESOLVED: dynamic import 无法静态确定目标，unresolved 是唯一符合语义的 kind，无需澄清]`

### 决策 3：new Foo() 映射为 free `[AUTO-RESOLVED: CallSite schema 7 种 kind 固定，constructor 未列入，free 语义最接近且 truth set extractor 已有对应映射]`

---

## 7. 边界条件（Edge Cases）

**EC-1 .tsx 文件 tree-sitter grammar 支持说明**
- 触发：某 `.tsx` 文件包含 JSX 语法
- 处理：`[推断: tree-sitter TypeScript grammar 支持 tsx dialect（language.name = "tsx"），实现时优先尝试 tsx dialect 解析 .tsx 文件；若 grammar 不含 tsx dialect（取决于 node-tree-sitter-typescript 版本），则走 parse-error 路径（返回空 `callSites: []`，记录 `parseErrors` 字段），不阻塞其他文件处理]`
- 关联：FR-1.2，FR-5.3

**EC-2 tsconfig.json 不存在或 paths 字段缺失**
- 触发：项目无 tsconfig.json，或 tsconfig 无 compilerOptions.paths
- 处理：`resolveTsJsImport` 的 `tsConfigPaths` 参数为 null，仅执行相对路径解析；别名路径返回 `{ resolvedPath: null, kind: "unresolved" }`
- 关联：FR-3.3

**EC-3 Python 相对 import（`from . import X`）**
- 触发：`from . import nn`，`.` 开头，当前 basename map 完全不处理
- 处理：`resolvePythonImport` 识别 `.` 前缀，以 callerFile 同目录为基准查找 `nn.py` 或 `nn/__init__.py`
- 关联：FR-2.3

**EC-4 Python 循环 import（A→B→A）**
- 触发：两个 Python 文件互相导入
- 处理：resolver 仅做单跳路径查找（文件系统级别），不递归进入被解析文件，不构建子图，无循环风险
- 关联：FR-2.1

**EC-5 Python 同名 basename 冲突（`a/utils.py` 和 `b/utils.py`）**
- 触发：basename map 中后写入的覆盖前写入
- 处理：`resolvePythonImport` 使用 dotted path（`pkg.utils`）+ callerFile 上下文计算路径，不依赖 basename map，冲突不再发生
- 关联：FR-4.3

**EC-6 TS import 指向 JSON 或 .d.ts 文件**
- 触发：`import data from './config.json'` 或 `import type { Foo } from './types.d'`
- 处理：resolver 不将 JSON / .d.ts 文件路径计入 callSites graph（callSites 仅处理 .ts/.tsx/.js/.jsx 源文件）；返回 `{ resolvedPath: null, kind: "external" }`
- 关联：FR-3.2

**EC-7 Python 内置模块导入**
- 触发：`from os import path`、`import sys`
- 处理：`resolvePythonImport` 维护内置模块列表（`PYTHON_BUILTINS`），仅涵盖 Python 标准库（stdlib），不含第三方包（如 `numpy`、`torch`）。`[推断: 第三方包无法在文件系统中找到对应 .py 文件，会自然落入 "unresolved"，与 "external" 区分——external 仅表示"明确是外部/内置，无需查找"，第三方包走 unresolved 更准确]` 命中 PYTHON_BUILTINS 后直接返回 `{ resolvedPath: null, kind: "external" }`，不尝试文件系统查找
- 关联：FR-2.3

**EC-8 超深 package 路径（`from a.b.c.d.e import X`）**
- 触发：多层 package 嵌套
- 处理：`resolvePythonImport` 将 dotted path 转换为文件路径（`a/b/c/d/e.py`），逐级尝试，路径深度不限；若文件不存在则返回 `unresolved`
- 关联：FR-2.3

**EC-9 JSX 组件调用（`<Foo />`）— scope-out (W-1 修复)**
- 触发：`.tsx` 中含有 `<Foo />` / `<Bar.Sub prop={x} />` 等 JSX 组件
- 处理：本 Feature **不**抽取 JSX 组件作为 callSite。tree-sitter 把 `<Foo />` 解析为 `jsx_element`/`jsx_self_closing_element`，未生成 `call_expression`，extractor 自然跳过。**留作 Feature 153+ 增量** — JSX 组件调用本质是 React.createElement(Foo, ...) 调用，未来若需建模需要在 mapper 层独立 visitor。
- 关联：FR-1.2 表"JSX 组件"行；本 Edge Case 显式标 scope-out 防止 spec 漂移

**EC-10 importIndex resolvedPath 路径形态对齐（C-8 修复，详见 §6 Feature 151 兼容合约）**
- 触发：`collectPythonCodeSkeletons` / `collectTsJsCodeSkeletons` 写入 `imports[].resolvedPath` 时，路径形态需与 codeSkeletons Map key 一致才能让 call-resolver `buildImportIndex` 正确建索引
- 处理：collect 函数内显式 path.resolve（绝对路径，与 Map key 同形态）；ResolveResult 对外约定相对路径，桥接转换为绝对路径仅是 collect 函数 implementation detail
- 关联：FR-4.1, FR-6.2

**EC-11 ts-morph + tree-sitter 双路径 callSites 唯一性（C-7 修复，方案 B 边界）**
- 触发：方案 B 下，ts-morph 主路径不抽 callSites，tree-sitter 路径补 callSites；两个路径都解析同一个 .ts 文件
- 处理：方案 B 实施时 MUST 保证 callSites 仅由 tree-sitter 路径产生，**不**与 ts-morph 输出做任何 callSite-level merge（ts-morph 不产 callSites 字段）。`CodeSkeleton` 其他字段（exports/imports）由 ts-morph 主导，tree-sitter 路径返回的 exports/imports 在合并时 MUST discard，仅保留其 callSites 字段
- 关联：CL-03, FR-1.4, FR-5.3

**EC-12 baseUrl 不带 paths 的纯 baseUrl 解析 (C-3 修复延伸)**
- 触发：tsconfig.json 仅设置 `compilerOptions.baseUrl`（如 `"./src"`），未设置 `paths`
- 处理：`resolveTsJsImport` 当 moduleSpec 不以 `./` `../` `/` 开头且无 paths 命中时，如果 `tsConfigContext.baseUrl != null`，按 baseUrl 解析（`<configDir>/<baseUrl>/<moduleSpec>`），命中则 `kind: "absolute"`
- 关联：FR-3.2 (baseUrl 解析行)

**EC-13 TS export-from / re-export 链路 — scope-out (W-1 修复)**
- 触发：`export { foo } from './module'` / `export * from './module'`
- 处理：本 Feature **不**追踪 re-export 链路。`TypeScriptMapper.extractCallSites` 不分析 export_statement；resolver 不递归解析 re-export 多跳。**留作 Feature 153+ 增量** — re-export 是图论上的边折叠问题，与 callSite 抽取正交，单独 Feature 处理更合适。
- **影响**：当 `import { foo } from './re-export'` 引用一个 re-export 时，importIndex 中 alias `foo` 的 target 是 `./re-export`，而不是真实的源文件。这会导致跨模块 calls 边的 target 比真实路径少一跳，但 confidence tier 仍由 call-resolver 正确分配为 `medium`（cross-module，非 star）— 不影响整体 graph 可用性
- 关联：CL-04 (YAGNI), TD-6 (新增技术债务)

---

## 8. 测试覆盖

**新增单测（≥ 8 条，目标 14+ 条）**：

| 测试文件 | 覆盖场景 | 数量 |
|---------|---------|------|
| `tests/unit/typescript-mapper-callsite.test.ts` | function call / method call / optional call (`obj?.method()`) / arrow function / class method / dynamic import / super call / decorator (含 bare/带参) / new expression / tagged template / eval+new Function | 10+ |
| `tests/unit/knowledge-graph/import-resolver.test.ts` | Python pkg.engine / Python 相对 import 单点 / Python 祖先包 (`from .. import X`) / Python 内置模块 / TS 相对路径 / TS tsconfig paths wildcard / TS baseUrl 纯绝对路径 / TS 外部包 / TS tsconfig 不存在 fallback / monorepo nearest-config 选择 | 10+ |

**FR / EC ↔ AC 映射表（W-2 修复，每个需求点至少 1 个验收）**：

| 需求 | 验收方式 |
|------|----------|
| FR-1.2 7 种 calleeKind 触发规则 | typescript-mapper-callsite.test.ts 各 calleeKind ≥ 1 用例 |
| FR-1.3 new Foo() → free | typescript-mapper-callsite.test.ts 含 `new Foo()` 用例（验 calleeName="Foo"，kind="free"） |
| FR-1.5 column / callerContext / calleeQualifier 条件必填 | typescript-mapper-callsite.test.ts 类方法用例 assert callerContext = "Foo.bar" |
| FR-2.3 from .. import X | import-resolver.test.ts 祖先包用例 |
| FR-2.3 越过 projectRoot 不抛异常 | import-resolver.test.ts 边界用例 |
| FR-3.1.1 TsConfigResolutionContext 字段 | import-resolver.test.ts paths wildcard + baseUrl 用例 |
| FR-3.5 monorepo nearest-config | import-resolver 单测含 `findNearestTsConfig` helper 验证 |
| FR-4.3 同名 basename 不再覆盖 | import-resolver.test.ts a/utils.py vs b/utils.py 用例 |
| FR-5.2 extractCallSites=false 性能不回归 | verify-feature-152.mjs 测量 baselineMs（与 master HEAD 实测对比） |
| FR-6.1 .ts/.tsx/.js/.jsx 全覆盖 | collectTsJsCodeSkeletons 单测扫描 4 种扩展名 |
| FR-7 verify script 独立可跑 | SC-007 命令行 smoke test |
| FR-8.4 Python 路径不回归 | verify 阶段 byte-level 比对 graph-accuracy --language python 输出 |
| EC-1 .tsx grammar | typescript-mapper-callsite.test.ts 含 .tsx fixture 用例（既测 tsx dialect 解析成功，也测无 dialect 时 parse-error 不阻塞） |
| EC-3 Python 单点相对 import | import-resolver.test.ts `from . import nn` 用例 |
| EC-9 JSX scope-out | typescript-mapper-callsite.test.ts 含 `<Foo />` fixture，断言 `callSites` 中**不含** `Foo` 调用记录（验证 scope-out 行为可观察） |
| EC-10 path 形态对齐（绝对路径桥接） | collectPythonCodeSkeletons / collectTsJsCodeSkeletons 集成测验：写入 `imports[].resolvedPath` 后 byte-level 与 codeSkeletons Map key 同形态（path.isAbsolute 断言） |
| EC-11 双路径 callSites 唯一性 | ts-js-adapter.analyzeFile 集成测验 `extractCallSites: true` 后 `CodeSkeleton.exports` 来自 ts-morph（含类型信息）、`callSites` 来自 tree-sitter，不交叉污染 |
| EC-12 baseUrl 纯绝对路径 | import-resolver.test.ts 含 tsConfigContext = `{configDir, baseUrl: "src", paths: empty Map}` 用例，断言 `import x from "utils/foo"` 解析为 `src/utils/foo.ts` |

**验收阈值**：
- 新增 ≥ 8 单测全数 pass（目标 ≥ 14 条达到所有 FR/EC AC 覆盖）
- 现有 3155 单测继续 pass（零失败）
- `npm run build` 零 TypeScript 类型错误
- `npm run lint`（项目级 verification_policy.required_commands）零 lint 错误

**verify script 覆盖**：
- `scripts/verify-feature-152.mjs` 独立可跑，不依赖 LLM
- 覆盖 SC-001 ~ SC-003、SC-006、SC-008 的量化指标采集

---

## 9. 依赖关系

**依赖的已有制品**：
- `src/models/call-site.ts`（Feature 151，不改）
- `src/knowledge-graph/call-resolver.ts`（Feature 151，不改）
- `src/knowledge-graph/unified-graph.ts`（Feature 151，不改）
- `src/core/tree-sitter-analyzer.ts`（TypeScriptMapper 已注册，可直接使用）
- `src/core/query-mappers/base-mapper.ts`（`extractCallSites?` 接口方法）
- `scripts/lib/ts-call-extractor.mjs`（truth set 生成器，Feature 150 Phase 4D）
- `scripts/graph-accuracy.mjs`（precision/recall 计算，**已支持 `--language ts`**，Feature 150 Phase 4D 交付，本 Feature 不修改）
- `scripts/verify-feature-151.mjs`（verify 脚本模板）

**被依赖（本 Feature 交付后可启动）**：
- Feature 153+：TS 调用图进一步的语义增强（类型推断 calleeKind 细化等）
- Feature 156（sqlite 持久化）：DependencyGraph shim 改造

**不依赖**：
- LLM batch 流水线（verify script 纯静态）
- 新的 npm 包

---

## 10. 成功标准（Success Criteria）

### SC-001 TypeScript callSites 填充率 ≥ 95%
- **测量对象**：self-dogfood 仓库中 `callSites.length > 0` 的 .ts/.tsx 文件数 / truth set 中含调用的文件数
- **truth set 来源**：`scripts/lib/ts-call-extractor.mjs`（与 SC-002 共用同一生成器，**与 SC-002 共享 truth set 口径以确保指标可比**）
- **测量工具**：`scripts/verify-feature-152.mjs --target <self-dogfood-root> --metric fill-rate`
- **阈值**：≥ 95%

### SC-002 TypeScript call edges precision ≥ 70% / recall ≥ 30%
- **测量对象**：hono 和 self-dogfood，对比 ts-call-extractor.mjs truth set，N=3 中位数
- **测量工具**：`node scripts/verify-feature-152.mjs --target <root> --repeats 3`
- **阈值**：precision ≥ 70% 且 recall ≥ 30%

**Baseline 实测数据（C-5 修复，2026-05-08 在本 worktree 跑）**：

| target | files | truth callsTotal | uniqueCallTargets | parse warnings | warning ratio |
|--------|-------|------------------|-------------------|----------------|---------------|
| ~/.spectra-baselines/hono/src | 295 .ts | 26263 | 941 | 152 | 0.58% |
| ./src（self-dogfood） | ~250 .ts | 14395 | 1705 | 54 | 0.38% |

**阈值依据（解决 C-5 "拍脑袋" 质疑）**：
1. **算法对称性**：Feature 152 TypeScriptMapper.extractCallSites 与 ts-call-extractor.mjs 共用 tree-sitter-typescript grammar，walker 算法基本对称（call_expression / member_expression / new_expression / decorator > call_expression），理论 callee-name 应高度匹配
2. **label-only 匹配天花板**：与 Feature 151 Python 同样采用 label-only 匹配，重名 callee 会被合并 → recall 上限受 uniqueCallTargets 控制（hono: 941, self-dogfood: 1705）
3. **Feature 151 Python 实测对照**：micrograd precision=95.7%, recall=61.1%；nanoGPT precision=77.1%, recall=36.2% — 算术均值 86.4% / 48.7%
4. **TS 阈值保守化**：考虑 (a) parse warnings 比 Python 略高（hono 0.58% > Python 0.06%），(b) TS 调用形态更复杂（generics / IIFE / dynamic import），(c) ts-morph 主路径 + tree-sitter callSites 双路径合并可能引入轻微 inconsistency — 设阈值 precision ≥ 70%（低于 Python 实测但留 ~25% 缓冲）/ recall ≥ 30%（与 Python 阈值对齐）
5. **N=3 必要性**：算法 deterministic（与 Python 一致），N=3 主要是防御 fs 顺序差异 / Map 迭代顺序差异；与 Feature 151 验收模式一致
6. **阈值调整规则**：implement 阶段第一次跑出 baseline 后，若实测 precision/recall 远高于阈值（如 ≥ 90%/60%），verify 阶段 MUST 在 verification-report.md 中记录，并提议在 follow-up 中提升阈值；若低于阈值则视为 SC-002 fail 必须修复

### SC-003 Python package 层级导入解析正确率 ≥ 80%
- **测量对象**：micrograd + nanoGPT 中 `from pkg.module import X` 形态 import，resolver 正确命中目标文件的比例
- **测量工具**：`scripts/verify-feature-152.mjs --target <project-root> --metric python-resolution`
- **阈值**：≥ 80%（两项目均值）

### SC-004 单测全数 pass
- **测量工具**：`npx vitest run`
- **阈值**：新增 ≥ 8 单测全 pass；现有 3155 单测继续 pass（零失败）

### SC-005 import-resolver 模块独立可测
- **验证方式**：`import-resolver.ts` 可在不启动 batch-orchestrator 或 TreeSitterAnalyzer 的前提下单独 import 并调用
- **阈值**：import-resolver 单测无需 mock TreeSitterAnalyzer 等重型依赖

### SC-006 NFR 性能：TS callSites end-to-end 增量成本（C-7 修复）
- **测量对象**：hono `src/`（baseline 295 .ts 文件，C-5 实测）— 不再用估算值 "150 .ts"
- **测量工具**：`verify-feature-152.mjs` 输出 wall clock time（end-to-end，包含双路径 ts-morph + tree-sitter）
- **测量方式**：
  1. 计时 baseline：`extractCallSites: false` 的 ts-morph 单路径
  2. 计时 enable：`extractCallSites: true` 的方案 B 双路径（ts-morph + tree-sitter merge）
  3. 增量成本 = enable - baseline
- **阈值**：
  - **增量成本 ≤ 5000ms**（hono 295 .ts 文件，标准笔记本硬件 — Apple Silicon M1+ / Intel i7+，Node.js 20.x，热缓存）
  - 仅记录 end-to-end，不再单独要求 tree-sitter 子路径时间
- **测量环境记录**：verify-feature-152.mjs 输出 JSON 中 MUST 包含 `{nodeVersion, platform, cpuCount, baselineMs, enableMs, deltaMs}`
- **超阈处理**：超出 5s 阈值视为 SC-006 fail；implement 阶段优先优化（如复用 tree-sitter parse 树而非重 parse），实在不可压缩留作 TD-4 性能债务，verify 必须明确记录

### SC-007 verify-feature-152.mjs 独立可跑
- **验证方式**：`node scripts/verify-feature-152.mjs --help` 不报错；`node scripts/verify-feature-152.mjs --target <path>` 在无 LLM 环境下完整运行
- **阈值**：exit code 0，输出 SC-001 ~ SC-003、SC-006、SC-008 数值

### SC-008 new Foo() 构造调用与 class Foo 节点 graph-level 连通（W-6 修复，N-2 修复）
- **测量对象**：self-dogfood 仓库中 `new XXX()` 调用，且 `XXX` **是本仓库 export 的 class**（通过 self-dogfood codeSkeleton.exports 中 kind="class" 名单交集得到分母）
- **N-2 修复**：分母**不**包含内置 `Map/Set/Array/Date/RegExp/Error/Promise` 等 JS 内置构造，**也不**包含外部包构造（如 `new express.Router()`）。仅限"本仓库 export class"的 `new`，避免阈值不可执行
- **测量工具**：verify-feature-152.mjs 的 graph-spot-check 子流程：
  1. 收集所有 codeSkeleton.exports 中 `kind="class"` 的 export name 集合 = `localClassNames`
  2. 扫描所有 callSites，过滤 `calleeName ∈ localClassNames` 且来自 `new` 上下文（mapper 在 callSite metadata 中标 `viaNew: true`，或对照 truth-set 中 `kind=constructor` 的条目）
  3. 在 graph.json 中查找这些 callSites 对应的 calls 边 target，断言 target 是 `class XXX` 的 component 节点
- **阈值**：≥ 80%（hits / 本仓库 class new 调用总数）
- **失败处理**：低于 80% 视为 SC-008 fail，触发对 ts-js-mapper extractCallSites 的修订，确保 `new Foo()` 产出的 callSite 能被 call-resolver 命中本地 class export

---

## 11. 技术债务记录

**TD-1 Python 路径三重扫描**（Feature 151 follow-up #5）：`buildDependencyGraph` + `extractSymbolNodes` + `collectPythonCodeSkeletons` 三处独立扫描 .py 文件，本 Feature 不合并（scope 外），留给 Feature 155/156 性能优化阶段。

**TD-2 TS 类型推断辅助 calleeKind 细化**：当前 tree-sitter 路径无法区分同名的本地 free 调用和跨模块 free 调用（依赖 importIndex 决策），本 Feature 仅做 label-only 匹配，精细化留后续。

**TD-3 tsconfig paths 懒加载**：`resolveTsJsImport` 的 `tsConfigContext` 目前由调用方传入，意味着 batch-orchestrator 需要在启动时解析 tsconfig.json。懒加载 / 缓存机制留 Feature 156 处理。

**TD-4 ts-morph + tree-sitter 双路径性能优化**（C-7 修复延伸）：方案 B 下，extractCallSites=true 时同一 .ts 文件经 ts-morph 解析一次（exports/imports）+ tree-sitter 解析一次（callSites）。SC-006 增量成本 ≤ 5s（hono 295 文件），可接受但有优化空间：未来可考虑 (a) tree-sitter 路径缓存 parse 树跨 batch 复用，(b) 当 extractCallSites=true 时整体切换到方案 A（tree-sitter 主导，舍弃 ts-morph 类型推断）。本 Feature 不实施。

**TD-5 baseline gate 形式化**（W-4 修复）：本 spec 已在 §10 SC-002 中嵌入 baseline 实测数据（hono 26263 truth calls / 941 unique；self-dogfood 14395 / 1705），并明确阈值依据。spec-driver-feature 流程的 research-synthesis.md 在 story 模式下被跳过，但本 Feature 因为依赖 truth set baseline，已通过 spec.md SC-002 章节"补"了 baseline data — 该模式可作为 spec-driver-story 模式的"轻量 research gate"参考。后续若 Feature 涉及精确 baseline，建议提前在初始化阶段跑一次 truth-set 数据采集，而非全跳过。

**TD-6 TS re-export 链路追踪**（W-1 修复，EC-13 关联）：本 Feature 不分析 `export { foo } from './x'` / `export * from './x'`，导致 importIndex 在 re-export 模式下 target 比真实源文件少一跳。Feature 153+ 可在 ts-morph 路径中加 re-export 解析，配套修订 call-resolver Stage 3。本 Feature 不实施。

---

## 12. 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数量 / 状态 |
|------|------------|
| 组件总数（新增） | 3（`import-resolver.ts`、`typescript-mapper.ts` extractCallSites 方法、`verify-feature-152.mjs`） |
| 接口数量（新增/修改） | 4（`resolvePythonImport`、`resolveTsJsImport`、`TypeScriptMapper.extractCallSites`、`TsJsLanguageAdapter.analyzeFile` 签名扩展） — `graph-accuracy.mjs --language ts` 已存在 Feature 150 不计入 |
| 依赖新引入数 | 0（不引入新 npm 包） |
| 跨模块耦合 | 是（修改 `batch-orchestrator.ts`、`ts-js-adapter.ts`、`typescript-mapper.ts`，各模块接口独立） |
| 复杂度信号 | 无递归结构、无状态机、无并发控制、无数据迁移；文件系统 I/O 为同步/顺序 |
| **总体复杂度** | **MEDIUM**（组件 3，接口 5，1 个跨模块耦合信号） |

**MEDIUM 判定理由**：组件数 < 5 但接口数在 4-8 范围，且涉及 2+ 个现有模块的接口修改（`batch-orchestrator` + `ts-js-adapter`）。无高风险复杂度信号（无状态机/并发），可由单次 implement phase 交付，无需额外人工架构审查，但建议 Codex 对抗审查覆盖 `import-resolver.ts` 的边界处理逻辑。

---

## 澄清记录（自动）

### Session 2026-05-08 — clarify Agent 自动澄清

| # | 问题 | 自动选择 | 理由 |
|---|------|---------|------|
| 1 | FR-2.2 `resolvedPath` 注释写"绝对路径"但 US-002 验收断言使用相对路径（`"micrograd/engine.py"`），存在矛盾 | 统一为**相对于 projectRoot 的相对路径** | 与 Feature 151 python-adapter 的 resolvedPath 写法一致；相对路径跨机器可复现，且测试断言可直接比较字符串，无需处理绝对路径前缀差异 |
| 2 | EC-1 表述"tree-sitter TypeScript grammar 解析报错"，但 tree-sitter-typescript 实际提供 tsx dialect，不一定报错 | 优先尝试 tsx dialect，仅在无 tsx dialect 时走 parse-error 路径 | 与实际 tree-sitter-typescript 库能力对齐，避免不必要的空 callSites；实现时按运行时检测 dialect 可用性 |
| 3 | SC-001 "truth set 中含调用的文件数"未指定 truth set 来源脚本 | 明确 truth set 来源为 `scripts/lib/ts-call-extractor.mjs` | 与 SC-002 共用同一生成器，避免两套口径；SC-002 已明确使用该脚本 |
| 4 | FR-6.2 `CodeSkeleton.imports[].resolvedPath` 表述"若字段已存在"，未确认字段是否在当前 schema 中 | 实现时不扩展 schema，仅在字段存在时写入；否则仅作为 callSites import-context 内部状态 | 遵循 CL-06 约束（不改 schema），与 Feature 151 "不改 schema 字段"原则一致 |
| 5 | EC-7 `PYTHON_BUILTINS` 列表范围未明确（是否含第三方包如 numpy） | 仅含 Python 标准库（stdlib），不含第三方包 | 第三方包无法静态枚举且会误识别（不同项目依赖不同）；第三方包走 unresolved 语义上更准确（"解析失败"而非"明确外部"） |

### Session 2026-05-08 — Codex 对抗审查 V1 修复

Codex 在 spec.md V1（commit 前）发现 **8 CRITICAL + 6 WARNING + 2 INFO**，全部已在本版本修复（V2）：

| Codex 编号 | 问题 | 修复位置 |
|-----------|------|---------|
| C-1 | calleeKind 内部不一致（cross-module / dunder 缺失） | FR-1.2 表格全部 7 种 enum 列出 + CL-08 dunder 不产出说明 |
| C-2 | JSX / tagged template / optional call 未定义 | FR-1.2 表新增 optional call、tagged template、JSX scope-out 行 |
| C-3 | TS import resolver monorepo / baseUrl / wildcard 未定义 | FR-3.1.1 新增 TsConfigResolutionContext + FR-3.2 baseUrl + FR-3.5 nearest-config |
| C-4 | Python `from .. import X` 未覆盖 | FR-2.3 新增祖先包行 + 越界返回 unresolved |
| C-5 | SC-002 阈值无 baseline 依据 | SC-002 加入 hono 26263 / self-dogfood 14395 实测 baseline + 阈值依据 6 条 |
| C-6 | ResolveResult 路径/kind 语义边界不封闭 | §4 ResolveResult 新增"kind ↔ resolvedPath 不变量"+ external/unresolved 区分 |
| C-7 | 性能验收路径不真实（仅测 tree-sitter 不含 ts-morph） | SC-006 改为 end-to-end 增量成本（baseline vs enable）+ ≤ 5s 阈值 |
| C-8 | Feature 151 graph 合约交接不完整 | §6 新增"Feature 151 兼容合约"块 + EC-10 路径形态对齐 |
| W-1 | re-export 链路缺失 | EC-9 JSX scope-out 同时记录 re-export 不在本 Feature 范围 |
| W-2 | FR/EC 没对应 AC | §8 新增"FR / EC ↔ AC 映射表" |
| W-3 | graph-accuracy.mjs --language ts 已存在（Feature 150） | FR-8 改为复用 + 新增 FR-8.4 Python 路径回归保护 |
| W-4 | Story 模式跳过调研但依赖 truth set baseline | TD-5 形式化 baseline gate 经验 |
| W-5 | dynamic import .then(...) 粒度不清 | FR-1.2 表 dynamic import 行明确"输出 1 个 callSite，不为 .then 链额外产生" |
| W-6 | new Foo() 与 class Foo graph-level 连通性无验收 | SC-008 新增 ≥ 80% 阈值 |
| I-1 | monorepo 取舍需更显眼 | US-003 新增"Monorepo 支持取舍"块 |
| I-2 | [推断] 出现在规范性要求中 | 关键规范性条款已改为 MUST；剩余 [推断] 标记为权衡说明 |
