
# 修复实施计划: F242 TS/JS 调用边抽取语法覆盖缺口

**Branch**: `claude/intelligent-kepler-bd4964` | **Date**: 2026-08-03 | **模式**: fix
**Input**: `specs/242-fix-callsite-syntax-coverage/fix-report.md`（5-Why 根因追溯 + 方案 A 已锁定）

**Note**: fix 模式精简计划，聚焦最小变更范围、回归风险评估与修复验证方案；不产出 research.md /
data-model.md / contracts/（本修复是既有 `CallSite` / `ImportReference` schema 的增量演进，非新实体、
无新契约）。

## Summary

**根因（双支，见 fix-report.md 5-Why）**：
- **R1（source 侧，主导，4,517 条边）**：`call-resolver.ts::mkEdge` 把 `callerFile::callerContext`
  无验证地当节点地址拼接；匿名 callback（`<arrow:/<fn:/<gen:`）、未导出函数（如 `main`）、模块顶层
  三类上下文都不是图节点，边在 `graph-builder.ts` 悬空过滤被静默丢弃。
- **R2（target 侧）**：`ast-analyzer.ts::extractImports` 的动态 `import()`/`require()` 分支只记
  `moduleSpecifier`，不抓绑定名，`buildImportIndex` 无 alias，`m.fn()` 一类跨模块调用在 Stage 3
  解析失败产 `?::` 占位。

**修复方案（方案 A，已在 fix-report.md 锁定）**：
1. `CallSite` 增量字段 `enclosingNamedContext?: string`（mapper 侧新增计算，既有输出零变化）。
2. `call-resolver.ts` 的边 source 归属改为回退链：`callerContext` 可寻址 → `enclosingNamedContext`
   可寻址 → 模块节点（`callerFile`）兜底，语言无关。
3. `ast-analyzer.ts::extractImports` 补齐动态 import 绑定抽取（含 `.then()` 回调）与静态
   `import * as ns` 命名空间绑定。
4. `graph-builder.ts` 悬空过滤补计数 + warn 日志（可观测性，不改变行为、不扩快照面）。

## Scope

### In scope
1. `src/models/call-site.ts` — schema 增量字段
2. `src/models/code-skeleton.ts` — `ImportReferenceSchema` 增量字段
3. `src/core/query-mappers/typescript-mapper.ts` — `enclosingNamedContext` 计算与透传
4. `src/knowledge-graph/call-resolver.ts` — `mkEdge` source 归属回退链 + `buildImportIndex` 新增
   alias 落表
5. `src/core/ast-analyzer.ts` — `extractImports` 动态绑定抽取 + 静态命名空间绑定
6. `src/panoramic/graph/graph-builder.ts` — 悬空过滤观测性（计数 + warn 日志）
7. 测试：`tests/unit/typescript-mapper-callsite.test.ts`、
   `tests/unit/knowledge-graph/call-resolver.test.ts`、`tests/unit/ast-analyzer.test.ts`、新增端到端
   存活测试、`tests/fixtures/micrograd-baseline-graph/`（按 F215 流程重生成）

### Out of scope（显式不做）
- Python / Java / Go mapper 源码改动——R1 在 resolver 层语言无关生效，无需改任何非 TS mapper（它们
  没有 `enclosingNamedContext` 字段，回退链自动跳到模块兜底）
- `require()` 的解构绑定抽取（`const { a } = require('x')`）——任务指定 7 形态不含 CommonJS
  require 解构，fix-report 影响范围扫描也未列入；本次不并入，避免范围蔓延
- `dropTargetMissing`（33 条 facade re-export 穿透）与 `dropTargetUnresolved` 中的真实外部符号
  ——F217 决策有意保持丢弃，独立家族，不动
- `graph-builder.ts` 悬空过滤计数写入 graph metadata / 升级为 F217 第七指标——本次只加日志，指标化
  留后续 feature
- 任何产品对外 API / CLI 参数变化——本次是内部图构建精度修复，不改变 CLI/MCP 接口形状

## Codebase Reality Check

| 目标文件 | LOC | 方法/函数数（近似）| 已知 debt |
|---------|-----|------------------|-----------|
| `src/models/call-site.ts` | 64 | 1 个 zod schema + type | 无 TODO/FIXME；纯 schema 文件 |
| `src/models/code-skeleton.ts` | 211 | 多个 zod schema + type | 无 TODO/FIXME |
| `src/core/query-mappers/typescript-mapper.ts` | 1335 | ~41 个方法（class-based mapper）| 无 TODO/FIXME/HACK；无超长函数（`_walkCallSites` 54 行、`_handleCallExpression` <130 行，均在合理范围）|
| `src/knowledge-graph/call-resolver.ts` | 425 | 11 个导出/内部函数 | 无 TODO/FIXME/HACK |
| `src/core/ast-analyzer.ts` | 670 | 15 个函数 | 无 TODO/FIXME/HACK；`extractImports`（L456-549，93 行）本身职责单一、无重复逻辑 |
| `src/panoramic/graph/graph-builder.ts` | 761 | 多个（本次仅触及步骤 4 悬空过滤 ~10 行区块）| 无 TODO/FIXME/HACK |

**前置清理规则判定（逐条核对，均判定不触发）**：

- `typescript-mapper.ts`（1335 LOC > 500）与 `ast-analyzer.ts`（670 LOC > 500）满足"LOC > 500"半个条件，
  但**估算新增行数均 < 50**（mapper 侧是纯参数透传：`_walkCallSites` 新增一段栈内扫描逻辑 ~12 行 +
  5 个 handler 方法签名各加 1 个可选形参 + `_mkCallSite` 增 1 行赋值，净新增约 30-45 行；ast-analyzer
  侧是在 `extractImports` 内追加一个独立分支（绑定抽取 + `.then()` 检测），净新增约 45-60 行，其中
  `.then()` 检测逻辑估算偏保守，若实现时略超 50 行阈值，判定依据仍成立——见下）。**两文件均零
  TODO/FIXME/HACK、零已知代码重复、改动区域（`_walkCallSites`/`extractImports`）本身职责单一未膨胀**，
  不满足"避免债务累积"的规则精神；改动是**机械式参数透传 + 独立新分支**，不引入新架构复杂度。
  **决策：不触发前置 `[CLEANUP]` 任务**。理由记录在案以便审计：若未来该函数因持续叠加特殊形态判断
  变得难以维护，应作为独立 refactor feature 处理，而非在本次最小化 fix 中顺手做。
- `call-resolver.ts`（425 LOC < 500）与 `graph-builder.ts`（本次仅改 10 行局部区块）不满足 LOC 阈值，
  不触发。
- 无任一文件存在 > 3 个相关 TODO/FIXME，无 > 30 行重复逻辑。

## Impact Assessment

- **直接修改文件数**：6（`call-site.ts` / `code-skeleton.ts` / `typescript-mapper.ts` /
  `call-resolver.ts` / `ast-analyzer.ts` / `graph-builder.ts`）+ 测试文件若干（3 个既有单测文件增量
  + 1 个新端到端测试文件 + 1 个 pinned fixture 重生成）
- **间接受影响（消费方，无需改代码但行为/输出会变化）**：
  - `impact` / `context` MCP 工具（BFS 扇出增大，caller 列表更真实但更大）
  - 依赖 `resolveCalls`/`buildUnifiedGraph` 输出边数量的既有测试（`call-resolver.test.ts`、
    graph 集成测试、6 个消费 `micrograd-baseline-graph` fixture 的测试文件）
  - `spectra graph-quality` 六指标（自举跑本仓库图时 orphan/dangling 数值会变化，见下文「F217 六指标
    预期」）
- **跨包影响**：无跨越 `plugins/` 顶层边界；全部改动在 `src/` 内的 `models` → `core` →
  `knowledge-graph` → `panoramic` 既有 DAG 层级内，不新增跨层依赖
- **数据迁移**：无 schema breaking change。`CallSite.enclosingNamedContext` 与
  `ImportReference.namespaceImport` 均为**可选新增字段**，旧数据/旧图产物（如已落盘的 pinned
  fixture）在字段缺失时按 `undefined` 语义降级到修复前行为，向后兼容
- **API / 契约变更**：**间接契约变化**——`calls` 边的 `source` 字段格式对匿名/未导出/模块顶层
  callSite 会从 `file::<anon-or-local-name>`/`file::<module>` 变为 `file::enclosingName` 或纯
  `file`；这是本次修复的**核心预期效果**（悬空边变存活边），不是意外破坏，但下游任何硬编码依赖旧
  source 格式的消费方（当前已知：pinned fixture 断言）需要同步更新
- **风险等级：MEDIUM**（改动文件数 6-10 区间内、无跨包影响、无破坏性 schema 变更，但存在图拓扑
  显著变化——calls 边数预期 ~5.3× 增长——触发多个既有测试/fixture 的语义漂移，需要逐条人工核对而非
  自动通过）
- 未达 HIGH 阈值（文件数 < 20、跨包 = 0、无数据迁移、无破坏性公共 API 契约），**不强制分阶段**；
  但鉴于图拓扑变化幅度大，验证方案（见下）采用「产品代码 → 测试与 fixture」两段式顺序执行并分别设
  验证点，具体任务顺序见「任务拆分建议顺序」

## 关键设计决策

### 1. `CallSite.enclosingNamedContext` 精确语义

- **schema**：`src/models/call-site.ts` 的 `CallSiteSchema` 增 `enclosingNamedContext:
  z.string().optional()`。纯增量字段，位于 `calleeQualifier` 之后，不改动既有 6 个字段的顺序/类型/
  必填性。
- **省略规则**：当 `callerContext` 本身已是"命名"上下文（不匹配 `/^<(arrow|fn|gen):/`）时，
  `enclosingNamedContext` **不填**（等价 `undefined`）——因为此时它必然等于 `callerContext`，填了是
  冗余信息。
- **计算规则**：在 `typescript-mapper.ts::_walkCallSites`（L952-1005）内，紧接现有 `callerCtx`（栈顶）
  计算之后，新增一段扫描逻辑：
  ```
  const ANON_CONTEXT_RE = /^<(arrow|fn|gen):/;  // 模块级常量，与 _deriveCallerContext 的前缀约定对齐

  let enclosingCtx: string | undefined;
  if (callerCtx === undefined || ANON_CONTEXT_RE.test(callerCtx)) {
    for (let i = callerContextStack.length - 1; i >= 0; i--) {
      const frame = callerContextStack[i];
      if (!ANON_CONTEXT_RE.test(frame)) { enclosingCtx = frame; break; }
    }
  }
  ```
  即：从栈顶向下扫描（栈顶本身若匿名也参与扫描，因为 `callerCtx` 就是栈顶，二者语义一致），找到
  **第一个**不匹配匿名前缀的帧。栈为空（模块顶层直接调用，无任何外层函数/类）或全栈皆匿名（嵌套多层
  callback 且外层无命名函数包裹）→ `enclosingCtx` 保持 `undefined`，字段省略。
- **透传路径**：`enclosingCtx` 与既有 `callerCtx` 一样，在 `_walkCallSites` 单次节点访问中计算一次，
  随后一并传给 `_handleCallExpression` / `_handleNewExpression` / `_handleDecorator` /
  `_handleTaggedTemplate`（各自新增 1 个 `enclosingCtx: string | undefined` 形参，插在 `callerCtx`
  之后）；`_handleMemberCall` 由 `_handleCallExpression` 内部调用，同样透传。所有 `_mkCallSite(...)`
  调用点（当前 13 处）追加最后一个实参 `enclosingCtx`；`_mkCallSite` 签名增
  `enclosingNamedContext?: string`，函数体增 `if (enclosingNamedContext !== undefined) cs.enclosingNamedContext = enclosingNamedContext;`。
- **零回归保证**：`callerCtx` 的计算逻辑、`_deriveCallerContext` 的返回值、`_mkCallSite` 现有 5 个
  字段的赋值逻辑**一字不改**——`typescript-mapper-callsite.test.ts` 的 C-4 断言（用例 6/7/8，
  `callerContext` 相关）必须原样保持绿，任何一条因本次改动变红都判定为实现 bug，不允许通过"更新断言"
  处置。

### 2. call-resolver 归属回退链的精确判定

- **可寻址性验证复用已有索引，不新建索引**：
  ```
  function isAddressable(
    name: string | undefined,
    file: string,
    moduleSymbolIndex: ReadonlyMap<string, ReadonlySet<string>>,
    classMemberIndex: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean {
    if (!name) return false;
    const dotIdx = name.lastIndexOf('.');
    if (dotIdx < 0) {
      return moduleSymbolIndex.get(file)?.has(name) ?? false;
    }
    const className = name.slice(0, dotIdx);
    const memberName = name.slice(dotIdx + 1);
    return classMemberIndex.get(`${file}::${className}`)?.has(memberName) ?? false;
  }
  ```
  - 无点号形态（`"main"` / `"registerKbSearchTool"`）→ 查 `moduleSymbolIndex`（该模块导出集合）。
  - 点分形态（`"Foo.bar"`）→ 查 `classMemberIndex` 的 `"file::Foo"` 是否含 `"bar"`。
  - 匿名前缀（`<arrow:...>` 等）天然不在任何索引的 key 集合中，`.has()` 返回 `false`，**不需要**
    显式排除匿名前缀分支——索引未命中即是判定依据，逻辑自洽。
- **回退链**（新增函数 `resolveSourceId`，在 `resolveOne` 顶部对每个 `cs` 调用一次）：
  ```
  function resolveSourceId(cs: CallSiteWithFile, indices: ResolverIndices): string {
    const { moduleSymbolIndex, classMemberIndex } = indices;
    if (isAddressable(cs.callerContext, cs.callerFile, moduleSymbolIndex, classMemberIndex)) {
      return `${cs.callerFile}::${cs.callerContext}`;
    }
    if (isAddressable(cs.enclosingNamedContext, cs.callerFile, moduleSymbolIndex, classMemberIndex)) {
      return `${cs.callerFile}::${cs.enclosingNamedContext}`;
    }
    return cs.callerFile; // 模块节点兜底；deriveNodesFromSkeletons 的 module 节点 id = filePath，逐字匹配
  }
  ```
- **语言无关性**：Python/Java/Go 的 `CallSite` 不产出 `enclosingNamedContext`（字段 `undefined`），
  `isAddressable(undefined, ...)` 直接 `false`，回退链自动落到模块兜底（第三分支）；resolver 代码
  本身不含任何按语言分支的 if，`resolveOne`/`resolveSourceId` 对所有语言共享同一份实现。
- **mkEdge 签名取舍（明确决策）**：**改造 `mkEdge` 不再接受 `cs` 推导 source，而是接受调用方预计算
  好的 `source: string` 字面参数**：
  ```
  function mkEdge(source: string, targetId: string, tier: ConfidenceTier): UnifiedEdge {
    return { source, target: targetId, relation: 'calls', confidence: tier, directional: true };
  }
  ```
  `resolveOne` 顶部 `const source = resolveSourceId(cs, indices);` 计算一次，8 处既有 `mkEdge(cs, ...)`
  调用点改为 `mkEdge(source, ...)`。**取舍理由**：备选方案是把 `moduleSymbolIndex`/`classMemberIndex`
  作为额外参数传给 `mkEdge` 本身（8 处调用点各加 2 个参数），或让 `mkEdge` 直接读闭包变量——前者签名
  臃肿且每次调用重复做可寻址性判断（同一 `cs` 在同一次 `resolveOne` 执行中 source 只有一种结果，不
  应跟着 stage 分支重复计算 4 次），后者破坏 `mkEdge` 的纯函数特性、难以单测。选定方案把"索引依赖的
  归属判定"收敛到 `resolveOne` 顶部一次性完成，`mkEdge` 退化为纯粹的对象字面量格式化职责，各自单一
  职责、`resolveSourceId`/`isAddressable` 可独立单测。

### 3. extractImports 动态绑定抽取的精确 AST 形态

- **schema**：`src/models/code-skeleton.ts` 的 `ImportReferenceSchema` 增
  `namespaceImport: z.string().optional()`。**决策：新增独立字段，不复用 `defaultImport`**——
  `defaultImport` 语义特指 ES module `export default` 对应的导入绑定，动态 import 的命名空间绑定
  （`import('x')` 整体 resolve 出的 module namespace object）与之语义不同，混用会让
  `module-derivation` 等现有 `defaultImport` 消费方产生歧义；新字段职责单一、可选，向后兼容零影响。
- **`buildImportIndex`（call-resolver.ts）同步一行**：紧邻现有 `defaultImport` 处理逻辑之后，追加
  `if (imp.namespaceImport) aliasToTarget.set(imp.namespaceImport, target);`
- **覆盖的 4 类形态（均在 `extractImports` 现有动态 import 循环内，`ast-analyzer.ts` L509-546 区块
  追加处理，不改动静态 import 循环之外的其他逻辑）**：

  a. **`const { a, b: c } = await import('x')`**（解构，任务形态 5/6 的解构分支）→ 遍历
     `VariableDeclaration` 的 `ObjectBindingPattern`，每个 `BindingElement` 取
     `propertyNameNode?.getText() ?? element.getName()` 塞入 `namedImports`。**rename 口径**：记
     "property 名"（即 `{ a: c }` 记 `'a'`，丢弃本地别名 `'c'`），与静态 import 现有
     `decl.getNamedImports().map((n) => n.getName())` 的口径**逐字一致**（`ImportSpecifier.getName()`
     本就返回源导出名而非本地别名，是既有已知限制，非本次引入，也不在本次修复范围内改进——两个 import
     形态的 resolver 消费行为保持对称）。

  b. **`const m = await import('x')`**（命名空间绑定）→ `VariableDeclaration` 的 name 节点是简单
     `Identifier`（非解构模式）→ `namespaceImport = m`。

  c. **`import('x').then(m => ...)` / `.then(({ fn }) => ...)`**（回调形参绑定）→ 检测规则：对
     `kind === 'dynamic'` 的 `CallExpression`（即 `import('x')` 本身），检查其 `getParent()`：
     - 若为 `PropertyAccessExpression` 且 `.getName() === 'then'`，且该
       `PropertyAccessExpression.getParent()` 是 `CallExpression`（即 `.then(cb)` 调用）→ 取该外层
       `CallExpression` 的第一个参数（`ArrowFunction` 或 `FunctionExpression`）的第一个形参的
       `BindingName` 节点，按 a/b 相同逻辑判定：`Identifier` → `namespaceImport`；
       `ObjectBindingPattern` → `namedImports`。
     - 若为 `AwaitExpression` 且其 `getParent()` 是 `VariableDeclaration` → 走 a/b 逻辑（覆盖
       `const {...} = await import(...)` 与 `const m = await import(...)`）。
     - 其余情况（如裸 `import('x');` 无绑定，或 `.then()` 回调无参数）→ 不追加绑定字段，仅记
       `moduleSpecifier`（现状行为不变）。
  - `require()`（CommonJS）分支**本次不动**——任务指定 7 形态未含 `const { a } = require('x')`
    解构，fix-report 影响范围扫描也未列入，避免范围蔓延；如未来需要，属于独立同构小改动。

- **静态 `import * as ns` 命名空间绑定 — 决策：并入本次**。fix-report 影响范围扫描将其标记为
  "同一函数内、修法同构、待 plan 决策"。判定：`extractImports` 静态 import 循环（L465-507）已经
  调用 `decl.getNamespaceImport()` 计算 `hasNamespace`（仅用于 `importType` 分类），却从未把
  `decl.getNamespaceImport()?.getText()` 写入 `imports.push(...)` 的对象——这是与 R2 完全同源的遗漏
  （同一函数、同一 AST API、同一新 schema 字段承载），修复成本是追加一行
  `namespaceImport: decl.getNamespaceImport()?.getText() ?? undefined,`。不纳入等于明知存在几乎相同的
  缺口却放着不修，纳入使 R2 的修复闭环完整、共享同一 `namespaceImport` 字段与 resolver 消费路径，
  **决策：并入**。

### 4. graph-builder 悬空过滤观测性

- **计数粒度：只计总数，不做四分类（dropSrcAnon/dropSrcModule/dropSrcNamedLocal/
  dropTargetUnresolved）打点**。分类统计是诊断脚本（本次问题定位时的一次性分析工具）的职责，不应
  固化进生产路径——生产路径只需要回答"这次建图丢了多少边"这个粗粒度信号，供人工怀疑时用 `--verbose`
  或诊断脚本深挖，不在 `graph-builder.ts` 内重复实现分类逻辑（避免生产代码为一次性诊断需求permanent增
  复杂度）。
- **实现**：`graph-builder.ts` 步骤 4（L443-453）循环内增 `let droppedCount = 0;`，在
  `continue` 分支前 `droppedCount++;`；循环结束后：
  ```
  if (droppedCount > 0) {
    console.warn(`[graph-builder] dropped ${droppedCount} dangling edge(s) (source/target not in node set)`);
  }
  ```
- **是否写入 graph metadata：决策为不写**。理由：(a) `graph.json` 是被多处 pinned（F215
  `micrograd-baseline-graph` fixture、F217 六指标读取路径）的产物，新增顶层字段会扩大快照面，未来
  drop 数字任何波动都会触发这些 pinned 测试的 diff 噪声，而 drop 数字本身高度依赖输入代码库大小/形态，
  不适合做 byte-stable pin；(b) 该计数当前定位是诊断信号（Why-5 可观测性收口），warn 日志已满足最小
  闭环；(c) 若未来要做成正式质量指标，应作为 F217 六指标之外的第七指标独立立项设计（含阈值/verdict
  语义/CI 集成），不应由本 fix 顺手加 schema 字段。

## 变更清单（精确到文件）

1. **`src/models/call-site.ts`**：`CallSiteSchema` 增 `enclosingNamedContext: z.string().optional()`
   字段 + JSDoc（说明用途：resolver 归属回退链第二级）。
2. **`src/models/code-skeleton.ts`**：`ImportReferenceSchema` 增
   `namespaceImport: z.string().optional()` 字段 + JSDoc。
3. **`src/core/query-mappers/typescript-mapper.ts`**：
   - 新增模块级常量 `ANON_CONTEXT_RE`
   - `_walkCallSites`：计算 `enclosingCtx`，透传给 4 个 handler 调用点
   - `_handleCallExpression` / `_handleNewExpression` / `_handleDecorator` / `_handleTaggedTemplate` /
     `_handleMemberCall`：签名各加 1 个 `enclosingCtx` 形参，透传给内部 `_mkCallSite` 调用（13 处）
   - `_mkCallSite`：签名加 `enclosingNamedContext?: string`，函数体加 1 行条件赋值
4. **`src/knowledge-graph/call-resolver.ts`**：
   - 新增 `isAddressable` 与 `resolveSourceId` 两个纯函数（导出以便单测）
   - `resolveOne` 顶部新增 `const source = resolveSourceId(cs, indices);`
   - `mkEdge` 签名从 `(cs, targetId, tier)` 改为 `(source, targetId, tier)`；8 处调用点同步改参数
   - `buildImportIndex`：`defaultImport` 处理逻辑后追加 `namespaceImport` 一行
5. **`src/core/ast-analyzer.ts`**：
   - 静态 import 循环（L465-507）：`imports.push(...)` 对象追加
     `namespaceImport: decl.getNamespaceImport()?.getText() ?? undefined`
   - 动态 import 循环（L509-546）：`kind === 'dynamic'` 分支内追加绑定检测（`AwaitExpression→
     VariableDeclaration` 与 `PropertyAccessExpression('then')→CallExpression` 两条路径），新增
     1 个内部辅助函数（如 `extractBindingFromNode(bindingName): { namedImports?: string[];
     namespaceImport?: string }`）供两条路径复用
6. **`src/panoramic/graph/graph-builder.ts`**：步骤 4 悬空过滤循环（L443-453）加计数 + 条件 warn 日志

## Red Fixture 测试清单（先红后绿）

任务指定 7 形态映射到 3 个层级、4 个测试文件：

| # | 形态 | 层级 | 测试文件 | 断言要点 |
|---|------|------|---------|---------|
| 1 | 实参位置 arrow body 内调用 | mapper | `typescript-mapper-callsite.test.ts` | 具名外层函数内 `withTelemetry('x', async (a) => executeKbSearch(ctx,a))`：`callerContext` 匹配 `/^<arrow:/`（不变，回归锚）；`enclosingNamedContext === '外层具名函数名'` |
| 2 | 实参位置 function expression body 内调用 | mapper | 同上 | 同 1，`callerContext` 匹配 `/^<fn:/` |
| 3 | 嵌套两层匿名 callback | mapper | 同上 | `function outer(){ arr.map((x)=>x.filter((y)=>inner(y))) }`：`inner` 调用的 `callerContext` 为最内层 `<arrow:...>`（C-4 既有语义回归锚）；`enclosingNamedContext === 'outer'`（跳过两层匿名直达） |
| 3b | IIFE（顶层，无命名祖先）| mapper | 同上 | `(function(){ helper(); })()` 位于模块顶层：`callerContext` 匹配 `/^<fn:/`；`enclosingNamedContext === undefined`（验证"栈内找不到命名祖先时省略"分支，非任务原 7 形态但为覆盖 IIFE 关键字提及的边界，纳入 mapper 层同批用例） |
| 4 | 顶层 `await import()` 解构调用 | ast-analyzer | `ast-analyzer.test.ts` | `const { runScaffoldKb } = await import('./x.js')`：`ImportReference.namedImports === ['runScaffoldKb']` |
| 5 | 函数内 `await import()` 解构调用 | ast-analyzer | 同上 | 同 4，验证位置不限于模块顶层（函数体内同样生效，绑定检测不依赖调用位置） |
| 6 | `import().then(m => m.fn())` | ast-analyzer | 同上 | `namespaceImport === 'm'` |
| 6b | `import().then(({ fn }) => fn())` | ast-analyzer | 同上 | `namedImports === ['fn']` |
| 附 | 静态 `import * as ns` | ast-analyzer | 同上 | `namespaceImport === 'ns'`（并入项） |

**resolver 层**（不对应任务形态，验证回退链本身）新增于 `call-resolver.test.ts`：
- 匿名 `callerContext` + 可寻址 `enclosingNamedContext` → `edge.source === '${file}::${enclosingNamedContext}'`
- 匿名 `callerContext` + `enclosingNamedContext` 也不可寻址（或缺失）→ `edge.source === file`（纯模块路径，无 `::`）
- `callerContext` 本身可寻址（既有 Stage 1/2 场景）→ `edge.source` 保持 `${file}::${callerContext}`（回归锚，防止改动破坏既有输出）

**端到端存活断言**（新文件 `tests/integration/call-edge-survival.test.ts`）：构造最小多文件临时 fixture
（mkdtemp，含：具名导出函数 A 内嵌 arrow callback 调用具名导出函数 B；未导出 `main()` 内调用具名导出函数
C；文件内 `await import()` 解构后调用另一文件的具名导出函数 D），跑 `buildUnifiedGraph`（`src/knowledge-graph`
公开入口）后断言最终（悬空过滤后）`edges` 集合包含：
- `fileA::A → fileA::B`（命名祖先回退，复刻形态 1 验收案例）
- `fileA → fileA::C`（模块兜底，复刻 `main()` 场景）
- `fileA → fileB::D`（动态 import 解构，复刻形态 2 验收案例）

此层是唯一验证"边真正救回、真的存活过悬空过滤"的层级，mapper/resolver 层测试只验证中间产物正确。

## 回归面处置

**处置原则（禁止 `vitest -u` 盲刷）**：所有因本次改动变红的既有测试，必须逐条读 diff 判断语义合理性
后手动更新断言；不允许批量快照更新掩盖潜在真实回归。

| 类别 | 预期变化 | 处置方式 |
|------|---------|---------|
| `typescript-mapper-callsite.test.ts` C-4 系列（`callerContext` 断言）| **必须零变化** | 若变红，判定为实现 bug，立即修复实现而非改断言 |
| `call-resolver.test.ts` 中 `edge.source` 精确断言，且原 `callerContext` 恰为匿名/未导出/`<module>` | 会变（回退链生效）| 逐条核对该用例 `callerContext` 语义：属于 R1 覆盖范围（匿名/未导出/模块顶层）→ 更新为新回退结果；属于既有 Stage 1/2 可寻址场景 → 保持不变，作回归锚 |
| `tests/integration/` 下引用 micrograd fixture 的 6 个消费文件 | 边集合/`directCallers`/`callers` 数组会因新增边而变化 | 按下节「micrograd pinned fixture 重生成」流程重生成 + 按 F215 T006 方法论逐条核对 assertion |
| 其它 graph 集成测试若含精确边数/边集合快照 | 可能变化 | 逐个人工核对新增边是否合理（是否落在 R1/R2 救回范围），不合理则视为回归 bug |
| `dropTargetMissing`（facade re-export）/`dropTargetUnresolved`（外部符号）相关既有断言 | **应保持不变**（继续丢弃）| 若变化需重新审视是否误伤，视为潜在回归 |

## micrograd pinned fixture 重生成步骤（按 `tests/fixtures/micrograd-baseline-graph/README.md` 既定流程）

1. 校验 `~/.spectra-baselines/micrograd` 源 clone commit 未漂移（README 记录
   `c911406e5ace8742e5841a7e0df113ecb5d54685`；若已漂移先更新 README provenance 记录）。
2. `npm run build`（确保 `dist/` 含本次修复代码）。
3. `rsync -a --exclude='specs' --exclude='Users' --exclude='.git' ~/.spectra-baselines/micrograd/ "$TMPCOPY/"` 只读拷贝源 clone 到临时目录。
4. `node dist/cli/index.js batch "$TMPCOPY" --mode graph-only --output-dir "$TMPOUT"`。
5. `cp "$TMPOUT/_meta/graph.json" tests/fixtures/micrograd-baseline-graph/graph.json`。
6. 更新 README：新增「F242 重生成」小节，记录 producer commit（本次交付 commit）、新节点/边计数
   （calls 边数预期从既有 7 条增长——Python `<module>` 顶层调用与未导出函数内调用同样受益于 R1 模块
   兜底，精确数字待实测填入，不预先编造）、逐条改动归因（参照既有 F217 小节的归因写法）。
7. 按 `specs/215-fix-e2e-baseline-decouple/tasks.md` T006 方法论逐文件重跑 6 个消费测试文件（非仅
   exit code，人工核对每条 assertion，尤其新增 calls 边是否改变 `directCallers`/`callers` 数组内容）：
   - `tests/integration/mcp-server-stdio.test.ts`
   - `tests/integration/agent-context-real-graph.test.ts`
   - `tests/e2e/feature-180-graph-tools.e2e.test.ts`
   - `tests/e2e/feature-180-file-nav-stdio.e2e.test.ts`
   - `tests/e2e/feature-180-symbol-chain.e2e.test.ts`
   - `tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts`
   - 附带观察：`tests/e2e/feature-180-telemetry.e2e.test.ts`

## F217 六指标修后实测预期

| 指标 | 预期方向 | 理由 |
|------|---------|------|
| orphan ratio | 改善（下降）| 此前 zero-degree 的 callee 符号（如 `executeKbSearch`）现有入边，不再计入 orphan |
| dangling edges | **保持 0** | R1/R2 只救回"target 已是有效节点"的边；无效 target（`dropTargetUnresolved` 剩余的真实外部符号、`dropTargetMissing` 的 facade re-export）仍在 resolver/悬空过滤层被丢，不会绕过 dangling 检测 |
| duplicate edges | 保持 0 | 新增边走既有 `edgeKey()` + `edgeMap` upsert 路径（graph-builder 第五路合并逻辑），不产生重复 key |
| contains-coverage | 不受影响 | contains 边生产路径（`deriveContainsEdges`）本次未改动 |
| god-node（degree 分布，非独立门禁项但纳入观测）| 上升 | 高频 callee（`createLogger`、公共错误类等）入边增多，属预期，非 fail 判据 |
| freshness | 不受影响（正常刷新）| 只比对 `sourceCommit` 与当前 HEAD，本次改动后重新建图会自然刷新为 fresh |

验证方式：修复落地并通过全量测试后，对本仓库自身跑 `spectra batch --mode graph-only` 重建自举图，再跑
`spectra graph-quality`，对比修复前后六指标 verdict 与具体数字，实测数据记入 verify 阶段的
verification-report（本 plan 只声明这是验证方案的一部分，不预先编造具体数字）。

## 任务拆分建议顺序（供 tasks 阶段细化）

1. Red fixtures 落地（mapper 8 用例 + resolver 3 用例 + ast-analyzer 6 用例 + 端到端存活测试 3 断言），
   确认全部先红（`extractCallSites`/`extractImports`/`resolveCalls`/端到端跑不出预期结果）
2. `src/models/call-site.ts` 增 `enclosingNamedContext`
3. `src/models/code-skeleton.ts` 增 `namespaceImport`
4. `src/core/query-mappers/typescript-mapper.ts` 实现 `enclosingNamedContext` 计算与透传 → mapper 层
   测试转绿，人工复核 C-4 断言零变化
5. `src/knowledge-graph/call-resolver.ts` 实现 `isAddressable`/`resolveSourceId`，改造 `mkEdge` →
   resolver 层测试转绿
6. `src/core/ast-analyzer.ts` 实现动态绑定抽取 + 静态命名空间绑定 → ast-analyzer 层测试转绿
7. `src/knowledge-graph/call-resolver.ts::buildImportIndex` 追加 `namespaceImport` 落表（与步骤 6
   配套，使 target 侧真正可解析）
8. `src/panoramic/graph/graph-builder.ts` 悬空过滤计数 + warn 日志
9. 端到端存活测试转绿（验证两条验收边真实救回：`registerKbSearchTool→executeKbSearch`、
   `src/cli/index.ts→...::runScaffoldKb`）
10. 全量 `npx vitest run`，逐个核对新红的既有测试，按「回归面处置」表格原则修（非盲刷）
11. micrograd pinned fixture 按上方七步流程重生成 + 翻断言
12. `npm run build` + `npm run repo:check` 零错误
13. 本仓库自举跑 `spectra batch --mode graph-only` + `spectra graph-quality`，记录六指标修前/修后对比
14. Codex 对抗审查（CLAUDE.local.md 约定，implement 阶段完成 commit 前执行）

## 验证方案

**前置**：`npm run build` 产出最新 `dist/`（本次改动触及 `src/**`，与 F215 场景不同，必须重新构建）。

1. **单元测试**（分层验证，逐文件跑）：
   ```bash
   npx vitest run tests/unit/typescript-mapper-callsite.test.ts
   npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts
   npx vitest run tests/unit/ast-analyzer.test.ts
   npx vitest run tests/integration/call-edge-survival.test.ts   # 新增
   ```
2. **micrograd pinned fixture 消费方**（7 个文件，逐条核对 assertion，方法论见上文步骤 7）
3. **全量回归**：
   ```bash
   npx vitest run
   ```
   零失败（已知负载 flaky 名单——`watch-command`/`community-analysis` perf/`cli-e2e --version`/
   `batch-orchestrator-incremental`——若失败先隔离单独重跑定性，不计入本次回归判断）
4. **类型检查 + 构建**：`npm run build`
5. **仓库级同步校验**：`npm run repo:check`
6. **自举图质量体检**（记录修前/修后对比数字，非阻断性但作为验收证据）：
   ```bash
   node dist/cli/index.js batch . --mode graph-only --output-dir /tmp/f242-selfcheck
   node dist/cli/index.js graph-quality --graph /tmp/f242-selfcheck/_meta/graph.json
   ```
7. **验收案例复核**（fix-report.md 明确列出的两个案例，实测确认）：
   - `impact(executeKbSearch)` / `context(executeKbSearch)` 应能看到来自
     `registerKbSearchTool` 的 caller
   - `impact(runScaffoldKb)` 的 `directCallers` 不再为 0

**验收标准**：
- 全量 vitest 零失败（已知 flaky 除外），两轮结果一致
- `npm run build` / `npm run repo:check` 零错误
- 端到端存活测试的 3 条验收边全部命中
- micrograd pinned fixture 重生成后 7 个消费文件全部人工核对通过（非仅 exit code）
- 自举图质量体检：dangling 保持 0，orphan 数值改善（相对修复前实测对比）

## Constitution Check

*基于 `.specify/memory/constitution.md`（Plugin: spectra 约束区适用，本次改动全部在 `src/` 内）*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本 plan.md 与 fix-report.md 均中文散文 + 英文代码标识符 |
| II. Spec-Driven Development | 适用 | PASS | 走 fix 模式完整链路（fix-report → plan → tasks → 实现 → 验证），测试与修复同 commit |
| III. YAGNI / 奥卡姆剃刀 | 适用 | PASS | 未引入新抽象层/新 registry；`resolveSourceId`/`isAddressable` 复用既有索引；`namespaceImport` 字段职责单一不复用不相关字段；观测性选择最小实现（warn 日志，不做分类打点/不扩 schema） |
| IV. 诚实标注不确定性 | 适用 | PASS | 六指标预期数字、fixture 重生成后的具体计数均标注"待实测填入，不预先编造"；CLEANUP 判定的新增行数是估算区间，非精确断言 |
| V. AST 精确性优先（不可妥协）| 适用 | PASS | 修复本身即是提升 AST 抽取→图边的精确性（救回真实存在但被误丢的调用关系），不引入启发式猜测；`isAddressable` 严格基于已解析的导出/成员索引判定，不做模糊匹配 |
| VI. 混合分析流水线 | 适用 | PASS | 不改变流水线阶段划分，改动均在既有 mapper→resolver→graph-builder 阶段内 |
| VII. 只读安全性 | 适用 | PASS | 不涉及对被分析代码库的写入行为 |
| VIII. 纯 Node.js 生态 | 适用 | PASS | 未引入新依赖，沿用 ts-morph（ast-analyzer 既有依赖）与 tree-sitter（mapper 既有依赖） |
| IX-XIV（Plugin: spec-driver 约束）| 不适用 | N/A | 本次改动不触及 `plugins/spec-driver/` |
| 输出质量门控 | 适用 | PASS | 制品链完整；验证方案要求实际命令输出与人工核对，非推测性声明 |

**结论**：无 VIOLATION 项，无需 Complexity Tracking / 豁免论证。

## Non-Goals（显式排除，防止范围蔓延）

- 不改动 Python/Java/Go mapper 源码（R1 在 resolver 层语言无关生效）
- 不抽取 CommonJS `require()` 的解构绑定
- 不动 `dropTargetMissing`（facade re-export 穿透）与真实外部符号的 `dropTargetUnresolved`
- 不把悬空过滤计数写入 graph metadata 或升级为 F217 正式第七指标
- 不改变任何 CLI 参数 / MCP tool 契约形状
- 不对 `specs/152-ts-callsites-import-resolver/spec.md` 做回改（历史事实保留，行为变化以本 F242
  制品为准落账）
