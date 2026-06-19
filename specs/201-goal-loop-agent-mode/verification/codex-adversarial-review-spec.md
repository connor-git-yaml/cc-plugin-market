# Codex 对抗审查 — Spec 阶段（F201 goal_loop）

审查对象：`specs/201-goal-loop-agent-mode/spec.md`
审查时间：2026-06-19
结论分档：CRITICAL 5 / WARNING 9 / INFO 5
主线程核验：C-01/C-02/C-03/C-04/W-05 已 Read 源码确认属实。

## CRITICAL

| ID | 发现 | 主线程核验 | 处置 |
|----|------|-----------|------|
| C-01 | `pilot mode` 非合法 mode 枚举，CLI 对未知 mode exit 1 | 确认（schema 仅 8 reserved mode） | 锁定 pilot 为现有 mode；见决策 |
| C-02 | 非 feature 模式运行时不消费 YAML phases，overrides 改 fix/refactor 的 agent_mode **不生效** | **确认**（orchestration-overrides-contract.yaml `runtime_consumption_caveat`：runtime_consuming_modes 仅 feature；affected_modes: fix/story/implement/refactor/resume） | **重大设计修正** → 见决策 D1 |
| C-03 | "复用 F191 注入 hook" 是 over-claim；F191 = kb-prequery.mjs scaffold-kb 预查，与 Spectra impact 无关 | 确认（记忆 + 源码：F191 是 KB 预查注入，非通用 impact hook） | 改为 goal_loop 专用 impact 注入接口；或降级为后续 Feature |
| C-04 | metric 混淆 Layer 1 与 Layer 1.5；COMPLIANT/PARTIAL 实为 Layer 1.5 状态；PARTIAL 算达标 = reward-hacking 通道 | **确认**（verify.md：Layer1 输出 ✅/❌/⚠️；COMPLIANT/PARTIAL 是 Layer1.5） | 重定义 metric：P1 FR 100% + Layer1.5 全 COMPLIANT + Layer2 全 PASS；PARTIAL → 人工 gate 不自动收敛 |
| C-05 | 循环伪码先检查停止再回滚（顺序错）；"本轮 implement 开始前 git 状态" 在未 commit 场景未定义 | 确认（逻辑自证 + NFR-002 仅"若有"记 hash） | 定义轮次 snapshot 机制；优先级：回滚失败 > regression 回滚 > 达标 > 预算/无进展 |

## WARNING（择要）

- W-01：batch_loop "完全平行" 过强 → batch_loop 是人工干预暂停，非 metric 驱动自主重试；改"沿用声明性标签+SKILL 手写循环形态"
- W-02：GATE_IMPLEMENT_MID 现状 on_failure/non_critical，列为核心护栏失真 → goal_loop 需在 override 显式改 always/critical 或不列为核心护栏
- W-03：EC↔FR traceability 漂移（EC-05/EC-06/EC-07 FR 引用错位）→ 重建 EC↔FR / US↔FR 矩阵
- W-04：无进展 delta 仅追踪测试数，遗漏 Layer1.5/P1 覆盖率 → delta 改五维向量（Layer2/P1覆盖/证据/回归数/改动量）
- W-05：verify 工具未装=跳过不阻断，SKIPPED 可被误算达标 → metric 区分 PASS/FAIL/SKIPPED/UNKNOWN；SKIPPED/UNKNOWN 不满足自动达标
- W-06：每轮 verify 无成本预算（命令 300s timeout）→ 加 max_verify_seconds / max_tool_invocations / smoke-vs-full 分层 / infra-failure 早停
- W-07：并发安全弱 → 新增 FR：同 worktree/feature_dir 单实例锁 + run_id 原子日志
- W-08：modes.<mode> 整段替换不继承 base，用户只复制 implement phase 会丢其他 phase → 提供 golden override 模板 + validate 测试
- W-09：FR-016 "查 commit message" 不可机器校验 → 产出 `verification/codex-adversarial-review-*.md` 制品（本文件即遵循此建议）

## INFO

- I-01：agent_mode enum 改动点真实（schema:115-122）；注意同步 error message 文案
- I-02：GATE_VERIFY always/critical 现状成立，建议加回归测试锁字段
- I-03：对照行号大体准确，建议改行号范围降漂移
- I-04：spec 未 over-claim "全自动安全"，残留风险诚实声明存在（但需配合 C-04/W-05 修复 metric 漏洞）
- I-05：plan 阶段需定义 goal_loop 消费的 verification-report 字段格式（不靠自然语言解析）

## 用户决策（已拍板 2026-06-20）

- **D1**：pilot = **feature mode 的 implement 阶段**（唯一运行时消费 YAML phases 的 mode）；opt-in 经 `orchestration-overrides.yaml` `modes.feature` 整段替换。非 feature mode 的 goal_loop 留 Out of Scope。
- **D2**：Spectra impact 注入 **MVP 内做**，新建 goal_loop 专用接口（调 MCP `impact`），不复用 F191。

## 处置状态（spec 修订后，2026-06-20）

| ID | 处置 | 落点 FR |
|----|------|---------|
| C-01 | closed — pilot 锁定 feature，不引入新 mode | §设计约束、FR-002 |
| C-02 | closed — goal_loop 仅作用 feature；非 feature 留 OOS | §设计约束、Out of Scope #1 |
| C-03 | closed — 删除 F191 复用，新建专用 impact 接口 | FR-011、US-5 |
| C-04 | closed — metric 重定义：Layer2 全 PASS + P1 FR 100% + Layer1.5 COMPLIANT；PARTIAL 不自动收敛 | FR-008、FR-009 |
| C-05 | closed — 轮次 snapshot + 优先级排序 + 伪码顺序修正 | FR-003、FR-004、FR-013 |
| W-01 | closed — 改"沿用实现形态"，标注语义差异 | §设计约束 |
| W-02 | closed — 标注 GATE_IMPLEMENT_MID 默认 non_critical，需显式升级 | FR-023、EC-07 |
| W-03 | closed — EC↔FR 矩阵重建 | Edge Cases 表 |
| W-04 | closed — delta 五维向量 | FR-006 |
| W-05 | closed — PASS/FAIL/SKIPPED/UNKNOWN 四级，SKIPPED/UNKNOWN 不自动达标 | FR-009 |
| W-06 | closed — max_verify_seconds / max_tool_invocations / infra-failure 早停 | FR-007 |
| W-07 | closed — 单实例锁 + run_id 原子日志 | FR-018 |
| W-08 | closed — golden override 模板 + 校验测试 | FR-016 |
| W-09 | closed — 产出 codex-adversarial-review-*.md 制品（本文件） | FR-022 |
| I-01 | 采纳 — enum error_map 文案同步 | FR-001 |
| I-02 | 采纳 — GATE_VERIFY 字段回归测试锁 | FR-021 |
| I-03 | 采纳 — 关联文档改行号范围 | 关联文档 |
| I-04 | 确认 — 残留风险诚实声明保留并强化 | FR-023、EC-07 |
| I-05 | closed — 结构化 verification-report 契约，不靠 NL 解析 | FR-010 |

## 第二轮 Codex 复审（confirmation pass，2026-06-20）

原 5 CRITICAL 经复审**全部确认闭合**。复审新增 5 项，处置如下：

| ID | 级别 | 发现 | 处置 | 落点 FR |
|----|------|------|------|---------|
| N-01 | CRITICAL | reward-hacking 残口：达标信任 report 字段，未定义 provenance/防污染 | closed（部分残留诚实声明）— FR-010 加职责分离：report 由独立 verify 子代理实跑捕获退出码产出、implement 不得自报；缺退出码→UNKNOWN。残留的"implement 篡改测试"由 FR-023+人工 gate 兜底，不 over-claim | FR-010、FR-023、EC-07 |
| N-02 | WARNING | 达标与 max_iterations 同轮 exit reason 冲突 | closed — FR-004 加"同轮冲突规则"（达标优先），FR-005 wording 对齐 | FR-004、FR-005 |
| N-03 | WARNING | opt-in 运行时分派机制未定义（C-02 复发点） | closed — FR-002 明确 feature 编排器运行时逐 phase 读 agent_mode 分派、新增 goal_loop 分支，feature 是唯一运行时消费 phases 的 mode | FR-002 |
| N-04 | WARNING | golden override 整段替换的 base drift 维护负担未标注 | closed — FR-016 加 version 字段 + 复用 version-mismatch 诊断 + 诚实标注单源化留后续 | FR-016 |
| N-05 | INFO | FR 交叉引用编号再次漂移 | closed — US/FR-003/FR-004 内所有交叉引用编号已逐处校正 | 全文 |

结论：CRITICAL 0 项遗留，可进入 plan 阶段。残留风险（implement 篡改测试 = 测试过拟合）已诚实记录为不可消除项，依赖人工 GATE_VERIFY + Codex 对抗审查兜底。
