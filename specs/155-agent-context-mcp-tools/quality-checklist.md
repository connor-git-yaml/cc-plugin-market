# Quality Checklist — Feature 155 spec.md

**Generated**: 2026-05-08
**Reviewed by**: 主编排器 self-review（GATE_DESIGN 后由 Codex 对抗审查复核）

---

## 1. spec.md 结构合规

- [x] User Stories 至少 1 个 P1 + 1 个独立可测
- [x] 每个 User Story 有 Independent Test 描述
- [x] Acceptance Scenarios 用 Given/When/Then 格式
- [x] Edge Cases 段独立列出（≥ 8 项）
- [x] Functional Requirements 编号连续 + MUST 强制语
- [x] Key Entities 段列出本 Feature 引入的核心数据结构
- [x] Success Criteria 全部可测量（数值阈值或可验证状态）
- [x] Out of Scope 段明确写出（避免 scope creep）
- [x] 假设 / 外部依赖段独立列出

## 2. 与设计文档一致性

- [x] §Feature 151 的 3 个 tool 全覆盖（impact / context / detect_changes）
- [x] budget 遍历前截断（FR-012）— 与 Codex WARNING #6 修订一致
- [x] relatedSpec 第一版降级为 module-coarse（FR-023）— 与设计 stretch goal 标注一致
- [x] 与 Feature 152/153/154 的写入路径 disjoint（FR-061 + 边界段）
- [x] 不修改 Feature 151 合同区（FR-061 + SC-008）

## 3. 可验证性

- [x] SC-001：micrograd 上 ≥ 5 callers + ≤ 5 ms hot-path
- [x] SC-002：nanoGPT 上 budget 严格截断 + warnings 标记
- [x] SC-003：context tool 字段全覆盖 + relatedSpec 包含 fallback case
- [x] SC-004：detect_changes 在 fixture diff 上输出非空 changedSymbols + affectedSymbols
- [x] SC-005：≥ 12 + ≥ 8 单测，零失败
- [x] SC-006：`npm run build` + `npm run repo:check` 零错
- [x] SC-007：`npm run eval:report` / baseline collector 含 capability 标记
- [x] SC-008：diff 不含 Feature 151 合同区文件（机械可验证）

## 4. 可疑点 / Codex 重点审查点

下列已知风险点，需 Codex 在 GATE_DESIGN 阶段重点 challenge：

| ID | 可疑点 | 当前 spec 立场 | Codex 应该 challenge 什么 |
|----|--------|--------------|--------------------------|
| Q-1 | 单测全 mock，acceptance 跑 baseline — 是否漏端到端集成 case？ | spec 已要求 SC-001/3/4 在 baseline 真实跑 | 是否还应要求一个 integration test 跑 micrograd 真实 graph + assert 与 mock 单测的差异？ |
| Q-2 | unmappedFiles 第一版只是 string[]，未携带 reason | 简化为 P0 | 是否应在响应中包含简单 reason 让 LLM 决策？ |
| Q-3 | impact tool 默认 direction = upstream — 是否合理 | 选用例最高频假设 | 是否应该让 LLM 显式传 direction 而非用默认值？ |
| Q-4 | relatedSpec module-coarse 在多 module 共享 spec 时是否歧义？ | 返回 symbol 所属 module 的 spec | 是否在 relatedSpec 加 `disambiguation: 'module-only'` 字段？ |
| Q-5 | confidence 三档 → 0.95/0.65/0.30 数值映射没文档来源 | 沿用 EXTRACTED/INFERRED 语义 | 数字是否应在 query-helpers 暴露为常量 / contract，避免散布魔数？ |
| Q-6 | budget 默认 200 节点 — 在 5k+ LOC 仓库上是否够 | 设计文档原话 | 是否应让 budget = 'auto' 按 graph 规模动态？ |
| Q-7 | detect_changes spawn git 是否处理 non-utf8 / 大 diff | spawn 标准接收 stdout | spawn 缓冲区会不会爆？是否应该用 stream 处理？ |
| Q-8 | reason 字段未 schema 化 | 留给 plan 阶段 | spec 是否应至少给 reason 一个最小结构（'A → B → C' string vs structured）？ |

## 5. Spec 完整度自评

| 维度 | 完整度 | 备注 |
|------|--------|------|
| 业务价值表达 | ✅ | User Stories 清楚说明 LLM agent 视角 |
| 输入输出 schema | ✅ | FR-010/020/030 明确字段 |
| 错误处理 | ✅ | FR-050/051/052 + 错误 code 集合 |
| 性能验收 | ✅ | SC-001 给出 ms 级别量化 |
| 与已 ship 模块边界 | ✅ | FR-061 + SC-008 + Feature 边界段 |
| 测试可行性 | ✅ | SC-005 + Fixture 列表 |
| Codex 历史警告响应 | ✅ | 已显式纳入 budget 遍历前截断 + relatedSpec stretch |

总评：spec.md 已完整、可验证、与 Feature 151 合同区严格隔离，可推进至 Codex 对抗审查（GATE_DESIGN）。
