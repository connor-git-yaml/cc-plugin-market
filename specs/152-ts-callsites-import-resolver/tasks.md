# 任务清单：Feature 152 — TypeScript callSites + 通用 Import Path 智能解析

**Feature Branch**: `152-ts-callsites-import-resolver`
**生成日期**: 2026-05-08
**关联文档**: [spec.md](./spec.md) | [plan.md](./plan.md)
**总任务数**: 36 个
**总预计耗时**: 约 48-60 小时
**Phase 数**: 7（P0-P6）

---

## Phase 摘要

| Phase | 内容 | 任务数 | 预计耗时 | 验证方式 |
|-------|------|--------|---------|---------|
| P0 | import-resolver 模块（纯函数，独立可验证） | T-001~T-006 | 8-10h | vitest import-resolver.test.ts |
| P1 | TypeScriptMapper.extractCallSites 实现 | T-007~T-012 | 10-12h | vitest typescript-mapper-callsite.test.ts |
| P2 | TsJsLanguageAdapter 双路径 merge | T-013~T-016 | 6-8h | vitest ts-js-adapter-callsite.test.ts |
| P3 | collectPythonCodeSkeletons 替换 basename map | T-017~T-019 | 4-6h | vitest 全量零回归 |
| P4 | collectTsJsCodeSkeletons 新增 | T-020~T-023 | 6-8h | vitest 集成测试 |
| P5 | verify-feature-152.mjs 验证脚本 | T-024~T-030 | 8-10h | 脚本 exit 0 + JSON 输出完整 |
| P6 | Baseline 跑分 + SC 全量评估 | T-031~T-036 | 6-8h | 8 项 SC 全部达标 |

---

## FR 覆盖映射表

| 功能需求 | 覆盖 Task |
|---------|---------|
| FR-1.1 TypeScriptMapper.extractCallSites 声明 | T-007 |
| FR-1.2 全部 6 种 calleeKind 覆盖（TS） | T-008, T-009, T-010, T-011 |
| FR-1.3 new Foo() → free | T-009, T-011 |
| FR-1.4 TsJsLanguageAdapter 透传 extractCallSites | T-013, T-014 |
| FR-1.5 callSites 字段条件必填 | T-008, T-011 |
| FR-2.1 resolvePythonImport 导出 | T-001, T-002 |
| FR-2.2 ResolveResult 类型定义 | T-001 |
| FR-2.3 Python 5 种解析场景 | T-002, T-005 |
| FR-2.4 解析失败返回 unresolved 不抛异常 | T-002, T-005 |
| FR-3.1 resolveTsJsImport 导出 | T-001, T-003 |
| FR-3.1.1 TsConfigResolutionContext 类型 | T-001 |
| FR-3.2 TS 4 种解析场景 | T-003, T-005 |
| FR-3.3 tsConfigContext=null fallback | T-003, T-005 |
| FR-3.4 import-resolver 纯函数，零新依赖 | T-001 |
| FR-3.5 findNearestTsConfig nearest-config | T-004, T-005 |
| FR-4.1 collectPythonCodeSkeletons 替换 basename map | T-017 |
| FR-4.2 dotted package 路径正确解析 | T-017, T-018 |
| FR-4.3 basename 冲突消除 | T-005, T-017 |
| FR-5.1 analyzeFile 透传 extractCallSites flag | T-013 |
| FR-5.2 extractCallSites=false 行为不变 | T-015 |
| FR-5.3 extractCallSites=true 双路径 merge | T-014, T-015 |
| FR-6.1 collectTsJsCodeSkeletons 新增 | T-020 |
| FR-6.2 resolveTsJsImport 写入 imports.resolvedPath | T-021, T-022 |
| FR-6.3 callSites 写入 CodeSkeleton | T-021, T-022 |
| FR-7.1 verify-feature-152.mjs 独立可运行 | T-024 |
| FR-7.2 复用 verify-feature-151.mjs 架构 | T-024, T-025 |
| FR-7.3 --target 参数支持 | T-024 |
| FR-8.1 复用 graph-accuracy.mjs --language ts | T-026 |
| FR-8.2 precision/recall N=3 中位数 | T-026 |
| FR-8.3 truth set kind 映射 | T-026 |
| FR-8.4 Python 路径回归保护 | T-034 |

---

## P0 — import-resolver（纯函数模块，无外部依赖）

**阶段目标**：新增 `src/knowledge-graph/import-resolver.ts`，实现 Python + TS import 路径解析，通过独立单测。该模块是 P3/P4 的前置依赖，与 P1 无依赖可并行推进。

**独立测试**：`npx vitest run tests/unit/knowledge-graph/import-resolver.test.ts` 全通；`npm run build` 零错误。

---

- [x] T-001 [P] 创建 import-resolver.ts 骨架：类型定义 + 函数签名

  **DoD**：文件 `src/knowledge-graph/import-resolver.ts` 存在，导出 `ResolveResult`、`TsConfigResolutionContext` 类型，以及 `resolvePythonImport`、`resolveTsJsImport`、`findNearestTsConfig` 三个函数签名（函数体抛 `Error('not implemented')`）；`npm run build` 零 TypeScript 错误。

  **关联 FR/EC/CL**：FR-2.1、FR-2.2、FR-3.1、FR-3.1.1、FR-3.4、CL-01、CL-02

  **依赖前置**：无

  **输入文件**：`src/knowledge-graph/call-resolver.ts`（参考现有模块结构），`src/models/call-site.ts`（参考 CallSite schema）

  **输出文件**：`src/knowledge-graph/import-resolver.ts`（新增）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. `cat src/knowledge-graph/import-resolver.ts` 确认三个函数均已导出，类型定义完整
  3. TypeScript 编译器无 `TS2305`（找不到导出）错误

---

- [x] T-002 [P] 实现 resolvePythonImport（Python 5 种解析场景）

  **DoD**：`resolvePythonImport` 完整实现，支持：(1) 绝对包路径 `pkg.engine → pkg/engine.py`；(2) `__init__.py` 兜底；(3) 相对 import `from . import nn`；(4) 祖先包 `from .. import X`；(5) Python stdlib 内置返回 `external`；(6) 越过 projectRoot 返回 `unresolved`；(7) 解析失败不抛异常。文件系统访问使用同步 `fs.existsSync`（Node.js 内置）。

  **关联 FR/EC/CL**：FR-2.3、FR-2.4、FR-4.2、FR-4.3、EC-3、EC-4（越界保护）、CL-01

  **依赖前置**：T-001（骨架文件存在）

  **输入文件**：`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/knowledge-graph/import-resolver.ts`（修改 resolvePythonImport 实现）

  **预计耗时**：2h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 手工构造 `resolvePythonImport('micrograd.engine', '/root/micrograd/nn.py', '/root')` 断言返回 `{ resolvedPath: 'micrograd/engine.py', kind: 'module' }`（需要对应文件存在于测试 fixture）
  3. 单测 T-005 中覆盖场景 #1-#6 均通过

---

- [x] T-003 [P] 实现 resolveTsJsImport（TS 4 种解析场景 + paths wildcard）

  **DoD**：`resolveTsJsImport` 完整实现，支持：(1) 相对路径按 `.ts → .tsx → .js → .jsx → /index.ts...` 顺序候补；(2) tsconfig paths 精确 key + wildcard 匹配，多 candidates 按数组顺序；(3) baseUrl 解析（baseUrl != null 时）；(4) 外部包返回 `external`；(5) 磁盘绝对路径；(6) tsConfigContext=null 时仅走相对路径，不崩溃。

  **关联 FR/EC/CL**：FR-3.2、FR-3.3、FR-3.4、EC-2、EC-12（baseUrl 纯绝对路径）、CL-01、CL-04

  **依赖前置**：T-001（骨架文件存在）

  **输入文件**：`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/knowledge-graph/import-resolver.ts`（修改 resolveTsJsImport 实现）

  **预计耗时**：2.5h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测 T-005 中覆盖场景 #7-#12 均通过
  3. 对 `express` 调用结果确认 `kind: 'external'`，不进入文件系统查找

---

- [x] T-004 [P] 实现 findNearestTsConfig 辅助函数

  **DoD**：`findNearestTsConfig` 从 `path.dirname(filePath)` 起逐级向上查找 `tsconfig.json`，上溯至 projectRoot 仍未命中返回 null；命中时返回 `{ configDir: string, rawConfig: Record<string, unknown> }`；rawConfig 通过 `JSON.parse` 解析（不额外处理 jsonc 注释）；上溯越过文件系统根时安全停止。

  **关联 FR/EC/CL**：FR-3.5、EC-2、CL-01

  **依赖前置**：T-001（骨架文件存在）

  **输入文件**：`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/knowledge-graph/import-resolver.ts`（修改 findNearestTsConfig 实现）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测 T-005 场景 #12 通过（monorepo nearest-config 选择）
  3. 传入一个无 tsconfig.json 的临时目录路径，确认返回 null 而非抛异常

---

- [x] T-005 [P] 写 tests/unit/knowledge-graph/import-resolver.test.ts（≥ 16 单测，W-4 + W-1 + W-5 + C-1 修复加测）

  **DoD**：测试文件覆盖以下场景，全部通过：

  | # | 场景 | 期望 |
  |---|------|------|
  | 1 | Python `from micrograd.engine import Value` | `kind: 'module'`, resolvedPath='micrograd/engine.py' |
  | 2 | Python `from . import nn`（相对 import，**C-1 修复**：调用形式为 `resolvePythonImport('.nn', ...)` 由 collect 层拆解） | `kind: 'relative-sibling'` |
  | 3 | Python `from .. import X`（祖先包） | `kind: 'relative-sibling'` |
  | 4 | Python 越过 projectRoot（`from .... import X`） | `kind: 'unresolved'`，resolvedPath=null |
  | 5 | Python `import os`（stdlib 内置） | `kind: 'external'`，resolvedPath=null |
  | 6 | Python 同名 basename 冲突（`a/utils.py` vs `b/utils.py`） | 各自正确定位，不混淆 |
  | 7 | TS `./engine` 相对路径 | `kind: 'relative'`，resolvedPath='src/engine.ts' |
  | 8 | TS tsconfig paths **exact key**（`react`: `["./src/types/react"]`） | `kind: 'paths-alias'`（**W-4 修复**：精确 key 单测） |
  | 9 | TS tsconfig paths wildcard `~/*` → `src/*` | `kind: 'paths-alias'` |
  | 10 | TS tsconfig paths **multi candidates**（`@/*: ["./src/*", "./libs/*"]`，第一个文件不存在第二个存在） | `kind: 'paths-alias'`，命中第二个 candidate（**W-4 修复**：顺序断言） |
  | 11 | TS baseUrl 纯绝对路径（`baseUrl: '.'`） | `kind: 'absolute'` |
  | 12 | TS `express` 外部包（bare npm 包） | `kind: 'external'`，resolvedPath=null |
  | 13 | TS `@org/lib` scoped 包 | `kind: 'external'` |
  | 14 | TS `~/utils` 但无 tsconfig（**C-2 修复**：alias-like fallback） | `kind: 'unresolved'` |
  | 15 | TS `./config.json` 相对 JSON 文件（**W-1 修复**：EC-6） | `kind: 'external'`，resolvedPath=null（不入 callSites graph） |
  | 16 | TS `./types.d.ts` 相对类型声明文件（**W-1 修复**） | `kind: 'external'`，resolvedPath=null |
  | 17 | tsconfig.json 不存在，处理别名路径 | `kind: 'unresolved'`，不崩溃 |
  | 18 | monorepo nearest-config 选择（两层 tsconfig） | 返回最近的 tsconfig 所在 configDir |
  | 19 | **W-5 修复**：Windows 路径形态测试（mock path.sep='\\'，断言 resolvedPath 中含 '/' 而非 '\\'） | resolvedPath 为 POSIX 风格 |
  | 20 | **C-5 修复**：projectRoot=`'/proj'` + candidate=`'/projection'`（字典序大于但不在 root 内）| `isInsideProjectRoot` 返回 false，避免逃逸 |

  使用 vitest 的 `tmp` 目录或 `vol`（memfs）构造 fixture 文件系统，不依赖真实磁盘状态。

  **W-7 修复：TDD red 阶段标注**：本 task（T-005）在依赖关系上排在 T-002/T-003/T-004 之后，但**实际执行顺序应为先写测试**（red 阶段）→ 再写实现（green 阶段）。tasks.md 的依赖标注是"测试需要 import-resolver 的 type signatures 才能通过 TS 编译"，T-001 骨架（含 type signatures + throw 'not implemented'）使 T-005 可在 T-002/3/4 实现完成前就开始撰写并 fail（red 阶段成立）。Implement Phase 实施时按 T-001 → T-005（写测试，fail）→ T-002/3/4（写实现，turn green）→ T-006（验证）顺序进行。

  **关联 FR/EC**：FR-2.3、FR-2.4、FR-3.2、FR-3.3、FR-3.5、FR-4.3、EC-3、EC-4、EC-12

  **依赖前置**：T-002、T-003、T-004

  **输入文件**：`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`tests/unit/knowledge-graph/import-resolver.test.ts`（新增）

  **预计耗时**：2h

  **验证步骤**：
  1. `npx vitest run tests/unit/knowledge-graph/import-resolver.test.ts` 全部通过
  2. `npx vitest run tests/unit/knowledge-graph/import-resolver.test.ts --reporter=verbose` 确认每条用例都有对应描述

---

- [x] T-006 P0 阶段验证：全量 build + 单测通过

  **DoD**：
  1. `npm run build` 零 TypeScript 错误
  2. `npx vitest run tests/unit/knowledge-graph/import-resolver.test.ts` 全通（≥ 12 条）
  3. `npm run lint` 零错误
  4. `git add -p` + 以独立 commit 交付 P0（含 import-resolver.ts + 单测文件），commit 前跑 Codex 对抗审查

  **关联 FR**：FR-2.1~FR-2.4、FR-3.1~FR-3.5

  **依赖前置**：T-001~T-005

  **输入文件**：`src/knowledge-graph/import-resolver.ts`，`tests/unit/knowledge-graph/import-resolver.test.ts`

  **输出文件**：git commit（P0 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0

---

## P1 — TypeScriptMapper.extractCallSites

**阶段目标**：在 `src/core/query-mappers/typescript-mapper.ts` 实现 `extractCallSites` 方法，覆盖全部 6 种 calleeKind（free / member / cross-module / super / decorator / unresolved），通过独立单测。与 P0 无依赖，可并行推进。

**独立测试**：`npx vitest run tests/unit/typescript-mapper-callsite.test.ts` 全通（≥ 14 条）；`npm run build` 零错误。

---

- [x] T-007 [P] 在 typescript-mapper.ts 新增 extractCallSites 方法骨架

  **DoD**：`TypeScriptMapper` 类尾部新增 `extractCallSites(tree: Parser.Tree, source: string): CallSite[]` 方法；方法内包含 size guard（source.length > 1_000_000 时返回空数组）；walker 框架（walk 函数）骨架已存在，但各 handler 均为空实现（return 不产出）；`npm run build` 零错误；不改动现有 `extractExports` / `extractImports` 方法。

  **关联 FR/EC/CL**：FR-1.1、FR-1.5、CL-02、CL-07

  **依赖前置**：无（可与 T-001 并行）

  **输入文件**：`src/core/query-mappers/typescript-mapper.ts`，`src/core/query-mappers/python-mapper.ts`（参考实现 L943-953），`src/models/call-site.ts`

  **输出文件**：`src/core/query-mappers/typescript-mapper.ts`（修改）

  **预计耗时**：1.5h

  **验证步骤**：
  1. `npm run build` 零错误
  2. `grep -n 'extractCallSites' src/core/query-mappers/typescript-mapper.ts` 确认方法签名存在
  3. 现有测试 `npx vitest run` 零回归

---

- [x] T-008 实现 _walkCallSites + handleCallExpression（7 种形态分流）

  **DoD**：实现以下调用形态处理：(1) 顶层 `foo()` → `free`；(2) `this.method()` → `member`（无 qualifier）；(3) `Class.method()`（大写首字母）→ `member` + qualifier；(4) `mod.fn()`（小写首字母）→ `cross-module` + qualifier（严格与 PythonMapper L943-953 对齐）；(5) optional chain `obj?.method()` → 按首字母大小写分流；(6) dynamic import `import('./x')` → `unresolved`（calleeName='import'）；(7) `eval()` / `Function()` → `unresolved`；**C-8 修复**：mkCallSite 不接受 dynamicReason 参数（CallSite schema 仅 6 字段：calleeName / calleeKind / line / column / callerContext / calleeQualifier）；callerContext 通过 SCOPE_DEFINING_TYPES 入栈/出栈机制在类方法场景下输出 `ClassName.methodName`，匿名 arrow/function 输出 `<arrow:line:col>` / `<fn:line:col>`（C-4 修复）。

  **关联 FR/EC/CL**：FR-1.2、FR-1.5、CL-08（不产出 dunder）

  **依赖前置**：T-007

  **输入文件**：`src/core/query-mappers/typescript-mapper.ts`，`src/core/query-mappers/python-mapper.ts`

  **输出文件**：`src/core/query-mappers/typescript-mapper.ts`（修改）

  **预计耗时**：3h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测 T-011 中场景 #1-#8 通过
  3. `npx vitest run tests/unit/typescript-mapper-callsite.test.ts` 已有用例不回归

---

- [x] T-009 实现 handleNewExpression（new Foo() → free + viaNew 标记）

  **DoD**：`new Foo()` 产出 `calleeKind: 'free'`，`calleeName` 取构造函数名（`Foo`）；**C-8 修复 V3**：mapper **不**通过 `callerContext` / `calleeQualifier` / 其他字段传递 viaNew 元数据，CallSite schema 仅 6 字段（calleeName / calleeKind / line / column / callerContext / calleeQualifier），**保持纯净**。SC-008 验证 new Foo() 与 class Foo 连通**完全通过 truth-set 对照**（`ts-call-extractor.mjs` 输出的 `kind="constructor"` 条目按 `(file, line)` 关联 graph，不依赖 mapper 元数据），实现细节见 T-029。`new Function('code')` → `unresolved`（W-2 修复，避免误判为本地构造）。

  **关联 FR/EC/CL**：FR-1.3、CL-02（schema 不改）、SC-008（new Foo() 与 class Foo graph 连通）

  **依赖前置**：T-007

  **输入文件**：`src/core/query-mappers/typescript-mapper.ts`

  **输出文件**：`src/core/query-mappers/typescript-mapper.ts`（修改）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测 T-011 场景 #12（`new Foo()` → `free`，calleeName="Foo"）通过
  3. `CallSite` 接口无新字段引入（git diff src/models 确认）

---

- [x] T-010 实现 handleDecorator + handleTaggedTemplate

  **DoD**：(1) 带参 decorator `@Foo()` 产出 `calleeKind: 'decorator'`；bare `@Foo`（无括号）不产出 callSite（与 Python CL-04 对齐）；(2) tagged template：tag 为 identifier → `free`，tag 为 member_expression → `member`（按首字母大小写）。

  **关联 FR/EC/CL**：FR-1.2（decorator / free / member）

  **依赖前置**：T-007, T-008

  **输入文件**：`src/core/query-mappers/typescript-mapper.ts`

  **输出文件**：`src/core/query-mappers/typescript-mapper.ts`（修改）

  **预计耗时**：1.5h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测 T-011 场景 #10（带参 decorator）、#11（bare decorator 不产出）、#13（tagged template）通过

---

- [x] T-011 写 tests/unit/typescript-mapper-callsite.test.ts（≥ 18 单测，C-3/C-4/W-2/W-3 修复加测）

  **DoD**：测试文件覆盖以下全部场景：

  | # | 场景 | 期望 calleeKind |
  |---|------|----------------|
  | 1 | `foo()` 顶层 identifier 调用 | `free` |
  | 2 | `this.method()` 类方法内 | `member`，无 qualifier |
  | 3 | `Class.method()`（大写首字母） | `member`，qualifier="Class" |
  | 4 | `mod.fn()`（小写首字母） | `cross-module`，qualifier="mod" |
  | 5 | `obj?.method()` optional chain（小写 obj） | `cross-module` |
  | 6 | `() => foo()` 箭头函数内调用 | `free`，callerContext=箭头函数名 |
  | 7 | `class Foo { bar() { baz() } }` 类方法内 | `free`，callerContext="Foo.bar" |
  | 8 | **C-4 修复**：`class Foo { bar() { arr.map((x) => x.baz()) } }` 嵌套 callback | `x.baz()` 的 callerContext = `<arrow:line:col>` 而非 `Foo.bar`（最近 scope 原则） |
  | 9 | `import('./engine')` 动态 import | `unresolved`，calleeName="import" |
  | 10 | **C-3 修复**：`import('./engine').then(cb)` 链式 dynamic import | callSites **只含 1 条** `import` callSite，`.then` 不产生第二条 callSite |
  | 11 | `super.method()` | `super` |
  | 12 | **W-2 修复**：`super(args)` 自调用（构造器内） | `super`，calleeName="super" |
  | 13 | `@Decorator()` 带参 decorator | `decorator` |
  | 14 | **W-3 修复**：`@Decorator(arg1, arg2)` 带参 decorator + 验证内层 call_expression 不重复产出 free/member callSite | callSites **仅含 1 条** decorator，子节点 `Decorator(arg1, arg2)` 不被外层 walker 再产出 free callSite |
  | 15 | bare `@Decorator`（不带括号） | 不产出 callSite（长度为 0） |
  | 16 | `new Foo()` 构造调用 | `free`，calleeName="Foo" |
  | 17 | **W-2 修复**：`new Function('code')` 动态构造 | `unresolved`，calleeName="Function"，**不**为 free（防止误判为本地构造） |
  | 18 | `` tag`template` `` tagged template（identifier tag） | `free` |
  | 19 | `eval('code')` 动态求值 | `unresolved`，calleeName="eval" |
  | 20 | `.tsx` 文件 JSX fixture `<Foo />` | callSites 中不含 Foo 的 callSite（EC-9） |

  测试通过 `TypeScriptMapper.extractCallSites(parseTree, sourceCode)` 直接调用，不经过 adapter 层。

  **关联 FR/EC**：FR-1.2、FR-1.3、FR-1.5、EC-1、EC-9

  **依赖前置**：T-008、T-009、T-010

  **输入文件**：`src/core/query-mappers/typescript-mapper.ts`，`src/core/tree-sitter-analyzer.ts`

  **输出文件**：`tests/unit/typescript-mapper-callsite.test.ts`（新增）

  **预计耗时**：2.5h

  **验证步骤**：
  1. `npx vitest run tests/unit/typescript-mapper-callsite.test.ts` 全通（≥ 14 条）
  2. `npx vitest run tests/unit/typescript-mapper-callsite.test.ts --reporter=verbose` 确认每条用例描述清晰

---

- [x] T-012 P1 阶段验证：全量 build + 单测通过

  **DoD**：
  1. `npm run build` 零 TypeScript 错误
  2. `npx vitest run tests/unit/typescript-mapper-callsite.test.ts` 全通（≥ 14 条）
  3. `npx vitest run` 全量零回归（现有 ≥ 3155 条均通过）
  4. `npm run lint` 零错误
  5. 以独立 commit 交付 P1，commit 前跑 Codex 对抗审查

  **依赖前置**：T-007~T-011

  **输出文件**：git commit（P1 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0

---

## P2 — TsJsLanguageAdapter 双路径 merge

**阶段目标**：在 `src/adapters/ts-js-adapter.ts` 补全 `analyzeFile` 实现，开启 `extractCallSites=true` 时触发双路径（ts-morph 主 + tree-sitter 补 callSites），merge 后输出，且 exports/imports 不受 tree-sitter 路径污染（EC-11）。

**独立测试**：`npx vitest run tests/unit/ts-js-adapter-callsite.test.ts` 全通（≥ 3 条）。

---

- [x] T-013 修改 ts-js-adapter.ts：analyzeFile 接受并透传 extractCallSites flag

  **DoD**：`TsJsLanguageAdapter.analyzeFile` 函数签名不变（`AnalyzeFileOptions` 接口已有 `extractCallSites?: boolean`）；内部实现检查 `options?.extractCallSites === true` 决定是否走额外 tree-sitter 路径；`extractCallSites=false`（默认）时代码路径与 master HEAD 完全一致（不修改现有 ts-morph 调用链），零性能影响。

  **关联 FR/EC/CL**：FR-1.4、FR-5.1、FR-5.2、CL-03、CL-05

  **依赖前置**：T-012（TypeScriptMapper.extractCallSites 已实现）

  **输入文件**：`src/adapters/ts-js-adapter.ts`，`src/core/tree-sitter-analyzer.ts`

  **输出文件**：`src/adapters/ts-js-adapter.ts`（修改）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 现有 adapter 调用不传 extractCallSites 时行为不变（现有单测零回归）
  3. `grep -n 'extractCallSites' src/adapters/ts-js-adapter.ts` 确认分支已加入

---

- [x] T-014 实现双路径合并逻辑（ts-morph 主 + tree-sitter callSites merge）

  **DoD**：当 `extractCallSites=true` 时：(1) 先完成现有 ts-morph 分析（`analyzeFileInternal`）得到完整 `CodeSkeleton`；(2) 额外调用 `TreeSitterAnalyzer.analyze(filePath, 'typescript', { extractCallSites: true })` 取 `callSites` 字段；(3) merge 结果：`{ ...tsMorphResult, callSites: tsCallSites }`；(4) tree-sitter 返回的 `exports` / `imports` 字段 MUST discard（EC-11 隔离）；(5) `.tsx` 文件的 tree-sitter 路径若 dialect 不可用，安全降级为空 `callSites: []`，不阻塞（EC-1）。

  **关联 FR/EC/CL**：FR-5.3、EC-1、EC-11、CL-03、CL-07

  **依赖前置**：T-013

  **输入文件**：`src/adapters/ts-js-adapter.ts`，`src/core/tree-sitter-analyzer.ts`

  **输出文件**：`src/adapters/ts-js-adapter.ts`（修改）

  **预计耗时**：2h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 集成测试 T-015 场景 "merge correctness" 通过（callSites 来自 tree-sitter，exports 来自 ts-morph）
  3. 对包含 `export function foo()` 的 fixture 文件，exports 数组仍包含 foo

---

- [x] T-015 写 tests/unit/ts-js-adapter-callsite.test.ts（≥ 3 单测）

  **DoD**：覆盖以下场景：
  1. `extractCallSites=false`（默认）：`CodeSkeleton.callSites` 为空数组或 undefined，行为与 master HEAD 一致
  2. `extractCallSites=true`：`CodeSkeleton.callSites` 非空，包含正确 CallSite
  3. merge correctness：`CodeSkeleton.exports` 来自 ts-morph（含 TypeScript 类型信息），`callSites` 来自 tree-sitter，两者不交叉污染（断言 exports 数组不为空且包含类型签名，callSites 数组不为空）

  **关联 FR/EC**：FR-5.1、FR-5.2、FR-5.3、EC-11

  **依赖前置**：T-014

  **输入文件**：`src/adapters/ts-js-adapter.ts`

  **输出文件**：`tests/unit/ts-js-adapter-callsite.test.ts`（新增）

  **预计耗时**：1.5h

  **验证步骤**：
  1. `npx vitest run tests/unit/ts-js-adapter-callsite.test.ts` 全通（≥ 3 条）

---

- [x] T-016 P2 阶段验证：全量 build + 单测通过

  **DoD**：
  1. `npm run build` 零 TypeScript 错误
  2. `npx vitest run tests/unit/ts-js-adapter-callsite.test.ts` 全通
  3. `npx vitest run` 全量零回归
  4. `npm run lint` 零错误
  5. 以独立 commit 交付 P2，commit 前跑 Codex 对抗审查

  **依赖前置**：T-013~T-015

  **输出文件**：git commit（P2 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0

---

## P3 — collectPythonCodeSkeletons 替换 basename map

**阶段目标**：将 `src/batch/batch-orchestrator.ts` 中 `collectPythonCodeSkeletons` 的 basename map 临时算法替换为调用 `resolvePythonImport`，消除 `from pkg.engine import Value` 等 dotted package 路径解析失败问题。

**独立测试**：`npx vitest run` 全量零回归（含 batch-orchestrator 相关测试）。

---

- [ ] T-017 修改 batch-orchestrator.ts collectPythonCodeSkeletons：替换 basename map → resolvePythonImport

  **DoD**：`collectPythonCodeSkeletons` 函数签名不变；内部实现将 L2005-2040 区段的 basename map 算法替换为：遍历每个 Python 文件的 `imports[]`，对每条 import 调用 `resolvePythonImport(moduleSpec, callerFile, projectRoot)` 取 `resolvedPath`；`resolvedPath` 写入 `ImportReference.resolvedPath`（格式与 codeSkeletons Map key 对齐，参照 EC-10 决议：若 Map key 为绝对路径则写入绝对路径，显式 path.join(projectRoot, result.resolvedPath) 转换）；`kind: 'external' | 'unresolved'` 时 `resolvedPath` 保留 null。

  **关联 FR/EC/CL**：FR-4.1、FR-4.2、FR-4.3、EC-10（路径形态对齐）、CL-06（不改其他 adapter）

  **依赖前置**：T-006（P0 完成，import-resolver 可用）

  **输入文件**：`src/batch/batch-orchestrator.ts`（L1995-2048 区段），`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/batch/batch-orchestrator.ts`（修改）

  **预计耗时**：2h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 集成测试 T-018 通过
  3. `git diff src/batch/batch-orchestrator.ts` 确认只改动 basename map 相关区段，不触及其他函数

---

- [ ] T-018 写集成测试：micrograd `from micrograd.engine import Value` 解析验证

  **DoD**：新增或扩展 batch-orchestrator 集成测试，验证：(1) 构造 micrograd-like fixture（`micrograd/engine.py` + `micrograd/nn.py` + `micrograd/nn.py` 中含 `from micrograd.engine import Value`），调用 `collectPythonCodeSkeletons(projectRoot)`，断言 `nn.py` skeleton 的 `imports[0].resolvedPath` 等于预期路径（绝对路径或相对 projectRoot，与 Map key 形态一致）；(2) 两个 `utils.py`（`a/utils.py` vs `b/utils.py`）在相对 import 场景下不混淆。

  **关联 FR/EC**：FR-4.2、FR-4.3、EC-10

  **依赖前置**：T-017

  **输入文件**：`src/batch/batch-orchestrator.ts`，`tests/unit/` 目录下已有 batch 测试（参考结构）

  **输出文件**：`tests/unit/batch-orchestrator-python-import.test.ts`（新增）或在已有文件中追加用例

  **预计耗时**：1.5h

  **验证步骤**：
  1. `npx vitest run tests/unit/batch-orchestrator-python-import.test.ts` 全通

---

- [ ] T-019 P3 阶段验证：全量 build + 零回归

  **DoD**：
  1. `npm run build` 零 TypeScript 错误
  2. `npx vitest run` 全量零回归（含 batch-orchestrator + python-mapper-callsite 测试）
  3. `npm run lint` 零错误
  4. 以独立 commit 交付 P3，commit 前跑 Codex 对抗审查

  **依赖前置**：T-017~T-018

  **输出文件**：git commit（P3 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0

---

## P4 — collectTsJsCodeSkeletons 新增

**阶段目标**：在 `src/batch/batch-orchestrator.ts` 新增 `collectTsJsCodeSkeletons` 函数，扫描 `.ts/.tsx/.js/.jsx` 文件，调用 `TsJsLanguageAdapter.analyzeFile` + `resolveTsJsImport`，生成完整 CodeSkeleton Map。

**独立测试**：集成测试验证 self-dogfood callSites 非空，imports.resolvedPath 非全 null。

---

- [ ] T-020 在 batch-orchestrator.ts 新增 collectTsJsCodeSkeletons 函数骨架

  **DoD**：函数签名 `async function collectTsJsCodeSkeletons(projectRoot: string, options?: { extractCallSites?: boolean }): Promise<Map<string, CodeSkeleton>>` 存在；内部返回空 Map（stub）；`npm run build` 零错误；函数结构与 `collectPythonCodeSkeletons` 对称（同文件、类似参数风格）。

  **关联 FR/CL**：FR-6.1、CL-06

  **依赖前置**：T-016（P2 完成，adapter 双路径已实现）、T-006（P0 完成，import-resolver 可用）

  **输入文件**：`src/batch/batch-orchestrator.ts`，`src/batch/batch-orchestrator.ts`（collectPythonCodeSkeletons 参考结构）

  **输出文件**：`src/batch/batch-orchestrator.ts`（修改）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. `grep -n 'collectTsJsCodeSkeletons' src/batch/batch-orchestrator.ts` 确认函数存在且已导出（或 package-private）

---

- [x] T-021a 实现 buildTsConfigContext：rawConfig → TsConfigResolutionContext 转换（**N-1 修复**）

  **DoD**：在 `src/knowledge-graph/import-resolver.ts` 中新增（或在 `findNearestTsConfig` 同模块）函数 `buildTsConfigContext(rawConfig: Record<string, unknown>, configDir: string): TsConfigResolutionContext`，逻辑：
  1. 读取 `rawConfig.compilerOptions.baseUrl`（字符串或 undefined）→ 写入 `context.baseUrl`（缺省时 `null`）
  2. 读取 `rawConfig.compilerOptions.paths`（对象，key→string[]）→ 转为 `Map<string, string[]>` 写入 `context.paths`（缺省时空 Map）
  3. 写入 `context.configDir = configDir`（绝对路径，由 findNearestTsConfig 提供）
  4. 容错处理：rawConfig 不含 compilerOptions 时返回 `{ configDir, baseUrl: null, paths: new Map() }`
  5. 不处理 tsconfig.json 的 `extends` 链（YAGNI，留作 follow-up；CL-04 monorepo 取舍已说明）

  **关联 FR**：FR-3.1.1, FR-3.5

  **依赖前置**：T-004（findNearestTsConfig 已实现）

  **输入文件**：`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/knowledge-graph/import-resolver.ts`（修改：新增 buildTsConfigContext + 其类型签名导出）

  **预计耗时**：1h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 单测：构造 fixture rawConfig `{ compilerOptions: { baseUrl: "src", paths: { "~/*": ["./libs/*"] } } }`，断言转换结果 `{ configDir, baseUrl: "src", paths: Map([["~/*", ["./libs/*"]]]) }`
  3. 单测：rawConfig 缺 compilerOptions → baseUrl=null + paths=空 Map

  **建议加入 T-005**：在 import-resolver.test.ts 加 1 条单测覆盖 buildTsConfigContext（+1 条共 ≥ 21 条）

---

- [ ] T-021 实现 collectTsJsCodeSkeletons：文件扫描 + tsconfig context + import resolver 调用

  **DoD**：实现以下逻辑：(1) glob 扫描 `projectRoot` 下所有 `.ts/.tsx/.js/.jsx` 文件（排除 `node_modules/`、`dist/`、`.git/`）；(2) **N-1 修复**：对每个文件调用 `findNearestTsConfig(filePath, projectRoot)` 取 `{ configDir, rawConfig }`，**然后**调用 `buildTsConfigContext(rawConfig, configDir)` 转换为 `TsConfigResolutionContext`（含 baseUrl + paths Map）；(3) 调用 `TsJsLanguageAdapter.analyzeFile(filePath, { extractCallSites: options.extractCallSites })` 取 CodeSkeleton；(4) 对每条 `imports[]` 调用 `resolveTsJsImport(moduleSpec, filePath, projectRoot, tsConfigContext)` 写入 `resolvedPath`（按 EC-10 绝对路径/相对路径对齐 Map key 形态）；(5) 写入 Map：`key = filePath`（绝对路径，与 Python 路径 key 形态对齐）。

  **关联 FR/EC/CL**：FR-6.1、FR-6.2、FR-6.3、EC-10（路径形态）、CL-06

  **依赖前置**：T-020、T-021a

  **输入文件**：`src/batch/batch-orchestrator.ts`，`src/adapters/ts-js-adapter.ts`，`src/knowledge-graph/import-resolver.ts`

  **输出文件**：`src/batch/batch-orchestrator.ts`（修改）

  **预计耗时**：2.5h

  **验证步骤**：
  1. `npm run build` 零错误
  2. 集成测试 T-022 场景 "self-dogfood" 通过
  3. 返回的 Map 的 key 格式为绝对路径（path.isAbsolute 断言）

---

- [ ] T-022 写集成测试：collectTsJsCodeSkeletons 端到端验证

  **DoD**：覆盖以下场景：
  1. 对项目内小型 TS fixture（2-3 个文件，含 cross-file import）调用 `collectTsJsCodeSkeletons`，验证：(a) 返回 Map 非空；(b) callSites 数组非空（extractCallSites=true 时）；(c) imports[].resolvedPath 非全 null；(d) Map key 为绝对路径
  2. `extractCallSites=false` 时 CodeSkeleton 无 callSites 字段（或为空）
  3. EC-11 验证：exports 来源为 ts-morph（含类型信息），不被 tree-sitter 路径污染

  **关联 FR/EC**：FR-6.1~FR-6.3、EC-10、EC-11

  **依赖前置**：T-021

  **输入文件**：`src/batch/batch-orchestrator.ts`

  **输出文件**：`tests/unit/batch-orchestrator-ts-callsites.test.ts`（新增）

  **预计耗时**：2h

  **验证步骤**：
  1. `npx vitest run tests/unit/batch-orchestrator-ts-callsites.test.ts` 全通

---

- [ ] T-023 P4 阶段验证：全量 build + 零回归

  **DoD**：
  1. `npm run build` 零 TypeScript 错误
  2. `npx vitest run` 全量零回归（新增测试 ≥ 3155+14+3+2=3174 条）
  3. `npm run lint` 零错误
  4. 以独立 commit 交付 P4，commit 前跑 Codex 对抗审查

  **依赖前置**：T-020~T-022

  **输出文件**：git commit（P4 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0

---

## P5 — verify-feature-152.mjs 验证脚本

**阶段目标**：新增 `scripts/verify-feature-152.mjs`，可独立运行，测量 SC-001 ~ SC-008 全部指标，输出结构化 JSON。

**独立测试**：`node scripts/verify-feature-152.mjs --help` exit 0；`node scripts/verify-feature-152.mjs --target ./src` 输出完整 JSON。

---

- [ ] T-024 创建 verify-feature-152.mjs 骨架（CLI 接口 + 帮助输出）

  **DoD**：文件存在；支持 `--target <path>`（可多次）、`--repeats <n>`（默认 3）、`--metric <name>`（fill-rate | ts-precision-recall | python-resolution | perf | all）、`--out <path>`、`--help` 参数；`--help` 输出参数说明后 exit 0；参考 `scripts/verify-feature-151.mjs` 的整体架构（target → analyze → buildUnifiedGraph → graph-accuracy.mjs）。

  **关联 FR**：FR-7.1、FR-7.2、FR-7.3

  **依赖前置**：T-023（P4 完成，collectTsJsCodeSkeletons 可用）

  **输入文件**：`scripts/verify-feature-151.mjs`（参考架构）

  **输出文件**：`scripts/verify-feature-152.mjs`（新增）

  **预计耗时**：1.5h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --help` exit 0
  2. 输出帮助文本包含 `--target`、`--repeats`、`--metric` 说明

---

- [ ] T-025 实现 SC-001 fillRate 测量（C-6 修复 — 分母用 truth set，不用总文件数）

  **DoD**：SC-001 逻辑（**C-6 修复**：与 spec §10 SC-001 对齐，与 SC-002 共用同一 truth set 口径）：
  1. 对 target 调用 `collectTsJsCodeSkeletons(target, { extractCallSites: true })`，得到 codeSkeletons Map
  2. 统计 `callSites.length > 0` 的文件数 = `fillRateFilesWithCallSites`
  3. **运行 ts-call-extractor.mjs 生成 truth set**：`node scripts/graph-accuracy.mjs --language ts --source <target>`（不传 graph.json，仅取 truth set），按 `truthCalls[].file` 去重得到"含调用的文件数" = `fillRateTruthFiles`
  4. `fillRate = fillRateFilesWithCallSites / fillRateTruthFiles`
  5. 输出三字段；验收阈值：`fillRate ≥ 0.95`（95%）

  **关联 FR/SC**：FR-7.1、SC-001

  **依赖前置**：T-024

  **输入文件**：`scripts/verify-feature-152.mjs`

  **输出文件**：`scripts/verify-feature-152.mjs`（修改）

  **预计耗时**：1h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --target ./src --metric fill-rate` 输出包含 `fillRate` 字段且值为 0-1 之间的数值

---

- [ ] T-026 实现 SC-002 precision/recall N=3 中位数测量（TS call graph-accuracy）

  **DoD**：SC-002 逻辑：(1) 对 target 构建 graph.json；(2) 循环 repeats 次调用 `node scripts/graph-accuracy.mjs --language ts --source <target> --graph <graph.json>`；(3) 解析每次输出的 precision/recall；(4) 取中位数写入 `precisionMedian`、`recallMedian`；(5) 验收阈值：`precisionMedian ≥ 0.70`，`recallMedian ≥ 0.30`；Python 回归保护：同时运行 `node scripts/graph-accuracy.mjs --language python --source <target>` smoke test（FR-8.4）。

  **关联 FR/SC**：FR-7.2、FR-8.1、FR-8.2、FR-8.3、FR-8.4、SC-002

  **依赖前置**：T-025

  **输入文件**：`scripts/verify-feature-152.mjs`，`scripts/graph-accuracy.mjs`（复用，不改）

  **输出文件**：`scripts/verify-feature-152.mjs`（修改）

  **预计耗时**：1.5h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/micrograd --metric ts-precision-recall` 输出包含 `precisionMedian` 和 `recallMedian`
  2. Python smoke test 不报错

---

- [ ] T-027 实现 SC-003 Python import 解析正确率测量（C-7 修复 — 验证目标命中正确性）

  **DoD**：SC-003 逻辑（**C-7 修复**：spec §10 SC-003 要求"`from pkg.module import X` 形态正确命中目标文件比例"，不是仅 `resolvedPath !== null`）：
  1. 对 target 调用 `collectPythonCodeSkeletons(target)`，得到 codeSkeletons Map
  2. **筛选符合条件的 imports**：`isRelative === false` 且 `moduleSpecifier.includes('.')`（即 `from pkg.module import X` 形态，排除 `import os` / 相对 import）= `eligibleImports`
  3. **验证命中正确性（C-7 修复 V3：完整路径比对，不是末段比对）**：对每个 eligibleImport，断言其 `resolvedPath` 满足以下任一条件之一：
     - **完整 dotted path 比对**：`moduleSpecifier="pkg.engine"` 转换为 `expected="pkg/engine.py"`；`resolvedPath === expected`（命中 .py 文件）
     - **__init__.py 兜底**：`moduleSpecifier="pkg.engine"` → `expected="pkg/engine/__init__.py"`；`resolvedPath === expected`
     - 注意：拒绝用 `path.parse(resolvedPath).name` 末段比对（会把 `pkg/engine.py` 与 `other_pkg/engine.py` 混判为正确，C-7 修复 V2 仍有此漏洞）
     - 实现：`expectedPaths = [moduleSpecifier.split('.').join('/') + '.py', moduleSpecifier.split('.').join('/') + '/__init__.py']`；命中条件：`expectedPaths.includes(resolvedPath)`（POSIX 路径，与 W-5 修复 toPosix 输出一致）
  4. `pythonResolutionRate = correctHits / eligibleImports.length`
  5. 输出字段：`pythonResolutionRate`、`pythonResolutionEligible`、`pythonResolutionHits`
  6. 验收阈值：`pythonResolutionRate ≥ 0.80`（80%，micrograd + nanoGPT 均值）

  **关联 FR/SC**：FR-7.1、SC-003

  **依赖前置**：T-025

  **输入文件**：`scripts/verify-feature-152.mjs`

  **输出文件**：`scripts/verify-feature-152.mjs`（修改）

  **预计耗时**：0.5h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/micrograd --metric python-resolution` 输出 `pythonResolutionRate`

---

- [ ] T-028 实现 SC-006 性能 baseline / enable / delta 测量

  **DoD**：SC-006 逻辑：(1) 计时 `collectTsJsCodeSkeletons(target, { extractCallSites: false })` → `baselineMs`；(2) 计时 `collectTsJsCodeSkeletons(target, { extractCallSites: true })` → `enableMs`；(3) `deltaMs = enableMs - baselineMs`；(4) 输出平台信息（nodeVersion / platform / cpuCount）；验收阈值：`deltaMs ≤ 5000`（5s，hono 295 文件，标准笔记本硬件）。

  **关联 FR/SC**：SC-006

  **依赖前置**：T-025

  **输入文件**：`scripts/verify-feature-152.mjs`

  **输出文件**：`scripts/verify-feature-152.mjs`（修改）

  **预计耗时**：0.5h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --target ./src --metric perf` 输出 `baselineMs`、`enableMs`、`deltaMs`

---

- [ ] T-029 实现 SC-008 new Foo() → class Foo graph 连通率测量（C-8 修复 — truth-set 对照）

  **DoD**：SC-008 逻辑（**C-8 修复**：不向 CallSite schema 加 viaNew 元数据；改用 truth-set 输出的 `kind="constructor"` 条目对照）：
  1. 调用 `node scripts/graph-accuracy.mjs --language ts --source <target>` 生成 truth set，从中筛选 `kind === 'constructor'` 的 truth call → `truthConstructors[]`
  2. 收集 self-dogfood `codeSkeletons` 中所有 `kind === 'class'` 的 export name → `localClassNames` Set
  3. 过滤 truthConstructors 仅保留 `callee ∈ localClassNames` 的条目 → `eligibleConstructors[]`（"本仓库 class 的 new 调用"，N-2 修复）
  4. 对每个 eligibleConstructor，按 `(file, line)` 在 graph.json 的 `edges[type='calls']` 中查找匹配（mapper 输出的 callSite 在 graph 层会被转为 calls 边，source 节点 line 字段对齐）
  5. 检查匹配 edge 的 `target` 是否为 `class <calleeName>` 的 component 节点（通过 `localClassNames` 反查）
  6. `sc008Rate = hits / eligibleConstructors.length`
  7. 输出字段：`sc008Rate`、`sc008Hits`、`sc008Total`
  8. 验收阈值：`sc008Rate ≥ 0.80`（80%，N-2 修复后分母仅含本仓库 export class 的 new 调用）

  **关联 FR/SC**：FR-1.3、SC-008

  **依赖前置**：T-025

  **输入文件**：`scripts/verify-feature-152.mjs`

  **输出文件**：`scripts/verify-feature-152.mjs`（修改）

  **预计耗时**：1h

  **验证步骤**：
  1. `node scripts/verify-feature-152.mjs --target ./src --metric all` 输出包含 `sc008Rate`

---

- [ ] T-030 P5 阶段验证：verify 脚本完整运行

  **DoD**：
  1. `node scripts/verify-feature-152.mjs --help` exit 0
  2. `node scripts/verify-feature-152.mjs --target ./src` 输出完整 VerifyResult JSON（包含 fillRate / precisionMedian / recallMedian / pythonResolutionRate / perf / sc008Rate 全部字段）
  3. `npm run build` 零错误（脚本为 .mjs，build 不涵盖，但 TypeScript 依赖的 dist/ 必须已构建）
  4. 以独立 commit 交付 P5，commit 前跑 Codex 对抗审查

  **依赖前置**：T-024~T-029

  **输出文件**：git commit（P5 阶段）

  **预计耗时**：0.5h

  **验证步骤**：命令返回码均为 0，JSON 输出可用 `jq` 解析

---

## P6 — Baseline 跑分 + SC 全量评估

**阶段目标**：在 4 个 target（self-dogfood / hono / micrograd / nanoGPT）上运行 verify 脚本，汇总 SC-001 ~ SC-008 全部数值，写入 verification-report.md。任何 SC 未达阈值则触发对应 Phase 修订。

**独立测试**：8 项 SC 全部达标，verification-report.md 完整存在。

---

- [ ] T-031 跑 self-dogfood 评估

  **DoD**：执行 `node scripts/verify-feature-152.mjs --target ./src --repeats 3`，记录输出 JSON；确认：(1) SC-001 fillRate ≥ 0.95；(2) SC-008 sc008Rate ≥ 0.80；(3) SC-006 deltaMs ≤ 5000（self-dogfood ~250 文件）。

  **依赖前置**：T-030（P5 完成）

  **输入文件**：`scripts/verify-feature-152.mjs`，`./src/`

  **输出文件**：`/tmp/verify-152-self-dogfood.json`（中间产物，不入库）

  **预计耗时**：1h（含多次重跑时间）

  **验证步骤**：
  1. 命令 exit 0
  2. `jq '.fillRate' /tmp/verify-152-self-dogfood.json` ≥ 0.95
  3. 若未达阈值，定位失败根因后触发对应 Phase（P1/P4）修订

---

- [ ] T-032 跑 hono 评估（SC-002 precision/recall 主力 target）

  **DoD**：执行 `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src --repeats 3`，记录输出 JSON；确认：(1) SC-002 precisionMedian ≥ 0.70；(2) recallMedian ≥ 0.30；(3) SC-006 deltaMs ≤ 5000（hono 295 .ts 文件）。

  **依赖前置**：T-031

  **输入文件**：`scripts/verify-feature-152.mjs`，`~/.spectra-baselines/hono/src/`

  **输出文件**：`/tmp/verify-152-hono.json`（中间产物，不入库）

  **预计耗时**：1.5h（含 N=3 重复）

  **验证步骤**：
  1. 命令 exit 0
  2. `jq '.precisionMedian, .recallMedian' /tmp/verify-152-hono.json` 达阈值

---

- [ ] T-033 跑 micrograd 评估（SC-003 Python 解析率）

  **DoD**：执行 `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/micrograd`，记录输出 JSON；确认：(1) SC-003 pythonResolutionRate ≥ 0.80；(2) `from micrograd.engine import Value` 的 resolvedPath 非 null。

  **依赖前置**：T-031

  **输入文件**：`scripts/verify-feature-152.mjs`，`~/.spectra-baselines/micrograd/`

  **输出文件**：`/tmp/verify-152-micrograd.json`（中间产物，不入库）

  **预计耗时**：0.5h

  **验证步骤**：
  1. 命令 exit 0
  2. `jq '.pythonResolutionRate' /tmp/verify-152-micrograd.json` ≥ 0.80

---

- [ ] T-034 跑 nanoGPT 评估（Python 解析率 + FR-8.4 Python 路径回归保护，**W-6 修复 — byte-level 比对**）

  **DoD**：执行 `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/nanoGPT`，记录输出 JSON；确认 SC-003 pythonResolutionRate ≥ 0.80；**FR-8.4 严格 byte-level 回归保护（W-6 修复）**：
  1. 在 master HEAD 切出工作树（git worktree）：`git worktree add /tmp/master-baseline master`
  2. 在 master HEAD 工作树跑：`(cd /tmp/master-baseline && npm install && npm run build && node scripts/graph-accuracy.mjs --language python --source ~/.spectra-baselines/micrograd > /tmp/python-master.json)`
  3. 在本 Feature 工作树跑：`node scripts/graph-accuracy.mjs --language python --source ~/.spectra-baselines/micrograd > /tmp/python-feature152.json`
  4. **byte-level 比对**：`diff /tmp/python-master.json /tmp/python-feature152.json` 必须返回 0（完全一致）
  5. 若 diff 非 0：必须分析差异是否由本 Feature 改动引入，必要时回滚或修订
  6. 完成后：`git worktree remove /tmp/master-baseline`

  **关联 FR**：FR-8.4

  **依赖前置**：T-031

  **输入文件**：`scripts/verify-feature-152.mjs`，`scripts/graph-accuracy.mjs`，`~/.spectra-baselines/nanoGPT/`

  **输出文件**：`/tmp/verify-152-nanoGPT.json`（中间产物，不入库）

  **预计耗时**：0.5h

  **验证步骤**：
  1. 两条命令均 exit 0
  2. Python 路径输出 schema 与预期无 breaking change

---

- [ ] T-035 写 specs/152-ts-callsites-import-resolver/verification-report.md

  **DoD**：汇总 T-031~T-034 的输出数据，报告包含以下字段：
  - SC-001 fillRate（self-dogfood）
  - SC-002 precisionMedian / recallMedian（hono N=3）
  - SC-003 pythonResolutionRate（micrograd + nanoGPT 均值）
  - SC-004 单测总数（`npx vitest run` 统计）
  - SC-006 deltaMs（self-dogfood + hono）
  - SC-008 sc008Rate（self-dogfood）
  - FR-8.4 Python 路径回归保护：PASS / FAIL
  - 结论：所有 SC 达阈值 / 部分未达阈值（列出未达项及修订建议）
  - `npm run build` + `npx vitest run` + `npm run lint` + `npm run repo:check` 结果

  **依赖前置**：T-031~T-034

  **输入文件**：4 个 JSON 产物（中间数据）

  **输出文件**：`specs/152-ts-callsites-import-resolver/verification-report.md`（新增，入库）

  **预计耗时**：1h

  **验证步骤**：
  1. 文件存在且包含全部 8 项 SC 数据
  2. 结论段明确标注每项 SC 达标 / 未达标

---

- [ ] T-036 P6 阶段验证 + 最终交付

  **DoD**：
  1. 所有 SC 均达标（verification-report.md 结论为 PASS）
  2. `npm run build` 零 TypeScript 错误
  3. `npx vitest run` 全量 ≥ 3169 条（3155 + 新增 ≥ 14）零失败
  4. `npm run lint` 零错误
  5. `npm run repo:check` 零错误
  6. 以独立 commit 交付 P6（含 verification-report.md）
  7. 按 CLAUDE.local.md 约定：push 前列出 deliverable report，等待用户确认后再 push 到 master

  **依赖前置**：T-031~T-035

  **输出文件**：git commit（P6 阶段 + verification-report.md）

  **预计耗时**：1h

  **验证步骤**：命令返回码均为 0；verification-report.md 中全部 SC 标注为 PASS

---

## 依赖与并行说明

### Phase 间依赖

```
P0 (import-resolver) ──────────────────────────────────┐
                                                        ↓
P1 (TypeScriptMapper) ──────────────────────────────┐  P3 (collectPython)
                                                    ↓
                        P2 (TsJsAdapter) ─────────────── P4 (collectTs) ───── P5 (verify) ─── P6 (baseline)
```

- **P0 与 P1 完全并行**：两者无共同依赖，实现工程师可同时推进
- **P3 仅依赖 P0**：与 P1/P2 无关，P0 完成即可启动
- **P4 依赖 P0 + P2**：需要 import-resolver（P0）和 adapter 双路径（P2）均就绪
- **P5 依赖 P3 + P4**：需要两路收集函数均可用
- **P6 依赖 P5**：线性执行

### User Story 间依赖

- US-001（TS callSites）← P1 + P2 + P4
- US-002（Python 解析）← P0 + P3
- US-003（TS import resolver）← P0 + P4

US-001 和 US-002 可独立验证，US-003 建立在 US-001 基础之上（collectTsJsCodeSkeletons 同时依赖 adapter 和 import-resolver）。

### Story 内部可并行任务

标注 `[P]` 的任务可在同阶段并行（操作不同文件，无内部依赖）：
- T-001, T-007 可同时启动（各自新建/修改不同文件）
- T-002, T-003, T-004 可在 T-001 骨架建立后并行实现

### 推荐实现策略

**两人并行**：
- 工程师 A：P0（T-001~T-006）→ P3（T-017~T-019）→ 协助 P4 后半
- 工程师 B：P1（T-007~T-012）→ P2（T-013~T-016）→ P4 前半

**单人顺序**：P0 → P1 → P2 → P3 → P4 → P5 → P6（约 48-60h）

### SC 验收阈值汇总

| SC | 指标 | 阈值 |
|----|------|------|
| SC-001 | fillRate | ≥ 95% |
| SC-002 | precisionMedian（hono N=3） | ≥ 70% |
| SC-002 | recallMedian（hono N=3） | ≥ 30% |
| SC-003 | pythonResolutionRate（micrograd+nanoGPT 均值） | ≥ 80% |
| SC-006 | deltaMs（hono 295 文件） | ≤ 5000ms |
| SC-008 | new Foo() → class Foo 连通率 | ≥ 80% |
