---
feature: 241-graph-keepalive-kb-grounding
title: 任务分解 v2 —— 图条件保活消费接线 + KB 三薄层 + Grounding Pilot
status: draft
created: 2026-08-03
source_spec: specs/241-graph-keepalive-kb-grounding/spec.md
source_plan: specs/241-graph-keepalive-kb-grounding/plan.md
source_dispositions: specs/241-graph-keepalive-kb-grounding/review-dispositions.md
source_verifications: specs/241-graph-keepalive-kb-grounding/orchestrator-verifications.md
source_checklist: specs/241-graph-keepalive-kb-grounding/checklist.md
revision: v2（Codex Tasks-phase 对抗审查 BLOCKED → 修订，见 review-dispositions.md「Tasks phase」T-C1~T-I1）
---

# F241 任务分解 v2

> 本 tasks.md 不重议 spec 的 D1-D8 决策、review-dispositions.md 的整改结论与 plan.md 的文件级设计，只把它们转成可执行任务序列。
> **五批硬依赖边**：批 0（preflight）→ 批 1 → 批 2 → 批 3 → 批 4，每批末尾一条「批门禁」任务，未过门禁不得启动下一批（spec I1 / plan §0 已拍板，不重议）。
> **[P]** = 与同批内其他 [P] 任务无文件依赖，可并行执行。未标 [P] 的任务按列出顺序存在依赖（通常是"先红测试后实现"或"前置文件先落地"）。
> **[推断]** 标注的任务是本轮 tasks 阶段核实后拍板的决策点，非 spec/plan 已有定论；理由随任务内联。
> **v2 全局变化**（对照 review-dispositions.md「Tasks phase」整改单逐条落地，详见文末「v2 相对 v1 的结构性变化」小节）：任务编号全部重排（T001-T073）；新增批 0 preflight；SKILL 接线判定条件改用 `phase.name`；crosswalk 改四列；红测试统一前移到对应实现任务之前；四个批门禁逐个补齐可验证命令；`batch-base` 记录与 `git diff <batch-base>` 成为门禁 RG 检查的统一口径。

## 贯穿性完成条件（T-C4，适用于 T001-T073 全程）

1. **continuous capture 双写**：批 1→批 3 期间任何一次 Spectra MCP 调用（impact/context/search 等，含本 feature 实现过程中自身的 dogfooding 调用），发生的**当下**必须双写：追加一行 `specs/241-graph-keepalive-kb-grounding/pilot/mcp-call-log.md`（人读）+ 一行 `specs/241-graph-keepalive-kb-grounding/pilot/ledger.jsonl`（机器可读，含真实 ISO 8601 `timestamp`）。这不是某个具体任务的产出，而是 T004-T065（批 1-3 全部实现任务）执行期间的持续动作，由每批门禁做"数量/序号同步单调"的事后核验。
2. **batch-base 锚点**：每批第一个任务是记录该批 `batch-base SHA`（`git rev-parse HEAD` 写入 `specs/241-graph-keepalive-kb-grounding/trace.md`，格式 `[HH:MM:SS] batch_base: batchN=<sha>`）。该批门禁的一切"改动范围"RG 检查一律用 `git diff <batch-base> -- <paths>`（而非裸 `git diff`，防 staged/已提交内容绕过 T-W3）。
3. **`phase_start_ref` 锚点格式**（T-W1）：与 trace.md 现行记录风格一致的时间戳行 `[HH:MM:SS] phase_start_ref: implement=<sha>`；语义为 **last-match wins**（goal_loop 多轮迭代 rerun 会追加新行，读取方永远取该文件内最后一条 `phase_start_ref: implement=` 行）。

---

## 批 0 — Preflight（pilot 前置制品与 ledger schema 校验，P-C2 + T-C4）

- [x] T001 preflight 校验：新增 `specs/241-graph-keepalive-kb-grounding/pilot/ledger-schema-check.mjs`（轻量 schema 校验脚本，仅做结构校验，不做 M-1 计数重算——M-1 重算是批 4 `ledger-verify.mjs` 的职责，二者不重复）。校验：(a) `pilot/predicted-impact-set.md` 已存在（冻结制品，plan §1.7 已确认非本 feature 待做项）；(b) `pilot/ledger.jsonl` 现有 11 行字段集合完整（`seq`/`tool`/`args` 等 ledger schema 字段）、`seq` 单调递增、`timestamp===null` 且 `timestampNote` 非空（P-C2 point 3 迁移条款）
  验证：`node specs/241-graph-keepalive-kb-grounding/pilot/ledger-schema-check.mjs` exit 0

---

## 批 1 — B4 图消费决策（FR-001~FR-011、FR-024 审计路径部分）

- [x] T002 记录 batch1 base：`git rev-parse HEAD` 写入 `specs/241-graph-keepalive-kb-grounding/trace.md`，追加一行 `[HH:MM:SS] batch_base: batch1=<sha>`
  验证：`grep 'batch_base: batch1=' specs/241-graph-keepalive-kb-grounding/trace.md` 命中恰 1 行（首次记录）

### 1.0 D8 模块迁移（分发拓扑前置，其余批 1 任务依赖它可用）

- [x] T003 [P][迁移回归测试]（T-W2 改标，非红测试）新增 `plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`：对**当前尚未迁移**的仓根 `scripts/lib/graph-bootstrap-status.mjs` 直接执行 `write-status`/`check-freshness`/`attempt-build` 三个子命令，逐一断言产生真实副作用（而非静默 no-op）。此刻针对旧（未迁移）实现应**全绿**（对旧实现先绿，T-W2 纠正 v1"先红"的错误定性）
  验证：`node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs` 此刻全绿（对旧仓根实现）

- [x] T004 新增 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`：把仓根 `scripts/lib/graph-bootstrap-status.mjs` 逐字节搬移到此路径，只追加一段 D8 迁移说明注释，不改内部逻辑（D8 方案 A，plan §1.1/§1.2）
  验证：`diff <(git show HEAD:scripts/lib/graph-bootstrap-status.mjs) plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 除新增注释块外无差异

- [x] T005 改造仓根 `scripts/lib/graph-bootstrap-status.mjs` 为薄转发壳：`export * from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs'` + `invokedDirectly` argv 判断 + **逐字保留** canonical 的 `.catch`（unhandled rejection → stderr + `exitCode 1`）错误收敛（plan §1.2，P-W1 整改）
  验证：文件内容与 plan §1.2 给出的薄壳样板逐字一致（人工比对，含 `.catch` 段）；`node --check scripts/lib/graph-bootstrap-status.mjs` 语法零错误

- [x] T006 迁移回归复跑：T004/T005 完成后，重跑 T003 的测试文件，确认对**新（已迁移）**实现依然全绿（迁移前后行为等价，T-W2 顺序：先绿旧实现 → 迁移 → 复跑仍绿；不要求人工回退制造红态）
  验证：`node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs` 迁移后依然全绿

- [x] T007 改 `tests/unit/worktree-lifecycle-hook.test.ts:16,109`：`REAL_STATUS_HELPER` 常量从仓根路径改为 canonical 插件路径 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（D8 代价清单，plan §1.3；**注意**：该测试用例 (b) 的 PATH 剥离场景不构成本次改动的回归证据，真实回归证据见 T003/T006，不得混淆，P-W1）
  验证：`npx vitest run tests/unit/worktree-lifecycle-hook.test.ts` 全绿

### 1.1 决策纯函数核心（FR-001/002/003/004/004b/006）

- [x] T008 [红测试] 新增 `plugins/spec-driver/tests/graph-consumption-decision.test.mjs`：覆盖 FR-001/002/003/004/004b/006、SC-001/004/005/006。必须包含：(a) 144 组合穷举（3×3×4×2×2）逐一断言 `outcome`/`matchedRule`，无 `undefined`/throw；(b) missing 探针（`missing`+人为`fresh`→`matchedRule∈{5,6}`）与 out-of-scope 探针（`out-of-graph-scope`+`stale`+`allowed`→`matchedRule=2`且未触发刷新）两条顺序不变量；(c) 6 类 unreachable 组合的显式注释存在性（grep 断言）；(d) 刷新成功后收口规则单测（`changeClass=unknown`/`modifies-existing` 各一条，求值计数桩断言矩阵未被二次求值）；(e) 缺任一字段的 5 条 `invalid-input` 用例 + 1 条未知 freshness 字面量用例 + 1 条第六字段 `impactResult` 被忽略用例；(f) `DEGRADED_REASONS` 恰 12 项 + `CAVEAT_CODES` 恰 1 项 + 两组交集为空；(g) `annotateImpactCaveat` 三条对照（`consume-impact`+`directCallers:0`有caveat / `directCallers:3`无caveat / `consume-degraded`+`directCallers:0`不注解）；(h) 模块内无 `child_process`/`fs` import 的静态 grep 断言；(i) **SC-006 补齐**：刷新失败时按"刷新前 present"与"刷新前 missing"两态分别断言出口改写为 `consume-degraded`（present）与 `unavailable`（missing）——本文件负责这一改写逻辑本身，`graph-refresh-executor.test.mjs`（T012）只测 reason 映射，二者不重叠
  验证：`node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs` 此刻应因模块不存在而失败（红）

- [x] T009 实现 `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs`：导出 `decideGraphConsumption(input)`、`annotateImpactCaveat(decision, impactResult)`、`DEGRADED_REASONS`（12值）、`CAVEAT_CODES`（1值）、`GRAPH_SCOPE_EXTENSIONS`（`.ts/.tsx/.js/.jsx`，全仓唯一一处定义，被本模块与 FR-006 判据共同 import）。矩阵按 FR-003 v2 固定顺序（additive-only → out-of-graph-scope → corrupt×policy → missing×policy → classification-unknown → stale×policy → dirty×policy → unknown-provenance → fresh 收口）实现，纯函数零 I/O
  验证：`node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs` 全绿（T008 转绿）

### 1.2 变更类别机械判定（FR-005）

- [x] T010 [P][红测试] 新增 `plugins/spec-driver/tests/git-change-classifier.test.mjs`：NUL 分隔 fixture（`\0` 字面构造，含 `M`/`A`/`??`/`R100` 三段重命名/`C75` 复制/空输入/含空格文件名/含中文与引号路径），断言分类与文件清单；另一条负例断言「若误按 ` -> ` 人读格式切分会得到错误文件清单」
  验证：`node --test plugins/spec-driver/tests/git-change-classifier.test.mjs` 因模块不存在而失败（红）

- [x] T011 实现 `plugins/spec-driver/scripts/lib/git-change-classifier.mjs`：导出 `classifyChangeSet({ nameStatusText, porcelainText }) -> { changeClass, files }`，`--name-status -z` 与 `--porcelain -z` 双 NUL 契约解析，同构复用 `goal-loop-core.mjs::parsePreservedConfigStates` 的字段切分范式但不 import 该函数
  验证：`node --test plugins/spec-driver/tests/git-change-classifier.test.mjs` 全绿

### 1.3 刷新执行层（FR-007）

- [x] T012 [P][红测试] 新增 `plugins/spec-driver/tests/graph-refresh-executor.test.mjs`：fake `attemptLocalGraphBuild` 注入四类失败（`spawn-error(ENOENT)`/`timeout`/`non-zero-exit`/`graph-not-queryable`）→ 断言映射到四个 `refresh-failed-*` 枚举值；本文件只测 reason 映射，出口改写（present→consume-degraded / missing→unavailable）留给 T008 的决策层单测覆盖；追加一条**不注入 fake、直接用真实 `attemptLocalGraphBuild`** 的慢集成用例，对最小临时 git fixture 项目跑真实 `graph-only` 重建
  验证：`node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs` 因模块不存在而失败（红）

- [x] T013 实现 `plugins/spec-driver/scripts/lib/graph-refresh-executor.mjs`：导出 `executeRefresh({ projectRoot, spectraBin, refreshPolicy, attemptLocalGraphBuild? })`，`attemptLocalGraphBuild` 为可选具名参数（依赖注入缝，P-W2），默认值绑定 T004 迁入的 canonical 真实实现；唯一职责是把返回结果映射到 `DEGRADED_REASONS` 的 `refresh-failed-*` 四值，不重实现任何 spawn/deadline 逻辑
  验证：`node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs` 全绿（含真实集成用例）

### 1.4 CLI 两子命令与双事件审计模型（FR-008/009/010）——四段拆分（T-W5）

- [x] T014 [红测试] 新增 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 1：CLI 契约 + dry-run + advisory）：(a) `decide --dry-run --format json` 输出可 `JSON.parse` 且含 `outcome`/`degradedReason`/`caveats`/`inputs`/`advisory`/`matchedRule`/`decisionId` 七顶层键，图文件 SHA-256 dry-run 前后不变、审计文件零新增事件；(b) `--advisory` 下输出 `advisory:true` 且 `skip-impact` 不被当作权威结论字段写出；(c) spawn 计数桩断言单次 `decide` 调用内 `attemptLocalGraphBuild` 被调用 ≤1（EC-07 防线）；(f) `graphSourceCommit` 与注解时刻图内嵌值不匹配 → `impactStatus:"snapshot-mismatch"` 且 `caveats:[]`（该用例需先跑 annotate-caveat，实际断言并入 T016）；(g) 审计目录只读 → exit 0 + stderr warning；**SC-004 补齐**：CLI JSON 输出封闭键集合断言（无自由文本评价字段）+ 12 个 `DEGRADED_REASONS` → 固定人读模板的映射表测试（枚举→模板一一对应，可测）；**RG-006 三段静态检查**（T-C6 扩展版，显式列被审文件集合 `graph-consumption-cli.mjs`/`graph-consumption-decision.mjs`/`graph-refresh-executor.mjs`）：①产物名扫描——grep 断言这三个文件不新增写出任何 `*freshness*`/`*source-commit*` 命名的独立状态文件；②freshness 唯一依赖扫描——grep 断言 freshness 获取只经由 `checkFreshness`，不出现自读 `graph.json` 的 `sourceCommit` 字段与 HEAD 比对的裸实现；③审计路径读取扫描——grep 断言除 `annotate-caveat` 读取调用方传入的 decision JSON 文件外，不 `readFile`/`readFileSync`/`createReadStream` 审计事件流文件本身
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs` 因 CLI 不存在而失败（红）

- [x] T015 实现 `plugins/spec-driver/scripts/graph-consumption-cli.mjs` 的 `decide` 主链：采集五维输入 → 调 T009 纯函数 → 按需刷新 T013 → 输出决策 JSON → 非 dry-run 时无条件追加 `kind:"decision"` 审计事件（plan §1.4，P-C1 整改）
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 1 范围内断言）全绿

- [x] T016 [红测试] 追加至 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 2：双事件审计模型 + SC-005）：(d) 按调用方合同跑两次（第一次 `allowed`、第二次 `declined`，同 `--phase`/projectRoot）→ 第二次 `refreshAttempted:false`，审计恰 2 条 `kind:"decision"` 事件；(e) `annotate-caveat` 以真实 `decide` 输出为入参追加 1 条 `kind:"caveat-annotation"` 事件且 `decisionId` 回链正确，并回填 T014 (f) 的 snapshot-mismatch 断言；**SC-005 缺口补齐**：对 `DEGRADED_REASONS` 12 值各构造一次非 dry-run `decide` 调用，逐值断言审计事件的 `degradedReason` 字段与预期一致（T-C2 明确要求的"12 个非 dry-run decision 事件逐值验证"）
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 2 范围内断言）因 `annotate-caveat` 子命令不存在而失败（红）

- [x] T017 实现 `annotate-caveat` 子命令 + 审计事件写入器（append-only JSONL writer，供 `decide` 与 `annotate-caveat` 两子命令共用同一写入路径）：快照校验（`graphSourceCommit` 比对）→ 调 `annotateImpactCaveat` → 追加 `kind:"caveat-annotation"` 事件
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 1+2 全部范围）全绿（T014/T016 转绿）

- [x] T018 [红测试][P] 追加至 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 3：SC-019 安装态）：把 `plugins/spec-driver/` 整体拷贝到仓外临时目录，从该目录跑 `decide --dry-run --format json`，断言 exit 0 + 可解析 + stderr 无 `ERR_MODULE_NOT_FOUND`/`Cannot find module`
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 3 范围内）全绿（依赖 T015 已完成，此处验证的是导入路径不断链而非新增业务逻辑，无独立红态可强造——如实标注）

- [x] T019 [红测试][P] 追加至 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（Part 4：SC-002/003 真实刷新）：**SC-002**：在真实 `stale` 图的临时 git fixture 项目上非 dry-run 跑 `decide`（stale+allowed），断言 `refreshOk:true`、`outcome` 终态 `consume-impact`、审计恰 1 条 `decision` 事件且 `refreshDurationMs` 非空；**SC-003**：非 dry-run + additive-only fixture，断言图文件 SHA-256 全程不变
  验证：`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs` 全部四段（Part 1-4）合计全绿

### 1.5 goal_loop 双合同接线（FR-011）

- [x] T020 [P][红测试] 新增 `plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs`：**新文件**，不碰 `goal-loop-core.test.mjs` 本体（RG-001 硬约束）。断言：advisory 调用输出含 `advisory:true`；允许态（`consume-impact`/刷新成功的`refresh-then-consume`）确实注入 iteration log + prompt 组装含 impact 内容；拒绝态（`consume-degraded`/`skip-impact`/`unavailable`）确实不注入 + iteration log 含对应 `degradedReason`；缺 freshness 字段的旧形态输入不抛错；authoritative 路径（DECISION2）只调用 `decide`、断言其 `decision` 事件已落盘且无回链的 `caveat-annotation` 事件，该 pending 态是设计内正确形态（P-C1 point 3）；**T-W1 追加**：`phase_start_ref` 锚点的 last-match-wins 语义断言（写入两行 `phase_start_ref: implement=` 后，读取方应取最后一条）
  验证：`node --test plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs` 因接线未落地而失败（红）

- [x] T021 [推断已定案] SKILL.md 接线 §3.1：通用 Phase 循环（`agent_mode: single`，覆盖场景 A/B/C）— 在「构建上下文注入块」与「委派子代理执行」之间（现行 `:212-215`）新增两处判定条件均用 `phase.name`（**T-C1 修正**：orchestration.yaml 实况 implement 是 `id:"6"`、verify 是 `id:"7c"`，`phase.id === "verify"` 恒 false，改用 `phase.name === "implement"` / `phase.name === "verify"`）：①`phase.name === "implement"` 时，第 5 步委派 implement 子代理**之前**执行 `git rev-parse HEAD`，写入 `trace.md` 固定格式行 `[HH:MM:SS] phase_start_ref: implement=<sha>`；②`phase.name === "verify"` 时触发 `pre-verify authoritative` 决策调用段落，读取 `trace.md` 中最后一条 `phase_start_ref: implement=` 行作为 `--base-ref`（last-match wins，T-W1）
  验证：`git diff plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 含上述两处新增段落（`trace.md` 记录步骤 + verify 前决策调用段落，均用 `phase.name` 而非 `phase.id` 判定）；新增一条自动化校验——`node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration feature --format json` 输出中 implement/verify 两 phase 的 `name` 字段值与 SKILL.md 散文里引用的字符串逐字一致（T-C1 要求的「读 effective orchestration 输出断言用 name 判定」）

- [x] T022 SKILL.md 接线 §3.2 位置一：goal_loop 步骤 2「注入 Spectra impact 上下文」（现行 `:379-389`）的 a. 之前插入 `pre-implement advisory` 决策段落（DECISION，出口决定是否继续 a/b 并标注 "advisory grounding"）
  验证：`git diff plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 含该段落，人工核对与 plan §3.2 位置一逐字对齐

- [x] T023 SKILL.md 接线 §3.2 位置二：goal_loop 步骤 4「选择 verify 模式」（现行 `:403-413`）之前插入 `pre-verify authoritative` 决策段落（DECISION2，`--refresh-policy declined`——同 phase 内 advisory 已消耗过一次 `allowed` 预算），记录到 iteration log 但不注入 prompt
  验证：`git diff plugins/spec-driver/skills/spec-driver-feature/SKILL.md` 含该段落，`node --test plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs` 全绿（T020 转绿）

- [x] T024 wrapper 再生（V-8/P-W7，与 T021/T022/T023 同批同提交）：跑 `npm run repo:sync`（或 `bash plugins/spec-driver/scripts/codex-skills.sh install`）重新生成 `plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md` 与 `.codex/skills/spec-driver-feature/SKILL.md` 两个 wrapper，与 canonical SKILL.md 改动**同一提交**内连带提交
  验证：`npm run repo:check` 中 `spec-driver-wrappers:*` 族 pass；`git diff --stat` 确认两个 wrapper 文件与 canonical 一并出现在待提交改动中

### 1.6 数据路径自举（FR-024 审计路径部分）

- [x] T025 [P] 改仓库根 `.gitignore`：新增一条 `.specify/graph-consumption-audit.jsonl`；同步改 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh`（**非仓根路径**，P-W6 已纠正）的自举清单，新增同一条目，两处内容一致
  验证：`git check-ignore -v .specify/graph-consumption-audit.jsonl` 命中（退出码 0）

- [x] T026 [P][红测试] 改 `plugins/spec-driver/tests/ensure-gitignore.test.mjs`：新增 `.specify/graph-consumption-audit.jsonl` 的 `git check-ignore` 双段断言（仓内直查 + 插件拷入临时全新 git repo 跑自举脚本后再查），断言数从 4 提升到 5（批 2 再加 1 条到 6，见 T048）
  验证：`node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs` 全绿（T025 完成后转绿）

### 1.7 批 1 门禁

- [x] T027 **批 1 门禁**：`node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs plugins/spec-driver/tests/git-change-classifier.test.mjs plugins/spec-driver/tests/graph-refresh-executor.test.mjs plugins/spec-driver/tests/graph-consumption-cli.test.mjs plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs plugins/spec-driver/tests/ensure-gitignore.test.mjs plugins/spec-driver/tests/goal-loop-core.test.mjs tests/unit/graph-bootstrap-status.test.ts plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs` 全绿（T-C5：补齐 `graph-bootstrap-status.test.ts` 与 `goal-loop-snapshot-rollback-integration.test.mjs` 两条既有回归套件，确认本批未破坏它们）+ `npx vitest run tests/unit/worktree-lifecycle-hook.test.ts` 全绿 + `npm run build` 零错误 + `npm run repo:check` exit 0（含 `spec-driver-wrappers:*` 族）。RG 抽查（均对 `git diff <batch1-base> -- <paths>`，见 T002 锚点，T-W3）：RG-001（`goal-loop-core.test.mjs` 为 0 行改动，测试数 ≥163）；RG-002（`node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide --dry-run --format json` 对当前默认配置执行零副作用二次确认 + 检查 goal_loop 默认配置项为 disabled/opt-in，T-C2 落实为真实命令而非仅 crosswalk 声明）；RG-003（`goal-loop-core.mjs` 为空——本批未触碰该文件）；RG-004（`orchestration-schema.mjs`/`orchestration.yaml` 为空）；RG-007（`spectra graph-quality --json` 的 `overallVerdict` 为 `pass`/`pass-with-warnings`）。**continuous capture 台账同步检查**（T-C4）：`wc -l pilot/mcp-call-log.md` 的调用条目数与 `pilot/ledger.jsonl` 本批新增行数一致，且 `seq` 单调递增
  验证：以上命令全部零失败，逐项截图/日志记入交付 report

---

## 批 2 — E1 KB coverage-gap（FR-012~FR-015、FR-024 no-hit 路径部分）

- [x] T028 记录 batch2 base：`git rev-parse HEAD` 追加 `[HH:MM:SS] batch_base: batch2=<sha>` 到 `trace.md`
  验证：`grep 'batch_base: batch2=' specs/241-graph-keepalive-kb-grounding/trace.md` 命中

### 2.1 常量与 redaction

- [x] T029 [P] 新增 `src/scaffold-kb/governance-constants.ts`：导出 `MIN_OCCURRENCE_THRESHOLD=2`、`NOHIT_RETENTION_DAYS=30`、`KB_FRESHNESS_AGING_DAYS=30`、`KB_FRESHNESS_STALE_DAYS=90`（OQ-2 单一常量模块要求，四参数集中于此使调参成本=改一处常量+改测试期望值）
  验证：`npx tsc --noEmit` 对该文件零错误（随 `npm run build` 一并验证）

- [x] T030 [P][红测试] 新增 `tests/kb/query-redaction.test.ts`：FR-012 六类规则（email/带凭据URL/高熵串/疑似token/绝对路径home段/连续数字串）各 ≥2 正例 +1 反例，断言输出串不含原文敏感片段；另一条断言模块导出的规则表长度与文档表一致
  验证：`npx vitest run tests/kb/query-redaction.test.ts` 因模块不存在而失败（红）

- [x] T031 实现 `src/scaffold-kb/query-redaction.ts`：导出 `redactQuery(raw: string) -> { redacted: string, tags: string[] }`，六类规则以数据表形式声明（非散落正则），模块文档注释如实写明能力边界（对中文姓名/内部代号/自然语言口令/带分隔符电话号码无效）
  验证：`npx vitest run tests/kb/query-redaction.test.ts` 全绿

### 2.2 no-hit 落盘

- [x] T032 [P][红测试] 新增 `tests/kb/nohit-recorder.test.ts`：FR-013 落盘对象键集合恰为 `terms`/`normalizedQueryHash`/`redactionTags`/`tool`/`timestamp`/`resultCount`/`dbPathHash`/`schemaVersion`（无整串字段）；伪造 40 天前 mtime 文件 → 写入时被清理；只读目录场景查询正常返回（静默降级）；同一查询两次的 `normalizedQueryHash` 相同；`SPECTRA_KB_NOHIT_TELEMETRY` 未设置/空字符串 → `resolveNoHitTelemetryDir()` 返回 `null` 且 `recordNoHit` 全程零 I/O（P-W3）
  验证：`npx vitest run tests/kb/nohit-recorder.test.ts` 因模块不存在而失败（红）

- [x] T033 实现 `src/scaffold-kb/nohit-recorder.ts`：导出 `recordNoHit({ tool, rawQuery, dbPath })`（静默降级，EC-20）与 `resolveNoHitTelemetryDir()`（读 `SPECTRA_KB_NOHIT_TELEMETRY`，唯一解析函数，P-W3 硬约束）；内部流程 `resolveNoHitTelemetryDir` 判空提前返回 → `redactQuery` → 复用 `src/scaffold-kb/tokenizer.ts` 切词去重 → 落盘 + 30 天滚动清理（`NOHIT_RETENTION_DAYS` 常量）
  验证：`npx vitest run tests/kb/nohit-recorder.test.ts` 全绿

### 2.3 三处挂点（T-C3：红测试全部前移到对应接线任务之前）

- [x] T034 [P][红测试] 改 `tests/kb/kb-search-tool.test.ts`：新增两组用例——`merged.length===0` 时断言 `recordNoHit` 被调用（spy）；`merged.length>0` 时断言 `recordNoHit` **不**被调用
  验证：`npx vitest run tests/kb/kb-search-tool.test.ts` 此刻因挂点未接线而失败（红）

- [x] T035 no-hit 挂点 1：`src/kb-mcp/tools/kb-search.ts::executeKbSearch` 在 `merged.length === 0` 时调用 `recordNoHit({ tool: 'kb_search', rawQuery: params.query, dbPath })`（plan §1.5 现行 `:80`）
  验证：`npx vitest run tests/kb/kb-search-tool.test.ts` 全绿（T034 转绿）

- [x] T036 [红测试] 改 `tests/kb/kb-api-lookup-tool.test.ts`：新增四组用例——(a) `matched.length===0`（挂点2a，`allEnts.length>0` 正常路径）→ 断言 `recordNoHit` 被调用；(b) `matched.length>0`（2a 反例）→ 断言不被调用；(c) `documentFallback` 内 `hits.length===0`（挂点2b）→ 断言 `recordNoHit` 被调用；(d) `documentFallback` 内 `hits.length>0` → 断言不被调用（区分"零结果"与"有结果"两态，防止挂点误判为无条件记录）
  验证：`npx vitest run tests/kb/kb-api-lookup-tool.test.ts` 此刻因两处挂点均未接线而失败（红）

- [x] T037 no-hit 挂点 2a：`src/kb-mcp/tools/kb-api-lookup.ts::executeKbApiLookup` 的 `matched.length===0`（`allEnts.length>0` 正常路径，现行 `:141`）分支调用 `recordNoHit({ tool: 'kb_api_lookup', ... })`
  验证：见 T038（两处挂点合并验证）

- [x] T038 no-hit 挂点 2b（P-W3 硬性不豁免）：`documentFallback`（`allEnts.length===0`，现行 `:79-100`）内部 `hits` 数组组装完成后（现行 `:93` 返回前），若 `hits.length === 0` **同样**调用 `recordNoHit({ tool: 'kb_api_lookup', ... })`
  验证：`npx vitest run tests/kb/kb-api-lookup-tool.test.ts` 全绿（T036 全部四组用例转绿，T037/T038 完成后）

- [x] T039 [P][红测试] 改 `tests/kb/scaffold-kb-query.test.ts`：新增两组用例——`merged.length===0` 时断言 `recordNoHit` 被调用；`merged.length>0` 时断言不被调用
  验证：`npx vitest run tests/kb/scaffold-kb-query.test.ts` 此刻因挂点未接线而失败（红）

- [x] T040 no-hit 挂点 3：`src/cli/commands/scaffold-kb.ts::runQuery` 在既有 `merged.length===0` 分支（现行 `:61-64`）旁挂 `recordNoHit({ tool: 'scaffold_kb_query', ... })`
  验证：`npx vitest run tests/kb/scaffold-kb-query.test.ts` 全绿（T039 转绿）；人工手跑一次 `spectra scaffold-kb query` 触发零结果场景确认落盘

### 2.4 coverage-gap 聚合器与 CLI 接线

- [x] T041 [P][红测试] 新增 `tests/kb/coverage-gap.test.ts`：三态互不相同（`collection-disabled`/`no-data`/`no-gap-above-threshold`，`items` 均空但 `status` 不同）；fixture（term X 出现 3 行分属 2 个不同 `normalizedQueryHash`，term Y 出现 3 行同属 1 个 hash，1 条独有词，1 行损坏 JSON）→ 恰 1 条目（term X）+ `distinctQueries:2` + `occurrences:3`，term Y **不在** items 中，`skippedLines:1`，退出码 0
  验证：`npx vitest run tests/kb/coverage-gap.test.ts` 因模块不存在而失败（红）

- [x] T042 实现 `src/scaffold-kb/coverage-gap.ts`：导出 `buildCoverageGapReport({ nohitDir, isCollectionEnabled }) -> CoverageGapOutput`，按 term 聚合、`distinctQueries≥2` 阈值过滤，`--format json|markdown`
  验证：`npx vitest run tests/kb/coverage-gap.test.ts` 全绿

- [x] T043 [红测试]（T-C3：从原实现之后前移到实现之前）改 `tests/kb/cli-scaffold-kb.test.ts`：`spectra scaffold-kb coverage-gap --dry-run` 经 parse-args 解析出 `op='coverage-gap'` 且不落 `invalid_subcommand`，并 dispatch 到 `runCoverageGap`；未知 op 仍被拒（P-W5，防"模块单测全绿但 CLI 永远不可达"）
  验证：`npx vitest run tests/kb/cli-scaffold-kb.test.ts` 此刻因 `parse-args.ts`/`scaffold-kb.ts` 均未接线而失败（红）

- [x] T044 [P] 改 `src/cli/utils/parse-args.ts`：`scaffoldKbOperation` union（现行 `:113`）扩 `'coverage-gap'`，同步 `:758` 附近合法 op 校验分支，新增 coverage-gap 专用 flag 解析（P-W5）
  验证：见 T046（两处改动合并验证）

- [x] T045 改 `src/cli/commands/scaffold-kb.ts`：op dispatch 新增 `'coverage-gap'` 分支（`runCoverageGap`，调用 T042 的 `buildCoverageGapReport`）
  验证：`npx vitest run tests/kb/cli-scaffold-kb.test.ts` 全绿（T043 转绿，T044/T045 完成后）

- [x] T046 [P] 改 `src/cli/index.ts`：scaffold-kb help 文案补 `coverage-gap` op 说明
  验证：人工核对 `spectra scaffold-kb --help` 输出含新增 op 说明

### 2.5 数据路径自举（FR-024 no-hit 路径部分）

- [x] T047 [P] 改仓库根 `.gitignore`：新增一条 `.specify/kb-nohit/`；同步改 `plugins/spec-driver/scripts/lib/ensure-gitignore.sh` 自举清单，新增同一条目
  验证：`git check-ignore -v .specify/kb-nohit/nohit-20260803.jsonl` 命中（退出码 0）

- [x] T048 [红测试] 改 `plugins/spec-driver/tests/ensure-gitignore.test.mjs`：与批 1 共享同一文件，本批追加 `.specify/kb-nohit/` 的双段断言，合计断言数从 5（T026 后）提升到 6（T-I1 修正：原 v1 的悬空引用已改为指向本任务）
  验证：`node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs` 全绿（T047 完成后转绿）

### 2.6 批 2 门禁

- [x] T049 **批 2 门禁**：`npx vitest run tests/kb/` 全绿（文件数/测试数 ≥ 批 1 前基线 32/293 之上有净增）+ `npx vitest run tests/kb/cli-scaffold-kb.test.ts`（T-C5：作为既已存在文件的重跑而非"新建"，与 `tests/kb/` 整体一起跑但显式点名确认覆盖）+ `node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs`（T-C5：批 2 重跑该合用测试文件，确认 6 条断言全绿，不只是批 1 遗留状态）+ `npm run build` 零错误 + `npm run repo:check` exit 0。RG 抽查（对 `git diff <batch2-base> -- <paths>`，T-W3）：RG-005（`kb-contract.test.ts` 中既有字段断言未被放宽，人工 diff 核对）；RG-009（T-C5 扩展：no-hit 目录只读**与缺列**两类故障注入下 `kb_search` 返回的 `results` 与故障注入前逐字节相同、进程退出码 0、stdout 无治理层错误输出）。**continuous capture 台账同步检查**：`pilot/mcp-call-log.md`/`pilot/ledger.jsonl` 本批新增条目数一致且 `seq` 单调
  验证：以上命令全部零失败，逐项记入交付 report

---

## 批 3 — E2/E3 KB version selection + freshness status（FR-016~FR-021）

- [x] T050 记录 batch3 base：`git rev-parse HEAD` 追加 `[HH:MM:SS] batch_base: batch3=<sha>` 到 `trace.md`
  验证：`grep 'batch_base: batch3=' specs/241-graph-keepalive-kb-grounding/trace.md` 命中

### 3.1 lockfile 版本解析与决议

- [x] T051 [P][红测试] 新增 `tests/kb/lockfile-parser.test.ts`：FR-016，三种 lockfile（`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`）各给最小 fixture 断言解析出预期版本；`go.sum` fixture 断言 `ecosystem-unsupported`；构造超限巨大 lockfile 断言明确失败而非 OOM（EC-28）
  验证：`npx vitest run tests/kb/lockfile-parser.test.ts` 因模块不存在而失败（红）

- [x] T052 实现 `src/scaffold-kb/lockfile-parser.ts`：导出 `parseLockfileVersion({ lockfilePath, packageName, kind }) -> { version, source } | null`，复用 `src/panoramic/project-context.ts::LOCK_FILE_PRIORITY` 仅做探测优先级，内容解析全新写；`statSync` 前置大文件保护（阈值 32MB `[推断]`，理由见 plan §6）
  验证：`npx vitest run tests/kb/lockfile-parser.test.ts` 全绿

- [x] T053 [P][红测试] 新增 `tests/kb/version-resolver.test.ts`：FR-017、EC-25，六组 fixture（仅显式/仅lockfile/两者冲突/多lockfile无显式/多lockfile+显式/**lockfile 与 `node_modules` 实际安装版本不一致**）断言 `resolved.status` 分别正确；`ambiguous` 时 `version===null` + `candidates.length≥2` + `flags` 含 `multiple-lockfiles`；冲突组 `flags` 含 `version-conflict`；第六组（P-W2 补齐缺口）`flags` 含 `lockfile-install-mismatch`，不可检测时不猜测且不含该值
  验证：`npx vitest run tests/kb/version-resolver.test.ts` 因模块不存在而失败（红）

- [x] T054 实现 `src/scaffold-kb/version-resolver.ts`：导出 `resolveVersion({ projectRoot, packageName, explicitVersion? }) -> VersionResolution`，优先级仲裁 explicit > lockfile(单一) > range-only > none；多 lockfile 且无 explicit → `ambiguous`；lockfile 与 `node_modules/<pkg>/package.json` 实际安装版本不一致（可检测时）→ 两者同入 `candidates[]` 并标 `lockfile-install-mismatch`
  验证：`npx vitest run tests/kb/version-resolver.test.ts` 全绿

### 3.2 KB 状态报告器

- [x] T055 [P][红测试] 新增 `tests/kb/kb-status.test.ts`：FR-019/020，5/45/100 天前三组 `built_at` → current/aging/stale；100天前`built_at`+5天前`ingested_at` → `current`（验证取 max）且 `oldestBuiltAt` 如实反映 100 天前；缺 provenance 列旧库 → `unknown`+`legacy-missing-provenance`+exit 0；**追加"旧库 `built_at` 为 1 天前（很新）仍 `unknown`"回归用例**（P-W4，不得回落为 `current`）；`noHitCollection`/`recentNoHitCount` 字段断言（env 未设→`disabled`+`null`，设置且有数据→`enabled`+非负整数）；运行前后库文件 SHA-256 不变
  验证：`npx vitest run tests/kb/kb-status.test.ts` 因模块不存在而失败（红）

- [x] T056 实现 `src/scaffold-kb/kb-status.ts`：导出 `buildKbStatusReport(db | null) -> KbStatusOutput`，直接 import `schema-compat.ts::hasProvenanceColumns` 做 `PRAGMA table_info` 探测（不新增探测函数）；`activityAt` 口径 `[推断，plan §1.6 拍板]` = 先逐行算 `max(built_at, ingested_at)` 再对全表取 `MAX(...)`，`oldestBuiltAt` = 全表 `MIN(built_at)`；`hasProvenanceColumns` 返回 `false` 时 `activityAt` 恒为 `null`、`freshness` 恒为 `"unknown"`（P-W4 纠正，不得因 `built_at` 新近而误判）
  验证：`npx vitest run tests/kb/kb-status.test.ts` 全绿

### 3.3 CLI 接线（version / status 两 op）

- [x] T057 [红测试]（T-C3：从原实现之后前移到实现之前）改 `tests/kb/cli-scaffold-kb.test.ts`：`version`/`status` 两 op 解析通过 + dispatch 到对应分支的集成断言（parse→runScaffoldKb 全链，P-W5，SC-012/013）
  验证：`npx vitest run tests/kb/cli-scaffold-kb.test.ts`（本组新增用例）因 union 未扩而失败（红）

- [x] T058 [P] 改 `src/cli/utils/parse-args.ts`：`scaffoldKbOperation` union 再扩 `'version'`、`'status'`（P-W5，同批 2 模式）
  验证：见 T059

- [x] T059 改 `src/cli/commands/scaffold-kb.ts`：op dispatch 新增 `'version'`、`'status'` 两分支
  验证：`npx vitest run tests/kb/cli-scaffold-kb.test.ts` 全绿（T057 转绿，T058/T059 完成后）

- [x] T060 [P] 改 `src/cli/index.ts`：scaffold-kb help 文案补 `version`/`status` 两 op 说明
  验证：人工核对 `spectra scaffold-kb --help` 输出

### 3.4 MCP 响应字段扩展（FR-021）

- [x] T061 [红测试] 改 `tests/kb/kb-contract.test.ts`：新增断言 `kb_search`/`kb_api_lookup` **全部成功 envelope**（含 `document_fallback`、`not_found` 早返回分支）均含 `kb_status` 子对象；**error envelope 不含**该字段（P-W4 已钉死）；既有字段（`results`/`total_found`/`not_found`）的名称、类型、层级零变更
  **已记录偏差（B3-W3 修正表述）**：原文写「不修改任何既有断言期望值，只追加新断言」，实际必须改一处——`SC-012 响应契约 shape` 用例的 exact 键集合断言把 `kb_status` 纳入期望集（121 insert / 1 delete）。这不是放宽而是**加严**：断言仍是 `toEqual` 精确集合相等（未退化为 `arrayContaining`），既有 5 个键一个不少、一个不改，新增键必须如实出现。另补一条「删掉 `kb_status` 后剩余形状与接线前逐字段一致」的反向断言把 RG-005 钉死。
  验证：`npx vitest run tests/kb/kb-contract.test.ts` 此刻因 payload 未接线而失败（红）

- [x] T062 [红测试]（T-C3：从原实现之后前移到实现之前）改 `tests/kb/kb-search-tool.test.ts` / `tests/kb/kb-api-lookup-tool.test.ts`：工具级集成断言含 `kb_status`；`kb-api-lookup-tool.test.ts` 额外覆盖 `documentFallback` 分支下 `kb_status` 同样出现
  验证：两文件此刻因 payload 未接线而失败（红）

- [x] T063 改 `src/kb-mcp/tools/kb-search.ts`：payload 新增 `kb_status` 子对象（`buildKbStatusReport` 子集：`activityAgeDays`/`sourceVersions`/`freshness`），追加到 `buildKbSuccess` 全部出口
  验证：见 T064（两处改动合并验证）

- [x] T064 改 `src/kb-mcp/tools/kb-api-lookup.ts`：payload 新增 `kb_status` 子对象，追加到全部成功 envelope（含 `documentFallback` 分支现行 `:93`、`not_found` 早返回分支现行 `:142`）；`error` envelope（`buildKbError` 出口）不追加
  验证：`npx vitest run tests/kb/kb-contract.test.ts tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts` 全绿（T061/T062 全部转绿，T063/T064 完成后）

### 3.5 批 3 门禁

- [x] T065 **批 3 门禁**：`npx vitest run tests/kb/` 全绿（文件数/测试数在批 2 基线之上净增）+ 新建的 `tests/kb/cli-scaffold-kb.test.ts` 相关用例（T-C5：作为独立 parse-args 集成测试点名重跑，不只是随 `tests/kb/` 整体带过）+ `npm run build` 零错误 + `npm run repo:check` exit 0。RG 抽查（对 `git diff <batch3-base> -- <paths>`，T-W3）：RG-005（KB 现有链零回归，`kb-contract.test.ts` 既有断言未放宽）；RG-008（**T-W4 命令矩阵**：对 `coverage-gap`/`version`/`status`/`query` 四个只读 CLI 子命令各执行一次，逐项记录 `specs/_meta/graph.json` 的 before/after SHA-256 + 命令退出码，全部相同/全部 0；RG-009 缺列故障注入：`kb-status.ts` 探测缺列场景下的读路径同样零副作用）
  验证：以上命令全部零失败，逐项记入交付 report。**continuous capture 台账同步检查**：本批新增条目数一致且 `seq` 单调

---

## 批 4 — Pilot Finalize（FR-022~FR-023 收口段）

> **前置澄清（P-C2）**：`pilot/predicted-impact-set.md`、`pilot/mcp-call-log.md`、`pilot/ledger.jsonl`（11 行，已含 `timestamp:null` + `timestampNote` 回填，preflight 已完成、continuous capture 持续记账中）均**非本批新增制品**，本批只做 finalize 段——实际集比对、M-3、报告撰写、ledger 重算校验。

- [ ] T066 记录 batch4 base：`git rev-parse HEAD` 追加 `[HH:MM:SS] batch_base: batch4=<sha>` 到 `trace.md`
  验证：`grep 'batch_base: batch4=' specs/241-graph-keepalive-kb-grounding/trace.md` 命中

- [ ] T067 [红测试][P] 新增 `specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs`（dev-only 重算脚本，放 pilot 目录非 `scripts/`，纯 Node 内置模块）：从 `pilot/ledger.jsonl` 重算 M-1 四类计数与命中率；断言既有 11 行 `timestamp===null` 且 `timestampNote` 非空、此后新增行 `timestamp` 为合法 ISO 8601 字符串（非 null，P-C2 point 3 迁移条款）
  验证：先跑一次（报告尚未撰写时）应因缺参照数字而无法比对（记为"红"——脚本本体先写好但比对目标未就绪）；T070 完成后 `node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs` exit 0

- [ ] T068 实际集比对（M-2）：对照 `pilot/predicted-impact-set.md` 计算 coverage/precision/missed-list 三数（missed-list 逐条归因），产出数据供 T070 报告引用
  验证：数据来源可追溯到 `pilot/mcp-call-log.md`/`pilot/ledger.jsonl` 的具体行，missed-list 每条附归因说明

- [ ] T069 M-3 A/B 同构对抗审查：对同一份 diff 并行启动两组同构 Codex 对抗审查子代理，落盘 `pilot/m3/prompt-a.md`、`pilot/m3/prompt-b.md`、`pilot/m3/diff.hash`（对该轮 diff 内容算 SHA-256，与 `git diff` 现场重算值一致）；若配额不足无法并行执行两组，按 OQ-1 如实登记"M-3 未执行"及原因（不伪造数据凑正向结果）
  验证：`sha256sum` 现场重算的 diff hash 与 `pilot/m3/diff.hash` 内容一致；`prompt-a.md`/`prompt-b.md` 除 grounding 包内容外逐字相同（人工 diff 核对，checklist 反纸面达成项）

- [ ] T070 撰写 pilot 报告：`specs/241-graph-keepalive-kb-grounding/pilot/report.md`。含 M-1 四类计数与命中率、M-2 三数（coverage/precision/missed-list）、M-3 A/B 两组真 finding 数与"B独有"/"A独有"差异数；FR-023 诚实性声明五项关键词（N=1、判读者非盲、单次采样、自我选择偏置——含"机器台账只治算术漂移、不治自报偏置"一句、结构性封顶为0）；`.mjs` 部分命中率结构性封顶为 0 及根因指针（O-5）；plan 附录记录的 O-8 补充发现（`searchKbCore` 实际 4 个直接调用方、图仅报 2 个，非零但仍偏低的 undercount，caveat 设计覆盖不到）列入"口径缺陷"一节；**禁止外推表述**（如"提升 X%"）
  验证：见 T071/T072

- [ ] T071 [红测试][P] SC-015 验证：`git log --format=%aI -- specs/241-graph-keepalive-kb-grounding/pilot/predicted-impact-set.md` 首次提交时间早于首个 implement 代码提交；`git diff <measurement-design.md 首次commit锚定SHA> -- specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md` 输出为空
  验证：两条命令均按预期输出（前者时间先后正确、后者 diff 为空）

- [ ] T072 [红测试][P] SC-017 验证：grep `pilot/report.md` 断言含「N=1」「判读者非盲」「单次采样」「自我选择偏置」「结构性封顶」五项关键词；人工审查确认不含「提升 X%」等外推表述（该项因黑名单不可穷举，W5 已裁决改为人工审查项，记入交付 report）
  验证：grep 命令全部命中；人工审查结论写入交付 report

### 批 4 门禁

- [ ] T073 **批 4 门禁（同时是全局收口门禁）**：`node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs` exit 0（重算 M-1 数字与报告逐项一致）+ `npx vitest run` 全绿（总文件/测试数不低于改动前基线 490文件/6017测试）+ `npm run build` 零错误 + `npm run repo:check` exit 0（全 family）+ `npm run release:check` 零失败（SC-018）+ `spectra graph-quality --json` `overallVerdict` 为 `pass`/`pass-with-warnings`（RG-007）。**T-C5 补齐**：T071 与 T072 的全部验证命令重跑一遍（不只是撰写阶段跑过一次）；M-3 prompt 同构性重新人工 diff `pilot/m3/prompt-a.md`/`prompt-b.md` + `sha256sum` 复核 `diff.hash`；`node --test plugins/spec-driver/tests/*.mjs`（插件侧全套，不能只跑 vitest——本批不改插件代码，但作为全局收口须确认零回归）。**continuous capture 收口检查**：`pilot/mcp-call-log.md` 总条目数与 `pilot/ledger.jsonl` 总行数（含 11 行迁移行）一致，`seq` 全程单调
  验证：以上命令全部零失败，逐项记入交付 report；随后可进入 verify 阶段

---

## FR / SC / RG → 任务 Crosswalk（四列，T-C2 整改）

### Functional Requirements

| FR | 测试文件 | 具体断言/用例 | 门禁命令 |
|---|---|---|---|
| FR-001 | `graph-consumption-decision.test.mjs`（T008） | 144 组合穷举逐一断言 outcome/matchedRule | `node --test .../graph-consumption-decision.test.mjs`（T027） |
| FR-002 | `graph-consumption-decision.test.mjs`（T008） | 5 条 invalid-input 缺字段用例，五维严格入参 | 同上（T027） |
| FR-003 | `graph-consumption-decision.test.mjs`（T008） | 决策矩阵 v2 顺序 + missing/out-of-scope 两条顺序不变量 | 同上（T027） |
| FR-004 | `graph-consumption-decision.test.mjs`（T008） | `DEGRADED_REASONS` 恰 12 项 | 同上（T027） |
| FR-004b | `graph-consumption-decision.test.mjs`（T008） | `CAVEAT_CODES` 恰 1 项，与 12 值交集为空 | 同上（T027） |
| FR-005 | `git-change-classifier.test.mjs`（T010） | NUL 分隔 fixture 全类型 + 负例 | `node --test .../git-change-classifier.test.mjs`（T027） |
| FR-006 | `graph-consumption-decision.test.mjs`（T008） | `annotateImpactCaveat` 三条对照 | 同上（T027） |
| FR-007 | `graph-refresh-executor.test.mjs`（T012） | 四类失败→四个 `refresh-failed-*` 枚举值 + 真实集成用例 | `node --test .../graph-refresh-executor.test.mjs`（T027） |
| FR-008 | `graph-consumption-cli.test.mjs` Part1（T014） | 单调用 spawn ≤1 计数桩 | `node --test .../graph-consumption-cli.test.mjs`（T027） |
| FR-009 | `graph-consumption-cli.test.mjs` Part1/2（T014/T016） | `decide`/`annotate-caveat` 两子命令契约 | 同上（T027） |
| FR-010 | `graph-consumption-cli.test.mjs` Part2（T016） | 双事件审计模型，12 值逐值验证 | 同上（T027） |
| FR-011 | `goal-loop-graph-consumption-integration.test.mjs`（T020） | advisory/authoritative 双合同 + iteration log 注入正反断言 | `node --test .../goal-loop-graph-consumption-integration.test.mjs`（T027） |
| FR-012 | `query-redaction.test.ts`（T030）+ `kb-search-tool.test.ts`（T034）+ `kb-api-lookup-tool.test.ts`（T036）+ `scaffold-kb-query.test.ts`（T039） | 六类脱敏规则 + 三处挂点各自正反 no-hit 用例；**M-3 整改增**：NFKC 前置/大小写不敏感（B2-1）、`sourcesQueried>0` 前置条件三挂点负例（B2-7）、dbPath thunk 惰性求值三挂点回归（B2-9） | `npx vitest run tests/kb/`（T049） |
| FR-013 | `nohit-recorder.test.ts`（T032） | 落盘键集合恰 8 键 + 30 天清理 + 只读降级；**M-3 整改增**：整行敏感片段零出现终态断言 + 单 token 护栏（B2-1/B2-5）、等价类 hash（B2-6）、只写常规文件 FIFO/symlink（B2-2）、`tool` 运行时 allowlist 零 append（B2-8） | `npx vitest run tests/kb/nohit-recorder.test.ts`（T049） |
| FR-014 | `coverage-gap.test.ts`（T041） | **四态**互不相同（含 `data-unreadable`，M-3 整改 B2-3）+ `readErrors` 恒在字段 | `npx vitest run tests/kb/coverage-gap.test.ts`（T049） |
| FR-015 | `coverage-gap.test.ts`（T041） | `distinctQueries≥2` 阈值过滤；**M-3 整改增**：文件级读取失败计入 `readErrors` 而非静默跳过（B2-3） | 同上（T049） |
| FR-016 | `lockfile-parser.test.ts`（T051） | 三种 lockfile + `go.sum` 不支持 + 超限保护 | `npx vitest run tests/kb/lockfile-parser.test.ts`（T065） |
| FR-017 | `version-resolver.test.ts`（T053） | 六组 fixture 含 `lockfile-install-mismatch` | `npx vitest run tests/kb/version-resolver.test.ts`（T065） |
| FR-018 | **已删除（plan §5，判定：不实现）** | 检索侧接入会改变默认行为语义，撞 Non-Goals 第9条；E2 验收由 FR-016/017 独立满足 | — |
| FR-019 | `kb-status.test.ts`（T055） | freshness 公式（max(built_at,ingested_at)），三档阈值 | `npx vitest run tests/kb/kb-status.test.ts`（T065） |
| FR-020 | `kb-status.test.ts`（T055） | 旧 schema 探测→`unknown` 恒定（含"built_at 很新仍 unknown"回归） | 同上（T065） |
| FR-021 | `kb-contract.test.ts`（T061）+ `kb-search-tool.test.ts`/`kb-api-lookup-tool.test.ts`（T062） | `kb_status` 全部成功 envelope 出现，error envelope 不出现 | `npx vitest run tests/kb/kb-contract.test.ts tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts`（T065） |
| FR-022 | `pilot/ledger-verify.mjs`（T067） | M-1 四类计数重算 + M-2/M-3 数据落盘 | `node .../pilot/ledger-verify.mjs`（T073） |
| FR-023 | `pilot/report.md`（T070）+ grep 校验（T072） | 五项诚实性关键词 + 禁止外推人工审查 | grep + 人工审查（T073） |
| FR-024 | `ensure-gitignore.test.mjs`（T026, T048） | 审计路径（4→5）+ no-hit 路径（5→6）双清单同步 | `node --test .../ensure-gitignore.test.mjs`（T027, T049） |

### Acceptance Criteria

| SC | 测试文件 | 具体断言/用例 | 门禁命令 |
|---|---|---|---|
| SC-001 | T008 | 144 组合穷举无 undefined/throw | T027 |
| SC-002 | T012, T014, T019 | 真实 stale+allowed 刷新，`refreshOk`/`refreshDurationMs` | T027 |
| SC-003 | T014, T019 | 非 dry-run additive-only，图 SHA 全程不变 | T027 |
| SC-004 | T014 | CLI JSON 封闭键集合 + 12 reason 固定模板映射 | T027 |
| SC-005 | T008, T016 | 12 值分类断言（决策层）+ 12 个非 dry-run decision 事件逐值验证（审计层） | T027 |
| SC-006 | T008, T012 | present→consume-degraded / missing→unavailable 出口改写 | T027 |
| SC-007 | T014, T016 | 单调用 spawn≤1（进程内）+ 调用方合同两次调用（跨调用） | T027 |
| SC-008 | T020, T021, T022, T023 | 允许态确注入/拒绝态确不注入正反两向断言 | T027 |
| SC-009 | T030, T032 | redaction 反例 + nohit-recorder 键集合 | T049 |
| SC-010 | T041, T042 | **四态**互不相同（`collection-disabled`/`no-data`/`data-unreadable`/`no-gap-above-threshold`）+ markdown/json 均打出 `readErrors` | T049 |
| SC-011 | T041, T042 | `distinctQueries≥2` 阈值过滤 | T049 |
| SC-012 | T051, T053, T057 | lockfile 解析 + version-resolver + CLI parse→dispatch 集成 | T065 |
| SC-013 | T055, T057 | kb-status 三档 + CLI parse→dispatch 集成 | T065 |
| SC-014 | T061, T062 | `kb_status` 全 envelope 出现（不含 error） | T065 |
| SC-015 | T071 | predicted-impact-set 首次提交早于 implement + measurement-design 无 diff | T073 |
| SC-016 | T067, T068, T073 | ledger-verify 重算与报告一致 | T073 |
| SC-017 | T070, T072 | 五项关键词 grep + 人工审查外推表述 | T073 |
| SC-018 | T073 | `npm run release:check` 零失败 | T073 |
| SC-019 | T014, T018 | 仓外临时目录拷贝跑 `decide --dry-run` | T027 |
| SC-020 | T026, T048 | 双段 `git check-ignore`（审计路径 + no-hit 路径） | T027, T049 |

### 回归护栏（RG）

| RG | 具体检查项 | 门禁命令 |
|---|---|---|
| RG-001 | `git diff <batch1-base> -- plugins/spec-driver/tests/goal-loop-core.test.mjs` 为 0 行改动，测试数 ≥163 | T027 |
| RG-002 | `orchestration.yaml` 零改动 + goal_loop 默认配置 disabled/opt-in + `decide --dry-run` 零副作用二次确认（T-C2 落实为真实命令） | T027 |
| RG-003 | `git diff <batch1-base> -- plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 为空 | T027 |
| RG-004 | `git diff <batch1-base> -- plugins/spec-driver/contracts/orchestration-schema.mjs plugins/spec-driver/config/orchestration.yaml` 为空 | T027 |
| RG-005 | `kb-contract.test.ts` 既有断言未被放宽（人工 diff 核对） | T049, T061, T065 |
| RG-006 | 三段静态扫描：产物名/freshness 唯一依赖/审计路径读取（T-C6 扩展，显式文件集合见 T014） | T014, T027 |
| RG-007 | `spectra graph-quality --json` `overallVerdict` 为 pass/pass-with-warnings | T027, T065, T073 |
| RG-008 | 四命令矩阵（coverage-gap/version/status/query）SHA-256 + 退出码逐项记录（T-W4） | T065 |
| RG-009 | no-hit 目录只读**与缺列**两类故障注入下主链路零副作用（T-C5 扩展） | T049, T065 |

---

## 交付批次约束提醒（不重议，仅登记）

1. **批间硬依赖边**：T027/T049/T065/T073 四条门禁未过，不得启动下一批任务。
2. **FR-018 不生成实现任务**——已在 crosswalk 中登记为删除，理由见 plan §5，不在本 tasks.md 生成任何子任务。
3. **pilot 制品现状**：`pilot/predicted-impact-set.md`/`pilot/mcp-call-log.md`/`pilot/ledger.jsonl`（含 timestamp 迁移回填）均已存在，批 4 任务只做 finalize 段，不重复生成这些前置制品；批 0 的 T001 只做 schema 校验，不重复生成。
4. 每个任务完成后建议立即跑对应"验证"命令，不要攒到批门禁才第一次执行——TDD 红测试任务必须先跑出真实失败（红），再进入下一个实现任务。
5. **batch-base 与 `phase_start_ref` 锚点均为 last-match-wins 语义**（T-W1）：读取方始终取 `trace.md` 内该键最后一条匹配行，rerun 场景追加而非改写。

---

## 批 1 收尾追加任务（编排器裁决）

批 1 门禁（T027）通过后，implement 报告的两条发现经编排器裁决为「补做」，编号续在 T027 之后。
两条均按 TDD 硬序执行（先跑出真实红态 → 再实现转绿），红态证据见
`verification/batch1-red-evidence.md`，门禁复跑摘要见 `verification/batch1-gate.md`。

- [x] T027a 修 canonical 与薄壳的符号链接守卫缺陷（批 1 发现 1）：`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 与仓根薄壳 `scripts/lib/graph-bootstrap-status.mjs` 的 `invokedDirectly` 原按 `path.resolve` 比对 `process.argv[1]` 与 `import.meta.url`。Node 默认解析符号链接，`import.meta.url` 已是 realpath，经软链路径调用时两者恒不相等 → `main()` 永不执行 → **exit 0 且什么都没做**（plan §1.2 警告的静默空转）。修法与 T018 在 `graph-consumption-cli.mjs` 用过的同款：两侧都过 `fs.realpathSync`，argv[1] 不可解析时优雅回退 `path.resolve`。判定逻辑收敛为 canonical 导出的 `isInvokedDirectly(moduleUrl)` 单一实现，薄壳 import 复用而非再写一份——两处各写一份正是本次同一 bug 在两边并存的成因。
  - 红测试：`plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs` 追加 3 条（薄壳经软链目录 / canonical 经软链目录 / argv[1] 不可解析不抛错），断言只盯真实落盘副作用，不看退出码（空转恰好也是 0）
  - 验证：`node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（8 → 11，全绿）；`npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/worktree-lifecycle-hook.test.ts`（54 全绿，零回归）

- [x] T027b 补 D3 的 tasks.md 目标路径信号（批 1 发现 3 第三条）：新增纯函数模块 `plugins/spec-driver/scripts/lib/tasks-path-signal.mjs`，导出 `extractTaskPaths(tasksMarkdownText)`（任务行内路径抽取，容忍勾选态 / `[P]` 标记 / 反引号包裹 / 中文路径 / `路径::符号` 与 `路径#符号` / `:行:列` 后缀；章节号与版本号不误抽；解析不出返回 `[]`）与 `classifyFromTaskPaths(paths, fsExists)`（`fsExists` 注入以保纯函数；任一存在→`modifies-existing`，全不存在且非空→`additive-only`，空清单/未注入/探测抛错→`unknown`）。`graph-consumption-cli.mjs decide` 加可选 `--tasks-file <path>`：**仅 `--advisory` 生效**（非 advisory 传入则忽略 + stderr warning，权威判定只认 git diff 是 D3 红线），advisory 且 git 变更文件清单为空时才用该信号替代 `changeClass`，git 信号非空时 git 优先。作用域严格限于 `changeClass` 一维——`coverageScope` 仍只看 git 变更文件（tasks.md 是"打算改什么"，拿它决定要不要花一次全量重建不成立）。
  - 保守方向约束（D3）：该信号产生的 `skip-impact` 仍带 `advisory: true` 且 `authoritativeOutcome: null`，`fallbackHint` 沿用既有 `degradedReason` → 模板映射，零新增自由文本；测试显式断言 stdout/stderr 不出现「无影响面」类权威表述
  - 红测试：新增 `plugins/spec-driver/tests/tasks-path-signal.test.mjs`（21 条）；`graph-consumption-cli.test.mjs` Part 1 追加 7 条（advisory 三态 + git 优先 + 非 advisory 忽略并告警 + 读不到文件降级 + SC-004 封闭键集不变）
  - 附带：`tasks-path-signal.mjs` 已并入 `graph-consumption-cli.test.mjs` 的 RG-006 被审文件集合与 SC-019 相对 import 边界清单（集合只增不减，新决策链成员不得脱离守卫）
  - 验证：`node --test plugins/spec-driver/tests/tasks-path-signal.test.mjs`（21/21）；`node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（41 → 48，全绿）

## v2 相对 v1 的结构性变化（本轮修订摘要）

1. **全部任务编号重排**：T001-T073（v1 为 T001-T061），新增批 0（T001）与 5 个 `batch_base` 记录任务（T002/T028/T050/T066）。
2. **T-C1**：SKILL.md §3.1 接线判定条件从 `phase.id === "verify"`（恒 false）改为 `phase.name === "verify"` / `"implement"`（T021），并新增 effective-orchestration `name` 字段核对断言。
3. **T-C2**：crosswalk 由「FR/SC/RG → 任务」两列扩为「条目 → 测试文件 → 具体断言 → 门禁命令」四列；补齐 SC-004 封闭键+模板映射测试（T014）、SC-005 12 值审计事件测试（T016）、SC-006 并入决策测试（T008）、RG-002 真实检查命令落进 T027。
4. **T-C3**：批 2/3 全部挂点与 CLI 接线测试前移到实现之前（T034/T036/T039/T043/T057/T062），并为 kb_search（T034）与 scaffold-kb query（T039）挂点各新增正反 no-hit 红测试。
5. **T-C4**：新增批 0 preflight（T001）+ 「贯穿性完成条件」小节，把 continuous capture 双写设为 T004-T065 的共同完成条件，四个批门禁均新增台账同步检查。
6. **T-C5**：四个批门禁（T027/T049/T065/T073）逐个扩充测试文件清单与 RG 检查项（详见批门禁任务描述）。
7. **T-C6**：RG-006 静态检查从单一 grep 扩为三段（产物名扫描/freshness 唯一依赖扫描/审计路径读取扫描），显式列出被审文件集合（T014）。
8. **T-W1/T-W3**：`trace.md` 锚点统一时间戳格式 + last-match-wins 语义（T021 注释 + T020 断言）；每批门禁 RG 检查改用 `git diff <batch-base> -- <paths>`（T002/T028/T050/T066 + 各批门禁）。
9. **T-W2**：原 T003（graph-bootstrap-status-shim 测试）改标「迁移回归测试」，顺序调整为 T003（先行，对旧实现先绿）→ T004/T005（迁移）→ T006（复跑仍绿）。
10. **T-W4**：批 3 门禁（T065）补 RG-008 四命令矩阵（before/after SHA-256 + 退出码）。
11. **T-W5**：原 T011 拆为 T014/T016/T018/T019 四个红测试任务（CLI契约+dry-run/advisory；双事件审计；SC-019安装态；SC-002/003真实刷新），原 T012 拆为 T015/T017 两个实现任务（decide主链；annotate-caveat+审计写入器）；T029/T049（v1 编号）钉死目标测试文件为 `tests/kb/kb-api-lookup-tool.test.ts`（T036）与 `tests/kb/cli-scaffold-kb.test.ts`（T057）；T053（v1 编号，工具级 kb_status 集成测试，现为 T062）保持单任务不拆（两个同构 sibling 测试文件、同一断言模式，拆开反而碎，W5 已裁决不采纳拆分）。
12. **T-I1**：原 T019 对 T032 的悬空引用修正为指向本轮 T048（ensure-gitignore no-hit 路径断言任务）。

## Crosswalk 覆盖缺口自检

四列化 crosswalk 覆盖全部 24 条 FR（含 1 条已确认删除的 FR-018）、20 条 SC、9 条 RG，逐项均有具体测试文件+断言描述+门禁命令三要素，未发现悬空引用或虚映射。

## 批 1 Codex 整改（代码对抗审查 `task-msc6wt4l-emi1m9`）

批 1 收尾后的代码对抗审查判「门禁不通过」（7 CRITICAL / 7 WARNING），裁决落在
`review-dispositions.md` 的「Implement 批 1 — Codex 代码对抗审查整改单」。逐条按 TDD 硬序修复
（先按审查证伪输入补红测试 → 再修绿），红态证据见 `verification/batch1-red-evidence.md` 末节，
整改后门禁全表见 `verification/batch1-gate.md` 末节。

| 编号 | 处置 | 落点 | 状态 |
|---|---|---|---|
| B1-C1 | availability 收紧：仅非空字符串 `sourceCommit` 判 present，缺失/空串/非字符串一律 corrupt | `graph-consumption-cli.mjs` 新增 `readVerifiedSourceCommit` | ✅ 已修（+4 红测试） |
| B1-C2 | availability 采集入口改 `lstatSync`：仅 lstat ENOENT = missing，路径存在但不可用 = corrupt | `graph-consumption-cli.mjs::collectGraphAvailability` | ✅ 已修（+3 红测试，含真实 broken-symlink fixture） |
| B1-C3 | 刷新成功后重读已验证产物取 G2 更新输出与 decision 事件；重读失败收口 `refresh-failed-artifact-unusable` | `graph-consumption-cli.mjs` 新增导出纯函数 `finalizeRefreshOutcome` + `runDecide` 接线 | ✅ 已修（+4 红测试，含 G1→G2→annotate 全链） |
| B1-C4 | `annotate-caveat` 加 `--target <symbolId>`；内部归一化 `summary.directCallers ?? directCallers`；target 缺失或图外扩展一律**不注解** | `graph-consumption-decision.mjs::annotateImpactCaveat` + CLI 参数 | ✅ 已修（+7 红测试，含真实 MCP payload 形状） |
| B1-C5 | SKILL 步骤 2 advisory 命令补 `--tasks-file`；wrapper 再生；接线测试断言**完整参数串** | `skills/spec-driver-feature/SKILL.md` + `npm run repo:sync` 再生两 wrapper | ✅ 已修（+2 红测试，其一直接校验两份 wrapper） |
| B1-C6 | RG-006 静态门禁改为从 CLI 入口解析 import 闭包（递归、限 `plugins/spec-driver/scripts/` 子树），三段扫描作用于闭包全集；固定清单退为下限断言 | `graph-consumption-cli.test.mjs::resolveImportClosure` | ✅ 已修（门禁自身缺陷，无产品红态） |
| B1-C7 | 抽最小纯函数 `buildImpactInjectionBlock(decision, impactSummary)`；正反两向用**同一份** impactSummary 输入断言 | `graph-consumption-decision.mjs` + goal_loop 集成测试 | ✅ 已修（+5 用例） |
| B1-W1 | 预算键钉死 `(projectRoot, phase=implement)`；goal_loop 已在本 phase 跑过 decide → 外层 verify 4b 恒 declined | SKILL 4b / 步骤 2 / 步骤 3b 三处措辞 | ✅ 已修（+1 断言，含"歧义措辞不得并存"反向断言） |
| B1-W2 | tasks 路径判据收紧：必须含 `/`、拒绝绝对路径与 Windows 盘符、拒绝 `..` 段；CLI 侧再做一次 projectRoot 包含性复核 | `tasks-path-signal.mjs` + CLI `classifyFromTasksFile` | ✅ 已修（+5 红测试，含正例对照防收紧过头） |
| B1-W3 | 测试显式改写 `process.argv[1]` 为不存在路径，强制进 realpath 的 catch 分支 | `graph-bootstrap-status-shim.test.mjs` | ✅ 已修（实现本就正确，**无红态**，是覆盖缺口修补） |
| B1-W4 | append 测试改真并发：6 个子进程同时 decide，断言行数/逐行可解析/decisionId 唯一 | `graph-consumption-cli.test.mjs` | ✅ 已修（+1 用例） |
| B1-W5 | gitignore 文件规则吞同名目录后代 —— **按裁决不修**（Git pattern 固有残余，写入 spec 残余声明由 verify 复核） | — | ⏭ 不修（已登记） |
| B1-W6 | 「4 条」旧口径措辞改为「固定条目 / N 条」 | `ensure-gitignore.sh` 3 处 + `ensure-gitignore.test.mjs` 5 处 | ✅ 已修（纯措辞，无行为变化） |
| B1-W7 | 审查沙箱 EPERM 无法复核完整绿态 → 修复后在可写环境全量重跑 | 见 `verification/batch1-gate.md` 末节 | ✅ 已重跑（1272 + 54 全绿） |

**本轮附带发现（如实上报，不静默绕过）**：

1. **RG-004 前两轮是空转检查**：`verification/batch1-gate.md` 记录的路径
   `plugins/spec-driver/contracts/orchestration.yaml` **不存在**（真实路径为
   `plugins/spec-driver/config/orchestration.yaml`）。对不存在路径跑 `git diff` 恒为空，
   故前两轮 RG-004 对 yaml 的那一半从未真正检查过。本轮已按正确路径复核，结论不变（0 行改动）。
2. **`npm run repo:sync` 产生无关时间戳 churn**：`specs/products/**/_generated/*` 与
   `.specify/project-context.suggestions.{md,yaml}` 的 diff 仅为 `generatedAt` 漂移，已还原，
   还原后 `repo:check` 仍 `status=pass`。

---

## 批 2 M-3 整改（Codex 双组对抗审查 BLOCKED → 修订）

> 依据：`review-dispositions.md`「Implement 批 2 — M-3 双组对抗审查整改单」（B2-1 ~ B2-9）。
> A 组 BLOCKED（3 CRITICAL / 4 WARNING / 1 INFO）+ B 组 BLOCK（2 CRITICAL / 3 WARNING / 1 INFO），
> 判读后 9 条真 finding / 0 误报。红态逐条见 `verification/batch2-red-evidence.md` 第二节，
> 整改后门禁全表见 `verification/batch2-gate.md` 末节。

- [x] T049a **B2-1** redaction 入口先 NFKC + 关键规则大小写不敏感（A-C2 / B-W2 交集，最高优先）
  实现：`tokenizer.ts` 抽出并导出 `normalizeUnicode`（全仓**唯一**一份 NFKC，`tokenize` 改调它）；
  `redactQuery` 入口先归一化再匹配；URL 凭据参数名整条规则 `/i`、Bearer scheme 逐字母字符类放宽、
  home 段（`/Users/` `/home/` `X:\Users\`）放宽；`sk-`/`ghp_` 保持敏感
  验证：`query-redaction.test.ts` +8（含「src/ 全树 NFKC 调用点恰 1 处且在 tokenizer.ts」结构断言）；
  `nohit-recorder.test.ts` +6 **终态断言**（对落盘整行做敏感片段零出现检查，不只查字段名）→ 14 红全绿

- [x] T049b **B2-2** 只写常规文件：FIFO 不阻塞主链、symlink 不写出目录外、清理不误删（A-C3 / B-C2 交集）
  实现：写入改 `openSync(O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW|O_NONBLOCK, 0o600)` + `fstatSync(fd).isFile()`
  校验，非常规文件放弃写入（静默降级不抛）；`pruneExpired` 改 `lstatSync` 且跳过非常规文件。**未引入异步队列**
  验证：watchdog 探针 `fifo: HUNG → RETURNED` / `symlink: escaped=true(207B) → escaped=false(0B)`；
  vitest +3（FIFO / symlink 逃逸 / 清理不跟随链接）。**偏差如实记录**：`O_NONBLOCK` 是整改单未列的必要超集
  （无它则阻塞在 `openSync`，`isFile()` 校验根本执行不到）

- [x] T049c **B2-3** 读取失败不得误报 `no-data`（A-W4 / B-W3 交集）
  实现：`CoverageGapOutput` 增 `readErrors: number`；`CoverageGapStatus` 增第四态 `data-unreadable`
  （`readErrors > 0 && totalRecords === 0`，判定顺序先于 `no-data`）；markdown/json 均输出
  spec 同步（外科改，未动其他条目）：FR-014 三态→四态 + 判定顺序、FR-015 文件级失败必须计数、
  SC-010 四态 + `readErrors` 断言、§6 输出 schema、新增 EC-34；tasks crosswalk FR-014/FR-015/SC-010 三行同步
  验证：`coverage-gap.test.ts` +6 → 全绿

- [x] T049d **B2-4** parse-args 拒绝缺值/未知 flag（A-W3 / B-I1）
  实现：抽出 `readFlagEntry` 三态读取（不存在 / 存在但缺值 / 存在且有值）；新增 `SCAFFOLD_KB_FLAG_SPECS`
  各 op 允许 flag 表 + `checkScaffoldKbFlags`
  **RG-005 收窄（按整改单授权）**：强制执行只作用于 `STRICT_SCAFFOLD_KB_OPS = { 'coverage-gap' }`；
  既有 op 在 F241 前就接受未知 flag / 缺值静默回落，收严会改变已发布 CLI 行为，故允许表对它们只作文档用途
  验证：+2 红（缺值 / 未知 flag）→ 全绿；另加 1 条**反向守卫**「既有 op 行为未被收严波及」（四 op 各一条）

- [x] T049e **B2-5** 单 token 落盘口径：收窄红线 + 加护栏（A 独有；**不改代码逻辑**）
  spec D5 与 FR-013 措辞收窄为「不新增整串字段；term 粒度落盘，单 token 查询时 term 等于原串，
  属已知且接受的残余」，并入 D5 既有残余风险声明（同时补记 `user@localhost` 类无点域名残余）
  验证：+2 护栏断言（回退态即绿）——`sk-xxx` 单独查询落盘为 `['TOKEN']` 占位标记；
  非敏感单 token 等于原串（**现状钉子**：想改成「单 token 只留 hash」会先撞这条测试，被迫先改 spec）

- [x] T049f **B2-6** `normalizedQueryHash` 改用等价类归一化（A 独有）
  实现：新增 `tokenizer.ts::normalizeForEquivalence`（NFKC + 切词 + case-fold + 去重后重组，
  与 B2-1 同一归一化链），hash 输入改用它
  验证：+2 红（`retry alpha` vs `retry Alpha` 同 hash；全角变体同 hash）→ 全绿；
  另加反向断言防压成一个桶（`retry alpha` vs `retry beta`、vs `alpha retry` 仍不同 hash）
  **C5 措辞复核**：「不提供匿名性保证」仍准确——hash 输入变粗但仍是低熵确定性 SHA-256 截断、
  仍可离线枚举，记录里也仍无主体标识，措辞无需修改

- [x] T049g **B2-7** 无可用库源时不记 coverage gap（A 独有）
  实现：三挂点统一前置条件「至少真正检索过一个库」——`kb_search` 用 `sourcesQueried.length > 0`；
  `kb_api_lookup` 2b 用 `queriedHandles`（实际调过 `searchKbCore` 的 handle）、2a 用有实体表的 handle 集合；
  `scaffold-kb query` 用非 null handle 集合。spec FR-012 同步写入该前置条件
  验证：+2 红（kb_search 只有 vendor 却 `source_filter:"project"`；kb_api_lookup 两侧 handle 均 null）→ 全绿。
  **第三挂点负例回退态即绿，如实标注**：`loadKbContext` 零 handle 时 `KB_NOT_FOUND` 提前返回、到不了挂点，
  该守卫表达的是不变量而非修复，用例保留作回归护栏

- [x] T049h **B2-8** `recordNoHit` 入口运行时校验（B 独有）
  实现：按序校验 `input` 是对象、`tool ∈ ALLOWED_TOOLS`（三值）、`rawQuery` 是 string、
  `dbPath`（或 thunk 求值结果）是 string；任一不合法**直接 no-op**，保持 total function 不抛。新增 EC-32
  验证：+3 红（非法 tool 零 append / allowlist 近似值全拒 / 非 string 入参零 append）→ 全绿；
  另加「合法输入不受影响」防止校验写成全量拒绝这种假绿

- [x] T049i **B2-9** `dbPath` 改惰性 thunk，求值移入保护边界内（B 独有）
  实现：`RecordNoHitInput.dbPath` 放宽为 `string | (() => string)`，三挂点改传
  `() => describeQueriedDbPaths(...)`；`recordNoHit` 在 try 内、且**在开关判定之后**求值。新增 EC-33
  验证：+4 红（三挂点「关闭态 + 抛错 getter → 查询正常返回」+ thunk/string 同 hash）
  + 3 条既有断言按新契约转红 → 共 7 红全绿；另加「关闭态 thunk 零求值」计数器断言与
  「thunk 返回非 string → 零 append」。`scaffold-kb query` 那条通过替换 `loadKbContext`
  （默认透传真实实现）注入毒化 handle，走真实 CLI 路径而非拿桩自证

- [x] T049j **整改后门禁重跑**：`npx vitest run tests/kb/` 35 files / **415 passed**（≥368 ✅）
  + `npx vitest run` 全量 **493 files / 6139 passed** EXIT=0
  + `node --test plugins/spec-driver/tests/*.mjs` **1272/1272** EXIT=0
  + `npm run build` EXIT=0 + `npx tsc --noEmit` EXIT=0 + `npm run repo:check` EXIT=0（86 pass / 0 fail / 0 warn）
  + RG-005 `git diff fd9af7f -- tests/kb/kb-contract.test.ts | wc -l` → **0**
  + 改动面复核：整改轮对 `plugins/spec-driver/scripts/**` 零改动
  + 台账：`ledger-schema-check.mjs` 通过（23 行），新增调用 `1-20` 已双写、`seq` 单调

---

## 批 3 Codex 整改（代码对抗审查 `task-msccuu9b-5bu75q`）

> 批 3 收尾后的代码对抗审查判「阻断提交」（5 CRITICAL / 4 WARNING，其中 4 条来自实跑探针）。
> 裁决落在 `review-dispositions.md`「Implement 批 3 — Codex 对抗审查整改单」（B3-C1 ~ B3-W4）。
> 逐条按 TDD 硬序修复（先用审查原文给出的复现输入补红测试 → 再修绿），红态证据见
> `verification/batch3-red-evidence.md` 第二节，整改后门禁全表见 `verification/batch3-gate.md` 第二轮。

- [x] T066 **B3-C1** pnpm 改真正 YAML 结构化解析 + yarn section 级结构校验
  实现：`lockfile-parser.ts` 复用仓内既有 `parseYamlDocument`（`src/panoramic/parsers/yaml-config-parser.ts`，
  **未引入新依赖**），只认 `packages` / `snapshots` 段的真实映射键；`lockfileVersion` 缺失 /
  段落非 mapping / 空文件 / 只有注释 → `parse-error`（与 `package-not-found` 严格区分）。
  yarn 新增 `splitYarnBlocks`（顶格 header + 缩进属性行的四类合法行，出现第五类即结构损坏）
  与 `isConcreteVersion`（版本必须以数字开头）
  验证：+25 红转绿，五类用例齐（alias / block scalar / 空 / 损坏 / 注释伪键）；
  四份审查复现输入另在 CLI 端逐条复验（锚点→5.4.3、block scalar 伪键→不采信、
  空 pnpm-lock→parse-error 可见、`version [unterminated`→parse-error 而非成功版本）

- [x] T067 **B3-C2** freshness 判级改用未截断天数差
  实现：`kb-status.ts` 拆 `ageDaysExact`（浮点，判级唯一输入）与 `toDisplayDays`（`Math.floor`，
  仅展示）；`classify` 签名改收未截断值；`buildKbStatusSubset` 同步走 exact 最小值。
  `governance-constants.ts` 的 `KB_FRESHNESS_AGING_DAYS=30` / `KB_FRESHNESS_STALE_DAYS=90` 语义不变
  验证：+6 红转绿（30.5/30.01→aging、90.5/90.01→stale）+ 4 条反向边界（30/29.99/90/89.99 不得误伤）

- [x] T068 **B3-C3** 严格 flag 校验改按当前索引推进 + 显式拒绝重复 flag（B2-4 回归）
  实现：`parse-args.ts` 新增 `flagValueAt(argv, i)`；`checkScaffoldKbFlags` 用它按 `argv[i+1]`
  推进（不再全局 `indexOf`）并对重复 flag 直接返回 `invalid_option`；`readFlagEntry` 改为
  `flagValueAt` 的薄封装，首次出现语义不变。**收严范围仍限 `STRICT_SCAFFOLD_KB_OPS`**
  验证：+7 红转绿（含 Codex 实测复现串 `--package typescript --package --evil --format json`）；
  RG-005 用 **1068 条 argv 对拍**双向确认既有四 op 零变化（详见 gate 第 9 节）

- [x] T069 **B3-C4** `kb_status` 子字段改回 camelCase
  实现：`KbStatusSubset` 三键改 `activityAgeDays` / `sourceVersions` / `freshness`（spec FR-021
  与 Key Entities #8 明定，实现不得单方面改外部契约）；`kb-status.test.ts` /
  `kb-contract.test.ts` / `kb-search-tool.test.ts` / `kb-api-lookup-tool.test.ts` 期望同步
  验证：+7 红转绿；另在两处加「子集键不得含下划线」的回归钉子，防再次漂回 snake_case

- [x] T070 **B3-C5** 存在性与可加载性拆成两个独立信号
  实现：`kb-locator.ts` 的 `LoadKbResult` 失败分支**纯附加** `unloadable: SourceKind[]`
  （既有 `ok` / `code` 语义与取值零变更，RG-005）；`buildKbStatusReport` 增
  `opts.dbExists`（缺省退回 `db !== null`，既有调用方零行为变化）；`runStatus` 传入真实存在性。
  损坏库 → `dbExists: true` + `schemaCompat: "unreadable"`
  验证：+4 红转绿 + CLI 端三态复验（真实库 / 损坏库 / 目录无 `chunks.sqlite`）。
  spec Key Entities #8 外科补一段 `dbExists` 与 `schemaCompat` 独立性说明
  （`unreadable` 取值批 3 已在，未重复添加）

- [x] T071 **B3-W1** package-lock 嵌套安装位置歧义全量呈现
  实现：`LockfileParseResult.ok` 增 `alternatives: string[]`；顶层 `node_modules/<pkg>` 唯一值
  直接采用，无顶层时收集**全部**嵌套位置并去重；`version-resolver.ts` 不收敛条件改为
  `distinctLockfiles >= 2 || distinctVersions >= 2`，`multiple-lockfiles` 改按**锁文件数**计
  （原按 candidate 条数会把单锁文件内的嵌套歧义误标成多锁文件冲突）
  验证：+7 红转绿。**未新增任何状态**：复用既有 `ambiguous` 五态之一，`VersionFlag` 五值不变

- [x] T072 **B3-W2** 两条证明不了其声称性质的断言改写
  实现：`parseLockfileVersion(input, io = DEFAULT_LOCKFILE_IO)` 加 IO 注入缝，测试断言
  stat/read 调用序列与超限时 read 次数为 0；只读 SHA 断言改为对 **CLI 实际读的那个文件路径**
  执行命令后再比，并先断言输出 `dbPath` 就是被 hash 的文件、最后主动改一字节断言 SHA 必变
  验证：+5 红转绿。**偏差说明**：未用 `vi.mock('node:fs')` —— 该测试文件自身要用真实
  `node:fs` 写 fixture，全局 mock 会互相打架；改用显式注入缝，并补一条「不传 `io` 时读真实
  磁盘 fixture」的用例防注入缝与生产路径漂移

- [x] T073 **B3-W3** T061 表述与已记录偏差对齐（纯文档，见本文件 T061 条目内的「已记录偏差」段）

- [x] T074 **整改后门禁重跑**：`npx vitest run tests/kb/` 38 files / **569 passed**（整改前 511 ✅）
  + `npx vitest run` 全量 **496 files / 6293 passed** EXIT=0（整改前 6235，+58 与 KB 净增对齐）
  + `node --test plugins/spec-driver/tests/*.mjs` **1272/1272** EXIT=0
  + `npm run build` EXIT=0 + `npm run repo:check` EXIT=0（86 pass）
  + RG-008 四 op 只读矩阵复跑：全 exit 0，`graph.json` 与 `chunks.sqlite` SHA-256 全 SAME
  + RG-009 缺列故障注入复跑：exit 0 / SHA 不变 / 旧库 `built_at` 1 天前仍恒 `unknown`
  + RG-005 对 `bc3bfb5`：`plugins/spec-driver/scripts/**` **零改动**；1068 条 parseArgs 对拍双向零差异
  + 未跑 `spectra graph` / `spectra batch`；未执行 `repo:sync`，无 `_generated` 时间戳漂移

> **本轮一次已排除的 flaky**：首轮全量跑出现 1 例
> `tests/integration/graph-quality-cli.test.ts > dirty 态验证 … exit 0`（收到 1）；隔离重跑
> `17 passed (17)`、全量复跑亦全绿。该用例在 tmpDir 自建 git 仓 + spawn 真实 CLI，属已登记的
> 「满载下子进程 CLI 超时」形态，本轮未触及 graph-quality 任何路径。**不当作回归**，但如实记录。
