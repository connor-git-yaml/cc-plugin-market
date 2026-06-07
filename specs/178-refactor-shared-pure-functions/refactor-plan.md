# Feature 178 — 分批规划（Phase 2/5）

> 3 个互不依赖的提取批次，可独立验证。TDD 顺序：RED（单测先行）→ GREEN（逐批提取）。
> 每批后跑 `tsc --noEmit` + 该批相关 vitest；全部完成后残留扫描 + 全量验证。

## RED 阶段（先于所有 GREEN 批次）

**目标**：单测 scaffolding 先红，锁定行为契约。

1. `tests/unit/string-distance.test.ts`（新建）
   - 边界：空串 a/b、单字符、相同串（dist=0）
   - DP 正确性：`kitten`↔`sitting`=3、`flaw`↔`lawn`=2、大小写敏感
   - 对称性：`lev(a,b) === lev(b,a)`
   - 长度差：长串性能不退化（不强测时间，测正确值）
   - import 自 `../../src/utils/string-distance.js`（此时文件不存在 → RED）
2. `tests/unit/graph/graph-builder-upsert.test.ts`（新建）
   - `upsertEdge`：新边插入；同 key 高 confidenceScore 覆盖；低 confidenceScore 不覆盖；directed/undirected key 区分
   - `upsertNode`：新节点插入；同 id metadata 合并（last-write-wins）；首次插入无 existing
   - byte-stable 回归：构造覆盖 5 路数据源的 `BuildGraphOptions`，断言 `buildKnowledgeGraph` 输出
     与「提取前快照」`JSON.stringify` 完全相等（快照在 GREEN 前用当前 HEAD 产物 capture）
   - import `upsertEdge`/`upsertNode` 自 graph-builder.js（此时未导出 → RED）

> RED commit：`test(178): string-distance + upsert helper 单测 scaffolding — RED phase`

## GREEN 批次

### Batch A — levenshtein → string-distance.ts
1. 新建 `src/utils/string-distance.ts`：导出 `levenshtein(a, b): number`（采用 query-helpers 版的
   长度差剪枝注释 + 滚动数组实现；两版逻辑等价，取信息更全的一版）。
2. `src/knowledge-graph/query-helpers.ts`：删 `levenshtein` 私有定义（含 463-466 注释），
   顶部 `import { levenshtein } from '../utils/string-distance.js'`。调用点 `levenshtein(...)` 不变。
3. `src/panoramic/pipelines/adr-evidence-verifier.ts`：删私有定义（164-189 区段），
   `import { levenshtein } from '../../utils/string-distance.js'`。调用点不变。
4. 验证：`tests/unit/string-distance.test.ts` 转绿 + query-helpers/fuzzy + adr-evidence 既有测试全绿。

> GREEN commit（合并）：`refactor(178): 抽取三个共享纯函数 — GREEN phase`

### Batch B — normalizeProjectPath（batch 单参）→ regen-plan 导出
1. `src/batch/regen-plan.ts`：`function normalizeProjectPath` → `export function normalizeProjectPath`
   （JSDoc 保留「与 batch-orchestrator / delta-regenerator 一致」措辞改为「batch 内统一来源」）。
2. `src/batch/delta-regenerator.ts`：删 399-401 私有定义，import 列表加 `normalizeProjectPath`
   （现有 `import { resolveSourceTarget } from './regen-plan.js'`）。调用点不变。
3. `src/batch/batch-orchestrator.ts`：删 434 行 `const normalizeProjectPath = ...` arrow，
   import 列表加 `normalizeProjectPath`（现有 `import { resolveRegenPlan, resolveSourceTarget, type RegenPlan }`）。
   保留同作用域的 `toProjectPath`（不在范围）。调用点 764/772/866/1107 不变。
4. 验证：`tests/batch/**` + delta-regenerator/batch-orchestrator 既有测试全绿。

### Batch C — graph-builder upsert（🔴 byte-stable）
1. `src/panoramic/graph/graph-builder.ts` 文件内新增 3 个 helper（紧邻现有 edge key 函数）：
   - `edgeKey(source, target, relation, directed): string` —— 收敛 `directed?directedEdgeKey:undirectedEdgeKey` 三元
   - `upsertEdge(edgeMap, edge, directed): void` —— confidence-max-wins
   - `upsertNode(nodeMap, node): void` —— last-write-wins + metadata 合并
2. 替换 4 条同质边路（DocGraph/ArchitectureIR/CrossReference/Extraction）为 `upsertEdge(edgeMap, edge, directed)`。
3. 替换 3 条节点路（DocGraph specs/ArchitectureIR/Extraction）为 `upsertNode(nodeMap, node)`。
4. 🔴 unifiedGraph 第 5 路：仅把 key 派生改为 `edgeKey(ugEdge.source, ugEdge.target, ugEdge.relation, isDirectional)`；
   节点 first-write-wins + callSitesCount 扩展、边 directional 升级合并 **保持原样不动**。
5. 导出 `upsertEdge`/`upsertNode`（供单测）；`edgeKey` 视测试需要决定是否导出。
6. 验证：`graph-builder-upsert.test.ts`（含 byte-stable）+ 既有 `graph-builder.test.ts` /
   `graph-builder-normalize.test.ts` 全绿。

#### 🔒 Batch C 安全前提（codex plan review W-1 补记）

- **DocGraph specs 路（L94-109）依赖 `docGraph.specs` 不含重复 `specPath`**。`buildDocGraph`
  内部用 `Map<specPath, node>` 去重已保证此条件，但 `buildKnowledgeGraph` 函数签名本身不校验。
  原代码裸 `nodeMap.set` 对重复 id 是"后者完全覆盖前者"；`upsertNode` 改为
  `{...existing.metadata, ...node.metadata}` 合并 —— 当且仅当存在重复 specPath 且两节点 metadata
  键集不同时，二者才会产生差异（合并保留旧键 vs 完全覆盖）。
- 结论：生产路径（buildDocGraph 去重）下 **byte 等价成立**；byte-stable 回归测试只需保证输入不含
  重复 specPath（与生产一致）。若未来有自定义调用方传入重复 id 的 DocGraph，需单独评估——本 Feature 不引入此场景。

## Phase 4 — 残留扫描

```bash
# levenshtein 私有副本应为 0（仅留 import + 注释引用）
grep -rn "function levenshtein" src/ --include="*.ts"
# batch 单参 normalizeProjectPath 私有副本应为 0（regen-plan 为 export 唯一来源）
grep -rn "normalizeProjectPath" src/batch/ --include="*.ts"
# 排除清单核对：panoramic 双参变体保持不变
```

## Phase 5 — 最终验证

- `npx vitest run` 全量零失败（基线 ~4035 测试用例）
- `npm run build` 类型检查零错误
- `npm run repo:check`
- byte-stable：graph-builder-upsert 回归 + 如有 baseline fixture 跑 `npm run baseline:diff`
- 每 phase 收口跑 codex 对抗审查；critical 全修

## 批次依赖

A / B / C 三批写入路径 disjoint，无相互依赖；可任意顺序。建议 A→B→C（C 风险最高放最后，前两批先稳住测试基线）。
