# Codex 对抗审查 — Tasks 阶段（F201 goal_loop）

审查对象：`specs/201-goal-loop-agent-mode/tasks.md`
审查时间：2026-06-20
结论分档：CRITICAL 4 / WARNING 5 / INFO 4
主线程核验：C-01~C-04、W-01 均与 plan/spec 比对确认属实。

## 处置状态（tasks 修订后）

| ID | 级别 | 发现 | 处置 | 落点 |
|----|------|------|------|------|
| C-01 | CRITICAL | `decideStop` 优先级判 regression 但入参无 regression、无 detectRegression 调用 | closed — T017 写死契约：decideStop **内部自调 detectRegression(prevReports[last], report)**，入参不变，可单测 | T017、plan §1.1 |
| C-02 | CRITICAL | CLI 接口 T018(位置参数/单 status) 与 T022(options/复杂入参) 不相容 | closed — T018 统一契约：复杂入参一律单 JSON payload 文件；新增 parse-report 子命令；T022 按同契约调 | T018 |
| C-03 | CRITICAL | T024 测 `injectSpectraImpact` 但无任何 task 定义（GL-02 复发）| closed — 改为纯函数 `interpretImpactResult(mcpResult)`（core #11），T011 红 + T016 绿；编排器发起 MCP 调用、把结果喂该纯函数 | T016、T024→T019 注、plan §1.1 |
| C-04 | CRITICAL | T011 import 崩 ≠ 红；T012 实现不让 assert.fail 变绿，TDD 不可执行 | closed — T011 先建**全函数空桩骨架**（import 可解析）+ 写**真实失败断言**（桩返 undefined→真红）；T012~T017 逐函数转绿 | T011、T012 |
| W-01 | WARNING | max_tool_invocations 取子代理内部 tool 数不可得 | closed — 重定义为**编排器可见委派/调用数**（best-effort 粗粒度安全网）；主预算用 max_verify_seconds（timeout 强制可校验）；T-GL-20 测 infra-failure→NO_PROGRESS | tasks GL-09、plan §2 config |
| W-02 | WARNING | T023(verify.md)、T007 依赖过紧拖慢并行 | closed — T023 与 T022 解耦标 [P]（schema 已定不必等散文）| T023 |
| W-03 | WARNING | FR 覆盖表把 core 测试 T-GL-05~13 错归 T007 | closed — 覆盖表重建：T-GL-05~17/19~21 标"红@T011/绿@实现 task"，T007 仅 T-GL-01~04/15 | FR 覆盖表 |
| W-04 | WARNING | FR-019 结构化迭代日志无机器测试 | closed — 新增纯函数 `formatIterationLogEntry`（core #12，内嵌 JSON 围栏）+ T-GL-21 测可解析 | T024、T011 |
| W-05 | WARNING | max_verify_seconds 超限→infra-failure 路径无测试 | closed — 新增 T-GL-20 测 decideStop 对 infra-failure 连续 N 轮→NO_PROGRESS | T011/T017 |
| I-01 | INFO | planRollback 双分支覆盖（原假设不成立，已有 T-GL-12b/19）| 采纳 — 实测比较完整命令序列与顺序，非仅 includes | T015 |
| I-02 | INFO | Codex 每 phase 制品落点齐全 | 采纳 — 补可机器校验：制品存在 + CRITICAL 全 closed | T009/T020/T028 |
| I-03 | INFO | T-GL-03 逐字段等价（原假设不成立）| 保持逐字段断言 | T007 |
| I-04 | INFO | 部分验收是文本质量检查 | 采纳 — 诚实标注 golden-text + Codex review + e2e，不宣称单测充分 | T002/T005/T022/T023/T025 |

## 关键演进

core 纯函数 10 → **12**（+interpretImpactResult 取代不可测的 injectSpectraImpact；+formatIterationLogEntry 让 FR-019 可测）。TDD 顺序修正为"全桩骨架→真实红断言→逐函数绿"。CLI 契约单 JSON payload 统一。decideStop 内部自调 detectRegression。max_tool_invocations 降为编排器可见 best-effort。

## 第二轮 + 第三轮 tight 确认（2026-06-20）

修订引入若干一致性碎片，经两轮 tight 确认逐一清除：

| 项 | 问题 | 处置 |
|----|------|------|
| C-04 | 空桩 return undefined → 断言 TypeError 非干净红 | closed — 改 **throw NotImplemented**（node:test 捕获为干净失败）|
| C-03 | injectSpectraImpact 残留实际依赖 | closed — 仅剩"已替换"说明性引用，无依赖 |
| C-02 | T022 调 classify-report 但 T018 是 parse-report | closed — 全文统一 parse-report（grep classify-report = 0）|
| 计数 | core 数 10/11/12 三处不一 | closed — 全文统一 **12 个纯函数**（grep 残留 = 0）|
| Phase | formatIterationLogEntry 实现落 Phase C 与"core 全 Phase B"矛盾 | closed — 实现移 T017（Phase B）；T024 改 Phase C 接线/e2e 校验（T-GL-21b），FR 覆盖表同步 |

第三轮 tight 终审：5 项全闭合，Codex 明确"**可进入 implement**"。累计 tasks 阶段 Codex：初版 4C/5W + 二轮 3C/2W + 三轮 0（全闭合）。

## 残留（诚实）

- 散文编排（T022）质量、真实 git/MCP、迭代日志写盘属 e2e（verify 阶段），单测不覆盖——已诚实标注。
- max_tool_invocations 为粗粒度安全网（编排器可见计数），非精确计量。
- core 12 纯函数 100% 单测；I/O（文件锁）集成测试；LLM 编排 e2e 兜底。三层边界诚实分明。
