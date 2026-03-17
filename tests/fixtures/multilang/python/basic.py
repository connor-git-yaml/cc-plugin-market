"""基本 Python 模块，包含函数、类、import、类型注解"""

import os
import sys
from pathlib import Path
from typing import List, Optional, Dict

from .utils import helper_func


def greet(name: str) -> str:
    """问候函数"""
    return f"Hello, {name}"


async def fetch_data(url: str, timeout: int = 30) -> dict:
    """异步获取数据"""
    pass


class User:
    """用户类"""

    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age

    def get_display_name(self) -> str:
        return f"{self.name} ({self.age})"

    @staticmethod
    def from_dict(data: dict) -> "User":
        return User(data["name"], data["age"])


class AdminUser(User):
    """管理员用户"""

    role: str = "admin"

    def has_permission(self, perm: str) -> bool:
        return True


PI: float = 3.14159
MAX_RETRIES: int = 3


def _private_helper() -> None:
    """私有辅助函数"""
    pass
