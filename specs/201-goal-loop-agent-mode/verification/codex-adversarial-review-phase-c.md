# Codex 对抗审查 — Implement Phase C（F201 goal_loop 编排散文）

审查对象：Phase C（T021~T027：feature SKILL.md goal_loop 编排散文 + verify.md JSON 模式 + golden-text）
审查时间：2026-06-20
累计：初版 **1 CRITICAL + 5 WARNING** → 修复 → 终审（C1/W1/W2/W3/W4 闭合，剩 W5 test-infra）→ 主线程直接修 W5。

## 初版 CRITICAL

| ID | 发现 | 处置 |
|----|------|------|
| C1 | escalate_full 可能无限递归（forced full 后若 verify 子代理返回非 full 报告，decideStop 再返回 escalate_full，散文无终止保护）| **fixed（三层防护）**：(1) core 不变量——decideStop 对 verify_mode==='full' 达标报告只能返回 REACHED_GOAL，物理上无 full→escalate 路径；(2) 散文 forced-full 后校验 curReportFull.verify_mode==='full'，否则 infra-failure 转 GATE_VERIFY；(3) 散文硬约束"escalate 不可递归"——重 decide 仍 escalate_full→契约错误→infra-failure 转 GATE_VERIFY。补 core 测：full 报告永不返回 escalate_full（跨 round/prevReports 组合）|

## WARNING

| ID | 发现 | 处置 |
|----|------|------|
| W1 | prevReports 计入规则冲突（rollback"不计入" vs forced full"无条件计入"）| fixed — 单一权威规则：仅 action=continue 追加；其余分支一律不追加 |
| W2 | plan-rollback CLI 自身退出码（非法 ref core 抛错）未检查 | fixed — 散文先查 plan-rollback CLI 退出码，非零→rollbackResult={success:false}→ROLLBACK_FAILED |
| W3 | formatIterationLogEntry 无 CLI 子命令，散文"调 core"不可执行 | fixed — goal-loop-cli.mjs 新增 `format-iteration-log-entry` 子命令；散文改调它；补集成测试 |
| W4 | golden-text 偏宽（多数仅 includes 一词）| fixed — 新增精确断言：必需 CLI 全集 + decide-stop 五字段 + select-verify-mode aboutToExit + post-full 非递归 + plan-rollback 退出码路径 |
| W5 | 锁测试 mkdtemp 在只读沙箱 EPERM（环境，非逻辑）| **二次 fixed**——首修引入 TEST_TMPDIR 但未确保父目录存在（TEST_TMPDIR 指非存在路径→ENOENT）；主线程加 `fs.mkdirSync(TMP_ROOT,{recursive:true})`，实测 TEST_TMPDIR=非存在嵌套目录下 92 pass |

## INFO

- I1 decide-stop payload 五字段散文↔CLI 一致；I2 decideStop 返回集合被散文 a-f 完整覆盖无多余；I3 dispatch 注释收窄（其他 agent_mode 交回原分派）；I4 .codex wrapper 同步 validate-wrapper-sources pass。

## 验证（W5 二次修复后）

- `node --test goal-loop-core.test.mjs`：**92 pass / 0 fail**
- `TEST_TMPDIR=/tmp/非存在嵌套 node --test ...`：**92 pass**（复现 Codex 场景已修）
- `npm run test:plugins`：**185 pass / 0 fail**
- `npm run build` / `repo:check` / `release:check`：零失败
- `get-phases feature`：implement 仍 single（base 不回归，opt-in 默认 off）

## 结论

1 CRITICAL（escalate 无限递归，三层防护堵死）+ 5 WARNING 全闭合。Phase C 可提交。escalate_full 端到端 smoke→full 升级链在散文落地且有非递归硬约束。
