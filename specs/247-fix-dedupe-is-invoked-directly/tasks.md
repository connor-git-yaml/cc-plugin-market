# 任务分解：收敛 graph-bootstrap-status.mjs 内嵌 isInvokedDirectly 为共享 helper

## 关联制品

- [fix-report.md](./fix-report.md)（5-Why 根因、影响范围扫描）
- [plan.md](./plan.md)（修复方案与验证方案）

## 任务列表

- [x] T001 在 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 顶部 import 区新增 `import { isInvokedDirectly } from './is-invoked-directly.mjs';`，并删除死 import `import { fileURLToPath } from 'node:url';`（L5，仅被内嵌实现使用）

- [x] T002 删除 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 中 L591-617 内嵌 `export function isInvokedDirectly(moduleUrl) {...}` 完整实现（含 JSDoc 与 T027a 注释块），替换为一行注释指向共享 helper，并保留 `export { isInvokedDirectly };` 以维持仓根薄壳与测试依赖的具名导出合同（原调用点 L619 `if (isInvokedDirectly(import.meta.url))` 不变）

- [x] T003 运行单元测试验证收敛目标本身：
  ```bash
  node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs
  node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs
  ```
  确认 shim 测试自动继承 helper 的 search/hash 短路语义且全绿，helper 自身测试作为回归锚点保持通过

- [x] T004 运行插件全量测试与仓库级同步校验：
  ```bash
  npm run test:plugins
  npm run repo:check
  ```
  确认收敛未影响 `SCHEMA_VERSION`、`buildStatusPayload`、`writeBootstrapStatus`、`checkFreshness`、`attemptLocalGraphBuild` 等其余导出的消费方测试，且第 15 族（worktree-local-state）等门禁零失败

- [x] T005 运行全量回归验证（提交前标准动作）：
  ```bash
  npx vitest run
  npm run build
  ```
  确认零失败、类型检查零错误后方可提交

## FR 覆盖映射

| 修复点（来自 fix-report.md） | 对应任务 |
|------|----------|
| 删除内嵌 isInvokedDirectly 实现 + 改为 import 共享 helper | T001, T002 |
| 保持具名 re-export（薄壳/测试合同不变） | T002 |
| 删除死 import fileURLToPath | T001 |
| 单元测试验证（shim + helper 语义） | T003 |
| 插件全量测试 + repo:check 门禁 | T004 |
| 全量 vitest + build 提交前验证 | T005 |

## 依赖关系

- T001 → T002（先补 import 再删实现，避免中间态引用未定义符号；也可在同一次编辑中一并完成）
- T002 → T003 → T004 → T005（严格顺序执行，任一步失败即停止并回到修复，不得跳步）
- 单文件改动，无并行任务（[P] 不适用）

## 实施建议

T001 与 T002 可合并为一次编辑动作（同一文件的连续改动），验证阶段 T003-T005 必须按顺序逐步执行，任一步失败立即停止修复后重跑而非继续下一步。
