# Codex 对抗审查 — Implement Phase B（F201 goal_loop 确定性 core）

审查对象：Phase B 实现（T011~T020：goal-loop-core.mjs 12 纯函数 + goal-loop-cli.mjs + 测试）
审查时间：2026-06-20
累计：初版 **4 CRITICAL + 4 WARNING** → 修复 → 复审（C1/C3/W1/W2/W4 闭合，发现 TTL 误接管 + CI 短路）→ 终修。

## 初版 4 CRITICAL（均真 bug，含假绿/死逻辑）

| ID | 发现 | 处置 |
|----|------|------|
| C1 | no-progress fallback 被 LOC churn 永久绕过（每轮改代码→d5≠0→hasProgress 恒 true→NO_PROGRESS 永不触发，死逻辑）。**主线程预先发现，Codex 实跑确认** | **fixed** — `hasProgress` 改为只看 metric 改善方向 `d1>0\|\|d2>0\|\|d3>0\|\|d4<0`，d5(churn) 仅日志。补测：连续 N 轮 metric 平 + net_loc≠0 → NO_PROGRESS |
| C2 | smoke 全绿被直接判 REACHED_GOAL（跳过 build/lint/repo:check，假绿）| **fixed** — REACHED_GOAL 要求 verify_mode==='full'；smoke 满足→action:escalate_full（消费者在 Phase C T022 散文，已规划）。补测 smoke→escalate_full / full→REACHED_GOAL |
| C3 | 空 layer2_commands 被 `every()` vacuous-true 判达标 | **fixed** — parseReport 空→infra-failure；evaluateMetric 空→false（两处 fail-closed）。补测 |
| C4 | vitest 门禁不覆盖 plugin mjs 测试（51 + 现有全不在 npm test/CI）| **fixed** — package.json test 链 test:plugins（glob，Node v24 兼容）；**ci.yml 加独立 `if: always()` 步骤** gate mjs，不被 vitest 短路 |

## WARNING

| ID | 发现 | 处置 |
|----|------|------|
| W1 | detectRegression 取 prevReports[last] 非"上一同 mode 轮次"（full→smoke→full FAIL 漏判）| fixed — findPrevSameModeReport 从后向前找同 verify_mode、跳 degraded |
| W2 | planRollbackCommands ref 原样拼 shell（注入面）| fixed — isValidGitSha `^[0-9a-f]{40}$` 校验 |
| W3 | 文件锁无 stale 恢复（崩溃死锁）→ 修复引入 TTL 误接管活锁（超 30min 强抢，破坏单实例）| **二次 fixed** — 删除 TTL 接管；仅死 PID(ESRCH)/损坏锁/缺 pid 可接管；EPERM/存活 PID 永不接管(无论锁龄)。PID 复用罕见残留诚实标注 |
| W4 | 断言过弱（T-GL-07 未断 hasProgress、planSnapshot 用 includes）| fixed — 完整序列 deepEqual + 显式 hasProgress 断言 |

## 复审新发现（已处置）

- **escalate_full 无消费者**：Codex 报 CRITICAL，但**经核实属 Phase C（T022 散文步骤 6c）范围**，非 Phase B 缺陷——core 正确发信号，编排层消费在 Phase C。tasks.md T022:653 已规划 escalate_full→强制 full verify 重判。
- **TTL 误接管活锁**：见 W3 二次修复。
- **C4 npm test 短路**：见 C4，ci.yml 独立 step 解决。

## 残留（诚实）

- **预存 vitest dist-staleness**：CI Test step 前无 build，cli-e2e --version 依赖新 dist 可能 flaky 红。**非 F201 引入**，未擅改 CI vitest 步骤；mjs 独立 gate（if: always()）保证我们的测试不受影响。供后续决策。
- **锁 PID 复用**：死 goal_loop 的 PID 被无关进程复用 → 误判存活 → 需人工清 .lock。罕见，权衡下不引入 TTL 接管活锁的更大风险。
- escalate_full 端到端 smoke→full 升级在 Phase C 落地。

## 验证

- `node --test goal-loop-core.test.mjs`：**70 pass / 0 fail**
- `npm run test:plugins`：**163 pass / 0 fail**（goal-loop 70 + 现有 93）
- `npm run build` / `npm run repo:check`：零失败
- CLI 实跑：smoke-pass→escalate_full；死 PID stale 锁可接管、活 PID 永不接管

## 结论

初版 4 CRITICAL + 4 WARNING + 复审 2 新问题全闭合（escalate_full 正确归 Phase C）。Phase B 可提交。
