# Implementation Plan: 修复 Spec 输出中的绝对路径问题

**Branch**: `008-fix-spec-absolute-paths` | **Date**: 2026-02-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-fix-spec-absolute-paths/spec.md`

## Summary

修复生成的 spec 文件中 `sourceTarget` 字段和 `#` 标题行使用绝对路径的问题。根本原因是 `generateSpec()` 调用 `generateFrontmatter()` 时直接传入 `targetPath`（绝对路径），而未像 `relatedFiles` 和 `fileInventory` 那样进行相对路径转换。修复方案：在 `generateSpec()` 中使用 `path.relative()` 将 `sourceTarget` 转换为相对于 `projectRoot` 的路径。

## Technical Context

**Language/Version**: TypeScript 5.7.3, Node.js LTS (≥20.x)
**Primary Dependencies**: 无新增依赖，仅使用 Node.js 内置 `path` 模块（已存在）
**Storage**: 文件系统（specs/ 目录写入）
**Testing**: vitest（现有测试框架）
**Target Platform**: Node.js CLI 工具
**Project Type**: single
**Performance Goals**: N/A（路径字符串处理，无性能影响）
**Constraints**: 不修改 `generateSpec()` 的公共接口签名
**Scale/Scope**: 改动量 <10 行代码

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. AST 精确性优先 | ✅ 通过 | 本修复不涉及 AST 数据——仅修改展示层的路径格式 |
| II. 混合分析流水线 | ✅ 通过 | 不改变三阶段流水线流程 |
| III. 诚实标注不确定性 | ✅ 通过 | 不影响不确定性标记机制 |
| IV. 只读安全性 | ✅ 通过 | 写操作仍限于 specs/ 目录 |
| V. 纯 Node.js 生态 | ✅ 通过 | 仅使用 Node.js 内置 `path` 模块 |
| VI. 双语文档规范 | ✅ 通过 | 不影响文档内容语言 |

所有门控通过，无违规项。

## Root Cause Analysis

### 问题根源

`single-spec-orchestrator.ts` 的 `generateSpec()` 函数（行 318-324）：

```typescript
const frontmatter = generateFrontmatter({
  sourceTarget: targetPath,  // ← 直接使用绝对路径
  relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f)),  // ← 已转相对路径
  confidence,
  skeletonHash: mergedSkeleton.hash,
  existingVersion,
});
```

**不一致的路径处理**：
- `relatedFiles`：使用 `path.relative(process.cwd(), f)` → 相对路径 ✅
- `fileInventory`（行 327-334）：使用 `path.relative(baseDir, s.filePath)` → 相对路径 ✅
- **`sourceTarget`**：直接使用 `targetPath` → 绝对路径 ❌

### 调用链路分析

**generate 模式**（CLI → `generateSpec`）：
1. `generate.ts:21` — `const targetPath = resolve(target)` → 将用户输入转为绝对路径
2. `generate.ts:37` — `generateSpec(targetPath, { projectRoot: process.cwd() })` → 传递绝对路径
3. `single-spec-orchestrator.ts:319` — `sourceTarget: targetPath` → 绝对路径写入 frontmatter

**batch 模式**（CLI → `runBatch` → `generateSpec`）：
1. `batch.ts:22` — `runBatch(process.cwd(), ...)` → 传递 cwd 作为 projectRoot
2. `batch-orchestrator.ts:72` — `const resolvedRoot = path.resolve(projectRoot)` → 绝对化
3. `batch-orchestrator.ts:161/167` — `path.join(resolvedRoot, file/group.dirPath)` → 拼接为绝对路径
4. `single-spec-orchestrator.ts:319` — `sourceTarget: targetPath` → 绝对路径写入 frontmatter

### 修复点

唯一需要修改的位置：`single-spec-orchestrator.ts` 行 317-327

将 `baseDir` 的计算提前到 frontmatter 生成之前，使 `sourceTarget` 和 `fileInventory` 共用同一个基准路径。

**修改前**：

```typescript
// 行 318-324：生成 frontmatter
const frontmatter = generateFrontmatter({
  sourceTarget: targetPath,
  relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f)),
  ...
});

// 行 327：baseDir 在 frontmatter 之后定义
const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
```

**修改后**：

```typescript
// baseDir 提前到 frontmatter 之前
const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();

// 使用 path.relative 转换 sourceTarget
const frontmatter = generateFrontmatter({
  sourceTarget: path.relative(baseDir, path.resolve(targetPath)),
  relatedFiles: filePaths.map((f) => path.relative(baseDir, f)),
  ...
});

// fileInventory 使用同一个 baseDir（已有）
```

### 受影响的下游消费者

`sourceTarget` 被以下位置使用：
1. **Handlebars 模板** `templates/module-spec.hbs:5` — frontmatter YAML 输出
2. **Handlebars 模板** `templates/module-spec.hbs:15` — `# {{frontmatter.sourceTarget}}` 标题
3. **索引生成器** `src/generator/index-generator.ts:41,45,49,84` — 模块名和路径匹配

索引生成器使用 `sourceTarget.includes(n.source)` 和 `sourceTarget.split('/')[0]` 进行匹配。由于 `n.source` 来自 dependency-cruiser 的相对路径，改为相对路径后匹配反而更准确。

### 附带修复：`relatedFiles` 使用 `baseDir` 统一基准

当前 `relatedFiles` 使用 `process.cwd()` 而 `fileInventory` 使用 `baseDir`（`projectRoot` 优先），两者不一致。统一为 `baseDir` 确保所有路径以相同基准计算。

## Project Structure

### Documentation (this feature)

```text
specs/008-fix-spec-absolute-paths/
├── plan.md              # 本文件
├── research.md          # Phase 0 output
└── contracts/           # Phase 1 output
    └── path-normalization.md
```

### Source Code (repository root)

```text
src/
├── core/
│   └── single-spec-orchestrator.ts   # 修改点：sourceTarget 路径转换
├── batch/
│   └── batch-orchestrator.ts         # 无需修改（传入的绝对路径在 orchestrator 中转换）
├── generator/
│   ├── frontmatter.ts                # 无需修改（纯透传）
│   └── index-generator.ts            # 验证：相对路径下匹配逻辑仍正确
├── cli/
│   └── commands/
│       ├── generate.ts               # 无需修改（已传 projectRoot）
│       └── batch.ts                  # 无需修改
└── models/
    └── module-spec.ts                # 无需修改（类型定义）

templates/
└── module-spec.hbs                   # 无需修改（模板直接渲染 sourceTarget）

tests/
└── unit/                             # 验证现有测试通过
```

**Structure Decision**: 单项目结构，修改范围极小——仅 `src/core/single-spec-orchestrator.ts` 一个文件中约 3 行代码变更。
