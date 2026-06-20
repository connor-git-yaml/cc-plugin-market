# 验证报告：Feature 202 — MCP batch graph-only + goal_loop Pilot

**日期**: 2026-06-20
**模式**: feature（goal_loop override 激活态）
**结论**: 载体任务 READY；pilot 结论见下「goal_loop 遥测」节（诚实评估）

> 注：goal_loop 各轮原始 verify JSON 在 `../goal-loop/verification-report-round-{1,2}.json` 与 `-round-2-full.json`；本报告为汇总 + pilot 遥测核心产出。

---

## 一、载体任务验收（MCP batch graph-only）

### 工具链门禁（独立 verify 子代理实跑，真实退出码）

| 命令 | 退出码 | 来源 |
|------|--------|------|
| `npx tsc --noEmit` | 0 | round-2 smoke |
| `npx vitest run` | 0（4912 passed / 0 failed / 18 skipped）| round-2 smoke |
| `npm run build` | 0 | round-2 full |
| `npm run lint` | 0 | round-2 full |
| `npm run repo:check` | 0（57 项守卫全绿，含 F196 + orchestration-overrides）| round-2 full |

### FR / NFR 合规（spec-review 复核）

| 项 | 状态 | 证据 |
|----|------|------|
| FR-001 enum 加 graph-only | ✅ | server.ts:209；用例 A2 safeParse 绿 |
| FR-002 describe 更新 | ✅ | server.ts:211 含"纯 AST·零 LLM"，无"暂不支持"；用例 C 绿 |
| FR-003 type union（不动 BatchMode） | ✅ | server.ts:220；build=0 |
| FR-004 handler dispatch buildAstGraphOnly | ✅ | server.ts:230-238；用例 A（buildAstGraphOnly 调 1 次 / runBatch 未调） |
| FR-005 裸 JSON.stringify 返回（无 {code}） | ✅ | server.ts:235-237；用例 A 解析返回体 |
| FR-006 portable graph（schemaVersion 2.0 / 0 绝对路径 / 零 LLM） | ✅ | 集成测试真跑：读 graphPath 断言 schemaVersion='2.0' + 0 绝对路径节点 + graphPath 落 tmpDir 内 + 含 fixture 节点 + 清空 LLM 凭据仍跑通 |
| FR-007 三 mode 零回归 | ✅ | 用例 D（it.each full/reading/code-only，runBatch 调 1 次 mode 透传 / buildAstGraphOnly 未调）；vitest 全绿 |
| FR-008 F196 守卫绿 | ✅ | batch 顶层 Output 例不变 `{successful,skipped,failed,indexGenerated}`；repo:check 绿 |
| FR-009 regen 参数隔离 | ✅ | 用例 B（callArgs.toHaveLength(1)） |
| FR-010 languages warn 不透传 | ✅ | 用例 E（console.error warn + 第二参未传 + 不报错） |
| NFR-001 零回归 | ✅ | 全量门禁绿 |
| NFR-002 复用不重写 | ✅ | 仅调 buildAstGraphOnly，实现留在 batch-orchestrator.ts:2487 |
| NFR-003 F196 不破坏 | ✅ | 同 FR-008 |
| NFR-004 MCP 契约不破坏 | ✅ | batch 沿用裸 JSON.stringify；其余 16 工具未触及 |

### 测试新增

- `tests/unit/mcp-server.test.ts`：+6 用例（A/A2/B/C/D/E），19 tests 全绿
- `tests/integration/mcp-batch-graph-only.test.ts`（新建）：真跑 portable graph 端到端 oracle，1 test 绿
- `tests/unit/mcp/{response-contract,telemetry-coverage}.test.ts`：mock 补 buildAstGraphOnly（防御性，Codex C3）

### Codex 对抗审查（implement phase）

CRITICAL×1（mock export，经实证全量 vitest 本就绿，仍按建议补防御性 mock）+ WARNING×2（零 LLM oracle → 测试内清空 LLM 凭据；graphPath 未断言在 tmpDir → 补 tmpDir 包含 + fixture 节点断言）+ INFO×3（均确认正确点）。全部修订。
quality-review 追加：WARNING×1（用例 E errSpy → try/finally）+ INFO×2（注释不实 → 修正；GraphJSON.nodeCount 死字段 → 补断言）。全部修订。

---

## 二、goal_loop 遥测（pilot 核心产出）

> 配置：max_iterations=5 / no_progress_max_rounds=2 / max_verify_seconds=300 / max_tool_invocations=50（config-schema 默认）。
> 红基线（启动信号）：委派 implement 子代理写测试（不动 src/）→ orchestrator 独立确认红：单元 5 failed（A/A2/B/C/E）+ 集成 1 failed = TRUE。

### 逐轮记录（7 字段，可 grep）

```
iteration: 1
changed: 委派 implement 子代理改 src/mcp/server.ts（import/enum/describe/type/handler 分支五处）
verifyExitCodes: { tsc: 0, vitest: 1, build: n/a(smoke), lint: n/a(smoke) }
decision: continue
impactInjectionMode: degraded   # Spectra impact 返回 symbol-not-found（图谱为主仓绝对路径构建，不含本 worktree 新代码）→ interpret-impact skipped
fallbackTriggered: false
rollbackTriggered: false
note: vitest exit=1 唯一来自预存 build 依赖 e2e（feature-170a 缺 dist/），regression_detected=false；本 feature 新测试全绿。decide-stop 因"非全 PASS"判 continue（见发现 #2）

iteration: 2
changed: 无代码改动（confirm-only：feature R1 已完成；轮间 orchestrator 执行 npm run build 修复 dist 环境缺口）
verifyExitCodes: { tsc: 0, vitest: 0 (smoke); build: 0, lint: 0, repo:check: 0 (escalate→full) }
decision: escalate_full → REACHED_GOAL
impactInjectionMode: degraded   # 同 R1，图谱仍不含新代码
fallbackTriggered: false
rollbackTriggered: false
note: smoke 全绿 → 按 Codex-C2 契约强制 full verify（非递归）→ verify_mode='full' 契约校验通过 → REACHED_GOAL
```

### 收敛

- 红→绿用 **2 轮**：R1 continue（环境污染指标，非代码问题）、R2 smoke 全绿 → escalate_full → full 全绿 → **REACHED_GOAL**。
- 退出原因：REACHED_GOAL（full 模式确认达标），action=goto_gate_verify。

### SC 诚实评估

**SC-001（端到端闭环真跑通了吗）**：**部分跑通，带一个真实的指标缺陷**。
- ✅ 真跑通的部分：goal_loop 全套机制端到端运行成功——单实例锁、plan-snapshot（stash 锚点）、interpret-impact 降级、委派 implement + 独立 verify 子代理（职责分离：verify 实跑捕获真实退出码、不信 implement 自报）、parse-report、decide-stop 优先级裁决、escalate_full 的"smoke 全绿强制 full + verify_mode 契约校验 + 非递归"（Codex-C2）、REACHED_GOAL 收口、释放锁、drop stash。core 决策全部由可执行 CLI 收口，编排器未在散文手写 stop/delta 逻辑。
- ⚠️ 对照 F201 ⚠️ 未验证：F201 verify 报告标注"真实 feature 的 goal_loop 端到端未验证"——本 pilot **首次端到端验证成功**，但暴露 R1 的 `continue` 是**假阴性**（见发现 #2），需 orchestrator 介入修复环境（npm run build）才在 R2 达标。**坐实**：goal_loop 闭环逻辑跑通；**修正**：其"达标指标"在未构建 worktree + 全量 vitest（含 build 依赖 e2e）组合下不可靠，**不能宣称"完全自主无人工"跑通**。

**SC-002（fallback 路径）**：**未触发**（happy path 2 轮内 REACHED_GOAL）。max_iterations / no_progress_max_rounds 均未触发。诚实标注：fallback 路径未被本 pilot 验证，需对抗性任务（故意不可达目标）单独验。

**SC-003（原子回滚）**：**未触发**（无回归，regression_count=0，rollbackTriggered=false 两轮）。诚实标注：回滚路径未被本 pilot 验证，需注入回归的任务单独验。

**SC-004（impact 注入降级实证 + M9 候选必要性）**：见发现 #3。

### 发现（dogfooding 一手反馈，转后续 Fix/M9 候选）

**发现 #1（snapshot/rollback vs 未跟踪配置 — 设计缺陷）**
- 复现：goal_loop snapshot 用 `git stash --include-untracked`、rollback 用 `git clean -fd`。本 pilot 的 `.specify/orchestration-overrides.yaml`（goal_loop 验证态 override，刻意不入 commit）属未跟踪且未 gitignore → 会被 stash 走或 clean 删，**导致 goal_loop 配置在循环中途消失**（自毁）。新建的未跟踪测试文件在回滚时也会被 `git clean -fd` 删。
- 缓解（本 pilot 已做）：把 override 加入 `.git/info/exclude`（本地、不 commit）使其被忽略。
- 建议 issue：**「goal_loop snapshot/rollback 应将 orchestration-overrides / config 路径默认排除出 git stash/clean 范围」**（core plan-snapshot/plan-rollback 增加 pathspec 排除）。

**发现 #2（smoke 指标被 build 依赖 e2e 污染 — 指标缺陷，影响 SC-001）**
- 复现：round<max 的 smoke = `tsc --noEmit` + `npx vitest run`（全量套件）。全量套件含 build 依赖 e2e（feature-170a 需 dist/），未构建 worktree 下预存失败 → vitest exit=1 → decide-stop 以"非全 PASS"判 `continue`，**即便本 feature 改动 100% 正确**。
- 影响：新 worktree（未跑 build）跑 goal_loop，smoke 轮永远达不到 REACHED_GOAL，会空转直到 NO_PROGRESS fallback。本 pilot 靠 orchestrator 轮间手动 `npm run build` 才在 R2 达标——人工介入削弱"自主"声明。
- 建议 issue：**「goal_loop verify 指标应区分 feature 相关失败 vs 预存/环境失败」**——选项：(a) smoke 也先 `npm run build`（牺牲速度）；(b) decide-stop 消费 verify 子代理已产的 `regression_detected=false` + feature 测试子集绿作为达标判据，而非要求全量套件绝对 PASS；(c) verify 子代理在未构建 worktree 自动先 build。

**发现 #3（impact 注入对 goal_loop forward-implementation 价值有限 — FR-011/012 / SC-004 实证）**
- 实测：两轮 impact 注入均 **degraded（skipped）**。根因有二：(1) live Spectra MCP 图谱是**主仓绝对路径**构建（fuzzyMatches 显示 `/Users/.../cc-plugin-market/src/...`），worktree 相对 id 查不到；(2) 更本质——goal_loop 是**新增代码**（graph-only 分支此前不存在于任何图谱），impact（反向 BFS 找 caller）对"尚未写的新代码"天然无 caller 可分析。
- **M9 候选「每轮 graph-only 刷图」必要性评估（FR-012 诚实回答）**：
  - 能解决 (1) worktree 路径不匹配 → 每轮用本 worktree graph-only 刷图，id 口径对齐。**有价值**。
  - **不能**解决 (2) 新代码无 caller → 即便刷图，本轮新写分支仍是叶子、无上游 caller，impact 反向 BFS 仍空。仅对"修改既有 symbol"类任务有增益。
  - 结论：**「每轮 graph-only 刷图」对"改既有代码"的 goal_loop 任务有必要（解 worktree 漂移），对"纯新增代码"任务价值有限**。建议 M9 定位为"按任务类型条件启用"而非无条件每轮刷图，避免对纯新增任务付建图成本却拿不到信号。本 pilot（纯新增 graph-only 分支）正是"价值有限"的实例。

**发现 #4（macOS 无 GNU timeout — 轻微）**
- verify 子代理报告 `timeout`/`gtimeout` 在 macOS 不可用，`max_verify_seconds` 的 timeout 前缀强制墙钟上限在 macOS 默认环境失效（已跳过前缀直接执行）。建议 core/verify 在缺 timeout 时降级用 node 侧 watchdog 或显式标注"墙钟上限未强制"。

---

## 三、GATE_VERIFY

goal_loop 退出转 GATE_VERIFY（always / critical，人工终局收口）。终局决策由用户在主线程 gate 确认（见交付报告）。

---

## 四、dogfooding 反馈（四维度）

- **MCP 可用性**：Spectra impact MCP 可调，但返回的是**主仓全局旧编译图谱**（绝对路径 id），对 worktree 新代码不可用 → 注入全程降级。与"live MCP 是全局旧编译产物"的已知事实一致。
- **返回信息够用度**：impact 的 `symbol-not-found` 带 fuzzyMatches 候选（含正确的主仓绝对路径 id），诊断信息充分——正是靠它定位到"图谱是主仓绝对路径"根因。
- **流程顺畅度**：goal_loop CLI 子命令齐全（decide-dispatch/plan-snapshot/interpret-impact/select-verify-mode/parse-report/decide-stop/format-iteration-log-entry/acquire-lock/release-lock）、契约清晰、JSON payload 入参顺手；编排散文与 CLI 职责切分明确。卡点是发现 #1（snapshot 误伤 override）和 #2（指标污染），均需 orchestrator 临场判断介入。
- **结果准确度**：core decide-stop 优先级裁决（continue / escalate_full / REACHED_GOAL）准确；escalate_full 契约（Codex-C2）按设计生效。唯一不准的是 R1 的 continue 假阴性，根因在指标设计（发现 #2）非 core 逻辑 bug。
