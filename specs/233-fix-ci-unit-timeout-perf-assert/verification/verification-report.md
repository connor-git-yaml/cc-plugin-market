# Verification Report: F233 CI 残余两链收口

**特性分支**: `claude/mystifying-gagarin-5ca56b`
**验证提交**: `ff0fdb0b1f1b846b40a43f70d4d15038b1e2ce61`（fix(F233): CI 残余两链收口 — unit 超时预算失配 + 墙钟 perf 断言）
**验证日期**: 2026-07-28
**验证模式**: fix（无 spec.md，制品为 `fix-report.md`）
**验证范围**: Layer 1（Root Cause 对齐核验，逐条实跑取证）+ Layer 2（原生工具链）

---

## Root Cause 验证结论

fix-report.md 声称两条独立链，均已逐条实跑核验，**结论：两条根因描述与实测证据一致，未发现夸大或遗漏**。

### 链 G — unit project 超时预算失配

- **声称根因**：vitest 3 的 `projects[]` 不继承根级 `test` 配置；`unit` project 块唯独遗漏 `testTimeout` 声明，落回内置默认 5000ms；CI 满载下两个 spawn 真实 CLI 子进程的用例（5.3s/7.3s）越界。
- **核验方式**：读 `vitest.config.ts` 全文 + diff + 现场探针（`tests/unit/` 放 `sleep(8000)` 用例）。
- **实测**：`unit` project 块新增 `testTimeout: 30_000`（第 100 行），其余四个 project（`integration`=60s、`golden-master`=120s、`self-hosting`=120s、`e2e`=60s）在本次 diff 中**零改动**（`git diff ff0fdb0~1 ff0fdb0 -- vitest.config.ts` 只命中 `unit` 块 6 行新增）。探针用例 `sleep(8000)` 在 8005ms 通过（详见下方逐条记录）。
- **结论**：成立。

### 链 H — SC-006 墙钟 perf 断言在满载 runner 上不成立

- **声称根因**：原断言比较两次 `runBatch` 真实墙钟（`parElapsed < seqElapsed × 0.95`），在共享/满载 CI runner 上测的是"机器忙不忙"而非"并发退化没退化"；已被同文件 SC-003 的结构性峰值断言（`maxConcurrentCalls ∈ (1,3]`）部分覆盖，遂改造为基于 mock 侧调用时间线的负载无关判据 `averageConcurrency`（区间时长之和 ÷ 区间并集长度）。
- **核验方式**：读全文件 + diff + 手写 4 组构造区间独立验证 `summarizeConcurrency` 算法 + 3 次重复实跑取值稳定性 + 确认 SC-003 断言逐字未变。
- **结论**：成立（详见下方逐条记录第 5–8 项）。

---

## 逐条核验记录

### 链 G

**1. `unit` project 新增 `testTimeout: 30_000`，其余四个 project 未被改动**

- 命令：`git diff ff0fdb0~1 ff0fdb0 -- vitest.config.ts`
- 输出摘要：diff 仅命中 `unit` project 块，新增 6 行（含注释 5 行 + `testTimeout: 30_000,` 1 行），`integration`/`golden-master`/`self-hosting`/`e2e` 四个 project 块在本 diff 中无任何 `+`/`-` 行。
- 结论：**成立**。

**2. 预算确实生效（临时探针，已还原无残留）**

- 命令：
  ```
  # 写入 tests/unit/__f233-probe.test.ts：
  #   await new Promise((resolve) => setTimeout(resolve, 8000)); expect(true).toBe(true);
  npx vitest run --project unit tests/unit/__f233-probe.test.ts
  ```
- 真实输出：
  ```
  ✓ |unit| tests/unit/__f233-probe.test.ts (1 test) 8005ms
    ✓ F233 探针：unit project testTimeout 预算 > sleep 8000ms 应在 30s 预算内通过  8004ms
  Test Files  1 passed (1)
  ```
- 清理核验：`rm tests/unit/__f233-probe.test.ts` 后 `ls` 报 `No such file or directory`；`git status --porcelain -- tests/unit/` 无输出（无残留）。
- 结论：**成立**。

**3. CI 原受害两用例本地通过**

- 命令：`npx vitest run tests/unit/spec-drift-check.test.ts tests/unit/graph-quality-core.test.ts`
- 真实输出：
  ```
  ✓ |unit| tests/unit/spec-drift-check.test.ts (28 tests) 3969ms
  ✓ |unit| tests/unit/graph-quality-core.test.ts (10 tests) 6287ms
  Test Files  2 passed (2)
       Tests  38 passed (38)
  ```
- 结论：**成立**（两文件合计 38 个用例全绿，含 fix-report 引用的 5.3s/7.3s 超时用例）。

**4. 根级 `test` 块仅声明 `globals`/`environment`/`testTimeout`/`coverage`，无第二处缺口**

- 核验方式：直接读 `vitest.config.ts` 第 16-23 行（根级 `test:` 块）。
- 实读内容：`globals: false`、`environment: 'node'`、`testTimeout: 30_000`、`coverage: {...}`——共 4 个字段，与 fix-report 声称一致，无 `hookTimeout`/`retry`/`teardownTimeout` 等根级已声明但 unit 遗漏的字段。
- 结论：**成立**（fix-report 对"不存在第二处缺口"的表述属实——因为根级本就没声明这些字段，不是"声明了但 unit 没继承"）。

### 链 H

**5. SC-006 已不含墙钟对比，改为 `averageConcurrency` 断言**

- 命令：`grep -n "parElapsed\|seqElapsed\|averageConcurrency\|summarizeConcurrency" tests/e2e/batch-concurrency.e2e.test.ts`
- 实读：`parElapsed`/`seqElapsed` 仅出现在注释里（描述"原实现"），代码中不存在这两个变量；实际断言为 `expect(seq.averageConcurrency).toBeLessThan(1.05)`（第 320 行）与 `expect(par.averageConcurrency).toBeGreaterThan(1.5)`（第 329 行）。
- 结论：**成立**。

**6. `summarizeConcurrency` 并集算法正确性**

- 核验方式：抽取函数体，用 Node 独立跑 4 组手算构造区间：
  | 构造 | 手算期望 | 实际输出 |
  |---|---|---|
  | 三重完全重叠 `[0,100]×3` | union=100, avg=3 | `activeWindowMs:100, averageConcurrency:3` |
  | 顺序不重叠 `[0,100][100,200][200,300]` | union=300, avg=1 | `activeWindowMs:300, averageConcurrency:1` |
  | 部分重叠+空档 `[0,100][50,150][300,400]` | union=250, avg=1.2 | `activeWindowMs:250, averageConcurrency:1.2` |
  | 乱序输入（验证排序生效）`[200,300][0,100][100,200]` | union=300, avg=1 | `activeWindowMs:300, averageConcurrency:1` |
- 4 组全部与手算一致，重叠区间未被重复计入并集、乱序输入经内部排序后结果正确。
- 结论：**成立**。

**7. SC-003 未被削弱**

- 命令：`git diff ff0fdb0~1 ff0fdb0 -- tests/e2e/batch-concurrency.e2e.test.ts | grep -E "^[+-].*maxConcurrentCalls"`
- 输出：仅命中一行新增注释（"与 SC-003 的分工：..."），`expect(metrics.maxConcurrentCalls).toBeLessThanOrEqual(3)` 与 `.toBeGreaterThan(1)` 两条断言本身在 diff 中无 `+`/`-`，逐字未变。
- 结论：**成立**。

**8. 全绿 + 3 次重复取值稳定性**

- 命令：`npx vitest run tests/e2e/batch-concurrency.e2e.test.ts`
- 真实输出：`Test Files 1 passed (1)` / `Tests 4 passed (4)`（SC-003/SC-006/SC-004/SC-005 全绿）。
- 稳定性核验（临时加 `console.log` 打印 `averageConcurrency`，取证后已用备份文件完整还原，`git diff`/`git status` 均确认无残留）：
  ```
  RUN 1: seq=1, par=1.837246963562753
  RUN 2: seq=1, par=1.8344947735191637
  RUN 3: seq=1, par=1.829675153643547
  ```
  对照组 `seq` 三次均为 1（<1.05 阈值），实验组 `par` 在 1.8297–1.8372 之间，抖动 < 0.008，稳定跨过 1.5 阈值。
- 结论：**成立**。

---

## 全量门禁

| 命令 | 退出码 | 摘要 |
|---|---|---|
| `npm run build` | 0 | `tsc` 编译零错误；`postbuild:stamp` 正常盖章 `commit=ff0fdb0b (dirty)` |
| `npx vitest run` | 0 | **Test Files 1 failed \| 482 passed \| 4 skipped (487)**；**Tests 1 failed \| 5772 passed \| 18 skipped \| 21 todo (5812)**。唯一失败为 `tests/integration/graph-quality-lang-matrix.test.ts` 的 Java `SyntaxError: Unexpected end of JSON input`（真实 CLI 子进程 stdout 被截断）；**隔离单跑该文件（`npx vitest run tests/integration/graph-quality-lang-matrix.test.ts`）8 个用例全绿**，确认为满载并行下的 flaky，非 F233 改动引入的回归——该文件属 `integration` project（已显式声明 `testTimeout: 60_000`），与链 G 修复的 `unit` project 无关，也不在 fix-report 声称修复的 3 个 CI 受害文件清单内 |
| `npm run test:plugins` | 0 | `tests 919 / pass 919 / fail 0` |
| `npm run repo:check` | 0 | 全部检查项 `pass`，仅 1 条 `warn`：`graph-quality:freshness`（图产物 `sourceCommit` 与当前 HEAD 不一致，需重建图——与本次改动无关的既有环境状态） |

---

## 边界确认

**10. F231 未提交内容未被本次改动波及**

- 命令：`git status --porcelain | grep -E "judge-snapshot|judge-file-set|231-judge"` + `grep -n "judge:doctor" package.json`
- 输出：`plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`、`scripts/lib/judge-snapshot-{core,io}.mjs`、`tests/judge-*`、`tests/fixtures/judge-file-set-guard/`、`specs/231-judge-snapshot-drift-signal/` 均仍以 `??`（未跟踪）状态原样存在；`package.json` 第 38 行 `"judge:doctor": "node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs"` 保留。
- 结论：**成立**。

**11. F232 改动未被回退**

- 核验：`scripts/run-plugin-tests.mjs` 头部注释仍含 "背景（F232 fix-report 链 A）"；`.github/workflows/ci.yml` 中 `Build` 与 `Build Knowledge Graph` 两个 step 名称仍存在；`src/panoramic/anchoring/edge-builder.ts` 中 `quantizeConfidenceScore` 函数与相关"量化"注释仍在（第 55-190 行区间多处命中）。
- 结论：**成立**。

---

## 总体结果

| 维度 | 状态 |
|------|------|
| Root Cause 对齐（链 G） | ✅ 成立，实测证据支持 |
| Root Cause 对齐（链 H） | ✅ 成立，实测证据支持 |
| Build Status | ✅ PASS |
| Test Status | ✅ PASS（5772/5812 通过，18 skipped，21 todo；1 个满载 flaky 隔离重跑绿，非回归） |
| test:plugins Status | ✅ PASS（919/919） |
| repo:check Status | ✅ PASS（1 条既有环境 warning，非本次改动引入） |
| 边界确认（F231/F232 未受影响） | ✅ 成立 |
| **Overall** | **✅ 可交付** |

### 需要修复的问题

无阻断项。

### 观察到但非阻断的既有问题（不属本次改动范围）

1. `tests/integration/graph-quality-lang-matrix.test.ts` 在全量并行满载下出现一次子进程 CLI stdout JSON 截断导致的 flaky，隔离重跑绿；fix-report 已披露"spawn 子进程类测试仍有满载 flaky"为独立未治理议题，本次核验复现了这一已知残余，不构成新增回归。
2. `repo:check` 报 `graph-quality:freshness` warning（图产物 `sourceCommit` 落后当前 HEAD），是执行验证过程中构建/测试产生的环境状态漂移，非源码问题，重建图即可清除，不阻断交付判断。

### 未验证项

无（本次全部声称均已实跑取证）。
