# Feature 193 验证报告 — worktree graph 开箱可用 + 增量保活

**日期**: 2026-06-13 | **模式**: spec-driver-story | **范围**: 全量（含快照可移植，用户裁决）

## 验收标准达成（SC-001 ~ SC-007）

| SC | 标准 | 状态 | 证据 |
|----|------|------|------|
| SC-001 | 新 worktree bootstrap 后 impact/context 即可用，无需 batch | ✅ | bootstrap 钩子 live 验证（copy 主仓图 + sidecar）；17 工具 E2E 在相对图上零回归 |
| SC-002 | 同 commit 跨 worktree graph + 快照 byte 一致（相对 POSIX，排除时间戳+external） | ✅ | `cross-worktree-byte.test.ts`（两不同深度 root byte-identical）+ `snapshot-portability.test.ts`（快照跨 worktree byte 一致） |
| SC-003 | 17 工具新相对 id 零回归 + 逐工具矩阵 | ✅ | F180 44 E2E 全绿；`mcp-tools-canonicalize-matrix.md` |
| SC-004 | bootstrap（含快照）后改一文件 commit 走增量（非 full） | ✅ | `snapshot-portability.test.ts` 增量保活往返（fallbackToFull=false，新 symbol 可查） |
| SC-005 | code-only 27min profiling 根因报告 | ✅ | `perf-profiling-report.md`（LLM-bound 根因，fix 分流 post-F182） |
| SC-006 | Codex 阶段性对抗审查 critical 全修 | ✅ | 见下 |
| SC-007 | 4157+ vitest + build + repo:check 全绿 | ✅ | 4297+ passed / 0 failed；build/repo:check pass |

## Codex 对抗审查汇总（5 轮）

| 阶段 | 结论 | 处置 |
|------|------|------|
| spec | 2C/5W/2I | 全修（快照纳入范围、加载期 stale、字段清单、copy 语义、工具矩阵） |
| plan | 5C/6W/2I | 全修（calls 边、五路 source 合同、路径域、loadSnapshotDetailed、论证修正、升版面） |
| implement | 2C/3W/3I | C1/C2/W2/W3 全修；W1 评估后不采纳（记录理由：耦合 + 破坏序列化契约） |
| implement 复审 | C1 段级/跨平台/..foo 补全 + new-2 守卫跨平台 | 全修（centralize relativize helper + 回归测试） |
| Phase2 bootstrap | 1C/5W/1I | 全修（首次 stale 检查、快照独立 backfill、set-e 兜底、symlink 守卫、竞态收窄、测试补强、dry-run 措辞） |

**未决 critical/warning：0**

## 关键设计决策（均源码佐证）

- 🅐 id 相对化插入点 = `buildUnifiedGraph` 出口统一 pass（覆盖 calls/imports/nodes/preBuiltNodes），避开 F182 护栏 batch-orchestrator；写入边界 portable 守卫兜底 CLI graph/community 路径
- 🅐 快照可移植 = 路径域合同（持久化域相对、IO 域绝对）+ SNAPSHOT_WRAPPER_VERSION 2.0 + 旧快照 format-stale 安全退化
- 🅐 加载期 graph-format-stale 全量扫描（段级包含 + 跨平台绝对判定，共享 relativize helper）
- 🅑 bootstrap copy-if-absent 原子 + graph/snapshot 独立 + commit sidecar + stale 不阻断
- 🅒 keepalive 文档化（spectra install --git / watch）
- 🅓 性能 fix 分流（FR-014，bootstrap 已移出关键路径）

## 回归护栏

- F182 三文件（delta-regenerator / regen-plan / batch-orchestrator）**零改动**（git status 实证）
- 已 rebase 到含 F182(a56346c)/F194(557c6f4) 的最新 master，post-rebase 全绿

## 工具使用反馈（Dogfooding 四维度）

> 本 feature 本身就是 dogfooding 反馈转化的需求（F182 窗口子代理调 impact 报 graph-not-built）。

**1. MCP 是否可用**
- ❌→（修复中）：本 worktree 起始态 graph-not-built，17 工具全废——**这正是本 feature 要修的问题本身**。实现期间全程退回 Read/Grep + 直接读源码做 caller 分析。
- 🔴 **重要发现**：跑真实 bootstrap 后调 live `impact`，返回的是**全局 stale-code spectra MCP server**（非本 worktree dev build）的结果——它用旧 absolute-id 匹配逻辑，对我的 worktree-relative 查询走 fuzzy fallback 返回 `symbol-not-found`（候选全是主仓绝对路径）。说明：①bootstrap 确实让图可加载了；②但 live MCP server 跑的是旧编译产物，我的新 C2 检测不在其中。新行为由 34 个 stdio E2E 测试证（跑真实新代码）；新 C2 代码对真实 bootstrap 旧图的 graph-format-stale 检出已 live 验证（tsx 直跑）。

**2. 返回信息是否够用**
- ✅ impact 的 `fuzzyMatches` 候选有用——直接暴露了"图里是绝对 id、查询是相对 id"的不匹配，正是 F193 痛点的具象。
- 改进点（已在本 feature 落地）：旧 absolute 图过去静默 `symbol-not-found`，无法判断该重建还是首次构建；新增 `graph-format-stale` ErrorCode + 重建指引，给 agent 明确 next-step。

**3. 流程是否顺畅（Spec Driver）**
- ✅ plan「即实现合同」粒度极高（逐行标注改点行号 + Codex 修订编号），实现几乎无需猜测，5 轮 Codex 审查闭环顺畅。
- ⚠️ 工具链噪声：4.2.1 插件缓存缺 `zod`，resolve-project-context.mjs 直接崩；临时 symlink 仓库 node_modules/zod 绕开（与 F185 无关，记录备查）。
- ⚠️ `specs/src.spec.md` 每次 build/test 后再生，需反复 `git checkout` 排除出 commit（已遵显式路径 add 规避）。

**4. 结果是否准确**
- ✅ 修复后「新 worktree 开箱吃狗粮」的真实路径已打通：bootstrap copy 图 → C2 守护（旧图明确报 stale 而非静默错）。完整开箱（relative 图直接可用）待主仓用 F193 代码重建一次（自然的下次 batch）。
- 移交（不在本 feature scope）：`regen-plan.ts::resolveSourceTarget` impact 报 0 callers 但 grep 实测 2 个跨文件调用方 → call 边 recall 缺口，graph-accuracy 域，留 F191 全期 review。
