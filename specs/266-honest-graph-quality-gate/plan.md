# Implementation Plan: 空图/退化图 fail-loud 链 + MCP 返回面诚实化

**Feature**: F266 (M10 P0-C) | **Branch**: `claude/honest-graph-quality-gate-2e3add` | **Mode**: story
**Spec**: `specs/266-honest-graph-quality-gate/spec.md`（14 FR，已过 GATE_DESIGN）
**SSoT**: `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §4 P0-C
**Created**: 2026-08-30

---

## Summary

本卡把五处「静默失败 / 用确定性口吻掩盖不确定性」的缺陷收口成 fail-loud 或诚实标注：

| SSoT | 缺陷 | 本卡动作 | FR |
|------|------|---------|-----|
| (a) | 非 src 布局 → 模块图静默 0 模块、零 warning | 模块派生环节加**可区分判据**的 `logger.warn` | FR-001/002 |
| (b) | post-commit hook 跑 `spectra graph`（不解析源码）把好图覆写成贫图 | hook 换 `batch --mode graph-only` + `graph` 命令加**信息量不减守卫** + 四处文案纠偏 | FR-003/004/005 |
| (c) | `nodes:[]/links:[]` 空图被 `graph-quality` 判 pass | 新增 `empty-graph` reason，走既有 `cannot-assess` 通道（自动继承 exit 2） | FR-006/007/008 |
| (d) | MCP 三工具「无已知调用方」不区分成因 | 新增追加式 `honesty` envelope（resolution + coverage + freshness） | FR-009/010/011/013 |
| (e) | `detect_changes` 三点记法口径未声明 | `honesty.comparisonScope` 显式声明 | FR-012 |

**关键架构裁决：本卡不改 graph producer**——不新增/修改 graph.json 的任何字段，只做消费侧的诚实标注。由此 byte-stable（FR-014）、F249 指纹、F254 自述面天然不受影响，`SC-006` 退化为回归护栏而非风险项。代价是 FR-009 的成因②不可单独产出（见 Q1）。

---

## Technical Context

- **语言/运行时**：TypeScript 5.x / Node.js 20+（ESM）；门禁消费侧为 `.mjs`
- **新增运行时依赖**：0（宪法 X）
- **本卡最重要的复用面**（都是主线程事实核实之外、本规划新查到的，直接决定了架构形态）：
  - **`evaluateFreshness(recordedSourceCommit, projectRoot, recordedFingerprint?) → GraphFreshnessVerdict`**（`src/panoramic/graph/source-commit.ts:200`）——F249 已建成的**完整** freshness 判定器：内部已做 `git rev-parse HEAD`、`git status --porcelain`（带 64MB buffer 上限 + ENOBUFS 保守判 dirty）、`DIRTY_SOURCE_SURFACES` 源码面过滤、指纹比对。**MCP 侧不得另写一套 git 探测逻辑。**
  - `GraphFreshnessVerdict`（`src/panoramic/graph/quality/quality-types.ts:98`）四态 `fresh | dirty | stale | unknown-provenance` + `staleReasons`（四值）——**已经覆盖了 spec 成因④的全部语义**（含"工作树脏"= `dirty` 态）。
  - `buildCannotAssessReport` / `exitCodeFor` / `describeBuilderStamp`（`src/cli/commands/graph-quality.ts`）
  - `getCachedGraphData`（`src/mcp/graph-tools.ts`，含 mtime/size stale 检测）
  - `parseGraphBuilderStamp` / `getBuilderStamp`（`src/panoramic/graph/builder-stamp.js`）
  - `tests/helpers/freshness-stale-scenarios.ts`（F249 建立的 stale 场景**单一定义**）
  - `module-derivation.ts` 既有 `logger.warn` 通道；hook 段落 `# --- spectra begin/end ---` 幂等替换机制
- **存储/产物**：无新增持久化；graph.json 只读不写
- **测试**：vitest（`tests/unit/**`、`tests/integration/**`、`tests/fixtures/**`、`tests/helpers/**`）

### NEEDS CLARIFICATION（均为字面值，不影响架构选型，tasks 阶段第一步现场核实）

- **R-1**：指定源码范围的**确切 CLI 开关/配置键名**（FR-001 warn 文案要引导用户）。`buildModuleGraphForProject` 的 `options.includeOnly` 是否有对应的 CLI flag / `spectra.config` 键？若无对外入口，warn 文案只能说明"默认只扫 `src/`"而不能给出可执行的开关——**这本身是需要如实说明的能力边界，不得杜撰一个不存在的 flag**。
- **R-2**：git hook 安装命令的确切名称（用于文案「重新运行 X 以更新已安装的 hook」）。

---

## Codebase Reality Check

目标文件实测（LOC = `rg '^'` 计数，含空行）：

| 文件 | LOC | 本卡预计新增 | TODO/FIXME/HACK | 触发前置 cleanup？ |
|------|-----|------------|----------------|------------------|
| `src/knowledge-graph/module-derivation.ts` | 507 | ~25 | 0 | 否（LOC>500 但新增 <50） |
| `src/hooks/git-hook-installer.ts` | 156 | ~10 | 0 | 否 |
| `src/cli/commands/graph.ts` | 217 | ~35 | 0 | 否 |
| `src/cli/commands/graph-quality.ts` | 885 | ~20 | 0 | 否（LOC>500 但新增 <50） |
| `src/mcp/agent-context-tools.ts` | 977 | **≤45（硬约束，见下）** | 0 | 否（有条件） |
| `src/mcp/lib/response-helpers.ts` | 147 | ~60 | 0 | 否 |

**目标文件零 TODO/FIXME/HACK、零 >200 行超长函数迹象、无发现的重复逻辑块** → 无条件触发前置 cleanup 的项。

**但 `agent-context-tools.ts` (977 LOC) 逼近阈值，转化为一条设计约束（非 cleanup task）**：三个工具的装配代码每处 ≤10 行（`const honesty = buildHonestyAnnotation(...)` + 挂载），**全部判定逻辑必须落在新模块 `src/mcp/lib/graph-honesty.ts`**。若实现中发现装配需要 >45 行，说明模块边界切错了，回来改边界而不是往 977 行文件里堆——这条写进 tasks 的验收。

---

## Impact Assessment

- **直接修改文件**：11（src 6 + 契约 1 + 门禁消费侧 1 + 文档 2 + 脚本 1）
- **新增文件**：4（1 个 src 模块 + 3 个测试/fixture）
- **间接受影响**：`tests/helpers/freshness-stale-scenarios.ts` 的 3 个消费方测试（见下方"最高风险项"）；`scripts/repo-check.mjs` 链路（经 `graph-quality-core.mjs`）
- **跨包影响**：**4 个顶层边界** — `src/`、`scripts/`（含 `scripts/lib/`）、`specs/217-*/contracts/`（JSON Schema 契约）、根 `README.md` + `docs/`
- **数据迁移**：无（不改 graph.json 格式、不改任何持久化 schema）
- **API/契约变更**：**有两处**
  1. MCP envelope 追加 `honesty`（追加式，FR-013）
  2. `graph-quality-report.schema.json` 的 `cannotAssessReason` enum 追加 `empty-graph`（追加式，旧报告仍合法）
- **风险等级：HIGH**（判定依据：跨包影响 4 > 2，且修改公共 API 契约 2 处 —— 命中 HIGH 规则的两条独立条件；影响文件数 15 本身只到 MEDIUM）

### HIGH 风险 ⇒ 强制分阶段（每阶段独立可验证、可独立回滚）

| Phase | 范围 | 验证点（通过才进下一阶段） |
|-------|------|------------------------|
| **P1 · 门禁面 fail-loud** | FR-006/007/008：`graph-quality` 空图收口 + schema enum + `graph-quality-core.mjs` 消费侧 + 共享 fixture helper 改造 | 空图 fixture → 非 pass + exit 2；既有正常图报告**逐字段**与改动前一致；`tests/unit/graph-quality-*`、`tests/integration/graph-quality-*`、`tests/unit/contracts/*` 全绿；`npm run repo:check` 零失败 |
| **P2 · 建图面 fail-loud** | FR-001/002/003/004/005：module-derivation warn + `graph` 命令信息量守卫 + hook 段落 + 四处文案 | 非 src 布局临时工程跑全量 batch 见 warn；src 布局工程**零新增噪声**；graph-only 路径断言 warn 未触发；贫图覆写被拒且提示可执行；文案人工审阅 |
| **P3 · MCP 诚实返回面** | FR-009/010/011/012/013：`graph-honesty.ts` + 三工具装配 + nextStepHint 改写 | 四状态（+组合态）可判读；外部语料 A/B 证明既有结果集零变化；byte-stable 双跑 sha 一致 |

阶段间无代码依赖（三块互不相交），但**顺序不可换**：P1 先落地是因为它同时改共享 fixture helper，越早暴露连带影响越好；P3 最后是因为它是唯一需要外部语料 A/B 的一块。

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|-------|------|------|
| III · YAGNI | 适用 | **PASS** | 新增字段逐个有当前使用场景：`resolution`/`coverage` 供 agent 判断零结果可信度、`freshness` 复用既有 verdict 对象、`comparisonScope` 对应 FR-012。**主动砍掉**：不设 `advisory: true` 常量字段（语义写进契约文档即可）、不加阈值配置项、不为 `graph` 守卫加"百分比容忍度"。 |
| IV · 诚实标注 | 适用 | **PASS（含一处明示降级）** | Q1 结论：成因②「解析缺口」在本卡**不产出**，因其证据未被持久化；合并态字段显式带 `separable: false` + `evidenceScope`，不填假值。此偏差已在 Q1 中标注为需主线程确认的 spec 偏差。 |
| X · 零新增依赖 | 适用 | **PASS** | 0 新增 runtime dependency。 |
| XIII · 向后兼容 | 适用 | **PASS** | MCP envelope 纯追加；schema enum 纯追加（旧值全保留）；hook 只影响**新安装**产物，不追溯改写用户 `.git/hooks/` 既有文件。 |
| 裁决 1（builder 戳只可见不判定） | 适用 | **PASS** | `graph-quality` 侧本卡新增路径**完全不读 builder 戳**（空图判定只看 `nodes/links` 长度），结构上不可能翻转退出码；MCP 侧 `builderMismatch` 是独立 advisory 字段，不参与 `resolution` 判定、不进 `staleReasons`。 |
| 裁决 2（相似度永不进 impact/context） | 适用 | **PASS** | 本卡不触碰结果集构造，只做标注。 |
| 不改写 F217/F249/F254/F193 既有行为 | 适用 | **PASS（有一处需说明）** | 六指标、指纹、自述面判据逻辑零改动。F193 `graph-format-stale` 是**错误路径**、本卡 freshness 是**成功路径 advisory**，两者不合并、不互相降级。**唯一的既有资产改动**是 `tests/helpers/freshness-stale-scenarios.ts` 的 `baseFreshnessGraph()` 样本（见最高风险项），属测试资产而非生产行为。 |

**无 VIOLATION**；唯一需主线程确认的是 Q1 的 spec 偏差（FR-009 四分 → 三分 + 一个合并态）。

---

## 核心问题裁决（Q1–Q10）

### Q1 · ②解析缺口 与 ③外部边界 能否分离 → **选方案 B（诚实降级）**

**结论：本卡不产出成因②「解析缺口」这一独立类别。** 理由链：

1. **③可以正实证**：`component.metadata.exportKind` 已持久化 → 一个被导出的 symbol 天然存在图覆盖范围外的潜在消费者（其他包 / node_modules 消费方 / 未建图语言）。再叠加 `graph.skippedSources`（数据源级缺席）与 `metadata.external === true` 节点。**③ 有 symbol 粒度的正面证据。**
2. **②没有任何正实证来源**：`import-resolver.ts:176` 的 `kind:'unresolved'`、`{java,go}-mapper.ts` 的 `calleeKind:'unresolved'` 只存在于抽取期，**未持久化进 graph.json 的任何字段**。`graph.skippedSources` 是**数据源级** provenance（`{source:'doc-graph', reason:'未提供…'}`），不是文件级解析失败，按主线程明示不得挪用。
3. **唯一可得的缺口量是"混合量"**：`sum(module.metadata.callSitesCount) = 126411` vs `calls` 边 `3996` → 122415 个 call site 未成边。**但这个差值天然混合了两类**：真正的解析/链接失败（②）**和**合法的图外调用（③，如 `console.log`、宿主 API、第三方包方法）。把整个差值标成②是**造假**（宪法 IV 直接违反）；把它标成③则丢失②的信息。
4. 因此：**发布该差值时必须显式标注它不可拆分**，而不是二选一硬贴标签。

**方案 A（producer 侧持久化 `unresolvedCallSites`）被否的理由**（不是因为难，是因为边界错）：
- 证据源在 extraction / query-mapper 层，要一路 plumb 到 graph-builder，是**多跳 producer 改动**；
- 改 graph.json 内容 → 改 fingerprint → **全部存量图变 stale**，还要单独裁决 BEHAVIOR_VERSION 是否 bump；
- 需要 producer 侧的外部语料 A/B（比本卡消费侧 A/B 重一个量级）；
- 它与 M10 **P1「诚实工具面（边 stage 标签）」**是同一件事的两个说法——那张卡就是给边打来源/阶段标签。**在本卡做等于抢 P1 的活并把 P0-C 的风险面翻倍。**
- ⇒ **建议开后续卡**：「graph producer 侧持久化 call-site 归因（unresolved / external / linked 三分）」，挂 M10 P1 诚实工具面。届时本卡的 `coverage.separable` 从 `false` 翻 `true`、`resolution` 才真正补齐成因②——**字段形状现在就为此留好了，不需要破坏性改动**（`separable` 从 false→true 是取值变化，非契约变化）。

**FR-009 偏差声明（需主线程确认）**：spec FR-009 要求区分四种成因。本卡实际交付 **①confirmed-zero / ③boundary-exposed / ②③合并态 coverage-gap** 三类互斥 resolution + **④freshness 正交并行**。成因②不单独可判这一事实**在返回体里显式声明**（`coverage.separable: false` + `detail` 文案），不静默吞掉。

### Q1 附带的重大后果（必须写进 tasks 验收，不得回避）

在本仓当前图上 `unlinkedCallSites` 恒 > 0（缺口 96.8%），因此 `confirmed-zero` 在真实图上**几乎不可达**。这不是 bug，是真实覆盖率被第一次如实暴露。两点处置：
- 字段层**不做分档**（不设阈值，避免任意阈值造假），恒带 `linkageRatio` 数值；
- 文案层**按量级分档**：`linkageRatio` 极低 → "图的调用边覆盖率仅 X%，零调用方结论不可采信"；接近 1 → "尚有 N 个 call site 未成边，零调用方基本可信但非确证"。

### Q2 · 字段契约

三工具**共用同一子结构**（理由：一处定义、一处测试、消费方只需学一个形状；三份并行定义必然漂移）。挂载点为各工具 `data` 下的**单一新键 `honesty`**（单点追加 → FR-013 的兼容面最小、回滚只需删一个键）。

```ts
// src/mcp/lib/graph-honesty.ts

/** 零结果/无调用方的成因（①③ + ②③合并态），三者互斥 */
export type ResolutionReason =
  /** ①：图内无缺口且该 symbol 无对外暴露面 —— 可判为确认为零 */
  | 'confirmed-zero'
  /** ③：symbol 有导出面 / 存在 external 节点 / 有 skippedSources —— 图外可能存在结果 */
  | 'boundary-exposed'
  /** ②③合并态：图中存在已探测但未成边的 call site，本版本无法区分"解析失败"与"合法图外调用" */
  | 'coverage-gap';

export interface ResolutionVerdict {
  reason: ResolutionReason;
  /** 该判定所依据证据的粒度 —— 诚实标注，禁止让 graph 级证据冒充 symbol 级 */
  evidenceScope: 'symbol' | 'graph';
  /** 中文说明，含具体证据（如导出面来源 / 缺口数量） */
  detail: string;
}

/** ②③合并缺口的量化。仅当图中存在未成边 call site 时出现 */
export interface CoverageGap {
  callSitesDetected: number;   // Σ module.metadata.callSitesCount
  callEdgesLinked: number;     // relation === 'calls' 的边数
  unlinkedCallSites: number;   // 前两者之差（下限截 0）
  linkageRatio: number;        // callEdgesLinked / callSitesDetected，四位定点
  /** 恒为 false：本版本无法把缺口拆成"解析缺口"与"合法图外调用"（见 plan Q1） */
  separable: false;
  /** 图覆盖边界的补充证据 */
  skippedSources: Array<{ source: string; reason: string }>;
}

export interface GraphHonesty {
  /** 仅在结果集为空 / 无调用方时出现；非空结果不附加（避免噪声） */
  resolution?: ResolutionVerdict;
  /** 仅当 unlinkedCallSites > 0 时出现 */
  coverage?: CoverageGap;
  /** ④，与 resolution 正交，三工具恒带 */
  freshness: GraphFreshnessAdvisory;
  /** 仅 detect_changes 且走 baseRef 比较模式时出现（FR-012） */
  comparisonScope?: ComparisonScopeDeclaration;
}

export interface GraphFreshnessAdvisory {
  /** 直接内嵌 F249 既有判定结果，不重新发明（fresh|dirty|stale|unknown-provenance + staleReasons） */
  verdict: GraphFreshnessVerdict;
  /**
   * 裁决 1：builder 戳只可见不判定。
   * 独立字段、不进 verdict.staleReasons、不影响工具成功/失败状态。
   * null = 无法判定（图未记录 builder 戳 / 当前构建戳不可得）
   */
  builderMismatch: boolean | null;
  /** builderMismatch 的人读说明，复用 describeBuilderStamp 语汇 */
  builderDetail: string | null;
}

export interface ComparisonScopeDeclaration {
  /** 三点记法 `<base>...HEAD` 只比两个已提交状态 */
  notation: 'three-dot';
  gitRange: string;              // 如 "765a9608...HEAD"
  /** 恒 false —— 这就是 FR-012 要声明的那件事 */
  includesUncommitted: false;
  /** 工作树是否另有未纳入本次比较的改动；取自 freshness.verdict.state === 'dirty'，不额外 spawn git */
  uncommittedChangesPresent: boolean | null;
  detail: string;
}
```

**resolution 判定优先级（互斥、确定性、无歧义）**：

```
1. symbol 级证据优先：该 symbol 有导出面 / 命中 external 节点  → 'boundary-exposed' (evidenceScope: 'symbol')
2. 否则 图级缺口存在：unlinkedCallSites > 0 或 skippedSources 非空 → 'coverage-gap' (evidenceScope: 'graph')
3. 否则                                                        → 'confirmed-zero' (evidenceScope: 'symbol')
```

为什么 symbol 级证据优先于 graph 级：**更强的证据（可归因到被查对象本身）优先，且更可操作**；同时 `coverage` 数值恒随行，②③的缺口信息**不因优先级而丢失**。若反过来让 graph 级缺口吃掉一切，`boundary-exposed` 在真实图上永远不可达 → 沦为死枚举（YAGNI 违反）。

### Q3 · 计算落点 → **新建 `src/mcp/lib/graph-honesty.ts`**

不并入 `response-helpers.ts`，理由是职责与 I/O 面不同：
- `response-helpers.ts` 是**纯文案/信封整形**模块（147 LOC，零 I/O），`generateNextStepHint` 是纯函数 —— 把 git spawn + 缓存塞进去会毁掉它的可测性与纯度；
- `graph-honesty.ts` 承担**事实计算**：读 graph metadata、调 `evaluateFreshness`（内含 git I/O）、维护探测缓存；
- 三层边界固定为：**`graph-honesty.ts` 算事实 → `response-helpers.ts` 生成文案（入参是 `GraphHonesty` 对象）→ `agent-context-tools.ts` 装配**。`response-helpers.ts` 只**新增入参**、不新增 I/O，`generateNextStepHint` 保持纯函数（FR-010 的测试因此可以是零 mock 的表驱动用例）。

### Q4 · dirty 判定成本 → **零新增 git 逻辑 + 惰性 + 带失效的缓存**

1. **不自己 spawn git**。`evaluateFreshness()` 已经把 `git rev-parse HEAD` + `git status --porcelain` + 源码面过滤 + ENOBUFS 保守判 dirty 全部做完了。重写一遍既是重复逻辑，又会与门禁面的判据分叉（两套 dirty 定义 = 未来的假信号源）。
2. **缓存**：`graph-honesty.ts` 内 module 级 `Map<projectRoot, { verdict, graphMtimeMs, graphSize, at }>`。命中条件三者同时成立：同 `projectRoot`、graph 文件 mtime+size 未变（**与 `getCachedGraphData` 完全相同的失效判据，两者同源不分叉**）、`Date.now() - at < FRESHNESS_TTL_MS`（初值 2000）。
3. **TTL 的诚实边界**：TTL 引入时间相关性，但**只作用于 MCP 响应体，不作用于 graph.json**，FR-014 byte-stable 不受影响。
4. **惰性不做**（评估后否决）：曾考虑"只在零结果时才算 freshness"，但 FR-011 要求三工具**恒带** advisory（非零结果的图同样可能陈旧），且加了缓存后每次调用摊薄成本已接近 0。**用缓存换惰性，比用惰性换正确性划算。**
5. **可测性**：`buildHonestyAnnotation` 接受可选注入 `{ evaluateFreshnessFn, now }` 的 seam，单测零 git spawn、零真实时钟。
6. **验收**：单测断言 —— TTL 窗口内连续 10 次调用，注入的 `evaluateFreshnessFn` 只被调用 1 次；graph 文件 mtime 变化后立即再调用 → 被调用第 2 次。

### Q5 · graph-quality 空图收口 → 新增 `empty-graph` reason；**`validateGraphJsonShape` 不改**

- **不改 `validateGraphJsonShape`**：它是 type guard，职责是"结构是否合法"。空图**结构上完全合法**，把内容退化判进 shape 校验会（a）混淆两个不同概念，（b）让 `parsed` 的类型收窄语义变得不可信（"通过 guard"从此不再等价于"结构合法"），（c）连带影响所有依赖该 guard 的分支。
- **改法**：在 `runGraphQualityCommand` 中、shape 校验与 schemaVersion 比较**之后**、`buildReport` **之前**插入内容退化闸：
  ```
  graph-missing → json-parse-error → schema-too-old / schema-newer-than-supported → 【新】empty-graph → buildReport(六指标)
  ```
  命中即 `return buildCannotAssessReport(graphPath, 'empty-graph', [引导重建的 nextSteps])`。放在 schema 判定之后：schema 不兼容是更根本的失败，不该被"顺便还空"遮盖。
- **判据严格限定 `nodes.length === 0 && links.length === 0`**。`nodes` 非空但 `links` 空**不算**（那是孤儿率问题，F217 六指标已覆盖）——不扩大判据、不与既有指标抢职责。
- **裁决 1 合规是结构性的**：该分支只读 `nodes/links` 长度，**代码路径上不接触 builder 戳**，因此不存在"戳导致退出码翻转"的可能。`describeBuilderStamp` 的可见性输出保持不变。
- **`exitCodeFor` 零改动**（`cannot-assess` → 2 已存在）。
- **必须同步的三处**：
  1. `graph-quality.ts` 的 `cannotAssessReason` 联合类型追加 `'empty-graph'`
  2. `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` 的 enum 追加
  3. `scripts/lib/graph-quality-core.mjs` 消费侧 —— **tasks 第一步须核实它是否枚举 reason 值**：若只按 `overallVerdict === 'cannot-assess'` 映射 warn（`:187` 附近的既有行为），则**无需改动**，新 reason 自动继承 warn；若存在 reason 白名单则必须补。**不得凭假设跳过这一核实**（本仓历史上"判据写成值枚举 = 每加一个值漏一次"已有 F259 前车之鉴）。

### Q6 · module-derivation 出声 → `logger.warn` + 两计数判据

- **判据（区分"扫到但全被滤掉" vs "本来就没文件"）**：在 `:379` 的过滤循环里维护
  - `scannedCandidateCount`：通过扩展名等基础过滤、进入 `includeOnlyRe` 判断的候选文件数
  - `includedCount`：通过 `includeOnlyRe` 的数
  - **仅当 `scannedCandidateCount > 0 && includedCount === 0` 才 warn。** 空工程（`scannedCandidateCount === 0`）不 warn —— 那是"本来就没东西"，报警是噪声。
- **载体**：复用该文件既有 `logger.warn`（scanFiles 失败回退处已有先例），不新增 channel、不改函数返回类型、不抛异常。选 warn 而非 error 的理由：`buildModuleGraphForProject` 是建图子环节，抛错会把"模块层缺失"升级成"整个 batch 失败"，超出 FR-001 的诉求（FR-001 只要求"可观测"）。
- **文案含**：扫描根、生效的 `includeOnly` 正则字面量、被滤掉的候选数、**≤3 条样例路径**（便于用户一眼认出自己的布局）、如何指定源码范围的引导（依赖 R-1；**若核实无对外开关，则如实写"当前默认只扫 `src/`，本项目源码不在该目录下"，不杜撰 flag**）。
- **默认过滤器 `/^src\//` 本卡不改**：只加可观测性，不动行为 —— 改默认值是行为变更，会影响所有既有项目，超出本卡范围且与 FR-008 式的零回归精神冲突。
- **FR-002 护栏**：graph-only 不经 `selectPrimaryModuleGraph`/模块派生（主线程已核实），因此天然不受影响；但"天然成立"不等于"被守护"——**加一条测试断言：graph-only 路径跑完，注入的 logger 上 warn 零调用**，把这个隐性前提固化成显性回归网。
- **src 布局零噪声**：`includedCount > 0` 即不 warn，正常项目一条都不多。

### Q7 · post-commit 替换 → **换命令 + 提超时 + 给 `graph` 命令加信息量守卫（双保险中的第二道是必需的，不是空转）**

1. **hook 段落改为 `spectra batch --mode graph-only`**（纯 AST / 零 LLM / 无需认证），超时从 30s 提到 **180s**。理由：`spectra graph` 只合并缓存 + 已生成 `.spec.md`，**根本不解析源码**，用它做"提交后刷新"从原理上就不可能正确；`graph-only` 才是文档承诺的那件事。
2. **超时矛盾的处理**：本仓 graph-only 实测 ~2.8s，180s 对绝大多数仓库有余量。被 kill 的场景下**不会留下半张图**（写盘走 atomic-write —— 本卡禁止触碰该文件，但可以依赖其既有保证）。kill 分支从 `>/dev/null 2>&1` 全静默改为：产物写日志文件 + 超时时向 stderr `echo` 一行简短提示（**不刷屏正常 commit 输出，但超时这件事不再完全不可见**）。
3. **仅改 hook 不够 → `graph` 命令必须加守卫**：用户手敲 `spectra graph` 仍会毁图，而 spec Constraints 4 明文把"`spectra graph` 自身的静默毁图"并入本卡（FR-003）。**守卫**：写盘前读取既有 graph.json 的 `nodeCount`/`edgeCount`，若 `新.nodeCount < 旧.nodeCount || 新.edgeCount < 旧.edgeCount` → **拒绝覆写 + 非零退出 + 明确提示改用 `spectra batch --mode graph-only`**。
   - 指标选择直接对齐 FR-003 明文（"节点数、边数等结构性计数指标"），**不引入任何语义化质量评分**（避免与 F217 六指标职责重叠）。
   - **阈值 = 严格不减，不设百分比容忍**（任意阈值就是新的造假面）。
   - 提供 `--force` 显式覆盖：有明确当前场景（用户主动重置/缩图），且不给逃生口会把用户堵死 —— 这是 YAGNI 的例外论证，不是预留的假设性开关。
   - 旧图不存在 / 无法读取 / 缺 `nodeCount` 字段 → **放行**（守卫不得把"没有基线"误判成"退化"）。
4. **幂等替换的影响**：段落用 `# --- spectra begin/end ---` 整段替换，旧安装在下次运行 hook 安装命令（R-2）时自动纠正；**不追溯改写用户 `.git/hooks/` 里的历史文件**（对齐 spec Edge Cases）。文案里需要告诉用户这一点。
5. **FR-005 边界**：`plugins/spectra/hooks/post-commit.sh` 零改动 —— tasks 里作为显式"禁止清单"项，并加一条测试/检查断言该文件内容未变。

### Q8 · 外部语料 A/B（SC-003）→ 双语料，各管一件事

| 语料 | 角色 | 比什么 |
|------|------|--------|
| **self-dogfood（本仓）** | 主 A/B：**不变性**证明 | 改动前后各跑 `spectra batch --mode graph-only`：① graph.json sha256 相等；② 对固定 symbol 清单（≥20 个，含高入度/零入度/导出/非导出各若干）跑 `impact`/`context`/`detect_changes`，比对 `affected`/`callers`/`callees`/`topImpacted` 集合**逐元素相等**，**唯一允许的 diff 是新增 `honesty` 键** |
| **`~/.spectra-baselines/karpathy/nanoGPT`（扁平 .py 布局，无 `src/`）** | 非 src 布局告警的**真实语料**验证（FR-001/SC-004） | 改动前静默 0 模块 → 改动后可见 warn；且 graph-only 路径同语料零 warn（FR-002） |

- **重算器脚本**：`scripts/verify-feature-266.mjs`（对齐仓内既有 `verify-feature-151/152/153.mjs` 命名惯例，**不新造 `scripts/verify/` 目录**）。
- **跑法**：`node scripts/verify-feature-266.mjs --target <path> --before <graph.json> --after <graph.json> --symbols <list.json>`；子命令 `--mode byte-stable` 见 Q9。
- **产物**：一次性 dump 落 `/tmp`，**不入库**；只有脚本入库（spec Constraints 9）。

### Q9 · byte-stable 验证（SC-006）

`scripts/verify-feature-266.mjs --mode byte-stable --target <path>`：同一 target **连续两次**跑 `spectra batch --mode graph-only`，每次跑完把 graph.json 拷到临时目录，比 sha256；不一致时**定位并打印首个差异的 JSON path**（而不是只报"不一致"——否则下次踩到还得从头查）。

本卡不改 producer，预期恒等，因此该项是**回归护栏**而非风险验证；但仍必须跑，因为"预期不改"和"实际没改"是两回事。

### Q10 · 测试策略与变更清单 → 见下两节

---

## 变更文件清单

### 新增（4）

| 路径 | 意图 |
|------|------|
| `src/mcp/lib/graph-honesty.ts` | resolution/coverage/freshness/comparisonScope 的**全部**判定逻辑 + 带失效缓存；三工具唯一事实源 |
| `tests/unit/mcp-graph-honesty.test.ts` | 判定优先级、缓存命中/失效、seam 注入下的四状态与组合态（零 git spawn） |
| `tests/fixtures/graph-quality-empty-graph.json` | `nodes:[]/links:[]` 且 `schemaVersion:"2.0"`（**不得用 "3.0"**，否则被 `schema-newer-than-supported` 掩盖真相） |
| `scripts/verify-feature-266.mjs` | SC-003 外部语料 A/B + SC-006 byte-stable 双跑重算器 |

### 修改 · P1 门禁面（4）

| 路径 | 意图 |
|------|------|
| `src/cli/commands/graph-quality.ts` | `cannotAssessReason` 联合类型加 `'empty-graph'`；`runGraphQualityCommand` 在 schema 判定后插入空图闸 |
| `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` | enum 追加 `empty-graph`（追加式） |
| `scripts/lib/graph-quality-core.mjs` | **先核实**是否枚举 reason；仅在存在白名单时补 `empty-graph` |
| `tests/helpers/freshness-stale-scenarios.ts` | ⚠️ `baseFreshnessGraph()` 当前返回 `nodes:[], links:[]` —— 必须改成**最小非空图**（1 module + 1 component + 1 `contains` 边，且 `nodeCount/edgeCount` 同步），否则 F249 的 freshness 用例会被新的空图闸整体短路 |

### 修改 · P2 建图面（5）

| 路径 | 意图 |
|------|------|
| `src/knowledge-graph/module-derivation.ts` | 两计数判据 + `logger.warn`（`:359-379` 区域） |
| `src/hooks/git-hook-installer.ts` | `generatePostCommitSegment()` 换 `batch --mode graph-only`、超时 30s→180s、kill 分支可见化 |
| `src/cli/commands/graph.ts` | 写盘前信息量不减守卫 + `--force` 逃生口 |
| `README.md` | `:158` 主文案；`:89` 需评估后决定是否同改 |
| `docs/spectra-cli-reference.md` | `:156`、`:204` 两处文案 |

### 修改 · P3 MCP 面（2）

| 路径 | 意图 |
|------|------|
| `src/mcp/lib/response-helpers.ts` | 三工具字段接口（`:21/:28/:36`）加 `honesty`；`generateNextStepHint`（`:84+`）改为按 `GraphHonesty` 出文案，改写 `:104`/`:115`/`:125` 三处误导句 |
| `src/mcp/agent-context-tools.ts` | impact(~`:253-292`) / context(~`:402-421`) / detect_changes(~`:653`) 各 ≤10 行装配；`:854` 的三点记法处产出 `comparisonScope` |

**显式禁止触碰**：`src/hooks/hook-installer.ts`、`src/utils/atomic-write.ts`（P0-D 专属）、`plugins/spectra/hooks/post-commit.sh`（FR-005）。

---

## 测试策略

| FR | 测试文件 | 关键断言 |
|----|---------|---------|
| FR-001 | `tests/unit/module-derivation-empty-scope-warning.test.ts`（新） | 扫到 5 个 `lib/*.ts`、`includeOnly` 命中 0 → warn 触发且含正则与样例路径；**扫到 0 个文件 → 不 warn**；src 布局 → 不 warn |
| FR-002 | 同上 | graph-only 路径 warn 调用次数 === 0 |
| FR-003 | `tests/unit/graph-command-degradation-guard.test.ts`（新） | 新图 node/edge 任一少于旧图 → 拒写 + 非零退出；`--force` 放行；旧图缺失/缺 `nodeCount` → 放行 |
| FR-004 | 人工审阅 + `tests/integration/` 既有文档一致性检查（若有） | 四处文案无 "incrementally rebuilds" 类措辞 |
| FR-005 | tasks 检查项 | `plugins/spectra/hooks/post-commit.sh` 内容未变 |
| FR-006 | `tests/unit/graph-quality-shape-validation.test.ts`（改）+ `tests/integration/graph-quality-cli.test.ts`（改） | 空图 fixture → `overallVerdict !== 'pass'`、`cannotAssessReason === 'empty-graph'`、exit 2；**空图 / 缺图 / 解析失败三者 reason 互不相同**（Edge Cases 明文） |
| FR-007 | `tests/unit/graph-quality-builder-advisory.test.ts`（改，已存在） | builder 戳不一致时退出码不翻转（既有断言保持绿即可） |
| FR-008 | `tests/integration/graph-quality-cli.test.ts` + `tests/unit/contracts/graph-quality-report-schema.test.ts` | 正常非空图报告**逐字段**与改动前一致；`--json` 过 schema 校验 |
| FR-009 | `tests/unit/mcp-graph-honesty.test.ts`（新） | 三 resolution 值各有构造用例；优先级唯一确定；**②③合并态带 `separable:false`**；`coverage` 与 `freshness` **同时呈现**（正交性） |
| FR-010 | 同上（`generateNextStepHint` 表驱动） | 每个 (resolution × freshness.state) 组合的文案含对应两层含义；`coverage-gap` + `stale` 组合下**同时**出现"解析未完成/覆盖不足"与"图已过期"；`linkageRatio` 分档文案正确 |
| FR-011 | `tests/integration/`（MCP envelope） | 附加 freshness 不改变工具成功状态；`builderMismatch` 不进 `staleReasons` |
| FR-012 | 同上 | `baseRef` 模式返回 `comparisonScope.includesUncommitted === false` + `gitRange` 字面量 |
| FR-013 | `tests/unit/mcp-graph-honesty.test.ts` + envelope 快照 | 既有字段名/语义零变化；忽略 `honesty` 的消费方行为不变 |
| FR-014 | `scripts/verify-feature-266.mjs --mode byte-stable` | 双跑 sha256 相等 |

**测试规范遵循**（`.claude/rules/tests.md`）：不使用 `any`；mock 对象标注类型；不共享可变状态（`graph-honesty.ts` 的 module 级缓存**必须导出 `__resetHonestyCache()` 供 `beforeEach` 清理**，否则用例间会经缓存串味）。

---

## 风险与回滚

| # | 风险 | 严重度 | 缓解 | 回滚 |
|---|------|-------|------|------|
| **R-A** | **`baseFreshnessGraph()` 是空图，新空图闸会连带短路 F249 的 freshness 测试族**（`graph-quality-cli.test.ts`、`graph-quality-report-schema.test.ts` 两个消费方） | **HIGH** | P1 阶段第一件事就是改该 helper 为最小非空图并**先跑一遍确认两个消费方仍绿**，再加空图闸 | 单点：还原 helper + 移除闸 |
| R-B | Q1 的偏差未被主线程接受（坚持要成因②） | 中 | plan 中已明写偏差与后续卡方案；**若主线程要求补②，本卡范围需扩到 producer 侧、风险等级与工期都要重估**，不应在 tasks 阶段悄悄加 | — |
| R-C | `confirmed-zero` 在真实图上几乎不可达，agent 体感"所有答案都变成不确定" | 中 | 文案按 `linkageRatio` 分档；`coverage` 数值恒随行让 agent 自行判断 | 文案层可独立调整，不动字段 |
| R-D | `graph` 命令守卫误拒合法缩图（用户删了大量代码后手敲 `spectra graph`） | 中 | `--force` 逃生口 + 提示文案指明正确路径；且 `spectra graph` 不解析源码，删代码本不影响其输入 | 移除守卫（单函数） |
| R-E | hook 超时 30s→180s，大仓 commit 后后台 CPU 占用时间变长 | 低 | 已是后台 `&`；这是"真实生效"的必要代价；超时可见化让用户能发现 | 还原段落（幂等替换，重装即回） |
| R-F | `scripts/lib/graph-quality-core.mjs` 若存在 reason 白名单而未同步 → 新 reason 静默漏判 | 中 | tasks 第一步**强制核实**（不得凭假设跳过）；加一条 core.mjs 单测覆盖 `empty-graph` 输入 | 补白名单 |
| R-G | MCP 每次调用的 git 探测成本 | 低 | 复用 `evaluateFreshness` + 双条件缓存（mtime/size 与 `getCachedGraphData` 同源）+ TTL；有调用次数断言兜底 | 关闭 freshness 挂载（单键） |

**整卡回滚粒度**：三个 Phase 相互不相交，可**逐 Phase 独立回滚**；MCP 面（P3）回滚只需摘掉 `honesty` 单键，对既有消费方零影响（FR-013 的追加式设计本身就是回滚保险）。

---

## Complexity Tracking

| 决策 | 更简单的方案 | 为何不选 |
|------|------------|---------|
| 新建 `graph-honesty.ts` 而非写进 `response-helpers.ts` | 直接改 147 行的 helper | 会把 git I/O + 缓存混进纯函数模块，毁掉 `generateNextStepHint` 的零 mock 可测性；且 `agent-context-tools.ts` 已 977 行，逻辑无处安放 |
| `graph` 命令加信息量守卫（而非只改 hook） | 只改 hook 段落 | 用户手敲 `spectra graph` 仍毁图；spec Constraints 4 明文把该命令并入本卡。**这不是"双保险空转"**——两者堵的是两条不同入口 |
| resolution 用"symbol 级证据优先"而非"缺口优先" | 缺口优先，实现更短 | 真实图缺口恒 >0 → `boundary-exposed` 沦为死枚举（YAGNI 违反），且丢掉更可操作的 symbol 级证据 |
| 缓存 + 恒带 freshness（而非惰性只在零结果时算） | 惰性，少写缓存 | FR-011 要求三工具恒带；缓存摊薄后成本接近 0。用缓存换惰性比用惰性换正确性划算 |
| 双语料 A/B（self-dogfood + nanoGPT） | 单语料 | 两者验的是不同命题（不变性 vs 非 src 告警真实触发），单语料覆盖不了 FR-001 的真实场景 |
