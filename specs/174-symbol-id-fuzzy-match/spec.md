# Feature Specification: Symbol ID Fuzzy Match

**Feature Branch**: `174-symbol-id-fuzzy-match`
**Created**: 2026-06-06
**Status**: Draft

## 背景与目标

当前 `impact` / `context` handler 在 canonicalize symbol id 失败时，直接走 `findFuzzyMatches` 返回 `string[]` 并报 `symbol-not-found` 错误——调用方拿到的是候选列表，自动 resolve 能力为零。F165 cohort C 实测 symbol-not-found 错误率为 1/9。

本 Feature 将 symbol id 解析升级为"严格匹配 + 分层 fuzzy + 高置信度自动 resolve + top-3 候选"的四层机制，把 cohort C 错误率降至 0/9，同时杜绝多候选场景下的误自动 resolve。

**范围限定**：fuzzy 仅接入 `impact` / `context` handler（`handleImpact` / `handleContext`），不接入 `detect_changes`——后者的 symbol 来源于 graph 内部，不经过 `canonicalizeSymbolId`，不在本 Feature 调整范围内。

---

## User Scenarios & Testing

### User Story 1 — 无路径前缀的简短 symbol 自动 resolve（Priority: P1）

driver 在调用 `context` 工具时，只传 `Value.__add__`（无文件路径前缀），当前系统返回 symbol-not-found。升级后，fuzzy 引擎在 graph 中找到**唯一**匹配候选，partial-name 经唯一性加权后置信度提升至 ≥0.9 满足自动 resolve 阈值，直接用该 id 继续查询并在响应中附带 `resolvedFrom`（原始 query）/ `resolvedTo`（canonical id）/ `resolvedConfidence`，并向 `warnings` 数组追加 `'fuzzy-resolved'`，调用方无需重试。

**Why this priority**：这是 F165 cohort C 最高频的失败场景，直接影响 driver 成功率，是 MVP 核心价值。

**Independent Test**：构造含 `micrograd/engine.py::Value.__add__` 节点的最小 graph fixture，以 `Value.__add__` 为查询 id 调用 `resolveSymbolFuzzy`，验证 `autoResolved === true` 且 `candidates[0].matchKind === 'partial-name'` 且 `confidence ≥ 0.9`（唯一性加权后）；再通过 `handleContext` 路径做集成验证，响应体含 `resolvedFrom` / `resolvedTo` / `resolvedConfidence` 字段。

**Acceptance Scenarios**:

1. **Given** graph 中存在唯一节点 `micrograd/engine.py::Value.__add__`，query id 为 `Value.__add__`，**When** `resolveSymbolFuzzy` 被调用，**Then** 返回 `autoResolved: true`，唯一候选 `confidence ≥ 0.9`（partial-name 唯一性加权），`matchKind: 'partial-name'`
2. **Given** 同样的 graph，**When** `handleContext` 以 `Value.__add__` 为 symbol id 请求，**Then** 响应体包含正常的 context 数据，同时携带 `resolvedFrom: 'Value.__add__'`（原始 query）、`resolvedTo: 'micrograd/engine.py::Value.__add__'`（canonical id）、`resolvedConfidence: <number ≥0.9>`，并在 `warnings` 数组中包含 `'fuzzy-resolved'`，响应为成功（不报 symbol-not-found）
3. **Given** 同一简短名在 graph 中存在 2 个同名（不同 module）节点，query 为简短名，**When** `resolveSymbolFuzzy` 被调用，**Then** partial-name 不加权（非唯一），`autoResolved: false`，返回 top-3 候选，不自动 resolve

---

### User Story 2 — 四种 symbol id 变体批量 resolve（Priority: P1）

driver 在一次测试中提交 4 种变体：(i) 无文件路径只有方法名、(ii) 无方法名只有文件，(iii) 绝对路径形式、(iv) 文件名拼写错误（如 `egnine.py`）。升级后，15 次 resolve 操作中 ≥ 12 次能定位到正确 symbol（整体成功率 ≥ 80%）。

**Why this priority**：直接验证四层 fuzzy 各层均有实际命中能力，是 SC-003 的主要覆盖场景。

**Independent Test**：准备基于 micrograd 图的合成 fixture，针对 4 种变体各测 3~4 个用例，统计 **top-1 命中**成功数（`candidates[0].id === 期望 canonical id`，**不要求 autoResolved**），断言 ≥ 12/15。

> SC-003 成功口径（W-2 收口）：**"正确 resolve" = `candidates[0].id` 等于期望 canonical id**（top-1 候选正确），而非 `autoResolved === true`。理由：typo 层 confidence 0.5~0.75 与多义 partial-name 达不到 ≥0.9 自动 resolve 阈值，若要求 autoResolved 则 ≥12/15 不可达；top-1 命中口径衡量解析质量本身，4 类变体均可参与统计。

**Acceptance Scenarios**:

1. **Given** query 为 `engine.py::Value.relu`（无 package 前缀），**When** `resolveSymbolFuzzy` 调用，**Then** 命中 path-suffix 层，`candidates[0].confidence === 0.9`，`matchKind: 'path-suffix'`
2. **Given** query 为绝对路径形式 `/abs/projectRoot/micrograd/engine.py::Value`（经 `opts.projectRoot` 透传），**When** 调用，**Then** exact 层（经 `canonicalizeSymbolId` 路径归一化）命中，`confidence: 1.0`，`matchKind: 'exact'`
3. **Given** query 为 `egnine.py::Value`（typo），**When** 调用，**Then** Levenshtein 层命中，`candidates[0].confidence` 在 0.5~0.75 区间，`matchKind: 'levenshtein'`
4. **Given** 15 次混合变体调用，**When** 统计 top-1 命中，**Then** `candidates[0].id` 等于期望 canonical id 的次数 ≥ 12

---

### User Story 3 — F165 cohort C symbol-not-found 清零（Priority: P2）

F165 cohort C 原始 9 个 symbol 样本，历史上有 1 个触发 symbol-not-found。升级后对这 9 个样本调用 `handleContext`，symbol-not-found 错误比例降至 0/9。

**Why this priority**：这是本 Feature 提出的直接业务指标，验证真实回归修复效果。

**Independent Test**：以合成 micrograd 图模拟 cohort C 的 9 个 symbol，逐一调用 `handleContext`，断言零 symbol-not-found 错误。

**Acceptance Scenarios**:

1. **Given** cohort C 9 个 symbol 样本（用合成 micrograd graph fixture 模拟），**When** 逐一以 `handleContext` 调用，**Then** 全部 9 次响应均不含 `symbol-not-found` error code
2. **Given** 上述 9 个中原来失败的那 1 个，**When** 调用，**Then** fuzzy resolve 成功，`warnings` 数组含 `'fuzzy-resolved'`，响应含 `resolvedFrom`（原始 query）与 `resolvedTo`（canonical id）

---

### User Story 4 — 完全不存在 symbol 的安全降级（Priority: P2）

driver 传入 graph 中完全没有对应节点的 symbol id（无论怎么 fuzzy 都找不到），系统应安全报告 not-found，返回结构化 `fuzzyMatches`（类型为 `Array<{id, confidence, matchKind}>`），长度 ≤ 3，不抛未捕获异常，不泄漏 stack trace。

**Why this priority**：保障边界安全性，是 fuzzy 升级后必须维持的防御契约。

**Independent Test**：以一个随机字符串（如 `zzz_nonexistent::foo`）调用 `resolveSymbolFuzzy` 和 `handleContext`，验证 `autoResolved: false`，`candidates.length ≤ 3`，响应体结构合法，process 无 unhandled rejection。

**Acceptance Scenarios**:

1. **Given** query id 在 graph 中完全不存在（Levenshtein 距离超过阈值），**When** `resolveSymbolFuzzy` 调用，**Then** `autoResolved: false`，`candidates` 为合法数组（可为空或 ≤ 3 个低分候选），每项含 `id / confidence / matchKind` 三字段
2. **Given** 上述查询经 `handleContext` 路径，**When** 调用，**Then** 响应 error context 中 `fuzzyMatches` 为 `Array<{id, confidence, matchKind}>`（不再是 `string[]`），length ≤ 3，不抛异常

---

### Edge Cases

- **同名 partial-name 多 module**：`relu` 同时存在于 `engine.py` 与 `nn.py`，partial-name 层返回 2 个候选，`autoResolved: false`，不自动 resolve，top-3 返回置信度由高到低排列。
- **空 graph**：`graphData` 节点为空集时，所有层均返回空候选，`autoResolved: false`，不抛异常。
- **query 本身是合法 exact id**：exact 层直接命中，不进入后续层，`confidence: 1.0`，`matchKind: 'exact'`，`autoResolved` 依唯一性判断（exact 命中时必然唯一，`autoResolved: true`）。
- **平票场景**：path-suffix 或 partial-name 层有两个候选评分相同且均为最高，`autoResolved: false`，返回 top-3。
- **超长 query 字符串**：Levenshtein 计算 O(m×n)，对 query 长度 > 512 字符的输入，跳过 Levenshtein 层（层 d）直接返回前三层结果（可为空），防止性能退化。
- **空 / invalid query**：query 为空字符串、纯空白、含控制字符时，`resolveSymbolFuzzy` MUST 返回 `{ candidates: [], autoResolved: false }`，不抛异常（handler 层 invalid-symbol-id 前置拦截在 canonicalize 之前，但纯函数本身也须对这类输入安全降级）。
- **graphData 只读保证**：所有四层计算均不修改 graphData，无副作用。
- **`detect_changes` 调用路径**：`detect_changes` handler 不经过 `canonicalizeSymbolId`，fuzzy 逻辑对其不可见，行为不变。

---

## Requirements

### Functional Requirements

**FR-001** `[必须]`：系统 MUST 提供纯函数 `resolveSymbolFuzzy(graphData, query, opts)` → `{ candidates: SymbolCandidate[], autoResolved: boolean }`，其中 `SymbolCandidate = { id: string, confidence: number, matchKind: MatchKind }`，`MatchKind = 'exact' | 'path-suffix' | 'partial-name' | 'levenshtein'`。`opts` MUST 包含 `projectRoot?: string`（透传给 `canonicalizeSymbolId` 做绝对↔相对路径归一），MAY 包含 `limit?: number`、`autoResolveThreshold?: number`（见 FR-012）。该函数对 `graphData` 只读，无副作用。

**FR-002** `[必须]`：`resolveSymbolFuzzy` MUST 按以下四层顺序执行，命中即停止，不降级到后续层：
- 层 (a) exact：复用 `canonicalizeSymbolId(query, graphData, { projectRoot })`，命中则 `confidence: 1.0`，`matchKind: 'exact'`
- 层 (b) path-suffix：query 与 symbol id 的文件路径后缀及方法名均匹配，`confidence` 锁定为**确定值 0.9**（不是"约 0.9"；见 FR-003 边界规则），`matchKind: 'path-suffix'`
- 层 (c) partial-name：query 仅含方法名或类名（含 `Class.method` 限定形式）。**唯一性加权**：图中恰好一个节点匹配 → `confidence` 提升至 ≥0.9（触发 autoResolve，满足 US1）；多个节点匹配 → `confidence` 落在 0.7~0.85 区间按相对唯一性递减（不触发 autoResolve）。`matchKind: 'partial-name'`。具体加权公式（如 qualified vs bare 的差异）由 plan 阶段确定
- 层 (d) Levenshtein：拼写相似度匹配，`confidence` 在 0.5~0.75 区间，`matchKind: 'levenshtein'`

**FR-003** `[必须]`：`autoResolved` MUST 仅在以下条件同时满足时为 `true`：候选列表去重后有且仅有一个元素，且该元素 `confidence ≥ autoResolveThreshold`（默认 0.9，闭区间比较 `>=`）。任何其他情况（多候选、平票、唯一但 < 阈值）`autoResolved` 为 `false`。**边界规则**：path-suffix 锁定 0.9 恰好满足 `>= 0.9`，因此唯一 path-suffix 命中会 autoResolve；实现必须用精确常量 0.9（避免 0.89/浮点近似改变 autoResolve 行为）。

**FR-004** `[必须]`：`handleImpact` 与 `handleContext` handler MUST 在 `canonicalizeSymbolId` 返回 not-found 后调用 `resolveSymbolFuzzy`（透传 `projectRoot`），而非直接调用旧版 `findFuzzyMatches`。

**FR-005** `[必须]`：当 `autoResolved: true` 时，handler MUST 用解析到的 canonical id 继续完成原始操作（查询 context / impact），且响应体 MUST 附加字段：`resolvedFrom`（**原始 query string**）、`resolvedTo`（**resolve 后的 canonical id**）、`resolvedConfidence`（number）；并向现有响应的 `warnings: string[]` 数组**追加** `'fuzzy-resolved'`（不新增单数 `warning` 字段，复用既有 warnings 语义）。

**FR-006** `[必须]`：当 `autoResolved: false` 时，handler MUST 返回结构化错误响应，`fuzzyMatches` 字段类型 MUST 为 `Array<SymbolCandidate>`（即 `Array<{id: string, confidence: number, matchKind: MatchKind}>`，复用 FR-001 同一枚举），handler 层 MUST 把数组 clamp 到固定 **top-3**（by confidence desc），不得为旧版 `string[]`。

**FR-007** `[必须]`：`fuzzyMatches` 字段类型从 `string[]` 变更为 `Array<SymbolCandidate>` 是 breaking change，本 PR MUST 完成以下**下游审计清单**（W-4 收口）的全部同步：
- `tests/unit/mcp/agent-context-tools.test.ts` 断言 C-102（`:161`）与 C-206（`:333`）
- MCP error response schema / 类型定义（若有显式 schema 描述 `fuzzyMatches` 形态）
- Feature 155 相关文档中记录 `fuzzyMatches: string[]` 与 `limit=5` 的描述
- 其他直接消费 `fuzzyMatches` 的测试 / eval / prompt（实现前用 `grep -rn "fuzzyMatches"` 全仓审计确认无遗漏）
[AUTO-RESOLVED: breaking change + 同 PR 更新断言优于并存兼容字段，保持合同一致性]

**FR-008** `[必须]`：`resolveSymbolFuzzy` 对 `graphData` MUST 只读；任何 fuzzy 逻辑均不得写入或修改 graph 数据结构。

**FR-009** `[必须]`：fuzzy 解析逻辑 MUST 不接入 `detect_changes` handler；`detect_changes` 的 symbol 路径保持不变。

**FR-010** `[必须]`：当 query 字符串长度 **> 512 字符**时，MUST 跳过 Levenshtein 层（层 d）并直接返回前三层结果（可为空），防止 O(m×n) 性能退化。空字符串 / 纯空白 / 含控制字符的 query MUST 返回 `{ candidates: [], autoResolved: false }`，不抛异常。

**FR-011** `[必须]`：层 (d) MUST 用 Levenshtein 编辑距离打分。实现以行为为准（编辑距离 + 距离→confidence 映射）；复用 `src/panoramic/pipelines/adr-evidence-verifier.ts` 的 DP 滚动数组实现属于 plan/implementation 的实现选择，不在 FR 强制范围。

**FR-012** `[可选]`：`resolveSymbolFuzzy` 的 `opts` 中 `projectRoot`（必选，见 FR-001）MUST 由 handler 从 `args.projectRoot ?? process.cwd()` 透传到底层 `canonicalizeSymbolId` 调用；`limit`（纯函数内部 top-N，便于测试覆盖更多候选）和 `autoResolveThreshold` 为可选运行时覆盖。**约束**：(1) handler 层响应 `fuzzyMatches` 恒为 top-3（FR-006），与纯函数 `limit` 解耦；(2) production handler 传入的 `autoResolveThreshold` floor MUST ≥ 0.9，不得被调低以绕过 FR-003 硬阈值（W-7 收口）。

**FR-013** `[Non-goal]`：保留旧 `fuzzyMatches: string[]` 同时新增 `fuzzyCandidates` 结构化字段的"双字段并存兼容模式"**不在本 Feature 范围**（明确 Non-goal）。本迭代走 breaking change 路径（FR-007）。理由：并行维护两种类型合同增加合约漂移风险，旧断言在同 PR 内统一更新成本可控。实现 MUST NOT 引入未测试的兼容分支。

---

### Key Entities

- **SymbolCandidate**：代表一次 fuzzy match 的候选结果，属性：`id`（canonical symbol id 字符串）、`confidence`（0~1 浮点数）、`matchKind`（枚举 `MatchKind`：`exact | path-suffix | partial-name | levenshtein`）
- **FuzzyResolveResult**：`resolveSymbolFuzzy` 的返回值，属性：`candidates: SymbolCandidate[]`（按 confidence 降序，长度 ≤ limit）、`autoResolved: boolean`
- **ResolvedResponse**（handler 层扩展）：当 `autoResolved: true` 时，原有响应体附加字段 `resolvedFrom: string`（原始 query）、`resolvedTo: string`（canonical id）、`resolvedConfidence: number`，并向 `warnings: string[]` 追加 `'fuzzy-resolved'`

---

## Success Criteria

### Measurable Outcomes

- **SC-001**：`resolveSymbolFuzzy` 的四层 fuzzy 各有至少一个命中用例；各层 `confidence` 满足：(a) 恒 1.0、(b) 恒 0.9、(c) partial-name 唯一命中 ≥0.9 / 多义 0.7~0.85、(d) 0.5~0.75。通过单元测试逐层断言验证。

- **SC-002**：F165 cohort C 9 个 symbol 样本（合成 micrograd graph fixture 模拟），通过 `handleContext` 路径调用后，symbol-not-found 错误数为 0/9（从基线 1/9 降至 0/9）。其中原失败样本经 partial-name 唯一性加权 ≥0.9 自动 resolve。

- **SC-003**：针对 4 种 symbol id 变体（无路径前缀、无方法名、绝对路径、typo 拼写错误），共 15 次 resolve 调用中，**top-1 命中**（`candidates[0].id === 期望 canonical id`，不要求 autoResolved）的次数 ≥ 12（≥ 80% 成功率）。

- **SC-004**：误自动 resolve 为 0——多候选场景（graph 中同一简短名存在 ≥ 2 个节点）下 `autoResolved` 必须为 `false`；以"同名多 module"用例显式断言。production handler 的 `autoResolveThreshold` floor ≥ 0.9（不可被调低绕过）。

- **SC-005**：全量回归零失败——`npx vitest run` 3859 条（含新增单元测试）全部通过；新增单元测试对 `resolveSymbolFuzzy` 的分支覆盖率 ≥ 95%；`npm run build` 类型检查零错误；`npm run repo:check` 零警告。

- **SC-006**：旧 C-102（`tests/unit/mcp/agent-context-tools.test.ts:161`）与 C-206（`:333`）断言已更新为 `Array<{id, confidence, matchKind}>` 结构验证，旧 `Array.isArray(fuzzyMatches)` 弱断言被替换为结构完整性断言。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 评估值 |
|------|--------|
| 组件总数 | 2（新增 `resolveSymbolFuzzy` 纯函数 + handler 接线层修改） |
| 接口数量 | 3（`resolveSymbolFuzzy` 签名、`FuzzyResolveResult` 类型、handler 响应体扩展字段） |
| 依赖新引入数 | 0（Levenshtein 从已有私有实现迁移，无新外部依赖） |
| 跨模块耦合 | 是（修改 `query-helpers.ts` 的公开契约 + `agent-context-tools.ts` 接线 + 测试文件同步） |
| 复杂度信号 | 无递归结构、无状态机、无并发控制、无数据迁移；仅 breaking type change（`string[]` → `Array<{...}>`）需同步更新断言 |
| **总体复杂度** | **LOW**（组件 2 < 3，接口 3 < 4，无复杂度信号；但 breaking change 需跨 3 个文件同步，plan 阶段需明确协调顺序） |

> 注：组件和接口数量均低于 HIGH/MEDIUM 阈值，不触发人工审查门禁。但 `fuzzyMatches` 类型变更是 breaking change，需在 plan 中明确 "先改类型定义，再改 handler，最后同步测试" 的严格操作顺序，防止中间态类型不一致被提交。

---

## Open Questions

### 已收口（Codex 对抗审查 round-1 后，用户 2026-06-06 决策）

1. ✅ **autoResolved 阈值策略**（C-1）：采用**唯一性加权提分**——partial-name 唯一命中（图中恰好一个节点匹配）→ confidence 提升至 ≥0.9 可自动 resolve；多义保持 0.7~0.85 不自动 resolve。规则统一为"去重后唯一候选 + confidence ≥ autoResolveThreshold(0.9)"。见 FR-002(c) / FR-003。
2. ✅ **breaking change vs 新字段并存**（OQ-2）：走 breaking change（`fuzzyMatches: string[]` → `Array<SymbolCandidate>`），同 PR 完成下游审计清单，不做并存兼容。见 FR-007 / FR-013（Non-goal）。
3. ✅ **top-N 统一**（OQ-3 / W-5）：handler 响应 `fuzzyMatches` 恒 **top-3**；纯函数 `limit` 可配置用于测试，与 handler 解耦。见 FR-006 / FR-012。
4. ✅ **SC-003 成功口径**（W-2）：**top-1 命中**（`candidates[0].id` 正确），不要求 autoResolved。见 SC-003。

### 仍待 Plan 阶段决定

A. **partial-name 唯一性加权具体公式**：FR-002(c) 已定方向（唯一→≥0.9），但 qualified `Class.method` 与 bare 单 token 的加权差异、多义时 0.7~0.85 的递减函数，由 plan 给出可实现的打分公式。

B. **E2E fixture 来源**：F165 cohort C 无 captured JSON，需用合成 micrograd graph fixture 模拟 9 个 symbol 样本。合成 fixture 是否足够覆盖真实场景，或需从真实 micrograd 项目跑一次 graph 采集作为基础，由 plan 决定 fixture 构造策略。

C. **Levenshtein 距离上限**：层 (d) 的最大编辑距离上限（超过则不纳入候选）及距离→confidence(0.5~0.75) 的映射函数，plan 结合用例确定（query 长度 >512 跳过层 d 已在 FR-010 锁定）。
