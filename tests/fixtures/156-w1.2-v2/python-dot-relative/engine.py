"""micrograd 风格的 engine 模块（仅供 fixture 使用）"""


class Value:
    """简化版 Value，标量计算单元"""

    def __init__(self, data: float) -> None:
        self.data = data
