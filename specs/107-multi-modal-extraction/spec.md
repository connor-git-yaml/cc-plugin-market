---
feature: 107-multi-modal-extraction
branch: claude/frosty-banzai
created: 2026-04-12
status: Approved
milestone: M-100 Spectra Evolution Phase 6
target_version: v3.6.0
priority: P6
---

# Feature 107: 多模态工程制品提取

## 概述

本 Feature 扩展 Spectra 知识图谱的数据源范围，从代码文件之外的工程制品（Markdown 文档、OpenAPI/AsyncAPI 规范、图像图表）中提取结构化知识节点，并将其纳入 `graph.json` 知识图谱，从而为整个项目提供更完整的语义理解视图。

本 Feature 是 M-100 Spectra Evolution 里程碑的收官功能（Phase 6），依赖 Feature 100（content-hash-cache）和 Feature 101（graph-persistence）已完成。

---

## 用户场景与测试

### 用户故事 1 — OpenAPI/AsyncAPI 规范提取（优先级：P1）

作为一名后端工程师，当我运行 `spectra batch --include-docs` 时，我希望项目中的 API 规范文件（`openapi.yaml`、`asyncapi.yaml` 等）被自动解析，并以 `api`、`api-schema`、`event` 节点的形式出现在 `graph.json` 中，以便我可以在知识图谱中浏览服务接口定义与代码模块的关系。

**优先级理由**：确定性提取（纯 AST/schema 解析，无 LLM 依赖），实现风险最低；API 规范是工程团队最常见的非代码制品；是 P1 MVP 中提供即时可验证价值的能力。

**独立测试方法**：在含 `openapi.yaml` 的测试项目中运行 `spectra batch --include-docs`，检查输出的 `graph.json` 中包含 `kind: 'api'` 和 `kind: 'api-schema'` 节点，且 `confidence` 均为 `EXTRACTED`。

**验收场景**：

1. **Given** 项目根目录下存在 `openapi.yaml`（含 `/users` GET endpoint 和 `UserSchema` 定义），**When** 运行 `spectra batch --include-docs`，**Then** `graph.json` 包含一个 `kind: 'api'`、`label: 'GET /users'` 的节点，和一个 `kind: 'api-schema'`、`label: 'UserSchema'` 的节点，所有边的 `confidence` 均为 `EXTRACTED`。

2. **Given** 项目中存在 `asyncapi.yaml`（含 `user.created` 事件 channel），**When** 运行 `spectra batch --include-docs`，**Then** `graph.json` 包含一个 `kind: 'event'`、`label: 'user.created'` 的节点。

3. **Given** `openapi.yaml` 中存在 `$ref` 引用（包括嵌套 `$ref`），**When** 提取时，**Then** 引用被正确解析，不出现循环递归崩溃，所有被引用 schema 均生成对应节点。

4. **Given** API 规范文件格式错误（无效 YAML），**When** 提取时，**Then** 提取器跳过该文件并输出日志警告，其余文件正常提取，整个 batch 流程不中断。

---

### 用户故事 2 — Markdown 文档提取（优先级：P1）

作为一名技术负责人，当我运行 `spectra batch --include-docs` 时，我希望项目中的 Markdown 文档（设计文档、ADR、README）中的核心概念、设计决策和命名实体被提取为 `document` 节点，并与相关代码模块建立关联边，以便在知识图谱中追踪"为什么做这个决策"到"在哪里实现了它"的完整链路。

**优先级理由**：Markdown 文档是团队知识最密集的载体；与 OpenAPI 提取共用同一个 `--include-docs` 标志，合并实现为 P1 MVP。

**独立测试方法**：在含 `docs/adr-001.md`（标准 ADR 格式）的测试项目中运行 `spectra batch --include-docs`，检查 `graph.json` 包含 `kind: 'document'` 节点，节点 `metadata.concepts` 包含文档中识别到的概念列表。

**验收场景**：

1. **Given** `docs/adr-001.md` 包含标题 `# ADR-001: 选择 PostgreSQL` 和含 "Decision:" 的段落，**When** 运行 `spectra batch --include-docs`，**Then** `graph.json` 包含一个 `kind: 'document'`、`metadata.section: 'decision'` 的节点，`confidence` 为 `INFERRED`（LLM 提取）。

2. **Given** Markdown 文档中的文件路径引用（如 `` `src/database/pg-client.ts` ``）可以匹配到现有代码模块节点，**When** 提取时，**Then** 自动生成 `document → module` 关联边，`confidence` 标记为 `INFERRED`。

3. **Given** 项目中有 100 个 `.md` 文件，**When** 运行完整提取，**Then** 提取总耗时（含 LLM 调用）在 30 秒以内。

4. **Given** 同一个 `.md` 文件内容未发生变化（frontmatter 除外），**When** 再次运行 batch，**Then** 该文件命中缓存，跳过重复提取，耗时显著减少。

5. **Given** Markdown 文件无法识别出任何概念或决策，**When** 提取时，**Then** 不生成节点（返回空结果），不抛出错误。

---

### 用户故事 3 — 图像/图表理解（优先级：P2）

作为一名系统架构师，当我运行 `spectra batch --include-images` 时，我希望项目 `docs/`、`assets/`、`images/` 目录下的架构图和流程图被 Claude Vision 分析，提取其中的组件和关系，生成 `diagram` 节点，以便知识图谱能够涵盖非文本形式表达的架构信息。

**优先级理由**：依赖 LLM Vision API，运行成本较高且存在网络依赖，适合作为独立可选能力（单独 `--include-images` 标志）；相比文本提取，架构图解析需要额外评估质量，故定为 P2。

**独立测试方法**：在含 `docs/architecture.png` 的测试项目中运行 `spectra batch --include-images`（配合有效 API key），检查 `graph.json` 包含 `kind: 'diagram'` 节点，`metadata` 中包含 Vision 识别的组件描述。

**验收场景**：

1. **Given** `docs/architecture.png` 是一张系统架构图（< 10 MB），且 `ANTHROPIC_API_KEY` 环境变量存在，**When** 运行 `spectra batch --include-images`，**Then** `graph.json` 包含至少一个 `kind: 'diagram'` 节点，`confidence` 为 `INFERRED`，单张图片提取耗时 < 10 秒。

2. **Given** 图片文件大小 > 10 MB，**When** 提取时，**Then** 自动跳过该图片，输出日志提示（包含文件路径和文件大小），不抛出错误。

3. **Given** `ANTHROPIC_API_KEY` 未配置，**When** 运行 `spectra batch --include-images`，**Then** 图像提取步骤整体跳过（降级为空结果），输出友好日志提示，其他提取步骤正常执行，整个 batch 不失败。

4. **Given** Vision API 调用超时或返回错误，**When** 提取某张图片时，**Then** 该图片跳过（返回空结果），不影响同批次其他图片和文档的提取。

5. **Given** 同一张图片内容未变化，**When** 再次运行 `spectra batch --include-images`，**Then** 命中文件级缓存，不重复调用 Vision API。

---

### 用户故事 4 — Batch CLI 集成（优先级：P1）

作为一名 DevOps 工程师，我希望现有的 `spectra batch` 命令在默认情况下行为完全不变，通过显式加 `--include-docs` 或 `--include-images` 标志来选择性启用新的提取能力，以便我可以在 CI/CD 流水线中稳定集成，按需开启多模态提取。

**优先级理由**：标志默认关闭是对现有用户的零破坏兼容性承诺，必须作为 P1 硬性约束实现。

**独立测试方法**：在现有项目中运行不带任何新标志的 `spectra batch`，确认 `graph.json` 输出与 Feature 107 引入前完全一致（节点数量和类型不变）。

**验收场景**：

1. **Given** 任何已有项目，**When** 运行 `spectra batch`（不带新标志），**Then** 输出的 `graph.json` 内容与引入 Feature 107 之前完全一致，`GraphNode.kind` 不包含 `api | api-schema | event | diagram`。

2. **Given** 运行 `spectra batch --include-docs --include-images`，**When** 同时启用两个标志，**Then** Markdown 提取、OpenAPI 提取、图像提取均执行，结果全部合并入同一个 `graph.json`。

3. **Given** 运行 `spectra batch --help`，**When** 输出帮助信息，**Then** 包含 `--include-docs` 和 `--include-images` 的描述说明。

---

### 用户故事 5 — GraphNode.kind 扩展与社区检测（优先级：P2）

作为一名使用 MCP 查询工具（Feature 105）的开发者，我希望新增的 `api`、`api-schema`、`event`、`diagram` 节点类型能够平滑参与社区检测（Feature 102 Louvain 算法），以便 API endpoint 作为一等公民出现在模块社区聚类结果中。

**优先级理由**：类型扩展是基础能力，但其在下游（社区检测、MCP 查询）的集成验证属于质量保障范畴，不阻塞 P1 交付。

**独立测试方法**：向图谱中注入若干 `kind: 'api'` 节点（有边连接到现有 `module` 节点），运行社区检测，确认 `api` 节点出现在社区聚类结果中，不引发类型错误。

**验收场景**：

1. **Given** `graph.json` 包含 `kind: 'api'` 节点且该节点与若干 `module` 节点有边相连，**When** 运行社区检测（Louvain），**Then** `api` 节点被正确分配到某个社区，社区检测不报错。

2. **Given** 现有处理 `GraphNode.kind` 的代码（如渲染、过滤逻辑），**When** 遇到新增的四种 kind 值，**Then** 不抛出 TypeScript 类型错误，行为降级到默认处理（向后兼容）。

---

### 边界情况

- **文档目录扫描边界**：扫描 `.md` 文件时，排除 `specs/`、`node_modules/`、`dist/`、`.git/` 目录；图片扫描限定 `docs/`、`assets/`、`images/` 目录，防止误抓 `node_modules/` 内图片资源。

- **敏感文件保护**：提取扫描阶段跳过 `.env`、私钥、证书等匹配敏感文件模式的文件，参考 Graphify `detect.py::_is_sensitive()` 逻辑。

- **大型 Markdown 文件**：单个 Markdown 文件内容过长导致 LLM 上下文超限时（单块 > 8000 token），按 heading 切分后分段提取；若分段后仍无法处理，降级为仅做启发式关键词提取（不调用 LLM）。

- **OpenAPI `$ref` 循环引用**：`$ref` 解析时使用 `visited` set 检测循环，遇到循环时截断递归（深度上限 5 层，从 schema 根节点计算绝对层数），截断处生成一个 `kind: 'api-schema'`、`label: '{SchemaName} [ref-truncated]'` 的占位节点，不抛出异常。[AUTO-CLARIFIED: 绝对层数 + 占位节点 — 绝对层数计算简单无歧义；占位节点保留图谱可达性，比静默跳过更利于调试]

- **空目录/无匹配文件**：指定扫描目录不存在或目录下无符合条件的文件时，对应提取器返回空结果，不报错。

- **图片格式不支持**：Claude Vision 不支持的图片格式（如 `.bmp`、`.tiff`）自动跳过，仅处理 `.png`、`.jpg`、`.jpeg`、`.svg`（SVG 以文本方式提取）。

- **Vision 返回非结构化内容**：当 Vision API 返回内容无法解析为预期 JSON 格式时，返回空 `ExtractionResult`，不中断提取管道。

- **并发 LLM 调用限制**：Markdown LLM 实体提取使用 `Promise.all` 并发，并发数上限为 5，单次 LLM 调用超时上限为 8 秒（100 个文件 ÷ 5 并发 × 8 秒/次 ≈ 160 秒理论上限，实际因缓存命中率可远低于此；SC-003 的 30 秒目标针对首次全量提取中大多数文件缓存命中的场景，即超过 80% 文件已缓存时成立）。[AUTO-CLARIFIED: 超时 8 秒 — 符合 Anthropic API p95 响应分布，兼顾 SC-003 可达性与 API 限速保护]

---

## 功能需求

### 核心实体

- **ArtifactExtractor（制品提取器）**：负责从单类型文件中提取结构化节点和边的处理单元。三种提取器：`MarkdownExtractor`、`OpenApiExtractor`、`ImageExtractor`。
- **ExtractedNode（提取节点）**：从非代码制品中提取的图谱节点，含 `id`、`label`、`kind`、`source_file`、`confidence`、`metadata` 字段；需通过 Zod schema 验证。
- **ExtractedEdge（提取边）**：节点间关系，含 `source`、`target`、`relation`、`confidence`（三级：`EXTRACTED / INFERRED / AMBIGUOUS`）。
- **ExtractionResult（提取结果）**：单次文件提取的输出，`{ nodes: ExtractedNode[], edges: ExtractedEdge[] }`，是提取层与图谱层的数据契约。
- **ExtractionPipeline（提取管道）**：协调多个提取器执行、缓存查询、结果合并，向 `BatchOrchestrator` 暴露 `runExtractionPipeline()` 接口。

### 功能需求列表

**FR-001**：系统 MUST 在运行 `spectra batch --include-docs` 时自动扫描项目中的 `.md` 文件（排除 `specs/`、`node_modules/`、`dist/`、`.git/` 目录），并将每个文档解析为 `kind: 'document'` 的 `ExtractedNode`。 **[必须]**

**FR-002**：系统 MUST 从 Markdown 文档中确定性地提取标题结构（heading 树）和 frontmatter 字段，无需 LLM 即可完成。 **[必须]**

**FR-003**：系统 MUST 通过 LLM 从 Markdown 文档中提取命名实体（组件名、服务名、技术栈名）和设计决策段落，并将所有 LLM 提取的结果标记 `confidence: 'INFERRED'`，不允许标记为 `EXTRACTED`。 **[必须]**

**FR-004**：系统 MUST 在运行 `spectra batch --include-docs` 时自动检测项目中的 OpenAPI（`openapi.yaml`/`openapi.json`/`swagger.yaml`）和 AsyncAPI（`asyncapi.yaml`）文件，使用确定性 AST/schema 解析（不引入 `openapi-parser` 等重依赖），将 Endpoint 提取为 `kind: 'api'` 节点、Request/Response Schema 提取为 `kind: 'api-schema'` 节点，所有节点和边标记 `confidence: 'EXTRACTED'`。 **[必须]**

**FR-005**：系统 MUST 复用 `src/panoramic/api-surface/openapi-extractor.ts` 中的现有解析逻辑（`resolveRef`、`dereference` 等工具函数），不重复实现 schema walker。 **[必须]**

**FR-006**：系统 MUST 支持 AsyncAPI 的 channel/message 提取，生成 `kind: 'event'` 节点。 **[必须]**

**FR-007**：系统 MUST 在运行 `spectra batch --include-images` 时扫描 `docs/`、`assets/`、`images/` 目录下的图片文件（`.png`、`.jpg`、`.jpeg`），通过 `@anthropic-ai/sdk` 的 Claude Vision API（使用 `claude-sonnet-4-5` 模型）提取架构组件和关系，生成 `kind: 'diagram'` 节点，`confidence` 标记为 `INFERRED`。用户可通过 `SPECTRA_VISION_MODEL` 环境变量覆盖默认模型。 **[必须]**

**FR-008**：系统 MUST 在图像提取时实现三级降级路径：（1）API key 不存在时跳过全部图像提取并输出日志；（2）Vision API 调用失败时跳过单张图片；（3）LLM 返回内容无法解析为 JSON 时返回空 `ExtractionResult`；任何降级路径均不中断整体 batch 流程。 **[必须]**

**FR-009**：系统 MUST 跳过文件大小超过 10 MB 的图片，并在日志中记录跳过原因（文件路径 + 文件大小）。 **[必须]**

**FR-010**：系统 MUST 扩展 `GraphNode.kind` 类型定义（`src/panoramic/graph/graph-types.ts`），新增 `'api' | 'api-schema' | 'event' | 'diagram'`，扩展需向后兼容，不破坏现有处理 `kind` 字段的代码。 **[必须]**

**FR-011**：系统 MUST 扩展 `buildKnowledgeGraph()` 接受可选的 `extractionResults?: ExtractionResult[]` 第四路数据源，在现有三路数据源处理完成后顺序合并，合并去重键为节点 `id` 字段（`last-write-wins`），悬空边（边的 `source` 或 `target` 节点 `id` 在图中不存在）静默跳过不纳入图谱。[AUTO-CLARIFIED: 以 `id` 为去重键 — `id` 是图谱节点的全局唯一标识符，与 Graphify `build.py` 的 dict key 语义对齐；复合键会引入不必要的跨文件匹配复杂度] **[必须]**

**FR-012**：系统 MUST 扩展 `BatchOptions` 接口，新增 `includeDocs?: boolean`（默认 `false`）和 `includeImages?: boolean`（默认 `false`）字段，在不传递这两个标志时，batch 行为与 Feature 107 引入前完全一致。 **[必须]**

**FR-013**：系统 MUST 在 CLI 中新增 `--include-docs` 和 `--include-images` 两个 boolean 标志，映射到 `BatchOptions` 对应字段，并在 `--help` 输出中提供描述说明。 **[必须]**

**FR-014**：系统 MUST 为提取层实现独立的文件级哈希缓存（`SHA256(文件内容 body + 绝对路径)`），Markdown 文件的哈希仅计算 frontmatter 之后的 body 部分（frontmatter-only 变更不使缓存失效），缓存存储在 `{outputDir}/_meta/extraction-cache/{hash}.json`。 **[必须]**

**FR-015**：系统 MUST 使用 Zod schema 对所有 `ExtractionResult` 进行运行时验证，验证失败的结果记录警告日志并丢弃，不纳入图谱。 **[必须]**

**FR-016**：系统 SHOULD 在 Markdown 实体提取时使用 `Promise.all` 并发处理多个文件，并发数上限为 5，单次 LLM 调用超时上限为 8 秒，防止 API 限速。 **[必须]**

**FR-017**：系统 SHOULD 在检测到图片文件数量超过 50 张时输出警告提示（参考 Graphify `FILE_COUNT_UPPER` 机制），告知用户 Vision API 调用成本。 **[可选]**

**FR-018**：系统 SHOULD 在文档中检测到引用现有代码模块的文件路径时（如 `` `src/foo/bar.ts` ``），自动生成 `document → module` 关联边，`confidence` 标记为 `INFERRED`。 **[必须]**

**FR-019**：系统 MAY 在未来通过向 `artifact-classifier.ts` 新增 `pdf` 类型来支持 PDF 文档提取，当前版本不实现。 **[YAGNI-移除]** 移除理由：当前迭代无 PDF 需求，`ArtifactExtractor` 接口天然支持扩展，无需在 MVP 中预留实现。

**FR-020**：系统 MAY 在扫描文件时支持 `.spectraignore` 文件（类 gitignore 语义）自定义排除规则。**[YAGNI-移除]** 移除理由：当前通过硬编码排除规则（`specs/`、`node_modules/`、`dist/`）即可满足需求，`.spectraignore` 投入产出比不高，可待需求明确后再实现。

**FR-021**：新增的 `api`、`api-schema`、`event`、`diagram` 节点参与 Louvain 社区检测时，使用与 `module` 节点相同的默认边权重（`weight: 1.0`），不引入差异化权重；`INFERRED` 置信度仅用于数据溯源，不影响图算法计算。[AUTO-CLARIFIED: 统一权重 — 差异化权重需要调参验证，当前无基准数据支撑；统一权重保证向后兼容，满足用户故事 5 最低验收要求] **[必须]**

**FR-022**：系统 MUST 在所有日志输出中对 `ANTHROPIC_API_KEY` 环境变量进行脱敏处理（仅显示前 4 位 + `***`），不得在日志、错误信息、trace 文件中包含完整 API key 原值。 **[必须]**

**FR-023**：系统 MUST 在将 Markdown 文件内容和图片传入 LLM 时，使用 system prompt 约束模型角色为"结构化信息提取器"，仅返回预定义 JSON schema 格式的输出；LLM 返回内容必须经过 Zod schema 验证（FR-015），不直接信任 LLM 输出作为图谱数据。 **[必须]**

**FR-024**：系统 MUST 在 `BuildGraphOptions` 类型定义（`src/panoramic/graph/graph-types.ts`）中新增 `extractionResults?: ExtractionResult[]` 可选字段，保持与现有三路数据源字段（`architectureIR`、`docGraph`、`crossReferenceLinks`）的类型签名风格一致。 **[必须]**

---

## 成功标准

### 可测量成果

**SC-001**：运行 `spectra batch --include-docs` 处理含 `openapi.yaml` 的项目，`graph.json` 中出现 `kind: 'api'` 或 `kind: 'api-schema'` 节点，`confidence` 均为 `EXTRACTED`。

**SC-002**：运行 `spectra batch --include-docs` 处理含 ADR Markdown 文档的项目，`graph.json` 中出现 `kind: 'document'` 节点，且节点 `metadata` 包含概念/决策提取结果。

**SC-003**：Markdown 文档提取（100 个 `.md` 文件，缓存命中率 > 80%）总耗时 < 30 秒；首次全量提取（零缓存）不设硬性上限，但建议 < 3 分钟。

**SC-004**：单个 OpenAPI 文件解析（5,000 行规模）耗时 < 2 秒。

**SC-005**：单张图片 Vision 提取（< 10 MB）耗时 < 10 秒；图像提取降级跳过（无 API key 或文件过大）耗时 < 100 ms。

**SC-006**：运行不带新标志的 `spectra batch`，`graph.json` 内容与引入 Feature 107 前完全一致（回归零破坏）。

**SC-007**：同一文件内容未变化时，二次 batch 命中缓存，跳过该文件的提取步骤，不重复调用 LLM 或 Vision API。

**SC-008**：Vision API 不可用（无 API key、调用失败）时，`spectra batch --include-images` 优雅降级，整体 batch 流程以成功状态退出，日志提示清晰。

**SC-009**：新增的 `api`、`api-schema`、`event`、`diagram` 节点参与社区检测（Louvain）不引发类型错误，节点被正常分配到社区。

**SC-010**：所有新增代码通过 `npx vitest run` 零失败，`npm run build` TypeScript 类型检查零错误。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 评估维度 | 数值 / 描述 |
|---------|------------|
| **组件总数** | 8 个新增组件（`MarkdownExtractor`、`OpenApiExtractor`（包装层）、`ImageExtractor`、`ExtractionPipeline`、`ExtractionCache`、`ArtifactClassifier`、`extraction-types`、`index`） |
| **接口数量** | 5 个（`ArtifactExtractor<T>` 新接口；`BatchOptions` 扩展；`BuildGraphOptions` 扩展；`GraphNode.kind` 类型扩展；CLI 参数扩展） |
| **依赖新引入数** | 1 个可能新增（`marked` Markdown AST 解析库；零新增原则下可用现有正则模式替代，待实现阶段决策） |
| **跨模块耦合** | 需修改 3 个现有模块：`src/panoramic/graph/graph-types.ts`、`src/panoramic/graph/graph-builder.ts`、`src/batch/batch-orchestrator.ts`、`src/cli/utils/parse-args.ts`（共 4 处修改点） |
| **复杂度信号** | 并发控制（LLM 并发数上限 `Promise.all` + 限制）；LLM 依赖（Vision + 文本提取）；降级路径多（三级降级） |
| **总体复杂度** | **MEDIUM-HIGH** |

**判定依据**：组件数 8 > 5（HIGH 信号）；接口数 5（MEDIUM 区间）；存在并发控制复杂度信号（MEDIUM 信号）；但核心提取逻辑有 Graphify 直接参照，实现风险可控。建议 GATE_DESIGN 重点审查：（1）`buildKnowledgeGraph()` 第四路数据源的合并边界；（2）OpenAPI 循环 `$ref` 防护；（3）Markdown LLM 并发策略。

---

## Clarifications

### Session 2026-04-12

以下为需求澄清阶段自动解决和待用户决策的问题记录。

#### AUTO-CLARIFIED-1：`buildKnowledgeGraph()` 第四路数据源合并去重键

**问题**：`extractionResults` 与现有三路数据源合并时，节点去重的判定键是 `id` 字段还是 `(source_file + kind + label)` 复合键？

**自动选择**：以节点 `id` 字段为去重键（`last-write-wins`）。

**理由**：`id` 是图谱节点全局唯一标识符，与 Graphify `build.py` dict key 语义对齐，实现简单无歧义。复合键会引入跨文件路径匹配复杂度，且 `ExtractedNode` 的 `id` 生成规则由提取器负责保证唯一性。已更新 FR-011。

---

#### AUTO-CLARIFIED-2：OpenAPI `$ref` 循环引用截断行为

**问题**：深度上限 5 层是从根节点的绝对层数还是局部递归深度？截断时节点是否仍生成？

**自动选择**：绝对层数（从 schema 根节点计算）；截断处生成占位节点 `kind: 'api-schema'`、`label: '{SchemaName} [ref-truncated]'`。

**理由**：绝对层数计算无歧义，实现简单；占位节点保留图谱可达性，比静默跳过更利于用户调试循环引用问题。已更新边界情况章节。

---

#### AUTO-CLARIFIED-3：Markdown LLM 并发超时配置

**问题**：并发上限 5 已定，但单次 LLM 调用超时时限未指定；SC-003 要求 100 个文件 30 秒内完成，需要明确超时值。

**自动选择**：单次 LLM 调用超时上限 8 秒。SC-003 的 30 秒目标适用于缓存命中率 > 80% 的场景（首次全量提取不设硬性上限）。

**理由**：8 秒符合 Anthropic API p95 响应分布，兼顾 SC-003 可达性与 API 限速保护。已更新 FR-016 和 SC-003。

---

#### AUTO-CLARIFIED-4：新增 kind 节点在 Louvain 社区检测中的边权重

**问题**：`api`、`api-schema`、`event`、`diagram` 节点的边权重是否与 `module` 节点相同？`INFERRED` 置信度是否影响图算法？

**自动选择**：统一使用 `weight: 1.0`，`INFERRED` 置信度仅用于数据溯源，不参与图算法计算。

**理由**：差异化权重需要调参验证，当前无基准数据支撑；统一权重保证向后兼容，满足用户故事 5 最低验收要求。已新增 FR-021。

---

#### RESOLVED-5：Vision API 模型选择

**问题**：FR-007 使用 Claude Vision 提取图像内容，未指定具体模型。

**用户决策**：选项 B — 默认 `claude-sonnet-4-5`，通过 `SPECTRA_VISION_MODEL` 环境变量可覆盖。

**理由**：用户优先考虑提取精度而非成本，Sonnet 在复杂架构图和手绘图场景下表现更优。已更新 FR-007。
