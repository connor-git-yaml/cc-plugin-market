---
feature: 107-multi-modal-extraction
created: 2026-04-12
phase: Phase 0 — 技术决策研究
---

# 技术决策研究：107 多模态工程制品提取

本文件记录规划阶段对所有不确定技术项的研究结论，每条决策包含结论、理由和已考察替代方案。

---

## 决策 1：模块组织方式

**问题**：多模态提取器应作为独立模块（`src/extraction/`）、注册进现有 `GeneratorRegistry`，还是新建 `ExtractorRegistry`？

**结论**：独立 `src/extraction/` 模块（方案 A）

**理由**：
- 提取器产出的是图谱节点数据，而非 Markdown 文档文件；强行实现 `DocumentGenerator` 接口是语义污染（方案 B）
- 方案 C（新建 `ExtractorRegistry`）过度设计：当前只有 3 个提取器，注册表抽象无明确现有使用场景，违反 Constitution 原则 III
- 方案 A 与 Graphify `extract.py` 的独立函数模式直接对齐，参考实现清晰，实现成本最低
- `src/extraction/` 作为独立顶层子包，职责边界清晰（提取 → 图谱节点），不污染现有 `panoramic/` 体系

**替代方案**：
- 方案 B（`GeneratorRegistry`）：接口语义错配，拒绝
- 方案 C（`ExtractorRegistry`）：无当前场景驱动，YAGNI 拒绝

---

## 决策 2：YAML 解析库

**问题**：OpenAPI/AsyncAPI 规范文件通常以 YAML 格式存在，项目目前无 YAML 解析库。是否引入 `yaml` 或 `js-yaml`？

**结论**：不引入外部 YAML 库，使用内联轻量解析器

**理由**：
- OpenAPI/AsyncAPI spec 的 YAML 语法结构较规则（非任意深度嵌套 YAML 的完整语法），`paths`、`components`、`$ref` 等关键字段均可用行迭代 + 缩进深度提取
- 项目 `package.json` 当前零 YAML 依赖，引入 `yaml`（MIT，约 54 KB）虽然安全，但 Constitution 原则 III 要求每个新增依赖必须有明确的"去掉它功能是否仍可实现"的论证
- 替代路径：内联 YAML 解析器仅需覆盖 MVP 场景（`openapi.yaml`、`asyncapi.yaml` 的顶层结构），约 50 行实现
- 若后续遇到复杂 YAML（多文档、锚点引用等），可作为 patch 追加 `yaml` 依赖

**替代方案**：
- `yaml`（MIT）：功能完整但 YAGNI，暂缓引入
- `js-yaml`（MIT）：同上，且社区活跃度低于 `yaml`，不优先

---

## 决策 3：Markdown 解析方式

**问题**：Markdown 标题树和 frontmatter 解析是否需要引入 `marked` 或 `remark`？

**结论**：不引入，使用正则提取

**理由**：
- 需要从 Markdown 中确定性提取的结构仅有：YAML frontmatter（`---` 块）、标题层级（`# / ## / ###`）、代码块中的文件路径引用（反引号）
- 上述三类模式均可用简单正则稳定覆盖，复杂度等同于现有 `src/panoramic/parsers/skill-md-parser.ts` 的实现方式
- LLM 实体提取直接传入原始 Markdown 文本，无需 AST
- `marked`（MIT，约 500 KB minified）虽然健壮，但当前明确使用场景不足以支撑引入

**替代方案**：
- `marked`：功能过剩，YAGNI 拒绝
- `remark + remark-frontmatter`：plugin 体系更重，更不适合当前场景

---

## 决策 4：Vision API 模型选择

**问题**：图像提取使用哪个 Claude 模型？

**结论**：默认 `claude-sonnet-4-5`，通过 `SPECTRA_VISION_MODEL` 环境变量覆盖

**理由**：
- 用户在 spec Clarifications 中明确选择：选项 B — 优先提取精度而非成本
- Sonnet 在复杂架构图和手绘图场景下表现优于 Haiku
- 环境变量覆盖保留灵活性，不硬编码成本敏感场景

**替代方案**：
- 默认 `claude-haiku-*`：成本更低但精度不足，用户明确拒绝

---

## 决策 5：文件级缓存与 Feature 100 CacheManager 的关系

**问题**：提取层缓存是否复用 Feature 100 的 `CacheManager`？

**结论**：不复用，独立实现文件级 SHA256 哈希缓存

**理由**：
- `CacheManager` 粒度为 Generator 级（聚合上下文 + 所有输入文件的哈希），适合"整批文件共同决定一份输出"的场景
- 提取层需要文件级粒度：每个 `.md`/`.yaml`/图片文件独立缓存，一个文件变更不应使其他文件的缓存失效
- 参考 Graphify `cache.py`：`SHA256(文件 body + 绝对路径)` 是文件级缓存的工业标准模式
- 缓存目录 `{outputDir}/_meta/extraction-cache/` 与 Generator 缓存同根不同目录，不冲突

**替代方案**：
- 复用 `CacheManager`：需要适配器层（将文件级 key 映射为 Generator 级聚合 key），比独立实现更复杂，YAGNI

---

## 决策 6：`$ref` 循环引用截断策略

**问题**：OpenAPI schema 中循环 `$ref` 的截断深度和行为？

**结论**：绝对层数 5 层（从 schema 根节点计算）；截断处生成占位节点 `kind: 'api-schema'`、`label: '{SchemaName} [ref-truncated]'`

**理由**：
- 绝对层数计算简单无歧义，无需理解递归调用栈
- 占位节点保留图谱可达性（边连接不断），比静默跳过更利于用户调试循环引用
- 5 层覆盖绝大多数实际 OpenAPI 嵌套（实际项目 schema 深度通常 ≤ 3 层）

**替代方案**：
- 局部递归深度：实现复杂，与绝对层数无法对齐，拒绝
- 静默跳过：丢失可达性，不利于调试，拒绝

---

## 决策 7：Markdown 并发 LLM 调用并发控制实现

**问题**：并发数上限 5 的 Promise 并发控制是引入 `p-limit` 还是手写？

**结论**：手写简单并发控制器（约 20 行）

**理由**：
- `p-limit`（MIT）虽成熟，但当前并发控制逻辑非常简单（固定上限 5，无优先级、无队列管理）
- 手写实现：维护一个 `active` 计数器 + 队列，在 `Promise.all` 外层包装，约 20 行
- Constitution 原则 III：三行重复代码优于过早抽象；当前无需 `p-limit` 的完整功能集

**替代方案**：
- `p-limit`：功能过剩，YAGNI 拒绝
- `@sindresorhus/p-limit`（同作者 ESM 版本）：同上

---

## 不确定项（已解决）

所有规划阶段的 `NEEDS CLARIFICATION` 项均已在 spec.md Clarifications 章节通过 `AUTO-CLARIFIED` 或用户决策方式解决，无遗留不确定项。
