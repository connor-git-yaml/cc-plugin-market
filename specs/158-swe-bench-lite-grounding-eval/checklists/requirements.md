---
feature: 158
checklist: requirements
generated: 2026-05-09
reviewer: checklist-subagent
---

# Feature 158 — Quality Checklist

## 1. 完整性（Completeness）

- [x] **Hypothesis（H₀/H₁）明确**：PASS — spec.md §背景与目标明确列出 H₀（无显著差异）和 H₁（grounding lift > 0）
- [x] **用户故事覆盖（≥ 3 P1 + ≥ 1 P2）**：PASS — US-1/US-2/US-3 均为 P1，US-4/US-5 为 P2，共 5 个 story，结构完整
- [x] **每条 FR 有可验证验收信号**：PASS — FR-001 到 FR-007 每条均附"FR-XXX 验收信号"，信号可机器验证（grep / fs / JSON parse）
- [x] **NFR 可度量**：PASS — NFR-001 列分项估算 + 总额 ≤ $50；NFR-002 逐天 milestone；NFR-003 路径锁定；NFR-004 工具栈约束；NFR-005 字段可为 null 的向后兼容条件
- [x] **Edge Cases 覆盖 Codex W 项**：PASS — W-1 到 W-6 全部收录于 spec.md §Edge Cases（W-3 扩展为 callCount=0 与 tool mismatch 双路径）
- [x] **Out of Scope 明确**：PASS — §Out of Scope 列 I-1 到 I-4，含多语言/docker harness/long horizon/Opus 对比，防止 scope creep
- [x] **SC 可由 verify 脚本自动验收**：PASS — SC-001 到 SC-008 每条均写明 verify 脚本检查方式（fs / grep / JSON parse / exit code）；§Success Criteria 导语明确"由 verify-feature-158.mjs 自动验收"
- [x] **Verify FAIL 定义明确（科学结论 vs 工程失败）**：PASS — §Verify 失败定义明文界定 FAIL 唯一条件（技术性原因），并兜底列出不构成 FAIL 的情况（lift=0、W-3>50%、差值方向任意）

---

## 2. 一致性（Consistency）

- [x] **FR 与 SC 对应关系**：PASS — FR-001→SC-001；FR-002→SC-003/SC-004；FR-003→SC-002；FR-004（聚合）→SC-004/SC-005/SC-006；FR-005→SC-004；FR-006→SC-005；FR-007→SC-008，每条 FR 至少对应 1 条 SC
- [x] **FR 与 User Story 覆盖**：PASS — US-1 对应 FR-003/FR-004；US-2 对应 FR-005；US-3 对应 FR-001；US-4 对应 FR-006；US-5 对应 FR-007，无孤立 FR
- [x] **W-3 处置与 SC-004 字段依赖一致**：PASS — §Edge Cases W-3 定义的 `w3Flag` 计算规则（callCount=0 或 toolName 不在 expectedSpectraToolCalls）与 FR-005 schema 定义及 SC-004 验收信号完全对齐
- [x] **schema 1.2 字段在 FR-005 与 Key Entities 之间一致**：PASS — FR-005 的 `mcpToolCallTrace` JSON 结构与 §Key Entities §mcpAugmentedFixture 字段描述一致，均含 `toolName / callCount / firstCallTurn / totalDurationMs / w3Flag`
- [x] **术语统一性（pass rate / cohort 命名大小写）**：PASS — 全文 cohort 名称统一为 `control / spectra-push / spectra-mcp-pull`（小写 kebab-case）；pass rate 两字均小写；FR-002/FR-003/SC-004/SC-005 一致
- [x] **cohort 命名全文统一**：PASS — FR-003 表格、§SC 表格、§User Story 验收场景、§Edge Cases 均使用相同三个 cohort 名，无混用

---

## 3. 可测试性（Testability）

- [x] **每个 SC 可转化为 verify 脚本检查**：PASS — SC-001 用 `fs.readdirSync + JSON.parse + checks.length`；SC-002 用 `fs.existsSync + execSync --dry-run`；SC-003 用 `grep -ci`；SC-004 用 `JSON.parse + 字段类型检查`；SC-005 用 `grep -ci + 数据行计数`；SC-006 有 SKIP 分支；SC-007 有 WARN 分支；SC-008 用退出码
- [x] **每个 FR 可拆解为 plan 阶段 task**：PASS — §复杂度评估明确 3 个新增组件（脚本/fixture 集合）、2 个修改接口（eval-task-runner / schema）；FR 描述粒度可直接转 plan task
- [x] **verify 脚本退出码逻辑明确**：PASS — §FR-007 和 SC-008 均明确：全部 PASS→exit 0；任一 FAIL→exit 1；SKIP/WARN 不触发 FAIL；SC-008 要求 6/8 PASS 可过

---

## 4. 风险覆盖（Risk Coverage）

- [x] **Codex critical 3 条全部处置**：PASS — C-1（架构互斥）已通过 GATE_RESEARCH 用户决断收口（Node-only）；C-2（spike 单点）已 spike 解除（见 spike-claude-print-mcp.md）；C-3（预算击穿）通过 micrograd-style task + NFR-001 分项估算控制（≤$35 base，留 $15 余量）
- [x] **Codex warning 6 条全部缓解**：PASS — W-1 到 W-6 均在 §Edge Cases 中有对应处置策略，W-3 有 `w3Flag` 字段工程实现；W-6 有 multi-check（checks.length ≥ 2）要求
- [x] **预算溢出 early warning**：PASS — NFR-001 明确 1.5x 系数缓冲（base $20 × 1.5 = $30），SC-007 在 verify 脚本中累加 `costUsd` ≤ 50 并对缺字段输出 WARN 而非静默
- [x] **schema 升级 backward compatibility 验证**：PASS — NFR-005 明确消费方兼容清单（4 个消费方逐条说明），新字段均可为 null，不破坏现有 12 个 perf anchor fixture

---

## 5. 可执行性（Executability）

- [x] **plan 阶段可直接拆 task**：PASS — §复杂度评估、§YAGNI 检验、§NFR-002 milestone 表已提供足够信息（3 组件 / 2 接口 / 0 新依赖 / 2 周逐天计划），plan 阶段无需回 specify 补充
- [x] **implement 阶段依赖文件清晰**：PASS — §FR-002/FR-003 明确修改 `scripts/eval-task-runner.mjs`；新建 `scripts/eval-mcp-augmented.mjs` 和 `scripts/verify-feature-158.mjs`；追加 `competitive-evaluation-report.md §6`；fixture 路径 `tests/baseline/tasks/T158-*/` 锁定
- [x] **verify 脚本依赖锁定**：PASS — NFR-003 明确 fixture 路径 `tests/baseline/tasks/T158-*/<cohort>/full.json`；SC 表格列出每条检查的字段名与解析方式；FR-007 列出脚本参数约定

---

## 总评

| 维度 | 通过 / 总数 |
|------|------------|
| 完整性 | 8 / 8 |
| 一致性 | 6 / 6 |
| 可测试性 | 3 / 3 |
| 风险覆盖 | 4 / 4 |
| 可执行性 | 3 / 3 |
| **合计** | **24 / 24** |

**是否达到 GATE_DESIGN 通过基线**：**是**

**阻断性问题**：无

**附注**：

1. Codex adversarial review 文件（`codex-adversarial-review.md`）记录的是 3 条 CRITICAL + 6 条 WARNING，与任务背景中描述的"8 条 critical / 8 条 warning"不符。实际 spec.md 中处置内容对应 3C + 6W，均已完整覆盖。
2. SC-008 的通过门槛为 6/8 PASS（其余可 SKIP），verify 逻辑略微宽松；plan phase 建议在任务拆解时确认 SC-006（control token null 场景）和 SC-007（costUsd 缺字段 WARN 分支）的默认行为是否符合预期。
3. §歧义处置 4 条均已标注 `[AUTO-RESOLVED]`，无残留 `[NEEDS CLARIFICATION]` 标记。
