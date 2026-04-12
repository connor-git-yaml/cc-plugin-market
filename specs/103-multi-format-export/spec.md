---
feature: 103-multi-format-export
branch: claude/magical-goodall
created: 2026-04-12
status: Draft
milestone: M-100 Spectra Evolution Phase 3
priority: P3
targetVersion: v3.3.0
dependencies:
  - Feature 101 (graph-builder)
  - Feature 102 (community-analysis)
researchBasis: specs/103-multi-format-export/research/tech-research.md
---

# Feature Specification: multi-format-export

**Feature Branch**: `103-multi-format-export`
**创建日期**: 2026-04-12
**状态**: Draft
**输入**: 将知识图谱和社区分析结果导出为可直接消费的格式——Obsidian Vault 和 HTML 交互式可视化

> **注**: research-synthesis.md 不存在，本规范基于 tech-research.md 调研报告生成，标注 `[无调研汇总基础]`。

---

## 关键概念提取

**参与者（Actors）**
- 开发者/架构师：通过 CLI 触发导出，消费 Obsidian Vault 或 HTML 产物
- Obsidian 应用：消费 `.md` 文件及 `[[双向链接]]`，渲染 Graph View
- 浏览器：渲染单文件 HTML，提供交互式图谱探索

**动作（Actions）**
- `spectra export --format obsidian` — 生成 Obsidian Vault 目录结构
- `spectra export --format html` — 生成单文件交互式 HTML
- 节点搜索、社区过滤、节点点击查看详情、缩放拖拽（HTML 交互）

**数据（Data）**
- 输入：`GraphJSON`（Feature 101 产出）、`CommunityResult` + `GodNode[]`（Feature 102 产出）
- 输出 Obsidian：`index.md`、`communities/community-{id}.md`、`god-nodes/{node-name}.md`
- 输出 HTML：单文件，嵌入 d3-force 布局、节点数据 JSON、CSS + JS

**约束（Constraints）**
- d3-force 内联嵌入，不作为 npm 运行时依赖
- Obsidian 文件名不含 `/ \ : * ? " < > |`，长度 < 200
- 双向链接严格使用 `[[filename]]`（不含路径前缀）
- 单文件 HTML 大小 < 2 MB（含内联 d3）
- graph.json / community 数据缺失时 graceful exit
- `--output-dir` 默认值统一为 `_meta/export/`（所有格式共用同一默认值）[AUTO-CLARIFIED: _meta/export/ — 与现有 spectra 工具链约定一致，避免 vault/ 与 html/ 各自不同造成歧义]

---

## User Scenarios & Testing

### User Story 1 — Obsidian Vault 导出（Priority: P1）

开发者在完成知识图谱和社区分析后，希望将分析结果导入 Obsidian，借助 Graph View 直观浏览模块社区结构、快速跳转到 God Node 详情页和社区概览页。运行 `spectra export --format obsidian --output-dir vault/` 后，vault 目录中生成结构完整的 Markdown 文件，所有页面通过 `[[双向链接]]` 互联，在 Obsidian 中打开即可直接使用。

**Why this priority**: Obsidian Vault 产物是纯文本 Markdown 文件，无浏览器渲染和 d3 复杂度，实现复杂度最低，同时为用户提供最直接的"可消费产物"价值，构成 MVP 核心。

**Independent Test**: 在含有 graph.json 和 community 分析结果的环境中，运行 `spectra export --format obsidian`，在 `_meta/export/` 目录下验证文件生成结构和链接格式，即可独立验证该 Story 的全部价值。

**Acceptance Scenarios**:

1. **Given** `_meta/graph.json` 存在（社区归属在运行时通过图谱数据重建），**When** 运行 `spectra export --format obsidian --output-dir vault/`，**Then** `vault/` 目录下生成 `index.md`、若干 `communities/community-{id}.md`、若干 `god-nodes/{node-name}.md`，且文件数量与社区数量和 God Node 数量对应

2. **Given** 生成的 vault 文件，**When** 检查 `index.md` 内容，**Then** 包含图谱统计数据（节点总数、边总数）、社区列表链接、God Node 列表链接，所有链接使用 `[[filename]]` 格式

3. **Given** 生成的社区页 `communities/community-{id}.md`，**When** 检查内容，**Then** 包含 cohesion 评分、核心节点 Top 3（可跳转链接）、社区内模块列表、跨社区链接

4. **Given** 生成的 God Node 页 `god-nodes/{node-name}.md`，**When** 在 Obsidian 中打开，**Then** 双向链接可正确解析，页面包含度数、连接最多的关系类型、所属社区链接、直接邻居节点链接

5. **Given** 节点 ID 包含 `/`、`:`、`?` 等特殊字符，**When** 生成文件名，**Then** 特殊字符被替换，文件名符合 Obsidian 命名规范且长度 < 200

---

### User Story 2 — HTML 交互式可视化导出（Priority: P1）

开发者希望生成一份可发送给他人或在浏览器中独立查看的交互式知识图谱，无需安装任何工具。运行 `spectra export --format html` 后，生成一个自包含的单文件 HTML，可在任意现代浏览器打开，支持拖拽、缩放、节点搜索和社区过滤。

**Why this priority**: HTML 可视化是本 Feature 另一个核心交付产物，属于 MVP 必要组成。与 Obsidian Vault 并列 P1，两者共同构成"多格式导出"的完整语义。

**Independent Test**: 运行 `spectra export --format html`，在浏览器打开生成的 HTML 文件，验证节点渲染、搜索、点击详情、社区过滤等交互功能均可用。

**Acceptance Scenarios**:

1. **Given** graph.json 和 community 数据存在，**When** 运行 `spectra export --format html --output-dir _meta/export/`，**Then** 生成单个 `.html` 文件，文件大小 < 2 MB，用浏览器打开无需网络即可正常显示

2. **Given** 打开 HTML 文件，**When** 页面加载完成，**Then** 节点按社区着色（每社区一个色相），节点大小按度数对数缩放，边透明度反映 confidenceScore

3. **Given** 交互式 HTML，**When** 在搜索框输入节点名关键词，**Then** 匹配节点高亮，不匹配节点降低可见度

4. **Given** 交互式 HTML，**When** 点击某节点，**Then** 侧栏展示该节点的 kind、度数、邻居节点列表、社区 ID

5. **Given** 交互式 HTML，**When** 点击社区图例中某社区，**Then** 该社区节点显示/隐藏切换

6. **Given** 交互式 HTML，**When** 图谱节点数 > 5,000，**Then** 跳过 d3-force 物理仿真，使用预计算网格布局，交互保持 60fps

---

### User Story 3 — CLI 命令集成（Priority: P2）

开发者在日常使用 `spectra` 工具链时，希望导出命令与现有的 `graph`、`community` 等命令风格统一，通过 `spectra export --format <obsidian|html>` 一键触发，并能通过 `spectra --help` 发现该命令。

**Why this priority**: CLI 集成是用户实际使用路径的必要入口，但不影响核心导出逻辑的独立测试，故定为 P2（核心导出函数 P1 可先实现并测试）。

**Independent Test**: 在仓库根目录运行 `npx spectra export --format obsidian`，验证命令可被识别、参数解析正确、默认输出目录为 `_meta/export/`。

**Acceptance Scenarios**:

1. **Given** 已安装 spectra CLI，**When** 运行 `spectra --help`，**Then** 输出中包含 `export` 子命令描述，列出 `--format` 和 `--output-dir` 参数说明

2. **Given** 运行 `spectra export --format obsidian`（不指定 `--output-dir`），**Then** 默认输出到 `_meta/export/` 目录

3. **Given** 运行 `spectra export --format invalid`，**Then** 输出清晰的错误提示，说明有效格式为 `obsidian` 或 `html`，退出码非零

4. **Given** graph.json 不存在，**When** 运行 `spectra export --format obsidian`，**Then** 输出提示"请先运行 `spectra graph` 生成图谱数据"，graceful exit

---

### Edge Cases

- **graph.json 不存在**：graceful exit，输出明确提示，建议用户先运行 `spectra graph`；不抛出未捕获异常
- **community 数据不存在**：同上，提示先运行 `spectra community`；HTML 导出时社区着色降级为单色方案（fallback 颜色 `hsl(0, 0%, 50%)`），Obsidian 导出跳过社区相关页面 [AUTO-RESOLVED: 独立 graceful exit，两者各自检查]
- **节点 ID 含路径分隔符**（如 `src/utils/helper`）：`sanitizeFilename()` 将 `/`、`:` 等特殊字符替换为 `-`；连续多个替换符合并为单个 `-`；首尾 `-` 去除；空格替换为 `-`；大小写保持原样不规范化 [AUTO-CLARIFIED: 连续替换合并 + 首尾去除 — 防止生成 `src--utils--helper` 类难读文件名，保持人类可读性]
- **图谱节点数 > 5,000**：HTML 导出跳过 d3-force 仿真，使用预计算网格布局；网格列数取 `Math.ceil(Math.sqrt(nodeCount))`，行列均匀分配，节点间距固定 60px [AUTO-CLARIFIED: sqrt 均匀网格 + 60px 间距 — 最简单且视觉均匀的降级策略，无需额外配置]
- **空图（0 节点）**：两种导出格式均 graceful exit，输出提示"图谱为空，无可导出内容"，退出码非零；不生成空文件 [AUTO-CLARIFIED: graceful exit — 与其他缺失数据场景行为一致，防止生成无意义空文件]
- **有节点无边（孤立节点图）**：正常导出，HTML 中节点静止显示（d3-force 无边约束时节点分散到边缘），Obsidian 中 God Node 页邻居列表为空，说明"无直接依赖关系" [AUTO-CLARIFIED: 正常导出 + 空邻居列表 — 有节点无边是合法图状态，不应阻断导出流程]
- **单个节点无社区归属**（`nodeCommunityMap` 中不存在）：节点显示为"未分类"，不影响其他节点渲染
- **悬空边**（source 或 target 节点 ID 在节点列表中不存在）：遵循 Graphify graceful skip 策略，静默跳过该边，不报错
- **spec 节点无 sourceTarget/relatedFiles**：条件判断，仅在字段存在时生成对应双向链接
- **文件名长度超过 200 字符**：截断至 195 字符 + 短哈希后缀，保证唯一性

---

## Requirements

### Functional Requirements

**Obsidian Vault 导出**

- **FR-001**: 系统 MUST 生成 `index.md` 总览页，包含图谱总节点数、总边数、社区数量统计、各社区 `[[链接]]`、所有 God Node `[[链接]]` `[必须]`

- **FR-002**: 系统 MUST 为每个社区生成 `communities/community-{id}.md`，内容包含 cohesion 评分、核心节点 Top 3（带 `[[链接]]`）、社区内节点列表、跨社区链接 `[必须]`

- **FR-003**: 系统 MUST 为每个 God Node 生成 `god-nodes/{node-name}.md`，内容包含度数、连接最多的关系类型、所属社区 `[[链接]]`、直接邻居节点列表（无邻居时显示"无直接依赖关系"）`[必须]`

- **FR-004**: 系统 MUST 使用 `[[filename]]` 格式（不含路径前缀）生成所有 Obsidian 双向链接 `[必须]`

- **FR-005**: 系统 MUST 对所有输出文件名执行 sanitize 处理，规则如下：移除 `/ \ : * ? " < > |` 字符替换为 `-`；空格替换为 `-`；连续 `-` 合并为单个 `-`；首尾 `-` 去除；长度截断至 < 200（超出时取前 195 字符 + 4 字符短哈希）`[必须]`

**HTML 交互式可视化**

- **FR-006**: 系统 MUST 生成单文件 HTML，嵌入全部 CSS、JS 和数据，无外部依赖，文件大小 < 2 MB `[必须]`

- **FR-006a**: HTML 导出 MUST 使用构建脚本（`scripts/inline-d3.ts`）在构建期将 d3-force UMD bundle 写入 `src/panoramic/exporters/html-template.ts` 顶部常量；脚本读取 `node_modules/d3-force/dist/d3-force.min.js`，输出形如 `const D3_FORCE_BUNDLE = \`...\`;`；bundle 版本号记录在同文件顶部注释中 [AUTO-CLARIFIED: 构建脚本提取 — 相比手动复制，构建脚本可在 `npm install` 后自动更新，保持版本可追踪性]

- **FR-007**: 系统 MUST 在 HTML 中实现节点按社区着色（每社区一个色相）、节点大小按度数对数缩放、边透明度按 confidenceScore 映射 `[必须]`

- **FR-008**: 系统 MUST 在 HTML 中提供搜索面板，支持按节点名/ID 模糊搜索，匹配节点高亮显示 `[必须]`

- **FR-009**: 系统 MUST 在 HTML 中支持节点点击，侧栏展示 kind、度数、邻居列表、社区 ID `[必须]`

- **FR-010**: 系统 MUST 在 HTML 中提供社区图例，支持点击切换社区显示/隐藏 `[必须]`

- **FR-011**: 系统 MUST 在 HTML 中支持缩放和拖拽 `[必须]`

- **FR-012**: 系统 MUST 在节点数 > 5,000 时跳过 d3-force 仿真，改用预计算网格布局（列数 = `Math.ceil(Math.sqrt(nodeCount))`，节点间距 60px），保证浏览器 60fps 交互 `[必须]`

**CLI 命令**

- **FR-013**: 系统 MUST 新增 `spectra export` 子命令，支持 `--format <obsidian|html>` 和 `--output-dir <dir>` 参数 `[必须]`

- **FR-014**: 系统 MUST 在 `--output-dir` 未指定时，默认输出到 `_meta/export/`（对所有格式统一适用）`[必须]`

- **FR-015**: 系统 MUST 在 graph.json 或 community 数据缺失时，输出明确提示并 graceful exit（退出码非零）；图谱为空（0 节点）时同样 graceful exit，提示"图谱为空，无可导出内容" `[必须]`

**数据加载**

- **FR-016**: CLI 命令层 MUST 在调用导出函数前重新计算社区归属映射（因该数据不持久化到磁盘），导出函数本身接收已计算的映射数据，不自行重建 `[必须]`

- **FR-017**: 系统 SHOULD 在悬空边处理时静默跳过，不影响其他边的输出 `[可选]`

- **FR-018**: HTML 导出 MUST 在生成产物中记录内联 d3 的版本号，便于后续维护和版本追踪 `[必须]`

- **FR-019**: 系统 MAY 从 spec 节点的 `metadata.sourceTarget` 和 `metadata.relatedFiles` 中提取额外双向链接 `[可选]` [AUTO-RESOLVED: 条件判断，字段不存在时跳过，不影响核心功能]

### Key Entities

- **导出配置**: 包含目标格式（Obsidian / HTML）和输出目录路径
- **导出结果**: 包含生成的文件路径列表、文件总数、执行耗时
- **Obsidian 页面**: 单个 Markdown 页面的内容表示，包含元信息、正文、双向链接集合
- **HTML 包**: 自包含的交互式可视化产物，包含图谱数据、力导向布局引擎、样式定义

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Obsidian Vault 导出（500 节点图谱）在 5 秒内完成，输出文件结构正确 `[FR-001~FR-005]`

- **SC-002**: HTML 导出（500 节点图谱）在 3 秒内完成，生成单文件大小 < 2 MB `[FR-006]`

- **SC-003**: 生成的 HTML 在 5,000 节点规模下，浏览器交互（拖拽、搜索、过滤）保持 60fps `[FR-012]`

- **SC-004**: 所有生成的 Obsidian 文件名符合命名规范（无非法字符，连续 `-` 已合并，长度 < 200），在 Obsidian 中打开无报错 `[FR-005]`

- **SC-005**: 生成的 Obsidian vault 中，社区页和 God Node 页之间的双向链接可在 Obsidian 中正确解析和跳转 `[FR-004]`

- **SC-006**: graph.json 缺失时，CLI 输出友好提示（非堆栈错误），退出码为非零 `[FR-015]`

- **SC-007**: 单元测试覆盖两种导出格式的核心逻辑，集成测试覆盖"图谱数据 + 社区数据 → vault/html 产物"的端到端路径；边界测试覆盖空图、孤立节点图、含特殊字符节点 ID 三种场景 `[FR-001~FR-012]`

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|-----|------|
| **新增功能模块** | 6 | Obsidian 导出器、HTML 导出器、HTML 模板、导出类型定义、CLI 命令、d3 构建脚本 |
| **新增/修改接口** | 4 | Obsidian 导出函数、HTML 导出函数、CLI export 命令、文件名 sanitize 函数 |
| **依赖新引入数** | 0 | d3-force 以构建期内联方式嵌入，不增加运行时依赖 |
| **跨模块耦合** | 是 | 需修改 CLI 入口和参数解析两个现有模块，涉及 2 处改动点 |
| **复杂度信号** | 1 | 大图优化（> 5,000 节点网格布局降级）的条件分支控制 |
| **总体复杂度** | **MEDIUM** | 模块数 6 + 跨模块耦合 + 1 个复杂度信号 |

**GATE_DESIGN 建议**：纯函数管道设计降低了架构风险。重点审查 d3 内联 HTML 大小约束（< 2 MB）和文件名 sanitize 边界覆盖完整性。

---

## Clarifications

### Session 2026-04-12

**Q1: `--output-dir` 默认值是 `vault/` 还是 `_meta/export/`？**
User Story 1 示例写 `vault/`，FR-014 和 User Story 3 的 Independent Test 写 `_meta/export/`，存在矛盾。
[AUTO-CLARIFIED: `_meta/export/` — 与现有 spectra 工具链约定一致（`_meta/` 是所有工具产物的标准输出目录），User Story 1 中 `vault/` 仅为演示性示例，FR-014 为规范性定义。已更新关键概念约束和 FR-014。]

**Q2: `sanitizeFilename()` 的完整规则（空格、连续替换符、大小写）？**
spec 仅列出需移除的字符，未说明空格处理、连续 `-` 合并、大小写规范化策略。
[AUTO-CLARIFIED: 空格→`-`，连续 `-` 合并为单个，首尾 `-` 去除，大小写保持原样不规范化 — 防止 `src--utils--helper` 类难读文件名，同时大小写规范化在无统一约定时易破坏可读性。已更新 Edge Cases 和 FR-005。]

**Q3: d3 bundle 获取策略（手动复制 vs 构建脚本）？**
spec 仅说"内联字符串方式嵌入"，未说明 bundle 来源和更新机制。
[AUTO-CLARIFIED: 构建脚本 `scripts/inline-d3.ts` 在构建期读取 `node_modules/d3-force/dist/d3-force.min.js` 并写入 `html-template.ts` 常量 — 相比手动复制，构建脚本可在 `npm install` 后自动更新，版本号可追踪，符合 zero-manual-sync 原则。已新增 FR-006a 和更新 FR-018。]

**Q4: 大图优化（> 5,000 节点）网格布局的计算公式？**
FR-012 仅说"使用预计算网格布局"，未定义列数公式和节点间距。
[AUTO-CLARIFIED: 列数 = `Math.ceil(Math.sqrt(nodeCount))`，节点间距固定 60px — sqrt 均匀网格是最简单且视觉均匀的降级策略，60px 间距在常见 1080p 屏幕下可容纳约 1,800 个节点不重叠。已更新 FR-012 和 Edge Cases。]

**Q5: 空图（0 节点）和有节点无边两种边界场景的导出行为？**
spec Edge Cases 覆盖了数据缺失、特殊字符、大图降级，但未定义这两种合法但极端的图状态。
[AUTO-CLARIFIED: 空图→graceful exit（提示"图谱为空，无可导出内容"，退出码非零，不生成空文件）；有节点无边→正常导出（HTML 节点静止分散，Obsidian 邻居列表显示"无直接依赖关系"）— 空图无任何可导出内容，graceful exit 与其他缺失场景一致；孤立节点图是合法图状态，阻断导出会破坏用户工作流。已更新 Edge Cases、FR-015、SC-007。]
