---
feature: 243-fix-mjs-graph-coverage
mode: fix
based_on: fix-report.md（方案 A）
---

# 修复规划：plugins/**/*.mjs 图覆盖盲区

## 摘要

三处白名单/镜像常量同步加 `.mjs`/`.cjs`（方案 A），闭合 `walkTsJsFiles` 扫描面与 `TsJsLanguageAdapter.extensions` 声明面的脱节。不引入新架构、不改消费方签名，属于纯扩展名集合扩容 + 同步测试 + 文档落账。显式不加 `.mts`/`.cts`（登记为已知残留，见 fix-report.md 方案 A 说明）。

## 变更清单（3 处源码 + 3 类测试 + 2 处文档，共 8 条）

### 源码改动

| # | 文件 | 位置 | 改动 |
|---|------|------|------|
| 1 | `src/batch/stages/source-discovery.ts`（582 行） | L509-514 `walkTsJsFiles` | `entry.isFile()` 分支 endsWith 判定加 `'.mjs'` `'.cjs'` 两个分支；同步更新 L392、L481 两处 docstring（"收集/扫描 .ts/.tsx/.js/.jsx 文件" → 补充 .mjs/.cjs） |
| 2 | `src/panoramic/graph/source-commit.ts`（203 行） | L36 `TSJS_COLLECTOR_EXTENSIONS` | `new Set(['.ts', '.tsx', '.js', '.jsx'])` → 加 `'.mjs', '.cjs'`；同步更新 L35 注释（"镜像 walkTsJsFiles 判定面"仍成立，无需改文字，只改集合字面量） |
| 3 | `src/panoramic/graph/quality/ignore-oracle.ts`（148 行） | L112 `TSJS_EXTENSIONS` | `new Set(['.ts', '.tsx', '.js', '.jsx'])` → 加 `'.mjs', '.cjs'` |

三处均为 `ReadonlySet<string>` 字面量扩容，不改函数签名、不改调用方，改动半径严格收敛在常量定义处。

### 测试同步

| # | 文件 | 改动 |
|---|------|------|
| 4 | `src/panoramic/graph/source-commit.test.ts` L242-252 | `getDirtySourceExtensions（FIX-4：一致性防漂移）` 测试用例的 `expected` 集合字面量加 `'.mjs', '.cjs'`——按其设计意图更新（镜像面本身扩容），非放宽断言强度 |
| 5 | 新建 `src/batch/stages/source-discovery.test.ts` | 新增回归测试：对临时目录 fixture 断言 `walkTsJsFiles`/`collectTsJsCodeSkeletons` 收集 `.mjs`/`.cjs` 文件（此前应为空结果，现为非空）；同时验证 `TSJS_SKELETON_IGNORE_DIRS` 命中目录内的 `.mjs` 仍被剪枝（防止误开大门） |
| 6 | `src/panoramic/graph/quality/ignore-oracle.test.ts`「按语言分派（FIX-5）」describe 块（L95 起） | 新增用例：`tmp/a.mjs → 仍 ignored`（对齐 L121 `.ts` 同款用例）+ `venv/a.mjs → 不 ignored`（对齐 L111 `.ts` 同款用例），验证 `.mjs` 正确路由到 TSJS 分支而非退回 union 兜底 |

### 文档落账

| # | 文件 | 改动 |
|---|------|------|
| 7 | `docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4（L254 附近） | 盲区条目状态更新为「已修复（F243）」，附修复后六指标对比摘要（节点/边数增量、orphan-ratio 是否维持达标） |
| 8 | （若批量再生产生噪声）`specs/src.spec.md` | 按既有惯例 `git checkout` 还原，不手改 |

## 回归风险评估

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| 图节点/边数增长 ~200 文件 | 白名单按扩展名生效，实际纳入面为全仓 git 管辖的 **197 个 .mjs + 3 个 .cjs**（scripts/ 105、plugins/ 84、tests/ 4 .mjs + 2 fixture .cjs、specs/ 4），非仅 plugins/ 84 个，全部零 gitignore 命中；`containsCoverage.total` / `orphanRatio.totalSymbolNodes` 等六指标计数基线会上移（before: 5099 symbol nodes, allNodeZeroDegreeRatio 2.18%） | 修复后重跑 `graph-quality --json` 逐指标对比 before/after，非"数字变了就是回归"，需判断变化方向是否符合"新增来自全仓 .mjs/.cjs"预期 |
| orphan-ratio 阈值 5% | 插件与 scripts/ 里均存在独立 CLI 入口脚本（无被 import），module 节点靠 contains 出边 + 自身 import 出边维持 degree>0；已在 fix-report「已验证的前提」中确认 `deriveContainsEdges` 语言无关。另注：scripts/ 下存在无 export、且只 import node: 内置模块的独立小脚本的可能——它们会成为 zero-degree module 节点（不计入 `orphanRatio` 分子，该指标只统计 symbol 节点；但 `allNodeZeroDegreeRatio` 展示值会上升，属预期内变化，验证时记录数值即可） | 若 `orphanRatio`（symbol 口径）after 超标，先核对 contains 边是否对 .mjs/.cjs 生效，而非放宽阈值口径 |
| `source-commit.ts` freshness 判定面扩大 | 此前对 `.mjs`/`.cjs` 的改动不会被判定为 dirty（因为不在 `TSJS_COLLECTOR_EXTENSIONS` 内），修复后会被纳入；这是**修正**而非回归，但会导致此前可能处于 "fresh" 状态的历史图在重新评估时改判为 "dirty"（若 .mjs/.cjs 有未反映在图里的改动历史） | 验证时预期 after 的 `freshness.state` 仍为 `fresh`（因为图会在修复后同一提交内重建，source commit 与图生成时刻一致） |
| `ignore-oracle.ts` 分派面变化 | `.mjs`/`.cjs` 此前落「未知扩展名 union 兜底」分支（`GRAPH_COLLECTOR_IGNORE_DIRS`，更保守/更宽的忽略集），修复后路由到 `TSJS_IGNORE_DIRS`（已知 `TSJS_SKELETON_IGNORE_DIRS ⊆ GRAPH_COLLECTOR_IGNORE_DIRS`，见 ignore-oracle.test.ts L28） | 分派后行为变**窄**（更少目录被判 ignored），与 walk 实际扫描面对齐是本次修复目的本身，非意外副作用；新增测试 #6 覆盖 |
| `.mts`/`.cts` 未覆盖 | 显式排除在本次范围外 | 登记为已知残留，M9 §7.5.4 文档落账时同步说明 |
| 调用方兼容性 | 三处改动均为常量字面量，无函数签名变化 | 全量 `npx vitest run` 兜底 |

**风险等级：LOW**——改动局限于 3 个常量定义 + 同步测试，无跨包 API 变更、无数据迁移；影响面是图产物内容（本地生成、不入库），非代码路径行为分支改变。

## 验证方案（5 步）

1. **实现三处源码改动 + docstring 同步**（变更清单 #1-3）。
2. **图重建对比**：
   - `npm run build`
   - `node dist/cli/index.js batch --mode graph-only`（重建 `specs/_meta/graph.json`）
   - `node dist/cli/index.js graph-quality --json > specs/243-fix-mjs-graph-coverage/verification/after-graph-quality.json`
   - 对比 before（`specs/243-fix-mjs-graph-coverage/verification/before-graph-quality.json`，已由编排器采集：5099 symbol nodes / containsCoverage 1.0 / orphanRatio.allNodeZeroDegreeRatio 0.0218 / duplicateCanonicalId pass / danglingEdges pass / legacyAndIgnoredNodes pass）与 after 六指标：
     - `duplicateCanonicalId`：预期仍 `pass`（`.mjs`/`.cjs` 不产生 canonical ID 冲突）
     - `containsCoverage`：预期 `total`/`covered` 同步上移（新增全仓 .mjs/.cjs symbol 数），`ratio` 维持 1
     - `orphanRatio`：预期 `allNodeZeroDegreeRatio` 不劣于 5% 阈值；重点核对新增节点是否落入 `offendingIds`
     - `danglingEdges`：预期仍 `pass`（.mjs/.cjs import 已带显式后缀，resolver 早已支持）
     - `legacyAndIgnoredNodes`：预期仍 `pass`
     - `freshness`：预期 `state: fresh`（图与 source commit 同一提交内重建）
   - 增量应可归因为全仓 197 个 `.mjs` + 3 个 `.cjs`（scripts/ 105、plugins/ 84、tests/ 6、specs/ 4，含 import/contains 边）；plugins/ 84 个是原始痛点子集，scripts/ 等同向纳入属预期增值。任何 `.mjs`/`.cjs` 之外来源的节点/边变化需追查原因。
3. **测试同步**（变更清单 #4-6）：`source-commit.test.ts` 断言更新、新建 `source-discovery.test.ts`、`ignore-oracle.test.ts` 新增用例，与源码改动同一提交。
4. **全量验证**：`npx vitest run` 零失败 + `npm run build` 零错误 + `npm run repo:check`（其 graph-quality 族门禁读本地 `specs/_meta/graph.json`，须先完成步骤 2 的图重建再跑，否则门禁读到的是修复前的旧图）。
5. **文档落账**（变更清单 #7）：`docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4 更新为已修复状态，引用 F243 与步骤 2 的六指标对比结论。

## 不在本次范围

- `.mts`/`.cts` 扩面（需要 `getLanguage`/scriptKind 联动修改，仓库零存量，见 fix-report 方案 A 说明）
- `walk` 改为直接消费 `TsJsLanguageAdapter.extensions`（方案 B，超出最小化变更范围，不采纳）
- `data-model-generator.ts` / `drift-orchestrator.ts` 的 `.ts`-only 面（独立特性域，fix-report 已判定安全不动）
