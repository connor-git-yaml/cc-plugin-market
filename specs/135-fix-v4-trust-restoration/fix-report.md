# 问题修复报告 — Feature 135：Spectra v4.0.1 信任修复

## 问题描述

v4.0.0 在 micrograd + nanoGPT 双数据点实测中发现 4 类 P0/P2 bug，严重影响用户对 v4 的信任。本 fix 不做架构改动，仅做临时治理与文档纠正，为 v4.1（Feature 136）的真正重构留出接口。

---

## Bug 1：ADR Pipeline Hallucination

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 nanoGPT ADR 谈"JSON 流式协议/MCP/hook"？ | adr-0001 内容与 nanoGPT 代码完全无关 |
| Why 2 | 这段内容从哪来？ | `src/panoramic/pipelines/adr-decision-pipeline.ts:376` 存在硬编码的 fallback ADR，title="使用 JSON 流式控制协议连接宿主与运行时"，内容谈的是 Spectra 自身架构 |
| Why 3 | 为何这个 fallback 会触发？ | `buildGenericCoreSeparationCandidate(corpus)` 对**所有项目**都会返回一个 fallback 候选（L314），当实际证据不足时直接塞入产物 |
| Why 4 | 为何 fallback 内容是 Spectra 自己的架构？ | 函数内 `control_request`、`streaming`、`stdin/stdout` 等关键词（L361）是开发期写死的示例，从未被参数化或基于目标项目动态生成 |
| Why 5 | 为何测试未捕获？ | ADR pipeline 无跨项目隔离测试；只有 unit test 验证"能产出 ADR"，未断言"产出内容是否与目标项目相关" |

**Root Cause**（[ROOT CAUSE REACHED at Why 4]）：`buildGenericCoreSeparationCandidate` 函数内置了 Spectra 自身通信协议架构作为硬编码 fallback 候选，对任何项目都无条件触发，且无相关性校验。

**Root Cause Chain**：ADR 谈 MCP/hook → fallback 触发 → fallback 内容是 Spectra 自身架构的硬编码示例 → 函数实现时用示例当 fallback，从未参数化 → 无跨项目隔离测试

### 影响范围

| 文件 | 位置 | 模式 | 分类 |
|------|------|------|------|
| `src/panoramic/pipelines/adr-decision-pipeline.ts` | L314 `buildGenericCoreSeparationCandidate` | 无条件 fallback 候选 | **[同源] 主修复点** |
| `src/panoramic/pipelines/adr-decision-pipeline.ts` | L361-392 fallback 内容 | 硬编码 Spectra 架构 | **[同源] 需清除** |
| `src/panoramic/batch-project-docs.ts` | L338 `generateBatchAdrDocs` 调用 | 调用方默认开启 ADR | **[同源] 添加 enableAdr guard** |

### 修复策略

**方案 A（推荐，v4.0.1 hotfix）**：
1. 在 `batch-project-docs.ts` 的 `generateBatchAdrDocs` 调用前加 guard：`if (!options.enableAdr) return;`
2. `BatchProjectDocsOptions` 增加 `enableAdr?: boolean`（默认 false）
3. CLI `src/cli/commands/batch.ts` 增加 `--enable-adr` flag 解析（默认 false）
4. batch 末尾打印 hint："ADR pipeline 已在 v4.0.1 临时禁用，将在 v4.1 evidence-binding 重构后恢复（用 --enable-adr 显式开启）"
5. **不修改** `buildGenericCoreSeparationCandidate` 内部逻辑（留 Feature 136 做 evidence-binding 重构）

**方案 B（弃用）**：直接删除 fallback 候选 → 会让 ADR pipeline 在无证据时产出 0 条 ADR，但原有调用路径仍默认运行，对用户无感知。不如方案 A 透明。

### Spec 影响

无需更新现有 spec（`130-debt-intelligence`、`131-anchor-hyperedges-schema`）。

---

## Bug 2：`--hyperedges` Flag 完全无效

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 graph.json 无 hyperedges？ | batch summary 的 skippedSources 显示 "extraction: 未提供 extractionResults 或为空数组" |
| Why 2 | 为何 extractionResults 为空？ | `src/batch/batch-orchestrator.ts:957-975`：extractionResults 只在 `options.includeDocs || options.includeImages` 时才填充；即使传了 `--hyperedges`，若不传 `--include-docs`，extractionResults = undefined |
| Why 3 | hyperedge 集成是否依赖 extractionResults？ | 间接依赖：`buildKnowledgeGraph` 将 extractionResults 注入图，`semanticIntegrationAllowed = effectiveMode === 'full' && !budgetSkipEnrichmentAll`（L1000）；但 hyperedge 真正的输入是 `projectDocs`（设计文档路径），与 extractionResults 无关 |
| Why 4 | `projectDocs` 在实测中是什么？ | 新项目首次 batch 时，`projectDocsResult?.projectDocs` 为空数组 → `designDocAbsPaths.length === 0` → anchor 步骤无输入 → hyperedge 步骤无法运行 |
| Why 5 | 为何这个空值路径没有 WARNING？ | 集成块在 `designDocAbsPaths.length === 0` 时静默跳过，只有 `logger.info` 而非 `logger.warn`；用户侧无任何可见信号 |

**Root Cause**（[ROOT CAUSE REACHED at Why 5]）：hyperedge 集成的前置条件（`designDocAbsPaths.length > 0`）在新项目首次 batch 时不满足，但代码静默跳过，未向用户报告。用户以为 `--hyperedges` 已启用实际上什么都没发生。

**Root Cause Chain**：graph.json 无 hyperedges → extractionResults/projectDocs 为空 → 前置条件不满足 → 静默跳过 → 无 WARNING → 用户无感知

### 影响范围

| 文件 | 位置 | 模式 | 分类 |
|------|------|------|------|
| `src/batch/batch-orchestrator.ts` | L1000-1010 semanticIntegration skip | 静默跳过无 WARNING | **[同源] 主修复点** |
| `src/batch/batch-orchestrator.ts` | L1034-1047 hyperedge opt-in check | 静默跳过 | **[同源] 需加 WARNING** |
| `src/panoramic/builders/doc-graph-builder.ts` | L697-719 hyperedge enabled check | 静默返回空 | **[类似] 评估是否需要 log** |

### 修复策略

**方案 A（推荐，v4.0.1 hotfix）**：
1. 在 `batch-orchestrator.ts` semanticIntegration skip 路径改 `logger.info` → `logger.warn`，并在 stderr 打印用户可见 WARNING
2. 在 hyperedge opt-in check 之后，检查：若 `hyperedgesOptIn === true` 但 `designDocAbsPaths.length === 0`，打印 WARNING 说明原因和修复建议（运行一次 full batch 先生成 project docs，再传 `--hyperedges`）
3. batch summary 末尾新增"hyperedge 状态"行：`hyperedges: 0（WARNING: 前置条件未满足）` or `hyperedges: 3`
4. **不修改** 实际 hyperedge 提取数据流（留 Feature 136）

---

## Bug 3：`generatedBy: spectra v3.0` 版本字符串回归

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 spec frontmatter 显示 v3.0？ | 3 处硬编码：`src/spec-store/spec-store.ts:80`、`src/generator/index-generator.ts:139`、`src/generator/frontmatter.ts:60` |
| Why 2 | 为何没有从 package.json 读取？ | 从未建立过 source-of-truth；代码在 v3.x 时期直接写死字符串，v4 bump 时未同步更新 |
| Why 3 | 为何 v4 发布流程没发现？ | `npm run release:check` 未涵盖 frontmatter 中的版本字符串校验 |

**Root Cause**：三处 `'spectra v3.0'` 字面量从未从 `package.json.version` 动态读取，版本 bump 时未同步。

### 影响范围（同源，需全部修复）

| 文件 | 行 | 修复动作 |
|------|-----|---------|
| `src/spec-store/spec-store.ts` | 80 | 从 package.json 读取版本 |
| `src/generator/index-generator.ts` | 139 | 同上 |
| `src/generator/frontmatter.ts` | 60 | 同上；此处最合适建立 source-of-truth 辅助函数 |

### 修复策略

1. 在 `src/generator/frontmatter.ts` 新增辅助函数 `getSpectraVersionString(): string`，通过 `createRequire(import.meta.url)` 读取 `package.json.version`，返回 `\`spectra v${version}\``
2. 三处硬编码统一改为调用 `getSpectraVersionString()`
3. 单元测试：断言 frontmatter 中 `generatedBy` 字段 = `spectra v${pkg.version}`
4. Release check：在 `scripts/check-plugin-sync.sh` 或 `npm run release:check` 中加一行 `grep -r "spectra v[0-9]" src/ | grep -v package.json | grep -q "." && echo "FAIL: hardcoded version string" && exit 1`

---

## Bug 4：Reading Mode 命名/文档误导

### 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何用户预期 reading < 60s？ | `--help` 文字"轻量，跳过产品文档层"过于模糊，未说明模块级 LLM 仍运行 |
| Why 2 | 实际差异是什么？ | reading mode 省约 38% 时间（827s vs 1341s），主要节省来自跳过 architecture-narrative / ADR / user-journeys 等；模块级 LLM（每模块 80-110s）不跳 |
| Why 3 | 真正"快速"模式是什么？ | `--mode code-only`（纯 AST，无 LLM，< 30s），但 help 文字中无醒目提示 |

**Root Cause**：`src/cli/index.ts:97` 的 `--mode` help 文字将 reading 描述为"轻量"，未量化说明时间节省或指向 code-only。

### 影响范围

| 文件 | 位置 | 修复动作 |
|------|------|---------|
| `src/cli/index.ts` | L97 `--mode` help 文字 | 明确三档差异，含时间预估 |
| `src/cli/commands/batch.ts` | mode 解析后 | 当 `mode === 'reading'` 且 stdout isTTY 时打印 hint |
| `CHANGELOG.md` | 新增 v4.0.1 节 | 说明修正内容 |

---

## 同步更新清单

| 类型 | 文件 | 动作 |
|------|------|------|
| 主修复 | `src/panoramic/batch-project-docs.ts` | enableAdr guard |
| 主修复 | `src/cli/commands/batch.ts` | --enable-adr flag + reading hint |
| 主修复 | `src/batch/batch-orchestrator.ts` | hyperedges WARNING |
| 主修复 | `src/generator/frontmatter.ts` | version source-of-truth + 3 处调用修改 |
| 主修复 | `src/generator/index-generator.ts` | version 修改 |
| 主修复 | `src/spec-store/spec-store.ts` | version 修改 |
| 主修复 | `src/cli/index.ts` | --mode help 文字 |
| 测试 | `tests/unit/generator/frontmatter.test.ts` | version 字段断言 |
| 测试 | `tests/unit/cli/batch.test.ts` | --enable-adr / hyperedges WARNING 断言 |
| 文档 | `CHANGELOG.md` | v4.0.1 节 |
| Release check | `scripts/check-plugin-sync.sh` | 版本字符串 grep 规则 |

## Spec 影响评估

现有 spec 无需更新。docs/spectra-v4-hotfix-roadmap.md 已在本 feature 创建前完成。
