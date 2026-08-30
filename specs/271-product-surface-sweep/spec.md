
# Feature Specification: F271 产品表面一致性清扫

**Feature Branch**: `271-product-surface-sweep`
**Created**: 2026-08-31
**Status**: Draft
**Input**: F271 产品表面一致性清扫 —— lineRange 死功能修活 + 死工具/文档失真/退出码语义收口。卡面 SSoT 是 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §5 P1-E。
**证据基础**: `specs/271-product-surface-sweep/research/precheck-ledger.md`（主编排器逐条复核账，基线 `f7a65aa9`）。本规范每条 FR 均携带该账中的证据锚（`路径:行号`），不含任何该账未证实的事实。

---

## 复核不成立，跳过

以下卡面条目经复核**不成立**，本次不产出对应 FR，仅作记录：

### 卡面 ⑦「CHANGELOG 停在 4.1.1」

**判定：不成立** —— 已被 F265 修复至 4.5.0。证据：`CHANGELOG.md:6` = `## [4.5.0] — 2026-08-30`；`contracts/release-contract.yaml:10`、`package.json:3`、`plugins/spectra/.claude-plugin/plugin.json:3` 四处版本号一致为 4.5.0。

唯一残留的真实问题（并非"停版"而是"文案领头版本未同步"）已归并入本规范 User Story 6（见 FR-024）：`contracts/release-contract.yaml:20` 的 `productMappingDescription` 仍以「Spectra v4.3.0（Feature 186 分发可靠性）」开头。

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - lineRange 修活：symbol 级代码定位首次可用 (Priority: P1)

Agent 通过 `view_file(path, symbolId)` 或 `context` 工具查看某个函数/类的代码时，希望直接得到该 symbol 的精确起止行号，而不是整份文件或"无定位"。目前图谱中 7641 个节点无一携带行号信息，这条能力链路自建成以来从未真正工作过。

**Why this priority**：这是卡面标注的唯一 critical 项，受益面覆盖活图中全部 6319 个 symbol 节点；不修复会导致 `view_file` 大文件场景直接撞 `payload-too-large`，`context.definition` 永远缺失行号定位。

**Independent Test**：对一个已知 symbol（如某个具名导出函数）调用 `view_file(path, symbolId)`，验证返回内容仅为该 symbol 的代码片段而非整个文件；对同一 symbol 调用 `context`，验证 `definition.lineStart`/`definition.lineEnd` 首次出现且落在该 symbol 的真实源码范围内。

**Acceptance Scenarios**：

1. **Given** 一个 class 级或函数级 `ExportSymbol`（如某模块的具名导出函数），**When** 建图流程（`spectra batch --mode graph-only` 或 full）跑完，**Then** 对应 symbol 节点的 `metadata.lineRange` 字段存在，形状为 `{ start: number, end: number }`，且数值与该 symbol 在源文件中的真实起止行一致。
2. **Given** 一个 class member 级 symbol（`file::Class.method` 形态），**When** 建图流程跑完，**Then** 该节点的 `metadata` 中**不出现** `lineRange` 字段（因缺乏可靠行号来源，诚实缺席而非填入错误近似值）。
3. **Given** 图中已有 `lineRange` 的 symbol 节点，**When** 调用 `view_file(path, symbolId)`，**Then** 返回内容按该 symbol 的行区间切片，不再返回整份文件；`symbolId-overrides-lines` warning 分支可被真实触发（不再是死代码）。
4. **Given** 图中已有 `lineRange` 的 symbol 节点，**When** 调用 `context`，**Then** 返回结构中 `definition.lineStart`/`definition.lineEnd` 携带该 symbol 的真实行号。
5. **Given** 建图流程运行两次（相同输入、无源码改动），**When** 对比两次产出的 `specs/_meta/graph.json`，**Then** 两份文件的 sha256 完全一致（byte-stable 不被本次改动破坏）。

---

### User Story 2 - `prepare` 前置校验产出精确错误码 (Priority: P1)

用户对不存在的路径调用 `prepare` 工具时，希望得到"路径不存在"这类可诊断的明确信息，而不是被脱敏成千篇一律的 `internal-error`。

**Why this priority**：诊断信息 100% 丢失是当前实测事实，且 `prepare` 是最常用工具之一；引入前置校验成本低（仓库已有现成的精确错误码），收益直接。

**Independent Test**：对不存在的 `targetPath` 调用 `prepare`，验证返回的 `code` 为 `file-not-found` 而非 `internal-error`。

**Acceptance Scenarios**：

1. **Given** 一个不存在的绝对路径，**When** 调用 `prepare({ targetPath })`，**Then** 返回 `code: 'file-not-found'`（而非 `internal-error`），且 `message`/`hint` 中包含该路径信息。
2. **Given** 路径存在且合法，但 `prepareContext` 内部因未预期异常（如 AST 分析崩溃、权限不足）抛出，**When** 调用 `prepare`，**Then** 依旧返回脱敏后的 `internal-error`（`telemetry.ts:134-142` 的无绑定 catch 兜底保持不变，不做任何改动）。
3. **Given** 上述前置校验已生效，**When** 运行 `tests/unit/mcp/response-contract.test.ts`，**Then** 该文件既有断言不经修改全部通过；新增的 `file-not-found` 前置分支单元测试通过；`generate`/`batch`/`diff` 三个工具的同类断言保持原样不动。

---

### User Story 3 - graph_community / graph_hyperedges 诚实化 (Priority: P2)

Agent 调用 `graph_community` 查询某社区 ID 时，如果本图从未跑过 `spectra community`，应该被明确告知"本图没有社区划分数据"，而不是被误导为"你给的这个 ID 不存在"。`graph_hyperedges` 同理需要诚实说明三重前置条件缺一均导致空结果。

**Why this priority**：不下架、不修活（裁决 A，理由见下），但当前的误导性提示会让 agent 走错诊断方向，属于低成本高收益的文档/文案修正。

**裁决固化（不得在实现阶段重新论证）**：
- `graph_community` **不下架**（下架破坏向后兼容，该工具在跑过 `spectra community` 后确实可用）、**不修活**（让 batch/graph-only 回写社区数据会改变 graph.json 内容，与 User Story 1 的 lineRange 图产物改动叠加，byte-stable 风险面翻倍；且社区划分是启发式结果，持久化进图会引入新的确定性负担，与"诚实的图"主题相悖）。
- `graph_hyperedges` 走同样处置：诚实化返回 + 文档写清其需要 full mode **且** 显式 opt-in `--hyperedges`/`SPECTRA_HYPEREDGES_ENABLED=true` **且** 有 projectDocs 的三重前置。
- `graph_god_nodes` 不受影响、不动（度数由内存 adjacency 现算，不依赖 metadata）。

**Independent Test**：在一个从未跑过 `spectra community` 的仓库（本仓库当前状态即是）调用 `graph_community({ communityId: '0' })`，验证返回的 `message` 明确指出"本图未包含社区划分数据（未运行 spectra community）"而非"社区不存在"；对照 README/SKILL 文档中的示例 ID 与 `community-detector.ts` 实际生成的 ID 格式（数字字符串如 `"0"`）一致。

**Acceptance Scenarios**：

1. **Given** 一个图中 `metadata.community` 全为空的仓库，**When** 调用 `graph_community({ communityId: 'X' })`（任意 ID），**Then** 返回内容明确区分"图中无任何社区数据"与"给定 ID 未命中"两种情况，前者需说明如何获得社区数据（运行 `spectra community`）。
2. **Given** `src/mcp/graph-tools.ts:329` 的工具 description，**When** 阅读该描述，**Then** 不再包含确证为假的前置条件（"运行 `spectra graph` 生成含社区信息的图谱"），改为准确描述唯一生产者 `spectra community` CLI。
3. **Given** README.md:136、`skills/spectra-batch/SKILL.md:223`、`skills/spectra/SKILL.md:173` 及其 plugins 镜像文件中的示例，**When** 阅读示例参数，**Then** 社区 ID 示例格式改为与 `community-detector.ts:24,152` + `community.ts:96` 实际产出一致的数字字符串（如 `"0"`），不再使用不存在的 `"c-0"` 格式。
4. **Given** 一个未启用 hyperedges（缺 full mode / 缺 opt-in / 缺 projectDocs 三者之一）的仓库，**When** 调用 `graph_hyperedges`，**Then** 返回内容或工具 description 明确说明三重前置条件，不再让用户误以为空结果代表"无跨模块协作"。

---

### User Story 4 - graph-not-built 恢复提示统一 (Priority: P2)

Agent 在图未建成或格式过期时收到恢复提示，希望这条提示能真正解除问题；目前 5 处提示、3 种措辞，其中 3 处引导用户运行的 `spectra index` 生成的是完全不同的产物文件，跑了也没用。

**Why this priority**：死胡同指引会让 agent 在错误路径上浪费执行轮次，属于纯文档/提示文案修正，成本低。

**Independent Test**：在一个 `specs/_meta/graph.json` 不存在的仓库中触发 `graph-not-built`，检查各处提示文案是否统一指向 `spectra batch --mode graph-only`（唯一正确且最优路径：纯 AST、零 LLM、无需认证、<2min）。

**Acceptance Scenarios**：

1. **Given** `src/mcp/file-nav-tools.ts:133`、`src/mcp/agent-context-tools.ts:143`、`src/panoramic/graph/graph-query.ts:225,235`、`src/cli/commands/graph-quality.ts:384` 五处提示文案，**When** 阅读修改后的文案，**Then** 均不再提及 `spectra index` 作为恢复图谱的手段，统一指向 `spectra batch --mode graph-only`（`graph-format-stale` 与 `graph-not-built` 两种错误码的恢复动作相同，措辞统一）。
2. **Given** `spectra index` 命令本身，**When** 阅读其 CLI help / 文档，**Then** 不做行为改动（该命令仍写 `.spectra/unified-graph.json`，只是不再被误引导为"建图恢复手段"）。

---

### User Story 5 - `plugins/spectra/README.md` 工具清单纠偏 (Priority: P2)

Marketplace 安装用户打开 `plugins/spectra/README.md` 看到的是"4 个工具"，但实际注册了 18 个，其中 12 个无需 LLM 认证即可使用的查询类工具在该文档中完全不存在。

**Why this priority**：该文档是安装用户看到的第一份文档，偏差幅度 4 vs 18，是本次复核中面向用户影响最大的一处。

**Independent Test**：对照 `src/mcp/server.ts`、`agent-context-tools.ts`、`file-nav-tools.ts`、`graph-tools.ts` 中全部 `server.tool(` 注册点（18 个），逐一核对 README 表格是否完整覆盖。

**Acceptance Scenarios**：

1. **Given** `plugins/spectra/README.md:17-27`，**When** 阅读修改后的内容，**Then** 标题与表格覆盖全部 18 个工具：`prepare`/`generate`/`batch`/`diff`/`panoramic-query`/`server_build_info`（server.ts）、`impact`/`context`/`detect_changes`（agent-context-tools.ts）、`view_file`/`search_in_file`/`list_directory`（file-nav-tools.ts）、`graph_query`/`graph_node`/`graph_path`/`graph_community`/`graph_hyperedges`/`graph_god_nodes`（graph-tools.ts）。
2. **Given** `plugins/spectra/README.md:29` 的认证说明，**When** 阅读修改后的内容，**Then** 准确标注哪些工具无需 LLM 认证即可运行（12 个查询类工具），不再只覆盖原有 4 个。

---

### User Story 6 - 文档/参数/退出码一致性收口（低成本批量修正） (Priority: P3)

本组归并卡面 ④⑤⑥ 及可零边际成本纳入的同源新发现项，均为文档文案或单点代码修正，不改变现有工具行为契约（`--output-dir` 除外的其余项均为纯文档）。

**Why this priority**：均为独立的小成本修正，价值在于消除"照文档操作却不生效或产生误导结果"的用户体验缺口。

**Independent Test**：逐项对照修改前后的文档内容与代码行为。

**Acceptance Scenarios**：

1. **Given** `README.md:137-138` 的 MCP 调用示例，**When** 阅读修改后内容，**Then** `graph_god_nodes` 示例参数名改为 `limit`（而非 `topK`），`graph_hyperedges` 示例参数名改为 `label`/`node_id`（而非 `filter`）。
2. **Given** 全仓退出码使用点，**When** 阅读新增的成文退出码语义表，**Then** 该表列出全部 6-7 种语义分类（LLM/API 错误、未分类错误兜底、顶层致命错误、目标路径错误、索引执行失败、成功但有残缺、`graph-quality` 的 `cannot-assess`），且明确标注 `graph-quality.ts:870-873` 的 1/2 方向反转为**已知例外**（不修改，理由：独立语义域 + 已被 F266 测试固化）。
3. **Given** `src/cli/commands/index.ts:101`（目标目录不存在场景当前用 `exitCode = 2`），**When** 修改后运行 `spectra index` 指向不存在的目标目录，**Then** 退出码为 `1`（`TARGET_ERROR`），与 `prepare.ts:40`、`diff.ts:28,33` 同类"路径不存在"场景一致。
4. **Given** `docs/spectra-cli-reference.md:70,73,129,145` 中的 `--output` 写法，**When** 阅读修改后内容，**Then** 全部改为代码实际接受的 `--output-dir`（不新增未知 flag 校验，仅修正文档）。
5. **Given** `docs/spectra-cli-reference.md` 当前缺失 `query`/`index`/`panoramic`/`direction-audit`/`mcp-server` 五个子命令的说明，**When** 阅读修改后内容，**Then** 该文档补齐这五个子命令的基本用法说明（与 `src/cli/index.ts` 内置 help 文本对齐）。
6. **Given** `docs/spectra-cli-reference.md:86-90` 关于 `scaffold-kb` 仅列出 `build`/`ingest`/`serve`/`query` 四个 op，**When** 阅读修改后内容，**Then** 补齐代码实际支持的另外三个 op：`coverage-gap`/`version`/`status`。
7. **Given** `README.md:70,84` 与 `docs/spectra-cli-reference.md:205` 中的 `17 MCP tools` 表述，**When** 阅读修改后内容，**Then** 数字更正为 18，且括号内分组加总（6 graph + 3 agent-context + 3 file-navigation + 6 pipeline）与实际一致。
8. **Given** `contracts/release-contract.yaml:20` 的 `productMappingDescription` 领头版本号仍写"Spectra v4.3.0（Feature 186 分发可靠性）"，**When** 阅读修改后内容，**Then** 领头版本号更新为与当前实际发布版本（4.5.0）一致的表述。

---

### Edge Cases

- **class member 级 symbol 缺行号来源**：`MemberInfoSchema`（`src/models/code-skeleton.ts:74-83`）没有任何行号字段。系统 MUST 对 member 节点不产出 `lineRange`（诚实缺席），MUST NOT 用所属 class 的 span 兜底填入（会指向 class 头而非 method 体，产生错误定位）。对应 FR-002。
- **lineRange 字段 key 命名陷阱**：生产端若照 `ExportSymbol` 原始字段名写成 `{ startLine, endLine }`，两个消费点（`file-nav-tools.ts:107-108`、`agent-context-tools.ts:473`）都读 `.start`/`.end`，会静默读到 `undefined`，功能依然是死的且不会报错。系统 MUST 产出 `{ start, end }` 这个 key 形状。对应 FR-003。
- **lineRange 生产链 4 个写入点缺一不可**：完整链路共 4 处，任一遗漏都会导致部分或全部 symbol 节点的 `lineRange` 被静默丢弃：(1) `src/knowledge-graph/index.ts:230-260`（主路径 UnifiedNode 生产，写入 `metadata.lineRange`）；(2) `src/panoramic/graph/graph-builder.ts:399-412`（新节点构造分支，白名单式 metadata 转换，不透传则丢弃）；(3) `graph-builder.ts:383-390`（已有节点补齐分支——白名单同样是 spread 式，extraction 侧已写的字段经 `...existing.metadata` 保留，但 unified 侧算出的 `lineRange` 不在补齐白名单里，不加就丢）；(4) `src/adapters/python-adapter.ts:262-265`（Python extraction 第四路，循环变量即 `ExportSymbol`，`startLine`/`endLine` 必填可用，与主路径同等零结构成本）。系统 MUST 同时改动全部 4 处。对应 FR-001/FR-004/FR-005。
- **Python extraction 第四路验证盲区**：`src/adapters/python-adapter.ts:250-267` 的 `extractSymbolNodes` 已核实**能**可靠产出行号——循环变量 `symbol` 即遍历 `skeleton.exports` 得到的 `ExportSymbol`，`symbol.startLine`/`endLine` 必填可用，该处已在写 `metadata.symbolKind`/`signature`（:262-265），加 `lineRange` 是同一处零结构成本改动。风险点从"能力未知"转为"验证盲区"：本仓活图中 `sourceTag='extraction'` 的 symbol 节点为 0（该路径当前仅产出 19 个 module 节点），本仓自测无法覆盖第四路的行为。系统 MUST 用 Python 外部语料（`karpathy/micrograd` 或 `karpathy/nanoGPT` baseline）验证第四路产出，这与卡面要求的"图解析类改动验收须带外部语料 A/B"口径重合，一次跑批可同时满足两项验收。对应 FR-005。
- **byte-stable 回归**：`lineRange` 来自 AST span、同输入恒定，理论上不影响 `normalizeGraphForWrite`（`graph-builder.ts:814-846`）的确定性，但该字段不在 `VOLATILE_FIELD_NAMES`（:851）剔除清单中会被保留写入。MUST 通过连跑两次建图对比 `graph.json` sha256 相等来验证，不能仅凭理论推断。对应 SC-001。
- **graph_community 静默空结果被误诊为"ID 不存在"**：0 命中分支当前返回 `success` 而非错误（`graph-query.ts:748-756`），message 写"社区不存在：c-0"。系统 MUST 区分"图中完全无社区数据"与"给定 ID 未命中现有社区集合"两种情况，前者需给出获取数据的操作指引。对应 FR-008。
- **pinned e2e fixture 无法覆盖新字段**：`tests/fixtures/micrograd-baseline-graph/graph.json` 等 pinned fixture 是测试的输入而非生产输出断言基线，生产端改动不会让它们变红，但也意味着 lineRange 相关 e2e 断言无法通过现有 pinned fixture 验证。是否按 F214/F215 约定重新生成 fixture 以获得端到端覆盖，留待 plan 阶段决定（见 Open Questions）。
- **response-contract.test.ts 的 prepare 用例对前置校验透明**：该文件整体 mock 掉 orchestrator（:49-52）且 `beforeEach` 令 `prepareContext` 必抛（:89），测试传入的 `targetPath: '.'`（:158）是存在路径，因此新增的 `file-not-found` 前置校验对其透明（`.` 存在→放行→调用 mock→reject→仍落 `internal-error` 兜底）。系统 MUST NOT 以任何理由修改该文件既有断言（含 :157-163 的 prepare 用例及 :165-190 的 generate/batch/diff 用例）；F177"未预期异常仍脱敏"不变量与前置校验正交。对应 FR-017。
- **exit code 语义表与 graph-quality 反向例外共存**：新增语义表 MUST 如实标注 `graph-quality.ts:870-873` 的方向反转为已知例外并说明不修改的理由，不能把它悄悄"统一"掉（该行为已被 F266 测试固化，属独立语义域）。对应 FR-014。

---

## Requirements *(mandatory)*

### Functional Requirements

**User Story 1 — lineRange**

- **FR-001**: 系统 MUST 在 `src/knowledge-graph/index.ts:230-260` 的 `deriveNodesFromSkeletons` 中，为每个具备 `startLine`/`endLine` 的 `ExportSymbol`（`src/models/code-skeleton.ts:85-105`，字段必填）派生的 symbol 节点写入 `metadata.lineRange = { start, end }`。**[必须]**——去掉则 lineRange 无生产源，核心需求无法实现。
- **FR-002**: 系统 MUST NOT 为 class member 级 symbol 节点（数据源 `MemberInfoSchema`，`code-skeleton.ts:74-83`，无行号字段）产出 `lineRange` 字段，MUST NOT 用所属 class 的 span 兜底填入近似值。**[必须]**——违反会产出错误定位，属诚实性红线（对应 Constitution 原则 IV）。
- **FR-003**: 系统产出的 `lineRange` 字段形状 MUST 为 `{ start: number, end: number }`，与消费端 `file-nav-tools.ts:107-108`、`agent-context-tools.ts:473` 已读取的 key 名一致，不得使用 `{ startLine, endLine }` 等其他命名。**[必须]**——key 名不符则功能依旧死而不报错。
- **FR-004**: 系统 MUST 在 `src/panoramic/graph/graph-builder.ts` 的两个 UnifiedNode→GraphNode metadata 转换分支中新增对 `lineRange` 字段的透传：(1) `:399-412` 新节点构造分支；(2) `:383-390` 已有节点补齐分支（该分支同为白名单式 spread，extraction 侧已写字段经 `...existing.metadata` 保留，但 unified 侧算出的 `lineRange` 不在补齐白名单里，遗漏会静默丢弃）。任一分支遗漏都会导致上游写入的值被丢弃。**[必须]**——生产链缺一不可。
- **FR-005**: 系统 MUST 在 `src/adapters/python-adapter.ts:262-265` 的 `extractSymbolNodes`（第四路，循环变量即 `ExportSymbol`）中，按 FR-001 同等标准产出 `metadata.lineRange`——经核实 `startLine`/`endLine` 必填可用，与主路径同为零结构成本改动，不适用"诚实缺席"分支。验收 MUST 依赖 Python 外部语料（`karpathy/micrograd`/`karpathy/nanoGPT` baseline）验证，因本仓活图无法覆盖该路径（`sourceTag='extraction'` 的 symbol 节点数为 0）。**[必须]**——不产出会造成"同为 symbol 节点、TS/JS 有行号而 Python 没有"的不一致面，且已证实数据源具备、无核实障碍。
- **FR-006**: 系统 MUST 保证建图产物 `specs/_meta/graph.json` 在相同输入下连续两次生成的内容 byte-stable（sha256 相等），即 FR-001/FR-004 引入的字段不破坏现有归一化（`graph-builder.ts:814-846`）确定性。**[必须]**——byte-stable 是既有不变量，回归会波及所有下游消费方。
- **FR-007**: 系统 MUST 使 `src/mcp/file-nav-tools.ts:243` 的 `typeof sym.start === 'number'` 分支在存在 `lineRange` 的 symbol 上被真实触发，使 `view_file(path, symbolId)` 按行区间切片返回内容，不再返回整份文件。**[必须]**——这是本 User Story 的最终用户可观测效果。

**User Story 3 — graph_community / graph_hyperedges 诚实化**

- **FR-008**: 系统 MUST 使 `graph_community` 在图中不存在任何 `metadata.community` 数据时，返回内容明确区分"图中完全无社区数据"与"给定 ID 未命中"两种情况，前者需说明获取路径（运行 `spectra community`）。**[必须]**——当前静默 success 会误导诊断方向，这是本 User Story 的核心价值。
- **FR-009**: 系统 MUST 修正 `src/mcp/graph-tools.ts:329` 工具 description 中确证为假的前置条件表述（"运行 `spectra graph` 生成含社区信息的图谱"），改为准确描述唯一生产者是 `spectra community` CLI（`src/cli/commands/community.ts:91-98,102`）。**[必须]**——虚假前置条件会让用户按文档操作后依然 0 命中。
- **FR-010**: 系统 MUST 修正 README.md:136、`skills/spectra-batch/SKILL.md:223`、`skills/spectra/SKILL.md:173` 及其 plugins 镜像中的社区 ID 示例格式，由不存在的 `"c-0"` 改为与 `community-detector.ts:24,152` + `community.ts:96` 实际产出一致的数字字符串（如 `"0"`）。**[必须]**——即使用户已跑过 `spectra community`，照错误文档抄参数仍会 0 命中。
- **FR-011**: 系统 MUST 为 `graph_hyperedges` 补充说明其三重前置条件（full mode **且** 显式 opt-in `--hyperedges`/`SPECTRA_HYPEREDGES_ENABLED=true` **且** 有 projectDocs），并在空结果场景给出诚实提示，不再让空数组被误读为"无跨模块协作"。**[必须]**——与 graph_community 同构问题，同卡一并处理成本更低。
- **FR-012**: `graph_god_nodes` 保持不动，不产出任何变更 FR（度数由内存 adjacency 现算，不依赖 `metadata.community`）。**[必须（保持现状）]**——变更会引入无必要的风险面。

**User Story 4 — graph-not-built 恢复提示统一**

- **FR-013**: 系统 MUST 统一 `src/mcp/file-nav-tools.ts:133`、`src/mcp/agent-context-tools.ts:143`、`src/panoramic/graph/graph-query.ts:225,235`、`src/cli/commands/graph-quality.ts:384` 五处恢复提示文案，指向唯一正确且最优路径 `spectra batch --mode graph-only`，不再提及会导致死胡同的 `spectra index`。**[必须]**——死胡同指引会让 agent 在错误路径上浪费执行轮次。

**User Story 2 — prepare 前置校验**

- **FR-014**: 系统 MUST 在 `prepare` 工具调用 `prepareContext` 之前，对 `targetPath` 做存在性校验，命中不存在时返回 `tool-response.ts:26-28` 已定义的 `file-not-found` 错误码，而非塌缩进 `internal-error`。系统 MUST NOT 新增越界校验（`path-outside-root`）——`prepare` 当前无任何根内边界约束（`single-spec-orchestrator.ts:239` 仅 `path.resolve`，`server.ts:106` schema 仅 `targetPath: z.string()`），新增等于给现有能力施加历史上不存在的限制，属破坏性行为变更，需单独立卡评估（见 Out of Scope）。**[必须]**——诊断信息 100% 丢失是当前实测缺陷，修复成本低（复用现有错误码）；越界校验则相反，是范围外的新增限制。
- **FR-015**: 系统 MUST NOT 改动 `src/mcp/lib/telemetry.ts:134-142` 的无绑定 catch 兜底逻辑——该逻辑对未预期异常的脱敏是正确的安全设计，仅新增前置分支，不改变兜底行为。**[必须（保持现状）]**——防止安全设计被误伤。
- **FR-016**: 系统 MUST NOT 对 `generate`/`batch`/`diff` 三个工具做同类前置校验改动（本卡范围仅 `prepare`），保持 F177 统一设计现状。**[必须（保持现状）]**——避免范围蔓延，其余三个工具的合同变更需单独立项评估。
- **FR-017**: 系统 MUST NOT 修改 `tests/unit/mcp/response-contract.test.ts` 现有断言（含 :157-163 的 `prepare` 用例——经实证其 mock 结构与存在路径 `'.'` 使其在新增前置校验后继续通过；及 :165-190 对 `generate`/`batch`/`diff` 的断言）；系统 MUST 为 `file-not-found` 前置分支新增对应单元测试（覆盖"不存在路径返回 file-not-found"与"存在路径但 orchestrator 抛错仍返回 internal-error"两种场景）。**[必须]**——经实证前置校验与既有合同正交，不存在需要论证的合同变更，唯一动作是新增测试覆盖增量分支。

**User Story 5 — plugins/spectra/README.md 工具清单**

- **FR-018**: 系统 MUST 将 `plugins/spectra/README.md:17-27` 的工具表格从 4 个补全至全部 18 个已注册 MCP 工具（逐一列出 `server.tool(` 注册点：server.ts 6 个、agent-context-tools.ts 3 个、file-nav-tools.ts 3 个、graph-tools.ts 6 个）。**[必须]**——该文档是安装用户的第一触点，偏差幅度最大。
- **FR-019**: 系统 MUST 更新 `plugins/spectra/README.md:29` 的认证说明，准确标注全部 12 个无需 LLM 认证的查询类工具，不再只覆盖原有 4 个。**[必须]**——认证说明范围与工具清单必须同步扩展，否则用户仍会误以为查询类工具需要认证。

**User Story 6 — 文档/参数/退出码一致性收口**

- **FR-020**: 系统 MUST 修正 `README.md:137-138` 中 `graph_god_nodes`/`graph_hyperedges` 的示例参数名，分别改为实际 schema 定义的 `limit`（`graph-tools.ts:434-437`）与 `label`/`node_id`（`graph-tools.ts:372-382`）。**[必须]**——`filter` 参数名错误会静默变成"不过滤"，返回全量超边，属于比 `topK` 更危险的一类误导。
- **FR-021**: 系统 MUST 新增一份成文的退出码语义表（落点：`docs/spectra-cli-reference.md` 或独立文档，由 plan 阶段决定具体位置），覆盖当前 6-7 种语义分类（`error-handler.ts:15` API 错误、`:113` 未分类兜底、`cli/index.ts:240` 顶层致命错误、`index.ts:101` 目标错误、`index.ts:193,257` 索引执行失败、`scaffold-kb.ts:251` 成功但有残缺、`graph-quality.ts:870-873` 的 `cannot-assess`），并如实标注最后一项与全局"1=目标错误/2=致命"约定方向相反的**已知例外**及不修改的理由。**[必须]**——全仓当前只有代码注释，无成文语义表，用户/agent 无法预先判断退出码含义。
- **FR-022**: 系统 MUST 将 `src/cli/commands/index.ts:101`（`spectra index` 目标目录不存在场景）的退出码从 `2` 改为 `1`，与同类"路径不存在"场景（`prepare.ts:40`、`diff.ts:28,33` 的 `TARGET_ERROR=1`）保持一致。**[必须]**——这是唯一确证的同语义不同码冲突，其余退出码不做全局重排（避免打破用户既有脚本）。
- **FR-023**: 系统 MUST NOT 修改 `src/cli/commands/graph-quality.ts:870-873` 的退出码方向（该处已被 F266 测试固化，且属独立语义域），仅在 FR-021 的语义表中如实标注为已知例外。**[必须（保持现状）]**——防止范围蔓延到已固化行为。
- **FR-024**: 系统 MUST 修正 `docs/spectra-cli-reference.md:70,73,129,145` 中错误的 `--output` flag 写法，改为代码实际接受的 `--output-dir`（`parse-args.ts:667-668`、`export.ts:77-79,20`）。**[必须]**——照错误文档操作会导致产物静默落到默认目录而非用户指定目录。
- **FR-025**: 系统 SHOULD 在 `docs/spectra-cli-reference.md` 补齐当前完全未收录的 5 个子命令（`query`/`index`/`panoramic`/`direction-audit`/`mcp-server`）的基本用法说明，与内置 help（`src/cli/index.ts:48-79`）对齐。**[可选]**——文档完整性问题，不影响任何工具的功能正确性，可视 plan 阶段工作量酌情推迟。
- **FR-026**: 系统 SHOULD 在 `docs/spectra-cli-reference.md:86-90` 补齐 `scaffold-kb` 缺失的 3 个 op（`coverage-gap`/`version`/`status`），与代码实际支持范围（`parse-args.ts:233-236`）及内置 help（:75-77）对齐。**[可选]**——同上，文档完整性问题。
- **FR-027**: 系统 MUST 修正 `README.md:70,84`、`docs/spectra-cli-reference.md:205` 中 `17 MCP tools` 的错误计数与分组加总，更正为 18（分组：6 graph + 3 agent-context + 3 file-navigation + 6 pipeline）。**[必须]**——与 FR-018 同源事实，零边际成本一并修正。
- **FR-028**: 系统 MUST 更新 `contracts/release-contract.yaml:20` 的 `productMappingDescription` 领头版本号，由过时的"Spectra v4.3.0（Feature 186 分发可靠性）"更新为与当前实际发布版本（4.5.0）一致的表述。**[必须]**——版本号本身已同步（见"复核不成立"一节），仅描述文案未跟上，属零边际成本修正。

### Key Entities *(include if feature involves data)*

- **`GraphNode.metadata.lineRange`**（新增字段）：形状 `{ start: number, end: number }`，仅出现在具备可靠行号来源的 symbol 节点上（file/class 级 `ExportSymbol` 及经核实具备行号来源的 Python extraction 路径），class member 级节点及无法核实来源的路径上不出现该字段。
- **退出码语义表**（新增文档实体）：枚举 6-7 种退出码语义分类，每类附代码位置与语义描述，并标注已知例外。
- **MCP 工具错误码**（既有实体，扩展消费点）：`file-not-found`（`tool-response.ts:26-28`）从 file-nav 工具扩展到 `prepare` 工具的前置校验分支。

---

## 合同影响分析：`response-contract.test.ts`（经实证不触碰）

### 实证证据链

主编排器逐行核对 `tests/unit/mcp/response-contract.test.ts`：

1. 该文件整体 mock 掉 orchestrator：`:49-52` `vi.mock('../../../src/core/single-spec-orchestrator.js', ...)`。
2. `beforeEach` 把 `prepareContext` 设为必抛：`:89` `mocks.prepareContext.mockRejectedValue(new Error('boom'))`，注释 `:88` 明写"server 工具的 orchestrator 一律 reject → 顶层 internal-error"。
3. 测试传的 `targetPath: '.'`（`:158`）是**存在的路径**。

### 推演结论

加了 `file-not-found` 前置校验后：`.` 存在 → 前置校验放行 → 调用（被 mock 的）`prepareContext` → reject('boom') → 落 `telemetry.ts:134-142` 兜底 → 仍返回 `internal-error` → **测试原样保持绿**。该用例验证的是"orchestrator 抛未预期异常时仍脱敏"这一 F177 不变量，与真实文件系统状态无关。前置校验与该不变量**正交**，因此：

- F177 合同断言（:157-163 的 prepare 用例，及 :165-190 的 generate/batch/diff 用例）**全部原样保留、零修改**。
- `file-not-found` 前置分支须**新增**自己的单元测试：对不存在路径断言 `code === 'file-not-found'`；对存在路径但 orchestrator 抛错断言仍为 `internal-error`。新增测试写在同文件追加还是独立文件，由 plan 阶段决定。

---

## Open Questions（留待 plan 阶段回答）

1. **pinned e2e fixture 是否需要按 F214/F215 约定重新生成**：`tests/fixtures/micrograd-baseline-graph/graph.json` 等 pinned fixture 是测试输入而非生产输出断言基线，本次改动不会让相关 e2e 变红，但也无法通过这些 fixture 验证 `lineRange` 新字段。是否值得为此重新生成 fixture 以获得端到端覆盖，需 plan 阶段结合 F214/F215 的再生成本评估决定。
2. **退出码语义表落点**：新增的成文语义表放在 `docs/spectra-cli-reference.md` 新增章节，还是独立文档（如 `docs/spectra-exit-codes.md`），由 plan 阶段决定，不影响 FR 的内容要求。

---

## Out of Scope

以下内容明确不在本次改动范围内：

### 写入路径边界（硬约束）

- **禁碰 F270 路径**：`plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`（`hooks.json`、`post-tool-use-format.sh`、`pre-tool-use-guard.sh`、`stop-fix-compliance-check.sh`、`stop-task-check.sh`、`worktree-lifecycle.sh`）。
- **禁碰 F272 路径**：`vitest.config.ts`、`.github/workflows/ci.yml`，及 F272 点名的腐烂资产（`src/panoramic/qa/__tests__`、`graph-mcp-snapshot` Layer B、`typecheck:tests` 接入、lang-matrix pinned 陈旧检查）。为本卡自己的改动新增/修改对应单测**不属于**越界，但不得改动 vitest / CI 配置本身。
- **不入库**：`specs/src.spec.md`（排除）。

### 明确不纳入的复核发现项（独立成本较高，建议单独立卡）

- **`prepare` 的根内边界约束（`path-outside-root`）**：实证 `prepare` 当前对 `targetPath` 没有任何根内边界约束（`single-spec-orchestrator.ts:239` 仅 `path.resolve`，`server.ts:106` schema 仅 `targetPath: z.string()`）。给 `prepare` 加 `path-outside-root` 校验等于新增一条历史上不存在的限制——现有对仓外路径 prepare 的用法会开始报错，属破坏性行为变更（撞 Constitution 原则 XIII），且超出本卡"表面清扫"定位。需先评估现有用法（含 batch/CLI 侧对 `prepareContext` 的调用形态）后单独立卡，不在本卡内顺手收紧。
- **CLI 早退分支未知 flag 校验收严**（复核账新发现 #1）：`parse-args.ts:656-685`（export）、:620-652（graph-quality）、:449（community）、:483（graph）当前均不拒绝未知 flag、不检测缺值，是 ④（MCP 侧 zod 非 strict）在 CLI 侧的同模式镜像。涉及 6 个分支的行为变更，成本高于本卡其余纯文档修正，建议单独立卡；本卡仅修正对应文档文案（FR-024），不改代码校验逻辑。
- **MCP 参数命名统一**（复核账 ⑩ 除数字修正外的部分）：`budget`/`limit`/`maxMatches`（结果条数上限）、`target`/`symbolId`/`id`/`node_id`/`source+target`（symbol/节点标识符）、camelCase 与 snake_case 混用等命名不统一问题，涉及对既有 API 入参 schema 的重命名，属破坏向后兼容的变更，需要独立的迁移/废弃策略设计，不在本卡范围（本卡仅修正 FR-027 的数字类文档失真）。
- **`parse-args.ts:977` 子命令白名单与联合类型同步**（复核账新发现 #4）：当前行为正确（缺失的子命令靠早退分支绕过），属预防性硬化而非缺陷修复，建议归入 P1-K 积压项，不在本卡范围。
- **Spec Drift 从仓内 scripts 暴露为 `spectra` CLI 子命令**（卡面 ⑨）：这是**新增 CLI 能力**（需改 `parse-args.ts` 的 subcommand 联合类型、`cli/index.ts` help 文本、`package.json` `files` 打包清单），而非现有承诺与实现之间的表面失真修正——当前没有任何入库文档对外承诺"`spectra` CLI 内置 drift 检测"，因此不构成本卡"文档失真/死功能"范畴内的缺陷。该能力缺口已在 `docs/design/milestone-M10-...md:96` 的路线图中自认待办，建议按既有路线图节奏单独立卡评估是否及何时暴露。

---

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：本次改动不新增独立模块/组件，涉及对既有模块的定向修改：`knowledge-graph/index.ts`、`panoramic/graph/graph-builder.ts`、`adapters/python-adapter.ts`、`mcp/file-nav-tools.ts`、`mcp/agent-context-tools.ts`、`mcp/graph-tools.ts`、`mcp/server.ts`（prepare 注册处）、`cli/commands/index.ts`、以及若干纯文档文件。归入"组件"计数的代码模块约 8 个。
- **接口数量**：新增/变更接口点约 5 个 —— (1) `GraphNode.metadata.lineRange` 新字段（graph schema）；(2) `prepare` 工具错误响应契约变更（仅 `file-not-found`）；(3) `graph_community` 工具 description + 空结果响应文案变更；(4) `graph_hyperedges` 工具 description + 空结果响应文案变更；(5) `spectra index` 退出码语义变更（2→1）。经实证 `response-contract.test.ts` 无合同断言变更（详见"合同影响分析"节），不计入接口变更。
- **依赖新引入数**：0（不引入任何新外部依赖，复用仓库已有的 `tool-response.ts` 错误码）。
- **跨模块耦合**：是——`lineRange` 生产链横跨 3 个模块共 4 个写入点：`knowledge-graph/index.ts:230-260`（主路径）、`panoramic/graph/graph-builder.ts:399-412`（新节点构造）、`graph-builder.ts:383-390`（已有节点补齐）、`adapters/python-adapter.ts:262-265`（Python extraction 第四路），缺一不可（见 FR-001/FR-004/FR-005）。
- **复杂度信号**：均不存在——无递归结构变更、无状态机新增、无并发控制改动、无数据迁移（`lineRange` 是新增可选字段，非破坏性迁移）。
- **总体复杂度**：**MEDIUM**（组件数 8、接口数 5 均落在 MEDIUM 区间上沿附近，无复杂度信号，但存在跨模块耦合且写入点由 2 处修正为 4 处）。按判定规则综合评估仍为 MEDIUM，不构成 HIGH（无任何单一维度超阈值，也无 2+ 复杂度信号）。

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对同一份未改动源码连续两次运行建图流程（`spectra batch --mode graph-only` 或等价流程），产出的 `specs/_meta/graph.json` sha256 哈希完全一致（byte-stable 未被破坏）。
- **SC-002**: 对一个已知具名导出函数的 symbol，`view_file(path, symbolId)` 首次返回按行区间切片的代码片段（而非整份文件），且切片行数与该函数源码真实跨度一致；同一 symbol 的 `context` 调用中 `definition.lineStart`/`definition.lineEnd` 首次出现且数值正确。
- **SC-003**: 对一个从未运行过 `spectra community` 的图调用 `graph_community`，返回内容能让 agent 在不查阅源码的情况下区分"图中无社区数据"与"给定 ID 未命中"，并知道下一步该运行什么命令；`graph_hyperedges` 在三重前置条件缺失时的空结果同样附带诚实说明。
- **SC-004**: `prepare` 对不存在路径的调用返回 `file-not-found`（不再是 `internal-error`）；`tests/unit/mcp/response-contract.test.ts` 既有断言零修改全部通过；新增的 `file-not-found` 前置分支单元测试通过；全量单元测试零失败。
- **SC-005**: `plugins/spectra/README.md` 中列出的工具数量、名称与 `server.tool(` 实际注册点（18 个）逐一对应，无遗漏无多余。
- **SC-006**: 全仓检索"退出码"/"exit code"能命中一份成文语义表（此前只有代码注释）；`spectra index` 对不存在目标目录的退出码为 1（此前为 2）。
