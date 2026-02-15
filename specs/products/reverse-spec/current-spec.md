# reverse-spec -- 产品级活规范

**最后更新**: 2026-02-15
**聚合来源**: 10 个增量功能规范
**当前版本**: 基于 specs/010-fix-dotspecs-to-specs 为止的全部已实现功能

> 本文档由 Speckit Driver Pro 的 sync 子代理自动生成，反映产品的当前完整状态。
> 增量功能规范保留在 `specs/NNN-xxx/` 目录中作为决策历史记录。

---

## 产品概述

reverse-spec 是一套基于 AST 静态分析 + LLM 混合流水线的代码逆向工程工具，能够将遗留源代码自动转化为结构化、机器可读的 Spec 文档。项目经过 009 重构后，已从独立 CLI 工具演进为 **Claude Code Plugin Marketplace 架构**下的首个 Plugin，同时保留 npm CLI 的独立使用能力。

**定位**: Claude Code Plugin Marketplace 中的代码逆向文档化 Plugin，同时可作为独立 npm CLI 工具使用

**目标用户**: 面对无文档或文档过时的 TypeScript/JavaScript 代码库的开发者、技术负责人和团队

**核心价值**: 通过 AST 精确提取 + LLM 语义理解的混合流水线，零人工干预地将源代码逆向生成高质量、结构化的 Spec 文档，实现 Spec 驱动开发（SDD）的闭环工作流

---

## 当前功能全集

### 功能总览

| 编号 | 功能 | 来源 spec | 状态 | 说明 |
|------|------|----------|------|------|
| F-001 | 混合分析流水线（三阶段） | 001 | ✅ 活跃 | AST 预处理 -> 上下文组装 -> LLM 生成与增强，保证结构准确性 |
| F-002 | 单模块 Spec 生成 | 001 | 🔄 已更新 | `/reverse-spec` 命令，9 节结构化 Spec + Mermaid 图表（005 增强生成质量、007 修复 LLM 默认配置、008 修复路径问题、010 统一输出目录） |
| F-003 | 批量项目 Spec 生成 | 001 | 🔄 已更新 | `/reverse-spec-batch` 命令，模块级聚合 + 拓扑排序 + 断点恢复（005 重构为模块级聚合、006 增加进度报告和超时优化、007 修复 LLM 默认配置） |
| F-004 | Spec 漂移检测 | 001 | ✅ 活跃 | `/reverse-spec-diff` 命令，结构化差异比较 + LLM 语义评估 |
| F-005 | 依赖图与拓扑处理 | 001 | 🔄 已更新 | dependency-cruiser 构建有向图，支持 SCC 检测和 Mermaid 输出（005 修复 v16.x 异步兼容性） |
| F-006 | 结构化差异引擎 | 001 | ✅ 活跃 | CodeSkeleton 快照对比，按严重级别和类别分类 |
| F-007 | Spec 输出格式与模板系统 | 001 | 🔄 已更新 | Handlebars 模板渲染 9 节结构、YAML frontmatter、Mermaid 图表（005 增强容错匹配、008 修复路径为相对路径） |
| F-008 | CLI 全局分发 | 002 | 🔄 已更新 | `npm install -g reverse-spec` 全局安装，`generate/batch/diff` 子命令（009 架构下保留为 MCP Server 后端） |
| F-009 | 项目级 Skill 初始化 | 003 | ❌ 已废弃 | `reverse-spec init` 安装 Skill 到 `.claude/skills/`（被 009 Plugin 安装机制取代） |
| F-010 | Claude 订阅账号认证 | 004 | ✅ 活跃 | 支持 Claude Code CLI 子进程代理 LLM 调用，兼容订阅用户无需 API Key |
| F-011 | 模块级聚合与生成质量提升 | 005 | ✅ 活跃（已合入 F-003/F-007） | batch 按目录聚合、容错章节匹配、dependency-cruiser v16.x 兼容 |
| F-012 | 批量生成进度报告与超时优化 | 006 | ✅ 活跃（已合入 F-003） | 模块内 6 阶段进度报告、超时快速失败、AST-only 降级保底 |
| F-013 | Plugin Marketplace 架构 | 009 | ✅ 活跃 | 项目重构为 Marketplace，reverse-spec 封装为标准 Claude Code Plugin |
| F-014 | MCP Server | 009 | ✅ 活跃 | `mcp-server` 子命令暴露 prepare/generate/batch/diff 四个 MCP 工具 |

### 详细功能描述

#### F-001: 混合分析流水线（三阶段）

**来源**: specs/001-reverse-spec-v2/spec.md
**状态**: ✅ 活跃

驱动所有用户命令的核心引擎，遵循严格的三阶段流水线：

1. **预处理阶段**: 使用 `ts-morph` 解析 AST，提取仅包含导出签名（不含实现细节）的 CodeSkeleton。当遇到语法错误时，回退到 `tree-sitter` 容错模式
2. **上下文组装阶段**: 从骨架 + 依赖数据 + 核心逻辑片段组合 LLM 提示，将总上下文控制在 100k token 以内。组装前自动检测并脱敏常见密钥模式
3. **生成与增强阶段**: LLM 填充自然语言描述，工具链注入 Mermaid 图表

**当前行为**:
- AST 解析和骨架提取：500 个文件可在 10 秒内完成（SC-003）
- 超过 5,000 行的文件触发分块摘要策略
- 系统提示词在整个调用链路中只出现一次（007 修复）
- 根据所选 LLM 模型自动调整超时时间（007 修复）

**验收标准**:
- 提取的 CodeSkeleton 包含正确的 name、kind、signature 和 JSDoc 字段，零实现细节
- 组装的提示包含全部函数骨架但仅包含复杂函数的完整代码片段，总 token 数 <= 100k
- 输出中的所有接口定义与 AST 提取的骨架完全匹配（LLM 不修改签名）
- 语法错误文件回退到 tree-sitter 容错模式，受影响符号标注 `[SYNTAX ERROR]`

---

#### F-002: 单模块 Spec 生成（/reverse-spec）

**来源**: specs/001-reverse-spec-v2/spec.md（005/007/008/010 更新）
**状态**: 🔄 已更新

通过 `/reverse-spec <target>` 或 `reverse-spec generate <target>` 命令，对指定文件或目录执行单模块 Spec 生成。输出为包含 YAML frontmatter 和 9 个中文必填章节的结构化 Markdown 文档。

**当前行为**:
- 输出 9 节结构：意图、接口定义、业务逻辑、数据结构、约束条件、边界条件、技术债务、测试覆盖、依赖关系
- 包含嵌入的 Mermaid 类图和依赖关系图（005 增加了依赖图）
- YAML frontmatter 包含 type、version（递增计数器）、generator、sourceTarget、relatedFiles、confidence、lastUpdated
- 不确定或推断内容标注 `[推断]`、`[不明确]` 或 `[SYNTAX ERROR]`
- 章节标题匹配支持中英文变体和大小写/标点容错（005 修复）
- 缺失章节用带改善建议的占位内容填充，而非空标记（005 修复）
- sourceTarget 和标题使用相对于项目根目录的路径（008 修复）
- Mermaid 图和 baseline skeleton 中的路径均为相对路径（008 修复）
- 默认输出目录为 `specs/`（010 统一，原 008 曾改为 `.specs/`，后被 010 修正）
- batch 场景默认使用快速模型，单文件 generate 亦消除提示词重复（007 修复）

**验收标准**:
- 生成的 Spec 包含全部 9 个必填章节，每个公共接口准确来源于 AST 提取（零 LLM 捏造签名）
- 目标目录中没有任何源文件被修改、创建或删除（只读保证）
- 所有路径信息使用相对路径，不暴露本机绝对路径

---

#### F-003: 批量项目 Spec 生成（/reverse-spec-batch）

**来源**: specs/001-reverse-spec-v2/spec.md（005/006/007 更新）
**状态**: 🔄 已更新

通过 `/reverse-spec-batch` 或 `reverse-spec batch` 命令，系统性地文档化整个代码库。005 将原有文件级处理重构为**模块级聚合**，006 增加了细粒度进度报告和超时优化，007 修复了默认 LLM 配置。

**当前行为**:
- 文件按目录聚合为模块（如 `src/auth/` 下所有文件归入 `auth` 模块），支持自定义 basePrefix、depth、rootModuleName（005 新增）
- 按模块级拓扑顺序处理（基础模块优先），循环依赖作为 SCC 组合处理
- 高层模块读取已生成 Spec 的接口定义（O(1) 上下文策略）
- 支持断点恢复：检测已有 Spec 并跳过（`--force` 强制重新生成）
- 生成架构索引 `specs/_index.spec.md`，使用实际收集的 ModuleSpec 数据（005 修复）
- **模块内细粒度进度报告**（006 新增）：6 个阶段（文件扫描、AST 分析、上下文组装、LLM 调用、响应解析、渲染写入），每阶段输出耗时
- 重试信息可见：显示重试次数和原因（006 新增）
- **超时快速失败策略**（006 新增）：超时类错误最多重试 1 次（而非默认 3 次），大幅缩短最坏等待时间（从 ~18 分钟降至 <= 5 分钟）
- **AST-only 降级保底**（006 新增）：LLM 超时或不可用时自动降级为 AST-only 输出，保证每个模块至少有基础 Spec
- 上下文 token 超阈值时在 LLM 调用前输出警告（006 新增）
- 速率限制等待退避时进度提示（006 新增）
- 默认使用快速模型，确保常规模块不超时；支持环境变量覆盖模型并自动适配超时（007 修复）
- 系统提示词在整个调用链路中只出现一次（007 修复）

**验收标准**:
- batch 生成的 spec 数量与项目中的目录模块数一致（而非文件数）
- 9 个章节完整率达到 95% 以上
- 每个模块在 batch 完成后至少有 AST-only 级别的 Spec 输出，不存在完全无产出的模块
- 使用默认配置时模块 LLM 调用成功率达到 95% 以上
- 用户能根据进度信息区分"正常处理中"与"卡住/超时"两种状态

---

#### F-004: Spec 漂移检测（/reverse-spec-diff）

**来源**: specs/001-reverse-spec-v2/spec.md
**状态**: ✅ 活跃

通过 `/reverse-spec-diff <spec-file> <source>` 或 `reverse-spec diff` 命令，检查 Spec 文档是否仍然反映当前代码。

**当前行为**:
- AST 重新分析当前代码，对导出符号执行结构化差异比较（新增/删除/修改）
- 差异按严重级别分类：HIGH（破坏性删除）、MEDIUM（逻辑/签名变更）、LOW（新增）
- 差异按类别分类：Interface、Behavior、Constraint
- 行为变更（函数体逻辑）委托 LLM 语义评估
- 过滤噪声（空白、注释、import 重新排序）
- 生成分类漂移报告，写入 `drift-logs/` 目录
- 未经用户明确确认不修改任何 Spec 文件

**验收标准**:
- 正确识别 95% 以上的签名级变更
- 所有噪声均被过滤，零误报
- 用户未确认前不修改任何 Spec

---

#### F-005: 依赖图与拓扑处理

**来源**: specs/001-reverse-spec-v2/spec.md（005 更新）
**状态**: 🔄 已更新

通过 `dependency-cruiser` 扫描项目 import 语句构建模块依赖图。

**当前行为**:
- 构建有向图，识别强连通分量（循环依赖），计算拓扑排序处理顺序
- 生成 JSON 结构和 Mermaid 图表源码
- `buildGraph()` 兼容 dependency-cruiser 同步和异步 API（v15.x 和 v16.x）（005 修复）
- cruise 返回空结果时返回空 DependencyGraph 而非崩溃（005 修复）
- `buildGraph()` 在目标项目目录下执行 cruise，异常时恢复原工作目录（005 修复）

---

#### F-006: 结构化差异引擎

**来源**: specs/001-reverse-spec-v2/spec.md
**状态**: ✅ 活跃

比较同一模块在不同时间点的两个 CodeSkeleton 快照。识别新增、删除和修改的导出符号，按严重级别（HIGH/MEDIUM/LOW）和类别（Interface/Behavior/Constraint）分类。过滤噪声，对行为变更委托 LLM 语义评估。

---

#### F-007: Spec 输出格式与模板系统

**来源**: specs/001-reverse-spec-v2/spec.md（005/008 更新）
**状态**: 🔄 已更新

**当前行为**:
- YAML frontmatter：type、version（递增计数器 v1/v2/v3...）、generator、sourceTarget（相对路径）、relatedFiles、confidence、lastUpdated
- 9 个中文必填章节：意图、接口定义、业务逻辑、数据结构、约束条件、边界条件、技术债务、测试覆盖、依赖关系
- 嵌入 Mermaid 类图和依赖关系图，节点标签使用相对路径
- 文件清单附录
- 章节标题容错匹配：支持中英文变体、大小写、标点差异（005 增强）
- 缺失章节用带改善建议的占位内容填充（005 增强）
- baseline skeleton 中的 filePath 使用相对路径（008 修复）

---

#### F-008: CLI 全局分发

**来源**: specs/002-cli-global-distribution/spec.md（009 更新）
**状态**: 🔄 已更新

`reverse-spec` npm CLI 命令，支持 `generate`、`batch`、`diff`、`mcp-server`、`auth-status` 子命令。

**当前行为**:
- `npm install -g reverse-spec` 全局安装
- `reverse-spec generate <target> [--deep]` 单模块 Spec 生成
- `reverse-spec batch [--force]` 批量 Spec 生成
- `reverse-spec diff <spec-file> <source>` 漂移检测
- `reverse-spec mcp-server` 启动 MCP stdio server（009 新增）
- `reverse-spec auth-status [--verify]` 认证状态诊断（004 新增）
- `reverse-spec --version`、`reverse-spec --help`
- 支持 `--output-dir` 覆盖默认输出目录
- 在 009 架构下，CLI 同时作为 MCP Server 后端存在

---

#### F-010: Claude 订阅账号认证

**来源**: specs/004-claude-sub-auth/spec.md
**状态**: ✅ 活跃

支持 Claude Max/Pro 订阅用户无需单独设置 `ANTHROPIC_API_KEY` 即可使用所有 LLM 功能。

**当前行为**:
- 双认证方式：(1) `ANTHROPIC_API_KEY` 环境变量直接调用 SDK，(2) spawn Claude Code CLI 子进程间接调用
- 优先级：ANTHROPIC_API_KEY > Claude CLI 子进程
- `auth-status` 子命令检测当前环境可用的认证方式，支持 `--verify` 在线验证
- CLI 子进程超时 120 秒，错误处理与 SDK 调用一致
- batch 模式下限制并发 CLI 子进程数量
- 仅支持 macOS 和 Linux

**验收标准**:
- 已登录 Claude Code 的订阅用户在未设置 API Key 时可直接使用，成功率 >= 95%
- CLI 代理延迟不超过 API Key 方式的 2 倍
- 通过 CLI 代理生成的 Spec 与 API Key 方式格式和质量完全一致

---

#### F-013: Plugin Marketplace 架构

**来源**: specs/009-plugin-marketplace/spec.md
**状态**: ✅ 活跃

项目重构为 Claude Code Plugin Marketplace，reverse-spec 封装为首个标准 Plugin。

**当前行为**:
- 仓库根目录包含 `.claude-plugin/marketplace.json`，声明 marketplace 元数据和 plugins 数组
- 所有 plugin 源码组织在 `plugins/<plugin-name>/` 子目录下
- reverse-spec plugin 目录结构：
  - `plugins/reverse-spec/plugin.json` -- Plugin 声明文件（name、version、skills、hooks、mcpServers）
  - `plugins/reverse-spec/skills/` -- 三个 Skill SKILL.md 文件
  - `plugins/reverse-spec/hooks/` -- postinstall/preuninstall 生命周期钩子
- Plugin 的 Skill 使用内联降级逻辑寻找 CLI：全局 CLI -> npx -> 安装提示
- postinstall hook 在安装时完成必要初始化
- 用户可通过标准 marketplace 安装流程：添加 marketplace 源 -> 安装 plugin

**验收标准**:
- `.claude-plugin/marketplace.json` 可被 Claude Code 识别为 marketplace 源
- `plugin.json` 通过 Claude Code 验证，包含完整声明
- 三个 Skill 功能在 plugin 架构下完全等价
- 现有 npm CLI 命令在重构后仍然正常工作

---

#### F-014: MCP Server

**来源**: specs/009-plugin-marketplace/spec.md
**状态**: ✅ 活跃

通过 `reverse-spec mcp-server` 子命令启动 MCP（Model Context Protocol）stdio server，让 AI 助手以程序化方式调用工具。

**当前行为**:
- stdio 类型 MCP server，通过 stdin/stdout 使用 JSON-RPC 协议通信
- 暴露四个工具：`prepare`（AST 骨架提取）、`generate`（单模块 Spec 生成）、`batch`（批量生成）、`diff`（漂移检测）
- 每个工具包含符合 JSON Schema 的 inputSchema
- plugin.json 中 mcpServers 声明指向 `npx reverse-spec mcp-server`

---

## 当前技术架构

> 以 009 重构后的 Plugin Marketplace 架构为准。

**技术栈**:
- TypeScript 5.7.3, Node.js LTS (>= 20.x)
- `ts-morph` -- AST 解析（主解析器）
- `tree-sitter` + `tree-sitter-typescript` -- 容错降级解析器
- `dependency-cruiser` -- 依赖图构建（兼容 v15.x/v16.x）
- `handlebars` -- 模板渲染
- `zod` -- Schema 验证
- `@anthropic-ai/sdk` -- LLM API 调用（直接 SDK 方式）
- `@modelcontextprotocol/sdk` -- MCP Server 实现（009 新增）
- Node.js 内置模块：`fs`、`path`、`os`、`url`、`child_process`

**项目结构**:

```text
reverse-spec/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace 声明
├── plugins/
│   └── reverse-spec/
│       ├── plugin.json           # Plugin 声明
│       ├── skills/
│       │   ├── reverse-spec/SKILL.md
│       │   ├── reverse-spec-batch/SKILL.md
│       │   └── reverse-spec-diff/SKILL.md
│       └── hooks/
│           ├── postinstall.*
│           └── preuninstall.*
├── src/
│   ├── core/
│   │   ├── ast-analyzer.ts       # AST 解析与 CodeSkeleton 提取
│   │   ├── context-assembler.ts  # 上下文组装（100k token 预算）
│   │   ├── spec-generator.ts     # LLM 生成与增强
│   │   └── diff-engine.ts        # 结构化差异引擎
│   ├── batch/
│   │   ├── dependency-graph.ts   # 依赖图构建（dependency-cruiser）
│   │   ├── module-grouper.ts     # 文件到模块级聚合
│   │   └── batch-orchestrator.ts # 批量编排与断点恢复
│   ├── cli/
│   │   └── index.ts              # CLI 入口（generate/batch/diff/mcp-server/auth-status）
│   ├── mcp/
│   │   └── server.ts             # MCP stdio server
│   ├── auth/
│   │   ├── auth-detector.ts      # 认证方式检测
│   │   └── cli-proxy.ts          # Claude CLI 子进程代理
│   └── templates/
│       └── spec.hbs              # Handlebars 模板
├── specs/                        # 生成的 Spec 输出目录
├── drift-logs/                   # 漂移检测报告输出
├── tests/
└── package.json
```

**关键设计决策**:
- **AST 准确性优先**：接口签名等结构化数据由 AST 提取，LLM 仅负责语义描述，保证零捏造签名（来源: specs/001-reverse-spec-v2）
- **三阶段混合流水线**：预处理 -> 上下文组装 -> 生成与增强，将 AST 精确性和 LLM 语义理解结合（来源: specs/001-reverse-spec-v2）
- **O(1) 上下文策略**：高层模块读取已生成 Spec 的接口定义而非源代码，控制上下文增长（来源: specs/001-reverse-spec-v2）
- **模块级聚合**：batch 按目录聚合文件为模块，取代原有的文件级处理（来源: specs/005-batch-quality-fixes）
- **CLI 子进程代理方案**：通过 spawn Claude Code CLI 实现订阅认证，绕过 OAuth token 的 Anthropic 限制（来源: specs/004-claude-sub-auth）
- **Plugin Marketplace 架构**：从独立 CLI 工具重构为标准 Claude Code Plugin，Skills + MCP Server 双通道暴露能力（来源: specs/009-plugin-marketplace）
- **快速模型作为默认**：batch 场景使用速度更快的模型，支持环境变量覆盖（来源: specs/007-fix-batch-llm-defaults）
- **输出目录为 specs/**：从 `.specs/` 修正回 `specs/`，保持直观可见（来源: specs/010-fix-dotspecs-to-specs，修正 008 的决策）

---

## 已知限制与技术债

| 来源 spec | 类别 | 描述 | 状态 |
|----------|------|------|------|
| 001 | 限制 | AST 增强分析仅限 TypeScript/JavaScript，其他语言仅纯 LLM 降级分析 | 未解决 |
| 001 | 限制 | 不支持代码生成或修改（严格只读和分析） | 设计约束 |
| 001 | 限制 | 无 IDE 实时集成（VS Code 实时漂移显示推迟到路线图 v2.2） | 未解决 |
| 001 | 限制 | 无自动化测试用例生成（推迟到路线图 v2.1） | 未解决 |
| 004 | 限制 | Claude 订阅认证仅支持 macOS 和 Linux，Windows 明确排除 | 设计约束 |
| 004 | 技术债 | Anthropic 可能限制通过 spawn CLI 子进程方式的间接调用（TOS 灰色地带） | 风险项 |
| 005 | 限制 | batch 命令为串行处理，不支持并行 | 未解决 |
| 005 | 限制 | LLM 响应仅做格式解析，不做语义验证 | 未解决 |
| 003 | 技术债 | SKILL.md 中的 bash 代码块在 Windows 环境需 WSL 或 Git Bash | 未解决 |
| 009 | 限制 | 尚未实现 plugin 自动版本更新机制 | 未解决 |
| 009 | 限制 | 尚未实现 plugin 签名或安全验证 | 未解决 |
| 009 | 限制 | marketplace 仓库不可达时无离线缓存机制 | 未解决 |

---

## 被废弃的功能

> 以下功能已被后续迭代取代或移除。

| 原功能 | 原始 spec | 废弃原因 | 取代者 |
|--------|----------|---------|--------|
| Skill 自动注册到 `~/.claude/skills/`（npm postinstall 方式） | 002 | 009 重构为 Plugin Marketplace 架构，Skill 迁移到 plugin 目录内 | 009 的 Plugin hooks 和 `plugins/reverse-spec/skills/` |
| `reverse-spec init` 项目级 Skill 安装 | 003 | 009 重构为标准 Plugin 安装流程 | 009 的 Marketplace 安装机制（`/plugin marketplace add` + `/plugin install`） |
| `reverse-spec init --global` 全局 Skill 安装 | 003 | 同上，被 Plugin 安装取代 | 009 的 Marketplace 安装 |
| `reverse-spec init --remove` Skill 移除 | 003 | 同上，被 Plugin 卸载取代 | 009 的 Plugin hooks（preuninstall） |
| 文件级 batch 处理（每文件一个 Spec） | 001（原始设计） | 粒度过细，缺乏模块级整体视角 | 005 的模块级聚合（按目录聚合文件为模块） |
| 默认输出目录 `.specs/`（点前缀隐藏目录） | 008 | 不直观，与社区惯例不一致 | 010 统一回 `specs/` |

---

## 变更历史

| 编号 | 功能 spec | 类型 | 日期 | 摘要 |
|------|----------|------|------|------|
| 001 | 001-reverse-spec-v2 | INITIAL | 2026-02-10 | 定义产品核心：AST+LLM 混合流水线、单模块生成、批量处理、漂移检测、9 节 Spec 结构 |
| 002 | 002-cli-global-distribution | FEATURE | 2026-02-12 | 新增 CLI 全局分发（`npm install -g`）和 Skill 自动注册到 `~/.claude/skills/` |
| 003 | 003-skill-init | FEATURE | 2026-02-10 | 新增 `reverse-spec init` 项目级 Skill 安装和自包含 Skill 架构（内联降级逻辑） |
| 004 | 004-claude-sub-auth | FEATURE | 2026-02-12 | 新增 Claude 订阅账号认证支持，通过 spawn CLI 子进程代理 LLM 调用 |
| 005 | 005-batch-quality-fixes | FIX | 2026-02-14 | 修复 batch 为模块级聚合、增强 Spec 生成质量（容错匹配、增强提示词）、修复 dependency-cruiser v16.x 兼容性 |
| 006 | 006-batch-progress-timeout | ENHANCEMENT | 2026-02-14 | 增强批量生成体验：模块内 6 阶段进度报告、超时快速失败策略、AST-only 降级保底 |
| 007 | 007-fix-batch-llm-defaults | FIX | 2026-02-14 | 修复 batch LLM 默认配置：切换默认模型、消除提示词重复注入、实现基于模型的动态超时 |
| 008 | 008-fix-spec-absolute-paths | FIX | 2026-02-14 | 修复 Spec 输出中的绝对路径问题，改为相对路径；将默认输出目录从 `specs` 改为 `.specs` |
| 009 | 009-plugin-marketplace | REFACTOR | 2026-02-14 | 重构为 Claude Code Plugin Marketplace 架构，新增 MCP Server，将 Skill 和安装逻辑迁移为 Plugin 组件 |
| 010 | 010-fix-dotspecs-to-specs | FIX | 2026-02-15 | 统一 spec 输出目录引用从 `.specs` 回 `specs`，覆盖源代码、CLI、SKILL.md、文档 |

---

## 附录：增量 spec 索引

| spec | 标题 | 类型 | 关键变更 |
|------|------|------|---------|
| [001-reverse-spec-v2](../../001-reverse-spec-v2/spec.md) | Reverse-Spec Skill System v2.0 | INITIAL | 定义产品核心——三阶段混合流水线、7 个 User Story、27 个功能需求 |
| [002-cli-global-distribution](../../002-cli-global-distribution/spec.md) | CLI 全局分发与 Skill 自动注册 | FEATURE | 新增 npm 全局安装 CLI 和 postinstall Skill 注册（部分被 009 取代） |
| [003-skill-init](../../003-skill-init/spec.md) | 项目级 Skill 初始化与自包含 Skill 架构 | FEATURE | 新增 `reverse-spec init` 和内联降级逻辑（被 009 取代） |
| [004-claude-sub-auth](../../004-claude-sub-auth/spec.md) | Claude 订阅账号认证支持 | FEATURE | 新增 CLI 子进程代理 LLM 调用，支持订阅用户无 API Key 使用 |
| [005-batch-quality-fixes](../../005-batch-quality-fixes/spec.md) | Batch 模块级聚合与生成质量提升 | FIX | batch 重构为模块级聚合、容错章节匹配、dependency-cruiser v16.x 兼容 |
| [006-batch-progress-timeout](../../006-batch-progress-timeout/spec.md) | 批量 Spec 生成体验优化 | ENHANCEMENT | 模块内进度报告、超时快速失败、AST-only 降级保底 |
| [007-fix-batch-llm-defaults](../../007-fix-batch-llm-defaults/spec.md) | 修复 Batch LLM 调用默认配置 | FIX | 切换默认模型、消除提示词重复、动态超时策略 |
| [008-fix-spec-absolute-paths](../../008-fix-spec-absolute-paths/spec.md) | 修复 Spec 输出中的绝对路径问题 | FIX | sourceTarget/标题/Mermaid/baseline 全部改为相对路径，输出目录改 `.specs` |
| [009-plugin-marketplace](../../009-plugin-marketplace/spec.md) | 重构为 Claude Code Plugin Marketplace 架构 | REFACTOR | 项目重构为 Marketplace + Plugin，新增 MCP Server，Skill/安装逻辑迁移 |
| [010-fix-dotspecs-to-specs](../../010-fix-dotspecs-to-specs/spec.md) | 统一 spec 输出目录引用（.specs -> specs） | FIX | 全量同步 `.specs` 回 `specs`，覆盖源代码、CLI、SKILL.md、文档 |
