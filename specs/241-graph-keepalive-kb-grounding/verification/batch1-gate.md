# F241 批 1 门禁（T027）执行记录

batch1-base：`6950b084f5b3de7246ac0191cdfbdad55de555e5`（trace.md `[02:25:34] batch_base: batch1=`）
所有 RG 检查一律对 `git diff <batch1-base> -- <paths>`，不用裸 `git diff`（T-W3）。

## 1. 插件侧 node:test 全套

```
node --test \
  plugins/spec-driver/tests/graph-consumption-decision.test.mjs \
  plugins/spec-driver/tests/git-change-classifier.test.mjs \
  plugins/spec-driver/tests/graph-refresh-executor.test.mjs \
  plugins/spec-driver/tests/graph-consumption-cli.test.mjs \
  plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs \
  plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs \
  plugins/spec-driver/tests/ensure-gitignore.test.mjs \
  plugins/spec-driver/tests/goal-loop-core.test.mjs \
  plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs
```

退出码 **0** ｜ `tests 336 / pass 336 / fail 0` ｜ duration 12.5s

分文件计数（本批新增在前，既有回归套件在后）：

| 文件 | tests | 状态 |
|---|---|---|
| graph-consumption-decision.test.mjs | 35 | pass |
| git-change-classifier.test.mjs | 21 | pass |
| graph-refresh-executor.test.mjs | 14 | pass |
| graph-consumption-cli.test.mjs | 41 | pass |
| goal-loop-graph-consumption-integration.test.mjs | 19 | pass |
| graph-bootstrap-status-shim.test.mjs | 8 | pass |
| ensure-gitignore.test.mjs | 22（原 19） | pass |
| goal-loop-core.test.mjs（既有回归，RG-001） | 163 | pass |
| goal-loop-snapshot-rollback-integration.test.mjs（既有回归，T-C5） | 13 | pass |

## 2. vitest 侧

```
npx vitest run tests/unit/worktree-lifecycle-hook.test.ts tests/unit/graph-bootstrap-status.test.ts
```

退出码 **0** ｜ `Test Files 2 passed (2) / Tests 54 passed (54)` ｜ duration 18.45s

> **tasks.md 缺陷（已如实上报）**：T027 把 `tests/unit/graph-bootstrap-status.test.ts` 列进了
> `node --test` 的文件清单。它是 `.ts` vitest 用例，`node --test` 跑不了（Node 无 TS 加载器）。
> 此处按其真实归属改由 vitest 执行，覆盖不减。

## 3. 构建

```
npm run build
```

退出码 **0**，类型检查零错误。`[postbuild:stamp] 盖章: commit=6950b084 (dirty)`

## 4. 仓库同步校验

```
npm run repo:check
```

退出码 **0** ｜ **86 项全 pass，0 fail / 0 warn**。含本批直接相关族：

- `spec-driver-wrappers:source-skills` / `codex-wrapper-markers` /
  `codex-plugin-distribution-markers` / `claude-project-overrides` / `plugin-metadata-sync` — 全 pass
  （T024 的 `npm run repo:sync` 已连带再生两个 codex wrapper）
- `graph-quality:*` 六项全 pass；`spec-drift:anchors-status` pass；`worktree-local-state:*` 四项全 pass

## 5. RG 抽查

| RG | 检查方式 | 结果 |
|---|---|---|
| RG-001 | `git diff <base> -- plugins/spec-driver/tests/goal-loop-core.test.mjs` | **0 行改动**；测试数 163（≥163 ✓） |
| RG-002 | 见下方实跑 | dry-run 零副作用 ✓；implement phase effective `agent_mode = single`（goal_loop 仍是 opt-in，未被本批改成默认开） |
| RG-003 | `git diff <base> -- plugins/spec-driver/scripts/lib/goal-loop-core.mjs` | **0 行改动** |
| RG-004 | `git diff <base> -- .../orchestration-schema.mjs .../orchestration.yaml` | **0 行改动** |
| RG-007 | `spectra graph-quality --json` | `overallVerdict = pass` ✓ |
| 附加 | `git diff <base> -- src/` | **0 行改动**（批 1 不碰 `src/**`） |

### RG-002 实跑（本仓默认配置，非 fixture）

```
node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide \
  --project-root "$PWD" --refresh-policy allowed --dry-run --format json
```

- 退出码 **0**
- `specs/_meta/graph.json` SHA-256 前后一致：
  `25712bd00efe4f4dcd2f5d6059736bdb26216e207838fc28b3b61c33a5b3b99c`（前）= 同值（后）
- `.specify/graph-consumption-audit.jsonl` **未被创建**（dry-run 连审计文件都不落）
- 输出：`outcome=refresh-then-consume matchedRule=10 refreshAttempted=false`
  `inputs={"changeClass":"modifies-existing","graphAvailability":"present","freshness":"dirty","coverageScope":"in-graph-scope","refreshPolicy":"allowed"}`
- 判读：本 worktree 此刻确有未提交改动，`freshness=dirty` 是真实状态；矩阵行 10（dirty × allowed）
  给 `refresh-then-consume` 与 spec 表一致；dry-run 未真刷，故 `refreshAttempted=false`。

## 6. continuous capture 台账同步（T-C4）

| 项 | 值 |
|---|---|
| `pilot/ledger.jsonl` 总行数 | 13（11 行迁移基线 + 本批新增 2） |
| 本批新增 ledger 行（`caller: "implement-batch1"`） | 2（seq `1-9`、`1-10`） |
| `pilot/mcp-call-log.md` 本批新增表格条目 | 2（`1-9`、`1-10`） |
| 数量一致 | ✓ |
| `seq` 单调递增 + schema 校验 | `node pilot/ledger-schema-check.mjs` exit **0** |

## 门禁结论

**PASS** —— 六项全部零失败，可进入批 2。

---

# 批 1 收尾追加任务（T027a / T027b）门禁复跑

编排器裁决补做 implement 报告的两条发现后，重跑同一套门禁。两条任务的红态证据见
`batch1-red-evidence.md` 末尾两节（T027a：11 tests / 2 fail，符号链接击穿自调用守卫致 exit 0
静默空转；T027b：模块 ERR_MODULE_NOT_FOUND + CLI 48 tests / 4 fail，`--tasks-file` 完全不可达）。

## 1. 插件侧 node:test 全套（范围放大到 `plugins/spec-driver/tests/*.mjs`）

```
node --test plugins/spec-driver/tests/*.mjs
```

退出码 **0** ｜ `tests 1237 / suites 222 / pass 1237 / fail 0` ｜ duration 13.7s

> 首跑（T027 时）只列了 9 个文件，本次改跑整个目录 glob，覆盖只增不减。
> 下表按批 1 门禁的原口径给出同一批文件的分文件计数，便于逐项对照。

| 文件 | tests（T027 时 → 现在） | 状态 |
|---|---|---|
| graph-consumption-decision.test.mjs | 35 → 35 | pass |
| git-change-classifier.test.mjs | 21 → 21 | pass |
| graph-refresh-executor.test.mjs | 14 → 14 | pass |
| graph-consumption-cli.test.mjs | 41 → **48**（T027b 追加 7） | pass |
| goal-loop-graph-consumption-integration.test.mjs | 19 → 19 | pass |
| graph-bootstrap-status-shim.test.mjs | 8 → **11**（T027a 追加 3） | pass |
| ensure-gitignore.test.mjs | 22 → 22 | pass |
| **tasks-path-signal.test.mjs（T027b 新增）** | — → **21** | pass |
| goal-loop-core.test.mjs（既有回归，RG-001） | 163 → 163 | pass |
| goal-loop-snapshot-rollback-integration.test.mjs | 13 → 13 | pass |

## 2. vitest 侧

```
npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/worktree-lifecycle-hook.test.ts
```

退出码 **0** ｜ `Test Files 2 passed (2) / Tests 54 passed (54)` ｜ duration 18.32s

> T027a 动了 canonical 的自调用守卫（新增导出 `isInvokedDirectly`），这两个文件是它的
> 直接消费方与近邻回归面，54 项计数与 T027 时完全一致，零回归。

## 3. 构建

```
npm run build
```

退出码 **0**，类型检查零错误。`[postbuild:stamp] 盖章: commit=6950b084 (dirty)`

## 4. 仓库同步校验

```
npm run repo:check
```

退出码 **0** ｜ `status=pass` ｜ **86 项全 pass，0 fail / 0 warn**（与 T027 时同数，新增插件脚本
未破坏任何 wrapper / metadata / graph-quality / worktree-local-state 族检查）

## 5. RG 抽查（对同一 batch1-base 复核）

| RG | 检查方式 | 结果 |
|---|---|---|
| RG-001 | `git diff <base> -- plugins/spec-driver/tests/goal-loop-core.test.mjs` | **0 行改动**；测试数 163（≥163 ✓） |
| RG-003 | `git diff <base> -- plugins/spec-driver/scripts/lib/goal-loop-core.mjs` | **0 行改动** |
| RG-004 | `git diff <base> -- .../orchestration-schema.mjs .../orchestration.yaml` | **0 行改动** |
| RG-006 | 被审文件集合由 3 扩至 4（并入 `tasks-path-signal.mjs`），三段静态扫描全 pass | ✓ |
| 附加 | `git diff <base> -- src/` | **0 行改动**（收尾任务同样不碰 `src/**`） |

## 复跑结论

**PASS** —— 四项门禁全部零失败，两条追加任务的红→绿闭环完整，批 1 既有断言零回归。

---

# 批 1 Codex 代码对抗审查整改后的门禁全表

审查会话 `task-msc6wt4l-emi1m9`（7 CRITICAL / 7 WARNING，结论「门禁不通过」）的整改单
（review-dispositions.md「Implement 批 1 — Codex 代码对抗审查整改单」）逐条修复后，
对同一 batch1-base `6950b084f5b3de7246ac0191cdfbdad55de555e5` 重跑全套门禁。
红态证据见 `batch1-red-evidence.md` 末节。

## 1. 插件侧 node:test 全套

```
node --test plugins/spec-driver/tests/*.mjs
```

退出码 **0** ｜ `tests 1272 / suites 228 / pass 1272 / fail 0` ｜ duration 17.6s

| 文件 | tests（整改前 → 整改后） | 状态 |
|---|---|---|
| graph-consumption-decision.test.mjs | 35 → **37**（B1-C4 追加 2） | pass |
| git-change-classifier.test.mjs | 21 → 21 | pass |
| graph-refresh-executor.test.mjs | 14 → 14 | pass |
| graph-consumption-cli.test.mjs | 48 → **68**（B1-C1/C2/C3/C4/C6/W2/W4 追加 20） | pass |
| goal-loop-graph-consumption-integration.test.mjs | 19 → **27**（B1-C5/C7/W1 追加 8） | pass |
| graph-bootstrap-status-shim.test.mjs | 11 → **12**（B1-W3 由 1 条拆强化为 2 条） | pass |
| ensure-gitignore.test.mjs | 22 → 22（B1-W6 仅措辞） | pass |
| tasks-path-signal.test.mjs | 21 → **25**（B1-W2 追加 4） | pass |
| goal-loop-core.test.mjs（既有回归，RG-001） | 163 → 163 | pass |
| goal-loop-snapshot-rollback-integration.test.mjs | 13 → 13 | pass |

净增 35 条断言用例，既有断言零回归。

## 2. vitest 侧

```
npx vitest run tests/unit/graph-bootstrap-status.test.ts tests/unit/worktree-lifecycle-hook.test.ts
```

退出码 **0** ｜ `Test Files 2 passed (2) / Tests 54 passed (54)` ｜ duration 18.58s

## 3. 构建

```
npm run build
```

退出码 **0**，`tsc` 类型检查零错误。`[postbuild:stamp] 盖章: commit=6950b084 (dirty)`

## 4. 仓库同步校验

```
npm run repo:sync   # B1-C5 改了 canonical SKILL，必须再生两个 wrapper
npm run repo:check
```

`repo:check` 退出码 **0** ｜ `status=pass` ｜ **86 项全 pass，0 fail / 0 warn**。
`spec-driver-wrappers:*` / `codex-wrapper-markers` / `codex-plugin-distribution-markers` 全 pass；
`graph-quality:*` 六项、`spec-drift:anchors-status`、`worktree-local-state:*` 四项全 pass。

> wrapper 同步现在**有测试兜底**：`goal-loop-graph-consumption-integration.test.mjs` 的
> 「两个生成 wrapper 与 canonical 同步」用例直接读 `skills-codex/` 与 `.codex/skills/` 两份产物，
> 断言 advisory 命令逐字一致——改 SKILL 忘 `repo:sync` 不再只能靠 repo:check 兜底。

## 5. RG 复核（同一 batch1-base）

| RG | 检查方式 | 结果 |
|---|---|---|
| RG-001 | `git diff 6950b084 -- plugins/spec-driver/tests/goal-loop-core.test.mjs` | **0 行改动**；测试数 163 |
| RG-003 | `git diff 6950b084 -- plugins/spec-driver/scripts/lib/goal-loop-core.mjs` | **0 行改动** |
| RG-004 | `git diff 6950b084 -- plugins/spec-driver/config/orchestration.yaml plugins/spec-driver/contracts/orchestration-schema.mjs` | **0 行改动**（**路径勘误见下**） |
| RG-006 | 被审集合改为 CLI 入口的 import 闭包（6 文件），三段扫描全 pass；下限断言 ⊇ 5 项固定清单 | ✓ |
| 附加 | `git diff 6950b084 -- src/` | **0 行改动** |

### RG-004 路径勘误（本轮发现，如实上报）

本文件前两轮门禁记录里 RG-004 写的是
`plugins/spec-driver/contracts/orchestration-schema.mjs` + `.../contracts/orchestration.yaml`。
**`plugins/spec-driver/contracts/orchestration.yaml` 这个文件并不存在**——真实路径是
`plugins/spec-driver/config/orchestration.yaml`。对不存在路径跑 `git diff` 恒为空，
因此前两轮 RG-004 对 yaml 的那一半是**空转检查**（schema.mjs 那一半有效）。
本轮已按正确路径复核，两个文件均 0 行改动，结论不变，但检查本身此前无效。

## 6. 本轮附带的产物清理

`npm run repo:sync` 会重生成 `specs/products/**/_generated/*` 与
`.specify/project-context.suggestions.{md,yaml}`，其 diff 仅为 `generatedAt` 时间戳漂移，
与 F241 无关。已 `git checkout --` 还原，还原后 `repo:check` 仍 `status=pass`，
批 1 的改动面因此保持只含 F241 相关文件。

## 整改后门禁结论

**PASS** —— 五项门禁全部零失败；B1-C1..C7 与 W1/W2/W3/W4/W6 全部落地（W5 按裁决不修）。
