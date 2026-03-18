# 质量检查表: Feature 031 — 多语言混合项目支持

**Feature Branch**: `031-multilang-mixed-project`
**检查日期**: 2026-03-18
**Spec 版本**: Draft v1
**Gate Policy**: balanced
**Preset**: quality-first

---

## 1. Content Quality（内容质量）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| CQ-01 | Spec 包含明确的 Feature Branch 标识和创建日期 | [x] | `031-multilang-mixed-project`，2026-03-18 |
| CQ-02 | Spec 清晰描述了输入来源（Blueprint / 需求源） | [x] | 明确引用 Blueprint 024 Phase 3 集成层 |
| CQ-03 | User Story 使用标准格式（作为...我希望...这样...） | [x] | 6 个 User Story 均使用标准用户故事格式 |
| CQ-04 | 每个 User Story 包含优先级标注（P1/P2/P3） | [x] | P1: US1, US2; P2: US3, US4, US5; P3: US6 |
| CQ-05 | 每个 User Story 包含优先级理由说明 | [x] | 每个 Story 均有 "Why this priority" 段落解释优先级选择 |
| CQ-06 | 验收场景使用 Given/When/Then 格式 | [x] | 所有 6 个 User Story 的验收场景均严格遵循 Given/When/Then 格式 |
| CQ-07 | 验收场景具体且可执行，非抽象描述 | [x] | 场景中包含具体的语言类型、文件数量、目录结构等可操作细节 |
| CQ-08 | Edge Cases 覆盖了关键边界条件 | [x] | 涵盖单语言兼容、同目录混合、大量不支持文件、极少量文件、断点恢复、非法参数、无扩展名文件 7 个边界场景 |
| CQ-09 | Key Entities 定义清晰且相互独立 | [x] | 4 个核心实体（Language Statistics, Language Group, Language Distribution, Cross-Language Reference）定义明确，职责边界清晰 |
| CQ-10 | 语言风格一致：中文正文 + 英文技术术语 | [x] | 全文遵循中文描述 + 英文术语不翻译的约定 |
| CQ-11 | 描述聚焦"做什么"而非"怎么做"（无实现细节泄漏） | [x] | 未涉及代码结构、类名、函数签名等实现细节；FR-003 提及"轻量级依赖图"属策略描述而非实现方案 |
| CQ-12 | 无矛盾或自相矛盾的需求描述 | [x] | FR-008（单语言不展示语言分布）与 FR-007（索引增加语言分布）逻辑一致，条件互斥 |
| CQ-13 | NEEDS CLARIFICATION 标记了所有模糊点 | [x] | 3 个 NEEDS CLARIFICATION 标记分别覆盖 US6 隐式调用、无扩展名文件归类、过滤参数与索引交互 |

---

## 2. Requirement Completeness（需求完备性）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| RC-01 | 功能需求（FR）覆盖了所有 P1 User Story 的验收场景 | [x] | US1 → FR-001~FR-006, FR-013; US2 → FR-007, FR-008; 全部覆盖 |
| RC-02 | 功能需求（FR）覆盖了所有 P2 User Story 的验收场景 | [x] | US3 → FR-010, FR-015; US4 → FR-009; US5 → FR-011; 全部覆盖 |
| RC-03 | 功能需求（FR）覆盖了所有 P3 User Story 的验收场景 | [x] | US6 → FR-006, FR-012; 覆盖跨语言引用标注需求 |
| RC-04 | 成功标准（SC）覆盖了所有 P1 功能需求 | [x] | SC-001~SC-003, SC-006, SC-007 覆盖 P1 相关 FR |
| RC-05 | 成功标准（SC）覆盖了所有 P2 功能需求 | [x] | SC-004, SC-005, SC-006 覆盖 P2 相关 FR |
| RC-06 | 成功标准（SC）覆盖了 P3 功能需求 | [ ] | FR-012（跨语言引用标注）缺少对应的成功标准。追溯矩阵中 FR-012 的成功标准列为"—"，意味着无法量化验证跨语言引用标注的正确性 |
| RC-07 | 每个 User Story 有独立测试描述 | [x] | 6 个 User Story 均有 "Independent Test" 段落 |
| RC-08 | 向后兼容性有明确的功能需求约束 | [x] | FR-014 明确要求"不产生破坏性变更"，FR-008 约束单语言行为 |
| RC-09 | 向后兼容性有可度量的成功标准 | [x] | SC-003 要求纯 TS 项目输出"完全一致" |
| RC-10 | Edge Cases 在功能需求或验收场景中有对应处理 | [x] | 断点恢复 → FR-013; 同目录混合 → FR-005; 不支持语言 → FR-011; 非法参数 → US3-AS3; 极少文件 → Edge Case 明确要求纳入统计 |
| RC-11 | MCP 接口变更有明确的需求描述 | [x] | FR-009（prepare 新增语言列表）、FR-010（batch 新增过滤参数）描述明确 |
| RC-12 | 需求间无循环依赖或逻辑死锁 | [x] | FR 之间的依赖关系为线性：扫描(FR-001) → 分组(FR-002) → 依赖图(FR-003/004) → 生成(FR-006) → 索引(FR-007) |
| RC-13 | 非功能需求（性能、安全、可扩展性）有适当考量 | [ ] | 缺少明确的性能需求。对于大型多语言项目（如数万文件），多语言扫描和分组的性能影响未被约束。Edge Case 提及"数千个 .c 文件"仅关注警告聚合，未涉及扫描性能 |
| RC-14 | 错误处理场景在需求中有覆盖 | [x] | US3-AS3（不存在的语言）、US5（不支持语言的警告）、Edge Case（非法参数）均描述了错误场景 |

---

## 3. Feature Readiness（特性就绪度）

| # | 检查项 | 状态 | Notes |
|---|--------|------|-------|
| FR-RDY-01 | Spec 状态为 Draft 或更高 | [x] | 状态为 Draft，符合进入质量检查的前提 |
| FR-RDY-02 | 所有 NEEDS CLARIFICATION 项均有建议的默认行为 | [x] | NC-001: MVP 不加通用提示; NC-002: 不纳入语言统计; NC-003: 索引展示全部语言。3 个待澄清项均有明确的建议默认行为 |
| FR-RDY-03 | P1 User Story 中无 NEEDS CLARIFICATION 标记 | [x] | US1、US2 中无待澄清标记，所有 NC 标记均出现在 P2/P3 Story 和 Edge Cases 中 |
| FR-RDY-04 | 现有代码库中存在需要的基础设施 | [x] | LanguageAdapter 抽象层已实现（src/adapters/language-adapter.ts），TS/JS、Python、Go、Java 适配器已存在，batch-orchestrator 和 prepare 命令已存在 |
| FR-RDY-05 | 功能需求与现有代码架构无明显冲突 | [x] | 新增需求为扩展现有扫描→分组→生成流程，不改变核心架构；LanguageAdapterRegistry 已提供多语言注册能力 |
| FR-RDY-06 | 依赖的前序特性已完成 | [x] | Blueprint 024 Phase 3 中 LanguageAdapter 抽象层（Feature 025）和 web-tree-sitter 后端（Feature 027）已在当前分支提交历史中完成 |
| FR-RDY-07 | 成功标准全部可自动化验证 | [x] | SC-001~SC-007 均可通过构造测试项目 + 断言输出内容实现自动化验证 |
| FR-RDY-08 | 估算复杂度在单个 Feature 的合理范围内 | [x] | 6 个 User Story（2P1 + 3P2 + 1P3）、15 个 FR、7 个 SC，规模适中。P3 的 US6 可推迟不影响核心交付 |
| FR-RDY-09 | 无外部依赖阻塞（第三方 API、未发布的库等） | [x] | 仅使用现有依赖（web-tree-sitter、dependency-cruiser 等），无新增外部依赖 |
| FR-RDY-10 | NEEDS CLARIFICATION 项不阻塞 P1 功能的实现 | [x] | 3 个 NC 项分别影响 P3（NC-001）、FR-001/007（NC-002，建议保持忽略行为无需修改）、P2（NC-003），均不阻塞 P1 |

---

## 检查结果汇总

| 维度 | 通过 | 未通过 | 通过率 |
|------|------|--------|--------|
| Content Quality | 13/13 | 0/13 | 100% |
| Requirement Completeness | 12/14 | 2/14 | 85.7% |
| Feature Readiness | 10/10 | 0/10 | 100% |
| **总计** | **35/37** | **2/37** | **94.6%** |

## 未通过项详情

### RC-06: FR-012（跨语言引用标注）缺少成功标准

- **问题**: FR-012 要求"在跨语言模块的 spec 元数据中标注潜在的跨语言引用信息"，但没有对应的成功标准来度量此功能的验证条件
- **影响**: P3 功能无法量化验收
- **建议**: 新增 SC-008，例如"跨语言引用标注仅基于 import 路径推断，不产生误报（对 AST 不可见的调用不标注）"
- **阻塞等级**: 低（P3 功能，不阻塞 P1/P2 交付）

### RC-13: 缺少性能相关的非功能需求

- **问题**: 对于大型多语言项目（数万文件规模），多语言扫描、分组和依赖图合并的性能影响未被约束
- **影响**: 大型项目场景可能出现性能回退但无检测手段
- **建议**: 补充非功能需求，例如"多语言扫描阶段的额外耗时不超过单语言扫描的 20%"，或至少在 Edge Cases 中补充性能相关的约束
- **阻塞等级**: 低（balanced gate_policy 下非功能需求为建议项）

---

## Gate 判定

**Gate Policy**: balanced

在 balanced 策略下：
- Content Quality 100% 通过 -- PASS
- Requirement Completeness 85.7% 通过（2 项未通过均为低阻塞等级） -- CONDITIONAL PASS
- Feature Readiness 100% 通过 -- PASS

**结论**: **PASS（有条件通过）** -- Spec 整体质量良好，可进入下一阶段（Plan 生成）。建议在 Plan 阶段或后续迭代中补充 RC-06 和 RC-13 的缺失项。
