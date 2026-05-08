# Feature Specification: Go LanguageAdapter callSites 抽取

**Feature Branch**: `claude/nervous-herschel-832b94`（本 worktree；交付时 rebase + ff-merge 到 master，不开 PR 分支）
**Feature 编号**: 153
**Created**: 2026-05-08
**Status**: Draft
**Input**: 给 Go LanguageAdapter 添加 callSites 字段；本 Feature 是 `docs/design/spectra-mcp-evolution.md` 中"sub-feature 150c go"在本仓库的实现编号；与 152（ts-js）/ 154（java）/ 155 / 156 完全并行；不动 unified-graph schema / call-resolver / 其它语言 mapper。

---

## 目标摘要

Feature 153 把 Feature 151 已经在 Python 上跑通的 callSites → UnifiedGraph calls 边链路扩展到 Go：

1. 在 `GoMapper`（`src/core/query-mappers/go-mapper.ts`）实现可选的 `extractCallSites(tree, source)` 方法，遍历 tree-sitter Go AST 抽取 `CallSite[]`；
2. 让 `GoLanguageAdapter.analyzeFile`（`src/adapters/go-adapter.ts`）透传 `extractCallSites` flag，与 `PythonLanguageAdapter` 保持一致行为；
3. 输出严格符合 [src/models/call-site.ts](src/models/call-site.ts) 的 `CallSite` schema（含 `calleeName / calleeKind / line / column? / callerContext? / calleeQualifier?`）；
4. 在 GORM 顶层包（`~/.spectra-baselines/gorm` 中**仅顶层 .go**）上达成 call edges precision ≥ 70% / recall ≥ 30%，callSites 填充率 ≥ 95%；
5. 提供 `scripts/verify-feature-153.mjs` 独立验收脚本，复用 `scripts/lib/go-call-extractor.mjs` 重生成 truth-set 进行端到端验证。

**Codex Round-1 修订（2026-05-08，回应 CRITICAL #1-#4 / WARNING #5-#11）**：

- 本 Feature **仅交付 mapper + adapter + verify 脚本**；不进 batch-orchestrator 生产路径（Go 进 batch 留给后续 Feature；类比 Feature 151 是先 P0 mapper、Phase 6 P2 才接 batch）。Acceptance Scenario 已对齐"verify 端到端"而非"_meta/graph.json"。
- Go cross-module 调用（如 `fmt.Println()`）在本 Feature 阶段**统一落 Stage 4 low fallback**：因为 Go imports 的 `resolvedPath` 始终为 `null`（mapper 没有 go.mod / GOPATH 解析能力，本 Feature 不实现）。verify-feature-153 **不做"占位 target 注入"hack**（Codex Round-2 CRITICAL A/G 修订）：那种悬空虚拟节点会污染 graph 命名空间且对 graph_query 无意义。precision/recall 评估按 label-only matching（callee 名相等即算命中），confidence 分布只影响表象不影响指标 — high (same-module) + low (cross-module + 复杂表达式) 为主，medium 罕见，是合理工程现实。
- Go receiver method call（`s.X()`，receiver `s` 是当前 method 的 receiver var）的 `calleeKind` 修订为 **`member` + `calleeQualifier=undefined`**，让 call-resolver Stage 2 通过 `callerContext`（如 `"Server.Start"` → extractClassName → `"Server"`）找类；其它非 alias identifier receiver（不在 method 上下文内 / receiver var name 不匹配）标 **`calleeKind: 'free'`**，让 Stage 1/3/4 兜底（不再标 member 误导 Stage 2）。

**Codex Round-2 修订（2026-05-08，回应 Round-2 CRITICAL A/C/G + WARNING B/D + 残留矛盾）**：

- **删除占位 target 注入逻辑**（A/G）：cross-module 调用接受 Stage 4 low；FR-10 不再要求 verify 脚本构造 sentinel 文件
- **嵌套 selector 改归 free**（B）：FR-2 表格行 #9（`selector(operand=非 identifier 表达式, field=X)`）改为 `calleeKind: 'free'`（不再误标 member），让 Stage 1/4 兜底
- **新增 FR-2 行 #11**（C）：`function field = index_expression(operand=identifier X, index=type_arguments)` → `calleeKind: 'free'`, `calleeName: "X"`，剥掉 generic 参数
- **FR-7 加伪代码**（D）：明确 receiverVarName 栈 push/pop 时机（递归子节点前 push，try/finally pop）
- **清理 FR-8 / SC-3 残留**（FR-8 旧 `"s.listener"` 文本 / SC-3 旧 `3155→≥3160` 数字）

**关键路径上游**：Feature 151（UnifiedGraph + Python callSites + 共享 call-resolver，commit `761488f` 已 ship 到 master）。
**并行 sub-feature**：Feature 152（ts-js）/ 154（Java）/ 155 / 156。本 Feature 与它们没有源码冲突（各自只动自己语言的 adapter / mapper）。

---

## User Scenarios & Testing

### User Story 1 — Go 项目消费方通过 verify-feature-153 拿到带 calls 边的 UnifiedGraph (Priority: P1)

作为 spectra Knowledge Graph 4 语言扩展的下游消费者（先验证 verify 脚本端到端，再在后续 Feature 接入 batch-orchestrator 生产路径），我能在一个纯 Go 的中型项目（GORM 顶层包）上跑 `scripts/verify-feature-153.mjs`，得到 `UnifiedGraph` 含 **calls 类型边**，每条边带置信度（high / medium / low），可以追踪同模块函数调用、receiver method 调用、跨包静态调用以及 interface method 调用。

**Why this priority**: 这是 Feature 153 的核心交付价值。没有 P1，Go 项目跟着 Feature 151 一起在 Python 上拿到的 calls 边能力对 Go 用户完全不可见，4 语言扩展计划缺一角。

**Independent Test**: 在 `~/.spectra-baselines/gorm`（已 clone）上跑 `node scripts/verify-feature-153.mjs --target ~/.spectra-baselines/gorm`，验证 callPrecision ≥ 0.70（顶层 GORM .go scope 内 call edges）且 callRecall ≥ 0.30；同时验证 callSites 填充率 ≥ 95%（**Codex Round-1 verify-phase CRITICAL A 修订**: 分母用 truth-set 中真实有 calls 的文件数 `truthFilesWithCalls`，分子用 mapper 端在这些文件中抽到非空 callSites 的数量；类型定义 only 文件如 `model.go` / `interfaces.go` 不纳入分母）。

**关于 batch-orchestrator 生产路径（_meta/graph.json）**: 本 Feature **不**承诺 `_meta/graph.json` 含 Go calls 边；这需要 batch-orchestrator 新增 `collectGoCodeSkeletons` 与 Go module path resolver，列入 follow-up Feature scope。

**Acceptance Scenarios**:

1. **Given** GORM 顶层包（`association.go` / `callbacks.go` / `chainable_api.go` / `errors.go` / `finisher_api.go` 等 ≤ 30 个 .go 文件）已被 spectra 处理，**When** 调用 `analyzeFile(filePath, { extractCallSites: true })`，**Then** 返回的 `CodeSkeleton.callSites` 是非空数组，每条记录满足 `CallSiteSchema.parse()` 校验，至少覆盖以下 5 类：常规函数调用 / `pkg.Func()` 静态调用 / `receiver.Method()` 实例方法调用 / interface method 调用 / generic 函数调用
2. **Given** 一个手工构造的 Go 文件 `(s *Server) Start() { s.listener.Accept(); fmt.Println("ok") }`（`fmt` 在 import alias 集合中），**When** GoMapper.extractCallSites 处理，**Then** 输出至少 2 条 CallSite：
   - `{calleeName: "Accept", calleeKind: "free", calleeQualifier: undefined}` — receiver = `s.listener`（嵌套 selector，最外层 operand 是 selector_expression 而非 identifier），按 FR-2 表格行 #9（Codex Round-2 修订）落 free 而非 member（避免 Stage 2 误命中 `Server.Accept`）
   - `{calleeName: "Println", calleeKind: "cross-module", calleeQualifier: "fmt"}`
   两条都含 `callerContext = "Server.Start"`
3. **Given** 一个 Go 文件含 `reflect.ValueOf(x).Call(args)`，**When** mapper 抽取，**Then** 该 reflect 调用被标记 `calleeKind: "unresolved"`（与 `go-call-extractor.mjs` 中 `GO_REFLECTION_RECEIVERS` 行为对齐）
4. **Given** 一个 Go 文件含 method `(s *Server) Start()` 内调用 `s.GetAddr()`（GetAddr 是 Server 的成员），**When** GoMapper.extractCallSites + buildUnifiedGraph 处理，**Then** 输出 CallSite `{calleeName: "GetAddr", calleeKind: "member", calleeQualifier: undefined, callerContext: "Server.Start"}`，且 call-resolver Stage 2 通过 callerContext "Server.Start" → extractClassName → "Server" 在 classMemberIndex 命中，产出 high confidence calls 边

---

### User Story 2 — 抽取到的 callSites 被 call-resolver 正确转换为 calls 边 (Priority: P1)

作为 `buildUnifiedGraph` 的调用方（batch-orchestrator / verify-feature-153 脚本），我把多个 Go `.go` 文件 analyzeFile 之后得到的 `CodeSkeleton[]` 喂给 `buildUnifiedGraph()`，得到的 `UnifiedGraph.edges` 中含 **calls** 类型边，且 `confidence` 等级依据 [call-resolver](src/knowledge-graph/call-resolver.ts) 的 4 阶段决策表分布合理（free 在同模块 → high；cross-module 命中 import → medium；unresolved → low）。

**Why this priority**: callSites 抽取本身只是 mapper 层产物，真正交付给消费者的是 `UnifiedGraph.edges`。如果 calleeKind / calleeQualifier 标错，resolver 4 阶段会算出错误的边目标（如假命中 Server.Accept），precision 直接崩。

**Independent Test**: 在 verify-feature-153.mjs 端到端流程中，**precision/recall 用 label-only matching（callee 名匹配即命中）评估，不依赖 confidence 分布**。confidence 分布只作为可观测信息记录到 verify 输出 JSON，不作 hard floor 验收门槛（cross-module 统一落 low 是本 spec 的设计选择）。

**Acceptance Scenarios**:

1. **Given** 一组 Go skeleton（含 import "fmt" 与同模块函数 helper），**When** `buildUnifiedGraph()` 处理，**Then** 输出 calls 边集中：
   - `helper()` 同模块调用 — Stage 1 命中 → high confidence 边（target=`<file>::helper`）
   - `fmt.Println()` 跨模块调用 — Stage 3 因 `resolvedPath=null` 找不到 target → fallthrough Stage 4 **low** confidence 边（target=`?::Println`，符合 cross-module 接受 low fallback 的设计）
2. **Given** GORM 顶层包全量 skeleton（约 1500-2500 个 callSite），**When** resolver 4 阶段处理，**Then** 输出 calls 边集中至少有 ≥ 1 条 high confidence 边（证明 Stage 1 / Stage 2 路径被实际触发，避免全部落 Stage 4 low 的退化场景）；precision / recall 由 SC-2 单独验收，与 confidence 分布解耦

---

### User Story 3 — 抽取行为不影响默认（不开 callSites）的现有路径 (Priority: P1)

作为已经在使用 `GoLanguageAdapter.analyzeFile(filePath)`（不传 `extractCallSites`）的现有调用方（spec drift checker / debt-scanner / 现有 spectra batch 路径未启用 Go callSites 时），我升级到 Feature 153 后**完全无感**：返回的 `CodeSkeleton` 中 `callSites` 字段为 `undefined`，所有现有 exports / imports / parseErrors 行为完全不变。

**Why this priority**: Feature 151 已经把 callSites 做成 opt-in（CL-05：默认 false）。Feature 153 必须严格遵守这个合约，否则会污染所有上游 spec / drift / quality 流水线。

**Independent Test**: 现有 `tests/adapters/go-adapter.test.ts` 与 `tests/golden-master/golden-master.test.ts` 全部继续 PASS，无回归。

**Acceptance Scenarios**:

1. **Given** Feature 153 已上线，**When** `analyzer.analyze(filePath, 'go')` 不带 `extractCallSites` flag，**Then** 返回的 skeleton.callSites === undefined（与 Feature 151 之前完全一致）
2. **Given** golden-master 测试套件，**When** 跑全量 vitest，**Then** 启动当下 master 基线的所有单测全部 PASS（数字以 git rebase 完成后的实测为准；不写死具体总数，避免 152/154 并行 merge 后失真）

---

### User Story 4 — 与 truth-set extractor 行为对齐 (Priority: P2)

作为 verify-feature-153 / 未来 graph-accuracy 的开发者，我希望 `GoMapper.extractCallSites` 对每条 call site 的 `calleeName` 与 `scripts/lib/go-call-extractor.mjs` 输出的 `truthCalls[].callee` 在大多数场景一致（label-only graph compare 才能匹配上）。

**Why this priority**: graph-accuracy 用 label-only matching（callee 名相等即视为命中），所以 mapper 与 extractor 必须对"callee 名"的提取规则一致。例如：
- bare call `helper()` → 都输出 `helper`
- selector `s.Start()` → 都输出 `Start`
- `(*T)(nil)` 类型转换 → 都输出 `T`

**Independent Test**: 单测构造 ≥ 5 个典型 Go 调用形态，断言 GoMapper.extractCallSites 输出的 calleeName 与 go-call-extractor.mjs 的 truthCalls.callee 一致。

**Acceptance Scenarios**:

1. **Given** Go 源 `_ = (*Server)(nil); fmt.Println("x")`，**When** 同一份源文件分别跑 mapper 与 extractor，**Then** 两个输出都含 `{calleeName/callee: "Server"}` + `{calleeName/callee: "Println"}`
2. **Given** Go 源 `a.B().C().D()` 链式调用，**When** mapper 抽取，**Then** 输出 3 条 CallSite (B / C / D)，与 extractor 行为一致

---

### User Story 5 — 大文件保护 (Priority: P3)

作为维护者，我不希望 Feature 153 在罕见的超大单文件 .go（> 1MB，如 GORM 中的某些生成代码或 protobuf 输出）上让 tree-sitter 解析阻塞或 callSites 数组膨胀过大。

**Why this priority**: P3 因为 GORM 顶层包不存在这种文件，但 follow-up Go 项目（如带 protobuf 的工程）可能命中。复用 Feature 151 已有的 `CALLSITES_MAX_FILE_BYTES = 1_000_000` 阈值即可。

**Independent Test**: 构造一个 > 1MB 的合法 .go 文件，调用 `analyzeFile(filePath, { extractCallSites: true })`，确认返回的 skeleton 仍包含 exports / imports（基础结构），但 `callSites` 字段为空数组 `[]`（被 size guard 跳过，与 Python 一致）；且不抛异常。

**Acceptance Scenarios**:

1. **Given** > 1 MB 的合法 .go 文件，**When** `analyzeFile(... { extractCallSites: true })` 调用，**Then** skeleton.callSites === `[]`（空数组，与 PythonMapper size guard 行为一致），但 skeleton.exports 与 skeleton.imports 非空（不破坏基础抽取）

---

### Edge Cases

- **EC-Go-1**: 单文件含 `func() { ... }()` IIFE — IIFE 调用 callee 是 func_literal，不在 export 表，标 `calleeKind: 'free'` 用 `<anon-func>` 占位（与 extractor 一致）；resolver Stage 1 命中失败 fallthrough 到 low confidence
- **EC-Go-2**: `defer pkg.Cleanup()` / `go pkg.Worker()` — defer/go statement 包裹的 call 仍要抽取（tree-sitter 把 defer/go 视为修饰，内层 call_expression 仍在 AST 中）
- **EC-Go-3**: 嵌套指针 receiver `(s **T) Method()` — `_extractReceiverTypeName` 已支持递归 unwrap，callerContext 正确给出 `T.Method`
- **EC-Go-4**: dot import `import . "fmt"` — dot import 不入 alias 集合（与 extractor 一致），所以 `Println()` 在 mapper 视角是 free 而非 cross-module；resolver Stage 1 命中失败 fallthrough 到 Stage 3 cross-module（无 import 命中）→ low fallback。**接受这种降级**，不为 dot import 引入特殊处理（GORM 不用 dot import）
- **EC-Go-5**: blank import `import _ "lib/init-only"` — 仅副作用，不参与 alias 集合；mapper 不需要为此 import 产任何 callSite
- **EC-Go-6**: tree-sitter parse 失败（rootNode.hasError = true）— 与 extractor 一致：仅记录 parseErrors，仍尝试节点级 walk；不让一个 syntax error 让整个文件 callSites 为空
- **EC-Go-7**: `parenthesized_expression` 包裹 callee（`(*T)(nil)` 类型转换）— 复用 extractor 中 `_unwrapParenthesized` 与 `_typeNameToCallee` 的等价逻辑，输出 `calleeName: 'T'`，`calleeKind: 'free'`（视为类型转换 = 同模块自定义类型构造，落 Stage 1 free）；`(*pkg.T)(nil)` 输出 `calleeName: 'T'`, `calleeKind: 'cross-module'`, `calleeQualifier: 'pkg'`
- **EC-Go-8（Codex Round-1 WARNING #5 补充）**: 方法值调用 `f := obj.Method; f()` — `f()` 是 bare identifier call，落 `calleeKind: 'free'`，`calleeName: 'f'`；resolver Stage 1 在同模块 export 表找不到 `f`（因为 `f` 是局部变量）→ fallthrough 到 Stage 3 cross-module 也找不到 → Stage 4 落 low fallback。**接受这种降级**，本 Feature 不做局部变量 alias 跟踪
- **EC-Go-9（Codex Round-1 WARNING #5 补充 + Round-3 INFO H 行号修订 + Round-5 CRITICAL 路由优先级修订）**: 复杂表达式 callee 形态分两类路由：
  - **non-selector callee**（落 FR-2 行 #11 unresolved）: `m["key"]()` callee = `index_expression(operand 非 identifier 或 index 非 type_arguments)`；`maker()()` callee = `call_expression`；其余非 selector / 非 parenthesized / 非 index_expression-with-type_arguments 形态。`calleeKind: 'unresolved'`，`calleeName` 取 funcNode.text 截断（≤ 60 字符）或 "<unknown>"；resolver Stage 4 落 low
  - **selector callee with non-identifier operand**（落 FR-2 行 #9 free）: `x.(T).Method()` callee = `selector_expression(operand=type_assertion, field=Method)`；嵌套 selector `s.listener.Accept()` callee = `selector_expression(operand=selector_expression, field=Accept)`；链式 `a.B().C()` 第二层 callee = `selector_expression(operand=call_expression, field=C)`。这些都满足 #9 条件（operand 非 identifier）→ `calleeKind: 'free'`，`calleeName` = field 文本，`calleeQualifier: undefined`；resolver Stage 1 在同模块 export 找 calleeName，未命中 fallthrough Stage 4 low
  - **路由优先级**: FR-2 表格按行号顺序 short-circuit 匹配（先匹配的形态先输出）。具体顺序：#1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → #10 → #11。`x.(T).Method()` 在 #9 命中（callee 是 selector_expression）后即返回，不再进入 #11
  - **接受这种降级**，本 Feature 不实现复杂表达式追踪
- **EC-Go-10（Codex Round-1 WARNING #5 补充）**: channel receive `(<-ch)()` — 实测 tree-sitter Go grammar 中 channel receive 是 `unary_expression` 套 `call_expression`，不会出现 `(<-ch)()` 直接 call 形态。如真实出现（罕见），落 FR-2 fallback `unresolved`

---

## Requirements

### Functional Requirements

#### FR-1 — GoMapper 实现 extractCallSites 方法 *(必须，Codex Round-1 WARNING #7 修订)*

- **User Stories**: US1, US2
- **MUST**：在 `src/core/query-mappers/go-mapper.ts` 上为 `GoMapper` 类新增 `extractCallSites(tree: Parser.Tree, source: string): CallSite[]` 方法（实现 `QueryMapper.extractCallSites` 可选成员）。
- **MUST**：方法内部递归遍历 AST，对 `call_expression` 节点产生 `CallSite` 记录；并在进入 `function_declaration` / `method_declaration` / `func_literal` 时维护 `callerContext` 栈与 `receiverVarName` 栈（与 `_resolveGoCaller` 行为对齐，但 callerContext 字段不带 file 前缀，仅含 `funcName` / `Type.method` / `<closure:line:col>` 形式）。
- **MUST**：**单文件 source 长度（字节数）> 1 MB（与 PythonMapper `CALLSITES_MAX_FILE_BYTES = 1_000_000` 一致）时**：mapper 返回**空数组 `[]`**（与 PythonMapper 行为一致，python-mapper.ts:312-315）。skeleton.callSites === [] 而非 undefined（向后兼容性由 NFR-4 重新声明）。exports / imports 不受影响。
- **MAY**：不实现 binary_operator / unary_operator dunder（Go 没有运算符重载概念）；不实现 super / decorator（Go 没有这些语义）。
- **必要性标注**: `[必须]`

#### FR-2 — calleeKind 分类规则 *(必须，Codex Round-1 CRITICAL #2 修订)*

- **User Stories**: US1, US2, US4
- **MUST**：mapper 输出的 `calleeKind` 严格按以下表格映射（与 `scripts/lib/go-call-extractor.mjs` 的 `_classifyCallExpression` 行为对齐 + 适配 call-resolver 4-stage 决策表）：

  | # | function field 形态 | calleeKind | calleeName | calleeQualifier |
  |---|--------------------|-----------|------------|----------------|
  | 1 | `identifier "foo"` | `free` | `"foo"` | undefined |
  | 2 | `func_literal` (IIFE) | `free` | `"<anon-func>"` | undefined |
  | 3 | `parenthesized_expression( inner = identifier T \| unary_expression(*T) )` | `free` | `"T"` | undefined |
  | 4 | `parenthesized_expression( inner = selector_expression(pkg, T) \| unary_expression(*pkg.T) )` | `cross-module` | `"T"` | `"pkg"` |
  | 5 | `selector_expression(operand=identifier ∈ reflect/unsafe, field=X)` | `unresolved` | `"X"` | undefined |
  | 6 | `selector_expression(operand=identifier ∈ importAliases, field=X)` | `cross-module` | `"X"` | operand 文本 |
  | 7 | `selector_expression(operand=identifier 非 alias 且 == 当前 method receiver var name, field=X)` | `member` | `"X"` | **undefined**（让 resolver 用 callerContext） |
  | 8 | `selector_expression(operand=identifier 非 alias 且 != 当前 method receiver var name, field=X)` | `free` | `"X"` | undefined（free 兜底，由 Stage 1/3/4 处理） |
  | 9 | `selector_expression(operand=非 identifier 表达式, field=X)` (如链式 `a.B().C()` / 嵌套 `s.listener.Accept()`) | **`free`**（Codex Round-2 修订） | `"X"` | undefined |
  | 10 | `index_expression(operand=identifier X, index=type_arguments)` — generic 函数调用 `MakeMap[string, int]()` | `free` | `"X"` | undefined |
  | 11 | 其它形态（`call_expression` callee / index_expression 内层非 identifier / 复杂表达式） | `unresolved` | `funcNode.text 截断 ≤60 字符` 或 `"<unknown>"` | undefined |

- **MUST 设计动机**:
  - 行 #7 的 `member` + `qualifier=undefined` 让 call-resolver Stage 2 通过 `callerContext`（如 `"Server.Start"` → extractClassName → `"Server"`）找类，命中 classMemberIndex 产 high/medium 边
  - 行 #8 的 `free` 而非 `member`（Codex Round-1 CRITICAL #2 修复）：Go 没有 self/cls，receiver 变量名（如 `other`）不是类名（如 `Server`），标 member 会让 Stage 2 用 `other` 在 moduleSymbolIndex 找类失败、落 medium 占位 `?::Method`，干扰 precision 评估。改标 free 让 Stage 1（同模块 export 命中）/ Stage 4（兜底 low）处理，更符合 Go 语义
  - 行 #9 的 `free` 而非 `member`（Codex Round-2 WARNING B 修复）：嵌套 selector 内层不是当前 method receiver，把 calleeName 当成"当前类的 method"会用 callerContext 误命中错误 class（如 `s.listener.Accept()` 在 `Server.Start` 内 → resolver 会找 `Server.Accept` 而非 `Listener.Accept`，假阳性）。改标 free 让 Stage 1 在同模块找 `Accept` export，找不到 fallthrough Stage 4 low，避免假命中
  - 行 #10 generic call 单独成行（Codex Round-2 CRITICAL C 修复）：避免承诺支持 generic 但实际落 unresolved。剥掉 type_arguments 后用内层 identifier 当 free callee
- **必要性标注**: `[必须]`

#### FR-3 — calleeQualifier 字段填充 *(必须，Codex Round-1 修订对齐 FR-2 表格)*

- **User Stories**: US1, US2
- **MUST**：calleeQualifier 严格按 FR-2 表格填充：
  - 行 #4（pkg.T 类型转换）/ #6（pkg.X 静态调用）→ qualifier = pkg 文本
  - 行 #1, #2, #3, #5, #7, #8, #9, #10, #11 → qualifier = `undefined`
- **MUST**：calleeQualifier 当来自 selector operand identifier 时使用 operand 的 `.text`（保留 PascalCase 大小写，不带 dereference 前缀）。
- **必要性标注**: `[必须]`

#### FR-4 — GoLanguageAdapter 透传 extractCallSites flag *(必须)*

- **User Stories**: US1, US3
- **MUST**：修改 `src/adapters/go-adapter.ts` 的 `analyzeFile`，在 `analyzer.analyze(filePath, 'go', {...})` 调用中显式透传 `extractCallSites: options?.extractCallSites`（与 PythonLanguageAdapter 行为一致）。
- **必要性标注**: `[必须]`

#### FR-5 — Import alias 集合扫描 *(必须)*

- **User Stories**: US1, US2, US4
- **MUST**：mapper 在 extractCallSites 入口先扫描 `source_file → import_declaration → import_spec` 收集 import alias 集合（行为对齐 `scripts/lib/go-call-extractor.mjs` 的 `_scanImports` / `_extractAliasFromImportSpec`）：
  - 自定义 alias `import f "fmt"` → 用 alias `f`
  - 标准 import `import "fmt"` → 用 path 末段 `fmt`
  - dot import `import . "fmt"` / blank import `import _ "x"` → 跳过（不入集合）
- **MUST**：alias 集合用于 `selector_expression operand` 的 cross-module vs member 区分（FR-2）。
- **必要性标注**: `[必须]`

#### FR-6 — phantom call / ERROR 节点防御 *(必须)*

- **User Stories**: US3, EC-Go-6
- **MUST**：与 extractor 一致：
  - `ERROR` / `MISSING` 节点直接 skip 子树
  - phantom call（callee 子树 hasError 或 sibling ERROR）skip 当前 call_expression（不抽取），但 children 仍 walk
  - rootNode.hasError = true 不让整个文件 callSites 为空（仍尝试节点级 walk）
- **必要性标注**: `[必须]`

#### FR-7 — receiver 类型识别（callerContext） *(必须，Codex Round-1 修订 + Round-2 WARNING D 加伪代码)*

- **User Stories**: US1, US2
- **MUST**：进入 `method_declaration` 时执行两个动作：
  1. **callerContext 维护**：从 receiver 提取 type 名（值 receiver / 指针 receiver / 嵌套指针 / 泛型 receiver / 泛型指针，与 extractor `_extractReceiverTypeName` 行为一致），callerContext 设为 `"Type.method"`；无法提取时回退 `"<anon-method>"`。
  2. **receiver var name 记录**：从 receiver 的 parameter_declaration 取 identifier 子节点（如 `(s *Server)` 中的 `s`），存入栈（与 callerContext 同步弹栈）；用于 FR-2 表格行 #7 vs #8 的判定（selector.operand.text == receiver var name 才走 #7 = member；否则走 #8 = free）。
  3. **空 receiver var 兜底**：如 receiver 没有 var name（少见，如 `(*Server) Start()`），receiver var name 栈压 `null`；selector.operand 与 `null` 比较恒为 false → 落 #8 free。
- **MUST**：`function_declaration` 进入时 callerContext 设为 `"funcName"`，receiver var name 栈压 `null`。
- **MUST**：`func_literal`（闭包）进入时 callerContext 设为 `"<closure:line:col>"`，receiver var name 栈压 `null`。
- **MUST 栈协议（Codex Round-2 WARNING D 修订）**: 用 try/finally 保证 push/pop 配对，避免 sibling scope 串污：

  ```typescript
  // 伪代码（plan.md 阶段细化为真实实现）
  function _walkCallSites(node, ctxStack, recvVarStack, out) {
    let pushed = false;
    if (node.type === 'method_declaration') {
      const typeName = _extractReceiverTypeName(node) ?? '<anon-method>';
      const methodName = fieldText(node, 'name') ?? '<anon-method>';
      const recvVar = _extractReceiverVarName(node); // 可能为 null
      ctxStack.push(`${typeName}.${methodName}`);
      recvVarStack.push(recvVar);
      pushed = true;
    } else if (node.type === 'function_declaration') {
      const fnName = fieldText(node, 'name') ?? '<anon-func>';
      ctxStack.push(fnName);
      recvVarStack.push(null);
      pushed = true;
    } else if (node.type === 'func_literal') {
      const line = node.startPosition.row + 1;
      const col = node.startPosition.column;
      ctxStack.push(`<closure:${line}:${col}>`);
      recvVarStack.push(null);
      pushed = true;
    }
    try {
      if (node.type === 'call_expression') _handleCall(node, ctxStack, recvVarStack, out);
      // 递归子节点
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) _walkCallSites(child, ctxStack, recvVarStack, out);
      }
    } finally {
      if (pushed) {
        ctxStack.pop();
        recvVarStack.pop();
      }
    }
  }
  ```
  callerContext = `ctxStack[ctxStack.length - 1]`，receiver var = `recvVarStack[recvVarStack.length - 1]`。
- **必要性标注**: `[必须]`

#### FR-8 — 单元测试覆盖 *(必须)*

- **User Stories**: US1, US2, US4
- **MUST**：在 `tests/core/query-mappers/go-mapper.test.ts`（新建）或现有 `tests/unit/lib/go-call-extractor.test.ts`（已存在但是 extractor 的测试）相邻位置新增 ≥ 5 个针对 `GoMapper.extractCallSites` 的单测，至少覆盖：
  1. regular function call (`helper()`) → free + 同模块 callerName
  2. package-qualified call (`fmt.Println()`) → cross-module + qualifier="fmt"
  3. receiver method call (`(s *Server) Start { s.listener.Accept() }`) → 输出 `{calleeName: "Accept", calleeKind: "free", calleeQualifier: undefined}`（最外层 operand 是 selector_expression 不是 identifier；按 FR-2 行 #9 / Codex Round-2 WARNING B 修订改归 free 防止 Stage 2 假命中）
  4. interface method call (`func usewriter() { var w io.Writer = nil; w.Write(buf) }` — caller 是 free function，**不**在 method 上下文中) → 按 FR-2 行 #8 输出 `{calleeName: "Write", calleeKind: "free", calleeQualifier: undefined}`（receiver var name 栈顶 = null，selector.operand "w" != null → 行 #8 free，与 FR-2/FR-3 一致；Codex Round-3 CRITICAL 修订删除"member + qualifier=w"旧文本）
  5. generic call (`MakeMap[string, int]()`) → 按 FR-2 行 #10（Codex Round-2 新增）输出 `{calleeName: "MakeMap", calleeKind: "free", calleeQualifier: undefined}`，前提是 tree-sitter-go grammar 把 callee 解析成 `index_expression(operand=identifier "MakeMap", index=type_arguments)`；如实测 grammar 形态不同（如直接 `call_expression(function=generic_call_x)`），按实测行为对齐 FR-2 表格中最贴近的形态行（不在测试中臆造）。**目标是与 FR-2 表格一一对应，不允许"双重规则"**
- **MUST**：现有 `tests/adapters/go-adapter.test.ts` 与 `tests/golden-master/golden-master.test.ts` 不修改、不破坏（FR-9 隐含）。
- **必要性标注**: `[必须]`

#### FR-9 — 现有单测无回归 *(必须，Codex Round-1 WARNING #8 修订)*

- **User Stories**: US3
- **MUST**：跑 `npx vitest run` 后，启动时（rebase 到最新 master 后）原本 PASS 的全量单测继续 PASS；只新增不破坏，新增至少 5 个 mapper 测试（FR-8 硬性要求）。
- **不要求具体数字**：因为 152/154 等并行 Feature 可能改变 master 单测总数；以"启动当下的 master 基线"为准。
- **必要性标注**: `[必须]`

#### FR-10 — 独立验收脚本 verify-feature-153.mjs *(必须，Codex Round-1 CRITICAL #3 + Round-2 CRITICAL A/G + INFO F 修订)*

- **User Stories**: US1, US2
- **MUST 输入合约**:
  - 接收 `--target <go-project-root>` 参数（默认验证目标 `~/.spectra-baselines/gorm`）
  - **GORM 顶层包 scope 默认硬编码 ignoreDirs**: `['callbacks', 'clause', 'internal', 'logger', 'migrator', 'schema', 'tests', 'utils']`（与 go-call-extractor.mjs:79-82 注释推荐一致），可通过 `--ignore-dirs a,b,c` 覆盖。**同一份 ignoreDirs 必须同时传给** skeleton walker 与 `extractGoCallSites()` 的 `options.ignoreDirs`，确保 mapper 端与 oracle 端 scope 完全一致
  - 默认 `--repeats 3`（与 verify-feature-151 一致，取中位数）
  - 可选 `--out <file.json>` 输出汇总
- **MUST 流程合约**:
  1. dist/.js dynamic import（用户先 `npm run build`）
  2. 扫 .go 文件 → analyzeFile(extractCallSites: true) → 收集 skeletons
  3. buildUnifiedGraph({projectRoot, codeSkeletons}) → UnifiedGraph
  4. extractGoCallSites({sourceRoot, ignoreDirs}) → truth-set（不入库，每次重生成）
  5. label-only matching 计算 callPrecision / callRecall（与 graph-accuracy.mjs 一致）
  6. 计算 callSites 填充率：分母用 `truthFilesWithCalls`（truth-set 中真实有 calls 的文件数，已排除 `_test.go` 与 type-only 文件如 `model.go`/`interfaces.go`），分子用 mapper 端这些文件中含非空 callSites 的数量。**Codex Round-1 verify-phase CRITICAL A 修订**: 实测发现 GORM 顶层包 14 个 .go 中 2 个是合法的 type-only 文件（仅 struct/interface 定义，无 call_expression），不应纳入分母惩罚 mapper。新分母与 SC-1 spec 意图"mapper 不应漏抽"严格对齐；额外保留 `fillRateOverAll = filesWithCallSites / totalTopLevelGoFiles` 作为可观测信息
  7. N=3 重测取中位数
- **MUST 输出合约**: stdout JSON 含字段 `target / goFileCount / skeletonsCount / unifiedGraphNodes / unifiedGraphCallsEdges / callSitesTotal / filesWithCallSites / truthFilesWithCalls / fillRate / fillRatePercent / fillRateOverAll / fillRateOverAllPercent / mapperHitsOnTruthFiles / precisionRuns[] / recallRuns[] / precisionMedian / recallMedian / precisionMedianPercent / recallMedianPercent / sampleHits[] / wallMapperMs`（与 verify-feature-151.mjs summary schema 兼容，新增 fillRateOverAll / mapperHitsOnTruthFiles 等可观测字段，Codex Round-1 verify-phase A 修订）
- **MUST 显式禁止**（Codex Round-2 CRITICAL A/G）：**不构造**外部 import 的占位 sentinel target / 占位 stub 节点；cross-module 调用接受 Stage 4 low fallback。理由：
  - 占位 target 是悬空虚拟节点，graph_query MCP 工具查不到，对下游消费者无意义
  - precision/recall 评估按 label-only matching（callee 名相等即算命中），confidence 不影响指标
  - 保持 verify 脚本与生产语义一致（生产 batch 路径同样无外部 module 解析能力）
- **MAY**: 脚本内可输出 `wallMs` 实测时间字段供 NFR-1 性能门槛核对（具体测时点位由 plan.md 决定）
- **设计原则（WHAT not HOW）**: 本 FR 锁定输入参数 / 流程概览 / 输出 schema / 禁止行为；具体的 ignoreDirs 数据结构、文件遍历伪代码、JSON schema 字段构造等实现细节由 plan.md 决定
- **必要性标注**: `[必须]`

#### FR-11 — GORM baseline 验收门槛 *(必须)*

- **User Stories**: US1
- **MUST**：在 `~/.spectra-baselines/gorm` 顶层包（`tests/baseline/gorm/truth-set.json` 由 `scripts/lib/go-call-extractor.mjs` 重生成获得 oracle，scope = `^[^/]+\.go$` 仅顶层）上：
  - callPrecision (median over N=3) ≥ **0.70**
  - callRecall (median over N=3) ≥ **0.30**
  - callSites 填充率 ≥ **0.95**（filesWithCallSites / totalTopLevelGoFiles）
- **MUST**：上述阈值数据写入 `specs/153-go-callsites-language-adapter/verification/verification-report.md` 作为最终交付证据。
- **必要性标注**: `[必须]`

#### FR-12 — Codex 阶段性对抗审查 *(必须，本仓库 CLAUDE.local.md 强制约定)*

- **User Stories**: 流程层（不出现在功能用户故事中）
- **MUST**：spec / plan / tasks / implement / verify 每个 phase commit 之前都必须经过 Codex 对抗审查（通过 `codex:codex-rescue` Agent）。
- **MUST**：Codex 给的 critical / warning / info 三档结论中，**真实 bug / 设计缺陷 / 边界遗漏** 必须在该 phase 内修复并重测；风格偏好 / 过度抽象建议可记录在 commit message 中。
- **必要性标注**: `[必须]`

### Key Entities

- **CallSite** — 由 [src/models/call-site.ts](src/models/call-site.ts) 定义；mapper 输出，resolver 消费。本 Feature 不修改 schema，仅按规则填字段。
- **GoMapper** — [src/core/query-mappers/go-mapper.ts](src/core/query-mappers/go-mapper.ts)；本 Feature 新增 `extractCallSites` 方法 + import alias 扫描辅助。
- **GoLanguageAdapter** — [src/adapters/go-adapter.ts](src/adapters/go-adapter.ts)；本 Feature 修改 `analyzeFile` 透传 `extractCallSites` flag。
- **truth-set extractor** — [scripts/lib/go-call-extractor.mjs](scripts/lib/go-call-extractor.mjs)；本 Feature 不修改，仅在 verify 脚本中复用。

---

## Quality Requirements (NFR)

- **NFR-1 性能**（Codex Round-1 WARNING #5 修订）: 单 .go 文件 mapper.extractCallSites 解析时间相对于现有 extractExports 增量 ≤ 100%（即开启 callSites 总耗时不超过原本的 2 倍 wall time，因为 callSites 是独立 AST walk）。GORM 顶层包全量验证（约 25 文件）总耗时 ≤ 30 秒（含 dist/.js dynamic import + buildUnifiedGraph + extractor 重生成 truth-set + N=3 重跑）。
- **NFR-2 内存**: mapper 完成后释放本地索引（importAliases / receiver var 栈 / 临时累积器）；不引入新的全局缓存。
- **NFR-3 可观测**: phantom call / dynamic call skip 不污染 stderr，但允许通过环境变量（如 `GO_MAPPER_DEBUG=1`）开启 debug log（**MAY** 实现，不强制）。
- **NFR-4 向后兼容**: `analyzeFile` 不传 `extractCallSites` flag 时，行为与 Feature 153 之前 100% 一致（callSites 字段为 undefined）。**当传 `extractCallSites: true` 但 source > 1MB 时**: skeleton.callSites === `[]`（与 Python 一致；不是 undefined）。

---

## Success Criteria

### Measurable Outcomes

1. **SC-1 — Go callSites 填充率**: 在 GORM 顶层包上跑 verify-feature-153.mjs，`fillRate ≥ 0.95`（分母 = `truthFilesWithCalls`，与 FR-10 步骤 6 修订对齐）
2. **SC-2 — Go call edges precision/recall（label-only）**: 在 GORM 顶层包上跑 verify-feature-153.mjs（N=3 中位数），`callPrecision ≥ 0.70` 且 `callRecall ≥ 0.30`
3. **SC-3 — 现有单测无回归**（Codex Round-2 残留矛盾修订）: `npx vitest run` 全量 PASS（启动当下 master 基线 + 本 Feature 新增 ≥ 5 个 GoMapper.extractCallSites 单测）；不写死具体总数，避免 152/154 并行 merge 后失真
4. **SC-4 — Build / lint 无报错**: `npm run build` 0 错误；`npm run lint`（如有）0 错误
5. **SC-5 — verification report 已交付**: `specs/153-go-callsites-language-adapter/verification/verification-report.md` 含 SC-1/SC-2/SC-3/SC-4 实测数字与时间戳

---

## 明确不做（Out of Scope）

- **不动 unified-graph schema / call-resolver**：Feature 151 已 ship，本 Feature 仅作为 mapper 端的输入产生方
- **不动其它语言 mapper**：ts-js (152) / java (154) 各自有独立 sub-feature
- **不实现 sqlite 持久化**：留给 Feature 156
- **不实现 Agent-Context MCP tools**：留给 Feature 155
- **不优化 confidence 算法**：现有 4-stage resolver 已经处理 Go 输入；如果 GORM 验收数据显示 confidence 分布不合理，留给后续 Feature 调优
- **不实现 dunder / super / decorator**：Go 无运算符重载、无显式 super 调用语义、无 decorator
- **不动 batch-orchestrator 的 Python skeleton collector**：Go skeleton 进入 batch 流水线的工作（如有需要）留给后续 Feature；本 Feature 仅交付 mapper + adapter + verify 脚本
- **不为 dot import 引入特殊处理**：EC-Go-4 接受降级行为
- **不要求 callRecall ≥ 50%**：label-only matching + GORM reflection-heavy 风格决定了 recall 天然偏低；70% precision + 30% recall 是合理工程平衡（参考 Feature 151 Python recall ≈ 35%）
- **不实现 batch-orchestrator Go skeleton collector**（Codex Round-1 CRITICAL #4）：`collectGoCodeSkeletons` 与 Go module path → 文件路径解析逻辑不在本 Feature scope；这意味着 Feature 153 完成后 batch-orchestrator 跑出的 `_meta/graph.json` **仍不含** Go calls 边。此 Out of Scope 项目通过以下方式补偿：
  - verify-feature-153.mjs 端到端走完整路径（mapper → buildUnifiedGraph → 计算指标）证明 mapper 输出可用
  - 后续 Feature 可独立做 batch 集成（追加 collectGoCodeSkeletons + Go module resolver），无需重做 mapper
- **不实现 Go module path 解析**（Codex Round-2 CRITICAL A/G 修订）：`go.mod` / GOPATH / vendor / replace 指令解析复杂度高（涉及 GOPATH 探测、third-party module download cache 查找等），留给后续 Feature。**verify 脚本不做"alias→占位 target"hack**：cross-module 调用统一落 Stage 4 low fallback；precision/recall 按 label-only matching 评估不受 confidence 分布影响。后续 Feature 接 batch-orchestrator 时再实现真实 Go module resolver

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 |
|------|------|
| **组件总数** | 1（GoMapper.extractCallSites + 辅助函数）+ 1（GoLanguageAdapter.analyzeFile 微调）+ 1（scripts/verify-feature-153.mjs 实现端到端验收）= **3** |
| **接口数量** | 0 新增 schema；0 新增公共类型；FR-1 仅实现 QueryMapper 已有的可选成员；verify 脚本输出 JSON schema 与 verify-feature-151.mjs 一致（无新合约） |
| **依赖新引入数** | 0（不新增 npm 依赖） |
| **跨模块耦合** | 仅修改 src/adapters/go-adapter.ts + src/core/query-mappers/go-mapper.ts；scripts/verify-feature-153.mjs 是新文件；零跨包变更 |
| **复杂度信号** | 2 个：(a) tree-sitter Go AST 形态多变（parenthesized_expression / unary_expression / generic_type / qualified_type 等需逐一处理，已在 extractor 调通可作蓝本）；(b) 与 call-resolver 4-stage 行为对齐需要细致设计 calleeKind / callerContext / receiverVarName 配合（FR-2 表格 + FR-7 receiver var 跟踪） |
| **代码量预估** | mapper 新增 ~250 行（AST walker + 辅助函数）；verify 脚本 ~200 行；测试 ~150 行；总 ~600 行新代码 |
| **总体复杂度** | **MEDIUM**（Codex Round-1 WARNING #9 修订：组件 = 3 + 复杂度信号 = 2，按规则判定 MEDIUM；不再低估为 LOW） |

GATE_DESIGN 决策建议：在 `gate_policy: balanced` 下走 `always` 暂停人工审查（因 MEDIUM 复杂度 + 多 CRITICAL 已在 spec 修订）；用户审查后再进入 plan 阶段。

---

## 依赖与风险

### 关键路径上游

- **Feature 151（已 ship 到 master commit `761488f`）**: UnifiedGraph schema、CallSite schema、4-stage call-resolver、buildUnifiedGraph、PythonMapper.extractCallSites、verify-feature-151.mjs 模板。本 Feature 严格依赖所有这些已存在。
- **Feature 150（已 ship）**: scripts/lib/go-call-extractor.mjs（truth-set generator）。本 Feature 不修改它，仅作为 oracle 复用。
- **`~/.spectra-baselines/gorm`**: 由 `scripts/baselines/clone-baseline-projects.sh` 已 clone（CLAUDE.local.md 已说明）。

### 已识别风险

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| GORM 大量 reflection-heavy 调用导致 recall 低于 30% | 🟡 WARNING | reflect/unsafe 已被 extractor 标 unresolved；GORM 日常代码主要是 receiver method + chainable_api，reflection 集中在 callbacks/internal 子包（被 truth-set scope 排除）。如初步跑出 recall < 30%，先看是否漏抽 selector_expression 链式调用（FR-2 表格行 #9 规则） |
| `parenthesized_expression` 形态复杂导致 mapper 与 extractor 行为漂移 | 🟡 WARNING | extractor 中已经处理 (\*T) / (T) / (\*pkg.T) / 嵌套指针 5 种形态；mapper 实现时**完全照搬** extractor 的 `_unwrapParenthesized` + `_typeNameToCallee` 逻辑（用 TypeScript 重写但语义 1:1） |
| generic call 在 tree-sitter Go grammar 中的 AST 形态不确定（possible: `index_expression` / `generic_call` / 直接 `call_expression`） | 🟢 INFO（Codex Round-3 修订与 FR-2 行 #10 对齐） | mapper 端按 FR-2 行 #10 处理 `index_expression(operand=identifier X, index=type_arguments)` → `free + name=X`；其他罕见 grammar 形态落 FR-2 行 #11 unresolved；FR-8 单测按实测形态断言，不臆造；不再说"自然走 unresolved fallback"（与 FR-2 行 #10 直接冲突） |
| 单测覆盖 < 5 个 | 🟢 INFO | FR-8 已硬性约束 ≥ 5 个，每类一个；额外 EC-Go-* 边界用例补充 |
| dot import (`import . "fmt"`) 工程（如 ginkgo/gomega 测试）大量 low fallback | 🟢 INFO（Codex Round-1 WARNING #10 + Round-5 confidence 用词修订） | 接受降级（GORM 不用 dot import）；EC-Go-4 已声明；下游 graph 消费者通过 UnifiedGraph 内部 `confidence=low` 字段（GraphJSON 输出层映射为 `AMBIGUOUS`，由 confidence-mapper.ts 转换）感知降级。verify-feature-153 默认排除 `_test.go` 文件以避免测试库 dot import 干扰 GORM scope 评估（实际上 ignoreDirs 已含 `tests`，间接覆盖） |
| Go cross-module imports `resolvedPath=null` 影响 medium 边产出 | 🟡 WARNING（Codex Round-1 CRITICAL #1 + Round-2 A/G 收敛） | cross-module 统一落 Stage 4 low；precision/recall 用 label-only matching 评估不受 confidence 分布影响（指标合理）；不构造占位 target hack（避免悬空虚拟节点污染 graph 命名空间）；真实 Go module resolver 留给 follow-up Feature |
| Stage 2 误用 receiver var name 当 className | 🔴 CRITICAL（Codex Round-1 CRITICAL #2） | FR-2 表格行 #7/#8 修订：receiver method call 用 `member + qualifier=undefined` 让 resolver 用 callerContext；其它非 alias identifier receiver 标 free 兜底 |

---

## 工作量估计

- **mapper 实现 + 5+ 单测**：~1.5 天（已有 extractor 作蓝本，纯 TS 移植）
- **adapter 透传 + golden-master 校验**：~0.5 天
- **verify-feature-153.mjs**：~1 天（参考 verify-feature-151.mjs 改 Go 部分；不做占位注入，cross-module 接受 Stage 4 low）
- **GORM 端到端验证 + tune（如 recall 不达标）**：~1-2 天
- **Codex 阶段性对抗审查 + 修复（Codex Round-1 WARNING #11 修订）**：~1.5-2 天（spec/plan/tasks/implement/verify 5 phase；每 phase 含 review + 真实 bug 修复 + 重测，参考 Feature 151 历史成本）
- **总计**: **~5.5-7 天**（与用户给定 5-7 天估时基本一致；Codex 时间已上调到符合 Feature 151 先例）

---

## 与 Feature 151 / 152 / 154 的关系

| Feature | 状态 | 关系 |
|---------|------|------|
| 151（设计中标 150a） | ✅ 已 ship master `761488f` | 本 Feature 直接依赖（无修改） |
| 152（设计中标 150b ts-js） | 🟡 同期并行（worktree `claude/bold-satoshi-b38b6d`，目录 `152-ts-callsites-import-resolver`） | 无源码冲突（只动各自语言） |
| 154（设计中标 150d java） | 🟡 同期并行（如已启动） | 无源码冲突 |
| 155（Agent-Context MCP） | 🔵 后续 | 不依赖本 Feature 即可启动 |
| 156（incremental + sqlite） | 🔵 后续 | 不依赖本 Feature 即可启动 |

**rebase 顺序**: 152/153/154/... 各自完成验收后串行 rebase 到 master 并 ff-merge；先到先 push，后到的重新 rebase 最新 master 并重跑验收（按 [docs/shared/agent-branch-sync-policy.md](docs/shared/agent-branch-sync-policy.md) 约定）。
