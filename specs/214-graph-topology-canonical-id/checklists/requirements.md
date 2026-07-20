# 需求质量检查清单：Feature 214 Graph Topology / Canonical Symbol ID（v2，对照修订版 spec.md）

**范围**：`spec.md`（2026-07-20 经 Codex 对抗审查 3 critical + 8 warning 修订后版本）的 FR/NFR/SC/Edge Cases/Out of Scope，对照 `research/tech-research.md` §2/§5/§6/§7/§8 核验。
**判定**：PASS（满足）/ PARTIAL（部分满足，需在 plan 阶段补齐）/ FAIL（不满足，需回 spec 修）。
**v2 说明**：本版为重新执行的完整检查（非增量 diff），修正 v1 摘要计数与逐条标签不一致的错误（Codex W8），并对 v1 中被源码证伪的 PASS 项重新核验。

## Content Quality

- **CHK-001** [PASS] 无实现语言/框架层泄漏：正文以行为约束表述，文件路径/行号均标注为"锚点"证据而非需求指令本体。
- **CHK-002** [PASS] 聚焦用户价值：三个 User Story 均从 Agent/开发者查询体验出发。
- **CHK-003** [PARTIAL] 面向非技术利益相关者：`contains` 边、canonical ID、provenance、graph-only 等内部术语密集，非技术读者仍需借助调研文档理解；本 feature 属纯底座技术债修复，判定为可接受但非严格达标。
- **CHK-004** [PASS] 必填章节齐全：User Scenarios、Requirements（FR+NFR）、Key Entities、Success Criteria、Out of Scope、复杂度评估、需求模糊点说明均已填写，新增"范围澄清"段落进一步明确边界。

## Requirement Completeness

- **CHK-005** [PASS] 无 `[NEEDS CLARIFICATION]` 残留；原两处 `[AUTO-RESOLVED]` 保留，新增三条 Codex review 修订记录（C1/C2/C3）均给出明确裁决依据。
- **CHK-006**（v1 曾标 PASS，本次重新核验）[PASS] FR-001~FR-011 可测性：v1 版本 FR-002 错误限定 TS/JS-only 与 `python-mapper.ts:377` 实际提取 Python class member 的事实矛盾，已被 C1 修订为语言无关规则并补充"member 仅一条 contains 入边"约束；FR-009 原"MCP 四工具统一 fuzzy 兜底"表述与 `graph_node`/`graph_path` 精确匹配设计矛盾，已被 C2 修订为按工具分层的准确合同。两处源码矛盾均已消除，判定转为真 PASS。
- **CHK-007** [PARTIAL] SC 绑定具体验证测试文件/位置：SC-002 固定了分母口径（exports+members，排除集合=空）、SC-004 固定了比较字段（节点 id 集合/路径节点序列/影响面列表）、SC-005 给出预期变化 allowlist，可测性显著增强；但 SC-001~SC-004 仍未指向具体测试文件名（如 round-trip 测试模块、等价矩阵 fixture 位置），仅 SC-005 有命令级绑定。建议 plan 阶段为每条 SC 补"验证载体"映射。
- **CHK-008**（v1 曾标 PASS，本次重新核验）[PASS] 成功标准可测量：SC-001（重复对数=0）、SC-002（覆盖率=100%，分母口径已在 spec 内固定，不再依赖测试自定义排除口径）、SC-003（同层 round-trip + 跨层 invariant 双轨断言）、SC-004（比较字段已列举）、SC-005（allowlist 已列举）均为量化或布尔判定；v1 中 SC-002/004/005 缺乏固定分母/比较字段/allowlist 的可测性缺口已在本版补齐，判定为真 PASS。
- **CHK-009** [PASS] 成功标准技术无关：SC 均以结果表述，未绑定具体实现路径。
- **CHK-010** [PASS] 验收场景已定义：User Story 1 新增 Python class member（method/property/classmethod/staticmethod）与 TS 对称场景（Acceptance Scenario 2）；User Story 2 拆分 `impact`/`context` 与 `graph_node`/`graph_path` 两类查询合同的独立场景（Acceptance Scenario 2/3），与 FR-009 分层合同对齐。
- **CHK-011**（v1 曾标 PASS，本次重新核验）[PASS] 边界条件已识别：v1 版本存在两处结构性缺陷——(a) legacy `#` 格式检测未区分 symbol 节点与 api-surface 节点，存在对 API 节点误报为 stale 的实现陷阱（C3 关联）；(b)"存量旧图仍可被 fuzzy 查询"与"legacy 图加载即 stale→重建"两条 Edge Case 逻辑互斥。本版已新增独立 Edge Case"API-surface `#` ID 不得触发 legacy-stale 误报"，并将原互斥的一条拆分为"legacy 持久化图"（一律 stale→重建，无查询路径）与"legacy 格式查询字符串打到已重建新图"（经 fuzzy 兜底 best-effort）两个不冲突的独立合同，另新增 member 同名折叠 Edge Case。缺口已闭合，判定转为真 PASS。
- **CHK-012** [PASS] 范围边界清晰：Out of Scope 新增"legacy `#`→canonical 确定性翻译器不新建""api-surface API 节点 ID 格式不统一""同名 member 精细区分不做"三项，均与新增 FR-003/FR-008/FR-009/FR-011 一一对应，排除理由充分。
- **CHK-013** [PASS] 依赖和假设已识别：新增"范围澄清"段落显式声明 canonical 收敛只作用于通用 symbol 生产路径（不含 api-surface），是本版新增的关键假设澄清。

## 回归护栏 NFR 与测试锚点对应性（调研 §8 + 本轮新增 W2 专项核验）

- **CHK-014** [PASS] NFR-001（F193）对应 R-1/R-3：FR-008 已明确 legacy 检测须按 node kind/provenance 过滤，对旧格式 symbol 节点触发 stale、对 API 节点不误报，与 R-3 缓解策略及本轮新增的 API-surface 边界约束一致。
- **CHK-015** [PASS] NFR-002（F183）对应 R-2：`normalizeGraphForWrite` 出口内聚要求未变，与调研 R-2 一致。
- **CHK-016** [PARTIAL] NFR-003（F182）对应 R-4：spec 已把"增量更新路径对新边/新 ID 的处理"列为 Edge Case 并在 NFR-003 重申，但调研 R-4 本身仍标注"[待核实]，未读取增量护栏具体实现"——即该护栏要求建立在尚未证实的假设上；复杂度评估段落虽提及"须落实...R-4"，但属评估区块而非 Requirements 正文强约束。建议 plan 阶段把"读取增量护栏实现确认 contains 边接入方式"列为前置任务。
- **CHK-017** [PASS] NFR-004（F195）对应 R-5：2.8s 量级基准不显著劣化要求"以 baseline 重跑结果为准"，与 R-5 缓解策略一致。
- **CHK-018** [PASS] NFR-005（F196）对应 R-6：本版依据 FR-009 分层合同重新表述——`impact`/`context` fuzzy 兜底、`graph_node`/`graph_path` 精确匹配——消除了 v1 中"四工具统一 fuzzy"与源码事实矛盾的问题，与 R-6 缓解策略语义一致。
- **CHK-019**（v1 中标签书写有误，本次重申并核对为 PASS）[PASS] NFR-006 覆盖全量验证零失败 + 前端/panoramic-query 不崩溃，且显式标注"前端是否硬编码 `#` 分隔符解析为待核实项，plan 阶段须先确认"，未越权预先承诺改法。
- **CHK-020** [PASS] NFR-007（与 F212 隔离）为流程护栏，与 M9 doc Gate 0 约定一致。
- **CHK-021**（新增，对应 W2/FR-011）[PASS] NFR-008 明确 contains 边 MUST NOT 隐式改变 `graph_community`/`graph_god_nodes` 耦合度/聚类统计口径，默认预期与 `god-node-analyzer.ts:45` 既有"过滤纯 contains 节点"约定一致；若 plan 阶段决定纳入耦合统计须显式更新 baseline 并给理由，且要求"relation-filter 行为测试覆盖"，需求本体可测性充分，判定 PASS（测试文件命名细节留待 plan，与 CHK-007 缺口同源不重复计列）。

## Feature Readiness

- **CHK-022**（对应 v1 CHK-021，重新核验）[PASS] 所有 FR 均有对应验收标准：FR-001~FR-011（含新增 FR-011 member 同名折叠）均可映射到 User Story 1/2/3 的 Acceptance Scenarios、Edge Cases 或 SC-001~SC-005 至少一项；FR-011 对应 Edge Case"member 同名折叠"与 Out of Scope"同名 member 精细区分不做"形成闭环。
- **CHK-023** [PASS] 用户场景覆盖主要流程：建图（US1，新增 Python class member 对称场景）、查询去重与分层查询合同（US2）、双路径 provenance 过滤等价性验证（US3）三条覆盖完整因果链。
- **CHK-024** [PASS] 功能满足 SC 中定义的可测量成果：US1↔SC-002、US2↔SC-001/SC-004、US3↔SC-003，新增 FR-011↔Edge Case（member 折叠）映射关系补全，无缺口。
- **CHK-025** [PARTIAL] 规范中无实现细节泄漏：FR-003/FR-006/FR-008/FR-011 等条款仍附带具体文件路径与行号锚点（如 `python-mapper.ts:377`、`god-node-analyzer.ts:45`），虽标注为证据而非指令，但读者需并读 FR 正文的 MUST 语句与"范围澄清"段落才能避免把锚点行号误当强制实现路径的风险，与 v1 判定一致，未随本轮修订改变。

## Out of Scope 与 FR 重叠矛盾检查

- **CHK-026** [PASS] Out of Scope 第一条（B2 质量门）与 FR 集合无重叠：FR-001~FR-011 均聚焦 contains 边/ID 收敛/三层合同/等价矩阵/member 折叠，未触及 duplicate/orphan/dangling 检测逻辑本身。
- **CHK-027** [PASS] "query-helpers.ts 物理搬迁"排除项与 FR-006（新增共享 `parseCanonicalSymbolId` 工具）不矛盾：新增 vs 搬迁是两个不同动作，边界清晰。
- **CHK-028** [PASS] "graph-builder.ts 整体重构"排除项与 FR-005（三层转换合同，本版已拆分为同层 round-trip / 跨层 invariant 两类测试）不矛盾，FR-005 范围收紧后与该排除项的边界更清晰。
- **CHK-029**（新增，核验本轮新增排除项）[PASS] 新增排除项"api-surface API 节点 ID 格式统一不做"与 FR-003/FR-008 的"范围澄清"（canonical 收敛仅限通用 symbol 生产路径）完全对应，无矛盾；新增排除项"同名 member 精细区分不做"与 FR-011（沿用现有折叠规则）语义一致，无矛盾。

## 版本 / 迁移约定专项核验

- **CHK-030**（对应 v1 CHK-028，本次重新核验）[PASS] 三个版本字段已在 FR-010 正文完整覆盖并给出明确决策：`SNAPSHOT_WRAPPER_VERSION` MUST bump（2.0→3.0，触发 format-stale 全量重建）；`UNIFIED_GRAPH_SCHEMA_VERSION` SHOULD bump；`GraphJSON.schemaVersion` MUST **保持** `'2.0'` 不 bump，并给出理由（ID 分隔符变更不改变 GraphJSON 结构性 schema，改用 FR-008 按 node kind 限定的内容级 legacy 检测承担迁移识别职责）。v1 中"第三个版本字段未进入需求正文"的缺口已闭合，判定转为真 PASS。

---

## 摘要

- **总条数**：30（CHK-001~CHK-030）
- **PASS**：26 条；**PARTIAL**：4 条（CHK-003、CHK-007、CHK-016、CHK-025）；**FAIL**：0 条（与上方逐条标签核对一致：26 PASS + 4 PARTIAL + 0 FAIL = 30）
- **v1 缺口修复确认**：CHK-006（FR-002/FR-009 源码矛盾已消除）、CHK-008（SC 可测性缺口已补齐）、CHK-011（legacy 检测误报边界已闭合、Edge Case 互斥已拆分）、CHK-030（GraphJSON.schemaVersion 决策已进入需求正文）均由 v1 的 PARTIAL/证伪风险转为本版真 PASS。
- **剩余缺口归属 — plan 阶段**：CHK-007（SC-001~SC-004 未绑定具体测试文件名/验证载体）、CHK-016（NFR-003 依赖的 F182 增量护栏行为仍是调研阶段"待核实"假设 R-4，需 plan 阶段先读代码核实）。
- **剩余缺口归属 — 非阻断，接受现状**：CHK-003（非技术可读性，判定可接受）、CHK-025（锚点行号证据与需求指令需并读理解，未构成实质歧义）。
- **无需回 spec/clarify 阶段的项**：本版 spec 修订已闭合 v1 所有源码矛盾与结构性缺口，剩余 4 项 PARTIAL 均为 plan 阶段前置任务或已接受的非阻断项，可进入 plan 阶段。
