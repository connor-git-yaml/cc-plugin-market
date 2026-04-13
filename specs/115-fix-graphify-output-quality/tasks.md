# 修复任务列表

## T1: BUG-A — 文件级模块路径修复

**文件**: `src/batch/batch-orchestrator.ts`
**位置**: ~第 482 行（`const fullDirPath = path.join(...)` 那行）
**操作**:
1. 将 `const fullDirPath = path.join(resolvedRoot, group.dirPath);` 替换为：
   ```typescript
   const targetPath = group.files.length === 1
     ? path.join(resolvedRoot, group.files[0]!)
     : path.join(resolvedRoot, group.dirPath);
   ```
2. 将 `generateSpec(fullDirPath, {` 替换为 `generateSpec(targetPath, {`

**验证**: 对有文件级降级的项目，应生成 N 个 `{filename}.spec.md` 而非 1 个 `{dirname}.spec.md`

---

## T2: BUG-C — Python docstring 提取

**文件**: `src/core/query-mappers/python-mapper.ts`
**操作**:
1. 新增辅助函数 `extractPythonDocstring(bodyNode: Parser.SyntaxNode | null): string | null`：
   - 遍历 bodyNode 的直接子节点
   - 找第一个 `expression_statement`，其第一个子节点为 `string`
   - 提取该 string 的文本，去引号（去掉 `"""` / `'''` / `"` / `'` 包裹）
   - 取第一行（换行前的内容），截断到 200 字符
2. 在 `_extractFunction` 中（return 之前），获取函数 body 节点：
   ```typescript
   const bodyNode = node.childForFieldName('body');
   jsDoc: extractPythonDocstring(bodyNode) ?? null,
   ```
3. 在 `_extractClass` 中，同样从 body 提取类级 docstring
4. 在 `_extractClassMembers` 的方法提取逻辑中，同样提取方法 docstring

---

## T3: BUG-D/E — README 场景提取优化

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**:

**子任务 T3a: 修复 `buildTargetUsers`**

问题：`corpus.readmes.flatMap((source) => extractParagraphs(source.text)).find(Boolean)` 取第一个非空段落，可能是 `# graphify`（标题行）或 `[English](README.md) | [简体中文]...`（导航链接行）。

修复：在 `buildTargetUsers` 末尾的 readme fallback 中，过滤掉"无意义"段落：
```typescript
const readmeParagraph = corpus.readmes
  .flatMap((source) => extractParagraphs(source.text))
  .find((para) => isDescriptiveParagraph(para));
```

新增 `isDescriptiveParagraph(text: string): boolean`:
- 排除 `#` 开头的标题
- 排除全是 markdown 链接语法的行（`[...](...)` 占 >60% 字符）
- 排除纯 HTML 行
- 文本长度 ≥ 30

**子任务 T3b: 修复 `buildCoreScenarios`**

在「无 current-spec → fallback issues/PRs」之间，新增「从 README 节提取」步骤：
```typescript
if (scenarios.length === 0) {
  scenarios.push(...extractScenariosFromReadme(corpus));
}
if (scenarios.length === 0) {
  // 原有 issues/PRs fallback
  for (const item of [...corpus.issues.slice(0, 2), ...corpus.pullRequests.slice(0, 2)]) {
    // 仅使用非 bug 类 issue
    if (isLikelyBugOrQuestion(item)) continue;
    ...
  }
}
```

新增 `extractScenariosFromReadme(corpus: ProductFactCorpus): ProductScenario[]`：
- 遍历 `corpus.readmes`
- 用 `parseMarkdownSections` 解析 sections
- 查找 `Usage`、`Features`、`Getting Started`、`Quick Start`、`Overview`、`使用方法`、`功能`、`快速开始` 等 section
- 从 section 中提取 list items 或段落，最多取 4 条
- 每条构建 `ProductScenario` with `confidence: 'medium'`, `inferred: true`, `sourceType: 'readme'`

---

## T4: BUG-F — Issue 类型过滤

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**:
1. 新增函数 `isLikelyBugOrQuestion(item: { title: string; labels: string[] }): boolean`：
   ```typescript
   function isLikelyBugOrQuestion(item: { title: string; labels: string[] }): boolean {
     const bugLabels = ['bug', 'question', 'invalid', 'wontfix', 'duplicate'];
     if (item.labels.some((l) => bugLabels.includes(l.toLowerCase()))) return true;
     const bugPrefixes = /^(fix|bug|error|broken|fails|crash|cannot|can't|doesn't|issue|problem)/i;
     return bugPrefixes.test(item.title.trim());
   }
   ```
2. 在 `buildFeatureBriefIndex` 的 `for (const issue of corpus.issues.slice(0, 3))` 前，过滤：
   ```typescript
   const featureIssues = corpus.issues.filter((issue) => !isLikelyBugOrQuestion(issue)).slice(0, 3);
   for (const issue of featureIssues) { ... }
   ```
3. PR 同样过滤（PR 标题/标签中含 `fix`、`hotfix`、`bugfix` 等的排除）

---

## T5: BUG-K — Mermaid 类型注释 strip

**文件**: `src/panoramic/generators/data-model-generator.ts`
**操作**:
在 `parseFieldDeclaration` 函数中，解析出 `typeStr` 后立即 strip 行内注释：
```typescript
// 位置：eqIdx > 0 分支
typeStr = afterColon.slice(0, eqIdx).trim();
// 新增：strip Python 行内注释（如 `str  # e.g. "tree_sitter_python"` → `str`）
typeStr = stripPythonInlineComment(typeStr);

// 位置：else 分支
typeStr = afterColon;
typeStr = stripPythonInlineComment(typeStr);  // 新增
```

新增辅助函数：
```typescript
function stripPythonInlineComment(typeStr: string): string {
  // 去除 # 后的注释（但不破坏 string 内部的 #）
  const hashIdx = typeStr.indexOf('#');
  return hashIdx >= 0 ? typeStr.slice(0, hashIdx).trim() : typeStr;
}
```

---

## T6: BUG-J — Python 文件事件方法集合分离

**文件**: `src/panoramic/generators/event-surface-generator.ts`
**操作**:
1. 新增 Python-specific 订阅方法集合：
   ```typescript
   // JS/TS-specific（不应用于 Python 文本扫描）
   const JS_SUBSCRIBER_METHODS = new Set(['on', 'once', 'addListener']);
   // Python-compatible 订阅方法
   const PY_SUBSCRIBER_METHODS = new Set(['subscribe', 'consume', 'listen']);
   ```
2. 在 `extractTextOccurrences` 中（Python 文件处理），将 `role` 判断改为使用 `PY_SUBSCRIBER_METHODS`：
   ```typescript
   const role = PUBLISHER_METHODS.has(methodName) ? 'publisher'
     : PY_SUBSCRIBER_METHODS.has(methodName) ? 'subscriber'
       : null;
   ```
3. 同步更新 `TEXT_EVENT_RE` 或在 Python 分支单独使用过滤后的正则

---

## T7: 测试更新

**新增测试（同一提交中包含）**:

1. **python-mapper docstring 测试**
   - 文件：`src/core/query-mappers/__tests__/python-mapper.test.ts`（如已存在则追加）
   - 测试：含 `"""docstring"""` 的函数/类，验证 `jsDoc` 字段非 null 且含第一行内容

2. **data-model-generator 行内注释测试**
   - 文件：相关 test 文件
   - 测试：`str  # e.g. "tree_sitter_python"` → `typeStr` 为 `str`

3. **event-surface Python 过滤测试**
   - 测试：Python 文件中的 `.on("click", ...)` 不被提取为事件

---

## 执行顺序

1. T1（BUG-A）— 最高优先级，修复后 BUG-B/H 自动消解
2. T5（BUG-K）— 简单，1-2 行改动
3. T6（BUG-J）— 简单，方法集合分离
4. T4（BUG-F）— 简单，issue 过滤
5. T3（BUG-D/E）— 中等，README 节解析
6. T2（BUG-C）— 中等，Python docstring 提取
7. T7 — 测试
