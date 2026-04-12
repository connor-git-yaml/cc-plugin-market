# 技术调研报告: 107-multi-modal-extraction

**特性分支**: `claude/frosty-banzai`
**调研日期**: 2026-04-12
**调研模式**: 在线（Graphify 参考实现本地可读）
**产品调研基础**: [独立模式] 本次技术调研未参考产品调研结论，直接基于 `specs/107-multi-modal-extraction/prompt.md` 需求描述执行。

---

## 1. 调研目标

**核心问题**：

- Q1：Graphify 的 `extract()` 分发模式 vs Spectra 的 `GeneratorRegistry` 模式 — 哪种更适合多模态提取？
- Q2：Graphify 的 `validate.py` extraction schema 如何映射到 TypeScript Zod schema？
- Q3：Graphify 的增量缓存（`cache.py`）与 Feature 100 CacheManager 应如何对接？
- Q4：图像提取（Claude Vision）、PDF 文本提取的 TypeScript 实现方案是什么？
- Q5：OpenAPI/AsyncAPI 解析：Graphify 是否有相关实现？如果没有，自有 schema walker 应如何设计？

**需求 MVP 范围**：

- Must-have 1：Markdown 文档提取 — 概念/术语/设计决策/命名实体
- Must-have 2：OpenAPI/AsyncAPI 确定性解析 — Endpoint / Schema / Event 节点
- Must-have 3：图像/图表 Claude Vision 理解，带完整降级路径
- Must-have 4：Batch 集成 — `--include-docs` / `--include-images` 标志
- Must-have 5：`GraphNode.kind` 扩展：新增 `api | api-schema | event | diagram`

---

## 2. Graphify 架构模式摘要

### 2.1 整体管道架构

Graphify 是一个 Python 实现的多模态知识图谱提取系统，其核心管道如下：

```
detect() → [文件分类] → extract_*() 分发 → cache → build() 合并 → validate() → 图输出
```

**detect.py** — 文件发现与分类层

- `FileType` 枚举：`CODE | DOCUMENT | PAPER | IMAGE | VIDEO`
- `classify_file(path)` 基于扩展名 + 内容启发（学术论文信号检测）判断类型
- `.graphifyignore` 支持：类 gitignore 语义，从项目根向上查找，在 `.git` 边界停止
- `detect_incremental()` 增量模式：保存 manifest（文件路径 → mtime），下次只处理变更文件
- 敏感文件跳过：正则模式匹配 `.env`、私钥、证书等，静默跳过

**extract.py** — 多语言 AST 提取分发层（核心设计）

- 核心设计模式：**数据驱动配置 + 单一泛型提取引擎**
  - `LanguageConfig` dataclass：为每种语言声明其 AST node types、import handler、name resolver
  - `_extract_generic(path, config)` — 统一执行引擎，接受 config 参数化
  - 公开 API：`extract_python(path)`、`extract_js(path)`、`extract_java(path)` 等 per-language 函数
  - per-language 函数只是 `_extract_generic(path, _LANG_CONFIG)` 的一层薄壳
- 缓存集成：每个提取函数先调用 `load_cached(path)`，命中则直接返回，未命中才执行提取后 `save_cached()`
- 节点 schema：`{id, label, file_type, source_file, source_location}`
- 边 schema：`{source, target, relation, confidence, source_file, source_location, weight}`
- `relation` 类型：`contains | inherits | imports | imports_from | calls | rationale_for`
- `confidence` 值：`EXTRACTED | INFERRED | AMBIGUOUS`（与 Spectra 完全一致）

**validate.py** — 提取结果 schema 验证

- 纯 Python dict 验证，检查必填字段存在性和枚举值合法性
- `VALID_FILE_TYPES = {"code", "document", "paper", "image", "rationale"}`
- `REQUIRED_NODE_FIELDS = {"id", "label", "file_type", "source_file"}`
- `REQUIRED_EDGE_FIELDS = {"source", "target", "relation", "confidence", "source_file"}`
- 悬空边（dangling edge）不报错——外部/stdlib 导入预期如此

**build.py** — 多提取结果合并

- 三层去重策略：
  1. 文件内（per-extractor `seen_ids` set）
  2. 跨文件（NetworkX `add_node()` idempotent，后写覆盖）
  3. 语义合并（skill 层用 `seen` set 去重）
- `build(extractions)` — 合并多个 `{nodes, edges}` dict 列表为单图
- 语义节点覆盖 AST 节点（先插入 AST，后插入 semantic — last-write-wins）

**cache.py** — 文件级增量缓存

- cache key：`SHA256(文件内容 + 文件绝对路径)`
- Markdown 特殊处理：只哈希 YAML frontmatter 之后的 body，frontmatter-only 变更不使缓存失效
- 存储格式：`graphify-out/cache/{hash}.json`
- 写入：原子 rename（先写 `.tmp` 再 `os.replace`）

**ingest.py** — 多模态 URL/文件摄取

- URL 类型分类：tweet / arxiv / github / youtube / pdf / image / webpage
- PDF/图片：直接下载二进制文件
- 网页：HTML → html2text → Markdown，附 YAML frontmatter（source_url, type, captured_at）
- YouTube：调用 `transcribe.download_audio()` 下载音频
- Query result 反馈循环：`save_query_result()` 将 Q&A 存为 Markdown 再入图

### 2.2 与 Spectra 的关键差异

| 维度 | Graphify | Spectra |
|------|----------|---------|
| 扩展机制 | `LanguageConfig` dataclass + `_extract_generic()` | `GeneratorRegistry` 单例 + `DocumentGenerator` 接口 |
| 生命周期 | 函数调用，无状态 | 类实例，有 `isApplicable()` / `generate()` 生命周期 |
| 节点 schema 验证 | 运行时 dict 检查 | TypeScript 类型 + Zod schema 静态 + 运行时双重 |
| 缓存粒度 | 文件级（content hash） | Generator 级（context + 所有输入文件聚合 hash） |
| 图合并 | `build(extractions)` 线性合并 | `buildKnowledgeGraph(options)` 三源合并 |
| 数据源 | 文件路径数组 → nodes+edges dict | ArchitectureIR / DocGraph / CrossReferenceLinks |

---

## 3. 架构方案对比

### 方案 A：独立 Extractor 模块（`src/extraction/`）

参考 Graphify `extract.py` 的 per-type 函数风格，将多模态提取独立于 Generator 体系，作为 `buildKnowledgeGraph()` 的上游数据生产者。

```
BatchOrchestrator
  └── runExtractionPipeline()     ← 新增
        ├── MarkdownExtractor.extract()
        ├── OpenApiExtractor.extract()
        └── ImageExtractor.extract()
            ↓
        ExtractionResult {nodes, edges}
            ↓
        buildKnowledgeGraph({ ...existing, extractionResults })
```

**特点**：
- 提取器不实现 `DocumentGenerator` 接口，职责更聚焦
- `ExtractionResult = {nodes: ExtractedNode[], edges: ExtractedEdge[]}` 直接对齐 Graphify schema
- `buildKnowledgeGraph()` 新增第四路数据源 `extractionResults?`
- 类 Graphify 的 `validate()` → Zod schema 验证提取结果

### 方案 B：提取器作为特殊 DocumentGenerator 注册进 GeneratorRegistry

将多模态提取器包装为 `DocumentGenerator<void, ExtractionResult>` 实例，通过 `bootstrapGenerators()` 注册，利用 `CacheManager` 的现有缓存基础设施。

```
GeneratorRegistry
  ├── ...existing 20+ generators...
  ├── MarkdownExtractionGenerator   ← implements DocumentGenerator
  ├── OpenApiExtractionGenerator
  └── ImageExtractionGenerator
```

**特点**：
- 完全复用 CacheManager 的 manifest + hash 基础设施
- 但 `DocumentGenerator` 接口面向"生成文档文件"，而提取器的产出是"图谱节点数据"，语义错配

### 方案 C：混合模式 — Extractor 接口 + 单独 ExtractorRegistry

新建 `ExtractorRegistry`，继承 `AbstractRegistry`，注册实现 `ArtifactExtractor<T>` 接口的提取器。

```
AbstractRegistry<ArtifactExtractor, ExtractorEntry>
  └── ExtractorRegistry
        ├── MarkdownExtractor
        ├── OpenApiExtractor
        └── ImageExtractor
```

### 方案对比表

| 维度 | 方案 A：独立模块 | 方案 B：注册进 GeneratorRegistry | 方案 C：独立 ExtractorRegistry |
|------|--------------|-------------------------------|-------------------------------|
| 概述 | 独立 `src/extraction/` 目录，无 Registry | 复用现有 Generator 接口和 Registry | 新建 ExtractorRegistry，继承 AbstractRegistry |
| 架构清晰度 | 高（职责单一） | 低（语义错配，Generator 输出文档而非节点） | 高（有专属接口和 Registry） |
| 实现复杂度 | 低（无需实现 Generator 接口） | 中（需包装适配） | 高（需新 Registry + 接口） |
| 缓存集成 | 需自行实现文件级哈希（可参考 Graphify cache.py） | 完全复用 CacheManager | 需要新 ExtractorCacheManager |
| 可维护性 | 高（类 Graphify 设计，参考实现清晰） | 中（迫使 Generator 接口膨胀） | 高（但增加新基础设施复杂度） |
| 与需求契合度 | 最高（prompt.md 明确建议 src/extraction/ 目录） | 低（要求是 batch 集成，不是 generator pipeline 产物） | 中（过度设计，当前只有 3 个提取器） |
| 学习曲线 | 低（Graphify 有直接参考） | 低（复用已有模式） | 中（新接口学习成本） |
| 社区/业界案例 | Graphify 本身、Langchain 文档加载器模式 | N/A（项目内模式） | N/A（项目内模式） |

### 推荐方案

**推荐：方案 A — 独立 Extractor 模块**

**理由**：

1. **职责清晰**：提取器产出图谱节点数据，不是 Markdown 文档；强行实现 `DocumentGenerator` 接口是语义污染
2. **Graphify 对齐**：Graphify 的 `extract_*()` 函数就是独立模块，`ExtractionResult {nodes, edges}` 直接可映射
3. **需求驱动**：`prompt.md` 明确建议 `src/extraction/` 目录结构，技术方案与产品意图一致
4. **缓存策略清晰**：文件级哈希缓存（参考 Graphify `cache.py` 的 SHA256 + path 方案）比 Generator 级缓存粒度更合适——同一个 `.md` 文件可被多个下游消费
5. **扩展性**：新增提取器时只需实现 `ArtifactExtractor<T>` 接口（简单泛型函数签名），无需修改 Registry

---

## 4. 关键设计问题分析

### 4.1 Graphify `extract()` 分发模式 vs Spectra `GeneratorRegistry` 模式

**Graphify 模式**：数据驱动配置 + 单一泛型引擎

```python
# per-language 函数是 LanguageConfig 的薄壳
def extract_python(path: Path) -> dict:
    result = _extract_generic(path, _PYTHON_CONFIG)
    _extract_python_rationale(path, result)  # 语言特有后处理
    return result
```

**Spectra 建议映射**：

```typescript
// ArtifactExtractor<T> — 对应 Graphify 的 extract_*() 函数
interface ArtifactExtractor<T extends ExtractionResult = ExtractionResult> {
  readonly id: string;
  readonly filePatterns: readonly string[];
  /** 对应 Graphify classify_file() 的类型标签 */
  readonly artifactKind: 'document' | 'api-spec' | 'image';
  extract(filePath: string): Promise<T>;
}
```

核心结论：**不应将 Graphify 的 `LanguageConfig` 数据驱动模式直接移植**。Graphify 处理的是同构的 AST 问题（所有代码语言共享同一套 node-edge schema），而 Feature 107 的三类提取器（Markdown、OpenAPI、Image）提取逻辑差异极大，用 config 参数化反而会使接口变得臃肿。每个提取器实现独立的 `extract()` 方法更清晰。

### 4.2 validate.py → Zod Schema 映射

Graphify `validate.py` 的设计理念（必填字段检查 + 枚举值校验 + 悬空边容忍）可直接映射：

```typescript
// extraction-types.ts
import { z } from 'zod';

export const ExtractedNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  file_type: z.enum(['document', 'api-spec', 'image', 'code', 'rationale']),
  source_file: z.string(),
  source_location: z.string().optional(),
  // Spectra 扩展：kind 直接对应 GraphNode.kind
  kind: z.enum(['document', 'api', 'api-schema', 'event', 'diagram']),
  metadata: z.record(z.unknown()).optional(),
});

export const ExtractedEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.string(),
  confidence: z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']),
  source_file: z.string(),
  weight: z.number().optional().default(1.0),
});

export const ExtractionResultSchema = z.object({
  nodes: z.array(ExtractedNodeSchema),
  edges: z.array(ExtractedEdgeSchema),
});
```

**悬空边处理**：与 Graphify `build.py` 一致，在 `buildKnowledgeGraph()` 中过滤（已有此逻辑，L250-257），无需在提取层验证。

### 4.3 Graphify `cache.py` 与 Feature 100 CacheManager 对接策略

两套缓存系统的粒度和 key 设计对比：

| 维度 | Graphify cache.py | Feature 100 CacheManager |
|------|-------------------|--------------------------|
| 粒度 | 文件级 | Generator 级（包含所有输入文件） |
| Key | SHA256(文件内容 + 绝对路径) | SHA256(generator.id + context + 所有输入文件哈希聚合) |
| 存储 | `{hash}.json` 文件 | `_cache-manifest.json` manifest |
| Markdown 特殊处理 | 跳过 YAML frontmatter | 无特殊处理 |
| 原子写入 | `.tmp` → `os.replace` | `writeAtomicJson()` |

**推荐对接策略**：

**不**直接复用 CacheManager（粒度不匹配）。提取层实现文件级缓存，独立于 Generator 缓存：

```typescript
// extraction-cache.ts — 参考 Graphify cache.py 实现
export function fileExtractHash(filePath: string): string {
  const raw = fs.readFileSync(filePath);
  // Markdown 特殊处理：只哈希 frontmatter 之后的 body
  const content = filePath.endsWith('.md') ? stripFrontmatter(raw) : raw;
  return crypto.createHash('sha256')
    .update(content).update('\0').update(filePath)
    .digest('hex');
}

export function loadExtractCache(filePath: string, cacheDir: string): ExtractionResult | null { ... }
export function saveExtractCache(filePath: string, result: ExtractionResult, cacheDir: string): void { ... }
```

缓存目录建议：`{outputDir}/_meta/extraction-cache/{hash}.json`（与 Generator 缓存同根不同目录）

**Feature 100 manifest 集成**：在 `batch-orchestrator.ts` 中，提取步骤完成后将提取器的输入文件列表追加到 BatchOptions manifest（不复用 ManifestEntry schema，只记录 mtime/hash 用于下次增量判断）。

### 4.4 图像提取 TypeScript 实现方案

Graphify `ingest.py` 的图像处理路径（`_download_binary()` + 直接存文件）不适合 Feature 107 需求——Spectra 需要从图像中提取节点，而非存储图像。

TypeScript 实现参考现有 `llm-enricher.ts` + `llm-facade.ts` 模式：

```typescript
// image-extractor.ts
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';

async function extractFromImage(filePath: string): Promise<ExtractionResult> {
  // 检查文件大小：> 10 MB 跳过
  const stat = fs.statSync(filePath);
  if (stat.size > 10 * 1024 * 1024) {
    logger.info(`图片过大（${stat.size} bytes），跳过: ${filePath}`);
    return EMPTY_RESULT;
  }

  // base64 编码（Graphify ingest.py 的图片处理也是直接读二进制）
  const imageData = fs.readFileSync(filePath).toString('base64');
  const mediaType = getMediaType(filePath); // image/png | image/jpeg | image/webp

  const client = new Anthropic();  // 通过 src/auth/ 检测 API key
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
        { type: 'text', text: IMAGE_EXTRACTION_PROMPT },
      ],
    }],
  });
  // 解析 LLM 返回的 JSON → ExtractionResult
}
```

**降级路径**（参考 Graphify 的 `try/except ImportError` 模式）：

```typescript
// 三级降级：
// 1. API key 不存在 → 跳过 + 日志
// 2. Vision API 调用失败 → 跳过 + 日志（不抛异常）
// 3. LLM 返回无效 JSON → 返回空 ExtractionResult
```

### 4.5 OpenAPI/AsyncAPI 解析方案

**Graphify 无相关实现**：Graphify 专注于代码 AST 提取，无 API spec 解析能力。

**好消息**：Spectra 在 `src/panoramic/api-surface/openapi-extractor.ts` 已有完整的 OpenAPI 解析实现（包括 `$ref` 解析、路径遍历、HTTP method 提取）。Feature 107 的 OpenAPI 提取器可以**直接复用**此解析逻辑，将输出转换为 `ExtractionResult {nodes, edges}` 格式，而非当前的 `ApiEndpoint[]` 格式。

**设计建议**：

```typescript
// src/extraction/openapi-extractor.ts — 包装现有 openapi-extractor
import { extractFromOpenApiFile } from '../panoramic/api-surface/openapi-extractor.js';

export async function extractOpenApiNodes(filePath: string): Promise<ExtractionResult> {
  const endpoints = await extractFromOpenApiFile(filePath);
  // 转换为图谱节点格式
  const nodes: ExtractedNode[] = endpoints.flatMap(ep => [
    { id: ..., kind: 'api', label: ep.operationId, ... },
    ...ep.requestBody ? [{ id: ..., kind: 'api-schema', ... }] : [],
  ]);
  // 生成 endpoint → schema 边（confidence: EXTRACTED）
}
```

**AsyncAPI 解析**：需要新实现，但可复用 `openapi-extractor.ts` 中的 YAML 解析和 `$ref` 解析工具函数（`resolveRef`、`dereference`）。

---

## 5. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 当前版本（项目） | 许可证 | 是否已有 | 评级 |
|------|------|----------------|--------|---------|------|
| `@anthropic-ai/sdk` | Claude Vision API 调用 | 已引入（src/auth/ 依赖） | MIT | ✅ 已有 | ⭐⭐⭐ |
| `js-yaml` / `yaml` | YAML 解析（OpenAPI/AsyncAPI） | 已引入（panoramic 依赖） | MIT | ✅ 已有 | ⭐⭐⭐ |
| `zod` | 提取结果 schema 验证 | 已引入 | MIT | ✅ 已有 | ⭐⭐⭐ |
| `sharp` | 图片预处理（resize 大图） | 未引入 | Apache-2.0 | ❌ 需引入 | ⭐⭐ |
| `pdf-parse` / `pdfjs-dist` | PDF 文本提取（如扩展 PDF 支持） | 未引入 | MIT | ❌ 可选 | ⭐⭐ |
| `marked` | Markdown AST 解析 | 未引入 | MIT | ❌ 需引入或手写 | ⭐⭐⭐ |
| `remark` + `remark-frontmatter` | Markdown 解析含 frontmatter | 未引入 | MIT | ❌ 可选 | ⭐⭐ |

### 推荐依赖集

**核心依赖（零新增外部依赖原则）**：

- `@anthropic-ai/sdk`：已有，直接用于 Vision API
- `yaml`（或 `js-yaml`）：检查 `package.json` 确认已有版本，用于 OpenAPI/AsyncAPI 解析
- `zod`：已有，用于提取结果 schema 验证

**需要新增的依赖**：

- `marked`（MIT，约 500 KB）：Markdown AST 解析，比手写正则更健壮。用于提取 heading 树、frontmatter、代码块。**替代方案**：若要零新增依赖，可使用现有 `src/panoramic/parsers/skill-md-parser.ts` 的正则模式，但功能受限。

**可选依赖（根据需求范围决定）**：

- `sharp`：仅当需要对超大图片做预处理（resize to fit Claude Vision 限制）时引入。若直接跳过 > 10 MB 的图片，无需此依赖。

### 与现有项目的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| `@anthropic-ai/sdk` | ✅ 兼容 | 已有 Vision 支持，需确认版本 ≥ 0.24.0（image content block） |
| `zod` | ✅ 兼容 | 全项目统一使用，无冲突 |
| `yaml` / `js-yaml` | ✅ 兼容 | OpenAPI 文件标准 YAML 解析，无冲突 |
| `graphology` | ✅ 兼容 | 现有图谱社区检测依赖，新节点类型自动参与 |
| TypeScript strict 模式 | ✅ 兼容 | 所有新代码需通过 `npm run build` 零错误 |

---

## 6. 设计模式推荐

### 推荐模式

**1. Strategy 模式 — 提取器多态**

每种制品类型（Markdown、OpenAPI、Image）实现同一 `ArtifactExtractor` 接口，`runExtractionPipeline()` 按文件类型分发。参考 Graphify 的 `classify_file()` + `extract_*()` 分发逻辑：

```typescript
const EXTRACTOR_MAP: Record<ArtifactKind, ArtifactExtractor> = {
  document: new MarkdownExtractor(),
  'api-spec': new OpenApiExtractor(),
  image: new ImageExtractor(),
};
```

**2. Null Object 模式 — 统一降级路径**

Image/LLM 提取必须有完整降级。参考 Graphify `ingest.py` 的 `try/except` 模式，每个提取器失败时返回 `EMPTY_EXTRACTION_RESULT` 而非抛异常：

```typescript
const EMPTY_EXTRACTION_RESULT: ExtractionResult = { nodes: [], edges: [] };
```

**3. File Hash Cache 模式（Graphify cache.py）**

`SHA256(content_body + absolute_path)` → `{hash}.json` 文件缓存。Markdown 提取跳过 frontmatter 哈希（防止 metadata-only 变更使缓存失效）。

**4. Last-Write-Wins 合并（Graphify build.py）**

图谱合并时，使用 `nodeMap.set(id, node)` 允许后插入的节点覆盖先插入的节点。新数据源在 `buildKnowledgeGraph()` 步骤 6 之后追加。

### 应用案例

- Graphify `extract.py`：`_extract_generic()` 即 Strategy + Template Method 的组合——泛型 walk 函数 + 可替换的 `LanguageConfig` 策略对象
- Langchain `DocumentLoader`：与方案 A 的 `ArtifactExtractor` 接口高度同构，`load() → Document[]` 即提取器模式的业界标准形态
- LlamaIndex `SimpleDirectoryReader`：`file_extractor: dict[str, BaseReader]` 是完全相同的 Strategy 分发模式
- Spectra 已有：`src/panoramic/parsers/abstract-artifact-parser.ts` 已实现类似的提取器抽象基类模式（`doParse()` + `createFallback()`），Feature 107 的 `ArtifactExtractor` 接口可参考此设计

---

## 7. Graphify → TypeScript 模式映射建议

### 7.1 直接借鉴（高价值）

| Graphify 组件 | TypeScript 对应 | 借鉴内容 |
|--------------|----------------|---------|
| `detect.py::classify_file()` | `src/extraction/artifact-classifier.ts` | 扩展名 → ArtifactKind 映射；paper 启发式检测可参考但不直接移植 |
| `cache.py::file_hash()` | `src/extraction/extraction-cache.ts` | SHA256(body + path)；Markdown frontmatter 剥离逻辑 |
| `cache.py` 原子写入 | 已有 `writeAtomicJson()` | 直接复用 |
| `build.py` 三层去重 | `graph-builder.ts` 已实现 L250-257 | 悬空边静默跳过逻辑已有，新数据源无需额外处理 |
| `validate.py` schema | Zod schema | `VALID_FILE_TYPES`、`REQUIRED_NODE_FIELDS` 直接映射为 Zod enum/object |
| `detect.py::_is_sensitive()` | 提取扫描时的安全过滤 | 跳过 `.env`、私钥等文件的正则模式可复用 |
| `ingest.py::_body_content()` 前 `load_cached()` 调用 | `loadExtractCache()` 前置检查 | 每次提取前先查缓存，命中则直接返回 |

### 7.2 适当改造（中等价值）

| Graphify 组件 | 改造建议 |
|--------------|---------|
| `detect.py::detect()` — `total_words` 阈值警告 | 可简化为：文档数量 > 200 时输出警告（无需字数统计） |
| `detect.py::_load_graphifyignore()` | 复用 `.gitignore` 语义（项目已有相关逻辑）；新增 `.spectraignore` 支持的投入产出比不高 |
| `extract.py::LanguageConfig` 数据驱动模式 | 不直接移植。Markdown/OpenAPI/Image 提取差异过大，每个实现独立 `extract()` 方法更清晰 |

### 7.3 不建议移植

| Graphify 组件 | 原因 |
|--------------|------|
| `transcribe.py`（音视频转写） | Feature 107 范围外；TypeScript 生态无等价轻量方案 |
| `ingest.py` URL 摄取 | Feature 107 专注本地文件，不需要 URL 摄取 |
| `detect.py` corpus word count / `needs_graph` | Spectra 已有 `CoverageAuditor`，无需重复 |

---

## 8. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | Claude Vision API 调用成本不可控：大型项目 docs/ 目录可能有数百张图片，每次 batch 均触发 Vision 调用 | 中 | 高 | `--include-images` 默认 false；文件级哈希缓存避免重复调用；图片数量上限警告（参考 Graphify `FILE_COUNT_UPPER = 200`） |
| 2 | Markdown 实体提取 LLM 幻觉：命名实体误标或虚构关系 | 中 | 中 | 所有 LLM 产出标记 `confidence: 'INFERRED'`；下游查询可按置信度过滤；不影响 EXTRACTED 节点的质量 |
| 3 | `GraphNode.kind` 扩展破坏下游兼容性：新增 `api | api-schema | event | diagram` 可能影响 Feature 102 社区检测、Feature 105 MCP 查询等 | 中 | 中 | TypeScript union 扩展向后兼容；社区检测基于 graphology 无类型约束；MCP 查询返回 GraphNode 原始对象，客户端按需使用 kind 字段 |
| 4 | OpenAPI `$ref` 循环引用导致无限递归 | 低 | 高 | 现有 `openapi-extractor.ts` 已有 `resolveRef()` 但未处理循环；需添加 `visited` set 检测；或设置递归深度上限（5 层） |
| 5 | `buildKnowledgeGraph()` 新增第四路数据源导致三源合并逻辑复杂化 | 中 | 中 | 提取结果在 `buildKnowledgeGraph()` 外部转换为标准 `{nodes, edges}` 后，作为第四步顺序合并（步骤 4 之后）；不破坏现有三步逻辑 |
| 6 | 大型 Markdown 文件（如长篇 README、ADR 集合）LLM 上下文超限 | 低 | 中 | 分段提取：按 heading 切块，每块独立 LLM 调用；单块 > 8000 token 时跳过 LLM 仅做启发式提取 |
| 7 | `@anthropic-ai/sdk` 版本不支持图片 content block | 低 | 高 | 提取前检测 SDK 版本；build 时添加最低版本约束（`>= 0.20.0`） |
| 8 | 测试覆盖难度：Vision API 调用在单元测试中无法真实执行 | 高 | 中 | mock `@anthropic-ai/sdk` 的 `messages.create`；提供 fixture 图片和预设响应；集成测试用 `--no-images` 标志规避 |

---

## 9. Spectra 现有架构扩展点分析

### 9.1 扩展点一：`GraphNode.kind` 枚举扩展

**位置**：`src/panoramic/graph/graph-types.ts` L32

```typescript
// 当前
kind: 'module' | 'package' | 'component' | 'spec' | 'document';

// 扩展后
kind: 'module' | 'package' | 'component' | 'spec' | 'document'
    | 'api' | 'api-schema' | 'event' | 'diagram';
```

**风险**：TypeScript union 扩展天然向后兼容（现有代码不 exhaustive switch 则无需修改）。需检查 `KIND_MAP` 和下游 switch 语句。

### 9.2 扩展点二：`buildKnowledgeGraph()` 第四路数据源

**位置**：`src/panoramic/graph/graph-builder.ts`，`BuildGraphOptions` 接口

```typescript
// graph-types.ts 新增
export interface BuildGraphOptions {
  // ...现有三路...
  /** 多模态提取结果（可选，缺失时跳过） */
  extractionResults?: ExtractionResult[];
}
```

在 `buildKnowledgeGraph()` 步骤 3 之后（CrossReferenceLinks 处理后）新增步骤 4：遍历 `extractionResults`，将节点/边插入 `nodeMap` / `edgeMap`。悬空边过滤逻辑（步骤 4 → 现步骤 5）无需修改。

### 9.3 扩展点三：`BatchOptions` 新增标志

**位置**：`src/batch/batch-orchestrator.ts` L52-71

```typescript
export interface BatchOptions {
  // ...现有字段...
  /** 启用 Markdown 文档提取（默认 false） */
  includeDocs?: boolean;
  /** 启用图像/图表 Vision 理解（默认 false） */
  includeImages?: boolean;
}
```

提取步骤在 generator pipeline 完成后、`buildKnowledgeGraph()` 调用前执行。

### 9.4 扩展点四：CLI 参数扩展

**位置**：`src/cli/utils/parse-args.ts`（参考 prompt.md）

新增 `--include-docs` / `--include-images` 两个 boolean 标志，映射到 `BatchOptions.includeDocs` / `BatchOptions.includeImages`。

### 9.5 扩展点五：现有 `openapi-extractor.ts` 复用

**位置**：`src/panoramic/api-surface/openapi-extractor.ts`

Feature 107 的 OpenAPI 提取器可包装此文件，将 `ExtractionResult<ApiEndpoint[]>` 转换为 `ExtractionResult<ExtractedNode[]>`，复用 `resolveRef()`、`dereference()`、`formatSchemaType()` 工具函数，避免重复实现 schema walker。

---

## 10. 推荐目录结构和模块边界

```
src/
  extraction/                        ← 新建（Feature 107 核心）
    extraction-types.ts              # ExtractedNode / ExtractedEdge / ExtractionResult + Zod schema
    extraction-cache.ts              # 文件级哈希缓存（参考 Graphify cache.py）
    artifact-classifier.ts           # 文件 → ArtifactKind 分类（参考 Graphify detect.py::classify_file）
    markdown-extractor.ts            # .md 扫描 + 概念/决策/实体提取
    openapi-extractor.ts             # OpenAPI/AsyncAPI/Swagger 确定性解析（包装现有 api-surface/openapi-extractor.ts）
    image-extractor.ts               # Claude Vision 图表理解 + 降级路径
    extraction-pipeline.ts           # runExtractionPipeline() — 协调三个提取器，对接 BatchOrchestrator
    index.ts                         # 统一导出
  panoramic/
    graph/
      graph-types.ts                 # ← 修改：GraphNode.kind 新增 api|api-schema|event|diagram
      graph-builder.ts               # ← 修改：BuildGraphOptions.extractionResults 新路数据源
    api-surface/
      openapi-extractor.ts           # ← 复用（不修改）
  batch/
    batch-orchestrator.ts            # ← 修改：BatchOptions.includeDocs/includeImages，步骤 4.5 提取管道
  cli/
    utils/
      parse-args.ts                  # ← 修改：--include-docs / --include-images 标志

tests/
  unit/
    extraction/
      markdown-extractor.test.ts
      openapi-extractor.test.ts
      image-extractor.test.ts
      extraction-cache.test.ts
      artifact-classifier.test.ts
  integration/
    multi-modal-batch.test.ts        # batch --include-docs → graph.json 包含文档节点
```

**模块边界约定**：

- `src/extraction/` 对 `src/panoramic/graph/` 单向依赖（只引用 `graph-types.ts` 中的类型）
- `src/extraction/` 不依赖 `GeneratorRegistry` 或 `CacheManager`（独立缓存基础设施）
- `batch-orchestrator.ts` 是唯一的集成点，调用 `runExtractionPipeline()` 并将结果传入 `buildKnowledgeGraph()`
- `openapi-extractor.ts`（extraction 层）包装但不修改 `api-surface/openapi-extractor.ts`

---

## 11. 需求-技术对齐度评估

### 覆盖评估

| 需求功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| Markdown 文档提取（概念/术语/决策/实体） | ✅ 完全覆盖 | `MarkdownExtractor` + `marked` 解析；LLM 实体提取复用 `llm-facade.ts` 模式 |
| OpenAPI/AsyncAPI 确定性解析 | ✅ 完全覆盖 | 包装现有 `api-surface/openapi-extractor.ts`；AsyncAPI 需新实现但可复用工具函数 |
| 图像/图表 Vision 理解 | ✅ 完全覆盖 | `ImageExtractor` + `@anthropic-ai/sdk` Vision；三级降级路径（无 key / 调用失败 / JSON 解析失败） |
| Batch 集成（`--include-docs` / `--include-images`） | ✅ 完全覆盖 | `BatchOptions` 扩展 + CLI 参数扩展 + `extraction-pipeline.ts` 协调 |
| `GraphNode.kind` 扩展 | ✅ 完全覆盖 | TypeScript union 扩展向后兼容 |
| Feature 100 cache 集成 | ✅ 完全覆盖 | 独立文件级哈希缓存，参考 Graphify cache.py；不冲突现有 CacheManager |
| Feature 102 社区检测兼容 | ✅ 完全覆盖 | graphology 无类型约束，新节点自动参与 Louvain 算法 |
| 性能目标（Markdown < 30s，OpenAPI < 2s，图像 < 10s） | ⚠️ 部分覆盖 | OpenAPI/图像目标可达；Markdown 100 文件 + LLM 串行调用需 Promise.all 并发；LLM 调用是主要瓶颈 |

### 扩展性评估

- **PDF 文档提取**（Nice-to-have）：`artifact-classifier.ts` 支持新增 `pdf` 类型，`ArtifactExtractor` 接口直接扩展
- **音视频转写**（Graphify transcribe.py 对应能力）：提取管道可插入新 extractor，无架构变动
- **多项目图谱联合**：`ExtractionResult` 格式与 Graphify 完全兼容，未来可与 Python Graphify 图谱直接合并

### Constitution / 项目约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| TypeScript 5.x + Node.js 20.x+ | ✅ 兼容 | 所有新代码使用 TypeScript strict |
| OpenAPI 解析不引入 openapi-parser 重依赖 | ✅ 兼容 | 复用 `api-surface/openapi-extractor.ts` + `yaml` 库 |
| 图像提取完整降级路径 | ✅ 覆盖 | Null Object 模式 + 三级降级 |
| `--include-docs/images` 默认 false | ✅ 覆盖 | BatchOptions 默认值保持现有行为 |
| 所有代码：中文注释 + 英文标识符 | ✅ 兼容 | 遵循项目 Language Convention |
| Zod schema 验证 | ✅ 覆盖 | `ExtractionResultSchema` 验证所有提取输出 |
| 提交前 `npx vitest run` 零失败 | ✅ 计划 | tests/unit/extraction/ 覆盖所有提取器 |

---

## 12. 结论与建议

### 总结

Feature 107 的核心技术挑战是：将三类性质不同的工程制品（Markdown 文档、API 规范文件、图表图片）统一接入现有的 `buildKnowledgeGraph()` 管道。

**关键技术决策**：

1. **独立 `src/extraction/` 模块**（方案 A）是最适合的架构：职责清晰、Graphify 有直接参照、与需求文档的目录结构建议一致
2. **OpenAPI 解析无需从头开发**：`src/panoramic/api-surface/openapi-extractor.ts` 已有完整实现，Feature 107 只需包装为 `ExtractionResult` 格式
3. **缓存策略**：参考 Graphify `cache.py` 的文件级 SHA256 缓存，独立于 Generator CacheManager，Markdown 跳过 frontmatter 哈希
4. **`buildKnowledgeGraph()` 扩展**：新增 `extractionResults?` 第四路数据源，在步骤 3（CrossReference）之后插入，不破坏现有三步逻辑
5. **图像提取的成本控制**：默认关闭 + 文件级缓存 + 数量警告是防止意外超支的三重保障

Graphify 最有价值的借鉴：文件分类策略（`classify_file`）、哈希缓存设计（`cache.py`）、悬空边容忍（`build.py`）、Zod schema 对齐（`validate.py`）。`LanguageConfig` 数据驱动模式不建议移植。

### 对后续技术规划的建议

- **Markdown 并发提取**：100 文件 LLM 串行会严重超过 30 秒目标，规划时需明确并发策略（Promise.all with concurrency limit，建议上限 5）
- **AsyncAPI 范围确认**：`asyncapi.yaml` 解析的 `channel/message → event 节点` 映射与 OpenAPI path/operation 不同，建议在 spec 阶段明确 schema walker 设计
- **Vision 模型选择**：`claude-opus-4-5` vs `claude-haiku-3-5` 的成本/质量权衡需要在 spec 中给出默认值建议
- **测试策略**：图像提取的 unit test mock 难度较高，建议在 tasks 拆分时为 `image-extractor.test.ts` 预留额外时间
