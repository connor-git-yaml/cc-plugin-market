# 实施记录：symlink 入口守卫恒 false 静默假成功

**Feature**: 246-fix-symlink-entry-guard
**模式**: fix
**前序制品**: `fix-report.md`（5-Why + 23 处影响面）、`plan.md`（修复设计）、`tasks.md`（T001–T008）

---

## 1. 任务完成情况

| Task | 内容 | 状态 |
|------|------|------|
| T001 | 新建 canonical helper `plugins/spec-driver/scripts/lib/is-invoked-directly.mjs` | ✅ 完成 |
| T002 | 新建仓库根薄壳 `scripts/lib/is-invoked-directly.mjs`（纯 re-export） | ✅ 完成 |
| T003 | 替换批 A：`scripts/` 顶层 14 处 | ✅ 完成（3 个显式检查项逐条核对） |
| T004 | 替换批 B：`scripts/lib/swebench-dataset-build.mjs`（同目录 import 路径） | ✅ 完成 |
| T005 | 替换批 C：`plugins/spec-driver/scripts/` 下 8 处 | ✅ 完成 |
| T006 | helper 单元测试（4 case，实际写了 5 个） | ✅ 完成 |
| T007 | 红测试：symlink 集成测试（先证伪后证实） | ✅ 完成 |
| T008 | 全量验证（4 命令 + 3 脚本 symlink 抽查） | ✅ 完成 |

**改动规模**：28 个文件修改 + 3 个新文件（helper ×2 + 测试 ×1），`git diff --stat` 汇总 `71 insertions(+), 46 deletions(-)`。

### T003 三个显式检查项核对结果

| 检查项 | 结果 |
|--------|------|
| `baseline-collect.mjs` L887-889 整 `\|\|` 表达式一次性替换为单行 | ✅ 三行整体替换为 `const isCliEntry = isInvokedDirectly(import.meta.url);`，无死代码残留 |
| `spec-drift-cli.mjs` 连带删除孤儿 `pathToFileURL` import + 更新过时注释 | ✅ 替换前 grep 确认全文件仅 2 处命中（import 行 + 判定式），已删 `import { pathToFileURL } from 'node:url';`（该文件对 `node:url` 无其他引用），注释改写为"改用共享 helper（两侧 realpath canonical 化），同时兼容 Windows 盘符编码与符号链接" |
| `calibrate-glm-judge.mjs` 保留 `__filename` 声明 | ✅ 替换前确认 L77 `__dirname = path.dirname(__filename)` 仍依赖它，仅替换 L1231 右值，L76 声明原样保留 |

### 各文件中间变量名保留情况

`isCliEntry` / `isMain` / `isDirectRun` 均按各文件原名保留，只替换右侧表达式；`if (...)` 直接判定形式（9 处）整体替换条件。无无关重构。

---

## 2. 红测试：先证伪再证实（T007 核心证据）

测试文件：`plugins/spec-driver/tests/is-invoked-directly.test.mjs`（`node --test`，由 `npm run test:plugins` 自动枚举收集）。

### 2.1 证伪（红）：临时回退目标脚本到旧判定式

```
git stash push -- plugins/spec-driver/scripts/record-workflow-run.mjs scripts/verify-feature-176.mjs
```

回退后确认判定式已还原为旧形态：

```
record-workflow-run.mjs:403: if (import.meta.url === `file://${process.argv[1]}`) {
verify-feature-176.mjs:205:  const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
```

`node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs` 实际输出（两个集成用例 FAIL）：

```
✖ record-workflow-run.mjs 经 symlink 调用 → run 事件真实落盘
  AssertionError: runs 目录未创建（main() 未执行）stdout= stderr=
  false !== true

✖ verify-feature-176.mjs --test-mode 经 symlink 调用 → stdout 产出逐 step JSON
  AssertionError: 期望至少 1 行 {step,ok,detail} JSON，实际 0 行（main() 未执行）stdout=""
```

失败签名与 fix-report 描述的 bug 表征逐字吻合：**stdout 为空、stderr 为空、无任何产物落盘**。5 个 helper 单元用例在此状态下仍 PASS（它们测的是新 helper 本身，与目标脚本是否已替换无关），说明红信号精确来自集成层而非单元层。

### 2.2 证实（绿）：恢复修复

```
git stash pop
```

恢复后确认两文件均为 `isInvokedDirectly(import.meta.url)`，重跑：

```
ℹ tests 7
ℹ suites 2
ℹ pass 7
ℹ fail 0
```

### 2.3 断言设计说明

按 plan §4.2 要求，两个集成用例都**先断言真实副作用**：

- `record-workflow-run.mjs`：先断 `.specify/runs/` 目录存在 → jsonl 文件数 == 1 → 内容可解析且 `workflowId` / `runId` / `result` 匹配；`res.status === 0` 放在**最后**，仅作辅助信号
- `verify-feature-176.mjs --test-mode`：断 stdout 至少 1 行可解析为 `{step, ok, detail}` 的 JSON，**不**断言退出码（该脚本 test-mode 下因仓库产物状态必然 exit 1，与本回归无关）

这是本 bug 的必要设计：旧代码下两个脚本都是 **exit 0**，任何只断退出码的测试对该 bug 完全失明。

### 2.4 单元用例（T006）

5 个 case 全绿。除 plan 要求的 4 个外，额外补 **case 1b**：`argv[1]` 经符号链接指向模块自身 → 返回 `true`，并同时断言 `path.resolve(linked) !== HELPER_PATH`——把"旧写法在此恒 false"这一事实固化为断言，使该用例成为修法语义的直接守护（而非仅覆盖分支）。

---

## 3. 全量验证结果（T008）

| 命令 | 退出码 | 输出摘要 |
|------|--------|----------|
| `npm run build` | 0 | `tsc` 零错误；postbuild 盖章 `commit=2e3a4cdd (dirty)` |
| `npm run test:plugins` | 0 | `tests 1072 / suites 180 / pass 1072 / fail 0 / duration_ms 2716` |
| `npx vitest run` | 0 | `Test Files 490 passed \| 4 skipped (494)`；`Tests 6017 passed \| 18 skipped \| 21 todo (6056)`；Duration 52.89s |
| `npm run repo:check` | 0 | 全 gate pass；1 条 warning（见下） |

**vitest 无 flaky 命中**：预存 flaky 名单（`watch-command.test.ts`、`batch-orchestrator-incremental`、`community-analysis`）本轮全部通过，无需隔离重跑。

**repo:check 唯一 warning（判定为既存、非本次引入）**：

```
[graph-quality] 图产物记录的 sourceCommit（8d25c264…）与当前 HEAD（2e3a4cdd…）不一致（commit 级 stale），请重新建图。
```

判定依据：该 warning 反映的是知识图谱产物构建于上一个 commit（8d25c26 = F239 收官 commit），与工作区改动无关；且本次改动全部落在 `.mjs` 脚本，Spectra 图谱不索引该类文件（plan 附注已实测）。gate 结果为 `warn` 而非 `fail`，`repo:check` 整体 exit 0。

### 3 个脚本 symlink 手工抽查

经符号链接目录与真实路径各跑一次并逐字节比对输出：

| 脚本 | 真实路径 | symlink 路径 | 结论 |
|------|----------|--------------|------|
| `scripts/eval-split-sets.mjs` | exit=1, 47 字节 | exit=1, 47 字节 | ✅ 一致（输出 `[split] 必须传 --pool <calibrated-pool.json>`，证明 main() 已执行到参数校验） |
| `plugins/spec-driver/scripts/generate-workflow-registry.mjs` | exit=0, 188 字节 | exit=0, 188 字节 | ✅ 一致（输出 `Spec Driver Workflow Registry`） |
| `scripts/spec-drift-cli.mjs --help` | exit=0, 991 字节 | exit=0, 991 字节 | ✅ 一致（输出用法文本）；**额外确认删除 `pathToFileURL` import 后无加载期/运行期报错** |

补充：另对全部 25 个新增/修改的 `.mjs` 文件逐个跑 `node --check`，25/25 通过（并用一个故意构造的坏文件反向验证 `node --check` 对该类语法错误确实报错，排除"检查器是空转"的可能）。

---

## 4. 偏差与处置

| # | 偏差 | 处置 |
|---|------|------|
| 1 | **薄壳文件注释里的 `plugins/*/scripts/` 含字面 `*/`，提前终止块注释** → 首版 `scripts/lib/is-invoked-directly.mjs` 加载即 `SyntaxError: Unexpected end of input` | 立即发现（T002 完成判据的 `node -e import` 冒烟即报错）并改写为 `plugins/<plugin>/scripts/`。这正是 plan 要求跑完成判据冒烟而非"看着对就过"的价值；已纳入后续 `node --check` 全量扫描 |
| 2 | **plan §2.3 判断不准**：该节称"除 `spec-drift-cli.mjs` 外其余 22 处的 `path`/`fileURLToPath` 均仍有其他用途"，实际 `scripts/freeze-preregistration.mjs`、`scripts/verify-feature-176.mjs` 在替换后 `fileURLToPath` 成为孤儿 import（0 处引用） | 按 T003「通用检查项」逐文件核实后删除这 2 行孤儿 import（属本次改动直接造成的死代码，符合仓库"删除未使用导入"约定，非无关重构）。两文件的 `path` 导入仍在用，保留 |
| 3 | **watch-out #4 命中**（tasks 已预警）：`record-workflow-run.mjs` 位于 `fix-compliance-judge.mjs` 的 import 闭包内，新增 helper import 后闭包由 6 文件变 7 文件，`judge-file-set-guard` roster 断言变红 | 按该测试设计意图**显式把新文件列入 roster**（而非绕过）：`JUDGE_FILE_SET` 增加 `scripts/lib/is-invoked-directly.mjs`（附 F246 说明注释），并同步 4 处 roster 派生断言：`judge-file-set-guard.test.mjs`（size 6→7）、`judge-snapshot-core.test.mjs`（length 6→7 + 期望集合补该文件）、`judge-snapshot-doctor.test.mjs`（`files.length` 6→7、match 计数 5→6、#12 混合场景 4→5、相关用例标题与注释同步）、`judge-snapshot-doctor-cli.test.mjs`（测试本地清单副本补该文件）。修改后 `test:plugins` 1072/1072 全绿 |
| 4 | 首次创建 helper 时误写入**主仓库路径**而非 worktree | 两文件当时均为 untracked，已在主仓库 `rm` 删除并确认主仓库 `git status` 恢复干净，随后在 worktree 内重建。主仓库无残留 |

### 未处置（按 plan §6 明确不做，已复核确认）

- `scripts/lib/graph-bootstrap-status.mjs`（L577-578）：同源坏但归 F241 收口，本次未动
- `scripts/feature-170d-driver-preference.mjs`（L346）、`scripts/verify-feature-154.mjs`（L367）：替换后 grep 残留命中，逐处复核确认属 fix-report 已定性的 `endsWith` 组——前者纯 `endsWith` 判定，后者为 `旧式比对 || argv[1]?.endsWith(...)`，`endsWith` 分支在 symlink 下仍返回 true，**不构成本 bug 的假成功**，且用户已明确排除"写法统一"选项，故不动
- `scripts/sync-agent-docs.mjs`（L144）：已是双侧 realpath 正确写法，即本次对齐目标
- 未升级 release contract 版本；未改 `specs/src.spec.md` / `specs/plugins.spec.md`（本次工作区也未出现这两个文件的再生噪声）

---

## 5. 完成判据复核

| tasks.md 判据 | 实测 |
|---------------|------|
| T003：`grep "argv\[1\]" scripts/*.mjs` 入口守卫命中降为 0 | ✅ 仅剩 2 处 `endsWith` 组 + 1 处 F241 显式排除项，均已逐处复核定性 |
| T005：`grep -rln 'file://${process.argv[1]}' plugins/spec-driver/scripts/*.mjs` 命中 0 | ✅ count=0 |
| 全仓 `isInvokedDirectly(import.meta.url)` 调用点 | ✅ 23 处，与 fix-report 影响面 23 处一一对应 |
| T002 薄壳只 re-export | ✅ 文件仅含注释 + 1 行 `export { isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/is-invoked-directly.mjs';` |

---

## 6. 工具使用反馈（Dogfooding）

- **Spectra MCP 未使用**：plan 阶段已实测知识图谱不索引 `.mjs`（`impact` / `context` 对目标文件返回 `symbol-not-found`），本次改动 100% 落在 `.mjs` 脚本，按任务提示直接退回 Grep / Read，未重复重试。**缺口结论与 plan 一致**：`scripts/` 与 `plugins/*/scripts/` 下的脚本类文件在图谱中不可见，导致该类改动的 caller / blast-radius 分析完全依赖手工 grep。
- 本次偏差 #3（judge import 闭包连带影响）恰是这一缺口的实例代价：`record-workflow-run.mjs` 被 `fix-compliance-judge.mjs` 传递依赖这件事，图谱无法给出，只能靠 tasks.md 的人工预警 + 跑测试撞红发现；若 Spectra 覆盖 `.mjs`，一次 `impact --direction upstream` 即可在改动前列出该闭包。建议作为后续「Spectra 索引范围扩展到脚本类 `.mjs`」候选 Feature 的实证依据。
- Spec Driver 流程侧无阻塞：fix-report → plan → tasks 三件制品的判定式清单与行号在实施时逐条可核（仅 §2.3 的孤儿 import 判断有偏差，已如实记录在偏差 #2），tasks 的 watch-out 预警实际命中并直接指明了正确处置方式（显式更新 roster 而非绕过）。

---

## 7. Codex 对抗审查轮（implement phase review）

Codex 对本 feature 主体改动做对抗审查，抓到 **1 CRITICAL + 1 WARNING**，本轮全部修复。

### R1（CRITICAL）helper 反向误判：query/hash import 副本被判 `true`

**问题**：`fileURLToPath(moduleUrl)` 会丢弃 URL 的 `search`/`hash`。ESM 按**完整 URL**区分模块实例，故 `file://x.mjs?q` 与 `file://x.mjs` 是两个实例、同一物理文件被求值两次；而守卫丢弃 query 后两侧 realpath 相等 → 副本也判 `true` → `main()` **执行两次**。

这是本次统一 helper 造成的**语义回退**：原 23 处里 13 处 URL 字符串级旧写法（`import.meta.url === \`file://${...}\``）本能把带 query 的副本判 `false`。且该失败形态比原 bug 更危险——原 bug 是静默不执行（少做事），反向误判是重复执行（多做事，对有写副作用的脚本意味着重复落盘 / 重复记录）。

**修法**（`plugins/spec-driver/scripts/lib/is-invoked-directly.mjs`）：在 `fileURLToPath` **之前**按 URL 形态短路——

```js
const parsedUrl = new URL(moduleUrl);
if (parsedUrl.search !== '' || parsedUrl.hash !== '') return false;
```

判据依据：主入口模块的 URL **恒无** search/hash（`argv[1]` 是文件系统路径，Node 由 `pathToFileURL` 生成主入口 URL 时不带这两段），故带 search/hash 的实例必是 import 副本。同时在文件头「不变量」段补写该边界，并新增一段说明 `--preserve-symlinks-main` 属**合同外**场景（仓库不使用该 flag；开启后主入口 URL 保留 symlink 原路径，「经 symlink 主入口执行」与「import 同一物理文件」在 canonical 层面不可区分，helper 无法只凭 URL + argv[1] 判身份——F241 已 ship 的同语义实现与仓库既有 6 处 realpath 站点同此边界，本 helper 不解决也不恶化）。

仓库根 `scripts/lib/is-invoked-directly.mjs` 是纯 re-export 薄壳（T002 约定），单一 canonical 实现，修复自动覆盖两侧，无需重复改。

**新增测试**（`plugins/spec-driver/tests/is-invoked-directly.test.mjs`，3 条）：

| 用例 | 内容 |
|------|------|
| case 5 | `moduleUrl` 带 `?query` 且路径同 `argv[1]` → `false`（同用例内先断无 query 时为 `true` 做对照） |
| case 6 | `moduleUrl` 带 `#hash` 同上 → `false` |
| 集成回归锁 | 复刻 Codex 反例：`node --import '<spec-drift-cli file URL>?f246-import-copy' <spec-drift-cli> --help`，断言 stdout 中 `用法：` 开头的行**恰好 1 条** |

**红绿取证**（先写断言、helper 未修时跑）：

- 红：`node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs` → `tests 10 / pass 7 / fail 3`，三条新用例全红；集成用例失败信息为 `期望用法头恰好 1 次，实际 2 次`
- 手工反例（helper 未修）：`node --import "file://$PWD/scripts/spec-drift-cli.mjs?f246-import-copy" $PWD/scripts/spec-drift-cli.mjs --help | grep -c '^用法：'` → **2**
- 绿（helper 修复后）：同命令 → **1**；`node --test …` → `tests 10 / pass 10 / fail 0`

### R2（WARNING）F236 六文件 MUST 合同与运行时 7 文件分叉

**问题**：主体轮已把 `scripts/lib/is-invoked-directly.mjs` 显式列入 `JUDGE_FILE_SET`（运行时 roster = 7），但 F236 的文档合同仍写死 6，形成「MUST 条款与运行时事实分叉」——后续读 spec 的人会以 6 为准，守卫测试却按 7 断言。

**修法**：把 F236 三份**活合同**文档中所有受 roster 规模影响的数字更新为 7，并在数字旁标注演进来源（统一措辞：*F236 定为 6，F246 起 +`scripts/lib/is-invoked-directly.mjs`*）：

| 文件 | 更新点 |
|------|--------|
| `specs/236-.../spec.md` | FR-002 MUST 条款（6→7 并补入新路径）；US1 验收场景 1「（6 个文件）」→ 7；§背景「实测核实的关键事实」条目**保留 F236 时点的历史结论**，追加「后续演进」说明指向 7 与 FR-002 |
| `specs/236-.../data-model.md` | §1 正文补「共 7 个文件」+ 演进注；§1 代码示例数组补入 `scripts/lib/is-invoked-directly.mjs`（原示例只有 6 项，与运行时不一致）；§4 三处 `files` 字段注释 6 条→7 条；§7.3 dynamic import 粗检「当前 6 个判定器文件」→7；§7.5「对仓库真实 6 文件跑 BFS」→7 |
| `specs/236-.../contracts/judge-snapshot-drift-result.md` | 核心接口表 `JUDGE_FILE_SET` 类型说明 6→7 + 演进注；`DriftCheckResult` 注释「全部 6 条明细」→7；判定基准表场景 7（7 文件全 match / 7 条 match）、场景 8（其余 6 / 6 条 match）、场景 11（其余 6 / 其余 6 条 match）、场景 12（其余 5 条 match） |
| `plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs` | `writeJudgeFiles` 与 `makeRepoProjectRoot` 的 JSDoc「6 个文件 / <6文件>」→ 7（主体轮已改的 `makeSnapshotDir` 一致化）；:296 的「其余 6 个文件」经核实在 roster=7 下**本就正确**（7−1），未动 |

契约表的场景计数已**逐条对照测试实际断言核实**（`#7 files.length===7 全 match`、`#8 match===6`、`#11 files.length===7 且 match===6`、`#12 match===5`），文档与断言现完全一致。

**范围裁剪（有意不动，避免超范围改动）**：`specs/236-.../{plan.md, research.md, tasks.md}` 与 `verification/verification-report.md` 中的「6」属**设计过程记录与时点验证记录**（如 verification-report 记录的是 F236 当时对 6 文件的实测输出），不是活合同，retro-edit 会破坏其作为历史证据的价值。活合同（spec FR / data-model 实体定义 / contracts 接口与判定基准）已全部对齐。

### 本轮验证输出（全部实跑）

| 命令 | 结果 |
|------|------|
| `node --test plugins/spec-driver/tests/is-invoked-directly.test.mjs` | `tests 10 / pass 10 / fail 0`（修前 `pass 7 / fail 3`） |
| `npm run test:plugins` | `tests 1075 / pass 1075 / fail 0 / suites 181` |
| `npx vitest run` | `Test Files 490 passed \| 4 skipped`，`Tests 6017 passed \| 18 skipped \| 21 todo`，0 failed（预存 flaky 三件本轮均绿，无需隔离定性） |
| `npm run build` | EXIT=0，`tsc` 零错误 |
| `npm run repo:check` | EXIT=0，全族 pass；唯一 warning `graph-quality:freshness`（图产物 sourceCommit `8d25c26` 与 HEAD `2e3a4cd` 不一致）为**预存**，与本轮改动无关 |
| Codex 原始反例手工复跑 | `node --import '<file-url>?f246-import-copy' scripts/spec-drift-cli.mjs --help` → 用法头输出**恰 1 次**，EXIT=0 |

工作区无 `specs/products/` 与 `.specify/*.suggestions.*` 再生噪声，无需 checkout 还原。本轮未 commit。
