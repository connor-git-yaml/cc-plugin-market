# 修复规划：Spectra Batch 输出质量（Issue #126）

**版本**: 1.0  
**日期**: 2026-04-19  
**分支**: `fix/126-batch-output-quality`  
**模式**: fix（精确修复，非功能新增）

---

## 执行摘要

本次修复覆盖 5 个 batch 输出质量问题（P0–P5）。所有问题均为实现层 bug，不涉及规格变更。  
执行顺序：P5 → P1 → P2（4 文件） → P3 → P0。

> **重要纠正**：fix-report.md 中 P2 将 `moduleDoc` 注入点标注为 `ast-analyzer.ts`（analyzeFileInternal）。
> 经代码核查，Python 文件的 AST 解析路径为 `PythonLanguageAdapter.analyzeFile` → `TreeSitterAnalyzer.analyze`（`tree-sitter-analyzer.ts`），
> `analyzeFileInternal` 仅处理 TS/JS 文件。因此 P2 的 skeleton 构建修改位置更正为 `src/core/tree-sitter-analyzer.ts`。

---

## 技术栈确认

| 项目 | 版本/说明 |
|------|-----------|
| 语言 | TypeScript 5.x |
| 运行时 | Node.js 20.x+ |
| AST 引擎 | `tree-sitter`（Python 解析）+ `ts-morph`（TS/JS） |
| 数据验证 | `zod`（CodeSkeleton schema） |
| 测试框架 | Vitest |
| 构建 | `npm run build`（tsc） |

---

## Codebase Reality Check

| 文件 | LOC | 主要函数/方法数 | 已知 Debt |
|------|-----|----------------|-----------|
| `src/batch/batch-orchestrator.ts` | 925 | ~25 | 无相关 TODO/FIXME |
| `src/panoramic/pipelines/product-ux-docs.ts` | 1177 | ~30 | 无相关 TODO/FIXME |
| `src/models/code-skeleton.ts` | 165 | — | 无 |
| `src/core/query-mappers/python-mapper.ts` | 742 | ~15（公开 3） | 无 |
| `src/core/tree-sitter-analyzer.ts` | ~200 | ~8 | 无（替换 fix-report 中的 ast-analyzer.ts） |
| `src/core/context-assembler.ts` | 331 | ~6 | 无 |
| `src/adapters/python-adapter.ts` | 79 | 5 | `buildDependencyGraph` 缺失（本次修复） |

**前置清理规则评估**：

- `product-ux-docs.ts` LOC=1177，本次新增 < 5 行 → 不触发清理规则
- `batch-orchestrator.ts` LOC=925，本次修改 1 行 → 不触发清理规则
- 无文件满足 > 3 个相关 TODO/FIXME 或 > 30 行重复代码条件

结论：**无需前置 CLEANUP task**。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 7（含 tree-sitter-analyzer.ts） |
| 间接受影响文件 | `PythonLanguageAdapter`（调用 TreeSitterAnalyzer）；batch README 消费方 |
| 跨包影响 | 无（全部在 `src/` 内） |
| 数据迁移 | 无 |
| API/契约变更 | `CodeSkeletonSchema` 新增 optional 字段（向后兼容，不破坏现有消费方） |
| 风险等级 | **LOW**（修改文件 7 个，无跨包影响，无数据迁移） |

风险等级判定依据：修改文件 < 10，无跨包影响，`moduleDoc` 为 optional 字段不影响现有序列化/反序列化。

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 是 | PASS | 中文注释，英文代码标识符 |
| II. Spec-Driven Development | 是 | PASS | 通过 fix-report → plan → tasks 流程执行 |
| III. YAGNI / 奥卡姆剃刀 | 是 | PASS | `moduleDoc` 有当前明确使用场景；`buildDependencyGraph` 填充已定义接口 |
| IV. 诚实标注不确定性 | 不适用 | — | 本次为实现修复，无推断内容生成 |
| V. AST 精确性优先 | 是 | PASS | `moduleDoc` 从 tree-sitter AST 提取，非 LLM 推断 |
| VI. 混合分析流水线 | 是 | PASS | 新增 `moduleDoc` 在预处理（AST 提取）阶段注入，不引入原始源码 |
| VII. 只读安全性 | 是 | PASS | 所有修复均为分析逻辑，不写入目标源文件 |
| VIII. 纯 Node.js 生态 | 是 | PASS | 使用已有的 `tree-sitter`/`web-tree-sitter`，无新运行时引入 |

**Constitution Check 结论**：全部 PASS，无 VIOLATION。

---

## 变更文件清单

### P5：README 模块规范计数错误

**文件**：`src/batch/batch-orchestrator.ts`

| 位置 | 当前代码 | 修改后代码 |
|------|----------|-----------|
| L790 | `moduleSpecs: successful,` | `moduleSpecs: collectedModuleSpecs.map(s => path.basename(s.outputPath, '.spec.md')),` |

**前提条件**：确认 `collectedModuleSpecs` 变量在 L790 所在作用域内可访问，且每个元素有 `outputPath` 属性。

---

### P1：collectLocalDesignDocs 正则过严

**文件**：`src/panoramic/pipelines/product-ux-docs.ts`

| 位置 | 当前代码 | 修改后代码 |
|------|----------|-----------|
| L490 | `/(design\|product\|roadmap\|journey\|ux\|persona\|brief)/i` | `/(design\|product\|roadmap\|journey\|ux\|persona\|brief\|architecture\|arch\|notes\|overview\|guide\|system\|model\|diagram)/i` |
| L491 | `/(^\/)(design\|product\|roadmap\|journey\|ux\|persona\|brief)s?\//i` | `/(^\/)(design\|product\|roadmap\|journey\|ux\|persona\|brief\|architecture\|arch\|notes\|overview\|guide\|system\|model\|diagram)s?\//i` |

---

### P2：模块 spec 语义节为空（4 文件联动）

#### 文件 1：`src/models/code-skeleton.ts`

在 `CodeSkeletonSchema`（L116）的 `parserUsed` 字段之前添加：

```typescript
moduleDoc: z.string().optional(),
```

位置：L125（`parserUsed` 字段之后，保持字段顺序）。

#### 文件 2：`src/core/query-mappers/python-mapper.ts`

在 `PythonMapper` 类中新增 public 方法 `extractModuleDoc`：

```typescript
/**
 * 提取 Python 文件根节点的模块级 docstring
 * 取根节点下第一个 expression_statement 子节点的字符串值
 */
extractModuleDoc(tree: Parser.Tree): string | null {
  const rootNode = tree.rootNode;
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (!child) continue;
    if (child.type !== 'expression_statement') break;
    return extractPythonDocstring(child.parent ?? child);
  }
  return null;
}
```

注意：复用已有的 `extractPythonDocstring` 私有函数——但该函数接受 `body` node 并查找第一个 `expression_statement` 子节点，因此需要将 rootNode 作为 body 等价传入，或直接内联逻辑（见下方精确实现）。

**精确实现**（避免语义歧义，内联提取逻辑）：

```typescript
extractModuleDoc(tree: Parser.Tree): string | null {
  const rootNode = tree.rootNode;
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (!child) continue;
    if (child.type !== 'expression_statement') break;
    const expr = child.child(0);
    if (!expr) break;
    const stringNode = expr.type === 'string' ? expr
      : expr.type === 'concatenated_string' ? expr.child(0)
      : null;
    if (!stringNode) break;
    const raw = stringNode.text;
    const stripped = raw
      .replace(/^"""([\s\S]*?)"""$/, '$1')
      .replace(/^'''([\s\S]*?)'''$/, '$1')
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')
      .trim();
    if (!stripped) return null;
    const firstLine = stripped.split('\n')[0]?.trim() ?? '';
    return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine || null;
  }
  return null;
}
```

#### 文件 3：`src/core/tree-sitter-analyzer.ts`（替代 fix-report 中的 ast-analyzer.ts）

在 `analyze` 方法中，skeleton 构建时注入 `moduleDoc`：

```typescript
// 原来：
const skeleton: CodeSkeleton = {
  filePath,
  language,
  loc,
  exports,
  imports,
  parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  hash,
  analyzedAt: new Date().toISOString(),
  parserUsed: 'tree-sitter',
};

// 修改后（仅 Python mapper 支持 extractModuleDoc）：
const moduleDoc = typeof (mapper as any).extractModuleDoc === 'function'
  ? (mapper as any).extractModuleDoc(tree)
  : undefined;

const skeleton: CodeSkeleton = {
  filePath,
  language,
  loc,
  exports,
  imports,
  ...(moduleDoc != null ? { moduleDoc } : {}),
  parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  hash,
  analyzedAt: new Date().toISOString(),
  parserUsed: 'tree-sitter',
};
```

更优方案（避免 `any` 强转）：在 `QueryMapper` 接口（`base-mapper.ts`）中新增 optional 方法：

```typescript
/** 提取模块级文档注释（可选，仅支持此概念的语言实现） */
extractModuleDoc?(tree: Parser.Tree): string | null;
```

然后在 `tree-sitter-analyzer.ts` 中：

```typescript
const moduleDoc = mapper.extractModuleDoc?.(tree) ?? undefined;
```

**选用后者（接口扩展方案）**，符合 Constitution 原则 III（有明确使用场景）和 V（AST 精确性）。这意味着 P2 实际涉及 5 个文件：

| 文件 | 修改内容 |
|------|----------|
| `src/models/code-skeleton.ts` | 添加 `moduleDoc?: z.string().optional()` |
| `src/core/query-mappers/base-mapper.ts` | 添加 optional `extractModuleDoc?` 方法 |
| `src/core/query-mappers/python-mapper.ts` | 实现 `extractModuleDoc` |
| `src/core/tree-sitter-analyzer.ts` | 调用 `mapper.extractModuleDoc?.(tree)` 并设置到 skeleton |
| `src/core/context-assembler.ts` | `formatSkeleton` 中追加 moduleDoc |

#### 文件 4（原文件 5）：`src/core/context-assembler.ts`

在 `formatSkeleton` 函数的 `## 文件信息` 区块（L70-75 之后）添加：

```typescript
if (skeleton.moduleDoc) {
  parts.push(`- 模块说明: ${skeleton.moduleDoc}`);
}
```

---

### P3：graph.json 无代码级边

**文件**：`src/adapters/python-adapter.ts`

实现 `buildDependencyGraph` 方法，方法签名与 `LanguageAdapter` 接口保持一致：

```typescript
async buildDependencyGraph(
  projectRoot: string,
  options?: DependencyGraphOptions,
): Promise<DependencyGraph>
```

**实现逻辑**：

1. 用 `glob` 或 `fs.readdirSync` 递归扫描 `projectRoot` 下所有 `.py` 文件
2. 排除目录：`test`、`tests`、`dist`、`__pycache__`、`.venv`、`venv`（复用 `defaultIgnoreDirs`）
3. 对每个文件，调用 `this.analyzeFile(filePath)` 获取 `CodeSkeleton.imports`
4. 对每个 `ImportReference`（`isRelative: true` 或本地模块名）：
   - `from parser import x` → `moduleSpecifier = 'parser'` → 查找 `${projectRoot}/parser.py` 是否存在
   - 若文件存在，构建 `DependencyEdge { from: filePath, to: resolvedPath, isCircular: false, importType: 'static' }`
5. 收集所有 nodes（去重）和 edges，构建 `DependencyGraph` 返回

**需要导入**：`DependencyGraph`、`DependencyGraphOptions`（来自 `../models/dependency-graph.js`）、`DependencyEdge`、`GraphNode`、`path`、`fs`。

**python-adapter.ts 将从 79 行扩展到约 130 行**，属于正常增量，不触发清理规则。

---

### P0：重建 dist

**操作**：执行 `npm run build`。

**前提条件**：P5、P1、P2、P3 全部完成且 TypeScript 编译零错误。

---

## 执行顺序

```text
P5 (1行改动，风险极低)
  └→ P1 (正则扩展，风险极低)
       └→ P2 (5文件联动，风险低，可独立编译验证)
            └→ P3 (1文件新增方法，风险低)
                 └→ P0 (npm run build)
```

各步骤完成后均可运行 `npx tsc --noEmit` 进行局部验证，无需等待全部完成。

---

## 回归风险评估

| 问题 | 风险等级 | 影响范围 | 回归说明 |
|------|----------|----------|----------|
| P5 | 极低 | `generateBatchReadme` 的计数逻辑 | `collectedModuleSpecs` 是数组，只是换了数据源，无类型变化 |
| P1 | 极低 | `collectLocalDesignDocs` 返回集合变多 | 已有文件仍可匹配；新增匹配只会让结果更丰富 |
| P2-schema | 极低 | `CodeSkeleton` 序列化/反序列化 | optional 字段，现有消费方忽略即可，zod 向后兼容 |
| P2-mapper | 低 | `PythonMapper` 新增方法 | 不影响现有 3 个公开方法；新方法独立，无副作用 |
| P2-analyzer | 低 | `tree-sitter-analyzer.ts` skeleton 构建 | 用 optional chaining 调用，无 mapper 未实现时等同 undefined |
| P2-assembler | 极低 | LLM prompt 内容轻微变化 | 新增可选行，不影响 prompt 结构；未设置 moduleDoc 时无变化 |
| P3 | 中 | `PythonAdapter.buildDependencyGraph` 新实现 | 新方法不影响现有 `analyzeFile`；需确保文件扫描逻辑排除测试目录 |
| P0 | 无 | dist 重建 | 纯构建操作 |

**整体风险**：LOW。P2 的 5 文件联动是本次最复杂的改动，但每处修改均独立、局部，无跨层副作用。

---

## 验证方案

### 阶段验证（每步完成后）

```bash
# TypeScript 类型检查（零错误）
npx tsc --noEmit
```

### 最终验证（P0 完成后）

```bash
# 1. 构建
npm run build

# 2. 全量单元测试（零失败）
npx vitest run

# 3. 可选：repo 一致性检查
npm run repo:check
```

### P3 专项验证

针对 `buildDependencyGraph`，需要验证：
- 输入：Python 项目目录（可使用 graphify 测试项目）
- 断言：返回的 `DependencyGraph.edges` 数组非空
- 断言：边的 `from`/`to` 均为有效文件路径

---

## 复杂度追踪

| 决策 | 选用方案 | 替代方案 | 理由 |
|------|----------|----------|------|
| P2 moduleDoc 注入点 | `tree-sitter-analyzer.ts`（非 `ast-analyzer.ts`） | 按 fix-report 修改 ast-analyzer | Python 文件的 skeleton 构建路径是 TreeSitterAnalyzer，修改 ast-analyzer 无效 |
| P2 接口扩展 | 在 `QueryMapper` 接口新增 optional `extractModuleDoc?` | 在 tree-sitter-analyzer 内用 `(mapper as any)` 强转 | 保持类型安全，符合 Constitution 原则 III（有明确使用场景） |
| P3 文件扫描 | 调用 `this.analyzeFile` 复用已有 AST 提取 | 独立实现扫描逻辑 | 最小化重复代码，与现有适配器生命周期一致 |
