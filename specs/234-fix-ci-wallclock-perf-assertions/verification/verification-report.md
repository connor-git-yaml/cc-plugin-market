# Verification Report: F234 fix-ci-wallclock-perf-assertions

**特性分支**: `claude/mystifying-gagarin-5ca56b`（worktree: `modest-ellis-e4f0fe`）
**验证日期**: 2026-07-31
**验证范围**: Layer 1（Root Cause / 判据核验，fix 模式无 spec.md）+ Layer 2（原生工具链）
**验证环境**: macOS，18 核（`hw.ncpu=18`），Node v24.14.0，本机非 CI

---

## Layer 1: Root Cause 验证结论（fix 模式必填锚点）

fix-report 的 Root Cause 判断为：**用单点绝对墙钟耗时验证"算法复杂度"（一个关于增长率的性质）是判据与目标错配**。本次改动把 community-analysis 的判据换成 `T(1000)→T(4000)` 的 CPU 时间增长比（阈值 8，最多 3 轮重测），manifest-manager 的阈值从 100ms 放宽到 1000ms 并改注释为"量级退化下限"。

以下逐条核验，**全部为本次实跑取证，非转述实现者数据**。

### 1. 判据确已改造

**命令**：
```bash
grep -n "toBeLessThan(30000)\|toBeLessThan(30_000)" tests/panoramic/community-analysis.test.ts
grep -n "elapsed" tests/panoramic/community-analysis.test.ts
```
**输出**：仅命中一处，且位于注释内（`// \`expect(elapsed).toBeLessThan(30000)\` 用单个规模的一次绝对耗时来验证它，`），代码里不再有该断言；主度量确为 `measureAnalysis()` 返回的 `process.cpuUsage()` 差值（`cpu = (delta.user + delta.system) / 1000`）；`expect(lastLargeWall).toBeLessThan(120_000)` 的注释明确写"不承担复杂度判定职责"。
**结论**：✅ 成立。

### 2. 墙钟 vs CPU 的核心声称（自行设计实验验证）

**实验设计**：不复用实现者数据，自行写独立脚本 `measure.mts` 直接调用 `runCommunityAnalysis`（跳过 vitest 层），在三种负载条件下采样 `cpu` 与 `wall` 的增长比：

- (a) 空载（单进程串行 5 次）
- (b) 真实重负载：`nohup npx vitest run`（全量 5812 用例）+ 40 个 CPU busy-loop 子进程同时跑，再并发起 3 个 `measure.mts` 实例采样

**命令与实测输出**（空载）：
```bash
npx tsx measure.mts 5
run0 ratioCpu=4.33 ratioWall=4.35
run1 ratioCpu=4.28 ratioWall=4.35
run2 ratioCpu=4.37 ratioWall=4.37
run3 ratioCpu=4.40 ratioWall=4.43
run4 ratioCpu=4.40 ratioWall=4.38
```

**命令与实测输出**（40 busy-loop + 全量 vitest 同时跑、3 个采样实例并发）：
```text
run0: ratioCpu 4.77 / 4.78 / 4.97    ratioWall 4.57 / 4.62 / 4.80
run1: ratioCpu 5.17 / 5.22 / 5.13    ratioWall 2.68 / 2.72 / 2.53
run2: ratioCpu 4.14 / 4.24 / 4.09    ratioWall 3.78 / 3.82 / 3.78
```

**分析**：本机重负载下 `ratioCpu` 全部落在 **4.09–5.22**（紧窄区间，远低于阈值 8），而 `ratioWall` 落在 **2.53–4.80**——不仅波动更宽，且部分并发实例的墙钟比值（2.53、2.68）**低于空载基线**（4.35），说明墙钟增长比在真实并发下不单调、不可靠。这与 fix-report 声称的方向一致（cpu 更稳定），虽然本机（18 核、非 4 vCPU CI）测得的具体数值区间与实现者报告的 1.44–10.85 / 3.56–5.67 不同（预期之内，负载生成方式与硬件不同），**但核心结论方向复核成立**。

**额外证据**（同批次全量 vitest 真实跑到该用例本身）：日志显示 `1000→4000 节点算法复杂度不退化` 在这次全量重负载下单次墙钟耗时 **30120ms** 仍判为 ✓ PASS（见下方 Layer 2 全量测试结果）。若仍用旧的 `elapsed < 30000` 判据，这次真实观测会直接判 FAIL——这是本机独立复现的、支持"改用 CPU 判据"必要性的直接证据。

**结论**：✅ 部分成立→整体方向成立。具体数值区间与实现者报告不同（不同硬件/负载生成方式），但"CPU 比值比墙钟比值更稳定、且墙钟在真实负载下会误报"这一核心论点本机独立复现成立。

### 3. 阈值 8 的余量

**实测数据**（同上）：空载 CPU 比值 4.28–4.40；真实重负载 CPU 比值 4.09–5.22。距阈值 8 的余量：最差观测（5.22）到 8 尚有 **1.53×** 空间；典型观测（~4.3）到 8 有 **~1.86×** 空间。
**结论**：✅ 成立，余量为正但不算宽松（最差观测下仅 1.53×，若宿主负载比本次实验更极端，理论上仍有一定翻车概率，但已远好于旧的绝对阈值判据）。

### 4. 守护力仍在（变异测试）

**方法**：在 `src/panoramic/community/index.ts` 的 `loadGraph(graphJson)` 之后临时插入一段 O(n²) 探针（三重循环 `n × n × REPEAT`，`REPEAT` 从 150 逐步调至 600 以获得足以越过阈值 8 且不至于长到不可接受的耗时），验证前后 `shasum -a 256` 完全一致确认可精确还原。

**命令**：
```bash
shasum -a 256 src/panoramic/community/index.ts   # 变异前
# ...注入探针...
npm run build
npx vitest run tests/panoramic/community-analysis.test.ts -t "1000→4000" --reporter=verbose
```
**实测输出**（变异态，REPEAT=600）：
```text
× 1000→4000 节点算法复杂度不退化（负载无关的规模缩放比判据） 29069ms
  → T(1000)→T(4000) 缩放比连续越界：#1 ratio=8.70; #2 ratio=8.69; #3 ratio=8.97
  AssertionError: expected 8.970118748526314 to be less than 8
```
**还原验证**：
```bash
cp <scratchpad>/index.ts.orig src/panoramic/community/index.ts
shasum -a 256 src/panoramic/community/index.ts
# 673f3314...（变异态哈希）→ abfdb6e8...（还原后）与变异前原始哈希 abfdb6e8... 完全一致
npm run build   # 通过
git status --porcelain src/   # 空输出
npx vitest run tests/panoramic/community-analysis.test.ts -t "1000→4000"   # ✓ passed 3556ms
```
**结论**：✅ 成立。新断言在真实算法复杂度退化（O(n²) 注入）下 3 轮全部越界并正确失败；探针已完全还原，`shasum` 前后一致、`git status --porcelain src/` 为空，无残留。

### 5. 旧断言无判别力的声称（自行验证）

用同一个 O(n²) 变异态（未还原前），独立写脚本直接调用 `runCommunityAnalysis` 对 5000 节点跑一次（模拟旧用例的单点测量方式），观察是否仍满足 `< 30000ms`：
```bash
node -e "... runCommunityAnalysis(build(5000,3), tmp) ... elapsed<30000"
old-style 5000-node elapsed(ms)= 12618 oldThreshold30000_pass= true
```
**结论**：✅ 成立（本机独立复现）。在同一个真实存在算法复杂度退化（新判据已确认能抓住）的代码状态下，旧的 `elapsed < 30000` 判据仍然通过——直接证明旧断言对这类真实退化没有判别力。具体耗时（12618ms）与实现者报告的 19.2s/26.4s 不同（探针实现方式不同、机器不同），但"仍然 < 30000 从而放行"这一结论一致。

### 6. manifest-manager

**命令**：
```bash
sed -n '238,255p' tests/panoramic/cache/manifest-manager.test.ts
```
**核验结果**：阈值确为 `expect(elapsed).toBeLessThan(1000)`；注释明确写"这里守护的**不是**性能指标，而是量级退化下限"，并说明为何不用缩放比（该路径本身线性，两次测量差在噪声量级）。

**自行采样**（独立脚本 `measure-manifest.mts`，绕开 vitest 层直调 `ManifestManagerImpl`）：
- 空载 5 次：单次 1000-entry load+flush 耗时 **2.20–4.32ms**（与注释所写"1.9-4.8ms"量级一致）；1000→2000 缩放比 **1.50–2.18**（空载下已见明显噪声）
- 40 busy-loop 重负载下 3×3 采样：单次耗时 **3.21–15.32ms**（相对 1000ms 阈值仍有约 **65×** 余量）；缩放比 **1.20–4.59**（与注释所写满载 1.38–18.96 方向一致：确实不稳定，不适合做缩放比判据）
**结论**：✅ 成立。1000ms 阈值在本机重负载下仍有数十倍余量；缩放比方案在本机独立复现也确实不稳定，支持"保留绝对阈值 + 放宽余量"而非改缩放比的选择。

---

## Layer 2: 原生工具链

**检测到**：`package.json`（npm）+ TypeScript（`tsc`）
**项目目录**：仓库根目录（单体，非 monorepo）

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | `tsc` 零类型错误，`postbuild-stamp` 正常盖章 |
| Test（全量） | `npx vitest run` | ✅ PASS | `Test Files 483 passed \| 4 skipped (487)`；`Tests 5773 passed \| 18 skipped \| 21 todo (5812)`；耗时 49.87s；含 `community-analysis.test.ts`（4 用例，其中目标用例通过）与 `manifest-manager.test.ts`（10 用例全过） |
| Test（插件） | `npm run test:plugins` | ✅ PASS | `tests 919 / pass 919 / fail 0` |
| Repo Check | `npm run repo:check` | ✅ PASS（1 条 warning） | 全部 gate 项 `pass`；唯一 warning 为 `graph-quality:freshness`——图产物 `sourceCommit` 与当前 HEAD（工作树未提交）不一致，属预期的本地未建图噪声，与 F234 改动无关 |

**旁注（非官方门禁结果，供参考）**：在验证过程中曾于人为叠加 40 个 CPU busy-loop 的极端超载条件下跑过一次全量 `vitest run`，出现 2 个与 F234 无关的失败（`tests/integration/graph-quality-adversarial.test.ts`、`tests/integration/graph-quality-cli.test.ts`），推测为该极端人为超载导致的环境性 flaky。**上表的官方门禁结果是随后在无人为额外负载条件下重跑的干净结果（0 失败）**，据此判定不构成本次交付的阻断项，但记录在此供追踪。

---

## 边界核验

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 零生产代码改动 | `git status --porcelain src/` | 空输出 ✅ |
| F231 未提交内容原样保留 | `ls plugins/spec-driver/scripts/judge-snapshot-doctor.mjs ...`、`ls plugins/spec-driver/tests/lib/`、`grep judge:doctor package.json` | 三个新增脚本文件存在；`tests/lib/` 含 `import-closure-helper.mjs`/`import-closure-parser.mjs`；`package.json` 第 38 行 `judge:doctor` 脚本行存在 ✅ |
| F232/F233 改动未回退 | `git show 457ab2b --stat` / `git show 3edf1f8 --stat` | 两次提交均在当前分支历史中，内容未被本次改动触及或覆盖（本次 diff 仅涉及 `community-analysis.test.ts`、`manifest-manager.test.ts`） ✅ |

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Root Cause 验证 | ✅ 判据改造确已落地；核心"CPU 比值优于墙钟比值"论点本机独立实验复现成立（具体数值区间因硬件/负载生成方式不同而与实现者报告不同，但方向一致） |
| 守护力（变异测试） | ✅ O(n²) 注入下新断言 3 轮全部越界失败；旧判据在同一变异态下仍放行（本机独立验证） |
| 生产代码零改动 | ✅ `git status --porcelain src/` 为空 |
| Build Status | ✅ PASS |
| Test Status（全量） | ✅ PASS（5773/5773，0 failed） |
| Test Status（插件） | ✅ PASS（919/919） |
| Repo Check | ✅ PASS（1 条无关 warning） |
| **Overall** | **✅ READY FOR REVIEW（可交付）** |

### 需要修复的问题

无阻断项。

### 需要关注但不阻断的点

1. 阈值 8 相对本机实测最差观测（5.22）仅 1.53× 余量——若 CI 宿主并发压力显著高于本次实验条件，理论上仍存在低概率误报风险，建议后续在真实 CI 上持续观察，不必本次改动即挡。
2. 本次实测的具体墙钟/CPU 比值区间与 fix-report 中实现者报告的区间不同（不同硬件、不同负载生成方式），但两组独立实验在"该用哪个判据"这一结论上一致，判定不影响可交付性。
3. 人为极端超载（40 busy-loop 叠加全量 vitest）下曾观察到 2 个与 F234 无关的测试失败（`graph-quality-adversarial.test.ts`、`graph-quality-cli.test.ts`），无额外负载时干净复测通过；记录供后续追踪，不作为本次阻断项。

### 未验证项（工具未安装）

无。
