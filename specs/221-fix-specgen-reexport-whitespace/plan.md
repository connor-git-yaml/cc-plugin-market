# 修复规划 — F221 spec 生成器 re-export 识别 + 尾随空格

> 模式：fix（精简规划）。诊断依据：本目录 fix-report.md（方案 A 已选定）。
> 产出方式备注：plan 阶段 4 次 Task 委派均因 API `Connection closed mid-response` 失败（证据见编排记录），按委派硬约束唯一降级通道由编排器 inline 产出。

## 1. 变更清单（逐文件）

### C1 `src/models/code-skeleton.ts` — 模型扩展（合同层）

- `ExportKindSchema` 枚举追加 `'re-export'`（枚举注释已声明前向兼容扩展，沿用同一扩展位）
- `ExportSymbolSchema` 追加两个 optional 字段：
  - `reExportFrom: z.string().min(1).optional()` — re-export 来源 module specifier 原文（如 `'./stages/graph-assembly.js'`），仅 kind==='re-export' 时出现
  - `isTypeOnly: z.boolean().optional()` — 覆盖语句级 `export type {} from` 与说明符级 `export { type X } from` 两种形态
- jsdoc 中文注释说明语义与"仅 re-export 条目携带"的约束
- **边界**：新增字段全 optional + 新枚举值只出现在新数据 → 存量 specs/*.spec.md 内嵌 baseline-skeleton JSON 以新 schema 读取零破坏（前向兼容）

### C2 `src/core/ast-analyzer.ts` — 提取端主修复

`extractExports`（L109-127）在既有 `getExportedDeclarations()` 循环**之后**追加 `sourceFile.getExportDeclarations()` 遍历：

- 仅处理带 module specifier 的声明（`decl.getModuleSpecifierValue()` 非空）；本地 `export { x }`（无 specifier）跳过——已由既有循环经同文件解析覆盖，避免重复
- 每个 named specifier 产出一条 ExportSymbol：
  - `name` = 导出名（alias 优先：`spec.getAliasNode()?.getText() ?? spec.getName()`）
  - `kind` = `'re-export'`
  - `reExportFrom` = specifier 原文
  - `isTypeOnly` = `decl.isTypeOnly() || spec.isTypeOnly()`
  - `signature` = 规范化单行重建（如 `export type { GraphOnlyResult } from './stages/graph-assembly.js'`；含 alias 时 `export { a as b } from '...'`），不取多名字语句原文（保证每条目签名只描述自身）
  - `startLine/endLine` = export 语句在**本文件**的行号（满足 schema 正整数约束）
  - 无 `members`/`typeParameters`/`jsDoc`（别名条目不持有真身结构）
- 沿用函数内 `seen` 去重集合：本地声明循环在前 → 本地优先，同名 re-export 不覆盖
- **已知限界（写注释 + 本 plan 记录）**：`export * from` 与 `export * as ns from` 不可枚举（单文件 Project + noResolve 无法展开），不产条目；不做跨文件解析（保持 L68-84 性能契约，方案 B 否决理由见 fix-report）

### C3 `src/knowledge-graph/index.ts` — 图派生过滤（拓扑红线）

- `deriveNodesFromSkeletons` 导出循环（L231）与 `deriveContainsEdges` 循环（L291）行首增加 `if (exp.kind === 're-export') continue;`
- 注释说明 why：re-export 是别名不是真身，真身节点由目标文件贡献；不过滤会产出 `orchestrator::X` 重复节点 + contains 边，触碰 F217 质量门（duplicate/orphan）与 F214 canonical ID 拓扑

### C4 `src/knowledge-graph/call-resolver.ts` — 解析口径保持

- `buildModuleSymbolIndex`（L100 循环）跳过 `kind === 're-export'` 条目
- why：若把 re-export 名字放进模块符号索引，经 facade import 的调用会解析到被 C3 过滤掉的节点 → dangling call edge（F217 dangling 检查红线）。跳过后与修复前解析行为逐字一致（今天 re-export 本就不可见），零回归
- `buildClassMemberIndex`（无 members 自然跳过）、`buildClassMroIndex`（kind 过滤天然排除）不需改动，测试确认即可
- **follow-up 候选（不在本期）**：利用 `reExportFrom` 做 facade→真身 call 转发解析，属 M9 轨道 B 图增强，单独立项

### C5 `src/generator/spec-renderer.ts` — 序列化端归一化（缺陷二主修复）

- 新增模块级 helper `stripTrailingWhitespace(text: string): string`，实现 `text.replace(/[ \t]+$/gm, '')`
- `renderSpec` / `renderIndex` / `renderDriftReport` 三个渲染出口的 return 前统一套用（renderSpec 对 `markdown + baselineComment` 整体套用；baseline JSON 为 stringify 单行本就无尾随空白，统一处理无副作用）
- why 放渲染出口而非 writeFileSync：渲染函数是"生成文本"的唯一序列化边界，测试可直接断言纯函数输出；LLM 段落、模板、确定性拼接三来源一次覆盖
- **边界**：不折叠空行、不动行内空白，仅剥离行尾 space/tab；Markdown 双空格硬换行本仓库模板从未使用（fix-report 已核实 27 模板仅 1 处尾随空格），`git diff --check` 语义下行尾空白一律视为 error，归一化优先

### C6 `templates/pattern-hints.hbs` L51 — 同缺陷面顺手修复（1 字符）

- `- -- ` → `- --`（该模板走 panoramic 渲染路径，不经 C5 三出口；属同一"生成文本带尾随空格"缺陷面，最小修复）

### C7 测试（与修复同 commit）

| 测试文件（沿用现有布局） | 用例 |
|--------------------------|------|
| ast-analyzer 既有测试文件 | ① named re-export（`export { a, b } from './x.js'`）→ 2 条 kind='re-export' + reExportFrom；② alias（`export { a as b } from`）→ name='b'；③ 语句级 type-only → isTypeOnly=true；④ 说明符级 `export { type T, v } from` → T true / v false；⑤ 本地 `export { localFn }` 无 specifier → 无 re-export 条目、本地声明经 seen 不重复；⑥ `export * from` → 无条目；⑦ 14 符号集成 fixture（3 本地 + 11 re-export 混合，镜像 F220 facade 形态）→ count=14 |
| spec-renderer 既有测试文件 | ⑧ sections 注入含行尾空格/tab 的内容 → renderSpec 输出 `/[ \t]+$/m` 零匹配；⑨ renderIndex / renderDriftReport 同断言 |
| knowledge-graph 既有测试文件 | ⑩ 含 re-export 条目的 skeleton → deriveNodesFromSkeletons 无别名节点 / deriveContainsEdges 无别名边；⑪ buildModuleSymbolIndex 不含 re-export 名 |
| single-spec-orchestrator 既有测试文件 | ⑫ generateAstInterfaceDefinition 对含 re-export 的 skeleton：表格行渲染 kind 列='re-export'、签名列含来源 specifier |

## 2. 裁决记录（编排器要求的三项）

1. **tree-sitter TS mapper 降级路径 parity：记录已知限界，不纳入本期。** 依据：TS/JS 生产主路径是 ts-morph（`ts-js-adapter` 仅在 ts-morph parse 抛错时降级 tree-sitter）；触发条件=语法非法文件，此时 skeleton 本身已是降级产物；typescript-mapper 1328 行 query 语法改动回归风险远大于该角落收益。"下游误导面最小"的主体（语法合法的 facade 文件）已被 ts-morph 路径 100% 覆盖。限界注释写在 typescript-mapper 的 export_statement 处理段。
2. **渲染不新增"Re-export 导出面"独立小节。** `generateAstInterfaceDefinition` 的统一表格自带 `类型` 列（值 're-export'）与 `签名` 列（自带 `from './stages/…'` 来源）→ 分层标注零渲染代码达成；fileInventory purpose（L756-758）全名单不截断、折叠汇总表导出数列自动变 14。验收 (a) 的"14 符号或明确分层标注"以此口径满足。**F148 截断契约（EXPORTS_PER_FILE_LIMIT=12 等四常量）不动**——batch-orchestrator 在 src.spec.md 聚合中落折叠表（老版本即如此），逐行 14 不是验收的字面要求。
3. **验证再生路径：AST-only 降级零 LLM。** `callLLM` 在 `detectAuth()` 无可用认证时抛 `LLMUnavailableError` → `generateAstOnlyContent` 降级（single-spec-orchestrator L511-521）。以 `HOME=<空目录> ANTHROPIC_API_KEY=` 环境跑再生入口即可确定性触发（出现"已降级为 AST-only Spec" warning 即证实生效）；接口表/数据结构/文件清单均为 AST 确定性段，与 LLM 路径同源，验收 (a)/(b) 有效。

## 3. 回归风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| F217 图质量门（duplicate/orphan/dangling） | 高（若漏过滤） | C3/C4 双点过滤 + 用例⑩⑪；验证段重建 graph-only 后跑 `graph-quality` 全绿 |
| 存量 baseline-skeleton 前向兼容 | 低 | 新字段 optional / 新枚举值只进新数据；vitest 全量回归覆盖读侧 |
| drift 检测一次性漂移 | 预期内 | 修复后首次 drift 对比会对含 re-export 的文件报"新增导出"——这是对既往漏报的矫正，属真实信息非误报；随 spec 再生周期消化，不做抑制 |
| ExportKind 新值进入包含式过滤分支 | 低 | 全仓 kind 分支已枚举（fix-report 消费面清单）：全部为 `kind === 'x'` 包含式 → 're-export' 默认被排除，语义恰好正确（不切片/不进数据结构/不进 narrative）；无 exhaustive switch 断裂点（typescript-mapper L1030 的 case 作用于自身 AST capture 类型，非 ExportKind） |
| 渲染归一化误伤 | 低 | 仅 `[ \t]+$` 行尾剥离；用例⑧⑨断言；全量 vitest 捕捉既有快照断言漂移 |
| aggregated src.spec.md 体量 | 无变化 | 每条 re-export 仅一行表格 + baseline JSON 条目，无 members 展开 |

## 4. 验证方案（Phase 4 执行清单）

1. **单元**：`npx vitest run` 全量零失败（含 C7 新用例 ⑫ 项）
2. **类型/构建**：`npm run build` 零错误
3. **仓库门禁**：`npm run repo:check` 全绿（含 F217 graph-quality 第 12 族；跑前 `npx tsx src/cli/index.ts batch --mode graph-only` 重建当前 worktree 图，确认节点/边数与修复前一致——过滤生效的直接证据）
4. **验收 (a)**：实证脚本重跑 `analyzeFileInternal('src/batch/batch-orchestrator.ts')` → export count = 14、11 条 kind='re-export' 携 reExportFrom；AST-only 环境再生 src.spec.md → batch-orchestrator 行导出数=14、fileInventory purpose 含全部 14 名
5. **验收 (b)**：对再生 src.spec.md 跑 `git diff --check` 零告警 + `grep -nE '[ \t]+$'` 零匹配
6. **产物处置**：再生的 specs/src.spec.md 只作验证证据（关键片段归档 verification/verification-report.md），随后 `git checkout -- specs/src.spec.md` 还原——沿用"自动再生物不随 feature commit"仓库惯例
7. **验收 (c)**：即第 1 项全量 vitest

## 5. 已知限界（随修复入注释/文档）

- `export * from` / `export * as ns from`：单文件 Project 无解析不可枚举，不产条目
- tree-sitter TS/JS 降级路径不识别 re-export（触发条件为语法非法文件，见裁决 1）
- facade→真身的 call 转发解析：`reExportFrom` 字段已为其预留数据，单独立项（M9 轨道 B 候选）
