# F241 独立验证闭环报告

> **本报告的全部结论均由验证子代理在本 worktree 内亲自实跑取证**，未引用 implement 子代理或
> `batch{1,2,3,4}-gate.md` 中的任何既有声称。既有 gate 文件仅作为**对照**，差异如实登记于第 6 节。
>
> - worktree：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe`
> - HEAD：`27cb5a6`（批 3）；批 4 pilot 制品（`pilot/report.md`、`pilot/ledger-verify.mjs`）**未提交**
> - 验证时间：2026-08-03（本机 macOS Darwin 25.5.0，Node 环境同仓库）
> - 环境限制：本机**无 `timeout` 亦无 `gtimeout`**（`command -v` 双双落空），按 verify 契约降级——
>   超时保护改由执行工具层的 timeout 承担，各命令均正常终止，无一触发超时。

---

## 1. 执行摘要

| 维度 | 计数 |
|------|------|
| **SC 总数** | 20（SC-001 ~ SC-020）|
| **SC PASS** | **18** |
| **SC PARTIAL** | **2**（SC-015、SC-017）|
| **SC FAIL** | **0** |
| **RG 总数** | 9（RG-001 ~ RG-009）|
| **RG PASS** | **9** |
| **RG FAIL** | **0** |
| **全局门禁** | 5 项全部 EXIT 0 |
| **用户验收清单** | 4 项：3 PASS、1 PARTIAL（含 1 条 MANUAL-PENDING 子项）|

**总体判定：`PASS（带 2 项 PARTIAL + 2 条 MANUAL-PENDING）`**

零功能缺陷。两项 PARTIAL **均为文档/口径记账问题，不是行为缺陷**：SC-015 的锚定 SHA 只回填了
pilot 报告、漏回填 spec 正文；SC-017(b) 的「禁止外推表述」由 spec 自身声明为无自动化的人工审查项。
另发现 1 条 gate 文件计数陈旧（见第 6 节），方向安全（实测测试数**多于**声称）。

---

## 2. SC 逐条判定

| SC | 判定 | 我的实跑证据（摘要）|
|----|------|------------------|
| **SC-001** 决策矩阵穷举 + 顺序不变量 | **PASS** | `node --test graph-consumption-decision.test.mjs` → exit 0 / 37 pass。四个子项均亲验存在：(a) `combos.length === 144`（3×3×4×2×2，test:108）；(b) missing 探针断言 `matchedRule ∈ {5,6}`（test:153）；(c) out-of-scope 探针断言 `matchedRule = 2` 且未触发刷新（test:170）；(d) 6 条 `unreachable-by-construction #1..#6` 注释在生产源码 `graph-consumption-decision.mjs:158-163` 逐条存在 |
| **SC-002** 真实 stale 上非 dry-run 刷新 | **PASS** | **我自建 sandbox 独立复现（不只跑测试）**：临时 git repo → `spectra batch --mode graph-only` 建真图（sourceCommit=`63da846`）→ 推进到 C2 且工作树干净 → 非 dry-run `decide --phase verify --base-ref C1 --refresh-policy allowed`。实得 exit 0、`freshness:"stale"`（`checkFreshness` 实算，非桩）、`refreshAttempted:true`、`refreshOk:true`、`refreshDurationMs:363`、终态 `outcome:"consume-impact"`、`graphSourceCommit:"d66f665b…"` 非空；审计**恰 1 条** `kind:"decision"` 事件且字段齐备。仓内测试 Part 4 亦真跑（1268ms，`spectra --version` 不可用即 `assert.fail`，无 mock 冒充）|
| **SC-003** 纯新增非 dry-run 不刷新 + 图 SHA 不变 | **PASS** | **独立 sandbox 复现**：仅新增未跟踪 `src/brand-new.ts`，非 dry-run + 刻意给 `--refresh-policy allowed`。实得 `changeClass:"additive-only"`、`outcome:"skip-impact"`、`degradedReason:"impact-not-applicable-additive-only"`、`refreshAttempted:false`、`matchedRule:1`；图 SHA-256 前后**逐字节相同**（`0ec1e4c9…` → `0ec1e4c9…`）；审计恰 1 条 decision 事件 |
| **SC-004** 覆盖缺口 fresh 也降级 + 结构化 over-claim 约束 | **PASS**（附注）| **独立 sandbox 端到端跑 CLI**（非仅纯函数）：fresh 图 + 改动集全为 `plugins/**/*.mjs` → `coverageScope:"out-of-graph-scope"`、`outcome:"consume-degraded"`、`degradedReason:"coverage-gap-out-of-graph-scope"`、`matchedRule:2`、`refreshAttempted:false`，四项全中。(a) 封闭键集：测试对 `Object.keys(json).sort()` 做 `deepEqual` 精确集合相等（23 键），`inputs` 恰五维；(b) 我亲跑 `--format text`，输出是纯字段转储（`outcome:/matchedRule:/inputs:/degradedReason:/hint:`），`hint` 逐字等于 `DEGRADED_REASON_HINTS` 表项，**无任何自由散文**。**附注**：SC-004(b) 字面要求「对 12 个 reason 逐一渲染并断言逐字相等」，实现改为「表级断言（12 项非空、互不相同、键集与枚举一一对应）+ 封闭 JSON 键集 + 单个 reason 的文本渲染断言」。因文本渲染器结构上不含自由文案，实质等价；属测试强度记账差异，非行为缺口 |
| **SC-005** 两组枚举分别可达（事件语义）| **PASS** | 亲跑 `graph-consumption-cli.test.mjs` exit 0 / 68 pass。(a) 12 个 `DEGRADED_REASONS` **逐值各一条**非 dry-run 用例，全部落进 `kind:"decision"` 审计事件（执行日志逐条可见：additive-only / out-of-graph-scope / graph-corrupt / graph-missing / classification-unknown / stale-refresh-declined / dirty-uncommitted / unknown-provenance / refresh-failed×4），另有「场景表覆盖全部 12 值无重复无遗漏」与「decision 事件 caveats 恒空」断言；(b) `annotate-caveat` 产出独立 `kind:"caveat-annotation"` 事件、`decisionId` 回链正确，`coverage-gap-known-extraction-limit` 不在 12 值枚举内，故不可能出现在 decision 的 `degradedReason` |
| **SC-006** 刷新失败四态映射 | **PASS** | `graph-refresh-executor.test.mjs` exit 0 / 14 pass：`spawn-error`→`refresh-failed-spectra-missing`、`timeout`→`refresh-failed-timeout`、`non-zero-exit`→`refresh-failed-nonzero-exit`、`graph-not-queryable`→`refresh-failed-artifact-unusable` 逐条断言；另有真实 ENOENT（非 mock）用例与「未识别 reason 保留原始 detail 不静默吞」用例 |
| **SC-007** 刷新次数（进程内 + 调用方合同）| **PASS** | (a) 执行日志可见「单次 decide 调用内 graph-only 构建至多被 spawn 一次（EC-07 防线）」通过；(b)「第一次 allowed 触发刷新、第二次 declined 不刷新；审计恰 2 条 `kind:"decision"` 事件」通过。跨进程互斥按 spec 明示不断言 |
| **SC-008** goal_loop 零回归 + 接线正反两向 | **PASS**（残余如实登记）| `goal-loop-core.test.mjs` exit 0 / **163 pass**；`goal-loop-snapshot-rollback-integration.test.mjs` 含在全量 `node --test plugins/spec-driver/tests/*.mjs`（1272 pass / 0 fail）内全绿。`goal-loop-graph-consumption-integration.test.mjs` exit 0 / 27 pass，(a) 允许态注入、(b) 拒绝态不注入且 iteration log 写 `degradedReason`、(c) 旧形态输入 `invalid-input` 不抛错，三项俱全，且正反两向用**同一份 impactSummary 输入**对拍。**残余**：SKILL.md 散文层依从性无自动化（spec 已声明），属人工审查 |
| **SC-009** no-hit 落盘范围实证 | **PASS** | **我亲自驱动真实 CLI 触发 no-hit 两次**（含 email / `sk-` token / 64 位 hex / `/Users/<name>` / 10 位数字）。(a) 逐串 grep 落盘 JSONL 全文：`alice.smith+dev@example.com`=0、`sk-ABC123XYZ7890abcdef`=0、`deadbeefdeadbeef`=0、`/Users/connorlu`=0、`connorlu`=0、`1234567890`=0，**全部零出现**；(b) `redactionTags:["EMAIL","TOKEN","HOME","HIGH_ENTROPY","DIGITS"]`；(c) 落盘键集恰 8 个（schemaVersion/timestamp/tool/terms/normalizedQueryHash/redactionTags/resultCount/dbPathHash），**无 `query`、无 `redactedQuery` 等整串字段**；(d) 同串两次 `normalizedQueryHash` 均为 `0f5cebb82b538070` |
| **SC-010** coverage-gap 四状态可区分 | **PASS** | 亲跑真实 CLI 取得 `collection-disabled`（telemetry off，`readErrors:0`）与 `no-gap-above-threshold`（2 条记录但同一 hash）两态实证；`data-unreadable`（含断链与 chmod 000 两种诱因）与 `no-data`（含目录不存在）由 `coverage-gap.test.ts` 20 pass 覆盖，并有「四态互不相同且 readErrors 恒在」断言。输出含 `minOccurrenceThreshold: 2`，json/markdown 全文均无「k-匿名 / k-anonymity」字样 |
| **SC-011** backlog 产出、绕过防线与损坏容忍 | **PASS** | **亲跑产出真实 backlog**：两条**不同**查询共享 term `widgetron` → markdown 表格输出 `widgetron / distinctQueries=2 / occurrences=2`，`status: ok`；对照组两条**相同**查询（同一 `normalizedQueryHash`）→ `no-gap-above-threshold`、items 为空——**C5 绕过形态防线在真实 CLI 上现场生效**。fixture 侧 term X（2 hash / 3 行）恰 1 条目、term Y（1 hash / 3 行）被挡、`skippedLines:1`、exit 0 由单测断言 |
| **SC-012** 版本推断命中 + 显式优先 + ambiguous | **PASS** | **亲跑真实 CLI 三组**：① 仅 lockfile → `status:"lockfile"`, `version:"18.2.0"`；② 显式 `4.0.0` + lockfile `3.2.1`(实测用 18.2.0) → `status:"explicit"`, `version:"4.0.0"`, candidates 含推断值, `flags:["version-conflict"]`；③ 仅 `go.sum` → `status:"none"`, `version:null`, `flags:["ecosystem-unsupported"]`。多 lockfile→`ambiguous`+`multiple-lockfiles`、三种 npm lockfile 形态由 `lockfile-parser.test.ts`(49) + `version-resolver.test.ts`(26) 覆盖 |
| **SC-013** KB freshness 公式与三元状态 | **PASS** | **我自建 5 组真实 sqlite fixture 库并亲跑 `scaffold-kb status --format json`**：(i) built_at 5d → `current`；(ii) 45d → `aging`；(iii) 100d → `stale`；(iv) built_at 100d + ingested_at 5d → `current` 且 `oldestBuiltAt=2026-04-24` 如实反映 100 天前而未影响判级（`activityAt = max(...)` 成立）；(v) **缺 provenance 列 + built_at 仅 5 天前的旧库 → `freshness:"unknown"` 恒定**、`schemaCompat:"legacy-missing-provenance"`、exit 0（P-W4 钉子实测生效，未回落 current）。**5 组库文件 SHA-256 运行前后全部不变**（只读证明）。库目录不存在时 `dbExists:false` + exit 0 |
| **SC-014** MCP 响应向后兼容 | **PASS** | 亲跑 `npx vitest run tests/kb/` → **38 files / 569 tests passed，exit 0**。`kb_status` 已加到 `kb_search` 与 `kb_api_lookup` 的全部成功 envelope（含 `document_fallback` 与 `not_found:true` 早返回），error envelope 明确不加。子对象键恰 `activityAgeDays / freshness / sourceVersions`（内层 **camelCase**，有专门的 snake_case 禁入回归钉子；外层字段名 `kb_status` 与既有 `total_found` / `not_found` 的 snake_case 惯例一致）。既有字段零变更由「删掉 kb_status 后与接线前形状逐字段一致」用例钉死 |
| **SC-015** pilot 口径合规取数 | **PARTIAL** | 三项实体条件**全部 PASS**：① `predicted-impact-set.md` 首次提交 `0ee233c` @ `01:10:25`，早于首个 implement 代码提交 `fd9af7f` @ `04:03:57`（早 2h53m）；② `mcp-call-log.md` 与 `ledger.jsonl` 均存在，ledger **27 行** ≥ markdown 记录的 **27** 条调用；③ `git diff 0ee233c -- pilot/measurement-design.md` **输出为空**（零漂移）。**未达项**：SC-015 自身要求锚定 SHA「回填进**本 SC** 与 pilot 报告」，实际只回填了 pilot 报告（`report.md:3,89,372` 均写明 `0ee233c`），`spec.md:678` 仍是 `<锚定SHA>` 占位符。属记账遗漏，不影响锚定的实际有效性 |
| **SC-016** pilot 三指标有对照 + ledger 重算一致 | **PASS** | 亲跑 `node pilot/ledger-verify.mjs` → **EXIT 0**，输出「27 行台账（迁移基线 11 行），report.md 逐项一致；四分类 hit 8 / fuzzy-hit 1 / miss-empty 7 / miss-structural 4；名义命中率 45.0%；证实错误 10（其中计为命中 4）；修正后可信命中率 25.0%；.mjs 侧 0/3」。报告含 M-1 四类计数与命中率、M-2 的 coverage 9.5% / precision 20.0% / missed 19（逐条归因）、M-3 的 A 独有 3 / B 独有 2 / 交集 4 |
| **SC-017** pilot 报告诚实性 | **PARTIAL**（(a) PASS / (b) MANUAL）| (a) **机器断言 PASS**：五项关键词全部命中——`N=1`×3、`判读者非盲`×1、`单次采样`×2、`自我选择偏置`×1、`结构性封顶`×4。(b) **MANUAL-PENDING（spec 自身设计如此，非本次遗漏）**：我另做了人工扫描，未发现 `提升 X%` / `提高 X%` / `可外推` / `证明有效` 等外推表述；报告反而主动写「三项指标均未显示 grounding 的正向信号」「不构成任何可外推的效用判断」，并自曝 M-2 初版算术错误。人工判定为**未见外推**，但依 spec 该项不产出机器证据 |
| **SC-018** 全局零失败 | **PASS** | 四项亲跑全部 EXIT 0，详见第 4 节 |
| **SC-019** 安装态可达性 | **PASS** | **我把 `plugins/spec-driver/` 整体 `cp -R` 到仓外临时目录**（该目录下**只有** `spec-driver/`，无仓根 `scripts/`），`cd` 进去跑 `decide --dry-run --format json`：exit **0**、stdout 可 `JSON.parse`（23 个顶层键）、**stderr 完全为空**（`ERR_MODULE_NOT_FOUND` / `Cannot find module` 计数 0）。另有「依赖链相对 import 不含 `../../` 越界」的静态断言 |
| **SC-020** 数据路径 gitignore 自举 | **PASS**（spec 措辞缺陷）| (a) **本仓**：`git check-ignore -v .specify/kb-nohit/nohit-20260803.jsonl` → 命中 `.gitignore:59`，exit 0；`.specify/graph-consumption-audit.jsonl` → 命中 `.gitignore:57`，exit 0。(b) **安装态**：新建临时 `git init` repo + 拷入插件，`source ensure-gitignore.sh` 后调 `ensure_spec_driver_gitignore`（`created:6`）与 `ensure_spec_driver_git_exclude`（`appended:6`），两条路径 `check-ignore` 均命中 exit 0。**spec 措辞缺陷（我实测踩到）**：SC-020(b) 写「**运行** `ensure-gitignore.sh`」，但该文件按设计**只定义函数、无顶层执行逻辑**（文件头注释明示），直接 `bash` 执行是 no-op——我首次照字面执行得到 exit 1（未命中）。须 `source` + 调函数才是其真实契约。属 SC 文案与实现契约不符，非实现缺陷 |

---

## 3. RG 逐条判定

| RG | 判定 | 我的实跑证据 |
|----|------|------------|
| **RG-001** goal_loop 机制零回归 | **PASS** | `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` → exit 0 / **163 pass / 0 fail**；`git diff --stat 2e3a4cd HEAD -- plugins/spec-driver/tests/goal-loop-core.test.mjs` → **输出为空**（该测试文件相对 `2e3a4cd` 零改动，新断言确实写进了新文件 `goal-loop-graph-consumption-integration.test.mjs`）|
| **RG-002** goal_loop 默认 off 不变 | **PASS** | `git diff 2e3a4cd HEAD -- plugins/spec-driver/config/orchestration.yaml` → **空**。另跑 `orchestrator-cli.mjs effective-orchestration feature --format json`：`feature.implement.agent_mode === "single"`，且整份 effective config 中 **`goal_loop` 字符串零出现**，`diagnostics` 为空数组 |
| **RG-003** `decideStop` / `interpretImpactResult` 零改动 | **PASS** | `git diff --stat 2e3a4cd HEAD -- plugins/spec-driver/scripts/lib/goal-loop-core.mjs` → **空**（整文件未改动，强于「仅函数区间未改」）。全仓 `git diff --name-only 2e3a4cd HEAD \| grep -i goal` 只返回**新增**的 `goal-loop-graph-consumption-integration.test.mjs` 一个文件 |
| **RG-004** orchestration schema 零改动 | **PASS** | `git diff --stat 2e3a4cd HEAD -- plugins/spec-driver/contracts/orchestration-schema.mjs plugins/spec-driver/config/orchestration.yaml` → **空**。我另跑 `find -name orchestration.yaml` 确认全仓（排除 node_modules）**只有** `plugins/spec-driver/config/orchestration.yaml` 一处，批 1 的路径勘误已收敛，不存在漏查的第二处 |
| **RG-005** KB 现有链零回归 | **PASS** | `npx vitest run tests/kb/` → **38 files / 569 tests passed，exit 0**（含 kb-contract / kb-degradation / kb-isolation / arbitration / url-fetcher / office-parser）。**断言强度我逐行读 diff 亲自判断**：`kb-contract.test.ts` 的 shape 断言**仍是 `toEqual` 精确集合相等**（只把纯新增的 `kb_status` 纳入期望集），**未**放宽为 `arrayContaining` 或 `toMatchObject`；并**新增**了一条更强的「删掉 `kb_status` 后与接线前形状逐字段一致」用例。**结论：断言被加严而非放宽，批 3 的声称属实** |
| **RG-006** `checkFreshness` 唯一权威源 + 审计只写不读 | **PASS** | (a) `git diff --name-only 2e3a4cd HEAD \| grep -iE "freshness\|source-commit"` → **无新增产物文件**；(b) 全仓 `grep "function checkFreshness"` → **恰 1 处定义**（`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs:352`），仓根 `scripts/lib/graph-bootstrap-status.mjs` 是 21 行薄 re-export 壳；(c) CLI 中 `AUDIT_REL` 仅在 append 路径使用，全文件 `readFileSync` 调用只出现在 `@file` 入参、tasks 文件、trace 文件三处，**无一指向审计路径**。仓内另有闭包化三段静态检查（被审集合 = CLI import 闭包，且断言闭包必须递归到 canonical，防「豁免即逃逸口」）|
| **RG-007** F217 图质量门全绿 | **PASS** | 亲跑 `spectra graph-quality --json` → exit 0，`overallVerdict: "pass-with-warnings"`，五项结构指标 `duplicateCanonicalId / containsCoverage / orphanRatio / danglingEdges / legacyAndIgnoredNodes` **全 pass**，唯一告警是 `freshness.state: "stale"`（图锚 `bc3bfb5` vs HEAD `27cb5a6`）——**恰为 RG-007 明示允许的 freshness-only 告警**。`npm run repo:check` 的 graph-quality 族六项同样五 pass + freshness warn |
| **RG-008** 不覆写图（SHA-256 比对）| **PASS** | 全程对本仓 `specs/_meta/graph.json` 做 SHA-256 前后比对：跑完 KB 全部只读命令（status×6、query×4、coverage-gap×3、version×3）后仍为 `ab931850e712f2e6bab7075836276b9decdee1daca05afdb1b60fc361454bcbe` **未变**；`graph-quality --json` 前后亦未变；`git status --short specs/_meta/graph.json` 全程为空。SC-002 的刷新是唯一被允许改图处，且发生在**临时 sandbox**、未触碰本仓图。KB fixture 库 `chunks.sqlite` 同样 5/5 SHA 不变 |
| **RG-009** KB 主链路不被治理层影响 | **PASS** | **我亲自做两种故障注入并跑真实 CLI**：① no-hit 目录 `chmod 500` 只读；② 缺 provenance 列的旧 schema 库。三次运行（基线 / 故障 A / 故障 B）**退出码均为 0**，**stderr 均为 0 字节**，stdout 经 grep 无 `error/stack/at Object/Traceback`；`results` 数组在基线与故障 A 之间 `diff` 判定 **IDENTICAL**（逐字节相同）|

---

## 4. 全局门禁（逐条实跑，真实退出码）

| 门禁 | 命令 | 退出码 | 计数 / 关键输出 |
|------|------|--------|----------------|
| 构建 | `npm run build` | **0** | tsc 零错误；postbuild 盖章 `commit=27cb5a63 (dirty)`（dirty 来自未提交的 pilot 制品，符合预期）|
| 全量单测 | `npx vitest run` | **0** | **Test Files 496 passed \| 4 skipped (500)**；**Tests 6293 passed \| 18 skipped \| 21 todo (6332)**；Duration 53.65s |
| 插件 node:test | `node --test plugins/spec-driver/tests/*.mjs` | **0** | **tests 1272 / suites 228 / pass 1272 / fail 0 / cancelled 0**；duration 21.7s |
| 仓库校验 | `npm run repo:check` | **0** | 全族 pass；唯一 warning 为 `graph-quality:freshness`（图锚落后 HEAD，RG-007 允许）|
| 发布合同 | `npm run release:check` | **0** | `Release contract valid (contracts/release-contract.yaml)` |

按 F241 测试文件分文件计数（我逐文件单独跑，均 exit 0）：

| 文件 | pass | fail |
|------|------|------|
| `graph-consumption-decision.test.mjs` | 37 | 0 |
| `graph-consumption-cli.test.mjs` | 68 | 0 |
| `graph-refresh-executor.test.mjs` | 14 | 0 |
| `git-change-classifier.test.mjs` | 21 | 0 |
| `tasks-path-signal.test.mjs` | 25 | 0 |
| `graph-bootstrap-status-shim.test.mjs` | 12 | 0 |
| `goal-loop-graph-consumption-integration.test.mjs` | 27 | 0 |
| `goal-loop-core.test.mjs`（既有回归）| 163 | 0 |
| `ensure-gitignore.test.mjs` | 22 | 0 |
| `npx vitest run tests/kb/` | 569（38 文件）| 0 |

---

## 5. 用户原始验收清单逐条判定

### 5.1 B4：三类任务的刷图决策矩阵实测各走对路径 + degraded reason 落审计 — **PARTIAL**

| 任务类别 | 判定 | 我的实测 |
|---------|------|---------|
| **改既有代码** | **PASS** | 独立 sandbox 真实 stale 图，非 dry-run → 走**刷新路径**（`matchedRule:8`、`refreshOk:true`、363ms），终态 `consume-impact`；审计恰 1 条 decision 事件 |
| **纯新增** | **PASS** | 独立 sandbox，非 dry-run + `allowed` 预算 → **主动短路不刷新**（`matchedRule:1`、`refreshAttempted:false`），图 SHA 逐字节不变；审计恰 1 条 decision 事件带 `degradedReason:"impact-not-applicable-additive-only"` |
| **覆盖缺口（补充第四类）** | **PASS** | fresh 图 + 全 `.mjs` 改动 → `matchedRule:2`、`consume-degraded`、`coverage-gap-out-of-graph-scope`、不刷新 |
| **goal_loop** | **MANUAL-PENDING** | 见下 |
| **degraded reason 落审计** | **PASS** | 12 个枚举值**逐值**各有一条非 dry-run 用例落 `kind:"decision"` 审计事件，无枚举外值；`caveat` 走独立 `kind:"caveat-annotation"` 事件并回链 `decisionId` |

**goal_loop 一类的诚实判定 —— MANUAL-PENDING（不给 PASS）**

我**核实了批 4 报告的声明属实**，未采信其结论而是自己查证：

- `orchestrator-cli.mjs effective-orchestration feature` 实测 `feature.implement.agent_mode === "single"`；
- 整份 effective config 中 `goal_loop` 字符串**零出现**，`diagnostics` 为空；
- `specs/241-graph-keepalive-kb-grounding/goal-loop/` 目录**不存在** → goal_loop 从未运行过；
- 结论：**本 feature 自身的 implement 确实未跑 goal_loop**，批 4 的声明属实、未 over-claim。

已有的自动化覆盖是实的：`goal-loop-graph-consumption-integration.test.mjs`（27 pass）覆盖了
advisory 合同、authoritative（DECISION2）合同、注入闸门正反两向、旧形态降级、`--base-ref-from-trace`
last-match 语义、SKILL 接线与 orchestration 逐字一致等。我另**亲跑了 advisory 路径的真实 CLI**：
`decide --phase implement --advisory` → `advisory:true`、`authoritativeOutcome:null`（非权威性成立）、
审计如实记录 `advisory=true` 的 decision 事件。

**但这些都不是生产 goal_loop 端到端证据**——没有任何一轮真实的 goal_loop 迭代闭环跑过这条接线。
故本项判 **MANUAL-PENDING**，不判 PASS。（此为如实标注，非阻断项：spec Non-Goals #10 禁止本轮
改默认开关，因此生产 e2e 在本 feature 范围内**不可得**，需后续单独 pilot。）

### 5.2 E：no-hit 缺口 backlog（脱敏实证）+ 版本推断 + freshness 三态 — **PASS**

| 子项 | 判定 | 实测 |
|------|------|------|
| no-hit 聚合产出缺口 backlog（脱敏实证）| **PASS** | 亲跑真实 CLI 产出 markdown backlog（`widgetron / distinctQueries=2`），同一批数据中 `bob@corp.com` 在落盘 JSONL 中出现次数 **0**——**产出可用与脱敏有效在同一次实证里同时成立** |
| lockfile 版本推断命中 + 显式优先 | **PASS** | 亲跑三组：lockfile→`18.2.0`；显式 `4.0.0` 压过 lockfile 且标 `version-conflict` 并保留推断候选；`go.sum`→`ecosystem-unsupported` 不猜测 |
| freshness 三元状态可查 | **PASS** | 亲建 5 组 fixture 库跑 CLI，`current` / `aging` / `stale` / max 取值 / 旧库恒 `unknown` 五种结果全部实得，且库文件 SHA 全程不变 |

### 5.3 pilot 三指标有对照数据（诚实报告）— **PASS**

`ledger-verify.mjs` 亲跑 **EXIT 0**，27 行台账与报告数字逐项一致。三指标均有对照数：
M-1 四分类 8/1/7/4 + 名义 45.0% / 修正后可信 25.0%；M-2 coverage 9.5% / precision 20.0% / missed 19；
M-3 交集 4 / A 独有 3 / B 独有 2。**报告方向为负且如实登记**（grounded 组比对照组少 1 条独有发现，
`.mjs` 侧命中率结构性封顶 0），并主动自曝 M-2 初版算术错误——符合 FR-023 的诚实性要求，未凑正向结果。

### 5.4 TDD + 全量门禁零失败 — **PASS**

五项门禁全部 EXIT 0（第 4 节）。TDD 侧存在 `batch{1,2,3}-red-evidence.md` 红态记录；批 4 的
`ledger-verify.mjs` 另有**变异测试**（8 个变异体，7 个应捕获的全部捕获、1 个不应触发的正确保持静默），
证明校验器非空转。**说明**：红态证据本身是既有 gate 文件的记录，我未能事后重放当时的红态
（历史时点不可复现），此项依赖既有记录，我只独立复核了「当前全绿」与「变异测试脚本现在确实有判别力」。

---

## 6. 与既有 gate 文件的差异清单

| # | 项目 | 既有 gate 声称 | 我的实测 | 定性 |
|---|------|--------------|---------|------|
| **D-1** | `npx vitest run` 全量测试数 | batch3-gate：`Tests 6235 passed`（并推导「基线 6139 → +96」）| **`Tests 6293 passed`**（+58）| **gate 计数陈旧**。方向安全（实际测试**更多**且全绿），但 batch3-gate 的数字与其自身所在 commit `27cb5a6` 的committed tree 不符 |
| **D-2** | `npx vitest run tests/kb/` 计数 | batch3-gate：`38 文件 / 511 测试` | **38 文件 / 569 测试** | 同 D-1，差值同为 **58**。文件数一致、用例数差 58 |
| **D-3** | `tests/kb/cli-scaffold-kb.test.ts` 计数 | batch3-gate：`26 passed (26)` | **37 passed** | 同源。根因推断：batch3-gate 是在批 3 **提交前的中途时点**记录的，之后又补了测试但未刷新 gate 文件计数（`27cb5a6` 之后无任何 commit，故不可能是后续提交引入）|
| **D-4** | SC-020(b) 的执行方式 | SC-020 文案与 batch2-gate 均表述为「**运行** `ensure-gitignore.sh`」| 直接 `bash` 执行是 **no-op**，`check-ignore` 不命中（我实测 exit 1）；须 `source` 后调 `ensure_spec_driver_gitignore` / `ensure_spec_driver_git_exclude` 才生效（此时 `created:6` / `appended:6`，check-ignore 命中）| **spec/gate 措辞与实现契约不符**。实现本身正确（文件头注释明示「只定义函数，不含顶层执行逻辑」），是 SC 文案缺陷 |
| **D-5** | SC-015 锚定 SHA 回填 | SC-015 要求回填进「本 SC 与 pilot 报告」两处 | pilot 报告已回填 `0ee233c`（3 处），**`spec.md:678` 仍是 `<锚定SHA>` 占位符** | **记账遗漏**，锚定实际有效（我用 `0ee233c` 实跑 diff 为空）|
| **D-6** | 插件 node:test 计数 | batch3-gate：`tests 1272 / pass 1272 / fail 0` | **完全一致**（1272/1272/0）| **无差异**（正向对照，说明 D-1~D-3 的偏差局限于 vitest 侧）|
| **D-7** | batch1-gate 各文件计数 | 如 `graph-consumption-cli.test.mjs = 41` | 现为 68 | **非差异**：batch1-gate 是批 1 时点记录，批 2/3 继续加测试属正常增长，不构成矛盾 |

> **对 D-1/D-2/D-3 的定性**：这**不是**功能问题，也**不改变**任何 PASS/FAIL 判定——所有测试当前全绿，
> 且实际数量多于声称（虚报方向是「少报」而非「多报」，不存在拿不存在的测试充数的风险）。
> 但它说明 batch3-gate 的门禁数字是**中途快照而非终态复核**，建议 push 前把 gate 计数刷新为终态值。

---

## 7. MANUAL-PENDING / UNVERIFIABLE 清单

| # | 项目 | 状态 | 原因 |
|---|------|------|------|
| **M-1** | B4 的 **goal_loop 类任务生产端到端** | **MANUAL-PENDING** | 本 feature 自身 implement 以 `agent_mode=single` 运行（我已实测核实），且 spec Non-Goals #10 禁止本轮改默认开关，因此生产 goal_loop 闭环 e2e 在本 feature 范围内**结构性不可得**。现有证据为集成测试（27 pass）+ advisory CLI 实跑，**不等于**生产 e2e。需后续单独 pilot 覆盖 |
| **M-2** | SC-017(b) **禁止外推表述** | **MANUAL-PENDING（spec 设计如此）** | spec 明示该项「因黑名单不可穷举，不做机器断言，改为 push 前人工审查项」。我已做人工扫描：未发现外推表述，报告反而多处主动声明不可外推。**人工判定：通过**，但无机器证据 |
| **M-3** | SC-008 的 **SKILL.md 散文层依从性** | **MANUAL-PENDING（spec 已如实登记）** | spec SC-008 自身声明「散文层的调用行为无自动化断言先例」。可自动化的部分（phase 名与 orchestration 逐字一致、无残留 phase.id 判定、两处 goal_loop 接线 + 两处通用循环接线落地、advisory 命令含 `--tasks-file`、wrapper 与 canonical 同步）**已有断言且全绿**；散文语义本身属人工审查 |
| **M-4** | 历史 **TDD 红态**重放 | **UNVERIFIABLE** | 红态是历史时点现象，事后不可复现。我只能独立复核「当前全绿」与「`ledger-verify.mjs` 的变异测试现在确实有判别力」，红态本身依赖 `batch{1,2,3}-red-evidence.md` 的既有记录 |
| **M-5** | `timeout` 超时保护 | **降级（已声明）** | 本机 `timeout` 与 `gtimeout` 均不可用，按 verify 契约降级为工具层 timeout。所有命令均正常终止，无一超时，不影响任何结论 |

---

## 8. 未提交制品提示

以下 SC-015/016/017 所依赖的制品当前**未纳入 git**，push 前需确认一并提交，否则这三条 SC 在
干净检出上将不可复现：

- `specs/241-graph-keepalive-kb-grounding/pilot/report.md`（untracked）
- `specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs`（untracked）
- `specs/241-graph-keepalive-kb-grounding/verification/batch4-gate.md`（untracked）
- `specs/241-graph-keepalive-kb-grounding/pilot/metrics-raw.md`（modified）
- `specs/241-graph-keepalive-kb-grounding/{tasks.md,trace.md}`、`docs/design/milestone-M9-codex-trusted-live-graph.md`（modified）

---

## 9. 结论

**F241 通过独立验证闭环：READY FOR REVIEW（带 2 项 PARTIAL + 3 条 MANUAL-PENDING + 1 条 UNVERIFIABLE）。**

- 20 条 SC：18 PASS / 2 PARTIAL / **0 FAIL**；9 条 RG：**9 PASS / 0 FAIL**；5 项全局门禁**全部 EXIT 0**。
- 两项 PARTIAL 均为**文档记账**问题（SC-015 锚定 SHA 未回填 spec 正文；SC-017(b) 按 spec 设计无自动化），
  不涉及任何行为缺陷。
- 建议 push 前处理三件小事：① 回填 `spec.md:678` 的 `<锚定SHA>` 为 `0ee233c`；
  ② 修正 SC-020(b) 措辞为「source 该库并调用两个入口函数」；③ 刷新 batch3-gate 的 vitest 计数为终态值
  （6293 / 569 / 37），或注明其为中途快照。
- 唯一实质性的能力缺口是 **goal_loop 生产端到端未覆盖**，已如实标为 MANUAL-PENDING 而非 PASS。
