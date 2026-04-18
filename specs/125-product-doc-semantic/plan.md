# Implementation Plan: 产品文档语义化增强

**Branch**: `125-product-doc-semantic`
**Spec**: [spec.md](./spec.md)
**Checklist**: [checklists/requirements.md](./checklists/requirements.md) — 全部 12 项通过

## 技术栈

- TypeScript 5.x / Node.js 20+
- Vitest 单元测试
- Unicode：使用 `Intl.Segmenter`（Node.js 18+ 原生支持）
- Markdown 解析：复用现有 `marked` 库（package.json 已含）进行 block-level HTML 识别；若 marked 不够用则用手写 state machine
- 零新增重量级依赖（不引入 `sanitize-html`、`jsdom`）

## 架构决策

### D1：evidence-backed mapping 是纯数据转换，不引入外部事实源

`buildUserJourneys` 当前已有 `scenario.summary`、`scenario.evidence[]`、`scenario.title` 三份事实。修复方案只需**重新排序**使用这些已有字段的优先级：
1. 优先从 `scenario.summary` 提取最后一句作为"消费输出"（结果句最接近 outcome 语义）
2. summary 不够时从 `scenario.evidence[0].excerpt` 提取
3. 都不可用时用简洁 fallback（不是预定义桶分类）

这个设计**删除**了 Fix 124 的 `inferJourneyOutput` 六模板函数，换成一个纯提取函数 `deriveOutcomeFromScenario(scenario): string`。

### D2：HTML 净化改为两层，区分"块级 HTML"和"行内尖括号"

- **第一层**（block-level strip）：只在 extractParagraphs 的段落级别，用 `/^\s*<(?:p|div|img|br|hr|h[1-6]|details|summary|table|iframe)[\s\S]*?<\/\1>|^\s*<(?:p|div|img|br|hr|h[1-6])[^>]*\/?>/i` 匹配**行首锚定**的 HTML block（含自闭合标签），替换为空字符串或内部文字内容。
- **第二层**（不做）：行内 `<...>` 保持原样。这样：
  - `Array<T>` / `<target>` / `<feature-id>` / `a < b` 全部保留
  - `<p align="center"><img ...></p>` 仅在行首被剥除
  - `<details><summary>点击</summary>内容</details>` → 提取 summary 内容 + details 内容
- 同时解码 `&lt;` `&gt;` `&amp;` `&quot;` `&#xx;` 实体

### D3：CJK 处理使用 `Intl.Segmenter`

- 新增 `segmentText(text, granularity='word'|'sentence')` 工具函数
- `truncateAtNaturalBoundary(text, maxLen)` 用 `Intl.Segmenter({ granularity: 'word' })` 找最近词/句边界
- `isDescriptiveParagraph` 改为：`linkCharCount / totalCharCount > 0.5` 判纯链接（基于字符，不是 word count）

### D4：测试策略 — 对抗性 + 真实 fixture

- 所有测试 fixture 使用 Spectra 本仓库真实内容作为 regression 数据（`specs/products/*/current-spec.md`）
- 新增对抗性 fixtures：HTML-heavy README、中英混排、`Array<T>` / `<target>` / `<details>`、长中文段落 + markdown link
- assertions 锁定**语义不变量**（字符存在、雷同率、边界落点）而非字符串相等

## 文件改动

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/panoramic/pipelines/product-ux-docs.ts` | 修改 | 所有实现变更集中于此 |
| `src/panoramic/utils/text-segmenter.ts` | 新建 | Unicode 感知的文本工具函数（segmentText, truncateAtNaturalBoundary, isLinkHeavyParagraph） |
| `src/panoramic/utils/html-sanitizer.ts` | 新建 | block-level HTML 识别 + entity 解码 |
| `tests/panoramic/product-ux-docs.test.ts` | 修改 | 补充 HTML-heavy / CJK / 尖括号 / 雷同率 fixtures |
| `tests/panoramic/utils/text-segmenter.test.ts` | 新建 | 工具函数专项测试 |
| `tests/panoramic/utils/html-sanitizer.test.ts` | 新建 | HTML 工具专项测试 |

## 降级路径

- 无 `Intl.Segmenter`（极老 Node）：fallback 到简单 regex 分词 + 标点边界识别
- Story 4（LLM 增强）不实现，留接口 hook（`deriveOutcomeFromScenario` 函数签名预留 `enhancer?: (s: Scenario) => Promise<string>`）
