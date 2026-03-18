# API 契约: 架构索引生成器多语言增强

**模块**: `src/generator/index-generator.ts` + `templates/index-spec.hbs`
**Feature**: 031-multilang-mixed-project

## 接口定义

### generateIndex()（签名扩展）

```typescript
/**
 * 生成项目级架构索引
 *
 * @param specs - 所有已生成的 ModuleSpec
 * @param graph - 项目 DependencyGraph（或合并后的图）
 * @param languageStats - 完整扫描的语言统计（可选）
 * @param processedLanguages - 本次实际处理的语言列表（可选）
 * @returns ArchitectureIndex
 */
export function generateIndex(
  specs: ModuleSpec[],
  graph: DependencyGraph,
  languageStats?: Map<string, LanguageFileStat>,
  processedLanguages?: string[],
): ArchitectureIndex;
```

### ArchitectureIndex（扩展）

```typescript
export interface ArchitectureIndex {
  frontmatter: IndexFrontmatter;
  systemPurpose: string;
  architecturePattern: string;
  moduleMap: ModuleMapEntry[];
  crossCuttingConcerns: string[];
  technologyStack: TechStackEntry[];
  dependencyDiagram: string;
  outputPath: string;
  languageDistribution?: LanguageDistribution[];  // 新增
}
```

## 行为契约

### languageDistribution 填充规则

| 条件 | 行为 |
|------|------|
| `languageStats` 未传入或为 undefined | `languageDistribution` 为 undefined |
| `languageStats` 包含 1 种语言 | `languageDistribution` 为 undefined（FR-008：单语言不展示） |
| `languageStats` 包含 >= 2 种语言 | `languageDistribution` 填充为 `LanguageDistribution[]` |

### LanguageDistribution 计算规则

```typescript
function buildLanguageDistribution(
  languageStats: Map<string, LanguageFileStat>,
  specs: ModuleSpec[],
  processedLanguages?: string[],
): LanguageDistribution[] {
  const totalFiles = Array.from(languageStats.values())
    .reduce((sum, s) => sum + s.fileCount, 0);

  return Array.from(languageStats.entries()).map(([adapterId, stat]) => {
    // 模块数：统计 specs 中 frontmatter.language === adapterId 的数量
    const moduleCount = specs.filter(s => s.frontmatter.language === adapterId).length;

    // 占比：该语言文件数 / 总文件数 * 100
    const percentage = totalFiles > 0
      ? Math.round(stat.fileCount / totalFiles * 1000) / 10
      : 0;

    // 是否本次处理
    const processed = processedLanguages
      ? processedLanguages.includes(adapterId)
      : true;  // 无过滤时，所有语言均为已处理

    return {
      language: adapterId,  // 后续可映射为显示名称
      adapterId,
      fileCount: stat.fileCount,
      moduleCount,
      percentage,
      processed,
    };
  });
}
```

### Handlebars 模板契约

**index-spec.hbs 新增 section**（位于"模块映射"和"依赖关系图"之间）:

```handlebars
{{#if languageDistribution}}

## 语言分布

| 语言 | 文件数 | 模块数 | 占比 | 本次处理 |
|------|--------|--------|------|---------|
{{#each languageDistribution}}
| {{language}} | {{fileCount}} | {{moduleCount}} | {{percentage}}% | {{#if processed}}是{{else}}否{{/if}} |
{{/each}}

{{/if}}
```

**渲染规则**:
- `{{#if languageDistribution}}` 确保单语言项目不渲染此 section
- 表格按文件数降序排列
- `processed` 列在无 `--languages` 过滤时全部为"是"

### 依赖关系图的多语言展示

当存在多种语言的依赖图时，在 Mermaid 章节按语言分别展示：

```handlebars
## 依赖关系图

{{#each dependencyDiagrams}}
### {{language}} 依赖关系

```mermaid
{{{mermaidSource}}}
```

{{/each}}
```

**注意**: 这需要 `ArchitectureIndex` 将 `dependencyDiagram` 从单一字符串扩展为按语言的数组结构。但为保持向后兼容，建议：
- 单语言项目：`dependencyDiagram` 保持原格式（单一字符串）
- 多语言项目：将多语言 Mermaid 图拼接为一个字符串，用注释分隔

## 向后兼容保证

| 场景 | 行为 |
|------|------|
| `generateIndex(specs, graph)` — 不传 languageStats | 与现有行为完全一致 |
| 纯 TypeScript 项目 | 不展示语言分布 section |
| 现有模板渲染 | `{{#if languageDistribution}}` 为 falsy 时跳过整个 section |

## 调用方变更

| 调用方 | 当前调用 | 变更后调用 |
|--------|---------|-----------|
| `batch-orchestrator.ts` | `generateIndex(specs, graph)` | `generateIndex(specs, mergedGraph, languageStats, processedLanguages)` |
