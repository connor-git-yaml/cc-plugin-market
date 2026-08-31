# Tasks: F270 依从性证据账本（Compliance Evidence Ledger）

> 由 plan.md 的 6 Phase 展开。格式 `[ID] [P?] 描述（文件·函数）`；`[P]` = 与同 Phase 其他任务无依赖、可并行。
> **门禁类第十轮纪律**：每个「判定器 Phase」（P2/P3/P4）收尾**必须**独立异构对抗（≥2 切入角）；TDD 红先行——先写会红的测试，再改实现使其绿。
> **交付边界（用户裁决 A，2026-08-31）**：本卡 spec/plan/tasks/research 打包交付；**implement 留到子代理环境恢复后另开会话**（第十轮门禁改动缺异构对抗子代理不可开工，F229 实证同构全漏）。以下任务为 implement 就绪清单，非本次执行。

## 前置（implement 开工前必做，plan §8）

- [x] T000a 实测 `AskUserQuestion` 是否触发 PostToolUse——**✅ 直证（2026-09-01）**：探针捕获 `tool_name: AskUserQuestion` 完整 payload（含 tool_response）。A-4 可选增强的承重前提成立。
- [x] T000b 实跑 `npx vitest run` 取基线——**✅（2026-09-01）**：**7894 passed / 18 skipped / 21 todo (7933)，538 files passed / 4 skipped，exit 0**。SC-008 双基线对照数齐（test:plugins 1585/0/2skip + vitest 7894/0）。
- [x] T000c 复核 `anchorLineIndex` 全仓消费者（plan §8 矛盾1）——**已复核（2026-09-01）**：judge 中实际消费恰为 5 处（:239/:376/:401/:417/:470），其余全是注释；core 中除返回值构造（:580/:596）外均为通用形参名。**裁决：切换后保留字段（避免破坏返回形状），但 MUST 同步改写注释链**——core:562「主锚点语义逐字不变——F216/F227/F224 全链依赖它」与 core:981/judge:230/:351 等在切换后语义过时，不改则注释变误导（并入 T208）。

---

## Phase 1 · 账本采集器（不碰判定器，风险低，可先行）

### 红先行
- [x] T101 [P] 并发测试——**✅ 8 进程 × 150 条,总行数/逐行解析/每写手条数全对**（SC-006）。
- [x] T102 [P] 失败注入——**✅ 空 stdin/非 JSON/Codex 方言/目录只读 全部恒 exit 0 + 零 stdout/stderr + selfdiag 落账**（SC-005）。
- [x] T103 [P] 裁剪——**✅ 100KB tool_response.prompt 不入条目（<1KB）、subagent_type 全值、agent_id 缺席即缺席**。
- [x] T104 [P] 活性——**✅ ledger-open 哨兵首写/幂等、超 1MB 拒写 + selfdiag oversize、路径穿越 session_id 清洗**。
  （红先行过程：先写测试 → import 红 → 实现 → 14/15 绿 → 1 红为测试自身过滤器误伤（点前缀通配误排除 `.._.._evil.jsonl` 合法产物）→ 修测试过滤为精确 selfdiag 名 → **15/15 绿**）

### 实现
- [x] T105 `lib/ledger-writer.mjs`（206 行）——纯 Node 内置；`buildLedgerEntry` 裁剪 + `appendLedgerEntry` 追加 + CLI 形态（stdin→append→恒 exit 0）；复用 `isInvokedDirectly`（F246 守卫）。
- [x] T106 `hooks/post-tool-use-ledger.sh`（56 行,755）——与 stop-fix-compliance-check.sh 同构三级探测；**恒 exit 0 且吞 CLI 全部输出**（与阻断型薄壳的关键差异已注释）。
- [x] T107 账本布局——`.fix-compliance-ledger/<sanitized>.jsonl`；`sanitizeSessionId` **直接 import 复用**（io:280 本就已 export,io.mjs 零改动）；LEDGER_MAX_BYTES=1MB。
- [x] T108 活性哨兵——首建写 `ledger-open`（并发双哨兵可接受,读取侧幂等已注释）；Codex 运行时分派属 P4 读取侧（P1 只负责 dialect-skip 静默 + selfdiag）。
- [x] T109 **Phase 收尾**——真实 payload 端到端 ✅（exit 0 + 哨兵 + 裁剪条目正确）；判定器/hooks.json **零接触**（git diff 实证）；test:plugins 全量见 verification。

---

## Phase 2 · 锚点三分（判定器核心，**最高风险**，plan §4b）

### 🔴 红先行（病根 iv 真验收，比"isFix 不翻转"深一层）
- [ ] T201 写窗口下界回归钉：语料 `fix展开 → Write fix-report → Agent(implement) → Agent(verify) → 尾部 spec-driver-doc 展开`。**当前实现**：`extractDelegationsAfter` 窗口从 doc 行起 → 委派空 → 误判缺失（**断言此刻红**）。改后应绿。
- [ ] T202 写 isFix 存在性测试：`仅 doc 无 fix`→isFix=false；`fix后接doc`→isFix=true；`多次fix`→仍 true（FR-022/023）。
- [ ] T203 写闸门三基线**不变**回归钉：`earliestFixLineIndex` 语义与取值改动前后逐位一致（复用 `core.test:4625` 家族，防 FR-025 类回退）。
- [ ] T204 写 5 消费点窗口切换的逐个断言：每个消费点（judge:239/376/401/417/470）在"fix后接doc"语料下，证据窗口以 `latestFixLineIndex` 为界而非 `anchorLineIndex`。

### 实现
- [ ] T205 `core:detectFixSkillExpansion`：同趟增产 `latestFixLineIndex`（最晚一次 *fix* 展开）；`earliestFixLineIndex` / `anchorLineIndex` **保持不变**（core:1082 红字）。
- [ ] T206 `judge:201` isFix 判据：`anchor.mode==='fix'` → `earliestFixLineIndex !== null`（存在性）。
- [ ] T207 5 消费点入参切换：judge:239/376/401/417/470 从 `anchor.anchorLineIndex` → `anchor.latestFixLineIndex`。
- [ ] T208 `anchorLineIndex` 孤儿处置（承 T000c 结论）：删除或保留 + 注释说明。
- [ ] T209 **Phase 收尾 · 异构对抗 ×2**（切入角：① 锚点仍可翻转/绕过面 ② 窗口切换致新误阻断面）。修复所有 CRITICAL，重跑 T201-204。

---

## Phase 3 · 在途三态 + 解锁计时器（三计时器组合，高风险，plan §4c）

### 🔴 红先行
- [ ] T301 [P] 在途三态测试：`background_tasks` 非空/空数组/键缺席 → in-flight/no-in-flight/undetermined 三诊断码，**不坍缩**（SC-002；真实语料 + 合成 undetermined）。
- [ ] T302 [P] 阈值不变量测试：断言 `NON_BLOCK_LIMIT >= BLOCK_LIMIT`（spec 硬化 MUST；delta-2 定时雷）。
- [ ] T303 [P] 擦库不 brick 测试：每 Stop 前 `rm -rf` 状态文件 → backstop（transcript 派生量）仍触发终态放行，会话不锁死（SC-015；delta-2）。
- [ ] T304 [P] 换桶有界测试：交替制造 不合规/in-flight/零工具回合 → 非终态 Stop 次数 ≤ 三计时器容量和，最终必落终态放行（SC-015；delta-2 Q1）。
- [ ] T305 [P] 终态标注测试：耗尽 `blockCount` vs 耗尽 `nonBlockStopCount` → 终态记录触发标注**不同**（SC-014；delta-2 Q3）。

### 实现
- [ ] T306 `lib/in-flight-verdict.mjs`：`background_tasks` 三态；承重判据只用结构性事实；`type` 只进诊断文案（FR-014-018）。
- [ ] T307 `io:normalizeState`：加 `nonBlockStopCount`（缺失→0）+ `firstNonBlockEntryBaseline`（backstop 锚）；`saveBlockState` payload 同步。
- [ ] T308 三处 `saveBlockState`（judge:541/609/769）「原样带回」名单加 2 新字段（**漏带即整体覆写清零**，reverse-census §6）。
- [ ] T309 解锁计时器判据：`shouldTerminalRelease = (nonBlockStopCount >= NON_BLOCK_LIMIT=2) || (assistantEntriesSinceFirstNonBlock >= NON_BLOCK_ENTRY_LIMIT)`，**以 backstop 不可擦量为准**（plan §4c）。
- [ ] T310 FR-016/019 落地：in-flight 不消耗 `blockCount` 但**消耗** `inFlightDeferCount`（delta C-2，闸门二保留合取）。
- [ ] T311 FR-046 落地：FR-027/028/029/必答③重入/A-4 指纹去重统一「不计 blockCount、计 nonBlockStopCount」；耗尽走终态可见放行（写 recordWorkflowRun，SC-014）。
- [ ] T312 save 失败 fail-closed：新计时器 save `ok:false` → 按已达上限（不给额外放行，沿用 :547/:773）。
- [ ] T313 **Phase 收尾 · 异构对抗 ×2**（切入角：① 三计时器换桶/组合绕过 ② 计时器致误阻断/锁死面）。

---

## Phase 4 · 账本接入委派判定（改判据主输入，高风险，plan §4d）

### 🔴 红先行
- [ ] T401 [P] 账本缺席回退等价测试：删/空账本 → 委派判定回退 transcript，结论与变更前逐条一致（SC-007 组件级）。
- [ ] T402 [P] 部分缺席回退测试：账本存在但条目不全（`git clean` / matcher 不全 / 中途不可写）→ 回退 transcript，**不以残账本裁决**（FR-047）。
- [ ] T403 [P] 去重语义测试：同 `tool_use_id` 内容一致→静默去重；内容不一致→`ledger-entry-conflict`；截断相同的不同委派**不**被误折叠（FR-048/delta W-6）。
- [ ] T404 [P] 方向性交叉测试：账本有委派 + transcript 完整区段无 → 矛盾诊断 + 取严；transcript 尾部缺证 → 账本优先（FR-008）。

### 实现
- [ ] T405 `lib/ledger-reader.mjs`：读账本 + 逐行解析（坏行跳过计数，FR-010）+ 去重（FR-048）+ `latestFixLineIndex` 时间戳窗口过滤。
- [ ] T406 `extractDelegationsAfter` / `extractInFlightDelegationsAfter` 委派来源：账本可用时以账本为主源，缺席/部分缺席回退 transcript（D-1 只此两点，见证/执行记录**不碰**）。
- [ ] T407 FR-008 方向性优先 + 矛盾交叉诊断码。
- [ ] T408 委派证据下界下降登记项的守卫测试（delta C-3：确认下界降级已在诊断中可见）。
- [ ] T409 **Phase 收尾 · 异构对抗 ×2**（切入角：① 账本可写载体作主源的伪造面 ② 部分缺席/回退致误阻断面）。

---

## Phase 5 · 分发登记 + 清单同步（机械但漏一处即红，plan §4a 裁决五）

- [ ] T501 `hooks/hooks.json` 加 PostToolUse 账本 handler。
- [ ] T502 `codex-hooks-schema.mjs`：`OWNED_HOOK_SCRIPT_SUFFIXES`(:100-106) + `OWNED_HOOK_EXPECTED_EVENT`(:120-126) 双处登记新 handler；「恒 5 条」口径改 **6 条**（FR-037/C-11）。
- [ ] T503 `judge-snapshot-core.mjs:16-25` `JUDGE_FILE_SET` 加新判定链模块；**4 处** length 断言同步：`core.test:344`/`:362`、`doctor-cli.test:28`（独立副本）、`doctor.test:60`（注释）（FR-038/C-W2）。
- [ ] T504 `contracts/fix-compliance-verdict-event.schema.json` 闭合 enum 加新诊断码；合同守卫**不照抄**"只读 judge 单文件"模板（新码由新 lib 发出，FR-049/delta 认定）。
- [ ] T505 验收：`--codex-home <隔离目录>` 对真实安装跑 → 恒 6 条不重复（SC-010，**不**用 `--target` 对 canonical 跑，那基线本就 fail，§4.1）；`npx vitest run` TS 侧绿（SC-008）。

---

## Phase 6 · 真实 fixture 录制 + 验收收口

- [ ] T601 脱敏 `.specify/runs/f270-raw-payloads/` 101 份真实 payload（3 Stop + 4 SubagentStop + 94 PostToolUse）→ `tests/fixtures/fix-compliance/real-*.jsonl`；沿用现有 README 脱敏规则 + 保留字段存在性/形状/序列（必答④）。
- [ ] T602 主验收语料 acceptance：三态在途、账本消费主路径、`stop_hook_active` 重入、`last_assistant_message` 缺席vs陈旧 至少各一条跑真实语料（SC-009）。README 登记录制环境（CC 2.1.220）+ 脱敏项。
- [ ] T603 性能锚点（SC-011）：账本满上限读取 < 阈值（建议 ≤200ms）；采集器单次开销实测 < 阈值（≤50ms，已测 node 冷启 18ms）。
- [ ] T604 `npm run judge:doctor`（G-8/F236）：说明生效时点——`settings.local.json` 热加载 vs 插件快照不热加载（C-7）；本机快照基线本就 drift（S-3），验收判"本次引入文件相对基线增量"。
- [ ] T605 全量验收：`npx vitest run` + `npm run test:plugins` 双基线零新增失败（SC-008）；`repo:check` + `release:check`；15 个 SC 逐条核对。
- [ ] T606 dogfooding 四维反馈 → `docs/design/dogfooding-feedback-ledger.md`（有实质反馈才 append）。

---

## 交付前门禁（implement 完成后，非本次）

- [ ] 全部 CRITICAL 收口，判定器 Phase 各留异构对抗留痕；commit 标注「Codex 审查暂停，异构档位缺席」。
- [ ] 五量守卫全绿（plan §6）；G-1..G-10 护栏各配守卫。
- [ ] push 前 7 字段 report 等用户确认（CLAUDE.local.md）。
