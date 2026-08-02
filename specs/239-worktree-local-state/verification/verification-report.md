# Verification Report: 239-worktree-local-state

**特性分支**: `claude/worktree-local-state-604d5a`
**验证日期**: 2026-08-02
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律) + Layer 1.75/1.8/1.9（深度/残留/文档）+ Layer 2 (原生工具链)
**验证方式**: 本报告全部命令均由 verify 子代理独立实跑（未采信 implement 子代理任何自报文本），退出码与关键输出均为真实捕获。

---

## Layer 1: Spec-Code 对齐（Success Criteria 逐条核验）

| SC | 描述 | 验证命令/方式 | 真实退出码 & 关键输出 | 判定 |
|----|------|--------------|---------------------|------|
| SC-001 | graph bootstrap 双腿验收（≤60s） | 主编排器沙盒实测（`git clone --local` 隔离沙盒，见 `research/orchestrator-measurements.md` §M11），未重跑（沙盒证据可信：与 §M9 全冷环境实测、本次 repo:check 的 `spectra graph-quality` 真实调用互相印证一致） | 成功腿 4745ms（`bootstrapSource=local-build`，图 6083 节点，内嵌 sourceCommit==HEAD）；失败腿 115ms（PATH 剥离 spectra，`bootstrapSource=none`，`assessable=false`，无挂起） | ✅ PASS（**verify 采信主编排器实测，未独立重跑沙盒**——见"已知残留"节说明可信度依据） |
| SC-002 | 清单内容合同 + bash 动态绑定 | (a) `npx vitest run tests/unit/worktreeinclude-contract.test.ts` exit 0，35/35 passed；(b) `npx vitest run tests/unit/worktreeinclude-golden-matrix.test.ts` exit 0，8/8 passed；(c) **本次独立手工复核**：临时在 `.worktreeinclude` 追加一行 `worktree-demo-239.log`，用 `WORKTREEINCLUDE_PROBE_FILE=.worktreeinclude bash scripts/sync-worktree-local-state.sh` 探针模式验证 bash 侧输出立即包含新条目（未改脚本代码），随后 `git checkout -- .worktreeinclude` 还原，`git status --short` 确认零残留 diff | 35 passed / 8 passed；手工探针输出 `.env.local` + `worktree-demo-239.log`（exit 0），还原后 diff 为空 | ✅ PASS |
| SC-003 | secret 文件名 pattern 策略被测试强制 | **本次独立手工复核（红→绿闭环）**：临时在 `scripts/sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 数组插入 `"id_rsa.pem"`，跑 `npx vitest run tests/unit/sync-worktree-local-state.test.ts -t "SYMLINK_TARGETS 精确等于\|pattern 黑名单"`；随后 `git checkout -- scripts/sync-worktree-local-state.sh` 还原并复测 | 插入后：`2 failed \| 37 passed`（allowlist 精确性用例判红 + pattern 黑名单用例判红，`secretHits` 命中 `id_rsa`/`\.pem`）；还原后复测：`39 passed \| 59 skipped`，exit 0；`git status --short` 确认零残留 | ✅ PASS |
| SC-004 | SYMLINK_TARGETS 固定 allowlist 精确性 | `npx vitest run tests/unit/sync-worktree-local-state.test.ts`（全量套件内含该断言，见 SC-003 验证中"还原后复测"39 passed 已覆盖） | 断言数组精确等于 6 项且逐项 symlink 生成验证通过（全量 vitest 运行内含） | ✅ PASS |
| SC-005 | AGENTS.override.md ignored + byte budget | `git check-ignore AGENTS.override.md`；`wc -c AGENTS.md`；`grep -F "AGENTS.override.md" .worktreeinclude` | `git check-ignore` exit 0（输出 `AGENTS.override.md`）；`AGENTS.md` = 23346 bytes（< 32768）；grep 未命中（AGENTS.override.md 不在 .worktreeinclude 内容中） | ✅ PASS |
| SC-006 | 路径逃逸对抗矩阵零仓库外写入 | `npx vitest run tests/unit/sync-worktree-local-state.test.ts -t "FR-011\|containment\|symlink"` | exit 0，16/16 passed（含 absolute-path、`..` 穿越、glob、否定前缀、转义、symlink-component 三形态、check-ignore-error 等） | ✅ PASS |
| SC-007 | graph provenance 唯一权威合同自消费 | `npx vitest run tests/unit/sync-worktree-local-state.test.ts tests/unit/graph-bootstrap-status.test.ts -t "sidecar\|provenance\|freshness\|bootstrapSource"` | exit 0，38/38 passed（含 poison-sidecar 正反向、遗留 sidecar 清理、rerun 继承 bootstrapSource、四态 freshness 映射、`--attempt-build` local-build 接线、C5 卡死秒级收口） | ✅ PASS |
| SC-008 | hook 失败可见但不阻断 | `npx vitest run tests/unit/worktree-lifecycle-hook.test.ts` | exit 0，4/4 passed | ✅ PASS |
| SC-009 | 全量门禁零失败 | `npx vitest run`（全量）；`npm run build`；`npm run repo:check` | vitest exit 0（487 files passed / 4 skipped，5948 tests passed / 18 skipped / 21 todo）；build exit 0；repo:check exit 0（含第 14 族 4 项 pass） | ✅ PASS |

**A/B 归因（对照 M8 基线 483 test files / 5773 tests，`orchestrator-measurements.md` §M8）**：

- 本次实测：**487 test files（+4）/ 5948 tests（+175）**，与 tasks.md T036 预期"新增 4 个新测试文件 + 1 个既有文件扩展"完全吻合（`worktreeinclude-contract.test.ts` / `worktreeinclude-golden-matrix.test.ts` / `graph-bootstrap-status.test.ts` / `worktree-lifecycle-hook.test.ts` 四个新文件 + `sync-worktree-local-state.test.ts` 扩展）。
- 4 skipped 文件数与基线一致（e2e/需要额外凭据的既有 skip，非本 feature 引入）。

### 手工验证项（Non-Goals 声明不入自动化门禁，如实标注 MANUAL-PENDING）

| 任务 | 内容 | 状态 |
|------|------|------|
| T038（SC-001 双腿手工计时留痕） | 干净 worktree 下重新实测两腿计时并记录结论 | ⚠️ MANUAL-PENDING — spec 明确此为"不阻塞自动化门禁"的手工验证任务，tasks.md 中仍为未勾选状态；本报告采信的是主编排器此前已完成的等价沙盒实测（§M11），**建议在正式交付前由责任人在真正干净的 worktree 中补跑一次并勾选 T038**，因为 §M11 的沙盒虽隔离但并非"全新 `git worktree add`"路径本身 |
| T039（Codex 桌面客户端行为人工验证） | 在真实 Codex 桌面应用创建 managed worktree，验证 `.worktreeinclude` copy-if-absent 与 `AGENTS.override.md` 取代生效 | 🔴 MANUAL-PENDING — 自动化无法驱动 Codex 桌面 app，**不判定 PASS**，需用户后续在真实客户端人工验证并回填结论 |
| T040（终局聚合 checkpoint） | 聚合 T037/T038/T039 结论 | ⚠️ 依赖 T038/T039 完成，当前不满足聚合条件 |

### FR 覆盖率摘要（对应 tasks.md 覆盖映射表，13 条 FR 全部有 Task 落点）

- **总 FR 数**：13
- **已实现（有测试断言 + 实跑验证）**：13
- **未实现**：0
- **覆盖率**：100%（FR-010 的"Codex setup script 精确接入点"按 spec 明确声明为能力性要求 + `[AUTO-RESOLVED]`，不要求写死具体文件名，已满足）

---

## Layer 1.5: 验证铁律合规

**状态**：**COMPLIANT**

implement 侧留痕（`implement-log-batch1~4.md` + `implement-log-fixround.md`）中每条 CRITICAL/WARNING 修复均附"红态证据（实跑输出）→ 修复 → 转绿（实跑输出）"三段式记录，未见"should pass"/"看起来没问题"等推测性表述；verify 本轮进一步对全部关键命令做了独立重跑（不依赖 implement 自报），未发现与实际退出码不符的声称。

- **缺失验证类型**：无（build / test / lint（repo:check 含 lint 等价校验）均有实跑证据）
- **检测到的推测性表述**：无

---

## Layer 1.75: 深度检查

- **调用链完整性**：`sync-worktree-local-state.sh` → `read_worktreeinclude_entries` → `validate_entry`（8 类拒绝+1 类合法）→ `copy_path`/`publish_exclusive`（`--attempt-build` 路径经 `runBoundedProcess` 有界执行）→ `write-status`（`graph-bootstrap-status.mjs`）链路完整，未发现参数丢失或异常吞噬断点；`check_graph_freshness()` 在 `node` 不可用时降级为 warning 而非中断，`node` 不可用分支已被 T029 (b) 子场景实测覆盖（PASS）。
- **数据持久化验证**：`writeBootstrapStatus` 使用 temp+rename 原子写并有 `try/finally` 清理逻辑（修复轮 W3），本次全量测试中原子写与 rename 失败清理用例均 PASS，非数据库场景（无 commit/flush 概念，以原子文件写等价校验）。
- **配置贯穿验证**：`SPECTRA_BIN`（`command -v spectra` 绝对路径）从脚本顶部解析一路传入 `check-freshness`/`attempt-build` 两处调用点（数组参数，非拼接字符串），修复轮 C1 已验证该链路在真实全局 CLI 环境下确实生效（不再依赖裸命令名 PATH 敏感性）。

---

## Layer 1.8: 残留扫描

本 feature 无删除/重命名类改动（新增文件为主，`bootstrap_graph()` 内部逻辑重构但函数名/接口对外一致），跳过强制残留扫描；仅确认 F193 遗留 sidecar (`specs/_meta/.graph-source-commit`) 的迁移语义已被 seeded-legacy 测试覆盖（"遗留 sidecar 在 bootstrap 后被清理，且不会被重新生成" PASS），未发现遗留代码路径继续写入旧 sidecar。

---

## Layer 1.9: 文档一致性检查

`docs/spectra-cli-reference.md` 已按 T027 完成同步：

```
$ grep -n "graph-source-commit" docs/spectra-cli-reference.md
```

（未检测到旧 sidecar 描述残留旧口径；已确认改为 `graph-bootstrap-status.json` 新状态文件合同说明，符合 FR-006/回归护栏第 7 条"禁触/允许改动面"关于该文档的要求。）

---

## Layer 2: 原生工具链验证

**检测到**：`package.json`（npm）、Node.js 20.x+/24.x

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | exit 0；`tsc` 零编译错误；postbuild 盖章 commit=a66f002d |
| Test（全量） | `npx vitest run` | ✅ PASS | exit 0；487 test files passed / 4 skipped（491）；5948 tests passed / 18 skipped / 21 todo（5987）；Duration 51.14s |
| Lint/校验（repo:check） | `npm run repo:check` | ✅ PASS（1 条 warn，非 fail） | exit 0；14 族全部 pass，含新族 `worktree-local-state` 的 4 项（`worktreeinclude-exists`/`worktreeinclude-entries`/`worktreeinclude-ignored-verified`/`agents-byte-budget`）全 pass；`graph-quality:freshness` 状态为 `warn`（图 sourceCommit 落后当前 HEAD，符合预期——这正是 FR-006 现算 freshness 机制在工作，不是回归） |
| Plugin 测试 | `npm run test:plugins` | ✅ PASS | exit 0；1065 tests / 178 suites / 0 fail |

---

## 审查链摘要

四轮 Codex 对抗审查已全部落实（细节见 `specs/239-worktree-local-state/reviews/` 四份文件，不复述内容，仅陈述事实）：

| Phase | 审查结论 | 落实情况 |
|-------|---------|---------|
| Spec review round1 | 8 CRITICAL / 4 WARNING | 已回写 spec.md（边界声明、FR/SC 措辞收紧、containment 校验、provenance 权威合同、`bootstrapSource` 四态规则、`node` 降级条款等），spec.md 开放问题节确认"无遗留 `[NEEDS CLARIFICATION]`" |
| Plan review round1 | 11 CRITICAL / 3 WARNING | 4 处回写 spec，其余落实于 plan.md 的实现决策（硬链接排他发布、`checkFreshness` adapter 路径钉死、5 批实现分批） |
| Tasks review round1 | 6 CRITICAL / 7 WARNING（+2 INFO） | 33→40 任务重编号，T021/T022 原语边界二次精修（终审发现的假红陷阱），落实记录见 tasks.md 文末"Codex Round 1 复审"表 |
| Implement review round1 | 5 CRITICAL / 7 WARNING | 全部由 `implement-log-fixround.md` 记录"红态证据（实跑）→ 修复→转绿（实跑）"三段式闭环，本次 verify 已对其中关键项（C1 绝对路径 spectra bin、C2 symlink containment、C5 freshness 有界执行）做独立复测确认（见 SC-006/SC-007 验证行） |

---

## 已知残留与 follow-up

1. **M9 轨道 B4（goal_loop/MCP 对 `graph-bootstrap-status.json` 的实际消费）**：spec Non-Goals 明确排除，本 feature 仅让 `sync-worktree-local-state.sh` 自身成为第一消费者（FR-006 已满足），程序化下游消费留待 B4。
2. **Codex setup script 精确接入点（FR-010）**：spec 已 `[AUTO-RESOLVED]` 为能力性要求，具体 `.codex/` 文件名/字段格式待 T039 真实客户端人工验证后视需要补充。
3. **A4（CODEX_HOME helper 统一）**：本 feature 明确不改动，遇到的相关路径解析问题（若有）记为独立 follow-up，未在本次验证范围内发现新增此类问题。
4. **SC-001 手工计时留痕（T038）与 Codex 客户端人工验证（T039）**：均为 MANUAL-PENDING，不计入本报告的自动化 READY 判定，需责任人后续补做并回填 tasks.md 勾选状态。
5. **graph-quality freshness warn**：当前仓库图的 `sourceCommit` 落后于验证时刻 HEAD（`a66f002d` vs 图内嵌旧值），这是本地开发过程中正常出现的"图待重建"信号，不是回归——FR-006 的现算 freshness 机制正确捕获了这一状态并如实 warn（而非静默 ready），恰好印证本 feature 的核心设计目标。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage (SC) | 9/9 自动化可验证维度 PASS；2 项手工验证 MANUAL-PENDING（不阻断，spec 声明如此） |
| FR Coverage | 100%（13/13） |
| Build Status | ✅ PASS |
| Test Status | ✅ PASS（487 files / 5948 tests，0 failed） |
| repo:check | ✅ PASS（14 族全 pass，1 条预期内 warn） |
| test:plugins | ✅ PASS（1065/1065） |
| **Overall** | **✅ READY FOR REVIEW**（自动化门禁部分；T038/T039 手工验证需用户后续补做，不构成本次 verify 的阻断项，因 spec 明确声明其为"不阻塞自动化门禁"） |

### 需要修复的问题

无——本轮独立验证未发现与 spec 不符之处，5 CRITICAL + 7 WARNING（implement review）与此前 6 CRITICAL + 7 WARNING（tasks review）、11 CRITICAL + 3 WARNING（plan review）、8 CRITICAL + 4 WARNING（spec review）均已闭环，且本次 verify 对其中若干高风险点（containment symlink 绕过、freshness 无界阻塞、spectra bin 绝对路径）做了独立复测确认转绿。

### 未验证项（需人工/后续操作）

- T038：SC-001 双腿在"全新干净 worktree"环境下的手工计时留痕（当前采信主编排器等价沙盒实测，建议补做一次严格路径的复核）
- T039：Codex 桌面客户端真实行为人工验证（自动化无法覆盖，需用户在真实客户端操作确认）
