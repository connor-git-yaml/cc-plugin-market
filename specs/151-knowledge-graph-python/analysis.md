# Analysis - Feature 151 跨文档一致性

**生成日期**：2026-05-06
**分析对象**：spec.md / clarification.md / plan.md / tasks.md / quality-checklist.md / research/tech-research.md

---

## 总结

**8 维度结论**：

| 维度 | 结论 |
|------|------|
| 1 FR 完整覆盖 | 通过（10/10）|
| 2 EC 覆盖 | 部分一致（13/15 完整 + 2/15 部分：EC-9, EC-11）|
| 3 SC 验收闭环 | 通过（7/7）|
| 4 CL 落地追踪 | 部分一致（7/9 完整，CL-03/CL-08 有偏差）|
| 5 Codex 修订追踪 | 通过 |
| 6 Task 运行时编译依赖 | 部分一致（T-016a 依赖字段需补 T-008c）|
| 7 工作量估计 | 部分一致（宏观对齐，子任务新增工时未反向同步 spec/plan）|
| 8 风险表 vs Codex 修订 | 通过 |

**最终判断**：**可推进至 implement**

无 CRITICAL 阻断项，三文档核心架构设计方向高度一致。3 个 HIGH 问题已识别，正在修订。

---

## 关键发现（已修订）

### HIGH（implement 前修订完成）

- **F-01** tasks.md 任务总数前后矛盾（"27 个" vs "28 个"），实际 28 主 task / 39 子任务 — **已修订**
- **F-02** T-016a 正文 task 卡片依赖字段缺失 T-008c — **已修订**
- **F-03** CONFIDENCE_SCORES 数值引述偏差（spec/clarification 写 1.0/0.7/0.4，实际仓内为 0.95/0.65/0.25）— **已修订**

### MEDIUM（implement 时顺带修正）

- F-04 plan/tasks task 数字不对齐（plan 18 vs tasks 28）：本质是颗粒度差异，tasks 是 plan 的细分
- F-05 EC-11 无专属验收单测（依赖 T-012b/T-013a 间接覆盖）
- F-06 EC-9 plan 与 tasks 对 DependencyGraph 改造方案有轻微措辞差异（实质方案相同：本地构建）
- F-07 工作量估计微差（tasks +5h 未反向同步）
- F-08 CL-03 batch 直接路径方案在 plan §3.8 旧表述与 tasks T-015b 新表述间不一致 — **以 tasks T-015b 为准（BuildComponentViewOptions 加字段）**
- F-09 plan 末尾 4 INFO 项未明确编号

### LOW（实现时自然纠正）

- F-10 FR-8 覆盖映射含调研 task（T-006），可注明区分
- F-11 plan §3.4 伪代码 import 方向与正文建议矛盾（实现时按正文）

---

## NFR-2 覆盖缺口

NFR-2（peak RSS < 500MB）无专属验收 task，依赖 T-017 baseline 顺带观察。建议 implement 时 T-009b/T-009c/T-017 task 中加入 `process.memoryUsage()` 采样。

---

## 推进决策

文档一致性已足够：
- 10/10 FR 全覆盖
- 7/7 SC 验收闭环
- 关键串行链 9 节点合理
- 所有 Codex CRITICAL/WARNING 均落到下游
- HIGH 项已全部修订

**推进 implement**。
