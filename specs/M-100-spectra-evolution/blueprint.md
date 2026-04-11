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

| Skill | 触发场景 | 对应 CLI |
|-------|---------|---------|
| `/spectra` | 对单个模块/文件生成 spec | `spectra <target>` |
| `/spectra-batch` | 批量生成整个项目 | `spectra batch` |
| `/spectra-diff` | 检查 spec 是否与代码漂移 | `spectra diff` |
| `/spectra-graph` | 构建知识图谱 + 社区分析 | `spectra graph` |
| `/spectra-query` | 交互式查询图谱 | `spectra query` |
| `/spectra-export` | 导出为 Obsidian/HTML/其他格式 | `spectra export` |

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

## Phase 分解

### Phase 0: 品牌重命名 — `reverse-spec → spectra`

**范围**：纯重命名，零功能变更

| Feature | 说明 |
|---------|------|
| 100-00 | npm package name: `reverse-spec` → `spectra-cli`（CLI bin 入口保持 `spectra`） |
| 100-01 | CLI 入口: `reverse-spec` → `spectra`（保留 `reverse-spec` 作为 alias，打印 deprecation warning，过渡 1 个大版本后移除） |
| 100-02 | Plugin manifest + marketplace entry：`reverse-spec@cc-plugin-market` → `spectra@cc-plugin-market` |
| 100-03 | Skill 文件重命名：`/reverse-spec` → `/spectra`（保留旧 skill 做 redirect + deprecation notice） |
| 100-04 | MCP Server name：`reverse-spec` → `spectra`（`src/mcp/server.ts`） |
| 100-05 | spec-driver 联动更新：spec-driver 内部引用 reverse-spec 的 15 处（5 个文件）同步改名 |
| 100-06 | Release contract + 文档 + README + AGENTS.md + CLAUDE.md 全量更新 |
| 100-07 | Version bump: `v2.9.0` → `v3.0.0`（重命名 = breaking change） |

**迁移策略**：
- `spectra` plugin 安装时自动检测并卸载旧 `reverse-spec` plugin
- `reverse-spec` CLI 命令保留但打印 `⚠ reverse-spec is now spectra. Please use 'spectra' instead.`
- 现有 `specs/` 目录结构、spec 文件格式完全不变——对用户已生成的 spec 零影响
- spec-driver 下一个版本同步发布，内部引用切换到 `spectra`

**验收**：
- `spectra batch --help` 可用
- `reverse-spec batch --help` 仍可用但打印 deprecation warning
- `npm install -g spectra-cli && spectra --version` 输出 `3.0.0`
- spec-driver 脚本中的 `reverse-spec` 引用全部更新

---

### Phase 1: 缓存 + 增量 — 从 15 分钟到 15 秒

**动机**：当前 batch 每次全量重建，大项目耗时过长。Graphify 通过 SHA256 缓存 + manifest 实现 ~90% token 节省。

**现有基础**：
- `batch-orchestrator.ts` 已有 `incremental` 模式 + `DeltaRegenerator` + `existingVersion` 比对
- 但增量粒度是 spec 级别（整个 module spec 重生成），没有文件级内容哈希缓存
- 项目级文档（panoramic generators）每次全量运行，无缓存

**净新工作**（在现有增量机制上叠加）：

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-10 | **文件级 SHA256 内容哈希缓存**：`_meta/cache/` 目录存储 `{hash}.json`，key = SHA256(content + resolvedPath)。对 .md 文件只哈希 frontmatter 之后的正文。缓存 AST 分析结果 + LLM 提取的 CodeSkeleton | Graphify `cache.py` |
| 100-11 | **Manifest 文件**：`_meta/manifest.json` 记录每个源文件的 hash、mtime、type、size + 每个 spec 的生成时间和依赖文件列表 | Graphify `manifest.py` |
| 100-12 | **Generator 级增量**：panoramic generator 接入 manifest，输入文件未变 → 跳过生成，直接复用上次输出 | — |
| 100-13 | **缓存管理 CLI**：`spectra cache clear` 清除缓存、`spectra cache stats` 显示命中率和大小 | — |

**CLI 体验**：
```bash
$ spectra batch                    # 首次：扫描 47 文件，生成 47 specs (180s)
$ spectra batch                    # 二次：45/47 cached, 2 changed (8s)
$ spectra cache stats              # Cache: 47 entries, 2.3 MB, hit rate 95.7%
$ spectra cache clear              # Cleared 47 entries (2.3 MB)
```

**性能目标**：
- 100 文件项目首次 batch：< 5 分钟（取决于 LLM 延迟）
- 100 文件项目二次 batch（2 文件变化）：< 30 秒
- 缓存命中率（稳定代码库）：> 90%

**验收**：第二次 batch 耗时 < 首次的 20%；`spectra cache stats` 正确报告命中率。

---

### Phase 2: 知识图谱 — 从文档到图

**动机**：Graphify 的核心竞争力是图谱。reverse-spec 已有 architecture-ir 和 doc-graph，但未持久化、无社区检测、无置信度标签。

**现有基础**：
- `architecture-ir-builder.ts` 生成 `ArchitectureIR`（elements + relationships + views）
- `doc-graph-builder.ts` 生成 `DocGraph`（模块间依赖 + 交叉引用）
- `cross-reference-index.ts` 为每个 module spec 生成交叉引用

**关系定位**：`spectra graph` 是 architecture-ir + doc-graph 之上的**聚合持久化层**——不替换它们，而是消费它们的输出构建统一图谱。

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-20 | **置信度标签**：architecture-ir 的每条 relationship 增加 `confidence: 'EXTRACTED' \| 'INFERRED' \| 'AMBIGUOUS'` + `confidenceScore: number`。AST 直接提取的 import/call → EXTRACTED；LLM 推理的 semantic 关系 → INFERRED；弱信号 → AMBIGUOUS | Graphify 三层标签 |
| 100-21 | **统一图持久化**：新增 `graph-builder.ts`，合并 architecture-ir elements + doc-graph nodes + cross-reference edges → `_meta/graph.json`（NetworkX node-link 兼容格式）。batch 完成后自动生成 | Graphify `build.py` |
| 100-22 | **社区检测**：在 graph.json 上运行社区检测算法。**技术方案**：优先使用 `graphology` + `graphology-communities-louvain`（纯 JS，无需 Python 依赖）；后续可升级为通过 `child_process` 调用 Python igraph/Leiden 获得更好效果 | Graphify `cluster.py` |
| 100-23 | **God Node 识别**：度数排序 + 启发式过滤（排除 file-level hub、utility 函数桩、孤立节点），输出项目最核心的 N 个抽象 | Graphify `analyze.py` |
| 100-24 | **GRAPH_REPORT.md**：`project/graph-report.md` 含 god nodes、社区列表 + cohesion 评分、surprising connections（跨社区高 betweenness 边）、knowledge gaps（孤立节点、薄社区） | Graphify `report.py` |

> **技术风险：社区检测算法选型**
> Graphify 使用 Python graspologic 的 Leiden 算法。TypeScript 生态无成熟 Leiden 实现。
> **降级路径**：Phase 2 使用 `graphology-communities-louvain`（纯 JS），效果足够。
> 如需 Leiden 精度，Phase 4 的 MCP Server 可 spawn Python 子进程调用 igraph。

**CLI 体验**：
```bash
$ spectra graph                     # 构建图谱（batch 后自动运行，也可手动触发）
  Building knowledge graph...
  → 1,847 nodes · 3,254 edges · 23 communities
  → God nodes: UserService (42), AuthMiddleware (38), DatabasePool (25)
  → Written: _meta/graph.json, project/graph-report.md

$ spectra graph --directed          # 有向图模式（精确依赖方向）
```

**性能目标**：
- 5,000 节点 / 10,000 边的图构建 + 社区检测：< 10 秒
- graph.json 体积：< 5 MB（5,000 节点规模）

**验收**：`spectra graph` 生成 graph.json + graph-report.md；社区数量合理（平均 10-50 节点/社区）；god nodes 排除虚假 hub。

---

### Phase 3: 多格式导出 — Obsidian / HTML / Hook

**动机**：当前输出只有 Markdown + Mermaid。Graphify 支持 HTML 交互图、Obsidian vault、Hook 注入三种消费路径。

**前置依赖**：Phase 2（graph.json + 社区数据）

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-30 | **Obsidian Vault 导出**：`spectra export --format obsidian --output vault/`。每个社区一篇 wiki（含 cohesion、key concepts、跨社区链接）、每个 god node 一篇、`index.md` 总览。使用 `[[双向链接]]` 串联。从现有 spec frontmatter 提取 sourceTarget 和 relatedFiles 生成链接 | Graphify `wiki.py` |
| 100-31 | **HTML 交互式可视化**：`spectra export --format html`。单文件 HTML（d3-force 或 vis.js），节点按社区着色、大小 ∝ 度数、搜索面板 + 节点详情侧栏 + 社区图例。>5,000 节点时跳过物理仿真，使用预计算布局 | Graphify `export.py` |
| 100-32 | **PreToolUse Hook 注入**：`spectra install` 在项目级 `.claude/settings.json` 添加 hook，匹配 `Glob\|Grep`。hook 脚本检查 `_meta/graph.json` 是否存在，存在则注入 god nodes + 社区列表摘要到 `additionalContext`。**安全措施**：只写入项目级 settings（非 user 级）；写入前备份原文件；使用 JSON merge 而非覆盖，不破坏用户已有 hook | Graphify hook 机制 |
| 100-33 | **Post-commit Hook**：`spectra install --git` 在 `.git/hooks/post-commit` 安装钩子。提交后检测变化文件（`git diff HEAD~1 HEAD`），仅 AST 层增量更新 graph.json（0 token 成本）。若有文档变化，打印提示 `Run spectra batch --update` | Graphify `hooks.py` |

**CLI 体验**：
```bash
$ spectra export --format obsidian --output vault/
  Exported Obsidian vault: 23 community pages, 10 god node pages, 1 index
  → Open in Obsidian: vault/

$ spectra export --format html
  Exported: specs/project/graph.html (single-file, 847 KB)
  → Open in browser to explore interactively

$ spectra install
  ✓ PreToolUse hook added to .claude/settings.json (project scope)
  ✓ Backup saved: .claude/settings.json.bak
  
  Claude will now see project architecture before every search.

$ spectra install --git
  ✓ Post-commit hook installed to .git/hooks/post-commit
  Graph will auto-update after each commit (AST only, 0 tokens).
```

**Hook 注入效果示例**：
```
# Claude 每次调用 Glob/Grep 前看到：
spectra: Knowledge graph loaded (1,847 nodes · 23 communities)
God nodes: UserService(42), AuthMiddleware(38), DatabasePool(25)
Communities: [用户服务核心(18), 认证授权(12), 数据持久化(8), ...]
→ Read specs/project/graph-report.md before searching raw files.
```

**验收**：
- Obsidian vault 在 Obsidian 中打开后双向链接正确渲染，Graph View 可用
- HTML 在浏览器中可交互（搜索、点选、社区过滤）
- Hook 安装后不破坏用户已有 settings.json 配置
- Post-commit hook 对纯代码提交 < 3 秒完成

---

### Phase 4: 查询与服务 — MCP Query API

**动机**：图谱构建后需要可编程查询能力。Graphify 通过 MCP serve + token budget 实现精确子图提取。

**前置依赖**：Phase 2（graph.json）

**实现方式**：在现有 `src/mcp/server.ts` 上追加 tool，不另起独立服务。

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-40 | **Graph query tool 集**：在现有 MCP Server 追加 5 个 tool（query / node / path / community / god_nodes）。自动加载 `_meta/graph.json` | Graphify `serve.py` |
| 100-41 | **自然语言查询**：`spectra_query("认证流程涉及哪些模块？")` → BFS/DFS 遍历相关子图 + 路径 + 摘要文本 | Graphify query 机制 |
| 100-42 | **Token 预算控制**：`budget` 参数限制返回子图的节点数（默认 50 节点），超出时优先保留高度数节点和最短路径上的节点 | Graphify `--budget` |
| 100-43 | **CLI 前端**：`spectra query "问题"` 命令加载 graph.json + 社区数据，输出子图摘要到 stdout | — |

**CLI 体验**：
```bash
$ spectra query "认证和授权的关系" --budget 20
  Subgraph: 12 nodes · 18 edges (budget: 20 nodes)
  
  AuthMiddleware --calls--> TokenValidator [EXTRACTED]
  TokenValidator --imports--> JWTDecoder [EXTRACTED]
  AuthMiddleware --semantically_similar_to--> RBACGuard [INFERRED 0.78]
  ...
```

**MCP Tool 使用**（Claude Code 通过 plugin MCP 自动调用）：
```
User: 认证模块怎么工作的？
Claude: [自动调用 spectra_query tool]
       [返回 AuthMiddleware 子图]
       认证模块以 AuthMiddleware 为核心，通过 TokenValidator 验证 JWT...
```

**性能目标**：
- 单次 query 响应（graph.json 已加载）：< 500ms
- graph.json 加载（5,000 节点）：< 2 秒

**验收**：`spectra query` 返回相关子图且不超预算；MCP tool 可被 Claude Code 正确调用。

---

### Phase 5: Watch + 增量演化

**动机**：大型项目需要持续维护图谱和 spec 的新鲜度。Graphify 通过 watch + hook + 缓存实现"改一个文件，3 秒更新图谱"。

**前置依赖**：Phase 1（缓存）— watch 需要缓存层才能做到秒级增量

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-50 | **Watch 模式**：`spectra watch` 使用 chokidar 监听文件变化。代码变化 → 立即重建 AST 层 + 更新 graph.json（0 token）。文档变化 → 标记 `_meta/needs_update` 待手动 `spectra batch --update` | Graphify `watch.py` |
| 100-51 | **`--update` 模式**：`spectra batch --update` 仅对 manifest 标记为 changed 的文件重新运行 LLM 提取，其余走缓存。与现有 `--incremental` 整合（incremental 是 spec 级别，update 是文件级别） | Graphify `--update` |
| 100-52 | **Debounce 防抖**：watch 模式下 3 秒防抖窗口，避免保存风暴触发大量重建。忽略 `.gitignore`、`node_modules/`、`specs/` 自身输出 | Graphify debounce |

**CLI 体验**：
```bash
$ spectra watch
  [spectra] Watching /project/src for changes (debounce: 3s)
  [spectra] src/api/routes.ts changed → AST rebuild (0.8s)
  [spectra] → 1,849 nodes · 3,258 edges · 23 communities (graph.json updated)
  [spectra] docs/api-guide.md changed → Marked for semantic update
  [spectra]   Run `spectra batch --update` to re-extract semantic content
```

**降级策略**：
- chokidar 不可用 → 回退到 `fs.watch`（功能相同但跨平台稳定性差）
- watch 进程意外退出 → 下次 `spectra batch` 自动检测 `needs_update` 标志并处理

**验收**：代码文件变化 < 3 秒自动更新 graph.json（无 LLM 成本）；`spectra batch --update` 仅处理标记文件。

---

### Phase 6: 多模态内容提取

**动机**：Graphify 支持代码 + 文档 + 论文 + 图像 + 视频五种输入。当前仅支持代码。

**前置依赖**：Phase 1（缓存）+ Phase 2（图谱模型支持 document/image 节点 kind）

| Feature | 说明 | 参考 |
|---------|------|------|
| 100-60 | **Markdown 文档提取**：从项目中的 .md 文件提取概念、设计决策、命名实体，作为图谱节点（kind: `document`）。用 LLM 提取语义关系，标记为 INFERRED | Graphify 语义提取 |
| 100-61 | **OpenAPI / AsyncAPI 解析**：自动检测 openapi.yaml / asyncapi.yaml，AST 级确定性提取 endpoint、schema、event 作为一等节点（kind: `api`），标记为 EXTRACTED | 现有 api-surface 扩展 |
| 100-62 | **图像/图表理解**：对项目中的架构图（.png/.svg）使用 Claude Vision 提取组件和关系（kind: `diagram`），标记为 INFERRED | Graphify 图像提取 |

**CLI 体验**：
```bash
$ spectra batch --include-docs --include-images
  Scanning: 63 code files, 12 markdown docs, 3 architecture diagrams
  [AST] 63 code files → 1,200 nodes (0 tokens)
  [DOC] 12 markdown files → 85 concept nodes (2,400 tokens)
  [IMG] 3 diagrams → 15 component nodes (1,800 tokens)
  Total: 1,300 nodes · 2,800 edges · 18 communities
```

**验收**：.md 文件中的设计决策出现在图谱中且可查询；OpenAPI endpoint 作为一等节点参与社区检测。

---

## Phase 依赖关系（修正版）

```
Phase 0 (重命名 v3.0.0)
  │
  ▼
Phase 1 (缓存 v3.1.0)
  │
  ├────────────┬──────────────┐
  ▼            ▼              ▼
Phase 2      Phase 5        Phase 6
(图谱)       (Watch)        (多模态)
v3.2.0       v3.5.0         v3.6.0
  │
  ├──────────┐
  ▼          ▼
Phase 3    Phase 4
(导出)     (Query)
v3.3.0     v3.4.0
```

> **修正说明**：原版 Phase 6 (多模态) 错误地依赖 Phase 4 (Query)。
> 实际上多模态提取依赖的是 Phase 1 (缓存) + Phase 2 (图谱模型)，与 Query API 无关。
> Phase 5 (Watch) 也只依赖 Phase 1 (缓存)，与 Phase 2 (图谱) 可并行。

## 版本路线

| Phase | 版本 | 里程碑名 | 预估复杂度 |
|-------|------|---------|-----------|
| Phase 0 | v3.0.0 | Spectra Rebrand | M — 纯机械替换但涉及面广 |
| Phase 1 | v3.1.0 | Cache & Incremental | L — 缓存设计 + manifest + generator 适配 |
| Phase 2 | v3.2.0 | Knowledge Graph | XL — 图模型 + 社区检测 + 分析报告 |
| Phase 3 | v3.3.0 | Multi-Format Export | L — Obsidian vault + HTML 可视化 + Hook |
| Phase 4 | v3.4.0 | Query & Serve | M — MCP tool 扩展 + BFS/DFS 查询 |
| Phase 5 | v3.5.0 | Watch & Evolution | M — chokidar 集成 + debounce + update 模式 |
| Phase 6 | v3.6.0 | Multi-Modal | L — 文档提取 + OpenAPI 解析 + Vision |

## 与现有能力的关系

| 现有能力 | 演进方向 | Phase |
|---------|---------|-------|
| `reverse-spec <target>` | → `spectra <target>`（保持不变） | P0 |
| `reverse-spec batch` | → `spectra batch`（+ 缓存 + 增量 + `--update`） | P0+P1 |
| `reverse-spec diff` | → `spectra diff`（不变） | P0 |
| `src/mcp/server.ts` | → 追加 graph query tool 集 | P0+P4 |
| architecture-ir | → graph.json 的 EXTRACTED 边数据源 | P2 |
| doc-graph | → graph.json 的交叉索引层 | P2 |
| cross-reference-index | → 图谱置信度标签的一部分 | P2 |
| docs-bundle | → Obsidian vault 的另一种 audience-oriented 输出 | P3 |
| panoramic generators | → 图谱节点和边的提取器 + 接入缓存 | P1+P2 |
| `batch --incremental` | → 与 `--update` 整合（incremental=spec 级，update=文件级） | P1+P5 |
| spec-driver 引用 reverse-spec | → 15 处引用更新为 spectra | P0 |

## 关键技术风险

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| npm `spectra` 已被占用 | 包名冲突 | 使用 `spectra-cli`（bin 入口仍为 `spectra`） |
| TypeScript 生态无 Leiden 算法 | 社区检测精度 | Phase 2 用 `graphology-communities-louvain`（纯 JS）；需要 Leiden 时 Phase 4 spawn Python 子进程 |
| Hook 注入破坏用户 settings.json | 用户配置丢失 | 写入前备份；使用 JSON merge 而非覆盖；仅操作项目级 settings |
| chokidar 跨平台稳定性 | watch 模式不可靠 | 回退到 `fs.watch` + 轮询；降级时打印 warning |
| graph.json 体积过大 | 加载缓慢、上下文爆炸 | 5,000+ 节点时分层存储（summary graph + full graph）；query 默认 budget 50 节点 |
| 重命名涉及面广 | 遗漏替换点 | 编写 `rename-audit.sh` 脚本扫描所有 reverse-spec 引用；集成测试覆盖 |

## 参考设计

- **Graphify** (`_reference/graphify/`)：图谱构建、社区检测、缓存、Hook、Obsidian 导出
- **graphology** (npm)：纯 JS 图数据结构 + Louvain 社区检测
- **Obsidian**：双向链接 + Graph View（导出格式参考）
- **vis.js / d3-force**：HTML 图可视化（导出参考）
