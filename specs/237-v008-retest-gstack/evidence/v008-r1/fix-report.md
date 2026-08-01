# 问题修复报告

## 问题描述
`Contains.as_set()` 返回的不是集合而是 boolean 对象本身（原始 issue 中表现为返回 `Contains(x, Reals)`）。在当前仓库基线中，`sympy/sets/contains.py` 的 `as_set` 直接 `raise NotImplementedError()`，同样不是正确行为。由于 `Contains` 不是 `Set`，它没有 `as_relational`，导致下游调用失败：

```pytb
>>> Piecewise((6, Contains(x, Reals)), (7, True))
AttributeError: 'Contains' object has no attribute 'as_relational'
```

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 `Piecewise` 等下游会失败？ | 它们调用 `cond.as_set().as_relational(x)`，而 `Contains.as_set()` 未返回 `Set`（返回自身或抛异常） |
| Why 2 | 为何 `Contains.as_set()` 不返回 Set？ | `sympy/sets/contains.py:47-48` 中 `as_set` 实现为 `raise NotImplementedError()`（早期版本则返回自身） |
| Why 3 | 为何未实现该方法？ | `Contains(x, S)` 语义是"x 属于集合 S"这一断言，其对应的解集就是 `S`，但该等价关系当时未被实现 |
| Why 4 | 为何这个等价关系可以直接实现？ | 对于 `Contains(x, S)`，使命题为真的 x 的集合恰为第二个参数 `self.args[1]`（即 `S`），因此 `as_set` 应直接返回 `self.args[1]` | [ROOT CAUSE REACHED at Why 4] |

**Root Cause**: `Contains.as_set()` 未返回其解集 `self.args[1]`，而是抛出 `NotImplementedError`（或历史上返回自身），使得 `Contains` 无法参与任何依赖 `as_set()→as_relational()` 的下游逻辑。

**Root Cause Chain**: Piecewise 报错 → 调用 as_set().as_relational() → as_set 返回非 Set → as_set 未实现解集语义 → 根因：as_set 应返回 self.args[1]

## 影响范围扫描

### 同源问题（需同步修复）
| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| sympy/sets/contains.py | L47-48 | `as_set` 抛 NotImplementedError | 改为 `return self.args[1]` |

### 类似模式（需评估）
| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| sympy/functions/elementary/piecewise.py | L953, L976 | `cond.as_set()` 调用点 | 安全 — 修复后返回的 Set 具备 `as_relational`，无需改动 |

### 同步更新清单
- 调用方: 无需改动（下游依赖修复后的正确返回值即可）
- 测试: 更新 `sympy/sets/tests/test_contains.py::test_as_set`，由断言抛 `NotImplementedError` 改为断言返回对应集合
- 文档: 无需更新

## 修复策略
### 方案 A（推荐）
将 `sympy/sets/contains.py` 中 `Contains.as_set` 的实现由 `raise NotImplementedError()` 改为 `return self.args[1]`。`Contains(x, S)` 的解集在数学上就等于 `S`，即第二个位置参数。同步更新 `test_as_set` 断言。

已通过 monkeypatch 验证：
- `Contains(x, Reals).as_set()` → `Reals`
- `Contains(x, FiniteSet(y)).as_set()` → `{y}`
- `Contains(x, Reals).as_set().as_relational(x)` → `(-oo < x) & (x < oo)`
- `Piecewise((6, Contains(x, Reals)), (7, True))` 不再抛异常

### 方案 B（备选）
在 `Contains` 上直接实现 `as_relational`。缺点：与 sympy 中"boolean 通过 `as_set` 转为 Set 再取 `as_relational`"的既有约定不一致，且不能修复其它依赖 `as_set` 的调用点。不推荐。

## Spec 影响
- 需要更新的 spec: 无（该项目未维护对应 feature spec）
