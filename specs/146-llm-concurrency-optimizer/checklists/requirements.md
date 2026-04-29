# Feature 146 质量检查清单：LLM 并发优化器

**生成时间**: 2026-04-29
**检查对象**: `specs/146-llm-concurrency-optimizer/spec.md`
**参照文档**: `specs/146-llm-concurrency-optimizer/research/tech-research.md`

---

## Content Quality（内容质量）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| CQ-01 | 无实现细节泄漏（未提及具体函数签名、行号、内部 API 调用路径） | `[ ]` | spec 中多处直接提及实现文件路径（`batch-orchestrator.ts`、`progress-reporter.ts`、`src/cli/`）和代码层内容（`pending: Promise<void>[]`、`Promise.race([])`、lines 920-951），超出需求规范应覆盖的范围；这些属于 plan/tasks 阶段内容 |
| CQ-02 | 聚焦用户价值和业务需求 | `[x]` | User Story 1-5 均以用户视角描述，优先级和价值说明清晰 |
| CQ-03 | 面向非技术利益相关者编写 | `[ ]` | Requirements 章节包含大量技术术语（`p-limit`、`Promise.allSettled`、`JS 单线程`、`ESM`），非技术读者无法理解；User Stories 部分相对友好，但需求列表不符合该标准 |
| CQ-04 | 所有必填章节已完成（背景、User Stories、需求、成功标准、约束） | `[x]` | 背景、User Stories、Requirements、Success Criteria、技术边界与约束、技术债务记录均已完成 |

**Content Quality 小计**: 2/4 通过

---

## Requirement Completeness（需求完整性）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| RC-01 | 无 `[NEEDS CLARIFICATION]` 标记残留 | `[x]` | 全文未发现 `[NEEDS CLARIFICATION]` 标记；部分标记为 `[AUTO-RESOLVED]`，属于已解决标注，符合规范 |
| RC-02 | 需求可测试且无歧义 | `[x]` | FR-001 到 FR-016 每条均有明确的行为描述；SC-001 到 SC-010 提供了可测量的数值指标（如 SC-006 的 `< 700ms`、SC-007 的 4/4 通过） |
| RC-03 | 成功标准可测量 | `[x]` | SC-001 至 SC-010 均含具体断言（数量、比较值、通过数）；SC-005 明确允许 < 1% 误差范围 |
| RC-04 | 成功标准是技术无关的 | `[ ]` | SC-007/SC-008/SC-009/SC-010 直接引用技术产物（`npm run test:e2e`、`npx vitest run`、`npm run build`、`batch-orchestrator.ts` 内部实现），这些是验证手段而非业务成果，不属于技术无关的成功标准；建议将验证手段移至 plan/tasks，SC 层保留业务层表述 |
| RC-05 | 所有验收场景已定义 | `[x]` | 每个 User Story 均有明确的 Given/When/Then 验收场景；Edge Cases 表覆盖 9 个边界条件 |
| RC-06 | 边界条件已识别 | `[x]` | Edge Cases 章节完整覆盖：`concurrency=0`、`concurrency<0`、`concurrency` 超过模块数、全部失败、单模块超时、同时完成、字符串输入、空 pending 数组、checkpoint 并发写入 |
| RC-07 | 范围边界清晰 | `[x]` | "可修改范围"与"不可修改范围"章节明确列举，`src/panoramic/`、`llm-client.ts`、`BatchOptions` 接口签名均明确标注不可修改 |
| RC-08 | 依赖和假设已识别 | `[x]` | 外部依赖约束章节明确：`p-limit` 需满足纯 ESM + Node.js 20.x；SDK v0.39.0 `>= 500` 覆盖 529 的依赖在 FR-016 和 tech-research 中有记录；禁用的额外依赖也有明确约束 |

**Requirement Completeness 小计**: 6/8 通过

---

## Feature Readiness（特性就绪度）

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| FR-A | 所有功能需求有明确的验收标准 | `[x]` | FR-001 至 FR-016 每条均可在 Success Criteria 中找到对应的验收锚点；P1 需求对应 SC-001 到 SC-007/SC-008，P2 需求有对应 User Story 验收场景 |
| FR-B | 用户场景覆盖主要流程 | `[x]` | 5 个 User Story 覆盖：CLI 并发加速（US1）、失败隔离（US2）、进度可视化（US3）、可观测性（US4）、向后兼容（US5），主要流程无缺漏 |
| FR-C | 功能满足 Success Criteria 中定义的可测量成果 | `[x]` | SC-003（并发上限严格执行）、SC-004（失败隔离）、SC-005（token 累加）、SC-006（耗时加速）均有数值目标；SC-007/SC-008/SC-009 验证回归防护 |
| FR-D | 规范中无实现细节泄漏 | `[ ]` | 同 CQ-01：FR-001 引用 `batch-orchestrator.ts` steps 4 并发调度段约 30 行；FR-010/FR-011 引用 `ProgressReporter` 接口签名和 `p-limit.activeCount` 属性；FR-015 提及 `if concurrency <= 1` 分支写法；复杂度评估章节引用具体文件行数。这些技术细节属于 plan/tasks 层 |

**Feature Readiness 小计**: 3/4 通过

---

## 专项检查：tech-research 一致性

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| TC-01 | 默认 concurrency 值与调研结论一致（推荐 3-5） | `[x]` | tech-research Q1 推荐 3-5；DQ1 决策选择 3，理由明确（429 风险可控），与调研一致 |
| TC-02 | p-limit 引入与调研推荐一致（方案 B） | `[x]` | tech-research Q2 推荐方案 B（p-limit）；FR-001/FR-013/DQ3 均采纳，且约束条件（纯 ESM、Node.js 20.x）与调研一致 |
| TC-03 | 应用层重试保留决策与调研结论一致 | `[x]` | tech-research Q1 推荐方案 B（保留双层重试，用 concurrency 限流）；DQ2/FR-016 明确保留应用层重试并澄清语义，与调研一致 |
| TC-04 | Promise.allSettled 使用与调研结论一致 | `[x]` | tech-research Q4 明确推荐维持方案 A（processOneModule 内部 catch + Promise.allSettled）；FR-007 采纳此方案 |
| TC-05 | 进度展示方案与调研结论一致（方案 B，不引入新依赖） | `[x]` | tech-research Q5 推荐方案 B（扩展现有 ProgressReporter）；FR-010/FR-011 采纳，且 FR 约束中明确禁止 ora/cli-progress |
| TC-06 | E2E 测试文件归属与调研结论一致（新建独立文件） | `[x]` | tech-research Q6 推荐方案 A（新建 batch-concurrency.e2e.test.ts）；DQ4 明确采纳此方案 |
| TC-07 | 9N 请求放大风险在 spec 中有 mitigation | `[x]` | tech-research Q1 发现 9N 请求放大风险；spec 中 DQ2 决策明确保留双层重试但通过 concurrency=3 限流，FR-016 要求代码注释记录双层关系，TD-003 列为已知技术债务。风险已识别并有 mitigation 措施 |

**tech-research 一致性小计**: 7/7 通过

---

## 专项检查：向后兼容与测试可行性

| # | 检查项 | 结果 | Notes |
|---|--------|------|-------|
| BC-01 | runBatch 函数签名未新增必填参数 | `[x]` | FR-014 明确要求函数签名向后兼容，`concurrency` 字段已存在，仅改默认值 |
| BC-02 | CLI flag 命名与现有约定不冲突 | `[x]` | DQ5 确认 `--concurrency=N` 与 `BatchOptions.concurrency` 字段名对齐，且未与现有 flag 冲突（spec 未提及冲突，内部命名约定一致） |
| BC-03 | F144 E2E 框架可覆盖 SC-007（默认配置零回归） | `[x]` | SC-007 明确要求 `npm run test:e2e` 4/4 通过；tech-research Q6 分析 F144 的 mock 模式（vi.hoisted + vi.mock + mkdtempSync）可复用；DQ4 新建独立 E2E 文件，不增加 F144 运行时间，技术可行 |
| BC-04 | concurrency=1 顺序路径保留（FR-015） | `[x]` | FR-015 明确要求 `concurrency=1` 时采用顺序处理路径，不引入 p-limit 调度开销 |

**向后兼容与测试可行性小计**: 4/4 通过

---

## 汇总

| 维度 | 通过 / 总计 | 状态 |
|------|------------|------|
| Content Quality | 2 / 4 | 未通过 |
| Requirement Completeness | 6 / 8 | 未通过 |
| Feature Readiness | 3 / 4 | 未通过 |
| tech-research 一致性 | 7 / 7 | 通过 |
| 向后兼容与测试可行性 | 4 / 4 | 通过 |
| **总计** | **22 / 27** | **未通过** |

---

## 未通过项汇总与修复建议

### 关键问题（影响规范质量）

**CQ-01 / FR-D — 实现细节泄漏（2 项同根）**

spec.md 在 Requirements 章节和 Success Criteria 中大量引用实现层内容：
- 文件路径：`batch-orchestrator.ts`、`progress-reporter.ts`、`src/cli/`
- 内部代码细节：`Promise.race([])`、`pending: Promise<void>[]`、`lines 920-951`
- 库 API：`p-limit.activeCount`、`Promise.allSettled()`
- 分支逻辑：`if concurrency <= 1`

**建议**：将上述技术细节从 spec.md 中剥离，移至 plan.md 或 tasks.md。FR 层应描述"系统应具备何种能力"而非"如何实现"，例如：
- FR-001 当前："替换 `batch-orchestrator.ts` 中的手写信号量（步骤 4，约 30 行）为 `p-limit` 库"
- 建议改为："系统应使用成熟的并发控制库替代现有手写并发调度实现，消除已知的死锁边界风险"

**CQ-03 — 面向非技术利益相关者**

Requirements 章节使用了大量技术术语（`Promise.allSettled`、`p-limit`、`ESM`、`JS 单线程`），非技术利益相关者无法理解。

**建议**：如本 spec 的主要受众是技术团队内部，可在 spec 顶部明确"受众：工程师"并豁免该标准；否则需将技术术语移至备注或 plan 层。

**RC-04 — 成功标准技术无关性**

SC-007 至 SC-010 引用了工程验证手段（test:e2e 命令、vitest 通过数、build 命令、源文件内容），这些是验证工具而非业务成果。

**建议**：将 SC-007/SC-008/SC-009/SC-010 调整为业务层表述，例如：
- SC-007 改为："Feature 146 上线后，既有 batch 流水线的所有 E2E 测试用例全部通过（无回归）"
- 将具体命令（`npm run test:e2e`）保留在 plan/tasks 的验收步骤中

---

**整体结论**：spec.md 在业务需求覆盖度和 tech-research 一致性方面表现出色（14/16 通过），主要问题集中在"实现细节过度渗入规范层"。建议在进入 plan 阶段前，将 FR 和 SC 中的实现细节上移（移除或替换为功能描述），保持 spec 层的技术无关性。
