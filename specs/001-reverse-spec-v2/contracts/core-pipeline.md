# API 契约：核心流水线

**模块**：`src/core/`
**覆盖**：FR-001、FR-002、FR-003、FR-004、FR-005、FR-027

---

## ast-analyzer

**文件**：`src/core/ast-analyzer.ts`

### `analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<CodeSkeleton>`

解析单个 TypeScript/JavaScript 文件并返回 CodeSkeleton。

**参数**：
- `filePath` — 源文件的绝对或相对路径
- `options.includePrivate` — 包含非导出符号（默认：`false`）
- `options.maxDepth` — 类继承层级的最大解析深度（默认：`5`）

**返回**：`CodeSkeleton`（参见 [data-model.md](../data-model.md#1-codeskeleton)）

**错误**：
- `FileNotFoundError` — 文件不存在
- `ParseError` — ts-morph 解析失败；自动触发 tree-sitter 降级回退
- `UnsupportedFileError` — 非 TS/JS 文件扩展名

**约束**：
- Constitution I：所有 `ExportSymbol.signature` 值必须来自 AST，绝不由 LLM 生成
- Constitution V：仅使用 ts-morph（npm 包）

---

### `analyzeFiles(filePaths: string[], options?: BatchAnalyzeOptions): Promise<CodeSkeleton[]>`

使用单个 Project 实例对多个文件进行批量分析。

**参数**：
- `filePaths` — 文件路径数组
- `options.concurrency` — 最大并发文件处理数（默认：`50`）
- `options.onProgress` — 进度回调 `(completed: number, total: number) => void`

**返回**：`CodeSkeleton[]`，与输入顺序一致

**性能**：500 个文件 ≤ 10 秒（SC-003）

---

## tree-sitter-fallback

**文件**：`src/core/tree-sitter-fallback.ts`

### `analyzeFallback(filePath: string): Promise<CodeSkeleton>`

针对 ts-morph 解析失败的文件进行容错解析。生成部分骨架，其中 `parseErrors` 字段被填充。

**返回**：`CodeSkeleton`，其中 `parserUsed: 'tree-sitter'`，受影响的符号标记为 `[SYNTAX ERROR]`

---

## context-assembler

**文件**：`src/core/context-assembler.ts`

### `assembleContext(skeleton: CodeSkeleton, options: AssemblyOptions): Promise<AssembledContext>`

在 token 预算内，由骨架 + 依赖 + 代码片段组装 LLM 提示词。

**参数**：
- `skeleton` — 目标模块的主要 CodeSkeleton
- `options.dependencySpecs` — 已生成的依赖规格摘要数组
- `options.codeSnippets` — 用于深度分析的选定复杂函数体
- `options.maxTokens` — token 预算（默认：`100_000`）
- `options.templateInstructions` — LLM 的系统提示词模板

**返回**：
```typescript
interface AssembledContext {
  prompt: string;
  tokenCount: number;
  breakdown: {
    skeleton: number;    // tokens
    dependencies: number;
    snippets: number;
    instructions: number;
  };
  truncated: boolean;
  truncatedParts: string[];  // 被裁剪的部分
}
```

**约束**：
- `tokenCount` 不得超过 `maxTokens`
- 裁剪优先级：snippets → dependencies → skeleton（FR-003）
- Constitution II：必须遵循三阶段流水线

---

## secret-redactor

**文件**：`src/core/secret-redactor.ts`

### `redact(content: string, filePath?: string): RedactionResult`

扫描内容中的敏感信息并替换为语义占位符。

**参数**：
- `content` — 待扫描的源代码字符串
- `filePath` — 可选的文件路径，用于上下文感知过滤（测试文件使用宽松规则）

**返回**：`RedactionResult`（参见 [data-model.md](../data-model.md#8-redactionresult)）

**保证**：
- 高置信度的敏感信息（AWS 密钥、私钥）始终被脱敏
- 占位符保留代码结构：`[REDACTED_AWS_ACCESS_KEY_ID]`
- 对已知占位符值（`your-key-here` 等）不会产生误报
- 符合 FR-027

---

## token-counter

**文件**：`src/core/token-counter.ts`

### `estimateFast(text: string): number`

基于字符的近似估算。约 0.01ms，±15% 精度。支持 CJK 字符。

### `countAccurate(text: string): Promise<number>`

精确 token 计数，带缓存。首次调用约 1-5ms，后续从缓存读取。

### `fitsInBudget(text: string, budget: number): boolean`

使用快速估算加 15% 安全余量进行预算检查。

---

## single-spec-orchestrator

**文件**：`src/core/single-spec-orchestrator.ts`

### `generateSpec(targetPath: string, options?: GenerateSpecOptions): Promise<GenerateSpecResult>`

单模块规格生成的端到端编排。这是 `/reverse-spec` 调用的入口点。

**参数**：

- `targetPath` — 待分析的目录或文件路径
- `options.deep` — 在上下文组装中包含函数体（默认：`false`）
- `options.outputDir` — 输出目录（默认：`.specs`）
- `options.existingVersion` — 用于增量更新的上一版本规格（如规格已存在则自动检测）

**返回**：

```typescript
interface GenerateSpecResult {
  specPath: string;           // 写入的规格文件路径
  skeleton: CodeSkeleton;     // 提取的骨架（可复用）
  tokenUsage: number;         // 消耗的 LLM token 数
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];         // 遇到的非致命问题
  moduleSpec: ModuleSpec;     // 完整的 ModuleSpec 对象，供 batch 的 generateIndex() 使用
}
```

**流水线步骤**：

1. 扫描目标路径中的 TS/JS 文件（`file-scanner`）
2. 对所有文件进行 AST 分析 → `CodeSkeleton[]`（`ast-analyzer`，配合 `tree-sitter-fallback`）
3. 脱敏敏感信息（`secret-redactor`）
4. 在 token 预算内组装 LLM 上下文（`context-assembler`）
5. 调用 Claude API（`llm-client`）→ 原始章节
6. 解析 + 验证 LLM 响应 → `ModuleSpec`
7. 注入不确定性标记（`[推断]`/`[不明确]`/`[SYNTAX ERROR]`）
8. 渲染 Spec：
   1. 生成 Mermaid 类图（`mermaid-class-diagram`）
   2. 调用 `generateDependencyDiagram(mergedSkeleton, skeletons)` 生成依赖关系图（`mermaid-dependency-graph`）
   3. 生成 frontmatter
   4. `fileInventory` 中的路径使用 `path.relative(baseDir, filePath)` 生成相对路径（而非绝对路径）
   5. `mermaidDiagrams` 数组包含类图和依赖图（如有）
   6. 构建 `ModuleSpec` 并通过 Handlebars 渲染（`spec-renderer`）→ 写入 `.specs/*.spec.md`
   7. 在返回的 `GenerateSpecResult` 中包含 `moduleSpec` 字段
9. 将基线骨架序列化至规格中（用于漂移检测 — 参见 US3）

**置信度计算规则**：

`confidence` 由流水线执行结果自动推导，规则如下：

| 条件 | 级别 |
|------|------|
| 零 `parseErrors` 且零 `[推断]`/`[不明确]` 标记且 LLM 正常返回 | `high` |
| 存在 `parseErrors` 或 `[推断]`/`[不明确]` 标记数 > 0 但 ≤ 3，或上下文被截断 | `medium` |
| `parseErrors` 涉及 > 30% 的文件，或 `[推断]`/`[不明确]` 标记数 > 3，或 LLM 降级为 AST-only | `low` |

**约束**：

- Constitution I：所有接口数据来自 AST，绝不由 LLM 生成
- Constitution IV：仅写入 `.specs/` 目录
- Constitution II：必须遵循三阶段流水线
