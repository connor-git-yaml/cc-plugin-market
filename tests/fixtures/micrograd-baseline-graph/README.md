# micrograd-baseline-graph fixture

## 用途

`graph.json` 是 6 个测试文件（4 个 E2E + 2 个集成测试）共同依赖的 pinned baseline 图。
取代了此前直读跨 worktree 共享可变路径 `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json`
的做法（详见 `specs/215-fix-e2e-baseline-decouple/fix-report.md` 的根因分析）。

## 来源

- micrograd 源 clone commit：`c911406e5ace8742e5841a7e0df113ecb5d54685`（`~/.spectra-baselines/micrograd`，
  本次重生成前已校验未漂移）
- 生成时间：2026-07-21（F217 图质量门 P1 metadata 透传修复后重生成）
- **producer commit**（生成本 fixture 时使用的 dist 对应的当前 worktree HEAD）：`1445edf`
  （`claude/graph-quality-gates-3d4451` 分支，F217 P1~P3 交付态——验证 T022/T024 metadata
  透传修复落地；前一版 producer 为 `a542599`，F214 交付态）

## 生成命令

```bash
# 0. 校验源 clone commit 未漂移（若不一致，先更新上方「来源」的 commit hash 再继续）
test "$(git -C ~/.spectra-baselines/micrograd rev-parse HEAD)" = "c911406e5ace8742e5841a7e0df113ecb5d54685" \
  && echo "clone commit 校验通过" || echo "警告：clone commit 已漂移，需先更新本 README 的 provenance 记录"

# 1. 只读拷贝源 clone 到临时目录，剔除 specs/、Users/ 等杂质目录
TMPCOPY=$(mktemp -d)
rsync -a --exclude='specs' --exclude='Users' --exclude='.git' ~/.spectra-baselines/micrograd/ "$TMPCOPY/"

# 2. 用当前 dist 对临时拷贝跑纯 AST · 零 LLM 的 graph-only 批处理
TMPOUT=$(mktemp -d)
node dist/cli/index.js batch "$TMPCOPY" --mode graph-only --output-dir "$TMPOUT"

# 3. 冻结落盘
cp "$TMPOUT/_meta/graph.json" tests/fixtures/micrograd-baseline-graph/graph.json
```

## 实证数据（F217 重生成后）

- 33 节点 / 37 边（links：contains 28 + calls 7 + depends-on 2）——与前一版（F214 producer
  `a542599`）**节点/边计数完全相同**，符合预期（F217 P1 只新增 metadata 字段，不改变
  节点/边生成逻辑）
- **零 `#` 节点**：F214 canonical ID 收敛结论延续，未受本次改动影响
- contains 边覆盖 module→class→member 两级层级（F214 deriveContainsEdges 产出），未变
- 节点/边 id 均为 repo-relative POSIX（临时拷贝路径不构成前缀）
- **本次改动逐条归因**（`git diff tests/fixtures/micrograd-baseline-graph/graph.json` 实测，
  仅 metadata 字段级新增/回填，零 id/label/kind/edge 变化）：
  - `sourceCommit: null` 新增顶层字段（F217 T003；本 fixture 的 rsync 临时拷贝本就无
    `.git`，`resolveSourceCommit` 向上找不到仓库，返回 `null` 属预期，非异常）
  - 9 个此前缺失 `unifiedKind` 的既有节点（existing-node 合并分支未补齐的 bug，F217 T024
    修复）现已补齐：4 个 module 文件节点（`micrograd/__init__.py`/`engine.py`/`nn.py`/
    `setup.py`）→ `unifiedKind: 'module'`；5 个 Python 顶层 class 节点（`Value`/`Layer`/
    `MLP`/`Module`/`Neuron`）→ `unifiedKind: 'symbol'` + `exportKind: 'class'`。这是
    P1 T024 修复生效的直接证据——修复前这 5 个顶层 class 因走 Python `extractSymbolNodes`
    的 `existing` 合并分支（`sourceTag:'extraction'`），未被 `deriveNodesFromSkeletons`
    首路写入覆盖，导致 `unifiedKind` 缺失，会使 contains-coverage/orphan 分母缩水
  - 2 个 `test/test_engine.py` 下的自由函数节点（`test_more_ops`/`test_sanity_check`）
    新增 `exportKind: 'function'`（F217 T022 metadata 透传）
  - 21 个 class 成员节点（method/property）新增 `memberKind`（11 个 `method` + 10 个
    `property`，F217 T022 metadata 透传）
  - 合计 7 个 symbol 节点获得 `exportKind`，21 个 symbol 节点获得 `memberKind`（共 28 个
    symbol 节点全部覆盖，无遗漏；5 个 module 节点不适用 exportKind/memberKind）
- 前一版（producer 35b285d → F214 producer a542599）的 38 节点/14 边 → 33 节点/37 边变更
  归因见 `specs/214-graph-topology-canonical-id/verification/T035-attribution-report.md`
  （F214 变更，与本次 F217 重生成无关，仅作历史沿革记录）

## 再生步骤

如需重新生成本 fixture（例如产品侧 batch 输出逻辑变化），直接重跑上方「生成命令」四步（含 commit
校验）。真实前置条件（并非"无需任何前置状态"）：

- `dist/cli/index.js` 已构建（`npm run build`）
- `~/.spectra-baselines/micrograd` 源 clone 已存在（见 `scripts/baselines/clone-baseline-projects.sh`
  或手动 `git clone`）
- `rsync` 命令可用（macOS/Linux 默认自带；纯 Windows 环境需另装）

## skip 语义反转说明

F215 之前，6 个消费文件的 skip 条件是"`BASELINE_GRAPH`（共享 home 路径）存在"；F215 起改为
"`MICROGRAD_SOURCE`（`~/.spectra-baselines/micrograd` 源 clone）存在"。这意味着：**已 clone
micrograd 源码、但从未跑过 `npm run baseline:collect` 生成过 `micrograd-output` 的机器**，
此前这 6 个文件会因 `BASELINE_GRAPH` 缺失而整体 skip；F215 之后由于 `graph.json` 已是恒存在的
in-repo fixture，只要源 clone 存在即会**实跑**。这是预期改进（收窄了"需要额外跑一次 baseline
collect 才能测"的门槛），不是回归；若某台机器此前长期依赖"未跑过 baseline collect → 静默 skip"
的行为，需注意该机器上这 6 个文件会从 skip 变为实跑。

## F214 交接注记（已完成）

F214（`graph-topology-canonical-id`）统一 symbol id 为纯 `::` 格式，其 T028 为 legacy `#`
fixture 加了 fail-fast 校验（`installRelativizedBaseline` 拒绝含 legacy `#` symbol 节点的
输入）。**本注记的两项交接要求均已在 F214 交付时完成**：(1) 本 fixture 已用 F214 dist
重生成（见上方「来源」producer commit）；(2) 4 个 E2E 测试文件（
`feature-180-graph-tools.e2e.test.ts` / `feature-180-file-nav-stdio.e2e.test.ts` /
`feature-180-symbol-chain.e2e.test.ts` / `feature-184-view-file-fuzzy.e2e.test.ts`）的
`#` 断言已翻转为 `::`（F214 T030）。

**重生成后必须重跑 F215 tasks.md T006 的验证方法论**：不能只看 exit code / pass count，
须逐文件（`tests/integration/mcp-server-stdio.test.ts`、`tests/integration/agent-context-real-graph.test.ts`、
4 个 E2E 文件、`feature-180-telemetry.e2e.test.ts`）单独跑，人工核对具体 assertion（尤其是
R1 幂等性——输出 id 与断言字符串逐一匹配；R2 字段覆盖——`detect_changes→impact→context` 链、
C-202/C-202b 等断言、view-file-fuzzy 依赖字段），详见
`specs/215-fix-e2e-baseline-decouple/tasks.md` T006 与 `plan.md` 的「回归风险点与验证映射」节。

## 已知偏差（已随 F214 消除）

前一版 fixture（producer 35b285d）中 5 条 `contains` 边缺少 `directional: true` 字段
（producer 既存缺陷）。F214 重写 contains 边生产路径（`deriveContainsEdges` 经
graph-builder 第五路合并）后，本 fixture 重生成版本中**全部 28 条 contains 边均带
`directional` 字段**，该偏差按预期自然消除，无手工修改。当前无已知偏差。

与 `tests/fixtures/micrograd/`（Feature 140 手写 mini 快照，用于其他单元测试）是**不同目录、
不同职责**，两者不可混用。本 fixture 专供依赖完整 micrograd 全量图（33 节点/37 边）的
E2E / 集成测试消费。
