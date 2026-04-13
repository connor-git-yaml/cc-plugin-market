# 问题修复报告：移除 GitHub Issue/PR 数据依赖

## 问题描述

`product-ux-docs.ts` 通过 `gh` CLI 拉取 GitHub issue/PR 作为产品文档事实源。这种设计存在根本性的平台耦合问题：
- GitLab/Bitbucket 用户完全得不到数据
- 大多数用户未安装 `gh` CLI，或未登录
- 实际输出质量差：bug 报告变成"feature brief"
- 违背"文档应依赖代码和仓库内容"的设计原则

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何产品文档会引用 GitHub issue/PR？ | `buildFeatureBriefIndex`、`buildCoreScenarios`、`buildProductOverview` 三处均消费 `corpus.issues`/`corpus.pullRequests` |
| Why 2 | 为何引入 GitHub 数据源？ | Feature 060 spec（FR-006）明确将 GitHub 列为补充数据源，认为 issue/PR 能反映产品意图 |
| Why 3 | 为何 FR-006 的假设不成立？ | Issue 内容多为 bug 报告、操作问题，而非产品功能描述；且依赖外部平台 CLI 工具打破平台无关性 |
| Why 4 | 为何未在 060 设计时发现这个问题？ | 060 设计时没有对真实项目（如 Graphify Python 项目）做 e2e 验证，仅做了功能性设计 |
| Why 5 | 为何测试未捕获？ | 测试 mock 了 `gh` CLI 输出，没有验证实际输出质量；BUG-F 就是这个问题的直接表现 |

**Root Cause**: `product-ux-docs.ts` Feature 060 的 FR-006 在平台无关性和输出质量两个维度均不成立。GitHub issue/PR 不是可靠的产品文档事实源，应完全移除，改由 current-spec → README → 设计文档 → journey synthesis 四层构成完整的降级链。

**Root Cause Chain**: 产品文档质量差 → feature briefs 包含 bug 报告 → `buildFeatureBriefIndex` 依赖 GitHub issues → FR-006 假设 issues 反映产品意图 → 根因：Issue/PR 不是产品文档事实源

---

## 影响范围扫描

### 需要删除的代码

| 文件 | 位置 | 内容 |
|------|------|------|
| `product-ux-docs.ts` | L22-29 `ProductFactSourceType` | 删除 `'issue'` \| `'pull-request'` 两个联合类型成员 |
| `product-ux-docs.ts` | L153-161 `GitHubItem` interface | 完整删除 |
| `product-ux-docs.ts` | L174-175 `ProductFactCorpus` | 删除 `issues: GitHubItem[]` 和 `pullRequests: GitHubItem[]` 字段 |
| `product-ux-docs.ts` | L264-265 `buildProductFactCorpus` | 删除 `collectGitHubFacts` 调用及相关 warning |
| `product-ux-docs.ts` | L284-285 `buildProductFactCorpus` return | 删除 `issues`/`pullRequests` 字段 |
| `product-ux-docs.ts` | L299-300 `buildProductOverview` | 删除 issue/PR evidence 注入 |
| `product-ux-docs.ts` | L393-399 `isLikelyBugOrQuestion` | 完整删除（仅为 GitHub 过滤所用） |
| `product-ux-docs.ts` | L409-445 `buildFeatureBriefIndex` | 删除 issue/PR brief 生成循环，直接进入 journey 派生分支 |
| `product-ux-docs.ts` | L469-471 `buildFeatureBriefIndex` warnings | 删除 "未获取到 GitHub issue/PR" warning |
| `product-ux-docs.ts` | L483 `buildFeatureBriefIndex` confidence | 修复 confidence 不再依赖 issues.length + pullRequests.length |
| `product-ux-docs.ts` | L479 `buildFeatureBriefIndex` summary | 更新摘要文案 |
| `product-ux-docs.ts` | L853-866 `buildCoreScenarios` | 删除 GitHub issues/PRs 兜底分支 |
| `product-ux-docs.ts` | L583-629 `collectGitHubFacts` | 完整删除 |
| `product-ux-docs.ts` | L631-679 `runGhJson` | 完整删除 |
| `product-ux-docs.ts` | L681-697 `resolveGitHubRepo` | 完整删除 |
| `product-ux-docs.ts` | L1086-1100 `toGitHubEvidence` | 完整删除 |
| `product-ux-docs.ts` | L1227 `ProductUxDocsGenerator` description | 更新文案去掉"GitHub 数据" |

### 需要更新的 warning 文案

| 位置 | 现有文案 | 新文案 |
|------|---------|--------|
| `buildProductFactCorpus` | "未找到 current-spec.md，将更多依赖 README / 设计文档 / issue/PR 进行产品事实推断" | "未找到 current-spec.md，将更多依赖 README 与设计文档进行产品事实推断。" |
| `buildProductFactCorpus` | "未找到本地设计说明/roadmap Markdown，UX 旅程与 feature brief 将更多依赖 current-spec / issue/PR" | "未找到本地设计说明/roadmap Markdown，UX 旅程与 feature brief 将更多依赖 current-spec 与 README。" |

### 可保留/不变的代码

| 文件 | 内容 | 原因 |
|------|------|------|
| `product-ux-docs.ts` | `collectRecentCommits` + git `spawnSync` 调用 | commits 事实源保留（来自本地 git，非 GitHub API） |
| `product-ux-docs.ts` | `isDescriptiveParagraph` | README 段落过滤，保留 |
| `product-ux-docs.ts` | `extractScenariosFromReadme` | README 场景提取，保留 |
| `product-ux-docs.ts` | `buildFeatureBriefIndex` journey 派生分支 | 成为唯一的 brief 生成路径 |

### 同步更新清单

- 测试文件：删除 mock `gh` CLI 的 `spawnSync` mock，清理 GitHub 相关 fixtures
- `specs/060-product-ux-fact-ingestion/spec.md`：FR-006 标注为已废弃

---

## 修复策略

### 方案 A（推荐）：完全移除，不留降级路径

删除所有 GitHub 相关代码，feature briefs 完全由 journey 派生。这是最干净的方案，符合"文档依赖代码和仓库内容"的设计原则。

**新降级链**:
1. current-spec → 高置信度场景和用户画像
2. README Usage/Features 节 → 中等置信度场景
3. 设计文档 (design-doc) → 中等置信度补充
4. journey synthesis → 从上述场景派生 feature briefs

### 方案 B（备选）：保留接口但标注 deprecated

在 `ProductFactCorpus` 中保留 `issues`/`pullRequests` 字段但默认为空数组，允许外部注入。成本高，违背本次修复目的。不推荐。

---

## Spec 影响

- `specs/060-product-ux-fact-ingestion/spec.md`：FR-006 需要标注为已废弃
- 无需更新其他 spec 文件
