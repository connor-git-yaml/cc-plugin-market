# F221 代码质量审查报告（quality-review，只审不改）

审查对象：`git diff HEAD`（10 个已跟踪文件）+ 未跟踪 `tests/unit/spec-renderer.test.ts`。
方法：逐文件通读 + 对照 plan.md 变更清单/裁决记录/回归风险表逐条核验 + **对关键结论做独立实证复现**（非仅采信 fix-report 陈述）。

## 逐项结论表

| # | 审查项 | 结论 | 依据 |
|---|--------|------|------|
| 1 | 改动最小且聚焦根因；无遗留调试代码/死代码 | **PASS** | `git diff --stat` 10 文件 314+/5-，全部落在 plan C1-C7 清单内，无越界改动；`grep console./debugger/TODO/FIXME` 在 5 个核心改动文件零命中；无注释掉的代码块 |
| 2 | 命名/注释/风格与周边一致 | **PASS** | 中文注释讲 why（如 call-resolver.ts 新增行注明"为何跳过"而非"跳过了什么"）；`stripTrailingWhitespace`/`extractReExports`/`buildReExportSignature` 命名准确达意；`ExportSpecifier` 用 `import type` 隔离，符合 isolatedModules |
| 3a | 边界：`export {} from './x'`（空 named list） | **PASS**（实证） | 独立探针：`export {} from './x.js'` → `exports.length === 0`，无异常 |
| 3b | 边界：同一 specifier 多条语句 / 同名 re-export 重复出现 | **PASS**（实证） | 探针 A：`export {a} from './x'; export {a} from './y'` → 仅保留首条（`./x.js`），第二条被 `emitted` 去重吞掉，无重复条目、无崩溃；探针 C：同语句内 `export {a,a} from './x'` 同样只留 1 条 |
| 3c | 边界：alias 与本地声明同名冲突 | **PASS**（实证） | 探针 B/E：`export function a(){}` + `export {b as a} from './x'`，无论物理顺序谁先谁后，本地声明恒赢（`kind:'function'`），因为两个提取循环是"先本地后 re-export"的**处理顺序**保证而非文本顺序保证，更稳健 |
| 3d | `emitted` 去重集合与上游 `seen` 的交互 | **PASS，且发现该设计决策对修复生效与否是决定性的** | 见下方"关键发现①" |
| 4 | 正则风险：`/[ \t]+$/gm` 灾难回溯 + 大文本 + 误伤 baseline JSON | **PASS**（实证） | 单字符类+锚点，结构上不可能回溯；40MB 合成文本（20000 行×2000+尾空白）耗时 2ms，200 万字符单行耗时 0ms；baseline JSON 由 `JSON.stringify` 保证单行落盘，`$`（multiline）只匹配真实行尾位置，JSON 字符串值内部的空白（若有）不在行尾位置，不会被误伤 |
| 5a | 图口径：C3（`deriveNodesFromSkeletons`/`deriveContainsEdges`）+ C4（`buildModuleSymbolIndex`）三处显式过滤 | **PASS**（实证，含真实仓库端到端验证） | 见下方"关键发现②" |
| 5b | 图口径：其余消费面（`code-slice-extractor`/`data-model-generator`/`context-assembler`/`buildClassMemberIndex`/`buildClassMroIndex`）天然安全性 | **PASS**（逐点读码确认） | 全部为"包含式"过滤（`kind==='function'\|\|'class'`、`kind!=='interface'&&kind!=='type'` 等）或依赖 `members` 存在性，'re-export' 值落入分支外自然被跳过；`context-assembler.ts` L114 通用渲染 `### ${exp.kind}: ${exp.name}` 对未知 kind 无副作用（jsDoc/members 判空自然跳过）；`data-model-generator.ts` L730 一带（Python 专用路径）与本次改动的语言无关，不构成风险面，fix-report 列入纯属过度谨慎 |
| 5c | 图口径：tree-sitter 降级路径 parity | **WARNING** | 见下方"问题①" |
| 6 | 类型安全：新增 optional 字段与 `exactOptionalPropertyTypes` | **PASS** | `tsconfig.json` 确认 `"exactOptionalPropertyTypes": false`，普通 `.optional()` 字段按宽松语义处理，与 plan 假设一致；独立重跑 `npm run build` 零错误 |
| 7 | 新增测试是否真能防回归；有无 `any` | **PASS** | 用例断言均指向真实行为结果（过滤后数组内容、字符串包含关系），非实现细节快照；`kind: 're-export' as const` 等处保证字面量类型，未见 `any`；独立重跑 5 个改动测试文件共 78 用例全绿 |
| 8 | 安全隐患/数据丢失/构建阻断 | **PASS** | 无凭据/权限/文件删除相关改动；`npm run build` 干净；`git diff --check` 对本次 diff 零告警（改行尾空白的修复本身没有引入行尾空白，属于自证） |
| 9 | 全量 `vitest run` 是否零失败 | **PASS（隔离后）** | 全量跑出 10 个失败，但**全部与本次改动无关**：已用 `git stash` 剥离本次 diff 后在同一 worktree 复现同样失败，证实为预存问题（见下方"问题②③"，非本次引入回归） |

## 关键发现①：`extractReExports` 不复用外层 `seen`，是必要设计而非过度设计

Plan 文本写"沿用函数内 seen 去重集合"，但实现改用了从 `exports` 数组当前内容现取的 `emitted` 集合（`ast-analyzer.ts` L142），并在代码注释里给出了理由。审查用独立探针验证了这个理由站得住脚，而且**如果按 plan 字面"复用 seen"实现，本次修复会完全失效**：

```
sourceFile.getExportedDeclarations() 对 `export { r1, r2, r3 } from './m1.js'`（目标不可解析）
返回 r1 => [] / r2 => [] / r3 => []（名字可见，节点数组为空）
```

外层循环对这三个名字仍会执行 `seen.add(name)`（在遍历 `nodes` 之前），但因为 `nodes` 为空，`extractSymbol` 从未被调用，`exports` 数组里从未真正出现这三个名字。若 `extractReExports` 复用这个 `seen`，会把这三个"看过但没产出"的名字当成已存在而跳过，11 个 re-export 符号会被再次静默吞掉——修复形同虚设。实现选择重新从 `exports` 现有内容取 `emitted`，规避了这个陷阱，判断正确，且注释准确描述了原因。这是一个偏离 plan 字面表述、但技术上更正确的实现决策，应予认可而非扣分。

## 关键发现②：图过滤在真实仓库上端到端验证通过

审查未止步于单元测试，额外在当前 worktree 全量重建了知识图谱并跑了 F217 质量门：

```
npx tsx src/cli/index.ts batch --mode graph-only
  → 节点: 5960 | 边: 7987（graph.json 属 .gitignore，不影响提交状态）

npx tsx src/cli/index.ts graph-quality --graph specs/_meta/graph.json --format text
  → Overall Verdict: pass
  [duplicate-canonical-id] pass
  [contains-coverage] pass (5036/5036, 100.0%)
  [orphan-ratio] pass (超标 0/5036, 0.0%)
  [dangling-edge] pass
  [legacy-ignored] pass
```

并且直接对 `src/batch/batch-orchestrator.ts` 真实 14 符号 facade 抽查：`normalizeConcurrency`/`buildAstGraphOnly`/`mergeGraphsForTopologicalSort`/`collectPythonCodeSkeletons`/`GraphOnlyResult`/`buildDesignDocAbsPaths` 六个 re-export 名，图中**均且只**挂在各自真身文件（`stages/*.ts`）下，`batch-orchestrator.ts::<名字>` 别名节点零命中。同时独立复现 `analyzeFile('src/batch/batch-orchestrator.ts').exports.length === 14`（3 本地 + 11 re-export），与 fix-report 实证复现的目标值一致。验收标准 (a) 与回归风险表"F217 图质量门"高风险项均有真实证据闭合，不只是单测断言层面。

## 问题清单

### 问题① [WARNING] tree-sitter 降级路径的"已知限界"注释承诺未落地

- **位置**：`src/core/query-mappers/typescript-mapper.ts` L602-631（`_extractExportClause`），plan.md 裁决记录第 1 条
- **现象**：plan.md 裁决记录明确写"限界注释写在 typescript-mapper 的 export_statement 处理段"，但 `git diff HEAD --stat` 显示该文件未被触碰，既有注释仍是修复前就存在的 `// re-export 无法确定实际 kind`（该行只说明 kind 猜不出，完全没提及"这条 re-export 记录不会被 C3/C4 新过滤逻辑捕获"这个新增的交互事实）。
- **失败场景**：一个 ts-morph 解析失败、降级到 tree-sitter 的 TS/JS 文件中若含 `export { x } from './y'`，产出的 ExportSymbol 是 `kind: 'variable'`（非 `'re-export'`），不会被 `deriveNodesFromSkeletons`/`deriveContainsEdges`/`buildModuleSymbolIndex` 新加的 `kind === 're-export'` 判断拦截，仍会在图中造出别名节点/悬空边——即本次修复要消灭的那类问题，在这条边缘路径上原样保留。这不是本次改动引入的新回归（该行为改动前后一致），但 plan 自己承诺的"写清楚这是已知限界"这一步没有兑现，后续维护者读到 C3/C4 的注释（"re-export 是别名门面而非真身"）容易误以为该不变量已在全部路径生效。
- **建议**：在 `_extractExportClause` 附近补一行注释，说明这里产出的 `kind:'variable'` 条目不会被知识图谱的 re-export 过滤覆盖，属已知 parity gap（成本极低，纯文档，不影响任何测试）。

### 问题② [不计入本次回归 — 预存失败] `f220-decomposition-charter.e2e.test.ts` 9 个快照因系统日期滚动而 mismatch

- **现象**：全量 vitest 中该文件 9 个快照全部因 `> 由 spectra v4.3.0 自动生成 | 2026/7/21`（旧快照）vs `2026/7/22`（今天，运行时取的真实系统时间）不一致而失败
- **根因**：`src/batch/batch-readme-generator.ts:49` 用未 mock 的 `new Date().toLocaleDateString('zh-CN')` 写入快照内容，与本次 F221 改动的任何文件均无关联
- **验证**：`git stash` 剥离本次 10 个改动文件后，在同一 worktree 重跑该测试文件，同样 9 个失败、同样的日期 diff——证实是预存的日期敏感快照缺陷，非本次引入
- **不建议**在本次 fix 顺手修，超出 F221 范围（根因在另一模块的快照测试设计）

### 问题③ [不计入本次回归 — 预存 flaky] `community-analysis.test.ts` 5000 节点性能阈值在全量并发下超时

- **现象**：全量 vitest 下 `expect(elapsed).toBeLessThan(30000)` 实测 32997ms 超阈值
- **验证**：单独隔离运行该文件（含 `git stash` 剥离本次改动后）均通过；与项目记忆 `project_community_analysis_flaky_perf.md` 记录的"全量并行负载下 wall-clock flaky，隔离重跑约 13s 过"完全吻合，属已知预存 flaky，非本次引入

### 次要说明 [不构成发现] `isDefault` 对 `export { default } from './x'` 形态恒为 `false`

- **位置**：`src/core/ast-analyzer.ts` L164
- **现象**：`extractReExports` 无条件写 `isDefault: false`；对比 `extractSymbol`（L199）用 `isDefault = name === 'default'` 的既有约定，`export { default } from './x.js'`（未加别名、显式转发默认导出）这一形态下 `name` 实际是 `'default'`，理应 `isDefault: true` 才与既有约定一致
- **实测**：`export { default } from './x.js'` → `{ name: 'default', isDefault: false }`；`export { default as Foo } from './x.js'` → `{ name: 'Foo', isDefault: false }`（这种情况恒 false 才是对的）
- **影响面**：全仓库唯一读取 `ExportSymbol.isDefault` 的消费点是 `src/cli/commands/prepare.ts:116`，仅用于展示时追加 `(default)` 后缀；该形态未加分层过滤、不进图、不影响任何门禁或已有测试
- **未列为 WARNING 的理由**：影响面仅一处纯展示逻辑、触发条件狭窄（该仓库自身代码风格中未出现此写法）、无数据/图/测试面回归，标注为观察记录供参考，不阻塞交付；如需彻底可在后续小改中把 `isDefault: name === 'default'` 补上（一行，不影响本次验收范围）

## 总体结论

本次修复改动聚焦、边界处理扎实（10 项独立对抗探针零翻车）、正则与类型安全均实测确认无风险、图拓扑安全性在真实仓库端到端验证通过（graph-quality 六指标全绿 + facade 符号零重复现身）。发现 1 项 WARNING（plan 自己承诺的 tree-sitter 限界注释未落地，纯文档缺口，非新回归）+ 1 项低影响观察记录（re-export 形态下 `isDefault` 语义不一致，影响面仅一处展示文案）。全量 vitest 的 10 个失败经隔离复现均为预存问题（日期敏感快照 + 并发负载 flaky），与本次改动无关。**无 CRITICAL 项，可以交付**；建议顺手把问题①的注释和 `isDefault` 一行修正一并处理（成本各 1 行），非强制阻塞。
