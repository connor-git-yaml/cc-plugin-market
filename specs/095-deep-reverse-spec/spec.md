# Feature Specification: 深度代码反求增强

**Feature Branch**: `095-deep-reverse-spec`
**Created**: 2026-04-11
**Status**: Draft
**Input**: 增强 reverse-spec 的 spec 生成管线，从"AST 骨架 + 外部元数据填充"升级为"AST 骨架 + LLM 语义桥接"，使生成的文档能真正从代码反推规范

---

## 用户场景与测试方案

### User Story 1 - 消除核心章节空壳（Priority: P1）

作为使用 reverse-spec 对第三方代码库生成文档的开发者，我希望 spec 的"接口定义"和"业务逻辑"章节能包含从代码中反推的实质内容（函数职责、算法摘要、数据流描述），而不是留白的"此章节待补充"占位符。

**优先级理由**：这是当前最严重的质量缺陷——spec 的两个最核心章节完全空白，导致文档对读者毫无价值。在 graphify 的对比实验中，LLM 深度分析产出了 1.2 万字的实质内容，而 AST-only 模式的同一章节是占位符。消除空壳是 MVP 的核心交付。

**独立测试方案**：对 graphify 项目执行 `reverse-spec generate`，检查生成的 `graphify.spec.md` 的 Section 2（接口定义）和 Section 3（业务逻辑）是否包含具体的函数描述、数据流和算法摘要，而非"待补充"占位符。

**验收场景**：

1. **Given** 目标项目含 20 个 Python 源文件，**When** 执行 `reverse-spec generate`，**Then** Section 2（接口定义）包含至少 5 个关键函数/类的职责描述（含参数和返回值语义）
2. **Given** 目标项目的核心模块包含管线式调用链（如 detect→extract→build），**When** 执行 `reverse-spec generate`，**Then** Section 3（业务逻辑）包含数据流叙事，描述各阶段的输入/输出和处理逻辑
3. **Given** 目标模块的 AST 骨架仅包含函数签名（非 deep 模式），**When** 生成 spec，**Then** 系统自动提取函数体的关键切片（控制流骨架 + 核心调用链），作为 LLM 上下文供语义理解
4. **Given** 生成的接口定义和业务逻辑章节，**When** 与源码对照，**Then** 每个断言可追溯到具体的源文件和函数名，无捏造内容

---

### User Story 2 - 智能目录分类与排除（Priority: P2）

作为对混合项目执行 batch 生成的开发者，我希望系统能自动识别并排除非功能性目录（示例代码、第三方打包产物、vendor 依赖、测试 fixture），只对真正的源码模块生成 spec。

**优先级理由**：模块误判导致 architecture-narrative 中 60% 的"关键类"来自示例代码（graphify 的 worked/ 目录），claude-obsidian 的核心 Skills 完全未被分析而分析了第三方 calendar 插件 bundle。正确的模块边界是所有其他改进的前提。

**独立测试方案**：对 graphify 项目执行 `reverse-spec batch`，验证 `worked/` 目录不被当作核心模块分析；对 claude-obsidian 执行 batch，验证 `.obsidian/plugins/calendar/main.js` 不被分析。

**验收场景**：

1. **Given** 项目根目录含 `examples/`、`worked/`、`vendor/` 等目录，**When** 执行 batch 生成，**Then** 这些目录不被识别为核心模块，不生成独立 spec
2. **Given** 项目含第三方打包产物（如 `.obsidian/plugins/*/main.js` 的 minified bundle），**When** 执行 batch 生成，**Then** 打包产物被排除
3. **Given** 用户希望覆盖默认排除规则，**When** 在项目配置中显式包含某个被排除的目录，**Then** 系统尊重用户配置

---

### User Story 3 - 产品级文档从代码反推（Priority: P2）

作为查阅 product-overview 的开发者或架构师，我希望产品能力描述是从代码中反推的（CLI 命令、API 端点、导出格式、分析功能），而不是复述 README 片段或搬运 GitHub Issue 标题。

**优先级理由**：当前 product-overview 的"核心场景"直接搬运 Issue 标题（如 "Will it work with Antigravity?"），产品定位只贴了 README 多语言链接。这不是"Reverse Spec"——真正的价值是让不读源码的人也能理解项目做了什么。

**独立测试方案**：对 graphify 执行 batch 生成，检查 `product-overview.md` 是否描述了核心能力（19 种语言 AST 解析、社区检测、多格式导出、MCP 服务器），而非搬运 Issue 标题。

**验收场景**：

1. **Given** 项目含 CLI 入口（如 `__main__.py` 或 `bin/` 下的脚本），**When** 生成 product-overview，**Then** 文档列出所有子命令及其功能描述
2. **Given** 项目含 README.md，**When** 生成产品级文档，**Then** README 作为上下文参考但不被直接复述，产品能力描述从代码结构（导出函数、CLI 参数、API 路由）反推
3. **Given** 项目有 GitHub Issues/PRs 信息，**When** 生成核心场景，**Then** 场景描述基于代码功能而非 Issue 标题

---

### User Story 4 - 非代码知识文件感知（Priority: P3）

作为对 Markdown-as-code 项目（如 Claude Code 插件）执行文档生成的开发者，我希望系统能识别并分析结构化 Markdown 文件（SKILL.md、AGENTS.md 等），将其作为项目核心逻辑的一部分纳入 spec。

**优先级理由**：Markdown-as-code 模式越来越普及（Claude Code Skills、Cursor Rules、AGENTS.md），当前 reverse-spec 对此完全盲区。claude-obsidian 的 10 个 Skills 定义了全部业务逻辑，但 spec 中零覆盖。P3 因为影响面较窄（仅 Markdown-as-code 项目）。

**独立测试方案**：对 claude-obsidian 项目执行 batch 生成，验证 `skills/` 目录下的 SKILL.md 文件被识别为核心组件，spec 中描述了 wiki、wiki-ingest、wiki-query 等 Skills 的功能。

**验收场景**：

1. **Given** 项目含 `skills/` 或 `commands/` 目录下的 `.md` 文件，**When** 执行 batch 生成，**Then** 这些 Markdown 文件被识别为知识文件并纳入 spec 上下文
2. **Given** 项目的 README.md 和 CHANGELOG.md，**When** 生成 spec，**Then** 这些文件的关键信息（产品定位、版本历史中的重要变更）被提取为上下文

---

### 边界场景

- **超大模块处理**：当单模块含 5000+ 行代码时，代码切片应优先选取公共 API 和核心算法，而非平均采样
- **LLM 上下文溢出**：代码切片 + README + 骨架总 token 超过上下文预算时，应按优先级裁剪（骨架 > 代码切片 > README），不得丢弃骨架
- **无 LLM 环境降级**：无 API Key 且无 CLI 代理时，系统行为与当前一致（骨架 + 占位符），不得崩溃
- **Minified/混淆代码**：打包产物（webpack bundle、minified JS）应被自动检测并跳过，即使在源码目录中
- **多语言混合模块**：同一目录含 Python + Shell 文件时，代码切片应分别按语言处理
- **空函数体**：函数体为空或仅含 pass/return 时，不生成切片，接口定义中标注为存根

---

## 功能需求

### 功能需求清单

- **FR-001**：系统 MUST 在非 deep 模式下，对每个模块的关键函数（公共 API、调用链入口）自动提取函数体的控制流骨架（条件分支、循环、try/catch 结构 + 核心调用链），作为 LLM 上下文的一部分。**[必须]** `[追踪: US-1]`

- **FR-002**：系统 MUST 在 LLM 上下文中注入代码切片后，生成的 Section 2（接口定义）包含关键函数的语义描述（不仅是签名，还包括行为摘要），不允许输出"此章节待补充"占位符。**[必须]** `[追踪: US-1]`

- **FR-003**：系统 MUST 在 LLM 上下文中注入代码切片后，生成的 Section 3（业务逻辑）包含模块核心逻辑的叙事性描述（数据流、算法步骤、状态转换），不允许输出"此章节待补充"占位符。**[必须]** `[追踪: US-1]`

- **FR-004**：系统 MUST 在代码切片提取时，按以下优先级选取函数：(1) 公共导出函数、(2) 被多处调用的内部函数、(3) 含复杂控制流的函数。在 token 预算约束下优先保留高优先级函数。**[必须]** `[追踪: US-1, 边界场景]`

- **FR-005**：系统 MUST 在 batch 模式下，对每个目录进行分类（source / test / example / vendor / config / docs），仅对 source 类别的目录生成核心 spec。**[必须]** `[追踪: US-2]`

- **FR-006**：目录分类器 MUST 基于以下信号组合判断：目录名称模式（如 `examples/`、`vendor/`、`dist/`、`__fixtures__/`）、文件内容特征（如 minified 代码行长度 > 500 字符）、import 模式（被项目代码导入则为 source）。**[必须]** `[追踪: US-2]`

- **FR-007**：系统 MUST 支持在 batch 生成产品级文档（product-overview）时，将项目的 README.md 内容作为上下文注入 LLM prompt，但系统提示词 MUST 要求 LLM 从代码结构（CLI 命令、导出函数、API 路由）反推产品能力，不得直接复述 README。**[必须]** `[追踪: US-3]`

- **FR-008**：系统 SHOULD 在模块 spec 生成时，将该模块被调用的上下文（来自依赖图中指向该模块的边）作为额外上下文提供给 LLM，使 LLM 能理解模块在整体架构中的定位。**[应当]** `[追踪: US-1]`

- **FR-009**：系统 SHOULD 能识别 Markdown 知识文件（SKILL.md、AGENTS.md 等），将其纳入 spec 上下文，使 Markdown-as-code 项目的核心逻辑不被遗漏。**[应当]** `[追踪: US-4]`

- **FR-010**：代码切片的 token 消耗 MUST 遵守现有的 100k token 上下文预算。当切片 + 骨架 + 额外上下文超出预算时，按骨架 > 切片 > README 的优先级裁剪。**[必须]** `[追踪: 边界场景]`

- **FR-011**：系统 MUST 在无 LLM 环境下（无 API Key 且无 CLI 代理）保持现有行为，不因新增的切片逻辑而崩溃或改变输出格式。**[必须]** `[追踪: 边界场景]`

- **FR-012**：Mermaid 类图生成 MUST 包含类的关键属性和方法列表（至少公共成员），而非空 class 框。**[必须]** `[追踪: US-1]`

- **FR-013**：目录分类器 SHOULD 支持用户通过项目配置文件（如 `.specignore` 或现有配置）覆盖自动分类结果。**[应当]** `[追踪: US-2]`

### 关键实体

- **CodeSlice**：函数体的控制流骨架切片，包含条件分支结构、核心调用链和关键常量引用，去除了具体实现细节
- **DirectoryClassification**：目录分类结果，标记为 source / test / example / vendor / config / docs，含分类依据
- **EnrichedContext**：增强后的 LLM 上下文，由 AST 骨架 + 代码切片 + README 上下文 + 依赖图上下文组成

---

## 成功标准

### 可测量结果

- **SC-001**：对 graphify 项目执行 spec 生成后，Section 2 和 Section 3 的内容量 >= 500 字（当前为 0 字 + 占位符），且无"待补充"占位符
- **SC-002**：对 graphify 项目执行 batch 后，`worked/` 目录不被识别为核心模块（当前错误生成了 `worked.spec.md`）
- **SC-003**：对 claude-obsidian 项目执行 batch 后，`.obsidian/plugins/calendar/main.js` 不被分析（当前作为主要分析目标）
- **SC-004**：对 graphify 的 product-overview 中，核心场景来自代码功能描述（如"19 种语言 AST 解析"、"Leiden 社区检测"），而非 GitHub Issue 标题搬运
- **SC-005**：生成的 Mermaid 类图中，LanguageConfig 类包含至少 5 个属性字段（当前为空框）
- **SC-006**：在无 API Key 环境下执行 generate，输出格式与当前一致，无崩溃
- **SC-007**：代码切片提取 + LLM 调用的总耗时不超过当前 generate 命令的 3 倍

---

## 复杂度评估

| 维度 | 数值 / 描述 |
|------|------------|
| **组件总数** | 3 个新增组件：代码切片提取器、目录分类器、上下文增强组装器；2 个修改组件：LLM prompt 模板、模块分组器 |
| **接口数量** | 2 处新增接口（CodeSlice、DirectoryClassification）；3 处修改接口（AssembledContext 扩展、系统提示词模板、模块分组逻辑） |
| **依赖新引入数** | 0：所有功能基于现有 tree-sitter AST 和 LLM 客户端实现 |
| **跨模块耦合** | 代码切片提取器需插入 prepare 阶段和 context assembly 之间；目录分类器需插入 module-grouper 之前 |
| **复杂度信号** | 代码切片提取涉及 AST 控制流分析（递归遍历）；目录分类涉及多信号融合决策；token 预算裁剪是优先级调度问题 |
| **总体复杂度** | **MEDIUM** |

**判定依据**：新增组件 3 个（< 5），但涉及 AST 控制流分析和多信号分类决策，有递归结构和优先级调度，超出 LOW 阈值。

---

*本 spec 基于对 graphify、claude-obsidian、khoj 三个外部项目的 reverse-spec 生成质量审查，以及 graphify 的 LLM 深度分析 vs AST-only 对比实验结果。*
