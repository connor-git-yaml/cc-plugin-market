# 技术调研报告: speckit-doc 命令

**特性分支**: `015-speckit-doc-command`
**调研日期**: 2026-02-15
**调研模式**: 在线（Perplexity Search）
**产品调研基础**: [product-research.md](product-research.md)

## 1. 调研目标

**核心问题**:
- 问题 1: speckit-doc 应采用 Skill-Only 架构（纯 Markdown prompt + Bash 脚本）还是 Hybrid 架构（Skill 编排 + TypeScript 运行时模块）？
- 问题 2: 如何实现文档模板渲染——复用现有 Handlebars 引擎还是采用 LLM 直接生成？
- 问题 3: 交互式选择（协议、文档模式）在 Claude Code Task tool 环境中如何实现？
- 问题 4: LICENSE 文本应内嵌模板还是调用 GitHub Licenses API 动态获取？
- 问题 5: 文档更新模式下如何保留用户手动编辑的内容？

**产品 MVP 范围（来自产品调研）**:
- README.md 智能生成（AST 分析 + package.json + 项目结构）
- 交互式开源协议选择（MIT、Apache-2.0、GPL-3.0 等 8+ 种）
- CONTRIBUTING.md 生成（开发环境、代码规范、PR 流程）
- CODE_OF_CONDUCT.md 生成（Contributor Covenant 标准模板）
- 文档组织模式选择（精简模式 / 完整模式）
- 项目元信息自动提取（package.json 读取）

## 2. 架构方案对比

### 方案 A: Skill-Only 架构（纯 Prompt 驱动）

**概述**: speckit-doc 作为一个纯 Claude Code Skill 实现，完全由 Markdown prompt + Bash 辅助脚本构成，不新增任何 TypeScript 运行时代码。文档生成逻辑完全编码在 Skill prompt 中，由 Claude Code 的 LLM 能力直接执行——读取 package.json、扫描项目结构、生成 Markdown 文件。

**实现路径**:
- `plugins/spec-driver/skills/speckit-doc/SKILL.md` — 主 Skill prompt（~300-500 行），定义完整的文档生成流程
- `plugins/spec-driver/scripts/scan-project.sh` — Bash 脚本，负责收集 package.json 内容、项目目录树、git 信息等元数据
- 模板内容直接内嵌在 prompt 中，或作为独立 `.md` 文件由 Skill 读取后填充
- 交互式选择通过 prompt 中的"展示选项 → 等待用户输入"模式实现

**优势**:
- 零运行时依赖新增，完全符合 Constitution "现有依赖优先"约束
- 与 speckit-feature、speckit-story、speckit-fix 等现有 Skill 完全一致的实现模式
- 开发速度最快（无编译、无测试框架配置），估计 1-2 天可完成 MVP
- LLM 天然适合 Markdown 生成任务，生成内容质量高
- 部署零成本——随 plugin 安装即可用

**劣势**:
- LLM 生成的文档结构和内容可能不够稳定（同一输入不同次运行可能产生不同输出）
- LICENSE 全文（如 Apache-2.0 约 11KB）内嵌在 prompt 中会占用大量 context window
- 无法进行单元测试，只能通过集成测试验证
- 项目结构树的精确生成依赖 LLM 理解能力，复杂项目可能遗漏或错误
- 对 AST 分析的利用有限——需要在 Bash 脚本中调用 `reverse-spec prepare` 命令获取 AST 数据

### 方案 B: Hybrid 架构（Skill 编排 + TypeScript 模块）

**概述**: speckit-doc 的编排逻辑仍由 Skill prompt 驱动（与现有 speckit 系列一致），但核心的模板渲染、项目分析、文件写入逻辑封装为 TypeScript 模块。Skill prompt 通过 Bash 调用 `reverse-spec doc` CLI 子命令来执行确定性操作，LLM 仅负责"智能填充"模板中需要语义理解的章节。

**实现路径**:
- `plugins/spec-driver/skills/speckit-doc/SKILL.md` — Skill 编排 prompt，协调整体流程
- `src/cli/commands/doc.ts` — 新增 CLI 子命令入口
- `src/doc/project-analyzer.ts` — 项目元信息提取（package.json、tsconfig.json、目录结构、git 信息）
- `src/doc/doc-renderer.ts` — Handlebars 模板渲染器（复用 `spec-renderer.ts` 架构）
- `src/doc/license-provider.ts` — LICENSE 文本提供（内嵌模板 + 可选 GitHub API 降级）
- `templates/readme.hbs`、`templates/contributing.hbs`、`templates/code-of-conduct.hbs` — Handlebars 模板
- 交互式选择由 Skill prompt 处理（LLM 层面），确定性参数传递给 CLI 子命令

**优势**:
- 确定性输出：Handlebars 模板保证文档结构 100% 一致
- 深度复用 AST 分析——直接调用 `analyzeFile()`、`analyzeFiles()` 提取公共 API、项目结构
- 可单元测试、可 CI 集成
- LICENSE 文本可作为静态资源文件管理（不占 LLM context）
- 支持复杂的模板定制（二期的自定义模板需求可自然扩展）
- 文档更新模式（`--update`）的实现更可靠——基于 HTML 注释标记的解析和保留

**劣势**:
- 开发周期较长（估计 3-5 天完成 MVP），需要编写 TypeScript 模块 + 单元测试
- 新增 ~500-800 行 TypeScript 代码，增加项目维护负担
- 需要为 `doc` 子命令扩展 CLI 框架
- LLM 智能填充部分仍有不确定性（但范围被限制在模板的动态章节内）
- Handlebars 模板设计需要前期投入，模板本身的维护也是成本

### 方案 C: LLM-First + 后处理校验（混合方案）

**概述**: 文档生成完全由 LLM（通过 Skill prompt）执行，但输出后经过一个轻量级的 TypeScript 后处理模块进行格式校验、结构规范化、元数据注入（badges、license 年份等）。这是方案 A 和方案 B 的折中。

**实现路径**:
- `plugins/spec-driver/skills/speckit-doc/SKILL.md` — 主 Skill prompt（含详细的文档生成指令）
- `src/doc/doc-validator.ts` — 后处理校验器（验证章节完整性、修正格式问题）
- `src/doc/badge-injector.ts` — 根据 package.json 自动注入 shields.io badge
- LICENSE 文件由 Bash 脚本 + 内嵌模板处理
- 交互式选择由 Skill prompt 处理

**优势**:
- 保留 LLM 生成内容的灵活性和自然语言质量
- 后处理保障格式一致性（章节标题、badge 格式、链接格式）
- 开发量适中（~200-300 行 TypeScript 后处理 + Skill prompt）
- LICENSE 等确定性内容由脚本直接处理，避免 LLM 幻觉

**劣势**:
- 架构不够纯粹——既不是纯 Skill 也不是完整 Hybrid
- 后处理能力有限，无法解决 LLM 输出的所有不一致问题
- AST 分析的利用仍需通过 Skill prompt 调用 CLI 命令间接实现

### 方案对比表

| 维度 | 方案 A: Skill-Only | 方案 B: Hybrid | 方案 C: LLM-First + 后处理 |
|------|-------------------|---------------|--------------------------|
| 概述 | 纯 Markdown prompt + Bash 脚本 | Skill 编排 + TypeScript 渲染模块 | LLM 生成 + TypeScript 格式校验 |
| 性能 | 依赖 LLM 响应速度（~30-60s/文档） | 模板渲染 <1s + LLM 填充 ~20-30s | LLM ~30-60s + 后处理 <1s |
| 可维护性 | 高（prompt 修改即生效） | 中（需编译、测试） | 中高（prompt + 轻量 TS） |
| 学习曲线 | 低（仅需 prompt 工程） | 中（需理解 Handlebars + TS 模块） | 低中（prompt + 简单 TS） |
| 社区支持 | Claude Code Skill 生态 | Handlebars 成熟生态 | 混合 |
| 适用规模 | 中小型项目 | 任意规模 | 中型项目 |
| 输出稳定性 | 中（LLM 有随机性） | 高（模板保障结构） | 中高（后处理修正格式） |
| AST 利用深度 | 低（间接调用） | 高（直接 API 调用） | 低（间接调用） |
| 与现有 Skill 一致性 | 完全一致 | 需扩展 CLI | 部分一致 |
| MVP 开发周期 | 1-2 天 | 3-5 天 | 2-3 天 |
| 可测试性 | 低（仅集成测试） | 高（单元+集成） | 中（部分单元测试） |

### 推荐方案

**推荐**: 方案 A（Skill-Only 架构）

**理由**:

1. **与 speckit 工具链架构一致性**: speckit-feature、speckit-story、speckit-fix、speckit-sync 均采用纯 Skill prompt 架构。speckit-doc 作为同系列命令，采用一致的架构模式最为自然，降低维护认知负担。打破这一模式需要充分的技术理由——而文档生成场景的复杂度尚不足以证明此必要性。

2. **LLM 天然擅长 Markdown 生成**: 与代码分析（需要 AST 精确性）不同，Markdown 文档生成是 LLM 的强项领域。Claude 能够产出结构清晰、内容丰富的 README、CONTRIBUTING 等文档，且质量通常优于纯模板填充。

3. **MVP 速度优先**: 产品调研表明 speckit-doc 的核心价值在于"AST 增强 + AI 生成的一站式文档体验"。方案 A 能以最短时间验证这一价值主张。如果市场验证成功，可在二期迭代中引入 Handlebars 模板以提升稳定性（渐进式演进到方案 B）。

4. **Constitution 约束完全满足**: 纯 Skill 架构不新增任何运行时依赖，不修改 TypeScript 源码，完全在 `plugins/spec-driver/` 目录内完成。

5. **AST 分析可通过现有 CLI 命令间接利用**: 虽然方案 A 不直接调用 TypeScript API，但 Skill prompt 可以通过 Bash 执行 `reverse-spec prepare <target>` 获取项目 AST 数据（JSON 格式），然后将其注入到文档生成上下文中。这种方式已在现有 Skill 中验证过。

6. **渐进式演进路径清晰**: 方案 A -> 方案 B 的迁移路径是：(1) MVP 用 Skill-Only 快速上线；(2) 根据用户反馈确定需要确定性输出的部分；(3) 将那些部分提取为 Handlebars 模板 + TypeScript 模块。这比一开始就投入 Hybrid 架构更务实。

**方案 B 的适用时机**: 当以下条件满足时考虑迁移到 Hybrid 架构：
- 用户反馈文档结构不够稳定，需要确定性模板
- `--update` 模式的需求被验证为高优先级（HTML 注释标记的解析需要 TypeScript）
- 自定义模板功能成为核心需求

## 3. 依赖库评估

### 评估矩阵

由于推荐方案 A（Skill-Only）不新增 TypeScript 运行时依赖，以下评估聚焦于**已有依赖的复用**和**可能在后续迭代引入的库**。

| 库名 | 用途 | 版本 | 周下载量 | 许可证 | 最近更新 | 与项目兼容性 | 评级 |
|------|------|------|---------|--------|---------|-------------|------|
| handlebars | 模板渲染（方案 B 适用） | 4.7.8 | ~10M | MIT | 2023 (稳定) | 已安装 | 高 |
| ts-morph | AST 分析（间接使用） | 24.0.0 | ~500K | MIT | 2024 | 已安装 | 高 |
| zod | 配置校验（方案 B 适用） | 3.25.76 | ~15M | MIT | 2025 活跃 | 已安装 | 高 |
| @anthropic-ai/sdk | LLM API（间接使用） | 0.39.0 | ~200K | MIT | 2025 活跃 | 已安装 | 高 |
| @clack/prompts | 交互式 CLI（方案 B 适用） | ~0.8.x | ~500K | MIT | 2025 | 未安装，可选 | 中 |
| inquirer | 交互式 CLI（方案 B 替代） | 10.x | ~30M | MIT | 2025 活跃 | 未安装，可选 | 中 |

### 推荐依赖集

**MVP 核心依赖（方案 A，零新增）**:
- **无新增运行时依赖**: Skill-Only 架构完全运行在 Claude Code 沙箱中，利用 Node.js 内置模块（`fs`、`path`、`child_process`）通过 Bash 脚本操作文件系统
- **间接使用 reverse-spec CLI**: 通过 `reverse-spec prepare` 命令利用 ts-morph AST 分析能力提取项目结构信息
- **间接使用 handlebars**: 如果 Skill prompt 中的文档生成模板不够灵活，可通过调用 `reverse-spec` 的 Handlebars 渲染管线生成特定章节

**方案 B 迭代时可能引入的依赖**:
- **@clack/prompts**: 推荐用于交互式 CLI。相比 inquirer，包体积小 80%，UI 更现代化，API 更简洁。但在 Claude Code 环境中可能不适用（需评估 Task tool 的 stdin 支持），因此作为"可选"而非"核心"。
- **spdx-license-list**: 提供 SPDX 标准的完整 LICENSE 文本，避免手动维护。但该库较少更新，且 LICENSE 文本可直接从 GitHub Licenses API 或内嵌静态文件获取。

### 与现有项目的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| handlebars@4.7.8 | 完全兼容 | 方案 B 可直接复用 `spec-renderer.ts` 的初始化模式和 Helper 注册机制 |
| ts-morph@24.0.0 | 完全兼容 | 通过 `reverse-spec prepare` CLI 命令间接使用，无 API 层耦合 |
| zod@3.25.76 | 完全兼容 | 方案 B 可用于校验 speckit-doc 配置 schema |
| @anthropic-ai/sdk@0.39.0 | 完全兼容 | 方案 B 的 LLM 填充功能可复用 `llm-client.ts` |
| dependency-cruiser@16.10.4 | 不涉及 | speckit-doc 不需要依赖图分析 |
| tree-sitter@0.21.1 | 不涉及 | AST 分析通过 ts-morph 路径即可满足 |
| @modelcontextprotocol/sdk@1.26.0 | 不涉及 | MCP 功能与文档生成无关 |

## 4. 设计模式推荐

### 推荐模式

1. **Pipeline 模式（管道模式）**

   **适用场景**: speckit-doc 的文档生成流程天然是一个管道——信息收集 -> 内容生成 -> 格式化 -> 文件写入。每个阶段的输出是下一阶段的输入。

   **在方案 A 中的应用**: Skill prompt 按顺序定义各阶段步骤。Bash 脚本负责数据收集阶段，LLM 负责内容生成和格式化阶段，Bash/LLM 负责文件写入阶段。

   ```text
   scan-project.sh (元数据收集)
     -> Skill prompt: 分析元数据 + 决定文档结构
       -> Skill prompt: 生成各文档内容
         -> 写入文件系统
   ```

   **在方案 B 中的应用**: 每个管道阶段对应一个 TypeScript 函数或模块。`ProjectAnalyzer.analyze()` -> `DocRenderer.render()` -> `fs.writeFileSync()`。可参考 reverse-spec 现有的 `single-spec-orchestrator.ts` 管道模式。

   **风险**: 管道中间步骤的错误传播——如果元数据收集不完整，后续所有阶段的输出都会受影响。缓解策略：在管道中间设置校验点。

2. **Template Method 模式（模板方法模式）**

   **适用场景**: 不同类型的文档（README、CONTRIBUTING、CODE_OF_CONDUCT、LICENSE）共享相同的生成骨架（收集上下文 -> 渲染 -> 写入），但每种文档的具体渲染逻辑不同。

   **在方案 A 中的应用**: Skill prompt 中定义一个通用的文档生成流程框架，通过条件分支（`if 文档类型 == README then ...`）切换具体逻辑。

   **在方案 B 中的应用**: 抽象基类 `DocGenerator`，具体子类 `ReadmeGenerator`、`ContributingGenerator` 等实现各自的 `generateContent()` 方法。

   **风险**: 过度抽象。MVP 阶段仅有 4 种文档类型，如果每种文档的生成逻辑差异较大，强行套用 Template Method 反而增加复杂度。

3. **Strategy 模式（策略模式）**

   **适用场景**: 文档组织模式的选择——"精简模式"和"完整模式"对应不同的文档集合和生成策略。

   **在方案 A 中的应用**: Skill prompt 根据用户选择的模式，确定要生成的文档清单和各文档的详略程度。

   ```text
   精简模式策略: [README.md, LICENSE]
   完整模式策略: [README.md, LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md]
   ```

   **在方案 B 中的应用**: `DocModeStrategy` 接口，`MinimalStrategy` 和 `FullStrategy` 实现类。

   **风险**: 仅有 2 种模式时 Strategy 模式可能过度设计。但产品路线图中提到未来可能新增更多模式（如"企业模式"），Strategy 模式为此预留了扩展点。

4. **Marker-Based Preservation 模式（标记保留模式）**

   **适用场景**: 文档更新模式（`--update`，二期功能）下区分"AI 生成区域"和"用户编辑区域"。

   **在方案 A 中的应用**: 生成的文档中使用 HTML 注释标记自动生成区域：
   ```markdown
   <!-- speckit-doc:auto-start:project-structure -->
   ## Project Structure
   ...（自动生成的内容）
   <!-- speckit-doc:auto-end:project-structure -->

   ## Motivation
   ...（用户手动编辑的内容，不带标记，更新时保留）
   ```

   更新时，Skill prompt 解析现有文档，识别标记区域并替换，保留无标记区域。

   **业界实践**: comment-mark（npm 包）、GitHub Actions 中的 readme-auto-update 均采用此模式。这是经过验证的最佳实践。

   **风险**: 标记语法可能与某些 Markdown 渲染器冲突（如 GitHub Pages 的某些主题会显示 HTML 注释）。实际上，GitHub 的 Markdown 渲染器会正确隐藏 HTML 注释，风险较低。

### 应用案例

**readme-ai 的架构模式参考**: readme-ai（Python 生态，2.8k stars）采用 Pipeline 模式——Preprocessor 扫描仓库 -> LLM 生成各章节内容 -> Template 组装最终 Markdown。其模板系统使用字符串格式化而非模板引擎，这在内容质量和格式一致性之间做了妥协。speckit-doc 的方案 A 与 readme-ai 的理念类似，但用 Claude Code Skill prompt 替代了 Python 编排脚本。

**reverse-spec 现有架构中的 Pipeline 应用**: `single-spec-orchestrator.ts` 是一个典型的管道——`analyzeFile()` -> `assembleContext()` -> `callLLM()` -> `parseLLMResponse()` -> `renderSpec()`。speckit-doc 的生成流程可以参考此管道设计，即使在 Skill-Only 方案中也遵循相同的逻辑顺序。

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | **Claude Code Task tool 的交互式输入限制**: speckit-doc 需要用户选择协议类型和文档模式，但 Claude Code 的 Task tool 不支持传统的 stdin 交互式 prompt（如 inquirer）。 | 高 | 中 | 在 Skill prompt 中直接向用户展示选项列表，等待用户在对话中输入选择。Claude Code 的 REPL 模式天然支持这种"展示选项 -> 用户回复"的交互方式。这与 speckit-feature 的质量门（GATE）交互模式一致。 |
| 2 | **LLM 生成文档结构不一致**: 方案 A 依赖 LLM 生成完整的 Markdown 文档，不同次运行可能产生章节顺序、格式、缩进不一致的输出。 | 中 | 中 | (1) Skill prompt 中严格定义文档结构模板（包括精确的章节标题和顺序），利用 few-shot 示例引导格式一致性；(2) 对 README 的关键章节（如 badges 行、安装命令）提供精确模板而非让 LLM 自由发挥；(3) 二期可引入 TypeScript 后处理校验。 |
| 3 | **LICENSE 文本准确性**: 开源协议文本必须 100% 精确，不允许 LLM 幻觉或修改。Apache-2.0 等协议文本较长（~11KB），直接嵌入 prompt 占用 context。 | 中 | 高 | 将常用协议的 LICENSE 文本作为独立的 `.txt` 文件存放在 `plugins/spec-driver/templates/licenses/` 目录下。Skill prompt 根据用户选择的协议类型，通过 Read tool 读取对应文件并直接写入，**绝不让 LLM 生成 LICENSE 文本**。 |
| 4 | **项目根目录写入需要用户确认**: Constitution 约束要求 specs/ 目录之外的写操作需要用户确认。speckit-doc 需要写入项目根目录的 README.md、LICENSE、CONTRIBUTING.md 等文件。 | 高 | 低 | (1) Skill prompt 在写入前明确列出将要创建/修改的文件列表，展示给用户确认；(2) 检测已有文件，默认不覆盖，提供 `--force` 选项；(3) Claude Code 本身在非 `--dangerously-skip-permissions` 模式下会对文件写入请求用户确认。 |
| 5 | **复杂项目的 AST 分析超时**: 大型 monorepo 项目的 AST 分析可能耗时较长，导致 `reverse-spec prepare` 命令超时。 | 低 | 中 | (1) speckit-doc 仅对项目入口文件和 `src/` 顶层文件执行 AST 分析，而非全量扫描；(2) 设置合理的超时（60s）并提供降级路径——如果 AST 分析失败，仅基于 package.json 和目录扫描生成文档。 |
| 6 | **已有 README 的覆盖风险**: 用户项目可能已有精心编写的 README.md，盲目覆盖会导致内容丢失。 | 高 | 高 | (1) 默认行为：如果 README.md 已存在，展示 diff 预览，要求用户确认覆盖；(2) 备份策略：覆盖前自动创建 `README.md.bak`；(3) MVP 阶段暂不实现合并功能，但为二期的 `--update` 模式预留 HTML 注释标记。 |
| 7 | **Contributor Covenant 版本选择**: Contributor Covenant 已更新到 v3.0（2025-07），但多数项目仍使用 v2.1。版本选择需要考虑社区接受度。 | 低 | 低 | 默认使用 Contributor Covenant v2.1（最广泛采用的版本），在 Skill prompt 中提供版本选择选项（v2.1 / v3.0）。两个版本的模板文本均作为静态文件存储。 |
| 8 | **shields.io Badge URL 格式变化**: shields.io 的 URL 格式可能在未来变更，导致生成的 badge 链接失效。 | 低 | 低 | 使用 shields.io 最稳定的基础 URL 格式（`https://img.shields.io/npm/v/{pkg}` 等），避免使用实验性 endpoint。Badge 生成逻辑集中在 Skill prompt 的一个位置，便于统一更新。 |

## 6. 产品-技术对齐度

### 覆盖评估

| MVP 功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| README.md 智能生成 | 完全覆盖 | Skill prompt 通过 `scan-project.sh` 收集项目元数据 + `reverse-spec prepare` 获取 AST 信息，LLM 生成高质量 README |
| 交互式开源协议选择 | 完全覆盖 | Skill prompt 展示协议列表 -> 用户选择 -> 读取对应 LICENSE 模板文件写入。交互模式与 speckit-feature 的质量门一致 |
| CONTRIBUTING.md 生成 | 完全覆盖 | Skill prompt 根据项目元数据（包管理器、测试框架、lint 配置）生成针对性的贡献指南 |
| CODE_OF_CONDUCT.md 生成 | 完全覆盖 | 读取 Contributor Covenant 模板文件，替换联系方式占位符后写入 |
| 文档组织模式选择 | 完全覆盖 | Strategy 模式在 Skill prompt 中实现——精简模式（README + LICENSE）vs 完整模式（+CONTRIBUTING + COC） |
| 项目元信息自动提取 | 完全覆盖 | `scan-project.sh` 提取 package.json（名称、版本、描述、仓库 URL、引擎要求、scripts）、git remote URL、目录结构 |

### 扩展性评估

| 二期功能 | 方案 A 扩展难度 | 说明 |
|---------|---------------|------|
| Spec 联动 | 低 | Skill prompt 可直接 Read 已有的 spec.md 文件，提取功能描述注入 README 的"Features"章节 |
| 文档更新模式（--update） | 中高 | 需要在 Skill prompt 中实现 HTML 注释标记的解析和内容替换逻辑。LLM 处理这类结构化解析不如 TypeScript 可靠。**这是最可能触发向方案 B 迁移的功能** |
| CHANGELOG.md 生成 | 低 | Skill prompt 通过 `git log` 获取提交历史，LLM 格式化为 Conventional Commits 风格的 CHANGELOG |
| GitHub 模板生成 | 低 | 静态模板文件 + 简单变量替换，Skill prompt 可直接处理 |
| 自定义模板支持 | 高 | 用户自定义 Handlebars 模板需要 TypeScript 编译和渲染支持。**这也是触发方案 B 迁移的功能** |
| Badge 样式自定义 | 低 | 在 Skill prompt 中提供 badge 样式选项（flat/flat-square/for-the-badge），修改 URL 参数即可 |

**关键结论**: 方案 A 对 MVP 的 6 项核心功能提供完全覆盖。在二期功能中，`--update` 模式和自定义模板是向方案 B 迁移的两个潜在触发点。其余二期功能在方案 A 框架内均可扩展。

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| 纯 Node.js 生态 | 完全兼容 | 方案 A 不引入任何非 Node.js 依赖，Bash 脚本仅用于数据收集 |
| 现有依赖优先 | 完全兼容 | 零新增运行时依赖 |
| 写操作范围（specs/ 之外需确认） | 完全兼容 | Skill prompt 在写入 README.md、LICENSE 等文件前展示文件列表供用户确认 |
| 技术栈约束（TypeScript 5.x） | 完全兼容 | 方案 A 不新增 TypeScript 代码。方案 B 如实施，遵循现有 tsconfig.json 配置 |
| 代码修改限制 | 完全兼容 | 方案 A 仅在 `plugins/spec-driver/` 目录下新增文件，不修改任何现有源码 |

## 7. 结论与建议

### 总结

speckit-doc 命令的技术调研评估了 3 个架构方案，最终推荐**方案 A（Skill-Only 架构）**作为 MVP 实现方案。核心理由：

1. **架构一致性**: 与 speckit 工具链现有的 5 个 Skill（feature、story、fix、resume、sync）保持完全一致的实现模式
2. **零依赖新增**: 完全满足 Constitution 的"纯 Node.js 生态、现有依赖优先"约束
3. **MVP 速度**: 1-2 天即可完成 MVP，快速验证"AST 增强 + AI 生成的一站式文档体验"的价值主张
4. **渐进演进**: 预留从方案 A 到方案 B 的清晰迁移路径，由用户反馈驱动迁移时机

**关键技术决策**:
- LICENSE 文本**必须**使用静态模板文件，禁止 LLM 生成
- 交互式选择采用 Skill prompt 的"展示选项 -> 用户回复"模式，与质量门机制一致
- AST 分析通过 `reverse-spec prepare` CLI 命令间接使用
- 文档中预埋 HTML 注释标记（`<!-- speckit-doc:auto-start -->` / `<!-- speckit-doc:auto-end -->`），为二期 `--update` 功能预留
- 已有文件覆盖策略：默认不覆盖 + diff 预览 + 备份

**已识别 8 个技术风险**，其中高概率风险 3 个（交互限制、文件覆盖确认、已有 README 覆盖），均有明确的缓解策略。

### 对产研汇总的建议

- **建议 1**: 产品-技术交叉分析应关注"文档更新模式"（`--update`）的优先级评估。这是方案 A 最大的技术短板——如果用户反馈强烈要求 `--update`，则需要提前规划向方案 B 的迁移
- **建议 2**: 风险评估重点应放在"LLM 生成文档质量稳定性"上。建议在 MVP 验证阶段收集 10+ 个不同类型项目的生成结果样本，评估结构一致性和内容质量
- **建议 3**: LICENSE 静态文件的维护策略需要明确——是覆盖最常见的 8 种协议（MIT、Apache-2.0、GPL-3.0、BSD-2-Clause、BSD-3-Clause、ISC、MPL-2.0、Unlicense）还是通过 GitHub Licenses API 按需获取。建议 MVP 内嵌 8 种，二期引入 API 降级
- **建议 4**: 应评估 speckit-doc 与 speckit-sync 的联动场景——生成 README 时是否自动读取 `specs/products/*/current-spec.md` 作为功能特性的数据源
