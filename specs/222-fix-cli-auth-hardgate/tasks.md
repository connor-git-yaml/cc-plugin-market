# 任务分解: CLI 零认证硬门吞掉 AST-only 降级

**Feature**: `222-fix-cli-auth-hardgate` | **模式**: fix（快速问题修复）
**输入**: `fix-report.md`（根因与实跑取证）、`plan.md`（技术方案，§8 GATE_DESIGN 决议优先级高于 §1-§7）

## 说明

- 本次是 fix 模式，任务粒度以"可独立验收的改动批次"为单位，不做 User Story 拆分
- 每个源码任务与其对应测试改动绑定在同一任务内，同批提交（仓库约定：新增功能 / 修复 bug 时对应单测须在同一提交）
- `[P]` 标记可与同层级其他任务并行执行（不同文件、无直接依赖）
- 涉及 `CLICommand.requireLlm` 类型字段的任务（T003/T004/T005）依赖 T006 先落地类型，否则编译报错；这三者之间可并行

## 任务清单

- [x] T001 全量核实 `checkAuth` mock 覆盖清单（不改代码，纯核查）
  - 操作：在 `tests/` 目录下执行 `grep -rn "checkAuth" tests/`，逐条核实覆盖面是否与 plan §3 列出的 5 个测试文件（`error-handler.test.ts`、`graph-only-cli.test.ts`、`batch-command-exit-code.test.ts`、`cli-command-runners.test.ts`、`watch-command.test.ts`）+ `cli-e2e.test.ts` 完全一致
  - 验收标准：产出一份核对结果（可直接写在本次提交的 PR 描述 / commit message 备注里），确认清单无遗漏；若发现清单外的第 7 个文件引用了 `checkAuth`，必须追加对应任务后再继续，不能默默跳过
  - 依赖：无，其余测试改动类任务（T002-T005）开工前必须先跑完本任务

- [x] T002 [P] `error-handler.ts` 新增 `resolveAuthGate` / `printAstOnlyDowngradeNotice` + 单测
  - 文件：`src/cli/utils/error-handler.ts`（新增，`checkAuth()` 本体不改）、`tests/unit/error-handler.test.ts`（新增用例）
  - 操作：按 plan §4.1 原样落地两个新导出函数；`checkAuth()` 保持签名和行为不变
  - 新增单测三分支（plan §4.7-A）：
    1. `resolveAuthGate(false)` + 有认证 → 返回 `true`，未打印降级提示
    2. `resolveAuthGate(false)` + 无认证 → 返回 `true`，`console.warn` 被调用且内容含 "AST-only" 与 "--require-llm" 关键字
    3. `resolveAuthGate(true)` + 无认证 → 返回 `false`，仅复用 `checkAuth()` 的致命提示（`console.error`），不额外打印降级提示
  - 验收标准：`npx vitest run tests/unit/error-handler.test.ts` 全绿；`checkAuth()` 原有两条用例零改动仍通过
  - 依赖：T001 完成

- [x] T003 [P] `generate.ts` + `diff.ts` 接入 `resolveAuthGate`（含 generate 的 `--require-llm` 事后校验）+ 对应单测
  - 文件：`src/cli/commands/generate.ts`、`src/cli/commands/diff.ts`、`tests/unit/cli-command-runners.test.ts`
  - 操作（generate.ts）：
    - 入口 `checkAuth()` → `resolveAuthGate(command.requireLlm ?? false)`（plan §4.2），import 去掉 `checkAuth`
    - 落地 §8.1 CRITICAL 事后校验：`generateSpec()` 返回后，若 `command.requireLlm && result.warnings.some(w => w.includes('降级为 AST-only'))`，打印致命提示并置 `process.exitCode = EXIT_CODES.API_ERROR`（不能只做入口检查就视为完成）
  - 操作（diff.ts）：
    - 入口 `checkAuth()` → `resolveAuthGate(command.requireLlm ?? false)`；**不做**事后校验（§8.1 已核实 `semantic-diff.ts` 静默 `return null`，技术上无法事后判定，属明确决议，不是遗漏）
  - 新增/改动单测（`cli-command-runners.test.ts`，plan §4.7-A）：
    - 顶部 mock 声明 `checkAuth` → `resolveAuthGate`
    - `runGenerate`：`resolveAuthGate` 返回 `true`（模拟零认证降级放行）→ `generateSpec` 仍被调用、`exitCode` 为 0
    - `runGenerate`：`resolveAuthGate` 返回 `false` → `generateSpec` 未被调用、`exitCode === 2`
    - `runGenerate`：`requireLlm=true` + `generateSpec` 返回结果含 "降级为 AST-only" 的 warning → 断言 `exitCode === 2`（覆盖新增的事后校验分支，避免只测入口）
    - `runDiff` 同构前两个用例（无需事后校验用例）
  - 验收标准：`npx vitest run tests/unit/cli-command-runners.test.ts` 全绿；手动检查 `diff.ts` 确认未引入 `result` 事后校验（避免过度实现超出 §8.1 决议范围）
  - 依赖：T001、T002、T006（`CLICommand.requireLlm` 类型字段需先存在，否则 `command.requireLlm` 编译报错）

- [x] T004 [P] `batch.ts` 接入 `resolveAuthGate` + `--require-llm` 事后校验 + 降级占比提示 + 对应单测
  - 文件：`src/cli/commands/batch.ts`、`tests/unit/batch-command-exit-code.test.ts`、`tests/unit/graph-only-cli.test.ts`
  - 操作（batch.ts）：
    - 非 graph-only 路径入口 `checkAuth()` → `resolveAuthGate(command.requireLlm ?? false)`；`graph-only` 分支（L56-77）**完全不动**
    - 落地 §8.1 CRITICAL 事后校验：汇总结果后，若 `command.requireLlm && result.degraded.length > 0`，打印致命提示并置 `exitCode = EXIT_CODES.API_ERROR`
    - 落地 §4.5 降级占比提示：紧跟现有汇总 `console.log`（约 L123）之后，`result.degraded.length > 0` 时打印占比 + 引导信息（按 plan §4.5 原文文案）
  - 测试改动（plan §4.6，`graph-only-cli.test.ts`）：
    - 顶部 mock 声明 `checkAuth` → `resolveAuthGate`（含所有引用 `mocks.checkAuth` 断言的用例同步改为 `mocks.resolveAuthGate`）
    - L146 原用例拆成 2 条：
      1. 默认路径：`resolveAuthGate` 返回 `true` → 断言以 `false` 被调用、`runBatch` 被调用、`exitCode` 反映 `runBatch` 真实结果（配 mock 成功返回，断言为 0）
      2. `--require-llm` 逃生口：`resolveAuthGate` 返回 `false` + `command.requireLlm = true` → 断言以 `true` 被调用、`runBatch` 未被调用、`exitCode === 2`
  - 测试改动（`batch-command-exit-code.test.ts`）：mock key 同步改名（`checkAuth` → `resolveAuthGate`），不改行为断言（该文件测 budget/failed 场景，与认证门无关）
  - 补充单测：`command.requireLlm = true` + `result.degraded.length > 0` 场景 → 断言 `exitCode === 2`（覆盖新增事后校验分支）
  - 验收标准：`npx vitest run tests/unit/batch-command-exit-code.test.ts tests/unit/graph-only-cli.test.ts` 全绿
  - 依赖：T001、T002、T006

- [x] T005 [P] `watch.ts` 接入 `resolveAuthGate`（仅入口检查）+ 对应测试
  - 文件：`src/cli/commands/watch.ts`、`tests/integration/watch-command.test.ts`
  - 操作：入口 `checkAuth()` → `resolveAuthGate(command.requireLlm ?? false)`；不新增任何提示去重逻辑（plan §4.4 已核实调用点天然只在启动时执行一次，无需额外状态）；不做事后校验（长驻进程退出码语义弱，§8.1 明确只做入口检查）
  - 测试改动：模块级 mock 字面量新增 `resolveAuthGate: vi.fn().mockReturnValue(true)`（可保留 `checkAuth` mock 不影响，但确保 `watch.ts` 实际消费的 `resolveAuthGate` 有导出，避免 `TypeError: resolveAuthGate is not a function`）
  - 验收标准：`npx vitest run tests/integration/watch-command.test.ts` 全绿
  - 依赖：T001、T002、T006

- [x] T006 `parse-args.ts` 新增 `CLICommand.requireLlm` 字段 + 4 处子命令解析分支
  - 文件：`src/cli/utils/parse-args.ts`
  - 操作（按 plan §4.3）：
    1. `CLICommand` 类型新增可选字段 `requireLlm?: boolean`（带中文注释说明 Feature 222 背景）
    2. `watch` 分支（约 L290-338）：新增 `const requireLlm = argv.includes('--require-llm');` 并加入返回对象
    3. `generate`/`prepare` 共享分支（约 L883-908）：同样新增一行并放入返回对象（`prepare.ts` 不消费该字段，成本可忽略，不拆分共享分支）
    4. `batch` 分支（约 L910-1065）：同样新增一行，写法为 `requireLlm: argv.includes('--require-llm')`（**不**做 `|| undefined` 包装，按 §8.2 决议以 plan 结论为准，不参照 `dryRun` 的实际写法）
    5. `diff` 分支（约 L1067-1093）：同样新增一行
  - 不新增任何 "该 flag 仅在 xxx 子命令下有效" 的强校验分支（YAGNI，与仓库现有大多数布尔 flag 的宽松处理一致）
  - 无需登记进 `extractPositionalArgs`（约 L1103）的取值型 flag 白名单（纯布尔 flag 不受影响）
  - 验收标准：`npm run build` 对 `parse-args.ts` 零类型错误；如已有 `tests/unit/parse-args*.test.ts`，跑一遍确认未破坏现有解析断言（不新增测试文件——本任务是纯类型/解析扩展，行为由 T003-T005 的调用方测试间接覆盖）
  - 依赖：T001

- [x] T007 [P] `index.ts` HELP_TEXT 同步 + 措辞按 §8.1 边界收口
  - 文件：`src/cli/index.ts`
  - 操作：
    - `generate` / `batch` / `diff` / `watch` 四条 usage 行追加 `[--require-llm]`
    - 选项说明区新增 `--require-llm` 一行，措辞**必须**为「缺少可用认证方式时直接失败，而非降级为 AST-only（`generate` / `batch` 额外校验产物是否真为 LLM 增强）」（§8.1 硬性要求，**禁止**出现"保证 LLM 一定被调用"等绝对化表述，因为 `diff`/`watch` 只做入口检查、且运行期 LLM 失败仍可能被 `generate`/`batch` 之外的路径漏判）
    - `generate`/`diff`/`watch` 子命令一句话描述里"（需要认证）"措辞降级为可选表述（如"可选 LLM 增强，无认证时自动降级为 AST-only"），与新默认行为对齐
  - 验收标准：目视核对 `spectra --help` 输出（或直接读文件确认文案），确认无 over-claim 措辞；无需新增单测（纯字符串常量，若已有 `HELP_TEXT` 快照测试则需同步更新快照）
  - 依赖：T006（需确认最终 flag 名称已定型）

- [x] T008 [P] `cli-e2e.test.ts` 过时注释更新（低优先级）
  - 文件：`tests/integration/cli-e2e.test.ts`
  - 操作：更新"generate 无 API Key"用例上下文中"checkAuth() 失败，exitCode 2"的过时注释，改为说明"exitCode 2 仅在显式传 `--require-llm` 时出现"；保持现有宽松断言（`typeof result.exitCode).toBe('number')`）不变，不新增强隔离 env 用例（plan §4.7-B 已决议不纳入自动化套件）
  - 验收标准：`npx vitest run tests/integration/cli-e2e.test.ts` 全绿（断言逻辑未变，理论上不受影响，仅确认改动未误伤）
  - 依赖：T003、T004（注释描述的 exitCode 语义需以最终实现为准）

- [x] T009 [P] `current-spec.md` FR-GROUP-7 追加 `--require-llm` 语义条目（低优先级，可后置）
  - 文件：`specs/products/spectra/current-spec.md`
  - 操作：在 FR-GROUP-7（约 L238 起）追加一条 FR，记录 `--require-llm` 的语义与边界（含 §8.1 的分层能力差异：generate/batch 有事后校验，diff/watch 仅入口检查）；**FR 编号必须实现时现查文件内当前最大编号 +1**（本次规划撰写时观测到的最大编号为 FR-076，但实现时可能已有并行 feature 占用，必须重新 `grep -c "^| FR-" current-spec.md` 后取号，不得直接套用 FR-077）
  - 验收标准：新条目格式与现有行一致（`| FR-0XX | 描述 | 关联编号 | 活跃 |`），不改动其余 FR 行
  - 依赖：T003、T004（描述内容需与最终实现的分层能力一致）

- [x] T010 收尾验证（阻塞性，必须最后执行）
  - 操作：依次执行
    ```bash
    npm run lint
    npm run build
    npx vitest run
    ```
  - 验收标准：三条命令全部零失败 / 零错误；若任一红，回到对应任务修复后重跑本任务，不允许带红提交
  - 依赖：T001-T009 全部完成

## 变更范围核对表（对齐主编排器易漏点清单）

| 易漏点 | 承载任务 |
|--------|---------|
| §8.1 `--require-llm` 事后校验（generate 校验 warnings、batch 校验 degraded.length） | T003（generate）、T004（batch） |
| diff / watch 仅做入口检查（技术原因见 §8.1，非遗漏） | T003（diff）、T005（watch）显式注明不做事后校验 |
| 5 个测试文件 mock 改名连锁风险 + 全量 grep 核实清单完整性 | T001（核实）→ T002/T003/T004/T005（改名落地） |
| `graph-only-cli.test.ts:146` 回归断言拆分（默认路径 + `--require-llm` 路径） | T004 |
| 零认证 E2E 盲区收口（generate / batch 至少各一条 mock 层面新增断言） | T003（generate 两条新用例）、T004（batch 事后校验用例） |
| HELP_TEXT 同步（usage 行 + 选项说明 + 措辞边界） | T007 |
| `current-spec.md` FR 追加（低优先级，编号实现时现查） | T009 |

## 依赖关系图

```
T001（mock 清单核实）
  ├─→ T002（error-handler 新函数）
  │     └─→ T003 [P]  generate + diff
  │     └─→ T004 [P]  batch
  │     └─→ T005 [P]  watch
  └─→ T006（parse-args 类型 + 解析）
        ├─→ T003 / T004 / T005（依赖 requireLlm 类型字段先存在）
        └─→ T007 [P]（HELP_TEXT，依赖 flag 名称定型）

T003, T004 完成后 → T008 [P]（cli-e2e 注释）、T009 [P]（spec FR 追加）

T001-T009 全部完成 → T010（lint + build + vitest，阻塞收尾）
```

## 并行执行建议

- T003 / T004 / T005 三者改动的源文件与测试文件互不重叠（`generate.ts`+`diff.ts`+`cli-command-runners.test.ts` / `batch.ts`+两个 batch 测试文件 / `watch.ts`+`watch-command.test.ts`），在 T001+T002+T006 完成后可完全并行
- T007 / T008 / T009 均为收尾性质，可在各自依赖满足后并行
- T010 是唯一的强制串行终点，不可提前执行
