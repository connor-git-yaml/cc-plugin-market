---
feature: 268-fix-ci-spectra-bin-fallback
mode: fix
status: planned
based_on: fix-report.md 方案 A
---

# 修复规划 — F268 CI 真实 spectra CLI 解析回退链

## 1. 摘要

CI 的 `Test` / `Test Plugins (mjs gate)` 两步因 3 条 F241 集成用例硬编码 PATH 上的裸 `spectra`
命令而恒红（GitHub Actions runner 无全局安装，开发机因本地装了 volta spectra 而恒绿）。方案 A：
新增测试侧共享 helper `resolveRealSpectraBin()`，在 PATH 无 `spectra` 时回退到仓内构建产物
`dist/cli/index.js`（CI 的 Build 步骤在 Test 步骤之前已产出，本地 `npm run build` 后同样存在），
用一次性可执行 wrapper 转发调用。**不改生产代码，不改 ci.yml**，仅改两个测试文件的调用点 + 新增
一个 helper 文件。

## 2. Codebase Reality Check

| 目标文件 | LOC（改前）| 涉及方法/用例数 | 已知 debt |
|---|---|---|---|
| `plugins/spec-driver/tests/graph-refresh-executor.test.mjs` | 242 | 14 个 `it()`，本次仅触碰 2 处（L201 探针、L214 spectraBin 传参） | 无；L90-158 的 6 处 `spectraBin: 'spectra'` 落在 `fakeBuild()` 注入路径内，从不真实 spawn，本次**不触碰** |
| `plugins/spec-driver/tests/graph-consumption-cli.test.mjs` | 2703 | 全文件 ~90+ 个 `it()`，本次仅触碰 Part 4 的 2 个 `it()`（L1895-1975 区间，4 处 `spawnSync('spectra', …)` + 2 处 `runCli()` 缺 `--spectra-bin`） | 无；其余 ~90 处调用点均已用 `seedFakeSpectra()` 生成的假 bin + 显式 `--spectra-bin`，不依赖 PATH，本次**不触碰** |
| `plugins/spec-driver/tests/helpers/real-spectra-bin.mjs`（新增）| 0 → 约 60 | 1 个导出函数 `resolveRealSpectraBin()` | 新文件，无 debt |

单文件 LOC 虽有 2703 行（`graph-consumption-cli.test.mjs`），但本次新增行数 < 15（仅 6 处调用点级别的最小编辑），远低于「LOC>500 且新增>50 行」的前置清理阈值，**不触发 cleanup task**。

## 3. Impact Assessment（影响面评估）

- **直接修改文件**：2 个测试文件（各自 2-6 处局部编辑）+ 1 个新增 helper 文件 = 3 个文件
- **间接受影响**：无生产代码改动，无调用方；`run-plugin-tests.mjs` 的枚举器仅按 `*.test.mjs` 后缀扫描，新 helper 文件命名为 `real-spectra-bin.mjs`（非 `.test.mjs` 结尾）不会被误当测试文件枚举，也不影响枚举逻辑本身
- **跨包影响**：无（改动全部落在 `plugins/spec-driver/tests/` 内）
- **数据迁移**：无
- **API/契约变更**：无——`--spectra-bin` 是既有已测 CLI flag（SC-019 在用），`executeRefresh({ spectraBin })` 是既有参数，本次只是把两处调用点的实参从字面量 `'spectra'` 换成 resolver 的返回值，不改变任何公开签名
- **风险等级：LOW**（影响文件 3 个 < 10，无跨包影响，无数据迁移，无 API 契约变更）——不触发强制分阶段实现

## 4. 变更清单

### 4.1 新增 `plugins/spec-driver/tests/helpers/real-spectra-bin.mjs`

（执行期由编排器纠偏为 tests/lib/——F236 起的既有测试 helper 惯例目录，tasks.md T001 有记录）

导出单一函数 `resolveRealSpectraBin({ repoRoot } = {})`，进程内 memoize（`cached` 变量，`undefined` 未解析 / 字符串已解析 / `null` 两级皆失败）：

1. **第一级 PATH 探针**：`spawnSync('spectra', ['--version'], { encoding: 'utf-8' })`；`!result.error && result.status === 0` → 返回 `'spectra'`（与两测试文件今日行为逐字节一致）
2. **第二级 dist 回退**：
   - `repoRoot` 未显式传入时，用 `fileURLToPath(import.meta.url)` 算出的 `__dirname`（`tests/helpers/`）向上 4 级得到仓根（`helpers → tests → spec-driver → plugins → repoRoot`）
   - 目标 `<repoRoot>/dist/cli/index.js`；`fs.existsSync` 检查存在
   - 存在则在 `TMP_BASE`（`process.env.TEST_TMPDIR || os.tmpdir()`，与两测试文件既有约定一致）下 `mkdtempSync` 建临时目录，写入 wrapper 脚本：
     ```sh
     #!/bin/sh
     exec "<process.execPath>" "<dist绝对路径>" "$@"
     ```
     `fs.writeFileSync(wrapperPath, script, { mode: 0o755 })`
   - **对 wrapper 复跑 `--version` 探针验真**（防 dist 存在但损坏的假可用）：探针通过才返回 wrapper 路径，探针失败则继续判两级皆失败
3. **两级皆失败**：返回 `null`；**不在此处抛错**——调用方（各 `it()` 内部）负责把 `null` 结果转成响亮 `assert.fail`，消息升级为「两级解析（PATH 全局 spectra ∨ 仓内 `dist/cli/index.js` 构建产物）均不可用……请先 `npm run build` 或安装全局 spectra 后重跑」
4. 函数在 helper 模块**顶层不执行任何 spawn**（只在被调用时才探测），避免任何间接 import 该 helper 的路径产生模块加载期副作用

### 4.2 `graph-refresh-executor.test.mjs`（仅 2 处编辑，其余 12 个用例不动）

- 顶部新增 `import { resolveRealSpectraBin } from './helpers/real-spectra-bin.mjs';`
- L199-229（`describe('FR-007 / SC-002 集成用例…')` 内第一个 `it`）：
  - 删除 L201 的裸探针 `spawnSync('spectra', ['--version'], …)` 判空逻辑，改为在 `it()` 内调用 `const bin = resolveRealSpectraBin();`，`bin === null` 时 `assert.fail(升级消息)`
  - L214 的 `spectraBin: 'spectra'` 改为 `spectraBin: bin`
- L231-240（第二个 `it`，刻意传 `path.join(sandbox, 'no-such-spectra-binary')` 的 ENOENT 负向用例）：**不改动**——它本就不依赖 PATH，是回退链之外的独立断言
- L77-180（`fakeBuild()` 注入路径的 6 处 `spectraBin: 'spectra'`）：**不改动**——`attemptLocalGraphBuild` 被 fake 顶替，`spectraBin` 字面量从不触发真实 spawn，只在「签名透传」用例（L169-179）里被断言原样传给假构建器，与 PATH 无关

### 4.3 `graph-consumption-cli.test.mjs`（仅 Part 4 两个 `it`，其余 ~90 处不动）

- 顶部新增 `import { resolveRealSpectraBin } from './helpers/real-spectra-bin.mjs';`
- **`describe('Part 4 / SC-002 …')` 内的 `it`（L1896-1942）**：
  - L1897-1900 探针替换为 `const bin = resolveRealSpectraBin();` + `bin === null` 时 `assert.fail(升级消息，标注 SC-002)`
  - L1904 `spawnSync('spectra', ['batch', '--mode', 'graph-only'], …)` 改为 `spawnSync(bin, [...])`
  - L1916-1922 的 `runCli(['decide', …])` 追加 `'--spectra-bin', bin,`（沿用文件内已有 90+ 处 `seedFakeSpectra` 用例统一的传参写法）
- **`describe('Part 4 / SC-003 …')` 内的 `it`（L1945-1976）**：同构改动——L1947 探针、L1953 `spawnSync('spectra', ['batch', …])`、L1961-1966 `runCli()` 追加 `--spectra-bin bin`
- 其余 ~90 处已用 `seedFakeSpectra()` 假 bin + 显式 `--spectra-bin` 的调用点：**不改动**（本就不依赖 PATH，是 F241 设计上"大多数用例注入 fake、仅两条不注入"的正确分工）

### 4.4 硬约束重申（不做的事）

- 不改 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs` 的默认值 `spectraBin = 'spectra'`（生产语义：宿主机确实应装 spectra，缺失时走 `refresh-failed-spectra-missing` 降级通道是产品设计）
- 不改 `.github/workflows/ci.yml`
- 不碰 F267 区：`src/utils/atomic-write.ts`、`src/hooks/hook-installer.ts`、`plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` 及其测试
- 新 helper 文件名固定为 `real-spectra-bin.mjs`（不得以 `.test.mjs` 结尾），避免被 `scripts/run-plugin-tests.mjs` 的 `readdirSync(...).filter((rel) => rel.endsWith('.test.mjs'))` 枚举为独立测试文件
- resolver 返回 `null` 时**不 skip、不 mock**，失败归属继续落在各 `it()` 内的 `assert.fail`

## 5. 回归风险评估

| 场景 | 预期行为 | 风险 |
|---|---|---|
| 开发机（PATH 有全局 spectra，今日常态）| resolver 第一级命中，直接返回 `'spectra'`；两测试文件的实际执行路径与今日逐字节一致（相同命令、相同 cwd、相同 env）| 低——第一级探针逻辑与原裸探针等价，只是挪进了 helper |
| CI（PATH 无 spectra、`dist/cli/index.js` 已由 Build 步骤产出）| resolver 走第二级，生成 wrapper 并验真通过，3 条用例走 `node dist/cli/index.js` 真实执行 → 转绿 | 中——**新代码路径**，需 masked-PATH 本地实测覆盖（见下）；已被 ci.yml 现有「Build Knowledge Graph」步骤同构验证过 `node dist/cli/index.js batch --mode graph-only` 可行 |
| 两级皆失败（本地未 `npm run build`、又无全局 spectra）| resolver 返回 `null`，用例响亮 `assert.fail`（消息升级但仍是 fail，非 skip）| 低——刻意保留的防 fail-open 设计，需负向用例验证不会被静默放过 |
| dist 存在但损坏/陈旧（如 build 中途失败留半成品）| wrapper 生成后 `--version` 复验会失败，resolver 判两级皆失败而非误报可用 | 低——已在 helper 设计中显式覆盖，防止「dist 存在但不可用」误判为真可用 |
| 其余 ~100 个不依赖 PATH 的用例（`fakeBuild`/`seedFakeSpectra` 路径）| 零改动，零行为变化 | 无 |

## 6. 验证方案

1. **本地正常 PATH（回归面）**：`npm run test:plugins` 全绿，重点确认 Part 4 两条 + FR-007 SC-002 集成用例仍走 `'spectra'` 第一级（可通过临时打印/断言 `bin === 'spectra'` 自查后移除，或保留为注释说明，不落断言噪声到用例本体）
2. **本地模拟 CI（masked PATH，转绿验证）**：
   ```bash
   npm run build   # 产出 dist/cli/index.js
   mkdir -p /tmp/f268-ci-sim-bin && ln -sf "$(which node)" /tmp/f268-ci-sim-bin/node
   PATH=/tmp/f268-ci-sim-bin:/usr/bin:/bin node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs
   PATH=/tmp/f268-ci-sim-bin:/usr/bin:/bin node --test --test-name-pattern "Part 4" plugins/spec-driver/tests/graph-consumption-cli.test.mjs
   ```
   预期：此前的 1 fail / 2 fail 转为全绿，且可通过临时日志确认走的是 dist 回退级（wrapper 路径含 `f268-spectra-wrapper-` 前缀，或 `dist/cli/index.js` 出现在 spawn 参数里）
3. **本地负向（防 fail-open）**：在步骤 2 的 masked PATH 基础上额外临时移走/改名 `dist/`（如 `mv dist dist.bak`），重跑同样两条 `node --test` 命令 → 3 条用例应**仍然响亮 fail**，且失败消息为升级后的新文案（证明未静默 skip 或误判为可用），跑完 `mv dist.bak dist` 复原
4. **真 CI**：push 当前 worktree 分支到 origin 触发 `ci.yml`（push 事件全分支触发，无需用户确认），观察 `Test` 与 `Test Plugins (mjs gate)` 两步转绿
5. **全量交付门禁**：`npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` 零失败

## 7. 异构对抗审查安排（独立验证项）

这三条用例是 F241 的 SC 证据锚（门禁相邻）。按 CLAUDE.local.md 暂停期档位表，本次改动须过**异构内部对抗**（独立子代理，不给实现思路，只给"证伪这段代码"任务），至少 2 个不同切入角：

- **切入角 (a) fail-open / 假证据面**：回退链是否可能把非真实 CLI 判为真实？wrapper 的 `--version` 复验是否可被绕过（例如伪造一个只响应 `--version` 但其余命令行为异常的假二进制）？resolver 是否存在"两级皆失败却仍返回非 null"的边界？
- **切入角 (b) 绕过与漂移构造面**：探针所验（`--version` 成功）与实际所用（`batch --mode graph-only` / `decide`）是否可能不一致？是否存在环境变量注入（如伪造 `F241_*` 系列变量）影响 resolver 判定？PATH 污染（PATH 上存在同名但非本仓的 `spectra`）是否会被第一级探针误信？dist 陈旧（构建于旧 commit）时是否会产出误导性"证据"？

审查结论按 critical/warning/info 三档处置；commit message 标注「Codex 审查暂停，异构档位缺席」。发现的真实缺陷需在提交前修复并重跑步骤 2/3 验证。

## 8. 提交与交付

- 单次 commit，改动范围严格限定在 §4 清单内（3 个文件）
- commit message 需体现：根因（用例硬编码 PATH 全局 spectra，CI runner 结构性缺失）、修法（测试侧回退链，非生产代码/CI 改动）、验证证据（masked-PATH 本地转绿 + 负向仍响亮 fail）、异构审查档位标注
- 提交前完整跑 §6 步骤 1-3 + §7 异构对抗；push 后观察步骤 4 的真 CI 结果作为最终确认
