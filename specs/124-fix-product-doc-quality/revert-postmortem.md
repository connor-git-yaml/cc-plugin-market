# Fix 124 Revert Postmortem

## 背景
Fix 124 原计划修复 `src/panoramic/pipelines/product-ux-docs.ts` 三个产品文档质量问题（HTML 污染、标题硬截断、用户旅程模板机械化），于 commit `0ae2316` 落地，随后双路对抗性审查（Codex `b8o603iot` + Claude sub-agent `a488237593a4f902b`）**独立交叉印证**三个致命方向性错误，判决 **no-ship**，已于 commit `c607d54` 整体 revert。

## Revert 依据：双路审查共识

### C1 — `inferJourneyOutput` 根本没解决病因

fix-report Why 4 正确识别根因：**"未利用 scenario.summary/evidence"**。
但实际实现**绕开根因**，继续用六个硬编码模板字符串 + 关键词正则分类。

**Codex 在本仓库 `specs/products/*/current-spec.md` 上的实证**：

| 真实场景 | 推断输出 | 问题 |
|---------|---------|------|
| `批量项目文档化` | "数据已同步或索引更新完成，可供后续查询。" | 错误（batch ≠ sync/index） |
| `仓库治理`（summary 含 `repo:sync`） | 同上 | 错误（误匹配 sync 关键词） |
| `产品与 UX 文档补全` | 默认 fallback | 丢失信息（源文本明显描述产品文档生成） |

**Claude 实证**：Khoj 4 条 feature 修复后 3 条仍同文（`share` 误匹配 chat）；Graphify 4 条 feature（`Parse AST`、`Build call graph` 等）全部 fallback，雷同率 **100% → 100%**，修复无增量。

**双路判定**：从"一个通用模板"换成"六个关键词桶 + 一个通用模板"——旧模板的错是**显眼的**，新方案的错**看起来具体却是错的**，更糟。

### C2 — HTML strip 正则吞真实内容

`replace(/<[^>]+>/g, '')` 不限于 HTML，所有尖括号内容都被吞。

**Codex 在本仓库 Markdown 中找到的受害内容**：

| 原文 | strip 后 | 来源 |
|------|---------|------|
| `specs/<feature-id>/` | `specs//:` | `specs/products/reverse-spec/current-spec.md:97` |
| `DocumentGenerator<RuntimeTopologyInput, RuntimeTopologyOutput>` | `DocumentGenerator` | `specs/043-runtime-topology-ops/spec.md:104` |
| `reverse-spec generate <target> --deep` | `reverse-spec generate  --deep` | `README.md:550` |

**Claude 补充**：`<details>`/`<summary>` 语义节点粗暴剥掉；HTML entity（`&lt;`、`&amp;`）未解码；代码块中 `<` 不分辨被吞。

**判定**：此 fix **主动把产品文档事实源在 extractParagraphs 阶段破坏**，比修复前的 HTML 残留更隐蔽（HTML 残留是显眼的噪声，被吞的泛型/占位符是**悄无声息的数据损坏**）。

### C3 — CJK 处理全线失效

**双路共同发现**：
- `truncateAtWordBoundary` 在无空格中文上 `lastIndexOf(' ', maxLen)` 返回 -1，退化为 `slice(0, maxLen)` 硬截断——**函数名误导**；
- `isDescriptiveParagraph` 的 `wordCount = split(/\s+/).length` 在中文段落下 = 1，配合任何 markdown link 都判为"纯链接"过滤掉（Codex 举例 `详情见[文档](...)` 被丢弃）；
- Spectra 本仓库 `specs/products/*/current-spec.md` 是长无空格中文——**修复对主要消费语料完全无效**。

## 为何整体 revert 而非增量修正

原 fix-report 的 Why 4/5 已识别真正根因（未利用 summary/evidence + 三处硬编码），但方案选择是**症状驱动修复**（针对表面模板写更多模板），没有对准根因。继续打补丁会累积债：
- HTML strip 修正要改为 block-level AST 解析，不是加白名单；
- `inferJourneyOutput` 要删掉关键词桶，重新用 evidence-backed mapping 或 LLM 语义化；
- CJK 支持要改用 `Intl.Segmenter`，不是修 ASCII 空格回退。

这三项每一项都需要重新设计，而非打补丁——因此选择**整体 revert + spec-driver-story 重新做 feature**。

## 测试层面的教训

Fix 124 新增三个测试全部是"通过式正向用例"，无法锁定行为：
- "词边界截断" assertion `not.toMatch(/[a-zA-Z0-9]$/)` 在全中文标题下天然满足——**改回 slice 也能通过**；
- "chat 旅程" 只检查 `toContain('AI 助手')`，未来改成 `() => 'AI 助手说你好'` 也通过；
- HTML 测试只覆盖 `<p>/<div>/<img>/<h2>`，未覆盖 `<details>` / `< 5%` / `Array<T>` / entity。

**教训**：对抗性测试（锁定关键不变量 + 反向用例）是必须的，尤其在用关键词/正则做语义近似时。

## 审查制品引用
- Codex adversarial review output：`/private/tmp/claude-501/.../tasks/b8o603iot.output`（判决 `needs-attention / No-ship`）
- Claude sub-agent review output：`/private/tmp/claude-501/.../tasks/a488237593a4f902b.output`（判决"方向部分正确但力度不够"）
- 原 Fix 124 commit：`0ae2316`（已被 `c607d54` revert）

## 后续计划
- 开 Fix 125 / feature 通过 `spec-driver-story` 重做产品文档语义化，把"evidence-backed mapping"和"LLM 语义增强"作为一等公民，而非事后打补丁。
