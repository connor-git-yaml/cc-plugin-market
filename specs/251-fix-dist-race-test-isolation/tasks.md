# 任务分解：dist/ 并发竞写导致测试假红（F251）

**输入**：[fix-report.md](./fix-report.md)（5-Why 根因）、[plan.md](./plan.md)（方案 A 实施细节）
**模式**：fix（快速问题修复，无 User Story 分层；按"新增基础设施 → 8 处调用点替换 → 验证"组织）

## Format: `[ID] [P?] 描述 + 文件路径`

- **[P]**：可并行（不同文件、无依赖）
- 同一文件内的多个任务不标 [P]（避免编辑冲突）

---

## Phase 1: 新增基础设施（Foundational — 阻塞后续所有替换任务）

**目的**：落地 globalSetup 单点构建脚本 + 共享 fail-fast helper，为 Phase 2 的 8 处替换提供依赖

- [x] T001 [P] 新增 `tests/global-setup.ts`：实现 `isDistFresh()`（mtime 比较 `FULL_BUILD_INPUT_PATHS` vs `dist/cli/index.js`，判据不确定/比较失败一律返回不新鲜）+ `setup()`（新鲜则跳过，否则 `execFileSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 180_000 })`）；`FULL_BUILD_INPUT_PATHS` = `BUILD_INPUT_PATHS`（从 `scripts/lib/spectra-version-gate.mjs` 导入，不修改该文件）+ `['scripts/inline-d3.ts', 'scripts/postbuild-stamp.mjs', 'scripts/lib/spectra-version-gate.mjs']`；实现严格对齐 plan.md 决策点 2 的伪代码骨架
- [x] T002 [P] 新增 `tests/helpers/dist-cli-guard.ts`：导出 `assertDistBuilt()`，仅做 `existsSync(resolve('dist/cli/index.js'))` 同步存在性断言，缺失时抛出 plan.md 决策点 3 给出的完整排查指引文案（三条排查项 + "临时手动修复：npm run build"）；不在函数内触发任何构建
- [x] T003 修改 `vitest.config.ts`：根级 `test.*`（与 `projects: [...]` 同级，紧邻 `maxWorkers` 声明之后）新增 `globalSetup: './tests/global-setup.ts'`；不改动 `projects` 数组内任何条目（依赖 T001）

**检查点**：`npx vitest run --project unit -t "__none__"`（或任意最小触发）能观察到 `[global-setup]` 日志打印且仅打印一次，确认接线生效，再进入 Phase 2

---

## Phase 2: 8 处 beforeAll 无条件/半条件 build 调用点替换

**目的**：移除全部测试执行期 `npm run build` 触发点，改为 `assertDistBuilt()` fail-fast 断言，消除竞写窗口

**依赖**：T002（`assertDistBuilt` 已存在可导入）

- [x] T004 [P] 修改 `tests/unit/graph-quality-core.test.ts` L83-86：删除 `execFileSync('npm', ['run', 'build'], ...)` 及其 `beforeAll` 第二参数超时，替换为 `beforeAll(() => { assertDistBuilt(); });`；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`
- [x] T005 修改 `tests/integration/cli-e2e.test.ts` L31-38（第一处 `describe`）：同上替换模式；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`（若已有其他 `../helpers/*` import，合并到同一 import 语句处或就近新增一行）
- [x] T006 修改 `tests/integration/cli-e2e.test.ts` L138-153（第二处 `describe`，"CLI 零认证隔离端到端测试"）：**只删除第 139 行 `execFileSync('npm', ['run', 'build'], ...)`，在原位置插入 `assertDistBuilt();`**，`fixtureDir`/`fakeHome`/`fakeBin`/`zeroAuthEnv` 等其余初始化逻辑保持原样不动、顺序不变（与 T005 同文件，需在 T005 完成后串行处理，避免同文件编辑冲突）
- [x] T007 [P] 修改 `tests/integration/init-e2e.test.ts` L41-48：同 T004 替换模式；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`
- [x] T008 [P] 修改 `tests/integration/graph-quality-cli.test.ts` L94-98：同 T004 替换模式；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`
- [x] T009 [P] 修改 `tests/unit/contracts/graph-quality-report-schema.test.ts` L92-97：同 T004 替换模式；新增 `import { assertDistBuilt } from '../../helpers/dist-cli-guard.js';`（注意该文件位于 `tests/unit/contracts/` 下，相对路径多一层）
- [x] T010 [P] 修改 `tests/integration/graph-quality-adversarial.test.ts` L55-60：将原"只判 `!existsSync(CLI_PATH)` 才 build"的半条件逻辑整体替换为 `beforeAll(() => { assertDistBuilt(); });`（同时闭合其"只判存在不判新鲜"的潜伏缺口，属 plan.md 记录的副作用）；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`
- [x] T011 [P] 修改 `tests/integration/graph-quality-lang-matrix.test.ts` L54-60：同 T010 替换模式；紧邻的 `GRAPH_PATH` pinned fixture 存在性检查 `beforeAll` 保持不动；新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js';`

**检查点**：`grep -rn "run.*build" tests/unit/graph-quality-core.test.ts tests/integration/cli-e2e.test.ts tests/integration/init-e2e.test.ts tests/integration/graph-quality-cli.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts tests/integration/graph-quality-adversarial.test.ts tests/integration/graph-quality-lang-matrix.test.ts` 应无匹配（`tests/global-setup.ts` 本身不在此清单内，其调用不受影响）

---

## Phase 3: 验证（Verification）

**目的**：确认修复闭合竞写窗口、新鲜度判据未被弱化、无回归

- [x] T012 执行 `npm run build` 一次，确认基线可编译，排除本次改动前既存的编译错误干扰后续判断
- [x] T013 执行 `npx vitest run` 全量跑一次，确认零失败；人工检视输出确认 `[global-setup]` 日志只出现一次"执行 npm run build"或"跳过构建"（而非按 project 数重复打印）（依赖 T001-T011 全部完成）
- [x] T014 满载全量复跑 ≥3 轮（不清 dist、不改动任何源文件）：`for i in 1 2 3; do npx vitest run || echo "FAIL round $i"; done`，全部零失败、零偶发，作为"竞写已消除"的直接证据（依赖 T013）。**证据**：mtime 锚点版 5 轮（`/private/tmp/claude-501/.../scratchpad/t014-rerun.log`）+ 内容指纹版 3 轮（`/private/tmp/claude-501/.../scratchpad/t014-final.log`）+ W1 三行收尾后封板版 3 轮（`/private/tmp/claude-501/.../scratchpad/t014-seal.log`），合计 11 轮满载复跑零用例失败，详见 `verification/verification-report.md` 「T014 证据核查」+「T014 终版证据」+「封板轮」三节
- [x] T015 TDD 语义回归确认：`touch src/cli/index.ts` 后单独跑 `npx vitest run tests/unit/graph-quality-core.test.ts`，确认 `[global-setup]` 日志显示"执行 npm run build"（证明新鲜度判据未被弱化为无条件跳过）；跑完后确认工作区无残留改动（`git status` 应只显示 mtime 变化不影响 git diff）（依赖 T013）
- [x] T016 变异验证：`grep -rn "run.*build" tests/` 确认除 `tests/global-setup.ts` 自身（人工甄别排除）外，无任何测试文件在测试执行期调用 `npm run build`（依赖 T004-T011 全部完成）
- [x] T017 执行 `npm run repo:check` 作为兜底回归确认，覆盖率门槛（80%/95%）应不受影响（本次改动不触及 `src/`）（依赖 T013）

---

## FR / 问题点覆盖映射表

| 来源问题点（fix-report / plan.md） | 覆盖任务 |
|---|---|
| Root Cause：dist/ 缺乏"构建期与消费期"时间隔离 | T001, T003 |
| 指纹双底座错位窗口（放大项） | T001（新鲜度判据保证 dist 与源同步后才被消费） |
| 5 处同源问题（fix-report 影响范围扫描） | T004, T005, T006, T007, T008 |
| 3 处新发现调用点（plan.md 修正表 #6-#8） | T009, T010, T011 |
| globalSetup 声明层级（根级 vs per-project，plan.md 决策点 1） | T003 |
| 共享 fail-fast helper 设计（plan.md 决策点 3） | T002 |
| 验证要求：build + 全量 vitest 零失败 | T012, T013 |
| 验证要求：满载全量复跑 ≥3 轮零偶发 | T014 |
| 验证要求：变异验证（grep 无运行期 build 残留） | T016 |
| 回归风险：TDD"先红"语义未被弱化 | T015 |
| 回归风险：repo:check / 覆盖率门槛不受影响 | T017 |

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（新增基础设施）**：无前置依赖，T001/T002 可并行；T003 依赖 T001（需先有 `tests/global-setup.ts` 文件路径存在才能在配置里引用）
- **Phase 2（8 处替换）**：依赖 Phase 1 完成（T002 提供 `assertDistBuilt`）；T004/T005/T007/T008/T009/T010/T011 互相并行（不同文件）；T006 与 T005 同文件（`cli-e2e.test.ts`），必须在 T005 完成后串行执行，避免编辑冲突
- **Phase 3（验证）**：依赖 Phase 1 + Phase 2 全部完成；T013 → T014、T013 → T015、T013 → T017 均需先跑通一次全量再展开；T016 只依赖 Phase 2 完成，可与 T013 并行

### 并行机会

- Phase 1：T001、T002 并行（不同新文件）
- Phase 2：除 T006（须在 T005 之后）外，T004/T005/T007/T008/T009/T010/T011 共 7 个任务可全部并行（各自独立文件）
- Phase 3：T016（grep 静态检查）可与 T013（跑测试）并行；T014/T015/T017 均需在 T013 确认零失败后再展开

---

## Implementation Strategy

### 推荐执行顺序（fix 模式，单线程收敛）

1. 完成 Phase 1（T001 → T003，T002 可与 T001 并行）
2. 完成 Phase 2 全部 8 处替换（T004-T011，注意 T006 排在 T005 之后）
3. **STOP and VALIDATE**：执行 Phase 3 全部验证任务（T012-T017），任一失败需回退定位对应 Phase 1/2 任务重做
4. 全部验证通过后方可进入 fix 模式的下一阶段（implement 收尾 / commit 前 Codex 对抗审查）

### 关键不变量（贯穿全部任务）

- 不发明 plan.md 之外的新改动（不新增/修改除 T001-T003 之外的配置字段，不触及 `src/` 生产代码）
- `scripts/lib/spectra-version-gate.mjs` 只被导入消费，不修改其任何导出
- 8 处替换任务均不删除各文件内其他位置继续使用的 `execFileSync`（如 `gitConfig`/`runCLI`/`initGitRepoWithCommit` 等 helper 用途）
