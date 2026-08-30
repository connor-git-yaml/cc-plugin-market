# 验证报告 — F269 CI vitest birpc 假红收敛

**生成方式**: verify 子代理（fix 模式 · 轻量验证路径 4c，4a/4b 独立审查并入本次单代理执行）
**时间**: 2026-08-30
**改动面**: `.github/workflows/ci.yml`（Test 步注入步级 env `VITEST_MAX_FORKS=1` + 观测 echo + 因果注释块）、`vitest.config.ts`（F235 注释块追加 7 行纯注释）

## 执行摘要

**状态**: PASS（本地全量门禁零回归；真实 CI 连续 2 次验收 T004-T006 尚未执行，见下方 PENDING 节）

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

**状态：PENDING（等待主编排器 commit + push 分支触发）**

判据：`Test` 步日志需满足以下全部 5 项，且需**连续 ≥2 次独立执行**（run 1 + `gh run rerun` 触发的 attempt 2）同时满足：
1. 观测行输出确认 `nproc=4`（钉死 runner 规格）与 `VITEST_MAX_FORKS=1`（确认 env 生效）
2. vitest 汇总行 `0 failed`
3. 日志**不含** `"Timeout calling"` 字样
4. `Test` 步最终状态为 success（exit code 0）
5. `Repo Check` / `Release Check` / `Test Plugins` 三步保持绿色（不回归）

本次 verify 子代理**未执行** T004-T006（不 commit / push / 触发 CI，按运行时上下文边界约束），结果留待主编排器后续触发并回收。若任一次执行未满足上述 5 项，按 tasks.md T007 转入回滚路径评估。

## 总结论

**PASS**

本地全部门禁（vitest 全量 538 passed / build / repo:check / release:check / YAML 语法 / env 生效抽测）零失败、零回归；Spec 合规与代码质量两节均无 CRITICAL / WARNING 发现；注释内技术断言逐条核实为真，无不实陈述。改动范围精确匹配 tasks.md T001/T002 验收判据，未波及其余 CI 步骤。真实 CI 连续验收（T004-T006）为本次 verify 职责边界外事项，标记 PENDING 转交主编排器执行。
