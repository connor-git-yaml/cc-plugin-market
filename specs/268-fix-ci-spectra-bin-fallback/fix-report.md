# 问题修复报告 — F268 CI 真实 spectra CLI 解析回退链

## 问题描述

master CI 连红的 3 条预存失败用例（非新回归，自用例落地（F241 批 1，f22dd4c1）起 CI 即红，F265 卡 CI 首查时定位）。

失败签名（node:test mjs 面，`Test` 与 `Test Plugins (mjs gate)` 两步同红）：

- #189 「Part 4 / SC-002 真实 stale 图上的真实刷新」（[graph-consumption-cli.test.mjs:1895](../../plugins/spec-driver/tests/graph-consumption-cli.test.mjs)）
- #190 「Part 4 / SC-003 additive-only 非 dry-run 下图文件零变化」（[graph-consumption-cli.test.mjs:1945](../../plugins/spec-driver/tests/graph-consumption-cli.test.mjs)）
- #210 「FR-007 / SC-002 集成用例（不注入 fake，走真实 attemptLocalGraphBuild）」（[graph-refresh-executor.test.mjs:199](../../plugins/spec-driver/tests/graph-refresh-executor.test.mjs)）

错误正文：`本机 spectra CLI 不可用，SC-002 的真实刷新证据无法取得——不得以 mock 冒充（请修复安装后重跑）`（ERR_ASSERTION）。

## 复现证据（本机模拟 CI：PATH 剥离 spectra）

构造只含 node 的 PATH（`ln -s $(which node) $SCRATCH/ci-sim-bin/node; PATH=$SCRATCH/ci-sim-bin:/usr/bin:/bin`）：

- `node --test plugins/spec-driver/tests/graph-refresh-executor.test.mjs` → **13 pass / 1 fail**，失败者恰为 #210，错误正文逐字一致
- `node --test --test-name-pattern "Part 4" plugins/spec-driver/tests/graph-consumption-cli.test.mjs` → **0 pass / 2 fail**，恰为 #189/#190
- 正常 PATH（volta spectra v4.4.0 在位）下同命令 14/14 全绿 → 「开发机恒绿 / CI 恒红」的 F232 链 D/E/F 同型结构确认

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 表面症状为何发生？ | 3 条用例的前置探针 `spawnSync('spectra', ['--version'])` 在 GitHub Actions runner 上返回 ENOENT（`probe.error` 非空），走进 `assert.fail('本机 spectra CLI 不可用…')` |
| Why 2 | 该触发条件为何存在？ | 用例把「真实 spectra CLI」唯一解析为 PATH 上的裸命令名 `'spectra'`（3 处探针 + 2 处直接 `spectra batch --mode graph-only` + canonical 默认 `spectraBin='spectra'`）；CI runner 只跑 `npm ci`，仓库自身的 bin（`package.json bin.spectra`）不会 self-link 进 PATH，workflow 也没有任何 `npm link` 步骤 |
| Why 3 | 上游逻辑为何有缺陷？ | F241 的测试设计意图是「至少两条不注入 fake 的集成用例，否则『映射表全绿、真实调用签名早就对不上』这类漂移测不出来」+「不得以 mock 冒充」——实现时把「证据必须来自真实 CLI」错误收窄成「二进制必须来自宿主机全局安装」。仓内构建产物 `dist/cli/index.js` 同样是真实 CLI（CI 自己的「Build Knowledge Graph」步骤就用 `node dist/cli/index.js batch --mode graph-only` 建仓库图），但从未被纳入解析链 |
| Why 4 | 该假设为何不成立？ | 「开发机装了全局 spectra」是宿主机属性，不是仓库保证的不变量——F232 链 D/E/F 的同型失效形状（依赖宿主机属性者在开发机结构性不可见）。CI runner 上该属性结构性缺失 |
| Why 5 | 为何未被现有机制捕获？ | 双盲区：(a) 本地交付验证协议（`npx vitest run` + `npm run build` + `repo:check`）不含「PATH 无 spectra」环境模拟，开发机恒绿；(b) 用例落地时（F241 批 1）CI 红是**可见**的，但 master 走本地验证 + 直推交付，CI 结论非阻塞、无消费者——红灯累积为背景噪声，直到 F265 把治理链接进 CI 做首查才被翻出 |

**Root Cause**: 集成用例把「真实 spectra CLI」唯一等同为「PATH 上的全局 `spectra` 命令」——这是宿主机属性而非仓库不变量；CI runner 结构性缺失该属性，而用例失败路径按设计是响亮 `assert.fail`（非 skip），故 CI 自用例落地起恒红。

**Root Cause Chain**: CI 两步红（#189/#190/#210 ERR_ASSERTION）→ 探针 `spawnSync('spectra')` ENOENT → 解析链只有 PATH 一级 → 「真实 CLI」被收窄为「全局安装」→ 宿主机属性 ≠ 仓库不变量（F232 同型）→ 本地验证无 PATH 模拟 + CI 红无阻塞消费者。

## 影响范围扫描

全仓扫描 `spawnSync('spectra'`（plugins/ scripts/ tests/，排除 node_modules）：命中**仅** 5 处，全部落在两个测试文件内，无生产代码 / 其他测试同型扩散。

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| plugins/spec-driver/tests/graph-refresh-executor.test.mjs | L201 | 探针 `spawnSync('spectra', ['--version'])` | 改用共享 resolver 解析结果 |
| plugins/spec-driver/tests/graph-refresh-executor.test.mjs | L214 | `executeRefresh({ spectraBin: 'spectra' })` | 传 resolver 解析出的 bin |
| plugins/spec-driver/tests/graph-consumption-cli.test.mjs | L1897 / L1947 | 探针 ×2 | 改用共享 resolver 解析结果 |
| plugins/spec-driver/tests/graph-consumption-cli.test.mjs | L1904 / L1953 | 直接 `spawnSync('spectra', ['batch', '--mode', 'graph-only'])` ×2 | 换 resolver 解析出的 bin |
| plugins/spec-driver/tests/graph-consumption-cli.test.mjs | L1916 / L1961 | `runCli(['decide', …])` 未传 `--spectra-bin`（CLI 内部默认 `'spectra'` 走 PATH） | 追加 `--spectra-bin <resolved>`（该 flag 是既有已测表面，SC-019 在用） |

### 类似模式（已评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| plugins/spec-driver/tests/graph-refresh-executor.test.mjs | L231-240 | `spectraBin: path.join(sandbox, 'no-such-spectra-binary')`（真实 ENOENT 用例） | [安全] 刻意传不存在路径，不依赖 PATH，CI 上本就绿（复现时 13 pass 含此条） |
| plugins/spec-driver/tests/graph-consumption-cli.test.mjs | seedFakeSpectra 全部调用点 | 假 spectra（绝对路径 + `--spectra-bin` 显式传入） | [安全] 不依赖 PATH |
| plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs | L431/L515/L646/L658 | 生产侧默认值 `spectraBin = 'spectra'` | [安全] 生产语义（宿主机确实应装 spectra，缺失时走 refresh-failed-spectra-missing 降级通道是产品设计）；**本次不改生产代码** |
| .github/workflows/ci.yml | Build Knowledge Graph 步骤 | `node dist/cli/index.js batch --mode graph-only` | [安全] CI 已用 dist 路径直调真实 CLI 的既有先例，恰是回退链第二级的可行性证明 |

### 同步更新清单

- 调用方：无（纯测试面改动，生产代码零触碰）
- 测试：新增共享 helper `plugins/spec-driver/tests/helpers/real-spectra-bin.mjs`（非 `.test.mjs` 后缀，run-plugin-tests.mjs 的枚举器不会把它当测试文件）；helper 自身需一条「两级都缺失时返回 null（用例照旧响亮 fail）」的行为约定
- 文档：两个测试文件的文件头注释同步（解析链说明）；无入库 docs 变更
- **避让区（硬约束）**：不触碰 F267 刚修的 `src/utils/atomic-write.ts` / `src/hooks/hook-installer.ts` / `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs` 及其测试

## 修复策略

### 方案 A（推荐，任务方向 1）：测试侧真实 CLI 解析回退链

新增共享 helper `resolveRealSpectraBin()`（memoize，每测试文件进程解析一次）：

1. **第一级**：探针 `spawnSync('spectra', ['--version'])` —— PATH 上有全局 spectra（开发机常态）→ 返回 `'spectra'`，开发机行为与今日逐字节一致
2. **第二级**：`<repoRoot>/dist/cli/index.js` 存在（CI 的 Build 步骤在 Test 之前必产出；本地 `npm run build` 后同样在）→ 生成一次性可执行 wrapper 脚本（`#!/bin/sh` + `exec "<process.execPath>" "<dist绝对路径>" "$@"`，mode 0o755，落 TMP_BASE mkdtemp；先例：seedFakeSpectra 同构 wrapper 已在库内多年）→ **对 wrapper 复跑 `--version` 探针验真**（防 dist 存在但损坏的假可用）→ 返回 wrapper 路径
3. **两级皆失败**：返回 null，用例内保持原 `assert.fail` 响亮语义（消息升级为说明两级都试过 + 修复指引），**绝不 skip、绝不 mock**

三条用例的 5 个裸 `'spectra'` 调用点 + 2 个 runCli 调用统一改用解析结果。

- **为何不是 mock**：wrapper 只做 exec 转发，真正执行的是 `tsc` 构建出的本仓 CLI——与 CI「Build Knowledge Graph」步骤消费的是同一产物（本机实测 `node dist/cli/index.js --version` → `spectra v4.5.0 (76e2554)`）。「真实刷新证据」的证据源从「宿主机全局安装的真实 CLI」扩展为「宿主机全局安装 ∨ 仓内构建的真实 CLI」，SC 证据强度不降反升（CI 上测的是当前源码而非陈旧发布版）
- **PATH 优先的理由**：开发机行为零变化（继续测全局安装版，今日即如此）；回退级只在 PATH 缺失时激活
- **模块解析可行性**：`node dist/cli/index.js` 的依赖解析相对 dist 文件位置（仓根 node_modules），与 cwd 无关——CI 的 Build Knowledge Graph 步骤（cwd=checkout 根）与测试 sandbox（cwd=临时 fixture 仓）同一机制，已被 CI 既有步骤实证
- **响亮性保持**：resolver 返回 null 时不在模块加载期抛错（那会连坐同文件另外 11-13 条绿用例），失败归属保持在各 it() 内的 assert.fail

### 方案 B（备选，不推荐）：CI workflow 在 Test 前 `npm link`

改 ci.yml 全局装本仓 CLI。缺点：把修复放在环境层而非解析层，「用例依赖宿主机属性」的真问题原样保留——任何无全局 spectra 的新环境（新贡献者 clone 后 npm ci + build）依旧红；npm link 改 runner 全局态、与 node 版本管理器交互有额外失败面；且 ci.yml 是 F265 刚定型的治理链落点，无必要扰动。

### 方案 C（最不推荐）：CI 显式 skip

掏空 F241 SC-002/003 证据锚，与用例自身「不得以 mock 冒充（skip 同理）」的响亮设计正面冲突。仅列出以完备决策面。

## Spec 影响

- 需要更新的 spec：无需更新。F241 spec 的 SC-002/003 表述是「真实 spectra + 真实刷新证据」，方案 A 不改变证据语义（证据仍来自真实 CLI 真实执行），只扩展二进制解析来源。
- **对抗档位标注**：这三条用例是 F241 的 SC 证据锚（门禁相邻——它们守的是「刷新链证据不得 mock」判据）。判据语义从「PATH spectra」扩展为「PATH spectra ∨ 仓内 dist 真实 CLI」，按 CLAUDE.local.md 暂停期档位表，须过**异构内部对抗**（独立子代理 ×≥2 切入角，不给实现思路），commit message 标注「Codex 审查暂停，异构档位缺席」。预定切入角：(a) fail-open / 假证据面——回退链是否可能把非真实 CLI 判为真实、wrapper 是否引入 mock 通道；(b) 绕过与漂移构造面——探针所验与实际所用不一致、环境变量注入（F241_*）、PATH 污染、dist 陈旧等构造

## 对抗审查裁决与残余风险登记（实施后补记，2026-08-30）

审查档位：**Codex 审查暂停，异构档位缺席**；暂停期替代 = 内部异构对抗（4a spec-review 0C/0W/1I + 4b quality-review 0C/1W/2I + 异构对抗 ×2 切入角【fail-open 假证据面 opus / 绕过漂移构造面 fable，均不给实现思路】+ delta 轮 ×1【opus】），共五路。

### 已修（三批实施）

| 发现 | 来源 | 修法 |
|------|------|------|
| 探针 spawnSync 无 timeout → 挂起二进制无界死锁整个测试进程（canonical 已弃用的反模式回流） | delta-C1 / 4b-W | `timeout: 30_000` |
| timeout 默认 SIGTERM 可被忽略——实测穿透到 60.4s（上界=子进程自灭，实为无界），SIGKILL 下 10.0s 闭合 | delta-C1 实证 | `killSignal: 'SIGKILL'` |
| null 也被 memoize → 满载瞬时 EAGAIN 毒化同文件全部 3 条锚（改动前各 it() 独立探测） | adv2-W2 | 只缓存成功；失败不缓存 |
| memoize 无视 repoRoot 入参（首调用赢者通吃） | adv1-I3 / adv2-W1 | Map 按 repoRoot 键控 |
| sh wrapper 双引号裸插值 → 含 `$( )` 路径命令注入实证 | adv1-W1 / adv2-I4 | POSIX 单引号转义 shQuote + 专属注入测试钉死 |
| wrapper 临时目录泄漏 | 三方同报 | exit 钩子 best-effort 清理 |
| 注释 over-claim：「验真」「测的是当前源码」「逐字节不变」——会被后人当安全依据引用 | adv1-C1/C2 实质 + delta-W2 | 全部改为诚实口径（探针只判可起性、一级命中时锚定全局版、timeout 引入分歧窗口如实写明） |
| 二级机制在装了全局 spectra 的机器上零执行覆盖、新代码无专属测试 | delta-W3 | 新增 real-spectra-bin.test.mjs（5 条子进程隔离用例：二级成功/缺失/复验拦截/转义安全/缓存语义，masked PATH 与宿主全局安装解耦） |
| 10s 阈值同型探针在本仓已被满载实证穿透（cli-e2e 预存 flaky 账），穿透后果=静默从一级切二级 | delta-W1 | 阈值抬 30s 与实测成本（~640ms）拉开量级 |

### 诚实登记：不修的残余风险（含理由）

1. **level-1 探针可被伪二进制欺骗**（adv1-C1：PATH 上放应答 `--version` 的假 spectra，2/3 锚可被伪造成绿）——**与改动前持平**（原判据同一条弱探针），非本次引入或恶化；威胁模型上这是测试解析链而非安全门禁，能污染 PATH 者同样能直接改测试文件。SC-002 的实际抗伪力来自 F249 provenance fingerprint（adv1-W3 实证第二版伪造被 `unknown-provenance` 拦下），FR-007/SC-003 无等价交叉校验为 F241 原设计既有属性。
2. **锚不钉 CLI 版本**（adv1-C2：一级命中锚定全局发布版 v4.4.0 而非当前源码；两级绿灯无版本分辨力）——改动前同样锚定全局版，属 F241 既有属性；版本钉死（比对 --version commit 与 HEAD）会让所有全局版 ≠ HEAD 的开发机瞬间恒红，是引入回归的过度修复。已在模块头如实写明「不做版本新鲜度与真伪鉴别」。
3. **dist 无新鲜度门**（adv1-C3：本地 stale dist / CI Build 失败后 `if: always()` 的 mjs gate 可在坏 dist 上出绿）——CI 主路径 Build 紧邻 Test 前跑 `tsc`，dist 必新鲜；Build 失败角落里 job 整体已红，mjs gate 绿灯只是局部噪声不构成假交付信号。接 F251 新鲜度 sidecar 属判据语义扩张，列 **follow-up 候选**（连同 `tsconfig noEmitOnError` 缺失一并评估），不塞本卡。
4. **杂项**（今日不可达/理论面）：缓存 key 未做路径归一（调用方只传默认值）；成功结果进程内不复验（dist 进程内不会被重建）；SIGKILL/SIGINT 杀进程时 exit 钩子不触发（已声明 best-effort）；noexec 挂载的 TMPDIR 会假阴成「请先 npm run build」的错误归因；Windows 无 sh wrapper 支持（本仓 CI ubuntu / 开发机 darwin，无 windows runner）。

### 对抗覆盖盲区（如实转录，「没构造出来 ≠ 安全」）

SC-002 伪造仅投两轮未穷尽（伪造五管线 fingerprint 无密码学屏障）；真实 GitHub runner 端到端仅以剥空 PATH 模拟（真 CI 由 push 分支触发补证）；未测并发 mkdtemp 冲突（读码判安全）；未测非 UTF-8 路径字节。

## 验证计划（本地 + CI 双跑，任务硬约束）

1. 本地正常 PATH：`npm run test:plugins` 全绿（回归面）
2. 本地模拟 CI：masked PATH 复跑两文件 → 3 条用例由红转绿，且走的是 dist 回退级（可由 wrapper 路径日志/断言佐证）
3. 本地负向：masked PATH + 临时藏起 dist → 3 条用例仍响亮 fail（新消息），证明未引入 skip/fail-open
4. 真 CI：push 当前 worktree 分支到 origin 触发 ci.yml（push 事件全分支触发），观察 `Test` 与 `Test Plugins (mjs gate)` 两步转绿——feature 分支 push 无需用户确认（分支政策）
5. 全量交付门禁：`npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check`
