# F241 — Codex 对抗审查整改单（Specify phase）

> 结构：finding → 编排器验证 → 处置 → 证据/去向。逐条处置，不表演式同意。
> 审查会话：codex `task-msc13f61-dgrxn8`（6 CRITICAL / 7 WARNING / 1 INFO）。

## CRITICAL

### C1 分发边界未决，FR-007 不可实施 → **确认，编排器拍板选 A**
- **验证**：与我先行核实的 V-1 同源且互证（安装缓存无 `graph-bootstrap-status.mjs`；双 marketplace source 均只指 `plugins/spec-driver`）。Codex 额外抓到 spec.md 两处残留旧叙述（「直接 import 仓根 / 待核实」）——属实，D8 修订时漏清。
- **处置**：**不再推给 plan，spec 层直接定拓扑 = 方案 A**：canonical 移入 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`，仓根 `scripts/lib/graph-bootstrap-status.mjs` 改薄 re-export。三个消费方全部可达（B4 CLI 在插件内、sync 脚本与 lifecycle hook 均跑在仓内 checkout）。已知代价入 plan：`tests/unit/worktree-lifecycle-hook.test.ts:109` 的 copy 行为需改为从 canonical 路径 copy（薄 re-export 单独拷走会断相对路径）。
- **附加验收**（采纳 Codex 建议的轻量版）：新增 SC——把 `plugins/spec-driver/` 整体拷到仓外临时目录模拟安装态，从那里跑决策 CLI 的 `--dry-run`，断言可运行（import 不断链）。

### C2 求值顺序把真实输入送错分支 → **确认（我此前的 O-6 修订只对了一半）**
- **验证**：反例 1（`unknown`+`missing`+`allowed` 命中行 2，违背 EC-01 应刷新）成立——行 1-2 在 availability 行之前，我修订时只锁了「availability 先于 freshness」，没看到「classification 先于 availability」这层。反例 2（`stale`+`out-of-scope`+`allowed` 白白重建 4.4s 后仍不可用）成立——coverage 判定排在行 12 太靠后。
- **处置**：**矩阵改 v2 顺序**：additive-only → **out-of-graph-scope（升到第 2 位：范围外时重建无意义，直接降级给 Grep 路径）** → corrupt/missing×policy → **classification-unknown（availability 之后：图在手才谈得上降级消费）** → stale/dirty×policy → unknown-provenance → fresh 收口。并显式定义**刷新成功后的收口**：`changeClass=unknown` → `consume-degraded/classification-unknown`，否则 `consume-impact`（+FR-006 caveat）；**不重跑矩阵**（重跑会因 dirty-after-rebuild 误降级，EC-07 论证过）。顺序不变量测试从 1 条扩为 2 条（missing 探针 + out-of-scope 探针）。

### C3 FR-008 无状态 CLI 下不可保证 → **确认，采纳收窄方案**
- **验证**：成立。CLI 无状态、EC-13 禁锁、审计写在决策后不能当原子 claim——三点都对。
- **处置**：按 Codex 方案二收窄：**进程内 single-flight 是硬保证**（一次 CLI 调用内绝不 spawn 两次，可测）；**跨调用 once-ness 是调用方合同**——编排层/goal_loop 在同一 phase 第二次起必须传 `--refresh-policy declined`（写进 SKILL 散文与 FR 文案）。SC-007 改为：(a) 单调用内 spawn 计数 ≤1 的进程内断言；(b) 按调用方合同模式（第二次 declined）跑两次的集成断言。删除「无锁又要跨进程互斥」的原表述。

### C4 goal_loop 消费时点与 D3 权威判定冲突 → **确认，拆双合同**
- **验证**：成立。goal_loop 步骤 2 注入发生在该轮 implement **前**，第一轮不存在「本轮 diff」；我的 V-2 只证了「无需改 core」，没解时序。
- **处置**：拆两个契约并写进 FR-011：
  - `pre-implement advisory`：轮 1 用 tasks.md 路径存在性 + phase 起点 diff（轮 ≥2 用累计 diff），输出**必须标 `advisory: true`**，仅决定「是否预刷新」与注入语气，禁止产生「impact 不适用」的权威结论；
  - `pre-verify authoritative`：implement 后用实际 diff 做权威消费判定（B4① 的本义）。
  goal_loop 步骤 2 的注入定性为 advisory grounding。

### C5 脱敏可绕过 + 数据路径未 ignore → **确认，四点全收**
- **验证**：中文姓名/内部代号/自然语言口令/带分隔符手机号穿透六规则——成立（这类形态本就在 D5 的「结构性遮蔽」能力之外）；`git check-ignore` 两路径未忽略——成立且我漏查（Codex 用 `--non-matching` 实测）；「k-匿名」名不副实（无主体标识）——成立。
- **处置**：
  1. **改名**：k-匿名 → **minimum-occurrence threshold**（最小出现阈值），全文不再声称匿名性保证；
  2. **收窄声明**：删除「原文在任何环节都不落盘」的绝对化表述 → 改为「原始查询串**整串**不落盘；落盘的是 redaction 后按仓内 tokenizer 切词的 term + 归一化查询的 hash」——term 仍可能含未识别的敏感词，靠「默认关闭 + gitignore + 保留期 + 本地文件」四层兜底，如实写明残余风险；
  3. **聚合键锁死**：`distinctQueries` = 含该 term 的**不同 normalizedQuery hash** 数（同一查询重复 N 次 = 1）；
  4. **新增 FR + SC**：仓库 `.gitignore` 与插件 `ensure-gitignore.sh` 自举清单**同步**加入 `.specify/kb-nohit/` 与 `.specify/graph-consumption-audit.jsonl`，SC 用 `git check-ignore` 断言（含模拟第三方 repo 的安装态检查）。

### C6 SC-005 的 13 值与 FR-006 caveat 通道矛盾 → **确认，机械修**
- **处置**：枚举拆两组：`DEGRADED_REASONS`（12 值）+ `CAVEAT_CODES`（`coverage-gap-known-extraction-limit`，仅走 `caveats[]`）。SC-005 分别断言两组。FR-004 表格同步拆分。

## WARNING

### W1 五维「必须且只须」与 `impactResult?` 第六字段冲突 → **确认**
- **处置**：FR-006 caveat 拆为独立后置纯函数 `annotateImpactCaveat(decision, impactResult)`；FR-002 保持五维严格校验；CLI 时序 = 决策 → （若消费）调 impact → 注解。

### W2 「本轮 diff」无 phase 基线 + rename 解析格式错 → **确认**
- **处置**：CLI 增加 `--base-ref`（权威判定用 phase 起点 ref；由调用方合同提供，goal_loop 用轮快照 S_i 的锚点）；解析器锁定 `git diff --name-status -z` 与 `git status --porcelain -z` 的 **NUL 分隔**契约（spec 原样本 `R100 old -> new` 是人读格式，修正 fixture）。

### W3 审计文件存 freshness 快照 vs RG-006「唯一事实源」 → **确认（措辞层）**
- **处置**：RG-006 改为「唯一**权威计算**源 = `checkFreshness`」；审计里的 freshness 是**观测快照**，显式标注非权威；新增依赖测试：生产决策代码禁止读审计文件作为输入。

### W4 多条护栏可纸面过关 → **部分确认**
- **处置**：RG-008 改用 **SHA-256** 对比（mtime+size 可伪）；RG-009 增加退出码 + stderr 断言；SC-004 弃用中文关键词黑名单 → 改为**结构化约束**：CLI JSON 输出无自由文本评价字段，人读 summary 必须是 degradedReason 枚举的固定模板映射（枚举→模板表可测）；SC-008 补「允许态确实注入 / 拒绝态确实不注入」的正反两向断言（以 goal_loop 迭代日志字段 + CLI 输出为证据面；SKILL 散文层无自动化先例，如实标注该残余）。
- **不采纳项**：无。

### W5 pilot SC 缺 ground truth → **部分确认**
- **处置**：新增 `pilot/ledger.jsonl`（机器可读调用台账，与 markdown 双写）+ 一个小验证脚本从 ledger 重算 M-1 计数、比对报告数字；口径文件的「无 diff」断言在 pilot 文档首次 commit 后锚定具体 SHA；M-3 落盘两组 prompt 与 diff hash。**如实保留的局限**：台账仍是自报（减少算术漂移，不消除自报偏置）——该声明进报告，不冒充已解决。
- **不采纳项**：SC-017 的「禁止外推表述」不可能穷举黑名单——正向声明（五项必含）保持机器 grep，禁止项改为 push gate 人工审查项，SC 文案如实改写。

### W6 KB freshness 公式与多 lockfile resolved 语义未定 → **确认**
- **处置**：FR-019 写死公式：`activityAt = max(built_at, ingested_at)`（最近活动），`freshness` 由 `now - activityAt` 对阈值表求值；同时输出 `oldestBuiltAt` 供可见性（不参与判级）。多 lockfile 且无显式版本：`resolved = { status: "ambiguous", version: null }` + 全量 `candidates[]`（契约扩 `resolved.status`）。

### W7 k=2 / 30 天 / npm-only 既是 OQ 又是必须 → **确认（状态矛盾）**
- **处置**：三参数改标 **proposed-default（按此实现）**；OQ-2/OQ-3 改写为「已按默认值实现，push gate 报告中列出，用户可否决 → 后续以 fix 流程调参（参数集中在常量模块，调整成本低）」。spec 由此 decision-complete。

## INFO

### I1 范围过载 / 拆批建议 → **部分采纳**
- **处置**：**不拆 feature**（B4+E+pilot 合一线是用户明示的需求形态），但 implement 按 **B4 → E1 → E2/E3 → pilot 四批次序**推进，每批独立跑门禁后再进下一批（tasks.md 按此分组）；FR-010 审计与 FR-022/023 不降级——它们直接对应用户验收清单原文（「degraded reason 落审计」「三指标有对照数据」），不是可删项。

## 已核对的「未发现问题」面（Codex 自报，我抽查一致）

144 算术、F239 失败原因映射、goal-loop-core 零改造可行性、D7 字面措辞、`.mjs` 缺口证据、FR-014 三态区分、RG-003/004 可断言性——与我的 V-2/V-5/V-7 交叉一致。

## 与 clarify 产物的冲突裁决（编排器主线收口）

clarify（clarifications.md）4 条推荐里 2 条与本整改单冲突，裁决如下：

| clarify 条目 | 冲突点 | 裁决 |
|---|---|---|
| C-001（FR-008 由 CLI 读审计 JSONL 判「已刷过」）| 违反 W3 处置「生产决策代码禁止读审计文件作为输入」+ 重踩 C3 指出的「审计写在决策后，不能当原子 claim」 | **否决**，维持 C3 处置：进程内 single-flight 硬保证 + 跨调用为调用方合同（第二次起 `--refresh-policy declined`）|
| C-003（`distinctQueries` 按 JSONL 行数/事件数计）| 恰是 C5 指出的绕过形态：同一查询重复两次即跨 k=2 | **否决**，维持 C5 处置：distinct = 含该 term 的不同 normalizedQuery hash 数 |
| C-002（FR-006 与 coverageScope 共用同一份扩展名白名单）| 无冲突 | **采纳**（防第二份白名单漂移）|
| C-004（`--phase` 缺省用固定 sentinel 并纳入约束）| 无冲突 | **采纳**（审计分组键一致性）|

---

# Plan phase — Codex 对抗审查整改单（BLOCKED → 修订）

> 审查会话：codex `task-msc2o01b-cf6m3v`（2 CRITICAL / 7 WARNING，结论 BLOCKED）。

## P-C1 两步协议正常路径即漏审计 + 跨快照拼接 → **确认，改为「双事件审计模型」**

Codex 的三个证伪都成立：goal_loop authoritative 路径只跑 decide 永不 annotate → `consume-impact` 必漏记；
decide 与 annotate 间图被并发重建 → G1 输入拼 G2 结果且无法检测；两步间 crash → 永久漏记。

**处置（新契约，spec 与 plan 同步落）——审计从「一决策一行」改为「事件日志」**：
1. `decide`（非 dry-run）**无条件当场**追加一条 `kind:"decision"` 事件：
   `{ kind:"decision", decisionId(uuid), ts, phase, advisory, inputs{五维}, outcome, degradedReason, caveats:[], graphSourceCommit(决策时图内嵌值|null), refreshAttempted, refreshOk }`
   → FR-010 由 decision 事件**独立满足**，与后续任何步骤无关（crash 也不漏）
2. `annotate-caveat` 被调用时追加一条 `kind:"caveat-annotation"` 事件：
   `{ kind:"caveat-annotation", decisionId(回链), ts, impactStatus:"completed"|"failed"|"skipped"|"snapshot-mismatch", caveats:[...], graphSourceCommitAtAnnotation }`
   - 入参校验：decision JSON 里的 `graphSourceCommit` vs 注解时刻图内嵌值，不等 → `impactStatus:"snapshot-mismatch"`、caveats 置空不采信该 impact 结果（跨快照拼接被显式检出而非静默拼接）
3. goal_loop authoritative 路径（plan §3.2 位置二）= **decide 单步即完整**（该路径本就不消费 impact，无注解事件是正确形态，不是漏）
4. SC 断言全部改为事件语义：SC-005 的 12 个 degradedReason 走 decision 事件断言、caveat 走 annotation 事件断言；「跑两次决策 → 审计恰 2 行」改为「恰 2 条 kind:decision 事件」

## P-C2 pilot 批次依赖环 + ledger 缺 timestamp → **确认（后者是编排器自己的错）**

**处置**：
1. pilot 拆三段：**preflight**（批 1 前：预测集已冻结的存在性校验 + ledger schema 校验）/ **continuous capture**（横跨批 1-3：每次 MCP 调用当下双写）/ **finalize**（批 4：实际集、M-3、报告、ledger 重算）——只有 finalize 在批 4
2. plan 不得把 `predicted-impact-set.md` / `ledger.jsonl` 标为「批 4 新增」（它们已存在且冻结/持续记账中）
3. ledger 既有 11 行缺 `timestamp` → **诚实回填**：`"timestamp": null` + `"timestampNote": "schema 定稿前记录，先后次序见 mcp-call-log.md 的 git 历史"`；此后新行必须带真实 ISO timestamp。**禁止**伪造事后时间戳
4. spec FR-022 补一句「允许 schema 定稿前的行 timestamp 为 null + 强制 timestampNote」的迁移条款

## P-W1 薄壳缺 `.catch` + lifecycle 测试不会红 → **确认两点**
薄壳样板逐字保留 canonical 的 `.catch`（unhandled rejection → stderr + exitCode 1）；
`worktree-lifecycle-hook.test.ts` 的 copy 用例把 PATH 剥到无 Node，helper 根本不执行 → plan 声称的「先红」不成立。
**处置**：薄壳样板补 `.catch`；新增一条「Node 可用、直接执行仓根薄壳三个子命令」的回归测试；plan 不再把旧 lifecycle 用例当薄壳回归证据。

## P-W2 TDD 红=加载失败 + mandatory 覆盖缺口 + 注入缝缺失 → **确认**
**处置**：`graph-refresh-executor` 签名加依赖注入缝（`attemptLocalGraphBuild` 可注入）；tasks.md 必须附 FR/SC/RG→测试逐项 crosswalk；补齐缺失断言：SC-019 仓外插件拷贝、FR-024/SC-020 双段 check-ignore、FR-017 `lockfile-install-mismatch`、FR-019 `noHitCollection`/`recentNoHitCount`、M-3 prompt+diff hash 落盘、RG-006 静态「不读审计」检查、SC-002 真实 stale 刷新断言、SC-003 非 dry-run additive 图 SHA 断言。

## P-W3 E1 开关未定 + fallback no-hit 被整体排除 → **确认**
**处置**：开关钉死 = 单一 env `SPECTRA_KB_NOHIT_TELEMETRY`（值 = 记录目录；未设/空 = off，默认关闭），对齐 O-4 的 `SPECTRA_MCP_TELEMETRY_PATH` 先例；三个 recorder 共用同一解析函数。`kb_api_lookup` 的 document_fallback 分支在 `hits.length === 0` 时**必须记录** no-hit（这是真实零结果），不得整体排除。

## P-W4 旧 schema 语义矛盾 + kb_status 分支悬置 → **确认**
**处置**：旧 schema（缺 provenance 列）→ `freshness:"unknown"` **恒定**（即便 built_at 很新——单列 built_at 不足以支撑判级声明），加「旧库 built_at 很新仍 unknown」测试；`kb_status` 追加到**全部成功 envelope**（含 document_fallback 与 not_found 早返回），error envelope 不追加（明定）。

## P-W5 E2/E3 子命令 CLI 不可达 → **确认（好抓）**
**处置**：批 3 文件清单补 `src/cli/utils/parse-args.ts`（scaffoldKbOperation union 扩 `version`/`status`）+ `src/cli/index.ts` help 文案 + parse→dispatch 集成测试。

## P-W6 FR-024 路径写错 → **确认（机械）**
**处置**：`plugins/spec-driver/scripts/lib/ensure-gitignore.sh`（非仓根）；同步列入 `plugins/spec-driver/tests/ensure-gitignore.test.mjs` 的 4→6 条合同更新。

## P-W7 wrapper 双生成文件漏报 → **确认（与 V-8 互证且更全）**
**处置**：SKILL.md 改动的传播面 = canonical + `plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md` + `.codex/skills/spec-driver-feature/SKILL.md` 两个生成 wrapper；再生走 `npm run repo:sync`；rebase 冲突规则 = 先合 canonical 再统一 repo:sync 再生，**禁止手工解生成文件冲突**。plan §7 冲突面补全。

## Codex 未发现问题面（抽查一致，直接沿用）
I1 薄壳双执行/退出码疑虑排除；I2 无遗漏生产消费方、插件分发不漏新文件（package.json files 含整个 plugins/）；I3 散文插入点在生成区块外；I4 FR-018 删除理由成立。

---

# Tasks phase — Codex 对抗审查整改单（BLOCKED → 修订）

> 审查会话：codex `task-msc43enk-lprgh4`（6 CRITICAL / 5 WARNING / 1 INFO）。

## T-C1 `phase.id === "verify"` 永不触发 → **确认（源头是 plan §3.1 伪代码，编排器抽查也漏了）**
orchestration.yaml 实况：implement 是 `id:"6"`，verify 是 `id:"7c"`——`phase.id === "verify"` 恒 false，场景 A/B/C 主接线整体失效。
**处置**：判定条件改 `phase.name === "verify"` / `"implement"`；T014 加一条「读 effective orchestration 断言 name 判定」的自动化校验；plan §3.1 出一行勘误（同步修 plan.md 该处伪代码，避免 implement 者照抄旧文）。

## T-C2 crosswalk 未到断言级 + 四处虚映射 → **确认**
**处置**：crosswalk 改四列 `条目 → 测试文件 → 具体断言/用例 → 门禁命令`；补四缺口：SC-004 的 CLI JSON 封闭键集合 + 12 reason 固定模板映射测试；SC-005 的「制造 12 个非 dry-run decision 事件逐值验证审计」任务；SC-006 的失败改写用例落进 decision 测试（T005 范围）；RG-002 的默认 feature dry-run 检查真实落进 T020（或从 crosswalk 删除虚 claim——**选前者**）。

## T-C3 批 2/3 红测试排序倒置 + 两挂点无红测试 → **确认**
**处置**：T029/T035/T049/T053 移到对应实现任务**之前**；为 kb_search 挂点与 scaffold-kb query 挂点各补一条「正反 no-hit」红测试（调 recorder 桩断言被调/不被调）。红失败必须因**行为缺失**而非仅模块不存在。

## T-C4 continuous capture 未任务化 → **确认**
**处置**：新增批 0/preflight 任务（T000 系列）：ledger schema 校验 + 「每次 MCP 调用当下双写」设为 T001-T054 的**共同完成条件**（写进各批门禁：校验 mcp-call-log 与 ledger 的调用数/seq 同步单调）。

## T-C5 四个批门禁都可在证据缺失时通过 → **确认**
**处置**：T020 补 `goal-loop-snapshot-rollback-integration.test.mjs` + `tests/unit/graph-bootstrap-status.test.ts` + RG-002 dry-run；T039 补重跑 `ensure-gitignore.test.mjs`；T054 补新建 unit parse-args 测试 + RG-009 缺列故障注入；T061 补 T059/T060 全部验证命令 + M-3 prompt 同构与 diff hash 校验 + plugin `node --test` 全套（不能只跑 vitest）。

## T-C6 RG-006 静态检查只 grep 读 API → **确认**
**处置**：扩为三段静态断言并显式列被审文件集合：(1) 产物名扫描（无新增 `*freshness*`/`*source-commit*` 状态文件）；(2) freshness 获取唯一依赖 `checkFreshness` 扫描（禁自读 graph.json.sourceCommit 比 HEAD）；(3) 审计路径常量 import / 读取扫描。

## T-W1 trace 锚点格式与 rerun 语义 → **确认**
**处置**：锚点行采用与现行 trace 一致的时间戳格式 `[HH:MM:SS] phase_start_ref: implement=<sha>`；语义 = **last-match wins**（rerun 追加新行，读取方取最后一条）；该语义写进 SKILL 接线段落并进集成测试断言。

## T-W2 T003 非红测试 → **确认（编排器此前独立观察到，互证）**
**处置**：改标「迁移回归测试」；顺序改为 **T003 先行**（对旧实现先绿）→ T001/T002 迁移 → T003 复跑仍绿；不要求人工回退制造红态。

## T-W3 裸 `git diff` 可被 staged/已提交绕过 → **确认**
**处置**：每批开始记录 `batch-base SHA`（git rev-parse HEAD 写 trace，复用 T-W1 格式 `[HH:MM:SS] batch_base: batch1=<sha>`）；门禁 RG 检查一律 `git diff <batch-base> -- <paths>`。

## T-W4 RG-008 无可执行命令矩阵 → **确认**
**处置**：T054 列命令矩阵（coverage-gap/version/status/query × 各只读断言），每项存 before/after SHA-256 + 退出码。

## T-W5 巨石任务与不定路径 → **部分采纳**
**处置**：T011 拆 4（CLI 契约+dry-run/advisory；双事件审计；SC-019 安装态；SC-002/003 真实刷新）；T12 拆 2（decide 主链；annotate-caveat+审计写入器）；T029/T049 钉死目标测试文件路径。T053 保持单任务（两个同构 sibling 测试文件、同一断言模式，拆开反而碎）——**此处不采纳拆分**，理由记录。

## T-I1 T019 引用 T032 应为 T038 → 机械修正。

---

# Implement 批 1 — Codex 代码对抗审查整改单（门禁不通过 → 修复）

> 审查会话：codex `task-msc6wt4l-emi1m9`（7 CRITICAL / 7 WARNING，全部带复现证据）。

## B1-C1 缺 `graph.sourceCommit` 的合法 JSON 误判 present → **确认**
`{"graph":{}}` 解析成功即判 present，EC-02 要求 corrupt。**处置**：availability 判定收紧——仅当 `sourceCommit` 为非空字符串才 present；缺失/空串/非字符串一律 corrupt；补三组 CLI 采集测试。

## B1-C2 broken symlink 判成 missing（用了 statSync 违反 EC-02 lstat 硬合同）→ **确认**
**处置**：CLI 的 availability 采集入口先 `lstatSync`；仅 lstat ENOENT = missing；路径存在但读取/解析/provenance 校验失败 = corrupt；补真实 broken-symlink fixture。

## B1-C3 刷新成功后仍输出 G1 sourceCommit → annotate 主路径必然 snapshot-mismatch 丢 caveat → **确认（最重）**
**处置**：刷新成功后**重读**已验证产物的 sourceCommit（G2）更新输出与 decision 事件；重读失败收口 `refresh-failed-artifact-unusable`；补 G1 stale → refresh G2 → annotate completed 全链集成测试。

## B1-C4 caveat 判据与真实 MCP impact 形状不兼容 + 缺 target 反而误加 caveat → **确认**
真实返回是 `summary.directCallers` 且无 `target`；现实现只认合成顶层形状，且 target 缺失时误加 caveat。**处置**：`annotate-caveat` 加 `--target <symbolId>`（由调用方显式声明查询目标）；内部归一化 `directCallers = raw.summary?.directCallers ?? raw.directCallers`；target 缺失或非 TS/JS 源**拒绝**加 caveat；补真实 MCP payload 形状测试。

## B1-C5 goal_loop advisory 散文漏传 `--tasks-file` → **确认（T027b 后补功能没回灌 SKILL）**
**处置**：SKILL 步骤 2 advisory 命令补 `--tasks-file "{feature_dir}/tasks.md"`；wrapper 再生；接线测试断言完整参数串而非只查标记。

## B1-C6 RG-006 静态门禁集合漏 `git-change-classifier.mjs` 且 helper 可逃逸 → **确认**
**处置**：静态检查改为**从 CLI 入口解析 import 闭包**（递归、限 plugins 目录内），三段扫描作用于闭包全集；固定清单只作为「闭包必须 ⊇ 清单」的下限断言。

## B1-C7 SC-008 的「prompt 正反注入」实为只查日志 → **确认**
**处置**：抽最小纯函数 `buildImpactInjectionBlock(decision, impactSummary)`（与既有 `shouldConsumeImpact` 同模块），SKILL 散文引用其语义；测试改为：允许态组装结果含 impact 内容、拒绝态用**同一候选 impact 输入**组装结果必须不含。

## B1-W1 第三次 allowed 歧义 → **确认**：预算键钉死 `(projectRoot, phase=implement)`；goal_loop 已跑过时外层 verify 4b 恒 declined（SKILL 散文写明分派模式条件）。
## B1-W2 tasks 路径判据收仓外/绝对路径 + `Node.js` 误收 → **确认**：拒绝 absolute / `..` / resolve 后出 projectRoot；要求路径含 `/`（挡裸词误收）；补负例。
## B1-W3 realpath fallback 测试没进 catch → **确认**：测试显式改写 `process.argv[1]` 为不存在路径。实现本身安全。
## B1-W4 append 测试非并发 → **确认**：并发 N 子进程 decide，断言行数/逐行可解析/decisionId 唯一。
## B1-W5 gitignore 文件规则吞同名目录后代 → **登记为 Git pattern 固有残余**（不改，写入 spec 残余声明由 verify 复核）。
## B1-W6 ensure-gitignore 残留「4 条」旧口径注释 → **确认**：改「固定条目/N 条」措辞（脚本 3 处 + 测试 5 处）。
## B1-W7 审查沙箱 EPERM 无法复核完整绿态 → **接受**：修复后在 host shell 全量重跑门禁（编排器环境可写 /tmp）。

## 已核对安全面（Codex 独立 oracle 复算）
矩阵 144 组合 0 mismatch / 双事件基本写入 / 薄壳导出差集空 + .catch 逐字 / phase.name 三份一致 + wrapper SHA 一致 / dry-run 零副作用 / src** 零改动 / 双 gitignore 清单一致。

---

# Implement 批 2 — M-3 双组对抗审查整改单（A 组 BLOCKED + B 组 BLOCK）

> 来源：M-3 A/B 对照（`pilot/m3/output-a.md` / `output-b.md`，判读见 `pilot/m3/judgment.md`）。
> 9 条真 finding、0 误报。两组均判阻断，批 2 **不得**在修完前提交。

## B2-1 redaction 先于 NFKC + 规则大小写敏感（A-C2 / B-W2 交集）→ **确认，最高优先**
全角 `１２３４５６７８` 绕过 `DIGITS`，随后被 tokenizer 的 NFKC 还原成 ASCII 数字落盘；`TOKEN=`、`bearer`、Windows `c:\users\Alice\` 因大小写/形态不匹配漏遮。
**处置**：redaction **入口先做 NFKC 归一化**（与 tokenizer 同一归一化函数，禁止两份）；URL credential key、Bearer scheme、home 路径规则改大小写不敏感；补全角/大写/Windows 路径/跨类混合的用例，并加一条**终态断言**：对最终序列化的整行做敏感片段零出现检查（不只查字段名）。

## B2-2 FIFO / symlink：阻塞主链 + 写出目录外 + 误删（A-C3 / B-C2 交集）→ **确认**
`appendFileSync` 跟随 symlink、打开 FIFO 会无限阻塞（A 组实测延迟注入 300ms → 主查询同步延迟 301ms，证明它就在返回路径上）；`pruneExpired` 用 `statSync` 跟随链接，且任意非空 env 当目录时会按名删除该目录下匹配文件。
**处置**：写入改 `openSync(path, O_APPEND|O_CREAT|O_NOFOLLOW)` + 对 fd `fstatSync` 校验 `isFile()`（非常规文件直接放弃写入，静默降级）；清理侧改 `lstatSync` 且跳过非常规文件；补「目录内存在同名 symlink/FIFO 时不写入且主链路正常返回」的回归测试。**不引入异步队列**（超范围），以「拒绝非常规文件」消除阻塞面。

## B2-3 读取失败被误报 `no-data`（A-W4 / B-W3 交集）→ **确认**
**处置**：`CoverageGapOutput` 增 `readErrors: number`（与既有 `skippedLines` 同级），文件级读取失败计数；`status` 增第四态 `data-unreadable`（`readErrors > 0 且 totalRecords === 0` 时）。spec FR-014/015 与 SC-010 同步扩（三态→四态），tasks crosswalk 同步。

## B2-4 parse-args 接受缺值/未知 flag（A-W3 / B-I1）→ **确认**
`--format` 缺值静默回落 markdown、`--unknown` 放行。**处置**：`readFlag` 区分「不存在」与「存在但缺值」，缺值返回 `invalid_option`；为 scaffold-kb 各 op 建立允许 flag 集合，未知 flag 拒绝。注意不得放宽既有 op 的现有行为（RG-005）。

## B2-5 单 token 查询整串原文进 `terms`（**A 独有**）→ **确认，按「收窄红线 + 加护栏」处置**
`rawQuery="ProjectFalcon"` → `terms:["ProjectFalcon"]`，整串逐字落盘。
**处置**：**不**做「单 token 只留 hash」（会让单 API 名称这类最有价值的缺口信号全灭，与 E1 目的直接冲突）。改为两条：(a) **spec D5 措辞收窄**——把「整串不落盘」明确为「不新增整串字段；term 粒度落盘，当查询本身即单 token 时该 token 等于原串，属已知且接受的残余」，并入 D5 已有的残余风险声明；(b) 该残余仅在 redaction 未命中时存在，B2-1 修好后敏感形态会先被遮蔽。补一条「单 token 敏感形态（如 `sk-xxx` 单独查询）→ 落盘为占位标记而非原串」的断言。

## B2-6 大小写变体绕过 distinctQueries 阈值（**A 独有**）→ **确认**
`retry alpha` 与 `retry Alpha` 产生两个 hash → 共同 term 被计 `distinctQueries:2` 跨过阈值。
**处置**：`normalizedQueryHash` 的输入改为**与检索语义一致的归一化结果**（复用 tokenizer 的 NFKC + case-fold 后重组），使大小写/空格变体收敛为同一 hash；补该对照用例。

## B2-7 无可用库源时仍记 coverage gap（**A 独有**）→ **确认**
`source_filter: "project"` 但只有 vendor 时 `sources_queried: []`，仍落一条 `dbPathHash` 为空串 hash 的记录。
**处置**：三挂点统一前置条件——仅当**至少真正执行过一次检索**（`sourcesQueried.length > 0`）才记录；无可用源属 availability 问题，不进文档缺口 backlog。补三挂点各一条负例。

## B2-8 `tool` 无运行时 allowlist（**B 独有**）→ **确认**
`recordNoHit` 合同宣称 total function 且是导出边界，但 `tool` 未校验即序列化（B 组实测整串原文经 `tool` 落盘）。当前三个 call-site 都传字面量，故非外部可达，但边界合同没守住。
**处置**：`recordNoHit` 入口做输入校验——`tool` 必须属三值 allowlist、`rawQuery`/`dbPath` 必须是 string，任一不合法**直接 no-op**（保持 total function 不抛）；补「非法 tool 不产生任何 append」断言。

## B2-9 `dbPath` 在保护边界外求值（**B 独有**）→ **确认**
`describeQueriedDbPaths(...)` 在 `recordNoHit` 的 try/catch **之外**先求值，getter 抛错会穿透到主链（实测关闭态也炸）。
**处置**：三挂点改为**惰性传入**——把路径计算包成 thunk 交给 recorder，在其 try 内求值；或 recorder 先判开关再调 thunk。补三挂点「关闭态 + 抛错 getter → 查询正常返回」回归测试。

## 不采纳
- A-I1「hash 可字典枚举」：C5 裁决已改名 minimum-occurrence threshold 并声明不提供匿名性保证，属重复登记。**但** B2-6 修复后 hash 输入变化，需复核该声明措辞仍准确。
  - **复核结论（整改后回填）：措辞仍准确，无需修改。** B2-6 只是把 hash 的输入从「切词后原样重组」换成更粗的等价类（NFKC + case-fold + 去重后重组），大小写/全角变体合并为同一桶。hash 本身仍是低熵输入上的确定性 SHA-256 截断、仍可离线字典枚举；记录里也仍无任何主体标识（无 user-id / session-id）。等价类变粗**降低**而非提升可区分度，因此「不提供匿名性保证」这一声明只会更保守，不会失真。

## B2-1 ~ B2-9 落地状态（整改后回填）

| # | 处置落点 | 状态 |
|---|---------|------|
| B2-1 | `tokenizer.ts::normalizeUnicode` 单点导出 + `redactQuery` 入口归一化；URL 凭据参数名 `/i`、Bearer 逐字母放宽、home 段放宽 | ✅ 已修（14 红转绿，含落盘整行终态断言与「NFKC 调用点恰 1 处」结构断言）|
| B2-2 | `openSync(O_APPEND｜O_CREAT｜O_WRONLY｜O_NOFOLLOW｜O_NONBLOCK)` + `fstatSync().isFile()`；`pruneExpired` 改 `lstatSync` 跳过非常规文件；未引入异步队列 | ✅ 已修（探针 `HUNG→RETURNED`、`escaped 207B→0B`；+3 用例）。**偏差**：`O_NONBLOCK` 是整改单未列的必要超集，无它则阻塞在 `openSync`、`isFile()` 校验执行不到 |
| B2-3 | `readErrors` 字段 + 第四态 `data-unreadable`；spec FR-014/FR-015/SC-010/§6/EC-34 与 tasks crosswalk 同步 | ✅ 已修（+6 红转绿）|
| B2-4 | `readFlagEntry` 三态 + `SCAFFOLD_KB_FLAG_SPECS` + `checkScaffoldKbFlags` | ✅ 已修（+2 红转绿）。**按 RG-005 授权收窄**：强制执行仅 `coverage-gap`；既有 op 允许表已建但只作文档用途，另加四 op 反向守卫用例 |
| B2-5 | spec D5 / FR-013 措辞收窄 + 2 条护栏断言 | ✅ 已修（**不改代码逻辑**，红态即绿的现状钉子）|
| B2-6 | `tokenizer.ts::normalizeForEquivalence` 作 hash 输入 | ✅ 已修（+2 红转绿 + 2 条反向断言防压成一个桶）|
| B2-7 | 三挂点统一「至少查过一个库」前置条件；spec FR-012 同步 | ✅ 已修（+2 红转绿）。**第三挂点负例回退态即绿**（`loadKbContext` 零 handle 时提前返回、结构性不可达），如实标注为不变量护栏 |
| B2-8 | `recordNoHit` 入口 allowlist + 类型校验，不合法直接 no-op；新增 EC-32 | ✅ 已修（+3 红转绿 + 1 条「合法输入不受影响」防假绿）|
| B2-9 | `dbPath: string \| (() => string)`，三挂点传 thunk，recorder 在 try 内且开关判定后求值；新增 EC-33 | ✅ 已修（+7 红转绿，含 3 条既有断言按新契约改写）|

门禁：`tests/kb/` 415 passed（≥368）/ 全量 6139 passed / 插件 1272 passed / build + tsc + `repo:check` 全 EXIT=0。
详见 `verification/batch2-gate.md` 末节与 `verification/batch2-red-evidence.md` 第二节。
