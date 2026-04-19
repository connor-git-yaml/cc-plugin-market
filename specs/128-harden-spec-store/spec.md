# Feature Specification: Harden — SpecStore Abstraction & Source-Kind Metadata & Dev Hot Reload

**Feature Branch**: `128-harden-spec-store`
**Created**: 2026-04-19
**Status**: Draft
**Input**: User description: "F2 Harden — 根治 Fix 126/127/128 修复链反映的三个深层架构风险：(1) 存储状态模型不清晰导致的 'collectedModuleSpecs vs existingStoredSpecs' 类 bug；(2) canonical/derived/bundle 边界模糊导致的 spec 副本污染；(3) source/dist 同步靠手动重启 MCP 进程的开发体验问题。同时主动自查 Spectra 自己是否有和 Graphify 同源的依赖方向倒置 bug。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 增量模式下的状态模型一致性（Priority: P1）

一个维护大型文档库的开发者，在代码只改了 1 个文件的情况下跑增量 batch，希望生成的 README / graph / 覆盖率报告都能**基于"所有已知 spec"**计算（包括本次没重跑的），而不是只基于"本次生成的"。同时，当开发者想查询"这个项目当前总共有多少个模块 spec"时，应该有一个**唯一、权威**的数据源，而不是每个消费方（README 生成器、graph builder、coverage auditor）各自手动合并新生成和历史存储的列表。

**Why this priority**: 这正是 Fix 127 的本质问题 —— 增量模式下 README footer 显示"0 个模块规范"是因为它用了 `collectedModuleSpecs`（本次生成）而非"所有已知 spec"。Fix 127 用 `allIndexSpecs` 的补丁修好了那一处，但**类似的手动合并发生在多处**（graph builder、coverage auditor、index generator、cross-reference builder 都有自己的合并逻辑）。如果不建立统一抽象，每个新 Feature（F3 技术债、F4 语义锚定）都要重新写一次合并逻辑，同样的 bug 会以新形态再次出现。

**Independent Test**: 对任何一个已有完整 spec 库的项目做以下动作并验证：
1. 跑一次全量 batch（force）→ 所有消费方看到的 spec 集合规模 = N
2. 删除其中一个源文件，跑增量 batch（无 force）→ 所有消费方看到的 spec 集合规模 = N-1（因为源被删除） 或 N（如果源还在，N 的一个元素来自缓存）
3. 不做任何改动，跑增量 batch → 所有消费方看到的 spec 集合规模 = N（全部走缓存）
4. 强制 AST-only（跳过 LLM）跑一次 → 所有消费方看到的 spec 集合规模仍 = N

在所有 4 种场景下，**5 个不同消费方（README、graph、coverage、index、cross-ref）必须都报告一致的 spec 数量**。

**Acceptance Scenarios**:

1. **Given** 一个已有 spec 库的项目（之前跑过 batch），**When** 在不修改任何源文件的情况下重新跑 batch，**Then** README 底部的模块计数、graph.json 的节点数、coverage-report 的模块覆盖数应**完全一致**
2. **Given** 项目中存在 5 个模块 spec，**When** 执行增量 batch 只重生成 1 个模块，**Then** 所有消费方的 spec 总数仍为 5（1 新 + 4 缓存）
3. **Given** 一次 batch 生成过程中出现部分失败（某个模块 LLM 调用失败），**When** 查看汇总报告，**Then** 所有消费方对"有效 spec 集合"的认知一致（失败模块不计入）

---

### User Story 2 - Bundle 副本不再污染分析结果（Priority: P1）

一个开发者注意到：bundle 目录（`specs/bundles/developer-onboarding/docs/modules/`）下的 spec 文件是从 `specs/modules/` 复制过去作为文档包输出的。这些副本**和原始 spec 的 frontmatter 完全一样**。当下次跑 batch 时，任何扫描所有 spec 的分析（图构建、覆盖率审计、spec 漂移检测）必须**区分权威源和衍生副本**，不能把副本当成"也是一个独立的 spec"来处理。

**Why this priority**: 这是 Fix 128 的本质问题 —— graph builder 的 `resolveSpecForSource` 遇到 3 个相同 sourceTarget 的 spec 时按字母序 tie-break，让 architecture-review bundle 永远胜出。Fix 128 的修复是"用目录名排除"（workaround），但如果以后新增其他衍生目录（如 `specs/translated/zh/`、`specs/published/html/`）就得加入排除名单。根本解决是让每个 spec **自己声明自己的身份**（canonical / derived / bundle_copy），分析器按身份决策。

**Independent Test**: 在一个有 3 层副本的项目（canonical + developer bundle + architecture bundle，各有 5 个同名 spec 共 15 个文件）上验证：
1. graph builder 产出的节点数恰好 = canonical 数量（不是 3 × canonical）
2. 覆盖率审计只对 canonical 做断链检查，bundle 副本不参与
3. spec 漂移检测不会把 bundle 副本当成"未更新的 spec"误报
4. 未来新增一类衍生产物（如 "translated"），不需要修改任何分析器代码，只需在复制时打上 derived_kind 标签

**Acceptance Scenarios**:

1. **Given** 项目的 specs 目录下存在 5 个 canonical spec 和 10 个 bundle 副本（共 15 个 .spec.md 文件），**When** 跑 graph 构建，**Then** graph 节点数 = 5，且每条依赖边的 source/target 都指向 canonical 路径
2. **Given** 用户打开一个 bundle 副本 spec 文件，**When** 查看其 frontmatter，**Then** 能清楚看到该 spec 属于哪种身份（canonical vs bundle copy）、派生自哪个源 spec（若是副本）
3. **Given** 一个副本 spec 在 bundle 生成后被用户手误编辑，**When** 下次跑 batch，**Then** 系统能检测到副本偏离了其源，给出明确的 warning（而不是把副本当成新的 canonical spec）
4. **Given** 未来新增一类衍生产物（如 published HTML 版本），**When** 该衍生物以相同的"声明身份"约定写入 specs 目录，**Then** 现有分析器自动忽略它，不需要改代码

---

### User Story 3 - Dev 模式下的 MCP 热重载（Priority: P2）

一个正在开发 Spectra 新 Feature 的工程师，修改源代码后**希望立即在 MCP 调用中看到效果**，不必 (a) 手动跑 `npm run build`、(b) 手动找到并杀掉 MCP 进程、(c) 等 AI 助手自动重启 MCP 连接。整个 dev-to-test 周期应该是**改代码 → 保存 → 下一次 MCP 调用直接用新代码**。

**Why this priority**: 这是 Fix 126 P0 的本质问题 —— Volta-installed `spectra` 和项目 `dist/` 是同一 inode，但 MCP server 作为长期进程缓存了老版本模块（ESM import cache）。Fix 126 靠"kill -9 几个进程"workaround，但这意味着**每次 Spectra 开发者改代码都要手动重启 MCP**。虽然这不是产品用户面向的问题，但**严重拖慢 Spectra 本身的迭代速度**，间接让所有新 Feature 的开发成本上升 20-30%。

**Independent Test**: Spectra 开发者在本地做以下动作并测量开发体验：
1. 修改一行源代码（如修改 README 生成器的某个标题文字）
2. 保存文件
3. 在同一 AI 助手会话里立即再次调用 MCP batch 工具
4. 验证 MCP 调用的输出反映了刚才的代码修改

从"保存"到"看到新行为"的时间应该 < 5 秒。

**Acceptance Scenarios**:

1. **Given** dev 模式启动 Spectra，**When** 开发者修改源文件并保存，**Then** 后续 MCP 工具调用使用新代码，无需任何手动干预
2. **Given** dev 模式启动 Spectra，**When** 源代码有语法错误无法编译，**Then** MCP 服务器给出清晰的错误反馈（而不是静默缓存老版本或崩溃）
3. **Given** 非 dev 模式（生产场景）下安装的 Spectra，**When** 用户正常使用，**Then** 行为和现在一致（不引入 watch / reload 开销），dev-only 能力不污染生产

---

### User Story 4 - 依赖方向自查（Priority: P2）

一个质量工程师发现：在 Graphify 的对比测试中，Graphify 的图谱有 4 条**依赖方向倒置**的边（validator → parser 而非真实的 parser → validator）。Spectra 也基于类似的跨模块 cross-reference 推断生成依赖图 —— **Spectra 是否有同源 bug**？质量工程师希望系统地自查，对所有跨模块依赖边做方向正确性审计，并修复发现的错误。

**Why this priority**: 这是从测试中发现的**同类风险审计**，不是新能力。修不修完全看自查结果。标 P2 因为：(a) 未必存在，(b) 如果存在，修复工作量未知。做自查本身低成本（1-2 天），但修复可能扩展。

**Independent Test**: 对至少 3 个不同规模项目（本仓库、graphify 示例、第三方开源项目）的 Spectra 生成 graph.json，人工或脚本审计每条跨模块边：
- 方向是否和源码 import 关系一致？
- 若不一致，是否属于"被调用者指向调用者"的系统性模式？
- 若属于，是哪个环节（AST 提取 / panoramic builder / docstring rationale）引入的？

**Acceptance Scenarios**:

1. **Given** Spectra 对一个已知依赖关系的项目生成了 graph.json，**When** 自查工具扫描所有跨模块边，**Then** 给出一份"方向正确 / 方向可疑 / 方向错误"的分类报告
2. **Given** 自查发现至少 1 条确认错误的边，**When** 审查根因，**Then** 能明确定位到具体代码模块（AST 提取器 vs panoramic builder vs cross-reference 推断器）
3. **Given** 修复根因后重新生成 graph.json，**When** 再次跑自查工具，**Then** 之前报告的错误边不再出现，且没有引入新的错误边（regression test）

---

### Edge Cases

- **SpecStore 查询未初始化的场景**：在 batch 还没跑过的项目上查询 "所有已知 spec"，应返回空集合而非报错
- **一个 canonical spec 被删除后查询**：读取仍然可能命中磁盘上的旧副本，SpecStore 必须主动识别 orphan（源文件不存在的 spec）并从查询结果中排除
- **souce_kind 字段缺失的历史 spec**：向后兼容视为 canonical（不会误判为衍生副本）
- **副本和源同时被修改**：若副本在 bundle 生成后被手误编辑导致偏离源 spec，分析器应 warning 而不是静默忽略
- **Dev 模式下源代码有循环依赖**：热重载不能引入新的循环依赖，必须清晰地失败（而非部分加载导致 zombie 状态）
- **Dev 模式下 MCP 调用正在执行中**：正在执行的调用不能被热重载中断，必须用老代码跑完；新调用才用新代码
- **CI 环境下的 dev 模式**：必须有明确方式禁用 dev 模式下的 watch/reload 开销（不能在 CI 里意外启动 watcher）
- **依赖自查无 ground truth 的项目**：对没有清晰 import 图的项目（如纯 markdown corpus），自查应优雅降级不做判断，而不是报告假阳性

## Requirements *(mandatory)*

### Functional Requirements

**存储状态模型（P1）**

- **FR-001**: 系统必须提供一个单一权威的"所有已知 spec"查询入口，取代现有多个消费方手动合并"本次生成"和"历史存储"的模式
- **FR-002**: 该入口必须支持至少 3 种视图：所有已知 spec（canonical + fresh + cached）、仅本次 batch 生成的 spec、仅磁盘已有的 spec
- **FR-003**: README 生成、graph 构建、覆盖率审计、spec 索引、cross-reference 全部必须迁移到统一入口，不得保留自行合并的遗留逻辑
- **FR-004**: 查询入口必须能识别 orphan（源文件已被删除但 spec 还在磁盘上）并提供"排除 orphan"的查询选项

**身份标识（P1）**

- **FR-005**: 每个 spec 产物的元数据必须携带明确的身份标识字段，区分至少 3 类：canonical（权威原始 spec）、derived（从 canonical 派生但非副本，如 translated / summarized）、bundle_copy（bundle 打包生成的原始内容副本）
- **FR-006**: 身份标识必须是 spec 自己声明的，不依赖路径推断或目录名约定
- **FR-007**: 所有扫描 spec 的分析器必须按身份标识决策：默认只处理 canonical，对 derived/bundle_copy 显式 opt-in
- **FR-008**: 对历史遗留 spec（缺少身份标识字段）必须向后兼容：无字段时默认视为 canonical
- **FR-009**: 当创建衍生产物（如生成 bundle 副本）时，复制过程必须主动设置正确的身份标识和"派生自哪个源"引用

**Dev 模式热重载（P2）**

- **FR-010**: 系统必须提供 dev 模式入口（可通过环境变量、命令行参数或配置文件启用），在该模式下源代码变更能被自动检测
- **FR-011**: Dev 模式下，源代码修改应在 < 5 秒内被下一次工具调用识别为"新代码"
- **FR-012**: Dev 模式下的语法错误或编译失败必须通过明确的错误反馈表达，不能静默缓存或崩溃
- **FR-013**: 非 dev 模式（默认模式）下，系统行为和当前一致，不得引入 watcher 开销或其他 dev-only 副作用
- **FR-014**: CI 环境必须有显式机制禁用 dev 模式（避免意外启动 watcher 影响 CI 性能）

**依赖方向自查（P2）**

- **FR-015**: 系统必须提供跨模块依赖边的方向审计工具（脚本或 CLI 命令），能接收一个 graph.json 输出并产出"方向分类报告"
- **FR-016**: 审计报告必须对每条跨模块边分类至少 3 档：方向确认正确、方向可疑（无 import 证据但有其他线索）、方向确认错误（和源码 import 相反）
- **FR-017**: 审计发现错误边时必须能定位到具体生成环节（AST 提取 / panoramic builder / cross-reference 推断），便于定向修复

### Key Entities *(include if feature involves data)*

- **SpecStore**：统一的 spec 查询入口。封装"本次生成 + 历史存储 + orphan 识别 + 身份过滤"等所有语义。单一真实来源，所有消费方查询都走它。
- **Spec Identity**：每个 spec 产物携带的身份标签 + 派生关系。例：canonical（权威）、derived（衍生，如翻译）、bundle_copy（复制）。身份决定分析器是否处理它。
- **Orphan Spec**：磁盘上存在但其源文件已被删除的 spec。SpecStore 必须能识别并在查询时按需排除。
- **Dev Reload Context**：dev 模式下 spectra 进程的运行时上下文，跟踪源代码版本、watcher 状态、正在执行的调用队列等。
- **Direction Audit Report**：依赖方向自查产出的结构化报告。含每条跨模块边的方向分类、置信度、怀疑根因。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 所有 5 个主要消费方（README 生成、graph 构建、coverage 审计、index 生成、cross-reference 构建）对"项目当前 spec 总数"的报告完全一致，在以下 4 种场景中 0 偏差：全量、增量、无改动重跑、AST-only 降级
- **SC-002**: 在一个有 3 层副本的项目（15 个 .spec.md 跨 3 个目录）上，graph 节点数 = 5（canonical 数量），且所有边都指向 canonical 路径；现有 Fix 128 的 bundle 目录排除规则可被完全移除而不影响正确性
- **SC-003**: 未来新增衍生产物类型（如 translated、published）时，**不需要修改任何分析器代码**，只需在写入时设置身份标识字段
- **SC-004**: Dev 模式下"修改代码 → 下次 MCP 调用生效"的 E2E 时间 ≤ 5 秒，非 dev 模式的性能回归 ≤ 2%
- **SC-005**: 依赖方向自查工具能在 10 分钟内跑完本仓库（当前 ~125 个 feature dir）的全量审计，输出可读报告
- **SC-006**: 如果自查发现了有方向倒置 bug，修复后 regression test 守卫（检查同一项目的 graph.json 不再出现同类错误）必须纳入 CI
- **SC-007**: 所有现有单元测试和 golden-master 测试在迁移到 SpecStore 后仍全部通过（SC-006 的 regression test 除外，它属于新增）

## Assumptions

1. **Fix 127 的 allIndexSpecs 补丁是正确方向**：SpecStore 抽象本质是对 Fix 127 的泛化 —— Fix 127 只修了 README 一处，SpecStore 统一所有消费方。
2. **Bundle 生成链路是唯一衍生产物源**：当前只有 `docs-bundle` 会产出 spec 副本。若未来新增其他衍生产物（翻译、HTML 发布），须走相同的身份标识机制。
3. **Dev 模式的热重载不追求完美**：只需要"改代码 → 下次调用生效"，不需要"改代码 → 正在执行的调用立即切换"。后者需要更复杂的状态迁移，不在本 Feature 范围。
4. **依赖方向审计是"调查 + 修复"两阶段**：若自查结果是"Spectra 没有同源 bug"，FR-015/FR-017 仍有价值 —— 作为 regression 守卫。若有 bug，可能需要 F2 的 scope 扩展或派生新 fix Feature。
5. **向后兼容**：所有新增的元数据字段必须 optional，缺失视为合理默认值（身份 = canonical，tokenUsage = unknown）。

## Out of Scope *(explicit non-goals)*

- **文件级 hash 细粒度增量**（改进现有 mtime 或 skeletonHash 机制）→ 后续迭代或 F5 Reading UX
- **Orphan spec 的自动清理**（识别出 orphan 后需要手动决策，本 Feature 不做自动删除）
- **Spec 版本历史追踪**（多次 batch 之间 spec 如何演进）→ 独立 Feature
- **LLM 成本透明化 / Budget 控制** → F1 Reveal
- **图能力上首屏 / MCP 工具文档** → F1 Reveal
- **跨模块 Hyperedges / 语义锚定** → F4 Anchor
- **自然语言问答** → F5 Reading UX

## Dependencies

- **不依赖其他 Feature**（可独立启动）
- **但和 F1 Reveal 可并行**：F1 添加 tokenUsage 字段、F2 添加 source_kind 字段。两个 PR 在 frontmatter schema 层面可能冲突，需要在各自 plan 阶段做简单的字段合并约定
- **Phase 1 能力保留**：所有现有 pipeline（multi-language、Monorepo 索引、LLM 增强降级）必须无回归

## Future Feature Integration

本 Feature 建立的基础设施被后续 Feature 直接复用：

- **F3 Debt Intelligence**：技术债 spec 节点会通过 SpecStore 统一注册；技术债的身份标识可能是新增的 debt 子类型
- **F4 Anchor**：函数级语义锚定需要在现有 canonical spec 上扩展，若身份标识不清晰会导致锚点挂到副本上
- **F5 Reading UX**：`--mode=reading` 轻量模式直接查询 SpecStore，不必知道磁盘布局细节
- **F6 Integrate (Vision)**：若最终要和 Graphify 深度集成，Spectra 侧的 SpecStore 是唯一对接点
