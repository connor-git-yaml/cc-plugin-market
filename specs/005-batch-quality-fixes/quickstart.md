# Quickstart: Batch 模块级聚合与生成质量提升

**Feature**: 005-batch-quality-fixes
**Date**: 2026-02-14
**前提**: 代码已完成，本文档用于验证现有实现。

## 验证步骤

### 1. 构建验证

```bash
npm run build
```

确保 TypeScript 编译通过，无类型错误。

### 2. 测试验证

```bash
npm test
```

确保所有测试通过，特别关注：

- `tests/unit/module-grouper.test.ts` — 模块分组逻辑
- `tests/unit/llm-client.test.ts` — 章节匹配和系统提示词

### 3. 模块分组验证

对本项目自身运行 batch 命令，观察模块分组行为：

```bash
# 验证分组结果（不实际调用 LLM，仅观察分组输出）
npx reverse-spec batch .
```

预期输出示例：

```text
发现 25 个文件，聚合为 8 个模块
```

验证点：

- 文件被正确聚合为目录级模块
- 模块数量远小于文件数量
- root 模块包含 `src/` 根目录下的散文件

### 4. dependency-cruiser 兼容性验证

```bash
# 确认 dependency-cruiser 版本
npx dependency-cruiser --version

# 运行依赖图构建（batch 的第一步）
npx reverse-spec batch . --force
```

验证点：

- 无空指针异常
- 依赖图正确构建

### 5. spec 生成质量验证

对一个已知模块运行 generate，检查输出质量：

```bash
npx reverse-spec generate src/auth/ --deep
```

验证点：

- 输出包含完整 9 个章节
- 包含 Mermaid 类图和依赖关系图
- 无空章节或占位内容
- 章节标题格式为 `## N. 章节名`

### 6. 相对路径验证

检查生成的 spec 文件中的 `fileInventory`：

```bash
head -30 specs/auth.spec.md
```

验证 `related_files` 中的路径为相对路径（如 `src/auth/auth-detector.ts`），而非绝对路径。

## 预期结果

| 验证项 | 预期 |
|--------|------|
| 构建 | 零错误 |
| 测试 | 全部通过 |
| 模块分组 | 文件被聚合为目录级模块 |
| dependency-cruiser | v15.x 和 v16.x 均兼容 |
| spec 质量 | 9 章节完整，含 Mermaid 图表 |
| 文件路径 | 使用相对路径 |
