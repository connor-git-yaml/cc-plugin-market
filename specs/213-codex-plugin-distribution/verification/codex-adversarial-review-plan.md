# Codex 对抗审查归档 — Plan 阶段（Feature 213）

- **审查对象**: `specs/213-codex-plugin-distribution/plan.md`（初版 476 行，7 项设计决策）
- **审查模型**: gpt-5.6-sol（codex-companion rescue 通道，PATH 前缀指向 0.145.0-alpha.18）
- **日期**: 2026-07-20
- **执行状态**: 部分完成（诚实标注）——编排器收割轮询的 stall 窗口（7.5 min 无 progress 事件即取消）设置过紧，在审查最终组稿前约 1 分钟误触发取消。**已从 job log 完整回收 4 项实锤 CRITICAL**（审查者自述"已实锤四个会阻断 tasks 的问题…正在做最后的 FR/SC 对照"）。教训已记 trace：末事件为 assistant message（组稿期）时应放宽 stall 窗口。

## 审查发现与处置（4 CRITICAL，全部修复）

| # | 级别 | 发现 | 核实 | 处置 |
|---|------|------|------|------|
| C1 | CRITICAL | E2E 全局状态泄漏：`codex plugin marketplace add <worktree路径>` 注册进全局 `~/.codex`，afterAll 只有 `plugin remove` 缺 `marketplace remove`；且注册路径指向 worktree（删除后悬空） | 与编排器独立自查交叉印证 | ✅ §3.5 重写：mkdtemp fixture 副本作 marketplace 源 + 测试专属随机 market 名 + try/finally 逆序完整清理（plugin remove ×2 → marketplace remove → rm 临时目录）；§6 新增风险 4 |
| C2 | CRITICAL | wrapper 双写污染真实工作树：`tests/integration/spec-driver-codex-skills.test.ts:12-50` 以 `cwd=tempDir` 调真实脚本，`$PLUGIN_DIR` 派生自脚本位置=真实仓库 → 原设计 copy 步骤会让每次测试 `rm -rf` 重写 tracked `skills-codex/`，中断即留删除态脏树 | 与编排器独立自查交叉印证（已读测试源码确认调用方式） | ✅ §3.1 改 opt-in：`--sync-plugin-distribution` flag 仅由 repo:sync runStep 传入；普通 install/测试零触发；§3.5 补无 flag 守护用例；§7 步骤 2 同步 |
| C3 | CRITICAL | release:check 实际未接入一致性矩阵：原设计矩阵只注册进 `validateRepository()`（repo:check），release:check 只有 version expectEqual → FR-009「接入 repo:check 与 release:check」字面不满足 | 审查新发现；已读 `scripts/validate-release-contracts.mjs` 确认为极简顺序薄壳 | ✅ §3.3 新增：薄壳追加直调 `validateCodexPluginConsistency` 扁平合并输出与 exit code；§3.6 修改文件 12→13；三向对照表补 release 链断言测试条目 |
| C4 | CRITICAL | 合同 YAML 内联数组超解析器边界：`release-contract-core.mjs:3` 与 `validate-wrapper-sources.mjs:4` 均用手写 `simple-yaml.mjs`，其 `parseYamlScalar()` 只识别空 `[]`/`{}`，带元素内联数组会静默降级为字符串标量 → 依赖 `.includes()`/`.length` 的差集判定恒假 | 审查新发现；编排器复核解析器源码与两处 import 属实 | ✅ §3.3 合同示例全部改块级序列（waivers 段已重写）+ 新增显式语法约束条目 + 单测加「合同可被 simple-yaml 完整解析」守护用例 |

## 审查中断损失与补救

- 审查者被打断前提到「另有若干门禁覆盖缺口」未及展开 → 补救：plan 新增 **FR-001~013 ↔ 矩阵 check ↔ 测试 三向覆盖对照表**（§3.5），发现并补 2 处缺口（FR-009 release 链断言、FR-012 waiver 移除模拟用例），2 处候选缺口（e2e market 名一致性、manifest interface 字段）论证后明确不设 check。

## 修订执行方式（委派合同降级记录）

修订任务先后 4 次 Task 委派均遭 API 断连（2 次 resume 原 plan 代理、2 次 fresh 代理；错误信息均为 "API Error: Connection closed mid-response"，已留存 trace）。第 4 次断连前代理已落地 C2/C3/C4 主体修订（plan.md 476→545 行）；剩余 C1、三向对照表与 §3.6/§6/§7/§8 收尾由主编排器按**委派合同唯一降级通道** inline 完成（`[DEGRADED: inline-execution — plan 修订收尾 — 连续 4 次 Task API 断连]`），最终 573 行。

## 复核

- 5 项修订标记终验齐全（marketplace remove ×2 / sync-plugin-distribution ×7 / 薄壳直调 ×2 / 块级序列 ×2 / 三向对照 ×1）。
- tasks 阶段前置条件满足；4 项 CRITICAL 修订与 opt-in 机制列入 GATE_TASKS 复核清单（plan §8）。
