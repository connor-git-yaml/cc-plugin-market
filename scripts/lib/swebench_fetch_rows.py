#!/usr/bin/env python3
"""F187：从官方 SWE-bench Lite dataset 按 instance_id 取完整行（含 version /
environment_setup_commit，fixture.swebenchMeta 缺这两个字段）。

输出：stdout 打印匹配行的 JSON 数组。仅取元数据用途，datasets 首次下载后本地缓存。
用法：python swebench_fetch_rows.py <dataset_name> <instance_id> [<instance_id> ...]
"""
import json
import sys

from datasets import load_dataset


def main(argv):
    if len(argv) < 3:
        print("usage: swebench_fetch_rows.py <dataset_name> <instance_id>...", file=sys.stderr)
        return 2
    dataset_name = argv[1]
    wanted = set(argv[2:])
    ds = load_dataset(dataset_name, split="test")
    by_id = {r["instance_id"]: r for r in ds if r["instance_id"] in wanted}
    missing = wanted - set(by_id)
    if missing:
        print(f"instance_id 不在 {dataset_name}: {sorted(missing)}", file=sys.stderr)
        return 1
    # 仅输出 harness 与校验所需字段，避免巨大无关列
    out = []
    for iid in argv[2:]:
        r = by_id[iid]
        out.append({
            "instance_id": r["instance_id"],
            "repo": r["repo"],
            "base_commit": r["base_commit"],
            "patch": r["patch"],
            "test_patch": r["test_patch"],
            "problem_statement": r.get("problem_statement", ""),
            "hints_text": r.get("hints_text", ""),
            "version": r.get("version"),
            "environment_setup_commit": r.get("environment_setup_commit"),
            "FAIL_TO_PASS": r["FAIL_TO_PASS"],
            "PASS_TO_PASS": r["PASS_TO_PASS"],
        })
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
