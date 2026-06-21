# 问题修复报告 — F203 goal_loop core 两处缺陷

> 来源：F202 goal_loop e2e pilot 实测（非猜测，有真实复现）。详见 F202 verification-report.md「goal_loop 遥测」节发现 #1/#2。
> 模式：spec-driver-fix（4 阶段）。每 phase commit 前跑 codex 对抗审查（CLAUDE.local.md 约定）。

## 问题描述

goal_loop（Feature 201）agent_mode 闭环在 F202 e2e pilot 中暴露两处 core 缺陷：

1. **snapshot/rollback 误删未跟踪 config**：`plugins/spec-driver/scripts/lib/goal-loop-core.mjs` 的 `planSnapshotCommands` / `planRollbackCommands` 生成的 `git stash push --include-untracked` 与 `git clean -fd` 会卷走 / 删除未跟踪且未 gitignore 的 `.specify/orchestration-overrides.yaml`（goal_loop 验证态 override，刻意不入 commit）→ 循环中途 goal_loop 配置自毁。
2. **smoke 指标假阴性**：smoke 轮（round < max_iterations）跑全量 `npx vitest run` 但**不先 build**，全量套件含 build 依赖 e2e（需 `dist/`），未构建 worktree 必失败。`evaluateMetric` 要求全量 layer2 命令全 PASS → 永不达标 → `decideStop` 恒判 continue/escalate 不到 → 即便改动 100% 正确也无法 REACHED_GOAL，空转到 NO_PROGRESS / MAX_ITERATIONS。

## 5-Why 根因追溯

### 缺陷 1：snapshot/rollback 误删未跟踪 config

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何 goal_loop 跑到一半 `.specify/orchestration-overrides.yaml` 消失？ | `planSnapshotCommands(false)` 第一条命令 `git stash push --include-untracked` 把它 stash 走；`planRollbackCommands` 的 `git clean -fd` 把它删除 |
| Why 2 | 为何 stash/clean 会动这个文件？ | 它未跟踪（untracked）且未被 .gitignore 覆盖；`--include-untracked` 全量纳入 untracked，`git clean -fd` 删除全部 untracked（非 -x，但该文件本就不在 gitignore） |
| Why 3 | 为何命令规划没排除它？ | snapshot/rollback 设计目标是"全量捕获 / 还原工作树可变状态"，把 goal_loop 自身**运行态配置**也当成了可变工作状态，未区分"应被快照的实现产物" vs "应跨快照保留的循环配置" |
| Why 4 | 为何这个假设不成立？ | goal_loop 验证态约定刻意把 override 留作 untracked（不入 commit），它是**循环的输入/配置**而非"本轮改动产物"；快照/回滚的语义对象应只是"本轮 implement 的代码改动"，配置必须恒定存活整个循环 |
| Why 5 | 为何未被现有机制捕获？ | core 纯函数单测只断言命令字面值序列（T-GL-19 / T-GL-12b deepEqual），从未在真实 git 工作树跑 stash/clean 验证副作用；e2e pilot（F202）才首次在真实 worktree 触发 |

**Root Cause（缺陷 1）**：snapshot/rollback 命令规划把 goal_loop 自身运行态配置（典型 `.specify/orchestration-overrides.yaml`）误并入"工作树可变状态"，对其执行 stash/clean，未做 pathspec 排除。

**Root Cause Chain**：override 文件中途消失 → stash --include-untracked 卷走 + clean -fd 删除 → 命令未排除该路径 → 把"循环配置"误当"本轮改动产物" → 单测只校验字面值、无真实 git 副作用验证。

### 缺陷 2：smoke 指标假阴性

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何改动正确却拿不到 REACHED_GOAL？ | smoke 轮 `evaluateMetric(report)` 恒为 false → `decideStop` 走不到 escalate_full（优先级 3 的 smoke 分支），只能 continue，最终 NO_PROGRESS / MAX_ITERATIONS |
| Why 2 | 为何 smoke 轮 evaluateMetric 恒 false？ | smoke 的 `npx vitest run` exit≠0 → 该 layer2 命令非 PASS → `every(PASS)` 为 false（条件 1 不满足） |
| Why 3 | 为何 smoke 的 vitest 失败？ | smoke 模式（SKILL.md:367）只跑 `tsc --noEmit + npx vitest run`，**不先 `npm run build`**；但全量套件含 build 依赖 e2e（如 tests/e2e/feature-170a-*.e2e.test.ts 需 `dist/`），未构建 worktree 里这些 e2e 失败 |
| Why 4 | 为何这种预存失败会污染达标判定？ | `evaluateMetric` 的 layer2 判据是"全量命令绝对 PASS"，不区分"本次改动引入的失败（regression）" vs "与改动无关的预存失败"；verify 子代理已正确产出 `regression_check.regression_detected=false`，但 core decide-stop 不消费该层信息，且 smoke 报告把无法运行的 e2e 记为 FAIL 而非 SKIPPED |
| Why 5 | 为何未被现有机制捕获？ | smoke↔full 分桶逻辑（W1）只解决 regression 误判，未解决"达标判据被预存噪声永久阻塞"；core 单测 fixture（report-smoke-pass.json）都是干净全绿，从未覆盖"smoke 全量 vitest 含预存 e2e 失败"场景 |

**Root Cause（缺陷 2）**：smoke 轮用"全量 layer2 绝对 PASS"作达标判据，但 smoke 不先 build 又跑含 build 依赖 e2e 的全量套件，预存失败把 smoke 永久钉死在未达标；而权威的 full 轮（先 build，判定本就准确）因 smoke 永不 escalate 而永远到不了。

**Root Cause Chain**：改动正确却 NO_PROGRESS → smoke evaluateMetric 恒 false → smoke vitest 失败 → smoke 不 build 却跑 build 依赖 e2e → 达标判据"全 PASS"不区分预存失败 vs regression、e2e 被记 FAIL 而非 SKIPPED → 无对应 fixture/单测覆盖。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| plugins/spec-driver/scripts/lib/goal-loop-core.mjs | `planSnapshotCommands` (L300-312) | `git stash push --include-untracked` 无 pathspec 排除 | 对 PRESERVED_CONFIG_PATHSPECS 加 `-- . ':(exclude)...'` |
| plugins/spec-driver/scripts/lib/goal-loop-core.mjs | `planRollbackCommands` (L319-336) | `git clean -fd` 无排除 | clean 加 `-e <path>`；stash apply 路径无需改（snapshot 已不捕获该文件） |
| plugins/spec-driver/scripts/lib/goal-loop-core.mjs | `evaluateMetric` (L41-60) / `decideStop` 优先级 3 (L171-176) | smoke 达标判据=全量 PASS | 保留 full 严格判据；新增 smoke escalate 触发判据（放宽） |
| plugins/spec-driver/agents/verify.md | goal_loop JSON 输出模式段 | smoke 把无法跑的 build 依赖 e2e 记 FAIL | 指示 smoke 缺 dist 时标 SKIPPED（skipped_reason=`dist_not_built`），其余套件正常跑 |
| plugins/spec-driver/skills/spec-driver-feature/SKILL.md | 步骤 4/5 smoke/full 注释 (L363-391) | full 是否先 build 于 vitest 不明确 | 明确 full 先 `npm run build` 再 `npx vitest run`；smoke 跳过 build 依赖 e2e |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| goal-loop-core.mjs | `detectRegression` (L68-91) | 同模式分桶比较 | [安全] 已正确，无需改；smoke escalate 放宽不影响其 regression 检测 |
| goal-loop-core.mjs | escalate 非递归不变量 C1 (L166-176) | escalate_full 仅 verify_mode!=full 返回 | [安全] 重构 decideStop 优先级 3 时**必须保持**该不变量（escalate 仅在 smoke 分支） |
| goal-loop-core.mjs | 空 layer2 vacuous-truth 防护 C3 (L47-49) | 空命令集不得达标 | [需保持] smoke 放宽判据须同样防 vacuous（要求 ≥1 非 SKIPPED PASS 命令） |

### 同步更新清单

- 调用方：`goal-loop-cli.mjs`（decide-stop / plan-snapshot / plan-rollback 子命令）——若新增导出函数需在 CLI dispatch 暴露；decideStop 返回 schema 不变（stop/exit_reason/action），CLI 无需改
- 测试：`plugins/spec-driver/tests/goal-loop-core.test.mjs` —— planSnapshot/planRollback deepEqual 用例需更新含排除项；新增 smoke escalate 放宽用例 + SKIPPED 不阻塞用例 + vacuous 防护用例；新增 fixture（smoke 报告含 SKIPPED e2e + 含预存 FAIL）
- 文档：verify.md（SKIPPED 约定）、SKILL.md（smoke/full build 次序）；docs:sync / repo:check 守护一致性
- 类型定义：N/A（.mjs 纯 JS）

## 修复策略

### 缺陷 1（pathspec 排除 + 未跟踪范围 preflight 守护）

**保护范围（Codex CRITICAL 修订）**：本修复保护 goal_loop 约定的**未跟踪（untracked）** preserved config（`.specify/orchestration-overrides.yaml` 正是此类——实测 not-tracked & not-gitignored）。pathspec 排除只挡 stash 与 clean，**挡不住** rollback 的 `git reset --hard HEAD`——若该 config 被 staged 或 tracked-modified，`reset --hard` 仍会摧毁它（Codex /tmp 实测：staged X 经 reset --hard 丢失、new-staged X 被删）。故原报告"恒定存活"结论**收窄为仅 untracked 场景**，staged/tracked 场景另加 preflight 守护。

`planSnapshotCommands` / `planRollbackCommands` 引入模块级常量 `PRESERVED_CONFIG_PATHSPECS = ['.specify/orchestration-overrides.yaml']`（可扩展数组），生成命令时：
- snapshot：`git stash push --include-untracked -m "goal_loop-S{i}" -- . ':(exclude).specify/orchestration-overrides.yaml'`
- rollback：`git clean -fd -e '.specify/orchestration-overrides.yaml'`
- **多 preserved path 必须展开为多个独立 argv**（stash 多个 `':(exclude)<p>'`、clean 多个 `-e <p>`），**禁止** join 成单字符串

**preflight 守护（新增，闭合 staged 边界）**：新增纯函数 `assessPreservedConfigSafety(entries)`——entries 由编排器 `git status --porcelain <preserved paths>` 提供每路径状态（`absent|untracked|tracked-clean|tracked-modified|staged`），返回 `{ safe, unsafe:[{path,state,reason}] }`。规则：`untracked`/`absent`/`tracked-clean` → 安全；`staged`/`tracked-modified` → **不安全**。编排器进入快照前调用：不安全则**硬失败 + 清晰指引**（"preserved config X 处于 staged/已修改态，goal_loop 期望其 untracked；中止防数据丢失"），绝不静默继续。core 仍纯函数（仅判定），git I/O 在编排器。

效果：untracked preserved config 在 stash/clean/apply 全程不被触碰，存活整循环；staged/tracked-modified 态被 preflight 提前拦截，不被 reset --hard 静默摧毁。

### 缺陷 2（方案 A，已采用 — 用户拍板「组合：core 放宽 + 源头 SKIPPED」）

**core 放宽（a 的安全精化版）**：
- `evaluateMetric`（权威 full 门禁）**保持严格不变**：全量 layer2 PASS + p1 100% + COMPLIANT。full 轮先 build，build 依赖 e2e 能真跑过，故严格判据准确（REACHED_GOAL 仍可信）。
- 新增 `evaluateSmokeReadiness(report)`（仅决定 smoke→escalate_full 触发，非权威）：
  - p1_coverage_pct === 100 ∧ layer1_5 COMPLIANT
  - ∧ 所有**非 SKIPPED** layer2 命令为 PASS（SKIPPED 的 build 依赖 e2e 不阻塞）
  - ∧ 至少 1 条非 SKIPPED 命令（vacuous-truth 防护，承袭 C3）
- 重构 `decideStop` 优先级 3：full 报告 → `evaluateMetric` → REACHED_GOAL；smoke 报告 → `evaluateSmokeReadiness` → escalate_full。**严格保持 C1 escalate 非递归不变量**（escalate 仅 smoke 分支返回，full 永不返回）。

**源头 SKIPPED + full 契约修正（c，含 Codex CRITICAL）**：
- **full 轮必须显式 `npm run build` → `npx vitest run`（含 e2e）→ lint → repo:check**（Codex CRITICAL #3）：当前契约（SKILL.md:367-368、verify.md:260）的 full = `npm run build + lint + repo:check`，**不含 vitest** → smoke 跳过 e2e 后 escalate 到的 full 同样不跑 e2e → 可全 PASS 直达 REACHED_GOAL 而测试从未权威跑过。**这是本修复成立的前提**：full 先 build（dist 就位）再跑全量 vitest（含被 smoke 跳过的 e2e），使严格门禁真正权威。（注：report-full-pass.json fixture 本就含 vitest，本改动是让 prose 契约与 fixture 一致。）
- verify.md goal_loop schema：smoke 模式检测 `dist/` 缺失时，对 build 依赖 e2e（`tests/e2e/**` 项目）标 `skipped_reason="dist_not_built"`（SKIPPED）而非 FAIL——**必须真正用 vitest project selector 排除 e2e 实跑其余**（如 `--project unit --project integration ...` 或排除 `e2e` project），其余命令记真实 exit_code，不得只口头标 SKIPPED（Codex омission #5）。
- **full 轮若仍出现 `dist_not_built` SKIPPED**（full 应已 build，出现即契约违反）→ 标 infra-failure，不当普通 continue（Codex omission #7），堵死"full 也能带 SKIPPED 蒙混"的隐性路径。

**安全论证（修订后，依赖 full 真跑 vitest）**：
1. 权威达标（REACHED_GOAL）只在 full 轮、用严格 `evaluateMetric`（全量 PASS、SKIPPED 即不达标）判定；**前提是 full 真正 `npm run build` 后跑 `npx vitest run`（含 e2e）**——dist 就位故无 build 依赖 SKIPPED，判据全绿且权威。无此前提则论证悬空（Codex CRITICAL #3 已修订）。
2. smoke 放宽只影响"是否值得升级 full 复核"的非权威触发；即便 smoke 被 SKIPPED 钻空，full 真跑全量 vitest 会兜住，无 reward-hacking 收益。
3. core 仍**不消费** `report.regression_check` 字段（承袭 SKILL.md:399-400「职责分离」）；smoke 放宽用 core 自有信息（p1/COMPLIANT/non-skipped PASS）+ decideStop 优先级 2 已用 core 自算 `detectRegression` 拦截 regression。
4. vacuous 防护（≥1 非 SKIPPED PASS）阻断"全 SKIPPED 假达标"。
5. escalate 抖动有界（Codex WARNING #4）：smoke escalate→full fail→continue 由 max_iterations / NO_PROGRESS 兜底，**前提是编排器按 SKILL.md:442-443 正确把 escalate 后的 curReportFull 追加进 prevReports**（否则 NO_PROGRESS 证据链断），实现/验证须守护此点。

### 方案 B（备选，未采用）

仅源头修正（smoke 先 build，b）：保持"全绿"严格判据。被否原因：smoke 每轮 build 显著变慢（违背快速反馈定位），且 core 不改、"配套测试"难落在 plugins/spec-driver/scripts（本次明确要求改 core + 测试）。

## Spec 影响

- 需要更新的 spec：F201 spec（specs/201-goal-loop-agent-mode/）—— 缺陷 2 涉及 FR-007（verify 模式）/ FR-008（达标判据）的语义澄清（smoke escalate 放宽判据 + SKIPPED 约定），应在该 spec 追加 fix 说明或在本 fix 的 plan.md 记录契约变更；缺陷 1 涉及 FR-013（snapshot/rollback）的 pathspec 排除补充。具体由 plan.md 收敛，避免改动 F201 已交付 spec 的既有 FR 编号。
- 本 fix 自身制品：specs/203-fix-goal-loop-snapshot-smoke/{fix-report,plan,tasks}.md + verification/verification-report.md。

## 范围评估

受影响文件：core 1（goal-loop-core.mjs）+ 测试 2（goal-loop-core.test.mjs + 新增 snapshot/rollback 真实 git 集成测试）+ fixtures 若干 + prose 2（verify.md / SKILL.md）≈ 5-6 文件 / 2 模块（goal_loop core + goal_loop 编排 prose）。**未超 fix 模式阈值（>10 文件 / >3 模块）**，继续 fix 模式。

## Codex 对抗审查修订（Phase 1 诊断）

总体结论：**需修订**（方向成立，论证有 2 处硬缺口已在上文修正）。处置：2 CRITICAL 均为真实设计缺陷，已并入修复策略；4 WARNING 转为实现/验证约束。

| 档 | 发现 | 处置 |
|----|------|------|
| CRITICAL | 缺陷1 只覆盖 untracked；staged/tracked-modified X 被 rollback `reset --hard` 摧毁，"恒定存活"过宽 | 已修订：范围收窄 untracked + 新增 `assessPreservedConfigSafety` preflight 硬失败守护 |
| CRITICAL | 缺陷2 "full 兜底"依赖 full 跑 vitest，但当前 full 契约（SKILL.md:367-368/verify.md:260）= build+lint+repo:check **不含 vitest** → 测试从未权威跑 | 已修订：full 必须显式 `npm run build`→`npx vitest run`（含 e2e）；列为修复成立前提 |
| WARNING | escalate 抖动有 max_iterations/NO_PROGRESS 兜底，但依赖编排器正确追加 curReportFull 到 prevReports（SKILL.md:442-443） | 实现/验证守护：不破坏现有 prevReports 追加规则 |
| WARNING | 重构 decideStop 优先级 3 易破坏 C1 非递归（full 报告误入 escalate 分支） | `evaluateSmokeReadiness` 必须在 `verify_mode==='smoke'` 分支内调用；加 C1 回归测试 |
| WARNING | over-claim：F202 实际靠"轮间人工 npm run build"收敛，非 SKIPPED+放宽策略自然收敛 | 已在上文标注；本修复让该收敛自动化、不再依赖人工介入 |
| INFO | git 主路径命令（stash `:(exclude)` + clean `-e`）实测成立，多参数形式正确（须逐项独立 argv） | 已并入实现约束 |

**Codex 列出的"plan/实现必须补上"清单（全部纳入 plan.md / tasks.md）**：
1. 明确 preserved config 保护范围 = untracked-only + staged preflight 硬失败 ✅（已并入策略）
2. 新增 snapshot/rollback **真实 git 集成测试**：untracked X / tracked-staged X / new-staged X / isClean=true / 多 preserved paths / stash apply --index / clean -e 多参
3. command builder 多 preserved path 展开为多独立 argv，禁止 join 单字符串
4. full verify 命令集显式含 `npm run build` 后的 `npx vitest run`
5. smoke "跳过 dist 依赖 e2e" 用真实 vitest project selector 排除并实跑其余（非口头 SKIPPED）
6. `evaluateSmokeReadiness` 单测：全 SKIPPED 不 escalate / 非 SKIPPED FAIL 不 escalate / ≥1 PASS 才 escalate / full+SKIPPED 永不 REACHED_GOAL / full 永不 escalate（C1）
7. full 轮出现 `dist_not_built`/SKIPPED → 视为 infra-failure（verify 契约违反），非普通 continue
