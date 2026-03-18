"""文件包含语法错误，测试容错解析"""

def valid_function(x: int) -> int:
    return x * 2

class ValidClass:
    def method(self):
        pass

def broken_function(
    # 缺少闭合括号和冒号
