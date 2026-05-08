---
feature: "Feature 154 — 给 Java LanguageAdapter 添加 callSites 字段"
branch: "154-java-callsites"
created: "2026-05-08"
status: Draft
phase: tasks
revision: v0.2  # Codex P1 review 8 critical + 8 warning 全量修订
---

# 任务分解：Java callSites 抽取

## 概览

本文档将 plan.md 中定义的 5 个顺序增量验收 task 拆解为 21 个原子子任务（Codex
WARNING W-7 修订：T-3.2 拆 3 项后总数 19 → 21）。任务严格顺序依赖
（T-1 → T-2 → T-3 → T-4 → T-5），前序 task 未通过时不启动后续。

| 主任务 | 子任务数 | 关键产出 | 预估工时 |
|--------|---------|---------|---------|
| T-1 基础骨架 | 5 | extractor export + mapper 骨架 + adapter 透传 + 测试框架 | 4.0h |
| T-2 kind 映射核心 | 5 | 辅助函数 + 3 个 classify 方法 + 测试骨架 + 单测补全 | 6.0h |
| T-3 walk + callerContext | 5 | DFS walker + callerContext + phantom + mkCallSite + 接通链路 | 8.0h |
| T-4 verify 脚本 | 4 | 纯函数 + 主流程 + 纯函数单测 + 回归确认 | 4.0h |
| T-5 HikariCP E2E | 3 | baseline 验收 + 达标修复 + report | 6.0h（含修复预算）|

**总计估算工时**：28h，约合 4 个工作日（spec 用户预估 6-8 天 = 48-64h，本估算偏乐
观；T-3 + T-5 合计 14h 仍是最大不确定项，若 HikariCP recall 调优需多轮迭代，工时
可能上浮 30-50%）。

**关键依赖路径**：T-1.1 → T-1.2 → T-1.3 → T-2.0 → T-2.1 → T-2.2/2.3 →
T-3.1（含 stub）→ T-3.2/3.3/3.4 → T-3.5 → T-4.1 → T-4.3 → T-5.1 → T-5.3

---

## 路径与测试约定（Codex P1 CRITICAL C-1 修订）

仓库 `vitest.config.ts` 的 `projects` 数组仅 include 以下路径：
- `tests/unit/**/*.test.ts`
- `tests/adapters/**/*.test.ts`
- `tests/integration/**/*.test.ts`
- 等（详见 vitest.config.ts）

**任何放在 `src/core/query-mappers/__tests__/` 或 `scripts/__tests__/` 下的测试
文件都不会被 `npx vitest run` 收集**。本 Feature 所有新增测试统一落到：

| 测试文件 | 路径 |
|---------|------|
| JavaMapper callSites 主测试 | `tests/unit/java-mapper-callsite.test.ts` |
| verify-feature-154 纯函数测试 | `tests/unit/verify-feature-154.test.ts` |

## Commit Boundary（Codex P1 WARNING W-8 修订）

- **每个 T-x 主任务 = 1 个 commit**（共 5 个 commit），子任务**不**单独 commit
- 每个 T-x 内部子任务全部完成 + 汇总验收通过后，**先跑 Codex 阶段性 review**
  → 处理 review 反馈 → 再 commit
- commit message 格式：`feat(154): Phase 3 T-x — <一句话总结>`，正文列子任务
  完成情况 + Codex review 处置结论

---

## T-1：基础骨架 + 常量声明 + extractor export

**目标**：搭建所有后续任务依赖的脚手架，确保测试基础设施就绪、常量同源校验在 CI
中自动覆盖。

### T-1.1 — 导出 extractor 常量

**依赖**：无
**修改文件**：`scripts/lib/java-call-extractor.mjs`
**接口/契约要点**：
- 在 `REFLECTION_METHOD_NAMES` / `JAVA_ACRONYM_TYPE_NAMES` /
  `JAVA_PACKAGE_ROOT_NAMES` 三个 `const` 前加 `export` 关键字
- 不修改集合内容、不改函数签名、不改文件其他逻辑

**验收命令**：
```bash
node -e "import('./scripts/lib/java-call-extractor.mjs').then(m => { \
  console.log({ \
    refl: m.REFLECTION_METHOD_NAMES?.size, \
    acro: m.JAVA_ACRONYM_TYPE_NAMES?.size, \
    pkg:  m.JAVA_PACKAGE_ROOT_NAMES?.size \
  }); \
})"
```
期望输出：`{ refl: 12, acro: 10, pkg: 9 }`

**预估工时**：0.25h

---

### T-1.2 — mapper 模块顶层常量声明（**导出**）

**依赖**：T-1.1
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**：
- 在 `JavaMapper` class 定义之前添加 **export** 常量（Codex CRITICAL C-2 修订：
  必须 export，否则 T-1.4 测试无法 import）：
  ```ts
  export const CALLSITES_MAX_FILE_BYTES = 1_048_576;
  export const JAVA_REFLECTION_METHOD_NAMES: ReadonlySet<string> = new Set([
    'forName', 'invoke', 'newInstance',
    'getDeclaredMethod', 'getMethod',
    'getDeclaredField', 'getField',
    'getConstructor', 'getDeclaredConstructor',
    'getConstructors', 'getDeclaredConstructors',
    'newProxyInstance',
  ]);
  export const JAVA_ACRONYM_TYPE_NAMES: ReadonlySet<string> = new Set([
    'URL', 'URI', 'UUID', 'XML', 'JSON', 'CSV',
    'API', 'JDBC', 'JNDI', 'AWS', 'TCP', 'UDP', 'SQL', 'JPA', 'IO',
  ]);
  export const JAVA_PACKAGE_ROOT_NAMES: ReadonlySet<string> = new Set([
    'java', 'javax', 'jakarta',
    'com', 'org', 'net',
    'io', 'edu', 'gov', 'mil',
  ]);
  ```
- 集合内容**逐字符**与 `java-call-extractor.mjs` 同名集合一致（T-1.4 自动校验）

**验收命令**：`npm run build`（类型检查零错误）
**预估工时**：0.5h

---

### T-1.3 — `extractCallSites` 入口骨架 + adapter 透传

**依赖**：T-1.2
**修改文件**：
- `src/core/query-mappers/java-mapper.ts`（新增方法）
- `src/adapters/java-adapter.ts`（修改 1 行 + 注释）

**接口/契约要点**：
- `extractCallSites(tree: Parser.Tree, source: string): CallSite[]` 骨架：
  - **大文件兜底**（Codex WARNING W-1 修订）：使用字节数而非字符数
    ```ts
    if (Buffer.byteLength(source, 'utf8') > CALLSITES_MAX_FILE_BYTES) return [];
    ```
  - try-catch 兜底：异常时返回 `[]` + warn 日志
  - 调用 `_walkCallSites(tree.rootNode, out)` —— walker 在 T-3 实现，本步骤
    先放 `private _walkCallSites = (_root: Parser.SyntaxNode, _out: CallSite[]) => {/* T-3 */}`
- 内部辅助类型声明（`ClassifyResult` / `PhantomKind`）在此步完成
- `java-adapter.ts` analyzer.analyze 调用增加 `extractCallSites: options?.extractCallSites`
  + 注释 `// Feature 154 — 透传 extractCallSites flag（与 python-adapter.ts 对齐）`

**验收命令**：`npm run build`
**预估工时**：0.75h

---

### T-1.4 — 新建测试文件 + 常量同源 describe 块

**依赖**：T-1.1、T-1.2（必须 export 后才能 import）
**新增文件**：`tests/unit/java-mapper-callsite.test.ts`（路径修订：CRITICAL C-1）
**接口/契约要点**：
- 文件顶部 import：
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    JAVA_REFLECTION_METHOD_NAMES,
    JAVA_ACRONYM_TYPE_NAMES,
    JAVA_PACKAGE_ROOT_NAMES,
  } from '../../src/core/query-mappers/java-mapper.js';
  // @ts-expect-error — extractor 是 .mjs，TS 类型解析按 JS 处理
  import * as extractor from '../../scripts/lib/java-call-extractor.mjs';
  ```
- `describe('常量同源 — mapper TS vs extractor mjs')`：
  ```ts
  expect(new Set([...JAVA_REFLECTION_METHOD_NAMES])).toEqual(
    new Set([...extractor.REFLECTION_METHOD_NAMES]));
  expect(new Set([...JAVA_ACRONYM_TYPE_NAMES])).toEqual(
    new Set([...extractor.JAVA_ACRONYM_TYPE_NAMES]));
  expect(new Set([...JAVA_PACKAGE_ROOT_NAMES])).toEqual(
    new Set([...extractor.JAVA_PACKAGE_ROOT_NAMES]));
  ```

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts`
**预估工时**：0.75h

---

### T-1.5 — adapter 透传单测（通过 JavaLanguageAdapter.analyzeFile）

**依赖**：T-1.3、T-1.4
**修改文件**：`tests/unit/java-mapper-callsite.test.ts`
**接口/契约要点**（Codex CRITICAL C-3 修订：**必须**经 adapter 而非直接调 mapper）：
- 创建临时 `.java` 文件 fixture（`fs.mkdtempSync` + 写入最小 Java 片段）
- 用 `new JavaLanguageAdapter().analyzeFile(file, { extractCallSites: true })` 调用
- 断言：
  - `extractCallSites: true` → `result.callSites` 是 array（骨架阶段为 `[]`，
    T-3 后才会非空）
  - **默认未传 flag** → `result.callSites === undefined`（验证默认 false 行为）
- 测试结构 example：
  ```ts
  describe('JavaLanguageAdapter — extractCallSites 透传', () => {
    it('extractCallSites=true 时返回 callSites 数组', async () => {
      const file = writeFixture('class A { void m() { foo(); } }');
      const sk = await new JavaLanguageAdapter().analyzeFile(file, { extractCallSites: true });
      expect(Array.isArray(sk.callSites)).toBe(true);
    });
    it('默认未传 flag 时 callSites 为 undefined', async () => {
      const file = writeFixture('class A { void m() {} }');
      const sk = await new JavaLanguageAdapter().analyzeFile(file);
      expect(sk.callSites).toBeUndefined();
    });
  });
  ```

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts && npm run build`
**预估工时**：1.0h

---

### T-1 汇总验收

```bash
npx vitest run            # 全集零失败（Codex C-1 修订：路径已对齐 vitest projects）
npm run build             # 类型检查零错误
```

期望：
- (a) vitest 全集零失败
- (b) build 类型检查零错误
- (c) 常量同源 3 个断言通过
- (d) adapter 透传 2 个断言通过（true → array，默认 → undefined）

### T-1 Codex 阶段性 review 时机

T-1 全部子任务完成、汇总验收通过后、commit 前，启动 `codex:codex-rescue` 对抗审查：
- extractor export 是否引入副作用（`import * as` 时是否有意外 side effect）
- mapper 常量集合 3 个是否与 extractor **逐字节**一致（特别 acronym 大小写）
- adapter 透传是否破坏 `TreeSitterAnalyzer` 既有行为（`includePrivate` 等其它字段不丢）
- T-1.5 fixture 临时文件是否正确清理（避免污染 tmp 目录）

---

## T-2：kind 映射核心

**目标**：实现所有分类辅助函数和三个 classify 方法 + 测试骨架，使 kind 映射逻辑
完整可测，但**不接通 walker**（T-3 实现）。

### T-2.0 — 测试骨架（13 case + .skip 标记）

**依赖**：T-1
**修改文件**：`tests/unit/java-mapper-callsite.test.ts`
**接口/契约要点**（Codex CRITICAL C-4 修订：先建测试骨架避免验收依赖倒置）：
- 在测试文件中先创建 13 个 `it.skip` test case 占位（场景 1-8 + MUST 9-13），
  每个 case 含完整的 fixture Java 源码和**期望断言**注释
- T-2.x 完成对应实现后，单独把负责的 case 从 `it.skip` 改为 `it`
- 13 case 覆盖矩阵：

  | # | 场景 | unskip 触发 task |
  |---|------|------------------|
  | 1 | 实例 method call (`obj.method()` → cross-module + qualifier) | T-2.2 |
  | 2 | method overloading label-only | T-3.5（依赖 walker）|
  | 3 | static / PascalCase Class.method | T-2.2 |
  | 4 | interface default method + enclosing interface callerContext | T-3.5 |
  | 5 | lambda 内部调用 + 嵌套优先 | T-3.5 |
  | 6 | 反射调用 → unresolved | T-2.2 |
  | 7 | callerContext 嵌套追踪（record + nested class）| T-3.5 |
  | 8 | generic method invocation | T-2.2 |
  | 9 | 大文件兜底（FR-006 MUST）| T-3.5（含字节数测试）|
  | 10 | phantom call（FR-007 MUST，ERROR 跳子树 + sibling ERROR 跳当前）| T-3.5 |
  | 11 | super() / this() explicit constructor | T-2.3 |
  | 12 | 匿名类 (`<anon-class>.{methodName}` callerContext) | T-3.5 |
  | 13 | this.method() → member + undefined（**Codex CRITICAL E**）| T-2.2 |
  | 14 | static import (`sort(list)` → member + undefined）（**Codex WARNING W-3**）| T-2.2 |

  注：场景 14 是 Codex W-3 新增锚点，对应 R-5 free deferred 决策的可执行测试。

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts`
（13 个 `.skip` 不计失败 → vitest pass）
**预估工时**：1.0h

---

### T-2.1 — 6 个 receiver 类型探测辅助函数

**依赖**：T-2.0
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**（Codex WARNING W-2 修订：`_isJavaTypeName` 不再含 package root 判定）：
- `private _isJavaTypeName(text: string): boolean`
  - PascalCase（首字母大写 + 含至少一个小写字母）OR
  - `JAVA_ACRONYM_TYPE_NAMES.has(text)`
  - **不**判定 `JAVA_PACKAGE_ROOT_NAMES`（避免 `com` / `org` 误归为 type）
- `private _fieldAccessTerminalIsType(node)` — 取末段 field，调 `_isJavaTypeName`
- `private _fieldAccessSegments(node): string[] | null` — 递归展开 field_access 链
- `private _looksLikePackageQualifiedType(node): boolean`
  - segments ≥ 3
  - leftmost ∈ `JAVA_PACKAGE_ROOT_NAMES`
  - 中间层全部 `^[a-z][a-z0-9_]*$` package segment
  - 末段 PascalCase（`/^[A-Z]/`）
  - 这是 package root 唯一的合法使用点
- `private _normalizeJavaTypeName(name): string` — 取 `'.'` 分割末段
- `private _stripTypeArgs(text): string` — 剥离 `<...>` 泛型参数

**验收命令**：`npm run build` + 可选 `npx vitest run` 检查 no regression
**预估工时**：1.25h

---

### T-2.2 — `_classifyMethodInvocation` 优先级 dispatch

**依赖**：T-2.1
**修改文件**：`src/core/query-mappers/java-mapper.ts`
+ unskip `tests/unit/java-mapper-callsite.test.ts` 中场景 1/3/6/8/13/14 + MUST 13
**接口/契约要点**：
- 优先级顺序（严格按 plan 修订版伪代码）：
  1. `objectNode?.type === 'super'` → `super`
  2. `JAVA_REFLECTION_METHOD_NAMES.has(calleeName)` → `unresolved`
  3. `objectNode?.type === 'this'` → `member` + undefined（**Codex CRITICAL E**）
  4. `type_identifier` / `scoped_type_identifier` → `member` + 末段类名
  5. `identifier`：
     - `_isJavaTypeName(text)` → `member` + text（PascalCase / acronym）
     - else → `cross-module` + text（lowercase variable）
  6. `field_access`：末段 type → `member` + 末段类名；否则 `cross-module` + undefined
  7. 其它 receiver → `cross-module` + undefined
  8. 无 receiver → `member` + undefined（不输出 `free`，与 truth-set 对齐；
     场景 14 static import 也走此分支）
- `nameNode === null` → `{ calleeName: '<unknown>', calleeKind: 'unresolved' }`

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts`（场景 1/3/6/8 + MUST 13/14 通过）
**预估工时**：1.5h

---

### T-2.3 — `_classifyObjectCreation` + `_handleExplicitConstructorInvocation`

**依赖**：T-2.1
**修改文件**：`src/core/query-mappers/java-mapper.ts`
+ unskip 测试场景 11
**接口/契约要点**：
- `_classifyObjectCreation(node): ClassifyResult`
  - `type_identifier` / `scoped_type_identifier` / `generic_type` 三种 typeNode
  - calleeName + calleeQualifier 都是 `_normalizeJavaTypeName(_stripTypeArgs(typeNode.text))`
  - calleeKind：`member`
- `_handleExplicitConstructorInvocation(node, out)` 骨架（先不接 callerContext，
  T-3 接通）：
  - constructor 字段 type === `super` 或 `this` → `kind: 'super'`，calleeName 为 'super'/'this'
  - 其它 → `kind: 'unresolved'`

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts`（场景 11 unskip 后通过）
**预估工时**：0.75h

---

### T-2.4 — `_handleMethodInvocation` / `_handleObjectCreation` 骨架

**依赖**：T-2.2、T-2.3
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**（Codex CRITICAL C-5 修订：先放 stub handler，T-3 才接 callerContext + push）：
- `_handleMethodInvocation(node, out)` 骨架：调 `_classifyMethodInvocation`，
  **暂不**调 callerContext / phantom（T-3 接），暂不 push out
- `_handleObjectCreation(node, out)` 骨架：调 `_classifyObjectCreation`，同上
- 这两个 handler 在 T-2 阶段是"已经声明 + 调 classify 但不输出 CallSite"的 stub，
  避免 T-3.1 walker dispatch 时 build 失败

**验收命令**：`npm run build`
**预估工时**：0.5h

---

### T-2 汇总验收

```bash
npx vitest run
npm run build
```

期望：
- 场景 1/3/6/8 + MUST 11/13 + WARNING 14（场景 14 = static import）共 ≥ 7 case 通过
- 场景 2/4/5/7 + MUST 9/10/12 仍 `.skip`（依赖 walker，T-3 unskip）
- vitest 全集零失败（.skip 不计失败）
- build 零错误

### T-2 Codex 阶段性 review 时机

T-2 汇总验收通过后、commit 前，Codex 重点审查：
- `_classifyMethodInvocation` 优先级 dispatch 是否覆盖所有 receiver 节点 type
  （包括 `parenthesized_expression` 等边界）
- `this.method()` 与 `this()` 是否分别走 `_classifyMethodInvocation` 和
  `_handleExplicitConstructorInvocation`（节点类型分流）
- `_isJavaTypeName` 是否真的不再含 package root 判定（W-2 验证）
- 静态导入场景 14 的 `member` + undefined 输出是否与 truth-set kind=method 对齐

---

## T-3：walk + callerContext + phantom 防护

**目标**：实现完整的 DFS walker、向上 walk callerContext 解析和 phantom call 防护，
接通 `extractCallSites` 全链路，取消所有 `.skip`。

### T-3.1 — `_walkCallSites` 迭代式 DFS

**依赖**：T-2
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**：
- `private _walkCallSites(root: Parser.SyntaxNode, out: CallSite[]): void`
- 迭代式 DFS（手工栈，`const stack: Parser.SyntaxNode[] = [root]`）
- 节点类型 dispatch：
  - `method_invocation` → `_handleMethodInvocation(node, out)`
  - `object_creation_expression` → `_handleObjectCreation(node, out)`
  - `explicit_constructor_invocation` → `_handleExplicitConstructorInvocation(node, out)`
- **ERROR / MISSING 跳过策略**（Codex CRITICAL C-5 + C-6 修订）：
  - `node.type === 'ERROR'` 或 `node.isMissing === true` → 跳过该节点 + 不入栈
    其 namedChildren（整个子树跳过）
  - 非 ERROR/MISSING 节点正常入栈所有 namedChildren

**验收命令**：`npm run build`（dispatch 调用的 3 个 handler 在 T-2.4 已 stub，build 通过）
**预估工时**：1.0h

---

### T-3.2 — `_resolveCallerContext` + `_findEnclosingTypeName`

**依赖**：T-3.1
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**：
- `private _resolveCallerContext(node): string` — 向上 `while (cursor.parent)`
  walk，匹配最近一层 function-like scope（按 plan FR-008 表）：

  | 节点类型 | 输出格式 |
  |---------|---------|
  | `method_declaration` | `"{TypeName}.{methodName}"` |
  | `constructor_declaration` | `"{TypeName}.<init>"` |
  | `compact_constructor_declaration` | `"{TypeName}.<init>"` |
  | `lambda_expression` | `"<lambda:{startLine}:{startColumn}>"` |
  | （顶层）| `"<top-level>"` |

  **嵌套优先**：第一个匹配立即 return，不继续向上 walk

- `private _findEnclosingTypeName(node): string`（Codex CRITICAL C-7 修订：
  类型边界扩展）— 从给定节点向上找最近的 type 容器：
  ```
  类型节点集合：
    class_declaration
    interface_declaration
    enum_declaration
    record_declaration            # Java 14+ record
    annotation_type_declaration   # @interface
  ```
  - 找到 → 取 `name` 字段；name 为 null → return `'<anon-class>'`
  - 遇 `object_creation_expression` 内层 class_body → return `'<anon-class>'`
  - 找到根仍未匹配 → return `'<top-level>'`

**验收命令**：`npm run build`
**预估工时**：1.5h

---

### T-3.3 — `_isPhantomCall`（Codex CRITICAL C-6 修订）

**依赖**：T-3.2
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**（spec FR-007 是"或"，不是"且"）：
- `private _isPhantomCall(node, kind): boolean`
- 关键 callee 字段：
  - `kind === 'method-invocation'` → `node.childForFieldName('name')`
  - `kind === 'object-creation'` → `node.childForFieldName('type')`
  - `kind === 'explicit-constructor'` → `node.childForFieldName('constructor')`
- 判定（**或**关系，不是与）：
  ```
  return calleeNode.hasError === true
      || node.children.some(c => c.type === 'ERROR' || c.isMissing === true);
  ```
- phantom 调用方语义（在 `_handleX` 中）：
  - phantom 命中 → **仅跳过当前 call 的抽取**（不 push out）
  - **但 children 仍 walk**（_walkCallSites 正常入栈 namedChildren，避免内层
    真实 call 被误杀）

**验收命令**：`npm run build`
**预估工时**：0.75h

---

### T-3.4 — `_mkCallSite` + 接通 handler 完整链路

**依赖**：T-3.2、T-3.3
**修改文件**：`src/core/query-mappers/java-mapper.ts`
**接口/契约要点**：
- `private _mkCallSite(calleeName, kind, line, column, callerContext?, qualifier?): CallSite`
  按 `CallSiteSchema` 构造，可选字段仅在非 undefined 时写入
- 在 `_handleMethodInvocation` / `_handleObjectCreation` /
  `_handleExplicitConstructorInvocation` 中接通完整逻辑：
  ```
  if (_isPhantomCall(node, kind)) return;
  const cls = _classifyXxx(node);
  const callerCtx = _resolveCallerContext(node);
  const line = node.startPosition.row + 1;
  const col = node.startPosition.column;
  out.push(_mkCallSite(cls.calleeName, cls.calleeKind, line, col, callerCtx, cls.calleeQualifier));
  ```

**验收命令**：`npm run build`
**预估工时**：0.75h

---

### T-3.5 — 取消 .skip + 完整 13 case 断言（Codex WARNING W-4 修订）

**依赖**：T-3.4
**修改文件**：`tests/unit/java-mapper-callsite.test.ts`
**接口/契约要点**：取消所有 `.skip`，逐 case 写完整断言：

| # | 场景 | Java fixture 摘要 | 关键断言字段 |
|---|------|-------------------|-------------|
| 1 | 实例 method call | `class A { void m() { obj.foo(); } }` | calleeKind='cross-module', calleeName='foo', calleeQualifier='obj', callerContext='A.m' |
| 2 | overloading label-only | 同名 connect(String) + connect(Properties) | mapper 输出仅 1 条 calleeName='connect'（label-only）|
| 3 | static / PascalCase | `class A { void m() { Collections.sort(l); } }` | calleeKind='member', calleeQualifier='Collections', callerContext='A.m' |
| 4 | interface default method | `interface I { default void close() { helper(); } }` | callerContext='I.close', calleeName='helper' |
| 5 | lambda 嵌套优先 | `class A { void m() { l.forEach(x -> x.go()); } }` | lambda 内 `go` 的 callerContext 形如 `<lambda:{line}:{col}>` |
| 6 | 反射 unresolved | `class A { void m() { Class.forName("..."); } }` | calleeKind='unresolved', calleeName='forName' |
| 7 | record + nested class | `record P(int x) { P { validate(); } }` 含 nested class | record callerContext='P.<init>'，nested callerContext='Inner.method'（最近一层）|
| 8 | generic method | `class A { void m() { List.<String>of(); } }` | calleeName='of'（去掉 type args）, calleeKind='member' |
| 9 | 大文件字节兜底（**Codex WARNING W-1**）| 构造含中文注释/UTF-8 多字节字符的 source，使 `Buffer.byteLength` > 1 MB 但 `source.length` < 1 MB | extractCallSites 返回 `[]` |
| 10 | phantom call | 含 syntax error 的 Java 片段，ERROR 节点子树内有调用 + ERROR 外有真实调用 | ERROR 子树内调用**不**抽，ERROR 外调用照抽（callerContext 正确）|
| 11 | super/this constructor | `class A extends B { A() { super(); this(1); } }` | 两条记录 calleeKind='super'，calleeName='super' / 'this' |
| 12 | 匿名类 | `new Runnable() { public void run() { obj.go(); } }` | callerContext='<anon-class>.run' |
| 13 | this.method() | `class A { void m() { this.helper(); } }` | calleeKind='member', calleeQualifier=undefined, callerContext='A.m' |
| 14 | static import | `import static java.util.Collections.sort; class A { void m() { sort(l); } }` | calleeKind='member', calleeQualifier=undefined |

**验收命令**：`npx vitest run tests/unit/java-mapper-callsite.test.ts && npm run build`
**预估工时**：3.0h（最大子任务，14 case fixture + 断言编写）

---

### T-3 汇总验收

```bash
npx vitest run
npm run build
```

期望：
- 全部 14 个 test case 通过（13 plan 计划 + 1 W-3 新增 = 14；spec SC-003 ≥ 7 满足）
- 常量同源 3 个断言通过
- vitest 全集零失败

### T-3 Codex 阶段性 review 时机

T-3 汇总验收通过后、commit 前，Codex 重点审查：
- `_resolveCallerContext` 输出格式是否与 `.mjs:_resolveJavaCaller` **逐字符**对齐
  （特别 `<lambda:{line}:{col}>` 中 line 是 1-based 还是 0-based）
- `_findEnclosingTypeName` 5 类节点 + 匿名类 + 顶层共 7 形态都正确
- `_isPhantomCall` 是 OR 不是 AND（C-6 验证）
- `_walkCallSites` 处理嵌套 lambda 时 namedChildren 入栈顺序是否影响 case 5 断言

---

## T-4：verify 脚本

**目标**：实现完整的端到端验证脚本，包含可独立测试的纯函数和主流程，为 T-5 E2E 验
收做准备。

### T-4.1 — verify 脚本纯函数 export

**依赖**：T-3
**新增文件**：`scripts/verify-feature-154.mjs`（仅纯函数部分，约 100 行）
**接口/契约要点**：
- `export function extractCallerLabel(extractorCaller, file): string`
  - 优先 `startsWith(file + ':')` 前缀匹配（处理 lambda `<lambda:行:列>` 内含冒号）
  - 兜底取首个 `:` 之后
  - 5 种形态对照（plan callerLabel 归一化算法表）
- `export function median(nums): number` — 奇数取中位，偶数取两中位平均，空数组返回 0
- `export function evaluateMatch(mapperTuple, truthSet): boolean` — `truthSet.has(mapperTuple)`
- `export function normalizeRelPath(absPath, target): string`（Codex WARNING W-5）—
  `path.relative(target, absPath).split(path.sep).join('/')`，POSIX 归一

**验收命令**：
```bash
node -e "import('./scripts/verify-feature-154.mjs').then(m => { \
  console.log({ \
    eclt: typeof m.extractCallerLabel, \
    md:   typeof m.median, \
    em:   typeof m.evaluateMatch, \
    nrp:  typeof m.normalizeRelPath, \
  }); \
})"
```
**预估工时**：0.75h

---

### T-4.2 — 纯函数单测

**依赖**：T-4.1
**新增文件**：`tests/unit/verify-feature-154.test.ts`（路径修订：CRITICAL C-1）
**接口/契约要点**：
- `extractCallerLabel` 5 形态各一 case：method / `<init>` / `<lambda:42:18>` /
  `<top-level>` / `<anon-class>.run`
- `median` 边界：奇数 [1,3,5] / 偶数 [1,2,3,4] / 单元素 [7] / 空数组 []
- `evaluateMatch` 命中 / 未命中各一 case
- `normalizeRelPath` POSIX 归一（mac/linux 默认是 `/`，但显式 split+join 保证
  跨 OS 输出一致）

**验收命令**：`npx vitest run tests/unit/verify-feature-154.test.ts`
**预估工时**：0.75h

---

### T-4.3 — verify 脚本主流程

**依赖**：T-4.1
**修改文件**：`scripts/verify-feature-154.mjs`（补全主流程，约 200 行）
**接口/契约要点**：
- args parse：`--target`（必须）、`--out`（可选，JSON 输出路径）、`--repeats`
  （默认 3）、`--help`、`--debug`
- 流程：
  1. 校验 `dist/adapters/java-adapter.js` + `dist/runtime-bootstrap.js` 存在
     （否则提示先 `npm run build`）
  2. `bootstrapRuntime` → `extractJavaCallSites({ sourceRoot: target })`
  3. 构建 truthIndex：`Map<relFile, Set<"callerLabel|calleeName">>`，每条
     truth call 用 `extractCallerLabel(call.caller, call.file)` 拆 label
  4. `truthFilesWithCalls` = truthIndex 中至少 1 条 entry 的文件集合
  5. N 次重测（默认 3）：
     - 扫描 `target/**/*.java`，逐文件 `analyzeFile({ extractCallSites: true })`
     - 文件 relFile 用 `normalizeRelPath(file, target)`（W-5）
     - 计算 fillRate（分子 = mapper 输出非空 ∩ truthFilesWithCalls；分母 =
       truthFilesWithCalls.size，~39）
     - 计算 precision / recall（label-only 三元组：
       `"{relFile}|{callerContext}|{calleeName}"`）
     - mapper 集合空时 precision = 0（NaN 防护）
  6. `median` 取 N 次中位数
  7. 输出 JSON：
     ```
     {
       target, repeats,
       runsRaw: [{fillRate,precision,recall}, ...],
       median: { fillRate, precision, recall },
       thresholds: { fillRate: 0.95, precision: 0.70, recall: 0.30 },
       pass: boolean,
       truthStats: { totalFiles, filesWithCalls, totalCalls }
     }
     ```
  8. `--debug` 或 `recall < 0.30` 时输出最差 recall 文件 + 前 5 miss 示例
  9. exit code：pass → 0，fail → 1

**验收命令**：
```bash
npm run build
node scripts/verify-feature-154.mjs --help     # 检查 args parse 不崩溃
```
**预估工时**：1.5h

---

### T-4.4 — vitest 全集回归确认

**依赖**：T-4.2、T-4.3
**操作**：仅运行验证命令，不修改代码
**接口/契约要点**：确保 verify 脚本的 ESM import / vitest 配置不影响现有测试套件

**验收命令**：`npx vitest run && npm run build`
**预估工时**：0.25h

---

### T-4 汇总验收

```bash
npx vitest run
npm run build
node scripts/verify-feature-154.mjs --help
```

期望：
- 4 个纯函数单测（共 ≥ 12 case）通过
- vitest 全集零失败
- 脚本 `--help` 可加载，无运行时报错

### T-4 Codex 阶段性 review 时机

T-4 汇总验收通过后、commit 前，Codex 重点审查：
- `extractCallerLabel` lambda 多冒号场景是否被 prefix-match 正确处理
- precision 分母为 0 时的 NaN 防护是否生效
- N=3 中位数偶数 N 时是否正确取两中位平均
- `--debug` 输出在 recall ≥ 0.30 时是否**不**产生（避免 stdout 污染 pass exit）
- `dist/` 缺失时 verify 脚本是否友好提示 `npm run build`

---

## T-5：HikariCP E2E 验证

**目标**：在真实 HikariCP 代码库上运行 verify 脚本，达成 SC-001/SC-002 质量基线，
写入 verification report。

### T-5.1 — Baseline 检查 + 首次 E2E 运行

**依赖**：T-4
**前置条件**：`~/.spectra-baselines/HikariCP/src/main` 已存在
**操作**：
```bash
# Codex WARNING W-6 修订：preflight baseline 检查 + 兜底 clone
if [ ! -d "$HOME/.spectra-baselines/HikariCP/src/main" ]; then
  echo "HikariCP baseline 不存在，运行 clone 脚本..."
  bash scripts/baselines/clone-baseline-projects.sh
fi

# Codex CRITICAL C-8 修订：必须先 build
npm run build

# E2E 运行
node scripts/verify-feature-154.mjs \
  --target ~/.spectra-baselines/HikariCP/src/main \
  --out /tmp/verify-154-run1.json \
  --repeats 3
```

**接口/契约要点**：
- 目标阈值：`fillRate ≥ 0.95`、`precision ≥ 0.70`、`recall ≥ 0.30`
- 若未达标：解析 debug 输出，定位问题类别（callerContext 格式漂移 /
  kind 误判 / phantom 过度过滤 / relFile 不一致）

**验收命令**：达标 exit code 0；不达标进 T-5.2
**预估工时**：1.0h（含首次运行 ~3 分钟 + 结果解析）

---

### T-5.2 — 迭代修复（按需，预算 4-8h）

**依赖**：T-5.1 未达标时执行
**修改文件**：视定位结果，可能涉及 `src/core/query-mappers/java-mapper.ts` /
`scripts/verify-feature-154.mjs`
**接口/契约要点**（Codex CRITICAL C-8 + WARNING W-7 修订）：
- 每次修复后**必须**：`npx vitest run && npm run build && node scripts/verify-feature-154.mjs ...`
- 工时预算 4-8h（W-7 修订：1.5h 估算偏低；HikariCP recall 调优经验上需多轮）
- 常见修复方向：
  - `callerContext` 格式与 `_resolveJavaCaller` 不对齐 → 修 `_resolveCallerContext`
  - `this.method()` / `super.method()` 误归 → 修 `_classifyMethodInvocation` 优先级
  - 嵌套类多层路径 → 修 `_findEnclosingTypeName` 取最近一层
  - `relFile` POSIX/Win 路径不一致 → 检查 `normalizeRelPath` 调用点
- 若 3 轮迭代仍不达标 → 暂停，写 risk note 到 verification report，回报用户

**验收命令**：
```bash
npx vitest run && npm run build && node scripts/verify-feature-154.mjs \
  --target ~/.spectra-baselines/HikariCP/src/main --repeats 3
```
**预估工时**：4-8h（contingency budget；T-1~T-4 实现完整时可能不需要）

---

### T-5.3 — verification report 写入

**依赖**：T-5.1（达标后）
**新增文件**：`specs/154-java-callsites/verification/verification-report.md`
**接口/契约要点**：report 必含字段：
- Feature / 验证日期 / commit hash
- SC 达标状态（fillRate / precision / recall 实测值 vs 阈值）
- N=3 runs 原始数据（三次 fillRate/precision/recall）
- vitest 通过 case 数（含 14 case 列表 + 常量同源 + verify 纯函数）
- HikariCP target 路径 + .java 文件总数 + truth-set 统计（总 truthCall 数、
  filesWithCalls）
- 若 T-5.2 触发了多轮修复 → 列出修复轨迹（每轮 fillRate/precision/recall 变化）
- Codex review 阶段性结论摘要（5 个 phase 的 critical/warning 处置）

**验收命令**：`cat specs/154-java-callsites/verification/verification-report.md`
（人工确认字段完整）
**预估工时**：1.0h

---

### T-5 汇总验收

```bash
npx vitest run
npm run build
node scripts/verify-feature-154.mjs \
  --target ~/.spectra-baselines/HikariCP/src/main \
  --repeats 3
```

期望：
- exit code 0（三项指标全达标）
- vitest 全集零失败
- verification report 存在且字段完整

### T-5 Codex 阶段性 review 时机

T-5 达标、report 写完后、final commit 前，Codex 对整个 Feature 154 变更集做总体
对抗审查（按 spec-driver-story Phase 5 verify 流程）：
- java-mapper.ts 新增代码是否引入 `extractExports` / `extractImports` / `extractParseErrors`
  回归
- adapter 透传：`extractCallSites: undefined` 时 `callSites` 是 undefined 还是 `[]`
- verify 脚本 exit code 逻辑（pass=0 / fail=1，不反转）
- SC 实测值是否真实可重现（同 commit、同 target、N=3 中位数稳定）

---

## FR 覆盖映射

| FR | 描述摘要 | 对应任务 |
|----|---------|---------|
| FR-001 | method_invocation / object_creation / explicit_constructor 三类节点抽取 | T-2.2, T-2.3, T-3.4 |
| FR-002 | calleeKind 7 个合法值 + calleeName/line/column/callerContext/calleeQualifier | T-2.2, T-2.3, T-3.4 |
| FR-003 | kind dispatch 优先级表（free deferred） | T-2.2, T-2.4（场景 14） |
| FR-004 | adapter 透传 extractCallSites flag（默认 false） | T-1.3, T-1.5 |
| FR-005 | 反射 12 项常量与 extractor 同源 | T-1.1, T-1.2, T-1.4 |
| FR-006 | 大文件兜底（>1 MB 字节）| T-1.3, T-3.5（case 9 字节数测试）|
| FR-007 | phantom call OR 关系跳过 | T-3.1, T-3.3, T-3.5（case 10）|
| FR-008 | callerContext 最近一层 enclosing scope（5 形态）| T-3.2, T-3.5（case 4/5/7/12）|
| FR-009 | record compact_constructor 归 `<init>` | T-3.2, T-3.5（case 7）|
| FR-010 | lambda callerContext 唯一化 `<lambda:行:列>` | T-3.2, T-3.5（case 5）|
| FR-011 | 仅改 java-adapter / java-mapper / extractor 顶部 export | 全部任务范围约束 |
| FR-012 | verify 脚本 fillRate/precision/recall 输出 + exit code | T-4.3, T-5.1 |
| FR-013 | verify 脚本运行时重生成 truth-set | T-4.3 |

---

## Risk Register

| 编号 | 风险描述 | 来源 | 缓解策略 | 对应任务 |
|------|---------|------|---------|---------|
| R-1 | tree-sitter Java grammar field name 与预期不符 | plan.md 风险 1 | 单测使用真实 grammar；null 安全兜底 | T-2.2, T-2 Codex review |
| R-2 | HikariCP recall ≥ 30% 不可达（callerContext 格式漂移 / kind 误判 / relFile 不一致）| plan.md 风险 2（MEDIUM）| verify debug 模式；T-5.2 预算 4-8h（W-7 修订）| T-4.3, T-5.2 |
| R-3 | 大文件性能（HikariConfig.java 1262 LOC）| plan.md 风险 3 | 迭代式 DFS；MUST 9 字节数 fixture（W-1 修订）| T-3.1, T-3.5 |
| R-4 | parse 异常兜底 | plan.md 风险 4 | extractCallSites 入口 try-catch + warn + 返回 [] | T-1.3 |
| R-5 | `free` kind 缺失（Codex CRITICAL A）| Codex P1 | spec FR-003 已 deferred；truth-set 同口径；T-2.4 场景 14 锚点验证 | T-2.4（W-3 修订）|
| R-6 | `this.method()` 误归 cross-module（Codex CRITICAL E）| Codex P1 | 优先级 dispatch 显式 `this` node type | T-2.2, T-3.5（case 13）|
| R-7 | extractor 常量 export 引入副作用（Codex F）| Codex P1 | 仅加 export，不改集合内容；T-1 review 专项 | T-1.1, T-1 Codex review |
| R-8 | extractCallerLabel lambda 冒号截断（Codex B）| Codex P1 | prefix-match `file + ':'` 优先；T-4.2 5 形态测试 | T-4.1, T-4.2 |
| R-9 | 测试路径不被 vitest 收集（Codex C-1）| Codex P1（v0.2 修订）| 所有测试落 `tests/unit/`，对齐 vitest projects | T-1.4, T-2.0, T-4.2 |
| R-10 | T-1.5 绕过 adapter（Codex C-3）| Codex P1（v0.2 修订）| 必须经 `JavaLanguageAdapter.analyzeFile`；测 default undefined | T-1.5 |
| R-11 | T-2 验收依赖倒置（Codex C-4）| Codex P1（v0.2 修订）| T-2.0 先建 13 case 骨架（.skip），T-2.x unskip 自己负责的 case | T-2.0 |
| R-12 | T-3.1 walker dispatch 调用未实现 handler（Codex C-5）| Codex P1（v0.2 修订）| T-2.4 先放 stub handler，T-3.4 才接通 | T-2.4, T-3.4 |
| R-13 | `_isPhantomCall` 用 AND 而非 OR（Codex C-6）| Codex P1（v0.2 修订）| T-3.3 明确 OR 关系 + 测试 case 10 验证 | T-3.3, T-3.5 |
| R-14 | `_findEnclosingTypeName` 漏 record/enum/annotation（Codex C-7）| Codex P1（v0.2 修订）| T-3.2 明确 5 类节点全覆盖 | T-3.2, T-3.5（case 7）|
| R-15 | T-5.2 验收漏 npm run build（Codex C-8）| Codex P1（v0.2 修订）| T-5.2 命令必含 build；mapper 修改后 verify 才看新代码 | T-5.2 |
| R-16 | 大文件用 character count 而非 byte count（Codex W-1）| Codex P1（v0.2 修订）| T-1.3 用 `Buffer.byteLength`；T-3.5 case 9 含 UTF-8 多字节边界 | T-1.3, T-3.5 |
| R-17 | `_isJavaTypeName` 误判 package root（Codex W-2）| Codex P1（v0.2 修订）| T-2.1 不再混 package root；只在 `_looksLikePackageQualifiedType` 用 | T-2.1 |
| R-18 | relFile path normalization 跨 OS 不一致（Codex W-5）| Codex P1（v0.2 修订）| T-4.1 export `normalizeRelPath`；T-4.3 双侧统一调用 | T-4.1, T-4.3 |
| R-19 | baseline 路径不存在时无兜底（Codex W-6）| Codex P1（v0.2 修订）| T-5.1 preflight clone-baseline-projects.sh | T-5.1 |
| R-20 | commit 边界歧义（Codex W-8）| Codex P1（v0.2 修订）| Commit Boundary 章节明确 5 commit / 子任务不单独 commit | 文档级约束 |
