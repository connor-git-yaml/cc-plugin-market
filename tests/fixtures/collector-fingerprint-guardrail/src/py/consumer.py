# #2 pyWalk 独占覆盖样本（F259）：与 producer.py 构成真实 py→py 依赖（单点相对 import）。
from .producer import make


def use() -> int:
    return make()
