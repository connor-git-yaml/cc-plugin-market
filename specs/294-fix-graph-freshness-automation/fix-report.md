# F294 问题修复报告 — 簇⑦ 图新鲜度自动化（M11 卡 D）

**模式**: fix（M11 §9.4；`/goal` 授权下主线程直接实现，TDD + 两轮异构对抗 + delta 轮）
**日期**: 2026-09-15
**审查档位**: Codex 审查暂停，异构档位缺席 → 内部异构对抗复审 ×2 + delta ×1（路径命中仓根 `scripts/**` / 图质量门 ⇒ 门禁类档位）

## 问题描述

图新鲜度判定只看 `sourceCommit` 与工作树脏文件：脏树上建的图含未提交内容却盖着 HEAD 的章，改动丢弃后三维 provenance 都看不出图里残留着
任何 commit 都不存在的节点；已提交但未重建的采集面改动（committed diff）不进判定面；`repo:sync` 没有自动重建步骤，dogfooding 长期跑着陈旧图。

## 5-Why 根因

| Why | 结论 |
|---|---|
| 1 | freshness 只比 HEAD 与脏文件，不比「建图时树是否干净」 |
| 2 | 图元数据没有 `sourceTreeDirty`，判定器无从知道 |
| 3 | committed 变更差分未接入（`git diff --name-only <recorded>..HEAD` 未做） |
| 4 | `repo:sync` 无 graph-freshness 步骤，重建全靠人 |
| **Root Cause** | **图 provenance 缺「建图时点树态」与「已提交差分」两维，且无自动收敛步骤** |

## 修复策略

- `src/panoramic/graph/source-commit.ts`：`isSourceTreeDirty`（porcelain 读失败按 true）；`getCommittedSourceChanges` 钉 `-c diff.renames=false -c diff.relative=false` + `--end-of-options` + `isCommitSha`（40/64 hex）校验；判定面 = `DIRTY_SOURCE_SURFACES ∪ .gitignore`；新 stale 原因 `source-tree-dirty-at-build`；verdict 恒带 `dirtyFiles`（测得干净为 `[]`）、`builtFromDirtyTree`。
- graph 元数据 `sourceTreeDirty: boolean | null`（AST 重建链路写实测值，`spectra graph` 写 `null`）。
- `graph-quality` CLI / MCP honesty / `graph-quality-core` / schema：新原因文案、`committedSourceChanges`（CLI ≤5 / core ≤20 / MCP 截断计数）、`builtFromDirtyTree` 下一步提示；无图 / JSON 坏 / schema 坏分支也带真实 freshness。
- `scripts/lib/repo-maintenance-core.mjs`：`syncGraphFreshness` 白名单决策（skip-no-dist / skip-stale-dist / skip-probe-failed / skip-dirty / rebuild / skip-no-git / skip-unrecognized-freshness / noop），探针读完整 `graph-quality --json`、`gitAvailable` 自查、`graphUnusable`；重建 `spawnSync` 超时 + SIGKILL（`SPECTRA_GRAPH_REBUILD_TIMEOUT_MS` / `SPECTRA_GRAPH_PROBE_TIMEOUT_MS`）；收敛守卫（重建后仍非 fresh ⇒ error）；`stepStatusFor` 让 warn 步不冒充 pass。
- `docs/shared/agent-repo-maintenance.md` 一条（同步进 CLAUDE.md / AGENTS.md）。

## 对抗审查（两轮 + delta）与处置

| 发现 | 处置 |
|---|---|
| json-parse-error / schema-* 被判 `skip-no-git`（假归因） | 探针自查 git + `graphUnusable` 原因集 |
| `sourceTreeDirty:true` 在树仍脏时被藏起 | verdict 加 `builtFromDirtyTree` |
| 探针 `indexOf('{')` 切片 | 纯 JSON 解析 |
| 无图 + 脏树时在脏树上重建 | `treeDirty` 闸门先于无图分支；无图分支带真实 freshness |
| cannot-assess 重建不收敛 | 通用收敛守卫 |
| `diff.relative` 未钉 / `--end-of-options` / SHA 边界 / 写侧 porcelain 失败 | 全部钉测 |

**残余（记录）**：`.git/info/exclude` / 全局 excludesFile 不在判定面；建图前脏态采样与建图之间有窗口；`spawnSync` 超时不覆盖进程组；`repo:sync` 对 warn 步仍 exit 0。

## 活体验证（scratch clone）

脏树 ⇒ `skip-dirty`；脏树上建的图标 `builtFromDirtyTree`；丢弃改动后自愈重建；纯文档改动 ⇒ fresh；采集面文件改名出图 ⇒ stale ⇒ rebuild。
本仓 `repo:sync` 实跑：`graph-freshness → action=skip-dirty before=dirty`（本批工作树脏，符合预期）。

## 测试

`src/panoramic/graph/source-commit.test.ts`（M11-D + 回补 + delta 回补）、`tests/unit/repo-sync-graph-freshness.test.ts`（28 例，含真 seam 假 dist 与超时）、
`tests/helpers/freshness-stale-scenarios.ts`（5 原因）、`tests/unit/contracts/graph-quality-report-schema.test.ts`——freshness 相关 582 vitest + 171 plugin 例全绿；每处修复有变异体检查。
