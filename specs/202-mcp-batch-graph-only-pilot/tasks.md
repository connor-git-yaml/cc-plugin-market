# Tasks: MCP batch 工具 graph-only 模式 + goal_loop Pilot

**Feature**: 202-mcp-batch-graph-only-pilot
**Input**: `specs/202-mcp-batch-graph-only-pilot/plan.md` + `spec.md`
**生成日期**: 2026-06-20

---

## 概览

本 Feature 包含两个 User Story：
- **US1**（P1）：MCP batch 工具原生支持 `graph-only` 模式（载体任务，TDD 红→绿）
- **US2**（P2）：goal_loop 自主驱动红→绿的 pilot 实证（编排层，verify 报告承载）

改动面极小（2 个核心文件 + 1 个新集成测试文件），无基础设施需要搭建，无 Phase 1/2 阻塞依赖。TDD 顺序严格串行：红测试先行 → 确认红态 → 改实现 → 确认绿态 → 门禁。

---

## Phase 1: US1 P1 — 单元测试红态建立（TDD RED）

**目标**：在 server.ts 改动之前，把全部单元测试用例写入 `tests/unit/mcp-server.test.ts`，并确认它们处于红态（失败）。这是 goal_loop 迭代的启动信号——红态必须先被独立确认，不得与实现合并提交。

**独立验收**：`npx vitest run tests/unit/mcp-server.test.ts` 输出包含"用例 A、A2、B、C、E"失败，用例 D（三旧 mode 回归基线）绿色通过。

---

- [ ] T001 [US1] **mock 补全**：在 `tests/unit/mcp-server.test.ts` 的 `vi.hoisted` `mocks` 对象（约 :7-12）追加 `buildAstGraphOnly: vi.fn()`；在 `vi.mock('../../src/batch/batch-orchestrator.js', ...)` 块（约 :48-50）追加 `buildAstGraphOnly: mocks.buildAstGraphOnly`
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-004（为测试 dispatch 路由做 mock 桩）
  - 并行：否（后续所有单元用例依赖此步骤的 mock 存在）

- [ ] T002 [US1] **写用例 A**（graph-only dispatch 路由）：在 `tests/unit/mcp-server.test.ts` 现有 T094-05 测试后（约 :230）新增用例 A —— 断言 `buildAstGraphOnly` 被调用 1 次、`runBatch` 未被调用、返回体 `JSON.parse` 后含 `graphPath`/`nodeCount`
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-004、FR-005
  - 对应 SC：SC-载体-001
  - 并行：否（依赖 T001）

- [ ] T003 [US1] **写用例 A2**（Zod schema 枚举断言）：新增用例 A2 —— 取 `batchTool.schema.mode` 的 `safeParse`，断言 `'graph-only'` 为 true、`'full'` 仍为 true、`'bogus'` 为 false
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-001
  - 对应 SC：SC-载体-003
  - 并行：可与 T002 并行（同文件，但需在 T001 之后）

- [ ] T004 [US1] **写用例 B**（regen 参数隔离）：新增用例 B —— 同时传入 `incremental: true, force: true`，断言 `buildAstGraphOnly.mock.calls[0]` 长度为 1（只传 projectRoot），`runBatch` 未被调用
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-009（regen 轴参数不透传）
  - 对应 SC：EC-003
  - 并行：可与 T002/T003 并行（T001 完成后）

- [ ] T005 [US1] **写用例 C**（describe 文案一致性）：新增用例 C —— 断言 `batchTool.schema.mode.description` 不含"暂不支持 graph-only"，且匹配 `/纯 AST|零 LLM/`
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-002
  - 对应 SC：SC-载体-001b
  - 并行：可与 T002/T003/T004 并行（T001 完成后）

- [ ] T006 [US1] **写用例 D**（三旧 mode 回归基线）：新增用例 D —— `it.each(['full', 'reading', 'code-only'])` 各自断言 `runBatch` 被调用 1 次且 mode 透传、`buildAstGraphOnly` 未被调用
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-007
  - 对应 SC：SC-载体-002
  - 并行：可与 T002-T005 并行（T001 完成后）

- [ ] T007 [US1] **写用例 E**（languages warn 行为）：新增用例 E —— 传入 `languages: ['typescript']`，spyOn `console.error`，断言 `result.isError` 为 undefined、`buildAstGraphOnly` 调用参数长度为 1、日志含 `/graph-only.*languages|languages.*graph-only/`
  - 改动文件：`tests/unit/mcp-server.test.ts`
  - 对应 FR：FR-010
  - 对应 SC：EC-001
  - 并行：可与 T002-T005 并行（T001 完成后）

- [ ] T008 [US1] **红态确认**：运行单元测试，确认预期红态成立
  - 验收命令：`npx vitest run tests/unit/mcp-server.test.ts`
  - 预期结果：用例 A、A2、B、C、E 失败（红）；用例 D 通过（绿，回归基线确认）
  - 对应 SC：SC-载体-001（红态必须先独立确认）
  - 并行：否（必须等 T002-T007 全部写完后执行）
  - **⚠️ 本步骤是 goal_loop 的启动判据——红态未确认前不得进入 Phase 2 实现**

---

## Phase 2: US1 P1 — 集成测试红态建立（TDD RED，集成层）

**目标**：新建集成测试文件，真跑（不 mock buildAstGraphOnly），制造小 fixture，验证 portable graph 端到端属性。改动前该测试因 schema 拒绝而红。

**独立验收**：`npx vitest run tests/integration/mcp-batch-graph-only.test.ts` 报错（schema 枚举拒绝 `'graph-only'`，handler 未执行）。

---

- [ ] T009 [US1] **新建集成测试文件**：新建 `tests/integration/mcp-batch-graph-only.test.ts`
  - 不 `vi.mock('../../src/batch/batch-orchestrator.js')`（真实 `buildAstGraphOnly`）
  - 仍 mock `@modelcontextprotocol/sdk/server/mcp.js`（FakeMcpServer 范式，复用 mcp-server.test.ts 的 hoisted mock 结构）
  - `beforeEach`：`fs.mkdtemp` 创建临时目录，写入 1-2 个最小 `.ts` 文件（如 `export function a(){ return b(); } export function b(){ return 1; }`）
  - `afterEach`：清理临时目录（`fs.rm(tmpDir, { recursive: true })`）
  - 核心断言：
    1. `result.isError` 为 undefined
    2. `parsed = JSON.parse(result.content[0].text)`；`parsed.graphPath` 存在、`parsed.nodeCount > 0`
    3. 读 `parsed.graphPath` → `graph.schemaVersion === '2.0'`（FR-006）
    4. 遍历 `graph.nodes`，绝对路径节点计数 = 0（F193 portable 守卫）
    5. **零 LLM oracle（Codex W-003）**：本测试**不配置任何 LLM 凭据**（不 set ANTHROPIC_API_KEY 等）仍能跑通产图——即为 graph-only 路径零 LLM 的端到端证据；可额外用 `vi.spyOn` 守护 LLM provider 入口（若 buildAstGraphOnly 依赖链有可 spy 的 LLM client）断言调用数=0，spy 不可行时以"无凭据跑通"为准并在断言注释说明。配合单元用例 A 的 `runBatch.not.toHaveBeenCalled()`（runBatch 是唯一 LLM 路径），构成零 LLM 的双向证据。
  - 改动文件：`tests/integration/mcp-batch-graph-only.test.ts`（新建）
  - 对应 FR：FR-006
  - 对应 SC：SC-载体-001（核心 oracle）
  - 并行：可与 T001-T007 并行（不依赖单元测试）

- [ ] T010 [US1] **集成红态确认**：运行集成测试，确认改动前测试红
  - 验收命令：`npx vitest run tests/integration/mcp-batch-graph-only.test.ts`
  - 预期结果（Codex W-002 澄清）：测试失败。**注意**：FakeMcpServer 不跑 Zod 校验，故红态**不一定**表现为"schema 拒绝"；改动前更可能是 handler 无 graph-only 分支 → 落入 runBatch(mode='graph-only') → runBatch validModes 抛错 / 或 buildAstGraphOnly 从未被调用 → graphPath 读取失败。接受任一形态的红（核心判据：**集成断言未通过**，即未产出 schemaVersion=2.0 的 portable graph）。
  - 并行：否（依赖 T009 完成）

---

## Phase 3: US1 P1 — 实现 server.ts（TDD GREEN）

**目标**：修改 `src/mcp/server.ts` 四个子步骤，使 Phase 1/2 所有红测试转绿，同时三旧 mode 行为不变。

**独立验收**：单元测试 + 集成测试全绿，全量 vitest 零失败。

**⚠️ 前置条件**：T008（单元红态确认）+ T010（集成红态确认）均已完成。

---

- [ ] T011 [US1] **追加 import**：修改 `src/mcp/server.ts` 约 :15 行，将 `import { runBatch }` 改为 `import { runBatch, buildAstGraphOnly }`
  - 改动文件：`src/mcp/server.ts`
  - 对应 FR：FR-004（复用现有 buildAstGraphOnly）
  - 对应 NFR：NFR-002（复用不重写）
  - 并行：否（后续子步骤依赖此 import 存在）

- [ ] T012 [US1] **Zod schema 枚举新增 `'graph-only'`**：修改 `src/mcp/server.ts` 约 :208-209 的 `z.enum([...])` 和 `.describe(...)` 文本
  - 枚举：`['full', 'reading', 'code-only', 'graph-only']`
  - describe：移除"MCP batch 暂不支持 graph-only"旧文案，新增 `graph-only（纯 AST · 零 LLM · 无需认证 · 仅建图不生成 spec 文档，可作为 impact/context 工具的前置步骤）`
  - 改动文件：`src/mcp/server.ts`
  - 对应 FR：FR-001、FR-002
  - 对应 SC：SC-载体-001b、SC-载体-003
  - 并行：可与 T013 并行（T011 完成后）

- [ ] T013 [US1] **TypeScript type union 同步新增 `'graph-only'`**：修改 `src/mcp/server.ts` 约 :220 的局部 handler 参数类型 `mode?: 'full' | 'reading' | 'code-only'` 改为 `mode?: 'full' | 'reading' | 'code-only' | 'graph-only'`
  - 改动文件：`src/mcp/server.ts`
  - 对应 FR：FR-003
  - 对应 SC：SC-载体-003（Zod/TS union/describe 三者一致性）
  - 并行：可与 T012 并行（T011 完成后）

- [ ] T014 [US1] **handler 新增 graph-only 提前分支**：在 `src/mcp/server.ts` handler 内 `const effectiveMode = ...` 日志行之后、`const fileConfig = loadProjectConfig(root)` 之前插入提前拦截分支：
  ```typescript
  if (effectiveMode === 'graph-only') {
    if (languages?.length) {
      mcpLogger.info('[warn] graph-only 不支持 languages 过滤，将全仓建图');
    }
    const graphResult = await buildAstGraphOnly(root);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(graphResult) }],
    };
  }
  ```
  - 改动文件：`src/mcp/server.ts`
  - 对应 FR：FR-004、FR-005、FR-009、FR-010
  - 对应 SC：SC-载体-001（dispatch 路由）
  - 并行：否（依赖 T011、T012、T013 全部完成）

---

## Phase 4: US1 P1 — 绿态确认 + mock 实证 + 全量门禁

**目标**：确认所有测试转绿，补全可能因新 import 缺失 export 的 mock 文件，通过全量门禁。

**独立验收**：`npx vitest run` 零失败，`npm run build` 零错误，`npm run repo:check` 零报错。

---

- [ ] T015 [US1] **单元绿态确认**：运行单元测试，确认 A、A2、B、C、D、E 全绿
  - 验收命令：`npx vitest run tests/unit/mcp-server.test.ts`
  - 预期结果：6 个新用例全部通过，现有用例无回归
  - 对应 SC：SC-载体-001（绿态确认）
  - 并行：否（依赖 T014 完成）

- [ ] T016 [US1] **集成绿态确认**：运行集成测试，确认真实 portable graph 端到端通过
  - 验收命令：`npx vitest run tests/integration/mcp-batch-graph-only.test.ts`
  - 预期结果：schemaVersion=2.0、绝对路径节点数=0、nodeCount>0、isError 为 undefined
  - 对应 FR：FR-006
  - 对应 SC：SC-载体-001（集成 oracle 绿态）
  - 并行：可与 T015 并行（均依赖 T014 完成）

- [ ] T017 [US1] **mock 实证 + 补全**：运行全量 vitest，检查 `response-contract.test.ts`、`telemetry-coverage.test.ts`、`graph-only-cli.test.ts`、`batch-command-exit-code.test.ts`、`cli-command-runners.test.ts`、`watch-command.test.ts` 等 mock `batch-orchestrator.js` 的文件是否因新增 `buildAstGraphOnly` import 而报缺失 export 错误；若有，在对应文件 mock 块补 `buildAstGraphOnly: vi.fn()`
  - 改动文件（可能）：`tests/unit/mcp/response-contract.test.ts`、`tests/unit/mcp/telemetry-coverage.test.ts` 等（仅当全量 vitest 报错时按需补充）
  - 验收命令：`npx vitest run`
  - 预期结果：零失败（含 watch-command 若在 worktree 偶发 flaky 可隔离重跑确认非回归）
  - 对应 NFR：NFR-001（零回归约束）
  - 并行：否（依赖 T015 + T016 均绿后执行全量）

- [ ] T018 [US1] **TypeScript 类型零错误确认**
  - 验收命令：`npm run build`
  - 预期结果：0 type errors
  - 对应 NFR：NFR-001
  - 并行：可与 T017 并行（T014 完成后即可执行）

- [ ] T019 [US1] **F196 守卫 + 仓库同步检查**：确认 batch 工具顶层 `description` 的 `Output:` 示例区文本未变（目视 `src/mcp/server.ts` 的 batch `description` 字符串），F196 守卫绿
  - 验收命令：`npm run repo:check`
  - 预期结果：零报错；batch 工具顶层 description 的 `Output:` 示例区保持 `{ successful, skipped, failed, indexGenerated }`，graph-only 专属字段不出现在该区
  - 对应 FR：FR-008
  - 对应 NFR：NFR-003（F196 不破坏）
  - 并行：可与 T017 并行（T014 完成后）

---

## Phase 5: US2 P2 — goal_loop Pilot 配置与 verify 遥测记录

**目标**：确认 goal_loop orchestration override 在 feature mode 已生效（F201 落地），并在 implement 阶段完成后生成 verify 报告，诚实记录 pilot 遥测数据。

**独立验收**：verify 报告包含「goal_loop 遥测」节，逐轮记录 `decision`/`impactInjectionMode`/`fallbackTriggered`/`rollbackTriggered`，给出坐实或推翻 F201 ⚠️ 未验证结论的实证。

**注意**：US2 的核心产物是 verify 报告文本，不引入额外代码改动。

---

- [ ] T020 [US2] **仅验证 goal_loop override 已生效（绝不修改 / 绝不 commit）**：🔴 Codex C-001 —— override 已在 pilot Step 0 启用，本任务**只读验证**，**不得修改 `.specify/orchestration-overrides.yaml`，更不得提交它**（它是 pilot 验证态，收尾要 `git checkout --` 还原）。若验证发现 override 缺失/失效，**停止并报告"pilot 环境未准备"，不要自行补写文件**。
  - 改动文件：无（只读验证）
  - 验收命令：`node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration feature --annotate`
  - 预期结果：feature mode 的 implement phase `agent_mode: goal_loop`，来源 overrides；diagnostics 无 error
  - 对应 SC：US2 Acceptance Scenario 1
  - 并行：可与 Phase 1-4 并行（只读）

- [ ] T021 [US2] **撰写 goal_loop 遥测节**：在 verify 报告中专列「goal_loop 遥测」节，按以下字段逐轮如实记录（不美化、不省略失败轮次）：
  - `iteration`（轮号）
  - `changed`（本轮改了什么）
  - `verifyExitCodes`（build/lint/test 退出码）
  - `decision`（REACHED_GOAL / continue / escalate_full / fallback）
  - `impactInjectionMode`（normal / degraded）
  - `fallbackTriggered`（是/否 + 原因）
  - `rollbackTriggered`（是/否 + 原因）
  - 并额外记录：是否踩降级路径（图谱 stale 导致 impact 注入降级）、"每轮 graph-only 刷图"M9 候选必要性评估
  - 改动文件：`specs/202-mcp-batch-graph-only-pilot/verification/verification-report.md`（**本报告入库**——它是 pilot 的核心产出，区别于不入库的 trace 运行态）
  - 验收 oracle（Codex W-005）：报告含「goal_loop 遥测」节，且每轮条目可被 grep 出上述 7 字段（`iteration`/`changed`/`verifyExitCodes`/`decision`/`impactInjectionMode`/`fallbackTriggered`/`rollbackTriggered`）；SC-001~004 各有明确"坐实/推翻/未触发+原因"结论句
  - 对应 FR：FR-011、FR-012
  - 对应 SC：SC-001、SC-002、SC-003、SC-004（goal_loop pilot 全部验收标准）
  - 并行：否（依赖 implement 阶段全量执行完毕后才能记录）

---

## Phase 6: Polish & Cross-Cutting Concerns

**目标**：确认改动面无遗漏，产物完整。

---

- [ ] T022 **注释清理**：确认 `src/mcp/server.ts` 中"MCP batch 暂不支持 graph-only"相关旧注释段（plan.md 提及 `:170–247` 区间已有此注释待清）已随 T012/T014 的文案替换而清除，无残留旧注释
  - 改动文件：`src/mcp/server.ts`（目视确认，若 T012/T014 未覆盖则补删）
  - 对应 FR：FR-002（describe 文案更新完整性）
  - 并行：可与 T017-T019 并行（T014 完成后）

- [ ] T023 **最终全量门禁汇总确认**：在所有任务完成后执行完整门禁序列，留存零失败证据
  - 验收命令（顺序执行）：
    1. `npx vitest run`
    2. `npm run build`
    3. `npm run repo:check`
  - 预期结果：三项全部零失败/零错误/零报错
  - 对应 SC：SC-载体-002（零回归）
  - 对应 NFR：NFR-001
  - 并行：否（必须在所有实现和 mock 补全完成后）

---

## FR 覆盖映射表

| FR | 对应任务 |
|----|---------|
| FR-001（Zod 枚举新增 graph-only） | T003（用例 A2 红测试）、T012（实现绿） |
| FR-002（describe 文案更新） | T005（用例 C 红测试）、T012（实现绿）、T022（注释清理） |
| FR-003（TS type union 同步） | T013（实现） |
| FR-004（handler dispatch 到 buildAstGraphOnly） | T002（用例 A 红测试）、T011、T014（实现绿） |
| FR-005（MCP 响应形态同构） | T002（用例 A 断言返回体） |
| FR-006（F193 portable 守卫） | T009（集成测试 oracle）、T016（集成绿态确认） |
| FR-007（三旧 mode 零回归） | T006（用例 D）、T017（全量 vitest） |
| FR-008（F196 守卫不破坏） | T019（repo:check）、T023（最终门禁） |
| FR-009（regen 参数不透传） | T004（用例 B 红测试）、T014（实现绿） |
| FR-010（languages warn 行为） | T007（用例 E 红测试）、T014（实现绿） |
| FR-011（impact 注入降级实证） | T021（verify 报告遥测节） |
| FR-012（M9 候选必要性实证） | T021（verify 报告遥测节） |

**覆盖率：12/12 FR（100%）**

---

## 依赖关系与执行顺序

### 严格串行链（TDD 主干）

```
T001（mock 补全）            T009（集成测试文件，独立并行）
  ↓                            ↓
T002-T007（A/A2/B/C/D/E）     T010（集成红态确认）
  ↓                            ↓
T008（单元红态确认）  ─────┬──┘
                          ↓
   （Codex W-001：T008 与 T010 均完成才进实现）
                          ↓
T011（import 追加）
  ↓
T012/T013（Zod enum + TS type，可并行）
  ↓
T014（handler 提前分支，必须等 T011+T012+T013）
  ↓
T015/T016（单元/集成绿态确认，可并行）
  ↓
T017（mock 实证 + 全量 vitest，Codex W-004：必须在 T015+T016 之后）
  ↓
T018/T019/T022（build / repo:check / 注释清理，T014 后即可，与 T017 同期）
  ↓
T023（最终汇总确认，依赖以上全部）
```

### 可并行机会

| 任务组 | 并行条件 |
|--------|---------|
| T002/T003/T004/T005/T006/T007 | 逻辑独立（各测一个 FR）；但同属 mcp-server.test.ts，**实施建议顺序写**避免行冲突（Codex I-002） |
| T009（集成测试文件新建） | 与 T001-T008 完全独立，可提前并行创建 |
| T012/T013 | T011 完成后可并行 |
| T015/T016/T018/T019/T022 | T014 完成后可并行执行（T015 与 T016 彼此独立） |
| T020（goal_loop 配置确认） | 与整个 Phase 1-4 并行，不依赖代码改动 |

### US 间依赖

- **US2 T021**（遥测记录）：必须在 US1 全部任务完成且 implement 阶段运行结束后才能写入 verify 报告
- **US2 T020**（override 确认）：独立，可提前

### goal_loop 迭代载体

**T008（单元红态确认）+ T010（集成红态确认）均完成**是 goal_loop 的**启动信号**（Codex W-001：两个红态都要先建立，缺一不可进实现）。T023（最终门禁零失败）是 goal_loop 的**收敛判据**（`REACHED_GOAL` 的 oracle）。goal_loop 自主迭代的范围是 Phase 3-4（T011-T019），其驱动的每轮验证命令即为 T015/T016/T017/T018/T019 所列的验收命令。

---

## 实现策略建议

**MVP First（唯一策略）**：本 Feature 规模极小，无法也无需分批交付。

1. Phase 1-2（红态建立）→ 确认红态 → Phase 3（四子步骤实现）→ Phase 4（绿态+门禁）→ Phase 5（goal_loop 遥测记录）→ Phase 6（最终汇总）
2. goal_loop 在 implement 阶段自主驱动 Phase 3-4 迭代，verify 报告如实记录每轮结果
3. 改动面极小（`src/mcp/server.ts` +10/-2 行，`tests/unit/mcp-server.test.ts` 新增 ~80 行，`tests/integration/mcp-batch-graph-only.test.ts` 新增 ~60 行），单人单次可完成

---

## 注

- `[P]` 标注的任务表示可并行（不同文件或无依赖），本 Feature 因 TDD 串行要求，主干任务多为顺序执行
- T017 的 mock 补全为条件性任务（全量 vitest 报错时才需执行），不报错则跳过
- watch-command.test.ts 在 worktree 环境偶发 flaky（见 project memory），如遇可隔离重跑确认非回归，不视为新引入失败
- T021 产出的 verify 报告为运行态产物，不入库；pilot 结论属开放问题，spec 不预设答案
