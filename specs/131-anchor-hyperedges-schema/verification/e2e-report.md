# F4 Anchor 端到端验证报告（Commit 6）

**功能分支**: `131-anchor-hyperedges-schema`
**验证日期**: 2026-04-19
**验证人**: claude-sonnet-4-6（自动化）
**状态**: 40/40 Task 完成；所有自动化 AC 通过；Phase 7 verify 待执行

---

## 执行摘要

F4 Anchor 功能（函数级语义锚定 + Hyperedges + graph.json schema v2.0）共 6 个功能 commit 全部落地：

| Commit | SHA | 功能 | 新增测试 |
|--------|-----|------|---------|
| Commit 1 | 5844a45 | schema v2.0 独立升级（类型合同） | ~10 |
| Commit 2 | 8ab1de9 | anchoring 主体 + Local Provider | ~36 |
| Commit 3 | 248d6a2 | OpenAI fallback + factory | ~14 |
| Commit 4 | 207f3e1 | hyperedges + feature flag | ~27 |
| Commit 5 | 71f31ae | MCP 工具适配 + SKILL.md | ~11 |
| Commit 6 | (当前) | 端到端验证 + 降级 + e2e-report | 14 |

**全量测试结果**: 1867 tests passed, 0 failed（Commit 6 新增 14 个测试）

---

## AC 验证状态矩阵

| AC | 描述 | 验证类型 | 状态 | 证据 |
|----|------|---------|------|------|
| AC-001 | schemaVersion="2.0" | 自动化 | ✅ | `tests/fixtures/graph-v2.json` schemaVersion 字段；`tests/integration/design-doc-anchoring.test.ts` 断言 |
| AC-002 | ≥10 条语义边（evidenceText 非空，evidenceSource 格式正确） | 自动化（mock 确保确定性） | ✅ | `tests/integration/design-doc-anchoring.test.ts`：`result.edges.length >= 10` |
| AC-003 | INFERRED 假阳性率 <20%（人工抽样 ≥20 条） | 人工（交付后） | ⏸ 待执行 | N/A — Phase 7 真实项目运行后人工审查 |
| AC-004 | ≥1 hyperedge 含"全量摄取流程"类标签（真实 LLM） | 半自动 | ✅ (fixture) / ⏸ (真实 LLM) | `tests/fixtures/graph-v2.json` hyperedges 含 `he-001` label="全量摄取"；真实 LLM 提取待 Phase 7 |
| AC-005 | 纯代码项目零新边 | 自动化 | ✅ | `tests/integration/pure-code-degradation.test.ts`：6 个测试全通过 |
| AC-006 | `graph_hyperedges` 过滤（label/node_id/空参数） | 自动化 | ✅ | `tests/panoramic/graph-tools-v2.test.ts`：5 个测试全通过 |
| AC-007 | vitest 零新增失败 | 自动化 | ✅ | `npx vitest run`：1867 passed, 0 failed |
| AC-008 | build 零错误 | 自动化 | ✅ | `npm run build`：退出码 0，零类型错误 |
| AC-009 | schema 单测（SemanticEdgeRelation、Hyperedge、evidenceText） | 自动化 | ✅ | `tests/panoramic/graph-types-v2.test.ts` |
| AC-010 | direction-audit 通过新边类型（返回码 0，零方向违规） | 自动化 | ✅ | `tests/integration/direction-audit.test.ts` T008 套件 + `tests/integration/design-doc-anchoring.test.ts` 方向审计套件 |
| AC-011 | tokenUsage 含 llmModel + durationMs | 自动化 | ✅ | `tests/panoramic/anchoring/providers/local-provider.test.ts`；`tests/integration/design-doc-anchoring.test.ts` tokenUsage 断言 |
| AC-012 | schema 独立 commit（不混入 embedding/hyperedge 实现代码） | 人工代码审查 | ✅ | git log 显示 5844a45 为独立 schema commit；内容仅含 `graph-types.ts` + schema 单测 |

---

## 关键测试文件索引

### 新建于 Commit 6

| 文件 | 测试数 | 覆盖 AC |
|------|-------|--------|
| `tests/integration/pure-code-degradation.test.ts` | 6 | AC-005 |
| `tests/integration/design-doc-anchoring.test.ts` | 8 | AC-001, AC-002, AC-010, AC-011 |
| `specs/131-anchor-hyperedges-schema/verification/e2e-report.md` | — | AC 矩阵文档化 |

### 既有测试（Commit 1-5）

| 文件 | 主要覆盖 |
|------|---------|
| `tests/panoramic/graph-types-v2.test.ts` | AC-001, AC-009 |
| `tests/integration/direction-audit.test.ts` | AC-010（T008 套件） |
| `tests/panoramic/graph-tools-v2.test.ts` | AC-006 |
| `tests/panoramic/anchoring/providers/local-provider.test.ts` | AC-011 |
| `tests/panoramic/hyperedges/extractor.test.ts` | FR-017, FR-019, FR-020 |
| `tests/fixtures/graph-v2.json` | AC-001（schemaVersion="2.0"）, AC-004（hyperedge fixture）|

---

## 层 2：行为验证（E2E 路径）

### AC-002 happy path

```
行为：anchorDocToCode(design-doc-project fixture, mock provider) → result.edges.length >= 10
证据：tests/integration/design-doc-anchoring.test.ts 第 2 个 test case 已自动验证
```

### AC-005 happy path（降级）

```
行为：anchorDocToCode(markdownFiles=[]) → edges=[], tokenUsage=[], embed 未调用
证据：tests/integration/pure-code-degradation.test.ts 第 2 个 test case 已自动验证
```

### AC-004 真实 LLM 验证

```
状态：[E2E_DEFERRED]
原因：CI 环境不配置 ANTHROPIC_API_KEY；需要真实网络调用
风险标记：Phase 7 verify 阶段通过真实项目运行验证
```

---

## 层 3：失败路径验证

| 模块 | 失败场景 | 处理行为 | 验证文件 |
|------|---------|---------|---------|
| LocalEmbeddingProvider | @huggingface/transformers 不可用 | 抛出含安装指引的 Error（非 silent fail） | `local-provider.test.ts` 测试用例 1 |
| OpenAIEmbeddingProvider | API Key 未设置 | 抛出明确错误，不 silent fail | `openai-provider.test.ts` 测试用例 3 |
| OpenAIEmbeddingProvider | HTTP 500 错误 | 抛出错误，不静默返回空结果 | `openai-provider.test.ts` 测试用例 4 |
| extractHyperedges | LLM 网络错误 | 抛出异常（向上传播，不 silent fail） | `extractor.test.ts` LLM 网络错误套件 |
| extractHyperedges | Zod 校验失败 | 返回空数组 + failedSamples，trace 日志（设计允许的 silent 降级） | `extractor.test.ts` Zod 校验失败套件 |
| direction-audit | graph.json 不存在 | 退出码 1 + 明确错误消息 | `direction-audit.test.ts` 失败路径套件 |

**关键无裸 catch 核查（Layer 3 合规）**：
- `extractor.ts` 第 170-183 行：`catch {} catch {}` 双层 catch 处理 JSON 解析失败，均记录 trace 日志并返回带 failedSamples 的结果——非 silent fail（设计允许的降级）
- `anchorDocToCode` 零 chunk 路径：提前返回（不是 catch），属于正常控制流

---

## 待 Phase 7 verify 处理的事项

| 事项 | AC | 原因 | 风险评级 |
|------|-----|------|---------|
| AC-003 INFERRED 假阳性率 <20% 人工抽样 | AC-003 | 需要真实项目数据 + 人工审查 ≥20 条边 | 中 |
| AC-004 真实 LLM hyperedge 提取 | AC-004 | 需要 ANTHROPIC_API_KEY + 真实运行 | 低（fixture 已覆盖结构正确性）|

---

## 已知限制与范围外说明

1. **graph_community `hyperedgesInvolving` 适配延后**：FR-025（可选）标注为 Polish 阶段，未列入 T001-T040 必要任务范围
2. **CLI 层 `--hyperedges` argv 解析**：需要用户自行合并 env + argv 后传入 `doc-graph-builder` 的 `hyperedgesEnabled` option；extractor 本身已正确接收 `enabled` boolean，SKILL.md 已更新说明
3. **Local Embedding 冷启动时间**：NFR-001（<30s 冷启动，<200ms 单 chunk 推理）为运行时行为，仅在真实硬件环境可验证，CI mock 测试无法覆盖

---

## 指标汇总

| 指标 | 数值 |
|------|------|
| 总 Task 数 | 40 |
| 已完成 Task | 40 |
| 未完成 Task | 0 |
| 功能 Commit 数 | 6 |
| 全量测试数（Commit 6 后） | 1867 |
| Commit 6 新增测试数 | 14 |
| 自动化 AC 通过率 | 10/12（AC-003、AC-004 真实 LLM 部分待 Phase 7）|
| build 零错误 | ✅ |
| vitest 零失败 | ✅ |
