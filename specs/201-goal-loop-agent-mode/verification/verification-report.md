# Feature 201 — goal_loop agent_mode 验证报告

**验证日期**：2026-06-20
**分支**：claude/affectionate-swartz-2b4111（基线 7958567 = origin/master）
**commits**：4fecaa9（Phase A）/ d1b91a2（Phase B）/ eeb19e8（Phase C）

---

## Layer 2 — 原生工具链（实跑退出码）

| 命令 | 退出码 | 摘要 |
|------|--------|------|
| `npm run build` | 0 | tsc 零类型错误；postbuild stamp=eeb19e8 |
| `npx vitest run` | 0 | **4895 passed / 0 failed**（427 files，~36s） |
| `npm run test:plugins` | 0 | **185 passed / 0 failed**（goal-loop-core 92 + 现有 93） |
| `npm run repo:check` | 0 | 57 项全 pass |
| `npm run release:check` | 0 | Release contract valid |

> 注：macOS 无 `timeout`/`gtimeout`，工具链验证正常完成无需超时保护。

## Layer 1 — Spec-Code 对齐

- **FR 覆盖：23/23 = 100%**（逐条对照 tasks FR 覆盖表，每条有实现文件 + 测试 ID）
- **Layer 1.5 证据**：COMPLIANT（三阶段 Codex 审查均有实跑命令 + 退出码记录，无推测性表述）
- **不回归（Layer 1.8）**：`get-phases feature` → implement.agent_mode=single（base 未启用 goal_loop）；现有 8 mode + batch_loop 无改动；vitest 4895 全通
- **文档一致（Layer 1.9）**：.codex mirror 经 codex-skills.sh 同步（repo:check delegation-contract pass）；verify.md 新增 goal_loop JSON 输出模式段

## opt-in 演示（实跑）

- **默认 off**：`get-phases feature` → implement=single
- **启用**：golden 模板放 temp 项目 `.specify/orchestration-overrides.yaml`，`effective-orchestration feature --annotate --project-root <temp>` → implement=goal_loop（来源 overrides），其余 phase 与 base 等价；其他 mode implement 仍 single。temp 已清理，未污染 worktree。

## CLI 端到端（fixtures 实跑）

| 场景 | 结果 |
|------|------|
| `parse-report report-pass-full.json` | {report} 正确解析 |
| `decide-stop`（full 达标 + round=5/max=5） | REACHED_GOAL |
| `decide-stop`（smoke 达标） | **escalate_full（非 REACHED_GOAL，C2 验证）** |
| `parse-report report-invalid-json.txt` | degraded infra-failure |
| `plan-snapshot false` / `plan-rollback`（40-hex ref） | 正确 git 命令序列 |

## Success Criteria — 诚实评估

| SC | 评估 | 说明 |
|----|------|------|
| SC-001 自主迭代红→绿 + 人工 gate | ⚠️ **部分** | 机制可用（opt-in 实测）、12 core 纯函数逻辑正确（92 单测）、散文完整（golden-text 守护）、escalate 三层防护落地；**但"完整自治闭环红→绿真实跑通"需一次真实 feature-mode 启用 override 的 spec-driver run，本次未执行**——散文是 LLM 解释层，单测覆盖 core 不等于编排器真实执行正确。不 over-claim。 |
| SC-002 max_iterations / 无进展 fallback | ⚠️ 部分 | core 单测已证（T-GL-06/07/20）；编排级真实触发待 e2e |
| SC-003 regression git 回滚 | ⚠️ 部分 | core 命令规划单测已证（T-GL-12/12b/19）；真实 git 执行 + 工作区还原待 e2e |
| SC-004 未配 override 8 mode 不变 | ✅ **完全** | get-phases feature=single；vitest 4895 全通 |
| SC-005 工具链零失败 | ✅ **完全** | 5 命令退出码全 0 |
| SC-006 Codex 审查 CRITICAL 全修 | ✅ **完全** | 6 制品齐全；spec 5C+5N / plan 6C / tasks 7C / Phase A 0C / Phase B 4C / Phase C 1C 全 closed |

## 诚实边界（不 over-claim）

SC-001/002/003 的"真实 spec-driver feature run 中 goal_loop 自治迭代闭环跑通"**不在本次验收执行**。这是 goal_loop 作为散文驱动 LLM 编排层的固有验证局限——散文正确性依赖 LLM 解释，无法靠单测完全替代。**建议交付后在受控红任务上做一次真实 feature-mode + goal_loop override 端到端运行做后验证收口（人工 GATE_VERIFY 兜底）。** reward hacking / 测试过拟合 / 长程局部最优仍为诚实残留风险（FR-023），依赖人工 gate + Layer 1.5 + Codex 对抗审查兜底，**未声称"全自动安全"**。

## Dogfooding 四维度反馈

本需求收尾按 dogfooding-policy 回收一手反馈：

1. **MCP 是否可用**：Spectra MCP `impact` 工具**可用（live 响应）**，但**图谱 stale**——对新建符号 `goal-loop-core.mjs::decideStop` 查询返回 `symbol-not-found`，fuzzyMatches 指向无关的旧 spec bundle。即 live MCP graph 是早于本 feature 的旧编译产物（与 [project_live_mcp_server_is_global_stale_build] 一致）。
2. **建图链路 friction**：尝试 `spectra batch --mode graph-only`（F195 秒级建图）失败——**worktree 全局 spectra CLI 是 pre-F195 stale build**（help 只有 `full|reading|code-only`，无 `graph-only`）；退化用 `code-only` 建图挂起 >55s 无产物、最终被杀（exit 144），印证 [project_spectra_cli_volta_blocker]。dev-mode tsx 是已知绕法但本次未深入（非交付阻塞）。
3. **对 FR-011/012 设计的实证价值（重要产品洞察）**：上述两点共同证明 **goal_loop 的 Spectra impact 注入（FR-011）在实践中会高频命中 FR-012 降级路径**——因为 (a) loop 迭代的是刚改动的新代码，预建图谱不含；(b) 缺 graph-only 快速刷新时图谱持续 stale。单测的降级（T-GL-17 graph-not-built→skipped+warning）使这"安全"，但 TDAD 协同（结构化 impact 上下文压低回归 6%→10%）的**价值依赖图谱新鲜度**：若 goal_loop 不在 loop 起点刷新图谱（graph-only），注入的 impact 会失真或缺失，协同收益打折。→ **后续 Feature 候选**：goal_loop 每轮 implement 前用 graph-only 增量刷新图谱，使 impact 注入对"本轮改动"有效。
4. **Spec Driver 流程顺畅度 / 准确性**：spec-driver 编排五阶段（spec→plan→tasks→implement→verify）+ 每 phase Codex 对抗审查闭环顺畅，gate 拍板清晰；tasks.md 的 FR 覆盖表 + TDD 红绿分层 + CLI 子命令逐字对齐让实现零返工。一处摩擦：tasks 早期写"`npx vitest run` 验证 T-GL-*"不精确（plugin mjs 实为 `node --test`），已在 Phase A 暴露并修正门禁（C4：ci.yml 独立 gate）。

## 结论

✅ **机制层 READY**：声明层 / 12 core 纯函数 / 编排散文 / 工具链 / Codex CRITICAL 全闭合。
⚠️ **e2e 后验证待补**：SC-001/002/003 的真实自治闭环跑通需一次受控 feature-mode + goal_loop override 端到端运行。
