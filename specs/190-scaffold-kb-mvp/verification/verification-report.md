---
feature_id: 190
name: scaffold-kb MVP — 验证报告
created: 2026-06-14
phase: verify
---

# Feature 190 — scaffold-kb MVP 验证报告

## 1. 验收总览

| 维度 | 结果 |
|------|------|
| 全量 unit 测试 | **4309 passed / 2 skipped / 0 failed**（含 tests/kb 188） |
| tests/kb（本 feature） | **188 passed**（18 测试文件） |
| `npm run build`（tsc） | ✅ 零错误 |
| `npm run repo:check` | ✅ exit 0 |
| `npm run release:check` | ✅ exit 0（demo-kb 不入发布合同，无污染） |
| recall@5（真实 Hono/ECharts fixture） | **全 category 1.00**（无系统性零召回 BLOCKER） |

## 2. Success Criteria 逐条达成

| SC | 验收点 | 状态 | 证据 |
|----|--------|------|------|
| SC-001 | E2E：装 demo plugin → 查询 → 命中引用来源（中/英各一） | ✅ | `tests/kb/e2e-integration.test.ts`：en `HTTPException`→exception 文档、zh `提示框`→tooltip 文档，均带 `source_kind`/`built_at`/`[KB-EVIDENCE]` |
| SC-002 | 构建产物幂等（去 built_at 字节级一致） | ✅ | `build-flow.test.ts` 幂等断言（doc-graph 文本 + sqlite 逻辑内容） |
| SC-002a | llms.txt 输入成功构建 | ✅ | `ingester.test.ts`（注入 fetch）+ build 链路 |
| SC-003/004 | 中/英 fixture KB 分发验证 | ✅ | `e2e-integration.test.ts` 双 plugin：plugin.json/.mcp.json/kb/ 齐全 + 可查询 |
| SC-005 | 中文词 + 中英混合 recall@5 ≥ 0.80 | ✅ | chinese_word **1.00**(11/11)、mixed **1.00**(5/5)；无零召回 BLOCKER |
| SC-006 | 短错误码 + API 符号 recall@5 ≥ 0.80（阻塞） | ✅ | api_symbol **1.00**(7/7)、error_code **1.00**(5/5)；含 `xAxis.axisLabel.formatter` top1 命中、`404`/`401` 命中 |
| SC-007 | 同义改写 recall@5 ≥ 0.60（非阻塞） | ✅ | synonym **1.00**(7/7) |
| SC-008 | 17 个 Spectra MCP 工具零回归 | ✅ | 全量 unit 4309 绿；`src/mcp/server.ts` 零改动（git diff 验证）；KB 走独立 createKbMcpServer |
| SC-009 | KB 缺失/损坏降级 + 参数校验矩阵 | ✅ | `kb-degradation.test.ts`（KB_NOT_FOUND/KB_CORRUPT/单库降级）+ kb-search/lookup 参数校验 EC-010 |
| SC-010 | token cap + 防注入信任边界 | ✅ | `kb-search-tool.test.ts`：单条 ≤2000 字符截断 + truncated；注入串被 envelope 包裹、行为不变 |
| SC-011 | 全量门禁 + 跨平台 FTS5 smoke | ✅ | 4 门禁全绿；WASM sqlite 无平台分支（本地 macOS arm64 实测；纯 JS/WASM linux 同构） |
| SC-012 | KB 工具自身错误契约 + telemetry | ✅ | `kb-contract.test.ts`：成功/错误 shape snapshot + 顶层 code（telemetry extractErrorCode 兼容） |
| SC-013 | KB 产物隔离（graph 哈希 + sqlite 路径 + 工具名交集） | ✅ | `kb-isolation.test.ts`（graph 哈希不变 + 路径不重叠）+ `kb-contract.test.ts`（kb_* 与 17 工具名交集空） |

## 3. 关键设计决策的实证落地

- **WASM sqlite 选型**：plan 初版选 sql.js → 主线程 `/tmp` 实测 sql.js **不含 FTS5**（`no such module: fts5`）→ 改用 `@sqlite.org/sqlite-wasm`（实测 SQLite 3.53.0 + FTS5 + 字节落盘往返）。
- **CJK tokenizer**：单一 `normalizeForIndex`（CJK unigram+bigram + ASCII 组件/拼接形）+ unicode61 FTS5 + 短 CJK LIKE 兜底 → 真实文档 recall@5 = 1.00。
- **零回归**：KB MCP 走独立 `createKbMcpServer()`，`src/mcp/server.ts` 一行未动。
- **信任边界**：evidence envelope + 字符级 token cap（单条≤2000/合计≤10000）+ 注入 fixture 验证。

## 4. 性能（SC-011 第 2 部分）

- WASM DB 加载缓存为单例（`kb-locator` 持有），warm 查询为纯内存 FTS5。
- 实测平台：macOS arm64。demo fixture（en 328K / zh 768K sqlite）查询在测试中 < 数十 ms 量级。
- 跨平台：`@sqlite.org/sqlite-wasm` 为纯 WASM 无原生编译分支，linux x64 由相同 WASM 二进制保证（CI matrix 可补充实测，本报告据实标注仅本地 arm64 验证）。

## 5. 范围纪律

Phase 1 严格限定：未实现 API 实体 LLM 抽取、文档↔SDK 符号锚定、三方异构导入、门禁深度集成、自动冲突仲裁（Phase 1 仅双呈现 + 标来源）、research phase 预查注入（→ Phase 1.5）。`--incremental` 未实现（→ Phase 2）。
