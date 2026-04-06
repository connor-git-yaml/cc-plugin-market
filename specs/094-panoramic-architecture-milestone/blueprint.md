# M-094: Panoramic 架构整洁化与产品能力对齐

## 里程碑概述

基于三份调研报告（panoramic 架构健康度、reverse-spec CLI/batch/MCP、panoramic-spec-driver 集成）的发现，本里程碑围绕四个优先级轴设计 7 个 Feature：架构整洁、代码整洁、产品能力、用户体验。总预估工期 18-22 人天。

---

## Feature 清单

### F-094-01: Panoramic God File 拆分 — api-surface-generator 模块化

**问题描述**
`api-surface-generator.ts` 达 2,168 行，是项目中最大的单体文件。文件内部按注释分隔符清晰分为 8 个逻辑段（类型定义、通用工具函数、OpenAPI Schema 提取器、FastAPI 提取器、tsoa 框架自省、Express AST 提取器、去重/最终化工具、Generator 类），但全部堆在一个文件中，违反单一职责原则，阻碍独立测试和按需维护。

**方案概述**
将 `api-surface-generator.ts` 拆分为以下子模块结构：
```
src/panoramic/api-surface/
  types.ts              — ApiSource, ApiParameter, ApiResponse, ApiEndpoint, ApiSurfaceInput, ApiSurfaceOutput 等所有类型定义（~80行）
  utils.ts              — toPosixPath, uniqueStrings, collectProjectFiles, detectProjectName 等通用工具函数（~280行）
  openapi-extractor.ts  — OpenAPI/Swagger Schema 解析逻辑（extractFromSchema 及辅助函数，~300行）
  fastapi-extractor.ts  — FastAPI 路由/装饰器分析（~350行）
  framework-introspection.ts — tsoa/NestJS 框架自省逻辑（~200行）
  express-extractor.ts  — Express AST 分析（parseExpressRouteChain, analyzeExpressFile 等，~400行）
  endpoint-utils.ts     — dedupeEndpoints, finalizeEndpoint, dedupeParameters 等端点处理工具（~150行）
  index.ts              — 仅导出 ApiSurfaceGenerator 类（~110行）+ 从子模块的 re-export
```
原文件的 `ApiSurfaceGenerator` class（2063-2168行，约106行）保留在 `index.ts`，其 `extract()` 方法按策略模式依次调用三个 extractor 模块。

现有测试文件 `tests/panoramic/api-surface-generator.test.ts` 无需拆分——仅需更新导入路径。同时为各 extractor 补充独立单元测试。

**预估工期**: 3 人天

**依赖关系**: 无前置依赖（可最先启动）

**验收标准**:
- [ ] `api-surface-generator.ts` 单文件不再存在；替换为 `src/panoramic/api-surface/` 目录，每个文件不超过 400 行
- [ ] `src/panoramic/index.ts` 中原有的 `ApiSurfaceGenerator` 及关联类型导出路径不变，外部消费者零改动
- [ ] 原有测试全部通过（`vitest run tests/panoramic/api-surface-generator.test.ts`）
- [ ] 各 extractor 子模块拥有独立测试文件
- [ ] `npm run build` 无错误

---

### F-094-02: Panoramic 目录结构分层重组

**问题描述**
`src/panoramic/` 根目录堆叠 45 个 `.ts` 文件，缺乏 models/builders/exporters 分层。数据模型文件（`*-model.ts`）、构建器文件（`*-builder.ts`）、导出器文件（`*-exporter*.ts`）与 Generator 实现混在一起，新开发者难以建立心智模型。

**方案概述**
引入三级子目录：
```
src/panoramic/
  models/               — 所有纯数据模型/类型文件
    architecture-ir-model.ts
    architecture-overview-model.ts
    component-view-model.ts
    docs-quality-model.ts
    pattern-hints-model.ts
    runtime-topology-model.ts
    docs-bundle-types.ts
  builders/              — 所有构建器（不含 Generator 接口实现）
    architecture-ir-builder.ts
    component-view-builder.ts
    dynamic-scenarios-builder.ts
    doc-graph-builder.ts
    architecture-ir-mermaid-adapter.ts
  exporters/             — IR 导出器
    architecture-ir-exporters.ts
  generators/            — 所有 DocumentGenerator 实现类
    （保持现有 Generator 文件名不变）
  pipelines/             — 独立函数式管道（非 Generator 接口）
    adr-decision-pipeline.ts
    product-ux-docs.ts
    architecture-narrative.ts
    docs-quality-evaluator.ts
    narrative-provenance-adapter.ts
  utils/                 — 已有，保持不变
  parsers/               — 已有，保持不变
  api-surface/           — F-094-01 产出
  index.ts               — 桶文件（更新导入路径，导出不变）
  interfaces.ts          — 核心接口（不移动）
  generator-registry.ts  — 注册中心（不移动）
  parser-registry.ts     — 注册中心（不移动）
  abstract-registry.ts   — 基类（不移动）
  project-context.ts     — 上下文构建（不移动）
```
迁移策略：使用 barrel re-export 保持 `index.ts` 的公开 API 完全不变。所有内部 `import` 路径通过 IDE 批量重构更新。

**预估工期**: 2 人天

**依赖关系**: 在 F-094-01 之后执行（先拆 God File，再整体重组，避免冲突）

**验收标准**:
- [ ] `src/panoramic/` 根目录 `.ts` 文件不超过 10 个（interfaces, index, abstract-registry, generator-registry, parser-registry, project-context, stored-module-specs, output-filenames, cross-reference-index, batch-project-docs）
- [ ] `src/panoramic/index.ts` 导出集合与重组前完全一致（diff 比较 `export` 行）
- [ ] 全量测试通过（`vitest run`）
- [ ] `npm run build` 无错误
- [ ] 不含循环依赖（可用 `madge --circular` 验证）

---

### F-094-03: LLM/Auth 依赖收敛与 Generator 接口统一

**问题描述**
两个问题合并处理：(1) `pattern-hints-generator.ts` 和 `utils/llm-enricher.ts` 各自独立导入 `detectAuth` + `callLLMviaCli` + `callLLMviaCodex` + `resolveReverseSpecModel` 四件套，形成重复耦合。(2) 6 个模块（architecture-narrative, adr-decision-pipeline, product-ux-docs, docs-quality-evaluator, component-view-builder, dynamic-scenarios-builder）暴露独立函数而非 Generator 类，与 `DocumentGenerator` 接口不统一，无法被 `GeneratorRegistry` 自动发现和管理。

**方案概述**

**Part A — LLM 调用门面**:
在 `src/panoramic/utils/` 下新增 `llm-facade.ts`，封装统一的 LLM 调用入口：
```typescript
export async function callLLM(options: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
}): Promise<string | null>
```
内部封装 `detectAuth` → 路由到 `callLLMviaCli` / `callLLMviaCodex` / 直接 SDK 调用的完整逻辑。`pattern-hints-generator.ts` 和 `llm-enricher.ts` 均改为 `import { callLLM } from './utils/llm-facade.js'`，消除 4 件套重复导入。

**Part B — Generator 接口适配**:
为 6 个独立函数模块创建轻量 Adapter 类，使其实现 `DocumentGenerator` 接口。以 `adr-decision-pipeline.ts` 为例：
```typescript
export class AdrDecisionPipelineGenerator
  implements DocumentGenerator<AdrPipelineInput, AdrIndexOutput> {
  readonly id = 'adr-decision-pipeline';
  // isApplicable, extract, generate, render 委托到现有函数
}
```
现有的 `generateBatchAdrDocs()` 等导出函数保留为便利快捷方式，Generator 类内部调用它们。在 `generator-registry.ts` 的 `bootstrapGenerators()` 中注册新增的 6 个 Generator。

**预估工期**: 3 人天

**依赖关系**: 在 F-094-02 之后（需要目录结构就绪后放置新文件）

**验收标准**:
- [ ] `src/panoramic/` 中不再有直接 import `auth-detector.js` / `cli-proxy.js` / `codex-proxy.js` 的文件（仅 `llm-facade.ts` 一处导入）
- [ ] `GeneratorRegistry.getInstance().list()` 返回的 Generator 数量从 13 增至 19（新增 6 个 Adapter）
- [ ] 6 个新 Adapter 均有 `isApplicable` 测试用例
- [ ] 原有 `generateBatchAdrDocs` / `generateProductUxDocs` / `evaluateDocsQuality` / `buildArchitectureNarrative` / `buildComponentView` / `buildDynamicScenarios` 导出函数继续可用
- [ ] `pattern-hints-generator.test.ts` 和 `llm-enricher` 相关测试通过

---

### F-094-04: index.ts 导出收缩与公共 API 治理

**问题描述**
`src/panoramic/index.ts` 过度导出 100+ 类型和函数，包括大量内部实现细节类型（如 `RuntimeConfigFormat`、`ComponentEvidenceSourceType`）。外部消费者无法区分公共 API 与内部类型，且桶文件膨胀影响编译和 IDE 性能。

**方案概述**
1. 审计所有导出项，通过 `grep -r` 扫描 `src/` 目录（排除 `src/panoramic/`）中的实际外部引用，确定真正的公共 API 集合。
2. 将 `index.ts` 拆分为两层：
   - `index.ts`（公共 API）：仅导出 Generator 类、Registry、核心接口、`buildProjectContext`、桶级高层类型（Input/Output 类型）。预计 40-50 个导出项。
   - `internal.ts`（内部 API）：导出模型细粒度类型、工具函数、常量。供 `src/panoramic/` 内部模块和测试使用。
3. 所有 `src/panoramic/` 外部的导入路径检查：如果仅用到公共 API，无需改动；如果用到内部类型，改为 `from '../panoramic/internal.js'`。
4. 在 `internal.ts` 头部添加 `@internal` JSDoc 标注。

**预估工期**: 1.5 人天

**依赖关系**: 在 F-094-02 之后（目录重组后路径稳定）

**验收标准**:
- [ ] `src/panoramic/index.ts` 的 `export` 行数不超过 60 行
- [ ] `src/panoramic/internal.ts` 存在并包含 `@internal` 标注
- [ ] 全量 `vitest run` 通过
- [ ] `npm run build` 无错误
- [ ] 不存在从 `src/panoramic/` 外部直接 import 非 `index.ts` / `internal.ts` 的 panoramic 子模块的情况（可用 grep 验证）

---

### F-094-05: MCP/CLI 参数对称与项目级配置文件

**问题描述**
三个不对称问题：(1) MCP batch tool 缺少 `incremental` 参数，CLI 有但 MCP 没有。(2) CLI batch 缺少 `--languages` 过滤参数，MCP 有但 CLI 没有。(3) 无项目级配置文件 `.reverse-spec.yaml`，每次都需手动传参。

**方案概述**

**Part A — MCP 补齐 incremental**:
在 `src/mcp/server.ts` 的 batch tool schema 中添加：
```typescript
incremental: z.boolean().default(false).describe('仅重生成受影响的 spec'),
```
并将其传入 `runBatch()` 调用。

**Part B — CLI 补齐 --languages**:
在 `src/cli/utils/parse-args.ts` 中添加 `--languages` 解析（逗号分隔字符串 → 数组），在 `src/cli/commands/batch.ts` 中传入 `languages` 选项，更新帮助文本。

**Part C — 项目级配置文件**:
新增 `src/config/project-config.ts`，支持从项目根目录读取 `.reverse-spec.yaml` 或 `.reverse-spec.json`：
```yaml
# .reverse-spec.yaml
outputDir: specs
languages: [typescript, python]
incremental: true
force: false
batch:
  maxRetries: 3
  grouping:
    strategy: directory
panoramic:
  generators:
    disabled: [mock-readme]
```
配置文件优先级：CLI 显式参数 > 配置文件 > 默认值。配置文件为可选，不存在时静默使用默认值。

**预估工期**: 2.5 人天

**依赖关系**: 无前置依赖（可与 Wave 1 并行）

**验收标准**:
- [ ] MCP batch tool 接受 `incremental: true` 参数并生效
- [ ] CLI `reverse-spec batch --languages typescript,python` 解析正确并生效
- [ ] CLI 帮助文本包含 `--languages` 说明
- [ ] `.reverse-spec.yaml` 存在时自动加载并应用配置
- [ ] 配置文件不存在时不报错，使用默认值
- [ ] 添加配置文件解析的单元测试和集成测试

---

### F-094-06: 进度报告改善与错误信息完善

**问题描述**
两个用户体验问题：(1) 进度条 (`process.stdout.write`) 与模块日志 (`console.log`) 交叉输出，终端显示混乱。(2) panoramic 后处理多处 empty `catch {}` 吞掉错误，用户无法得知降级原因。调研发现 `src/panoramic/` 目录下有 50+ 处 empty catch 块。

**方案概述**

**Part A — 进度报告分离**:
重构 `src/batch/progress-reporter.ts`，使进度更新与日志分离：
1. 引入 `ProgressMode` 枚举：`tty`（交互终端）/ `pipe`（非交互/CI）。
2. `tty` 模式：进度条使用 `\r` + ANSI 控制码固定在最后一行，模块日志输出到进度条上方。
3. `pipe` 模式：禁用进度条，仅输出 `[N/Total] module-path ... status` 格式的行日志。
4. 在 `src/cli/commands/batch.ts` 中移除手工 `process.stdout.write` 进度条，改用 reporter 的 `onProgress` 回调。

**Part B — 错误信息完善**:
对 `src/panoramic/` 下的 50+ empty catch 块进行分类治理：
- **应当静默降级的**（如 LLM 不可用、可选文件不存在）：保留 catch 但添加 `debug` 级日志（使用统一 logger）。
- **应当上报警告的**（如文件解析失败但非致命）：catch 块中调用 `warnings.push(...)` 或 logger.warn。
- **不应吞掉的**（如关键配置解析失败）：改为 `catch (err) { throw new Error(..., { cause: err }) }` 或上报。

引入 `src/panoramic/utils/logger.ts` 作为轻量级分级日志工具（debug/info/warn/error），默认 level 为 `warn`，可通过环境变量 `REVERSE_SPEC_LOG_LEVEL=debug` 调整。

**预估工期**: 3 人天

**依赖关系**: 在 F-094-02 之后（logger 放在重组后的 utils/ 下）

**验收标准**:
- [ ] `tty` 模式下批量运行时，进度条和模块日志不交叉
- [ ] `pipe` 模式下（如 `| cat`）无 ANSI 控制码
- [ ] `src/panoramic/` 中不再存在完全空的 `catch {}` 块（可用 `grep -n "catch\s*{" | xargs` 验证）
- [ ] 设置 `REVERSE_SPEC_LOG_LEVEL=debug` 后可看到降级原因
- [ ] 原有降级行为不变（LLM 不可用时仍静默降级，不终止流程）
- [ ] 新增 logger 单元测试

---

### F-094-07: Panoramic → Spec-Driver CLI 桥接

**问题描述**
spec-driver 的 refactor-plan agent 手动使用 grep 实现了跨包分析能力（依赖检测、循环引用识别），而 panoramic 的 `CrossPackageAnalyzer` 已拥有 Tarjan SCC 循环检测、拓扑排序、Architecture IR 等远超 grep 的结构化分析能力。两条产品链路完全独立，零代码共享。

**方案概述**
以最轻量的 CLI 桥接方式连接两套系统：

1. **新增 CLI 子命令 `panoramic`**:
   在 `src/cli/commands/panoramic.ts` 新增子命令：
   ```
   reverse-spec panoramic cross-package --json [--project-root <dir>]
   reverse-spec panoramic architecture-ir --json [--project-root <dir>]
   reverse-spec panoramic overview --json [--project-root <dir>]
   ```
   输出 JSON 到 stdout，供 spec-driver agent 通过 `spawnSync('reverse-spec', ['panoramic', 'cross-package', '--json'])` 消费。

2. **新增 MCP panoramic tool**:
   在 `src/mcp/server.ts` 注册 `panoramic-query` tool：
   ```typescript
   server.tool('panoramic-query', '查询 panoramic 结构化分析结果', {
     analyzer: z.enum(['cross-package', 'architecture-ir', 'overview']),
     projectRoot: z.string().optional(),
   }, async ({ analyzer, projectRoot }) => { ... });
   ```

3. **输出格式稳定性**:
   为桥接输出定义 JSON Schema（基于现有 `CrossPackageOutput` / `ArchitectureIROutput` 类型），作为 contract 存入 `contracts/panoramic-bridge.md`。

**预估工期**: 3 人天

**依赖关系**: 在 F-094-02 和 F-094-03 之后（需要重组后的目录结构和统一的 Generator 接口）

**验收标准**:
- [ ] `reverse-spec panoramic cross-package --json` 输出有效 JSON 且可被 `jq` 解析
- [ ] MCP `panoramic-query` tool 注册成功并返回结构化结果
- [ ] JSON 输出包含 `cycles`、`topologyLevels`、`stats` 字段（与 `CrossPackageOutput` 类型一致）
- [ ] `contracts/panoramic-bridge.md` 文档存在且描述了 JSON Schema
- [ ] CLI 帮助文本包含 `panoramic` 子命令说明
- [ ] 新增集成测试验证 CLI JSON 输出格式

---

## 实施顺序（Wave 分组）

### Wave 1（并行启动）— 基础结构 + 独立改进

| 序号 | Feature | 预估 | 关键路径 |
|------|---------|------|----------|
| 1a | F-094-01: God File 拆分 | 3d | 是（后续依赖） |
| 1b | F-094-05: MCP/CLI 参数对称 + 配置文件 | 2.5d | 否（独立） |

**Wave 1 里程碑**: api-surface 不再是单文件；MCP/CLI 参数一致；项目级配置可用。

### Wave 2（Wave 1 完成后）— 全局重组

| 序号 | Feature | 预估 | 关键路径 |
|------|---------|------|----------|
| 2a | F-094-02: 目录结构分层重组 | 2d | 是（后续依赖） |

**Wave 2 里程碑**: panoramic 根目录从 45 文件减至 ≤10 文件；models/builders/exporters/generators/pipelines 分层就位。

### Wave 3（Wave 2 完成后）— 代码质量

| 序号 | Feature | 预估 | 关键路径 |
|------|---------|------|----------|
| 3a | F-094-03: LLM/Auth 收敛 + Generator 统一 | 3d | 否 |
| 3b | F-094-04: index.ts 导出收缩 | 1.5d | 否 |
| 3c | F-094-06: 进度报告 + 错误信息 | 3d | 否 |

**Wave 3 里程碑**: LLM 调用单一入口；Generator 数量从 13 到 19；公共 API 边界明确；empty catch 归零。

### Wave 4（Wave 3 完成后）— 产品桥接

| 序号 | Feature | 预估 | 关键路径 |
|------|---------|------|----------|
| 4a | F-094-07: Panoramic → Spec-Driver 桥接 | 3d | 否 |

**Wave 4 里程碑**: CLI/MCP 双通道桥接就绪；spec-driver 可消费 panoramic 结构化输出。

---

## 成功标准表

| 维度 | 指标 | 当前值 | M-094 目标值 |
|------|------|--------|--------------|
| **架构整洁** | panoramic 根目录文件数 | 45 | ≤ 10 |
| **架构整洁** | 最大单文件行数 | 2,168 (api-surface) | ≤ 400 |
| **架构整洁** | 超千行文件数 | 4 | 0（拆分或重组后每个文件 ≤ 800 行） |
| **代码整洁** | auth 直接导入文件数 | 2 (pattern-hints, llm-enricher) | 1 (llm-facade) |
| **代码整洁** | DocumentGenerator 实现数 | 13 | 19（+6 Adapter） |
| **代码整洁** | index.ts 导出项数 | 100+ | ≤ 60（公共 API） |
| **代码整洁** | empty catch 块数 | 50+ | 0（全部分类治理） |
| **产品能力** | MCP/CLI 参数对称缺失数 | 2 (incremental, languages) | 0 |
| **产品能力** | panoramic-spec-driver 共享能力 | 0 | 3 (cross-package, ir, overview) |
| **用户体验** | 项目级配置文件支持 | 无 | .reverse-spec.yaml |
| **用户体验** | 进度/日志交叉 | 存在 | 消除 |
| **质量** | 全量测试通过率 | 100% | 100%（保持） |
| **质量** | 循环依赖 | 0 | 0（保持） |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| F-094-02 目录重组导致大量 import 路径变更，引入回归 | 中 | 高 | 使用 TypeScript 编译器和 IDE 自动重构；每步变更后运行全量测试 |
| F-094-03 Generator Adapter 化后改变了运行时行为 | 低 | 中 | Adapter 内部直接委托原有函数，不改变逻辑；snapshot 测试保护输出一致性 |
| F-094-05 配置文件解析引入新依赖 | 低 | 低 | 复用已有 `yaml` 依赖（项目中已使用 YAML 解析）；JSON 格式用 `JSON.parse` |
| F-094-07 桥接 JSON 输出格式不稳定 | 中 | 中 | 定义 contract 文档和 JSON Schema；桥接输出添加 version 字段 |

---

## 不包含在本里程碑的事项（Backlog）

以下事项在调研中发现但推迟到后续里程碑：
- **多语言依赖图补齐**（Python/Go/Java 缺依赖图）：需独立 Feature，工期较大
- **Rust 语言支持**：需全新 AST 适配器
- **pattern-knowledge-base 单元测试**：可作为 F-094-03 的 follow-up
- **panoramic 提升为共享基础设施（独立包）**：需等桥接验证后评估
