# Research: Batch 模块级聚合与生成质量提升

**Feature**: 005-batch-quality-fixes
**Date**: 2026-02-14
**Status**: 已完成（追溯记录）

## 1. 文件级 vs 模块级 batch 处理策略

**Decision**: 采用目录级模块聚合策略，按目录分组后以模块为单位生成 spec。

**Rationale**:

- 文件级处理导致一个 `src/auth/` 目录下 3 个文件生成 3 份独立 spec，缺乏模块整体视角
- 模块级聚合后，传入 `generateSpec()` 的是目录路径，AST 分析覆盖目录内所有文件，LLM 获得更完整的上下文
- spec 数量从文件数（可能 50+）降至模块数（通常 10-15），更易管理和阅读

**Alternatives considered**:

- **保持文件级**: 最简单但 spec 过于碎片化，模块间关联信息丢失
- **手动指定分组**: 灵活但需要用户维护配置文件，增加使用成本
- **基于依赖聚类**: 算法复杂度高，分组结果不直观，用户难以预测

## 2. basePrefix 自动检测 vs 硬编码

**Decision**: 自动检测 basePrefix，默认规则为 >80% 文件在 `src/` 下时使用 `'src/'`。

**Rationale**:

- 大多数 TypeScript 项目使用 `src/` 目录结构，自动检测覆盖主流场景
- 同时支持 `lib/` 前缀（>80% 阈值）
- 无 `src/` 或 `lib/` 时回退到项目根目录下第一级目录分组
- 用户可通过 `GroupingOptions.basePrefix` 覆盖

**Alternatives considered**:

- **硬编码 `'src/'`**: 不适用于使用 `lib/`、`packages/` 等结构的项目
- **读取 tsconfig.json rootDir**: 过于依赖项目配置，增加故障点

## 3. root 模块散文件处理策略

**Decision**: root 模块（`src/` 根目录下散文件）逐个文件单独生成 spec，不聚合。

**Rationale**:

- 根目录散文件通常功能独立（如 `index.ts`、`config.ts`），聚合反而混淆
- 其他模块以目录为单位传入 `generateSpec(dirPath)`，内聚性更好
- 保持与 `generateSpec()` 单文件入口的兼容性

**Alternatives considered**:

- **统一聚合为一个 root spec**: 可能混入不相关文件，降低 spec 质量
- **完全排除根目录文件**: 导致部分文件无 spec 覆盖

## 4. LLM 章节标题匹配策略

**Decision**: 扩展为多变体容错匹配，支持中英文、大小写、标点归一化。

**Rationale**:

- LLM（尤其是不同模型/温度设置）不总是输出完全匹配的中文标题
- 实际观察到 LLM 可能输出 `## 1. Intent`、`## 意图`、`## 1、意图` 等变体
- 归一化后双向包含检查覆盖大部分变体场景
- 每个章节提供 5-6 个候选标题（中文精确 + 英文 + 常见同义词）

**Alternatives considered**:

- **严格匹配**: 简单但丢失率高，需要 LLM 完全遵循提示词格式
- **正则表达式匹配**: 灵活但维护成本高，难以覆盖所有变体
- **LLM 后处理二次格式化**: 增加一次 API 调用成本和延迟

## 5. dependency-cruiser v16.x 异步适配

**Decision**: 使用 `instanceof Promise` 检测同时支持同步和异步返回。

**Rationale**:

- dependency-cruiser v16.x 将 `cruise()` 改为返回 Promise
- `instanceof Promise` 检测能同时兼容新旧版本，无需锁定具体版本号
- 使用 `process.chdir()` + `finally` 确保 cwd 恢复，是 dependency-cruiser 文档推荐的做法

**Alternatives considered**:

- **锁定 v15.x**: 阻止安全更新和新功能
- **检查 package.json 版本号**: 过于脆弱，且 monorepo 中可能有版本冲突

## 6. Mermaid 依赖关系图

**Decision**: 新增 `generateDependencyDiagram()` 与现有 `generateClassDiagram()` 并列。

**Rationale**:

- 类图展示模块内部结构，依赖图展示模块间关系，互补而非替代
- 依赖图从 `CodeSkeleton.imports` 数据生成，无需额外分析
- 区分内部依赖（实线箭头）和外部依赖（虚线箭头 + 包标记），视觉清晰

**Alternatives considered**:

- **扩展现有类图**: classDiagram 语法不适合表达模块间依赖
- **仅在 batch 索引中生成**: 单模块 spec 也需要展示自身的依赖关系
