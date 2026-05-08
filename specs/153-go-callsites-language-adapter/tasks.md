# Feature 153 — Tasks

**Feature Branch**: `claude/nervous-herschel-832b94`
**Spec**: [spec.md](spec.md) ([6 轮 Codex review GATE_DESIGN PASS])
**Plan**: [plan.md](plan.md)
**Status**: Ready for Implementation

---

## 关键路径概览

```
P0 准备 → P1 mapper 核心 → P2 mapper 边界 → P3 adapter + 单测 → P4 verify 脚本 → P5 GORM 端到端验收
```

总任务数：**16 个**（T-001 ~ T-016）。
预估总工作量：**5.5-7 天**（与 spec 一致）。

---

## 阶段 P0：准备与小骨架（~0.5 天）

### T-001 — `extractCallSites` 入口 + 空壳栈协议

**FR**: FR-1, FR-7
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: 无（启动任务）

**实施内容**:

1. 在 `GoMapper` 类底部新增 `extractCallSites(tree, source): CallSite[]` 方法（实现 `QueryMapper.extractCallSites` 可选成员）
2. 加入 `CALLSITES_MAX_FILE_BYTES = 1_000_000` 常量
3. size guard：`source.length > CALLSITES_MAX_FILE_BYTES` 直接返回 `[]`
4. 实现 `_walkCallSites` 空壳（暂不调 `_handleCall`）：进入 method/function/func_literal 时 push ctxStack + recvVarStack；try/finally 配对 pop；递归子节点
5. 实现辅助函数 stub：`_extractReceiverTypeName` / `_extractReceiverVarName` 返回 null（待 T-005 完善）
6. 从 `src/models/call-site.ts` import `CallSite` / `CalleeKind`

**验收**:
- `npm run build` 无错误
- 不调用 `extractCallSites` 的现有路径（`tests/adapters/go-adapter.test.ts`）继续 PASS

---

### T-002 — 测试文件骨架

**FR**: FR-8
**文件**: `tests/core/query-mappers/go-mapper.test.ts`（新建）
**依赖**: T-001

**实施内容**:

1. 新建测试文件，import `GoMapper`, `Parser`, tree-sitter-go grammar
2. 写 `beforeAll` 加载 grammar，`beforeEach` 创建 mapper 实例
3. 写一个最小 smoke test：`extractCallSites(tree of "package main\nfunc main() {}", source)` 返回 `[]`（空函数，无 call_expression）
4. 占位 5 个 `it.todo` 标记 FR-8 必须场景

**验收**:
- `npx vitest run tests/core/query-mappers/go-mapper.test.ts` PASS（smoke + 5 todo 不算失败）

---

## 阶段 P1：mapper 核心分类（~1.5 天）

### T-003 — 行 #1, #2: identifier / func_literal callee

**FR**: FR-1, FR-2 行 #1, #2
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-001

**实施内容**:

1. 新增 `_handleCall(node, callerContext, receiverVarName, importAliases, out)` 方法
2. 在 `_walkCallSites` 中，当 `node.type === 'call_expression'` 时调用 `_handleCall`
3. `_handleCall` 内部：
   - 取 `funcNode = node.childForFieldName('function')`
   - 行 #1: `funcNode.type === 'identifier'` → push `_mkCallSite(funcNode.text, 'free', line, column, callerContext)`
   - 行 #2: `funcNode.type === 'func_literal'` → push `_mkCallSite('<anon-func>', 'free', line, column, callerContext)`
4. 实现 `_mkCallSite` 构造函数

**验收**:
- 单测 fixture: `func main() { helper() }` → 1 条 CallSite, calleeName="helper", calleeKind="free", callerContext="main"
- 单测 fixture: `func main() { func() {}() }` → 1 条 CallSite, calleeName="<anon-func>", calleeKind="free"

---

### T-004 — 行 #6: import alias 扫描 + cross-module

**FR**: FR-2 行 #6, FR-5
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-003

**实施内容**:

1. 新增 `_scanImports(root): Set<string>` 方法（参考 go-call-extractor.mjs `_scanImports`）：
   - 遍历 root.namedChildren 找 `import_declaration`
   - 处理 `import_spec` 单条 / `import_spec_list` 多条
   - 自定义 alias `import f "fmt"` → 用 alias `f`
   - 标准 import `import "fmt"` → 用 path 末段 `fmt`
   - dot import (name=dot) / blank import (name=blank_identifier) → skip
2. `extractCallSites` 入口先调 `_scanImports` 得到 importAliases，传入 `_walkCallSites` → `_handleCall`
3. `_handleCall` 中处理 `selector_expression`：
   - 取 `operandNode = funcNode.childForFieldName('operand')`
   - 取 `fieldNode = funcNode.childForFieldName('field')`
   - 行 #6: `operandNode.type === 'identifier' && importAliases.has(operandNode.text)` → push `_mkCallSite(fieldNode.text, 'cross-module', line, column, callerContext, operandNode.text)`

**验收**:
- 单测 fixture: `import "fmt"\nfunc main() { fmt.Println("x") }` → 1 条 CallSite, calleeName="Println", calleeKind="cross-module", calleeQualifier="fmt"
- 单测 fixture: `import f "fmt"\nfunc main() { f.Println("x") }` → 1 条 CallSite, calleeQualifier="f"
- 单测 fixture: `import . "fmt"\nfunc main() { Println("x") }` → 1 条 CallSite, calleeName="Println", calleeKind="free"（dot import 不入 alias，按 #1 free）

---

### T-005 — receiver 类型 + var name 提取（FR-7 完善）

**FR**: FR-7
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-001（已有 stub）

**实施内容**:

1. 完善 `_extractReceiverTypeName(methodDecl): string | null`（参考 go-call-extractor.mjs `_extractReceiverTypeName` 与 `_extractTypeNameRecursive`）：
   - 取 receiver field（parameter_list）
   - 遍历 parameter_declaration 内的 type 子节点
   - 递归 unwrap：type_identifier / pointer_type / generic_type / qualified_type
2. 完善 `_extractReceiverVarName(methodDecl): string | null`：
   - 取 receiver field
   - 遍历 parameter_declaration 内第一个 identifier 子节点（receiver 名）
3. 在 `_walkCallSites` 进入 `method_declaration` 时调用两者，push `${typeName}.${methodName}` 到 ctxStack；push receiver var 到 recvVarStack

**验收**:
- 单测 fixture: `func (s *Server) Start() { helper() }` → CallSite[0].callerContext === "Server.Start"
- 单测 fixture: `func (s **NestedPtr) M() { x() }` → callerContext === "NestedPtr.M"
- 单测 fixture: `func (s MyType[K, V]) M() { x() }` → callerContext === "MyType.M"
- 单测 fixture: `func (*Server) NoVar() { x() }` → callerContext === "Server.NoVar"，receiverVarStack[top]=null

---

### T-006 — 行 #7, #8: receiver method vs free

**FR**: FR-2 行 #7, #8
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-005, T-004

**实施内容**:

继续在 `_handleCall` selector_expression 分支中：
- 行 #7: `operandNode.type === 'identifier' && receiverVarName !== null && operandNode.text === receiverVarName` → push `_mkCallSite(fieldNode.text, 'member', line, column, callerContext)`（**qualifier=undefined**）
- 行 #8: `operandNode.type === 'identifier'`（其他 — 非 alias 非 receiver var）→ push `_mkCallSite(fieldNode.text, 'free', line, column, callerContext)`（**qualifier=undefined**）

**验收**:
- 单测 fixture: `func (s *Server) Start() { s.GetAddr() }` → CallSite{calleeName:"GetAddr", calleeKind:"member", calleeQualifier:undefined, callerContext:"Server.Start"}
- 单测 fixture: `func usewriter() { var w io.Writer; w.Write(buf) }` → CallSite{calleeName:"Write", calleeKind:"free", calleeQualifier:undefined, callerContext:"usewriter"}（receiverVarStack[top]=null，行 #8）

---

## 阶段 P2：mapper 边界形态（~1 天）

### T-007 — 行 #5: reflect/unsafe → unresolved

**FR**: FR-2 行 #5
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-004

**实施内容**:

在 `_handleCall` selector_expression 分支顶部（行 #6 之前）：
- 新增常量 `GO_REFLECTION_RECEIVERS = new Set(['reflect', 'unsafe'])`
- 行 #5: `operandNode.type === 'identifier' && GO_REFLECTION_RECEIVERS.has(operandNode.text)` → push `_mkCallSite(fieldNode.text, 'unresolved', line, column, callerContext)`

**验收**:
- 单测 fixture: `func main() { reflect.ValueOf(x) }` → CallSite{calleeName:"ValueOf", calleeKind:"unresolved"}
- 单测 fixture: `func main() { unsafe.Sizeof(x) }` → CallSite{calleeName:"Sizeof", calleeKind:"unresolved"}

---

### T-008 — 行 #9: 嵌套 selector / 复杂 operand → free

**FR**: FR-2 行 #9
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-006

**实施内容**:

在 `_handleCall` selector_expression 分支末尾（所有 identifier operand 路径都未匹配后）：
- 行 #9: 任意 non-identifier operand → push `_mkCallSite(fieldNode.text, 'free', line, column, callerContext)` (qualifier=undefined)

**验收**:
- 单测 fixture: `func (s *Server) Start() { s.listener.Accept() }` → CallSite{calleeName:"Accept", calleeKind:"free", calleeQualifier:undefined}（最外层 operand 是 selector_expression）
- 单测 fixture: `func main() { a.B().C() }` → 2 条 CallSite：B (member 或 free) + C (free)
- 单测 fixture: `func main() { x.(T).M() }` (type assertion) → CallSite{calleeName:"M", calleeKind:"free"}

---

### T-009 — 行 #3, #4: parenthesized_expression（类型转换）

**FR**: FR-2 行 #3, #4
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-003

**实施内容**:

1. 新增 `_classifyParenthesized(parenNode)` 方法（参考 go-call-extractor.mjs `_unwrapParenthesized` + `_typeNameToCallee`）：
   - while loop unwrap parenthesized_expression
   - 解开 unary_expression（`*X`）取 operand
   - identifier T → `{calleeKind:'free', calleeName:T}`
   - selector_expression(pkg, T) → `{calleeKind:'cross-module', calleeName:T, calleeQualifier:pkg}`
   - 其它（pointer_type / qualified_type / generic_type 罕见类型位置）→ `{calleeKind:'unresolved', calleeName:'<paren-callee>'}`
2. 在 `_handleCall` 中检测 `funcNode.type === 'parenthesized_expression'` → 调用 `_classifyParenthesized`

**验收**:
- 单测 fixture: `func main() { _ = (*Server)(nil) }` → CallSite{calleeName:"Server", calleeKind:"free"}
- 单测 fixture: `func main() { _ = (T)(x) }` → CallSite{calleeName:"T", calleeKind:"free"}
- 单测 fixture: `func main() { _ = (*sql.DB)(nil) }` → CallSite{calleeName:"DB", calleeKind:"cross-module", calleeQualifier:"sql"}

---

### T-010 — 行 #10, #11: index_expression (generic) + fallback

**FR**: FR-2 行 #10, #11
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-008

**实施内容**:

在 `_handleCall` selector_expression 分支后、fallback 之前：
1. 行 #10: `funcNode.type === 'index_expression'` 且 `operandNode.type === 'identifier'` 且 `indexNode.type === 'type_arguments' || 'type_argument_list'` → push `_mkCallSite(operandNode.text, 'free', line, column, callerContext)`
2. 行 #11 (fallback): 其它形态 → 取 funcNode.text 截断 ≤ 60 字符，push `_mkCallSite(safeName, 'unresolved', line, column, callerContext)`

**验收**:
- 单测 fixture: `func main() { MakeMap[string, int]() }` → CallSite{calleeName:"MakeMap", calleeKind:"free"}（前提是 tree-sitter-go grammar 这样解析；如实测形态不同，按实测行为对齐 FR-2 表格最贴近行）
- 单测 fixture: `func main() { m["k"]() }` → CallSite{calleeKind:"unresolved"}
- 单测 fixture: `func main() { maker()() }` → 至少包含外层 `maker()` 抽到 CallSite 1（行 #1 free）；外层 `maker()()` 整体 callee=call_expression → CallSite 2 (unresolved + funcNode.text="maker()")

---

### T-011 — phantom call 防御 + ERROR/MISSING skip

**FR**: FR-6
**文件**: `src/core/query-mappers/go-mapper.ts`
**依赖**: T-001

**实施内容**:

1. 新增 `_isPhantomCall(callExpr): boolean` 方法（参考 go-call-extractor.mjs `_isPhantomCall`）：
   - funcNode 缺失 / hasError === true → true
   - sibling 含 ERROR/MISSING → true
2. `_handleCall` 入口先 `if (this._isPhantomCall(node)) return;` skip phantom
3. `_walkCallSites` 中检测 `node.type === 'ERROR' || 'MISSING'` 直接 return（不递归 children）

**验收**:
- 单测 fixture: 含语法错误的 .go 源（如 `func main() { foo( )` 缺 `}`），mapper 不抛异常，rootNode.hasError=true 时仍 walk 部分子树
- 现有 `tests/golden-master/golden-master.test.ts` 继续 PASS

---

## 阶段 P3：adapter 透传 + 完整单测（~0.5 天）

### T-012 — GoLanguageAdapter 透传 extractCallSites flag

**FR**: FR-4
**文件**: `src/adapters/go-adapter.ts`
**依赖**: T-001（mapper 入口存在）

**实施内容**:

修改 `analyzeFile`（仅 1 行）：
```typescript
return analyzer.analyze(filePath, 'go', {
  includePrivate: options?.includePrivate,
  extractCallSites: options?.extractCallSites,   // ← 新增
});
```

**验收**:
- `npm run build` 无错误
- 现有 `tests/adapters/go-adapter.test.ts` 全部继续 PASS（不传 flag 时行为不变）

---

### T-013 — 单测全量补齐（FR-8 ≥ 5 + 边界 ≥ 6）

**FR**: FR-8, FR-9
**文件**: `tests/core/query-mappers/go-mapper.test.ts` + `tests/adapters/go-adapter.test.ts`（向后兼容测试放 adapter test）
**依赖**: T-001 ~ T-012（所有 mapper 实现完成）

**实施内容**:

#### Mapper 单测（mapper 行为）

- 把 T-002 的 `it.todo` 全部转为完整 it 实现（5 个核心场景）
- 新增以下 ≥ 6 个边界用例（Codex Round-7 WARNING I 修订：补 EC-Go-2 / EC-Go-5）：
  6. **reflect call**（EC-Go-1 衍生）: `reflect.ValueOf(x)` → CallSite{calleeKind:"unresolved"}
  7. **nested selector**（EC-Go-7 衍生）: `s.listener.Accept()` → free + qualifier=undefined
  8. **parenthesized type conversion**（EC-Go-7）: `(*Server)(nil)` / `(*sql.DB)(nil)` → free / cross-module
  9. **大文件 size guard**: source.length > 1MB → mapper 返回 []
  10. **defer / go statement** (EC-Go-2): `defer fmt.Println("done"); go worker()` → 各 1 条 CallSite（defer/go 修饰不影响内层 call_expression 抽取）
  11. **blank import / dot import** (EC-Go-4 / EC-Go-5): `import _ "lib/init"` 副作用导入不入 alias；`import . "fmt"` dot 导入也不入 alias，`Println()` bare call 走行 #1 free
  12. **嵌套指针 receiver** (EC-Go-3): `func (s **NestedPtr) M() { x() }` → callerContext="NestedPtr.M"

#### Adapter 单测（向后兼容守门，Codex Round-7 WARNING D 修订：从 mapper test 移到 adapter test）

在 `tests/adapters/go-adapter.test.ts` 末尾新增 1 个 describe block：

```typescript
describe('GoLanguageAdapter — Feature 153 callSites 透传', () => {
  it('extractCallSites=undefined（不传 flag）时 skeleton.callSites === undefined', async () => {
    const adapter = new GoLanguageAdapter();
    const skeleton = await adapter.analyzeFile(basicGo);
    expect(skeleton.callSites).toBeUndefined();
  });

  it('extractCallSites=true 时 skeleton.callSites 是数组', async () => {
    const adapter = new GoLanguageAdapter();
    const skeleton = await adapter.analyzeFile(basicGo, { extractCallSites: true });
    expect(skeleton.callSites).toBeDefined();
    expect(Array.isArray(skeleton.callSites)).toBe(true);
  });
});
```

**验收**:
- `npx vitest run tests/core/query-mappers/go-mapper.test.ts` ≥ 12 个 it 全部 PASS
- `npx vitest run tests/adapters/go-adapter.test.ts` 现有 + 新增 callSites 透传测试全部 PASS
- `npx vitest run` 全量 PASS（FR-9）
- `npm run build` 无错误

---

## 阶段 P4：verify 脚本（~1 天）

### T-014 — verify-feature-153.mjs 入口 + 框架

**FR**: FR-10
**文件**: `scripts/verify-feature-153.mjs`（新建）
**依赖**: T-013

**实施内容**:

1. 复制 `scripts/verify-feature-151.mjs` 作为模板
2. 修改 import：
   - `GoLanguageAdapter` 替代 `PythonLanguageAdapter`
   - `extractGoCallSites` 替代 Python extractor
3. 添加 `--ignore-dirs` CLI 参数解析
4. 默认 `ignoreDirs = ['callbacks', 'clause', 'internal', 'logger', 'migrator', 'schema', 'tests', 'utils']`（GORM 顶层包）
5. 实现 `collectGoFiles(targetRoot, ignoreDirs)`（POSIX 归一）
6. 实现 `labelOnlyMatch(graphEdges, truthCalls)` 计算 precision/recall（caller 归一化由 T-015 实施）
7. 输出 summary JSON 字段（**Codex Round-7 J 修订：严格对齐 verify-feature-151.mjs schema**）：
   - `target` / `ignoreDirs` / `goFileCount` / `skeletonsCount` / `unifiedGraphNodes` / `unifiedGraphCallsEdges` / `callSitesTotal` / `filesWithCallSites` / `truthFilesWithCalls` / `fillRate` / `fillRatePercent` / `wallMapperMs` / `precisionRuns[]` / `recallRuns[]` / `precisionMedian` / `recallMedian` / `precisionMedianPercent` / `recallMedianPercent` / `sampleHits[]`
   - **不**包含 `sc1Pass` / `sc2Pass` 作为公共 summary 字段；FR-11 验收门槛通过 exit code 表达：`sc1Pass=fillRate>=0.95 && sc2Pass=median>=阈值 → exit 0；否则 exit 1`

**验收**:
- `node scripts/verify-feature-153.mjs --help` 显示 usage（如果实现 --help）或不报错
- 在小型 fixture（自构造 ~3 个 .go 文件）上跑通端到端流程
- summary JSON schema 与 verify-feature-151.mjs 完全一致（diff 字段集只增不变）

---

### T-015 — labelOnlyMatch caller 归一化

**FR**: FR-10
**文件**: `scripts/verify-feature-153.mjs`
**依赖**: T-014

**实施内容**:

1. 跑一次 verify on small fixture，看 graph edges 的 source/target 实际格式 与 truth-set 的 caller/callee 格式
2. 实现 normalize：把 graph format `<absPath>::<funcContext>` 归一到 truth format `<relPath>:<funcContext>`
3. 验证 label-only matching 集合在 small fixture 上 IoU > 0

**验收**:
- 在自构造 fixture 上跑出 precision/recall > 0（证明 normalize 正确）
- 不抛 normalize 异常

---

## 阶段 P5：GORM 端到端验收（~1-2 天，含 tune）

### T-016 — GORM baseline 端到端跑通 + 验收 SC-1/SC-2

**FR**: FR-11
**文件**: `specs/153-go-callsites-language-adapter/verification/verification-report.md`（新建）
**依赖**: T-015

**实施内容**:

1. 确认 `~/.spectra-baselines/gorm` 已 clone（若未 clone 跑 `bash scripts/baselines/clone-baseline-projects.sh`）
2. 跑 `npm run build`
3. 跑 `node scripts/verify-feature-153.mjs --target ~/.spectra-baselines/gorm --out specs/153-go-callsites-language-adapter/verification/summary.json`
4. 检查 summary JSON：
   - `fillRate >= 0.95`（SC-1）
   - `precisionMedian >= 0.70 && recallMedian >= 0.30`（SC-2）
5. 如果未达标：
   - precision 不达标 → 检查是否漏抽 selector_expression / 误标 calleeKind
   - recall 不达标 → 检查是否漏 ignoreDirs 配置 / mapper 是否抽到 import alias 集合外的 cross-module call
   - 修复后重跑直到达标
6. 写 `verification-report.md` 包含：
   - 实测 fillRate / precision / recall 数字
   - confidence 分布（high / medium / low 各占比）
   - wallMapperMs（NFR-1 校验）
   - 已知 gap（如 dot import / generic call / 复杂表达式接受降级）
   - SC-1/SC-2/SC-3/SC-4/SC-5 逐项 PASS/FAIL 标记

**验收**:
- `node scripts/verify-feature-153.mjs --target ~/.spectra-baselines/gorm` 退出码 0（exit 0 表示 fillRate ≥ 0.95 && precisionMedian ≥ 0.70 && recallMedian ≥ 0.30 全部通过；否则 exit 1）
- `verification-report.md` 含完整测试证据
- `npx vitest run` 全量 PASS（SC-3）
- `npm run build` 无错误（SC-4）

---

## 任务总表

| 任务 | FR | 依赖 | 估时 | 阶段 |
|------|-----|------|------|------|
| T-001 | FR-1, FR-7 | — | 0.3d | P0 |
| T-002 | FR-8 | T-001 | 0.2d | P0 |
| T-003 | FR-1, FR-2(#1,#2) | T-001 | 0.3d | P1 |
| T-004 | FR-2(#6), FR-5 | T-003 | 0.4d | P1 |
| T-005 | FR-7 | T-001 | 0.4d | P1 |
| T-006 | FR-2(#7,#8) | T-005, T-004 | 0.3d | P1 |
| T-007 | FR-2(#5) | T-004 | 0.1d | P2 |
| T-008 | FR-2(#9) | T-006 | 0.2d | P2 |
| T-009 | FR-2(#3,#4) | T-003 | 0.3d | P2 |
| T-010 | FR-2(#10,#11) | T-008 | 0.2d | P2 |
| T-011 | FR-6 | T-001 | 0.2d | P2 |
| T-012 | FR-4 | T-001 | 0.05d | P3 |
| T-013 | FR-8, FR-9 | T-001~T-012 | 0.6d | P3（含 EC-Go-2/3/5 边界 + adapter 透传测试）|
| T-014 | FR-10 | T-013 | 0.7d | P4 |
| T-015 | FR-10 | T-014 | 0.4d | P4（含 caller normalize 边界 fixture）|
| T-016 | FR-11 | T-015 | 2.0d | P5（含 GORM tune 循环 + verification-report）|
| Codex review × 6 phase | FR-12 | 各 phase commit 前 | 1.0d | 跨 phase（每 phase ~30min review + ~30min 修复）|
| Push 前 deliverable report | CLAUDE.local.md | T-016 | 0.1d | P5 末 |

**总估时**: **~7.0 天**（Codex Round-7 WARNING G 修订：纳入 review 修复 + GORM tune 循环 + push report 时间）

---

## FR 覆盖映射

| FR | 任务 |
|----|------|
| FR-1 (extractCallSites 入口) | T-001, T-003 |
| FR-2 (calleeKind 11 行表) | T-003, T-004, T-006, T-007, T-008, T-009, T-010 |
| FR-3 (calleeQualifier) | T-004, T-006, T-009 |
| FR-4 (adapter 透传) | T-012 |
| FR-5 (import alias 扫描) | T-004 |
| FR-6 (phantom call 防御) | T-011 |
| FR-7 (callerContext + receiver var 栈) | T-001, T-005 |
| FR-8 (单测 ≥ 5) | T-002, T-013 |
| FR-9 (现有单测无回归) | T-013 |
| FR-10 (verify 脚本) | T-014, T-015 |
| FR-11 (GORM 验收门槛) | T-016 |
| FR-12 (Codex 阶段性对抗审查) | 流程层（每 phase commit 前跑 codex-rescue） |

---

## 并行调度建议

### P0/P1/P2 阶段

任务有强依赖链，整体串行。但以下可并行：

- **mapper 实现 ↔ 单测**：T-001 完成后，T-002 与 T-003 可并行（一人写测试 setup，一人写 mapper #1/#2）
- **行 #3/#4 与 行 #5/#6**：T-009（parenthesized）与 T-007（reflect）+ T-004（alias）可并行（无共享代码）

### P3 阶段

- T-012 adapter 改 1 行 + T-013 单测补齐可并行（不同文件）

### P4 阶段

T-014 与 T-015 串行（T-015 依赖 T-014 跑通后看实际 graph format）

### P5 阶段

严格串行（依赖 T-016 实测才能写 verification-report）

---

## 推荐实施策略

1. **从骨架开始**：T-001 → T-002 → T-003 → 提交（**Codex review #1**：spec 已 review，implement-spec 阶段第一次 commit 仍跑 review）
2. **核心分类完成**：T-003 → T-004 → T-005 → T-006 → 提交（**Codex review #2**）
3. **边界完成**：T-007 → T-008 → T-009 → T-010 → T-011 → 提交（**Codex review #3**）
4. **adapter + 完整单测**：T-012 → T-013 → 提交（**Codex review #4**）
5. **verify 脚本**：T-014 → T-015 → 提交（**Codex review #5**）
6. **GORM 端到端**：T-016 → 写 verification-report → 提交（**Codex review #6 - 最终质量门**）

每提交前必跑：
- `npx vitest run`（全量）
- `npm run build`
- `npm run repo:check`（如有改 plugins/spec-driver 之外的合约文件）
- `git rebase master`（如 152/154 已 ship 到 master）

---

## 依赖说明

- **必须先 verify**：master 当前 commit `761488f`（Feature 151 ship）。验证：`git log origin/master --oneline -1` 包含 "fix(151)"
- **GORM clone**：`~/.spectra-baselines/gorm/` 已存在（CLAUDE.local.md 已说明 clone 流程）。验证：`ls ~/.spectra-baselines/gorm/*.go | head`
- **dist build**：所有 verify 脚本任务依赖 `npm run build` 产物
