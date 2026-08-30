---
feature: 268-fix-ci-spectra-bin-fallback
mode: fix
based_on: plan.md 方案 A
---

# Tasks: F268 CI 真实 spectra CLI 解析回退链

**输入**：plan.md（方案 A）+ fix-report.md
**范围**：3 个文件（1 新增 helper + 2 处测试文件局部编辑），不改生产代码 / ci.yml

## Format: `[ID] [P?] 描述 + 文件路径 + 验收判据`

---

## Phase 1: 新增共享 helper

- [x] T001 新增 `plugins/spec-driver/tests/lib/real-spectra-bin.mjs`（落点从 plan.md 的 tests/helpers/ 改为 tests/lib/，遵循 F236 起的测试 helper 惯例目录，由编排器运行时指令覆盖），导出 `resolveRealSpectraBin({ repoRoot } = {})`：
  - 第一级 PATH 探针 `spawnSync('spectra', ['--version'])`，成功返回 `'spectra'`
  - 第二级 `<repoRoot>/dist/cli/index.js` 存在时生成 `mkdtempSync` wrapper（`#!/bin/sh` + `exec node <dist> "$@"`，mode 0o755），对 wrapper 复跑 `--version` 验真通过才返回 wrapper 路径
  - 两级皆失败返回 `null`（不抛错，不在模块顶层执行 spawn）
  - `repoRoot` 缺省时用 `fileURLToPath(import.meta.url)` 向上 4 级推导仓根
  - **验收**：文件存在，`node -e "import('./plugins/spec-driver/tests/lib/real-spectra-bin.mjs').then(m=>console.log(typeof m.resolveRealSpectraBin))"` 输出 `function`（实跑已验证）；命名不以 `.test.mjs` 结尾（`run-plugin-tests.mjs` 枚举器不会误收）
  - **delta 修复批次 3**（对抗审查收口，最后一批）：`probeVersion` 加 `killSignal: 'SIGKILL'`（默认 SIGTERM 可被子进程忽略，实测挂起二进制 timeout=10s 下 60.4s 才返回，SIGKILL 下 10.0s 精确闭合，同坑 `graph-bootstrap-status.mjs` L506-508 已登记）；`PROBE_TIMEOUT_MS` 10s→30s（10s 已被 `tests/integration/cli-e2e.test.ts` 同型探针证实满载可穿透，穿透后果=静默从一级切到二级不同版本 CLI）；L20-21 注释失真修正（不再声称"逐字节不变"，改写明确 30s 有界超时带来的行为分歧）；`repoRoot` JSDoc 补充"仅影响二级"澄清。新增专属机制测试 `plugins/spec-driver/tests/real-spectra-bin.test.mjs`（5 用例：二级成功/缺失/复验拦截/转义安全/缓存语义，全部经子进程 masked-PATH 隔离），补齐此前二级机制在装了全局 spectra 的开发机上零执行覆盖的盲区。实测：新文件 5/5 pass；`graph-refresh-executor.test.mjs` 14/14；`graph-consumption-cli.test.mjs` Part 4 2/2；masked PATH 复跑二者同样全绿；`npm run test:plugins` 退出码 0，1585 tests / 1583 pass / 0 fail / 2 skipped（较 delta 前 1580 tests 净增 5，与新文件用例数一致）

**Checkpoint**：helper 独立可用，两个测试文件的编辑依赖此文件已存在

---

## Phase 2: 改两个测试文件的调用点（仅 plan §4.2/§4.3 列出的位置，其余用例不动）

- [x] T002 [P] 编辑 `plugins/spec-driver/tests/graph-refresh-executor.test.mjs`：
  - 顶部加 `import { resolveRealSpectraBin } from './lib/real-spectra-bin.mjs';`
  - L199-229（FR-007/SC-002 集成用例）：删除裸探针判空逻辑，改为 `it()` 内 `const bin = resolveRealSpectraBin();`，`bin === null` 时 `assert.fail(升级消息)`；`spectraBin: 'spectra'` 改为 `spectraBin: bin`
  - L231-240（ENOENT 负向用例）与 L77-180（`fakeBuild()` 注入路径 6 处）**未改动**
  - **验收**：`git diff --stat` 该文件仅新增 import + 上述两处编辑 + 文件头一句注释；`node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs` 在正常 PATH 下实测 14/14 pass

- [x] T003 [P] 编辑 `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`：
  - 顶部加同一 import（路径同为 `./lib/real-spectra-bin.mjs`）
  - Part 4 / SC-002 用例（L1896-1942）：探针替换为 `resolveRealSpectraBin()` + null 时 `assert.fail`；`spawnSync('spectra', ['batch', '--mode', 'graph-only'])` 改用 `bin`；`runCli(['decide', …])` 追加 `'--spectra-bin', bin`
  - Part 4 / SC-003 用例（L1945-1976）：同构改动
  - 其余 ~90 处 `seedFakeSpectra()` 调用点**未改动**
  - **验收**：`git diff --stat` 该文件仅新增 import + 上述两处编辑 + 文件头一句注释；正常 PATH 下 `node --test --test-name-pattern "Part 4" plugins/spec-driver/tests/graph-consumption-cli.test.mjs` 实测 2/2 pass

**Checkpoint**：3 个文件改动完成，改动范围与 plan §4 清单逐条对齐

---

## Phase 3: 验证序列（plan §6 四步）

- [x] T004 本地正常 PATH 全绿回归：`npm run test:plugins` 实测退出码 0，`tests 1580 / pass 1578 / fail 0 / skipped 2`（2 个预存 skip 与本次改动无关，确认未触碰的 ~100 个用例零行为变化）

- [x] T005 本地模拟 CI（masked PATH，转绿验证，改用编排器提供的 scratchpad `ci-sim-bin/node` 软链，等效 plan.md 的 `/tmp/f268-ci-sim-bin`）：实测确认 masked PATH 下 `which spectra` exit=1（PATH 内确无 spectra），两条命令分别 14/14 pass、2/2 pass，转绿证据成立；走的是 dist 回退级（第二段负向测试 T006 藏 dist 后同批用例立即转红，反证 T005 绿是靠 dist 回退，非其他残留 PATH 命中）

- [x] T006 masked-PATH + 藏 dist 仍响亮 fail（防 fail-open 负向验证）：`mv dist dist.bak` → masked PATH 下两条命令实测 3 条用例（SC-002×2 + FR-007/SC-002×1）全部 `AssertionError [ERR_ASSERTION]`，错误正文为新升级文案「PATH 全局安装与仓内 dist/cli/index.js 构建产物两级解析均失败……请先 npm run build 或安装全局 spectra 后重跑」，非 skip 非误判；`mv dist.bak dist` 恢复后复跑 T005 两条命令确认回到 14/14、2/2 全绿

- [ ] T007 真 CI 触发确认：push 当前分支到 origin，观察 GitHub Actions `Test` 与 `Test Plugins (mjs gate)` 两步转绿
  **验收**：CI run 页面两步 status = success

- [ ] T008 全量交付门禁：`npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 全部零失败

**Checkpoint**：三条预存失败用例在真实 CI 上转绿，且本地/CI/回归三面均无引入新失败

---

## Phase 4: 异构对抗复审（plan §7，×2 切入角）

- [ ] T009 [P] 独立子代理异构对抗 · 切入角 (a) fail-open / 假证据面：
  审查 resolver 是否可能把非真实 CLI 判为真实（wrapper `--version` 复验能否被伪造二进制绕过）、是否存在"两级皆失败却仍返回非 null"的边界
  **验收**：产出 critical/warning/info 三档结论；真实缺陷需修复并重跑 T005/T006

- [ ] T010 [P] 独立子代理异构对抗 · 切入角 (b) 绕过与漂移构造面：
  审查探针所验（`--version`）与实际所用（`batch --mode graph-only` / `decide`）是否可能不一致、环境变量注入（`F241_*`）、PATH 污染（同名非本仓 spectra 被第一级误信）、dist 陈旧构建产出误导性证据
  **验收**：产出 critical/warning/info 三档结论；真实缺陷需修复并重跑 T005/T006；commit message 标注「Codex 审查暂停，异构档位缺席」

**Checkpoint**：两个切入角均无遗留 critical，可进入提交

---

## Dependencies & 执行顺序

- Phase 1 (T001) 先行，Phase 2 (T002/T003) 依赖 T001（import helper）
- T002/T003 之间无依赖，可并行（不同文件）
- Phase 3 (T004→T005→T006→T007→T008) 严格顺序执行，T007 依赖 T004-T006 均通过
- Phase 4 (T009/T010) 可在 T006 通过后与 T007/T008 并行发起，但两者结论必须在最终 commit 前收口
- 单次 commit 提交，范围严格限定在 T001-T003 改动的 3 个文件

## FR/SC 覆盖映射

| Fix-report 条目 | 对应 Task |
|---|---|
| #189 SC-002（graph-consumption-cli.test.mjs L1895） | T003, T005, T006 |
| #190 SC-003（graph-consumption-cli.test.mjs L1945） | T003, T005, T006 |
| #210 FR-007/SC-002（graph-refresh-executor.test.mjs L199） | T002, T005, T006 |
| 回归面（其余 ~100 个不依赖 PATH 用例零变化） | T004 |
| 异构对抗审查安排（plan §7） | T009, T010 |
| 真 CI 最终确认 | T007 |
| 交付门禁 | T008 |
