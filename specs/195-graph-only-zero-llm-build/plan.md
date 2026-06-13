# Feature 195 技术规划（plan.md）

- **Feature**: 195-graph-only-zero-llm-build
- **依据**: spec.md（8 FR / 4 NFR / 6 EC / 5 SC）
- **scope**: MEDIUM（~6 源文件 + 测试，无跨包，schema 不漂移）

## 1. CLI 形态裁决（spec C-001 / W-1）

**裁决：采用 `spectra batch --mode graph-only`**（否决 `spectra graph build` 子命令）。

### 理由
1. **贴合解耦叙事**：需求核心是「拆 batch-orchestrator 里 spec-gen 与 graph 构建的耦合」。把零 LLM 建图暴露为 batch 的一个 mode，让解耦动作发生在被解耦的同一层；且 AST 采集器（`collectPythonCodeSkeletons` / `collectTsJsCodeSkeletons`）本就住在 batch-orchestrator，复用零摩擦。
2. **契合既有 mental model**：`--mode` 现有 full/reading/code-only 构成一条「成本/深度」光谱（帮助文本即如此呈现）。graph-only 是这条光谱的零 LLM 极点（「比 code-only 更省」），插入成本最低。
3. **避免命令语义冲突**：已存在 `spectra graph` 子命令（从磁盘 spec 建关系图）。再加 `graph build` 会出现「graph 已经在建图，build 又是什么」的双动词困惑，且二者数据来源不同（disk-spec vs from-AST）极易误用。
4. **发现性**：用户已熟悉 `--mode`，多一个枚举值的认知成本远低于一个与 `graph` 撞名的新子命令。

### 被否决项的处置
- `spectra graph build` 子命令：否决（命令语义冲突 + 重复 AST 采集逻辑）。
- 增强现有 `spectra graph` 注入 unifiedGraph：否决（会改动 `graph` 命令现有 from-disk 行为，违反 NFR 零回归意图）。

### 裁决带来的两个设计约束（W-1 衍生）
- **认证绕过（FR-005）**：在 `batch.ts` 的命令 handler 层拦截 graph-only，**跳过 `checkAuth()`**（zero-LLM，对齐 `prepare`），再 dispatch 到独立建图函数。
- **帮助文本（FR-006）**：只需改 `src/cli/index.ts` 的 HELP_TEXT `--mode` 行（无新子命令 help）。

## 2. 架构设计

### 2.1 解耦核心：独立建图函数（FR-002）

在 `src/batch/batch-orchestrator.ts` 新增导出函数（**不**改动 `runBatch` 本体）：

```ts
export interface GraphOnlyResult {
  graphPath: string;        // 写盘后的 graph.json 绝对路径
  nodeCount: number;
  edgeCount: number;
  callEdgeCount: number;
  dependsOnEdgeCount: number;
  pythonSymbolCount: number;
  durationMs: number;
}

export async function buildAstGraphOnly(
  projectRoot: string,
  options?: { outputDir?: string },   // 不暴露 languages（C-002：batch unifiedGraph 本就不按语言过滤）
): Promise<GraphOnlyResult>
```

**执行步骤（全程零 LLM）**：
1. `resolvedRoot = path.resolve(projectRoot)`；`resolvedOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(resolvedRoot, outputDir)`，默认 `outputDir='specs'`（与 runBatch L446-448 同口径）。
2. **复用 batch 构建 unifiedGraph 的同一对采集器**（C-003/I-001：batch 的 unifiedGraph 由采集器而非 scanFiles 构建，复用它们保证口径逐一对齐）：
   `collectPythonCodeSkeletons(resolvedRoot)` + `collectTsJsCodeSkeletons(resolvedRoot, { extractCallSites: true })` → 合并 Map（与 batch L1285-1296 **完全相同**的合并逻辑）。**不调 scanFiles / groupFilesByLanguage，不做语言过滤**。
3. `earlyCodeSkeletons.size === 0` → EC-001：仍走 step 6-7 产出空图（`buildKnowledgeGraph({})` → 空 nodes/links），warn「未发现可建图的源码」。
4. `buildUnifiedGraph({ projectRoot: resolvedRoot, codeSkeletons })` → unifiedGraph（calls + depends-on，纯 AST）。
5. Python 符号节点：`new PythonLanguageAdapter().extractSymbolNodes(resolvedRoot)` → `extractionResults`（纯 AST，第四路）。沿用 batch L1340-1373 的 parseError 聚合 warn（best-effort，EC-003）。
6. `buildKnowledgeGraph({ unifiedGraph, extractionResults })` —— **不传** docGraph / architectureIR / crossReferenceLinks（缺席 graceful skip，EC-004）。
7. `writeKnowledgeGraph(graphJson, resolvedOutputDir, { stripTimestamps: true })` —— **复用 F183 出口**（内部 portable 守卫 → `normalizeGraphForWrite` → 原子写盘）。**必须传 `{ stripTimestamps: true }`**（W-002：与 batch L1628 一致，保 byte-stable / 跨 worktree 一致，否则 `generatedAt` 实时戳破坏 NFR-002）。
8. 统计 nodeCount / callEdgeCount（`relation==='calls'`）/ dependsOnEdgeCount（`relation==='depends-on'`）/ pythonSymbolCount，返回 GraphOnlyResult。

> **为何不传 architectureIR**：unifiedGraph 已含 call graph + depends-on，Python 符号补 component 节点，TS 节点经 unifiedGraph 注入——满足「call graph + knowledge graph」诉求。architectureIR 由 LLM-heavy 的 `generateBatchProjectDocs` 产出，引入即破坏零 LLM。遵循 YAGNI（宪法原则 III）。

### 2.2 CLI 接线

- **`src/cli/utils/parse-args.ts`**：`--mode` 解析两处分支（`--mode X` 与 `--mode=X`，约 L794 / L807）+ 校验信息（L801 / L814）追加 `graph-only`；`CLICommand.batchMode` 联合类型（L88）+= `'graph-only'`。
- **`src/cli/commands/batch.ts`** `runBatchCommand`（C-001 拦截位置修正）：
  当前顺序是 L39 `checkAuth()` → L44 try → L46 `projectRoot` 解析 → L49-59 config merge。graph-only 需要 `projectRoot` + `outputDir`，故拦截**不能**简单插在 L39 前（那时 projectRoot/config 尚未算出）。修正顺序：
  ```ts
  // try 块内、解析 projectRoot + config merge 之后、checkAuth 之前
  const projectRoot = resolve(command.target ?? process.cwd());
  // ...（config merge 得到 merged.outputDir 等，复用现有 L49-59 逻辑）
  if (command.batchMode === 'graph-only') {
    if (command.languages?.length) {
      console.warn('⚠ graph-only 不支持 --languages 过滤，将构建全仓 AST 图');
    }
    const result = await buildAstGraphOnly(projectRoot, { outputDir: merged.outputDir });
    // 打印 graph-only 专属摘要（节点/边数 + graph 路径 + 「纯 AST · 零 LLM」标识，FR-008）
    process.exitCode = EXIT_CODES.SUCCESS;
    return; // 完全不进入 checkAuth + runBatch（FR-005 零 LLM 无需认证）
  }
  if (!checkAuth()) { process.exitCode = EXIT_CODES.API_ERROR; return; }  // 仅非 graph-only 走认证
  // ... 其余三 mode 路径逐字不变（NFR-001）
  ```
  即把现有 L39 的 `checkAuth()` 下移到 graph-only 拦截分支之后。其余三 mode 行为不变。

### 2.3 runBatch 不变性（NFR-001 最强保证）

- `runBatch` 的 `validModes`（L419）**保持 `['full','reading','code-only']`**，`BatchMode` 类型（`src/panoramic/qa/types.ts`）**不动**。
- graph-only **不是** runBatch 的 mode，而是 batch.ts 层拦截后 dispatch 的**姊妹管线**。runBatch 的 1400 行对 graph-only 完全不执行 → 不可能触碰 F182 checkpoint/delta 状态机（NFR-003）。
- 若程序化调用方误传 `mode:'graph-only'` 给 runBatch，runBatch 按既有逻辑抛「无效 mode」——契约保持 3-mode 不变，符合预期。

## 3. 文件改动清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/cli/utils/parse-args.ts` | `--mode` 接受 `graph-only`（2 解析 + 2 校验分支）；batchMode 联合类型扩展 | 修改 |
| `src/cli/commands/batch.ts` | checkAuth 下移 + graph-only 拦截分支（dispatch + --languages warn + 专属摘要） | 修改 |
| `src/batch/batch-orchestrator.ts` | 新增 `buildAstGraphOnly` + `GraphOnlyResult`（runBatch / BatchMode / validModes 不动） | 修改（纯新增导出） |
| `src/cli/index.ts` | HELP_TEXT `--mode` 行加 graph-only（纯 AST/零 LLM/线性） | 修改 |
| `src/mcp/server.ts` + `src/mcp/graph-tools.ts` | graph-not-built 恢复提示改为优先 `spectra batch --mode graph-only`（W-008，纯文案） | 修改 |
| `tests/cli/cli-command-runners.test.ts`、`tests/unit/batch-command-exit-code.test.ts` 等 | 既有 mock `runBatch` 处补 mock `buildAstGraphOnly`（W-006，防变红） | 修改 |
| `tests/batch/graph-only-pipeline.test.ts`（新） | 零 LLM(spy) + 结构一致性 + byte 稳定 + 三语言矩阵 + 空图 + portable | 新增 |
| `tests/cli/graph-only-cli.test.ts` 或并入现有 | help 字样 + parse-args graph-only 两写法 + 无认证 + 日志标识 | 新增/扩展 |

预计：5 源文件修改（含 MCP 文案）+ 既有 mock 增补 + 2 测试文件。无新依赖。

> **mock 路径注意（W-006）**：测试中既有 mock 路径需确认真实文件位置（`tests/` 下用 grep `vi.mock.*batch-orchestrator` 定位全部 mock 点，逐一补 `buildAstGraphOnly` 导出，避免 import 后某测试因 mock 不全变红）。

## 4. 测试策略（TDD，对齐 SC-003）

- **SC-003(a) 零 LLM（W-005：spy 调用计数，非 import 缺席）**：`buildAstGraphOnly` 住 batch-orchestrator.ts，该文件顶层已 import generateSpec，故**不能**用「import 缺席」做断言。改为 spy `generateSpec` 及 enrichment / hyperedge 调用入口，在小型 fixture 上跑 `buildAstGraphOnly` 后断言调用次数 = 0。优先**不 mock** AST 层（真跑 tree-sitter），仅 spy LLM 边界。
- **SC-003(b) 结构一致性（W-003：收窄断言防脆）**：同一 fixture 下，`buildAstGraphOnly` 产物与（mock 掉 LLM 的）batch 路径产物对比——**只比规范化后的 `calls`/`depends-on` edge 三元组集合 + Python 符号 component 节点 id/kind 子集**；剥除 `generatedAt`/`sources`/`skippedSources`/community `degree` metadata/full 特有 anchor 语义边。断言 graph-only 子集 ⊆ batch 对应子集且 calls/depends-on 等价。
- **SC-003(b2) byte 稳定（W-002）**：连跑两次 graph-only，断言 graph.json 逐字节相等。
- **SC-003(b3) 三语言矩阵（EC-002/W-007）**：参数化「仅 .py」「仅 .ts」「混合」三 fixture，断言对应语言节点/边存在、无另一语言污染。
- **SC-003(c) 帮助文本**：断言 HELP_TEXT 含 `graph-only`、`纯 AST`、`零 LLM`。
- **SC-003(d) 无认证**：在无认证环境（清空 env + mock checkAuth 返回 false 场景）断言 graph-only CLI 路径**不调用 checkAuth 即继续**并产出图。
- **SC-003(e) 日志标识**：断言 graph-only 摘要 stdout 含「graph-only」「零 LLM」标识。
- **EC-001 空图**：空目录 fixture → 断言产出 nodes/links 为空数组的合法 graph.json，不抛错。
- **SC-002 portable 守卫**：断言产物绝对路径节点数 = 0（writeKnowledgeGraph 内 portable 守卫已保证；测试做回归断言）。
- **SC-004 三 mode 回归**：不改任何现有 batch/mode 测试；全量 vitest 验证它们仍通过。

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `collectTsJsCodeSkeletons` 在大仓慢 | 复用 batch 同款（已有 size guard / gitignore）；<2min 仅记录性基准非门禁 |
| writeKnowledgeGraph 内部假设 batch 上下文 | 已 verify 其只依赖 graphJson + outputDir，无 batch 隐式状态；F183 已内聚 |
| graph-only 产物缺 doc/IR 节点导致某 MCP 工具消费失败 | spec EC-004 已定位为子集；SC-002 仅承诺 graph_node/impact/graph_query（依赖 calls/depends-on，来自 unifiedGraph） |
| parse-args 双分支漏改一处 | 测试覆盖 `--mode graph-only` 与 `--mode=graph-only` 两种写法 |

## 6. 不做（YAGNI）

- 不做增量 graph-only（首次/全量重建即可）。
- 不注入 architectureIR / docGraph / crossRef（依赖 LLM 或 spec 产物）。
- 不新建可视化/报告产物。
- 不改 `runBatch` / `BatchMode` / 三现有 mode。
- **不给 MCP `batch` 工具加 graph-only schema**（W-001 follow-up）：MCP batch 直接调 runBatch，加 graph-only 属新功能面。本 Feature 仅做 MCP graph-not-built **恢复提示文案**更新（W-008），引导用户在 shell 跑 `spectra batch --mode graph-only`；MCP 原生触发 graph-only 列为后续 Feature 候选。
- **不扩展采集器扩展名集合**（`.mjs/.cjs/.mts/.cts`）：graph-only 继承 `collectTsJsCodeSkeletons` 既有口径以保持与 batch unifiedGraph 一致；扩展会改 batch 行为，超本 Feature 范围。
