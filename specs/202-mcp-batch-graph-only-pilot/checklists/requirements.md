# Feature 202 需求质量检查清单

**Feature**: MCP batch 工具 graph-only 模式 + goal_loop Pilot
**Spec 路径**: `specs/202-mcp-batch-graph-only-pilot/spec.md`
**生成日期**: 2026-06-20
**审查人**: quality-checklist 子代理

---

## Content Quality（内容质量）

| ID | 检查项 | 状态 | Notes |
|----|--------|------|-------|
| CHK-001 | 无实现细节泄漏：spec 正文未提及具体语言框架/API 实现方式（如"Zod schema 枚举"属于架构约束描述，非实现细节） | [x] | FR-001 提及 Zod schema 是合理的架构边界说明，因为 Zod 是 MCP 注册层的已知技术合同，非新引入实现选择 |
| CHK-002 | 聚焦用户价值和业务需求：User Story 明确说明 AI Agent 在无 LLM 凭据环境中建图的业务场景 | [x] | US-1 why 段落清晰阐述能力不对称的业务影响；US-2 说明 pilot 的实证价值 |
| CHK-003 | 面向非技术利益相关者可读：背景、User Story、Success Criteria 能被非工程师理解 | [x] | 背景段及 Why this priority 均使用通俗描述；技术术语有上下文支撑 |
| CHK-004 | 所有必填章节已完成：背景、User Scenarios、Requirements、NFR、Success Criteria、Out of Scope 均已填写 | [x] | 所有章节完整，含 Edge Cases 与 Key Entities |

---

## Requirement Completeness（需求完整性）

| ID | 检查项 | 状态 | Notes |
|----|--------|------|-------|
| CHK-005 | 无 [NEEDS CLARIFICATION] 标记残留 | [x] | 全文未出现该标记 |
| CHK-006 | 需求可测试且无歧义：每条 FR 有明确的"MUST/SHOULD"措辞和可验证行为 | [x] | FR-001 到 FR-010 均使用 MUST，FR-011/012 明确标注 SHOULD 并说明可选理由 |
| CHK-007 | 成功标准可测量：SC 条目均含可量化或可布尔化判定的断言 | [x] | SC-载体-001 列出 3 个具体 vitest 断言（schemaVersion、绝对路径计数=0、零 LLM 调用）；SC-001～004 以"报告是否如实记录"为判据 |
| CHK-008 | 成功标准是技术无关的（不预设实现方式）：SC 描述的是可观测结果，而非特定实现路径 | [x] | SC 均以"调用结果/报告内容"为判据，未规定如何实现 dispatch |
| CHK-009 | 所有验收场景已定义：User Story 均有 Acceptance Scenarios（含 Given/When/Then 格式） | [x] | US-1 含 4 个 AC；US-2 含 3 个 AC，所有 AC 明确标注"记录遥测"而非预设成败 |
| CHK-010 | 边界条件已识别：Edge Cases 覆盖主要异常输入与组合参数场景 | [x] | EC-001 languages 共存、EC-002 空仓、EC-003 regen 参数共存、EC-004 F196 守卫、EC-005/EC-006 goal_loop 降级与回滚 |
| CHK-011 | 范围边界清晰：Out of Scope 明确列出不做的内容，防止需求蔓延 | [x] | BatchMode 类型扩展、其他 16 个工具、languages 过滤、buildAstGraphOnly 功能增强、每轮刷图优化均列入 Out of Scope |
| CHK-012 | 依赖和假设已识别：spec 明确复用现有 buildAstGraphOnly（F195 已落地），不引入新依赖 | [x] | NFR-002 明确"复用不重写"；FR-004 和 Key Entities 说明依赖 F195 已有函数；F193 portable 守卫作为前置能力已标注 |

---

## Feature Readiness（特性就绪度）

| ID | 检查项 | 状态 | Notes |
|----|--------|------|-------|
| CHK-013 | 所有功能需求有明确的验收标准：FR-001～FR-010 均可对应到至少一个 SC 断言 | [x] | FR-001 → SC-载体-001（schema 枚举红→绿）；FR-002 → SC-载体-001b（describe 文案断言）；FR-004 → SC-载体-001（dispatch 断言）；FR-006 → SC-载体-001（portable 守卫 schemaVersion+绝对路径=0）；FR-007 → SC-载体-002（零回归）；FR-008 → SC-载体-002（F196 守卫绿）；FR-009/010 → EC-003/EC-001 对应的 AC |
| CHK-014 | 用户场景覆盖主要流程：US-1 覆盖正常建图路径与三 mode 零回归路径；US-2 覆盖 pilot 遥测路径 | [x] | AC-1（graph-only 建图）、AC-2/3（full/reading/code-only 零回归）、AC-4（describe 文案）均已覆盖 |
| CHK-015 | 功能满足 Success Criteria 中定义的可测量成果：TDD 红→绿 oracle 明确，pilot 遥测字段明确 | [x] | SC-载体-001 的红态判据（Zod 拒绝导致 handler 未执行）和绿态断言（a/b/c 三项）均已显式定义；goal_loop 遥测最小可审计字段（iteration/changed/verifyExitCodes/decision/impactInjectionMode/fallbackTriggered/rollbackTriggered）在 Key Entities 中列出 |
| CHK-016 | 规范中无实现细节泄漏（回归护栏视角）：F196 守卫、F193 portable 守卫、NFR-004 batch 响应契约约束均以"可观测合规性"而非"如何实现合规"的形式呈现 | [x] | NFR-003（Output 示例区不变）、EC-004（不写入顶层 description）均描述可测边界而非实现步骤 |
| CHK-017 | pilot 遥测可审计性：goal_loop 遥测字段已明确列出，pilot 结论开放性（不预设跑通/未跑通）已在 NFR-005 和 US-2 AC 中保证 | [x] | NFR-005 明确"不得美化输出、省略失败轮次"；SC-001～004 均以"报告是否如实记录"而非"是否成功"为验收标准 |
| CHK-018 | 三 mode 零回归护栏覆盖：FR-007 和 NFR-001 明确要求 full/reading/code-only 三 mode 仍走原有路径，且有可测断言（dispatch spy 或等价断言） | [x] | FR-007 的可测断言已明确（dispatch spy + 三 mode 现有 MCP 测试保持绿）；AC-2/3 提供对应 Given/When/Then |

---

## 汇总

| 分类 | 总计 | 通过 | 未通过 |
|------|------|------|--------|
| Content Quality | 4 | 4 | 0 |
| Requirement Completeness | 8 | 8 | 0 |
| Feature Readiness | 6 | 6 | 0 |
| **合计** | **18** | **18** | **0** |

**整体结论**: 全部 18 项通过，spec 可进入技术规划（plan）阶段。
