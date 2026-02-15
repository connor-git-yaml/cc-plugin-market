# Reverse-Spec — 产品规范活文档

> **产品**: reverse-spec
> **版本**: 聚合自 10 个增量 spec（001–010）
> **最后聚合**: 2026-02-15
> **生成方式**: Spec Driver sync 子代理自动聚合
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

Reverse-Spec 是一个 **Claude Code Plugin**，通过 AST 静态分析 + LLM 混合流水线，将遗留 TypeScript/JavaScript 源代码逆向工程为结构化、机器可读的 Spec 文档。

**核心定位**：面向需要理解、文档化和维护大型代码库的开发者和技术团队，提供"源代码到规格文档"的自动化桥梁。

**核心价值**：
- **自动化文档生成**：一条命令即可从源代码生成完整的 9 段式结构化 Spec 文档
- **AST 精确性保证**：接口定义 100% 来自 AST 提取，零 LLM 捏造签名
- **大规模项目支持**：支持 200+ 模块 Monorepo 的批量处理，基于依赖拓扑排序
- **Spec 漂移检测**：代码变更后检测 Spec 与代码的偏移，闭合文档反馈环

**分发方式**：
- **Claude Code Plugin Marketplace**（主要）：通过 `.claude-plugin/marketplace.json` 注册，支持 Plugin 标准安装流程
- **npm CLI**（兼容）：`npm install -g reverse-spec` 全局安装，提供 `reverse-spec` 命令行工具
- **MCP Server**：通过 Model Context Protocol 暴露 `prepare`、`generate`、`batch`、`diff` 四个工具

---

## 2. 目标与成功指标

### 产品愿景

让每一份代码都拥有与其同步的、结构化的、高质量的规格文档，推动 Spec-Driven Development (SDD) 在遗留代码库中的落地。

### 产品级 KPI

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 单模块 Spec 生成可用性 | 一条命令完成，9 段结构完整 | SC-001 (001) |
| 接口定义准确率 | 100%（AST 提取，零 LLM 捏造） | SC-002 (001) |
| AST 预处理性能 | 500 文件 ≤ 10 秒 | SC-003 (001) |
| Golden Master 结构相似度 | ≥ 90% | SC-004 (001) |
| 批量处理自主性 | 50 模块端到端无人工干预 | SC-005 (001) |
| 签名级漂移检测准确率 | ≥ 95% | SC-006 (001) |
| 噪声过滤 | 零误报（空白/注释/import 重排） | SC-007 (001) |
| 全局安装到首次生成 | ≤ 5 分钟 | SC-001 (002) |
| Skill 可发现率 | 3 个 Skill 100% 可发现和触发 | SC-002 (002) |
| Batch LLM 调用成功率 | ≥ 95%（默认配置） | SC-001 (007) |
| 大模块最大失败耗时 | ≤ 5 分钟（含降级） | SC-002 (006) |
| Spec 章节完整率 | ≥ 95% | SC-002 (005) |
| Mermaid 图表出现率 | ≥ 80% | SC-003 (005) |

### 订阅认证目标

| 指标 | 目标值 | 来源 |
|------|--------|------|
| 订阅用户免 API Key 成功率 | ≥ 95% | SC-001 (004) |
| CLI 代理延迟开销 | ≤ API Key 方式的 2 倍 | SC-002 (004) |
| 向后兼容性 | API Key 用户零破坏性变更 | SC-003 (004) |

---

## 3. 用户画像与场景

### 用户角色

| 角色 | 描述 | 主要使用场景 |
|------|------|------------|
| **单模块开发者** | 面对不熟悉的代码库，需要快速理解某个模块 | 运行 `/reverse-spec src/auth/` 生成模块文档 |
| **技术负责人** | 管理大型 monorepo，需要系统性文档化 | 运行 `/reverse-spec-batch` 批量生成全项目文档 |
| **迭代开发者** | 代码变更后检查文档是否过时 | 运行 `/reverse-spec-diff` 检测 Spec 漂移 |
| **Claude Max/Pro 订阅用户** | 已有 Claude 订阅，不想额外配置 API Key | 直接使用，系统自动通过 CLI 代理认证 |
| **项目贡献者** | 在 reverse-spec 项目内进行开发 | 使用本地 `npx tsx` 调用，不受全局安装影响 |

### 核心使用场景

1. **单模块 Spec 生成**：开发者在 Claude Code 中运行 `/reverse-spec src/auth/`，系统扫描目录下 TypeScript 文件，通过 AST 提取接口签名，LLM 增强语义描述，生成 `specs/auth.spec.md`
2. **批量项目文档化**：技术负责人运行 `/reverse-spec-batch`，系统构建依赖图、拓扑排序、逐模块生成，产出 `specs/_index.spec.md` 架构概览 + 各模块 Spec
3. **Spec 漂移检测**：代码修改后运行 `/reverse-spec-diff specs/auth.spec.md src/auth/`，生成分类漂移报告（HIGH/MEDIUM/LOW）
4. **项目级 Skill 安装**：通过 Plugin Marketplace 标准流程安装 reverse-spec Plugin
5. **认证状态诊断**：运行 `reverse-spec auth-status` 查看当前可用的认证方式和优先级

---

## 4. 范围与边界

### 范围内

- TypeScript/JavaScript 源代码的 AST 增强分析（ts-morph + tree-sitter 容错）
- 9 段式结构化 Spec 文档生成（含 Mermaid 图表、YAML frontmatter）
- 基于 dependency-cruiser 的项目级依赖图构建和拓扑排序
- 批量处理：模块级聚合、断点恢复、进度报告、AST-only 降级
- 结构化差异引擎 + LLM 语义差异评估
- 全局 CLI 分发（`npm install -g`）
- Claude Code Plugin Marketplace 架构（plugin.json + skills/ + hooks/ + MCP Server）
- 双认证支持：API Key 直接调用 + Claude CLI 子进程代理
- MCP stdio server 暴露 `prepare`/`generate`/`batch`/`diff` 四个工具

### 范围外

- **代码生成或修改**：系统严格只读，不生成、重构或修改源代码
- **IDE 实时集成**：VS Code 等 IDE 中的实时 Spec 漂移显示（推迟至路线图）
- **非 Node.js 语言 AST 支持**：Python、Rust、Go、Java 等语言仅接受降级的纯 LLM 分析
- **自动化测试用例生成**：系统文档化已有代码但不生成测试用例
- **Windows 平台**：CLI 和认证仅支持 macOS 和 Linux
- **直接读取 OAuth token**：Anthropic 限制 OAuth token 仅限 Claude Code 使用
- **批量处理并行化**：当前批量处理仍为串行
- **LLM 响应语义验证**：仅做格式解析
- **Plugin 自动版本更新和安全签名**

---

## 5. 当前功能全集

### FR-GROUP-1: 核心分析流水线

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-001 | 使用 AST 解析（ts-morph）从 TS/JS 文件提取所有导出的接口、类型、类和函数签名 | 001 | 活跃 |
| FR-002 | 强制三阶段混合流水线（预处理 → 上下文组装 → 生成与增强） | 001 | 活跃 |
| FR-003 | 使用骨架代码将每个文件分析上下文控制在 100k token 以内 | 001 | 活跃 |
| FR-004 | 主解析器语法错误时回退到 tree-sitter 容错解析 | 001 | 活跃 |
| FR-005 | 超过 5,000 行的文件触发分块摘要策略 | 001 | 活跃 |
| FR-027 | LLM 上下文组装前自动检测并脱敏密钥模式（API 密钥、令牌、凭据） | 001 | 活跃 |

### FR-GROUP-2: Spec 生成（/reverse-spec）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-006 | 按 9 节结构生成 Spec（意图、接口定义、业务逻辑、数据结构、约束条件、边界条件、技术债务、测试覆盖、依赖关系） | 001 | 活跃 |
| FR-007 | 生成 Mermaid 类图和依赖图并嵌入 Spec | 001, 005 | 活跃（005 新增依赖关系图） |
| FR-008 | 不确定内容标注 `[推断]`、`[不明确]`、`[SYNTAX ERROR]` | 001 | 活跃 |
| FR-009 | YAML frontmatter 含 type、version（递增计数器）、generator、sourceTarget（相对路径）、relatedFiles、confidence、lastUpdated | 001, 008 | 活跃（008 修复为相对路径） |

### FR-GROUP-3: 批量处理（/reverse-spec-batch）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-010 | 构建项目级依赖图并按拓扑顺序处理模块 | 001 | 活跃 |
| FR-011 | 检测循环依赖，将强连通分量视为单一处理单元 | 001 | 活跃 |
| FR-012 | 支持可恢复的批量处理（跳过已有 Spec，`--force` 覆盖） | 001 | 活跃 |
| FR-013 | 生成架构索引 `specs/_index.spec.md` | 001 | 活跃 |
| FR-014 | 高层模块读取已生成 Spec 的接口定义（O(1) 上下文策略） | 001 | 活跃 |
| FR-015 | 实时终端进度 + 批量摘要日志 | 001, 006 | 活跃（006 增强为细粒度阶段进度） |
| FR-016 | 指数退避重试，降级为 AST-only 输出 | 001, 006, 007 | 活跃（006 超时快速失败，007 动态超时） |
| FR-017 | 批量处理断点恢复 | 001 | 活跃 |
| FR-B-001 | 文件按目录聚合为模块，以模块为单位生成 Spec | 005 | 活跃 |
| FR-B-002 | 模块分组支持自定义 basePrefix、depth、rootModuleName | 005 | 活跃 |
| FR-B-003 | 模块间处理顺序遵循模块级拓扑排序 | 005 | 活跃 |
| FR-B-004 | 根目录散文件归入 root 模块 | 005 | 活跃 |
| FR-B-005 | 兼容 dependency-cruiser v15.x 和 v16.x（同步/异步 API） | 005 | 活跃 |
| FR-B-006 | cruise 空结果返回空 DependencyGraph 而非崩溃 | 005 | 活跃 |
| FR-B-007 | 在目标项目目录执行 cruise，异常时恢复原工作目录 | 005 | 活跃 |

### FR-GROUP-4: 批量生成体验优化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-P-001 | 模块处理每个关键阶段输出进度信息（6 阶段） | 006 | 活跃 |
| FR-P-002 | 阶段进度信息包含阶段名称和上下文 | 006 | 活跃 |
| FR-P-003 | 阶段完成时输出耗时 | 006 | 活跃 |
| FR-P-004 | 重试时显示重试次数和原因 | 006 | 活跃 |
| FR-P-005 | 超时类错误最多重试 1 次（快速失败） | 006 | 活跃 |
| FR-P-006 | LLM 最终失败时自动降级为 AST-only 输出 | 006 | 活跃 |
| FR-P-007 | 上下文 token 超阈值时 LLM 调用前输出警告 | 006 | 活跃 |
| FR-P-008 | 速率限制等待退避时提示等待状态 | 006 | 活跃 |

### FR-GROUP-5: LLM 调用配置优化

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-L-001 | Batch 场景使用速度更快的默认模型 | 007 | 活跃 |
| FR-L-002 | 系统提示词在所有调用路径中只出现一次 | 007 | 活跃 |
| FR-L-003 | 根据所选模型自动确定超时时间 | 007 | 活跃 |
| FR-L-004 | 保留环境变量覆盖默认模型能力 | 007 | 活跃 |

### FR-GROUP-6: Spec 生成质量提升

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-Q-001 | LLM 系统提示词包含 9 章节详细格式要求 | 005 | 活跃 |
| FR-Q-002 | 章节标题匹配支持中英文变体、大小写/标点容错 | 005 | 活跃 |
| FR-Q-003 | 缺失章节用带改善建议的占位内容填充 | 005 | 活跃 |
| FR-Q-004 | 同时生成类图和依赖关系图 | 005 | 活跃 |

### FR-GROUP-7: 路径处理

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-PA-001 | frontmatter sourceTarget 使用相对路径 | 008 | 活跃 |
| FR-PA-002 | Spec 标题使用相对路径 | 008 | 活跃 |
| FR-PA-003 | Batch 和单文件 generate 均输出相对路径 | 008 | 活跃 |
| FR-PA-004 | Mermaid 依赖图节点使用相对路径 | 008 | 活跃 |
| FR-PA-005 | baseline skeleton HTML 注释使用相对路径 | 008 | 活跃 |
| FR-PA-006 | 默认输出目录为 `specs/` | 008→010 | 活跃（010 统一） |

### FR-GROUP-8: 漂移检测（/reverse-spec-diff）

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-018 | 漂移报告按严重级别分类（HIGH/MEDIUM/LOW） | 001 | 活跃 |
| FR-019 | 导出符号结构化差异比较（新增/删除/修改签名） | 001 | 活跃 |
| FR-020 | 行为变更委托 LLM 语义评估 | 001 | 活跃 |
| FR-021 | 过滤噪声（空白/注释/import 重排） | 001 | 活跃 |
| FR-022 | 无用户确认不更新 Spec | 001 | 活跃 |

### FR-GROUP-9: 分发与安装

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-D-001 | `reverse-spec` 全局 CLI 命令（generate/batch/diff/mcp-server/auth-status 子命令） | 002, 004, 009 | 活跃 |
| FR-D-002 | `--version` 显示版本号 | 002 | 活跃 |
| FR-D-003 | `--help` 显示所有子命令用法 | 002 | 活跃 |
| FR-D-004 | `--output-dir` 选项覆盖默认输出目录 | 002 | 活跃 |

### FR-GROUP-10: 认证支持

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-A-001 | 支持两种 LLM 调用方式：API Key 直接调用 + Claude CLI 子进程代理 | 004 | 活跃 |
| FR-A-002 | 认证优先级：API Key > Claude CLI 子进程 | 004 | 活跃 |
| FR-A-003 | CLI 子进程调用时解析输出为与 SDK 相同格式 | 004 | 活跃 |
| FR-A-004 | spawn 前检测 CLI 安装和认证状态 | 004 | 活跃 |
| FR-A-005 | 所有认证不可用时给出诊断信息 | 004 | 活跃 |
| FR-A-006 | `auth-status` 子命令查询认证状态（支持 `--verify`） | 004 | 活跃 |
| FR-A-007 | Batch 模式限制并发 CLI 子进程数 | 004 | 活跃 |

### FR-GROUP-11: Plugin Marketplace 架构

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-M-001 | `.claude-plugin/marketplace.json` Marketplace 清单 | 009 | 活跃 |
| FR-M-002 | `plugins/reverse-spec/` 自包含 Plugin 目录 | 009 | 活跃 |
| FR-M-003 | `plugin.json` 含 skills/hooks/mcpServers 声明 | 009 | 活跃 |
| FR-M-004 | 3 个 Skill 迁移到 Plugin skills/ 目录 | 009 | 活跃 |
| FR-M-005 | `mcp-server` 子命令启动 MCP stdio server | 009 | 活跃 |
| FR-M-006 | MCP Server 暴露 prepare/generate/batch/diff 四个工具 | 009 | 活跃 |
| FR-M-007 | postinstall hook 检查环境和依赖 | 009 | 活跃 |

### FR-GROUP-12: 横切关注点

| ID | 功能描述 | 来源 | 状态 |
|----|----------|------|------|
| FR-023 | 不修改、创建或删除目标目录中的源代码（只读保证） | 001 | 活跃 |
| FR-024 | 仅向 `specs/` 和 `drift-logs/` 目录写入输出 | 001, 010 | 活跃（010 统一路径） |
| FR-025 | 中文 Spec 正文 + 英文代码标识符/文件路径/类型签名 | 001 | 活跃 |
| FR-026 | 遵循 `.gitignore` 规则 | 001 | 活跃 |

---

## 6. 非功能需求

### 性能

| 需求 | 目标 | 来源 |
|------|------|------|
| AST 预处理（500 文件） | ≤ 10 秒 | 001 |
| 单文件上下文 | ≤ 100k token | 001 |
| 单模块 LLM 调用（默认模型） | 平均 ≤ 120 秒 | 007 |
| 大模块失败耗时（含降级） | ≤ 5 分钟 | 006 |
| MCP Server 启动时间 | < 2 秒 | 009 |

### 安全性

- LLM 上下文组装前自动脱敏敏感信息（API 密钥、令牌、数据库凭据、私钥）（001）
- 生成的 Spec 使用相对路径，不暴露用户机器目录结构（008）
- OAuth token 不直接读取，通过 CLI 子进程间接调用（004）

### 可靠性

- 批量处理断点恢复，中断后从最后完成模块继续（001）
- LLM 失败时降级为 AST-only 输出，保证每个模块至少有基础 Spec（006）
- 超时类错误快速失败（最多重试 1 次），其他错误指数退避重试（006, 007）
- dependency-cruiser 同步/异步 API 兼容（005）

### 兼容性

- 平台：macOS、Linux（Windows 为尽力支持）
- Node.js：LTS 20.x+
- dependency-cruiser：v15.x 和 v16.x
- Claude Code：支持 Plugin、Skill、MCP 协议

### 可用性

- 所有用户可见输出使用中文
- CLI 帮助文本清晰列出所有子命令和选项（002）
- 认证失败诊断信息能让用户 2 分钟内解决（004）
- 细粒度进度报告区分"正常处理中"与"卡住/超时"（006）

---

## 7. 当前技术架构

### 技术栈（009 Plugin Marketplace 重构后）

- **TypeScript 5.7.3**, Node.js LTS (>= 20.x)
- `ts-morph` — AST 解析（主解析器）
- `tree-sitter` + `tree-sitter-typescript` — 容错降级解析器
- `dependency-cruiser` — 依赖图构建（兼容 v15.x/v16.x）
- `handlebars` — 模板渲染
- `zod` — Schema 验证
- `@anthropic-ai/sdk` — LLM API 调用（直接 SDK 方式）
- `@modelcontextprotocol/sdk` — MCP Server 实现（009 新增）
- Node.js 内置模块：`fs`、`path`、`os`、`url`、`child_process`

### 项目结构

```text
reverse-spec/
├── .claude-plugin/
│   └── marketplace.json           # Marketplace 清单
├── plugins/
│   └── reverse-spec/              # Plugin 目录
│       ├── plugin.json            # Plugin 元数据
│       ├── skills/                # 3 个 Skill
│       │   ├── reverse-spec/SKILL.md
│       │   ├── reverse-spec-batch/SKILL.md
│       │   └── reverse-spec-diff/SKILL.md
│       ├── hooks/                 # 生命周期钩子
│       ├── scripts/               # postinstall 脚本
│       └── .mcp.json              # MCP Server 声明
├── src/
│   ├── core/                      # 核心分析流水线
│   │   ├── ast-analyzer.ts        # ts-morph AST → CodeSkeleton
│   │   ├── tree-sitter-fallback.ts # 容错降级
│   │   ├── context-assembler.ts   # 上下文组装（100k token 预算）
│   │   ├── secret-redactor.ts     # 敏感信息脱敏
│   │   ├── token-counter.ts       # Token 计数
│   │   ├── llm-client.ts          # Claude API 封装
│   │   └── single-spec-orchestrator.ts
│   ├── graph/                     # 依赖图谱
│   │   ├── dependency-graph.ts    # dependency-cruiser → DAG
│   │   ├── topological-sort.ts    # 拓扑排序 + SCC（Tarjan）
│   │   └── mermaid-renderer.ts
│   ├── diff/                      # 差异引擎
│   │   ├── structural-diff.ts     # CodeSkeleton 结构对比
│   │   ├── semantic-diff.ts       # LLM 语义评估
│   │   ├── noise-filter.ts        # 噪声过滤
│   │   └── drift-orchestrator.ts
│   ├── generator/                 # Spec 生成
│   │   ├── spec-renderer.ts       # Handlebars 9 段式模板
│   │   ├── frontmatter.ts         # YAML Frontmatter
│   │   ├── mermaid-class-diagram.ts
│   │   └── index-generator.ts     # _index.spec.md
│   ├── batch/                     # 批处理编排
│   │   ├── batch-orchestrator.ts  # 模块级编排
│   │   ├── progress-reporter.ts   # 细粒度进度报告
│   │   └── checkpoint.ts          # 断点持久化
│   ├── mcp/                       # MCP Server（009 新增）
│   │   ├── server.ts              # McpServer 工具注册
│   │   └── index.ts               # stdio 入口
│   ├── auth/                      # 认证模块（004 新增）
│   │   ├── auth-detector.ts       # 认证方式检测
│   │   └── cli-proxy.ts           # Claude CLI 子进程代理
│   ├── models/                    # 类型定义 + Zod Schema
│   └── utils/                     # 工具函数
├── templates/                     # Handlebars 模板
├── specs/                         # 生成的 Spec 输出目录
├── drift-logs/                    # 漂移检测报告
└── tests/                         # Vitest 测试
```

### 核心数据流

```
源代码 → AST 解析(ts-morph) → CodeSkeleton
  → 上下文组装(secret-redactor 脱敏, token 预算控制)
    → LLM Prompt → LLM 调用(API Key / CLI 代理)
      → 响应解析(容错章节匹配)
        → Handlebars 模板渲染 → specs/*.spec.md
```

### 关键设计决策

| 决策 | 选择 | 被拒绝方案 | 理由 | 来源 |
|------|------|-----------|------|------|
| AST 解析器 | ts-morph + tree-sitter | SWC | SWC 是 Rust，违反纯 Node.js 原则 | 001 |
| 模板引擎 | Handlebars | EJS | Handlebars partial 继承更适合 | 001 |
| 批量粒度 | 模块级聚合 | 文件级 | 文件级缺乏整体视角 | 005 |
| 认证代理 | CLI 子进程 spawn | 直接读取 OAuth token | Anthropic 限制 | 004 |
| 默认模型（batch） | 快速模型 | 慢速模型 | 慢速模型超时率过高 | 007 |
| 输出目录 | `specs/` | `.specs/` | 010 统一为无点前缀 | 008→010 |
| Plugin 架构 | Marketplace + plugin.json | 纯 npm CLI | Claude Code Plugin 标准 | 009 |
| MCP SDK | @modelcontextprotocol/sdk | 手动 JSON-RPC | 官方推荐，避免样板代码 | 009 |

---

## 8. 设计原则与决策记录

### 宪法原则（Constitution）

| # | 原则 | 说明 |
|---|------|------|
| I | **AST 精确性优先（不可协商）** | 所有结构数据来自 AST 提取，LLM 不推断接口签名 |
| II | **混合分析流水线** | 强制三阶段：预处理 → 上下文组装 → 生成增强 |
| III | **诚实标注不确定性** | `[推断]`/`[不明确]`/`[SYNTAX ERROR]` 三级标记 |
| IV | **只读安全性** | 仅写入 specs/ 和 drift-logs/，不修改源代码 |
| V | **纯 Node.js 生态** | 所有依赖为 npm 包（@modelcontextprotocol/sdk 有记录的偏差） |
| VI | **双语文档规范** | 中文正文 + 英文代码标识符 |

### Constitution 偏差记录

| 偏差 | 理由 | 替代方案被拒原因 |
|------|------|----------------|
| 新增 `@modelcontextprotocol/sdk` | MCP Server 是 Claude Code Plugin 核心集成方式 | 手动实现 JSON-RPC 增加大量样板代码且易出错 |

---

## 9. 已知限制与技术债

### 已知限制

| 来源 | 类别 | 描述 | 状态 |
|------|------|------|------|
| 001 | 限制 | AST 增强仅限 TS/JS，其他语言仅纯 LLM 降级 | 设计约束 |
| 001 | 限制 | 不支持代码生成或修改（严格只读） | 设计约束 |
| 001 | 限制 | 无 IDE 实时集成（推迟至路线图） | 未解决 |
| 001 | 限制 | 无自动化测试用例生成（推迟至路线图） | 未解决 |
| 004 | 限制 | 订阅认证仅支持 macOS 和 Linux | 设计约束 |
| 005 | 限制 | Batch 为串行处理，不支持并行 | 未解决 |
| 005 | 限制 | LLM 响应仅格式解析，不做语义验证 | 未解决 |
| 009 | 限制 | 无 Plugin 自动版本更新机制 | 未解决 |
| 009 | 限制 | 无 Plugin 签名或安全验证 | 未解决 |

### 技术债

| 来源 | 描述 | 风险 |
|------|------|------|
| 004 | Anthropic 可能限制 CLI 子进程间接调用（TOS 灰色地带） | 高 |
| 008→010 | 输出目录经历 specs/ → .specs/ → specs/ 变迁，文档可能有残留不一致 | 低 |
| [推断] | SKILL.md 中 bash 代码块在 Windows 需 WSL/Git Bash | 低 |

---

## 10. 假设与风险

### 关键假设

| 假设 | 来源 | 风险等级 |
|------|------|---------|
| 目标代码库主要为 TypeScript/JavaScript | 001 | 低 |
| Node.js LTS (20.x+) 可用于执行环境 | 001, 002 | 低 |
| ts-morph 为绝大多数 TS/JS 代码库提供足够解析能力 | 001 | 低 |
| Anthropic Claude API (Sonnet/Opus) 可用 | 001 | 中 |
| npm lifecycle scripts 在全局安装时正常执行 | 002 | 低 |
| Claude Code CLI 命令行参数和输出格式版本间稳定 | 004 | 中 |
| Anthropic 不封杀 CLI 子进程间接调用 | 004 | 高 |
| Claude Code Plugin 系统支持 plugin.json + skills/ + hooks/ + MCP | 009 | 中 |
| dependency-cruiser v16.x 异步 API 是稳定行为 | 005 | 低 |

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Anthropic 封杀 CLI 子进程调用 | 中 | 高 | 保留 API Key 作为主要认证方式 |
| LLM API 频繁超时/不可用 | 中 | 中 | AST-only 降级 + 断点恢复 |
| Claude Code Plugin 规范变更 | 低 | 中 | 保留 npm CLI 兼容 |
| 大型项目 token 超预算 | 低 | 低 | 分块摘要策略 + 骨架代码 |

---

## 11. 被废弃的功能

| 功能 | 原始描述 | 取代者 | 原因 |
|------|---------|--------|------|
| `.specs/` 默认输出目录 | 008 将输出目录改为 `.specs/` 隐藏目录 | 010: `specs/` | 010 统一所有引用回 `specs/` |
| 文件级批量处理 | 001 初始设计按文件逐个生成 Spec | 005: 模块级聚合 | 模块级聚合提供更好的整体视角 |
| 固定 120s LLM 超时 | 001 初始实现使用固定超时 | 007: 基于模型的动态超时 | 不同模型响应速度差异大 |
| `[LLM 未生成此段落]` 空标记 | 001 缺失章节用空标记填充 | 005: 带改善建议的占位内容 | 改善建议更有实用价值 |
| `reverse-spec init` 项目级 Skill 安装 | 003 通过 CLI 安装 Skill 到 `.claude/skills/` | 009: Plugin Marketplace 安装 | Plugin 标准安装机制取代 |
| npm postinstall Skill 自动注册 | 002 全局安装时注册 Skill 到 `~/.claude/skills/` | 009: Plugin hooks | Plugin 架构下的钩子机制 |

---

## 12. 变更历史

| # | Spec ID | 类型 | 日期 | 摘要 |
|---|---------|------|------|------|
| 1 | [001-reverse-spec-v2](../../001-reverse-spec-v2/spec.md) | INITIAL | 2026-02-10 | 核心能力建立：AST + LLM 混合流水线，3 个 Slash Commands，27 条 FR，9 段 Spec 结构 |
| 2 | [002-cli-global-distribution](../../002-cli-global-distribution/spec.md) | FEATURE | 2026-02-12 | 全局 CLI 分发：`npm install -g`，Skill 自动注册 |
| 3 | [003-skill-init](../../003-skill-init/spec.md) | FEATURE | 2026-02-10 | 项目级 Skill 安装：`reverse-spec init`，自包含降级策略 |
| 4 | [004-claude-sub-auth](../../004-claude-sub-auth/spec.md) | FEATURE | 2026-02-12 | Claude 订阅认证：CLI 子进程代理，双认证优先级 |
| 5 | [005-batch-quality-fixes](../../005-batch-quality-fixes/spec.md) | FIX | 2026-02-14 | Batch 模块级聚合、容错章节匹配、dependency-cruiser v16 兼容 |
| 6 | [006-batch-progress-timeout](../../006-batch-progress-timeout/spec.md) | ENHANCEMENT | 2026-02-14 | 细粒度进度报告、超时快速失败、AST-only 降级保底 |
| 7 | [007-fix-batch-llm-defaults](../../007-fix-batch-llm-defaults/spec.md) | FIX | 2026-02-14 | 切换默认模型、消除提示词重复、动态超时策略 |
| 8 | [008-fix-spec-absolute-paths](../../008-fix-spec-absolute-paths/spec.md) | FIX | 2026-02-14 | 绝对路径修复为相对路径，输出目录改 `.specs/` |
| 9 | [009-plugin-marketplace](../../009-plugin-marketplace/spec.md) | REFACTOR | 2026-02-14 | 重构为 Plugin Marketplace 架构，新增 MCP Server |
| 10 | [010-fix-dotspecs-to-specs](../../010-fix-dotspecs-to-specs/spec.md) | FIX | 2026-02-15 | 统一输出目录引用 `.specs` 回 `specs` |

---

## 13. 术语表

| 术语 | 定义 |
|------|------|
| **CodeSkeleton** | 源文件的 AST 提取中间表示——文件路径、导出符号（name、kind、signature、JSDoc）和依赖引用 |
| **DriftItem** | Spec 与代码之间的单个差异——严重级别（HIGH/MEDIUM/LOW）、类别（Interface/Behavior/Constraint） |
| **DependencyGraph** | 项目级模块导入关系映射——有向边、拓扑排序、SCC、Mermaid 源码 |
| **ModuleSpec** | 单模块生成规格文档——YAML frontmatter + 9 段中文章节 + Mermaid 图表 |
| **ArchitectureIndex** | 项目级概览文档（`_index.spec.md`）——系统用途、模块地图、横切关注点 |
| **DriftReport** | 漂移检测输出——摘要统计、新增/删除/修改表。写入 `drift-logs/` |
| **ModuleGroup** | 批量处理中属于同一目录的文件集合 |
| **SCC（强连通分量）** | 循环依赖的模块组，作为单一处理单元 |
| **三阶段流水线** | 预处理（AST）→ 上下文组装（Prompt）→ 生成增强（LLM + 模板） |
| **O(1) 上下文策略** | 高层模块读取已生成 Spec 而非源代码，避免上下文膨胀 |
| **Golden Master** | 预先验证的标准 Spec，用于自动化测试 |
| **Inline Fallback（内联降级）** | SKILL.md 中三级寻找策略：全局 CLI → npx → 安装提示 |
| **CLI Proxy（CLI 代理）** | 封装 Claude CLI 子进程 spawn 的代理层 |
| **Marketplace** | 仓库级 Plugin 集合声明（`.claude-plugin/marketplace.json`） |
| **Plugin** | 自包含的 Claude Code 扩展单元 |
| **MCP Server** | Model Context Protocol 工具服务（stdio 类型） |

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
