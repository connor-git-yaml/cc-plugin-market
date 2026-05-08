# Clarification — Feature 155 Agent-Context MCP Tools

**Generated**: 2026-05-08
**Status**: 自治推断（codebase-scan 提供充分上下文）

由于本 Feature 来自成熟设计文档 [docs/design/spectra-mcp-evolution.md §Feature 151](../../docs/design/spectra-mcp-evolution.md)，且有 codebase-scan 报告补充实现细节，多数模糊点已在 spec.md 中显式决定。下列是对 spec 起草过程中**主动消除**的歧义点，留作记录与可追溯性。

---

## CL-1：confidence 数值映射来源

**歧义**：用户 task 中写"minConfidence (默认 0.7)"，但 graph 内部 confidence 是 `'high' | 'medium' | 'low'` 三档枚举（见 codebase-scan §2）。

**决议**（FR-013）：tool 入参用 `number` 类型保留 LLM agent 直觉，内部转换：
- `high` → 0.95（来自 EXTRACTED 0.95 语义）
- `medium` → 0.65（来自 INFERRED 0.65 语义）
- `low` → 0.30（推断 / fallthrough）

阈值 0.7 默认值意味着 "high + medium 留下，low 过滤掉"。

---

## CL-2：budget 截断时机

**歧义**：用户 task 强调 "**遍历前**截断（不是遍历后裁剪）"，对应 Codex WARNING #6 修订。

**决议**（FR-012）：BFS 实现必须在每次出队 / 入队前检查 `visited.size + queue.length` 是否会超 budget；超了立即停止入队，并在响应附 `warnings: ['budget-truncated']`。**禁止** "先把整张图 BFS 完再 slice 200 个"。

---

## CL-3：direction 的语义

**歧义**：用户 task 给 `direction (upstream/downstream/both)`，但没说默认值。

**决议**（FR-010）：默认 `'upstream'`（找 callers）。理由：impact tool 主用例是"我要改这个 symbol，谁会被牵连"，反向链路更高频。

---

## CL-4：relatedSpec 的精确度

**歧义**：用户 task 说 "relatedSpec 是 stretch goal：若 batch-orchestrator 未持久化 specPath，返回粗粒度 module: engine.spec.md"。

**决议**（FR-023）：第一版**只**返回 module-coarse 链接（`{ kind: 'module-coarse', path: 'panoramic/modules/engine.spec.md' }`）。设计文档已明确 anchor 精确到 section 留 Feature 155b。codebase-scan 已确认 batch-orchestrator 未把 specPath 持久化到 graph.json。

---

## CL-5：detect_changes 输入二选一时的优先级

**歧义**：input 同时给 `diff` 和 `baseRef` 时，怎么处理？

**决议**（FR-030）：`diff` 优先（已经是文本，省一次 git spawn）；同时给出时 `warnings` 含 `'baseRef-ignored'`。

---

## CL-6：detect_changes hunk 解析

**歧义**：第一版要不要解析 unified diff 的 hunk 行号定位 "改了哪一行 → 命中哪个 symbol"？

**决议**（FR-031）：**不解析 hunk**。第一版按 file → 该文件下全部 symbols 算 changedSymbols（保守估算），hunk-level 留 Feature 155b。理由：
- 控制本 Feature 复杂度（用户工作量 3-4 周）
- file-level 已经能让 affectedSymbols 准确（impact 链是从 symbol 出发，过滤无效边由 BFS 自然完成）
- hunk 解析需要 graph 节点保存精确 lineRange，Feature 151 schema 是否足够需要进一步 codebase 验证（避免本 Feature 触动 schema）

---

## CL-7：error envelope 是 isError + content[0].text 还是 throw？

**歧义**：MCP tool handler 出错时怎么返回？

**决议**（FR-050, FR-052）：沿用 graph-tools.ts 的 `buildErrorResponse` 模式，返回 `{ isError: true, content: [{ type: 'text', text: JSON.stringify({code,message,hint?,context?}) }] }`。**绝不**让异常逃逸到 MCP 协议帧（避免污染 stdio）。

---

## CL-8：query-helpers 模块归属

**歧义**：BFS 应该写在 `src/graph/topological-sort.ts`（用户 task 写"复用"）还是新文件？

**决议**（FR-040）：写在新文件 `src/knowledge-graph/query-helpers.ts`。理由：
- topological-sort.ts 实际不导出 BFS（codebase-scan §3）
- topological-sort 输入类型是早期 DependencyGraph，不是 UnifiedGraph
- 修改 topological-sort 会触及 Feature 151 合同区（避免）
- 用户 task 中"复用 src/graph/topological-sort.ts (BFS/DFS)" 理解为"借鉴算法风格"，非 strict import

---

## CL-9：tool 注册顺序与 server.ts 影响

**歧义**：本 Feature 改 server.ts 是否破坏 Feature 152/153/154 并行 work？

**决议**（FR-002）：仅在 server.ts 末尾 append 一次 `registerAgentContextTools(server)` 调用，不动前序的 register* 顺序。Feature 152/153/154 改 src/adapter/，与 server.ts 物理隔离（disjoint write paths，正如用户在 task 中明确）。

---

## CL-10：测试 fixture 是否需要新生成 graph.json？

**歧义**：单测要不要在每个 case 实跑 micrograd build graph？

**决议**（spec SC-001 / SC-005）：
- 单测：mock 一个小型 UnifiedGraph fixture（hand-crafted JSON），不依赖真实 build
- E2E / acceptance：跑 `~/.spectra-baselines/micrograd` 真实 graph.json，验证 SC-001 / SC-003 / SC-004
- baseline 报告（FR-060）：在 collector 触发，不在单测里跑

不阻塞 CI 速度，单测全部 mock-driven，acceptance 走 baseline 路径。

---

## CL-11：unmappedFiles 是否应包含理由？

**歧义**：detect_changes 把"graph 中找不到映射"的文件放进 unmappedFiles，要不要附理由？

**决议**：第一版只放文件路径数组（`unmappedFiles: string[]`）。如果未来需要区分"新增 file，graph 还没 build" vs "文件已删除"等场景，再扩展为 `Array<{ file, reason }>`。

---

## 未决但可在 plan 阶段决议的细节（不阻塞 spec 定稿）

- query-helpers.ts 的反向邻接表 lazy 构建放 module-level singleton 还是 `engineCache` 里 attach？→ 留给 plan 阶段。
- baseline collector 在哪一个文件加 capability probe（"Agent-Context tools available"）？→ 留给 plan 阶段。
- detect_changes 的 git spawn 是否要支持非默认 cwd？→ 留给 plan 阶段（默认用 projectRoot）。
- impact tool 的 `reason` 字段格式（短文本 vs 结构化 path 数组）？→ 留给 plan 阶段（spec 中只说"含链路原因"）。
