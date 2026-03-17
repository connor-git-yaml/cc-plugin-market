"""测试 __all__ 列表导出控制"""

__all__ = ["PublicClass", "public_func"]


class PublicClass:
    pass


class InternalClass:
    pass


def public_func() -> None:
    pass


def _helper() -> None:
    pass
