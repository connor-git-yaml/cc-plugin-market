# 技术研究笔记: speckit-doc 命令

**Branch**: `015-speckit-doc-command` | **Date**: 2026-02-15 | **Spec**: [spec.md](spec.md)

## Decision 1: 架构方案选型

**Decision**: 方案 A — Skill-Only 架构（纯 Prompt 驱动）

**Rationale**:
1. 与 speckit 工具链现有的 5 个 Skill（feature、story、fix、resume、sync）保持完全一致的实现模式，降低维护认知负担
2. 零新增 TypeScript 运行时依赖，完全满足 Constitution "纯 Node.js 生态、现有依赖优先"约束
3. 文档生成是 LLM 的强项领域，Claude 能产出结构清晰、内容丰富的 Markdown 文档
4. 1-2 天即可完成 MVP，快速验证"AST 增强 + AI 生成的一站式文档体验"的价值主张
5. 所有文件变更仅发生在 `plugins/spec-driver/` 目录内，不修改任何现有源码

**Alternatives Considered**:
- **方案 B（Hybrid 架构）**: Skill 编排 + TypeScript 渲染模块。开发周期 3-5 天，新增 ~500-800 行 TypeScript 代码。输出更确定但成本更高。适合二期当 `--update` 模式和自定义模板需求确认后迁移
- **方案 C（LLM-First + 后处理）**: LLM 生成 + TypeScript 格式校验。折中方案，架构不够纯粹，新增 ~200-300 行 TypeScript。对 MVP 无额外价值

## Decision 2: LICENSE 文本管理方案

**Decision**: 静态 `.txt` 文件，预置 8 种主流协议，存放于 `plugins/spec-driver/templates/licenses/`

**Rationale**:
1. 法律文本必须 100% 精确，LLM 生成存在幻觉风险——这是不可接受的法律合规风险
2. 静态文件方案技术复杂度为零，可靠性 100%
3. 8 种协议覆盖了 npm 生态 95%+ 的项目（MIT 占 ~70%，Apache-2.0 占 ~10%，ISC 占 ~5%，其余分散）
4. 文件以 `{spdx-id}.txt` 命名（如 `MIT.txt`、`Apache-2.0.txt`），便于代码引用
5. 使用占位符 `[year]` 和 `[fullname]` 标记需要动态填充的字段

**Alternatives Considered**:
- **GitHub Licenses API 动态获取**: 需要网络请求，增加失败点。Claude Code 环境中网络可用性不确定。MVP 不采用，二期可作为降级路径
- **LLM 从记忆中生成**: 绝对禁止——法律文本不允许任何程度的 LLM 推理
- **npm 包 spdx-license-list**: 第三方依赖，更新频率低。直接内嵌静态文件更可控

## Decision 3: 项目元信息提取方案

**Decision**: Bash 脚本 `scan-project.sh` 收集元数据，输出结构化 JSON

**Rationale**:
1. Bash 脚本在 Claude Code 沙箱中无需额外配置即可运行
2. 与现有 `init-project.sh` 脚本保持一致的实现模式
3. JSON 输出便于 Skill prompt 解析和使用
4. 降级策略可在脚本内实现——缺少 package.json 时自动降级到 git + 目录结构

**提取范围**:
- package.json: name、version、description、license、author、scripts、dependencies、devDependencies、repository、main、bin
- git config: user.name、user.email、remote.origin.url、默认分支
- 目录结构: 顶层目录树（深度 2）
- 文件检测: 检查 README.md、LICENSE、CONTRIBUTING.md、CODE_OF_CONDUCT.md 是否已存在

**Alternatives Considered**:
- **TypeScript 模块 `project-analyzer.ts`**: 方案 B 的做法，可以更精确地解析 JSON 和处理异常，但违反 Skill-Only 架构原则
- **Skill prompt 直接读取文件**: 可行但效率低——需要多次 Read tool 调用，且目录树生成不够可靠。Bash 脚本一次调用即可收集所有数据

## Decision 4: AST 分析集成方案

**Decision**: 通过 Bash 调用 `reverse-spec prepare` CLI 命令间接使用 ts-morph

**Rationale**:
1. `reverse-spec prepare` 已经封装了 ts-morph 的 AST 分析能力，输出结构化的 JSON 数据
2. 无需在 Skill 中直接引入 ts-morph API，保持 Skill-Only 架构纯粹
3. 支持 TypeScript（.ts）和 JavaScript（.js）项目——ts-morph 原生支持两者
4. 超时降级路径清晰：60 秒超时后降级为纯 package.json 模式

**使用方式**:
```bash
# 在 Skill prompt 中通过 Bash tool 调用
timeout 60 reverse-spec prepare --deep <project-root>/src/ 2>/dev/null || echo '{"error": "ast-timeout"}'
```

**Alternatives Considered**:
- **直接调用 ts-morph API**: 需要 TypeScript 代码，违反方案 A 原则
- **跳过 AST 分析**: 损失 speckit-doc 的核心差异化价值（"AST 增强文档"）
- **tree-sitter 容错分析**: 额外复杂度，ts-morph 已经足够

## Decision 5: 交互式选择实现方案

**Decision**: Skill prompt 中的"展示选项列表 -- 等待用户回复"模式

**Rationale**:
1. 与 speckit-feature 的质量门（GATE）交互机制完全一致，已在生产环境验证
2. Claude Code 的 REPL 模式天然支持这种对话式交互
3. 不需要 stdin 交互式库（如 inquirer、@clack/prompts），避免 Task tool 环境的兼容性问题
4. 用户体验清晰：展示编号列表，用户回复编号或名称即可

**交互流程**:
```text
1. 展示文档模式选项 → 用户选择
2. 展示协议列表（若 package.json 已声明则高亮推荐） → 用户选择
3. 确认生成文件清单 → 用户确认
4. 逐文件冲突检测与处理（如有已存在文件）
```

**Alternatives Considered**:
- **@clack/prompts 交互式 CLI**: 需要 stdin 支持，Task tool 环境不确定，违反零依赖原则
- **全自动无交互**: 损失用户控制权，不符合产品需求（用户需要选择协议和模式）
- **配置文件预设**: MVP 阶段过度设计，可作为二期的"记住上次选择"功能

## Decision 6: 文件冲突处理方案

**Decision**: 逐文件检测 + diff 预览 + 备份覆盖/跳过 二选一

**Rationale**:
1. 完整模式最多 4 个文件，逐文件交互负担极低
2. 给用户最精细的控制权——可以选择覆盖 README 但跳过 LICENSE
3. 备份策略（`.bak` 后缀）确保用户可恢复
4. 默认不覆盖，安全优先

**Alternatives Considered**:
- **全部覆盖/全部跳过 批量选项**: MVP 阶段 4 个文件不需要批量操作，增加交互复杂度
- **智能合并（merge）**: 技术复杂度高，LLM 处理结构化合并不可靠，明确排除在 MVP 之外
- **仅覆盖无 diff 预览**: 不够透明，用户可能误覆盖重要内容

## Decision 7: CODE_OF_CONDUCT.md 版本选择

**Decision**: 默认使用 Contributor Covenant v2.1

**Rationale**:
1. v2.1 是当前最广泛采用的版本，GitHub 官方推荐
2. 大多数主流开源项目（Node.js、React、Angular 等）使用 v2.1
3. 虽然 v3.0 已于 2025-07 发布，但社区迁移仍在进行中，采用最稳定版本更安全
4. 作为静态模板文件存储，后续新增 v3.0 选项成本极低

**Alternatives Considered**:
- **Contributor Covenant v3.0**: 太新，社区采用率不足。可作为二期可选项
- **自定义行为准则**: 超出 MVP 范围，且缺乏标准化优势

## Decision 8: README 中的 HTML 注释标记预埋

**Decision**: 在生成的 README.md 中预埋 `<!-- speckit:section:{name} -->` 格式的 HTML 注释标记

**Rationale**:
1. 为二期 `--update` 功能预留结构化解析锚点
2. HTML 注释在 GitHub Markdown 渲染时完全隐藏，不影响用户阅读体验
3. 标记格式 `speckit:section:{name}` 使用命名空间前缀避免与其他工具冲突
4. 业界已有成熟实践（comment-mark npm 包、readme-auto-update GitHub Action）

**标记规范**:
```markdown
<!-- speckit:section:features -->
## Features
...
<!-- speckit:section:features:end -->
```

**Alternatives Considered**:
- **不预埋标记**: 丢失二期 `--update` 功能的渐进式演进路径
- **YAML frontmatter**: 不适合 README.md，部分平台渲染异常
- **JSON 元数据文件**: 额外文件增加项目噪音

## Decision 9: 文档语言

**Decision**: 所有生成文档（README.md、CONTRIBUTING.md、CODE_OF_CONDUCT.md）默认使用英文

**Rationale**:
1. 开源社区国际化惯例——awesome-readme 最佳实践以英文为主
2. LICENSE 文件原文为英文，与其他文档语言保持一致
3. shields.io badge 和技术术语天然为英文
4. 产研汇总已确认此决策

**Alternatives Considered**:
- **中文文档**: 受众面窄，不符合开源社区惯例
- **双语文档**: 产品路线图中的远期功能，MVP 不实现
