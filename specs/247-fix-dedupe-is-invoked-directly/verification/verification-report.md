# Verification Report: fix-dedupe-is-invoked-directly

**特性分支**: `247-fix-dedupe-is-invoked-directly`
**验证日期**: 2026-08-03
**验证范围**: 轻量修复验证（Layer 2 工具链实跑 + 4a/4b 合并审查清单，fix 模式无 spec.md，Layer 1 不适用）

## Layer 2: 工具链验证（实跑结果）

| 命令 | 退出码 | 结果 | 详情 |
|------|--------|------|------|
| `node --test plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs` | 0 | ✅ PASS | 12/12 通过（含"仓根薄壳：经符号链接目录调用仍真实落盘" `B1-W3` `命名导出经仓根路径依然可 import` 三项与本次收敛直接相关的用例） |
| `node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs` | 0 | ✅ PASS | 10/10 通过（含 symlink 回归 + search/hash 反向误判回归两个 suite） |
| `npm run test:plugins` | 0 | ✅ PASS | 1308/1308 通过，233 suites，0 fail |
| `npm run repo:check` | 0（status=warn，非阻断） | ⚠️ PASS-WITH-WARN | 全部 gate 逐条列出均为 `pass`，仅 `graph-quality:freshness` 为 `warn`（图 sourceCommit=d27ba75 与当前 HEAD=678a603 不一致，commit 级 stale——与本次改动无关的预存噪声，符合运行时上下文预期）；第 15 族 `worktree-local-state:*` 四项全部 pass |
| `npm run build` | 0 | ✅ PASS | `tsc` 类型检查零错误；`postbuild:stamp` 正常盖章 |

## 4a/4b 轻量合并审查清单

### [Spec 合规]

**结论：PASS**

- 修复与 `fix-report.md` 根因完全一致：根因是 F241 内嵌 `isInvokedDirectly` 与 F246 共享 helper `is-invoked-directly.mjs` 双实现并存，修复方案（方案 A）即"import 共享 helper + 保留具名 re-export + 删除死 import"，实际 diff 与该方案逐字对应，无偏离。
- 未引入 fix-report 未覆盖的行为变化：语义变化仅为"多一层 URL search/hash 短路 false"（helper 严格增强），主入口执行路径的 URL 恒无 search/hash，正常路径行为不变；`is-invoked-directly.test.mjs` 的 search/hash 回归用例已覆盖此增量语义。
- 未新增/变更任何公共 API 或对外行为面：`graph-bootstrap-status.mjs` 具名导出集合（`main`、`isInvokedDirectly`、`SCHEMA_VERSION`、`buildStatusPayload`、`writeBootstrapStatus`、`checkFreshness`、`attemptLocalGraphBuild` 等）未变化，仓根薄壳的 `import { main, isInvokedDirectly } from ...` 合同不变。
- Spec 更新：fix-report.md 已明确"无需更新"（specs/241-*/246-* 是历史事实记录，无模块级 spec.md 合同文件受影响），核实无误——本次改动不涉及任何 `spec.md`。

### [代码质量]

**结论：PASS**

- 改动最小且聚焦根因：`git diff HEAD` 仅 1 文件、+4/-28，净减少 24 行；删除的 26 行（L591-617 原内嵌实现 + JSDoc + T027a 注释块）与新增的 3 行（1 行 import + 1 行注释 + 1 行 re-export）精确对应 fix-report 的方案 A 描述，无范围外改动。
- 命名/风格与周边代码一致：`export { isInvokedDirectly };` 保持原有导出语句写法；新增注释延续文件既有"中文说明 + 引用 Feature 编号"的注释风格。
- 无遗留调试代码/死代码：`grep -n "fileURLToPath" plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 结果为空，确认死 import 已彻底移除且无残留引用；文件内其余 import（`spawn`/`spawnSync`/`fs`/`path`/`process`）经检查均仍被使用，未因本次改动产生新的死 import。
- 测试覆盖：既有 `graph-bootstrap-status-shim.test.mjs`（12 用例，覆盖薄壳转发、symlink、B1-W3 catch 路径一致性、命名导出完整性）+ `is-invoked-directly.test.mjs`（10 用例，覆盖 direct/imported/argv 缺失/realpath 失败/search/hash 短路/symlink 回归/query 副本不重复执行）合计覆盖充分，无需新增测试，与 fix-report「同步更新清单」判断一致。
- 安全隐患/数据丢失风险/构建阻断：均未发现，`npm run build` 零错误。
- 跨模块一致性：
  - 仓根薄壳 `scripts/lib/graph-bootstrap-status.mjs` 依赖的 `{ main, isInvokedDirectly }` 具名导出合同完好（已直接 Read 该文件确认第 4 行 import 语句与 canonical 导出名完全匹配）。
  - `graph-bootstrap-status.mjs` 自身 CLI 直跑守卫（L595 `if (isInvokedDirectly(import.meta.url))`）仍生效，改用导入的共享 helper，调用点代码本身未改动，行为等价性由 shim 测试与 helper 单测双重覆盖验证。

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| 目标测试（shim + helper） | ✅ PASS (12+10=22/22) |
| 插件全量测试 | ✅ PASS (1308/1308) |
| repo:check | ⚠️ PASS-WITH-WARN（仅预存 graph-quality:freshness 噪声，非本次改动引入） |
| Build | ✅ PASS |
| Spec 合规审查 | ✅ PASS |
| 代码质量审查 | ✅ PASS |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题（如有）

无。

### 未验证项（工具未安装）

无——所有工具链均已安装并成功执行。

### 备注

- `graph-quality:freshness` warning 与 F241 verification report 中同一条预存事实一致（图 sourceCommit 落后于 HEAD 属正常增量滞后，非本次修复引入的回归），运行时上下文已预先说明可注明放行。
- 本次未跑独立的 `npx vitest run` 全仓命令（该命令是 tasks.md T005 的提交前动作，非本轮验证清单要求项）；`npm run test:plugins`（覆盖 plugin 全量 node --test 套件，1308 用例）与目标测试已充分验证本次改动，且与运行时上下文列出的验证清单（1. 五条命令）完全对应，五条均已实跑。
