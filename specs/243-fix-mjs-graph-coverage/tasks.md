---
feature: 243-fix-mjs-graph-coverage
mode: fix
based_on: plan.md（方案 A）
---

# 修复任务清单：plugins/**/*.mjs 图覆盖盲区

## 交付约束

**本次修复源码改动（T001-T003）+ 测试同步（T004-T006）+ 图重建验证（T007-T008）+ 文档落账（T009）必须在同一次提交中交付**（plan.md「不在本次范围」之外不引入任何额外改动；`fix-report.md`/`plan.md` 已在前序 commit）。提交前必须完成 T010 全量验证零失败/零错误。

## 任务列表

- [x] T001 修改 `src/batch/stages/source-discovery.ts` L509-514 `walkTsJsFiles` 的 `entry.isFile()` 分支，在 endsWith 判定中加入 `.mjs`/`.cjs` 两个分支；同步更新 L392、L481 两处 docstring（"收集/扫描 .ts/.tsx/.js/.jsx 文件" 补充为含 .mjs/.cjs）
  - 验证方式：目视 diff 确认判定分支与两处 docstring 文案一致；暂不单独跑测试（由 T005 覆盖）

- [x] T002 修改 `src/panoramic/graph/source-commit.ts` L36 `TSJS_COLLECTOR_EXTENSIONS` 集合字面量，由 `new Set(['.ts', '.tsx', '.js', '.jsx'])` 扩为加入 `'.mjs', '.cjs'`；L35 注释文字（"镜像 walkTsJsFiles 判定面"）保持不变，无需改写
  - 验证方式：目视 diff 确认仅集合字面量变化，注释文字未改；由 T004 断言覆盖
  - 依赖：无（可与 T001、T003 并行编写，但同一提交）

- [x] T003 修改 `src/panoramic/graph/quality/ignore-oracle.ts` L112 `TSJS_EXTENSIONS` 集合字面量，加入 `'.mjs', '.cjs'`
  - 验证方式：目视 diff；由 T006 断言覆盖
  - 依赖：无（可与 T001、T002 并行编写，但同一提交）

- [x] T004 更新 `src/panoramic/graph/source-commit.test.ts` L242-252 `getDirtySourceExtensions`（FIX-4 一致性防漂移）测试用例的 `expected` 集合字面量，加入 `'.mjs', '.cjs'`——按其设计意图更新（镜像面本身扩容），非放宽断言强度
  - 验证方式：`npx vitest run src/panoramic/graph/source-commit.test.ts` 通过
  - 依赖：T002（集合字面量已同步扩容，否则测试会因不匹配而失败，属预期驱动顺序）

- [x] T005 新建 `src/batch/stages/source-discovery.test.ts`：新增回归测试，对临时目录 fixture 断言 `walkTsJsFiles`/`collectTsJsCodeSkeletons` 能收集 `.mjs`/`.cjs` 文件（此前应为空结果，现为非空）；同时验证 `TSJS_SKELETON_IGNORE_DIRS` 命中目录内的 `.mjs` 仍被剪枝（防止误开大门）
  - 验证方式：`npx vitest run src/batch/stages/source-discovery.test.ts` 通过，用例覆盖「收集到」与「忽略目录仍剪枝」两个断言
  - 依赖：T001（源码改动落地才能通过新测试）
  - **实施偏差（执行期发现）**：文件落在 `tests/batch/source-discovery.test.ts` 而非计划的
    `src/batch/stages/source-discovery.test.ts`。原因：F220 stage 依赖矩阵守护
    （`tests/unit/batch/f220-export-surface.test.ts`）把 `src/batch/stages/**/*.ts` 全量视为 stage 模块，
    共置测试 import 被测模块会被判为「未授权 stage 依赖边」（实测该守护红）。
    选择迁移测试位置而非放宽守护判定面——守护的目标是生产 stage 间的 ESM 环/TDZ 风险，
    放宽它属于为迁就本次改动削弱门禁。`tests/batch/**` 已在 vitest unit project include 内，执行面不变。

- [x] T006 在 `src/panoramic/graph/quality/ignore-oracle.test.ts`「按语言分派（FIX-5）」describe 块（L95 起）新增两个用例：`tmp/a.mjs → 仍 ignored`（对齐 L121 `.ts` 同款用例）+ `venv/a.mjs → 不 ignored`（对齐 L111 `.ts` 同款用例），验证 `.mjs` 正确路由到 TSJS 分支而非退回 union 兜底
  - 验证方式：`npx vitest run src/panoramic/graph/quality/ignore-oracle.test.ts` 通过
  - 依赖：T003（集合字面量已同步扩容）

- [x] T007 图重建：`npm run build` → `node dist/cli/index.js batch --mode graph-only`（重建 `specs/_meta/graph.json`，本地产物不入库）
  - 验证方式：命令零错误退出，`specs/_meta/graph.json` mtime 更新
  - 依赖：T001-T003（源码改动须先落地并编译，否则重建的图仍是修复前形态）

- [x] T008 图质量对比：`node dist/cli/index.js graph-quality --json > specs/243-fix-mjs-graph-coverage/verification/after-graph-quality.json`，与既有 `verification/before-graph-quality.json`（5099 symbol nodes / containsCoverage ratio=1 / orphanRatio.allNodeZeroDegreeRatio 0.0218 / duplicateCanonicalId pass / danglingEdges pass / legacyAndIgnoredNodes pass）逐指标对比，确认：
  - `duplicateCanonicalId` 仍 pass
  - `containsCoverage.total`/`covered` 同步上移，`ratio` 维持 1
  - `orphanRatio.allNodeZeroDegreeRatio` 不劣于 5% 阈值，重点核对新增节点是否落入 `offendingIds`
  - `danglingEdges` 仍 pass
  - `legacyAndIgnoredNodes` 仍 pass
  - `freshness.state` 为 `fresh`
  - 增量可归因为全仓 197 个 `.mjs` + 3 个 `.cjs`（scripts/ 105、plugins/ 84、tests/ 6、specs/ 4，含 import/contains 边）；任何该范围之外来源的节点/边变化需追查原因
  - 验证方式：目视对比 before/after JSON 两文件字段，逐条记录结论于交付说明；若某指标劣化需回到 T001-T003 排查（不放宽阈值口径）
  - 依赖：T007（图必须重建完成）
  - **实测偏差 1（freshness）**：after `freshness.state = dirty` 而非计划预期的 `fresh`。
    原因是本次交付约定「实现子代理不执行 commit」，图重建时工作树带着本次未提交改动；
    `dirtyFiles` 恰为本次 6 个改动文件，`graph-quality:freshness` 门禁仍 pass、`overallVerdict` 仍 pass。
    **提交后须重建一次图**，否则 `recordedSourceCommit` 落后于新 HEAD 会转为 `stale`。
  - **实测偏差 2（归因方法）**：归因未用目视，改为脚本做节点 id 集合差集（before 图按修复前源码重新构建，
    与 after 同一工作树状态，隔离掉新增测试文件的干扰）。

- [x] T009 文档落账：更新 `docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4（L254 附近）盲区条目状态为「已修复（F243）」，附 T008 六指标对比摘要（节点/边数增量、orphan-ratio 是否维持达标）
  - 验证方式：目视 diff 确认条目状态与摘要数字来自 T008 实测结果，非占位符
  - 依赖：T008（需要实测数据才能落账，不能先写后补数）

- [x] T010 全量验证：`npx vitest run` 零失败 + `npm run build` 零错误 + `npm run repo:check`（repo:check 的 graph-quality 族门禁读本地 `specs/_meta/graph.json`，须在 T007 图重建之后执行，否则门禁读到修复前旧图）
  - 验证方式：三条命令均零失败/零错误退出，作为提交前最终关卡
  - 依赖：T001-T009 全部完成（T004-T006 测试新增/更新须先落地，T007-T008 图须已是修复后的新图）

- [~] T011（未触发）若批量再生产生噪声，`specs/src.spec.md` 按既有惯例 `git checkout` 还原，不手改
  - 验证方式：`git status` 确认该文件无未预期改动
  - 依赖：T010 之后、提交之前的最终检查

## 依赖链摘要

T001/T002/T003（源码三处并行编写）→ T004/T005/T006（对应测试同步，各自依赖对应源码改动）→ T007（build + graph-only 重建）→ T008（六指标 before/after 对比）→ T009（文档落账，需 T008 实测数字）→ T010（全量验证，收口关卡）→ T011（噪声清理，若触发）。全部任务必须在同一提交中交付，不允许拆分为多次提交。

## FR 覆盖映射（对齐 plan.md 变更清单 8 条）

| plan.md 变更清单 # | 内容 | 对应任务 |
|---|---|---|
| 1 | walkTsJsFiles 白名单 + docstring | T001 |
| 2 | TSJS_COLLECTOR_EXTENSIONS 镜像 | T002 |
| 3 | ignore-oracle TSJS_EXTENSIONS | T003 |
| 4 | source-commit.test.ts 断言更新 | T004 |
| 5 | 新建 source-discovery.test.ts | T005 |
| 6 | ignore-oracle.test.ts 新增用例 | T006 |
| 7 | M9 §7.5.4 文档落账 | T009 |
| 8 | src.spec.md 噪声还原（条件触发） | T011 |
| 验证步骤 1 | 实现三处源码改动 | T001-T003 |
| 验证步骤 2 | 图重建对比 | T007-T008 |
| 验证步骤 3 | 测试同步 | T004-T006 |
| 验证步骤 4 | 全量验证 | T010 |
| 验证步骤 5 | 文档落账 | T009 |
