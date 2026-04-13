# 问题修复报告

## 问题描述

Spectra 在非 TypeScript 单包项目（如 Python Graphify）上存在两个系统性缺陷：

1. **图谱 0 边问题**：`buildDirectoryGraph()` 仅处理 `isRelative=true` 的导入，Python 项目几乎不使用相对导入，导致图谱生成 0 条边。
2. **产品文档级联断裂**：`buildCoreScenarios()` 依赖 README 显式列表格式，叙述散文型 README 返回空 → user-journeys 空 → feature-briefs 空。

---

## 5-Why 根因追溯

### 缺陷 1：图谱 0 边

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | Python 图谱为何只有节点没有边？ | `buildDirectoryGraph()` L74：`if (!imp.isRelative) continue;` 跳过所有非相对导入 |
| Why 2 | Python import 为何 isRelative=false？ | `python-mapper.ts` L625-638：`from graphify.core import X` 无 `.` 前缀 → `isRelative=false` |
| Why 3 | 为何原实现只处理相对导入？ | 设计时以 TypeScript 项目为主，TypeScript 几乎只用相对路径 `./foo`；Python 的包名式绝对 import 未纳入 |
| Why 4 | 为何 Python 用绝对 import？ | Python 社区惯例：`from graphify.core import Parser` 优于 `from .core import Parser`；PEP 328 推荐绝对导入 |
| Why 5 | 为何未被测试捕获？ | T023-T032 全部使用 `isRelative: true` 测试；无覆盖 Python 绝对 import 场景的用例 |

**Root Cause**：`buildDirectoryGraph()` 的设计假设"项目内依赖只通过相对 import 表达"，该假设对 Python 项目不成立。

**Root Cause Chain**：图谱 0 边 → isRelative=false 导入被 `continue` 跳过 → 设计只考虑 TypeScript 相对导入范式 → Python 使用包名式绝对导入 → 无对应测试捕获该边界条件

**附加问题（cross-reference-index）**：`buildCrossReferenceIndex()` 依赖 `docGraph.references`（由文件内容解析生成），Python 项目 0 边导致 references 也为空，进而 crossModule 列表空。补充方案：从 `moduleSpec.baselineSkeleton.imports` 直接推断跨模块链接。

---

### 缺陷 2：产品文档级联断裂

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | feature-briefs 为何为空？ | `buildFeatureBriefIndex()` 在无 GitHub 数据时回退 `journeys.journeys`，而 journeys 为空 |
| Why 2 | user-journeys 为何为空？ | `buildUserJourneys()` 从 `overview.coreScenarios` 派生，`coreScenarios` 为空 |
| Why 3 | coreScenarios 为何为空？ | `buildCoreScenarios()` 在 current-spec 无场景时回退 GitHub issue/PR；若均无则返回 `[]` |
| Why 4 | README 内容为何没被利用？ | `buildCoreScenarios()` 对 README 无任何处理；`extractParagraphs()` 虽提取段落但不解析场景语义 |
| Why 5 | 为何未被现有测试发现？ | 现有测试提供了完整 current-spec + GitHub mock，未覆盖"纯叙述型 README + 无 current-spec + 无 GitHub"场景 |

**Root Cause**：`buildCoreScenarios()` 的 fallback 链在"无 current-spec + 无 GitHub 数据 + 散文 README"场景下存在断裂，且 `extractParagraphs()` 缺乏过滤噪声（badge、纯链接、短行），导致后续语义处理失败。

**Root Cause Chain**：feature-briefs 空 → journeys 空 → coreScenarios 空 → README 叙述内容未解析为场景 → `buildCoreScenarios` 无 README 路径 + `extractParagraphs` 无语义过滤

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/graph/directory-graph.ts` | L74 | `if (!imp.isRelative) continue;` | 增加绝对 import 解析分支 |
| `src/panoramic/cross-reference-index.ts` | L70-127 | 仅从 `docGraph.references` 构建跨模块索引 | 增加 skeleton imports 补充通道 |
| `src/panoramic/pipelines/product-ux-docs.ts` | L922-932 | `extractParagraphs` 无语义过滤 | 增加 badge/纯链接/短行过滤 |
| `src/panoramic/pipelines/product-ux-docs.ts` | L834-848 | `buildCoreScenarios` 无 README fallback | 增加叙述段落提取路径 |
| `src/panoramic/pipelines/product-ux-docs.ts` | L435-453 | `buildFeatureBriefIndex` 完全依赖 journeys | 增加 spec 意图段 + README 独立数据源 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/graph/directory-graph.ts` | L188-228 | `resolveImportPath` 只处理相对路径 | 安全：该函数只在 isRelative=true 路径调用，新增 `resolveAbsoluteImportPath` 独立处理 |
| `src/core/single-spec-orchestrator.ts` | - | 调用 `buildDirectoryGraph` | 安全：接口不变，函数签名保持稳定 |

### 同步更新清单

- 测试：`tests/unit/directory-graph.test.ts`（新增 T033-T035 Python 绝对 import 场景）
- 测试：`tests/panoramic/cross-reference-index.test.ts`（新增 skeleton imports 补充测试）
- 测试：`tests/panoramic/product-ux-docs.test.ts`（新增叙述型 README 场景测试）
- 文档：无需更新（行为变更在现有合同范围内）

---

## 修复策略

### 方案 A（推荐）：精准补充 + 保持向后兼容

**缺陷 1**：
- `directory-graph.ts`：在边构建循环中，对 `isRelative=false` 的 import，调用新函数 `resolveAbsoluteImportPath()`——将点分包名转为路径，尝试匹配 fileSet 中的实际文件。只有命中项目内已知文件时才创建边（外部库不在 fileSet 中，自动排除）。
- `cross-reference-index.ts`：在 `buildCrossReferenceIndex()` 末尾增加补充通道，遍历 `moduleSpec.baselineSkeleton.imports` 中 `isRelative=false` 的项，通过 `resolveSpecifierToSpecPath()` 匹配 docGraph.specs，找到匹配则在 `crossModuleMap` 中增加出站引用（若已有则跳过，避免重复计数）。

**缺陷 2**：
- `extractParagraphs()`：增加过滤条件：跳过 badge 行（仅含 `![...](...)` 的行）、纯链接行（仅含 `[...](...)` 且无其他文字的行）、长度 < 20 的行。
- `buildCoreScenarios()`：在 GitHub fallback 之后增加 Phase 3 README fallback：对每个 readme 调用新函数 `extractScenariosFromReadme()`，从 Features/How it works/Getting started 等标题下提取列表项或段落。
- `buildFeatureBriefIndex()`：在 journeys fallback 之后增加两个独立数据源：① 从 current-spec 意图段的列表项派生 brief；② 从 README 段落派生 brief。

### 方案 B（备选）：LLM 语义理解

用 LLM 调用理解叙述型 README 并结构化提取场景。风险：添加外部依赖、成本高、延迟大、需要离线降级。**不推荐**。

---

## Spec 影响

- 需要更新的 spec：无（此为实现层修复，不涉及公开接口变更）
