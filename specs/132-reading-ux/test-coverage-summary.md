---
feature: F5 Reading UX
branch: 132-reading-ux
phase: implement
subphase: step-5-test-coverage
created: 2026-04-20
---

# F5 测试覆盖率统计（T-050）

## 全量测试结果

```
命令: npx vitest run
退出码: 0
测试文件: 220 passed
测试用例: 2145 passed, 0 failed
运行时间: 约 53s
```

## F5 新增模块覆盖率（`npx vitest run --coverage`）

### `src/panoramic/qa/` — 问答后端（Step 2 / T-014~T-020）

| 文件 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
|------|---------|----------|---------|
| `citation.ts` | 82.03% | 64.51% | 100% |
| `debt-context.ts` | 100% | 78.57% | 100% |
| `graph-retriever.ts` | 97.77% | 92.85% | 100% |
| `llm-caller.ts` | 100% | 52% | 100% |
| `prompt-builder.ts` | 100% | 94.73% | 100% |
| `rag-reranker.ts` | 85.52% | 78.57% | 100% |
| **qa 整体** | **92.4%** | **74.24%** | **100%** |

> `types.ts` 覆盖率显示 0%（纯类型定义文件，无可执行语句，vitest coverage 不计入有意义覆盖数据）。

### 覆盖率目标验证

| 目标 | 状态 |
|------|------|
| F5 新增代码行覆盖率 ≥ 80% | ✅ 通过（qa/ 整体 92.4%） |
| F5 新增函数覆盖率 ≥ 80% | ✅ 通过（qa/ 整体 100%） |

## F5 新增测试统计

### 单元测试（新增）

| 测试文件 | 位置 | 测试数 | 覆盖 Task |
|---------|------|--------|---------|
| `graph-retriever.test.ts` | `tests/panoramic/qa/` | 9 | T-014 |
| `rag-reranker.test.ts` | `tests/panoramic/qa/` | 6 | T-015 |
| `debt-context.test.ts` | `tests/panoramic/qa/` | — | T-016 |
| `citation.test.ts` | `tests/panoramic/qa/` | — | T-017 |
| `prompt-builder.test.ts` | `tests/panoramic/qa/` | — | T-018 |
| `llm-caller.test.ts` | `tests/panoramic/qa/` | — | T-019 |
| `index.test.ts`（qa）| `tests/panoramic/qa/` | — | T-020 |
| `html-template.test.ts` | `tests/panoramic/` | 29 | T-029~T-037 |
| `batch-orchestrator.test.ts` | `tests/batch/` | — | T-007 |
| `batch-project-docs.test.ts` | `tests/batch/` | — | T-008 |
| `batch-mode-integration.test.ts` | `tests/batch/` | — | T-011 |
| `mcp-server.test.ts`（含 F5 扩展） | `tests/unit/` | — | T-010、T-023 |
| `panoramic-query-natural-language.test.ts` | `tests/unit/` | — | T-024 |

### 集成测试（新增）

| 测试文件 | 位置 | 覆盖 Task |
|---------|------|---------|
| `qa-integration.test.ts` | `tests/panoramic/qa/` | T-021（10 条，5 类问题 × mock Citation）|
| `panoramic-query-qna.test.ts` | `tests/mcp/__tests__/` | T-024 |
| `qna-e2e.test.ts` | `tests/mcp/__tests__/` | T-025 |

### E2E 测试（DEFERRED）

| 类型 | 覆盖 Task | 状态 |
|------|---------|------|
| 冷热启动性能测量 | T-041 / T-012 | [E2E_DEFERRED]（需 API Key）|
| 真实问答 5 类 × 15 次 | T-042 | [E2E_DEFERRED]（需 API Key）|
| Hyperedge Citation 验证 | T-043 | [E2E_DEFERRED]（需 API Key）|
| 浏览器 35 项验证 | T-047 | [MANUAL_DEFERRED]（需人工）|

## FR-Task-Test 覆盖矩阵

| FR | Task | 测试状态 |
|----|------|---------|
| FR-001~008（BatchMode + 轻量模式）| T-006~T-012 | ✅ 单测 + 集成测试绿 |
| FR-009~017（问答后端）| T-014~T-020 | ✅ 单测 + 集成测试绿 |
| FR-009 MCP 侧 | T-023~T-025 | ✅ MCP 单测绿 |
| FR-018~024（graph.html）| T-029~T-037 | ✅ 29 条单测绿 |

## 验证命令记录

```
npx vitest run — 220 test files, 2145 tests, 0 failed
npx vitest run --project unit tests/panoramic/qa/ — 148 tests, 0 failed
npx vitest run --project unit tests/panoramic/html-template.test.ts — 29 tests, 0 failed
npx vitest run --coverage — 退出码 0，qa/ 整体行覆盖率 92.4%
```
