---
feature: 292-fix-coverage-gate-positive-evidence
mode: fix
status: ready
based_on: plan.md（含主编排器两点修订）
---

# 任务分解 — F292 CI coverage 判定器：从负向证据换正向证据

> 本卡为 fix 模式，无 spec.md/User Story；覆盖映射改为「fix-report.md 根因点 / plan.md 决策」→ Task ID，
> 确保 plan 中每条决策与残余风险登记项都能追溯到具体任务。

## 前提说明（主编排器修订，写任务前已生效）

- plan §决策4 表格中 `birpc-timeout-empty-counts.ansi.txt` 一行的说明**已过期**：该 fixture 的
  Unhandled Error 签名字面量已由主编排器统一替换为 `onTaskUpdate`，因此该样本现在**只**触发
  (a) 汇总计数检查失败（(b) 检查此时是满足的：`Errors 1` == 签名计数 `1`）。
- 因此该样本现在**可以直接充当** T007 中 (a) 检查的隔离证明；plan 原表格里为 (a) 设计的"合成串
  常量"（取 `birpc-timeout-pass.ansi.txt` 挖空 `passed` 计数）**仍需要额外编写**（二者不冲突，
  不要以为 fixture 已够而省略合成串用例——合成串专门证明"即便签名/Errors 都满足，光凭汇总计数
  缺失也会独立判红"，与 fixture 现在恰好双失效的证明目的不同，两条断言都要写）。
- 其余 plan 决策（1-5、§6 验证方案、§7 异构对抗、§8 提交与交付）原样执行，无修订。

---

## Phase 1: Setup（无，本卡不新增依赖/脚手架）

本卡改动范围窄（2 修改 + 3 新增文件），无需独立 Setup phase，Foundational 任务即 Phase 2。

## Phase 2: Foundational — 判定器核心实现

- [x] T001 实现 `scripts/lib/coverage-gate-core.mjs`：导出纯函数 `judgeCoverageLog({ log, status })`，
  零 I/O、零 `process` 依赖。内部 helper：`stripAnsi`（`/\x1b\[[0-9;]*m/g`）、
  `parseSummaryLine`（抽取 `Test Files`/`Tests` 行的 `{count, category}` 段）、
  `checkCoverageTable`（覆盖率表完整性 + 末行即收尾判定）。严格按 plan.md §决策4「判定算法契约」
  1-4 步实现：
  - 负向检查（任何 status 都查）：`does not meet|ERROR: Coverage for` → 红；
    `Tests\s+\d+\s+failed|Test Files\s+\d+\s+failed` → 红
  - `status===0` 且未命中负向检查 → pass
  - `status!==0` 时必须同时满足 (a) 汇总计数、(b) `Errors N` == 签名数、(c) 覆盖率表完整且末行为
    分隔线，任一不满足 → 红
  - 返回 `{ verdict: 'pass'|'red', exitCode, reasons, evidence }`；`exitCode` 语义按 plan §决策1：
    pass→0；红且 `status!==0`→`status`；红且 `status===0`（防御性场景）→1
  - 文件路径：`scripts/lib/coverage-gate-core.mjs`
  - 验收：`node -e "import('./scripts/lib/coverage-gate-core.mjs').then(m=>console.log(typeof m.judgeCoverageLog))"` 输出 `function`

- [x] T002 [P] 实现 `scripts/coverage-gate.mjs`：CLI 薄壳，`process.argv` 读 `<logPath> <status>`
  两个位置参数，`fs.readFileSync(logPath, 'utf8')` 读日志，调用 `judgeCoverageLog`，把
  plan.md §决策4"可观测性设计"里列出的结构化摘录（`verdict`/`exitCode`/`status`/
  `Test Files 行`/`Tests 行`/`Errors 行`/`signatureCount`/`reasons`）打印到 stdout，
  最后 `process.exit(result.exitCode)`。不带 `is-invoked-directly.mjs` guard（plan §决策1
  已论证不适用：该文件只会被 CI 直接 `node` 调用，不会被任何模块 `import`）。
  - 文件路径：`scripts/coverage-gate.mjs`
  - 依赖：T001
  - 验收：`node scripts/coverage-gate.mjs tests/fixtures/coverage-gate/clean-pass.ansi.txt 0; echo $?` 输出 `[coverage-gate] verdict=pass...` 且末尾 echo 为 `0`

## Phase 3: 判定器行为测试（8 真实样本 + 合成串隔离用例）

- [x] T003 新建 `tests/unit/coverage-gate.test.ts`：8 份真实样本用例，逐条按 plan.md §决策4
  表格断言 `verdict` 与 `exitCode`（样本加载用
  `fs.readFileSync(path.join(repoRoot, 'tests/fixtures/coverage-gate', file), 'utf8')`，
  `repoRoot` 用 `fileURLToPath(import.meta.url)` 定位，与 `release-ci-gates.test.ts` 现有写法一致）：
  | 样本 | status | 期望 verdict | 期望 exitCode |
  |---|---|---|---|
  | `clean-pass.ansi.txt` | 0 | pass | 0 |
  | `birpc-timeout-pass.ansi.txt` | 1 | pass | 0 |
  | `birpc-timeout-empty-counts.ansi.txt` | 1 | red | 1 |
  | `unhandled-other.ansi.txt` | 1 | red | 1 |
  | `tests-failed.ansi.txt` | 1 | red | 1 |
  | `threshold-miss.ansi.txt` | 1 | red | 1 |
  | `truncated-before-summary.ansi.txt` | 1 | red | 1 |
  | `summary-no-coverage-table.ansi.txt` | 1 | red | 1 |
  - 文件路径：`tests/unit/coverage-gate.test.ts`
  - 依赖：T001
  - 验收：`npx vitest run tests/unit/coverage-gate.test.ts` 中这 8 条用例全绿

- [x] T004 在 `tests/unit/coverage-gate.test.ts` 追加 (a) 汇总计数隔离用例（合成串，非新 fixture
  文件）：内联字符串常量，取 `birpc-timeout-pass.ansi.txt` 原文，把 `1 passed` / `2 passed` 两处
  替换为空（只留 `(1)` / `(2)`），其余原样保留（签名、Errors、完整表格不动）。断言 `status=1` 下
  `verdict==='red'`。**同时**保留/新增对 `birpc-timeout-empty-counts.ansi.txt`（T003 已覆盖）
  的说明性注释，标注"该 fixture 现同时触发 (a)+(b) 双失效，不单独作为 (a) 的隔离证明，合成串才是"，
  避免后续维护者误以为二者重复。
  - 文件路径：`tests/unit/coverage-gate.test.ts`
  - 依赖：T003
  - 验收：新增用例单独跑 `npx vitest run tests/unit/coverage-gate.test.ts -t "汇总计数"` 全绿

- [x] T005 在 `tests/unit/coverage-gate.test.ts` 追加 (b) 隔离用例两条：
  1. 签名数不匹配：复用 `unhandled-other.ansi.txt`（Errors=1 但签名文本是 `boom unhandled`，
     `N_sig=0≠1`），断言 `verdict==='red'`（T003 已覆盖此样本的判定结果，本任务是补充断言注释
     说明该用例同时承担"签名数不匹配"隔离证明的角色，若 T003 断言已含义等价可只加注释不重复写）
  2. Errors 行缺失（合成串，新增）：取 `clean-pass.ansi.txt` 内容，手写 `status: 1`（log 内容
     不含 Errors 行），断言 `verdict==='red'`（防"看似全过但没人解释为什么 exit 非 0"被放行）
  - 文件路径：`tests/unit/coverage-gate.test.ts`
  - 依赖：T003
  - 验收：`npx vitest run tests/unit/coverage-gate.test.ts -t "Errors"` 全绿

- [x] T006 在 `tests/unit/coverage-gate.test.ts` 追加 (c) 隔离用例两条：
  1. 复用 `summary-no-coverage-table.ansi.txt`（缺表，T003 已覆盖判定结果，补充隔离证明注释）
  2. 合成串（新增）：取 `birpc-timeout-pass.ansi.txt` 内容，在收尾分隔线后追加一行无害噪声
     `note: retried`（非阈值行），断言 `verdict==='red'`（证明"末行必须是分隔线"这一子句独立生效，
     不止靠负向阈值检查兜底）
  - 文件路径：`tests/unit/coverage-gate.test.ts`
  - 依赖：T003
  - 验收：`npx vitest run tests/unit/coverage-gate.test.ts -t "收尾"` 全绿

- [x] T007 在 `tests/unit/coverage-gate.test.ts` 追加"负向检查优先级"隔离用例（合成串，新增）：
  取 `birpc-timeout-pass.ansi.txt`（本应放行的样本）内容，在收尾分隔线后追加一行
  `ERROR: Coverage for branches (66.66%) does not meet "src/a.mjs" threshold (99%)`，断言
  `verdict==='red'`（证明负向检查即便签名/计数/表格都齐全也优先生效，替代原 YAML 里"位置顺序"
  断言的等价保证）。
  - 文件路径：`tests/unit/coverage-gate.test.ts`
  - 依赖：T003
  - 验收：`npx vitest run tests/unit/coverage-gate.test.ts -t "优先级"` 全绿

## Phase 4: CI 步骤改写

- [x] T008 改写 `.github/workflows/ci.yml` 的 `Coverage (thresholds enforced)` 步，按 plan.md
  §决策2 给出的形状收窄 run 体（`set +e` → `npm run test:coverage > coverage.log 2>&1` →
  `status=$?` → `node scripts/coverage-gate.mjs coverage.log "${status}"` →
  `gate_status=$?` → `exit "${gate_status}"`），移除旧的两条负向 `grep`、`Timeout calling
  "onTaskUpdate"` 判据、`::warning::` 文案、`tail -n 40`。
  - 文件路径：`.github/workflows/ci.yml`
  - 依赖：T002
  - 验收：`grep -n 'coverage-gate.mjs\|tail -n 40\|::warning::vitest birpc' .github/workflows/ci.yml`
    只命中 `coverage-gate.mjs` 一行，`tail -n 40`/`::warning::` 零命中

- [x] T009 [P] 在 `.github/workflows/ci.yml` 的 coverage job 中，紧随 T008 的步骤之后新增
  `Upload coverage log` 步（`if: always()`、`uses: actions/upload-artifact@v4`、
  `name: coverage-log`、`path: coverage.log`、`retention-days: 7`），形状照抄 plan.md §决策2。
  - 文件路径：`.github/workflows/ci.yml`
  - 依赖：T008
  - 验收：`grep -A4 'Upload coverage log' .github/workflows/ci.yml` 含 `if: always()` /
    `actions/upload-artifact@v4` / `path: coverage.log`

## Phase 5: `release-ci-gates.test.ts` 合同断言改写

- [x] T010 改写 `tests/unit/release-ci-gates.test.ts` 中 coverage job 一节（现状 L131-148 附近）：
  按 plan.md §决策3 的对照表逐条处置——
  - 保留：`body).toContain('npm run test:coverage > coverage.log 2>&1')`
  - **删除**旧断言：内联负向 grep 存在性断言（`does not meet|ERROR: Coverage for` + `exit 1`）、
    `failed` + `exit 1` 存在性断言、`Timeout calling "onTaskUpdate"` 存在于 run 体的断言、
    `does not meet` 位置 < `Timeout calling` 位置的顺序断言
  - **改写**：`body[body.length-1] === 'exit "${status}"'` → `body[body.length-1] === 'exit "${gate_status}"'`
  - **新增**（同一 `it` 内追加，整串精确 `toContain`，不用宽松子串）：
    ```ts
    expect(body).toContain('status=$?');
    expect(body).toContain('node scripts/coverage-gate.mjs coverage.log "${status}"');
    expect(body).toContain('gate_status=$?');
    expect(body[body.length - 1]).toBe('exit "${gate_status}"');
    expect(step).not.toMatch(/grep -qE 'does not meet/);
    expect(step).not.toMatch(/Timeout calling "onTaskUpdate"/);
    expect(step).not.toMatch(/::warning::vitest birpc/);
    expect(step).not.toMatch(/tail -n 40/);
    const gateCore = read('scripts/lib/coverage-gate-core.mjs');
    expect(gateCore).toContain('Timeout calling "onTaskUpdate"');
    ```
  - **不改动**（复核不误删相邻合同）：job header 无 if/needs、`VITEST_MAX_FORKS: "1"`、
    `node dist/cli/index.js batch --mode graph-only` 建图步、`continue-on-error` 全文件仅 1 处
  - 文件路径：`tests/unit/release-ci-gates.test.ts`
  - 依赖：T001（`coverage-gate-core.mjs` 需存在才能断言字面量）、T008
  - 验收：`npx vitest run tests/unit/release-ci-gates.test.ts` 全绿

- [x] T011 [P] 在 `tests/unit/release-ci-gates.test.ts` 同一 `describe` 块内新增独立 `it`，钉住
  `Upload coverage log` 步：
  ```ts
  it('coverage job 上传 coverage.log artifact（if: always()，v4）', () => {
    const job = jobBlock('coverage');
    const step = stepBlock('coverage', 'Upload coverage log');
    expect(step).toMatch(/^\s{8}if: always\(\)$/m);
    expect(step).toMatch(/uses: actions\/upload-artifact@v4$/m);
    expect(step).toContain('path: coverage.log');
  });
  ```
  - 文件路径：`tests/unit/release-ci-gates.test.ts`
  - 依赖：T009
  - 验收：`npx vitest run tests/unit/release-ci-gates.test.ts -t "upload"` 全绿

## Phase 6: 变异实证（一次性操作，非永久代码）

- [x] T012 变异实证 (a)：临时注释掉 `coverage-gate-core.mjs` 中 (a) 汇总计数检查分支（使其恒真
  或直接短路跳过），重跑 `npx vitest run tests/unit/coverage-gate.test.ts`，记录哪些用例从红转绿
  （预期至少：`birpc-timeout-empty-counts.ansi.txt` 用例 + T004 合成串用例翻转为 pass，其余不变）。
  记录完毕后撤销注释、重跑确认全绿恢复。
  - 文件路径：`scripts/lib/coverage-gate-core.mjs`（临时改动，不保留）
  - 依赖：T003, T004
  - 验收：撤销后 `npx vitest run tests/unit/coverage-gate.test.ts` 全绿；本任务执行记录（翻转用例
    列表）写入 commit message 或 verify 阶段证据

- [x] T013 变异实证 (b)：临时注释掉 (b) `Errors N == 签名数` 检查分支，重跑测试，记录哪些用例翻转
  （预期至少：`unhandled-other.ansi.txt` 用例 + T005 中 Errors 行缺失合成串用例翻转为 pass）。
  撤销注释、重跑确认全绿恢复。
  - 文件路径：`scripts/lib/coverage-gate-core.mjs`（临时改动，不保留）
  - 依赖：T003, T005
  - 验收：同 T012 格式，撤销后全绿；记录写入 commit message 或 verify 证据

- [x] T014 变异实证 (c)：临时注释掉 (c) 覆盖率表完整性/末行判定检查分支，重跑测试，记录哪些用例
  翻转（预期至少：`summary-no-coverage-table.ansi.txt` 用例 + `tests-failed.ansi.txt`
  + T006 中"末行噪声"合成串用例翻转为 pass）。撤销注释、重跑确认全绿恢复。
  - 文件路径：`scripts/lib/coverage-gate-core.mjs`（临时改动，不保留）
  - 依赖：T003, T006
  - 验收：同 T012 格式，撤销后全绿；记录写入 commit message 或 verify 证据

- [x] T015 变异实证补充：临时注释掉负向检查（`does not meet`/`ERROR: Coverage for`/`failed` 汇总
  行判据），重跑测试，确认 T007"负向检查优先级"合成串用例从红翻转为 pass（证明该检查独立生效，
  不依赖其它三项正向检查兜底）。撤销注释、重跑确认全绿恢复。
  - 文件路径：`scripts/lib/coverage-gate-core.mjs`（临时改动，不保留）
  - 依赖：T007
  - 验收：同上，撤销后全绿；记录写入 commit message 或 verify 证据

## Phase 7: 异构对抗审查（提交前必做，非可选）

- [x] T016 按 CLAUDE.local.md 常设规则，对 `coverage-gate-core.mjs` + `coverage-gate.mjs` +
  `ci.yml` 改动派发独立子代理做异构对抗审查（非 Codex，档位缺席须在 commit message 标注），
  至少覆盖 plan.md §7 两个切入角：
  - 切入角 (a) fail-open/假证据面：三项正向检查是否存在"判真但无对应真实通过用例"的构造；
    `Errors N == 签名数 N` 在 `N>1` 时（多条不同类型错误恰好数量相等）是否可被绕过
  - 切入角 (b) 正则/边界构造面：`stripAnsi` 是否存在可被真实 vitest 输出触发的非 SGR 序列绕过；
    `checkCoverageTable` 的"末行必须是分隔线"判据是否能被"分隔线后跟空白字符而非真正空行"绕过；
    `parseSummaryLine` 类别白名单是否会被大小写变体（`Passed` vs `passed`）误判为未知类别
  - 结论按 critical/warning/info 三档处置：真实缺陷提交前修复并重跑 Phase 3+6；风格偏好记入
    commit message
  - 文件路径：无（审查任务，输出为 commit message 备注）
  - 依赖：T001, T002, T008
  - 验收：审查结论已归档（commit message 或 chat 记录），critical/warning 项全部修复或明确说明
    不采纳理由

## Phase 8: 全量门禁与本地/真实 CI 验证

- [x] T017 本地模拟真实覆盖率跑批，验证 CLI 薄壳 argv/文件读取路径无 bug：
  ```bash
  npm run test:coverage > /tmp/coverage.log 2>&1; status=$?
  node scripts/coverage-gate.mjs /tmp/coverage.log "${status}"; echo "gate exit=$?"
  ```
  预期：本仓当前测试套件全过、阈值达标（无 birpc 超时时）→ verdict pass、exit 0。
  - 文件路径：无（验证步骤）
  - 依赖：T001, T002
  - 验收：终端输出 `[coverage-gate] verdict=pass` 且 `gate exit=0`

- [x] T018 全量回归：`npx vitest run` + `npm run build` + `npm run repo:check` +
  `npm run release:check` 零失败，确认未牵连既有覆盖率阈值断言、CI 结构断言（尤其
  `vitest.config.ts` 的 6 个 threshold key / 4 个 include 条目精确计数断言不受影响，因为
  `coverage-gate-core.mjs` 刻意未纳入 `coverage.include`）。
  - 文件路径：无（验证步骤）
  - 依赖：T001-T016
  - 验收：四条命令均 exit 0，无新增测试失败

- [ ] T019 单次 commit，改动范围严格限定在 plan.md §3 清单内（2 修改：`ci.yml` /
  `release-ci-gates.test.ts`；3 新增：`coverage-gate-core.mjs` / `coverage-gate.mjs` /
  `coverage-gate.test.ts`）。commit message 需体现：根因（负向证据 + ANSI 盲区 + 文案 over-claim
  + `tail -n 40` 看不见汇总）、修法（正向证据判定器抽成可单测纯函数）、验证证据（8 真实样本 +
  各合成串隔离用例全绿 + T012-T015 变异实证已执行且记录翻转用例）、异构审查档位标注
  （「Codex 审查暂停，异构档位缺席」+ T016 结论摘要）。
  - 文件路径：无（提交动作）
  - 依赖：T017, T018
  - 验收：`git status` 显示仅上述 5 个文件改动；commit message 含四要素

- [ ] T020 push 到本 feature 分支触发 `ci.yml` 真实跑批（`on: push` 无分支过滤，feature 分支
  push 无需用户确认），观察 `Coverage (thresholds enforced)` 步与新增 `Upload coverage log` 步。
  验收判据：该步日志出现判定器的结构化摘录（而非旧的 `tail -n 40` 裸输出），且 `coverage-log`
  artifact 可下载；若本次真实跑批恰好触发 birpc 超时，需确认判定器按放行路径正确识别
  （打印 `verdict=pass` + 摘录），而不是误判硬红。
  - 文件路径：无（CI 观察）
  - 依赖：T019
  - 验收：GitHub Actions run 日志含 `[coverage-gate] verdict=` 摘录；`coverage-log` artifact 存在

---

## 根因点/决策覆盖映射表

| fix-report.md / plan.md 来源 | 对应 Task ID |
|---|---|
| 负向 grep 放行判据（Why 1-5 根因） | T001, T003 |
| CI 上 ANSI 未剥离导致负向 grep 结构性失效（实证 1） | T001（`stripAnsi`）, T003（真实 ANSI 样本） |
| 未处理错误进汇总的 `Errors N` 行未校验（实证 3） | T001（(b) 检查）, T005, T013 |
| 阈值失败行位置校验（实证 4） | T001（负向检查）, T007, T015 |
| birpc 超时打丢计数形态（实证 5） | T001（(a) 检查）, T003（`birpc-timeout-empty-counts`）, T004, T012 |
| `tail -n 40` 看不见汇总 | T008（删除）, T002（结构化摘录替代） |
| 判定逻辑落点决策1（core+CLI 拆分） | T001, T002 |
| CI 步骤改写决策2 | T008, T009 |
| `release-ci-gates.test.ts` 断言改写决策3 | T010, T011 |
| 新判定器行为测试+变异实证决策4 | T003-T007, T012-T015 |
| 可观测性/artifact 上传决策5 | T002, T009 |
| 异构对抗审查安排§7 | T016 |
| 验证方案§6（1-5 步） | T003-T007（步1）, T012-T015（步2）, T018（步3）, T017（步4）, T020（步5） |
| 主编排器修订：`birpc-timeout-empty-counts` 现状说明 + 合成串仍需编写 | T003, T004 |

---

## 依赖关系与并行说明

### Phase 依赖
- Phase 2（T001, T002）→ Phase 3（T003-T007，需 core 函数存在）
- Phase 2（T002）→ Phase 4（T008 需 CLI 脚本存在才能在 YAML 里调用；T009 依赖 T008 的步骤已存在）
- Phase 2（T001）+ Phase 4（T008）→ Phase 5（T010 需断言 core 文件字面量 + YAML 新形状；T011 依赖 T009）
- Phase 3 → Phase 6（变异实证需要先有完整测试用例才能观察翻转）
- Phase 2/4 完成 → Phase 7（审查覆盖的是已实现代码）
- Phase 3/5/6/7 全部完成 → Phase 8（全量门禁 + 提交 + push）

### 可并行任务
- T002（CLI 薄壳）与 T003（测试文件起草，写用例框架部分可并行，但断言需等 T001 落地）标记 [P]，
  但实际执行建议顺序：T001 → T002 与 T003 可并行开工（T003 依赖 T001 的导出签名，不依赖 T002）
- T009（新增 Upload 步）与 T010/T011（测试断言改写）在 T008 完成后可并行
- T012/T013/T014/T015 四条变异实证互相独立（各自注释不同检查分支），可并行执行但均需在同一份
  `coverage-gate-core.mjs` 上操作，建议**串行**避免临时改动互相覆盖（不标 [P]）

### 推荐实现策略
单次 commit 提交（plan §8 已限定），按 Phase 顺序 2→3→4→5→6→7→8 线性推进即可，无需拆分
MVP/增量交付（fix 卡范围窄，不适用 User Story 分期策略）。
