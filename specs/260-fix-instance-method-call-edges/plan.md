---
feature_id: 260
mode: fix
title: 实例方法调用边解析 — 修复规划
source_report: ./fix-report.md
strategy: fix-report §5 方案 A（mapper 侧两遍式接收者类型环境 + resolver 侧受控解析分支）
risk_tier: HIGH
created: 2026-08-08
revised:
  - 2026-08-08 编排器复核：D2 收集口径与验收前提互斥，已定稿修订
  - 2026-08-08 Phase 2 双路异构对抗审查（6 CRITICAL + 10 WARNING）编排器裁决落账：A1–A8 / B1–B8
---

# F260 修复规划 — 实例方法调用边解析

> 本 plan 的职责是**定稿** fix-report 留下的 6 个开放问题（D1–D6）+ 新分支的出边条件（D2b），
> 并把「前置收口 → 新分支」的落地顺序、A/B 归因方式、红先行用例、验收硬断言写死。
> fix-report 的根因结论与损失面口径不在此重复，读本文前须先读 `fix-report.md` 全文。

---

## 1. 摘要

| 项 | 内容 |
|---|---|
| 问题 | `impact(upstream)` 对类方法节点静默返回空 caller 集；类方法 calls 入边覆盖率 29.5% vs 顶层函数 89.3% |
| 根因 | TS/JS 抽取层把接收者表达式**原始源码文本**当 `calleeQualifier`，靠首字母大小写二分；接收者类型推断整环缺失 |
| 策略 | 方案 A：mapper 侧建**文件级接收者类型绑定环境**（两遍式）→ 产出 `receiverType`；resolver 侧新增**受控解析分支**（D2b 六条件与门） |
| 前置条件 | H1（别名键）/ H3（类名可定位性）/ re-export 过滤三处**必须先收口**，否则新分支 = 放大既有假边面 |
| 分阶段 | 4 个归因锚点（P2–P5），每阶段独立 A/B，任一阶段可单独回退（依赖偏序见 §8） |
| 归因锚点 | P3 用 **callSites 产物指纹**（边集 diff 捕获率实测仅 0.13%，见 B1）；P2/P4/P5 用逐边 diff |
| 不做 | 方案 B（ts-morph TypeChecker）；Python / Java / Go 同源缺口（fix-report §4.3 已分期） |

---

## 2. Codebase Reality Check

### 2.1 目标文件实测

| 文件 | LOC | 本次触及的函数 | 已知 debt |
|---|---|---|---|
| `src/core/query-mappers/typescript-mapper.ts` | 1364 | `extractCallSites` / `_walkCallSites` / `_handleMemberCall` / `_handleNewExpression` / `_extractImportStatement` | 无 TODO/FIXME；单文件已超 500 行阈值（见 §2.3） |
| `src/knowledge-graph/call-resolver.ts` | 729 | `buildImportIndex` / `buildClassMemberIndex` / `buildClassMroIndex` / `resolveOne` | 无 TODO/FIXME；`resolveOne` 单函数 141 行（430–571），已接近可读性上限 |
| `src/core/ast-analyzer.ts` | 786 | `extractImports` / `bindingNamesOf` | 无 TODO/FIXME |
| `src/core/tree-sitter-fallback.ts` | 654 | `extractImportsFromText` | 无 TODO/FIXME；纯正则路径，仅在 ts-morph + tree-sitter 双失败时触发 |
| `src/models/call-site.ts` | 79 | `CallSiteSchema` | 无 |
| `src/adapters/ts-js-adapter.ts` | 243 | `analyze`（仅**核对**，见 D2） | 注释里含字符串 `"TODO"`（是 F2xx 的测试素材，非 debt） |

### 2.2 关键结构性事实（本次设计的前提，均已实测核对）

1. **TS/JS 生产路径下 `imports` / `exports` 只来自 ts-morph 主路径。**
   `ts-js-adapter.ts:88-102` 的 EC-11 隔离明确写着「tree-sitter 仅贡献 `callSites`，不替换 exports/imports」，
   收尾是 `return { ...tsMorphResult, callSites }`。
   ⇒ **任何挂在 `CodeSkeleton` 上的新字段，若由 typescript-mapper 产出，会被这次 merge 静默丢弃**。
2. **`sk.exports` 只含导出符号**（`buildModuleSymbolIndex` / `buildClassMemberIndex` 均遍历 `sk.exports`）。
   非导出 / 函数内 / 块级 `class` 声明在 resolver 侧**结构性不可见** ⇒ H3 的绑定点统计只能在 mapper 侧做。
3. **`buildClassMroIndex` 对 TS 恒为空**：`SUPERCLASS_RE` 是 Python 语法；TS class signature
   （`ast-analyzer.getSignature` L291-300）为 `class Foo<T> extends Bar implements Baz`，**不含圆括号**，必不命中。
   ⚠️ 但 **L379 的过滤是 `kind !== 'class' && kind !== 'interface'`——interface 今天就在处理范围内**（见 A7）。
4. **两个验收目标调用点都走 dynamic named import**：
   - `batch-orchestrator.ts:1215-1217`：`const { PythonLanguageAdapter } = await import('../adapters/python-adapter.js')` → `const pythonAdapter = new PythonLanguageAdapter()` → `pythonAdapter.extractSymbolNodes(...)`
   - `graph-assembly.ts:240-241`：同款 dynamic import → `await new PythonLanguageAdapter().extractSymbolNodes(...)`
   ⇒ 二者的类名定位依赖 `buildImportIndex` **第二遍（dynamic 候选收敛）**写入的 `aliasToTarget`，
   且各自唯一、target 可解析 ⇒ 不入 `suppressedDynamicAliases`。
   **主线程已独立复现：`PythonLanguageAdapter` 在这两个文件中各只有 1 个绑定点** ⇒ 满足 A1 的放行条件。
5. **`callSites` 不进任何落盘图产物 / 快照**：`persistence.ts` 的 `SnapshotWrapper` 只承载
   `UnifiedGraph` + `fileHashes`（全文件无 `callSites` 引用）；`GraphJSON` 无 `callSites` 字段，
   `graph-builder.ts:355-402` 只写 module 节点的 `metadata.callSitesCount`（**数值**）；
   `src/` 内未发现把 `CodeSkeleton` 原样落盘的写路径。
6. **第五路（UnifiedGraph→GraphEdge）的 dedup 是 first-write-wins 且从不更新 confidence**
   （`graph-builder.ts:422-437`：`if (!existingEdge) set(...)`，`else if` 分支**只**升级 `directional`），
   与前四路的 confidence-max-wins **方向不同**。这是 B5 裁决的依据。
7. **`extractReExports`（`ast-analyzer.ts:141-173`）构造的 `ExportSymbol` 不含 `members` 字段**，
   而 `buildClassMemberIndex` 首行即 `if (!exp.members || exp.members.length === 0) continue`
   ⇒ re-export 条目**今天已 100% 被跳过**。这是 B4 把 P1 降格并入 P2 的依据。

### 2.3 前置清理规则的处置（LOC > 500 且新增 > 50 行）

`typescript-mapper.ts`(1364) 与 `call-resolver.ts`(729) 都命中阈值。本次**不做既有代码重构**（F220 已证明 stage 级拆分需独立 feature），改用「**新逻辑落新文件**」控制增量：

- 接收者类型绑定环境 → 新建 `src/core/query-mappers/typescript-receiver-env.ts`（纯函数，输入 `Parser.Tree`，输出环境对象），
  `typescript-mapper.ts` 净增量控制在 **≤ 40 行**。
- resolver 新分支 → 新建 `src/knowledge-graph/receiver-type-resolution.ts`（纯函数），
  `call-resolver.ts` 净增量控制在 **≤ 40 行**（索引扩展 + 一处分支调用）。
- 超预算即视为设计偏离，必须回到 plan 讨论，不得就地膨胀。

---

## 3. Impact Assessment

| 维度 | 评估 |
|---|---|
| 直接修改文件 | 8（含 2 个新建源文件 + 2 个测试文件） |
| 间接受影响 | `resolveCalls` → `buildUnifiedGraph` → `runBatch` / `buildAstGraphOnly` / `buildIncremental` / `buildModuleGraph*` / `spectra graph-quality` / MCP 全部图查询工具；上游 impact BFS 实测 directCallers=2 / transitive=26 |
| 跨包影响 | 1（`src/` 内部） |
| 数据迁移 | **无 schema 破坏性变更**。`CallSite` / `ImportReference` 新增 optional 字段（旧 baseline 缺字段 → 新分支不触发） |
| API / 契约变更 | 无公开签名变更 |
| 输出变更 | **图内容会变**：calls 边净增（P4/P5）+ 净减 / retarget（P2） |
| **风险等级** | **HIGH** —— 修改的是全仓最大 population 的边派生逻辑；F259 刚因 `aliasToTarget` 无条件覆盖造过确定性假边；假边流出后不可事后甄别 |

---

## 4. 定稿决策

### D1 — H1 别名键收口的形态：**选 (b)+(c) 组合，不选 (a)**

**结论**：新增可选字段承载重命名信息（(b)），并对重命名项在 `aliasToTarget` 上**弃权**（(c)）；**不改 `namedImports` 的既有语义**（否决 (a)）。

**否决 (a) 的理由 — `namedImports` 的消费面实测**：

| 消费点 | 用途 | 改语义的后果 |
|---|---|---|
| `call-resolver.ts:248` `buildImportIndex` | 别名键 | 正是要修的点 |
| `code-slice-extractor.ts:212` | 按名字统计 import 引用次数 → 决定 `P2_MULTI_IMPORT` 优先级 | 切片优先级与选中集合会变 → prompt 内容变 → spec 产物变 |
| `single-spec-orchestrator.ts:1289` / `context-assembler.ts:104` | 拼进 prompt 的展示字符串 | prompt 文本变 → LLM 输出变 |
| `source-discovery.ts:304-332` / `python-adapter.ts:400-451` | Python dot-relative 展开，语义明确是「被导入名」 | 直接破坏 Python 模块解析 |
| `knowledge-graph/index.ts::deriveImportEdges` | **不读** `namedImports` | 无影响 |
| `module-derivation.ts:501` | **不读** `namedImports` | 无影响 |

⇒ (a) 的 blast radius 越过 graph 层，波及 prompt 与 spec 产出面，代价不成比例。

**定稿实现**：

1. `ImportReference` 新增可选字段：
   ```ts
   namedImportBindings?: Array<{ imported: string; local: string }>;
   ```
   **产出规则**：仅当该条 import 语句**至少有一个重命名说明符**时产出；一旦产出，即为该条目
   `namedImports` 的**完整**绑定视图（含未重命名项），以避免 `import { Foo, Foo as B }` 形态下误杀合法绑定。
2. `buildImportIndex` 消费规则：带该字段 → 以它为唯一键源，`local === imported` 照旧写
   `aliasToTarget`，`local !== imported` **既不写 `aliasToTarget` 也不写别处**，`local` 记入
   `renamedImportAliases: ReadonlySet<string>`；不带该字段 → 逐字保持今天行为（Python / Java / Go / 旧 baseline 零变化）。
   Stage 2 import 回退、Stage 3 查表、新分支三处统一在查 `aliasToTarget` 前先查 `renamedImportAliases`，命中即弃权。
3. **为什么弃权而非"改成正确的键"**：改键只解决「键」不解决「值」——`ImportInfo` 的值只有文件路径，
   `import { Foo as ExternalFoo }` 下会拼出 `a.ts::ExternalFoo.run` 这个不存在的节点。补「源导出名」登记 **R-1**。

**四条抽取路径必须全覆盖**（F259 的「两个函数协同才成立的隐式耦合」教训）：

| # | 路径 | 位置 | 生产活跃度 |
|---|---|---|---|
| 1 | ts-morph 静态 import | `ast-analyzer.ts:470` `getNamedImports().map(n => n.getName())` | **主路径** |
| 2 | ts-morph dynamic 解构 | `ast-analyzer.ts:660` `getPropertyNameNode()?.getText() ?? getName()` | 主路径 |
| 3 | tree-sitter 静态 import | `typescript-mapper.ts:865/882`（`import_specifier` 的 `alias` 被丢弃） | 降级路径 |
| 4 | 正则最终兜底 | `tree-sitter-fallback.ts:125` `.split(/\s+as\s+/)[0]` | 双失败兜底 |

**tree-sitter dynamic import 无需处理**：`_extractCallExpressionImport`（L349-355）不产绑定名
⇒ `hasBindingNames` 为 false ⇒ 第二遍 `continue`，无暴露面。

---

### D2 — 类名可定位性判据：**mapper 侧统计绑定点，随 `CallSite` 走布尔标志，不落 `CodeSkeleton`**

**结论**：`CallSite` 新增两个可选字段：

```ts
receiverType?: string;                 // 推断出的接收者类名
receiverTypeSoleImportBinding?: boolean; // 该类名在本文件【恰好 1 个绑定点】且该绑定【来自 import】
```

> **字段更名说明（A1 裁决）**：原名 `receiverTypeLocallyDeclared` 已名不副实——判据不再是
> 「是否本地声明」，而是「绑定点是否唯一且来自 import」。新名是**正向许可**语义，
> fail-closed 方向随之翻转：`undefined` 按 **`false`（= 禁止走 import 别名表）** 处理。

**为什么不挂 `CodeSkeleton`**：

1. **会被静默丢弃**（§2.2-1 的 EC-11 隔离），必须额外改 merge 才生效 —— 正是 F259 记录的隐式耦合形态。
2. **版本错配窗口**：挂 `CodeSkeleton` 会出现「`receiverType` 有、判据字段无」的组合；
   挂 `CallSite` 则二者同一个 `_mkCallSite` 产出，不存在窗口。
3. **payload 更小**：标志只出现在真正推断出 `receiverType` 的调用点上。
4. `sk.exports` 无法替代（§2.2-2）。

#### 判据（A1 裁决：**普适式绑定点计数**，不做形态穷举）

对候选类名 `N`，第一遍 walk 统计其在**本文件内的绑定点总数**（**不区分来源**），然后：

| 绑定点数 | 该绑定是否 import 来源 | `receiverTypeSoleImportBinding` | 语义 |
|---|---|---|---|
| ≥ 2 | —（不看） | **`false`（拦住）** | 存在遮蔽，无法判断调用的是哪一个 |
| = 1 | 是 | **`true`（放行）** | 唯一绑定来自 import，import 表可信 |
| = 1 | 否 | **`false`（拦住）** | 唯一绑定是本地声明，import 表不适用 |
| = 0 | — | **`false`（拦住，fail-closed）** | 名字来源不明（全局/环境声明/抽取遗漏） |

**为什么用普适判据而不是列举豁免形态**：修订前的「非 import 来源」口径要靠**穷举** import 来源形态
才成立，一旦漏掉任一形态即被穿透——审查实证的穿透样本是「**import 遮蔽 import**」
（顶层 `import { Foo } from './b.js'` + 函数内 `const { Foo } = await import('./a.js')`，
两个绑定都被豁免 ⇒ 判 false ⇒ 走静态表指向 b.ts ⇒ 确定性假边）。
**穷举式论证在本仓已被 F256 / F257 各证伪过一次，本次不再采用。**
计数判据的普遍性在于：它不需要知道遮蔽是"哪种形态遮蔽哪种形态"，只需要知道"有没有第二个绑定"。

**绑定点的登记口径**（宁可多记，多记只降 recall）：

- **算一个绑定点**：`import_statement` 引入的每个绑定名（`import_specifier` 的 `alias`∥`name`、
  `import_clause` 下的 `identifier`、`namespace_import` 的 `alias`）；任意作用域的
  `class` / `interface` / `enum` / `type` / `function` 声明；任意 `variable_declarator` 的绑定名
  （含解构元素、含 `const X = class {}`）；`catch` 形参、函数形参。
- **A4 裁决**：左值为已知名字的 `assignment_expression`（`x = new Bar()`）同样计为
  **一个类型不可知的绑定点**——它不是声明，不会被上面任何一条捕获，却真实改变了绑定所指。
- **是否 import 来源**的判定只在"绑定点 = 1"时才需要，AST 判据（**禁文本正则**，同 H7）：

  | 形态 | AST 判据 |
  |---|---|
  | 静态 `import {X}` / `import X` / `import * as X` | 绑定名由 `import_statement` 子树引入 |
  | `const {X} = await import(...)` / `const X = await import(...)` | `variable_declarator.value` →（逐层剥 `parenthesized_expression`）→ `await_expression` → 内层 `call_expression` 且 `childForFieldName('function').type === 'import'` |
  | `import('...').then((X) => …)` | `call_expression(function = member_expression(object = call_expression(function.type==='import'), property.text==='then'))` 的首个实参形参名 |
  | `const X = require(...)` / `const {X} = require(...)` | `variable_declarator.value` →（剥括号）→ `call_expression` 且 `function.type==='identifier' && function.text==='require'` |

  括号归一化必须照 `ast-analyzer.ts:575-581` 的「逐个接缝剥括号」不变量执行，不得只剥一层。
  **判不出 import 来源的一律按"否"处理 ⇒ 拦住**（登记 **R-9**）。

#### 接收者名环境（与上面的类名绑定表是**两张独立的表**）

- **表 1 — 类名绑定点计数表**：key = 类名（`Foo`），value = 绑定点计数 + 唯一绑定的来源。供上表判据用。
- **表 2 — 接收者名 → 类名环境**：key = 接收者名，value = 推断出的类名。供产出 `receiverType` 用。
  歧义即弃权：同名出现第二个**不同**类型绑定、或出现类型不可知的同名绑定（含 A4 的赋值）→ 整体剔除。

**A3 裁决 — 表 2 中 `this.x` 的键必须按宿主 class 分桶**：

- 键形态为 **`ClassName#x`**（宿主类名由 `_findAncestorClassName`（`typescript-mapper.ts:1092`）/
  `callerContext` 取），**不得**用扁平的 `this.x`。
  攻击样本：同文件 `class A { constructor(private client: Foo) {} }` 与
  `function makeHandler(client: Bar) { return { client, run() { this.client.m() } } }` 共存时，
  扁平键下 `this.client` 只有一个绑定点、歧义弃权不触发，对象字面量里的 `this.client.m()` 会错指 `Foo.m`。
- **宿主为下列三类时，对 `this.x` 一律弃权（不产 `receiverType`）**：对象字面量方法、匿名类、
  **带 `extends` 的类**（父类可能声明同名字段，本文件看不到）。
- 该形态不在 R-8（文件级近似）的措辞覆盖范围内，单独登记 **R-15**。

**A5 裁决 — 类型注解的形状约束**：`receiverType` 只接受**裸 `type_identifier`**，或
`generic_type` 的 name 部分（`Foo<T>` → `Foo`）。遇 `union_type` / `intersection_type` /
`conditional_type` / `qualified_name`（`NS.Foo`）/ `type_query`（`typeof x`）/ 数组类型
等一律**不产出** `receiverType`。

**作用范围**：本次**只有新分支**消费这些字段。既有 Stage 2 的 `Class.method()` 路径同样存在同款暴露面，
但改它会污染新分支的 A/B 归因 —— 登记 **R-2**。

---

### D2b — 新分支出边条件（六道弃权收紧后的定稿）

新分支插在 **Stage 1 之后、Stage 2 之前**，仅当 `cs.receiverType` 存在时进入；
**下列全部成立**才出边，任一不成立 → **fallthrough 到今天的原有路径，不出任何新边**：

| # | 条件 | 依据 |
|---|---|---|
| ① | `receiverType` 存在 | 方案 A |
| ② | 该名字未被 `suppressedDynamicAliases` 抑制，**且拦截前置于本模块导出查找** | H5 |
| ③ | 类名可定位：本模块导出命中；**或** `receiverTypeSoleImportBinding === true` **且**该名字不在 `renamedImportAliases`（D1）**且**不是 `defaultImport` 引入的别名（A2） | H3 / D1 / A2 |
| ④ | 定位到的 export 条目 `kind === 'class'` | H6 / A6 |
| ⑤ | 方法名存在于**条件 ④ 那一个 export 条目自己的 `members`**（或 P5 之后的 ≤8 层 MRO 父类） | A6 |
| ⑥ | 置信度统一 `medium`（INFERRED）——含 `new Foo().m()`（H7 已证伪「100% 确定」） | 方案 A |

**A6 裁决的落地要点**：条件 ④ 与 ⑤ **必须绑定到同一个 export 条目**——先按名字取该文件的
export 条目、要求 `kind==='class'`、再**从该条目自己的 `members`** 验成员，**不得**"④ 查 A 索引、
⑤ 查 `classMemberIndex`"。成因：`buildClassMemberIndex` 是 **last-write-wins**，
`deriveNodesFromSkeletons` 是 **first-write-wins**，方向相反；声明合并
（同名 `export interface Foo` + `export class Foo`）下两者会指向**同名的两个不同条目**，
使断言 2 判 pass 而边落在纯类型声明上。`buildClassMemberIndex` 的 last-write-wins 单独登记 **R-12**。

**A2 裁决**：新分支**不接受 `defaultImport` 别名**作为类名定位来源（直接弃权）。
成因：`import Foo from './a.js'` 的真身可能叫 `Baz`，而 a.ts 另有具名 `export class Foo`，
会拼出恰好存在的 `a.ts::Foo.m`。本仓 22 条 default import 全为第三方包（`resolvedPath=null`）故 0 实例，
但产品面向任意代码库。**不动**既有 Stage 2/3 行为（避免 blast radius 溢出归因范围）；登记 **R-11**（与 R-1 同根因）。

**A8 裁决 —— 编排器已撤回（v4 收口）**。

原裁决要求补 `typeOnlyAliases` 并保留条件 ③ 的"非 type-only"子句。执行侧提出技术反驳，
编排器复核后**采纳反驳、撤回原裁决**：

- 原裁决的理由是「`import type` 意味着运行时无该绑定，出边会误导」。该理由**只对绑定成立、
  对调用事实不成立**——`import type { Foo } from './a.js'` + `function f(x: Foo) { x.m() }` 中，
  `x` 的实例来自别处，`x.m()` 在运行时**确实**调用 `a.ts::Foo.m`。**类型名怎么导入不改变调用事实。**
- 条件 ④（同一 export 条目且 `kind === 'class'`）已**独立**封死「目标是 interface / type」那半边。
- 因此该子句的净效果是**纯 recall 损失、零安全收益**，且很可能是六道弃权里最大的单项损失来源。

**定稿**：条件 ③ **删除**"非 type-only"子句；`ImportInfo` **不新增** `typeOnlyAliases`
（变更 #6 相应缩减）。R9 改写为「`import type { Runner }`（Runner 是 **interface**）⇒ 新分支不出边，
**由条件 ④ 保证**」；另补 R9b：「`import type { Foo }`（Foo 是 **class**）⇒ 新分支**正常出边**」，
把这条取舍钉死为回归断言，防止后续有人"顺手"把它加回来。R-13 撤销。

> 留痕理由：本条是本次流程中**编排器裁决被执行侧证伪**的一例，按「不静默改数/改判」原则保留全过程。

---

### D3 — H8（TS `extends` MRO）：**纳入，但排在最后一个阶段，独立可回退**

**(i) 不做的覆盖率上限损失 — 实测校正 fix-report 的表述**

fix-report §4.2-H8 写「本仓大量 `extends AbstractConfigParser` / `AbstractArtifactParser`」。
实测（`src/**` 全量）**共 19 处 `class X extends Y`**：**8 处 `extends Error`**
（`Error` 非项目符号，无 target 节点，产不出任何边）；**11 处项目内继承**
（`GeneratorRegistry`/`ArtifactParserRegistry` → `AbstractRegistry`；5 个 parser → `AbstractConfigParser`/`AbstractArtifactParser`；`AbstractConfigParser` → `AbstractArtifactParser`）。
⇒ 不做的损失**上界 = 这 9 个类上「未被子类重写的继承方法」调用点数**，量级是**几十条边**。
**这条更正必须写进最终 fix-report 的对账段，不得沿用原措辞。**

**(ii) 做的话改变哪些既有行为** —— 两条都是**净增**，不改判既有存活边：

- **Stage 2 member 路径**（L492-503）：`this.inheritedMethod()` 今天 MRO 落空 → 回落 medium 占位
  `callerFile::OwnClass.method` → 节点不存在 → 悬空被丢；修好后产真边 `baseFile::Base.method`。
- **Stage 4 super 路径**（L541-556）：`super.method()` 今天落 `?::method` low 占位（悬空被丢）；修好后产真边。

**(iii) 结论与硬约束**

**纳入**（它是死代码，留着会误导后续维护者；改动约 25 行；方向纯净增），但必须满足：

1. **A7 裁决 — 必须显式收窄 `buildClassMroIndex:379`**。该行今天是
   `if (exp.kind !== 'class' && exp.kind !== 'interface') continue;`，**interface 本就在处理范围内**；
   只加 TS 分支而不动 379 行，`interface Task extends Runner` 会进 MRO ⇒ interface-target 边 ⇒ 直接打破断言 2。
   落地形态：TS/JS 分支内**仅 `kind === 'class'` 进**。
2. **正则必须在 ` implements ` 处截断**：取 signature 中 `extends` 之后、`implements` 之前的片段，
   再 `bracketAwareSplit` + 剥 `<...>`（现有 `stripGenericParams` 只剥 `[`，需同时支持 `<`）。
3. **B7 裁决 — 语言分流必须用正向判据**：`sk.language === 'typescript' || sk.language === 'javascript'`
   **显式命中**，**禁止**用「非 Python 即 TS」的反向判据。否则 Java / Go 骨架会流进 TS 分支，
   而 collector-fingerprint 护栏对此**结构性抓不到**（见 §7.2）。
4. **`lookupInMro` 的 superName 解析同样受 D1 的 `renamedImportAliases` 与 D2 的绑定点判据约束**
   —— 它内部也查 `aliasToTarget`（L640），是同一张表的第二个消费点。

**排最后（P5）**，独立 A/B、独立回退：出现任何 interface-target 或跨类误指 ⇒ **单独摘除 P5，不阻塞 P2–P4**。

---

### D4 — 任务顺序与 A/B 归因方式

**顺序硬约束：前置收口先落地并各自验证 → 再落新分支。** 详见 §6。

**归因方法（B1 裁决后为双锚点）**：

```
每阶段收尾：
  1. npm run build                      # 硬约束：陈旧 dist 会造假回归信号
  2. spectra batch --mode graph-only    # 纯 AST / 零 LLM
  3. 落盘 graph-P{n}.json + callsites-P{n}.json（两份产物）
  4. node .../edge-diff.mjs        graph-P{n-1}.json graph-P{n}.json
     node .../callsites-fingerprint.mjs  callsites-P{n-1}.json callsites-P{n}.json
  5. spectra graph-quality → 落盘 P{n}-graph-quality.json（对齐 F243 before/after 命名先例）
```

- **边集 diff 的比较键**：`source | relation | target | confidence` 四元组排序集合差。
- **callSites 指纹（B1 新增，P3 的主锚点）**：全仓 callSites 的
  `callerFile|line|column|calleeName|calleeKind|calleeQualifier|callerContext|enclosingNamedContext`
  排序集合 + 总条数。
- **不用 impact BFS 做归因**（只看得到可达性，看不到边的增删与置信度漂移）。
- **基线**：P0 在**未改任何源码**的 HEAD 上产出 `graph-P0.json` + `callsites-P0.json` + `P0-graph-quality.json`。

---

### D5 — 红先行用例清单

**规则**：所有用例在对应阶段的实现之前先落地并**确认为红**。

#### `tests/unit/typescript-mapper-callsite.test.ts`（抽取层）

| # | 用例 | 断言 | 阶段 |
|---|---|---|---|
| M1 | `const a = new Foo(); a.m();` | `receiverType==='Foo'`、`receiverTypeSoleImportBinding===true`（Foo 由静态 import 引入，唯一绑定） | P3 |
| M2 | `const b: Foo = mk(); b.m();`（类型注解） | 同 M1 | P3 |
| M3 | `function f(p: Foo) { p.m(); }`（形参） | 同 M1 | P3 |
| M4 | `class C { private x: Foo; g(){ this.x.m(); } }`（字段，键 `C#x`） | 同 M1 | P3 |
| M5 | `class C { private x = new Foo(); … }` | 同 M1 | P3 |
| M6 | `new Foo().m()` | `receiverType==='Foo'`（AST `childForFieldName('constructor')`） | P3 |
| M7 | **H7 守卫**：`new (cond ? A : B)().m()` / `new registry[k]().m()` | **不产出** `receiverType` | P3 |
| M8 | **歧义弃权**：同文件 `let x: Foo` 与 `let x: Bar` | 两处 `x.m()` 均无 `receiverType` | P3 |
| M9 | **类型不可知同名绑定弃权**：`let x: Foo`（函数 A）+ `let x = anything()`（函数 B） | 两处均无 `receiverType` | P3 |
| **M9b** | **A4 重赋值**：`let x = new Foo(); if (c) x = new Bar(); x.m();` | **不产出** `receiverType`（赋值计为绑定点） | P3 |
| M10 | **A1 本地声明**：`function h(){ class Service {} }` + `import { Service } from './s.js'`，`const s: Service = …; s.m()` | `receiverTypeSoleImportBinding===false`（2 个绑定点） | P3 |
| **M10b** | **A1 承重 — import 遮蔽 import**：顶层 `import { Foo } from './b.js'` + 函数内 `const { Foo } = await import('./a.js')`，`const f = new Foo(); f.m()` | `receiverTypeSoleImportBinding===false`（2 个绑定点，**无论来源**） | P3 |
| **M10c** | **A1 零绑定 fail-closed**：`declare const Foo: …` 之外无任何 Foo 绑定 | `receiverTypeSoleImportBinding===false` | P3 |
| M11 | `this.m()`（直接 this 调用） | **不产出** `receiverType`（不夺既有 Stage 2 路径） | P3 |
| M12 | **两遍式（H4）**：文件末尾才出现的 `let x: Bar` 二次绑定 | 文件**开头**的 `x.m()` 也弃权 | P3 |
| **M12b** | **A3 `this.x` 跨类串台**：`class A { constructor(private client: Foo){} }` + `function mk(client: Bar){ return { client, run(){ this.client.m() } } }` | 对象字面量里的 `this.client.m()` **不产出** `receiverType`（宿主为对象字面量 ⇒ 弃权） | P3 |
| **M12c** | **A3 宿主带 extends**：`class D extends Base { private x: Foo; g(){ this.x.m() } }` | **不产出** `receiverType` | P3 |
| **M12d** | **A5 类型形状**：`(p: Foo \| undefined)` / `(p: NS.Foo)` / `(p: typeof x)` / `(p: Foo[])` | 四者均**不产出** `receiverType`；`(p: Foo<T>)` **产出** `'Foo'` | P3 |
| M13 | **H1 抽取侧（tree-sitter 路径）**：`import { Foo as ExternalFoo } from './a.js'` | `namedImportBindings` 含 `{imported:'Foo', local:'ExternalFoo'}` | P2 |
| M14 | **fail-closed 不变量**：M1–M6 全部样本，凡 `receiverType` 存在则 `receiverTypeSoleImportBinding` 必存在 | 遍历断言 | P3 |
| M15 | **dynamic 解构 = import 来源**（验收断言 1 的抽取层镜像）：`const { Foo } = await import('./a.js'); const f = new Foo(); f.m();` | `receiverType==='Foo'` **且** `receiverTypeSoleImportBinding===true` | P3 |
| M15b/c | 静态 import / `require(...)` 同形态 | 同 M15 | P3 |

#### `tests/unit/knowledge-graph/call-resolver.test.ts`（解析层）

| # | 用例 | 断言 | 阶段 |
|---|---|---|---|
| R1 | **H1 假边守卫**：`import { Foo as ExternalFoo } from './a.js'`（带 `namedImportBindings`）+ 非导出本地 `class Foo`，调用 `Foo.run()` | **不产出** `b.ts::use → a.ts::Foo.run` | P2 |
| R2 | **H1 兼容**：不带 `namedImportBindings` 的条目（Python 形态）行为逐字不变 | 边集相同 | P2 |
| R3 | **re-export 索引契约**（白盒）：`buildClassMemberIndex` 对 `kind==='re-export'` 且**人工构造带 `members`** 的条目不建 classKey | 索引无该 key。**用例注释须写明**：`extractReExports` 生产端当前不产 `members`（§2.2-7），本用例约束的是索引契约而非当前行为 | P2 |
| R4 | **F260 真实形态 A**：`pythonAdapter.extractSymbolNodes()` + dynamic named import | 产出 `…::runBatch → python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes`、`medium` | P4 |
| R5 | **F260 真实形态 B**：`new PythonLanguageAdapter().extractSymbolNodes()` | 同 R4 | P4 |
| R6 | **条件 ③ 守卫**：`receiverTypeSoleImportBinding===false` + 同名 import 存在 | 新分支**不出边** | P4 |
| R7 | **fail-closed**：`receiverType` 存在但该标志 `undefined` | 新分支**不出边** | P4 |
| R8 | **H5 守卫**：名字在 `suppressedDynamicAliases` 中且 caller 模块有同名本地导出类 | **不出边**，且不落本地导出（拦截前置于本模块导出查找） | P4 |
| R9 | **type-only + interface 守卫**：`import type { Runner } from './r.js'`，r.ts 导出 `interface Runner` | 新分支**不出边**（由条件 ④ 保证，非 A8） | P4 |
| R9b | **A8 撤回的回归钉**：`import type { Foo } from './a.js'`，a.ts 导出 `class Foo`，`(x: Foo) => x.m()` | 新分支**正常出边**（`medium`）——防止后续有人把 type-only 弃权加回来 | P4 |
| R10 | **条件 ④ 守卫**：定位到的 export 条目 `kind==='interface'` | **不出边** | P4 |
| **R10b** | **A6 声明合并**：同文件同名 `export interface Foo`（有 `members`）+ `export class Foo`（有 `members`），二者成员集不同 | 成员验证必须取 **`kind==='class'` 那一条**；若方法只存在于 interface 条目 ⇒ **不出边** | P4 |
| **R10c** | **A2 default import 守卫**：`import Foo from './a.js'`，a.ts 另有具名 `export class Foo` | 新分支**不出边** | P4 |
| R11 | **成员验证**：目标类存在但成员集无该方法（MRO 亦无） | **不出边**（不产 medium 占位——占位是悬空边，只抬高 dangling） | P4 |
| R12 | **不夺路**：`receiverType` 不存在的所有既有形态，边集与修改前逐字一致 | 回归断言 | P4 |
| R13 | **TS extends MRO**：`class Sub extends Base` + `Base` 有 `m` | 产出 `…::Base.m` 边 | P5 |
| R14 | **MRO implements 截断**：`class Foo extends Bar implements Baz`，`Baz` 有同名成员 | MRO **不含** `Baz` | P5 |
| **R14b** | **A7 interface 收窄**：`interface A extends B` | `classMroIndex` **无** `file::A` 条目 | P5 |
| **R14c** | **B7 语言分流**：Java / Go skeleton（`language==='java'` 等）喂进去 | MRO 索引与修改前逐字一致（不得被 TS 分支吃到） | P5 |
| R15 | **MRO 语言隔离**：Python skeleton（`class Foo(Bar):`）行为逐字不变 | 与修改前相同 | P5 |
| R16 | **dynamic 解构形态必须出边**（验收断言 1 的单测镜像）：`const { Foo } = await import('./a.js')` + `receiverTypeSoleImportBinding===true`，a.ts 导出 `class Foo { m() {} }` | **产出** `caller::Foo.m`、`medium`；且该别名确实不在 `suppressedDynamicAliases` 中 | P4 |

---

### D6 — `UNIFIED_GRAPH_SCHEMA_VERSION`（当前 `'1.1'`）：**不做语义 bump**

**结论：不 bump。**

1. **与 F214 先例判据对齐**：F214 bump 是因为 **canonical ID 字面格式变了**（`#`→`::`）+ **新增 `contains` 边类型**，
   下游按 ID 解析 / 按边类型分发的代码必须能区分新旧。本次是**同一 ID 语法、同一边类型集合下多出若干 `calls` 边**，
   消费方的兼容处理与"图变大了"同构。F217 plan §257 已把这条判据写死。
2. **`CallSite` / `ImportReference` 的新字段不在 `UnifiedGraph` schema 上**，zod 结构零变化。
3. **bump 有代价且换不到东西**：该常量被 `unified-graph.test.ts:194` 等多处断言钉死，
   而没有任何加载逻辑因它从 `1.1` 变 `1.2` 而改变行为——快照 format-stale 判定走的是
   **另一个**常量 `SNAPSHOT_WRAPPER_VERSION`（`persistence.ts:223`）。

**配套确认**：`persistence.detectStaleFiles` 按**文件 hash** 判 stale，源码没变但解析逻辑变了时
旧快照的 calls 边不会自动失效 ⇒ 交付后的图**必须经全量重建产出**，并在 fix-report 补一条已知限制
（**已有本地快照需重建才能看到新边**，登记 R-7）。动 `SNAPSHOT_WRAPPER_VERSION` 会让全网快照无谓失效，不做。

---

## 5. 变更清单

| # | 文件 | 动作 | 预计增量 | 阶段 |
|---|---|---|---|---|
| 1 | `src/knowledge-graph/call-resolver.ts` | `buildClassMemberIndex` 补 `kind==='re-export'` 过滤（结构对齐，生产端当前不可达） | +2 | P2 |
| 2 | `src/models/code-skeleton.ts` | `ImportReferenceSchema` 新增 `namedImportBindings?` | +12 | P2 |
| 3 | `src/core/ast-analyzer.ts` | `extractImports` 静态分支 + `bindingNamesOf` 产出 `namedImportBindings` | +20 | P2 |
| 4 | `src/core/query-mappers/typescript-mapper.ts` | `_extractImportStatement` 读 `import_specifier` 的 `alias` 字段 | +12 | P2 |
| 5 | `src/core/tree-sitter-fallback.ts` | `extractImportsFromText` 保留 ` as ` 右侧 | +10 | P2 |
| 6 | `src/knowledge-graph/call-resolver.ts` | `ImportInfo` 新增 `renamedImportAliases`（A8 的 `typeOnlyAliases` 已撤回，不实现）；`buildImportIndex` 两遍消费新字段；三处消费点前置拦截 | +30 | P2 |
| 7 | `src/models/call-site.ts` | `CallSiteSchema` 新增 `receiverType?` / `receiverTypeSoleImportBinding?` | +28 | P3 |
| 8 | **新建** `src/core/query-mappers/typescript-receiver-env.ts` | 第一遍全文件建**两张表**（类名绑定点计数表 + 接收者名→类名环境，`this.x` 按 `ClassName#x` 分桶）；含 A1/A3/A4/A5 全部判据与括号归一化 | +260 | P3 |
| 9 | `src/core/query-mappers/typescript-mapper.ts` | `extractCallSites` 先建环境；`_handleMemberCall` / `_handleNewExpression` / `_mkCallSite` 接线 | +40（预算上限） | P3 |
| 10 | **新建** `src/knowledge-graph/receiver-type-resolution.ts` | D2b 六条件与门（含 A2 default 弃权、A6 同一 export 条目验成员） | +110 | P4 |
| 11 | `src/knowledge-graph/call-resolver.ts` | `resolveOne` 在 Stage 1 之后、Stage 2 之前插入新分支调用 | +12（预算上限 40） | P4 |
| 12 | `src/knowledge-graph/call-resolver.ts` | `buildClassMroIndex`：**L379 显式收窄**（A7）+ TS/JS `extends` 分支（正向 `sk.language` 判据，B7）；`stripGenericParams` 支持 `<` | +25 | P5 |
| 13 | `tests/unit/typescript-mapper-callsite.test.ts` | M1–M15c | — | P2/P3 |
| 14 | `tests/unit/knowledge-graph/call-resolver.test.ts` | R1–R16 | — | P2–P5 |
| 15 | **新建** `specs/260-.../verification/edge-diff.mjs` | 逐边 diff 重算器（含断言 2 的 exportKind 两跳判据） | — | P0 |
| 16 | **新建** `specs/260-.../verification/callsites-fingerprint.mjs` | callSites 产物指纹重算器（B1，P3 主锚点） | — | P0 |

**明确不改**：`resolveCalls` / `buildUnifiedGraph` 签名；`deriveImportEdges`；`module-derivation`；
`python-mapper` / `java-mapper` / `go-mapper`；`ts-js-adapter.analyze` 的 merge；
既有 Stage 2/3 对 `defaultImport` 的处理（A2 只约束新分支）；Stage 4 fallthrough 白名单；
`graph-builder` 第五路 dedup 语义（B5 只要求**读懂**它，不改它）。

---

## 6. 阶段划分与验证点

### 验证口径的统一约定

1. **边集 diff** = `source|relation|target|confidence` 四元组集合差。**不是"产物零差"**
   （§2.2-5 已核实二者在本次等价，但一律以边集为准）。
2. **B1 裁决 — P3 的归因锚点是 callSites 产物指纹，不是边集**。审查实测：破坏全仓
   61,934 个 `calleeQualifier` 只有 **79 条**在边集可见（捕获率 **0.13%**），破坏 `calleeKind` 盲区 **99.64%**。
   结构成因：46.3% 的 callSite 直接 `return null`、45.4% 出边后被悬空丢弃，存活的 8.3% 还要经
   **2.65:1** 塌缩成 3841 条边。
   ⇒ 边集 diff 在 P3 **降格为辅助信号**；**「非空即证明抽取层动到了既有产出」这一表述已删除**——
   它反过来不成立（**空 ≠ 没动**）。
3. **B5 裁决 — 边集 diff 的非零结果不得直接归因到当前阶段**：`graph-builder.ts:422-437` 的第五路
   dedup 是 first-write-wins 且从不更新 confidence（§2.2-6），与前四路 confidence-max-wins 方向相反。
   任何非零 diff 必须**先排除第五路 dedup 的顺序敏感性**（同键冲突下谁先写入）再归因。
   callSites 指纹不受此影响——这是它替代边集做 P3 锚点的第二个理由。
4. **B5 裁决 — P4 的「新增边计数」以 UnifiedGraph 层（去重前）为准**，另记最终图层净增，
   **两个数都入报告**。理由：新分支会主动制造同键冲突，first-write-wins 会静默吞掉新边而低估收益。

### 阶段表（4 个归因锚点）

> **B4 裁决**：原 P1（re-export 过滤）是**恒等式**——`extractReExports` 不产 `members`，
> `buildClassMemberIndex` 首行已 100% 跳过（§2.2-7）；且 tree-sitter 降级路径把 re-export 产成
> `kind='variable'`，这道过滤在降级路径上本就缺席。**保留补丁但降格**，并入 P2，不占独立归因阶段。

| 阶段 | 内容 | 期望 diff | 通过条件 |
|---|---|---|---|
| **P0** | 落 `edge-diff.mjs` + `callsites-fingerprint.mjs`；在未改源码的 HEAD 上产出 `graph-P0.json` / `callsites-P0.json` / `P0-graph-quality.json`；把假边守卫用例先写成红 | — | 三份基线锚点落盘；红用例确为红 |
| **P2** | H1 别名键收口（变更 #1–#6）+ M13 / R1 / R2 / R3 | **只减不增**，例外见下方论证 | 每条减少的边人工核对确为假边；新增边必须全部落在「retarget 对」内，否则停 |
| **P3** | mapper 侧两遍式环境 + `receiverType` 产出（变更 #7–#9）+ M1–M15c。**resolver 不消费** | **callSites 指纹除新增字段外零差**（主锚点）；边集 diff 应为空（辅助信号，空不构成充分证据） | 指纹零差；指纹非零即停工排查 |
| **P4** | resolver 新分支（变更 #10–#11）+ R4–R12 / R16 | **只增不减**，减少的边必须成对 retarget（见下） | §7 全部硬断言通过；抽样 ≥20 条人工核对无假边 |
| **P5** | TS `extends` MRO（变更 #12）+ R13–R15 / R14b / R14c | **只增不减**；新增边来自 Stage 2 / Stage 4 / 新分支三处，需按 target 归类 | interface-target 仍为 0；任何跨类误指 ⇒ **单独回退 P5** |

### P2「只减不增且减的都是假边」的论证（已核实成立）

`ast-analyzer.ts:470` 的 `getNamedImports().map(n => n.getName())` 返回**源导出名**
（别名在 `getAliasNode()`），故 `import { Foo as ExternalFoo }` 写入键 `'Foo'`；
而源码对该 import 的**真实**引用只能写 `ExternalFoo.x()`（查表键 `'ExternalFoo'`）
⇒ **今天就查不到、本来就不出边**。⇒ 键 `'Foo'` 今天能出边的唯一途径，是文件里**恰好有别的东西**叫 `Foo`
——那正是 H1 的确定性假边。

**唯一允许的例外**：同文件同一 imported 名既有重命名条目又有非重命名条目
（`import { Foo } from './a.js'` + `import { Foo as B } from './b.js'`）时，今天两条都写键 `'Foo'`、
**last-write-wins** 指向 `b.ts`；P2 后条目 2 弃权，键恢复为 `a.ts` ⇒ diff 上是 **retarget（一减一增）**。
这是修正不是回归。验证规则：**新增边必须全部是「同 source + 同 `calleeName`、仅 target 变」的 retarget 对**，
出现任何不成对新增边即停。

### P4 的 retarget 例外（B6 裁决）

审查实测：**308 个 receiver 形态调用点今天已产出存活边**。新分支插在 Stage 2 之前会抢走其中一部分，
表现为一减一增。**允许判据**：减少的边必须与某条新增边构成「同 source + 同 `calleeName`、仅 target 变」的配对，
**且成对数 ≤ 308**；出现任何**不成对**减少即停工排查。

---

## 7. 验收方案

### 7.1 硬断言

1. **`impact(upstream)` 对 `src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes`
   的结果必须同时包含 `batch-orchestrator` 与 `graph-assembly` 两个调用者。**

   **前置复核（P4 开工第一件事，两条缺一不可）**：
   - (a) `PythonLanguageAdapter` 在这两个文件中**未**落入 `suppressedDynamicAliases`；
   - (b) 这两个调用点产出的 `receiverTypeSoleImportBinding === true`
     （即 A1 的绑定点计数在这两个文件中确实 = 1 且来源为 import。
     主线程已独立复现「各只有 1 个绑定点」，此处仅需在实现后复验标志值）。

   任一条不成立 ⇒ **回到 plan 重新讨论**，**不得**为让断言过而放宽 H5 拦截或放宽 A1 判据。
2. **新增 calls 边中，target 落在非 `class` 声明上的条数 = 0**（A6 收紧后的判据）。
   由 `edge-diff.mjs` 计算，不靠目视：对每条新增 calls 边的 `target`，
   - 若 target 是 symbol 节点 → 其 `metadata.exportKind === 'class'`；
   - 若 target 是 member 节点（`file::Cls.name`）→ 其所属 symbol 节点 `file::Cls` 的
     `metadata.exportKind === 'class'`，**且**该成员来自那个 `kind==='class'` 的 export 条目
     （不得由同名 interface 条目提供）。
3. **无悬空新增边**：新增边的 source 与 target 必须都存在于最终图的节点集中
   （不依赖 `graph-builder` 的静默丢弃兜底）。
4. **P2 新增边仅限 retarget 对**；**P3 callSites 指纹零差**；**P4 减少边仅限 ≤308 的成对 retarget**。
5. **覆盖率下限（B3 裁决，替换原「显著提升」表述——原表述无拒绝域，+0.2pp 也算过）**：

   - **P4 开工前先跑探针**，在**本轮收紧后的口径**下（A1 / A2 / A3 / A5 / A6 五道新弃权**全部计入**；
     A8 已撤回，见 D2b）重算结构上界 `U`（= 可达 method 节点数 / 515）。
   - **下限 = `max(40.0%, U × 0.75)`**，且 **`gapRatio = 89.3% / 实测覆盖率 ≤ 2.3`**。
     > 系数由 0.5 上调为 0.75（v4 收口）：执行侧实测指出收紧**前**的结构上界才 60.8%，
     > `U × 0.5` 要 `U > 80%` 才能压过 40% 地板，是**恒不生效的惰性项**——那等于把下限
     > 悄悄退化成一个与 `U` 无关的固定值，验收又失去了对"实现是否吃到了可达面"的判别力。
     > 0.75 让下限随 `U` 真实浮动（U≈53% ⇒ 下限≈40%；U≈55% ⇒ 下限≈41.3%）。
   - 实测低于下限 **不判失败**，但**必须回 plan 复议并给出逐条弃权归因**，不得默默接受。
   - ⚠️ **fix-report §3 引用的 453/515 = 88.0% 名字匹配上界必须显式标注为「与本次六条件可达面无关」**
     （二者差约 2.8×，放在验收段附近会误导）。该标注由编排器在 fix-report 侧落实。

### 7.2 门禁（零失败）

```
npm run build            # 硬约束：任何图重建前必须先跑
npx vitest run
npm run test:plugins
npm run repo:check
npm run release:check
spectra graph-quality    # F217 六指标：duplicate / orphan / dangling / ignored / freshness / contains-coverage
```

**不回退清单**：F214 canonical ID（`::` 统一）、两级 `contains`、F242 三级归属回退链
（`resolveSourceId` 不被新分支触碰——新分支只决定 target 与 tier）、F217 六指标不劣于 `P0-graph-quality.json`。

**collector-fingerprint 护栏的正确定位（B7 裁决 —— 原「强制验证项」表述已删除）**：

- 该护栏对 F260 **结构性无投影**：pinned 图里 **TS/JS 侧 calls 边 = 0**
  （唯一一条 calls 边是 F259 补的 Python→Python），`contentMismatch` 恒 false，
  **与 F260 改了什么无关**。把它写成"强制验证项"等于做一个**没有拒绝域的验证**。
- **`BEHAVIOR_VERSION`（当前 3）不 bump 的依据是「pinned 图 TS/JS calls 边 = 0」这一实测事实**，
  **护栏跑绿不构成证据**。护栏照常在全量 vitest 中运行，但不得被当作 F260 的验证信号。
- **更正 plan 前稿的 fixture 转述**：该 fixture **并非「无 class」**——`src/java/Foo.JAVA` 含
  `public class Foo`。这正是 D3 硬约束 3（语言分流必须用正向 `sk.language` 判据）的现实理由：
  反向判据下 Java 骨架会流进 TS 分支，而护栏抓不到。
- 登记 **R-14**：护栏 TS 侧缺 calls 覆盖，与 F259 记录的 py 侧失效同构。

### 7.3 人工核对

- P4 新增边**随机**抽样 ≥ 20 条逐条回源码核对（不挑好核的）；
- P5 新增边**全量**核对（量级几十条）；
- 逐边 diff 报告、callSites 指纹差异、抽样核对结论一并入库 `specs/260-.../verification/`。

---

## 8. 回归风险、回滚与依赖偏序

### 回滚依赖偏序（B2 裁决 — 硬性）

> `renamedImportAliases` 由 **P2** 产出，被 **P4** 的六条件与门消费。
> ⇒ **P4 在库时摘除 P2 = 打开确定性假边闸门**。

- **摘 P2 必须先摘 P4**（顺序不可颠倒）。
- **摘 P3 可独立**：P4 会因 `receiverType` 恒缺席而静默失效（条件 ① 不成立），不产生半开状态。
- **摘 P5 可独立**：不被任何其他阶段消费。

### 风险表

| 风险 | 触发形态 | 缓解 | 回滚边界 |
|---|---|---|---|
| 新分支造假边 | 类名解析错 + 方法名撞名（H2 已证明成员验证判别力弱） | D2b 六条件与门；A1 普适计数取代形态穷举；置信度统一 medium；R6–R11 守卫 | 摘 P4（删一行分支调用） |
| A1 判据过宽/过窄 | 计数漏记某类绑定形态（过宽）/ 多记（过窄） | 登记口径「宁可多记」；M10/M10b/M10c 三档守卫；§7.1 前置复核 (b) | — |
| `this.x` 跨类串台 | 对象字面量方法 / 匿名类 / 带 extends 的宿主 | A3 按 `ClassName#x` 分桶 + 三类宿主一律弃权；M12b/M12c | — |
| P2 收口误杀真边 | 某文件确实用重命名 import 的类做静态调用 | 弃权只影响重命名项；逐条人工核对；retarget 例外已预先声明 | 摘 P2（**须先摘 P4**） |
| 两遍式改坏既有 callSite | 环境构建 walk 与 `_walkCallSites` 交互 | **callSites 指纹零差**（B1 主锚点）+ M11/M12 | 摘 P3 |
| MRO 引入 interface 边 | L379 未收窄 / 正则未在 ` implements ` 截断 | A7 显式收窄 + R14/R14b + 断言 2 | 摘 P5 |
| **非 TS 骨架流进 TS 分支** | 用「非 Python 即 TS」反向判据 | B7：正向 `sk.language` 显式命中 + R14c；护栏抓不到此类 | 摘 P5 |
| 归因归错阶段 | 第五路 dedup 顺序敏感性 | §6 约定 3：非零 diff 须先排除 dedup 顺序；P4 计数以 UnifiedGraph 层为准 | — |
| 文件级环境误伤块级作用域 | 同名变量在不同函数指向不同类 | 歧义即弃权（M8/M9/M9b）；与 `suppressedDynamicAliases` 同款既定取舍，**必须在代码注释里如实登记** | — |
| 陈旧 dist 造假回归信号 | 忘了先 `npm run build` | §6 每阶段流程第一步写死；确认 `PATH` 上跑的是本 worktree 构建 | — |

---

## 9. 残余风险与 follow-up 登记（不在本次修）

| ID | 内容 | 依据 |
|---|---|---|
| R-1 | 重命名 import 的**正确解析**（需 `ImportInfo` 的值携带「源导出名」）。本次仅弃权，未恢复该部分 recall | D1 |
| R-2 | 既有 Stage 2 `Class.method()` 路径的同款暴露面（嵌套非导出同名 class + 同名 import） | D2 |
| R-3 | tree-sitter 降级路径把 `import * as ns` 写进 `defaultImport` 而非 `namespaceImport`（`typescript-mapper.ts:869-872`），该路径下 `namespaceAliases` 不完整、F242-W3 保护缺席 | §2.2 核对 |
| R-4 | Python / Java / Go 的同源接收者绑定缺口 | fix-report §4.3 |
| R-5 | 构造器 `return` 其他对象（`class Foo { constructor(){ return new Bar(); } }`） | fix-report H7 |
| R-6 | `preBuiltNodes` 路径下 calls 边不做端点过滤 | fix-report H9 |
| R-7 | 已有本地图快照不会因解析逻辑变更而自动失效，需全量重建才能看到新边 | D6 |
| R-8 | 文件级（非作用域感知）绑定环境的固有误伤 | fix-report §5-1 |
| R-9 | 无法按 AST 判据可靠识别 import 来源的形态（`const X = (await import('./a.js')).Foo`、`const X = mod['Foo']`、中间变量转手）按 fail-closed 拦住 ⇒ recall 损失（非假边风险） | D2 |
| **R-10** | 声明类型为**基类 / 抽象类**时，边指向声明类型而非运行时实现类（`const b: Base = create(); b.run()`）。`medium` 置信度已如实表达此不确定性；⚠️ `abstract` 基类的 target 可能是**无实现体的抽象声明节点** | B8 |
| **R-11** | `defaultImport` 别名的 `aliasToTarget` 值域缺陷（真身名 ≠ 本地别名）。本次新分支直接弃权，既有 Stage 2/3 未动 | A2 |
| **R-12** | `buildClassMemberIndex` 的 **last-write-wins** 与 `deriveNodesFromSkeletons` 的 **first-write-wins** 方向相反，声明合并下会指向同名的两个不同条目 | A6 |
| ~~R-13~~ | **已撤销**（A8 裁决被编排器撤回，type-only 不再弃权；见 D2b）| — |
| **R-14** | collector-fingerprint 护栏 **TS 侧 calls 覆盖缺失**（pinned 图 TS/JS calls 边 = 0），与 F259 记录的 py 侧失效同构 | B7 |
| **R-15** | `this.x` 环境的宿主分桶残余：对象字面量方法 / 匿名类 / 带 `extends` 的宿主一律弃权带来的 recall 损失（R-8 措辞覆盖不到此形态） | A3 |

---

## 10. 审查档位

⚠️ Codex 配额耗尽期，**Codex 对抗审查暂停，异构档位缺席**。
Phase 2 已完成独立子代理双路异构对抗（假边构造面 / 归因失效面），合计 **6 CRITICAL + 10 WARNING**，
编排器逐条裁决后 **A1–A7 / B1–B8 ACCEPT 并已落入本 plan**；**A8 经执行侧技术反驳后由编排器撤回**（见 D2b 留痕），**B3 的系数由 0.5 上调为 0.75**（原值恒不生效）。

后续 phase 继续按暂停期档位表执行异构内部对抗 ≥ 2 切入角，重点：

- 切入角 A：**假边构造面** —— 攻击 A1 的绑定点计数判据（能否构造出"计数 = 1 且被判 import 来源、
  但实际指向别处"的绑定）、A3 的宿主分桶、A6 的同一 export 条目约束。
- 切入角 B：**归因失效面** —— 攻击 B1 的 callSites 指纹是否也存在盲区、
  B5 的 dedup 顺序敏感性是否已被 §6 约定 3 完全覆盖。

审查结论与档位缺席标注一并写入 commit message 与最终 fix-report。配额恢复后可回补 Codex 审查。

---

## 11. 编排器裁决 — P2 收尾（v5，2026-08-08）

P2 实现方跑到 T015 判据 FAIL 即停工报告（未改工具、未改判据、未把违规边排除统计），处置正确。
编排器裁决如下，**后续阶段一律按此执行**。

### 裁决 P2-1 — T015 的 FAIL 是**判据的假阳性**，不是实现缺陷；判据需收窄

**事实**：P2 新增的 3 条 calls 边全部指向本次新增的导出 helper
`src/models/code-skeleton.ts::buildNamedImportBindings`（调用方 `ast-analyzer.ts:478` /
`typescript-mapper.ts:905` / `tree-sitter-fallback.ts:133`），已逐条回源码核对为**真实调用点**。
它们不是解析逻辑派生的边，而是「本次改动新增了一个源码符号」这一事实本身带来的。

**为什么不消除**：唯一的消除办法是把 D1 的产出规则**内联复制**到四条抽取路径——那正是 F259
记录的「两个函数协同才成立的隐式耦合」形态，为了让一条统计判据好看而主动制造已知会复发的
架构缺陷，是本末倒置。**共享 helper 是正确工程，保留。**

**判据收窄（替换 §6 P2 行与 §7.1 断言 4 的对应部分）**：
阶段 diff 的新增边必须**逐条**归入下列三类之一，否则停工：
1. **retarget 配对**（同 source + 同 `calleeName`、仅 target 变）；
2. **新符号自证边**：target 节点在**上一阶段基线的节点集中不存在**（即本阶段新增的源码符号），
   且该边经回源码核对为真实调用；
3. 该阶段「期望 diff」显式允许的新增（如 P4/P5 的净增）。
`edge-diff.mjs` 须把「target 是否为本阶段新增节点」做成**机械判定**，不靠人眼分类。

### 裁决 P2-2 — §7.1 断言 2 的作用域限定为**新分支产出的边**

断言 2（「target 必须落在 `kind==='class'` 的 export 条目上」）是为 D2b 六条件与门的
**member-target 边**设计的。把它套到「本次新增源码符号自身获得的调用边」上是过度外延——
`buildNamedImportBindings` 的 `exportKind==='function'` 完全正常。
**定稿**：断言 2 只对 **P4 / P5 新分支与 MRO 分支产出的 calls 边**生效，不对其他新增边生效；
`edge-diff.mjs` 需按边的来源分类后再施加该断言。

### 裁决 P2-3 — §6「减少的都是假边」措辞按实测收窄

P2 唯一减少的那条边（`graph-refresh-executor.mjs::executeRefresh →
graph-bootstrap-status.mjs::attemptLocalGraphBuild`）经核实是「**推导不健全、结论恰好为真**」：
旧边确由 H1 幽灵键碰出（该文件的实际调用目标是解构 DI 形参，不是那个 import 别名），
但形参默认值恰好就是那个 import，故目标事实上正确。
**定稿**：§6 的措辞改为「减少的边必须逐条归因为**幽灵键派生**（推导链不成立），
**不得声称『目标必然错误』**」。本例的 recall 代价归 R-1 已登记项，不额外开条目。

### 裁决 P2-4 — 验证产物的入库边界（新增，避免 172 MB 进 git）

现状实测：`verification/` 已达 **172 MB**（`callsites-P*.json` 各 22 MB、`graph-P*.json` 各 6.3 MB）。
仓库既有惯例是 `.gitignore:80` 把 `specs/_meta/`（含 6.1 MB 的 `graph.json`）整体排除，
**大体积图产物本就不入库**。

**定稿入库清单**（仅这些）：
- `verification/*.mjs`（全部重算器工具）
- `verification/P*-graph-quality.json`、`coverage-P*.json`、`edge-diff-*.json`
- `verification/p*-attribution.md`（含抽样核对结论）
- callSites 指纹的**压缩摘要**（每文件一行 sha256 + 全局 sha256），**不是**全量 22 MB JSON

**不入库**：`callsites-P*.json`、`graph-P*.json`、`exports-P*.json`。
这些留在 scratchpad；attribution 报告里**必须记录各自的 sha256 与生成命令**，保证可复现。

### 裁决 P2-5 — 承接 P2 实现方的两条方法论发现

1. **基线必须用 P0t 口径**：`tests/**` 与 `verification/*.mjs` 都会被采集进图（P0 基线含 1305 个
   `tests/` 节点）。因此「红先行测试已落地、src 仍是上一阶段」的中间基线（P0t 形态）是**必需的**，
   否则测试文件自身带来的节点/边会被误算进源码改动的 diff。**后续每个阶段沿用同一口径**：
   先落测试 → 取中间基线 → 再落实现 → 取阶段基线 → diff。
2. `renamedImportAliases` 记 **`local`**（`ExternalFoo`）而非源导出名，与 D1 字面及 §6 retarget
   论证一致，实现方的测试断言修正正确。

---

## 12. 编排器裁决 — P3 收尾（v6，2026-08-08）

### 裁决 P3-1 — 指纹判据改为**位置无关**口径

**事实**：P3 主口径指纹（含 `line` / `column`）判 FAIL（353 新增 / 221 减少）。但 plan §5 变更 #9
**自己就批了 `typescript-mapper.ts` +40 行**——任何插入代码的实现都必然让后续调用点行号位移。
⇒ 「含位置的指纹零差」是**结构性不可满足**的判据，与裁决 P2-1 处理的那次假阳性同构。

**定稿**：P3 的主锚点改为 `callsites-fingerprint.mjs --position-free` 口径，断言
「**减少 = 0（全仓）**，且新增全部可归因为本阶段新增代码自身」。含位置的口径**保留为信息项**，不作判据。

**实测结果（本阶段已达成）**：位置无关口径下**减少 = 0**，新增 132 条全部落在本阶段新增代码内
（新建文件 126 + 接线 2 + schema 4）；全仓 1149 个文件中**只有 3 个**指纹变化，恰为本次修改的 3 个源文件。
边集辅助 diff：新增 12 / 减少 0，`edge-diff.mjs` 机械分类全部判为「新符号自证边」，`unclassified = 0`。

> 该判据是执行侧**新增第二口径**而非把原口径改绿——原口径的 FAIL 数字原样保留在 p3-attribution.md 中。

### 裁决 P3-2 — 变异测试结论承接：弃权型断言必须配杀手

P3 变异测试（19 变异体 × 61 用例）实测 **A3d（对象字面量宿主弃权）与 A3e（function/静态块重绑 this）
零转红**——A3 三条宿主判据里有两条当时**完全没有守护力**。根因是用例把对象字面量写在顶层 function 里，
上溯撞到普通 function 就停了，判据不可观测；真正的攻击形态是宿主**嵌套在真类内**。已补 M12e/M12f/M12g。

**定稿（对 P4/P5 同样生效）**：**每一条「不得出边 / 应弃权」型断言都必须有对应变异体将其杀死**；
零转红的用例视为**未写**，必须补强到有判别力为止。依据 F232 已确立的「判测试守护力用变异测试」方法论。

### 裁决 P3-3 — 承接工具改进（已落地）

`edge-diff.mjs`：裁决 P2-1 的三分类做成**机械判定**（`unclassified` 计数）+ P2-2 的断言 2 作用域限定
（P2/P3 标 `applicable:false` 但**不静默**，违规数照旧算出）。
`callsites-fingerprint.mjs`：新增 `--position-free` 与 `--digest`（裁决 P2-4 的压缩摘要口径）。
⚠️ 两个工具**自身会被采集进图/指纹**，取基线前必须先冻结；P3 为此重取过 3 次基线。**后续阶段沿用**。

---

## 13. 编排器裁决 — P3/P4 对抗审查（v7，2026-08-08）

两路独立审查（假边构造面 / 守护力与归因失效面）**各自独立**抓到同一批缺陷，且均以实跑探针实证。
P4 已叠加落地在带缺陷的 P3 之上，因此下列各项**必须在交付前收口**。

### 必修 CRITICAL（全部 ACCEPT，构成 P4b 收口轮）

**M1 — 表 2（接收者名→类名）登记面缺口。**
`registerImportBindings` 与 `NAMED_DECLARATION_TYPES` 分支只调 `bindName`（表 1），
**从不调 `bindReceiver`（表 2）**。表 2 的全部安全性建立在「同名第二个绑定即中毒」上，
这些形态不进表 2 ⇒ **无法中毒** ⇒ 另一处带类型注解的同名形参成为该名字的文件级唯一答案。
实测反例（真实抽取，非推演）：
```ts
import { logger } from './logger.js';
import { A } from './a.js';
function helper(logger: A) { logger.q(); }
export function top() { logger.write(); }   // → receiverType='A', sole=true ⇒ 假边
```
`function send(){}` / 本地 `class Local` / `enum Level` 同形态均实测复现。
**第三例更严重**：`Local.q()` 当前经本模块 export 表能解出**正确**边，接线后会**从正确边退化成假边**（净回归）。
**收口**：import / 函数 / 类 / enum / namespace 等一切在本文件产生**值级绑定**的形态，
在 `bindName` 之外**同时 `bindReceiver(name, null)`**（其类型对本环境不可知）⇒ 同名形参立即中毒 ⇒ 三例全部退化为弃权。

**M2 — A3 静态侧注册/查表不对称（第二处同款不对称）。**
注册侧 `public_field_definition` 显式对 `static` fail-closed 跳过；
但查表侧 `resolveThisHostBucket` 命中 `method_definition` 后直接 `memberHostBucket`，**完全不看 static**。
⇒ 静态方法里的 `this.x` 去查**实例字段**建的桶。实测反例：
```ts
class C { conn: A; static conn: Reg = new Reg(); static boot() { this.conn.q(); } }
// → receiverType='A'（真身是 Reg）⇒ 假边
```
**收口**：`resolveThisHostBucket` 在 `method_definition` 上遇 `static` 修饰即返回 null（与 `class_static_block` 同档）。

**M3 — A1 类型参数遮蔽不计数（当前磁盘代码上就已击穿）。**
`type_parameter` 不在 `NAMED_DECLARATION_TYPES`，泛型形参名从不进表 1。实测：
```ts
import { Foo } from './foo.js';
export function g<Foo>(x: Foo) { x.run(); }   // → receiverType='Foo', sole=true ⇒ 假边
```
`class Box<Foo>` 同理。**两路审查独立命中同一处**。
**收口**：`type_parameter`（函数级与类级）补进表 1 登记面。

**M4 — `edge-diff.mjs` 的「新符号自证边」分类 fail-open。**
裁决 P2-1 第 2 类原文是「target 为本阶段新增节点，**且该边经回源码核对为真实调用**」，
工具只机械化了前半句。构造验证：一条**凭空捏造的假边**（source 既有、target 指向本阶段新增符号）
照样 `unclassified = 0` 且 `allPass = true`。
⇒ 「未被归入 unclassified」被当成了「已核实为真」，门禁在这一维度 fail-open。
**收口**：第 2 类必须**同时要求 source 侧也是本阶段新增节点**；不满足者一律进人工核对清单，
verdict 里显式标 `notEvaluated`，**禁止用 `unclassified = 0` 代表「已核实为真」**。
**同时修反向假阳性（W4）**：`new-symbol` 只看 target ⇒ 「新文件里的函数调用既有符号」这条完全正常的
新增边会误判 unclassified（P4 新建文件时大概率触发）。两个方向一并收口。

**M5 — 变异测试的自证循环。**
P3 的 19 个变异体是**从 M1–M15d 的断言反推出来的**，所以「每个变异体都被杀死」证明的是
「用例覆盖了自己针对的判据」，**不是**「判据都被覆盖」。审查者按**源码判据面**独立枚举重做，
20 个独立变异体里 **19 个零转红**，并逐个证明其中 15 个**非等价**（`sole` 从 false/缺席翻成 true）。
**13 个非等价幸存变异体全部朝 fail-open 方向**——而 D2b 六条件与门消费的正是 `sole === true`。
⇒ **A1「绑定点计数」与 D2「import 来源」这两条 P4 假边闸门的承重判据，61 个用例一条都没守住**
（M15 系列全是正向样本，无一条反向样本）。
**收口（方法论定稿，对 P5 同样生效）**：变异体必须**按被测模块的源码判据面独立枚举**，
**禁止从既有断言反推**。必须补的反向用例至少覆盖：类型参数遮蔽 / 非 `require` 的裸调用初值 /
非 `import()` 的 await / `.then(cb)` 非首参 / `interface`·`enum`·`type`·`namespace` 遮蔽 /
`for-in`·`catch`·箭头单形参·解构的中毒登记 / 静态字段 / `const K = class Foo {}` / `readonly` 参数属性 /
`stripParens` 必须剥到底。

### 一并收口的 WARNING

- **W-A**（类表达式同名桶串台）：`classBucketName` 对 `type === 'class'`（类表达式）**弃权**。
- **W-B**（A4 漏计）：`assignment_expression` 分支扩到 `augmented_assignment_expression`（`||=` / `??=`）
  与非 identifier 左值（数组/对象解构赋值），走 `collectPatternNames`。
- **W-C**（D1 四路只有 1 条有测试）：`buildNamedImportBindings` 的 4 个生产调用点里，
  只有 tree-sitter 那条被 M13 覆盖；**ts-morph 主路径与正则兜底路径的 `{imported, local}` 方向零测试**。
  必须各补一条走真实抽取的用例。
- **W-D**（p3-attribution §3.2 结论过强）：`--position-free` 的多重集口径在
  「同文件内两条 callSite 语义字段互换」下守恒（实测 `zeroDiff=true`）。
  该节结论收窄为「全仓**未改动文件**的既有 callSite 6 字段多重集逐字未变」；
  对被改动的 3 个文件，当前证据链**不能**排除语义置换。
- **W-E**（P2 §3 统计口径不可复现）：32/37/24 三个数字未记采集范围（是否含 type-only / 是否含 gitignore 文件 /
  文件清单），独立复算落 30–33 区间。裁决 P2-4 对大产物的「sha256 + 生成命令」要求**同等适用于统计数**：
  必须落可重跑的重算器或写清口径。另更正强度表述：「其余 31 个是已关闭的潜在假边面」方向成立但**强度被高估**——
  实测 26 个幽灵键在同文件内确实存在同名标识符，它们没出边是因为 target 落外部模块/悬空被丢，
  **不是**幽灵键机制罕见。

### 已确认成立、无需处置

- P2 结论 (b)（唯一减少边「推导不健全、结论恰好为真」）逐行核实**准确**。
- P3 的 12 条新增边逐条回源码核实**均为真实调用，无掺假**。
- 指纹/边集工具分隔符是 `U+0000`，字段含空格不会键碰撞。
- P3 的 M1–M15d **全部走 `analyzer.analyze()` 真实抽取**，无手工构造 CallSite。
- D1 四条抽取路径的 `{imported, local}` 元组实测**逐字一致**（规则集中在单点 helper）。

---

## 14. 编排器裁决 — P4b 收尾（v8，2026-08-09）

### 裁决 P4b-1 — `unclassified = 1`（depends-on 边）判为**人工核对通过，工具不改**

那条 `tests/unit/tree-sitter-fallback.test.ts --depends-on--> src/core/tree-sitter-analyzer.ts` 已人工
核对为 W-C 新增 import 的真边（`git show HEAD:` 证实原 import 不存在）。P2-1 三分类是为 calls 边设计的，
`depends-on` 无处可归 ⇒ 工具拒绝自动盖章、强制人工核对，**正是 M4 收口想要的 fail-closed 行为**。
**不扩展分类**（避免为一条测试文件 import 边松动通用判据）；本条按「人工核对清单」通道放行并留痕。

### 裁决 P4b-2 — `assertion2` 的 2 条违规沿用 P2-2 作用域限定，人工通道放行

与 P4 报告 §5.4 同两条（新增导出 helper 自身获得的真实调用边），非本轮新增。工具在 P4 相位下
对**全部**新增 calls 边施加断言 2 属已知过度外延（裁决 P2-2 只限新分支/MRO 分支产出的边）；
两条边的人工核对结论（target 是本阶段新增导出函数、调用真实）已入 attribution。**工具不改**，
理由同上：机械判据宁可假红强制人工，不可放宽自动盖章面。

### 裁决 P4b-3 — W-E 的 26 vs 22 口径差**接受并存**

plan §13 的 26 与重算器的 22 用了不同判法（词边界正则、含注释与字符串 vs 原判法）。两数支撑同一
方向性结论（幽灵键普遍存在同名标识符、没出边是 target 落外部/悬空所致）。口径已固化进
`h1-phantom-key-stats.mjs`，以脚本口径为准，§13 原数字保留作历史记录。

### 裁决 P4b-4 — 等价性实测的「真空绿」坑记入方法论

P4b 实证：等价性判定若只看「0 分歧」会真空绿（合成语料缺类型注解 ⇒ 原版与变异版同为 undefined ⇒
分歧不可观测），三个真非等价体差点被误判等价。**定稿**：等价结论必须「结构可达性论证 + 判别性
样本实测」双证，单靠 0 分歧不成立。此坑与 P3 的「从断言反推变异体」同族——验证器自身也要被验证。

---

## 15. 编排器裁决 — P4b 子审查回收 + P5 断连续接（v9，2026-08-09）

P4b 收尾代理自派的两路只读子审查返回，**推翻其「零非等价+无杀手」终态**；P5 实现代理断连中止但
代码与测试已落盘（全量套件另见 P5b 收口轮实测）。裁决如下。

### 裁决 P5b-1 — 等价性结论修正（两个被证伪，两个论证需重写，一个成立）

| 变异体 | 终态 | 处置 |
|---|---|---|
| **Q01**（表 2 键 `'this'` 永不可登记） | **证伪**——`const this = new Foo()` 被 tree-sitter 词法器在绑定位吐成普通 identifier，**解析零 ERROR**；带 import 版能点亮 `sole=true` | 非等价 ⇒ **补杀手用例**（磁盘 WIP/半成品文件是 Spectra 真实采集面，「tsc 会报错」不构成豁免） |
| **U11**（`public_field_definition` 的 parent 恒为 `class_body`） | **证伪**——容错恢复下 parent 可为直挂 class_declaration 的 ERROR；方向是**丢边**非造边 | 非等价 ⇒ **补杀手用例** |
| U08（匿名类不产生 class_declaration） | 未证伪，但论证的真承重机制是 **MISSING 节点恒 truthy**，与所写理由不同 | **重写论证**（错误前提上的正确结论，grammar 升级即失效无人察觉） |
| D05（`paramIsImportThenFirstParam` 只有一个调用点） | 未证伪，但「只有一个调用点」**与源码矛盾**（实为两个）；真机制是 grammar 上 `required_parameter` 不可直挂 arrow_function | **重写论证** |
| B08（`fromImport ≤ total` 归纳不变量） | **真等价**（结构证明，非可达性搜索） | 保留 |

### 裁决 P5b-2 — N43/N44 守护力缺口收口

- **N44**：7 个变异体只杀 1 个（杀伤力全靠 `'anon'` 字面量撞拼写）。**改写**为直接对
  `buildReceiverTypeEnv` 断言**注册键集合**（不得存在宿主非真实类名的 key），端到端断言可留作补充。
- **N43**：守护归因到了**死代码行**（`property_identifier` 是叶子，那条 `return` 不承重；
  实测删掉后 114/114 全绿）。修正用例注释的因果声称；真正的守护由 mutant B2 证实的
  `out.push` 白名单承担。

### 裁决 P5b-3 — `for_in_statement` 缺 W-B 白名单（真 recall bug，本次修）

实测：`for (rec.slot of xs)` 会误中毒 `rec`（`assignment_expression` 有
`ASSIGNMENT_BINDING_TARGET_TYPES` 白名单挡住 `a.b = 1`，`for_in_statement` 分支没有同款）。
方向是丢边不是假边，但它与 W-B 是同一判据的两个入口，不对称本身就是 F259 型隐患。**补白名单 + 用例**。
同族登记：解构默认值（`assignment_pattern`）里的标识符被当绑定名误中毒——同样 recall-only，
**登记 R-16 不在本次修**（改它要动 `collectPatternNames` 的递归结构，风险/收益不成比）。

### 裁决 P5b-4 — `h1-phantom-key-stats.mjs` 三处收口

- **W3**（`b.isTypeOnly` 恒假死子句）：**修**——binding 级无该字段，改按 import 条目级判定并在
  doc 里如实写明「inline `import { type X as Y }` 归值侧」的能力边界（本仓 3:34 拆分碰巧正确，
  换仓即错）。
- **W4**（陈旧 dist 全零 + exit 0）：**修**——加 dist 新鲜度守卫（复用 `tests/global-setup.ts`
  的内容指纹思路，或至少对「关键符号在 dist 缺席」fail-loud）。
- **W1**（collisions 22 含 9 条注释/字符串/import 自身误命中）：**接受并存**——脚本口径已固化，
  在输出里加 `strictCollisions` 第二列（剥注释/字符串/扣 import 自身），两个口径都报。
  `$` 词边界假阴性（W2）在 doc 登记为已知限制（本仓 0 实例）。

### 裁决 P5b-5 — P5 断连续接口径

P5 的源码改动（语言分流 / kind==='class' 收窄 / implements 顶层截断）与 R13–R15 用例已落盘；
断连点在「修 3 个撞 `bracketAwareSplit` 的锚点」（变异测试阶段）。续接者需：
先全量套件定位失败 → 完成 P5 变异测试（按 §13-M5 + §14-P4b-4 双证）→ P5 归因
（P4b→P5 只增不减、新增边全量人工核对、interface-target = 0）→ `p5-attribution.md`。

---

## 16. 编排器裁决 — P5b 收尾（v10，2026-08-09）

1. **2 条 `depends-on` unclassified + 1 条断言 2 违规**：确认沿用裁决 P4b-1 / P2-2 人工通道放行
   （全部为 N44 探针 import 引入的真边，`git show HEAD:` 已证原文件无此 import）。工具不改。
2. **P5 特性在本仓图足迹 = 0 条边**：接受并如实记录——特性开关 A/B 的图产物 sha256 逐字节相同；
   排除结构性失效（索引真实产出 20 条 TS/JS MRO 条目），真因是本仓 17 个满足 MRO 前提的
   member 调用点全部调本类自己的方法（第一重验证即命中）。plan D3 预估的「几十条边」上界
   实测为 0，纳入理由（死代码收口 + 用例守护）不变。**P5 真实语料守护力目前只由用例承担**，
   登记 R-17。
3. **W02 变异体一次 `INVALID_RUN(total 0)` 后单独重跑 KILLED**：跑批器 fail-closed 生效，
   处置正确，留痕即可。

---

## 17. 编排器裁决 — 4a/4b 审查回收（v11，2026-08-09）

4a spec-review：PASS（0C/5W/2I）；4b quality-review：PASS（0C/4W/4I）。逐条裁决：

1. **预算争议（4a-W4 / 4b-Q1，关闭 p4-attribution §11 悬空请示）**：判**非违规，预算口径修订落账**。
   §2.3 的「≤40」约束的是**单次接线对既有文件的直接编辑**（P4 接线实测 +18 ✓、mapper 接线 +40 卡线 ✓）；
   `call-resolver.ts` 累计 +175 净增由 §5 逐项预算（#6/#11/#12 合计 +67）+ §11–§15 后续裁决增派的
   工作（renamedImportAliases 三处拦截、A7 收窄、P5 字符串助手、注释 92 行）构成，每一段都有
   裁决出处，非静默膨胀。**不做**「P5 助手抽新文件」的收尾重构——gate 阶段的搬迁 churn 大于收益，
   §2.3 与 §5 的口径不一致一并以本条为准修订。
2. **4b-Q2（`property_identifier` 死代码）**：判**改写注释保留守卫**（不删）——该 return 是执行中的
   冗余守卫而非不可达代码，删除会动 P4b/P5b 变异锚点的行号基面；注释必须改为「结构冗余：叶子节点，
   `out.push` 白名单独立挡住；守护力由 N43b 承担」，消除「承重判据」的误导。
3. **4b-Q3（裸 NUL 字节）**：判**修**——`edge-diff.mjs` / `callsites-fingerprint.mjs` 的
  `SEP` 改 `'\x00'` 转义写法，运行时逐字等价，消除 grep-binary 与文本处理吞字节风险。
4. **4b-Q4（D2b ⑤ 的 MRO 回退未接）**：判**接受为有意收窄，登记 R-18**——方向纯 recall、
   P5 特性本仓足迹为 0（§16-2），gate 阶段接 MRO 属新功能面。`receiver-type-resolution.ts`
   里「P5 之前无 MRO 回退」的陈旧注释同步订正为「MRO 回退未接入，R-18 登记」。
5. **4a-W1**：fix-report §8 措辞订正（src.spec.md 是 tracked，理由改为「条目在 F260 前即已陈旧，
   本次不单独再生」）。
6. **4a-W2**：tasks.md 补 P5b 段并同步勾选状态。
7. **4a-W3**：T040 的不回退清单书面核对并入 4c verify 报告（containsCoverage 6284/6284 pass、
   `resolveSourceId` 未触碰、canonical ID 无变更三证已在 attribution，4c 汇总盖章）；
   T043（R-7 快照需重建提示）落 commit message。
8. **4a-W5**：登记 **R-19**（D1 路径 4 正则兜底结构性不可达，`buildNamedImportBindings` 在该路径
   是死代码，用例为现状锚）、**R-20**（h1 严口径为词法近似）、**R-21**（N44 探针耦合 `globalThis.Map`
   容器，4b-Q7 判可接受）。
9. **4a-I1**：抽样核对制品落点以 attribution 实际章节为准，tasks 备注指向。

---

## 18. 编排器裁决 — 收尾勾选（v12，2026-08-09）

1. **T015 勾选接受**（4d 请示 1）——p2-attribution.md 标题自证 + 4 份制品在盘，符合 4a-W2 指令。
2. **T041/T042**：4c 已落 `coverage-final.json`（45.6% ≥ 40.0%、gapRatio 1.96 ≤ 2.3），T041 闭合；
   T042 的入库清单以 tasks.md 备注的「当前已入库清单」为准（大产物按裁决 P2-4 不入库）。
3. **T039**：4c 最终全量 `npx vitest run` 结论为准（flake 判定协议：隔离绿 + 零交集 + memory 预存清单）。
4. **T043**：R-7 提示 +「Codex 审查暂停，异构档位缺席」落 commit message（由编排器在提交时执行）。
