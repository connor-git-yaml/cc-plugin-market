# 问题修复报告

## 问题描述
对 Graphify（Python 工具）和 Khoj（LLM 多语言项目）的端到端测试发现 product-ux-docs 生成器存在三个产品文档质量问题：
1. HTML 标签污染产品定位字段（Khoj README 以 `<p><img>` 开头）
2. 场景标题 `.slice(0, 80)` 硬截断，语义不完整
3. 用户旅程"消费输出"步骤永远是同一静态字符串，无实际信息价值

## 5-Why 根因追溯

### 问题一：HTML 污染

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `product-overview.md` 产品定位显示 `<div>`/`<p>`/`<img>` HTML 标签 | `collectOverviewParagraphs()` 将 README 原文段落直接加入摘要列表 |
| Why 2 | `collectOverviewParagraphs` 为何不过滤 HTML | 它调用 `extractParagraphs(source.text).slice(0,2)` 但未用 `isDescriptiveParagraph` 过滤 |
| Why 3 | `isDescriptiveParagraph` 已能检测 HTML 开头为何未被用 | 该函数被 `buildTargetUsers` 调用，但 `collectOverviewParagraphs` 独立实现未复用 |
| Why 4 | 两处各自实现过滤逻辑 | 历史分别迭代导致过滤逻辑碎片化 |
| Why 5 | 未被测试覆盖 | 现有测试未用 HTML-heavy README fixture |

**Root Cause**: `collectOverviewParagraphs` 未对提取的段落应用 `isDescriptiveParagraph` 过滤，加之 `extractParagraphs` 不做 HTML strip，HTML-heavy README 的前两段直接进入产品定位。
**Root Cause Chain**: HTML 污染 → `collectOverviewParagraphs` 无 isDescriptiveParagraph 过滤 → extractParagraphs 不 strip HTML → 无 HTML-heavy 测试覆盖

### 问题二：标题硬截断

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 场景标题被截断为 "Chat with any local or online LLM (e.g llama3..." | `extractScenariosFromReadmeCorpus` 第 734 行 `title.slice(0, 80)` |
| Why 2 | 为何用固定 80 字符 | 初始实现防止过长标题影响渲染，但未考虑单词/句子边界 |
| Why 3 | 为何未截到词边界 | 没有 `truncateAtWordBoundary` 工具函数 |

**Root Cause**: `title.slice(0, 80)` 不考虑单词边界，在单词中间截断。
**Root Cause Chain**: 标题截断 → `slice(0, 80)` 硬截断 → 无词边界工具函数

### 问题三：用户旅程模板机械化

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | "消费输出"步骤永远是"使用生成的文档、接口说明..." | 第 338-341 行硬编码字符串 |
| Why 2 | "触发场景"步骤永远是 "${actor} 识别当前任务需要：${title}" | 第 328-331 行模板 |
| Why 3 | `outcome` 永远是 "完成 ${title} 对应的关键任务..." | 第 325 行模板 |
| Why 4 | 为何这三处都是模板 | 初始实现未设计从 scenario.summary/evidence 推断具体输出类型 |
| Why 5 | 未被质量审查发现 | 测试只检查字段存在，不检查内容差异度 |

**Root Cause**: `buildUserJourneys` 步骤内容硬编码为与 scenario 无关的静态字符串，无视 `scenario.summary` 中已有的具体描述。
**Root Cause Chain**: 旅程内容无意义 → 三步全部硬编码 → 未利用 scenario.summary/evidence

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/panoramic/pipelines/product-ux-docs.ts` | L546 | `extractParagraphs(source.text).slice(0,2)` | 加 `isDescriptiveParagraph` + HTML strip 过滤 |
| `src/panoramic/pipelines/product-ux-docs.ts` | L734 | `title.slice(0, 80)` | 改为 `truncateAtWordBoundary(title, 80)` |
| `src/panoramic/pipelines/product-ux-docs.ts` | L325,329,338 | 硬编码旅程步骤字符串 | 从 `scenario.summary` 推断具体步骤描述 |

### 类似模式（需评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/panoramic/pipelines/product-ux-docs.ts` | L735 | `summary.slice(0, 200)` | 安全（200 字符足够，且 summary 通常为完整段落） |
| `src/panoramic/pipelines/product-ux-docs.ts` | L604-624 | `buildTargetUsers` 已用 `isDescriptiveParagraph` | 安全 |

### 同步更新清单
- 测试: `tests/panoramic/product-ux-docs.test.ts` — 新增 HTML-heavy README fixture 测试，新增截断词边界测试，新增旅程步骤内容差异度测试
- 新增工具函数: `truncateAtWordBoundary(text, maxLen)` — 在文件内部添加

## 修复策略

### 方案 A（推荐）

**A1 — HTML 过滤**：
在 `collectOverviewParagraphs` 的段落过滤 pipeline 末端加 `isDescriptiveParagraph` 过滤，同时在 `extractParagraphs` 中对每段做 HTML tag strip（`text.replace(/<[^>]+>/g, '').trim()`），保留 Markdown 内容。

**A2 — 词边界截断**：
新增私有工具函数 `truncateAtWordBoundary(text: string, maxLen: number): string`，在 `maxLen` 处向左找最近空格截断，必要时加 `…`。替换所有 `title.slice(0, 80)`。

**A3 — 旅程步骤改善**：
- `触发场景`: 改为 `${actor} 需要：${truncateAtWordBoundary(scenario.summary || scenario.title, 100)}`
- `执行关键动作`: 保持使用 `detail`（已是 `scenario.summary || scenario.title`），无需改动
- `消费输出`: 改为根据 scenario title 关键词推断输出类型（如含 "chat"/"对话" → "获得 AI 助手的回答"；含 "export"/"导出" → "获得导出的文件或报告"；默认 → "查看生成结果并继续后续工作"）
- `outcome`: 改为 `${actor} 完成了 ${truncateAtWordBoundary(scenario.title, 50)}，并可继续下一步工作。`

### 方案 B（备选）
只做 A1 + A2，A3 保持现状（标注 `[推断]` 已足够透明）。风险低但改善程度有限。

## Spec 影响
无需更新 spec 文件。
