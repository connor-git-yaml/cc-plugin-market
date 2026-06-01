# F170e — 问题修复报告

## 问题描述

F170b Codex 对抗审查发现的 CRITICAL-2 预存设计缺陷：`GraphQueryEngine.getCommunity`
用 `process.cwd()` 读 `specs/_meta/GRAPH_REPORT.md`，但 graph.json 是按 `projectRoot`
加载的（`src/mcp/graph-tools.ts`）。当 MCP server 进程的 cwd 与目标项目目录不同时，
graph_community 会读错/读不到目标项目的 cohesion 数据。

F170b 用 `process.chdir(isolatedCwd)` 在 snapshot 测试里临时绕过，本 Feature 做干净的
长期修复 + 移除 workaround。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | graph_community 为何可能读错 cohesion？ | getCommunity 用 process.cwd() 定位 GRAPH_REPORT.md |
| Why 2 | 为何用 process.cwd()？ | getCommunity 实现时未感知"目标项目根"概念，假设 cwd == 项目根 |
| Why 3 | 为何假设不成立？ | MCP server 进程可在任意 cwd 启动，projectRoot 由 tool 入参显式传入 |
| Why 4 | graph.json 已按 projectRoot 加载，为何 GRAPH_REPORT.md 没有？ | engine 只接收 GraphJSON，未接收 projectRoot，无法定位其他项目内文件 |
| Why 5 | 为何未被捕获？ | snapshot 测试运行在项目根 cwd，恰好掩盖了 cwd≠projectRoot 的场景 |

**Root Cause**: GraphQueryEngine 不持有 projectRoot，导致 getCommunity 只能退而依赖
进程级 process.cwd() 定位项目内文件，与 graph.json 的 projectRoot 加载路径不一致。

**Root Cause Chain**: graph_community 读错 cohesion → getCommunity 用 process.cwd() →
engine 无 projectRoot 字段 → 构造时未注入 → snapshot 测试 cwd 恰好等于项目根掩盖问题

## 影响范围扫描

### 同源问题（已同步修复）
| 文件 | 位置 | 修复动作 |
|------|------|----------|
| `src/panoramic/graph/graph-query.ts` | getCommunity | 用 `this.projectRoot ?? process.cwd()` |
| `src/mcp/graph-tools.ts` | getEngine | `loadFromFile(graphPath, root)` 透传 + resolve 规范化 |
| `src/panoramic/qa/index.ts` | getEngine | 透传 resolvedRoot + cache key 含 projectRoot |
| `src/cli/commands/query.ts` | loadFromFile | 透传 process.cwd() |

### process.cwd() 审计（验收要求）
`git grep "process.cwd()" src/panoramic/` 结果：
- `graph-query.ts` — 仅剩 `this.projectRoot ?? process.cwd()` 回退（有意义）✓
- `generator-registry.ts:216` — `outputDir ?? process.cwd()` 输出目录默认值（有意义）✓
- `template-loader.ts:57` — 读 **bundled 模板**的 cwd fallback（读工具自身资源，非目标项目文件，不同类）✓

结论：唯一"隐式读目标项目数据文件且忽略可用 projectRoot"的点（getCommunity）已修复。

## 修复策略（方案 A — 采纳）

构造器注入 projectRoot：
1. `GraphQueryEngine` 新增 `private readonly projectRoot?: string`，constructor 第二参数注入
2. `fromJSON` / `loadFromFile` 透传 projectRoot
3. getCommunity 用 `resolveGraphReportPath(this.projectRoot ?? process.cwd())`
4. graph-tools/qa/cli 三处构造点透传各自的 root（含 `path.resolve` 规范化）
5. 测试改 projectRoot 注入 + `vi.spyOn(process,'cwd')`，移除 `process.chdir` 全局 mutation

附带：F170b W-1（message 文案）一并修复 — 三条 degrade 路径文案差异化
（not-found / not-in-table），projectRoot 注入后文案差异化不再引入环境耦合。

## Spec 影响
- 无需更新现有 spec（纯重构 + 缺陷修复，对外契约只新增可选参数，向后兼容）
