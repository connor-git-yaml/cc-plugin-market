# Contract: 路径归一化

**Feature**: 008-fix-spec-absolute-paths
**Scope**: `single-spec-orchestrator.ts` 中 frontmatter 路径处理

## 变更描述

### 修改文件

`src/core/single-spec-orchestrator.ts` — `generateSpec()` 函数

### 变更内容

#### 1. 提前 `baseDir` 计算（从行 327 移至行 317）

**Before** (行 327):

```typescript
// 构建 fileInventory（使用相对路径）
const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
```

**After** (行 317，frontmatter 生成之前):

```typescript
// 统一基准路径（供 sourceTarget、relatedFiles、fileInventory 共用）
const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
```

#### 2. `sourceTarget` 使用相对路径

**Before** (行 319):

```typescript
sourceTarget: targetPath,
```

**After**:

```typescript
sourceTarget: path.relative(baseDir, path.resolve(targetPath)),
```

#### 3. `relatedFiles` 统一基准路径

**Before** (行 320):

```typescript
relatedFiles: filePaths.map((f) => path.relative(process.cwd(), f)),
```

**After**:

```typescript
relatedFiles: filePaths.map((f) => path.relative(baseDir, f)),
```

#### 4. 移除原 `baseDir` 定义（行 327）

原行 327 的 `const baseDir = ...` 已在前面定义，此处删除避免重复声明。

## 接口不变性

| 项目 | 变更前 | 变更后 | 影响 |
| ---- | ------ | ------ | ---- |
| `generateSpec()` 函数签名 | 不变 | 不变 | 无 |
| `GenerateSpecOptions` 接口 | 不变 | 不变 | 无 |
| `GenerateSpecResult` 接口 | 不变 | 不变 | 无 |
| `generateFrontmatter()` 签名 | 不变 | 不变 | 无 |
| `FrontmatterInput` 接口 | 不变 | 不变 | 无 |
| Handlebars 模板 | 不变 | 不变 | 无 |

## 输出变更

| 字段 | 变更前 | 变更后 |
| ---- | ------ | ------ |
| `frontmatter.sourceTarget` | `/Users/user/project/src/acp` | `src/acp` |
| spec 标题 `# ...` | `# /Users/user/project/src/acp` | `# src/acp` |
| `frontmatter.relatedFiles` | 无变化（已为相对路径） | 基准从 `cwd()` 统一为 `baseDir` |
| `fileInventory[].path` | 无变化（已为相对路径） | 无变化 |

## 边界情况

| 场景 | `targetPath` | `baseDir` | `sourceTarget` 输出 |
| ---- | ------------ | --------- | ------------------- |
| 标准用法 | `/Users/u/proj/src/acp` | `/Users/u/proj` | `src/acp` |
| 项目根目录 | `/Users/u/proj` | `/Users/u/proj` | `.` |
| 单文件 | `/Users/u/proj/src/index.ts` | `/Users/u/proj` | `src/index.ts` |
| 子目录运行 | `/Users/u/proj/src/acp` | `/Users/u/proj` | `src/acp` |
| 已为相对路径 | `src/acp` | `/Users/u/proj` | `src/acp` |
