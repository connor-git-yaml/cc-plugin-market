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
