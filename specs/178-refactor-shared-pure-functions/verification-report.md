# Feature 178 — 最终验证报告（Phase 5/5）

## 验收对照

| 验收项 | 结果 |
|--------|------|
| `src/utils/string-distance.ts` 单一 levenshtein + 单测；两调用方零私有副本 | ✅ 残留扫描 0 命中（residual-report §1） |
| batch 内 normalizeProjectPath 单一来源（regen-plan 导出） | ✅ residual-report §2 |
| graph-builder upsertEdge/upsertNode 五路统一 + graph.json byte-stable 回归 | ✅ 见下 byte-stable |
| 现有 vitest pass + build + repo:check 零回归 | ✅ 4074 pass / tsc 0 / repo:check pass |
| Codex 阶段性对抗审查 critical 全修 | ✅ plan 0C/1W（已补记）、implement 0C/1W（git add 已落实） |

## 🔴 byte-stable 三重保证

1. **专用回归测试** `tests/unit/graph/graph-builder-bytestable.test.ts`：覆盖五路数据源（含同 ID 覆盖、
   directional、悬空边、callSitesCount）的确定性输入，`normalizeGraphForWrite(stripTimestamps)` 后
   `JSON.stringify(.,null,2)`（与 writeAtomicJson 同序列化）快照。golden 由提取前 HEAD 落盘，
   提取后重跑 **逐字节匹配**。
2. **既有 graph-builder 测试**：`graph-builder.test.ts`(13) + `graph-builder-normalize.test.ts`(8) 全绿。
3. **端到端独立验证**：F175 E2E 场景10（full 与无改动增量产物 graph.json deepEqual / SC-003）通过 ——
   经真实 batch 流水线确认 graph.json 未漂移。

## 验证命令与结果

```
npx vitest run               → Test Files 334 passed | 4 skipped；Tests 4074 passed | 12 skipped | 20 todo（0 失败）
npm run build (tsc)          → 零类型错误
npm run repo:check           → status=pass
npm run release:check        → Release contract valid（refactor 无发布字段改动）
```

## Codex 对抗审查归档

| Phase | 结论 | 处置 |
|-------|------|------|
| Plan | 0 CRITICAL / 1 WARNING（DocGraph upsertNode 依赖 specPath 去重的隐式前提未记录） | 已在 refactor-plan.md「Batch C 安全前提」补记 |
| Implement | 0 CRITICAL / 1 WARNING（新文件 string-distance.ts 未跟踪，需显式 git add） | 提交时已 `git add` 新文件；5 项等价性逐条核对确认 |

## 不在范围（future-milestone）

- panoramic 10+ 份双参 `normalizeProjectPath(inputPath, projectRoot)` 变体
- graph_node 复用 resolveSymbolFuzzy

## 交付顺序提醒

F178 触碰 `batch-orchestrator.ts`（normalizeProjectPath import）；F179 后续也碰同文件（`:1566` stripTimestamps）。
**F179 须在 F178 ship 后启动**，避免冲突。
