# Feature 195 验证报告（verification-report.md）

- **Feature**: 195-graph-only-zero-llm-build
- **模式**: spec-driver-story
- **验证时间**: 2026-06-13
- **结论**: ✅ 全部验收达成（零回归）

## 1. 验收标准（SC）逐项核查

| SC | 描述 | 证据 | 结论 |
|----|------|------|------|
| SC-001 | 零 LLM 硬门禁 + <2min 基准 | 实跑本仓库 graph-only：**2.8s** 墙钟（对照 batch code-only ~27min），零 LLM/零认证；spy 断言 generateSpec/anchor/hyperedge/embedding 调用=0 | ✅ |
| SC-002 | portable 守卫 + 可消费 | 实跑产物**绝对路径节点数=0**；schemaVersion 2.0、sources=[extraction,unified-graph]、节点 id 相对（如 `scripts/inline-d3.ts`）、calls 边已解析 → graph_node/impact 可消费 | ✅ |
| SC-003a | 零 LLM 断言（spy 调用计数） | `graph-only-pipeline.test.ts`：generateSpec/runAnchorIntegration/runHyperedgeIntegration/createEmbeddingProvider 均 0 次 | ✅ |
| SC-003b | 结构一致性（收窄） | 与「同款 primitives 重建」的 calls/depends-on 三元组 + Python component 节点子集完全相等；并 pin 具体拓扑（b.ts→a.ts、b.py→a.py depends-on） | ✅ |
| SC-003b2 | byte 稳定 | 连跑两次 graph.json 逐字节相等（stripTimestamps:true → generatedAt=epoch） | ✅ |
| SC-003b3 | 三语言矩阵 EC-002 | 仅 Python / 仅 TS / 混合 三 fixture 分别断言对应语言节点存在、无另一语言污染 | ✅ |
| SC-003c | 帮助文本字样 | `helptext.test.ts`（翻转 F183 红线）：index.ts 含 graph-only / 纯 AST / 零 LLM | ✅ |
| SC-003d | 无认证可跑 | `graph-only-cli.test.ts`：checkAuth=false 时 graph-only 仍产图、不被阻断；checkAuth 调用次数=0 | ✅ |
| SC-003e | 日志标识 | stdout 含「graph-only」「零 LLM」标识 | ✅ |
| SC-004 | 三 mode 零回归 | full/reading/code-only 既有测试全部不变且通过；stash 源改动确认 watch 失败为 base 即存在的 flaky | ✅ |
| SC-005 | TDD + 全量验证 | vitest 4395 passed（+2 新增回归测试）；npm run build 零错误；repo:check 全 pass | ✅ |

## 2. 工具链验证证据

```
npx vitest run        → 1 failed | 4395 passed | 16 skipped | 20 todo
                        （唯一失败 = tests/integration/watch-command.test.ts，
                          stash 源改动后 base 仍失败，pre-existing chokidar/fsevents flaky，非 F195 回归）
npm run build (tsc)   → 零类型错误
npm run repo:check    → 全部 pass（release-contract / namespace / preference-rules 等）
```

实跑基准（dist/cli/index.js batch --mode graph-only --output-dir /tmp/...）：
```
模式: graph-only（纯 AST · 零 LLM）
节点: 5183 | 边: 2503 (calls 821, depends-on 1667) | Python 符号: 15 | 耗时: 2.8s
schemaVersion 2.0 | sources [extraction,unified-graph] | 绝对路径节点数=0 | generatedAt=epoch
```

## 3. 回归护栏（NFR）核查

| NFR | 核查 | 结论 |
|-----|------|------|
| NFR-001 | runBatch / BatchMode / validModes 未改动；graph-only 在 batch.ts 层拦截，三 mode 路径逐字不变 | ✅ |
| NFR-002 | 复用 F183 writeKnowledgeGraph 出口（portable 守卫+normalizeGraphForWrite）；传 stripTimestamps:true → byte-stable；实跑绝对路径=0 | ✅ |
| NFR-003 | graph-only 不进入 runBatch，不触碰 F182 checkpoint/delta/状态机 | ✅ |
| NFR-004 | 无新增运行时/test 依赖 | ✅ |

## 4. Codex 对抗审查总览（三轮）

| 阶段 | 结论 | 处置 |
|------|------|------|
| Spec | 2 CRITICAL + 8 WARNING | 全部并入 spec（见 spec C-003） |
| Plan | 3 CRITICAL + 8 WARNING | 全部回灌 spec/plan/tasks（见 spec C-004）：纠正 FR-002 采集器口径、移除 --languages、stripTimestamps、断言收窄、三语言矩阵、mock 增补 |
| Implement | 0 CRITICAL，条件通过 | W2（MCP code-only「纯 AST」误标）已修；W3（回归测试）已补；W5（embedding spy）已补；W6（具体 tuple 断言）已补；W1（错误码）经核查与 batch 路径一致，保留；W4 经 round-2 判定全 batch 对比脆，改 pin 具体拓扑缓解 |

## 5. 实现要点

- 新增 `buildAstGraphOnly`（batch-orchestrator.ts，runBatch 本体零改动）：collectPython+collectTsJs（同 batch unifiedGraph 口径）→ buildUnifiedGraph → extractSymbolNodes → buildKnowledgeGraph（不传 doc/IR/crossref）→ writeKnowledgeGraph(stripTimestamps:true)。
- CLI：`spectra batch --mode graph-only`，batch.ts 在 config merge 后、checkAuth 前拦截，跳过认证。
- 附带：修正 MCP `code-only` 描述误标「纯 AST」+ graph-not-built 恢复提示改引导 graph-only。

## 6. 遗留 / Follow-up

- W-001：MCP `batch` 工具原生支持 graph-only schema（当前 MCP 仅 CLI 引导）→ 列后续 Feature 候选。
- 采集器扩展名 `.mjs/.cjs/.mts/.cts`：graph-only 继承 batch unifiedGraph 既有口径，扩展会改 batch 行为，超本 Feature 范围。
