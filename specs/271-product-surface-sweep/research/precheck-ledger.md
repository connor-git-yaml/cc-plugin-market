# F271 开工复核账（F248 纪律：任务描述事实可能已过时）

> 卡面 SSoT：`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §5 P1-E（critical 1 + warning 12 + info 6）。
> 本档由**主编排器亲自复核**，每条给「成立 / 部分成立 / 不成立」+ 当前精确路径行号 + 实证证据。
> 复核基线：`f7a65aa9`（= origin/master，无 behind）；活图 `specs/_meta/graph.json`（7641 nodes / 12985 links，2026-08-30 12:33 生成）。

---

## ① lineRange 死功能（卡面标 critical）

**判定：成立**（卡面行号已漂移，症状描述有一处失真需修正）

### 生产侧：确认零生产者

| 事实 | 证据 |
|---|---|
| 活图 7641 个节点中 `metadata.lineRange` 存在数 = **0** | 对 `specs/_meta/graph.json` 直接统计 |
| 活图 metadata key 全集仅 10 个：`callSitesCount, confidence, exportKind, memberKind, signature, sourceFile, sourcePath, sourceTag, symbolKind, unifiedKind` | 同上，无 `lineRange` |
| symbol 节点数 = **6319**（受益面） | `metadata.unifiedKind === 'symbol'` 计数 |

symbol 节点的唯一生产者是 `deriveNodesFromSkeletons`：

- `src/knowledge-graph/index.ts:230-260` — 每个 `ExportSymbol` 派生一个 symbol 节点，`metadata` 只写 `{ exportKind: exp.kind }`；member 节点只写 `{ memberKind: m.kind }`。**未写行号，尽管 `exp.startLine/endLine` 就在同一个循环变量上。**
- `src/panoramic/graph/graph-builder.ts:399-412` — UnifiedNode → GraphNode 的转换点，metadata 白名单式重建（`sourceTag/unifiedKind/sourcePath/callSitesCount/external/exportKind/memberKind`）。**即便上游写了 lineRange，这里不透传也会被丢弃** —— 生产链要改两处，缺一不可。

### 数据可得性：`ExportSymbol` 有 span，`MemberInfo` 没有

- `src/models/code-skeleton.ts:85-105` `ExportSymbolSchema`：`startLine: z.number().int().positive()`、`endLine` 同 —— **必填**，可直接用。
- `src/models/code-skeleton.ts:74-83` `MemberInfoSchema`：字段为 `name/kind/signature/jsDoc/visibility/isStatic/isAbstract` —— **没有任何行号字段**。

> 🔴 **卡面未提及的能力边界**：class member 级 symbol 节点（`file::Class.method`）**无法**从现有数据产出真实行号。用所属 class 的 span 兜底会给出**错误**的行号（指向 class 头而非 method）。按 Constitution 原则 IV（诚实标注不确定性）与 F266 教训（做不出来的要诚实缺席），member 节点应**不产出** `lineRange` 字段，而不是填一个近似值。这必须写进 spec 的 FR 与验收，否则实现者会顺手兜底。

### 消费侧：两处只读，字段形状是 `{start, end}` 而非 `{startLine, endLine}`

- `src/mcp/file-nav-tools.ts:107-108`（`nodeToRange`）：`md['lineRange'] as { start?: number; end?: number }` → 返回 `{file, start, end}`。
- `src/mcp/agent-context-tools.ts:473-477`（`buildDefinition`）：读到才写 `def.lineStart` / `def.lineEnd`。
  - ⚠️ 卡面写的 `agent-context-tools.ts:436` **已过时**，当前是 **473**（F265/F266 动过该文件）。

> 🔴 **生产端必须产出 `{ start, end }` 这个 key 名**。若照 `ExportSymbol` 原名写成 `{ startLine, endLine }`，两个消费点都会静默读到 `undefined`，功能依然是死的且不报错。

### 可观测症状（精确）

- `src/mcp/file-nav-tools.ts:243` `if (typeof sym.start === 'number') { ... }` —— 该分支**当前永不进入**。后果：
  1. `view_file` 传了 `symbolId` 也**不做任何行切片**，返回整个文件；大文件直接撞 `payload-too-large`（:265）。
  2. `symbolId-overrides-lines` warning（:245）是**永不触发的死代码**。
  3. `symbolId` 当前唯一实际作用是 `fileMismatch` 一致性校验（:174）与 fuzzy 解析 —— 沦为校验参数而非定位参数。
- `src/mcp/agent-context-tools.ts:475-476` —— `context.definition` 的 `lineStart`/`lineEnd` **从不出现在返回里**。

> ⚠️ **卡面表述失真一处**：卡面写 `view_file(symbolId)`，但 `path` 在 `ViewFileInputSchema`（`src/mcp/file-nav-tools.ts:81`）中是**必填**，且 `runFileNavTool` 会先校验 path 再进 body（:194-196）。所以不存在"只给 symbolId 的 view_file 调用"；修活后的正确表述是 `view_file(path, symbolId)` 首次能按 symbol 切片。

### 🔴 风险落点（卡面已点，此处定位到具体文件）

| 风险 | 落点 | 现状 |
|---|---|---|
| byte-stable 不得破 | `normalizeGraphForWrite`（`src/panoramic/graph/graph-builder.ts:814-846`）；写盘出口内聚在 :601-700，序为 ①portable 守卫 → ②归一化 → ③`writeAtomicJson` | 归一化只剥 `RUNTIME_NODE_METADATA_FIELDS = ['currentRun']`（:792）并排序 nodes/links/hyperedges，**不对 metadata 做 key 排序**。`lineRange` 来自 AST span，同输入恒定，不属易变字段 → 可安全持久化；但插入位置须固定，且需实测连跑两次 sha 相等 |
| 归一化剥除 | 同上 `VOLATILE_FIELD_NAMES`（:851） | `lineRange` 不在其中，不会被 `stripVolatileFields` 剥掉 ✓ |
| pinned fixture | `tests/fixtures/micrograd-baseline-graph/graph.json`（33 nodes / 28 sym / lineRange 0）、`tests/fixtures/graph-quality-{ts,java,go}-graph/graph.json` | 这些是测试的**输入** fixture（F215 解耦后 e2e 读它们当图），**不是**生产输出的断言基线 → 生产端改动不会让它们变红，但也意味着 e2e **测不到**新字段。要覆盖需按 F214/F215 约定再生。消费点：`tests/integration/{agent-context-real-graph,mcp-server-stdio,graph-quality-lang-matrix}.test.ts`、`tests/e2e/helpers/stdio-client.ts` |
| 第四路（Python extraction） | `src/adapters/python-adapter.ts:202` `extractSymbolNodes` | 本仓活图中 `sourceTag='extraction'` 仅 19 个且**全是 module 节点**（无 symbol）。该路是否能产 lineRange 需单独核；若不能，按诚实缺席处理 |

---

## ③ graph-not-built 恢复提示不一致 + `spectra index` 是死胡同

**判定：成立**（两个子项均实证）

### 死胡同实证

| 事实 | 证据 |
|---|---|
| MCP 读的图是 `specs/_meta/graph.json` | `src/panoramic/graph/graph-paths.ts:15-17` `resolveGraphJsonPath` = `path.join(cwd, 'specs', '_meta', 'graph.json')`；`src/mcp/graph-tools.ts:57,116` 调用它 |
| `spectra index` 写的是 `.spectra/unified-graph.json` | `src/cli/commands/index.ts:6,37,51` |
| 两者是**不同文件** → 照提示跑 `spectra index` **不能**解除 graph-not-built | 本 worktree 现状：`specs/_meta/graph.json` 存在（6.4 MB），`.spectra/` 目录**不存在** |

### 提示不一致（五处、三种措辞）

| 位置 | 措辞 |
|---|---|
| `src/mcp/server.ts:61`（MCP server instructions） | `spectra batch --mode graph-only`（**唯一正确且最优的**：纯 AST · 零 LLM · 无需认证 · <2min） |
| `src/mcp/file-nav-tools.ts:140` | 「请先运行 `spectra batch` 生成图谱」（可行但慢 + 需 LLM 认证） |
| `src/mcp/file-nav-tools.ts:133` | 「运行 `spectra index` 或 `spectra batch`」（前者死胡同） |
| `src/mcp/agent-context-tools.ts:143` | 同上（前者死胡同） |
| `src/panoramic/graph/graph-query.ts:225,235` | 「请运行 `spectra index` 或 `spectra batch` 在当前 worktree 重建图」（前者死胡同） |
| `src/cli/commands/graph-quality.ts:384` | 「运行 `spectra index` 或 `spectra batch`…重建图」（前者死胡同） |

> 注：`graph-format-stale`（旧绝对路径格式）与 `graph-not-built`（缺图）是两个不同错误码，但**恢复动作相同**（重建图），所以措辞应统一到同一条正确指引。

---

## ② graph_community 死工具

**判定：主线程侧实证支持"成立"，完整证据链见子代理复核结果**

| 事实 | 证据 |
|---|---|
| 活图 7641 节点中 `metadata.community` 存在数 = **0** | 直接统计 `specs/_meta/graph.json` |
| 工具入参 schema 自述数据源 | `src/mcp/graph-tools.ts:338`：`communityId: z.string().describe('社区 ID（来自 graph.json 中节点的 metadata.community 字段）')` |

→ 在一个跑完正常建图流程的仓库（本仓即是）里，`graph_community` 的数据源为空。裁决（修活 vs 下架）需要子代理给出的"谁写 metadata.community"的完整链路。

---

## ② graph_community（子代理复核补齐的完整链路）

**判定：成立**，但卡面症状描述有一处失真，且牵连面比卡面写的大。

### 生产者唯一，三条主流建图路径全不写

| 路径 | 写 `metadata.community`？ | 证据 |
|---|---|---|
| `spectra community` CLI | ✅ **唯一生产者** | `src/cli/commands/community.ts:91-98` 写 `node.metadata['community'] = String(communityId)`，:102 以 `builderProvenance: 'preserve-recorded'` 整份写回 |
| `spectra batch`（full） | ❌ | `src/batch/batch-orchestrator.ts:1488-1495` → `src/panoramic/community/index.ts:49-97`：`detectCommunities` 算出的 `nodeCommunityMap`（:58）只喂 `findGodNodes`/`findSurprisingEdges`，回写图的只有 `enrichNodeDegrees`（:66，只写 `metadata.degree`）。社区结果只进 `GRAPH_REPORT.md`（:92-95） |
| `spectra batch --mode graph-only` | ❌ | `src/batch/stages/graph-assembly.ts` 全文 0 处 community/GRAPH_REPORT。**MCP 文档推荐的恢复流正是这条**（`src/mcp/server.ts:61`） |
| `spectra graph` | ❌ | `src/cli/commands/graph.ts:185-300` 全文 0 处 community |
| `spectra index` | ❌ | 产物是另一套 artifact `.spectra/unified-graph.json` |

### 三处文档/自述失真（比卡面写的多）

1. **工具 description 写了确证为假的前置条件** — `src/mcp/graph-tools.ts:329` 写「需先运行 `spectra graph` 生成含社区信息的图谱」，但 `spectra graph` 实测**不写** community。:336 又写「典型链路：batch → graph_community」，`batch` 同样不写。
2. **README 示例的 ID 格式是错的** — 真实 community id 是数字字符串（`src/panoramic/community/community-detector.ts:24` `id: number`，:152 `id: idx`，经 `community.ts:96` `String()` → `"0"`/`"1"`），而 `README.md:136`、`skills/spectra-batch/SKILL.md:223`、`skills/spectra/SKILL.md:173` 及 plugins 镜像统一写 `"c-0"`。→ **即使用户跑过 `spectra community`，照文档抄参数仍 0 命中。**
3. **症状是静默空结果，不是报错**（修正卡面）— `graph-query.ts:748-756` 的 0 命中分支返回 **success**：`{"communityId":"c-0","nodes":[],"cohesion":null,"message":"社区不存在：c-0"}`。agent 被误导为"这个社区 ID 不存在"，而非"本图根本没有社区数据"。诊断方向被带偏。

### 同组另两个工具（卡面未提）

- `graph_god_nodes`：**不受影响**。度数由内存 adjacency 现算（`graph-query.ts:897-902`，排除 contains 边），不读 metadata。
- `graph_hyperedges`：**有同类问题，根因不同**。读 `graph.hyperedges`（`graph-query.ts:809`），该字段只在 `batch-orchestrator.ts:1443` 写，且需 `effectiveMode === 'full'`（:1322）**且**显式 opt-in `--hyperedges` / `SPECTRA_HYPEREDGES_ENABLED=true`（:1326）**且**有 projectDocs。本仓 graph.json 无 `hyperedges` 键，返回 `{"hyperedges":[],"total":0,"filtered":false}`。→ 同属"文档承诺 vs 实际可得"缺口，宜同卡一并诚实化。
- `specs/_meta/` 下**无 `GRAPH_REPORT.md`**（只有 graph.json + graph-bootstrap-status.json）→ `cohesion` 也走降级（`graph-query.ts:789`）。

---

## ④ README MCP 示例参数名与 schema 不符 + zod 静默剥离

**判定：成立**（2 处不符，剥离机制已核实到 SDK 层）

| README | 写法 | 实际 schema | schema 位置 |
|---|---|---|---|
| `README.md:137` | `graph_god_nodes({ topK: 10 })` | `limit` | `src/mcp/graph-tools.ts:434-437` |
| `README.md:138` | `graph_hyperedges({ filter: "ingestion" })` | `label` / `node_id` | `src/mcp/graph-tools.ts:372-382` |

- `grep -rn "\.strict()" src/mcp/` **零命中** → 全部走 zod 默认 `strip`。链路：`server.tool(name, desc, rawShape, handler)` → SDK `normalizeObjectSchema` → `z.object(shape)`（`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:172-174`）。
- 危害分级：`topK` 写错只是静默回落默认值 10（结果仍合理）；**`filter` 写错则静默变成"不过滤"、返回全量超边** —— 返回值看起来合理但语义完全不同，更危险。
- 其余示例（`graph_query` / `graph_node` / `graph_path` / `graph_community` / `panoramic-query`）核对通过。

---

## ⑤ 退出码语义

**判定：数字不成立（不是 4 种，是 6-7 种）；「无成文语义表」成立**

`process.exit(2)` **零处**，全部是 `process.exitCode = 2`。按语义归并：

| # | 语义 | 位置 |
|---|---|---|
| 1 | LLM/API 错误 | `src/cli/utils/error-handler.ts:15` `API_ERROR: 2`，用于 :100 |
| 2 | **一切未分类错误的兜底**（名同实异） | `src/cli/utils/error-handler.ts:113` |
| 3 | 顶层未捕获致命错误 | `src/cli/index.ts:240` |
| 4 | `spectra index` 目标目录不存在 | `src/cli/commands/index.ts:101` — 🔴 **与 `prepare.ts:40`、`diff.ts:28/33` 同类「路径不存在」用 `TARGET_ERROR=1` 直接冲突** |
| 5 | `spectra index` 索引执行失败 | `src/cli/commands/index.ts:193`（全量）、:257（增量） |
| 6 | **成功但有残缺**（部分源失败） | `src/cli/commands/scaffold-kb.ts:251`，注释明写「部分源失败 → exit 2（信号，已落成功的部分，W-4）」 |
| 7 | `graph-quality` 判定 `cannot-assess` | `src/cli/commands/graph-quality.ts:870-873` — 🔴 同函数里 `fail-strong-invariant`（真失败）反而返回 **1**，与全局「1=目标错误 / 2=致命」约定**方向相反** |

**成文语义表确认不存在**：全仓只有 `src/cli/utils/error-handler.ts:10-17` 的代码级注释。`README.md`、`docs/spectra-cli-reference.md`、`plugins/spectra/README.md` 检索「退出码 / exit code」只命中两处无关内容；`spectra --help`（`src/cli/index.ts:48-79`）也无退出码章节。

---

## ⑥ `--output` vs `--out`

**判定：部分成立 — 不一致真实存在，但卡面写的 flag 名是错的**

全仓**不存在 `--out`**。真实冲突是 `--output`（文档）vs `--output-dir`（代码）：

- 代码只接受 `--output-dir`：`src/cli/utils/parse-args.ts:667-668`；export 分支（:656-685）整段只读 `--output-dir`/`--project-root`/`--format` 后 `return`，`--output` 从不被读取。消费端 `src/cli/commands/export.ts:77-79` 只读 `command.outputDir`。
- 内置 help **是对的**：`src/cli/index.ts:64`、`src/cli/commands/export.ts:20` 都写 `[--output-dir <dir>]`。
- **文档写错 4 处**：`docs/spectra-cli-reference.md:70, 73, 129, 145`。
- 后果与 ④ 同构：export 分支不校验未知 flag → 照文档敲**不报错**，`--output` 被无声忽略，产物落到默认目录 `{project-root}/specs/_meta/export/`（`export.ts:28`），用户以为写到了自己指定的目录。
- README 无 export 示例，不涉及。

---

## ⑦ CHANGELOG 停在 4.1.1

**判定：不成立 — 已被 4.5.0 发布（F265）修复，清单这条已过时**

`CHANGELOG.md:6` = `## [4.5.0] — 2026-08-30`（`:63` 是 4.4.0，`:167` 才是 4.1.1）；`contracts/release-contract.yaml:10`、`package.json:3`、`plugins/spectra/.claude-plugin/plugin.json:3` 四处一致为 `4.5.0`。

> 唯一残留：`contracts/release-contract.yaml:20` 的 `productMappingDescription` 仍以「Spectra v4.3.0（Feature 186 分发可靠性）」开头 —— 版本号同步了，描述文案的领头版本没跟上。

---

## ⑧ `plugins/spectra/README.md` 写「4 个工具」

**判定：成立，且偏差幅度是 4 vs 18**

- `plugins/spectra/README.md:17` — `### MCP Server（4 个工具）`，:21-27 表格只列 `prepare`/`generate`/`batch`/`diff`。
- 实际注册 **18 个**（逐点核对 `server.tool(`）：
  - `src/mcp/server.ts` 6：`prepare`:91、`generate`:143、`batch`:187、`diff`:277、`panoramic-query`:309、`server_build_info`:361
  - `src/mcp/agent-context-tools.ts` 3：`impact`:988、`context`:1007、`detect_changes`:1026
  - `src/mcp/file-nav-tools.ts` 3：`view_file`:371、`search_in_file`:390、`list_directory`:409
  - `src/mcp/graph-tools.ts` 6：`graph_query`:206、`graph_node`:250、`graph_path`:297、`graph_community`:328、`graph_hyperedges`:362、`graph_god_nodes`:420
- **差 14 个。这是本次复核中面向用户影响最大的一处** —— plugin README 是 marketplace 安装用户看到的第一份文档。
- 加重情节：`plugins/spectra/README.md:29`「以上工具在缺少 LLM 认证时均可运行」只覆盖那 4 个，真正无需认证的 12 个查询类工具在该文档中完全不存在。

---

## ⑨ Spec Drift 只在仓内 `scripts/`，不在 `spectra` CLI

**判定：成立，且比卡面更严重（对外部用户 100% 不可达）**

- 实现：`scripts/spec-drift-cli.mjs`（link/check/unlink）+ `scripts/lib/spec-drift-*.mjs` 七个文件。
- 暴露面只有 npm scripts：`package.json:36-38` `drift:link`/`drift:check`/`drift:unlink`，及经 `scripts/lib/repo-maintenance-core.mjs:362-363` 并入 `repo:check`。
- `src/cli/utils/parse-args.ts:8` 的 `subcommand` 联合类型不含 drift；`src/cli/index.ts:48-79` HELP_TEXT 也无。
- 🔴 **加重情节（卡面未提）**：`package.json:10-18` 的 `files` 只打包 `scripts/lifecycle-runner.cjs` —— `spec-drift-cli.mjs` 与 `scripts/lib/**` **都不在 npm 发布产物里**，外部用户即使想绕过 CLI 直调也调不到。
- 路线图已自认待办：`docs/design/milestone-M10-...md:96`。

---

## ⑩ MCP「17 工具」命名/参数词汇不统一

**判定：部分成立 —— 不统一属实，但「17」不准（是 18），且这个过时数字已扩散到 3 处对外文案**

- 数字失真扩散点：`README.md:70`（`**17 MCP tools** (6 graph + 3 agent-context + 3 file-navigation + 5 pipeline)` —— 括号内加总 17，但 pipeline 实为 6）、`README.md:84`、`docs/spectra-cli-reference.md:205`。
- **工具名风格**：18 个里 17 个单词或 snake_case，唯独 `panoramic-query`（`server.ts:309`）用 kebab-case。
- **参数词汇分歧**：
  1. *结果条数上限* 三种叫法：`budget`（`graph-tools.ts:219,268,343`；`agent-context-tools.ts:167,531`）/ `limit`（`graph-tools.ts:384,434`）/ `maxMatches`（`file-nav-tools.ts:291`）。前两者在**同一文件内**并存。
  2. *symbol/节点标识符* 五种叫法：`target`（`agent-context-tools.ts:163`）/ `symbolId`（`agent-context-tools.ts:324`、`file-nav-tools.ts:84`）/ `id`（`graph-tools.ts:259`）/ `node_id`（`graph-tools.ts:376`）/ `source`+`target`（`graph-tools.ts:306-307`）。
  3. *`target` 一词三重重载*：symbol id（`agent-context-tools.ts:163`）/ 路径终点节点 id（`graph-tools.ts:307`）/ 文件系统路径 `targetPath`（`server.ts:106,158`）。
  4. *大小写混用*：绝大多数 camelCase，唯 `node_id`（`graph-tools.ts:376`）是 snake_case，与同文件 :341 的 `communityId` 直接对撞。
  5. *`depth` 语义不一*：`graph_query`（:229）BFS 跳数 / `impact`（`agent-context-tools.ts:164`，max 20）BFS 跳数但上限不同 / `list_directory`（`file-nav-tools.ts:341`，上限 10）目录递归层数。

---

## ⑪ `prepare` 对不存在路径返回脱敏 internal-error

**判定：成立，可诊断信息 100% 丢失**

- 注册：`src/mcp/server.ts:89-137`，入参 schema 只有 `targetPath`(:106) 和 `deep`(:107)，**无任何存在性/越界校验**，直接 `await prepareContext(...)`（:112）。
- 抛点：`src/core/single-spec-orchestrator.ts:250` `fs.statSync(resolvedTarget)` 对不存在路径抛 `ENOENT ... stat '<绝对路径>'`；`prepareContext` 内**无 try/catch**。
- 脱敏点：`src/mcp/lib/telemetry.ts:134-142` —— `catch {}` 是**无绑定 catch**，err 引用都没取，直接 `buildErrorResponse('internal-error', \`${toolName} 内部错误\`)`（:140）。
- agent 可见的**全部**信息：`{"code":"internal-error","message":"prepare 内部错误"}`（`tool-response.ts:54`；`hint`/`context` 因调用方没传而整体缺席）。
- 「路径不存在」/「目录里无支持的源文件」（`single-spec-orchestrator.ts:261`）/「AST 分析崩了」/「读文件权限不足」**全部塌缩成同一个 code**。
- 🔴 **仓库已有更精确的错误码没用上**：`tool-response.ts:26-28` 的 `'file-not-found'` 与 `'path-outside-root'`（F171 为 file-nav 工具新增）。
- ⚠️ **现状被测试固化**：`tests/unit/mcp/response-contract.test.ts:157-163` 断言 `prepare({targetPath:'.'})` 的错误 `code === 'internal-error'`；同文件 :165-190 对 `generate`/`batch`/`diff` 有同样断言 —— 这是 **F177 的统一设计而非 prepare 独有疏漏**。改它属于**合同变更**，须在 spec 里显式论证，不能当普通 bugfix 顺手改。

---

## 复核中新发现的同类项（卡面未列，供 GATE_DESIGN 裁决是否纳入）

1. **`spectra export` 等早退分支对未知 flag 完全不校验** — `parse-args.ts:656-685`（export）、:620-652（graph-quality）、:449（community）、:483（graph）都只 `indexOf` 已知 flag，既不拒未知 flag 也不检测缺值。只有 scaffold-kb 三个新 op 有严格校验（`STRICT_SCAFFOLD_KB_OPS`，:239-243），且 :214-219 注释明确承认 build/serve/query/ingest「接受任意未知 flag」、收严被推迟。→ 这是 ④（MCP 侧 zod 不 strict）在 CLI 侧的**同模式镜像**。
2. **`graph-quality` 退出码方向与全局约定相反** — 见 ⑤ 第 7 条。
3. **`plugins/spectra/README.md:29` 认证说明只覆盖 4 个工具** — 见 ⑧。
4. **`parse-args.ts:977` 子命令白名单与 `CLICommand.subcommand` 联合类型（:8）不同步** — 白名单缺 `scaffold-kb`/`graph-quality`（靠早退分支绕过）。当前行为正确，但白名单已不是权威列表，新增子命令若忘记加早退分支就会撞「未知子命令」。
5. **`contracts/release-contract.yaml:20` 描述文案领头版本停在 v4.3.0** — 见 ⑦。
6. **`docs/spectra-cli-reference.md` 5 个子命令完全未收录** — `query`、`index`、`panoramic`、`direction-audit`、`mcp-server` 全部零命中，而 `parse-args.ts:512/770/320/582/751` 都有解析分支、`src/cli/index.ts:57/62/65-68/78` 的 help 也都列了 → **文档落后于内置 help**。
7. **`docs/spectra-cli-reference.md:86-90` scaffold-kb 缺 3 个 op** — 文档只列 `build`/`ingest`/`serve`/`query`，代码支持 7 个（`parse-args.ts:233-236` 含 `coverage-gap`/`version`/`status`，help :75-77 也已列出）。
8. **`graph_hyperedges` 文档承诺 vs 实际可得缺口** — 见 ② 同组小节。

---

## 追补复核（spec 初稿生成后、GATE_DESIGN 前，主编排器实证）

### 追补 1：Python extraction 第四路**能**产 lineRange（复核账 ① 的开放项闭环）

`src/adapters/python-adapter.ts:250-267`：符号循环的 `symbol` 就是 `ExportSymbol`（遍历 `skeleton.exports`），`startLine`/`endLine` 必填在手；该处已写 `metadata.symbolKind`/`signature`（:262-265），加 `lineRange` 零结构成本。→「不能则诚实缺席」分支不适用，第四路应与主路径一并产出。
合流细节：`graph-builder.ts:374-391` 已有节点补齐分支的 spread 会**保留** extraction 侧已写字段 ✓，但 unified 侧算出的 lineRange **不在补齐白名单**。→ 完整生产链是 **4 个写入点**（`knowledge-graph/index.ts:230-260`、`graph-builder.ts:399-412`、`graph-builder.ts:383-390`、`python-adapter.ts:262-265`），比初核的"两处"多两处。
验证盲区：本仓活图 `sourceTag='extraction'` 的 symbol 节点为 0 → 第四路须用 Python 外部语料（micrograd/nanoGPT）验证，恰与「外部语料 A/B 第二口径」要求重合。

### 追补 2：主编排器自己的两条前提被实证推翻（已修订进 spec）

1. **「裁决 C 触碰 `response-contract.test.ts` 合同」→ 错**。该测试 `:49-52` 整体 mock 掉 `prepareContext`、`:89` 设为必抛 `boom`、`:158` 传的 `'.'` 是存在路径。前置校验放行 `.` → mock reject → 兜底脱敏 → 断言原样绿。F177 不变量与前置校验**正交**，零合同变更。
2. **「`path-outside-root` 一并启用」→ 撤**。`prepare` 当前无任何根内边界（`single-spec-orchestrator.ts:239` 仅 `path.resolve`），加它是新增历史上不存在的限制 = 破坏性行为变更（原则 XIII），移入 Out of Scope 单独立卡评估。

> 方法论注记：F248 纪律对主编排器自己的中间结论同样适用——本卡开工至 spec 定稿共推翻**卡面 3 条 + 自己 2 条**前提，全部靠"对当前代码实读"而非引用链。

## 复核总账

| 类别 | 数量 | 条目 |
|---|---|---|
| 成立（原样） | 6 | ①③②④⑧⑨⑪ 中的 ①③②④⑧⑨⑪ → 实为 7 |
| 部分成立（数字/描述需修正） | 3 | ⑤（4→6-7 种）、⑥（`--out`→`--output-dir`）、⑩（17→18） |
| **不成立（已过时，跳过）** | 1 | ⑦ CHANGELOG（F265 已修至 4.5.0） |
| 卡面未提的新发现 | 8 | 见上节 |
| 卡面行号/描述失真 | 3 | `agent-context-tools.ts:436`→**473**；`view_file(symbolId)`→`path` 必填；graph_community「拿不到结果」→**静默 success 空结果** |

---

## 与并行卡的写入路径边界（禁碰清单，已核实存在）

- **F270（P0-A）禁区**：`plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`（`hooks.json`、`post-tool-use-format.sh`、`pre-tool-use-guard.sh`、`stop-fix-compliance-check.sh`、`stop-task-check.sh`、`worktree-lifecycle.sh`）
- **F272（P1-G）禁区**：`vitest.config.ts`、`.github/workflows/ci.yml`、tests 基建
  - ⚠️ 边界澄清：F272 管的是**测试基建**；本卡**为自己的改动新增/修改对应单测**不属于越界，但不得动 vitest 配置、CI 配置、或 F272 点名的腐烂资产（`src/panoramic/qa/__tests__`、`graph-mcp-snapshot` Layer B、`typecheck:tests` 接入、lang-matrix pinned 陈旧检查）。
- **本卡不入库**：`specs/src.spec.md`（排除）
