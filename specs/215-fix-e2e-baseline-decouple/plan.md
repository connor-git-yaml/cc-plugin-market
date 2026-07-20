
# 修复实施计划: F215 E2E 共享 baseline 解耦

**Branch**: `claude/modest-ellis-e4f0fe` | **Date**: 2026-07-20 | **模式**: fix
**Input**: `specs/215-fix-e2e-baseline-decouple/fix-report.md`（5-Why 根因追溯 + 方案取舍，已完成）

**Note**: fix 模式精简计划，聚焦最小变更范围、回归风险评估与修复验证方案；不产出 research.md / data-model.md / contracts/（本修复无产品行为变化，无新实体、无新契约）。

## Summary

**根因**：4 个 E2E 测试文件（经共享 helper）+ 2 个集成测试文件把跨 worktree 共享可变的
`~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 当稳定 fixture 直读，
无 pin、无版本、无形状校验。并行 F214 会话对该路径做了合法的 baseline 重采集（M9 轨道 B canonical
`::` 统一），使共享图丢失 `#` 类级节点，8 个下游用例断言落空。

**修复方案（已锁定方案 A，编排器探针已验证可行性）**：把当前 master HEAD dist 对 micrograd 源 clone
临时拷贝跑 `batch --mode graph-only` 的产物冻结为 **in-repo pinned fixture**
（`tests/fixtures/micrograd-baseline-graph/graph.json`，38 节点/14 边，含 5 个 `#` 类级节点 +
28 个 `::` 成员节点，与 F214 T001a master 快照节点/边集合完全相等），3 个读侧文件 repoint 到该
fixture，skip 语义从"baseline 图存在"改为"micrograd 源 clone 存在"（因为 fixture 现在恒存在，
真正的外部依赖收窄为 `.py` 源文件拷贝需要的 `MICROGRAD_SOURCE`）。`~/.spectra-baselines/**`
全程零写入，不与 F214 运行中的采集进程竞态。

## Scope

### In scope
1. 新增 `tests/fixtures/micrograd-baseline-graph/graph.json` + `README.md`（冻结 fixture + provenance）
2. `tests/e2e/helpers/stdio-client.ts`：`BASELINE_GRAPH` repoint + `buildSkipCondition`/`buildSkipReason` 语义调整
3. `tests/integration/mcp-server-stdio.test.ts`：本地复制的同 pattern 同步调整
4. `tests/integration/agent-context-real-graph.test.ts`：本地复制的同 pattern 同步调整

### Out of scope（显式不做）
- 4 个 E2E 测试文件（feature-180-graph-tools / feature-180-file-nav-stdio / feature-180-symbol-chain /
  feature-184-view-file-fuzzy）本身的任何断言改动——它们经 helper 间接消费，零改动
- `#` / `::` symbol id 统一——归属 F214（`graph-topology-canonical-id`），本修复只评估记录（见
  fix-report.md「`#`/`::` 统一评估」节），不实施、不touch 其正在改动的 `src/knowledge-graph` /
  `src/graph-builder` 文件
- `~/.spectra-baselines/**` 任何路径——一个字节不动，避免与 F214 运行中的 nanoGPT 采集进程竞写
- 产品源码（`src/**`）——本修复纯测试基建，无产品行为变化

## Codebase Reality Check

| 目标文件 | LOC | 关键导出/方法数 | 已知 debt |
|---------|-----|----------------|-----------|
| `tests/e2e/helpers/stdio-client.ts` | 121 | 5 导出（`BASELINE_GRAPH`/`MICROGRAD_SOURCE`/`installRelativizedBaseline`/`buildSkipCondition`/`buildSkipReason`/`spawnMcpClient`）| 无 TODO/FIXME；单一职责，无需前置 cleanup |
| `tests/integration/mcp-server-stdio.test.ts` | 234 | 1 个 describe 套件，locally 复制 `writeRelativizedBaseline` | 与 helper 逻辑重复（历史遗留，非本次范围，不顺手重构） |
| `tests/integration/agent-context-real-graph.test.ts` | 197 | 1 个 describe 套件，locally 复制相对化逻辑（无独立函数封装）| 同上，重复但不在本次改动范围内消除 |
| `tests/fixtures/micrograd-baseline-graph/graph.json`（新增）| ~预计 400-600（38 节点/14 边格式化 JSON）| N/A（静态 fixture）| N/A |

均远低于 500 LOC 前置清理阈值，且改动量均 < 20 行/文件，不触发 `[CLEANUP]` 前置任务。

## Impact Assessment

- **直接修改文件数**：4（3 个读侧文件 + 1 个新 fixture 目录含 2 个新文件）
- **间接受影响（消费方，断言零改动，但需实跑验证行为一致）**：6 个测试文件
  1. `tests/e2e/feature-180-graph-tools.e2e.test.ts`
  2. `tests/e2e/feature-180-file-nav-stdio.e2e.test.ts`
  3. `tests/e2e/feature-180-symbol-chain.e2e.test.ts`
  4. `tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts`
  5. `tests/integration/mcp-server-stdio.test.ts`（既是直接修改也是消费方，自身即测试套件）
  6. `tests/integration/agent-context-real-graph.test.ts`（同上）
  - 附带验证（非原始 8 用例失败清单成员，但同经 `installRelativizedBaseline` 链路，一并纳入回归观察）：
    `tests/e2e/feature-180-telemetry.e2e.test.ts`
- **跨包影响**：无。全部改动局限在 `tests/` 目录内，不跨越 `plugins/` / `src/` / `scripts/` 顶层边界
- **数据迁移**：无 schema / 配置格式 / 状态文件格式变更；新增的是测试 fixture 静态快照
- **API / 契约变更**：无。不修改任何公共接口、MCP tool 契约、CLI 参数
- **风险等级：LOW**（影响文件 < 10，无跨包影响，无数据迁移，无公共 API 契约变更）
- 不触发 HIGH 风险强制分阶段规则；单阶段交付即可

## 变更清单（精确到文件）

### 1. 新增 `tests/fixtures/micrograd-baseline-graph/graph.json`
- 生成方式：micrograd 源 clone（commit `c911406e5ace8742e5841a7e0df113ecb5d54685`）的**临时拷贝**（剔除
  clone 内 `specs/`、`Users/` 等杂质目录）上跑
  `node dist/cli/index.js batch <临时拷贝路径> --mode graph-only --output-dir <临时输出路径>`，取
  `_meta/graph.json` 冻结落盘
- 已实证：38 节点/14 边，含 5 个 `#` 类级节点（`micrograd/nn.py#MLP`、`micrograd/nn.py#Layer`、
  `micrograd/nn.py#Neuron`、`micrograd/nn.py#Module`、`micrograd/engine.py#Value`）+ 28 个 `::` 成员节点
  （含 `micrograd/engine.py::Value.relu`），与 F214 T001a master HEAD 快照的节点/边集合完全相等
- 节点/边 id 均为 repo-relative POSIX（生成时的临时拷贝路径不构成前缀，产物本身已是相对 id）——
  `installRelativizedBaseline` 对其调用 `relativizeSymbolId` 时按幂等分支直接返回原值（见下方回归风险
  1 的验证）

### 2. 新增 `tests/fixtures/micrograd-baseline-graph/README.md`
必含字段：
- **来源**：micrograd clone commit hash + 生成时间
- **生成命令**：完整可复制的 `batch --mode graph-only` 命令（含前置临时拷贝步骤说明）
- **再生步骤**：供未来任何一方（含 F214）一键重生成的 shell 片段
- **F214 交接注记**：F214 落地 canonical `::` 统一（T028 fail-fast 拒绝 `#` fixture）时，必须
  **同步用其新 dist 重生成本 fixture** 并翻转 4 个 E2E 文件的 `#` 断言为 `::`；否则 helper 会对
  本 fixture（含 `#`）报 legacy-format 错误
- **职责边界**：与 `tests/fixtures/micrograd/`（F140 手写 mini 快照）是不同目录、不同职责，不可混用

### 3. `tests/e2e/helpers/stdio-client.ts`
```diff
 export const BASELINE_GRAPH = join(
-  homedir(),
-  '.spectra-baselines',
-  'micrograd-output',
-  'spectra-full',
-  '_meta',
-  'graph.json',
+  PROJECT_ROOT,
+  'tests',
+  'fixtures',
+  'micrograd-baseline-graph',
+  'graph.json',
 );
 export const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');
```
```diff
 export function buildSkipCondition(requireBaseline: boolean): boolean {
   if (!existsSync(DIST_CLI)) return true;
-  if (requireBaseline && !existsSync(BASELINE_GRAPH)) return true;
+  if (requireBaseline && !existsSync(MICROGRAD_SOURCE)) return true;
   return false;
 }

 export function buildSkipReason(requireBaseline: boolean): string {
   const reasons: string[] = [];
   if (!existsSync(DIST_CLI)) reasons.push(`dist/cli/index.js 不存在（先 npm run build）`);
-  if (requireBaseline && !existsSync(BASELINE_GRAPH)) {
-    reasons.push(`micrograd baseline 不存在 (${BASELINE_GRAPH})`);
+  if (requireBaseline && !existsSync(MICROGRAD_SOURCE)) {
+    reasons.push(`micrograd source clone 不存在 (${MICROGRAD_SOURCE})`);
   }
   return reasons.join('; ');
 }
```
`installRelativizedBaseline` 函数体不变（仍 `readFileSync(BASELINE_GRAPH, ...)`，因常量已 repoint 自动生效；`base` 默认参数不变，因幂等分支使其对相对 id 无操作）。`homedir` import 保留（`MICROGRAD_SOURCE` 仍需要）。

### 4. `tests/integration/mcp-server-stdio.test.ts`
```diff
 const BASELINE_GRAPH = join(
-  homedir(),
-  '.spectra-baselines',
-  'micrograd-output',
-  'spectra-full',
-  '_meta',
-  'graph.json',
+  PROJECT_ROOT,
+  'tests',
+  'fixtures',
+  'micrograd-baseline-graph',
+  'graph.json',
 );
 const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');

 const HAS_DIST = existsSync(DIST_CLI);
-const HAS_BASELINE = existsSync(BASELINE_GRAPH);
+const HAS_BASELINE = existsSync(MICROGRAD_SOURCE);
 const SHOULD_SKIP = !HAS_DIST || !HAS_BASELINE;

 const SKIP_REASON = [
   !HAS_DIST ? `dist/cli/index.js 不存在（先 npm run build）` : '',
-  !HAS_BASELINE ? `micrograd baseline 不存在 (${BASELINE_GRAPH})` : '',
+  !HAS_BASELINE ? `micrograd source clone 不存在 (${MICROGRAD_SOURCE})` : '',
 ].filter(Boolean).join('; ');
```
`PROJECT_ROOT` 已在该文件顶部定义（L22），无需新增 import。`writeRelativizedBaseline` 函数体不变
（读 `BASELINE_GRAPH` 常量已自动指向新 fixture）。

### 5. `tests/integration/agent-context-real-graph.test.ts`
```diff
-import { join } from 'node:path';
+import { join, resolve } from 'node:path';
...
+const PROJECT_ROOT = resolve('.');
-const BASELINE_GRAPH = join(homedir(), '.spectra-baselines', 'micrograd-output', 'spectra-full', '_meta', 'graph.json');
+const BASELINE_GRAPH = join(PROJECT_ROOT, 'tests', 'fixtures', 'micrograd-baseline-graph', 'graph.json');
 const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');
-const HAS_BASELINE = existsSync(BASELINE_GRAPH);
+const HAS_BASELINE = existsSync(MICROGRAD_SOURCE);
```
该文件不 copy `.py` 源文件（只用 `MICROGRAD_SOURCE` 作 `relativizeSymbolId` 的 `base` 参数字符串，
无文件系统读取），语义调整后与其余 5 个文件保持统一的 skip 判定口径（跨文件一致性优先于单文件最小化，
避免 6 个消费文件出现两套不同 skip 语义造成未来维护混淆）。

## 回归风险点与验证映射

| 风险点 | 说明 | 验证方式 |
|--------|------|---------|
| R1 — `installRelativizedBaseline` 对已相对 id 的幂等性 | 新 fixture 节点/边 id 已是相对 POSIX；`relativizeSymbolId`→`relativizePosix` 对非绝对路径直接原样返回（`path.isAbsolute` 分支短路），理论上应为 no-op | 已静态核实源码逻辑（`src/knowledge-graph/relativize.ts` L69-73）；实跑 6 个消费文件确认输出 id 与断言字符串（如 `micrograd/engine.py::Value.relu`）逐一匹配，非仅"不报错" |
| R2 — graph-only 稀疏图（14 边）vs 历史 full 图字段覆盖 | `graph_path` 类断言历史上宽松（无路径也算成功），但 symbol-chain 的 `detect_changes→impact→context` 链、agent-context 的 C-202（nn.py ≥2 symbols 双格式）、C-202b（minConfidence 过滤）、view-file-fuzzy 依赖字段尚未逐条复核 | 逐个实跑上述 4 个测试文件，人工核对每条 assertion 而非只看 exit code |
| R3 — skip 语义变化后的"无 clone 机器"行为 | 6 个消费文件在 `MICROGRAD_SOURCE` 不存在的机器上应整体 `describe.skipIf` 跳过，而非因 fixture 缺失单独报错 | 用 `HOME` 环境变量遮蔽模拟 clone 缺失场景跑一次（`FAKE_HOME=$(mktemp -d) && HOME="$FAKE_HOME" npx vitest run ...`），确认 6 文件全部 skip（非 error/fail）。**注**：`SPECTRA_BASELINE_HOME` 是 `scripts/baseline-collect.mjs` 采集脚本读取的环境变量，与本次 helper 无关——`MICROGRAD_SOURCE` 常量固定用 `homedir()`（`node:os`），不读任何环境变量，因此实际采用 `HOME` 遮蔽法（`os.homedir()` 遵循 `$HOME`）而非设置 `SPECTRA_BASELINE_HOME` |
| R4 — 共享 home 零写入保证 | 修复方案的核心前提是全程不碰 `~/.spectra-baselines/**` | 改动前后对该目录树做递归 hash（如 `find ~/.spectra-baselines -type f -exec sha256sum {} \; \| sort \| sha256sum`）比对，两轮全量 vitest 前后一致 |
| R5 — fixture 与 in-repo 常量路径的可移植性 | `BASELINE_GRAPH` 从 `homedir()` 改为 `PROJECT_ROOT` 相对路径后，多 worktree 并行、CI checkout 等场景需保证一致可达 | fixture 随 git 提交，`PROJECT_ROOT = resolve('.')` 在任意 worktree 均指向该 worktree 自身 `tests/fixtures/`，天然无跨 worktree 耦合问题（前提：vitest 以仓库根为 cwd 运行——本仓库 `vitest.config` 未覆盖 `root`，默认以执行 `npx vitest` 时的 shell cwd 为准，CI/本地惯例均在仓库根执行） |

## 验证方案

**前置**：dist 已构建（本次改动不涉及 `src/**`，理论上无需重新 `npm run build`；若 CI/干净环境执行需先跑一次确保 `dist/cli/index.js` 存在）。

1. **逐文件消费方验证**（6 个 + 1 个附带观察，共 7 个文件独立跑，逐条核对 assertion 而非只看通过数）：
   ```bash
   npx vitest run tests/integration/mcp-server-stdio.test.ts
   npx vitest run tests/integration/agent-context-real-graph.test.ts
   npx vitest run tests/e2e/feature-180-graph-tools.e2e.test.ts
   npx vitest run tests/e2e/feature-180-file-nav-stdio.e2e.test.ts
   npx vitest run tests/e2e/feature-180-symbol-chain.e2e.test.ts
   npx vitest run tests/e2e/feature-184-view-file-fuzzy.e2e.test.ts
   npx vitest run tests/e2e/feature-180-telemetry.e2e.test.ts
   ```
2. **共享 home 零写入实证**（R4）：改动前记录 `~/.spectra-baselines` 目录树 hash（若 F214 采集仍在跑，
   选择其空闲窗口采样，避免把对方进行中的合法写入误判为本修复引入的写入），执行步骤 1 与步骤 3 后再次
   采样比对，确认无本修复相关的写入（F214 自身仍在跑的合法写入不计为回归，需人工区分写入来源，如按
   mtime 是否落在本次 vitest 执行区间且非 F214 相关子目录）
3. **全量回归两轮**：
   ```bash
   npx vitest run   # 第一轮
   npx vitest run   # 第二轮（确认非偶发/幂等）
   ```
   对比 F213 基线 5079 pass。已知负载 flaky 名单（`watch-command` / `community-analysis` perf /
   `cli-e2e --version` / `batch-orchestrator-incremental`）若失败，隔离单独重跑定性，不计入本次回归判断。
4. **无 clone 环境模拟**（R3）：临时环境变量或改名遮蔽 `MICROGRAD_SOURCE`，确认 7 个消费文件全部
   `skip` 而非 `error`/`fail`。
5. **`npm run build` + `npx tsc --noEmit`**（若上述 diff 引入 TS 变更，如 `agent-context-real-graph.test.ts`
   新增 `resolve` import）确认类型检查零错误。

**验收标准**：
- 原 8 个失败用例转绿
- 全量 vitest 两轮结果一致，通过数不低于 F213 基线（已知 flaky 除外）
- `~/.spectra-baselines/**` 目录树 hash 在本修复相关操作前后无变化（F214 并行写入除外，需可解释归因）
- 无 clone 环境下 7 个消费文件整体 skip，不产生新的 error

## 回滚与交接

- **回滚**：本次改动全部局限在 `tests/` 目录且不改变产品行为，`git revert` 单 commit 即可完全回滚，
  无残留状态（不涉及数据库/配置迁移）
- **F214 交接**（已记录于 fixture README，此处重申）：F214 T028（legacy `#` fixture fail-fast）与 T029
  （baseline 重采集）落地时，必须用其新 dist 重生成 `tests/fixtures/micrograd-baseline-graph/graph.json`
  并同步翻转 4 个 E2E 文件的 `#` 断言为 `::`；否则本 fixture 会被 F214 自己的 fail-fast 机制拒绝，
  再次复现本次修复要解决的"消费方直读易漂移产物"问题的变种

## Constitution Check

*基于 `.specify/memory/constitution.md`（版本 2.2.0）逐条评估；本修复为纯测试基建改动，不涉及
`src/`（Plugin: spectra 约束区）或 `plugins/spec-driver/`（Plugin: spec-driver 约束区）*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本 plan.md 及 fix-report.md 均中文散文 + 英文代码标识符，符合规范 |
| II. Spec-Driven Development | 适用 | PASS | 走 fix 模式完整链路（fix-report.md → plan.md → tasks.md → 实现 → 验证），未绕过流程直改源码 |
| III. YAGNI / 奥卡姆剃刀 | 适用 | PASS | 未引入新抽象层；仅 repoint 3 处既有常量 + 语义微调 2 个既有函数，无新组件、无新配置项。方案 A 相比方案 B/C 更简单（不侵入 F214 范围，不重建共享态） |
| IV. 诚实标注不确定性 | 适用 | PASS | fix-report.md 5-Why 每层均标注证据来源；graph-only 稀疏图字段覆盖标为待实跑验证的风险点（R2），未以确定性口吻断言未验证事实 |
| V-VIII（Plugin: spectra 约束）| 不适用 | N/A | 本次改动不触及 `src/` 下 TypeScript 源代码，未修改 AST 提取、混合分析流水线、纯 Node.js 生态等 spectra 运行时行为 |
| VII. 只读安全性（补充说明）| 部分相关 | PASS | 该原则约束 spectra 工具*分析目标代码时*的只读边界；本次是维护自身测试代码库，非工具运行时行为，但精神一致：不写入源文件，新增的 fixture 生成命令仅对**临时拷贝**执行、不写回 clone 源、不写回 `~/.spectra-baselines/**` |
| IX-XIV（Plugin: spec-driver 约束）| 不适用 | N/A | 本次改动不触及 `plugins/spec-driver/` 下 Prompt/YAML/脚本 |
| 输出质量门控（spec-driver）| 适用 | PASS | 制品链完整（fix-report.md → plan.md → 待生成 tasks.md → verification）；验证方案要求实际命令输出而非推测性声明，对齐"验证铁律"精神 |

**结论**：无 VIOLATION 项，无需 Complexity Tracking / 豁免论证。

## Non-Goals（显式排除，防止范围蔓延）

- 不做 `#`/`::` symbol id 统一（F214 范围）
- 不重构 `mcp-server-stdio.test.ts` / `agent-context-real-graph.test.ts` 中与 helper 重复的相对化逻辑
  （历史技术债，不在本次 fix 顺手清理，避免与 F214 改动面冲突）
- 不改变任何产品源码行为
- 不对 `~/.spectra-baselines/**` 做任何写入或恢复操作
