# Research: F184 技术决策记录

## Decision 1：FR-002 instructions 注入位置

**问题**：`McpServer` 构造函数中，`instructions` 应放第一个参数（`serverInfo: Implementation`）还是第二个参数（`options?: ServerOptions`）？

**结论**：放第二个 `ServerOptions` 参数。

**理由**：
- 已对照本地 `node_modules/@modelcontextprotocol/sdk/server/index.d.ts` 核实（SDK 1.26.0）
- `Implementation` 接口仅包含 `name` 和 `version` 字段
- `ServerOptions` 包含 `instructions?: string` 字段，该字段在 MCP `initialize` 结果中传递给客户端
- 写入第一个对象 TypeScript 不会报错（因为 `Implementation` 是接口，额外字段不被类型系统拒绝），但运行时不会进入 initialize result

**替代方案**：无（只有一种正确写法）

---

## Decision 2：FR-003 fuzzy 接入位置选择

**问题**：fuzzy 逻辑应放在 `resolveSymbolRange` 内部还是 `handleViewFile` 内部？

**结论**：放在 `resolveSymbolRange` 内部，通过扩展返回类型传递 `fuzzyResolved` 信号给 `handleViewFile`。

**理由**：
- `resolveSymbolRange` 是"解析 symbol → 拿 lineRange"的封装层，fuzzy 解析属于"解析"职责范围内
- 放在 `handleViewFile` 内部会打破当前的分层（handler 直接操作 graph 数据），增加 handler 复杂度
- F174 范本（`agent-context-tools.ts:173-185`）在业务 handler 内做 fuzzy，但 agent-context 工具没有独立的 `resolveSymbolRange` 抽象层；file-nav 工具已有此抽象，应在正确层次接入

**替代方案**：在 `handleViewFile` 内部直接调 fuzzy，但会造成 handler 职责混乱

---

## Decision 3：FR-008 graph_node fuzzy 路径选择

**问题**：graph_node fuzzy 选路径 A（当前实现）还是路径 B（deferred）？

**结论**：路径 B（deferred，等 F193 ship 后单独处理）。

**理由**（见 plan.md "FR-008 路径决议"详细分析）：
- FR-008 是 MAY 级别，F184 主线价值不依赖它
- 路径 A 的 `getNode` 返回 null 时的响应 schema 变化会触动 snapshot 测试
- `keyword` substring 语义与 fuzzy 语义不等价，正确实现需要仔细设计语义边界，不适合塞进当前 feature
- F193 ship 后实现更干净，冲突风险归零

**替代方案（路径 A）**：在 handler 层对 `id` 参数 not-found 路径加 fuzzy 兜底。若在 F193 ship 后仍有需求，该路径是正确实现方向。

---

## Decision 4：instructions 文本长度约束

**问题**：instructions 应该多详细？

**结论**：控制在 500-800 字符，以工具分组 + 典型链路 + graph-not-built 恢复流为核心，不写每个工具的完整说明。

**理由**：
- instructions 是 MCP initialize result 的一部分，过长会占用子代理 context window
- 各工具的详细说明已在 description 中（FR-005/007 补齐），instructions 的价值在于提供"俯视图"和"何时开始用"的动机，而非重复 description 内容
- 每个工具的具体使用时机在 description 中已有完整 "Use this tool when" 段落

**替代方案**：更长的 instructions（1500-2000 字符），包含每个工具的完整说明。被拒绝原因：冗余（与 description 重复），且实际效果取决于 SDK 是否真实传播（A/B 待验证）

---

## Decision 5：A/B 对照组数据来源

**问题**：A/B 评测的"改造前"对照组是否需要重跑？

**结论**：直接复用 F176 既有数据（1.77/run，16/30 零调用）作为对照基线，不重跑改造前版本。

**理由**：
- F176 数据已在相同任务集上、相同测评设施下采集
- 重跑仅增加成本和配额消耗，不提升结论质量
- 若任务集或基础设施发生变化，在 F188 更大规模复测时再单独设对照组

**替代方案**：git checkout 旧 commit 重跑对照组。被拒绝原因：成本高、配额消耗多、F176 数据质量已足够作为方向性信号基准
