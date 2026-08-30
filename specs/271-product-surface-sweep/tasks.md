# Tasks: F271 产品表面一致性清扫

**Input**: `specs/271-product-surface-sweep/plan.md`（含架构决策 1-4、Open Questions 裁决、验证策略）
**前置**: `spec.md`（28 FR、6 US、三项裁决已固化，不得重新论证）

## 硬约束（贯穿全部任务）

- **禁碰**：`plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`、`vitest.config.ts`、`.github/workflows/ci.yml`
- **不入库**：`specs/src.spec.md`
- **每个代码任务必须在同一提交内附带单测**（Constitution 提交前验证铁律），且**不得修改任何既有断言的期望值**——只新增 `it`/`describe`
- **提交用显式路径**：`git add <path1> <path2> ...`，**禁止** `git add -A`
- **审查档位升档**（Codex 配额暂停期）：凡触碰 `src/panoramic/graph/`、`src/knowledge-graph/`、`src/adapters/python-adapter.ts`（图解析类）或 `src/mcp/graph-tools.ts`/`graph-query.ts`/`agent-context-tools.ts` 的 MCP 返回面（图消费类）的任务，须走**异构对抗审查 ≥2 个切入角**（独立子代理 + 换视角，不给实现思路只给"证伪"任务），commit message 显式标注"Codex 审查暂停，异构档位缺席，已做 N 角异构复审"

---

## Phase 1（P1，代码）：User Story 1 — lineRange 修活

### T001 [US1] TS/JS 主路径生产 lineRange

- **目标文件**：`src/knowledge-graph/index.ts`（`deriveNodesFromSkeletons`，:230-260）
- **对应 FR**：FR-001、FR-002、FR-003
- **改动**：symbol 循环（`for (const exp of sk.exports)`）的 `metadata` 追加 `lineRange: { start: exp.startLine, end: exp.endLine }`；member 循环（`for (const m of exp.members)`）**不改动**，保持无 `lineRange`
- **同提交单测**：追加到 `tests/unit/knowledge-graph/module-derivation.test.ts` —— (a) 构造含具名导出函数的 skeleton fixture，断言产出 symbol 节点 `metadata.lineRange` 的 `start`/`end` 与 fixture 中的 `startLine`/`endLine` 完全一致；(b) 构造含 class + member 的 skeleton fixture，断言 member 节点 `'lineRange' in node.metadata` 为 `false`
- **验收口径**：单测通过；`re-export` 分支（已有 `continue`）不受影响
- **依赖**：无
- **验证层级**：Level 1（单元测试）
- **可并行**：与 T002 并行（不同文件）

### T002 [US1] Python 第四路生产 lineRange

- **目标文件**：`src/adapters/python-adapter.ts`（`extractSymbolNodes`，:262-265）
- **对应 FR**：FR-005
- **改动**：symbol 节点 `metadata` 追加 `lineRange: { start: symbol.startLine, end: symbol.endLine }`（与 `symbolKind`/`signature` 同级追加）
- **同提交单测**：追加到 `tests/adapters/python-adapter.test.ts` —— 构造含具名函数的 Python fixture，断言 `extractSymbolNodes` 产出节点的 `metadata.lineRange` 数值正确
- **验收口径**：单测通过
- **依赖**：无
- **验证层级**：Level 1
- **可并行**：与 T001 并行（不同文件）
- **审查档位**：升档（触碰 `python-adapter.ts`，图解析类）

### T003 [US1] graph-builder.ts 两条透传分支

- **目标文件**：`src/panoramic/graph/graph-builder.ts`（:360-372 提取区、:383-390 已有节点补齐分支、:399-412 新节点构造分支）
- **对应 FR**：FR-004
- **改动**：
  1. 在 :360-372 提取区新增 `lineRange` 变量提取（见 plan.md 决策 1③ 代码片段）
  2. :383-390 已有节点补齐分支的 `existing.metadata = {...}` 展开列表追加 `...(lineRange !== undefined ? { lineRange } : {})`
  3. :399-412 新节点构造分支的 `metadata: {...}` 追加同上
- **同提交单测**：追加到 `src/panoramic/graph/graph-builder.test.ts` —— 构造两个场景的 `UnifiedNode`（一个走"新节点"路径、一个走"已有节点补齐"路径，通过预置 `nodeMap` 已有同 id 节点触发），断言两种路径产出的 `GraphNode.metadata.lineRange` 均正确透传；另加一个负向用例：`ugNode.metadata` 无 `lineRange` 时，产出节点 `metadata` 不含 `lineRange` key（不得写入 `undefined` 占位）
- **验收口径**：单测通过；两条分支缺一均应被单测捕获（可先临时注释掉某一分支验证测试会失败，确认后恢复）
- **依赖**：无代码依赖，但**逻辑验证依赖 T001/T002 已产出上游数据**——建议顺序：先合入 T001+T002，再合入 T003，以便用真实数据链路核对（plan.md "为什么①②先于③④"）
- **验证层级**：Level 1
- **审查档位**：升档

### T004 [US1] 消费侧激活验证（不改动消费代码，仅补测试）

- **目标文件**：无源码改动；测试追加至 `tests/unit/mcp/file-nav-tools.test.ts`、`tests/unit/mcp/agent-context-tools.test.ts`
- **对应 FR**：FR-007
- **改动**：
  1. `file-nav-tools.test.ts` 新增用例：构造含 `metadata.lineRange` 的 graph fixture，调用 `handleViewFile({ path, symbolId })`，断言返回内容按行区间切片（`startLine`/`endLine` 等于 `lineRange` 数值），且 `symbolId-overrides-lines` warning 在同传 `startLine`/`endLine` 时被真实触发
  2. `agent-context-tools.test.ts` 新增用例：同一 fixture 调用 `context`，断言 `definition.lineStart`/`definition.lineEnd` 首次出现且数值正确
- **验收口径**：两个此前"死代码"分支（`file-nav-tools.ts:243`、`agent-context-tools.ts:475-476`）被单测真实触发通过
- **依赖**：T001、T002、T003 全部完成（否则 fixture 无法自然产出 `lineRange`，需手工构造 graph fixture 代替真实建图链路——两种方式均可，手工构造 fixture 时此任务可与 T001-T003 并行，仅需在 T003 合入后重跑确认真实链路一致）
- **验证层级**：Level 1

### T005 [US1] byte-stable 双跑验证（本仓自图）

- **目标文件**：无代码改动；产出验证记录
- **对应 FR**：FR-006、SC-001
- **执行**：见 plan.md"byte-stable 验证"命令序列（`npm run build` → 两次 `node dist/cli/index.js batch --mode graph-only` → sha256 比对）
- **验收口径**：两次 `specs/_meta/graph.json` sha256 完全一致
- **依赖**：T001-T003 全部合入并 build 完成
- **验证层级**：Level 2（手工命令验证，非 vitest）

### T006 [US1] 外部语料 A/B（micrograd，闭环 FR-005 验证盲区）

- **目标文件**：无代码改动；产出验证记录
- **对应 FR**：FR-005（验证盲区闭环）、仓库"图解析类改动验收须带外部语料 A/B"口径
- **执行**：见 plan.md"外部语料 A/B"命令序列
- **验收口径**：改动前后 `nodes.length`/`links.length` 零变化；改动后图中 `lineRange` 出现数 > 0
- **依赖**：T001-T003 全部合入并 build 完成；`~/.spectra-baselines/karpathy/micrograd` 已 clone
- **验证层级**：Level 2

---

## Phase 2（P1，代码）：User Story 2 — prepare 前置校验

### T007 [US2] prepare 存在性前置校验

- **目标文件**：`src/mcp/server.ts`（`prepare` 工具 handler，:109-138）
- **对应 FR**：FR-014、FR-015（不改）、FR-016（不改）、FR-017
- **改动**：在 `prepareContext` 调用前插入 `statSync` 存在性校验（见 plan.md 决策 4 代码片段），不存在时返回 `buildErrorResponse('file-not-found', ...)`
- **同提交单测**：追加到 `tests/unit/mcp/response-contract.test.ts`（紧邻既有 `it('prepare 顶层异常错误响应含 code（internal-error）')` 之后）—— 新增 1 个 `it`：`targetPath: join(emptyRoot, 'does-not-exist')` → `code === 'file-not-found'` 且 `message` 含该路径字符串
- **验收口径**：新测试通过；`response-contract.test.ts` 全部既有断言（含 :157-190）零修改、全部通过；`generate`/`batch`/`diff` 三个工具**不改动**
- **依赖**：无（与 Phase 1 完全独立，可并行）
- **验证层级**：Level 1
- **审查档位**：常规（不触碰图解析/图消费面）

---

## Phase 3（P2，代码 + 文档）：User Story 3 — graph_community / graph_hyperedges 诚实化

### T008 [US3] graph_community 诚实化

- **目标文件**：`src/panoramic/graph/graph-query.ts`（`getCommunity`，:741-757）
- **对应 FR**：FR-008
- **改动**：0 命中分支区分"图中完全无社区数据" vs "该 ID 未命中"（见 plan.md 决策 3 代码片段），**不改变返回结构**（仍 success、`nodes: []`、`cohesion: null`）
- **同提交单测**：新建 `tests/panoramic/graph-query-community-honesty.test.ts` —— 场景 A（图中零 `metadata.community`）message 含"未运行"；场景 B（图中有社区数据但查询 ID 未命中）message 含"未找到社区 ID"且不含"未运行"字样
- **验收口径**：单测通过；`tests/e2e/feature-180-graph-tools.e2e.test.ts:182-197`（T-003-7）不回归（仅断言结构，未断言 message 内容）
- **依赖**：无
- **验证层级**：Level 1
- **审查档位**：升档（图消费面）

### T009 [US3] graph_community description 修正 + graph_hyperedges 诚实化

- **目标文件**：`src/mcp/graph-tools.ts`（`graph_community` description :329、`graph_hyperedges` handler :389-415）
- **对应 FR**：FR-009、FR-011
- **改动**：
  1. FR-009：`graph_community` 工具 description 中"需先运行 spectra graph 生成含社区信息的图谱"改为准确描述"社区数据由 `spectra community` CLI 生成"
  2. FR-011：新增导出纯函数 `describeEmptyHyperedges(filtered: boolean): string`（三重前置条件说明），handler 内 `hyperedges.length === 0` 时把该函数结果写入 `message` 字段
- **同提交单测**：追加到 `tests/panoramic/graph-tools-v2.test.ts` —— 直接单测 `describeEmptyHyperedges(true)`/`describeEmptyHyperedges(false)` 两种输入的文案关键词（含"过滤条件"/含"full mode"及三前置条件）
- **验收口径**：单测通过；FR-012（`graph_god_nodes`）确认**不改动**（本任务不触碰该工具注册代码）
- **依赖**：无（与 T008 同文件不同函数，建议顺序执行避免并行编辑冲突，但无逻辑依赖）
- **验证层级**：Level 1
- **审查档位**：升档

### T010 [US3][P] README/SKILL 社区 ID 示例格式纠偏

- **目标文件**：`README.md:136`、`skills/spectra-batch/SKILL.md:223`、`skills/spectra/SKILL.md:173`、`src/skills-global/spectra-batch/SKILL.md:223`、`src/skills-global/spectra/SKILL.md:173`、`plugins/spectra/skills/spectra-batch/SKILL.md:223`、`plugins/spectra/skills/spectra/SKILL.md:173`
- **对应 FR**：FR-010
- **改动**：全部 7 处 `"c-0"` → `"0"`（与 `community-detector.ts:24,152` + `community.ts:96` 实际产出的数字字符串格式一致）
- **验收口径**：全仓 `grep -rn '"c-0"'` 命中数归零；`grep -rn 'communityId.*"0"'` 在上述 7 处均命中
- **依赖**：无
- **验证层级**：Level 0（纯文档）
- **可并行**：与 T008/T009 并行（不同文件）；**与 T014（README.md 其他行）同文件，需在 T014 之前或之后顺序执行，不可并行编辑同一文件**

---

## Phase 4（P2，代码）：User Story 4 — graph-not-built 恢复提示统一

### T011 [US4] 统一 5 处 graph-format-stale 恢复提示

- **目标文件**：`src/mcp/file-nav-tools.ts:133`、`src/mcp/agent-context-tools.ts:143`、`src/panoramic/graph/graph-query.ts:225,235`、`src/cli/commands/graph-quality.ts:384`
- **对应 FR**：FR-013
- **改动**：5 处提示文案统一去掉"运行 `spectra index` 或"，改为仅指向 `spectra batch --mode graph-only`（唯一正确且最优路径）
- **同提交单测**：新建 `tests/unit/mcp/graph-not-built-messaging.test.ts` —— 分别触发 5 处消息（复用各模块既有的可触发条件，如 legacy `#` symbol 节点、跨 worktree 绝对路径节点），断言消息**均不含** `'spectra index'` 子串，且**均含** `'graph-only'`
- **验收口径**：新测试通过；`spectra index` 命令本身行为不变（本任务只改提示文案，不改 `cli/commands/index.ts` 的功能逻辑，那是 T015 的范围）
- **依赖**：无（与 T008/T009 触碰 `graph-query.ts` 但不同函数区域，建议不与之并行执行同一文件）
- **验证层级**：Level 1
- **审查档位**：升档（触碰 `graph-query.ts`）

---

## Phase 5（P2，文档）：User Story 5 — plugins/spectra/README.md 工具清单

### T012 [US5][P] plugins/spectra/README.md 工具表补全

- **目标文件**：`plugins/spectra/README.md:17-29`
- **对应 FR**：FR-018、FR-019
- **改动**：工具表格从 4 个补全至 18 个（按 `server.tool(` 注册点分组：server.ts 6、agent-context-tools.ts 3、file-nav-tools.ts 3、graph-tools.ts 6）；认证说明从"以上 4 个工具"扩展为准确标注 12 个无需 LLM 认证的查询类工具
- **验收口径**：18 个工具名与 spec Acceptance Scenario 1 列出的名单逐一对应，无遗漏无多余
- **依赖**：无
- **验证层级**：Level 0
- **可并行**：与所有其他任务并行（独立文件）

---

## Phase 6（P3，文档为主，1 处代码）：User Story 6 — 文档/参数/退出码一致性收口

### T013 [US6] `spectra index` 退出码收口

- **目标文件**：`src/cli/commands/index.ts:101`
- **对应 FR**：FR-022
- **改动**：`process.exitCode = 2` → `process.exitCode = 1`（目标目录不存在场景，与 `prepare.ts:40`/`diff.ts:28,33` 的 `TARGET_ERROR=1` 对齐）
- **同提交单测**：追加到 `tests/integration/156-w2-spectra-index.test.ts` —— 新增用例：`projectRoot` 指向不存在目录，断言 `process.exitCode === 1`
- **验收口径**：新测试通过；:193/:257 的索引执行失败退出码（2）**不改动**
- **依赖**：无
- **验证层级**：Level 1

### T014 [US6] README.md（顶层）参数名 + 工具计数修正

- **目标文件**：`README.md:70,84,137-138`
- **对应 FR**：FR-020、FR-027（README 部分）
- **改动**：`graph_god_nodes` 示例 `topK` → `limit`；`graph_hyperedges` 示例 `filter` → `label`/`node_id`；`17 MCP tools` → `18 MCP tools`（分组加总同步改为 `6 graph + 3 agent-context + 3 file-navigation + 6 pipeline`）
- **验收口径**：全仓 `grep -rn '17 MCP tools'` 在 README.md 范围内归零
- **依赖**：**须在 T010 之后执行**（同文件不同行范围，避免并行编辑冲突）
- **验证层级**：Level 0

### T015 [US6] `docs/spectra-cli-reference.md` 综合修正

- **目标文件**：`docs/spectra-cli-reference.md`
- **对应 FR**：FR-021（新增 Exit Codes 章节，内容见 plan.md Q2 裁决表格）、FR-024（:70,73,129,145 `--output` → `--output-dir`）、FR-025（补齐 `query`/`index`/`panoramic`/`direction-audit`/`mcp-server` 五个子命令说明，SHOULD）、FR-026（`scaffold-kb` 补齐 `coverage-gap`/`version`/`status` 三个 op，SHOULD）、FR-027（:205 `17 MCP tools` → `18 MCP tools`）
- **验收口径**：全仓检索"退出码"/"Exit Code"命中该新章节；`grep -n '\-\-output '`（非 `--output-dir`）在该文档归零；五个子命令与 `scaffold-kb` 三个 op 的说明存在
- **依赖**：无（独立文件，可与 T010/T012/T014 并行，但因内容量大建议单独一次性完成，不与其他文档任务拆分同文件冲突）
- **验证层级**：Level 0

### T016 [US6][P] `contracts/release-contract.yaml` 版本文案修正

- **目标文件**：`contracts/release-contract.yaml:20`
- **对应 FR**：FR-028
- **改动**：`productMappingDescription` 领头版本号由"Spectra v4.3.0（Feature 186 分发可靠性）"更新为"Spectra v4.5.0（Feature 265 CI 治理收敛）"或等价的当前版本表述（具体措辞与 CHANGELOG.md:6 附近的 4.5.0 条目对齐）
- **验收口径**：`npm run release:check` 通过；`contracts/release-contract.yaml:10`（version 字段）与 `productMappingDescription` 领头版本号一致
- **依赖**：无
- **验证层级**：Level 0（但需跑 `npm run release:check` 确认 contract 格式合法）
- **可并行**：与所有其他任务并行

---

## 并行块总览

| 并行块 | 任务 | 说明 |
|---|---|---|
| Block A（Phase 1 起始） | T001、T002 | 不同文件，互不依赖 |
| Block B（Phase 1 后段） | T005、T006 | 均依赖 T001-T003 build 完成，二者互相独立可并行跑 |
| Block C（跨 Phase） | T007、T012、T016 | 与 lineRange 主链路完全独立的文件，可与 Phase 1 全程并行 |
| Block D（文档收口） | T015、T016 | 不同文件，可并行；T010/T014 因同触 README.md 须顺序（T010 → T014） |

**顺序约束提示**：T003 建议在 T001+T002 之后；T004 建议在 T003 之后重跑确认真实链路；T005/T006 依赖 T001-T003 全部合入 + build；T010 → T014（同文件 README.md）；T008/T009/T011 同触 `graph-query.ts` 但不同函数，建议不并行执行避免 diff 冲突。

---

## 最终任务：全量验证

### T017 全量验证（收尾，依赖以上全部任务）

- **执行命令**：
  ```bash
  npx vitest run
  npm run build
  npm run repo:check
  npm run release:check
  ```
  加上 plan.md 中的两项手工验证（若 T005/T006 尚未作为独立任务跑过，此处必须补跑）：
  - byte-stable 双跑 sha256 比对（SC-001）
  - micrograd 外部语料 A/B（节点/边零变化 + lineRange 出现数 > 0）
- **验收口径**：
  - `npx vitest run`：零失败（含本次新增的全部单测）
  - `npm run build`：零 TypeScript 错误
  - `npm run repo:check`：通过（含 skills 镜像一致性、release contract 同步等既有校验）
  - `npm run release:check`：通过（T016 版本文案改动不破坏 release contract 格式）
  - byte-stable：两次 `graph.json` sha256 相等
  - 外部语料 A/B：节点/边数量零变化，`lineRange` 出现数 > 0
- **依赖**：T001-T016 全部完成
- **验证层级**：Level 1 + Level 2 综合
