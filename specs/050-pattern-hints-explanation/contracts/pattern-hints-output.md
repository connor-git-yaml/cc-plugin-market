# Contract: Pattern Hints Output

## 1. 输入边界

`PatternHintsGenerator` 必须以 Feature 045 的结构化架构概览输出为强输入：

- `ArchitectureOverviewOutput`（必需）

可选的弱依赖信号只用于增强 explanation 深度，不得成为主流程阻塞项：

- 043 相关 runtime availability / evidence 元信息（可选）
- 044 相关 doc graph / cross-reference availability 元信息（可选）

## 2. 输出边界

`generate()` 必须返回：

```ts
interface PatternHintsOutput {
  title: string;
  generatedAt: string;
  architectureOverview: ArchitectureOverviewOutput;
  model: PatternHintsModel;
  warnings: string[];
}
```

其中：

- `architectureOverview` 保留 045 主文档所需结构
- `model` 必须是模板无关的结构化 pattern hints 结果

## 3. 必备附录版块

渲染结果必须尽量覆盖以下版块：

1. 架构模式提示摘要
2. 已识别模式列表（名称、confidence、summary）
3. 证据链说明
4. 至少一个 why/why-not explanation
5. competing alternatives 或“未识别高置信度模式”结论
6. warnings / 降级说明

## 4. 降级行为

- 若 045 的某个 section 不可用：050 允许继续输出，但必须降低受影响模式的 confidence 或记录缺失原因
- 若无模式达到最低阈值：050 必须显式输出 `noHighConfidenceMatch`
- 若 `useLLM=true` 但 LLM 不可用：050 必须保留规则驱动结果，并静默降级 explanation 增强
- 若 045 不适用：`PatternHintsGenerator.isApplicable()` 应返回 `false`

## 5. 一致性要求

- 模式判断必须直接建立在 045 的结构化架构视图之上
- confidence 和 evidence 不能由 LLM 直接生成或覆盖
- 050 不得重新发明新的运行时 / workspace / 依赖图事实
- 050 默认以内嵌附录形式交付，而不是脱离架构概览的黑盒报告
