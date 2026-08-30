# Tasks: 测试与守护资产清淤（Test & Guard Asset Cleanup）

**Input**: `plan.md`（五项设计决策）、`spec.md`（US1-7 / FR-001~011 / SC-001~009）、`verified-facts.md`（事实基线）、`inventory-item7.md`（⑦ 99 条清单）、`contracts/*.md`（三份输出契约）、`verification/baseline-before.md`（回归对照组）
**Tests**: 本卡本身就是测试/守护资产的清理与新增，"实现"与"测试"是同一件事；每处新增守卫都必须先写好断言逻辑再跑变异验证证明其有效
**Organization**: 按 plan.md 决策 5 的三批次组织（批 A / 批 B / 批 C），批次内再按 User Story 分组；批次写入路径 disjoint，可独立验证、独立交付

## 开工前算术核对（自查，非重做设计）

`plan.md` 决策 5 附属"⑦ B 类切分"表把 B7（名实不符）计为 **4** 条，但 `inventory-item7.md` 的 B7 表格逐字列出 **5** 行坐标（`image-extractor.test.ts:161`、`:235`、`extraction-pipeline.test.ts:168`、`html-template.test.ts:96`、`qa/prompt-builder.test.ts:55`）。用 inventory-item7.md 的精确坐标重算：

```
B1(3) + B2(11) + B3(3) + B4(3) + B5(3) + B6(4 处置单元/12 grep 命中) + B7(5)
= 32（批 C 需处置）
+ 1（B4 的 qa/index.test.ts:190，随 ① 移植处置在批 A 一并修回）
+ 2（B2/B4 各 1 条，随 ① 删除 src/panoramic/qa/__tests__/ 自动消失）
= 35 ✅ 与 spec.md SC-007 的「35 条」一致
```

plan.md 决策 5 页脚写的「31 条独立处置 + 1 + 2 = 35」本身也有笔误（31+1+2=34，非 35）；用 32 替换 31 后 32+1+2=35 才自洽。**本 tasks.md 下文 B7 按 5 条展开，不沿用 plan.md 表格里的 4。**

## 开工前契约核对（自查，coordinator 复审发现）

`contracts/zero-execution-test-file-guard.md`「输入事实源」表存在内部矛盾：磁盘侧要求「全仓 glob，不预设 `src`/`tests` 目录边界」，但同一张表里 vitest 收集侧的解析写死了正则 `(src|tests)/.+\.test\.ts` 去匹配 `npx vitest list --filesOnly` 的输出行——两侧口径不一致。

**后果**：若将来有测试文件放在别的顶层目录（如 `scripts/__tests__/`）且已被正确接进 vitest include，磁盘侧会收录它、收集侧解析会因前缀不匹配而漏掉它，于是它出现在 diff 里，守卫报「未被任何 vitest project 收集」——这个结论与事实相反（它其实被收集了，只是解析器没认出来）。方向是 fail-closed（不会静默放行），安全性可接受，但诊断内容说假话，正是本卡在治的病（⑦ 判别红线）。

**正确解析**：`vitest list --filesOnly` 的实测输出格式是 `[<project>] <仓库根相对路径>`（如 `[self-hosting] tests/self-hosting/self-host.test.ts`）。正确做法是剥掉行首 `[project] ` 前缀取剩余部分（如用 `^\[[^\]]+\]\s+(.+\.test\.ts)$` 捕获组），不去匹配路径里的目录名。已列为 **T-A05a**（见下方批 A），implement 时须一并处理 T-A05 的实现与契约文件本身的文字修正。

---

## 批次写入路径清单（越界自查用，来自 plan.md 决策 5，原样引用）

### 批 A（① + ②，对应 US1 + US4）
- 删除：`src/panoramic/qa/__tests__/{citation,debt-context,graph-retriever,index,llm-caller,prompt-builder,qa-integration,rag-reranker}.test.ts`（8 文件）
- 修改：`tests/panoramic/qa/debt-context.test.ts`、`tests/panoramic/qa/index.test.ts`
- 新增：`tests/integration/zero-execution-test-file-guard.test.ts`
- 修改：`tests/integration/graph-mcp-snapshot.test.ts`（删 211-262 行块）
- 修改：`tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap`（删 343/414 行两个孤儿条目）
- 修改：`specs/272-test-guard-asset-cleanup/contracts/zero-execution-test-file-guard.md`（T-A05a 的解析口径文字修正）

### 批 B（③ + ④ + ⑤，对应 US2 + US3 + US5）
- 修改：`.github/workflows/ci.yml`（新增 1 步骤）
- 修改：`tests/fixtures/graph-quality-ts-graph/graph.json`、`tests/fixtures/graph-quality-ts-graph/README.md`
- 修改：`tests/integration/graph-quality-lang-matrix.test.ts`（`expectedEdgeCount: 11→14`）
- 新增：`tests/integration/graph-quality-pinned-staleness.test.ts`
- 修改：`scripts/regen-collector-fingerprint-fixtures.ts`（放行分支打印）
- 修改：`tests/integration/collector-fingerprint-regen-script.test.ts`（新增 1 个端到端用例）

### 批 C（⑥ + ⑦-B，对应 US6 + US7）
- ⑥：`tests/integration/{cross-project-isolation,adr-cross-fixture,hyperedge-first-run,graph-html-generation,include-docs-integration}.test.ts`、`tests/unit/mcp/agent-context-sanitize.test.ts`
- ⑦-B（23 文件）：`tests/unit/mcp/agent-context-tools-snapshots.test.ts`、`tests/kb/ingester.test.ts`、`tests/e2e/feature-171-file-navigation.e2e.test.ts`、`tests/unit/{god-node-analyzer,surprising-edges,code-slice-extractor,batch-orchestrator-tsjs-resolve,feature135-codex-followup}.test.ts`、`tests/panoramic/qa/{rag-reranker,prompt-builder}.test.ts`、`tests/panoramic/{product-ux-docs,community-persist,html-exporter,obsidian-exporter,html-template}.test.ts`、`tests/panoramic/anchoring/chunker.test.ts`、`tests/extraction/{image-extractor,extraction-pipeline}.test.ts`、`tests/adapters/{java-adapter,python-adapter,go-adapter,ts-js-adapter-equivalence}.test.ts`、`tests/self-hosting/self-host.test.ts`

**三批合计 49 个文件路径 + 1 份 spec 目录内契约文档（T-A05a），两两 disjoint**（核对方法见 plan.md「批次间 disjoint 核对结论」）。批次内任务若涉及同一文件的不同处置项，均已在下方任务描述中标注精确行号范围，避免互相覆盖。

---

## Phase 0: 修正项（须先于批次工作或与批次并行，独立执行）

- [x] **T-P00** 修正 `spec.md` 两处算术错误：SC-006「todo 计数从 21 降至 8」改为「降至 **7**」；裁决记录⑥「可观测效果」段「降至 8（7 条保留 + 0 误用...）」改为「降至 **7**（7 条保留 + 0 误用...）」。**判据**：`grep -n "降至 8" specs/272-test-guard-asset-cleanup/spec.md` 返回空；`grep -n "降至 7" specs/272-test-guard-asset-cleanup/spec.md` 命中两处。**依赖**：无，可立即执行，不占用批次写入路径。 （修复轮：最终口径为「⑥ 名下 10 / 全仓 12」，非当初的 7；见 spec.md SC-006）

---

## 批 A（① + ②）— User Story 1 + User Story 4

**目标**：删除 qa 模块陈旧测试副本、移植真实覆盖、新增零执行测试文件守卫（US1，P1）；清理 self-dogfood 静默跳过块与孤儿快照（US4，P2）。

**独立验证点**：`npx vitest run --project unit tests/panoramic/qa`（期望 85 passed）+ `npx vitest run tests/integration/graph-mcp-snapshot.test.ts tests/integration/zero-execution-test-file-guard.test.ts` + 全仓 grep 确认无残留。

### User Story 1（① + FR-011）

- [x] **T-A01 [P] [US1]** 删除 `src/panoramic/qa/__tests__/` 全部 8 个文件（`citation.test.ts` / `debt-context.test.ts` / `graph-retriever.test.ts` / `index.test.ts` / `llm-caller.test.ts` / `prompt-builder.test.ts` / `qa-integration.test.ts` / `rag-reranker.test.ts`）。**判据**：`test ! -d src/panoramic/qa/__tests__`。**依赖**：无。

- [x] **T-A02 [US1]** 在 `tests/panoramic/qa/debt-context.test.ts` 的 `describe('isDebtQuestion', ...)` 块（现有 6 条用例，以「普通问题不应匹配」收尾）末尾追加 2 条移植用例（逐字取自 `verified-facts.md` ① 章节）：
  ```ts
  it('包含 technical debt 时应返回 true', () => {
    expect(isDebtQuestion('what technical debt exists')).toBe(true);
  });

  it('架构问题不应匹配', () => {
    expect(isDebtQuestion('模块间的依赖关系是什么')).toBe(false);
  });
  ```
  不移植 `llm-caller.test.ts` 的第三条独有用例（名不副实，见 FR-001 裁决）。**判据**：`npx vitest run --project unit tests/panoramic/qa/debt-context.test.ts` 全绿，用例数 8。**依赖**：无（与 T-A01 无写入路径重叠，可并行）。

- [x] **T-A03 [US1]** `tests/panoramic/qa/index.test.ts:190` 的 `durationMs >= 0` 断言修回 `durationMs > 0`（对应 ⑦ B4 清单中「随 ① 移植处置一并修回」的那一条，本卡不在批 C 单独处置）。**判据**：`grep -n "durationMs" tests/panoramic/qa/index.test.ts` 显示 `> 0`；该文件全量用例通过。**依赖**：无。 （修复轮改判：不是「修回 `> 0`」而是**整条 it 删除**——批 A 变异验证实证全 mock 管线下 `Date.now()-t0` 确定性返回 0，字面修回会造恒红；存在性与类型由同文件第 169 行既有 typeof 断言覆盖）

- [x] **T-A04 [US1]** 变异验证 T-A02 移植用例的不可替代性：临时把 `src/panoramic/qa/debt-context.ts:47` 的 `DEBT_KEYWORD_PATTERN` 正则中 `technical\s*debt|` 子串删掉，重跑 `tests/panoramic/qa/debt-context.test.ts`，**期望恰好 1 条失败**（新移植的「包含 technical debt 时应返回 true」），其余 7 条全绿；确认后 `git checkout` 恢复该正则（不进入最终 diff，本卡不改生产代码）。**判据**：失败用例数=1 且失败用例名与预期一致。**依赖**：T-A02 完成。

- [x] **T-A05 [P] [US1]** 新增 `tests/integration/zero-execution-test-file-guard.test.ts`，按 `contracts/zero-execution-test-file-guard.md`（含 T-A05a 修正后的解析口径）实现：磁盘侧全仓 glob `**/*.test.ts`（排除 `node_modules`/`dist`/`.git`，不写死 `find src tests`）与 `npx vitest list --filesOnly`（子进程 spawn）收集侧求差集，断言差集恰好等于白名单 `[{ path: 'tests/fixtures/graph-quality-ts/greeter-service.test.ts', reason: '...' }]`；失败信息需打印差集中每个意外条目的完整路径 + 排查提示。**判据**：`npx vitest run tests/integration/zero-execution-test-file-guard.test.ts` 1 passed。**依赖**：无（新文件，与其它任务无写入冲突，可并行）；实现须直接采用 T-A05a 的解析方式，不得先按契约旧文案写死 `src|tests` 前缀再补丁。 （修复轮改实现：磁盘枚举由 `lstat` 递归改为 `git ls-files` tracked∪untracked-not-ignored + 磁盘存在性过滤——见对抗审查 C2，原实现会扫进 `.claude/worktrees/` 造 2194 条假阳性，且 `git ls-files` 会列出已删未 stage 的幽灵文件）

- [x] **T-A05a [US1]** **修正 T-A05 的解析口径 + 契约文字**（coordinator 复审发现的契约内部矛盾）：
  1. `tests/integration/zero-execution-test-file-guard.test.ts` 对 `npx vitest list --filesOnly` 输出的解析，**不得**用 `(src|tests)/.+\.test\.ts` 去匹配路径里的目录名前缀；正确做法是**剥掉行首的 `[project] ` 前缀后取剩余部分**（如 `^\[[^\]]+\]\s+(.+\.test\.ts)$` 捕获组），使解析结果不依赖顶层目录名，与磁盘侧「全仓 glob、不预设目录边界」的口径保持一致。
  2. 同步修正 `specs/272-test-guard-asset-cleanup/contracts/zero-execution-test-file-guard.md`「输入事实源」表中 vitest 收集侧那一行的描述，把「按行提取 `(src\|tests)/.+\.test\.ts` 子串」改为「剥掉 `[project] ` 前缀后取剩余路径（不依赖目录名前缀）」，避免下一个人照旧文案又写回错误实现。
  **判据**：临时在一个非 `src`/`tests` 的顶层目录（如 `scripts/__probe__/`）构造一个**已被某个 vitest project include 覆盖**的测试文件（或直接对解析函数写一个独立的单元级断言，传入 `[integration] scripts/__probe__/x.test.ts` 这类样例行），确认解析结果正确包含该路径；验证后删除临时构造的探针文件/project 配置，不进入最终 diff。契约文件的文字修正需保留（不撤销）。**依赖**：T-A05 完成实现骨架后同一 commit 内一并处理，不得分两次提交造成中间状态契约与实现不一致。

- [x] **T-A06 [US1]** 变异验证 FR-011 守卫：临时创建 `src/panoramic/qa/__zzz-mutation-probe.test.ts`（内容 `import { it } from 'vitest'; it('probe', () => {});`），重跑 T-A05 新增的守卫测试，**期望失败**且失败信息中包含该探针路径；删除探针文件后重跑，**期望恢复通过**。**判据**：两次运行结果分别为「1 failed 含探针路径」「1 passed」。**依赖**：T-A05、T-A05a 完成（须用修正后的解析逻辑做本轮变异验证，否则验证的是错误实现）。

### User Story 4（②）

- [x] **T-A07 [US4]** 删除 `tests/integration/graph-mcp-snapshot.test.ts` 第 211-262 行 Layer B self-dogfood 条件跳过块（`describeIfSelfDogfoodFixture` 及其内部 2 条 it + 1 个 const 组 + 1 个 helper 函数），并做三处连带清理（`verified-facts.md` ② 章节表格，tsc 不会自动报出）：
  1. 删除第 15 行 `import * as fs from 'node:fs'`（`fs.` 仅在待删块的第 215、217 行出现），**保留**第 19 行 `import { mkdtempSync, rmSync } from 'node:fs'`（第 144 行仍用）
  2. **保留** `import type { GraphJSON }`（第 32/105 行仍用）
  3. 改写文件 docblock 第 10-13 行：把「Layer B 真实 self-dogfood fixture……已入库」与「总 snapshot：…= 10」两句改为准确描述，snapshot 总数 10→**8**（6 Layer A + 2 Layer B MVP），删除"已入库"这句不实陈述
  **判据**：`npx vitest run tests/integration/graph-mcp-snapshot.test.ts` 无 skipped、全部保留用例通过；`grep -n "import \* as fs" tests/integration/graph-mcp-snapshot.test.ts` 无匹配；docblock 文本核对。**依赖**：无。

- [x] **T-A08 [US4]** 删除 `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 第 343 行与第 414 行两个孤儿快照条目（`layer-b-self-dogfood-graph_god_nodes` / `layer-b-self-dogfood-graph_query`），**外科式删除，禁止 `vitest -u` 整份重生成**。**判据**：`grep -n "self-dogfood" tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` 无匹配；`npx vitest run tests/integration/graph-mcp-snapshot.test.ts` 全绿。**依赖**：T-A07 完成（快照条目对应待删测试块）。

### 批 A 收尾

- [x] **T-A09 [US1] [US4]** 全仓 grep 扫描确认无残留（FR-009）：
  - `grep -rn "panoramic/qa/__tests__"` 排除 node_modules/dist/.git → 仅剩 `specs/src.spec.md`（生成产物，排除提交）与 `specs/132-reading-ux/tasks.md`（历史制品，**保持原样不改**）
  - `grep -rn "self-dogfood-graph_god_nodes\|self-dogfood-graph_query"` → 全仓无残留
  **判据**：两条 grep 命令输出与上述预期逐字一致。**依赖**：T-A01、T-A07、T-A08 完成。

- [x] **T-A10 [US1] [US4]** 批 A 独立验证：`npx vitest run --project unit tests/panoramic/qa`（期望 `Test Files 8 passed (8)` / `Tests 85 passed (85)`）+ `npx vitest run tests/integration/graph-mcp-snapshot.test.ts tests/integration/zero-execution-test-file-guard.test.ts`（全绿）。**依赖**：T-A01~T-A09 全部完成（含 T-A05a）。

**Checkpoint**：批 A 完成后 US1/US4 均可独立验证通过，与批 B/C 无写入冲突，可先行 commit。

---

## 批 B（③ + ④ + ⑤）— User Story 2 + User Story 3 + User Story 5

**目标**：把三份已存在但从不生效的类型契约守护接入 CI（US2，P1）；给 pinned graph fixture 装上陈旧检测并同步 TS/JS pinned 数据（US3，P1）；修复 fingerprint regen 脚本放行分支丢弃差异信息的缺陷（US5，P2）。

**独立验证点**：`npm run typecheck:tests`（exit 0）+ `npx vitest run tests/integration/graph-quality-lang-matrix.test.ts tests/integration/graph-quality-pinned-staleness.test.ts tests/integration/collector-fingerprint-regen-script.test.ts` + `ci.yml` 走 F269 惯例（报告先落盘 + PENDING 节，真实 CI run 回填）。

### User Story 2（③）

- [x] **T-B01 [US2]** 在 `.github/workflows/ci.yml` 中新增独立步骤 **`Type Check Tests`**，位置紧接在既有 `Type Check`（`npm run lint`）之后、`Build` 之前，`run: npm run typecheck:tests`，不带 `if:` 条件（默认 `if: success()`）。不修改任何既有步骤内容（决策 1，与并行卡 F270/F271 的 diff 重叠面降到最低）。implement 前先 `git fetch` 复核 `ci.yml` 是否已被 F270/F271 先行修改，若有则 rebase 后重新确认插入位置。**判据**：`grep -n "Type Check Tests" .github/workflows/ci.yml` 命中；本地 `npm run typecheck:tests` exit 0。**依赖**：无。

- [x] **T-B02** 变异验证 F220 orchestrator 导出契约：临时把 `f220-orchestrator-exports.typecheck.ts` 所依赖的导出类型定义改动一处（如某导出的类型签名不再满足契约），跑 `npm run typecheck:tests` 确认报编译错误；`git checkout` 撤销该临时改动。**判据**：变异后 exit≠0 且错误信息指向 f220 相关 tsconfig；撤销后 exit 0。**依赖**：T-B01 完成（先确认脚本本身可跑）。

- [x] **T-B03** 变异验证 F222 llm-degraded 必填字段契约：临时把 `f222-llm-degraded-required.typecheck.ts` 所依赖的某个 required 字段改成 optional，跑 `npm run typecheck:tests` 确认报编译错误；撤销改动。**判据**：同 T-B02 模式，错误信息指向 f222 tsconfig。**依赖**：T-B01 完成，可与 T-B02 并行（不同类型定义文件）。

- [x] **T-B04** 变异验证 F170c enrichment 可选字段契约：临时改动 `feature-170c-enrichment-optional.test-d.ts` 所依赖的可选字段定义使其不再满足契约，跑 `npm run typecheck:tests` 确认报编译错误；撤销改动。**判据**：同上，错误信息指向 f170c tsconfig。**依赖**：T-B01 完成，可与 T-B02/T-B03 并行。

- [x] **T-B05 [US2]** CI 报告先落盘 + PENDING 节（走 F269 惯例）：implement 报告中记录本次 `ci.yml` 改动的验收状态为 PENDING，待真实 GitHub Actions run 触发后回填「`Type Check Tests` 步骤实际执行结果」。**判据**：报告文件含 PENDING 标记；后续（verify 阶段或下次交付前）用真实 CI run URL/结果替换 PENDING。**依赖**：T-B01 完成（push 后才有真实 CI run）。

### User Story 3（④）

- [x] **T-B06 [US3]** 覆盖重建 `tests/fixtures/graph-quality-ts-graph/graph.json` 为当前 dist（`npm run build` 后）的重建产物（10 节点 / 14 边：depends-on 1 + calls 5 + contains 8），按该目录 README 的 SOP 执行，**禁止 `vitest -u`**。**判据**：`node dist/cli/index.js graph-quality --graph tests/fixtures/graph-quality-ts-graph/graph.json --json` 六指标全 pass，逐字对照 `verified-facts.md` ④ 章节实测结果。**依赖**：无（需先 `npm run build`）。

- [x] **T-B07 [US3]** 修改 `tests/integration/graph-quality-lang-matrix.test.ts:136` 的 `expectedEdgeCount: 11` → `14`，`expectedNodeCount: 10` / `expectedSymbolCount: 8` 及六指标断言不动。**判据**：`npx vitest run tests/integration/graph-quality-lang-matrix.test.ts` 全绿（8 it）。**依赖**：T-B06 完成（fixture 与断言须一致）。

- [x] **T-B08 [US3]** 手工更新 `tests/fixtures/graph-quality-ts-graph/README.md` 人工推导表：边总数 11→14、`calls` 2→5，列出新增的 3 条边（`greeter-service.test.ts --calls--> greeter-service.ts::formatGreeting` / `::GreeterService.greet` / `::GreeterService`），记录 producer commit。**判据**：README 文本与实测结果逐字一致；不使用任何自动生成工具，手工推导后逐处替换。**依赖**：T-B06 完成。

- [x] **T-B09 [US3]** 新增独立文件 `tests/integration/graph-quality-pinned-staleness.test.ts`，按 `contracts/pinned-graph-staleness-report.md` 实现：声明 `FIXTURE_SOURCE_CLASSIFICATION`（TS/JS、Java、Go = `in-repo`，Python = `external-clone`，断言 external-clone 集合恒等于 `['Python']`）；对 in-repo 语言无条件重建（复用 `scripts/regen-collector-fingerprint-fixtures.ts` 已导出的 `compareGraphOnlyStructure`）并断言 `status==='verified' && differences.length===0`；对 Python 动态探测 `~/.spectra-baselines/micrograd`（或 `SPECTRA_BASELINE_HOME` 覆盖），不存在则 `status='unverifiable:external-source'` 且含具体缺失路径，存在则实际重建对比 `tests/fixtures/micrograd-baseline-graph/graph.json`；断言 unverifiable 集合是 external-clone 集合的子集。**判据**：`npx vitest run tests/integration/graph-quality-pinned-staleness.test.ts` 全绿，TS/Java/Go 均 verified、Python 按当前环境给出 verified 或 unverifiable。**依赖**：T-B06、T-B07 完成（判定基准是处置后的 14 边版本）。

- [x] **T-B10 [US3]** 变异验证 pinned-staleness 守卫：临时将 `tests/fixtures/graph-quality-ts-graph/graph.json` 替换为处置前的 11 边版本（用副本操作，不用 stash），重跑 T-B09 的测试，**期望** `status==='stale'` 且 `differences` 含至少 3 条 `边计数不一致（重建 X vs pinned Y）: xxx|calls|xxx` 形式的条目；确认后恢复为 T-B06 产出的 14 边正式版本。**判据**：变异后测试失败且失败信息含具体差异；恢复后测试通过。**依赖**：T-B09 完成。

### User Story 5（⑤）

- [x] **T-B11 [US5]** 修改 `scripts/regen-collector-fingerprint-fixtures.ts` 放行分支（第 588-591 行附近），按 `contracts/fingerprint-regen-permit-output.md` 追加打印：仅当 `aTrack.mismatch || bTrack.mismatch` 为真时，逐条打印 `[...aTrack.differences, ...bTrack.differences]`（格式 `[regen]   - ${difference}`，与拒绝分支第 570-580 行一致）；无差异场景不新增任何输出行。**判据**：代码 diff 与契约文件「处置后行为」代码块逐字一致。**依赖**：无。

- [x] **T-B12 [US5]** 在 `tests/integration/collector-fingerprint-regen-script.test.ts` 新增一个**独立**端到端用例（不修改既有第 157 行「仅指纹变化」放行用例），构造双变量场景：①在 `stageFixtureRoot()` 产出的临时目录里对 `src/ts/foo.ts` 做一处会改变图结构的最小编辑（新增一个可被 AST 解析到的顶层导出函数），使 `compareGraphOnlyStructure` 产出非空 `differences`；②复用 `downgradeBehaviorVersionInBothAssets()` 确保 `fingerprintUnchanged=false`。断言 `run.status===0`、`run.stdout` 含 `放行`、且含具体差异文案（如 `节点仅存在于重建产物:` 或按实际编辑对应的确定性文案），**不得**仅断言含 `differences` 字样这类空泛匹配。**判据**：`npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts` 全绿，含新增用例。**依赖**：T-B11 完成。

- [x] **T-B13 [US5]** 变异验证 ⑤：临时删除 T-B11 新增的打印循环（还原为处置前行为），重跑 T-B12 新增的用例，**期望断言变红**（证明打印真实发生在放行分支代码路径，而非恰好被其它输出满足）；确认后恢复打印循环。**判据**：变异后该用例失败；恢复后全绿。**依赖**：T-B12 完成。

### 批 B 收尾

- [x] **T-B14** 批 B 独立验证：`npm run typecheck:tests`（exit 0）+ `npx vitest run tests/integration/graph-quality-lang-matrix.test.ts tests/integration/graph-quality-pinned-staleness.test.ts tests/integration/collector-fingerprint-regen-script.test.ts`（全绿）。**依赖**：T-B01~T-B13 全部完成（T-B05 的 CI 真实回填可延后到 push 后单独跟进，不阻塞其余验证）。

**Checkpoint**：批 B 完成后 US2/US3/US5 均可独立验证通过（CI 步骤本身需等待真实 GitHub Actions run 才算完全验收），与批 A/C 无写入冲突。

---

## 批 C（⑥ + ⑦-B）— User Story 6 + User Story 7

**目标**：23 条 `it.todo` 按可填充性三分处置（US6，P3）；⑦ B 类 35 条虚化断言就地修正并逐条/逐组变异验证，A 类 64 条以清单形式移交（US7，P3）。

**独立验证点**：`npx vitest run`（todo 计数从 21 降至 **7**）+ B 类 35 条逐条对照 `inventory-item7.md` 坐标核对处置结果。

**高风险文件写入范围收窄（照 plan.md 决策 5 执行，implement 时逐条自查）**：
- `tests/unit/mcp/agent-context-sanitize.test.ts`：仅碰第 142 行（it.todo → 普通注释），不整理同文件其它内容
- `tests/unit/mcp/agent-context-tools-snapshots.test.ts`：仅碰第 150 行（B1 占位删除），**不得**混入 ⑦-A3 的 10 条 grep 式断言（A 类移交清单，本卡不改）
- `tests/integration/graph-html-generation.test.ts`：仅碰 4 条 it.todo 的阻塞理由文案，**不碰** ⑦-A7 的 4 条真实 `it()` 断言

### User Story 6（⑥，23 条 it.todo 三分）

- [x] **T-C01 [US6]** 删除 `tests/integration/cross-project-isolation.test.ts` 全部 5 条 `it.todo`（4 fixture 真实 batch + FR-005 evidenceRef 占比），在文件 docblock 记录 deferred 内容与永久不做的理由（断言 ADR 标题/内容含特定领域词属 LLM 语义产出，mock 后成恒真；本仓 CI 无真实 LLM 通道，属设计选择非临时阻塞）。删除后留存的 6 条真实 `it()` 用例不受影响。**判据**：`grep -c "it.todo\|test.todo" tests/integration/cross-project-isolation.test.ts` 返回 0；`npx vitest run tests/integration/cross-project-isolation.test.ts` 6 passed。**依赖**：无。 （修复轮：删 4 条而非 5 条——`empty-project` 那条断言的是「缺席」不依赖 LLM 语义，按对抗审查 B-W1 恢复为 `it.todo` 并移交）

- [x] **T-C02 [US6]** 删除 `tests/integration/adr-cross-fixture.test.ts` 全部 4 条 `it.todo`（同类 ADR 语义断言），docblock 记录同 T-C01 理由。**判据**：`grep -c "it.todo\|test.todo" tests/integration/adr-cross-fixture.test.ts` 返回 0；`npx vitest run tests/integration/adr-cross-fixture.test.ts` 3 passed。**依赖**：无（不同文件，与 T-C01 可并行）。 （修复轮：删 3 条而非 4 条——同 T-C01，`empty-project` 条恢复）

- [x] **T-C03 [US6]** 删除 `tests/integration/hyperedge-first-run.test.ts` 全部 4 条 `it.todo`（`hyperedges.length >= 1` 由 LLM 提取），docblock 记录同类理由。**判据**：`grep -c "it.todo\|test.todo" tests/integration/hyperedge-first-run.test.ts` 返回 0；`npx vitest run tests/integration/hyperedge-first-run.test.ts` 7 passed。**依赖**：无（与 T-C01/T-C02 可并行）。 （修复轮：删 3 条而非 4 条——同 T-C01，`empty-project` 条恢复）

- [x] **T-C04 [US6]** 改写 `tests/integration/graph-html-generation.test.ts` 4 条 `it.todo` 的阻塞理由：从已失效的「待 Phase 1a fixture 落地」改为「待有人写 mock-LLM 集成用例填充」，**仅改理由文案，不删除 it.todo，不碰同文件 ⑦-A7 的 4 条真实 `it()` 断言**。**判据**：`grep -n "待 Phase 1a" tests/integration/graph-html-generation.test.ts` 无匹配；`grep -c "it.todo" tests/integration/graph-html-generation.test.ts` 仍为 4。**依赖**：无。

- [x] **T-C05 [US6]** 改写 `tests/integration/include-docs-integration.test.ts` 3 条 `it.todo` 的阻塞理由，同 T-C04 方式（日志文本 / `narrative.readmeExcerpt` / prompt 入参三条均不依赖 LLM 输出，技术上可填充）。**判据**：同 T-C04 模式，`grep -c "it.todo" tests/integration/include-docs-integration.test.ts` 仍为 3。**依赖**：无。

- [x] **T-C06 [US6]** `tests/unit/mcp/agent-context-sanitize.test.ts:142` 的 `it.todo` 误用（承载「stale 分支按设计回传含外来绝对路径的 err.message——故意诊断信号，豁免见 specs/186 plan.md」）改为普通注释，不再以 `it.todo` 形式出现在 vitest 待办报告中。**仅改这 1 行，不整理同文件其它内容**（F271 潜在接触面）。**判据**：`grep -n "it.todo" tests/unit/mcp/agent-context-sanitize.test.ts` 无匹配；该文件全量用例通过。**依赖**：无。

- [x] **T-C07 [US6]** todo 计数与残留扫描（FR-009 对 ⑥ 的适用部分）：`npx vitest run 2>&1 | tail -5` 确认 todo 汇总计数为 **7**；`grep -rn "待 Phase 1a fixture 落地"` 全仓确认无残留（该理由已被 T-C04/T-C05 替换）。**判据**：todo 计数=7；grep 无匹配。**依赖**：T-C01~T-C06 全部完成。

### User Story 7（⑦，B 类 35 条就地修正 + A 类清单移交）

#### B1 纯占位（3 条）

- [x] **T-C08 [US7]** `tests/unit/mcp/agent-context-tools-snapshots.test.ts:150` 删除 `expect(true).toBe(true)` 占位 it（覆盖已在同文件其它用例中存在）。**仅碰第 150 行，不得混入该文件的 ⑦-A3 10 条 grep 式断言**。**判据**：该行对应 it 不再出现于 vitest 报告；文件全量用例通过。**依赖**：无。

- [x] **T-C09 [US7]** `tests/kb/ingester.test.ts:402` 占位断言（注释「此断言为文档性占位」）转为 `it.todo`（保留待办可见性，不再以「已通过的占位断言」形式误导）。**判据**：该处不再是可执行的空断言，改为 `it.todo` 后出现在 todo 报告中。**依赖**：无。

- [x] **T-C10 [US7]** `tests/e2e/feature-171-file-navigation.e2e.test.ts:129`（HOST_E2E gate 内占位）转为 `it.todo`（默认 skip）。**判据**：同 T-C09。**依赖**：无。

- [x] **T-C11 [US7]** B1 变异验证：确认 T-C08/T-C09/T-C10 处置后，这 3 条不再出现在 vitest 正式断言报告的「passed」计数里（T-C08 为 removed，T-C09/T-C10 转为 todo）；对涉及的 3 个文件各跑一次全量确认无回归（覆盖来自同文件其它真实用例）。**判据**：`npx vitest run tests/unit/mcp/agent-context-tools-snapshots.test.ts tests/kb/ingester.test.ts tests/e2e/feature-171-file-navigation.e2e.test.ts` 全绿。**依赖**：T-C08、T-C09、T-C10 完成。

#### B2 条件恒假 / 条件放水（★ 风险最高，11 条，逐条展开）

- [x] **T-C12 [US7]** `tests/unit/god-node-analyzer.test.ts:111` 修法：前置 `expect(godNodes.length).toBe(2)`，钉死具体数值而非放水的 `if (godNodes.length >= 2)`。**判据**：断言变为无条件执行。**依赖**：无。
- [x] **T-C13 [US7]** T-C12 变异验证：临时把该用例的输入构造改为只产出 0 或 1 个 god node（例如收紧 fixture 阈值或截断输入图），重跑该用例，**期望**新前置断言 `toBe(2)` 先行报错并给出具体诊断（`expected 2, received 0/1`）；确认后恢复原 fixture 构造，确认转绿。**依赖**：T-C12 完成。

- [x] **T-C14 [US7]** `tests/unit/surprising-edges.test.ts:80` 修法：拆分双层 `if`（`length>=2` 且两条边都 find 到），先钉死 `surprises.length` 的具体值，再对每条边做无条件断言。**依赖**：无。
- [x] **T-C15 [US7]** T-C14 变异验证：临时把输入构造成只产出 0-1 条 surprising edge，重跑，期望前置 length 断言先失败并给出诊断；恢复后转绿。**依赖**：T-C14 完成。

- [x] **T-C16 [US7]** `tests/panoramic/qa/rag-reranker.test.ts:115` 修法：前置 `expect(rankedChunks.length).toBeGreaterThan(0)`（或钉死具体值），移除 `if (rankedChunks.length>0)` 才验字段 shape 的放水写法。**依赖**：无。
- [x] **T-C17 [US7]** T-C16 变异验证：临时构造 mock 使 `rankedChunks` 为空数组，重跑，期望前置断言先失败；恢复后转绿。**依赖**：T-C16 完成。

- [x] **T-C18 [US7]** `tests/panoramic/qa/rag-reranker.test.ts:198` 修法：同 T-C16 模式（nodeId 回退场景）。**依赖**：无，可与 T-C16 并行（同文件不同行，注意分开 commit 内 diff 不冲突）。
- [x] **T-C19 [US7]** T-C18 变异验证：同 T-C17 模式，针对 nodeId 回退场景构造空结果。**依赖**：T-C18 完成。

- [x] **T-C20 [US7]** `tests/panoramic/qa/rag-reranker.test.ts:216` 修法：钉死 `rankedChunks.length`（非 `>=2` 放水），并把 `uniqueNodeIds.size >= 1` 收紧为 `toBe(2)`（在 length 钉死为 2 的前提下）。**依赖**：无。
- [x] **T-C21 [US7]** T-C20 变异验证：临时构造 mock 使唯一 nodeId 数退化为 1，重跑，期望 `toBe(2)` 断言失败；恢复后转绿。**依赖**：T-C20 完成。

- [x] **T-C22 [US7]** `tests/panoramic/product-ux-docs.test.ts:551` 修法：钉死 fixture 必产出「开发者」用户，移除 `if (targetUsers.length>0)` + `if (dev && dev.description)` 两层放水。**依赖**：无。
- [x] **T-C23 [US7]** T-C22 变异验证：临时让 fixture/mock 产出不含「开发者」的 targetUsers 集合，重跑，期望前置断言失败并给出诊断；恢复后转绿。**依赖**：T-C22 完成。

- [x] **T-C24 [US7]** `tests/panoramic/product-ux-docs.test.ts:600` 修法：前置断言 `chineseEvidence.length > 0`，移除 `if (chineseEvidence.length>0)` 才验 nonChinese 的放水写法。**依赖**：无。
- [x] **T-C25 [US7]** T-C24 变异验证：临时构造 mock 使 chineseEvidence 为空，重跑，期望前置断言失败；恢复后转绿。**依赖**：T-C24 完成。

- [x] **T-C26 [US7]** `tests/unit/code-slice-extractor.test.ts:239` 修法：钉死 `slices.length===1` 且 `symbolName==='publicFunc'`，移除 `if (slices.length>0)` 外层 + `A || B` 内层析取的双重放水。**依赖**：无。
- [x] **T-C27 [US7]** T-C26 变异验证：临时构造输入使 `slices` 为空数组，重跑，期望 `slices.length===1` 断言先失败；恢复后转绿。**依赖**：T-C26 完成。

- [x] **T-C28 [US7]** `tests/extraction/image-extractor.test.ts:276` 修法：前置 `expect(createMock).toHaveBeenCalled()`，移除「即使未调用（降级），测试也通过」的放水包裹。**依赖**：无。
- [x] **T-C29 [US7]** T-C28 变异验证：临时让被测代码走降级路径（`createMock` 不被调用），重跑，期望 `toHaveBeenCalled()` 断言失败；恢复后转绿。**依赖**：T-C28 完成。

- [x] **T-C30 [US7]** `tests/panoramic/anchoring/chunker.test.ts:112` 修法：前置 `expect(chunks.length).toBe(2)`，移除 `if (chunks.length>0)` 才验首 chunk startLine=1 的放水写法（及其上方同类空转 for 循环）。**依赖**：无。
- [x] **T-C31 [US7]** T-C30 变异验证：临时构造输入使 `chunks` 产出数量偏离 2（如 0 或 1），重跑，期望前置断言失败；恢复后转绿。**依赖**：T-C30 完成。

- [x] **T-C32 [US7]** `tests/unit/batch-orchestrator-tsjs-resolve.test.ts:166` 修法：删除 `if (callSites!==undefined) expect(Array.isArray(...))` 两侧均恒真的写法，改为钉死 tree-sitter 解析路径下 `callSites` 必为数组的无条件断言。**依赖**：无。
- [x] **T-C33 [US7]** T-C32 变异验证：临时让被测函数在该路径下返回 `undefined`（而非数组），重跑，期望新断言失败；恢复后转绿。**依赖**：T-C32 完成。

#### B3 测试验证自己写的代码（3 条）

- [x] **T-C34 [US7]** `tests/panoramic/community-persist.test.ts:40-50` 修法：改为调用生产持久化函数（community 模块的真实持久化逻辑），断言其产出的 `node.metadata['community']`；若无对应可调用的持久化函数则删除该用例。**依赖**：无。

- [x] **T-C35 [US7]** `tests/panoramic/community-persist.test.ts:103-108` 修法：同 T-C34 模式，移除外套的 `if (community!==undefined)` 二次放水。**依赖**：无，可与 T-C34 并行（同文件不同行）。

- [x] **T-C36 [US7]** `tests/unit/feature135-codex-followup.test.ts:103`（「预写 adr-0001.md 后中和逻辑应保留原文件」）修法：接上真实中和逻辑调用（而非仅 `writeFileSync` 后 `readFileSync` 断言等于自己刚写的内容）；若无法接入真实调用则删除该用例。**依赖**：无。

- [x] **T-C37 [US7]** B3 变异验证：验证 T-C34/T-C35/T-C36 修改后的用例确实调用了目标生产函数——用 `vi.spyOn` 断言调用发生，或临时把目标生产函数体替换为直接 `throw`，确认新用例会红；确认后撤销该临时改动（不进入最终 diff）。**判据**：三条用例均能在生产函数被短路时失败。**依赖**：T-C34、T-C35、T-C36 完成。

#### B4 数值恒真（3 条，`qa/index.test.ts` 已在批 A 的 T-A03 处置，此处不重复）

- [x] **T-C38 [US7]** `tests/panoramic/html-exporter.test.ts:407`（用例名叫「大于等于 0」）：删除该断言或改为断言字段类型 + 存在性（若字段名本身要求「大于 0」需与用例名一致收紧）。**依赖**：无。 （修复轮补回 `toBeGreaterThanOrEqual(0)`：`Number.isFinite` 抓 NaN，`>= 0` 抓时钟回拨的负值，两者互补——见对抗审查 B-INFO1）

- [x] **T-C39 [US7]** `tests/panoramic/obsidian-exporter.test.ts:299`（用例名写「大于 0」，断言写 `>= 0`）：收紧为 `toBeGreaterThan(0)`，或若确实可能为 0 则删除该断言并改用例名。**依赖**：无。 （修复轮补回 `toBeGreaterThanOrEqual(0)`，理由同 T-C38）

- [x] **T-C40 [US7]** `tests/self-hosting/self-host.test.ts:62`（注释「每个文件应有导出」，断言 `exports.length >= 0`）：收紧为 `toBeGreaterThan(0)`。**依赖**：无。 （修复轮改判：实测 341 个 src 文件中 16 个 `exports.length===0`，注释「src/ 中的文件都是模块」与事实不符，收紧为 `> 0` 会造确定性红 → 改为 `Array.isArray` 类型不变量断言）

- [x] **T-C41 [US7]** B4 变异验证（三条合一）：分别临时把 T-C38/T-C39/T-C40 的收紧断言改回 `>= 0`，确认此时无法检测「实现退化为恒返回 0」的场景（即用一个人为把生产函数改为恒返回 0/空数组的变异体，确认宽松断言下测试仍绿）；随后恢复收紧后的断言，确认在同一变异体下测试变红；最终撤销全部临时改动。**依赖**：T-C38、T-C39、T-C40 完成。

#### B5 `not.toThrow()` 但无 throw 路径（3 条）

- [x] **T-C42 [US7]** `tests/panoramic/obsidian-exporter.test.ts:243` 修法：`buildGodNodePage` 已在 expect 之外执行完，`expect(() => page.content).not.toThrow()` 改为断言 `page.content` 的具体降级文案。**依赖**：无。

- [x] **T-C43 [US7]** `tests/panoramic/html-exporter.test.ts:98`（`communityColor(0,1)` 纯 hsl 运算）修法：改为断言返回的具体色值。**依赖**：无。

- [x] **T-C44 [US7]** `tests/panoramic/html-exporter.test.ts:102`（`communityColor(0,0)`，用例名说「回退处理」却不验回退值）修法：改为断言具体的回退色值。**依赖**：无，可与 T-C43 并行（同文件不同行）。

- [x] **T-C45 [US7]** B5 变异验证（三条合一）：分别临时把 T-C42/T-C43/T-C44 改回原 `not.toThrow()` 弱断言，构造一个返回值内容错误但不抛异常的变异体（如把 `communityColor` 的色相计算写死为固定值），确认弱断言检测不到；恢复具体值断言后确认能检测到；最终撤销全部临时改动。**依赖**：T-C42、T-C43、T-C44 完成。

#### B6 对静态 import 对象做 `typeof === 'function'`（4 处置单元 / 12 grep 命中，tsc 已保证）

- [x] **T-C46 [US7]** `tests/adapters/java-adapter.test.ts:55-58` 删除该 `typeof` 检查 it 整块（同文件已有 `analyzeFile()` 真调用用例覆盖）。**依赖**：无。
- [x] **T-C47 [US7]** `tests/adapters/python-adapter.test.ts:65-68` 同上处置。**依赖**：无，与 T-C46 可并行。
- [x] **T-C48 [US7]** `tests/adapters/go-adapter.test.ts:43-46` 同上处置。**依赖**：无，与 T-C46/T-C47 可并行。
- [x] **T-C49 [US7]** `tests/adapters/ts-js-adapter-equivalence.test.ts:111` 同上处置。**注意对照**：同目录 `tests/panoramic/*-generator.test.ts` 里对**动态 import 的 barrel** 做 `typeof` 检查判「合理」，**勿误删**（不在本卡处置范围）。**依赖**：无。 （修复轮修正删除依据：`buildModuleGraph` 在 `LanguageAdapter` 里是**可选成员**，tsc 并不保证；真实覆盖来自 `tests/integration/156-w1.2-v2.test.ts:122/:177`——见对抗审查 B-W2）

- [x] **T-C50 [US7]** B6 变异验证：对 4 个文件中保留的真实 `analyzeFile()` 调用用例，逐一临时把被测适配器的构造函数改为 `throw`，确认对应用例会失败（证明删除 `typeof` 检查后，真实覆盖仍由保留用例承担）；验证后立即撤销临时改动，不进入最终 diff。**依赖**：T-C46、T-C47、T-C48、T-C49 完成。

#### B7 用例名承诺 A、断言只验 B（5 条，本 tasks.md 按开工前算术核对结果，非 plan.md 表格的 4 条）

- [x] **T-C51 [US7]** `tests/extraction/image-extractor.test.ts:161`（名「节点 id 格式符合 `diagram:{相对路径}`」，断言 `toBeTruthy()`）：改为断言 `result.nodes[0].id` 匹配 `/^diagram:/`。**依赖**：无。

- [x] **T-C52 [US7]** `tests/extraction/image-extractor.test.ts:235`（名「SVG 以文本方式处理（不跳过）」，断言 `toBeTruthy()`）：改为断言 nodes 非空且走文本分支的具体标志。**依赖**：无，可与 T-C51 并行（同文件不同行）。

- [x] **T-C53 [US7]** `tests/extraction/extraction-pipeline.test.ts:168`（名「Zod 验证失败的结果被丢弃」，断言 `toBeDefined()`）：改为断言 `result.results` 不含该 invalid node。**依赖**：无。

- [x] **T-C54 [US7]** `tests/panoramic/html-template.test.ts:96`（名「options 正确合并默认值」，断言 `toBeTruthy()`）：改为断言默认阈值体现在输出 HTML 的具体内容中。**依赖**：无。

- [x] **T-C55 [US7]** `tests/panoramic/qa/prompt-builder.test.ts:55`（名「应返回 systemPrompt 和 userPrompt 字段」，两条 `toBeTruthy()`）：合并进同文件下方已有 `toContain('[来源：')` 的真断言，删除本条弱断言。**依赖**：无。

- [x] **T-C56 [US7]** B7 变异验证（五条合一）：分别临时把 T-C51~T-C55 的具体值断言改回原弱断言（`toBeTruthy()` / `toBeDefined()`），构造对应字段值错误的变异体（如把 id 格式改错、把回退阈值改错），确认弱断言检测不到；恢复具体断言后确认能检测到；最终撤销全部临时改动。**依赖**：T-C51、T-C52、T-C53、T-C54、T-C55 完成。

### A 类清单确认（不改代码，清单本身是交付物）

- [x] **T-C57 [US7]** 确认 `inventory-item7.md` A 类 64 条（A1-A10）本卡不做任何代码改动；确认该清单文件已随本卡入库（`git log --oneline -- specs/272-test-guard-asset-cleanup/inventory-item7.md` 有提交记录）；确认「合理」条目（wrapper/SKILL.md 同步、release contract 同步、分层架构守卫、负向漂移守卫等）保持原样零改动。**判据**：`git diff` 对 A 类清单涉及的 23 个文件（`tests/unit/feature135-adr-guard-hyperedges-warning.test.ts` 等）无改动，或改动仅限本卡明确指定的 B 类行号。**依赖**：批 C 全部 B 类任务完成后统一核对。

### 批 C 收尾

- [x] **T-C58 [US6] [US7]** 批 C 独立验证：`npx vitest run`（todo 计数=**7**）+ B 类 35 条逐一对照 `inventory-item7.md` 坐标核对处置结果（可用检查表：B1×3 + B2×11 + B3×3 + B4×3 + B5×3 + B6×4 + B7×5 = 32 条批 C 处置项，逐条勾选）。**依赖**：T-C01~T-C57 全部完成。 （修复轮：todo 计数最终为全仓 12 / ⑥ 名下 10，非当初写的 7）

**Checkpoint**：批 C 完成后 US6/US7 均可独立验证通过，与批 A/B 无写入冲突。

---

## Phase Final: Polish & 全量回归

- [x] **T-F01** FR-010 边界核查：`git diff --name-only` 对照 `src/mcp/`、`fix-compliance*`、`hooks/` 三个路径前缀，确认零命中（并行卡 F270/F271 写入面）。**依赖**：批 A/B/C 全部完成。

- [x] **T-F02** FR-002 边界核查：确认 `src/panoramic/qa/` 下生产代码文件（`debt-context.ts` 等）除 T-A04/T-A06/T-B10/T-B13/T-C13/T-C15/... 等变异验证任务中的**临时改动均已撤销**外，最终 `git diff` 对 `src/panoramic/qa/**` 生产逻辑文件为空。**依赖**：批 A 全部变异验证任务完成。

- [x] **T-F03** 全量回归：`npx vitest run`，对照 `verification/baseline-before.md` 判定：①失败文件集合 ⊆ 预存 flaky 清单（`watch-command`/`batch-orchestrator-incremental`/`community-analysis` perf/`cli-e2e --version`）∪ 本次新发现两条（`tests/unit/graph-bootstrap-status.test.ts`、`tests/unit/sync-worktree-local-state.test.ts`，隔离重跑复绿即视为预存 flaky，不当回归）；②`Tests passed` 与本卡删除/新增用例数逐条对得上（对照 T-A01 删除 79 条 + T-A02 新增 2 条 + T-B09/T-B12/T-A05 新增测试文件用例数 + T-C01~T-C03 删除 13 条 it.todo + T-C08 删除 1 条 + B6 删除 4 条等，implement 报告需列出净变化清单）；③`todo` 计数=**7**。**依赖**：T-F01、T-F02 完成。

- [x] **T-F04** `npm run build && npm run repo:check`，期望两者均零失败。**依赖**：T-F03 完成。

- [ ] **T-F05** `quickstart.md` 全部命令走一遍，逐条核对输出与文档预期一致（①~⑦ + FR-011 + 全量回归 + build/repo:check）。**依赖**：T-F04 完成。

- [ ] **T-F06** 回填 T-B05 的 CI 真实 run 结果（PENDING → 实际结果），确认 `Type Check Tests` 步骤在真实 GitHub Actions 上按预期执行（成功或按预期失败）。**依赖**：本卡分支已 push 且触发过一次 CI run。

- [ ] **T-F07** dogfooding 反馈记录：若本卡执行过程中使用 Spectra MCP / Spec Driver 遇到问题（例如本次 tasks 阶段发现的契约内部矛盾这类"设计阶段产出需要二次校验"的经验），按 `docs/design/dogfooding-feedback-ledger.md` 格式 append（状态：待处理）；若无其它实质反馈，在交付报告中显式写「无」。**依赖**：全部实现任务完成后，implement/verify 阶段收尾时执行。

---

## FR 覆盖映射表

| FR | 描述摘要 | 对应任务 |
|---|---|---|
| FR-001 | 删 8 文件 + 移植 2 条 + 修回 durationMs | T-A01, T-A02, T-A03, T-A04 |
| FR-002 | 不改 qa 生产代码 / 不改 include | T-A01（不改 vitest.config.ts）, T-F02（边界核查） |
| FR-003 | typecheck:tests 接入 CI + 变异验证 | T-B01, T-B02, T-B03, T-B04, T-B05, T-F06 |
| FR-004 | pinned 陈旧检查 + TS/JS 重建 + 变异验证 | T-B06, T-B07, T-B08, T-B09, T-B10 |
| FR-005 | regen 放行分支打印 differences | T-B11, T-B12, T-B13 |
| FR-006 | 删 self-dogfood 块 + 孤儿快照 | T-A07, T-A08 |
| FR-007 | 23 条 it.todo 三分处置 | T-C01, T-C02, T-C03, T-C04, T-C05, T-C06, T-C07 |
| FR-008 | B 类 35 条就地修 + A 类 64 条清单移交 | T-C08~T-C56（B 类全部）, T-C57（A 类确认） |
| FR-009 | 全仓 grep 无残留 | T-A09, T-C07 |
| FR-010 | 不改 src/mcp/、fix-compliance*、hooks/ | T-F01 |
| FR-011 | 零执行测试文件守卫 + 变异验证（含契约解析口径修正） | T-A05, T-A05a, T-A06 |

**100% FR 覆盖确认**：FR-001 至 FR-011 每条均有至少一个对应任务，无遗漏。

---

## Dependencies & Execution Order

### 批次依赖
- 批 A、批 B、批 C **写入路径互相 disjoint**，理论上可并行开工，但 implement 建议**顺序执行**（批 A → 批 B → 批 C）以降低单次 diff 审查复杂度，且三批各自的独立验证点可在完成后立即 commit，符合 HIGH 风险判定要求的「强制分阶段」。
- Phase 0（T-P00）与 Phase Final（T-F01~T-F07）分别在批次工作前/后执行，不占用批次写入路径。

### 批内依赖
- **批 A**：T-A01/T-A02/T-A05 可并行（不同文件）；T-A03 独立；T-A04 依赖 T-A02；T-A05a 依赖 T-A05（同一 commit 内一并完成，不得分次提交造成解析口径与契约文字不一致的中间状态）；T-A06 依赖 T-A05+T-A05a；T-A07 独立；T-A08 依赖 T-A07；T-A09 依赖 T-A01+T-A07+T-A08；T-A10 依赖全部前置任务。
- **批 B**：T-B01 独立；T-B02/T-B03/T-B04 三个变异验证互相独立、依赖 T-B01；T-B05 依赖 T-B01（需真实 push 后的 CI run）；T-B06 独立；T-B07/T-B08 依赖 T-B06；T-B09 依赖 T-B06+T-B07；T-B10 依赖 T-B09；T-B11 独立；T-B12 依赖 T-B11；T-B13 依赖 T-B12；T-B14 依赖全部前置任务。
- **批 C**：T-C01~T-C06（⑥）互相独立可并行；T-C07 依赖 T-C01~T-C06；B1-B7 各子类内部「修法任务」互相独立（不同文件/不同行），每个子类的「变异验证任务」依赖该子类全部修法任务完成；T-C57 依赖全部 B 类任务；T-C58 依赖 T-C07+T-C57。

### 并行机会
- 批 A 内：T-A01、T-A02、T-A05、T-A07 四个任务分处不同文件，可完全并行开工；T-A05a 须紧跟 T-A05 同一执行者完成（同文件同 commit）
- 批 B 内：T-B01（CI）与 T-B06（fixture 重建）与 T-B11（regen 脚本打印）三条主线互不相关，可并行
- 批 C 内：⑥ 的 6 个文件、B1-B7 各子类的「修法任务」（如 T-C12/T-C14/T-C16/T-C18/T-C20/T-C22/T-C24/T-C26/T-C28/T-C30/T-C32 等 B2 的 11 条修法）分处不同文件（除 rag-reranker.test.ts 三条同文件不同行、product-ux-docs.test.ts 两条同文件不同行、image-extractor.test.ts 在 B2/B7 各出现一次需注意合并 diff、html-exporter.test.ts 在 B4/B5 各出现两次需注意合并 diff），可大量并行，需在落地时对同文件的多个任务合并为一次连续编辑避免相互覆盖

### 高并行度提示
批 C 的 B 类 35 条中约 28 条分处互不相同的文件，是本卡并行度最高的部分；建议按「文件」而非「子类」重新分组给并行执行者，同一文件内的多条处置（如 rag-reranker.test.ts 的 T-C16/T-C18/T-C20，html-exporter.test.ts 的 T-C38/T-C43/T-C44）应合并为一次编辑会话完成，避免文件级 diff 冲突。

---

## Implementation Strategy

### MVP 范围建议：批 A（US1）
批 A 的 US1（① 删除陈旧副本 + FR-011 零执行守卫，含 T-A05a 解析口径修正）是本卡"价值密度最高的一项"（spec.md 原文判断），且删除操作本身零回归风险（陈旧副本从不执行），新增的零执行守卫在处置后能立即封死本项缺陷的复发面。若需要拆分交付，US1 可独立成为第一个 MVP 增量。

### 增量交付顺序
1. Phase 0（T-P00，spec.md 算术修正）→ 立即执行，不阻塞任何批次
2. 批 A（US1 + US4，含 T-A05a 契约修正）→ 独立验证通过 → commit
3. 批 B（US2 + US3 + US5）→ 独立验证通过（CI 部分走 PENDING）→ commit
4. 批 C（US6 + US7）→ 独立验证通过 → commit
5. Phase Final（T-F01~T-F07）→ 全量回归 + CI 回填 + dogfooding 反馈收尾 → 交付

### 并行团队策略
若有多人协作，三批次可分配给三名执行者并行开工（写入路径已核实 disjoint）；批 C 内部因 B 类条目分散在 28+ 个不同文件，可进一步按文件拆给更多执行者，但需注意上文「高并行度提示」中标注的同文件多任务合并要求。
