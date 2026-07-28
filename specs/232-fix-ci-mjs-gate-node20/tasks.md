---
title: "fix CI 门禁失效（Node 20 glob 假门 + 缺 build/建图 + 主机相关测试假设）— 任务分解"
feature: "232-fix-ci-mjs-gate-node20"
branch: "claude/mystifying-gagarin-5ca56b"
created: "2026-07-26"
status: "Completed"
---

# Tasks: fix CI 门禁失效（六条根因链 A–F）

**Input**: `specs/232-fix-ci-mjs-gate-node20/fix-report.md`（六条根因链 A/B/C/D/E/F）+ `specs/232-fix-ci-mjs-gate-node20/plan.md`（实现决策）
**Fix 模式说明**：本 feature 属于 fix 流程，无 `spec.md` / User Stories；任务按 fix-report 的六条根因链（Chain A–F）组织，取代常规 user-story 分组。六条链**根因彼此独立**（分别是 runner glob 能力、CI 缺 build、CI 缺建图、测试对绝对路径的过宽断言、跨 CPU 架构浮点差异、测试对主机进程表的真实查询），但**存在执行顺序依赖**：Chain C 的建图命令依赖 Chain B 产出的 `dist/`，故 ci.yml 中 `Build Knowledge Graph` 必须排在 `Build` 之后（B→C）。六条链均须完成才构成"恢复 CI 门禁"的完整闭环。

**链 D / 链 E / 链 F 的加入时机**：A/B/C 闭合后，codex 第一轮对抗审查指出真实 Ubuntu CI 还剩两个**主机相关**的测试失败（本机 macOS 必绿、CI 必红），追加为 Chain D / Chain E（见 Phase 6）；第二轮审查逐行解析真实 run 30090377786 的原始日志，发现该 run 共 8 个失败文件而 A–E 只覆盖 7 个，第 8 个 `tests/integration/watch-command.test.ts` 追加为 Chain F（见 Phase 7）。

**基线口径澄清（口径漂移已修正）**：mjs gate 的 F232 隔离基线是 **13 个文件 / 807 个用例**（`git ls-tree -r HEAD` 实测已跟踪 `*.test.mjs` = 13，干净树跑 `node scripts/run-plugin-tests.mjs` 得 `tests 807 / pass 807 / fail 0`）。本 worktree 工作区显示的 **19 文件 / 919 用例**含 F231 尚未提交的 6 个测试文件，**不是** master 历史事实、也不是本次验收值；下文凡出现 19/919 处均按此口径理解。

**Node 20 直跑 glob 的实际退出码**：`node20 --test "<glob>"` 直接执行 → 打印 `Could not find '<glob>'` 后 **exit 1**（干净树实测）。此前记录的 126 是经 `volta run` + npm 包装层后的退出码，非 runner 本身的码；根因判断（glob 展开是 Node 21+ 能力）不受此更正影响。

**枚举写法关键澄清（覆盖 plan.md 对应描述，以此为准）**：
plan.md 建议 `readdirSync(root, { recursive: true, withFileTypes: true })` + `entry.parentPath ?? entry.path` 兼容 Dirent 字段改名（Node 24 已移除 `.path`，Node 20 只有 `.path`）。编排器实测确认更稳的写法是 **`readdirSync(root, { recursive: true })`（不传 `withFileTypes`）**——直接返回相对路径字符串数组，双版本（Node 20.20.2 / Node 24.14.0）实测均正确枚举到全部 `.test.mjs`，完全绕开 Dirent 字段兼容问题，少一处跨版本假设。子目录条目会带 `/` 分隔前缀，需 `path.join(root, rel)` 还原为可传给 `--test` 的绝对路径。**任务 T001 必须采用此写法**。

## Format: `[ID] [P?] [Chain] Description`

- **[P]**：可并行（不同文件、无依赖）
- **[Chain]**：所属根因链（ChainA / ChainB / ChainC / ChainD / ChainE / ChainF / Both），无链归属的验证/收尾任务不加标记

---

## Phase 1: Chain A — 枚举脚本替换 runner glob（消除 Node 20 下 `Could not find` + exit 1）

**目标**：`test:plugins` 不再依赖 `node --test` 的 runner 内建 glob 展开（Node 21+ 能力），Node 20 与 Node 24 均可全量跑通全部 mjs 用例（隔离基线 807 个；工作区含 F231 未提交测试时为 919 个）。

**独立验证**：分别用 Node 20 二进制与 Node 24 直接执行 `node scripts/run-plugin-tests.mjs`，两者均 exit 0 且报告枚举到全部测试文件（隔离基线 13 个；工作区含 F231 时 19 个）。

- [x] T001 [ChainA] 新建 `scripts/run-plugin-tests.mjs`：
  - 用 `readdirSync(TESTS_ROOT, { recursive: true })`（**不传 `withFileTypes`**，理由见上方"枚举写法关键澄清"）递归枚举 `plugins/spec-driver/tests` 下条目，得到相对路径字符串数组
  - 过滤出以 `.test.mjs` 结尾的条目，`.sort()` 保证确定性输出顺序
  - 用 `path.join(TESTS_ROOT, rel)` 把相对路径还原为绝对路径，组成 `testFiles` 数组
  - 若 `testFiles.length === 0`：`console.error` 打印明确原因（枚举根目录路径 + "判定为失败而非静默跳过"），`process.exit(1)`——**不得静默 exit 0**
  - 否则：`console.error` 打印枚举到的文件数，`spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' })`，`process.exit(result.status ?? 1)` 透传子进程退出码
  - 只用 Node 内置模块（`node:fs`、`node:child_process`、`node:path`、`node:url`），零新增依赖
  - **完成判据**：文件存在于 `scripts/run-plugin-tests.mjs`；`node scripts/run-plugin-tests.mjs` 在当前 Node（本机默认版本）下 exit 0 且 stderr 打印 "枚举到 N 个测试文件"字样（N = 隔离基线 13 / 工作区含 F231 时 19）

**Checkpoint**：Chain A 脚本落地，本机默认 Node 版本下可独立跑通；下一步验证跨版本表现（Phase 3）。

---

## Phase 2: Chain B — CI 补齐 Build 步骤（消除 Test 因 dist 缺失而失败）

**目标**：`.github/workflows/ci.yml` 在 `Type Check` 与 `Test` 之间插入 `npm run build`，使依赖 `dist/` 产物的测试文件在 CI 干净 checkout 下也能找到编译产物。

**独立验证**：本地删除 `dist/` 后手动执行 `npm run build` 再 `npx vitest run`，确认无 `dist-missing` 类错误；随后确认 ci.yml 的 diff 语义与本地验证一致。

- [x] T002 [ChainB] 改 `.github/workflows/ci.yml`：在既有 `Type Check`（`npm run lint`）步骤之后、`Test`（`npm test`）步骤之前，插入一个新步骤：
  ```yaml
  - name: Build
    run: npm run build
  ```
  - 不加 `if: always()`（默认 `if: success()`，与 `Test` 步骤默认行为一致：`Type Check` 失败则级联跳过）
  - **不触碰**既有 `Test Plugins (mjs gate)` 步骤本体及其 `if: always()` 属性、其上方 L30-36 注释（F201 Phase B 有意设计，逐字保留）
  - 改动仅新增约 3 行，不删改文件其余任何行
  - **完成判据**：`git diff .github/workflows/ci.yml` 只显示新增的 `Build` 步骤块（3 行），无其余行被改动；`Test Plugins (mjs gate)` 步骤块与其注释逐字未变

**依赖**：T002 与 T001 互不依赖，可与 Phase 1 并行进行（不同文件）。

---

## Phase 3: package.json 接线（连接 Chain A 产物到既有入口）

**目标**：`test:plugins` 脚本改为调用 T001 新建的枚举脚本，使 `npm test` / CI 的 mjs gate 步骤自动受益。

**依赖**：必须在 T001 完成后进行（脚本文件须先存在，否则 `npm run test:plugins` 无法验证）。

- [x] T003 [ChainA] 改 `package.json` 的 `scripts.test:plugins` 一行：
  ```diff
  -    "test:plugins": "node --test \"plugins/spec-driver/tests/**/*.test.mjs\"",
  +    "test:plugins": "node scripts/run-plugin-tests.mjs",
  ```
  - 不改动 `scripts.test`（仍为 `vitest run && npm run test:plugins`，串联语义不变）
  - 不改动 `engines` 字段（理论缝隙已在 plan.md"已知限界"如实标注，不在本次变更范围）
  - **完成判据**：`git diff package.json` 只改这一行；`npm run test:plugins` 在本机默认 Node 版本下 exit 0

**Checkpoint**：Chain A（T001+T003）与 Chain B（T002）均落地，进入双版本验证阶段。

---

## Phase 4: 双 Node 版本验证（本次 fix 的核心验收，必须单列且不可省略）

**目标**：在 Node 20 与 Node 24 两个版本上分别实跑，证明两条根因链均已消除，而非仅凭本机单一版本"看起来通过"。

**前置**：T001、T002、T003 均已完成。

**Node 20 调用方式（务必遵守）**：直接使用 volta 镜像二进制路径 `~/.volta/tools/image/node/20.20.2/bin/node`，**不要**使用 `volta run --node 20 -- sh -c '...'` 嵌套 shell（已实测会因嵌套导致 exit 127 干扰判读）。

- [x] T004 [P] [Both] Node 20 × 枚举脚本独立跑：
  `~/.volta/tools/image/node/20.20.2/bin/node scripts/run-plugin-tests.mjs`
  **完成判据**：exit 0，stderr 显示枚举到全部测试文件，`node --test` 汇总报告全部用例通过（隔离基线 tests 807 / pass 807 / fail 0；工作区含 F231 时为 919/919/0）

- [x] T005 [P] [Both] Node 24（系统默认）× 枚举脚本独立跑：
  `node scripts/run-plugin-tests.mjs`
  **完成判据**：exit 0，枚举到同一文件集合，全部用例通过（口径同 T004）

- [x] T006 [ChainA] Node 20 × `npm run test:plugins`（经 npm 层，验证 T003 接线正确）：
  `~/.volta/tools/image/node/20.20.2/bin/npm run test:plugins`（或以该 Node 二进制所在 bin 目录置于 PATH 前列后执行 `npm run test:plugins`）
  **完成判据**：exit 0，全部用例通过（依赖 T004 已确认脚本本身可跑通后再验证 npm 层封装无额外损耗）

- [x] T007 [ChainA] Node 24 × `npm run test:plugins`
  **完成判据**：exit 0，全部用例通过（依赖 T005）

- [x] T008 [ChainB] `npm run build`（本机默认 Node 版本即可，Build 步骤不涉及双版本兼容性问题）
  **完成判据**：exit 0，`dist/` 目录生成且包含 `dist/core/ast-analyzer.js`（fix-report 中明确点名的缺失产物）

- [x] T009 [ChainB] `npm run build` 之后紧接 `npx vitest run`（模拟 CI 新序列：build 先于 test）
  **完成判据**：exit 0，无任何 `dist-missing` / `DRIFT_GRAPH_UNAVAILABLE` 类错误，通过率与改动前基线一致（不引入新失败）

- [x] T010 [ChainA] 零文件 fail-loud 场景验证（验证 T001 的 fail-loud 分支真实生效）：
  临时创建一个空目录（如 `/tmp` 或 scratchpad 下的空目录，**不得指向仓库内任何真实测试目录**），用一次性命令验证枚举根目录为空时的行为——例如临时把 `TESTS_ROOT` 常量替换为空目录路径跑一次（或用一个基于同一脚本逻辑的最小内联复现），确认：
  - 进程以非 0 退出码结束
  - stderr 有明确指出"未枚举到任何 *.test.mjs 文件，判定为失败"字样的报错
  **完成判据**：非 0 退出码 + 明确报错文案；**验证完成后必须撤销任何临时修改**，`git status` 确认 `scripts/run-plugin-tests.mjs` 与仓库其余文件相对 T001/T002/T003 提交状态无残留改动

**Checkpoint**：T004-T010 全部完成 = 双 Node 版本 + 零文件场景三类证据齐备，Chain A 与 Chain B 均有实测证据支撑，而非推测性声明。

---

## Phase 4.5: Chain C — CI 补齐建图步骤（消除 Test 因 `specs/_meta/graph.json` 缺失而失败）

**目标**：`.github/workflows/ci.yml` 在 `Build` 与 `Test` 之间插入 `Build Knowledge Graph`，
使硬依赖 `specs/_meta/graph.json`（被 `.gitignore:74` 忽略的构建产物）的测试在 CI 干净 checkout 下也能找到该产物。

**背景**：Chain C 是在 Chain A + Chain B 落地后的干净树复现中才浮出水面的——
补齐 build 消掉了大片 `dist-missing` 失败，但 vitest 仍剩 2 个文件红（`expected false to be true`），
经定位为缺 `specs/_meta/graph.json`。Chain B 的失败此前**掩盖**了 Chain C，故本阶段排在 Phase 4 之后。

**独立验证**：干净树（`git archive HEAD | tar -x`）下先 build 再执行建图命令，
确认 `specs/_meta/graph.json` 生成，随后单独重跑那 2 个测试文件全绿。

- [x] T016 [ChainC] 改 `.github/workflows/ci.yml`：在既有 `Build`（`npm run build`）步骤之后、`Test`（`npm test`）步骤之前，插入新步骤：
  ```yaml
  - name: Build Knowledge Graph
    run: node dist/cli/index.js batch --mode graph-only
  ```
  - 步骤上方加简短注释说明**为何需要**：干净 checkout 无 `specs/_meta/graph.json`（gitignored），
    而 graph-quality / spec-drift 相关测试硬依赖它；graph-only 为纯 AST、零 LLM、零认证、约 5s；
    必须排在 Build 之后（依赖 `dist/cli/index.js`）
  - 不加 `if: always()`（与 `Build` / `Test` 一致的默认 `if: success()` 级联语义）
  - **不新增 npm script**（如 `graph:build`）：单点消费，直接写命令使"依赖 dist 产物 → 必须在 Build 之后"这一顺序约束在 workflow 里显式可见（理由见 fix-report.md 修复策略）
  - **不触碰** Chain A / Chain B 的既有改动，**不触碰** `Test Plugins (mjs gate)` 步骤本体、其 `if: always()` 属性及上方注释（F201 Phase B 有意设计，逐字保留）
  - **不改任何测试文件、不改任何产品代码**——特别是**不得**把那 2 个测试改成"缺图则 skip"（会永久关闭 F217 图质量门与 F219 drift 回归门，属调弱门禁）
  - **完成判据**：`grep -n "name:" .github/workflows/ci.yml` 输出的步骤序列为
    Checkout → Setup Node.js → Install Dependencies → Type Check → Build → **Build Knowledge Graph** → Test → Test Plugins (mjs gate)

- [x] T017 [ChainC] 干净树建图命令实测：在 `git archive HEAD | tar -x` 导出的干净树中，
  `npm run build` 之后执行 `node dist/cli/index.js batch --mode graph-only`
  **完成判据**：exit 0；耗时数量级为秒（非分钟）；输出显式标注 graph-only 模式为纯 AST 零 LLM；
  生成 `specs/_meta/graph.json`（MB 级，节点/边数非零）

- [x] T018 [ChainC] 图就位后单独重跑此前失败的 2 个测试文件：
  `npx vitest run tests/unit/graph-quality-core.test.ts tests/integration/spec-drift-repo-check-regression.test.ts`
  **完成判据**：exit 0，12 个用例全部通过（10 + 2），无 `expected false to be true`

**Checkpoint**：Chain C 落地并有干净树实测证据，三条链齐备，进入 Phase 4.6 端到端干净 CI 复现。

---

## Phase 4.6: 干净 CI 环境端到端复现（三链合并验收，核心验证）

**目标**：不是分别验证三条链，而是**一次性按 ci.yml 的完整步骤序列**在等价于 CI 的干净环境里跑通，
证明"恢复 CI 门禁"这一整体目标真正达成，而非三条链各自局部绿。

**环境构造要求（务必遵守）**：
- 用 `git archive HEAD | tar -x -C <tmpdir>` 导出干净树——**只含已跟踪文件**，等价 CI checkout；
  不得用 `cp -r` 拷贝工作区（会带入本地残留的 `dist/`、`specs/_meta/graph.json`，直接使验证失效）
- 拷入本次三处未提交改动：`scripts/run-plugin-tests.mjs`、`package.json`、`.github/workflows/ci.yml`
- `package.json` 中 F231 的 `judge:doctor` 行须**删除**（属另一 feature，不在本次模拟范围）
- 软链 `node_modules`（等价 CI 的 `npm ci` 产物，避免重复安装耗时）
- Node 版本用 **20**：直接使用二进制路径 `~/.volta/tools/image/node/20.20.2/bin/node`，
  **不要** `volta run --node 20 -- sh -c '...'` 嵌套（已实测 exit 127 干扰判读）

- [x] T019 按 ci.yml 步骤序列在干净树 + Node 20 下依次执行并逐步记录 exit code：
  lint → build → 建图 → `npx vitest run` → `npm run test:plugins`
  **完成判据**：五步 exit code 全为 0

- [x] T020 干净树 vitest 结果定性核查：
  **完成判据**：
  - `dist-missing` 出现计数为 **0**（证明 Chain B 闭合）
  - `DRIFT_GRAPH_UNAVAILABLE` 出现计数为 **0**（证明 Chain C 闭合）
  - `graph-quality-core.test.ts` 与 `spec-drift-repo-check-regression.test.ts` 均标记为通过
  - 失败文件数为 0；若有失败须逐个定性（隔离重跑判断是否负载 flaky）并如实报告，**不得粉饰**
  - 被 skip 的测试文件须逐一确认其 skip 原因为凭据/LLM 门控（CI 同样无凭据，属预期），而非本次改动引入

- [x] T021 `.git` 存在性保真度补验：干净树默认无 `.git`，而真实 CI 的 `actions/checkout` 会产出 `.git`。
  在模拟树内 `git init` + 提交一次基线后，重跑 T018 的那 2 个测试文件
  （二者含 commit 级 staleness / dirty 态判定，对 `.git` 存在性敏感）
  **完成判据**：exit 0，12/12 通过——证明有无 `.git` 两种条件下结论一致
  **注意**：`git init` 只允许在 tmpdir 内的模拟树执行；**禁止对真实 worktree 做任何 git 写操作**

**Checkpoint**：T019-T021 全绿 = 三条链在等价 CI 环境下合并验证通过，本地已真正复现 CI 而非推测。

---

## Phase 5: 收尾全量验证与还原

**目标**：确认改动未引入任何回归，仓库处于可提交状态。

**前置**：Phase 4 全部通过。

- [x] T011 [P] 全量执行 `npm run test:plugins`（本机默认 Node 版本）
  **完成判据**：exit 0

- [x] T012 [P] 全量执行 `npx vitest run`
  **完成判据**：exit 0，零失败（含已知 flaky 用例需按既往记忆甄别，如 `batch-orchestrator-incremental` 隔离重跑绿等历史已知噪声，不得当作本次改动引入的回归）。
  **注**：`watch-command.test.ts` 此前也被记忆归为"worktree 预存 flaky"，Chain F 已证伪该归类——它是环境相关的确定性失败，见 Phase 7

- [x] T013 [P] 全量执行 `npm run build`
  **完成判据**：exit 0，类型检查与产物生成均无错误

- [x] T014 全量执行 `npm run repo:check`
  **完成判据**：exit 0，无新增 diagnostics

- [x] T015 确认改动范围仅限 3 处文件（**Chain A/B/C 阶段口径**；Chain D/E/F 落地后最终范围见 Phase 6/7，共 7 处已跟踪文件）：`git diff --stat` 只显示 `package.json`（1 行）、`.github/workflows/ci.yml`（Chain B 约 3 行 + Chain C 约 7 行新增，含注释）、`scripts/run-plugin-tests.mjs`（新增文件，含 T010 验证后无残留改动）
  **完成判据**：`git diff --stat` 输出与预期文件集合一致，无其余文件被意外改动（未改任何测试文件、未改任何 `src/` 或 `plugins/*/scripts/lib/` 产品代码）；
  本 worktree 中 F231 的未提交改动（`judge-snapshot-*` / `judge-*` / `package.json` 的 `judge:doctor` 行）**不属本次变更**，须保持原样不动

**Checkpoint**：Phase 1–5 完成 = CI 的三个配置面门禁（Node 20 mjs gate / build / 建图）真正生效，本地已复现 CI 环境（干净 checkout + 干净 dist + 无图 + Node 20）并全绿。
**但这不等于真实 CI 全绿**——平台相关的 Chain D / Chain E 在本地干净树里不可见，须继续 Phase 6。

---

## Phase 6: Chain D + Chain E — 平台相关的残余 CI 失败（codex 对抗审查追加）

**背景**：A/B/C 闭合后，codex 指出真实 Ubuntu CI 还有两处失败，二者共同特征是**本机 macOS 必绿、Ubuntu runner 必红**——
本地复现（即便干净树 + Node 20）也无法暴露，因为它们依赖的不是 Node 版本或产物，而是**运行主机的路径形态与 CPU 架构**。

### Chain D：F176 的 `/r` 断言在 GitHub runner 路径下必然失败

- [x] T022 [ChainD] 改 `tests/unit/feature-176-spike-and-gate.test.ts` 的 `runCombDir 不含 repeatIndex（combo 根）` 用例：
  - `runCombDir` 返回**绝对路径**，而 GitHub runner 工作区是 `/home/runner/work/...`，本身就含 `/r` 子串 → `.not.toContain('/r')` 在 CI 必然失败
  - 断言收窄为**只看 `VERIFIED_ROOT` 之后的相对段**：`path.relative(VERIFIED_ROOT, combDir)` 恒等于 `path.join('tasks','t','c')`，再叠一条 repeatIndex 形态正则
  - **必须用 `path.relative` 而非 `indexOf` + `slice`**（codex 第二轮）：字符串截断在路径中该子串出现多次时只截到第一次会误判，且 `VERIFIED_ROOT_REL` 用 `/` 分隔而 `path.join` 在 Windows 返回 `\`
  - 补一条正向对照 `expect(runFixturePath('t','c',1)).toBe(path.join(combDir,'r1','full.json'))`，把"combo 根恰是 r&lt;N&gt; 的父目录"这一真实意图表达完整
  - **措辞约束**：不得声称新断言"严格强于原断言 / 原断言能抓的一条不漏"——codex 给出反例 `.../t/c/repeat1`（旧 `.not.toContain('/r')` 能抓、新正则放过，但相对段等式仍能抓）。正确表述是**更精确地表达当前 `r<N>` 合同**
  - **不改** `scripts/lib/swe-bench-verified-paths.mjs` 产品代码（原实现无缺陷，缺陷在断言写法）
  - **完成判据**：在路径含 `/r` 的忠实复现装置（把 `git archive HEAD` 导出到 `<tmp>/home/runner/work/cc-plugin-market/cc-plugin-market`）下，
    修复前 `1 failed | 18 passed`、修复后 `19 passed`；且变异测试（临时让 `runCombDir` 返回带 `r1` 的路径）仍能红

### Chain E：F220 浮点快照跨平台差异

- [x] T023 [ChainE] 改 `src/panoramic/anchoring/edge-builder.ts`：语义边 `confidenceScore` 在**出口处**量化到 4 位小数
  - 该字段是**当前 anchoring / embedding 路径上**唯一一处非常量 confidenceScore（该路径其余取 `CONFIDENCE_SCORES` 常量 0.65 / 0.95），值来自 all-MiniLM-L6-v2 embedding 的余弦相似度
  - **措辞约束（codex 第二轮，事实更正）**：不得写"全图唯一写入点"——`src/panoramic/graph/graph-builder.ts:218` 的 `relationship.confidenceScore ?? CONFIDENCE_SCORES[confidence]` 是另一条持久化入口，`ArchitectureIRRelationship.confidenceScore?: number` 可由调用方给任意值；只是当前内置 producer 均未赋该字段
  - **措辞约束（codex 第二轮）**：量化是"**显著降低**跨平台不可复现风险"而非"消除"——中点邻域仍可翻面，残余值域约 8.74e-5；`4695×` 余量只对 F220 这一条观测边成立，须显式标为**单点观测**（当前图里语义边仅 1 条）
  - 量化只作用于**最终写出的数值**；去重比较仍用原始相似度，保证对"选中哪条边"零影响
  - 精度取 4 位而非 6 位：实测该值到 6 位量化中点仅 4.2 倍余量（临界），4 位有 4695 倍余量（详见 fix-report 链 E）
  - **完成判据**：`npx vitest run tests/panoramic/anchoring/` 全绿（既有用例的 0.85/0.90/0.8/0.82 在 4 位下无损）

- [x] T025 [ChainE] 在 `tests/panoramic/anchoring/edge-builder.test.ts` **补单测**（仓库硬约束：产品代码改动必须同提交带单测；此前量化逻辑只被一个 e2e 快照值间接覆盖）
  - 全部经由公开入口 `buildSemanticEdges` 断言，**不为测试扩大导出面**
  - 至少覆盖 4 类：① 两个真实平台值 `0.780570518226505`(macOS) 与 `0.7805705225965378`(Ubuntu) **均输出 `0.7806`**（含序列化字符串一致）；② 边界与格点值 `0` / `1` / `0.15` / `0.85` / `0.90` / `0.8` / `0.82` 不变；③ 量化中点两侧舍入方向明确（half-up）；④ **"去重仍用原始值"的行为守护**
  - ④ 的构造：两条三元组相同、原始相似度 `0.800041 < 0.800049`（量化后同为 `0.8`）的候选边，**低分在前**；断言最终选中边的 `evidenceSource` / `evidenceText` 来自**原始值更高**的那条——这是防止未来有人把量化挪到去重之前的唯一守护
  - **完成判据**：`npx vitest run tests/panoramic/anchoring/edge-builder.test.ts` → 16 passed；且两次变异测试均能被抓（M1 让 quantize 返回原值 → 3 failed；M2 把量化挪到构造处 → 1 failed 且恰为 ④）；变异撤销后与备份**字节级一致**

- [x] T024 [ChainE] 外科式修改 `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` **1 处**字面量：
  `0.780570518226505` → `0.7806`
  - **严禁 `vitest -u`**（该 .snap 是 F220 冻结守护资产，文件头明确约定）
  - 同步在 e2e 测试文件头补一条 F232 链 E 的口径说明（与既有 F223 条目同构）
  - **完成判据**：`npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` 12/12 全绿；
    `.snap` 的 diff 仅此 1 行（快照 key 集合不变，场景10a 守护自动复核）

**Checkpoint**：Chain D 有"含 `/r` 路径装置下前红后绿 + 变异测试仍红"双向证据；
Chain E 有"本机全绿 + 新增单测 + 双变异测试 + 量化余量论证"证据——但**跨平台结论须待真实 Ubuntu CI 复核**，本地无法自证（见 fix-report「已知残余」）。

---

## Phase 7: Chain F — watch 集成测试对主机进程表的真实查询（codex 第二轮对抗审查追加）

**背景**：codex 第二轮逐行解析真实 CI run 30090377786 的原始日志，发现该 run 共 **8 个失败文件**，
而链 A–E 只解释了其中 7 个；第 8 个 `tests/integration/watch-command.test.ts` 从未被归因，
此前被 fix-report 记为"预存负载 flaky、不在本 fix 范围"。第二轮复核推翻了该判断。

- [x] T026 [ChainF] 改 `tests/integration/watch-command.test.ts` 的 `runBatch 被调用时包含配置文件中的 outputDir 和 languages` 用例：
  - **先定根因，别改超时**：从 `capturedOnChange(...)` 到 `runBatch(...)` 的路径**全同步**（本机实测该用例 82ms，其中 50ms 是测试自己的固定 sleep），
    故 `runBatch` 要么在 waitFor 首次轮询前已被调用、要么**永远不会**被调用；唯一能让它不被调用的分支是
    `handleChange` 的第一道闸门 `isExternalBatchRunning()`，其实现 `execSync('pgrep -f "spectra batch"')` 查询**运行主机全部进程的命令行**
  - 修法：`vi.mock('node:child_process', ...)` 把 `execSync` 钉成抛错（= 真实 pgrep 无匹配时的行为，watch.ts 的 catch 判为 false），
    使该用例不再取决于主机进程表；并加 `expect(childProcessMocks.execSync).toHaveBeenCalled()` 防止将来 mock 被悄悄删掉
  - `vi.waitFor` 超时 `5000 → 20_000` 仅作 CI 负载余量，**不是**链 F 的修复手段（注释须写明，避免因果记反）
  - **不削弱任何断言**：`runBatch` 的参数断言（`expect.any(String)` + `objectContaining{incremental,outputDir,languages}`）逐字保留
  - **不改产品代码**：`isExternalBatchRunning()` 的 pgrep 探测是 FR-010 既定设计，生产行为正确
  - **不动**同文件第 1 个用例的 `expect(elapsed).toBeLessThan(2000)`——那是 FR-013 的产品断言，放宽它属于削弱断言
  - **完成判据**：忠实复现装置（主机上放一个命令行含 `spectra batch` 的诱饵进程 `node -e 'setTimeout(()=>{},120000)' "spectra batch" &`）下，
    修复前 `1 failed | 6 passed`（耗时 5091ms，报 `vi.waitFor.timeout ...:149:28`，与真实 CI 日志同形）、修复后 `7 passed`；
    无诱饵进程时同样 `7 passed`；验证后**必须清理诱饵进程**

**Checkpoint**：Chain F 有"诱饵进程装置下前红后绿 + 无装置仍绿"双向证据，且该失败在本机被**完整复现**过，
不再是"只能等真实 CI 复核"的猜测。至此 run 30090377786 的 8 个失败文件全部归因并覆盖。

---

## FR / 根因覆盖映射表

| 根因链 / 修复点 | 对应 Task ID |
|---|---|
| Chain A：Node 20 下 `node --test` glob 假门（`Could not find` + exit 1） | T001, T003, T004, T006, T010 |
| Chain B：CI 缺 build 步骤致 Test 因 dist 缺失失败 | T002, T008, T009 |
| Chain C：CI 缺建图步骤致 Test 因 `specs/_meta/graph.json` 缺失失败 | T016, T017, T018 |
| Chain D：F176 用例用 `.not.toContain('/r')` 表达"无 repeatIndex 段"，在 `/home/runner/...` 路径下必红 | T022 |
| Chain E：F220 快照钉死 embedding 余弦相似度全精度浮点，跨 CPU 架构必红 | T023, T024, T025 |
| Chain F：watch 集成测试保留了对主机进程表的真实 `pgrep` 查询，命中即 runBatch 永不被调用 | T026 |
| 产品代码改动必须同提交带单测（仓库硬约束） | T025 |
| 零文件静默通过风险（fail-loud 保障） | T001（实现）, T010（验证） |
| 双 Node 版本等价性（不得只本机 Node 24 绿） | T004, T005, T006, T007 |
| 干净 CI 环境三链合并端到端复现 | T019, T020, T021 |
| 全量回归与变更范围收窄确认 | T011, T012, T013, T014, T015 |

---

## Dependencies & Execution Order

### Phase 依赖关系

- **Phase 1（Chain A 脚本）** 与 **Phase 2（Chain B ci.yml）**：互不依赖，文件不同，可并行进行
- **Phase 3（package.json 接线）**：依赖 Phase 1（T001 脚本文件须先存在）完成
- **Phase 4（双版本验证）**：依赖 Phase 1+2+3 全部完成（T001/T002/T003）
- **Phase 4.5（Chain C ci.yml 建图步骤）**：依赖 Phase 2（T002 的 Build 步骤须先存在——建图命令依赖 `dist/cli/index.js`）；
  其被识别出来也依赖 Phase 4 的干净环境实测结果（Chain B 修好后才暴露）
- **Phase 4.6（干净 CI 端到端复现）**：依赖 Phase 1+2+3+4.5 全部完成（三条链齐备才有合并验收意义）
- **Phase 5（收尾全量验证）**：依赖 Phase 4.6 全部通过
- **Phase 6（Chain D + Chain E）**：与 Phase 1–5 无实现依赖（改的是测试断言与产物量化，不碰 CI 配置与枚举脚本）；
  但**必须重跑 Phase 5 的全量验证**，因为 T023 动了产品代码（`src/panoramic/anchoring/edge-builder.ts`）；
  T025（补单测）依赖 T023（先有量化实现才谈得上锁定其契约）
- **Phase 7（Chain F）**：与 Phase 1–6 无实现依赖（只改 `tests/integration/watch-command.test.ts` 一个文件）；
  同样须在其后重跑 Phase 5 的全量验证

### 链间依赖

- Chain A（T001, T003, T004, T006, T007, T010）与 Chain B（T002, T008, T009）在实现层完全独立，无共享文件、无调用依赖
- Chain C（T016, T017, T018）在**实现层**与 Chain A 独立，但与 Chain B 有**执行顺序依赖**：
  建图命令 `node dist/cli/index.js batch --mode graph-only` 需要 `dist/` 已就位，
  故 ci.yml 中 `Build Knowledge Graph` 必须排在 `Build` 之后（这是本次唯一的链间硬顺序约束）
- Chain B 与 Chain C 共享 `.github/workflows/ci.yml` 一个文件，故 T002 与 T016 **不可并行**（须先 T002 后 T016）
- Chain D（T022）、Chain E（T023, T024, T025）、Chain F（T026）与 A/B/C 在实现层完全独立（改的是测试断言、产物量化与测试依赖隔离，不共享文件），
  但它们**只在真实 Ubuntu runner 上才失败**，所以在 A/B/C 的本地干净树复现里必然看不见——这正是它们被漏到最后的原因
- "恢复 CI 门禁"这一整体目标要求六条链都修复（fix-report 已论证：只修 A 仍全红，只修 A+B 仍剩 2 个测试红，
  A+B+C 后本地全绿但真实 CI 仍有 D/E/F 三处红），故全量验证必须等六条链都完成后才有意义

### 并行机会

- T001（Chain A）与 T002（Chain B）可并行（不同文件）
- T004 与 T005（Chain A 双版本脚本验证）可并行（互不影响，各自独立进程）
- T011/T012/T013（收尾三个独立命令）可并行执行

---

## Parallel Example

```bash
# Phase 1 + Phase 2 并行（不同文件、无依赖）：
Task: "新建 scripts/run-plugin-tests.mjs（枚举 + spawnSync + fail-loud）"
Task: "改 .github/workflows/ci.yml 插入 Build 步骤"

# Phase 4 双版本验证并行：
Task: "Node 20 二进制跑 scripts/run-plugin-tests.mjs，确认 exit 0 / 全部用例 pass"
Task: "Node 24（系统默认）跑 scripts/run-plugin-tests.mjs，确认 exit 0 / 全部用例 pass"
```

---

## Implementation Strategy

本 fix 无 User Story 增量交付概念（规模 LOW、无跨包影响），采用**一次性完整交付**策略而非分阶段发布。
（Chain D / Chain E 加入后变更面从 3 个文件扩到 7 个，见下方 Notes 的变更约束更新）

1. Phase 1 + Phase 2 并行完成（Chain A 脚本 + Chain B ci.yml）
2. Phase 3 接线（package.json）
3. **STOP and VALIDATE**：Phase 4 双 Node 版本 + 零文件场景实测——任何一项跨版本证据缺失都不能视为修复完成
4. Phase 4.5 Chain C（该链正是在第 3 步的干净环境实测中暴露：Chain B 修好后 vitest 仍剩 2 个文件红）
5. **STOP and VALIDATE**：Phase 4.6 干净 CI 端到端复现，这是本次 fix 最有意义的"验证 checkpoint"——
   三条链必须在同一次干净跑里合并验证通过，各自局部绿不足以证明门禁恢复
6. Phase 5 全量回归确认无残留改动、无新增失败
7. Phase 6 Chain D + Chain E（codex 第一轮对抗审查追加的两条**主机相关**链）——Chain D 用"路径含 `/r` 的忠实复现装置"本地取证；
   Chain E 无法本地复现（需要另一 CPU 架构），只能以量化余量论证 + 新增单测 + 真实 CI 复核
8. Phase 7 Chain F（codex 第二轮对抗审查追加）——用"含 `spectra batch` 命令行的诱饵进程"装置本地**完整复现**并取前红后绿双向证据
9. 推送分支触发一次真实 GitHub Actions 运行，确认 `Type Check` / `Build` / `Build Knowledge Graph` / `Test` / `Test Plugins (mjs gate)` 五步全部 success（plan.md 验证方案明确要求，不依赖本地模拟替代真实 CI 观测）。
   **这一步对 Chain E 是不可省略的验收**，不是可选的锦上添花

---

## Notes

- [P] 任务 = 不同文件、无依赖
- [Chain] 标记任务所属根因链，Both 表示同时验证多条链是否共同生效的收尾类任务
- 改动约束（Chain A/B/C 阶段，来自 plan.md）：零新增依赖、不改任何测试文件、不改任何产品代码、
  `package.json` 仅改 1 行、`ci.yml` 新增 **2** 步（Chain B 的 `Build` + Chain C 的 `Build Knowledge Graph`）、
  至多新增 1 个脚本文件、**不新增 npm script**
- **Chain D / Chain E / Chain F 显式放宽了上述两条约束**（用户拍板"一并修到 CI 真绿"）：
  Chain D / Chain F 必须改测试文件（缺陷就在断言写法与依赖隔离里），Chain E 必须改产品代码（`edge-builder.ts` 出口量化）并同提交补单测。
  放宽仅限这三处，其余约束（零新增依赖、不新增 npm script、不动 F231 文件）继续成立
- **不得**把"修到 CI 真绿"理解成"把红的测试改绿"：Chain D 的修法是**收窄**断言到真实意图并**补强**正向对照，
  Chain E 的修法是让**产物本身**跨平台确定并新增契约单测，Chain F 的修法是把一条**本就不该存在的外部世界依赖**隔离掉、
  断言逐字未动。三者都没有降低守护强度（D 附变异测试、E 附双变异测试、F 附诱饵进程装置前后对比）
- **链 F 的教训单列**：失败表象是"5s 超时"，极易被误判为负载 flaky 而调大超时了事；
  实际是环境相关的**确定性**失败。判定方法是先问"断言目标所在的代码路径是同步还是异步"——
  同步路径下的 waitFor 超时一定意味着目标事件**根本没发生**，而不是"发生得慢"
- Chain C 的处置方向由用户拍板：**CI 建图**而非"测试缺图则 skip"。后者会让 F217 图质量六指标与 F219 drift 回归门
  在唯一真实的干净环境里永久失效，把显性红换成隐性绿——属调弱门禁，与本 fix"恢复门禁"的目标背道而驰
- Chain C 的存在提示一类通用风险：**测试硬依赖 gitignored 构建产物**时，本地长期残留副本会使该依赖永不暴露。
  后续新增此类依赖时应同步问一句"干净 checkout 有没有这个文件"
- T010 零文件验证涉及"临时修改后必须撤销"，执行时需格外小心不留残留（历史记忆：`codex-rescue` 曾因类似临时性 git 实验污染 worktree，此处虽非 git 层面而是脚本内常量层面的临时验证，仍需同等谨慎并在完成后立即用 `git status` / `git diff` 复核）
