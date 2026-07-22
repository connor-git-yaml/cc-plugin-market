# 修复规划: CLI 零认证硬门吞掉 AST-only 降级

**Feature**: `222-fix-cli-auth-hardgate` | **模式**: fix（快速问题修复）| **日期**: 2026-07-22
**基线 commit**: `23ffc8f`
**输入**: `specs/222-fix-cli-auth-hardgate/fix-report.md`（诊断已完成，根因与影响面已核实，本文档不重复论证方向，只给出落地方案）

## 1. Summary

`checkAuth()` 目前在 4 条命令（`generate` / `batch` 非 graph-only 路径 / `diff` / `watch`）的入口处充当"硬门"：零认证直接 `printError` + `exitCode=API_ERROR` 退出，导致下游 orchestrator 早已具备的 AST-only 静默降级分支永远不可达。

方案（用户已拍板，本 plan 不重新论证）：

1. 默认行为改为"提示 + 继续"——零认证时打印醒目降级提示，随后正常进入 orchestrator，由既有降级分支接管。
2. 新增 `--require-llm` 逃生口，供 CI 等需要严格失败语义的场景使用；`--require-llm` 下零认证仍硬退（复用 `checkAuth()` 现有致命提示）。
3. 4 条命令统一修，不留同源死角。

核心技术决策：**不修改 `checkAuth()` 本身**（它是纯谓词 + 致命提示，语义单一且已有稳定单测），而是新增一个薄编排层 `resolveAuthGate(requireLlm)` 复用 `checkAuth()`，把"要不要因为没认证而阻断"这个决策从 4 处重复的 if/return 收敛成 1 个共享函数。

## 2. Codebase Reality Check

| 文件 | LOC | 导出函数数 | TODO/FIXME | 结论 |
|------|-----|-----------|------------|------|
| `src/cli/utils/error-handler.ts` | 87 | 5 | 0 | 小文件，直接改，无需前置 cleanup |
| `src/cli/commands/generate.ts` | 61 | 1 | 0 | 同上 |
| `src/cli/commands/batch.ts` | 182 | 2 | 0 | 同上（graph-only 分支 L56-77 不动） |
| `src/cli/commands/diff.ts` | 63 | 1 | 0 | 同上 |
| `src/cli/commands/watch.ts` | 224 | 若干 | 0 | 同上（提示天然只在启动时打一次，见 §4.4） |
| `src/cli/utils/parse-args.ts` | 1152 | 1（`parseArgs`）+ helpers | 0 | 文件本身 >500 行，但本次每个 subcommand 分支只新增 1-2 行（4 处合计 <20 行），未触发"新增 >50 行"前置清理阈值，不需要 cleanup task |
| `src/cli/index.ts` | ~250（HELP_TEXT 区块） | — | 0 | 仅改帮助文本字符串，无逻辑改动 |

**前置清理判定**：均不满足"LOC>500 且新增>50 行"或">3 个相关 TODO"或"明显重复"的前置清理触发条件。**不需要 `[CLEANUP]` task。**

## 3. Impact Assessment

已用 `mcp__plugin_spectra_spectra__impact`（target: `error-handler.ts::checkAuth`, direction: upstream, depth: 3）核实：

```
directCallers: 4 (generate.ts::runGenerate, batch.ts::runBatchCommand, diff.ts::runDiff, watch.ts::runWatchCommand)
transitive: 4（无更深层调用方——checkAuth 只在这 4 处被引用，无第三方间接依赖）
riskTier(工具自评): medium
```

补充人工核实（工具 BFS 未覆盖测试文件与 parse-args 的类型面）：

- **直接修改文件**：`error-handler.ts`、`generate.ts`、`batch.ts`、`diff.ts`、`watch.ts`、`parse-args.ts`、`index.ts`（HELP_TEXT）= **7 个源文件**
- **间接受影响（需同步改测试 mock，否则会因 mock 缺失导出而运行时报错）**：`error-handler.test.ts`、`graph-only-cli.test.ts`、`batch-command-exit-code.test.ts`、`cli-command-runners.test.ts`、`watch-command.test.ts`（5 个测试文件全部 mock 了 `checkAuth`）+ `cli-e2e.test.ts`（仅改注释，非阻断）= **6 个测试文件**
- **跨包影响**：0 — 全部改动落在 `src/cli/**` 单一包内；`src/core/single-spec-orchestrator.ts`、`src/diff/semantic-diff.ts` 等下游降级实现**完全不动**（本次只是让它们变得可达）
- **数据迁移**：无 — 不涉及 schema、配置格式、状态文件格式变更
- **API / 契约变更**：**有一处需要显式确认** — 默认 CLI 退出码语义变化：零认证 + 未传 `--require-llm` 时，`generate`/`batch`/`diff`/`watch` 不再必然以 `exitCode=2` 退出，而是继续执行并按下游真实结果决定退出码（通常 `0`，除非下游另有失败）。这是本次修复的**预期效果**（对齐 `current-spec.md` L54/FR-007/L321 承诺），但外部若有 CI 脚本依赖"零认证必然 exit 2"这一（错误的）历史行为，需要改用 `--require-llm` 恢复旧语义。风险已通过新增 flag 缓解，非破坏性删除能力
- **风险等级判定**：影响文件数 13（<20）、跨包影响 0、无数据迁移、无破坏性移除 API（新增 flag，旧行为仍可通过 flag 找回）→ **MEDIUM**（未达 HIGH 阈值，不强制分阶段实现；但因涉及默认 CLI 行为对外可观察变化，仍要求单一原子提交内完成"代码改动 + 测试改写 + 帮助文本同步"，不允许拆成"先改代码后补文档"的提交序列）

## 4. 技术决策（逐项落地方案）

### 4.1 `checkAuth()` 改造方式 — 新增并列函数，不改签名

**决策**：`checkAuth(): boolean` **原样保留**（`error-handler.test.ts:34-49` 的两个用例零改动即可通过）。新增两个函数：

```ts
// src/cli/utils/error-handler.ts

/**
 * 打印 AST-only 降级提示（非致命，零认证默认路径使用）。
 * 与 checkAuth() 的致命提示区分：这里是"继续执行但降档"，不是"阻断"。
 */
export function printAstOnlyDowngradeNotice(): void {
  console.warn(
    '⚠ 未检测到可用的 LLM 认证方式，本次将降级为 AST-only 模式' +
      '（仅结构骨架，无 LLM 语义摘要，置信度标记为 low）。\n' +
      '  如需完整 LLM 增强，请配置以下任一方式后重新运行：\n' +
      '    1. export ANTHROPIC_API_KEY=your-key-here\n' +
      '    2. claude auth login\n' +
      '    3. codex login\n' +
      '  如需在缺少认证时强制失败（如 CI 场景），可添加 --require-llm 参数。',
  );
}

/**
 * 统一认证门控：决定命令是否可以继续执行。
 * - 有认证：放行，无副作用。
 * - 无认证 + requireLlm=false（默认）：打印降级提示后放行，交由下游 orchestrator
 *   的既有 AST-only 分支接管（single-spec-orchestrator.ts / semantic-diff.ts）。
 * - 无认证 + requireLlm=true：复用 checkAuth() 的致命提示，阻断执行（CI 逃生口）。
 */
export function resolveAuthGate(requireLlm: boolean): boolean {
  if (checkAuth()) {
    return true;
  }
  if (requireLlm) {
    // checkAuth() 已经打印了致命错误信息，这里不再重复打印
    return false;
  }
  printAstOnlyDowngradeNotice();
  return true;
}
```

**为什么不是"改 checkAuth 签名"（方案 B）**：`checkAuth()` 当前是一个纯粹的"探测 + 致命提示"谓词，被 `error-handler.test.ts` 直接单测其 true/false 两个分支且断言了 `printError` 副作用。若改签名（如加 `requireLlm` 参数）会让这个纯谓词承担"要不要阻断"的编排职责，职责耦合，且会破坏现有稳定单测的语义假设（false 分支目前恒定伴随致命提示，改造后 false 分支不再总是致命）。拆成 `checkAuth`（不变）+ `resolveAuthGate`（新增编排层）职责更清晰，符合仓库"简洁之道"约定里的单一职责原则，也是消除 4 处重复 if/return 的唯一落点。

### 4.2 4 条命令接入点 — 统一改为调用 `resolveAuthGate`，消除重复

4 处调用点从：

```ts
if (!checkAuth()) {
  process.exitCode = EXIT_CODES.API_ERROR;
  return;
}
```

改为（`generate.ts:39`、`diff.ts:37`、`watch.ts:91`、`batch.ts:78` 四处等价替换）：

```ts
if (!resolveAuthGate(command.requireLlm ?? false)) {
  process.exitCode = EXIT_CODES.API_ERROR;
  return;
}
```

- 调用点数量不变（仍是 4 处 1 行判断），但**决策逻辑本身只有一份实现**（在 `resolveAuthGate` 内），4 处调用点只是"读取结果 + 设置退出码"的 boilerplate，无法再收敛（`process.exitCode` 赋值是各命令模块级状态，无法上提为共享函数而不引入额外抽象——按 YAGNI 原则不做这层，3 行重复的 if/exitCode/return 优于过早封装）
- `batch.ts` 的 import 从 `checkAuth` 换成 `resolveAuthGate`；`generate.ts`/`diff.ts` 同理，且不再需要 `checkAuth` 具名导入（`resolveAuthGate` 内部自己调 `checkAuth`）
- graph-only 分支（`batch.ts:56-77`）**完全不动**——它在 `resolveAuthGate` 调用之前就 `return` 了，逻辑位置和注释保持原样

### 4.3 `--require-llm` 在 `parse-args.ts` 的接入方式

**CLICommand 类型扩展**（新增一个可选布尔字段，紧邻其他 subcommand 专属可选字段，如 `watchVerbose?`）：

```ts
/** Feature 222：CLI 零认证硬门降级为提示后，为需要严格失败语义的场景保留逃生口
 *  （generate / batch / diff / watch 四个命令消费；未传时默认 false，即"允许降级"） */
requireLlm?: boolean;
```

**解析方式**：布尔 flag，`argv.includes('--require-llm')`，**不需要**登记进 `extractPositionalArgs`（第 L1103 附近）的取值型 flag 白名单——该白名单只对"带值"flag（如 `--output-dir <dir>`）生效，纯布尔 flag 天然被 `startsWith('--')` 分支吞掉，不会被误当位置参数。

**4 个接入点**（均是在各自子命令解析分支里加一行 + 加入返回对象）：

1. `watch` 分支（约 L290-338）：`const requireLlm = argv.includes('--require-llm');`，加入返回的 `command` 对象
2. `generate`/`prepare` 共享分支（约 L883-908）：同样加一行并放入返回对象。**注意**：这个分支是 `generate` 和 `prepare` 共用的同一段 return 语句（`prepare` 从不调用认证门，不消费该字段）；为了不为了"精确到 prepare 不该有这个字段"而拆分共享分支（属于不必要的复杂度），选择让该字段对两个子命令都存在但 `prepare.ts` 永远不读取它，成本可忽略
3. `batch` 分支（约 L910-1065）：同样加一行，跟随 `dryRun`（L1006，纯 `argv.includes(...)`，不做 `|| undefined` 包装）的写法，保持风格一致，不采用 `hyperedgesEnabled`/`enableAdr` 那种 `|| undefined` 写法（无必要，`false` 与 `undefined` 对这个字段等价，没有下游区分二者的需求）
4. `diff` 分支（文件末尾约 L1067-1093）：同样加一行

**校验**：无需新增专门的"该 flag 仅在 xxx 子命令下有效"报错分支（对照 `--global`/`--remove`/`--target`/`--languages` 现有的强校验模式）——因为 `--require-llm` 在其余子命令下即使被传入也只是被静默忽略（`CLICommand.requireLlm` 字段不存在于其余子命令的返回对象里，属于 undefined，无副作用），与仓库里大多数布尔 flag（如 `--deep` 对非 generate/prepare 子命令）的现有宽松处理一致，不引入新的校验分支（YAGNI）。

### 4.4 watch 长驻进程的提示去重

**结论：不需要新增任何去重状态。** `runWatchCommand` 目前对 `checkAuth()`（未来 `resolveAuthGate()`）的调用**只在函数顶部执行一次**（`watch.ts:91`），发生在 `watcher.start()` 之前、文件变更回调 `handleChange` / `executeBatchLoop` 循环体之外。因此把调用点原地替换为 `resolveAuthGate` 后，提示天然只在进程启动时打印一次，不会随每次文件变更重复刷屏——这是现有代码结构自带的性质，不是需要额外实现的新需求。

### 4.5 batch 结束汇总的降级占比提示

**需要新增。** 核实 `batch-orchestrator.ts:851-853`：`result.degraded` 数组的入选条件是 `result.confidence === 'low' && result.warnings.some(w => w.includes('降级'))`——这与 `single-spec-orchestrator.ts:512-519` 的 AST-only 降级分支产出的 `warnings.push('LLM 不可用，已降级为 AST-only Spec')` 精确对应，即 `degraded.length` 本来就是"因降级（含零认证降级）而非完整 LLM 产出"的模块数。

`batch.ts:123` 已经在汇总行打印了 `降级: ${result.degraded.length}`，但只是数字，不够醒目也没有指引。在该行之后新增一段条件提示：

```ts
if (result.degraded.length > 0) {
  const pct = ((result.degraded.length / Math.max(result.totalModules, 1)) * 100).toFixed(0);
  console.warn(
    `⚠ ${result.degraded.length}/${result.totalModules} 个模块（${pct}%）因 LLM 不可用降级为 AST-only。` +
      '如需完整 LLM 增强，请配置认证后使用 --force 重新生成。',
  );
}
```

放置位置：紧跟在现有汇总 `console.log` 行（L123）之后，早于其余产物路径打印块，保证用户第一时间看到质量降档信号。

### 4.6 `tests/unit/graph-only-cli.test.ts:146` 回归断言改写方向

现状（必须删除/替换的断言）：

```
it('非 graph-only + checkAuth 失败 → API_ERROR（下移后认证仍生效，回归）', async () => {
  mocks.checkAuth.mockReturnValue(false);
  ...
  expect(process.exitCode).toBe(2); // EXIT_CODES.API_ERROR
});
```

改写方向（拆成 2 个用例，覆盖新语义的两条分支）：

1. **默认路径（新行为）**：`mocks.resolveAuthGate.mockReturnValue(true)`（模拟"无认证但 requireLlm=false，门控放行"）→ `runBatchCommand(fullCommand)` → 断言 `mocks.resolveAuthGate` 被以 `false`（即 `command.requireLlm ?? false`）调用、`mocks.runBatch` **被调用**（不再被阻断）、`process.exitCode` 反映 `runBatch` 的真实结果（用 mock 配置一个成功返回，断言 exitCode 为 0）
2. **`--require-llm` 逃生口（回归覆盖点前移）**：`mocks.resolveAuthGate.mockReturnValue(false)` + `fullCommand.requireLlm = true` → 断言 `resolveAuthGate` 被以 `true` 调用、`mocks.runBatch` **未被调用**、`process.exitCode === 2`（API_ERROR）

同时需要把该文件顶部的 mock 声明从 `checkAuth: mocks.checkAuth` 改为 `resolveAuthGate: mocks.resolveAuthGate`（`vi.hoisted` 对象里的 key 同步改名），因为 `batch.ts` 之后调用的是 `resolveAuthGate` 而非 `checkAuth`——如果不改，mock 模块里缺失 `resolveAuthGate` 具名导出，会在 `batch.ts` 里被解构为 `undefined`，调用时抛 `TypeError: resolveAuthGate is not a function`，测试会因运行时错误而非断言失败而红，掩盖真实问题。测试描述文字里 `不调用 checkAuth（零 LLM 无需认证，SC-003d）` 等用例也要相应把断言目标从 `mocks.checkAuth` 改成 `mocks.resolveAuthGate`（图 graph-only 路径不调用门控函数这条不变量本身不变，只是被检查的函数名变了）。

### 4.7 验证方案

**分层验证，优先单测层（mock `detectAuth` / `checkAuth` 边界），辅以一条真实隔离环境的 E2E**：

**A. 单测层（主力，快速确定性）**

- `tests/unit/error-handler.test.ts` 新增：
  - `resolveAuthGate(false)`：`detectAuth` mock 返回有认证 → `true`，未调用 `printAstOnlyDowngradeNotice`（可通过 spy 断言 `console.warn` 未被以降级文案调用）
  - `resolveAuthGate(false)`：`detectAuth` mock 返回无认证 → `true`，且 `console.warn` 被调用且内容含"AST-only"与"--require-llm"关键字
  - `resolveAuthGate(true)`：`detectAuth` mock 返回无认证 → `false`，且 `console.error` 被调用（复用 `checkAuth` 的致命提示，不应额外打印降级提示）
- `tests/unit/cli-command-runners.test.ts`（generate / diff 覆盖点，Why-5 盲区收口）新增：
  - `runGenerate`：`mocks.resolveAuthGate.mockReturnValue(true)`（模拟零认证降级放行）→ 断言 `mocks.generateSpec` **仍被调用**、`process.exitCode` 为 0（对齐 mock 的成功返回）
  - `runGenerate`：`mocks.resolveAuthGate.mockReturnValue(false)` → 断言 `mocks.generateSpec` **未被调用**、`process.exitCode === 2`
  - `runDiff` 同构 2 个用例
  - 顶部 mock 声明同步把 `checkAuth: mocks.checkAuth` 改为 `resolveAuthGate: mocks.resolveAuthGate`
- `tests/unit/graph-only-cli.test.ts`：按 §4.6 改写
- `tests/unit/batch-command-exit-code.test.ts`：mock key 同步改名（`checkAuth`→`resolveAuthGate`），行为不变（该文件测的是 budget/failed 场景，与认证门无关，只需保证 mock 不缺导出）
- `tests/integration/watch-command.test.ts`：模块级 mock 字面量新增 `resolveAuthGate: vi.fn().mockReturnValue(true)`（保留 `checkAuth` 的 mock 也可以，不影响，但 `watch.ts` 实际只消费 `resolveAuthGate`）

**B. 集成层（可选加固，1 条即可，非阻断）**

- `tests/integration/cli-e2e.test.ts`：现有 `generate 无 API Key` 用例已用宽松断言（`typeof result.exitCode).toBe('number')`）容纳"环境里可能有/可能没有 CLI 登录态"的不确定性，**保持该宽松写法不变**（真实隔离 HOME+PATH 环境的强断言依赖机器状态，容易在有 Claude/Codex CLI 登录的开发机上产生误报，不适合作为强断言纳入常规单测），仅更新过时注释（"checkAuth() 失败，exitCode 2"这条描述不再是唯一可能结果，改为说明"exitCode 2 仅在显式传 --require-llm 时出现"）
- 不新增额外的强隔离 env（HOME 指向空目录 + PATH 裁剪）E2E 测试用例到自动化套件——该场景已在 `fix-report.md` 里完成一次性人工实跑取证并归档，重复自动化的收益（防止未来回归）低于其带来的 CI 平台相关脆弱性（`which claude`/`which codex` 在不同 CI runner 上行为不保证一致）。若未来需要固化，应作为独立 Feature 补一个专用 fixture（不在本次 fix 范围内新增）

**C. 命令级验证（提交前必跑，来自运行时上下文 `required_command`）**

```bash
npm run lint
npm run build
npx vitest run
```

## 5. 变更清单（按文件）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/cli/utils/error-handler.ts` | 新增 | 新增 `printAstOnlyDowngradeNotice()`、`resolveAuthGate(requireLlm)`；`checkAuth()` 不变 |
| `src/cli/commands/generate.ts` | 修改 | `checkAuth()` → `resolveAuthGate(command.requireLlm ?? false)`；import 调整 |
| `src/cli/commands/batch.ts` | 修改 | 同上（graph-only 分支不动）；L123 汇总后新增降级占比提示（§4.5） |
| `src/cli/commands/diff.ts` | 修改 | 同 generate.ts |
| `src/cli/commands/watch.ts` | 修改 | 同 generate.ts（提示天然只打一次，见 §4.4，无需额外去重逻辑） |
| `src/cli/utils/parse-args.ts` | 修改 | `CLICommand.requireLlm?: boolean` 新增字段；4 个子命令分支各加 1 行解析 |
| `src/cli/index.ts` | 修改 | `HELP_TEXT`：4 条命令 usage 行加 `[--require-llm]`；选项说明区新增该 flag 一行；`generate`/`diff`/`watch` 子命令一句话描述里"（需要认证）"措辞按新语义调整（降级为"可选"表述） |
| `tests/unit/error-handler.test.ts` | 新增用例 | `resolveAuthGate` 三分支 + `printAstOnlyDowngradeNotice` 内容断言 |
| `tests/unit/cli-command-runners.test.ts` | 修改+新增 | mock key 改名；generate/diff 各加 2 个新用例（§4.7 A） |
| `tests/unit/graph-only-cli.test.ts` | 修改 | mock key 改名；L146 用例按 §4.6 拆成 2 条 |
| `tests/unit/batch-command-exit-code.test.ts` | 修改 | mock key 改名（无行为断言变化） |
| `tests/integration/watch-command.test.ts` | 修改 | 模块 mock 新增 `resolveAuthGate` 导出 |
| `tests/integration/cli-e2e.test.ts` | 修改（低优先级） | 更新过时注释，断言逻辑不变 |
| `specs/products/spectra/current-spec.md` | 修改（低优先级，可后置） | FR-GROUP-7 追加一行记录 `--require-llm` 语义（沿用文件内下一个可用 FR 编号，实现时现查，不在此处预先分配以免与并行 feature 撞号） |

## 6. Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | 通过 | plan 正文中文，标识符英文；新增代码注释按此规范用中文 |
| II. Spec-Driven Development | 适用 | 通过 | 走完整 fix 流程（fix-report → plan → tasks → implement → verify） |
| III. 如无必要勿增实体（YAGNI） | 适用 | 通过 | 未引入新抽象层/配置文件；只加 1 个共享函数收敛 4 处重复判断；未新增校验分支、未新增去重状态（watch 天然只调一次） |
| IV. 诚实标注不确定性 | 适用 | 通过 | Impact Assessment 里对"CI 脚本可能依赖旧退出码语义"的风险已显式标注并给出缓解（`--require-llm`） |
| V-VIII（spectra AST/流水线/只读/纯 Node 约束） | 不适用 | — | 本次改动为 CLI 参数编排层，不涉及 AST 提取、LLM prompt 结构或写入行为 |
| IX-XIV（spec-driver 约束） | 不适用 | — | 本次是 `plugins/spectra` 源码修复，非 spec-driver 编排层改动 |
| XIII. 向后兼容（"未配置新字段时行为必须与变更前一致"） | **适用，需说明豁免理由** | **有意偏离，理由充分** | 本条原则字面上要求"新增字段不配置时行为不变"，但本次的核心诉求恰恰是**修正默认行为**（零认证不再硬退）——这不是"新增一个可选功能"，而是修复一个与产品事实源（`current-spec.md` L54 / FR-007 / L321）矛盾的既有 bug。用户已在 GATE_DESIGN 前置环节明确拍板"默认改为提示+降级，`--require-llm` 才是需要显式选择的新字段"。`--require-llm` 本身完全遵守该原则：不传时行为等同"新的默认行为"，只有显式传入才改变语义。**豁免范围仅限于"零认证时的默认退出行为"这一处，不代表本条原则整体失效** |

**结论**：无未豁免的 VIOLATION，可以进入 tasks 阶段。

## 7. Rollback / 兼容性说明

- 若上线后发现有下游 CI 依赖"零认证必然 exit 2"的旧语义，缓解路径是在其调用处补一个 `--require-llm` flag，无需回滚代码（新增能力，非破坏性变更）
- 真正需要代码回滚场景：仅当 `resolveAuthGate` 本身有实现缺陷（如降级提示未打印、`--require-llm` 未生效）导致的功能性 bug，而非"默认行为变了"本身——后者是本次修复的设计目标

## 8. GATE_DESIGN 决议（编排器复核追加）

主编排器在 GATE_DESIGN 检查点对本 plan 逐条复核，以下为**对 §1-§7 的修正与补充，优先级高于上文**。

### 8.1 [CRITICAL] `--require-llm` 存在语义盲区，必须收口，不得 over-claim

**问题**：`LLMUnavailableError` 在 `llm-client.ts` 有 **4 个**抛出点，而非 plan 隐含假设的 1 个：

| 抛出点 | 触发场景 | 入口 `resolveAuthGate` 能否预判 |
|--------|---------|------------------------------|
| L253 | `detectAuth().preferred` 为空（整机零认证） | ✅ 能 |
| L382 | API 直连重试耗尽（网络不通 / key 失效 401） | ❌ **不能** |
| L437 | Claude CLI 代理重试耗尽（OAuth 过期 401 / CLI 崩溃） | ❌ **不能** |
| L491 | Codex CLI 代理重试耗尽（同上） | ❌ **不能** |

后三者是**运行期**失败：入口检查时认证方式确实存在（`detectAuth` 通过），实际调用时才失败，随后同样落入 `single-spec-orchestrator.ts:512` 的降级分支。因此**仅在入口做一次 `resolveAuthGate` 检查，无法兑现 `--require-llm` 承诺的"没有真正的 LLM 产出就失败"语义**——CI 传了该 flag，遇上 Claude CLI OAuth 过期时依然会静默降级并 `exit 0`。

该缺陷在本次改动前已存在（非本次引入），但本次是**首次对外提供 `--require-llm` 这个承诺**，若不收口即构成 over-claim，违反 Constitution 原则 IV（诚实标注不确定性）。

**决议**（按命令的技术可行性分层落地，已核实各命令返回面）：

- **`generate`**：`GenerateSpecResult` 暴露 `warnings: string[]` 与 `confidence`（`single-spec-orchestrator.ts:113-127`）。在 `runGenerate` 拿到 result 之后追加校验——`requireLlm && result.warnings.some(w => w.includes('降级为 AST-only'))` 为真时，打印致命提示并置 `exitCode = EXIT_CODES.API_ERROR`。**真正兑现语义**
- **`batch`**：`BatchResult.degraded` 语义已核实精确对应 LLM 降级（见 §8.3）。在汇总之后追加校验——`requireLlm && result.degraded.length > 0` 为真时，打印致命提示并置 `exitCode = EXIT_CODES.API_ERROR`。**真正兑现语义**
- **`diff`**：**技术上无法事后校验**——`semantic-diff.ts:99-102` 的 catch 是静默 `return null`，`DriftReport` 不保留任何"LLM 未跑"的痕迹。因此 `diff` 的 `--require-llm` 只能做到入口检查
- **`watch`**：长驻进程，退出码语义弱，同样只做入口检查

- **文档必须如实标注边界**：`HELP_TEXT` 中 `--require-llm` 的说明措辞定为「**缺少可用认证方式时直接失败，而非降级为 AST-only（`generate` / `batch` 额外校验产物是否真为 LLM 增强）**」。**禁止**使用"保证 LLM 一定被调用"这类绝对化措辞
- 让 `diff` / `watch` 也完整兑现该语义需要改造 `semantic-diff` 的静默 catch 并把 `requireLlm` 透传进 core，属跨包改动，超出本次 fix 范围 —— 作为 follow-up 候选记录在验证报告，不在本次实现

### 8.2 [INFO] §4.3 关于 `dryRun` 写法的描述有误，勿照抄

plan §4.3 称 `dryRun` 是「纯 `argv.includes(...)`，不做 `|| undefined` 包装」，实际 `parse-args.ts:1056` 写的是 `dryRun: dryRun || undefined`。

**决议**：`requireLlm` 的解析写法**以 plan 的结论为准**（`requireLlm: argv.includes('--require-llm')`，不做 `|| undefined` 包装）——理由仍然成立（`false` 与 `undefined` 对该字段等价，下游用 `?? false` 消费），只是不要把 `dryRun` 当作该写法的先例引用。

### 8.3 [已核实通过] `result.degraded` 语义精确，§4.5 论断成立

全仓 `warnings.push` 中含"降级"字样的共 3 处：`single-spec-orchestrator.ts:515`（AST-only 降级）、`panoramic/pipelines/docs-quality-evaluator.ts:295`、`kb-mcp/tools/kb-doc-lookup.ts:86`。后两处位于 panoramic / kb-mcp 独立管线，**不经过 `generateSpec` 返回路径**，因此 `batch-orchestrator.ts:851` 的模糊匹配在 batch 场景下不会误命中。§4.5 的降级占比提示文案准确（同时涵盖零认证降级与运行期 LLM 失败降级两种成因，措辞"因 LLM 不可用降级"对两者均成立）。

### 8.4 [WARNING] 仓内退出码消费方核查结果 — 有 2 处受影响，本次不改，记录为 follow-up

主编排器扫描了 `.github/` / `scripts/` / `package.json` / `plugins/` / `.claude/hooks/` 中调用 `spectra generate|batch|diff|watch` 的位置，核查是否有代码依赖"零认证必然非零退出"这一（即将改变的）行为：

| 位置 | 消费方式 | 受影响判定 |
|------|---------|-----------|
| `scripts/feature-170c-sc002-driver-eval.mjs:128` | `if (r.status !== 0) throw new Error('spectra batch failed: exit=...')` | ⚠️ **受影响** |
| `scripts/feature-170d-driver-preference.mjs:149` | 同上 | ⚠️ **受影响** |
| `scripts/eval-mcp-augmented-classic.mjs:236` | graceful degrade，batch 失败不阻塞 run（`graphMissing=true`） | ✅ 不受影响（本就容忍失败） |

**风险描述**：前两个评测脚本在零认证环境下，改动前会立即 throw 中止；改动后 batch 会降级产出一批 AST-only spec 并 `exit 0`，脚本继续跑完整个评测流程——**评测的是 AST-only 产物而非 LLM 产物，产生静默的错误评测结论**。

**本次不修的理由**：(1) 二者是评测脚本而非生产路径；(2) 评测流程本身还需要 driver（codex / claude CLI）的认证，`AGENTS.md`「评测凭据策略」已强制要求跑批前 preflight 验证认证可用，"零认证跑评测"在实际操作序列中不会发生；(3) 修改评测脚本超出本次 fix 的变更范围（违反"不写未要求的额外改动"约定）。

**处置**：不在本次实现内改动这两个脚本；在验证报告中列为 follow-up 候选（修法是给这两处的 `spectra batch` 调用补 `--require-llm`，恰是本次新增 flag 的目标用途）。

### 8.5 实现顺序约束（原）

§8.1 的事后校验逻辑与 §4.2 的入口门控是**同一个 flag 的两半**，必须在同一次实现中一并落地，不得只做入口检查就宣称 `--require-llm` 完成。

## 9. 三方对抗审查发现与处置（编排器裁决）

实现第一轮完成后，对最终代码跑了三路独立审查：**Codex 对抗审查**（外部模型，对 plan + 实现）、**spec-review**（合规面）、**quality-review**（质量面）。加上编排器自身的实跑复核，共四路。下表为汇总裁决，`[必修]` 项已进入第二轮实现。

### 9.1 编排器自查发现（实现第一轮后，已修复并验证）

| # | 严重度 | 问题 | 处置 |
|---|--------|------|------|
| E1 | CRITICAL | `resolveAuthGate` 复用带打印副作用的 `checkAuth()`，导致**成功的降级路径先吐一条 `✗ 错误`**，CI 日志会误判失败，且认证指引重复打印两遍 | 已修：抽出无副作用谓词 `hasAuth()`，`--require-llm` 分支自带精准文案，提取 `AUTH_SETUP_HINT` 共享常量。已实跑验证 `✗ 错误` 消失 |
| E2 | WARNING | `batch.ts` 的 `--require-llm` 事后校验插在 Feature 127 优先级判定之前并直接 `return`，静默破坏了 `failed > budget-cancel > success` 契约（该契约有注释与专门测试用例保护） | 已修：改为四级链 `failed > require-llm-degraded > budget-cancel > success`，提示无条件打印、退出码让位。已补 2 条优先级用例并做证伪验证 |

> E1、E2 均为「子代理自查发现不了」的类型：E1 要实跑看输出才暴露，E2 要读懂历史 Feature 留下的隐式契约才知道被破坏。

### 9.2 Codex 对抗审查（2 CRITICAL / 4 WARNING / 2 INFO）

| # | 严重度 | 问题 | 处置 |
|---|--------|------|------|
| C1 | CRITICAL | 同 E1（Codex 独立复现了同一问题，并确认 `hasAuth()` 修法正确、共享抽象本身不是 over-engineer） | 已修（见 E1） |
| C2 | CRITICAL | **`BatchResult.degraded` 有严重假阴性**：`batch-orchestrator.ts:799` root 分组**无条件** `successful.push`，从不检查 `confidence`/`warnings`（对照非 root 分支 `:851` 才做判定）；且未变化的 spec 直接进 `skipped`，增量判定只比 `skeletonHash` 不看降级状态 | **[必修]** root 假阴性已进第二轮修复（三处判定统一改用结构化 `llmDegraded` 字段）；**cache 假阴性本次不修**（需把 LLM 状态持久化进 cache 元数据，远超 fix 范围），改为**如实标注边界**于 HELP_TEXT / FR-077 / 代码注释 |
| W1 | WARNING | `--dry-run` 零认证收到虚假降级提示、`--dry-run --require-llm` 被无意义阻断（dry-run 在 `batch-orchestrator.ts:408` 就返回，根本不调 LLM）；`diff` 的降级提示文案（"AST-only spec / confidence low"）与其真实降级形态（跳过语义评估、仍出结构漂移报告，`DriftReport` 无 confidence 字段）不符 | **[必修]** dry-run 比照 graph-only 在门控前跳过；diff 改用命令专属的准确降级描述 |
| W2 | WARNING | plan §3 称"五个测试文件全部 mock 了 `checkAuth`"不准确：实为四个模块 mock（两个 partial factory、两个 complete factory）+ 一个直接单测（`error-handler.test.ts` mock 的是 `auth-detector` 而非 error-handler）。partial factory 不同步不会 TypeError 但会调真实认证逻辑，造成环境相关测试 | 已在实现中自然消解（实际改动已覆盖全部 6 个文件且 `printError` 导出已补齐）。**plan §3 措辞不精确一事如实记录于此**，不回溯改写 |
| W3 | WARNING | **零认证 E2E 盲区未真正关闭**（fix-report Why-5 的根因）：`cli-e2e.test.ts:13` 只清 API key，仍继承 HOME/PATH 与 CLI 登录态；断言仅 `typeof exitCode === 'number'`，任何行为都能通过。plan §4.7-B 当初以"机器相关脆弱性"为由拒绝固化该场景 | **[必修]** 采纳 Codex 方案固化：`process.execPath` 起子进程 + 空 HOME + 裁剪 PATH + 极小 fixture。该方案已由编排器实测可行（本次全部人工验证即用此法），**不依赖开发机登录态** |
| W4 | WARNING | **退出码消费方扫描漏了 baseline 路径**：`scripts/baselines/build-swe-l-graphs.sh:199` 与 `scripts/baseline-collect.mjs:439/804` 调真实 LLM batch，仅靠非零退出判失败；`.github/workflows/baseline-collect.yml` 允许 full 模式。secret 失效时 CLI 改为 AST-only exit 0，**baseline 被当作 LLM 结果收录** | **[必修]** 这是本次改动**引入的**回归风险（改动前靠 exit≠0 保护），且 baseline 是入库的跨版本 perf 锚点，污染后果长期且难察觉。给两处真实 LLM 调用补 `--require-llm`（dry-run 类调用不加）。§8.4 关于两个 F170 评测脚本的"不改"决议维持不变 |
| I1/I2 | INFO | 确认 plan 正确：watch 提示天然只打一次（gate 在监听循环外）；MCP / panoramic / query / export 无同类硬门（MCP handler 直调 core，本就能触达降级；panoramic 用 `isLLMAvailable` 返回 null 而非硬退） | 已核实通过，无需改动 |

### 9.3 quality-review（0 CRITICAL / 4 WARNING / 6 INFO，总评 GOOD）

| # | 严重度 | 问题 | 处置 |
|---|--------|------|------|
| Q1 | WARNING | `--require-llm` 判定靠**中文字符串子串匹配**（`w.includes('降级为 AST-only')`）与 orchestrator 字面量硬耦合，orchestrator 改一个字即**静默失效**，且现有测试自己 mock 该字面量属自证循环。而 orchestrator **早有** `llmDegraded` 布尔（`:465/:514/:655`）只是未暴露到 `GenerateSpecResult` | **[必修]** 给 `GenerateSpecResult` 加 `llmDegraded: boolean`，generate 事后校验 / batch root / batch 非 root **三处判定统一改用结构化字段**。与 C2 的 root 修复合并实施 |
| Q2 | WARNING | `--require-llm` 校验发生在**写盘之后**，AST-only 产物可能已覆盖更高质量的旧 spec，而错误文案让用户推断"什么都没动" | **[必修]** 文案如实补充产物已写盘的事实 |
| Q3 | WARNING | **`cli-e2e.test.ts:82` 会把降级产物写进 git 跟踪的 `specs/src.spec.md`** —— 该用例跑 `runCLI(['generate','src/'])` 未传 `--output-dir`。改动前零认证在门控处即退不落盘，改动后一路跑完必写降档内容 | **[必修]** 这是本次改动引入的回归，也正是本次工作区 602 行 `confidence: high→medium` 噪声的产生机制。补 `--output-dir` 指向临时目录根治 |
| Q4/Q5 | WARNING | parse-args 的 4 处 `requireLlm` 解析**零测试覆盖**（现有测试全部直接构造 `CLICommand` 绕过 `parseArgs`）；watch 是唯一无 `requireLlm` 透传断言的命令 | **[必修]** 补 parse-args 层用例（4 子命令 × 传/不传 + 位置参数不被吞）与 watch 透传断言 |
| Q6-Q11 | INFO | `printAstOnlyDowngradeNotice` 多余导出；降级占比提示文案"请配置认证"对运行期失败场景误导；`graph-only + --require-llm` 静默忽略（有 `--languages` warn 先例）；HELP_TEXT 行括号嵌套过长；`--incremental --require-llm` 无变更全跳过时 exit 0 | 交由实现方按价值取舍；其中 `--incremental` 那项判为**可接受语义**（本次没生成就没降级），由 C2 的边界标注一并覆盖 |

### 9.4 spec-review（0 CRITICAL / 0 WARNING / 4 INFO）

15/15 合规项全部落地，§8.1 两处 CRITICAL 事后校验确认真实实现而非只做入口检查，变更范围无溢出，`--require-llm` 的 HELP_TEXT 措辞与 §8.1 强制文案逐字一致、无 over-claim。

INFO 项：`checkAuth()` 成孤儿导出（**[必修]** 按"删除死代码"约定清理，其单测改写为覆盖等价语义）；`plugins/spectra/README.md:23`「只有 prepare 无需 API Key」措辞过时（**[必修]** 同步）；FR-077 对 diff 措辞略宽（不构成 over-claim，随 W1 的 diff 文案一并精确化）；`generate.ts` 显式置 SUCCESS（无害，不改）。

### 9.5 裁决要点

- **over-claim 零容忍**：C2 与 Q1 都指向同一件事——编排器在 §8.1 声称的「batch 真正兑现 `--require-llm` 语义」在 root 分组与增量 cache 两条路径上并不成立。处置原则是**能修的修（root）、修不动的如实标注（cache）**，绝不保留一句实现兑现不了的承诺
- **自己引入的风险必须自己收口**：W4（baseline 污染）与 Q3（e2e 写盘）都是本次改动**引入的**回归，不属于"额外优化"，必修
- **§8.4 的两个 F170 评测脚本维持不改**：它们有 `AGENTS.md` 评测凭据策略的 preflight 保护，与无人值守的 baseline 采集路径风险等级不同
