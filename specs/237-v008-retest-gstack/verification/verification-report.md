# Verification Report: F237 V008 修复复测 — F216 证据门后全池重跑，验证"超 GStack"

**特性分支**: `claude/f237-v008-retest-f216-87eefb`
**验证日期**: 2026-08-02
**验证范围**: SC-001..SC-009 逐条独立核验（本 feature 无源码改动，无 Layer 2 构建/Lint/Test 链，Layer 1 按 SC 清单执行）
**验证方式**: 独立实跑核验命令 + 直读原始 fixture/日志/审计事件，不采信报告自身的转述作为证据

---

## SC-001：33/33 判分零剔除或每一处非零剔除都有明确分类原因

**判定：✅ PASS（有条件成立，见说明）**

实跑命令：

```bash
python3 -c "import json; print(json.load(open('.calibration-output/f237-headline.json'))['stats'])"
cat .calibration-output/f237-rejudge-result.json
cat .calibration-output/f237-anomalies.json
```

输出摘录：

- `f237-headline.json.stats`：`n_total=33, n_valid=31, n_pass=26, n_gen_timeout=3, n_oracle_error=2, n_infra=0, n_error=0, n_oracle_missing=0`
- `f237-rejudge-result.json`：2 条记录，`SWE-V007…r2` 与 `SWE-VB003…r3` 均离线重判为 `pass`
- `f237-anomalies.json`：`finalJudged=33, finalPass=28, excluded=0`，6 条异常逐条分类（2 条 `oracle_error-rejudged`→`included-as-pass`、3 条 `gen_timeout-capability`→`counted-as-fail`、1 条 `budget-guard-split`→`documented`），无一条标记 `excluded`

算术自查：批内 26 pass + 2 离线重判并入 pass = 28；33 总 run 中 3 个 gen_timeout（计 fail，非剔除）+ 2 个原始 oracle_error（经重判计入分母，非剔除）= 全部 33 run 均有终态分类，分母未被沉默丢弃。28/33=84.8% 与报告 §1/§2/§3 一致。

**需诚实标注的边界**：`n_valid=31` 是批内原始产物字段名，字面意味着 2 个 oracle_error 曾一度被判分链路排除在有效分母之外；报告通过**离线重判**（独立脚本 `f237-rejudge-oracle-errors.mjs`，oracle 语义模块零改动，复用既有 patch）把这 2 个 run 重新分类为 pass 并入终值。这是一个合法但非原生的两步流程（非"一次跑批直接零剔除"），报告 §1 已如实注明数据来源分两步骤，未隐瞒此点，故判定 PASS 而非标记为过度声称。

---

## SC-002：V008 三个 run 取证表完整，字段全部非空

**判定：✅ PASS**

实跑命令：

```bash
ls -la specs/237-v008-retest-gstack/evidence/v008-r{1,2,3}/
for f in specs/237-v008-retest-gstack/evidence/v008-r{1,2,3}/*; do wc -c "$f"; done
```

输出摘录：12 个文件全部存在，0 字节文件 0 个（r1: audit 680B/fix-report 3423B/meta 1508B/patch 25336B；r2: 680B/4363B/1508B/29429B；r3: 518B/4045B/1260B/6253B）。

进一步核对权威源（直读评测 worktree 原始 fixture，非取证副本）：

```bash
python3 -c "import json; d=json.load(open('.../tests/baseline/tasks/SWE-V008.../spec-driver-spectra-mcp-c3-r{N}/full.json')); print(d['taskExecution']['primaryOracle'])"
```

结果：`r1: classification=pass, failureSource=none`；`r2: classification=pass, failureSource=none`；`r3: classification=fail, failureSource=candidate`——与取证副本 `meta.json` 及报告 §5 表格逐字段一致（V008=2/3 pass/pass/fail）。

`meta.json.evidenceGate` 字段核对：r1/r2 `completedPhases=[diagnose,plan,implement,verify]`、`blockEvents=0`；r3 `completedPhases=[diagnose,no-op-verify]`、`blockEvents=0`——与报告 §5 "证据门触发且完整履约、零阻断一次通过"表述一致。

`patch.diff` 内容核对：r1 含 `sympy/sets/contains.py` 单行改动（`raise NotImplementedError()` → `return self.args[1]`）+ 测试更新，符合报告摘要；r3 仅 `.gitignore` / `.specify/project-context.yaml` / `fix-report.md` 三个非源码文件（117 行），零 sympy 源码改动，符合报告"零源码改动"表述。

---

## SC-003：`PUBLISH-REPORT-M9-interim.md` 存在，含四方终表 + C1 红线 + 诚实结论三要素

**判定：✅ PASS**

文件存在：`specs/237-v008-retest-gstack/PUBLISH-REPORT-M9-interim.md`（158 行）。

逐段定位：
- 四方终表：§2（`Cohort | F206 战役后 | F212 | F237`，含 c5 GStack / c3 / c1 / c4 四行）
- C1 红线声明：§4（明确"仅与 F206/F212 全池 sonnet 链横比"，列出 133 重判链与 A/B opus 链两条禁止横比对象）
- 诚实结论三要素：§6a 覆盖 (a)V008 X/3 判分（2/3）、(b) 是否命中已知能力边界（逐条 EC-001..EC-009 排查）、(c) 新失败形态描述（"真命题≠任务目标"）；§6b 覆盖交叉核验（混淆因素 1/2：treatment 非纯 F216、N=3 波动不可排除）

---

## SC-004：每个 phase 均有对应 Codex 对抗审查记录，可在 trace.md 定位

**判定：⚠️ PARTIAL（spec/plan/tasks/implement 四阶段达成，verify 阶段审查未执行，报告已如实标注为"待办"）**

实跑命令：

```bash
grep -n "codex-rescue\|task-msa" specs/237-v008-retest-gstack/trace.md
```

输出：4 条记录，均带独立 codex task ID：
- Phase 1-review（spec）：`task-msa2zvzk-50pagh`
- Phase 3（plan）：`task-msa5x5fb-iqqjrq`，7 CRITICAL + 7 WARNING
- Phase 4（tasks）：`task-msa6xy26-gtwllr`，8 CRITICAL + 7 WARNING
- Phase 5（implement/ops 脚本）：`task-msa847e9-e52c6n`，6 CRITICAL + 5 WARNING

四阶段 Codex 审查记录均可定位、均有 critical/warning 处置表（trace.md 逐条列出"实证/修法"）。**verify 阶段**（本次核验）尚未有对应的 Codex 对抗审查记录——报告 §11 SC-004 行已自陈"verify phase 审查尚未执行（在本报告完成之后的下一步进行）"，未隐瞒此缺口。按用户本地约定（CLAUDE.local.md「每完成一个 phase 必须立即跑 Codex 对抗审查，再进入下一阶段」），verify phase 的 Codex 审查应在本验证报告产出**之后**、push 前补齐，故此处判定 PARTIAL 而非 FAIL，且与报告自身声称一致（未构成"制品与叙事不符"类问题）。

---

## SC-005：push 前交付报告出现且等用户确认后才 push

**判定：⏳ 待用户（进行中，如实标注）**

按编排流程，本 verify 阶段完成后才轮到"push 前交付报告 + 等待用户确认"步骤。当前尚未发生 push 动作（`trace.md` 无 push 记录，当前分支 `claude/f237-v008-retest-f216-87eefb` 未合流 `master`）。此 SC 在本次验证时点无法判定 PASS/FAIL，如实标注为"待发生"，与报告 §11 自评一致。

---

## SC-006：诚实结论对称结构（未转化归因 / 转化交叉核验均有实质内容）

**判定：✅ PASS**

`PUBLISH-REPORT-M9-interim.md` §6a（"未完全转化归因"，约 700 字，含 (a)(b)(c) 三个机械问题的逐条回答 + EC-001..EC-009 逐条排查表）与 §6b（"转化交叉核验"，约 500 字，含审计事件直接证据链 + 两条须诚实标注的混淆因素）均有实质分析，非仅一侧展开、另一侧空洞背书。两节均引用可核验的原始证据（audit-events 字段、fixture 内容），非纯文字断言。

---

## SC-007：评测产物零污染仓库，`git status` 仅显示预期改动

**判定：✅ PASS**

实跑命令：

```bash
git status --porcelain --untracked-files=all
```

输出：

```
 M specs/237-v008-retest-gstack/trace.md
?? specs/237-v008-retest-gstack/PUBLISH-REPORT-M9-interim.md
?? specs/237-v008-retest-gstack/evidence/v008-r1/{audit-events.jsonl,fix-report.md,meta.json,patch.diff}
?? specs/237-v008-retest-gstack/evidence/v008-r2/{同上}
?? specs/237-v008-retest-gstack/evidence/v008-r3/{同上}
?? specs/237-v008-retest-gstack/ops/f237-rejudge-oracle-errors.mjs
```

全部改动路径均在 `specs/237-v008-retest-gstack/**` 内，无 `tests/baseline/tasks/`、`tests/baseline/repeats/`、`run_artifacts/`、`.swebench-venv` 等评测产物混入（`.gitignore` 第 102/122/123 行已排除对应路径）。`plugins/**` 与 `scripts/eval-*.mjs` 自 F237 分支起始提交（`51b85e9`）以来无任何 commit 改动（`git log --since` 核验为空），符合 FR-008 慢验窗口冻结约束。

---

## SC-008：成本小节存在，SiliconFlow 实付 <$10

**判定：✅ PASS**

`PUBLISH-REPORT-M9-interim.md` §10 存在，明确记录 SiliconFlow 实付 **$0**（headline 链 `eval-pool-rerun.mjs` 未 import `eval-judge-jury.mjs`）。实跑核验：

```bash
grep -n "judge-jury\|SILICONFLOW" scripts/eval-pool-rerun.mjs   # 无输出，确认零引用
```

Claude Max 配额提醒行核验：

```bash
grep -n "已新跑.*runs" .calibration-output/f237-headline.log
```

输出：恰好 5 次，节点为 6/12/18/24/30 run，与报告 §10 "5 次配额提醒行"表述一致，无 ≥60% weekly 中断记录（符合"未触发中断"表述）。

`notional 成本 ≈$102.14` 抽验：独立汇总 30 个（33 - 3 个 gen_timeout 无新 fixture）成功 run 的 `perf.estimatedCostUsd` 字段。**注意**：磁盘上 `SWE-V002…r3` 路径存在一份**陈旧 F212 遗留 fixture**（`runTimestampUtc=2026-07-19`，早于本轮发射时刻，`spectraVersion=4.3.0`），若天真地按文件系统 glob 求和会多算 $2.31（得 $104.45）；扣除该陈旧文件后精确等于报告数字 **$102.14**。核对 `f237-headline.log:162` 确认 r3 判分口径来自跑批**内存态**实时判定（"gen_timeout"），且该 run 无 `fixture written` 日志行——判分链路本身未被这份陈旧文件污染，报告数字来源可信。

墙钟数字核对：`f237-headline.log:579` 主批 `wall=6.72h`，`:733` resume `wall=0.67h`，合计 7.39h 与报告一致；`meta.wallMs=2429601ms≈0.675h` 与 resume 段吻合，报告 §10 关于该字段"仅为 resume 段局部计量"的技术性澄清核实无误。

---

## SC-009：`FIX_COMPLIANCE_CLI` 核验闭环

**判定：✅ PASS**

实跑命令：

```bash
grep -n "FIX_COMPLIANCE_CLI" .calibration-output/f237-launch.log
grep -n "unset FIX_COMPLIANCE_CLI\|FIX_COMPLIANCE_CLI" specs/237-v008-retest-gstack/ops/f237-launch.sh
```

输出：日志第 1、585 行（主批+resume 各一次）均记录 `[launch] FIX_COMPLIANCE_CLI count after unset: 0`；发射器脚本第 146-149 行确认显式 `unset FIX_COMPLIANCE_CLI` + `env | grep -c` 核验 + 非零即 `fatal` 硬失败逻辑，非仅日志声明。

---

## 抽验三件事实（防报告转述失真）

1. **§2 四方终表 28/33=84.8% 算术一致性**：独立核对 `f237-headline.json`（26/31）+ `f237-rejudge-result.json`（2 pass）→ 28/33=84.8%，√ 一致；§3 逐任务表求和（3+2+3+3+3+0+3+2+3+3+3=28）√ 一致。
2. **§5 取证表 r1/r2/r3 分类与 fixture `primaryOracle.classification` 一致性**：直读三个原始 `full.json`（非取证副本）确认 `pass/pass/fail`，√ 与报告完全一致，且与 `meta.json.evidenceGate.completedPhases`（r1/r2 四阶段全套，r3 仅 `diagnose+no-op-verify`）交叉印证。
3. **GATE-B 证据**：`f237-earlygate.log` 共 135 行，前 134 行 `WAIT stale-fixture`，第 135 行（末行）`PASS plugin-dir=<eval-wt>/plugins/spec-driver`——√ 与报告 §1/§7-1 表述完全一致，`--plugin-dir` 确认指向仓内源而非全局 npm 缓存。

---

## 终审闭环（Codex 5-Phase 对抗审查 verify 轮 + 本次复核）

**背景**：本报告初版总裁定曾写"未发现报告数字与原始证据之间的实质性偏差"。该结论**不成立**——Codex 终审（verify phase 对抗审查，对应 SC-004 此前标注的"待办"缺口）实证了一处**实质性数字偏差**：报告 §3 逐任务对照表与 trace.md 把 F212 的 V010/VB003 历史分数**写反**。

### (a) 原裁定的对账盲区

初版 SC-003/SC-006/"抽验三件事实"三处核验均只核对了 **F237 侧**数字（本轮 33 个 run 的 fixture/日志/审计事件）与报告转述的一致性，**未追溯 F212 历史列本身的转录来源**——即报告 §3 表格 `V010 | F212=2/3` 与 `VB003 | F212=3/3` 这两个单元格，实际是**从 `212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md` §3 表格错误转录**得来（该表列序为 `F206 | F212 | Δ`，编排器在撰写 F237 §3 时误把 **F206 列**的数值当成 F212 列取用）。这是一类"跨报告数字转录"性质的核验盲区：核验流程覆盖了"F237 产物是否忠实反映 F237 原始证据"，但遗漏了"F237 报告引用的**上一轮**历史数字是否忠实反映上一轮报告原文"。

**被推翻的原表述**（初版报告 §3 换算前）：`V010 | F212=2/3 | F237=3/3 | Δ=+1`、`VB003 | F212=3/3 | F237=3/3 | Δ=0`——均与 F212 源文档相反。

### (b) 终审 3C/5W 清单与修复核实结果

Codex 终审对 verify 阶段产出的 3 项 CRITICAL + 5 项 WARNING（对应 `PUBLISH-REPORT-M9-interim.md` 与 `trace.md` 内标注的"终审更正"/"终审 C2/W1-W5"标记）已全部修复，本次复核逐项独立核实如下：

| 编号 | 问题 | 修复核实 |
|---|---|---|
| C1 | V010/VB003 历史列写反（核心数字偏差） | 独立读取 `specs/212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md` §3 原表：`V010｜F206=2/3→F212=3/3（+1）`、`VB003｜F206=3/3→F212=2/3（−1）`——**F212 正确值：V010=3/3、VB003=2/3**。修订后 `PUBLISH-REPORT-M9-interim.md` §3：`V010｜F212=3/3, F237=3/3, Δ=0`、`VB003｜F212=2/3, F237=3/3, Δ=+1`，均带"终审更正"脚注说明取数错误来源（"此前误从 F206 列取数"）。**逐字核对与 F212 源文档一致，无残留偏差。** |
| C2 | §6a r3 归因措辞需更正为"命中已声明边界"而非笼统"新失败形态"（避免过度归因/欠归因） | `trace.md:330` 与报告 §6a(c) 均已改为"r3 命中的是它自身预注册声明不覆盖的边界"，措辞与 `216-fix-noop-evidence-gate/spec.md` EC 系列的能力边界定义逐条比对一致，未发现夸大或淡化。 |
| C3（需二次核实项，见下） | §2 净变化分解需随 C1 联动重算 | 独立重算：V008(+1) + VB003(+1) + V002(−1) + V010(0) = **+1**；与 §2/§3 汇总一致，§3 列求和 F212=27（3+3+3+3+3+0+3+1+3+3+2）、F237=28（3+2+3+3+3+0+3+2+3+3+3），28−27=+1，算术闭合。**无残留偏差。** |
| W1 | §3 备注需注明"F212 表列序为 F206→F212"避免同类错误复发 | 已加注（V010/VB003 两行备注均含此说明）。 |
| W2 | §5 r3 取证需补充可核验的原始执行转录（此前仅有文字描述"复现对账真实执行"，缺 primary evidence） | 新增 `evidence/v008-r3/repro-execution-excerpt.log`（35 行）。本次复核直接读取该文件：第一次尝试用 `timeout 60 python -c ...` 因 shell 环境无 `timeout` 命令报 `command not found` → `SPEC-DRIVER-REPRO: FAIL`；随即改用 `python -c "import signal; signal.alarm(60); ..."` 重试，两条复现命令均输出 `SPEC-DRIVER-REPRO: PASS`；随后独立委派的 `spec-driver:verify` 子代理（`subagent_type: spec-driver:verify`）也各自重跑同两条命令，均再次 `PASS`。**转录真实、可核验，与报告"先 timeout 命令 FAIL 后改 signal.alarm 重试 PASS"的描述完全一致。** |
| W3 | resume 段"载入既有结果"条数表述需核对日志原文用词（"30 条 vs 29 条"等） | `trace.md:282` 已更正为"日志载入 30 条"，与 `f237-headline.log:615`（报告 §7-3 引用）"载入并跳过 30 条终态 run"一致。 |
| W4 | 需在 CI95 重算脚注加"独立重算专用"字样，避免与仓内 cohort-aggregate 默认口径混淆 | §2 脚注已加"与仓内 cohort-aggregate 默认 B=1000+Math.random 不同属独立重算专用"。本次复核直接读取产物 `<eval-wt>/.calibration-output/f237-merged-ci.json`（`m8-closeout-212` worktree 内实际落盘路径）：`n=33, pass=28, pointEstimate=0.8485, ci95=[0.72727, 0.96970]`——即 **[72.7%, 97.0%]**，与报告 §2 引用数字逐位一致；`seedNote` 字段确认 `LCG seed=237` 定种、`B=10000`，与报告脚注描述吻合。 |
| W5 | SC-004 状态需从"PARTIAL/待办"更新为闭环状态 | `PUBLISH-REPORT-M9-interim.md` §11 SC-004 行已更新为"PARTIAL → 闭环中"，本次 verify 报告复核后进一步确认可结项（见下方 SC-004 状态更新）。 |

### (c) SC-004 状态更新

初版本报告 SC-004 判定为 **⚠️ PARTIAL**，理由是"verify phase 自身的 Codex 对抗审查尚未执行"。该缺口现已闭合：verify phase 的 Codex 终审已执行并产出 3 CRITICAL + 5 WARNING（见上表），全部修复并经本次复核逐项核实为真实、准确的修复（无遗留偏差、无新引入错误）。

**五 phase Codex 审查完整性最终确认**：

| Phase | task ID | 发现数 | 状态 |
|---|---|---|---|
| Specify | `task-msa2zvzk-50pagh` | 1 条"不充分"裁决 | 已处置 |
| Plan | `task-msa5x5fb-iqqjrq` | 7 CRITICAL + 7 WARNING | 已处置 |
| Tasks | `task-msa6xy26-gtwllr` | 8 CRITICAL + 7 WARNING | 已处置 |
| Ops/Implement | `task-msa847e9-e52c6n` | 6 CRITICAL + 5 WARNING | 已处置 |
| Verify（本轮终审） | 未在 trace.md 记录独立 task ID（终审产物以 3C/5W 更正标记落盘于 `PUBLISH-REPORT-M9-interim.md`/`trace.md` 内） | 3 CRITICAL + 5 WARNING | 已处置，本次复核逐项核实通过 |

**SC-004 更新判定：✅ 达成**（五 phase 审查记录齐全，verify 轮 finding 已修复并经独立复核确认无残留偏差）。**唯一遗留的流程瑕疵**：verify 阶段的终审未像前四个 phase 一样在 `trace.md` 留下独立可追溯的 `task-xxx` ID，仅以"终审更正"字样标注修订点——建议后续同类 feature 补齐这一记录习惯，但不影响本次修复内容的真实性（本次复核已用原始文档独立重新验证过 C1/C3/W2/W4 的具体数字，非仅采信报告自身声明）。

---

## 总裁定

**READY FOR DELIVERY**——初版总裁定"未发现实质性偏差"的表述已被证伪并撤回：Codex 终审发现并修复了 §3 F212 历史列（V010/VB003）转录颠倒这一实质性数字偏差，根因是初版 verify 的对账范围遗漏了"上一轮报告数字的转录正确性"这一维度。本次复核对终审的全部修复（3C/5W）逐项独立重新核实（直读 `212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md` 原表、`evidence/v008-r3/repro-execution-excerpt.log` 原始转录、`<eval-wt>/.calibration-output/f237-merged-ci.json` 重算产物），**未发现修复本身引入新的偏差或遗漏**——修订后的 `PUBLISH-REPORT-M9-interim.md` 与 `trace.md` 在 V010/VB003/§2 净变化分解/CI95/resume 载入条数/r3 转录等全部争议点上均与原始产物逐位一致。

SC-001/002/003/006/007/008/009 共 7 项独立实证 PASS（初版结论维持，本次未重新发现问题）；**SC-004 由 PARTIAL 更新为 ✅ 达成**（五 phase 审查含 verify 终审全部闭环，见上表）；SC-005 按流程设计仍在本报告之后触发，当前如实标注"待用户"（未变）。**整体判定从"READY FOR REVIEW（有条件）"升级为 READY FOR DELIVERY**——唯一未决项 SC-005（push 前交付报告 + 用户确认）属流程时序问题，非制品质量问题。

## 发现的不一致清单

**本次复核新增一项已修复的实质性不一致**（历史遗留，非本次复核新发现的问题）：

- **F212 历史列转录颠倒（已修复，已闭环）**：初版报告 §3 表格将 F212 的 `V010`（正确值 3/3）与 `VB003`（正确值 2/3）互换成 `V010=2/3`、`VB003=3/3`（实为误取 F206 列数值）。该错误经 Codex 终审发现，修订后的报告已与 `212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md` 源表逐位核对一致，本次复核独立复算 §2 净变化分解（V008+1/VB003+1/V002−1/V010 0=+1）与 §3 求和（27→28）均闭合。**根因分类**：跨报告数字转录时缺少"回源核对"步骤，而非 F237 本轮实测数据本身有误——本轮 33-run 批的原始 fixture/日志/审计事件自始至终真实可信，出错的只是"报告如何转述上一轮的历史对照数字"这一环节。**Followup 建议**：verify 子代理的核验清单应显式加入"报告引用的历史轮次数字需回源核对原文档，不能假定转录正确"这一检查项，避免同类盲区在后续 feature 复发。

仅记录一项**非报告缺陷、但值得后续关注的运维脆弱点**（与初版一致，未变化）：

- `tests/baseline/tasks/SWE-V002-sympy-rational-calc-value-error/spec-driver-spectra-mcp-c3-r3/full.json` 路径下存在一份 F212/F176 era 陈旧遗留 fixture（`runTimestampUtc=2026-07-19`），因 r3 本轮 gen_timeout 未被新 run 覆盖而继续躺在磁盘上。跑批本身的判分口径正确地依赖内存态实时结果（未被此陈旧文件污染，本报告已逐一核实），但**若未来有下游脚本天真地对 `tests/baseline/tasks/**` 做文件系统级 glob 聚合**（而非使用批内实时结果或显式核对 `runTimestampUtc` 新鲜度），存在被陈旧数据静默污染的风险——GATE-B 的 mtime 守卫仅覆盖"首 run"场景，未覆盖"gen_timeout 导致的陈旧残留文件在后续任意时点被下游工具误读"这一路径。建议列入 Followup（陈旧 fixture 清理或读取侧强制新鲜度校验）。
