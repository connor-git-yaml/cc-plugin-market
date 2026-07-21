# 最终验证报告 — F218 fix-compliance-core 拆分

## 验证时间点
Phase 5（独立最终验证，编排器亲自逐项重跑命令，不照抄 residual-report 结论）

## 验证环境
- 工作目录: `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe`
- 分支: `refactor/218-fix-compliance-split`
- HEAD（基线）: `26cebe5 verify(F216): 最终独立验证 READY-FOR-GATE — 双审查+verify 三报告归档`
- 工作区改动: `fix-compliance-core.mjs`（修改）+ `fix-compliance-execution-record.mjs`（新建，未跟踪）

## 逐项验证结果

### 1. `node --test plugins/spec-driver/tests/*.test.mjs` 零失败
```
$ node --test plugins/spec-driver/tests/*.test.mjs
ℹ tests 552
ℹ suites 117
ℹ pass 552
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```
**结果: PASS** — 552/552 全绿，0 失败。

### 2. `npm run test:plugins` 零失败
```
$ npm run test:plugins
ℹ tests 552
ℹ suites 117
ℹ pass 552
ℹ fail 0
```
**结果: PASS** — 与 item 1 一致（同一底层 node --test 调用），552/552 全绿。

### 3. `npm run repo:check` 整体 exit 0
```
$ npm run repo:check > /tmp/repo-check-out.txt 2>&1; echo "REAL_EXIT=$?"
REAL_EXIT=0
[repo-check] status=pass
... （共 74 项子检查，全部 pass，含 spec-driver-wrappers / codex-plugin-consistency /
     release-contract / orchestration-overrides / namespace-consistency 等族）
```
**结果: PASS** — 真实 exit code 复核为 0，全部子检查项 pass，无 fix-compliance 相关文件同步偏移。

### 4. 无环断言
```
$ grep -c "from './fix-compliance-core.mjs'" plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
0
```
**结果: PASS** — 与 refactor-plan.md 承诺的"单向无环"（core → execution-record，execution-record 零 import core）一致。

### 5. 探针残留检查
```
$ grep -rn "flags.replace('g'" plugins/spec-driver/scripts/lib/fix-compliance-{core,execution-record}.mjs
plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs:64:  return new RegExp(re.source, re.flags.replace('g', ''));
```
**结果: PASS** — 仅 1 处命中，位于 `fix-compliance-execution-record.mjs:64`（`toSingleMatchProbe` helper 自身定义体），core 内归零，6 处原调用点全部改写为 `toSingleMatchProbe(...)`。

### 6. 行数
```
$ wc -l plugins/spec-driver/scripts/lib/fix-compliance-core.mjs plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
     560 plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
     316 plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
     876 total
```
**结果: PASS** — core=560 行 < 600 监控线（与 refactor-plan.md 预估 552 / residual-report 560 一致）；execution-record=316 行（略高于预估 304-316，属正常误差范围）。

### 7. 导出面等价（旧 819 行 core vs 新 core，Object.keys 双向差集）
```
$ git show HEAD:plugins/spec-driver/scripts/lib/fix-compliance-core.mjs > $OLD/core-old.mjs   # 确认 HEAD 即拆分前 819 行基线
$ wc -l $OLD/core-old.mjs
819
$ node -e '... 动态 import 对比 Object.keys ...' $OLD/core-old.mjs $PWD/.../fix-compliance-core.mjs
旧独有: []
新独有: []
```
**结果: PASS** — 双向差集均为空数组，拆分前后 core 对外导出面（含 re-export 转发的 12 符号）零漂移；`toSingleMatchProbe` 未经 core 导出，符合裁决（新独有为空即验证了这一点）。

### 8. 消费者零改动
```
$ git diff --name-only
plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
specs/src.spec.md
$ git status --porcelain
 M plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
 M specs/src.spec.md
?? plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
?? specs/218-refactor-fix-compliance-split/
```
**结果: PASS** — 改动集不含 `fix-compliance-judge.mjs` / `fix-compliance-io.mjs` / 三个测试文件（`fix-compliance-core.test.mjs` / `fix-compliance-judge-cli.test.mjs` / `fix-compliance-io.test.mjs`）。`specs/src.spec.md` 是 spec-driver 自动再生成的仓库快照文档（非本次拆分的运行时消费者），不违反兼容约束。

### 9. Batch 2 `toSingleMatchProbe` 调用点抽查
```
$ grep -c "toSingleMatchProbe(" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
5
$ grep -n "toSingleMatchProbe(" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs
316: (extractSectionBody)
330: (extractSectionBody)
376: (checkArtifactSection)
407: (classifyClosureForm, NOOP_JUDGMENT_HEADING_REGEX)
408: (classifyClosureForm, ROOT_CAUSE_HEADING_REGEX)
$ grep -n "toSingleMatchProbe" plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs
63: export function toSingleMatchProbe(re) { ... }   # 定义
133: 调用（parseNoopReconLines, NOOP_JUDGMENT_HEADING_REGEX）
```
**结果: PASS** — core 内 5 处调用（与 impact-report.md 列出的 5 个留守调用点行号对应），execution-record 内 1 处调用（helper 定义体本身不计入调用），与 refactor-plan.md Batch 2 承诺完全一致。

## 总体结论

**READY-FOR-GATE**

9/9 验收项全部 PASS。核心不变量均以一手重跑命令验证成立：
- 测试零失败（552/552，两条独立入口一致）
- `repo:check` 全绿（74 项子检查，真实 exit 0）
- 单向无环、探针残留归零、行数达标（core 560 < 600）
- 导出面双向差集为空（拆分前后 core 对外接口零漂移）
- 消费者（judge.mjs / io.mjs / 三测试文件）零改动
- Batch 2 DRY 提取调用点数量与位置符合计划

未发现与 residual-report.md 结论相悖的证据；本报告为独立重跑一手验证，可作为 GATE_VERIFY 判定依据。
