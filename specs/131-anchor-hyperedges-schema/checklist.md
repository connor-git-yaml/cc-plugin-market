# Requirements Checklist: F4 Anchor — 函数级语义锚定 + Hyperedges + graph.json schema v2.0

**Purpose**: 对 spec.md 执行质量审查，确认规范满足进入 GATE_DESIGN 的最低质量要求
**Created**: 2026-04-19
**Feature**: `specs/131-anchor-hyperedges-schema/spec.md`
**审查者**: checklist 子代理（Phase 3 并行执行）

---

## 1. 完整性检查（Content Completeness）

### 1.1 Story 完整性

- [x] CHK001 Story 1 含完整 User Story 描述、优先级（P1）、独立可测试性说明、≥3 个验收场景（共 4 个）
- [x] CHK002 Story 2 含完整 User Story 描述、优先级（P1）、独立可测试性说明、≥3 个验收场景（共 5 个）
- [x] CHK003 Story 3 含完整 User Story 描述、优先级（P1，带 feature flag）、独立可测试性说明、≥3 个验收场景（共 5 个）
- [x] CHK004 Story 4 含完整 User Story 描述、优先级（P1）、独立可测试性说明、≥3 个验收场景（共 5 个）

### 1.2 FR/NFR/AC 编号连续性

- [x] CHK005 FR-001 至 FR-026 编号连续，无跳号，无重复
- [x] CHK006 NFR-001 至 NFR-007 编号连续，无跳号，无重复
- [x] CHK007 AC-001 至 AC-012 编号连续，无跳号，无重复

### 1.3 FR 标注完整性

- [x] CHK008 所有 FR 均标注 `[必须]` 或 `[可选]`（FR-001～FR-024 为 `[必须]`，FR-025 为 `[可选]`，FR-026 为 `[必须]`）
- [x] CHK009 所有 FR 均标注对应的 Story（如 `[对应 Story 1]`、`[对应 Story 2, Story 3]`）

### 1.4 验收准则（AC）可测量性

- [x] CHK010 AC-001：`schemaVersion` 字段值为 `"2.0"`，客观可验证
- [x] CHK011 AC-002：`≥10 条` 边且格式要求明确，客观可验证
- [x] CHK012 AC-003：人工抽样 ≥20 条，假阳性率 < 20%，有量化标准——但"语义上确实关联"依赖人工判断，存在主观性；已标注为"人工验证"，可接受
- [x] CHK013 AC-004：`≥1 个` hyperedge，`nodes` 数量 ≥3，可验证；label/rationale 内容确认标注为"人工确认"，可接受
- [x] CHK014 AC-005：零新增语义边、`hyperedges` 为空、返回码 0，完全客观可验证
- [x] CHK015 AC-006～AC-012：均含具体可测量条件，无主观形容词（如"好用"、"合理"）

### 1.5 必填章节检查

- [x] CHK016 背景与目标已完成
- [x] CHK017 用户故事与验收场景已完成（4 个 Story）
- [x] CHK018 功能需求已完成（FR-001～FR-026）
- [x] CHK019 非功能需求已完成（NFR-001～NFR-007）
- [x] CHK020 关键实体（Key Entities）章节已完成
- [x] CHK021 验收准则（AC）章节已完成（12 条）
- [x] CHK022 约束（Constraints）章节已完成，含读写边界表格、基线兼容性、交付顺序约束
- [x] CHK023 Out of Scope 明确列出（5 项排除，含归属说明）
- [x] CHK024 开放问题（Open Questions）章节已完成（3 条）
- [x] CHK025 复杂度评估（GATE_DESIGN 供审查）已完成
- [x] CHK026 YAGNI 最小必要性复核已完成

---

## 2. 一致性检查（Consistency）

### 2.1 NEEDS CLARIFICATION 对应关系

- [x] CHK027 Open Questions 共 3 条，均标注 `[NEEDS CLARIFICATION]`
- [x] CHK028 Open Question 1（`rationale_for` 触发条件）与 FR-013 内嵌的 `[NEEDS CLARIFICATION]` 一一对应
- [ ] **CHK029 Open Question 2（`evidenceSource` 路径格式）和 Open Question 3（`nodes` 是否可混合节点类型）在 FR/NFR 正文中无对应 `[NEEDS CLARIFICATION]` 内嵌标记**
  - **问题**：FR-004 描述 `evidenceSource` 格式为 `"<repo-relative-file-path>:<startLine>-<endLine>"`，看似已有定论，但 Open Question 2 质疑应使用 repo-relative 还是绝对路径，FR-004 与 OQ-2 存在表面矛盾——FR-004 已选 repo-relative，但 OQ-2 仍列为未解决问题，两者未对齐。
  - **修复建议**：若 FR-004 已决策为 repo-relative，则关闭 OQ-2；若尚未确定，需在 FR-004 内嵌 `[NEEDS CLARIFICATION]` 标记，与 OQ-2 对应。

### 2.2 confidence 枚举值一致性

- [ ] **CHK030 `confidence` 枚举值在 FR-002 与关键实体章节存在不一致**
  - **问题**：FR-002 定义 `confidence` 枚举为 `CONFIRMED | INFERRED | SPECULATIVE`；关键实体 SemanticEdge 定义为 `CONFIRMED | INFERRED | SPECULATIVE`（一致）；但调研阶段提示原始需求中曾出现 `EXTRACTED / INFERRED / AMBIGUOUS` 的表述，与当前 spec 使用的三元组不同。在 spec 内部（FR-002、FR-003、AC-009、Story 验收场景）检查：
    - FR-002：`CONFIRMED | INFERRED | SPECULATIVE` ✓
    - FR-003：`INFERRED` 和 `SPECULATIVE` ✓
    - Story 2 AC 场景：`"INFERRED"` ✓
    - Story 3 AC 场景：`confidence` 字段提及（无具体枚举值）✓
    - 关键实体 SemanticEdge：`CONFIRMED | INFERRED | SPECULATIVE` ✓
    - 关键实体 Hyperedge：仅说 `confidence`，未列枚举值
  - **结论**：spec 内部枚举值自洽（`CONFIRMED / INFERRED / SPECULATIVE`），但与 Prompt 中提到的原始用户需求定义（`EXTRACTED / INFERRED / AMBIGUOUS`）不一致。规范本身未声明放弃原始定义或说明理由。
  - **修复建议**：在 FR-002 或背景章节中显式说明已将原始枚举 `EXTRACTED / INFERRED / AMBIGUOUS` 更名为 `CONFIRMED / INFERRED / SPECULATIVE` 的决策理由，避免实现者产生歧义。

### 2.3 Story 间矛盾检查

- [x] CHK031 Story 2 生成的边类型（`references` / `conceptually_related_to`）与 Story 3 生成的 hyperedge 使用的 `rationale_for` 边无冲突；`rationale_for` 的生成来源（LLM vs embedding）在 FR-013 通过 `[NEEDS CLARIFICATION]` 悬挂，逻辑上无矛盾
- [x] CHK032 Story 3 hyperedge 的 `confidence` 字段与 Story 1 schema 定义的枚举值兼容（均使用同一枚举类型）
- [x] CHK033 Story 4 MCP 工具所需的数据字段（`evidenceText`、`evidenceSource`、`confidence`、`nodes`）均已在 Story 1 schema 中定义

### 2.4 Embedding 方案描述一致性

- [x] CHK034 背景、Story 2、FR-010、FR-011、NFR-001、NFR-002、约束章节均一致描述：Local（`@huggingface/transformers`）为主方案，OpenAI 为 fallback，环境变量 `SPECTRA_EMBEDDING_PROVIDER` 切换

### 2.5 schema 字段命名一致性

- [x] CHK035 `evidenceText`：FR-003、FR-004（间接）、FR-006、Story AC 场景、关键实体、AC-002、AC-009、AC-011 命名一致，均为 `evidenceText`
- [x] CHK036 `evidenceSource`：FR-004、Story 2 AC-1、AC-002、AC-009 命名一致，均为 `evidenceSource`
- [x] CHK037 `hyperedges`：FR-005、FR-006、Story 3 AC、Story 4 AC、AC-004、AC-005 命名一致，均为 `hyperedges`
- [x] CHK038 `confidence`：FR-002、FR-003、关键实体、Story AC 场景、AC-009 命名一致

---

## 3. 可测试性检查（Testability）

- [x] CHK039 AC-001：golden-master fixture 比对，可自动化
- [x] CHK040 AC-002：单元测试断言边数量和字段格式，可自动化
- [x] CHK041 AC-003：人工验证，已明确标注验收时机和抽样方法，边界清晰
- [x] CHK042 AC-004：自动化 + 人工确认 label 语义，已明确区分
- [x] CHK043 AC-005：fixture 测试（纯代码项目 ≥5 源文件、零 markdown），可在 CI 重现，fixture 可构造
- [x] CHK044 AC-006：MCP 工具集成测试，3 种过滤场景均有具体 Given/When/Then，可自动化
- [x] CHK045 AC-007～AC-012：均为 CI 自动化或人工代码审查，方法明确
- [x] CHK046 MVP 成功标准数字（≥10 条边、≥1 hyperedge、nodes ≥3、假阳性率 < 20%）均已在 AC 中体现
- [x] CHK047 纯代码项目诚实降级场景（AC-005）已要求 fixture，且场景可在 CI 重现

---

## 4. 与 Research 的契合度检查（Research Alignment）

- [x] CHK048 Local 主方案、Hybrid Chunking 策略、≤10/batch 限制、Zod 降级均与 FR（FR-009、FR-018、FR-019）一致描述，与技术调研方向吻合
- [x] CHK049 用户价值描述（信任链、spec × KG 双向溯源闭环、AI Agent 流程级语义理解）与产品研究中的差异化定位一致
- [x] CHK050 spec 明确声明复用 Wave 1 基线：F1 BudgetGate（FR-016、FR-017、NFR-003）、F2 SpecStore（约束章节"只读"）、F2.5 direction-audit（FR-007、约束章节"F2.5 兼容"）

---

## 5. 风险覆盖检查（Risk Coverage）

- [x] CHK051 Risk 1（假阳性噪声）→ AC-003 人工抽样 ≥20 条，假阳性率 < 20% 已覆盖
- [x] CHK052 Risk 2（Hyperedge 数量失控）→ FR-018 明确 ≤10/batch，已覆盖
- [x] CHK053 Risk 3（依赖加载失败）→ FR-011 要求抛出明确错误，NFR-005 要求列为 `optionalDependencies`，已覆盖
- [x] CHK054 Risk 4（schema 破坏）→ FR-006 新字段全部 optional，FR-008 双版本 fixture，NFR-006 向后兼容，已覆盖
- [x] CHK055 Risk 5（LLM 输出不合规）→ FR-019 Zod 降级 + trace 日志 + 写入空数组，已覆盖
- [x] CHK056 Risk 6（tokenUsage 遗漏）→ NFR-003 + FR-016 明确要求所有调用记录，已覆盖
- [x] CHK057 Risk 7（纯代码项目错边）→ FR-015 诚实降级 + AC-005 fixture，已覆盖
- [x] CHK058 Risk 8（evidenceText 截断）→ FR-003 200 字符上限 + 边界案例章节有截断处理规则描述，已覆盖

---

## 汇总与结论

| 维度 | 总项数 | 通过 | 未通过 |
|------|--------|------|--------|
| 完整性检查 | 26 | 26 | 0 |
| 一致性检查 | 12 | 10 | 2 |
| 可测试性检查 | 9 | 9 | 0 |
| Research 契合度 | 3 | 3 | 0 |
| 风险覆盖检查 | 8 | 8 | 0 |
| **合计** | **58** | **56** | **2** |

### 未通过项汇总

| 编号 | 检查项 | 严重程度 | 修复建议 |
|------|--------|----------|----------|
| CHK029 | OQ-2（evidenceSource 路径）未在 FR-004 内嵌 `[NEEDS CLARIFICATION]`，FR-004 与 OQ-2 表面矛盾 | 中 | 明确 FR-004 已决策为 repo-relative 并关闭 OQ-2，或在 FR-004 补充悬挂标记 |
| CHK030 | `confidence` 枚举值与原始用户需求中的 `EXTRACTED / INFERRED / AMBIGUOUS` 不一致，spec 未说明变更理由 | 低 | 在 FR-002 或背景中加一句决策说明，说明枚举命名变更原因 |

### GATE_DESIGN 放行建议

**建议有条件放行**。CHK030 为低风险文档缺口，不影响实现正确性，可在实现阶段备注处理。CHK029 需要在进入 plan 阶段前明确：若 FR-004 已决策为 repo-relative，则 OQ-2 应关闭，避免实现者在两处看到矛盾信息而产生歧义。建议责任方在 spec.md 中补充 FR-004 的决策声明并关闭 OQ-2 后，GATE_DESIGN 正式放行。
