---
feature_id: 260
mode: fix
title: 实例方法调用边解析 — 任务分解
source_plan: ./plan.md
source_fix_report: ./fix-report.md
created: 2026-08-08
---

# F260 任务分解 — 实例方法调用边解析

> 本文件严格承接 `plan.md`（已定稿，两轮编排器修订 + 两路异构对抗审查裁决落账）的判据与阶段划分，
> **不重新论证、不改动任何 A1–A8 / B1–B8 裁决**。阶段锚点为 plan §6 的 P0 → P2 → P3 → P4 → P5
> （**P1 已按 B4 裁决降格并入 P2，本文件不单列 P1 阶段**）。

## 待编排器裁决的冲突

无。逐条核对 plan.md 全文（定稿决策 D1–D6、变更清单 §5、阶段表 §6、验收方案 §7、回滚偏序 §8）
未发现内部自相矛盾；plan 与 fix-report 之间的数字/判据差异（如覆盖率下限系数 0.5→0.75、
条件数五→六、453/515 上界与本次可达面无关等）均在 plan 正文中已显式标注为「对 fix-report 的更正」，
不构成 plan 自身矛盾，故不在此登记。

---

## 变更清单覆盖映射（plan §5，逐项对应任务 ID，确保 100% 覆盖）

| # | 变更内容 | 阶段 | 任务 ID |
|---|---|---|---|
| 1 | `buildClassMemberIndex` 补 `kind==='re-export'` 过滤 | P2 | T014 |
| 2 | `ImportReferenceSchema` 新增 `namedImportBindings?` | P2 | T009 |
| 3 | `ast-analyzer.ts` `extractImports`/`bindingNamesOf` 产出 `namedImportBindings` | P2 | T010 |
| 4 | `typescript-mapper.ts` `_extractImportStatement` 读 `alias` | P2 | T011 |
| 5 | `tree-sitter-fallback.ts` `extractImportsFromText` 保留 `as` 右侧 | P2 | T012 |
| 6 | `call-resolver.ts` `renamedImportAliases` + `buildImportIndex` 两遍消费 + 三处前置拦截 | P2 | T013 |
| 7 | `CallSiteSchema` 新增 `receiverType?`/`receiverTypeSoleImportBinding?` | P3 | T020 |
| 8 | 新建 `typescript-receiver-env.ts`（两张表 + A1/A3/A4/A5 判据） | P3 | T021 |
| 9 | `typescript-mapper.ts` 接线（两遍式 + AST 取构造器名） | P3 | T022 |
| 10 | 新建 `receiver-type-resolution.ts`（D2b 六条件与门） | P4 | T030 |
| 11 | `call-resolver.ts` `resolveOne` 插入新分支调用 | P4 | T031 |
| 12 | `buildClassMroIndex` L379 收窄 + TS/JS `extends` 分支（B7 正向判据） | P5 | T036 |
| 13 | `tests/unit/typescript-mapper-callsite.test.ts`（M1–M15c） | P2/P3 | T007, T016–T019 |
| 14 | `tests/unit/knowledge-graph/call-resolver.test.ts`（R1–R16） | P2–P5 | T008, T027–T029, T035 |
| 15 | 新建 `verification/edge-diff.mjs` | P0 | T002 |
| 16 | 新建 `verification/callsites-fingerprint.mjs` | P0 | T003 |

---

## Phase P0: 基线与工具

**目标**：在未改任何源码的 HEAD 上落地归因工具与三份基线锚点，作为 P2–P5 每阶段 A/B 归因的比较基准。

- [x] T001 [P0] 依赖：无 — 确认工作目录构建产物为最新：执行 `npm run build`，确认 `dist/` 是本次 HEAD（未改源码）的构建产物（§8 风险表「陈旧 dist 造假回归信号」防线）。
  文件：无源码改动。
  验收：`npm run build` 零报错；记录构建完成时间戳，晚于本任务开始时刻。

- [x] T002 [P] [P0] 依赖：无 — 新建 `specs/260-fix-instance-method-call-edges/verification/edge-diff.mjs`：逐边 diff 重算器。
  比较键 `source|relation|target|confidence` 四元组，**多重集计数**（非集合去重，D4 归因方法约定）。
  须实现：
  - §7.1 断言 2 的 exportKind 两跳判据（symbol 节点直接查 `metadata.exportKind==='class'`；member 节点 `file::Cls.name` 先定位所属 symbol 节点 `file::Cls`，要求其 `exportKind==='class'` **且**该成员来自那个 `kind==='class'` 的 export 条目自己的 `members`，不得由同名 interface 条目提供——对齐 A6/R10b）；
  - §7.1 断言 3 悬空边检测（新增边 source/target 均存在于最终图节点集）；
  - P2 retarget 判据（§6：新增边必须全部是「同 source + 同 `calleeName`、仅 target 变」的 retarget 对）；
  - P4 ≤308 成对 retarget 判据（B6，同判据但上限 308）；
  - B5 dedup 顺序敏感性排除提示（非零 diff 时输出提示：需先排除 `graph-builder.ts:422-437` 第五路 first-write-wins 的顺序敏感性再归因）。
  验收：对两份内容相同的 graph JSON 跑出零差；对人工构造的一增一减 fixture 能正确识别为 retarget 对；对悬空边 fixture 能正确报出悬空边。

- [x] T003 [P] [P0] 依赖：无 — 新建 `specs/260-fix-instance-method-call-edges/verification/callsites-fingerprint.mjs`：callSites 产物指纹重算器（B1，P3 主锚点）。
  对全仓 callSites 计算 `callerFile|line|column|calleeName|calleeKind|calleeQualifier|callerContext|enclosingNamedContext` 排序集合 + 总条数，比较两份 callsites JSON 快照，输出「指纹零差 / 指纹非零」结论。
  须显式**排除**新增字段（`receiverType`/`receiverTypeSoleImportBinding`）参与比较键（否则 P3 阶段的正常新增字段会被误判为指纹差异）。
  验收：对相同输入零差；对仅新增字段变化的输入零差；对指纹键任一字段变化的输入报非零差异。

- [x] T004 [P0] 依赖：T001, T002, T003 — 在未改任何源码的当前 HEAD 上跑 `spectra batch --mode graph-only`，落盘 `specs/260-fix-instance-method-call-edges/verification/graph-P0.json` 与 `.../callsites-P0.json`（D4 步骤 3，两份产物）。
  文件：`specs/260-fix-instance-method-call-edges/verification/graph-P0.json`、`.../callsites-P0.json`。
  验收：两份文件存在且非空；`graph-P0.json` 的 calls 边数量级与 fix-report §1 基线（3841）相符（HEAD 漂移允许小幅出入，须在任务备注记录实测值）。

- [x] T005 [P0] 依赖：T004 — 跑 `spectra graph-quality`，落盘 `specs/260-fix-instance-method-call-edges/verification/P0-graph-quality.json`（对齐 F243 before/after 命名先例）。
  验收：六指标（duplicate/orphan/dangling/ignored/freshness/contains-coverage）全部落盘，作为 P2–P5 各阶段「不劣于 P0」判据的基线。

- [x] T006 [P0] 依赖：T004 — 用既有 `specs/260-fix-instance-method-call-edges/verification/coverage-metric.mjs` 对 `graph-P0.json` 重算主口径覆盖率，落盘 `specs/260-fix-instance-method-call-edges/verification/coverage-P0.json`（method 覆盖率、function 覆盖率、gapRatio）。
  验收：method 覆盖率 ≈ 29.5%、function 覆盖率 ≈ 89.3%（与 fix-report §1 基线相符，允许 HEAD 漂移的小幅出入），作为 §7.1 断言 5 覆盖率下限比较的 P0 基线。

**Checkpoint**：三份基线产物（`graph-P0.json` / `callsites-P0.json` / `P0-graph-quality.json`）+ 覆盖率基线 + 两个归因工具就绪，P2 可开工。

---

## Phase P2: H1 别名键收口 + re-export 过滤（P1 已并入本阶段，B4 裁决）

**目标**：收口 `aliasToTarget` 的重命名 import 假边面（H1）+ 对齐 `buildClassMemberIndex` 的 re-export 过滤（结构对齐，生产端当前不可达）。**红先行**：M13/R1/R2/R3 先落地确认为红，再实现。

### Tests for P2（先落地并确认为红）

- [x] T007 [P] [P2] 依赖：T001 — 在 `tests/unit/typescript-mapper-callsite.test.ts` 落地 **M13**（H1 抽取侧 tree-sitter 路径：`import { Foo as ExternalFoo } from './a.js'` 断言 `namedImportBindings` 含 `{imported:'Foo', local:'ExternalFoo'}`），**先落地并确认为红**。
  验收：`npx vitest run tests/unit/typescript-mapper-callsite.test.ts -t M13` 失败（红）。

- [x] T008 [P] [P2] 依赖：T001 — 在 `tests/unit/knowledge-graph/call-resolver.test.ts` 落地 **R1**（H1 假边守卫：带 `namedImportBindings` 的重命名 import + 非导出本地同名 class，`Foo.run()` 不产出假边）、**R2**（H1 兼容：不带该字段的条目行为逐字不变）、**R3**（re-export 索引契约白盒测试；用例注释须写明 `extractReExports` 生产端当前不产 `members`，本用例约束的是索引契约而非当前行为），**先落地并确认为红**。
  验收：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts -t "R1|R2|R3"` 三条均失败（红）。

### Implementation for P2

- [x] T009 [P2] 依赖：T007, T008 — `src/models/code-skeleton.ts`：`ImportReferenceSchema` 新增可选字段 `namedImportBindings?: Array<{ imported: string; local: string }>`（变更 #2）。
  产出规则：仅当该条 import 语句至少有一个重命名说明符时产出；一旦产出即为该条目 `namedImports` 的**完整**绑定视图（含未重命名项）。
  验收：`npm run build` 类型检查通过；zod schema 校验通过（不破坏既有 `ImportReference` 使用点）。

- [x] T010 [P] [P2] 依赖：T009 — `src/core/ast-analyzer.ts`：`extractImports` 静态分支（`:470` `getNamedImports().map(n => n.getName())` 附近）+ `bindingNamesOf`（`:660`）按 D1 产出规则写入 `namedImportBindings`（变更 #3，路径 1/2：ts-morph 静态 import + dynamic 解构，两条主路径）。
  验收：`npm run build` 通过；对应单测（若在 M13 覆盖范围外单独构造 ts-morph 路径样本）通过。

- [x] T011 [P] [P2] 依赖：T009 — `src/core/query-mappers/typescript-mapper.ts`：`_extractImportStatement`（`:865/882`）读取 `import_specifier` 的 `alias` 字段，产出 `namedImportBindings`（变更 #4，路径 3：tree-sitter 静态 import 降级路径）。
  验收：**M13 转绿**。

- [x] T012 [P] [P2] 依赖：T009 — `src/core/tree-sitter-fallback.ts`：`extractImportsFromText`（`:125` `.split(/\s+as\s+/)[0]`）保留 ` as ` 右侧，产出 `namedImportBindings`（变更 #5，路径 4：正则最终兜底）。
  验收：`npm run build` 通过；正则兜底路径对应样本（双失败场景）行为符合 D1 产出规则。

- [x] T013 [P2] 依赖：T010, T011, T012 — `src/knowledge-graph/call-resolver.ts`：`ImportInfo` 新增 `renamedImportAliases: ReadonlySet<string>`（A8 的 `typeOnlyAliases` 已撤回，**不实现**）；`buildImportIndex` 两遍消费 `namedImportBindings`（`local===imported` 照旧写 `aliasToTarget`；`local!==imported` 既不写 `aliasToTarget` 也不写别处，`local` 记入 `renamedImportAliases`）；Stage 2 import 回退、Stage 3 查表两处消费点在查 `aliasToTarget` 前先查 `renamedImportAliases`，命中即弃权（变更 #6；第三处消费点——P4 新分支——留待 T030/T031 接线，此处只需暴露 `renamedImportAliases` 供其消费）。
  验收：**R1、R2 转绿**。

- [x] T014 [P2] 依赖：T013 — `src/knowledge-graph/call-resolver.ts`：`buildClassMemberIndex` 补 `kind==='re-export'` 过滤（变更 #1，结构对齐，§2.2-7 已确认生产端当前不可达 ⇒ 零行为变化）。
  验收：**R3 转绿**。

### A/B 归因 — P2

- [x] T015 [P2] 依赖：T009, T010, T011, T012, T013, T014 — A/B 归因（P2 主锚点=逐边 diff）：
  1. `npm run build`
  2. `spectra batch --mode graph-only`
  3. 落盘 `specs/260-fix-instance-method-call-edges/verification/graph-P2.json` + `.../callsites-P2.json`
  4. 跑 `node .../edge-diff.mjs graph-P0.json graph-P2.json`
  5. 跑 `spectra graph-quality` → 落盘 `.../P2-graph-quality.json`
  期望 diff（§6 P2 行）：**只减不增**，唯一例外是「同 source + 同 `calleeName`、仅 target 变」的 retarget 对（§6「P2『只减不增』论证」段的场景：同一 imported 名既有重命名条目又有非重命名条目）。
  验收：`edge-diff.mjs` 输出的**非 retarget 新增边数 = 0**；每条减少的边人工核对确为假边（记录核对结论）；出现任何不成对新增边即停工排查，不进入 P3；六指标不劣于 `P0-graph-quality.json`。
  **状态核实（4d，plan §17-6）**：制品 `verification/p2-attribution.md`（标题即「F260 P2 A/B 归因报告（T015）」）+ `edge-diff-P0t-to-P2.json` / `edge-diff-P0-to-P2.json` / `P2-graph-quality.json` / `coverage-P2.json` 齐备 ⇒ **已完成**。基线口径按 p2-attribution §0 多引入 `P0t` 锚点（红先行用例本身是新增 TS 源码，须隔离）。

**Checkpoint**：H1 别名键假边面已收口，`renamedImportAliases` 就绪供 P4 消费；P3 可开工。

---

## Phase P3: mapper 侧接收者环境（resolver 不消费）

**目标**：mapper 两遍式建**接收者类型绑定环境**，产出 `receiverType`/`receiverTypeSoleImportBinding`。本阶段 resolver **不消费**新字段，归因只看抽取层是否动到既有 callSite 产出。**红先行**：M1–M15c 先落地确认为红。

### Tests for P3（先落地并确认为红，均在 `tests/unit/typescript-mapper-callsite.test.ts`，同文件顺序落地）

- [x] T016 [P3] 依赖：T015 — 落地 **M1–M7**（基础绑定形态：局部变量/类型注解/形参/字段声明/字段初始化/`new Foo()`AST构造器名 + H7 守卫：三元/索引表达式构造器不产出），**先落地并确认为红**。
  验收：`npx vitest run ... -t "M1|M2|M3|M4|M5|M6|M7"` 全部失败（红）。
  **状态核实（4d，plan §17-6）**：`tests/unit/typescript-mapper-callsite.test.ts` 现存 M1–M7 各 1 条（逐个 grep 计数 = 1）⇒ **已完成**。红先行的「实现前判红」时序未在 attribution 单列（P3 侧无红先行章节，仅 P2 在 p2-attribution §0、P4 在 p4-attribution §3 有登记），此处按用例落地现状勾。

- [x] T017 [P3] 依赖：T016 — 落地 **M8, M9, M9b, M10, M10b, M10c**（歧义弃权/类型不可知同名绑定弃权/A4重赋值/A1本地声明/A1 import遮蔽import承重样本/A1零绑定fail-closed），**先落地并确认为红**。
  验收：`npx vitest run ... -t "M8|M9|M9b|M10|M10b|M10c"` 全部失败（红）。
  **状态核实（4d）**：M8 / M9 / M9b / M10 / M10b / M10c 六条现存各 1 条 ⇒ **已完成**。

- [x] T018 [P3] 依赖：T017 — 落地 **M11, M12, M12b, M12c, M12d**（`this.m()`不夺路径/两遍式H4/A3`this.x`跨类串台/A3宿主带extends弃权/A5类型形状约束四否一是），**先落地并确认为红**。
  验收：`npx vitest run ... -t "M11|M12|M12b|M12c|M12d"` 全部失败（红）。
  **状态核实（4d）**：M11 / M12 / M12b / M12c / M12d 五条现存各 1 条 ⇒ **已完成**。另按裁决 P3-2（plan §12）补了 M12e / M12f / M12g（A3d/A3e 零转红的守护力缺口），归因见 `verification/p3-attribution.md` §1.4。

- [x] T019 [P3] 依赖：T018 — 落地 **M14, M15, M15b, M15c**（fail-closed不变量遍历断言/dynamic解构=import来源镜像/静态import与require(...)同形态），**先落地并确认为红**。
  验收：`npx vitest run ... -t "M14|M15|M15b|M15c"` 全部失败（红）。
  **状态核实（4d）**：M14 / M15 / M15b / M15c 四条现存各 1 条 ⇒ **已完成**。

### Implementation for P3

- [x] T020 [P3] 依赖：T015, T019 — `src/models/call-site.ts`：`CallSiteSchema` 新增可选字段 `receiverType?: string`、`receiverTypeSoleImportBinding?: boolean`（变更 #7；A1 裁决字段更名，fail-closed 方向：`undefined` 按 `false` 处理）。
  验收：`npm run build` 通过。
  **状态核实（4d）**：`src/models/call-site.ts:88` `receiverType: z.string().optional()`、`:100` `receiverTypeSoleImportBinding: z.boolean().optional()` 均在位 ⇒ **已完成**。

- [x] T021 [P3] 依赖：T020 — 新建 `src/core/query-mappers/typescript-receiver-env.ts`（纯函数，输入 `Parser.Tree`，输出环境对象）：第一遍全文件建**两张独立的表**——
  - 表 1（类名绑定点计数表）：key=类名，value=绑定点计数 + 唯一绑定来源。登记口径含 `import_statement` 各类绑定名、任意作用域 `class`/`interface`/`enum`/`type`/`function` 声明、任意 `variable_declarator` 绑定名（含解构、含 `const X = class {}`）、`catch`/函数形参、**A4 裁决**：已知名字左值的 `assignment_expression` 计为类型不可知绑定点。判据表（D2）覆盖静态 import / dynamic 解构 / `.then()` 回调 / `require(...)` 四种 AST 判据；括号归一化照 `ast-analyzer.ts:575-581` 逐个接缝剥括号；判不出来源一律按「否」处理（R-9）。
  - 表 2（接收者名→类名环境）：**A3 裁决**：`this.x` 键按 `ClassName#x` 分桶（宿主取自 `_findAncestorClassName`/`callerContext`）；宿主为对象字面量方法/匿名类/带 `extends` 的类时一律弃权（登记 R-15）。**A5 裁决**：`receiverType` 只接受裸 `type_identifier` 或 `generic_type` 的 name 部分；`union_type`/`intersection_type`/`conditional_type`/`qualified_name`/`type_query`/数组类型一律不产出。歧义即弃权（同名第二个不同类型绑定 / 类型不可知同名绑定含 A4 赋值 → 整体剔除）。
  （变更 #8，预算 +260 行）
  验收：**M1–M12d 全部转绿**。
  **状态核实（4d）**：文件已建（含 `buildReceiverTypeEnv` / `resolveCallSiteReceiver` 导出、`collectPatternNames` 等两张表实现）⇒ **已完成**。后续经 P4b（T044–T049）与 P5b（T060–T062）多轮收口，当前形态以磁盘为准。

- [x] T022 [P3] 依赖：T021 — `src/core/query-mappers/typescript-mapper.ts`：`extractCallSites` 先建环境（两遍式，H4，先收候选再收敛写入，同 F242 先例）；`_handleMemberCall`/`_handleNewExpression`/`_mkCallSite` 接线产出 `receiverType`/`receiverTypeSoleImportBinding`；`_handleNewExpression` 改走 AST `childForFieldName('constructor')` 且强制 `type==='identifier'`（H7，**禁文本正则**）（变更 #9，净增量预算 **≤40 行**）。
  验收：**M13 之外全部 M 用例转绿**（M1–M12d 已由 T021 覆盖，此处补齐 M14/M15/M15b/M15c 接线验证）；`_walkCallSites` 既有行为不受影响（M11/M12 断言）。
  **状态核实（4d）**：`typescript-mapper.ts:20` import 两个纯函数、`:975` `buildReceiverTypeEnv(tree)` 建环境、`:1236` `resolveCallSiteReceiver(...)`、`:1280` `node.childForFieldName('constructor')`（H7 走 AST 非正则）、`:1399-1400` 写入两个新字段 ⇒ **已完成**。

### A/B 归因 — P3（B1 裁决：主锚点是 callSites 产物指纹，非边集 diff）

- [x] T023 [P3] 依赖：T020, T021, T022 — A/B 归因：
  1. `npm run build`
  2. `spectra batch --mode graph-only`
  3. 落盘 `specs/260-fix-instance-method-call-edges/verification/graph-P3.json` + `.../callsites-P3.json`
  4. 跑 `node .../callsites-fingerprint.mjs callsites-P2.json callsites-P3.json`（**主锚点**，须排除新增字段后比较）
  5. 跑 `node .../edge-diff.mjs graph-P2.json graph-P3.json`（辅助信号，预期为空，**空不构成充分证据**）
  6. 跑 `spectra graph-quality` → 落盘 `.../P3-graph-quality.json`
  验收：callSites 指纹（除新增字段外）**零差**；**指纹非零即停工排查**，不得跳过直接进入 P4；六指标不劣于 `P2-graph-quality.json`。
  **状态核实（4d，plan §17-6）**：制品 `verification/p3-attribution.md` + `callsites-fingerprint-P2t-to-P3.json` / `callsites-fingerprint-positionfree-P2t-to-P3.json` / `edge-diff-P2t-to-P3.json` / `P3-graph-quality.json` / `coverage-P3.json` / `callsites-digest-P3.json` 齐备 ⇒ **已完成**。⚠️ 判据口径经**裁决 P3-1**（plan §12）修订：含 `line`/`column` 的主口径「零差」被认定为**结构性不可满足**（§5 变更 #9 自己就批了 +40 行，必然位移行号），主锚点改为 `--position-free` 口径，断言「减少 = 0 且新增全部可归因为本阶段新增代码自身」——实测位置无关口径减少 = 0、新增 132 条全落在新增代码内、全仓 1149 文件仅 3 个指纹变化（恰为本次修改的 3 个源文件）。原含位置口径的 FAIL 数字（353 新增 / 221 减少）**原样保留**在 p3-attribution §3.1，不作判据。

**Checkpoint**：`receiverType`/`receiverTypeSoleImportBinding` 已在 callSite 层稳定产出，且未扰动既有抽取行为；P4 可开工。

---

## Phase P4: resolver 新分支（D2b 六条件与门）

**目标**：resolver 侧插入受控解析分支，消费 P2 的 `renamedImportAliases` 与 P3 的 `receiverType`。**开工前必须先完成两项前置复核 + 结构上界探针**（plan §7.1），**红先行**：R4–R12/R16 先落地确认为红。

### 前置复核（P4 开工第一件事，硬性要求，缺一不可）

- [x] T024 [P] [P4] 依赖：T023 — **§7.1 断言 1 前置复核 (a)**：核实 `PythonLanguageAdapter` 在 `batch-orchestrator.ts:1215-1217` 与 `graph-assembly.ts:240-241` 两个调用点均**未**落入 `suppressedDynamicAliases`。
  验收：两个调用点抑制状态均为「未抑制」，如实记录进验证报告；**任一条不成立 ⇒ 回到 plan 重新讨论，不得为让断言过而放宽 H5 拦截**。

- [x] T025 [P] [P4] 依赖：T023 — **§7.1 断言 1 前置复核 (b)**：核实这两个调用点在 T022 实现后产出的 `receiverTypeSoleImportBinding === true`（即 A1 绑定点计数在这两个文件中确实=1 且来源为 import；主线程已独立复现"各只有1个绑定点"，此处只需复验标志值）。
  验收：两个调用点标志值均为 `true`，如实记录；**任一条不成立 ⇒ 回到 plan 重新讨论，不得放宽 A1 判据**。

- [x] T026 [P] [P4] 依赖：T023 — **结构上界 `U` 探针重算**：在**本轮收紧后的口径**下（A1/A2/A3/A5/A6 五道新弃权**全部计入**；A8 已撤回，不计入）重算可达 method 节点数 `U`（= 可达 method 节点数 / 515），供 §7.1 断言 5 覆盖率下限 `max(40.0%, U×0.75)` 使用。
  验收：`U` 值落盘 `specs/260-fix-instance-method-call-edges/verification/structural-upper-bound-P4.json`，并据此写明本次覆盖率下限具体数值。

### Tests for P4（先落地并确认为红，均在 `tests/unit/knowledge-graph/call-resolver.test.ts`，同文件顺序落地）

- [x] T027 [P4] 依赖：T024, T025, T026 — 落地 **R4, R5, R6, R7, R8**（F260 真实形态 A/B + 条件③守卫 + fail-closed + H5 守卫），**先落地并确认为红**。
  验收：`npx vitest run ... -t "R4|R5|R6|R7|R8"` 全部失败（红）。

- [x] T028 [P4] 依赖：T027 — 落地 **R9, R9b, R10, R10b, R10c**（type-only+interface 守卫（由条件④保证）/ A8 撤回回归钉 / 条件④守卫 / A6 声明合并 / A2 default import 守卫），**先落地并确认为红**。
  验收：`npx vitest run ... -t "R9|R9b|R10|R10b|R10c"` 全部失败（红）。

- [x] T029 [P4] 依赖：T028 — 落地 **R11, R12, R16**（成员验证不产 medium 占位 / 不夺路回归断言 / dynamic 解构必须出边），**先落地并确认为红**。
  验收：`npx vitest run ... -t "R11|R12|R16"` 全部失败（红）。

### Implementation for P4

- [x] T030 [P4] 依赖：T029 — 新建 `src/knowledge-graph/receiver-type-resolution.ts`（纯函数）：D2b 六条件与门——
  ① `receiverType` 存在
  ② 该名字未被 `suppressedDynamicAliases` 抑制，**且拦截前置于本模块导出查找**（H5）
  ③ 类名可定位：本模块导出命中；**或** `receiverTypeSoleImportBinding===true` **且**该名字不在 `renamedImportAliases`（D1，消费 P2 产出）**且**不是 `defaultImport` 引入的别名（A2 裁决，新分支直接弃权 default import 定位来源）
  ④ 定位到的 export 条目 `kind==='class'`
  ⑤ 方法名存在于**条件④那一个 export 条目自己的 `members`**（A6 裁决：不得"④查A索引、⑤查classMemberIndex"，声明合并场景下二者可能指向同名的两个不同条目——登记 R-12）
  ⑥ 置信度统一 `medium`（INFERRED）
  任一不成立 ⇒ fallthrough，不出任何新边。
  （变更 #10，预算 +110 行）
  验收：**R6, R7, R8, R9, R9b, R10, R10b, R10c, R11 转绿**。

- [x] T031 [P4] 依赖：T030 — `src/knowledge-graph/call-resolver.ts`：`resolveOne` 在 Stage 1 之后、Stage 2 之前插入新分支调用（变更 #11，净增量预算 ≤40 行，预计 +12）。
  验收：**R4, R5, R16 转绿**；**R12 不夺路回归断言通过**（`receiverType` 不存在的既有形态，边集与修改前逐字一致）。

### 硬断言复验 + A/B 归因 — P4

- [x] T032 [P4] 依赖：T031 — **§7.1 硬断言 1 复验**：跑 `impact(upstream)` 查询 `src/adapters/python-adapter.ts::PythonLanguageAdapter.extractSymbolNodes` 的调用者，确认结果**同时包含** `batch-orchestrator` 与 `graph-assembly` 两个调用者。
  验收：两个调用者均出现在 `affected` 列表中；**不成立则回到 plan 重新讨论，不得为让断言过而放宽拦截/判据**。

- [x] T033 [P4]（**判据 FAIL 已裁决放行** —— 见 `verification/p4-attribution.md` §5.3 / §5.4：`unclassified 3` 与 `断言 2 违规 2` 均为判据作用域缺口，硬断言 1/3/4/5 与六指标全部 PASS）依赖：T031 — A/B 归因（P4 主锚点=逐边 diff；**B5 裁决**：新增边计数以 UnifiedGraph 层（去重前）为准，另记最终图层净增，**两个数都入报告**）：
  1. `npm run build`
  2. `spectra batch --mode graph-only`
  3. 落盘 `specs/260-fix-instance-method-call-edges/verification/graph-P4.json` + `.../callsites-P4.json`
  4. 跑 `node .../edge-diff.mjs graph-P3.json graph-P4.json`
  5. 跑 `spectra graph-quality` → 落盘 `.../P4-graph-quality.json`
  期望 diff（§6 P4 行 + B6 裁决）：**只增不减**，例外仅限「同 source + 同 `calleeName`、仅 target 变」的**成对 retarget，且成对数 ≤308**；出现任何**不成对**减少边 ⇒ **先排除第五路 dedup 顺序敏感性**（§6 约定 3）再归因，仍不成对即停工排查。
  验收：**§7.1 断言 2**（新增边中 target 落在非 `class` 声明上的条数=0，由 `edge-diff.mjs` 计算）通过；**§7.1 断言 3**（无悬空新增边）通过；**§7.1 断言 4**（P4 减少边仅限 ≤308 成对 retarget）通过；用 `coverage-metric.mjs` 重算覆盖率，与 T026 的下限比较（低于下限不判失败，但须记录逐条弃权归因，不得默默接受）；六指标不劣于 `P3-graph-quality.json`。
  **状态核实（4d，plan §17-6）**：制品 `verification/p4-attribution.md` §4–§5 + `edge-diff-P3t-to-P4.json` / `callsites-fingerprint-P3t-to-P4.json` / `P4-graph-quality.json` / `coverage-P4.json` / `structural-upper-bound-P4.json` 齐备 ⇒ 归因**已执行完成**。两条机械 FAIL 已由编排器裁决人工通道放行、**工具不改**：`unclassified 3`（三条全是新建文件自己的 `depends-on` 出边，已逐条回源码核对为真 import）沿用**裁决 P4b-1**（plan §14）；`断言 2 违规 2`（新增导出函数自身获得的真实调用边，与 125 条新分支边交集为空）沿用**裁决 P4b-2 / P2-2**（plan §14 / §11）。§16-1 对 P5 同形两项再次确认沿用。

- [x] T034 [P4] 依赖：T033 — 人工抽样核对：从 P4 新增边中**随机**抽样 **≥20 条**逐条回源码核对（不挑好核的），确认无假边。
  验收：抽样清单 + 每条核对结论入库 `specs/260-fix-instance-method-call-edges/verification/p4-sample-audit.md`。
  **落点备注（4d，plan §17-9）**：抽样制品**未**单列为 `p4-sample-audit.md`，实际落在 `verification/p4-attribution.md` **§8「抽样核对表（T034，≥20 条，随机不挑好核的）」**；P4b 轮换种子（mulberry32 seed 4260）重抽的 28 条见 `verification/p4b-attribution.md` **§6**，原始抽样清单 JSON 落 `verification/sample22-P4b.json`。以 attribution 实际章节为准。

**Checkpoint**：新分支已上线，两条真实调用者边已恢复，六道弃权守卫全部生效；P5 可独立开工（P5 不阻塞已交付的 P2–P4）。

---

## Phase P5: TS extends MRO（H8 纳入，独立可回退）

**目标**：修复 `buildClassMroIndex` 对 TS 恒为空的死代码，补继承方法验证。**红先行**：R13/R14/R14b/R14c/R15 先落地确认为红。**本阶段独立回退**：出现任何 interface-target 或跨类误指 ⇒ 单独摘除 P5，不阻塞 P2–P4。

### Tests for P5（先落地并确认为红，均在 `tests/unit/knowledge-graph/call-resolver.test.ts`，同文件顺序落地）

- [x] T035 [P5] 依赖：T033 — 落地 **R13, R14, R14b, R14c, R15**（TS extends MRO 产边 / implements 截断 / A7 interface 收窄 / B7 语言分流守卫 / Python MRO 隔离回归），**先落地并确认为红**。
  验收：`npx vitest run ... -t "R13|R14|R14b|R14c|R15"` 全部失败（红）。
  **状态核实（4d，plan §17-6）**：`tests/unit/knowledge-graph/call-resolver.test.ts` 现存 R13 / R14 / R14b / R14c / R15 各 1 条 ⇒ **已完成**。P5 实测覆盖面远超本任务原定 5 条：R13b / R13c / R16–R22（前一代理落盘）+ R23–R31（P5b 变异测试补的 9 条杀手用例，见 `verification/p5-attribution.md` §1.5），本文件套件基线 111 tests / 0 failed。

### Implementation for P5

- [x] T036 [P5] 依赖：T035 — `src/knowledge-graph/call-resolver.ts`：`buildClassMroIndex`——
  - **A7 裁决**：`:379` 显式收窄，TS/JS 分支内**仅 `kind==='class'` 进**（该行今天是 `kind!=='class' && kind!=='interface'` continue，interface 本就在处理范围内，只加 TS 分支而不动此行会让 `interface Task extends Runner` 进 MRO）；
  - 新增 TS/JS `extends` 分支：正则须**在 ` implements ` 处截断**（取 signature 中 `extends` 之后、`implements` 之前片段，再 `bracketAwareSplit`）；`stripGenericParams` 支持 `<`（现仅剥 `[`）；
  - **B7 裁决**：语言分流用**正向判据** `sk.language==='typescript' || sk.language==='javascript'` 显式命中，**禁止**「非 Python 即 TS」的反向判据；
  - `lookupInMro` 的 superName 解析同样受 `renamedImportAliases`（D1，P2 产出）与 A1 绑定点判据约束（`:640` 查 `aliasToTarget` 是同一张表的第二个消费点）。
  （变更 #12，预算 +25 行）
  验收：**R13, R14, R14b, R14c, R15 全部转绿**。
  **状态核实（4d）**：`src/knowledge-graph/call-resolver.ts` 现存 `const isTsJs = sk.language === 'typescript' || sk.language === 'javascript'`（B7 正向判据）、`isTsJs ? exp.kind !== 'class' : exp.kind !== 'class' && exp.kind !== 'interface'`（A7 收窄）、新增 helper `extractTsExtendsClause` + `indexOfTopLevelKeyword`（`implements` 顶层截断、括号感知）、`stripGenericParams` 已支持 `<` ⇒ **已完成**。

### A/B 归因 — P5

- [x] T037 [P5] 依赖：T036 — A/B 归因：
  1. `npm run build`
  2. `spectra batch --mode graph-only`
  3. 落盘 `specs/260-fix-instance-method-call-edges/verification/graph-P5.json` + `.../callsites-P5.json`
  4. 跑 `node .../edge-diff.mjs graph-P4.json graph-P5.json`
  5. 跑 `spectra graph-quality` → 落盘 `.../P5-graph-quality.json`
  期望 diff（§6 P5 行）：**只增不减**；新增边来自 Stage 2（member 路径）/ Stage 4（super 路径）/ 新分支（含新 MRO 父类）三处，须按 target 归类记录。
  验收：**interface-target 新增边 = 0**；任何跨类误指 ⇒ **单独回退 P5**（不阻塞已交付的 P2–P4，回滚方式见 plan §8「回滚边界：摘 P5（不被任何其他阶段消费）」）；六指标不劣于 `P4-graph-quality.json`。
  **状态核实（4d，plan §17-6）**：制品 `verification/p5-attribution.md` §3 + `edge-diff-P4b-to-P5.json` / `edge-diff-P5off-to-P5.json` / `P5-graph-quality.json` / `coverage-P5.json` / `callsites-digest-P5.json` 齐备 ⇒ **已完成**。基线锚点为 **P4b**（非 P4，承接 P4b 收口轮终态）。实测：只增不减（新增 4 / 减少 0 / retarget 0）；**interface-target 违规 = 0**（全图佐证：`coverage-P5.json` 的 `symbolNodesByExportKind.interface` = 580 节点入边恒 0）；六指标逐字持平 P4b、`overallVerdict = pass`。两条机械 FAIL（2 条 `depends-on` unclassified、1 条断言 2 违规）按**裁决 §16-1** 沿用 P4b-1 / P2-2 人工通道放行，工具不改。**另记 §16-2**：特性 A/B（P5off→P5）图产物 sha256 **逐字节相同** ⇒ P5 特性在本仓语料图足迹 = 0 条边，已排除结构性失效（索引真实产出 20 条 TS/JS 条目），真因是 17 个满足前提的 member 调用点全调本类自己的方法；plan D3 预估的「几十条边」上界实测为 0，**P5 真实语料守护力目前只由用例承担（R-17）**。

- [x] T038 [P5] 依赖：T037 — 人工全量核对：P5 新增边（量级几十条）**全量**逐条回源码核对。
  验收：核对清单 + 每条核对结论入库 `specs/260-fix-instance-method-call-edges/verification/p5-full-audit.md`。
  **落点备注（4d，plan §17-9）**：核对制品**未**单列为 `p5-full-audit.md`，实际落在 `verification/p5-attribution.md` **§3.2「4 条新增边**全量**人工回源码核对（不是抽样）」**——因 §16-2 的实测口径修正，P5 新增边只有 4 条（非 plan 预估的「几十条」）且**全部源自本轮 N44 键集合探针引入的 import，与 TS extends MRO 特性无关**，4 条逐条给出源码行号证据 + `git show HEAD:` 新增性证据，结论全为真边。以 attribution 实际章节为准。

**Checkpoint**：TS `extends` MRO 修复完成且独立可回退；四个归因锚点（P2/P3/P4/P5）全部收尾。

---

## 收尾：全量门禁 + 验收汇总

- [ ] T039 依赖：T038 — 全量门禁（零失败，§7.2）：依次跑 `npm run build`、`npx vitest run`、`npm run test:plugins`、`npm run repo:check`、`npm run release:check`、`spectra graph-quality`。
  **注**：`collector-fingerprint` 护栏（含在 `npx vitest run` 内）跑绿**不构成 F260 的验证信号**（B7 裁决：pinned 图 TS/JS 侧 calls 边=0，该护栏对本次改动结构性无投影，登记 R-14），照常跑但不得据此下结论。
  验收：六项全部零失败；六指标不劣于 `P0-graph-quality.json`。
  **状态核实（4d，plan §17-6）：不勾 —— 待 4c 重跑收口。** 理由：① P5b 轮已跑过一遍（`verification/p5-attribution.md` §4：`build` 0 / `test:plugins` 0（1580/1580）/ `repo:check` 0（1 条 `graph-quality:freshness` warning，按硬约束未重建仓库图）/ `release:check` 0），但 **`npx vitest run` 全量退出码 1**（5 文件 7 用例失败 + 12 条 birpc `onTaskUpdate` 超时），5 个文件隔离复跑全绿、判定为满载 flake（§4.1），**按本任务「六项全部零失败」的字面判据未达成**；② 4d 轮之后又有新改动（`typescript-receiver-env.ts` 注释、两个 `verification/*.mjs` 的 `SEP` 写法），门禁必须在最终树上重跑。**由 4c verify 阶段执行并盖章。**

- [ ] T040 依赖：T039 — 不回退清单核对（§7.2）：确认 F214 canonical ID（`::` 统一）、两级 `contains`、F242 三级归属回退链（`resolveSourceId` 未被新分支触碰——新分支只决定 target 与 tier）均保持不变。
  验收：逐条书面确认写入 `specs/260-fix-instance-method-call-edges/verification/` 验证报告。
  **状态核实（4d，plan §17-7）：不勾 —— 三证已在 attribution，待 4c 汇总盖章。** 三条证据现状：① `containsCoverage` 6284/6284 pass（`p5-attribution.md` §3.5）；② `resolveSourceId` 未被新分支触碰（新分支只决定 target 与 tier）；③ canonical ID 无变更。按 §17-7 裁决，**书面核对并入 4c verify 报告**，由 4c 出具最终逐条确认。

- [ ] T041 依赖：T039 — 覆盖率重算与验收口径核对（§7.1 断言 5 + fix-report §6）：用 `coverage-metric.mjs` 对最终图（P5 收尾后）重算主口径 method/function 覆盖率与 `gapRatio`，落盘 `specs/260-fix-instance-method-call-edges/verification/coverage-final.json`；与 T026 的下限 `max(40.0%, U×0.75)` 及 `gapRatio ≤ 2.3` 比对。
  验收：数值入库；若低于下限须给出逐条弃权归因写入验证报告（不判失败，但不得默默接受）；同时确认 fix-report §3 的「453/515=88.0% 名字匹配上界与本次可达面无关」标注已就位（该标注由编排器在 fix-report 侧落实，此处仅核对存在）。
  **状态核实（4d，plan §17-6）：不勾 —— 数值已具备，缺 `coverage-final.json` 落盘与 4c 汇总。** 现状：① 最终相位覆盖率已落 `verification/coverage-P5.json`（`methodCoveragePct` 45.6% ≥ 下限 `max(40.0%, U×0.75)` = 40.0%；`functionCoveragePct` 89.4%；`gapPct` 43.8 / **`gapRatio` 1.96 ≤ 2.3**），归因见 `p5-attribution.md` §3.5；② fix-report §3 的「名字匹配上界 453/515 = 88.0% 与本次可达面无关，不得用于设定预期」标注**已在位**（`fix-report.md:80`）。**未达成的只有「落盘为 `coverage-final.json`」这一形式项**——P5 相位后若门禁重跑未改图，可直接以 `coverage-P5.json` 为最终值另存；由 4c 收口。

- [ ] T042 依赖：T034, T038, T040, T041 — 汇总逐边 diff 报告、callSites 指纹差异、P4/P5 抽样与全量核对结论、覆盖率对账，整理入库 `specs/260-fix-instance-method-call-edges/verification/`（§7.3）。
  验收：`verification/` 目录下含 P0–P5 全部 `graph-P*.json`/`callsites-P*.json`/`P*-graph-quality.json` 产物 + `edge-diff`/`callsites-fingerprint` 报告 + `p4-sample-audit.md`/`p5-full-audit.md` + `coverage-final.json` + `structural-upper-bound-P4.json`。
  **状态核实（4d，plan §17-6）：不勾 —— 依赖 T040/T041，且验收清单的三项已按后续裁决改口径，待 4c 汇总收口。** 口径变更如实登记：① `graph-P*.json` / `callsites-P*.json` **按裁决 P2-4 不入库**（大产物只留 sha256 + 生成命令，见各 attribution 的「不入库大产物」节），入库的是压缩形态 `callsites-digest-P*.json`；② `p4-sample-audit.md` / `p5-full-audit.md` **未单列**，落点见 T034 / T038 的落点备注（plan §17-9）；③ `coverage-final.json` 见 T041。**当前已入库**：`P0/P2/P2t/P3/P3t/P4/P4b/P5-graph-quality.json`、`coverage-P0/P2/P2t/P3/P3t/P4/P4b/P5.json`、`edge-diff-*.json` ×9、`callsites-fingerprint-*.json` ×5、`callsites-digest-*.json` ×6、`structural-upper-bound-P4.json`、`sample22-P4b.json`、5 份 attribution + 两份审查报告 + 4 个重算器脚本。

- [ ] T043 依赖：T039 — R-7 已知限制落盘（D6 配套确认）：在最终 fix-report 或 commit message 中注明「已有本地图快照不会因解析逻辑变更而自动失效，需全量重建才能看到新边」。
  验收：文案已写入交付制品。
  **状态核实（4d，plan §17-7）：不勾 —— 按裁决落 commit message，尚未 commit。** §17-7 明确 T043（R-7「已有本地图快照不会因解析逻辑变更而自动失效，需全量重建才能看到新边」）**落 commit message**；本轮硬约束禁止任何 git 写操作，故留待交付时执行。

---

## Dependencies & Execution Order

### Phase 依赖

- **P0**：无前置依赖，可立即开始。
- **P2**：依赖 P0 完成（T001–T006）。
- **P3**：依赖 P2 完成（T015），按 plan §4「前置收口先落地并各自验证 → 再落新分支」的顺序硬约束。
- **P4**：依赖 P3 完成（T023）**且** P2 产出的 `renamedImportAliases` 已就绪（T013）——P4 六条件与门的条件③直接消费 P2 产出，这是 §8 回滚偏序「摘 P2 必须先摘 P4」的正向依赖来源。
- **P5**：依赖 P4 完成（T033），且独立于 P4 内部实现（P5 不被任何其他阶段消费，可独立回退）。
- **收尾**：依赖 P2–P5 全部完成（T034, T038）。

### 阶段内依赖（红先行）

- 每阶段的测试任务（Tests for P*）必须先落地并确认为红，才能开始该阶段的 Implementation 任务。
- Implementation 任务按变更清单的文件依赖顺序排列：schema/字段变更 → 抽取层产出 → resolver 消费 → A/B 归因。

### 回滚依赖偏序（B2 裁决，硬性，来自 plan §8）

- `renamedImportAliases` 由 P2（T013）产出，被 P4（T030 六条件与门条件③）消费 ⇒ **摘 P2 必须先摘 P4**，顺序不可颠倒。
- **摘 P3 可独立**：P4 会因 `receiverType` 恒缺席而静默失效（条件①不成立），不产生半开状态。
- **摘 P5 可独立**：不被任何其他阶段消费。

### Parallel Opportunities

- P0：T002（`edge-diff.mjs`）与 T003（`callsites-fingerprint.mjs`）不同文件、无依赖，可并行。
- P2：T007（mapper 测试）与 T008（resolver 测试）不同文件，可并行；T010/T011/T012（ast-analyzer/typescript-mapper/tree-sitter-fallback）不同文件、同依赖 T009，可并行。
- P4：T024（前置复核 a）、T025（前置复核 b）、T026（结构上界探针）互不依赖同一产物，可并行。
- 同一测试文件内的多批用例（如 T016–T019、T027–T029）因编辑同一文件存在顺序依赖，不标 `[P]`。

---

## P4b 收口轮（plan §13 v7 对抗审查裁决派生，tasks.md 原文无对应任务号，此处补记）

> 归因报告：`verification/p4b-attribution.md`。P4b 不新增能力，只做弃权面收口 +
> 归因工具收口 + 证据链收窄。**P5 未开工，一行未碰。**

- [x] T044 [P4b] — **M1**：一切值级绑定（import / 函数 / 类 / enum / namespace / 具名函数与类表达式）在 `bindName` 之外同时 `bindReceiver(name, null)` 进表 2 中毒。
- [x] T045 [P4b] — **M2**：`resolveThisHostBucket` 在 `method_definition` 上遇 `static` 修饰即返回 null（与 `class_static_block` 同档）。
- [x] T046 [P4b] — **M3**：`type_parameter` 补进表 1 登记面（`TYPE_ONLY_DECLARATION_TYPES`）。
- [x] T047 [P4b] — **M4**：`edge-diff.mjs`「新符号自证边」改双向判定；单端新增落 `new-endpoint-manual` 桶并标 `notEvaluated`，禁止用 `unclassified = 0` 代表「已核实为真」。
- [x] T048 [P4b] — **W-A**：`classBucketName` 对类表达式（`type === 'class'`）弃权。
- [x] T049 [P4b] — **W-B**：赋值绑定点扩到 `augmented_assignment_expression` 与解构赋值左值（白名单 `identifier` / `object_pattern` / `array_pattern`）。
- [x] T050 [P4b] — **W-C**：`buildNamedImportBindings` 的 ts-morph 主路径与正则兜底路径各补一条走真实抽取的用例。
- [x] T051 [P4b] 依赖：T044–T050 — **M5 变异测试收尾**：按被测模块源码判据面**独立枚举** 70 个变异体（禁从既有断言反推）；65 杀死 / 5 个经「结构可达性论证 + 78,579 采点实测」证明为等价变异；补 N42–N44 三条杀手用例。**终态：零「非等价 + 无杀手」**（报告 §1）。
- [x] T052 [P4b] 依赖：T051 — **归因重跑**：构造 P4t 中间基线隔离源码改动；`P4t→P4b` 逐边 diff **零变化**（PASS）；`P4→P4b` 原始口径 1 条 `depends-on` 新增，机械判据 **FAIL(unclassified=1)**，人工核对为 W-C 引入的真边，**未自行改判**（报告 §3.1–§3.2）。
- [x] T053 [P4b] 依赖：T052 — **硬断言 1 复核 PASS**：`impact(upstream)` 对 `PythonLanguageAdapter.extractSymbolNodes` 仍含 `batch-orchestrator` 与 `graph-assembly`，M1 中毒扩面未误伤（报告 §5.1）。
- [x] T054 [P4b] 依赖：T052 — **覆盖率与六指标复算**：`methodCoveragePct` 45.6%（下限 40.0%）、`gapRatio` 1.96，与 P4 逐字一致；`graph-quality` 六指标逐字段一致、`overallVerdict = pass`（报告 §5.2–§5.3）。
- [x] T055 [P4b] 依赖：T052 — **抽样核对**：换种子（mulberry32 seed 4260）重抽 22 条 `phase-expected` 边 + §3.3 的 6 条 `new-endpoint-manual` 边，**共 28 条全部回源码核对为真**（报告 §3.3 / §6）。
- [x] T056 [P4b] — **W-D**：`p3-attribution.md` §3.2 结论收窄为「全仓**未改动文件**的既有 callSite 逐字未变」，对被改动的 3 个文件明确写出证据链**不能**排除语义置换（原文保留 + 修正注记）。
- [x] T057 [P4b] — **W-E**：新增可重跑重算器 `verification/h1-phantom-key-stats.mjs`（实跑复现 36/37/24/32/35）；`p2-attribution.md` §3 补采集口径（采集器同源 1239 文件 / 不含 gitignore / 含 type-only 且分列 3 : 34）并更正「其余 31 个」的强度表述。
- [x] T058 [P4b] 依赖：T051–T057 — **全量门禁零失败**：`build` / `vitest run`（**7273 passed, 0 failed**）/ `test:plugins`（1580/0）/ `repo:check` / `release:check` 全部退出码 **0**（报告 §7）。

> **未完成 / 待裁决**（不粉饰，详见报告 §10）：
> ① §3.2 的机械判据 FAIL（`unclassified = 1`）未自行改判，是否把三分类扩到 `depends-on` 边交编排器；
> ② §3.3 的 `assertion2` 2 条违规与 P4 报告 §5.4 同源，属判据作用域缺口，非本轮新增；
> ③ **Codex 对抗审查缺席（配额耗尽）**，本轮属门禁 / 判定器类改动，须显式标注档位缺席。

---

## P5b 收口轮（plan §15 v9 裁决 P5b-1 ~ P5b-5 派生，tasks.md 原文无对应任务号，此处补记）

> 归因报告：`verification/p5-attribution.md`（同时覆盖 **P5 断连续接** 与 **P5b 四项收口**）。
> 本段按 P4b 段（T044–T058）的补记先例书写，任务号续接 **T059**。
> ⚠️ **审查档位：Codex 对抗审查暂停（配额耗尽），异构档位缺席**——本轮含判定器性质改动
> （`h1-phantom-key-stats.mjs` 的 dist 新鲜度闸），按 `CLAUDE.local.md` 顶部暂停节显式标注，配额恢复后可回补。

- [x] T059 [P5b] — **裁决 P5b-1**：两个被 P4b「等价」结论证伪的变异体补杀手用例。
  `Q01-this-bare-hijack`（形态 1 扩到裸 `this`）与 `U11-memberHost-accept-any-parent` 在 P4b 被判等价，
  本轮以**实测 AST**证伪其前提：`const this = new Foo()` 在 tree-sitter TS 语法下解析**零 ERROR**、
  `this` 落 `variable_declarator` name 位（键 `'this'` 可被登记）；`public_field_definition` 的 parent
  **不恒为** `class_body`（WIP 半成品文件里可以是 `ERROR` 节点）。带 import 版的 Q01 更会产出
  `soleImportBinding=true` 的**高置信假边**。口径承接裁决 P5b-1：**磁盘上的 WIP / 半成品文件是 Spectra 的
  真实采集面，「tsc 会报错」不构成豁免**。
  落点：`tests/unit/typescript-mapper-callsite.test.ts` 新增 **N46 / N46b / N47 / N47b**（现存各 1 条）；
  变异清单 `p5b/env-mutants.mjs`（sha256 `0081bf76…5797`，不入库），基线 122→123 tests / 0 failed。
  归因：`verification/p5-attribution.md` §2.1。**两个变异体均转为「☠ 杀死」。**
  **跑批器 fail-closed 实证（同清单收尾整批复跑）**：`W02` 一次返回 `INVALID_RUN（total 0 != 123）`
  ——vitest 在满载下没跑起任何用例，严格版跑批器**没有**把「一个用例都没跑」读成 SURVIVED，
  单独重跑得 `KILLED（N45d）`。裁决 §16-3：处置正确，留痕即可。

- [x] T060 [P5b] — **裁决 P5b-2**：N44 改写（口径升级）+ N43 因果订正。
  **N44 改写**：从端到端断言改为**直接对 `buildReceiverTypeEnv` 的注册键集合断言**——表 2 全部宿主分桶键
  （含 `#` 的键）必须逐字等于 `['anon#conn']`，端到端断言保留为补充。7 个兜底桶名变异体
  （`V07a`–`V07g`）复验 **7 / 7 全杀**（旧端到端口径下有 5 个存活）；其中「删 `host == null` 子句」一条
  裁决预判「大概率等价」，**实测非等价**——它只在旧口径下等价（`null#conn` 这个键永远不会被查），
  改口径把「注册了一个永远不会被查的假键」从不可观测变成可观测。
  **N43 因果订正**：用例注释原先把守护归因给 `collectPatternNames` 里的
  `if (node.type === 'property_identifier') return;`，那是**结构冗余守卫**（叶子节点，删掉后通用递归照样
  采不到它）；真正承重的是 `out.push` 白名单。注释已改写。
  落点：`tests/unit/typescript-mapper-callsite.test.ts` 的 N43 / N44 用例注释与断言；
  已知耦合如实登记在用例注释（探针依赖「两张表用 `Map` 承载」，换容器会以「键集合为空」**明红**而非静默放行，
  4b-Q7 判可接受，登记 **R-21**）。归因：`verification/p5-attribution.md` §2.2。

- [x] T061 [P5b] — **裁决 P5b-3**：`for_in_statement` 补 W-B 左值白名单（**本轮唯一的源码改动**，真 recall bug）。
  `assignment_expression` 分支有 `ASSIGNMENT_BINDING_TARGET_TYPES` 白名单挡住 `a.b = 1` / `a[k] = 1`
  （改的是**属性**，名字 `a` 所指未变），`for_in_statement` 分支没有同款——for-of / for-in 的左值同样允许是
  赋值目标。方向是**丢边不是假边**，但两个入口是同一判据的两面，不对称本身就是 F259 型隐患。
  落点：`src/core/query-mappers/typescript-receiver-env.ts` —— `for_in_statement` 分支复用**同一张表**
  `ASSIGNMENT_BINDING_TARGET_TYPES`（不复制第二份），表的文档注释写明两个消费点。
  修前 / 修后走 `TreeSitterAnalyzer.analyze()` 真实抽取实测：`for (rec.slot of xs)` / `for (rec[0] of xs)`
  的 `receiverType` 由 **undefined（误中毒）→ A, sole=true**；两条对照组行为不变。
  保真反向用例（防把 recall 修成假边口子）：**N45c**（`for (const rec of xs)` 是真绑定，仍必须中毒）、
  **N45d**（`for (const { rec } of xs)` 解构声明同样中毒）——AST 实测 11 种声明写法的 `left` 恒为
  `identifier` / `object_pattern` / `array_pattern`，全在白名单内。
  **连带守护力回归复核（重要）**：加白名单后 N43 的输入不再走到 `collectPatternNames`，P4b 变异体 `U16`
  **从「被 N43 杀死」退化为存活**——补 **N43b**（`({ slot: rec.slot } = src)`，解构**赋值**左值是
  `object_pattern`，一路递归到 `member_expression` 才碰到 `property_identifier`）并重跑 5 个相关 P4b 变异体，
  **5 / 5 全杀，守护力无净损失**（清单 `p5b/p4b-recheck-mutants.mjs`，sha256 `bd1ebd5d…3ea9ce`）。
  同族的解构默认值（`assignment_pattern`）按裁决**不修**，保持登记 **R-16**。
  归因：`verification/p5-attribution.md` §1.6 / §2.3。

- [x] T062 [P5b] — **裁决 P5b-4**：`verification/h1-phantom-key-stats.mjs` 四处收口（判定器性质，档位缺席已标注）。
  - **W3**（`b.isTypeOnly` 恒假死子句）：删掉，改按 **import 条目级**（`imp.isTypeOnly`）判定；输出
    `renamedSpecifiersTypeOnly: 3` / `ValueOnly: 34`，与 P4b 记录**逐字一致**（本仓无 inline 写法）。
    能力边界已写进文件头：inline `import { type X as Y }` 归**值**侧（schema 无说明符级 `isTypeOnly`），
    本仓 3 : 34 的拆分**碰巧正确，换一个仓库即失真**。
  - **W4**（陈旧 dist 全零 + exit 0 = 自身 fail-open）：三道闸——关键符号缺席 → **exit 2**；全零 → **exit 3**；
    mtime 倒挂 → 告警并落 `distStaleWarning`。三个场景**用构造的 fake dist 实跑**（§2.4.1），**闸全部响**。
    这一步承接 **F257 的教训：新加的门禁自己 fail-open 是最常见的失效形态**。
  - **W1**（collisions 含注释 / 字符串 / import 自身）：加 `strictCollisions` 第二列，两口径并报，宽口径逐字保留；
    **宽 22 / 严 14**，差集 8 条逐条回源码核对（§2.4.2）。方向性结论不变（幽灵键的 `imported` 名在同文件
    存在同名标识符**并不罕见**），只是强度从 22 收窄到 14；裁决 P4b-3「两口径接受并存」原样成立。
  - **W2**（`$` 词边界假阴性）：doc 登记为已知限制，新增 `wordBoundaryUnverifiableNames` 计数**不再静默**
    （本仓 0 实例）。严口径是**词法级近似**（正则字面量 / JSX 文本未处理），给的是**下界**——登记 **R-20**。
  归因：`verification/p5-attribution.md` §2.4 / §2.4.1 / §2.4.2。

- [x] T063 [P5b] 依赖：T059–T062 — **裁决 P5b-5 断连续接 + P5 变异测试收尾**（本轮主交付）。
  **续接口径**：P5 实现代理在「修 3 个撞 `bracketAwareSplit` 的锚点」处断连，其源码改动与 R13–R22 用例
  已落盘且全绿，本轮**未重做**，报告如实区分「承接既有」与「本轮新做」。
  **断连点处置**：`I01`–`I03` 的锚点文本在 `indexOfTopLevelKeyword` 与 `bracketAwareSplit` 里**逐字相同**
  （hits=2 ⇒ 跑批器判 `ANCHOR_ERROR` 并跳过，**是 fail-closed 行为不是缺陷**）；把锚点扩到带上各自的
  `else if` 行以区分两侧，并**顺带把 `bracketAwareSplit` 一侧也补进枚举**（`I01b` / `I03b`）——原清单只枚举
  一侧本身就是枚举缺口。
  **枚举口径**：按 `call-resolver.ts` 源码判据面**独立枚举**（禁从断言反推，承接裁决 P3-2 / §13-M5），
  7 组共 **32** 个（L 语言分流 4 / K kind 收窄 3 / E extends 截取 4 / I 深度计数与词边界 11 / S 泛型剥离 3 /
  F 父类列表清洗 4 / M MRO 消费 3）；plan §15 点名必须覆盖的五条逐条对位。
  **结果：32 变异体 / 31 杀死 + 1 `TYPE_KILLED` / 零存活**，**零「非等价 + 无杀手」**
  （`F04-no-superlist-guard` 被 `tsc` 拒绝——编译器就是杀手；因无幸存体，裁决 P4b-4 的「结构论证 + 判别性
  样本双证」本轮不适用）。
  **本轮补的 9 条杀手用例 R23–R31**：前一轮 9 个幸存体全部是**判别性样本缺失而非等价**——9 条里没有一条
  靠「再跑一遍」翻案，全部靠**构造判别性输入**翻案（如 R25 需类名自身含 `extends` 子串、R26 需括号不平衡、
  R27 需父类名同时含 `<` 与 `[`）。方法论承接裁决 P4b-4「真空绿」：变异测试查**用例**的守护力，
  幸存体的等价判定要查**样本**的判别力。
  跑法与冻结：跑批器 `p5b/mutation-run.mjs`（sha256 `1213bd0c…9b1273`）、清单 `p5b/p5-mutants.mjs`
  （sha256 `85eaf1be…c67d25`），每体锚点命中必须**恰好 1** → `npm run build`（不过判 `TYPE_KILLED`）→
  跑测 → 逐字还原；收尾 `call-resolver.ts` sha256 跑前跑后一致（`03809b1f…6894d`）。
  归因：`verification/p5-attribution.md` §1.1–§1.6。

- [x] T064 [P5b] 依赖：T063 — **P5 归因执行**（本轮完成，产出 T037 / T038 的验收制品）。
  三锚点：**P4b**（前一轮收尾态）/ **P5**（当前树）/ **P5off**（`isTsJs` 恒 `false`，= 变异体 `L04`，
  等价于「P5 特性关闭」）。工具冻结：`edge-diff.mjs` / `coverage-metric.mjs` / `dump-skeletons.mjs` /
  `callsites-fingerprint.mjs` 本轮**一行未改**，两侧同一份；唯一改过的 `h1-phantom-key-stats.mjs`
  **不参与任何 diff** 但**会被采集进图**，其影响（+1 module 节点 / 0 条边）在 §3.3 显式扣除。
  环境硬约束：每次建图前 `npm run build`（退出码 0）+ 核对 `spectra v4.4.0 (0d3e385)` 确认跑的是本 worktree
  产物；`--output-dir` 一律指向 scratchpad，**未覆写** `specs/_meta/graph.json`；P5off 的临时替换跑前存副本、
  跑后还原，sha256 一致。
  产出与结论详见 T037 / T038 的状态核实（含 §16-2「特性图足迹 = 0」的成因二分与 **R-17** 登记）；
  callSites 摘要口径下**新增 1 文件 + 4 文件摘要变化，其余 1146 个文件逐字未变**，改动面与摘要变化面逐一对应；
  §7.1 硬断言 1（`impact(upstream)` 仍含 `batch-orchestrator` 与 `graph-assembly`，affected = 30）
  与 P4 记录**逐字一致**。归因：`verification/p5-attribution.md` §3.1–§3.6。

> **未完成 / 待裁决**（不粉饰，详见 `p5-attribution.md` §6）：
> ① 2 条 `depends-on` unclassified + 1 条断言 2 违规 —— 沿用裁决 P4b-1 / P2-2 人工通道放行，**工具不改**（§16-1）；
> ② **P5 特性在本仓 0 自然实例**，真实语料守护力目前只由用例承担（**R-17**，§16-2）；
> ③ R-16（解构默认值 `assignment_pattern` 同族 recall）按裁决**不修**，保持登记；
> ④ **Codex 对抗审查缺席（配额耗尽）**，含判定器类改动，已显式标注档位缺席；
> ⑤ 全量门禁与收尾汇总（T039–T043）留待 4c verify 阶段收口。
>
> **4d 文本收口（plan §17-2 / §17-3 / §17-4 / §17-6，无新任务号）**：`typescript-receiver-env.ts` 的
> `property_identifier` 冗余守卫注释改写（保留代码）、`edge-diff.mjs` / `callsites-fingerprint.mjs` 的 `SEP`
> 由裸 NUL 字节改 `'\x00'` 转义（运行时逐字等价）、`receiver-type-resolution.ts` 的「P5 之前无 MRO 回退」
> 陈旧注释订正为「MRO 回退未接入本分支，有意收窄，**R-18** 登记」、本文件勾选状态与本段补记。

---

## Implementation Strategy

### 顺序交付（本 feature 为 fix 模式，非增量用户价值交付，四阶段严格按归因锚点顺序推进）

1. 完成 P0：基线与工具就绪。
2. 完成 P2：H1 假边面收口 → **STOP AND VALIDATE**（T015 逐边 diff 只减不增）。
3. 完成 P3：mapper 接收者环境 → **STOP AND VALIDATE**（T023 callSites 指纹零差，B1 主锚点）。
4. 完成 P4：resolver 新分支上线，两条真实调用者边恢复 → **STOP AND VALIDATE**（T032 硬断言1 + T033 逐边 diff 只增不减 + T034 抽样核对）。
5. 完成 P5：TS extends MRO 独立收尾 → **STOP AND VALIDATE**（T037 逐边 diff + T038 全量核对；不达标可单独回退不影响 P2–P4）。
6. 收尾：全量门禁 + 验收汇总（T039–T043）。

**任一阶段验证不通过，不得继续下一阶段**（P4 尤其不可跳过前置复核 T024–T026 直接开工）。

---

## Notes

- `[P]` = 不同文件、无依赖，可并行执行。
- 每个 M/R 用例编号直接引用 `plan.md` §D5，不重新编号。
- 所有实现任务的判据（A1–A8、B1–B8）原样承接 `plan.md`，任务描述中的复述仅为执行时便于对照，不构成新的设计决策。
- 验证脚本与产物统一落 `specs/260-fix-instance-method-call-edges/verification/`。
- 提交前仍需遵循仓库级约定：`npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 零失败（已在 T039 覆盖，实现阶段每个 commit 前建议增量跑对应测试文件）。
