# F184 验证报告 — 子代理 MCP 触发率工程

**Feature**: 184-mcp-adoption-engineering
**Commit**: 已 rebase 到 master@3a169fb（含 F193 worktree graph bootstrap）；本地 3 commit：feat + verify-fix + rebase 适配

> **Rebase 记录（F193 已 ship 的交互）**：开发期 F193 从 in-flight 变为已 ship（d5c2ae4+3a169fb）。F193 改了 `resolveSymbolRange`（加 `graph-format-stale` try/catch）+ graph node id 相对化 + 加载期 stale 检测。rebase 冲突已手工合并：我的 fuzzy 逻辑（not-found 分支）与 F193 的 stale 处理（getCachedGraphData 包裹）在同一函数但关注点 disjoint。post-rebase 复测暴露 view-fuzzy E2E 因 copy 旧绝对格式 baseline graph 触发 F193 新 stale 检测，已改用 F193 的 `installRelativizedBaseline` helper 修复。全量复测 vitest 4342 pass / 0 failed。FR-008 deferred 的"F193 冲突"前提现已落地——graph_node fuzzy 后续 fix 可在 F193 已 ship 的干净基础上做。
**日期**: 2026-06-13
**Mode**: spec-driver-feature

---

## 运行环境与证据说明（Codex verify 审查回应）

⚠️ 本报告的 PASS 均以**本机实际运行**为证据，非纸面声称。运行环境关键前提（决定 stdio E2E 是否真跑而非 skip）：
- `dist/cli/index.js` **已构建**（`npm run build` 通过）→ 所有 `buildSkipCondition` 的 `existsSync(DIST_CLI)` 判定为真，e2e **不 skip**
- `~/.spectra-baselines/micrograd-output/.../graph.json` **存在** → `requireBaseline=true` 的 F180/F174/F184-view-fuzzy e2e **不 skip**
- 实测运行计数：全量 `npx vitest run` = **359 test files passed / 4 skipped**、**4300 tests passed / 16 skipped / 0 failed**；F184 新增 e2e（instructions 3 + view-fuzzy 2）在本次运行**实际执行并通过**（非 skip）
- ⚠️ **CI / 无 baseline 环境**：若 dist 未构建或 baseline 缺失，相关 e2e 会 skip——届时 FR-002 协议层 / F180 零回归的 e2e 证据降级，需以 unit 层证据 + 该环境的运行日志为准（unit 层不依赖 dist/baseline，恒执行）

## 验收门总览

| 门 | 结果 | 证据 |
|----|------|------|
| 全量 vitest | ✅ 4300 passed / 16 skipped / 20 todo / **0 failed** | `npx vitest run`（+37 新测，本机实跑） |
| 构建 | ✅ 0 TypeScript 错误 | `npm run build`（tsc） |
| repo:check | ✅ status=pass（57 项） | `npm run repo:check` |
| F180 stdio E2E 零回归 | ✅ listTools 17 工具名断言通过（本机实跑非 skip，见上节） | `npx vitest run tests/e2e/feature-180` 352 passed |
| F174 既有 fuzzy E2E | ✅ 零回归（本机实跑） | F174 全绿 |

---

## FR 逐条验收

| FR | 级别 | 结果 | 证据 |
|----|------|------|------|
| FR-001 响应 schema 向后兼容 | MUST | ✅ PASS | 成功响应仅 `warnings.length>0` 时写 warnings；错误新增只进 `context`（fuzzyMatches / fuzzyResolved 布尔）；instructions 在 server 初始化层不入工具响应。⚠️ **Codex verify 抓到并已修**：error.context 原回传 `resolvedFile: sym.file` 有绝对路径泄露风险（graph metadata sourceFile 实测可为绝对路径），违反 file-nav 脱敏红线 FR-014——已移除该字段只留 `fuzzyResolved` 布尔，补 `not.toHaveProperty('resolvedFile')` 断言 |
| FR-002 instructions 注入 | MUST | ✅ PASS | `server-instructions.test.ts`(5) + `feature-184-instructions.e2e.test.ts`(3) 经 `client.getInstructions()` 验证协议层传播 |
| FR-003 view_file 接入 resolveSymbolFuzzy | MUST | ✅ PASS | `view-file-fuzzy.test.ts`(5 分支) + `feature-184-view-file-fuzzy.e2e.test.ts`(2)；镜像 F174，不碰 graph-query.ts |
| FR-004 fuzzyMatches 结构与位置 | MUST | ✅ PASS | `context.fuzzyMatches` 完整 SymbolCandidate `{id,confidence,matchKind}`，top-3；E2E 断言三字段 |
| FR-005 server 5 工具 description 4 要素 | MUST | ✅ PASS | `description-completeness.test.ts` server 5：测试断言 4 要素结构 + ∈[100,500]。⚠️ **Example Output 字段名的准确性由人工 + Codex 审查核对**（已逐一对照 PrepareResult/BatchResult/DriftReport/QnA 真实 interface），**非该结构测试自动验证**——结构测试不做字段名 cross-check（见已知限制） |
| FR-006 工具名称不变 | MUST | ✅ PASS | F180 listTools 17 工具名断言零回归 |
| FR-007 graph 6 工具 description | SHOULD | ✅ PASS | `description-completeness.test.ts` graph 6：Use when + chained usage + ∈[100,500] |
| FR-008 graph_node fuzzy | MAY | ⏸️ **DEFERRED** | 见下方专节 |
| FR-009 任务→工具映射 | MAY | ✅ PASS | TOOL_GUIDE 含 impact/影响、context/定义、view_file/定位 映射；T001 断言 ≥2 映射线索 |
| FR-010 A/B 评测设施复用 | SHOULD | ⏳ 待用户确认成本后执行 | 见下方 A/B 节 |
| FR-011 现有测试套件零回归 | MUST | ✅ PASS | 见验收门总览 |

## SC 逐条验收

| SC | 结果 | 证据 |
|----|------|------|
| SC-001 view_file fuzzy auto-resolve | ✅ PASS | unit + E2E：path-suffix 0.9 唯一 → 成功 + warnings:fuzzy-resolved |
| SC-002 fuzzy 失败带候选 | ✅ PASS | unit('relu' 多候选) + E2E(裸名 'MLP' 0.85<0.9) → context.fuzzyMatches |
| SC-003 instructions 传播性有结论 | ⏳ 待 A/B | 协议层传播已证（E2E）；Task 子代理模型上下文传播待 A/B（EC-005） |
| SC-004 触发率方向性提升 | ⏳ 待 A/B | 见 A/B 节（最小规模只判方向性信号，确证留 F188） |
| SC-005 description 4 要素满格 | ✅ PASS | description-completeness.test.ts 全绿 |
| SC-006 全量测试零回归 | ✅ PASS | vitest 4300 / build / repo:check |
| SC-007 A/B 成本可控 | ⏳ 待 A/B | 跑批前列预估成本等用户确认 |

---

## FR-008 graph_node fuzzy — DEFERRED（不计入本 feature pass 判定）

**决议**：路径 B（延后）。主编排器主线程裁决。

**核心理由（按强度排序，Codex verify 审查后修订）**：
1. **语义不同类（主因，solid）**：`GraphQueryEngine.getNode`（graph-query.ts:492，已核实）的 `keyword` 是"label substring 匹配"（`n.label.toLowerCase().includes(kw)`），与 view_file 的 `symbolId` fuzzy resolve 根本不同类。"17 工具 symbol 入参语义单一化"目标针对的是 symbolId 入参，已由 FR-003（view_file）达成；对 graph_node 的 keyword 套 resolveSymbolFuzzy 是语义越界，非统一。真正自断的 context→view_file 链由 FR-003 修复；graph_node 用 substring 匹配从不自断。
2. **F193 冲突窗口 live（solid）**：`graph-query.ts` 正被 F193 修改，截至本 commit 仍未 ship 到 master，整个 F184 实现期冲突窗口开放；getNode 返回 `{node:null}`（非 error）的 not-found 语义也属 F193 所有的引擎层。
3. **MAY 级低价值（solid）**：graph_node fuzzy 是 MAY，view_file fuzzy 已交付实际破损的链路修复。

**❌ 已撤回的理由（Codex verify 纠正）**：原列"路径 A 会触动 `graph-mcp-snapshot.test.ts` 的 graph_node snapshot"**不成立**——该 snapshot（`graph-mcp-snapshot.test.ts:158`）是 `engine.getNode(...)` **引擎层**直测，不经 MCP handler；路径 A 在 handler 层做 fuzzy 预解析不会触动它。此理由作废，但不影响 path B 决议（上述 3 条核心理由独立成立）。

**两条 load-bearing claim（仍属实）**：(1) getNode 返回 `{node:null}` 非 error；(2) keyword 是 label substring 匹配。

**后续处理归属**：F193 ship 到 master 后，作为独立 fix 在 `src/mcp/graph-tools.ts` handler 层实现（仅对 `id` 参数 not-found 路径加 fuzzy 兜底，keyword substring 语义保持不变，不碰 graph-query.ts）。

**三处留痕**：plan.md（FR-008 路径决议节 + Codex 审查修订节）+ tasks.md（T018）+ 本报告（本节）。

---

## A/B 评测（FR-010 / SC-003/004/007）— 待用户确认成本

代码改动已稳定交付，A/B 评测为独立后续步骤，**需用户明确确认成本后才跑批**（spec FR-010 既有约束）。详见交付报告中的 A/B 成本预估与凭据三件套 verify。

---

## 工具使用反馈（Dogfooding 四维度）

本 feature 改的就是 Spectra MCP 工具面，开发中实际调用了 17 工具中的多个 + Spec Driver 全流程，一手反馈如下：

### 1. MCP 可用性
- 本次开发主要在主线程用 Read/Grep/Bash + tsx probe 直接验证（worktree dev 环境，MCP server 经 stdio E2E 间接验证可用）。stdio E2E 跑通证明 server 启动 + listTools + callTool + getInstructions 全链路正常，无连接失败/工具缺失。
- `client.getInstructions()` SDK API 真实可用，instructions 经 initialize result 正确回传——验证了本 feature 核心抓手的技术前提。

### 2. 返回信息是否够用
- **改造前自我感受（description 视角）**：server 5 工具旧 description 是 2-6 字标签（如 'AST 预处理 + 上下文组装'），作为"子代理"我无法据此判断 prepare vs generate vs batch 的选择时机、典型链路位置——这正是 adoption 问题的微观体现，亲身印证了 F176 结论。
- **改造后**：补齐 4 要素后，Use this tool when + Example + chained usage 让"何时调、调完接什么"一目了然。**但发现一个真问题**：旧 description（含 file-nav 范本）和我初稿的 Example Output 字段名多处与真实返回 schema 不符（skeleton vs skeletons、generated vs successful、graph/overview 不存在）——这种"宣传性字段名漂移"会反向误导子代理，Codex 对抗审查抓到 panoramic 一处、我自查补了 prepare/batch/diff 三处。**产品启示**：MCP description 的 Example 字段名缺自动化 schema 守护，是一个跨工具的潜在漂移源（已记入 commit message，未来可作独立改进 Feature 评估）。

### 3. Spec Driver 流程顺畅度
- 7 phase + 多 gate 编排清晰；GATE_DESIGN/GATE_TASKS 硬门禁在关键决策点正确暂停回主线程拍板（FR-008 路径选择、A/B 成本）。
- 每 phase codex 对抗审查（spec/plan/tasks/implement 各一轮）价值显著：4 轮共抓 7 critical，全在实现前或提交前拦下（如 SDK 签名错误若漏到 implement，instructions 核心抓手会静默失效）——印证"设计阶段 review 比 implement 后便宜 100 倍"。
- **小摩擦**：orchestration get-phases 的 JSON 里 `agent` 字段类型在多 agent phase（clarify+checklist）是数组、单 agent 是字符串，混合类型让脚本侧格式化要特判（INFO 级，非阻塞）。

### 4. 结果准确性
- `resolveSymbolFuzzy` 在真实 micrograd graph 上的 fuzzy 行为符合预期：probe 实测裸名 'MLP'=0.85（多候选不 auto）、path-suffix 'engine.py::Value.relu'=0.9（唯一 auto），与 F174 既有 e2e 一致。
- **真实 graph 的双 id 格式坑**：micrograd graph.json 同时存在 `micrograd/nn.py#MLP`（patch 格式）和 `/abs/path/...nn.py::MLP`（绝对路径格式）两套 node id，导致 `Value.relu` auto-resolve 命中绝对路径节点（sourceFile 是绝对路径，落在 tempRoot 外）——这是 E2E fixture 设计的真实障碍，最终用"注入干净唯一节点"绕过（Codex C-001 预警的 fixture 风险得到验证）。**产品启示**：graph 抽取的 node id 格式不统一是潜在数据质量问题（可作 F193 graph 一致性的输入）。

**结论**：本次 dogfood 一手暴露了 1 个跨工具产品级隐患（description Example 字段名无守护）+ 1 个数据质量隐患（graph node id 双格式），均已记录为后续改进候选，未在本 feature 顺手乱改工具源码（遵守 scope 纪律）。
