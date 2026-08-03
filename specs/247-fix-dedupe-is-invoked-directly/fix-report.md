# 问题修复报告

## 问题描述

`plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（F241 引入）内嵌导出了一份 `isInvokedDirectly(moduleUrl)`（L605-617，双侧 realpathSync + 回退 path.resolve）。F246 在同目录新建了语义更强的共享 helper `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`（多一层 URL search/hash 短路 false，防 `node --import 'file://x.mjs?copy'` import 副本双跑 main()——Codex 对抗审查实测反例）。两份实现并存正是 F241 T027a 教训（"两份守卫必然同步漂移，所以只留一份"）要消除的形态。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何存在两份 isInvokedDirectly？ | F241 先在 graph-bootstrap-status.mjs 内嵌导出一份（当时是全仓唯一共享点）；F246 后建独立共享 helper 时显式排除了该文件（fix-report 记载"F241 已收口"，视其为已有收敛点不重复迁移） |
| Why 2 | F246 为何排除而非顺手迁移？ | F246 范围聚焦"23 处手写比对收敛"；graph-bootstrap-status 已是导出复用形态，不属于"手写散落"病灶，迁移属范围外重构，符合"不做未要求改动"约定 |
| Why 3 | 为何双实现是风险？ | 内嵌版缺 URL search/hash 短路——`node --import 'file://…/graph-bootstrap-status.mjs?copy' …/graph-bootstrap-status.mjs` 场景下副本会被误判 true → main() 双跑（F246 已实证的反向误判类缺陷）；且两份语义"近同"的实现必然随后续修复漂移（T027a 原教训） |
| Why 4 | 为何未被现有机制捕获？ | shim 测试只断言薄壳转发语义（不同文件→false、canonical→true），不覆盖 search/hash 副本场景；无"全仓唯一实现"结构性门禁 |
| Why 5 | 为何允许收敛到 helper？ | 共享 helper 语义是内嵌版的严格增强（仅多 search/hash 短路 false 分支），两处消费方（仓根薄壳 re-export、shim 测试）依赖的合同不变 [ROOT CAUSE REACHED at Why 3] |

**Root Cause**: F241/F246 两个 Feature 各自留下一份同语义入口守卫实现，形成 T027a 明令消除的双实现漂移面；内嵌版还缺 F246 加固的 search/hash 反向误判防线。
**Root Cause Chain**: 双实现并存 → F246 范围性排除 → F241 内嵌版语义滞后（缺 search/hash 短路）→ 测试与门禁无唯一性约束

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs | L591-617 | 内嵌 isInvokedDirectly 实现 + T027a 注释块 | 删除，改为 `import { isInvokedDirectly } from './is-invoked-directly.mjs'` 并保持具名 re-export |
| plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs | L5 | `import { fileURLToPath }` 仅被内嵌实现使用 | 同步删除（死 import） |

### 类似模式（需评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| 25 个 .mjs 调用点（plugins/scripts 各处） | 各文件尾部 | `isInvokedDirectly(import.meta.url)` 守卫 | 安全——F246 已全部收敛到共享 helper，无第二处内嵌实现（本轮 grep 复核） |
| scripts/lib/graph-bootstrap-status.mjs（仓根薄壳） | L4/L12 | 从 canonical 导入 main + isInvokedDirectly | 安全——canonical 保持具名导出即合同不变，薄壳零改动 |

### 同步更新清单
- 调用方: 无需改动（薄壳依赖的导出名不变；graph-bootstrap-status.mjs 自身 L619 守卫改用导入的 helper）
- 测试: 无需新增——`plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（断言导出合同）与 `is-invoked-directly.test.mjs`（170 行覆盖 helper 语义含 search/hash 场景）合计已覆盖；收敛后 shim 测试自动继承 helper 语义
- 文档: 无

## 修复策略

### 方案 A（推荐）
在 graph-bootstrap-status.mjs 顶部 `import { isInvokedDirectly } from './is-invoked-directly.mjs';`，删除 L591-617 内嵌实现（保留一行注释指向共享 helper + T027a/薄壳承重说明），在原位置 `export { isInvokedDirectly };` 维持薄壳/测试依赖的具名导出，删除死 import `fileURLToPath`。净改动 ≤10 行，语义变化仅为"多 search/hash 短路 false"（严格增强，主入口 URL 恒无 search/hash 故正常路径行为不变）。

### 方案 B（备选）
让仓根薄壳与测试改为直接从 is-invoked-directly.mjs 导入，graph-bootstrap-status.mjs 不再 re-export。改动面更大（3 文件）、破坏既有导出合同，且任务明确要求保持 re-export——不采纳。

## Spec 影响
- 需要更新的 spec: 无需更新（specs/241-*/246-* 均为历史事实记录；无 graph-bootstrap-status 模块级 spec.md 合同文件受影响）

## 风险评估
- 回归面：graph-bootstrap-status 自身 CLI 直跑守卫（L619）改用 helper——realpath 双侧比对语义与原实现逐字等价，仅新增 search/hash 提前 false；该新分支对"正常主入口执行"不可达（Node 主入口 URL 由 pathToFileURL 生成，恒无 search/hash）
- 验证锚：node --test graph-bootstrap-status-shim.test.mjs + is-invoked-directly.test.mjs；npm run test:plugins；npm run repo:check（第 15 族 worktree-local-state 含 graph-bootstrap 相关 gate）
