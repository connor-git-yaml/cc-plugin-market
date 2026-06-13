# Phase 0 Hard Gate 结果 — 数据源可行性（T003）

日期：2026-06-14 | 环境：arm64 macOS / Docker Desktop / swebench 4.1.0 / python3.12 venv

## 裁定：✅ 方案 A（本地 JSONL dataset）通过，端到端实跑成功

### 实测证据
- `--dataset_name` 接受**本地 JSON 文件路径**（`--help`: "Name of dataset or path to JSON file"）。
- 真跑 `run_evaluation --dataset_name /tmp/swe-l003-dataset.json --predictions_path <goldPatch 正控> --instance_ids pytest-dev__pytest-11143 --run_id f187_phase0`：
  - **42 秒完成**（test runtime 8.96s），`resolved: 1`（goldPatch 正控 → resolved=true）✓
  - 产出可解析 `report.json` + per-instance `report.json` + `run_instance.log` + `test_output.txt` ✓

### 关键简化发现（影响 FR-001-b / T016）
- swebench 4.1.0 **默认从 dockerhub `swebench` namespace 拉 x86_64 镜像**（`swebench/sweb.eval.x86_64.pytest-dev_1776_pytest-11143:latest`），**Docker Desktop 用 Rosetta 透明运行，42s 含拉取**——**无 QEMU 6.3x 退化**（tech-research 担心的 QEMU 问题不成立，因为 Docker Desktop 默认 Rosetta 而非 QEMU）。
- **结论**：自测无需 Epoch arm64 镜像、无需自定义 `--namespace` / `docker manifest inspect` fallback。`swebench-oracle.mjs`（T016）直接调默认 `run_evaluation` 即可；FR-001-b 的 arm64-first/Rosetta-fallback 简化为"用 harness 默认镜像解析"。`--platform`/Epoch 仅作 F188 大规模时的可选优化。

### W1 不变量（FR-001-f / SC-014）已闭合
10/10 fixture 的 instance 都在官方 SWE-bench Lite test split（300 行）中，且 **failToPass / passToPass / testPatch / goldPatch 与官方逐字段 match**（probe 全 True）。`version` / `environment_setup_commit` 从官方行取得：
| instanceId | version | env_setup |
|---|---|---|
| pytest-dev__pytest-11148/11143 | 8.0 | 10056865 |
| astropy__astropy-14995 | 5.2 | 362f6df1 |
| astropy__astropy-14365/14182 | 5.1 | 5f74eacb |
| sympy__sympy-24909 | 1.13 | be161798 |
| sympy__sympy-24213/24152/24102/24066 | 1.12 | c6cb7c56 |

→ dataset-build（T002）：从官方行取全字段 + 逐字段验证 == fixture.swebenchMeta（不一致告警 fixture），emit 本地 JSON 冻结。

## report.json 结构（T016 解析依据）
- 顶层（`<model>.<run_id>.json`）：`resolved_ids[] / completed_ids[] / error_ids[] / incomplete_ids[] / empty_patch_ids[]` + `schema_version:2`
- per-instance（`logs/run_evaluation/<run_id>/<model>/<instance>/report.json`）：keyed by instanceId → `{patch_successfully_applied, resolved, tests_status:{FAIL_TO_PASS:{success[],failure[]}, PASS_TO_PASS:{success[],failure[]}}}`
  - `details.failToPassExecuted` = FAIL_TO_PASS.success ∪ failure（SC-014 比对）
  - `resolved` = pass 信号；`patch_successfully_applied=false` → patch_apply 阶段失败

## run_instance.log 真实 phase markers（T005 phase-markers.mjs 依据）
| marker 文本（INFO 行）| phaseReached |
|---|---|
| （run_instance.log 首行前 / 文件不存在）| `image`（拉取/构建中）|
| `Creating container for` / `Container for ... created` / `Container for ... started` | `container_start` |
| `now applying to container` / `>>>>> Applied Patch:` / `Applied patch ... cleanly` | `patch_apply` |
| `error: patch ... does not apply` / `patch ... failed` | patch_apply 失败 → error/fixture |
| `Eval script for ... copying to container` / `Test runtime: N seconds` | `test_exec` |
| `Test output for ... written to` / `Grading answer for` / `report: {` | `report_parse` |
| `Result for ...: resolved:` | `done` |
| evidence-based（无 marker 但 test_output 含 pytest `PASSED`/`FAILED`/`OOMKilled`）| `test_exec` |

容器命名：`sweb.eval.<instanceId>.<run_id>`（timeout 清理用 `docker rm -f` by 此名）。
