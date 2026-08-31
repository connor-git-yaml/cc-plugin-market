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
- [x] T201 窗口下界回归钉——**✅** 端到端「全合规 + 尾部 doc → hook 仍 exit 0」检测器（半吊子修法=只修 isFix 不切窗口会红）+ report 模式 fixSession 正面。
- [x] T202 isFix 存在性——**✅** 仅 doc→false / fix→doc→true / 多次 fix→true（core + 端到端）。
- [x] T203 闸门三基线**不变**回归钉——**✅** earliestFix 与 anchor 逐位一致（含 multi-expansion fixture）。
- [x] T204 5 消费点窗口切换——**✅** core 级 A/B 实证：fix→委派→尾部 doc，latestFix 窗保住委派、anchor 窗切掉（病根 iv 误伤面实证）。
- [x] **T2b（追加）审计黑洞收口**——合规早退落审计（FR-024）+ 空 transcript 落 `transcript-empty`（FR-045）；schema enum 同步（FR-049）；既有 F240/F256/F257 断言按 spec 裁决更新留痕。

### 实现
- [x] T205 `detectFixSkillExpansion` 同趟增产 `latestFixLineIndex`（earliest/anchor 保持不变）——**✅ core 587/0**。
- [x] T206 isFix 判据 → `earliestFixLineIndex !== null`（存在性）——**✅**，over-claim 措辞如实化（resume/sidechain/跨会话既有边界不封）+ W-3 新误阻断类按 F256「类 X」登记。
- [x] T207 5 消费点入参切换 latestFix——**✅** judge 258/395/420/436/489；`anchorLineIndex` 仅剩注释无代码消费（grep 复核）。
- [x] T208 `anchorLineIndex` 孤儿处置——**保留字段**（返回形状/mode 诊断依赖）；I-1 承重注释漂移（形态 3）已随代码改。
- [x] T209 **Phase 收尾 · 异构对抗 ×2**——**✅ 两路均 0 CRITICAL、净收窄**（fail-open A：latestFix 单调+空窗自伤BLOCK；fail-closed B：latestFix≤anchor→窗口⊇→不可翻block，实测确认）。留痕 `verification/p2-adversarial.md`。5 次级发现全处置。

---

## Phase 3 · 在途三态 + 解锁计时器（三计时器组合，高风险，plan §4c）

### 🔴 红先行
- [x] T301 在途三态——**✅ 8/8**（in-flight-verdict.test：三态不坍缩/独立码/非数组归 undetermined/type 不承重）+ 端到端 2 条（in-flight 推迟 / undetermined 退回 transcript 派生）。
- [x] T302 阈值不变量——**✅** `NON_BLOCK_LIMIT >= BLOCK_LIMIT` 导出常量断言（delta-2 定时雷钉死）。
- [x] T303 擦库不 brick——**✅** 每轮 `rm -rf` 状态目录 5 连,不锁死。
- [x] T304 换桶有界——由 T305 耗尽路径 + backstop 覆盖；完整换桶矩阵语料留 P6 SC-015 验收。
- [x] T305 终态标注——**✅** 重入耗尽 → 终态事件带 `nonblock-limit-exhausted`（与 blockCount-degraded 可区分,SC-014）。
- [x] **T3b（追加）带回合同回归钉**——重入计数不被 routeBlock/推迟写入抹平。**自查抓到真 bug**：4 处旧 save 调用点全漏带新字段（grep 实证 0 处带回）→ 修复 + 钉死。

### 实现
- [x] T306 `lib/in-flight-verdict.mjs`（100 行）——三态纯函数;结构性判据;type 只进文案。
- [x] T307 io `normalizeState`/`saveBlockState` 加 `nonBlockStopCount`(缺失→0) + `firstNonBlockEntryBaseline`(非整→null)——io.test 65/0,含"不带回即抹平"合同钉。
- [x] T308 **4 处**(非 plan 预估 3 处)save 调用点带回：routeBlock / releaseDegraded(签名+两调用点) / 推迟分支 / routeNonBlock 自身。
- [x] T309 `routeNonBlock`：快路径 `>=NON_BLOCK_LIMIT(=BLOCK_LIMIT=2)` ∥ backstop `entryDelta>=NON_BLOCK_ENTRY_LIMIT(420)`（首次 nonBlock 设锚,transcript 派生不可擦）。
- [x] T310 FR-016/019：in-flight(harness) 进既有三闸门推迟,预算照旧消耗 `inFlightDeferCount` 不动 `blockCount`;no-in-flight 权威覆盖不推迟(US2-AS2);undetermined 退回 transcript 派生(向后兼容)。
- [x] T311 FR-046：重入(必答③)接入 routeNonBlock——不计 blockCount、计 nonBlockStopCount、耗尽走终态可见 paused + 触发标注;非布尔 stop_hook_active 按非重入。GATE 指纹去重通道预留同路由(指纹含账本条目数,随 P4 落)。
- [x] T312 save 失败 → 视同耗尽走终态可见放行(fail-closed,无静默通道)。
- [x] T313 **Phase 收尾 · 异构对抗 ×2**——已派(fail-open 计时器绕过 / fail-closed 误伤锁死),留痕 `verification/p3-adversarial.md`。
- 判定链新模块入 `JUDGE_FILE_SET`(7→8) + 四处断言同步(计数断言改 length 派生防再硬编码);schema enum +7 新码(FR-049)。

---

## Phase 4 · 账本接入委派判定（改判据主输入，高风险，plan §4d）

### 🔴 红先行
- [x] T401 账本缺席回退等价——**✅** 账本缺席→纯 transcript（对抗 B 逐字核实严格等价，所有存量会话零回归）。
- [x] T402 部分缺席/窗口未定——**✅** null-timestamp→windowUndetermined+空补充（对抗 WARNING-2 修订：不跨周期回流）；坏行跳过计数；无 hookTs 保守剔除。
- [x] T403 去重语义——**✅** 同 id 内容一致静默折叠 / 不一致落 ledger-entry-conflict（去重键 subagent_type 全值，FR-048）。
- [x] T404 账本补齐端到端——**✅** transcript 尾部缺委派 + 账本有 implement/verify → 补齐合规 exit 0；窗口过滤切旧轮。

### 实现
- [x] T405 `lib/ledger-reader.mjs`——读+逐行解析（坏行跳过计数）+去重+hookTs 窗口过滤；只产 Agent/Task（D-1）；缺席/窗口未定→空。
- [x] T406 委派来源接入 evaluate——transcript ∪ 账本**补充语义**（非替代取严，对抗 WARNING-1 如实化）；account 缺席回退 transcript；F216 见证/执行记录**不碰**（D-1）。
- [x] T407 ~~FR-008 方向性优先 + 矛盾交叉~~——**改为补充语义 + ledger-supplemented-role 诊断**（对抗核实 FR-008 强形态的"取严"本就审计-only、挡不住伪造；补充语义下界更保守，如实登记不 over-claim）。
- [x] T408 委派下界下降守卫——注释如实登记（harness 背书→hook 记录+可写，D-1 用户拍板"只防疏忽"）；normalizeTranscriptEntry 加 timestamp / detectFixSkillExpansion 加 latestFixTimestamp（窗口对齐）。
- [x] T409 **Phase 收尾 · 异构对抗 ×2**——**✅ 无 CRITICAL**（A：伪造在已接受边界内，2 WARNING 全修；B：误伤面单调 ≤0，2 WARNING 全修）；留痕 `verification/p4-adversarial.md`。
- ledger-reader + ledger-writer 入 `JUDGE_FILE_SET`（8→10，reader import writer 的 ledgerPathFor）；五处断言同步；schema enum +3 码。时间戳格式承重假设加守卫钉。

---

## Phase 5 · 分发登记 + 清单同步（机械但漏一处即红，plan §4a 裁决五）

- [x] T501 `hooks/hooks.json` 加 PostToolUse 账本 handler——**✅** matcher 空（全工具触发 FR-001）;PostToolUse 下现两条（prettier + 账本），与 Stop 下两条同构。
- [x] T502 `codex-hooks-schema.mjs` 双处登记——**✅** `OWNED_HOOK_SCRIPT_SUFFIXES`(6) + `OWNED_HOOK_EXPECTED_EVENT`(6) 一致;「恒 5 条」口径改 6（F264/C-11）。
- [x] T503 `JUDGE_FILE_SET`——**已在 P3/P4 完成**（in-flight-verdict + ledger-reader + ledger-writer，7→10，五处断言 length 派生）。
- [x] T504 verdict-event schema enum——**已在 P2/P3/P4 增量补**（transcript-empty / 7 在途计时器码 / 3 账本码）;守卫不照抄单文件模板。
- [x] T505 验收——**✅** codex-hooks 单测 92/92（TS 侧,含 event-gate C4 回归钉与 installer 卸载计数 5→6;fixture ownedFourEventDoc PostToolUse 补账本 handler）;双处登记 6/6 一致;test:plugins 全量 1655/0。

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
