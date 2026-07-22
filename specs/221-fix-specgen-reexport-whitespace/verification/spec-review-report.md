# Spec 合规审查报告 — F221

**审查对象**：`git diff HEAD`（10 tracked 文件）+ untracked `tests/unit/spec-renderer.test.ts`
**审查依据**：`fix-report.md`（根因）、`plan.md`（C1-C7 变更清单 + 3 项裁决）、`tasks.md`（T1-T6）
**审查方式**：逐文件 diff 比对 plan 变更清单字段级要求；`npm run build` 全量类型检查；对本次改动涉及的 5 个测试文件跑 `npx vitest run`（78/78 通过）；关键 claim（tree-sitter 路径行为、isDefault 消费面）做源码交叉验证

---

## 一、逐项结论表

| # | 审查项 | 结论 | 依据 |
|---|--------|------|------|
| 1 | 修复是否与 fix-report 根因一致（提取端语法级 re-export + 序列化端归一化，无偏航） | **PASS** | `ast-analyzer.ts` 新增 `extractReExports`/`buildReExportSignature` 语法级提取 `getExportDeclarations()`，未引入跨文件解析；`spec-renderer.ts` 新增 `stripTrailingWhitespace` 在 3 个渲染出口 return 前套用。两点均精确对应 fix-report 缺陷一/缺陷二的 Root Cause 陈述 |
| 2 | 是否引入 fix-report/plan 未覆盖的行为变化或未定义的公共 API 面 | **PASS**（1 处边界未覆盖，见问题 W2） | `ExportKindSchema` 加 `'re-export'`、`ExportSymbolSchema` 加 `reExportFrom`/`isTypeOnly` 均为 plan C1 明确授权；新增函数 `extractReExports`/`buildReExportSignature`/`stripTrailingWhitespace` 均为模块内 `function`（未 export），不构成新公共 API 面。`isDefault` 字段对 re-export 条目的取值 plan 未显式规定，实现硬编码 `false`（细节见 W2，影响面极小，非"未覆盖的行为变化"级别） |
| 3 | 改动是否越过 plan 硬边界（F148 截断常量 / getProject() 性能配置 / specs/src.spec.md 误改） | **PASS** | grep 确认 `EXPORTS_PER_FILE_LIMIT = 12`（single-spec-orchestrator.ts:56）与 `skipFileDependencyResolution: true` / `noResolve: true`（ast-analyzer.ts:72/76）字面值未变；`git status`/`git diff` 确认 `specs/src.spec.md` 不在改动清单（未 modified、未 staged），仅 `specs/221-.../` 制品目录为 untracked 新增 |
| 4 | plan C7 用例①-⑫是否全部落地 | **PASS** | 逐条比对：①-⑦ 落在 `tests/unit/ast-analyzer.test.ts`（新增 `describe('re-export 提取（F221）')`）；⑧⑨落在新建 `tests/unit/spec-renderer.test.ts`；⑩落在 `tests/unit/knowledge-graph-derive-nodes-metadata.test.ts`（2 个 it，分别覆盖 deriveNodesFromSkeletons 与 deriveContainsEdges）；⑪落在 `tests/unit/knowledge-graph/call-resolver.test.ts`；⑫落在 `tests/unit/single-spec-orchestrator.test.ts`。12 项全部可对号；实跑 5 个文件共 78 test 全绿 |
| 5a | 裁决1：tree-sitter parity 限界记录，不纳入本期 | **WARNING** | 功能范围裁决本身被遵守（`typescript-mapper.ts` 无功能性改动，未引入跨路径 parity 修复）；但裁决原文明确要求"限界注释写在 typescript-mapper 的 export_statement 处理段"，`git diff --stat` 显示该文件**零改动**，承诺的限界注释未落地。详见问题 W1 |
| 5b | 裁决2：不加独立"Re-export 导出面"渲染小节 | **PASS** | `src/core/single-spec-orchestrator.ts` 源码 diff 为空（`git diff HEAD --stat` 无输出），仅新增用例⑫验证既有统一表格的"类型"列渲染 `re-export`、"签名"列携带来源 specifier——与裁决"零渲染代码达成分层标注"字面一致 |
| 5c | 裁决3：验证再生路径用 AST-only 降级零 LLM | **PASS（结构性核实，非运行时证据）** | `single-spec-orchestrator.ts` 的 `LLMUnavailableError` → `generateAstOnlyContent` 降级路径未被本次改动触碰，裁决所依赖的降级机制结构完整；本次 diff 未破坏该路径的可用性。运行时实证（AST-only 环境实跑再生 + `git diff --check`）属 tasks.md T6/Phase 4 验证阶段职责，不在本 spec-review 静态比对范围内 |
| 6 | 是否需要同步更新既有 spec（fix-report 判定"无需"，验证该判定仍成立） | **PASS** | 全仓无 feature spec 记载 `extractExports`/`renderSpec` 的导出面或序列化行为合同（F220 refactor-plan 只约定 facade 契约本身，不涉生成器内部实现）；判定依据未变，仍成立 |

---

## 二、总体结论

**WARNING**（0 CRITICAL / 2 WARNING）

核心修复路径（提取端语法级 re-export、序列化端行尾归一化、图派生与 call-resolver 双点过滤、模型层前向兼容扩展）与 fix-report 根因、plan C1-C7 变更清单、tasks T1-T6 逐字对应，未发现越权行为面或硬边界侵犯。`npm run build` 零错误，本次改动涉及的 5 个测试文件 78/78 通过。2 项 WARNING 均为低影响面的文档/边界覆盖缺口，不影响核心缺陷修复的正确性，可自主决定"本次一并补" or "记录 follow-up"，均不构成阻断交付的理由。

---

## 三、发现的问题清单

### W1 — 裁决1 要求的 tree-sitter 限界注释未落地，且现状描述与 fix-report 措辞有出入

- **位置**：`src/core/query-mappers/typescript-mapper.ts`（`_extractExportClause`，L602-634，本次 diff 未触及此文件）
- **裁决原文**（plan.md §2 第1条）："限界注释写在 typescript-mapper 的 export_statement 处理段。" — 承诺在代码里落一处注释；`git diff HEAD --stat -- src/core/query-mappers/typescript-mapper.ts` 输出为空，说明该承诺未在本次 commit 范围内兑现。
- **附带事实核实**：fix-report "同源问题" 表描述 tree-sitter 路径为 "`export {} from` 无声明子节点同样丢失"（暗示符号丢失）。实读源码发现该路径**并未丢失**符号——`_extractExportClause` 早已存在（非本次新增）且被 `export_statement` switch 分支实际调用，会产出 `kind: 'variable'`、signature 含 `from '...'` 子句的条目，只是未采用新 schema 的 `kind: 're-export'`/`reExportFrom`/`isTypeOnly` 分类。这意味着：走 tree-sitter 降级路径（ts-morph parse 失败时触发）的文件，其 re-export 符号会以 `kind: 'variable'` 形态进入 `exports` 数组，**不会**被本次新增的 C3/C4 过滤（`if (exp.kind === 're-export') continue` 只匹配 `'re-export'`，不匹配 `'variable'`），因此该路径下的图拓扑污染风险（重复别名节点/contains 边、call-resolver 二义）在本次修复前后均未改变——这是修复前就存在的既有状态，本次未使其恶化，但也未如裁决声称的那样在代码里留下书面记录，后来者无法从 typescript-mapper.ts 本身获知这一 parity gap。
- **严重度依据**：功能范围裁决（不修）已被遵守，不构成回归；缺口纯属"承诺的文档化步骤未执行"+"诊断文档措辞对现状描述不够精确"，判 WARNING 而非 CRITICAL。
- **建议处置**：commit 前补一行注释到 `_extractExportClause`（如："已知限界（F221）：tree-sitter 降级路径产出 kind='variable' 而非 're-export'，不会被下游图派生过滤，parity 修复见 fix-report 裁决1"），或在 plan.md/fix-report.md 追加勘误说明留痕即可，二选一，均为轻量级动作。

### W2 — `export { X as default } from './y.js'` 边界：isDefault 硬编码为 false，未测试覆盖

- **位置**：`src/core/ast-analyzer.ts` `extractReExports`（L159-169，`isDefault: false` 字面量）
- **现象**：plan.md C2 逐字列出 re-export 条目应产出的字段（name/kind/reExportFrom/isTypeOnly/signature/startLine/endLine/无 members），**未提及 `isDefault` 应如何取值**——这是 plan 本身的字段遗漏，非实现对 plan 的偏离。实现选择硬编码 `false`，对于 `export { X as default } from './y.js'` 这种把目标符号重导出为**本模块默认导出**的形态，`name` 会取到 `'default'`（alias 优先），但 `isDefault` 仍固定为 `false`，与本文件内其他本地声明路径的口径（`extractSymbol` 内 `isDefault = name === 'default'`）不一致。
- **影响面核实**：全仓搜索 `.isDefault` 仅 1 处消费——`src/cli/commands/prepare.ts:116` 渲染 `(default)` 文本后缀，纯 cosmetic 展示，不进图拓扑、不进 call-resolver、不触碰 F217 门禁。本次修复的驱动 fixture（`src/batch/batch-orchestrator.ts` 11 个 re-export，见 fix-report L108-122）逐行核实均无 `as default` 形态，此边界未在真实触发场景中出现。
- **测试覆盖**：C7 用例②（alias）测的是 `export { a as b } from`，`b` 非 `'default'`，未覆盖该边界；无用例断言 re-export 别名恰为 `default` 时的 `isDefault` 取值。
- **严重度依据**：极窄边界 + 单一 cosmetic 消费点 + 未出现在驱动 fixture，判 WARNING（信息级偏上，非阻断）。
- **建议处置**：可选，非必须。若要补，一行改动即可：`isDefault: name === 'default'`（与本地声明路径口径统一），另补 1 条测试用例。

---

## 四、附带观察（非缺陷，供交付参考）

`extractReExports` 的去重集合并未直接复用 `extractExports` 现有的 `seen`（plan.md C2 字面写"沿用函数内 `seen` 去重集合"），而是新建 `emitted = new Set(exports.map(e => e.name))`，仅基于**已实际产出**的本地声明名去重。代码注释说明了原因：`getExportedDeclarations()` 对 re-export 目标会"有名无可用节点"，导致 `seen.add(name)` 在符号被丢弃前就已写入——若真按 plan 字面复用 `seen`，会把**全部** re-export 名误判为已见过而跳过，等于修复失效。用例②/⑤/⑦（尤其⑦的 14 符号集成断言）已实测验证当前机制正确、复用 `seen` 会失败。这是实现阶段对 plan 机制性细节的必要修正而非偏航，且修正逻辑与理由均已写入代码注释，判定不计入缺陷清单。
