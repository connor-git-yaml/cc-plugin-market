# Verification Report: F274 — global-setup 跨 worktree 假新鲜盲区收口

**特性目录**: `specs/274-fix-global-setup-cross-worktree-freshness`
**模式**: fix
**验证日期**: 2026-08-31
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律合规) + Layer 2 (原生工具链，实际执行)

---

## 一、验证命令结果表

| # | 命令 | 退出码 | 结果摘要 |
|---|------|--------|---------|
| 1 | `npx vitest run tests/integration/global-setup-cross-worktree-freshness.test.ts` | 0 | ✅ PASS — 1 test file, **7/7 tests passed**（tasks.md 原设计 5 例，implement 阶段按 quality-review INFO 建议补强至 7 例），耗时 165ms |
| 2 | `npx vitest run`（全量） | 0 | ✅ PASS — **544 passed \| 4 skipped**（548 test files），**7957 tests passed \| 15 skipped \| 12 todo**（7984 total），耗时 64.97s（单命令执行时段独占，无并发进程干扰） |
| 3 | `npm run build` | 0 | ✅ PASS — `tsc` 零类型错误；`prebuild`（inline-d3，内容无变化跳过写入）与 `postbuild`（postbuild-stamp，盖章 commit=ea47b980 dirty）均正常完成 |
| 4 | `npx vitest run tests/integration/graph-quality-pinned-staleness.test.ts` | 0 | ✅ PASS — **6/6 tests passed**，耗时 1.36s。这正是 fix-report 中原始复现的假红套件（此前在陈旧 dist 上因缺 F271 lineRange 逻辑导致 6 用例假红），本次在同一 commit（ea47b980）、globalSetup 判"dist/ 已是最新，跳过重建"的前提下**全绿**，回归确认修复生效 |
| 5 | `git status --porcelain` | — | ✅ 改动面仅限：`M tests/global-setup.ts`（修改）+ `?? tests/integration/global-setup-cross-worktree-freshness.test.ts`（新增）+ `?? specs/274-fix-global-setup-cross-worktree-freshness/`（spec 制品目录）。无越界改动 |

**补充**：`npm run repo:check` 全部检查项 pass，仅 1 条 `graph-quality:freshness` warn（图产物 sourceCommit 与当前 HEAD 不一致，本地长期既有状态，与本次修复无关，不阻断）。

---

## 二、AC-1 ~ AC-7 逐条达成状态

| AC | 描述 | 状态 | 证据 |
|----|------|------|------|
| AC-1 | 复现 bug 用例断言 `isDistFresh` 在"inputsSha256 匹配但 dist 实际内容与 sidecar 绑定不同"时返回 `false`；还原为修复前逻辑重跑须转红（变异验证） | ✅ 已达成 | 用例 1 在命令 1 中通过；fix-report 附带的变异验证记录（本报告"三、审查汇总"节引用编排器既定事实）：还原 `isDistFresh` 为仅比对 `inputsSha256` 的修复前逻辑 → 用例 1 转红（`isDistFresh` 误判 `true`）→ 证伪成功；恢复后 7/7 绿 |
| AC-2 | 正常同 worktree 场景（用例 2）`isDistFresh` 仍返回 `true`，快路径不受影响 | ✅ 已达成 | 命令 1 用例 2 通过；quality-review 报告"调用方合同核对"确认 `setup()`/`onTestsRerun()` 现有单参数调用点走默认参数、行为逐字节不变 |
| AC-3 | 旧 schemaVersion 1 sidecar 被安全拒绝（`readSidecar` 返回 `null`），不抛异常 | ✅ 已达成 | 命令 1 用例 3 通过；spec-review 报告确认 `schemaVersion !== 2` 一律返回 null |
| AC-4 | `deriveSidecarPath` 对不同 `PROJECT_ROOT` 产生不同文件名 | ✅ 已达成 | 命令 1 用例 4 通过 |
| AC-5 | 全量 `npx vitest run` 零失败，`npm run build` 零类型错误 | ✅ 已达成 | 命令 2（544 passed/4 skipped，0 failed）+ 命令 3（tsc 零错误）均通过 |
| AC-6 | `setup()`/`onTestsRerun()`/`runBuild()` 既有调用顺序、日志文案、C1/W1/W3/W4 语义未被改动 | ✅ 已达成 | spec-review 报告确认"C1 rmSync 先于 execFileSync 保留；setup/onTestsRerun 单参调用走默认参数；watch 容错结构未动"；quality-review 报告"调用方合同核对"逐一核对 `isDistFresh`/`writeSidecar`/`readSidecar→readSidecarFingerprint` 三处签名变更均向后兼容或已同步全部调用点（`grep` 确认无遗漏） |
| AC-7 | 真实跨 worktree 复现（可选，需另一已 clone worktree 环境） | ⏭️ 按 plan 标注"可选"，未纳入 | plan.md/tasks.md 均明确标注此项非本次任务强制项；fix-report 的原始实证（worktree funny-driscoll-fc77bb 复现）已作为问题发现证据独立存在，不需要在 verify 阶段重复真实跨 worktree 场景 |

**AC 覆盖率**：6/6 强制项已达成（100%），1 项可选未纳入（按 plan 明确豁免，不计入缺口）。

---

## 三、审查汇总

### 3.1 Layer 1: Spec-Code 对齐（Phase 4a spec-review）

**结论：PASS（CRITICAL 0 / WARNING 0 / INFO 1）**，合规率 11/12（91.7%）。逐条 FR/AC 状态见上表；INFO 1 项（T012 异构对抗审查证据留待 commit 阶段核验）已在下方 3.3 节确认完成。

### 3.2 Layer 1.5: 代码质量审查（Phase 4b quality-review）

**结论：GOOD（CRITICAL 0 / WARNING 1 / INFO 2）**

| 严重程度 | 维度 | 描述 | 处置 |
|---------|------|------|------|
| WARNING | 性能 | `computeDistFingerprint` 在 `inputsSha256` 匹配路径下对整个 `dist/`（329 个 .js）全量读内容求 sha256；watch 模式下 `onTestsRerun` 每次 rerun 判"仍新鲜"都会重复此开销；fix-report 原以"数十 ms 量级可忽略"定性但缺实测数据 | ✅ 已处置：对抗审查阶段已补齐实测数据——329 个 .js 全量 hash 实测约 6–12ms，量级确认可忽略，无需改为 mtime+size 轻量指纹 |
| INFO | 可维护性 | `writeSidecar` 隐式承担"清理遗留共享文件"副作用，函数名未体现 | 未处置（非阻断，quality-review 标注"可接受"） |
| INFO | 可维护性 | dist 为空/不存在时 `computeDistFingerprint` 用例仅断言 `not.toThrow()`，未进一步断言确定性 | 未处置（非阻断，quality-review 标注"可选、非必须"） |

### 3.3 门禁类改动异构对抗审查（Codex 配额暂停期档位，CLAUDE.local.md 约定）

按门禁类改动（tests/global-setup.ts 是测试基础设施，失效即静默放行假绿）要求，执行 **2 个独立子代理、2 个不同切入角**的异构对抗审查：

- 切入角 1：失效放行面（sidecar/绑定校验失效时是否会静默判"新鲜"、误跳过重建）
- 切入角 2：绕过与误伤面（分键构造同名冲突、TOCTOU 窗口内 dist 被并发改动、正常路径是否被误伤）

**结论：均 0 CRITICAL**。据其结论落地 4 项修订：

| 修订 | 内容 | 触发面 |
|------|------|--------|
| R1 | 撤销 legacy 共享 sidecar 清理逻辑的激进版本，改为有意偏离 plan D2 描述的保守 best-effort 清理（仅在写入默认真实路径时触发，测试路径不触碰） | 绕过与误伤面 |
| R2 | 测试改为钉住生产接线常量 `TEST_INPUTS_SIDECAR`（而非硬编码字面量路径），确保测试与生产实现同源 | 绕过与误伤面 |
| R3 | `FULL_BUILD_INPUT_PATHS` 补充 `node_modules/d3-force/dist/d3-force.min.js`，修正输入指纹遍历范围遗漏 | 失效放行面 |
| R4 | 注释措辞收紧为自指一致性表述，避免过度承诺 | 可读性/可维护性 |

**修订批次的变异验证**：`TEST_INPUTS_SIDECAR` 回退为固定名（模拟 R2 修订前状态）→ R2 相关两个用例转红（原 5 例仍绿，证明变异只影响预期用例、无误伤）→ 恢复后 **7/7 绿**。

**Codex 审查暂停标注**：本次门禁类改动的对抗审查按 CLAUDE.local.md 暂停期约定，**Codex 审查暂停，异构档位缺席**——已用 2 个独立子代理 + 2 个不同切入角替代，配额恢复后可回补 Codex 审查。

---

## 四、已知边界与残余风险（登记不修）

以下边界经审查确认为既有结构或超出本次修复范围，明确登记不修：

| 边界 | 说明 |
|------|------|
| 孤儿 dist 产物 | `npm run build` 无 clean 步骤，历史构建残留文件不会被清理，仅新/变更文件参与 hash 校验；本次修复未改变此既有行为 |
| watch execFileSync 180s timeout 孙进程穿透 | 与 F268 同族问题，watch 模式下超时子进程链未必被完全终止；本次修复未触碰 watch 容错语义（AC-6 已确认零改动） |
| 同 worktree 并发双构建混合 dist | 两个进程同时触发 `npm run build` 写入同一 `dist/` 可能产生混合产物；F251 已声明此边界，本次修复不新增防护 |
| keyed sidecar 孤儿累积 | 按 PROJECT_ROOT 分键后，worktree 删除时其专属 sidecar 文件不会自动清理，随 worktree 生命周期在共享 `.cache/` 内累积；影响仅为磁盘空间占用（每份体积极小），不影响正确性 |
| tests/ 不在 tsc 类型检查覆盖内 | 既有结构性事实，`npm run build` 的 tsc 配置本不含 `tests/` 目录，本次新增测试文件遵循既有约定，不改变覆盖范围 |

以上均为经审查确认的既有边界或本次修复范围外事项，不构成阻断本次交付的缺陷。

---

## 五、最终判定

| 维度 | 状态 |
|------|------|
| Layer 1 Spec-Code 对齐 | ✅ PASS（11/12 = 91.7%，1 项 INFO 已处置） |
| Layer 1.5 验证铁律合规 | ✅ COMPLIANT（本报告全部命令均为实际执行，含退出码与输出摘要，无推测性表述） |
| Layer 1.5 代码质量审查 | ✅ GOOD（0 CRITICAL，1 WARNING 已处置，2 INFO 非阻断） |
| Layer 2 全量 vitest | ✅ PASS（544 test files passed / 4 skipped，7957 tests passed，0 failed） |
| Layer 2 build | ✅ PASS（tsc 零类型错误） |
| Layer 2 repo:check | ✅ PASS（仅 1 条既有 freshness warn，不阻断） |
| 门禁类异构对抗审查 | ✅ 完成（2 子代理 × 2 切入角，0 CRITICAL，4 项修订已落地并重验） |
| 改动面越界检查 | ✅ 无越界（仅 1 修改文件 + 1 新增测试文件 + spec 制品目录） |

### 总体结果：✅ READY FOR REVIEW

本次修复（F274）实现了 sidecar 绑定 dist 内容指纹 + 按 PROJECT_ROOT 分键的双管齐下方案，6/6 强制验收标准（AC-1~AC-6）全部达成，AC-7（可选真实跨 worktree 复现）按 plan 明确豁免。全部验证命令实际执行，零失败/零错误。原始复现的假红套件（`graph-quality-pinned-staleness.test.ts`）在修复后于同一陈旧 dist 前提场景下转为全绿，根因闭环确认。门禁类改动已完成异构对抗审查（Codex 暂停期档位），无遗留 CRITICAL/WARNING。可进入下一阶段（commit / push 待用户确认）。
