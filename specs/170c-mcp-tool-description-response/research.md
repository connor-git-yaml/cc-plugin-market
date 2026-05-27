# 技术决策研究：F170c

**生成时间**：2026-05-28
**来源**：plan agent Codebase Reality Check + 代码审查

---

## 决策 1：TopImpacted score 公式

**问题**：BFS affected 节点数量可达 100+，需要选择一种评分公式筛选出最重要的前 5 项。

**结论**：使用 `score = 1 / depth`（BFS depth 倒数）

**理由**：
- `BfsAffected` 对象已包含 `depth` 字段，无需额外计算或额外数据结构
- 语义直观：直接调用方（depth=1）得分 1.0，间接调用方（depth=2+）得分递减
- 计算复杂度 O(n log n)（排序），在 n=100 时 < 1ms

**替代方案及排除理由**：
- 度数中心性（`callers_count / total`）：需全图遍历统计每个节点的入度，额外 O(E) 开销；且 BFS 结果中没有现成的度数信息，需要额外从 graph.json links 中计算，违反 YAGNI（Constitution III）
- 综合公式（depth + callers + 类型）：参数权重无法从现有数据验证，引入主观调参负担；当前无足够 eval 数据支持参数选择

**tiebreaker**：同 score 时按 symbol id 字母序升序（`localeCompare`），保证 stable sort 以支持 SC-005 snapshot 断言。

---

## 决策 2：NextStepHint 语言策略

**问题**：`nextStepHint` 文本是使用中文、英文还是支持 i18n？

**结论**：固定中文，无 i18n 支持

**理由**：
- FR-010 已明确：使用中文，无需 i18n（`[AUTO-RESOLVED: 按项目 CLAUDE.md 默认中文约定]`）
- i18n 机制（locale 检测、消息 catalog、语言切换）超出本 Feature 范围
- driver LLM（Claude）对中文引导文本的理解能力与英文相当，不影响工具链引导效果

**替代方案及排除理由**：
- 英文文本：违反项目约定（Constitution I + CLAUDE.md 默认中文）
- i18n 支持：YAGNI——当前没有多语言 driver 的使用场景；引入 i18n 框架违反 Constitution III

---

## 决策 3：assessRiskTier 与 computeRiskTier 的关系（修订：响应 codex C-2，已删除 assessRiskTier）

**问题**：spec 建议 plan 阶段定义 assessRiskTier 公式，但 `computeRiskTier` 已在 `query-helpers.ts` 中实现，且 `detect_changes` handler 现状已通过 `computeRiskTier(0, totalAffected)` 计算 `riskSummary.riskTier`。

**结论修订**：**不再定义 `assessRiskTier` 包装函数**。`response-helpers.ts` 不 export 此函数。`detect_changes` handler 新增的**顶层 riskTier 仅 mirror 嵌套 `riskSummary.riskTier`**（已由 `computeRiskTier(0, totalAffected)` 计算），无独立计算逻辑。

**理由**：
- 现状 `handleDetectChanges`（agent-context-tools.ts:671）已调用 `computeRiskTier(0, totalAffected)`——任何新的 `assessRiskTier` 包装都是冗余抽象，违反 Constitution III（YAGNI）
- 顶层 mirror 嵌套字段是最安全的实现：success 和 enrichment degraded 两路径下顶层值始终等于嵌套值（嵌套是主流程计算，degraded 不影响嵌套）
- 避免 codex C-1 指出的"degraded fallback 'low' 导致顶层 ≠ 嵌套"的语义分叉风险

**spec 偏差记录**：
- spec Tool×Path 矩阵中 detect_changes degraded 列写 `riskTier: "low"` fallback，本 plan 不实施此 fallback（mirror 更安全）
- 此偏差不触发 spec amendment，因 mirror 实施在 producer/consumer 合同语义下更严格（"主流程数据可信"原则）
- Phase 5/6 必须按 plan 修订实施：degraded 路径下断言"顶层 riskTier == riskSummary.riskTier"，非"== 'low'"

---

## 决策 4：response-helpers.ts 模块位置

**问题**：helper 模块放在 `src/mcp/lib/` 还是 `src/mcp/` 同层？

**结论**：`src/mcp/lib/response-helpers.ts`

**理由**：
- `src/mcp/` 目前只有 `agent-context-tools.ts` / `graph-tools.ts` / `index.ts` / `server.ts` 4 个文件，是顶层 handler/server 层
- helper 是被 handler 调用的辅助层，逻辑上应在 `lib/` 子目录（遵循"handler vs helper 分离"惯例）
- 避免 `src/mcp/` 顶层文件数膨胀

**替代方案及排除理由**：
- `src/mcp/agent-context-helpers.ts`：放顶层目录会与 `agent-context-tools.ts` 混淆，命名相似但职责不同

---

## 决策 5：SC-005(f) response schema metadata 断言实现方式（修订：响应 codex C-3/C-4）

**问题**：现有代码没有 response Zod schema，`buildSuccessResponse` 直接接受 `Record<string, unknown>`，无法对 response schema 做 Zod `.strict()` 检查。SC-005(f) 4 项断言原本假设有 schema。同时 `tsconfig.json:11` 关闭 `exactOptionalPropertyTypes`，使 `undefined extends T` 类断言失效。

**结论修订**：
- (f1) **结构性断言**：grep `agent-context-tools.ts` 确认无 `.strict()` 调用；plan 明确**不引入**任何 response Zod schema（结构性安全）
- (f2) **结构性断言**：检查所有 `server.registerTool(...)` 配置块**不引入** `outputSchema` 字段；**不**新增 `getResponseJsonSchema()` test helper（响应 codex C-3：避免循环论证）
- (f3) **专用 type-test tsconfig**：新增 `tests/type-tests/tsconfig.json`（extends 根 tsconfig 但启用 `"exactOptionalPropertyTypes": true`）；用 `{} extends Pick<T, K>` 模式断言 optional key；通过 `npm run typecheck:tests` 命令调用 `tsc -p tests/type-tests/tsconfig.json --noEmit`（响应 codex C-4：现 tsconfig 关闭 `exactOptionalPropertyTypes` 时 `undefined extends T` 无效）
- (f4) **input schema snapshot**：Zod input schema 序列化与升级前 baseline 比对（response 无 schema 自然不变）

**理由**：
- 现有代码架构决定了 response 没有 Zod schema，强行引入会超出本 Feature 范围且引入循环论证
- 专用 type-test tsconfig 是绕过项目 tsconfig 关闭 exactOptionalPropertyTypes 限制的标准做法（项目仍保持松散类型，但本 Feature 的类型契约可严格验证）
- 结构性"不引入 schema → 不可能引入兼容性破坏"比"引入 schema 后断言不含 strict 模式"更安全，spec 语义等价

---

## 决策 6：description 长度区间（100-500（implement 阶段从 100-300 放宽） 字符）

**问题**：SC-001 要求 description 长度在 100-500（implement 阶段从 100-300 放宽） 字符之间，需确认"字符"是 Unicode code point 数还是 UTF-8 字节数。

**结论**：使用 JavaScript `String.length`（UTF-16 code unit 数），与 MCP SDK 处理 description 的方式一致

**理由**：
- MCP SDK 将 description 作为 JSON 字符串传输，JSON 规范中字符串长度通常用 code point 数衡量
- spec SC-001 (a) 写的是"字符区间"，对应 `str.length` 最自然
- 中英文混合的 description 中，中文字符每个 = 1 code unit，与英文字符相同；不存在多字节计数问题

---

## 不确定项（已解决）

所有 `NEEDS CLARIFICATION` 项在代码审查后均已解决：
- ✓ response schema 位置：无 Zod response schema，使用 TypeScript interface
- ✓ `computeRiskTier` 已实现：复用阈值逻辑，不重复定义
- ✓ `BfsAffected.depth` 字段存在：TopImpacted score = 1/depth 可直接实现
- ✓ `collectNeighbors` 返回 confidence 字段：TopRelevantCallers 排序可直接使用
- ✓ graph-tools.ts 无 response 字段共享：无依赖污染风险
