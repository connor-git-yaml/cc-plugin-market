# 问题修复报告 — F196 MCP description Output 字段名防漂移守护

## 问题描述

F184（已 ship 到 master `dd59f1f`）给 Spectra MCP 工具补齐 description（F170c 4 要素：what / Use when / Example / chained usage）。开发中发现一个**跨工具产品隐患**：多个工具 description 里的 `Example: - Output: { ... }` 字段名与**真实返回 schema 漂移**，会反向误导子代理（按错误字段名解析响应）。

F184 实测抓到并修对 4 处漂移，但全靠人工 + Codex 对抗审查偶然发现。现有 description 结构测试（`tests/unit/mcp/description-completeness.test.ts` + `tests/e2e/feature-170c-description.e2e.test.ts`）**只校验段落结构存在**（Use when / Example / chained usage 段 + 长度 ∈ [100,500]），**不校验 Example Output 的字段名是否与真实返回一致**。因此字段名漂移无任何自动化拦截层。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | description Example 的 Output 字段名为何会与真实返回不符？ | F184 手写 Example 时，Output 字段名靠人工记忆/推测填写（如 prepare 写 `skeleton` 单数，真实是 `skeletons` 复数） |
| Why 2 | 这种人工填写为何会漂移？ | description 是手写自然语言 prompt **字符串**，与真实 return 类型（`PrepareResult` / `BatchResult` / `DriftReport` 等）之间**无任何编译期或测试期绑定**，只靠人记忆同步 |
| Why 3 | 为何没有绑定？ | 现有 description 测试从设计上只做"段落结构存在性"校验（4 要素段 + 长度区间），**未覆盖"Example Output 字段名语义正确性"这一维度** |
| Why 4 | 为何只做结构校验？ | F170c / F184 的验收目标是"description 满足 4 要素结构以提升子代理触发率"，字段名正确性不在当时 spec 的 FR 范围；且当时判断"description 字段名必须等于 return 全部 key"的断言**脆且高维护**，主动放弃建 checker（合理的过度抽象规避，但留下缺口） |
| Why 5 | 为何漂移未被任何机制捕获？ | 字段名漂移落在**测试盲区**——既不在类型系统（description 是 `string`，不参与类型检查），也不在现有测试（结构测试不看字段名），只能靠人工 + Codex 偶然发现。缺一个**轻量的"Output 顶层字段名 ⊆ 真实返回顶层 key"子集守护** |

**[ROOT CAUSE REACHED at Why 5]**

**Root Cause**: MCP 工具 description 中的 Output 合约是 description prompt 里的**字符串字面量**（如 `src/mcp/server.ts:84`），与运行时输出构造（`src/mcp/server.ts:117`、`src/mcp/lib/tool-response.ts:74` 的 `data` 对象）**结构上完全解耦、无类型绑定**；二者之间缺少自动化一致性守护，导致字段名漂移只能靠人工发现。

**修复定位（应对 W1）**：因此本 fix 交付的是一道**"顶层 Output 字段名 lint 守护"**——校验 description 举的顶层字段名都真实存在于工具返回的顶层 key 集合；它**不是**完整合约校验器（不校验嵌套 shape、不校验值类型，见下方 C2 known gap）。守护的真值应**尽量从 producer 派生**而非再写一份平行手写清单（应对 C1）。

**Root Cause Chain**: 子代理按错误字段名解析响应 → description Output 字段名漂移 → 手写 string 与 return 类型无绑定 → 现有测试只校验段落结构、不校验字段名 → 字段名正确性不在 F170c/F184 FR 范围且当时规避了脆弱 checker → **测试盲区：缺轻量子集守护**

## 影响范围扫描

### 范围更正（重要诊断发现）

任务描述称"17 工具中所有写了 Output 的（server.ts 5 + graph-tools.ts 6 + file-nav 3 + agent-context 3）"。`grep 'Output:'` 实测：

| 文件 | 带 `Output:{}` 的工具数 | 工具 |
|------|------------------------|------|
| `src/mcp/server.ts` | 5 | prepare / generate / batch / diff / panoramic-query |
| `src/mcp/file-nav-tools.ts` | 3 | view_file / search_in_file / list_directory |
| `src/mcp/agent-context-tools.ts` | 3 | impact / context / detect_changes |
| `src/mcp/graph-tools.ts` | **0** | （F184 只给 graph 6 工具补了 "Use when" + chained usage，**没补 Example/Output**） |

→ **真实是 11 个工具带 Output，不是 17**。**设计含义**：checker 必须**动态发现**哪些 description 含 `Output:`，禁止硬编码工具清单/数量——这样 graph 工具自然 graceful skip，未来任何新增 Output 的工具自动纳入守护。

### 同源问题（需纳入守护）

11 个带 Output 的工具——全部当前已修对（F184），但都缺自动化守护。逐个核对真实返回顶层 key 集合（truth-set）：

| 工具 | description Output（顶层） | 真实返回顶层 key 来源 | 子集 OK |
|------|--------------------------|----------------------|---------|
| prepare | skeletons, mergedSkeleton, detectedLanguages | `PrepareResult`(src/core/single-spec-orchestrator.ts:131): skeletons/mergedSkeleton/context/codeSnippets/filePaths/codeSlices + detectedLanguages(server.ts:117 附加) | ✓ |
| generate | specPath, tokenUsage, confidence, warnings | server.ts:159 **内联**字面量同名 | ✓ |
| batch | successful, skipped, failed, indexGenerated | `BatchResult`(src/batch/batch-orchestrator.ts:201): totalModules/successful/failed/skipped/degraded/duration/indexGenerated/summaryLogPath + 可选 | ✓ |
| diff | summary, items, recommendation | `DriftReport`(src/models/module-spec.ts:246): specPath/sourcePath/generatedAt/specVersion/summary/items/filteredNoise/recommendation/outputPath | ✓ |
| panoramic-query | answer, citations, tokenUsage | natural-language 分支(src/panoramic/query.ts:63): answer/citations/tokenUsage/durationMs/fallbackMode | ✓ |
| view_file | lines, startLine, endLine, totalLines, truncated, nextStepHint | 内联 data(file-nav-tools.ts:255): path/lines/startLine/endLine/totalLines/truncated/[warnings]/nextStepHint | ✓ |
| search_in_file | matches, totalMatches, nextStepHint | 内联 data(file-nav-tools.ts:314): path/matches/totalMatches/returnedMatches/[warnings]/nextStepHint | ✓ |
| list_directory | entries, entryCount, nextStepHint | 内联 data(file-nav-tools.ts:353): path/entries/entryCount/[warnings]/nextStepHint | ✓ |
| impact | affected, summary, topImpacted, nextStepHint | 内联 data(agent-context-tools.ts:251): affected/summary/effective{Depth,MinConfidence,Budget,Direction}/[warnings]/[resolved*]/topImpacted/nextStepHint/[_enrichmentDegraded] | ✓ |
| context | definition, callers, callees, imports, topRelevantCallers, nextStepHint | 内联 data(agent-context-tools.ts:365): definition/[callers]/[callees]/[imports]/[relatedSpec]/[resolved*]/[warnings]/topRelevantCallers/nextStepHint/[_enrichmentDegraded] | ✓ |
| detect_changes | changedSymbols, affectedSymbols, riskSummary, riskTier, topImpacted, nextStepHint | 内联 data(agent-context-tools.ts:636): changedSymbols/affectedSymbols/riskSummary/unmappedFiles/effective*/[warnings]/riskTier/topImpacted/nextStepHint/[_enrichmentDegraded] | ✓ |

**关键约束**：search_in_file 的 `matches: [{line,text,before,after}]`、list_directory 的 `entries: [{name,type,size}]`、impact 的 `topImpacted: [{id,score}]` 含**嵌套结构**——extractor 必须**只取顶层 key**（matches/entries/topImpacted），跳过嵌套的 line/text/before/after/name/type/size/id/score，否则会误判这些合法 description 为漂移（false-positive）。

### 类似模式（需评估）

- graph-tools.ts 6 工具：无 Output（不受影响）。checker 动态发现机制会自动 skip 它们——无需特殊处理，但需测试覆盖"无 Output 工具不报错"。

### F184 那 4 处历史漂移（用作回归 fixture）

| 工具 | 旧错误 Output | 不存在的字段 |
|------|--------------|-------------|
| prepare | `{ skeleton, detectedLanguages }` | `skeleton`（真实是 skeletons 复数） |
| batch | `{ generated, skipped, graphPath }` | `generated`, `graphPath` |
| diff | `{ drifts, newBehaviors, staleItems }` | `drifts`, `newBehaviors`, `staleItems`（全部） |
| panoramic-query | `{ answer / graph / overview }` | `graph`, `overview`（非顶层字段） |

### 同步更新清单

- **新增**：1 个守护测试文件（`tests/unit/mcp/description-output-drift.test.ts`）
- **可能新增**：1 个 pure extractor helper（顶层 key 解析）——co-locate 在测试文件或 tests/ 下的小 helper（test-time 守护逻辑，不属运行时生产代码，避免污染 src/ 覆盖率口径）
- **无需改源 description**：11 个当前已对（F184 修过）；本 fix 是补守护，不改工具行为
- 调用方：无
- 文档：无（守护测试自解释）

## 修复策略

### 方案 A（推荐，已并入 Codex C1 处置）— 子集断言 + producer 派生真值优先

1. **pure extractor** `extractOutputTopLevelKeys(description): string[]`：定位 `Output: { ... }` 段，按括号/方括号深度只收集**深度 0 的 key**（紧邻 `:` 或 `,`/`}` 前的标识符），跳过嵌套 `[{...}]` **与嵌套对象值 `{ ... }`**；在第一个闭合顶层对象的 `}` 处停止（正确处理 panoramic 的 `}（其他 operation...）` 尾随中文散文）。
2. **真值来源 — producer 派生优先（C1 处置核心）**，按工具分层取真实顶层 key：
   - **diff** → `Object.keys(DriftReportSchema.shape)`（`src/models/module-spec.ts:246`，Zod schema 即 producer 合约，运行时零成本派生）
   - **prepare** → 编译期 `Record<keyof PrepareResult, …>` key map（`src/core/single-spec-orchestrator.ts:131`）∪ `detectedLanguages`（server.ts:117 显式附加，注释标注）
   - **batch** → 编译期 `Record<keyof BatchResult, …>` key map（`src/batch/batch-orchestrator.ts:201`，JSON.stringify(result) 原样透传）
   - 上 3 项是 producer 派生 / 编译期绑定：producer 改名即编译错或 schema key 自动变 → **C1 闭合**。且恰好覆盖 4 处历史 F184 漂移中的 3 处。
   - **generate / panoramic-query + 6 个 cheap 工具（view_file/search_in_file/list_directory/impact/context/detect_changes）** → cited 真值列表 `Record<tool, readonly string[]>`，每条注释标 source `file:line`。这 8 个走 hand-list（见下方 C1 残留说明）。
3. **subset 断言**：对每个动态发现的带 Output 工具，`extract(desc) ⊆ realTopLevelKeys(tool)`；失败列出越界字段 + 引用真值 source。
4. **完整性守护**（防真值表覆盖漂移）：
   - (a) 每个带 `Output:` 的工具必须在真值映射有条目（防漏新工具）。
   - (b) 每条真值映射项必须对应真实带 Output 的工具（防 stale）。
5. **回归 fixture**：用合成 drifted description（不改真实源码）证明 extractor+subset 会 flag F184 那 4 类；合法嵌套 fixture（`matches:[{...}]`、`{summary:{...},items}`）+ panoramic 真实尾随散文证明不误报。

**为何不用"全字段相等"**：return 类型字段多（BatchResult 20+ 字段、含可选）、description 只举代表性字段，二者本就不该 1:1。子集断言精确匹配真实缺陷模式（"举了不存在的字段"），不强求列全 → 不脆弱。

### 方案 B（备选）— 运行时取 key

运行时调 6 个 cheap 工具（file-nav/agent-context，不调 LLM）对 fixture graph 取真实 key + server 5 用 TS 类型注册表。更精确（6 个 cheap 工具零 value 漂移），但**两套机制 + 需 fixture graph + 更重**。server 的 prepare/batch/diff/panoramic 无论如何只能从类型取（不能不调 LLM 跑），所以纯运行时方案无法覆盖 4 处 F184 漂移中的核心区域 → 否决纯 B。

**推荐 A**；plan 阶段可权衡是否对 6 个 cheap 工具加运行时 cross-check 作为可选硬化（不作为 MVP 必须）。

## Spec 影响

- 需要更新的 spec：**无需更新**（本 fix 新增守护测试，不改工具行为/接口/返回 schema）。
- 分流：本任务属 M8 之后的代码质量改进，不塞当前 milestone。

## 范围检测

受影响文件：新增 1-2 个测试/helper 文件，0 个源 description 改动。**远小于 10 文件 / 3 模块阈值** → 适合 fix 模式快速修复，无需升级 story/feature。

## Phase 1 Codex 对抗审查结论与处置

Codex 对抗审查（codex:codex-rescue）核对了源码，结论：

**VERIFIED CORRECT（真值核实全部通过）**：
- prepare/batch/diff/panoramic-query 真实顶层 key 与报告一致（I1/I2）
- 范围 11 个 Output 工具成立，graph-tools.ts 6 工具均无 `Output:` 段（I3）
- 抽查 search_in_file / context description 字段确为实际 data 字段子集（I4）

**CRITICAL 处置**：

| ID | Codex 发现 | 处置决策 |
|----|-----------|---------|
| C1 | 真值来自第二份手写注册表，producer 改名 + description/注册表都漏改 → 子集检查仍通过，漂移漏判（"用手写合约守护手写合约"） | **producer 派生 / 编译期绑定优先**（见方案 A 第 2 点）：diff 用 `Object.keys(DriftReportSchema.shape)`（纯派生）、prepare/batch 用 `[...] as const satisfies readonly (keyof T)[]`（**非** `Record<keyof T,true>`——见 Phase 2 Codex C2 修正）编译期绑定，闭合 C1 于 3 处历史漂移核心区。**残留**：generate/panoramic + 6 cheap 工具走 hand-list；详见 plan.md "C1 残留（诚实收窄）"。**Phase 2 Codex C3 已证伪原 over-claim**（"8 个都有独立 producer 测试守护"不成立：file-nav 的 `nextStepHint` 无既有测试断言）；诚实结论是这 8 个工具**只可靠捕获 description 侧打错字**（= F184 那 4 类历史漂移的真实形态，本守护 100% 有效），producer 侧改名属 C2 的 out-of-scope。 |
| C2 | 子集检查只抓顶层字段名，抓不到嵌套 shape / 类型语义漂移（如 `matches:[{line}]` 里 line→lineNumber，顶层 matches 不变照样通过） | **显式 out-of-scope（不试图闭合，避免过度工程）**：本守护定位为"顶层 Output 字段名 lint"，非完整合约校验。在新测试文件头注释 + 测试用例命名 + 验证报告中**明示**："仅校验顶层字段名存在性；不校验嵌套字段名/值类型；绿灯 ≠ 合约完全安全"。闭合嵌套 shape 需深度结构比对 = 任务明确警告要避免的脆弱过度抽象。 |

**WARNING 处置**：
- W1（根因偏浅）→ 已深化 Root Cause（Output 是字符串字面量、与运行时输出构造无类型绑定）+ 明确"lint 而非完整合约"定位（见上方 Root Cause 段）。
- W2（extractor fixture 不足）→ 方案 A 第 5 点已补：顶层值为对象 `{summary:{...},items}` + panoramic 真实尾随散文 fixture。

**结论**：Codex 两项前提条件已收口 —— C1 做了 producer 派生 + 残留显式论证接受；C2 显式标注 known gap。可进入 Phase 2 规划。
