# F184 实现期硬约束备忘（主编排器核实，implement 阶段必读）

## description 4 要素契约（FR-005 / FR-007）—— 来自 feature-170c-description.e2e.test.ts

现有 e2e 只断言 agent-context 3 工具（context/detect_changes/impact），**不覆盖** server 5 / graph 6，所以改后者不会破坏它。但它定义了 canonical 契约，FR-005 新写的 description **必须**满足，并应新增平行测试覆盖 server 5 工具：

- (a) description 总长度 ∈ **[100, 500]** 字符 —— ⚠️ 500 上限是硬约束，别写太长
- (b) lead-in 首行 ≥ 10 字符
- (c) 含 `Use this tool when` 段 + ≥ 3 个 bullet use-case
- (d) 含 `Example` 段（input/output 示例）
- (e) 含 `Typical chained usage` 段 + ≥ 1 个 chain 示例（用 `→` 或 `->`）

graph 6 工具（FR-007 SHOULD）：spec 只要求补 "Use when / chained usage" 两项，比 4 要素轻；但若也想过同款断言需控制在 500 字符内。建议 graph 工具走"Use when + chained usage"两段式，不强求 Example（SHOULD 级，避免 6×Example 膨胀）。

## 无 literal description 断言（已核实）
tests/ 下无任何测试断言 server-5/graph-6 的 description 字面值（grep 当前文案零命中）→ 纯字符串改动安全。

## view_file fuzzy 镜像模板（FR-003/004）—— agent-context-tools.ts:169-188 逐字段照搬
```
const fuzzy = resolveSymbolFuzzy(graphData, symbolId, { projectRoot });
if (fuzzy.autoResolved && fuzzy.candidates[0] !== undefined) {
  // resolved id = fuzzy.candidates[0].id → 再走 findNode 拿 lineRange
  // warnings.push('fuzzy-resolved')；可附 resolvedFrom/To/Confidence
} else {
  return buildErrorResponse('symbol-not-found', msg, hint, { fuzzyMatches: fuzzy.candidates.slice(0, 3) });
}
```
- resolveSymbolRange 当前返回 `{ ok, file, start?, end? }`；fuzzy autoResolved 后用 resolved id 走 `findNode(graphData, id)` 拿 `metadata.lineRange` + sourceFile（与现有精确路径同一段逻辑，复用即可）
- fileMismatch 校验（handleViewFile:172）对 fuzzy-resolved 的 file 同样适用，无需特判（resolved 后结构与精确 resolve 一致）
- view_file 已 import `canonicalizeSymbolId, findNode, moduleFileFromId`，加 `resolveSymbolFuzzy` 到同一 import
- handleViewFile 已有 `warnings` 局部数组（承载 'symbolId-overrides-lines'），复用 push 'fuzzy-resolved'

## FR-002 instructions SDK 签名（已核实）
`new McpServer({ name, version }, { instructions: <文本> })` —— instructions 在**第二个 ServerOptions 参数**。写进第一个对象不进 initialize result。
instructions 文本里"17 工具"数字有漂移风险（将来工具增减）——implement 时考虑用分组描述弱化硬编码计数，或加注释提醒同步。

## FR-008 = 路径 B deferred（主线程已裁决）
不写 graph_node fuzzy 代码。在 tasks.md + verification report 各留一行 deferred 记录（spec W-003 口径）。

## view_file fuzzy 测试设计（Codex Plan C-001/C-002/W-002 修订后，executable）

⚠️ `resolveSymbolFuzzy` 无候选返回**空数组** —— 测试禁止用臆造串断言"非空候选"。一律基于 micrograd fixture（扩展 `tests/e2e/feature-180-symbol-chain.e2e.test.ts` 已建的 `micrograd/nn.py#MLP` lineRange 45-60 graph.json patch）。

| 测试 | 场景 | fixture query | 期望 |
|------|------|--------------|------|
| SC-002 单测/E2E | fuzzy 失败带候选 | 裸名 `'MLP'` | `symbol-not-found` + `context.fuzzyMatches[0].confidence=0.85 <0.9`（proven，symbol-chain.e2e:205）|
| SC-001 E2E | fuzzy auto-resolve 成功 | 唯一 path-suffix 近似（如 `nn.py#MLP` 去前缀），**implement 实测微调到 ≥0.9 唯一** | 成功响应 + `warnings` 含 `'fuzzy-resolved'` |
| EC-001 单测 | graph-not-built | 任意 symbolId | `graph-not-built`（现状不变）|
| EC-003 单测 | 空/空白 symbolId | `''` | 走 canonicalize → `invalid-symbol-id` |
| W-002 单测 | fuzzy 跨文件 mismatch | `path='a.ts'` + symbolId fuzzy 到 `sub/b.ts::foo` | `invalid-input`（fuzzy-resolved file 也过 fileMismatch）|

## instructions 协议层验证（Codex Plan C-002，不可砍）
新增 stdio E2E（"用户故事:"命名）：`spawnMcpClient()` → 断言 `handle.client.getInstructions()`（SDK Client 既有 API，client/index.d.ts:167）非空 + 含 `detect_changes → impact → context → view_file` + `graph-not-built`。这验证**协议层传播**，与 A/B 的"Task 子代理是否在模型上下文看到"是两个问题（spec EC-005 区分）。

## fuzzyMatches 形状（Codex Plan W-003）
错误响应 `context.fuzzyMatches` 元素 = 完整 `SymbolCandidate` `{ id, confidence, matchKind }`，直接 `fuzzy.candidates.slice(0,3)`，**禁裁字段**（feature-180-symbol-chain.e2e:221 已断言三字段）。

## warnings 顺序（Codex Plan W-005）
无序集合语义；实际 push 顺序 `['fuzzy-resolved', 'symbolId-overrides-lines']`；测试用 `toContain`/`arrayContaining`，禁 `toEqual`。resolveSymbolRange 需把 fuzzy-resolved 信号回传给 handleViewFile（扩展其返回结构，如加 `fuzzyResolved?: boolean`），由 handleViewFile push 进 warnings。

## instructions 长度纪律（Codex Plan W-004）
instructions 文本 ≤ **1600 字符**并加长度断言（草案 ~1717 超标，需精简）；server 5 / graph 6 description 各受 `[100,500]` 单工具上限。instructions 里弱化"17"硬编码计数（用分组描述），降工具增减漂移风险。

## 回归门（FR-011）
F180 44 stdio E2E（listTools 17 工具断言、F174 fuzzy E2E）+ 4250+ vitest + npm run build + npm run repo:check 57 项全绿。
