# Codex 对抗审查 — Plan 阶段（F201 goal_loop）

审查对象：`specs/201-goal-loop-agent-mode/plan.md`
审查时间：2026-06-20
结论分档：CRITICAL 2 / WARNING 5 / INFO 2
主线程核验：GL-01（snapshot）、GL-02（测试脱节）、GL-03（verify JSON）、GL-08（config-schema 存在）均已 Read 源码确认。

## 处置状态（plan 修订后）

| ID | 级别 | 发现 | 处置 | 落点 |
|----|------|------|------|------|
| GL-01 | CRITICAL | `git stash create`+`git checkout -- .` 不含/不删 untracked，回滚不干净，违反 FR-013/SC-003 | closed — 改 `git stash push -u` + `git reset --hard` + **受控清理本轮新增路径**（非盲 git clean）+ `git stash apply --index`；回滚命令由 core `planRollbackCommands()` 规划并单测（T-GL-12/19）| §2 OQ-02、§1.1 |
| GL-02 | CRITICAL | 18 单测在测散文里不存在的决策模块（自欺） | closed — **确定性逻辑下沉可执行 core `goal-loop-core.mjs`**（7 纯函数），测试直接 import 真实函数；散文只编排。明示 single-source 测试边界（单测 vs e2e）| §1.1、§7、新增文件 #3/#4 |
| GL-03 | WARNING | verify.md 现产 Markdown，靠 prompt 注入稳定产 JSON 过度乐观、无解析失败降级 | closed — 改 verify.md 加 goal_loop JSON 输出模式（#6）；core `parseReport()` 解析失败→infra-failure+UNKNOWN，不静默达标 | §verification-report、§7 T-GL-11 |
| GL-04 | WARNING | smoke 跳过 build 致类型错误潜伏；smoke/full 命令集不同污染 regression | closed — smoke 改含 build/typecheck；regression 按 verify_mode 分桶同 mode 比较（core），T-GL-12 加用例 | §2 OQ-03 |
| GL-05 | WARNING | GATE_IMPLEMENT_MID 与 FR-023 对齐说明不足 | closed — §1.2 明写 golden 模板不计入它为护栏、若列入须升级 always/critical | §1.2 |
| GL-06 | WARNING | FR-017 既推迟又进测试矩阵，自相矛盾 | closed — FR-017 纳入 MVP（core decideDispatch，成本低），删除推迟说法 | §10 |
| GL-07 | WARNING | golden override base drift 风险低估 | closed — 新增 §9.6；version 字段 + version-mismatch 诊断 + T-GL-03 逐字段等价 CI 守护 | §9.6、§7 T-GL-03/04 |
| GL-08 | INFO | config-schema.mjs 路径标"待查"但已存在 | closed — 确认 457 行存在，填实 reality check | §3 |
| GL-09 | INFO | max_tool_invocations 在 prose-only 计数不清 | 采纳 — 由 verify report 记录 invocation 计数，core 读取判定；tasks 阶段细化 | §2 配置项（待 tasks 细化）|

## 关键架构演进（本轮最重要）

初版"全部逻辑在 SKILL.md 散文"→ 修订"薄散文编排 + 可执行可测 core `goal-loop-core.mjs`"。这同时闭合 GL-01（回滚命令规划可测）与 GL-02（测试测真实代码），并把 LLM 解释风险从"解释复杂停止/回滚逻辑"降到"何时调哪个 core 命令 + 何时委派"。core 仅 7 纯函数，无框架，不构成 over-engineer。

## 残留（诚实）

- 散文编排层的 LLM 解释、真实 git 执行、MCP 调用、迭代日志写盘属集成层，单测不覆盖 → verify 阶段 e2e（红→绿有界任务）兜底。
- reward hacking 的"篡改测试本身"不可消除 → FR-023 + 人工 GATE_VERIFY + Codex 对抗审查。
- GL-09 计数细节留 tasks 阶段。

## 第二轮 Codex 复审（confirmation pass，2026-06-20）

GL-01/GL-02 方向确认但发现修订引入/遗漏的二级缺陷，已再修：

| ID | 级别 | 发现 | 处置 | 落点 |
|----|------|------|------|------|
| CL-01 | CRITICAL | "受控清理只删本轮新增"漏还原"本轮修改的既有 untracked"；启动前脏工作区语义未定义 | closed — 核心洞察：`stash push -u` 已捕获**全部** untracked（含既有），故回滚用 `reset --hard + clean -fd + stash apply --index` 全量还原即正确；明确定义启动前脏状态为基线 | §2 OQ-02 |
| CL-02 | CRITICAL | 干净工作区 `stash push -u` 不产 entry，紧接 `rev-parse stash@{0}` 会误取旧 stash | closed — `git status --porcelain` 空 → CLEAN 锚点(HEAD)，不 rev-parse；非空才 push+rev-parse | §2 OQ-02、T-GL-19 |
| CL-03 | CRITICAL | T-GL-14/16/18 引用 `decideDispatch`/`selectVerifyMode`/`acquireLock` 不在 core 清单；lock 非纯函数却称 100% 纯函数覆盖 | closed — core 清单补 decideDispatch/selectVerifyMode/detectRegression；lock 明列为 I/O 边界助手（temp-dir 集成测试，非纯函数）；测试边界诚实分层 | §1.1、§7 |
| WL-01 | WARNING | parseReport 列纯函数却写日志（隐藏 I/O） | closed — parseReport 纯函数仅返回结果/降级标记，日志由编排器写 | §1.1 |
| WL-02 | WARNING | T-GL-12 把 smoke↔full 分桶挂 planRollbackCommands（错函数）| closed — 分桶逻辑归 detectRegression；T-GL-12 测 detectRegression，T-GL-12b 测 planRollbackCommands | §7 |
| WL-03 | WARNING | smoke 每轮 full build 与快速反馈冲突 | closed — smoke 用 `tsc --noEmit`（秒级类型检查）而非 full build；full build 留末轮 | §2 OQ-03 |
| WL-04 | WARNING | spec OQ-02/03 仍含相反决策源 | closed — spec OQ-02/03 标"已由 plan 解决"并写入最终选型 | spec.md OQ |
| WL-05 | WARNING | rollback 触发条件 spec(任一 FAIL)↔plan(仅 regression) 不一致 | closed — 统一为 **regression-only**：预期红（未转绿）不回滚；spec US-1 场景2 + EC-03 改齐 | spec.md US-1/EC-03、plan §6 |
| WL-06 | WARNING | T-GL-17 用 parseReport 测 MCP 降级（错） | closed — T-GL-17 重列为集成测试（mock MCP impact 降级），不归 parseReport | §7 |

第二轮结论：3 CRITICAL（CL-01/02/03）+ 6 WARNING 全闭合。snapshot 机制改为"全量捕获+全量清理+全量还原"语义正确；core 函数清单完整且纯/IO 边界诚实分层；test↔function 映射对齐。

## 第三轮 Codex tight 终审（2026-06-20）

只核 snapshot 正确性 + 函数/测试完整性。A-1/A-3/A-4 确认 OK（既有 untracked 捕获还原对称、index 恢复对称、多轮 stash ref 不互扰）。剩余 4 项已修：

| ID | 级别 | 发现 | 处置 |
|----|------|------|------|
| A-2 | CRITICAL | `git clean -fd` 对嵌套 git/submodule/空目录无保护说明 | closed — 标注：不带 `-x` 保 .gitignore；单 `-f` git 拒删嵌套仓库；本仓库**无 .gitmodules 已实查确认**；空 untracked 目录不还原列为诚实已知限制（低影响，重建留后续）|
| B-1 | WARNING | §7 import 清单/文件清单残留 7 函数与 §1.1 的 10 不一致 | closed — §7 intro + 文件清单 #3 全统一为 10 纯函数 |
| B-2 | WARNING | "T-GL-05~14/16~19" 把 T-GL-17/18 误纳纯 core 覆盖 | closed — 纯函数范围改 T-GL-05~16+19；T-GL-17/18 明列 I/O 集成；§9.1/§12 Phase B/C 同步 |
| B-3 | WARNING | §verification-report 残留 parseReport"写入 iteration-log" | closed — 改为 parseReport 返回降级标记、编排器写日志 |

第三轮结论：snapshot 正确性 + core/测试完整性 + 纯/IO 诚实分层全部闭合，**可进入 tasks**。累计 plan 阶段 Codex：初版 2C/5W + 二轮 3C/6W + 三轮 1C/3W，全闭合。
