# Spectra — 产品规范活文档

> **产品**: spectra
> **发布版本**: v4.7.0
> **版本**: 聚合自 108 个增量 spec（001–290，含 094-xx 子编号与 170c/170d 字母后缀；34 份按 product-mapping.yaml 头部登记排除）
> **最后聚合**: 2026-09-14
> **生成方式**: Spec Driver sync 聚合 + 人工校准
> **状态**: 活跃

---

## 目录

1. [产品概述](#1-产品概述)
2. [目标与成功指标](#2-目标与成功指标)
3. [用户画像与场景](#3-用户画像与场景)
4. [范围与边界](#4-范围与边界)
5. [当前功能全集](#5-当前功能全集)
6. [非功能需求](#6-非功能需求)
7. [当前技术架构](#7-当前技术架构)
8. [设计原则与决策记录](#8-设计原则与决策记录)
9. [已知限制与技术债](#9-已知限制与技术债)
10. [假设与风险](#10-假设与风险)
11. [被废弃的功能](#11-被废弃的功能)
12. [变更历史](#12-变更历史)
13. [术语表](#13-术语表)
14. [附录：增量 spec 索引](#14-附录增量-spec-索引)

---

## 1. 产品概述

Spectra 是一个面向代码与工程制品的 **结构化逆向文档与知识图谱工具链**。它最初聚焦于 TypeScript/JavaScript 的 Spec 生成与漂移检测，现已演进为覆盖 **多语言代码分析、批量文档化、全景文档生成、交叉引用、覆盖率审计、增量重生成、多源事实接入、文档交付编排、知识图谱持久化、社区检测、多格式导出与多模态制品提取** 的产品能力集合。

当前产品定位有四层：

- **逆向规格层**：从源代码、依赖图和配置中生成结构化 spec、差异报告与批量索引；通过深度代码反求（095）和 AST 直出策略（097）消除核心章节空壳
- **全景文档层**：基于统一的 `ProjectContext`、Generator/Parser 注册机制和共享中间模型，生成数据模型、配置、API、运行时、架构、事件面、故障排查、模式提示等多种文档
- **文档系统层**：在技术事实之上继续组织 docs bundle、Architecture IR、component / dynamic、ADR、quality gate 以及产品 / UX 文档
- **知识图谱层**：基于 `_meta/graph.json` 统一持久化架构关系、文档关系和交叉引用，支持社区检测、God Node 识别、MCP 查询、多格式导出（Obsidian Vault / HTML）、文件监听增量同步、PreToolUse Hook 注入与多模态制品提取
- **Agent 上下文层**：把知识图谱与源码直接暴露为 agent 可调用的上下文工具（`impact` / `context` / `detect_changes` 影响面与 symbol 360°，`view_file` / `search_in_file` / `list_directory` 文件导航），让 LLM agent 用少量结构化调用取代整文件读取与人工 grep（155, 171）
- **领域知识层**：scaffold-kb 把厂商 SDK 文档与项目文档打包成可检索的双层知识库（FTS5 全文检索 + API 实体层），经 KB MCP 工具消费并统一标注为 untrusted evidence（190, 192）

**核心价值**：

- **多语言覆盖**：从 JS/TS 扩展到 Python、Go、Java，并支持混合项目检测与分组处理
- **文档类型扩展**：从单一模块 spec 扩展到 10+ 类 panoramic 文档
- **深度质量提升**：AST 骨架 + LLM 语义桥接消除核心章节空壳，AST 直出接口定义和数据结构表格实现全面超越纯 LLM 的质量
- **知识图谱能力**：统一 architecture-ir / doc-graph / cross-reference-index 为持久化知识图谱，支持社区检测、架构洞察、MCP 查询与多格式可视化导出
- **可持续维护**：支持 doc graph、coverage audit、delta regeneration、内容哈希缓存与文件监听增量同步，避免文档生成一次后失管
- **交付能力增强**：输出 docs bundle、Architecture IR、ADR、quality report 和产品 / UX 文档，文档不再只是散落文件
- **多入口复用**：CLI、Claude Code Plugin 与 MCP Server 共用同一核心能力
- **分发结构收敛**：`plugins/spectra/skills/**` 作为 Spectra Skill 的 canonical source，`src/skills-global/**` 与 `skills/**` 转为可再生成镜像
- **发布合同统一**：package、plugin metadata、README release 行与产品事实层共享同一 release contract，同步路径更短、更可校验
- **品牌统一**：产品从 reverse-spec 统一重命名为 Spectra（099），npm 包名 `spectra-cli`，CLI bin 入口 `spectra`
- **诚实降级**：在 LLM、解析器或上游制品不足时保留 AST-only / 目录图 / 占位说明等静默降级路径
- **采纳工程**：MCP 工具 description 的 4 要素结构与 response 内嵌的决策增强字段（`topImpacted` / `nextStepHint` / `riskTier`），配合子代理侧「任务→工具」优先规则，把 agent 上下文工具从「理论可用」推进到「实际被调用」（170c, 170d）

**分发方式**：

- **CLI**：`spectra generate|batch|diff|graph|community|watch|cache|install|mcp-server|auth-status`，另含 `index`、`graph-quality`、`panoramic`、`scaffold-kb` 四组子命令（094-07, 156, 190, 217）
- **Plugin**：`plugins/spectra/.claude-plugin/plugin.json`
- **MCP**：通过 stdio server 暴露 18 个已注册工具，覆盖生成 / 批量 / graph query / agent context / 文件导航 / 知识库检索 / 版本自省（271）

---

## 2. 目标与成功指标

### 产品愿景

让开发者可以把"看代码理解系统"转成"读取持续更新的结构化文档与知识图谱理解系统"，并让文档体系从单点生成演进为覆盖架构、接口、运行时、维护视角、社区结构与跨制品语义关联的长期事实层。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 单模块 Spec 生成可用性 | 一条命令完成结构化文档生成 | 001 |
| 接口定义准确率 | 100% 来自 AST / 结构提取，零 LLM 捏造签名 | 001 |
| 核心章节非空率 | Section 2（接口定义）和 Section 3（业务逻辑）100% 包含实质内容 | 095, 097 |
| 接口定义章节质量 | AST 直出分组表格，质量 >= 纯 LLM | 097 |
| 批量处理自主性 | 对大型项目支持断点恢复、进度报告与失败降级 | 001, 006, 007 |
| 多语言首批覆盖 | Python / Go / Java 三种语言首批可用 | 024–031 |
| 混合项目识别 | 混合项目自动按语言分组并生成索引 | 031 |
| 全景文档生成器规模 | >= 10 类生成器可注册、发现与执行 | 033–050 |
| 输出格式 | Markdown + JSON + Mermaid `.mmd` + Obsidian Vault + HTML | 051, 103 |
| 文档互链能力 | 生成 related spec、稳定 anchor 与 `_doc-graph.json` | 044 |
| 文档审计能力 | 输出 coverage report，覆盖缺失、断链、低置信度 | 046 |
| 增量更新能力 | 支持 `--incremental` 仅重生受影响文档 | 049 |
| 单语言非 TS/JS batch 可用性 | Python/Go/Java 项目不再出现 0 模块 | 052 |
| 文档交付编排 | 自动生成 docs bundle、阅读路径与 MkDocs 兼容骨架 | 055 |
| 架构统一建模 | 输出 `ArchitectureIR`、JSON / Mermaid / Structurizr DSL | 056 |
| 组件与动态链路 | 生成 component view 与 dynamic scenarios | 057 |
| 决策与治理 | 输出 ADR、provenance 与 quality report | 058, 059 |
| 产品事实接入 | 输出 product-overview、user-journeys、feature-briefs | 060 |
| Skill 分发收敛 | Spectra Skill 的 canonical source / mirror / validator 合同收敛 | 079 |
| 发布合同统一 | package / plugin / marketplace / README / current-spec 通过 release contract 统一同步 | 080 |
| 内容哈希缓存 | 二次 batch（少量变化）耗时 < 30 秒，缓存命中率 > 90% | 100 |
| 知识图谱持久化 | 统一 `_meta/graph.json`，置信度标签系统，NetworkX 兼容 | 101 |
| 社区检测与架构洞察 | 输出 `GRAPH_REPORT.md`，含社区列表、God Node、异常边 | 102 |
| 多格式导出 | Obsidian Vault（双向链接 + Graph View）+ HTML 交互式可视化 | 103 |
| PreToolUse Hook | Claude Code 搜索前自动注入架构摘要 | 104 |
| Post-commit Hook | git commit 后自动触发增量图谱更新 | 104 |
| MCP Graph Query | 5 个 MCP 工具：query / node / path / community / stats | 105 |
| 文件监听增量同步 | `spectra watch` 持续监听 + debounce + 增量 batch | 106 |
| 多模态制品提取 | Markdown/OpenAPI/AsyncAPI/图像→知识图谱节点 | 107 |
| 四语言调用边质量 | label-only precision >= 70% / recall >= 30%（N=3 中位数） | 151–154 |
| 增量索引响应 | 改 1 个文件后 < 30 秒（micrograd / nanoGPT / ~250 .ts 自举仓） | 156 |
| 零 LLM 建图 | `--mode graph-only` 纯 AST，实测 2.8s（对照 batch code-only ~27min） | 195 |
| 图质量门禁 | 语义重复 canonical ID = 0、悬空边 = 0、contains 覆盖率 100%、orphan <= 5% | 217 |
| 产物字节稳定 | 全量与无改动增量产物归一化后字节 / deepEqual 一致 | 175 |
| 知识库检索召回 | 中文 / 中英混合 / 短错误码 / API 符号 recall@5 >= 0.80，`kb_search` P95 <= 200ms | 190 |
| MCP 工具面完整度 | 18 个已注册工具；错误 envelope 与 telemetry 覆盖 17/17 | 177, 271 |
| MCP 工具 description 合格线 | agent-context 三工具 description 均满足 100-500 字符 + lead-in >= 10 字符 + "Use this tool when" >= 3 场景 + Example + Typical chained usage 五项硬约束 | 170c |
| Agent 工具采纳率 | 引导注入后 caller-analysis 类任务 guided active-call rate >= 50%（host 实测 8/10 = 80%，Wilson 95% CI [49.0%, 94.3%]；无引导 spontaneous baseline 0/10） | 170c, 170d |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **接手遗留模块的开发者** | 需要快速理解某个目录或模块 | 运行 `spectra generate <target> --deep` |
| **大型仓库维护者** | 需要批量生成全项目文档并保持可更新 | 运行 `spectra batch` / `spectra batch --incremental` / `spectra watch` |
| **多语言平台工程师** | 管理 Python、Go、Java、TS/JS 混合仓库 | 使用多语言适配器和 mixed-project batch |
| **架构/文档负责人** | 需要 API、运行时、架构、事件、排障等 panoramic 文档 | 调用 panoramic generators 或 batch 输出 |
| **集成开发者** | 通过外部 Agent / 工具调用能力 | 使用 CLI 或 MCP Server |
| **架构分析师** | 需要理解代码库的社区结构与架构热点 | `spectra graph` + `spectra community` + MCP graph query |
| **知识管理者** | 需要将架构知识导出到 Obsidian 或可视化面板 | `spectra export --format obsidian\|html` |
| **LLM Agent / 子代理** | 需要低 token 的结构化代码上下文，而非整文件读取与人工 grep | 调用 `impact` / `context` / `detect_changes` 与 `view_file` / `search_in_file` / `list_directory` |
| **SDK 厂商与集成商** | 需要把 SDK 文档变成可检索知识库，并在写代码前查证 API 事实 | `spectra scaffold-kb build\|ingest\|query` + `kb_search` / `kb_doc_lookup` / `kb_api_lookup` |

### 核心使用场景

1. **单模块逆向规格**：为一个目录或模块生成结构化 spec，快速理解意图、接口、依赖和边界
2. **批量项目文档化**：为 monorepo 或多语言项目构建模块图、索引、覆盖率和增量更新链路
3. **架构与运行时梳理**：从 Dockerfile、Compose、配置与 workspace 结构产出架构概览和部署视图
4. **接口与事件面盘点**：生成 API Surface、事件面文档和相关 Spec 互链，支撑 onboarding 与 review
5. **文档维护闭环**：在代码变更后运行 diff、coverage audit、delta regeneration，缩小文档漂移
6. **文档交付与架构审查**：按受众生成 docs bundle，并输出 Architecture IR、component view、dynamic scenarios 和 ADR
7. **产品与 UX 文档补全**：基于 `current-spec.md`、README、设计说明和 issue/PR 生成产品概览、用户旅程和 feature brief
8. **知识图谱构建与分析**：运行 `spectra graph` 构建统一知识图谱，运行 `spectra community` 获取社区检测和架构洞察报告
9. **持续同步**：通过 `spectra watch` 文件监听或 post-commit hook 保持文档与代码自动同步
10. **MCP 交互式查询**：通过 Claude Code 的 MCP 工具实时查询节点详情、最短路径和社区统计
11. **多模态文档扩展**：通过 `--include-docs` 将 Markdown、OpenAPI、图像等工程制品纳入知识图谱
12. **改动影响面评估**：`detect_changes` → `impact` → `context` → `view_file` 四步链路，从 git diff 一路走到 symbol 上下文与代码行定位
13. **零 LLM 冷启动建图**：新 worktree 或无认证环境用 `spectra batch --mode graph-only` 秒级建图，graph 类 MCP 工具立即可用
14. **知识库构建与查证**：厂商打包 SDK 文档、集成商导入项目文档，写代码前经 KB MCP 工具查 API 实体、废弃标记与冲突推荐
15. **图质量与新鲜度体检**：`spectra graph-quality` 六指标 + `sourceCommit` / collector 指纹双维 freshness，接入 `repo:check` 做提交前门禁
16. **Agent 工具采纳引导**：子代理 prompt 内置「任务→工具」优先规则，caller analysis / blast radius 类任务默认走 `impact` 而非 Grep，MCP 不可用时回退 Grep；response 内嵌 `nextStepHint` 继续引导下一步调用（170c, 170d）

---

## 4. 范围与边界

### 范围内

- TypeScript / JavaScript / Python / Go / Java 源码分析
- 基于 `LanguageAdapter`、tree-sitter 与现有 AST 路径的多语言解析
- 单模块 spec、批量索引、依赖图、漂移检测
- 深度代码反求：AST 骨架 + LLM 语义桥接，消除接口定义和业务逻辑章节空壳（095）
- AST 直出接口定义与数据结构表格，混合策略全面超越纯 LLM（097）
- panoramic 文档：数据模型、配置、workspace、跨包依赖、API、运行时、架构、事件面、故障排查、模式提示
- 非代码制品解析：Dockerfile、YAML、TOML、`.env`、SKILL.md、behavior YAML
- Markdown / JSON / Mermaid 输出
- doc graph、coverage audit、delta regeneration
- CLI / Plugin / MCP 三种交付入口
- SHA256 内容哈希缓存：`_meta/_cache-manifest.json`、`spectra cache` CLI 子命令（100）
- 知识图谱持久化：`_meta/graph.json`、置信度标签、`spectra graph` CLI（101）
- 社区检测与架构洞察：`spectra community`、`GRAPH_REPORT.md`（102）
- 多格式导出：Obsidian Vault（双向链接 + frontmatter）、HTML 交互式可视化（103）
- PreToolUse Hook + Post-commit Hook：`spectra install`（104）
- MCP Graph Query 工具集：graph_query / graph_node / graph_path / graph_community / graph_stats（105）
- 文件监听增量同步：`spectra watch`、debounce、SIGINT 优雅退出（106）
- 多模态制品提取：Markdown 文档、OpenAPI/AsyncAPI 规范、图像图表→知识图谱节点（107）
- 四语言 callSites 抽取与 `UnifiedGraph` 统一图事实源（151–154）
- 增量索引与 snapshot 持久化：`.spectra/unified-graph.json`、`spectra index --watch|--incremental`（156）
- Agent context 与文件导航 MCP 工具：impact / context / detect_changes、view_file / search_in_file / list_directory（155, 171）
- 图质量门禁与 freshness 判定：`graph-quality` 六指标、`graph.sourceCommit`、collector 指纹（217, 249, 266）
- 图跨 worktree 可移植：id 相对化 + bootstrap copy-if-absent（193）
- 领域知识脚手架 scaffold-kb：build / ingest / query / serve + KB MCP 三工具（190, 192, 205）
- 技术债引擎：代码 TODO/FIXME 与设计文档 open questions 提炼（130）
- LLM 成本透明与预算控制：costBreakdown 记账、dry-run 预估、`--budget` 超限策略（127, 140）
- MCP 工具采纳工程：agent-context 三工具 description 4 要素、response 决策增强字段与三路径兼容合同，以及子代理侧「任务→工具」优先规则单一事实源（170c, 170d）

### 范围外

- 自动修改、重构或生成业务代码
- Rust、C++、Kotlin、Ruby、Swift 等非首批语言的完整一等支持
- IDE 内实时飘移提醒和可视化编辑
- 自动测试用例生成
- 文档内容的外部发布编排与站点部署
- Plugin 自动升级、签名校验与远程策略下发
- 向量数据库 / embedding rerank 作为默认检索路径（190：仅在 recall@k 不达标时才评估）
- PDF OCR（只抽有文本层的 PDF）与运行时 `kb_ingest` MCP 写入工具（192）
- Windows 路径归一化（文件导航工具目标平台仅 posix）（171）
- symbol rename-follow（重命名后旧锚统一标 orphaned）（189）
- 跨 repo group mode 与 sqlite / 图数据库持久化（156）
- `graph-tools.ts` 各工具的 description / response 升级（170c 严格排除，如需升级须独立立项）
- 改变 driver 模型的内在偏好：引导只度量 guided active-call rate（引导是否被遵循），不宣称 spontaneous preference 被改变（170d）

---

## 5. 当前功能全集

### FR-GROUP-1: 核心分析流水线

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | 使用 AST / tree-sitter 提取导出符号、类型、依赖与骨架信息 | 001, 027 | 活跃 |
| FR-002 | 强制三阶段混合流水线：预处理 → 上下文组装 → 生成与增强 | 001 | 活跃 |
| FR-003 | LLM Prompt 与代码块标记按语言参数化 | 026 | 活跃 |
| FR-004 | 敏感信息脱敏与 `[推断]` / `[不明确]` / AST-only 降级标记 | 001, 006, 051 | 活跃 |
| FR-078 | 文件导航 MCP 工具 `view_file` / `search_in_file` / `list_directory`：按行区间或 symbolId 取片段、单文件 pattern 搜索、列目录；三者 path 参数经 `resolveSafePath` 统一 containment 判定（词法层先判、仅根内路径才 realpath 穿透 symlink），越界返回 `path-outside-root` 且不含根外字节；`projectRoot` 固定为 server 启动 cwd、不作为客户端可传参数 | 171 | 活跃 |
| FR-079 | symbol id 模糊解析 `resolveSymbolFuzzy(graphData, query, opts)`：四层顺序执行（exact → path-suffix → partial-name → levenshtein）命中即停，候选去重后唯一且 confidence >= 0.9（production floor）时 `autoResolved`，响应附 `resolvedFrom`/`resolvedTo`/`resolvedConfidence` 与 `warnings: ['fuzzy-resolved']`，否则回传 top-3 `SymbolCandidate` | 174 | 活跃 |
| FR-080 | `spectra batch --mode graph-only`：纯 AST、零 LLM、不走 `checkAuth` 的建图入口，复用与 batch 相同的采集器与 `writeKnowledgeGraph` 写盘出口，产出同 schema `graph.json` 并通过 portable 守卫（绝对路径节点数 = 0） | 195 | 活跃 |
| FR-081 | re-export 导出符号识别：`ExportKind` 新增 `'re-export'`，`ExportSymbol` 新增 `reExportFrom` / `isTypeOnly`；图派生与 call-resolver 按 kind 过滤防污染图质量门；`renderSpec` / `renderIndex` / `renderDriftReport` 三渲染出口统一剥离行尾空白 | 221 | 活跃 |
| FR-082 | symbol 节点行区间定位：`deriveNodesFromSkeletons` 为带 startLine/endLine 的 `ExportSymbol` 写入 `metadata.lineRange`，graph-builder 两个 `UnifiedNode`→`GraphNode` 分支均须透传；`src/knowledge-graph/line-range.ts` 以 span 并集 + 退化门控处理同名符号碰撞，member 节点按「诚实缺席」不写该字段 | 271 | 活跃 |

### FR-GROUP-2: 批量生成与漂移检测

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-005 | `generate`、`batch`、`diff`、`graph`、`community`、`watch`、`cache`、`install`、`mcp-server`、`auth-status` 子命令 | 001, 002, 004, 009, 100–106 | 活跃 |
| FR-006 | 模块级 batch：拓扑排序、循环依赖聚合、checkpoint 与进度报告 | 001, 005, 006 | 活跃 |
| FR-007 | LLM 失败或超时时重试并回退 AST-only | 006, 007 | 活跃 |
| FR-008 | mixed-project batch 支持按语言分图与合并 | 031 | 活跃 |
| FR-009 | `--incremental` 仅重生成受影响 spec，并输出 delta report | 049 | 活跃 |
| FR-010 | 单语言非 TS/JS 项目 batch 走适配器图或目录图兜底 | 052 | 活跃 |
| FR-011 | 漂移检测支持结构差异、语义差异与噪声过滤 | 001, 026 | 活跃 |
| FR-083 | 进度与日志分流：按 `process.stdout.isTTY` 自动选 tty/pipe 模式，pipe 模式禁用进度条并逐模块输出 `[N/Total] module-path ... status` 纯文本行；分级 logger（debug/info/warn/error，统一走 stderr）由 `REVERSE_SPEC_LOG_LEVEL` 控制，原本静默的降级与关键解析失败按级别可见 | 094-06 | 活跃 |
| FR-084 | 目录级分组只产生 1 个含多文件的模块（排除 root）时自动降级为文件级分组，每个源文件成为独立 `ModuleGroup`，避免单包扁平项目退化为 1 节点 0 边 | 114 | 活跃 |
| FR-085 | 多模块并发 LLM 调用：`p-limit` 替换手写信号量，默认并发 3（优先级链 CLI `--concurrency=N` > `batch.concurrency` 配置 > 默认），单模块失败经 try/catch 隔离、整批收尾用 `Promise.allSettled`，`concurrency<=1` 保留原顺序路径 | 146 | 活跃 |
| FR-086 | batch 默认走增量路径（`incremental=true`），CLI / MCP / config 三入口的默认值由唯一 `resolveRegenPlan` 归一化；保留 `--full`（`--force` 等效别名）全量逃生口且不被残留 checkpoint 绕过；无源码改动时模块级 `generateSpec` 调用次数为 0 | 175 | 活跃 |
| FR-087 | 产物字节稳定：`normalizeGraphForWrite` 写盘前归一化时间戳并按确定性 key 排序节点/边/超边，`inputHash` 经 stripVolatileFields + stableStringify + sha256 保留内容敏感性；孤儿 `*.spec.md` 按 `generatedByMode` + 受管目录双重校验清理 | 175 | 活跃 |
| FR-088 | `BatchMode` 轻量模式枚举（full / reading / code-only）经 CLI flag 与 MCP batch 工具 schema 两入口传入：reading 跳过产品文档层生成器，code-only 在此基础上再跳过全部 design-doc 推断步骤 | 132 | 活跃 |
| FR-089 | MCP `batch` 工具 mode 枚举新增 `graph-only`，handler 层提前分支复用 `buildAstGraphOnly`（不进 `runBatch` validModes）；该路径忽略 incremental/full/force 等 regen 轴参数，同传 `languages` 仅日志告警不过滤 | 202 | 活跃 |

### FR-GROUP-3: 多语言扩展

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-012 | `LanguageAdapter` 抽象层与 Registry 统一文件路由 | 024, 025 | 活跃 |
| FR-013 | 首批适配器支持 Python / Go / Java | 028, 029, 030 | 活跃 |
| FR-014 | tree-sitter grammar 管理与 query mapper 支撑多语言解析 | 027 | 活跃 |
| FR-015 | 混合项目语言分布识别、目录分组与索引展示 | 031 | 活跃 |
| FR-090 | Python 函数/类级符号默认进图：`PythonLanguageAdapter.analyzeFile()` 提取全部 `.py` 符号并作为 `buildKnowledgeGraph()` 第四路数据源，节点 ID 用 `{相对路径}#{symbolName}`（后由 214 收敛为 canonical 格式）保证跨文件同名唯一，并生成 module→function/class 的 `contains` 边 | 145 | 活跃 |
| FR-091 | `GoMapper.extractCallSites()`：遍历 AST 产出 `CallSite[]`，维护 callerContext / receiverVarName 栈，calleeKind 严格按 11 行分类表映射（free / cross-module / member / unresolved），phantom call 与 ERROR 节点跳过畸形子树但继续遍历；`GoLanguageAdapter.analyzeFile` 透传 `extractCallSites` flag | 153 | 活跃 |
| FR-092 | `JavaMapper.extractCallSites()`：抽取 method_invocation / 构造器 / super(this) / lambda 内部调用，取消 `free` 分支统一归 `member`，反射方法名归 `unresolved`（常量集合与 extractor 同源），源码 > 1MB 提前返回空数组并 warn；`JavaLanguageAdapter.analyzeFile` 的 `extractCallSites` 默认 false | 154 | 活跃 |
| FR-093 | `.pyi` 类型 stub 纳入 Python 符号采集面（extraction 路）：`PYTHON_SYMBOL_SCAN_SURFACE` 扩展为 `['.py', '.pyi']`，stub 符号获得 signature / symbolKind / `confidence:'EXTRACTED'` / `sourceTag:'extraction'` 元数据；护栏 A 保证 import 解析永不落到 `.pyi`，护栏 B 剥离 extraction 路 module 节点 label 的扩展名 | 250 | 活跃 |

### FR-GROUP-4: Panoramic 基础设施

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-016 | `DocumentGenerator` / `ArtifactParser` 接口及统一契约 | 033, 034 | 活跃 |
| FR-017 | `ProjectContext` 聚合包管理器、workspace、语言、配置和已有 spec | 035 | 活跃 |
| FR-018 | `GeneratorRegistry` / `ParserRegistry` 管理生成器与解析器 | 036 | 活跃 |
| FR-019 | `AbstractRegistry` / `AbstractConfigParser` 支撑统一解析扩展 | 036, 037 | 活跃 |
| FR-020 | Dockerfile、YAML、TOML、env、SKILL.md 等制品解析器 | 037, 039 | 活跃 |
| FR-021 | LLM 语义增强与 `MultiFormatWriter` 输出 Markdown / JSON / Mermaid | 051 | 活跃 |
| FR-094 | `src/panoramic/utils/llm-facade.ts` 统一 LLM 调用入口（`callLLM` / `LLMCallOptions` / `extractJsonArray` / `isLLMAvailable`），封装 detectAuth→路由→降级全链；`src/panoramic/` 下仅此一处直接 import 认证四件套，timeout/maxTokens/temperature 一律经选项透传不得硬编码 | 094-03 | 活跃 |
| FR-095 | 6 个文档生成模块以委托模式接入 `DocumentGenerator` Adapter 并注册进 `GeneratorRegistry`（数量 13 → 19），原导出函数签名与行为不变；`docs-quality-evaluator` 采用编排感知型 extract，从 outputDir 读取最多 11 个可选上游 JSON 快照 | 094-03 | 活跃 |
| FR-096 | panoramic 导出分层：`index.ts` 仅导出经审计的 15 个公共 API 符号（export 行数 <= 60），其余约 100+ 非公共符号收进标注 `@internal` 的 `internal.ts` | 094-04 | 活跃 |
| FR-097 | panoramic 分析桥（Thin Facade）：`spectra panoramic cross-package\|architecture-ir\|overview [--json] [--project-root <dir>]` CLI 与 MCP `panoramic-query` 工具共享同一 `src/panoramic/query.ts` helper；cross-package 输出含 hasCycles / cycleGroups / topologicalOrder / levels / stats，非 monorepo 时非零退出码；输出格式与 schemaVersion 记于 `contracts/panoramic-bridge.md`；MCP 侧 `projectRoot` 为必需参数不隐式推断 | 094-07 | 活跃 |
| FR-098 | `detectPackageManager` 在 lock 文件检测链之后追加 `pyproject.toml` 检测（含 `[tool.poetry]` 判 poetry，否则 pip），`PackageManagerSchema` 新增 `poetry` 枚举值，pyproject-only 项目不再返回 unknown | 114 | 活跃 |

### FR-GROUP-5: Panoramic 文档生成器

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-022 | `DataModelGenerator` 生成数据模型文档与 ER 图 | 038 | 活跃 |
| FR-023 | `ConfigReferenceGenerator` 生成配置参考手册 | 039 | 活跃 |
| FR-024 | `WorkspaceIndexGenerator` 生成 monorepo 层级架构索引 | 040 | 活跃 |
| FR-025 | `CrossPackageAnalyzer` 分析跨包依赖与循环依赖 | 041 | 活跃 |
| FR-026 | `ApiSurfaceGenerator` 支持 schema / introspection / AST 三层 API 提取 | 042 | 活跃 |
| FR-027 | `RuntimeTopologyGenerator` 从 Dockerfile / Compose / env 抽取运行时模型 | 043 | 活跃 |
| FR-028 | `ArchitectureOverviewGenerator` 消费共享模型生成系统上下文和部署视图 | 045 | 活跃 |
| FR-029 | `EventSurfaceGenerator` 生成 channel inventory、事件流和状态附录 | 047 | 活跃 |
| FR-030 | `TroubleshootingGenerator` 输出 grounded troubleshooting 与 explanation | 048 | 活跃 |
| FR-031 | `PatternHintsGenerator` 输出架构模式提示、证据链和替代方案 | 050 | 活跃 |
| FR-099 | `InterfaceSurfaceGenerator` 为库 / SDK 项目生成公开接口摘要文档（`interface-surface.md` + `.json`）：基于已生成 module spec / baseline skeleton 汇总而不新增底层 parser，对 tests/examples/scripts 等低信号目录降权或排除，并纳入 `api-consumer` docs bundle profile 的稳定导航顺序 | 061 | 活跃 |
| FR-100 | quality evaluator 按项目类型区分 required-doc：library-SDK 项目要求 `interface-surface`、HTTP API 项目仍要求 `api-surface`；项目类型由项目配置与现有文档事实信号（`ProjectKindSignals`）联合判定，而非仅看 `api-surface` 是否存在 | 061 | 活跃 |
| FR-101 | `api-surface-generator.ts`（2,168 行）按依赖分层拆为 `src/panoramic/api-surface/` 下 8 个子模块（types ← utils ← endpoint-utils ← openapi / fastapi / framework-introspection / express 各 extractor ← index），每个子模块 <= 400 行，公开导出（`ApiSurfaceGenerator` + 7 个类型）与运行时行为不变 | 094-01 | 活跃 |
| FR-102 | 产品文档基于真实事实生成：旅程「消费输出」由 `deriveOutcomeFromScenario` 从 `scenario.summary` / `evidence.excerpt` 提取（evidence-backed mapping）；HTML 净化只处理行首锚定的 block 级标签并解码 entity，保留 TS 泛型 / CLI 占位符 / 数值比较等合法尖括号；CJK 文本用 `Intl.Segmenter` 做词句边界分段与截断，描述性段落判定不依赖 ASCII 空格分词 | 125 | 活跃 |
| FR-103 | ADR / 架构叙事 / hyperedges 三生成器共享 `clusterDispatch` MapReduce 调度层（聚类 → 并发 Map → Reduce），聚类策略三级 fallback（community → directory → single）；ADR 删除全部 8 个 hardcoded candidate 函数与关键词匹配，每条 evidenceRef 自动校验真实性、verified 少于 2 条即移除该 ADR；超 100k token 的 cluster 按贪心装箱拆子 cluster、零模块丢失 | 140 | 活跃 |
| FR-104 | 架构叙事走 3-pass critique（synthesize → critique → refine）；module spec frontmatter 必须含 `costBreakdown`（4 项 token 分解 + `contextTruncated`），ADR frontmatter 含 `generatedByModel` / `verified` / `supersededBy`；`_meta/graph.html` 从按复杂度阈值条件生成改为始终生成 | 140 | 活跃 |

### FR-GROUP-6: 文档图谱、审计与维护

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-032 | `DocGraphBuilder` 构建源码/模块/spec 关联图 | 044 | 活跃 |
| FR-033 | `CrossReferenceIndex` 回写 related spec、稳定 anchor 和 `_doc-graph.json` | 044 | 活跃 |
| FR-034 | `CoverageAuditor` 输出 `_coverage-report.md` / `.json` | 046 | 活跃 |
| FR-035 | 覆盖率审计包含 missing docs、unlinked specs、broken refs、low confidence | 046 | 活跃 |
| FR-036 | delta regeneration 复用 skeleton hash、dependency graph 与 doc graph owner mapping | 049 | 活跃 |
| FR-105 | 入口索引文档首屏注入图摘要（`Graph Summary Block`）：「核心代码抽象」取度数最高的前 5 个节点，「意外连接」列 >= 3 条跨社区 / 低置信度连接；插件文档须列出全部图查询工具（名称 + 用途 + 调用示例 + 预期输出） | 127 | 活跃 |
| FR-106 | LLM 成本透明与预算控制：每个生成产物元数据记录 input/output token 与毫秒耗时（`Cost Metadata`），batch 汇总日志含「LLM 成本汇总」节（总量 + 按模块/生成器明细）；`--dry-run` 仅做 AST 分析后停止、零 LLM 调用并产出 `Budget Preview Report`；`--budget <N>` + `--on-over-budget <policy>`（continue / cheaper-model / skip-enrichment / cancel）控制超限行为，非 TTY 须显式传 policy、二次超限默认 cancel | 127, 140 | 活跃 |
| FR-107 | `SpecStore` 作为单一权威 spec 查询入口，README / graph / coverage / index / cross-reference 五个消费方全部迁移，取代各自手动合并逻辑；每个 spec 携带 `sourceKind` 身份标识（canonical / derived / bundle_copy），扫描类分析器默认只处理 canonical；orphan spec（源文件已删）可识别并排除但不自动清理 | 128 | 活跃 |
| FR-108 | `direction-audit` 跨模块依赖边方向审计工具（支持 `--snapshot` / `--compare-snapshot`，输出方向分类与置信度报告）；`SPECTRA_DEV` 开启的 dev 模式经 `tsx --watch` 子进程重启实现源码热重载，语法错误保留上个版本，非 dev 路径不初始化 watcher | 128 | 活跃 |
| FR-109 | graph schema v2.0：新增 `references` / `conceptually_related_to` / `rationale_for` 三种语义边类型与 `EXTRACTED \| INFERRED \| AMBIGUOUS` 三态 edge confidence，`schemaVersion` 扩展为 `"1.0"\|"2.0"` 且 v2.0 新字段全为 optional 保证向后兼容 | 131 | 活跃 |
| FR-110 | 文档-代码语义边与超边：Hybrid Chunking 按 H2/H3 边界提取 <= 512 token 的 `DocChunk`，与代码节点 cosine 相似度 >= 阈值（默认 0.75，含边界）生成带 evidenceText / evidenceSource 的语义边；`EmbeddingProvider` 以 Strategy Pattern 支持 Local（默认）与 OpenAI fallback；`hyperedges` 顶层数组（每条 >= 3 节点）受 feature flag（`--hyperedges` / `SPECTRA_HYPEREDGES_ENABLED`，默认关闭）+ BudgetGate 记账控制，并由 `graph_hyperedges` MCP 工具按 label 模糊 / node_id 精确过滤查询 | 131 | 活跃 |
| FR-111 | `graph-quality` 六项指标机器化：语义重复 canonical ID（归一化三元组映射到多个 ID）须为 0、contains 覆盖率（受支持 symbol 节点）须 100%、orphan（zero-degree symbol）<= 5% 含例外分类、悬空边须为 0，外加 ignored 与 freshness；`overallVerdict` 四态（pass / pass-with-warnings / fail-strong-invariant / cannot-assess）并用 exit code 0/1/2 三档固定语义传达 | 217 | 活跃 |
| FR-112 | freshness 与门禁分级：建图时写入 `graph.sourceCommit` 并在检测时与 HEAD 比对，输出 fresh / dirty / stale / unknown-provenance 四态；`repo:check` 中重复 canonical ID 与悬空边判 error 阻断，覆盖率 / orphan / ignored / stale 判 warning 不阻断，图缺失判 skip、JSON 损坏判 warning | 217 | 活跃 |
| FR-113 | 空图与退化图 fail-loud：`graph-quality` 对 `nodes` 与 `links` 均为空数组的图新增 `empty-graph` reason 并归入既有 `cannot-assess` 通道（继承 exit 2），不再判 pass；判定结果不因图的 builder 戳与当前工具版本不一致而单独翻转（builder 戳只可见不判定） | 266 | 活跃 |
| FR-114 | 图覆写与来源守卫：`spectra graph` 写盘前对比新旧图 nodeCount/edgeCount，下降则拒绝覆写并非零退出（`--force` 为逃生口）；post-commit hook 改调 `spectra batch --mode graph-only`（超时 30s → 180s），不再让信息量更完整的图被更少的图替换；全量 batch 在模块派生环节检测到「扫描候选 > 0 但全部被过滤为 0」时给出可观测提示并引导用户指定源码范围 | 266 | 活跃 |
| FR-115 | AST 锚定的 spec 引用漂移检测（prototype）：spec/plan 中的代码引用经 `canonicalizeSymbolId`（失败回退 `resolveSymbolFuzzy`）解析为 graph canonical symbol id，并以 `ExportSymbol` span 切片 + 逐行空白归一化 + SHA-256 计算 symbol 级指纹；check 时重算比对并分类为 fresh / stale / orphaned / ambiguous / unresolved / fingerprint-unavailable / graph-unavailable，对 graph / symbol / skeletonHash 资产保持只读 | 189 | 原型（未进生产） |

### FR-GROUP-7: 分发、认证与横切关注点

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-037 | Plugin Marketplace 架构 + MCP stdio server | 009 | 活跃 |
| FR-038 | CLI 与 Plugin 共用同一套核心分析实现 | 002, 009 | 活跃 |
| FR-039 | 保持只读：仅向 `specs/`、`drift-logs/`、`_meta/` 等产物目录写入 | 001, 010, 101 | 活跃 |
| FR-040 | 使用相对路径输出，避免泄露本机目录结构 | 008, 010 | 活跃 |
| FR-041 | 批量输出包含 Markdown、JSON 与 Mermaid 文件族 | 051 | 活跃 |
| FR-042 | `plugins/spectra/skills/**` 是 Spectra Skill 的 canonical source，`src/skills-global/**` 与 `skills/**` 通过同步脚本维护 compatibility mirrors | 079 | 活跃 |
| FR-077 | `generate` / `batch` / `diff` / `watch` 零认证时默认提示后降级继续执行（`diff` 的降级形态是跳过 LLM 语义评估，仍产出完整结构漂移报告）；`--require-llm` 提供严格失败逃生口：四命令均在入口阻断，`generate` / `batch` 额外按 `GenerateSpecResult.llmDegraded` 事后校验产物是否真为 LLM 增强（`diff` / `watch` 因下游无降级痕迹仅能入口检查）。已知边界：`batch --dry-run` / `--mode graph-only` 属零 LLM 路径，该 flag 不适用；增量 cache 命中的模块记为 skipped、不参与降级判定，故该 flag 不覆盖「复用历史 AST-only 产物」场景，严格语义需配合 `--full` / `--force` | 222 | 活跃 |
| FR-116 | MCP 响应契约与遥测统一：17 个工具错误响应统一为 `{code, message, hint?, context?}` envelope（删除 `graph-tools.ts` 本地 `buildErrorResponse`、消除纯文本错误残留），`ErrorCode` union 新增 `graph-query-failed` 且既有 12 码全保留；telemetry 覆盖从 6/17 补到 17/17，按「注册层 `withTelemetry` 装饰器组」与「handler 内自采样组」严格互斥分区防双发射，每次到达 handler 的调用恰发 1 行；成功响应字段逐字节兼容 | 177 | 活跃 |
| FR-117 | MCP server 注入非空 `instructions`（写入 `ServerOptions` 而非 serverInfo，否则不进 initialize result），内容含 17 工具分组导览 + 典型调用链路 + 任务→工具映射 + graph-not-built 恢复流；server 5 工具 description 补齐 what / when / example / chained-usage 四要素，graph 6 工具补「Use when」与 chained usage；17 个工具名称不改名 | 184 | 活跃 |
| FR-118 | `view_file` 接入 `resolveSymbolFuzzy`：confidence >= 0.9 的唯一命中自动采用并在成功响应带 `warnings: ['fuzzy-resolved']`，失败时错误体携带 `context.fuzzyMatches` top-3 候选；错误 context 只回 `fuzzyResolved` 布尔，不回绝对路径 | 184 | 活跃 |
| FR-119 | 发布断层预警：`release:check` 在 HEAD 领先已发布版本且触达 `src/` 的 commit 数 N >= 5 时输出 warning 而不使 exitCode 非零，已发布 commit 事实源不可达时输出可见 indeterminate 提示（不静默跳过、不默认判「无领先」）；判据独立落在 `scripts/lib/publish-gap-check.mjs`，CI workflow 新增 repo:check（排在建图步骤之后）与 release:check 两步 | 265 | 活跃 |
| FR-120 | 版本自省与构建漂移体检：MCP 新增 `server_build_info` 工具返回结构化 `{version, commit, dirty}`（配合 `serverInfo.description` 一行可读串，规避 zod strip 自定义字段）；doctor 四方比对新增 commit 级 match / mismatch / absent / unreadable 四态枚举，commit 原串任何时刻不得进入报告正文、日志或返回体 | 265 | 活跃 |
| FR-121 | `scripts/adoption-census.mjs` 可一键重跑的 MCP 调用统计：按 17 个已知工具名聚合调用次数并输出零调用清单，实际数字口径为「发布后一周回收」而非随卡交付 | 265 | 活跃 |
| FR-122 | 产品表面一致性清扫：`graph_community` / `graph_hyperedges` 区分「图中完全无社区/超边数据」与「给定 ID 未命中」并加诊断性 message（不新增 error code）；社区 ID 示例格式改为实际产出格式；`prepare` 对 `targetPath` 做存在性校验返回 `file-not-found` 而非塌缩进 `internal-error`；`spectra index` 目标目录不存在退出码 2 → 1；`plugins/spectra/README.md` 工具表格从 4 个补全至 18 个已注册工具 | 271 | 活跃 |
| FR-123 | `impact` / `context` 的 symbol-not-found 分支先判定该文件是否在图中命中，命中则换用「图可能陈旧，建议重建图后重试」文案，且两处 hint 文案必须一致 | 278 | 活跃 |
| FR-124 | 护栏比较器新增 `compareNodeMetadataKeys` 第三比较维度：按 node id 分组比较 metadata key 集合签名 multiset（不得拍平为全图并集），并区分字段缺席（undefined）与空对象（`{}`）两种状态；边侧 metadata 不纳入 | 278 | 活跃 |
| FR-143 | agent-context 三工具 description 五项硬约束：`detect_changes` / `context` / `impact` 的 description 为 100-500 字符，含「核心功能一句话 lead-in（>= 10 字符）+ "Use this tool when"（>= 3 个 use-case）+ "Example"（input 与关键 output 示例对）+ "Typical chained usage"（>= 1 个示例）」，`impact` 的 chained 示例必含 `detect_changes → impact → context`；测试须按「工具 × 要素」独立报出不达标项，禁止整体 pass/fail 掩盖局部；升级范围严格只含这 3 个 agent-context tool，`graph-tools.ts` 中任何工具的 description 与 response 完全不在范围内且不允许例外路径 | 170c | 活跃 |
| FR-144 | agent-context 三工具 response 决策增强字段（producer 侧 MUST 总是产出、schema 侧一律声明 optional）：`impact` 出 `topImpacted`（长度 ∈ [0,5] 的 `{id, score}` 数组，score 降序）与 `nextStepHint`（>= 5 字符中文串）；`detect_changes` 出 `riskTier`（`low` \| `medium` \| `high`）+ `topImpacted` + `nextStepHint`；`context` 出 `topRelevantCallers`（长度 ∈ [0,3]，按调用频率 + 距离综合排序）+ `nextStepHint`；按 Tool × Path 字段矩阵禁止跨 tool 污染（`riskTier` 只属 `detect_changes`、`topRelevantCallers` 只属 `context`）；排名与 hint 逻辑收敛为三 handler 共享的 `buildTopImpactedRanking` / `generateNextStepHint`，受影响节点 > 100 时排名额外延迟 <= 100ms | 170c | 活跃 |
| FR-145 | MCP 响应三路径与向后兼容硬约束：success 路径按 producer 合同产出全部新字段；enrichment degraded 路径（主流程成功、ranking / hint / riskTier 计算被 try-catch 兜底）取 fallback 值（`topImpacted: []` / `nextStepHint: ""` / `riskTier: "low"` / `topRelevantCallers: []`）并附顶层 `_enrichmentDegraded: true`；handler error 路径完全不含任何新字段、与升级前逐字段一致。兼容面四项：Zod 不使用 `.strict()`、导出 JSON Schema 不使用 `additionalProperties: false`、新字段 TS 类型为 `field?: T`、既有字段 `.optional()` / `.nullable()` 标注不变；input schema 与 response 原有字段名 / 类型 / 嵌套层级一律不动 | 170c | 活跃 |
| FR-146 | Spectra MCP 采纳引导单一事实源：`plugins/spec-driver/templates/preference-rules.md` 以 anchor 注释（`<!-- preference-rules:R1 tool=impact -->` 等）承载 4 条任务→工具规则（R1 找 caller / caller analysis → `impact` direction=upstream；R2 评估改动影响 / blast radius → `impact`；R3 找 callee / 依赖什么 → `context`；R4 git diff 影响 / PR review 范围 → `detect_changes`）与「关键原则」小节（Grep 仍是 fallback / 不能省略调用 / chained 使用 / 不要 N+1）；plan / implement / verify / spec-review / quality-review 五个子代理 prompt 的规则块由同步脚本按各自 frontmatter `tools` 过滤渲染（每 agent 恰 3 行）并用 BEGIN/END marker 包裹，`--check` 漂移检测接入 `repo:check`（`preference-rules:agent-block-sync`）；引导推荐工具集 ⊆ 该 agent `tools`，文案取 SHOULD（"优先"）语气保留 Grep fallback；五个 SKILL.md 委派前置补「子代理调度时的工具优先级提示」块，`spectra-mcp-integration.md` 增「Driver 偏好引导设计」章节与 override 机制 | 170d | 活跃 |
| FR-147 | guided active-call rate 度量装置：harness 经 `--append-system-prompt` 注入引导块以忠实模拟「agent 文件 body = 子代理 system prompt」通道，namespace 与生产统一为 `mcp__plugin_spectra_spectra__*`，其余配置（5 task / forbidden literals / Active Call 4 规则 / allowedTools / Wilson CI / exit code 语义）与前一轮基线逐字一致；注入 flag 不被接受或注入块为空即 exit 2 fail-fast，report 记注入块 sha256 与 `claude --version`；三层指标 `impactAttemptRate` / `impactResolvedSuccessRate`（主指标）/ `fallbackAfterImpactFailureRate` 分别报告，另设 negative-control 模式（3 个 non-caller-analysis task）做 over-call 软门禁（调 MCP 的 run <= 1/3）；纯函数核心抽取为 `scripts/lib/driver-eval-core.mjs` 供 harness 薄 wrapper 复用 | 170d | 活跃 |

### FR-GROUP-8: 多源文档系统与交付层

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-043 | batch 自动产出项目级 panoramic 文档套件与架构叙事 | 053 | 活跃 |
| FR-044 | docs bundle、阅读路径导航与 MkDocs/TechDocs 兼容骨架 | 055 | 活跃 |
| FR-045 | `ArchitectureIR` 统一架构中间表示，支持 JSON / Mermaid / Structurizr DSL | 056 | 活跃 |
| FR-046 | `Component View` 与 `Dynamic Scenarios` 下钻到关键组件和主链路 | 057 | 活跃 |
| FR-047 | ADR 决策流水线输出 `docs/adr/*.md` 与索引 | 058 | 活跃 |
| FR-048 | quality report 扩展 provenance、required-doc、冲突检测与产品管理类文档校验 | 059 | 活跃 |
| FR-049 | 产品 / UX 事实接入，输出 `product-overview`、`user-journeys`、`feature-briefs` | 060 | 活跃 |
| FR-125 | `spectra scaffold-kb build --llms-txt\|--dir [--output] [--sdk-version]`：把厂商 SDK 文档打包成可检索知识库，产出 `doc-graph.json`（文档节点 + 引用边）与 `chunks.sqlite`（FTS5 全文检索层，chunk 关联 doc_id / anchor）；构建幂等（相同输入字节级一致，`built_at` 除外）；CJK 检索契约保证中文词 / API 符号 / 短错误码 / 中英混合不因 tokenizer 系统性零召回；运行时只用 WASM sqlite，零原生编译、不引向量数据库 | 190 | 活跃 |
| FR-126 | KB MCP 工具 `kb_search`（全文检索）与 `kb_doc_lookup`（按 doc_id / 关键词返回导航信息含 references / referenced_by）：结果包 `[KB-EVIDENCE]` envelope + token cap（单条 <= 500 / 合计 <= 2500）防注入；厂商库与项目库双层联查经跨库 bm25 归一化 + 每库候选下限保证双呈现；KB MCP server 与 `src/mcp/server.ts` 物理隔离，既有工具零回归 | 190 | 活跃 |
| FR-127 | `kb_api_lookup` 结构化 API 实体查询（按 api_name / kind / container / sdk_version，返回签名 / 参数 / 废弃标记 / 证据回溯）；实体由 `scaffold-kb build` 额外抽取写入 `api-entities.json`（默认 LLM 抽取 + 确定性 heuristic fallback）；参数校验与废弃检测为「据文档」evidence-grade，实体缺失不得编造、降级模式不得给出校验结论 | 192 | 活跃 |
| FR-128 | 冲突仲裁分两档：`kb_api_lookup` 按版本 / 时效 / 置信度加权给出推荐 + 备选（档 A），`kb_search` 仅附 `freshness_hint` 不出推荐（档 B）；仲裁策略不写死 vendor > project，各维无法判定时合法降级回双呈现 | 192 | 活跃 |
| FR-129 | `scaffold-kb ingest --url\|--file\|--minutes [--yes\|--dry-run]` 导入项目库（不得写厂商库）：URL 抓取落地 6 项 SSRF 防护（协议白名单 / 内网封锁 / DNS rebinding / 重定向限制 / 超时限流 / content-type 校验），办公文档防御 8 项攻击矩阵（zip bomb / XXE-DTD / path traversal / 外部关系引用 / PDF 炸弹 / 内嵌动作 / 联网读盘 / 超大文件）；`chunk_meta` 新增 ingest_source_type / ingest_origin / ingested_at 三列 provenance | 192 | 活跃 |
| FR-130 | 用户文档与实际行为对齐：`docs/spectra-cli-reference.md` 以 `src/cli/index.ts` 帮助文本为单一事实源，补齐 `--mode graph-only`、scaffold-kb 命令族（build / ingest / serve / query）、KB MCP 三工具、`--version` build 元数据、auth 三模式与 cache 命令；新增 `docs/scaffold-kb-guide.md` 并链接进 README 与 CLI reference，guide 内含 build / ingest / query / 接入工作流 / 端到端 worked example 五段实战示例（示例锚定真实 CLI 输出、用公开开源 SDK 不绑定具体客户） | 200, 205 | 活跃 |

### FR-GROUP-9: 深度代码反求与质量提升

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-050 | 深度代码反求：AST 骨架 + LLM 语义桥接，从代码反推规范级文档 | 095 | 活跃 |
| FR-051 | AST 直出接口定义：按子模块分组的函数/类表格（含参数和行为摘要） | 097 | 活跃 |
| FR-052 | AST 直出数据结构：提取 `@dataclass`/`TypedDict`/`interface` 字段并生成结构表格 | 097 | 活跃 |
| FR-053 | 智能目录分类与排除：自动识别测试/配置/生成文件并分类处理 | 095 | 活跃 |
| FR-131 | 技术债引擎：基于 AST（不误判字符串字面量里的 "TODO"）扫描所有已注册 `LanguageAdapter` 支持语言的债务注释，每条含 kind / 注释文本 / 路径 / 行号 / 所属函数或类 / git blame author / 年龄；并从 design-doc 识别显式标记与 LLM 辅助判断两类 open question（LLM 调用须走 budget-gate）；独立产出 `<specsDir>/project/technical-debt.md`（概要 / 代码债务明细 / open questions / 引用清单四段） | 130 | 活跃 |
| FR-132 | 技术债评分与接口扩展：`quality-report.md` 追加「## 技术债」评分节（年龄四档分桶 < 30 / 30-90 / 90-180 / > 180 天，密度口径为条 / kLOC），`specs/README.md` 质量审计节新增技术债清单链接；`LanguageAdapter` 新增可选方法 `extractComments()`（非破坏性扩展，4 个 adapter 均实现），`BatchOptions.enableDebtIntelligence` 默认 true | 130 | 活跃 |

### FR-GROUP-10: 知识图谱与持续同步

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-054 | SHA256 内容哈希缓存层：`_meta/_cache-manifest.json`、cache-hit 跳过全链路 | 100 | 活跃 |
| FR-055 | `spectra cache clear/stats` CLI 子命令 | 100 | 活跃 |
| FR-056 | 统一知识图谱持久化：`graph-builder.ts` 合并 architecture-ir / doc-graph / cross-reference-index 为 `_meta/graph.json` | 101 | 活跃 |
| FR-057 | 置信度标签系统：`EXTRACTED` / `INFERRED` / `LLM_ENRICHED` 分级标注关系可信度 | 101 | 活跃 |
| FR-058 | `spectra graph` CLI 命令独立调用图谱构建 | 101 | 活跃 |
| FR-059 | 社区检测算法（Label Propagation）识别模块聚类 | 102 | 活跃 |
| FR-060 | God Node 识别：度数远高于均值的节点报告 | 102 | 活跃 |
| FR-061 | 跨社区异常边发现（Surprising Connections） | 102 | 活跃 |
| FR-062 | `GRAPH_REPORT.md` 架构洞察报告生成 | 102 | 活跃 |
| FR-063 | Obsidian Vault 导出：`[[双向链接]]` + frontmatter + 兼容 Graph View | 103 | 活跃 |
| FR-064 | HTML 交互式可视化导出 | 103 | 活跃 |
| FR-065 | PreToolUse Hook：Claude Code 调用 Glob/Grep 前注入架构摘要 | 104 | 活跃 |
| FR-066 | Post-commit Hook：git commit 后自动触发增量图谱更新 | 104 | 活跃 |
| FR-067 | `spectra install` 统一 hook 管理命令 | 104 | 活跃 |
| FR-068 | MCP graph_query 工具：自然语言查询知识图谱 | 105 | 活跃 |
| FR-069 | MCP graph_node / graph_path 工具：精确节点详情与最短路径 | 105 | 活跃 |
| FR-070 | MCP graph_community / graph_stats 工具：社区详情与全局统计 | 105 | 活跃 |
| FR-071 | `spectra watch` 文件监听 + debounce + 增量 batch 自动触发 | 106 | 活跃 |
| FR-072 | SIGINT 优雅退出：等待当前更新完成后退出 | 106 | 活跃 |
| FR-133 | `UnifiedGraph` 统一图谱 schema（nodes / edges / metadata，edge 含 confidence / relation / directional）与 `buildUnifiedGraph()` 顶层入口，作为四语言 Knowledge Graph 的共享事实源；edge 级 `directional` 覆盖 `GraphJSON.directed` 全局开关（calls / depends-on / cross-module / contains 必须 true），邻接表按 `edge.directional` 而非全局标志判定单双向；`DependencyGraph` 维持既有接口、内部 shim 到 `UnifiedGraph`，confidence 双轨映射 high/medium/low ↔ EXTRACTED/INFERRED/AMBIGUOUS | 151 | 活跃 |
| FR-134 | 语言无关的 4 阶段 call resolver `resolveCalls()`（free → member → cross-module → MRO fallback）产出带 confidence 的 `calls` 边；`CodeSkeleton` 新增 `callSites?: CallSite[]` optional 字段向后兼容旧 spec.md；`panoramic/graph/*` 重构为消费 `UnifiedGraph.edges`；4 个 entry point 的 bootstrap 收敛到 `bootstrapRuntime()` | 151 | 活跃 |
| FR-135 | TypeScript callSites 与 import 智能解析：`TypeScriptMapper.extractCallSites` 覆盖 7 种 `CalleeKind` 中的 6 种（不产 Python 专属 dunder），`TsJsLanguageAdapter.analyzeFile` 按方案 B 双路径 merge（ts-morph 主导 exports/imports，TreeSitterAnalyzer 仅在开启时额外产 callSites）；共享无状态 `ImportResolver` 提供 `resolvePythonImport()`（package 层级 / 相对 / 祖先包）与 `resolveTsJsImport()`（相对路径 / tsconfig paths / baseUrl / 外部包识别，monorepo 多 tsconfig 由调用方按 nearest-config 选择），替换 basename map 并让 `imports[].resolvedPath` 从猜测变精确 | 152 | 活跃 |
| FR-136 | Agent context MCP 工具 `impact` / `context` / `detect_changes`：impact 接受 target / depth / minConfidence（默认 0.65）/ direction / budget，budget 截断必须在 BFS enqueue 前应用；context 返回 definition + callers + callees + imports + relatedSpec（按 include 裁剪）；detect_changes 接受 diff 或 baseRef（都给时优先 diff），`baseRef` 经白名单正则 + `git rev-parse --verify` 双重校验且 spawn 强制 `shell:false`、后续操作用解析后的 SHA；共享 `query-helpers` 提供 bfsTraverse / canonicalizeSymbolId / computeRiskTier 等函数 | 155 | 活跃 |
| FR-137 | 增量索引与 snapshot 持久化：产出 `.spectra/unified-graph.json`（`SnapshotWrapper` 含 schemaVersion / generatedAt / graph / fileHashes，经 Zod 校验），加载后按文件 SHA-256 hash 对比、未变更文件直接复用节点边不重跑 AST；重索引范围 = 变更文件 + 深度 1 的直接 reverse caller（不扩展超过深度 1）；`spectra index --watch` 与 `--incremental` 两模式互斥；TS/JS `depends-on` 边接管者为 `import-resolver.ts`，17 个 consumer 一次性切换（atomic switch）不允许新旧图模型双 API 并存 | 156 | 活跃 |
| FR-138 | 图跨 worktree 可移植：写入侧全部持久化 path-like 值生成为相对 projectRoot 的 POSIX 路径，projectRoot 外文件保留绝对路径并标 `external: true`（不产生 `../` 越界链）；加载期全量扫描检测旧绝对 id 图并返回 `graph-format-stale`；增量快照同步相对化并 bump `SNAPSHOT_WRAPPER_VERSION`（1.0 → 2.0）；bootstrap 钩子以 copy-if-absent 原子语义把图与快照置入 worktree，配 `.graph-source-commit` sidecar 记源 commit；`graph.json` 裁决为派生产物不入库 | 193 | 活跃 |
| FR-139 | canonical symbol ID 与层级 contains 边：Python `#` 与 TS/JS `::` 收敛为单一 canonical 分隔符且转换只在一个明确边界发生（不影响 API 节点）；为每种受支持语言的每个 symbol 生成 module→symbol 的 `contains` 边，有 class 的生成 module→class→member 两级（每个 member 只允许一条入边）；同一逻辑符号在 full batch 与 graph-only 两条建图路径下只产生一个节点且两路口径等价性可验证；加载期识别旧 `#` 格式归为 `legacy-id-format-stale`；`SNAPSHOT_WRAPPER_VERSION` 2.0 → 3.0，`GraphJSON.schemaVersion` 不变 | 214 | 活跃 |
| FR-140 | collector 指纹参与 freshness 判定：图 metadata 新增 `fingerprint`（formatVersion + 按 5 条采集管线分别记录 `{扩展集, 匹配语义}` 的 extensionSurface + 显式声明的 behaviorVersion，不得合并为扁平集合）；`evaluateFreshness` 按五级优先级求值且 fingerprint 判定排在 dirty 之前；fingerprint 缺失判 stale + `collector-fingerprint-unrecorded`、结构畸形判 stale + `collector-fingerprint-invalid`（fail-closed，不抛未捕获异常）；`GraphFreshnessVerdict.staleReasons` 支持多原因并存；采集面单一事实源落位为零依赖叶子模块、消费方单向引用 | 249 | 活跃 |
| FR-141 | 带溯源引用的自然语言问答：采用 Graph-first BFS → embedding 精排 Top-K → LLM 组装的混合架构，每条答案 Citation 覆盖率 100%（含 specPath / lineRange / excerpt 三字段）；BFS 命中节点数 < 3 时降级纯 RAG，仍失败须明确提示「图谱数据不足」，不返回无引用的猜测性答案；问答严格单轮无状态、不做流式输出 | 132 | 活跃 |
| FR-142 | `graph.html` 交互式可视化：力导向布局可拖动节点、可搜索、点击节点打开对应 spec 文件，完全 self-contained（零 CDN 依赖、离线可用）；节点数 >= 2000 自动切换静态坐标模式（关闭 force layout + 禁用拖动 + 启用 community 预计算坐标）并展示横幅提示；体积 > 5 MB 输出警告但不阻断生成 | 132 | 活跃 |

### FR-GROUP-11: 多模态制品提取

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-073 | OpenAPI/AsyncAPI 规范提取：解析为 `api` / `api-schema` / `event` 节点 | 107 | 活跃 |
| FR-074 | Markdown 文档提取：解析 heading 结构为 `doc-section` 节点，提取交叉引用 | 107 | 活跃 |
| FR-075 | 图像图表提取：识别架构图/流程图并以 `diagram` 节点纳入知识图谱 | 107 | 活跃 |
| FR-076 | `--include-docs` 批量标志统一控制多模态制品提取 | 107 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| AST 预处理（500 文件） | <= 10 秒 | 001 |
| 单文件上下文预算 | <= 100k token | 001 |
| 大模块失败耗时 | <= 5 分钟（含降级） | 006, 007 |
| 单语言非 TS/JS batch | 返回非空模块集合 | 052 |
| panoramic 输出 | 支持按 generator 单独执行，避免一次性生成全部文档 | 033–050 |
| 二次 batch（少量变化） | 耗时 < 30 秒，缓存命中率 > 90% | 100 |
| 文件监听响应 | 修改后 3 秒静默 + debounce，单次增量 batch | 106 |
| 无改动增量 batch | 模块级 `generateSpec` 调用次数为 0 | 175 |
| graph-only 建图 | 零 LLM 硬门禁（spec-gen / enrichment / hyperedge 调用计数 = 0）；< 2min 为记录性基准（实测 2.8s） | 195 |
| 增量索引（改 1 文件） | < 30 秒（micrograd / nanoGPT / ~250 .ts 自举仓，10 次均值） | 156 |
| batch 并发 | 默认并发 3，同时活跃 LLM 调用数始终 <= `concurrency` | 146 |
| `impact` hot-path | <= 50ms（micrograd baseline） | 155 |
| `view_file` 取片段 | 响应字节 / estimateTokens 代理值 <= 同文件全文 Read 的 50% | 171 |
| `kb_search`（百页级 KB） | P95 <= 200ms | 190 |
| 技术债扫描（~10k LOC / ~50 文件） | 含 LLM <= 30s，纯 AST 扫描 < 5s，并发上限 8 | 130 |
| MapReduce 文档流水线 | 100 文件合成 fixture、maxConcurrency=4 下 batch < 10 分钟；每个 Map call input <= 100k tokens | 140 |
| `topImpacted` 排名（>= 100 节点） | 相对无排名基准的额外延迟 <= 100ms（warmup × 3 + measurement × 10 取 median；实测中位数在 0.1ms 量级） | 170c |

### 可靠性

- batch 支持 checkpoint、skip、force 与 AST-only 保底
- 解析器或上游制品不足时回退到目录图、占位说明或低置信度标记
- doc graph 与 coverage report 为后续增量重生成提供可复用事实层
- 多格式输出保持同一份结构化数据的多视图渲染，减少格式间漂移
- 缓存 manifest 使用原子写入（write-tmp-then-rename），避免中断损坏
- `spectra watch` 支持 SIGINT 优雅退出，不留孤儿进程或损坏索引
- `graph.json` 缺失时 community / graph query 给出友好错误提示，不崩溃
- 图新鲜度判定 fail-closed：`sourceCommit` 或 collector 指纹缺失 / 畸形 / 不一致一律判 stale，绝不因「无证据」判 fresh（217, 249）
- 空图与退化图不判 pass；`spectra graph` 写盘前做信息量不减守卫，post-commit hook 不会用信息量更少的图覆盖已有好图（266）
- 单模块 LLM 失败经 try/catch 隔离且整批用 `Promise.allSettled` 收尾，不传播到调度层影响其他模块（146）
- scaffold-kb 查询与 KB 预查在未配 / 禁用 / 路径不存在 / 查询非零退出 / 零命中五类场景均 exit 0 + 空输出，不阻断上游流程（190, 200）
- 图节点合并遵循「只补缺不覆盖」：extraction 路先写入，unified 路对已存在节点只补缺失字段（250）
- 缓存 / snapshot / 指纹三层失效链彼此独立：内容 hash 复用节点边（156）、指纹变化触发存量图 stale 重建（249, 250）
- response enrichment（ranking / hint / riskTier）抛异常不污染主流程：新字段取 fallback 值并附 `_enrichmentDegraded: true`，主流程字段完整；handler error 路径则完全不含新字段，两种降级互不混淆（170c）
- agent 侧引导不阻塞研发流程：MCP 工具返回 graph-not-built / error envelope 时明示回退 Grep；引导文案取 SHOULD 语气，靠任务匹配触发而非无条件强制（170d）

### 兼容性

- Node.js LTS 20.x+
- 平台：macOS、Linux，Windows 为尽力支持
- 语言：TS/JS、Python、Go、Java 为一等支持
- 输出合同：Markdown、JSON、Mermaid `.mmd`、Obsidian Vault `.md`、HTML
- MCP：通过 stdio server 暴露 graph query 工具集
- 知识图谱格式：NetworkX 兼容 JSON；`GraphJSON.schemaVersion` 2.0（131），`SNAPSHOT_WRAPPER_VERSION` 1.0 → 2.0（193）→ 3.0（214），旧格式走 `graph-format-stale` / `legacy-id-format-stale` 安全退化而非静默误读
- MCP 工具面：18 个已注册工具；错误响应统一 `{code, message, hint?, context?}` envelope，成功响应字段逐字节兼容、新增字段一律追加式（177, 266, 271）
- 图与快照的路径域合同：持久化域 = 相对 projectRoot 的 POSIX 路径，运行时 IO / analyze 域 = 绝对路径，转换集中在明确边界（193）
- 文件导航工具目标平台仅 posix（darwin / linux），不做 Windows 路径归一化（171）
- 响应新增字段的 producer / consumer 合同不对称：producer 侧 MUST 总是产出，schema 侧一律 optional（Zod 不 `.strict()`、JSON Schema 不 `additionalProperties: false`、TS 类型为 `field?: T`），旧 lenient parser 零改动可解析；使用 strict parser 的旧客户端会报错，属预期行为而非兼容性违规（170c）

### 可用性

- 所有用户可见文档正文默认中文，代码标识符保持原文
- CLI 保留阶段进度、错误上下文和报告路径输出
- panoramic 层优先复用共享模型，避免每类文档重复解析
- 缺失信息采用 `[推断]`、`low confidence`、`[待补充]` 标记，而非静默捏造
- `spectra cache stats` 提供缓存命中率和大小统计
- MCP server 提供非空 `instructions` 工具导览（分组 + 典型链路 + 任务→工具映射 + graph-not-built 恢复流），工具 description 含 what / when / example / chained-usage（184）
- 零结果附诚实 envelope：resolution（①确认为零 / ③外部边界 / ②③合并态 coverage-gap，无法拆分时显式标 `separable:false`）、coverage、freshness、comparisonScope 四维正交呈现（266）
- symbol id 不精确（缺路径前缀 / 拼写偏差 / 绝对路径）时自动 fuzzy resolve 或回传 top-3 候选，而非直接报 symbol-not-found（174, 184）
- pipe / 非 TTY 环境输出纯文本行日志（无 `\r`、无 ANSI CSI 序列），便于 CI 与管道消费（094-06）
- response 内嵌中文 `nextStepHint` 引导下一步调用（受影响节点为 0 / 1 时也给有意义文本而非空串或 null），不做 i18n 多语言切换（170c）

---

## 7. 当前技术架构

### 技术栈

- **TypeScript 5.x / Node.js 20+**
- `ts-morph` + `web-tree-sitter`
- `p-limit`（batch 并发限流，替换手写信号量；156 之后 `dependency-cruiser` 已被移除，TS/JS `depends-on` 边改由 `import-resolver.ts` 接管）
- `handlebars`
- `zod`
- `@anthropic-ai/sdk`
- `@modelcontextprotocol/sdk`

### 项目结构

```text
cc-plugin-market/
├── plugins/
│   └── spectra/
│       ├── .claude-plugin/plugin.json
│       ├── contracts/            # spectra skill source-of-truth 合同
│       ├── skills/               # spectra canonical skill source
│       ├── hooks/
│       └── scripts/
├── src/skills-global/            # generated published compatibility mirrors
├── skills/                       # generated repo-local compatibility mirrors
├── src/
│   ├── core/                 # AST、context、LLM、tree-sitter
│   ├── adapters/             # 多语言适配器
│   ├── graph/                # 依赖图 derived view 与拓扑排序
│   ├── batch/                # batch、checkpoint、delta regeneration、cache、regen-plan
│   ├── diff/                 # structural / semantic diff
│   ├── panoramic/            # generators/pipelines/models/builders/exporters + api-surface/ + graph/quality/
│   ├── knowledge-graph/      # unified-graph、call-resolver、import-resolver、query-helpers、line-range、persistence、incremental
│   ├── spec-store/           # SpecStore 统一 spec 查询入口与 sourceKind 过滤
│   ├── debt-scanner/         # comments / design-docs / aggregator 三子域
│   ├── collector-surface.ts  # 采集面单一事实源（扩展集 + 匹配语义，零依赖叶子模块）
│   ├── auth/                 # provider / CLI proxy
│   ├── cli/                  # 命令入口
│   └── mcp/                  # MCP stdio server + graph query / agent-context / file-nav / kb tools
├── _meta/                    # graph.json、_cache-manifest.json、GRAPH_REPORT.md、graph.html
├── .spectra/                 # unified-graph.json 增量快照（派生产物，不入库）
├── kb/                       # scaffold-kb 产物：doc-graph.json、chunks.sqlite、api-entities.json
├── templates/
├── specs/
└── tests/
```

### 核心数据流

```text
源代码 / 工程制品
  → 语言适配器 / ArtifactParser
    → CodeSkeleton / ProjectContext / RuntimeModel / DocGraph
      → GeneratorRegistry 路由具体 Generator
        → generate()
          → LLM 语义增强（可选）
            → MultiFormatWriter 渲染 Markdown / JSON / Mermaid
              → coverage / delta / batch 报告
                → graph-builder 合并为 _meta/graph.json
                  → community-analysis / export / MCP query
```

### 架构要点

- 逆向规格主链路仍由 `core + batch + diff` 负责
- panoramic 主链路由 `ProjectContext + Registry + Generators + Parsers` 组成
- `044/046/049` 形成文档维护闭环：图谱 → 审计 → 增量重生
- `043/045/050` 共享运行时 / 架构中间模型，避免重复建模
- `100` 在 batch 入口注入缓存检查，命中时跳过全链路
- `101/102/103/105` 形成知识图谱闭环：持久化 → 分析 → 导出 → 查询
- `104/106` 形成持续同步闭环：hook / watch → 增量 batch → 图谱更新
- `107` 扩展图谱数据源从代码到多模态工程制品
- `151/152/153/154` 把四语言 callSites 汇入 `UnifiedGraph` 单一图事实源；`156` 用 snapshot + fileHash 做增量并淘汰 `DependencyGraph` 与 dependency-cruiser
- `193/214/249` 形成图可移植与新鲜度三段：id 相对化 → canonical ID + contains 层级 → collector 指纹参与 freshness
- `217/266` 把图质量与诚实返回做成门禁：六指标 + 空图 fail-loud + 信息量守卫 + MCP honesty envelope
- `155/171/174/184` 构成 agent 上下文面：影响面 / symbol 360° / git diff 映射 + 文件导航 + fuzzy 解析 + instructions 导览
- `190/192` 的 scaffold-kb 与 `src/mcp/server.ts` 物理隔离（零行改动），保证既有工具零回归
- `127/130/140` 共享 budget-gate 与 cost 记账：预算门 → 技术债 LLM 调用 → MapReduce Map/Reduce 分层记账
- `155/170c/170d` 构成 agent 工具采纳链：工具本体（impact / context / detect_changes）→ description 4 要素 + response 决策增强字段（共享 ranking / hint helper，Tool × Path 字段矩阵约束）→ 子代理 prompt 的「任务→工具」优先规则（单一事实源 template + `--check` 漂移守护 + `--append-system-prompt` 度量装置）

---

## 8. 设计原则与决策记录

| 原则 | 说明 | 来源 |
|------|------|------|
| AST 精确性优先 | 结构性数据必须来自 AST、解析器或显式 schema，而非 LLM 虚构 | 001, 042, 097 |
| Adapter-first | 语言差异通过 `LanguageAdapter` 隔离，不把判断散落在主流程中 | 024, 025 |
| 共享中间模型 | panoramic 文档优先复用 `ProjectContext`、Runtime Model、DocGraph | 033–050 |
| 诚实降级 | 信息不足时明确标注或降级，不以"完整"为名编造事实 | 001, 046, 048 |
| 只读与可回溯 | 不改源码；输出文档附带来源、锚点、报告或路径以便追踪 | 001, 044, 049 |
| 置信度分级 | 知识图谱中所有关系标注 `EXTRACTED` / `INFERRED` / `LLM_ENRICHED` | 101 |
| 缓存透明 | 缓存命中/未命中均有日志输出，用户可通过 `cache stats` 审查 | 100 |
| hook 可卸载 | 所有 hook 通过 `spectra install` 统一管理，不侵入用户已有 hook | 104 |
| 诚实缺席 | 数据源无对应字段时不写该字段，也不用兜底近似值填充 | 271 |
| fail-closed 新鲜度 | provenance / 指纹缺失或畸形一律判 stale，不得因「无证据」判 fresh | 217, 249 |
| 混合量不拆假值 | 成因无法从混合量中分离时显式标 `separable:false`，不产出假的独立分类 | 266 |
| 单一事实源 | 采集面扩展集与匹配语义收敛为零依赖叶子模块，消费方单向引用、禁止反向落位 | 249 |
| 追加式扩展 | MCP 返回体变更只增字段，不删除 / 不重命名 / 不改变既有字段语义 | 177, 266 |
| 零原生编译依赖 | 知识库与三方导入链路只选纯 JS / WASM 实现，避免跨平台编译分支 | 190, 192 |
| untrusted evidence 边界 | 外部文档与 KB 检索内容一律包 envelope + 非指令前导句 + 字符 / token cap | 190, 192, 205 |
| 共享而非重写 | CLI 与 MCP 共用同一 query helper / 建图函数，新入口只做 dispatch 不复制分析逻辑 | 094-07, 195, 202 |
| 只补缺不覆盖 | 多条生产路径写同一图节点时，后写方只补充缺失字段、不覆盖已有字段 | 250 |
| Producer 总出 / Schema 宽容 | 响应新字段在 producer 侧 MUST 总是产出（不得以「字段是 optional」为理由静默 omit），在 schema 侧一律 optional——严的一侧约束自己，宽的一侧兼容旧 consumer | 170c |
| 引导而非强制 | agent 侧工具偏好取 SHOULD（"优先"）语气 + 显式 fallback，靠任务匹配触发而非无条件强制；配 negative-control 软门禁防 over-call | 170d |
| 度量语义不外推 | 引导后的调用率只宣称「引导是否被遵循」（guided active-call rate），不外推为模型内在偏好改变，也不外推到未实测的载体（完整 agent body） | 170d |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 024–031 | 语言覆盖 | Rust、C++、Kotlin 等仍未进入首批一等支持 | 未解决 |
| 033–050 | 生成深度 | 某些 panoramic 生成器依赖上游 artifact 是否存在，覆盖度受项目形态影响 | 设计约束 |
| 047 | 状态推断 | 事件面中的状态附录仍是启发式推断，不是严格状态机验证 | 设计约束 |
| 051 | 语义增强 | LLM 补充说明存在时延与额度波动，需保留无 LLM 路径 | 设计约束 |
| 009 | 分发 | Plugin 自动更新和签名机制仍缺失 | 未解决 |
| 079 | 分发结构 | compatibility mirrors 仍作为历史兼容目录保留，后续仍需评估是否继续保留 | 设计约束 |
| 101 | 图谱规模 | 超大型代码库（>10k 文件）的 graph.json 可能过大，尚无分片策略 | 未解决 |
| 107 | 图像提取 | 图像图表提取依赖 LLM 多模态能力，置信度波动较大 | 设计约束 |
| 266 | 图覆盖率 | 本仓真实图 `unlinkedCallSites` 恒 > 0（122415/126411 个 call site 未成边，即 96.8%），`confirmed-zero` 在真实图上几乎不可达；成因②「解析缺口」当前不能单独产出（证据未持久化进 graph.json），`coverage.separable` 仍为 false | 设计约束 |
| 155 | 变更定位 | `detect_changes` 仅 file-level 映射，未做 hunk-level 行号定位，可能产生假阳性 affectedSymbols；`relatedSpec` 仅 module-coarse 未到 section anchor | 未解决 |
| 153 | 语言覆盖 | Go module path 解析（go.mod / GOPATH / vendor）未实现，cross-module 调用统一落 Stage 4 low fallback；Go skeleton 未接入 batch-orchestrator，生产图暂不含 Go calls 边 | 未解决 |
| 152 | 解析深度 | TS re-export 链路（`export {foo} from './x'`）未分析，`importIndex` 比真实源文件少一跳；ts-morph + tree-sitter 双路径对同一文件解析两次 | 未解决 |
| 192 | 实体精度 | API 实体为「文档自抽取」evidence-grade，非对照真实 SDK 代码 / 版本校验；heuristic fallback 抽取质量比 LLM 路径低约 20 个百分点 | 设计约束 |
| 189 | 漂移检测 | AST 锚定漂移检测仅 prototype + 决策文档、未并入生产路径；指纹只做到缩进 / 行内空白 / 空行不敏感，不承诺跨行重排 / 注释 / 字面值不敏感；symbol 重命名统一标 orphaned | 未解决 |
| 250 | 指纹盲区 | 「仅改 label 生成逻辑、不改扩展名集合」的改动不会反映到 `extensionSurface` 指纹，存在「行为变了但指纹未变」的静默覆盖盲区（W6 登记不修复） | 设计约束 |
| 265 | 发布量测 | `plugin-build` 类目的 commitComparison 恒为 absent（manifest schema 无 commit 字段）；global-cli（`spectra --version`）结构上无法感知 dirty 位 | 未解决 |
| 171 | 输入安全 | ReDoS 缓解为启发式拒绝 + 输入界限而非完整证明；文件读取以已验证 realpath 缩小 TOCTOU 窗口，残余 TOCTOU 风险为明示接受边界 | 设计约束 |
| 170c | Driver 偏好 | 仅升级 tool description 不足以改变 driver 主动调用行为：host 实测 claude-sonnet-4-6 在影响面评估任务上 0/10 调 `impact`（Wilson 95% CI [0%, 27.8%]，4 轮重测），实际用 1 Read + 6 Grep 做 caller 检索，而 MCP 注册与连接均正常（`status = connected`） | 已由 170d 引导层缓解 |
| 170c | 验收面 | SC-002（primary driver 调用率）、SC-004（chain rate）与 SC-005(e)（F162-F169 cohort C fixture 重跑）需 host shell + Spectra MCP，自动化验收面不覆盖；description 长度上限在 implement 阶段从 100-300 放宽到 100-500 | 设计约束 |
| 170d | 度量边界 | SC-002 度量的是 guided active-call rate（引导是否被遵循），不外推「driver 内在偏好被改变」，也不外推「完整 agent body 共存其它指令时仍 80%」（harness 只注入引导块，N=10）；2/10 未达成 run 全集中于「读单文件内部实现」型 task 描述 | 设计约束 |
| 170d | Fallback 验证 | SC-003（MCP 不可用时回退 Grep）inconclusive：`--simulate-graph-missing` 仅移走 `graph.json`，未确证 MCP server 真返回 `graph-not-built` error envelope，故「未观察到回退」既不能证明也不能证伪 fallback | 未解决 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 024 | 多语言 grammar 与 query mapper 需要持续维护 | 中 |
| 043/045 | 运行时模型与真实部署配置可能存在环境漂移 | 中 |
| 044/046/049 | doc graph owner mapping 规则若过粗，会影响增量命中准确性 | 中 |
| 051 | 大模块 LLM 语义增强仍需更细的 prompt 体积控制 | 中 |
| 099 | 品牌重命名后，外部文档、链接中可能仍残留 `reverse-spec` 引用 | 低 |
| 146 | SDK 层 + 应用层双重重试理论最差 9N 次 HTTP 请求放大，靠 `concurrency=3` 限流缓解而非根治；checkpoint 并发写入顺序不确定（最终态正确） | 中 |
| 131 | `doc-graph-builder.ts` 行数超阈值待拆分；`graph_community` 适配 hyperedge 列表延后 | 中 |
| 156 | 增量索引缺 60 秒 timeout 守护（caller 扩展超大时应降级 full re-index）；`computeAllFileHashes` 串行 IO 未并发化 | 中 |
| 271 | MCP 参数命名不统一（budget / limit / maxMatches 混用）需独立迁移策略；`prepare` 的 path-outside-root 根内边界与 CLI 早退分支未知 flag 校验均未收严 | 中 |
| 140 | 中等规模项目（15 模块）batch 耗时相比 v4.0.x 增加 60-120 秒，属 MapReduce 架构性权衡；narrative 的 critique LLM 存在假阳性风险 | 低 |
| 214 | self-dogfood graph-only 冷启动 +45%（4.7s vs 3.2s），阈值内但方向为劣化；micrograd / nanoGPT 的 `baseline:diff` 退出码非 0（perf 启发式口径）已归因未改 | 低 |
| 249 | 兼容性保护是单向的：只保护「新 consumer 读旧图」，版本回滚（旧 consumer 读新图）场景不受保护 | 中 |
| 128 | Dev 模式 5 秒 E2E 承诺无自动化守卫；CI regression guard 工具已就绪但未接入 workflow | 中 |
| 170d | `--strict-mcp-config` 与 `impact` 调用数 0→8 跃变仅「强相关」：两轮之间不止改了该 flag，未做「只去掉该 flag、其余不变」的受控 A/B，机制未隔离确证；待补 graph-missing preflight 探针、strict 下 MCP server 连通 smoke probe、SKILL dispatch 区段稳定锚点（替代中文标题白名单） | 中 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 目标仓库可通过静态文件与目录结构提取出足够多的工程事实 | 033–050 | 中 |
| tree-sitter grammar 与查询足以覆盖首批语言的主流代码形态 | 024–031 | 中 |
| batch 产生的模块划分能为 panoramic 生成提供稳定输入 | 005, 031, 052 | 中 |
| 上游项目允许把生成文档写入 `specs/` 和 `_meta/` | 001, 010, 101 | 低 |
| graph.json 格式足以覆盖社区检测、MCP 查询和多格式导出的数据需求 | 101, 102, 105 | 中 |
| `graph.json` 为派生产物、不入库，bootstrap copy-if-absent 足以覆盖「新 worktree 开箱可用」 | 193 | 中 |
| FTS5 全文检索（无向量 rerank）足以支撑 CJK / API 符号 / 短错误码的 recall@5 >= 0.80 | 190 | 中 |
| label-only matching 的 precision / recall 口径可代表真实 call 边质量 | 152, 153, 154 | 中 |
| self-dogfood `new Foo()`→class 图连通率现状已达 96%（F152 / F156 间接修复），无需额外 barrel / alias 解析 | 157 | 中 |
| 纯 JS / WASM 的 FTS5 与文档解析栈在 linux / windows 行为与 macOS arm64 一致（仅 macOS 实测，其余为「无分支」推断） | 190 | 中 |
| 预估模型 output ≈ 0.3 × input 的简化比率足以把 dry-run 偏差控制在 30% 以内 | 127, 145 | 中 |
| JS 单线程事件循环保证 `tokenUsage` 并发累加无竞态 | 146 | 低 |
| N=10 的 guided active-call 样本足以支撑「prompt 层引导能驱动 driver 改用 MCP」结论（point estimate 80%，Wilson 95% CI 下界 49.0%），但不足以宣称这是「默认行为」 | 170c, 170d | 中 |
| `--append-system-prompt` 注入引导块可忠实代表生产通道（agent 文件 body = 子代理 system prompt），故 block-only 实测结论可迁移到生产路径 | 170d | 中 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 大型仓库 LLM 上下文过大 | 中 | 中 | token 预算、降级、增量 regeneration、缓存 |
| 多语言依赖图误判 | 中 | 中 | 目录图兜底、适配器独立测试、低置信度标记 |
| panoramic 输出过多导致用户不知道从何读起 | 中 | 低 | workspace index、architecture overview、coverage report 作为入口 |
| 文档互链漂移 | 低 | 中 | `_doc-graph.json` + `_coverage-report.*` + delta report |
| graph.json 过大影响 MCP 查询性能 | 中 | 中 | budget 参数限制返回节点数、lazy loading |
| 文件监听在大型 monorepo 中事件风暴 | 中 | 中 | debounce + 变更文件集合去重 |
| 图与代码静默失配（源码 commit 未变但抽取逻辑 / 采集面已变） | 中 | 高 | collector 指纹 + `sourceCommit` 双维 freshness，缺失或畸形即判 stale（fail-closed） |
| 三方文档导入引入 SSRF / zip bomb / XXE / path traversal 等攻击面 | 中 | 高 | URL 6 项 SSRF 防护 + 办公文档 8 项攻击矩阵防御 + 纯 JS/WASM 依赖 + 预览→确认两步流 |
| KB / 外部文档中的注入串被当作指令执行 | 中 | 高 | `[KB-EVIDENCE]` envelope + 非指令前导句硬约束 + token / 字符 cap + defang 转义 |
| LLM 成本失控 | 中 | 中 | costBreakdown 记账 + dry-run 预估 + `--budget` 超限策略枚举（二次超限默认 cancel） |
| 增量索引 reverse caller 扩展过大导致超时 | 中 | 中 | 深度 1 硬约束；60 秒 timeout 守护降级 full re-index（移交后续 Feature） |
| 图 id 格式 / 快照版本升级导致存量图不可用 | 中 | 低 | `graph-format-stale` / `legacy-id-format-stale` 明确错误码 + 版本 bump 触发安全重建 |
| 破坏性响应字段变更影响下游断言（如 `fuzzyMatches: string[]` → 结构化） | 低 | 中 | 下游审计清单 + 同 PR 同步更新，不保留双字段并存兼容模式 |
| agent 工具虽已注册但 driver 不调用（能力空转） | 中 | 高 | description 4 要素 + response 内嵌 `nextStepHint` + 子代理侧任务→工具优先规则；guided active-call rate 定期实测（170c, 170d） |
| 引导产生 over-call（对不该用 MCP 的任务也硬调） | 低 | 中 | SHOULD 语气 + negative-control 软门禁（3 个 non-caller-analysis task 调 MCP 的 run <= 1/3，实测 0/6）（170d） |
| 引导文案在 agent 文件 / SKILL.md / harness 三处漂移 | 中 | 中 | 单一事实源 template + anchor 按 tool key 逐条比对 + `--check` 接入 `repo:check`（170d） |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| `.specs/` 默认输出目录 | 008 一度改为隐藏目录 | 010: `specs/` | 统一路径，减少文档和脚本歧义 |
| 文件级 batch 视角 | 001 初始设计偏文件粒度 | 005: 模块级聚合 | 模块级更适合大型项目理解 |
| 固定 120 秒 LLM 超时 | 早期统一超时策略 | 007: 模型感知超时 | 避免大模块频繁误杀 |
| TS/JS 专用主流程 | 001 初始只覆盖 JS/TS | 024–031: 多语言适配链路 | 产品已扩展为多语言 |
| `reverse-spec` 品牌名 | 产品初始命名 | 099: Spectra | 统一品牌，npm 包名 `spectra-cli` |
| `DependencyGraph` 模型与 `dependency-cruiser` 依赖 | 001–052 的依赖图实现（`src/models/dependency-graph.ts`、`src/graph/dependency-graph.ts`） | 156: `UnifiedGraph` | 统一为单一图事实源，17 个 consumer 一次性切换，grep 残留须为 0 |
| Python `#` 与 TS/JS `::` 双 symbol ID 格式并存 | 145 引入的 Python `#` 格式 | 214: canonical symbol ID | 消除语义重复节点；旧格式触发 `legacy-id-format-stale` 重建 |
| `getDirtySourceExtensions()` 扁平 Set 契约 | 249 之前的全局扁平扩展名集合 | 249: `DIRTY_SOURCE_SURFACES` + 逐管线谓词 | 各采集管线匹配语义不同，扁平集合会漏判（`.pyi` / `Foo.JAVA` / `foo.MJS` 曾漏报） |
| ADR pipeline 8 个 hardcoded candidate 函数与关键词匹配 | 058 早期 ADR 候选生成；narrative 的模板填充路径 | 140: `clusterDispatch` MapReduce + evidenceRef 校验 | 消除幻觉 ADR；旧 hallucinated ADR 保留文件但 frontmatter 标 superseded |
| handler 内旧版 `findFuzzyMatches` | 155 的 fuzzy 兜底 | 174: `resolveSymbolFuzzy` | `fuzzyMatches` 响应类型由 `string[]` 破坏性变更为 `Array<SymbolCandidate>`（clamp top-3），不保留双字段兼容模式 |
| Fix 124 `inferJourneyOutput` 六模板函数 | 124 的旅程「消费输出」模板填充 | 125: `deriveOutcomeFromScenario` | 改为基于 scenario.summary / evidence 的 evidence-backed 纯数据提取 |
| `graph-tools.ts` 本地 `buildErrorResponse` 与 server.ts 纯文本错误 | 177 之前分裂的错误契约 | 177: `lib/tool-response.ts` 统一 envelope | 消除错误契约分裂与遥测盲区 |
| `api-surface-generator.ts` 单体文件（2,168 行） | 042 的单文件实现 | 094-01: `src/panoramic/api-surface/` 8 子模块 | 消除项目最大单体文件，公开导出与运行时行为不变 |
| panoramic 桶文件全量导出（约 120 个符号） | 094-04 之前的 `index.ts` | 094-04: `index.ts` 15 个公共符号 + `internal.ts` | 公共 API 与内部实现分层，避免外部误用内部符号 |
| batch.ts 手写进度条与 `src/panoramic` 下无可执行语句的 catch 块 | 006 的手写进度输出（`process.stdout.write(\r[===] N/M)`）与 26 处空 catch | 094-06: progress-reporter + 分级 logger | 进度与模块日志不再交叉，静默降级按级别可见 |
| spec 消费方各自手动合并逻辑与 bundle 目录名硬编码排除 | Fix 127 `allIndexSpecs` 补丁与 Fix 128 目录名排除 workaround | 128: `SpecStore` + `sourceKind` 过滤 | 统一查询入口，泛化替代补丁；身份标识替代目录名启发式 |
| `collectPythonCodeSkeletons` 的 basename map 导入解析 | 151 的临时算法 | 152: `resolvePythonImport` | 解决同名文件（如两个 `utils.py`）相互覆盖 |
| 「Codex 不读插件包内 hooks」的推断前提 | 213 的 FR-006 前提 | 264 实测更正（详见 `specs/264-fix-codex-hooks-distribution/fix-report.md`） | Codex hooks 实际走目录约定而非 manifest 字段声明；只更正前提，不改 213 已交付结论 |
| 「手工在 README 补记 fixture 再生」的做法 | 249 期的人工记账 | 278: `regen-audit.jsonl` append-only 审计 sidecar | 机器条目与人工论证分离 |

---

## 12. 变更历史

| # | Spec ID | 类型 | 日期 | 摘要 |
|---|---------|------|------|------|
| 1 | [001-reverse-spec-v2](../../001-reverse-spec-v2/spec.md) | INITIAL | 2026-02-10 | 建立 AST + LLM 混合流水线、单模块生成、batch 与 diff 核心框架 |
| 2 | [002-cli-global-distribution](../../002-cli-global-distribution/spec.md) | FEATURE | 2026-02-12 | 引入全局 CLI 分发 |
| 3 | [003-skill-init](../../003-skill-init/spec.md) | FEATURE | 2026-02-10 | 项目级初始化与自包含 skill 架构 |
| 4 | [004-claude-sub-auth](../../004-claude-sub-auth/spec.md) | FEATURE | 2026-02-12 | 增加 Claude 订阅账号认证路径 |
| 5 | [005-batch-quality-fixes](../../005-batch-quality-fixes/spec.md) | FIX | 2026-02-14 | 修复 batch 模块聚合与生成质量问题 |
| 6 | [006-batch-progress-timeout](../../006-batch-progress-timeout/spec.md) | ENHANCEMENT | 2026-02-14 | 引入细粒度进度与超时快速失败 |
| 7 | [007-fix-batch-llm-defaults](../../007-fix-batch-llm-defaults/spec.md) | FIX | 2026-02-14 | 修复 batch 默认模型、提示词与超时 |
| 8 | [008-fix-spec-absolute-paths](../../008-fix-spec-absolute-paths/spec.md) | FIX | 2026-02-14 | 相对路径输出修复 |
| 9 | [009-plugin-marketplace](../../009-plugin-marketplace/spec.md) | REFACTOR | 2026-02-14 | 重构为 Plugin Marketplace + MCP 架构 |
| 10 | [010-fix-dotspecs-to-specs](../../010-fix-dotspecs-to-specs/spec.md) | FIX | 2026-02-15 | 统一 `.specs` 回 `specs` |
| 11 | [024-multilang-blueprint](../../024-multilang-blueprint/blueprint.md) | ENHANCEMENT | 2026-03-17 | 定义多语言支持蓝图与首批语言路线 |
| 12 | [025-multilang-adapter-layer](../../025-multilang-adapter-layer/spec.md) | REFACTOR | 2026-03-17 | 建立 LanguageAdapter 抽象层与 Registry |
| 13 | [026-multilang-prompt-parameterize](../../026-multilang-prompt-parameterize/spec.md) | ENHANCEMENT | 2026-03-17 | prompt、上下文和噪声过滤语言参数化 |
| 14 | [027-multilang-tree-sitter-backend](../../027-multilang-tree-sitter-backend/spec.md) | REFACTOR | 2026-03-17 | 引入 tree-sitter 多语言解析后端 |
| 15 | [028-python-language-adapter](../../028-python-language-adapter/spec.md) | FEATURE | 2026-03-17 | 增加 Python 适配器 |
| 16 | [029-go-language-adapter](../../029-go-language-adapter/spec.md) | FEATURE | 2026-03-17 | 增加 Go 适配器 |
| 17 | [030-java-language-adapter](../../030-java-language-adapter/spec.md) | FEATURE | 2026-03-18 | 增加 Java 适配器 |
| 18 | [031-multilang-mixed-project](../../031-multilang-mixed-project/spec.md) | FEATURE | 2026-03-18 | 支持多语言混合项目分组处理 |
| 19 | [033-panoramic-doc-blueprint](../../033-panoramic-doc-blueprint/blueprint.md) | ENHANCEMENT | 2026-03-19 | 定义 panoramic Phase 0–3 蓝图 |
| 20 | [034-doc-generator-interfaces](../../034-doc-generator-interfaces/spec.md) | FEATURE | 2026-03-19 | 定义 Generator / Parser 接口契约 |
| 21 | [035-project-context-unified](../../035-project-context-unified/spec.md) | FEATURE | 2026-03-19 | 引入统一 ProjectContext |
| 22 | [036-generator-registry](../../036-generator-registry/spec.md) | FEATURE | 2026-03-19 | 建立 GeneratorRegistry / ParserRegistry |
| 23 | [037-artifact-parsers](../../037-artifact-parsers/spec.md) | FEATURE | 2026-03-19 | 增加非代码制品解析器 |
| 24 | [038-data-model-doc](../../038-data-model-doc/spec.md) | FEATURE | 2026-03-19 | 增加数据模型文档生成 |
| 25 | [039-config-reference-generator](../../039-config-reference-generator/spec.md) | FEATURE | 2026-03-19 | 增加配置参考手册生成 |
| 26 | [040-monorepo-workspace-index](../../040-monorepo-workspace-index/spec.md) | FEATURE | 2026-03-19 | 增加 workspace 层级索引 |
| 27 | [041-cross-package-deps](../../041-cross-package-deps/spec.md) | FEATURE | 2026-03-19 | 增加跨包依赖分析 |
| 28 | [042-api-surface-reference](../../042-api-surface-reference/spec.md) | FEATURE | 2026-03-20 | 增加 API Surface Reference |
| 29 | [043-runtime-topology-ops](../../043-runtime-topology-ops/spec.md) | FEATURE | 2026-03-20 | 增加运行时拓扑与运维抽取 |
| 30 | [044-doc-graph-cross-reference-index](../../044-doc-graph-cross-reference-index/spec.md) | FEATURE | 2026-03-20 | 增加 doc graph 与交叉引用 |
| 31 | [045-architecture-overview-system-context](../../045-architecture-overview-system-context/spec.md) | FEATURE | 2026-03-20 | 增加架构概览与系统上下文视图 |
| 32 | [046-coverage-audit-missing-doc-report](../../046-coverage-audit-missing-doc-report/spec.md) | FEATURE | 2026-03-20 | 增加覆盖率审计与缺失文档报告 |
| 33 | [047-event-surface-documentation](../../047-event-surface-documentation/spec.md) | FEATURE | 2026-03-20 | 增加事件面文档 |
| 34 | [048-troubleshooting-explanation-docs](../../048-troubleshooting-explanation-docs/spec.md) | FEATURE | 2026-03-20 | 增加故障排查与 explanation 文档 |
| 35 | [049-incremental-spec-regeneration](../../049-incremental-spec-regeneration/spec.md) | FEATURE | 2026-03-20 | 增加 delta regeneration 与增量 batch |
| 36 | [050-pattern-hints-explanation](../../050-pattern-hints-explanation/spec.md) | FEATURE | 2026-03-20 | 增加架构模式提示与解释 |
| 37 | [051-semantic-enrichment-multiformat](../../051-semantic-enrichment-multiformat/spec.md) | ENHANCEMENT | 2026-03-19 | 增加 LLM 语义增强与多格式输出 |
| 38 | [052-batch-singlelang-graph](../../052-batch-singlelang-graph/spec.md) | FIX | 2026-03-20 | 修复单语言非 TS/JS batch 构图路径 |
| 39 | [053-panoramic-batch-doc-suite](../../053-panoramic-batch-doc-suite/spec.md) | FEATURE | 2026-03-20 | 让 batch 真正产出 panoramic 项目级文档套件与架构叙事 |
| 40 | [054-multi-source-doc-system-blueprint](../../054-multi-source-doc-system-blueprint/blueprint.md) | ENHANCEMENT | 2026-03-20 | 定义 055-060 多源文档系统蓝图 |
| 41 | [055-doc-bundle-publish-orchestration](../../055-doc-bundle-publish-orchestration/spec.md) | FEATURE | 2026-03-20 | 增加 docs bundle、阅读路径与 MkDocs 兼容交付层 |
| 42 | [056-architecture-ir-export](../../056-architecture-ir-export/spec.md) | FEATURE | 2026-03-20 | 增加 Architecture IR 与 Structurizr / Mermaid / JSON 导出 |
| 43 | [057-component-view-dynamic-scenarios](../../057-component-view-dynamic-scenarios/spec.md) | FEATURE | 2026-03-21 | 增加 component view 与 dynamic scenarios |
| 44 | [058-adr-decision-pipeline](../../058-adr-decision-pipeline/spec.md) | FEATURE | 2026-03-20 | 增加 ADR 决策流水线与 docs/adr 草稿索引 |
| 45 | [059-provenance-quality-gates](../../059-provenance-quality-gates/spec.md) | FEATURE | 2026-03-21 | 增加 provenance、required-doc 与 quality report |
| 46 | [060-product-ux-fact-ingestion](../../060-product-ux-fact-ingestion/spec.md) | FEATURE | 2026-03-22 | 增加 product-overview、user-journeys 与 feature briefs |
| 47 | [076-codebase-rationalization-blueprint](../../076-codebase-rationalization-blueprint/blueprint.md) | ENHANCEMENT | 2026-04-05 | 定义代码库结构与可维护性收敛路线 |
| 48 | [079-reverse-spec-skill-distribution-consolidation](../../079-reverse-spec-skill-distribution-consolidation/spec.md) | FEATURE | 2026-04-05 | 收敛 Spectra Skill 的 canonical source 与分发校验合同 |
| 49 | [080-doc-version-release-contract-unification](../../080-doc-version-release-contract-unification/spec.md) | FEATURE | 2026-04-05 | 统一 release contract 与产品事实层同步链路 |
| 50 | [095-deep-reverse-spec](../../095-deep-reverse-spec/spec.md) | FEATURE | 2026-04-11 | 深度代码反求增强：AST + LLM 语义桥接消除核心章节空壳 |
| 51 | [097-spec-quality-parity](../../097-spec-quality-parity/spec.md) | FEATURE | 2026-04-11 | Spec 质量全面超越纯 LLM：AST 直出接口定义和数据结构 |
| 52 | [099-spectra-rebrand](../../099-spectra-rebrand/spec.md) | FEATURE | 2026-04-12 | 品牌重命名 reverse-spec → Spectra，v3.0.0 |
| 53 | [100-content-hash-cache](../../100-content-hash-cache/spec.md) | FEATURE | 2026-04-12 | SHA256 内容哈希缓存层 |
| 54 | [101-graph-persistence](../../101-graph-persistence/spec.md) | FEATURE | 2026-04-12 | 统一知识图谱持久化与置信度标签 |
| 55 | [102-community-analysis](../../102-community-analysis/spec.md) | FEATURE | 2026-04-12 | 社区检测与架构洞察分析 |
| 56 | [103-multi-format-export](../../103-multi-format-export/spec.md) | FEATURE | 2026-04-12 | 多格式导出：Obsidian Vault + HTML |
| 57 | [104-pretooluse-hook](../../104-pretooluse-hook/spec.md) | FEATURE | 2026-04-12 | PreToolUse Hook 注入 + Post-commit Hook |
| 58 | [105-mcp-graph-query](../../105-mcp-graph-query/spec.md) | FEATURE | 2026-04-12 | MCP Graph Query 工具集 |
| 59 | [106-watch-incremental](../../106-watch-incremental/spec.md) | FEATURE | 2026-04-12 | 文件监听 + 自动增量同步 |
| 60 | [107-multi-modal-extraction](../../107-multi-modal-extraction/spec.md) | FEATURE | 2026-04-12 | 多模态工程制品提取 |
| 61 | [061-sdk-interface-surface](../../061-sdk-interface-surface/spec.md) | FEATURE | 2026-03-22 | 增加 interface-surface 库/SDK 接口文档，质量门按项目类型区分 required-doc |
| 62 | [094-01-api-surface-split](../../094-01-api-surface-split/spec.md) | REFACTOR | [待补充] | api-surface-generator 单体文件（2,168 行）按依赖分层拆为 8 个子模块 |
| 63 | [094-02-panoramic-dir-restructure](../../094-02-panoramic-dir-restructure/spec.md) | REFACTOR | 2026-04-06 | src/panoramic/ 根目录 45 个平铺文件按职责迁入 generators/pipelines/models/builders/exporters 5 个子目录，对外行为零变化（无新增 FR） |
| 64 | [094-03-llm-auth-generator-unification](../../094-03-llm-auth-generator-unification/spec.md) | REFACTOR | 2026-04-11 | 统一 panoramic LLM 调用门面，6 个生成模块接入 GeneratorRegistry（13→19） |
| 65 | [094-04-index-export-shrink](../../094-04-index-export-shrink/spec.md) | REFACTOR | 2026-04-11 | panoramic 导出分层：index.ts 15 个公共符号 + internal.ts |
| 66 | [094-06-progress-error-reporting](../../094-06-progress-error-reporting/spec.md) | FEATURE | 2026-04-11 | 进度条与模块日志分流 + 分级 logger，静默降级与关键解析失败可见 |
| 67 | [094-07-panoramic-spec-driver-bridge](../../094-07-panoramic-spec-driver-bridge/spec.md) | FEATURE | 2026-04-11 | 新增 panoramic CLI 子命令与 panoramic-query MCP 工具，共享同一 query helper |
| 68 | [114-fix-python-analysis-quality](../../114-fix-python-analysis-quality/spec.md) | FIX | [待补充] | 修复扁平 Python 项目分组过粗、MCP graph 工具跨目录路径失效、包管理器误判 |
| 69 | [125-product-doc-semantic](../../125-product-doc-semantic/spec.md) | FIX | 2026-04-18 | 产品文档改为 evidence-backed 生成，修正 HTML 净化误伤与 CJK 截断 |
| 70 | [127-reveal-cost-transparency](../../127-reveal-cost-transparency/spec.md) | FEATURE | 2026-04-19 | 入口文档首屏图摘要 + LLM 成本记录 / 预估 / 预算控制 |
| 71 | [128-harden-spec-store](../../128-harden-spec-store/spec.md) | REFACTOR | 2026-04-19 | SpecStore 统一 spec 查询入口 + sourceKind 身份标识 + dev 模式热重载 |
| 72 | [130-debt-intelligence](../../130-debt-intelligence/spec.md) | FEATURE | [待补充] | 技术债引擎：从 TODO/FIXME 与 design-doc open questions 提炼债务清单与评分 |
| 73 | [131-anchor-hyperedges-schema](../../131-anchor-hyperedges-schema/spec.md) | FEATURE | 2026-04-19 | graph schema v2.0：文档-代码语义边、confidence 三态与 hyperedges |
| 74 | [132-reading-ux](../../132-reading-ux/spec.md) | FEATURE | 2026-04-20 | 轻量批处理模式、带 Citation 的自然语言问答与交互式 graph.html |
| 75 | [140-spectra-doc-pipeline-quality](../../140-spectra-doc-pipeline-quality/spec.md) | REFACTOR | 2026-04-28 | ADR / 架构叙事 / hyperedges 走 MapReduce 重构，消除幻觉产物并让 token 消耗可观测 |
| 76 | [145-spectra-python-ast-patch](../../145-spectra-python-ast-patch/spec.md) | FIX | 2026-04-29 | Python 函数/类级图节点默认生成，修复 hyperedge 首跑失效与 dry-run 预估偏差 |
| 77 | [146-llm-concurrency-optimizer](../../146-llm-concurrency-optimizer/spec.md) | FEATURE | 2026-04-29 | batch 多模块并发 LLM 调用（p-limit，默认并发 3，`--concurrency=N` 可调） |
| 78 | [151-knowledge-graph-python](../../151-knowledge-graph-python/spec.md) | FEATURE | 2026-05-06 | UnifiedGraph 统一 schema 与语言无关 4 阶段 call resolver，Python calls 边进图 |
| 79 | [152-ts-callsites-import-resolver](../../152-ts-callsites-import-resolver/spec.md) | FEATURE | 2026-05-08 | TypeScript callSites 抽取 + Python/TS 共享 import 路径智能解析 |
| 80 | [153-go-callsites-language-adapter](../../153-go-callsites-language-adapter/spec.md) | FEATURE | 2026-05-08 | Go callSites 抽取与可复现的精度 / 召回验收证据 |
| 81 | [154-java-callsites](../../154-java-callsites/spec.md) | FEATURE | 2026-05-08 | Java callSites 抽取（method_invocation / 构造器 / super / lambda） |
| 82 | [155-agent-context-mcp-tools](../../155-agent-context-mcp-tools/spec.md) | FEATURE | 2026-05-08 | 新增 impact / context / detect_changes 三个 agent context MCP 工具 |
| 83 | [156-incremental-indexing-depgraph-shim](../../156-incremental-indexing-depgraph-shim/spec.md) | FEATURE | 2026-05-08 | 增量索引与 `spectra index` 命令；DependencyGraph 与 dependency-cruiser 完全退役 |
| 84 | [157-fix-self-dogfood](../../157-fix-self-dogfood/spec.md) | FIX | 2026-05-09 | 图连通率调研判定现状已达标（96%），Closed-NotImplemented 零代码改动 |
| 85 | [170c-mcp-tool-description-response](../../170c-mcp-tool-description-response/spec.md) | FEATURE | 2026-05-28 | 三个 agent context MCP 工具 description 补齐 4 要素，response 新增排名与下一步建议字段 |
| 86 | [170d-driver-preference-shaping](../../170d-driver-preference-shaping/spec.md) | FEATURE | [待补充] | 为 5 个子代理注入「任务→Spectra MCP 工具」优先规则，让 driver 主动调 impact 而非默认 Grep |
| 87 | [171-file-navigation-mcp-tools](../../171-file-navigation-mcp-tools/spec.md) | FEATURE | 2026-06-06 | 新增 view_file / search_in_file / list_directory 文件导航工具与路径安全判定 |
| 88 | [174-symbol-id-fuzzy-match](../../174-symbol-id-fuzzy-match/spec.md) | FEATURE | 2026-06-06 | symbol id 四层 fuzzy 解析与唯一高置信候选自动 resolve |
| 89 | [175-batch-incremental-wrapper](../../175-batch-incremental-wrapper/spec.md) | FEATURE | 2026-06-06 | batch 默认增量路径 + 产物字节稳定，保留 `--full` / `--force` 全量逃生口 |
| 90 | [177-unify-mcp-response-telemetry](../../177-unify-mcp-response-telemetry/spec.md) | REFACTOR | [待补充] | 17 个 MCP 工具错误 envelope 统一，telemetry 覆盖从 6/17 补到 17/17 |
| 91 | [184-mcp-adoption-engineering](../../184-mcp-adoption-engineering/spec.md) | FEATURE | 2026-06-13 | MCP server instructions 导览、工具 description 四要素与 view_file fuzzy 解析 |
| 92 | [189-ast-anchored-spec-drift-detection](../../189-ast-anchored-spec-drift-detection/spec.md) | FEATURE | 2026-06-13 | AST 锚定 spec 引用漂移检测 prototype 与路线选型决策文档（本期不进生产） |
| 93 | [190-scaffold-kb-mvp](../../190-scaffold-kb-mvp/spec.md) | FEATURE | 2026-06-14 | scaffold-kb 知识库构建 CLI 与 kb_search / kb_doc_lookup 两个 KB MCP 工具 |
| 94 | [192-scaffold-kb-entity-and-ingest](../../192-scaffold-kb-entity-and-ingest/spec.md) | FEATURE | [待补充] | KB API 实体层、三方异构导入（URL / office / 会议纪要）与冲突仲裁升级 |
| 95 | [193-worktree-graph-bootstrap-freshness](../../193-worktree-graph-bootstrap-freshness/spec.md) | FEATURE | 2026-06-13 | 图 id 相对化与 bootstrap copy-if-absent，图跨 worktree byte 一致 |
| 96 | [195-graph-only-zero-llm-build](../../195-graph-only-zero-llm-build/spec.md) | FEATURE | 2026-06-13 | 新增 `batch --mode graph-only` 纯 AST 零 LLM 建图入口（实测 2.8s） |
| 97 | [200-m8-doc-closeout](../../200-m8-doc-closeout/spec.md) | STORY | [待补充] | M8 用户文档收口：CLI reference、scaffold-kb 指南与主线焦点对齐 |
| 98 | [202-mcp-batch-graph-only-pilot](../../202-mcp-batch-graph-only-pilot/spec.md) | FEATURE | 2026-06-20 | MCP batch 工具 mode 枚举新增 graph-only |
| 99 | [205-scaffold-kb-examples-guide](../../205-scaffold-kb-examples-guide/spec.md) | STORY | [待补充] | 扩充 scaffold-kb guide 实战示例与端到端 worked example |
| 100 | [214-graph-topology-canonical-id](../../214-graph-topology-canonical-id/spec.md) | FIX | 2026-07-20 | 统一 canonical symbol ID 并补齐 module→symbol / class→member contains 边 |
| 101 | [217-graph-quality-gates](../../217-graph-quality-gates/spec.md) | FEATURE | 2026-07-20 | 新增 `graph-quality` CLI 六项图质量指标并接入 `repo:check` |
| 102 | [221-fix-specgen-reexport-whitespace](../../221-fix-specgen-reexport-whitespace/spec.md) | FIX | 2026-07-22 | 修复 re-export 符号静默丢失与生成文本尾随空格 |
| 103 | [249-graph-collector-fingerprint](../../249-graph-collector-fingerprint/spec.md) | FEATURE | 2026-08-03 | 图产物新增 collector 指纹，检出「源码未变但采集面已变」的静默陈旧图 |
| 104 | [250-pyi-symbol-surface](../../250-pyi-symbol-surface/spec.md) | FEATURE | 2026-08-03 | `.pyi` 类型 stub 纳入 Python 符号采集面并加 import 解析 / label 两道护栏 |
| 105 | [265-ship-cli-release-gate0](../../265-ship-cli-release-gate0/spec.md) | FEATURE | 2026-08-24 | 发布断层预警、CI 治理链接入、doctor commit 比对与 server_build_info 自省 |
| 106 | [266-honest-graph-quality-gate](../../266-honest-graph-quality-gate/spec.md) | FIX | 2026-08-24 | 空图 fail-loud、信息量守卫与三个 MCP 工具零结果成因区分 |
| 107 | [271-product-surface-sweep](../../271-product-surface-sweep/spec.md) | FIX | 2026-08-31 | lineRange 死功能修活与多处文档 / 工具 / 退出码失真收口 |
| 108 | [278-honest-tooling-patches](../../278-honest-tooling-patches/spec.md) | FIX | 2026-09-01 | impact/context 误导提示修正、护栏 metadata-key 维度与 `--init` 审计记录 |

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **CodeSkeleton** | 代码结构中间表示，承载导出符号、依赖、语言与骨架信息 |
| **LanguageAdapter** | 某一语言的分析、依赖图、测试模式与兜底策略实现 |
| **ProjectContext** | panoramic 统一上下文，聚合仓库、语言、workspace、配置与 spec 状态 |
| **DocumentGenerator** | 基于共享输入生成某类文档的统一接口 |
| **ArtifactParser** | 负责把非代码制品转换为结构化输入的解析器接口 |
| **DocGraph** | 模块、源码、spec 与引用关系构成的图谱事实层 |
| **Coverage Audit** | 基于 DocGraph 输出的文档完整性报告 |
| **Delta Regeneration** | 基于影响范围只重生成受变更影响文档的 batch 模式 |
| **Runtime Model** | 从 Dockerfile / Compose / env 抽取出的共享运行时拓扑模型 |
| **Pattern Hint** | 对潜在架构模式的提示、置信度与证据链说明 |
| **Knowledge Graph** | `_meta/graph.json` 中的统一知识图谱，合并 architecture-ir / doc-graph / cross-reference-index |
| **置信度标签** | `EXTRACTED` / `INFERRED` / `LLM_ENRICHED`，标注图谱关系的可信度等级 |
| **Community** | 知识图谱中通过 Label Propagation 算法识别的模块聚类 |
| **God Node** | 度数远高于均值的图谱节点，通常是架构热点或潜在的代码 smell |
| **Cache Manifest** | `_meta/_cache-manifest.json`，记录文件 SHA256 哈希与缓存状态 |
| **UnifiedGraph** | 统一图谱 schema（nodes / edges / metadata），四语言 Knowledge Graph 能力的共享数据结构（151） |
| **CallSite** | 一次函数/方法调用的结构化记录 `{calleeName, calleeKind, line, column?, callerContext?, calleeQualifier?}`（151, 154） |
| **call-resolver** | 语言无关的 4 阶段调用解析器（free → member → cross-module → MRO fallback），产出带 confidence 的 calls 边（151） |
| **directional** | `UnifiedEdge` 的边级方向性标志，覆盖 `GraphJSON.directed` 全局开关（151） |
| **ImportResolver / ResolveResult** | Python/TS 共享的 import 路径解析模块，及其输出 `{resolvedPath, kind}`（152） |
| **nearest-config** | monorepo 多 tsconfig 场景下按 callerFile 向上逐级查找最近 tsconfig 的选择规则（152） |
| **canonical symbol ID** | 统一符号标识格式，替代 Python `#` 与 TS/JS `::` 并存局面（214） |
| **contains 边** | 表达 module→symbol / class→member 层级关系的结构性图边，不计入耦合度统计（214） |
| **SnapshotWrapper** | 包裹 UnifiedGraph 的持久化专用结构，含 schemaVersion / generatedAt / graph / fileHashes（156） |
| **id 相对化 / external 节点** | 图 id 路径部分相对 projectRoot 的 POSIX 化；projectRoot 外文件保留绝对路径并标 `external: true`（193） |
| **copy-if-absent** | bootstrap 只在 worktree 无图时才 copy，不覆盖已有的本地增量图（193） |
| **CollectorFingerprint** | 图 metadata 字段，含 formatVersion + 逐管线 extensionSurface + behaviorVersion 三分量（249） |
| **staleReasons** | `GraphFreshnessVerdict` 的 stale 原因判别数组，可多原因并存（249） |
| **采集面单一事实源** | 按管线记录 `{扩展集, 匹配语义}` 的零依赖叶子模块，消费方单向引用（249） |
| **graph.sourceCommit** | 建图时写入的当前 HEAD commit SHA（或 null），用于内容新鲜度比对（217） |
| **freshness 四态** | `fresh` / `dirty` / `stale` / `unknown-provenance`（217） |
| **overallVerdict 四态** | `pass` / `pass-with-warnings` / `fail-strong-invariant` / `cannot-assess`（217） |
| **强不变量 vs 非强指标** | 重复 canonical ID 与悬空边为强不变量（error 阻断）；覆盖率 / orphan / ignored / stale 为非强指标（warning 不阻断）（217） |
| **graph-format-stale / legacy-id-format-stale** | 加载期检测到旧绝对 id 图 / 旧 `#` 格式 symbol 节点时返回的明确重建分类（193, 214） |
| **Resolution Reason** | 描述查询「零结果」真因的互斥分类：①确认为零 / ③外部边界 / ②③合并态 coverage-gap（266） |
| **separable: false** | 成因无法从混合量中拆分时的诚实降级标注，不产出假的独立分类（266） |
| **信息量守卫** | `spectra graph` 写盘前对比新旧图 nodeCount / edgeCount，下降则拒绝覆写并非零退出（266） |
| **graph-only mode / buildAstGraphOnly** | `spectra batch --mode graph-only` 纯 AST 零 LLM 建图入口，及其独立建图函数（195） |
| **RegenPlan** | `{incremental, full, source}` 统一 regen 决策结果，由 `resolveRegenPlan` 产出（175） |
| **byte-stable** | 全量与增量产物归一化后字节 / deepEqual 一致的验收口径（175） |
| **BatchMode** | 控制 batch 流水线执行范围的枚举（full / reading / code-only）；MCP 侧另有 graph-only 分支（132, 202） |
| **ProgressMode / Logger** | 进度输出模式（tty / pipe）与受 `REVERSE_SPEC_LOG_LEVEL` 控制的分级日志工具（094-06） |
| **文件级分组** | 目录级分组退化时的兜底策略，每个源文件作为独立 `ModuleGroup`（114） |
| **SymbolCandidate / MatchKind** | fuzzy 候选 `{id, confidence, matchKind}` 与其匹配类型枚举（exact / path-suffix / partial-name / levenshtein）（174, 184） |
| **FileSlice / SafePathResult** | `view_file` 的核心返回结构，与 `resolveSafePath` 的输出（合法路径或越界信号）（171） |
| **lineRange / span 并集** | symbol 节点 metadata 的行区间字段 `{start, end}`，与同名符号碰撞时的行区间合并策略（271） |
| **诚实缺席** | 数据源无对应字段时不写该字段、不用兜底近似值填充的设计原则（271） |
| **withTelemetry / 装饰器组 vs 自采样组** | 注册层 telemetry 装饰器，及 17 工具按发射点二分的两组（177） |
| **TOOL_GUIDE** | MCP `instructions` 字段内容大纲：工具分组导览 + 典型调用链路 + 任务→工具映射（184） |
| **SpecStore / sourceKind / Orphan Spec** | 统一 spec 查询入口、spec 身份标识（canonical / derived / bundle_copy）、源文件已删但产物仍在的 spec（128） |
| **Direction Audit Report** | 依赖方向自查产出的结构化报告，含方向分类与置信度（128） |
| **SemanticEdge / DocChunk / Hyperedge** | doc-section↔代码节点的有向语义边、≤512 token 的文档块、连接 ≥3 个节点的语义单元（131） |
| **EmbeddingProvider** | 文本转向量的提供者接口，含 Local（默认）与 OpenAI fallback 两种实现（131） |
| **Citation / GraphContext** | 溯源引用单元 `{specPath, lineRange, excerpt}`，与问答混合架构的中间态（BFS 候选 + 精排 chunk + hyperedge 关联）（132） |
| **Cost Metadata / costBreakdown** | 每个 LLM 产物携带的成本记录（token / 耗时 / model / 降级原因），与 module spec frontmatter 的 token 消耗分解字段（127, 140） |
| **Cluster Orchestrator / clusterDispatch** | 聚类 → 并发 Map → Reduce 三阶段统一调度层，ADR / narrative / hyperedges 三生成器共用（140） |
| **3-pass critique** | 架构叙事生成的 synthesize → critique → refine 三阶段质检循环（140） |
| **DebtEntry / OpenQuestionEntry / 技术债密度** | 代码注释债务条目、设计文档开放问题条目，与条 / kLOC 的量化口径（130） |
| **chunks.sqlite / doc-graph.json** | 知识库的 FTS5 全文检索层，与文档节点 + 引用边的结构化产物（190） |
| **KB-EVIDENCE envelope / defang** | 包裹检索内容的定界标记（防注入串被当作指令执行），与字符串字段的统一转义处理（190, 192, 205） |
| **双呈现（dual-layer）** | 厂商库与项目库内容冲突时两条结果并列返回、不自动仲裁，用 `source_kind` 区分来源（190, 205） |
| **api-entities.json / evidence-grade** | 文档自抽取的 API 实体产物（签名 / 参数 / 废弃 / confidence / extraction_method），与标注其「据文档」而非代码级保证的诚实边界用语（192） |
| **仲裁档 A / 档 B** | `kb_api_lookup` 完整加权仲裁 vs `kb_search` 仅附 `freshness_hint` 两种冲突处理粒度（192） |
| **interface-surface** | 面向库 / SDK 公开接口的项目级文档（Markdown + JSON），聚合公开模块、关键类型与方法（061） |
| **llm-facade / LLMCallOptions** | panoramic 统一 LLM 调用入口，及其可选参数接口（systemPrompt / maxTokens / timeout / temperature）（094-03） |
| **Thin Facade** | 直接调用现有 Generator、不引入新依赖的桥接模式；CLI 与 MCP 共用同一 query helper（094-07） |
| **re-export / reExportFrom / isTypeOnly** | 转发型导出符号的 `ExportKind` 值，及记录来源 module specifier 与 `export type {}` 形态的两个字段（221） |
| **AST-only 降级** | 零 LLM 认证场景下 spec 生成器退化为纯 AST 确定性内容的路径（221, 222） |
| **双路 Python 符号生产模型 / sourceTag** | extraction 路与 unified-graph 路并存生产符号节点，及标记写入方的 metadata 字段（250） |
| **只补缺不覆盖** | 图节点合并语义：extraction 路先写入，unified 路对已存在节点只补充缺失字段（250） |
| **AST-anchored drift detection / 锚（Anchor）** | 把 spec/plan 代码引用锚定到 canonical symbol id + 内容指纹的机制，及持久化的绑定记录（189） |
| **ReleaseGapWarning / McpSelfIntrospection** | `release:check` 的发布断层预警载荷字段，与 MCP 对外暴露的 `{version, commit, dirty}` 自省结构（265） |
| **DoctorCommitComparison** | doctor 四方比对新增的 commit 级枚举（match / mismatch / absent / unreadable）（265） |
| **compareNodeMetadataKeys / regen-audit.jsonl** | 按 node id 分组比较 metadata key 集合的护栏比较维度，与 `--init` 冷启动路径的 append-only 审计 sidecar（278） |
| **fail-loud** | 基线或事实源不可读时非零退出 / 明确错误态，而非静默降级（278） |
| **topImpacted / topRelevantCallers** | `impact`·`detect_changes` response 的受影响节点排名数组（<= 5 项 `{id, score}`，score = 1/depth 降序，同分按 confidence → id 字母序兜底），与 `context` response 的关键调用方排名数组（<= 3 项，按调用频率 + 距离综合排序）（170c） |
| **nextStepHint** | 内嵌 response 的中文下一步引导串（success 路径 >= 5 字符，enrichment degraded 为空串但字段不缺失）（170c） |
| **riskTier** | `detect_changes` response 的改动风险枚举（low / medium / high），enrichment 失败 fallback 为 low（170c） |
| **_enrichmentDegraded** | 主流程成功但 ranking / hint / riskTier 计算被 try-catch 兜底时置 true 的顶层 optional flag，用于与 handler error 路径区分（170c） |
| **Tool × Path 字段矩阵** | 规定每个工具在 success / enrichment degraded / handler error 三路径下各应产出的字段集合，禁止跨 tool 字段污染（170c） |
| **guided active-call rate** | 引导经 system prompt 投递后 driver 主动合规调用 `impact` 的 run 占比（= `impactResolvedSuccessRate`），区别于无引导的 spontaneous preference（170d） |
| **preference-rules template / anchor** | `plugins/spec-driver/templates/preference-rules.md` 中以 `<!-- preference-rules:R1 tool=impact -->` 标记的 4 条任务→工具规则单一事实源，被 agent 文件 / SKILL.md / harness 三处共用（170d） |
| **三层指标 / negative control** | `impactAttemptRate` / `impactResolvedSuccessRate` / `fallbackAfterImpactFailureRate` 三层度量，与 non-caller-analysis 任务上的 over-call 软门禁（调 MCP 的 run <= 1/3）（170d） |
| **验收状态四级** | `static-pass` / `host-pending` / `primary-pass` / `primary-fail`(degraded)——hard gate 静态全过不等于 feature full PASS（170d） |

---

## 14. 附录：增量 spec 索引

| # | Spec ID | 类型 | 文件路径 |
|---|---------|------|---------|
| 1 | 001-reverse-spec-v2 | INITIAL | [specs/001-reverse-spec-v2/spec.md](../../001-reverse-spec-v2/spec.md) |
| 2 | 002-cli-global-distribution | FEATURE | [specs/002-cli-global-distribution/spec.md](../../002-cli-global-distribution/spec.md) |
| 3 | 003-skill-init | FEATURE | [specs/003-skill-init/spec.md](../../003-skill-init/spec.md) |
| 4 | 004-claude-sub-auth | FEATURE | [specs/004-claude-sub-auth/spec.md](../../004-claude-sub-auth/spec.md) |
| 5 | 005-batch-quality-fixes | FIX | [specs/005-batch-quality-fixes/spec.md](../../005-batch-quality-fixes/spec.md) |
| 6 | 006-batch-progress-timeout | ENHANCEMENT | [specs/006-batch-progress-timeout/spec.md](../../006-batch-progress-timeout/spec.md) |
| 7 | 007-fix-batch-llm-defaults | FIX | [specs/007-fix-batch-llm-defaults/spec.md](../../007-fix-batch-llm-defaults/spec.md) |
| 8 | 008-fix-spec-absolute-paths | FIX | [specs/008-fix-spec-absolute-paths/spec.md](../../008-fix-spec-absolute-paths/spec.md) |
| 9 | 009-plugin-marketplace | REFACTOR | [specs/009-plugin-marketplace/spec.md](../../009-plugin-marketplace/spec.md) |
| 10 | 010-fix-dotspecs-to-specs | FIX | [specs/010-fix-dotspecs-to-specs/spec.md](../../010-fix-dotspecs-to-specs/spec.md) |
| 11 | 024-multilang-blueprint | ENHANCEMENT | [specs/024-multilang-blueprint/blueprint.md](../../024-multilang-blueprint/blueprint.md) |
| 12 | 025-multilang-adapter-layer | REFACTOR | [specs/025-multilang-adapter-layer/spec.md](../../025-multilang-adapter-layer/spec.md) |
| 13 | 026-multilang-prompt-parameterize | ENHANCEMENT | [specs/026-multilang-prompt-parameterize/spec.md](../../026-multilang-prompt-parameterize/spec.md) |
| 14 | 027-multilang-tree-sitter-backend | REFACTOR | [specs/027-multilang-tree-sitter-backend/spec.md](../../027-multilang-tree-sitter-backend/spec.md) |
| 15 | 028-python-language-adapter | FEATURE | [specs/028-python-language-adapter/spec.md](../../028-python-language-adapter/spec.md) |
| 16 | 029-go-language-adapter | FEATURE | [specs/029-go-language-adapter/spec.md](../../029-go-language-adapter/spec.md) |
| 17 | 030-java-language-adapter | FEATURE | [specs/030-java-language-adapter/spec.md](../../030-java-language-adapter/spec.md) |
| 18 | 031-multilang-mixed-project | FEATURE | [specs/031-multilang-mixed-project/spec.md](../../031-multilang-mixed-project/spec.md) |
| 19 | 033-panoramic-doc-blueprint | ENHANCEMENT | [specs/033-panoramic-doc-blueprint/blueprint.md](../../033-panoramic-doc-blueprint/blueprint.md) |
| 20 | 034-doc-generator-interfaces | FEATURE | [specs/034-doc-generator-interfaces/spec.md](../../034-doc-generator-interfaces/spec.md) |
| 21 | 035-project-context-unified | FEATURE | [specs/035-project-context-unified/spec.md](../../035-project-context-unified/spec.md) |
| 22 | 036-generator-registry | FEATURE | [specs/036-generator-registry/spec.md](../../036-generator-registry/spec.md) |
| 23 | 037-artifact-parsers | FEATURE | [specs/037-artifact-parsers/spec.md](../../037-artifact-parsers/spec.md) |
| 24 | 038-data-model-doc | FEATURE | [specs/038-data-model-doc/spec.md](../../038-data-model-doc/spec.md) |
| 25 | 039-config-reference-generator | FEATURE | [specs/039-config-reference-generator/spec.md](../../039-config-reference-generator/spec.md) |
| 26 | 040-monorepo-workspace-index | FEATURE | [specs/040-monorepo-workspace-index/spec.md](../../040-monorepo-workspace-index/spec.md) |
| 27 | 041-cross-package-deps | FEATURE | [specs/041-cross-package-deps/spec.md](../../041-cross-package-deps/spec.md) |
| 28 | 042-api-surface-reference | FEATURE | [specs/042-api-surface-reference/spec.md](../../042-api-surface-reference/spec.md) |
| 29 | 043-runtime-topology-ops | FEATURE | [specs/043-runtime-topology-ops/spec.md](../../043-runtime-topology-ops/spec.md) |
| 30 | 044-doc-graph-cross-reference-index | FEATURE | [specs/044-doc-graph-cross-reference-index/spec.md](../../044-doc-graph-cross-reference-index/spec.md) |
| 31 | 045-architecture-overview-system-context | FEATURE | [specs/045-architecture-overview-system-context/spec.md](../../045-architecture-overview-system-context/spec.md) |
| 32 | 046-coverage-audit-missing-doc-report | FEATURE | [specs/046-coverage-audit-missing-doc-report/spec.md](../../046-coverage-audit-missing-doc-report/spec.md) |
| 33 | 047-event-surface-documentation | FEATURE | [specs/047-event-surface-documentation/spec.md](../../047-event-surface-documentation/spec.md) |
| 34 | 048-troubleshooting-explanation-docs | FEATURE | [specs/048-troubleshooting-explanation-docs/spec.md](../../048-troubleshooting-explanation-docs/spec.md) |
| 35 | 049-incremental-spec-regeneration | FEATURE | [specs/049-incremental-spec-regeneration/spec.md](../../049-incremental-spec-regeneration/spec.md) |
| 36 | 050-pattern-hints-explanation | FEATURE | [specs/050-pattern-hints-explanation/spec.md](../../050-pattern-hints-explanation/spec.md) |
| 37 | 051-semantic-enrichment-multiformat | ENHANCEMENT | [specs/051-semantic-enrichment-multiformat/spec.md](../../051-semantic-enrichment-multiformat/spec.md) |
| 38 | 052-batch-singlelang-graph | FIX | [specs/052-batch-singlelang-graph/spec.md](../../052-batch-singlelang-graph/spec.md) |
| 39 | 053-panoramic-batch-doc-suite | FEATURE | [specs/053-panoramic-batch-doc-suite/spec.md](../../053-panoramic-batch-doc-suite/spec.md) |
| 40 | 054-multi-source-doc-system-blueprint | ENHANCEMENT | [specs/054-multi-source-doc-system-blueprint/blueprint.md](../../054-multi-source-doc-system-blueprint/blueprint.md) |
| 41 | 055-doc-bundle-publish-orchestration | FEATURE | [specs/055-doc-bundle-publish-orchestration/spec.md](../../055-doc-bundle-publish-orchestration/spec.md) |
| 42 | 056-architecture-ir-export | FEATURE | [specs/056-architecture-ir-export/spec.md](../../056-architecture-ir-export/spec.md) |
| 43 | 057-component-view-dynamic-scenarios | FEATURE | [specs/057-component-view-dynamic-scenarios/spec.md](../../057-component-view-dynamic-scenarios/spec.md) |
| 44 | 058-adr-decision-pipeline | FEATURE | [specs/058-adr-decision-pipeline/spec.md](../../058-adr-decision-pipeline/spec.md) |
| 45 | 059-provenance-quality-gates | FEATURE | [specs/059-provenance-quality-gates/spec.md](../../059-provenance-quality-gates/spec.md) |
| 46 | 060-product-ux-fact-ingestion | FEATURE | [specs/060-product-ux-fact-ingestion/spec.md](../../060-product-ux-fact-ingestion/spec.md) |
| 47 | 076-codebase-rationalization-blueprint | ENHANCEMENT | [specs/076-codebase-rationalization-blueprint/blueprint.md](../../076-codebase-rationalization-blueprint/blueprint.md) |
| 48 | 079-reverse-spec-skill-distribution-consolidation | FEATURE | [specs/079-reverse-spec-skill-distribution-consolidation/spec.md](../../079-reverse-spec-skill-distribution-consolidation/spec.md) |
| 49 | 080-doc-version-release-contract-unification | FEATURE | [specs/080-doc-version-release-contract-unification/spec.md](../../080-doc-version-release-contract-unification/spec.md) |
| 50 | 095-deep-reverse-spec | FEATURE | [specs/095-deep-reverse-spec/spec.md](../../095-deep-reverse-spec/spec.md) |
| 51 | 097-spec-quality-parity | FEATURE | [specs/097-spec-quality-parity/spec.md](../../097-spec-quality-parity/spec.md) |
| 52 | 099-spectra-rebrand | FEATURE | [specs/099-spectra-rebrand/spec.md](../../099-spectra-rebrand/spec.md) |
| 53 | 100-content-hash-cache | FEATURE | [specs/100-content-hash-cache/spec.md](../../100-content-hash-cache/spec.md) |
| 54 | 101-graph-persistence | FEATURE | [specs/101-graph-persistence/spec.md](../../101-graph-persistence/spec.md) |
| 55 | 102-community-analysis | FEATURE | [specs/102-community-analysis/spec.md](../../102-community-analysis/spec.md) |
| 56 | 103-multi-format-export | FEATURE | [specs/103-multi-format-export/spec.md](../../103-multi-format-export/spec.md) |
| 57 | 104-pretooluse-hook | FEATURE | [specs/104-pretooluse-hook/spec.md](../../104-pretooluse-hook/spec.md) |
| 58 | 105-mcp-graph-query | FEATURE | [specs/105-mcp-graph-query/spec.md](../../105-mcp-graph-query/spec.md) |
| 59 | 106-watch-incremental | FEATURE | [specs/106-watch-incremental/spec.md](../../106-watch-incremental/spec.md) |
| 60 | 107-multi-modal-extraction | FEATURE | [specs/107-multi-modal-extraction/spec.md](../../107-multi-modal-extraction/spec.md) |
| 61 | 061-sdk-interface-surface | FEATURE | [specs/061-sdk-interface-surface/spec.md](../../061-sdk-interface-surface/spec.md) |
| 62 | 094-01-api-surface-split | REFACTOR | [specs/094-01-api-surface-split/spec.md](../../094-01-api-surface-split/spec.md) |
| 63 | 094-02-panoramic-dir-restructure | REFACTOR | [specs/094-02-panoramic-dir-restructure/spec.md](../../094-02-panoramic-dir-restructure/spec.md) |
| 64 | 094-03-llm-auth-generator-unification | REFACTOR | [specs/094-03-llm-auth-generator-unification/spec.md](../../094-03-llm-auth-generator-unification/spec.md) |
| 65 | 094-04-index-export-shrink | REFACTOR | [specs/094-04-index-export-shrink/spec.md](../../094-04-index-export-shrink/spec.md) |
| 66 | 094-06-progress-error-reporting | FEATURE | [specs/094-06-progress-error-reporting/spec.md](../../094-06-progress-error-reporting/spec.md) |
| 67 | 094-07-panoramic-spec-driver-bridge | FEATURE | [specs/094-07-panoramic-spec-driver-bridge/spec.md](../../094-07-panoramic-spec-driver-bridge/spec.md) |
| 68 | 114-fix-python-analysis-quality | FIX | [specs/114-fix-python-analysis-quality/spec.md](../../114-fix-python-analysis-quality/spec.md) |
| 69 | 125-product-doc-semantic | FIX | [specs/125-product-doc-semantic/spec.md](../../125-product-doc-semantic/spec.md) |
| 70 | 127-reveal-cost-transparency | FEATURE | [specs/127-reveal-cost-transparency/spec.md](../../127-reveal-cost-transparency/spec.md) |
| 71 | 128-harden-spec-store | REFACTOR | [specs/128-harden-spec-store/spec.md](../../128-harden-spec-store/spec.md) |
| 72 | 130-debt-intelligence | FEATURE | [specs/130-debt-intelligence/spec.md](../../130-debt-intelligence/spec.md) |
| 73 | 131-anchor-hyperedges-schema | FEATURE | [specs/131-anchor-hyperedges-schema/spec.md](../../131-anchor-hyperedges-schema/spec.md) |
| 74 | 132-reading-ux | FEATURE | [specs/132-reading-ux/spec.md](../../132-reading-ux/spec.md) |
| 75 | 140-spectra-doc-pipeline-quality | REFACTOR | [specs/140-spectra-doc-pipeline-quality/spec.md](../../140-spectra-doc-pipeline-quality/spec.md) |
| 76 | 145-spectra-python-ast-patch | FIX | [specs/145-spectra-python-ast-patch/spec.md](../../145-spectra-python-ast-patch/spec.md) |
| 77 | 146-llm-concurrency-optimizer | FEATURE | [specs/146-llm-concurrency-optimizer/spec.md](../../146-llm-concurrency-optimizer/spec.md) |
| 78 | 151-knowledge-graph-python | FEATURE | [specs/151-knowledge-graph-python/spec.md](../../151-knowledge-graph-python/spec.md) |
| 79 | 152-ts-callsites-import-resolver | FEATURE | [specs/152-ts-callsites-import-resolver/spec.md](../../152-ts-callsites-import-resolver/spec.md) |
| 80 | 153-go-callsites-language-adapter | FEATURE | [specs/153-go-callsites-language-adapter/spec.md](../../153-go-callsites-language-adapter/spec.md) |
| 81 | 154-java-callsites | FEATURE | [specs/154-java-callsites/spec.md](../../154-java-callsites/spec.md) |
| 82 | 155-agent-context-mcp-tools | FEATURE | [specs/155-agent-context-mcp-tools/spec.md](../../155-agent-context-mcp-tools/spec.md) |
| 83 | 156-incremental-indexing-depgraph-shim | FEATURE | [specs/156-incremental-indexing-depgraph-shim/spec.md](../../156-incremental-indexing-depgraph-shim/spec.md) |
| 84 | 157-fix-self-dogfood | FIX | [specs/157-fix-self-dogfood/spec.md](../../157-fix-self-dogfood/spec.md) |
| 85 | 170c-mcp-tool-description-response | FEATURE | [specs/170c-mcp-tool-description-response/spec.md](../../170c-mcp-tool-description-response/spec.md) |
| 86 | 170d-driver-preference-shaping | FEATURE | [specs/170d-driver-preference-shaping/spec.md](../../170d-driver-preference-shaping/spec.md) |
| 87 | 171-file-navigation-mcp-tools | FEATURE | [specs/171-file-navigation-mcp-tools/spec.md](../../171-file-navigation-mcp-tools/spec.md) |
| 88 | 174-symbol-id-fuzzy-match | FEATURE | [specs/174-symbol-id-fuzzy-match/spec.md](../../174-symbol-id-fuzzy-match/spec.md) |
| 89 | 175-batch-incremental-wrapper | FEATURE | [specs/175-batch-incremental-wrapper/spec.md](../../175-batch-incremental-wrapper/spec.md) |
| 90 | 177-unify-mcp-response-telemetry | REFACTOR | [specs/177-unify-mcp-response-telemetry/spec.md](../../177-unify-mcp-response-telemetry/spec.md) |
| 91 | 184-mcp-adoption-engineering | FEATURE | [specs/184-mcp-adoption-engineering/spec.md](../../184-mcp-adoption-engineering/spec.md) |
| 92 | 189-ast-anchored-spec-drift-detection | FEATURE | [specs/189-ast-anchored-spec-drift-detection/spec.md](../../189-ast-anchored-spec-drift-detection/spec.md) |
| 93 | 190-scaffold-kb-mvp | FEATURE | [specs/190-scaffold-kb-mvp/spec.md](../../190-scaffold-kb-mvp/spec.md) |
| 94 | 192-scaffold-kb-entity-and-ingest | FEATURE | [specs/192-scaffold-kb-entity-and-ingest/spec.md](../../192-scaffold-kb-entity-and-ingest/spec.md) |
| 95 | 193-worktree-graph-bootstrap-freshness | FEATURE | [specs/193-worktree-graph-bootstrap-freshness/spec.md](../../193-worktree-graph-bootstrap-freshness/spec.md) |
| 96 | 195-graph-only-zero-llm-build | FEATURE | [specs/195-graph-only-zero-llm-build/spec.md](../../195-graph-only-zero-llm-build/spec.md) |
| 97 | 200-m8-doc-closeout | STORY | [specs/200-m8-doc-closeout/spec.md](../../200-m8-doc-closeout/spec.md) |
| 98 | 202-mcp-batch-graph-only-pilot | FEATURE | [specs/202-mcp-batch-graph-only-pilot/spec.md](../../202-mcp-batch-graph-only-pilot/spec.md) |
| 99 | 205-scaffold-kb-examples-guide | STORY | [specs/205-scaffold-kb-examples-guide/spec.md](../../205-scaffold-kb-examples-guide/spec.md) |
| 100 | 214-graph-topology-canonical-id | FIX | [specs/214-graph-topology-canonical-id/spec.md](../../214-graph-topology-canonical-id/spec.md) |
| 101 | 217-graph-quality-gates | FEATURE | [specs/217-graph-quality-gates/spec.md](../../217-graph-quality-gates/spec.md) |
| 102 | 221-fix-specgen-reexport-whitespace | FIX | [specs/221-fix-specgen-reexport-whitespace/spec.md](../../221-fix-specgen-reexport-whitespace/spec.md) |
| 103 | 249-graph-collector-fingerprint | FEATURE | [specs/249-graph-collector-fingerprint/spec.md](../../249-graph-collector-fingerprint/spec.md) |
| 104 | 250-pyi-symbol-surface | FEATURE | [specs/250-pyi-symbol-surface/spec.md](../../250-pyi-symbol-surface/spec.md) |
| 105 | 265-ship-cli-release-gate0 | FEATURE | [specs/265-ship-cli-release-gate0/spec.md](../../265-ship-cli-release-gate0/spec.md) |
| 106 | 266-honest-graph-quality-gate | FIX | [specs/266-honest-graph-quality-gate/spec.md](../../266-honest-graph-quality-gate/spec.md) |
| 107 | 271-product-surface-sweep | FIX | [specs/271-product-surface-sweep/spec.md](../../271-product-surface-sweep/spec.md) |
| 108 | 278-honest-tooling-patches | FIX | [specs/278-honest-tooling-patches/spec.md](../../278-honest-tooling-patches/spec.md) |

---

## 对外文档摘要（供 spec-driver-doc 使用）

Spectra 是一个把代码和工程制品逆向为结构化文档系统与知识图谱的工具。它既能从单个模块生成传统 spec，也能在大型、多语言项目中输出 API、架构、运行时、事件面、故障排查、ADR、quality report 与产品 / UX 文档，并进一步组织成可交付的 docs bundle。知识图谱层将所有结构化分析持久化为统一的 `graph.json`，支持社区检测、架构洞察、多格式导出和 MCP 实时查询。

**主要价值主张**：

- 用统一事实层替代"靠人读代码拼全貌"
- 在多语言、多模块项目中保持可批量、可增量、可回溯
- 输出 docs bundle、Architecture IR、ADR 和 quality gate，降低文档交付与评审成本
- 让 `current-spec.md`、README、设计 Markdown 与 issue/PR 进入同一套产品文档链路
- 知识图谱提供社区结构、God Node 热点和跨模块路径分析能力
- 通过 `spectra watch` 和 post-commit hook 实现文档与代码的持续自动同步
- 对外提供 CLI / Plugin / MCP，多入口共用同一套核心能力
- 给 LLM agent 提供低 token 的结构化上下文：`impact` / `context` / `detect_changes` 取代人工 grep 与推断，`view_file` / `search_in_file` / `list_directory` 取代整文件读取
- 图与代码的失配可被机器检出：`graph-quality` 六指标 + `sourceCommit` 与 collector 指纹双维 freshness，缺证据一律判 stale 而非默认 fresh
- 零结果与不确定性被如实标注（resolution / coverage / freshness / comparisonScope），空图不再判 pass，好图不会被信息量更少的图覆盖
- scaffold-kb 把厂商 SDK 文档与项目文档变成可检索的双层知识库，写代码前即可查证 API 实体、废弃标记与冲突推荐
- agent 工具不只是"注册了"而是"被调用了"：description 的 4 要素结构 + response 内嵌下一步建议 + 子代理侧「任务→工具」优先规则，host 实测把 `impact` 的主动调用率从 0/10 提到 8/10

**典型工作流**：

1. 先用 `spectra batch` 建立模块 spec、项目级 panoramic 文档和架构叙事
2. 用 `spectra graph` 构建知识图谱，`spectra community` 获取架构洞察
3. 通过 docs bundle、Architecture IR、component / dynamic、ADR 和 quality report 组织可交付的技术文档系统
4. 用 `spectra export --format obsidian` 导出到 Obsidian 进行交互式浏览
5. 通过 `spectra watch` 或 post-commit hook 持续维护文档新鲜度
6. Claude Code 通过 MCP graph query 工具实时查询架构关系
7. 冷启动或无认证环境先用 `spectra batch --mode graph-only` 秒级建图，再用 `spectra index --incremental` 保持增量新鲜
8. 提交前跑 `spectra graph-quality`（或经 `repo:check`）体检图质量与新鲜度
9. 改动评估走 `detect_changes` → `impact` → `context` → `view_file` 四步链路
10. 厂商用 `spectra scaffold-kb build` 打包 SDK 文档、集成商用 `scaffold-kb ingest` 导入项目文档，再经 `kb_search` / `kb_doc_lookup` / `kb_api_lookup` 查询

### 新增 CLI 命令与参数

- `spectra index --watch | --incremental`（两者互斥）— 增量索引与持续监听（156）
- `spectra graph-quality [--json] [--status]` — 图质量体检，exit code 0 / 1 / 2 三档固定语义（217）
- `spectra panoramic cross-package | architecture-ir | overview [--json] [--project-root <dir>]`（094-07）
- `spectra scaffold-kb build --llms-txt | --dir [--output] [--sdk-version]`、`scaffold-kb ingest --url | --file | --minutes [--yes | --dry-run]`、`scaffold-kb query [--requirement] [--top-k] [--max-inject-chars] [--format markdown|json] [--probe]`、`scaffold-kb serve`（190, 192, 200, 205）
- `spectra batch --mode full | reading | code-only | graph-only`（132, 195）；`--concurrency=N`（146）；`--full`（`--force` 等效别名）（175）；`--dry-run`、`--budget <N>`、`--on-over-budget continue|cheaper-model|skip-enrichment|cancel`（127）；`--hyperedges`（131）
- `spectra graph --force` — 信息量不减守卫的逃生口（266）

### 新增 MCP 工具与响应约定

- Agent context：`impact`、`context`、`detect_changes`（155）
- 文件导航：`view_file`、`search_in_file`、`list_directory`（171）
- 图谱与桥接：`graph_hyperedges`（131）、`panoramic-query`（094-07）
- 知识库：`kb_search`、`kb_doc_lookup`（190）、`kb_api_lookup`（192）
- 版本自省：`server_build_info` 返回 `{version, commit, dirty}`（265）
- `batch` 工具 mode 枚举新增 `graph-only`（202）；`graph_query` 等 5 个 graph 工具新增可选 `projectRoot` 参数（114）
- 统一错误 envelope `{code, message, hint?, context?}`，新增错误码 `path-outside-root` / `binary-file` / `file-not-found`（171）与 `graph-query-failed`（177）
- server 提供非空 `instructions` 工具导览（184）；零结果附 honesty envelope（resolution / coverage / freshness / comparisonScope）（266）
- 当前共 18 个已注册工具，`plugins/spectra/README.md` 工具表与注册点逐一对应（271）
- agent context 三工具 response 新增决策字段：`impact` / `detect_changes` 的 `topImpacted`（<= 5 项 `{id, score}`）、`detect_changes` 的 `riskTier`（`low` / `medium` / `high`）、`context` 的 `topRelevantCallers`（<= 3 项），三者共用 `nextStepHint` 与 enrichment 降级标志 `_enrichmentDegraded`；新字段 producer 侧总是产出、schema 侧一律 optional，错误路径不含新字段；三工具 description 升级为 100-500 字符的 4 要素结构（170c）
- agent 侧采纳引导（制品在 spec-driver 插件侧）：5 个子代理 prompt 内置按 frontmatter `tools` 过滤的「任务→工具」优先规则（每 agent 3 行），单一事实源 `templates/preference-rules.md` + `--check` 漂移守护接入 `repo:check`；5 个 SKILL.md 委派前置补调度优先级提示块，`spectra-mcp-integration.md` 增「Driver 偏好引导设计」章节与 override 机制（170d）

### 新增产物、字段与环境变量

- 产物：`interface-surface.md` / `.json`（061）；`<specsDir>/project/technical-debt.md`（130）；`_meta/graph.html` 改为始终生成（140）；`.spectra/unified-graph.json` 增量快照（156）；`kb/doc-graph.json`、`kb/chunks.sqlite`、`kb/api-entities.json`（190, 192）；`regen-audit.jsonl` 审计 sidecar（278）
- `graph.json` 字段：`hyperedges` 顶层数组与 `schemaVersion` 2.0（131）、`graph.sourceCommit`（217）、metadata 的 `fingerprint`（249）、symbol 节点 `metadata.lineRange`（271）、`contains` 边（214）、`relation='calls'` 边（151, 152）
- spec frontmatter：`sourceKind` / `derivedFrom`（128）、`costBreakdown` / `contextTruncated`（140）、`enhancement: llm | ast-only`（125）
- 环境变量：`REVERSE_SPEC_LOG_LEVEL`（debug / info / warn / error，默认 warn）（094-06）、`SPECTRA_DEV`（128）、`SPECTRA_HYPEREDGES_ENABLED`（131）
- 配置：`spec-driver.config.yaml` 新增 `batch.concurrency` 节（146）
- 治理链：`repo:check` 新增图质量子检查（skip / warning / error 三态）（217）；`release:check` 新增发布断层 warning 与 indeterminate 提示（265）；`scripts/adoption-census.mjs` 一键统计 MCP 调用分布（265）
- 用户文档：`docs/spectra-cli-reference.md` 与新增的 `docs/scaffold-kb-guide.md`（build / ingest / query / 接入工作流 / 端到端 worked example 五段）（200, 205）
