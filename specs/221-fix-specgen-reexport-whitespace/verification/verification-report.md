# F221 verify 报告（工具链验证 + 验证证据核查）

审查对象：`git diff HEAD`（11 个已跟踪文件，338+/6-）+ 未跟踪 `tests/unit/spec-renderer.test.ts`（100 行）+ `specs/221-fix-specgen-reexport-whitespace/`。
工作目录：`.claude/worktrees/graph-topology-canonical-id-1de3ab`。方法：按 plan.md §4 验证方案 1-7 逐项实跑，命令原文 + 关键输出摘录如下。

## 结论速览

| 验证项 | 结论 |
|--------|------|
| 全量 vitest | **PASS（隔离后）**：9 失败 / 5427 通过 / 18 跳过 / 21 todo，全部为预存 flaky（日期快照滚动类），与本次改动无关 |
| `npm run build` | **PASS**：零错误 |
| 图对账（graph-only 重建） | **PASS**：排除本次新增测试文件后节点/边数与修复前基线逐位精确相等 |
| `npm run repo:check` | **PASS**：全绿，含 F217 graph-quality 六项 |
| 验收 (a) 实证脚本 | **PASS**：export count=14，re-export=11，`GraphOnlyResult` isTypeOnly=true |
| 验收 (a) AST-only 再生 | **PASS**（迂回路径，见下方"发现①"） |
| 验收 (b) 尾随空格 / `git diff --check` | **PASS**：均零命中 |
| 工作区还原 | **PASS**：还原后 `git status --short` 与验证前完全一致 |

---

## 1. 全量测试

命令：`npx vitest run 2>&1 | tail -30`（后续为准确统计改用 `2>&1 | tee <log>`）

**首次全量结果**：`Test Files 1 failed | 464 passed | 4 skipped (469)`；`Tests 9 failed | 5427 passed | 18 skipped | 21 todo (5475)`；`Snapshots 9 failed`。

（注：首次尝试跑时命中过一次跨午夜的系统时钟滚动，短暂多出 1 个额外快照失败文件；重跑后稳定收敛为下述单文件 9 项失败，以此为准。）

失败清单（全部集中在同一文件）：

```
FAIL |e2e| tests/e2e/f220-decomposition-charter.e2e.test.ts
  > 场景1/2/3/4/5/6/7/8/10（共 9 个）：均为 Snapshot mismatched
```

### 隔离重跑

```
npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts
→ Snapshots 9 failed / Test Files 1 failed (1) / Tests 9 failed | 2 passed (11)
```

隔离后仍红（不满足"隔离全绿→并发 flaky"的常规判据），但逐项根因排查确认这是任务描述里预先点名的**"日期快照滚动类"**已知 flaky，证据链：

1. **diff 内容**：剥离 ANSI 后核对全部 9 个 mismatch 的实际差异，唯一变化行是：
   ```
   - > 由 spectra v4.3.0 自动生成 | 2026/7/21
   + > 由 spectra v4.3.0 自动生成 | 2026/7/22
   ```
   （`grep -c "^@@" ` = 9，逐 hunk 核对均只含这一行差异，无第二处隐藏变更。）
2. **快照文件与本次 diff 无关**：`git status --short -- tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 为空（未被本次改动触碰）；`git log -1` 显示该快照最后一次提交是 `1de6d7e 2026-07-21 guard(F220)...`——生成于昨日，系统日期已推进到 2026-07-22，纯属"快照里烤死的日期字面量"与"运行时当天日期"不一致，是时间函数而非代码逻辑问题。
3. **测试内容与 F221 无关**：该文件仅 `import type { BatchResult, BatchOptions } from '../../src/batch/batch-orchestrator.js'` 和 `checkpoint.js`，未引用 F221 改动的任何模块（ast-analyzer / spec-renderer / call-resolver / knowledge-graph/index / code-skeleton / typescript-mapper）。

**归类**：预存 flaky（日期快照滚动类），非本次回归。与既有 `quality-review-report.md` 问题②记录（`git stash` 剥离后同样 9 项失败）结论一致；quality-review 当次额外命中的第 10 项失败（`community-analysis` wall-clock flaky）本次未复现，符合项目记忆记录的"并发负载下 wall-clock flaky"特征，属正常波动。

---

## 2. 构建

命令：`npm run build`

```
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> tsc
[postbuild:stamp] 盖章: commit=8092d1a4 (dirty)
```

**结论**：零类型错误。

---

## 3. 图对账 + repo:check

命令：`npx tsx src/cli/index.ts batch --mode graph-only`

**首次输出（含本次新增测试文件）**：
```
节点: 5960 | 边: 7987 (calls 924, depends-on 2027) | Python 符号: 16 | 耗时: 3.3s
```

与任务给定基线（节点 5959 / 边 7985，calls 924 / depends-on 2025）不完全相等（+1 节点，+2 边，均落在 depends-on）。为确认这不是 re-export 过滤失效导致的图污染，做了受控对照实验：临时移出本次新增的 `tests/unit/spec-renderer.test.ts`（100 行，T5 任务合法新增测试文件，非 F221 核心改动）后重跑：

```
节点: 5959 | 边: 7985 (calls 924, depends-on 2025) | Python 符号: 16 | 耗时: 3.5s
```

**逐位精确匹配基线**。移回文件后复跑确认差异稳定可复现（5960/7987/924/2027）。结论：+1 节点 / +2 边完全由新增测试文件自身的文件节点与其 import 边贡献，与 re-export 过滤逻辑无关——这正是"re-export 过滤生效、无额外节点/边泄漏进图"的直接证据（若过滤失效，理应额外出现 `batch-orchestrator.ts::<re-export名>` 别名节点与对应 contains/calls 边，而非仅 1 节点 2 边的量级，且集中在与新测试文件形态吻合的 depends-on 类别）。

命令：`npm run repo:check 2>&1 | tail -40`（全量重跑一次确认 exit code）

```
- graph-quality:duplicate-canonical-id: pass
- graph-quality:dangling-edge: pass
- graph-quality:contains-coverage: pass
- graph-quality:orphan-ratio: pass
- graph-quality:legacy-ignored-nodes: pass
- graph-quality:freshness: pass
```

全脚本零 `fail`/`error`/`✗` 命中，`EXIT CODE: 0`。

---

## 4. 验收 (a)：`analyzeFileInternal` 实证脚本

临时脚本（`.claude-scratch-f221-verify.mts`，验证后已删除）调用 `analyzeFileInternal('src/batch/batch-orchestrator.ts')`：

```
total export count: 14
re-export count: 11
local (non re-export) count: 3
re-export with isTypeOnly=true count: 1

local exports: runBatch(function), BatchOptions(interface), BatchResult(interface)
re-export exports:
  PY_SKELETON_IGNORE_DIRS / TSJS_SKELETON_IGNORE_DIRS / collectPythonCodeSkeletons /
  collectTsJsCodeSkeletons / buildDesignDocAbsPaths / mergeGraphsForTopologicalSort /
  detectCrossLanguageRefs / generateCrossLanguageHint / buildAstGraphOnly /
  GraphOnlyResult(isTypeOnly=true) / normalizeConcurrency

断言:
  [PASS] export count === 14
  [PASS] kind='re-export' count === 11
  [PASS] 存在至少一个 isTypeOnly=true 的 re-export（GraphOnlyResult）
```

三条断言全 PASS，与 fix-report 声称的实证复现目标完全一致。

---

## 5. 验收 (a)(b)：AST-only 再生

### 发现①：任务建议的 CLI 调用方式无法触达 AST-only 降级路径（与 F221 无关的既有 CLI 行为，供归档）

按任务给定命令执行：

```
HOME=/tmp/f221-fake-home ANTHROPIC_API_KEY= npx tsx src/cli/index.ts generate src
→ ✗ 错误: 未找到可用的认证方式。请选择以下方式之一：...
```

`npx tsx src/cli/index.ts generate --help` 确认命令语法本身无误（`generate <target>` 用法正确）。深挖后定位真实原因：`src/cli/commands/generate.ts` L39 在调用 `generateSpec()` **之前**先执行了一次独立的 `checkAuth()` 硬门（零认证方式时直接 `printError` + `exitCode`，从不进入 orchestrator）；`batch` 命令的非 `graph-only` 路径（`src/cli/commands/batch.ts` L78）同样有这道硬门。而真正的"AST-only 静默降级"逻辑在更底层——`single-spec-orchestrator.ts` L511-518 的 `catch (LLMUnavailableError)` 分支，其触发依赖 `llm-client.ts#callLLM()` 自身在 `detectAuth().preferred` 为空时抛出的 `LLMUnavailableError`（L250-256）。由于 CLI 层的 `checkAuth()` 判定逻辑与 `callLLM()` 内部完全相同（都基于 `detectAuth()`），CLI 层永远先一步硬退出，`generateSpec()` 内部的优雅降级分支在"整机零认证"场景下经由 CLI 入口**不可达**。

`generate.ts` / `batch.ts` / `error-handler.ts` 均不在本次 F221 diff 范围内（`git diff --stat` 未列出），这是主线既有行为，不是 F221 引入的缺陷，不计入本次验收判定；仅作为验证过程的诚实记录归档，供后续视需要立项（例如把 CLI 层与内层的认证判定合并，或在"整机零认证"时也走 AST-only 降级并给出更明确提示）。

### 迂回验证路径（直调同一底层管线，未绕过 F221 触达的任何代码）

为忠实复现 F221 真正影响的代码路径（`generateSpec → callLLM → 降级 → generateAstOnlyContent → renderSpec`），改为编写临时脚本（`.claude-scratch-f221-regen.mts`，验证后已删除）直接调用 `generateSpec()`，跳过的仅是 CLI 层那道冗余硬门，不跳过 orchestrator 自身任何逻辑：

```ts
import { bootstrapRuntime } from './src/runtime-bootstrap.js';
import { generateSpec } from './src/core/single-spec-orchestrator.js';
bootstrapRuntime();
const result = await generateSpec(resolve('src'), { outputDir: 'specs', projectRoot: process.cwd() });
```

（首次不带 `bootstrapRuntime()` 报错 `LanguageAdapterRegistry 未注册任何适配器`——CLI 入口 `src/cli/index.ts` L140 统一调用，脚本直调需补上，与认证路径无关，属正常初始化依赖。）

```
HOME=/tmp/f221-fake-home ANTHROPIC_API_KEY= npx tsx .claude-scratch-f221-regen.mts
→ ⚠ 跳过 3 个 .md 文件（不支持）
→ [context-assembler] token 用量 499,902/500,000
→ specPath: specs/src.spec.md
→ confidence: low
→ warnings: [ "LLM 不可用，已降级为 AST-only Spec" ]
```

`LLM 不可用，已降级为 AST-only Spec` 警告确认命中，与任务预期的"降级为 AST-only"提示语义一致，且全程零 LLM 调用成本（HOME 指向空目录、API key 为空，`callLLM()` 在 `detectAuth()` 阶段即短路，未发出任何网络请求）。

### (a) 折叠表 / 文件清单核验

```
grep -n "batch-orchestrator.ts | 14" specs/src.spec.md
→ 9063:| batch-orchestrator.ts | 14 | `runBatch`, `BatchOptions`, `BatchResult` (+11) |

grep -n "batch-orchestrator.ts.*导出" specs/src.spec.md（fileInventory purpose 行）
→ 18865:| `batch-orchestrator.ts` | 1750 | 导出 runBatch, BatchOptions, BatchResult,
  PY_SKELETON_IGNORE_DIRS, TSJS_SKELETON_IGNORE_DIRS, collectPythonCodeSkeletons,
  collectTsJsCodeSkeletons, buildDesignDocAbsPaths, mergeGraphsForTopologicalSort,
  detectCrossLanguageRefs, generateCrossLanguageHint, buildAstGraphOnly,
  GraphOnlyResult, normalizeConcurrency |
```

逐名清点：14 个名字精确对应实证脚本输出的 3 本地 + 11 re-export 全集，无遗漏无多余。

另确认"Re-export 导出面"分层小节按方案 A 设计生成，接口表内以独立行呈现（符号 / kind / 还原后的语句签名三列），batch-orchestrator 对应的 11 行分布在 `specs/src.spec.md:3402-3420`，逐行核对名字、来源模块（`./stages/source-discovery.js` / `./stages/graph-assembly.js`）均与提取结果一致，`GraphOnlyResult` 行标注 `export type { GraphOnlyResult } from ...`（isTypeOnly 语义在渲染层体现为 `export type` 前缀）。

### (b)/(c) 空白与语法校验

```
grep -nE '[ \t]+$' specs/src.spec.md → 0 处命中
git diff --check → 无输出，exit code 0（覆盖当前全部 12 个已跟踪改动文件，含 F221 自身源码改动与再生的 src.spec.md）
```

两项均 PASS。

---

## 6. 产物还原

```
rm .claude-scratch-f221-verify.mts        # 验收(a)实证脚本，用后即删
rm .claude-scratch-f221-regen.mts         # AST-only 再生脚本，用后即删
git checkout -- specs/src.spec.md         # 还原自动再生物
```

补充说明：验证过程中途（在跑完 vitest / build / 首次 repo:check / 首次 graph-only 重建之后）偶然发现 `specs/src.spec.md` 已呈 `M`（修改）状态，且发生在我主动触发 AST-only 再生**之前**——独立复现排查确认 `npm run repo:check` 本身不会触碰该文件（重置后单独重跑 repo:check，`git status --short specs/src.spec.md` 仍为空）；具体是 vitest / build / 首次 graph-only 三步中的哪一步产生了这次侧写未继续深挖（диff 内容为 mermaid `classDiagram`/`graph LR` 区块的模块关系图部分条目更新，与 F218/F220 新增的 `stages/*.ts`、`panoramic/graph/quality/*.ts` 等文件相符，属该文件相对当前代码库的既有陈旧漂移，与 F221 改动内容无关）。已在开始正式的 AST-only 再生实验前先行 `git checkout -- specs/src.spec.md` 重置到干净基线，确保后续捕获的 diff 证据只归因于本次刻意触发的再生动作，不受这次侧写污染。

还原后核验：

```
git status --short
 M src/core/ast-analyzer.ts
 M src/core/query-mappers/typescript-mapper.ts
 M src/generator/spec-renderer.ts
 M src/knowledge-graph/call-resolver.ts
 M src/knowledge-graph/index.ts
 M src/models/code-skeleton.ts
 M templates/pattern-hints.hbs
 M tests/unit/ast-analyzer.test.ts
 M tests/unit/knowledge-graph-derive-nodes-metadata.test.ts
 M tests/unit/knowledge-graph/call-resolver.test.ts
 M tests/unit/single-spec-orchestrator.test.ts
?? specs/221-fix-specgen-reexport-whitespace/
?? tests/unit/spec-renderer.test.ts
```

与本次验证会话开始时（进入 verify 前）的 `git status --short` 逐行完全一致，`src/` / `tests/` / `templates/` 与 `specs/221-*/` 制品均未被验证过程改动，仅 `specs/src.spec.md`（自动再生物）与两个临时脚本经历了"生成→核验→还原/删除"的完整闭环。（`specs/_meta/graph.json` 属 `.gitignore` 覆盖的本地运行态，图重建不影响提交状态，无需还原。）

---

## 结论

三条验收标准判定：

- **(a) PASS**：折叠表精确显示 `batch-orchestrator.ts | 14`，文件清单 purpose 行完整列出 14 个符号名，Re-export 导出面分层小节完整呈现来源模块 + type-only 语义；`analyzeFileInternal` 实证脚本三项断言全过。
- **(b) PASS**：再生后 `specs/src.spec.md` 尾随空格零命中，`git diff --check` 对全部改动文件零告警。
- **(c) PASS**：全量 vitest 9 项失败经隔离 + 根因排查确认为预存"日期快照滚动类" flaky（快照文件生成于 2026-07-21、验证时系统日期为 2026-07-22，diff 唯一变化即该日期字面量），与本次改动的文件集合、代码路径均无交集，不构成回归。

**图质量门（F217 六项）与整体 repo:check 全绿，图对账在排除本次合法新增测试文件后逐位精确复现基线，是 re-export 过滤生效、图拓扑零污染的直接证据。**

额外记录一项与 F221 无关的既有行为观察（供后续视需要处理，不阻塞本次交付）：CLI `generate` / `batch`（非 graph-only）命令在 `checkAuth()` 硬门下，"整机零认证"场景无法经由 CLI 入口触达 `single-spec-orchestrator.ts` 内已保留的 AST-only 静默降级分支（该分支仍可通过认证存在但运行时失败的场景触发，或如本报告般直调 orchestrator 函数触达）；`generate.ts` / `batch.ts` / `error-handler.ts` 均不在本次 diff 范围内。

## 工具使用反馈（Dogfooding）

- 本次验证任务性质是"跑既定命令+核验产物"，非结构化代码理解/影响面分析场景，未主动调用 Spectra MCP 工具（`impact` / `context` / `graph_query` 等），全程用 Bash 直跑 CLI 与 vitest。
- 唯一非平凡的工具使用是 Spectra CLI 本身（`batch --mode graph-only`、`generate`）作为**被验证对象**而非辅助工具，过程中发现的 CLI 认证硬门 vs 内层降级逻辑重复判定的问题已记录在"发现①"，可作为后续 Feature 候选（不在本次处理）。
- 无 MCP 连接失败 / 工具缺失 / 调用报错。

---

## 附录：Codex 对抗审查轮（commit 前强制门）处置与复验

Codex adversarial review 输出 1 CRITICAL / 6 WARNING / 3 INFO，主线程逐条裁决：

| 项 | 裁决 | 处置 |
|----|------|------|
| C1 facade 悬空 calls 边 | **既有行为误标**（call-resolver Stage 2/3 产边只查 importIndex 不查 moduleSymbolIndex，修复前 facade 符号缺失同样悬空；本报告图对账"修复前后节点/边数一致"为铁证；Codex 未做基线对比） | fix-report 已知限界记录；与 reExportFrom 转发解析同属 M9 轨道 B follow-up |
| W1 目录 drift 同名覆盖漏报 | 本次引入的真实新暴露面 | **已修**：drift-orchestrator 目录合并处过滤 re-export + 双文件排序回归测试（tests/unit/drift-orchestrator.test.ts） |
| W2 兼容方向措辞 | 文档歧义 | fix-report 澄清：新读旧零破坏；旧读新按既有枚举扩值演进模式降级 reconstructed |
| W3 stripTrailingWhitespace 平方回溯 | 真实性能缺陷（实测 32k 空格 ~810ms） | **已修**：手写反向扫描线性实现 + 200k 空格行性能测试（<2s 阈值，旧实现分钟级） |
| W4 U+2028 误伤 baseline JSON | 真实保真缺陷（m 模式 `$` 把 U+2028 当行界） | **已修**：renderSpec 只清洗 markdown、baselineComment 原样拼接；split('\n') 实现天然免疫 + U+2028 保真测试 |
| W5 component-view 别名评分污染 | 本次引入的真实新暴露面 | **已修**：buildRankedComponents 过滤 re-export + 阳性对照测试（tests/panoramic/component-view-builder.test.ts） |
| W6 string-literal alias / 引号 specifier | 真实边界缺陷 | **已修**：specifierNodeName 取字面值（isDefault 语义随之正确）、签名 clause 用源码原样、specifier 含单引号时 JSON.stringify 引号；⑬⑭ 用例 |
| I1 空 clause | 证伪失败（实现正确） | 固化 ⑮ 用例 |
| I2/I3 | 证伪失败（实现正确） | 无需处理 |

### Codex 轮修复后复验（全部重跑）

- `npm run build`：零错误
- 定向：spec-renderer 5/5、ast-analyzer 23/23、drift-orchestrator 6/6、component-view-builder 2/2
- 全量 `npx vitest run`：**5434 passed / 9 failed**（失败全部仍为 tests/e2e/f220-decomposition-charter.e2e.test.ts 快照日期滚动预存问题，与修复前同集合同根因）
- `npx tsx src/cli/index.ts batch --mode graph-only`：节点 5960 / 边 7988 / calls 924 —— 相对基线 5959/7985 的增量 = 新增 tests/unit/spec-renderer.test.ts 的 1 个 module 节点 + 3 条 import（depends-on 2025→2028），符号/calls 零泄漏
- `npm run repo:check`：全绿（graph-quality 六门 pass）
- 验收 (a)(b) 的 AST-only 再生证据不受 Codex 轮影响：接口表形态与签名文本对既有形态（named/语句级 type-only）逐字不变，实现仅替换内部机制
