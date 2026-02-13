# API 契约：LLM 客户端

**模块**：`src/core/`
**文件**：`src/core/llm-client.ts`
**覆盖**：FR-002（生成阶段）、FR-008（不确定性标记）、FR-016（重试/降级）、FR-020（语义差异）

---

## 配置

### `LLMConfig`

```typescript
interface LLMConfig {
  model: string;              // Default: 'claude-opus-4-6'
  apiKey?: string;            // Default: from ANTHROPIC_API_KEY env var
  maxTokensResponse: number;  // Default: 8192
  temperature: number;        // Default: 0.3 (low for factual extraction)
  timeout: number;            // Default: 120_000 (ms)
}
```

**模型选择**：

- 默认模型：`claude-opus-4-6`（Opus），用于所有操作
- 用户可通过 `LLMConfig.model` 参数或 `REVERSE_SPEC_MODEL` 环境变量进行配置
- 优先级：函数参数 > 环境变量 > 默认值
- 接受任何有效的 Anthropic 模型 ID（如 `claude-sonnet-4-5-20250929`、`claude-haiku-4-5-20251001`）

---

## callLLM

### `callLLM(context: AssembledContext, config?: Partial<LLMConfig>): Promise<LLMResponse>`

将组装好的上下文发送至 Claude API 并返回原始响应。

**参数**：

- `context` — `assembleContext()` 的输出（提示词字符串 + token 元数据）
- `config` — 可选的模型、超时时间、温度覆盖配置

**返回**：

```typescript
interface LLMResponse {
  content: string;            // LLM 的原始文本响应
  model: string;              // 实际使用的模型
  inputTokens: number;        // 发送的 token 数
  outputTokens: number;       // 接收的 token 数
  duration: number;           // 请求耗时（毫秒）
}
```

**重试逻辑**（FR-016）：

- 遇到瞬态失败（速率限制、超时、5xx）时：指数退避，基础延迟 2 秒，倍数 2x，最大延迟 30 秒
- 最多共 3 次尝试
- 3 次尝试后仍然失败：抛出 `LLMUnavailableError`
- 由调用方（编排器）决定降级策略（仅 AST 输出）

**错误类型**：

- `LLMUnavailableError` — 重试后仍无法访问 API
- `LLMRateLimitError` — 触发速率限制（触发退避）
- `LLMResponseError` — API 返回非 2xx 状态码
- `LLMTimeoutError` — 请求超过超时时间

---

## parseLLMResponse

### `parseLLMResponse(raw: string): ParsedSpecSections`

将 LLM 的原始响应解析为结构化的规格章节。

**返回**：

```typescript
interface ParsedSpecSections {
  sections: SpecSections;                // 9 个章节内容（中文散文）
  uncertaintyMarkers: UncertaintyMarker[];  // 提取的 [推断]/[不明确] 标记
  parseWarnings: string[];               // 非致命的解析问题
}

interface UncertaintyMarker {
  type: '推断' | '不明确' | 'SYNTAX ERROR';
  section: string;            // 所属的 9 个章节之一
  rationale: string;          // 标记为不确定的原因
}
```

**行为**：

1. 从 LLM 响应中提取 9 个命名章节。章节标题匹配使用多变体容错：每章节 5-6 个中英文变体，归一化后双向包含匹配（`normalizedTitle.includes(normalized) || normalized.includes(normalizedTitle)`）。归一化处理：`toLowerCase()` + 移除 `.、：:，,` 和空格。
2. 验证 9 个章节是否全部存在 — 如缺失，用 `'> 此章节待补充。可通过 \`reverse-spec generate --deep\` 提供更多上下文以改善生成质量。'` 占位符填充
3. 提取并编目所有 `[推断]`/`[不明确]`/`[SYNTAX ERROR]` 标记及其原因（FR-008）
4. **关键**：验证 `接口定义` 章节不包含 AST 骨架中不存在的签名 — 如检测到，剥离捏造条目并添加警告（Constitution I 强制执行）
5. 通过 Zod `SpecSections` 模式验证

**完整章节标题映射**（`SECTION_TITLES`）：

| 章节键 | 标题变体 |
| ------ | ------ |
| `intent` | 意图, Intent, Purpose, 目的, 概述 |
| `interfaceDefinition` | 接口定义, Interface, API, 接口, 导出接口, 公共接口 |
| `businessLogic` | 业务逻辑, Business Logic, 核心逻辑, 实现逻辑, 逻辑 |
| `dataStructures` | 数据结构, Data Structure, 类型定义, 数据模型, 类型 |
| `constraints` | 约束条件, Constraint, 约束, 限制条件, 限制 |
| `edgeCases` | 边界条件, Edge Case, 边界, 异常处理, 错误处理 |
| `technicalDebt` | 技术债务, Technical Debt, 技术债, 改进空间, 待改进 |
| `testCoverage` | 测试覆盖, Test Coverage, 测试, 测试策略, 测试建议 |
| `dependencies` | 依赖关系, Dependenc, 依赖, 模块依赖, 外部依赖 |

**保证**：

- 始终返回有效的 `SpecSections`（对格式不正确的 LLM 输出不会抛出异常 — 优雅降级）
- 支持中文/英文/混合格式的章节标题
- 缺失章节的占位内容包含改善建议（引导用户使用 `--deep` 选项）
- Constitution I：接口章节针对 AST 骨架进行后验证；任何 LLM 捏造的签名都会被移除
- Constitution III：所有不确定性标记及其原因都被保留

---

## buildSystemPrompt

### `buildSystemPrompt(mode: 'spec-generation' | 'semantic-diff'): string`

返回给定操作模式的系统提示词模板。

**模式**：

- `spec-generation` — 指示 LLM 根据骨架 + 上下文填充 9 个中文章节，对不确定内容标记 `[推断]`，绝不捏造接口。提示词约 80 行，包含详细的格式要求：
  - 严格要求 `## N. 章节名` 标题格式
  - 每章节至少 3-5 行，不允许留空或写"无"
  - 接口定义、数据结构、约束条件、技术债务章节要求表格格式
  - 业务逻辑章节必须包含 `flowchart TD` 和 `sequenceDiagram` Mermaid 图表
  - 依赖关系章节必须包含 `graph LR` Mermaid 依赖图
  - 包含"不要偷懒"的明确指令
- `semantic-diff` — 指示 LLM 将新旧函数体与规格意图进行比较，返回结构化的漂移评估（无变更）

**保证**：

- 系统提示词明确指示 LLM 绝不发明或修改接口签名
- 系统提示词要求对所有推断内容添加 `[推断]` 标记
- 系统提示词指定中文散文输出配合英文代码标识符
