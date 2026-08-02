---
feature: 241-graph-keepalive-kb-grounding
title: 技术实施规划 —— 图条件保活消费接线 + KB 三薄层 + Grounding Pilot
status: draft
created: 2026-08-03
source_spec: specs/241-graph-keepalive-kb-grounding/spec.md
source_dispositions: specs/241-graph-keepalive-kb-grounding/review-dispositions.md
source_verifications: specs/241-graph-keepalive-kb-grounding/orchestrator-verifications.md
source_research: specs/241-graph-keepalive-kb-grounding/research/tech-research.md
source_checklist: specs/241-graph-keepalive-kb-grounding/checklist.md
---

# F241 技术实施规划

> 修订 v2（Codex plan 审查 BLOCKED 回灌）：P-C1/P-C2/P-W1..W7 落地
>
> 本 plan 不重议 spec 已拍板的 D1-D8 决策与 review-dispositions.md 的整改结论，只把它们转成可执行的文件级设计。所有行号引用以 `orchestrator-verifications.md` 基线 commit `2e3a4cd` 为准；实施时若行号已漂移，以函数名/符号名重新定位。

---

## 0. 批次结构回顾（spec I1 已拍板，不重议）

| 批次 | 范围 | 组件 |
|---|---|---|
| 批 1 — B4 | FR-001~011、FR-024 审计路径部分 | 图消费决策纯函数 + CLI + D8 模块迁移 + goal_loop 接线 |
| 批 2 — E1 | FR-012~015、FR-024 no-hit 路径部分 | no-hit 记录器 + redaction + coverage-gap 聚合器 |
| 批 3 — E2/E3 | FR-016~021 | lockfile 版本解析 + KB 状态报告器 |
| 批 4 — pilot | FR-022~023（**finalize** 段） | pilot **finalize** 段收口——preflight/continuous capture 已跨批 1-3 进行，非本批一次性产出，详见 §1.7 三段化说明（P-C2 修订） |

每批门禁：对应子集 `node --test` / `npx vitest run` + `npm run build` + `npm run repo:check` 零失败后才进下一批。tasks.md 按此四组切任务，组间为硬依赖边。

> pilot 制品不是单批次瀑布产出：按 §1.7 拆为 **preflight**（批 1 前）/ **continuous capture**（横跨批 1-3，持续双写 ledger）/ **finalize**（批 4）三段，避免 v1 版本"predicted-impact-set.md/ledger.jsonl 都标记批 4 新增"造成的批次依赖环（P-C2）。

---

## 1. 模块与文件布局

### 1.1 批 1（B4）—— 新文件与迁移

```
plugins/spec-driver/scripts/lib/
├── graph-bootstrap-status.mjs        ← 【迁入】D8 canonical，原仓根 scripts/lib/graph-bootstrap-status.mjs
│                                        逐字节搬移（不改内部逻辑），只补一段 D8 迁移说明注释
├── graph-consumption-decision.mjs    ← 【新增】FR-001/002/003/004/004b/006
│     exports: decideGraphConsumption(input), annotateImpactCaveat(decision, impactResult),
│              DEGRADED_REASONS (12), CAVEAT_CODES (1), GRAPH_SCOPE_EXTENSIONS
│     纯函数，零 I/O（无 child_process / fs import，FR-001 验证点之一）
├── git-change-classifier.mjs         ← 【新增】FR-005
│     exports: classifyChangeSet({ nameStatusText, porcelainText }) -> { changeClass, files }
│     NUL 分隔解析，复用 goal-loop-core.mjs::parsePreservedConfigStates 的字段切分范式，
│     但不 import 该函数（避免建立跨模块耦合，两者字段切分逻辑各自独立但同构）
└── graph-refresh-executor.mjs        ← 【新增】FR-007
      exports: executeRefresh({ projectRoot, spectraBin, refreshPolicy, attemptLocalGraphBuild? })
      薄 I/O 层：唯一职责是把 `attemptLocalGraphBuild` 的返回结果映射到 DEGRADED_REASONS 的
      refresh-failed-* 四值。不重实现任何 spawn/deadline 逻辑。
      **依赖注入缝（P-W2 整改）**：`attemptLocalGraphBuild` 为可选具名参数，默认值绑定同目录
      graph-bootstrap-status.mjs 的真实实现——生产调用路径（CLI 层）不传该参数，走默认真实实现，
      不构成 D8"唯一实现"约束的新分支，只是把原本硬编码的 import 变成可覆盖的默认参数。测试可
      注入 fake 断言四类失败分支而不必依赖真实 spectra 二进制/网络，同时仍保留至少一条不注入、
      直接调用真实实现的集成测试（见 §2 SC-002 真实断言）。

plugins/spec-driver/scripts/
└── graph-consumption-cli.mjs         ← 【新增】FR-009，I/O 层
      子命令 decide / annotate-caveat（见 §1.4 两步协议与双事件审计模型）

scripts/lib/
└── graph-bootstrap-status.mjs        ← 【改造】仓根原文件退化为薄转发壳（见 §1.2）
```

**为什么不挂进 `goal-loop-cli.mjs`**：`goal-loop-cli.mjs` 文件头注释自陈"goal-loop-core 的薄 CLI 包装"，其导出白名单只 import `./lib/goal-loop-core.mjs`。图消费决策模块**不属于** goal-loop-core（D2 已明确"新增独立纯函数...不写入 goal-loop-core.mjs"），把它的子命令塞进 goal-loop-cli.mjs 会让"goal_loop 专属 CLI"这一文件语义漂移，且违背 D2"决策核心放 `plugins/spec-driver/scripts/lib/`、经 CLI 子命令供给 goal_loop **与** SKILL.md 散文层两侧"的中性定位——决策 CLI 不应该看起来只服务 goal_loop。改为新建同级兄弟 CLI `graph-consumption-cli.mjs`，与 `orchestrator-cli.mjs`、`goal-loop-cli.mjs` 并列，两侧调用方（goal_loop 编排与常规 single 编排）地位对等。

### 1.2 D8 迁移的关键实现细节：仓根薄壳不能是纯 `export *`

**这是本次 codebase 核实中发现的一个不在 spec/review-dispositions 字面描述范围内、但会直接决定 C1-A 迁移是否可用的实现陷阱**，必须在 tasks.md 中显式列为一条任务：

canonical 文件末尾（`scripts/lib/graph-bootstrap-status.mjs:576-584`，迁移后原样保留在插件侧）用如下自调用守卫暴露 CLI：

```js
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) { main(process.argv.slice(2)).then(...); }
```

若仓根薄壳只写 `export * from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';`，则 `sync-worktree-local-state.sh` 里 `node "$GRAPH_STATUS_HELPER" write-status ...` 这类**把薄壳文件当 CLI 直接执行**的调用会静默失效——因为被 import 求值的 canonical 模块内 `import.meta.url` 是它自己的 URL，而 `process.argv[1]` 是薄壳文件路径，两者不等，`invokedDirectly` 恒为 `false`，`main()` 永不被调用，`write-status`/`check-freshness`/`attempt-build` 全部变成静默 no-op（不报错，因为 Node 进程正常退出码 0，只是什么都没做——这是最危险的一类回归：看起来成功，实际空转）。

**仓根薄壳必须写成**：

```js
// scripts/lib/graph-bootstrap-status.mjs —— D8 薄转发壳，唯一职责：转发 import 与 CLI 调用
// canonical 实现见 plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs，禁止在此复制任何业务逻辑
export * from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';
import { main } from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`graph-bootstrap-status 内部错误：${String(error)}\n`);
      process.exitCode = 1;
    });
}
```

这段 argv 转发 + 错误收敛样板不含任何 F239 的 spawn/deadline/进程组/产物校验逻辑，不违反 D8"禁止复制"约束。

**补充（P-W1 整改）**：`.catch` 分支逐字保留 canonical 同款的 stderr + `exitCode 1` 收敛（对照现行实现 `scripts/lib/graph-bootstrap-status.mjs:585-588`）。v1 遗漏了这一分支——若真实执行路径抛出未捕获异常，v1 版本薄壳会以未处理 rejection 形式退出（无结构化 stderr 消息，只是 Node 默认的未处理 rejection 警告/退出行为），v2 补齐后保持与 canonical 一致的错误可观测性。这是 Codex 抓到的第一个 WARNING（P-W1），机械但真实。

**核实过的其余迁移安全性**：canonical 文件内除这一处 `import.meta.url` 自检外，唯一另一处用到（`scripts/lib/graph-bootstrap-status.mjs:5` 的 `fileURLToPath` import 本身），其余全部路径（`GRAPH_REL` 等）都基于调用方传入的 `projectRoot` 参数拼接，不依赖文件自身所在目录深度——因此整体移动到 `plugins/spec-driver/scripts/lib/`（目录深度从 2 级变 4 级）不会破坏任何内部路径计算，是一次安全的纯移动 + 转发壳。

### 1.3 D8 迁移代价清单（逐项落实）

| 文件 | 处置 | 理由 |
|---|---|---|
| `tests/unit/graph-bootstrap-status.test.ts:22` | **不改**（`import * as statusCore from '../../scripts/lib/graph-bootstrap-status.mjs'` 继续成立） | 薄壳 `export *` 保留全部命名导出，import 路径未变 |
| `tests/unit/worktree-lifecycle-hook.test.ts:16,109` | **必改**：`REAL_STATUS_HELPER` 常量从 `scripts/lib/graph-bootstrap-status.mjs` 改为 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（即 canonical 路径） | **P-W1 修订**：该测试用例 (b)「PATH 剥离 node：warning 可见 + copy 与 SYMLINK_TARGETS 步骤仍完成 + exit 0」的实际考察点是 hook 在 `node` 不可用时的降级行为——用例场景本身把 `node` 从 `PATH` 剔除，被 copy 进合成 worktree 的文件**根本不会被 `node` 执行**，因此"copy 薄壳会在这条用例里因 `ERR_MODULE_NOT_FOUND` 而先转红"是一个不成立的断言（v1 声称如此，已被 Codex 证伪）。改常量的理由是独立的正确性考量：迁移后 canonical 才是自包含（零跨文件相对 import）实现，测试应当复制自包含内容而非依赖外部相对路径的转发壳，即便这条既有用例当前不会暴露两者的差异。§1.2 陷阱的真实回归证据见 §2 批 1 新增的 `graph-bootstrap-status-shim.test.mjs` |
| `scripts/sync-worktree-local-state.sh:24` | **不改**：`GRAPH_STATUS_HELPER="$SCRIPT_DIR/lib/graph-bootstrap-status.mjs"` 仍指向仓根薄壳 | bash 脚本按自身 `SCRIPT_DIR` 相对定位，薄壳转发后行为不变；已用 §1.2 的转发壳修复 CLI 调用路径 |
| `docs/spectra-cli-reference.md` | 视引用内容而定，若引用仓根路径可保留（薄壳仍在原位） | 面向用户文档，路径未变 |

### 1.4 CLI 两步协议与双事件审计模型（FR-009 字面表述的必要澄清 + P-C1 修订 —— **plan 层新增设计决策，需在 tasks.md 中登记**）

FR-009 原文写"内部完成...若消费则调 impact 并经 `annotateImpactCaveat` 注解...输出决策 JSON"，字面读像是**单次 CLI 调用内部直接调用 impact**。但核实后发现这一步在架构上不可能由 `.mjs` 纯 Node 脚本完成：`impact` 是 Spectra **MCP tool**（`src/mcp/agent-context-tools.ts::handleImpact`），只能被持有 MCP client 能力的编排 agent（Claude Code / Codex 本身）调用，`.mjs` 脚本没有 MCP client 协议栈；且仓内检索确认没有等价的 `spectra impact <target>` **CLI** 子命令可供 spawn（precedent 是 `graph-bootstrap-status.mjs` spawn 全局 `spectra graph-quality --json`，但 impact 没有对应 CLI 出口）。新增一个 `spectra impact` CLI 子命令本身是可选项，但**spec 复杂度表格明确只数了 4 个新 CLI 子命令**（图决策 / coverage-gap / 版本决议 / KB 状态），未把"新增 impact CLI"计入——说明这不是 spec 设计者的原意。

**落地为两步协议**（`graph-consumption-cli.mjs` 一个文件，两个子命令）：

```bash
# 第一步：decide —— 五维输入 → 出口判定（按需刷新）；非 dry-run 时无条件落一条 kind:"decision" 审计事件
node graph-consumption-cli.mjs decide --project-root <path> \
  [--phase <name>] [--base-ref <ref>] --refresh-policy allowed|declined \
  [--advisory] [--dry-run] [--format json|text]
# 输出 JSON 含 decisionId/outcome/degradedReason/caveats(初始为[])/matchedRule/advisory/inputs/
#   refreshAttempted/refreshOk/refreshDurationMs/baseRefMissing?

# 第二步（仅当 outcome === "consume-impact" 时需要）：annotate-caveat —— 追加一条 kind:"caveat-annotation"
#   审计事件，回链上一步的 decisionId
#   调用方（SKILL 散文层 / goal_loop）此时已按 decide 的 outcome 自行发起 Spectra MCP impact 调用，
#   把 MCP 返回写临时 JSON 文件，喂给本子命令：
node graph-consumption-cli.mjs annotate-caveat <decisionJsonFile> <impactResultJsonFile|null>
# 输出：caveat-annotation 事件回执 JSON（含 impactStatus），事件本身已追加进审计事件流（见下）
```

**审计落盘模型（P-C1 整改：双事件审计，取代 v1「一决策一行、两步之间不落审计」的设计）**

v1 的原设计是：`decide` 出口为 `consume-impact` 时暂不落审计，只输出"待注解"的中间态 JSON，等 `annotate-caveat` 补齐 caveat 后才统一落一行完整记录。Codex 用三个证伪推翻了这个设计：goal_loop authoritative 路径（§3.2 位置二）只跑 `decide` 永不调用 `annotate-caveat` → `consume-impact` 出口**必然**漏记；`decide` 与 `annotate-caveat` 两次调用之间图文件被并发重建 → 后一步注解时读到的图快照与前一步决策时的快照不是同一个，若继续拼接会产出一条对不上号的"完整记录"且无法检测；两步之间进程崩溃（如 CLI 被中断） → 永久漏记，FR-010"每次非 dry-run 决策无论出口都必须落审计"这一硬约束在两步协议下被打破。

v2 改为**事件日志模型**：审计文件从"一次决策一行完整记录"变成 append-only 的事件流，`decide` 与 `annotate-caveat` 各自独立、无条件落盘：

1. **`decide`（非 dry-run）无条件当场追加一条 `kind: "decision"` 事件**：
   ```
   { kind: "decision", decisionId(uuid), ts, phase, advisory, inputs{五维},
     outcome, degradedReason, caveats: [], graphSourceCommit(决策时图内嵌值|null),
     refreshAttempted, refreshOk }
   ```
   FR-010 由这一条事件**独立满足**，与后续是否调用 `annotate-caveat`、进程是否崩溃无关。`caveats` 恒为空数组（caveat 只能由后续 `caveat-annotation` 事件补充，`decision` 事件本身不预判、不等待）。

2. **`annotate-caveat` 被调用时追加一条 `kind: "caveat-annotation"` 事件**：
   ```
   { kind: "caveat-annotation", decisionId(回链上一条 decision 事件), ts,
     impactStatus: "completed"|"failed"|"skipped"|"snapshot-mismatch",
     caveats: [...], graphSourceCommitAtAnnotation }
   ```
   **入参校验**：`decide` 输出 JSON 里携带的 `graphSourceCommit` 与本次注解时刻图文件内嵌的 commit 值比对，若不相等 → `impactStatus: "snapshot-mismatch"`、`caveats` 置空、不采信本次 impact 结果——跨快照拼接被**显式检出并记录**，而不是静默拼接成一条看似完整实则失真的记录（闭合 Codex 的第二个证伪点：并发重建场景）。

3. **goal_loop authoritative 路径（§3.2 位置二）= `decide` 单步即完整**：该路径本就不消费 impact（只记录判定供审计/排障），没有后续 `caveat-annotation` 事件是**正确形态**，不是漏记——`decision` 事件已经独立满足 FR-010（闭合 Codex 的第一个证伪点：goal_loop authoritative 永不 annotate）。

4. **删除的旧设计**：v1 的「调用方合同强制项：拿到 `outcome: "consume-impact"` 后即便 impact 调用失败/未执行也 MUST 调用 `annotate-caveat`（传 `impactResultJsonFile=null`）」整段合同被移除。双事件模型下不再需要这条合同来保证审计完整性——`decision` 事件已独立满足硬约束；即便调用方（罕见异常路径）真的没调 `annotate-caveat`，审计流中会体现为"存在一条 `outcome=consume-impact` 的 `decision` 事件，但没有回链的 `caveat-annotation` 事件"——这是**可观测的 pending 态**（可用 `decisionId` 反查），不是无法察觉的静默漏记（闭合 Codex 的第三个证伪点：两步间 crash）。

5. **SC 断言口径变化**：SC-005 的 12 个 `degradedReason` 值走 `decision` 事件断言；caveat 走 `caveat-annotation` 事件断言；原"跑两次决策 → 审计恰 2 行"改为"恰 2 条 `kind: decision` 事件"（不再假设"一决策一行"的旧模型，见 §2 批 1 表格）。

### 1.5 批 2（E1）—— 新文件

```
src/scaffold-kb/
├── query-redaction.ts       ← 【新增】FR-012，6 类规则表（数据表形式，非散落正则）
│     exports: redactQuery(raw: string) -> { redacted: string, tags: string[] }
├── nohit-recorder.ts        ← 【新增】FR-013，落盘 + 30 天滚动清理
│     exports: recordNoHit({ tool, rawQuery, dbPath }) -> void（静默降级，EC-20）
│                resolveNoHitTelemetryDir() -> string | null（P-W3 整改，见下）
│     内部：resolveNoHitTelemetryDir() 判空提前返回 → redactQuery → tokenize（复用
│           src/scaffold-kb/tokenizer.ts，不改该文件）→ 去重 term
└── governance-constants.ts  ← 【新增】OQ-2 要求的单一常量模块
      exports: MIN_OCCURRENCE_THRESHOLD=2, NOHIT_RETENTION_DAYS=30,
               KB_FRESHNESS_AGING_DAYS=30, KB_FRESHNESS_STALE_DAYS=90
      （四参数集中于此，调参成本 = 改一处常量 + 改对应测试期望值，OQ-2 硬要求）

src/scaffold-kb/
└── coverage-gap.ts          ← 【新增】FR-014/015
      exports: buildCoverageGapReport({ nohitDir, isCollectionEnabled }) -> CoverageGapOutput
      读 .specify/kb-nohit/nohit-*.jsonl，按 term 聚合，minOccurrenceThreshold 过滤

src/cli/commands/scaffold-kb.ts   ← 【改】op dispatch 新增 'coverage-gap' 分支（runCoverageGap）
src/cli/utils/parse-args.ts       ← 【改】scaffoldKbOperation union（现行 :113 只收 build/serve/query/ingest）
                                     扩 'coverage-gap'，同步 :758 附近合法 op 校验分支；并新增 --format 等
                                     coverage-gap 专用 flag 解析（P-W5：不改 union 则 dispatch 永远不可达）
src/cli/index.ts                  ← 【改】scaffold-kb help 文案补 coverage-gap op 说明
```

**采集开关（P-W3 整改：钉死为单一 env，不留开放项）**：`nohit-recorder.ts` 新增导出 `resolveNoHitTelemetryDir(): string | null`——读 `process.env['SPECTRA_KB_NOHIT_TELEMETRY']`；未设置或空字符串 → `null`（**默认关闭**，对齐 `src/mcp/lib/telemetry.ts:40` 的 `SPECTRA_MCP_TELEMETRY_PATH` 先例：同样是直接 env 直读、undefined 即关闭，不引入新的开关范式）；非空 → 该值即落盘目录（调用方不必自行 `mkdir`，`recordNoHit` 内部懒建目录）。`recordNoHit` 内部唯一调用点是 `resolveNoHitTelemetryDir()`——三处挂点（kb-search / kb-api-lookup / scaffold-kb query）全部只调用 `recordNoHit(...)`，不各自读环境变量，从结构上保证"三个 recorder 共用同一解析函数"（P-W3 硬约束）。

**no-hit 记录三处挂点**（FR-012"三个入口"，均为已读源码的精确行号）：
1. `src/kb-mcp/tools/kb-search.ts::executeKbSearch`——在 `merged = annotateFreshness(mergeResults(...))` 之后（现行 `:80`）判 `merged.length === 0` 时调用 `recordNoHit({ tool: 'kb_search', rawQuery: params.query, dbPath })`。
2. `src/kb-mcp/tools/kb-api-lookup.ts::executeKbApiLookup`——两处：
   a. `matched.length === 0` 分支（`allEnts.length>0` 时的正常路径，现行 `:141`，返回 `not_found: true` 之前）调用 `recordNoHit({ tool: 'kb_api_lookup', ... })`；
   b. `documentFallback`（`allEnts.length===0` 时的降级路径，现行 `:79-100`）**内部**，`hits` 数组组装完成后（现行 `:93` 返回前）若 `hits.length === 0` **同样**调用 `recordNoHit({ tool: 'kb_api_lookup', ... })`。**P-W3 修订**：v1 认为 documentFallback 是"无实体表可查"而非"查了没命中"，语义不同因而整体排除——这是不准确的判断：`documentFallback` 内部确实执行了 `searchKbCore`（两个库各查一次，现行 `:84`），只要真实执行了检索且零命中，就是一次真实的零结果，理应计入 no-hit 统计；不挂点反而会让 coverage-gap 聚合器漏掉"两库均无实体表、文档检索也零命中"这一整类真实缺口信号。
3. `src/cli/commands/scaffold-kb.ts::runQuery`——在既有 `merged.length === 0` 分支（现行 `:61-64`，已打印 `[scaffold-kb query] no-hit` 到 stderr）旁挂 `recordNoHit({ tool: 'scaffold_kb_query', ... })`。

**为什么挂在 `executeXxx` 而非 `withTelemetry` 装饰层**（任务指令已预先指定理由，核实后确认成立）：`withTelemetry`（`src/mcp/lib/telemetry.ts:119-144`）包裹整个工具调用，其 `TelemetryEntry` 不含 query 内容字段，且它的职责是通用请求/响应体量遥测，不是"按结果语义分支"的埋点层——在装饰层重新解析 `args.query` 与响应体 `results.length` 属于把 executeXxx 内部已知的信息在外层重算一遍，属于不必要的耦合。挂在 executeXxx 内部可以直接拿到已经存在的 `params.query` 与 `merged`/`matched` 变量，零额外解析开销。

### 1.6 批 3（E2/E3）—— 新文件

```
src/scaffold-kb/
├── lockfile-parser.ts       ← 【新增】FR-016
│     exports: parseLockfileVersion({ lockfilePath, packageName, kind }) -> { version, source } | null
│     三种 kind: 'npm'(package-lock.json v2/v3) | 'pnpm'(pnpm-lock.yaml) | 'yarn'(yarn.lock)
│     复用 src/panoramic/project-context.ts::LOCK_FILE_PRIORITY 仅做"存在性探测优先级"，
│     内容解析全新写（该常量本身不解析内容，已由调研 B4 确认）
│     大文件保护：statSync 前置守卫，复用"stat-before-read"同款模式（非同一常量/模块，
│     跨 src/ 与 plugins/ 边界不做常量共享，各自独立定义上限，见 EC-28 处置）
├── version-resolver.ts      ← 【新增】FR-017
│     exports: resolveVersion({ projectRoot, packageName, explicitVersion? }) -> VersionResolution
│     优先级仲裁：explicit > lockfile(单一) > range-only > none；多 lockfile 且无 explicit → ambiguous；
│     lockfile 解析版本与 `node_modules/<pkg>/package.json` 实际安装版本不一致（可检测时）→
│     两者同入 candidates[] 并标 lockfile-install-mismatch（EC-25，P-W2 补齐测试缺口）
└── kb-status.ts             ← 【新增】FR-019/020
      exports: buildKbStatusReport(db | null) -> KbStatusOutput
      沿用 schema-compat.ts::hasProvenanceColumns 的 PRAGMA 探测范式（直接 import 该函数判定，
      不新增探测函数——见 §4）

src/cli/commands/scaffold-kb.ts   ← 【改】op dispatch 新增 'version'、'status' 两分支
src/kb-mcp/tools/kb-search.ts     ← 【改】payload 新增 kb_status 子对象（buildKbStatusReport 子集）——
                                     追加到**全部**成功 envelope（`buildKbSuccess` 出口，含 0 命中场景）
src/kb-mcp/tools/kb-api-lookup.ts ← 【改】payload 新增 kb_status 子对象（同上）——追加到**全部**成功
                                     envelope，含 `documentFallback` 分支（现行 `:93`）与 `not_found`
                                     早返回分支（现行 `:142`）；`error` envelope（`buildKbError` 出口）
                                     **不**追加（P-W4 已钉死，不再是"见 tasks.md 细化"的开放项）
src/cli/utils/parse-args.ts       ← 【改】scaffoldKbOperation union 再扩 'version' | 'status'（P-W5，
                                     同批 2 的 union 扩展模式；漏改则两个新 op 在 :758 校验处被拒为
                                     invalid_subcommand，模块单测全绿但 CLI 永远不可达）
src/cli/index.ts                  ← 【改】scaffold-kb help 文案补 version/status 两 op 说明
```

**FR-019 公式的一个 plan 层需要钉死的推断点**（spec 未明确、需要显式记录）：`activityAt = max(built_at, ingested_at)` 是**逐行**取 max 还是**库级**取 max？`chunk_meta` 是逐 chunk 冗余字段（调研 B3 已确认"没有独立库级 meta 表"）。`kb-status.ts` 的实现口径为：**先逐行算 `max(built_at, ingested_at)`，再对全表取 `MAX(...)` 得到库级 `activityAt`**；`oldestBuiltAt` = 全表 `MIN(built_at)`。`[推断]`——spec 字面只给了单值公式，未显式区分逐行/全库，但"库路径与是否存在...activityAt"的输出粒度（Key Entities #8）明确是**单一库级值**，因此二次聚合是唯一自洽读法。**该聚合口径只在能读到 `ingested_at` 列时生效**（见 §4 legacy schema 处置，与本推断点相互独立，不冲突）。

**`kb_status` 字段命名**：spec Key Entities #8 定义了完整 `KB 状态输出` schema，但没有钉死它挂在 `kb_search`/`kb_api_lookup` 响应里的**外层 key 名**。Plan 定为 `kb_status`（新增顶层字段，纯 additive，不与 `results`/`total_found`/`not_found` 等既有字段冲突）。`[推断，plan 拍板]`。

### 1.7 Pilot 三段化（preflight / continuous capture / finalize）—— 制品，非源码（P-C2 修订）

v1 把 pilot 全部制品都记成"批 4 新增"，构成一个假环——`predicted-impact-set.md`/`ledger.jsonl` 是权威事实产出所必须的**前置**冻结物，但 v1 把它们排在"批 4"（implement 最后一批），意味着 implement 前三批发生的所有 MCP 调用都无 ledger 可记。Codex 证伪：这是一个批次依赖环。v2 把 pilot 拆成三个**跨批**阶段，只有最后一段真正落在批 4：

| 阶段 | 时间跨度 | 内容 | 状态 |
|---|---|---|---|
| **preflight** | 批 1 implement 开始**前** | `predicted-impact-set.md`（预测集）冻结提交 + `ledger.jsonl` schema 校验（字段集合、`seq` 单调性） | **已完成**——两份制品在本 plan 阶段之前已存在于仓内（见下），非本 feature 待做项 |
| **continuous capture** | 横跨批 1→批 3 | 每次 Spectra MCP 调用（impact/context/search 等，含本 plan 阶段自身 dogfooding 记录，见附录）发生的**当下**双写：追加一行 `mcp-call-log.md`（人读） + 一行 `ledger.jsonl`（机器可读，含真实 ISO `timestamp`） | implement 期间持续进行，不是一次性任务 |
| **finalize** | 批 4 | 实际集（对照 `predicted-impact-set.md` 计算命中率）+ M-3（prompt A/B + diff hash 落盘）+ pilot 报告撰写 + `ledger-verify.mjs` 从 ledger 重算 M-1 四类计数并比对报告数字 | 本 feature 唯一真正"批 4 新增"的部分 |

**制品现状澄清（P-C2 point 2）**：`predicted-impact-set.md`、`ledger.jsonl`、`mcp-call-log.md` 均**已存在**于 `specs/241-graph-keepalive-kb-grounding/pilot/`（preflight 已完成、continuous capture 正在持续记账中，当前 `ledger.jsonl` 已有 11 行）。tasks.md **不得**把它们列为"批 4 新增文件"——只有 `ledger-verify.mjs`（重算脚本）与 `m3/` 目录（`prompt-a.md`/`prompt-b.md`/`diff.hash`）是批 4 的净新增制品。

**ledger timestamp 迁移条款（P-C2 point 3，编排器自身的错，须诚实回填）**：现有 `pilot/ledger.jsonl` 11 行（`seq` `0-1` ~ `1-8`）在 schema 定稿前记录，缺 `timestamp` 字段。**处置**：
- 新增一条批 1 内的迁移任务：为这 11 行补 `"timestamp": null` + `"timestampNote": "schema 定稿前记录，先后次序见 mcp-call-log.md 的 git 历史"`。
- **禁止**伪造事后时间戳（不得用 commit 时间或估算值冒充真实调用时刻）。
- 此后（continuous capture 阶段起）新增的每一行 **must** 带真实 ISO 8601 `timestamp`，由 `ledger-verify.mjs` 的 schema 校验强制（非 null-marked 行缺 `timestamp` 判为 schema 违规）。

```
specs/241-graph-keepalive-kb-grounding/pilot/
├── mcp-call-log.md            （已存在，持续 append，preflight+continuous capture）
├── predicted-impact-set.md    （已存在，preflight 冻结）
├── ledger.jsonl                （已存在，11 行迁移补 timestamp:null，此后持续 append 真实 timestamp）
├── ledger-verify.mjs           ← 【新增，批 4】dev-only 重算脚本（不进 src/，不进 plugins/，
│                                  纯 pilot 内部工具，node 内置模块即可跑，不产出编译产物）
└── m3/
    ├── prompt-a.md / prompt-b.md / diff.hash   ← 【新增，批 4】FR-022 M-3
```

`ledger-verify.mjs` 放在 pilot 目录而非 `scripts/`，因为它是**评测工具**不是生产代码——比照 CLAUDE.local.md「评测凭据策略」与「Baseline 测试」两节的既有分类原则（评测产物不进生产路径），且 checklist.md 已明确它是"dev-only 小验证脚本"。

---

## 2. 每批 TDD 红测试清单

> 用户硬要求：每个 `[必须]` FR 先有红测试。以下按批列出**先写的测试文件**与其覆盖的 FR/SC；B4 走 `node:test`（插件侧惯例），E1/E2/E3 走 vitest（`tests/kb/` 惯例）。
>
> **crosswalk 强制要求（P-W2）**：tasks.md 必须在本节基础上补一张 FR/SC/RG → 测试用例的逐项映射表（哪个 FR/SC/RG 由哪个测试文件的哪条断言覆盖），不得只有测试文件清单。以下按批列出的表格是该 crosswalk 的输入，不是替代品。

### 批 1（B4）—— `node --test plugins/spec-driver/tests/*.mjs`

| 测试文件 | 覆盖 FR/SC | 关键断言 |
|---|---|---|
| `plugins/spec-driver/tests/graph-consumption-decision.test.mjs` | FR-001/002/003/004/004b/006, SC-001/004/005/006 | 144 组合穷举 + matchedRule；5 条 `invalid-input` 缺字段用例；第六字段 `impactResult` 被忽略用例；`DEGRADED_REASONS`/`CAVEAT_CODES` 交集为空 + 各自枚举完整性；`annotateImpactCaveat` 的 3 条对照（含 caveat / 不含 caveat / 非消费出口不注解）；6 类 unreachable 组合的显式注释存在性（grep 断言）；missing 探针 + out-of-scope 探针两条顺序不变量；模块内无 `child_process`/`fs` import（静态 grep） |
| `plugins/spec-driver/tests/git-change-classifier.test.mjs` | FR-005 | NUL fixture（`M`/`A`/`??`/`R100` 三段/`C75`/空输入/含空格/含中文与引号路径）；负例断言"若误按 ` -> ` 人读格式切分会得到错误清单" |
| `plugins/spec-driver/tests/graph-refresh-executor.test.mjs` | FR-007, SC-006 | fake `attemptLocalGraphBuild` 注入四类失败 → 四个 `refresh-failed-*` 枚举值（走 P-W2 新增的依赖注入缝，§1.1）；同一失败在"刷新前 present"与"刷新前 missing"下分别断言由调用方（decision 层）改写为 `consume-degraded`/`unavailable`（本测试只测 executor 的 reason 映射，出口改写留给 decision 层单测覆盖，避免测试职责重叠）；**追加一条不注入 fake、直接用真实 `attemptLocalGraphBuild` 的集成用例**（对最小临时 git fixture 项目跑真实 graph-only 重建），作为 SC-002"真实刷新确有发生"的一手证据，与其余 fake 注入用例互补但成本更高（标记为该文件内单独的慢用例） |
| `plugins/spec-driver/tests/graph-consumption-cli.test.mjs` | FR-008/009/010, SC-002/003/007/019 | `--dry-run --format json` 输出可解析 + 六顶层键（含 `decisionId`）；图文件 SHA-256 dry-run 前后不变；spawn 计数桩断言单调用 spawn ≤1；两次调用按合同（allowed→declined）集成断言；**两次 decide 调用后审计文件恰 2 条 `kind:"decision"` 事件**（双事件模型，P-C1，取代 v1"恰 2 行"的旧断言）；`annotate-caveat` 追加 `kind:"caveat-annotation"` 事件并回链 `decisionId`；`graphSourceCommit` 不匹配 → `impactStatus:"snapshot-mismatch"` + `caveats:[]`；只读审计目录 → exit 0 + stderr warning；**SC-019**：把 `plugins/spec-driver/` 整体拷贝到仓外临时目录，从该目录跑 `decide --dry-run --format json`，断言 exit 0 + 可 `JSON.parse` + stderr 无 `ERR_MODULE_NOT_FOUND`/`Cannot find module`；**SC-002**：非 dry-run + stale + allowed，对最小 fixture 项目跑一次真实刷新，断言 `refreshOk`/图文件确有变化（真实断言，非 mock）；**SC-003**：非 dry-run + additive-only，断言图文件 SHA-256 全程不变（证明确实未触发任何刷新尝试，而不只是 dry-run 语义下的被动跳过）；**RG-006 静态检查**：源码内除 `annotate-caveat` 读取调用方传入的 `decisionJsonFile` 外，不 `readFile`/`readFileSync` 审计事件流文件本身（grep 断言只有 append 写操作，无读操作） |
| `plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs` | FR-011, SC-008 | **新文件**（不碰 `goal-loop-core.test.mjs` 本体，满足 RG-001"测试文件本身未被修改"）；advisory 调用输出含 `advisory: true`；允许态确实注入 iteration log + prompt 组装含 impact 内容；拒绝态确实不注入 + iteration log 含对应 degradedReason；缺 freshness 字段的旧形态输入不抛错（回归探针）；**authoritative 路径（DECISION2，§3.2 位置二）只调用 `decide`、不调用 `annotate-caveat`**——断言其 `decision` 事件已落盘且无回链的 `caveat-annotation` 事件，该 pending 态是设计内的正确形态而非漏记（P-C1 point 3） |
| `plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（**新增**） | §1.2 转发壳陷阱回归（无独立 FR 编号，属 C1-A / D8 迁移的实现安全网，P-W1） | Node 可用环境下，直接执行仓根薄壳 `node scripts/lib/graph-bootstrap-status.mjs write-status/check-freshness/attempt-build` 三子命令，逐一断言产生真实副作用（而非静默 no-op：exit 0 但什么都没发生）——这是唯一真正验证 §1.2 陷阱（`invokedDirectly` 恒为 `false` 导致 `main()` 永不执行）已被修复的回归证据。P-W1 已证伪 `worktree-lifecycle-hook.test.ts` 用例 (b) 能充当此证据（该用例把 `node` 从 `PATH` 剔除，helper 根本不会被执行到） |
| `plugins/spec-driver/tests/ensure-gitignore.test.mjs`（**改**，4→6 条断言，本表新增其中 1 条，见 §7 item 3） | FR-024（审计路径部分）, SC-020 | 新增 `.specify/graph-consumption-audit.jsonl` 的 `git check-ignore` 双段断言（仓内直查 + 插件拷入临时全新 git repo 跑自举脚本后再查） |

同批另需**改动但非新增**的测试：`tests/unit/worktree-lifecycle-hook.test.ts`（改 `REAL_STATUS_HELPER` 常量指向，§1.3）——**P-W1 修订**：这不构成"先红后绿"的 TDD 证据。该测试用例 (b) 的场景本身把 `node` 从 `PATH` 剔除，helper 根本不会被 `node` 执行，因此"复制薄壳文件是否触发 `ERR_MODULE_NOT_FOUND`"在这条用例里从未被真正考验过；v1 声称"先红后绿"是不成立的断言，已被 Codex 证伪。改常量的理由是独立的正确性考量：迁移后 canonical 才是自包含实现，测试应复制自包含内容而非依赖外部相对路径的转发壳，即便这条用例当前不会暴露该差异。§1.2 陷阱的真实回归证据见上表新增的 `graph-bootstrap-status-shim.test.mjs`。

### 批 2（E1）—— `npx vitest run tests/kb/`

| 测试文件 | 覆盖 FR/SC | 关键断言 |
|---|---|---|
| `tests/kb/query-redaction.test.ts` | FR-012, SC-009 | 6 类规则各 ≥2 正例 +1 反例；规则表长度与文档表一致（防悄悄减少） |
| `tests/kb/nohit-recorder.test.ts` | FR-013, SC-009 | 落盘对象键集合恰为 FR-013 列举字段（无整串字段）；40 天前 mtime fixture 被清理；只读目录场景查询不受影响（静默降级）；同一查询两次的 `normalizedQueryHash` 相同；`SPECTRA_KB_NOHIT_TELEMETRY` 未设置/空字符串 → `resolveNoHitTelemetryDir()` 返回 `null` 且 `recordNoHit` 全程零 I/O（P-W3） |
| `tests/kb/coverage-gap.test.ts` | FR-014/015, SC-010/011 | 三态（collection-disabled/no-data/no-gap-above-threshold）互不相同；fixture（term X 2 个不同 hash 3 行 / term Y 1 个 hash 3 行 / 1 条独有 / 1 行损坏）→ 恰 1 条目 + `distinctQueries:2` + `occurrences:3`；term Y **不在** items（绕过防线守卫）；`skippedLines:1` |
| `plugins/spec-driver/tests/ensure-gitignore.test.mjs`（**改**，与批 1 共享同一文件，本批追加第 2 条，见 §7 item 3） | FR-024（no-hit 路径部分）, SC-020 | 新增 `.specify/kb-nohit/` 的 `git check-ignore` 双段断言（仓内直查 + 插件拷入临时全新 git repo 跑自举脚本后再查）；与批 1 新增的审计路径断言合计把该测试文件断言数从 4 提升到 6 |
| `src/kb-mcp/tools/kb-api-lookup.ts` 相关既有测试（**改**，追加不删改既有） | FR-012 挂点 2b（P-W3） | 新增用例：两库均无实体表且文档检索零命中（`documentFallback` 内 `hits.length===0`）→ 断言 `recordNoHit` 被调用；两库均无实体表但文档检索有命中 → 断言 `recordNoHit` 不被调用（区分"零结果"与"有结果"两态，防止挂点误判为无条件记录） |
| `tests/unit/cli-parse-scaffold-kb.test.ts`（新增或并入既有 parse-args 测试） | P-W5 | `spectra scaffold-kb coverage-gap --dry-run` 经 parse-args 解析出 op='coverage-gap' 且不落 invalid_subcommand；未知 op 仍被拒 |

### 批 3（E2/E3）—— `npx vitest run tests/kb/`

| 测试文件 | 覆盖 FR/SC | 关键断言 |
|---|---|---|
| `tests/kb/lockfile-parser.test.ts` | FR-016, SC-012 | 三种 lockfile fixture 各断言解析版本；`go.sum` fixture 断言 `ecosystem-unsupported`；巨大 lockfile fixture（构造超限文件）断言明确失败而非 OOM（EC-28） |
| `tests/kb/version-resolver.test.ts` | FR-017, SC-012, EC-25 | 六组 fixture（仅显式/仅lockfile/冲突/多lockfile无显式/多lockfile+显式/**lockfile 与 `node_modules` 实际安装版本不一致**）→ `resolved.status` 分别正确；`ambiguous` 时 `version===null` + `candidates.length≥2`；冲突组 `flags` 含 `version-conflict`；**新增第六组（P-W2 补齐缺口）**：`node_modules/<pkg>/package.json` 可读且版本与 lockfile 解析结果不一致 → 两者均入 `candidates[]` 且 `flags` 含 `lockfile-install-mismatch`；不可检测（无 `node_modules`）时不猜测，`flags` 不含该值 |
| `tests/kb/kb-status.test.ts` | FR-019/020, SC-013 | 5/45/100 天前三组 → current/aging/stale；100天前built_at+5天前ingested_at → current（验证取 max）且 `oldestBuiltAt` 如实反映 100 天前；缺 provenance 列旧库 → `unknown` + `legacy-missing-provenance` + exit 0；**追加「旧库 `built_at` 很新仍 `unknown`」用例（P-W4）**：缺 provenance 列但 `built_at` 为 1 天前（很新）→ 仍输出 `freshness:"unknown"`（不得因 `built_at` 新近而误判 `current`，§4 已纠正 v1"退化为仅用 built_at 仍参与判级"的矛盾表述）；`noHitCollection`/`recentNoHitCount` 字段断言（P-W2）：`SPECTRA_KB_NOHIT_TELEMETRY` 未设置 → `noHitCollection:"disabled"` + `recentNoHitCount:null`；设置且目录存在数据 → `"enabled"` + 非负整数；运行前后库文件 SHA-256 不变 |
| `tests/kb/kb-contract.test.ts`（**改**，追加断言不删改既有） | FR-021, SC-014 | 新增断言：`kb_search`/`kb_api_lookup` **全部成功 envelope**（含 `document_fallback`、`not_found` 早返回分支）均含 `kb_status` 子对象；**error envelope 不含**该字段（P-W4 已钉死，非开放项）；既有字段（`results`/`total_found`/`not_found`）快照逐字节不变 |
| `tests/kb/kb-search-tool.test.ts` / `kb-api-lookup-tool.test.ts`（**改**，追加） | FR-021, SC-014 | 同上，工具级集成断言；`kb-api-lookup-tool.test.ts` 额外覆盖 `documentFallback` 分支（`allEnts.length===0`）下 `kb_status` 同样出现 |
| 同上文件追加用例 | P-W5, SC-012/SC-013 | `version`/`status` 两 op 解析通过 + dispatch 到对应分支的集成断言（parse→runScaffoldKb 全链） |

### 批 4（pilot）—— 非测试，验证脚本 + 制品存在性

| 制品/脚本 | 覆盖 FR/SC | 验证方式 |
|---|---|---|
| `pilot/ledger-verify.mjs` | FR-022, SC-016 | 从 `ledger.jsonl` 重算 M-1 四类计数，与报告数字逐项比对，不一致 exit 非 0 |
| `pilot/ledger.jsonl` 迁移校验 | P-C2 point 3 | `ledger-verify.mjs` 内断言：既有 11 行 `timestamp===null` 且 `timestampNote` 非空；此后新增行 `timestamp` 为合法 ISO 8601 字符串（非 null） |
| `pilot/predicted-impact-set.md` 首次提交时间 | SC-015 | `git log --format=%aI` 早于首个 implement 代码提交 |
| `pilot/m3/{prompt-a.md,prompt-b.md,diff.hash}` 落盘校验 | FR-022 M-3, SC-016 | 校验 `diff.hash` = 对该轮 diff 内容算出的 SHA-256，且与 `git diff` 现场重算值一致（防止事后编造）；`prompt-a.md`/`prompt-b.md` 非空且内容差异可读（人工比对基线） |
| pilot 报告文本 | FR-023, SC-017 | grep 五项声明关键词存在；「禁止外推表述」降级为人工审查项（W5 已裁决） |

---

## 3. SKILL.md 散文层接线点

文件：`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`。核实到两个独立注入位置，覆盖 goal_loop 与 **默认 `agent_mode: single`** 两条路径（后者是 spec 场景 A/B/C 的字面主路径，不是 goal_loop 专属——D2 已明确 CLI 子命令的存在正是为了让两侧共用同一份判定）。

### 3.1 通用 Phase 循环（`agent_mode: single` 默认路径，覆盖场景 A/B/C）

定位：`### 执行模式` 小节（现行 `:190-258`），第 4 步"构建上下文注入块"与第 5 步"委派子代理执行"之间（现行 `:212-215`）。新增条件分支，**只在当前 phase 为 verify 时触发**（`pre-verify authoritative` 合同）：

```text
4b.（仅当 phase.id === "verify" 时）调用图消费决策（pre-verify authoritative）：
    DECISION=$(node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide \
      --project-root {project_root} --base-ref {phase 6 implement 起点 ref} \
      --refresh-policy {本 phase 内首次调用传 allowed，否则 declined})
    - DECISION.outcome ∈ {consume-impact, refresh-then-consume 且刷新成功}：
        发起 Spectra MCP impact 调用 → annotate-caveat → 把结果并入步骤 4 的上下文注入块，
        标注为 "verify 前置 grounding（authoritative）"
    - 其余出口：不调用 impact，把 DECISION.degradedReason 并入上下文注入块的 caveat 说明
      （供 verify 子代理理解"为什么没有 impact 证据"，而非静默缺失）
```

**`{phase 6 implement 起点 ref}` 的获取**：`[推断，需 tasks.md 阶段核实]`——本次调研未确认 SKILL.md 是否已有"phase 起点 commit" 的既有记录点。建议方案：implement phase 开始前（第 5 步委派 implement 子代理之前）执行 `git rev-parse HEAD` 并写入 trace.md 或一个 phase 级临时变量，供 verify phase 读取。若 tasks.md 阶段核实到已有等价机制（如 trace.md 的 phase 记录已含 commit 锚点），复用之，不新增字段。

### 3.2 goal_loop 闭环编排（现行 `:284-435`，覆盖场景 D）

**位置一**：步骤 2「注入 Spectra impact 上下文」（现行 `:379-389`）的 `a.` 之前插入 advisory 决策：

```text
0. （新增，pre-implement advisory）
   DECISION=$(node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide \
     --project-root {project_root} --phase implement --base-ref {phase 起点 ref} \
     --refresh-policy {本 phase 内首次调用 allowed，否则 declined} --advisory)
   - DECISION.outcome ∈ {consume-impact, refresh-then-consume 且刷新成功}：
       继续执行原 a/b（发起 MCP impact + interpret-impact），并在喂入 prompt 前经
       annotate-caveat 注解，标注为 "advisory grounding"
   - 其余出口：跳过 a/b，本轮 injection_status=skipped_by_advisory_decision，
     iteration log 记 DECISION.degradedReason（advisory 结论不作为权威判定，仅决定本轮是否注入）
```

**位置二**：步骤 4「选择 verify 模式」（现行 `:403-413`）之前插入 authoritative 决策（该轮 implement 已完成，可取实际 diff）：

```text
3b.（新增，pre-verify authoritative）
   DECISION2=$(node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide \
     --project-root {project_root} --phase implement --base-ref {phase 起点 ref} \
     --refresh-policy declined)   # 同 phase 内 advisory 已消耗过一次 allowed 预算，此处按调用方合同必须 declined
   记录 DECISION2 到本轮 iteration log（不注入 prompt——goal_loop 的 verify 子代理本就 MUST 独立实跑，
   不消费 impact 摘要；本次调用的价值是把"权威判定"落进审计与迭代日志，供 pilot M-1/M-2 与事后排障使用）
```

**双事件审计模型下的定性（P-C1 point 3）**：DECISION2 只调用 `decide`，从不调用 `annotate-caveat`——这是**正确形态**，不是漏记。`decide` 已无条件落一条 `kind:"decision"` 事件独立满足 FR-010；该 `decisionId` 不会有回链的 `caveat-annotation` 事件，这是可观测的"decide-only"态（本路径的设计意图本就是"记录权威判定供审计/排障，不消费 impact"），与"consume-impact 出口却漏调 annotate-caveat"的异常态在事件流上可通过是否存在回链的 `caveat-annotation` 事件区分——DECISION2 的合同上从不据此发起 MCP 调用，因此也不会产生待注解的 caveat。

**`formatIterationLogEntry` 零改造的复用方式**（V-2 已验证）：iteration log 条目在**调用方**（SKILL 散文层组装 `entry` 对象时）新增 `graphDecision` 字段（advisory 与 authoritative 各一份），传给既有 `formatIterationLogEntry(entry)` 时该函数 `JSON.stringify(entry, null, 2)` 无字段白名单，新字段自动出现在输出——不改函数体，不违反 RG-003。

### 3.3 SKILL.md 改动的 wrapper 再生（V-8 / P-W7，批 1 内必须完成并连带提交）

`plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md` 头部内嵌 `Source SHA256: 8d03668...`（canonical `skills/spec-driver-feature/SKILL.md` 的全文 hash，F186/F238 门禁资产）。§3.1/§3.2 对 canonical SKILL.md 正文的两处散文改动**必然**改变该 SHA。

**处置**：
1. §3.1/§3.2 的 SKILL.md 接线任务完成后，同一批（批 1）内追加一条显式任务：跑 `bash plugins/spec-driver/scripts/codex-skills.sh install`（或统一走 `npm run repo:sync`）再生两个生成 wrapper：
   - `plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md`
   - `.codex/skills/spec-driver-feature/SKILL.md`
2. 再生产物与 canonical 改动**同一提交**内连带提交，不拆分——否则 `spec-driver-wrappers:*` 族 `repo:check` 红（V-8 已实测确认此为门禁硬约束，非建议项）。
3. **禁止手工解生成文件冲突**：若与其他并行分支（如 F240，见 §7）在这两个 wrapper 文件上产生 rebase 冲突，处置顺序固定为——先合并 canonical `skills/spec-driver-feature/SKILL.md` 的冲突（人工解，散文层可能存在语义冲突），再统一跑 `npm run repo:sync` 重新生成两个 wrapper（机械覆盖，不手工 diff-merge 生成文件本体）。

---

## 4. KB schema 变更

**结论：不新增列，不新增表。** 核实 `src/scaffold-kb/sqlite-writer.ts:25-36` 的 `chunk_meta` 建表语句：`built_at`（F190 基础列，非空，始终存在）、`sdk_version`（F190 基础列）、`ingested_at`（F192 provenance 列，旧库缺失需探测）均已是既有列，FR-019 的 `activityAt = max(built_at, ingested_at)`、`sourceVersions`（去重 `sdk_version`）全部可由现有列聚合得出，无需 schema 变更。

**兼容策略**：`kb-status.ts` 复用 `schema-compat.ts::hasProvenanceColumns` 同款 `PRAGMA table_info(chunk_meta)` 探测范式，**直接 import `hasProvenanceColumns`**，不新增独立探测函数（该文件当前语义收窄在"F192 provenance 三列"，本 feature 的探测目标"能否读到 `ingested_at` 单列"恰好落在 `PROVENANCE_COLUMNS` 三列之内，复用同一份判定即可，无需另写一份）。

**legacy schema（缺 provenance 列）处置（P-W4 修订，纠正 v1 的矛盾表述）**：`hasProvenanceColumns` 返回 `false` 时（旧库缺 `ingested_at` 列）→ `freshness` **恒为 `"unknown"`**，即便 `built_at` 本身很新也**不得**据此判 `current`/`aging`/`stale`——v1 曾写"`activityAt` 退化为仅用 `built_at`"并暗示仍据此判级，这与"旧 schema 无法证明 provenance 缺失是真的从未 ingest 还是仅仅列不存在，单列 `built_at` 不足以支撑判级声明"自相矛盾（P-W4 已纠正）。此情形下 `activityAt` 本身取值为 `null`（不做退化计算），`schemaCompat: "legacy-missing-provenance"`、`freshness: "unknown"` 对外呈现；`oldestBuiltAt`（仅可见性字段，不参与判级）仍可正常输出 `built_at` 的最小值。见 §2 批 3 表格新增的"旧库 `built_at` 很新仍 `unknown`"回归用例。

**MCP 响应向后兼容策略**（FR-021 / RG-005 / SC-014）：`kb_status` 作为**纯新增顶层字段**追加到 `buildKbSuccess(payload)` 的 `payload` 对象，不改动 `results`/`total_found`/`not_found`/`truncated`/`sources_queried` 等既有键的名称、类型、层级；追加范围是**全部成功 envelope**（含 `document_fallback`/`not_found` 早返回分支），`error` envelope（`buildKbError` 出口）不追加（P-W4，见 §1.6）。`kb-contract.test.ts` 的既有快照断言因此天然不受影响；新增断言只需追加"含 `kb_status` 且其余字段逐字节不变"这一条，不修改任何既有断言的期望值。

---

## 5. FR-018（版本信息进入 KB 检索）去留判定

**判定：删除，不实现。**

**核实依据**（读 `src/scaffold-kb/search-core.ts:87-137` 全文得出，比 spec/研究阶段掌握的信息更精确）：`searchKbCore(db, query, topK, sdkVersion?, preTokenized?)` **已经**接受可选 `sdkVersion` 参数并在 FTS 与 LIKE 兜底两条 SQL 分支都拼接 `AND chunk_meta.sdk_version = ?` 精确过滤（`:103,108,121`）。这条能力从 F190/F192 起就存在，`kb_search` 当前把 `params.sdk_version`（**用户显式传入时**）原样透传到这里（`kb-search.ts:66,70`）。

机械上看，FR-018 的"接入"似乎极低成本——E2 解出 `resolved.version` 后，在用户**未显式传** `sdk_version` 时把它塞进 `searchKbCore` 的 `sdkVersion` 参数即可复用现成过滤器。但这恰恰是问题所在：

1. **改变的是默认行为语义，不是新增行为**。当前"不传 `sdk_version`"= 跨全部版本检索；一旦默认自动填入 E2 推断版本，同一句 `kb_search({query: "..."})`（不带 `sdk_version`）在库内存在多版本内容时会返回**更少**的结果（被过滤到单一版本）。这直接撞上 Non-Goals 第 9 条"不改 KB 现有查询/排序/仲裁语义——三薄层只加治理面，检索行为零变更"——过滤条件的默认值变化就是检索行为变化，不是"零变更"。
2. **RG-005 回归面**：`kb-contract.test.ts`/`kb-search-tool.test.ts` 大概率有基于"不传版本→不过滤"这一现状的既有断言（fixture 库若含多版本 chunk，这类用例会在自动注入版本过滤后静默变化结果集，而不是显式报错——是最难被测试网住的一类回归）。
3. **唯一"安全"的接入方式**（不改默认语义）是新增一个显式 opt-in 参数（如 `use_resolved_version: true`），但这已经超出 spec 授权范围（会新增一个 MCP 工具入参，等于变相扩大 FR-021"纯新增字段"之外的接口面），且 spec 本身已经为 FR-018 预设了退出条款："若 plan 阶段发现无法在不改检索语义的前提下接入，本条降级为 MAY 并从本轮移除"。
4. **E2 的验收不依赖 FR-018**：spec 复杂度评估已明确"E2 的验收（『版本自动识别』）由 FR-016/FR-017 独立满足"——`version` 子命令本身已完整交付"给定包名 → 推断具体版本"的能力，检索侧接入是纯粹的增量集成，价值增量小、回归风险不对称地大。

**处置**：FR-018 从本轮 tasks.md 中移除，不生成对应任务。checklist.md 第 37 行"检查 plan.md 是否记录移除理由"——本节即为该记录。

---

## 6. 风险与回滚

| 批次/改动点 | 最大风险 | 回滚粒度 |
|---|---|---|
| **C1-A 模块迁移（批 1）** | **最高风险点**——§1.2 的转发壳陷阱若漏做，`sync-worktree-local-state.sh` 的 graph bootstrap 会全链路静默空转（不报错但不生效），F239 已 ship 的 worktree 自举行为回归，且**没有测试会红**（除非按本 plan §2 批 1 表格新增的针对性回归断言，尤其 `graph-bootstrap-status-shim.test.mjs`）。RG 系列（RG-001/003/004/006/007）全部间接盯防此处（若 freshness 判定链路损坏，`graph-quality` 族与 `worktree-local-state` 族的 repo:check 会连带感知） | `git revert` 该次迁移 commit（迁移作为独立原子提交，不与其他批 1 改动混提），仓根文件与插件侧文件同一提交内互为镜像变更，revert 后回到迁移前的双份实现真空态（回到 V-1 记录的"不可同时满足"状态，仅用于紧急回滚，不作为稳定态） |
| **双事件审计模型（批 1，P-C1 修订）** | `decide` 非 dry-run 时无条件落 `kind:"decision"` 事件，FR-010 硬约束已独立满足，不再依赖调用方是否记得调 `annotate-caveat`。残余风险收窄为：调用方拿到 `outcome:"consume-impact"` 后若遗漏调用 `annotate-caveat`，产生的是**可观测的 pending 态**（存在 `decision` 事件但无回链的 `caveat-annotation` 事件），不是静默漏记——可被 `ledger-verify.mjs` 或未来的审计巡检脚本按 `decisionId` 反查发现。跨快照拼接风险由 `graphSourceCommit` 校验 + `snapshot-mismatch` 判定收口（不再是静默拼接） | 该合同仍写入 SKILL.md 散文与 goal_loop 编排注释（§1.4/§3）作为最佳实践；即便合同被违反，双事件模型保证审计完整性不受影响（`decision` 事件已独立落盘），修复只需补跑一次巡检脚本定位 pending 态，不涉及决策核心逻辑改动 |
| **no-hit 记录三处挂点（批 2）** | 挂点若误放进请求路径的同步关键区（而非"结果已算出、返回前"的旁路位置），可能拖慢 `kb_search`/`kb_api_lookup` 响应或在写入失败时污染主链路——RG-009 专门盯防此风险 | 三处挂点均为独立 `try { recordNoHit(...) } catch { /* 静默 */ }` 式旁路调用（EC-20 已定义静默降级契约），单独 revert 某一处挂点不影响另外两处与主检索逻辑 |
| **kb_status 字段扩展（批 3）** | `kb-contract.test.ts` 快照断言若被误改（放宽而非新增），会让 RG-005 名义上通过但实质放宽了既有契约——checklist.md 第 60 行已专门列此项人工核对 | 字段扩展是纯 additive 改动（`payload['kb_status'] = ...`），revert 只需删除该行赋值与对应新增断言，不影响其余响应组装逻辑 |
| **FR-018 删除（跨批）** | 无实现风险（不做即不会破坏现状）；唯一风险是"用户后续反悔要求实现"——OQ-3 式登记，非阻塞 | 不涉及回滚，属于范围决策记录 |
| **lockfile 解析器大文件保护（批 3）** | EC-28 大文件保护若阈值设置不当（过小误伤正常大型 monorepo lockfile，过大失去保护意义），需要一个合理默认值 `[推断]`——建议 32MB（真实 `package-lock.json` 极端案例通常 <10MB，32MB 留 3 倍余量），非 F239 的 256MB（那是图 JSON 的量级，量级语义不同） | 纯常量调整，无结构性回滚成本 |

---

## 7. 与 F240 的软冲突面

F240（并行 worktree，M9 轨道 A "Codex First-Class"）按任务描述聚焦 `.codex-plugin` 一体分发、`spec-driver-refactor` wrapper、hooks Codex payload E2E、`CODEX_HOME` 路径尊重。本 feature 与其潜在文件级交集：

1. **`plugins/spec-driver/skills/spec-driver-feature/SKILL.md`**（本 feature §3 的两处新增段落）——F240 若也在改写该文件的散文（例如 Codex 专属分派分支、或 hooks 触发点说明），存在段落级冲突风险。**本 feature 的改动位置明确锚定在"执行模式"通用循环的第 4/5 步之间与"goal_loop 闭环编排"步骤 2/4 附近**，与"Codex 一等支持"通常关注的"分派策略/agent runtime 选择"逻辑（现行 `:224-239` 附近）在物理行区间上邻近但语义不同——存在 diff context 重叠导致 rebase 冲突（而非语义冲突）的可能性较高。**冲突面因 wrapper 再生而扩大（V-8/P-W7）**：canonical 改动会连带再生 `plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md` 与 `.codex/skills/spec-driver-feature/SKILL.md` 两个生成 wrapper（§3.3），若 F240 也改写同一份 canonical SKILL.md（大概率，因其正是 Codex 分发主题），rebase 冲突面从 1 个文件扩为 3 个文件（canonical + 2 个 wrapper）。处置顺序固定：先解 canonical 的散文冲突，再统一跑 `npm run repo:sync` 重新生成两个 wrapper（禁止手工 diff-merge 生成文件本体，见 §3.3）。
2. **`tests/unit/worktree-lifecycle-hook.test.ts`**——本 feature §1.3 必改此文件（`REAL_STATUS_HELPER` 常量）。F240 的"hooks Codex payload E2E"若也涉及 `worktree-lifecycle.sh` hook 或其测试文件，存在直接文件级冲突。
3. **`plugins/spec-driver/scripts/lib/ensure-gitignore.sh`**（P-W6 修正路径：非仓根 `scripts/lib/`，该路径不存在）——本 feature FR-024 在此新增两条 gitignore 条目（`.specify/kb-nohit/`、`.specify/graph-consumption-audit.jsonl`），同步更新 `plugins/spec-driver/tests/ensure-gitignore.test.mjs`（4→6 条断言，见 §2 批 1/批 2 表格）。F240 若涉及 Codex 专属路径的 gitignore 自举（如 `CODEX_HOME` 相关本地态），同样会改这个数组常量区块与其测试文件，存在数组条目顺序/邻近行冲突的可能。
4. **`docs/shared/` 与 wrapper 同步链**——本 feature 未直接改 `docs/shared/*.md` 源文件（§3 的改动全部落在 SKILL.md 正文的"goal_loop 闭环编排"这类**feature 专属**小节，不属于 `npm run docs:sync:agents` 生成区块），因此与 F240 若同样只改 skill 正文的场景下**不经过共享片段同步链**，冲突面局限于直接文件 diff + §3.3 描述的 wrapper 再生链，不会通过 `docs:sync:agents` 传导放大。

**处置建议**：延续既定约定——后 ship 的一方 `git rebase master` 后针对 (1)(2)(3) 三个文件**及其 wrapper/测试衍生物**（canonical SKILL.md 的两个生成 wrapper、`ensure-gitignore.test.mjs`）重新跑一次该 feature 自身的门禁（尤其 `worktree-lifecycle-hook.test.ts` 与 `graph-bootstrap-status-shim.test.mjs`），不假设"文本 diff 无冲突 = 语义无冲突"；wrapper 文件的冲突一律按 §3.3 的"先合 canonical 再 repo:sync 再生"处理，不手工解。

---

## Constitution Check（简要）

| 原则 | 评估 |
|---|---|
| I 双语文档规范 | 本 plan 与后续制品均遵循；代码标识符英文，散文中文 |
| II Spec-Driven Development | 本 feature 全程走 spec→plan→tasks→implement→verify，无直接改源码 |
| III YAGNI | §5 FR-018 删除、§1.1 拒绝新增 `spectra impact` CLI 子命令（改用两步协议复用既有 MCP 消费方式）均是本原则的直接应用；D1（不建增量建图引擎）已在 spec 层落实 |
| IV 诚实标注不确定性 | 本 plan 中 `[推断]` 标注：phase 起点 ref 获取方式（§3.1）、`activityAt` 逐行/全库聚合口径（§1.6）、`kb_status` 字段命名（§1.6）、大文件保护阈值 32MB（§6） |
| V AST 精确性优先 / VI 混合分析流水线 | 不适用——本 feature 不改动 Spectra 的 AST 抽取/生成流水线本体 |

无 VIOLATION。

---

## 附：本次 plan 阶段的 Spectra MCP 使用记录（dogfooding 台账）

| # | Target | 工具 | 结果 |
|---|---|---|---|
| 1 | `src/kb-mcp/tools/kb-search.ts::executeKbSearch` | `impact`（upstream, depth=2） | miss：`directCallers:0`，`affected:[]`——**实证复现 spec 文档记录的 O-3 缺陷**（inline arrow callback 调用未被抽取），第一手验证了 D7/FR-006 caveat 机制要处理的正是这个真实存在的现象，而非假设 |
| 2 | `plugins/spec-driver/scripts/lib/goal-loop-core.mjs::interpretImpactResult` | `context` | miss：`symbol-not-found`，`fuzzyMatches:[]`——**实证复现 O-5 缺陷**（`.mjs` 文件整体不在图 walker 白名单内），印证 D6"`.mjs` 部分 pilot 命中率结构性封顶为 0"的判断有直接证据支撑，不是外推 |
| 3 | `src/scaffold-kb/search-core.ts::searchKbCore` | `impact`（upstream, depth=2） | hit：`directCallers:2`（`kb-search.ts::executeKbSearch`、`recall-eval.ts::computeRecall`）——但经 Read 逐行核实源码后发现**实际直接调用方有 4 处**（另两处：`scaffold-kb.ts::runQuery`、`kb-api-lookup.ts::documentFallback`），图漏报了后两处。这是一个**非零但仍偏低的 undercount**，不同于 O-3 那种"恰好为零"的案例——**值得记录的补充发现**：FR-006 的 caveat 触发条件是 `directCallers === 0`，这类"非零但仍不完整"的漏报不会触发 caveat，是当前 caveat 设计覆盖不到的更宽一类缺口，已明确不在本 feature 处置范围（Non-Goals 第 5 条与 D7 只承诺处理已登记的两类已知形态），但建议记入 pilot 报告的"口径缺陷"一节供 M10 参考 |

三次调用全部命中"caller 分析/影响面评估"场景，按工具优先规则应使用 MCP 而非 Grep——已照做。第 3 条发现的图漏报现象未见于 spec 既有文档，属本次 plan 阶段的增量事实，已在 §6 风险表之外单独记录（不阻塞 plan 交付，但建议 tasks.md 或 pilot 报告引用）。
