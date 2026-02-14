# API 契约更新：LLM 客户端

**Feature**: 005-batch-quality-fixes
**更新对象**: `specs/001-reverse-spec-v2/contracts/llm-client.md`
**涉及文件**: `src/core/llm-client.ts`

---

## 修改：parseLLMResponse

### `parseLLMResponse(raw: string): ParsedSpecSections`

**行为更新**：

| 变更项 | 之前 | 之后 |
|--------|------|------|
| 章节标题匹配 | 每章节 1 个中文标题（如 `['意图']`） | 每章节 5-6 个中英文变体（如 `['意图', 'Intent', 'Purpose', '目的', '概述']`） |
| 匹配算法 | `current.title.includes(t)` | 归一化后双向包含：`normalizedTitle.includes(normalized) \|\| normalized.includes(normalizedTitle)` |
| 归一化处理 | 无 | `toLowerCase()` + 移除 `.、：:，,` 和空格 |
| 缺失章节占位 | `'[LLM 未生成此段落]'` | `'> 此章节待补充。可通过 \`reverse-spec generate --deep\` 提供更多上下文以改善生成质量。'` |

**完整章节标题映射**：

| 章节键 | 标题变体 |
|--------|----------|
| `intent` | 意图, Intent, Purpose, 目的, 概述 |
| `interfaceDefinition` | 接口定义, Interface, API, 接口, 导出接口, 公共接口 |
| `businessLogic` | 业务逻辑, Business Logic, 核心逻辑, 实现逻辑, 逻辑 |
| `dataStructures` | 数据结构, Data Structure, 类型定义, 数据模型, 类型 |
| `constraints` | 约束条件, Constraint, 约束, 限制条件, 限制 |
| `edgeCases` | 边界条件, Edge Case, 边界, 异常处理, 错误处理 |
| `technicalDebt` | 技术债务, Technical Debt, 技术债, 改进空间, 待改进 |
| `testCoverage` | 测试覆盖, Test Coverage, 测试, 测试策略, 测试建议 |
| `dependencies` | 依赖关系, Dependenc, 依赖, 模块依赖, 外部依赖 |

**保证**（更新）：

- 始终返回有效的 `SpecSections`（不因 LLM 输出格式异常而抛出异常）
- 支持中文/英文/混合格式的章节标题
- 缺失章节的占位内容包含改善建议（引导用户使用 `--deep` 选项）

---

## 修改：buildSystemPrompt

### `buildSystemPrompt(mode: 'spec-generation' | 'semantic-diff'): string`

**行为更新**（`spec-generation` 模式）：

| 变更项 | 之前 | 之后 |
|--------|------|------|
| 提示词长度 | 约 20 行简短描述 | 约 80 行详细格式要求 |
| 章节格式 | 仅列出 9 个章节名 | 每个章节的详细格式要求（表格、Mermaid 模板、列表格式） |
| 标题格式 | 无明确要求 | 严格要求 `## N. 章节名` 格式 |
| 内容要求 | 无最低要求 | 每章节至少 3-5 行，不允许留空或写"无" |
| Mermaid 图表 | 未要求 | 业务逻辑章节必须包含 flowchart TD 和 sequenceDiagram，依赖关系章节必须包含 graph LR |
| 表格格式 | 未要求 | 接口定义、数据结构、约束条件、技术债务章节要求表格格式 |
| 不确定性标注 | 有 | 增加"不要偷懒"的明确指令 |

**`semantic-diff` 模式**：无变更。
