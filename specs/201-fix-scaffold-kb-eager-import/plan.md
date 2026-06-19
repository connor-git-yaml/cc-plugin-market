---
feature_id: "201"
title: "fix scaffold-kb eager import — CLI 冷启动 sqlite-wasm 硬依赖修复"
mode: fix
status: ready
created: "2026-06-20"
---

# F201 修复规划 — CLI 冷启动 sqlite-wasm 硬依赖

## 摘要

本次修复针对 `src/cli/index.ts:30` 顶层静态 `import { runScaffoldKb }` 导致
`@sqlite.org/sqlite-wasm` 进入 CLI 冷启动模块图的根因。变更范围极小：
**一个源文件两处编辑 + 一个新集成测试文件**。所有其他命令行为和 scaffold-kb
在包存在时的行为保持完全不变。

---

## 修复变更清单

### 1. `src/cli/index.ts` — 两处编辑

#### 编辑 A：删除顶层静态 import（line 30）

**修改前：**
```typescript
import { runScaffoldKb } from './commands/scaffold-kb.js';
```

**修改后：**（整行删除，不保留任何残留注释）

#### 编辑 B：dispatch 分支改为 await import（line 210-211）

**修改前：**
```typescript
    case 'scaffold-kb':
      await runScaffoldKb(command);
      break;
```

**修改后：**
```typescript
    case 'scaffold-kb': {
      const { runScaffoldKb } = await import('./commands/scaffold-kb.js');
      await runScaffoldKb(command);
      break;
    }
```

> 注：用块作用域 `{}` 包裹 `case` 是 TypeScript/ESLint 对 `const` 在 `case` 中的
> 最佳实践，避免变量作用域泄漏到其他 `case`。

#### 编辑影响统计

| 维度 | 数值 |
|------|------|
| 修改文件数 | 1（`src/cli/index.ts`） |
| 删除行数 | 1 |
| 新增行数 | 3（含块作用域括号） |
| 净变化 | +2 行 |

---

### 2. `tests/integration/cli-coldstart.test.ts` — 新增测试文件

测试落点：`tests/integration/cli-coldstart.test.ts`

测试结构概览（三个 describe 块）：

```typescript
/**
 * F201 冷启动护栏测试
 *
 * 验证 spectra CLI 在 @sqlite.org/sqlite-wasm 不可解析时，
 * 与 KB 无关的命令（--version / --help / batch --mode graph-only 等）
 * 仍能正常启动并返回 exit 0。
 *
 * 技术方案：用 --import 注册 ESM resolve hook，把 @sqlite.org/sqlite-wasm
 * 的 resolve 请求强制抛 ERR_MODULE_NOT_FOUND，模拟"缺包"环境。
 *
 * skip 条件：dist/cli/index.js 不存在（需先 npm run build）。
 */
```

**describe 1：冷启动护栏（缺包模拟）**

- 对 `dist/cli/index.js` 以 `node --import <register-bootstrap> dist/cli/index.js <args>` 方式 spawn 子进程（register-bootstrap 机制见下节，**必须经 `module.register()` 安装 hook**）。
- 子用例 1a `--version`：断言 `exit code === 0` 且 stdout 匹配 `/spectra v\d+\.\d+\.\d+/`。
- 子用例 1b `--help`：断言 exit 0 + stdout 含 `scaffold-kb`。
- 子用例 1c `batch --mode graph-only`（**对齐验收：缺包下 batch 必须正常**）：在临时目录放 1 个最小 `.ts` 源文件，跑 `batch --mode graph-only --no-html --output-dir <tmp>`，断言 **stderr/stdout 不含** `@sqlite.org/sqlite-wasm` 与 `ERR_MODULE_NOT_FOUND`（冷启动未被 KB 依赖污染）；最小工程能建图时进一步断言 exit 0。该断言对退出码采用"必须无 sqlite-wasm 错误"为硬条件，避免因工程环境差异 flaky。

**describe 2：静态护栏（源码断言）**

- 读取 `src/cli/index.ts` 源码字符串。
- 断言：不含 `"import { runScaffoldKb } from './commands/scaffold-kb.js'"` 顶层静态 import 字面量。
- 断言：含 `"await import('./commands/scaffold-kb.js')"` 字符串（确保 dispatch 已改动态）。

**describe 3：scaffold-kb 功能回归守卫**

- skip 条件同上（`HAS_DIST` guard）。
- 直接调用 `node dist/cli/index.js scaffold-kb --help`（不注入 hook）。
- 断言：exit 0 且 stdout 含 `build`、`serve`、`query`、`ingest`（help text 覆盖全子命令）。

#### ESM Resolve Hook 文件（**关键：必须经 `module.register()` 安装**）

> ⚠️ Node ESM customization hook 的安装语义：`node --import <file>` 只是**预加载**该模块，**不会**把它导出的 `resolve`/`load` 当作 hook 使用。要让 hook 真正拦截解析，必须在一个经 `--import` 预加载的 bootstrap 模块里调用 `node:module` 的 `register()`（`--loader` 旧式 flag 在 Node 24 已弃用，且可能打印 ExperimentalWarning 污染输出，不采用）。因此采用 **bootstrap + hook 两文件**：

新建 `tests/fixtures/block-sqlite-wasm-hook.mjs`（hook 本体）：

```javascript
/**
 * Node ESM resolve hook — 把 @sqlite.org/sqlite-wasm 的解析强制失败，
 * 模拟"缺包"环境，无需实际 uninstall 该包。经 register() 安装后在 hooks 线程生效。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@sqlite.org/sqlite-wasm' || specifier.startsWith('@sqlite.org/sqlite-wasm/')) {
    const err = new Error(`Cannot find package '@sqlite.org/sqlite-wasm'`);
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return nextResolve(specifier, context);
}
```

新建 `tests/fixtures/block-sqlite-wasm-register.mjs`（bootstrap，供 `--import` 用）：

```javascript
/**
 * 经 node --import 预加载：把上面的 resolve hook 注册进模块解析链。
 * 用法：node --import ./tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js <args>
 */
import { register } from 'node:module';
register('./block-sqlite-wasm-hook.mjs', import.meta.url);
```

> 实现期自检（防"测对了假象"）：实现后必须确认在**包实际存在**时该 hook 仍能让 `import('@sqlite.org/sqlite-wasm')` 抛 `ERR_MODULE_NOT_FOUND`（即 hook 真在拦截），否则测试会因本 worktree"自然缺包"而误绿。

---

## 回归风险评估

### 1. 动态 import 与静态 import 的运行时等价性

**结论：包存在时行为完全等价，无回归风险。**

- `await import('./commands/scaffold-kb.js')` 与静态 import 在 Node.js ESM 中加载同一模块，
  返回同一 module namespace 对象。
- `runScaffoldKb` 签名 `(command: CLICommand) => Promise<void>` 不变，调用方不感知。
- `switch case` 中 `scaffold-kb` 分支是排他路径，动态 import 仅在该分支执行，
  不影响 `generate` / `batch` 等其他命令的 module load 顺序。
- 与 `scaffold-kb.ts:188` 的 `await import('../../kb-mcp/index.js')` 是同族惰性先例，
  已在生产中验证无问题。

### 2. TypeScript 类型推导与 build 影响

**结论：无问题，tsc 可正确推导动态 import 类型。**

- `await import('./commands/scaffold-kb.js')` 的返回类型会被 tsc 推导为该模块的 namespace 类型，
  `runScaffoldKb` 的类型为 `(command: CLICommand) => Promise<void>`，与原类型一致。
- 若 tsc 严格模式下对动态 import 类型推导有任何 narrowing 问题，可加 `satisfies` 或显式类型注解，
  但预期不需要（此写法在仓库 scaffold-kb.ts:188 已有先例）。
- `npm run build` 不会新增 type error，dist 产物模块数与现有相同（动态 import 不影响 tsc 产物结构）。

### 3. 其他命令是否受影响

**结论：完全不受影响。**

`index.ts` 顶层 import 区段其余 17 个命令（`generate` / `batch` / `mcp-server` 等）的 import 形态
保持原状，其模块加载在 `main()` 执行前即已完成，行为与修复前一致。

### 风险等级

**LOW** — 影响文件仅 1 个，无跨包影响，无 API/契约变更，无数据迁移。

---

## 验证方案

### (a) 缺包冷启动护栏（核心验证）

| 步骤 | 命令 | 预期结果 |
|------|------|---------|
| 1 | `npm run build` | 成功，无 type error |
| 2 | `node --import tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js --version` | exit 0，stdout 含 `spectra v` |
| 3 | `node --import tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js --help` | exit 0，stdout 含 `scaffold-kb` |
| 4 | `node --import tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js batch --mode graph-only --no-html --output-dir <tmp>`（最小工程）| 输出不含 `@sqlite.org/sqlite-wasm` / `ERR_MODULE_NOT_FOUND` |
| 5 | 运行 `tests/integration/cli-coldstart.test.ts` 中 describe 1 | all pass |

### (b) 静态护栏（源码结构断言）

| 步骤 | 断言内容 | 预期 |
|------|---------|------|
| 读 `src/cli/index.ts` | 不含顶层静态 import scaffold-kb 字面量 | 通过 |
| 读 `src/cli/index.ts` | 含 `await import('./commands/scaffold-kb.js')` | 通过 |

### (c) scaffold-kb 功能回归

| 步骤 | 命令 | 预期结果 |
|------|------|---------|
| 1 | `node dist/cli/index.js scaffold-kb --help` | exit 0，含 `build` / `serve` / `query` / `ingest` |
| 2 | 运行现有 scaffold-kb 相关集成测试（`ingest-flow.test.ts`、`demo-kb-api-lookup.test.ts`、`spec-driver-kb-prequery.test.ts`） | 全部 pass，无回归 |

### (d) 全量验证（提交前必跑）

```bash
npm run build                    # 类型检查零 error
npx vitest run                   # 全量单元 + 集成测试零失败
npm run repo:check               # 仓库同步校验
```

---

## Codebase Reality Check

| 文件 | LOC | 与本次变更的关系 | 已知 debt |
|------|-----|----------------|---------|
| `src/cli/index.ts` | 223 | 直接修改（2 处） | 无相关 TODO/FIXME；file 规模正常 |
| `tests/integration/cli-coldstart.test.ts` | 0（新建） | 新增测试文件 | N/A |
| `tests/fixtures/block-sqlite-wasm-hook.mjs` | 0（新建） | 新增 resolve hook 本体 | N/A |
| `tests/fixtures/block-sqlite-wasm-register.mjs` | 0（新建） | 新增 register bootstrap（供 --import） | N/A |

前置清理规则检查：
- `src/cli/index.ts` 共 223 行，净新增 2 行，不触发 LOC > 500 规则。
- 无相关 TODO/FIXME 超过 3 个。
- 无代码重复超过 30 行。

**结论：不需要前置 cleanup task。**

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 1（`src/cli/index.ts`） |
| 新增文件数 | 3（测试文件 + hook 本体 + register bootstrap） |
| 间接受影响模块 | 0（其他命令 import 形态不变，scaffold-kb 子系统不变） |
| 跨包影响 | 无（仅 `src/cli/` 内单文件） |
| API / 契约变更 | 无（`runScaffoldKb` 签名不变，CLI 用法不变） |
| 数据迁移 | 无 |
| 风险等级 | **LOW** |

---

## 不做什么（Scope 边界）

本次修复**严格限定**在以下范围：

1. **不叠加方案 B**：不修改 `src/scaffold-kb/sqlite-engine.ts` 内部的 import 形态。方案 B 虽可作为纵深防御，但属未要求的额外改动，不在本次 scope。
2. **不改 package.json 依赖分类**：`@sqlite.org/sqlite-wasm` 从 `dependencies` 移到 `optionalDependencies` 是独立的分发决策（fix-report scope 外观察），不在本次处理。
3. **不动其他命令的 import 形态**：其余 17 个命令的顶层静态 import 全部保持原状，不做预防性惰性化。
4. **不改 help text / 文档**：`scaffold-kb` 子命令的用法说明不变。
5. **不新增功能**：本次只修复一个 eager import，零新增功能。

---

## 执行顺序

```
T1. 编辑 src/cli/index.ts（删 line 30 + 改 dispatch 分支为 await import）
T2. 新建 tests/fixtures/block-sqlite-wasm-hook.mjs（resolve hook 本体）
    + tests/fixtures/block-sqlite-wasm-register.mjs（register bootstrap）
T3. 新建 tests/integration/cli-coldstart.test.ts（describe 1/2/3，含 batch graph-only 子用例）
T4. npm run build（验证 type error 归零，且生成 dist/ 供集成测试 spawn）
T5. npx vitest run（验证零失败）
T6. 手工确认：node --import tests/fixtures/block-sqlite-wasm-register.mjs dist/cli/index.js --version → exit 0
```
