# 验证报告：F246 symlink 入口守卫恒 false 静默假成功

**Feature**: 246-fix-symlink-entry-guard
**验证方式**: 独立重跑（不采信 implementation-notes 自报，全部命令亲自执行）
**验证时间**: 2026-08-03

---

## 1. Layer 1: Spec-Code 对齐

`spec.md` 为占位模板（fix 模式约定，无需填充），FR 级对齐不适用。改用 tasks.md T001–T008 逐条核对，见第 4 节。

## 2. Layer 1.5: 验证证据核查

implementation-notes.md 第 3 节列出四条命令的**实际退出码 + 输出摘要**（非"should pass"类推测性表述），本轮独立重跑逐条复核如下：

| 命令 | implementation-notes 自报 | 本轮独立重跑 | 一致性 |
|---|---|---|---|
| `npm run build` | exit 0，tsc 零错误 | exit 0，tsc 零错误 | ✅ 一致 |
| `npm run test:plugins` | tests 1072 / pass 1072 / fail 0 | tests 1072 / pass 1072 / fail 0 | ✅ 完全一致 |
| `npx vitest run` | 490 passed \| 4 skipped；6017 passed \| 18 skipped \| 21 todo | 490 passed \| 4 skipped (494)；6017 passed \| 18 skipped \| 21 todo (6056) | ✅ 完全一致 |
| `npm run repo:check` | exit 0，仅 1 条 graph-freshness warning | exit 0，仅同一条 graph-freshness warning，0 fail | ✅ 一致 |

**验证铁律合规判定：COMPLIANT**。四类验证（构建/单元测试/插件测试/仓库门禁）均有可独立复现的真实命令输出，未发现"应该能过""看起来没问题"等推测性表述。

## 3. symlink 端到端抽验（本轮亲自执行，独立于 implementation-notes）

### 3.1 `/tmp` 天然 symlink（macOS `/tmp → /private/tmp`）+ 显式建链双重验证

在系统 `/tmp` 下建符号链接指向本 worktree，经该链路径实跑 3 个已修脚本，与真实路径逐字节比对：

| 脚本 | 真实路径输出 | symlink 路径输出 | 结论 |
|---|---|---|---|
| `scripts/eval-split-sets.mjs` | exit=1，`[split] 必须传 --pool <calibrated-pool.json>` | exit=1，同上 | ✅ 一致（main() 已执行到参数校验） |
| `plugins/spec-driver/scripts/generate-workflow-registry.mjs` | exit=0，`Spec Driver Workflow Registry` 等 4 行 | exit=0，逐字节相同 | ✅ 一致（写入产物 `workflow-index.{json,md}` 触发的 `generatedAt` 时间戳噪声已用 `git checkout --` 还原，未污染仓库） |
| `scripts/spec-drift-cli.mjs --help` | exit=0，992 字节 | exit=0，992 字节，`diff` 判定 IDENTICAL | ✅ 一致 |

### 3.2 旧代码复现（独立于 git stash，使用一次性 detached worktree 隔离）

为独立验证"先红后绿"证据是否可信，且不冒险污染本 worktree（`git stash` 尝试因误用 `-m` 参数导致误 pop 一个无关的历史 stash，已完整回滚见 3.3 节事故记录），改用 `git worktree add --detach <scratch> HEAD` 拉出一份**修复前**的只读副本（HEAD = 2e3a4cd，此时改动均未提交），经符号链接路径实跑：

| 脚本（旧代码，symlink 路径） | 结果 |
|---|---|
| `record-workflow-run.mjs`（旧判定式 `import.meta.url === \`file://${process.argv[1]}\`` ） | exit=0，`.specify/runs/` 目录**未创建**（零副作用） |
| `verify-feature-176.mjs --test-mode`（旧判定式 `fileURLToPath(...) === path.resolve(argv[1])`） | exit=0，stdout **长度为 0**（空转） |

失败签名与 fix-report 描述的 bug 表征、implementation-notes 2.1 节引用的 `git stash` 红测试输出完全吻合：**exit 0 + 零副作用/空 stdout**。证据可信。验证完毕后 `git worktree remove --force` 清理。

### 3.3 事故记录与恢复（诚实披露）

验证过程中一次 `git stash push -- <files> -m "..."` 因 `-m` 参数位置错误未能匹配路径规格，命令实际以 exit 1 失败但脚本未 `set -e` 中断，随后 `git stash pop` 弹出了一个**与本次任务无关的历史 stash**（`stash@{0}`：F171 时代遗留，标题"F171 时代弃置 mid-integration 残留"），造成 `src/mcp/*`、`specs/171-file-navigation-mcp-tools/*`、`vitest.config.ts` 等 12+ 文件的误合并与冲突标记。

**恢复动作**：`git checkout HEAD -- <全部受污染文件>` + `git reset HEAD -- .`，确认恢复后 `git status --short` 与污染前完全一致（仅剩 F246 合法改动，28 个 `.mjs` 修改 + 4 个新增），`git diff --stat` 精确回到 `28 files changed, 71 insertions(+), 46 deletions(-)`（与 implementation-notes 声称的规模完全一致），且 `stash@{0}` 未被 drop（仍在 `git stash list` 中，未销毁他人历史遗留数据）。全仓 grep 确认无冲突标记（`<<<<<<<`/`>>>>>>>`）残留。

此事故不影响本次 F246 交付内容本身，但作为验证过程的诚实记录附此。

## 4. tasks.md T001–T008 完成判据逐条核对

| Task | 判据 | 独立核对结果 |
|---|---|---|
| T001 | canonical helper 存在，导出 `isInvokedDirectly`，`typeof` 输出 `function` | ✅ 文件存在，`node -e import` 输出 `function` |
| T002 | 薄壳仅一行 re-export，同样 `typeof` 输出 `function` | ✅ 文件内容仅注释块 + 1 行 `export { isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/is-invoked-directly.mjs';`，import 后 `typeof` = `function` |
| T003 | `scripts/*.mjs` 入口守卫（非 endsWith/业务参数类）命中数为 0 | ✅ 剩余 4 处命中逐一核实：`graph-semantic-diff.mjs`（业务参数非入口守卫）、`feature-170d-driver-preference.mjs`（纯 `endsWith`）、`verify-feature-154.mjs`（`endsWith` fallback 分支免疫）、`sync-agent-docs.mjs`（双侧 realpath 正确写法，本次对齐目标），均属 fix-report 已定性的"安全不动"类，无遗漏真实 bug 站点 |
| T004 | `swebench-dataset-build.mjs` 同目录 import 路径 `./is-invoked-directly.mjs` | ✅ 已核实 |
| T005 | `plugins/spec-driver/scripts/*.mjs` 下旧判定式命中数为 0 | ✅ `grep -rln 'file://${process.argv[1]}'` 命中数 = 0 |
| T006 | helper 单测（5 case，含额外 case 1b）全绿 | ✅ 独立 `node --test` 单文件跑出 7 tests（5 单元 + 2 集成）全 PASS |
| T007 | symlink 集成测试红→绿证据可信 | ✅ 独立复现（见 3.2 节，用 detached worktree 代替 git stash），红色签名（exit 0 + 零副作用/空 stdout）与声称一致；当前代码绿测试独立确认 7/7 |
| T008 | 全量验证 4 命令 + 3 脚本抽查 | ✅ 全部独立复现，见第 2、3 节；额外补充对全部 31 个新增/修改 `.mjs` 文件跑 `node --check`，31/31 通过 |

**全仓 `isInvokedDirectly(import.meta.url)` 调用点计数**：独立 grep 得 23，与 fix-report 影响面清单一一对应。

## 5. judge 闭包 roster 联动（implementation-notes 偏差 #3）核实

- `judge-snapshot-core.mjs` 的 `JUDGE_FILE_SET` 已新增 `'scripts/lib/is-invoked-directly.mjs'`（第 22 行）
- `judge-snapshot-doctor.test.mjs` 未硬编码文件名，而是 `import { JUDGE_FILE_SET }` 后用 `r.files.length === 7` 断言，动态跟随 roster 长度，设计稳健
- 独立单跑 4 个 judge 相关测试文件：58/58 全绿

## 6. 4a/4b 报告结论一致性

- spec-review.md（4a）：PASS，0 CRITICAL / 1 WARNING（judge roster 连带影响未被 fix-report 预判，但已合规处置）/ 1 INFO（plan §2.3 判断误差，已修正）——均为记录性，implementation-notes 已如实记录为"偏差 #2/#3"，不构成阻断项
- quality-review.md（4b）：EXCELLENT，0 CRITICAL / 1 WARNING（双侧 realpath 同时失败场景缺专门测试锁定，代码走查判定安全但无测试覆盖）/ 1 INFO（`--preserve-symlinks-main` 分析为推导非实测）——均为**建议性加固**，不构成已发现的功能缺陷，两份报告结论一致，无冲突、无遗留未处置的 CRITICAL 或阻断性发现

两份报告与本轮独立验证结论无矛盾。WARNING 项均为"建议补充测试覆盖"类非阻断项，未来 follow-up 可处理，不影响本次交付。

## 7. 总体结果

| 验证维度 | 结果 |
|---|---|
| Layer 1（Spec-Code 对齐） | 不适用（spec.md 为 fix 模式占位模板，符合约定） |
| Layer 1.5（验证证据） | COMPLIANT |
| Layer 2（原生工具链：build/test:plugins/vitest/repo:check） | 4/4 PASS，退出码与输出均与自报逐字/逐数一致 |
| symlink 端到端抽验 | PASS（3 个真实路径 vs symlink 路径逐字节比对一致 + 旧代码红色复现签名吻合） |
| tasks.md T001–T008 | 8/8 PASS |
| judge roster 闭包联动 | PASS（58/58） |
| 4a/4b 报告一致性 | PASS（无未处置 CRITICAL，WARNING 均为建议性） |

## ✅ READY FOR REVIEW（可提交结论）

本次修复经完全独立重跑验证（未采信任何自报数据），四项工具链命令、tasks.md 全部完成判据、symlink 真实端到端行为、红→绿回归证据均可复现且与实施记录一致。验证过程中出现的 `git stash` 误操作事故已完整回滚且不影响交付物本身，已诚实记录于第 3.3 节。

无需修复即可提交。
