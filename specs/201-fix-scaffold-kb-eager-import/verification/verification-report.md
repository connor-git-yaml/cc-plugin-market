# Verification Report: F201 — CLI 冷启动 sqlite-wasm 硬依赖修复

**特性分支**: `claude/infallible-euler-1ab491`
**验证日期**: 2026-06-20
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律) + Layer 1.75 (深度检查) + Layer 1.8 (残留扫描) + Layer 2 (原生工具链)

---

## Layer 1: Spec-Code Alignment

### 功能需求对齐（Task 级 checkbox 覆盖）

| Task | 描述 | checkbox | 文件/证据 | 状态 |
|------|------|----------|-----------|------|
| T001 | 删除顶层静态 `import { runScaffoldKb }` | [x] | `src/cli/index.ts` L1~30 区域无该 import | ✅ 已实现 |
| T002 | scaffold-kb 分支改 `await import(...)` 动态 | [x] | `src/cli/index.ts` L209~213：`case 'scaffold-kb': { const { runScaffoldKb } = await import('./commands/scaffold-kb.js'); ... }` | ✅ 已实现 |
| T003 | 新建 `tests/fixtures/block-sqlite-wasm-hook.mjs` | [x] | 文件存在；导出 resolve；sentinel `F201_HOOK_BLOCKED` 前缀 | ✅ 已实现 |
| T004 | 新建 `tests/fixtures/block-sqlite-wasm-register.mjs` | [x] | 文件存在；`register('./block-sqlite-wasm-hook.mjs', import.meta.url)` | ✅ 已实现 |
| T005 | describe 1 冷启动护栏（含 hook 自检 2 用例 + 1a/1b/1c） | [x] | `tests/integration/cli-coldstart.test.ts` L51~107 | ✅ 已实现 |
| T006 | describe 2 静态护栏（源码断言） | [x] | L109~119 | ✅ 已实现 |
| T007 | describe 3 scaffold-kb 动态 import 回归守卫 | [x] | L121~131（exit 1 + stderr 含用法） | ✅ 已实现 |
| T008 | `npm run build` 类型检查 | [x] | 见 Layer 2 Build 结果 | ✅ 已实现 |
| T009 | `npx vitest run` 全量测试 | [x] | 见 Layer 2 Test 结果 | ✅ 已实现 |
| T010 | `npm run repo:check` 仓库校验 | [x] | 见 Layer 2 Lint 结果 | ✅ 已实现 |

### 验收清单对齐

| 验收条件 | 状态 | 关键证据 |
|----------|------|---------|
| AC-1 缺包冷启动：describe1 hook 自检 + 1a/1b/1c | ✅ PASS | describe 1 共 5 用例全 pass（含 2 个 hook 自检） |
| AC-2 scaffold-kb 功能不回归：describe3 触达 runScaffoldKb 动态 import | ✅ PASS | `scaffold-kb build`（无参）exit 1 + stderr 含 `scaffold-kb build` |
| AC-3 唯一 eager 路径已切断：describe2 断言无顶层静态 import | ✅ PASS | 源码读取确认；describe 2 两个断言 pass |
| AC-4 新增/调整单测：cli-coldstart 8 用例 | ✅ PASS | 8/8 passed（1246ms） |

### 覆盖率摘要

- **总 Task 数**: 10
- **已完成**: 10
- **未完成**: 0
- **覆盖率**: 100%

---

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT

前序 implement 返回中包含有效验证证据（命令 + 退出码 + 输出）。当前验证报告基于本次直接执行的命令：

- `npx vitest run tests/integration/cli-coldstart.test.ts` — 8/8 passed，exit 0
- `npm run build` — exit 0，无 `error TS`
- `npx vitest run` — 4903/4903 passed，exit 0
- `npm run repo:check` — 所有 check pass，exit 0

**缺失验证类型**: 无
**检测到的推测性表述**: 无

---

## Layer 1.75: 深度检查

### 调用链完整性

scaffold-kb 动态 import 调用链完整：

```
src/cli/index.ts:main() → switch 'scaffold-kb' 分支
  → await import('./commands/scaffold-kb.js')   [惰性，仅执行到此分支时触发]
  → { runScaffoldKb } = ...
  → await runScaffoldKb(command)
```

**关键验证**：`--version` 和 `--help` 在 `switch` 之前 early return（L150-158），不会到达 scaffold-kb 分支，动态 import 不会被触发。`batch --mode graph-only` 走 `case 'batch'` 分支（L164-166），同样不触发 scaffold-kb import。调用链无断点。

### hook 自检稳健性

describe 1 新增 2 个 hook 自检用例（Codex quality-review 修订点）：
- 用例"hook 自检"：注入 hook 后 import sqlite-wasm → exit 0（sentinel `F201_HOOK_BLOCKED` 被捕获），证明 hook 确实在拦截
- 用例"反向自检"：不注入 hook → import sqlite-wasm → exit 0（包真实存在），证明不是自然缺包误绿

两项均通过，排除测试误绿。

### describe 3 假覆盖风险

原 Codex/spec-review/quality-review 三方命中的问题：describe 3 原版使用 `scaffold-kb --help` → exit 0，实际走全局 `if (command.help)` 路径，不进入 switch，不触达动态 import。

**当前实现**（已修订）：使用 `scaffold-kb build`（无必需参数）→ exit 1 + stderr 含 `scaffold-kb build`，动态 import 才真正被执行。exit 1 是关键鉴别证据：若走全局 help return 则为 exit 0；exit 1 证明进入了 switch→动态 import→runScaffoldKb。

实测：describe 3 用例 pass，exit 1 且 stderr 含 `scaffold-kb build`。

---

## Layer 1.8: 残留扫描

本次改动删除了 `src/cli/index.ts` 中的顶层静态 import：

```
grep -rn "import { runScaffoldKb } from './commands/scaffold-kb.js'" src/ tests/ plugins/
```
（无输出 — 无残留引用）

`src/cli/commands/scaffold-kb.ts` 本身存在，未被删除，只是调用方式从顶层 import 变为按需动态 import。无孤立文件、无残留引用。

**状态**: 无 RESIDUAL_FOUND

---

## Layer 1.9: 文档一致性检查

本次改动为内部实现变更（import 形态），不涉及公共接口变更、新增/删除模块，help text 及 scaffold-kb 用法文档未受影响。

**状态**: 无 DOC_DRIFT

---

## Layer 2: Native Toolchain

**检测到**: TypeScript/Node.js (npm)，特征文件 `package.json` + `package-lock.json`

### TypeScript/npm

| 验证项 | 命令 | 退出码 | 状态 | 关键输出 |
|--------|------|--------|------|---------|
| Build | `npm run build` | 0 | ✅ PASS | `prebuild→inline-d3 跳过；tsc 无 error；postbuild→stamp d17ff65e (dirty)` |
| Lint | `npm run repo:check` | 0 | ✅ PASS | `status=pass`，55 个 check 全部 pass |
| Test (focused) | `npx vitest run tests/integration/cli-coldstart.test.ts` | 0 | ✅ PASS | `8 passed (8) — 1246ms` |
| Test (full) | `npx vitest run` | 0 | ✅ PASS | `4903 passed | 18 skipped | 21 todo (4942) — 35.68s` |

### 全量测试详情

```
Test Files  424 passed | 4 skipped (428)
     Tests  4903 passed | 18 skipped | 21 todo (4942)
  Start at  01:45:52
  Duration  35.68s
```

**E2E 测试 SC-006 状态**: batch-concurrency.e2e.test.ts 全 4/4 通过（SC-006 `14021ms`），未触发墙钟 flaky。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100% (10/10 Task) |
| 验收清单 | ✅ PASS (4/4) |
| Build Status | ✅ PASS (exit 0，无 TS error) |
| Lint / Repo Check | ✅ PASS (55/55 checks) |
| Test (focused) | ✅ PASS (8/8 cli-coldstart) |
| Test (full) | ✅ PASS (4903/4903，0 fail) |
| 深度检查 | ✅ 调用链完整，hook 自检稳健，describe3 假覆盖已修订 |
| 残留扫描 | ✅ 无残留 |
| 文档一致性 | ✅ 无漂移 |
| 验证铁律 | ✅ COMPLIANT |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题

无。

### 最终结论

**可提交。** F201 修复（scaffold-kb 惰性 import + cli-coldstart 集成测试 + 双 hook fixture）全部验收通过，无回归，无残留，构建/测试/仓库校验均 exit 0。
