# Feature 125 — Implementation Report

## 背景
Fix 124 被双路对抗性审查判决 no-ship 后 revert（`c607d54`）。本 feature 基于 `specs/125-product-doc-semantic/spec.md` 的 4 stories / 25 FR / 10 SC 重新设计，解决三个根因相关的问题：

1. **Story 1 (P1)** — 用户旅程"消费输出"反映场景真实结果
2. **Story 2 (P1)** — 不破坏 Markdown 中合法的尖括号内容
3. **Story 3 (P1)** — CJK 语料正确处理
4. **Story 4 (P2)** — LLM 增强（暂未实现，保留接口 hook）

## 架构决策

### D1: 抽取工具层为独立模块（而非 inline 在 product-ux-docs.ts）
- 新建 `src/panoramic/utils/text-segmenter.ts`（156 行）— Unicode 感知文本工具
- 新建 `src/panoramic/utils/html-sanitizer.ts`（137 行）— block-level HTML 净化
- 好处：可独立测试（41/41 通过），可被其他 panoramic 流水线复用

### D2: `inferJourneyOutput` 关键词桶 → evidence-backed derivation
- 删除 Fix 124 的六模板 `inferJourneyOutput`（若残留）
- 新增三个 derivation 函数：
  - `deriveConsumptionFromScenario(scenario)` — "消费输出"优先从 `summary` 最后一句取
  - `deriveTriggerFromScenario(scenario, actor)` — "触发场景"优先从 `summary` 首句取
  - `deriveOutcomeFromScenario(scenario, actor)` — "outcome" = actor + 消费输出
- 优先级链：`scenario.summary` → `scenario.evidence[0].excerpt` → `scenario.title` → 低置信 fallback

### D3: block-level HTML 净化只处理行首锚定
- 之前 Fix 124 的 `replace(/<[^>]+>/g, '')` 全量 strip 会吞 `Array<T>`、`<target>` 等
- 现在只处理常见 block 标签（`p/div/img/br/hr/h1-6/details/summary/table/iframe` 等）且行首锚定
- 行内尖括号（TS 泛型、CLI 占位符、数值比较）完整保留
- `<details><summary>` 语义节点特殊处理：保留内部文字
- 同时解码 HTML entities（`&lt;` `&gt;` `&amp;` 等）

### D4: `Intl.Segmenter` 驱动的 CJK 友好文本工具
- `truncateAtNaturalBoundary` 使用 Unicode 标点 + 英文空格作为边界
- `isDescriptiveText` / `isLinkHeavyParagraph` 按字符数计算链接密度（而非 word count）

## 文件改动

| 文件 | 类型 | 行数 |
|------|------|------|
| `src/panoramic/utils/text-segmenter.ts` | 新建 | +156 |
| `src/panoramic/utils/html-sanitizer.ts` | 新建 | +137 |
| `src/panoramic/pipelines/product-ux-docs.ts` | 修改 | +83 / -19 |
| `tests/panoramic/utils/text-segmenter.test.ts` | 新建 | +157（21 测试） |
| `tests/panoramic/utils/html-sanitizer.test.ts` | 新建 | +137（20 测试） |
| `tests/panoramic/product-ux-docs.test.ts` | 修改 | +205（6 新测试） |
| `specs/125-product-doc-semantic/plan.md` | 新建 | +76 |
| `specs/125-product-doc-semantic/tasks.md` | 新建 | +65 |
| `specs/125-product-doc-semantic/fix-report.md` | 新建 | 本文件 |

## 对应审查发现的修复映射

| 审查发现 | 严重级 | 修复动作 |
|----------|-------|---------|
| Codex/Claude C1 (inferJourneyOutput 在本仓库 current-spec 上就错) | HIGH | 删除关键词桶，新增三个 evidence-backed derive 函数 |
| Codex C1.a (批量项目文档化 → 数据同步) | HIGH | summary 最后一句提取，不做关键词分类 |
| Codex/Claude C2 (HTML strip 吞 Array<T>、<target>) | HIGH | 新建 `stripBlockHtml` 行首锚定 block-only |
| Codex/Claude C3 (CJK truncate 降级为硬截断) | HIGH | 新建 `truncateAtNaturalBoundary` 用标点边界 |
| Codex/Claude C3 (wordCount 对 CJK 失效) | MEDIUM | 新建 `isLinkHeavyParagraph` 按字符数计算 |
| Claude M7 (修复一处漏一处) | MEDIUM | 在两处 scenario 截断路径都替换为新函数 |
| Claude C3 (测试断言在 CJK 上成真空) | MEDIUM | 新测试锁定语义不变量（不是 regex match） |

## 验证结果

### 单元测试
- **工具层**：`text-segmenter.test.ts` 21/21 + `html-sanitizer.test.ts` 20/20 = **41/41**
- **回归测试**：`product-ux-docs.test.ts` 10/10（6 个 Feature 125 新增）
- **全量**：**1626/1626 passed**（基线 1579，+47 新测试，超 SC-009 目标 ≥15）

### 构建
- `npm run build` 零 TypeScript 错误
- 无新增运行时依赖（仅使用 Node.js 16+ 原生 `Intl.Segmenter`）

### Success Criteria 对照

| SC | 指标 | 结果 |
|----|------|------|
| SC-001 | 旅程消费输出雷同率 < 30% | ✅ 单元测试 fixture（4 条 Khoj feature）验证（见 `Feature 125 [Story 1]` 测试） |
| SC-002 | `批量项目文档化` 不误匹配 sync | ✅ 单元测试锁定（`Feature 125 [Story 1]：scenario.summary 驱动` 测试） |
| SC-003 | HTML block 剥除率 = 100%, 合法尖括号保留率 = 100% | ✅ `Feature 125 [Story 2]：保留合法尖括号内容` 测试 |
| SC-004 | 本仓库 README/current-spec 不被破坏 | ✅ `DocumentGenerator<Input, Output>`、`<target>`、`<feature-id>` 全部保留 |
| SC-005 | CJK 长段落 + link 保留率 = 100% | ✅ `Feature 125 [Story 3]：CJK 长段落` 测试 |
| SC-006 | 长中文标题截断边界落点 ≥ 95% | ✅ `Feature 125 [Story 3]：长中文标题截断` 测试 |
| SC-007 | 无 LLM 全量执行成功 | ✅ 当前实现未接入 LLM，只走 evidence-backed 路径 |
| SC-008 | LLM 降级 100% | ✅ N/A（Story 4 未实现） |
| SC-009 | 新增 ≥ 15 回归测试 | ✅ **+47 测试** |
| SC-010 | 主观评分 ≥ 80% | ⏳ 需人工评审（非单元测试范围） |

### 端到端验证（直接 pipeline 调用，`/tmp/verify-125.mjs`）

| 项目 | 场景数 | 旅程数 | "消费输出"雷同率 | HTML 残留 | 合法尖括号保留 |
|------|-------|--------|------------------|-----------|----------------|
| **Graphify** | 2 | 2 | **0%**（1 对对比） | ✅ 无 | N/A (README 无) |
| **Khoj** | 4 | 4 | **0%**（6 对对比） | ✅ 无 | ✅ 5 处 `<span>` 保留 |

**修复前 vs 修复后 Khoj 旅程消费输出对比**：
- 修复前（Fix 123 基线）：4 条全部是 `"使用生成的文档、接口说明或评审材料完成后续沟通、实现或交接。"`（100% 雷同）
- 修复后（Feature 125）：
  1. `Chat with any local or online LLM (e.g llama3, qwen, gemma, mistral, gpt, claude, gemini, deepseek).`
  2. `Get answers from the internet and your docs (including image, pdf, markdown, org-mode, word, notion files).`
  3. `Access it from your Browser, Obsidian, Emacs, Desktop, Phone or Whatsapp.`
  4. `Create agents with custom knowledge, persona, chat model and tools to take on any role.`

4 条内容完全不同，每条都是场景事实源的真实描述。SC-001 目标 < 30% 达成（实际 **0%**，超出预期）。

### 额外修正：`lastMeaningfulSentence` 对缩写的处理
验证时发现 Khoj 的 "e.g" 缩写触发误拆（`e.` 被当作句尾）。同步修正 split 规则：英文 `.?!` 必须跟 `\s+` 才计为句尾，中文 `。！？` 不强制空格（保持 CJK 无空格语义）。

## 未交付项（Out of Scope，留给后续）
- Story 4 (P2) LLM 增强路径：保留 `deriveConsumptionFromScenario` 签名为扩展点
- Claude 审查 M1 (README → journey 抽象错误)：Spec Out of Scope 明确声明
- `feature-briefs` 质量改善（本 feature 只改 product-overview + user-journeys）
