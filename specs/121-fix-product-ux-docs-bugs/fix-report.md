# Fix Report: product-ux-docs 4 个问题修复

## 修复概要

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**关联测试**: `tests/panoramic/product-ux-docs.test.ts`

---

## H1（HIGH）— `parseMarkdownSections` index=0 falsy

**问题定位**: 第 835 行（修复前）
```typescript
// 修复前
if (!current?.index) {
  continue;
}
```

**根因**: `RegExpMatchArray.index` 当 `##` 标题出现在文档第 0 字节时值为 `0`，`!0` 为 `true`，
导致第一个章节被错误跳过。所有第一行就是 `## 标题` 的文档（无前置 H1 标题）均受影响。

**修复**:
```typescript
// 修复后
if (current?.index == null) {
  continue;
}
```

**验证**: 新增测试 `parseMarkdownSections 正确解析以 ## 开头的第一个章节（index=0 不被 falsy 跳过）`，
确认 index=0 时产品概述章节内容被正确提取。

---

## M5（MEDIUM）— `normalizeNumber` 死代码

**问题定位**: 第 1065–1071 行（修复前）

**根因**: `normalizeNumber` 函数在 `product-ux-docs.ts` 中声明，但从未被调用。
通过 grep 确认同名函数仅在 `plugins/spec-driver/scripts/generate-adoption-insights.mjs` 中独立存在（无共享导入）。

**修复**: 删除整个 `normalizeNumber` 函数声明（7 行）。

---

## M6（MEDIUM）— `generatedDocs` 参数声明但未使用

**问题定位**: 第 128 行接口声明，第 1138 行 `extract()` 调用点（修复前）

**根因**: `GenerateProductUxDocsOptions.generatedDocs: BatchGeneratedDocSummary[]` 在接口中声明，
`extract()` 传入空数组，但 `generateProductUxDocs()` 及所有下游函数完全不读取该字段，是死接口字段。

**修复**:
1. 从 `GenerateProductUxDocsOptions` 接口删除 `generatedDocs` 字段
2. 删除 `extract()` 中 `generatedDocs: []` 传入
3. 删除 `import type { BatchGeneratedDocSummary }` 死导入
4. 更新 `src/panoramic/batch-project-docs.ts` 调用点（删除 `generatedDocs` 传参）
5. 更新 `tests/panoramic/product-ux-docs.test.ts` 3 处测试调用点

---

## M7（MEDIUM）— `corpus.commits` 收集但未使用

**问题定位**: `buildProductFactCorpus()` 收集 commits，但 `buildProductOverview()` 等函数不读取

**方案选择**: 将 commit subjects 加入 overview summary 的 fallback evidence。

**修复**: 在 `collectOverviewParagraphs()` 末尾，当 current-spec 与 README 提取的段落不足 2 条时，
以近期 5 条 commit subject 拼接为补充摘要段落插入。

```typescript
if (paragraphs.length < 2 && corpus.commits.length > 0) {
  const commitSummary = corpus.commits
    .slice(0, 5)
    .map((commit) => commit.subject)
    .filter((subject) => subject.length >= 10)
    .join('；');
  if (commitSummary.length >= 20) {
    paragraphs.push(`近期变更摘要（基于 git 提交记录推断）：${commitSummary}`);
  }
}
```

---

## 验证结果

- 命令: `npm run build`
- 退出码: 0
- 输出摘要: TypeScript 编译零错误

- 命令: `npx vitest run tests/panoramic/product-ux-docs.test.ts`
- 退出码: 0
- 输出摘要: 4 tests passed（含新增 H1 回归测试）

- 命令: `npx vitest run`（全量）
- 退出码: 0（性能测试抖动排除，单独运行通过）
- 输出摘要: 1579 tests passed, 1 flaky（community-analysis 性能测试机器负载抖动，与本次修改无关）

## 变更文件

- `src/panoramic/pipelines/product-ux-docs.ts` — 4 处修复
- `src/panoramic/batch-project-docs.ts` — 删除冗余 `generatedDocs` 传参
- `tests/panoramic/product-ux-docs.test.ts` — 删除 3 处冗余字段 + 新增 1 个 H1 回归测试
