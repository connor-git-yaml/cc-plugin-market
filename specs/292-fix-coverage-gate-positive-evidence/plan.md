---
feature: 292-fix-coverage-gate-positive-evidence
mode: fix
status: planned
based_on: fix-report.md 方案 A
---

# 修复规划 — F292 CI coverage 判定器：从负向证据换正向证据

## 1. 摘要

`.github/workflows/ci.yml` 的 `Coverage (thresholds enforced)` 步骤当前用两条**负向 grep**
（没抓到失败字样 ⇒ 判定没失败）加一条 birpc 签名命中，就在 `test:coverage` 非零退出时放行，
且放行文案宣称"全部用例通过且阈值达标"——这三处都未曾被验证过。2026-09-13 的 release commit
`d0b0484d`（run `34769332914`）已实际走过这条放行分支。

采纳方案 A：把判定逻辑从 YAML 内联 grep 抽成可单测的纯函数 `judgeCoverageLog({ log, status })`
（新文件 `scripts/lib/coverage-gate-core.mjs`）+ 一个瘦 CLI 入口（新文件
`scripts/coverage-gate.mjs`），CI 步退化为「跑 coverage → 落 log → 交判定器 → 用判定器的
exit code 收尾」。判定规则改为**放行必须集齐正向证据**（汇总计数完整且全部落在
`{passed, skipped, todo}` 白名单 / 未处理错误数与已知 birpc 签名数逐一相等 / 覆盖率表完整且是
日志真正的收尾），任一证据缺失一律保持硬红。判定器把用到的证据摘录（汇总行、签名计数、表尾)
显式打印，`coverage.log` 全量作为 artifact 上传，`tail -n 40`（本次假红的"看不见"根源之一）予以
移除。

本次改动落在**门禁 / 判定器**类别（CI 放行逻辑），按 CLAUDE.local.md 常设规则须过异构对抗审查
（见 §7），不因 Codex 配额暂停而降级为目视审查。

## 2. 架构落点决策（逐条结论）

### 决策 1 — 判定器落点与形态

**结论**：拆成两个文件，**不采用** fix-report 原提议的单文件 `scripts/ci/coverage-gate.mjs`。

- `scripts/lib/coverage-gate-core.mjs`：导出纯函数 `judgeCoverageLog({ log, status })`，零 I/O、
  零 `process` 依赖，可被 `tests/unit/coverage-gate.test.ts` 直接 `import` 单测。
- `scripts/coverage-gate.mjs`：CLI 薄壳，`process.argv` 读 `<logPath> <status>` 两个位置参数，
  `fs.readFileSync` 读日志、调用 `judgeCoverageLog`、打印证据摘录、`process.exit(result.exitCode)`。

**理由**：本仓 `scripts/lib/*.mjs` 已有稳定惯例——纯逻辑放 `scripts/lib/<topic>-core.mjs`，CLI 薄壳放
`scripts/<topic>.mjs`（例：`model-literal-gate-core.mjs` + `check-model-literals.mjs`；
`graph-quality-core.mjs`；`spec-drift-core.mjs` + `spec-drift-cli.mjs`）。全仓 `scripts/` 下没有
`scripts/ci/` 这一级目录先例（`Glob scripts/*/` 只命中 `scripts/baselines/`，且那是三个 shell
脚本的主题目录，不是"CI 相关脚本都进 ci/"的通用惯例）。为单个新文件新开一级子目录违反宪法原则 III
（如无必要勿增实体），故改用扁平路径贴合既有惯例。

**入口守卫（`scripts/lib/is-invoked-directly.mjs`）不适用**：该 helper 用于"同一文件既可被
`import` 复用函数、又可被直接 `node xxx.mjs` 跑"的双重身份场景（如 `spec-drift-cli.mjs`）。
本次 core/CLI 已经物理拆成两个文件——`coverage-gate.mjs` 只会被 CI 直接 `node` 调用，
不会被任何模块 `import`（对照 `check-model-literals.mjs` 同类 CLI 薄壳也不带该 guard），
`coverage-gate-core.mjs` 只会被 `import`、不会被直接执行。两者互不冲突，不存在"被 import 时
误触发 main()"的问题，因此不需要该 guard。

**退出码语义**：

```js
// judgeCoverageLog 返回 { verdict: 'pass' | 'red', exitCode, reasons, evidence }
exitCode = verdict === 'pass' ? 0 : (status !== 0 ? status : 1);
```

放行永远 `exit 0`；硬红优先沿用 `test:coverage` 自身的非零退出码（信息量更大，便于区分"测试失败"
类退出码与其它退出码），只有 `status === 0` 但判定仍为红（防御性场景：命令声明成功但日志里仍混入
`does not meet` / 失败汇总字样）时才补一个 `exit 1`，避免出现"红判定却 exit 0"的自相矛盾。

### 决策 2 — CI 步骤改写形状

```yaml
      - name: Coverage (thresholds enforced)
        env:
          VITEST_MAX_FORKS: "1"
        run: |
          set +e
          npm run test:coverage > coverage.log 2>&1
          status=$?
          node scripts/coverage-gate.mjs coverage.log "${status}"
          gate_status=$?
          exit "${gate_status}"

      - name: Upload coverage log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-log
          path: coverage.log
          retention-days: 7
```

- **`tail -n 40` 删除**：现状恰是本次根因之一（汇总块在覆盖率表之前，40 行窗口天然看不到，
  人工复核也复核不到）。判定器自己把汇总行、签名计数、表尾摘录打进 Actions 日志，比裸 `tail`
  更有针对性，不需要再保留一份可能誤導的原始尾部。
  - 有可能有人依赖 `tail -n 40` 做"眼扫全过"的心智习惯，但该心智习惯正是本次要打破的对象
    （它就是"负向证据"直觉的 UI 化），保留它等于给旧习惯留后门，故不保留。
- **末尾显式 `gate_status=$?; exit "${gate_status}"`，不依赖 bash 隐式的"最后一条命令决定
  step exit code"**：显式捕获更抗未来维护者在 `node scripts/coverage-gate.mjs ...` 之后
  顺手加一行打印/清理命令导致 exit code 被悄悄改写。
- **`actions/upload-artifact@v4` + `if: always()` 是必要项，不是锦上添花**：本次修复的可观测性
  承诺（"判定器显式打印证据"）只覆盖 Actions 日志里的摘录，完整 `coverage.log`（含未被摘录的
  部分，如具体哪个用例失败的栈）仍需要能下载核对，尤其是未来误判/漏判时的复盘素材。`if: always()`
  而非 `if: failure()`：放行（pass）分支同样可能是"已知假红"判例，留痕便于后续统计 birpc
  假红出现频率，成本仅为一份文本文件（KB 级），可接受。

### 决策 3 — `tests/unit/release-ci-gates.test.ts` 既有断言改写

现状该文件（171 行）在 `coverage job` 一节钉了 5 条与旧 bash 形状强绑定的断言（L131-148），
新形状下必须**替换**（不是新增叠加）：

| 现状断言 | 处置 |
|---|---|
| `body).toContain('npm run test:coverage > coverage.log 2>&1')` | **保留**（命令本体不变） |
| `grep -qE 'does not meet\|ERROR: Coverage for' ... exit 1` 存在 | **删除**——逻辑已搬进 `coverage-gate-core.mjs`，YAML 里不应再出现，改为**反向断言**（见下） |
| `failed` + `exit 1` 存在 | 同上，删除并反向断言 |
| `Timeout calling "onTaskUpdate"` 存在于 run 体 | **删除**——签名字符串现在活在 `coverage-gate-core.mjs` 里，不在 YAML；新增一条断言钉住 `coverage-gate-core.mjs` 内确实含该字面量（防止判定器实现时把签名换成别的字符串或删掉这个检查） |
| `body[body.length-1] === 'exit "${status}"'` | 改为 `body[body.length-1] === 'exit "${gate_status}"'` |
| `does not meet` 位置 < `Timeout calling` 位置 | **删除**（YAML 里两者都不再出现）；等价的"负向检查必须先于正向放行判断"约束改由 `coverage-gate.test.ts` 的"阈值 miss + 签名同时出现仍判红"用例承接（见 §决策4 表格最后一行） |

新增断言（同一 `it` 内追加，保持"整串精确钉"的既有测试哲学，不用宽松 `toContain` 子串判定）：

```ts
expect(body).toContain('status=$?');
expect(body).toContain('node scripts/coverage-gate.mjs coverage.log "${status}"');
expect(body).toContain('gate_status=$?');
expect(body[body.length - 1]).toBe('exit "${gate_status}"');
// 反向断言：旧的内联负向 grep 逻辑不得复活（防止"脚本加了但旧分支没删"的双轨制）
expect(step).not.toMatch(/grep -qE 'does not meet/);
expect(step).not.toMatch(/Timeout calling "onTaskUpdate"/);
expect(step).not.toMatch(/::warning::vitest birpc/);
expect(step).not.toMatch(/tail -n 40/);
// coverage-gate-core.mjs 必须真的含 birpc 签名字面量（防止判定器把这条检查删掉或改名）
const gateCore = read('scripts/lib/coverage-gate-core.mjs');
expect(gateCore).toContain('Timeout calling "onTaskUpdate"');
```

同时新增一条独立 `it`（同一 `describe` 块内），钉住新增的 `Upload coverage log` 步：

```ts
it('coverage job 上传 coverage.log artifact（if: always()，v4）', () => {
  const job = jobBlock('coverage');
  const step = stepBlock('coverage', 'Upload coverage log');
  expect(step).toMatch(/^\s{8}if: always\(\)$/m);
  expect(step).toMatch(/uses: actions\/upload-artifact@v4$/m);
  expect(step).toContain('path: coverage.log');
});
```

**不改动**（继续钉住，防止本次改动误删相邻合同）：`job header 无 if/needs`、
`VITEST_MAX_FORKS: "1"`、`job` 含 `node dist/cli/index.js batch --mode graph-only`
（coverage job 自己的建图步骤，与本次判定逻辑无关）、`continue-on-error` 全文件仅 1 处
（type-check report-only 步，本次不新增 `continue-on-error`）。

### 决策 4 — 新判定器行为测试落点与变异实证

**落点**：`tests/unit/coverage-gate.test.ts`（新文件，`tests/unit/**/*.test.ts` 已在
`vitest.config.ts` 的 `unit` project `include` 里，无需改配置）。

**样本加载**：`fs.readFileSync(path.join(repoRoot, 'tests/fixtures/coverage-gate', file), 'utf8')`，
`repoRoot` 用 `fileURLToPath(import.meta.url)` 定位（与 `release-ci-gates.test.ts` 现有写法一致）。

**8 份真实样本 ⇒ 期望判定**（照录 `tests/fixtures/coverage-gate/README.md` 的表，逐条断言
`verdict` 与 `exitCode`）：

| 样本 | status | 期望 verdict | 期望 exitCode |
|---|---|---|---|
| `clean-pass.ansi.txt` | 0 | pass | 0 |
| `birpc-timeout-pass.ansi.txt` | 1 | pass | 0 |
| `birpc-timeout-empty-counts.ansi.txt` | 1 | red | 1 |
| `unhandled-other.ansi.txt` | 1 | red | 1 |
| `tests-failed.ansi.txt` | 1 | red | 1 |
| `threshold-miss.ansi.txt` | 1 | red | 1 |
| `truncated-before-summary.ansi.txt` | 1 | red | 1 |
| `summary-no-coverage-table.ansi.txt` | 1 | red | 1 |

**判定算法契约**（供实现阶段直接照做，已逐条对照 8 份样本手工验算，全部吻合）：

1. `stripped = stripAnsi(log)`（`/\x1b\[[0-9;]*m/g` 足以覆盖当前 8 份样本；样本内未出现非
   SGR 的 CSI 序列，已用 `\x1b\[[^m]*[^0-9;m]` 反向检索确认零命中——见 §5 残余风险登记该
   正则的适用边界）。
2. **负向检查（任何 status 下都查，命中即红，不看后续）**：
   - `/does not meet|ERROR: Coverage for/.test(stripped)` → 红（阈值未达）
   - `/Tests\s+\d+\s+failed|Test Files\s+\d+\s+failed/.test(stripped)` → 红（用例失败）
3. `status === 0` 且未命中上述负向检查 → **pass**（"vitest 说通过就是通过"，不做正向检查）。
4. `status !== 0`：**必须同时满足三项正向检查**，任一不满足 → 红：
   - **(a) 汇总计数**：分别定位 `Test Files` 行与 `Tests` 行（`/^\s*Test Files\s+(.*)$/m` /
     `/^\s*Tests\s+(.*)$/m`），每行用 `/(\d+)\s+(passed|failed|skipped|todo)/g` 抽取
     `{count, category}` 段。要求：两行都**存在**且都**至少抽出 1 个段**（排除
     `birpc-timeout-empty-counts` 那种只剩 `(1)` 空壳的情况）；**全部**段的 category
     ⊆ `{passed, skipped, todo}`（不依赖负向检查已经拦过 `failed`，独立兜底）；
     `Tests` 行与 `Test Files` 行都至少有一个 `passed` 段且其 count ≥ 1。
   - **(b) 未处理错误数与已知签名数相等**：`/Errors\s+(\d+)\s+errors?/.exec(stripped)` 取
     `N_err`（**缺失该行判为 0 且视为不满足**——status≠0 却连 `Errors` 行都没有，说明失败原因
     未知，不能放行）；`(stripped.match(/Timeout calling "onTaskUpdate"/g) ?? []).length` 取
     `N_sig`；要求 `N_err > 0 && N_err === N_sig`。
   - **(c) 覆盖率表完整且是日志真正的收尾**：`/Coverage report from/.test(stripped)` 且
     `/%\s*Stmts/.test(stripped)` 且 `/^\s*All files\s*\|/m.test(stripped)`；且把 `stripped`
     按行 split、trim、过滤空行后取**最后一个非空行**，必须匹配 `/^-+\|/`（表格收尾分隔线）——
     此项同时防"表格后面还跟着阈值行/其它噪声"和"表格被截断到一半"两种形态。
   - 三项皆真 → **pass**；否则 → **red**（`exitCode` 沿用 `status`）。

**关键发现（登记，不阻塞，不改动 fixture）**：`birpc-timeout-empty-counts.ansi.txt` 的
Unhandled Error 签名文本实际仍是历史遗留字面量 `"snapshotSaved"`（README 声明的"外科替换为
onTaskUpdate"未应用到这一份），导致该样本**同时**触发 (a)（零 `passed` 段）与 (b)（签名计数
0 ≠ Errors 计数 1）两条独立红判——不影响其期望判定（仍为红），但意味着该样本**不能**单独充当
"仅 (a) 存在时才会红"的隔离证明。据此，(a) 的隔离证明改用**合成串**（见下）而非该 fixture。

**变异隔离表**（每条正向检查必须能证明"删掉它，至少一个用例会从红误判为通过"）：

| 检查 | 隔离证明来源 | 具体做法 |
|---|---|---|
| (a) 汇总计数 | **合成串**（新增，非新 fixture 文件） | 在 `coverage-gate.test.ts` 内联一个字符串常量：取 `birpc-timeout-pass.ansi.txt` 原文，把 `1 passed` / `2 passed` 两处替换为空（只留 `(1)` / `(2)`），其余原样保留（签名、Errors、完整表格不动）。断言：`status=1` 下 verdict 为 `red` |
| (b) 签名数匹配 | `unhandled-other.ansi.txt`（真实样本，Errors=1 但签名文本是 `boom unhandled`，`N_sig=0≠1`） | 已在 8 份基础用例里覆盖，无需额外合成 |
| (b) Errors 行缺失分支 | **合成串**（新增） | 取 `clean-pass.ansi.txt` 内容拼接一个假的非零 status（用例里手写 `status: 1`，log 内容不含 Errors 行）：断言 verdict 为 `red`（防"看似全过但没人解释为什么 exit 非 0"被放行） |
| (c) 表完整 + 末行即收尾 | `summary-no-coverage-table.ansi.txt`（缺表） + **合成串**：取 `birpc-timeout-pass.ansi.txt` 内容在收尾分隔线后追加一行 `ERROR: Coverage for branches (10%) does not meet threshold` 之外的**无害**噪声（如空字符串以外的一行 `note: retried`），断言 verdict 为 `red`（证明"末行必须是分隔线"这一子句独立生效，不止靠上面的负向阈值检查兜底） | — |
| 负向检查优先级（阈值 miss 与 birpc 签名同时出现） | **合成串**（新增） | 取 `birpc-timeout-pass.ansi.txt`（本应放行的样本）内容，在收尾分隔线后追加一行 `ERROR: Coverage for branches (66.66%) does not meet "src/a.mjs" threshold (99%)`；断言 verdict 为 `red`（证明负向检查即便签名/计数/表格都齐全也优先生效，替代原 YAML 里"位置顺序"断言的等价保证） |

**一次性实现期验证义务**（记入 tasks.md，作为实现阶段的操作步骤而非永久保留的代码改动）：
实现完 `judgeCoverageLog` 后，逐条**临时**注释掉检查 (a)/(b)/(c) 中的一个，重跑
`npx vitest run tests/unit/coverage-gate.test.ts`，确认恰好上表登记的用例（及合成串用例）
从红转绿、其余用例不受影响，再撤销注释、确认全绿。此步骤的执行记录（每次改动后的失败用例列表）
写入 commit message 或 verify 阶段的证据，不作为永久代码保留。

### 决策 5 — 回归风险与可观测性

**核心回归风险**：新判据比旧判据严格得多，会把"旧逻辑本会放行"的场景改判为硬红。已知会改变判定
结果的场景（**这是修复本身的意图，不是缺陷**）：

- `birpc-timeout-empty-counts` 形态（计数被 birpc 超时打丢）：旧逻辑因两条负向 grep 都不命中 +
  签名命中 → 放行；新逻辑因 (a) 零 `passed` 段 → 硬红。**这正是本次要堵的洞**。
- 任何"真实测试失败 + 恰好也有一次 birpc 超时"共存的场景：旧逻辑（CI 上 ANSI 未剥离）两条负向
  grep 结构性匹配不到彩色 `failed` 行 → 放行；新逻辑剥离 ANSI 后负向检查正常命中 → 硬红。
  **这也是本次要堵的洞（fix-report 实证 2）**。

**未被消除、需要诚实登记的残余风险**：

1. **未来 vitest 版本升级改变输出格式**：8 份样本冻结在 vitest 3.2.4。若上游改变 `Test Files`/
   `Tests`/`Errors`/覆盖率表的文案或分隔符形状，判定器的字符串/正则匹配可能对**真实通过**的 CI
   跑批也判红（新的假红，而非旧问题的假绿）。缓解手段：判定器强制打印"看到了什么/没看到什么"的
   结构化摘录（见下），保证误判时能在 Actions 日志里 1 分钟内定位是哪一条检查失手，而不必像本次
   一样靠事后翻 run 日志人工侦查；`coverage.log` artifact 留档作为复盘素材。此风险**不可能在
   本次消除**，只能降低发现成本，已在此显式登记（不写入 verify 报告"已解决"）。
2. **`stripAnsi` 正则只覆盖 SGR 序列**（`ESC [ <digits/;> m`）：已对现有 8 份样本验证零反例，
   但不保证未来 reporter 版本引入光标移动等其它 CSI 序列时依旧成立。同上，属性是"判定器会在
   新序列干扰匹配时倾向于报红而非报绿"（未剥净的转义字符更可能打断正则匹配、导致检查判"未找到"
   进而红判），方向上是安全的（宁可误报红，不放过真失败），但仍应登记为推断而非确定性保证。
3. **VITEST_MAX_FORKS=1 单 fork 前提**：(b) 检查假设"同一次跑批最多一种未处理错误类别累计"，
   多 fork 并发下多个 worker 各自超时可能产生多条同名签名与更大的 `Errors N`，理论上 N 仍会与
   签名计数相等（这条检查不依赖 fork 数），**该前提实际不影响正确性**，仅在此说明其不是隐藏假设。

**可观测性设计**：`coverage-gate.mjs` 无论放行还是硬红，都把以下内容打印到 stdout（Actions
日志天然可见，不依赖 `tail`）：

```text
[coverage-gate] verdict=red exitCode=1
[coverage-gate] status(from test:coverage)=1
[coverage-gate] Test Files 行: " (1)"
[coverage-gate] Tests 行: " (2)"
[coverage-gate] Errors 行: " 1 error"  signatureCount(onTaskUpdate)=0
[coverage-gate] reasons:
  - (a) 汇总计数缺少 passed/skipped/todo 类别段，无正向证据
  - (b) Errors 计数(1) 与已知 birpc 签名计数(0) 不相等
```

## 3. Codebase Reality Check

| 目标文件 | LOC（改前）| 改动规模 | 已知 debt |
|---|---|---|---|
| `.github/workflows/ci.yml` | 198 行 | `Coverage (thresholds enforced)` 步 run 体收窄（约 -6/+4 行）+ 新增 `Upload coverage log` 步（约 +6 行），净 +4 行 | 无 TODO/FIXME；F265/F269 等既有编号追溯注释风格一致，沿用 |
| `tests/unit/release-ci-gates.test.ts` | 171 行 | coverage job 一节改写约 8 行断言 + 新增 1 个 `it`（约 6 行）| 无 TODO/FIXME；文件头部注释明确本文件断言是对抗复审加固过的合同，本次改动须保持同等强度（整串精确钉，非宽松 `toContain`） |
| `scripts/lib/coverage-gate-core.mjs`（新增）| 0 → 预计约 70-90 行 | 1 个导出函数 `judgeCoverageLog` + 若干内部 helper（`stripAnsi`/`parseSummaryLine`/`checkCoverageTable`）| 新文件，无 debt |
| `scripts/coverage-gate.mjs`（新增）| 0 → 预计约 25-35 行 | CLI 薄壳：读参数、读文件、调用、打印、`process.exit` | 新文件，无 debt |
| `tests/unit/coverage-gate.test.ts`（新增）| 0 → 预计约 90-120 行 | 8 条真实样本用例 + 约 5 条合成串隔离用例 | 新文件，无 debt |

均远低于"LOC>500 且新增>50 行"的前置清理阈值（改动最大的 `ci.yml` 净增仅 4 行），**不触发
前置 cleanup task**。

## 4. Impact Assessment

- **直接修改文件数**：2（`.github/workflows/ci.yml`、`tests/unit/release-ci-gates.test.ts`）
- **新增文件数**：3（`scripts/lib/coverage-gate-core.mjs`、`scripts/coverage-gate.mjs`、
  `tests/unit/coverage-gate.test.ts`）
- **间接受影响**：无生产代码调用方——`coverage-gate-core.mjs` 不被 `src/` 下任何模块引用，
  纯 CI 内部工具。`vitest.config.ts` 的 `coverage.include` 列表**刻意不纳入**新文件（见下"范围
  之外"），故不影响既有覆盖率阈值 6 个 key / 4 个 include 条目的既有钉死断言（`阈值 key 与
  include 条目指向真实文件` 一节测试不需要改动）。
- **跨包影响**：无。全部改动落在仓库根级 `scripts/`、`.github/`、`tests/unit/`，不跨越
  `plugins/`、`src/` 边界。
- **数据迁移**：无。
- **API/契约变更**：无对外公共接口变更；CI 内部判定合同变更（负向证据 → 正向证据）已通过
  `release-ci-gates.test.ts` 的合同断言承载，非本仓对外 MCP/CLI/skill 契约的一部分。
- **风险等级：LOW**（直接修改 2 个文件 < 10，跨包影响 0，无数据迁移，无对外契约变更）——
  不触发强制分阶段架构拆分。验证仍需真实 CI 一次跑批确认判定器在 GitHub Actions 环境下的
  实际行为（本地可用 8 份样本 + 合成串跑通逻辑正确性，但"这条 CI 步骤本身会不会在真实 runner
  上因为环境差异而拿到不同 shell 引号转义"这类问题仍需真实一次验证）。

**范围之外（本次不做，防止蔓延）**：

- 不把 `scripts/lib/coverage-gate-core.mjs` 加入 `vitest.config.ts` 的 `coverage.include`/
  `thresholds`——该列表现状只覆盖 `src/**/*.ts` 与 4 个既定 extractor `.mjs`，是有意窄化的
  阈值执行范围（"覆盖率门禁本身该测哪些文件"是另一个决策面，与"CI 判定逻辑该怎么写"无关，
  不在本次 fix-report 范围内，硬加会牵连既有"6 个 threshold key / 4 个 include 条目"精确计数
  断言，属于范围蔓延）。`coverage-gate-core.mjs` 的正确性完全由 `coverage-gate.test.ts` 的
  8+5 条行为用例承载，不依赖 vitest 覆盖率百分比。
- 不改 `npm run test:coverage` 脚本本体（`vitest run --coverage`）。
- 不改 `vitest.config.ts` 的 `thresholds`/`include` 数值。
- 不新增 `package.json` script 包装 `scripts/coverage-gate.mjs`（CI 直接
  `node scripts/coverage-gate.mjs ...` 调用，与该步已有的
  `node dist/cli/index.js batch --mode graph-only` 直调风格一致，不强行包一层 npm script）。

## 5. Constitution Check

| 原则 | 适用性 | 评估 |
|---|---|---|
| I. 双语文档规范 | 适用 | plan/fix-report 中文散文 + 英文标识符（`judgeCoverageLog`、`stripAnsi`、`onTaskUpdate`），代码注释用中文，符合 |
| II. Spec-Driven Development | 适用 | 通过 spec-driver fix 流程执行（fix-report → plan → tasks → implement → verify），未绕过 |
| III. YAGNI | 适用 | 未新开 `scripts/ci/` 子目录（决策 1 已论证）；未给判定器加 `--json`/多格式输出等本次不需要的能力；未把新文件纳入覆盖率阈值体系（范围之外已排除） |
| IV. 诚实标注不确定性 | 适用 | §决策5 已把"未来 vitest 版本升级""ANSI 正则边界""(b) 检查的隐藏假设"三项残余风险显式登记为推断/边界声明，未以确定性口吻宣称"问题已彻底解决" |
| V-VIII（spectra 插件约束） | 不适用 | 改动不涉及 `plugins/spectra/` 或 `src/` 下 TypeScript 源码 |
| IX-XIV（spec-driver 插件约束） | 不适用 | 改动不涉及 `plugins/spec-driver/` 下 Prompt/YAML/脚本 |

**结论**：无 VIOLATION，无需豁免论证，无 Complexity Tracking 条目。

## 6. 验证方案

1. **单元测试**：`npx vitest run tests/unit/coverage-gate.test.ts tests/unit/release-ci-gates.test.ts`
   零失败，覆盖 8 份真实样本 + 决策 4 表格中的全部合成串隔离用例。
2. **变异实证（一次性，记录后撤销）**：按决策 4"一次性实现期验证义务"逐条注释检查分支，
   确认预期用例翻转，撤销后复跑全绿。
3. **全量回归**：`npx vitest run` + `npm run build` + `npm run repo:check` +
   `npm run release:check` 零失败（确认未牵连既有覆盖率阈值断言、CI 结构断言）。
4. **本地模拟真实覆盖率跑批**（可选但推荐，验证 CLI 薄壳的 argv/文件读取路径本身无 bug）：
   ```bash
   npm run test:coverage > /tmp/coverage.log 2>&1; status=$?
   node scripts/coverage-gate.mjs /tmp/coverage.log "${status}"; echo "gate exit=$?"
   ```
   预期：本仓当前测试套件全过、阈值达标（无 birpc 超时时）→ verdict pass、exit 0。
5. **真实 CI**：push 到本 feature 分支触发 `ci.yml`（`on: push` 无分支过滤，feature 分支
   push 无需用户确认），观察 `Coverage (thresholds enforced)` 步与新增 `Upload coverage log`
   步。**验收判据**：该步日志出现判定器的结构化摘录（而非旧的 `tail -n 40` 裸输出），且
   `coverage-log` artifact 可下载；若本次真实跑批恰好触发 birpc 超时（历史上非必现），需确认
   判定器按放行路径正确识别（打印 `verdict=pass` + 摘录），而不是误判硬红。
6. **异构对抗审查**（见 §7，提交前完成，非可选）。

## 7. 异构对抗审查安排

本次改动是 CI 放行判定器（门禁类），按 CLAUDE.local.md 常设规则（不随 Codex 配额恢复取消），
须过**异构内部对抗**：独立子代理、不给实现思路只给"证伪这段代码"任务、至少 2 个不同切入角。

- **切入角 (a) fail-open / 假证据面**：`judgeCoverageLog` 是否存在"三项正向检查都判真，但实际
  上并无对应真实通过用例"的构造？例如伪造一行 `Test Files 1 passed (1)` 却没有对应的真实测试
  运行（字符串层面判定 vs. 语义层面判定的鸿沟——本判定器本就只做字符串层面判定，鸿沟是否超出
  "CI 判定器只能信任 vitest 自己吐的文本"这一固有边界，需要子代理明确指出边界而非默认接受）？
  `Errors N == 签名数 N` 这条等式在 `N > 1`（多条未处理错误恰好数量相等但类型不同，例如 1 个
  birpc 超时 + 1 个真实未处理异常）时是否会被绕过？
- **切入角 (b) 正则/边界构造面**：`stripAnsi` 正则 `/\x1b\[[0-9;]*m/g` 是否存在可被真实 vitest
  输出触发的非 SGR 序列绕过（超出决策 4 声明的反例检索范围）？`checkCoverageTable` 的"末行必须
  是分隔线"判据是否能被"分隔线之后跟一个空白字符而非真正的空行"绕过（trim 逻辑边界）？
  `parseSummaryLine` 的类别白名单是否会被大小写变体（如 `Passed` vs `passed`）绕过而误判为
  未知类别（方向相反：这会导致误红而非误绿，风险方向需子代理确认）？

审查结论按 critical/warning/info 三档处置；commit message 标注「Codex 审查暂停，异构档位缺席」。
发现的真实缺陷需在提交前修复并重跑 §6 验证步骤 1-3。

## 8. 提交与交付

- 单次 commit，改动范围严格限定在本计划 §3 清单内（2 个修改 + 3 个新增文件）。
- commit message 需体现：根因（负向证据 + ANSI 盲区 + 文案 over-claim + `tail -n 40` 看不见
  汇总）、修法（正向证据判定器抽成可单测纯函数）、验证证据（8 真实样本 + N 条合成串隔离用例
  全绿 + 变异实证已执行）、异构审查档位标注。
- 提交前完整跑 §6 步骤 1-4 + §7 异构对抗；push 后按步骤 5 观察真实 CI 结果作为最终确认。

## Complexity Tracking

无 Constitution 违规项，本节不适用。
