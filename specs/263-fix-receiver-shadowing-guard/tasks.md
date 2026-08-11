---
description: "Task list for F263 fix — receiver 类型定位本地导出分支缺失遮蔽守卫"
---

# Tasks: F263 — receiver 类型定位本地导出分支缺失遮蔽守卫

**Input**: `specs/263-fix-receiver-shadowing-guard/fix-report.md`（诊断定稿）、
`specs/263-fix-receiver-shadowing-guard/plan.md`（方案 A 落地细节）
**Mode**: fix（无 User Story 分组；按 TDD 红先行顺序组织）
**Prerequisites**: fix-report.md（必读，已定稿）、plan.md（必读，已定稿，本清单严格取自其变更清单与用例清单，不新增范围）

## Format: `[ID] [P?] 描述`

- **[P]**：可并行（不同文件、无依赖）
- 每个任务标明改哪个文件、做什么、如何验证

## Path Conventions

单一项目，`src/` + `tests/` 于仓库根目录（本仓库既有结构，不新增目录）。

---

## Phase 1: 红先行测试（写在实现之前，必须先跑到"失败"）

**目的**：按 plan.md「红先行用例清单」写齐 9 条用例（R13-R17 + M10d-M10f），在 Phase 2/3 实现代码改动之前先落地，跑一次确认失败（因当前源码尚无 `receiverTypeSoleBinding` 字段与判据，`Schema.parse` 或断言应失败/报错）。

- [x] T001 [P] 在 `tests/unit/knowledge-graph/call-resolver.test.ts` 新增一个紧邻现有 F260 用例表之后的 `describe` 块，写入 **R13**（局部类遮蔽同名导出类，`receiverTypeSoleBinding: false` ⇒ `edges` 整体 `toEqual([])`）、**R14**（泛型形参遮蔽同名导出类，同款断言）、**R15**（对照真边：`receiverTypeSoleBinding: true` ⇒ 照常产出 `caller.ts::schedule -> caller.ts::Task.run` medium/directional 边）、**R16**（字段缺席模拟旧 baseline ⇒ `toEqual([])`，验证 `=== true` 严格比较）、**R17**（遮蔽 + 恰好同名 import 目标存在时禁止 fallthrough，`receiverTypeSoleBinding: false` 且 `receiverTypeSoleImportBinding: true` 时仍须 `toEqual([])`，不得出现 `target` 以 `x.ts::Task.` 开头的边）。用例文本、`callSite` 字段取值与断言严格按 plan.md「红先行用例清单 §resolver 层」原文实现，不增删条件。
  验证：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "R13|R14|R15|R16|R17"` — 预期此时 R13/R14/R16/R17 因源码尚无新判据而**未能正确弃权**（产出假边，断言失败）或 `callSite` 字段在类型层报错，即"红"状态；R15 可能因当前分支 (a) 零守卫本就直通而"意外绿"，属预期（正向路径本来就该通，Phase 2/3 实现后仍须保持绿）。

- [x] T002 [P] 在 `tests/unit/typescript-mapper-callsite.test.ts` 的 `describe('F260 P3 — 歧义弃权与 A1 绑定点计数（M8–M10c）')` 块内、紧邻 `M10`/`M10b`/`M10c` 用例之后新增 **M10d**（局部类遮蔽同名导出类源码抽取，断言 `receiverType === 'Task'` 且 `receiverTypeSoleBinding === false`）、**M10e**（`declare const Foo: unknown; export function use(p: Foo){ p.m(); }`，断言 `receiverTypeSoleImportBinding === false` 且 `receiverTypeSoleBinding === true`，实证两字段语义分歧）、**M10f**（复用 M1 样本 `import { Foo } from './a.js'; const a = new Foo(); a.m();`，断言 `receiverTypeSoleImportBinding === true` 且 `receiverTypeSoleBinding === true`）。用例文本严格按 plan.md「红先行用例清单 §mapper 层」原文实现。
  验证：`npx vitest run tests/unit/typescript-mapper-callsite.test.ts -t "M10d|M10e|M10f"` — 预期因 `receiverTypeSoleBinding` 字段尚未产出（`_mkCallSite` 未写入、`CallSiteSchema` 未定义该字段），断言读到 `undefined` 而非期望的布尔值，三条均"红"。

**Checkpoint**：T001、T002 跑完后必须确认处于"红"状态（至少 R13/R14/R16/R17/M10d/M10e/M10f 共 7 条因源码未改而失败）；若全部意外绿，须停下核实用例是否正确覆盖了 fix-report 的复现场景，不得带着假绿进入 Phase 2。

---

## Phase 2: mapper 侧 surface 纯遮蔽计数

**目的**：把 mapper 侧表 1 已算出的遮蔽事实 surface 成分支 (a) 能消费的字段，这是分支 (a) 判据的数据前提。

- [x] T003 [US-mapper] 修改 `src/models/call-site.ts`：在 `CallSiteSchema`（现 L100 之后）新增 `receiverTypeSoleBinding: z.boolean().optional()`，doc comment 按 plan.md 变更清单 §2 原文（含与 `receiverTypeSoleImportBinding` 的语义对照、`undefined` 按 `false` 处理的 fail-closed 说明、同源产出不变量说明）。
  验证：`npm run build` 类型检查零错误（`CallSiteSchema` 推导类型同步更新）。

- [x] T004 [US-mapper] 修改 `src/core/query-mappers/typescript-receiver-env.ts`：
  1. `ReceiverBinding` 接口（现 L41-47）新增字段 `soleBinding: boolean`，doc comment 按 plan.md §1 原文。
  2. `ReceiverTypeEnv` 接口（现 L49-55）新增方法签名 `isSoleBinding(className: string): boolean`，doc comment 按 plan.md §1 原文。
  3. `buildReceiverTypeEnv` 返回对象（现 L540-548）在 `isSoleImportBinding` 旁新增实现：`isSoleBinding(className) { const slot = nameBindings.get(className); return slot !== undefined && slot.total === 1; }`，复用既有 `nameBindings` 表 1，不新增数据结构。
  4. `bind()` 私有函数（现 L646-650）组装 `ReceiverBinding` 时同源新增 `soleBinding: env.isSoleBinding(className)`，与 `soleImportBinding` 同一处写入。
  依赖：T003（`ReceiverBinding`/`ReceiverTypeEnv` 的字段命名需与 `CallSiteSchema` 字段命名对应一致）。
  验证：`npm run build` 类型检查零错误。

- [x] T005 [US-mapper] 修改 `src/core/query-mappers/typescript-mapper.ts`：`_mkCallSite`（现 L1397-1401）在既有「F260：两个字段同源产出」的 `if (receiver !== undefined)` 代码块内新增第三行 `cs.receiverTypeSoleBinding = receiver.soleBinding;`，与既有两行共享同一个守卫，不新增分支结构。
  依赖：T004（`receiver.soleBinding` 字段须先存在）。
  验证：`npm run build` 类型检查零错误；`npx vitest run tests/unit/typescript-mapper-callsite.test.ts -t "M10d|M10e|M10f"` 转绿（Phase 1 红先行 mapper 侧 3 条用例应全绿）。

**Checkpoint**：T003-T005 完成后，mapper 侧新字段已可产出且类型检查通过，M10d/M10e/M10f 三条红先行用例转绿；R13-R17（resolver 侧）此时仍应为红（分支 (a) 判据尚未实现）。

---

## Phase 3: resolver 侧消费遮蔽计数（分支 (a) 对称收紧）

**目的**：让 `locateClassFile` 分支 (a) 消费 Phase 2 新增的字段，堵住假边并保证不 fallthrough。

- [x] T006 [US-resolver] 修改 `src/knowledge-graph/receiver-type-resolution.ts`：
  1. `locateClassFile` doc comment（现 L157-163）改写：删除「类名在 caller 自己的导出表里时，它指的必然是本模块那个符号」这句错误断言，替换为 plan.md §4 原文（分支 (a) 需查 `receiverTypeSoleBinding` 确认无遮蔽、遮蔽或判据缺席一律整体弃权不 fallthrough 的说明）。
  2. `locateClassFile` 函数体（现 L164-176）分支 (a) 由 `if (ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)) return cs.callerFile;` 改为 `if (...) { return cs.receiverTypeSoleBinding === true ? cs.callerFile : null; }`（严格 `=== true` 比较，`undefined`/`false` 按有遮蔽处理），保留 plan.md §4 原文中解释「为何不得 fallthrough」的注释。
  依赖：T003（`cs.receiverTypeSoleBinding` 字段须先在 schema 中存在，`resolveOne`/`locateClassFile` 的 `cs` 参数类型才能通过类型检查读到该字段）。
  验证：`npm run build` 类型检查零错误；`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "R13|R14|R15|R16|R17"` 全绿（Phase 1 红先行 resolver 侧 5 条用例应全绿，包括此前"意外绿"的 R15 继续保持绿）。

**Checkpoint**：T006 完成后，Phase 1 全部 9 条红先行用例（R13-R17 + M10d-M10f）均应转绿；分支 (a)/(b) 判据对称收紧完成，判据落点单一（仅 `locateClassFile` 分支 (a) 一处返回值改动）。

---

## Phase 4: 既有回归验证 + 全量交付验证

**目的**：确认改动零回归、构建通过、门禁通过。

- [x] T007 单元测试聚焦回归复核：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts tests/unit/typescript-mapper-callsite.test.ts`，确认新增 9 条用例（R13-R17 + M10d-M10f）全绿，且既有全部用例（尤其 R4/R5/R8/R9/R9b/R10/R10b/R10c/R11/R12 —— 分支 (b) 与既有 fallthrough 语义）零回归。
  依赖：T006。

- [x] T008 全量测试：`npx vitest run`，确认零失败（覆盖全仓所有测试套件，非仅本次改动相关文件）。
  依赖：T007。

- [x] T009 [P] 构建校验：`npm run build`，确认类型检查零错误（`ReceiverBinding`/`ReceiverTypeEnv`/`CallSiteSchema` 三处接口定义同步，无类型不匹配）。
  依赖：T006（可与 T008 并行，二者互不依赖同一产物）。

- [x] T010 [P] 插件测试：`npm run test:plugins`，确认零失败（本次改动未涉及 `plugins/` 目录，预期无影响，仍需实跑确认无意外交叉回归）。

- [x] T011 仓库同步检查：`npm run repo:check`，确认通过（本次未触及 source-of-truth/包装层同步链路，预期直接通过）。
  依赖：T009。

- [x] T012 发布合同检查：`npm run release:check`，确认通过（本次未涉及版本/plugin metadata 改动，预期直接通过）。
  依赖：T011。

---

## Phase 5: 端到端人工核验（fix-report 复现 fixture 回归）

**目的**：用 fix-report 已实证的真实 fixture 复跑 graph-only 流水线，确认两条假边消失、对照真边保留。

- [x] T013 在 `scratchpad/repro`（沿用 fix-report 已实证的 fixture 路径与内容：`a.ts` 局部类遮蔽案例①、`b.ts` 泛型形参遮蔽案例②、`c.ts` 对照真边）执行 `node dist/cli/index.js batch --mode graph-only`（跑前先 `npm run build` 确保 `dist/` 是本次改动后的最新产物），核对 calls 边：
  - `src/a.ts::schedule -> src/a.ts::Task.run`（INFERRED，假边①）**不再出现**；
  - `src/b.ts::process -> src/b.ts::Handler.run`（INFERRED，假边②）**不再出现**；
  - `src/c.ts::driver -> src/c.ts::Real.go`（对照真边）**仍然出现**，tier 不变。
  依赖：T009（`dist/` 须基于改动后源码重建）。
  验证：将 batch 输出中的 calls 边列表实测结果（而非纸面推演）写入 verify 阶段交付报告；三条断言均需逐条给出实测证据。

---

## Phase 6: 生产图重建与回归核验

**目的**：在 self-dogfood baseline（本仓库自身）上验证本次判据收紧只挡新构造的遮蔽反例，不影响生产代码库已验证过的真实调用边集合。

- [x] T014 重建生产图：基于本次改动后的 `dist/`（依赖 T009 已重建），对本仓库执行全量图重建（沿用 F260/F259 既有生产图重建流程，`spectra batch --mode graph-only` 或等价的全量采集命令，覆盖 `src/**`）。
  依赖：T009、T013（先完成 fixture 级人工核验，再动生产图，避免在未确认 fixture 正确的情况下污染生产图判断）。

- [x] T015 用重算器核对生产图指标：运行 `specs/260-fix-instance-method-call-edges/verification/coverage-metric.mjs`（对 T014 产出的图数据），核对：
  - method 节点 calls 入边数 = **238**（F260 验收口径）；
  - method 覆盖率 = **236/517**（同一重算器口径，不用人工小计）。
  依赖：T014。
  处置规则（按 plan.md「回归风险评估」）：
  - 两数字与基线**完全一致** → 视为通过，直接记录进 verify 交付报告。
  - 数字有**个位数级别**下降 → 需逐边核对是否命中 plan.md 已登记的「文件级误伤」取舍面（表 1 文件级计数不感知块级作用域，函数 A 局部同名类可能误伤函数 B 对导出类的真实调用），逐条给出被弃权边的 `source -> target` 与弃权原因，判定为符合预期（非回归）后方可记入交付报告；不得笼统归因，须逐边解释。
  - 数字下降**超出个位数级别**，或**上升**（新增边），或 method 覆盖率分母 517 发生变化 → 视为异常，暂停交付，回退检查 T003-T006 是否与 plan.md 判据定稿逐字一致，禁止在未查明原因前继续。

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（红先行测试）**：无前置依赖，可立即开始；T001、T002 分属不同文件，可并行。
- **Phase 2（mapper 侧）**：依赖 Phase 1 完成（先见"红"状态）。T003 → T004 → T005 严格串行（`CallSiteSchema` 字段命名 → `ReceiverBinding`/`ReceiverTypeEnv` 接口 → `_mkCallSite` 消费，三层类型依赖自上而下）。
- **Phase 3（resolver 侧）**：依赖 Phase 2 完成（T006 依赖 T003 的 `cs.receiverTypeSoleBinding` 字段存在）。
- **Phase 4（回归 + 全量验证）**：依赖 Phase 3 完成（T006）。T007 → T008 串行；T009/T010 可与 T008 并行；T011 依赖 T009；T012 依赖 T011。
- **Phase 5（端到端人工核验）**：依赖 T009（`dist/` 重建）。
- **Phase 6（生产图核验）**：依赖 T009、T013（先 fixture 级核验再生产图核验）。

### 关键路径

T001/T002（并行）→ T003 → T004 → T005 → T006 → T007 → T008 → T009 → { T010（并行）、T011 → T012、T013 → T014 → T015 }

### 并行机会

- T001、T002：不同测试文件，无依赖，可并行。
- T009、T010：不同验证命令、不同产物，Phase 3 完成后即可并行发起。
- T004 完成后 doc comment 与实现可视为同一任务内的顺序小步骤，不再拆分并行（同一文件内的三处改动有阅读顺序依赖，拆分并行价值低于出错风险）。

---

## Implementation Strategy

本次是**单一收敛的 fix**，无 User Story 拆分，不适用"MVP / 增量交付 / 并行团队"策略。执行顺序即交付顺序：

1. Phase 1 红先行测试落地并确认"红"（证明当前源码确有此缺陷，测试确实在测这个问题而非空转）。
2. Phase 2 mapper 侧 surface 遮蔽计数（数据前提）。
3. Phase 3 resolver 侧消费（判据落地，唯一行为改动点）。
4. Phase 4 全量回归 + 门禁验证。
5. Phase 5 fixture 级端到端人工核验（复现 fix-report 三个案例）。
6. Phase 6 生产图重建 + 重算器核对 238 / 236/517，逐边解释任何偏差。

全部 Phase 完成、T015 判定通过后方可进入 verify 阶段收尾交付报告。

---

## FR / 变更清单覆盖映射

| plan.md 变更清单项 | 对应 Task |
|---|---|
| §1 `typescript-receiver-env.ts`（`ReceiverBinding.soleBinding` / `ReceiverTypeEnv.isSoleBinding` / `buildReceiverTypeEnv` 实现 / `bind()` 组装） | T004 |
| §2 `call-site.ts`（`receiverTypeSoleBinding` schema 字段 + doc comment） | T003 |
| §3 `typescript-mapper.ts`（`_mkCallSite` 第三字段同源写入） | T005 |
| §4 `receiver-type-resolution.ts`（doc comment 改写 + 分支 (a) 判据） | T006 |
| 红先行 R13-R17（resolver 层用例） | T001，验证于 T006 |
| 红先行 M10d-M10f（mapper 层用例） | T002，验证于 T005 |
| 红先行 §端到端（fixture 复现回归） | T013 |
| 验证方案 §单元测试 | T007 |
| 验证方案 §全量测试 | T008 |
| 验证方案 §构建 | T009 |
| 验证方案 §端到端人工核验 | T013 |
| 验证方案 §生产图回归口径（238 / 236-517） | T014、T015 |
| Constitution Check（不改 `.codex/**`/`.claude/**`、`require_real_execution=true`、不越界优化） | 全 Task 集合遵循，无独立 Task（约束性检查已内嵌在各 Task 的"依据 plan.md 原文"措辞中） |

**明确排除（不生成对应 Task，理由见 plan.md「不做什么」）**：
- `call-resolver.ts` Stage 1/Stage 2 同根因假边（F263-R-3，后续 Feature 候选）—— 不在本清单内。
- `BEHAVIOR_VERSION` bump —— 不在本清单内。
- `fromImport===0` 额外收紧 —— 不在本清单内。
- `specs/src.spec.md` 更新 —— 不在本清单内（再生产物）。
- `specs/260-.../verification/callsites-fingerprint.mjs` 更新 —— 不在本清单内（一次性验证工件，未接入 CI）。
</content>
