# Tasks: F269 CI vitest birpc 假红收敛

**输入**: `specs/269-fix-ci-birpc-false-red/plan.md`（变更清单 + 验证方案）、
`specs/269-fix-ci-birpc-false-red/fix-report.md`（诊断，方案 A 已选定）
**模式**: fix（问题修复）——线性最短路径，不做 TDD 拆分与并行分组
**范围边界**: 起始 2 个文件（`.github/workflows/ci.yml`、`vitest.config.ts`），均为配置/注释
改动，不涉及产品代码；验证不新增单元测试用例，走真实 CI 执行。T008 起追加第 3 个文件
（`tests/integration/graph-quality-cli.test.ts`）——run 1 实证发现单一「多 worker 争抢排队」
机制叙事不完整，追加测试结构修复（CLI helper 同步转异步），仍不新增单元测试用例、不改测试
断言语义

---

## Phase 3: Implement（代码修复）

- [x] T001 修改 `.github/workflows/ci.yml` 的 `Test` 步（当前 L45-46）：
  1. 步前追加 F269 追溯注释（8 行，说明 4 vCPU 饱和排队 → birpc 60s 超时根因 + 步级
     env 收敛机制，与文件内既有 F265/F268 注释密度一致）
  2. 步内新增 `env: VITEST_MAX_FORKS: "1"`（步级注入，不用 job 级 env，避免波及
     `Repo Check` / `Release Check` / `Test Plugins` 等其余步骤）
  3. `run` 由单行 `npm test` 改为多行脚本：先输出观测行
     `echo "nproc=$(nproc) VITEST_MAX_FORKS=${VITEST_MAX_FORKS}"`，再执行 `npm test`
     （`npm test` 命令本体不改）
  **文件**: `.github/workflows/ci.yml`
  **验收判据**:
  - `git diff` 确认仅 `Test` 步范围内改动（+11 行左右），无其余步骤（`Repo Check` /
    `Release Check` / `Test Plugins`）被触及
  - YAML 语法有效（`yamllint` 或等效方式，或至少确认缩进与既有步骤一致）
  - `env` 块为步级（嵌在 `- name: Test` 内），不是顶层 `jobs.<job>.env` 或 `on` 级
  - 观测行位于 `npm test` 之前
  **依赖**: 无（起始任务）

- [x] T002 在 `vitest.config.ts` 的 F235 注释块末尾（当前止于 L48-52 附近「本仓库不设
  poolOptions，用 maxWorkers 以便对 forks / threads 任一 pool 都生效。」）追加 F269
  说明段（纯注释，标注优先级 `poolOptions.forks.maxForks > maxWorkers > 内置推导`，以及
  CI Test 步通过步级 env `VITEST_MAX_FORKS=1` 覆盖 maxWorkers 推导值这一「本仓库唯一
  poolOptions 注入点」的事实，防止「本仓库不设 poolOptions」表述在 F269 落地后产生漂移
  误导）。
  **文件**: `vitest.config.ts`
  **验收判据**:
  - 纯注释新增，`git diff` 中无任何非注释行变化
  - `maxWorkers` 赋值逻辑（原 L27-28、L55 附近）字符级不变
  - 新注释准确引用 `specs/269-fix-ci-birpc-false-red/fix-report.md` 作为详情出处
  **依赖**: 无（可与 T001 并行编写，无文件交叉，但逻辑上从属同一变更清单，建议 T001 后
  顺手完成）

- [x] T008（run 1 后追加）把 `tests/integration/graph-quality-cli.test.ts` 的 CLI 调用链
  （`runCLI`/`runCLIFull` 两个 helper）从同步 `execFileSync`/`spawnSync` 改为
  `async … : Promise<CLIResult>`（`runCLI` 用 `promisify(execFile)`，`runCLIFull` 用
  `spawn` + Promise 包装），逐字段保留现有语义（成功路径丢弃 stderr、失败路径按
  `typeof err.code === 'number'` 判定 exitCode）；全部 70 处调用点（`runCLI` 68 处 +
  `runCLIFull` 2 处）加 `await`，对应 `it(...)` 回调改 `async`（含 `for...of` 循环内
  生成的动态标题 it 与嵌套 `.map`/内联箭头 helper，均逐个核对改造，不用全局 sed 盲替）；
  `initGitRepoWithCommit`/`gitConfig` 等 git 版件
  同步调用保持原样。
  **背景**: run 1（T004）实证「多 worker 争抢排队」是①类触发面（钉 1 fork 已收口），
  但同一次 run 仍复现同签名超时——逐时间戳定位到②类触发面：该文件 66 个测试逐个
  `execFileSync`/`spawnSync` 连成近连续同步链，1 fork 下累积 64.8s 零输出静默窗口
  （全 run 唯一 ≥60s 候选），worker 事件循环 timers 相位先于 poll 相位触发，与
  worker 数无关。
  **文件**: `tests/integration/graph-quality-cli.test.ts`
  **验收判据**（对抗复审 C-2 修正：`npm run lint` 不覆盖 `tests/`——`tsconfig.json`
  的 `include` 仅 `src/**`、`exclude` 含 `tests`，`tsc --listFiles` 对本文件 0 命中，
  故不作为转换完整性判据；实际判据是两层运行时网）：
  - **① 文件自身 66 用例全绿**：`npx vitest run tests/integration/graph-quality-cli.test.ts`
    66/66 通过。漏 `await` 会让 `CLIResult` 字段实际是 `Promise`（`.stdout` 等访问得
    `undefined`），断言立红——变异测试实证：摘除 70 处 `await` 中的首位单处 / 末位
    单处 / 全部 70 处，三种变异体均 66/66 失败、零幸存（M4/M5/M6）
  - **② delta 对抗复审**：7 个变异体（含运行时行为变异，非仅摘 await）100% 被击杀
  - `git diff --stat` 确认改动范围仅限该文件（外加 ci.yml 注释机制修正、tasks.md 本节）
  **依赖**: T004（run 1 失败结果触发）

- [ ] T009（对抗复审 delta）针对 T008 的异步化改造做对抗性复审，聚焦「测试被架空」
  构造面：
  - 确认 `runCLI`/`runCLIFull` 的错误路径（exitCode 非 0）在异步改造后仍被正确捕获，
    而非因 rejection 处理疏漏被静默吞掉、让原本该失败的用例假绿
  - 确认 70 处 `await` 全部生效（无遗漏导致某个 `it` 提前 resolve、断言实际未对真实
    CLI 输出生效）
  - 确认 `runCLIFull` 的 `spawn` 版本在 timeout / 非 0 exit 场景下行为与原 `spawnSync`
    版本逐字段一致（FIX-8/8b 两个用例覆盖此路径）
  **文件**: 无新增文件（复审对象为 T008 改动）
  **验收判据**: 复审结论（异构对抗档位，Codex 暂停期按 CLAUDE.local.md 规则）记录为
  0 CRITICAL 或已修复；如发现真实缺陷需回到 T008 修复并重跑其验收判据
  **依赖**: T008

**Checkpoint**: 三处改动（T001/T002/T008）完成，`npm run build` 与 `npx vitest run`（本地）
应零回归——ci.yml/vitest.config.ts 的 env 仅在 CI 步注入不影响本地行为，T008 为纯结构
重写不改变测试断言语义，可用作改动未破坏本地开发环境的快速自检。

---

## Phase 4: Verify（验证闭环，含真实 CI 触发与结果回收）

- [ ] T003 本地基线自检（防止改动误伤本地/其余 CI 步骤）：
  - 本地跑 `npx vitest run` 确认仍走 F235 的 `maxWorkers=CPU/2` 推导（本机核数下 worker
    数与改动前一致），不读取 `VITEST_MAX_FORKS`
  - 目视复核 `.github/workflows/ci.yml` 全文，确认 `Repo Check` / `Release Check` /
    `Test Plugins` 三步未被本次改动触及
  **文件**: 无新增文件（复核对象为 T001/T002 改动结果）
  **验收判据**: 本地 vitest worker 数与改动前一致；三步骤 diff 为空
  **依赖**: T001, T002

- [ ] T004 推送触发 CI run 1：`git push` 到 `269-fix-ci-birpc-false-red` 分支（`on: push`
  无分支过滤，feature 分支 push 无需用户额外确认）
  **文件**: 无（CI 触发动作）
  **验收判据**: 分支 push 成功，触发新的 workflow run
  **依赖**: T003
  **run 1 结果（33311237734，commit fa723232）**: FAILURE——`[ci-diag] nproc=4
  VITEST_MAX_FORKS=1` 证明 env 已生效（①类「多 worker 争抢排队」触发面确认收口），
  但同签名超时仍复现 1 次（533 全过 + 1 error）；逐时间戳定位到②类触发面（单文件同步
  spawn 链，见 fix-report.md「Run 1 实证修正」节），已转 T008 结构修复，验收计数随
  T008 落地后的新 SHA 重新起算（T005/T006 的「连续 ≥2 次」不计入本次 run 1）

- [ ] T005 检视 run 1 的 `Test` 步日志（`gh run list` / `gh run view` 或等效方式）：
  - 观测行输出确认 `nproc=4`（钉死 runner 规格）与 `VITEST_MAX_FORKS=1`（确认 env 生效）
  - vitest 汇总行 `0 failed`
  - 日志**不含** `"Timeout calling"` 字样
  - `Test` 步最终状态为 success（exit code 0）
  - 顺带确认 `Repo Check` / `Release Check` / `Test Plugins` 三步保持绿色（不回归）
  **文件**: 无（CI 日志检视）
  **验收判据**: 上述 5 项全部满足；任一项不满足记录具体失败点，转入 T007 回滚路径评估
  **依赖**: T004

- [ ] T006 主动触发第二次独立执行：run 1 通过（T005 全部满足）后执行
  `gh run rerun <run-id>`，构成 attempt 2；对 attempt 2 重复 T005 的全部 5 项检视
  **文件**: 无（CI 触发 + 日志检视）
  **验收判据**: 连续 **≥2 次**独立执行（run 1 + attempt 2）同时满足 T005 的 5 项判据，
  两次均满足才算验收通过
  **依赖**: T005（仅当 run 1 全部满足才执行本任务；若 run 1 未满足，直接转 T007，不做
  无意义的第二次触发）

- [ ] T007（条件任务，仅在 T005 或 T006 判据未达成时执行）回滚路径评估：
  - 若连续 2 次执行中至少 1 次仍复现 `"Timeout calling"` 或非零 exit code 且伴随
    `0 failed` 测试，判定方案 A 收敛不足
  - 执行 `git revert` 恢复 `.github/workflows/ci.yml` 的 `Test` 步为无 env 的
    `run: npm test`，`vitest.config.ts` 注释恢复原状
  - 记录失败现象（日志片段 + run 链接）到 fix-report.md 补充节，升级路径转交「按 project
    拆分串行 vitest 步」评估（另起 Fix 任务，不在本次方案 A 范围内展开）
  **文件**: `.github/workflows/ci.yml`, `vitest.config.ts`, `specs/269-fix-ci-birpc-false-red/fix-report.md`
  **验收判据**: revert 后本地 diff 干净（恢复到 T001/T002 改动前状态）；fix-report.md
  补充节如实记录未达成原因
  **依赖**: T005 或 T006 的失败结果触发

**Checkpoint**: T006 全部满足 → 本次修复验收通过，可进入交付流程（PUSH 前列 report 等待
用户确认，按 CLAUDE.local.md 交付约定执行）；若走 T007，本次修复标记为不通过，回滚并转
交后续 Fix 任务。

---

## Dependencies & Execution Order

```
T001 → T003 → T004 ─┬→ T005 → T006 → (Checkpoint: 验收通过)
T002 ↗              │              ↘
                     │               T007（条件：验证失败时触发，回滚 T001/T002）
                     └→ T008 → T009 → （新 SHA 后重启 T004→T006）
```

- T001、T002 无相互依赖，均可先行完成（同属变更清单，建议顺序执行，无需并行调度）
- T003 依赖 T001 + T002 均完成
- T004-T006 为严格线性顺序（CI 真实执行结果驱动，无法并行——run 1 必须先出结果才能判断
  是否触发 rerun）
- T007 为条件任务，仅在验证失败路径触发，正常路径（T006 通过）不执行
- T008 由 T004 的 run 1 失败结果触发（②类触发面残留，见 T004 补注），T009 为其对抗
  复审；T008/T009 落地并 commit 出新 SHA 后，T004-T006 的验收计数重新起算（run 1 判
  方案 A 单独形态 FAIL，不计入 A+T008 组合形态的连续 ≥2 次统计）

## Notes

- fix 模式不设 User Story 分组、不设 TDD 红绿拆分；Phase 3（T001-T002、T008-T009）为
  代码修复，Phase 4（T003-T007）为验证闭环
- T004-T006 依赖真实 GitHub Actions 执行结果，本地环境（18 核开发机）结构性无法复现
  该失败（fix-report.md Why 5），故不设本地等效验证任务替代
- 本次改动不涉及 `plugins/spec-driver/`、`plugins/spectra/`、`src/`，按 CLAUDE.local.md
  暂停期档位规则可走「纯配置改动 → 目视审查」，无需额外对抗审查任务；T008 触及
  `tests/`（测试结构重写），走异构对抗复审档位（T009），非目视审查
