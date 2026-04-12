---
feature: 107-multi-modal-extraction
created: 2026-04-12
status: Draft
spec: specs/107-multi-modal-extraction/spec.md
plan: specs/107-multi-modal-extraction/plan.md
---

# Tasks: 107 多模态工程制品提取

**输入制品**：`specs/107-multi-modal-extraction/`（spec.md、plan.md、data-model.md、contracts/）
**前置条件**：Feature 100（content-hash-cache）和 Feature 101（graph-persistence）已合入 master

**测试策略**：spec 明确要求单元测试，本任务列表采用**测试先行**（TDD）策略——测试任务在对应实现任务之前。

---

## Phase 1: 类型层与基础设施（无 LLM 依赖，可独立验证）

**目标**：建立 `src/extraction/` 模块骨架，定义所有核心类型、Zod schema、文件级缓存和制品分类器，无任何 LLM 依赖，可独立单元测试。

**阻塞关系**：Phase 2、3、4 的所有实现任务均依赖 Phase 1 完成。

---

- [x] T001 [P] 创建 `src/extraction/extraction-types.ts`：定义 `ExtractedNodeSchema`、`ExtractedEdgeSchema`、`ExtractionResultSchema`（Zod）及推断类型 `ExtractedNode`、`ExtractedEdge`、`ExtractionResult`；导出 `EMPTY_EXTRACTION_RESULT`（`Object.freeze`）和 `ArtifactKind` 枚举；参考 `data-model.md` Zod Schema 定义章节
  - **文件**：`src/extraction/extraction-types.ts`（新建，约 60 LOC）
  - **覆盖 FR**：FR-015
  - **验证**：`npx vitest run tests/extraction/extraction-types.test.ts`

- [x] T002 [P] 创建 `src/extraction/artifact-classifier.ts`：实现 `classifyFile(filePath: string): ArtifactKind | null`，基于文件扩展名映射（`.md` → `document`，`.yaml/.json` → `api-spec`，`.png/.jpg/.jpeg/.svg` → `image`）；实现 `isSensitiveFile(filePath: string): boolean`（参考 Graphify `detect.py::_is_sensitive()` 逻辑，匹配 `.env`、私钥、证书等模式）；路径扫描边界硬编码排除规则（`specs/`、`node_modules/`、`dist/`、`.git/`）
  - **文件**：`src/extraction/artifact-classifier.ts`（新建，约 50 LOC）
  - **覆盖 FR**：FR-001、FR-007
  - **验证**：`npx vitest run tests/extraction/artifact-classifier.test.ts`

- [x] T003 [P] 创建 `src/extraction/extraction-cache.ts`：实现 `fileExtractHash(filePath: string, content: string, isMarkdown?: boolean): string`（SHA256(body + absolutePath)，Markdown 文件剥离 frontmatter body 部分）；实现 `loadExtractCache(hash: string, outputDir: string): ExtractionResult | null` 和 `saveExtractCache(hash: string, outputDir: string, result: ExtractionResult): Promise<void>`；原子写入复用现有 `writeAtomicJson`；缓存路径 `{outputDir}/_meta/extraction-cache/{hash}.json`
  - **文件**：`src/extraction/extraction-cache.ts`（新建，约 80 LOC）
  - **覆盖 FR**：FR-014
  - **验证**：`npx vitest run tests/extraction/extraction-cache.test.ts`

---

### 测试：Phase 1 单元测试

- [x] T004 [P] 创建 `tests/extraction/extraction-types.test.ts`：覆盖 Zod schema 验证通过场景（合法 `ExtractedNode`）；验证失败场景（缺失必填字段）；`EMPTY_EXTRACTION_RESULT` 冻结不可变；`ArtifactKind` 枚举值完整性
  - **文件**：`tests/extraction/extraction-types.test.ts`（新建，约 60 LOC）
  - **验证**：先确认测试失败 → 实现 T001 后通过

- [x] T005 [P] 创建 `tests/extraction/artifact-classifier.test.ts`：覆盖各扩展名分类正确（`.md`、`.yaml`、`.json`、`.png`、`.jpg`、`.svg`）；`.bmp`/`.tiff` 返回 `null`；`node_modules/` 下文件被过滤；敏感文件（`.env`、`*.pem`）被识别跳过
  - **文件**：`tests/extraction/artifact-classifier.test.ts`（新建，约 50 LOC）
  - **验证**：先确认测试失败 → 实现 T002 后通过

- [x] T006 [P] 创建 `tests/extraction/extraction-cache.test.ts`：覆盖 hash 计算稳定性（相同内容输出相同 hash）；Markdown frontmatter 剥离（frontmatter 变化不影响 hash，body 变化触发新 hash）；缓存命中路径（返回 `ExtractionResult`）；缓存未命中路径（返回 `null`）；缓存写入后可读取
  - **文件**：`tests/extraction/extraction-cache.test.ts`（新建，约 70 LOC）
  - **验证**：先确认测试失败 → 实现 T003 后通过

---

**Phase 1 检查点**：`npx vitest run tests/extraction/extraction-types.test.ts tests/extraction/artifact-classifier.test.ts tests/extraction/extraction-cache.test.ts` 全部通过，`npm run build` 零错误

---

## Phase 2: GraphNode.kind 扩展（类型安全基础）

**目标**：在现有图谱类型系统中扩展 `GraphNode.kind` 和 `BuildGraphOptions`，确保向后兼容。此阶段不依赖 Phase 1 的新建文件，仅修改现有文件。

**独立测试方法**：运行 `npm run build`，确认 TypeScript 编译零错误；运行现有全量测试确认无回归。

---

- [x] T007 修改 `src/panoramic/graph/graph-types.ts`：在 `GraphNode.kind` 联合类型（约 L32）追加 `| 'api' | 'api-schema' | 'event' | 'diagram'`；在 `BuildGraphOptions` 接口（约 L106）新增 `extractionResults?: ExtractionResult[]` 可选字段（使用 `import type` 避免循环依赖，保持与现有三路数据源字段的类型签名风格一致）；在文件顶部新增对 `ExtractionResult` 的类型引用（`import type { ExtractionResult } from '../../extraction/extraction-types.js'`）
  - **文件**：`src/panoramic/graph/graph-types.ts`（修改，约 +8 LOC）
  - **覆盖 FR**：FR-010、FR-024
  - **验证**：`npm run build`；验证现有 `src/panoramic/community/` 和 `graph-query.ts` 无类型错误

---

**Phase 2 检查点**：`npm run build` 零错误；`npx vitest run` 全量测试通过（回归验证）

---

## Phase 3: US1 + US2 — OpenAPI/AsyncAPI 规范提取与 Markdown 文档提取（P1 MVP）

**目标（US1）**：后端工程师运行 `spectra batch --include-docs` 时，OpenAPI/AsyncAPI 规范文件被自动解析，生成 `api`、`api-schema`、`event` 节点进入 `graph.json`。

**目标（US2）**：技术负责人运行 `spectra batch --include-docs` 时，Markdown 文档中的核心概念、设计决策被提取为 `document` 节点，文件路径引用生成 `document → module` 边。

**独立测试方法（US1）**：含 `openapi.yaml` 的 fixture 项目运行 `spectra batch --include-docs`，`graph.json` 包含 `kind: 'api'` 和 `kind: 'api-schema'` 节点，`confidence: 'EXTRACTED'`。

**独立测试方法（US2）**：含 `docs/adr-001.md` 的 fixture 项目运行 `spectra batch --include-docs`，`graph.json` 包含 `kind: 'document'` 节点，`metadata.concepts` 非空。

**依赖**：Phase 1 和 Phase 2 完成后方可开始。

---

### 测试：US1 — OpenAPI 提取器测试（先行）

- [x] T008 创建 `tests/extraction/openapi-extractor.test.ts`：覆盖 JSON 格式 OpenAPI 文件解析（`api` + `api-schema` 节点生成，`confidence: 'EXTRACTED'`）；YAML 格式 OpenAPI 文件解析；`$ref` 循环引用截断（超过 5 层生成占位节点 `[ref-truncated]`，不崩溃）；无效 YAML → 跳过并输出警告，返回 `EMPTY_EXTRACTION_RESULT`；AsyncAPI channel/message → `event` 节点（`kind: 'event'`）；`$ref` 正常解析（非循环，节点正确生成）
  - **文件**：`tests/extraction/openapi-extractor.test.ts`（新建，约 120 LOC）
  - **验证**：先确认测试失败 → 实现 T010 后通过

### 实现：US1 — OpenAPI 提取器

- [x] T009 [P] 核查 `src/panoramic/api-surface/openapi-extractor.ts` 现有接口：只读确认 `extractFromSchema()`、`resolveRef()`、`dereference()` 工具函数签名，为包装层设计做准备
  - **文件**：`src/panoramic/api-surface/openapi-extractor.ts`（只读，不修改）
  - **覆盖 FR**：FR-005
  - **验证**：无代码变更，文档记录工具函数签名

- [x] T010 创建 `src/extraction/openapi-extractor.ts`（包装层）：封装对 `api-surface/openapi-extractor.ts` 的 `extractFromSchema()` 调用，将输出转换为 `ExtractionResult`（`api` + `api-schema` 节点，`confidence: 'EXTRACTED'`）；新增轻量 YAML 解析逻辑（基于正则处理 `key: value` 和 `$ref` 场景，覆盖 OpenAPI spec 的 `paths` + `components` 结构）；新增 AsyncAPI channel/message 解析（`event` 节点，FR-006）；在包装层实现 `$ref` 循环检测（`visited: Set<string>` + 绝对层数计数器，上限 5 层，截断处生成占位节点）；扫描目录逻辑：检测 `openapi.yaml`/`openapi.json`/`swagger.yaml`/`asyncapi.yaml`；节点 ID 规则遵循 `data-model.md`
  - **文件**：`src/extraction/openapi-extractor.ts`（新建，约 200 LOC）
  - **覆盖 FR**：FR-004、FR-005、FR-006
  - **验证**：`npx vitest run tests/extraction/openapi-extractor.test.ts`；SC-004：5000 行 OpenAPI 文件解析 < 2 秒（人工计时）

---

### 测试：US2 — Markdown 提取器测试（先行）

- [x] T011 创建 `tests/extraction/markdown-extractor.test.ts`：覆盖标题树确定性提取（heading 层级正确）；frontmatter 解析（字段正确提取）；LLM mock 返回有效 JSON → 命名实体和决策段落提取，`confidence: 'INFERRED'`；LLM mock 返回无效 JSON → 返回空结果，不抛出异常；文件路径引用检测（`` `src/foo/bar.ts` `` → `references` 边）；无法识别任何概念的 Markdown → 返回 `EMPTY_EXTRACTION_RESULT`；大型文件（> 8000 token）按 heading 切分逻辑
  - **文件**：`tests/extraction/markdown-extractor.test.ts`（新建，约 100 LOC）
  - **验证**：先确认测试失败 → 实现 T012 后通过

### 实现：US2 — Markdown 提取器

- [x] T012 创建 `src/extraction/markdown-extractor.ts`：**确定性部分**（无 LLM）：正则提取标题树（`#`/`##`/`###` 层级）和 frontmatter（`---` 分隔块 key-value 解析），生成 `kind: 'document'` 节点（`confidence: 'EXTRACTED'`）；**文件路径引用检测**：扫描反引号内的文件路径（如 `` `src/foo/bar.ts` ``），匹配到已有代码模块时生成 `references` 边（`confidence: 'INFERRED'`，FR-018）；**LLM 实体提取**：调用 LLM 门面（`panoramic/utils/llm-facade`），system prompt 约束模型角色为"结构化信息提取器"，返回预定义 JSON schema（命名实体列表 + 决策段落），LLM 结果标注 `confidence: 'INFERRED'`（FR-003、FR-023）；**大型文件处理**：单文件内容 > 8000 token 时按 heading 切分分段提取，切分后仍超限则降级为启发式关键词提取（不调用 LLM）；**异常降级**：任何 LLM 调用失败返回 `EMPTY_EXTRACTION_RESULT`，不抛出异常
  - **文件**：`src/extraction/markdown-extractor.ts`（新建，约 150 LOC）
  - **覆盖 FR**：FR-001、FR-002、FR-003、FR-018、FR-023
  - **验证**：`npx vitest run tests/extraction/markdown-extractor.test.ts`

---

**Phase 3 检查点**：`npx vitest run tests/extraction/openapi-extractor.test.ts tests/extraction/markdown-extractor.test.ts` 全部通过；SC-001 验收：fixture 含 `openapi.yaml` 运行 `--include-docs` 输出 `api`/`api-schema` 节点（手工验证）；SC-002 验收：fixture 含 ADR Markdown 运行 `--include-docs` 输出 `document` 节点（手工验证）

---

## Phase 4: US3 — 图像/图表 Vision 提取（P2）

**目标**：系统架构师运行 `spectra batch --include-images` 时，架构图被 Claude Vision 分析，生成 `diagram` 节点；Vision API 不可用时三级优雅降级，整体 batch 不失败。

**独立测试方法**：含 `docs/architecture.png` 的测试项目，mock `@anthropic-ai/sdk` 的 `messages.create`，验证 `diagram` 节点生成；mock API key 缺失，验证跳过并输出友好日志。

**依赖**：Phase 1 完成后即可开始，与 Phase 3 可并行。

---

### 测试：US3 — 图像提取器测试（先行）

- [x] T013 创建 `tests/extraction/image-extractor.test.ts`：覆盖 API key 缺失 → 整体跳过，返回 `[]`，输出日志（三级降级级别 1）；Vision mock 返回有效 JSON → `diagram` 节点生成，`confidence: 'INFERRED'`；Vision mock 返回无效 JSON → 返回 `EMPTY_EXTRACTION_RESULT`，不抛出异常（三级降级级别 3）；Vision mock 返回错误/超时 → 单张图片跳过，不影响批次内其他图片（三级降级级别 2）；文件 > 10 MB → 跳过，日志记录路径 + 文件大小（FR-009）；`.bmp`/`.tiff` 格式 → 跳过；SVG 文件以文本方式处理；`SPECTRA_VISION_MODEL` 环境变量覆盖默认模型；图片数量 > 50 → 输出警告（FR-017）
  - **文件**：`tests/extraction/image-extractor.test.ts`（新建，约 120 LOC）
  - **验证**：先确认测试失败 → 实现 T014 后通过

### 实现：US3 — 图像提取器

- [x] T014 创建 `src/extraction/image-extractor.ts`：实现 `extractFromImage(filePath: string, options: ImageExtractorOptions): Promise<ExtractionResult>` 接口；**三级降级路径**：（1）`ANTHROPIC_API_KEY` 不存在时跳过全部图像提取，输出日志（仅显示前 4 位 + `***` 脱敏，FR-022）；（2）Vision API 调用失败时跳过单张图片，返回 `EMPTY_EXTRACTION_RESULT`；（3）LLM 返回内容无法解析为 JSON 时返回 `EMPTY_EXTRACTION_RESULT`；**文件大小检查**：> 10 MB 时跳过，日志记录文件路径 + 文件大小（FR-009）；**格式过滤**：只处理 `.png`/`.jpg`/`.jpeg`（二进制），SVG 以文本方式处理；**Vision API 调用**：通过 `@anthropic-ai/sdk`，模型读取 `SPECTRA_VISION_MODEL` env（默认 `claude-sonnet-4-5`），system prompt 约束"结构化信息提取器"角色（FR-023）；**可注入工厂模式**：`Anthropic` 实例封装为可注入工厂函数，测试时注入 mock 客户端；节点 ID 规则：`diagram:{相对文件路径}`
  - **文件**：`src/extraction/image-extractor.ts`（新建，约 120 LOC）
  - **覆盖 FR**：FR-007、FR-008、FR-009、FR-022、FR-023
  - **验证**：`npx vitest run tests/extraction/image-extractor.test.ts`；SC-005：mock 外单张图片 Vision 调用 < 10 秒（含网络）；SC-008：无 API key 时降级成功，整体 batch 不失败

---

**Phase 4 检查点**：`npx vitest run tests/extraction/image-extractor.test.ts` 全部通过；手工验证 `ANTHROPIC_API_KEY` 未设置时 `spectra batch --include-images` 优雅退出

---

## Phase 5: US4 + US5 — 管道集成、BatchOptions 扩展与 CLI 接入（P1 + P2）

**目标（US4）**：现有 `spectra batch` 不带新标志时行为完全不变（SC-006 零破坏）；`--include-docs` / `--include-images` 选择性启用新能力；`--help` 包含两个标志的描述说明。

**目标（US5）**：`api`、`api-schema`、`event`、`diagram` 节点平滑参与 Louvain 社区检测，不引发类型错误。

**独立测试方法（US4）**：不带新标志运行 `spectra batch`，对比输出 `graph.json` 与 Feature 107 引入前完全一致（节点 kind 集合无新类型）。

**独立测试方法（US5）**：向 fixture 图谱注入 `kind: 'api'` 节点并连边，运行社区检测，确认节点被分配到社区，无类型错误。

**依赖**：Phase 3 和 Phase 4 完成后方可开始。

---

### 测试：US4 — 管道与集成测试（先行）

- [x] T015 创建 `tests/extraction/extraction-pipeline.test.ts`：覆盖 `includeDocs=false && includeImages=false` → 立即返回 `[]`，不扫描任何文件；`includeDocs=true` → 扫描 `.md` 和 API 规范文件（mock 提取器）；`includeImages=true` → 扫描图片文件（mock 提取器）；LLM 并发数上限验证（同时最多 5 个并发 LLM 调用）；Zod 验证失败的提取结果被丢弃，不纳入返回值；缓存命中时跳过提取器调用（mock 缓存读取返回结果）；图片数量 > 50 → 输出警告消息
  - **文件**：`tests/extraction/extraction-pipeline.test.ts`（新建，约 100 LOC）
  - **验证**：先确认测试失败 → 实现 T016 后通过

### 实现：US4 — 管道层

- [x] T016 创建 `src/extraction/extraction-pipeline.ts`：实现 `runExtractionPipeline(options: ExtractionPipelineOptions): Promise<ExtractionResult[]>`；**文件扫描**：`includeDocs=true` 时扫描 `.md` 文件（排除 `specs/`、`node_modules/`、`dist/`、`.git/`）和 API 规范文件；`includeImages=true` 时扫描 `docs/`、`assets/`、`images/` 下的图片；**分类路由**：调用 `ArtifactClassifier.classifyFile()` 分发到对应提取器；**缓存集成**：提取前先查询 `ExtractionCache`，命中则跳过提取器调用；**并发控制**：Markdown LLM 提取使用 `Promise.all` + 手写并发池，并发上限 5，单次超时上限 8 秒（FR-016）；**Zod 验证**：所有提取结果经 `ExtractionResultSchema.parse()` 验证，失败则记录警告日志并丢弃（FR-015）；**图片数量警告**：> 50 张时输出警告提示用户 Vision API 调用成本（FR-017）；**异常隔离**：单个文件提取异常不中断整体管道，降级为 `EMPTY_EXTRACTION_RESULT`；**函数承诺**：不抛出异常（契约要求）
  - **文件**：`src/extraction/extraction-pipeline.ts`（新建，约 100 LOC）
  - **覆盖 FR**：FR-015、FR-016、FR-017
  - **验证**：`npx vitest run tests/extraction/extraction-pipeline.test.ts`

- [x] T017 创建 `src/extraction/index.ts`：导出 `runExtractionPipeline` 函数和 `ExtractionPipelineOptions` 类型；导出 `ExtractionResult`、`ExtractedNode`、`ExtractedEdge` 类型（re-export from extraction-types.ts）
  - **文件**：`src/extraction/index.ts`（新建，约 10 LOC）
  - **覆盖 FR**：无直接 FR，支撑管道集成
  - **验证**：`npm run build` 无未解析导入

### 实现：US4 — graph-builder 第四路合并

- [x] T018 修改 `src/panoramic/graph/graph-builder.ts`：在步骤 3（CrossReferenceLinks 处理）之后、悬空边过滤之前，新增步骤 3.5（提取结果合并）；遍历 `options.extractionResults`，将 `ExtractedNode` 转换为 `GraphNode` 合并进 `nodeMap`（`id` 为去重键，`last-write-wins`，`metadata` 追加 `sourceTag: 'extraction'`）；遍历 `ExtractedEdge` 合并进 `edgeMap`；悬空边（`source` 或 `target` 节点 `id` 不存在）静默跳过，不纳入图谱（FR-011）；整个步骤 3.5 包裹在 try/catch 中，异常时记录 `skippedSources` 并继续；`options.extractionResults` 为空或 undefined 时跳过步骤 3.5，不影响现有三路合并（SC-006 零破坏核心保证）
  - **文件**：`src/panoramic/graph/graph-builder.ts`（修改，约 +40 LOC）
  - **覆盖 FR**：FR-011
  - **验证**：`npm run build`；`npx vitest run`（全量测试回归验证）

### 实现：US4 — BatchOptions 扩展

- [x] T019 修改 `src/batch/batch-orchestrator.ts`：**接口扩展**：在 `BatchOptions` 接口（约 L52-L71）新增 `includeDocs?: boolean` 和 `includeImages?: boolean` 可选字段（FR-012）；**管道集成**：在知识图谱构建块（约 L608-L634）中，当 `options.includeDocs || options.includeImages` 时，动态 import `src/extraction/index.js` 并调用 `runExtractionPipeline()`，结果传入 `buildKnowledgeGraph()` 的 `extractionResults` 字段；动态 import 包裹在 try/catch 中，提取失败记录 warn 日志后继续（不中断 batch）；两个标志均为 `false` 时绝对不调用提取管道（SC-006 零破坏）
  - **文件**：`src/batch/batch-orchestrator.ts`（修改，约 +30 LOC）
  - **覆盖 FR**：FR-012
  - **验证**：`npm run build`；运行不带新标志的 `spectra batch` 确认 `graph.json` 无新节点类型

### 实现：US4 — CLI 标志接入

- [x] T020 修改 `src/cli/utils/parse-args.ts`：**接口扩展**：在 `CLICommand` 接口（约 L8-L55）新增 `includeDocs?: boolean` 和 `includeImages?: boolean` 可选字段；**标志解析**：在 batch 子命令解析块（约 L513-L538）新增 `argv.includes('--include-docs')` 和 `argv.includes('--include-images')` 解析，加入 `explicitFlags` 并纳入返回对象；**帮助文本**：在 batch 子命令的 `--help` 输出中新增两行说明（`--include-docs` 和 `--include-images` 描述，参考 `contracts/batch-options-extension.contract.md` 帮助文本格式，FR-013）
  - **文件**：`src/cli/utils/parse-args.ts`（修改，约 +20 LOC）
  - **覆盖 FR**：FR-013
  - **验证**：`npx spectra batch --help` 输出包含两个标志的说明；`npm run build` 零错误

### 实现：US5 — Louvain 社区检测兼容性验证

- [x] T021 [P] 验证 `src/panoramic/community/` 中处理 `GraphNode.kind` 的代码对新增四种 kind 值的向后兼容性：Grep 检查是否存在 exhaustive switch（`switch (node.kind)`），若存在则补充新 case 或 default 分支；验证边权重统一使用 `weight: 1.0`（FR-021），无差异化权重逻辑；确认 `INFERRED` 置信度不参与图算法计算
  - **文件**：`src/panoramic/community/`（可能修改，视 exhaustive switch 检查结果，约 +0~10 LOC）
  - **覆盖 FR**：FR-021
  - **验证**：`npm run build` 对 community 模块无类型错误；注入 `api` 节点运行社区检测无报错

---

**Phase 5 检查点**：`npx vitest run tests/extraction/extraction-pipeline.test.ts` 通过；`npx vitest run`（全量）通过；SC-006 回归验证：不带新标志的 `spectra batch` 输出与 Feature 107 前完全一致

---

## Phase 6: Polish & Cross-Cutting Concerns

**目标**：端到端验证、性能基准确认、API key 安全审查、最终全量测试与构建检查。

---

- [x] T022 [P] 全量单元测试与 TypeScript 构建最终验证：运行 `npx vitest run` 确认所有新增测试零失败；运行 `npm run build` 确认 TypeScript 类型检查零错误（SC-010）
  - **文件**：无代码变更，执行验证命令
  - **验证**：`npx vitest run && npm run build`

- [x] T023 [P] SC-006 回归验证：在现有 fixture 项目中运行不带新标志的 `spectra batch`，对比 `graph.json` 与 Feature 107 引入前的输出（节点数量、kind 集合），确认零破坏
  - **文件**：无代码变更，执行集成验证
  - **验证**：`graph.json` 的 `kind` 字段集合不包含 `api | api-schema | event | diagram`

- [x] T024 [P] SC-001/SC-002 端到端验证：构造含 `openapi.yaml`（有 `/users` GET endpoint 和 `UserSchema`）的 fixture 目录，运行 `spectra batch --include-docs`，验证 `graph.json` 包含 `kind: 'api'`、`label: 'GET /users'` 节点和 `kind: 'api-schema'`、`label: 'UserSchema'` 节点，`confidence: 'EXTRACTED'`；构造含 `docs/adr-001.md`（标准 ADR 格式）的 fixture，验证 `document` 节点和 `metadata.concepts` 非空
  - **文件**：`tests/fixtures/` 下新建 fixture 目录（新建测试数据）
  - **验证**：SC-001、SC-002 手工验收通过

- [x] T025 FR-022 API key 脱敏全代码审查：Grep 检查 `src/extraction/` 下所有文件中 `ANTHROPIC_API_KEY` 的使用位置，确认日志输出仅显示前 4 位 + `***`，无完整 key 值泄露到日志、错误信息或 trace 文件
  - **文件**：`src/extraction/image-extractor.ts`（可能修改，视审查结果）
  - **覆盖 FR**：FR-022
  - **验证**：代码审查通过；grep 无全量 key 输出

- [x] T026 [P] SC-004 性能基准验证（人工）：构造 5000 行规模 OpenAPI fixture 文件，计时运行 `openapi-extractor.ts` 解析，确认耗时 < 2 秒
  - **文件**：`tests/fixtures/` 下新建大型 OpenAPI fixture
  - **验证**：SC-004 性能目标 < 2 秒

- [x] T027 [P] SC-007 缓存跳过验证：在完成一次 `spectra batch --include-docs` 后（缓存已写入），不修改文件内容再次运行，观察日志确认文件命中缓存跳过提取，不重复调用 LLM 或 Vision API
  - **文件**：无代码变更，执行验证
  - **验证**：SC-007 缓存命中行为确认

- [x] T028 运行仓库级同步检查：执行 `npm run repo:check` 和 `npm run release:check`，确认无同步漂移
  - **文件**：无代码变更
  - **验证**：两个检查命令零错误退出

---

## FR 覆盖映射表

| FR | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| FR-001 | 扫描 `.md` 文件生成 `document` 节点 | T002、T012 |
| FR-002 | 确定性提取 Markdown 标题结构和 frontmatter | T012 |
| FR-003 | LLM 提取命名实体，标注 `INFERRED` | T012 |
| FR-004 | 检测 OpenAPI/AsyncAPI 文件，确定性解析，`EXTRACTED` 置信度 | T010 |
| FR-005 | 复用 `api-surface/openapi-extractor.ts` 工具函数 | T009、T010 |
| FR-006 | AsyncAPI channel/message 提取，生成 `event` 节点 | T010 |
| FR-007 | Vision API 图像提取，`diagram` 节点，`INFERRED` 置信度 | T014 |
| FR-008 | 三级降级路径（API key 缺失、调用失败、JSON 解析失败） | T014 |
| FR-009 | 跳过 > 10 MB 图片并记录日志 | T014 |
| FR-010 | 扩展 `GraphNode.kind` 类型定义 | T007 |
| FR-011 | `buildKnowledgeGraph()` 接受第四路 `extractionResults`，悬空边静默跳过 | T018 |
| FR-012 | 扩展 `BatchOptions` 新增 `includeDocs` / `includeImages` 字段 | T019 |
| FR-013 | CLI 新增 `--include-docs` / `--include-images` 标志及帮助文本 | T020 |
| FR-014 | 文件级 SHA256 哈希缓存（frontmatter 不影响 hash） | T003 |
| FR-015 | Zod schema 验证所有 `ExtractionResult`，失败时丢弃 | T001、T016 |
| FR-016 | Markdown 并发上限 5，单次超时 8 秒 | T016 |
| FR-017 | 图片 > 50 张时输出警告 | T016 |
| FR-018 | 文件路径引用检测，生成 `document → module` 边 | T012 |
| FR-021 | 新增节点参与 Louvain 使用统一 `weight: 1.0` | T021 |
| FR-022 | API key 脱敏（前 4 位 + `***`） | T014、T025 |
| FR-023 | LLM 调用使用 system prompt 约束，结果经 Zod 验证 | T012、T014 |
| FR-024 | `BuildGraphOptions` 新增 `extractionResults?` 字段 | T007 |

**覆盖率**：24/24 FR 100% 覆盖（FR-019、FR-020 已明确标注 YAGNI-移除，不需要任务）

---

## 依赖与并行执行说明

### Phase 依赖关系

```
Phase 1（类型层 + 基础设施）
    ↓ 阻塞
Phase 2（graph-types 扩展）← 可与 Phase 1 并行（不依赖新建文件）
    ↓ 两者完成后
Phase 3（OpenAPI 提取器 + Markdown 提取器）← 可并行于 Phase 4
Phase 4（图像提取器）← 可并行于 Phase 3
    ↓ 两者完成后
Phase 5（管道集成 + BatchOptions + CLI + 社区检测兼容性）
    ↓
Phase 6（Polish + 端到端验证）
```

### User Story 间依赖

- **US1（OpenAPI 提取）** 和 **US2（Markdown 提取）** 可并行实现（不同提取器文件，无相互依赖），均依赖 Phase 1 完成
- **US3（图像提取）** 可在 Phase 1 完成后立即开始，与 US1/US2 完全并行
- **US4（Batch CLI 集成）** 依赖 US1、US2、US3 全部完成后方可集成
- **US5（社区检测兼容性）** 仅依赖 T007（graph-types 扩展），可在 Phase 2 完成后独立验证

### Story 内并行机会

- T001、T002、T003（Phase 1 实现）可完全并行
- T004、T005、T006（Phase 1 测试）可完全并行
- T008（OpenAPI 测试）和 T011（Markdown 测试）可并行编写
- T010（OpenAPI 实现）和 T012（Markdown 实现）可并行开发
- T022、T023、T024、T025、T026、T027（Phase 6 验证）中独立验证项可并行

### 推荐实现策略

**MVP First（最小可交付集）**：
1. 完成 Phase 1（类型层基础）
2. 完成 Phase 2（GraphNode.kind 扩展）
3. 完成 Phase 3 中的 US1（OpenAPI 提取器）—— 确定性、无 LLM、最低风险
4. 完成 Phase 5 的 US4 集成任务（T016、T017、T018、T019、T020）
5. **停止并验证 MVP**：`spectra batch --include-docs` 正确生成 `api` 节点

**Incremental Delivery 顺序**：
1. MVP（US1 OpenAPI 提取）→ 验证 SC-001
2. US2（Markdown 提取）→ 验证 SC-002
3. US3（图像提取）→ 验证 SC-005、SC-008
4. US4（完整 CLI 集成）→ 验证 SC-006 零破坏
5. US5（社区检测兼容性）→ 验证 SC-009
