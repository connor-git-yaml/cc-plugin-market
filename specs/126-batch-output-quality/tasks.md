# 任务清单：Spectra Batch 输出质量修复（Issue #126）

**版本**: 1.0
**日期**: 2026-04-19
**分支**: `fix/126-batch-output-quality`
**模式**: fix

---

## 执行顺序概览

```text
Phase 1: P5 — README 计数修复（T1）
  └→ Phase 2: P1 — collectLocalDesignDocs 正则扩展（T2）
       └→ Phase 3: P2 — 模块级 docstring（T3 → T4 → T5 → T6 → T7）
            └→ Phase 4: P3 — Python 依赖图（T8）
                 └→ Phase 5: P0 — 重建 dist + 测试（T9 → T10）
```

每步完成后可运行 `npx tsc --noEmit` 局部验证，无需等待全部完成。

---

## Phase 1: P5 — README 计数修复

### T1: 修复 batch README 模块规范计数错误
- 状态: `[X]`
- 文件: `src/batch/batch-orchestrator.ts`
- 操作: 定位 L790 的 `moduleSpecs: successful,`，将其替换为 `moduleSpecs: collectedModuleSpecs.map(s => path.basename(s.outputPath, '.spec.md')),`。修改前先确认 `collectedModuleSpecs` 变量在该作用域内可访问，且每个元素含 `outputPath` 属性。
- 验证: `npx tsc --noEmit` 零错误；README 输出中 "模块规范" 计数等于实际生成的 `.spec.md` 文件数（如 graphify 项目应显示 5 而非 1）

---

## Phase 2: P1 — collectLocalDesignDocs 正则扩展

### T2: 扩展 isDesignLike 正则词表
- 状态: `[X]`
- 文件: `src/panoramic/pipelines/product-ux-docs.ts`
- 操作: 定位 L490–L491 的两处正则表达式，在两处末尾的 `brief` 之后追加 `|architecture|arch|notes|overview|guide|system|model|diagram`。
  - L490: `/(design|product|roadmap|journey|ux|persona|brief)/i` → `/(design|product|roadmap|journey|ux|persona|brief|architecture|arch|notes|overview|guide|system|model|diagram)/i`
  - L491: `/(^\/)(design|product|roadmap|journey|ux|persona|brief)s?\//i` → `/(^\/)(design|product|roadmap|journey|ux|persona|brief|architecture|arch|notes|overview|guide|system|model|diagram)s?\//i`
- 验证: `npx tsc --noEmit` 零错误；对含 `architecture.md`/`notes.md` 的目录调用 `collectLocalDesignDocs`，确认这两类文件出现在返回集合中

---

## Phase 3: P2 — 模块级 docstring（5 文件联动）

### T3: CodeSkeleton schema 新增 moduleDoc 字段
- 状态: `[X]`
- 文件: `src/models/code-skeleton.ts`
- 操作: 在 `CodeSkeletonSchema` 的 `parserUsed` 字段附近（L125 附近）添加以下字段定义：
  ```typescript
  moduleDoc: z.string().optional(),
  ```
  字段为 optional，向后兼容，不影响现有消费方。
- 验证: `npx tsc --noEmit` 零错误；`CodeSkeleton` 类型导出含 `moduleDoc?: string`

---

### T4: QueryMapper 接口新增可选 extractModuleDoc 方法
- 状态: `[X]`
- 文件: `src/core/query-mappers/base-mapper.ts`
- 操作: 在 `QueryMapper` 接口中新增以下可选方法签名：
  ```typescript
  /** 提取模块级文档注释（可选，仅支持此概念的语言实现） */
  extractModuleDoc?(tree: Parser.Tree): string | null;
  ```
  此方法为 optional，已有 mapper 实现无需变更。
- 验证: `npx tsc --noEmit` 零错误；接口变更不影响现有 mapper 编译

---

### T5: PythonMapper 实现 extractModuleDoc 方法
- 状态: `[X]`
- 文件: `src/core/query-mappers/python-mapper.ts`
- 操作: 在 `PythonMapper` 类中新增 public 方法 `extractModuleDoc`，内联提取根节点模块级 docstring 的逻辑：
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
  逻辑说明：取根节点下第一个 `expression_statement` 子节点的字符串值，截取首行，限 200 字符。
- 验证: `npx tsc --noEmit` 零错误；对含模块级 docstring 的 Python 文件调用此方法，返回 docstring 首行

---

### T6: tree-sitter-analyzer 在 skeleton 构建时注入 moduleDoc
- 状态: `[X]`
- 文件: `src/core/tree-sitter-analyzer.ts`
- 操作: 在 `analyze` 方法的 skeleton 构建处，在 `const skeleton: CodeSkeleton = { ... }` 之前添加：
  ```typescript
  const moduleDoc = mapper.extractModuleDoc?.(tree) ?? undefined;
  ```
  并在 skeleton 对象中用展开语法注入：
  ```typescript
  ...(moduleDoc != null ? { moduleDoc } : {}),
  ```
  注意：使用 optional chaining 调用，当 mapper 未实现 `extractModuleDoc` 时等同于 `undefined`，不影响现有行为。
- 验证: `npx tsc --noEmit` 零错误；对有模块 docstring 的 Python 文件，生成的 `CodeSkeleton.moduleDoc` 非空

---

### T7: context-assembler formatSkeleton 追加 moduleDoc 输出
- 状态: `[X]`
- 文件: `src/core/context-assembler.ts`
- 操作: 在 `formatSkeleton` 函数的 `## 文件信息` 区块（L70–75 附近）追加：
  ```typescript
  if (skeleton.moduleDoc) {
    parts.push(`- 模块说明: ${skeleton.moduleDoc}`);
  }
  ```
  此为条件追加，`moduleDoc` 未设置时无任何输出变化。
- 验证: `npx tsc --noEmit` 零错误；对含 `moduleDoc` 的 skeleton 调用 `formatSkeleton`，输出中包含 `- 模块说明: ...` 行

---

## Phase 4: P3 — Python 依赖图

### T8: PythonAdapter 实现 buildDependencyGraph 方法
- 状态: `[X]`
- 文件: `src/adapters/python-adapter.ts`
- 操作: 实现 `buildDependencyGraph` 方法，方法签名与 `LanguageAdapter` 接口保持一致：
  ```typescript
  async buildDependencyGraph(
    projectRoot: string,
    options?: DependencyGraphOptions,
  ): Promise<DependencyGraph>
  ```
  实现逻辑：
  1. 用 `glob` 或 `fs` 递归扫描 `projectRoot` 下所有 `.py` 文件，排除 `test`、`tests`、`dist`、`__pycache__`、`.venv`、`venv` 目录（复用 `defaultIgnoreDirs`）
  2. 对每个文件调用 `this.analyzeFile(filePath)` 获取 `CodeSkeleton.imports`
  3. 对 `isRelative: true` 或本地模块的 `ImportReference`：解析 `moduleSpecifier` 为 `${projectRoot}/<moduleSpecifier>.py`，若文件存在则构建 `DependencyEdge { from, to, isCircular: false, importType: 'static' }`
  4. 去重 nodes，收集所有 edges，返回 `DependencyGraph`

  需新增导入：`DependencyGraph`、`DependencyGraphOptions`、`DependencyEdge`、`GraphNode`（来自 `../models/dependency-graph.js`）、`path`、`fs`。
  文件将从 79 行扩展到约 130 行，不触发清理规则。
- 验证: `npx tsc --noEmit` 零错误；对 graphify 示例项目调用此方法，返回的 `DependencyGraph.edges` 数组非空，边的 `from`/`to` 均为有效 `.py` 文件路径

---

## Phase 5: P0 — 重建 dist + 测试

### T9: 重建 dist
- 状态: `[X]`
- 文件: `（构建产物，不修改源文件）`
- 操作: 在项目根目录执行 `npm run build`。前提条件：T1–T8 全部完成且 `npx tsc --noEmit` 零错误。
- 验证: `npm run build` 退出码为 0，`dist/` 目录时间戳更新到当前时间

---

### T10: 全量测试验证
- 状态: `[X]`
- 文件: `（测试运行，不修改源文件）`
- 操作: 执行 `npx vitest run`，确认全量单元测试零失败。
- 验证: `npx vitest run` 退出码为 0，测试报告显示 0 failed

---

## FR 覆盖映射

| 问题 ID | 描述 | 对应任务 |
|---------|------|----------|
| P5 | README 模块规范计数错误 | T1 |
| P1 | collectLocalDesignDocs 正则过严 | T2 |
| P2 | CodeSkeleton 缺失 moduleDoc 字段 | T3 |
| P2 | QueryMapper 接口缺少 extractModuleDoc | T4 |
| P2 | PythonMapper 未提取模块级 docstring | T5 |
| P2 | tree-sitter-analyzer 未注入 moduleDoc | T6 |
| P2 | context-assembler 未输出 moduleDoc | T7 |
| P3 | Python adapter 缺少 buildDependencyGraph | T8 |
| P0 | dist 过期 | T9 |
| P0 | 回归验证 | T10 |

**覆盖率**: 5 个问题，10 个任务，100% 问题覆盖。

---

## 并行说明

- T3、T4 可并行执行（不同文件，无相互依赖）
- T5 依赖 T4（需 `QueryMapper` 接口先定义 `extractModuleDoc?`）
- T6 依赖 T3、T4、T5（需 schema 字段和接口方法就绪）
- T7 依赖 T3（需 `CodeSkeleton.moduleDoc` 字段存在）
- T8 独立于 T3–T7，可在 P2 完成后或同步进行（不同文件）
- T9、T10 必须串行，且依赖 T1–T8 全部完成
