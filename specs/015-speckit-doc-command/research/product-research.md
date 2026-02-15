# 产品调研报告: speckit-doc 命令

**特性分支**: `015-speckit-doc-command`
**调研日期**: 2026-02-15
**调研模式**: 在线（Perplexity Search）

## 1. 需求概述

**需求描述**: 开发一个 speckit-doc 命令，用于生成 README 等常见的开源文档。需要文档结构清晰，涵盖从用户安装、使用、问题反馈、代码贡献等开源社区需要的方方面面。设计交互动作让用户选择开源协议类型、是否需要代码贡献文档，并提供常见文档组织模式。

**核心功能点**:
- 自动生成结构化的 README.md，涵盖项目介绍、安装、使用、贡献等完整章节
- 交互式选择开源协议（MIT、Apache-2.0、GPL-3.0、BSD 等）
- 可选生成 CONTRIBUTING.md、CODE_OF_CONDUCT.md 等社区文档
- 提供多种文档组织模式/模板供用户选择
- 与 reverse-spec 项目生态集成，利用 AST 分析和已有 Spec 信息增强文档质量

**目标用户**: 使用 reverse-spec / speckit 工具链的 Node.js/TypeScript 开源项目开发者和维护者

## 2. 市场现状

### 市场趋势

开源文档生成工具正在经历从**模板驱动**到 **AI 增强**的范式转变。2025-2026 年市场呈现以下趋势：

1. **AI 驱动的文档生成成为主流**: readme-ai（2.8k GitHub stars）等工具证明了 LLM 驱动的文档生成市场已成熟。开发者越来越期望工具能从代码仓库自动提取项目信息并生成高质量文档。
2. **CLI-first 交互模式**: 开发者偏好 CLI 工具（如 `npx readme-md-generator`）而非 Web 界面（如 readme.so），因为 CLI 更容易集成到现有工作流和 CI/CD 管道。
3. **全栈文档脚手架需求增长**: 从单纯的 README 生成扩展到包含 CONTRIBUTING.md、CODE_OF_CONDUCT.md、LICENSE、CHANGELOG.md、GitHub Issue/PR 模板等完整开源文档体系的一站式解决方案（如 Telefonica/opensource-scaffold）。
4. **代码感知的文档生成**: 工具开始分析 package.json、项目结构、依赖关系等元信息来自动填充文档内容，减少手动输入。

### 市场机会

1. **Claude Code 生态的文档工具缺口**: 当前 speckit 工具链覆盖了需求规范（speckit-feature）、问题修复（speckit-fix）、故事驱动（speckit-story），但缺少开源文档生成能力。这是一个自然的产品线延伸。
2. **AST 增强的差异化优势**: reverse-spec 已具备 AST 分析能力，可以精确提取项目结构、接口定义、依赖关系等信息，这是纯模板工具和通用 AI 工具无法匹敌的优势。
3. **Spec-Doc 联动**: 利用已生成的 spec.md、plan.md 等规范文档自动同步到 README 的功能特性章节，实现"规范即文档"的闭环。
4. **中文开源社区**: 现有工具几乎全部面向英文社区，中文开源项目的双语文档需求未被满足。

### 用户痛点

- **文档编写耗时且不受重视**: 开发者普遍认为文档编写耗时且回报低，60% 的开源开发者从未贡献过文档（GitHub 2017 年调查，5,500+ 开发者样本）
- **文档质量差是贡献的首要障碍**: 超过 93% 的开源开发者对不完整或令人困惑的文档感到沮丧，这直接阻碍了新贡献者的参与
- **文档与代码脱节**: README 和其他文档经常与实际代码不同步，特别是安装步骤、API 接口、项目结构等易变内容
- **缺乏完整的文档体系**: 多数项目只有 README，缺少 CONTRIBUTING、CODE_OF_CONDUCT 等社区建设文档，导致贡献者无从下手
- **模板千篇一律**: 现有工具生成的文档结构雷同，缺少根据项目特点（CLI 工具 vs. 库 vs. 框架）的定制化

## 3. 竞品分析

### 3.1 直接竞品

#### readme-ai (eli64s/readme-ai)

**定位**: AI 驱动的 README 生成 CLI 工具（Python 生态）

- **核心功能**: 从 GitHub URL 或本地路径分析仓库，利用 LLM（OpenAI/Anthropic/Gemini/Ollama）生成完整 README；支持离线模式、自定义 badge 样式、项目结构树、多种 header 模板
- **安装方式**: `pip install readmeai` / Docker / uv
- **GitHub Stars**: ~2,800
- **定价**: 免费开源（MIT License）
- **优势**: 多 LLM 后端支持、高度可定制（badge-style、header-style、emoji themes、logo 选项）、活跃维护（2025 年仍有更新）
- **劣势**: 仅生成 README，不覆盖 CONTRIBUTING/CODE_OF_CONDUCT 等社区文档；Python 生态，Node.js 项目需额外安装 Python 环境；无交互式流程，纯命令行参数驱动；不支持开源协议选择和生成
- **用户评价**: 生成质量依赖 LLM 模型，免费模型（offline mode）质量一般；项目结构树深度有限

#### readme-md-generator (kefranabg)

**定位**: 交互式 README 生成 npm CLI 工具（Node.js 生态）

- **核心功能**: 通过交互式问答收集项目信息，从 package.json 和 git config 自动预填充默认值，生成 EJS 模板渲染的 README
- **安装方式**: `npx readme-md-generator`
- **GitHub Stars**: 较高（成熟项目，2019 年发布）
- **定价**: 免费开源
- **优势**: Node.js 原生生态、交互式体验好、自动从 package.json 提取信息、支持自定义 EJS 模板
- **劣势**: 不使用 AI（纯模板驱动），生成内容较为固定；长期未活跃更新；仅生成 README，不覆盖其他社区文档；模板定制需要 EJS 知识
- **用户评价**: 对 npm 项目体验好，但生成内容需要大量手动补充

#### Telefonica/opensource-scaffold

**定位**: 开源项目文档全栈脚手架工具

- **核心功能**: 一键生成 README.md、CONTRIBUTING.md、CODE_OF_CONDUCT.md（Contributor Covenant）、LICENSE（支持 Apache-2.0/AGPL-3.0/MPL-2.0/MIT）、CHANGELOG.md、GitHub PR/Issue 模板、CI 工作流（CLA 签署、许可证合规检查）
- **安装方式**: `npx @telefonica/opensource-scaffold create` / GitHub Template
- **GitHub Stars**: ~2（非常小众）
- **定价**: 免费开源（Apache-2.0 License）
- **优势**: 最完整的开源文档体系覆盖、包含 CI/CD 工作流、支持 CLA 管理、许可证合规自动化
- **劣势**: 不使用 AI，生成内容为固定模板；知名度极低（仅 2 stars）；模板偏向 Telefonica 内部标准；无法根据项目特点定制内容；README 生成非常基础
- **用户评价**: 文档有限，社区采用率极低

### 3.2 间接竞品

#### DocuWriter.ai

**定位**: AI 驱动的代码文档生成 SaaS 平台

- **核心功能**: 从代码生成 README、API 文档、代码注释、UML 图、测试用例；支持 Git 集成、VSCode 插件、Cursor MCP
- **定价**: Starter $29/月（200 次生成）、Professional $49/月、Enterprise $129/月
- **优势**: 功能全面、UI 友好、多种输出格式
- **劣势**: 付费 SaaS 模式、不开源、不适合 CLI 工作流、无法离线使用

#### readme.so

**定位**: Web 端 README 编辑器

- **核心功能**: 拖拽式 README 章节编辑、预览、导出
- **优势**: 零门槛、所见即所得
- **劣势**: 纯 Web 工具、不可集成到 CLI 工作流、无 AI 能力、不分析代码

### 竞品对比表

| 维度 | readme-ai | readme-md-generator | Telefonica/scaffold | DocuWriter.ai | **speckit-doc（计划）** |
|------|-----------|--------------------|--------------------|---------------|----------------------|
| 核心功能 | AI 生成 README | 交互式问答生成 README | 全栈文档脚手架 | AI 生成多种文档 | AI + AST 增强的全栈开源文档 |
| AI 驱动 | 是（多 LLM） | 否 | 否 | 是 | 是（Claude） |
| 代码分析 | 基础（文件扫描） | package.json 读取 | 无 | 代码解析 | AST 精确分析 + Spec 联动 |
| 文档覆盖 | 仅 README | 仅 README | README + CONTRIBUTING + COC + LICENSE + CHANGELOG | README + API Docs | README + CONTRIBUTING + COC + LICENSE + CHANGELOG |
| 交互式选择 | 否（CLI 参数） | 是（问答式） | 有限 | Web UI | 是（协议选择、文档模式） |
| 项目结构树 | 是 | 否 | 否 | 否 | 是（AST 增强） |
| 生态系统 | Python pip | Node.js npm | Node.js npm | SaaS | Claude Code / speckit |
| 开源协议选择 | 否 | 否 | 是（4 种） | 否 | 是（6+ 种） |
| 定价 | 免费 | 免费 | 免费 | $29-249/月 | 免费（内置于 speckit） |
| 目标用户 | 通用开发者 | npm 项目开发者 | 企业开源项目 | 企业团队 | speckit 用户 / Node.js 开发者 |

### 差异化机会

1. **AST 精确性 + Spec 联动**: 这是最核心的差异化优势。利用 reverse-spec 已有的 AST 分析引擎，可以精确提取项目结构、公共 API、依赖关系、类型定义等信息自动填充到 README。同时，如果项目已有 spec.md、plan.md 等规范文档，可以自动同步功能特性描述到 README，实现"**单一信息源**"（Single Source of Truth）。竞品中没有任何一个工具具备这种深度代码理解能力。

2. **全栈开源文档 + AI 增强的独特组合**: 当前市场上，"AI 驱动"和"全栈文档覆盖"是两个分离的能力——readme-ai 有 AI 但只生成 README，Telefonica/scaffold 有全栈覆盖但无 AI。speckit-doc 可以同时提供两者：AI 增强的内容生成 + 完整的开源文档体系（README + CONTRIBUTING + CODE_OF_CONDUCT + LICENSE + CHANGELOG）。

3. **Claude Code 原生集成**: 作为 speckit 工具链的一部分，speckit-doc 天然集成在 Claude Code 生态中。用户可以在同一个开发环境中完成从需求规范到代码实现到文档生成的全流程，无需切换工具。这种"一站式"体验是所有竞品无法提供的。

4. **交互式文档定制**: 结合交互式协议选择和文档组织模式选择，提供比 readme-ai（纯参数驱动）更友好的交互体验，同时比 readme-md-generator（纯问答无 AI）更智能的内容生成。

5. **项目类型感知**: 根据项目类型（CLI 工具 / 库 / 框架 / 全栈应用）自动调整文档结构和内容重点。CLI 工具强调安装和命令行使用，库强调 API 文档，框架强调架构和扩展点。竞品普遍使用"一刀切"模板。

## 4. 用户场景验证

### 核心用户角色

**Persona 1: 独立开源项目维护者（"小明"）**
- 背景: 全栈开发者，维护 2-3 个 Node.js 开源项目，周末业余时间维护
- 目标: 希望项目有专业的文档以吸引更多贡献者和用户
- 痛点: 不擅长写文档，不知道"好的 README"应该包含哪些章节；每次发布新版本后忘记更新文档；没有 CONTRIBUTING.md 导致收到的 PR 质量参差不齐

**Persona 2: 企业开源项目负责人（"小红"）**
- 背景: 技术 leader，负责将内部工具开源，需要符合公司合规要求
- 目标: 快速生成符合企业标准的开源文档体系（含 LICENSE、CLA 流程、行为准则）
- 痛点: 需要在多种协议间选择且不确定哪种最适合；需要标准的 CONTRIBUTING 流程但不想从零开始写；希望文档能体现项目的专业性

**Persona 3: speckit 工具链深度用户（"小张"）**
- 背景: 已在项目中使用 reverse-spec 和 speckit-feature 进行 Spec 驱动开发
- 目标: 希望利用已有的 spec.md 等规范文档自动生成面向用户的 README
- 痛点: spec.md 是面向开发者的内部文档，需要一个工具将其转化为面向用户的外部文档；项目结构频繁变更，手动维护 README 中的结构树和 API 描述效率低

### 关键用户旅程

1. **首次生成全套文档**（Persona 1 & 2）:
   用户在项目根目录运行 `speckit-doc` --> 工具分析 package.json、项目结构、已有 spec 文件 --> 交互式询问：项目类型（CLI/库/框架）、选择开源协议、是否生成 CONTRIBUTING.md、选择文档组织模式 --> 生成一套完整的开源文档 --> 用户审阅并微调

2. **更新已有文档**（Persona 3）:
   项目代码发生变更后，用户运行 `speckit-doc --update` --> 工具检测代码变更（通过 AST diff）--> 自动更新 README 中的项目结构树、API 描述、依赖信息 --> 保留用户手动编辑的章节（如"动机"、"致谢"）--> 输出变更摘要

3. **选择性生成单个文档**:
   用户只需要 CONTRIBUTING.md --> 运行 `speckit-doc --only contributing` --> 工具生成适合项目的贡献指南，包含开发环境搭建、代码规范、PR 流程、Issue 模板等

### 需求假设验证

| 假设 | 验证结果 | 证据 |
|------|---------|------|
| 开发者需要一站式文档生成工具 | ✅ 已验证 | Telefonica/scaffold 的存在证明市场有全栈文档需求；但其低星标（2 stars）说明现有解决方案不够好 |
| AI 增强的文档生成比纯模板更受欢迎 | ✅ 已验证 | readme-ai（2.8k stars）远超纯模板工具（readme-md-generator 已停滞），AI 驱动是明确趋势 |
| 交互式协议选择是必要功能 | ✅ 已验证 | licensed（plibither8）、license-picker 等专门的协议选择工具的存在证明这是开发者的常见需求 |
| 开发者愿意在 CLI 中生成文档 | ✅ 已验证 | readme-ai、readme-md-generator、autoreadme-cli 等均为 CLI 工具，市场已验证 CLI 模式可行 |
| 利用 AST 分析可以显著提升文档质量 | ⚠️ 待确认 | 理论上成立（代码感知 > 纯 LLM 猜测），但尚无直接竞品采用此方式，需要在 MVP 中验证效果 [推断] |
| 用户需要中英双语文档支持 | ⚠️ 待确认 | 中文开源社区有双语需求，但未找到直接的用户调研数据支撑 [推断] |
| Spec 联动可以实现"规范即文档" | ⚠️ 待确认 | 这是 speckit 独有的创新点，市场上无先例，需要 MVP 验证用户价值 [推断] |

## 5. MVP 范围建议

### Must-have（MVP 核心）

1. **README.md 智能生成**: 基于 AST 分析 + package.json + 项目结构，生成包含标准章节的 README（标题/badge、描述、功能特性、快速开始/安装、使用示例、项目结构树、技术栈、测试、贡献链接、License）
2. **交互式开源协议选择**: 支持 MIT、Apache-2.0、GPL-3.0、BSD-2-Clause、BSD-3-Clause、ISC、MPL-2.0、Unlicense 等主流协议，生成 LICENSE 文件
3. **CONTRIBUTING.md 生成**: 包含开发环境搭建、代码规范、提交规范（Conventional Commits）、PR 流程、Issue 模板引导
4. **CODE_OF_CONDUCT.md 生成**: 基于 Contributor Covenant 标准模板，可选是否生成
5. **文档组织模式选择**: 提供至少两种模式——"精简模式"（仅 README + LICENSE）和"完整模式"（README + CONTRIBUTING + CODE_OF_CONDUCT + LICENSE）
6. **项目元信息自动提取**: 从 package.json 读取名称、版本、描述、作者、仓库地址、引擎要求等

### Nice-to-have（二期）

7. **Spec 联动**: 读取已有的 spec.md 同步功能描述、用户故事到 README 的"功能特性"章节
8. **文档更新模式**: `--update` 参数，检测代码变更后增量更新文档，保留用户手动编辑
9. **CHANGELOG.md 生成**: 从 Git 提交历史生成变更日志（支持 Conventional Commits 格式）
10. **GitHub 模板生成**: .github/ISSUE_TEMPLATE/、.github/PULL_REQUEST_TEMPLATE.md
11. **自定义模板支持**: 用户可提供自定义 Handlebars/EJS 模板覆盖默认输出
12. **badge 样式自定义**: 支持 shields.io 的多种 badge 样式（flat、flat-square、for-the-badge 等）

### Future（远期）

13. **双语文档生成**: 同时生成中文和英文版本的 README
14. **文档质量评分**: 基于 awesome-readme 最佳实践对已有 README 打分并建议改进
15. **CI/CD 集成**: 提供 GitHub Action，在代码变更时自动更新文档
16. **文档漂移检测**: 类似 reverse-spec-diff，检测文档与代码的不一致
17. **交互式文档预览**: 生成前在终端预览 Markdown 渲染效果
18. **项目类型模板库**: 针对 CLI 工具、npm 库、Web 框架、monorepo 等不同项目类型提供专用模板

### 优先级排序理由

MVP 核心功能（1-6）聚焦于**最小可用的一站式文档生成体验**。理由如下：

- **README 生成是核心价值**（#1）: 这是所有开源项目的必需品，也是工具的核心卖点。通过 AST 分析实现比竞品更精确的内容生成，是首要差异化点。
- **协议选择是高频刚需**（#2）: 几乎每个新开源项目都需要选择协议，交互式引导降低了选择难度。独立的 LICENSE 选择工具（如 licensed）的存在证明了这一需求。
- **CONTRIBUTING + CODE_OF_CONDUCT 是社区基础设施**（#3-4）: 这两个文件是吸引贡献者的关键，缺失它们是开源项目的常见短板。与 README 一起生成形成"最小完整文档体系"。
- **文档模式选择控制复杂度**（#5）: 不是所有项目都需要完整文档体系，精简模式降低了入门门槛。
- **元信息自动提取是基础能力**（#6）: 这是所有生成功能的数据基础，避免用户重复输入。

二期功能（7-12）聚焦于**差异化和高级场景**，其中 Spec 联动（#7）是最核心的差异化特性，但因依赖较复杂的 spec 解析逻辑，放在 MVP 后优先开发。

## 6. 结论与建议

### 总结

speckit-doc 命令的产品定位清晰：**Claude Code 生态中首个融合 AST 分析能力的全栈开源文档生成工具**。市场调研表明：

1. 文档生成工具市场已成熟（readme-ai 2.8k stars），AI 驱动是确定趋势
2. 但市场存在明确的**能力断层**——AI 驱动（readme-ai）和全栈文档覆盖（Telefonica/scaffold）尚未在一个工具中统一
3. AST 精确分析 + Spec 联动是 speckit 独有的差异化壁垒，竞品无法快速复制
4. 93% 的开源开发者对不完整文档感到沮丧，市场需求真实且迫切
5. 作为 speckit 工具链的自然延伸，speckit-doc 可复用已有的项目分析基础设施，开发成本可控

**建议推进 MVP 开发**，聚焦 README + LICENSE + CONTRIBUTING + CODE_OF_CONDUCT 的一站式生成能力。

### 对技术调研的建议

- **Handlebars 模板体系**: 技术调研应评估如何复用 reverse-spec 已有的 Handlebars 模板引擎来渲染文档，以及是否需要新增模板文件
- **AST 信息提取范围**: 明确 README 生成需要从 AST 提取哪些信息（公共 API 签名、项目结构树、类型定义概要），以及如何复用 `ast-analyzer.ts`、`context-assembler.ts` 等现有模块
- **交互式 CLI 实现**: 评估 Node.js 交互式 CLI 方案（inquirer / prompts / @clack/prompts），确保在 Claude Code 的 Task tool 环境中可用 [推断：可能需要特殊适配]
- **文档保留策略**: 技术方案需解决"如何在更新模式下保留用户手动编辑的内容"这一核心技术挑战，可参考 front-matter 标记或章节锚点方案
- **LICENSE 模板来源**: 评估是内嵌 LICENSE 文本模板还是调用 GitHub Licenses API 动态获取
- **与 speckit 工作流的集成方式**: 确定 speckit-doc 是独立命令还是可以作为 speckit-feature 流程的可选阶段

### 风险与不确定性

- **Claude Code 环境限制**: speckit-doc 作为 Claude Code 的 Skill 运行时，交互式输入能力可能受限。需要验证 Claude Code Task tool 是否支持多轮交互式选择（如协议选择、文档模式选择）。缓解方案：改用参数驱动 + 默认值预设，在非交互环境下退化为单次生成。
- **文档更新的内容保留**: `--update` 模式下如何区分"AI 生成的内容"和"用户手动编辑的内容"是技术难点。缓解方案：使用 HTML 注释标记自动生成区域，如 `<!-- auto-generated:start -->...<!-- auto-generated:end -->`。
- **LLM 生成质量的稳定性**: AI 生成的文档内容质量可能不够稳定。缓解方案：AST 数据作为"骨架"约束 LLM 输出，减少幻觉；提供生成后人工审阅环节。
- **与现有 README 的兼容性**: 如果项目已有 README，覆盖 vs. 合并的策略需要谨慎设计。缓解方案：默认不覆盖，提供 `--force` 参数；或提供 diff 预览让用户确认。
