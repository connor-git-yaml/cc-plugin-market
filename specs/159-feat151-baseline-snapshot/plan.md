# Feature 159 Plan — Layer B snapshot 录制 + NFR baseline:diff 性能验证

**Feature**: 159-feat151-baseline-snapshot
**Branch**: claude/elated-chebyshev-ac33b6（worktree elated-chebyshev-ac33b6）
**Created**: 2026-05-09
**Spec**: [spec.md](./spec.md)

---

## 1. 总体策略

本 Feature 的核心是 **跑批 + 录 fixture + 写 report**，不动产品代码。整体分 4 大块：

| 块 | 工时（编排器侧） | 实际跑批耗时 | LLM cost | 描述 |
|----|----|----|----|----|
| **Block A — 前置 build + 环境校验** | ~2 min | 0 | 0 | `npm run build` + ANTHROPIC_API_KEY 校验 + `--dry-run` 探活 |
| **Block B — micrograd + nanoGPT baseline:collect**（小型，可前后台同步）| ~5 min（脚本调度）| ~24 min（21 + 3）| ~$2.7 | 串行跑两个小 baseline，跑完即可对比，验证流程通畅 |
| **Block C — self-dogfood baseline:collect**（大型，必须 background）| ~3 min（脚本调度）| ~30 min | ~$9.86 | 单跑 self-dogfood，跑完后录 Layer B fixture + 入库 |
| **Block D — Layer B snapshot + baseline:diff + §11 报告** | ~30 min | 0 | 0 | 归一化 graph.json → fixture、改 test、跑 vitest 录 snapshot、3 份 baseline:diff、写 §11、改 Feature 151 verification report |

**总耗时**：~60 分钟（实际跑批 ≈ 54 min，编排器 ≈ 6 min；可并行做无关工作减少 wallclock）。
**总 LLM cost**：~$12.6（已超用户 $10 预算 $2.6 — 在 Block A 启动前要求用户授权）。

---

## 2. 架构选择（重要）

### 2.1 跑批执行模式：`run_in_background=true` + 串行调度

**理由**：
- self-dogfood 单跑 ~30 min > Bash 工具 10 min 上限 → 必须 background
- micrograd 单跑 ~3 min、nanoGPT ~21 min — micrograd 可同步跑，nanoGPT 必须 background
- 3 个 baseline 不能并发：避免 Anthropic API rate limit 429 + 进程 OOM + 输出日志混淆
- 编排器在等待跑批期间做"无关工作"：(1) 写归一化脚本草稿；(2) 准备 §11 模板；(3) 起草 verification report

**调度方式**：用 Bash `run_in_background=true` 启动单个 baseline:collect → 等待完成通知 → 读取 stdout/stderr 校验 exit code → 进入下一个 baseline。

### 2.2 fixture 路径与归一化

**Layer B 测试 fixture**：

```text
tests/integration/__fixtures__/self-dogfood-graph.json    ← 入库（归一化后）
```

新建 `tests/integration/__fixtures__/` 目录（如不存在）。该路径已纳入 `.gitignore` 黑名单审计（按 CLAUDE.local.md "入库 vs 不入库边界"）。

**归一化字段**（在拷贝时手动 strip 或固定为 placeholder）：

| 字段 | 处理 | 来源/理由 |
|------|------|----------|
| `graph.generatedAt` | 固定为 `"2026-05-09T00:00:00.000Z"` | ISO 时间戳，每次跑都不同 |
| `graph.inputHash` | **固定为 `"<normalized>"`**（**Codex C-3 修订**）| 由 docGraph.generatedAt + architectureIR.generatedAt 计算（见 `src/panoramic/graph/graph-builder.ts:412-424`），每次跑都会变 |
| `nodes[].metadata.currentRun` | 删除（仅运行时元数据） | 实测 graph.json 中节点 metadata 含此字段 |
| `graph.skippedSources[].reason` | 保留（理由文本固定）| 跑当前 master 时不会 skip extraction → 不出现 |
| 其它时间戳 / runId / processId / hash | **必须在归一化脚本中显式 audit** | 跑后比 diff vitest --update 第一次和第二次输出，找到所有时变字段 |

**幂等性硬性验收（Codex C-3 修订）**：归一化脚本写完后必须做 2 步测试：
1. 跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts --update` 一次（落第 1 版 snapshot）
2. 立即重跑 `npx vitest run tests/integration/graph-mcp-snapshot.test.ts`（不带 --update，纯 verify）
3. 必须 0 mismatch；若 mismatch，diff snapshot 找出漏掉的时变字段 → 加入归一化脚本 → 回到 step 1 重做

**归一化脚本**：编排器现写 `scripts/normalize-graph-fixture.mjs`（一次性、~50 行），输入 `graph.json` → 输出归一化版本到 `tests/integration/__fixtures__/`。脚本不入 npm scripts（一次性使用）。

### 2.3 baseline:diff 阈值分层（实施 EC-4）

**SC-3 验收 PASS 条件**（perf 类严格）：

```text
for target in [micrograd, nanoGPT, self-dogfood]:
  diff = baseline:diff <old> <new> --mode regression --format json
  perf_severities = [diff.results[i].severity for i in {totalWallMs, tokensInputPlusOutput, estimatedCostUsd}]
  if any(s == 'red' for s in perf_severities):  # ≥ 20%
    → SC-3b: 阻塞，写 regression-analysis.md
  elif any(s == 'yellow' for s in perf_severities):  # 10%~20%
    → SC-3a: 不阻塞，§11 列出 deltaPct + 接受偏差理由
  else:  # 全 green
    → SC-3 PASS
```

**output.graphNodeCount 不计入 SC-3**：在 §11 表格中标 "expected breaking change" + 实际 deltaPct（informational only）。

### 2.4 Layer A snapshot 不动

按 spec Assumption-1：Layer A MVP fixture 已 sufficient 验证 filterOutCallEdges normalizer，体积膨胀价值低。本 Feature 不切换 Layer A 测试 fixture。

### 2.5 graph_query keyword 选择

self-dogfood 中**结构稳定**的 symbol：
- 首选：`BatchOrchestrator`（src/batch/batch-orchestrator.ts，4.2.0+ 不会改名）
- 备选：`LanguageAdapter`（src/adapters/language-adapter.ts）

实际选用在 implement 阶段根据真实 graph.json node IDs 选择，需要 keyword 在 query result 中能命中至少 1 个真实 src/ 节点 + 1 条 calls 边。

---

## 3. 任务分解 → 见 [tasks.md](./tasks.md)

任务 ID 编号 T-001 ~ T-016；详细分解和依赖关系在 tasks.md。

总体顺序：

```text
T-001 npm run build (前置)
T-002 ANTHROPIC_API_KEY + dry-run 探活
T-003 用户预算授权（人工 gate）
T-004 baseline:collect micrograd → tests/baseline/micrograd/spectra/full.json （新）
T-005 baseline:collect nanoGPT  → tests/baseline/nanoGPT/spectra/full.json  （新）
T-006 baseline:collect self-dogfood → tests/baseline/self-dogfood/spectra/full.json （新）
       + ~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json （副产物）
T-007 graph.json 归一化 → tests/integration/__fixtures__/self-dogfood-graph.json
T-008 改 tests/integration/graph-mcp-snapshot.test.ts Layer B 部分 → 读 fixture
T-009 vitest --update → 录新 Layer B snapshot
T-010 npx vitest run → 验证全测试 0 fail（含 snapshot match）
T-011 baseline:diff × 3 → /tmp/baseline-diff-{micrograd,nanoGPT,self-dogfood}.{txt,json}
T-012 写 specs/147-.../competitive-evaluation-report.md §11
T-013 改 specs/151-knowledge-graph-python/verification/verification-report.md SC-006/NFR-1/NFR-5
T-014 npm run build + repo:check + release:check + tsc --noEmit
T-015 写 specs/157-.../verification/verification-report.md
T-016 spec-review + quality-review + verify (Phase 5 三向审查) + Codex 终审
```

---

## 4. 依赖与风险（呼应 spec Risks）

### 4.1 ANTHROPIC_API_KEY（spec Risk-1，HIGH）

**Plan 处理**：
- T-001 之后立即在 T-002 中 export 校验
- 若 env 中无 key，编排器**主动暂停**告知用户，等待用户在 worktree shell 中 `export ANTHROPIC_API_KEY=...`，再 resume
- 不假设 key 在 .env / shell rc — 必须显式校验（`echo "$ANTHROPIC_API_KEY" | head -c 10`）
- 用 dry-run mode 先做 1 次 LLM 调用探活（baseline-collect.mjs runDryRun），消耗 ~$0.001 验证 key 有效

### 4.2 跑批耗时 + cost 超预算（spec Risk-2 / Risk-3，HIGH）

**Plan 处理**：
- T-003 在 micrograd / nanoGPT / self-dogfood 三个 baseline 启动前，编排器**主动列出实测预算 ~$12.6**（CLAUDE.local.md 标的 ~$10 已过时）+ 实测耗时 ~54 min，请求用户授权
- 用户拒绝（指出超 budget）→ 编排器提供降级方案（spec Risk-3 Mitigation）：
  - 方案 A: 跑 micrograd + nanoGPT 共 ~$2.7（牺牲 self-dogfood 完整性，SC-3 部分达成）
  - 方案 B: self-dogfood 用 `--mode reading` 跳过 LLM（cost 降至 ~$3，但 perf metric 不可比）
  - 方案 C: 完全跳过 baseline:collect，仅录 Layer B snapshot（用 self-dogfood 现存 spectra-full graph.json，但其没有 calls 边 → 跟 spec FR-3 冲突）
- 用户授权 → 进入 T-004 ~ T-006 跑批

### 4.3 跑批失败 / 中途挂掉（Codex WARNING 2 修订：retry 策略量化）

**Plan 处理**：
- 每个 baseline:collect 后立即检查 stdout/stderr 中的 exit code 和 `[baseline] fixture written:` 日志
- 失败信号：429 rate limit / 网络中断 / API key 无效 / 进程 OOM

**按 target 量化的 retry 策略**：

| Target | 失败位置 | 是否允许 retry | 最大额外 cost | 理由 |
|--------|---------|---------------|--------------|------|
| **micrograd** | LLM 批量调用前（dryRun / git checkout 阶段）| 允许立即重试 | 0 | 还没产生 LLM 调用 cost |
| micrograd | LLM 批量调用中或后 | 允许 1 次重试，等 60s | $0.5（重跑全量） | 单跑 cost 低 |
| **nanoGPT** | LLM 批量调用前 | 允许立即重试 | 0 | — |
| nanoGPT | LLM 批量调用中或后 | **不重试** | 0 | 已产生 ~$2.27 cost；先 diagnose log，向用户报告，等决策 |
| **self-dogfood** | LLM 批量调用前 | 允许立即重试 | 0 | — |
| self-dogfood | LLM 批量调用中或后 | **绝不重试** | 0 | 已产生 ~$9.86 cost；diagnose log + 报告用户，等决策 |

**判断"是否进入 LLM 批量"**：检查 `~/.spectra-baselines/<project>-output/<tool>-full/` 是否已有 `.spectra-checkpoint.json`（= 已开始批量）；或 `modules/` 目录下是否已有任何 .spec.md（= LLM 已产出至少 1 个模块）

### 4.4 graph.json 归一化遗漏字段

**Plan 处理**：
- T-007 归一化脚本写完后，先做 1 次"录-重录"幂等性测试：跑 vitest --update 一次 → 立即重跑 vitest run → 0 mismatch 才算通过
- 若发现 mismatch，diff snapshot 找到时变字段，加入归一化清单

### 4.5 Layer A 测试受影响（spec Assumption-1 验证）

**Plan 处理**：
- T-010 跑全 vitest 时，验证 Layer A 6 个 snapshot 仍 1:1 不变（confidence: 改 Layer B fixture 不影响 Layer A，因为 MVP_GRAPH_WITH_CALLS 是独立常量）

---

## 5. 实施步骤明细

### Block A — 前置 build + 环境校验（~2 min）

#### T-001 build dist
```bash
npm run build
test -f dist/cli/index.js
```

#### T-002 认证校验 + auth-status --verify probe（Codex W-3 修订 + skip-batch 误用修订）

**关键修订（2026-05-09 实测）**：
- ANTHROPIC_API_KEY 不是必需 — `src/core/llm-client.ts` 错误消息明确："请设置 ANTHROPIC_API_KEY，或登录 Claude Code / Codex CLI"。Spectra 通过 Claude CLI 子进程跑 LLM 是合法 fallback；当前 `auth-status --verify` 显示 Claude CLI 已登录可用
- `baseline-collect.mjs --skip-batch` **会覆盖现有 fixture** 为 skeleton（perf 字段全 null）！不是"只验证脚本可执行"。**禁止在 T-002 中使用**

```bash
node dist/cli/index.js auth-status --verify  # 在线校验认证（API key 或 Claude CLI 或 Codex CLI 三条路任一可用即 PASS）
# 输出含 "✓ Claude CLI: ... 已验证可用" 即可（无需 ANTHROPIC_API_KEY）
```

**T-002 不再调用 baseline-collect.mjs**（避免 skip-batch 副作用）。脚本可执行性验证延后到 T-004 第一次实跑时自然验证。

#### T-003 用户预算授权 + 跨度差异告知（人工 gate）

编排器输出：
```text
[预算确认] 即将启动 3 个 baseline:collect 跑批

  cost / 时长（基于旧 fixture 实测推算）:
  - micrograd:    ≈ 3 min,  ~$0.5  (旧 fixture token/cost 字段为 null，按 LOC 推算)
  - nanoGPT:      ≈ 21 min, $2.27
  - self-dogfood: ≈ 30 min, $9.86
  累计:           ≈ 54 min, $12.6  （超用户原始 $10 预算 $2.6）

  旧 fixture 来源 commit（Codex C-1 实证）:
  - micrograd:    8959669 (Feature 155 M3 时点) — 跨 1 commit (only Feature 156)
  - nanoGPT:      0449d2b (Feature 147 sprint3 A+B) — 跨 9 commits (148~156)
  - self-dogfood: 0449d2b — 跨 9 commits

  跨度差异 → SC-3 阈值预期:
  - micrograd:    perf delta 大概率 green (≤10%)
  - nanoGPT:      perf delta 大概率 yellow/red（9 feature 累计变更）
  - self-dogfood: perf delta 大概率 yellow/red（9 feature 累计变更）
  → 后两者出现 yellow/red 不代表"Feature 151~156 引入了回归"，是跨 9 feature 的合理累积变化

  Codex W-4 选项 — micrograd N=1 vs N=3:
  - 当前 plan: N=1 (cost ≈ $0.5)
  - 升级 N=3 取中位数: cost ≈ $1.5 (+$1)，更稳定但更贵
  - 推荐: 默认 N=1；若用户要严格 NFR 数据，选 N=3

请确认是否继续？[ continue | partial | abort ]
  - continue:  全部 3 个跑（N=1，预算 $12.6）
  - continue+repeat: micrograd N=3 + nanoGPT/self-dogfood N=1（预算 $13.6）
  - partial:   仅跑 micrograd + nanoGPT（共 $2.7），self-dogfood 用现有旧版（牺牲 SC-1 + 部分 SC-3 self-dogfood 行）
  - abort:     放弃，回退本 Feature
```

等待用户确认。

### Block B — 小型 baseline（~24 min 实际跑批）

#### T-004 baseline:collect micrograd
```bash
# Bash run_in_background=true 启动；等通知；校验 exit=0；fixture written
node scripts/baseline-collect.mjs --target karpathy/micrograd --mode full
```
预期产物：
- `tests/baseline/micrograd/spectra/full.json` 更新
- `~/.spectra-baselines/micrograd-output/spectra-full/_meta/graph.json` 更新

#### T-005 baseline:collect nanoGPT
```bash
node scripts/baseline-collect.mjs --target karpathy/nanoGPT --mode full
```

### Block C — self-dogfood（~30 min 实际跑批）

#### T-006 baseline:collect self-dogfood
```bash
node scripts/baseline-collect.mjs --target self-dogfood --mode full
```
预期产物：
- `tests/baseline/self-dogfood/spectra/full.json` 更新
- `~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json` 更新（含 calls 边）

### Block D — Snapshot 录制 + diff + report（~30 min 编排器侧）

#### T-007 graph.json 归一化（编排器写归一化脚本，Codex C-3 修订）

```javascript
// scripts/normalize-graph-fixture.mjs（新建，一次性）
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = process.argv[2];
const dst = process.argv[3];
const g = JSON.parse(fs.readFileSync(src, 'utf-8'));

// 归一化时变字段（Codex C-3 修订：必须包含 inputHash）
if (g.graph?.generatedAt) g.graph.generatedAt = '2026-05-09T00:00:00.000Z';
if (g.graph?.inputHash !== undefined) g.graph.inputHash = '<normalized>';

// 节点 metadata 中的运行时字段
for (const n of g.nodes ?? []) {
  if (n.metadata) {
    delete n.metadata.currentRun;
    // 后续 audit：根据"录-重录"幂等性测试结果加更多字段
  }
}

// 边 metadata 中的运行时字段（如有）
for (const e of g.links ?? []) {
  if (e.metadata) {
    // audit 占位：跑后看是否有时变字段
  }
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(g, null, 2) + '\n', 'utf-8');
console.log(`normalized: ${src} → ${dst}`);
```

执行：
```bash
mkdir -p tests/integration/__fixtures__
node scripts/normalize-graph-fixture.mjs \
  ~/.spectra-baselines/self-dogfood-output/spectra-full/_meta/graph.json \
  tests/integration/__fixtures__/self-dogfood-graph.json
```

#### T-008 改 tests/integration/graph-mcp-snapshot.test.ts

修改 `Layer B` describe 块：

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

const SELF_DOGFOOD_GRAPH: GraphJSON = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '__fixtures__/self-dogfood-graph.json'),
    'utf-8'
  )
);

function buildLayerBSelfDogfoodEngine(): GraphQueryEngine {
  return GraphQueryEngine.fromJSON(SELF_DOGFOOD_GRAPH);
}

describe('graph MCP tools snapshot — Layer B (self-dogfood, calls-enabled, P3 T-016b)', () => {
  const engine = buildLayerBSelfDogfoodEngine();

  it('graph_query keyword=BatchOrchestrator — Layer B 含真实 src/ 节点 + calls 边（W-2 路径限定）', () => {
    const result = engine.query('BatchOrchestrator', { budget: 30 });
    expect(result).toMatchSnapshot('layer-b-self-dogfood-graph_query');
    // 真实数据应含 ≥ 1 src/ 路径节点（不是 tests/fixtures 下的 .py）
    const hasSrcNode = result.nodes.some((n) => n.id.startsWith('src/') || n.id.includes('/src/'));
    expect(hasSrcNode).toBe(true);
    // Codex W-2：calls 边断言必须限定端点落在 src/，避免 fixtures 误满足
    const hasSrcCallsEdge = result.edges.some(
      (e) =>
        e.relation === 'calls' &&
        ((typeof e.source === 'string' && (e.source.startsWith('src/') || e.source.includes('/src/'))) ||
          (typeof e.target === 'string' && (e.target.startsWith('src/') || e.target.includes('/src/'))))
    );
    expect(hasSrcCallsEdge).toBe(true);
  });

  it('graph_god_nodes top=5 — Layer B degree 受 calls 影响', () => {
    const result = engine.getGodNodes(5);
    expect(result).toMatchSnapshot('layer-b-self-dogfood-graph_god_nodes');
  });
});

// **不 rename** 原 Layer B (MVP fixture) describe 块（避免 vitest snapshot key 变更）
// 原 Layer B (calls-enabled, 首版基线) 2 个 snapshot 保持不变
// 新增 self-dogfood 独立 describe 块即可 → 总 6 (Layer A) + 2 (Layer B MVP) + 2 (Layer B self-dogfood) = 10 snapshot
```

#### T-009 vitest --update 录新 snapshot

```bash
npx vitest run tests/integration/graph-mcp-snapshot.test.ts --update
```

#### T-010 全测试 0 fail + git diff 防护（Codex WARNING 1 修订）

```bash
# Codex W-1 防护：vitest --update 后立即检查 snapshot diff
# Layer A 6 个 export 必须无 diff，只允许新增 self-dogfood Layer B 行
git diff --no-color -- tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap \
  > /tmp/feat-157-snapshot.diff
# 失败信号：snapshot diff 中存在被删除的 Layer A 或 Layer B (MVP/首版基线) export
if grep -E "^-exports\[.*Layer (A|B \(calls-enabled, 首版基线\))" /tmp/feat-157-snapshot.diff; then
  echo "FATAL: vitest --update 误改了 Layer A 或 Layer B (MVP) snapshot"
  exit 1
fi

npx vitest run  # 全 3155+ 单测 + 新 snapshot
npx vitest run  # 第 2 次：幂等性验证（SC-2）；2 次都 0 fail 才算通过
```

#### T-011 baseline:diff × 3（Codex WARNING 4 修订：与 tasks.md 一致，跨 commit 来源不同）

```bash
mkdir -p /tmp/feat-157-diff

# Codex C-1 修订：每个 baseline 旧 fixture 来自不同 commit
git show 8959669:tests/baseline/micrograd/spectra/full.json   > /tmp/feat-157-diff/old-micrograd.json
git show 0449d2b:tests/baseline/nanoGPT/spectra/full.json     > /tmp/feat-157-diff/old-nanoGPT.json
git show 0449d2b:tests/baseline/self-dogfood/spectra/full.json > /tmp/feat-157-diff/old-self-dogfood.json

for project in micrograd nanoGPT self-dogfood; do
  cp tests/baseline/$project/spectra/full.json /tmp/feat-157-diff/new-$project.json

  # text 输出（人读）
  npm run baseline:diff -- /tmp/feat-157-diff/old-$project.json /tmp/feat-157-diff/new-$project.json \
    > specs/159-feat151-baseline-snapshot/verification/baseline-diff-$project.txt 2>&1 || true

  # json 输出（机器读，喂给 §11 报告生成）
  npm run baseline:diff -- /tmp/feat-157-diff/old-$project.json /tmp/feat-157-diff/new-$project.json --format json \
    > specs/159-feat151-baseline-snapshot/verification/baseline-diff-$project.json 2>&1 || true
done

# 在 §11 / verification report 中必须记录每个 project 的"内容来源 commit":
#   - micrograd:    8959669 (Feature 155 M3 — 跨 1 commit / Feature 156)
#   - nanoGPT:      0449d2b (Feature 147 sprint3 A+B — 跨 9 commits / 148~156)
#   - self-dogfood: 0449d2b (同上)
```

#### T-012 写 §11 NFR baseline:diff

`specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 末尾追加：

```markdown
## §11 NFR baseline:diff（Feature 159 录制，2026-05-09）

| target        | totalWallMs Δ% | tokens Δ% | cost Δ% | graphNodeCount Δ% | verdict |
|---------------|----------------|-----------|---------|-------------------|---------|
| micrograd     | +8.5% green    | +15.7% red    | +10.7% yellow | +254% (expected)   | accept-and-spec     |
| nanoGPT       | +5.9% green    | +8.8% yellow  | +5.7% green   | +218.8% (expected) | SC-3a 接受偏差      |
| self-dogfood  | +49.1% red     | +31.3% red    | +28.6% red    | +28,647% (expected)| accept-and-spec     |

**结论**：_一句话总结，如"全 green，Feature 151~156 累计变更对 perf 无显著回归"_

注：output.graphNodeCount 大幅增加是 expected breaking change（UnifiedGraph + callSites 引入新节点类型），不计入 SC-3 验收。
```

数据从 T-011 的 JSON 输出读取并填充（已实测，2026-05-09，commit 0449d2b → cf0a131）。

#### T-013 改 Feature 151 verification report（Codex CRITICAL 3 修订：verdict 分支文案）

`specs/151-knowledge-graph-python/verification/verification-report.md` SC-006 / NFR-1 / NFR-5 段落，将原 `⏸ deferred` 按实际 baseline:diff 结果分支替换：

**Branch A — 全 green（所有 perf 项 |Δ| < yellowMin）**：
```markdown
✅ **verified（Feature 159 follow-up 录制）**：见 [Feature 159 verification report](../../159-feat151-baseline-snapshot/verification/verification-report.md)。3 个 baseline 在 perf.totalWallMs / perf.tokensInputPlusOutput / perf.estimatedCostUsd 三项均 green，\|deltaPct\| < 10%，无 perf 回归。output.graphNodeCount 大幅增加是预期变化（UnifiedGraph + callSites 引入新节点类型），不计入 SC-006 验收。
```

**Branch B — 任一 yellow（Codex CRITICAL 3 关键：禁止写 "< 10%"）**：
```markdown
✅ **verified with accepted deviation（Feature 159 follow-up 录制）**：见 [Feature 159 verification report](../../159-feat151-baseline-snapshot/verification/verification-report.md) §SC-3a。<具体偏差说明：例如 "nanoGPT perf.totalWallMs Δ=+12.3%（yellow），跨度为 commit 0449d2b → master HEAD（9 个 feature 累计变更，无法归因到单一 feature）；release owner 接受偏差。"> output.graphNodeCount 大幅增加是预期变化，不计入 SC-006 验收。
```

**Branch C — 任一 red**：T-013 跳过；先写 `verification/regression-analysis.md` 完成根因识别（git bisect 或 commit-by-commit 排查）+ 决策（rollback / hot-fix / accept-and-spec），再回 T-013 按 Branch B 模板补齐。

**禁止用语**：
- 不能在 yellow / red 情况下写"全 green"或"< 10%"或"无回归"等通过性陈述
- 不能用模糊措辞（如"大致符合"、"基本通过"），必须列具体 metric + deltaPct + 跨度 git range

#### T-014 仓库一致性

```bash
npm run build && npm run repo:check && npm run release:check && npx tsc --noEmit
```

#### T-015 verification report

写 `specs/159-feat151-baseline-snapshot/verification/verification-report.md`，覆盖 SC-1 ~ SC-7 验收数据。

#### T-016 三向审查 + Codex 终审

按 spec-driver-story Phase 5 流程：spec-review + quality-review 并行 → verify。Codex 对抗审查贯穿每 phase（已在每 phase 后即时跑）。

---

## 6. 提交策略

按 CLAUDE.local.md "PUSH Origin Master 前列 Report 等待用户确认"约定：

1. 跑批完成 + Layer B snapshot + §11 + Feature 151 update 全部就绪后，**编排器主动列 deliverable report**
2. 报告含：commit hash 草案 / 改动统计 / Codex 阶段性审查结论 / SC-1~SC-7 通过率 / baseline:diff 数据
3. 用户回 "确认 push" → 编排器执行 `git rebase master` + `git push origin master`（按"分支同步与交付约定"硬性顺序）
4. 用户提出修订 → 编排器修订重测

---

## 7. 项目上下文（Project Context 注入）

- 当前主线：panoramic Phase 1 / 4 语言 callSites 累计已 ship（154/155/156）
- 受 CLAUDE.md 约束：所有文档中文 + 英文标识符；不动产品代码（本 Feature 仅修改 tests/ + specs/）
- 受 CLAUDE.local.md 约束：每 phase commit 前 Codex 对抗审查；push master 前列 deliverable report 等用户确认
- 受 Constitution 约束：
  - 原则 II（Spec-Driven）：本 Feature 走 spec-driver-story 完整流程
  - 原则 III（YAGNI）：不引入新工具 / 新阈值类型；沿用 baseline-collect.mjs / baseline-diff.mjs 默认行为
  - 原则 VIII（不直接改 src/）：本 Feature 不动 src/ 任何文件
