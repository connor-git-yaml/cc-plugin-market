# 技术调研报告: 可读性与维护性热点重构

**特性分支**: `081-maintainability-hotspot-refactors`  
**调研日期**: 2026-04-05  
**调研模式**: codebase-scan  
**在线调研**: 跳过，`project-context` 标记 `online_required=false`，且本特性只涉及仓内热点重构

## 1. 调研目标

**核心问题**:
- 四个蓝图点名热点当前的复杂度具体集中在哪些职责上
- 078 共享层现在能承接哪些职责，哪些复杂度仍留在入口脚本中
- 如何在不改变 CLI 合同和产物结构的前提下，把热点入口文件做薄
- `init-project.sh` 在不迁出 Bash 的情况下，如何降低可读性负担

**蓝图约束（076 / 6.5）**:
- 只做小范围结构重构
- 优先热点: `scorecards`, `quality-reports`, `workflow-registry`, `init-project.sh`
- 重构方向: 缩短单文件长度、降低内联 helper 数量、明确参数解析 / 主流程 / 共享能力 / 渲染器分层

## 2. 代码面扫描结果

### 2.1 热点基线

| 文件 | 当前行数 | 主要复杂度来源 |
|------|---------|----------------|
| `plugins/spec-driver/scripts/generate-product-scorecards.mjs` | 868 | 规则加载、上下文装配、规则求值、统计汇总、Markdown 渲染、entity/catalog 回写 |
| `plugins/spec-driver/scripts/generate-product-quality-reports.mjs` | 599 | 文档引用收集、required-doc/status 计算、冲突检测、Markdown 渲染、entity/catalog 回写 |
| `plugins/spec-driver/scripts/generate-workflow-registry.mjs` | 311 | workflow 定义加载、override 应用、golden path 读取、Markdown 渲染 |
| `plugins/spec-driver/scripts/init-project.sh` | 392 | 参数解析、目录初始化、模板/scorecard 同步、project-context 探测、技能检测、JSON/text 输出 |

### 2.2 078 共享层现状

081 可以直接复用：

- `plugins/spec-driver/scripts/lib/simple-yaml.mjs`
- `plugins/spec-driver/scripts/lib/script-report-io.mjs`
- `plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs`
- `plugins/spec-driver/scripts/lib/script-diagnostics.mjs`

这意味着 081 不需要再花范围重做 YAML / IO / patch / diagnostics，只需要把剩余的大块领域逻辑从入口文件移出去。

### 2.3 热点分层机会

#### `generate-product-scorecards.mjs`

适合分层：
- `parseArgs`
- `generateProductScorecards` orchestration
- `loadScorecardRules`
- `buildProductContext` / `collectFeatureInputs`
- `evaluateRule` 及 evaluator helpers
- `buildScorecardReport` / `renderScorecardMarkdown`

当前问题：
- 入口文件同时承载 rule engine、repo probe、file stat heuristics 和 Markdown rendering
- 任何 rule 变更都需要在 800+ 行文件中跳读

#### `generate-product-quality-reports.mjs`

适合分层：
- `collectDocumentRefs`
- `detectProductConflicts`
- `summarizeDocsQualityStats`
- `buildQualityReport`
- `renderQualityMarkdown`

当前问题：
- 数据装配和呈现紧耦合
- required-doc / warning / conflict 规则难以做细粒度测试

#### `generate-workflow-registry.mjs`

适合分层：
- `readWorkflowDefinitions`
- `readWorkflowOverrides`
- `applyWorkflowOverride`
- `readGoldenPaths`
- `buildWorkflowRegistryIndex`
- `renderWorkflowIndexMarkdown`

当前问题：
- 300 行不算超长，但仍把“配置读取 + merge + 呈现”揉在入口文件里
- 这类脚本如果继续加字段，很容易再次长成第二个 `scorecards`

#### `init-project.sh`

适合分层：
- `parse_args`
- `init_specify_dir`
- `sync_specify_templates`
- `sync_scorecard_defaults`
- `ensure_project_context`
- `check_constitution` / `check_config` / `check_gate_policy`
- `detect_spec_driver_skills`
- `render_json_output` / `render_text_output`
- `main`

当前问题：
- 已经有不少函数，但“状态探测”和“输出渲染”的边界还不够清晰
- 全局变量较多，流程主线仍需要来回跳读

## 3. 架构方案对比

| 维度 | 方案 A: 原文件内继续局部整理 | 方案 B: 薄入口 + `scripts/lib` 热点 core modules | 方案 C: 热点脚本整体迁到 `src/**` TypeScript |
|------|-----------------------------|--------------------------------------------------|----------------------------------------------|
| 改动风险 | 低 | 中 | 高 |
| 维护收益 | 中 | 高 | 高 |
| 与蓝图 081 对齐度 | 中 | 高 | 低 |
| 对外合同稳定性 | 高 | 高 | 中 |
| 对 078 复用度 | 低 | 高 | 中 |
| 适合 081 | 勉强 | 是 | 否 |

### 推荐方案

**推荐**: 方案 B，保持热点入口文件存在，但把 builder / evaluator / renderer / formatter 下沉到 `plugins/spec-driver/scripts/lib/`。

**理由**:
1. 符合蓝图“小范围重构而不是大改”的边界。
2. 能直接利用 078 新增的 shared primitives。
3. 不要求这些脚本先 build 再运行，也不会破坏 Codex / Claude 当前执行链路。

## 4. 预期模块切分

### 4.1 Scorecards

候选模块：
- `plugins/spec-driver/scripts/lib/product-scorecard-core.mjs`
- 必要时再拆 `product-scorecard-renderer.mjs`

职责：
- ruleset loading / normalization
- product context assembly
- scorecard report assembly
- markdown rendering

### 4.2 Quality Reports

候选模块：
- `plugins/spec-driver/scripts/lib/product-quality-core.mjs`

职责：
- document refs / provenance assembly
- stats / status / conflict computation
- report assembly
- markdown rendering

### 4.3 Workflow Registry

候选模块：
- `plugins/spec-driver/scripts/lib/workflow-registry-core.mjs`

职责：
- workflow definitions / overrides / golden paths loading
- registry JSON assembly
- markdown rendering

### 4.4 Init Project

候选方案：
- 保持 `init-project.sh`
- 新增轻量 shell helper（例如 `scripts/lib/init-project-output.sh`）或在同文件内进一步抽清输出函数

注意：
- 081 的目标是把阶段边界讲清楚，不强求 shell helper 数量最大化

## 5. 测试面建议

优先保留并复用：
- `tests/integration/spec-driver-workflow-registry.test.ts`
- `tests/integration/spec-driver-product-quality-reports.test.ts`
- `tests/integration/spec-driver-product-scorecards.test.ts`
- `tests/integration/spec-driver-init-project.test.ts`
- `tests/unit/init-command.test.ts`
- `tests/integration/init-e2e.test.ts`

081 需要新增：
- 针对 `workflow-registry-core` 的 unit tests
- 针对 `product-quality-core` 的 unit tests
- 针对 `product-scorecard-core` 或 renderer/evaluator 的 unit tests
- 如 `init-project.sh` 抽出可测试 shell helper，则补对应测试；若仍保留 shell 内函数，则至少通过现有 integration tests 验证边界保持稳定

## 6. 技术风险

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 入口文件变薄，但 shared module 边界切错，导致逻辑跨文件来回跳 | 中 | 中 | 优先按 builder/evaluator/renderer 语义切，不按纯行数切 |
| 2 | 重构 `scorecards` 时不小心改变 rule evaluation 或 summary 文案 | 中 | 高 | 先保留现有集成测试，再增加针对 report assembly 的 targeted tests |
| 3 | `init-project.sh` 调整阶段边界时影响 JSON 输出字段或 dual/legacy/yaml 判定 | 中 | 高 | 把 `spec-driver-init-project.test.ts` 和 `init-command` / `init-e2e` 一起作为回归底线 |
| 4 | 为了“更可读”而重复 078 共享 helper，导致 shared layer 再次分叉 | 低 | 高 | 明确规定 081 只在热点上抽领域 core module，不复制 YAML / IO / diagnostics primitives |

## 7. 结论与建议

081 的正确范围是：用 078 打好的 shared layer 作为地基，把当前最膨胀的四个热点入口重构成更清晰的 orchestration 壳和少量领域 core modules。这样既能降低单文件维护成本，也不会把本轮工作扩大成目录迁移或技术栈迁移。
