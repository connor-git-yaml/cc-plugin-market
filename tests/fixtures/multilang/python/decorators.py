"""测试装饰器解析"""

class Service:
    """服务类，包含各种装饰器方法"""

    @staticmethod
    def create() -> "Service":
        return Service()

    @classmethod
    def from_config(cls, config: dict) -> "Service":
        return cls()

    @property
    def name(self) -> str:
        return "service"

    @name.setter
    def name(self, value: str) -> None:
        self._name = value

    def process(self, data: bytes) -> bytes:
        return data
