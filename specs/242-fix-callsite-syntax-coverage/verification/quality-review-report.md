# F242 代码质量审查报告（implement 阶段）

**审查对象**：`git diff HEAD`（6 个 src 文件 + 4 个测试文件 + 新增 `tests/integration/call-edge-survival.test.ts` + micrograd fixture，+781/-45）
**方法**：逐文件全量读 diff + 关键边界用 ts-morph 沙箱脚本实测 AST 形态 + 全量 `npx vitest run`（6050 passed）+ `npm run build`（tsc 零错误）

## 结论摘要

**PASS**（零 CRITICAL、零 WARNING、2 条 INFO）。改动严格聚焦 fix-report 锁定的双支根因（R1 source 归属 / R2 target 绑定抽取），13 处 mapper 透传点与 10 处 resolver `mkEdge` 调用点逐一核实全部同步，C-4 回归锚零改动（diff 仅 +1 行 header），schema 演进为纯增量可选字段，`tsc` 与全量 6050 个既有测试零回归。

---

## 1. 改动最小且聚焦根因

- 6 个 src 文件改动与 plan.md「变更清单」逐条对应，无越界改动。未发现死代码、调试残留（无 `console.log`/临时注释）、无关顺手重构。
- `graph-builder.ts` 新增 `console.warn` 是 plan 决策 4 明确要求的观测性收口，非噪声。
- 所有新增注释均以中文写「为什么」（如 `call-resolver.ts:184-197` 的 mkEdge 签名取舍理由、`ast-analyzer.ts:169-171` 的 lastSeg 兜底收紧理由），未见"做了什么"式冗余注释。
- **判定：PASS**

## 2. 边界与回归

### 2.1 `resolveSourceId` 回退链边界（`src/knowledge-graph/call-resolver.ts:447-472`）

- **空栈 / 全匿名栈**：mapper 侧 `enclosingCtx` 保持 `undefined`（`typescript-mapper.ts:980-990`），`isAddressable(undefined, ...)` 首行 `if (!name) return false` 直接短路，安全回退到模块兜底。测试 `F242-3b-i`/`F242-4` 覆盖。
- **Python 嵌套非类成员 dotted context（如 `Outer.Inner.method`）**：`isAddressable` 用 `name.lastIndexOf('.')` 朴素二分（`className = name.slice(0, dotIdx)`），与既有 Stage 2 `extractClassName`（`call-resolver.ts:362-371`，专门处理嵌套多级取最后一段）语义不同——`isAddressable` 会把整个 `"Outer.Inner"` 当作 className 去查 `classMemberIndex`。
  - **实测验证无假阳性风险**：真实类名不含字面 `.` 字符，`classMemberIndex` 的 key 不可能是 `"file::Outer.Inner"` 这种复合串，故该分支必然 miss，安全落到模块兜底（`return cs.callerFile`）。
  - **与修复前行为对比**：修复前 `mkEdge` 无条件用 `callerContext` 拼 `file::Outer.Inner.method` 作为 source，这个 id 本身就不对应任何真实节点（member 节点 id 格式是 `${classKey}.${memberName}`，`classKey` 来自 `extractClassName` 取最内层单段），该边此前**已经**在悬空过滤被静默丢弃。修复后同一场景改为落到模块级兜底，边**从丢失变为存活**（精度降级但方向正确），非回归。
  - 判定为 **INFO**：不影响正确性，但对深层嵌套 Python/Java class 的边源精度是"退到模块级"而非"退到内层类"，如未来需要更高精度需扩展 `isAddressable` 复用 `extractClassName` 的分段逻辑（不在本次 Non-Goals 之外，标注供后续参考）。

### 2.2 `extractDynamicImportBinding` / `bindingNamesOf` 边界（`src/core/ast-analyzer.ts:568-631`）

用 ts-morph 沙箱脚本实测以下形态（见附录复现命令），结果全部符合预期、无崩溃、无错绑定：

| 形态 | AST 结果 | 代码路径处理 | 结果 |
|---|---|---|---|
| Rename `{ a: c }` | propertyNameNode='a' | 取 propertyNameNode，不落 getName() | 记 `'a'`（源导出名，口径与静态 import 一致）|
| 嵌套解构 `{ a: { b } }` | propertyNameNode='a'（BindingElement.name 是嵌套 ObjectBindingPattern） | 取 propertyNameNode，不进 getName() 分支 | 记 `'a'`，内层 `b` 被丢弃（未崩溃，行为合理——`a` 才是可解析的导入绑定名） |
| 默认值 `{ a = x }` | propertyNameNode=undefined，getName()='a' | fallback 到 getName() | 记 `'a'`，正确 |
| Rename+默认值 `{ a: c = 1 }` | propertyNameNode='a' | 取 propertyNameNode | 记 `'a'`，正确 |
| Rest `{ ...rest }` | `getDotDotDotToken()` 为真 | 显式 `continue` 跳过 | 不产出该绑定，无崩溃 |
| 数组解构 `const [x] = await import(...)` | nameNode 是 `ArrayBindingPattern` | 既非 `isIdentifier` 也非 `isObjectBindingPattern`，落 `return {}` | 安全返回空对象，不产出字段（无对应导入语义，符合预期） |
| `await (import('x'))`（括号包裹）| `import(...)` 的 `getParent()` 是 `ParenthesizedExpression`，非 `AwaitExpression` | 两条路径判断均不匹配，`return {}` | **不产出绑定字段**（fail-safe，不崩溃；等价于修复前行为——只记 `moduleSpecifier`）。**属已知局限，非 bug**：plan 覆盖的是「宿主语法直接形态」，括号包裹属未列入的额外包装层，不在 7 形态 + 附加静态 namespace 范围内 |
| `.then()` 无参回调 | `getParameters()[0]` 为 `undefined` | `if (!firstParam) return {}` | 安全返回空对象 |
| `.then()` 多形参（如 `.then((m, extra) => ...)`）| 只读 `getArguments()[0]` 的第一个形参 | 忽略额外形参 | 符合预期（`.then` 语义上只有一个 resolve 值形参，多余形参本就是错误代码，忽略合理） |

- **判定为 INFO**：括号包裹动态 import（`await (import('x'))`）未被覆盖，属未列入 plan 7 形态范围的额外边界，fail-safe（不崩溃、不产错绑定，只是不救回该边），不构成回归，仅记录供后续 backlog 参考。

### 2.3 `buildImportIndex` 第三分支收紧（`call-resolver.ts:159-171`）

- 新增 `!imp.namespaceImport` 收紧条件。核实 `namespaceImport` 字段**仅** `src/core/ast-analyzer.ts`（TS/JS）写入（`grep -rn namespaceImport src/core/query-mappers/*.ts src/core/ast-analyzer.ts` 确认 Python/Java/Go mapper 均不产出该字段）。
- 因此对 Python `import numpy` 等场景，`imp.namespaceImport` 恒为 `undefined`，收紧条件对 Python 路径零影响；新增单测「回归锚：无任何绑定时仍保留 lastSeg / moduleSpecifier 兜底 alias（Python import X 路径）」（`call-resolver.test.ts` 末尾）显式钉死。
- **判定：PASS**，无回归面。

### 2.4 `mkEdge` 签名改造 8→10 处调用点核实

`grep -n "mkEdge(" src/knowledge-graph/call-resolver.ts` 确认全部 10 处调用点（Stage 1/2/3/4 共 10 个 return 分支）均已改为传入预计算的 `source`；`source` 在 `resolveOne` 顶部无条件计算一次（`resolveOne` 函数入口，早于任何 stage 分支判断），不存在遗漏分支或重复计算。**判定：PASS**。

## 3. 命名/风格与周边一致性

- `ANON_CONTEXT_RE` 命名与既有 `SCOPE_DEFINING_TYPES`、`DYNAMIC_CALL_NAMES` 等模块级常量风格一致（大写下划线），紧邻使用处（`_walkCallSites`）声明位置合理。
- 中文注释密度与既有文件一致（如 `call-resolver.ts` 每个新函数均有 JSDoc 说明"为什么"而非复述代码）。
- `isAddressable` / `resolveSourceId` 按 plan 决策显式导出供单测，符合既有 `extractClassName` 等纯函数导出惯例。
- **判定：PASS**

## 4. 安全与稳定性

- 无新增注入面：所有新逻辑操作的是已解析的 AST 节点文本和内存索引 Map，无字符串拼接执行、无文件系统写入、无路径拼接消费外部输入。
- `graph-builder.ts` 新增的 `droppedCount`/`console.warn` 是纯计数与日志，输入为内部边集合，不会因异常输入抛错（无 `.length`/`.property` 访问链条依赖未校验的外部数据）。
- `ANON_CONTEXT_RE = /^<(arrow|fn|gen):/` 结构简单（无嵌套量词、无回溯放大结构），字符类 + 锚点 + 固定字面量选择分支，无 ReDoS 风险。
- **判定：PASS**

## 5. 测试质量

- **Red fixture 断言强度**：抽查 `F242-1`（`enclosingNamedContext === 'registerX'`，非仅 `toBeDefined()`）、resolver 层 `①`/`②`/`③` 系列断言精确 `edge.source` 字符串值、ast-analyzer 层断言精确 `namedImports`/`namespaceImport` 数组/字符串值——均为强断言，非 shape-only。用手动回退实现（`resolveSourceId` 恒返回旧 `file::callerContext ?? '<module>'` 拼接）可反证：resolver 层 `①`/`②` 系列会因 `source` 值不匹配立即变红，验证断言确实钉住新行为。
- **端到端存活测试**（`tests/integration/call-edge-survival.test.ts`）：复刻生产管线（`TsJsLanguageAdapter.analyzeFile` → `buildUnifiedGraph` → `buildKnowledgeGraph`），断言最终图（悬空过滤后）含 3 条验收边 + 1 条精度对照边（导出函数内动态 import 应保持符号级 source，不降级）+ 1 条零悬空边不变量。这是唯一验证"边真正救回、真的存活过滤"的层级，非 mapper/resolver 中间产物断言，符合 plan 要求。
- **C-4 既有断言确未被触碰**：`git diff HEAD -- tests/unit/typescript-mapper-callsite.test.ts` 显示除 diff header 外仅有新增行（`-` 计数=1，即 header），零删除/修改行，C-4 回归锚字面保持。
- **判定：PASS**

## 6. 跨模块一致性

- `CallSiteSchema.enclosingNamedContext` 与 `ImportReferenceSchema.namespaceImport` 均为 `z.string().optional()` 纯增量字段。
- 全仓 `grep -rln "ImportReference\b"` / `"CallSite\b"` 消费方清单核实：Python/Java/Go mapper（`python-mapper.ts`/`java-mapper.ts`/`go-mapper.ts`）、`base-mapper.ts`、`tree-sitter-analyzer.ts`、`tree-sitter-fallback.ts`、`directory-graph.ts`、`knowledge-graph/unified-graph.ts`、`knowledge-graph/index.ts` 等消费方在构造对象时无需补齐新字段（结构类型系统对可选字段零强制）。
- `npm run build`（`tsc`）零错误，确认全部消费点（含 panoramic/express-extractor 等间接消费 import 语义的模块）无类型破坏。
- **判定：PASS，零破坏**

## 附录：实测验证命令

```bash
# AST 边界形态实测（临时脚本，审查后已删除，不留痕迹）
node ./test-binding.mjs   # 验证解构/rename/嵌套/rest/数组解构 AST 形态
node ./test-binding2.mjs  # 验证括号包裹动态 import 的 parent 链

# 分层单测
npx vitest run tests/unit/typescript-mapper-callsite.test.ts \
  tests/unit/knowledge-graph/call-resolver.test.ts \
  tests/unit/ast-analyzer.test.ts \
  tests/integration/call-edge-survival.test.ts
# → 4 files, 103 tests passed

# 全量回归
npx vitest run
# → 491 passed | 4 skipped (495 files); 6050 passed | 18 skipped | 21 todo (6089 tests)

# 类型检查 + 构建
npm run build
# → tsc 零错误
```

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 2 个（`isAddressable` 对深层嵌套 dotted callerContext 的精度退化到模块级；`await (import('x'))` 括号包裹形态未覆盖，fail-safe 不崩溃）

## 总体质量评级

**EXCELLENT**（零 CRITICAL，零 WARNING，代码质量优秀；改动聚焦、边界处理完备、测试断言强度高、跨模块零破坏）
