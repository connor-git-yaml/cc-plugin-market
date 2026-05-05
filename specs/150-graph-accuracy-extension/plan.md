# Implementation Plan: graph-accuracy.mjs 4 语言扩展 + HikariCP / GORM Baseline 入库

**Branch**: `150-graph-accuracy-extension` | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/150-graph-accuracy-extension/spec.md`

## Summary

把 `scripts/graph-accuracy.mjs` 从仅 Python anchor 流程扩到 4 语言（python / ts / go / java）AST extractor 流水线，并把 HikariCP `src/main` 与 GORM 顶层包入库为 truth set fixture。本 Feature 是 Spectra MCP-First Evolution 系列（Feature 151~154 + 151a/b/c/d）的 **Pre-dependencies 强制 gate**：oracle 必须先于 implementation 存在。完成后 Feature 151+ 全部 sub-features 才允许启动。

技术取向：**最小变更 + 零新 dep**——5 个 tree-sitter grammar wasm（python / javascript / typescript / go / java）已在 `grammars/`，`web-tree-sitter` runtime 已在 `package.json`，复用既有依赖即可，避免 ts-morph / @typescript-eslint/parser 等第二条 parser 链路。

## Technical Context

**Language/Version**: Node.js 20.x（pure ESM `.mjs` 脚本，无 TypeScript transpile 链路）；Python 3.x 仅作为现有 `python-call-extractor.py` 的运行时（不修改）
**Primary Dependencies**: `web-tree-sitter`（已在 `package.json` runtime deps）+ 5 个 wasm grammar（`grammars/tree-sitter-{python,javascript,typescript,go,java}.wasm`，已 verified 全在仓）；不引入 `ts-morph` / `@typescript-eslint/parser` / `go/parser` / `javaparser` 等任何新 dep
**Storage**: 文件系统——baseline 源码 git clone 在 `~/.spectra-baselines/<project>/`（跨 worktree 共享）；truth set fixture 持久化在仓内 `tests/baseline/<project>/truth-set.json`
**Testing**: vitest 3.x（实际版本，Codex WARNING #2 修订）（已在 `vitest.config.ts`）+ Per-file coverage thresholds（FR-019 / SC-001：避免全局聚合稀释 ≥ 95%）
**Target Platform**: Node.js 20.x on macOS / Linux（开发本机 + CI Ubuntu runner）
**Project Type**: Single project（spectra 仓库根 `scripts/` + `tests/`）
**Performance Goals**: extractor 单次跑 < 30 秒（HikariCP `src/main` ~5k LOC、GORM 顶层 ~10k LOC、hono ~30k LOC、self-dogfood ~17k LOC，tree-sitter wasm 解析 ~20k LOC/秒规模够用）；磁盘可控（HikariCP clone ~50MB / GORM clone ~10MB）
**Constraints**: $0 LLM cost（纯静态 AST 抽取，无 LLM 调用）；不修改 `src/`（所有 src 改动属 Feature 151+ 范围）；不破坏现有 Python 流程（FR-021 / SC-005 向后兼容硬约束 ≤ 1% 漂移）
**Scale/Scope**: 4 语言 extractor + 2 新 baseline fixture（HikariCP / GORM）+ 1 主流程修改（`graph-accuracy.mjs` 加 `--language` 分派）+ 1 vitest config 修改（per-file thresholds）+ 1 clone helper 脚本

## Constitution Check

参照 [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)。本 Feature 设计阶段已充分对齐 constitution，下列 5 条原则均不违反：

- **代码质量**：每个 extractor 单一职责（输入 source root → 输出 truth calls + warnings），共享接口由 Phase 2 foundational tasks 抽出公共 helper（tree-sitter loader / warnings 数组追加 / metadata 头构造），避免重复
- **零基思维**：本 Feature 是新 oracle 链路的零基设计——graph-accuracy.mjs 主流程的 `--language` 分派与各 extractor 的接口契约一次到位（不在错误抽象上叠 workaround），分派点抽离到独立函数避免 if-else 长链
- **简洁之道**：复用既有 wasm grammar（5 个全在仓），不引入第二条 parser 链路；clone helper 1 个统一脚本（HikariCP + GORM 共享 logic + retry 1 次）；每个 extractor 单文件 < 400 行（如超出考虑拆 helper module）
- **类型/合约即文档**：truth set JSON schema 在 spec 已定义（`{language, baseline, truthCalls, warnings}`），4 语言 extractor 输出严格对齐；warnings 的 `code` 字段使用 enum 字面量（`parse-error` / `unresolved-reflection` / `unresolved-dynamic`）便于 grep
- **测试先行**：每个 extractor 配套单测 ≥ 5 case + per-file ≥ 95% 覆盖（FR-018~FR-020 + SC-001），同 commit 提交，不允许"先实现再补测"

**Constitution gates 全部 PASS**——无 violations 需记入 Complexity Tracking。

## Architecture

### Top-level data flow

```text
       ┌──────────────────────────────────────────────────────────┐
       │  scripts/graph-accuracy.mjs  (--language dispatch)       │
       └──────┬───────────┬───────────┬───────────┬───────────────┘
              │           │           │           │
              v           v           v           v
       python-extr   ts-extr    go-extr     java-extr
       (existing)    (NEW)      (NEW)       (NEW)
              │           │           │           │
              └───────────┴─────┬─────┴───────────┘
                                │
                         truth set JSON
                  {language, baseline, truthCalls, warnings}
                                │
                                v
              compareGraphVsTruth(graph, truthSet)
                                │
                                v
              {precision, recall, hits, misses, falsePositives}
```

### 4 个 extractor 的共享接口契约

所有 extractor MUST 暴露统一接口：

```ts
// 共享接口（用 .mjs JSDoc 类型 + 仓内既有 zod schema 风格保持一致）
async function extractTruthSet(sourceRoot: string, options?: {
  scope?: string;            // 元数据头里的 scope 字段（FR-014 / FR-016）
  extractorVersion?: string; // 元数据头里的 extractorVersion（FR-014）
}): Promise<{
  language: 'python' | 'ts' | 'go' | 'java';
  baseline: { repo?, commit?, scope, generatedAt, extractorVersion };
  truthCalls: Array<{ caller, callee, file, line, kind }>;
  warnings: Array<{ file, line?, code, message? }>;
}>;
```

每个 extractor 内部职责：
1. 加载 tree-sitter wasm grammar（共享 helper）
2. 遍历 source root 下的目标语言文件（`.ts/.tsx` / `.go` / `.java`，跳过 `node_modules` / `.git` / `vendor` / `target` / `build`）
3. 对每个文件执行 tree-sitter parse → 走 query 抽 call sites
4. parse 失败 → warnings 追加 `parse-error` + 跳过该文件
5. 静态不可解析 → 标 `kind: 'unresolved'` + warnings 追加 `unresolved-reflection` 或 `unresolved-dynamic`
6. 返回 `{language, baseline, truthCalls, warnings}` 对象

### graph-accuracy.mjs 主流程的 dispatch logic

```text
parseArgs → switch (args.language ?? 'python'):
  case 'python': callPythonExtractor() // existing path, no change
  case 'ts':     await import('./lib/ts-call-extractor.mjs')   .then(m => m.extractTruthSet(...))
  case 'go':     await import('./lib/go-call-extractor.mjs')   .then(m => m.extractTruthSet(...))
  case 'java':   await import('./lib/java-call-extractor.mjs') .then(m => m.extractTruthSet(...))
  default:       throw new Error('Unsupported language: ...')
```

`--write-fixture` 处理逻辑跨语言共享（无需在每个 extractor 内重复实现 IO）。

### Tree-sitter query 关键模式（实现指引，**不预测精确字符串**）

| 语言 | 关键 node 类型 | kind 映射 |
|------|---------------|----------|
| Java | `method_invocation` (基础方法调用) | `method` |
| Java | `method_invocation` 第一子节点 = `super` keyword | `super` |
| Java | `object_creation_expression` (new ClassName()) | `constructor` |
| Java | `explicit_constructor_invocation` (构造器内 super()/this()) | `super` |
| Go | `call_expression` (callee = identifier) | `function` |
| Go | `call_expression` (callee = `selector_expression`) | `method` |
| Go | `call_expression` (callee = `selector_expression` with capitalized type) | `static`（package-level） |
| TS | `call_expression` | `method` / `function`（按 callee 形态） |
| TS | `new_expression` | `constructor` |
| TS | call_expression callee = `arrow_function` / `parenthesized_expression(arrow)` (IIFE) | `arrow`（仅 IIFE 直接调用，不含"在 arrow scope 内的其它 call"） |
| TS | `decorator` 内的 `call_expression` | 按 `method` 处理（label-only 匹配下足够） |

> **Codex CRITICAL #1 修订（2026-05-05）**：原表引用 `super_method_invocation` / `class_instance_creation_expression` 不存在于官方 tree-sitter-java grammar。修订后使用真实 node types：`method_invocation`（基础 + super.foo() 通过检测第一子节点是否为 `super` keyword 区分）/ `object_creation_expression`（new 构造）/ `explicit_constructor_invocation`（构造器内 super()/this()）。Implementation T-006 跑实际 parse 验证 query，必要时迭代修正。

> **Codex Phase 4D CRITICAL #4 修订（2026-05-05）**：原表"arrow_function 内的 call_expression"语义模糊（callee form vs scope context 二义性）。修订后明确：**arrow kind 仅指 IIFE**（call_expression 的 callee 直接是 arrow_function 或 (arrow)() 形式）。callback 内的 method/function call 按 callee 形态分类（method/function），不因外层是 arrow scope 而改 kind。这避免 hono 等 callback 重型代码上 arrow kind 占比异常低 (18/26066) 被误读为 systemic 漏抽。

**unresolved 触发条件**：
- Java：`Class.forName(...)` / JMX `MBean` lookup / 反射 method invocation → 标 `unresolved-reflection`
- Go：`reflect.ValueOf(...)` / `interface{}` 动态 dispatch / generics 抹除后的 callee 不可静态解析 → `unresolved-dynamic`
- TS：`eval(...)` / 动态 `import(...)` / `Function` 构造器 / generic-only callee → `unresolved-dynamic`

具体 tree-sitter query 字符串与 callee label 解析逻辑由 implement 阶段（Phase 3~5）决定，本 plan 不强制 query 写法。

### 共享 helpers（Phase 2 抽出）

为避免 4 个 extractor 之间复制 boilerplate，foundational phase（Phase 2）抽出：

- `loadTreeSitterParser(language)`：负责 `Parser.init()` + `Parser.Language.load(grammars/tree-sitter-<lang>.wasm)`
- `walkSourceFiles(root, extensions, ignorePaths)`：递归遍历，跳过 `node_modules` / `.git` / `vendor` / `target` / `build` / `dist` / `out`
- `appendWarning(warnings, code, file, line?, message?)`：统一 warnings 追加，避免 4 处分别拼对象
- `buildBaselineMetadata({repo, commit, scope, extractorVersion})`：生成 fixture metadata 头（FR-014 / FR-017）

放置位置：`scripts/lib/extractor-helpers.mjs`（新文件，不在 spec 强制 manifest 里，但属于 Phase 2 设计决策——见 File Manifest 备注）。

## File Manifest

下表精确列出本 Feature 触及的全部文件（路径绝对相对仓库根）：

### 新增文件（5 个 extractor 相关 + 1 helper + 1 clone helper = 7 个）

| 路径 | 用途 |
|------|------|
| `scripts/lib/ts-call-extractor.mjs` | TS / TSX AST extractor，FR-005 |
| `scripts/lib/go-call-extractor.mjs` | Go AST extractor，FR-006 |
| `scripts/lib/java-call-extractor.mjs` | Java AST extractor，FR-007 |
| `scripts/lib/extractor-helpers.mjs` | tree-sitter loader + walkSourceFiles + warnings helpers（Phase 2 foundational 抽出） |
| `scripts/baselines/clone-baseline-projects.sh` | clone HikariCP + GORM 至 `~/.spectra-baselines/`，pin commit + retry 1 次（FR-011 / FR-015） |
| `tests/unit/lib/ts-call-extractor.test.ts` | TS extractor 单测，≥ 5 case，per-file ≥ 95% |
| `tests/unit/lib/go-call-extractor.test.ts` | Go extractor 单测，≥ 5 case，per-file ≥ 95% |
| `tests/unit/lib/java-call-extractor.test.ts` | Java extractor 单测，≥ 5 case，per-file ≥ 95% |
| `tests/unit/scripts/graph-accuracy-dispatch.test.ts` | graph-accuracy.mjs `--language` 分派 + 向后兼容回归测试（Codex WARNING #1 修订：补 dispatch test）|

### 修改文件（2 个）

| 路径 | 修改类型 | 说明 |
|------|---------|------|
| `scripts/graph-accuracy.mjs` | 加 `--language` flag dispatch + 复用现有 `--write-fixture` logic | FR-001 / FR-002 / FR-003 / FR-004；保留现有 Python anchor path 不动（FR-005a / SC-005） |
| `vitest.config.ts` | `coverage.thresholds` 增加 per-file overrides（针对 4 个 extractor 文件 ≥ 95%）+ `coverage.include` 加 `scripts/lib/*-call-extractor.mjs` | FR-019 / SC-001 |

### 生成产物（fixture，2 个）

| 路径 | 生成时机 | 说明 |
|------|---------|------|
| `tests/baseline/HikariCP/truth-set.json` | Phase 3（P1）实现完后跑生成 | ≥ 100 truth calls + metadata 头（FR-013 / FR-014 / SC-002） |
| `tests/baseline/gorm/truth-set.json` | Phase 4（P2）实现完后跑生成 | ≥ 200 truth calls + metadata 头（FR-017 / SC-003） |
| `tests/baseline/hono/truth-set.json` | Phase 5（P3）实现完后跑生成 | TS extractor truth set，hono baseline 复用（Codex WARNING #1 修订：明确入 manifest）|
| `tests/baseline/self-dogfood/truth-set.json` | Phase 5（P3）实现完后跑生成 | TS extractor truth set，self-dogfood baseline 复用 |

### 参考产物（不入仓但写在 plan 里）

- hono / self-dogfood truth set：Phase 5（P3）阶段生成至 `tests/baseline/hono/truth-set.json` 与 `tests/baseline/self-dogfood/truth-set.json`（hono / self-dogfood 已在 baseline workspace，本 Feature 仅新增 truth set 文件）

### 不修改

- `scripts/lib/python-call-extractor.py`：现有 Python anchor，FR-005a 明确不动
- `src/**`：所有 src 改动属 Feature 151+ 范围
- 任何 `package.json` / `package-lock.json` 的 dep 增加：本 Feature 不引入新 dep

## Implementation Strategy

### Phase 划分（与 tasks.md 对齐）

- **Phase 1（Setup）**：vitest config per-file thresholds + clone helper 脚本——所有后续 phase 的前置
- **Phase 2（Foundational）**：graph-accuracy.mjs 主流程加 `--language` 分派 + `extractor-helpers.mjs` 抽出共享 helper——所有 user story 的前置
- **Phase 3（US1 P1：Java + HikariCP）** 🎯 MVP gate：critical risk path，最复杂
- **Phase 4（US2 P2：Go + GORM）**：复杂度居中
- **Phase 5（US3 P3：TS extractor）**：复杂度最低，已有成熟 grammar
- **Phase 6（Polish & Quality Gate）**：全量 vitest --coverage + repo:check + Codex 对抗审查 + rebase master

每个 user story（P1 / P2 / P3）独立可测——单独跑 `--language <lang>` 即可 verify，不依赖其它 story（spec.md "Independent Test" 约定）。但**强制 gate 不被弱化**：P1+P2+P3 全部完成才 unblock Feature 151+。

### Critical risk 应对（Java 优先）

**Java 是 4 语言中最复杂**（spec.md User Story 1 已说明：method overloading + static dispatch + interface default + lambda + JMX 反射）。优先做 Java（P1）的理由：早暴露 critical risk，万一 tree-sitter Java grammar 在 HikariCP 实战中暴露 query 写法盲点，能尽早调整其它两个 extractor 的 query 设计（共享 helpers 也能反向受益）。

### TDD 策略

每个 extractor 严格 TDD：
1. 先写单测（5+ case 含 unresolved fallback edge case）
2. 跑 `npx vitest run tests/unit/lib/<lang>-call-extractor.test.ts` 看到 fail
3. 实现 extractor → 跑测看到 pass
4. 跑 baseline truth set 生成 → spot-check 5-10%（HikariCP）/ 1%（GORM）人工 verify

### Clone helper 设计要点

`scripts/baselines/clone-baseline-projects.sh` 单脚本两 target：

```bash
# 伪代码示意，非最终实现
clone_repo "brettwooldridge/HikariCP" "~/.spectra-baselines/HikariCP" "<pinned-commit>"
clone_repo "go-gorm/gorm"            "~/.spectra-baselines/gorm"      "<pinned-commit>"
```

`clone_repo` 函数职责：
- 若目标目录已存在 → 跳过（FR Edge Case "已存在不 pull"）
- 否则 `git clone --depth 1 <url> && cd <dir> && git fetch --depth 1 origin <commit> && git checkout <commit>`
- 失败 → retry 1 次（spec.md Edge Case "clone 网络 timeout"）
- 仍失败 → exit 1 + stderr 写明 repo / commit / network error + 清理半 clone 目录

具体 commit hash 由 implement 阶段确定（在写 fixture 前选定 stable upstream commit，写入 fixture metadata `baseline.commit` 字段）。

## Testing Strategy

### Per-file coverage thresholds（vitest config 关键改动）

按 FR-019 / SC-001 严格 per-file ≥ 95%（不允许全局聚合稀释）。具体 vitest 配置形态（参考 [vitest 3.x（实际版本，Codex WARNING #2 修订） docs](https://vitest.dev/config/#coverage-thresholds)）：

```ts
// vitest.config.ts coverage 段（实现阶段最终形态可能略有调整）
coverage: {
  // ... 现有全局 thresholds 80% 保留 ...
  thresholds: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
    perFile: false, // 全局走 80%
    // 关键：4 个 extractor 文件单独走 95%
    'scripts/lib/ts-call-extractor.mjs': { branches: 95, lines: 95, functions: 95, statements: 95 },
    'scripts/lib/go-call-extractor.mjs': { branches: 95, lines: 95, functions: 95, statements: 95 },
    'scripts/lib/java-call-extractor.mjs': { branches: 95, lines: 95, functions: 95, statements: 95 },
  },
  include: [
    'src/**/*.ts',
    'scripts/lib/{ts,go,java}-call-extractor.mjs', // 新增
  ],
}
```

**注意**：vitest config `coverage.thresholds` 的 per-file 写法需 implement 阶段验证 vitest 3.x（实际版本，Codex WARNING #2 修订） 当前版本的精确 schema（参考 vitest 3.x（实际版本，Codex WARNING #2 修订） changelog）。如果当前版本仅支持 `perFile: true` 全局开关而非 per-file path-based override，则改用 `perFile: true` + 单独运行 4 个 extractor 子 vitest（每个 ≥ 95%）的工程方案。设计意图：**任一 extractor < 95% 必须独立暴露失败**。

### 单测 case 设计（每个 extractor ≥ 5 case）

参照 spec.md FR-020：

- **TS extractor 5 case**：basic call / method call / arrow function call / generic（callee label erased）/ decorator metadata 或 dynamic import unresolved fallback
- **Go extractor 5 case**：basic call / method call via selector / cross-package call / generic type fallback / dynamic dispatch unresolved
- **Java extractor 5 case**：basic call / method call / cross-class call / unresolved fallback / overloading edge case（同名不同签名 label-only 视为同 callee）

每个 case 用 inline source string + temp dir → extractor → assert truthCalls 子集匹配，避免依赖 baseline workspace（单测保持 fast + isolated）。

### Baseline truth set verification

- **HikariCP**：5-10% 随机 sample（约 5-10 条），人工对照 HikariCP `src/main` 源码 verify caller / callee / file / line 4 字段全部准确
- **GORM**：1% 随机 sample（约 2-3 条），同样人工 verify

verify 失败 → 调 extractor 直至 100% sample pass（按 spec.md SC-002 / SC-003 硬约束）。

### 向后兼容验证（FR-021 / SC-005）

实现完成后 MUST 跑现有 micrograd / nanoGPT Python 流程：

```bash
node scripts/graph-accuracy.mjs --language python --source ~/.spectra-baselines/karpathy/micrograd ...
```

输出 JSON byte-level diff 对照本 Feature 实施前的产物——coverage 数字漂移 ≤ 1%（key 顺序、嵌套层级、字段名 byte-stable）。差异超阈 → 必须回滚分派 logic 或修复直至 byte-stable。

## Performance / Cost

- **LLM 成本**：$0（纯静态 AST 抽取，无 LLM 调用）
- **磁盘**：HikariCP `--depth 1` clone ~50MB，GORM ~10MB，总 ~60MB。`~/.spectra-baselines/` 跨 worktree 共享（CLAUDE.local.md "Baseline 测试" 约定）一份够用
- **运行时**：tree-sitter wasm 解析吞吐 ~20k LOC/秒规模（web-tree-sitter v0.21+ 实测）。HikariCP `src/main` ~5k LOC < 1 秒；GORM 顶层 ~10k LOC < 1 秒；hono ~30k LOC ~2 秒；self-dogfood ~17k LOC ~1 秒。每个 extractor < 30 秒严格通过
- **CI 影响**：vitest --coverage 跑 3 个新 extractor 单测 + 现有 src 单测 → 总耗时增加 < 10 秒（每个 extractor 5 case，每 case 数十毫秒级）
- **网络**：clone HikariCP / GORM 一次（已存在则跳过）；CI 上若 baseline 不缓存则每次 ~30 秒额外耗时——通过 `~/.spectra-baselines/` 缓存 hit 优化

## Constitution Check（再次验证）

设计完成后再次对照 [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)：

- **代码质量**：✅ 共享 helper 抽出避免 4 处复制；每个 extractor 单一职责
- **零基思维**：✅ extractor 接口契约一次到位；不在 graph-accuracy.mjs 上 if-else 长链而是函数式 dispatch
- **简洁之道**：✅ 零新 dep，复用 wasm；clone helper 1 个统一脚本
- **类型/合约即文档**：✅ truth set schema 固化在 spec.md key entities + 本 plan Architecture 段；warnings code 字段 enum
- **测试先行**：✅ 每个 extractor 单测 ≥ 5 case + per-file ≥ 95% + spot-check 人工 verify

**所有 gates PASS，无 violations 需 Complexity Tracking**。

## Complexity Tracking

无 violations。本 Feature 不引入新 dep、不修改 src/、不破坏现有流程，无需特殊 justification。

## Project Structure

### Documentation (this feature)

```text
specs/150-graph-accuracy-extension/
├── spec.md              # Feature specification
├── plan.md              # 本文件
└── tasks.md             # Phase 3 输出
```

### Source Code (repository root)

```text
scripts/
├── graph-accuracy.mjs                    # 修改：加 --language dispatch
├── baselines/
│   └── clone-baseline-projects.sh        # 新增：clone helper
└── lib/
    ├── python-call-extractor.py          # 既有，本 Feature 不改
    ├── extractor-helpers.mjs             # 新增：共享 helpers
    ├── ts-call-extractor.mjs             # 新增
    ├── go-call-extractor.mjs             # 新增
    └── java-call-extractor.mjs           # 新增

tests/
├── unit/lib/                             # 新增 3 个单测
│   ├── ts-call-extractor.test.ts
│   ├── go-call-extractor.test.ts
│   └── java-call-extractor.test.ts
└── baseline/                             # 新增 2 个 fixture（生成产物）
    ├── HikariCP/truth-set.json
    └── gorm/truth-set.json

vitest.config.ts                          # 修改：per-file thresholds

grammars/                                 # 既有 5 wasm，不改
├── tree-sitter-python.wasm
├── tree-sitter-javascript.wasm
├── tree-sitter-typescript.wasm
├── tree-sitter-go.wasm
└── tree-sitter-java.wasm
```

**Structure Decision**: Single project（spectra 仓库根 `scripts/` + `tests/`）。本 Feature 不引入 monorepo 子包，所有改动在仓库根 `scripts/` + `tests/` + 1 个 `vitest.config.ts` 修改。

## 关键引用

- 设计文档：[`docs/design/spectra-mcp-evolution.md`](../../docs/design/spectra-mcp-evolution.md) §3 Feature 150 与 §6 Pre-dependencies、§7 Baseline 选型
- Spec：[`spec.md`](./spec.md)
- 现有 Python anchor：[`scripts/lib/python-call-extractor.py`](../../scripts/lib/python-call-extractor.py)
- 现有 graph-accuracy 主流程：[`scripts/graph-accuracy.mjs`](../../scripts/graph-accuracy.mjs)
- Baseline 约定：见 `CLAUDE.local.md` "Baseline 测试（Feature 143）"小节
- Constitution：[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
