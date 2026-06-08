---
feature: 176
phase: Tasks — Codex 对抗审查记录
date: 2026-06-08
reviewers: Codex (codex-rescue) + Claude (main-thread, grep 取证)
---

# F176 Tasks 阶段对抗审查 — 处置记录

> Codex：3 CRITICAL + 4 WARNING + 1 INFO，全处置。

| 档位 | finding | 处置 |
|------|---------|------|
| 🔴 C-1 | T-A2 未验 Verified oracle 真能跑（fixture 存在 ≠ oracle 可执行）| T-A2 [host] 加 oracle 可执行性 smoke（≥3 task 装依赖跑 runPrimaryOracle），低于阈值不许冻结预注册 |
| 🔴 C-2 | T-B1 spike 输入（wtDir+graph）无前置任务 → 失败无法归因 | **新增 T-A5**：spike-fixture-prep（最小 target + wtDir + spectra graph），T-B1 依赖之 |
| 🔴 C-3 | host-only gate 无可判定交接合同 → implement 易假装 PASS | 顶部 **sandbox/host 交接合同**：拆 [sandbox] 脚本/dry-run/单测 + [host] 真实 artifact（schema 写死）；T-F3 默认拒 synthetic |
| 🟡 W-1 | T-C3 全局翻 stream-json 破坏共享 buildClaudeArgs | grep 证实 4 单测 + 170c/170d 依赖 → T-C3 改**参数化 outputFormat（默认 text）**，F176 传 stream-json + 既有单测回归全绿 |
| 🟡 W-2 | SC-004(c3≥c4) 生产者 T-D5 只算 lift=c3/c1，口径不一致 | T-D5 显式加 `c3_vs_c4` 指标 + CI + 单测 |
| 🟡 W-3 | T-F1 称 FR-C-001..009 但 DoD 只列 C-003..009 | T-F1 DoD 显式断言两报告文件存在（FR-C-001/002）|
| 🟡 W-4 | T-A1 grep DoD 太弱（注释也满足）| 改文件级具名 import 断言 + 硬编码路径负向扫描 + 路径单测 |
| ℹ️ I-1 | FR-D-* traceability 不可见（codex 未读 spec）| T-F1 显式 FR-D 四维度 dogfooding 节 + mapping 表补 FR-D 行 |

## Claude 自审（grep 取证，与 W-1 一致并加强）
- `buildClaudeArgs` 被 `eval-task-runner` / `eval-mcp-augmented` / `feature-170c` / `feature-170d` / `sub-agent-meta` 使用，且 `tests/unit/{eval-task-runner,eval-mcp-augmented-prompt,eval-mcp-classic-cohort,feature-170d-harness}.test.ts` 断言其行为 → 全局翻转必破回归。结论：参数化是唯一非破坏方案。

## 三阶段 review 累计（供报告 FR-C-007 两模型分类）
- spec：4 CRITICAL（含 Claude 独有 oracle/jury）；plan：2 CRITICAL（spike gate / fallback 死锁）；tasks：3 CRITICAL（oracle 实跑 / spike 输入 / host 交接合同）。
- 重叠高置信项（两模型同指）贯穿三阶段：版本门禁可证伪、falsification 防规避、token 来源、回归隔离。独有补盲：Claude 偏实现取证（model/stream-json/共享函数回归），Codex 偏验收死锁与交接合同。
