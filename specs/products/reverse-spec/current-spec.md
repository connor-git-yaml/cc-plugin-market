# Reverse-Spec — 产品规范活文档

> **产品**: reverse-spec
> **版本**: 聚合自 38 个增量 spec / blueprint（001–010, 024–031, 033–052）
> **最后聚合**: 2026-03-20
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

Reverse-Spec 是一个面向代码与工程制品的 **结构化逆向文档工具链**。它最初聚焦于 TypeScript/JavaScript 的 Spec 生成与漂移检测，现已演进为覆盖 **多语言代码分析、批量文档化、全景文档生成、交叉引用、覆盖率审计与增量重生成** 的产品能力集合。

当前产品定位有两层：

- **逆向规格层**：从源代码、依赖图和配置中生成结构化 spec、差异报告与批量索引
- **全景文档层**：基于统一的 `ProjectContext`、Generator/Parser 注册机制和共享中间模型，生成数据模型、配置、API、运行时、架构、事件面、故障排查、模式提示等多种文档

**核心价值**：

- **多语言覆盖**：从 JS/TS 扩展到 Python、Go、Java，并支持混合项目检测与分组处理
- **文档类型扩展**：从单一模块 spec 扩展到 10+ 类 panoramic 文档
- **可持续维护**：支持 doc graph、coverage audit、delta regeneration，避免文档生成一次后失管
- **多入口复用**：CLI、Claude Code Plugin 与 MCP Server 共用同一核心能力
- **诚实降级**：在 LLM、解析器或上游制品不足时保留 AST-only / 目录图 / 占位说明等静默降级路径

**分发方式**：

- **CLI**：`reverse-spec generate|batch|diff|mcp-server|auth-status`
- **Plugin**：`plugins/reverse-spec/.claude-plugin/plugin.json`
- **MCP**：通过 stdio server 暴露生成与批量工具

---

## 2. 目标与成功指标

### 产品愿景

让开发者可以把“看代码理解系统”转成“读取持续更新的结构化文档理解系统”，并让文档体系从单点生成演进为覆盖架构、接口、运行时与维护视角的长期事实层。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 单模块 Spec 生成可用性 | 一条命令完成结构化文档生成 | 001 |
| 接口定义准确率 | 100% 来自 AST / 结构提取，零 LLM 捏造签名 | 001 |
| 批量处理自主性 | 对大型项目支持断点恢复、进度报告与失败降级 | 001, 006, 007 |
| 多语言首批覆盖 | Python / Go / Java 三种语言首批可用 | 024–031 |
| 混合项目识别 | 混合项目自动按语言分组并生成索引 | 031 |
| 全景文档生成器规模 | ≥ 10 类生成器可注册、发现与执行 | 033–050 |
| 输出格式 | Markdown + JSON + Mermaid `.mmd` | 051 |
| 文档互链能力 | 生成 related spec、稳定 anchor 与 `_doc-graph.json` | 044 |
| 文档审计能力 | 输出 coverage report，覆盖缺失、断链、低置信度 | 046 |
| 增量更新能力 | 支持 `--incremental` 仅重生受影响文档 | 049 |
| 单语言非 TS/JS batch 可用性 | Python/Go/Java 项目不再出现 0 模块 | 052 |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **接手遗留模块的开发者** | 需要快速理解某个目录或模块 | 运行 `reverse-spec generate <target> --deep` |
| **大型仓库维护者** | 需要批量生成全项目文档并保持可更新 | 运行 `reverse-spec batch` / `reverse-spec batch --incremental` |
| **多语言平台工程师** | 管理 Python、Go、Java、TS/JS 混合仓库 | 使用多语言适配器和 mixed-project batch |
| **架构/文档负责人** | 需要 API、运行时、架构、事件、排障等 panoramic 文档 | 调用 panoramic generators 或 batch 输出 |
| **集成开发者** | 通过外部 Agent / 工具调用能力 | 使用 CLI 或 MCP Server |

### 核心使用场景

1. **单模块逆向规格**：为一个目录或模块生成结构化 spec，快速理解意图、接口、依赖和边界
2. **批量项目文档化**：为 monorepo 或多语言项目构建模块图、索引、覆盖率和增量更新链路
3. **架构与运行时梳理**：从 Dockerfile、Compose、配置与 workspace 结构产出架构概览和部署视图
4. **接口与事件面盘点**：生成 API Surface、事件面文档和相关 Spec 互链，支撑 onboarding 与 review
5. **文档维护闭环**：在代码变更后运行 diff、coverage audit、delta regeneration，缩小文档漂移

---

## 4. 范围与边界

### 范围内

- TypeScript / JavaScript / Python / Go / Java 源码分析
- 基于 `LanguageAdapter`、tree-sitter 与现有 AST 路径的多语言解析
- 单模块 spec、批量索引、依赖图、漂移检测
- panoramic 文档：数据模型、配置、workspace、跨包依赖、API、运行时、架构、事件面、故障排查、模式提示
- 非代码制品解析：Dockerfile、YAML、TOML、`.env`、SKILL.md、behavior YAML
- Markdown / JSON / Mermaid 输出
- doc graph、coverage audit、delta regeneration
- CLI / Plugin / MCP 三种交付入口

### 范围外

- 自动修改、重构或生成业务代码
- Rust、C++、Kotlin、Ruby、Swift 等非首批语言的完整一等支持
- IDE 内实时飘移提醒和可视化编辑
- 自动测试用例生成
- 文档内容的外部发布编排与站点部署
- Plugin 自动升级、签名校验与远程策略下发

---

## 5. 当前功能全集

### FR-GROUP-1: 核心分析流水线

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | 使用 AST / tree-sitter 提取导出符号、类型、依赖与骨架信息 | 001, 027 | 活跃 |
| FR-002 | 强制三阶段混合流水线：预处理 → 上下文组装 → 生成与增强 | 001 | 活跃 |
| FR-003 | LLM Prompt 与代码块标记按语言参数化 | 026 | 活跃 |
| FR-004 | 敏感信息脱敏与 `[推断]` / `[不明确]` / AST-only 降级标记 | 001, 006, 051 | 活跃 |

### FR-GROUP-2: 批量生成与漂移检测

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-005 | `generate`、`batch`、`diff`、`mcp-server`、`auth-status` 子命令 | 001, 002, 004, 009 | 活跃 |
| FR-006 | 模块级 batch：拓扑排序、循环依赖聚合、checkpoint 与进度报告 | 001, 005, 006 | 活跃 |
| FR-007 | LLM 失败或超时时重试并回退 AST-only | 006, 007 | 活跃 |
| FR-008 | mixed-project batch 支持按语言分图与合并 | 031 | 活跃 |
| FR-009 | `--incremental` 仅重生成受影响 spec，并输出 delta report | 049 | 活跃 |
| FR-010 | 单语言非 TS/JS 项目 batch 走适配器图或目录图兜底 | 052 | 活跃 |
| FR-011 | 漂移检测支持结构差异、语义差异与噪声过滤 | 001, 026 | 活跃 |

### FR-GROUP-3: 多语言扩展

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-012 | `LanguageAdapter` 抽象层与 Registry 统一文件路由 | 024, 025 | 活跃 |
| FR-013 | 首批适配器支持 Python / Go / Java | 028, 029, 030 | 活跃 |
| FR-014 | tree-sitter grammar 管理与 query mapper 支撑多语言解析 | 027 | 活跃 |
| FR-015 | 混合项目语言分布识别、目录分组与索引展示 | 031 | 活跃 |

### FR-GROUP-4: Panoramic 基础设施

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-016 | `DocumentGenerator` / `ArtifactParser` 接口及统一契约 | 033, 034 | 活跃 |
| FR-017 | `ProjectContext` 聚合包管理器、workspace、语言、配置和已有 spec | 035 | 活跃 |
| FR-018 | `GeneratorRegistry` / `ParserRegistry` 管理生成器与解析器 | 036 | 活跃 |
| FR-019 | `AbstractRegistry` / `AbstractConfigParser` 支撑统一解析扩展 | 036, 037 | 活跃 |
| FR-020 | Dockerfile、YAML、TOML、env、SKILL.md 等制品解析器 | 037, 039 | 活跃 |
| FR-021 | LLM 语义增强与 `MultiFormatWriter` 输出 Markdown / JSON / Mermaid | 051 | 活跃 |

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

### FR-GROUP-6: 文档图谱、审计与维护

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-032 | `DocGraphBuilder` 构建源码/模块/spec 关联图 | 044 | 活跃 |
| FR-033 | `CrossReferenceIndex` 回写 related spec、稳定 anchor 和 `_doc-graph.json` | 044 | 活跃 |
| FR-034 | `CoverageAuditor` 输出 `_coverage-report.md` / `.json` | 046 | 活跃 |
| FR-035 | 覆盖率审计包含 missing docs、unlinked specs、broken refs、low confidence | 046 | 活跃 |
| FR-036 | delta regeneration 复用 skeleton hash、dependency graph 与 doc graph owner mapping | 049 | 活跃 |

### FR-GROUP-7: 分发、认证与横切关注点

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-037 | Plugin Marketplace 架构 + MCP stdio server | 009 | 活跃 |
| FR-038 | CLI 与 Plugin 共用同一套核心分析实现 | 002, 009 | 活跃 |
| FR-039 | 保持只读：仅向 `specs/`、`drift-logs/` 等产物目录写入 | 001, 010 | 活跃 |
| FR-040 | 使用相对路径输出，避免泄露本机目录结构 | 008, 010 | 活跃 |
| FR-041 | 批量输出包含 Markdown、JSON 与 Mermaid 文件族 | 051 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| AST 预处理（500 文件） | ≤ 10 秒 | 001 |
| 单文件上下文预算 | ≤ 100k token | 001 |
| 大模块失败耗时 | ≤ 5 分钟（含降级） | 006, 007 |
| 单语言非 TS/JS batch | 返回非空模块集合 | 052 |
| panoramic 输出 | 支持按 generator 单独执行，避免一次性生成全部文档 | 033–050 |

### 可靠性

- batch 支持 checkpoint、skip、force 与 AST-only 保底
- 解析器或上游制品不足时回退到目录图、占位说明或低置信度标记
- doc graph 与 coverage report 为后续增量重生成提供可复用事实层
- 多格式输出保持同一份结构化数据的多视图渲染，减少格式间漂移

### 兼容性

- Node.js LTS 20.x+
- 平台：macOS、Linux，Windows 为尽力支持
- 语言：TS/JS、Python、Go、Java 为一等支持
- 输出合同：Markdown、JSON、Mermaid `.mmd`

### 可用性

- 所有用户可见文档正文默认中文，代码标识符保持原文
- CLI 保留阶段进度、错误上下文和报告路径输出
- panoramic 层优先复用共享模型，避免每类文档重复解析
- 缺失信息采用 `[推断]`、`low confidence`、`[待补充]` 标记，而非静默捏造

---

## 7. 当前技术架构

### 技术栈

- **TypeScript 5.x / Node.js 20+**
- `ts-morph` + `web-tree-sitter`
- `dependency-cruiser`
- `handlebars`
- `zod`
- `@anthropic-ai/sdk`
- `@modelcontextprotocol/sdk`

### 项目结构

```text
cc-plugin-market/
├── plugins/
│   └── reverse-spec/
│       ├── .claude-plugin/plugin.json
│       ├── skills/
│       ├── hooks/
│       └── scripts/
├── src/
│   ├── core/                 # AST、context、LLM、tree-sitter
│   ├── adapters/             # 多语言适配器
│   ├── graph/                # 依赖图与拓扑排序
│   ├── batch/                # batch、checkpoint、delta regeneration
│   ├── diff/                 # structural / semantic diff
│   ├── panoramic/            # generators、parsers、registries、auditors
│   ├── auth/                 # provider / CLI proxy
│   ├── cli/                  # 命令入口
│   └── mcp/                  # MCP stdio server
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
```

### 架构要点

- 逆向规格主链路仍由 `core + batch + diff` 负责
- panoramic 主链路由 `ProjectContext + Registry + Generators + Parsers` 组成
- `044/046/049` 形成文档维护闭环：图谱 → 审计 → 增量重生
- `043/045/050` 共享运行时 / 架构中间模型，避免重复建模

---

## 8. 设计原则与决策记录

| 原则 | 说明 | 来源 |
|------|------|------|
| AST 精确性优先 | 结构性数据必须来自 AST、解析器或显式 schema，而非 LLM 虚构 | 001, 042 |
| Adapter-first | 语言差异通过 `LanguageAdapter` 隔离，不把判断散落在主流程中 | 024, 025 |
| 共享中间模型 | panoramic 文档优先复用 `ProjectContext`、Runtime Model、DocGraph | 033–050 |
| 诚实降级 | 信息不足时明确标注或降级，不以“完整”为名编造事实 | 001, 046, 048 |
| 只读与可回溯 | 不改源码；输出文档附带来源、锚点、报告或路径以便追踪 | 001, 044, 049 |

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

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 024 | 多语言 grammar 与 query mapper 需要持续维护 | 中 |
| 043/045 | 运行时模型与真实部署配置可能存在环境漂移 | 中 |
| 044/046/049 | doc graph owner mapping 规则若过粗，会影响增量命中准确性 | 中 |
| 051 | 大模块 LLM 语义增强仍需更细的 prompt 体积控制 | 中 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 目标仓库可通过静态文件与目录结构提取出足够多的工程事实 | 033–050 | 中 |
| tree-sitter grammar 与查询足以覆盖首批语言的主流代码形态 | 024–031 | 中 |
| batch 产生的模块划分能为 panoramic 生成提供稳定输入 | 005, 031, 052 | 中 |
| 上游项目允许把生成文档写入 `specs/` | 001, 010 | 低 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 大型仓库 LLM 上下文过大 | 中 | 中 | token 预算、降级、增量 regeneration |
| 多语言依赖图误判 | 中 | 中 | 目录图兜底、适配器独立测试、低置信度标记 |
| panoramic 输出过多导致用户不知道从何读起 | 中 | 低 | workspace index、architecture overview、coverage report 作为入口 |
| 文档互链漂移 | 低 | 中 | `_doc-graph.json` + `_coverage-report.*` + delta report |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| `.specs/` 默认输出目录 | 008 一度改为隐藏目录 | 010: `specs/` | 统一路径，减少文档和脚本歧义 |
| 文件级 batch 视角 | 001 初始设计偏文件粒度 | 005: 模块级聚合 | 模块级更适合大型项目理解 |
| 固定 120 秒 LLM 超时 | 早期统一超时策略 | 007: 模型感知超时 | 避免大模块频繁误杀 |
| TS/JS 专用主流程 | 001 初始只覆盖 JS/TS | 024–031: 多语言适配链路 | 产品已扩展为多语言 |

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

---

## 对外文档摘要（供 spec-driver-doc 使用）

Reverse-Spec 是一个把代码和工程制品逆向为结构化文档的工具。它既能从单个模块生成传统 spec，也能在大型、多语言项目中输出 API、架构、运行时、事件面、故障排查和覆盖率审计等全景文档。

**主要价值主张**：

- 用统一事实层替代“靠人读代码拼全貌”
- 在多语言、多模块项目中保持可批量、可增量、可回溯
- 对外提供 CLI / Plugin / MCP，多入口共用同一套核心能力

**典型工作流**：

1. 先用 `reverse-spec batch` 建立索引和基础 spec
2. 按需调用 panoramic generators 输出特定视角文档
3. 用 coverage / delta report 持续维护文档新鲜度
