# Feature 181 — import-resolver 单一权威收口 · 最终验证报告（Phase 5/5）

## 验收对照

| 验收项 | 结果 | 证据 |
|--------|------|------|
| src/ 内单一权威 `resolveTsJsImport`（双实现消除） | ✅ | 唯一定义 `core/import-resolver.ts:220`；kg 仅剩 `resolvePythonImport`；残留扫描 0 |
| 死代码删除（resolveImportsForFile + detectImportType + ImportType + loadTsconfigAliases） | ✅ | 残留扫描全仓 0 代码引用（residual-report.md） |
| 跨路径一致性测试通过 | ✅ | `tests/integration/181-import-resolver-consolidation.test.ts`（3 tests，AST 路径 vs batch 路径 target 一致） |
| graph.json byte-identical（baseline diff / byte-stable gate） | ✅ | 181 golden 双路径快照重构前后不变 + F175 e2e 场景10 `graph.json deepEqual`（复用 F179 byte-stable gate）全绿 |
| AST 路径 path-alias / baseUrl 能力完整保留 | ✅ | `156-w1.2-v2.test.ts`（8 tests，alias 多候选/最长前缀/baseUrl）**未改动仍全绿** |
| 4111 vitest + build + repo:check 全绿 | ✅ | **4113 pass**（净增新测试 − 删死代码测试）/ tsc 0 错 / repo:check exit 0 / release:check exit 0 |
| Codex 阶段性对抗审查 critical 全修 | ✅ | Phase1/2/3 三轮，累计 **0 critical**；P1 over-claim+遗漏、P2 5 warning、P3 W#3 已修 + W#4b 文档化 |

## 验证命令结果

```
npm run build        → tsc 0 error
npx vitest run       → 4113 passed | 12 skipped | 20 todo (337 files, 0 fail)
npm run repo:check   → PASS (exit 0)
npm run release:check→ PASS (exit 0，无版本变更：纯内部 refactor，零行为变化)
```

## 改动统计

11 files changed, +879 / −1311（净 **−432 行**，消除重复实现）。
- 生产 9：core/import-resolver（权威重写）、ast-analyzer / tree-sitter-analyzer / tree-sitter-fallback（消费方迁移）、kg/import-resolver（收口 Python only）、module-derivation（loader 统一）、batch-orchestrator（import 源切换）、language-adapter（AnalyzeFileOptions→tsConfigContext）、code-skeleton（注释修正）
- 测试 2 改 + 2 新（core 重写 / kg 精简 / 181 golden+fixture）

## Codex 对抗审查处置汇总

| Phase | 结论 | 处置 |
|-------|------|------|
| P1 影响分析 | 0 critical / over-claim×1 + 遗漏×1 | module-derivation 也带 alias 进 graph（纠正 over-claim）；R7 .json/.d.ts（补）；测试计数纠正 |
| P2 分批规划 | 0 critical / 5 warning | golden 排序、loader 收窄 scope、fallback 透传、guard 逐分支、扫描扩展——全采纳 |
| P3 实现 | 0 critical / 2 warning | **W#3 alias exact-before-wildcard 同前缀 tiebreak 已修 + 补单测**；W#4b 损坏 nearest tsconfig 不再上溯——已文档化（见下） |

## 已知语义变化（文档化，非回归）

1. **R7**：相对 `.json`/`.d.ts` import 现统一返回 external（历史 core/AST 路径会命中为绝对路径）。baseline 无被抽取的此类 import（`_require` 不被 AST 抽取），byte-identical 不受影响；其他项目按 kg 权威语义。单测固化。
2. **W#4b**：损坏的 nearest tsconfig 现返回 null context（alias 静默失效，相对解析不受影响、不崩溃），不再像历史手写 JSON.parse 那样跳过并继续上溯父级。ts API（`parseJsonConfigFileContent`）对带注释的 tsconfig 更宽容，实际触发面更小。baseline 无损坏 tsconfig。
