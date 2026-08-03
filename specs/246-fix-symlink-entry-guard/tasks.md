# 任务清单：symlink 入口守卫恒 false 静默假成功

**Feature**: 246-fix-symlink-entry-guard
**模式**: fix（精简任务清单，不展开 User Story 树）
**前序制品**: `fix-report.md`（5-Why + 影响面）、`plan.md`（修复设计，本清单直接采信其判定式清单与文件路径，不重复摘抄）

---

## T001 新建 canonical helper

**文件**：`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（新建）

- 按 plan.md §1.1 实现 `isInvokedDirectly(moduleUrl)`：`argv[1]` 缺失 → false；两侧各自 `fs.realpathSync`，失败回退 `path.resolve`
- **完成判据**：文件存在，导出 `isInvokedDirectly`，`node -e "import('...').then(m=>console.log(typeof m.isInvokedDirectly))"` 输出 `function`

**依赖**：无，可立即开始

---

## T002 新建仓库根薄壳 [P]

**文件**：`scripts/lib/is-invoked-directly.mjs`（新建）

- 单行 re-export：`export { isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/is-invoked-directly.mjs';`
- **硬性约束**：只准 re-export，禁止复制实现（F241 T027a 教训）
- **完成判据**：文件仅含该行 export 语句（含 license/注释外无其他逻辑代码），`node -e "import('./scripts/lib/is-invoked-directly.mjs').then(m=>console.log(typeof m.isInvokedDirectly))"` 输出 `function`

**依赖**：T001（re-export 目标须先存在）

---

## T003 替换批 A：scripts/ 顶层 14 处

**文件**（逐一替换判定式为 `import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';` + `isInvokedDirectly(import.meta.url)`，中间变量名保留不变）：

1. `scripts/baseline-collect.mjs`（L887-889）
2. `scripts/calibrate-glm-judge.mjs`（L1231）
3. `scripts/eval-calibrate.mjs`（L520）
4. `scripts/eval-offline-rejudge.mjs`（L476）
5. `scripts/eval-pool-rerun.mjs`（L448）
6. `scripts/eval-split-sets.mjs`（L244）
7. `scripts/eval-task-runner.mjs`（L1083）
8. `scripts/eval-validate.mjs`（L414）
9. `scripts/freeze-preregistration.mjs`（L122）
10. `scripts/graph-accuracy.mjs`（L626）
11. `scripts/spec-drift-cli.mjs`（L281）
12. `scripts/spike-cohort3-plugin-mcp.mjs`（L360）
13. `scripts/swe-bench-verified-cohort-batch.mjs`（L590）
14. `scripts/verify-feature-176.mjs`（L205）

**必查显式检查项（plan.md 已抓的三个细节，逐条核对）**：

- [ ] `scripts/baseline-collect.mjs` L887-889：原判定式是**一个 `||` 表达式跨两行**（非两处独立判定），必须整表达式一次性替换为单行 `const isCliEntry = isInvokedDirectly(import.meta.url);`，不得只改其中一行或留下死代码残留
- [ ] `scripts/spec-drift-cli.mjs` L281：替换判定式后，**连带删除**该文件顶部孤儿的 `pathToFileURL` import（已核实全文件仅本处引用），并清理 L278-280 已过时的注释（说明为何不再手拼 file:// 字符串，改为说明改用共享 helper）
- [ ] `scripts/calibrate-glm-judge.mjs` L1231：**保留** `__filename`（L76 `fileURLToPath(import.meta.url)`）声明，不得删除——L77 的 `__dirname` 仍依赖它

**通用检查项**：每处替换后确认 `path` / `fileURLToPath` 是否仍被文件内其他代码使用（除上述 spec-drift-cli 外均有其他用途，不需清理）

**完成判据**：14 个文件的手写判定式全部消失，均改为调用 `isInvokedDirectly`；`grep -rn "argv\[1\]" scripts/*.mjs` 命中数从 14 降为 0（不含 endsWith/business-arg 类已定性安全的站点）

**依赖**：T002

---

## T004 替换批 B：scripts/lib/swebench-dataset-build.mjs（同目录特殊 import 路径）[P]

**文件**：`scripts/lib/swebench-dataset-build.mjs`（L113）

- import 路径为**同目录**相对路径 `./is-invoked-directly.mjs`（无 `lib/` 前缀，区别于 T003 批的 `./lib/is-invoked-directly.mjs`）
- if 语句形式，条件整体替换为 `isInvokedDirectly(import.meta.url)`

**完成判据**：import 语句为 `import { isInvokedDirectly } from './is-invoked-directly.mjs';`，判定式替换完成

**依赖**：T002

---

## T005 替换批 C：plugins/spec-driver/scripts/ 下 8 处

**文件**（全部判定式相同：`if (import.meta.url === \`file://${process.argv[1]}\`) {`，逐字替换为 `if (isInvokedDirectly(import.meta.url)) {`，import 路径统一 `./lib/is-invoked-directly.mjs`）：

1. `plugins/spec-driver/scripts/generate-adoption-insights.mjs`（L566）
2. `plugins/spec-driver/scripts/generate-product-entity-catalog.mjs`（L468）
3. `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`（L9）
4. `plugins/spec-driver/scripts/generate-product-scorecards.mjs`（L9）
5. `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`（L605）
6. `plugins/spec-driver/scripts/generate-workflow-registry.mjs`（L12）
7. `plugins/spec-driver/scripts/record-workflow-run.mjs`（L403）— **风险最高**：各 SKILL 收尾直调此脚本记录 run 事件，symlink 插件安装目录下修复前静默丢事件
8. `plugins/spec-driver/scripts/sync-merge-engine.mjs`（L659）

**完成判据**：8 个文件判定式全部替换为 `isInvokedDirectly(import.meta.url)`；`grep -rln "file://\${process.argv\[1\]}" plugins/spec-driver/scripts/*.mjs` 命中数为 0

**依赖**：T001（这批走 canonical，非薄壳）

---

## T006 [P] 新增 helper 单元测试

**文件**：`plugins/spec-driver/tests/is-invoked-directly.test.mjs`（新建，走 `node --test`）

- case 1 direct：mock `argv[1]` 为脚本自身真实路径 → 返回 `true`
- case 2 imported：`argv[1]` 为另一文件路径 → 返回 `false`
- case 3 `argv[1]` 缺失 → 返回 `false`，不抛错
- case 4 realpath 失败回退：`argv[1]` 指向不存在路径 → 不抛错，走 `path.resolve` 回退分支，结果 `false`
- 每个 case 用 `beforeEach`/`afterEach` 保存并恢复 `process.argv`

**完成判据**：`npm run test:plugins` 中该文件 4 个 case 全绿

**依赖**：T001

---

## T007 红测试：symlink 集成测试（复现 bug 的核心证据）

**文件**：`plugins/spec-driver/tests/is-invoked-directly.test.mjs`（同 T006 文件追加，或拆分为独立文件均可，最终以能被 `npm run test:plugins` 收集为准）

- `fs.mkdtempSync` + `fs.symlinkSync` 建符号链接目录（模式对齐 F241 `graph-bootstrap-status-shim.test.mjs`）
- 经符号链接路径 `spawnSync('node', [symlinkPath + '/plugins/spec-driver/scripts/record-workflow-run.mjs', ...])` 实跑，**先断言副作用**（`.specify/runs/*.jsonl` 真实落盘、内容含 `workflowId`/`runId`），`res.status === 0` 仅作辅助信号
- 第二用例：经符号链接路径实跑 `scripts/verify-feature-176.mjs --test-mode`，断言 stdout 至少 1 行可解析为 `{ step, ok, detail }` 的 JSON（证明 main() 确实执行，而非空 stdout）
- `afterEach` 清理临时目录

**完成判据**：修复前（临时 revert T003/T005 手工验证或凭 fix-report probe 结论）该测试应失败；修复后两个用例全绿；`npm run test:plugins` 零失败

**依赖**：T001, T002, T003, T005（symlink 实跑目标脚本必须已完成替换，否则测试测的是旧 bug 行为）

---

## T008 全量验证

- [ ] `npx vitest run` 全量零失败
- [ ] `npm run test:plugins` 全量零失败（含 T006/T007 新增用例 + 既有 `record-workflow-run.test.mjs` 等 20 处 import 依赖方测试保持零失败）
- [ ] `npm run build` 类型检查零错误
- [ ] `npm run repo:check` 通过（复核插件侧脚本改动未破坏 sync 门禁）
- [ ] 抽查 3 个已修脚本手工建 symlink 实跑确认真实副作用：`scripts/eval-split-sets.mjs`、`plugins/spec-driver/scripts/generate-workflow-registry.mjs`、`scripts/spec-drift-cli.mjs`（额外确认删除 `pathToFileURL` 导入后无编译期/运行期报错）

**完成判据**：以上 5 项全部通过，无需修复即可提交

**依赖**：T001–T007 全部完成

---

## 依赖关系图

```
T001（canonical helper）
  ├─→ T002（薄壳，re-export T001）
  │     ├─→ T003（scripts/ 14 处，走薄壳）
  │     └─→ T004（swebench-dataset-build，走薄壳，同目录 import）
  ├─→ T005（plugins/ 8 处，走 canonical）
  └─→ T006（helper 单元测试）
T003 + T005 → T007（symlink 集成测试，依赖目标脚本已替换完成）
T001–T007 → T008（全量验证，收尾）
```

## 并行机会

- T002、T004、T005、T006 在各自前置（T001 或 T002）就绪后可并行
- T003 内部 14 个文件互不依赖文件路径，可并行编辑，但需注意 baseline-collect.mjs 的整表达式替换风险点单独串行核对

## 明确不做（继承 plan.md §6，任务清单不重复展开）

- 不动 `scripts/lib/graph-bootstrap-status.mjs`（归 F241 收口）
- 不动 20 处 `endsWith` 判定站点、9 处已 [安全] 的 realpath 站点、2 处非入口守卫 `argv` 命中
- 不升级 release contract 版本
- 不改 `specs/src.spec.md` / `specs/plugins.spec.md`
