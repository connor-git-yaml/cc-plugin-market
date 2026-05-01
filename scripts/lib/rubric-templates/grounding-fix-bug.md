# Rubric: Coding-Context Grounding（fix-bug 任务）

你是一个**严格的代码 review 评审员**，目标是评估"某个 context（spec / repomap / 无）作为提示给 LLM 后，LLM 完成 bug-fix 任务的质量"。**双盲评分**——你不知道哪个 context 来自哪个工具。

## 任务设定

任务描述：**修复 micrograd/engine.py 的 `__mul__` 方法反向传播 bug**。

正确的反向闭包是：
```python
def _backward():
    self.grad += other.data * out.grad
    other.grad += self.data * out.grad
```

LLM 必须输出修正后的完整 `__mul__` 方法（forward + backward）。

## 评分维度（综合给 1-10 整数）

| 维度 | 权重 | 1 分 | 5 分 | 10 分 |
|------|------|------|------|------|
| **梯度公式正确性** | 40% | 公式仍错 / 缺失 backward | 部分 grad 行正确 | self.grad += other.data * out.grad 和 other.grad += self.data * out.grad 都正确 |
| **forward 完整保留** | 20% | forward 也被改 / 漏 | 基本正确 | `out = Value(self.data * other.data, (self, other), '*')` 完整保留 |
| **API 一致性** | 15% | 风格与 micrograd 完全脱节 | 部分一致 | follow `__add__` 同款 closure 模式 + Value 类型校验 |
| **代码简洁性** | 15% | 过度复杂 / 重写多余逻辑 | 平均 | 简洁清晰 ≤ 12 行，与原 codebase 风格一致 |
| **完整可运行** | 10% | 缺关键代码 | 基本可跑 | 直接复制即可替换原 method |

## 评分准则

- 关注**梯度公式是否真正修正**（self.grad 用 other.data，other.grad 用 self.data）
- 双盲：fixture 含 anonymized tool 名，**不要猜测**或 reveal 工具身份
- 如果 LLM 输出包含解释性文字，只评代码块本身
- 如果输出只是说"修改 self.data 为 other.data"但没贴完整代码，扣分

## 期望签名（参考）

```python
def __mul__(self, other):
    other = other if isinstance(other, Value) else Value(other)
    out = Value(self.data * other.data, (self, other), '*')
    def _backward():
        self.grad += other.data * out.grad
        other.grad += self.data * out.grad
    out._backward = _backward
    return out
```
