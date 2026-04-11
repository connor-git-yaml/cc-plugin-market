# Milestone M-100: Spectra Evolution

> **从 reverse-spec 演进为 Spectra —— 多维代码理解平台**

## 愿景

Spectra = 现有 reverse-spec 的分层 Spec 生成 + Graphify 启发的知识图谱、社区检测、交互导出与增量演化。
目标是让 Claude Code（及其他 AI 编辑器）**在搜索代码前先理解项目全貌**。

---

## 品牌演进

| 现状 | 目标 |
|------|------|
| `reverse-spec` (npm) | `spectra-cli`（npm "spectra" 已被占用） |
| `reverse-spec batch` (CLI) | `spectra batch` |
| `/reverse-spec` (skill) | `/spectra` |
| `reverse-spec@cc-plugin-market` (plugin) | `spectra@cc-plugin-market` |
| 定位：逆向生成 Spec | 定位：多维代码理解平台 |

> **npm 名称调研**：`spectra` 已被一个 2014 年的颜色库占用（周下载 ~1,700），不可用。
> `spectra-cli`、`spectra-code`、`code-spectra` 均未注册。推荐 `spectra-cli`（CLI 入口仍为 `spectra`）。

---

## Feature 总览

| # | Feature | Phase | 版本 | 依赖 | 复杂度 |
|---|---------|-------|------|------|--------|
| [099](../099-spectra-rebrand/) | spectra-rebrand | P0 | v3.0.0 | — | M |
| [100](../100-content-hash-cache/) | content-hash-cache | P1 | v3.1.0 | 099 | L |
| [101](../101-graph-persistence/) | graph-persistence | P2 | v3.2.0 | 099 | L |
| [102](../102-community-analysis/) | community-analysis | P2 | v3.2.0 | 101 | L |
| [103](../103-multi-format-export/) | multi-format-export | P3 | v3.3.0 | 102 | L |
| [104](../104-pretooluse-hook/) | pretooluse-hook | P3 | v3.3.0 | 102 | M |
| [105](../105-mcp-graph-query/) | mcp-graph-query | P4 | v3.4.0 | 101 | M |
| [106](../106-watch-incremental/) | watch-incremental | P5 | v3.5.0 | 100 | M |
| [107](../107-multi-modal-extraction/) | multi-modal-extraction | P6 | v3.6.0 | 100, 101 | L |

---

## 命令体系设计

### CLI 命令

```
spectra <target>                   # 单模块 spec（= 现 reverse-spec <target>）
spectra batch [--force] [--update] # 批量生成（--update 仅处理变化文件）
spectra diff <spec> <source>       # 代码 vs spec 漂移检测
spectra graph [--directed]         # 构建持久化知识图谱 → graph.json
spectra query <question>           # 自然语言查询图谱子图
spectra export --format <fmt>      # 多格式导出：obsidian | html | json | mermaid
spectra watch [--debounce 3]       # 文件监听 + 增量重建
spectra serve                      # MCP Server（扩展现有 src/mcp/server.ts）
spectra install [--git]            # 安装 PreToolUse Hook（--git 加装 post-commit Hook）
spectra cache <clear|stats>        # 缓存管理
```

### Skill 命令

| Skill | 触发场景 | 对应 CLI | Feature |
|-------|---------|---------|---------|
| `/spectra` | 对单个模块/文件生成 spec | `spectra <target>` | 099 |
| `/spectra-batch` | 批量生成整个项目 | `spectra batch` | 099 |
| `/spectra-diff` | 检查 spec 是否与代码漂移 | `spectra diff` | 099 |
| `/spectra-graph` | 构建知识图谱 + 社区分析 | `spectra graph` | 101+102 |
| `/spectra-query` | 交互式查询图谱 | `spectra query` | 105 |
| `/spectra-export` | 导出为 Obsidian/HTML/其他格式 | `spectra export` | 103 |

### MCP Tool（扩展现有 `src/mcp/server.ts`）

```typescript
// 在现有 MCP Server 上新增的 tool（非独立服务）
spectra_query(question: string, budget?: number)   // 自然语言 → 子图 + 摘要
spectra_node(nodeId: string, depth?: number)        // 节点 + N 跳邻域
spectra_path(from: string, to: string)              // 两节点间最短路径
spectra_community(id: number)                       // 社区内所有节点和关系
spectra_god_nodes(limit?: number)                   // 最高连接度核心节点
```

> **注意**：现有 `src/mcp/server.ts` 已注册为 `name: 'reverse-spec'`，Phase 0 重命名后统一改为 `spectra`，
> Phase 4 的 query tool 直接追加到该 server，不另起独立服务。

---

## Feature 详述

### Feature 099: spectra-rebrand（Phase 0）

**范围**：纯重命名，零功能变更。`v2.9.0` → `v3.0.0`（breaking change）。

**变更清单**：
- npm package name: `reverse-spec` → `spectra-cli`（CLI bin 入口保持 `spectra`）
- CLI 入口: 保留 `reverse-spec` 作为 alias，打印 deprecation warning，过渡 1 个大版本后移除
- Plugin manifest + marketplace entry：`reverse-spec@cc-plugin-market` → `spectra@cc-plugin-market`
- Skill 文件重命名：`/reverse-spec` → `/spectra`（保留旧 skill 做 redirect + deprecation notice）
- MCP Server name：`reverse-spec` → `spectra`（`src/mcp/server.ts`）
- spec-driver 联动更新：spec-driver 内部引用 reverse-spec 的 15 处（5 个文件）同步改名
- Release contract + 文档 + README + AGENTS.md + CLAUDE.md 全量更新

**迁移策略**：
- `spectra` plugin postinstall 检测并提示卸载旧 `reverse-spec` plugin
- 现有 `specs/` 目录结构、spec 文件格式完全不变——对用户已生成的 spec 零影响
- spec-driver 同版本同步发布

**验收**：`spectra batch --help` 可用；`reverse-spec batch` 打印 deprecation warning 但正常执行；`npm run repo:check` 通过。

---

### Feature 100: content-hash-cache（Phase 1）

**范围**：SHA256 内容哈希缓存 + manifest + generator 级增量 + cache CLI。

**现有基础**：`batch-orchestrator.ts` 已有 `incremental` + `DeltaRegenerator` + `existingVersion`，但粒度是 spec 级。

**设计**：
- 缓存 key: SHA256(content + resolvedPath)，存储于 `_meta/cache/{hash}.json`
- 对 .md 文件只哈希 frontmatter 之后的正文
- `_meta/manifest.json` 记录每个源文件的 hash、mtime、type、size + 每个 spec 的依赖文件列表
- panoramic generator 接入 manifest，输入文件未变 → 跳过，复用上次输出
- `spectra cache clear` / `spectra cache stats` CLI 命令

**性能目标**：
- 二次 batch（2/100 文件变化）：< 30 秒（首次 < 5 分钟）
- 缓存命中率（稳定代码库）：> 90%

**验收**：第二次 batch 耗时 < 首次 20%；`spectra cache stats` 正确报告命中率。

---

### Feature 101: graph-persistence（Phase 2）

**范围**：置信度标签 + 统一图持久化 `_meta/graph.json`。

**现有基础**：architecture-ir（elements + relationships）、doc-graph（模块依赖 + 交叉引用）、cross-reference-index 已存在。

**设计**：
- 所有 relationship 增加 `confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'` + `confidenceScore: number`
  - AST 直接提取的 import/call → EXTRACTED
  - LLM 推理的 semantic 关系 → INFERRED
  - 弱信号 → AMBIGUOUS
- 新增 `graph-builder.ts`：合并 architecture-ir elements + doc-graph nodes + cross-reference edges → `_meta/graph.json`（NetworkX node-link 兼容格式）
- batch 完成后自动生成 graph.json

**性能目标**：5,000 节点 / 10,000 边图构建 < 10 秒；graph.json < 5 MB。

**验收**：`spectra graph` 生成 graph.json；每条边携带 confidence 标签；graph.json 可被 Python NetworkX 加载。

---

### Feature 102: community-analysis（Phase 2）

**范围**：社区检测 + God Node 识别 + GRAPH_REPORT.md。

**依赖**：[101-graph-persistence](../101-graph-persistence/)

**设计**：
- 社区检测：`graphology` + `graphology-communities-louvain`（纯 JS）。oversized 社区（> 25% 节点、最少 10 个）二次分裂
- God Node：度数排序 + 启发式过滤（排除 file-level hub、方法桩、孤立函数）
- `project/graph-report.md`：god nodes、社区列表 + cohesion 评分、surprising connections（跨社区高 betweenness 边）、knowledge gaps

> **技术风险**：TypeScript 无 Leiden 实现。降级路径：Louvain 效果足够；需要 Leiden 精度时 Phase 4 spawn Python 子进程。

**验收**：社区数量合理（平均 10-50 节点/社区）；god nodes 排除虚假 hub；GRAPH_REPORT.md 可读。

---

### Feature 103: multi-format-export（Phase 3）

**范围**：Obsidian vault 导出 + HTML 交互式可视化。

**依赖**：[102-community-analysis](../102-community-analysis/)

**设计**：
- `spectra export --format obsidian --output vault/`
  - 每社区一篇 wiki（cohesion、key concepts、跨社区链接）
  - 每 god node 一篇、`index.md` 总览
  - `[[双向链接]]` 串联，从 spec frontmatter 提取 sourceTarget 和 relatedFiles
- `spectra export --format html`
  - 单文件 HTML（d3-force 或 vis.js）
  - 节点按社区着色、大小 ∝ 度数
  - 搜索面板 + 节点详情侧栏 + 社区图例
  - \>5,000 节点跳过物理仿真，用预计算布局

**验收**：Obsidian vault 双向链接正确渲染 + Graph View 可用；HTML 可交互（搜索、点选、社区过滤）。

---

### Feature 104: pretooluse-hook（Phase 3）

**范围**：PreToolUse Hook 注入 + Post-commit Hook。

**依赖**：[102-community-analysis](../102-community-analysis/)

**设计**：
- `spectra install` 在项目级 `.claude/settings.json` 添加 hook，匹配 `Glob|Grep`
  - hook 脚本检查 `_meta/graph.json` 存在则注入 god nodes + 社区列表摘要到 `additionalContext`
  - **安全**：只写项目级 settings（非 user 级）；写入前备份；JSON merge 不破坏已有 hook
- `spectra install --git` 在 `.git/hooks/post-commit` 安装钩子
  - 提交后检测变化文件（`git diff HEAD~1 HEAD`），仅 AST 层增量更新 graph.json（0 token）
  - 文档变化打印提示 `Run spectra batch --update`

**Hook 注入效果**：
```
spectra: Knowledge graph loaded (1,847 nodes · 23 communities)
God nodes: UserService(42), AuthMiddleware(38), DatabasePool(25)
→ Read specs/project/graph-report.md before searching raw files.
```

**验收**：Hook 安装后不破坏用户已有 settings.json；Claude 搜索前看到架构摘要；Post-commit < 3 秒。

---

### Feature 105: mcp-graph-query（Phase 4）

**范围**：MCP graph query tool 集 + CLI query 命令 + token 预算控制。

**依赖**：[101-graph-persistence](../101-graph-persistence/)

**设计**：
- 在现有 `src/mcp/server.ts` 追加 5 个 tool：query / node / path / community / god_nodes
- 自动加载 `_meta/graph.json`
- `spectra query "问题" --budget 20` → BFS/DFS 遍历相关子图 + 摘要
- budget 参数限制返回节点数（默认 50），超出时优先保留高度数节点和最短路径上的节点

**性能目标**：单次 query < 500ms（graph.json 已加载）；graph.json 加载 < 2 秒。

**验收**：`spectra query` 返回相关子图且不超预算；MCP tool 可被 Claude Code 调用。

---

### Feature 106: watch-incremental（Phase 5）

**范围**：Watch 文件监听 + `batch --update` 增量模式。

**依赖**：[100-content-hash-cache](../100-content-hash-cache/)

**设计**：
- `spectra watch` 使用 chokidar 监听文件变化（3 秒 debounce）
  - 代码变化 → 立即 AST 重建 + 更新 graph.json（0 token）
  - 文档变化 → 标记 `_meta/needs_update`
  - 忽略 `.gitignore`、`node_modules/`、`specs/`
- `spectra batch --update` 仅处理 manifest 标记为 changed 的文件
  - 与现有 `--incremental` 整合（incremental = spec 级，update = 文件级）
- 降级：chokidar 不可用 → 回退 `fs.watch` + 轮询

**验收**：代码文件变化 < 3 秒自动更新 graph.json；`spectra batch --update` 仅处理变化文件。

---

### Feature 107: multi-modal-extraction（Phase 6）

**范围**：Markdown 文档提取 + OpenAPI/AsyncAPI 解析 + 图像/图表理解。

**依赖**：[100-content-hash-cache](../100-content-hash-cache/), [101-graph-persistence](../101-graph-persistence/)

**设计**：
- Markdown 文档：从 .md 提取概念、设计决策、命名实体 → 图谱节点（kind: `document`），LLM 语义关系标记 INFERRED
- OpenAPI/AsyncAPI：确定性提取 endpoint、schema、event → 一等节点（kind: `api`），标记 EXTRACTED
- 图像/图表：Claude Vision 提取组件和关系（kind: `diagram`），标记 INFERRED
- `spectra batch --include-docs --include-images` 启用

**验收**：.md 设计决策出现在图谱中；OpenAPI endpoint 作为一等节点参与社区检测。

---

## Phase 依赖关系

```
Phase 0: 099 (重命名 v3.0.0)
  │
  ▼
Phase 1: 100 (缓存 v3.1.0)
  │
  ├───────────────────┬──────────────────┐
  ▼                   ▼                  ▼
Phase 2:            Phase 5:           Phase 6:
101 → 102           106 (Watch)        107 (多模态)
(图谱 v3.2.0)       v3.5.0             v3.6.0
  │
  ├──────────┬────────────┐
  ▼          ▼            ▼
Phase 3:   Phase 3:     Phase 4:
103 (导出) 104 (Hook)   105 (Query)
v3.3.0     v3.3.0       v3.4.0
```

## 版本路线

| Phase | 版本 | Features | 里程碑名 | 复杂度 |
|-------|------|----------|---------|--------|
| P0 | v3.0.0 | 099 | Spectra Rebrand | M |
| P1 | v3.1.0 | 100 | Cache & Incremental | L |
| P2 | v3.2.0 | 101, 102 | Knowledge Graph | XL |
| P3 | v3.3.0 | 103, 104 | Multi-Format Export & Hook | L |
| P4 | v3.4.0 | 105 | Query & Serve | M |
| P5 | v3.5.0 | 106 | Watch & Evolution | M |
| P6 | v3.6.0 | 107 | Multi-Modal | L |

## 与现有能力的关系

| 现有能力 | 演进方向 | Feature |
|---------|---------|---------|
| `reverse-spec <target>` | → `spectra <target>`（保持不变） | 099 |
| `reverse-spec batch` | → `spectra batch`（+ 缓存 + 增量 + `--update`） | 099, 100, 106 |
| `reverse-spec diff` | → `spectra diff`（不变） | 099 |
| `src/mcp/server.ts` | → 追加 graph query tool 集 | 099, 105 |
| architecture-ir | → graph.json 的 EXTRACTED 边数据源 | 101 |
| doc-graph | → graph.json 的交叉索引层 | 101 |
| cross-reference-index | → 图谱置信度标签的一部分 | 101 |
| docs-bundle | → Obsidian vault 的另一种 audience-oriented 输出 | 103 |
| panoramic generators | → 图谱节点/边提取器 + 接入缓存 | 100, 101 |
| `batch --incremental` | → 与 `--update` 整合 | 100, 106 |
| spec-driver 引用 | → 15 处更新为 spectra | 099 |

## 关键技术风险

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| npm `spectra` 已被占用 | 包名冲突 | 使用 `spectra-cli`（bin 入口仍为 `spectra`） |
| TypeScript 无 Leiden 算法 | 社区检测精度 | Feature 102 用 `graphology-communities-louvain`（纯 JS）；需要 Leiden 时 Feature 105 spawn Python |
| Hook 注入破坏用户 settings.json | 用户配置丢失 | 写入前备份 + JSON merge + 仅项目级 settings |
| chokidar 跨平台稳定性 | watch 不可靠 | 回退 `fs.watch` + 轮询 |
| graph.json 体积过大 | 加载慢、上下文爆炸 | >5,000 节点分层存储；query 默认 budget 50 节点 |
| 重命名涉及面广 | 遗漏替换点 | `scripts/audit-rename.sh` 扫描 + 集成测试覆盖 |

## 参考设计

- **Graphify** (`_reference/graphify/`)：图谱构建、社区检测、缓存、Hook、Obsidian 导出
- **graphology** (npm)：纯 JS 图数据结构 + Louvain 社区检测
- **Obsidian**：双向链接 + Graph View（导出格式参考）
- **vis.js / d3-force**：HTML 图可视化（导出参考）
