# Verification Report: F268 CI 真实 spectra CLI 两级解析回退链

**特性分支**: `fix/268-fix-ci-spectra-bin-fallback`（已 rebase 到 origin/master，含 F266/F265-CI）
**验证日期**: 2026-08-30
**验证 commit**: c4ba62fc（dist 已重建并按此 commit 盖章）
**验证范围**: Phase 4c — 全量交付门禁 + F268 定向证据复核（rebase 后终态重取证）+ 验证证据核查

---

## 一、全量交付门禁（逐条实跑）

| # | 命令 | Exit Code | 结果原文摘要 |
|---|------|-----------|-------------|
| a | `npx vitest run` | 0 | `Test Files 538 passed \| 4 skipped (542)` / `Tests 7894 passed \| 18 skipped \| 21 todo (7933)`；Duration 64.52s。无失败，无 F235 birpc exit≠0 假信号（脚本层 echo exit code=0，与测试计数一致）。未命中预存 flaky 账（watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e --version）——本次全量跑全绿，无需隔离复判 |
| b | `npm run build` | 0 | `tsc` 零错误；`postbuild:stamp` 盖章 `commit=c4ba62fc`（与当前 HEAD 一致） |
| c | `npm run repo:check` | 0 | 全部检查项 `pass`，含 `graph-quality:freshness: pass`（图刚 graph-only 刷新过，无 stale 警告）；`spec-drift:anchors-status: pass` |
| d | `npm run release:check` | 0 | `Release contract valid`；仅 1 条 advisory：`[publish-gap] HEAD 领先已发布版本 4.4.0 21 个 src commit（阈值 5）`——**不阻断**，与本次改动无关（M10 尚未发版是既定路线，非本 fix 引入） |
| e | `npm run test:plugins` | 0 | `tests 1585 / suites 272 / pass 1583 / fail 0 / cancelled 0 / skipped 2 / todo 0`，与预期完全一致（1585 tests / 1583 pass / 0 fail / 2 预存 skip） |

**全量门禁结论：5/5 全绿，零失败，零意外 skip。**

---

## 二、F268 定向证据复核（rebase 后终态重取证）

### 2a. masked-PATH CI 模拟（三条 F241 证据锚）

使用 `env PATH="$SCRATCH/ci-sim-bin:/usr/bin:/bin"`（`ci-sim-bin/node` 为软链至真实 Node 24.14.0，`PATH` 内确保无全局 `spectra` 命令，模拟 GitHub Actions runner 缺全局安装场景）：

| 用例文件 | 命令 | 结果 |
|---------|------|------|
| `graph-refresh-executor.test.mjs` | `--test`（全量） | `tests 14 / pass 14 / fail 0`，含 FR-007/SC-002 集成用例「真实 spectra + 最小 git fixture：真实 graph-only 重建成功并产出可查询图」实测通过 |
| `graph-consumption-cli.test.mjs` | `--test-name-pattern "Part 4"` | `tests 2 / pass 2 / fail 0`：SC-002「真实 stale 图上的真实刷新」+ SC-003「additive-only 非 dry-run 下图文件零变化」均通过 |
| `real-spectra-bin.test.mjs`（helper 专属机制测试） | `--test`（全量） | `tests 5 / pass 5 / fail 0`：二级成功 / 二级缺失 / 复验拦截 / `$()` 注入转义安全 / 缓存语义（失败不缓存、成功缓存命中）全部通过 |

三条命令均在 masked PATH 下走**第二级 dist wrapper 回退路径**（PATH 内确认无 `spectra`），证明修复对「CI 无全局安装」场景生效，且未依赖开发机残留全局命令产生假绿。

### 2b. 验证 commit 内容完整性

`git show c4ba62fc --stat` 输出恰 **7 个文件**，与 tasks.md 声明范围逐一对齐：

- 代码/测试（4）：`graph-consumption-cli.test.mjs`（+32/-?）、`graph-refresh-executor.test.mjs`（+15/-?）、新增 `tests/lib/real-spectra-bin.mjs`（139 行）、新增 `tests/real-spectra-bin.test.mjs`（209 行）
- specs 制品（3）：`fix-report.md`（132 行）、`plan.md`（125 行）、`tasks.md`（98 行）

**无越界文件混入**：生产代码目录（`src/`）、`.github/workflows/ci.yml`、F267 相关文件（atomic-write / hook-installer）均零触碰，符合 plan.md 范围红线。

---

## 三、验证证据核查（对照 tasks.md T004/T005/T006 + fix-report 验证计划步骤 1-3、5）

| Task | 验收判据 | 证据状态 |
|------|---------|---------|
| T004 | `npm run test:plugins` 全绿，~100 个不依赖 PATH 用例零行为变化 | ✅ 本次门禁 (e) 复核为 1585/1583/0/2，delta 前基线为 1580 tests（差值 5 = 新增 `real-spectra-bin.test.mjs` 5 用例），未触碰用例数字吻合，证据完整真实 |
| T005 | masked PATH 下三条锚转绿 | ✅ 本轮 §2a 独立重跑复核，非引用 fix-report 声称——三条命令均实测重跑并给出计数原文 |
| T006 | masked-PATH + 藏 dist 仍响亮 fail（负向） | ⚠️ 本轮验证闭环**未重跑该负向场景**（藏 dist 会破坏当前已盖章的 dist 状态，且 fix-report 已记录明确的失败断言正文与恢复步骤）；采信 fix-report 中记录的实测结果（`mv dist dist.bak` → 3 用例 `AssertionError`，错误正文含升级文案 → `mv dist.bak dist` 恢复后复跑转绿），未见与本轮 §2a 结果矛盾之处。**标注为「未在本轮独立复测，采信既往实测记录」，非本轮直接证据** |
| fix-report 验证计划步骤 1-3 | 本地正常 PATH 全绿 / masked PATH 转绿 / 藏 dist 负向 fail | 步骤 1-2 本轮已独立复核（§一、§2a）；步骤 3（负向）同 T006，采信既往记录 |
| fix-report 验证计划步骤 5 | 全量交付门禁零失败 | ✅ 本轮 §一 全部实跑，5/5 绿 |

无推测性表述（"should pass" / "看起来没问题"）——所有 PASS 结论均基于本轮实测命令输出的退出码与计数。

---

## 四、4a/4b/对抗审查结论汇总（引用编排器注入，未重复执行）

| 审查层 | 结论 |
|--------|------|
| 4a Spec 合规审查 | 0 CRITICAL / 0 WARNING / 1 INFO（helper 落点 plan/tasks 纠偏已留痕）；改动面与 fix-report 清单精确对齐；三条范围红线零违反 |
| 4b 代码质量审查 | 0 CRITICAL / 1 WARNING（探针无 timeout，已在批次 3 修复为 30s+SIGKILL）/ 2 INFO（mkdtemp 残留、文案重复）；总评 GOOD |
| 异构对抗（×2 切入角 + delta 轮 ×1，共 5 路） | 抓出探针无界死锁（SIGTERM 忽略实测穿透 60.4s）、null 毒化缓存、sh 注入、注释 over-claim、二级零本地覆盖等 9 项，已全部在批次 2/3 修复；4b 的 timeout WARNING 同批闭环；不修项（伪二进制/版本不钉死/dist 新鲜度）已在 fix-report 残余风险节登记理由 |
| Codex 对抗审查 | **暂停中**（配额耗尽），已在 commit message 显式标注「Codex 审查暂停，异构档位缺席」，符合 CLAUDE.local.md 暂停期替代档位要求 |

---

## 五、GATE_VERIFY 建议

### 总体结果：✅ READY FOR REVIEW

- 全量交付门禁 5/5 绿（vitest / build / repo:check / release:check / test:plugins）
- F268 定向证据（三条 F241 锚 + helper 专属测试）在 masked-PATH 模拟下独立重跑全绿
- commit 内容边界精确（7 文件，无越界）
- 无 CRITICAL 遗留；4b 的唯一 WARNING 已闭环
- **无 CRITICAL 项清单需要修复**

### 真 CI 待证项（pending，非本轮验证闭环职责范围）

- **T007**：真 CI 触发确认——push 当前分支到 origin，观察 GitHub Actions `Test` 与 `Test Plugins (mjs gate)` 两步是否转绿。本地 masked-PATH 模拟已给出高置信度间接证据，但**真实 GitHub Actions runner 环境的最终确认仍需编排器随后 push 触发**，本报告标记为 pending，不代表已验证
- **T006 独立复测**：建议后续（若有必要）在不影响当前已盖章 dist 的窗口独立重跑一次负向场景（藏 dist），当前采信既往 fix-report 记录

### 未验证项

- 无工具链缺失（本仓所有构建/测试工具均已安装可用）
