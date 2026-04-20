---
feature: F5 Reading UX
branch: 132-reading-ux
phase: quality-checklist
created: 2026-04-20
---

# F5 Reading UX Quality Checklist

## 摘要

- 总检查项：34
- 通过：30
- 待修复：4
- 严重问题：1（Q1 P0 阻塞项未标"需用户决策"）

---

## 1. 结构完整性

- [x] **spec.md 含 User Scenarios** — §"User Scenarios & Testing" 含 Story 1/2/3 + Edge Cases
- [x] **spec.md 含 Requirements** — §"Requirements" 含 FR-001~FR-024 + NFR-001~NFR-006
- [x] **spec.md 含 Key Entities** — §"Key Entities" 含 6 个实体定义
- [x] **spec.md 含 Success Metrics** — §"Success Metrics" 含 SC-001~SC-007
- [x] **spec.md 含 Out of Scope** — §"Out of Scope" 含 7 条排除项
- [x] **spec.md 含 Open Questions** — §"Open Questions" 含 Q1/Q2/Q3
- [x] **spec.md 含 Risks** — §"Risks & Mitigations" 含 R1~R7（表格形式）
- [x] **Frontmatter 含必需 key** — `feature`、`branch`、`phase`、`status`、`created`、`priority` 均存在
- [x] **Story 1 含 Why this priority** — §Story 1 "Why this priority" 段落存在
- [x] **Story 1 含 Independent Test** — §Story 1 "Independent Test" 段落存在
- [x] **Story 1 含 Acceptance Scenarios** — 6 条 Given/When/Then 场景
- [x] **Story 2 含 Why this priority** — §Story 2 "Why this priority" 段落存在
- [x] **Story 2 含 Independent Test** — §Story 2 "Independent Test" 段落存在
- [x] **Story 2 含 Acceptance Scenarios** — 8 条 Given/When/Then 场景
- [x] **Story 3 含 Why this priority** — §Story 3 "Why this priority" 段落存在
- [x] **Story 3 含 Independent Test** — §Story 3 "Independent Test" 段落存在
- [x] **Story 3 含 Acceptance Scenarios** — 7 条 Given/When/Then 场景

---

## 2. Requirements 质量

- [x] **每条 FR 可测试** — FR-001~FR-024 均含可观察行为或验收条件描述；FR-008/FR-017/FR-023 标注了待澄清的悬空数值，但已明确标注 `[待澄清 Qn]` 并指向对应 Open Questions，不视为"不可测试"
- [x] **FR 不含实现细节（文件路径/函数名）** — spec.md 的 FR 层未出现函数名或文件路径；Key Entities 和 Complexity 评估章节提及了路径但属于背景描述，不影响 FR 本身
- [x] **FR 按 Story 分组** — FR 按"Story 1 / Story 2 / Story 3"三组分节
- [x] **NFR 覆盖性能** — NFR-001 覆盖性能（带冲突标注）
- [x] **NFR 覆盖溯源强制** — NFR-002 覆盖 100% Citation 强制
- [x] **NFR 覆盖 self-contained** — NFR-003 覆盖 graph.html 零 CDN
- [x] **NFR 覆盖 budget 合规** — NFR-004 覆盖 runBudgetGate()
- [x] **NFR 覆盖兼容性（默认 full 模式不变）** — FR-002 明确"默认 `full` 模式，保持现有行为不变"，NFR 层无单独条目但已在 FR 层强制

---

## 3. 产研承接

- [x] **synthesis §2 差异化点 1（溯源跨代码+设计决策）→ spec** — FR-012/FR-013/NFR-002/SC-004 有明确对应
- [x] **synthesis §2 差异化点 2（点击节点跳转 spec）→ spec** — FR-020/SC-005 有明确对应
- [x] **synthesis §2 差异化点 3（5 类问题 100% 引用）→ spec** — FR-011/FR-012/SC-002 有明确对应
- [x] **synthesis §1 核心选型决策未被 spec 擅自修改** — B+C 混合架构（FR-010）、单轮无状态（FR-016）、self-contained（FR-021）、runBudgetGate 强制（FR-015）均与 synthesis §1 一致，无擅自变更
- [x] **synthesis §4 风险 R1~R7 全部进入 spec Risks 区块** — spec §Risks 表格 R1~R7 与 synthesis §4 完整对应
- [x] **synthesis §3 待澄清项全部进入 spec Open Questions** — Q1（§3.1）、Q2（§3.2）、Q3（§3.3）均在 spec Open Questions 区块；§3.4 design-doc 推断边界按 synthesis 建议推入 plan 阶段，spec 在 FR-004 和 Out of Scope §7 有明确说明，处理合理

---

## 4. Out of Scope 清晰度

- [x] **F6+ 大规模功能被明确排除** — Out of Scope §1 明确排除"节点数 > 2000 大图降级留给 F6+"
- [x] **GraphQL 被明确排除** — Out of Scope §2 明确排除 GraphQL 接口
- [x] **多轮问答/会话管理被明确排除** — Out of Scope §3 明确排除
- [x] **实时协同被明确排除** — Out of Scope §4 明确排除
- [x] **每个 Out of Scope 项有理由** — §1 有"留给 F6+"、§2 有"不引入"、§3 有"单轮无状态，多轮由调用方负责"、§4 有"不支持多用户同时编辑"、§5 有"F5 为批量返回"、§6 有"始终是静态文件"、§7 有"属于 plan 阶段产物"——7 条均有理由

---

## 5. Success Metrics 可度量性

- [x] **SC-001 含数字阈值** — "< 120 秒热启动"（带 [待澄清 Q1] 标注）
- [x] **SC-002 含数字阈值** — "5 类问题各 3 次，100% 含至少 1 条有效 Citation，零无引用答案"
- [x] **SC-003 含二元判定** — "可打开 / 节点可拖动 / 搜索框可用 / 点击有响应"——4 个二元验证点
- [x] **SC-004 含二元判定** — "至少 1 次问答返回 Citation 指向 hyperedge 区块"
- [x] **SC-005 含二元判定** — "系统触发打开对应 spec 文件的行为"
- [x] **SC-006 含二元判定** — "所有 LLM 调用可在日志中追溯 tokenUsage，无绕过路径"
- [x] **SC-007 含二元判定** — "自动降级到纯 RAG，最终有结果或明确提示，无崩溃"
- [x] **SC 覆盖三个 Story 的主要价值** — SC-001 对应 Story 1；SC-002/SC-004/SC-007 对应 Story 2；SC-003/SC-005 对应 Story 3

---

## 6. 验收可测试性

- [x] **Acceptance Scenarios 的 Given/When/Then 实际可操作** — Story 1~3 共 21 条场景均含清晰 Given/When/Then，操作步骤对测试者可执行
- ⚠️ **"5 类典型问题 100% citation" 在 spec 里有明确列表** — FR-011 列出了 5 类：(1)调用关系查询；(2)调用路径查询；(3)设计决策映射；(4)技术债查询；(5)流程归属查询。但**5 类对应的具体示例问题**仅在 §背景与目标 和 Story 2 描述中以散文形式出现，未在 FR 或验收场景中聚合成一个可对照的"5 类问题清单表"。SC-002 引用"5 类典型问题各执行 3 次"，但没有明确绑定 FR-011 的编号。建议在 FR-011 或 SC-002 下添加一个 5 类问题的对照枚举，方便 verify 阶段逐类检查。（不阻塞，建议修复）

---

## 7. 合规性

- [x] **语言规范：中文正文 + 英文术语 + 英文 YAML key** — spec.md 正文中文，技术术语（BFS、embedding、RAG、CDN、self-contained 等）保持英文，Frontmatter 全英文 key，符合 CLAUDE.md 约定
- [x] **无无关实现假设（如"用 langchain"）** — spec.md FR 层未出现具体库名、函数名或算法实现路径
- [x] **读写边界未被破坏** — spec.md 未在 FR 层描述写文件、改数据库等超出 batch-project-docs 输出边界的操作

---

## 8. Open Questions 质量

- ⚠️ **Q1 P0 问题未明确标注"需要用户决策"** — spec.md §Q1 标注了"（P0 — 必须澄清）"，描述了冲突背景和影响范围，但**未明确写出"需要用户决策"或"需 AskUserQuestion"**的行动项。synthesis §3.1 的编排器建议（"通过 AskUserQuestion 让用户明确"）未被 spec 直接承接为显式标注。这导致后续 clarify 子代理可能遗漏这一决策点。建议在 Q1 下增加一行：`**行动项**：clarify 阶段必须通过 AskUserQuestion 获取用户明确决策，不可由编排器代为选择。`（⚠️ 有保留通过，建议修复但不阻塞 GATE_DESIGN）
- [x] **Q2 P1 状态清晰** — 标注"（P1）"，列出三选项 A/B/C，编排器倾向 C，待用户确认；状态 Open，倾向明确
- [x] **Q3 P2 状态清晰** — 标注"（P2）"，列出选项范围，编排器倾向 < 2000，待用户确认；状态 Open，倾向明确
- ⚠️ **Q2/Q3 的默认倾向是否会被 clarify 改动影响到 FR** — Q2 倾向 C 如被推翻，FR-017 的 SHOULD 级别和 Story 2 AC 7 的具体行为都需同步更新；Q3 倾向 < 2000 如被改变，FR-023 和 Story 3 AC 6 需同步更新。**Checklist 提醒**：clarify 阶段结论落定后，verify 前必须回填 FR-008、FR-017、FR-023 的悬空数值，并核查 SC-001 的阈值。
- [x] **无 [NEEDS CLARIFICATION] 残留标记** — spec.md 全文无 `[NEEDS CLARIFICATION]` 标记（均使用 `[待澄清 Qn]` 形式，与 Open Questions 绑定）

---

## 待修复项（建议在进入 GATE_DESIGN 前或 clarify 后处理）

1. **【建议修复】验收可测试性 §6**：FR-011 列出的 5 类问题清单未在 FR 或 SC 层以枚举表格形式聚合。建议在 FR-011 或 SC-002 下添加"5 类问题对照表（含示例问题语句）"，方便 verify 阶段逐类打钩。

2. **【建议修复】Open Questions §8 Q1**：Q1 缺少显式"行动项"标注（`需 AskUserQuestion`），建议补充一行明确的行动项，避免 clarify 子代理遗漏决策节点。

3. **【clarify 后必须回填】** FR-008（reading 热启动耗时目标）、NFR-001（性能数值）、SC-001（阈值）在 Q1 澄清后必须回填具体数值；FR-017/Story 2 AC 7 在 Q2 澄清后需更新；FR-023/Story 3 AC 6 在 Q3 澄清后需更新。这不是 spec 缺陷，而是有意标注的待澄清悬空项，但需在 verify 前完成闭环。

4. **【低优先级】** spec.md §"复杂度评估"章节提及了具体源码路径（`src/panoramic/qa/`、`src/mcp/graph-tools.ts`等），这些属于实现细节。该章节定位为"供 GATE_DESIGN 审查"，不影响 FR 层，可接受保留；但若规范严格要求 spec 完全无实现路径，建议将该章节移至 plan 阶段。

---

## 阻塞 GATE_DESIGN 的问题

**无硬性阻塞项。**

以下为有保留项，不阻塞但建议在 clarify 阶段并行处理：

- Q1 P0 性能目标冲突尚未澄清，SC-001/FR-008/NFR-001 存在悬空数值，verify 阶段前必须闭环
- Q1 在 spec 内缺少显式"需用户决策"行动标注

---

## 总评

**有保留通过（可进入 GATE_DESIGN）**

spec.md 结构完整，三个 Story 各含完整 Why/Independent Test/Acceptance Scenarios，产研承接全面（synthesis §1~§4 逐项可追溯），FR 质量高且不含实现细节，Out of Scope 清晰有理，Success Metrics 均可度量，风险表 R1~R7 完整。

存在 2 处建议修复项（5 类问题清单聚合、Q1 行动项标注）和 1 处有意悬空的待澄清数值（Q1/Q2/Q3），均不影响 GATE_DESIGN 阶段的架构设计工作。建议在 clarify 阶段同步处理上述问题，并在 verify 前完成悬空数值的回填。
