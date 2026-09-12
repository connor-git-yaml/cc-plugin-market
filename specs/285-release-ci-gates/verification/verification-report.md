# F285 验证报告 · 发布 / CI 门补齐（verify 子代理，亲跑核验）

> 对象：`specs/285-release-ci-gates/fix-report.md` 的每条声称。立场：不采信转述，默认先找假绿 / over-claim；每条结论附命令与关键输出。
> 工作树：`.claude/worktrees/f285-release-ci-gates`（branch `285-release-ci-gates`，基于 `9362f1a8`，改动未 commit）。全程零 git 写操作；除本报告外未改任何被 git 跟踪的文件（验证副作用见 §4 R8）。
> 环境：macOS 26.6.2 · 18 核 · Node v24.14.0 · tsc 5.9.3 · vitest 3.2.4 · `node_modules` 软链主 checkout。
> 验证期间 `origin/master` 已前移到 `1112e18a`（F280 后续热修，主线程 push），本工作树仍基于 `9362f1a8`——这直接影响 §4 R1 与 T009。

## 0. 方法说明

| 层 | 做法 |
|---|---|
| Layer 1 对账 | 对 fix-report §1/§2/§3/§4 每条声称在本工作树亲跑：`node -e` 读 package.json；python `yaml.safe_load` 结构化解析 ci.yml（node 侧无 yaml 包）；tsc 三路实跑，**错误数一律 `grep -c 'error TS'`、文件数用 CI 步骤同款 `sed 's/(.*//' \| sort -u \| wc -l`，不看 `tail`**；`npm run build` → `batch --mode graph-only` → `npm run test:coverage` 完整跑两遍（本机默认 9 worker 一遍、`VITEST_MAX_FORKS=1` CI 镜像一遍）；six per-file 四列从 `coverage/coverage-final.json` 重算（text 表把文件名截断成 `...extractor.mjs`，无法按名 grep）。 |
| 反证实验 | (a) 「排除 tests/fixtures/ 是必需的」：临时副本去掉该 exclude 后跑 tsc，看是否坍缩成 1；(b) 「TS7016 用 allowJs 解决」：scratchpad 绝对路径副本做 allowJs true/false A/B，先证副本与原配置等价（1022/147 复现）再比对；(c) 「阈值未达即非零退出」：单文件 `--coverage`（覆盖率必远低于阈值）做正向对照，`--coverage.reportsDirectory` 隔离到 scratchpad；(d) 「热修后 typecheck:tests 自然转绿」：`git archive 1112e18a`（只读）导出到 scratchpad 实跑三段 tsc。 |
| Layer 2 守护力 | 对 `tests/unit/release-ci-gates.test.ts` 做 17 个变异（4 个任务卡指定 + 11 个加做 + 2 个规避探针）。每次：备份 → python 变异工作树文件 → `npx vitest run tests/unit/release-ci-gates.test.ts` → `cp` 还原 → 与变异前 sha256 逐文件比对（4 文件全部一致才算还原 OK）。 |
| 只读旁证 | 主 checkout 只跑 `git`/`gh` 只读命令（`gh run list`、`git status -sb`、`git rev-parse`），未在主 checkout 跑任何 npm/vitest。 |

## 1. Layer 1 对账表

### 1.1 fix-report §1 问题与证据（改动前）

| # | 声称 | 核验命令 | 实测 | 判定 |
|---|---|---|---|---|
| W-6 | 改动前 prepublishOnly 不跑 test:plugins / typecheck:tests | `git show HEAD:package.json` → scripts.prepublishOnly | `npm run release:check && npm run build && npm run repo:check && npx vitest run --maxWorkers=4` | ✅ |
| W-6 | test:plugins「1843 用例」 | `npm run test:plugins` | `tests 1840 / pass 1838 / fail 0 / skipped 2`，exit 0，32.32 s | ⚠️ 数字偏差（1840 总 / 1838 过），方向不变 |
| W-7 | vitest.config.ts 有全局 80% + 六文件 95% 阈值，无门禁执行 `--coverage` | 读 `vitest.config.ts`；`git diff HEAD -- .github/workflows/ci.yml package.json` | 阈值段属实（含 `src/mcp/lib/file-nav-helpers.ts`，注意路径带 `lib/`）；改动前 ci.yml 与 prepublishOnly 均无 coverage | ✅ |
| W-1 | 根 tsconfig 只 include src/；tests/ 553 + src/**/*.test.ts 13 + scripts/*.ts 零类型门 | `find tests -name '*.ts' -not -path 'tests/fixtures/*' -not -path 'tests/type-tests/*' \| wc -l`；`find src -name '*.test.ts' \| wc -l`；`ls scripts/*.ts` | 554（含本卡新增的 release-ci-gates.test.ts，即改动前 553）/ 13 / 3；`tsc -p tsconfig.tests.json --listFilesOnly` 实际纳入 tests 554 · src 343 · scripts 69（含 allowJs 拉入的 .mjs）· plugins 41 | ✅ |
| INFO | CI Test 步跑 `npm test` 且后面又有 `if: always()` 的 mjs gate → 二跑 | `git diff HEAD -- .github/workflows/ci.yml` | 改动前 L75 为 `npm test`，L131-132 独立 gate 存在 | ✅ |
| INFO | claude-review.yml 六连败（最近 2026-05-09） | 主 checkout 只读 `gh run list --workflow=claude-review.yml --limit 10` | 返回 8 条，**全部 `failure`**，最近 `2026-05-09T17:21:58Z`（最早可见 2026-04-12） | ⚠️ 「六连败」是低估（可见 ≥8 连败），结论方向不变 |

### 1.2 fix-report §2 修复

| # | 声称 | 核验命令 | 实测 | 判定 |
|---|---|---|---|---|
| 2.1 | prepublishOnly = release:check → build → repo:check → typecheck:tests → vitest → test:plugins；full 不进 | `node -e 'console.log(require("./package.json").scripts.prepublishOnly)'` | `npm run release:check && npm run build && npm run repo:check && npm run typecheck:tests && npx vitest run --maxWorkers=4 && npm run test:plugins`；不含 `typecheck:tests:full`、不含 `\|\|` | ✅ 内容与顺序属实 |
| 2.1 | （隐含）新接的两个门在本分支可通过 | `npm run typecheck:tests`；`npm run test:plugins` | **typecheck:tests：exit 2，64 错 / 21 文件**（全在 `src/`，TS2379×29、TS2375×18、TS2322×7、TS2412×4、TS18046×4；只有第一段 `tests/type-tests/tsconfig.json`（`exactOptionalPropertyTypes: true`）红，f220/f222 两段 0 错）；test:plugins exit 0 | ❌ **prepublishOnly 接了一个当前在本分支红的门**——见 §4 R1：已实证该红由基线 `9362f1a8` 带入、热修 `1112e18a` 树上三段全绿，rebase 后自然转绿，不是本卡要修的 |
| 2.2 | 独立 coverage job，与 test 并行，build + 建图 + `VITEST_MAX_FORKS=1` + `npm run test:coverage` | python yaml 解析 | `jobs` 键 = `['test', 'coverage']`；coverage 无 `needs`；步序 Checkout(fetch-depth 0) → Setup Node 20 → `npm ci` → `npm run build` → `node dist/cli/index.js batch --mode graph-only` → `Coverage (thresholds enforced)`（env `VITEST_MAX_FORKS: "1"`，run `npm run test:coverage`）；`test:coverage = vitest run --coverage` | ✅ |
| 2.2 | CI 能装上 coverage provider（本地能跑 ≠ CI 能跑） | `node -e` 读 devDependencies；`grep package-lock.json` | `@vitest/coverage-v8 ^3.0.4` 在 devDependencies，lockfile 有条目，已装 3.2.4 | ✅ |
| 2.2 | `VITEST_MAX_FORKS=1` 真的生效 | `grep -rn VITEST_MAX_FORKS node_modules/vitest/dist/`；1-fork 运行中 `pgrep -f 'node \(vitest [0-9]+\)'` | 仓库源码里该变量**只出现在注释与 ci.yml**，但 vitest 3.2.4 本体在 `chunks/coverage.DL5VHqXY.js:3733-3741` 读 `process.env.VITEST_MAX_FORKS` → `poolOptions.forks.maxForks`；镜像运行实测仅 1 个 `node (vitest 1)` worker | ✅ 接线属实（由 vitest 本体承担） |
| 2.2 | 本机全量实跑 All files 88.13 / 85.53 / 94.78 / 88.13，六个 per-file 95% 全达标，无 `does not meet`，exit 0 | 见 §1.4 coverage 实测表 | All files **88.13 / 85.52 / 94.78 / 88.13**（branches 差 0.01）；六文件全部 ≥95；零 `does not meet`；**但默认 9 worker 下 npm exit=1**（`Errors 1 error`：`[vitest-worker]: Timeout calling "onTaskUpdate"`，F235/F269 记录的 birpc 60 s 硬超时「全绿假红」形态，8205 用例全过）；`VITEST_MAX_FORKS=1` 镜像（Run B）：**exit 0、无 Unhandled、无 does not meet、数值逐位相同**，8 min 40 s | ✅ 阈值声称属实；「exit 0」在 CI 等价配置（1 fork）下复现，本机默认 9 worker 下一次 birpc 假红（见 §4 R2，不是阈值问题） |
| 2.2 | 阈值未达时 vitest 非零退出即红 | 单文件 `npx vitest run --coverage tests/unit/release-ci-gates.test.ts --coverage.reportsDirectory=<scratchpad>` | `ERROR: Coverage for lines (0%) does not meet global threshold (80%)` + 六文件各四条 `does not meet "…" threshold (95%)`，exit 1；工作树 `coverage/` 未被改写 | ✅ 机制实证 |
| 2.3 | tsconfig.tests.json：extends 根、allowJs + !checkJs、排除 type-tests 与 fixtures | `cat tsconfig.tests.json` | `extends ./tsconfig.json`；`allowJs: true, checkJs: false, noEmit, rootDir ".", types ["node"]`；include `src/**/*.ts, tests/**/*.ts, scripts/**/*.ts`；exclude `node_modules, dist, tests/type-tests/**, tests/fixtures/**, **/*.d.ts` | ✅ |
| 2.3 | `npm run typecheck:tests:full` 基线 1022 处 / 147 文件；TS2532 272、TS2339 242、TS2322 115、TS18048 111、TS2345 92、TS18047 61；tests/unit 835、integration 84、panoramic 75 | `npm run typecheck:tests:full > log; grep -c 'error TS' log; grep 'error TS' log \| sed 's/(.*//' \| sort -u \| wc -l` | exit 2；**1022 / 147**；错误码 272 / 242 / 115 / 111 / 92 / 61（另 TS2578 40、TS2353 18）；目录 835 / 84 / 75（另 e2e 7、src/panoramic 7、kb 5、adapters 3、spec-store 2、self-hosting 1、helpers 1、global-setup.ts 1、extraction 1） | ✅ 逐字吻合 |
| 2.3 | CI 步骤 `continue-on-error: true`，打印 exit / errors / files 与错误码 Top5，if 与治理步骤相同 | python yaml 解析 | 步骤名 `Type Check Tests (full, report-only)`；`if` 与 Repo Check / Release Check / Type Check Tests **逐字相同**；全 ci.yml 唯一带 `continue-on-error` 的步骤；run 块 `set +e`（GH 默认 `bash -e`，必需）→ `grep -c 'error TS' … \|\| true`（0 命中时 grep 退 1，有兜底）→ `exit $status`（步骤红但被 allow） | ✅ 语义正确 |
| 2.4 | CI Test 步只跑 `npx vitest run`（保留 VITEST_MAX_FORKS 诊断行）；`run: npm run test:plugins` 恰 1 行 | python yaml 解析 + `grep -cE '^\s*run: npm run test:plugins\s*$'` | Test 步去注释命令行 = `[node -e 护栏, echo "[ci-diag] …", npx vitest run]`，无 `npm test`（词边界）；`run: npm run test:plugins` 恰 1 行，所在步 `if: ${{ always() }}` | ✅ |
| 2.5 | 删 claude-review.yml | `git status --short`；`test -e` | `D  .github/workflows/claude-review.yml`（已 staged），磁盘不存在；目录仅剩 baseline-collect / ci / fixture-isolation | ✅ |
| 2.6 | 守护测试 6/6 | `npx vitest run tests/unit/release-ci-gates.test.ts` | `Tests 6 passed (6)`，exit 0；守护力见 §2 | ✅（守护有一处字面量盲区，见 §4 R3） |

### 1.3 fix-report §3 实测教训 / §4 影响范围

| # | 声称 | 核验 | 实测 | 判定 |
|---|---|---|---|---|
| 3.1 | 不排除 tests/fixtures/ 时 tsc 只报 1 个 TS1109、其余 1021 处一个不报 | 临时副本 `tsconfig.tests.f285verify-nofixtures.tmp.json`（仅去掉 `tests/fixtures/**`）`tsc -p … --noEmit --pretty false`，跑完即删（`git status` 无残留） | **恰 1 错**：`tests/fixtures/spec-drift/parser-degrade/broken.ts(6,29): error TS1109: Expression expected.`，exit 2 | ✅ 排除是必需的（否则 CI 步骤会报 errors=1 假绿） |
| 3.2 | 只看 `tail` 会把 1022 看成 1 | 同上 | tsc 输出末尾是多行缩进的错误详情（`Type 'Buffer<…>' is not assignable …`），不含 `error TS` 计数信息 | ✅ 教训成立 |
| 3.3 | .mjs 静态 import 的 TS7016 用 allowJs 解决 | scratchpad 绝对路径副本 A/B | A（allowJs=true）= 1022 / 147 / TS7016=0（与原配置等价）；B（allowJs=false）= **631 / 144 / TS7016=88**——allowJs 消掉 88 处 TS7016 的同时把 .mjs 导出按推断类型参与检查，暴露出 TS2339 14→242、TS2345 38→92 等净增 391 处 | ✅ 且说明 1022 是「.mjs 带类型」的更诚实口径 |
| 4 | 发布路径 +≈1 min（test:plugins 32 s + typecheck:tests） | `/usr/bin/time -p` | test:plugins 32.32 s；typecheck:tests 单段 0.94 s（红时短路；绿时三段合计约 3 s） | ✅ |
| 4 | coverage job 4 vCPU 估 15–25 min | 本机 1-fork 镜像耗时（§1.4 Run B） | 18 核 Apple Silicon 单 fork 8 min 40 s（不含 npm ci / build / 建图）；4 vCPU runner 单核更慢 + 前置步骤约 3 min | ✅ 量级合理（CI 实测要等 T009 首跑） |

### 1.4 coverage 实测表

前置：`npm run build`（exit 0，2.28 s，distSha256 `3f14164…` 与 build 前一致）→ `node dist/cli/index.js batch --mode graph-only`（exit 0，7.05 s；工作树原图是 mtime `Sep 12 20:49` 的陈旧副本，早于 HEAD 提交 `23:48`，7802 节点 → 重建后 7825 节点 / 13349 边，镜像 CI coverage job 第 5 步）。

**Run A · 本机默认（18 核 → 9 worker），`npm run test:coverage`，01:03:48–01:05:17（88.78 s）**

| 项 | 实测 |
|---|---|
| 汇总 | `Test Files 552 passed \| 4 skipped (556)`；`Tests 8205 passed \| 15 skipped \| 12 todo (8232)`；**`Errors 1 error`** |
| 退出码 | **npm exit=1**（`Unhandled Error: [vitest-worker]: Timeout calling "onTaskUpdate"` at `vitest/dist/chunks/rpc.-pEldfrD.js:53`）——全部用例通过、无阈值告警，退出码来自 birpc 60 s 硬超时（F235/F269 已登记的假红类别） |
| skipped 文件 | eval-judge-jury-sdk（2）/ feature-170c-driver e2e（2）/ llm-token-extraction（1）/ feature-170d-driver-preference e2e（4）——凭据/驱动门控，与图无关 |
| `does not meet` / `threshold` 行 | **0 行** |
| All files（text 表） | `88.13 \| 85.52 \| 94.78 \| 88.13`（fix-report 写 branches 85.53，差 0.01） |
| All files（JSON 重算，311 文件） | `88.13 / 85.52 / 94.78 / 88.13` |

六个 per-file（从 `coverage/coverage-final.json` 重算；括号内为 text 表值，±0.01 属 istanbul 取整差）：

| 文件 | Stmts | Branch | Funcs | Lines | ≥95 |
|---|---|---|---|---|---|
| scripts/lib/extractor-helpers.mjs | 97.32 (97.31) | 95.71 | 100 | 97.32 (97.31) | PASS |
| scripts/lib/ts-call-extractor.mjs | 100 | 97.71 (97.7) | 100 | 100 | PASS |
| scripts/lib/go-call-extractor.mjs | 97.42 | 95.62 (95.61) | 100 | 97.42 | PASS |
| scripts/lib/java-call-extractor.mjs | 100 | 96.46 | 100 | 100 | PASS |
| src/mcp/file-nav-tools.ts | 99.22 | 96.15 | 100 | 99.22 | PASS |
| src/mcp/lib/file-nav-helpers.ts | 99.12 | 98.37 | 100 | 99.12 | PASS |

注意 go-call-extractor / extractor-helpers 的 branch 只有 95.62 / 95.71，离 95 阈值余量 <1 个百分点——任一分支新增未测即红，这是设计如此（F150 SC-001），但要有心理准备。

**Run B · CI 镜像 `VITEST_MAX_FORKS=1 npm run test:coverage`（nohup 脱离，01:08:56 起）**

| 项 | 实测 |
|---|---|
| 并发 | 运行中 `pgrep -f 'node \(vitest [0-9]+\)'` = 1（仅 `node (vitest 1)`），env 生效 |
| 汇总 | `Test Files 552 passed \| 4 skipped (556)`；`Tests 8205 passed \| 15 skipped \| 12 todo (8232)`；**无 `Errors` 行** |
| 退出码 | **npm exit=0**（`/usr/bin/time`：real 519.94 s = 8 min 40 s；vitest Duration 519.41 s，其中 tests 441.36 s / collect 24.87 s） |
| Unhandled / `does not meet` / `ERROR: Coverage` | **0 行** |
| All files（text 表 = JSON 重算） | `88.13 \| 85.52 \| 94.78 \| 88.13`，311 文件 |
| 六个 per-file | 与 Run A **逐位相同**（extractor-helpers 97.32/95.71/100/97.32 · ts 100/97.71/100/100 · go 97.42/95.62/100/97.42 · java 100/96.46/100/100 · file-nav-tools 99.22/96.15/100/99.22 · file-nav-helpers 99.12/98.37/100/99.12），六个全部 ≥95 |
| skipped 文件 | 与 Run A 相同的 4 个（凭据/驱动门控） |

**Run A vs Run B 结论**：覆盖率数值与 skip 集合两次完全一致（覆盖率是确定量）；退出码差异（1 vs 0）**只**来自 Run A 的 `[vitest-worker]: Timeout calling "onTaskUpdate"`——9 worker + v8 采集下主进程饱和触发 F235/F269 的触发面①（多 worker 争抢），1 fork 即消失。CI coverage job 钉 `VITEST_MAX_FORKS=1` 正是这条缓解，故 fix-report「阈值全达标、exit 0」在 CI 等价配置下**成立**；其「本机全量实跑 exit 0」应理解为「在不触发 birpc 超时的那次运行里 exit 0」，本机默认并发 + coverage 并不稳定复现。本机 1-fork 8 min 40 s（18 核 Apple Silicon）→ fix-report 对 4 vCPU runner「15–25 min」的估计量级合理（含 npm ci / build / 建图约 +3 min，单核更慢）。

## 2. Layer 2 变异表（`tests/unit/release-ci-gates.test.ts`）

基线 M0：`Tests 6 passed (6)`，exit 0。每行「还原」= 4 文件 sha256 与变异前一致且 claude-review.yml 不在磁盘。

| # | 变异 | 预期 | 实测 | 还原 |
|---|---|---|---|---|
| M1 ★ | ci.yml Test 步 `npx vitest run` → `npm test`（原形态，10 空格） | 红 | **红** `1 failed \| 5 passed`，用例 3（`:43`） | OK |
| M1b ◎ | Test 步 → `npm run test`（语义等价 → mjs 二跑） | 探针 | **绿 6/6 — 守护未命中** | OK |
| M1c ◎ | Test 步整段 `run: \|` 块改为单行 `run: npm test`（8 空格） | 探针 | **绿 6/6 — 守护未命中** | OK |
| M2 ★ | 删掉整个 coverage job | 红 | **红**，用例 5（`:64`） | OK |
| M3 ★ | 去掉 `continue-on-error: true` 行 | 红 | **红**，用例 4（`:57`） | OK |
| M3b | `continue-on-error: true` → `false` | 红 | **红**，用例 4（`:57`） | OK |
| M4 ★ | prepublishOnly 去掉 ` && npm run test:plugins` | 红 | **红**，用例 1（`:27`） | OK |
| M4b | prepublishOnly 去掉 ` && npm run typecheck:tests` | 红 | **红**，用例 1（`:27`） | OK |
| M5 | prepublishOnly 追加 ` && npm run typecheck:tests:full` | 红 | **红**，用例 1（`:23`） | OK |
| M5b | prepublishOnly 乱序：typecheck:tests 挪到 vitest 之后 | 红 | **红**，用例 1（`:27`） | OK |
| M5c | prepublishOnly 追加 ` \|\| true` 兜底 | 红 | **红**，用例 1（`:30`） | OK |
| M6 | 复活 claude-review.yml（`git show HEAD:` 只读写回磁盘） | 红 | **红**，用例 6（`:72`） | OK |
| M7 | full 类型门 `if` 改成 `always()` | 红 | **红**，用例 4（`:56`） | OK |
| M8 | tsconfig.tests.json exclude 去掉 `tests/fixtures/**` | 红 | **红**，用例 2（`:37`） | OK |
| M9 | mjs gate 后再加一步 `run: npm run test:plugins` | 红 | **红**，用例 3（`:45`，计数 2≠1） | OK |
| M10 | coverage job `VITEST_MAX_FORKS` → `"2"` | 红 | **红**，用例 5（`:67`） | OK |
| M11 | mjs gate `if: always()` → `success()` | 红 | **红**，用例 3（`:48`） | OK |

★ = 任务卡指定的 4 个必做变异（全红）；◎ = 规避探针。15/15 真变异全红；2/2 规避探针绿（守护盲区，见 §4 R3）。收尾 `git status --short` 与验证开始时逐行一致。

## 3. tasks.md 逐条

| 任务 | 判定 | 依据 |
|---|---|---|
| T001 prepublishOnly 接 typecheck:tests + test:plugins（full 不进） | **PASS**（带 R1） | §1.2 行 2.1；M4/M4b/M5/M5b/M5c 全红 |
| T002 coverage job（本机 88.13/85.53/94.78/88.13，阈值全达标） | **PASS**（带 R2） | §1.4 Run B（CI 镜像 1 fork）exit 0 + 六文件全 ≥95 + All files 88.13/85.52/94.78/88.13；正向对照证明阈值执行链路存在；Run A 的 exit 1 是 9-worker birpc 假红，非阈值 |
| T003 tsconfig.tests.json + typecheck:tests:full + CI 只报不阻断（基线 1022 / 147） | **PASS** | §1.2 行 2.3；§1.3 行 3.1/3.3；M3/M3b/M7/M8 全红 |
| T004 CI Test 步只跑 vitest；test:plugins 单跑 | **PASS** | §1.2 行 2.4；M1/M9/M11 红（M1b/M1c 探针盲区登记 R3） |
| T005 删 claude-review.yml | **PASS** | §1.2 行 2.5；M6 红 |
| T006 守护测试 6/6 | **PASS** | M0 6/6；15/15 变异红 |
| T007 全量门禁 | **沿用主线程结果**：build 0 / vitest 8205 passed / test:plugins 1838 / repo:check 0 / release:check 0（来源：主线程在主 checkout 亲跑，本报告未在主 checkout 跑任何 npm）。本工作树交叉印证：build exit 0；test:plugins 1838 pass / 0 fail；coverage 运行内 vitest 8205 passed；typecheck:tests **exit 2（64 错，R1）** | 
| T008 verify 报告 | 本文件 | |
| T009 rebase master → ff push → 删分支 | **未到**。注意 `origin/master` 已是 `1112e18a`（不是 `9362f1a8`），rebase 目标随之更新；rebase 后须复跑 `npm run typecheck:tests`（预期 exit 0，见 R1）并重看 §1.2 行 2.3 的 1022 基线是否漂移（R5） | |

## 4. 残余风险与处置

**R1 · prepublishOnly 接了一个当前在本分支红的门（`npm run typecheck:tests`，exit 2 / 64 错）。**
事实：64 错全在 `src/`（`src/panoramic/generators/runtime-topology-generator.ts` 16、`architecture-ir-builder.ts` 13、`architecture-overview-generator.ts` 6 …），错误码 TS2379/TS2375 = `exactOptionalPropertyTypes: true`（`tests/type-tests/tsconfig.json` 独有）下的可选属性赋值——由基线 `9362f1a8`（F280）的 type-only import 把这些 src 文件拖进严格程序闭包所致，与 F285 的任何改动无关（F285 未触碰 src/ 与 type-tests/）。
实证：`git archive 1112e18a`（只读）导出 `src tests/type-tests scripts plugins package.json tsconfig.json` 到 scratchpad、软链 node_modules 后跑三段 tsc → **`tsconfig.json` / `f220` / `f222` 全部 exit 0、0 错**；本工作树同三段 = 64 / 0 / 0。主 checkout `git status -sb` = `## master...origin/master`（无 ahead/behind），即 `1112e18a` 已在远端。CI 旁证（只读 `gh run view`）：`9362f1a8` 的 run 34703495054 中 `Type Check Tests = failure`（其余 Test / Repo Check / Release Check / Test Plugins 均 success）；`1112e18a` 的 run 34706781506 **completed / success，含 `Type Check Tests = success`**——与 archive 树实证互相印证。
处置：本卡**不修**（不是本卡缺陷，且修在 src/ 越权）。T009 rebase 到 `≥1112e18a` 后自然转绿；rebase 后必须复跑 `npm run typecheck:tests` 确认 exit 0，再走 ff push。建议 fix-report §4「影响范围与边界」补一句「prepublishOnly 新接的 typecheck:tests 在基线 9362f1a8 上红（F280 遗留，1112e18a 已修），rebase 后生效」——目前 fix-report 对此零字，读者会把「接门」误读成「门已绿」。

**R2 · coverage job 的 birpc 假红风险（CI 上尚无一次实跑证据）。**
事实：Run A（9 worker + coverage 采集）复现 F235/F269 签名 `Timeout calling "onTaskUpdate"` → 8205 全过却 exit 1。coverage job 若在 CI 上碰到同样超时，会红在「阈值全达标」的状态下，与 test job 的 `VITEST_MAX_FORKS=1` 缓解面同源；v8 coverage 采集会加重主进程负担，是新的触发变量。
缓解：job 已钉 `VITEST_MAX_FORKS: "1"`（§1.2 已证 vitest 本体读取、实测 1 worker）；Run B（1 fork + coverage）exit 0、无 Unhandled，说明该缓解对触发面①在本机有效。未覆盖的是触发面②（单文件同步 spawn 长链，与 worker 数无关；F269 已修 graph-quality-cli 那一处），coverage 采集让每个文件更慢，是否会把别的文件推过 60 s 静默窗口只有 CI 实跑能答。
处置：**T009 push 后的首个 CI run 才是这条 job 的真验证**，主线程应在 push report 的「下一步」里显式写「盯 coverage job 首跑结论」；若首跑假红且用例全过，按 F269 的静默窗口分析法定位文件（该 job 不在 test job 关键路径，不会连坐）。fix-report §2.2「本机全量实跑 … exit 0」建议补注「本机默认并发 + coverage 会偶发 F235 birpc 假红（exit 1、用例全过），CI 配置 1 fork 下 exit 0」，避免读者把 exit 0 当成本机任意并发下的稳定性质。

**R3 · 守护测试对 `npm test` 的断言是字面量（`'\n          npm test\n'`，10 空格缩进），两种等价回潮形态绕过（M1b `npm run test`、M1c 单行 `run: npm test`）。**
影响：mjs 面二跑静默回潮的两条现实路径（有人「简化」Test 步为单行、或写成 `npm run test`）守护不报。不阻断：精确回退形态（M1）被抓，`run: npm run test:plugins` 恰 1 行的计数断言独立于此仍抓二跑的另一半（M9）。
建议（后续小补，不塞本卡也可）：把断言改成对 Test 步 run 块去注释后做 `/\bnpm (run )?test\b/` 词边界匹配，或直接用 yaml 解析取 `jobs.test.steps[name=Test].run`。

**R4 · fix-report 三处数字小偏差（不影响结论）**：「六连败」实为可见 ≥8 连败；「1843 用例」实为 1840 tests / 1838 pass / 2 skipped；branches「85.53」本机两次实测 85.52（±0.01 属运行间噪声，阈值 80 无关）。「tests/ 553」= 改动前口径（含新测试为 554），一致。

**R5 · 1022 / 147 基线是「9362f1a8 + 本机」口径。** rebase 到 `1112e18a` 后（新增 `tests/unit/type-test-program-closure.test.ts` + 5 个 src 类型改动）基线可能漂移；CI 步骤只报不阻断，无门禁影响，但 ci.yml 注释与 fix-report 写死了 1022/147。建议 rebase 后复跑一次 `npm run typecheck:tests:full` 并按实数更新，或把注释改成「≈1.0k / ≈150（2026-09-13 基线）」。

**R6 · INFO** coverage job 在 `push` + `pull_request` 都触发，CI 时长翻倍；job 里 `fetch-depth: 0` 对 coverage 无用（是 release:check 的需求），可去掉省时。不影响正确性。

**R7 · INFO** 六文件里 `go-call-extractor.mjs` branch 95.62、`extractor-helpers.mjs` branch 95.71，距 95 阈值 <1 pt；接进 CI 后任何未测新分支即红——这是把 F150 SC-001 从「ship 时点」变成「持续门禁」的必然代价，fix-report §2.2 已如实声明口径不改。

**R8 · 本次验证对工作树的副作用（全部为 gitignored 运行态，`git status --short` 前后逐行一致）**：`dist/` 重建（内容 sha 不变、仅 builtAtIso）；`specs/_meta/graph.json` 由陈旧副本重建为当前 HEAD 图；`coverage/` 目录写入；`node_modules/.cache/` 里本工作树键的 globalSetup sidecar；临时文件 `tsconfig.tests.f285verify-nofixtures.tmp.json` 已删。主 checkout 只跑了只读 git/gh。

## 5. 总结论

**PASS（0 critical / 3 warning / 4 info）。** fix-report §1–§4 的核心声称全部亲跑复现：prepublishOnly 顺序与内容、1022/147 基线及其错误码与目录分布逐字吻合、fixtures 排除的必要性（不排除即坍缩为 1 错假绿）、allowJs 对 TS7016 的作用、ci.yml 结构（jobs = test/coverage、mjs gate 恰 1 行、report-only 步骤 if 与治理步骤逐字相同 + 唯一 continue-on-error、coverage job 并行且 1 fork）、claude-review.yml 删除、coverage 阈值（六文件全 ≥95、All files 88.13/85.52/94.78/88.13、CI 镜像 exit 0）、阈值执行机制（正向对照 does not meet + exit 1）、守护测试 6/6 且 15/15 真变异全红。

三条 warning（都不是 F285 引入的缺陷，但交付前必须知道）：
- **R1** prepublishOnly 新接的 `typecheck:tests` 在本分支基线 `9362f1a8` 上红（64 错，F280 遗留）；`origin/master` 已在 `1112e18a` 修掉（archive 树三段 0 错 + CI run 34706781506 全绿双重实证）。T009 rebase 到 `≥1112e18a` 后复跑 `npm run typecheck:tests` 见 exit 0 即闭合；fix-report 应补一句说明。
- **R2** coverage job 在 CI 上零实跑证据；本机 9 worker 复现 F235 birpc 假红一次、1 fork 镜像 exit 0。push 后盯首跑。
- **R3** 守护测试对 `npm test` 的断言是 10 空格字面量，`npm run test` / 单行 `run: npm test` 两种回潮形态绕过（M1b/M1c 绿）。改动面只在本卡新增的测试文件，建议顺手收紧为词边界匹配或 yaml 解析；不收紧也不阻断交付。

info：R4 三处数字小偏差（六连败→≥8、1843→1840/1838、85.53→85.52）；R5 1022/147 基线在 rebase 后可能漂移（report-only，无门禁影响）；R6 coverage job 触发面与 fetch-depth；R7 两个 extractor 的 branch 离 95 阈值 <1 pt。

T001–T006 全部 PASS；T007 沿用主线程结果并在本工作树交叉印证；T008 即本报告；T009 未到（rebase 目标已变为 `1112e18a`）。

审查档位登记：本卡为治理链配置改动，异构对抗档位按 fix-report §5 不适用；本报告由独立 verify 子代理亲跑完成，Codex 审查暂停期，未做异构对抗复审。
