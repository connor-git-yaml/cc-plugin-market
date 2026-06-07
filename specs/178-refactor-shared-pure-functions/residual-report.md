# Feature 178 — 残留扫描报告（Phase 4/5）

旧标识符提取后全仓库残留核对（`grep`）：

## 1. levenshtein 私有副本 → 0 残留 ✅

```
$ grep -rn "function levenshtein" src/ --include="*.ts"
src/utils/string-distance.ts:20:export function levenshtein(...)   # 唯一来源
```
两调用方均改为 import：
- `src/knowledge-graph/query-helpers.ts:32` `import { levenshtein } from '../utils/string-distance.js'`
- `src/panoramic/pipelines/adr-evidence-verifier.ts:17` `import { levenshtein } from '../../utils/string-distance.js'`

## 2. batch 单参 normalizeProjectPath 私有副本 → 0 残留 ✅

```
$ grep -rn "normalizeProjectPath" src/batch/
src/batch/regen-plan.ts:91: export function normalizeProjectPath(...)   # 唯一来源
src/batch/delta-regenerator.ts:16:   import { normalizeProjectPath, ... }
src/batch/batch-orchestrator.ts:41:  import { normalizeProjectPath, ... }
```
delta-regenerator / batch-orchestrator 仅保留 import + 调用点，本地定义已删。

> 排除项（保持不变，future-milestone）：panoramic 10+ 份双参变体 `(inputPath, projectRoot)`；
> `batch-orchestrator.ts:1801` 的 `path.relative(...).split(path.sep).join('/')` 是 relative+split 两步，非单参口径。

## 3. graph-builder 边 key 内联三元 → 收敛至 edgeKey() 单处 ✅

```
$ grep -n "? directedEdgeKey\|: undirectedEdgeKey" src/panoramic/graph/graph-builder.ts
73:    ? directedEdgeKey(source, target, relation)     # 仅 edgeKey() 内部 1 处
74:    : undirectedEdgeKey(source, target, relation);
```
原 5 处内联三元（含 unifiedGraph 路）全部改调 `edgeKey()`。

## 4. 死代码 / 未用导入核对（codex 复核 INFO）→ 无 ✅

- `directedEdgeKey` / `undirectedEdgeKey` 仍被 `edgeKey()` 引用，未孤儿化
- query-helpers / adr-evidence-verifier / delta-regenerator / batch-orchestrator 的 `path` import 仍有实际使用
- tsc 零未用变量错误

**结论：残留扫描 0 命中，3 类去重全部收口。**
