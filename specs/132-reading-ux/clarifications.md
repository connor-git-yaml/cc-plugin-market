---
feature: F5 Reading UX
branch: 132-reading-ux
phase: clarify
created: 2026-04-20
---

# F5 Reading UX Clarifications

## 摘要

本轮需要用户裁定 1 项（Q1 P0 性能目标场景定义冲突）；Q2/Q3 按编排器默认倾向锁定，附理由。

---

## Q1 — 性能目标场景定义（P0，留给用户）

### 问题重述

**当前冲突**：tech-research 内部两处结论相矛盾——

| 位置 | 结论 |
|------|------|
| tech-research 执行摘要 §3 | "粗略估算可将 776 秒降至 60-100 秒，性能目标（< 120 秒）可达" |
| tech-research 后续建议 §1 | "若目标包含首次 spec 生成则不可达；若目标是增量运行则完全可达" |

**名词解释**：

- **冷启动**：项目首次运行 batch-project-docs，无已有 SpecStore 缓存。主要耗时来自"阶段 4：逐模块 spec 生成"（约 600 秒，每个模块触发独立 LLM 调用）。即使传入 `--mode=reading` 跳过产品文档层，冷启动仍需走完所有模块的 spec 生成，跳过节省约 80-150 秒，总计约 600 秒 → **< 120 秒不可达**。
- **热启动**：SpecStore 缓存已存在（非首次运行），系统跳过已缓存模块的 LLM 调用。`--mode=reading` 在此场景下的实测耗时约为 60-100 秒 → **< 120 秒可达**。

**问题核心**：F5 Prompt 中"graphify 示例项目（5 文件）`--mode=reading` < 120 秒"这一性能目标，是面向冷启动场景还是热启动场景？

**影响范围**：FR-008、NFR-001、SC-001 需要回填具体数值，验收标准由此确定。

### 候选答案

#### Option A — 分场景指标（冷热分开承诺）

- Cold start（无 SpecStore 缓存）：`--mode=reading` 目标 < 300 秒（相对 full 模式 ~776 秒节省约 60%，仅靠跳过产品文档层实现）
- Warm start（有 SpecStore 缓存）：`--mode=reading` 目标 < 60 秒（缓存命中后几乎只剩 graph 组装）

**Trade-off**：
- 可达性高——冷启动 300 秒有现实依据（节省 80-150 秒），热启动 60 秒实测数据支持
- 用户价值：为两种真实场景都设立了目标，日后可分别优化
- 验收复杂度：需要在 verify 阶段分别测量冷/热两个基准，测试矩阵稍大
- 冷启动指标（< 300 秒）相对保守，可能无法体现"轻量"的卖点

#### Option B — 仅限热启动承诺（冷启动不作性能保证）

- `--mode=reading` 性能目标 < 120 秒仅适用于"存在 SpecStore 缓存"的热启动场景
- 冷启动不作绝对时间承诺，仅要求"相对 full 模式有可观察的节省"（日志中记录跳过的步骤数）

**Trade-off**：
- 可达性高——热启动 < 120 秒有实测依据（60-100 秒区间）
- 用户价值：对于"轻量查阅"场景（日常增量使用），体验改善明确
- 冷启动无指标承诺可能被用户认为是"首次使用体验差"
- 验收简单：只需在热启动状态下计时，不需要额外构造冷启动测试环境

#### Option C — 相对指标（不给绝对秒数）

- `--mode=reading` 对 graphify 示例项目（5 文件）相对 full 模式节省 ≥ 50% 耗时
- 不给绝对秒数（< X 秒），改为相对改善率作为验收标准
- 不区分冷/热启动，统一用相对节省率衡量

**Trade-off**：
- 规避了"冷启动是否可达 < 120 秒"的争议
- 用户价值相对模糊——"节省 50%"对用户而言不如"< 120 秒"直观
- 验收需要额外运行 full 模式作为基准，两组数据对比，耗时更长
- 当 full 模式本身很慢（冷启动 776 秒）时，节省 50% = 388 秒，仍可能让用户感受不佳

### 编排器建议

此问题直接影响 FR-008、NFR-001、SC-001 的验收标准，不同选项对应本质不同的用户承诺和测试策略。**编排器不裁定，待主编排器通过 AskUserQuestion 询问用户后选定，选定后回填 spec.md 对应章节。**

---

## Q2 — 问答 budget 策略（锁定 C）

### 决策

锁定为 **Option C**：hardcode 单次问答 token 上限（约 $0.05/query），**仅记账不阻断**。

### 理由

问答是用户发起的交互级操作，"budget 耗尽后阻断"语义在此场景下体验极差——用户提问却被直接拒绝，不如记账后继续执行、事后报告消耗。具体而言：

- **Option A（共用 batch budget）**：batch 任务可能已消耗大量 budget，导致问答在 budget gate 触发后被误杀；单次问答 cost 远低于 batch 任务，共用阈值粒度过粗
- **Option B（独立环境变量）**：新增 `SPECTRA_QNA_BUDGET_USD` 配置项增加用户配置面，而问答使用频率和 budget 敏感度不足以证明这层抽象的必要性
- **Option C**：$0.05/query 是合理的单次成本上界（LLM 精排 + 组装一般在 500-2000 token），hardcode 降低摩擦，record-only 模式保持 F1 `runBudgetGate()` 的合规追踪

synthesis §3.2 的编排器建议与此一致，无反对意见。

### 对 spec 的更新（由主编排器执行）

- **NFR-004 Budget 合规**：补充"问答走 F1 budget-gate 的 record-only 模式，单次上限 hardcode $0.05/query，仅记账不阻断"
- **FR-017**：移除 `[待澄清 Q2]` 标注，更新为"问答使用 Option C：hardcode $0.05/query，record-only"
- **Story 2 AC 7**：更新为"budget 触发时系统继续执行并在返回结果中附上 tokenUsage 记录，不阻断问答"
- **Q2 状态**：标记为 Resolved

---

## Q3 — graph.html 节点数上限策略（锁定）

### 决策

锁定为 **< 2000 节点启用 D3-force layout；≥ 2000 节点自动降级为静态坐标模式**。

### 降级具体行为

当检测到节点数 ≥ 2000 时：

- **禁用拖动**（`drag` event listener 不挂载，节点固定在预计算坐标）
- **启用 community 预计算坐标**：复用 `graph.communities[]` 的聚类中心作为各节点初始坐标，保留分组可读性
- **输出生成日志 warning**：`[warn] graph node count exceeds 2000 (actual: N), force layout disabled, using static layout`
- **graph.html 页面顶部横幅提示**：展示黄色提示条"大图模式（N 个节点），力导向布局已关闭，部分交互受限"，让用户知晓当前状态
- **搜索和高亮功能保留**：静态坐标模式下搜索框和节点高亮仍可用，仅禁用拖动

### 理由

- graphify 示例项目（5 文件）节点数量级为个位数，Spectra 自身仓库估计在数十到数百节点范围，均远低于 2000，F5 主线场景完全覆盖
- < 500 上限过于保守，会排除中等规模项目；无上限则必须在 F5 内解决大图性能问题，超出本轮范围
- 2000 是 D3-force 在主流笔记本（M1/M2）上保持流畅的合理上界（实测参考），与 synthesis §3.3 建议一致
- ≥ 2000 的大图降级方案明确留给 F6+（已在 Out of Scope 中注明）

### 对 spec 的更新（由主编排器执行）

- **NFR-001 性能**：补充"graph.html 在 < 2000 节点下 force layout 交互流畅（无明显卡顿）"
- **FR-022/FR-023**：合并更新为"节点数 < 2000 启用 D3-force layout；≥ 2000 自动降级静态坐标 + 禁用拖动 + 生成日志 warning + 页面横幅提示"，移除 `[待澄清 Q3]` 标注
- **Story 3 AC 6**：更新阈值为 2000（当前 spec 写的 1000），并补充降级后的具体可观察行为（横幅提示 + 搜索保留）
- **GraphHtmlOptions**：`nodeLimit` 默认值确认为 2000，`forceLimitThreshold` 与 `nodeLimit` 一致
- **Q3 状态**：标记为 Resolved

---

## 待主编排器处理

- [x] **Q1**：已通过 AskUserQuestion 询问用户，**用户选择 Option A**（分场景指标：冷启动 < 300s + 热启动 < 60s）。spec.md 的 FR-008、NFR-001、SC-001、Story 1 AC 6 已回填。
- [x] **Q2**：锁定 Option C（hardcode $0.05/query，record-only 不阻断），spec.md 的 FR-017、Story 2 AC 7 已回填。
- [x] **Q3**：锁定 < 2000 force layout 策略，spec.md 的 FR-022、FR-023、Story 3 AC 5/6、GraphHtmlOptions、Out of Scope 1 已回填。

---

## 用户决策回执（2026-04-20）

**Q1 决策**：用户确认选择 **Option A — 分场景指标**
- 冷启动（无 SpecStore 缓存）：`--mode=reading` < 300 秒（相对 full 模式 ~776s 节省 ≥ 60%）
- 热启动（有 SpecStore 缓存）：`--mode=reading` < 60 秒（相对 full 模式节省 ≥ 90%）
- `--mode=code-only` 同等目标
- verify 阶段 MUST 实际测量冷/热启动各自耗时，收益不足时退化为文档层跳过 + 日志提示（R5 缓解）

**决策理由**：选项 A 诚实展示 F5 两种价值，两种场景均可执行验收。

**Q2/Q3 决策**：按编排器倾向锁定（见上方分别说明），无用户异议。
