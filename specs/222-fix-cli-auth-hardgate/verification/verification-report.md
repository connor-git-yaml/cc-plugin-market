# 验证报告: F222 CLI 零认证硬门降级

**Feature**: `222-fix-cli-auth-hardgate` | **模式**: fix | **阶段**: Phase 4c 工具链验证 + 验证证据核查
**日期**: 2026-07-22 | **基线 commit**: `23ffc8f`（全部改动未提交）
**验证者**: verify 子代理（只读；未做任何 git 写操作、未修改任何源码或测试）

---

## 0. 结论摘要

**最终结论：READY-FOR-DELIVERY**

- `npm run lint` **exit 0**
- `npm run build` **exit 0**
- `npx vitest run` **exit 1**，466/471 文件通过，5464/5512 用例通过；**唯一失败 = 9 个 f220 charter 快照，已逐条取证确认为日期滚动型预存 flaky（唯一差异行是 `2026/7/21` → `2026/7/22`），非本次回归**
- 10 项验收（A1-A10）**全部达成**，逐项证据见 §3
- 变更范围**无溢出**（§4）

---

## 1. Layer 2 — 原生工具链验证（真实输出）

### 1.1 `npm run lint`

```
$ npm run lint
> spectra-cli@4.3.0 lint
> tsc --noEmit

LINT_EXIT=0
```

无任何 TypeScript 诊断输出。

### 1.2 `npm run build`

```
$ npm run build
> spectra-cli@4.3.0 prebuild
> tsx scripts/inline-d3.ts
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入

> spectra-cli@4.3.0 build
> tsc

> spectra-cli@4.3.0 postbuild
> node scripts/postbuild-stamp.mjs
[postbuild:stamp] 盖章: commit=23ffc8f7 (dirty)

BUILD_EXIT=0
```

### 1.3 `npx vitest run`（全量）

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
 ❯ |e2e| tests/e2e/f220-decomposition-charter.e2e.test.ts (11 tests | 9 failed) 38957ms

  Snapshots  9 failed
 Test Files  1 failed | 466 passed | 4 skipped (471)
      Tests  9 failed | 5464 passed | 18 skipped | 21 todo (5512)
   Duration  45.24s

VITEST_EXIT=1
```

#### 失败归类取证（不接受"直接归因 flaky"）

对 Failed Tests 区段做 ANSI 剥离后，聚合**全部** diff 行：

```
$ sed -n '<failed-tests-section>' vitest.log | perl -pe 's/\e\[[0-9;]*m//g' | grep -E "^(\- |\+ )" | sort | uniq -c
   9 + > 由 spectra v4.3.0 自动生成 | 2026/7/22
   9 + Received
   9 - > 由 spectra v4.3.0 自动生成 | 2026/7/21
   9 - Expected
```

同时 `grep -cE "^@@"` = **9**，即 9 个失败各只有 **1 个 diff hunk**，且该 hunk 内**只有那一行日期字面量**不同（`+ Received` / `- Expected` 是 vitest 的 diff 表头，非内容行）。

**判定**：符合运行时上下文给出的核实标准 —— 唯一差异是 `2026/7/21` → `2026/7/22`，**无任何其他差异行**。归类为**日期快照滚动型预存 flaky，非本次回归**。快照基线是 F220 于 7/21 落库的，今天是 7/22。

#### 另外两类已知 flaky —— 本轮均未复现

| 文件 | 本轮结果 |
|------|---------|
| `tests/integration/watch-command.test.ts` | ✓ 7 tests passed (342ms) |
| `tests/panoramic/community-analysis.test.ts` | ✓ 4 tests passed (25183ms) |

**除上述 9 个日期快照外，全量测试零失败。未发现任何真实回归。**

---

## 2. Layer 1.5 — 验证铁律合规

**状态：COMPLIANT（由本子代理补跑，非引用上游声称）**

上一个 implement 子代理在跑全量测试前因 API 连接中断死亡，未留下验证证据。本阶段**从零重新实跑**了全部三条命令 + 两轮针对性隔离验证，上文与 §3 的所有输出均为本次真实执行所得，无任何推测性表述。

---

## 3. Layer 1 — 验收核查（A1-A10 逐项证据）

### A1 ✅ 4 条命令默认路径零认证可继续

| 命令 | 证据（文件:行） | 代码 |
|------|---------------|------|
| generate | `src/cli/commands/generate.ts:40` | `if (!resolveAuthGate(command.requireLlm ?? false)) {` |
| batch（非 graph-only） | `src/cli/commands/batch.ts:84` | `if (!command.dryRun && !resolveAuthGate(command.requireLlm ?? false)) {` |
| diff | `src/cli/commands/diff.ts:41-46` | `!resolveAuthGate(command.requireLlm ?? false, '本次将跳过 LLM 语义评估…')` |
| watch | `src/cli/commands/watch.ts:93` | `if (!resolveAuthGate(command.requireLlm ?? false)) {` |

全仓 `grep -rn "checkAuth" src/` **零命中** —— 旧硬门函数已按 spec-review INFO 建议整体删除，不存在遗留调用点。

实跑证据（隔离零认证环境，`tests/integration/cli-e2e.test.ts` 内置套件）：

```
✓ CLI 零认证隔离端到端测试 (Feature 222) > 默认路径：零认证时提示降级并继续执行，产出 spec 且退出码为 0
```

### A2 ✅ 降级提示不含致命错误

`src/cli/utils/error-handler.ts:74-90` 中，默认降级分支只走 `printDowngradeNotice()`（内部 `console.warn`，L55-61）；`printError` **仅出现在 `requireLlm` 分支**（L82）。`hasAuth()`（L39）是无副作用纯谓词，替代了原先带打印副作用的 `checkAuth()`，从结构上消除了 CRITICAL-1。

回归断言已落地 —— `tests/unit/error-handler.test.ts:57-61`：

```
// 回归防线：降级是成功路径，不得吐 `✗ 错误` 到 stderr（否则 CI 日志会误判失败）
...
expect(errorSpy).not.toHaveBeenCalled();
```

且 L67-68 反向覆盖 `--require-llm` 分支：`errorSpy` 被调用、`warnSpy` 未被调用（不重复打两遍指引）。

### A3 ✅ `--require-llm` 入口阻断

`resolveAuthGate` 的 `requireLlm=true` + 无认证分支返回 `false`（`error-handler.ts:81-87`），4 处调用点统一置 `EXIT_CODES.API_ERROR`（=2）并 `return`。

实跑证据：

```
✓ CLI 零认证隔离端到端测试 (Feature 222) > --require-llm：零认证时入口阻断，退出码为 2 且不产出 spec
```

### A4 ✅ `--require-llm` 事后校验用结构化字段，非字符串子串

`src/core/single-spec-orchestrator.ts:131` 新增 `llmDegraded: boolean` 到 `GenerateSpecResult`，L811 真实返回（内部真值源 L471 声明 / L520 置真）。

- `generate.ts:61`：`if (command.requireLlm && result.llmDegraded) {`
- `batch.ts:196`：`const requireLlmViolated = Boolean(command.requireLlm) && result.degraded.length > 0;`，而 `degraded` 的入选判定已改为结构化字段（见 A5）

全仓已无 `w.includes('降级为 AST-only')` 一类的中文子串判定。Q1 的静默失效路径已闭合。

### A5 ✅ batch root 与非 root 降级判定一致

`src/batch/batch-orchestrator.ts`：

- root 分支（L761 起）新增 `let rootLlmDegraded = false;`，逐文件 `if (result.llmDegraded) rootLlmDegraded = true;`（L780-782），收尾 L806-811 `if (rootLlmDegraded) { degraded.push(...) } else { successful.push(...) }` —— 原先的**无条件** `successful.push` 已消除
- 非 root 分支（L863）由 `result.confidence === 'low' && result.warnings.some(w => w.includes('降级'))` 改为 `if (result.llmDegraded)`

两分支**同源于同一个结构化字段**，判定一致。

回归测试 `tests/unit/batch-root-degraded.test.ts`（新增文件）3 条用例，本轮全量跑绿：

```
root 模块全部文件 LLM 降级 → 记入 degraded 而非 successful
root 模块仅部分文件降级 → 整模块仍记为 degraded（任一降级即降档）
root 模块无降级 → 仍记为 successful（不误报）
```

第 3 条是必要的证伪用例，防止把判定写成恒真。

### A6 ✅ 退出码优先级链未破坏 Feature 127 契约

`src/cli/commands/batch.ts:210-218`：

```ts
if (result.failed.length > 0)                          → TARGET_ERROR (1)
else if (requireLlmViolated)                           → API_ERROR (2)
else if (result.budgetDecision?.policy === 'cancel')   → BUDGET_EXCEEDED (3)
else                                                   → SUCCESS (0)
```

顺序为 `failed > require-llm-degraded > budget-cancel > success`，与要求逐字一致。`requireLlmViolated` 的**提示打印（L197-203）与退出码裁决（L212）已解耦** —— 提示无条件打，退出码让位给优先级链，因此不会像 E2 那样通过提前 `return` 静默吞掉 budget-cancel 语义。`tests/unit/batch-command-exit-code.test.ts` 本轮跑绿。

### A7 ✅ 零认证隔离 E2E 真实有效（Why-5 根因盲区闭合证据）

单独跑 `tests/integration/cli-e2e.test.ts` —— **11/11 通过，新增 3 条隔离用例全部真实执行（非 skip）**：

```
$ npx vitest run tests/integration/cli-e2e.test.ts --reporter=verbose
 ✓ CLI 端到端测试 > --version > 输出版本号并退出码为 0 213ms
 ✓ CLI 端到端测试 > --help > 输出帮助信息并退出码为 0 205ms
 ✓ CLI 端到端测试 > 无效子命令 > 输出错误信息并退出码为 1 212ms
 ✓ CLI 端到端测试 > generate 缺少 target > 输出错误并退出码为 1 205ms
 ✓ CLI 端到端测试 > generate 目标不存在 > 输出目标路径不存在并退出码为 1 197ms
 ✓ CLI 端到端测试 > generate 无 API Key > 根据环境认证状态输出相应结果 2381ms
 ✓ CLI 端到端测试 > 无参数 > 输出帮助信息 203ms
 ✓ CLI 端到端测试 > -v 短选项 > 输出版本号 200ms
 ✓ CLI 零认证隔离端到端测试 (Feature 222) > 前置条件：隔离环境里 claude / codex 均不可见（否则本套件断言无意义） 6ms
 ✓ CLI 零认证隔离端到端测试 (Feature 222) > 默认路径：零认证时提示降级并继续执行，产出 spec 且退出码为 0 253ms
 ✓ CLI 零认证隔离端到端测试 (Feature 222) > --require-llm：零认证时入口阻断，退出码为 2 且不产出 spec 222ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

**质量要点**：该套件自带「前置条件」守卫用例（断言隔离 env 下 `which claude; which codex` 输出为空），若隔离手段失效则该守卫先红，不会出现"隔离没生效但断言照过"的假绿。隔离手段为 `process.execPath` 起子进程 + 空 HOME + `PATH` 裁剪为 `<仅含 node 软链的目录>:/usr/bin:/bin`，**不依赖开发机登录态**。W3 已闭合。

**同时确认 Q3 已修**：原 `generate 无 API Key` 用例已补 `--output-dir` 指向 `mkdtemp` 临时目录并 `finally` 清理（`cli-e2e.test.ts:84-98`），不再把降级产物写进 git 跟踪的 `specs/src.spec.md`。

### A8 ✅ graph-only 未被波及

独立实跑（隔离零认证环境 + 临时 fixture 目录，未污染仓库）：

```
$ HOME=<空目录> PATH=<isobin:/usr/bin:/bin> node dist/cli/index.js batch . --mode graph-only
spectra v4.3.0 — 批量生成
  模式: graph-only（纯 AST · 零 LLM）
  节点: 2 | 边: 1 (calls 0, depends-on 0) | Python 符号: 0 | 耗时: 0.0s
✓ 知识图谱: /private/tmp/f222-a8-scoQ/specs/_meta/graph.json
GRAPHONLY_EXIT=0
```

加 `--require-llm` 时给出明确 warn 而非静默忽略（`batch.ts:63-65`，落实 Q6-Q11 的 INFO 建议）：

```
$ ... batch . --mode graph-only --require-llm
⚠ graph-only 不调用 LLM，--require-llm 对本次运行无效
  模式: graph-only（纯 AST · 零 LLM）
✓ 知识图谱: ...
```

graph-only 分支位于 `resolveAuthGate` 调用之前（`batch.ts:59-78` vs L84），逻辑位置未变。

### A9 ✅ 无 over-claim

`src/cli/index.ts:128-131` 的 HELP_TEXT：

```
--require-llm  仅 generate / batch / diff / watch：缺少可用认证方式时直接失败，而非降级。
               generate / batch 会额外校验本次产物是否真为 LLM 增强；diff / watch 只做入口检查。
               不覆盖增量 cache 命中的已有 spec（被记为 skipped，不参与降级判定），
               需要严格语义的 CI 请配合 --full / --force。
```

- 与 plan §8.1 强制文案语义一致，**无"保证 LLM 一定被调用"这类绝对化措辞**
- `diff` / `watch` 只做入口检查的边界**已显式标注**
- 增量 cache 不覆盖的边界**已显式标注**并给出规避手段
- dry-run / graph-only 边界：HELP_TEXT 未单列，但已在 `FR-077`（`specs/products/spectra/current-spec.md:248`）如实标注「`batch --dry-run` / `--mode graph-only` 属零 LLM 路径，该 flag 不适用」，且运行时 graph-only 有主动 warn（见 A8）。**不构成 over-claim**
- FR-077 措辞逐条核对：`diff` 降级形态描述为「跳过 LLM 语义评估，仍产出完整结构漂移报告」，与 `diff.ts:41-46` 的定制提示文案及 `semantic-diff` 实际行为一致（W1 的 diff 文案失实问题已修）
- 子命令描述从「（需要认证）」改为「（可选 LLM 增强，无认证时自动降级为 AST-only）」，`prepare` 从「无需 API Key」精确化为「纯 AST，从不调用 LLM」
- 代码注释侧同样标注：`batch.ts:190-195` 用 6 行注释如实写明增量 cache 假阴性路径「本次不修」及其成因

### A10 ✅ baseline 采集路径已保护，dry-run 未被误加

| 位置 | 调用性质 | `--require-llm` | 判定 |
|------|---------|----------------|------|
| `scripts/baselines/build-swe-l-graphs.sh:204` | 真实 LLM `batch --mode full` | ✅ 已加 | 正确 |
| `scripts/baselines/build-swe-l-graphs.sh:164` | `batch --mode full --dry-run --no-html`（预估门控，零 LLM） | ❌ 未加 | **正确**（不应加） |
| `scripts/baseline-collect.mjs:451`（`runBatchAndCapture`） | 真实 LLM batch | ✅ 已加 | 正确 |
| `scripts/baseline-collect.mjs:493`（`runDryRun`） | `batch --full --mode <m> --dry-run` | ❌ 未加 | **正确**（不应加） |

两处新增均带解释性中文注释说明为何需要严格失败语义。W4 已闭合。

---

## 4. 变更范围核查

`git diff HEAD --stat` + untracked：

```
 plugins/spectra/README.md                  |   4 +-      ← plan §9.4 spec-review INFO（措辞过时）
 scripts/baseline-collect.mjs               |   4 +        ← plan §9.2 W4
 scripts/baselines/build-swe-l-graphs.sh    |   6 +-       ← plan §9.2 W4
 specs/products/spectra/current-spec.md     |   1 +        ← plan §5 FR-077
 specs/src.spec.md                          | 602 ++---    ← ⚠ 再生噪声，见下
 src/batch/batch-orchestrator.ts            |  20 +-       ← plan §9.2 C2 + §9.3 Q1
 src/cli/commands/batch.ts                  |  52 ++-      ← plan §4.2/§4.5/§8.1/§9.1 E2/§9.2 W1
 src/cli/commands/diff.ts                   |  12 +-       ← plan §4.2 + §9.2 W1
 src/cli/commands/generate.ts               |  17 +-       ← plan §4.2 + §8.1
 src/cli/commands/watch.ts                  |   6 +-       ← plan §4.2
 src/cli/index.ts                           |  20 +-       ← plan §5 HELP_TEXT
 src/cli/utils/error-handler.ts             |  66 ++-      ← plan §4.1 + §9.1 E1
 src/cli/utils/parse-args.ts                |  10 +        ← plan §4.3
 src/core/single-spec-orchestrator.ts       |   7 +        ← plan §9.3 Q1（llmDegraded 暴露）
 tests/integration/cli-e2e.test.ts          | 116 ++-      ← plan §9.2 W3 + §9.3 Q3
 tests/integration/watch-command.test.ts    |  44 ++-      ← plan §4.7A + §9.3 Q5
 tests/unit/batch-command-exit-code.test.ts |  43 ++-      ← plan §4.7A + §9.1 E2
 tests/unit/cli-command-runners.test.ts     | 142 ++-      ← plan §4.7A
 tests/unit/error-handler.test.ts           |  48 ++-      ← plan §4.7A + §9.1 E1
 tests/unit/graph-only-cli.test.ts          |  69 ++-      ← plan §4.6
?? tests/unit/batch-root-degraded.test.ts                  ← plan §9.2 C2 回归覆盖（新增）
?? tests/unit/parse-args-require-llm.test.ts               ← plan §9.3 Q4 解析层覆盖（新增）
?? specs/222-fix-cli-auth-hardgate/                        ← 本 feature 制品目录
```

**范围判定：无溢出。** 每个文件均可回溯到 plan §5 变更清单或 §8/§9 的必修裁决。

### 4.1 §8.4 决议遵守情况 ✅

```
$ git diff HEAD --stat -- scripts/feature-170c-sc002-driver-eval.mjs scripts/feature-170d-driver-preference.mjs
(空输出)
```

两个 F170 评测脚本**未被改动**，符合 §8.4「维持不改」决议。

### 4.2 `specs/src.spec.md` 602 行改动定性 ⚠

**确认不含任何需要保留的本次有意改动，应在提交前还原。**

实测构成（与运行时上下文的简述略有出入，如实记录）：

- 主体是 `relatedFiles:` 列表新增条目 —— 反映 **F217（`src/panoramic/graph/quality/*`）/ F218 / F220（`src/batch/stages/*`）** 落库的新文件，与 F222 无关
- 大量 `<!-- baseline-skeleton: {...} -->` 内嵌 JSON blob 被重写（AST 骨架再生）
- frontmatter `confidence: high → medium` 仅 **1 处**（不是 602 行都是 confidence 变更）

```
$ git diff HEAD -U0 -- specs/src.spec.md | grep -cE "^\+.*confidence: medium"   → 1
$ git diff HEAD -U0 -- specs/src.spec.md | grep -cE "^-.*confidence: high"      → 1
```

这是测试跑批（`cli-e2e.test.ts` 旧写法）自动再生的**质量降档产物**，其产生机制正是 Q3 所指问题；Q3 修复后（补 `--output-dir`）新的跑批不会再产生此噪声，但**本次工作区里已有的这 602 行仍需还原**。符合仓库既有约定「并行 feature 须排除自动再生的 `specs/src.spec.md` 出 commit」。

> 注：本子代理受禁令约束**未执行任何 git 写操作**，还原动作留给编排器。

---

## 5. follow-up 候选清单

汇总 plan §8/§9 中本次**有意不修**的边界，供后续 Feature 立项：

| # | 来源 | 描述 | 建议处置 |
|---|------|------|---------|
| F1 | §8.1 / §9 C2 | **增量 cache 假阴性**：cache 命中的模块记为 `skipped` 不参与降级判定，`delta-regenerator` 仅比 `skeletonHash` 不看降级状态。「首次严格运行写下降级产物 exit 2 → 第二次同命令走增量 cache → exit 0」路径依然存在 | 需把 LLM 状态持久化进 cache 元数据 + 严格模式拒绝复用未证明为 LLM-enhanced 的缓存。已在 HELP_TEXT / FR-077 / `batch.ts:190-195` 三处如实标注，当前规避手段是配合 `--full` / `--force` |
| F2 | §8.1 | **`diff` 无法事后校验 `--require-llm`**：`semantic-diff.ts:99-102` 的 catch 静默 `return null`，`DriftReport` 不保留「LLM 未跑」痕迹 | 需改造 `semantic-diff` 的静默 catch 并把 `requireLlm` 透传进 core，属跨包改动 |
| F3 | §8.1 | **`watch` 只做入口检查**：长驻进程退出码语义弱 | 低优先级；若要兑现需设计长驻进程的降级上报通道 |
| F4 | §8.4 | `scripts/feature-170c-sc002-driver-eval.mjs:128` 与 `scripts/feature-170d-driver-preference.mjs:149` 依赖「零认证必然非零退出」，改动后零认证会静默跑完 AST-only 评测 | 修法即给这两处 `spectra batch` 调用补 `--require-llm`。本次不改，理由：二者是评测脚本、有 AGENTS.md 评测凭据 preflight 保护、超出 fix 范围 |
| F5 | 本次验证发现 | `tests/e2e/f220-decomposition-charter.e2e.test.ts` 的 charter 快照内嵌 `2026/7/DD` 当日日期，导致**每天必红 9 个**，flaky 成本长期化 | 建议后续把 README 生成时间戳纳入快照脱敏（现有 `<SEC>` / `<PROJECT>` 已有脱敏机制，追加 `<DATE>` 即可） |
| F6 | §9.2 W2 | plan §3 称「五个测试文件全部 mock 了 `checkAuth`」措辞不精确（实为四个模块 mock + 一个直接单测 mock `auth-detector`） | 纯文档记录，不回溯改写 plan，无需 follow-up 动作 |

---

## 6. 最终结论

**READY-FOR-DELIVERY**

理由：

1. lint / build 双 0，全量测试除 9 个已取证的日期滚动快照外零失败
2. A1-A10 十项验收全部达成，每项均有文件:行号或真实命令输出作为证据
3. 四路审查（编排器自查 E1/E2、Codex C1/C2/W1-W4、quality-review Q1-Q5、spec-review INFO）的全部 `[必修]` 项经本次独立核实均已落地
4. 变更范围无溢出，§8.4「两个 F170 脚本不改」决议被遵守
5. 本次改动**自身引入的**两处回归风险（W4 baseline 污染、Q3 e2e 写盘）均已收口
6. over-claim 检查通过：能兑现的兑现（generate/batch 结构化事后校验、batch root 判定），兑现不了的（diff/watch 事后校验、增量 cache）在 HELP_TEXT / FR-077 / 代码注释三处如实标注

**交付前置动作（编排器执行）**：还原 `specs/src.spec.md` 的 602 行再生噪声（§4.2），不要 `git add -A`，用显式路径添加。
