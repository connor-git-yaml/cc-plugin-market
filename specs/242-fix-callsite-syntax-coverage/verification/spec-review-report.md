# F242 Spec 合规审查报告（Phase 4a）

> 审查执行体：spec-driver:spec-review 子代理（sonnet）。子代理无 Write 工具，本文件由主编排器按其完整输出代为落盘（内容一字未改）。

**说明**：本次审查为 fix 模式（无独立 spec.md），审查基准为 fix-report.md 的 R1/R2 根因 + plan.md 的 7 项设计决策 + tasks.md 的完成状态。

## 逐条合规检查

| 检查项 | 状态 | 证据 |
|---|---|---|
| **R1 修复**：CallSite 增 `enclosingNamedContext`（省略规则、栈内向下扫描第一个非匿名帧） | 已实现 | `src/models/call-site.ts:63-77`；`src/core/query-mappers/typescript-mapper.ts:44-50`(ANON_CONTEXT_RE)、`:965-991`(_walkCallSites 扫描逻辑)、`:1341-1361`(_mkCallSite 条件赋值)，13 处 `_mkCallSite` 调用点均透传（`grep enclosingCtx` 命中 20+ 处，覆盖 CallExpression/NewExpression/Decorator/TaggedTemplate/MemberCall） |
| **R1 修复**：call-resolver 归属回退链（`isAddressable`/`resolveSourceId`，三级：callerContext→enclosingNamedContext→模块兜底） | 已实现 | `src/knowledge-graph/call-resolver.ts:435-477` 与 plan.md 决策 2（第 148-179 行）字面逐字一致；`mkEdge` 签名改造为 `(source, targetId, tier)`（:485-497），`resolveOne` 顶部单次计算 `source`（:247），8 处 `mkEdge` 调用点均已改参 |
| **R2 修复**：`extractImports` 动态 import 绑定抽取（解构/命名空间/`.then()` 回调两条路径） | 已实现 | `src/core/ast-analyzer.ts:542-626`（`extractDynamicImportBinding` + `bindingNamesOf`），覆盖 `AwaitExpression→VariableDeclaration` 与 `PropertyAccessExpression('then')→CallExpression` 两条路径，与 plan 决策 3c 精确对应 |
| **R2 修复**：静态 `import * as ns` 命名空间绑定并入 | 已实现 | `src/core/ast-analyzer.ts:504-506`，一行追加 `namespaceImport: decl.getNamespaceImport()?.getText() ?? undefined` |
| **R2 修复**：`buildImportIndex` 新增 `namespaceImport` 落表 | 已实现 | `src/knowledge-graph/call-resolver.ts:154-171`；决策取舍与 plan 一致（新增独立字段，不复用 `defaultImport`） |
| **观测性**：graph-builder 悬空过滤计数 + warn 日志（不写 metadata） | 已实现 | `src/panoramic/graph/graph-builder.ts:447-462`，仅总数计数，未扩 schema/快照面，符合 plan 决策 4 |
| **`require()` 不动** | 已遵从 | `ast-analyzer.ts` 动态绑定抽取仅在 `kind === 'dynamic'` 时调用（:544），`commonjs-require` 分支未触及 |
| **C-4 断言零翻动** | 已遵从 | `tests/unit/typescript-mapper-callsite.test.ts` 用例 1-20/22-25（原有 C-4 相关用例 6/7/8）未见改动，新增内容全部在文件末尾独立 `describe('...F242 enclosingNamedContext')` 区块（第 495 行起） |
| **偏差 1（如实登记）**：`function_expression` 从不入栈，`<fn:` 前缀实测永不出现 | 已如实记录，未违背 plan 精神 | `tests/unit/typescript-mapper-callsite.test.ts:503-509` 有专门"实测现状核实"说明，F242-2/F242-3b-ii 两个用例断言按实测调整而非 plan 预期，且明确标注"本次不改 mapper 既有行为（超出 fix 范围）" |
| **偏差 2（如实登记）**：`buildImportIndex` 第三分支加 `&& !imp.namespaceImport` 收紧 | 已实现且注释到位 | `call-resolver.ts:161-171` 注释解释理由（namespaceImport 存在即说明"无绑定可用"前提不成立，避免 lastSeg 猜测别名产生垃圾 alias），属该分支原逻辑的自然收紧，未偏离 R2 精神 |
| **Spec 同步**：不回改 `specs/152-.../spec.md`；`specs/products/spectra/current-spec.md` 未含冲突表述 | 已核实无遗漏 | 对 `current-spec.md` 全文 grep `callerContext`/`enclosingNamedContext`/`calls 边`/`call-resolver` 均零命中，未发现应同步但被遗漏的其他 spec 文件 |

## 是否引入未落账的公共 API / 行为面

- `isAddressable` / `resolveSourceId`：均导出，plan.md 决策 2 明确"新增导出纯函数以便单测"（变更清单第 4 条），**已落账**，非意外暴露。
- `CallSite.enclosingNamedContext`：schema 增量字段，plan 决策 1 落账，JSDoc 完整（`call-site.ts:62-77`）。
- `ImportReference.namespaceImport`：schema 增量字段，plan 决策 3 落账，JSDoc 完整（`code-skeleton.ts:144-158`）。
- 未发现任何 CLI 参数 / MCP tool 契约变化，符合 plan Non-Goals 声明。

## 任务完成状态核对（tasks.md）

- T001-T016 全部勾选完成。
- **T017（Codex 对抗审查）未勾选**（审查时点仍为 `[ ]`）。按 CLAUDE.local.md 约定，commit 前必须完成 Codex adversarial review；这不是 FR 层面的功能缺陷，但属于本 fix 流程收尾的强制步骤缺口，建议编排器在最终 commit 前确认已补齐，否则视为流程性 WARNING。

## 问题分级汇总

- **CRITICAL**：0 个（R1/R2 均已实现，无 FR 未实现）
- **WARNING**：1 个（T017 Codex 对抗审查任务未勾选完成——流程收尾缺口，非代码缺陷）
- **INFO**：0 个（未发现 spec 未定义的过度实现；两处已登记偏差均为如实记录、有充分理由、未违背 plan 设计精神）

## 总体结论

**PASS（附 1 项流程性 WARNING）**。git diff 的实际改动与 fix-report R1/R2 根因、plan.md 7 项已锁定设计决策逐项对应，未见未覆盖的行为变化混入；两处实测偏差均已在测试文件/源码注释中如实记录并附合理理由，不构成对 plan 精神的违背；新增导出 API 与 schema 字段均有对应制品落账；Spec 同步声明经核实无遗漏。唯一待关注项是 T017 Codex 对抗审查尚未执行，按项目约定应在最终 commit 前补齐。
