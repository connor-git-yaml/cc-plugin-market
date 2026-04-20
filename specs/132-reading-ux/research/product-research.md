# F5 Reading UX 产品调研

**Feature**: F5 Reading UX — 轻量模式 + 自然语言问答 + graph.html 交互可视化
**调研日期**: 2026-04-20
**调研模式**: 在线（Web 搜索 + 本地 spec 文档分析）

---

## 1. 用户痛点拆解

### 1.1 痛点 A：没有自然语言问答

**谁会遇到这个痛点？**

主要是两类用户：

- **接手新模块的开发者**：刚加入团队或接手遗留代码，需要快速回答定向问题，如"storage 是谁在调用"、"认证流程从哪里入口"。他们的特点是问题具体、时间紧，不想读完整文档。
- **做代码审查的技术负责人**：审查 PR 时需要快速确认某个调用路径的完整性，或者确认某个设计决策是否覆盖了所有相关代码。

运维和设计师通常不会直接查询代码关系，因此这个痛点的核心受众是开发者和技术负责人，覆盖面广、频率高。

**用户现在如何 workaround？**

1. 全局 `grep`：快速但没有语义，搜索 `storage` 会返回所有字面量匹配，包括注释、字符串和不相关的引用，需要手动筛选。
2. 让 Claude Code 直接读代码：Claude 会顺序读文件，依赖 LLM 记忆来关联调用关系，在 20+ 文件的项目里容易遗漏或混淆。
3. 读生成的 `_meta/graph.json` 手动查询：对非工程师完全不可行；对工程师也是高摩擦操作，需要理解图结构和 JSON 路径。
4. 使用 Spectra MCP `panoramic-query`：当前只接受 `cross-package`、`architecture-ir`、`overview` 三种固定 operation，无法回答"什么调用了 X"这类定向问题。

**为什么不够？**

现有 workaround 的共同缺陷是**没有溯源**：LLM 给出答案，用户无法判断这个答案是基于实际代码关系还是 LLM 推断。在代码审查和架构决策场景下，没有溯源的答案实际上不可信任。

**相对优先级**：在三个痛点中覆盖面最广，属于日常高频场景，优先级最高。

---

### 1.2 痛点 B：没有交互可视化

**谁会遇到这个痛点？**

- **技术负责人做整体架构梳理**：需要向团队或上级展示系统结构，Mermaid 静态图很快就会超过可读范围（30+ 节点后密不可分）。
- **新人 onboarding**：阅读路径依赖文字描述，没有可探索的视图，难以建立对大型代码库的直觉。
- **架构分析师**：需要识别 God Node、孤立模块、跨社区异常边，静态图无法支持这类探索性分析。

**用户现在如何 workaround？**

1. 使用 `spectra export --format obsidian`：在 Obsidian Graph View 里可以交互探索，但需要额外安装 Obsidian，操作链路长。
2. 手工绘制架构图（Draw.io、Miro）：一次性且不随代码更新，维护成本极高。
3. 查看 `GRAPH_REPORT.md`：纯文字报告，对社区结构有描述但无法点击展开。

**为什么不够？**

Obsidian 方案需要用户离开当前工作环境，且 Obsidian Graph View 不支持点击节点直接跳转到 spec 文件。关键缺失是**跳转能力**：用户看到一个节点后，没有办法一键打开对应文档。

**相对优先级**：覆盖面中等，偏向中高级用户（技术负责人、架构分析师），属于 P2 场景。在三个痛点中优先级最低，但对"展示价值"有重要作用。

---

### 1.3 痛点 C：对小项目 / 纯代码项目水土不服

**谁会遇到这个痛点？**

- **个人开发者和小团队**：在 5-20 个文件的工具、脚本、微服务上使用 Spectra，期望快速得到结构概览，而不是等待 776 秒并得到大量空白产品文档。
- **评估 Spectra 的潜在用户**：第一次试用 Spectra 时通常用自己熟悉的小项目（如 graphify 示例项目），体验到大量"诚实的空白"后可能直接放弃。
- **工程师在 CI 流程中集成 Spectra**：如果批量生成超过 10 分钟且产出大量空白章节，CI 集成没有实际价值。

**用户现在如何 workaround？**

1. 忍受空白产物，手动补充：高成本，违背自动化初衷。
2. 只运行 `spectra generate` 而非 `spectra batch`：单模块有效，但失去跨模块视图。
3. 不使用 Spectra，改用 Graphify：这正是竞品流失路径。

**为什么不够？**

核心问题是 Spectra 当前的 full 模式设计假设是"有产品、有用户旅程、有 API Surface 的中型以上项目"。对纯代码工具类项目，`product-overview = low coverage`、`user-journeys 空`、`troubleshooting 0 条` 是结构性的而非偶然的——这类项目就是没有这些信息。强制套用产品文档套件会产生大量"诚实的空白"，让用户感知到 Spectra 在这类项目上无能为力。

**相对优先级**：这是**试用转化**的关键障碍，直接影响新用户留存。小项目是最常见的试用场景，痛点清晰，属于 P1。

---

### 三个痛点的优先级汇总

| 痛点 | 受众 | 频率 | 对留存的影响 | 优先级 |
|------|------|------|------------|------|
| 没有自然语言问答 | 所有开发者 | 高频日常 | 中（有 workaround） | P1 |
| 没有交互可视化 | 技术负责人、架构师 | 中频 | 低（有 Obsidian 替代） | P2 |
| 对小项目水土不服 | 新用户、个人开发者 | 高频（试用期） | 高（直接影响留存） | P1 |

---

## 2. 用户旅程（Before/After）

### 2.1 场景 A：新人接手中型项目（~50 模块），想快速搞懂"storage 是谁在用"

**Before（当前 Spectra full 模式）**

1. 运行 `spectra batch`，等待 ~30 分钟完成
2. 看到 11 篇产品文档 + 50 个模块 spec，不知从哪里读起
3. 翻阅 `architecture.md`，看到 Mermaid 图有 40+ 节点，密不可分
4. 搜索 `storage` 关键词，得到 200+ 文件匹配
5. 挨个打开相关文件，手动梳理调用关系
6. 放弃，直接问 Claude Code，Claude 依赖记忆回答，无法确认是否完整
7. **总耗时：1-2 天，答案可信度不明**

**After（F5 Reading UX）**

1. 运行 `spectra batch --mode=reading`，等待 ~5-10 分钟
2. 打开 `_meta/graph.html`，看到可缩放的交互图，按社区着色
3. 点击 `storage` 节点，看到所有指向它的边（入边 = 调用者）
4. 对 MCP 工具说"什么模块调用了 storage？"，得到带溯源引用的答案（文件:行号）
5. 点击引用链接，跳转到对应 spec 文件的具体章节
6. **总耗时：15-30 分钟，答案有溯源支撑**

---

### 2.2 场景 B：工程师在小项目（< 10 文件）上跑 spectra，不想要产品文档套件

**Before（当前 Spectra full 模式）**

1. 运行 `spectra batch`，等待约 776 秒（> 12 分钟）
2. 得到 `product-overview.md`（coverage: low）、`user-journeys.md`（空）、`troubleshooting.md`（0 条）
3. 看到大量 `[待补充]` 和 `low confidence` 标记，感觉 Spectra 质量差
4. 真正需要的代码关系图、模块依赖、接口清单淹没在大量空白章节中
5. **结论：Spectra 对我的项目没用**

**After（F5 Reading UX，--mode=code-only）**

1. 运行 `spectra batch --mode=code-only`，等待 < 120 秒
2. 得到：模块 spec（含接口定义和依赖关系）、`_meta/graph.json`、`GRAPH_REPORT.md`
3. 没有空白的产品文档占位，每个产物都有实质内容
4. 可以直接问"这 5 个文件之间的调用关系是什么"
5. **结论：Spectra 对我的项目是可用的快速工具**

---

### 2.3 场景 C：技术负责人做代码审查，想看"这个 hyperedge 流程涉及哪些调用路径"

**Before（当前 Spectra）**

1. 打开 `GRAPH_REPORT.md`，看到社区列表和文字描述
2. 需要理解哪些节点属于同一个 hyperedge（如"Full Ingestion Pipeline"）
3. 看到的是分散在多个 spec 文件里的函数描述，没有整合视图
4. 打开 `graph.json` 手动查询 hyperedge 成员（需要 JSON 知识）
5. 无法在审查时快速确认"这个 PR 改动是否影响了 Ingestion Pipeline 的所有节点"
6. **高摩擦，实际上不会这样做，改用直觉判断**

**After（F5 Reading UX，hyperedge 查询 + graph.html）**

1. 打开 `_meta/graph.html`，输入 "Ingestion Pipeline" 关键词
2. 图中高亮显示 hyperedge 涉及的所有节点（parser + validator + processor + storage）
3. 问 MCP 工具"这个 hyperedge 涉及哪些调用路径"，得到带溯源引用的完整调用链
4. 每个节点可以点击跳转到对应 spec 文件，确认 PR 改动是否覆盖了所有节点
5. **审查时间缩短，决策有事实支撑**

---

## 3. 竞品分析：Graphify vs Spectra

### 3.1 Graphify 的 UX 做法

基于 Graphify v4 README 和公开文档分析，Graphify 在三项 UX 上的做法如下：

**自然语言问答（`graphify query`）**

Graphify 的查询模型是：从知识图谱中提取**聚焦子图**（focused subgraph），而不是把完整语料传给 LLM。命令格式为：

```
graphify query "what calls storage?"
graphify query "show the auth flow" --dfs
graphify path "NodeA" "NodeB"
```

关键 UX 决策：
- 返回的是子图（节点+边），而不是纯文字答案
- 结果标注 `EXTRACTED`（源码直接找到）、`INFERRED`（合理推断）、`AMBIGUOUS`（存疑）
- 包含 `source files` 和 `source locations`（文件:行号），天然溯源
- `--budget` 参数控制 token 预算，防止上下文溢出

这个设计的核心洞察是：**AI 助手调用图查询，得到结构化子图后再生成答案**，比直接让 LLM 依赖记忆回答更准确、更可溯源。

**交互可视化（`graph.html`）**

Graphify 的 `graph.html` 基于 vis.js 渲染，核心功能：
- 浏览器直接打开，无需安装额外工具（self-contained HTML）
- 点击节点：显示节点详情（类型、社区归属、连接边）
- 搜索：全局节点名称搜索
- 按社区着色（Leiden 聚类结果）
- 可过滤（filter by community）

关键 UX 决策：输出是 **self-contained HTML 文件**，分享给非工程师（如产品经理）也能打开，无需权限或工具链。

**小项目适配**

Graphify 文档明确承认：在 6 个文件的项目上，token 压缩比约 1x（几乎没有压缩价值），但仍然提供"结构清晰度"（structural clarity）。Graphify 没有专门的轻量模式，对所有项目使用相同流程，小项目上的体验也是产出 graph.html + GRAPH_REPORT.md + graph.json，只是内容体量小。这说明 Graphify **通过统一的轻量产物**（没有产品文档套件）规避了"空白章节"问题，而不是通过模式切换。

---

### 3.2 Spectra 当前差距

| 维度 | Graphify | Spectra 当前状态 | 差距 |
|------|---------|----------------|------|
| 自然语言查询 | `graphify query "..."` 返回子图 + 溯源 | `panoramic-query` 只有 3 种固定 operation | 无法回答任意自然语言问题 |
| 查询结果溯源 | 每个结果含 source file + line number | MCP 结果无 evidenceText/evidenceSource | 用户无法验证答案 |
| 交互可视化 | graph.html（vis.js，self-contained，可搜索） | 静态 Mermaid `.mmd` 文件 | 节点超过 30 个后不可读 |
| 点击跳转 | 节点详情显示文件路径（[推断]不确定是否直接跳转） | Mermaid 无任何交互 | 无法从图跳转到文档 |
| 小项目体验 | 统一轻量产物，无空白章节 | full 模式产出大量空白产品文档 | 试用体验差，影响留存 |
| 安装门槛 | `pip install graphifyy`，Python 3.10+ | Node.js 20+，npm 安装 | 门槛相近，但 Python 生态受众更广 |

---

### 3.3 可借鉴点 & 必须超越的点

**可借鉴**

1. **聚焦子图模式**：Graphify 的查询不返回全量数据，而是返回聚焦子图。F5 的 `natural-language` operation 应采用相同思路：从知识图谱中提取相关子图，再用 LLM 组织成自然语言答案，而不是把整个 graph.json 作为上下文。
2. **Self-contained HTML**：Graphify 的 graph.html 无依赖、浏览器直接打开。F5 的 graph.html 应采用相同策略（D3-force 内联），确保分享给非工程师也能打开。
3. **统一轻量产物设计**：Graphify 对所有项目产出相同的轻量产物集合（graph.html + GRAPH_REPORT.md + graph.json），避免了空白章节问题。Spectra 的 `--mode=code-only` 应参考这个思路：只产出有实质内容的制品。

**必须超越**

1. **溯源引用更深入**：Graphify 的查询结果包含文件路径和行号，但不包含 spec 文件引用（design-doc 段落 → 函数节点）。F5 的问答应集成 F4 hyperedges，能同时引用代码位置和设计决策来源（"这个函数被 architecture.md §3.2 描述为..."）。
2. **点击跳转到 spec**：Graphify 的 graph.html 显示文件路径，但跳转体验不明确。F5 的 graph.html 应实现点击节点直接跳转对应的 spec 文件（`file://` 路径），这对 Claude Code 用户是高频操作。
3. **模式感知**：Graphify 没有项目规模感知，对所有项目用相同流程。Spectra 的 `--mode=reading` 是主动的规模感知设计，让小项目用户得到更快、更聚焦的结果，大项目用户得到更完整的文档套件。这是差异化优势，而不只是追赶。
4. **与 F3 debt scanner 集成**：Graphify 的查询不包含技术债信息。F5 的问答可以回答"这个模块有多少 TODO 债务"、"最老的 FIXME 在哪里"，这是 Spectra 独有的维度。

---

## 4. 产品优先级理由

### 4.1 为什么 F5 是 Wave 3 压轴

F5 是 Phase 2 Milestone Wave 3 的最后一个常规 Feature，原因不只是"做完剩下的功能"，而是它在产品定位上有一个根本性的跃迁意义：

**从"文档生成器"到"代码阅读平台"**

F1-F4 建立了 Spectra 的基础设施层：
- F1/F2 建立了 budget-gate 和 SpecStore（数据来源规范化）
- F3 建立了技术债引擎（debt scanner）
- F4 建立了函数级语义锚定和 hyperedges（知识图谱精细化）

这些 Feature 做完后，Spectra 有了强大的底层能力，但**用户感知的 UX 仍然是"跑一次 batch，读一堆文件"**。F5 是把这些底层能力的价值暴露给用户的那层 UX 皮肤：

- `--mode=reading` 让用户感知到"Spectra 理解我的项目规模"
- `natural-language` operation 让用户感知到"Spectra 能回答我的问题，而不只是生成文档"
- `graph.html` 让用户感知到"Spectra 的知识图谱是可以用的，不只是 `_meta/` 里的 JSON 文件"

如果 F5 不做，F1-F4 的价值对大多数用户是不可见的。这就是 F5 作为 Wave 3 压轴的产品意义：**它是 Phase 2 能力集合的用户价值变现层**。

---

### 4.2 Story 优先级（P1/P2）理由

**Story 1（P1）：`--mode=reading` / `--mode=code-only`**

- **理由**：直接解决试用留存问题。新用户的第一次体验决定他们是否会继续使用 Spectra。`--mode=code-only` 把 776 秒压到 120 秒以内，把大量空白章节替换为有实质内容的轻量产物。这是最小改动、最大留存收益的 Story。
- **为什么是 P1 而不是 P2**：轻量模式是其他两个 Story 的基础条件。如果小项目跑 full 模式都需要 776 秒，那么 natural-language 查询的体验也会受损（因为知识图谱基础数据是 batch 产生的）。先有快速的基础产物，才有良好的查询和可视化体验。

**Story 2（P1）：`panoramic-query` `natural-language` operation**

- **理由**：直接解决高频日常痛点，且是 Graphify 最主要的竞品优势（`graphify query`）。没有自然语言问答，Spectra 的知识图谱对大多数用户来说仍然是黑盒。带溯源引用是信任建立的关键：用户一旦看到答案附带"来自 `src/storage/index.ts:42`"，就会开始信任这个工具。
- **为什么是 P1 而不是 P2**：这是 F5 中用户**最直接可感知**的新能力，也是区分"查询工具"和"文档生成器"的核心边界。

**Story 3（P2）：`spectra batch --html` → `_meta/graph.html`**

- **理由**：交互可视化价值明确，但有两个 P2 的理由：（1）当前已有 Obsidian Vault 导出作为替代，用户有 workaround；（2）这个 Story 的价值更多在"展示"和"onboarding"场景，而不是每日高频操作。作为压轴的"视觉呈现层"，它让 Spectra 更有说服力，但不是解决高频痛点的 Story。

---

### 4.3 如果只能做两个 Story，哪个可以砍？

**可以砍：Story 3（graph.html 交互可视化）**

理由：
1. **有替代品**：Obsidian Vault 导出已经提供可交互的图浏览体验，用户可以继续使用这个路径。
2. **高频痛点已由 Story 1+2 覆盖**：轻量模式解决留存问题，自然语言问答解决查询问题，这两个 Story 覆盖了 80% 的用户价值。
3. **可延后到 F6**：graph.html 是一个相对独立的"输出格式"功能，可以在不影响其他能力的情况下延后。

**不可砍：Story 1 + Story 2**

这两个 Story 合起来才构成 F5 的核心价值主张：**"Spectra 可以按项目规模伸缩，并且可以被问答"**。任何一个单独存在都是不完整的：只有轻量模式，没有问答，用户还是在看文件；只有问答，没有轻量模式，小项目用户还是要等 776 秒。

---

## 5. 可度量交付价值指标

从用户视角（而非技术实现视角）定义 F5 成功的可观测信号：

### 5.1 执行时间

| 指标 | 目标 | 当前状态 | 可观测方式 |
|------|------|---------|-----------|
| Graphify 示例项目（5 文件），`--mode=reading` | < 120 秒 | ~776 秒（full 模式） | 计时 `spectra batch --mode=reading` |
| 中型项目（50 模块），`--mode=reading` | < 15 分钟 | ~30 分钟（full 模式） | 计时对比 |
| 二次 batch（无变更），任意模式 | < 30 秒（缓存命中） | 已达标（Feature 100） | `spectra cache stats` |

**用户感知**：从"去喝杯咖啡等着"到"等一分钟就有结果"。

---

### 5.2 问答质量

以下 5 类问题是用户在代码阅读中最常提出的，每类都必须有带溯源引用的答案：

| 问题类型 | 示例 | 成功标准 |
|---------|------|---------|
| 什么调用 X | "什么模块调用了 StorageService？" | 返回调用者列表 + 每个调用的文件:行号 |
| 从 X 到 Y 的调用路径 | "从 AuthController 到 DatabaseAdapter 的调用路径是什么？" | 返回有序调用链 + 每一跳的文件:行号 |
| X 对应哪个设计决策 | "CacheStrategy 对应哪个架构决策？" | 返回关联的 ADR 段落 + design-doc 位置（集成 F4 hyperedges） |
| 最老的 TODO | "这个项目里最老的 TODO 是什么？" | 返回 TODO 文本 + git blame 年龄（集成 F3 debt scanner） |
| X 属于哪个流程 | "StorageWriter 属于哪个业务流程？" | 返回 hyperedge 名称（如"Full Ingestion Pipeline"）+ 成员列表 |

**用户感知**：从"问 Claude，不知道答案是真是假"到"问 Spectra，答案带文件和行号，我可以直接验证"。

---

### 5.3 交互可视化（Story 3）

| 指标 | 目标 | 可观测方式 |
|------|------|-----------|
| graph.html 加载速度 | 在 500 节点图中 < 3 秒打开 | 浏览器 Network 面板计时 |
| 节点拖动 | 任意节点可拖动，实时重排 | 手动测试 |
| 搜索 | 输入关键词高亮匹配节点，< 1 秒响应 | 手动测试 |
| 点击跳转 | 点击节点后，在 Claude Code 环境中打开对应 spec 文件 | 集成测试 |
| Self-contained | HTML 文件在断网环境可正常打开 | 断网后打开测试 |

**用户感知**：从"看 Mermaid 图，节点多了什么都看不清"到"在浏览器里拖动节点，点击直接跳转文档"。

---

### 5.4 用户路径转变

这是 F5 最重要的指标，描述的是**工作方式的变化**，而不只是单个功能的可用性：

**Before F5**（当前工作路径）

```
运行 spectra batch（等待 10-30 分钟）
→ 打开 11 篇产品文档（不知从哪里读起）
→ 打开 50 个模块 spec（逐个读取）
→ 在 Claude Code 里问问题（没有溯源，不可信）
→ 手动 grep 验证（高摩擦）
```

**After F5**（目标工作路径）

```
运行 spectra batch --mode=reading|code-only（等待 2-5 分钟）
→ 打开 graph.html（交互式，点击探索）
→ 问 MCP 工具具体问题（得到带溯源引用的答案）
→ 点击引用跳转 spec（直接验证）
→ 按需深读相关文档（而不是全部）
```

**可观测信号**：用户从"先读文档，再问问题"变为"先问问题，再按需读文档"。这是从"文档推送"到"知识拉取"的模式转变。

---

## 6. 产品风险 & 限定范围的理由

### 6.1 不做 F6 Integrate（Graphify 深度集成）

**产品理由**：

F6 的假设前提是 Spectra 在三项 UX 上完全对齐甚至超越 Graphify 之后，再考虑"如何与 Graphify 互补而不是竞争"。在 F5 完成前做深度集成，等于在 Spectra 还有明显 UX 缺口的情况下绑定竞品，会导致：
1. Graphify 的优势掩盖 Spectra 的缺口，不利于 Spectra 独立价值的建立
2. 集成复杂性增加 F5 的交付风险

**风险**：如果 Graphify 不配合（接口变化、License 限制），F6 的整个计划会失败。F5 的价值不应该依赖竞品的配合。

---

### 6.2 不做 GraphQL/REST 问答接口

**产品理由**：

当前 Spectra 的用户是通过 Claude Code MCP 和 CLI 访问的，这两个接口已经覆盖了核心用户路径。GraphQL/REST 接口意味着 Spectra 需要作为常驻服务运行，这是与当前"本地工具"定位不符的架构跃迁。

**风险**：过早暴露 REST 接口会带来服务部署、安全、版本兼容等一系列工程问题，而当前阶段这些都是不必要的复杂度。

---

### 6.3 不做多轮对话

**产品理由**：

多轮对话需要维护对话状态（session management），这会显著增加 MCP 工具的复杂度（状态持久化、上下文窗口管理、session 过期处理）。F5 的 `natural-language` operation 的价值在于**单次准确回答**——用户问一个问题，得到一个有溯源的答案，然后用这个答案去验证或深读。这个模式不需要多轮对话就能工作。

**风险**：多轮对话如果实现不好（上下文丢失、答案前后矛盾），反而会损害用户对问答可靠性的信任。单次高质量 > 多轮低质量。

---

### 6.4 不做实时协同

**产品理由**：

Spectra 的定位是**本地工具**，而不是 SaaS 协作平台。实时协同需要后端基础设施（WebSocket、用户身份、权限管理），与 Spectra 当前的 CLI/Plugin/MCP 三入口架构完全不兼容。这是产品定位的边界，而不只是功能边界。

**总体风险管理**

F5 的四个"不做"决策的共同逻辑是：**控制 Wave 3 的交付边界，确保已承诺的三个 Story 能高质量交付**。Spectra 当前的用户群体是个人开发者和小团队，他们需要的是"能用、够快、有溯源"，而不是"功能多、能协作、有 API"。F5 的范围划定优先满足核心用户的核心诉求，把扩展性功能留给后续 Feature 或 Phase 3。

---

*调研来源：Graphify v4 README（GitHub）、Sourcegraph Cody 文档、Spectra current-spec.md、F3/F4 spec 文档、Web 搜索（2026-04-20）*
