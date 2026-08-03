# Spec 合规审查报告 — F254 图消费决策白名单扩面 + 图自述面优先消费

> 审查主体：spec-review 子代理（Phase 4a，sonnet）；本文件由编排器代为落盘（该子代理工具集无 Write），内容为其交付文本原样转录。
> 审查方式：只读代码走查（Read + Grep 逐文件比对 plan.md / fix-report.md / tasks.md 与工作树现状）；未执行测试命令（子代理无 Bash 权限），工具链验证由 Phase 4c 承担。

## 1. 修复-根因一致性（5-Why 链闭合检查）

| Why 层级 | 检查点 | 结论 |
|---|---|---|
| Why1 (.mjs 判 out-of-scope) | `GRAPH_SCOPE_EXTENSIONS` 已扩到 12 项，`.mjs`/`.cjs`/`.mts`/`.cts`/`.pyi`/`.java`/`.go` 全部纳入 | **已闭合** |
| Why2 (F241 时代快照失真) | 常量语义已从"权威白名单"降格为"静态 fallback"，注释重写 | **已闭合** |
| Why3 (跨语言巡检不同构) | 新增 `tests/unit/graph-scope-extensions-contract.test.ts` 动态 import `.mjs` 逐项断言 SSoT 一致 | **已闭合** |
| Why4 (无跨侧一致性合同) | 上述合同测试即是新增的跨侧锚点；C-002（同一份面）在 decision.mjs 与 cli.mjs 间仍保持——两者共用同一个计算出的 `scopeExtensions` 变量 | **已闭合** |
| Why5 (快照断言锁快照不锁一致性) | 快照断言仍在，但新增合同测试把"一致性"钉在 SSoT 而非自身快照上；且图自述面优先消费机制（`deriveScopeExtensionsFromFingerprint`）从架构上把"面漂移"变成自动跟随，fallback 快照只是二道防线 | **已闭合** |

结论：五层根因链均有对应代码/测试落地，未见"只修表层"情况。

## 2. 未覆盖行为变化排查（CRITICAL 检查项，逐条核对）

- **决策矩阵 13 行顺序/出口**：`decideGraphConsumption` 函数体逐字未改动，仅 `coverageScope` 这一维输入值的计算方式变化——**未偏离**。
- **EC-07（刷新后绝不重跑矩阵）**：`finalizeAfterRefresh` 只读 `changeClass`/`graphAvailability`，本次改动未触及——**未偏离**。
- **FR-010 快照校验**（`snapshotMatches`）：`runAnnotateCaveat` 中判定逻辑逐字保留，覆盖面重推导是并列的独立逻辑——**未偏离**。
- **coverageScope "全部之外才 out-of-scope / 空清单=in-graph-scope" 语义**：`collectCoverageScope` 的 `anyInScope`/空数组早退逻辑本体未改，只是判据数组从常量变参数——**未偏离**。
- **`readEmbeddedSourceCommit` 的 `{ok, reason, value}` 三态合同**：薄壳化后逐字保留（`file-missing`/`graph-too-large`/`parse-error`），且新增测试专项验证三态一致性与薄壳投影等价——**未偏离**。
- **decision 模块零 import 纯函数硬合同**：通篇仍无任何 `import` 语句，`annotateImpactCaveat` 新增第 4 参是调用方传入的数据而非模块自发 I/O——**未偏离**。

未发现 fix-report/plan 未覆盖的行为变化。

## 3. C-002 单一白名单原则

`runDecide` 计算出 `scopeExtensions`（`derivedScopeExtensions ?? GRAPH_SCOPE_EXTENSIONS`）后，同一次调用内先后传给 `collectCoverageScope(files, scopeExtensions)` 与 `annotateImpactCaveat(..., scopeExtensions)`（`runAnnotateCaveat` 中对应 `scopeExtensionsAtAnnotation`）。两处判据消费同一个已算好的变量，未发现第二份白名单再生。**PASS**。

## 4. 影响范围扫描同源清单落地核实

fix-report 列出的 5 处同源点全部确认已改；plan.md 追加的 `graph-bootstrap-status.mjs`（`readEmbeddedGraphMeta` 新增 + `readEmbeddedSourceCommit` 薄壳化）与对应 `tests/unit/graph-bootstrap-status.test.ts` 用例已落地。

多语言第二层（`.py`/`.pyi`/`.java`/`.go`）：`ALL_PRODUCER_SURFACES` 六管线并集与 `GRAPH_SCOPE_EXTENSIONS` 12 项逐一核对完全一致（去重后并集恰为 12 项），已由跨语言合同测试锁定。`FINGERPRINT_SURFACE_KEYS` 五 key（`genericAdapters` 合并 java+go）与 `src/panoramic/graph/collector-fingerprint.ts` 的 `extensionSurface` 结构对齐核实一致。**PASS，无遗漏**。

## 5. 已知在途项处置

`DEGRADED_REASON_HINTS[COVERAGE_GAP_OUT_OF_GRAPH_SCOPE]` 当前文案已是新口径（提及 `fingerprint.extensionSurface` + 静态 fallback），按编排器指示"已裁决修订中"对待，不作为发现项计入。（编排器补注：该修订已于本报告落盘前完成并全量重验绿。）

## 分级发现

- **CRITICAL**: 0 个
- **WARNING**: 0 个
- **INFO**: 1 个 — 测试执行验证局限：本次审查基于静态代码走查确认实现与 plan.md 逐条对齐，但未实际运行四条门禁命令（子代理无 Bash 权限）。tasks.md T5 要求四条命令零失败后再 commit——commit 前由 Phase 4c 完整执行作为最终确认（这不是代码缺陷，是审查方式的边界）。

## 总体结论：**PASS**

实现与 fix-report.md 的 5-Why 根因追溯、plan.md 方案 A 的函数级改动清单逐条对齐，未发现超出 plan 范围的行为变化；决策矩阵不变量、EC-07、FR-010、C-002 均保持；跨语言合同测试已把"第七处镜像"钉死在 SSoT（`src/collector-surface.ts::ALL_PRODUCER_SURFACES`）上，闭合 Why4/Why5 的结构性盲区。
