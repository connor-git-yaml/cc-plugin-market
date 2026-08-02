---
feature: 241-graph-keepalive-kb-grounding
title: 交付检查清单（implement / verify 阶段逐项过）
source_spec: specs/241-graph-keepalive-kb-grounding/spec.md
source_verifications: specs/241-graph-keepalive-kb-grounding/orchestrator-verifications.md
source_measurement_design: specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md
---

# F241 交付检查清单

> 使用方式：implement 阶段边做边勾；verify 阶段逐项复核证据，不允许「看着差不多」通过。
> 每项格式：`- [ ] 判据 —— 怎么验（命令/断言/人工核对方法）`。

---

## 1. TDD 合规（用户硬要求：每个 FR 先有红测试）

> 判据：对每个 `[必须]` FR，implement 阶段必须存在「先写测试（红）→ 再写实现（绿）」的顺序证据。

- [ ] FR-001 决策纯函数 —— 检查新测试文件的首次 commit 是否早于（或与）对应实现文件首次 commit 同一提交但 diff 中测试断言先于实现存在；若同提交提交，需在 commit message 或 PR 描述中记录「先跑红：`node --test <新测试文件>.mjs` 在实现落地前失败，日志附 stderr 摘要」
- [ ] FR-002 五维输入 fail-loud —— 同上模式；额外要求：跑一次 `git log -p --follow <测试文件>` 确认「缺字段返回 invalid-input」这条断言不是在实现之后补写的（若测试文件与实现文件在同一 commit，检查 commit 内测试断言先行的 diff 顺序不足以证明红/绿，此时必须有独立的红测试运行记录）
- [ ] FR-003 决策矩阵 144 组合穷举 —— 检查该测试用例是否覆盖矩阵表全部 13 行 + 6 类 unreachable 组合的显式注释 + 1 条顺序不变量测试；`node --test <决策核心测试>.mjs` 全绿
- [ ] FR-004 degraded reason 封闭枚举 —— 断言存在「枚举常量恰含 13 项」的测试 + 一条 grep 断言（`grep -rn` 实现文件内无枚举外字面量出现在 return 路径），且该 grep 断言本身是可执行脚本而非人工目测描述
- [ ] FR-005 变更类别机械判定 —— 单测样本覆盖 M/A/??/R100/空输入/含空格文件名/含引号转义路径，逐条核对断言存在
- [ ] FR-006 fresh caveat 附注 —— 两条对照测试（directCallers=0 有 caveat / directCallers=3 无 caveat）均存在
- [ ] FR-007 刷新失败改写 —— fake `attemptLocalGraphBuild` 注入测试覆盖四类失败到四个枚举值的映射，逐条核对
- [ ] FR-008 每 phase 最多刷新一次 —— 集成测试用 spawn 计数桩或 dry-run 计划行断言第二次调用不再 spawn
- [ ] FR-009 CLI 子命令 —— `--dry-run --format json` 输出可 `JSON.parse`，含四个顶层键（`outcome`/`degradedReason`/`caveats`/`inputs`），且断言图文件 mtime 不变
- [ ] FR-010 决策审计落盘 —— 两次决策后审计文件恰 2 行合法 JSON；只读目录场景断言进程 exit 0 + stderr 含 warning
- [ ] FR-011 goal_loop 零改造接线 —— `goal-loop-core.test.mjs` 全绿含四条冻结断言 + 新增「旧形态输入不抛错」测试
- [ ] FR-012 redaction 规则 —— 6 类形态各 ≥2 正例 +1 反例，另有「原始查询串零出现」整体断言
- [ ] FR-013 no-hit 存储/保留 —— gitignore 命中 + 40 天前 mtime fixture 被清理 + 只读目录场景查询不受影响，三条断言均存在
- [ ] FR-014 采集开关三态可区分 —— 三种条件各一次子命令调用，`status` 三值互不相同
- [ ] FR-015 k-匿名聚合 —— fixture（3条同词/2查询 + 1条独有词 + 1行损坏）断言恰 1 条目 + `skippedLines: 1` + exit 0
- [ ] FR-016 lockfile 版本推断 —— 三种 lockfile fixture + go.sum fixture 共 4 条断言
- [ ] FR-017 版本优先级双呈现 —— 四组 fixture（仅显式/仅lockfile/冲突/多lockfile）各一条断言
- [ ] FR-018（可选，若实现）版本信号进检索 —— 若实现需断言 chunk `sdk_version` 分布差异；若不实现，检查 plan.md 是否记录移除理由（不是本清单的测试项，是文档存在性检查）
- [ ] FR-019 KB 状态子命令 —— fixture 库全字段断言 + 100天前 built_at→stale + 运行前后 mtime/size 不变
- [ ] FR-020 旧 schema 探测-兼容 —— 缺 provenance 列 fixture 库跑通，exit 0 + 字段 null + `freshness: unknown`
- [ ] FR-021 MCP 响应向后兼容 —— `kb-contract.test.ts` / `kb-search-tool.test.ts` / `kb-api-lookup-tool.test.ts` 全绿 + 新增断言含新字段且既有字段快照不变
- [ ] FR-022 pilot 按冻结口径取数 —— `predicted-impact-set.md` git 提交时间早于首个 implement 代码提交（`git log --format=%aI -- <file>` 核对时间戳先后）；`mcp-call-log.md` 行数 ≥ 实际 MCP 调用次数
- [ ] FR-023 pilot 报告诚实性 —— grep 报告文本含五项声明关键词，且不含「提升 %」外推表述

---

## 2. 回归护栏（RG-001..RG-009，对照 V-7 改动前基线）

> 改动前基线（`orchestrator-verifications.md` V-7，交付时逐项复跑对比，数字漂移需能解释）：
> - KB 现有链：`npx vitest run tests/kb/` = **32 文件 / 293 测试全 pass**，1.23s
> - goal_loop core：`node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` = **163 测试 / 23 suite 全 pass**，0 fail，93ms
> - 图质量门：`spectra graph-quality --json` = `overallVerdict: pass`，六指标全 pass，freshness `fresh` @ `2e3a4cd`
> - `npm run repo:check` = exit 0，全 family pass，**无写入副作用**
> - 全量测试：`npx vitest run` = **490 文件 pass / 4 skipped（494）；6017 测试 pass / 18 skipped / 21 todo（6056）**，exit 0，58.5s
> - 图规模：**6092 节点 / 8062 边**（calls 926 / depends-on 2040），graph-only 重建 **4.4s**

- [ ] RG-001 goal_loop 机制零回归 —— `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` 全绿；`git diff --stat` 对该测试文件为 0 行改动（新断言必须写入新测试文件）；测试数≥163（不能少）
- [ ] RG-002 goal_loop 默认 off 不变 —— `git diff` 对 `orchestration.yaml` 与开关相关配置为空；不带 goal_loop 的默认 feature dry-run 未触发 goal_loop 路径
- [ ] RG-003 `decideStop`/`interpretImpactResult` 函数体零改动 —— `git diff plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 中这两个函数的行区间无改动（理想情况该文件完全未改动，`git diff --stat` 为空）
- [ ] RG-004 orchestration schema 零改动 —— `git diff plugins/spec-driver/contracts/orchestration-schema.mjs plugins/spec-driver/config/orchestration.yaml` 为空
- [ ] RG-005 KB 现有链零回归 —— `npx vitest run tests/kb/` 全绿，文件数/测试数 ≥ 基线（32文件/293测试）；`kb-contract.test.ts` 中既有字段断言未被放宽（人工 diff 核对该文件断言值/字段名未改窄或删除）
- [ ] RG-006 F239 状态文件唯一 freshness 源 —— 全仓 grep 新增文件（`git diff --name-only --diff-filter=A` 出的文件）无 `*source-commit*`/`*freshness*.json` 类产物；新增代码 freshness 获取路径唯一（全部经 `checkFreshness`，grep 断言无独立读 `graph.json.sourceCommit` 再自行比对 HEAD 的第二实现）
- [ ] RG-007 F217 图质量门全绿 —— `spectra graph-quality --json` 的 `overallVerdict` 为 `pass`/`pass-with-warnings`（仅 freshness 告警），五项结构指标全 pass；`npm run repo:check` 中 graph-quality 族通过
- [ ] RG-008 不覆写图（除 SC-002 明确用例外）—— 对 `--dry-run`、KB 侧全部命令、状态查询逐一记录运行前后 `specs/_meta/graph.json` 的 mtime + size，断言不变
- [ ] RG-009 KB 主链路不受治理层影响 —— no-hit 目录只读 + 库缺 provenance 列两种故障注入下，`kb_search` 返回的 `results` 与故障注入前逐字节相同（用 diff 或哈希比对，不能只是「肉眼看着一样」）

---

## 3. 验收实证（SC-001..SC-018）

> 标注 [自动] = 可脚本/命令直接断言；[人工] = 需人工核对，附核对方法。

- [ ] SC-001 决策矩阵穷举 [自动] —— `node --test plugins/spec-driver/tests/<决策核心测试>.mjs` 全绿；确认测试文件内含 144 组合穷举用例，逐一返回规定出口与 `matchedRule`，无 undefined/throw
- [ ] SC-002 B4① 刷新路径实测 [自动] —— stale 图 worktree 上改动一个 `src/**` 既有文件跑决策 CLI，断言 `outcome: refresh-then-consume` + `refreshAttempted: true` + `refreshOk: true`；审计 JSONL 新增一行含上述字段；刷新耗时是否落审计（对照参考值 ~4.4s，非硬性阈值）
- [ ] SC-003 B4② 纯新增不刷新 [自动] —— 只新增文件工作树跑决策 CLI，断言 `outcome: skip-impact` + `degradedReason: impact-not-applicable-additive-only` + `refreshAttempted: false`；图文件 mtime 命令前后**完全不变**（`stat` 比对）
- [ ] SC-004 B4③ 覆盖缺口降级 [自动+人工] —— fresh 图上改动集全为 `plugins/**/*.mjs` 跑决策 CLI，断言 `outcome: consume-degraded` + `degradedReason: coverage-gap-out-of-graph-scope`；[人工] grep 全部输出，人工确认不含「可信」「完整」等 over-claim 表述（这是措辞红线，机器 grep 关键词后仍需人读一遍语义，防止用近义词绕过）
- [ ] SC-005 degraded reason 13 枚举全可达且落审计 [自动] —— 各构造一次决策（含 refresh 失败四态注入桩），断言审计 JSONL 出现全部 13 值，无枚举外值
- [ ] SC-006 刷新失败四态映射 [自动] —— 注入 fake `attemptLocalGraphBuild` 四态，断言 degraded reason 逐一对应
- [ ] SC-007 脏工作树只刷一次 [自动] —— 未提交改动工作树连续两次决策 CLI，第二次 `refreshAttempted: false`
- [ ] SC-008 goal_loop 零回归+接线生效 [自动] —— `goal-loop-core.test.mjs` + `goal-loop-snapshot-rollback-integration.test.mjs` 全绿含四条冻结断言；新增测试断言 degraded 出口下 iteration log 含 degraded reason，缺字段旧形态不抛错
- [ ] SC-009 no-hit 脱敏实证 [自动] —— email/`sk-`token/64位hex/`/Users/<name>/...`/10位数字各触发一次 no-hit，读落盘 JSONL 断言原文敏感片段零出现 + `redactionTags` 含对应类型
- [ ] SC-010 coverage-gap 三状态可区分 [自动] —— 三条件各跑一次，`status` 三值互不相同，`items` 均空
- [ ] SC-011 backlog 产出与损坏容忍 [自动] —— fixture 跑通，恰1条目 + `distinctQueries: 2` + `skippedLines: 1` + exit 0
- [ ] SC-012 版本推断命中+显式优先 [自动] —— 三种 lockfile fixture 断言版本；「显式4.0.0+lockfile3.2.1」断言 `resolved.version=4.0.0` + `source=explicit` + `candidates` 含 3.2.1 + `flags` 含 version-conflict；go.sum fixture 断言 ecosystem-unsupported
- [ ] SC-013 KB freshness 三元状态 [自动] —— built_at 5/45/100天前分别断言 current/aging/stale；缺 provenance 列旧库断言 unknown + legacy-missing-provenance + exit 0；运行前后库文件 mtime/字节数不变
- [ ] SC-014 MCP 响应向后兼容 [自动] —— `npx vitest run tests/kb/` 全绿；断言新增状态子对象 + 既有字段零变更
- [ ] SC-015 pilot 口径合规取数 [自动] —— `predicted-impact-set.md` 首次提交时间早于首个 implement 代码提交（`git log`时间戳比对）；`mcp-call-log.md` 行数 ≥ 实际 MCP 调用次数（需另有调用日志/transcript 佐证「实际调用次数」这一分母，不能自证）；`measurement-design.md` 相对基线 commit **无 diff**（`git diff <baseline-commit> HEAD -- pilot/measurement-design.md` 为空）
- [ ] SC-016 pilot 三指标有对照数据 [人工] —— 报告含 M-1 四类计数+命中率、M-2 三数（coverage/precision/missed-list逐条归因）、M-3 A/B 两组真finding数+差异数；人工核对每个数字是否有可追溯的原始记录支撑（mcp-call-log.md / predicted-impact-set.md / codex 审查产物），而非报告里凭空写的汇总数
- [ ] SC-017 pilot 报告诚实性 [自动] —— grep 断言含「N=1」「判读者非盲」「单次采样」「自我选择偏置」「结构性封顶」五项关键词；断言不含「提升 X%」外推表述
- [ ] SC-018 全局零失败 [自动] —— `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 四项全部零失败

---

## 4. 反纸面达成（专项排查：哪些做法会让验收变成走过场）

> 这组不是「再抄一遍 FR/SC」，是专门盯「表面通过、实质造假」的手法。逐项人工排查。

- [ ] **空 backlog 冒充「无文档缺口」**（对应 D5/FR-014）—— 核对 `collection-disabled`/`no-data`/`no-gap-above-threshold` 三态是否真的用不同 `status` 字段值表达，而不是三种场景全靠 `items: []` 混同；人工触发「采集关闭」场景，确认输出**不是**静默返回空数组，而是显式标了 `collection-disabled`
- [ ] **pilot 指标事后改口径**（对应 SC-015）—— `git diff <feature起点commit> HEAD -- specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md` 必须为空；若有 diff 视为违反冻结声明，直接判失败
- [ ] **测试写成 trivially 绿**（断言太弱/只断言不抛错）—— 抽查至少 5 个新增测试文件，确认断言是「值相等」级别而非「代码跑完没崩」级别（如 `expect(result).toBeDefined()` 这类弱断言应被拒绝）；特别核查 FR-004 枚举穷举测试、FR-003 144组合测试是否真的逐条比对期望出口，而非只断言「不是 undefined」
- [ ] **degraded reason 用枚举外字面量绕过**（对应 FR-004）—— 独立跑一次「grep 实现文件 return 路径中的字符串字面量，人工核对是否全部落在 13 项枚举内」，不能只信任仓库自带的那条自动化断言（自动化断言本身也可能被弱写，需人工复核其 grep 模式是否真的覆盖了所有 return 分支）
- [ ] **`--dry-run` 声称结果但其实不等价于真实执行**（EC-15 已在 F239 踩过一次坑）—— 人工核对 dry-run 输出是否明确标注「操作计划」而非「执行结果」；对照 EC-15 原文，确认没有重蹈"打印最终状态对象"的覆辙
- [ ] **`refresh-then-consume` 出口在刷新失败后未被正确改写为 `consume-degraded`/`unavailable`**（对应 FR-007）—— 单独跑一次真实失败场景（如临时 PATH 里去掉 `spectra` 触发 ENOENT），确认最终返回的 `outcome` 字段确实被改写而不是仍停留在 `refresh-then-consume`
- [ ] **M-3 A/B 对照组 prompt 不是「逐字相同」**（对应 measurement-design.md）—— 人工 diff 两组 prompt 全文，确认唯一变量是 grounding 包本身，无额外措辞/顺序差异
- [ ] **pilot 判读者非盲被隐藏为"客观结论"** —— 报告中 M-3 的真/伪 finding 判定是编排器本人做的（非盲），检查报告是否如实标注而非把这一步写得像是自动化裁定
- [ ] **coverage-gap / KB 状态子命令声称只读却有写入副作用** —— 对每个"只读"类子命令逐一 `stat` 运行前后所有可能被动到的文件（KB db、图文件、no-hit 目录），而不是只信任 spec 里写的"不触发重建"这句话
- [ ] **审计记录字段缺失但仍声称"落审计"** —— 抽查审计 JSONL 若干行，核对 Key Entities 第3节规定的全部字段（`schemaVersion`/`timestamp`/`projectRoot`/`phase`/`inputs`/`outcome`/`degradedReason`/`caveats`/`refreshAttempted`/`refreshOk`/`refreshDurationMs`）逐一存在，而非只有部分字段就算数
- [ ] **redaction 规则表被散落正则替代**（对应 FR-012 明确禁止）—— 检查实现是否确实以数据表形式声明 6 类规则，而非分散的 if/正则堆砌（数据表形式是可测试性/可扩充性要求，散落写法即使功能等价也判不合规）
- [ ] **FR-018 未实现却未在 plan.md 记录移除理由就静默丢弃** —— 若最终未接入检索排序，检查 plan.md 是否显式写了移除理由，而不是 FR-018 就这样消失不提

---

## 5. 仓库级门禁

- [ ] `npm run build` 零错误
- [ ] `npx vitest run` 全绿，且总文件/测试数不低于改动前基线（490文件/6017测试）——若因新增测试数增加是预期，但**减少**需能解释
- [ ] `npm run repo:check` exit 0，全 family pass
- [ ] `npm run release:check`（若本次改动涉及发布相关字段）zero fail；若未涉及可跳过但需在报告中写明未涉及的判断依据
- [ ] `spectra graph-quality --json`（图质量门）`overallVerdict: pass` 或 `pass-with-warnings`（仅 freshness），六指标核对
- [ ] `.mjs` 插件测试链：`npm run test:plugins`（若存在该脚本）确认新增 `.mjs` 决策模块的单测被纳入，而非游离在 vitest 覆盖之外

---

## 6. 交付前收尾

- [ ] rebase 状态 —— `git fetch origin master:master` + `git rebase master` 已完成，无残留冲突标记
- [ ] `specs/src.spec.md` 排除 —— 确认本次 commit 未误提交自动再生的 `specs/src.spec.md`（`git status --porcelain` 核对，用显式路径 add 而非 `git add -A`）
- [ ] 分支清理 —— 交付到 master 后本地/远端 feature/fix 分支已删除（`git branch -d` + `git push origin --delete`）
- [ ] dogfooding 反馈节已写 —— 交付报告末尾含「工具使用反馈」一节，覆盖 MCP 可用性/返回信息是否够用/流程是否顺畅/结果是否准确四个维度；无问题也需显式写「无」
- [ ] `CLAUDE.local.md` 过时说明更新（V-6 顺带发现）—— 若本次收尾顺手处理，确认 `/codex:adversarial-review` 已存在这一事实被更新进 `CLAUDE.local.md`（此项非本 feature 硬性范围，属可选顺手项，不做也不影响主体验收）
- [ ] Codex 对抗审查已按阶段跑过（specify/plan/tasks/implement/verify 各一次）—— 检查每阶段 commit 前是否有对应的 codex-rescue 审查记录，CRITICAL/WARNING 是否已处置或在 commit message 中说明理由
