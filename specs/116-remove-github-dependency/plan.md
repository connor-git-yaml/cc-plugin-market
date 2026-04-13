# 修复规划：移除 GitHub Issue/PR 数据依赖

## 修改范围

**单文件**：`src/panoramic/pipelines/product-ux-docs.ts`  
**改动性质**：纯删除 + 少量文案修改，无新增逻辑  
**回归风险**：低（只减少事实源，不改变事实消费逻辑）

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/panoramic/pipelines/product-ux-docs.ts` | 删除 | GitHub 相关类型、函数、消费点（14 处变更） |
| `src/panoramic/pipelines/product-ux-docs.ts` | 更新 | 3 处 warning 文案 + 1 处 description 文案 |
| `specs/060-product-ux-fact-ingestion/spec.md` | 追加注记 | FR-006 标注为已废弃（可选，低优先级） |

## 详细修复方案

### 删除 1：`ProductFactSourceType` 联合类型

```typescript
// 删除前
export type ProductFactSourceType =
  | 'current-spec'
  | 'readme'
  | 'design-doc'
  | 'issue'          ← 删除
  | 'pull-request'   ← 删除
  | 'commit'
  | 'inference';

// 删除后
export type ProductFactSourceType =
  | 'current-spec'
  | 'readme'
  | 'design-doc'
  | 'commit'
  | 'inference';
```

### 删除 2：`GitHubItem` interface（L153-161）

整块删除。

### 删除 3：`ProductFactCorpus` 中的 issues/pullRequests 字段

```typescript
// 删除前
interface ProductFactCorpus {
  projectName: string;
  currentSpecs: CurrentSpecDoc[];
  readmes: MarkdownSource[];
  designDocs: MarkdownSource[];
  issues: GitHubItem[];       ← 删除
  pullRequests: GitHubItem[]; ← 删除
  commits: CommitFact[];
  warnings: string[];
}
```

### 删除 4：`buildProductFactCorpus` 调用点

```typescript
// 删除前
const gitHubFacts = collectGitHubFacts(projectRoot);  ← 删除
const commits = collectRecentCommits(projectRoot, 10);
const warnings = uniqueSorted([
  ...gitHubFacts.warnings,                             ← 删除
  ...(currentSpecs.length === 0
    ? ['未找到 current-spec.md，将更多依赖 README / 设计文档 / issue/PR 进行产品事实推断。']
    : []),
  ...
  ...(designDocs.length === 0
    ? ['未找到本地设计说明/roadmap Markdown，UX 旅程与 feature brief 将更多依赖 current-spec / issue/PR。']
    : []),
]);

return {
  ...
  issues: gitHubFacts.issues,       ← 删除
  pullRequests: gitHubFacts.pullRequests,  ← 删除
  ...
};
```

### 删除 5：`buildProductOverview` 中的 GitHub evidence

```typescript
// 删除前
const evidence = uniqueEvidence([
  ...collectEvidenceFromSources(corpus.currentSpecs, 'high'),
  ...collectEvidenceFromSources(corpus.readmes, 'medium'),
  ...collectEvidenceFromSources(corpus.designDocs, 'medium'),
  ...corpus.issues.slice(0, 3).map(...)     ← 删除
  ...corpus.pullRequests.slice(0, 2).map(...)  ← 删除
]);
```

### 删除 6：`isLikelyBugOrQuestion` 函数（L393-399）

整块删除。

### 修改 7：`buildFeatureBriefIndex` 重写

删除 issue/PR brief 生成循环（L409-445），直接走 journey 派生分支。同时：
- 删除 GitHub 相关 warnings (L469-471)
- 修复 confidence 计算：`currentSpecConfidence(corpus.currentSpecs.length > 0, briefs.length)`
- 更新 summary 文案

### 删除 8：`buildCoreScenarios` 中 GitHub 兜底分支（L853-866）

删除 `if (scenarios.length === 0) { for (const item of [...corpus.issues..., ...corpus.pullRequests...]) {...} }` 整块。

### 删除 9-11：三个 GitHub 相关函数

- `collectGitHubFacts()` (L583-629)
- `runGhJson()` (L631-679)
- `resolveGitHubRepo()` (L681-697)

全部整块删除。

### 删除 12：`toGitHubEvidence` 函数（L1086-1100）

整块删除。

### 更新 13：`ProductUxDocsGenerator` description

```typescript
// 删除前
readonly description = '基于 current-spec、README 与 GitHub 数据生成产品概览、用户旅程与 feature brief 文档';
// 删除后
readonly description = '基于 current-spec、README 与本地设计文档生成产品概览、用户旅程与 feature brief 文档';
```

### 更新 14：`buildUserJourneys` summary 文案

```typescript
// 删除前
[`基于 ${journeys.length} 条核心场景组织用户旅程，优先引用 current-spec、README 与可用的 issue/PR 事实。`]
// 删除后
[`基于 ${journeys.length} 条核心场景组织用户旅程，优先引用 current-spec、README 与本地设计文档事实。`]
```

## 回归风险评估

| 变更 | 风险 | 说明 |
|------|------|------|
| 删除 GitHub 事实源 | 低 | 对无 gh CLI 的用户输出不变；对有 gh CLI 的用户，feature briefs 改为 journey 派生（质量更高） |
| `buildFeatureBriefIndex` 重写 | 低 | journey 派生分支在原代码中已存在，只是从兜底变为唯一路径 |
| `buildCoreScenarios` 删除 GitHub 兜底 | 低 | README 场景提取已在 115 修复中实现，覆盖了这个 fallback |
| `ProductFactSourceType` 缩减 | 低 | 类型收窄，不影响现有代码消费（没有代码在运行时检查这个类型） |
