# Research Summary: 架构模式提示与解释

## 决策摘要

### 决策 1

- **Decision**: 050 采用独立 `PatternHintsGenerator`，直接组合 045 的结构化架构概览输出
- **Rationale**: 保持“045 提供事实、050 提供模式提示与解释”的边界，避免将模式逻辑反向耦合进 045
- **Alternatives considered**:
  - 把模式提示塞进 045 模板
  - 重新做一份独立黑盒模式报告

### 决策 2

- **Decision**: 模式、confidence 与 evidence 由知识库规则决定，LLM 只增强 explanation 文案
- **Rationale**: 保证结果可追踪、可复核，并符合 Constitution 对不确定性标注和验证证据的要求
- **Alternatives considered**:
  - 让 LLM 直接判断模式
  - 完全不使用 explanation 增强能力

### 决策 3

- **Decision**: 通过“045 正文 Markdown + 050 附录 Markdown”拼接实现主载体交付
- **Rationale**: 满足蓝图的“以内嵌附录交付”要求，同时不侵入 045 模板
- **Alternatives considered**:
  - 单独输出 050 文档
  - 修改 045 模板直接接收 optional appendix

### 决策 4

- **Decision**: 对缺失架构版块、弱依赖缺失和 LLM 不可用场景采用 section-aware 降级
- **Rationale**: 让 050 在实验性增强层保持可用，而不是因某一类输入不足整体失败
- **Alternatives considered**:
  - 任一证据不足即不输出 pattern hints

## 结论

050 的实现应聚焦于共享模型上的模式判断、证据链组织和 explanation 增强，不应再引入新的底层事实抽取逻辑。045 继续作为主事实载体，050 在其上输出规则驱动的 pattern hints 与附录解释。
