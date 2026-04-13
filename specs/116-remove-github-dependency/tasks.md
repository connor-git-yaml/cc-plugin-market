# 修复任务列表

## T1：删除 `ProductFactSourceType` 中的 issue/pull-request

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 从 `ProductFactSourceType` 联合类型中删除 `| 'issue'` 和 `| 'pull-request'`

---

## T2：删除 `GitHubItem` interface

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 删除 L153-161 整个 `interface GitHubItem { ... }` 块

---

## T3：删除 `ProductFactCorpus` 中的 issues/pullRequests 字段

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 从 `ProductFactCorpus` 接口中删除 `issues: GitHubItem[];` 和 `pullRequests: GitHubItem[];` 两行

---

## T4：清理 `buildProductFactCorpus`

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**:
1. 删除 `const gitHubFacts = collectGitHubFacts(projectRoot);` 这行
2. 在 `warnings` 数组中删除 `...gitHubFacts.warnings,`
3. 将 "未找到 current-spec.md" warning 中的 ` / issue/PR` 去掉
4. 将 "未找到本地设计说明" warning 中的 ` / issue/PR` 去掉
5. 在 `return {...}` 中删除 `issues: gitHubFacts.issues,` 和 `pullRequests: gitHubFacts.pullRequests,` 两行

---

## T5：清理 `buildProductOverview` evidence

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 在 `evidence = uniqueEvidence([...])` 数组中，删除末尾两行：
```
...corpus.issues.slice(0, 3).map((issue) => toGitHubEvidence(issue, issue.title, 'medium')),
...corpus.pullRequests.slice(0, 2).map((pr) => toGitHubEvidence(pr, pr.title, 'medium')),
```

---

## T6：删除 `isLikelyBugOrQuestion` 函数

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 删除 L393-399 整个 `isLikelyBugOrQuestion` 函数（包含其上方的 JSDoc 注释）

---

## T7：重写 `buildFeatureBriefIndex`

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**:
1. 删除 `featureIssues` 过滤和 for 循环（issue briefs 生成，L409-426）
2. 删除 `featurePrs` 过滤和 for 循环（PR briefs 生成，L428-445）
3. 删除 `if (briefs.length === 0)` 判断——journey 派生分支直接成为主路径（移除 if 条件，保留内部 for 循环）
4. 删除 GitHub 相关 warning（`corpus.issues.length === 0 && corpus.pullRequests.length === 0` 分支）
5. 修改 `confidence` 参数：从 `corpus.issues.length + corpus.pullRequests.length > 0` 改为 `corpus.currentSpecs.length > 0`
6. 更新 summary 文案：`共组织 ${briefs.length} 份 feature brief，基于 current-spec 与用户旅程派生。`
7. 更新 feature brief 的 `problem` 字段文案（删除对 issue/PR 的引用）：
   ```
   problem: `${scenario.actor} 需要更直接地完成"${scenario.title}"相关任务，当前缺少独立的功能说明文档。`
   ```

---

## T8：删除 `buildCoreScenarios` 中 GitHub 兜底分支

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 删除 L853-866 整个 `if (scenarios.length === 0)` GitHub 兜底块（从 `// GitHub issues/PRs 兜底（仅使用非 bug 类）` 注释到该 if 块结束的右括号）

---

## T9：删除三个 GitHub 相关函数

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 完整删除以下函数：
1. `collectGitHubFacts()` (L583-629)
2. `runGhJson()` (L631-679)
3. `resolveGitHubRepo()` (L681-697)

---

## T10：删除 `toGitHubEvidence` 函数

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 删除 L1086-1100 整个 `toGitHubEvidence` 函数

---

## T11：更新文案

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**:
1. `ProductUxDocsGenerator.description`：改为 `'基于 current-spec、README 与本地设计文档生成产品概览、用户旅程与 feature brief 文档'`
2. `buildUserJourneys` summary 文案：将 `issue/PR 事实` 改为 `本地设计文档事实`
3. 文件顶部 JSDoc 注释：更新第 4-5 行描述，去掉 GitHub issue/PR 相关引用

---

## T12：更新顶层 header 注释

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 更新文件顶部 JSDoc：
```typescript
/**
 * Product / UX fact ingestion
 *
 * Feature 060: 将 current-spec、README/设计说明与近期提交
 * 汇总为产品概览、用户旅程与 feature brief 文档。
 *
 * 设计原则：
 * 1. current-spec 是首选事实源；README / 设计文档为补充源
 * 2. 文档生成完全基于仓库内容，不依赖外部 API 或 CLI
 * 3. narrative 与 journey/brief synthesis 必须保留 evidence / confidence / inferred
 */
```

---

## T13：清理 import（可选）

**文件**: `src/panoramic/pipelines/product-ux-docs.ts`
**操作**: 检查 `import { spawnSync } from 'node:child_process'` 是否还有其他使用处：
- `collectRecentCommits` 仍使用 `spawnSync('git', ...)` → **保留** import
- 无需删除

---

## T14：测试更新

**文件**: `tests/panoramic/product-ux-docs.test.ts`（如存在）
**操作**:
1. 删除 mock `gh` CLI / `spawnSync` 的相关 mock setup
2. 删除 GitHub 相关 fixtures（issues 数组、pullRequests 数组）
3. 验证 `buildFeatureBriefIndex` 返回 journey 派生的 briefs（不依赖 GitHub mock）

---

## 执行顺序

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13（跳过）→ T14

**验证**:
```bash
npm run build
npx vitest run
```
