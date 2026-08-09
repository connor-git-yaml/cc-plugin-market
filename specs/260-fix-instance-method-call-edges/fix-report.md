# 问题修复报告 — F260 实例方法调用边解析

> **修订说明（v2）**：本报告 v1 的量化口径与三处设计前提被 Phase 1 双路异构对抗审查证伪，
> 主线程已逐条独立复现后重写。被推翻的内容保留在「§6 立项数字的修正」中留痕，**不静默改数**。

## 1. 问题描述

`impact(upstream)` 查询 `src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes`
的调用者时返回 `affected: []`，但源码中存在两个真实调用者（`batch-orchestrator.ts:1217`、
`graph-assembly.ts:241`）。

基线图：`dfe6c479`，7547 节点 / 12709 边（calls 3841）。
重算器：`specs/260-fix-instance-method-call-edges/verification/coverage-metric.mjs`。

**主口径（可调用对可调用，验收依据）**：

| 节点类别 | 节点数 | 有 calls 入边 | 覆盖率 |
|---|---|---|---|
| 类方法（`memberKind === 'method'`） | 515 | 152 | **29.5%** |
| 顶层函数（`exportKind === 'function'`） | 1463 | 1307 | **89.3%** |

差距 59.8 个百分点 / **3.03×**。盲区真实存在，但**不是**立项文案写的 11×（见 §6）。

## 2. 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 `extractSymbolNodes` 零 calls 入边？ | 两个调用点在 call-resolver 里**一条边都没产出**（`resolveOne` 返回 `null`），不是产出后被悬空过滤。实测：单独喂这两条 CallSite 给 `resolveCalls`，`edges=0` |
| Why 2 | 为何 `resolveOne` 返回 null？ | 二者 `calleeKind='cross-module'`；Stage 3 用 `calleeQualifier` 查 `importIndex.aliasToTarget` 未命中；`cross-module` 不在 Stage 4 的 fallthrough 白名单（`unresolved`/`dunder`/`decorator`/`super`/`free`）内 → `call-resolver.ts:570` 直接 `return null` |
| Why 3 | 为何 qualifier 查不到 import 表？ | qualifier 根本不是 import 别名，而是 **接收者表达式的原始源码文本**：`pythonAdapter`（局部变量）、`new PythonLanguageAdapter()`（整段 new 表达式文本） |
| Why 4 | 为何 mapper 把原始文本当 qualifier？ | `typescript-mapper._handleMemberCall`（L1191-1231）的分类判据只有**首字母大小写启发式**：大写 → `member`（当类名用），小写 → `cross-module`（当模块别名用）。**TS/JS 侧不存在任何接收者类型推断**——没有「局部变量 / 字段 / 参数 → 类名」的绑定环境 |
| Why 5 | 为何长期未被捕获？ | ① calls 边覆盖率从未被任何质量门度量（F217 六指标是 duplicate/orphan/dangling/ignored/freshness/contains-coverage，**无 calls-recall 维度**）；② 既有 resolver 测试全部用「类名直接做 qualifier」（`Foo.bar()`）构造，正好落在启发式成立的那一侧；③ 丢边是**静默**的——`resolveOne` 返回 null 无任何计数或日志 |

**Root Cause**：TS/JS 调用点抽取层把**接收者表达式的原始文本**直接当作 `calleeQualifier`，
并仅靠首字母大小写把它二分为「类名」或「模块别名」；**接收者类型推断（变量 / 字段 / 参数 /
new 表达式 → 类名）这一环整体缺失**。因此所有「通过实例引用调用方法」的形态（TS 中类使用的
主导形态）在 resolver 里既不是可查表的 import 别名、也不是可验证的类名，最终静默丢边。

**Root Cause Chain**：
`impact 返回空` → `类方法节点 calls 入边只有 29.5%` → `resolveOne 返回 null（cross-module 不 fallthrough）`
→ `qualifier 不是 import 别名` → `qualifier 是接收者原始文本 + 大小写启发式` → `无接收者类型推断`
（+ 无 calls-recall 门禁 + 测试只覆盖启发式成立侧 → 长期静默）

### 复现证据（实测，非推演）

`dist/` 按当前 HEAD 重建后，直调
`TreeSitterAnalyzer.analyze(file,'typescript',{extractCallSites:true})`：

```
batch-orchestrator.ts:1217
  { calleeName:'extractSymbolNodes', calleeKind:'cross-module',
    callerContext:'runBatch', calleeQualifier:'pythonAdapter' }

graph-assembly.ts:241
  { calleeName:'extractSymbolNodes', calleeKind:'cross-module',
    callerContext:'buildAstGraphOnly', calleeQualifier:'new PythonLanguageAdapter()' }
```

第二条的 qualifier 是**整段 new 表达式文本**，可确证 qualifier 未做任何语义归一。
构造的 7 形态样本（`a.m()` / `b.m()`（注解）/ `p.m()`（参数）/ `this.f.m()`（字段 × 3）/
`new Foo().m()`）实测**全部**落 `cross-module` + 裸文本 qualifier，无一例外。

## 3. 损失面分解（对抗审查 CRITICAL-2 补入）

「丢边」不等于「可恢复的丢边」。全仓 TS callSite 按 qualifier 形态实测（对抗审查提供、
主线程接受其口径）：

- `cross-module` 侧丢边 99.91%（56439 / 56490 返回 null），但其中
  **约 30.7% 是 `path`/`fs`/`assert`/`console`/`vi`/`z` 等 stdlib 与测试全局**，
  **约 44.9% 的 qualifier 是非标识符表达式文本**（`expect(result)`、`z.string()`…）。
  这两类返回 null 是**正确行为**，不属于本次要恢复的面。
- `member` 侧 77.9% 的 qualifier 是 `JSON`/`Array`/`Object`/`Math`/`Date` 等 **JS 内建全局**，
  落 `?::` 占位同样是正确行为。
- 真正属于 F260 目标形态的是 `registry` / `logger` / `adapter` / `generator` 这类
  **项目内实例变量**，量级是**几百到几千**条调用点，不是五万。

**因此**：收益预期必须按「515 个 method 节点、当前 152 有入边」这个分母来谈，
**不能**按丢弃的 CallSite 总量谈。

⚠️ **名字匹配上界 453/515 = 88.0% 与本次可达面无关，不得用于设定预期。**
该数字只统计「方法名出现在任一 callSite 的 `calleeName` 中」，不含任何解析约束。
Phase 2 对抗审查按方案 A 五条件的可判定子集实测，**结构上界是 161 个 method 节点可达（60.8%）**——
与 88% 差 2.8×。且该 161 还是**放宽**了本地声明弃权与歧义弃权后的乐观值；
Phase 2 裁决新增的六道弃权（A1/A2/A3/A5/A6/A8，见 plan）只会往下砍。
真实可达带见 plan §7.1（P4 开工前按收紧后口径重算结构上界 `U`，下限定为 `max(40.0%, U × 0.5)`）。

## 4. 影响范围扫描

### 4.1 同源问题（本次修复范围：TS/JS）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/core/query-mappers/typescript-mapper.ts` | `_handleMemberCall` L1191-1231 | 接收者原始文本 + 大小写二分 | 新增接收者类型推断，产出 `receiverType` |
| 同上 | `_handleNewExpression` L1263 委派 | `new X().m()` 走同一条 member 路径，qualifier = 整段文本 | 走 AST 取构造器名（**禁文本正则**，见 4.2-H7） |
| `src/models/call-site.ts` | `CallSiteSchema` | 无承载推断结果的字段 | 新增可选 `receiverType` |
| `src/knowledge-graph/call-resolver.ts` | `resolveOne` Stage 2/3 | 无消费 `receiverType` 的解析分支 | 新增受控解析分支（约束见 4.2） |
| `src/knowledge-graph/call-resolver.ts` | `buildImportIndex` L248-256 | **别名键 = 被导入名 ≠ 文件内绑定名**（既有缺陷） | 见 4.2-H1（必须先收口） |
| `src/knowledge-graph/call-resolver.ts` | `buildClassMemberIndex` L141-158 | 不过滤 `re-export`，与 `deriveNodesFromSkeletons` 不对称 | 补 `re-export` 过滤（当前仓 0 例，零行为变化） |

### 4.2 落地前必须收口的假边面（对抗审查实证，主线程复现）

**H1（CRITICAL，主线程已复现）— `aliasToTarget` 的键是「被导入名」而非「文件内绑定名」。**
实测：`import { Foo as ExternalFoo } from './a.js'` 会往 b.ts 的 `aliasToTarget` 写入键 `'Foo'`，
而 `Foo` 在 b.ts 中**根本没有这个绑定**。若 b.ts 同时有非导出的本地 `class Foo`，
新分支会解析出 `b.ts::use --calls--> a.ts::Foo.run` 这条**确定性假边**（target 节点存在 → 不悬空 → 存活下游全部过滤）。
该缺陷今天已存在，只因 `x.m()` 走不到那一步而未显形；F260 的效果是**把全仓最大的调用点
population 引流进这张有毒的表**。是 F259「表里有一个不该存在的键」的同构复发。

**H2（CRITICAL）— 「成员验证」是反悬空门，不是反假边门。**
`classMemberIndex.get(file::Cls).has(name)` 的判别力等于「这个类恰好有个同名成员吗」；
TS 方法名分布高度集中（`run/parse/build/resolve/init/handle/execute`…），**类名一旦解析错，
同名成员命中概率接近 1**。悬空边今天本来就被 `graph-builder.ts:448` 静默丢弃，
所以这道闸买到的是本来就无害的东西。v1 报告把它写成「反假边的承重设计」——**该表述已被证伪**。
真正的假边面在**类名解析**这一步（H1/H3）。

**H3（CRITICAL）— 弃权集必须同时建在「类名可见性」轴上，不只是「接收者名」轴上。**
函数内 `class Service {}` 局部声明 + 同名 import，接收者只有唯一绑定 → 名字轴弃权不触发 →
仍产出指向 import 目标的假边。
**收口规则**：文件内存在同名 class/interface 声明（**任意作用域**）时，该类名
**只允许解析到本模块**，禁止走 import 别名表。此规则同时封死 H1 与 H3。

**H4（CRITICAL）— 必须两遍式。**
当前 `_walkCallSites` 是一遍递归；若边建环境边出边，弃权只对「之后」的调用点生效，
先出的边带着后来才知道不该信的绑定。F242 对 dynamic import 的修法（先收候选、再收敛写入，
`call-resolver.ts:300-357`）是同款先例，本次必须照做。

**H5（WARNING）— dynamic 抑制拦截必须前置到「本模块导出查找」之前。**
`call-resolver.ts:441-455` 的 Stage 1 注释已记录这条教训。新分支若只在 import 分支查
`suppressedDynamicAliases`、不在 `moduleSymbolIndex` 分支查，
`const { Alpha } = await import(process.env.M!)` + 本地同名导出类会重新流出 high 假边。

**H6（WARNING）— 新分支只对 `exp.kind === 'class'` 的目标出边，interface / type 一律不出。**
两个理由合流：① `import type { Runner }` 会照常写进 `aliasToTarget`（`buildImportIndex` L245
只跳过 `dynamic`，不跳过 `'type-only'`），纯类型导入会派生出运行时 calls 边；
② interface 成员节点同样计入覆盖率分母，`(x: SomeInterface) => x.m()` 会让**指标上涨而症状未修**。
代价是接口注解形态不出边（recall 损失），这是保守优先的正确取舍。

**H7（WARNING）— `new X().m()` 的构造器名必须走 AST**
（`new_expression.childForFieldName('constructor')` 且强制 `type === 'identifier'`），
禁止文本正则 `/new\s+(\w+)/`——`new (cond ? A : B)()` / `new registry[k]()` 会抽出错误 token。
另：构造器 `return` 其他对象（`class Foo { constructor(){ return new Bar(); } }`）是已知
残余风险，**接受并登记**（极罕见，且 TS 声明类型仍是 Foo）。v1 报告「`new Foo().m()` 100% 确定性」
的措辞已被证伪——「取名字确定」不等于「名字解析到哪个文件确定」。

**H8（INFO→纳入范围）— `classMroIndex` 对 TypeScript 恒为空，继承方法验证是死代码。**
主线程实测：全仓 TS/JS `buildClassMroIndex(...)` 条目数 = **0**。
`SUPERCLASS_RE = /class\s+\w+\s*\(\s*([^)]+)\s*\)/` 是 Python 语法，TS 的
`class DockerfileParser extends AbstractArtifactParser<...>` 完全匹配不上。
后果：一切继承来的方法验证必然失败被丢弃。

⚠️ **本条的量级措辞已被实测更正**：v2 原写「本仓大量 `extends`」，plan 阶段实测 `src/**` 共
**19–20 处 `class X extends Y`，其中 8–10 处是 `extends Error`**（非项目符号，MRO 修好也产不出边），
项目内继承仅 9 个类。**不做的损失上界是几十条边，不是「大量」**。纳入本次范围的理由因此不是
量级，而是「它是死代码，留着会让后续维护者误以为继承验证已生效」——与 Why-5 的「长期静默」同款成因。
**处置**：补 TS `extends` 支持纳入本次范围，但作为**独立可归因子改动**（自带 A/B 与逐边 diff）——
它会改变既有 Stage 2 member 路径与 Stage 4 super 路径的行为，不能与新分支的 diff 混在一起判。

**H9（INFO）— `preBuiltNodes` 路径下 calls 边不做端点过滤**（`index.ts:56` / L60-63 只过滤
contains 边）。当前无生产调用点，属潜伏项；结论：不得把「端点必然存在」写成无条件断言。

### 4.3 类似模式（本次不修，登记为 follow-up）

| 文件 | 位置 | 实测判据 | 评估结果 |
|------|------|------|----------|
| `src/core/query-mappers/python-mapper.ts` | L944-952 | `objectText` 原样做 qualifier + 首字母大小写二分，与 TS 逐字同构 | **同源缺失，确认**。`self.x` 已由 callerContext 路径覆盖；实例变量形态缺失。分期 |
| `src/core/query-mappers/java-mapper.ts` | L955-1020 | **不是**原样文本：L982 走 `_normalizeJavaTypeName`，L988 用 `_isJavaTypeName()`（大写 + 缩略词 + 标准库名单），L1019 复杂 receiver **不带 qualifier** | **部分同源**：缺的是「变量→类型绑定环境」，但不泄漏整段表达式文本。分期 |
| `src/core/query-mappers/go-mapper.ts` | 主路径 L846-894（**非** v1 引用的 L963-989） | 命中确定性 `importAliases` 才带 qualifier；`extractReceiver()` 提供 `receiverVarName` → `s.Bar()` 判 member 交 callerContext；其余落 `free` **不带 qualifier** | **v1 误判已更正**：Go 无大小写启发式，且已有与 Python `self.x` 结构相同的接收者绑定机制。缺的仅「非 receiver 局部变量→类型」一层。分期 |
| `src/knowledge-graph/call-resolver.ts` | Stage 4 白名单不含 `cross-module` | 未命中直接丢边（无 `?::` 占位） | **安全，不改**：占位边是悬空边，出了只会被丢弃并抬高 dangling 计数 |

### 4.4 同步更新清单

- 调用方：`resolveCalls` / `buildUnifiedGraph` 无签名变化；`CallSite` 新增**可选**字段，
  其余 mapper 不填即自动跳过新分支（语言无关性保持）
- 测试：`tests/unit/knowledge-graph/call-resolver.test.ts` + `tests/unit/typescript-mapper-callsite.test.ts`；
  **红先行**——先落「该有边却没有」的失败用例（素材：F260 两个真实调用点 + §2 的 7 形态样本），
  同时为 H1/H3/H5/H6 各落一条「不得出边」的假边守卫用例
- 图基线：`specs/_meta/graph.json` 随新增 calls 边变化，须 `npm run build` **后**重建并逐边 diff

## 5. 修复策略

### 方案 A（推荐）：mapper 侧两遍式接收者类型环境 + resolver 侧受控解析分支

1. **抽取层**（`typescript-mapper`，两遍式，H4）：
   - 第一遍全文件建 `receiverName → className` 绑定环境，来源限四类确定性语法事实：
     `const/let x = new Foo()`、`const/let x: Foo`、形参 `(x: Foo)`、类字段 `private x: Foo` / `= new Foo()`（键为 `this.x`）
   - 同时收集**文件内所有 class/interface 声明名（任意作用域）**，供 H3 的可见性弃权用
   - 歧义即弃权：同名出现第二个**不同**类型绑定、或出现类型不可知的同名绑定 → 整体剔除
   - 第二遍走调用点，新增可选字段 `receiverType`：`new Foo().m()` 走 AST 取构造器名（H7）；
     `x.m()` / `this.x.m()` 查环境；查不到就**不填**（行为与今天逐字一致）
   - ⚠️ 环境是**文件级**、不是块级作用域——与 `suppressedDynamicAliases` 同一既定取舍，必须如实登记在注释里

2. **解析层**（`call-resolver`）：在既有 Stage 2/3 之前插入受控分支，**五条同时成立**才出边：
   - `receiverType` 存在
   - 该名字未被 `suppressedDynamicAliases` 抑制（**拦在本模块导出查找之前**，H5）
   - 类名能定位到文件：本模块导出命中；或 import 别名命中**且**该类名不在「文件内本地声明集」中（H3+H1）**且**该 import 非 `type-only`（H6）
   - 目标 `exp.kind === 'class'`（H6）
   - `classMemberIndex` 确认该方法真实存在于该类（或 TS `extends` 修好后的 ≤8 层 MRO 父类，H8）

   任一不成立 → **fallthrough 到今天的原有路径，不出任何新边**。

3. **置信度**：新分支统一 `medium`（INFERRED）。**不给 high**——接收者类型推断本质是文件级近似，
   H1/H3 收口后仍有残余风险；`new Foo().m()` 同样 medium（H7 已证伪「100% 确定」）。
   这比 v1 报告的分档更保守。

4. **前置收口**（必须先于新分支落地，否则新分支等于放大既有缺陷）：H1 的别名键改用文件内真实
   绑定名（或对重命名导入弃权）+ H3 的本地声明集守卫 + `buildClassMemberIndex` 补 re-export 过滤。

**与 F242 三级归属回退链的边界**：F242 管的是**边的 source**（caller 归属），本次管的是
**边的 target**（callee 解析）。二者在 `resolveOne` 内正交——`resolveSourceId` 仍在函数顶部
一次性计算，新分支只决定 target 与 tier，不触碰 source。无先后冲突。

### 方案 B（备选，不推荐）：走 ts-morph TypeChecker 做真类型解析

精度上限高（泛型、联合类型、跨文件类型别名），但：callSites 的 SSoT 是 tree-sitter 路径
（`ts-js-adapter` 双路径 merge 里 tree-sitter 独占 callSites），引入 ts-morph 类型信息需按
line/col 跨路径关联，是脆的；TypeChecker 全量解析对 batch 墙钟是量级级开销；且只对 TS 生效，
与 resolver「语言无关」的既定架构冲突。

## 6. 立项数字的修正（留痕，不静默改数）

| 立项文案 | 复核结论 |
|---|---|
| Class.method 3449 个 / 154 有入边 / **4.5%** | 数字本身可复现，但**口径不公允**：分母里 2891 个（83.8%）是 `memberKind==='property'`（多为 interface 字段声明），本就不可能有 calls 入边 |
| 普通函数 2803 个 / 1390 / **49.6%** | 同样被污染：574 interface + 228 type + 399 const 不可调用，把基准压低近一半 |
| **11× 差距** | **证伪**。可调用对可调用的公允口径是 **29.5%（method）vs 89.3%（function）= 3.03×** |
| 结论「结构性盲区」 | **确认成立**，只是量级被放大约 3.7 倍 |

`coverage-metric.mjs` 已改为主口径 + 分组明细 + legacy 对账三段输出，legacy 段保留原字符串
判据仅供与立项文案对账，**不作验收依据**。

**修正后的验收口径**：
- 主口径 method 覆盖率从 **29.5%** 显著提升，与 function 89.3% 的 **3.03×** 差距收敛（给出实测值）
- **独立硬断言**（不可只看比率）：`impact(upstream)` 对 `PythonLanguageAdapter.extractSymbolNodes`
  返回**包含** `batch-orchestrator` 与 `graph-assembly` 两个调用者
- **假边守卫断言**：新增 calls 边中，target 落在 `exportKind==='interface'` 节点上的条数 = **0**
- 抽样 ≥20 条新增边人工核对无假边；逐边 diff 报告入库

## 7. 采集面 / 版本影响评估

**BEHAVIOR_VERSION（当前 3）结论：不需要 bump。但 v1 的论证已被证伪，此处重写。**

v1 写的是「六类 responsibility 全是『哪些文件被计入』维度 → 不改文件集合 → 不需 bump」。
该推理的前提（六类是 bump 的充要条件）**不成立**：`collector-fingerprint.ts` L89-94 自己的
bump 记录写着 `3 ← 2`（F259）**「六类 responsibility 均不适用」**却仍然 bump 了——
存在第七类触发器，判据在 `scripts/lib/collector-fingerprint-regen-predicate.mjs`：

```js
shouldRejectRegen({ contentMismatch, fingerprintUnchanged }) { return contentMismatch && fingerprintUnchanged; }
```

即**只要 pinned 资产重建内容变了而指纹没变，再生就被拒绝**，与六类无关。

**真正的判据是**：F260 的新增 calls 边会不会改变
`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`？
实测该 fixture 的四个 TS/JS 文件（`src/ts/{foo.ts,foo.tsx,bar.js,bar.jsx}`）**全部只含顶层
`export function`，无 class、无实例方法调用**，pinned 图里 calls 边仅 1 条 →
`contentMismatch` 为 false → 不需 bump。

⚠️ **本节的论证在 Phase 2 审查中被进一步收窄**：实测 pinned 图
`expected-graph-only-graph.json` 的边构成是 `contains 11 / depends-on 2 / calls 1`，
而**唯一那条 calls 边是 F259 补入的 Python→Python**，**TS/JS 侧 calls 边 = 0**。
因此 F260 的全部改动面在该 fixture 上**没有任何可观测投影**，`contentMismatch` 恒为 false
——「跑护栏跑绿」**不构成证据**（没有拒绝域）。「不 bump」的真实依据是上面这条实测事实本身。
另更正：fixture 并非「无 class」——`src/java/Foo.JAVA` 含 `public class Foo`，
故 TS `extends` 分流必须按 `sk.language` **显式命中 ts/js**，禁止用「非 Python 即 TS」的反向判据。
护栏 TS 侧缺 calls 覆盖已登记为 follow-up（与 F259 记录的 py 侧失效同构）。

`UNIFIED_GRAPH_SCHEMA_VERSION`（当前 `1.1`）：zod 结构未变（`CallSite` 新增可选字段不在
`UnifiedGraph` schema 上），是否语义 bump 由 plan 定夺。

## 8. Spec 影响

无既有 spec 描述 calls 解析的 qualifier 语义。
（4a 审查订正：`specs/src.spec.md` 是 **tracked** 文件而非排除提交的产物——`.gitignore:78` 只忽略
`specs/_meta/`；不更新它的真实理由是其 call-resolver 条目为清单式且在 F260 前即已陈旧，
本次不单独再生。）本次产出 `specs/260-fix-instance-method-call-edges/` 全套新制品。

## 9. 审查档位登记

⚠️ **Codex 配额耗尽期，Codex 对抗审查暂停，异构档位缺席。**
Phase 1 采用独立子代理异构对抗 ×2 切入角（假边构造面 / 接收者推断错判面 + 根因归因）。
结论：合计 **6 CRITICAL / 5 WARNING**，其中主线程独立复现并确认 3 条承重项
（指标口径 / `aliasToTarget` 别名键 / TS MRO 恒空），**全部已并入 §4.2 与 §6**。
配额恢复后可回补 Codex 审查。
