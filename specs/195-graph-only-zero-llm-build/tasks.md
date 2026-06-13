# Feature 195 任务分解（tasks.md）

依据 plan.md。TDD：测试与实现同 commit。任务按依赖排序。

## T-001 [测试先行] buildAstGraphOnly 单测骨架 + 三语言 fixture
- 在 `tests/batch/` 新增 `graph-only-pipeline.test.ts`。
- 准备/复用三组 fixture：仅 .py、仅 .ts、混合（EC-002/W-007）。优先复用现有 batch 测试 fixture。
- 写**会先失败**的断言：`buildAstGraphOnly` 存在、返回 GraphOnlyResult、产出 graph.json 文件。
- **依赖**：无。**验收**：测试文件存在、import 目标函数（此时未实现 → 红）。

## T-002 [实现] buildAstGraphOnly 函数（FR-001/002/003/007 + W-002）
- 在 `src/batch/batch-orchestrator.ts` 新增 `GraphOnlyResult` 接口 + `buildAstGraphOnly`（不暴露 languages，C-002）。
- 复用 `collectPythonCodeSkeletons` + `collectTsJsCodeSkeletons`（**同 batch L1285-1296 口径**）+ `buildUnifiedGraph` + `PythonLanguageAdapter.extractSymbolNodes` + `buildKnowledgeGraph` + `writeKnowledgeGraph(graphJson, dir, { stripTimestamps: true })`。
- **不传** docGraph/architectureIR/crossReferenceLinks。
- EC-001 空图分支、EC-003 best-effort parseError warn。
- **依赖**：T-001。**验收**：T-001 转绿；产物含 calls/depends-on 边。（**不**做 import 缺席断言——W-005，零 LLM 由 T-003 spy 证明。）

## T-003 [测试] 零 LLM 断言（SC-003a，W-005 spy 调用计数）
- spy `generateSpec` 及 enrichment/hyperedge 调用入口，断言 `buildAstGraphOnly` 跑后调用次数 = 0。
- **依赖**：T-002。**验收**：断言通过且能在引入任何 LLM 调用时变红（反向验证）。

## T-004 [测试] 结构一致性（SC-003b，W-003 收窄）+ byte 稳定 + portable
- 对比 graph-only 产物与 mock-LLM 的 batch 产物：**只比规范化 calls/depends-on 三元组 + Python 符号 component 节点 id/kind 子集**；剥除 generatedAt/sources/skippedSources/degree/anchor 边（防脆）。
- byte 稳定（SC-003 b2/W-002）：连跑两次断言 graph.json 逐字节相等。
- 三语言矩阵（SC-003 b3/EC-002）：三 fixture 分别断言对应语言节点存在、无另一语言污染。
- portable 守卫（SC-002）：断言绝对路径节点数 = 0。
- **依赖**：T-002。**验收**：全部断言通过。

## T-005 [实现] parse-args 接受 graph-only（FR-001 CLI）
- `src/cli/utils/parse-args.ts`：`--mode X` 与 `--mode=X` 两分支 + 两校验信息追加 `graph-only`；`CLICommand.batchMode` 联合类型扩展。
- **依赖**：无（可与 T-002 并行）。**验收**：`--mode graph-only` 与 `--mode=graph-only` 均解析成功。

## T-006 [测试] parse-args graph-only 两种写法（SC-003 衍生）
- 断言两种写法解析为 batchMode='graph-only'；非法值仍报错且错误信息列出 graph-only。
- **依赖**：T-005。**验收**：通过。

## T-007 [实现] batch.ts graph-only 拦截分支（FR-005/008，C-001 位置修正）
- `runBatchCommand`：**下移** `checkAuth()`（原 L39）到拦截分支之后；在 projectRoot 解析 + config merge 之后插入 graph-only 拦截 → `--languages` 传入则 warn 忽略 → 调 `buildAstGraphOnly(projectRoot, { outputDir: merged.outputDir })` → 打印专属摘要（节点/边数 + graph 路径 + 「纯 AST · 零 LLM」标识）→ set SUCCESS → return。
- 其余三 mode 路径逐字不变（checkAuth 仍对它们生效）。
- **依赖**：T-002、T-005。**验收**：graph-only 走新分支不调 checkAuth，其余 mode 不变。

## T-007b [实现] 既有 batch mock 增补（W-006）
- grep `tests/` 下所有 `vi.mock(.*batch-orchestrator)` 点，在 mock factory 补 `buildAstGraphOnly` 导出，避免 batch.ts 新 import 令其变红。
- **依赖**：T-002。**验收**：相关既有测试不因新 import 变红。

## T-008 [测试] 无认证可跑（SC-003d）+ 日志标识（SC-003e）
- 断言 graph-only CLI 路径在 checkAuth 会失败的场景下仍继续并产图（不调 checkAuth）；stdout 含「graph-only」「零 LLM」标识。
- **依赖**：T-007、T-007b。**验收**：通过。

## T-008b [实现] MCP graph-not-built 恢复提示更新（W-008，纯文案）
- `src/mcp/server.ts` + `src/mcp/graph-tools.ts` graph-not-built 恢复提示改为优先 `spectra batch --mode graph-only`，保留完整图 batch 为可选项。
- **依赖**：无。**验收**：提示文案含 graph-only；相关 MCP 测试同步更新。

## T-009 [实现] HELP_TEXT graph-only 行（FR-006）
- `src/cli/index.ts` HELP_TEXT `--mode` 行追加 graph-only：「纯 AST / 零 LLM / 耗时随文件数线性」，与 code-only「非零成本」对照。
- **依赖**：无。**验收**：见 T-010。

## T-010 [测试] 帮助文本字样（SC-003c）
- 断言 HELP_TEXT 含 `graph-only`、`纯 AST`、`零 LLM`。
- **依赖**：T-009。**验收**：通过。

## T-011 [验证] 全量回归 + 实测基准
- `npx vitest run`（零失败，SC-004 三 mode 既有测试不变）+ `npm run build` + `npm run repo:check`。
- 在本仓库实跑 graph-only，记录墙钟（<2min 基准）+ 零 LLM + portable 守卫，写入 verification-report.md。
- **依赖**：T-001..T-010。**验收**：全绿 + 实测证据。

## 任务依赖图
```
T-001 → T-002 → {T-003, T-004, T-007b}
T-005 → T-006
{T-002,T-005} → T-007 → T-008
T-008b（独立）
T-009 → T-010
all → T-011
```

## TDD 提交策略
所有任务在**单一 commit** 内完成（测试+实现同 commit，对齐 spec SC-005 与本仓 TDD 铁律）。commit 前跑 codex 对抗审查（implement phase）。
