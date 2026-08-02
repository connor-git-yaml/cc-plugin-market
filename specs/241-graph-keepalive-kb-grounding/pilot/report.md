# F241 Grounding Pilot — 正式报告

> 口径冻结于 [measurement-design.md](measurement-design.md)（`0ee233c`，implement 开始前 2h53m），
> 取数后**未回改**任何定义（SC-015 已机器验证）。原始计算见 [metrics-raw.md](metrics-raw.md)，
> M-1 数字由 [ledger-verify.mjs](ledger-verify.mjs) 从 [ledger.jsonl](ledger.jsonl) 机器重算并与本文件逐项比对。
>
> **数字不好看。本报告不为让数字好看做任何口径调整。**

---

## 执行摘要

| 指标 | 结果 |
|---|---|
| **M-1 grounding 命中率** | 名义 **45.0%**（9/20）；扣除经交叉核对证伪的"假命中"后 **25.0%**（5/20）。**20 次计入调用中有 10 次返回了被 grep 证伪的错误结果** |
| **M-2 impact coverage** | coverage **9.5%**（2/21）、precision **20.0%**（2/10）、missed **19** 个；扣除非 grounding 因素后 coverage′ **14.3%**（2/14） |
| **M-3 review 发现率** | 交集真 finding **4**、A 独有（no-grounding）**3**、B 独有（grounded）**2**、误报 **0**。**方向为负**——grounded 组比对照组少 1 条独有发现 |

**一句话结论**：在本次 N=1 载体上，三项指标均未显示 grounding 的正向信号；M-1 的主要产出不是命中率数字，而是「图会自信地返回错误答案」这一被四分类口径遮蔽的第五态（20 次里 10 次），M-2 的主要产出是漏预测的结构性归因（`plugins/**` 与 `scripts/**` 整体不在图内）。以上均为方向记录，不构成任何可外推的效用判断。

---

## M-1 grounding 命中率

数据源 `ledger.jsonl` 共 27 行，其中 `countsTowardM1: true` 的 **20 行**计入分母
（7 行为口径冻结前的探索性调用或 M-3 包构造的重复查询，2 行为 symbol-not-found 后按 fuzzy 候选重查的首次调用，已并入后继行）。

<!-- ledger-verify:m1:begin -->

| 项 | 值 |
|---|---|
| `hit` | 8 |
| `fuzzy-hit` | 1 |
| `miss-empty` | 7 |
| `miss-structural` | 4 |
| 计入 M-1 的调用总数 | 20 |
| 名义命中数（hit + fuzzy-hit） | 9 |
| 名义命中率 | 45.0% |
| 经交叉核对证实结果错误 | 10 |
| —— 其中被四分类计为 hit / fuzzy-hit | 4 |
| —— 其中人工无法判定（该为空还是漏报） | 1 |
| 修正后可信命中数 | 5 |
| 修正后可信命中率 | 25.0% |
| `.mjs` target 调用数 | 3 |
| `.mjs` target 命中数 | 0 |
| `.mjs` 命中率（结构性封顶） | 0.0% |

<!-- ledger-verify:m1:end -->

### 本节最重要的一条：20 次调用中 10 次返回了被 grep 证伪的错误结果

这不是"没查到"，而是**查到了、返回了非错误响应、内容是错的**。逐条可追溯到 ledger 行：

| ledger seq | target | 图返回 | grep 交叉核对实况 |
|---|---|---|---|
| `1-5` | `scaffold-kb.ts::runScaffoldKb` | 0 caller | `src/cli/index.ts:223` 确有调用 |
| `1-6` | `kb-search.ts::executeKbSearch` | 0 caller | 同文件 `registerKbSearchTool` 确有调用 |
| `1-8` | `search-core.ts::searchKbCore` | directCallers **2** | 实际 ≥ **4** |
| `1-11` | `kb-search.ts::executeKbSearch` | 0 caller | 同上（fresh 图上复现） |
| `1-12` | `kb-api-lookup.ts::executeKbApiLookup` | 0 caller | 同文件 `:256` 确有调用 |
| `1-13` | `kb-locator.ts::loadKbContext` | directCallers **1** | 实际 **2** 个生产调用方 + 5 个测试文件 |
| `1-15` | `scaffold-kb.ts::runScaffoldKb` | 0 caller | 与 `1-5` 同 target 同错，跨两版图 |
| `1-21` | `kb-search.ts::executeKbSearch` | 0 caller | O-7 第四次复现，跨第三版图 |
| `1-22` | `kb-api-lookup.ts::executeKbApiLookup` | 0 caller | 同文件 `:282` 确有调用 |
| `1-23` | `nohit-recorder.ts::recordNoHit` | directCallers **2** | 本体建图正确，两处 file-private 调用方漏报 |

其中 **4 条**（`1-5` / `1-8` / `1-13` / `1-23`）在四分类里被计成 `hit` 或 `fuzzy-hit`——
即名义 45% 里有 4 个样本位是假命中。扣掉后**修正后可信命中率 25.0%**。

**为什么两个数都要报**：只报 45% 是误导（把假命中算作命中）；只报 25% 则隐藏了
「有 4 次是先给出看似正常的结果、事后才被证伪」这一层——后者的危害高于直接 no-hit，
因为 no-hit 会让使用者自知无知并退回 Grep，而"自信的错误答案"不会。

### `.mjs` 侧命中率结构性封顶为 0

计入 M-1 的 20 次调用中有 3 次 target 落在 `.mjs`（`1-7` / `1-9` / `1-10`），
**全部 `miss-structural`，命中数 0，命中率 0.0%**。

根因指针：**O-5** —— `walkTsJsFiles` 的扩展名白名单只收 `.ts/.tsx/.js/.jsx`
（`src/panoramic/source-discovery.ts:509-514`），仓内 84 个 `.mjs` 文件零节点入图。
这不是采样运气差：本 feature 的 B4 接线代码 100% 落在 `plugins/spec-driver/scripts/lib/*.mjs`，
因此该区块的每一次面向自身改动面的查询都必然 `miss-structural`。
spec D6 已把修复显式登记为 out-of-scope，故此封顶在本 feature 内不可能改善。

---

## M-2 impact coverage

预测集冻结于 [predicted-impact-set.md](predicted-impact-set.md)（`0ee233c`），
实际集 = `git diff --name-status 6950b08 HEAD` 中的**既有文件修改**，
按冻结口径剔除 **26 个纯新增文件**与 `specs/**` 文档。

```
|预测集| = 10
|实际集| = 21
|交集|   = 2   → src/kb-mcp/tools/kb-search.ts、src/kb-mcp/tools/kb-api-lookup.ts

coverage（召回） = 2/21 = 9.5%
precision        = 2/10 = 20.0%
missed           = 19
```

### missed 19 条逐条归因（每文件恰归一类，合计校验 = 19）

| 归因类别 | 文件数 | 文件 | 是否 grounding 的锅 |
|---|---|---|---|
| **`plugins/` 不在图内**（O-5 结构性） | 5 | `skills/spec-driver-feature/SKILL.md`（canonical）、`skills-codex/.../SKILL.md`、`.codex/skills/.../SKILL.md`、`scripts/lib/ensure-gitignore.sh`、`tests/ensure-gitignore.test.mjs` | 是——图覆盖缺口 |
| **仓根 `scripts/` 不在图内** | 1 | `scripts/lib/graph-bootstrap-status.mjs` | 是——同 O-5 扩展名范围问题 |
| **非代码文件** | 1 | `.gitignore` | 否——impact 本就不覆盖 |
| **测试文件**（图内，但预测锚点未指向） | 6 | `tests/kb/` ×5（`cli-scaffold-kb` / `kb-api-lookup-tool` / `kb-contract` / `kb-search-tool` / `scaffold-kb-query`）、`tests/unit/worktree-lifecycle-hook.test.ts` | 部分——测试是 caller，理论上 impact 该报 |
| **设计中途新增的改动面**（预测时不存在） | 6 | `src/cli/` ×3（`commands/scaffold-kb` / `index` / `utils/parse-args`）、`src/kb-mcp/lib/kb-locator.ts`、`src/panoramic/project-context.ts`、`src/scaffold-kb/tokenizer.ts` | 否——需求演进（P-W5 补 CLI 可达性、B2-1 抽 NFKC、B2-9 加 dbPath thunk）产生 |

合计 **5 + 1 + 1 + 6 + 6 = 19**

**扣除「非 grounding 之过」的 7 个**（非代码 1 + 需求演进 6）后：

```
coverage′ = 2/14 = 14.3%
```

仍然很低。主因不是预测方法的粗糙，而是 `plugins/**` 与 `scripts/**` 整体不在图内——
本 feature 恰好有 6/21 的改动面落在这两处，对它们的 coverage **结构性封顶为 0**。

> 按 predicted-impact-set.md 的预先声明，此处**不采用**「排除 plugins 后 coverage 更好看」的重新切分。
> coverage′ 只扣除了口径上确实不该由 impact 负责的两类（非代码文件、预测时尚不存在的改动面），
> `plugins/**` 与 `scripts/**` 仍留在分母里，因为它们是真实缺陷的度量而非测量噪声。

### precision 噪声 8 条（预测了但没改）

| 文件 | 来源锚点 |
|---|---|
| `src/mcp/lib/telemetry.ts` | `withTelemetry`（锚点自身） |
| `src/mcp/graph-tools.ts` | `withTelemetry` upstream |
| `src/mcp/server.ts` | `withTelemetry` upstream |
| `src/mcp/index.ts` | `withTelemetry` upstream |
| `src/kb-mcp/server.ts` | `withTelemetry` upstream |
| `src/kb-mcp/tools/kb-doc-lookup.ts` | `withTelemetry` upstream |
| `src/scaffold-kb/schema-compat.ts` | `hasProvenanceColumns`（锚点自身） |
| `src/scaffold-kb/search-core.ts` | `hasProvenanceColumns` upstream |

6 条来自 `withTelemetry` 锚点链——预测时以为要改 telemetry 装饰层，
实际 B2 裁决把 no-hit 挂点放在 `executeXxx` 函数内部而非装饰层，整条 upstream 链都没动。
另 2 条来自 `hasProvenanceColumns` 锚点链——批 3 改为直接 `import` 该函数而非改它本身。

**两者都是预测方法的问题（锚点选错），不是图的问题**——这 8 条里图返回的关系链本身是正确的
（`1-1` / `1-2` 两次调用均经 grep 核对无误），只是"改动会落在哪"这个判断错了。

---

## M-3 review 发现率（A/B 对照）

执行与判读见 [m3/judgment.md](m3/judgment.md)，预注册见 [m3-preregistration.md](m3-preregistration.md)。
被审 diff：`batch2.diff` 1918 行 / 17 文件，SHA-256 `7a888daa1d14b1b37fa04bd9f0d02efcc29bdc60c64348e83019dafda45022c1`。
两组 prompt 除 grounding 包外逐字相同，同 agent 类型、同模型档位、同一消息内并行发起。

| 指标 | 值 | 明细 |
|---|---|---|
| **交集真 finding** | **4** | NFKC 顺序、FIFO/symlink、读取失败误报为 no-data、flag 校验 |
| **A 独有真 finding（no-grounding）** | **3** | 单 token 整串落盘、大小写变体绕过 distinctQueries 阈值、无可用库源时仍记 coverage gap |
| **B 独有真 finding（grounded）** | **2** | `tool` 字段无运行时 allowlist、`dbPath` 在保护边界外求值 |
| 误报（任一组） | **0** | 两组全部 finding 经复核均成立 |

### 方向：负

**grounded 组的独有真 finding 比对照组少 1 条（2 < 3）。** 如实记录，不改判口径去凑正向结果。

judgment.md 的三点观察原样转述，不做有利改写：

1. **A 独有的三条集中在「数据流语义」**（单 token 时 term 等于原串、hash 归一化口径、无源 vs 无命中的语义区分）——靠通读 diff 的数据流推理得出，与调用图无关。
2. **B 独有的两条集中在「边界契约」**（导出函数入参校验、JS 求值顺序穿透保护边界）——这类问题的形式确实是「谁会调用它、以什么形态调用」。但**不能据此归因于 grounding**：B 组在自己报告里写明「仅将 pre-batch 图结果作为方向性提示，没有把它当成新代码事实」，且提供给它的 4 条 grounding 里 **3 条是错的**（两个 0-caller 误报、一个部分漏报）。
3. **给了错误的 grounding 是否有害**：B 组没有被 `directCallers: 0` 误导成「这函数没人调、风险低」，仍审出了 `tool` 边界问题——这是个正面信号（审查者对错误 grounding 有一定免疫力），但 N=1，不构成结论。

**3 vs 2 这个差值在统计上无意义。禁止把它外推为任何方向的效用判断。**

> 附带记录（与 grounding 假设无关）：本轮 A/B 两组合计审出 **9 条真 finding / 0 误报**，
> 全部进入批 2 整改。这是"把对抗审查加倍"的收益，不是 grounding 的收益。

---

## 口径缺陷

按 measurement-design.md 冻结声明，口径定义不回改，缺陷在此追加说明。

### (a) M-1 四分类无法表达「解析成功但内容错误」的第五态

四分类（`hit` / `fuzzy-hit` / `miss-structural` / `miss-empty`）隐含假设「精确解析成功 = 结果可用」。
实测存在第五态：**解析成功、返回非错误响应、但内容经 grep 交叉核对被证伪**。
它会被计入 `hit` / `fuzzy-hit`（4 次）或 `miss-empty`（6 次），前者直接**高估**命中率。

该缺陷在取数当下即被自证并记入 `mcp-call-log.md` 分段 1 的批注，不是事后补救。
处置：给出**名义 45.0% 与修正后 25.0% 两个数**，并把"10/20 返回错误结果"作为独立事实呈现。
两个数都不删——单给任一个都会误导。

**O-8 形态尤其难被察觉**：`searchKbCore` 图报 directCallers 2、实际 ≥4；
`loadKbContext` 图报 1、实际 2。这类**非零但偏低的 undercount** 有结果，使用者更不会怀疑；
四分类把它们计成 `hit`，而 FR-006 的 caveat 设计（只在 `directCallers: 0` 时注解）**覆盖不到**它。

### (b) M-2 初版算术错误 —— 取数纪律的真实失误，如实登记

`metrics-raw.md` 初版把 `governance-constants.ts` 同时计入「纯新增」与「既有修改」
（它是批 2 新增、批 3 修改），导致分母误为 22；归因表还把 `kb-contract.test.ts` 在两类里重复计数、
`plugins/**` 行写 4 实际列了 5。

**这是我自己算错的，由 Codex 批 3 对抗审查 W4 抓到**，不是主动发现。v2 已按
「相对 batch1-base `6950b08`、同文件 A 优先于 M」去重复算，本报告用的是 v2 数字（分母 21）。

**同一类失误在本批 4 复算时又出现一次**（第三次）：metrics-raw.md v2 的
「precision 噪声逐条」小节写「8 个……全部来自 `withTelemetry` 的 upstream 链（`src/mcp/**` 5 个 + kb-doc-lookup + kb-server）」。
逐项枚举实为 `src/mcp/**` **4** 个、withTelemetry 链合计 **6** 条，另 **2** 条
（`schema-compat.ts` / `search-core.ts`）来自 `hasProvenanceColumns` 锚点，
且其列出项相加为 7 而非 8。**本报告上表已改为逐文件枚举并标注来源锚点**，
headline 的 precision = 2/10 不受影响（噪声总数 8 正确，错的是它的分类描述）。

**教训**：三次失误全部集中在「人手工汇总的分类小计」上，而机器可重算的 headline 数字一次没错。
这直接说明为什么 M-1 要做 `ledger-verify.mjs`——以及为什么 M-2 的归因表**目前仍无机器校验**，
是本报告已知的薄弱点。

### (c) 台账是自报的 —— 机器重算只治算术漂移，不治自报偏置

`ledger-verify.mjs` 能保证 report.md 里的 M-1 数字与 `ledger.jsonl` 逐项一致，
它治的是抄错、算错、改报告忘改台账。

**它治不了的是**：台账每一行的类别是我（编排器 / 实现子代理）在调用当下自己判的。
判错、漏记、或者"挑好查的 symbol 来查"，机器重算只会忠实地把同一个偏差再算一遍。
换言之，**机器台账只治算术漂移、不治自报偏置**。

缓解措施（部分有效）：M-2 预测集先于 implement 冻结且覆盖全部计划改动锚点（不允许只挑图内的），
SC-015 已机器验证冻结时序；continuous capture 要求调用当下即记、每批门禁核对条目数与 `seq` 单调。
这些约束住了"事后挑数据"，但约束不住"当下判错类别"。

### (d) M-3 的对照只有一次采样

A/B 两组各跑一次，无重复。两组模型档位相同但 LLM 输出本身有随机性，
3 vs 2 的差值完全在单次采样噪声范围内。要区分信号与噪声需要 N 次重复，本 pilot 未做（配额与时间边界）。

---

## FR-023 诚实性声明

以下五项为本报告的强制声明，不得省略、不得弱化：

1. **N=1** —— 载体是 F241 单个 feature 的开发过程，不是 feature 样本集。三项指标的每一个数字都来自这一个样本。
2. **判读者非盲** —— M-1 的类别判定、M-2 的归因分类、M-3 的 finding 真伪判定，全部由编排器（同时是被审代码的委派方）做出，无独立盲评。
3. **单次采样** —— M-3 的 A/B 各执行一次；M-1 的每个 target 未做重复查询取一致性（同 target 跨版图重复出现的 4 次是自然发生的，不是设计的重测）。
4. **自我选择偏置** —— MCP 调用由我自己发起，且我知道正在被测量，存在"挑好查的 symbol 来查"的倾向。M-2 预测集先于 implement 冻结是对此的部分缓解，但 M-1 的调用序列没有这层保护。**机器台账只治算术漂移、不治自报偏置**（见口径缺陷 (c)）。
5. **结构性封顶** —— `.mjs` 侧的 grounding 命中率**结构性封顶为 0**（3 次调用 0 命中），根因 O-5 已定位且在 spec D6 显式登记为 out-of-scope。本 feature 的 B4 区块无论怎么查都不可能有非零命中，这部分数字反映的是图的覆盖边界，不是查询质量。

---

## 图缺陷发现清单

| 观测 | 形态 | 登记状态 |
|---|---|---|
| O-3 | 实参位置 arrow function **函数体内**的调用漏建 calls 边 | F241 spec **Non-Goals #5** 显式 out-of-scope |
| O-5 | `.mjs`（与 `.cjs`）不在 TS/JS walker 扩展名白名单 | M9 §7.5.4 已登记 + F241 spec **D6 / Non-Goals #4** out-of-scope |
| O-7（收窄版） | **嵌套函数表达式体内的调用不归属外层 named symbol** | 仅记录在本 pilot 制品，**无独立卡** |
| O-8 | 非零但偏低的 caller undercount | 仅记录在本 pilot 制品，**无独立卡** |
| O-9 | 图在每次 commit 后必然 commit 级 stale | 即 F241 B4 的立项动机，本 feature 内已处置 |

> **如实纠正一处 over-claim**：`trace.md:46-47` 写「两类 calls 边漏建实证 → **已立 follow-up 卡**」。
> 复核仓内制品：**O-3 与 O-5 确有登记**（前者在 F241 spec Non-Goals #5，后者在 M9 §7.5.4 + spec D6），
> 但**不存在任何独立的 follow-up 卡文件**，O-7 收窄结论与 O-8 只存在于本 pilot 目录的 markdown 里。
> 「已立卡」是不准确的表述。O-7/O-8 需要在 M9 收官或 M10 规划时补正式登记，否则会随本 feature 沉底。

### O-3 —— 实参 arrow function 体内调用漏建

`kb-search.ts:137-148` 的
`server.tool('kb_search', DESC, {…}, withTelemetry('kb_search', async (args) => executeKbSearch(ctx, args)))`：
图建了 `registerKbSearchTool → withTelemetry`（实参位置的**直接**调用被抓到），
但没有 `registerKbSearchTool → executeKbSearch`。在 fresh 图（6092 节点 / 8062 边、`overallVerdict: pass`）上
直查 graph.json 原始 links：`executeKbSearch` 入边只有 1 条 `contains`、零 `calls`。
**排除 staleness**：跨 `2e3a4cd` / `fd9af7f` / `bc3bfb5` 三版图稳定复现。
危害等级高于 no-hit——`impact` 自信回答「0 caller / 低风险」，使用者不知道自己被误导。
**处置：out-of-scope**（属 Spectra AST 抽取面，spec Non-Goals #5）。

### O-5 —— `.mjs` 扩展名缺口

`plugins/` 下 84 个 `.mjs`、`.ts/.js/.cjs` 各 0 个；目录未被 gitignore、不在 `TSJS_SKELETON_IGNORE_DIRS`；
图中 `plugins/` 前缀节点 **0**，按扩展名分布 `{ts:5839, py:159, go:40, java:50}`，`.mjs` 一个都没有。
根因为 `walkTsJsFiles` 白名单只收 `.ts/.tsx/.js/.jsx`（`source-discovery.ts:509-514`）——
不是"插件目录被有意排除"，而是 walker 漏了扩展名。
**处置：out-of-scope**（spec D6：修它会一次性灌入 84 个文件的节点/边，直接改动 F217 质量门六指标基线与 golden-master 断言，需独立回归预算）。
**代价已在本报告 M-1 / M-2 两处如实计价，未做任何排除。**

### O-7（收窄版）—— 嵌套闭包内的调用不归属外层 symbol

> **给将来修这个 bug 的人**：O-7 的**原始描述已被实测证伪，别按那个方向查**。

已排除的两个假设（不要重复排查）：

1. **不是「同文件 export 互调不建边」**。反证（ledger `1-24`）：`schema-compat.ts` 里
   `provenanceSelectFragment → hasProvenanceColumns` 是同文件两个 export 互调，图里**正常建了边**。
2. **不是 staleness**。跨三个 fresh 图快照稳定复现。

收窄后的真实共因：**位于嵌套函数表达式（arrow function / function expression）体内的调用，
不归属到其外层 named symbol**。四次证伪（`1-11` / `1-12` / `1-21` / `1-22`）共享同一形态。
建议修法：callee 归属沿 AST **向上找最近的 named symbol**，而不是遇到函数表达式就中断归属。

仍待核实的相邻形态：动态 `await import()` 解构（`src/cli/index.ts:222-223`，`1-5` / `1-15` 复现）可能同源也可能独立；
`file-private` 非 export 函数不入图（`documentFallback` / `runQuery`）是 O-5 的已知盲区，**不是** O-7，别混为一谈。
**处置：无独立卡，需补登记。**

### O-8 —— 非零但偏低的 caller undercount

`searchKbCore` 图报 directCallers **2**、grep 实际 ≥ **4**；`loadKbContext` 图报 **1**、实际 **2** 个生产调用方 + 5 个测试文件。
与 O-3/O-7 的区别：不是零命中，是**计数低估**——最难被察觉的形态（有结果就更不会怀疑）。
**对 F241 设计的直接约束**：FR-006 的 `annotateImpactCaveat` 只在 `directCallers: 0` 时注解，
**结构上覆盖不到 undercount**。这是本 feature 已知且接受的能力边界，不是实现缺陷。
**处置：无独立卡，需补登记。**

### O-9 —— 图在每次 commit 后必然 commit 级 stale

`0ee233c` 提交后，pre-commit `repo:check` 的 `graph-quality:freshness` 立即转 warn（图锚 `2e3a4cd` vs 新 HEAD）。
这是 B4 立项动机的天然复现：warn-not-fail 是正确的门禁行为；刷新应由**消费需求驱动**
（implement 前重建一次，实测 3.5-4.4s），而非每 commit 无条件重建。
**处置：本 feature 内已处置**——即 B4 条件保活决策矩阵所解决的问题。

---

## B4 决策矩阵实测

> **适用范围声明（防 over-claim）**：以下证据来自单测 / 集成测试与 CLI 手跑。
> **本 feature 自身的 implement 并未运行 goal_loop**（`effective-orchestration` 实测 implement phase 的
> `agent_mode = single`，goal_loop 仍是 opt-in 且 spec Non-Goals #10 禁止改默认）。
> 因此这不是"生产 goal_loop 端到端 pilot"，而是决策链路的可执行验证。

三类任务各自走对了路径：

| 任务类别 | 期望路径 | 实测证据 |
|---|---|---|
| **纯新增（additive-only）** | 矩阵首行截住 → `skip-impact`，**不触发刷新** | **SC-003**（`graph-consumption-cli.test.mjs` Part 4）：非 dry-run + additive-only fixture，图文件 SHA-256 全程不变，0.9s。见 `verification/batch1-red-evidence.md` T019 |
| **改既有 + 图 stale + 刷新允许** | `refresh-then-consume` → 刷新成功后收口为 `consume-impact` | **SC-002**（同文件 Part 4）：真实 stale 图的临时 git fixture 上非 dry-run 跑 `decide`，`refreshOk: true`、`refreshDurationMs` 非空、审计恰 1 条 `decision` 事件，1.3s |
| **降级态（12 类 reason）** | 输出封闭键集 + 固定人读模板，**零自由文本评价** | **SC-004**（Part 1）：CLI JSON 封闭键集合断言 + 12 个 `DEGRADED_REASONS` → 固定模板一一对应映射表测试。**SC-005**（Part 2）：12 值各构造一次非 dry-run `decide`，逐值断言审计事件 `degradedReason` 字段 |

补充一条**在本仓真实配置上**的手跑（`verification/batch1-gate.md` RG-002 实跑段，非 fixture）：

```
node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide \
  --project-root "$PWD" --refresh-policy allowed --dry-run --format json
→ exit 0
→ outcome=refresh-then-consume  matchedRule=10  refreshAttempted=false
→ inputs={"changeClass":"modifies-existing","graphAvailability":"present",
           "freshness":"dirty","coverageScope":"in-graph-scope","refreshPolicy":"allowed"}
→ specs/_meta/graph.json SHA-256 前后一致；.specify/graph-consumption-audit.jsonl 未被创建
```

当时 worktree 确有未提交改动，`freshness=dirty` 是真实状态；矩阵行 10（dirty × allowed）
给出 `refresh-then-consume` 与 spec 表一致；dry-run 未真刷，故 `refreshAttempted=false`。

> **如实标注**：SC-002 / SC-003 两条**首跑即绿**，无独立红态
> （Part 4 依赖的 `decide` 主链已在 T015/T017 落地，本段验证的是真实 spectra 行为而非新增业务逻辑）。
> 已记录于 `verification/batch1-red-evidence.md` T019 节。

---

## 复算方式

```bash
# M-1：从 ledger.jsonl 重算四分类 / 命中率 / 交叉核对错误数，并与本文件标记区块逐项比对
node specs/241-graph-keepalive-kb-grounding/pilot/ledger-verify.mjs

# M-2：实际集（既有文件修改，剔除纯新增与 specs/241）
git diff --name-status 6950b08 HEAD | grep -v 'specs/241' | awk '$1=="M"{print $2}' | sort

# M-3：diff 同一性
shasum -a 256 specs/241-graph-keepalive-kb-grounding/pilot/m3/batch2.diff
diff specs/241-graph-keepalive-kb-grounding/pilot/m3/prompt-a.md \
     specs/241-graph-keepalive-kb-grounding/pilot/m3/prompt-b.md

# SC-015：口径冻结时序
git log --format=%aI -- specs/241-graph-keepalive-kb-grounding/pilot/predicted-impact-set.md
git diff 0ee233c -- specs/241-graph-keepalive-kb-grounding/pilot/measurement-design.md
```

---

## 工具使用反馈（dogfooding 四维度）

> 仓库 dogfooding 约定要求每个需求收尾必附此节。本 feature 特殊之处：**pilot 本身就是 dogfooding 的 dogfooding**
> ——我们用 Spectra 开发 Spectra 的图保活能力，并把这次自用的失败如实量化。

### 1. MCP 是否可用
**可用，零连接/调用故障**。全程 27 次调用（20 次计入 M-1）无一次连接失败、无 namespace 错误、无调用报错。
`graph-only` 重建稳定在 3.5-4.4s，`graph-quality --json` 契约稳定。**基础设施层没有问题。**

### 2. 返回信息是否够用 —— **本轮最大的问题在这里**
- **20 次计入调用中 10 次返回了被 grep 证伪的错误结果**，其中 4 次还被四分类计为 hit/fuzzy-hit
  （即「看起来正常、实际是错的」）。修正后可信命中率仅 **25%**。
- 三类形态：`plugins/**`/`scripts/**` 整体不在图内（O-5，结构性 0 命中）；嵌套闭包内调用不归属外层 symbol
  （O-7 收窄版，产生**自信的 0 caller**）；非零 undercount（O-8，`searchKbCore` 报 2 实际 ≥4）。
- **危害排序**：undercount（O-8）> 自信 0 caller（O-7）> symbol-not-found（O-5）。
  越像正常返回越危险——`symbol-not-found` 至少会让人退回 Grep，`directCallers: 0` 不会。
- **返回体不带 freshness 标记**（O-1）：图 stale 时 impact/context 照常返回，消费方无从判断可信度。
  这正是本 feature B4 要补的洞，但**修的是「决策层要不要消费」，没修「返回体本身要不要自曝」**——
  后者仍是缺口，建议后续在 MCP 响应里附 freshness 字段。

### 3. 流程是否顺畅
- **Spec Driver 编排本身顺畅**：批次门禁、trace 锚点、双台账都可执行。
- **最有价值的一环是每 phase 的 Codex 对抗审查**：五轮共 **27 CRITICAL + 30 WARNING**，其中
  spec/plan/tasks 三轮各判一次 BLOCKED——**如果直接进 implement，两步协议会在正常路径上漏审计、
  `phase.id === "verify"` 会让整条接线永不触发**。这两条都不是代码 bug，是设计缺陷，只有对抗审查抓得到。
- **摩擦点**：`codex-rescue` 子代理有一次 API 断连需重试；其审查沙箱只读，无法建 fixture，
  多次只能用内存 mock 探针替代真实 IO 验证（它自己如实标注了这一限制）。
- **spec-driver 子代理的路径纪律问题**：两个子代理把产物误写进**主仓**而非 worktree，需人工迁回。
  这是可结构化防御的（子代理 prompt 里已写死 worktree 路径仍会犯），建议在 skill 层加落盘路径校验。

### 4. 结果是否准确
见第 2 点的量化。补一条**正面**观测以免偏颇：批 2 新增模块 `recordNoHit` 及其两条跨文件被调边
**首次入图即正确建立**——新代码进图链路是好的，缺陷严格局限于特定语法形态，不是普遍失效。
同样，`hasProvenanceColumns` 的同文件 export→export 边存在，**反证**了我们一度以为的「同文件互调不建边」假设。
**这次 pilot 最实在的产出，是把一个模糊的「图有时候不准」收敛成了一条可直接动手修的精确描述。**

### 转化为后续候选（不在本 feature 修）
1. 嵌套闭包调用归属修复（已登记 M9 §7.5.5 + 会话 task chip，用户已启动其一）
2. `.mjs`/`.cjs` 纳入图扫描（已登记 M9 §7.5.4，需独立回归预算）
3. MCP 返回体自带 freshness 标记（本轮未覆盖的 O-1 残余）
4. 评测脚本十余处 `argv[1]` symlink 静默空转（已立 chip）
