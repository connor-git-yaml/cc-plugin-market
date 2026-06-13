# Tasks: F196 MCP description Output 字段名防漂移守护

**Branch**: `claude/elated-shockley-5115f0` | **Date**: 2026-06-13  
**Plan**: [plan.md](plan.md) | **Fix Report**: [fix-report.md](fix-report.md)  
**交付物**: 单一新增测试文件 `tests/unit/mcp/description-output-drift.test.ts`（零源码改动）

---

## 任务列表

- [x] T001 搭测试文件骨架 + 建立 mock 捕获基础设施
  - **对应 plan**: "Codebase Reality Check"新增文件一览 + "Architecture" mock 流程图
  - **依赖**: 无（起点任务）
  - **操作**:
    1. 新建 `tests/unit/mcp/description-output-drift.test.ts`
    2. 写文件头部 C2 known gap 注释块（plan §Known Gap 原文）
    3. 复用 `description-completeness.test.ts` 的 `vi.hoisted` + `vi.mock('@modelcontextprotocol/sdk/server/mcp.js')` 写法，捕获 `(name, description)` 到 `hoisted.captured`
    4. 导入三个 producer 类型/schema：`DriftReportSchema`（from `src/models/module-spec.ts`）、`PrepareResult`（from `src/core/single-spec-orchestrator.ts`）、`BatchResult`（from `src/batch/batch-orchestrator.ts`）
    5. 写 `beforeAll` 重置 + `createMcpServer()` 调用
    6. 写 `findTool(name)` helper（同 completeness.test.ts 同款）
    7. 写 `getOutputTools()` helper：从 `hoisted.captured` 过滤 `description.includes('Output:')`，返回工具名数组
    8. 写空 `describe` 占位块（Suite 1–5），以便后续 task 填充（确保文件可 parse）
  - **文件路径**: `tests/unit/mcp/description-output-drift.test.ts`（新增）
  - **完成判据**: `npx vitest run tests/unit/mcp/description-output-drift.test.ts` 通过（0 个 test 0 个失败，骨架可编译运行）；`npm run build` 无类型错误

---

- [x] T002 实现 `extractOutputTopLevelKeys` 纯函数 + Suite 1 extractor 单元测试（TDD）
  - **对应 plan**: "Extractor 算法详述"伪代码 + §Suite 1 E-01~E-05
  - **依赖**: T001（需要文件已存在且可编译）
  - **操作（TDD 顺序）**:
    1. 先在文件内写 Suite 1 的 6 个测试用例（E-01~E-06），此时 `extractOutputTopLevelKeys` 尚未实现，预期 **失败**：
       - E-01: 输入 `"Output: { answer, citations, tokenUsage }"` → `['answer', 'citations', 'tokenUsage']`
       - E-02: 输入 `"Output: { matches: [{line, text}], totalMatches, nextStepHint }"` → `['matches', 'totalMatches', 'nextStepHint']`
       - E-03: 输入 `"Output: { summary: { a, b }, items }"` → `['summary', 'items']`
       - E-04: 输入 `"Output: { answer, citations, tokenUsage }（其他 operation...）"` → `['answer', 'citations', 'tokenUsage']`
       - E-05: 输入 `"Use this tool when..."（无 Output:）` → `[]`
       - **E-06（C1 回归）**: 输入 `"Output: { a, b }, see: docs and more"` → `['a', 'b']`（顶层 `}` 后的 `see`/`docs`/`more` **不得**被误收——验证 lookahead 不消费 `}`、顶层闭合即 STOP）
    2. 跑测试，**确认 6 个用例失败**（红灯）
    3. 实现 `extractOutputTopLevelKeys(description: string): string[]`，按 plan 伪代码状态机：
       - 搜索 `Output: {`（含前导空白变体）
       - 从 `{` 开始，用 `depth`/`sqDepth` 追踪嵌套层
       - `depth==1 && sqDepth==0` 时匹配标识符 **lookahead 正则** `/^([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*[,:}\]])/`（🔴 Codex C1：分隔符 `,:}]` 用 lookahead **不消费**，否则末尾 key 的 `}` 被吃掉、顶层闭合归零永不触发；匹配成功后 `i` 仅前进 `match[1].length`，把分隔符留给下一轮交 depth/sqDepth 分支）
       - `depth==0` 时停止，返回去重 key 列表
    4. 跑 Suite 1，**确认 6 个全绿**
  - **文件路径**: `tests/unit/mcp/description-output-drift.test.ts`（修改）
  - **完成判据**: `npx vitest run tests/unit/mcp/description-output-drift.test.ts` Suite 1（E-01~E-05）全部 PASS；不得因实现 extractor 而引入编译错误

---

- [x] T003 构建 TRUTH 真值表 + Suite 5 完整性守护（C-01/C-02）
  - **对应 plan**: "真值来源分层表（11 工具）"+ §Suite 5 C-01/C-02
  - **依赖**: T001（文件骨架）；T002 中的 `getOutputTools()` helper
  - **操作**:
    1. 在文件内定义 `TRUTH` 常量（`const TRUTH: Record<string, readonly string[]>`），按分层策略填入 11 个工具：
       - **producer 派生 / 编译期绑定（3 个）**🔴 **Codex C2：禁用 `{} as Record<keyof T,true>`**（类型断言被擦除 → `Object.keys` 得空集 → 立即 false-positive）。正确写法见下：
         - `diff`: `Object.keys(DriftReportSchema.shape)` — 运行时从 Zod schema 派生（Codex I1 确认纯 `z.object`，`.shape` 安全）；注释标 `src/models/module-spec.ts:246`
         - `prepare`: 真实数组字面量 `as const satisfies`：
           ```ts
           // src/core/single-spec-orchestrator.ts:131 (PrepareResult) — satisfies 编译期校验每个元素是真实 keyof
           const PREPARE_TYPED = ['skeletons', 'mergedSkeleton'] as const satisfies readonly (keyof PrepareResult)[];
           // 'detectedLanguages' 由 MCP handler 运行时附加(src/mcp/server.ts:117)，不在 PrepareResult interface，单列
           TRUTH['prepare'] = [...PREPARE_TYPED, 'detectedLanguages'];
           ```
         - `batch`: 真实数组字面量 `as const satisfies`：
           ```ts
           // src/batch/batch-orchestrator.ts:201 (BatchResult) — 只列 description 相关 key，无需枚举全部 20+ 字段
           const BATCH_TYPED = ['successful', 'skipped', 'failed', 'indexGenerated'] as const satisfies readonly (keyof BatchResult)[];
           TRUTH['batch'] = [...BATCH_TYPED];
           ```
         - `as const` 非必需但推荐：`satisfies` 自带 contextual typing 已能按 `keyof T` 校验每个 literal（typo / 改名旧名报 TS2322），不加也守护 typo；加 `as const` 仅额外保留 readonly tuple，无害更显式。
         - 守护语义：producer 改名某 key → 字面量元素不再是 `keyof T` → **编译报错**逼更新 TRUTH → 旧名 ∉ TRUTH → subset 抓住 description；TRUTH typo 同样编译报错。
       - **cited 手写（8 个）**，每条注释标 source `file:line`：
         - `generate`: `['specPath','tokenUsage','confidence','warnings']` — `src/mcp/server.ts:158-164`
         - `panoramic-query`: `['answer','citations','tokenUsage']` — `src/panoramic/query.ts:63`
         - `view_file`: `['lines','startLine','endLine','totalLines','truncated','nextStepHint']` — `src/mcp/file-nav-tools.ts:255-264`
         - `search_in_file`: `['matches','totalMatches','nextStepHint']` — `src/mcp/file-nav-tools.ts:314-321`
         - `list_directory`: `['entries','entryCount','nextStepHint']` — `src/mcp/file-nav-tools.ts:353-360`
         - `impact`: `['affected','summary','topImpacted','nextStepHint']` — `src/mcp/agent-context-tools.ts:251-265`
         - `context`: `['definition','callers','callees','imports','topRelevantCallers','nextStepHint']` — `src/mcp/agent-context-tools.ts:365-408`
         - `detect_changes`: `['changedSymbols','affectedSymbols','riskSummary','riskTier','topImpacted','nextStepHint']` — `src/mcp/agent-context-tools.ts:636-651`
    2. 写 Suite 5 两个测试（在 `beforeAll` 之后执行）：
       - C-01: `const outputTools = getOutputTools(); outputTools.every(name => name in TRUTH)` → 全 true，否则报告缺少真值条目的工具名
       - C-02: `Object.keys(TRUTH).every(name => outputTools.includes(name))` → 全 true，否则报告 stale 条目名
  - **文件路径**: `tests/unit/mcp/description-output-drift.test.ts`（修改）
  - **完成判据**: `npx vitest run tests/unit/mcp/description-output-drift.test.ts` Suite 5 C-01/C-02 PASS；TRUTH 中 `diff` key 列表来自 `DriftReportSchema.shape`（编译期绑定），`npm run build` 无类型错误

---

- [x] T004 Suite 2：11 个真实工具 subset 断言（当前全绿验证）
  - **对应 plan**: §Suite 2 S-01~S-11
  - **依赖**: T002（`extractOutputTopLevelKeys` 实现）；T003（TRUTH 真值表）
  - **操作**:
    1. 写 `checkSubset(toolName: string, desc: string): string[]` helper，返回越界字段列表（`extract(desc)` 中不在 `TRUTH[toolName]` 的字段）
    2. 写 Suite 2（11 个 `it` 或一个 `it.each`）：
       - 从 `hoisted.captured` 找对应工具 description
       - 断言 `checkSubset(name, desc)` 返回空数组，失败时打印越界字段 + 引用 TRUTH source
       - 覆盖：prepare / generate / batch / diff / panoramic-query / view_file / search_in_file / list_directory / impact / context / detect_changes
  - **文件路径**: `tests/unit/mcp/description-output-drift.test.ts`（修改）
  - **完成判据**: `npx vitest run tests/unit/mcp/description-output-drift.test.ts` Suite 2（S-01~S-11）11 个断言全部 PASS（证明当前 11 个 description 无漂移）

---

- [x] T005 Suite 3 F184 漂移复现 fixture + Suite 4 非误报 fixture
  - **对应 plan**: §Suite 3 D-01~D-04 + §Suite 4 FP-01~FP-03
  - **依赖**: T002（`extractOutputTopLevelKeys`）；T003（TRUTH 真值表）；T004（`checkSubset` helper）
  - **操作**:
    1. **Suite 3（D-01~D-04）——合成 drifted description**：
       - D-01: `prepare` 注入 `"Output: { skeleton, detectedLanguages }"`，断言 `checkSubset('prepare', driftedDesc)` 包含 `'skeleton'`
       - D-02: `batch` 注入 `"Output: { generated, skipped, graphPath }"`，断言越界字段包含 `'generated'` 和 `'graphPath'`
       - D-03: `diff` 注入 `"Output: { drifts, newBehaviors, staleItems }"`，断言越界字段包含 `'drifts'`、`'newBehaviors'`、`'staleItems'`（全部越界）
       - D-04: `panoramic-query` 注入 `"Output: { answer, graph, overview }"`，断言越界字段包含 `'graph'`、`'overview'`
    2. **Suite 4（FP-01~FP-03）——合法 description 不误报**：
       - FP-01: 输入 `"Output: { matches: [{line, text, before, after}], totalMatches, nextStepHint }"`，断言 `checkSubset('search_in_file', fp01Desc)` 为空（无误报）
       - FP-02: 输入 `"Output: { summary: { hits, misses }, items, count }"`，构造一个 TRUTH 含 `summary`/`items`/`count` 的工具 fixture，断言 `checkSubset` 为空
       - FP-03: 从 `hoisted.captured` 取真实 `panoramic-query` description（含 `}（其他 operation 返回各自结构...）` 尾随中文），断言 `checkSubset` 为空
  - **文件路径**: `tests/unit/mcp/description-output-drift.test.ts`（修改）
  - **完成判据**:
    - Suite 3 全部 PASS：**4 个 drifted fixture 各自触发对应越界字段断言**（D-01 flag `skeleton`；D-02 flag `generated` + `graphPath`；D-03 flag `drifts` + `newBehaviors` + `staleItems`；D-04 flag `graph` + `overview`）
    - Suite 4 全部 PASS：3 个合法 fixture 均不触发误报（`checkSubset` 返回空数组）

---

- [x] T006 验证闭环：全量测试 + build + repo:check
  - **对应 plan**: §验证方案
  - **依赖**: T001–T005（所有 suite 已实现）
  - **操作**:
    1. 运行 `npx vitest run`，确认全量测试零失败（新增文件 **16 个 it 块**：E-01~E-06=6 / Suite 2 的 1 个动态 it 遍历全部带 Output 工具（覆盖原 S-01~S-11 的 11 个逻辑子集检查）/ D-01~D-04=4 / FP-01~FP-03=3 / C-01~C-02=2）
    2. 运行 `npm run build`，确认 TypeScript 类型检查零错误（尤其验证 `[...] as const satisfies readonly (keyof PrepareResult)[]` / `(keyof BatchResult)[]` 编译期绑定生效——故意把 `BATCH_TYPED` 写错一个 key 应触发编译错，验证后改回）
    3. 运行 `npm run repo:check`，确认无 violation
    4. 可选：单独跑新文件 `npx vitest run tests/unit/mcp/description-output-drift.test.ts --reporter=verbose` 确认所有 suite 描述可读、失败信息包含越界字段名
  - **文件路径**: 只读验证，不修改任何文件
  - **完成判据**: 三项命令全部零错误/零失败；特别确认 Suite 3 的 4 条 drift 检测用例（D-01~D-04）均为 PASS（守护有效性最终验收）

---

## 任务依赖关系

```
T001（骨架 + mock + import）
  └── T002（extractor 实现 + Suite 1）
  └── T003（TRUTH 真值表 + Suite 5）
        └── T004（Suite 2 subset 断言）
              └── T005（Suite 3 drift fixture + Suite 4 FP fixture）
                    └── T006（验证闭环）
```

**并行机会**：T002 与 T003 不共享写入位置（都是追加到同一文件的不同代码块），可在同一编辑会话内顺序完成，但需注意 T004 同时依赖两者。

---

## 完整性说明

| Plan 章节 | 覆盖 Task |
|-----------|----------|
| Extractor 算法详述 | T002（TDD 实现） |
| 真值来源分层表（11 工具） | T003（TRUTH 常量） |
| Suite 1 extractor 单元测试 E-01~E-05 | T002 |
| Suite 2 subset 断言 × 11 工具 S-01~S-11 | T004 |
| Suite 3 F184 漂移复现 D-01~D-04 | T005 |
| Suite 4 非误报 FP-01~FP-03 | T005 |
| Suite 5 完整性守护 C-01/C-02 | T003 |
| Known Gap C2 头注释 | T001 |
| 验证方案（vitest + build + repo:check） | T006 |
