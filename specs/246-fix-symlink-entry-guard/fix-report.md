# 问题修复报告

## 问题描述

仓库内一批 `.mjs` 脚本用「argv[1] 与 import.meta.url 字符串比对」判定"是否被直接执行"来决定是否运行 `main()`。在符号链接路径下（macOS `/tmp → /private/tmp`、软链的插件安装目录、软链 worktree 等），Node ESM loader 给出的 `import.meta.url` 是 realpath，而 `process.argv[1]` 保留调用方原始路径，两者恒不等 → 守卫恒 false → `main()` 永不执行 → **exit 0 且零副作用（静默空转假成功）**。

## 实测验证（诊断阶段 probe，scratchpad 内实跑）

对同一脚本经真实路径与符号链接目录各执行一次，五种在仓库中实际出现的判定式结果：

| 判定式 | 真实路径 | symlink 路径 | 结论 |
|---|---|---|---|
| A. `path.resolve(argv[1]) === path.resolve(fileURLToPath(import.meta.url))` | true | **false** | 同源坏 |
| B. `` import.meta.url === `file://${argv[1]}` `` | true | **false** | 同源坏（另有百分号编码/Windows 盘符问题） |
| E. `pathToFileURL(argv[1]).href === import.meta.url` | true | **false** | 同源坏（只修了 B 的编码问题，没修 symlink） |
| C. `argv[1]?.endsWith('x.mjs')` | true | true | 免疫（文件名不随 symlink 变） |
| D. `realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url))` | true | true | 正确写法（F241 已实证） |

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 经 symlink 路径调用时脚本为何什么都不做还 exit 0？ | 入口守卫判定"非直接执行"，`main()` 被跳过，模块顶层无其他副作用 |
| Why 2 | 守卫为何判定失败？ | 比较的两侧规范化程度不对称：`import.meta.url` 已被 ESM loader canonical 化（realpath），`argv[1]` 是未 canonical 化的调用路径 |
| Why 3 | 这种不对称写法为何存在？ | 写法假设「指向同一文件 ⇒ `path.resolve` 后字符串相等」，但 `path.resolve` 只做词法归一（`.`、`..`、分隔符），不做文件系统 canonical 化；Node 默认 `--preserve-symlinks-main=false` 会解析主入口 symlink |
| Why 4 | 该假设为何长期不暴露？ | 开发与 CI 始终在真实路径下执行仓库脚本；错误 pattern 经复制粘贴扩散 30+ 处；直到 F241 在 symlink 场景（graph keepalive）才首次实测踩中 |
| Why 5 | 为何未被现有测试/门禁捕获？ | (1) 没有任何测试经 symlink 路径执行脚本；(2) 失败形态是 **exit 0 静默空转**，凡只断言退出码的验证全绿——bug 的表征恰是"一切正常"；(3) 入口守卫无共享 helper、无 lint 约束，每个新脚本各自手写、各自漂移 |

**Root Cause**: 入口守卫比较未 canonical 化的 `argv[1]` 与已 canonical 化的 `import.meta.url`，且缺少共享 helper 导致错误写法复制扩散；静默空转（exit 0）形态天然逃过一切只看退出码的验证。
**Root Cause Chain**: symlink 下脚本假成功 → 守卫恒 false → 两侧规范化不对称 → `path.resolve` 词法归一 ≠ 文件系统 canonical 化 → 真实路径环境掩盖 + 复制扩散 → 无 symlink 测试 + exit 0 无信号。

`[ROOT CAUSE REACHED at Why 5]`

## 影响范围扫描

穷举命令：`grep -rn "argv\[1\]" scripts/ plugins/ --include="*.mjs"`（诊断阶段实跑），逐处人工定性。

### 同源问题（需同步修复，共 23 处）

**scripts/ 下 15 处（评测/验证脚本）**：

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| scripts/baseline-collect.mjs | L888-889 | B×2（双写法两侧全坏） | 改用共享 helper |
| scripts/calibrate-glm-judge.mjs | L1231 | A（`__filename` 即 `fileURLToPath(import.meta.url)`，L76 已核实） | 改用共享 helper |
| scripts/eval-calibrate.mjs | L520 | A | 改用共享 helper |
| scripts/eval-offline-rejudge.mjs | L476 | B | 改用共享 helper |
| scripts/eval-pool-rerun.mjs | L448 | A | 改用共享 helper |
| scripts/eval-split-sets.mjs | L244 | A | 改用共享 helper |
| scripts/eval-task-runner.mjs | L1083 | A | 改用共享 helper |
| scripts/eval-validate.mjs | L414 | A | 改用共享 helper |
| scripts/freeze-preregistration.mjs | L122 | A | 改用共享 helper |
| scripts/graph-accuracy.mjs | L626 | B | 改用共享 helper |
| scripts/lib/swebench-dataset-build.mjs | L113 | B | 改用共享 helper |
| scripts/spec-drift-cli.mjs | L281 | E（L279 注释表明是有意修 Windows 编码，未覆盖 symlink） | 改用共享 helper |
| scripts/spike-cohort3-plugin-mcp.mjs | L360 | A | 改用共享 helper |
| scripts/swe-bench-verified-cohort-batch.mjs | L590 | A | 改用共享 helper |
| scripts/verify-feature-176.mjs | L205 | A | 改用共享 helper |

**plugins/spec-driver/scripts/ 下 8 处（随插件分发的产品脚本）**：

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| generate-adoption-insights.mjs | L566 | B | 改用共享 helper |
| generate-product-entity-catalog.mjs | L468 | B | 改用共享 helper |
| generate-product-quality-reports.mjs | L9 | B | 改用共享 helper |
| generate-product-scorecards.mjs | L9 | B | 改用共享 helper |
| generate-project-context-suggestions.mjs | L605 | B | 改用共享 helper |
| generate-workflow-registry.mjs | L12 | B | 改用共享 helper |
| record-workflow-run.mjs | L403 | B | 改用共享 helper |
| sync-merge-engine.mjs | L659 | B | 改用共享 helper |

**风险分级说明**：插件 8 处后果最直接——`record-workflow-run.mjs` 是各 SKILL 收尾用 `node "$PLUGIN_DIR/scripts/record-workflow-run.mjs"` 直调的生产路径（`$PLUGIN_DIR` 指向 `~/.claude/plugins/cache/...`，任一路径段为 symlink 即静默丢 run 事件）。scripts/ 15 处是「跑批看起来完成了，实际零 run」风险形态（与 F206 "Surge 代理死曾致 106 run 全废"同类）。

### 显式排除（1 处）

| 文件 | 位置 | 原因 |
|------|------|------|
| scripts/lib/graph-bootstrap-status.mjs | L577-578 | 同源坏，但并行 F241 分支（`claude/f241-keepalive-kb-grounding-54ef99`）已将其重写为薄壳 + canonical `isInvokedDirectly`；本树修改必然与 F241 合入冲突，归 F241 收口 |

### 类似模式（已逐处评估，全部 [安全]，不动）

| 分组 | 文件（处数） | 评估结果 |
|------|------|----------|
| endsWith 判定 | baseline-diff / eval-batch-repeat / eval-competitor / eval-diff-fuzzy-match / eval-feature-158-summary-classic / eval-grounding / eval-judge / eval-judge-jury / eval-mcp-augmented / eval-mcp-augmented-classic / eval-refresh-self / eval-report / eval-task-executor / eval-task-fixture-check / verify-feature-154 / verify-feature-158-classic / feature-170d-driver-preference / sync-delegation-contract / sync-preference-rules / validate-orchestrator-models（20） | [安全] 文件名不随 symlink 变，实测免疫。语义偏松（任何同名文件都命中）但非本 bug，不在本轮重构（用户已明确排除写法统一选项） |
| 双侧 realpath | scripts/sync-agent-docs.mjs、plugins/spec-driver/scripts/lib/{detect-codex-capability,extract-wrapper-body}.mjs、plugins/spec-driver/scripts/validate-wrapper-sources.mjs、plugins/spectra/scripts/{sync-skill-mirrors,validate-skill-sources}.mjs（6） | [安全] 正确写法，即本次修法的对齐目标 |
| 单侧 realpath（仅 argv[1] 侧） | plugins/spec-driver/scripts/{fix-compliance-judge L494, goal-loop-cli L305, judge-snapshot-doctor L260}（3） | [安全] 默认 flag 下 `import.meta.url` 已是 realpath，单侧规范化即相等；仅 `--preserve-symlinks-main` 显式开启时才可能漂移（仓库无此用法），不动 |
| 非入口守卫 | scripts/graph-semantic-diff.mjs L261-264、plugins/spec-driver/tests/lib/import-closure-helper.mjs L141 | [不适用] `argv` 是 `process.argv.slice(2)` 后的业务参数，与入口判定无关 |

### 同步更新清单

- **调用方**：无需改动。23 处里 20 处同时被 import 当模块用（tests / 跨脚本 / `scripts/lib/repo-maintenance-core.mjs` sync 链，诊断阶段已穷举），守卫是承重的：修法必须保持「被 import 时恒 false」语义（helper 天然满足：import 场景 argv[1] 是 test runner / 上游脚本路径，realpath 后仍不等）
- **测试**：新增红测试——建 symlink 目录、经 symlink 路径实跑代表性脚本、**断言真实副作用发生**（产物文件落盘/预期 stdout 内容），不得只断退出码（本 bug 表征就是 exit 0）。模式对齐 F241 的 `graph-bootstrap-status-shim.test.mjs`（该文件在 F241 分支，模式描述取自其设计：symlink 目录 + 实跑 + 副作用断言）
- **文档**：无。specs/src.spec.md、specs/plugins.spec.md 为自动再生产物，勿手改
- **release contract**：本 fix 不升版本（仓库惯例：版本升级随下次发布批量走，如 4.3.0→4.4.0 间多个 fix 合批）；插件脚本改动后跑 `npm run repo:check` 复核 sync 门禁

## 修复策略

### 方案 A（推荐）：抽共享 helper，canonical 放插件侧 + 仓库根薄壳

1. **新建 canonical**：`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`，导出 `isInvokedDirectly(moduleUrl)`——`argv[1]` 缺失返回 false；两侧各自 `fs.realpathSync` canonical 化，失败（路径不存在/不可读）回退 `path.resolve`（守卫不得因解析不了而抛错）。语义与 F241 已实证实现逐字对齐
2. **新建薄壳**：`scripts/lib/is-invoked-directly.mjs`，单行 re-export canonical（照 F241 的 D8 薄壳模式；`scripts → plugins` 方向 import 仓库内已有先例 `repo-maintenance-core.mjs`，反方向禁止——插件分发后无法回引仓库根）
3. **23 处替换**：各脚本删除手写判定，改 `import { isInvokedDirectly } from '<相对路径>/lib/is-invoked-directly.mjs'` + `if (isInvokedDirectly(import.meta.url))`。scripts/ 下 15 处走薄壳，plugins 下 8 处走 canonical
4. **红测试**：symlink 目录实跑 + 副作用断言（见同步更新清单）
5. **F241 合入后的收敛预留**：F241 的 `graph-bootstrap-status.mjs` 内嵌一份同语义 `isInvokedDirectly`，其合入后建议改 import 本 helper 收敛为单一实现（followup，不阻塞本 fix，也不构成冲突——文件名不同）

选择理由：F241 的 T027a 教训——"两处各写一份 `path.resolve` 比对的历史结果是同一个符号链接 bug 在两边并存"。23 份 inline 副本必然重演漂移。

### 方案 B（备选）：每处 inline 双侧 realpath

与现存 6 处 [安全] 写法一致、无跨目录 import，但制造 23 份重复实现，直接违背 T027a 教训与仓库"消除重复"约定。不推荐。

## Spec 影响

- 需要更新的 spec：**无需更新**（涉改脚本无 per-script spec；`src.spec.md` / `plugins.spec.md` 为自动再生产物）
