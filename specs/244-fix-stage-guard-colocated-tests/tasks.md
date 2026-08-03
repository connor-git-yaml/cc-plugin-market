---
feature: 244-fix-stage-guard-colocated-tests
mode: fix
input: plan.md, fix-report.md
---

# 任务清单: F244 F220 stage 依赖矩阵守护对共置测试的结构性误报

**改动范围**：仅 `tests/unit/batch/f220-export-surface.test.ts` 单文件（无生产代码改动，无跨文件依赖）。

## 任务列表

- [x] T001 收窄 `listStageFilesRecursive`：在 `tests/unit/batch/f220-export-surface.test.ts` 顶部新增
  `COLOCATED_TEST_RE = /\.(test|spec)\.(ts|mts)$/` 常量，并修改 `listStageFilesRecursive`（原
  L52-61）文件收集条件，追加 `&& !COLOCATED_TEST_RE.test(entry.name)` 排除共置测试文件

- [x] T002 提取纯函数 `collectStageViolations(stageFiles, stagesDir, facadePath, allowedEdges = ALLOWED_STAGE_EDGES)`：
  在 `tests/unit/batch/f220-export-surface.test.ts` 中，将原「stage 依赖矩阵」`it` 块内联判定逻辑
  （原 L136-168）逐字提取为该纯函数，仅将硬编码的 `STAGES_DIR`/`FACADE_PATH`/`ALLOWED_STAGE_EDGES`
  替换为形参，逻辑与消息文案保持一字不改
  - 依赖：T001（`collectStageViolations` 消费 `listStageFilesRecursive` 排除后的收集结果）

- [x] T003 改写既有「stage 依赖矩阵」`it` 块：改为调用 T002 提取的 `collectStageViolations(stageFiles,
  STAGES_DIR, FACADE_PATH)`，断言 `expect(violations).toEqual([])` 保持不变
  - 依赖：T002

- [x] T004 [P] 新增回归 `describe('F244 共置测试排除回归（收集器 + 违规判定纯函数）', ...)` 块，
  文件顶部补充 import：`mkdtempSync`、`mkdirSync`、`writeFileSync`、`rmSync`（来自 `fs`）、
  `tmpdir`（来自 `os`）；每个用例用 `mkdtempSync(join(tmpdir(), 'f243-stage-guard-'))` 构造独立
  fixture 目录，用例结束（`afterEach` 或用例内 finally）`rmSync(tmpDir, { recursive: true, force:
  true })` 清理
  - 依赖：T002（消费 `collectStageViolations` 与收窄后的 `listStageFilesRecursive`）

- [x] T005 [P] 新增绿用例（放行侧）：fixture `stages/a.ts`（`export function a() {}`）+ 共置
  `stages/a.test.ts`（`import { a } from './a.js'; ...`）；断言两条：
  (1) `listStageFilesRecursive(fixtureStagesDir)` 结果不含 `a.test.ts` 路径
  (2) `collectStageViolations(listStageFilesRecursive(fixtureStagesDir), fixtureStagesDir,
  fixtureFacadePath)` 返回 `[]`
  - 依赖：T004

- [x] T006 [P] 新增红用例 1（拦截侧，矩阵外 stage 间边）：fixture `stages/a.ts` import `./b.ts`
  （`stages/b.ts` 存在但非 `ALLOWED_STAGE_EDGES` 内允许边）；断言 `collectStageViolations(...)`
  结果包含 `"a.ts: 未授权 stage 依赖边 a.ts→b.ts"`
  - 依赖：T004

- [x] T007 [P] 新增红用例 2（拦截侧，import facade）：fixture `stages/a.ts` import 模拟 facade 路径
  （`../facade.ts`，facade 文件本身不必真实存在于磁盘）；断言 `collectStageViolations(...)` 结果
  包含以 `"a.ts: import facade"` 为前缀的 violation 消息
  - 依赖：T004

- [x] T008 手动红/绿双向验证（一次性、不进代码库）：临时把 `listStageFilesRecursive` 还原为收窄前的
  全收集逻辑，重跑 T005 绿用例，确认其先失败（复现 F243 遇到的误报场景）；随后恢复 T001 的收窄
  实现，重跑确认转绿——确认本次修复红/绿双向真实覆盖问题场景，而非只测放行侧
  - 依赖：T001, T005

- [x] T009 目标文件单测验证：`npx vitest run tests/unit/batch/f220-export-surface.test.ts`，确认
  4 个既有 `it` 块（T003 改写后）+ 新增 3 个用例（T005/T006/T007）全部通过
  - 依赖：T001, T002, T003, T005, T006, T007

- [x] T010 全量回归验证：`npx vitest run` 零失败（已知负载 flaky 名单——`watch-command`/
  `community-analysis` perf/`cli-e2e --version`/`batch-orchestrator-incremental`——若失败先隔离
  单独重跑定性，不计入本次回归判断）
  - 依赖：T009

- [x] T011 类型检查 + 构建验证：`npm run build` 零错误，确认新增 `describe`/纯函数提取无
  TypeScript 类型错误
  - 依赖：T009

- [x] T012 Codex 对抗审查轮增量（W1/W2 处置）：新增 `collectTestNamedImportViolations` 合同函数
  （生产文件禁止 import 测试命名模块）+ F220 `describe` 块内对应真实树合同 `it`；新增红③（facade
  经 import 测试命名文件反向拉测试图）、红④（测试命名 specifier 解析落在 stages 目录外）两个
  fixture 用例；扩展既有绿用例断言覆盖 `.spec.ts`/`a.ts` 组合；本轮追加红④断言加强（命中含文件名
  前缀的完整子串）与合同侧两处检测正则加 `/i`（大小写不敏感，扩大保护面；`COLOCATED_TEST_RE` 豁免
  侧保持大小写敏感，保守 fail-closed）
  - 依赖：T009, T010, T011

- [x] T013 Codex delta 轮增量（二跳桥接绕过 CRITICAL + resolveSpecifier 归一化 WARNING）：
  新增 `listColocatedTestFilesRecursive`（收集 stages/ 共置测试文件）+ `collectColocatedTestFacadeViolations`
  纯函数（共置测试禁止 import facade，不检查 stage→stage 边，保留 F243 合法用例）+ F220 `describe`
  块内对应真实树合同 `it`；`resolveSpecifier` 补 query/hash 剥离与 `cjs/cts` 后缀归一化；新增红⑤
  （共置测试 import facade 触发违规 + 同批 import stage 模块不触发）、红⑥（`?query`/`.cjs` 变体仍被
  `collectTestNamedImportViolations` 命中）两个 fixture 用例
  - 依赖：T012

## FR 覆盖映射

| 问题点（fix-report.md） | 对应任务 |
|---|---|
| `listStageFilesRecursive` 未排除共置测试文件（Root Cause） | T001 |
| 判定逻辑内联不可测（Why 5） | T002, T003 |
| 缺少红/绿双向回归用例 | T004, T005, T006, T007, T008 |
| 修复验证方案（plan.md 验证方案 1-3） | T009, T010, T011 |

## 依赖与并行说明

- 顺序依赖链：T001 → T002 → T003 → T004 → {T005, T006, T007 可并行} → T008 → T009 → {T010, T011 可并行}
- T005/T006/T007 标记 `[P]`：均为独立 `it` 用例，各自使用独立 `mkdtempSync` 临时目录，互不干扰，
  可并行编写（但同属 T004 describe 块内，需 T004 先落地骨架）
- T010/T011 标记依赖 T009 通过后并行执行（各自独立命令，互不影响）
- 本次修复不涉及 User Story 分组，全部任务归属同一单文件改动，按依赖顺序线性推进即可
- 推荐实施顺序：T001→T002→T003→T004→T005→T006→T007→T008→T009→T010→T011（严格遵循 plan.md 的
  「先改收集器→提取纯函数→改写既有用例→新增回归→手动双向验证→自动化验证」路径）
