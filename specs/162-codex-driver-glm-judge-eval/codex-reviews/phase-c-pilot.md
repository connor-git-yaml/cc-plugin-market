# Codex 对抗审查 — Phase C Pilot 27 实测 + §10.x 报告填入

> Feature: 162
> Reviewed at: 2026-05-14
> Subagent: codex:codex-rescue
> Final status: ✅ 2 轮 review 收敛到 0 critical / 0 warning（W-4 clone 脚本幂等校验留 follow-up，不阻塞交付）

## 审查轮次

| 轮次 | Critical | Warning | Info | 阻断 commit |
|------|---------:|--------:|-----:|------------|
| iter-1 | 0 | 4 | 1 | 是（建议本 phase 修） |
| iter-2 | 0 | 1（W-4 clone 幂等）| 0 | 否（W-4 留 follow-up） |

## iter-1 finding 处置（4W + 1I）

| 编号 | 主题 | 处置 |
|-----|------|------|
| W-1 | §10.5.5 缺 error.phase 分布（plan iter-4 W-10 要求）| 修：§10.5.5 加 error.phase 分布表 (prepareWorktree 9 / driver 0 / oracle 0 / jury 0 / other 0) + 100% 集中在 prepareWorktree 是 spec design gap 触发非代码漏洞 |
| W-2 | spec-push "反而退化" 措辞偏实（n=18 小样本过度推论）| 修：§10.4 "初步结论" 改 "初步观察"，明确 "不构成统计显著"，弱化为 SWE-L003 单 fixture 局部信号；解释假设标 "待全量验证" |
| W-3 | Feature 158 §3 B cohort wall TBD 占位（147 已有 6.8 min）| 修：§3.2 SWE-L001/L003/L005-B 三行 wall 填 ~408k (avg of 6.8 min × 60000) |
| W-4 | clone-swe-bench-upstream.sh 幂等校验过弱（仅检目录存在）| **deferred-to-follow-up**：pilot 27 实测已成功用此脚本 clone (528MB total)，幂等弱不阻塞当前交付；记 commit message + 后续 Feature 调优时校验 .git/remote/startCommit reachability |
| I-1 | FR-037 枚举 / C deferred / 授权基本一致 | 接受 + 补 "非代码 bug，属启动前置 spec gap" 说明（已在 §10.5 + §10.4 加） |

## iter-2 残留 finding 处置

仅 W-4（clone 幂等校验）残留，**deferred-to-follow-up**：
- pilot 27 实测已用此脚本成功 clone（pytest 51M + astropy 235M + sympy 242M）
- 当前用例下"目录存在 = clone 成功"假设成立（无中断残留）
- 改进留 Feature 163+：校验 `.git/remote` reachability + `startCommit` 在 history

## 最终结论

- **critical 清零** + **warning 仅 W-4 deferred 非阻塞**
- 主线程裁决：**Phase C Pilot 27 partial 交付 ready commit + ready push master deliverable**

## Pilot 27 实测核心 deliverable

### Pass Rate（pilot 3 fixture × A+B，n=18）

| Cohort | Pass | Total | Rate |
|--------|----:|----:|----:|
| A (bare) | 3 | 9 | 33.3% |
| B (spec-push) | 1 | 9 | 11.1% |
| C (mcp-pull) | - | 0/9 | DEFERRED |

### Phase 0 fix 间接验证

| inheritance_status | Count |
|-------------------|----:|
| available | 18 (A+B) — Phase 0 fix 在 spawn env subAgentMeta 注入成功 |
| unavailable | 0 |
| unknown | 9 (C deferred) |

### 全量 450 投影 → 用户授权决策

- wall clock 45.8h（~2 calendar day 连跑 / 1-2 calendar week 分批）
- cost $75（超 spec ~$15 预算 5x）
- **必须用户明确授权才推 T052**（spec FR-038 + CLAUDE.local.md）

### Spec / Plan 落地的 design gap（pilot 后发现，需 Feature 163+ 修）

设计阶段未声明但实际硬前置：
1. `bash scripts/baselines/clone-swe-bench-upstream.sh`（pytest+astropy+sympy 528MB）
2. `npm run build`（dist/cli/index.js for cohort C MCP server）
3. `claude plugin update spec-driver` + 重启 IDE（plugin 4.1.0 cache 加载）

应补入 spec FR-030 启动前置 + plan §0.4 分批策略。

## SC-004 当前满足度

| 子项 | 状态 |
|------|:----:|
| Pilot 27 跑批 | ⚠️ 18/27 success（A+B 100%，C 0/9 deferred）|
| §10.1 实验设计更新 N=15/450 | ✅ |
| §10.2 Pass Rate 矩阵 partial | ⚠️ pilot 18 填入 / 全量 450 deferred |
| §10.3 Token Cost 实测 | ⚠️ pilot $4.50 填入 / 全量 $75 投影 |
| §10.4 战略结论 partial | ⚠️ pilot 观察 + 假设 + 待全量验证 |
| §10.5 sub-agent MCP 影响验证 | ⚠️ A+B 间接验证 / C 真实 mcp call 待重跑 |
| Feature 158 detail 同步 | ✅ §3.1/3.2/3.3 partial 填入 |

**SC-004 accept-with-deferred**：pilot scope 完整落地；全量 450 + Group C 重跑作为 follow-up（spec 设计预留状态）。
