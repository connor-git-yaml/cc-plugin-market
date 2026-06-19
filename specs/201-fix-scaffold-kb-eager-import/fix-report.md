# 问题修复报告 — F201 spectra CLI 冷启动对 @sqlite.org/sqlite-wasm 硬依赖

## 问题描述

spectra CLI 冷启动对 `@sqlite.org/sqlite-wasm` 产生硬依赖。`src/scaffold-kb/sqlite-engine.ts`（F190 KB 子系统引入）被 `src/cli/index.ts` 的启动 import 链 **eager（静态）** 引入，导致在未 `npm install` 该 WASM 包的环境下，连与 KB 无关的命令（`spectra --version` / `batch` / `generate`）都崩 `ERR_MODULE_NOT_FOUND: @sqlite.org/sqlite-wasm`。

### 实测复现（本 worktree，`@sqlite.org/sqlite-wasm` 实际未安装）

```
$ npx tsx src/cli/index.ts --version
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@sqlite.org/sqlite-wasm'
  imported from .../src/scaffold-kb/sqlite-engine.ts
  code: 'ERR_MODULE_NOT_FOUND'
```

崩溃发生在 **ES module 顶层 import 解析期**（`main()` 尚未执行），故 `--version` 这种最早 return 的路径也无法幸免。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `--version` 为何崩溃？ | Node 在 ES module 装载期解析 `@sqlite.org/sqlite-wasm` 失败，发生在 `main()` 执行前 |
| Why 2 | `--version` 为何要解析该 WASM 包？ | `src/cli/index.ts:30` 顶层静态 `import { runScaffoldKb } from './commands/scaffold-kb.js'`；该模块静态 import `buildKb`/`searchKbCore`/`loadKbContext`/`prepareIngest` → 传递触达 `sqlite-engine.ts:12` 的 `import '@sqlite.org/sqlite-wasm'` |
| Why 3 | scaffold-kb 为何在 CLI 入口被静态 import？ | F190 新增 scaffold-kb 命令时，沿用了 `index.ts` 既有的"18 个命令全部顶层静态 import"模式，未区分 scaffold-kb 携带重量级可选 WASM 依赖 |
| Why 4 | 该"全静态 import"模式为何未考虑可选依赖？ | 设计假设：所有命令模块装载轻量、依赖始终安装（对 AST/graph 流水线成立）。scaffold-kb 引入了一个不是每个环境都装、且无关命令都不需要的重 WASM 包，打破该假设 |
| Why 5 | 为何未被现有机制捕获？ | 无任何冷启动护栏测试在"KB WASM 包缺失"条件下跑 CLI 启动；CI `npm ci` 会安装全部 `dependencies`（含 sqlite-wasm），缺包路径从不被执行 —— 测试盲区 |

**Root Cause**：F190 把 `scaffold-kb` 接入 `index.ts` 的"全命令顶层静态 import"清单，使重量级 `@sqlite.org/sqlite-wasm` 依赖成为每次 CLI 冷启动模块图的一部分；缺该包时模块解析在任何命令逻辑执行前即失败。

**Root Cause Chain**：`spectra --version` 崩溃 → ESM 装载期解析 sqlite-wasm 失败 → `index.ts:30` 静态 import scaffold-kb 命令 → scaffold-kb.ts 静态 import KB 模块 → 传递触达 sqlite-engine.ts 顶层 `import '@sqlite.org/sqlite-wasm'` → F190 沿用全静态 import 模式未隔离可选重依赖 → 无缺包冷启动护栏测试。

## 影响范围扫描

### sqlite-engine.ts 的静态 fan-in（谁静态 import 它）

| 文件 | 导入符号 | 所属子系统 |
|------|---------|-----------|
| `src/kb-mcp/lib/kb-locator.ts:13` | `loadDbFromBytes` | kb-mcp |
| `src/kb-mcp/tools/kb-api-lookup.ts:17` | `queryRows` | kb-mcp |
| `src/scaffold-kb/sqlite-writer.ts:14` | `openMemoryDb, exportDb` | scaffold-kb |
| `src/scaffold-kb/search-core.ts:11,13` | `SqliteDb`(type), `queryRows` | scaffold-kb |
| `src/scaffold-kb/schema-compat.ts:13,14` | `SqliteDb`(type), `queryRows` | scaffold-kb |
| `src/scaffold-kb/ingest/ingest-core.ts:21` | `loadDbFromBytes, queryRows` | scaffold-kb |
| `src/scaffold-kb/recall-eval.ts:8,9` | `SqliteDb`(type), `queryRows` | scaffold-kb |

`@sqlite.org/sqlite-wasm` 的唯一直接 import 点：`src/scaffold-kb/sqlite-engine.ts:12`。

### CLI 入口（index.ts）eager import 触达 sqlite-engine 的路径

| CLI 命令 import | 是否触达 KB/sqlite | 结论 |
|----------------|-------------------|------|
| `scaffold-kb`（line 30 → scaffold-kb.ts）| **是**（buildKb/searchKbCore/loadKbContext/prepareIngest → sqlite-engine）| **[同源] 唯一需修复路径** |
| `mcp-server`（line 19 → `src/mcp/index.ts`）| 否（`src/mcp/` 零 kb-mcp/scaffold-kb 引用，已 grep 验证）| **[安全]** 主 MCP server 不触达 |
| `batch`（line 16 → `src/core/`）| 否（batch.ts + core/ 零 scaffold-kb/sqlite/@sqlite.org 引用，已 grep 验证）| **[安全]** graph-only 修复后即可用 |
| 其余 15 命令 | 否 | **[安全]** |

> 关键结论：CLI 入口进入 KB 子系统的 eager 路径**有且仅有一条** —— `scaffold-kb` 命令分支。`kb-mcp` 仅经 `scaffold-kb serve` 内已存在的 `await import('../../kb-mcp/index.js')`（scaffold-kb.ts:188）动态进入，不构成第二条 eager 入口。

### 同步更新清单

- **调用方**：仅 `src/cli/index.ts` 的 switch dispatch（line 210-211）。动态 import 返回同一 `runScaffoldKb`，签名与行为不变。
- **测试**：新增缺包冷启动护栏（功能性子进程测试，强制 sqlite-wasm 解析失败）；可选补静态护栏（断言 index.ts 不再顶层静态 import scaffold-kb）。
- **文档**：无需改（help text 不变；包存在时行为完全等价）。
- **类型定义**：无需改。

## 修复策略

### 方案 A（推荐）— CLI dispatch 分支动态 import

在 `src/cli/index.ts`：
1. 删除顶层 `import { runScaffoldKb } from './commands/scaffold-kb.js'`（line 30）。
2. `case 'scaffold-kb':` 改为 `const { runScaffoldKb } = await import('./commands/scaffold-kb.js'); await runScaffoldKb(command);`。

效果：整个 scaffold-kb 命令子树（含 buildKb / search-core / kb-locator / ingest-core / sqlite-engine / sqlite-wasm）变为惰性，无关命令装载**零 KB 模块**，真正达成"零 KB 依赖启动"。与 `scaffold-kb.ts:188` `startServe` 已有的 `await import` 惰性先例一致；与 F186 T5（CLI 层 ESM import 形态修复）同族（方向相反：本次静态→动态）。

### 方案 B（备选，不推荐）— sqlite-engine 内部惰性 import

把 `sqlite-engine.ts:12` 的 `import '@sqlite.org/sqlite-wasm'` 改为 `initSqlite()` 内 `await import(...)`。可消除崩溃，但 **scaffold-kb.ts 仍会在每次 CLI 启动 eager 装载整棵非 sqlite 的 KB 模块树**（ingester / chunk-splitter / entity-extractor / doc-graph-builder 等），未达成"零 KB 依赖启动"目标，且偏离用户处方。可作为纵深防御叠加，但不在本次 scope。

**采用方案 A。** 不叠加方案 B（遵循"不自行添加未要求改动"）。

## Spec 影响

- 无现存 spec.md 描述 CLI eager-import 契约（scaffold-kb 规范在 `specs/190`，本次为启动卫生修复）。
- **无需更新 spec**。lazy-load 不变量由 fix-report + plan + 新增护栏测试承载。

## Scope 外观察（仅记录，不在本次动手）

- `@sqlite.org/sqlite-wasm` 当前为硬 `dependencies`（package.json:71）。可考虑改 `optionalDependencies`，让普通安装不强制拉取 WASM（仅用 KB 时按需装）—— 属独立分发决策，不在本 fix scope。

## 范围检测

受影响源文件：1 个（`src/cli/index.ts`）+ 新增测试。涉及模块：1（CLI 入口）。**远低于** fix 模式阈值（>10 文件 / >3 模块），适合快速修复模式，无需升级 story/feature。
