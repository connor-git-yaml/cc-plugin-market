<!--
  同步影响报告
  ==================
  版本变更：1.0.0 → 2.0.0（重大重构）
  修改的原则：
    - 原则 I-V 从项目级移入 Plugin: reverse-spec 分区
    - 原则 VI（双语文档规范）提升为项目级原则 I
  新增章节：
    - 项目级原则（从 reverse-spec 专属提升为全局适用）
    - Plugin: spec-driver 约束（新增 5 条原则）
    - 技术栈约束拆分为 per-plugin 表
  移除章节：N/A（内容迁移，无删除）
  需要更新的模板：
    - plugins/spec-driver/agents/constitution.md — 建议更新检查逻辑以识别 Plugin 分区
    - .specify/templates/constitution-template.md ✅ 无需更新（通用模板）
    - .specify/templates/plan-template.md ✅ 无需更新
    - .specify/templates/spec-template.md ✅ 无需更新
    - .specify/templates/tasks-template.md ✅ 无需更新
  后续 TODO：考虑更新 constitution 子代理 Prompt，使其在检查时识别功能所属 Plugin 并重点检查对应分区
-->

# reverse-spec 项目 Constitution

本 Constitution 是治理 reverse-spec 项目（含所有 Plugin）开发和输出的最高权威。

---

## 项目级原则（适用于所有开发）

### I. 双语文档规范

所有生成的文档必须使用中文撰写散文内容，并保留英文代码标识符。

- **中文**：所有描述、解释、分析、摘要、表格内容、注释
- **英文**：代码标识符（函数名、类名、变量名）、文件路径、类型签名、代码块
- **章节标题**：中文（如 `## 1. 意图`、`## 2. 接口定义`）
- **Frontmatter**：英文 YAML key 名称
- Commit message、PR 描述、代码注释默认使用中文

### II. Spec-Driven Development

所有需求变更和问题修复必须通过 Spec-Driven 流程执行，不允许直接修改源代码。

- 功能开发遵循：调研 → 规范 → 规划 → 任务 → 实现 → 验证 的标准流程
- 每个功能在 `specs/[feature]/` 下维护完整的制品链
- 设计文档（spec.md、plan.md、tasks.md）正文内容使用中文，技术术语保持英文

### III. 诚实标注不确定性

无法从代码或数据中确定性提取的信息必须显式标注。推断内容不得以确定性口吻呈现。

- 推测性意图必须带有 `[推断]` 或 `[INFERRED]` 标记
- 模糊或不可读代码必须带有 `[不明确]` 标记
- 每个标记必须附带简要理由说明

---

## Plugin: reverse-spec 约束

> 适用于 `plugins/reverse-spec/` 及 `src/` 下的 TypeScript 源代码开发。

### IV. AST 精确性优先（不可妥协）

所有结构化数据（接口签名、类型定义、导出符号、依赖关系）必须来源于静态分析（AST 解析）。
LLM 推理不得产生或捏造结构化数据。

- 接口定义必须与源代码保持 100% 一致，由 `ts-morph` 或等效 AST 工具提取
- 函数签名、类结构和类型别名必须直接从语法树节点读取
- LLM 仅负责填充自然语言段落，如"意图描述"和"业务逻辑解读"
- 任何违反此原则的输出视为缺陷，必须在发布前修正

### V. 混合分析流水线

所有代码分析必须遵循三阶段流水线：
预处理 → 上下文组装 → 生成与增强。
原始源代码不得直接输入给 LLM。

- **预处理**：AST 扫描提取 Skeleton Code（仅签名，不含实现细节）
- **上下文组装**：Prompt = Skeleton + 依赖数据 + 核心逻辑片段（仅限复杂函数）
- **生成与增强**：LLM 填充文本描述；工具链注入 Mermaid 图表
- 单文件分析上下文不得超过 100k tokens

### VI. 只读安全性

所有 reverse-spec 工具（`/reverse-spec`、`/reverse-spec-batch`、
`/reverse-spec-diff`）必须是纯只读操作。
不得修改目标源代码。

- 分析过程不得写入、删除或重命名源文件
- 写操作仅允许作用于 `specs/` 和 `drift-logs/` 目录
- 漂移报告必须在用户明确确认后才能触发任何 Spec 更新
- 必须遵守 `.gitignore` 规则；被忽略的文件不得被分析，除非用户明确覆盖

### VII. 纯 Node.js 生态

所有运行时依赖必须属于 npm 生态。
不得引入 Python、Rust 或其他非 Node.js 运行时。

- 核心库限定为：`ts-morph`（AST）、`dependency-cruiser`（依赖图）、
  `handlebars`/`ejs`（模板引擎）、`zod`（数据验证）
- 必须能在 Claude Code 沙箱或本地 Node.js 环境中无需额外配置即可运行
- 对于非 TS/JS 目标项目，优雅降级为纯文本 LLM 分析模式，不引入其他语言运行时
- 500 个文件的 AST 解析必须在 10 秒内完成

### reverse-spec 技术栈约束

| 类别 | 约束 |
|------|------|
| **运行时** | Node.js (LTS ≥ 20.x) |
| **语言** | TypeScript 5.x |
| **AST 引擎** | `ts-morph`（主力），`tree-sitter`（容错降级） |
| **依赖分析** | `dependency-cruiser` |
| **模板引擎** | `handlebars` 或 `ejs` |
| **数据验证** | `zod` |
| **MCP** | `@modelcontextprotocol/sdk` |
| **图表生成** | Mermaid（嵌入 Markdown） |
| **AI 模型** | Claude 4.5/4.6 Sonnet/Opus（通过 @anthropic-ai/sdk） |
| **目标代码** | 优先 TS/JS（AST 增强）；其他语言降级为纯 LLM 模式 |

---

## Plugin: spec-driver 约束

> 适用于 `plugins/spec-driver/` 下的 Markdown Prompt、YAML 配置和 Bash 脚本开发。

### VIII. Prompt 工程优先

所有编排行为通过 Markdown Prompt 和 YAML 配置实现。
子代理行为由 Prompt 文件定义，不依赖编程逻辑。

- 子代理（agents/*.md）是行为的唯一定义来源
- Skill 文件（skills/*/SKILL.md）定义用户触发入口和编排流程
- 行为变更通过修改 Prompt 文本实现，不引入运行时代码
- 模板（templates/*.md）定义输出结构，与 Prompt 逻辑分离

### IX. 零运行时依赖

spec-driver 插件不依赖任何 npm 包或外部运行时。
全部由 Markdown Prompt、YAML 配置和 Bash 辅助脚本构成。

- 不允许引入 Node.js 模块、Python 脚本或其他需要安装的依赖
- Bash 脚本仅用于辅助功能（项目初始化、元信息扫描等），不承载核心编排逻辑
- 必须在任何安装了 Claude Code 的环境中开箱即用

### X. 质量门控不可绕过

每个编排流程必须包含质量门（Quality Gate），确保阶段产出满足质量要求后才推进。

- 质量门至少覆盖：设计门（GATE_DESIGN）、任务门（GATE_TASKS）、验证门（GATE_VERIFY）
- 关键质量门在 feature 模式下必须暂停等待用户确认
- 设计硬门禁（GATE_DESIGN）在 feature 模式下不可被任何策略或配置绕过
- 质量门决策必须输出格式化日志，包含门禁名称、策略、结果和原因

### XI. 验证铁律

实现子代理不得在没有实际验证证据的情况下声称任务完成。

- 完成声明必须附带当前执行上下文中实际运行的验证命令输出
- 推测性表述（"should pass""looks correct"）不可作为完成依据
- 验证子代理必须对验证证据进行二次核查
- 项目未配置验证命令时，允许完成但标注"无可用验证工具"

### XII. 向后兼容

配置文件和流程变更不得破坏现有用户的体验。

- 未配置新字段时，所有行为必须与变更前一致
- 遵循"约定优于配置"——用户只需修改一个配置项即可切换全局行为
- 无法识别的配置字段或值输出警告但不阻断流程
- 新增能力必须在现有架构内实现，不引入新的运行时依赖

### spec-driver 技术栈约束

| 类别 | 约束 |
|------|------|
| **Prompt 语言** | Markdown（子代理、Skill、模板） |
| **配置格式** | YAML（driver-config.yaml） |
| **辅助脚本** | Bash 5.x |
| **运行环境** | Claude Code 沙箱 |
| **AI 模型** | Claude 4.5/4.6 Sonnet/Opus（通过 Claude Code 原生调用） |
| **运行时依赖** | 无（零依赖） |

---

## 质量标准

### 输出质量门控（reverse-spec）

每份生成的 Spec 在发布前必须通过以下自检项：

- [ ] 所有公开接口已文档化
- [ ] 没有缺少理由说明的 `[推断]` 标记
- [ ] 所有技术债务项已标注严重程度
- [ ] 边界条件表非空
- [ ] 文件清单与实际分析的文件集合一致
- [ ] Frontmatter 的 `related_files` 字段准确
- [ ] 所有 Spec 遵循 9 节结构：意图、接口定义、业务逻辑、数据结构、约束条件、边界条件、技术债务、测试覆盖、依赖关系

### 输出质量门控（spec-driver）

每次编排流程完成前必须通过以下自检项：

- [ ] 制品链完整（spec.md → plan.md → tasks.md → verification/）
- [ ] 所有质量门已执行且有记录
- [ ] 验证阶段包含实际运行的命令输出（非推测性声明）
- [ ] 配置变更向后兼容（未配置新字段时行为不变）

### 大规模代码库处理（reverse-spec）

- 超过 50 个文件或 5,000 行代码的目标必须启用增量模式
- 批量处理必须按依赖拓扑排序
  （Level 0 基础层 → Level N 业务层）
- 处理 Level N 模块时，读取 Level 0 Spec 的接口定义而非源代码（O(1) 上下文复杂度）
- 循环依赖必须作为强连通分量（SCC）处理，视为单一模块
- 超过 5,000 行代码的文件必须触发分块摘要策略

---

## 治理规则

- 本 Constitution 是治理所有 Plugin 开发和输出的最高权威
- 对核心原则的任何修改必须记录在案、升级版本号，并附带影响评估
- 版本号遵循语义化版本：MAJOR（原则移除或重新定义、结构重组）、MINOR（新增原则或扩展）、
  PATCH（措辞或澄清）
- 所有 PR 和代码审查必须验证是否符合本 Constitution
- 复杂度偏差必须在计划文档的复杂度追踪章节中给出理由
- Constitution 检查子代理应根据功能所属 Plugin 重点检查对应分区的原则，项目级原则始终检查

**版本**：2.0.0 | **批准日期**：2026-02-10 | **最后修订**：2026-02-27
