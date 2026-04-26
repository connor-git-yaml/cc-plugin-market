# Phase 2 Postmortem — 修复规划

**Feature**: 133-fix-postmortem-phase2
**Mode**: spec-driver fix
**Strategy**: 5 批独立 commit（依赖顺序：P0-1 → P0-3 → P1-1 → P0-2 → P2-1）

## 总体技术方案

### 设计原则

1. **最小破坏面**：每个修复只动其根因点，不顺手清理无关代码（spec-driver fix 约束）
2. **测试先行**：每批的新增测试必须在同 commit 内提交（CLAUDE.md 行为约定）
3. **真实集成测试覆盖**：避免 mock-only 通过、生产失败的问题（针对 P0-1 教训）
4. **批次原子化**：每批可独立 revert 而不破坏其他批次
5. **commit 粒度**：每批 1 个 commit，不分多个；commit message 含"P0-1/P0-2/..."标识

### 依赖顺序证明

```
Batch 1 (P0-1 token)
    ↓ token 链路修复后
Batch 2 (P0-3 model 升级)
    ↓ Sonnet 4.6 默认后，后续测试成本降低
Batch 3 (P1-1 hyperedges 接通)
    ↓ 验证 graph.json 含 hyperedges
Batch 4 (P0-2 reading 模式分派)
    ↓ 把 reading SC-001 拉到 <120s
Batch 5 (P2-1 sourceKind，可选)
```

理由：
- **Batch 1 必须最先**：P0-1 修复后才能在后续批次的测试里观察 token 数据，否则一切关于"实际成本"的断言都不可靠
- **Batch 2 紧跟**：模型升级影响 timeout、preset 行为、Codex 别名；先升级让后续批次的 perf 测试落在新基线上
- **Batch 3 依赖 Batch 2**：anchor + hyperedge 集成调用 LLM，新模型默认下成本可控
- **Batch 4 依赖 Batch 3**：reading 模式 perf 测试要看 graph.json 是否有 hyperedges（reading 模式不应跳过 graph 持久化层，但应跳过模块 spec enrichment 和产品文档层）
- **Batch 5 独立**：sourceKind 是单纯的 frontmatter 字段，可在任何位置插入

## Batch 1: P0-1 token 提取修复

### 目标

修复 cli-proxy.ts 解析 stream-json 时 token 字段读取错误，让 frontmatter 的 tokenUsage 在 CLI proxy 路径下也能正确写入。

### 改动清单

| 文件 | 类型 | 改动摘要 |
|------|------|----------|
| `src/auth/cli-proxy.ts` | 修改 | StreamMessage 类型增加 `usage?: { input_tokens?, output_tokens? }`；parseStreamJsonOutput 优先读 `msg.usage.*`，回落到顶层（向后兼容） |
| `tests/auth/cli-proxy.usage-extraction.test.ts` | 新建 | 4 个 case：嵌套 usage / 顶层兼容 / 缺失 / 混合多事件 |
| `tests/integration/cli-proxy.real-stream.test.ts` | 新建 | 真实 Anthropic SDK 调用回归（`vi.skipIf(!ANTHROPIC_API_KEY)`） |

### 关键代码片段

**新 StreamMessage 类型**（cli-proxy.ts L33-50）:

```typescript
interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
  model?: string;
  /**
   * Claude CLI 实际输出格式：result 类型 message 把 token 嵌套在 usage 下
   * 旧格式（顶层 input_tokens/output_tokens）保留作为向后兼容
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  input_tokens?: number;   // 兼容旧格式
  output_tokens?: number;  // 兼容旧格式
  content_block?: { type: string; text?: string; };
  delta?: { type: string; text?: string; };
  message?: string;
  content?: string;
}
```

**新 parseStreamJsonOutput 解析**（cli-proxy.ts L243-249 区段）:

```typescript
if (msg.type === 'result') {
  if (msg.result) content = msg.result;
  if (msg.model) model = msg.model;
  // 优先嵌套 usage（Claude CLI 当前格式），回落顶层（向后兼容）
  const inputFromUsage = msg.usage?.input_tokens;
  const outputFromUsage = msg.usage?.output_tokens;
  if (inputFromUsage !== undefined) {
    inputTokens = inputFromUsage;
  } else if (msg.input_tokens !== undefined) {
    inputTokens = msg.input_tokens;
  }
  if (outputFromUsage !== undefined) {
    outputTokens = outputFromUsage;
  } else if (msg.output_tokens !== undefined) {
    outputTokens = msg.output_tokens;
  }
  continue;
}
```

### 测试设计

**单测**（cli-proxy.usage-extraction.test.ts）覆盖：

1. **case-nested**：mock stream 含 `{type: "result", usage: {input_tokens: 100, output_tokens: 200}}` → 期望 LLMResponse `inputTokens=100, outputTokens=200`
2. **case-top-level (向后兼容)**：mock stream 含 `{type: "result", input_tokens: 100, output_tokens: 200}`（旧格式）→ 期望 `inputTokens=100, outputTokens=200`
3. **case-mixed**：嵌套 usage 优先于顶层（防止两种格式同时出现时混淆）
4. **case-missing**：result 不含任何 token 字段 → 期望 `inputTokens=0, outputTokens=0`（不抛错）

**集成测试**（cli-proxy.real-stream.test.ts）：

```typescript
import { describe, it, expect } from 'vitest';
import { callLLMviaCli } from '../../src/auth/cli-proxy.js';

describe.skipIf(!process.env['ANTHROPIC_API_KEY'])('cli-proxy real stream', () => {
  it('extracts usage from real Claude CLI stream-json output', async () => {
    const response = await callLLMviaCli('Say "hi" in 1 word.', {
      model: 'claude-haiku-4-5-20251001',
      timeout: 60_000,
    });
    expect(response.inputTokens).toBeGreaterThan(0);
    expect(response.outputTokens).toBeGreaterThan(0);
    expect(response.content.length).toBeGreaterThan(0);
  }, 90_000);
});
```

注：集成测试需 Claude CLI 已登录或 ANTHROPIC_API_KEY；CI 在无 secret 时自动 skip。

### 验证

- `npx vitest run tests/auth/` 全绿
- 在有 ANTHROPIC_API_KEY 的本地环境：`ANTHROPIC_API_KEY=$KEY npx vitest run tests/integration/cli-proxy.real-stream.test.ts` 全绿
- `npm run build` 零错误

### Commit message

```
fix(133): cli-proxy 从嵌套 usage 字段提取 token (P0-1)

Phase 2 集成回归发现：所有 module spec frontmatter 的 tokenUsage 全为 0，
但 LLM 真调用了。根因是 cli-proxy.ts 的 StreamMessage 类型把 input_tokens /
output_tokens 当作 result 类型 message 的顶层字段，但 Claude CLI 实际输出
嵌套在 usage.* 下；mock-only 测试沿用相同错误假设导致单测全过却生产失败。

修复：
- StreamMessage 类型增加 usage 嵌套字段
- parseStreamJsonOutput 优先从 msg.usage.* 读，回落顶层（向后兼容）
- 新增单测 cli-proxy.usage-extraction.test.ts（4 case）
- 新增真实集成测试 cli-proxy.real-stream.test.ts（vi.skipIf 守卫）

下游影响：cost-summary 的"未调用 LLM"误报会自动消失；frontmatter
tokenUsage 在 CLI proxy 路径下恢复正常。
```

## Batch 2: P0-3 model 升级

### 目标

把默认 Claude 模型升级到 Sonnet 4.6 / Opus 4.7，并把 `balanced` preset 从 opus 改为 sonnet。

### 改动清单

| 文件 | 类型 | 改动摘要 |
|------|------|----------|
| `src/core/model-selection.ts` | 修改 | 4 个常量值更新（含 DEFAULT_CODEX_ALIASES 中的 opus 别名条目） |
| `tests/core/model-selection.test.ts` | 修改 | 更新 expected model id |
| `CHANGELOG.md` | 修改 | 新增 Unreleased breaking change 节 |

### 关键改动（model-selection.ts L6-25）

```typescript
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';  // 旧: 'claude-sonnet-4-5-20250929'

const LOGICAL_CLAUDE_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-7',    // 旧: 'claude-opus-4-1-20250805'
  sonnet: DEFAULT_CLAUDE_MODEL,
  haiku: 'claude-haiku-4-5-20251001',
};

const PRESET_MODEL_MAP: Record<string, string> = {
  balanced: 'sonnet',          // 旧: 'opus'
  'quality-first': 'opus',
  'cost-efficient': 'sonnet',
};

const DEFAULT_CODEX_ALIASES: Record<string, string> = {
  // ... 其他不变
  'claude-opus-4-7': DEFAULT_CODEX_MODEL,    // 旧: 'claude-opus-4-6' → 'claude-opus-4-7'
  'claude-opus-4-1-20250805': DEFAULT_CODEX_MODEL,  // 保留旧值（兼容历史 spec）
  'claude-sonnet-4-6': DEFAULT_CODEX_MODEL,  // 新增
  'claude-sonnet-4-5-20250929': DEFAULT_CODEX_MODEL,  // 保留兼容
  'claude-haiku-4-5-20251001': DEFAULT_CODEX_MODEL,
};
```

### 1M context beta header

调研结论：**Opus 4.7 / Sonnet 4.6 的 1M context 默认即可使用，无需 beta header**。所以 `src/core/llm-client.ts` 不需要改动。

### 测试更新

`tests/core/model-selection.test.ts` 中：
- 把 `expected: 'claude-sonnet-4-5-20250929'` 全部替换为 `'claude-sonnet-4-6'`
- 把 `expected: 'claude-opus-4-1-20250805'` 全部替换为 `'claude-opus-4-7'`
- 把 balanced preset 期望从 opus 改为 sonnet

### CHANGELOG 文案

```markdown
## [Unreleased]

### Breaking changes

- 默认 Claude 模型升级（Feature 133）：
  - `DEFAULT_CLAUDE_MODEL`: `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6`
  - 逻辑名 `opus`: `claude-opus-4-1-20250805` → `claude-opus-4-7`（自带 1M context）
  - `balanced` preset 现映射到 `sonnet`（旧映射 `opus`），与 `cost-efficient` 等价；
    `quality-first` 仍指 `opus`
- 影响：未显式指定 model 的项目，下次运行会切换到新模型。
  - 建议：在 `spec-driver.config.yaml` 显式 pin model 以避免漂移
```

### 验证

- `npx vitest run tests/core/model-selection*` 全绿
- `npm run build` 零错误
- 全量 `npx vitest run` 零新增失败

### Commit message

```
feat(133)!: 默认模型升级到 Sonnet 4.6 + Opus 4.7 1M (P0-3)

升级默认 Claude 模型至最新 4.6/4.7 系列，把 balanced preset 默认改为 sonnet
（基于用户决策：sonnet 4.6 已足够强且成本远低于 opus，应当作为默认推荐）。

变更：
- DEFAULT_CLAUDE_MODEL: claude-sonnet-4-5-20250929 → claude-sonnet-4-6
- LOGICAL_CLAUDE_MODEL_MAP.opus: claude-opus-4-1-20250805 → claude-opus-4-7
- PRESET_MODEL_MAP.balanced: opus → sonnet
- DEFAULT_CODEX_ALIASES 同步更新
- 1M context 默认可用，无需 beta header

BREAKING CHANGE: 未显式 pin model 的项目下次运行会切换到新模型。
quality-first preset 仍指 opus，不受影响。
```

## Batch 3: P1-1 anchor + hyperedge 集成

### 目标

在 batch-orchestrator 的图谱持久化流程中接入 `runAnchorIntegration` 和 `runHyperedgeIntegration`，让 graph.json 真正包含 references / conceptually_related_to / rationale_for 边和 hyperedges。

### 改动清单

| 文件 | 类型 | 改动摘要 |
|------|------|----------|
| `src/batch/batch-orchestrator.ts` | 修改 | 在 `buildKnowledgeGraph` 之前调用两个集成 runner，把结果合并入 docGraph 或直接传入 buildKnowledgeGraph |
| `src/batch/types.ts` 或 BatchOptions | 修改 | 增加 `hyperedgesEnabled?: boolean`（默认 true，让 reading 模式也能保留这个能力，因为 hyperedges 只调用一次轻量 LLM） |
| `tests/batch/graph-hyperedges.regression.test.ts` | 新建 | E2E 集成测试，断言 graph.json 含 hyperedges 字段非空 + references 边类型 |

### 关键代码片段

**batch-orchestrator.ts 在图谱构建前注入**（约 L905 处）：

```typescript
// Feature 133 P1-1：anchor + hyperedge 集成接通
let anchorEdges: GraphEdge[] = [];
let hyperedgesList: Hyperedge[] = [];
let anchorTokenUsage: EmbeddingTokenUsage[] = [];

try {
  // 收集 design-doc chunks（来自 specs/products/**/*.md 等已有产出）
  const docPaths = collectDesignDocPaths(resolvedRoot, resolvedOutputDir);
  if (docPaths.length > 0) {
    const docChunks = chunkMarkdownFiles(docPaths, resolvedRoot);
    const codeNodes = buildCodeNodesFromGraph(mergedGraph);

    // anchor 集成（references / conceptually_related_to）
    const anchorResult = await runAnchorIntegration({
      anchorEnabled: true,
      docChunks,
      codeNodes,
      projectRoot: resolvedRoot,
      embeddingProvider: createDefaultEmbeddingProvider(),
    });
    anchorEdges = anchorResult.edges;
    anchorTokenUsage.push(...anchorResult.tokenUsage);

    // hyperedge 集成（rationale_for via LLM）
    const hyperedgesEnabled = options.hyperedgesEnabled
      ?? (process.env['SPECTRA_HYPEREDGES_ENABLED'] !== 'false');
    const hyperResult = await runHyperedgeIntegration({
      hyperedgesEnabled,
      docChunks,
      graphNodes: codeNodes,
      projectSummary: projectDocsResult?.architectureIR?.summary,
    });
    hyperedgesList = hyperResult.hyperedges;
    anchorTokenUsage.push(...hyperResult.tokenUsage);
  }
} catch (anchorErr) {
  logger.warn(`anchor/hyperedge 集成失败，跳过: ${String(anchorErr)}`);
}

const graphJson = buildKnowledgeGraph({
  architectureIR: projectDocsResult?.architectureIR,
  docGraph,
  crossReferenceLinks,
  extractionResults,
  anchorEdges,        // 新增
  hyperedges: hyperedgesList,  // 新增
});
```

**buildKnowledgeGraph 接受新参数**：在 graph-persistence 模块中扩展接口（如已存在则验证字段名）。

### 测试设计

**回归测试**（graph-hyperedges.regression.test.ts）：

```typescript
describe('graph.json hyperedges 集成回归', () => {
  it('在 fixture 项目上生成的 graph.json 含至少 1 个 hyperedge 和 references 边', async () => {
    const fixtureDir = path.join(__dirname, '../fixtures/graphify-mini');
    const outputDir = path.join(os.tmpdir(), `graph-test-${Date.now()}`);

    await runBatch(fixtureDir, { outputDir, mode: 'full' });

    const graphPath = path.join(outputDir, '_meta/graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));

    expect(Array.isArray(graph.hyperedges)).toBe(true);
    expect(graph.hyperedges.length).toBeGreaterThanOrEqual(1);

    const refEdges = graph.edges.filter(
      (e) => e.relation === 'references' || e.relation === 'rationale_for'
    );
    expect(refEdges.length).toBeGreaterThanOrEqual(1);
  });
});
```

注：fixture `tests/fixtures/graphify-mini/` 在 Batch 4 创建（reading 模式 perf 测试也用同一个），本批次先创建一个最小版本。

### 验证

- 新增回归测试通过
- 全量 `npx vitest run` 零新增失败
- `npm run build` 零错误

### Commit message

```
fix(133): batch 接通 anchor + hyperedge 集成 (P1-1)

Phase 2 集成回归发现：graph.json 缺失 F4 承诺的 references /
conceptually_related_to / rationale_for 边类型；hyperedges 数组为空。

根因：F4 实现了 runAnchorIntegration + runHyperedgeIntegration 集成接口
作为公开 export，但 batch-orchestrator 在 buildKnowledgeGraph 之前从未
调用过它们；F4 单测仅验证集成函数本身，没有 E2E 测试验证 graph.json
最终内容含有这些字段。

修复：
- 在 batch-orchestrator.ts 图谱持久化前调用两个 runner
- 合并 anchorEdges 和 hyperedges 入 buildKnowledgeGraph
- 新增 graphify-mini fixture（5 Python 文件 + 1 design doc）
- 新增 graph-hyperedges.regression.test.ts 回归守卫

降级保护：anchor/hyperedge 集成失败 → warn 日志 + 继续生成无新边的
graph.json，不阻断 batch 主流程。
```

## Batch 4: P0-2 reading 模式真正跳过

### 目标

把 reading 模式总耗时拉到 < 120s（5 文件 fixture），通过：
1. 扩展 `READING_SKIP_IDS` 集合，跳过所有产品文档层 generator
2. batch-orchestrator 在 reading/code-only 模式下给 `generateSpec` 传 `skipEnrichment: true`
3. 可选：在 reading 模式下用 sonnet 而非 opus 做模块 spec（通过 modelOverride）

### 改动清单

| 文件 | 类型 | 改动摘要 |
|------|------|----------|
| `src/panoramic/batch-project-docs.ts` | 修改 | READING_SKIP_IDS 扩展至与 CODE_ONLY_SKIP_IDS 等价 |
| `src/batch/batch-orchestrator.ts` | 修改 | reading/code-only 时给 generateSpec 传 `skipEnrichment: true` |
| `tests/fixtures/graphify-mini/` | 新建 | 5 个 Python 文件 + 1 design doc |
| `tests/batch/reading-mode.perf.test.ts` | 新建 | E2E perf 回归测试（< 120s 阈值） |
| `tests/panoramic/batch-project-docs.test.ts` | 更新 | READING_SKIP_IDS 期望集合 |

### 关键改动

**batch-project-docs.ts L90-96**（扩展 READING_SKIP_IDS）：

```typescript
// F5：reading 模式跳过的 generator ID 集合（产品文档层 + 架构推断层）
// Feature 133 P0-2 修复：原集合不完整，导致 reading 模式实测 1047s 远超 120s SLA
const READING_SKIP_IDS = new Set([
  // 原有
  'adr-pipeline',
  'product-ux-docs',
  'troubleshooting',
  'data-model',
  'docs-quality-evaluator',
  // 新增（产品文档层）
  'product-overview',
  'user-journeys',
  'feature-briefs',
  // 新增（架构推断层 — reading 模式不需要这些重型推断）
  'architecture-overview',
  'architecture-narrative',
  'architecture-ir',
  'pattern-hints',
  'event-surface',
  'runtime-topology',
  'component-view',
  'dynamic-scenarios',
]);

// code-only 与 reading 在 generator skip 上等价；保留独立常量便于未来分化
const CODE_ONLY_SKIP_IDS = new Set([...READING_SKIP_IDS]);
```

**batch-orchestrator.ts**（约 L671-716，单文件 root 模块路径 + 多文件目录模块路径）：

```typescript
const result = await generateSpec(targetPath, {
  ...genOptions,
  existingVersion: storedSpecByTarget.get(moduleSourceTarget)?.version,
  // Feature 133 P0-2：reading/code-only 模式跳过 enrichment
  skipEnrichment: effectiveMode === 'reading' || effectiveMode === 'code-only',
});
```

同样的 `skipEnrichment: effectiveMode !== 'full'` 也加到 root 模块的 generateSpec 调用处（L671 附近）。

### Perf 回归测试

```typescript
// tests/batch/reading-mode.perf.test.ts
describe('reading 模式 perf 回归', () => {
  const FIXTURE_DIR = path.join(__dirname, '../fixtures/graphify-mini');

  it('5 文件 Python fixture 在 reading 模式下应 < 120s', async () => {
    const outputDir = path.join(os.tmpdir(), `perf-${Date.now()}`);
    const start = Date.now();
    await runBatch(FIXTURE_DIR, { outputDir, mode: 'reading' });
    const durationMs = Date.now() - start;

    expect(durationMs).toBeLessThan(120_000);

    // 同时断言：reading 模式产出不含产品文档
    const productDocsDir = path.join(outputDir, 'specs/products');
    const hasProductOverview = fs.existsSync(
      path.join(productDocsDir, 'product-overview.md')
    );
    expect(hasProductOverview).toBe(false);
  }, 180_000); // 测试本身超时给 3 分钟（perf 失败时也能完成）
});
```

注意：此测试需要真实 LLM 调用（除非 fixture 全 AST-only），所以也用 `vi.skipIf(!ANTHROPIC_API_KEY)` 守卫。CI 在无 secret 时跳过，本地开发者验证时跑。

### 验证

- `npx vitest run tests/panoramic/batch-project-docs*` 全绿
- 在有 API Key 的环境：`npx vitest run tests/batch/reading-mode.perf.test.ts` 通过且耗时 < 120s
- `npm run build` 零错误

### Commit message

```
fix(133): reading 模式真正跳过产品文档层和 enrichment (P0-2)

Phase 2 集成回归发现：--mode=reading 实测耗时 1047s（vs SC-001 目标 <120s）。

根因：
- READING_SKIP_IDS 集合不完整，缺 product-overview / user-journeys /
  architecture-narrative / architecture-overview / event-surface 等 11 个
  generator
- batch-orchestrator 调用 generateSpec 时不根据 mode 传 skipEnrichment，
  导致模块 spec 仍跑 LLM enrichment（每模块多一次 3-4 分钟的 opus 调用）

修复：
- 扩展 READING_SKIP_IDS 集合（含全部产品文档层 + 架构推断层），与
  CODE_ONLY_SKIP_IDS 等价
- batch-orchestrator 在 reading/code-only 模式下给 generateSpec 传
  skipEnrichment: true
- 新增 graphify-mini fixture（5 文件）+ reading-mode.perf.test.ts
  perf 回归守卫（120s 硬阈值）

预期：5 文件 fixture 在 reading 模式下应在 60s 以内完成；real 项目按
模块数线性扩展。
```

## Batch 5: P2-1 sourceKind 显式写入

### 目标

让 canonical spec frontmatter 显式写 `sourceKind: canonical`（不再依赖隐式默认）。

### 改动清单

| 文件 | 类型 | 改动摘要 |
|------|------|----------|
| `src/core/single-spec-orchestrator.ts` | 修改 | 调用 generateFrontmatter 时传 `sourceKind: 'canonical'` |
| `tests/generator/frontmatter.test.ts` | 更新 | 增加 case：默认情况下 sourceKind 为 'canonical' |

### 关键改动（single-spec-orchestrator.ts L613）

```typescript
const frontmatter = generateFrontmatter({
  sourceTarget: path.relative(baseDir, resolvedTarget),
  displayName,
  relatedFiles: filePaths.map((f) => path.relative(baseDir, f)),
  confidence,
  skeletonHash: mergedSkeleton.hash,
  existingVersion,
  tokenUsage: costMetadata.tokenUsage,
  durationMs: costMetadata.durationMs,
  llmModel: costMetadata.llmModel,
  fallbackReason: costMetadata.fallbackReason,
  sourceKind: 'canonical',  // Feature 133 P2-1：显式标记 canonical 身份
});
```

### 验证

- `npx vitest run tests/generator/frontmatter*` 全绿
- 全量 `npx vitest run` 零新增失败

### Commit message

```
chore(133): canonical spec 显式写 sourceKind (P2-1)

Phase 2 用户反馈：canonical spec frontmatter 不显式写 sourceKind，依赖
"无字段=canonical"的隐式默认，让用户在视觉/grep 扫描时识别身份增加了
心智负担。

修复：single-spec-orchestrator 在调用 generateFrontmatter 时显式传
sourceKind: 'canonical'。

向后兼容：旧 spec 无 sourceKind 字段仍按 canonical 处理（frontmatter.ts
已有 |undefined 路径），不影响 spec-store 等下游消费方。
```

## 完成条件 Checklist

- [ ] Batch 1 commit + push（P0-1 token）
- [ ] Batch 2 commit + push（P0-3 model）
- [ ] Batch 3 commit + push（P1-1 hyperedges）
- [ ] Batch 4 commit + push（P0-2 reading）
- [ ] Batch 5 commit + push（P2-1 sourceKind，可选）
- [ ] 全量 `npx vitest run` 零新增失败
- [ ] `npm run build` 零错误
- [ ] `npm run repo:check` 全绿
- [ ] 真实 LLM 集成测试 + perf regression test 进入 CI（fixture）
- [ ] CHANGELOG.md 列 breaking change
- [ ] verification-report.md 完成
- [ ] 等用户授权后 rebase master + push

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 真实 LLM 集成测试在 CI 无 ANTHROPIC_API_KEY 时跳过 → 实际不跑 | 高 | 中 | 用 `vi.skipIf` 而非 `it.skip`，本地开发者必须手动验证；在 verification-report.md 明确记录"已在本地验证" |
| Sonnet 4.6 / Opus 4.7 model id 实际不存在或拼写错（调研结果可能滞后） | 低 | 高 | 实施时再次用 `curl https://api.anthropic.com/v1/models` 或 SDK list 确认 |
| reading 模式 SKIP_IDS 扩展过激，把还有用的 generator 也跳了 | 中 | 中 | 在 PR 描述中列清楚扩展的 generator 列表，让 user 判断是否过激 |
| anchor 集成需要 embedding provider，本地无 OpenAI key 时降级失败 | 中 | 中 | embedding provider 已有降级路径（embedding-provider.ts 应该有 mock），实施时确认；perf 测试用 mock provider |
| graphify-mini fixture 不能完全复现原 graphify 的 1047s 症状 | 高 | 低 | fix-report.md 已声明此局限；用户在原 graphify 上单独验证 |
| commit 顺序错乱（漏 push 某批） | 低 | 低 | 每批结束后立即 commit + push，不批量积累 |

## Phase 3 实施流程

每批按以下流程：

1. 在 worktree 上做改动
2. 跑相关单测：`npx vitest run <相关 test 路径>`
3. 跑全量 build：`npm run build`
4. 跑全量单测：`npx vitest run`
5. `git add <相关文件>`
6. `git commit`（按 plan.md 给的 commit message）
7. `git push origin claude/angry-northcutt-9c6647`
8. 进入下一批
