# Phase 1 数据模型：测试与守护资产实体设计

本 feature 不涉及数据库/运行时数据模型，此处的"实体"是 spec.md Key Entities 一节列出的测试/守护资产，在 plan 阶段补充具体的字段、状态枚举与文件坐标设计，供 tasks 阶段拆解为可执行任务。

## 1. qa 测试套件（① 处置对象）

| 字段 | 值 |
|---|---|
| 陈旧副本 | `src/panoramic/qa/__tests__/{citation,debt-context,graph-retriever,index,llm-caller,prompt-builder,qa-integration,rag-reranker}.test.ts`（8 文件，79 用例，10 条失败集中于 `qa-integration.test.ts` 的 `node:fs` mock 缺口）|
| 在维护副本 | `tests/panoramic/qa/{同名 8 文件}`（83 用例全绿，`vitest.config.ts` unit project include 命中 `tests/panoramic/**/*.test.ts`）|
| 迁移动作 | `debt-context.test.ts` 新增 2 条 it（"技术债关键词命中"+"架构问题不应匹配"）|
| 修正动作 | `index.test.ts` 第 190 行 `durationMs >= 0` → `durationMs > 0` |
| 不迁移项 | `llm-caller.test.ts` 独有的"应从项目配置读取模型 ID"一条（名不副实，属⑦ B7 类问题，不移植）|
| 处置后状态 | 陈旧副本目录不存在；在维护副本用例数 83→85 |

## 2. 零执行测试文件守卫（FR-011 新增实体）

| 字段 | 设计值 |
|---|---|
| 载体文件 | `tests/integration/zero-execution-test-file-guard.test.ts`（新增）|
| 磁盘侧扫描面 | 全仓 `**/*.test.ts`，排除 `node_modules`/`dist`/`.git` |
| vitest 收集侧事实源 | 子进程 `npx vitest list --filesOnly`（stdout 逐行解析 `(src\|tests)/.+\.test\.ts` 子串）|
| 差集断言 | `diskSet - vitestCollectedSet === whitelistPathSet`（严格集合相等，不允许子集/超集）|
| 白名单结构 | `{ path: string; reason: string }[]`，当前仅 1 条：`tests/fixtures/graph-quality-ts/greeter-service.test.ts`（TS/JS pinned graph fixture 的输入语料，非待执行测试）|
| 覆盖域边界 | 仅 vitest 域（`.test.ts`），不含 `plugins/**/*.test.mjs`（`npm run test:plugins` 独立 runner）|
| 变异验证方式 | 临时创建 `src/panoramic/qa/__zzz-mutation-probe.test.ts`（trivial it），确认守卫失败并列出该路径；删除后确认恢复通过 |

## 3. self-dogfood 快照块（② 处置对象）

| 字段 | 值 |
|---|---|
| 位置 | `tests/integration/graph-mcp-snapshot.test.ts` 第 211-262 行（`SELF_DOGFOOD_FIXTURE_PATH` 常量 → `describeIfSelfDogfoodFixture` 条件跳过 describe 块，含 2 个 it）|
| 依赖 fixture | `tests/integration/__fixtures__/self-dogfood-graph.json`（整个 `__fixtures__` 目录已在 `f9edd13f` 被删，静默跳过 3.7 个月）|
| 孤儿快照 | `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 第 343 行（`layer-b-self-dogfood-graph_god_nodes`）与第 414 行（`layer-b-self-dogfood-graph_query`）两个 export 块 |
| 覆盖面替代来源 | Layer B MVP `graph_god_nodes top=3` 测试（同文件第 200 行）+ `graph-quality-lang-matrix.test.ts` 四语言真实图测试 + `micrograd-baseline-graph`（33 节点/38 边，含 8 条 calls 边）|
| 处置后状态 | 条件跳过块与 helper 函数（`buildLayerBSelfDogfoodEngine`）整体删除；`.snap` 文件删除对应 2 个 export 块；全仓 grep `self-dogfood-graph_god_nodes`/`self-dogfood-graph_query` 无残留 |

## 4. 类型契约守护三件套（③ 处置对象）

| 守护资产 | 测试文件 | 专属 tsconfig | 覆盖内容 |
|---|---|---|---|
| F220 orchestrator 导出契约 | `tests/type-tests/f220-orchestrator-exports.typecheck.ts` | `f220.tsconfig.json` | `src/batch/batch-orchestrator.ts` 导出类型形状 |
| F222 llm-degraded 必填字段契约 | `tests/type-tests/f222-llm-degraded-required.typecheck.ts` | `f222.tsconfig.json` | `src/core/single-spec-orchestrator.ts` 相关类型必填字段 |
| F170c enrichment 可选字段契约 | `tests/type-tests/feature-170c-enrichment-optional.test-d.ts` | `tsconfig.json`（`tests/type-tests/` 默认）| `src/mcp/lib/response-helpers.ts` 相关类型可选字段 |
| 统一入口 | `npm run typecheck:tests`（三次 `tsc --noEmit`，本地实测 exit 0 / 2.39s）|
| CI 接线状态（处置后）| `.github/workflows/ci.yml` 新增 `Type Check Tests` 步骤，紧随 `Type Check` 之后 |

## 5. pinned graph fixture（④ 处置对象 + 新增陈旧检查）

| 字段 | TS/JS | Java | Go | Python（micrograd）|
|---|---|---|---|---|
| 数据源分类 | in-repo | in-repo | in-repo | external-clone |
| 源码路径 | `tests/fixtures/graph-quality-ts/` | `tests/fixtures/graph-quality-java/` | `tests/fixtures/graph-quality-go/` | `~/.spectra-baselines/micrograd`（`SPECTRA_BASELINE_HOME` 可覆盖）|
| pinned 图路径 | `tests/fixtures/graph-quality-ts-graph/graph.json` | `tests/fixtures/graph-quality-java-graph/graph.json` | `tests/fixtures/graph-quality-go-graph/graph.json` | `tests/fixtures/micrograd-baseline-graph/graph.json` |
| 处置前状态 | 陈旧（pinned 11 边，实际 14 边，多 3 条测试文件→被测模块的 calls 边）| 一致 | 一致 | 一致（clone commit `c911406e` 未漂移）|
| 处置动作 | 覆盖重建 graph.json（14 边）+ README 人工推导表同步 + `graph-quality-lang-matrix.test.ts` 断言 11→14 | 无需改动 | 无需改动 | 无需改动 |
| 新增守卫状态枚举 | `verified` / `stale` | `verified` / `stale` | `verified` / `stale` | `verified` / `stale` / `unverifiable:external-source`（clone 不存在时）|
| 新增守卫载体 | `tests/integration/graph-quality-pinned-staleness.test.ts`（新增，4 语言共用同一文件，四行 describe.each 或等效结构）|

## 6. fingerprint regen 差异信息（⑤ 处置对象）

| 字段 | 值 |
|---|---|
| 计算函数 | `compareGraphOnlyStructure` / `compareModuleGraphSnapshot`（`scripts/regen-collector-fingerprint-fixtures.ts` 已导出）|
| 拒绝分支行为（不变）| 第 570-580 行：逐条 `console.error('[regen]   - ${difference}')` |
| 放行分支行为（处置前）| 第 588-591 行：仅 3 个布尔量摘要，`differences` 数组被丢弃 |
| 放行分支行为（处置后）| 追加 `if (aTrack.mismatch \|\| bTrack.mismatch)` 判断下的逐条 `console.log('[regen]   - ${difference}')` |
| 无差异场景 | 不新增任何输出行（SC-004 约束）|
| 新增测试场景 | `tests/integration/collector-fingerprint-regen-script.test.ts` 新增用例：fixture 源码变化（contentMismatch=true）+ `downgradeBehaviorVersionInBothAssets`（fingerprintUnchanged=false）双变量构造 |

## 7. it.todo 清单（⑥ 处置对象）

| 组 | 文件 | 条数 | 处置分类 | 处置后形态 |
|---|---|---|---|---|
| cross-project-isolation | `tests/integration/cross-project-isolation.test.ts:132-136` | 5 | 结构性不可填充 | 删除，文件 docblock 记录理由 |
| adr-cross-fixture | `tests/integration/adr-cross-fixture.test.ts:166-169` | 4 | 结构性不可填充 | 删除，文件 docblock 记录理由 |
| hyperedge-first-run | `tests/integration/hyperedge-first-run.test.ts:225-228` | 4 | 结构性不可填充 | 删除，文件 docblock 记录理由 |
| graph-html-generation | `tests/integration/graph-html-generation.test.ts:58-61` | 4 | 技术上可填充 | 保留 `it.todo`，阻塞理由改写为"待有人写 mock-LLM 集成用例填充"（不碰同文件的 ⑦-A7 真实断言）|
| include-docs-integration | `tests/integration/include-docs-integration.test.ts:160-162` | 3 | 技术上可填充 | 保留 `it.todo`，阻塞理由同上改写 |
| agent-context-sanitize | `tests/unit/mcp/agent-context-sanitize.test.ts:142` | 1 | 误用（豁免记录非待办）| 改为普通注释 |

**计数关系**（已按编排器补充的重算修正）：13（删除）+ 7（保留）+ 1（改注释）= 21（基线）；处置后 vitest `todo` 汇总行 = **7**（不是 spec.md 当前文本里的 8，见 plan.md"必须执行的修正项"）。

## 8. inventory-item7 清单（⑦ 处置对象，B 类就地修 / A 类移交）

| 类别 | 条数 | 本卡动作 | 载体 |
|---|---|---|---|
| B1 占位断言 | 3 | 删除/转 `it.todo` | 3 个文件 |
| B2 条件恒假（★ 风险最高）| 11（12 条中 1 条随①消失）| 前置 length/存在性断言 | 8 个文件 |
| B3 测试验证自己写的代码 | 3 | 改调用真实函数或删除 | 2 个文件 |
| B4 数值恒真 | 3（5 条中 1 条随①消失、1 条随①移植修回）| `>=` 收紧为 `>` 或改类型断言 | 3 个文件 |
| B5 无 throw 路径断言 | 3 | 改断言具体返回值 | 2 个文件（与 B4 部分同文件）|
| B6 静态 import `typeof` 检查 | 4（代表 12 条，按文件计数）| 整条 `it` 删除 | 4 个文件 |
| B7 名实不符 | 4 | 断言改验证用例名承诺内容 | 4 个文件（与 B2 部分同文件）|
| A1-A10（移交，本卡不改代码）| 64 | 清单入库，坐标+建议改法完整 | `inventory-item7.md` 本身即交付物 |
| 明确判"合理"（不改）| — | 零改动 | wrapper/SKILL.md 同步、release contract 同步、分层架构守卫、负向漂移守卫等 |
