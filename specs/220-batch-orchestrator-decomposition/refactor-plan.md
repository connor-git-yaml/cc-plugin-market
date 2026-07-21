# F220 分批规划 — batch-orchestrator.ts 五段有边界拆分

**依据**: `impact-report.md`
**成功标准（M9 原文）**: 行为不漂移 —— **不以"文件变短"为成功**；判据是"五段各自独立可测 + 三 mode 输出合同/byte-stable/checkpoint 恢复/F217 六指标全绿"。

---

## 1. 架构策略：Facade + Stage-Module（零漂移最稳路线）

```
src/batch/batch-orchestrator.ts   ← facade：import 五段 stage，re-export 14 符号契约，保留 runBatch 编排入口
src/batch/stages/
  ├─ source-discovery.ts          ← ① 文件/语言/skeleton/design-doc 采集
  ├─ graph-assembly.ts            ← ② 依赖图构建/合并/graph-only
  ├─ generation-scheduling.ts     ← ③ 并发规范化（+ 清晰 seam）
  ├─ checkpoint-state.ts          ← ④ checkpoint completed/failed 状态机 + 孤儿判定
  └─ artifact-reporting.ts        ← ⑤ 索引/summary/README 写盘 seam（保守）
```

**不变量**：facade 继续 re-export 全部 14 导出符号 → 3 源码消费者 + 27 测试的导入路径**零改动**（导出双向差集 = 空，参照 F218 范式）。

**registry 复用**：不建平行 registry；复用 `ProjectContext`/`GeneratorRegistry`/`ParserRegistry`/`AbstractRegistry`/`AbstractConfigParser` 与 `scanFiles`/`createGitignoreFilter` shared helper。

---

## 2. 两层提取（Tier A 主交付 / Tier B 有界机会）

### Tier A — dependency-closed relocation（依赖闭合搬迁，主交付）

把 12 个已独立的 leaf 函数 + 3 个状态机 helper 从 orchestrator **原样搬入** stage 模块（仅移动 + 调整 import 路径 + facade re-export；函数体逐字不变）。

> Codex W2 修正措辞：这些函数**不是纯函数**（多数读文件系统/时钟/logger/全局 registry/原地改状态），零漂移论证依据是"**依赖闭合**"——每个符号的 import 与闭包依赖完整随迁（logger 用同名 namespace 重建、模块常量随用随迁），函数体逐字不变 ⇒ 运行时行为等价。真正无闭包依赖的只有 `detectCrossLanguageRefs` / `generateCrossLanguageHint` / `normalizeConcurrency` / `isInManagedOutputDir` 四个。

| Stage 模块 | 搬入符号（当前行号） |
|-----------|---------------------|
| `stages/source-discovery.ts` | `PY_SKELETON_IGNORE_DIRS`(2173) + `collectPythonCodeSkeletons`(2189) + `walkPyFiles`(2291)；`TSJS_SKELETON_IGNORE_DIRS`(2326) + `collectTsJsCodeSkeletons`(2342) + `walkTsJsFiles`(2428)；`buildDesignDocAbsPaths`(1995) + `collectMdRecursive`(2148) |
| `stages/graph-assembly.ts` | `mergeGraphsForTopologicalSort`(301)、`detectCrossLanguageRefs`(336)、`generateCrossLanguageHint`(398)、`buildGraphForLanguageGroup`(1919)、`buildFallbackGraph`(1947)、`GraphOnlyResult`(2468) + `buildAstGraphOnly`(2500) |
| `stages/generation-scheduling.ts` | `normalizeConcurrency`(383) |
| `stages/checkpoint-state.ts` | `upsertCompletedModule`(274)、`recordFailedModule`(280)、`isInManagedOutputDir`(292) |

搬迁量 ≈ 785 行 leaf 逻辑离开 orchestrator，落入有边界、可独立单测的 stage 模块。

**为何零漂移**：这些函数不读 runBatch 局部状态（纯输入→输出）；搬迁 = 剪切 + 改 import + re-export，语义不可能变。byte-stable 与全量 vitest 会立即抓住任何意外。

### Tier B — runBatch 内清晰 seam 提取（保守、逐个 byte-stable 门控）

仅提取 **局部耦合最小、可 byte-stable 验证** 的 seam；深织于 runBatch 且读 ~20 局部变量的 **generation 循环(716–1150)** 与 **artifact 尾部(1150–1918)** **不强拆**（强拆需传大 context、真实漂移风险高、payoff 低 —— 违反"不以文件变短为成功"）。

候选 seam（各自独立成批、独立验证）：
- **B1 graph 选择块**（488–505 步骤1.6/1.7）→ `selectPrimaryModuleGraph({ languageGroups, resolvedRoot, isMultiLang, isSingleNonTsJs })` 入 graph-assembly。输入清晰、单一输出 `mergedGraph`。
- **B2 source 扫描块**（462–486 步骤1/1.5）→ `discoverSourceLanguages({ resolvedRoot, languages })` 入 source-discovery，返回 `{ scanResult, languageStats, detectedLanguages, languageGroups, processedLanguages, isMultiLang, isSingleNonTsJs }` 结果对象。

> Tier B 每个 seam 提取后若无法证明 byte-stable，**立即回滚该 seam**，保留在 runBatch。Tier A 已独立达成"五段可测"，Tier B 是加分项而非阻塞项。

---

## 3. 批次序列（每批 = 一次可独立验证 + 可回滚的提交单元）

| Batch | 内容 | 验证门 |
|-------|------|--------|
| **G**（先于一切搬迁） | 建立守护层：G1 冻结 micrograd graph-only 产物；G2 特征化测试（mock-LLM 语言矩阵 + snapshot）；G3 导出面合同测试 + type-tests；**全部在未拆分代码上先跑绿**（证明 guard 编码的是现状行为） | 新增测试全绿 + build + typecheck:tests |
| **B0** | 建 `src/batch/stages/` 五个 stage 模块骨架 + facade re-export 脚手架（先不搬逻辑，确保编译通过） | build |
| **B1** | Tier A 搬 `checkpoint-state.ts`（3 helper）+ **stage 级单测**（completed→failed / failed→completed / 重复 upsert 互斥去重 — Codex C4） | build + vitest + G3 |
| **B2** | Tier A 搬 `source-discovery.ts`（skeleton 采集 + walkers + design-doc 路径 + `MD_SCAN_DIR_BLACKLIST`） | build + vitest + G1 + G3 |
| **B3** | Tier A 搬 `graph-assembly.ts`（含 `buildAstGraphOnly` — F195 零 LLM 路径，最敏感） | build + vitest + G1 + G2 + G3 + F217 graph-quality |
| **B4** | Tier A 搬 `generation-scheduling.ts`（`normalizeConcurrency`）| build + vitest + G3 |
| **B5** | Tier B1：提取 `selectPrimaryModuleGraph` seam 入 graph-assembly | build + vitest + **G2**（主门 — graph-only 不执行此路径，Codex C5）；不达标即回滚 |
| **B6** | Tier B2：提取 `discoverSourceLanguages` seam 入 source-discovery | build + vitest + **G2**；不达标即回滚 |
| **B7** | Tier B3（Codex W4 — 让 ⑤ 承载真实职责）：提取步骤6/7 summary+README 写盘 seam（`writeSummaryArtifact`/`writeReadmeIndex`）入 artifact-reporting；③ 若在读码后发现 p-limit 调度块（1105–1150）可闭合提取则同批提取，否则 residual-report 显式记录 ③⑤ 残留边界与理由 | build + vitest + G2；不达标即回滚 |
| **B8** | facade 收口：batch-orchestrator.ts 仅剩 orchestration(runBatch) + 公共类型 + re-export barrel；残留扫描 + residual-report | 全量 vitest + build + typecheck:tests + repo:check + release:check + G1/G2/G3 |

每批完成后 commit（commit 前跑 Codex 对抗审查，按 CLAUDE.local.md；相邻 Tier A 小批可合并送审）。

---

## 4. Byte-stable / 零漂移验证协议（Codex 审查后 v2 —— 修复 C2/C3/C4/C5）

**核心修正（Codex C2）**：连跑两次只证"确定性"，不证"相对重构前无漂移"。协议改为 **拆前冻结 → 每批对冻结基线比对**。

### 4.1 冻结基线（任何搬迁前建立，作为唯一参照）

| 基线 | 建立方式 | 比对方式 |
|------|---------|---------|
| **G1 graph-only 冻结产物** | 拆前对 `~/.spectra-baselines/micrograd`（外部 clone、commit 稳定）跑 `buildAstGraphOnly`，graph.json 全文入冻结目录 + SHA-256 | 每批后重跑 → **与冻结文件逐字节 diff**（非两次自比） |

> **G1 已冻结（拆前实测）**：micrograd @ `c911406`；33 nodes / 37 edges / 7 calls / 2 depends-on / 5 python symbols；`SHA-256(_meta/graph.json) = db854b853a6af800940a56401c833588c8ba77b273b5f8e6b1103bc9e4946cb8`；双跑逐字节相等（确定性 PASS）。采集脚本入库：`specs/220-batch-orchestrator-decomposition/g1-freeze.mts`；冻结产物在 session scratchpad `g1-frozen-pre/`（哈希以本文件为准，产物丢失可由脚本重采并对哈希验真）。
| **G2 mock-LLM 特征化测试**（characterization） | 拆前新增 `tests/e2e/f220-decomposition-charter.e2e.test.ts`：复用 F175 `vi.mock('@anthropic-ai/sdk')` 范式，**零付费**跑 runBatch 语言矩阵（纯 TS / 纯 Python / 多语言 / languages 过滤 / 未知语言 fallback），vitest snapshot 冻结 processedLanguages、moduleGraph 形态、processingOrder、产物内容（规范化运行态字段后） | 拆前生成 snapshot 并 commit；重构全程 snapshot 文件不许再生 → 任何行为漂移=红（**这是 B5/B6 seam 的主门，修复 C5：graph-only 门不执行 scanFiles/groupFilesByLanguage/graph 选择路径**） |
| **G3 导出面合同测试** | 拆前新增 `tests/unit/batch/f220-export-surface.test.ts`：runtime `import * as` 断言 11 个 value 符号精确集合 + facade 源码 14 名文本合同 + 禁 `export *` + **静态断言 stages 不得 import facade**（防 ESM 环，Codex W1）与 ①禁反向依赖②；类型侧新增 `tests/type-tests/f220-orchestrator-exports.typecheck.ts` import 3 个 interface（`BatchOptions`/`BatchResult`/`GraphOnlyResult`）——落地时发现主 type-tests tsconfig 的 `exactOptionalPropertyTypes: true` 会对整个 src import 闭包报出与 F220 无关的预存严格性错误（spec-store/file-scanner 等），故建专属 `tests/type-tests/f220.tsconfig.json`（与 src 同基线），`typecheck:tests` 脚本串联两个 tsconfig（修复 C1：主 tsconfig 排除 tests/，`GraphOnlyResult` 现无任何 facade 消费者，漏 re-export 时 vitest/tsc 均不红） | 每批后跑 |

### 4.2 mode 覆盖口径（修复 C3 —— "byte-stable" 定义为可执行合同）

| mode | 门 |
|------|-----|
| **graph-only** | G1 冻结逐字节 + 既有 `graph-only-pipeline`/`graph-only-cli`/`mcp-batch-graph-only` 测试 + F217 `graph-quality` 六指标 |
| **full** | G2 特征化 snapshot（mock-LLM 零付费；产物合同=模块 spec 内容 + graph deepEqual + processingOrder；**排除**含时间戳/耗时的运行态文件：`batch-summary-*.md` 文件名含 `Date.now()`、`_index.spec.md` 的 lastUpdated——与 F175 场景10 既有规范化口径一致）+ 既有 F175 场景10 |
| **incremental** | G2 增量场景 + 既有 `batch-incremental*` 全绿（checkpoint 恢复语义由 F182 测试群 + charter 增量场景覆盖） |

**facade 导出语法（修复 C1）**：显式白名单 `export { … } from './stages/…'` + `export type { … } from`；**禁止 `export *`**（防把 stage 内部 helper 泄漏进公共 API）。**stages 禁止 runtime import facade**（W1：tsc 不抓 ESM 环，TDZ 在 Node 运行时才炸；由 G3 静态断言把关）。

---

## 5. batch-project-docs.ts 处置（显式决策）

**Defer，不在本 Feature 同拆。** 理由见 impact-report §7：scope 纪律（M9 §6 五段仅针对 batch-orchestrator）、风险隔离（避免两枢纽 byte-stable 回归面叠加）、无前置依赖。→ 记为 M9/M10 follow-up 独立 Feature 候选。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 循环依赖（stage 互相 import） | 依 impact 证据固定有向边 ②→①；facade→全部；stage 之间禁反向 import；tsc 会抓循环 |
| buildAstGraphOnly 行为漂移（F195） | B3 单独成批 + graph-only reproducibility diff + 其全部既有测试 |
| checkpoint 状态机漂移（F182） | helper 逐字搬迁 + 保持纯同步（不引入 await）+ 增量测试全绿 |
| Tier B seam 引入隐性 drift | 每 seam 独立 commit、byte-stable 门控、不达标即回滚（Tier A 已达成核心目标） |
| 导出面遗漏 | 每批导出双向差集核对（空差集范式） |
| **logger 命名空间漂移** | 已核实 `createLogger` 是纯工厂（`[namespace] LEVEL: msg`，无 singleton/registry/副作用）。移出的 logging 函数（`buildAstGraphOnly`/`buildGraphForLanguageGroup`）在新模块必须 `createLogger('batch-orchestrator')` —— 命名空间字面值不变 → 日志输出 byte-identical |
| **模块常量搬迁** | `MD_SCAN_DIR_BLACKLIST`(2130) 仅被 `collectMdRecursive` 使用，随其入 source-discovery；`SPECTRA_VERSION`/`RETRY_TOKEN_BUDGET`/`ESTIMATED_FAILED_CALL_INPUT` 仅被 runBatch 主体使用，**留在 orchestrator**（不搬） |

---

## 7. 与 F219 并行 disjoint

不碰 `scripts/spec-drift` / `repo:check` 检查族定义。`specs/src.spec.md` 排除出 commit。

---

## 8. Codex 设计阶段对抗审查处置记录（Phase 2 gate）

审查结论：5 critical / 4 warning / 3 info。全部处置如下：

| 级别 | 发现 | 处置 |
|------|------|------|
| C1 导出门可"全绿但缺类型"（GraphOnlyResult 无 facade 消费者；主 tsconfig 排除 tests/） | ✅ 采纳：G3 双层门（runtime 11-value 集合断言 + `tests/type-tests/*.test-d.ts` 3 interface）+ 显式白名单 re-export、禁 `export *` | §4.1/§4.2 |
| C2 reproducibility 连跑两次只证确定性不证无漂移 | ✅ 采纳：改为拆前冻结 micrograd graph.json 全文 + 每批对冻结基线逐字节 diff（G1） | §4.1 |
| C3 full/incremental "byte-stable" 字面口径不可执行（summary 文件名含 Date.now() 等） | ✅ 采纳：定义可执行产物合同（模块 spec + graph deepEqual + processingOrder；排除运行态文件，与 F175 场景10 同口径） | §4.2 |
| C4 mock-LLM 可零付费测 full/incremental；checkpoint 状态机盲区 | ✅ 采纳：G2 特征化测试复用 F175 mock 范式；B1 补状态机互斥去重单测。forceRegenerate:true 恢复 E2E 记入 charter 增量场景评估 | §3 |
| C5 graph-only 门不执行 B5/B6 被提取代码（scanFiles/groupFilesByLanguage/graph 选择） | ✅ 采纳：B5/B6 主门改为 G2（mock-LLM runBatch 语言矩阵） | §3 |
| W1 tsc 不抓 ESM 环；stage runtime-import facade 会 TDZ | ✅ 采纳：规则"stages 禁止 import facade"+ G3 静态断言 | §4.2 |
| W2 "纯函数"措辞错误 | ✅ 采纳：改称 dependency-closed relocation，注明真纯函数仅 4 个 | §2 |
| W3 消费者清单 41 个（3 生产 + 38 测试）非 30 | ✅ 采纳：impact-report 以命令输出为准修正（见该文档 §3 附注） | impact-report |
| W4 ③⑤ 近空壳 vs "五段各自独立可测" | ✅ 采纳：B7 给 ⑤ 提取真实 summary/README seam；③ 调度块读码后决定，提不动则 residual-report 显式记录（诚实披露优于强拆） | §3 |
| I1 logger/常量策略、I2 batch-project-docs defer、I3 B1/B2 参数闭包 | 已核实无问题（info 确认项） | — |

---

## 9. Codex G 层（守护代码）对抗审查处置记录（Batch G commit gate）

审查结论：5 critical / 4 warning / 3 info。全部处置如下：

| 级别 | 发现 | 处置 |
|------|------|------|
| C1 G2 只冻结 graph 投影（id/kind/三元组），directional/confidence/元数据/hyperedges 漂移不红 | ✅ 修复：`graphContract` 全量归一化 GraphJSON 入快照；仅字段级剥换 generatedAt/sourceCommit/inputHash（F175 同口径） |
| C2 B7 搬迁目标（summary/README/_index）零内容守护，空文件化/参数断线全绿 | ✅ 修复：`reportingArtifacts` 冻结三者清洗后全文 |
| C3 checkpoint 写/清理被执行但恢复链无验证 | ✅ 修复：场景8 失败→checkpoint 全文合同→resume（completed 跳过/failed 重生成/清理断言）+ 场景7 full 旁路；B1 状态机单测随 B1 批落地 |
| C4 文本正则导出合同可被注释/字符串/别名/`export type *` 绕过；类型探针不锁形状；CI 不跑 typecheck:tests | ✅ 修复：ts-morph 编译器级导出枚举（14 名双向 + value/type 种类 + AST 级 star-ban）；Equal 双向类型形状冻结（GraphOnlyResult 整体、Options/Result keyof 全集）。**残留（记录）**：CI workflow 不在本 Feature 改（与 F219 disjoint 纪律）；ts-morph 测试跑在普通 vitest（CI 覆盖），typecheck:tests 为每批手动门 |
| C5 stage 依赖禁令可被 `.././`/动态 import/子目录/别名绕过，仅禁一条边 | ✅ 修复：递归收集静态/re-export/动态 import specifier → path.resolve 归一化比对；允许边矩阵（仅 ②→①）+ facade 全拼写禁令 |
| W1 scrubber：durationMs 正则破坏 JSON（实锤，checkpoint costMetadata 会触发）；40-hex/ISO 过宽 | ✅ 修复 durationMs 捕获组保引号；inputHash/sourceCommit 字段级；补 basename/batchId/秒级耗时清洗。40-hex/ISO 保持全局（记录：字段级改造对守护目的过度工程，稳定性经 4 连跑实证） |
| W2 场景覆盖缺口 + "full run" 标题误导（实为默认 incremental→首轮 fallback） | ✅ 修复：重命名"默认 regen 路径"；新增场景7（显式 full）/8（resume）/9（dry-run 零 LLM）/10（code-only）。budget gate 场景记录不加（该块不在任何搬迁批内）；reading mode 以 code-only 代表冻结 |
| W3 本地裸跑 vitest 自动"新增"snapshot key；删场景仅 obsolete 警告 | ✅ 修复：场景10a 对 .snap key 集合与场景清单做双向断言 |
| W4 G1 脚本不自校验（HEAD/clean/期望 SHA），忘跑 cmp 即失守 | ✅ 修复：g1-freeze.mts 内嵌期望 HEAD+SHA 自动校验非零退出；冻结产物入库 `frozen-micrograd-graph.json`（19.6KB，比对不再依赖 scratchpad） |
| I1 graph source/target 字段名正确、I2 全量并行不争写 snap、I3 f220.tsconfig 不卷别的测试 | 已核实无问题 |

加固后守护规模：charter 11 用例（10 场景 + key 集合守护，4 连跑稳定）/ export-surface 4 用例（ts-morph）/ typecheck Equal 形状冻结 / G1 自校验门。
