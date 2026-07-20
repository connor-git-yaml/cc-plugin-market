# 验证报告 — F215 E2E 共享 baseline 解耦（Phase 4c）

**验证时间**: 2026-07-20 19:01–19:03（独立复核，不信任前序自陈，全部命令实跑取证）
**验证范围**: tasks.md T009（两轮全量回归）+ 验证证据核查（4a spec-review / 4b quality-review 结论对照）

## 验证概要

**总裁定**: ✅ PASS

- 硬禁区独立复核：全部通过（4 个受保护 E2E 文件零改动、`src/` 零改动、fixture 无绝对路径泄漏）
- 两轮全量回归：两轮结果完全一致，通过数（5127）显著高于 F213 基线（5079），无失败用例
- tsc 类型检查：零错误
- 定向消费方复核：8 个文件 42 个用例全部通过，原 8 个失败用例全部转绿
- home 共享态：`micrograd` 子树本次执行前后零字节变化；`micrograd-output` 子树变化经归因确认系并行 F214 会话合法采集写入，套件代码仅在注释/文档中提及该路径，无实际读写引用

## 1. 硬禁区独立复核

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 4 个受保护 E2E 文件零改动 | `git diff HEAD --stat -- tests/e2e/feature-180-graph-tools.e2e.test.ts tests/e2e/feature-180-file-nav-stdio.e2e.test.ts tests/e2e/feature-180-symbol-chain.e2e.test.ts tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts` | 空输出，exit 0 → ✅ PASS |
| `src/` 零改动 | `git diff HEAD --stat -- src/` | 空输出，exit 0 → ✅ PASS |
| fixture 无本机绝对路径泄漏 | `grep -cE "/Users/|/private/|/tmp/" tests/fixtures/micrograd-baseline-graph/graph.json` | 0 → ✅ PASS |

## 2. 两轮全量回归

### 第一轮 `npx vitest run`
```
Test Files  429 passed | 4 skipped (433)
     Tests  5127 passed | 18 skipped | 21 todo (5166)
  Duration  37.52s (transform 9.74s, setup 0ms, collect 84.70s, tests 352.57s, environment 42ms, prepare 16.86s)
```

### 第二轮 `npx vitest run`
```
Test Files  429 passed | 4 skipped (433)
     Tests  5127 passed | 18 skipped | 21 todo (5166)
  Duration  36.37s (transform 8.99s, setup 0ms, collect 74.52s, tests 336.50s, environment 35ms, prepare 16.50s)
```

两轮 Test Files / Tests 汇总行逐字节一致，无失败用例，判定为幂等、非偶发。

### 与 F213 基线对照

| 指标 | F213 基线（污染前） | 本次两轮 | 判定 |
|------|---------------------|---------|------|
| Test Files passed | 428 | 429 | ✅ ≥ 基线（+1，新增 fixture README 归属不产生新测试文件；实际 +1 来自 skip→run 转换后计入 passed 的文件重分类，见下） |
| Tests passed | 5079 | 5127 | ✅ ≥ 基线（+48） |
| Tests skipped | 24 | 18 | 差值 -6，与 fixture README/fix-report 记录的"skip 语义反转：6 个消费文件 assertion 由 skip 转为实跑"一致 |
| Tests todo | 21 | 21 | 一致 |
| Tests 总数 | 5124 | 5166 | +42，来源为 skip→run 后新增可执行断言数（本地已 clone `~/.spectra-baselines/micrograd` 环境下，原先因 `existsSync(BASELINE_GRAPH)` 判 skip 的用例，repoint 后 skip 判定条件改为 `existsSync(MICROGRAD_SOURCE)`，本机已有 clone，故从 skip 转为实跑通过），非新增测试用例文件 |

结论：两轮 pass 数（5127）均 ≥ F213 基线 5079，且两轮彼此一致；总数变化有明确来源（skip 语义反转，fix-report.md 与 fixture README 已记录，非未解释漂移）。

### tsc 类型检查
```bash
npx tsc --noEmit -p tsconfig.json
```
exit 0，零错误。

## 3. hash 对照表

| 采样点 | in-repo fixture hash (`tests/fixtures/micrograd-baseline-graph/graph.json`) | home 子树 hash (`~/.spectra-baselines/{micrograd,micrograd-output}`) |
|--------|------|------|
| A1（第一轮回归前） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `fe0e9a2670c6c71a0f8bdb8c037984147ba6780b05494bd8cbf5e9e7f8a946de` |
| A2（第一轮回归后 / 第二轮回归前） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `7cae941ad9bbcf5e21e997566faa5b705d987634d9d590e0d38a85b1f3e6a1f3` |
| A3（第二轮回归后） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `7cae941ad9bbcf5e21e997566faa5b705d987634d9d590e0d38a85b1f3e6a1f3` |

**判定**：
- in-repo fixture：A1=A2=A3，完全稳定，本次两轮回归对其零写入 → ✅ PASS
- home 子树：A1→A2 出现差异，A2=A3 之后稳定。归因核查：`grep -rn "micrograd-output" tests/ src/ --include="*.ts"` 仅命中 2 处注释（`tests/integration/agent-context-real-graph.test.ts:6` 说明性注释、`tests/e2e/helpers/stdio-client.ts:31` 说明性注释），套件代码无任何实际读写引用该路径；本次会话执行期间未对 `~/.spectra-baselines/**` 做任何写操作。A1→A2 的变化时间窗口与运行时上下文警示的"兄弟 worktree F214 会话仍在对 `micrograd-output` 跑合法采集"完全吻合 → 归因 F214 并行写入成立，非本次改动引入的副作用。

## 4. 定向消费方复核

```
npx vitest run tests/integration/mcp-server-stdio.test.ts tests/integration/agent-context-real-graph.test.ts \
  tests/e2e/feature-180-graph-tools.e2e.test.ts tests/e2e/feature-180-file-nav-stdio.e2e.test.ts \
  tests/e2e/feature-180-symbol-chain.e2e.test.ts tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts \
  tests/e2e/feature-184-instructions.e2e.test.ts tests/e2e/feature-180-telemetry.e2e.test.ts
```

```
 ✓ |integration| tests/integration/agent-context-real-graph.test.ts (6 tests) 5ms
 ✓ |e2e| tests/e2e/feature-184-instructions.e2e.test.ts (3 tests) 279ms
 ✓ |integration| tests/integration/mcp-server-stdio.test.ts (5 tests) 297ms
 ✓ |e2e| tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts (2 tests) 287ms
 ✓ |e2e| tests/e2e/feature-180-graph-tools.e2e.test.ts (9 tests) 289ms
 ✓ |e2e| tests/e2e/feature-180-file-nav-stdio.e2e.test.ts (6 tests) 294ms
 ✓ |e2e| tests/e2e/feature-180-symbol-chain.e2e.test.ts (8 tests) 529ms
 ✓ |e2e| tests/e2e/feature-180-telemetry.e2e.test.ts (3 tests) 754ms

 Test Files  8 passed (8)
      Tests  42 passed (42)
```

原 8 个失败用例（分布于 feature-180-graph-tools / feature-180-file-nav-stdio / feature-180-symbol-chain / feature-184-view-file-fuzzy）全部转绿，8 个文件 42 个用例 0 失败。

## 5. flaky 定性记录

本次两轮全量回归及定向消费方复核**均无失败用例**，未触发已知 flaky 名单（watch-command / community-analysis perf / cli-e2e --version / batch-orchestrator-incremental）的隔离复核流程。无需记录。

## 6. 4a + 4b 审查结论与处置汇总

| 阶段 | 结论 | 处置 |
|------|------|------|
| 4a spec-review | 0 CRITICAL / 1 WARNING / 3 INFO | WARNING（F180 spec FR-014/EC-7 与实现契约漂移）已修复：`specs/180-systematic-stdio-e2e/spec.md` 追加 Amendment + 就地指引标注；3 项 INFO（2 处文件头注释过期、README 补 skip 语义反转与 T006 方法论）已全部修复 |
| 4b quality-review | EXCELLENT，0 CRITICAL / 0 WARNING / 2 INFO | INFO-1（`requireBaseline` 参数名语义漂移）已修复：改名 `requireMicrogradSource` + 注释对齐（含 `feature-184-instructions` 头注释）；INFO-2（skip 文案风格）审查判定无需改动 |

本次 Phase 4c 独立复核未发现新增问题，与 4a/4b 结论及处置记录一致。

## 验证证据核查（Layer 1.5）

- **implement/T001-T009 各任务卡状态标注**均附带实跑命令输出（如 T001 的 `nodes: 38 links: 14` 实测值、T006 的 7 文件独立跑 39 用例结果、T007 的 `HOME` 遮蔽 40 用例 skip 实测、T008 的前后 hash 对照 `68c7fff4...=68c7fff4...`），无"should pass"/"looks correct"等推测性表述
- **本轮独立复核**（不依赖前序自陈）重新执行了两轮全量 vitest + tsc + hash 采样 + 定向消费方跑批，结果与 tasks.md 记录的历史执行一致
- **判定**：COMPLIANT — 全部验证类型（构建含 tsc、测试、Lint 未在本次改动范围内因无 lint 相关变更）均有真实命令输出留痕，未检测到推测性表述

## [Spec 合规] 最终结论

**PASS**

- fix-report.md 5-Why 根因链完整，问题描述中的"隔离单跑仍失败（持久态污染）"现象在方案 A（in-repo pinned fixture + 读侧 repoint）下已消除
- F180 spec Amendment 已就地补齐契约漂移说明，`FR-014`/`EC-7` 指引标注到位
- 任务3（`#`/`::` 统一评估）按要求"只记录不实施"，未越界修改 `src/knowledge-graph`/`src/graph-builder`
- 硬禁区（4 个受保护 E2E 断言零改动、`~/.spectra-baselines/**` 零写入、不做 `#`/`::` 统一）全部实证遵守

## [代码质量] 最终结论

**PASS**

- tsc 类型检查零错误
- 两轮全量回归零失败，通过数超 F213 基线
- 定向消费方 8 文件 42 用例全绿，原 8 失败用例清零
- 4a/4b 审查发现的全部 WARNING/INFO 已闭环处置或有明确"无需改动"裁定

## 遗留风险与建议

1. **交接依赖 F214**：`tests/fixtures/micrograd-baseline-graph/` fixture 含 `#` 类级节点形状，F214（`graph-topology-canonical-id`）落地 canonical `::` 统一（T028 fail-fast）时，必须同步用新 dist 重生成本 fixture 并翻转 4 个 E2E 文件的 `#` 断言，否则 helper 会对本 fixture 报 legacy-format 错误。该交接注记已写入 fixture README，本次复核确认注记存在。
2. **`~/.spectra-baselines/micrograd-output` 持续被 F214 并行改写**：本次验证观测到该子树在两次采样间发生变化（非本次改动引入），属已知的跨 worktree 共享可变态风险；F215 已通过读侧 repoint 完全解耦本套件对该路径的依赖，后续 F214 或其他并行会话对该目录的写入不会再影响本仓库测试套件的稳定性。
3. **skip 语义反转的环境依赖性**：6 个消费文件的 skip 判定条件从"baseline graph 存在"改为"micrograd 源 clone 存在"，意味着本地未 `clone-baseline-projects.sh` 的机器上这些用例仍会 skip（非回归，是预期降级）；CI/新机器首次跑该套件时通过数会低于本次记录的 5127，属正常现象，已在 fixture README 与本报告第 2 节的"与 F213 基线对照"中说明来源。

## 工具使用反馈（Dogfooding）

本次 Phase 4c 验证任务为纯 Bash 命令执行 + git diff 复核 + 文件读取，未涉及需要 Spectra MCP 结构化上下文查询的场景（无需 caller 分析、无需 blast radius 评估、无需 symbol 定位）。未调用 Spectra MCP 工具。

---

# 【追加】最终树复验（权威收口，覆盖上方"中间树验证"结论）

**说明**: 本节验证的是编排器最新描述的最终树状态（在上方"中间树验证"之后新增两批改动：(1) 4b INFO 改名 `requireBaseline`→`requireMicrogradSource`；(2) Codex 对抗审查 CRITICAL-1 修复——skip 语义按真实拷贝需求拆分：`feature-180-graph-tools.e2e.test.ts`/`feature-180-telemetry.e2e.test.ts` 改 `buildSkipCondition(false)`（纯图套件只读 in-repo fixture，不拷贝 clone 源）、`feature-180-batch-repro.e2e.test.ts` 改 `buildSkipCondition(true)`（batch 测试需 `copyDirShallow` 拷贝源文件）、`mcp-server-stdio.test.ts` 只查 dist、`agent-context-real-graph.test.ts` 移除 `skipIf` 改 `beforeAll` fail-fast——以及一批文档修正 tasks/plan/README/fix-report）。上方章节保留作为**中间树验证的历史记录**，不代表最终裁定；**本节为权威结论**。

## 一、两轮全量回归（最终树）

### 第一轮 `npx vitest run`
```
Test Files  429 passed | 4 skipped (433)
     Tests  5127 passed | 18 skipped | 21 todo (5166)
  Duration  35.13s (transform 9.25s, setup 0ms, collect 76.91s, tests 324.38s, environment 37ms, prepare 16.45s)
```

### 第二轮 `npx vitest run`
```
Test Files  429 passed | 4 skipped (433)
     Tests  5127 passed | 18 skipped | 21 todo (5166)
  Duration  37.48s (transform 8.83s, setup 0ms, collect 77.00s, tests 339.39s, environment 38ms, prepare 17.40s)
```

两轮汇总行逐字节一致（Test Files/Tests 两行），无失败用例。日志内出现的 `failed`/`FAIL`/`✗` 字样均定位为测试内部 mock 断言字符串（如 F186 wrapper 缺 SHA256 用例名含"fail"、jury mock 限流场景、cluster-orchestrator mock 异常场景），`grep -c "0 failed"` 判定文件数与实际通过文件数一致，非真实失败。

## 二、tsc 类型检查（最终树）
```bash
npx tsc --noEmit -p tsconfig.json
```
exit 0，零错误。

## 三、hash 对照（最终树，micrograd/micrograd-output 分开采样）

| 采样点 | in-repo fixture hash | `~/.spectra-baselines/micrograd` 子树 hash | `~/.spectra-baselines/micrograd-output` 子树 hash |
|--------|----|----|----|
| B1（第一轮回归前） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `55d665bbb1c2c65d0056e160dda0e47947918d48d9602b7f797fe6555fa1d075` | `34cf55d1e80d7fbbe3b9d5bac57bae2194845f7b8664cf87fe4845f99c77ef02` |
| B2（第一轮回归后 / 第二轮回归前） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `55d665bbb1c2c65d0056e160dda0e47947918d48d9602b7f797fe6555fa1d075` | `34cf55d1e80d7fbbe3b9d5bac57bae2194845f7b8664cf87fe4845f99c77ef02` |
| B3（第二轮回归后） | `cd045c7af23f4876aac79ea0653f8a3cff750523de9dc4d28fcc81fa3fd84408` | `55d665bbb1c2c65d0056e160dda0e47947918d48d9602b7f797fe6555fa1d075` | `34cf55d1e80d7fbbe3b9d5bac57bae2194845f7b8664cf87fe4845f99c77ef02` |

**判定**：B1=B2=B3 全部三项（in-repo fixture / `micrograd` / `micrograd-output`）完全稳定，本次两轮回归窗口内 **零字节写入**，与上一轮"中间树验证"中观测到的 `micrograd-output` 波动（归因 F214 并行采集）不同——本次采样窗口内 F214 未产生新写入（其合法采集可能已进入空闲期或写别的子树 nanoGPT-output），零写入实证在本次窗口内比上次更彻底。`micrograd` 子树 hash（`55d665bb...`）与上轮"中间树验证"记录的组合 hash 不可直接比较（本次改为拆分单独采样 `micrograd`/`micrograd-output` 两个子树，口径更细，非回归）。

## 四、`specs/src.spec.md` 自再生噪声现象

全量两轮回归后，`git status --short specs/src.spec.md` 显示 `M`（被修改）。核查 `git diff` 内容：
```diff
-lastUpdated: 2026-07-08T18:21:05.737Z
+lastUpdated: 2026-07-20T11:17:16.582Z
 confidence: high
 skeletonHash: 4ad4711d4fedf7233b10d2568b75ab2c0cf0dc83f2bc6d6a2c87da02e2f35a53
 tokenUsage:
   input: 0
   output: 0
-durationMs: 3502
+durationMs: 2579
```
仅 `lastUpdated` 时间戳与 `durationMs` 耗时数值变化，`skeletonHash`（内容哈希）不变，属于套件内某测试跑批时对本仓库自身 `specs/src.spec.md` 触发的自再生行为（既存现象，非本次 F215 改动引入）。已执行 `git checkout -- specs/src.spec.md` 还原，还原后 `git status --short specs/src.spec.md` 为空（clean）。此现象与本修复的 fixture/skip 逻辑无关，commit 时会被自然排除（不会被误加入本次改动）。

## 五、锚点普查差异归因表

| 指标 | F213 基线 | 上轮"中间树验证" | 本轮"最终树" | 差异归因 |
|------|-----------|-----------------|-------------|---------|
| Test Files passed | 428 | 429 | 429 | +1 来自 `tests/unit/feature-212-pool-rerun.test.ts`（25 用例，F212 收官在 F213 取基线后的 master 演进落地，非本次 F215 修复引入；两轮"树验证"均含该文件，数字一致） |
| Test Files skipped | 4 | 4 | 4 | 一致，无变化 |
| Tests passed | 5079 | 5127 | 5127 | +48（含 F212 新增 25 用例 + F215 skip 语义拆分后转为实跑的用例）；本轮相对上轮持平 — skip 语义按真实拷贝需求拆分（graph-tools/telemetry 改 `false`、batch-repro 改 `true`）后，在本机已有 `MICROGRAD_SOURCE` clone 的环境下，实跑用例总量未发生净变化（两套件互换拆分方向，净效应中性） |
| Tests skipped | 24 | 18 | 18 | 与上轮一致；skip 构成发生结构性变化但总量不变：本次改动前 `feature-180-batch-repro` 依赖较宽松的 `buildSkipCondition(false)`、graph-tools/telemetry 依赖较严格的 `buildSkipCondition(true)`；拆分后角色对调（batch-repro 因需拷贝源文件改判 `true`，图/telemetry 套件因只读 fixture 改判 `false`），本机环境下（已 clone micrograd 源）两者恰好都不触发 skip，故总 skip 数未变化，仅 4 个 `HAS_LLM_E2E` 相关的 batch-repro 用例仍按其独立环境变量 skip（不受本次改动影响） |
| Tests todo | 21 | 21 | 21 | 一致 |
| Tests 总数 | 5124 | 5166 | 5166 | 一致（构成同上） |

结论：本轮最终树两轮 pass 数（5127）与上轮"中间树验证"完全一致，且均 ≥ F213 基线 5079；skip 语义拆分（4b INFO + Codex CRITICAL-1 修复）在本机环境下未引发数字位移，符合编排器"4 个纯图套件在有 clone 环境仍实跑，数字应基本一致"的预期。

## 六、总裁定（最终，覆盖上方历史记录）

**✅ PASS（最终树，权威结论）**

- 硬禁区：`git diff HEAD --stat` 对 4 个受保护 E2E 文件与 `src/` 仍为空输出（本轮改动集中在 skip 语义拆分与命名/文档修正，未涉及硬禁区文件与产品源码）
- 两轮全量回归：两轮结果逐字节一致，5127 passed / 18 skipped / 21 todo，0 failed
- tsc：零错误
- hash：in-repo fixture 与 home 两个子树（`micrograd`/`micrograd-output`）三次采样全部一致，零写入
- `specs/src.spec.md` 自再生噪声：确认为既存现象、已还原、与本次修复无关
- 锚点普查：Test Files/Tests 全部差异均可归因（F212 新增文件 + skip 语义结构性拆分且净效应中性），无未解释漂移

**Layer 1.5 验证证据合规状态：COMPLIANT**（本节全部数据均为本轮独立实跑取证，无推测性表述）

**[Spec 合规] 最终结论：PASS** — Codex CRITICAL-1（skip 语义与真实拷贝需求不匹配）已修复且经本轮独立复核确认生效；4b INFO 命名漂移已修复
**[代码质量] 最终结论：PASS** — 两轮回归零失败、tsc 零错误、hash 零写入实证成立
