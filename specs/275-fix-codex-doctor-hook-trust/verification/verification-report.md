# 验证报告 — F275 doctor hook-trust 维度对齐 Codex 插件主路径

## 1. 执行环境

- **HEAD**: `d4d73c96f9e9aa08c58a0bc9890a54370281b611`（工作区在此基础上有未提交改动，见下方改动面）
- **Node**: v24.14.0
- **日期**: 2026-08-31
- **工作目录**: `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/vigorous-mahavira-7de572`

改动面（工作区未提交，`git status --short`）：

```
 M plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs
 M plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs
 M tests/unit/codex-runtime-doctor-redaction.test.ts
 M tests/unit/codex-runtime-doctor.test.ts
?? plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs
?? specs/275-fix-codex-doctor-hook-trust/
?? tests/unit/codex-hooks-list-probe.test.ts
```

---

## 2. [Spec 合规]

**判定：PASS**

FR-009 三情形合同（found / not-executable-or-error / not-probed）与 fix-report「终版判定矩阵」六行在 `classifyHookTrust`
纯函数单测与 io 层集成用例中均有对应覆盖，逐条核对如下：

| 终版矩阵行 | 结论 | 对应测试 |
|---|---|---|
| `found`（≥1 条我方条目，聚合取严） | untrusted / modified / managed→indeterminate / trusted | `tests/unit/codex-runtime-doctor.test.ts` L1298-1354（"F275 T005 — classifyHookTrust 的 nativeProbe 三段优先级"四态）+ L1594-1629（io 层三形态集成用例） |
| `absent`（RPC 成功确证无我方条目） | 回退合并器判据 | L1288-1298（"nativeProbe=null → 走原四分支（回归锚，与现有行为逐字一致）"）+ 既有合并器用例 L1162-1270（F240 T048 四情形固定状态值） |
| `not-probed`（前置门跳过） | `not-applicable`/`hook-trust-not-probed` | L1470-1490 + L1723-1809（"前置门跳过：无 plugins 目录 + 无 hooksJson → helper 从不被 spawn，直接 not-applicable/hook-trust-not-probed"） |
| `not-executable`/`error` + hooksJsonPresent=true | 回退合并器判据 | L1364-1375、L1396-1420（行 4a/4b） |
| `not-executable`/`error` + hooksJsonPresent=false + 插件 cache 证据 | `indeterminate`/`hook-trust-native-unreachable` | L1420-1460（行 5a/5b）+ L1659-1695（io 层畸形输出场景） |
| `not-executable`/`error` + hooksJsonPresent=false + 无插件证据 | `not-applicable` | L1460-1470（行 6b）+ L1695-1723（io 层） |

聚合优先级区分性用例（消变异测试盲区）：L1491-1526 四条（`[modified,untrusted]→untrusted`、`[trusted,modified]→modified`、
`[managed,untrusted]→untrusted`、双注册 `[trusted,trusted,untrusted]→untrusted`）均已补齐，与运行时上下文所述质量审查
"变异实证聚合优先级无守护 → 区分性用例已补" 相符。

主编排器端到端复核 5 场景（真实环境 untrusted warning / 秒退 207ms 真归因 / 只读 home not-applicable / 装插件无 codex
indeterminate / 无插件无 codex not-applicable）已在运行时上下文中确认按终版矩阵工作，本次未重复实跑（超出验证子代理只读职责与本次改动面），
采信主编排器实测结论。

remediation 逐字回填核验（详见 §4 表 7）：**逐字节相同**（取直引号版本，与 fix-report「remediation 逐字一致口径裁决」一致）。

未发现 CRITICAL / WARNING 级别的 spec-code 不对齐。

---

## 3. [代码质量]

**判定：WARNING（1 项结构债，登记不修，按裁决表接受）**

四路审查（spec-review 1C/2W、quality-review 1C/2W、异构对抗假阴性面 4C、异构对抗误报面 4C，合计 9 CRITICAL / 11 WARNING）
的修复闭环核对：

- **CRITICAL 9 项**：全部已修（spec C1 文案中性化 / 假阴 C1-C4 / 误报 C1-C4），逐条见 fix-report「对抗审查后的主线程终版裁决」表。
- **WARNING 11 项**：8 项已修（close/exit 监听、NODE_OPTIONS 污染取最后非空行、absent 语义收窄、stdout 1MB 上限、
  process.exit 回调内退出等），3 项登记不修（`managed` 恒 warning / remediation 表观矛盾 / 判据硬编码 `spec-driver` 字面量 + `enabled:false` 未消费 + bypass 文案不准，均属无实测不猜测的保守裁决）。
- **INFO 若干**：已核实或已修（`SUMMARY_TEMPLATES`/`REMEDIATION_TEMPLATES` export 归属核实、`process.exit` 回调化）。
- **结构债（quality C，唯一未修的 CRITICAL 级发现）**：`core.mjs`（当前 1264 行）/ `io.mjs`（当前 1532 行）连续多轮膨胀超阈值。
  **裁决维持不修**（fix-report 已登记：非本次引入，fix 模式不顺手重构，登记为技术债派生候选）。本验证子代理复核该裁决合理——
  本次改动是在既有文件上做判据扩展而非新建模块，边界收敛到独立新文件 `codex-hooks-list-probe.mjs`（414 行）已是合理的职责切分，
  不做进一步拆分符合"fix 不顺手重构"的仓库约定。

跨文件一致性测试（四值闭集三处字面量重复）已按质量 W-2 裁决新增（"加跨文件一致性测试（把隐性同步契约变成会红的测试）"），
本次全量测试跑批中随其余用例一并验证为绿（见 §4 表）。

---

## 4. 全量门禁结果表

| # | 命令 | 退出码 | 关键输出 | 判定 |
|---|---|---|---|---|
| 1 | `npx vitest run` | 0 | `Test Files 545 passed \| 4 skipped (549)` / `Tests 8033 passed \| 15 skipped \| 12 todo (8060)`，耗时 87.99s | **PASS**（=期望 ≥8033，命中 8033 精确值；8060 总量级达成） |
| 2 | `npm run test:plugins` | 0 | `tests 1585` / `pass 1583` / `fail 0` / `skipped 2` | **PASS** |
| 3 | `npm run build` | 0 | `tsc` 零错误，`postbuild:stamp` 正常盖章（commit=d4d73c96 dirty） | **PASS** |
| 4 | `npm run repo:check` | 0 | 全部规则 pass，仅 1 条既存 warning：`[graph-quality] 图产物已 stale（source-commit）` | **PASS**（零新增） |
| 5 | `npm run release:check` | 0 | `Release contract valid`；仅 1 条既存 warning：`[publish-gap] 发布断层领先量无法判定（sourceStatus: indeterminate）` | **PASS**（零新增） |
| 6a | `npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts` | 0 | `33 tests passed`（F240 T047 十一注入点×五通道×四编码全绿，含新增 RPC/子进程通道） | **PASS**（F240 FR-012 脱敏零回退） |
| 6b | `npx vitest run tests/unit/codex-plugin-registration.test.ts` | 0 | `51 tests passed` | **PASS**（F264 双注册守卫零回退） |
| 6c | `git diff HEAD --stat -- plugins/spec-driver/scripts/lib/codex-plugin-registration.mjs` | 0 | 空输出 | **PASS**（零改动） |
| 6d | `git diff HEAD --stat -- plugins/spec-driver/scripts/lib/codex-hooks-schema.mjs` | 0 | 空输出 | **PASS**（零改动） |
| 6e | `npx vitest run tests/unit/codex-runtime-doctor-cli.test.ts` | 0 | `14 tests passed`（F240 T051 --strict 场景全绿） | **PASS**（预期零改动，T021 判据兑现） |
| 6f | `npx vitest run tests/unit/codex-hooks-list-probe.test.ts tests/unit/codex-runtime-doctor.test.ts` | 0 | `157 tests passed`（新增探针 34 用例 + doctor 核心 123 用例） | **PASS** |
| 7 | remediation 逐字 diff（node 脚本按 `eval` 抽取 core.mjs 字符串字面量 vs verification-report.md L23 剥 `> ` 前缀） | — | `EQUAL: true`（180 字符逐字节相同） | **PASS**（取直引号版本，与裁决口径一致） |
| 8 | `grep -c 'RAW-IO-SITE-BEGIN'` / `RAW-IO-SITE-END'`（`codex-hooks-list-probe.mjs`） | — | 各 = 1 | **PASS**（标记对唯一性） |
| 9 | `grep -n '\.stdout\|\.stderr'` 排除 `process\.` 前缀（core.mjs / io.mjs / codex-runtime-doctor.mjs 三文件） | 1（无匹配） | 三文件均零命中 | **PASS**（生产文件无裸 `.stdout`/`.stderr` 访问） |

---

## 5. SC-013 复测状态

**标注：PENDING-user**

- untrusted / modified 两态的自动化断言已在单测覆盖（§2 表格所列 `classifyHookTrust` 纯函数用例 + io 层集成用例），本次门禁全绿。
- trusted 态需要一次用户在 Codex UI 中手动执行 `/hooks` → 按 `t` 授信的交互操作（≈5 分钟），该操作**不可自动化**（需要真人在图形/终端界面上按键确认，非 headless 可驱动）。
- 沿用 F269 先例：验收节标 `PENDING-user`，待用户完成该交互后，回填 `specs/240-codex-runtime-closeout/verification-report.md` 复测节（该文件已在
  T032 依赖链中明确为落点之一）。
- **T032 本身不在本次 implement/verify 范围内**（tasks.md 明确标注"此任务不属于本次 implement 范围，留待环境恢复后单独执行"），本报告不越权代为判定。

---

## 6. 遗留登记项清单（抄录自 fix-report「对抗审查后的主线程终版裁决」表，"不修"项）

| 来源 | 发现 | 裁决 |
|---|---|---|
| 误报 W-6 | `managed` 恒 warning 对企业车队是噪声 | 不修：维持 plan §1.1（无实测不猜测语义），登记已知限制，待 `managed` 实测后另卡处理 |
| 误报 W-3 | remediation 指向 /hooks 但 RPC absent 时列表"可能没条目" | 不修：F264 实证合并器写入的 hooks.json 条目同样出现在 /hooks（source=user），文案仍可执行；登记表观矛盾 |
| 质量 C（结构债） | core.mjs 1264 行 / io.mjs 1532 行连续多轮膨胀超阈值 | 不修：非本次引入，fix 模式不顺手重构；登记为技术债派生候选（按 category 拆分） |
| 假阴 W2 | 判据硬编码 `spec-driver` 字面量，rebrand 即全线失效 | 不修：改名属发布层决策，发生时必然全仓普查；登记 |
| 假阴 W3 | `enabled:false` 条目不消费（禁用条目仍报 untrusted warning） | 不修：per-hook 禁用无端到端实测，无实测不猜测；现状方向是取严多报，登记 |
| 假阴 I3 | `bypass_hook_trust` 开启时"不会执行"文案不准 | 不修：bypass 是 FR-010 明令禁止进产品路径的危险 flag，用户自开时文案偏差可接受；登记 |
| 假阴 I4 | 顺带实证 `[hooks.state."<key>"]` + `trusted_hash` 段形态（非交互授信实跑生效） | 不在本卡消费：合并器 `present-unconfirmed` 升级为真解析是独立增强，登记为派生候选；本卡合并器 fallback 保持现状 |
| 缺陷 3(b) | `hook-script-integrity` advisory check（脚本字节篡改不可见性） | 不实施：需独立的插件发布内容可信基准来源设计，塞进本卡会显著放大验证面；派生独立卡 |

另：T063（F239 T039 Codex 桌面客户端 managed worktree 同步）为 M9 遗留人工验证挂账项，与本卡无关，不在本次验收范围内，登记于
`specs/240-codex-runtime-closeout/verification-report.md`。

---

## 7. 结论

**本卡达到可 commit 状态。**

- 全量门禁（vitest 全仓 / test:plugins / build / repo:check / release:check）零失败、零新增 warning/error。
- 目标回归护栏（F240 FR-012 脱敏、F264 双注册守卫、F262 W2、F265 doctor commit 比对相关的 codex-plugin-registration.mjs
  与 codex-hooks-schema.mjs 零改动）均定点复核通过。
- FR-009 三情形合同 + 终版判定矩阵六行在自动化测试中均有对应且已验证通过；remediation 文案逐字节核验一致。
- 结构性质量债（core.mjs / io.mjs 行数超阈值）为已知登记项，非本次引入，不阻断交付。
- 唯一未闭合项是 SC-013 trusted 态的真人 UI 交互复测（`PENDING-user`），按仓库既有先例（F269）与 tasks.md 明确的范围声明，
  不阻断本次 implement/verify 收口，待用户完成交互后回填 `specs/240-codex-runtime-closeout/verification-report.md`。
