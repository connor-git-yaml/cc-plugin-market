# F235 验证报告 — CI vitest worker RPC 超时修复

**验证对象**：`vitest.config.ts`（+35 行，纯新增注释 + `test.maxWorkers` 一行）
**验证时间**：2026-07-31
**验证方式**：逐条独立实跑核验 fix-report.md 的技术声称，不采信未实跑结论

---

## Root Cause 验证结论

fix-report.md 的 5-Why 链路：CI（4 vCPU）在 487 测试文件规模下按 vitest 默认公式
（`Math.max(availableParallelism()-1, 1)`）过订阅 worker 数，worker↔主进程的
`onTaskUpdate` birpc 调用命中硬编码 60s 超时 → unhandled error → 进程 exit 1（尽管全部测试通过）。

**验证结论：Root Cause 成立**。已通过阅读 vitest 3.2.4 / tinypool 源码逐层核实调用链（见下方
声称 1-3），并用 `gh run view` 拉取到本次修复所指向的**真实 CI 失败 run**（30599823004，commit
`9a22ce9`）原始日志作为独立证据：

```
2026-07-31T02:53:36.3194253Z Error: [vitest-worker]: Timeout calling "onTaskUpdate"
2026-07-31T02:53:36.3202993Z Error: [vitest-worker]: Timeout calling "onTaskUpdate"
2026-07-31T02:53:36.3268883Z  Test Files  478 passed | 9 skipped (487)
2026-07-31T02:53:36.3300525Z       Tests  5755 passed | 36 skipped | 21 todo (5812)
2026-07-31T02:53:36.3318223Z    Duration  410.98s (transform 19.78s, setup 0ms, collect 136.75s, tests 944.31s, environment 190ms, prepare 55.17s)
```

与 fix-report.md 描述完全吻合：测试全过、恰好 2 次 `onTaskUpdate` 超时、CI 侧 vitest 步骤耗时
410.98s（fix-report 提及的"总时长 418s"含 workflow 其余开销，量级一致）。修复方案（显式设
`maxWorkers`）对症根因（过订阅），非掩盖症状。

---

## 逐条声称核验

### 声称 1：RPC 超时不可配（birpc DEFAULT_TIMEOUT 硬编码 6e4，worker 侧不传 timeout）

**实跑命令**：
```bash
grep -n "DEFAULT_TIMEOUT" node_modules/vitest/dist/chunks/index.B521nVV-.js
cat node_modules/vitest/dist/chunks/index.B521nVV-.js   # 读第 1-42 行
grep -n "onTaskUpdate\|onTimeoutError" node_modules/vitest/dist/chunks/index.B521nVV-.js
grep -n "createForksRpcOptions(" node_modules/vitest/dist/chunks/utils.CAioKnHs.js
```

**真实输出摘要**：
- `index.B521nVV-.js:3` → `const DEFAULT_TIMEOUT = 6e4;`；`:21` → `timeout = DEFAULT_TIMEOUT`（解构默认值）
- `:59` → `options.onTimeoutError?.(method, args)`，与 CI 堆栈 `index.*.js:59:62` 行号精确对应
- `utils.CAioKnHs.js:25-42` `createForksRpcOptions(nodeV8)` 返回对象仅含 `serialize/deserialize/post/on`，
  **不含 `timeout` 字段**，`workers/forks.js:21` 与 `workers/vmForks.js:27` 直接透传该返回值给
  `createBirpc`，未做任何 timeout 覆盖

**结论：成立**。RPC 超时确系硬编码 60s 且 worker 侧无配置入口，CI 堆栈行号精确匹配。

### 声称 2：`maxWorkers` 是根级专属（NonProjectOptions），不受 F233 影响

**实跑命令**：
```bash
grep -n "NonProjectOptions" node_modules/vitest/dist/chunks/reporters.d.BFLkQcL6.d.ts
grep -n "threadsCount\|maxThreads = poolOptions" node_modules/vitest/dist/chunks/coverage.DL5VHqXY.js
```

**真实输出摘要**：
```ts
type NonProjectOptions = "shard" | "watch" | "run" | ... | "maxWorkers" | "minWorkers" |
  "fileParallelism" | "workspace" | ...;
type ProjectConfig = Omit<InlineConfig, NonProjectOptions | "sequencer" | "deps" | "poolOptions"> & {...};
```
且 forks/threads pool 实际取值逻辑（`coverage.DL5VHqXY.js:2610-2613` 等 4 处同构代码）：
```js
const threadsCount = vitest.config.watch ? Math.max(Math.floor(numCpus/2),1) : Math.max(numCpus-1,1);
const maxThreads = poolOptions.maxForks ?? vitest.config.maxWorkers ?? threadsCount;
```
`vitest.config.maxWorkers` 取的是**根级已解析配置**，与 project 级配置无关。

**结论：成立**。`maxWorkers`/`minWorkers` 确实被类型系统排除在 `ProjectConfig` 之外，只能写在根级
`test.*`，本次修复不受 F233「projects 不继承根级配置」问题影响。同时验证副产品：`threadsCount`
默认公式确为 `max(numCpus-1,1)`，与 fix-report 声称的"4vCPU→3 / 18核→17（修复前）"完全一致。

### 声称 3：worker 数推导正确（本机 18 核→9，模拟 CI 4 核→2）

**实跑命令**：
```bash
node -e "
const os = require('node:os');
const avail = os.availableParallelism?.() ?? os.cpus().length;
function calc(n){ return Math.max(1, Math.min(12, Math.floor(n/2))); }
console.log('本机 avail:', avail, '推导 maxWorkers:', calc(avail));
console.log('模拟 CI 4 vCPU:', calc(4));
"
```

**真实输出**：
```
本机 avail: 18 推导 maxWorkers: 9
模拟 CI 4 vCPU: 2
```

**结论：成立**。与 fix-report 声称的"CI 4vCPU 得 2（原 3）、本机 18 核得 9（原 17）"完全一致。

### 声称 4：未采用掩盖手段

**实跑命令**：
```bash
grep -rn "fileParallelism" vitest.config.ts package.json .github/workflows/*.yml
grep -rn "\-\-silent\b" package.json .github/workflows/*.yml
grep -rn "dangerouslyIgnoreUnhandledErrors" vitest.config.ts package.json .github/workflows/*.yml
grep -rn "continue-on-error" .github/workflows/*.yml
```

**真实输出**：以上四个搜索**均无匹配**（空输出）。另确认 `npx vitest run` 全量本地跑（见声称 5）
Test Files/Tests 计数均为 `483 passed | 4 skipped (487)` / `5773 passed | 18 skipped | 21 todo (5812)`，
与真实 CI 失败 run（30599823004）的 `478 passed | 9 skipped (487)` / `5755 passed | 36 skipped | 21 todo (5812)`
**总数 (487) / (5812) 一致**（passed/skipped 分布差异是本地未构造与 CI 完全相同环境导致的正常差异，
未删减/跳过任何测试文件）。

**结论：成立**。未发现任何掩盖手段，测试规模未被削减。

### 声称 5：本机全量门禁

**实跑命令与真实输出**：

| 命令 | exit code | 关键输出摘要 |
|---|---|---|
| `npx vitest run`（跑 2 次复核） | **0** | `Test Files 483 passed \| 4 skipped (487)` / `Tests 5773 passed \| 18 skipped \| 21 todo (5812)`；`grep -c onTaskUpdate` = **0**；无 `Errors` 段 |
| `npm run build` | **0** | `tsc` 无报错；`postbuild:stamp` 正常盖章 |
| `npm run test:plugins` | **0** | `tests 1065 / pass 1065 / fail 0` |
| `npm run repo:check` | **0** | 全部规则族 `pass`（release-contract / graph-quality / spec-drift 等全绿） |

**结论：成立**。四项门禁全部本地实跑，零失败。

### 声称 6：耗时影响

implement 声称本机 A/B 差异在噪声内（约 +2.7%），CI 预计 418s → 约 380s。

**实跑方式**：临时把 `maxWorkers: maxTestWorkers` 改为 `maxWorkers: undefined`（等效修复前"无限制，
落回 vitest 内置推导"行为），跑一次全量测试后**用 `diff` 逐字节核对已还原**回修复后版本。

**真实输出（本机 18 核）**：

| 配置 | worker 数 | Duration（vitest 自报） | wall real |
|---|---|---|---|
| A（修复后，maxWorkers=9） | 9 | 49.00s / 50.16s（两次） | 49.33s |
| B（修复前等效，undefined→内置推导=17） | 17 | 48.40s | ~48.8s |

**结论：本机部分成立，CI 部分无法在本次会话独立验证**。
- 本机层面：A/B wall-clock 差异确实在个位数百分比噪声内（≈+1~3%），与"约 +2.7%"量级吻合；
  两组均 0 次 `onTaskUpdate`（本机 18 核无论 9 或 17 worker 都不会过订阅到触发超时的程度，
  这也解释了为何本地"从不出现"该问题——与 fix-report Why 5 一致）。
- **CI 侧"418s→约380s 反而变快"是预测，本次会话未能独立验证**：受限于"不得进行任何 git 写操作"
  （无法 push 该分支触发真实 GitHub Actions run），也未构造 4-vCPU 等效隔离环境重跑（Docker 可用
  但 host 为 macOS arm64，容器内需要针对 linux 平台重新 `npm ci` 才能保证原生绑定兼容，超出本次
  验证时间预算）。唯一可获得的真实 CI 数据是修复前基线：**410.98s**（30599823004，2 次 onTaskUpdate）。
  "变快"的预测**方向上有合理性**（worker 数从 3→2 减少了过订阅程度，理论上应减少 RPC 排队等待），
  但**数值 380s 未经真实 CI 验证，不应作为已核实事实呈现**，建议后续该分支合入并跑一次真实 CI 后
  补充实测数据。

### 声称 7：边界

**实跑命令与输出**：
```bash
git status --porcelain src/                     # 空输出，exit 0
git diff package.json                             # 仅含 F231 的 "judge:doctor" 一行新增，与 F235 无关
git log --oneline -5                               # F230/F231/F232/F233/F234 五个 commit 均在，无回退
git diff --stat vitest.config.ts                  # 35 insertions(+)，无删除行，纯新增
```

**结论：成立**。`src/` 干净、F231 遗留文件（`plugins/spec-driver/scripts/judge-*`、
`plugins/spec-driver/tests/lib/`、`package.json` 的 `judge:doctor` 行）原样保留，
F232/F233/F234 提交历史未受影响。

---

## 补充核验：安全余量风险陈述评估

implement 报告"安全余量约 1.2×，根子是 49 个测试文件用 `spawnSync`/`execSync` 阻塞 worker 事件循环，
建议下一档升级用 `vitest --shard`"。**该量化数据未写入 `fix-report.md`**（仅见于任务上下文转述），
故本次按以下方式独立核验其可信度，而非全盘采信：

**实跑命令**：
```bash
grep -rlE "spawnSync|execSync" tests/ --include="*.test.ts" | wc -l                         # → 19
grep -rlE "from 'node:child_process'|require\('node:child_process'\)" tests/ --include="*.test.ts" | wc -l  # → 43
# 并集（含异步 spawn/exec 与 runCLI 辅助函数间接封装）
{ grep -rlE "spawnSync|execSync|node:child_process" tests/ --include="*.test.ts"; \
  grep -rlE "\bspawn\(|\bexec\(" tests/ --include="*.test.ts"; \
  grep -rl "runCLI\b" tests/ --include="*.test.ts"; } | sort -u | wc -l                     # → 56
```

**结论：量级基本成立，"49"这个具体数字未被精确复现，但不构成夸大**。直接用 Sync API 的文件为
19 个，导入 `child_process` 模块的文件为 43 个，若把异步 `spawn`/`exec` 调用与 `runCLI` 封装辅助函数
一并计入（含少量 `regex.exec(` 误匹配噪声），并集在 56 附近——"49"落在这个 43~56 的合理区间内，
**不是无依据的夸大表述**。

**关于"1.2× 余量"数值本身**：本次会话**无法独立复现或证伪**该具体倍数——需要在真实 4 vCPU 环境
（真实 CI runner 或精确的 cgroup/cpuset 限核容器）反复采样才能给出统计意义上的余量比值，本机
18 核环境天然不会触发该边界（如声称 6 所示，A/B 两种 worker 数在本机均 0 次超时）。**该风险陈述
方向合理**（过订阅程度与 RPC 排队延迟正相关是声称 1-3 已验证的机制性事实），**但具体倍数属未经
独立验证的预测性数据**，建议后续以真实 CI 多次运行采样验证，而非当前作为确凿结论呈现。
`--shard` 分片是与"降 worker 数"正交的下一档手段，逻辑自洽（拆分 job 减少单进程内文件数，
与本次"降并发"互补而非替代），本次验证不持异议，但同样未经实测，留作后续 Feature 候选合理。

---

## Layer 2：原生工具链验证结果汇总

| 语言/工具链 | 构建 | Lint | 测试 |
|---|---|---|---|
| TypeScript / Node（npm，本项目主链） | ✅ `npm run build` exit 0 | N/A（未检测到独立 lint 命令；`repo:check` 已覆盖静态规则） | ✅ `npx vitest run` exit 0（483 passed/4 skipped，487 files）；✅ `npm run test:plugins` exit 0（1065/1065 pass） |
| 项目自定义门禁 | — | — | ✅ `npm run repo:check` exit 0（全部规则族 pass） |

---

## 总体结果

**✅ 可交付**

- Root Cause 成立，5-Why 链路已用源码阅读 + 真实 CI 历史日志双重核实
- 声称 1-5、7 全部**成立**（独立实跑核验，非照抄 implement 结论）
- 声称 6（耗时影响）**本机部分成立，CI 数值预测部分未经独立验证**——不构成阻断项（本地/CI 均未
  发现修复方向性错误，仅"380s"具体数值缺乏实测支撑，建议后续真实 CI 跑一次补充数据），已在
  报告中如实标注，不作为已核实事实呈现
- 补充核验的"1.2× 余量"风险陈述：方向合理、量级基本自洽，但具体倍数未经独立验证，已如实标注为
  待观察项而非确凿结论
- 无掩盖手段、无测试规模削减、边界清晰（`src/` 干净、F230-F234 历史完整、F231 遗留文件原样保留）
- 本次验证过程中的临时 A/B 配置改动已在核验后逐字节核对还原（`diff` 确认 IDENTICAL），
  最终工作区状态与验证开始前一致（仅保留 F235 预期的 `vitest.config.ts` +35 行改动）

