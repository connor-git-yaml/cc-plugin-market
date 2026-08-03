# Verification Report: F251 dist 竞写测试隔离修复

**特性分支**: `251-fix-dist-race-test-isolation`
**验证日期**: 2026-08-04
**验证范围**: Layer 1（Spec-Code 对齐，fix 模式以 fix-report.md 问题点映射为准） + Layer 2（原生工具链）
**验证模式**: fix — Phase 4c

> 说明：`spec.md` 为通用占位模板（fix 模式未按 FR-00N 逐条填写，符合 fix-report 惯例——本类问题的需求源是 fix-report.md 的"影响范围扫描"表 + 5-Why 根因链），Layer 1 对齐改以该映射表 + 4a spec-review-report.md 已完成的逐条核对为准，不重复展开。

## Layer 1: Spec-Code 对齐（复用 4a 结论）

4a spec-review-report.md 已逐条核对 fix-report.md「影响范围扫描」表列出的 7 项结构性问题点（Root Cause 时间隔离、指纹双底座错位、plan.md 修正表新发现的 3 处、globalSetup 声明层级、共享 fail-fast helper 设计、`spectra-version-gate.mjs` 只消费不修改、TDD「先红」语义未被弱化），结论：

- **7/7 已实现（100%）**
- 唯一偏差：T014（满载全量复跑 ≥3 轮）在 4a 审查时点未完成 → 已在本轮（4c）由主编排器提供 5 轮复跑证据补齐，详见下方「T014 证据核查」

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT

本报告所列全部命令均为本子代理在当前 worktree 内亲自执行（build/lint/定向测试/repo:check/grep），附真实退出码与输出摘要；T014 满载复跑证据由主编排器提供日志文件，本子代理已亲自核读日志原文（`grep`/`Read`）逐轮核实 Test Files / Tests 汇总行与 exit code，未采信任何转述性声明。未检测到"should pass"/"看起来没问题"等推测性表述。

- 缺失验证类型：无
- 检测到的推测性表述：无

## Layer 1.75/1.8/1.9: 深度检查 / 残留扫描 / 文档一致性

- **调用链完整性**：`vitest.config.ts` 根级 `test.globalSetup` → `tests/global-setup.ts::setup()` → `isDistFresh()` 判据 → 8 处 `beforeAll` 改为 `assertDistBuilt()`（`tests/helpers/dist-cli-guard.ts`）。链路完整，无参数丢失/异常吞掉。
- **残留扫描**：`grep -rn "execFileSync('npm', \['run', 'build'\]" tests/ --include='*.ts'` 仅命中 `tests/global-setup.ts:88` 一处，确认 8 处 beforeAll 无条件 build 已全部消除，无残留。
- **文档一致性**：plan.md 决策点 2 已完整记录三轮判据演进（4a/4b 后 mtime→BUILD_META，内部对抗复审第二轮后 mtime→输入内容指纹 + sidecar 迁 `node_modules/.cache/`），与 `tests/global-setup.ts` 当前终态实现（`BUILD_META` L41、`TEST_INPUTS_SIDECAR` L48、`isDistFresh()` L151-156、`runBuild()` 先删后写 L182-191）逐条对应，本子代理已直接核读现状代码复核，无文档漂移。

## T014 证据核查（满载全量复跑 ≥3 轮，mtime 锚点版，5 轮）

核读日志 `t014-rerun.log`（主编排器提供，5 轮）：

| 轮次 | Test Files | Tests | vitest_exit | 说明 |
|------|-----------|-------|-------------|------|
| R1 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 1 | exit=1 系 `[vitest-worker]: Timeout calling "onTaskUpdate"`（F235 已记录的 birpc 60s 硬超时残余），零用例失败 |
| R2 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 | 全绿 |
| R3 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 | 全绿 |
| R4 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 1 | 同 R1，onTaskUpdate 超时，零用例失败 |
| R5 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 1 | 同 R1，onTaskUpdate 超时，零用例失败 |

**结论**：5 轮 Test Files / Tests 汇总行完全一致（516 passed \| 4 skipped，6962 passed \| 18 skipped \| 21 todo），**零用例失败**。R1/R4/R5 的进程 exit=1 是 birpc worker 通信层的硬超时（触发条件=同机存在另一 worktree 满载全量 suite 同时跑，双重负载饱和 60s RPC 窗口），与本次 dist 竞写修复无关、不构成回归——原 bug 表现是**用例断言失败**（`result.warnings` 非空），而本次 5 轮全部 0 用例失败，证明竞写窗口已消除。

T014 判定（mtime 锚点版）：**PASS**（证据充分，非纸面声称）——**注**：该判据后续被内部对抗复审（见下）替换为输入内容指纹判据，此表作为历史记录保留，不代表当前代码状态。

## T014 终版证据（内容指纹判据版，3 轮）

背景：内部对抗复审（Codex 配额烧穿期间的降级替代）对上一版 `dist/.spectra-build-meta.json` mtime 锚点抓到 1 项 CRITICAL（C1：任何 mtime 比较都无法处理"构建进行中发生 src 编辑"的时序竞态，且 `tar -x`/`rsync -t`/`cp -p` 等保留 mtime 的复制方式会造成 mtime 倒退误判）+ 5 项 WARNING，已修复落地（详见 plan.md「内部对抗复审后修订（第二轮）」）：

- 新鲜度判据从 mtime 整体换成**输入内容指纹**：`computeInputsFingerprint()` 遍历 `FULL_BUILD_INPUT_PATHS` 全部文件算 sha256 总指纹，构建前取快照、构建成功后连同该快照写入 sidecar；下次运行现算指纹与 sidecar 比对，不一致即重建——彻底不依赖任何文件系统时间戳，同时堵死"构建期间又发生编辑"的窗口（该次编辑不会被已计算的快照覆盖，下次比对必然不一致）
- **【第三轮修订，终态事实】** sidecar 落盘路径**不是** `dist/.spectra-test-inputs.json`（此前一版本子代理曾在本报告误写为该路径），终态为 `node_modules/.cache/spectra/test-build-inputs.json`（`tests/global-setup.ts:48` `TEST_INPUTS_SIDECAR`）。改迁原因（对抗复审 I4）：`dist/` 在 `package.json` 的 `files` 白名单内会被打进 npm 发布包，`prepublishOnly` 会跑一次 vitest，若 sidecar 留在 `dist/` 里会连带被发布出去（测试基础设施内部状态不应出现在发布产物中）；`node_modules/.cache/` 天然不入包、不入库，且 `npm ci` 清空 `node_modules` 时 sidecar 随之消失，触发一次保守重建，方向正确
- **【第三轮修订，C1 关键语义，终态事实】** `runBuild()`（`tests/global-setup.ts:182-191`）先 `rmSync(TEST_INPUTS_SIDECAR, { force: true })` **再** `execFileSync('npm', ['run', 'build'])`，只有构建完整成功（未抛异常）才 `writeSidecar()` 重新写入新快照；若 `computeInputsFingerprint()` 之前已因 TOCTOU 失败返回 `null`，则构建成功后也**只删不写**（W1 与 C1 两处修订的交汇点：不确定的指纹不落盘，缺 sidecar 恒判不新鲜）。这堵死了"先 execFileSync 后 writeSidecar"旧序列下的静默假新鲜窗口：编译失败但 tsc 未开 `noEmitOnError` 导致 `dist/` 已写入半成品、随后把源码改回原状使指纹重新匹配旧 sidecar 记录、误判 fresh 继续跑在半成品 dist 上——先删后写保证任何失败/中断的构建都会让 sidecar 处于"不存在"状态，下次现算指纹时 `readSidecarFingerprint()` 返回 `null`，`isDistFresh()` 恒为 `false`，无条件触发重建
- watch 模式 `TestProject.onTestsRerun` 补接线（`tests/global-setup.ts:221-245`），确保 watch 场景下同样触发新鲜度判定；watch rerun 的重建失败**不 fail-loud**（与首次 `setup()` 不同）——`try/catch` 吞掉异常、打印醒目日志后**放行本次 rerun**，不杀掉整个 watch 会话（开发过程中中间态编译不过是正常现象），先删后写的语义保证下次 rerun 会重新判定不新鲜并自动重试
- 新增 `SPECTRA_TEST_SKIP_DIST_BUILD` 环境开关 + `fixture-isolation.yml` CI matrix 4 job 各自跳过一次空耗 build（`cross-project-isolation.test.ts` 已核实不消费任何 dist 产物）
- `dist-cli-guard.ts` 改为 `import.meta.url` 锚定 + 双重存在性断言

本子代理核读日志 `t014-final.log`（主编排器提供，3 轮，修订批之后跑出）：

| 轮次 | `[global-setup]` 出现次数 | 文案 | Test Files | Tests | vitest_exit |
|------|------------------------|------|-----------|-------|-------------|
| R1 | 1（L5） | `dist/ 已是最新（输入指纹匹配），跳过 npm run build` | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |
| R2 | 1（L3868） | 同上 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |
| R3 | 1（L7723） | 同上 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |

全文 `grep "Timeout calling"` 与 `grep " N failed | "` 均零命中（对比上一版 5 轮中 3 轮出现的 birpc 超时，本轮 3 次满载复跑无一触发——工具链侧此时负载更轻，非本次修复主张的因果证据，仅如实记录）。

**结论**：内容指纹判据版 3 轮 **Test Files / Tests 汇总行完全一致、vitest_exit 恒为 0、`[global-setup]` 恰好触发一次且文案确认走的是新判据分支**，零用例失败。

### 封板轮（W1 三行收尾后终版判据，3 轮）

背景：内容指纹判据版随后又补齐 W1 收尾三行——build 后重算指纹（而非只用构建前快照）、且仅当 `post === pre`（构建期间输入未再变化）才写入 sidecar，若构建期间输入发生变化则不写（防止把"构建中又被改动过的输入"误记成"已验证过的新鲜快照"）。

本子代理核读日志 `t014-seal.log`（主编排器提供，3 轮，W1 收尾后跑出）：

| 轮次 | `[global-setup]` 出现次数 | 文案 | Test Files | Tests | vitest_exit |
|------|------------------------|------|-----------|-------|-------------|
| R1 | 1（L5） | `dist/ 已是最新（输入指纹匹配），跳过 npm run build` | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |
| R2 | 1（L3877） | 同上 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |
| R3 | 1（L7815） | 同上 | 516 passed \| 4 skipped (520) | 6962 passed \| 18 skipped \| 21 todo (7001) | 0 |

`grep "Timeout calling"` 与失败模式（` N failed | `）均零命中。3 轮 Test Files / Tests 汇总行完全一致，`vitest_exit` 恒为 0，`[global-setup]` 恰好每轮触发一次。

**结论**：封板轮（W1 收尾后终版判据）3 轮零失败、exit=0，无回归。

### 合计口径

前一版（mtime 锚点）5 轮 + 内容指纹版 3 轮 + 封板版（W1 收尾后终版判据）3 轮 = **合计 11 轮满载全量复跑，零用例失败**（5 轮 mtime 版中 3 轮进程 exit=1 系 F235 已记录的 birpc onTaskUpdate 60s 超时签名，触发条件为同机姊妹 worktree 双全量 suite 饱和，与 dist 竞写无关、全部用例仍通过；其余 6 轮 exit 全为 0）。

### 修订批工具链复核（本子代理亲自执行）

| 验证项 | 命令 | 结果 |
|--------|------|------|
| Lint | `npm run lint`（= `tsc --noEmit`） | ✅ PASS，零错误 |
| 定向测试 | `npx vitest run tests/unit/graph-quality-core.test.ts` | ✅ 17/17 passed，`[global-setup] dist/ 已是最新（输入指纹匹配），跳过 npm run build` 正常触发一次 |

T014 终版判定：**PASS**（11 轮合计零用例失败，证据充分，非纸面声称）。

## 4a/4b WARNING 处置核查

| 来源 | WARNING | 核查结论 |
|------|---------|---------|
| 4a spec-review-report.md | ①T014 复跑证据缺口 | 已闭合，见上表 |
| 4a spec-review-report.md / 4b quality-review-report.md（同源） | ②新鲜度锚点应改用 `dist/.spectra-build-meta.json` 而非 `dist/cli/index.js` mtime（构建中途被杀死场景下单文件锚点会误判 fresh，丧失自愈能力） | **已修复，但该修法本身已被第三轮修订取代，需按演进链条理解**：4a/4b 那一轮把锚点从 `dist/cli/index.js` mtime 换成了 `dist/.spectra-build-meta.json` mtime（`isDistFresh()` 曾是 `existsSync(DIST_CLI) && existsSync(BUILD_META) && newestMtimeMs(...) <= statSync(BUILD_META).mtimeMs`），这一形态已在本子代理前一轮验证中确认落地。**但内部对抗复审第二轮又抓到该 mtime 判据本身的结构性漏洞（C1）**——任何 mtime 比较都无法处理"构建进行中发生 src 编辑"的时序竞态，也不免疫 `tar`/`rsync -t`/`cp -p` 造成的 mtime 倒退——于是判据被整体替换为输入内容指纹（见上「T014 终版证据」小节）。**终态**：`tests/global-setup.ts` 当前的 `isDistFresh(currentFingerprint)`（L151-156）已不再做任何 mtime 比较，改为 `currentFingerprint !== null && existsSync(DIST_CLI) && existsSync(BUILD_META) && readSidecarFingerprint() === currentFingerprint`；`BUILD_META` 仅作为"入口文件在但构建从未走完/被中断"的结构性兜底存在性检查，不再是新鲜度的主锚点。本子代理已直接核读现状代码确认与上述终态一致。 |

两条 WARNING 均已实证闭合，无遗留。

## 第三轮 delta 终审结论

**0 CRITICAL / 2 WARNING / 5 INFO**（W1 残余窗口三行收尾已同批处置；W2' 即本次文档修正——上一版本报告对 sidecar 落盘路径的误写已在本轮全部订正为终态事实，并核对 `runBuild`/`isDistFresh`/watch 分支行为与 `tests/global-setup.ts` 现状一致）。**判定：可 commit。**

## Layer 2: Native Toolchain

### TypeScript / Node.js (npm)

**检测到**: `package.json`
**项目目录**: 仓库根

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | prebuild(inline-d3) → tsc → postbuild(stamp) 全流程零错误退出，`commit=68eb7e5f (dirty)` 已盖章 |
| Lint | `npm run lint`（= `tsc --noEmit`） | ✅ PASS | 零错误、零告警输出 |
| 定向测试 | `npx vitest run tests/unit/graph-quality-core.test.ts tests/integration/graph-quality-cli.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts` | ✅ 86/86 passed | 3 Test Files 全绿，`[global-setup] dist/ 已是最新，跳过 npm run build` 仅出现 1 次，确认 globalSetup 单点执行、无重复构建 |
| repo:check | `npm run repo:check` | ⚠️ WARN（预存，与本次无关） | 全部 84 项 check 中仅 `graph-quality:freshness` 报 warn（图产物 sourceCommit 落后于当前 HEAD + collector fingerprint 未记录，提示需重跑 `spectra batch --mode graph-only`）；无新增 error，其余全部 pass |
| 变异断言 | `grep -rn "execFileSync('npm', \['run', 'build'\]" tests/ --include='*.ts'` | ✅ PASS | 仅 `tests/global-setup.ts:88` 一处，5(8) 处 beforeAll build 调用点已全部消除 |

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Layer 1 结构性问题点覆盖 | 100%（7/7，复用 4a 结论） |
| T014 证据（终版，W1 收尾后封板判据） | ✅ PASS（11 轮合计零用例失败：5 轮 mtime 版 + 3 轮内容指纹版 + 3 轮封板版） |
| 4a/4b WARNING 处置 | ✅ 均已实证闭合 |
| Build Status | ✅ PASS |
| Lint Status | ✅ PASS |
| Test Status（定向） | ✅ PASS (86/86) |
| Test Status（T014 满载全量，11 轮合计） | ✅ PASS (6962/6962 × 11 轮，零失败) |
| repo:check | ⚠️ WARN（graph-quality:freshness，预存与本次无关） |
| 变异验证（无运行期 build 残留） | ✅ PASS |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题（如有）

无 CRITICAL / 阻断项。`repo:check` 的 `graph-quality:freshness` warn 为图产物落后 HEAD 的预存提示（与本次修复无关，建议交付后单独跑 `spectra batch --mode graph-only` 重建图，不阻断本次 fix 交付）。

### 未验证项（工具未安装）

无（TypeScript/Node.js 工具链全部可用）。
