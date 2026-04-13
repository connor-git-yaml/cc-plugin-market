# 修复规划：Graphify 输出质量问题（BUG-A through BUG-L）

## 修复范围

**P0（必修）**: BUG-A、BUG-D/E — 这两个是严重的正确性问题，BUG-A 导致只生成 1 个 spec，BUG-D/E 导致产品文档完全无意义。
**P1（应修）**: BUG-C、BUG-F、BUG-K — 影响输出质量，修复成本低。
**P2（建议）**: BUG-J — 误提取事件，修复简单。
**P3（暂缓）**: BUG-L、BUG-I — 并发调度和 Python 异常模式，独立问题，后续单独处理。

## 修改文件清单

| 文件 | 操作 | 涉及 Bug |
|------|------|---------|
| `src/batch/batch-orchestrator.ts` | 修改（~2 行） | BUG-A |
| `src/core/query-mappers/python-mapper.ts` | 修改（新增 docstring 提取函数 + 6 处填充） | BUG-C |
| `src/panoramic/pipelines/product-ux-docs.ts` | 修改（README 节提取 + bug 过滤） | BUG-D/E/F |
| `src/panoramic/generators/data-model-generator.ts` | 修改（1 行 strip 注释） | BUG-K |
| `src/panoramic/generators/event-surface-generator.ts` | 修改（Python 排除 JS-only 方法） | BUG-J |

## 详细修复方案

### Fix 1: BUG-A — `batch-orchestrator.ts`

**位置**: `src/batch/batch-orchestrator.ts` 第 482 行

**改动**: 区分文件级模块（`group.files.length === 1`）和目录级模块：
```typescript
// Before:
const fullDirPath = path.join(resolvedRoot, group.dirPath);
const result = await generateSpec(fullDirPath, {

// After:
const targetPath = group.files.length === 1
  ? path.join(resolvedRoot, group.files[0]!)
  : path.join(resolvedRoot, group.dirPath);
const result = await generateSpec(targetPath, {
```

**回归风险**: 低。仅改变文件级模块的 target path；目录级模块行为不变。需要验证 `specPath = path.join(modulesDir, `${moduleName}.spec.md`)` 与 `generateSpec` 的输出文件名一致（两者都取 `path.basename(targetPath).replace(/\.[^.]+$/, '')`）。

### Fix 2: BUG-C — `python-mapper.ts`

**改动**: 添加 `extractPythonDocstring(bodyNode)` 辅助函数，从函数/类 body 的第一个 `expression_statement > string` 子节点提取 docstring。在 `_extractFunction`、`_extractClass`、`_extractClassMembers` 的相关位置替换 `jsDoc: null` 为 `jsDoc: extractPythonDocstring(...)`.

**注意**: 仅提取第一行/第一句（用于显示），过长的 docstring 截断到 200 字符。

### Fix 3: BUG-D/E — `product-ux-docs.ts`（`buildCoreScenarios`）

**改动**: 在现有 `currentSpecs` fallback 和 `issues/PRs` fallback 之间，新增 README 节提取：

```typescript
// 新增：从 README 的 Usage/Features/Getting Started 节提取
if (scenarios.length === 0) {
  for (const readme of corpus.readmes) {
    const readmeSections = parseMarkdownSections(readme.text);
    for (const key of ['Usage', 'Features', 'Getting Started', '使用', '功能']) {
      const section = readmeSections.get(key);
      if (!section) continue;
      const items = extractListItems(section);
      for (const item of items.slice(0, 3)) { ... }
    }
  }
}
```

同时修复 `buildTargetUsers` 中的 README 段落提取：跳过纯标题行（`#` 开头）和导航链接行（`[...](...)` 开头），取实际描述段落。

### Fix 4: BUG-F — `product-ux-docs.ts`（`buildFeatureBriefIndex`）

**改动**: 新增 `isLikelyBugOrQuestion(issue)` 检测函数：
- 检查 `issue.labels` 中是否含 `bug`、`question`、`invalid`、`wontfix` 标签（不区分大小写）
- 检查 `issue.title` 是否以 bug 指示词开头（`fix`, `bug`, `error`, `broken`, `fails`, `crash`）
- 过滤后 `featureCandidateIssues = corpus.issues.filter(i => !isLikelyBugOrQuestion(i))`

### Fix 5: BUG-K — `data-model-generator.ts`

**改动**: 在 `parseFieldDeclaration` 中，解析完 `typeStr` 后 strip 行内注释：
```typescript
// Strip Python inline comment from typeStr
typeStr = typeStr.replace(/\s*#.*$/, '').trim();
```

### Fix 6: BUG-J — `event-surface-generator.ts`

**改动**: 对 Python 文本文件，只使用 Python-appropriate 的方法集合（排除 JS-only 的 `on`/`once`/`addListener`）：
```typescript
const PY_SUBSCRIBER_METHODS = new Set(['subscribe', 'consume', 'listen']);
// 在 extractTextOccurrences 中使用 PY_SUBSCRIBER_METHODS 而非 SUBSCRIBER_METHODS
```

## 测试策略

1. `npm run build` — 类型检查
2. `npx vitest run` — 全量单元测试（确保 T040/T041 等现有测试不回归）
3. 新增 unit test：
   - `python-mapper.test.ts`：包含有 docstring 的 Python 函数，验证 jsDoc 字段非 null
   - `batch-orchestrator.test.ts`（或 module-grouper 集成）：验证文件级模块生成 `{filename}.spec.md` 而非 `{dir}.spec.md`
   - `data-model-generator.test.ts`：包含行内注释的字段类型，验证 typeStr 无注释

## 回归风险评估

| 修复 | 回归风险 | 说明 |
|------|---------|------|
| BUG-A | 低 | 仅影响 `files.length === 1` 的文件级模块，现有目录级模块不变 |
| BUG-C | 低 | jsDoc 仅在非空时使用，null 保持 fallback，仅改善输出 |
| BUG-D/E | 中 | README 节解析逻辑新增，可能引入误提取；需要 fallback 保护 |
| BUG-F | 低 | 只是过滤部分 issue，非 bug 类 issue 仍然处理 |
| BUG-K | 低 | 纯文本 strip，不影响类型逻辑 |
| BUG-J | 低 | 仅减少 Python 文件中的误报 |
