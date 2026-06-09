#!/usr/bin/env python3
"""Feature 158 T-020 — SWE-Bench Lite fixture import 脚本。

把 HuggingFace `princeton-nlp/SWE-bench_Lite` test split 过滤为 ≥5 个
高质量 fixture，写到 tests/baseline/swe-bench-lite/fixtures/ 目录下。

每个 task 同时产出：
  - SWE-L00X-<repo>-<short>.json  fixture 元数据
  - SWE-L00X-<repo>-<short>.goldpatch.diff  goldPatch 单独成文件（FR-D-002 退化 oracle 引用）

退化策略（CON-2 / spec FR-A-003）：
  --min-date 候选 ≥ 5 → 用 min-date 上限；
  否则降级到 --fallback-min-date；
  仍 < 5 → 进一步退到数据集天然最大日期（SWE-Bench Lite 本身上限 ~2023-06），
  同时写 _DEGRADATION_NOTE.md 记录降级原因 + 训练集泄漏增量风险评估。

用法：
  python3 scripts/swe-bench-fixture-import.py \\
      --repos sympy/sympy,astropy/astropy,pytest-dev/pytest \\
      --min-date 2024-01-01 --fallback-min-date 2023-07-01 \\
      --max-patch-files 3 --limit 10 \\
      --output-dir tests/baseline/swe-bench-lite/fixtures/
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable

# ─── 解析参数 ─────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Import SWE-Bench Lite fixtures (Feature 158 T-020)"
    )
    p.add_argument("--output-dir", required=True, help="fixture 输出目录")
    p.add_argument(
        "--repos",
        required=True,
        help="逗号分隔的 owner/repo 列表，例如 sympy/sympy,astropy/astropy,pytest-dev/pytest",
    )
    p.add_argument(
        "--min-date",
        default="2024-01-01",
        help="ISO 日期；issue createdAt ≥ 此日期方入选（默认 2024-01-01）",
    )
    p.add_argument(
        "--fallback-min-date",
        default="2023-07-01",
        help="若 --min-date 后候选数 < min-fixtures，降级到此日期（默认 2023-07-01）",
    )
    p.add_argument(
        "--max-patch-files",
        type=int,
        default=3,
        help="goldPatch 改动文件数上限（默认 3）",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=10,
        help="最多产出 fixture 数（默认 10）",
    )
    p.add_argument(
        "--min-fixtures",
        type=int,
        default=5,
        help="最少 fixture 数；不足时触发日期降级（默认 5）",
    )
    # Feature 176：参数化数据集，默认值与原 Lite 行为完全一致（不传新参 = Lite 不变）
    p.add_argument(
        "--dataset",
        default="princeton-nlp/SWE-bench_Lite",
        help="HuggingFace 数据集 id（默认 Lite；Verified 传 princeton-nlp/SWE-bench_Verified）",
    )
    p.add_argument(
        "--task-prefix",
        default="SWE-L",
        help="task id 前缀（默认 SWE-L；Verified 用 SWE-V）",
    )
    p.add_argument(
        "--dataset-tag",
        default="lite",
        help="fixture.swebenchMeta.dataset 标签（默认 lite；Verified 用 verified）",
    )
    p.add_argument(
        "--fixtures-subdir",
        default="swe-bench-lite",
        help="goldpatch 引用路径子目录（默认 swe-bench-lite；Verified 用 swe-bench-verified）",
    )
    return p.parse_args()


# ─── 工具函数 ────────────────────────────────────────────────


def parse_iso(s: str) -> dt.datetime:
    """容错解析 ISO 8601 日期/时间戳。"""
    if "T" not in s:
        s += "T00:00:00+00:00"
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def count_patch_files(patch: str) -> int:
    """统计 unified diff 中 `--- a/<file>` 行数。"""
    return sum(1 for line in patch.splitlines() if line.startswith("--- a/"))


def short_desc_from_problem(problem: str, max_len: int = 30) -> str:
    """从 problem_statement 提炼简短英文描述（用于 taskId 后缀）。"""
    first_line = problem.strip().splitlines()[0] if problem.strip() else "fix"
    # 去 markdown / 标点 / 取前 4 个英文 token
    cleaned = re.sub(r"[^a-zA-Z0-9 ]+", " ", first_line)
    tokens = [t.lower() for t in cleaned.split() if len(t) >= 2][:4]
    if not tokens:
        return "fix"
    return "-".join(tokens)[:max_len].rstrip("-")


def repo_stem(repo: str) -> str:
    """owner/repo → repo（最后一段）。"""
    return repo.split("/")[-1]


def normalize_ftp(value) -> list[str]:
    """SWE-Bench 中 FAIL_TO_PASS / PASS_TO_PASS 可能是 JSON 字符串或列表。"""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    return []


# ─── 候选筛选与降级 ─────────────────────────────────────────


def filter_candidates(
    dataset: Iterable[dict],
    target_repos: set[str],
    max_patch_files: int,
) -> list[dict]:
    """基础过滤：repo + patch 改文件数 + FAIL_TO_PASS ≥ 1。"""
    cands = []
    for row in dataset:
        if row["repo"] not in target_repos:
            continue
        if count_patch_files(row["patch"]) > max_patch_files:
            continue
        ftp = normalize_ftp(row["FAIL_TO_PASS"])
        if len(ftp) < 1:
            continue
        cands.append(row)
    return cands


def apply_date_filter(cands: list[dict], cutoff: dt.datetime) -> list[dict]:
    out = []
    for r in cands:
        try:
            created = parse_iso(r["created_at"])
        except Exception:
            continue
        if created >= cutoff:
            out.append(r)
    return out


def select_with_degradation(
    cands: list[dict],
    min_date: str,
    fallback_min_date: str,
    min_fixtures: int,
) -> tuple[list[dict], dict]:
    """三阶段降级：min-date → fallback-min-date → 数据集天然最大日期。

    返回 (selected_rows, degradation_info)
    """
    info: dict = {"degraded": False, "reason": None, "appliedThreshold": min_date}

    cutoff_strict = parse_iso(min_date)
    selected = apply_date_filter(cands, cutoff_strict)
    if len(selected) >= min_fixtures:
        return selected, info

    # 第一次降级
    info["degraded"] = True
    info["reason"] = (
        f"strict-threshold-{min_date}-yielded-{len(selected)}-below-min-{min_fixtures}"
    )
    cutoff_fb = parse_iso(fallback_min_date)
    info["appliedThreshold"] = fallback_min_date
    selected = apply_date_filter(cands, cutoff_fb)
    if len(selected) >= min_fixtures:
        return selected, info

    # 第二次降级：取最新 N 个（数据集天然上限）
    info["reason"] = (
        f"fallback-{fallback_min_date}-yielded-{len(selected)}-below-min-{min_fixtures}; "
        "further-degraded-to-dataset-max-date"
    )
    sorted_all = sorted(
        cands,
        key=lambda r: parse_iso(r["created_at"]),
        reverse=True,
    )
    selected = sorted_all
    if selected:
        # appliedThreshold = 数据集天然最大 created_at 日期（最新候选）
        info["appliedThreshold"] = sorted_all[0]["created_at"][:10] + "-dataset-max"
    return selected, info


# ─── Fixture 构造 ───────────────────────────────────────────


def build_fixture(
    row: dict,
    seq: int,
    fixtures_dir: Path,
    degraded: bool,
    degradation_reason: str | None,
    task_prefix: str = "SWE-L",
    dataset_tag: str = "lite",
    fixtures_subdir: str = "swe-bench-lite",
    dataset_id: str = "princeton-nlp/SWE-bench_Lite",
) -> dict:
    """构造 fixture JSON 对象（不写盘，由调用方写）。"""
    repo = row["repo"]
    repo_st = repo_stem(repo)
    short = short_desc_from_problem(row["problem_statement"])
    task_id = f"{task_prefix}{seq:03d}-{repo_st}-{short}"

    ftp = normalize_ftp(row["FAIL_TO_PASS"])
    ptp = normalize_ftp(row["PASS_TO_PASS"])

    # oracle.checks[] 用 string 数组（修 Codex C2: runner ast-diff 分支契约只接受 string）
    # <SPECTRA_REPO_ROOT> 占位符由 eval-mcp-augmented.mjs 在 runPrimaryOracle 前替换为绝对路径
    # （修 Codex C1: oracle 在 worktree cwd 执行，相对路径找不到 cc-plugin-market 仓库）
    fuzzy_cmd = (
        f"git diff HEAD > /tmp/{task_id}.actual.diff && "
        f'node "<SPECTRA_REPO_ROOT>/scripts/eval-diff-fuzzy-match.mjs" '
        f'--expected "<SPECTRA_REPO_ROOT>/tests/baseline/{fixtures_subdir}/fixtures/{task_id}.goldpatch.diff" '
        f"--actual /tmp/{task_id}.actual.diff "
        f"--threshold 60 ; rc=$? ; rm -f /tmp/{task_id}.actual.diff ; exit $rc"
    )

    fixture = {
        "taskId": task_id,
        "description": (row["problem_statement"] or "")[:200].strip(),
        "target": repo,
        "startCommit": row["base_commit"],
        "prompt": row["problem_statement"] or "",
        "primaryOracle": {
            "kind": "ast-diff",
            "checks": [fuzzy_cmd],
        },
        "swebenchMeta": {
            "instanceId": row["instance_id"],
            "dataset": dataset_tag,
            "createdAt": row["created_at"],
            "mergedAt": None,
            "failToPass": ftp,
            "passToPass": ptp,
            "goldPatch": row["patch"],
            "testPatch": row["test_patch"],
            "dateThresholdDegraded": (
                degradation_reason if degraded else False
            ),
        },
        "status": "active",
        # Lite 默认保持与原版字面值完全一致（byte-for-byte，codex WARNING）；非默认才参数化
        "notes": (
            "imported from princeton-nlp/SWE-bench_Lite via T-020"
            if dataset_id == "princeton-nlp/SWE-bench_Lite"
            else f"imported from {dataset_id}"
        ),
    }
    return fixture


def write_fixture(fixture: dict, fixtures_dir: Path) -> tuple[Path, Path]:
    json_path = fixtures_dir / f"{fixture['taskId']}.json"
    diff_path = fixtures_dir / f"{fixture['taskId']}.goldpatch.diff"
    json_path.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")
    diff_path.write_text(fixture["swebenchMeta"]["goldPatch"])
    return json_path, diff_path


def write_degradation_note(
    fixtures_dir: Path,
    info: dict,
    repos: list[str],
    min_date: str,
    fallback_min_date: str,
    min_fixtures: int,
    selected_count: int,
    dataset_id: str = "princeton-nlp/SWE-bench_Lite",
) -> Path:
    # Feature 176：按数据集分支，避免 Verified 导入时生成 Lite 语义的错误审计文本
    is_lite = dataset_id == "princeton-nlp/SWE-bench_Lite"
    dataset_label = "SWE-Bench Lite" if is_lite else "SWE-Bench Verified"
    ceiling_note = (
        "但 SWE-Bench Lite 数据集本身\n最新 issue 的 `created_at` 上限不超过 ~2023-06（数据集发布时间限制）。"
        if is_lite
        else "Verified 子集的 `created_at` 分布可能不足以满足该日期阈值（按数据集实际分布而定）。"
    )
    lite_mitigation = (
        "- 升级 SWE-Bench dataset 至 SWE-Bench Verified（待 dataset 发布）\n- 自建 fixture：从 sympy/astropy 2024 后 PR 中手挑"
        if is_lite
        else "- 放宽/调整 repo 选择以获取足量可解 task\n- 自建 fixture：从目标 repo 的更晚 PR 中手挑\n- 若仍不足，缩小 task 数并在报告显著性章节标注"
    )
    note = fixtures_dir / "_DEGRADATION_NOTE.md"
    body = f"""# {dataset_label} Fixture Import — 降级记录

## 概要

fixture 导入触发日期阈值降级。要求所有 fixture
`createdAt` ≥ `{min_date}`（fallback `{fallback_min_date}`），{ceiling_note}

## 降级路径

- 严格阈值：`{min_date}` → 候选数不足 {min_fixtures}
- 退化阈值：`{fallback_min_date}` → 候选数仍不足
- **最终采用**：放弃日期阈值，按 `created_at` 降序取最新 {selected_count} 个候选

## 实际 appliedThreshold

`{info.get('appliedThreshold')}`

## 降级原因

`{info.get('reason')}`

## 训练集泄漏风险增量评估

模型（截至训练集 cutoff）可能覆盖较早的 commit diff。本批 fixture 在低于目标日期阈值时
不能用于"clean held-out"的统计声明；结论 audit 中需明确：

1. bare baseline 的 pass rate **可能虚高**（因模型可能记忆 goldPatch）
2. Grounding lift（差值）仍有信号意义：若 grounding cohort 提升显著，至少说明在记忆基础上
   仍能贡献 incremental signal
3. 真正的 leakage-free 验证需要更晚日期的数据或自建 fixture（2026 业界共识：见报告 leakage 背景段）

## 选定 repo 范围

{', '.join(repos)}

## 后续 mitigation

{lite_mitigation}

> 本文件由 `scripts/swe-bench-fixture-import.py` 在触发降级时自动生成。
"""
    note.write_text(body)
    return note


# ─── 主流程 ────────────────────────────────────────────────


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    target_repos = set(r.strip() for r in args.repos.split(",") if r.strip())

    print(f"[info] Loading {args.dataset} (split=test)...", file=sys.stderr)
    try:
        from datasets import load_dataset  # type: ignore
    except ImportError:
        print(
            "[error] datasets 库不可用。请 venv 后跑 pip install datasets",
            file=sys.stderr,
        )
        return 2

    ds = load_dataset(args.dataset, split="test")
    print(f"[info] dataset size: {len(ds)}", file=sys.stderr)

    cands = filter_candidates(ds, target_repos, args.max_patch_files)
    print(
        f"[info] base filtered candidates (repo+patch+ftp): {len(cands)}",
        file=sys.stderr,
    )

    selected, info = select_with_degradation(
        cands, args.min_date, args.fallback_min_date, args.min_fixtures
    )

    # 限制总数 + 按 created_at 降序保证选最新
    selected_sorted = sorted(
        selected, key=lambda r: parse_iso(r["created_at"]), reverse=True
    )[: args.limit]

    if len(selected_sorted) < args.min_fixtures:
        print(
            f"[warn] selected {len(selected_sorted)} < min-fixtures {args.min_fixtures}, "
            "继续写出但 verify 可能不通过",
            file=sys.stderr,
        )

    print(
        f"[info] selected {len(selected_sorted)} fixtures; degraded={info['degraded']}; "
        f"appliedThreshold={info['appliedThreshold']}",
        file=sys.stderr,
    )

    # 跨 repo 序号去重 — 简单按枚举顺序赋 1..N
    written = []
    for idx, row in enumerate(selected_sorted, start=1):
        fixture = build_fixture(
            row,
            seq=idx,
            fixtures_dir=output_dir,
            degraded=info["degraded"],
            degradation_reason=info["reason"] if info["degraded"] else None,
            task_prefix=args.task_prefix,
            dataset_tag=args.dataset_tag,
            fixtures_subdir=args.fixtures_subdir,
            dataset_id=args.dataset,
        )
        json_path, diff_path = write_fixture(fixture, output_dir)
        written.append((fixture["taskId"], json_path, diff_path))
        print(
            f"[wrote] {fixture['taskId']} (createdAt={row['created_at']}, repo={row['repo']})",
            file=sys.stderr,
        )

    if info["degraded"]:
        note_path = write_degradation_note(
            output_dir,
            info,
            sorted(target_repos),
            args.min_date,
            args.fallback_min_date,
            args.min_fixtures,
            len(written),
            dataset_id=args.dataset,
        )
        print(f"[wrote] degradation note: {note_path}", file=sys.stderr)

    # stdout 输出 summary JSON 便于上层脚本解析
    summary = {
        "totalFixtures": len(written),
        "degraded": info["degraded"],
        "appliedThreshold": info["appliedThreshold"],
        "reason": info["reason"],
        "fixtures": [
            {"taskId": tid, "json": str(jp.name), "diff": str(dp.name)}
            for tid, jp, dp in written
        ],
    }
    print(json.dumps(summary, indent=2))
    return 0 if len(written) >= args.min_fixtures else 1


if __name__ == "__main__":
    sys.exit(main())
