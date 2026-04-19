---
feature: F3 Debt Intelligence — 技术债引擎
phase: plan
branch: 130-debt-intelligence
depends_on:
  - specs/130-debt-intelligence/spec.md
---

# F3 技术设计

## 1. 总体架构

新增三层结构：

```
src/debt-scanner/                         # 领域模块（独立于 panoramic，可独立测试）
  types.ts                                # DebtEntry / OpenQuestionEntry / DebtReport
  comments/
    comment-regions.ts                    # 输入：源文本 + AST-derived 注释 regions → 输出：CommentNode[]
    debt-classifier.ts                    # kind = TODO/FIXME/HACK/XXX/NOTE，severity 映射
    symbol-resolver.ts                    # 根据 line 定位 containingSymbol（用 CodeSkeleton.symbols）
  design-docs/
    doc-discoverer.ts                     # glob README/architecture/notes/design.md
    markdown-sections.ts                  # 解析 heading tree + 段落
    rule-detector.ts                      # 规则命中：显式标记 + 问号结尾段落
    llm-topic-inferrer.ts                 # 可选 LLM 主题推断（走 llm-client + budget）
  aggregator/
    report-builder.ts                     # 拼装 technical-debt.md
    quality-report-patcher.ts             # 追加 "## 技术债" 节到 quality-report.md
    readme-indexer.ts                     # specs/README.md 插入链接（若存在）
  index.ts                                # scanProjectDebt(options): Promise<DebtReport>

src/utils/git-blame.ts                    # 轻量 wrapper：getLineBlame(file, line) => {author, commitDate}

src/panoramic/pipelines/
  debt-intelligence-pipeline.ts           # generateDebtIntelligence(options) — batch-orchestrator 入口

src/adapters/                             # 扩展（非破坏性）
  language-adapter.ts                     # 接口新增 extractComments(filePath): CommentRegion[]
  ts-js-adapter.ts / python-adapter.ts / ... # 各自实现
```

## 2. 关键接口

### 2.1 LanguageAdapter 扩展

```typescript
// src/adapters/language-adapter.ts 追加
export interface CommentRegion {
  kind: 'line' | 'block';
  text: string;           // 已去掉注释起始/结束标记
  startLine: number;      // 1-indexed
  endLine: number;
}

export interface LanguageAdapter {
  // ... existing fields
  /**
   * 提取源文件中所有注释 region（排除字符串字面量里的 "TODO" 等）。
   * 默认实现返回空数组，具体 adapter 覆盖。
   */
  extractComments?(filePath: string): Promise<CommentRegion[]>;
}
```

**策略**：
- TypeScript/JavaScript：用 ts-morph（已有依赖）的 `sourceFile.getDescendants()` 遍历，`node.getLeadingCommentRanges()` + `node.getTrailingCommentRanges()` 采集；去重（按 pos）
- Python：用现有 python adapter 的 tree-sitter parser；tree-sitter-python 有 `(comment)` 节点，直接 tree query
- Go：tree-sitter-go `(comment)` query
- Java：tree-sitter-java `(line_comment)` 和 `(block_comment)` query

**降级**：如果 adapter 没实现 `extractComments`，pipeline 跳过该文件并记入 diagnostics。

### 2.2 debt-scanner 主入口

```typescript
// src/debt-scanner/index.ts
export interface ScanOptions {
  projectRoot: string;
  specsDir: string;                  // 输出目录
  languageAdapters: LanguageAdapterRegistry;
  llmClient?: LLMClient;             // 注入 llm-client，便于测试替身
  budgetLimit?: number;              // 从 BatchOptions 透传
  dryRun?: boolean;
  logger?: Logger;
}

export interface DebtReport {
  codeEntries: CodeDebtEntry[];
  openQuestions: OpenQuestionEntry[];
  diagnostics: DebtDiagnostics;
  metrics: DebtMetrics;
  tokenUsage: TokenUsage;
  durationMs: number;
  llmModel?: string;
  fallbackReason?: string;
}

export async function scanProjectDebt(opts: ScanOptions): Promise<DebtReport>;
```

### 2.3 Pipeline 入口（batch-orchestrator 集成）

```typescript
// src/panoramic/pipelines/debt-intelligence-pipeline.ts
export interface DebtPipelineOptions {
  projectRoot: string;
  specsDir: string;
  languageAdapters: LanguageAdapterRegistry;
  llmClient?: LLMClient;
  budgetLimit?: number;
  dryRun?: boolean;
}

export interface DebtPipelineResult {
  generated: boolean;                // 是否写入 technical-debt.md
  entriesCount: number;
  openQuestionsCount: number;
  tokenUsage: TokenUsage;
  durationMs: number;
  outputPath: string | null;
  diagnostics: string[];
}

export async function generateDebtIntelligence(
  options: DebtPipelineOptions
): Promise<DebtPipelineResult>;
```

### 2.4 batch-orchestrator 集成点

`runBatch()` 在生成其他 product docs 之后（`generateBatchProjectDocs` / `orchestrateDocsBundle` 附近），追加：

```typescript
if (options.enableDebtIntelligence !== false) {
  const debtResult = await generateDebtIntelligence({
    projectRoot: options.projectRoot,
    specsDir: options.specsDir,
    languageAdapters: LanguageAdapterRegistry.getInstance(),
    llmClient: options.llmClient,
    budgetLimit: options.budgetLimit,
    dryRun: options.dryRun,
  });
  result.debt = debtResult;
  costRecords.push({
    moduleLabel: 'debt-intelligence',
    tokenUsage: debtResult.tokenUsage,
    durationMs: debtResult.durationMs,
  });
}
```

**BatchOptions 新字段**：`enableDebtIntelligence?: boolean`（默认 true）。
**BatchResult 新字段**：`debt?: DebtPipelineResult`。

## 3. 算法细节

### 3.1 代码注释债务（Story 1）

```
for file in languageAdapters.listSourceFiles(projectRoot):
  regions = adapter.extractComments(file)      # AST-based
  for region in regions:
    for match in classifyComment(region.text):
      entry = {
        kind: match.kind,                      // TODO/FIXME/HACK/XXX/NOTE
        severity: severityMap[match.kind],     // critical(FIXME,HACK), warning(TODO), info(NOTE,XXX)
        text: match.message,
        filePath: relative(projectRoot, file),
        line: region.startLine + match.lineOffset,
        symbol: resolveSymbol(ast, line),      // nearest enclosing function/class name
        author: gitBlame(file, line).author,
        ageDays: daysSince(gitBlame(file, line).commitDate),
      }
      codeEntries.push(entry)

排序：(severity asc, ageDays desc, filePath asc, line asc)
```

**debt-classifier 正则**（只在注释文本内部应用，不接触源码）：
```
/^[\s\*/#]*(TODO|FIXME|HACK|XXX|NOTE)(\([\w@.-]+\))?\s*:?\s*(.*)$/mi
```

### 3.2 Design-doc Open Questions（Story 2）

```
docs = discoverDesignDocs(projectRoot)          // README.md, architecture.md, notes.md, design.md
for doc in docs:
  sections = parseMarkdownSections(doc)
  for section in sections:
    for para in section.paragraphs:
      if ruleMatch(para):                       // 规则命中
        openQuestions.push({ ...entry, inferredTopic: null })
      elif endsWithQuestionMark(para):          // 候选，待 LLM 仲裁
        candidates.push({ para, section })

if llmClient && !dryRun && candidates.length > 0:
  estimated = estimateTokens(candidates)
  if budgetAllowed(estimated):
    llmResult = await llmClient.callLLM({
      prompt: buildBatchPrompt(candidates),
      model: 'haiku' or 'sonnet'
    })
    for c in llmResult.confirmed:
      openQuestions.push({ ...c, inferredTopic: c.topic })
  else:
    fallbackReason = 'budget-exhausted'
else:
  fallbackReason = candidates.length > 0 ? 'dry-run' : undefined

规则命中条目的 inferredTopic：用 LLM 补充（同一 batch 请求），budget 不足时为空字符串 + diagnostics 记录
```

**LLM Prompt 结构**（JSON-only response）：
```
Given these candidate sentences from a design doc, for each:
1. Is this an actual OPEN QUESTION (not rhetorical)?
2. If yes, return 1-3 short topic keywords.

Candidates:
[{"id": "c1", "text": "...", "context": "## Open Questions"}, ...]

Return: {"results": [{"id": "c1", "isOpenQuestion": true, "topics": ["validation", "parser"]}, ...]}
```

### 3.3 技术债文档生成（Story 3）

`report-builder.ts` 产出 Markdown：

```markdown
---
generated: true
tokenUsage: { input: N, output: M }
durationMs: X
llmModel: haiku | null
fallbackReason: null | "budget-exhausted" | "dry-run"
---

# 技术债清单

> 由 Spectra debt-intelligence pipeline 生成。本次扫描范围：{N} 个源文件（{langs}）；{M} 个 design-doc。

## 概要

- **代码注释债务**：{total} 条（TODO {n}，FIXME {n}，HACK {n}，NOTE {n}，XXX {n}）
- **Design-doc 开放问题**：{total} 条
- **年龄分布**：< 30天 {n} | 30-90天 {n} | 90-180天 {n} | > 180天 {n}
- **最老 5 条**：...

## 代码注释债务

| # | Kind | 文件 | 行 | 符号 | 作者 | 年龄(天) | 描述 |
|---|------|------|-----|------|------|----------|------|
...

## Design-doc 开放问题

### README.md
...

## 引用清单
...
```

### 3.4 quality-report 追加（Story 4）

`quality-report-patcher.ts` 读取 `<specsDir>/project/quality-report.md`，定位 `## Required Docs` 节末尾，插入：

```markdown
## 技术债

- 总条目数：{total}
- 按 kind：TODO {n} / FIXME {n} / HACK {n} / NOTE {n} / XXX {n}
- 代码债务密度：{density} 条/kLOC
- 最老条目：{ageDays} 天

详情见 [technical-debt.md](technical-debt.md)。
```

若 `quality-report.md` 不存在：跳过追加，不报错。
若 `technical-debt.md` 未生成（扫描结果为空）：不追加该节。

### 3.5 git-blame utility

```typescript
// src/utils/git-blame.ts
export interface BlameInfo {
  author: string;          // "uncommitted" if line未 committed
  commitDate: Date | null;
  ageDays: number;         // 0 if uncommitted
}

export async function getLineBlame(filePath: string, line: number): Promise<BlameInfo>;
```

**实现**：`child_process.spawn('git', ['blame', '-L', `${line},${line}`, '--porcelain', filePath])`，解析 `author` 和 `author-time` 字段。任何错误（非 git repo、file uncommitted）返回 `{ author: 'uncommitted', commitDate: null, ageDays: 0 }`，不抛异常。

**性能**：缓存同一文件的多行调用结果（一次 `git blame file` 获取全文件 blame，内存 map 按 line 查）。

## 4. 测试策略

| 测试层 | 文件 | 覆盖 |
|--------|------|------|
| Unit | `tests/debt-scanner/debt-classifier.test.ts` | TODO/FIXME 正则边界、大小写、冒号可选 |
| Unit | `tests/debt-scanner/rule-detector.test.ts` | 显式标记识别 + 疑问句识别 |
| Unit | `tests/debt-scanner/report-builder.test.ts` | 输出格式、排序稳定性、空状态 |
| Unit | `tests/debt-scanner/quality-report-patcher.test.ts` | 追加节、幂等、文件缺失 |
| Unit | `tests/utils/git-blame.test.ts` | uncommitted fallback、parse porcelain |
| Unit | `tests/adapters/extract-comments.test.ts` | 每个 adapter 的 extractComments 正确性（含字符串字面量排除） |
| Integration | `tests/integration/debt-pipeline.test.ts` | pipeline 端到端，在 tmp fixture 上 |
| Integration | `tests/integration/debt-on-graphify.test.ts` | 对 graphify 示例跑，断言 open questions ≥ 3 |

**LLM 在测试里用 mock**：提供 `StubLLMClient`，测试不发起真实调用。

## 5. 风险与对策

| 风险 | 可能性 | 对策 |
|------|--------|------|
| `extractComments` 在 4 个 adapter 的实现差异导致边界 case 不一致 | 中 | 通过 `tests/adapters/extract-comments.test.ts` 用同一组 fixtures 验证 |
| LLM budget 耗尽导致 open question 主题空白 | 中 | 允许 inferredTopic 为空字符串，降级路径已在 AC-2.7 定义 |
| git blame 在 CI 无 git 环境下失败 | 低 | 所有 git 调用均 try-catch，默认返回 uncommitted |
| 大项目扫描性能慢 | 低 | 并发限制 8（借用 batch-orchestrator 的 concurrency 策略）+ git blame 按文件缓存 |
| quality-report.md 格式漂移导致 patcher 找不到锚点 | 低 | patcher 按 `^## Required Docs` 精确匹配；找不到则追加到末尾，不报错 |

## 6. 迁移与向后兼容

- 所有新增代码为**增量**，不改变任何现有 API 签名
- `LanguageAdapter.extractComments` 为可选方法（`?`），现有 adapter 不强制实现（但本 feature 为 4 个 adapter 都实现）
- `BatchOptions.enableDebtIntelligence` 默认 true；需要关闭（如 CI 加速）时 explicit 设 false
- 不影响 Wave 1 的 frontmatter schema（新 pipeline 的 tokenUsage 等字段沿用 Wave 1 格式）

## 7. 不做

- 不修改 `specs/_meta/graph.json` 或任何图 schema（F4 领地）
- 不实现自动修复建议
- 不实现跨 batch 趋势详细对比（AC-4.4 的简单差值作为 stretch goal，若代码量增加 > 200 LoC 则 defer）
- 不对 design-doc 的 Markdown 深度 AST 解析（仅 heading + paragraph 足够，不做表格/列表特殊处理）
