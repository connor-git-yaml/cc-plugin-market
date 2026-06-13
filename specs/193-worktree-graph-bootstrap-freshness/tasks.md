---
description: "Task list — Feature 193 worktree graph 开箱可用 + 增量保活"
---

# Tasks: worktree graph 开箱可用 + 增量保活

**Input**: [plan.md](./plan.md) + [spec.md](./spec.md)
**范围**: 全量（含快照可移植 — 用户 2026-06-13 裁决）
**禁改护栏**: `src/batch/{delta-regenerator,regen-plan,batch-orchestrator}.ts`（F182 在飞）

## Format: `[ID] [P?] [Story] Description`
- **[P]**: 可并行（不同文件、无依赖）
- 依赖 gate: **🅐（US2）是 🅑（US1 bootstrap 跨 worktree 生效）与 🅒（US3 增量）的前置**

---

## Phase 0: 前置审计（Shared，阻塞后续）

- [x] T001 [US2] 枚举 graph.json 全部节点/边 id 的上游来源，确认 `buildUnifiedGraph` 是否为代码节点 id 唯一来源；逐一核实 `graph-builder.ts` 其余 source（docGraph specPath / architectureIR element.id / crossReferenceLinks / extraction）的 id 形态（绝对 vs 相对），产出来源清单 → 决定每个 source 是否需相对化。输出 `verification/id-source-audit.md`。
- [x] T002 [US2] 产出 17 个 MCP 工具的 canonicalize/相对 id/stale 矩阵（Codex W5）：逐工具标注是否经 `canonicalizeSymbolId`、是否接受相对 id 输入、对旧绝对图是否报 stale。重点 graph 工具（`graph_path`/`graph_node` 等走 exact nodeMap）。输出 `verification/mcp-tools-canonicalize-matrix.md`。

---

## Phase 1: 🅐 id 相对化（US2，P1 — 前置 gate）

**目标**: graph + 快照全部持久化路径字段相对化为 POSIX 相对路径，byte 可移植。

- [x] T010 [US2] 新增共享 helper `relativizePosix(absPath, projectRoot)`：strip 前缀 + POSIX 化 + external 策略（projectRoot 外 → 保留绝对 + 标记 external，不生成 `../` 越界链，FR-004）。含单元测试覆盖 external / Windows 分隔符 / 含 `::`,`.` 的 symbol id。
- [x] T011 [US2] `src/knowledge-graph/index.ts`：`buildUnifiedGraph` **出口统一相对化 pass**（覆盖 deriveNodesFromSkeletons 节点、resolveCalls **calls 边**、deriveImportEdges 边、preBuiltNodes 注入——plan-C1；call-resolver.ts 零改动）；`metadata.projectRoot` 持久化为 `'.'`。
- [x] T011b [P][US2] extraction producer 相对化（plan-C5）：`markdown-extractor.ts:222-227` / `image-extractor.ts:240-246` 的 `source_file` 改产相对路径。
- [x] T012 [US2] `graph-builder.ts`：按 T001 审计结果对其余 source 节点 id 应用 relativizePosix；**`writeKnowledgeGraph` 内置 portable 守卫 tripwire**（path.isAbsolute 扫描 id/source/target/metadata.sourcePath/sourceFile/sourceTarget/hyperedge 引用，无需 projectRoot；warning + 计数，测试态断言 0——覆盖 CLI graph/community 不经 normalize 的写盘路径，plan-C2/W1）。
- [x] T013 [US2] `src/knowledge-graph/persistence.ts`（决策1b，plan-C3/C4）：`saveSnapshot`/`computeAllFileHashes` 写 `fileHashes` key 相对化；`detectStaleFiles` 域转换（currentFiles 相对化查 key + 旧 key 转绝对判存在性）；新增 `loadSnapshotDetailed() → {snapshot, reason}`（旧 loadSnapshot 保留薄壳）；bump `SNAPSHOT_WRAPPER_VERSION` '1.0'→'2.0'。
- [x] T013b [US2] 升版消费面同步（plan-W5）：CLI index 产出（`cli/commands/index.ts:164-168`）、incremental merge 后 safeParse（`incremental.ts:460-462`）、既有 fixture/test 的 '1.0' 字面值全部随升版核对。
- [x] T014 [US2] `src/knowledge-graph/incremental.ts`（plan-C3/C4）：`IncrementalFallbackReason` 扩展 `'snapshot-format-stale'`；`expandCallers`（170-189）/`mergeIncremental`（237-245）/changedFilesOverride 归一（361-364）按「持久化域=相对、IO 域=绝对」合同转换比对域。
- [x] T015 [US2] `src/panoramic/graph/graph-query.ts`（或 graph-tools lazy load 入口，决策1c）：加载期 `graph-format-stale` 检测——**全量扫描** node ids（命中可短路），判定 = file part 绝对 且 非当前 projectRoot 前缀；不依赖 canonicalize、不抽样（plan-W3）。
- [x] T016 [US2] `src/knowledge-graph/query-helpers.ts`：按 T002 矩阵核对 canonicalize 对相对 id 的兼容（F174 已大体就绪），按需微调。

## Phase 1 验证（🅐 gate）

- [x] T020 [US2] 更新 `tests/unit/graph/graph-builder-bytestable.test.ts` 快照 + 新增「同 commit 跨 worktree byte 一致」断言：覆盖 graph.json（node.id / edge.source/target / metadata.sourcePath/sourceFile/sourceTarget / hyperedge 引用——GraphNode 无顶层 filePath，plan-W4）+ 快照（fileHashes key / 内嵌 graph UnifiedNode.id/filePath + edge / metadata.projectRoot），排除时间戳 + external（FR-016）。
- [x] T021 [P][US2] 新增 `tests/<新>/snapshot-portability.test.ts`：快照相对化往返 + 旧绝对 key 快照触发 stale 退化 full reindex。
- [x] T022 [US2] 跑 `tests/integration/mcp-server-stdio.test.ts`（F180 44 E2E）确认 17 工具零回归；按 T002 矩阵补 graph 工具相对 id 匹配断言。
- [x] T023 [US2] `npx vitest run` + `npm run build` 全绿（gate：🅐 不绿不进 🅑）。

---

## Phase 2: 🅑 bootstrap（US1，P1 — 主阻塞，依赖 🅐）

- [ ] T030 [US1] `scripts/sync-worktree-local-state.sh`：新增 `copy_if_absent_atomic` 分支（不复用 COPY_TARGETS，Codex W4），copy `specs/_meta/graph.json` + `.spectra/unified-graph.json`，临时文件+rename 原子写，目标已有真实图则跳过。
- [ ] T031 [US1] 源优先级：主仓 → 共享缓存 `~/.spectra-graph-cache/<repo>/`（可选标 TODO 二期）→ 均无则提示构建命令（不报错，idempotent）。
- [ ] T032 [US1] copy 后写 `specs/_meta/.graph-source-commit` sidecar（source commit hash，决策3）。stale 提示只在 bootstrap 重跑 / 保活 hook 两个 shell 触点；查询期 per-tool warning 二期（plan-W6）。
- [ ] T033 [US1] 新增 `tests/<新>/worktree-bootstrap.test.ts`：缺图→copy 生效、已有真实图→跳过不覆盖、无源→提示不报错、原子性。

## Phase 2 验证

- [ ] T034 [US1] **真实 dogfood**：在本 worktree 跑 bootstrap，验证 `impact`/`context` MCP 工具可用且 id 指向当前 worktree 相对路径（SC-001）。记录体验入工具反馈。

---

## Phase 3: 🅒 保活（US3，P2 — 依赖 🅐 快照可移植）

- [ ] T040 [US3] 文档化 `spectra install --git`（post-commit 增量，git-hook-installer.ts 已存在）+ `spectra watch` 用法 → README/docs。
- [ ] T041 [US3] bootstrap 后可选激活提示（不默认强制，避免 git hook 副作用）。
- [ ] T042 [US3] 端到端验证（SC-004）：bootstrap（含快照）worktree 改一个 src 文件 commit → `buildIncremental` 走增量（fallbackToFull=false）、查询反映新状态。

---

## Phase 4: 🅓 性能诊断（US4，P3）

- [ ] T050 [US4] profiling code-only 构建路径，定位 CPU 11% 空等根因（串行 await/sleep）；若根因落 F182 护栏文件 → 记录分流（FR-014）。输出 `verification/perf-profiling-report.md`。

---

## Phase 5: 收尾

- [ ] T060 各 phase commit 前跑 Codex 对抗审查；critical 全修重测。
- [ ] T061 全量 `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check`（如涉及）全绿。
- [ ] T062 verification-report.md + 「工具使用反馈」节（dogfooding 四维度，重点记录修完后"新 worktree 开箱吃狗粮"体验）。
- [ ] T063 移交备忘：`regen-plan.ts::resolveSourceTarget` call 边 recall 缺口 → F191 全期 review。

---

## 依赖图

```
T001,T002 (审计) ─┬─→ Phase1 🅐 (T010-T016) ─→ Phase1验证(T020-T023 gate)
                  │                                   │
                  │                                   ├─→ Phase2 🅑 (T030-T034) [US1 主阻塞]
                  │                                   └─→ Phase3 🅒 (T040-T042) [US3]
T050 🅓 ──(独立，可并行)
```

**MVP 切片**: 完成 Phase1(🅐)+Phase2(🅑) 即交付 US1 主阻塞（新 worktree 开箱即用 MCP）。
