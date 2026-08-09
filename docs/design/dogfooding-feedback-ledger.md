# Dogfooding 反馈账本

> 每个需求收尾时，交付报告的「工具使用反馈」节除写在 chat 外，**同步 append 一条到本文件**
> （反馈为"无"则不落账）。`milestone-next` 循环的 §2.5 统一 review 待处理条目、聚类、
> 设计改进计划并回用户拍板；拍板后由 milestone-next 更新条目状态。
>
> 事实源关系：反馈约定的 SSoT 在 `docs/shared/agent-dogfooding-policy.md`（同步进
> CLAUDE.md / AGENTS.md）；本文件只是**账本载体**，不定义约定本身。

## 条目格式

```markdown
### F<NNN> · YYYY-MM-DD
状态：待处理
来源：specs/<NNN>-*/（交付报告反馈节）
- [维度][工具] 问题一句话 + 关键证据；改进方向（如有）
```

- 维度取 dogfooding policy 四维度：`MCP 可用性` / `信息完整性` / `流程顺畅度` / `结果准确性`
- 状态枚举：`待处理` → `已分流 → F<NNN> / M<N> roadmap` / `裁决不做（理由一句话）` / `已修复 → F<NNN>`
- 同一问题被多个需求重复报告时**不去重**，在旧条目上追加 `再现：F<NNN>` —— 复现频次本身是排期信号

---

## 待处理

### F261 · 2026-08-09
状态：待处理
来源：specs/261-fix-graph-builder-stamp-notes/（交付报告反馈节）
- [结果准确性][Spectra MCP] `impact(writeKnowledgeGraph, upstream)` 返回 `directCallers: 0` /
  `affected: []`，`context` 返回 `callers: []` 并提示"可能为顶层入口"——实际有 4 个生产调用方。
  根因是在盘图 stale，但**返回体没有任何新鲜度信号**，`callers: []` 与"真的没有调用方"不可区分，
  nextStepHint 还主动往错误推论上引。改进方向：MCP 返回体带 freshness 状态（F261 已把 builder
  这一维 provenance 落进图产物，缺的是接到 MCP 返回面），stale 时对空结果显式降级措辞
- [流程顺畅度][Spec Driver] 子代理无 git 写权限 + plan/spec 只读的组合，导致"主线程裁决推翻了
  plan 口径"只能记在 implementation-notes 偏差节里，plan.md 与实现持续背离（F261 第三/四轮
  D1-D6 裁决实证）。改进方向：给 fix/feature 流程补"裁决回写 plan（就地批注、保留原文）"的显式步骤
- [流程顺畅度][审查派发] 对抗审查子代理默认在主 worktree 做变异测试，与主线程抢文件（触发过
  "file modified on disk"）；主线程审查期间重建 dist 也让两路审查报告"移动靶"困扰。改进方向：
  把"变异/对抗实验必须在 /tmp 副本上做 + 派发前冻结改动面"升格为派发 prompt 模板硬约束
  （F261 第三轮起已在单个 prompt 里手工加此约束，实证有效，缺的是模板化）
- [MCP 可用性][harness] 一路对抗审查中途 API 断连（`Connection closed mid-response`），换新代理
  带自包含 prompt 后正常完成。与 memory `feedback_resumed_subagent_api_error_recovery` 一致；
  F261 缺陷②（implement 每 Phase 落 notes）已缓解 implement 侧，审查类子代理的断连损失暂靠
  自包含 prompt 重派。低优先级：harness 层问题，应用侧已有工作缓解

## 已处理

（暂无）
