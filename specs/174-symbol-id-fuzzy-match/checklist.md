# Feature 174 — Symbol ID Fuzzy Match 质量检查清单

**Created**: 2026-06-06
**Feature Spec**: [./spec.md](./spec.md)
**检查人**: checklist 子代理（自动生成）

---

## 1. 需求完整性（Requirement Completeness）

### 1.1 四层 fuzzy 各有命中用例

- [x] 层 (a) exact：Edge Case"query 本身是合法 exact id"+ US2 AS-2 绝对路径场景均有明确 Acceptance Scenario，`confidence: 1.0 / matchKind: exact`
- [x] 层 (b) path-suffix：US2 AS-1 (`engine.py::Value.relu` 无 package 前缀) 覆盖，`confidence: 0.9 / matchKind: path-suffix`
- [x] 层 (c) partial-name：US1 AS-1 (`Value.__add__` 无路径前缀唯一命中) 覆盖，含唯一性加权规则，`confidence ≥ 0.9`
- [x] 层 (d) Levenshtein：US2 AS-3 (`egnine.py::Value` typo) 覆盖，`confidence: 0.5~0.75`
- [x] 四层按 a→b→c→d 命中即停止规则在 FR-002 明确描述，无歧义

### 1.2 autoResolve 唯一性加权规则

- [x] FR-003 明确：去重后唯一候选 + `confidence ≥ 0.9`（闭区间）才可 `autoResolved: true`
- [x] FR-002(c) 明确：partial-name 唯一命中→ `confidence ≥ 0.9`；多义→ `0.7~0.85`（不触发 autoResolve）
- [x] FR-003 边界规则：path-suffix 锁定 0.9 满足 `>=0.9`，唯一 path-suffix 命中会 autoResolve；实现必须用精确常量 0.9
- [x] 平票场景（Edge Case）：两候选等分 → `autoResolved: false`，已明确

### 1.3 breaking change 下游审计

- [x] FR-007 列出全量下游审计清单：`agent-context-tools.test.ts` C-102/C-206、MCP error response schema、Feature 155 文档、全仓 `grep -rn "fuzzyMatches"` 审计
- [x] FR-013 明确"双字段并存"为 Non-goal，破坏性变更路径已决策，无歧义
- [x] SC-006 可测量：C-102/C-206 断言更新为结构完整性断言

### 1.4 detect_changes 范围排除

- [x] FR-009 明确 `detect_changes` handler 不接入 fuzzy 逻辑，范围边界清晰
- [x] spec 背景章节说明原因（detect_changes symbol 来源于 graph 内部，不经过 canonicalizeSymbolId）
- [x] Edge Case 中明确"`detect_changes` 调用路径：fuzzy 逻辑对其不可见，行为不变"

### 1.5 无 [NEEDS CLARIFICATION] 残留标记

- [x] 全文检查：无任何 `[NEEDS CLARIFICATION]` 标记残留
- [x] Open Questions 已全部标注 ✅（4 项均已收口）；仍待 Plan 阶段决定的 A/B/C 属于实现细节，不阻断需求完整性

### 1.6 依赖和假设已识别

- [x] FR-001 `opts.projectRoot` 透传依赖 `canonicalizeSymbolId` 现有能力，已说明
- [x] FR-011 Levenshtein 可复用 `adr-evidence-verifier.ts` 现有 DP 实现（属于 plan 选项，非 FR 强制，边界清晰）
- [x] 无新外部依赖（复杂度评估表显示"依赖新引入数 = 0"）

---

## 2. TDD 合规（M7 强制）

### 2.1 E2E 测试 RED 先行

- [x] 四个 User Story 均为独立可测场景（Independent Test 章节），可映射为 `.e2e.test.ts` 文件
- [x] US1 Independent Test：构造最小 graph fixture + 调用 `resolveSymbolFuzzy` + `handleContext` 集成验证，断言点明确
- [x] US2 Independent Test：4 种变体 × 3~4 用例 = 15 次 resolve，top-1 命中 ≥ 12，断言口径 SC-003 收口
- [x] US3 Independent Test：cohort C 9 个 symbol 合成 fixture，断言零 symbol-not-found
- [x] US4 Independent Test：随机字符串 `zzz_nonexistent::foo`，断言 `autoResolved: false` + 无异常

### 2.2 单元测试分层 RED（query-helpers.test.ts）

- [x] FR-001~FR-003 对 `resolveSymbolFuzzy` 纯函数的行为约束可映射为独立单元测试（四层各层命中 + autoResolve 边界）
- [x] FR-010 边界（超长 query > 512、空字符串、纯空白、控制字符）需专属 RED 测试用例，spec 已明确行为预期
- [x] Edge Cases 8 个均有明确的预期行为，可直接转化为断言

### 2.3 handler 接线 RED（agent-context-tools.test.ts）

- [x] FR-005 `autoResolved: true` 时 handler 响应体必须含 `resolvedFrom / resolvedTo / resolvedConfidence / warnings: ['fuzzy-resolved']`，断言可写
- [x] FR-006 `autoResolved: false` 时 `fuzzyMatches: Array<SymbolCandidate>` clamp top-3，断言可写
- [x] C-102/C-206 需同步更新为结构完整性断言（SC-006），已在 FR-007 明确

---

## 3. 测试覆盖（Test Coverage）

### 3.1 分支覆盖率要求

- [x] SC-005 明确：新增单元测试对 `resolveSymbolFuzzy` 分支覆盖率 ≥ 95%
- [x] 覆盖目标技术无关（"分支覆盖率"而非指定测试框架/工具），可通过 vitest --coverage 验证

### 3.2 现有 vitest 全量通过

- [x] SC-005 明确：`npx vitest run` 3859 条全部通过（含新增用例）
- [x] 数量基线已在 spec 锁定（3859 条），回归门禁可验证

### 3.3 旧 C-102/C-206 断言更新

- [x] SC-006 明确：C-102（`:161`）和 C-206（`:333`）两处断言更新为结构完整性断言
- [x] 具体行号已在 spec 中标注，便于实现时精确定位

### 3.4 新增四层 + 边界用例

- [x] 四层命中各有用例（SC-001 每层至少一个）
- [x] 边界：空 graph、平票、超长 query（>512）、空/invalid query、graphData 只读 — 全部在 Edge Cases 明确预期行为
- [x] 误 autoResolve 防护（SC-004）：多候选场景显式断言 `autoResolved: false`

---

## 4. 向后兼容与合同（Backward Compatibility & Contract）

### 4.1 fuzzyMatches 类型变更全仓审计

- [x] FR-007 要求实现前执行 `grep -rn "fuzzyMatches"` 全仓审计，确认无遗漏
- [x] 已列出 4 类下游：测试断言、MCP schema、Feature 155 文档、其他消费方
- [x] FR-013 明确不做并存兼容（Non-goal），合同一致性优先

### 4.2 handler 恒 top-3

- [x] FR-006 明确 handler 层 clamp 固定 top-3（by confidence desc）
- [x] FR-012 明确 handler 层 `fuzzyMatches` 恒 top-3 与纯函数 `limit` 解耦，合同稳定

### 4.3 warnings 数组追加 'fuzzy-resolved'

- [x] FR-005 明确"向现有响应的 `warnings: string[]` 数组**追加** `'fuzzy-resolved'`"
- [x] 明确"不新增单数 `warning` 字段，复用既有 warnings 语义"，无歧义

### 4.4 resolvedFrom / resolvedTo 双字段

- [x] FR-005 明确两字段语义：`resolvedFrom` = 原始 query string，`resolvedTo` = resolve 后 canonical id
- [x] Key Entities 章节（ResolvedResponse）复述确认，语义一致

---

## 5. 误自动 resolve 防护（Anti-False-AutoResolve）

### 5.1 多候选/平票场景 autoResolved = false

- [x] FR-003 明确：多候选、平票、唯一但 < 阈值 → `autoResolved: false`（穷举所有 false 场景）
- [x] US1 AS-3：同名多 module 场景 `autoResolved: false`，已纳入 Acceptance Scenario
- [x] Edge Case"平票场景"：两候选等分 → `autoResolved: false`，已明确

### 5.2 threshold floor ≥ 0.9

- [x] FR-012 明确：production handler `autoResolveThreshold` floor MUST ≥ 0.9，不得被调低绕过 FR-003
- [x] SC-004 可测量：production handler 的 floor 约束，可通过配置审计验证

---

## 6. 验收门禁（Acceptance Gates）

### 6.1 build 零错误

- [x] SC-005 明确：`npm run build` 类型检查零错误

### 6.2 repo:check 零警告

- [x] SC-005 明确：`npm run repo:check` 零警告

### 6.3 四个 E2E 用户故事全过

- [x] SC-002：cohort C 9 个 symbol，symbol-not-found 错误数 0/9（从 1/9 降至 0/9）
- [x] SC-003：4 种变体 15 次 resolve，top-1 命中 ≥ 12 次
- [x] SC-004：多候选场景 `autoResolved` 恒 `false`，无误自动 resolve
- [x] SC-001~SC-006 逐条均有可测量口径（数值基线或结构断言）

### 6.4 SC-001~006 逐条可验证

- [x] SC-001：四层各层 confidence 区间 + matchKind 断言，单元测试级验证
- [x] SC-002：9/9 成功，数值口径
- [x] SC-003：≥12/15 top-1 命中，数值口径，成功口径已在 spec 收口（W-2 已 AUTO-RESOLVED）
- [x] SC-004：`autoResolved: false` 多候选 + threshold floor ≥ 0.9，双重断言
- [x] SC-005：3859 vitest pass + 分支覆盖率 ≥95% + build 零错误 + repo:check 零警告
- [x] SC-006：C-102/C-206 更新为结构完整性断言，行号已定位

---

## 7. Codex 对抗审查（每 Phase 必做）

- [x] Spec 阶段 Codex 对抗审查已完成（spec Open Questions 章节中标注"Codex 对抗审查 round-1 后"，4 个 OQ 均已收口）
- [ ] Plan 阶段 Codex 对抗审查：plan.md 生成后，critical 全修后方可进入 Tasks
- [ ] Tasks 阶段 Codex 对抗审查：tasks.md 生成后，critical 全修后方可进入 Implement
- [ ] Implement 阶段 Codex 对抗审查：每个 commit 前，critical 全修后方可提交
- [ ] Verify 阶段 Codex 对抗审查：SC-001~006 全部达成后，critical 全修后方可交付

---

## 检查总结

| 分类 | 条目数 | 通过 | 未通过 |
|------|--------|------|--------|
| 1. 需求完整性 | 18 | 18 | 0 |
| 2. TDD 合规 | 10 | 10 | 0 |
| 3. 测试覆盖 | 8 | 8 | 0 |
| 4. 向后兼容/合同 | 8 | 8 | 0 |
| 5. 误自动 resolve 防护 | 4 | 4 | 0 |
| 6. 验收门禁 | 10 | 10 | 0 |
| 7. Codex 对抗审查 | 5 | 1 | 4 |
| **合计** | **63** | **59** | **4** |

> **说明**：7 类 Codex 对抗审查中，Plan/Tasks/Implement/Verify 4 个阶段的审查尚未执行（这是预期的——spec 阶段检查只能确认 spec 级审查已完成）。这 4 项未通过不表示 spec 质量问题，而是后续阶段的强制执行约束，由编排器追踪。

**当前结论**：spec.md 需求质量 **通过**（59/59 规范类条目全部通过）；Codex 对抗审查门禁由后续阶段负责关闭。规范可进入 Plan 阶段。
