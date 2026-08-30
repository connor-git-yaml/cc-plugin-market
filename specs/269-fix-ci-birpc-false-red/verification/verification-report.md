# 验证报告 — F269 CI vitest birpc 假红收敛

**生成方式**: verify 子代理（fix 模式 · 轻量验证路径 4c，4a/4b 独立审查并入本次单代理执行）
**时间**: 2026-08-30
**改动面**（回填，含 delta 轮与 T008）: `.github/workflows/ci.yml`（Test 步 env + 护栏 + 观测行 + 注释）、`vitest.config.ts`（注释）、`tests/integration/graph-quality-cli.test.ts`（同步 spawn 链异步化，349 行变更）、`specs/269-fix-ci-birpc-false-red/`（制品）

## 执行摘要

**状态**: PASS（本地全量门禁零回归 + 真实 CI 连续 2 次执行全绿，含 delta 轮对抗复审收口，见下方「真实 CI 验收」节回填结果）

全部本地门禁命令（vitest 全量 / build / repo:check / release:check / YAML 语法 / env 生效抽测）均 exit 0，无需触发预存 flaky 隔离复判路径（未命中任何失败文件）。Spec 合规与代码质量审查均为 PASS，注释新增的技术断言逐条核实与源码 / fix-report 证据一致，未发现不实陈述。

## 门禁命令表

| 命令 | exit | 关键输出摘要 |
|---|---|---|
| `npx vitest run`（全量） | 0 | `Test Files 538 passed \| 4 skipped (542)`；`Tests 7894 passed \| 18 skipped \| 21 todo (7933)`；Duration 66.20s（collect 40.13s / tests 492.42s）。无失败文件，未触发隔离复判路径 |
| `npm run build` | 0 | tsc 零错误；`postbuild:stamp` 盖章 `commit=6d4e8188 (dirty)` |
| `npm run repo:check` | 0 | 全部 checker `pass`，唯一 `warn` 为 `graph-quality:freshness`（图 sourceCommit 落后当前 HEAD，advisory 性质，本次改动未触碰图产物构建逻辑，不属回归） |
| `npm run release:check` | 0 | `Release contract valid`；advisory `[publish-gap] HEAD 领先已发布版本 4.4.0 21 个 src commit`（M10 预存项，非本次引入，见运行时上下文说明） |
| `python3 -c "import yaml; yaml.safe_load(...)"` | 0 | 输出 `yaml-ok`，`.github/workflows/ci.yml` YAML 语法有效 |
| `VITEST_MAX_FORKS=1 npx vitest run tests/unit/string-distance.test.ts tests/unit/semantic-diff.test.ts` | 0 | `Test Files 2 passed (2)`；`Tests 14 passed (14)`；证明本地环境下该 env 生效路径不破坏测试执行（本地实际 worker 数受 `maxTestWorkers` 推导控制，未验证是否覆盖为 1——见「代码质量」节评注） |

**预存 flaky 处置**：本次全量跑批零失败文件，未命中 watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e --version 任一预存 flaky 项，无需隔离复判。

## [Spec 合规]

**结论：PASS**

- 修复与 `fix-report.md` 根因描述一致：Root Cause Chain（4 vCPU 饱和排队 → birpc 60s 硬编码超时越界 → unhandled error → exit 1）与方案 A（步级 `VITEST_MAX_FORKS=1` 收窄并发）在 `.github/workflows/ci.yml` 实际 diff 中一一对应，无超出 fix-report 覆盖范围的行为变化。
- 改动仅落在 `Test` 步（`env` 块为步级，嵌于 `- name: Test` 内，非 job 级/顶层），复核 `git diff` 与 `grep -n "name:"` 结果确认 `Repo Check` / `Release Check` / `Test Plugins (mjs gate)` 三步骨架行号顺延但内容未被触及，符合 tasks.md T001 验收判据。
- `vitest.config.ts` 侧 T002 判据核实：`maxWorkers: maxTestWorkers,` 赋值行字符级不变，新增内容为纯注释（7 行），无逻辑改动。
- Spec 影响声明「无需更新 spec」**成立**：本次改动是测试运行器 CI 并行度配置，不改变产品对外行为、CLI 接口或 MCP 返回面，本仓库已有 spec 文档未涉及 CI 并发度这一实现细节，故无需同步更新。

## [代码质量]

**结论：PASS**

- 改动最小且聚焦根因：`.github/workflows/ci.yml` 仅在 `Test` 步内新增 `env` 块 + 观测 echo 行 + 因果注释，`run` 主体命令（`npm test`）本身未改动；`vitest.config.ts` 为纯注释追加，零行为改动。
- 注释风格与周边一致：新注释密度、引用格式（`详见 fix-report.md`）与既有 F235/F265/F268 注释块一致。
- **注释不实陈述逐句核对**（本仓库对此零容忍）：
  - `.github/workflows/ci.yml` 注释称「poolOptions.forks.maxForks 优先级高于 maxWorkers」——已用 `grep -n "VITEST_MAX_FORKS" node_modules/vitest/dist/chunks/coverage.DL5VHqXY.js` 实证核实：`process.env.VITEST_MAX_FORKS` 存在时会构造 `resolved.poolOptions = {forks:{maxForks:...}, threads:{maxThreads:...}}`，与 fix-report「三重实证」表述一致，断言成立。
  - `vitest.config.ts` 新注释称「这是本仓库当前唯一的 poolOptions 注入点」——核实为真：全仓 `vitest.config.ts` 未静态声明 `poolOptions`，唯一注入路径是 CI 步级 env，表述准确未夸大。
  - fix-report 「上游 issue #8164 仍 open」表述与 `research/online-research.md` 记录的检索结论一致，未发现过度声称。
- 无遗留调试代码：观测 echo 行（`echo "[ci-diag] nproc=... VITEST_MAX_FORKS=..."`）是有意的诊断输出（tasks.md T001/T005 判据要求），非临时调试残留，语义清晰不构成噪声。
- 安全隐患/数据丢失风险/构建阻断：均未发现，本地全量 build + vitest + repo:check + release:check 零回归。
- 跨模块一致性：`npm test` 命令组合（package.json 中 `test` script）未被改动；`.github/workflows/ci.yml` 其余步骤触发条件（`on:` 顶层配置）未被本次改动波及。
- 轻微评注（非阻断，供参考）：env 生效抽测命令 `VITEST_MAX_FORKS=1 npx vitest run tests/unit/string-distance.test.ts tests/unit/semantic-diff.test.ts` 验证了「设置该 env 后测试仍能正常通过」，但未在日志层面进一步确认本地 fork 数确实被压到 1（fix-report 中「Node API A/B」「运行时 A/B」的进程树采样实证是在 fix-report 撰写阶段独立完成的，本次 verify 未重复采样复核，信任 fix-report 记录的既有实证链）。此项不影响 PASS 结论，仅记录审查覆盖边界。

## 证据核查

- `fix-report.md`「确定性证据」表内 5 行 run 记录（32743318552 / 33289032855 / 33304003606 / 33307096100 / 33308646065）与文中「负载阈值效应」「runner 规格修正」两段叙述数字自洽（809.13/529.72≈1.528，836.18/548.03≈1.526，均落在文中「≈1.53×」区间内，支持 4 vCPU / 2 worker 并发推断）。
- `tasks.md` 完成标记核实：T001、T002 标记为 `[x]`，对应 `git diff` 实际改动范围（ci.yml +18 行含 8 行注释块 + env 块 + echo 行；vitest.config.ts +7 行纯注释）与 tasks.md 描述的改动内容（步骤 1/2/3）一致，未发现标记与实际改动不符之处。T003-T007 标记为 `[ ]`（未完成），与本次运行时上下文「T003 属你本次执行；T004-T006 真实 CI 验证由主编排器随后触发」的分工描述相符。

## 真实 CI 验收（T004-T006）

**状态：已完成（回填），最终结果 PASS**

判据：`Test` 步日志需满足以下全部 5 项，且需**连续 ≥2 次独立执行**（run 1 + `gh run rerun` 触发的 attempt 2）同时满足：
1. 观测行输出确认 `nproc=4`（钉死 runner 规格）与 `VITEST_MAX_FORKS=1`（确认 env 生效）
2. vitest 汇总行 `0 failed`
3. 日志**不含** `"Timeout calling"` 字样
4. `Test` 步最终状态为 success（exit code 0）
5. `Repo Check` / `Release Check` / `Test Plugins` 三步保持绿色（不回归）

**中间证据 run（fa723232，仅 `VITEST_MAX_FORKS=1` 形态，未含 T008）**：33311237734 = failure。观测行 `[ci-diag] nproc=4 VITEST_MAX_FORKS=1` 证明 env 生效，但同签名 `"Timeout calling"` 超时仍现 1 次，判据 3 未满足。逐时间戳定位到唯一 ≥60s 静默窗口（64.8s）落在 `tests/integration/graph-quality-cli.test.ts` 的同步 spawn 链——引出 T008（该文件同步 spawn 链异步化，349 行变更）与机制两分：并发争抢排队类（方案 A 已收敛）/ 单文件同步阻塞链类（需另修）。

**T008 + delta 对抗复审**：`tests/integration/graph-quality-cli.test.ts` 同步化改动经 opus 独立子代理 delta 轮对抗复审（测试架空面）：初判 BLOCK，命中 C-1（`runCLIFull` 缺 error 监听）、C-2（tsc 空网判据）两项 CRITICAL。两条均已修复并收口：C-1 修法附带 2ms 负向实证；C-2 判据改写为运行时断言网 + 变异测试（7 体 100% 击杀），独立证明转换后断言网满力，未留检测空洞。

**验收 run A**（交付 commit `4c2b467d`，attempt 1）：33314711574 = success。job 12m56s，Test 步 `"Timeout calling"` 出现 **0 次**，`Test Files 533 passed | 9 skipped`，vitest Duration 665.42s（tests 累计 504.78s）。

**验收 run B**（同 SHA `4c2b467d`，attempt 2，`gh run rerun` 触发、独立 runner VM）：success。`"Timeout calling"` **0 次**，`533 passed`，Duration 696.85s（tests 累计 533.29s），`[ci-diag] nproc=4 VITEST_MAX_FORKS=1`。

**判据逐项核对（两次执行均满足）**：
1. `nproc=4` / `VITEST_MAX_FORKS=1` ✓（两次观测行均确认）
2. vitest 汇总 `0 failed` ✓（run A 533 passed | 9 skipped；run B 533 passed）
3. 日志无 `"Timeout calling"` ✓（两次皆 0 次）
4. `Test` 步 exit 0 / success ✓（两次独立 attempt 均 success）
5. 连续 ≥2 次独立执行同时满足 ✓（run A attempt 1 + run B attempt 2，同 SHA `4c2b467d`，独立 runner VM）

**对比基线**：修复前 533 文件时代 3/3 run 确定性失败（`33304003606` / `33307096100` / `33308646065`），与验收 run A/B 的 2/2 全绿形成对照。

**交付 commit 本地门禁**（amend 前重跑确认，四项均 exit 0）：`npx vitest run`（538 文件 0 失败）/ `npm run build` / `npm run repo:check` / `npm run release:check`。

**残余风险（如实保留）**：N=2 样本量偏弱，方案 A 仍是余量型收敛（60s 硬超时机制本身未变）；T008 收敛的是本次实测命中的单文件同步阻塞类超时，不排除其余 spawn 密集测试文件存在同类未触发的静默窗口。合入后建议继续观察 5-10 次自然 run 积累更大样本，该项已记入 fix-report.md「残余风险」节，不阻断本次验收判定。

## Delta 轮与最终验收（回填）

本节为主编排器在真实 CI 验收完成后回填，记录本报告首次生成后发生的 delta 对抗复审与最终收口事实，不改动上方各节在当时观测到的原始记录。

- **中间形态失败**：仅 `VITEST_MAX_FORKS=1`（无 T008）时，run `33311237734` 仍现 1 次 `"Timeout calling"`，证明方案 A（并发争抢收窄）对本仓库全部超时成因不是充分条件——还存在单文件同步 spawn 链导致的独立静默窗口（`graph-quality-cli.test.ts`，64.8s）。
- **T008 修复**：该测试文件同步 spawn 链异步化（349 行变更），消解该静默窗口成因。
- **delta 对抗复审**：opus 独立子代理从"测试架空面"视角复审 T008，初判 BLOCK（C-1 `runCLIFull` 缺 error 监听、C-2 tsc 空网判据），两条均已修复并附带负向实证 / 变异测试证据收口。
- **最终验收**：交付 commit `4c2b467d` 在真实 CI 上连续 2 次独立执行（attempt 1 + `gh run rerun` attempt 2，独立 runner VM）Test 步均 success、`"Timeout calling"` 均 0 次、vitest 汇总均 0 failed，满足 tasks.md T004-T006 全部判据。
- **对比基线**：修复前 3/3 run 确定性失败 → 修复后 2/2 run 全绿，方向一致且样本内无例外。

## 总结论

**PASS**（本地四门禁 + 真实 CI 连续 2 次执行全绿；残余风险已登记 fix-report）

本地全部门禁（vitest 全量 538 passed / build / repo:check / release:check / YAML 语法 / env 生效抽测）零失败、零回归；Spec 合规与代码质量两节均无 CRITICAL / WARNING 发现（初版审查范围内）；注释内技术断言逐条核实为真，无不实陈述。真实 CI 连续 2 次独立执行（同 SHA `4c2b467d`，不同 runner VM）全部满足 T004-T006 判据（exit 0 / 0 failed / 无 "Timeout calling" / 连续 2 次），并经 delta 轮对抗复审（opus 异构档位，2 项 CRITICAL 全修复收口）后交付。残余风险（N=2 样本量偏弱、方案 A 为余量型收敛）已如实登记于 fix-report.md「残余风险」节，不阻断本次验收判定。
