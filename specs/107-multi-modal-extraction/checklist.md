# Feature 107 质量检查清单

**特性**: 107-multi-modal-extraction
**检查日期**: 2026-04-12
**检查人**: 质量检查表子代理
**规范版本**: specs/107-multi-modal-extraction/spec.md（Draft）

---

## 维度一：功能完整性

> prompt.md 中的所有需求是否都在 spec.md 中有对应的功能需求？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 1.1 | Markdown 文档扫描（排除 specs/、node_modules/、dist/）→ `kind: 'document'` 节点 | [x] | FR-001 完整覆盖 |
| 1.2 | Markdown 确定性提取：heading 树 + frontmatter（无需 LLM） | [x] | FR-002 覆盖 |
| 1.3 | Markdown LLM 提取：命名实体 + 设计决策段落，标记 `INFERRED` | [x] | FR-003 覆盖 |
| 1.4 | OpenAPI/AsyncAPI 确定性解析，生成 `api`、`api-schema`、`event` 节点，标记 `EXTRACTED` | [x] | FR-004/FR-006 覆盖 |
| 1.5 | 复用 `src/panoramic/api-surface/openapi-extractor.ts` 现有解析逻辑 | [x] | FR-005 明确指定复用路径 |
| 1.6 | 图像提取：Claude Vision，生成 `kind: 'diagram'` 节点，标记 `INFERRED` | [x] | FR-007 覆盖 |
| 1.7 | 图像三级降级路径（无 API key / Vision 调用失败 / JSON 解析失败） | [x] | FR-008 完整三级路径 |
| 1.8 | 图片大小 > 10 MB 跳过，日志记录文件路径和大小 | [x] | FR-009 覆盖 |
| 1.9 | `--include-docs` / `--include-images` 标志默认 false，不改变现有行为 | [x] | FR-012/FR-013 覆盖 |
| 1.10 | 文档 → 代码模块关联边，文件路径引用匹配，标记 `INFERRED` | [x] | FR-018 覆盖 |
| 1.11 | Markdown LLM 并发数上限 5，使用 `Promise.all` | [x] | FR-016 覆盖 |
| 1.12 | 图像数量超 50 张时输出成本警告 | [x] | FR-017 覆盖（SHOULD 级别） |
| 1.13 | PDF 提取：prompt.md 隐含"可扩展"但未要求 MVP 实现 | [x] | FR-019 明确 YAGNI 移除并解释理由 |
| 1.14 | `.spectraignore` 文件支持 | [x] | FR-020 明确 YAGNI 移除并解释理由 |

**小结**：prompt.md 全部 14 个功能点均有对应的 FR 覆盖，无遗漏。

---

## 维度二：接口一致性

> GraphNode.kind 扩展、BuildGraphOptions 变更、BatchOptions 变更是否与现有类型兼容？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 2.1 | `GraphNode.kind` 扩展新增 `'api' \| 'api-schema' \| 'event' \| 'diagram'`，修改位置 `src/panoramic/graph/graph-types.ts` 已在 FR-010 明确 | [x] | FR-010 覆盖，修改位置明确 |
| 2.2 | FR-010 要求扩展"向后兼容，不破坏现有处理 `kind` 字段的代码" | [x] | 约束已在 FR-010 文本中明确 |
| 2.3 | `buildKnowledgeGraph()` 接受可选第四路数据源 `extractionResults?: ExtractionResult[]`（可选字段不破坏现有调用） | [x] | FR-011 覆盖，字段为可选 |
| 2.4 | 合并策略与 Graphify `build.py` 一致（last-write-wins，悬空边静默跳过）在 FR-011 中说明 | [x] | 已与 Graphify 参考对齐 |
| 2.5 | `BatchOptions` 新增字段 `includeDocs?: boolean`（默认 `false`）和 `includeImages?: boolean`（默认 `false`）为可选，不破坏现有使用 | [x] | FR-012 覆盖，默认值明确 |
| 2.6 | `ArtifactExtractor<T>` 泛型接口设计，在核心实体一节中定义 | [x] | 核心实体章节描述 |
| 2.7 | `ExtractionResult` 作为提取层与图谱层的数据契约，类型结构有明确定义 | [x] | 核心实体章节覆盖 |
| 2.8 | 新接口 / 类型定义是否需要对 `BuildGraphOptions` 做同步扩展（与 `buildKnowledgeGraph()` 参数对齐） | [ ] | **问题**：FR-011 说明 `buildKnowledgeGraph()` 接受新参数，但未说明是否需同步修改 `BuildGraphOptions` 类型定义；若该函数通过 options 对象接收参数，`BuildGraphOptions` 类型需对应扩展，spec 中未单独描述这一接口变更点 |

**小结**：7/8 通过，1 项存在接口变更边界模糊的问题。

---

## 维度三：性能约束

> 性能目标是否有可验证的测试策略？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 3.1 | Markdown 提取 100 文件 < 30 秒的性能目标在 SC-003 中定义 | [x] | 可测量目标明确 |
| 3.2 | OpenAPI 单文件 5,000 行解析 < 2 秒在 SC-004 中定义 | [x] | 可测量目标明确 |
| 3.3 | 单张图片 Vision 提取 < 10 秒在 SC-005 中定义 | [x] | 可测量目标明确 |
| 3.4 | 图像提取降级跳过 < 100 ms 在 SC-005 中定义 | [x] | 可测量目标明确 |
| 3.5 | 上述性能目标是否有对应的独立测试方法或验收场景覆盖 | [ ] | **问题**：SC-003、SC-004、SC-005 均给出了数字目标，但 spec 中未说明如何在测试中验证这些性能目标（无对应 performance test 场景或测试文件路径）；用户故事 3 的独立测试方法描述的是功能正确性测试，非性能测试 |

**小结**：4/5 通过，性能目标存在但缺少可验证的测试策略描述。

---

## 维度四：降级路径

> 图像提取的降级策略是否完整（无 API key、图片过大、API 超时）？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 4.1 | 无 API key → 跳过全部图像提取 + 日志提示 + batch 不失败 | [x] | FR-008(1)、用户故事 3 验收场景 3 覆盖 |
| 4.2 | Vision API 调用失败/超时 → 跳过单张图片 + 不影响其他图片 | [x] | FR-008(2)、用户故事 3 验收场景 4 覆盖 |
| 4.3 | LLM 返回内容无法解析为 JSON → 返回空 `ExtractionResult`，不中断管道 | [x] | FR-008(3)、边界情况章节覆盖 |
| 4.4 | 图片 > 10 MB → 跳过 + 日志记录路径和大小 | [x] | FR-009、用户故事 3 验收场景 2 覆盖 |
| 4.5 | 不支持的图片格式（bmp/tiff）自动跳过，仅处理 png/jpg/jpeg/svg | [x] | 边界情况章节覆盖 |
| 4.6 | SVG 以文本方式提取（非 Vision API 调用），降级策略有别于 raster 图片 | [x] | 边界情况章节明确 |
| 4.7 | Markdown 文件 LLM 上下文超限（> 8000 token）的降级路径 | [x] | 边界情况章节覆盖：按 heading 切分 → 启发式关键词提取 |

**小结**：7/7 全部通过，降级路径覆盖完整。

---

## 维度五：向后兼容

> 默认行为是否保持不变？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 5.1 | 默认 `spectra batch`（不带新标志）输出 `graph.json` 内容与引入前完全一致 | [x] | SC-006、用户故事 4 验收场景 1 覆盖 |
| 5.2 | 新增 `GraphNode.kind` 值不破坏现有渲染/过滤逻辑（行为降级到默认处理） | [x] | 用户故事 5 验收场景 2 覆盖 |
| 5.3 | `BatchOptions` 新字段均为可选，不破坏现有调用方 | [x] | FR-012 默认值 `false` 明确 |
| 5.4 | `buildKnowledgeGraph()` 新参数为可选（`extractionResults?`），不破坏现有调用方 | [x] | FR-011 `?` 标注 |
| 5.5 | 新增 `api`、`api-schema`、`event`、`diagram` 节点类型不出现在未启用标志的 batch 输出中 | [x] | 用户故事 4 验收场景 1 明确断言 |

**小结**：5/5 全部通过，向后兼容承诺清晰且有测试覆盖。

---

## 维度六：安全考量

> LLM 注入风险、图片恶意内容、API key 泄漏防护

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 6.1 | 敏感文件（.env、私钥、证书）跳过扫描，参考 Graphify `detect.py::_is_sensitive()` | [x] | 边界情况章节覆盖 |
| 6.2 | API key 泄漏防护：日志输出中不得打印 `ANTHROPIC_API_KEY` 值 | [ ] | **问题**：spec 未明确说明日志输出的 API key 脱敏要求；仅说明"日志提示"，未约束日志内容不得包含敏感 key 值 |
| 6.3 | LLM prompt injection 风险：Markdown/图像内容注入恶意 prompt 绕过提取逻辑 | [ ] | **问题**：spec 未描述对 Markdown 内容或 Vision 输出中 LLM prompt injection 的防护策略（如输出 schema 强制约束、角色 system prompt 固定等） |
| 6.4 | 图片恶意内容（NSFW、隐写攻击等）的处理策略 | [ ] | **问题**：spec 未定义对 Vision API 返回恶意描述内容或恶意图片输入的处理策略；Vision 返回内容仅有 JSON 解析失败时的降级，无内容过滤机制描述 |
| 6.5 | `ExtractionResult` Zod schema 验证可防止格式异常的 LLM 输出污染图谱 | [x] | FR-015 覆盖，验证失败记录警告并丢弃 |
| 6.6 | OpenAPI `$ref` 循环引用防止 DoS（深度上限 5 层 + visited set） | [x] | 边界情况章节覆盖 |

**小结**：3/6 通过，3 项安全考量未覆盖（API key 脱敏日志、LLM 注入防护、图片恶意内容处理）。

---

## 维度七：Graphify 模式对齐

> 是否充分借鉴了 Graphify 的提取验证 schema、悬空边容忍、文件分类策略？

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| 7.1 | 提取结果验证 schema 映射：Graphify `validate.py` 必填字段（id、label、source_file、confidence）均在 `ExtractedNode` 和 `ExtractedEdge` 定义中体现 | [x] | 核心实体章节定义与 Graphify schema 对齐 |
| 7.2 | 悬空边（dangling edge）静默跳过，不报错 | [x] | FR-011 明确"悬空边静默跳过"，与 Graphify `validate.py` 行为一致 |
| 7.3 | 文件分类策略：扫描范围限定（md 排除 specs/node_modules/dist/；图片限定 docs/assets/images/）与 Graphify `detect.py` 的分层扫描思路对齐 | [x] | FR-001、FR-007、边界情况章节覆盖 |
| 7.4 | 缓存 key 策略：`SHA256(文件内容 + 绝对路径)`，Markdown 仅哈希 frontmatter 之后 body，与 Graphify `cache.py` 一致 | [x] | FR-014 对齐 Graphify 缓存策略 |
| 7.5 | 合并策略 last-write-wins（语义节点覆盖 AST 节点），与 Graphify `build.py` 一致 | [x] | FR-011 明确 |
| 7.6 | 并发控制上限机制（Graphify `FILE_COUNT_UPPER` → Spectra 并发 5 上限 + 50 张警告） | [x] | FR-016/FR-017 覆盖 |
| 7.7 | 数据驱动配置模式（Graphify `LanguageConfig` dataclass + `_extract_generic()`）的 TypeScript 等价物 | [ ] | **问题**：spec 定义了 `ArtifactExtractor<T>` 泛型接口，但未说明是否采用配置驱动的统一执行引擎模式（如 `ExtractorConfig + _runExtractor(config)` 风格）；三个提取器均为独立类，与 Graphify 的数据驱动统一引擎有设计差异，此差异在 spec 中未显式说明取舍理由 |

**小结**：6/7 通过，Graphify 数据驱动配置模式对齐方式在 spec 中未明确说明。

---

## 综合通用质量检查

### Content Quality（内容质量）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| C.1 | 无实现细节（未锁定具体语言/框架实现方式） | [ ] | **问题**：spec 多处出现实现细节，如"使用 `Promise.all` 并发"（FR-016）、"SHA256(文件内容 body + 绝对路径)"（FR-014）、"使用 Zod schema 对所有 ExtractionResult 进行运行时验证"（FR-015）；这些属于实现约束而非纯需求描述 |
| C.2 | 聚焦用户价值和业务需求 | [x] | 用户故事章节以角色为中心编写，业务价值清晰 |
| C.3 | 面向非技术利益相关者编写 | [ ] | **说明**：本 spec 为工程内部规范，面向技术受众，存在大量技术细节；但结合项目上下文（CLAUDE.md 规定 spec 面向工程团队），此项暂不视为质量问题，标记为 N/A |
| C.4 | 所有必填章节已完成（概述、用户故事、功能需求、成功标准） | [x] | 四个核心章节均完整 |
| C.5 | 无 `[NEEDS CLARIFICATION]` 残留标记 | [x] | 全文未发现残留标记 |

### Requirement Completeness（需求完整性）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| R.1 | 所有需求可测试且无歧义 | [x] | 每个 FR 均有对应验收场景或 SC 条目 |
| R.2 | 成功标准可测量 | [x] | SC-001 至 SC-010 均为可量化断言 |
| R.3 | 成功标准技术无关 | [ ] | **问题**：SC-010"所有新增代码通过 `npx vitest run`"直接引用测试工具名称，属于技术实现细节而非纯粹的质量成果标准 |
| R.4 | 所有验收场景已定义 | [x] | 5 个用户故事各有 2-5 个 Given-When-Then 场景 |
| R.5 | 边界条件已识别 | [x] | 独立的边界情况章节覆盖 7 种边界 |
| R.6 | 范围边界清晰（YAGNI 移除项明确说明） | [x] | FR-019/FR-020 明确移除理由 |
| R.7 | 依赖和假设已识别 | [x] | 前置依赖 Feature 100/101 在概述中说明 |

### Feature Readiness（特性就绪度）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| F.1 | 所有功能需求有明确的验收标准 | [x] | FR 与 SC/用户故事场景双向对应 |
| F.2 | 用户场景覆盖主要流程 | [x] | 5 个用户故事覆盖 Markdown、OpenAPI、图像、CLI 集成、类型扩展 |
| F.3 | 功能满足 Success Criteria 中定义的可测量成果 | [x] | SC-001 至 SC-010 均有对应 FR 支撑 |
| F.4 | 规范中无实现细节泄漏影响需求理解 | [ ] | **问题**：同 C.1，多处 FR 包含技术实现约束（文件路径、算法选择、库名称），混入了需求层；这对工程 spec 有一定合理性，但影响规范的纯净度 |

---

## 汇总

| 维度 | 总项 | 通过 | 未通过 |
|------|------|------|--------|
| 一：功能完整性 | 14 | 14 | 0 |
| 二：接口一致性 | 8 | 7 | 1 |
| 三：性能约束 | 5 | 4 | 1 |
| 四：降级路径 | 7 | 7 | 0 |
| 五：向后兼容 | 5 | 5 | 0 |
| 六：安全考量 | 6 | 3 | 3 |
| 七：Graphify 对齐 | 7 | 6 | 1 |
| 通用质量（Content/Completeness/Readiness） | 12 | 8 | 4 |
| **合计** | **64** | **54** | **10** |

---

## 未通过项汇总与修复建议

| 编号 | 问题描述 | 严重性 | 修复建议 |
|------|---------|--------|---------|
| 2.8 | `BuildGraphOptions` 类型定义是否需要同步扩展未说明 | 中 | 在 FR-011 中补充说明：若 `buildKnowledgeGraph()` 通过 options 对象接收参数，需同步扩展 `BuildGraphOptions` 类型定义并注明文件位置 |
| 3.5 | 性能目标缺少测试验证策略 | 中 | 在 SC-003/SC-004/SC-005 下增加"测试策略"子字段，说明如何在测试中度量耗时（如 `performance.now()` 计时 + 阈值断言）或指定对应的性能测试文件路径 |
| 6.2 | 日志输出 API key 脱敏要求未定义 | 高 | 在 FR-008 或安全约束章节补充：日志输出中禁止打印 API key 原值，仅可记录 key 存在/不存在状态 |
| 6.3 | LLM prompt injection 防护策略缺失 | 高 | 在功能需求或边界情况章节增加：Markdown 内容和 Vision 输入传递给 LLM 时，system prompt 中需明确角色约束，输出通过 Zod schema 强制验证格式（FR-015 已部分覆盖输出侧，但输入侧 prompt 设计需补充） |
| 6.4 | 图片恶意内容处理策略未定义 | 中 | 明确范围：是否在 MVP 内处理？若不处理，记录为已知风险和未来工作；若处理，需在边界情况中说明响应策略 |
| 7.7 | Graphify 数据驱动配置模式的设计差异未说明 | 低 | 在复杂度评估章节补充一句：为何选择独立类而非统一执行引擎模式，说明取舍依据 |
| C.1/F.4 | 多处 FR 包含实现细节（Promise.all、SHA256、Zod、文件路径） | 低 | 对于工程内部 spec 这有一定合理性；建议将技术约束集中到独立的"技术约束"章节，与功能需求分开，保持 FR 聚焦于"做什么"而非"怎么做" |
| R.3 | SC-010 引用测试工具名称（npx vitest run） | 低 | 将 SC-010 改为"所有新增代码单元测试通过，TypeScript 类型检查无错误"，不指定具体工具 |

---

**检查结论**：规范整体质量较高，功能完整性（维度一）、降级路径（维度四）、向后兼容（维度五）三个核心维度全部通过。主要缺口集中在**安全考量**（API key 脱敏、LLM 注入防护、恶意内容处理），属于高严重性问题，建议回到 specify 阶段补充安全相关约束后再进入技术规划。
