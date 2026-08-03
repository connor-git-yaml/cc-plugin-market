# 修复规划：symlink 入口守卫恒 false 静默假成功

**Feature**: 246-fix-symlink-entry-guard
**模式**: fix（快速问题修复）
**前序制品**: `specs/246-fix-symlink-entry-guard/fix-report.md`（含完整 5-Why + 实测 probe + 23 处影响面穷举，本规划直接采信，不重复扫描）

## 0. 修复范围一句话

23 处 `.mjs` 脚本的入口守卫把未 canonical 化的 `process.argv[1]` 与已 canonical 化的 `import.meta.url` 直接比较，在符号链接路径下恒 `false` → `main()` 永不执行 → exit 0 静默空转。修法：抽一个共享 `isInvokedDirectly()` helper（两侧各自 `realpathSync`，失败回退 `path.resolve`），23 处逐一替换为调用该 helper。

---

## 1. 共享 helper 设计

### 1.1 Canonical 实现

**路径**：`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（新建）

```js
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 判定当前模块是否被「直接执行」（而非被 import）。
 *
 * 语义（与 F241 graph-bootstrap-status.mjs 的已实证写法逐字对齐，probe 模式 D）：
 * - `process.argv[1]` 缺失（如被 REPL / 某些测试 runner 以 import 方式加载）→ false
 * - 两侧各自 `fs.realpathSync` canonical 化后比较；任一侧 realpath 失败
 *   （路径不存在 / 不可读，如测试用 mock 路径）→ 该侧回退 `path.resolve`（不抛错，
 *   守卫本身绝不能因为解析不了而中断调用方脚本）
 * - `moduleUrl` 恒传 `import.meta.url`（调用方职责，非本函数内部读取），
 *   便于被测试以任意 URL 注入
 *
 * @param {string} moduleUrl - 调用方模块的 `import.meta.url`
 * @returns {boolean}
 */
export function isInvokedDirectly(moduleUrl) {
  const invokedPath = process.argv[1];
  if (invokedPath === undefined) return false;

  const modulePath = fileURLToPath(moduleUrl);

  let canonicalInvoked;
  try {
    canonicalInvoked = fs.realpathSync(invokedPath);
  } catch {
    canonicalInvoked = path.resolve(invokedPath);
  }

  let canonicalModule;
  try {
    canonicalModule = fs.realpathSync(modulePath);
  } catch {
    canonicalModule = path.resolve(modulePath);
  }

  return canonicalInvoked === canonicalModule;
}
```

### 1.2 仓库根薄壳

**路径**：`scripts/lib/is-invoked-directly.mjs`（新建）

```js
export { isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/is-invoked-directly.mjs';
```

**约束（硬性，F241 T027a 教训）**：薄壳**只准 re-export，禁止复制实现**。

- **理由 1（防漂移）**：fix-report 5-Why 的根因链条本身就是"无共享 helper → 每个脚本各写一份 → 复制扩散 30+ 处"；薄壳如果内联复制一份实现，等于在仓库里同时维护两份同语义代码，未来任一方修 bug 而漏改另一方，重演本次事故的成因。F241 的 T027a 教训原话："两处各写一份 `path.resolve` 比对的历史结果是同一个符号链接 bug 在两边并存"。
- **理由 2（有先例）**：`scripts/lib/repo-maintenance-core.mjs` 已存在 `scripts → plugins/*/scripts` 方向的 import（`import { syncSpectraSkillMirrors } from '../../plugins/spectra/scripts/sync-skill-mirrors.mjs'` 等 20+ 处），本次薄壳沿用同一方向、同一模式，不引入新的跨目录耦合形态。
- **理由 3（方向不可逆）**：仅允许 `scripts/ → plugins/*/scripts/`，禁止反向（`plugins/*/scripts/ → scripts/`）——插件分发后 `plugins/spec-driver/` 会被安装到 `~/.claude/plugins/cache/...`，脱离仓库根 `scripts/` 目录，反向 import 在生产环境下路径不存在。

---

## 2. 23 处替换清单

统一改动形状：删除手写判定表达式 → 顶部加 `import { isInvokedDirectly } from '<相对路径>';` → 守卫条件替换为 `isInvokedDirectly(import.meta.url)`（原有中间变量名如 `isMain` / `isCliEntry` / `isDirectRun` 保留不变，只换右侧表达式，最小化 diff）。

### 2.1 scripts/ 下 15 处（import 路径统一为 `./lib/is-invoked-directly.mjs`，`scripts/lib/swebench-dataset-build.mjs` 除外用 `./is-invoked-directly.mjs`）

| 文件 | 行号 | 原判定式 | 改动备注 |
|------|------|----------|----------|
| scripts/baseline-collect.mjs | L887-889 | `const isCliEntry =\n  import.meta.url === \`file://${process.argv[1]}\` \|\|\n  import.meta.url === \`file://${path.resolve(process.argv[1])}\`;` | **双写法一个 `\|\|` 表达式，整体替换为单行** `const isCliEntry = isInvokedDirectly(import.meta.url);`，不得只改其中一行 |
| scripts/calibrate-glm-judge.mjs | L1231 | `const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;` | `__filename`（L76 `fileURLToPath(import.meta.url)`）仍被 L77 `__dirname` 使用，不删该声明 |
| scripts/eval-calibrate.mjs | L520 | `const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));` | — |
| scripts/eval-offline-rejudge.mjs | L476 | `if (import.meta.url === \`file://${process.argv[1]}\`) {` | if 语句形式，条件整体替换 |
| scripts/eval-pool-rerun.mjs | L448 | `const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);` | — |
| scripts/eval-split-sets.mjs | L244 | `const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));` | — |
| scripts/eval-task-runner.mjs | L1083 | `const isCliEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));` | 原注释（L1081-1082 解释为何不用 endsWith）与新实现语义仍成立，保留注释 |
| scripts/eval-validate.mjs | L414 | `const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));` | — |
| scripts/freeze-preregistration.mjs | L122 | `const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);` | — |
| scripts/graph-accuracy.mjs | L626 | `if (import.meta.url === \`file://${process.argv[1]}\`) {` | if 语句形式 |
| scripts/lib/swebench-dataset-build.mjs | L113 | `if (import.meta.url === \`file://${process.argv[1]}\`) {` | if 语句形式；**同目录**import 路径为 `./is-invoked-directly.mjs`（无 `lib/` 前缀） |
| scripts/spec-drift-cli.mjs | L281 | `if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {` | **连带清理**：`pathToFileURL` 仅本处使用（已核实 L14 import、全文件无其他引用），替换后删除该 import；原 L278-280 注释（解释为何不用手拼 file:// 字符串）内容已过时，一并删除或改写为"改用共享 helper（两侧 realpath canonical 化，同时兼容 Windows 盘符与 symlink）" |
| scripts/spike-cohort3-plugin-mcp.mjs | L360 | `const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);` | — |
| scripts/swe-bench-verified-cohort-batch.mjs | L590 | `const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);` | — |
| scripts/verify-feature-176.mjs | L205 | `const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);` | — |

### 2.2 plugins/spec-driver/scripts/ 下 8 处（import 路径统一为 `./lib/is-invoked-directly.mjs`）

全部 8 处判定式完全相同：`if (import.meta.url === \`file://${process.argv[1]}\`) {`，逐字替换为 `if (isInvokedDirectly(import.meta.url)) {`。

| 文件 | 行号 |
|------|------|
| generate-adoption-insights.mjs | L566 |
| generate-product-entity-catalog.mjs | L468 |
| generate-product-quality-reports.mjs | L9 |
| generate-product-scorecards.mjs | L9 |
| generate-project-context-suggestions.mjs | L605 |
| generate-workflow-registry.mjs | L12 |
| record-workflow-run.mjs | L403 |
| sync-merge-engine.mjs | L659 |

### 2.3 未列入替换但需核实的通用检查项

替换后逐文件确认 `path` / `fileURLToPath` 导入是否仍被文件内其他代码使用；除 §2.1 已标注的 `scripts/spec-drift-cli.mjs`（`pathToFileURL` 需删除）外，其余 22 处均在文件内还有其他用途（路径拼接、`__dirname` 派生等），不需要清理。此项作为 implement 阶段逐文件替换时的随手检查，不需要单独任务。

---

## 3. 回归风险评估

### 3.1 高风险面：20 处被 import 承重的调用方

fix-report 影响范围节已穷举：23 处目标脚本里有 20 处**同时**被其他模块 `import`（测试文件 / 跨脚本复用函数 / `scripts/lib/repo-maintenance-core.mjs` 的 sync 链）。这些调用方依赖入口守卫在"被 import 时"必须返回 `false`（否则 import 时会误触发 CLI 主逻辑，产生副作用或抛错）。

**为何 helper 保持该不变量**：被 import 场景下 `process.argv[1]` 是**上游进程**（test runner / 上游脚本自身）的入口路径，与"被 import 的这个模块文件路径"必然不同——不论是否 canonical 化，两条不同文件的 canonical 路径仍然不同。helper 只改变"同一文件在不同规范化程度下比较"的正确性，不改变"两个不同文件比较"的结果，因此对 20 处 import 调用方是**行为不变**的安全替换。

**验证方式**：红测试新增 helper 单元测试显式覆盖"import 场景"（见 §4.1 case 3），且 §5 全量验证要求 `plugins/spec-driver/tests/record-workflow-run.test.mjs` 等既有 20 处 import 依赖方的测试保持零失败——这是本次改动"未破坏被 import 承重语义"的直接回归证据，不需要为每个调用方单独新增用例。

### 3.2 `baseline-collect.mjs` 双写法陷阱

L888-889 是**一个 `||` 表达式的两行**，不是两个独立判定。已在 §2.1 明确标注"整体替换为单行"，防止 implement 阶段误判为两处独立改动、只改一行导致语法错误或残留死代码。

### 3.3 真实路径环境下的行为等价性

fix-report probe 已实测：真实路径下模式 A/B/E（旧写法）与模式 D（`realpathSync` 双侧，即 helper 采用的写法）结果一致（均为 `true`）。因此在当前 CI / 开发环境（无 symlink）下，23 处替换预期**零行为差异**——唯一变化是修复了 symlink 场景下的 false negative。这意味着：

- 现有全部单元测试（vitest + node --test）在真实路径下运行，预期继续全绿，不构成"预期回归"
- 唯一需要新增覆盖的是 symlink 场景（旧写法覆盖不到、新写法必须覆盖），即 §4.2 集成测试

### 3.4 不在本次改动范围内、但需在旁路确认不受影响

- `scripts/lib/graph-bootstrap-status.mjs`（L577-578，同源坏但显式排除，归 F241 收口，见 §6）
- 20 处 `endsWith` 判定与 9 处双侧 / 单侧 realpath 写法（fix-report 已定性 [安全]，本次不动，不重复评估）

---

## 4. 红测试方案

**测试文件**：`plugins/spec-driver/tests/is-invoked-directly.test.mjs`，走 `node --test`（经 `npm run test:plugins` 执行）。

**选型理由**：canonical 实现落在 `plugins/spec-driver/scripts/lib/`，插件目录下现有全部脚本级测试（`record-workflow-run.test.mjs`、`fix-compliance-core.test.mjs` 等）都走 `node --test` + `npm run test:plugins`，与 helper 的物理位置保持同一 test runner、同一验证入口，避免在 `tests/unit/` 引入对 `plugins/` 内部相对路径的跨目录依赖（vitest 项目根与插件目录分属不同 npm 脚本链路，混用会增加维护成本且与既有插件测试惯例不一致）。

### 4.1 Helper 单元语义（case 1-4）

1. **direct 场景**：mock `process.argv[1]` 为脚本自身真实路径 → `isInvokedDirectly(import.meta.url)` 返回 `true`
2. **imported 场景**：`process.argv[1]` 为另一个文件路径（模拟 test runner 自身入口）→ 返回 `false`
3. **`argv[1]` 缺失**：临时设 `process.argv[1] = undefined` → 返回 `false`（不抛错）
4. **realpath 失败回退**：`process.argv[1]` 指向一个不存在的路径（mkdtemp 目录里从未创建的文件名）→ 不抛错，走 `path.resolve` 回退分支，与 `moduleUrl` 侧的真实路径按词法比较（预期 `false`，因为词法路径不等于一个不存在文件的路径）

每个 case 测试前后需 `beforeEach`/`afterEach` 保存并恢复 `process.argv`，避免污染同进程内其他测试（node --test 默认同进程跑多文件）。

### 4.2 Symlink 集成测试（真正复现 + 修复本 bug 的核心证据）

- `fs.mkdtempSync` 建临时目录，`fs.symlinkSync` 建一个指向仓库根的符号链接子目录（对齐 F241 `graph-bootstrap-status-shim.test.mjs` 的设计模式：symlink 目录 + 实跑 + 副作用断言）
- 经**符号链接路径**（而非仓库真实路径）`spawnSync('node', [symlinkPath + '/plugins/spec-driver/scripts/record-workflow-run.mjs', ...])` 实跑，断言：
  - `.specify/runs/*.jsonl` 文件在 `--project-root` 指定的临时目录下**真实落盘**，且内容可解析为预期结构（`workflowId` / `runId` 等字段），而不是"文件不存在也算过"
  - `res.status === 0`（避免误把"exit 0 但零副作用"当作通过——**必须先断言文件存在/内容**，退出码只是辅助信号）
- 第二个代表性脚本：经符号链接路径实跑 `scripts/verify-feature-176.mjs --test-mode`，断言 stdout 至少包含 1 行可解析为 `{ step, ok, detail }` 的 JSON（该脚本无需外部 fixture 输入即可跑通到打印阶段，`--test-mode` 跳过 provenance 强依赖检查；不断言具体 PASS/FAIL 结果，只断言"main() 确实执行并产生了逐 step 输出"——这正是 bug 修复前后的可观测差异：修复前 symlink 路径下 stdout 为空、exit 0）
- 两个用例都必须在测试结束时清理临时目录（`afterEach` + `fs.rmSync({ recursive: true, force: true })`）

---

## 5. 验证方案

1. `npx vitest run` 全量零失败（确认未触碰 TS 侧测试，且 20 处 import 依赖方的既有覆盖不受影响）
2. `npm run test:plugins`（含新增 `is-invoked-directly.test.mjs` + 既有 `record-workflow-run.test.mjs` 等）零失败
3. `npm run build` 类型检查零错误（`.mjs` 脚本不在 tsc 编译范围内，此步骤主要确认改动未误触 TS 源码；本次改动预期不涉及 `src/**/*.ts`）
4. `npm run repo:check` 通过（确认插件侧脚本改动未破坏 sync 门禁；`scripts/lib/repo-maintenance-core.mjs` 等 import 8 处插件脚本的调用链在改动后仍正常加载）
5. 抽查 2-3 个已修脚本，手工建 symlink 后实跑确认有真实副作用（作为自动化测试之外的人工复核，覆盖自动化测试未选中的其余脚本，建议抽 `scripts/eval-split-sets.mjs`、`plugins/spec-driver/scripts/generate-workflow-registry.mjs`、`scripts/spec-drift-cli.mjs`——最后一个额外确认删除 `pathToFileURL` 导入后无编译期/运行期报错）

---

## 6. 明确不做

- **不动** `scripts/lib/graph-bootstrap-status.mjs`（L577-578）——同源坏，但并行 F241 分支已将其重写为薄壳 + canonical `isInvokedDirectly`，本树修改必然与 F241 合入冲突，归 F241 收口。F241 合入后可将其改为 import 本次的 helper 收敛为单一实现（followup，不阻塞本 fix）
- **不动** 20 处 `endsWith` 判定站点（fix-report 已定性 [安全]，用户已明确排除"写法统一"选项，语义偏松但非本 bug 范围）
- **不动** 9 处双侧 / 单侧 realpath 站点（[安全]，本次修法的对齐目标，不需要改）
- **不动** 2 处非入口守卫的 `argv` 命中（`scripts/graph-semantic-diff.mjs` L261-264、`plugins/spec-driver/tests/lib/import-closure-helper.mjs` L141）——业务参数解析，与入口判定无关
- **不升** release contract 版本（仓库惯例：版本升级随下次发布批量走）
- **不改** `specs/src.spec.md`、`specs/plugins.spec.md`（自动再生产物）
- **不做** spec.md 的完整用户故事/成功标准填充（fix 模式：问题上下文以 fix-report.md 为准，spec.md 保持模板占位，不强行填充无意义的 User Story）

## 附：本次规划阶段的工具使用反馈

- Spectra `impact` / `context` 工具对 `plugins/spec-driver/scripts/record-workflow-run.mjs` 及其导出符号均返回 `symbol-not-found`（`fuzzyMatches` 为空），推断当前知识图谱未索引仓库根 / 插件目录下的 `.mjs` 脚本文件（图谱聚焦 `src/**/*.ts`），graph-not-built 之外的又一种"图谱覆盖面缺口"信号。本次改动全部落在 `.mjs` 脚本，MCP 工具当前对该类改动的影响面分析不可用，退回 Grep 精确行号定位 + 手工核实 import 闭包（fix-report 诊断阶段已做过一轮，本规划阶段做的是针对不确定点——如 `pathToFileURL`/`__filename` 是否孤儿导入——的定点复核）。建议后续若要覆盖脚本类 `.mjs` 文件的 caller 分析，需要评估 Spectra 索引范围是否扩展到 `scripts/` / `plugins/*/scripts/`。
