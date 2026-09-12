# F287（fix-compliance 卡 A）独立验证报告

## 1. 元信息

- 分支：`287-compliance-card-a-diag-canonical`
- HEAD：`a789e40d6407602740148c98bbd5b13bd392ca9e`（已 rebase 到 `origin/master` `93b49956`，`git log --oneline origin/master..HEAD` 恰 1 条，`HEAD..origin/master` 为空）
- 日期：2026-09-13
- 执行者：verify 子代理（claude-sonnet-5，独立于实施与两路异构对抗复审）
- 工作树状态：验证前后 `git status --short` 均为空；验证过程中的全部变异（§4）均已用 `git checkout --` 复原并逐次核对 diff 为空
- 备注：任务书要求等待的全量门禁标记文件 `f287-gate.done` 在本次验证启动前已生成（时间戳早于本次会话开始），故 §4 变异实验未等待、按序直接执行

## 2. 声称核对表（§A）

| 组 | 声称 | 核验方式 | 结论 | 证据 |
|---|---|---|---|---|
| G0 | `JUDGE_DIAGNOSTICS` 产出点全部引表 | `grep -n "JUDGE_DIAGNOSTICS\."` 逐条对照 12 个 key | **证实** | 12 个 key（transcriptEmpty…snapshotStale）逐一在源码中有 `.code` 引用点（第 277/278/303/355/607/642/829/1158/1235/1237/1243/1244/1332 行），表定义外无遗漏 |
| G0 | io 五码走 `IO_DIAGNOSTICS` | `grep -n "IO_DIAGNOSTICS"` | **证实** | `payloadInvalid`（×3）/`transcriptPathAbsent`/`transcriptUnavailable`（×4）/`transcriptTooLarge`/`configDegraded` 全部通过 `IO_DIAGNOSTICS.xxx` 引用，io.mjs 内无裸字面量残留 |
| G0 | `USER_FACING_DIAGNOSTIC_CODES` 恰 11 个码 | 独立 `node --input-type=module -e` 直接 import 并打印 `.length` 与排序后数组 | **证实** | `count= 11`；内容与测试文件 T0-U5 期望数组逐字一致 |
| G0 | `buildFeedbackText` 是唯一渲染点 | `grep -n "process.stderr.write"` 找到 5 处；核实 `buildStorageUnavailableFeedback`（第 845 行调用）内部末尾仍是 `buildFeedbackText(verdict.missing, {...})`（第 945 行），未绕过白名单 | **证实** | 5 处 stderr 写入全部经由 `buildFeedbackText` 完成诊断码到文本的转换；无旁路渲染点 |
| G3 | `countPendingSections` 五条规则（节为单位 / 标题不匹配 / 围栏跳过 / 未闭合围栏反掩码 / >4M 字符 null）| 用**自造语料**（非测试文件原文）逐条 `node -e` 构造断言 | **证实** | 5 条规则独立构造全部通过（见 §3 独立断言脚本输出）|
| G3 | `judgeCompliance` 对 `exists && !nonEmpty` 返回 null 且 missing 含报告；`pendingSectionCount` 不进 missing、不改 compliant | 用**自造 fixReport 内容**（含 "Root Cause" 触发 `closureForm==='repair'`）独立构造 4 种场景 | **证实**（含 2 次自造语料失误的排错过程，见下方"独立验证中的教训"） | `exists&&!nonEmpty`→`pendingSectionCount:null` 且 `missing:["verification-report.md"]`；`exists:false`→同；PENDING 内容不改变 `compliant:true`/`missing:[]`；干净报告 `pendingSectionCount:0` 且无诊断码；四种场景 `missing` 均不含任何 pending 相关键 |
| G3 | 真值集「15 份 / 34 节」与 §2 表 34 行、S 口径 FP 计数 11（precision 23/34） | 亲跑 `pending-truth-recompute.mjs`；手数表内 S 列 FP 个数 | **表内数字证实，但语料范围声称证伪**（见 §5-F1，WARNING） | 重算器输出 `MARK files=189 hitFiles=15 hitSections=34`，与文档「15 份/34 节」逐字一致；手数表 2 中 S=FP 的行（#9,11,12,13,14,15,20,21,22,31,32）恰 11 行，34−11=23，precision=23/34=0.676，与文档一致。**但**重算器目录扫描（`/^\d+-/` 仅匹配一层、要求数字后紧跟连字符）遗漏至少 6 份真实存在的 `verification-report.md`（170a~170e 共 5 份 + `158-.../impl-supplement/` 1 份），其中 170b/170c/170d 三份**确实含 PENDING 类命中**（合计 6 节：170b 1 节 + 170c 4 节 + 170d 1 节），从未进入过统计——包括文档自称的历史基准提交 `7615c82a`（该提交 `git ls-tree` 实际追踪 193 份，比文档「187 份」多 6，与本次遗漏数吻合，说明这是重算器方法论的固有盲区，非近期新增语料所致）|
| G4 | `classifySnapshotMessage` 三态 + 空串归 absent | 独立构造集合，测 FRESH/STALE/ABSENT(undefined)/ABSENT(空串)/ABSENT(纯空白)/ABSENT(非字符串) | **证实** | 6 种输入全部按预期三态分类 |
| G4 | 快照码只进审计不进 stderr | `grep "deferExtraDiagnostics" judge.mjs` 全部 7 处逐行核对，`snapshot` 零共现；T0-E2 独立复核白名单过滤 | **证实** | `deferExtraDiagnostics` 相关 7 行代码中无一提及 snapshot；变异 4/6（见 §4）证明白名单过滤是判定性代码而非装饰 |
| K-1 | 入口守卫用 `isInvokedDirectly` | `grep "isInvokedDirectly\|realpathSync(process.argv"` | **证实** | `if (isInvokedDirectly(import.meta.url))` 存在；`realpathSync(process.argv[1])` 手写比对已删除（仅剩注释提及） |
| K-1 | `JUDGE_FILE_SET` 未新增文件 | `git diff HEAD^ HEAD -- .../judge-snapshot-core.mjs` | **证实** | 该文件与 HEAD^ 相比零 diff；`is-invoked-directly.mjs` 本就在集合中（F246 遗留），闭包确未扩张 |
| C-1（既有 CRITICAL，本卡修复）| `readStdinSync` 已从一次性 `readFileSync(0)` 改为 `readSync` 循环 + EAGAIN 有界等待；旧版对 >64KB 管道 payload 退化为 `payload-invalid` + exit 0，新版正确阻断 | **完全独立复现**：提取 `HEAD^` 版 judge.mjs 到同目录临时文件，自建 fixture root + transcript + 100KB payload，分别用 `sh -c 'printf "%s" "$(cat payload.json)" \| node <script> --mode hook --project-root <root>'` 跑新旧两版 | **证实**（逐字匹配声称） | 旧版：`exit 0`，审计事件 `{"sessionId":"unknown","compliant":null,"degraded":true,"diagnostics":["payload-invalid"]}`；新版：`exit 2`，审计事件 `{"sessionId":"verify-c1-repro","compliant":false,"missing":["verification-report.md","delegation:implement","delegation:verify"],"blockCount":1,"diagnostics":["snapshot-stale","in-flight-undetermined"]}`（无 payload-invalid，sessionId 正确留痕）。完整过程见 §6 |
| SKILL 三副本同步 | `npm run repo:check` 应无 fail | 亲跑 `npm run repo:check`；并对三份 SKILL.md 逐一 `git diff HEAD^ HEAD` | **证实** | `repo:check` exit 0，`spec-driver-wrappers:source-skills: pass` 等相关检查项全 pass（唯一 warning 是 graph-quality 图陈旧，与本卡无关的常规提示）；三份 SKILL.md diff 显示新增段落逐字相同，两份 codex 镜像多出的 1 行差异恰是 `Source SHA256` 值更新（12 行 vs 10 行的差异来源已核实） |
| 测试计数 | fix-report §3 声称新增测试文件"16 用例" | `grep -c "^describe("` + 逐个 `it(` 计数 + `node --test` 自身汇总 | **证伪**（INFO/文档口径，见 §5-F2） | 实际 20 个 `it()` 用例（5 个 `describe` 块），`node --test` 单独跑该文件汇总 `tests 20 / pass 20`。枚举文本本身也有失配：`T3-U1b` 未出现在 §3 枚举里；`T4-E5` 标签被两个不同 `it()` 复用（一个是 "T4-E1..E5" 端到端范围用例的末尾编号，另一个是独立的 "T4-E5 源码面" 用例）|

### 独立验证中的教训（如实记录，非产品缺陷）

首次独立构造 G3 的 `judgeCompliance` 断言时，我用了过短/无 "Root Cause" 关键字的 `fixReport.content`，导致 `classifyClosureForm` 判为 `undetermined` 而非 `repair`，使 verification-report 缺席检查根本没有执行到——两次断言失败均是我自己的 fixture 构造问题（分别是缺 "Root Cause" 关键词、正文非空白字符数 ≤20 触发 `placeholderResidue`），排查后确认与被测代码无关。记录此过程是为了让本报告的"证实"结论可追溯、可复现。

## 3. G3 独立断言脚本关键输出

```
规则1(节为单位+同节多行只计1) OK: 2
规则2(标题不计) OK: 0
规则3(闭合围栏跳过) OK: 0
规则4(未闭合围栏反掩码) OK: 1
规则5(超限null) OK, len= 4194318
① judgeCompliance(exists&&!nonEmpty) => null + missing含报告  OK: ["verification-report.md"] pendingSectionCount= null
② judgeCompliance(缺席) => null + missing含报告  OK
③ pendingSectionCount 不改判（compliant仍true, missing=[]） OK, pendingSectionCount= 1
④ 干净报告 pendingSectionCount=0 且无诊断码 OK
⑤ 四种场景 missing 数组均不含 pending 相关键  OK
G4三态(含空串归absent) OK
```

## 4. 套件亲跑结果（§B）

| 命令 | 结果 |
|---|---|
| `node --test` 四文件（card-a + judge-cli + core + io） | `tests 926 / suites 149 / pass 924 / fail 0 / cancelled 0 / skipped 2 / todo 0`。2 个 skip 为环境相关既有用例（`﹣ 真实 transcript → compliant:true` 等，注释显示"本机不存在该真实 transcript（非本 worktree 环境）"），与本卡无关 |
| `npm run test:plugins` | `tests 1860 / suites 325 / pass 1858 / fail 0 / cancelled 0 / skipped 2 / todo 0`，exit 0。同样 2 个环境相关 skip |
| `npm run repo:check` | exit 0，全部检查项 `pass`，唯一 1 条 `warning`（`graph-quality:freshness`，图产物 sourceCommit 落后于当前 HEAD，与本卡无关的常规陈旧提示） |

card-a 测试文件单独重跑（变异实验后的最终态）：`tests 20 / suites 5 / pass 20 / fail 0`。

## 5. 变异清单执行（§C）

标记文件 `f287-gate.done` 在验证开始前已存在（早于本会话），故未等待即直接执行全部 6 项变异；每项变异均为单点精确替换 → 跑 card-a 测试文件（必要时含 judge-cli）→ 记录 → `git checkout --` 复原 → `git diff HEAD` 确认清零。

| # | 变异 | 预期变红用例 | 实际结果 | 复原确认 |
|---|---|---|---|---|
| 1 | `readStdinSync` 改回 `fs.readFileSync(0,'utf8')` 单次读 | C-1 | **命中**：仅 `C-1 stdin 管道形态…` 1 条失败（`0 !== 2`），其余 19 条绿 | `git diff` 空 |
| 2 | `countPendingSections` 去掉未闭合围栏反掩码（`if (fenceMask[i]) continue;`）| T3-U1b | **命中**：仅 T3-U1b 1 条失败，其余绿 | `git diff` 空 |
| 3 | `classifySnapshotMessage` 删除空串→absent 分支 | T4-U | **命中**：仅 `T4-U1/U2 集合归属…` 1 条失败，其余绿 | `git diff` 空 |
| 4 | `buildFeedbackText` 白名单过滤恒真（`.filter((code) => true)`）| T0-E2 / T0-U5 | **命中**：仅 T0-E2 1 条失败（判据措辞对"不可见码不得进用户文案"直接抓到）；同时跑了 judge-cli.test.mjs 未见新增失败 | `git diff` 空 |
| 5 | `judgeCompliance` 在 `pendingSectionCount>0` 时把 `'verification-report.md'` 推进 `missing`（改判）| T3-U2 / T3-E4 | **命中且超出预期**：T3-U2、T3-E4、**外加 T3-E2/E3** 共 3 条失败 —— 说明该改判方向有比声称更宽的用例网覆盖，不是缺口 | `git diff` 空 |
| 6 | judge 源码表外加一行 `const x = "snapshot-stale";`（双引号裸字面量）| T0-U4 | **命中**：仅 T0-U4 1 条失败 | `git diff` 空 |

结论：6/6 变异全部按预期（或更宽）变红，**无一变异全绿**——本卡新增的守卫具备真实检测力，非装饰性断言。

## 6. C-1 CRITICAL 独立复现完整记录

```
########## 旧版（HEAD^ 的 readStdinSync）##########
OLD_EXIT=0
--- 旧版审计事件 ---
{"schemaVersion":1,"eventType":"fix-compliance-verdict","recordedAt":"2026-09-12T17:48:26.057Z",
 "sessionId":"unknown","enforcement":"block","closureForm":"undetermined","compliant":null,
 "missing":[],"blockCount":null,"degraded":true,"diagnostics":["payload-invalid"]}

########## 新版（HEAD 的 readStdinSync，EAGAIN 循环）##########
[FIX-COMPLIANCE] 缺少验证报告：请委派 verify 子代理完成 Phase 4 验证闭环（产出 verification/verification-report.md）
缺少 implement 类委派：...
缺少 verify 类委派：...
NEW_EXIT=2
--- 新版审计事件 ---
{"schemaVersion":1,"eventType":"fix-compliance-verdict","recordedAt":"2026-09-12T17:48:26.113Z",
 "sessionId":"verify-c1-repro","enforcement":"block","closureForm":"repair","compliant":false,
 "missing":["verification-report.md","delegation:implement","delegation:verify"],
 "blockCount":1,"degraded":false,"diagnostics":["snapshot-stale","in-flight-undetermined"],
 "pendingSectionCount":null}
```

payload 为 102662 字节（`last_assistant_message` 为 100 KB 的 `'y'` 重复，刻意不出现在 transcript 中以触发 `snapshot-stale`），通过 `sh -c 'printf "%s" "$(cat payload.json)" | node <script> --mode hook --project-root <root>'` 管道注入，与 wrapper 真实调用形态一致。旧版把 sessionId 都丢成了 `unknown`（对应 fix-report 描述的"留痕仅一条 sessionId=unknown 的 payload-invalid"），新版正确留痕真实 sessionId 并阻断——**逐字符合声称，且是脱离项目测试框架的独立进程级复现，不依赖仓库自带的 C-1 测试用例**。

临时文件 `plugins/spec-driver/scripts/fix-compliance-judge.old.tmp.mjs` 与所有 fixture 已清理，`git status --short` 验证为空。

## 7. Over-claim / 缺口清单

| # | 严重度 | 描述 | 影响面 | 建议 |
|---|---|---|---|---|
| F1 | **WARNING** | `pending-truth-recompute.mjs` 的目录扫描规则 `/^\d+-/.test(d)` 只匹配 `specs/` 下一层、且要求数字后紧跟连字符，漏掉 `170a-170e`（数字后接字母）与 `158-.../impl-supplement/`（嵌套目录）共 6 份真实 `verification-report.md`；其中 3 份（170b/170c/170d）确有 PENDING 命中共 6 节。`pending-truth-set.md` 自称"全仓真实 187 份"覆盖，实际当时（`7615c82a`）git 追踪 193 份、现在（HEAD）195 份，缺口从文档定稿时就已存在，并非近期语料增长所致。**不影响生产判定逻辑**（`countPendingSections`/`judgeCompliance` 本身对这些文件独立验证仍正确），只影响真值集文档自称的语料覆盖率与由此推出的 precision/recall 数字（S=0.676/0.548、B=0.971/0.600）的准确性——这些数字是在不完整语料上算出的。真值集文档已有"已知盲区"披露章节（词法层面），但未披露这个目录扫描层面的语料缺口。 | 仅影响 `verification/pending-truth-set.md` 自证的语料完整性描述，不影响任何已发布判定行为 | 后续卡把 `pending-truth-recompute.mjs` 的目录匹配改为 `/^\d+/`（不要求数字后紧跟连字符）并改为递归扫描 `specs/` 全树的 `verification/verification-report.md`，补算这 6 份/6 节后更新 precision/recall 数字，或至少在"已知盲区"章节补一条目录扫描口径说明 |
| F2 | INFO | fix-report §3 声称卡 A 测试文件"16 用例"，实测 `plugins/spec-driver/tests/fix-compliance-card-a-diagnostics.test.mjs` 含 20 个 `it()`（`node --test` 自身汇总 `tests 20`），5 个 `describe` 块。枚举文本内部也有两处不精确：`T3-U1b` 未列入枚举（枚举只写"T3-U1..U4"）；`T4-E5` 标签被两个不同 `it()` 复用。 | 纯计数/枚举描述不准确，**功能层面 20/20 全绿，无回归、无缺口** | 下次更新 fix-report 计数时建议直接引用 `node --test` 的 `tests N` 汇总或 `grep -c "^\s*it("`，避免手数 |

未发现 CRITICAL 或阻断级问题；两路异构对抗复审声称的"绕过面 1C/5W/9I、误伤面 0C/4W/10I"处置表中我抽样交叉核对的条目（C-1、W1 围栏反掩码、W4 字段改名、I-4 io 表）均能在代码中找到对应的真实实现，但**对抗复审过程本身**（两个异构子代理各自的原始发现记录）未见提交为独立制品，本报告只能验证"处置结果落地属实"，无法验证"两路复审的具体轮次与角度"这一过程性声称本身（仓库惯例是不入库一次性验证 dump，此处不视为缺口，仅如实注明验证边界）。

## 8. 结论

**PASS**。

理由：
1. G0/G3/G4/K-1 全部声称经独立构造（非照搬测试文件夹具）验证通过；
2. 唯一的既有 CRITICAL（C-1 stdin EAGAIN fail-open）已用脱离项目测试框架的独立进程级复现证实修复有效，新旧版本行为差异逐字符合 fix-report 描述；
3. 6 项变异全部（或超出预期地）命中对应用例，说明新增守卫有真实检测力；
4. `node --test`（926 用例）与 `npm run test:plugins`（1860 用例）均 0 失败，`npm run repo:check` exit 0；
5. 发现的两项缺口（F1 语料扫描盲区、F2 测试计数口径）均为 **WARNING/INFO 级、非阻断**——不改变任何已发布判定行为，建议登记为后续卡的小修项，不构成本次交付的阻断理由。

## 9. 工具使用反馈（Dogfooding）

- **Spectra MCP**：本次验证未使用。原因与 fix-report §6 一致——改动面是 `.mjs` 插件脚本，Spectra 的图谱不覆盖 `plugins/` 下的调用链（`tsc` 对 `.mjs` 零覆盖），验证过程中定位产出点/引用点全部靠 `grep`/`git diff` 加独立 `node -e` 构造断言，比图查询更直接可控（尤其是需要"自造语料而非用已有 fixture"时，图工具帮不上忙）。
- **Spec Driver**：本次是以 verify 子代理身份被直接派发执行验证任务（未经编排器 phase 调度），未调用 `spec-driver:verify` agent 或编排 CLI。流程本身顺畅：任务书给的 8 类核对项 + 6 项变异清单已经足够结构化，不需要额外编排。
- 一点新增反馈（非阻断，供参考）：本次在 G3 判据独立构造时两次因自造 fixture 缺少 "Root Cause" 关键词 / 正文长度不足 20 字符而断言失败（见 §2 "独立验证中的教训"），根因是 `judgeCompliance` 的 `verification-report.md` missing 检查隐式依赖 `closureForm==='repair'` 这个前置分类，而该依赖关系在 JSDoc 里没有直接点出（需要读 `classifyClosureForm`/`checkArtifactSection`/`MIN_SECTION_BODY_CHARS` 三处才能拼出完整前提）。这不是本卡引入的问题（属于既有 `judgeCompliance` 结构），且不影响本次"PASS"结论，仅记录为可能的文档改进点：若未来要写"独立造 fixture 验证 judgeCompliance 行为"的指引，建议在 `judgeCompliance` 的 JSDoc 里显式点出"verification-report 检查仅在 `closureForm==='repair'` 分支生效"这一条件。因是文档可读性的小建议、非确认的产品缺陷，暂不落 `docs/design/dogfooding-feedback-ledger.md`账本。
