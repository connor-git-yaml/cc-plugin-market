"""main 模块，演示三种 dot-relative import 形态（CRIT-4 v2 测试 fixture）"""

# (1) 纯点号 + namedImports：`from . import engine`
from . import engine

# (2) 双点号 namedImports：`from . import nn` —— 解析到子包 __init__.py
from . import nn

# (3) 带模块名相对：`from .nn.module import Module`
from .nn.module import Module

# (4) 多 named import：`from . import engine, utils`
from . import engine as eng_alias  # noqa: F401  fixture 用


def main() -> None:
    v = engine.Value(1.0)
    m = Module()
    print(v.data, m.parameters())
    nn.__name__  # 仅消费 namespace 避免 lint
