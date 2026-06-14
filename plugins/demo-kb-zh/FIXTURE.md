# demo-kb-zh — 中文 demo fixture（Apache ECharts 文档）

本目录是 Feature 190 `scaffold-kb` 的**中文 demo fixture**，用作一个**公开开源 SDK 文档**的代表性样例，用于演示 / 验证 `scaffold-kb build` 把中文 Markdown 文档目录构建为 `kb/`（`doc-graph.json` + `chunks.sqlite` FTS5 全文检索），重点验证中文分词与含点号配置项符号（如 `xAxis.axisLabel.formatter`）的检索能力。

> 本 fixture 仅作通用「开源 SDK 文档」演示用途，不绑定任何客户、行业或专属场景。Apache ECharts 是一个公开的 Apache-2.0 开源项目，在此作为「某个公开 SDK」的一个实例呈现。

## 来源

- 上游项目：Apache ECharts（开源可视化图表库）
- 文档站（中文）：https://echarts.apache.org/zh/index.html
- 教程页源码仓库：https://github.com/apache/echarts-doc （`zh/tutorial/` 目录，原始 Markdown）
- 配置项数据：https://echarts.apache.org/zh/documents/option-parts/option.*.json （官方文档站发布的配置项手册结构化数据）
- License：**Apache License 2.0**（https://github.com/apache/echarts/blob/master/LICENSE ；文档仓库 apache/echarts-doc 同为 Apache-2.0）

## 页数与规模

- 页数：**13 页**（`source-docs/*.md`）
  - 8 篇教程页：快速上手、基础概念、初始化 `echarts.init` / `setOption`、样式、数据集 `dataset`、视觉映射、事件、异步更新、Canvas/SVG 渲染选择
  - 5 篇配置项页：`option.xAxis` / `option.yAxis` / `option.series`（折线）/ `option.tooltip` / `option.legend`，含大量点号配置项符号（如 `xAxis.axisLabel.formatter`、`tooltip.formatter`、`series.label.formatter`）
- 规模：远小于 50 页上限；构建出的 `chunks.sqlite` 远小于 10MB 上限

## 来源页清单（slug ← 上游来源）

教程页（apache/echarts-doc 仓库 `zh/tutorial/`，对应 echarts.apache.org/zh 渲染页）：

| 本地文件 | 上游来源 |
|---------|---------|
| `getting-started.md` | https://echarts.apache.org/handbook/zh/get-started/ （源：`zh/tutorial/getting-started.md`） |
| `basic-concepts.md` | 源：`zh/tutorial/basic-concepts-overview.md` |
| `styling.md` | 源：`zh/tutorial/styling.md` |
| `dataset.md` | 源：`zh/tutorial/dataset.md` |
| `visual-map.md` | 源：`zh/tutorial/visual-map.md` |
| `event.md` | 源：`zh/tutorial/event.md` |
| `dynamic-data.md` | 源：`zh/tutorial/dynamic-data.md` |
| `renderer.md` | 源：`zh/tutorial/renderer.md` |

配置项页（数据源：官方文档站 option-parts JSON）：

| 本地文件 | 上游来源 |
|---------|---------|
| `option-xaxis.md` | https://echarts.apache.org/zh/option.html#xAxis （数据：`option-parts/option.xAxis.json`） |
| `option-yaxis.md` | https://echarts.apache.org/zh/option.html#yAxis （数据：`option-parts/option.yAxis.json`） |
| `option-series-line.md` | https://echarts.apache.org/zh/option.html#series-line （数据：`option-parts/option.series-line.json`） |
| `option-tooltip.md` | https://echarts.apache.org/zh/option.html#tooltip （数据：`option-parts/option.tooltip.json`） |
| `option-legend.md` | https://echarts.apache.org/zh/option.html#legend （数据：`option-parts/option.legend.json`） |

## 处理说明

- 教程页正文取自上游原始中文 Markdown，保留真实中文术语、代码示例与符号（`echarts.init`、`setOption`、`option.series`、`dataset.transform` 等）。仅清理了文档构建模板语法：`{{ target/use }}` 指令、`${...}` 站点变量、站内 `.html#` 链接折叠为可读锚文本（点号符号原样保留），代码块内 HTML/JS 示例完全未改动。
- 配置项页由官方 option-parts JSON 的真实中文描述（`desc` 字段）转换为 Markdown：每个配置项以完整点号路径（如 `option.xAxis.axisLabel.formatter`）作为小节标题，描述中的 HTML（`<code>` / `<pre>` 代码块 / `<table>` 表格 / 列表 / 引用）转为对应 Markdown。内容为官方原文，未编造任何 API。
- 每个文件首行为 `# <中文标题>`，供 `scaffold-kb` 提取 doc title。

## 构建命令

```bash
npx tsx src/cli/index.ts scaffold-kb build \
  --dir plugins/demo-kb-zh/source-docs \
  --output plugins/demo-kb-zh/kb
```

产物：`kb/doc-graph.json` + `kb/chunks.sqlite`。
