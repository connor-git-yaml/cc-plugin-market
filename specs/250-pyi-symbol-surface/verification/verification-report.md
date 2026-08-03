# Verification Report: 250-pyi-symbol-surface

**特性分支**: `claude/wizardly-elbakyan-ca91f5`（基座 `3cdd89f`，姊妹分支 F243）
**验证日期**: 2026-08-03
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证证据核查) + Layer 1.75/1.8/1.9 (深度检查/残留/文档一致性) + Layer 2 (原生工具链，独立实跑)

## Layer 1: Spec-Code Alignment

### 功能需求对齐

| FR | 描述 | 状态 | 对应 Task | 独立复核说明 |
|----|------|------|----------|------|
| FR-001 | `PYTHON_SYMBOL_SCAN_SURFACE.extensions` 扩为 `['.py','.pyi']` | ✅ 已实现 | T004 | `src/collector-surface.ts` 现值含 `.pyi`；探针 `collector-surface.test.ts` 绿 |
| FR-002 | `scanPyFiles` 保持消费 SSoT（不回退硬编码）+ 防回归探针 | ✅ 已实现 | T003/T004 | `python-adapter.ts` diff 实读确认方法体零改动，仅注释更新；`T-FR002` 存在且绿 |
| FR-003 | extraction 路三件套 + `buildModuleGraph` 双产物同步生效 | ✅ 已实现 | T004/T006 | diff 实读确认 `extractSymbolNodes` 对 `.pyi` 走同一代码路径；`T-guard-a-b` 绿 |
| FR-004（护栏 A） | pyModuleMap 显式跳过 `.pyi`；相对/绝对 import 均恒指向 `.py`，两处均配探针 | ✅ 已实现（5a 报告的 W 已闭合） | T005 | diff 实读确认 `if (absF.endsWith('.pyi')) continue;` 显式跳过；**`T-guard-a-relative` 已在本轮补齐并实读确认存在于 `tests/adapters/python-adapter.test.ts:705-726`**，5a 报告标记的"相对 import 场景无专门探针"缺口已消除 |
| FR-005（护栏 B） | label 剥离按真实扩展名，两处分支同 helper | ✅ 已实现 | T007 | diff 实读确认 `stripFileExtension` 单一 helper 替换两处硬编码 `path.basename(relPath,'.py')`（正常分支+parseError 分支） |
| FR-006 | 探针翻转 + 两面一致改写 + 反自证硬编码期望值 | ✅ 已实现 | T002 | `collector-surface.test.ts` 断言保留 `['mod.py','mod.pyi']` 硬编码列表 |
| FR-007 | fixture 再生 delta 精确匹配契约 | ✅ 已实现 | T009 | `git diff` 实读两份 pinned 资产，逐字段与 FR-007 定义的 delta（label/sourceTag 改值/新增 sourceFile+confidence+signature+symbolKind/指纹分量）完全一致，无多余/缺失 delta |
| FR-008 | 三处注释改写为"已裁决设计意图" | ✅ 已实现 | T008 | diff 实读 `python-adapter.ts` 两处注释已更新为"扩展名集合一致"表述，无自相矛盾残留 |
| FR-009 | 指纹自动 stale，无需人工 bump BEHAVIOR_VERSION | ✅ 已实现 | T009 | 实读 `collector-fingerprint.ts:83` `BEHAVIOR_VERSION = 1` 未改动 |
| FR-010 | `.pyi` 解析失败沿用 parseError 降级分支 | ✅ 已实现 | T007 | parseError 分支同样调用 `stripFileExtension` |
| FR-011（可选） | `@overload` 收敛探针 | ✅ 已实现（可选项） | T003 | 存在 `T-overload` |

### 覆盖率摘要

- **总 FR 数**: 11（含 1 可选）
- **已实现**: 11
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%

## Layer 1.5: 验证铁律合规

- **状态**: COMPLIANT
- implement/5a/5b 各阶段报告均含具体命令 + 数字（`vitest 6401/0`、`build 0`、`repo:check pass`），本轮编排器独立重跑核实数字与结论一致（略有细微差异见下方 Layer 2，属正常账目吻合，非造假）。
- 未检测到"should pass"/"看起来没问题"等推测性表述；trace.md 与两份子报告均附带文件:行号级实证。
- 缺失验证类型：无。

## Layer 1.75: 深度检查

- **调用链完整性**：`scanPyFiles` → `surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE,...)` → `extractSymbolNodes`/`buildModuleGraph` 全链路实读，常量值变化即完整驱动 `.pyi` 纳入两条消费链，无参数丢失/断链。
- **数据持久化**：本 feature 不涉及数据库写入，N/A。
- **配置贯穿**：`PYTHON_SYMBOL_SCAN_SURFACE.extensions` 从常量定义 → `surfaceMatchesFile` 消费点 → `extractSymbolNodes`/`buildModuleGraph` 实际遍历行为，全链路实读确认贯穿无衰减；`extensionSurface` 指纹分量随之自动反映（已用 `graph-quality --json` 实测 freshness=dirty 印证机制生效）。

## Layer 1.8: 残留扫描

不适用——本次改动为纯扩集（新增 `.pyi` 支持），不涉及删除/重命名，无残留扫描必要项。

## Layer 1.9: 文档一致性检查

- FR-008 要求的三处注释改写（`collector-surface.ts`/`python-adapter.ts`/`collector-fingerprint.ts`）均已实读确认落地，无自相矛盾表述残留。
- 本次未涉及架构级模块新增/删除或公共接口变更，无需检查 Blueprint/README/ADR 层面的架构文档漂移。

## Layer 2: 原生工具链（独立实跑，非引用子报告数字）

**检测到**: `package.json`（npm，TypeScript 5.x + Node 20.x+）
**项目目录**: 仓库根目录

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | `tsc` 零类型错误；`prebuild`（inline-d3，跳过写入无变化）+ `postbuild`（盖章 `3cdd89f6 (dirty)`）均成功；exit 0 |
| Test | `npx vitest run` | ✅ PASS | **Test Files 498 passed \| 4 skipped (502)；Tests 6402 passed \| 18 skipped \| 21 todo (6441)**；单次跑全绿，无需二次重跑判 flaky（trace.md 记录的首跑 1 failed/graph-quality-core.test.ts:268 共享 dist 写竞争 flaky 本轮未复现） |
| 专项 | `node dist/cli/index.js graph-quality --graph specs/_meta/graph.json --json` | ✅ PASS | `overallVerdict: pass`；`duplicateCanonicalId/containsCoverage/orphanRatio/danglingEdges/legacyAndIgnoredNodes` 全 pass；`freshness.state: "dirty"`（`recordedSourceCommit === currentHead === 3cdd89f...`，`dirtyFiles` 恰为本次改动的 6 个源/测试文件，符合 SC-002(a)/(c) 预期口径，非 `stale`） |
| repo:check | `npm run repo:check` | ✅ PASS | `[repo-check] status=pass`，全部约 85 项子检查（含 `graph-quality:*` 六项、`spec-drift:anchors-status`）逐项 pass |
| 局部回归 | `npx vitest run tests/unit/collector-surface.test.ts tests/adapters/python-adapter.test.ts src/panoramic/graph/collector-fingerprint.test.ts tests/e2e/f220-decomposition-charter.e2e.test.ts` | ✅ PASS | 4 files / 176 tests 全绿，含 F220 charter 快照 12 个场景对比全通过 |

### fixture 逐字段核对（独立 `git diff` 实读，非引用 5a/5b 结论）

- `expected-graph-only-graph.json`：`src/py/mod.pyi` module 节点 `label: "mod.pyi"→"mod"`、`metadata.sourceTag: "unified-graph"→"extraction"`（改值非新增键）、新增 `sourceFile`/`confidence`；`src/py/mod.pyi::mod_fn` symbol 节点新增 `symbolKind`/`signature: "def mod_fn() -> int"`/`sourceFile`/`confidence`；顶层 `fingerprint.extensionSurface.pythonSymbolScan.extensions` 追加 `.pyi`。**与 FR-007 定义的 delta 逐字段完全一致，无多余/缺失变化。**
- `expected-module-graph.json`：仅 `fingerprint.extensionSurface.pythonSymbolScan.extensions` 变化，`moduleGraph.modules[]` 内容无变化。**符合 FR-007 定义。**
- `git status --short` 确认改动文件集为 6 个源/测试文件 + 2 份 pinned fixture + 1 份 e2e 快照 = 9 个已跟踪文件改动，与 trace.md "9 文件 +391/-56" 的文件数口径一致。

## 5a/5b 报告结论复核（W1/W3/T-guard-a-relative 修正后是否仍成立）

- **5b（quality-review，EXCELLENT，0C/0W/3I）**：仍成立。本轮独立复核了其六维度评估中的关键论据（`scanPyFiles` 零改动、`stripFileExtension` 单一 helper、护栏 A 显式 `continue`），均与当前落盘代码一致；3 项 INFO（测试样板重复、mock 收敛、注释略长）为非阻断观察项，未受后续 W1/W3 修正影响。
- **5a（spec-review，PASS_WITH_NOTES，0C/1W/3I）**：**该报告标记的唯一 WARNING（FR-004 相对 import 场景探针缺口）已在报告落盘后的处置轮次中闭合**——`T-guard-a-relative` 已实读确认存在并断言"相对 import 恒解析到 `.py`、零 `.pyi` 目标边"。本轮验证在 FR-004 判定表中已将其状态由 5a 报告的"轻微缺口"更新为"已实现"，其余 10 条 FR 判定与 3 项 INFO 结论不受影响、仍然成立。

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100% (11/11 FR，含 1 可选) |
| Build Status | ✅ PASS |
| Test Status | ✅ PASS (6402/6402 passed, 18 skipped, 21 todo, 0 failed) |
| repo:check | ✅ PASS（全部子检查项） |
| graph-quality | ✅ PASS（duplicate/orphan/dangling/ignored 全绿；freshness=dirty 符合预期，非 stale） |
| **Overall** | **✅ READY FOR REVIEW** |

### 逐 SC 判定表

| SC | 判定 | 证据 |
|----|------|------|
| SC-001 | ✅ PASS | `collector-surface.test.ts` 翻转断言全绿，硬编码期望值列表保留 |
| SC-002(a) 回归口径 | ✅ PASS | 本仓真实图重建后 `graph-quality --json` 除 freshness 外全 pass |
| SC-002(b) fixture 口径 | ✅ PASS | 两份 pinned 资产逐字段核对与 FR-007 定义完全一致 |
| SC-002(c) 指标语义 | ✅ PASS | orphan/duplicate 分母语义符合设计（module 节点不计入分母；.py/.pyi 因 relPath 不同不产生假重复）；freshness=dirty 非 pass/fail 二元判据，符合预期四态口径 |
| SC-003 | ✅ PASS | 再生脚本二元拒绝判据未被绕过（内容变化+指纹变化→接受），pinned 资产已在工作树中待提交 |
| SC-004 | ✅ PASS | `T-guard-a-b`（绝对 import）+ `T-guard-a-relative`（相对 import，本轮新补）均绿，import 恒指向 `.py` |
| SC-005 | ✅ PASS | `T-label-normal`/`T-label-parse-error`/`T-C1-dotfile`/`T-SC005-control` 全绿，label 剥离正确且对照组不受影响 |
| SC-006 | ✅ PASS | 全量 `npx vitest run`（6402/0）与 `npm run build`（0 类型错误）零失败 |
| SC-007 | ✅ PASS | fixture 实读确认 `.pyi` symbol 节点 metadata 含 `signature`/`symbolKind`/`confidence: 'EXTRACTED'`/`sourceTag: 'extraction'`，且与 unified 路既有字段（`unifiedKind`/`sourcePath`/`exportKind`）并集共存不丢失 |

### 需要修复的问题（如有）

无。5a 报告标记的唯一 WARNING（FR-004 相对 import 探针缺口）已在本轮验证前闭合并经独立实读确认。

### 未验证项（工具未安装）

无（本次改动纯 TypeScript/Node，无需额外语言工具链）。

### 提交前遗留事项（非阻断，供编排器/用户参考）

- pinned fixture（`tests/fixtures/collector-fingerprint-guardrail/expected-*.json`）与 e2e 快照当前处于工作树未暂存状态（`git status --short` 显示 `M`），需在提交时纳入 `git add`——这是 implement 阶段的主动决策（保 verify 阶段 `git diff` 可见性），非遗漏。
- trace.md 记录的 W4/W5 改进候选（graph-quality-core.test.ts:268 dist 写竞争 flaky 已立独立改进卡 task_9294e9bd；plan 制品预测数与实际数偏差已记入 commit message 候选）不阻断本次交付，按既定改进候选流程处理。
