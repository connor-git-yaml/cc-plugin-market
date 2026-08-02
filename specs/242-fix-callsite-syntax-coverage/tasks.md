
# Tasks: F242 TS/JS 调用边抽取语法覆盖缺口修复

**Input**: `specs/242-fix-callsite-syntax-coverage/plan.md`（已锁定 7 项设计决策 + 精确到文件的变更清单）+
`specs/242-fix-callsite-syntax-coverage/fix-report.md`（5-Why 根因）
**模式**: fix（无 User Story 分层，任务按 red-first → 实现 → 回归收口 三段组织）
**提交前验证**: `npx vitest run` 全量零失败 + `npm run build` + `npm run repo:check`；测试与修复同 commit；禁 `vitest -u` 盲刷快照

## Format: `[ID] [P?] 描述`

- **[P]**: 可并行（不同文件、无依赖）
- 每个任务给出：动作描述、涉及文件、完成判据（DoD）、依赖关系

---

## Phase 1: Red Fixtures（先红，四文件并行落地）

**目的**：在不改产品代码的前提下，把 plan.md「Red Fixture 测试清单」的全部形态写成断言，跑出预期失败，确认失败原因命中根因（而非语法错误等无关失败）。

- [x] **T001 [P]** Red fixture — mapper 层 4 用例
  **文件**：`tests/unit/typescript-mapper-callsite.test.ts`
  **内容**：新增用例覆盖形态 1（arrow body 内调用，具名外层函数）、形态 2（function expression body 内调用）、形态 3（嵌套两层匿名 callback）、形态 3b（IIFE 顶层无命名祖先）。断言 `callerContext` 维持既有语义（回归锚）+ 新增 `enclosingNamedContext` 期望值（含 `undefined` 分支）。
  **DoD**：4 个新用例全部执行失败（因 `enclosingNamedContext` 字段/计算尚不存在），且失败原因是"字段缺失/值不符"而非断言写法错误；C-4 既有用例（`callerContext` 相关）保持原样未改动。
  **依赖**：无
  **注意**：plan.md 未明确 IIFE 用例是否要求 `callerContext` 精确匹配 `/^<fn:/`（IIFE 是 `FunctionExpression` 还是走其他前缀），实现时以 `_deriveCallerContext` 现有产出为准，若与 plan 描述不符先核实现状，不擅自改设计。

- [x] **T002 [P]** Red fixture — resolver 层 3 用例
  **文件**：`tests/unit/knowledge-graph/call-resolver.test.ts`
  **内容**：新增用例覆盖回退链三分支：① 匿名 `callerContext` + 可寻址 `enclosingNamedContext` → `edge.source` 用后者；② 两者皆不可寻址/缺失 → `edge.source` 退化为纯 `file`（无 `::`）；③ `callerContext` 本身可寻址（既有 Stage 1/2 场景）→ `edge.source` 保持不变（回归锚）。
  **DoD**：3 个新用例全部执行失败（因 `isAddressable`/`resolveSourceId` 尚未实现，`mkEdge` 签名未变），失败原因命中"函数未导出"或"source 归属逻辑未生效"。
  **依赖**：无

- [x] **T003 [P]** Red fixture — ast-analyzer 层 5 用例
  **文件**：`tests/unit/ast-analyzer.test.ts`
  **内容**：新增用例覆盖形态 4（顶层 `await import()` 解构）、形态 5（函数内 `await import()` 解构）、形态 6（`import().then(m => ...)` 命名空间绑定）、形态 6b（`import().then(({fn}) => ...)` 解构绑定）、附加项（静态 `import * as ns`）。
  **DoD**：5 个新用例全部执行失败（因 `namedImports`/`namespaceImport` 字段未产出），失败原因是"字段为 `undefined`/缺失"而非解析异常崩溃。
  **依赖**：无
  **注意**：`.then()` 检测覆盖两条 AST 路径（`PropertyAccessExpression('then')` 与 `AwaitExpression→VariableDeclaration`），fixture 用例需分别覆盖，不要只测一条路径就判定"覆盖完整"。

- [x] **T004 [P]** Red fixture — 端到端存活测试（新建文件）
  **文件**：`tests/integration/call-edge-survival.test.ts`（新建）
  **内容**：mkdtemp 构造最小多文件临时 fixture（具名导出函数 A 内嵌 arrow callback 调用具名导出函数 B；未导出 `main()` 内调用具名导出函数 C；文件内 `await import()` 解构后调用另一文件的具名导出函数 D），跑 `buildUnifiedGraph`（`src/knowledge-graph` 公开入口），断言悬空过滤后 `edges` 集合包含 3 条验收边：`fileA::A → fileA::B`、`fileA → fileA::C`、`fileA → fileB::D`。
  **DoD**：文件新建完成，3 条断言全部执行失败（因当前实现下这 3 条边会被悬空过滤丢弃），测试可独立运行（`npx vitest run tests/integration/call-edge-survival.test.ts`）不因 fixture 搭建本身报错。
  **依赖**：无

**Checkpoint**：T001-T004 全部确认先红后，方可进入 Phase 2 实现。四文件失败原因需人工过一遍，排除"断言本身写错"的假红。

---

## Phase 2: Schema 增量字段

- [x] **T005 [P]** `CallSite.enclosingNamedContext` schema 增量
  **文件**：`src/models/call-site.ts`
  **内容**：`CallSiteSchema` 增 `enclosingNamedContext: z.string().optional()` 字段（位于 `calleeQualifier` 之后）+ JSDoc 说明用途（resolver 归属回退链第二级）。
  **DoD**：`npm run build` 类型检查通过；既有 `CallSiteSchema` 6 个字段顺序/类型/必填性零变化。
  **依赖**：无

- [x] **T006 [P]** `ImportReference.namespaceImport` schema 增量
  **文件**：`src/models/code-skeleton.ts`
  **内容**：`ImportReferenceSchema` 增 `namespaceImport: z.string().optional()` 字段 + JSDoc。
  **DoD**：`npm run build` 类型检查通过；不复用 `defaultImport` 字段（按 plan.md 决策 3 明确的语义区分）。
  **依赖**：无

---

## Phase 3: 产品代码实现（转绿）

- [x] **T007** `typescript-mapper.ts` 实现 `enclosingNamedContext` 计算与透传
  **文件**：`src/core/query-mappers/typescript-mapper.ts`
  **内容**：新增模块级常量 `ANON_CONTEXT_RE`；`_walkCallSites` 内新增栈扫描逻辑；透传给 `_handleCallExpression`/`_handleNewExpression`/`_handleDecorator`/`_handleTaggedTemplate`（各加 1 个 `enclosingCtx` 形参）及内部 `_handleMemberCall`；`_mkCallSite` 签名加 `enclosingNamedContext?: string` + 条件赋值；13 处 `_mkCallSite` 调用点追加实参。
  **DoD**：T001 的 4 个用例全部转绿；C-4 系列（`callerContext` 相关）既有用例人工核对零变化（若变红判定为实现 bug，立即修复而非改断言）。
  **依赖**：T001（红基线）、T005（字段已存在）

- [x] **T008** `call-resolver.ts` 实现 `isAddressable`/`resolveSourceId` + `mkEdge` 签名改造
  **文件**：`src/knowledge-graph/call-resolver.ts`
  **内容**：新增导出纯函数 `isAddressable`（区分无点号/点分两种查表方式）与 `resolveSourceId`（三级回退链）；`resolveOne` 顶部新增 `const source = resolveSourceId(cs, indices);`；`mkEdge` 签名从 `(cs, targetId, tier)` 改为 `(source, targetId, tier)`，8 处调用点同步改参数。
  **DoD**：T002 的 3 个用例全部转绿；既有 `call-resolver.test.ts` 中未改动的 Stage 1/2 可寻址场景断言保持绿（回归锚）。
  **依赖**：T002（红基线）、T005（字段已存在）、T007（`enclosingNamedContext` 实际产出，便于端到端联调，非硬性阻塞但建议顺序执行）

- [x] **T009** `ast-analyzer.ts` 实现动态绑定抽取 + 静态命名空间绑定
  **文件**：`src/core/ast-analyzer.ts`
  **内容**：静态 import 循环（L465-507）追加 `namespaceImport: decl.getNamespaceImport()?.getText() ?? undefined`；动态 import 循环（L509-546）新增内部辅助函数（如 `extractBindingFromNode`）处理 `AwaitExpression→VariableDeclaration` 与 `PropertyAccessExpression('then')→CallExpression` 两条路径，供解构/命名空间两种绑定形态复用；`require()` 分支不动。
  **DoD**：T003 的 5 个用例全部转绿。
  **依赖**：T003（红基线）、T006（字段已存在）

- [x] **T010** `call-resolver.ts::buildImportIndex` 追加 `namespaceImport` 落表
  **文件**：`src/knowledge-graph/call-resolver.ts`
  **内容**：紧邻现有 `defaultImport` 处理逻辑之后，追加 `if (imp.namespaceImport) aliasToTarget.set(imp.namespaceImport, target);`。
  **DoD**：`buildImportIndex` 能正确把 `namespaceImport` 绑定名落入 alias 表，供 Stage 3 跨模块调用解析使用；单测或端到端测试可观测到 target 侧不再产 `?::` 占位。
  **依赖**：T006、T009（`namespaceImport` 字段有实际产出后此步才有意义验证）

- [x] **T011 [P]** `graph-builder.ts` 悬空过滤观测性
  **文件**：`src/panoramic/graph/graph-builder.ts`
  **内容**：步骤 4 悬空过滤循环（L443-453）内增 `droppedCount` 计数，`continue` 分支前累加；循环结束后若 `droppedCount > 0` 输出 `console.warn`。仅总数计数，不做四分类打点（按 plan.md 决策 4）。
  **DoD**：代码改动 ≤10 行局部区块；不写入 graph metadata（不扩快照面）；本地跑一次含悬空边的输入能在控制台观察到 warn 输出。
  **依赖**：无（与 T007-T010 相互独立，可并行）

---

## Phase 4: 端到端联调 + 存活验证

- [x] **T012** 端到端存活测试转绿验证
  **文件**：`tests/integration/call-edge-survival.test.ts`（复用 T004 产物）
  **内容**：跑通该测试，确认 3 条验收边（`fileA::A → fileA::B` 命名祖先回退、`fileA → fileA::C` 模块兜底、`fileA → fileB::D` 动态 import 解构）全部真实存活过悬空过滤，而非仅中间产物正确。
  **DoD**：`npx vitest run tests/integration/call-edge-survival.test.ts` 零失败；额外人工核对 fix-report.md 明确列出的两个验收案例可复现：`impact(executeKbSearch)` 能看到来自 `registerKbSearchTool` 的 caller、`impact(runScaffoldKb)` 的 `directCallers` 不再为 0（可用本仓库自举图或该端到端 fixture 之一验证，具体在 T015 统一记录实测数字）。
  **依赖**：T007、T008、T009、T010

---

## Phase 5: 回归收口（三个独立任务，勿合并）

- [x] **T013** 既有测试回归处置（逐条核对，禁止 `vitest -u` 盲刷）
  **文件**：涉及但不限于 `tests/unit/typescript-mapper-callsite.test.ts`、`tests/unit/knowledge-graph/call-resolver.test.ts`、`tests/integration/` 下 6 个消费 micrograd fixture 的文件（先跑一遍确认哪些变红，不在此任务内处理 fixture 本身重生成，见 T014）
  **内容**：跑 `npx vitest run`，对每一条因本次改动变红的既有测试，按 plan.md「回归面处置」表逐条判断：C-4 系列必须零变化（变红=bug，立即修实现）；`call-resolver.test.ts` 中 `edge.source` 精确断言按语义核实后更新或保留；`dropTargetMissing`/`dropTargetUnresolved` 相关断言必须保持不变（若变化视为潜在回归，需排查）。
  **DoD**：全量 `npx vitest run` 除已知负载 flaky 名单（`watch-command`/`community-analysis` perf/`cli-e2e --version`/`batch-orchestrator-incremental`，隔离重跑单独定性）外零失败；每条断言变更均有对应的语义核实记录（可在 commit message 或 verification-report 中简述归因）。
  **依赖**：T012

- [x] **T014** micrograd pinned fixture 七步重生成
  **文件**：`tests/fixtures/micrograd-baseline-graph/graph.json`、`tests/fixtures/micrograd-baseline-graph/README.md`
  **内容**：严格按 plan.md「micrograd pinned fixture 重生成步骤」七步执行：① 校验源 clone commit 未漂移；② `npm run build`；③ `rsync` 只读拷贝到临时目录；④ `node dist/cli/index.js batch $TMPCOPY --mode graph-only --output-dir $TMPOUT`；⑤ 覆盖 `graph.json`；⑥ README 新增「F242 重生成」小节记录 producer commit + 新旧计数 + 逐条改动归因；⑦ 按 F215 T006 方法论逐文件核对 6 个消费测试文件（非仅 exit code，人工核对每条 assertion）：`mcp-server-stdio.test.ts`、`agent-context-real-graph.test.ts`、`feature-180-graph-tools.e2e.test.ts`、`feature-180-file-nav-stdio.e2e.test.ts`、`feature-180-symbol-chain.e2e.test.ts`、`feature-184-view-file-fuzzy.e2e.test.ts`（附带观察 `feature-180-telemetry.e2e.test.ts`）。
  **DoD**：7 个消费测试文件全部通过且经人工核对（非仅绿色）；README「F242 重生成」小节记录实测新旧 calls 边计数（不预先编造数字）。
  **依赖**：T013（既有测试非 fixture 相关部分先收口，避免重复返工）

- [x] **T015** F217 六指标自举复核
  **文件**：无源码改动，产出记录进 verify 阶段 verification-report（本任务只做实测，不改产品代码）
  **内容**：对本仓库自身跑 `node dist/cli/index.js batch . --mode graph-only --output-dir /tmp/f242-selfcheck` 建自举图，再跑 `node dist/cli/index.js graph-quality --graph /tmp/f242-selfcheck/_meta/graph.json`，对比修复前后六指标（orphan ratio / dangling edges / duplicate edges / contains-coverage / god-node 分布 / freshness）。
  **DoD**：dangling edges 保持 0；orphan ratio 相对修复前实测下降；duplicate edges 保持 0；实测数字记入 verification-report，不使用 plan.md 中的预期方向代替实测。
  **依赖**：T014（fixture 与代码均已稳定后再做自举体检，避免中间态噪声）

---

## Phase 6: 收尾验证

- [x] **T016** 全量构建 + 仓库同步校验
  **文件**：无源码改动
  **内容**：`npm run build`（类型检查零错误）+ `npm run repo:check`（仓库级同步校验零错误）。
  **DoD**：两条命令均零错误退出。
  **依赖**：T015

- [x] **T017** Codex 对抗审查（implement 阶段 commit 前，按 CLAUDE.local.md 约定）
  - 首轮结论：1 CRITICAL + 7 WARNING + 5 INFO（含内存反例复现，session 019fc3a5-df3b-74b1-97b1-2d85090be01c）
  - 处置：C1（动态绑定 last-wins 假边）/W1（.then callee 同一性）/W3（大写 namespace alias 走类启发式）/W6（无条件 console.warn）→ 立即修复，15 个新用例 red→green，全量 6065 零失败复测通过
  - 登记不修：W2（rename 解构与静态 import 同口径限制，产物被过滤不成假边）、W4（export-alias 撞名病理形态，字符串归属固有精度界）、W5（function_expression 不入栈为 pre-F242 既有缺陷，独立立项）、W7（tree-sitter/regex 降级路径绑定缺口，follow-up）
  - 终态：五轮审查 × 四轮修复闭环（R2-R5 追加发现 Stage 1 绕行 / null-target 类回退两 CRITICAL 与括号归一化系列 WARNING，均修复；累计 54 个新用例，全量 6101 零失败），R5 终局裁定**「复审通过」**——登记边界外零新发现。完整轮次表见 verification/verification-report.md 附录
  **文件**：无源码改动（审查动作）
  **内容**：通过 Agent tool 启动 `codex:codex-rescue` 子代理，对本次全部改动（T005-T011 产品代码 + T001-T004/T012 测试改动）做对抗性审查，聚焦"代码改动是否引入回归/漏洞/边界遗漏"。
  **DoD**：Codex 给出的 critical/warning 项逐条处置（真实 bug 立即修复重测；风格偏好记录在 commit message）；处置后重新跑 T013 的全量测试确认零失败。
  **依赖**：T016

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（Red Fixtures）**：T001-T004 相互独立，可完全并行；无前置依赖
- **Phase 2（Schema）**：T005-T006 相互独立，可并行；无前置依赖，可与 Phase 1 同时进行
- **Phase 3（实现）**：依赖对应 Phase 1 红基线 + Phase 2 字段就绪；T007→T008 建议顺序（resolver 依赖 mapper 产出的字段验证），T009→T010 建议顺序（buildImportIndex 依赖 namespaceImport 字段先有实际产出）；T011 与其余全部独立可随时并行
- **Phase 4（端到端）**：依赖 T007/T008/T009/T010 全部完成
- **Phase 5（回归收口）**：T013→T014→T015 严格顺序（先处理非 fixture 回归，再重生成 fixture，最后做自举体检，避免中间态互相污染判断）
- **Phase 6（收尾）**：T016→T017 顺序，依赖 Phase 5 全部完成

### 并行机会

- T001/T002/T003/T004（红 fixture 四文件）
- T005/T006（schema 两字段）
- T011（graph-builder 观测性）与 T007-T010 之间

### 推荐实施顺序（非并行团队场景）

T001→T002→T003→T004（红基线）→ T005→T006（schema）→ T007→T008→T009→T010（实现，按文件依赖顺序）→ T011（可穿插任意时点）→ T012（端到端转绿）→ T013→T014→T015（回归收口三部曲）→ T016→T017（收尾）

---

## Notes

- 本次修复无 User Story 分层（fix 模式），任务顺序即是执行顺序，非 MVP 增量交付语义
- 严禁 `vitest -u` 盲刷任何快照/断言；T013/T014 涉及的断言变更均需逐条语义核实
- T014/T015 的具体计数（边数增长、指标数值）均为实测记录，不得援引 plan.md 中的"预期方向"代替实测填入 verification-report
- 如实现过程中发现 plan.md 描述与实际 AST/代码行为不符（如 T001 注意栏提到的 IIFE 前缀判定），先核实现状记录分歧，不擅自变更 plan.md 已锁定的设计决策
