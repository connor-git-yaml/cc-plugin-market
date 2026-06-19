---
feature_id: "201"
title: "fix scaffold-kb eager import — CLI 冷启动 sqlite-wasm 硬依赖修复"
mode: fix
status: ready
created: "2026-06-20"
---

# Tasks: F201 CLI 冷启动 sqlite-wasm 硬依赖修复

**前序制品**: `specs/201-fix-scaffold-kb-eager-import/fix-report.md` + `plan.md`
**变更范围**: 1 个源文件（两处编辑）+ 3 个新增文件（2 个 fixture + 1 个集成测试）

## 不做清单（Scope 边界）

- 不叠加方案 B（不改 `src/scaffold-kb/sqlite-engine.ts` 内部 import 形态）
- 不改 `package.json` 依赖分类（sqlite-wasm 留在 dependencies）
- 不动其他 17 个命令的 import 形态（不做预防性惰性化）
- 不改 help text / 文档（scaffold-kb 用法说明不变）
- 不新增功能

---

## Phase 1: 源码修复

**目标**: 将 `src/cli/index.ts` 中 scaffold-kb 的静态 import 改为惰性动态 import，消除冷启动对 `@sqlite.org/sqlite-wasm` 的硬依赖。

- [x] T001 编辑 `src/cli/index.ts` 编辑 A：删除 line 30 的顶层静态 import 整行（`import { runScaffoldKb } from './commands/scaffold-kb.js'`），不保留残留注释
  - **目标文件**: `src/cli/index.ts`
  - **验收**: `grep -n "import { runScaffoldKb }" src/cli/index.ts` 返回零行；其余 17 个 import 语句不受影响

- [x] T002 编辑 `src/cli/index.ts` 编辑 B：将 `case 'scaffold-kb':` dispatch 分支改为块作用域 await import（依赖 T001 完成）
  - **目标文件**: `src/cli/index.ts`
  - **修改前**:
    ```typescript
    case 'scaffold-kb':
      await runScaffoldKb(command);
      break;
    ```
  - **修改后**:
    ```typescript
    case 'scaffold-kb': {
      const { runScaffoldKb } = await import('./commands/scaffold-kb.js');
      await runScaffoldKb(command);
      break;
    }
    ```
  - **验收**: `grep -n "await import('./commands/scaffold-kb.js')" src/cli/index.ts` 返回 1 行；`npm run build` 零 type error

**Checkpoint**: T001 + T002 完成后，`npm run build` 通过，dist 产物已生成。

---

## Phase 2: ESM Resolve Hook Fixture

**目标**: 新建两个 fixture 文件，构成"模拟缺包"的 Node ESM hook 机制。hook 必须经 `module.register()` 安装才能拦截解析（`--import` 直接加载导出 resolve 的文件不生效）。

- [x] T003 [P] 新建 `tests/fixtures/block-sqlite-wasm-hook.mjs`（hook 本体，导出 resolve 函数）
  - **目标文件**: `tests/fixtures/block-sqlite-wasm-hook.mjs`（新建）
  - **内容**: 导出 `async function resolve(specifier, context, nextResolve)`；当 specifier 为 `@sqlite.org/sqlite-wasm` 或以 `@sqlite.org/sqlite-wasm/` 开头时，抛出 `code: 'ERR_MODULE_NOT_FOUND'` 的 Error；否则 `return nextResolve(specifier, context)`
  - **验收**: 文件存在；`node --input-type=module --eval "import('./tests/fixtures/block-sqlite-wasm-hook.mjs').then(m => console.log(typeof m.resolve))"` 输出 `function`

- [x] T004 [P] 新建 `tests/fixtures/block-sqlite-wasm-register.mjs`（bootstrap，供 `--import` 使用）
  - **目标文件**: `tests/fixtures/block-sqlite-wasm-register.mjs`（新建）
  - **内容**: `import { register } from 'node:module'; register('./block-sqlite-wasm-hook.mjs', import.meta.url);`
  - **验收**: 文件存在；`node --import ./tests/fixtures/block-sqlite-wasm-register.mjs --input-type=module --eval "await import('@sqlite.org/sqlite-wasm')"` 抛 ERR_MODULE_NOT_FOUND（即使包实际存在也抛，证明 hook 真在拦截，排除"自然缺包误绿"）

**实现期自检（防误绿）**: 若本 worktree `@sqlite.org/sqlite-wasm` 已安装，T004 验收步骤必须确认 hook 能拦截已存在的包；若未安装，需在包安装后额外验证一次。

**Checkpoint**: T003 + T004 可并行，均完成后 Phase 3 可开始。

---

## Phase 3: 集成测试

**目标**: 新建 `tests/integration/cli-coldstart.test.ts`，覆盖三个 describe：缺包冷启动护栏、静态源码护栏、scaffold-kb 功能回归守卫。全文件使用 `HAS_DIST` guard 跳过（`dist/cli/index.js` 不存在时），与 `tests/integration/mcp-server-stdio.test.ts` 一致。

- [x] T005 新建 `tests/integration/cli-coldstart.test.ts` — describe 1：冷启动护栏（缺包模拟）（依赖 T003 + T004）
  - **目标文件**: `tests/integration/cli-coldstart.test.ts`（新建，后续 T006 追加内容）
  - **内容**: 文件头注释 + `HAS_DIST` guard 声明 + describe 1 实现：
    - 子用例 1a `--version`：`spawn node --import <register路径> dist/cli/index.js --version`，断言 exit 0 + stdout 匹配 `/spectra v\d+\.\d+\.\d+/`
    - 子用例 1b `--help`：断言 exit 0 + stdout 含 `scaffold-kb`
    - 子用例 1c `batch --mode graph-only`：在 `mkdtempSync` 临时目录放最小 `.ts` 源文件，跑 `batch --mode graph-only --no-html --output-dir <tmp>`，断言 stderr + stdout **不含** `@sqlite.org/sqlite-wasm` 也不含 `ERR_MODULE_NOT_FOUND`（该断言为硬条件；exit code 成功时额外断言 exit 0）
  - **验收**: `npx vitest run tests/integration/cli-coldstart.test.ts` describe 1 三个子用例全 pass

- [x] T006 追加 `tests/integration/cli-coldstart.test.ts` — describe 2：静态护栏（源码断言）（依赖 T001 + T002）
  - **目标文件**: `tests/integration/cli-coldstart.test.ts`（追加 describe 2）
  - **内容**:
    - 读取 `src/cli/index.ts` 源码字符串
    - 断言不含 `"import { runScaffoldKb } from './commands/scaffold-kb.js'"` 顶层静态 import 字面量
    - 断言含 `"await import('./commands/scaffold-kb.js')"` 字符串
  - **验收**: describe 2 无需 `HAS_DIST`，`npx vitest run tests/integration/cli-coldstart.test.ts` describe 2 两个断言全 pass

- [x] T007 追加 `tests/integration/cli-coldstart.test.ts` — describe 3：scaffold-kb 功能回归守卫（依赖 T001 + T002）
  - **目标文件**: `tests/integration/cli-coldstart.test.ts`（追加 describe 3）
  - **内容**:
    - `HAS_DIST` guard（同 describe 1）
    - `spawn node dist/cli/index.js scaffold-kb --help`（**不注入** hook）
    - 断言 exit 0 + stdout 含 `build`、`serve`、`query`、`ingest`
  - **验收**: describe 3 子用例 pass，确认 scaffold-kb 在正常环境下行为无回归

**Checkpoint**: T005 + T006 + T007 完成后，全文件三个 describe 均可独立验证。

---

## Phase 4: 全量验证

**目标**: 确保修复不引入回归，全量测试 + 仓库校验零失败。

- [x] T008 运行 `npm run build`，确认 TypeScript 类型检查零 error（依赖 T001 + T002）
  - **目标文件**: 无（构建验证步骤）
  - **验收**: 命令退出码 0；无 `error TS` 输出；`dist/cli/index.js` 存在

- [x] T009 运行 `npx vitest run`，确认全量测试零失败（依赖 T008）
  - **目标文件**: 无（测试验证步骤）
  - **验收**: 命令退出码 0；`cli-coldstart.test.ts` 三个 describe 全 pass；现有 `ingest-flow.test.ts`、`demo-kb-api-lookup.test.ts`、`spec-driver-kb-prequery.test.ts` 无回归

- [x] T010 运行 `npm run repo:check`，确认仓库同步校验通过（依赖 T009）
  - **目标文件**: 无（仓库校验步骤）
  - **验收**: 命令退出码 0；无 sync/contract 漂移告警

---

## 执行顺序与依赖关系

```
T001 → T002 → T008 → T009 → T010
T003 ─┐
      ├→ T005 ─┐
T004 ─┘        │
               ├→ T006 → T007 ─→（汇入 T009）
T001 + T002 ──→┘
```

**并行机会**:
- T003 和 T004 可并行（不同文件，无依赖）
- T005、T006、T007 依赖 fixture（T003/T004）和源码（T001/T002）就绪后可顺序追加同一文件
- T008（build）是 T009（vitest run）的前置，需串行

**推荐执行序**:
1. T001 + T002（源码修复）→ 手工验证 `npm run build` 通过
2. T003 + T004（并行，fixture）
3. T005 → T006 → T007（测试三 describe 顺序追加同文件）
4. T008 → T009 → T010（全量验证串行）

---

## 任务总览

| 任务 | 动作 | 目标文件 | 可并行 |
|------|------|---------|--------|
| T001 | 删顶层静态 import | `src/cli/index.ts` | 否 |
| T002 | 改 dispatch 为 await import | `src/cli/index.ts` | 否（依赖 T001） |
| T003 | 新建 resolve hook 本体 | `tests/fixtures/block-sqlite-wasm-hook.mjs` | [P] |
| T004 | 新建 register bootstrap | `tests/fixtures/block-sqlite-wasm-register.mjs` | [P] |
| T005 | 新建集成测试 describe 1（冷启动护栏） | `tests/integration/cli-coldstart.test.ts` | 否（依赖 T003+T004） |
| T006 | 追加集成测试 describe 2（静态护栏） | `tests/integration/cli-coldstart.test.ts` | 否（依赖 T005） |
| T007 | 追加集成测试 describe 3（回归守卫） | `tests/integration/cli-coldstart.test.ts` | 否（依赖 T006） |
| T008 | `npm run build` 类型检查 | — | 否（验证步骤） |
| T009 | `npx vitest run` 全量测试 | — | 否（验证步骤） |
| T010 | `npm run repo:check` 仓库校验 | — | 否（验证步骤） |

**合计**: 10 个任务；3 个可并行（T003/T004 + T008 之前可 T001/T002 并行启动 fixture）；新增文件 3 个，修改文件 1 个。
