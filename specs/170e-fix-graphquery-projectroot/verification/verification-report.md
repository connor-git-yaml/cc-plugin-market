# F170e — 验证报告

## 变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/panoramic/graph/graph-paths.ts` | MODIFY | 新增 `resolveGraphReportPath(root)` helper |
| `src/panoramic/graph/graph-query.ts` | MODIFY | constructor/fromJSON/loadFromFile 注入 projectRoot；getCommunity 用 `this.projectRoot ?? process.cwd()`；message 文案差异化；regex 收严 + 单次解析 |
| `src/mcp/graph-tools.ts` | MODIFY | getEngine/getCachedGraphData 透传 + `path.resolve` 规范化 root |
| `src/panoramic/qa/index.ts` | MODIFY | 透传 resolvedRoot；cache key 含 projectRoot（\0 分隔防碰撞）|
| `src/cli/commands/query.ts` | MODIFY | loadFromFile 透传 process.cwd() |
| `tests/panoramic/graph-query-community-cohesion.test.ts` | MODIFY | 重写为 projectRoot 注入 + vi.spyOn(cwd) 不变量测试 |
| `tests/integration/graph-community-projectroot.test.ts` | NEW | MCP 层端到端：graph_community projectRoot 隔离 |
| `tests/integration/graph-mcp-snapshot.test.ts` | MODIFY | Layer A 改 projectRoot 注入，移除 process.chdir |
| `tests/integration/__snapshots__/...snap` | MODIFY | community message 文案更新 |

## 验收结果

### 验收 1：全量 vitest pass（不再依赖 cwd mutation 隔离）
```
Test Files  322 passed | 4 skipped (326)
Tests       3859 passed | 11 skipped | 20 todo (3890)
```
新增/改写测试：
- graph-query-community-cohesion.test.ts — 6 tests（含 projectRoot 核心不变量 + 向后兼容）
- graph-community-projectroot.test.ts — 2 tests（MCP 层 projectRoot 隔离）
- 全测试套件无 `process.chdir` 全局 mutation（改为 vi.spyOn）

### 验收 2：process.cwd() 审计
`git grep "process.cwd()" src/panoramic/` 仅剩有意义的 fallback/default
（graph-query 回退、generator-registry 输出目录默认值、template-loader bundled 模板 fallback）。

### 验收 3：snapshot 测试任意 cwd 稳定
模拟 host：在 cwd 放含 cluster_0 的误导 GRAPH_REPORT.md → snapshot 仍 11/13 pass（2 skip）。
projectRoot 注入后完全与 cwd 解耦。

### 验收 4：MCP client 错误 cwd 下仍读对 projectRoot 的 GRAPH_REPORT
`graph-community-projectroot.test.ts`：
- projectRoot 含 cohesion=0.77，process.cwd() mock 为含 0.11 的目录
- graph_community(projectRoot) → 读到 0.77（证明 cwd 无关）✓
- projectRoot 无 report 但 cwd 有 → 返回 not-found（不误读 cwd）✓

### 工具链
- build: tsc 零错误 ✓
- repo:check: status=pass（含 namespace-consistency 5 项）✓
- release:check: pass ✓

## Codex 对抗审查处置

第一轮（全量 F170e）：
- WARNING-1（projectRoot 未规范化）→ 修复：graph-tools getEngine/getCachedGraphData 加 `path.resolve`
- WARNING-2（QA cache key 不含 projectRoot）→ 修复：cacheKey 纳入 resolvedRoot
- INFO-1（process.chdir 未移除）→ 修复：改 vi.spyOn(process,'cwd')，零全局 mutation
- INFO-2（cohesion 解析过宽 + 双 parseFloat）→ 修复：regex 收严 `\d+(?:\.\d+)?` + 单次 Number()

第二轮（修复 delta 复审）：
- 3/4 修复确认正确无回归
- 新 WARNING（cacheKey `::` 碰撞）→ 修复：改用 NUL（\0）分隔符

全部 critical/warning 已闭合。

## 范围确认
- 未动 graph-query 其他算法逻辑 ✓
- 未动 GRAPH_REPORT.md 格式 ✓
- 对外契约只新增可选参数，向后兼容 ✓
