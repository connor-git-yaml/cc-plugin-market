# 代码上下文摘要 — Feature 193（story 模式，替代调研阶段）

**采集日期**: 2026-06-13 | **采集者**: 主编排器（亲自扫描，未委派）

## 1. 四项问题实测验证

| # | 问题 | 验证结果 | 证据 |
|---|------|---------|------|
| P1 | 结构性无图 | ✅ 成立 | `.gitignore:71` = `specs/_meta/`；本 worktree `specs/_meta/graph.json` **不存在**（实测 graph-not-built）；主仓库存在 11.6MB graph.json（May 28） |
| P2 | graph 不可移植 | ✅ 成立 | `src/knowledge-graph/index.ts:144` `id: filePath`；`codeSkeletons` map key 为**绝对路径**（line 36 注释 `absoluteFilePath → CodeSkeleton`）；symbol id = `${filePath}::${name}`（line 154）、member id = `${symbolId}.${m.name}`（line 165）；import 边 `source/target` = 绝对 `callerFile`/`resolvedPath`（line 98-99） |
| P3 | bootstrap 太慢 | 待 plan 阶段 profiling 量化（用户实测 27.5min / CPU 11%） |
| P4 | 保活无机制 | ✅ 能力存在但默认不激活 | `src/cli/commands/install.ts`、`src/hooks/git-hook-installer.ts`、`src/knowledge-graph/incremental.ts` 均存在 |

## 2. 解决方案资产定位

### 🅐 id 相对化（前提 FR）
- **写入侧改点**: `src/knowledge-graph/index.ts`
  - `deriveNodesFromSkeletons`（line 138-176）：module/symbol/member 三类 id 均派生自 `filePath`（绝对）
  - `deriveImportEdges`（line 87-110）：边 `source`/`target` = 绝对路径
  - `buildUnifiedGraph`（line 51-65）：持有 `input.projectRoot`，可作相对化基准
- **候选实现路径**: 在 `buildUnifiedGraph` 末尾对装配好的 graph 作一次性 normalize 后处理（统一把 nodes.id/nodes.filePath/edges.source/edges.target 的绝对前缀 strip + POSIX 化），改点集中、blast radius 可控
- **查询侧已有资产（F174）**: `src/knowledge-graph/query-helpers.ts` `canonicalizeSymbolId`（line 6 注释）+ `resolveSymbolFuzzy`，已有相对化 fallback；`src/panoramic/graph/graph-query.ts`、`src/mcp/agent-context-tools.ts`、`src/mcp/file-nav-tools.ts` 均含 canonicalize 引用
- **⚠️ schema 级变更影响面**: 17 个 MCP 工具的 id 解析、F180 E2E 断言、存量图兼容（旧绝对路径图 vs 新相对路径图）

### 🅑 bootstrap
- **现成钩子**: `scripts/sync-worktree-local-state.sh` —— 已实现 primary→worktree 的 SYMLINK_TARGETS（node_modules / .agents / _reference）+ COPY_TARGETS（.env.local，含 secret 故 copy 不 symlink）
- **设计含义**: graph.json 应走 **COPY 语义**（worktree 会增量改图，symlink 会写穿污染 primary），与 .env.local 同理
- **共享缓存先例**: `~/.spectra-baselines/`（CLAUDE.local.md 记载），可仿 `~/.spectra-graph-cache/<repo>/`
- **依赖**: 🅑 依赖 🅐（copy 来的图只有在 id 相对化后才能跨 worktree 生效）

### 🅒 保活
- `src/cli/commands/install.ts` + `git-hook-installer.ts`（post-commit git hook）
- `src/knowledge-graph/incremental.ts`（F175 增量链：按 node.filePath 反查 owning nodes → 增量替换）

### 🅓 性能
- 待 plan 阶段 profiling；CPU 11% 指向 await 串行/sleep 空等

## 3. 🔴 回归护栏（F182 并行冲突）
- **禁改增量语义文件**（F182 在飞，Jun 13 01:14 刚改）:
  - `src/batch/delta-regenerator.ts`（12.7KB）
  - `src/batch/regen-plan.ts`（5.2KB）
  - `src/batch/batch-orchestrator.ts`（107KB）
- 若 🅓 profiling 指向 batch-orchestrator 核心 → 记录发现，等 F182 ship 后处理，**本 feature 不动**

## 4. 移交备忘（不在本 feature scope）
- impact 对 `src/batch/regen-plan.ts::resolveSourceTarget` 返回 0 callers，但 grep 实测 2 个跨文件调用方（`delta-regenerator.ts:250` / `batch-orchestrator.ts:750`）—— call 边 recall 缺口，graph-accuracy 域 fix 候选，留给 F191 全期 review

## 5. dogfooding 即时证据
- 本 worktree MCP impact/context **当前不可用**（graph-not-built）—— 这正是本 feature 要修的体验。修完后应能"新 worktree 开箱即吃狗粮"。
- 工具环境补丁：本次发现 4.2.1 插件缓存缺 `zod`，已临时 symlink 仓库 node_modules/zod 使 resolver 可跑（与 F185 无关的工具链噪声，记入工具反馈）。
