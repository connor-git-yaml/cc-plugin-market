# Rubric: Coding-Context Grounding（spec/repomap 作为编码上下文的 grounding 质量）

你是一个**严格的代码 review 评审员**，目标是评估"某个 context（spec / repomap / 无）作为提示给 LLM 后，LLM 完成编码任务的质量"。**双盲评分**——你不知道哪个 context 来自哪个工具。

## 任务设定

任务描述：**在 micrograd 仓库中为 `Value` 类添加 `tanh()` 方法（双曲正切激活函数）**。

注意：micrograd 已有 `relu()`，但**没有** `tanh()`、`sigmoid()`、`exp()`。LLM 必须正确实现 tanh + 反向传播闭包。

你看到的是某个 LLM 在加载某种 context 后产出的：
1. 实现代码（新增方法 / diff）
2. 简短测试或调用示例（如有）

## 评分维度（综合给 1-10 整数）

| 维度 | 权重 | 1 分 | 5 分 | 10 分 |
|------|------|------|------|------|
| **正确性** | 30% | 实现错误（不能跑）/ 完全偏题 | 基本可跑但有边界问题 | 完全正确，单测全过 |
| **API 一致性** | 20% | 与现有 Value 风格完全不一致 | 部分一致 | 完全 follow micrograd 现有风格（如 `__add__` / `__mul__` 一致命名 + `_backward` closure 实现）|
| **梯度计算正确** | 20% | 梯度错误或缺失 | 公式正确但 backward 闭包错 | relu 梯度（input>0 ? 1 : 0）正确 + backward 闭包链入 |
| **代码简洁性** | 15% | 过度复杂 | 平均 | 简洁清晰，与原 codebase 风格一致（≤ 15 行）|
| **测试覆盖** | 15% | 无测试 | 1-2 个 case | 多 case（正负输入 + 梯度反传）|

## 评分准则

- 你只看 **实现 + 测试**，不看 LLM 思考过程
- 双盲：fixture 含 anonymized tool 名，**不要猜测**或 reveal 工具身份
- 评分基于**绝对质量**，不是相对排名

## micrograd Value `tanh` 的预期签名（参考）

```python
def tanh(self):
    import math
    t = math.tanh(self.data)
    out = Value(t, (self,), 'tanh')
    def _backward():
        self.grad += (1 - t**2) * out.grad
    out._backward = _backward
    return out
```

允许多种合法变体（如用 `(math.exp(2*x) - 1) / (math.exp(2*x) + 1)` 显式公式 + 等价的反向梯度）。评分关注：
- 正向：tanh(x) 数值正确
- 反向：导数 = 1 - tanh(x)² = 1 - out.data² ；用 closure 累加 grad
- 风格：与 `relu()` 等现有 method 一致
