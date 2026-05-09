# Feature 158 Verification Report

- **Generated**: 2026-05-09T15:49:37.433Z
- **Status**: PASS

## Checks

| # | Step | Status | Detail |
| --- | --- | --- | --- |
| 1 | check-1-fixture-count | ✅ | `{"count":10,"threshold":5}` |
| 2 | check-2-fixture-schema | ✅ | `{"filesChecked":10,"issueCount":0,"sampleIssues":[]}` |
| 3 | check-3-dry-run | ✅ | `{"exitCode":0,"stderr":""}` |
| 4 | check-4-telemetry-env | ✅ | `{"groupCExitCode":0,"foundEnvMarker":true,"stdoutSample":"[dry-run] group=C tasks=1 repeat=3 total-runs=3\n[dry-run] estimated cost=$0.75 (assume $0.25/run)\n[dry-run] stop-loss=$40 max-judge-calls=20` |
| 5 | check-5-147-subsections | ✅ | `{"results":[{"pattern":"###\\s+10\\.1\\s+实验设计","matched":true},{"pattern":"###\\s+10\\.2\\s+Pass\\s+Rate\\s+矩阵","matched":true},{"pattern":"###\\s+10\\.3\\s+Token\\s+Cost","matched":true},{"pattern":"` |
| 6 | check-6-147-cross-link | ✅ | `{"expectedLink":"../158-swe-bench-lite-grounding-eval/impl-supplement/competitive-evaluation-report.md"}` |

## Out of Verify Scope

以下 SC 不在本脚本验收范围（需要 post-eval 人工 / 实测确认）：

- **SC-004** — ≥45 runs（post-eval 人工确认 runs/ 目录文件数，T-061 之后）
- **SC-005** — 147 §10 实质内容质量（T-063 spec-review 阶段确认）
- **SC-006** — Token Cost 数值合理性（T-062 数据填入后人工核对）
- **SC-009b** — telemetry JSONL 端到端写入（T-060 pilot 完成后实测确认）
