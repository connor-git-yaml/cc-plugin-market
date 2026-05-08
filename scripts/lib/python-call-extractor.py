#!/usr/bin/env python3
"""
F147 Sprint 3 Phase B.1 — Python source AST extractor

输入：source code root dir
输出：JSON {imports: [...], calls: [...]} 用于 graph-accuracy.mjs 比对

- imports: 形如 "fileA.py -> moduleX" 的有向 import 关系
- calls: 形如 "fileA.py:funcA -> funcB" 的有向 call 关系（按 caller_file + callee_name 去重）

零 LLM cost、纯静态分析，使用 stdlib ast。
"""

import ast
import json
import os
import sys

# 二元运算符 → Python dunder 名（用于 micrograd 类 operator-overload-heavy 项目）
BINOP_DUNDER = {
    ast.Add: "__add__",
    ast.Sub: "__sub__",
    ast.Mult: "__mul__",
    ast.Div: "__truediv__",
    ast.FloorDiv: "__floordiv__",
    ast.Mod: "__mod__",
    ast.Pow: "__pow__",
    ast.LShift: "__lshift__",
    ast.RShift: "__rshift__",
    ast.BitOr: "__or__",
    ast.BitXor: "__xor__",
    ast.BitAnd: "__and__",
    ast.MatMult: "__matmul__",
}
UNARYOP_DUNDER = {
    ast.UAdd: "__pos__",
    ast.USub: "__neg__",
    ast.Invert: "__invert__",
}


def extract_from_file(filepath, root):
    """返回 (imports_set, calls_set) for one file."""
    rel = os.path.relpath(filepath, root)
    imports = set()
    calls = set()

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=filepath)
    except (SyntaxError, UnicodeDecodeError):
        return imports, calls

    for node in ast.walk(tree):
        # Imports: import X / from X import Y
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(f"{rel}::{alias.name.split('.')[0]}")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            imports.add(f"{rel}::{mod.split('.')[0]}")

        # Calls: func() / obj.method()
        elif isinstance(node, ast.Call):
            callee = None
            if isinstance(node.func, ast.Name):
                callee = node.func.id
            elif isinstance(node.func, ast.Attribute):
                callee = node.func.attr
            if callee:
                calls.add(f"{rel}::{callee}")

        # Operator overload triggers dunder calls implicitly: a+b → __add__
        elif isinstance(node, ast.BinOp):
            dunder = BINOP_DUNDER.get(type(node.op))
            if dunder:
                calls.add(f"{rel}::{dunder}")
        elif isinstance(node, ast.UnaryOp):
            dunder = UNARYOP_DUNDER.get(type(node.op))
            if dunder:
                calls.add(f"{rel}::{dunder}")

    return imports, calls


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: python-call-extractor.py <root> [--exclude pattern1,pattern2]"}))
        sys.exit(1)

    root = sys.argv[1]
    excludes = set()
    if "--exclude" in sys.argv:
        i = sys.argv.index("--exclude")
        if i + 1 < len(sys.argv):
            excludes = set(sys.argv[i + 1].split(","))

    all_imports = set()
    all_calls = set()
    file_count = 0
    skipped = []

    for dirpath, dirnames, filenames in os.walk(root):
        # 排除 venv/构建目录；保留 test/tests 以便与 graphify 包含 test 边的范围对称
        dirnames[:] = [d for d in dirnames if d not in {".venv", "venv", "__pycache__", ".git", "node_modules", "build", "dist"} and not d.startswith(".") and d not in excludes]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            fp = os.path.join(dirpath, fn)
            try:
                imps, cls = extract_from_file(fp, root)
                all_imports |= imps
                all_calls |= cls
                file_count += 1
            except Exception as e:
                skipped.append({"file": os.path.relpath(fp, root), "reason": str(e)})

    # Feature 151 SC-001 fill-rate 分母：含至少一次 callable 调用的 .py 文件数
    # 派生自 all_calls set（"file::callee" 形式），取唯一 file 部分计数
    files_with_calls = len({x.split("::", 1)[0] for x in all_calls})

    print(json.dumps({
        "root": root,
        "fileCount": file_count,
        "filesWithCalls": files_with_calls,
        "imports": sorted(all_imports),
        "calls": sorted(all_calls),
        "uniqueImportTargets": len({x.split("::", 1)[1] for x in all_imports}),
        "uniqueCallTargets": len({x.split("::", 1)[1] for x in all_calls}),
        "skipped": skipped,
    }, indent=2))


if __name__ == "__main__":
    main()
