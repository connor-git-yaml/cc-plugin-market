---
title: "fix 依从性 Stop hook 候选目录解析盲区修复 — 任务列表"
feature: "224-fix-compliance-judge-dir-resolution"
branch: "224-fix-compliance-judge-dir-resolution"
created: "2026-07-22"
status: "Draft"
---

# Tasks: fix 依从性 Stop hook 候选目录解析盲区修复

**Input**: `specs/224-fix-compliance-judge-dir-resolution/plan.md`、`specs/224-fix-compliance-judge-dir-resolution/spec.md`
**Prerequisites**: plan.md 已完成（本文件与 plan.md 同批产出）

**测试运行方式（已核实，见 `package.json` scripts）**：
- 单文件：`node --test plugins/spec-driver/tests/<file>.test.mjs`
- 插件全量：`npm run test:plugins`（= `node --test "plugins/spec-driver/tests/**/*.test.mjs"`）
- 仓库全量：`npm run test`（= `npx vitest run && npm run test:plugins`）
- 仓库同步检查：`npm run repo:check`

## 实施期设计修正（2026-07-22，优先于本文件原文）

`ambiguous` 的触发面收窄为**仅**「已知候选被改名到不符合 `NNN-fix-<name>` 命名的 dst」一种情形；
原设计的 `FIX_DIR_LOOSE_REGEX` + `noteIfDirOnly`（"只出现目录路径 → 置 ambiguous → fail-open"）**取消不落地**，
因为它会把"建了特性目录、写了 plan.md/tasks.md、但从未写 fix-report.md"这一 F208 典型坍塌形态从硬阻断变为放行。
受影响任务：T001（3 个常量而非 4 个）、T009（fixture 改为反向回归用途并更名）、T015、T017、T020、新增 T020b。
详见 plan.md §Summary 的「实施期设计修正」与 spec.md 对应 Edge Case 的订正说明。

## 依赖关系总览

```
T001 (正则常量) ──▶ T002 (重写 resolveFeatureDirCandidate) ──▶ T003 (evaluate() 早退分支)
                                    │
T004 (schema 契约) [P，与 T001-T003 无依赖]
                                    │
T005-T012 (8 个新 fixture) [P，彼此独立，但需在 T002 落地后才能驱动断言通过，故排在 T002 之后]
                                    │
T013-T017 (core 单测：正向×2 + 负向/降级×2 + 混合链式×1 + 回归机械断言×1)
                                    │
T018-T020 (CLI 端到端：正向 + SC-004 负向回归 + SC-005 降级)
                                    │
T021 (全量验证)
```

---

### T001 [P] 新增正则常量

**文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

**动作**：在现有 `ARTIFACT_PATH_REGEX`/`BASH_WRITE_INDICATOR_REGEX` 定义之后，新增导出常量 `FIX_DIR_NAME_REGEX`、`RENAME_COMMAND_REGEX`、`INLINE_EDIT_INDICATOR_REGEXES`（**修正后 3 个，不含 `FIX_DIR_LOOSE_REGEX`**）（定义与注释见 plan.md §改动清单 1.1，逐字落地）。

**验收命令**：
```bash
node -e "
const m = await import('./plugins/spec-driver/scripts/lib/fix-compliance-core.mjs');
console.log(typeof m.FIX_DIR_NAME_REGEX, typeof m.RENAME_COMMAND_REGEX, Array.isArray(m.INLINE_EDIT_INDICATOR_REGEXES) && m.INLINE_EDIT_INDICATOR_REGEXES.length, 'LOOSE=' + typeof m.FIX_DIR_LOOSE_REGEX);
"
```
**期望输出**：`object object 2 LOOSE=undefined`（3 个常量已导出、长度为 2，且取消的 `FIX_DIR_LOOSE_REGEX` 确未落地）

---

### T002 依赖 T001：重写 `resolveFeatureDirCandidate`

**文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

**动作**：按 plan.md §改动清单 1.2 的设计重写函数体——单次前向扫描，维护 `candidate`/`ambiguous` 两个累积状态；新增 `applyRename`（不受写指示符门禁约束地对 Bash 命令执行改名识别）内部闭包（`noteIfDirOnly` 按修正取消）；同一条 Bash 命令内先跑写入提名再跑改名跟随，以支持 `写制品 && mv 旧 新` 复合命令；`writeGated` 判据由 `BASH_WRITE_INDICATOR_REGEX.test(cmd) || INLINE_EDIT_INDICATOR_REGEXES.some(re => re.test(cmd))` 构成。返回体从 `{ path }` 扩展为 `{ path, ambiguous }`。

**验收命令**（临时冒烟，验证返回体新字段存在且既有导出签名不变）：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | tail -20
```
**期望输出**：现有全部用例仍为 `pass`（因新增字段不破坏既有仅断言 `.path` 的用例），`# fail 0`

---

### T003 依赖 T002：`evaluate()` 新增早退分支

**文件**：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`

**动作**：在 `evaluate()` 内 `resolveFeatureDirCandidate` 调用后插入早退分支，命中 `candidate.path === null && candidate.ambiguous === true` 时返回 `{ enforcement, configDegraded, isFix: true, mode: anchor.mode, transcriptDiagnostics: ['feature-dir-unresolvable'], verdict: null }`（逐字见 plan.md §改动清单 2）。`runHook`/`runReport` 不改动。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | tail -20
```
**期望输出**：既有全部用例仍为 `pass`，`# fail 0`（此时新增负向/降级用例尚未编写，本任务只验证不引入回归）

---

### T004 [P，无依赖] 契约 schema 同步

**文件**：`specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`

**动作**：`diagnostics.items.enum` 数组在 `"payload-invalid"` 之后追加一项 `"feature-dir-unresolvable"`。

**验收命令**：
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json','utf8')).properties.diagnostics.items.enum.includes('feature-dir-unresolvable'))"
```
**期望输出**：`true`

---

### T005-T012 [P 彼此独立，均依赖 T002 才能被断言驱动通过] 新增测试 fixture

**文件**：`plugins/spec-driver/tests/fixtures/fix-compliance/`（新建以下 8 个 `.jsonl`，沿用既有 fixture 的单行 JSON envelope 格式与 `SKILL_EXPANSION_LINE`/`TOOL_USE` 风格）

| Task | Fixture 文件 | 覆盖场景 | 关键内容 |
|------|-------------|---------|---------|
| T005 | `resolve-rename-git-mv.jsonl` | US1 AS1 | fix 展开 → Write `specs/321-fix-old/fix-report.md` → Write `specs/321-fix-old/verification/verification-report.md` → Bash `git mv specs/321-fix-old specs/322-fix-new` |
| T006 | `resolve-rename-mv-plain.jsonl` | US1 AS2 | 同 T005，Bash 命令换为裸 `mv specs/323-fix-old specs/324-fix-new` |
| T007 | `resolve-inline-edit-sed.jsonl` | US2 AS1 | fix 展开 → Bash `sed -i '' 's#old#new#' specs/325-fix-inline/fix-report.md`（唯一写入痕迹，无重定向符） |
| T008 | `resolve-inline-edit-perl.jsonl` | US2 AS2 | fix 展开 → Bash `perl -i -pe 's/old/new/' specs/326-fix-inline2/fix-report.md`（唯一写入痕迹） |
| T009 | `resolve-dir-only-plan-md.jsonl`（**修正后更名/改用途**） | 反向回归：只写非制品文件仍须硬阻断 | fix 展开 → Write `specs/327-fix-dironly/plan.md` → Bash `mkdir -p ... && echo start > .../progress.log`（从未出现制品全路径）→ 期望 `path=null` 且 **`ambiguous=false`** |
| T010 | `resolve-ambiguous-rename-nonstandard.jsonl` | Edge Case 2 | fix 展开 → Write `specs/328-fix-old/fix-report.md`（建立候选）→ Bash `git mv specs/328-fix-old specs/renamed-nonstandard`（目标名不满足 `NNN-fix-<name>` 规范） |
| T011 | `resolve-multi-rename-chain.jsonl` | Edge Case：同一会话多次改名 | fix 展开 → Write `specs/329-fix-a/fix-report.md` → Bash `git mv specs/329-fix-a specs/330-fix-b` → Bash `mv specs/330-fix-b specs/331-fix-c` |
| T012 | `resolve-mixed-rename-then-inline-edit.jsonl` | Edge Case：改名 + 原地编辑混用 | fix 展开 → Write `specs/332-fix-orig/fix-report.md` → Bash `git mv specs/332-fix-orig specs/333-fix-renamed` → Bash `sed -i '' 's#a#b#' specs/333-fix-renamed/fix-report.md` |

**验收命令**（逐个新建后跑一次 JSON 合法性 + 行数检查）：
```bash
for f in resolve-rename-git-mv resolve-rename-mv-plain resolve-inline-edit-sed resolve-inline-edit-perl \
         resolve-dir-only-plan-md resolve-ambiguous-rename-nonstandard resolve-multi-rename-chain \
         resolve-mixed-rename-then-inline-edit \
         resolve-rename-mv-flag resolve-rename-git-mv-flag; do
  node -e "require('fs').readFileSync('plugins/spec-driver/tests/fixtures/fix-compliance/${f}.jsonl','utf8').split('\n').filter(l=>l.trim()).forEach(l=>JSON.parse(l))" \
    && echo "OK ${f}" || echo "FAIL ${f}";
done
```
**期望输出**：10 行 `OK <fixture-name>`，无 `FAIL`

> **订正（实施期，2026-07-22）**：原命令写的 `resolve-ambiguous-dir-only` 是 T009 更名前的旧 fixture 名，交付文件实际为 `resolve-dir-only-plan-md`，直接复制执行会 FAIL；同时补入 Phase 5 spec-review CRITICAL 订正新增的两条带 flag 改名 fixture（`resolve-rename-mv-flag` / `resolve-rename-git-mv-flag`），期望行数由 8 改为 10。

---

### T013 依赖 T002/T005/T006：core 单测 — US1 改名跟随（正向）

**文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：新增 `describe('resolveFeatureDirCandidate：目录改名跟随（FR-001/US1）')`，加载 `resolve-rename-git-mv.jsonl` 断言 `resolveFeatureDirCandidate(...).path === 'specs/322-fix-new'` 且 `ambiguous === false`；加载 `resolve-rename-mv-plain.jsonl` 断言 `.path === 'specs/324-fix-new'`。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "改名跟随|# fail"
```
**期望输出**：新增 2 个用例均 `ok`，`# fail 0`

---

### T014 依赖 T002/T007/T008：core 单测 — US2 原地编辑识别（正向）

**文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：新增 `describe('resolveFeatureDirCandidate：原地编辑命令识别（FR-002/US2）')`，加载 `resolve-inline-edit-sed.jsonl` 断言 `.path === 'specs/325-fix-inline'`；加载 `resolve-inline-edit-perl.jsonl` 断言 `.path === 'specs/326-fix-inline2'`。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "原地编辑命令识别|# fail"
```
**期望输出**：新增 2 个用例均 `ok`，`# fail 0`

---

### T015 依赖 T002/T009/T010：core 单测 — US3/Edge Case 降级探测（负向/安全阀）

**文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：新增 `describe('resolveFeatureDirCandidate：无法定位候选的降级探测（FR-004/US3）')`：
- 加载 `resolve-ambiguous-rename-nonstandard.jsonl` 断言 `.path === null && .ambiguous === true`（修正后唯一的降级触发面）；
- 加载 `resolve-dir-only-plan-md.jsonl` 断言 `.path === null && .ambiguous === false`（**反向回归**：只写 plan.md 不得走 fail-open，仍交既有严格判据硬阻断）；
- 补一条内联用例（沿用文件内既有 `codex C-2` 描述块风格的 `user`/`bash`/`write` 辅助函数）验证**真坍塌不受影响**：零工具调用的 entries 数组 → `.path === null && .ambiguous === false`。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "降级探测|# fail"
```
**期望输出**：新增 3 个用例均 `ok`，`# fail 0`

---

### T016 依赖 T002/T011/T012：core 单测 — Edge Case 混合链式（FR-008 叠加语义）

**文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：新增 `describe('resolveFeatureDirCandidate：多次改名/混用叠加取最终态（FR-008）')`：
- 加载 `resolve-multi-rename-chain.jsonl` 断言 `.path === 'specs/331-fix-c'`（222→223→224 式链式改名取最后一环）；
- 加载 `resolve-mixed-rename-then-inline-edit.jsonl` 断言 `.path === 'specs/333-fix-renamed'`（改名后原地编辑仍确认同一最终目录）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "叠加取最终态|# fail"
```
**期望输出**：新增 2 个用例均 `ok`，`# fail 0`

---

### T017 依赖 T002：core 单测 — 既有 fixture 回归机械断言

**文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：新增 `describe('回归：既有 fixture 判定结果不受本次改动影响')`，用 `node:fs.readdirSync(FIXTURE_DIR)` 遍历全部 `.jsonl`（排除文件名以 `resolve-` 前缀开头的 8 个新增 fixture），对每个文件调用 `detectFixSkillExpansion` 定锚后调 `resolveFeatureDirCandidate`，断言 `.ambiguous === false`（既有 fixture 从未触达新增的松散探测分支这一论证的可执行版本，对应 plan.md §向后兼容论证 第 2 条）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "既有 fixture 判定结果不受本次改动影响|# fail"
```
**期望输出**：遍历产生的用例全部 `ok`，`# fail 0`

---

### T018 依赖 T003：CLI 端到端 — US1 改名场景全链路（正向，复现 F223 实例）

**文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`

**动作**：新增 `describe('CLI 端到端：目录改名后仍合规收口（复现 F223 场景，FR-001）')`——用现有 `writeTranscript`/`TOOL_USE`/`SKILL_EXPANSION_LINE` 助手内联构造：Write fix-report.md 到旧路径 → `Agent(implement)` → `Agent(verify)` → Write verification-report.md 到旧路径 → Bash `git mv <旧路径> <新路径>`；随后在 `tmp`（沙箱 projectRoot）下**只在新路径**落盘真实制品文件（`fs.mkdirSync`/`fs.writeFileSync`，模拟改名后磁盘上唯一存在的目录）。断言 `runCli({...}).status === 0` 且 `stderr.trim() === ''`（合规静默放行，不再误报"未建立特性目录"）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "复现 F223 场景|# fail"
```
**期望输出**：新增用例 `ok`，`# fail 0`

---

### T019 依赖 T003：CLI 端到端 — SC-004 回归（真实制品缺失仍阻断）

**文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`

**动作**：新增 `describe('CLI 端到端：候选目录存在但 fix-report.md 真实缺失仍阻断（SC-004 回归）')`——内联构造 transcript：fix 展开 + Write `fix-report.md` 到 `specs/301-fix-sample-bug`（正常提名候选）；沙箱侧**只 `fs.mkdirSync` 建目录、不写 `fix-report.md` 文件**（模拟真实制品缺失，非解析盲区）。断言 `runCli({...}).status === 2`（仍硬阻断）且 `--mode report` 输出的 `missing` 数组包含 `'fix-report.md'` 而**不包含** `'feature-dir'`（证明是走"制品缺失"判据而非"候选目录未定位"判据，二者语义未被混淆）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "SC-004 回归|# fail"
```
**期望输出**：新增用例 `ok`，`# fail 0`

---

### T020 依赖 T003：CLI 端到端 — SC-005 降级放行 + 诊断留痕

**文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`

**动作**：新增 `describe('CLI 端到端：候选目录无法确定 → fail-open 降级 + 诊断留痕（SC-005）')`——内联构造 transcript：fix 展开 + Write `specs/301-fix-sample-bug/fix-report.md`（建立候选）+ Bash `git mv specs/301-fix-sample-bug specs/renamed-nonstandard`（**修正后**：改名到非规范 dst 是唯一无法机械定位新位置的情形；原设计的 mkdir/echo 场景已改判为硬阻断，见 T020b）。断言：
- `runCli({...}).status === 0` 且 `stderr.trim() === ''`（fail-open 静默，不阻断也不误报，呼应既有 `transcript-unavailable` 场景的验证模式）；
- 复用文件内既有 `readVerdictEvents()` 助手读取 `.specify/runs/` 审计事件，断言存在一条 `eventType === 'fix-compliance-verdict'` 事件，其 `compliant === null`、`degraded === true`、`diagnostics` 数组包含 `'feature-dir-unresolvable'`（降级原因可机读区分，呼应 FR-005）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "fail-open 降级|# fail"
```
**期望输出**：新增用例 `ok`，`# fail 0`

---

### T020b [修正新增] 依赖 T003：CLI 端到端 — 只写非制品文件仍阻断（降级触发面收窄的反向回归）

**文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`

**动作**：新增 `describe('CLI 端到端：只写非制品文件仍阻断（降级触发面收窄的反向回归）')`——内联构造 transcript：fix 展开 + Write `specs/301-fix-sample-bug/plan.md` + 一次 implement 委派；沙箱侧 `fs.mkdirSync` 建出该特性目录但**不写 fix-report.md**。断言 `runCli({...}).status === 2`（仍硬阻断）、`--mode report` 的 `missing` 含 `'fix-report.md'`、且 `transcriptDiagnostics` 为空数组（证明未借 `feature-dir-unresolvable` 降级通道放行）。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "降级触发面收窄的反向回归|# fail"
```
**期望输出**：新增用例 `ok`，`# fail 0`

---

### T020c [Phase 5 后 CRITICAL 修复轮] 依赖 T003：fail-open 按维度收窄，不赦免委派证据

**文件**：
- `plugins/spec-driver/scripts/fix-compliance-judge.mjs`（`evaluate()`：删除 ambiguous 整体早退，改为 `featureDirUndetermined` 标记 + judge 后收窄裁决）
- `plugins/spec-driver/tests/fixtures/fix-compliance/resolve-ambiguous-rename-with-delegations.jsonl`（新增：同一非规范改名 + implement/verify 委派）
- `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`、`plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：按 spec FR-004a / plan §2 订正段落实施：`evaluate()` 不再在 `extractDelegationsAfter` 与 `judgeCompliance` 之前 return；仅当 `featureDirUndetermined && (delegationCounts.implement > 0 || delegationCounts.verify > 0)` 才返回 `transcriptDiagnostics:['feature-dir-unresolvable'] + verdict:null`，否则原样返回 verdict。同时把既有 SC-005 降级用例的 transcript 补上 implement/verify 委派（原用例是零委派形态，收窄后应阻断），并新增 `describe('F224 CRITICAL 收窄：改名到非规范目录不得赦免委派证据（SC-005b）')` 覆盖：零委派+改名→exit 2、仅 verify 委派（no-op 形态）+改名→exit 0、两个入库 fixture 的端到端退出码与降级落盘。`judgeCompliance` 入参与判据逻辑零改动。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "SC-005b|# fail"
npm run test:plugins 2>&1 | tail -8
```
**期望输出**：SC-005b 全部用例 `ok`；`# fail 0`

---

### T020d [Phase 5 后 Codex 复审轮] 依赖 T003：`ambiguous` 可恢复（FR-008 多跳改名取最终态）

**文件**：
- `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（`resolveFeatureDirCandidate`：拆出 `trackedDir` / `candidate` 两个状态 + `syncCandidateFromTrackedDir` 闭包）
- `plugins/spec-driver/tests/fix-compliance-core.test.mjs`

**动作**：按 plan §1.2 订正段实施 —— `trackedDir` 无论命名是否规范都跟踪制品当前所在目录，`candidate` 仅在 `trackedDir` 命中 `FIX_DIR_NAME_REGEX` 时才等于它；改名判据由 `src === candidate` 改为 `src === trackedDir`，改名后统一经 `syncCandidateFromTrackedDir()` 重算 `candidate` 与 `ambiguous`。新增 `describe('F224 resolveFeatureDirCandidate：ambiguous 可恢复（FR-008，Codex 复审订正）')`，覆盖：两跳 `合法→非规范→合法`、四跳 `合法→非规范→非规范→合法`、以及"改名链停在非规范中间态仍为 ambiguous"的反向用例。不得放宽 `scanArtifactPath` 判据、不得触碰 `judgeCompliance` 等下游函数。

**验收**：
- 两跳链 → `{"path":"specs/901-fix-x","ambiguous":false}`（订正前为 `{null,true}`）
- 三跳及以上链 → 同样取最终合法态
- 最终态仍非规范 → `{path:null, ambiguous:true}`（降级语义未被放宽）

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "ambiguous 可恢复|# fail"
```
**期望输出**：新增用例全部 `ok`，`# fail 0`

---

### T020e [Phase 5 后 Codex 复审轮] 依赖 T020d：`mv` 异常形态保守化跳过

**文件**：
- `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（`RENAME_COMMAND_REGEX` → `RENAME_COMMAND_SEGMENT_REGEX` + 新增 `parseRenameOperands`）
- `plugins/spec-driver/tests/fix-compliance-core.test.mjs`、`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`

**动作**：改名识别由"直接捕获相邻两 token"改为"先取 mv 参数段、再 token 级数操作数"。`parseRenameOperands` 在下列情形返回 `null`（整条跳过，既不跟随也不置 `ambiguous`）：非 option 操作数 ≠ 2、命中带参数 option（`-t`/`--target-directory`/`-S`/`--suffix`）、option token 数 > 8。新增 `describe('F224 resolveFeatureDirCandidate：mv 异常形态保守化跳过（Codex 复审订正）')` 覆盖 6 种跳过形态 + 2 条正向对照；在 judge-cli 测试补 Codex 给出的两个绕过构造的端到端退出码断言。`plan.md`「已知限界」补记限界 2。

**验收**：
- `mv A B C` 三操作数 → 候选保持改名前的值、`ambiguous` 保持 `false`
- `mv -t` / `mv -S` / 含空格引号路径 / 单操作数 → 同样整条跳过
- 常规 2 操作数形态与 `mv -- SRC DST` 仍正常跟随
- Codex 两个绕过构造（`sed -i` decoy + 改名；`true # mv` 注释形态）hook 模式仍 `EXIT=2`

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs 2>&1 | grep -E "mv 异常形态|# fail"
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs 2>&1 | grep -E "Codex 构造|# fail"
```
**期望输出**：新增用例全部 `ok`，`# fail 0`

---

### T021 依赖 T001-T020 全部完成：全量验证

**动作**：按顺序执行以下命令，确认零失败后本 feature 方可进入 implement 收尾。

**验收命令**：
```bash
node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs
npm run test:plugins
npm run test
npm run repo:check
```
**期望输出**：
- 三个单文件 `node --test` 调用均 `# fail 0`；
- `npm run test:plugins` 汇总 `# fail 0`；
- `npm run test`（`vitest run && npm run test:plugins`）全部 test suite 通过，无 failed test；
- `npm run repo:check` 退出码 `0`（无 drift 告警；本次改动含 `specs/208-.../contracts/*.schema.json` 文档变更，需确认该检查不因此产生误报，如有告警需在 implement 阶段一并处理，不得带着告警交付）
