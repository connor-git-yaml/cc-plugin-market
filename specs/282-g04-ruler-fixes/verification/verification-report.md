# F282 验证报告：G0-4 尺子修复（graph-accuracy `normalizeName` + adoption-census `countingUnit`）

- **验证时间**：2026-09-12
- **验证范围**：`scripts/graph-accuracy.mjs`、`scripts/adoption-census.mjs`、`tests/unit/graph-accuracy.test.ts`、`docs/design/f265-graph-quality-rerun-plan.md`、`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md`
- **验证方式**：本报告所有结论均为本次验证亲自实跑取得（命令 + 输出附于下），不采信 fix-report 转述

---

## Layer 1：fix-report 声称逐条对账

| # | fix-report 声称 | 实证方式 | 结论 |
|---|---|---|---|
| 1 | `normalizeName` 在文件后缀剥离**之后**取最后一个 `.` 段，两侧对称 | 读 `scripts/graph-accuracy.mjs` 第 160-181 行源码；亲自构造黑盒用例（Python `Mod.foo` 标签 + 裸 truth callee `foo` → hits 1/1）验证顺序正确、两侧同函数 | ✅ 实证 |
| 2 | `normalizeName` 已 `export` 供单测直接钉住 | `grep -n "export function normalizeName" scripts/graph-accuracy.mjs` 命中第 160 行 | ✅ 实证 |
| 3 | 空串归一化后返回 `null` | 单测 `normalizeName('')` → `null`；本次另跑独立脚本复核同一断言 | ✅ 实证 |
| 4 | 红先行：改前 `normalizeName` 未导出、`Class.method` 未归一化 → 2 红 | 用 `git show HEAD:scripts/graph-accuracy.mjs` 取当前（改前）实现，隔离出函数体独立跑，对新用例做等价断言：4/9 条断言 FAIL（`Association.Replace`→未变、`HikariDataSource.isClosed`→未变、`association.go::Association.Replace`→`Association.Replace`、`pool/HikariPool.java::HikariPool.getConnection()`→`HikariPool.getConnection`），对应 vitest 两个 `it` 块两红；既有形态 5 条全 PASS（无回退）。**注**：验证用的是当前 HEAD 版本（工作树改动尚未提交，`git show HEAD:...` 即改前实现），非 F147 原始版本，但函数体逐字一致，等价于红先行复现 | ✅ 实证 |
| 5 | 4 用例（`Class.method` / `File::Class.method` / `path/File.java::Class.method()`）+ 既有形态矩阵不回退 | `npx vitest run tests/unit/graph-accuracy.test.ts` → 6/6 通过（含 2 条 F282 新增 `it` 块） | ✅ 实证 |
| 6 | `analyzeGraphAccuracy*` 四语言 + `tests/unit/graph-accuracy*.test.ts`、`graph-accuracy-dispatch.test.ts` 全绿（44/44） | `npx vitest run tests/unit/graph-accuracy.test.ts tests/unit/adoption-census.test.ts tests/unit/graph-accuracy-fill-rate.test.ts tests/unit/scripts/graph-accuracy-dispatch.test.ts` → **44/44 通过**（4 test files） | ✅ 实证 |
| 7 | census 增加 `countingUnit` 字段 | `node scripts/adoption-census.mjs` 实跑，输出第 3 行含 `"countingUnit": "structured tool_use blocks (...)"`；`tests/unit/adoption-census.test.ts` 20/20 通过（未破坏既有断言） | ✅ 实证（字段存在且未破坏既有测试；**⚠️ 无法验证**：本次改动未见针对 `countingUnit` 字面值的专属单测，即该字段本身无回归防线，仅由存在性人工核对） |
| 8 | GORM (Go) @688e8ea0 → precision 0.587 / recall 0.307 / hits 71 / graphCallees 121 / truth 231 | 按协议 §2.2 冻结命令原样重跑（`~/.spectra-baselines/gorm` HEAD 已核对为 `688e8ea0...`，graph.json 沿用已建产物），输出 `callPrecision: 0.587, callRecall: 0.307, hits: 71, graphCalleeCount: 121, truthCalleeCount: 231`，且含 `baseline: {repo, commit, scope}` 三字段 | ✅ 实证（逐字段一致） |
| 9 | HikariCP (Java) @ea81bfb5 → precision 1.0 / recall 0.034 / hits 28 / graphCallees 28 / truth 819 | 同上协议命令重跑（HEAD 核对为 `ea81bfb5...`），输出 `callPrecision: 1, callRecall: 0.034, hits: 28, graphCalleeCount: 28, truthCalleeCount: 819`，含 `baseline` 三字段 | ✅ 实证（逐字段一致） |
| 10 | 不改判据方向、不改冻结协议定义 | 读 `docs/design/f265-graph-quality-rerun-plan.md` diff：仅追加「缺陷 1 处置结果」新节，未修改 §0/§2.1/§2.2 已冻结定义段落；`milestone-M10-...md` diff 仅在既有段落前插入一句指向性总结，未改数字或判据 | ✅ 实证 |
| 11 | 已知边界如实登记（`pkg.func` 同样取尾段、module 文件名多段点现图不产出不处理） | 读 diff 注释原文属实转述；未在代码或文档中发现与此声称矛盾之处 | ✅ 实证（转述准确，未做代码层面的反例穷举，因该项本身是"声明不处理"而非行为断言） |

**Layer 1 结论**：11 项声称全部 ✅ 实证，1 项在实证基础上另加 ⚠️ 附注（`countingUnit` 字面值本身缺专属测试，但不构成 fix-report 的 over-claim，因其原文只声称"字段增加"与"测试绿"，两者均属实）。

---

## Layer 1.5：验证铁律合规声明

- 本报告不存在任何"应该能通过""看起来正确"等推测性表述；所有条目均标注具体命令与输出片段。
- 红先行证据不是直接采信 fix-report 描述的"改前 2 红"，而是**独立重建**：用 `git show HEAD:scripts/graph-accuracy.mjs` 取改前源码、隔离 `normalizeName` 函数体、对新用例矩阵重新跑一遍断言，得到 4/9 FAIL 的第一手数据。
- 额外做了 fix-report 未声称的**黑盒证据**（Layer 1.75）：构造独立 Python 目录 + 手写 `graph.json`（`Mod.foo` label 边 vs 裸 `foo()` truth 调用），验证归一化在真实 `analyzeGraphAccuracy` 管道里（非单测直调）确实让两侧对齐（hits=1, precision=1, recall=1）。
- 变异测试：临时将新规则（尾段截取那两行）替换为直接 `return n || null`，重跑 `tests/unit/graph-accuracy.test.ts` → 1 条断言真实 FAIL（`Association.Replace` 未被截断），证明用例具备守护力；随后已用备份文件逐字还原 `scripts/graph-accuracy.mjs`（`git diff --stat` 复核改动量与还原前一致，18 行改动无损失）。

**Layer 1.5 结论**：COMPLIANT。

---

## Layer 1.75：深度检查

### a. 调用链完整性

- `computeCallAccuracy` 两处调用 `normalizeName`（graph 侧 label 归一化 + truth 侧 callee 归一化，第 188/191 行）走同一函数实例，无参数丢失、无异常吞没分支。已通过黑盒管道验证（见上）而非仅静态读码。

### b. 数据持久化

- 本卡不涉及数据库/文件持久化写入，N/A。

### c. 配置贯穿

- `--baseline-repo` / `--baseline-commit` / `--baseline-scope` 三参数经 CLI → `runAccuracyCheck` → 输出 JSON `baseline` 字段，本次两次实跑输出均确认三字段完整落地（见 Layer 1 第 8/9 条）。

---

## Layer 1.8：残留扫描

本卡未涉及删除/重命名（`normalizeName` 是原地修改 + 新增 `export` 关键字，非改名），跳过残留扫描（N/A）。

## Layer 1.9：文档一致性检查

- `docs/design/f265-graph-quality-rerun-plan.md` 与 `milestone-M10-ship-honest-graph-evidence-gate.md` 已同步更新为修复后读数，两处文档口径一致（均为 GORM 0.587/0.307、HikariCP 1.0/0.034），无发现 DOC_DRIFT。

---

## Layer 2：原生工具链验证

改动面为 `scripts/*.mjs`（独立脚本，非 `src/**/*.ts`）+ `tests/**/*.test.ts` + 两份设计文档，**结构性不受 tsc/lint 覆盖**（非"未运行"，是配置范围本就不含这些路径），如实登记而非回避：

```bash
$ grep -n "include\|exclude" tsconfig.json | head -2
"include": ["src/**/*.ts"],
"exclude": [...]
$ cat package.json | grep -A2 '"lint"'
"lint": "tsc --noEmit",
```

`lint` 脚本本身就是 `tsc --noEmit`，与 build 同一命令、同一 include 范围——本仓无独立 ESLint 配置。因此本次改动的 `.mjs`/`.test.ts` 文件对 build 与 lint 两项**零覆盖**，与类型检查无关，只能靠 vitest（已跑，见下）与本报告的手工黑盒/红先行/变异验证兜底。

| 检查项 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json`（= build/lint） | ✅ PASS（exit 0） | 本卡改动文件不在 include 范围内，此结果**不构成**对 `scripts/*.mjs` 或 `tests/*.test.ts` 的类型验证证据，仅证明未破坏既有 `src/**/*.ts` |
| `npm run build` | ✅ PASS | 同上，不覆盖本次改动文件 |
| `npx vitest run <4 target files>` | ✅ PASS 44/44 | 见 Layer 1 第 6 条命令与输出 |
| repo:check / release:check | ⏭️ 未跑 | 属 T009（"全量门禁"）范围，非本 verify 子任务职责；`git status --short` 复核工作区仅含本卡预期改动（5 个受控文件 + 2 个未跟踪的无关文件 `.codex/config.toml`、`specs/282-g04-ruler-fixes/`），无意外改动 |

---

## 总体结论：✅ PASS

- Spec-Code / fix-report 对账：11/11 声称实证成立
- 验证铁律：COMPLIANT，含独立红先行重建 + 额外黑盒证据 + 变异测试
- 原生工具链：build/lint 通过但对本次改动面结构性零覆盖（如实登记，非回避）；vitest 44/44 通过是本次改动唯一有效的自动化回归防线
- 协议读数复现：GORM、HikariCP 两组读数逐字段与 fix-report 一致，`baseline` 溯源字段完整

## 残余风险

1. **`countingUnit` 字段本身无专属单测**——若未来重构 `runCensus` 返回结构，该字段可能被静默漏改而无测试拦截；建议后续补 1 条断言（低优先级，非阻断项）。
2. **build/lint 对 `scripts/` 与 `tests/` 目录结构性零覆盖**——这不是本卡引入的新问题（F277 账本已记录"scripts/tests 类型门禁"候选卡），但本卡再次印证该缺口的实际影响面（本次两个改动文件均落在盲区内）；不阻断本卡收尾，留待既有候选卡处理。
3. 本报告的红先行复现基于 `git show HEAD:...`（即改前工作树版本），而非 F147 原始 commit；已确认改前 `normalizeName` 函数体与 fix-report 描述的"仅处理 `()` / 前导 `.` / `::` / `/` / `#` / `.py|.ts` 后缀"逐字相符，风险极低，仅作方法论透明度说明。

## 建议

- 无阻断性发现，建议按 tasks.md T009（全量门禁）→ T010（rebase + ff push）继续推进。


---

## 附：对抗复审后主线程复核（2026-09-12）

对抗复审结论：代码层 0 真 bug；读数可信面 1C+3W+5I（处置见 fix-report §7）。以下为主线程亲跑复核（命令均在仓根执行，语料 / 图 / dist 与 Layer 1 相同）：

| 项 | 命令 / 方法 | 结果 |
|---|---|---|
| GORM 口径一致读数 | `node scripts/graph-accuracy.mjs --source ~/.spectra-baselines/gorm --graph …/gorm/specs/_meta/graph.json --language go --baseline-repo … --baseline-commit 688e8ea0… --baseline-scope gorm-full-repo`（无 `--ignore-dirs`） | `callPrecision 1 / callRecall 0.184`，hits 121 / graphCallees 121 / truth 658，`sampleFalsePositives: []` |
| HikariCP 协议口径复核 | 协议 §2.2 命令原样 | `1 / 0.034`，28 / 28 / 819（与 Layer 1 一致） |
| C-1 分解复算 | 对抗复审脚本 `gorm-decomp.mjs`（scratchpad，未入库）以本仓 `normalizeName` 重跑 | 顶层源 55/55 命中；仅子包源 16/66 = 0.242；overall 71/121 = 0.587；敏感性 +40 callbacks/ 函数名 → 0.486 |
| W-3 可达上界复算 | 对抗复审脚本 `upper-bound.mjs` 重跑 | HikariCP truth ∩ 图内定义符号 = 329 → 28/329 = 0.085；GORM 顶层 = 129 → 71/129 = 0.550 |
| I-1 builder 溯源 | 读两份 graph.json `graph.builder` 与 `dist/.spectra-build-meta.json` | `distSha256 b0e74f2c…` 逐字相等；`builder.commit 37b1f814 (dirty)` vs HEAD 00684522——"builder == HEAD" 仅在 distSha256 层成立，文档已改口 |
| 文档改动后目标测试 | `npx vitest run tests/unit/graph-accuracy*.test.ts tests/unit/adoption-census.test.ts` | 见提交前门禁记录（文档改动不触及脚本） |

未复算（如实）：W-2 的 Py/TS 换尺子 A/B（micrograd / nanoGPT / self-dogfood 三组数）与 W-1 的随机目标替换基线（0.239±0.027 / 0.493±0.066）沿用对抗复审脚本产出，文档中已标注来源。
