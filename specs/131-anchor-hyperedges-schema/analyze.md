# Analyze: F4 Anchor — 一致性 / 完整性 / 可执行性 审查

**特性分支**: `131-anchor-hyperedges-schema`
**分析日期**: 2026-04-19
**执行者**: analyze 子代理（分析内容由主编排器落盘）

---

## 执行摘要

| 指标 | 值 |
|------|-----|
| 总 FR | 26 |
| 总 Task | 40 |
| FR 覆盖率 | 25/26 = 96.2%（FR-025 `graph_community` 适配明确为可选豁免） |
| AC 验证覆盖率 | 11/12 = 91.7%（AC-003 INFERRED 假阳性率为人工验证） |
| `[P]` 并行标记合法性 | 6 组均合法，无文件共享冲突 |
| clarify 决议体现 | 6/6（但 clarify.md Q5 正文笔误，下游一致） |
| 8 项研究风险覆盖 | 7/8 充分覆盖；Risk 6 tokenUsage 记录存在 BudgetGate 接口歧义 |
| BLOCKING | 0 |
| CRITICAL | 3 |
| HIGH | 6 |
| WARNING | 6 |
| INFO | 4 |

**结论**：可以进入 implement，但建议先在本编排器层面修复 3 项 CRITICAL，再开始 Commit 1 实现。

---

## 发现表

| ID | 类别 | 严重性 | 位置 | 摘要 | 处理 |
|----|------|--------|------|------|------|
| F01 | 术语漂移 | CRITICAL | spec.md FR-001/AC-012 vs plan.md/tasks.md | spec.md 的 FR-001、约束表、AC-012 引用 `src/models/doc-graph-types.ts`，但该文件**不存在**。plan.md 和 tasks.md 全部指向 `src/panoramic/graph/graph-types.ts`（实际存在，且已包含 `ConfidenceLevel = 'EXTRACTED' \| 'INFERRED' \| 'AMBIGUOUS'`） | 主编排器修正 spec.md 路径引用 |
| F02 | 跨制品不一致 | CRITICAL | clarify.md Q5 正文 vs spec/plan/tasks | clarify.md Q5 "推荐答案"声明使用 `CONFIRMED \| INFERRED \| SPECULATIVE`，但同文件"自动解决汇总"、spec.md Open Questions 第 5 条、plan.md `ConfidenceLevel` 类型、tasks.md 说明均使用 `EXTRACTED \| INFERRED \| AMBIGUOUS`。下游制品一致 | 主编排器在 clarify.md Q5 正文加"已按用户 Prompt 纠正"注释，避免 implement 读到矛盾信息 |
| F03 | 规格不足 | CRITICAL | plan.md 开放问题 #5 + tasks.md T020 | BudgetGate 的 `runBudgetGate` 是**事前预算决策** API（需 `BudgetDecisionInput.totalEstimate + budget`），不是事后记录。T020 的"通过 BudgetGate 记录 tokenUsage"调用路径未定 | 主编排器把本问题明确加入 implement agent 的前置分析任务；建议方案：写入 `BudgetGateAttempt` 格式日志 / 复用现有 usage recorder |
| F04 | 可执行性风险 | HIGH | Commit 6 T040 + AC-002/003/004 | graphify 示例项目 fixture 不存在（`specs/_meta/graph.json` 不在仓中；`tests/fixtures/` 也不存在） | 记录；Commit 6 验收分两层：design-doc-project fixture（T019）单元级 + 真实项目手工验证 |
| F05 | 依赖关系 | HIGH | tasks.md T020 | T020 依赖仅列 `T013 · T017`，实际还需 T010 / T011 / T015 | 主编排器在 implement agent 上下文中明确补齐 |
| F06 | 规格不足 | HIGH | tasks.md T028 vs FR-017 | feature flag 读取（env + CLI 优先级）的架构边界未明。extractor 无法直接读取 argv | implement 阶段采用：T032（doc-graph-builder.ts）读取 env+CLI → 作为参数传入 `extractHyperedges(options)` |
| F07 | 覆盖缺口 | HIGH | NFR-001 | 性能目标（<30s 冷启动，<200ms/chunk）无自动化验证 Task | NFR-001 标为 `[可选]`，记录为仅手工验证 |
| F08 | 歧义 | HIGH | AC-002 | design-doc-project fixture 能否稳定输出 ≥10 条边未明 | T019 fixture 设计需确保 doc chunk 与代码函数名语义强关联 |
| F09 | 不一致 | WARNING | spec.md 约束表 | `src/models/doc-graph-types.ts` 路径错误 | 与 F01 一起修正 |
| F10 | 术语漂移 | WARNING | research-synthesis.md | 架构图路径为过时引用，历史快照无需修改 | 已记录 |
| F11 | 完成门不全 | WARNING | Commit 4 T031/T032 | Commit 4 完成门未包含 pure-code fixture 验收点 | implement agent 补齐 |
| F12 | 覆盖缺口 | WARNING | T033/T035 | `graph_hyperedges` 非法过滤参数测试缺失 | implement agent 在 T035 补一个错误响应测试用例 |
| F13 | 规格不足 | WARNING | T014 | mock transformers 后无法测真实推理耗时 | NFR-001 记录为仅手工验证 |
| F14 | 可执行性 | WARNING | T009 / plan 开放问题 #4 | `@huggingface/transformers` CI 模型缓存未解决 | Local Provider 在 CI 中完全 mock，问题不影响 CI 通过 |
| F15 | 可选豁免 | INFO | FR-025 | `graph_community` 适配无强制 Task | 已明确为 Polish 阶段可选，无需修改 |
| F16 | 笔误 | INFO | tasks.md Commit 1 并行表 | 写成 "T004 + T011 可并行"，T011 实际属于 Commit 2 | implement agent 可忽略（并行建议仅是提示） |
| F17 | 分工 | INFO | T039 | 与 T008 都测 direction-audit，可拆分职责（T008 单元，T039 CLI 端到端） | implement agent 读取此备注即可 |
| F18 | 设计建议 | INFO | T019 | fixture 需故意使 doc 文本与函数名强语义关联 | 在 T019 实现时注意 |

---

## FR 覆盖映射

| FR | 主要 Task | 状态 |
|----|----------|------|
| FR-001 SemanticEdgeRelation 枚举 | T001 | 覆盖 |
| FR-002 confidence 枚举 | T001 · T002 | 覆盖（EXTRACTED/INFERRED/AMBIGUOUS 命名已与 Prompt 对齐） |
| FR-003 INFERRED/AMBIGUOUS 必带 evidenceText | T002 · T017 | 覆盖 |
| FR-004 evidenceSource repo-relative | T002 · T017 | 覆盖 |
| FR-005 hyperedges[] 顶层 | T003 | 覆盖 |
| FR-006 schemaVersion 联合 | T001 · T002 · T003 | 覆盖 |
| FR-007 direction-audit 白名单 | T007 · T008 | 覆盖 |
| FR-008 golden-master 双版本 | T004 · T005 · T006 | 覆盖 |
| FR-009 Hybrid Chunking | T011 · T012 | 覆盖 |
| FR-010 EmbeddingProvider 接口 | T010 · T021 · T023 · T024 | 覆盖 |
| FR-011 Local Provider + 失败清晰错误 | T013 · T014 | 覆盖 |
| FR-012 阈值 >= | T015 · T016 | 覆盖 |
| FR-013 rationale_for 仅 LLM | T017 · T027 | 覆盖 |
| FR-014 三元组去重 | T017 · T018 | 覆盖 |
| FR-015 零 chunk 降级 | T011 · T020 · T038 | 覆盖 |
| FR-016 tokenUsage 记录 | T010 · T013 · T014 · T020 | 覆盖（接口歧义 F03 待 implement 阶段明确） |
| FR-017 feature flag 双入口 | T028 · T029 · T032 · T037 | 覆盖（架构歧义 F06 已有解决方案） |
| FR-018 ≤10/batch | T025 · T026 · T027 | 覆盖 |
| FR-019 Zod 校验降级 | T025 · T028 · T029 | 覆盖 |
| FR-020 hyperedge 合法性 | T003 · T025 · T026 · T028 · T029 | 覆盖 |
| FR-021 仅 design-doc 节点 | T027 · T028 | 覆盖 |
| FR-022 graph_hyperedges | T033 · T035 | 覆盖（非法参数测试缺失 F12） |
| FR-023 响应字段 | T033 · T035 | 覆盖 |
| FR-024 graph_node 适配 | T034 · T035 | 覆盖 |
| FR-025 graph_community 适配 | — | 豁免（明确可选） |
| FR-026 SKILL.md | T036 · T037 | 覆盖 |

---

## AC 验证 Task 映射

| AC | 验证 Task | 验证类型 |
|----|----------|---------|
| AC-001 schemaVersion: "2.0" | T040 | 自动化 |
| AC-002 ≥10 条边 | T040 | 半自动（依赖 fixture） |
| AC-003 INFERRED 假阳性 < 20% | — | 人工（交付后） |
| AC-004 ≥1 Full Ingestion Pipeline | T040 | 半自动 |
| AC-005 纯代码零边 | T038 | 自动化 |
| AC-006 graph_hyperedges 过滤 | T035 | 自动化 |
| AC-007 vitest 零新增失败 | 每个 Commit 完成门 | 自动化 |
| AC-008 build 零错误 | 每个 Commit 完成门 | 自动化 |
| AC-009 schema 单测 | T006 | 自动化 |
| AC-010 direction-audit 通过 | T008 · T039 | 自动化 |
| AC-011 tokenUsage 含 llmModel + durationMs | T014 | 自动化 |
| AC-012 schema 独立 commit | T008 [!] 完成门 | 人工代码审查 |

---

## 跨 Feature 文件冲突检测

**近 4 个活跃 Feature 扫描结果**：

| Feature | 与 F131 重叠文件 | 严重性 | 状态 |
|---------|----------------|--------|------|
| 125-product-doc-semantic | 无重叠 | — | 已合并 |
| 126-batch-output-quality | 无重叠 | — | 已合并 |
| 127-reveal-cost-transparency | `plugins/spectra/skills/spectra/SKILL.md`、`plugins/spectra/skills/spectra-batch/SKILL.md`（F131 T036/T037 也改） | MEDIUM | 已合并到 master |
| 128-harden-spec-store | `src/panoramic/builders/doc-graph-builder.ts`（F131 T032 也改） | MEDIUM | **已合并到 master**（commit f125082 `refactor(128): enable sourceKind filter ...`） |

**主编排器判断**：F127 和 F128 的相关变更都已在 origin/master 上，本 feature 分支已 rebase 至最新 master（起始 commit 3213b14 是 F128 的延续提交）。SKILL.md 和 doc-graph-builder.ts 的基线是 post-F128 状态。F131 在此基础上增量修改，**无 rebase 冲突**。

---

## 风险覆盖验证

| Risk | 覆盖状态 | 主 Task |
|------|---------|---------|
| Risk 1 INFERRED 假阳性 | 已覆盖 | T017 `buildSemanticEdges` 丢弃空 evidenceText + AC-003 人工 |
| Risk 2 Hyperedge 数量失控 | 已覆盖 | T025 Zod `max(10)` + T027 prompt 指令 |
| Risk 3 依赖加载失败 | 已覆盖 | T013 动态 import + catch + T009 optionalDeps |
| Risk 4 schema 破坏 | 已覆盖 | T002/T003 optional + T004/T005/T006 双 fixture |
| Risk 5 LLM 输出不合规 | 已覆盖 | T028 safeParse + failedSamples |
| Risk 6 tokenUsage 遗漏 | **部分覆盖**（F03 BudgetGate 接口歧义，implement 阶段解决） |
| Risk 7 纯代码降级 | 已覆盖 | T011 返回 [] + T031 fixture + T038 测试 |
| Risk 8 evidenceText 截断 | 已覆盖 | T017 对称扩展 + T018 边界测试 |

---

## 阻断项清单

### 必须在 implement 前解决（主编排器层面）

- **B1 / F01 / F09**：修正 spec.md 中的文件路径引用，改为 `src/panoramic/graph/graph-types.ts`
- **B2 / F02**：在 clarify.md Q5 正文追加纠正说明，避免 implement 读到矛盾
- **B3 / F03**：作为 implement agent 的前置说明，要求其在 T020 实现前先读 `src/batch/budget-gate.ts` 完整接口

### 可在 implement 中边做边定

- F06（feature flag 读取架构）：建议方案已明，T032 读取后作为参数传入
- F04（graphify fixture）：Commit 6 再决定是否用真实项目或仅 design-doc-project fixture
- F12（graph_hyperedges 非法参数）：T035 补一个测试用例
- F14（CI 模型缓存）：T009 实现时决定

---

## 进入 implement 判断

**可以进入 implement**。40 个 Task 设计合理；Commit 间依赖链清晰；所有 [P] 标记合法；跨 Feature 无冲突（F128 / F127 已合并 master）。主编排器会在 Phase 6 启动前修正 3 项 CRITICAL 并把 implement 前置说明传给 implement agent。

*分析版本：v1.0 · 基于 2026-04-19 制品快照*
