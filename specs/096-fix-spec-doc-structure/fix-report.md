# 问题修复报告

## 问题描述

Spec 文档结构对人类和机器都不友好：标题用相对路径、缺少概览、接口表格是 90 行无分组平板、代码块解析错误、baseline-skeleton 占文件 60%、章节顺序不利于快速浏览。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 标题显示 `../../../_reference/graphify/graphify` 而非项目名 | `module-spec.hbs:22` 直接用 `{{frontmatter.sourceTarget}}`，而 `sourceTarget` 是 `path.relative(baseDir, targetPath)` 生成的相对路径 |
| Why 2 | 为什么用相对路径作为显示名？ | `single-spec-orchestrator.ts:451` 的 `generateFrontmatter` 用 `path.relative` 生成 `sourceTarget`，frontmatter 和标题共用同一字段，没有区分"存储路径"和"显示名" |
| Why 3 | 为什么没有 TL;DR？ | `module-spec.hbs` 模板没有此章节；LLM prompt 也没有要求生成概览摘要 |
| Why 4 | 为什么代码块解析会断裂？ | `parseLLMResponse` 的正则 `^#{1,3}\s*` 会匹配代码块内的 `##` 标题行，导致代码块中的章节标题被当作分割点 |
| Why 5 | 为什么 baseline-skeleton 如此巨大？ | `spec-renderer.ts:98` 将完整 JSON 作为 HTML 注释写入，对含 90+ exports 的模块约 12000 字符 |

**Root Cause**: 模板层没有区分"机器用"和"人类用"的信息，所有字段直接从内部数据结构映射到 Markdown 输出。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `templates/module-spec.hbs` | L22 | `# {{frontmatter.sourceTarget}}` | 改用 displayName |
| `templates/module-spec.hbs` | L52-101 | 缺少 TL;DR，章节顺序固定 | 新增摘要、重排章节 |
| `src/generator/spec-renderer.ts` | L98 | baseline-skeleton 完整 JSON | 改为仅存 hash + 关键统计 |
| `src/core/llm-client.ts` | L508 | `^#{1,3}` 匹配代码块内标题 | 增加代码块内标记跳过 |
| `src/core/single-spec-orchestrator.ts` | L451 | sourceTarget 无 displayName | 新增 displayName 字段 |

### 同步更新清单
- 调用方: `single-spec-orchestrator.ts`（构建 frontmatter 时传入 displayName）
- 测试: 无需新增（渲染器测试已有，修改后验证通过即可）
- 文档: 无

## 修复策略

### 方案 A（推荐）：6 处精准修复

1. 新增 `frontmatter.displayName`（从 targetPath 提取最后一级目录名）
2. 模板标题改用 `{{frontmatter.displayName}}`
3. 模板新增 TL;DR 段落（由 LLM 的 intent 章节首段提取）
4. `parseLLMResponse` 增加代码块状态跟踪
5. baseline-skeleton 缩减为 hash + 统计摘要
6. 附录文件路径用短路径

## Spec 影响
- 无需更新现有 spec
