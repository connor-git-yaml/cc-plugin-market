# Implementation Plan: 修复 Batch 单语言非 TS/JS 依赖图选择

**Branch**: `052-batch-singlelang-graph` | **Date**: 2026-03-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/052-batch-singlelang-graph/spec.md`

## Summary

修复 `runBatch()` 对纯 Python/Go/Java 项目的构图入口选择错误。当前实现总是先执行 TS/JS 专用的 `buildGraph()`，并在单语言非 TS/JS 场景中误用其空图结果，导致 `groupFilesToModules()` 返回 0 模块。修复后，单语言非 TS/JS 项目会直接走该语言的 adapter/fallback 图；纯 TS/JS 和多语言项目保持原行为。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js >= 20  
**Primary Dependencies**: dependency-cruiser（现有，TS/JS 路径）、LanguageAdapterRegistry（现有）、vitest  
**Storage**: N/A  
**Testing**: vitest (`tests/unit`, `tests/integration`)  
**Target Platform**: Node.js CLI / MCP 共用 batch 编排逻辑  
**Project Type**: single  
**Constraints**: 不新增运行时依赖；不改变 batch CLI/MCP 接口；多语言路径必须保持兼容  
**Scale/Scope**: 1 个核心源文件 + 1 个回归测试文件

## Constitution Check

| 原则 | 状态 | 说明 |
|------|------|------|
| I. AST 精确性优先 | ✅ PASS | 本次修复不改变 AST 分析器，只修正图入口选择 |
| II. 混合分析流水线 | ✅ PASS | 仍保持“主图 + 兜底图”混合策略 |
| III. 诚实标注不确定性 | ✅ PASS | 无新增不确定性输出语义 |
| IV. 只读安全性 | ✅ PASS | 仅修改 batch 内部逻辑与测试 |
| V. 纯 Node.js 生态 | ✅ PASS | 无新增依赖 |
| VI. 双语文档规范 | ✅ PASS | feature 制品使用现有文档规范 |

## Project Structure

### Documentation (this feature)

```text
specs/052-batch-singlelang-graph/
├── spec.md
├── research.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
└── batch/
    └── batch-orchestrator.ts

tests/
├── integration/
│   └── batch-singlelang.test.ts
└── fixtures/
    └── multilang/python/
```

**Structure Decision**: 保持现有目录结构。逻辑修改集中在 orchestrator；使用新的集成测试覆盖纯非 TS/JS 项目回归。

## Design Notes

### Root Cause

1. `runBatch()` 在语言检测前即调用 `buildGraph(resolvedRoot)`
2. 单语言非 TS/JS 项目 `isMultiLang === false`
3. 因未进入 per-language graph 分支，`mergedGraph` 保持为 TS/JS 空图
4. `groupFilesToModules(mergedGraph)` 因空图返回 0 模块

### Fix Design

新增明确的图选择流程：

1. 扫描文件并得出 `detectedLanguages`
2. 若语言数为 1 且该语言不是 `ts-js`
   - 使用 `groupFilesByLanguage()` 获取唯一语言组
   - 查找 adapter
   - 若 adapter 存在 `buildDependencyGraph()`，尝试构建
   - 失败或缺失时使用 `buildFallbackGraph()`
3. 若语言数 >= 2，保留现有多语言逻辑
4. 其余情况（纯 TS/JS 或未识别语言）保留 `buildGraph()` 结果

### Test Strategy

- 新增纯 Python 项目 batch 集成测试
- 通过预创建模块 spec 让 `runBatch()` 走 skip 分支，避免 LLM 调用
- 断言 `totalModules > 0`、`skipped === totalModules`、索引与摘要生成正常

## Complexity Tracking

无 Constitution 违规需要说明。
