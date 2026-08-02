# 问题修复报告

## 问题描述

TS/JS 调用边抽取存在两类语法形态的覆盖缺口，均在 fresh 图（`2e3a4cd`，6092 节点 / 8062 边，graph-quality verdict=pass）上实测确认：

1. **形态 1 — 实参位置 arrow function 函数体内的调用**：`src/kb-mcp/tools/kb-search.ts:147` 的 `withTelemetry('kb_search', async (args) => executeKbSearch(ctx, args))` — 图里有 `registerKbSearchTool → withTelemetry`，但没有 `registerKbSearchTool → executeKbSearch`；`executeKbSearch` 零 calls 入边。
2. **形态 2 — 动态 `await import()` 解构后的调用**：`src/cli/index.ts:222-223` 的 `const { runScaffoldKb } = await import('./commands/scaffold-kb.js'); await runScaffoldKb(command)` — `impact(runScaffoldKb)` 返回 `directCallers: 0`。

两者失败模式相同且属**误导型**：`impact` / `context` 自信返回「0 caller / riskTier: low」，使用者不会意识到结果是错的。

来源：F241 grounding pilot 取证 O-3 / O-7（`specs/241-graph-keepalive-kb-grounding/pilot/baseline-observations.md`），F241 判定 out-of-scope 只登记不修，本 F242 为正式修复。

## 诊断证据（本轮实测，编排器亲自执行）

### 全量核实：CLI 入口 0-caller 推断成立，但主导根因与预想不同

- **19/19 个 CLI 命令入口函数（`runGenerate`…`runScaffoldKb`）在当前图中 calls 入边全部为 0**；`src/cli/index.ts` 作为源的 calls 出边为 0。
- **修正任务假设**：`src/cli/index.ts` 的 19 个命令里 **18 个是静态 import**（顶部 `import { runGenerate } from ...`），只有 `scaffold-kb` 是 lazy import（F201 冷启动修复引入）。静态 import 的 18 个命令边也全部丢失——因为所有调用都发生在**未导出的 `main()`** 内，边的 source `src/cli/index.ts::main` 不是图节点，被悬空边过滤丢弃。**动态 import 只是叠加在其上的 target 侧缺口**。

### 丢失结构量化（诊断脚本跑真实仓库，buildUnifiedGraph 输出 = 悬空过滤前）

| 分类 | 数量 | 说明 |
|------|------|------|
| 存活（source/target 都是节点） | **1,044** | 仅占 2.3% |
| dropSrcAnon（target 有效，source 为 `<arrow:/<fn:/<gen:`） | **3,993** | 形态 1 所属；可救回 |
| dropSrcModule（target 有效，source 为 `<module>`） | 58 | 模块顶层调用；可救回 |
| dropSrcNamedLocal（target 有效，source 为命名但未导出符号） | 466 | `main` 所属；可救回 |
| dropTargetUnresolved（source 有效，target `?::`） | 2,045 | 多为未 import 的外部名（builtin/第三方），**应保持丢弃**；其中动态 import 绑定缺失的少量可救回 |
| dropTargetMissing（source 有效，target 已解析但非节点） | 33 | facade re-export / const 成员调用，**独立已知家族，不在本次范围** |
| dropBoth | 37,706 | 双侧无效（绝大多数 target 为 `?::` 外部名，source 侧修复后仍因 target 外部保持丢弃） |
| 过滤前总量 | 45,345 | |

### 验收两案例的 pre-filter 形态（精确证实）

- 形态 1：`src/kb-mcp/tools/kb-search.ts::<arrow:147:31> → src/kb-mcp/tools/kb-search.ts::executeKbSearch` — **调用点已被抽到、target 已正确解析（Stage 1 high）**，仅因 source 匿名上下文非节点被丢。
- 形态 2：`src/cli/index.ts::main → ?::runScaffoldKb` — **双重叠加**：source `main` 非导出符号不是节点；target 因 importIndex 无动态 import 绑定解析失败产 `?::` 占位。

### 机制链（代码级定位）

1. `typescript-mapper.ts:952 _walkCallSites` 遍历**本身没有盲区**（C-4 修复已让匿名 arrow/function 入栈 `<arrow:line:col>` 上下文）——与 F219「forEachChild 不枚举 token」的遍历缺口**不同构**：本问题抽取成功、丢在归属与解析。
2. `call-resolver.ts:412 mkEdge` 把 `source = callerFile::callerContext` 当作节点地址直接拼接，**未验证 callerContext 是否可寻址**（匿名 `<arrow:...>`、未导出 `main`、`<module>` 都不是节点）。
3. `ast-analyzer.ts:509-546 extractImports` 动态 import()/require() 分支（F156 W1.0）只记 `moduleSpecifier/resolvedPath/importType`，**不抓绑定名**（namedImports/defaultImport 均缺）→ `buildImportIndex` 无 alias → Stage 3 解析失败。
4. `graph-builder.ts:443-453 悬空边过滤`：source/target 不在节点集合 → **静默** `continue`（注释：悬空边静默跳过），零计数、零日志。
5. 节点域（`deriveNodesFromSkeletons`）：module（每文件）+ symbol（**仅导出**）+ member——未导出函数永远不是节点，故 source 侧问题无法靠「多建节点」小修（那会改变全图节点语义，属大改）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 两形态的 calls 边为何缺失？ | 边在 `graph-builder.ts:448` 悬空边过滤被丢：形态 1 source=`file::<arrow:147:31>` 非节点；形态 2 source=`file::main` 非节点且 target=`?::runScaffoldKb` 未解析 |
| Why 2 | source 为何不可寻址？ | `mkEdge` 直接拼 `callerFile::callerContext`，而 C-4 修复（F152）故意让匿名 scope 产 `<arrow:line:col>` 上下文（最近 scope 原则，防 `this` 语义误归属）；未导出函数（`main`）与 `<module>` 顶层同样不可寻址 |
| Why 3 | target（形态 2）为何解析失败？ | `extractImports` 动态 import 分支不抓绑定名 → importIndex 无 `runScaffoldKb` alias → Stage 3 miss → fallthrough 产 `?::` 占位 |
| Why 4 | 设计假设为何不成立？ | `CallSite.callerContext` 的设计用途是 **member resolution**（extractClassName 定位类），F151 把它复用为**边的 source 地址**时隐含假设「上下文名 = 可寻址节点名」；该假设对匿名 callback、未导出函数、模块顶层三类都不成立。动态 import 绑定则是 F156 只做到 depends-on 模块边所需的最小抽取，call 解析所需的绑定层从未补齐 |
| Why 5 | 为何未被现有机制捕获？ | 悬空边过滤**静默丢弃**（无计数/无日志/无质量门指标）；F152 单测只验 mapper 抽取与 resolver 单元行为，无「匿名 callback 调用存活到最终图」的端到端断言；F217 六指标监控 orphan/dangling 但 dangling 恰好因过滤为 0（过滤掩盖了丢失），orphan 只报「有孤儿」不报「为什么孤」 |

**Root Cause**（双支）：
- **R1（source 侧，主导）**：call-resolver 把 callerContext 无验证地当节点地址；匿名/未导出/模块顶层三类上下文产生的边 100% 被悬空过滤静默丢弃（4,517 条 target 有效的边）。
- **R2（target 侧）**：extractImports 动态 import()/require() 不抽取绑定名，动态引入的被调符号无法 cross-module 解析。

**Root Cause Chain**：`impact 误导性 0-caller` → 悬空边过滤静默丢弃 → source 不可寻址（R1）/ target 未解析（R2）→ callerContext 复用为边地址的隐含假设 + 动态 import 绑定抽取缺失 → 无丢弃计数与端到端存活断言，长期不可见

## 影响范围扫描

### 同源问题（与根因共享机制，本次统一修复）

| 位置 | 模式 | 数量 | 修复动作 |
|------|------|------|----------|
| 全仓匿名 callback 内调用（`server.tool(...)` 注册、`withTelemetry` 包装、`.map/.filter` 回调、测试文件 `it/describe` arrow） | source=`<arrow:/<fn:/<gen:` | 3,993 条边 | R1：resolver 归属回退链（命名祖先 → 模块节点） |
| 未导出函数内调用（`main` 等） | source=命名未导出 | 466 条边 | R1：模块节点回退 |
| 模块顶层调用（`createLogger` 等模块级初始化） | source=`<module>` | 58 条边 | R1：模块节点回退 |
| 仓内 `await import()` 使用点 | 动态 import 绑定 | 23 处（15 文件，不含 cli/index.ts 与测试） | R2：绑定名抽取（解构/命名空间/`.then` 回调） |

### 类似模式（评估结果）

| 位置 | 模式 | 评估 |
|------|------|------|
| `dropTargetMissing` 33 条（如 `runBatch → src/spec-store/index.ts::SpecStore`） | facade re-export 穿透 | **[安全-已知]** F217 决策有意为之（`buildModuleSymbolIndex` 注释：防 dangling），re-export 追链是独立 feature，不动 |
| `BatchStateSchema.parse` 类 const 成员调用 | member-of-const | **[安全-已知]** member 节点仅 class 有，独立家族，不动 |
| 静态 `import * as ns` 后 `ns.fn()` | 命名空间绑定同样未记录 | **[类似-待 plan 决策]** 与 R2 同一代码路径（extractImports），修法同构（记 alias）；是否并入由 plan 定 |
| Python / Java / Go mapper 的 callerContext | 同一 resolver 共享 | **[受益]** R1 在 resolver 层语言无关，Python `<module>`/局部函数边同样被救回；**micrograd pinned e2e fixture（tests/fixtures/micrograd-baseline-graph）大概率需按 F215 流程重生成 + 翻断言** |

### 同步更新清单

- 测试：red fixture 覆盖任务指定 7 形态（arrow body / function expression body / 嵌套两层 / IIFE / 顶层 await import 解构 / 函数内 await import 解构 / `import().then(m => m.fn())`）+ resolver 回退链单测 + 端到端「边存活到最终图」断言
- 受影响既有测试：`typescript-mapper-callsite.test.ts`（C-4 断言**必须保持绿**——修法不改 mapper 现有输出）、call-resolver 单测、graph 集成/快照类测试、micrograd pinned fixture
- 文档：spec 影响见下节
- 观测性（Why-5 收口）：悬空过滤补丢弃计数日志（graph-builder），供未来 F217 扩展指标

## 修复策略

### 方案 A（推荐）：CallSite 增量字段 + resolver 归属回退链 + 动态 import 绑定抽取

1. **`src/models/call-site.ts`**：`CallSiteSchema` 增可选字段 `enclosingNamedContext?: string`（最近命名祖先作用域；与 callerContext 相同时省略）。纯增量，不动既有 6 字段（C-8 冻结语义按「不塞 metadata 杂项」理解，正式字段演进走本 spec 落账）。
2. **`typescript-mapper.ts`**：`_walkCallSites` 维护栈不变、**mapper 所有既有输出不变**（C-4 断言零翻动）；仅在产出 callSite 时从栈顶向下找第一个非 `<arrow:/<fn:/<gen:` 帧填 `enclosingNamedContext`。
3. **`call-resolver.ts`**：mkEdge source 归属回退链（用已有 moduleSymbolIndex/classMemberIndex 验证可寻址性）：
   `callerContext 可寻址（导出符号或 Class.member）→ file::callerContext`；否则 `enclosingNamedContext 可寻址 → file::enclosingNamedContext`；否则 **`file`（模块节点兜底）**。语言无关，Python/Java/Go 无需改 mapper 即受益（无新字段时直接走模块兜底）。
4. **`ast-analyzer.ts` extractImports**：动态 import()/require() 分支补绑定抽取：
   - `const { a, b } = await import('x')` → namedImports（rename `{a: c}` 记 property 名，与静态 import getName() 口径一致）
   - `const m = await import('x')` → 命名空间绑定记入 alias（复用 defaultImport 字段承载或按 plan 定字段），使 `m.fn()` 走 Stage 3 qualifier 解析
   - `import('x').then(m => ...)` / `.then(({ fn }) => ...)` → 回调形参绑定
5. **观测性**：graph-builder 悬空过滤从静默 continue 改为计数 + 单行 warn 日志（不新增 schema 字段，避免快照面扩散；是否入 graph metadata 由 plan 定）。

**预期效应（已量化）**：TS/JS calls 边 1,044 → 约 5,500+（+4,517 rescue），全图边 8,062 → 约 12,500+。验收边形态：
- `src/kb-mcp/tools/kb-search.ts::registerKbSearchTool → …::executeKbSearch`（经命名祖先，符号级精确）
- `src/cli/index.ts → src/cli/commands/scaffold-kb.ts::runScaffoldKb`（经模块兜底 + 绑定抽取；任务验收写法 `src/cli/index.ts::*` 兼容模块级源）

### 方案 B（备选，不推荐）：graph-builder 过滤层就地改写 source 为模块节点

单点改动、无 schema 变化，但**丢失命名祖先精度**——形态 1 会产 `模块 → executeKbSearch` 而非 `registerKbSearchTool → executeKbSearch`，不满足任务验收对该边的明确预期；且把归属决策放在过滤层违背分层（resolver 才有符号索引）。仅当方案 A 的 schema 演进遇阻时降级采用其模块兜底部分。

## 风险与回归面（供 plan 展开）

- **图拓扑显著变化**：calls 边 ~5.3×，god-node degree 上升（`createLogger`、错误类等高频 callee）；F217 六指标需修后实测——orphan ratio 预期改善，dangling 应保持 0（只救到已存在节点），duplicate 由 edgeKey 去重保障。
- **测试面**：micrograd pinned fixture（Python 边同样被救）按 F215 流程重生成；graph 相关快照/计数断言逐个核对语义后更新（禁 `vitest -u` 盲刷）。
- **消费方**：impact/context BFS 扇出增大（结果更真实但更大）；测试文件模块 → 生产符号的边会出现在 caller 列表（事实如此，属预期）。
- **性能**：抽取路径不变；resolver 每边 O(1) 索引查询，重建时长预期仍 ~4.4s 量级。
- **范围过大检测**：受影响源码文件 4 个（models/call-site.ts、core/query-mappers/typescript-mapper.ts、knowledge-graph/call-resolver.ts、core/ast-analyzer.ts）+ graph-builder 观测性 1 处 + 测试若干，3 个源码模块——未超「>10 文件或 >3 模块」阈值，继续 fix 模式。

## Spec 影响

- 需要更新的 spec：`specs/152-ts-callsites-import-resolver/spec.md` 不回改（历史事实）；本次行为变化以 F242 本目录制品为准落账（fix 模式无独立 spec.md，以 fix-report + plan 记录 CallSite schema 演进与 resolver 归属语义）。
- `specs/products/spectra/current-spec.md` 如含 calls 边语义描述，由后续 `spec-driver-sync` 聚合，不在本 fix 内手改。

## Codex 对抗审查落账（实施后补记）

五轮审查 × 四轮修复闭环，终局「复审通过」；完整轮次表、每轮反例与处置、最终登记 follow-up 清单见 `verification/verification-report.md` 附录。要点：

- **审查发现并修复的真实假边面（超出原始两形态）**：动态绑定文件级 last-write-wins（同 alias 异 target 产确定性假边）、歧义/不可信 alias 绕行 Stage 1 本地导出与 Stage 2 类启发式、裸 dynamic 的垃圾 lastSeg alias 覆盖静态绑定、`.then` 非 callee 位置偷绑定。统一收口为 `suppressedDynamicAliases`（「存在 dynamic 绑定但未产生可信 aliasToTarget 条目」即抑制三个 stage 的自信解析）+ extractDynamicImportBinding 括号完备不变量（104 组合 fuzz 验证）。
- **精度优先原则贯穿**：宁丢边不造假边——歧义弃权回到修复前状态；文件级抑制的误伤代价已在代码注释显式登记。
- **终态**：全量 vitest 6101 零失败；图 6095/9431（calls 2287）；两验收边在位；graph-quality 六指标 pass；四轮修复对本仓生产边净影响为零（逐边 A/B 实证，修的均为本仓未触发的假边面）。

## 实测偏差修正（相对本报告预测）

- 「预期 calls 边 926 → ~5,500」实测为 926 → **2,287**：预测值是去重前的边实例数上界，最终图按 `(source,target,relation)` 去重且模块兜底把同文件多个匿名 source 折叠为一条模块边，实例级与 distinct 级不可直接比较。
- 「orphan ratio 预期改善」实测**不变**（133 零度节点）：orphan 判定是任意 relation 的 degree-0，F214 contains 边已让全部 symbol 有入边；本修复真正改善的量是「零 calls 入边的 symbol 占比」4463 → 4261（87.6% → 83.6%），已作为第七指标候选登记。
