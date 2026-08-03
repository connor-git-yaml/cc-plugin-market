# Quickstart：Graph Collector Fingerprint

## 验证机制生效（User Story 1）

```bash
# 1. 用当前 dist 建一份图（记录当前 collector fingerprint）
npm run build
node dist/cli/index.js batch --mode graph-only

# 2. 查看 graph.json 里的 fingerprint 字段
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('specs/_meta/graph.json','utf-8')).graph.fingerprint, null, 2))"

# 3. 跑 graph-quality，确认一致场景是 fresh（不因引入机制产生误报）
node dist/cli/index.js graph-quality --json | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).freshness))"
```

## 验证再生脚本的二元拒绝判据（User Story 2）

再生脚本入口统一走 npm script（不直接裸跑 `tsx`，P12）：

```bash
npm run fixtures:regen:collector-fingerprint
```

二元判据：**(内容不一致) ∧ (当前指纹与 pinned 记录指纹相等)** 同时为真才拒绝；任一为假都放行。`fixtureInputHash`（fixture 输入哈希）**不参与放行判定**，仅在拒绝时用于错误文案分流（区分"producer 行为漂移"与"fixture 基线变更"两种拒绝场景，见 plan.md「再生脚本」一节）。

**以下两个演示是人工快速直觉验证的辅助说明，不是 SC-010 的验收证据本体**——SC-010 的自动化验收证据是 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 的扰动注入测试组 + `tests/unit/collector-fingerprint-regen-predicate.test.ts` 的二元判据真值表（三件套：比较器灵敏度 + 真实重建绿路径 + 拒绝纯函数真值表，见 plan.md「护栏双轨设计」扰动注入测试组一节；Q10 处置，避免"改 pinned = 验收 SC-010"的误导）。

### (a) 拒绝演示——模拟 producer 漂移的最小演示（临时改 pinned 期望内容）

这不是真的制造一次行为变更，而是用"手工改动 pinned 期望产物"来模拟"重建内容与 pinned 不一致，但当前指纹与 pinned 记录指纹仍相等"这一拒绝条件组合，快速直觉验证拒绝路径与文案是否符合预期。真实的护栏灵敏度证明由扰动注入测试组自动化覆盖，不依赖这个手工演示。

```bash
# 1. 手工临时改动一处 pinned 期望产物内容（不改 fixture 源码、不改 SSoT/behaviorVersion）
#    例如：删除 expected-module-graph.json 里 moduleGraph.edges 数组中的一条边，
#    或改动 moduleGraph.modules[] 中某一项的 source 字段值
#    （ModuleNode/ModuleEdge 无 label 字段，不要臆造该字段）

# 2. 跑再生脚本 —— 应被拒绝并以非零退出码提示"检测到指纹不可见的行为变更：先 bump behaviorVersion 再跑再生"
npm run fixtures:regen:collector-fingerprint
echo "exit code: $?"   # 期望非 0

# 3. 演示后还原（拒绝路径下脚本本身不会覆写文件，但手工改动需自行还原）
git checkout -- tests/fixtures/collector-fingerprint-guardrail/expected-module-graph.json
```

### (b) 放行演示——SSoT 扩展面变化，指纹自动变化

```bash
# 1. 在 src/collector-surface.ts 临时新增一个测试用扩展名（不改 BEHAVIOR_VERSION）

# 2. 跑再生脚本 —— 指纹已因 extensionSurface 自动变化而不同，脚本正常放行并写盘
npm run fixtures:regen:collector-fingerprint
echo "exit code: $?"   # 期望 0

# 3. 验收点：再生脚本放行（exit code 0）+ 两份 pinned 资产的 fingerprint 字段已随之更新
#    （双轨护栏测试是否变红取决于新增扩展名具体落在哪条管线的样本覆盖范围内，不作为本演示的验收承诺）

# 4. 演示后还原
git checkout -- src/collector-surface.ts tests/fixtures/collector-fingerprint-guardrail/
```

**注**：第一轮版本曾有第三个演示——"fixture src 下新增一个文件 → 放行"。该演示已删除：fixture 基线变更（含护栏样本扩充/修改）现在等同于行为面变化，同样需要 bump `behaviorVersion` 声明后才能放行（不再是自动放行路径），因此该场景现在与演示 (a) 同属拒绝路径，不再单独演示。

## 验证存量旧图诚实降级（User Story 3）

```bash
# 构造一份不含 fingerprint 字段的"旧图"（复制现有图并删除该字段）
node -e "
const fs = require('fs');
const g = JSON.parse(fs.readFileSync('specs/_meta/graph.json','utf-8'));
delete g.graph.fingerprint;
fs.writeFileSync('/tmp/old-graph.json', JSON.stringify(g));
"

node dist/cli/index.js graph-quality --graph /tmp/old-graph.json --json \
  | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).freshness))"
# 期望：state === 'stale'，staleReasons 包含 'collector-fingerprint-unrecorded'
# （前提：/tmp/old-graph.json 的 sourceCommit 与当前 HEAD 一致，且非 null/undefined，
#  否则会先短路到 unknown-provenance，见 FR-009 步骤 (1)(2)）
```
