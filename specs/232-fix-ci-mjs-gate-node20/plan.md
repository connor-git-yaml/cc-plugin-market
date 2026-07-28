---
title: "fix CI 门禁失效（Node 20 glob 假门 + 缺 build 步骤）— 实现计划（链 A/B 阶段历史快照）"
feature: "232-fix-ci-mjs-gate-node20"
branch: "claude/mystifying-gagarin-5ca56b"
created: "2026-07-26"
updated: "2026-07-28"
status: "Superseded（历史阶段快照；最终口径以 fix-report.md + tasks.md 为准）"
---

# Implementation Plan: fix CI 双门禁失效（Node 20 glob 假门 + 缺 build 步骤）

**Branch**: `claude/mystifying-gagarin-5ca56b` | **Date**: 2026-07-26 | **Fix Report**: `specs/232-fix-ci-mjs-gate-node20/fix-report.md`
**Input**: `specs/232-fix-ci-mjs-gate-node20/fix-report.md`（方案 A，双根因链 5-Why、实测差分表已完整给出，本 plan 只做精确变更清单化，不重复推导）

> ## ⚠️ 本文档是**链 A/B 阶段的历史快照**，不是最终口径
>
> 保留原文是为了留存当时的推导过程（尤其枚举方案的双 Node 版本实测对比），
> 但下表列出的每一项都已在实施中被更正或超越。**任何执行 / 验收都以 `fix-report.md` + `tasks.md` 为准。**
>
> | # | 本文档写的（旧） | 最终状态（新） | 出处 |
> |---|---|---|---|
> | 1 | 根因是**两条链** A/B | 共 **六条链 A–F**：A(glob) / B(缺 build) / C(缺建图) / D(F176 `/r` 断言) / E(F220 浮点快照) / F(watch 测试查主机进程表) | fix-report「5-Why 根因追溯」 |
> | 2 | mjs gate 退出码 **126** | **exit 1**（126 是经 `volta run` + npm 包装层后的码，非 runner 本身的码；根因判断不受影响） | fix-report「两处事实口径更正」 |
> | 3 | mjs gate 规模 **19 文件 / 919 用例** | **13 文件 / 807 用例**（19/919 是本 worktree 混入 F231 未提交测试的工作区口径，非 master 事实、非验收值） | 同上 |
> | 4 | 约束"**零产品代码改动**" | **已放宽**：链 E 改 `src/panoramic/anchoring/edge-builder.ts`（出口量化 confidenceScore） | tasks.md T023 / Notes |
> | 5 | 约束"**零测试文件改动**" | **已放宽**：链 D 改 `tests/unit/feature-176-spike-and-gate.test.ts`、链 E 补 `tests/panoramic/anchoring/edge-builder.test.ts` 与外科式改 F220 `.snap`、链 F 改 `tests/integration/watch-command.test.ts` | tasks.md T022/T024/T025/T026 |
> | 6 | `ci.yml` 只新增 **1 步**（Build） | 新增 **2 步**：`Build` + `Build Knowledge Graph`（后者依赖前者产出的 `dist/cli/index.js`） | tasks.md T002 / T016 |
> | 7 | 变更面 **3 个文件** | **7 个已跟踪文件**（新增 `scripts/run-plugin-tests.mjs` + `package.json` + `ci.yml` + 上述 4 个测试/产品/快照文件） | fix-report「验证结果」 |
> | 8 | 枚举写法用 `readdirSync(root, { recursive: true, withFileTypes: true })` + `entry.parentPath ?? entry.path` | 改用 **`readdirSync(root, { recursive: true })`（不传 `withFileTypes`）**，直接得相对路径字符串数组，绕开 Dirent 字段跨版本改名 | tasks.md「枚举写法关键澄清」 |
> | 9 | 未涉及 | 链 F 的修法**不是**调大超时：根因是测试对主机进程表的真实 `pgrep` 查询；超时 5s→20s 仅作负载余量 | fix-report「链 F 修复」 |
>
> 下文正文一律保持撰写当时的原样（含已被更正的 126 / 19 / 919 等数字），不做逐处订正，
> 以免把"历史推导"和"最终结论"混成一份看不出版本的文档。

## Summary

fix-report 方案 A 的两处独立配置改动，均为**纯配置层收窄**，零对外契约变更：

- **链 A（Node 20 下 `node --test` glob 假门）**：`package.json` 的 `test:plugins` 脚本不再依赖 `node --test` 的 runner 内建 glob 展开（Node 21+ 能力），改为调用一个新增的极小枚举脚本 `scripts/run-plugin-tests.mjs`——用 Node 自身的 `fs.readdirSync(..., { recursive: true })` 递归枚举 `plugins/spec-driver/tests/**/*.test.mjs`，把展开后的文件列表交给 `node --test <files...>`。已实测：这是唯一在 Node 20 与 Node 24 上都能跑通（且都执行到全部 919 个用例）的方式；目录参数写法（`node --test <dir>`）被排除，因为它会把 Node 20 的假红翻转成 Node 24 的真红（Node 24 拒绝把目录当 test spec）。
- **链 B（CI 缺 build 步骤）**：`.github/workflows/ci.yml` 在既有 `Type Check` 步骤之后、`Test` 步骤之前，插入一个 `Build`（`npm run build`）步骤，使 43 个依赖 `dist/` 产物的测试文件在 CI 干净 checkout 下也能找到编译产物。

两处改动完全独立、无耦合，缺一则「恢复 CI 门禁」的目标不达成（只修链 A，Test 步骤仍会因 `dist` 缺失而红；只修链 B，mjs gate 步骤仍会在 Node 20 上 exit 126）。

## Technical Context

**Language/Version**：Node.js（CI 固定 20.x；本地 volta 20.20.2 + 系统 24.14.0 双版本验证，与 `engines` 声明的 `>=20.0.0` 一致）
**Primary Dependencies**：零新增。新增脚本只用 Node 内置模块（`node:fs`、`node:child_process`、`node:path`、`node:url`）
**Storage**：N/A
**Testing**：`node --test`（`plugins/spec-driver/tests/*.test.mjs`，19 个文件 / 919 用例，本次改动不修改任一测试文件本身）
**Target Platform**：GitHub Actions `ubuntu-latest`（CI）+ 本地开发环境（macOS/Linux，Node ≥20）
**Project Type**：single（仓库根 CI 配置 + npm script 修复，不涉及任何 plugin 内部产品逻辑）
**Performance Goals**：枚举脚本对 19 个文件的目录递归扫描是一次性 O(目录项数) 操作，量级远低于既有 `repo-check.mjs` 等治理脚本，无需性能优化
**Constraints**：
  - 零新增依赖（只用 Node 内置 API）
  - 不改任何测试文件、不改任何产品代码（`src/`、`plugins/*/scripts/lib/` 等）
  - `package.json` 仅改 `test:plugins` 一行；`ci.yml` 仅新增一个步骤；至多新增 1 个脚本文件
  - 不触碰 `.github/workflows/ci.yml` 现有 `Test Plugins (mjs gate)` 步骤的 `if: always()` 设计（该设计是 F201 Phase B 为规避 `npm test` 内部 `&&` 短路专门加的，本次改动使其"从未真正执行任何用例"的缺陷首次被修复，而非改变其存在意义）
**Scale/Scope**：2 个配置文件各一行/一步改动 + 1 个新增极小枚举脚本（预估 ≤ 40 行）

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| 双语文档规范 | 适用 | PASS | 正文中文，YAML/脚本标识符保留英文 |
| Spec-Driven Development | 适用 | PASS | fix 模式走 fix-report → plan → tasks → implement → verify |
| 如无必要勿增实体（YAGNI） | 适用 | PASS | 未引入 shell glob 解析库、未新增配置项；新枚举脚本是单一职责纯脚本（枚举 + 透传子进程退出码），无参数化、无抽象层；见下方"脚本落位决策"对"package.json 内联 `node -e`"备选方案的取舍论证 |
| 诚实标注不确定性 | 适用 | PASS | `engines` 字段 `>=20.0.0` 与 `readdirSync recursive` 实际要求 Node ≥20.1.0 之间的理论缝隙如实标注在"已知限界"，不表述为已消除 |
| 零运行时依赖（spec-driver 分区，本次改动不落在 spec-driver 内，仅作参照） | 不适用 | N/A | 本次改动是仓库根 `package.json`/`ci.yml`，不落在 `plugins/spec-driver/` 内；新增脚本落在仓库根 `scripts/`，遵循的是仓库根脚本惯例（零依赖同样成立，只是不受该原则辖域约束） |
| 质量门控不可绕过 | 适用 | PASS | 本次改动的目的正是让两个既有 CI 门禁真正生效，不引入新的绕过面 |
| 验证铁律 | 适用 | PASS | 验证方案要求双 Node 版本（20 + 24）各自实跑 `run-plugin-tests.mjs` / `npm run test:plugins` / `npm run build` / `npx vitest run`，附实际退出码与用例数，而非推测性声明 |
| 向后兼容 | 适用 | PASS | 见下方"回归风险评估"；本地 Node 24 与既有 `npm test` 语义均保持不变，唯一变化是 CI 新增一个必经步骤 |

**结论**：Constitution Check 通过，无 VIOLATION。

## Codebase Reality Check

| 文件 | 行数 | 本次改动 | 已知 debt |
|------|------|----------|-----------|
| `package.json` | 107 | `scripts.test:plugins` 一行：`node --test "plugins/spec-driver/tests/**/*.test.mjs"` → `node scripts/run-plugin-tests.mjs` | 无 TODO/FIXME；`scripts` 段落已有 60+ 条目，属既有规模，非本次引入 |
| `.github/workflows/ci.yml` | 37 | 在 L25（Type Check）与 L27（Test）之间新增一个 `Build` 步骤（约 3 行） | 无 debt 标记；既有 `Test Plugins (mjs gate)` 步骤的 `if: always()` 及其上方注释（L30-36）保持逐字不动 |
| `scripts/run-plugin-tests.mjs`（新增） | 预估 ≤ 40 | 新建文件：递归枚举 + 零文件 fail-loud + `spawnSync` 透传退出码 | N/A（新文件） |

**前置清理判定**：两个既有文件均远低于 500 行阈值（107 / 37），不触发 `[CLEANUP]` 前置任务；不存在与本次改动相关的 TODO/FIXME/HACK；不存在代码重复（新脚本是全新独立文件，不复制任何既有逻辑）。**结论：不新增 `[CLEANUP]` 前置任务**。

## Impact Assessment

- **直接修改文件**：2 个（`package.json`、`.github/workflows/ci.yml`）+ 1 个新增文件（`scripts/run-plugin-tests.mjs`）
- **间接受影响（调用方）**：
  - `npm test`（内部 `vitest run && npm run test:plugins`）——本地开发者与 CI 均经此入口，随 `test:plugins` 实现变化自动受益，调用方式本身不变
  - CI 的 `Test Plugins (mjs gate)` 独立步骤（`ci.yml` L34-36）——调用方式不变（仍是 `npm run test:plugins`），因 Root Cause A 修复而首次真正跑通
  - `npm run prepublishOnly`（内部含 `npx vitest run`，不含 `test:plugins`）——不受影响，未调用改动脚本
  - `npm run repo:check` / `npm run release:check` 等其他仓库根入口——已核实均不引用 `test:plugins`，无间接影响
- **跨包影响**：0（改动完全收敛在仓库根 `package.json` + `.github/workflows/` + 新增 `scripts/` 文件，不触碰 `plugins/*/`、`src/` 内部逻辑）
- **数据迁移**：无
- **API/契约变更**：无——不修改任何测试文件、任何产品代码、任何 CLI/MCP 对外接口；`test:plugins` 对外行为契约（"跑通全部 plugin mjs 测试并透传退出码"）不变，只是实现方式从"依赖 runner glob"改为"自行枚举"
- **风险等级判定**：影响文件 3（远低于 10）、跨包影响 0、无数据迁移、无公共契约变更 → **风险等级：LOW**
- **是否强制分阶段**：LOW 风险不触发强制分阶段；tasks.md 按"新增枚举脚本 → 改 package.json → 改 ci.yml → 双 Node 版本验证"顺序化任务流交付

## 改动清单（文件级）

### 1. 新增 `scripts/run-plugin-tests.mjs`

**脚本落位决策**：新建独立文件而非在 `package.json` 内联 `node -e "..."`。理由：
- 仓库惯例是 `scripts/` 下的一批单一职责小脚本（`repo-check.mjs`、`postbuild-stamp.mjs`、`sync-agent-docs.mjs` 等），`package.json` 的 `scripts` 段落里目前没有任何一条超过一行的内联逻辑——插入一段多行 `node -e` 会破坏这一惯例，且 `package.json` 里的 JS 逻辑不可读、不可独立调试（无法脱离 `npm run` 单独跑一行命令来复现 CI 失败）
- 独立文件可以在诊断/实施阶段被直接 `node scripts/run-plugin-tests.mjs` 调用（本次验证方案正依赖这一点：双 Node 版本各自单独跑一次，而不必每次都经过完整 `npm run test:plugins` 链路）
- 不违反 YAGNI：脚本只有一个职责（枚举 + 转交 + 透传退出码），不引入配置项、不做参数化、不支持 glob 之外的输入源

**实现细节（枚举 + 兼容处理 + 零文件 fail-loud）**：

```js
#!/usr/bin/env node
// 递归枚举 plugins/spec-driver/tests 下的 *.test.mjs 文件，交给 `node --test` 逐个文件执行。
// 背景（F232 fix-report）：`node --test "<glob>"` 的 glob 展开是 Node 21+ runner 能力，
// CI 固定 Node 20 会把 glob 模式当字面路径（exit 126）。改为「Node 自己递归枚举文件列表」后，
// Node 20 / Node 24 双版本均可跑通全部用例（已实测）。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const TESTS_ROOT = path.join(REPO_ROOT, 'plugins/spec-driver/tests');

function enumerateTestFiles(root) {
  // recursive: true 是 Node 20.1+ 能力（已知限界见 plan.md「已知限界」，engines 声明的
  // >=20.0.0 理论上比这更宽，本仓库不单独处理，见风险说明）。
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.test.mjs')) continue;
    // Dirent 的目录字段跨版本改名：Node 21.4+ 新增 parentPath（新名，推荐），
    // Node 20.x 只有 path（旧名）；Node 21+ 上 path 仍存在但已废弃。两者取其一兜底，
    // 缺一处理就会在某一 Node 主版本上枚举出 undefined/<name> 的坏路径——
    // 这正是本 fix 最容易重蹈"本地绿、CI 红"覆辙的点。
    const dir = entry.parentPath ?? entry.path;
    files.push(path.join(dir, entry.name));
  }
  return files.sort();
}

const testFiles = enumerateTestFiles(TESTS_ROOT);

if (testFiles.length === 0) {
  // 零文件不得静默 exit 0——否则未来测试目录被误挪/改名会让本门禁"悄悄通过"，
  // 正是本次要消灭的失效模式（对应 F201 mjs gate 从落地起就从未真正执行过任何用例）。
  console.error(
    `[run-plugin-tests] 未在 ${TESTS_ROOT} 下枚举到任何 *.test.mjs 文件，判定为失败（而非静默跳过）。`,
  );
  process.exit(1);
}

console.error(`[run-plugin-tests] 枚举到 ${testFiles.length} 个测试文件`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

### 2. `package.json`：改写 `scripts.test:plugins`

```diff
-    "test:plugins": "node --test \"plugins/spec-driver/tests/**/*.test.mjs\"",
+    "test:plugins": "node scripts/run-plugin-tests.mjs",
```

不改动 `scripts.test`（仍是 `vitest run && npm run test:plugins`，串联语义不变）、不改动 `engines` 字段（理由见"已知限界"）。

### 3. `.github/workflows/ci.yml`：在 Type Check 与 Test 之间插入 Build 步骤

```diff
       - name: Type Check
         run: npm run lint

+      - name: Build
+        run: npm run build
+
       - name: Test
         run: npm test
```

- **不加 `if: always()`**：`Build` 是普通顺序步骤，默认 `if: success()`（前序步骤成功才跑）。这与既有 `Test` 步骤的默认行为一致——若 `Type Check` 失败（`tsc --noEmit` 报类型错误），`Build`（同样跑 `tsc`）大概率也会失败，让流程按默认级联行为提前止损是合理的，不需要强制跑
- **不触碰既有 `Test Plugins (mjs gate)` 步骤**：该步骤保持 `if: always()` 与其上方注释逐字不动。`Build` 失败会级联跳过 `Test`，但 `Test Plugins (mjs gate)` 因 `always()` 仍会独立运行——这与其设计意图（"无论上一步成败都独立运行并报告"）完全兼容，且已确认 mjs 测试本身不依赖 `dist/`（`plugins/spec-driver/tests/*.test.mjs` 无任何文件引用 `dist/`）

## 回归风险评估

| 关注点 | 结论 | 理由 |
|---|---|---|
| 本地 Node 24 上 `npm run test:plugins` / `npm test` 行为是否改变 | **不改变（行为等价，实现方式变化）** | 递归枚举后的文件列表与原双星 glob 在当前仓库结构下枚举到的文件集合完全一致（19 个文件，均为 `plugins/spec-driver/tests/` 直接子文件，无嵌套子目录测试文件）；`node --test <files...>` 与 `node --test "<glob>"`（glob 展开后本质也是文件列表）在 Node 24 上行为等价 |
| `npm test` 的 `vitest run && npm run test:plugins` 串联语义是否变化 | **不变** | 只改了 `test:plugins` 内部实现，`&&` 短路语义、退出码透传方式（`spawnSync` 透传 `--test` 的原生退出码）均不变 |
| 是否影响 `npm run repo:check` / `npm run release:check` / `npm run prepublishOnly` 等其他入口 | **不影响** | 已逐一 grep 确认这些脚本均不调用 `test:plugins`（`prepublishOnly` 只调 `release:check` + `build` + `repo:check` + `npx vitest run`） |
| CI `Test` 步骤新增对 `Build` 的依赖是否引入新失败面 | **可接受的既有失败面前移，非新增** | `Test` 步骤本就因 `dist` 缺失而必红（Root Cause B）；插入 `Build` 步骤后，`dist` 缺失被消除，`Test` 步骤的失败面收窄为"真实测试失败"，而非"环境缺失产物"——这正是本次修复的目标，不是新增风险 |
| 新脚本对枚举结果的排序是否影响 `node --test` 的执行顺序/结果 | **不影响正确性** | `.sort()` 只保证枚举结果确定性（避免 `readdirSync recursive` 的目录遍历顺序在不同文件系统上不一致导致的输出顺序漂移），`node --test` 对多文件的执行本身不保证也不依赖特定顺序（各测试文件间无共享状态，已由既有 919 个用例全绿印证） |

## 验证方案

本次改动无产品逻辑可写常规单测（`node --test` / `vitest`），验证证据是**双 Node 版本各自实跑完整链路**并记录实际退出码与用例数：

| # | 命令 | Node 20（volta 20.20.2） | Node 24（系统 24.14.0） |
|---|------|------|------|
| 1 | `node scripts/run-plugin-tests.mjs`（脚本独立跑，绕开 npm 层） | 期望 exit 0，919 pass | 期望 exit 0，919 pass |
| 2 | `npm run test:plugins` | 期望 exit 0 | 期望 exit 0 |
| 3 | `npm run build` | 期望 exit 0，`dist/` 产出 | 期望 exit 0 |
| 4 | `npx vitest run`（build 之后跑，模拟 CI 新序列） | 期望现有基线通过率不变 | 期望现有基线通过率不变 |
| 5 | 零文件场景（临时指向空目录验证 fail-loud，不修改仓库真实测试目录） | 期望 exit 1 且有明确 stderr 提示 | 同左 |

**Node 20 调用方式**：直接用 volta 镜像二进制路径（如 `~/.volta/tools/image/node/20.20.2/bin/node`），避免 `volta run --node 20 -- sh -c '...'` 嵌套 shell 导致的 exit 127 干扰（该问题在诊断阶段已实测存在）。

**CI 端验证**：本地双版本验证通过后，推送分支触发一次真实 GitHub Actions 运行，确认 `Type Check` / `Build` / `Test` / `Test Plugins (mjs gate)` 四步全部 success（而非依赖本地模拟）。

## 已知限界（如实标注，不表述为已解决）

1. **`readdirSync recursive` 的 Node 版本下界与 `engines` 声明存在理论缝隙**：`recursive: true` 选项要求 Node ≥20.1.0，而 `package.json` 的 `engines.node` 声明是 `>=20.0.0`（理论上允许精确的 20.0.0）。实践中 GitHub Actions `setup-node@v4` 的 `node-version: 20` 解析为最新 20.x（远高于 20.1.0），本地 volta 固定版本也是 20.20.2，均不落在这条理论缝隙里。本次不修改 `engines` 字段（超出"最小变更"约束范围），如实标注为已知限界而非当作已消除。
2. **枚举脚本假设 `plugins/spec-driver/tests/` 下所有 `.test.mjs` 文件都应当被执行**：若未来该目录下出现故意排除在 CI 之外的 `.test.mjs`（当前不存在此类文件），需要额外排除规则时需重新评估，本次不预留排除机制（YAGNI）。
3. **CI 新增的 `Build` 步骤耗时**：`npm run build`（含 `prebuild`/`postbuild` 生命周期钩子）会给 CI 总时长带来增量，未在本次量化（不属"恢复 CI 门禁"这一修复目标的验收范围）。

## Project Structure

```text
scripts/
└── run-plugin-tests.mjs              # 新增：递归枚举 plugins/spec-driver/tests/**/*.test.mjs + 转交 node --test + 透传退出码
.github/workflows/
└── ci.yml                            # 改：Type Check 与 Test 之间新增 Build 步骤
package.json                          # 改：scripts.test:plugins 一行
specs/232-fix-ci-mjs-gate-node20/
├── fix-report.md                     # 已存在（前序制品）
└── plan.md                           # 本文件
```

**Structure Decision**：单项目结构，改动完全落在仓库根配置（`package.json`、`.github/workflows/ci.yml`）与新增的仓库根 `scripts/` 目录内，遵循既有 `scripts/*.mjs` 平铺组织惯例，不新增子目录分层、不触碰任何 `plugins/*/` 或 `src/` 内部代码。

## Complexity Tracking

> Constitution Check 无 VIOLATION，本节为空。
