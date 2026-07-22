# 验证报告 — F223 charter 快照烤死生成日期

- **特性目录**: `specs/223-fix-charter-snapshot-date`
- **验证方式**: 独立实跑复核（requireRealExecution=true），不采信主编排器声称，全部命令本代理原样重跑
- **验证日期**: 2026-07-22
- **基线**: `origin/master` = `23ffc8f`，本轮尚未 commit

## 一、实跑命令与真实输出

### 1.1 目标测试对照组

```
$ npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
...
 Test Files  1 passed (1)
      Tests  12 passed (12)
```
（实测耗时 7.17s，全部 12 个用例含新增场景10b 均通过）

### 1.2 TZ 时间旅行验证（UTC-12）

```
$ TZ=Etc/GMT+12 npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
...
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### 1.3 TZ sanity check（本机 Node 是否真的识别时区偏移）

```
$ node -e "console.log(new Date().toLocaleDateString('zh-CN'))"
2026/7/22
$ TZ=Pacific/Kiritimati node -e "..."
2026/7/22   # 恰好与本地日期同值（UTC+14 偏移未跨越日界线边界）
$ TZ=Etc/GMT+12 node -e "..."
2026/7/21   # 确认与默认时区不同 → 证明 <DATE> 归一化确实在起作用，而非"巧合全绿"
```
说明：`Pacific/Kiritimati` 组本次实测与默认时区渲染出同一日期字符串（2026/7/22），
该组测试全绿并不能单独证明清洗生效；但 `Etc/GMT+12` 组渲染出确定不同的日期（2026/7/21）
且同样全绿，两组交叉证明了 `<DATE>` 规则对不同日期输入均能归一化收敛。

### 1.4 快照编辑范围核验（三条核验命令独立复跑，非采信 plan.md 声称值）

```
$ git diff --numstat tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap
9	9	tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap

$ git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap \
  | grep -E '^[+-]> 由 spectra' | sed -E 's/^[+-]//; s#2026/7/21|<DATE>#<X>#' | sort -u
> 由 spectra v4.3.0 自动生成 | <X>

$ git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | grep -cE '^[+-]> 由 spectra'
18

$ git diff tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -v '^[+-]> 由 spectra'
（无输出，即快照文件内除 9 处日期行外零其它字节差异）
```

### 1.5 正则误伤核验（当前语料，独立复跑）

```
$ grep -oE '\b[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}\b' tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap | wc -l
0   # 已被替换为 <DATE>，快照现状无残留日期字面量，符合预期
$ grep -rlE '[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}' tests/
tests/e2e/f220-decomposition-charter.e2e.test.ts   # 命中场景10b 测试源码内的字面量样例（非快照），预期内
```

### 1.6 隔离运行场景10a / 场景10b

```
$ npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts -t "场景10a"
 Tests  1 passed | 11 skipped (12)

$ npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts -t "场景10b"
 Tests  1 passed | 11 skipped (12)
```

### 1.7 SCENARIO_TITLES 数组核验（防场景10b 污染 key 集合断言）

实读 `tests/e2e/f220-decomposition-charter.e2e.test.ts` L351-361 的 `SCENARIO_TITLES` 数组定义，
确认仅含"场景1"至"场景10"共 10 项，不含"场景10b"字样；grep 场景10b 上下文确认 `toMatchSnapshot` 出现次数为 0。

### 1.8 全量回归

```
$ npx vitest run
 Test Files  465 passed | 4 skipped (469)
      Tests  5444 passed | 18 skipped | 21 todo (5483)
   Duration  45.04s (transform...) / tests 470.66s
```
零失败，与主编排器声称一致（本代理独立重跑，非采信）。

### 1.9 构建 / Lint

```
$ npm run build
...
[postbuild:stamp] 盖章: commit=23ffc8f7 (dirty)
EXIT=0

$ npm run lint
> tsc --noEmit
EXIT=0
```

### 1.10 意外发现并已现场修复：`specs/src.spec.md` 漂移

验证过程中执行 `npm run build` / `npx vitest run` 后，`git status --short` 出现额外的
`M specs/src.spec.md`（356 insertions / 235 deletions），并非 fix-report/plan/tasks 声明的
"仅 2 个文件"范围。经排查：该文件是仓库内已知的**自动再生 spec 制品**（`specs/src.spec.md`），
本次运行触发的构建/测试流程副作用重新生成了它，与 F223 改动本身无关（其内容差异是 F216-F220
等既往里程碑新增源文件在 relatedFiles 清单中的滞后同步，与快照日期问题无因果关系）。

**处置**：本代理已执行 `git checkout -- specs/src.spec.md` 将其还原至验证前状态，确保不留下
非本次改动范围内的漂移。最终 `git status --short` 仅剩声明范围内的 2 个文件 + 新增
`specs/223-fix-charter-snapshot-date/` 目录。此项记为 **INFO**（已现场清理，不影响本次 fix 判定），
但提醒主编排器：这是仓库既有的"运行任意构建/测试命令都可能顺带 touch specs/src.spec.md"现象，
提交前应显式排除该路径（`git add` 时勿用 `-A`），与项目记忆中"并行 feature 须排除自动再生的
specs/src.spec.md 出 commit"的既有告诫一致。

### 1.11 最终改动范围复核（验证收尾，确认无残留污染）

```
$ git status --short
 M tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap
 M tests/e2e/f220-decomposition-charter.e2e.test.ts
?? specs/223-fix-charter-snapshot-date/

$ git diff --numstat
9	9	tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap
29	0	tests/e2e/f220-decomposition-charter.e2e.test.ts
```
与声明的"2 文件 / 47 行"基本一致（快照 9+9=18 行 + 测试文件净增 29 行 = 47 行，逐字吻合）。

## 二、合并审查清单结论

### [Spec 合规]

| 检查项 | 结论 | 说明 |
|--------|------|------|
| 修复是否与 fix-report.md 根因结论一致 | **PASS** | 根因判定"scrubRuntimeNoise 未覆盖 `toLocaleDateString('zh-CN')` 的 `YYYY/M/D` 形态"；实际改动新增的 `.replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, '<DATE>')` 精确命中该形态，Diff 与 T1 计划逐字一致（已用 `git diff` 核对） |
| 是否引入 fix-report/plan 未覆盖的行为变化或未定义的公共 API/行为面 | **PASS** | `src/**` 零改动（`git diff --stat` 确认改动文件仅 2 个 `tests/` 路径文件）；`scrubRuntimeNoise` 为测试私有 helper，无外部消费者，不构成公共行为面变化 |
| 是否需要同步更新 spec（复核"无需更新"判定） | **PASS，判定成立** | 改动完全限定在测试守护层（清洗正则 + 快照字面量 + 新增纯断言用例），未触及任何 `src/**` 生产代码、CLI 行为、生成产物 schema 或公共接口；spec.md 本就不描述"测试快照内部日期清洗规则"这类实现细节，无需求条目对应，故"无需更新"判定成立 |
| tasks.md T1-T6 是否全部真实落地 | **PASS** | T1（清洗规则三段插入）：已用 `git diff` 逐行核对，注释与正则位置、内容与 plan.md 逐字一致；T2（快照 9 处替换）：三条核验命令独立复跑全部满足期望值；T3（场景10b）：已隔离运行确认通过、确认未写入 SCENARIO_TITLES、确认无 toMatchSnapshot；T4（TZ 时间旅行）：已独立复跑 UTC-12 组全绿（UTC+14 组本次实测与默认时区同值，未能独立提供额外证据，见下方 WARNING）；T5（plan.md §4.1 事实订正）：已读取 plan.md 现状确认已订正为"场景10 含日期故失败"表述；T6（全量回归+build+lint）：已独立复跑，零失败 |

### [代码质量]

| 检查项 | 结论 | 说明 |
|--------|------|------|
| 改动是否最小且聚焦根因，有无夹带未要求的重构/清理 | **PASS** | 改动范围精确：1 条新增正则 + 3 处注释 + 1 个新增纯函数级用例 + 9 处快照定点替换，无任何无关重构 |
| 新增正则边界安全性（实证） | **PASS** | 实测：`.snap` 全文匹配数 0（已归一化）；宽松形态匹配数同为 0（fix-report 阶段记录的"9=9 无遗漏"证据链在当前已归一化状态下自然收敛为"0=0"，逻辑自洽）；全仓扫描该模式仅命中测试源码自身（场景10b 样例字面量），无其它文件误伤。版本号 `v4.3.0`（`.` 分隔）、路径分数（如 `4/5`）等短数字场景因 `\d{4}` 精确要求四位年份天然不匹配，已实证零误伤 |
| 场景10b 是否真的不产生新 snapshot key，负例断言是否真实成立 | **PASS** | 隔离运行 `-t "场景10a"` 与 `-t "场景10b"` 均独立通过；grep 实测 `SCENARIO_TITLES` 数组（L351-361）不含"场景10b"；grep 实测该用例块内 `toMatchSnapshot` 出现次数为 0；负例断言 `expect(scrubRuntimeNoise(untouched, root)).toBe(untouched)` 随场景10b 整体通过一并验证为真实成立（用例内断言链任一失败即整个 it 判红，当前判绿=全部断言含此负例均成立） |
| 命名/风格/注释是否与周边代码一致，有无遗留调试代码 | **PASS** | 新增正则注释风格（行尾 `//` 简注）与既有 `<SHA>`/`<ISO-TS>` 规则一致；新增用例命名遵循"场景N（用途说明）"既有模式；无 console.log/调试断点残留 |
| 安全隐患、数据丢失风险、构建阻断 | **PASS，无** | `npm run build` EXIT=0，`npm run lint` (tsc --noEmit) EXIT=0，无安全或数据风险面 |

## 三、对抗视角专项核查

### 3.1 "零其它漂移"主张证伪尝试

- 独立复跑 §2.2 三条核验命令（不采信 plan.md 中记录的"已实跑"结果，本代理重新执行），numstat=9/9、sort -u 恰 1 行、变化行数=18，三者与声称完全一致，**未能找到反例**。
- 额外补做 plan.md 未列出的第四条核验：`git diff <snap> | grep -vE '^[+-]> 由 spectra'` 排除法过滤全部 diff 输出，确认**无残留行**——即除 9 处日期行外，diff 里不存在任何其它增删行（含空白行、换行符变化）。这是比 plan.md 原有三条更严格的穷尽式核验，结果仍为空，进一步支持"零其它漂移"成立。
- **结论**：未发现"应该变但被 `<DATE>` 掩盖"的字段。README 该行的唯一非常量成分就是日期（`v${version}` 由调用方参数注入、测试内固定为 `4.3.0`，与正则字符集不重叠，不受影响）。

### 3.2 `<DATE>` 占位符是否会掩盖真实日期相关回归

- 检查 `src/batch/batch-readme-generator.ts:49`，确认该行输出仅含 `version` + `toLocaleDateString('zh-CN')` 两个变量，无其它可能与日期同现、被误吸收进同一正则匹配范围的字段。
- 检查全仓其它 `YYYY-MM-DD`（裸 ISO 短日期）形态：fix-report.md 记录 `graph-report-generator.ts:49` 当前匹配数为 0（未进入本次改动的快照 payload），本代理未独立复核该文件当前状态是否仍为 0（超出本次改动的实际影响范围，判定 **INFO**：若后续该文件产物被纳入新的快照冻结，`YYYY-MM-DD` 形态目前未被任何规则覆盖，是已知但当前不触发的技术债，与 F223 本身无关，plan.md 已如实记录为"不做项"）。
- **结论**：当前改动范围内不存在"真实日期回归被 `<DATE>` 误吸收"的风险；`<DATE>` 正则的匹配范围经实证（§1.5）与生产代码读取（此节）双重交叉验证，精确限定在 README 首行的本地化日期这一个字段。

### 3.3 守护测试保护能力是否因清洗规则扩展而被弱化

- 场景10a 的 key 集合断言逻辑未变（本代理已隔离验证仍通过），该断言与 `scrubRuntimeNoise` 内容清洗是两条独立防线，互不干扰。
- README **全文冻结**（Codex G 审查 C2 要求的能力，用于捕获 B7 搬迁类"空文件化/参数断线"缺陷）未被降级——本次只清洗了日期这一个**已知非确定性字段**，其余全部内容（含 `moduleSpecs` 渲染结构等）仍逐字节冻结在快照中，未被新正则触及（已用 §1.5/§3.1 的空 diff 结果证实）。
- 新增场景10b 是**额外增量**防线（纯函数级时间旅行断言），不替代、不削弱任何既有断言，反而补上 Why 5 揭示的"无时间不变性验证"缺口。
- **结论**：未发现"假修复"迹象，守护测试的保护能力（内容冻结粒度 + key 集合防线）未被削弱，且新增了一条独立的回归防线。

### 3.4 全量回归中失败用例的既有 flaky 排查

本轮全量回归（`npx vitest run`）结果为 **465 passed | 4 skipped (469)**、**5444 passed | 18 skipped | 21 todo**，**零失败**，因此本节无需做"新增失败 vs 既有 flaky"的区分工作——没有出现任何失败用例（含项目记忆中记录的 `watch-command.test.ts`、`batch-orchestrator-incremental.test.ts`、`community-analysis` perf 相关已知 flaky 用例，本轮均未复现失败）。

## 四、发现问题分级

| 级别 | 内容 |
|------|------|
| CRITICAL | 无 |
| WARNING | 无 |
| INFO-1 | TZ 时间旅行 Step 2（`TZ=Pacific/Kiritimati`，UTC+14）本次实测渲染日期与默认系统时区**恰好同值**（均为 `2026/7/22`），未能独立提供"该组确实触发了不同日期渲染路径"的证据；Step 3（`TZ=Etc/GMT+12`）渲染出确定不同的日期（`2026/7/21`）且全绿，已充分覆盖"任意系统日期全绿"的核心诉求，UTC+14 组的巧合同值不影响整体结论，仅记录以便后续复测时留意（若需要更强证据，可换用另一 UTC+13/+13:45 等偏移时区重跑该组） |
| INFO-2 | 验证过程中运行 `npm run build`/`npx vitest run` 产生了范围外的 `specs/src.spec.md` 漂移（356 insertions/235 deletions），已被本代理现场 `git checkout` 还原，不计入本次 fix 的改动范围；提醒主编排器提交前用显式路径 `git add` 该 2 个文件，勿用 `git add -A`，避免误将该自动再生制品带入 commit |
| INFO-3 | `graph-report-generator.ts:49` 的裸 ISO 短日期（`YYYY-MM-DD`）是 fix-report.md 已记录的已知技术债（当前未触发，不在本次改动范围），维持"不做"判定，本代理复核认可该判定 |

## 五、最终判定

**READY**

- Layer 1（Spec 合规）：全部 4 项 PASS，tasks.md T1-T6 全部真实落地并逐项独立复核
- Layer 2（原生工具链）：`npx vitest run`（目标测试 12/12、TZ 变体 12/12、全量 5444/5444）、`npm run build`（EXIT=0）、`npm run lint`（EXIT=0）均独立实跑通过
- 对抗视角三项专项核查（"零其它漂移"证伪尝试 / `<DATE>` 掩盖风险 / 守护能力弱化风险）均未发现真实问题
- 无 CRITICAL / WARNING，仅 3 条 INFO（均为记录性提醒，不阻断交付）
- 改动范围精确对齐 fix-report.md 根因结论与 plan.md 变更清单，`src/**` 生产代码确认零改动

---

## 六、Codex 对抗审查（降级为主线程 inline 执行）

**降级声明**：`[DEGRADED: inline-execution — 提交前 Codex 对抗审查 — codex-rescue 两次派发均在 verifying 阶段 stall]`

- 第 1 次：job `task-mrvrqr0t-a2jbzu`，完整 prompt（5 个攻击面）。日志末次活动 `2026-07-22T07:44:45Z` 后静默 23 分钟，日志字节数固定 3082 不再增长，Elapsed 31m+ 仍 `running/verifying`。
- 第 2 次：job `task-mrvsd563-ckm8aw`，精简 prompt（4 问、要求 5 分钟内结论）。日志末次活动 `2026-07-22T07:56:16Z` 后静默 11 分钟，同样 stall。
- 属项目记忆已记录的 `codex-rescue 偶发 stall` 环境性故障，非审查结论。两次派发均留存 job id 与日志路径为证。

**第 2 次 stall 前捕获到的一条实质观察（已在主线程核实并回应）**：

> 「调用面确认比注释描述更宽：它还覆盖模块 spec 哈希前全文、graph/checkpoint/result 的 `JSON.stringify` 整串，以及 README/_index/summary/dry-run 全文。」

该观察属实。但它**加强**而非削弱本次修复的证据强度，理由见下方攻击面 1/2 的实证。

### 攻击面 1：新正则是否误伤更宽调用面？清洗顺序有无隐患？

**实证**（`git show HEAD:<snap>` 与工作区版逐段 diff）：

```
$ diff <(git show HEAD:$SNAP | grep -E '^\s+"[^"]+\.spec\.md": "') <(grep -E ... $SNAP)
（无差异）→ 全部模块 spec 哈希逐字节相同
$ diff <(git show HEAD:$SNAP | sed -n '/"graph": {/,/^  },/p') <(sed -n ... $SNAP)
（无差异）→ graph 段逐字节相同
$ diff <(git show HEAD:$SNAP | grep -A40 '"checkpoint"') <(grep -A40 ... $SNAP)
（无差异）→ checkpoint 段逐字节相同
$ git diff --numstat $SNAP
9	9	<snap>
```

**关键论证**：`moduleSpecDigest()` 取的是**清洗后全文的 sha256**。若新正则在任一模块 spec 文本内改动哪怕一个字符，哈希必变、快照必红。所有哈希 byte-identical ⟹ 新正则在 spec 全文调用面上**零触碰**。graph/checkpoint 段同理（它们是全量冻结而非摘要，任何越界都会直接现形）。

**清洗顺序**：新规则排在 `<ISO-TS>` 之后、`durationMs`/`batch-<TS>`/`<MS>`/`<SEC>` 之前。字符集互斥，不存在相互抢占：
- 与 `<ISO-TS>`（`YYYY-MM-DDT..:..:..Z`）：分隔符 `-` vs `/`，不重叠
- 与 `<SEC>`（`\b\d+(?:\.\d+)?\s*s\b`）：日期规则的匹配以数字结尾，`<SEC>` 以字母 `s` 结尾且要求词边界，不存在同一段文本被两条规则争抢的情形
- 与 `batch-<TS>`（`\bbatch-\d{10,}\b`）：无斜杠，不重叠

**结论**：PASS，未找到误伤反例。

### 攻击面 2：是否抹掉本该冻结的真信号，削弱守护力？

- README 仍为**全文冻结**：实读快照内 readme 字段，目录结构、产品与使用、意外连接表格（含 cross-module 关系明细）、图查询能力说明、模块规范清单、质量审计、文档 Bundle、索引统计等 60+ 行全部逐字节保留，仅日期一个 token 变为 `<DATE>`
- 被中和的是**构造上就非确定**的挂钟日期 —— 冻结它从来没有信号价值，只有误报价值
- 场景10a 的 key 集合断言、graph 全量合同、模块 spec 摘要三条防线均未变动
- 场景10b 是**净增**防线，不替代任何既有断言

**结论**：PASS，未发现"假修复"。

### 攻击面 3：场景10b 是否可能假阳性通过？

断言集互为约束：`Set(cleaned).size === 1` 防"规则缺失"（缺则 5 个变体不收敛）；`toContain('<DATE>')` 防"替换成别的占位符"；`not.toMatch(日期正则)` 防"漏替"；ISO 断言防"改坏既有规则"；负例 `toBe(untouched)` 防"规则过贪"。未找到能同时骗过全部 5 条的错误实现。

**INFO（诚实记录的一处守护力局限）**：负例样本里的 `4/5 通过` 只有**两段**数字（`4/5`），而日期正则要求**三段**，因此该负例并不能鉴别年份宽度边界 —— 一个过宽的假想规则 `\b\d{1,4}\/\d{1,2}\/\d{1,2}\b` 仍能通过场景10b 全部断言。该边界当前由「攻击面 1 的全 payload 逐字节比对」实证覆盖（若过宽会在 graph 的路径类字段现形），故本次不追加样本（属未要求的增强）；若后续要强化该用例，可补一个 `12/3/45` 形态的三段短数字负例。

**结论**：PASS（含 1 条 INFO）。

### 攻击面 4：手改 9 处 vs `vitest -u` 重录，是否掩盖其它漂移？

该担忧方向相反：`vitest -u` 才是**吸收**漂移的那一方（把任何变化写成新期望值）；手工定点替换则把漂移**保留为失败**。

论证：手改后测试全绿。若除日期外还有任何字段漂移，它不会被本次编辑覆盖，必然仍红。全绿 ⟹ 无其它漂移。再叠加 `git diff` 恰 9 增 9 删且归一化后收敛为唯一形态、以及攻击面 1 的分段 byte-identical 比对，三条独立证据互相印证。

**结论**：PASS，论证成立。

### Codex 对抗审查汇总

| 级别 | 数量 | 内容 |
|------|------|------|
| CRITICAL | 0 | 无 |
| WARNING | 0 | 无 |
| INFO | 1 | 场景10b 负例样本 `4/5` 为两段数字，不鉴别年份宽度边界；当前由全 payload byte-identical 比对覆盖，记录不改 |
