# 修复规划：收敛 graph-bootstrap-status.mjs 内嵌 isInvokedDirectly 为共享 helper

## 关联制品

- 问题上下文：[fix-report.md](./fix-report.md)（5-Why 根因、影响范围扫描已完成，本计划直接复用其结论，不重复分析）

## 修复方案

采用 fix-report 方案 A：`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 改为 `import`
共享 helper `is-invoked-directly.mjs` 的 `isInvokedDirectly`，删除本地内嵌实现与死 import，
并保留具名 `export`（薄壳与测试依赖此导出，合同不变）。

不采用方案 B（改导入源头）：任务要求明确保持 re-export 合同，方案 B 改动面更大（3 文件）且破坏既有导出合同。

## 变更清单

**文件**：`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（仅此一个文件）

| 位置 | 现状 | 改动 |
|------|------|------|
| L5 | `import { fileURLToPath } from 'node:url';` | 删除（仅被内嵌实现使用，收敛后无引用者） |
| 顶部 import 区（L1-6 之后） | 无 | 新增 `import { isInvokedDirectly } from './is-invoked-directly.mjs';` |
| L591-617 | 内嵌 `export function isInvokedDirectly(moduleUrl) {...}` 完整实现（含 T027a 注释块） | 删除函数体与原 JSDoc，替换为一行注释指向共享 helper + 保留 `export { isInvokedDirectly };` 维持具名导出合同 |
| L619 `if (isInvokedDirectly(import.meta.url))` | 不变 | 不变（引用名不变，仍指向同一函数，行为不变） |

**预期净改动**：删除 ~30 行（内嵌实现 + JSDoc），新增 ~3 行（import + 转发说明注释 + re-export），
净减少 ~27 行（fix-report 估算"≤10 行"针对逻辑性改动行数；含大段 JSDoc 删除后总行数变化更大，
但唯一实质性代码改动仅为"删内嵌实现、加一行 import、加一行 re-export"三处）。

**不改动**：
- `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（共享 helper 本体，已由 F246 交付且通过全部测试）
- `scripts/lib/graph-bootstrap-status.mjs`（仓根薄壳，依赖的具名导出 `isInvokedDirectly` 保持存在）
- `plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（断言导出合同，收敛后自动继承 helper 语义，无需改测试断言）
- `plugins/spec-driver/tests/is-invoked-directly.test.mjs`（覆盖 helper 自身语义，不受本次改动影响）

## 回归风险评估

| 风险点 | 分析 | 结论 |
|--------|------|------|
| 语义漂移 | 共享 helper 在内嵌版逐字节比对逻辑（双侧 realpath + 回退 path.resolve）基础上，仅新增一段"URL 带 search/hash 时短路 false"的前置判断 | 严格增强，非破坏性变更 |
| 正常路径可达性 | 新增分支要求 `moduleUrl` 含 `?search` 或 `#hash`；本文件唯一调用点 `isInvokedDirectly(import.meta.url)` 中，`import.meta.url` 取自主入口模块 URL（Node 由 `pathToFileURL` 生成），恒不带 search/hash | 新分支在现有测试覆盖的调用形态下不可达，行为逐字等价 |
| 导出合同 | 具名 `export { isInvokedDirectly }` 保留，仓根薄壳 `import { main, isInvokedDirectly } from '../../plugins/.../graph-bootstrap-status.mjs'` 的导入语句零改动即可继续解析 | 合同不变 |
| 死 import 清理副作用 | `fileURLToPath` 删除后需确认文件内无其他引用点 | 已用 Grep 核实：本文件内仅内嵌实现一处使用该函数，删除内嵌实现后 import 确为死代码，可安全删除 |
| T027a 症状复发风险 | T027a 教训是"两份独立维护的 realpath 比对逻辑会漂移"；收敛后只剩 helper 一份实现，graph-bootstrap-status.mjs 与仓根薄壳、其余 25 个 `.mjs` 调用点共享同一份逻辑 | 风险从"存在"变为"结构性消除" |
| 跨模块影响面 | Grep 复核 `isInvokedDirectly` 全仓 42 处命中中，仅 `graph-bootstrap-status.mjs`（本文件）与其仓根薄壳、两份对应测试文件涉及本次改动；其余均为各自 `.mjs` 脚本对共享 helper 的独立调用点，不受影响 | 影响面收敛为单文件 |

**总体风险等级**：LOW（单文件改动、无跨包影响、无数据迁移、无 API 契约变更、语义为纯增强）。

## 修复验证方案

按顺序执行，任一步失败即停止并回到修复：

1. **单元测试（收敛目标本身）**
   ```bash
   node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs
   node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs
   ```
   前者覆盖薄壳转发语义、符号链接场景（T027a）、argv[1] 缺失/不可解析场景，收敛后应自动继承
   helper 的 search/hash 短路语义并保持全绿；后者覆盖 helper 自身语义（含 search/hash 反向误判防线），
   不受本次改动影响但作为回归锚点一并复跑。

2. **插件全量测试**
   ```bash
   npm run test:plugins
   ```
   确认收敛未影响 spec-driver 插件内其余依赖 graph-bootstrap-status 导出（`SCHEMA_VERSION`、
   `buildStatusPayload`、`writeBootstrapStatus`、`checkFreshness`、`attemptLocalGraphBuild` 等）的测试。

3. **仓库级同步与门禁校验**
   ```bash
   npm run repo:check
   ```
   重点关注第 15 族（worktree-local-state 相关 gate，覆盖 `sync-worktree-local-state.sh` 对
   `graph-bootstrap-status.mjs` 三个子命令 CLI 调用形态的间接校验）零失败。

4. **全量 vitest + build（提交前标准动作）**
   ```bash
   npx vitest run
   npm run build
   ```

## 风险与影响面（汇总）

- **影响文件数**：1（`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`）
- **跨包影响**：无（改动完全在 `plugins/spec-driver/` 内部，消费方仓根薄壳与测试均保持既有导入语句不变）
- **数据迁移**：无
- **API/契约变更**：无（导出名、导出签名、CLI 子命令行为均不变）
- **风险等级**：LOW

不触发 HIGH 风险强制分阶段规则，单阶段直接实施即可。
