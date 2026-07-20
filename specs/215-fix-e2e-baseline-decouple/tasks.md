# Tasks: F215 E2E 共享 baseline 解耦（fix 模式精简任务清单）

**Input**: `specs/215-fix-e2e-baseline-decouple/plan.md`（变更清单/回归风险映射/验证方案）、`specs/215-fix-e2e-baseline-decouple/fix-report.md`（5-Why 根因）
**模式**: fix（精简任务清单，不按 User Story 组织；按"生成 fixture → repoint 读侧 → 逐文件验证 → 全量回归"硬顺序执行）

## 全局硬禁区（每个任务执行前默认生效，任务卡内重复强调关键项）

- **禁改** 4 个 E2E 测试文件（`feature-180-graph-tools.e2e.test.ts` / `feature-180-file-nav-stdio.e2e.test.ts` / `feature-180-symbol-chain.e2e.test.ts` / `feature-184-view-file-fuzzy.e2e.test.ts`）的任何断言——它们经 helper 间接消费，零改动
- **禁写** `~/.spectra-baselines/**` 任何路径——全程零字节写入，避免与并行 F214 采集进程竞态
- **禁做** `#`/`::` symbol id 统一——归属 F214（`graph-topology-canonical-id`），不 touch `src/knowledge-graph` / `src/graph-builder`

---

## Phase 1: Fixture 生成（阻塞性前置，其余任务依赖其产物）

### T001 生成 pinned fixture `tests/fixtures/micrograd-baseline-graph/graph.json`

**状态**: ✅ 已完成 — 实跑验收命令输出 `nodes: 38 links: 14`、`hash-#-nodes: 5`、`hash-::-nodes: 28`，与验收标准完全一致（字段名按编排器修正用 `links`）

- **动作**：
  1. 将 `~/.spectra-baselines/micrograd` 源 clone（commit `c911406e5ace8742e5841a7e0df113ecb5d54685`）**只读拷贝**到临时目录（如 `mktemp -d`），剔除 `specs/`、`Users/` 等杂质目录
  2. 用本 worktree master HEAD dist 对该临时拷贝跑 `node dist/cli/index.js batch <临时拷贝路径> --mode graph-only --output-dir <临时输出路径>`
  3. 取 `_meta/graph.json` 冻结落盘到 `tests/fixtures/micrograd-baseline-graph/graph.json`
- **验收标准**：产物为 38 节点/14 边，含 5 个 `#` 类级节点（`micrograd/nn.py#MLP`、`micrograd/nn.py#Layer`、`micrograd/nn.py#Neuron`、`micrograd/nn.py#Module`、`micrograd/engine.py#Value`）+ 28 个 `::` 成员节点（含 `micrograd/engine.py::Value.relu`）；节点/边 id 均为 repo-relative POSIX（不含临时拷贝路径前缀）
- **验收命令**：
  ```bash
  test -f tests/fixtures/micrograd-baseline-graph/graph.json && echo OK
  node -e "const g=require('./tests/fixtures/micrograd-baseline-graph/graph.json'); console.log('nodes:',g.nodes.length,'links:',g.links.length); console.log('hash-#-nodes:', g.nodes.filter(n=>n.id.includes('#')).length); console.log('hash-::-nodes:', g.nodes.filter(n=>n.id.includes('::')).length);"
  ```
  期望输出：`nodes: 38 links: 14`、`hash-#-nodes: 5`、`hash-::-nodes: 28`（GraphJSON 契约字段名是 `links` 不是 `edges`）
- **硬禁区**：生成命令仅对**临时拷贝**执行，不写回 clone 源目录，不写回 `~/.spectra-baselines/**` 任何路径

---

### T002 [P] 新增 `tests/fixtures/micrograd-baseline-graph/README.md`（provenance + 交接注记）

**状态**: ✅ 已完成 — 文件存在，`grep -c "F214"` 输出 4（含来源/生成命令/再生步骤/F214 交接注记/职责边界全部字段）

- **依赖**：T001（需引用其生成命令与实证数据）
- **必含字段**：
  - 来源：micrograd clone commit hash（`c911406e5ace8742e5841a7e0df113ecb5d54685`）+ 生成时间
  - 生成命令：完整可复制的 `batch --mode graph-only` 命令（含前置临时拷贝步骤说明）
  - 再生步骤：供未来任何一方（含 F214）一键重生成的 shell 片段
  - **F214 交接注记**：F214 落地 canonical `::` 统一（T028 fail-fast 拒绝 `#` fixture）时，必须**同步用其新 dist 重生成本 fixture** 并翻转 4 个 E2E 文件的 `#` 断言为 `::`；否则 helper 会对本 fixture（含 `#`）报 legacy-format 错误
  - 职责边界：与 `tests/fixtures/micrograd/`（F140 手写 mini 快照）是不同目录、不同职责，不可混用
- **验收命令**：
  ```bash
  test -f tests/fixtures/micrograd-baseline-graph/README.md && grep -c "F214" tests/fixtures/micrograd-baseline-graph/README.md
  ```
  期望：文件存在，且至少 1 处提及 F214 交接注记

---

## Phase 2: 读侧 repoint（3 个文件，均依赖 T001 fixture 已存在，彼此间可并行）

### T003 [P] repoint `tests/e2e/helpers/stdio-client.ts`

**状态**: ✅ 已完成 — `BASELINE_GRAPH` repoint 到 in-repo fixture；skip 判定改查 `MICROGRAD_SOURCE`；`npx tsc --noEmit -p tsconfig.json` 全量执行 0 错误（含本文件）

- **依赖**：T001
- **动作**：
  - `BASELINE_GRAPH` 常量从 `join(homedir(), '.spectra-baselines', 'micrograd-output', 'spectra-full', '_meta', 'graph.json')` 改为 `join(PROJECT_ROOT, 'tests', 'fixtures', 'micrograd-baseline-graph', 'graph.json')`
  - `MICROGRAD_SOURCE` 常量保持不变（仍指向 `~/.spectra-baselines/micrograd`）
  - `buildSkipCondition(requireBaseline)`：判断条件从 `!existsSync(BASELINE_GRAPH)` 改为 `!existsSync(MICROGRAD_SOURCE)`
  - `buildSkipReason(requireBaseline)`：提示文案同步改为 "micrograd source clone 不存在 (${MICROGRAD_SOURCE})"
  - `installRelativizedBaseline` 函数体**不改动**（`BASELINE_GRAPH` 常量已 repoint 自动生效）；`homedir` import 保留
- **硬禁区**：不改 4 个 E2E 文件的任何断言字符串；不在本文件引入 `#`/`::` 统一逻辑
- **验收命令**：
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep stdio-client.ts || echo "无 stdio-client.ts 相关类型错误"
  ```

### T004 [P] repoint `tests/integration/mcp-server-stdio.test.ts`

**状态**: ✅ 已完成 — `BASELINE_GRAPH`/`HAS_BASELINE`/`SKIP_REASON` 同步 repoint；`npx tsc --noEmit -p tsconfig.json` 全量执行 0 错误（含本文件）

- **依赖**：T001
- **动作**：本地复制的 `BASELINE_GRAPH` 常量同 T003 方式 repoint；`HAS_BASELINE` 判断改为 `existsSync(MICROGRAD_SOURCE)`；`SKIP_REASON` 文案同步调整为 "micrograd source clone 不存在"；`PROJECT_ROOT` 已在文件顶部定义（L22），无需新增 import；`writeRelativizedBaseline` 函数体不改动
- **硬禁区**：不写 `~/.spectra-baselines/**`；不改本文件之外的任何文件断言
- **验收命令**：
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep mcp-server-stdio.test.ts || echo "无该文件相关类型错误"
  ```

### T005 [P] repoint `tests/integration/agent-context-real-graph.test.ts`

**状态**: ✅ 已完成 — 新增 `resolve` import + `PROJECT_ROOT`；`BASELINE_GRAPH`/`HAS_BASELINE` repoint；断言字符串零改动；`npx tsc --noEmit -p tsconfig.json` 全量执行 0 错误（含本文件）

- **依赖**：T001
- **动作**：
  - `import { join } from 'node:path'` 改为 `import { join, resolve } from 'node:path'`
  - 新增 `const PROJECT_ROOT = resolve('.');`
  - `BASELINE_GRAPH` 从 `join(homedir(), '.spectra-baselines', 'micrograd-output', 'spectra-full', '_meta', 'graph.json')` 改为 `join(PROJECT_ROOT, 'tests', 'fixtures', 'micrograd-baseline-graph', 'graph.json')`
  - `HAS_BASELINE` 从 `existsSync(BASELINE_GRAPH)` 改为 `existsSync(MICROGRAD_SOURCE)`（与其余 5 个消费文件统一 skip 语义口径，跨文件一致性优先于单文件最小化）
- **硬禁区**：不改动本文件中任何 assertion 字符串（如 `micrograd/nn.py#MLP` / `::Value.relu` 等预期值一律保留原样）
- **验收命令**：
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep agent-context-real-graph.test.ts || echo "无该文件相关类型错误"
  ```

**Checkpoint**：Phase 1 + Phase 2 完成后，3 个读侧文件均已 repoint 到 in-repo fixture，可进入逐文件验证阶段

---

## Phase 3: 逐文件消费方验证（7 个文件独立跑，assertion 级核对，不只看 exit code）

### T006 逐文件验证 6 个直接消费文件 + 1 个附带观察文件

**状态**: ✅ 已完成 — 7 个文件独立跑全部 passed，共 39 个用例 0 失败：
mcp-server-stdio(5)、agent-context-real-graph(6)、feature-180-graph-tools(9)、
feature-180-file-nav-stdio(6)、feature-180-symbol-chain(8)、feature-184-view-file-fuzzy(2)、
feature-180-telemetry(3)。原 8 个失败用例（分布在 4 个 E2E 文件中，共 25 个用例）全部转绿。
assertion 级核对：`grep` 确认 `micrograd/nn.py#MLP`、`micrograd/engine.py::Value.relu` 等断言字符串
与 fixture 实际节点 id 逐一匹配，非仅退出码判定

- **依赖**：T002、T003、T004、T005 全部完成
- **动作**：依次单独执行以下 7 条命令，每条执行后人工核对输出中的具体 assertion（尤其是 R1 幂等性——输出 id 与断言字符串如 `micrograd/engine.py::Value.relu` 逐一匹配；R2 字段覆盖——symbol-chain 的 `detect_changes→impact→context` 链、agent-context 的 C-202/C-202b 断言、view-file-fuzzy 依赖字段），而非仅确认全绿：
  ```bash
  npx vitest run tests/integration/mcp-server-stdio.test.ts
  npx vitest run tests/integration/agent-context-real-graph.test.ts
  npx vitest run tests/e2e/feature-180-graph-tools.e2e.test.ts
  npx vitest run tests/e2e/feature-180-file-nav-stdio.e2e.test.ts
  npx vitest run tests/e2e/feature-180-symbol-chain.e2e.test.ts
  npx vitest run tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts
  npx vitest run tests/e2e/feature-180-telemetry.e2e.test.ts
  ```
- **验收标准**：原 8 个失败用例（分布在前 4 个 E2E 文件中）全部转绿；`feature-180-telemetry.e2e.test.ts` 无新增失败（附带观察，非原始失败清单成员）
- **硬禁区**：发现断言失配时，只能改 `tests/e2e/helpers/stdio-client.ts` / 2 个集成测试文件的 repoint 逻辑或 fixture 生成方式（回到 T001/T003-T005 修正），**不得**为了让测试变绿而改动 4 个 E2E 文件里的断言字符串

### T007 无 clone 环境模拟验证（R3：skip 语义而非 error）

**状态**: ✅ 已完成（执行方式经编排器裁定修正：改用 `HOME` 环境变量遮蔽，而非 `mv` 改名共享
clone 目录，避免与 F214 运行中管线竞态）—
`FAKE_HOME=$(mktemp -d) && HOME="$FAKE_HOME" npx vitest run <7 个文件>` 全部 7 个文件、
40 个用例状态为 `skipped`，0 个 `failed`/`error`；真实 `$HOME` 零接触

- **依赖**：T006
- **动作**：用 `HOME` 环境变量遮蔽（Node `os.homedir()` 遵循 `$HOME`），而非改名共享 clone 目录（改名与并行 F214 运行中管线存在竞态风险，已被编排器否决）：`FAKE_HOME=$(mktemp -d) && HOME="$FAKE_HOME" npx vitest run <7 个文件>`；in-repo fixture 在假 HOME 下仍存在（不受 `$HOME` 影响），clone 在假 HOME 下不存在 → 触发 skip 条件；真实 `$HOME` 全程零接触，无需任何恢复步骤
- **验收命令**：
  ```bash
  FAKE_HOME=$(mktemp -d)
  HOME="$FAKE_HOME" npx vitest run tests/integration/mcp-server-stdio.test.ts tests/integration/agent-context-real-graph.test.ts tests/e2e/feature-180-graph-tools.e2e.test.ts tests/e2e/feature-180-file-nav-stdio.e2e.test.ts tests/e2e/feature-180-symbol-chain.e2e.test.ts tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts tests/e2e/feature-180-telemetry.e2e.test.ts
  rm -rf "$FAKE_HOME"
  ```
  期望：全部用例状态为 `skipped`，无 `failed`/`error`
- **硬禁区**：本任务**不得**触碰 `~/.spectra-baselines/**` 任何路径（包括改名/移动/删除）；一律通过 `HOME` 环境变量遮蔽模拟"无 clone"场景，真实 home 全程零接触

  > 注：Codex 对抗审查后，`buildSkipCondition`/`buildSkipReason` 的 skip 语义已进一步拆分（CRITICAL-1 修复）——`requireMicrogradSource=false` 的纯图套件（graph-tools/telemetry/mcp-server-stdio/agent-context in-process）不再因 clone 缺失而 skip，会在假 HOME 下**实跑并通过**（in-repo fixture 恒存在）；仅 `requireMicrogradSource=true` 的拷贝 `.py` 套件（file-nav-stdio/symbol-chain/view-file-fuzzy）与新归位的 batch-repro 会 skip。四象限实测结果见 verification-report.md。

### T008 共享 home 零写入实证（R4）

**状态**: ✅ 已完成（验收范围经编排器裁定缩小至 `~/.spectra-baselines/micrograd` 与
`~/.spectra-baselines/micrograd-output` 两个子树，降低 F214 对 `nanoGPT-output` 等其他子树
并行写入的噪声）— mtime 检查确认 `micrograd-output` 内全部文件 mtime 均 ≤ 18:19:43（F214 已完成
的合法重建，早于本会话 18:44 开始的执行窗口）；hash 前后对照
（`find ~/.spectra-baselines/micrograd ~/.spectra-baselines/micrograd-output -type f -exec sha256sum {} \; | sort | sha256sum`）
在围绕一次完整 T006 复跑的前后采样中完全一致（`68c7fff4...` = `68c7fff4...`），零写入实证成立

- **依赖**：T006、T007
- **动作**：在 T006/T007 执行前后分别对 `~/.spectra-baselines` 做递归 hash 采样；若 F214 采集仍在跑，选择其空闲窗口采样，避免把对方进行中的合法写入误判为本修复引入的写入；按 mtime 是否落在本次 vitest 执行区间且非 F214 相关子目录（如 `nanoGPT-output/`）人工区分写入来源
- **验收命令**：
  ```bash
  find ~/.spectra-baselines -type f -exec sha256sum {} \; | sort | sha256sum   # 采样 1（Phase 3 开始前）
  # ...执行 T006 + T007...
  find ~/.spectra-baselines -type f -exec sha256sum {} \; | sort | sha256sum   # 采样 2（Phase 3 结束后）
  ```
- **验收标准**：两次 hash 一致，或差异可完全归因于 F214 并行写入（非 micrograd 相关子目录，且 mtime 落在 F214 已知采集窗口内）
- **硬禁区**：本任务是纯观测任务，禁止对 `~/.spectra-baselines/**` 做任何写入、修改、删除操作

---

## Phase 4: 全量回归收尾

### T009 两轮全量 vitest + 类型检查，对照 F213 基线

**状态**: ✅ 已完成 — 由 verify 阶段（Phase 4c）独立复核实跑，数据以
`specs/215-fix-e2e-baseline-decouple/verification/verification-report.md` 为准：
两轮 `npx vitest run` 结果完全一致（Test Files 429 passed / 4 skipped，Tests 5127 passed /
18 skipped / 21 todo），均高于 F213 基线 5079 pass，无失败用例；`npx tsc --noEmit -p tsconfig.json`
两次均 0 错误；hash 对照确认 in-repo fixture 全程零写入，`~/.spectra-baselines/micrograd` 子树
零字节变化，`micrograd-output` 子树变化经归因确认系 F214 并行合法采集（本套件代码无实际读写引用
该路径）。原 8 个失败用例（分布于 4 个 E2E 文件）全部转绿，定向复核 8 文件 42 用例全绿。

- **依赖**：T006、T007、T008 全部通过
- **动作**：
  1. 跑两轮全量 `npx vitest run`，确认结果一致（非偶发/幂等）
  2. 对比 F213 基线 5079 pass；已知负载 flaky 名单（`watch-command` / `community-analysis` perf / `cli-e2e --version` / `batch-orchestrator-incremental`）若失败，隔离单独重跑定性，不计入本次回归判断
  3. 若 diff 引入 TS 变更（如 `agent-context-real-graph.test.ts` 新增 `resolve` import），跑 `npx tsc --noEmit` 确认类型检查零错误
  4. 若 CI/干净环境执行，先确认 `dist/cli/index.js` 存在（本次改动不涉及 `src/**`，理论上无需重新 `npm run build`）
- **验收命令**：
  ```bash
  npx vitest run   # 第一轮
  npx vitest run   # 第二轮
  npx tsc --noEmit -p tsconfig.json
  ```
- **验收标准**：
  - 原 8 个失败用例转绿（已在 T006 逐文件验证中确认，此处全量口径复核）
  - 全量 vitest 两轮结果一致，通过数不低于 F213 基线 5079（已知 flaky 除外）
  - `~/.spectra-baselines/**` 目录树 hash 在本修复相关操作前后无变化（已在 T008 完成实证，此处仅需二次确认无新增写入）
  - 无 clone 环境下 7 个消费文件整体 skip，不产生新的 error（已在 T007 完成实证）
  - `npx tsc --noEmit` 零错误

---

## Dependencies & Execution Order

```
T001（fixture graph.json）
  ├─→ T002（README.md，依赖 T001 数据引用）
  ├─→ T003 [P]（stdio-client.ts repoint）
  ├─→ T004 [P]（mcp-server-stdio.test.ts repoint）
  └─→ T005 [P]（agent-context-real-graph.test.ts repoint）
         │
         ▼
T006（7 文件逐一 assertion 级验证，依赖 T002-T005 全部完成）
  ├─→ T007（无 clone 环境模拟）
  └─→ T008（home 零写入实证，依赖 T006+T007 观测窗口）
         │
         ▼
T009（两轮全量回归 + tsc，收尾）
```

- **硬顺序约束**：T001 必须最先完成（其余任务均直接或间接依赖其产物路径存在）；T003-T005 可并行但均须在 T001 之后；T006 必须在全部读侧 repoint（T002-T005）完成后才能开始；T007/T008 是 T006 的伴随验证，可紧随其后；T009 是收尾任务，必须最后执行
- **并行机会**：T002（文档）与 T003/T004/T005（代码 repoint）之间无相互依赖，四者可并行；T003/T004/T005 三个文件互不重叠，可并行

---

## Notes

- 本任务清单为 fix 模式精简版，不按 User Story 组织（无 spec.md 意义上的 User Story）
- 任务粒度对齐 plan.md 的「变更清单」「回归风险点与验证映射」「验证方案」三节，逐条映射为可执行任务
- 每个任务的验收命令均可直接执行，输出需与任务卡内"验收标准"逐条核对，不接受"只看退出码"的验收方式
- 全局硬禁区（4 E2E 文件断言 / `~/.spectra-baselines/**` 写入 / `#`/`::` 统一）贯穿全部任务，任务卡内标注仅为强调高风险环节，不代表其余任务无需遵守
</content>
