# Spec 合规审查报告 — F246 symlink 入口守卫恒 false

> Phase 4a spec-review 子代理产出（其工具集无 Write，由主编排器代为落盘，内容未经改写）。

## 1. 根因一致性

逐文件核对了全部 23 处替换点（15 处 `scripts/` + 8 处 `plugins/spec-driver/scripts/`），实测结果与 fix-report/plan/tasks 记录的判定式、行号、修复动作**逐字对应**：

- `scripts/baseline-collect.mjs`：原三行 `||` 表达式（L887-889）已整体折叠为单行 `const isCliEntry = isInvokedDirectly(import.meta.url);`，无死代码残留 — PASS
- `scripts/calibrate-glm-judge.mjs`：`__filename`/`__dirname` 声明（L77-78）按计划保留，仅替换 L1232 右值 — PASS
- `scripts/spec-drift-cli.mjs`：判定式替换为 `isInvokedDirectly(import.meta.url)`，孤儿 `pathToFileURL` import 已删除（grep 全文件确认零残留引用）— PASS
- `scripts/lib/swebench-dataset-build.mjs`：同目录特殊路径 `./is-invoked-directly.mjs`（无 `lib/` 前缀）正确落实 — PASS
- `plugins/spec-driver/scripts/record-workflow-run.mjs`：`if (isInvokedDirectly(import.meta.url))` 替换到位，Read 全文确认逻辑无变化 — PASS
- 两侧 helper 文件（`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs` canonical、`scripts/lib/is-invoked-directly.mjs` 薄壳）实现与 plan §1.1/1.2 的代码块**逐字一致**（含 realpath 失败回退 `path.resolve`、`argv[1]` 缺失返回 false、薄壳仅一行 re-export）— PASS

全仓 `isInvokedDirectly(import.meta.url)` 调用点计数 = 23，与 fix-report 影响面清单一一对应，无漏改、无多改。

**结论：PASS**

## 2. 范围纪律

- `scripts/lib/graph-bootstrap-status.mjs`（L577-578）：grep 确认仍是旧判定式，未被触碰，如 plan §6 "明确不做"所述（归 F241 收口）— PASS
- 20 处 `endsWith` 判定站点：抽查全部命中（`eval-judge.mjs`、`baseline-diff.mjs`、`eval-report.mjs` 等）均未改动 — PASS
- 9 处已定性 `[安全]` 的 realpath 站点（3 处单侧 `fix-compliance-judge.mjs`/`goal-loop-cli.mjs`/`judge-snapshot-doctor.mjs` + 6 处双侧 `sync-agent-docs.mjs`/`validate-skill-sources.mjs`/`sync-skill-mirrors.mjs`/`validate-wrapper-sources.mjs`/`extract-wrapper-body.mjs`/`detect-codex-capability.mjs`）：grep 确认全部保持原写法未动 — PASS
- 2 处非入口守卫的 `argv` 命中（`graph-semantic-diff.mjs` L261-264、`import-closure-helper.mjs` L141）：确认仍是业务参数解析，未被误改 — PASS
- **judge roster 闭包最小面**：`judge-snapshot-core.mjs` 的 `JUDGE_FILE_SET` 新增一行 `scripts/lib/is-invoked-directly.mjs`（路径含义为"相对 `plugins/spec-driver/` 的路径"，文件头注释已核实此约定），对应实际是 canonical helper 文件——路径写法与既有条目风格一致，非误标；4 处 roster 派生断言（`judge-file-set-guard.test.mjs` 的 `relFiles.size` 6→7、`judge-snapshot-core.test.mjs`、`judge-snapshot-doctor.test.mjs` 三处 `files.length` 6→7、`judge-snapshot-doctor-cli.test.mjs`）均已同步且改动仅限计数/roster 条目，未触及判定逻辑本身 — PASS，此处属 fix-report 未预判但 implementation-notes 如实记录的连带最小改动，未逾越"闭包 6→7 显式列入"授权范围
- release contract、`specs/src.spec.md`/`specs/plugins.spec.md`：Glob/Grep 未发现改动痕迹，未升版本 — PASS

**结论：PASS**（含一处需要留意但已判定为合规的连带改动，见下方 WARNING 备注）

**WARNING（记录性，非阻断）**：judge roster 改动虽严格限定在"新增 1 个文件路径 + 同步计数断言"，但这是 fix-report 影响面扫描阶段**未预判到**的连带效应（fix-report/plan 均未提及 judge 闭包会因新增 helper 而变化）。属于合理的、必要的连带修复（不修就会导致 `judge-file-set-guard.test.mjs` 挂红），implementation-notes.md 已如实记录为"偏差 #3"并说明处置依据（按测试设计意图显式列入而非绕过）。判定：**范围纪律未被违反**，但建议后续 fix-report 类似"新建被广泛 import 的共享文件"场景应在诊断阶段主动检查是否落入既有 judge/roster 类闭包快照，避免实施阶段才发现。

## 3. 合同保持（被 import 恒 false 语义）

- 抽查 `eval-task-runner.mjs`：`isInvokedDirectly` helper 内部对"两个不同文件比较"的逻辑未变（`canonicalInvoked === canonicalModule`，两文件路径不同则 canonical 化后仍不同）——被其 9 个消费方 import 时行为不变，语义成立
- 抽查 `swebench-dataset-build.mjs`：同理，helper 对"被 import 场景"是行为不变的安全替换
- `record-workflow-run.mjs` 集成测试（T007）red→green 两阶段实测（`git stash` 回退验证真失败签名 stdout/stderr 均空，`git stash pop` 后验证真实副作用落盘）为该不变量提供了直接证据，而非仅靠静态论证
- `npm run test:plugins` 1072/1072 全绿，涵盖既有 20 处 import 依赖方测试（如 `record-workflow-run.test.mjs`）——回归验证到位

**结论：PASS**

## 4. Spec 同步判定

`spec.md` 确认仍为模板占位符（Draft 状态、`[FEATURE NAME]`、`FR-001` 等占位文本原样保留），与 plan §6 "不做 spec.md 完整填充"的 fix 模式约定一致，且本次改动确无用户可见行为变更（纯内部 bug 修复，无新增/变更外部接口）。fix-report 判定"无需更新 spec"仍然成立。

**结论：PASS**

---

## 总体合规率

23/23 目标替换点 + 2 个 helper 新建文件 + 1 个红测试文件，与 fix-report/plan/tasks 三级制品的判定式清单、文件路径、行号、连带清理项**逐条核实一致**。未发现范围外行为变更，未发现遗漏或多改。

**合规率：100%（23/23 FR-等效修复点已实现，0 处未实现/部分实现）**

## 偏差清单

| 项 | 状态 | 偏差描述 | 结论 |
|----|------|---------|------|
| judge roster 闭包连带更新 | WARNING（记录性） | fix-report 影响面扫描未预判到新建 helper 会进入 `fix-compliance-judge.mjs` 的 import 闭包，导致 judge 快照 roster 计数需从 6→7 | 已按测试设计意图正确处置（显式列入而非绕过/放宽断言），不构成范围违规，implementation-notes 已如实记录为"偏差 #3" |
| plan §2.3 判断不准 | INFO | plan 称"除 spec-drift-cli.mjs 外其余 22 处 path/fileURLToPath 均有其他用途"，实测 `freeze-preregistration.mjs`、`verify-feature-176.mjs` 的 `fileURLToPath` 替换后成孤儿 import | 已按仓库"删除未使用导入"约定清理，implementation-notes 已如实记录为"偏差 #2"，不影响功能正确性 |

无 CRITICAL 项。

## 过度实现检测

未发现 spec/fix-report/plan 未定义的额外功能。新增的 2 个 helper 文件、1 个测试文件均在 plan §1/§4 明确设计范围内；judge roster 的连带更新是维持既有测试不挂红的必要最小改动，不构成新功能。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 1 个（judge roster 连带影响未被 fix-report 预判，但已合规处置，不阻断交付）
- INFO: 1 个（plan 一处次要判断误差，已如实记录并正确修复）

## 单一总判定

**PASS（可交付）**。实现与 fix-report 的根因诊断、plan 的修复设计、tasks 的任务清单在文件级、行级均逐一对齐；范围纪律严格遵守"明确不做"清单；20 处被 import 承重脚本的"恒 false"合同经静态论证 + red/green 集成测试双重验证保持不变；spec.md 无需更新的判定仍然成立。两处记录性偏差均已在 implementation-notes.md 中如实披露并做出合理处置，不影响本次交付的合规性判定。
