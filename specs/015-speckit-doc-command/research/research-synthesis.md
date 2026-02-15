# 产研汇总: speckit-doc 命令

**特性分支**: `015-speckit-doc-command`
**汇总日期**: 2026-02-15
**输入**: [product-research.md](product-research.md) + [tech-research.md](tech-research.md)
**执行者**: 主编排器（非子代理）

## 1. 产品×技术交叉分析矩阵

| MVP 功能 | 产品优先级 | 技术可行性 | 实现复杂度 | 综合评分 | 建议 |
|---------|-----------|-----------|-----------|---------|------|
| README.md 智能生成（AST + package.json + 项目结构） | P0 | 高 | 中 | ⭐⭐⭐ | 纳入 MVP |
| 交互式开源协议选择（8+ 种协议） | P0 | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| CONTRIBUTING.md 生成 | P1 | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| CODE_OF_CONDUCT.md 生成（Contributor Covenant） | P1 | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| 文档组织模式选择（精简/完整） | P1 | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| 项目元信息自动提取 | P0（基础能力） | 高 | 低 | ⭐⭐⭐ | 纳入 MVP |
| Spec 联动（读取 spec.md 同步功能描述） | P2 | 中 | 中 | ⭐⭐ | 二期 |
| 文档更新模式（--update） | P2 | 中低 | 高 | ⭐ | 二期（触发架构迁移） |
| CHANGELOG.md 生成 | P3 | 高 | 低 | ⭐⭐ | 二期 |
| GitHub 模板生成（Issue/PR Template） | P3 | 高 | 低 | ⭐⭐ | 二期 |

**评分说明**:
- ⭐⭐⭐: 高优先 + 高可行 + 低复杂度 → 纳入 MVP
- ⭐⭐: 中等匹配 → 视资源纳入 MVP 或推迟
- ⭐: 低匹配 → 推迟

**交叉分析要点**:

1. **MVP 6 项核心功能全部获得最高综合评分**：产品需求明确（竞品分析验证）+ 技术方案完全覆盖（Skill-Only 零依赖）+ 实现复杂度可控（1-2 天），三者高度对齐。
2. **`--update` 模式是产品×技术的最大张力点**：产品调研表明这是 Persona 3（深度用户）的核心需求，但技术调研指出方案 A 处理结构化解析不够可靠，可能触发向方案 B 迁移。建议 MVP 阶段仅预埋 HTML 注释标记，不实现更新逻辑。
3. **Spec 联动的产品价值高但时机尚早**：这是 speckit-doc 与竞品的核心差异化点（"规范即文档"），但依赖用户已有 spec.md 文件，初始用户群可能尚未生成 spec。建议二期优先开发。

## 2. 可行性评估

### 技术可行性

**总体评估: 高可行性**

方案 A（Skill-Only）的技术可行性已被 speckit 工具链中 5 个现有 Skill（feature、story、fix、resume、sync）充分验证。文档生成是 LLM 的强项领域，Claude Code Skill prompt 架构完全能胜任 README、CONTRIBUTING、CODE_OF_CONDUCT 等 Markdown 文档的生成。

关键技术路径的可行性：
- **项目元信息提取**: Bash 脚本 + `cat package.json` 即可完成，已在现有 Skill 中使用
- **AST 分析增强**: 通过 `reverse-spec prepare` CLI 命令间接使用 ts-morph，无需新增代码
- **LICENSE 模板**: 静态文件方案，零技术风险
- **交互式选择**: 与 speckit-feature 质量门机制一致，已验证可用

### 资源评估

- **预估工作量**: MVP 1-2 天（Skill prompt 编写 + 辅助脚本 + LICENSE 模板文件 + 测试验证）
- **关键技能需求**: Prompt 工程（Skill 架构经验）、Bash 脚本、Markdown 文档结构设计
- **外部依赖**: 无新增。所有功能基于 Claude Code 内置能力 + 项目现有基础设施

### 约束与限制

- **Constitution 约束**: 项目根目录写入（README.md、LICENSE 等）不在 specs/ 目录内，需要用户明确确认
- **交互限制**: Claude Code Task tool 环境下交互方式为"展示选项 → 用户文本回复"，非传统终端 stdin 交互
- **LLM 输出稳定性**: 方案 A 的文档结构依赖 prompt 约束 LLM 行为，无法保证 100% 确定性输出
- **代码修改禁令**: 根据 CLAUDE.md，spec-driver 方式的需求变更不允许直接修改源代码，speckit-doc 应仅在 `plugins/spec-driver/` 目录下新增文件

## 3. 风险评估

### 综合风险矩阵

| # | 风险 | 来源 | 概率 | 影响 | 缓解策略 | 状态 |
|---|------|------|------|------|---------|------|
| 1 | 交互式选择在 Task tool 中受限 | 技术 | 高 | 中 | Skill prompt 采用"展示选项列表 → 等待用户回复"模式，与质量门机制一致 | 已有方案 |
| 2 | 已有 README.md 覆盖导致内容丢失 | 产品+技术 | 高 | 高 | 默认不覆盖 + diff 预览 + 自动备份 (.bak) + --force 选项 | 已有方案 |
| 3 | LICENSE 文本被 LLM 修改/幻觉 | 技术 | 中 | 高 | LICENSE 文本 100% 使用静态文件，禁止 LLM 生成 | 已有方案 |
| 4 | LLM 生成文档结构不一致 | 技术 | 中 | 中 | Skill prompt 严格定义章节结构 + few-shot 示例 + 二期可引入后处理 | 需监控 |
| 5 | 用户对"AI 生成文档"信任度不足 | 产品 | 中 | 中 | 生成后展示预览/摘要，鼓励用户审阅和编辑；AST 数据增强可信度 | 需监控 |
| 6 | 大型 monorepo AST 分析超时 | 技术 | 低 | 中 | 限制分析范围（入口文件 + src/ 顶层）+ 60s 超时 + 降级路径 | 已有方案 |
| 7 | shields.io Badge URL 格式变化 | 技术 | 低 | 低 | 使用最稳定的基础 URL 格式，集中管理 | 可接受 |
| 8 | 市场验证假设失败（AST 增强价值未被认可） | 产品 | 低 | 中 | MVP 快速验证 + 收集用户反馈 + 必要时调整定位 | 需监控 |

### 风险分布

- **产品风险**: 3 项（高:1 中:1 低:1）
- **技术风险**: 5 项（高:1 中:2 低:2）

**综合风险等级: 中低** — 所有高概率风险均有明确缓解策略，核心技术路径已在现有 Skill 中验证。

## 4. 最终推荐方案

### 推荐架构

**方案 A: Skill-Only 架构（纯 Prompt 驱动）**

综合产品和技术两方面的评估，方案 A 是 MVP 阶段的最优选择：

- **产品角度**: MVP 速度优先，1-2 天快速验证核心价值主张（AST 增强 + AI 生成的一站式文档体验）
- **技术角度**: 零新增依赖、与现有 Skill 架构完全一致、Constitution 约束完全满足
- **风险角度**: 核心功能技术路径已验证，高概率风险已有缓解方案

### 推荐技术栈

| 类别 | 选择 | 理由 |
|------|------|------|
| 编排框架 | Claude Code Skill prompt | 与 speckit-feature 等 5 个现有 Skill 一致，零学习成本 |
| 元数据收集 | Bash 脚本（scan-project.sh） | 轻量、无依赖、可读取 package.json/git/目录结构 |
| AST 分析 | reverse-spec prepare CLI（间接使用 ts-morph） | 复用现有基础设施，无需新增代码 |
| LICENSE 模板 | 静态 .txt 文件（8 种主流协议） | 100% 精确，禁止 LLM 生成 |
| 文档生成 | LLM 直接生成 Markdown | Claude 是 Markdown 生成的最佳工具，质量高 |
| 交互机制 | Skill prompt 选项展示 + 用户回复 | 与质量门机制一致，已验证可用 |

### 推荐实施路径

1. **Phase 1 (MVP)**: README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md 一站式生成，含交互式协议选择和文档模式选择
2. **Phase 2**: Spec 联动 + CHANGELOG.md + GitHub 模板 + Badge 样式自定义
3. **Phase 3**: 文档更新模式（--update，可能触发方案 B 迁移）+ 双语文档 + 自定义模板 + 文档质量评分

## 5. MVP 范围界定

### 最终 MVP 范围

**纳入**:
- **README.md 智能生成**: 核心价值——通过 AST 分析 + package.json + 项目结构生成高质量 README，含标题/badge、描述、功能特性、快速开始/安装、使用示例、项目结构树、技术栈、测试说明、贡献链接、License 声明
- **交互式开源协议选择**: 刚需——支持 MIT、Apache-2.0、GPL-3.0、BSD-2-Clause、BSD-3-Clause、ISC、MPL-2.0、Unlicense 共 8 种协议，自动生成 LICENSE 文件
- **CONTRIBUTING.md 生成**: 社区基础设施——包含开发环境搭建、代码规范、提交规范（Conventional Commits）、PR 流程指南
- **CODE_OF_CONDUCT.md 生成**: 社区基础设施——基于 Contributor Covenant v2.1 模板
- **文档组织模式选择**: 控制复杂度——精简模式（README + LICENSE）vs 完整模式（+ CONTRIBUTING + CODE_OF_CONDUCT）
- **项目元信息自动提取**: 基础能力——从 package.json、git config、目录结构自动收集

**排除（明确不在 MVP）**:
- **Spec 联动**: 依赖用户已有 spec.md，初始用户群可能尚未生成，二期优先
- **文档更新模式（--update）**: 技术复杂度高（HTML 注释标记解析），方案 A 框架下不够可靠，MVP 仅预埋标记
- **CHANGELOG.md 生成**: 非首次开源的核心需求，二期补充
- **双语文档**: 中英双语需求待验证，远期考虑
- **自定义模板**: 可能触发架构迁移，远期考虑

### MVP 成功标准

- 对 3 种不同类型的 Node.js 项目（CLI 工具、npm 库、Web 应用）成功生成完整文档套件
- 生成的 README.md 包含不少于 8 个标准章节（标题、描述、安装、使用、结构、技术栈、贡献、许可证）
- LICENSE 文件与 SPDX 标准文本 100% 一致
- CONTRIBUTING.md 包含项目特定的开发环境搭建指令（自动提取自 package.json scripts）
- 用户从执行命令到获得完整文档套件的端到端时间 < 3 分钟

## 6. 结论

### 综合判断

speckit-doc 是 speckit 工具链的自然延伸，填补了从"需求规范到代码实现到文档生成"闭环中的最后一环。市场调研验证了需求的真实性（93% 开源开发者对不完整文档不满），竞品分析揭示了"AI 驱动 + 全栈文档覆盖"的能力断层。技术方案选择方案 A（Skill-Only 架构）以 MVP 速度优先，1-2 天可交付，零新增依赖，与现有 Skill 架构完全一致。核心差异化点——AST 精确分析增强文档质量——通过间接调用 reverse-spec prepare 命令实现，无需额外开发。建议立即推进 MVP 开发。

### 置信度

| 维度 | 置信度 | 说明 |
|------|--------|------|
| 产品方向 | 高 | 市场需求真实（readme-ai 2.8k stars 验证），差异化点明确（AST + Spec 联动），用户场景覆盖 3 个 Persona |
| 技术方案 | 高 | 方案 A 的技术路径已被 5 个现有 Skill 充分验证，零新增依赖，Constitution 完全满足 |
| MVP 范围 | 高 | 6 项核心功能全部获得最高综合评分，排除项有明确理由，成功标准可测量 |

### 后续行动建议

- 确认推荐方案后，进入需求规范阶段（specify）
- 需求规范阶段应重点定义：README 各章节的精确内容规范、交互流程的详细步骤、LICENSE 模板文件的组织结构
- 建议在 specify 阶段向用户确认：默认文档语言是否为英文（开源社区标准）还是根据项目设置自动推断
