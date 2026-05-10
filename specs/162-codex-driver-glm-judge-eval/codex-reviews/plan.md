# Codex 对抗审查 — Phase: plan

> Feature: 162
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ 4 轮 review 收敛到 0 critical / 0 warning，进入 tasks phase

## 审查轮次概要

| 轮次 | Critical 起 | Warning 起 | Critical 终 | Warning 终 | 阻断 commit |
|------|------------|------------|-------------|-----------|------------|
| iter-1 | 4 | 4 | 4（修后 → iter-2） | 4 | 是 |
| iter-2 | 0（C-1~C-4 全清） | 3（W-1/2/3 修，新发 1 critical + 3 warning） | 1 | 3 | 是 |
| iter-3 | 1（C-5 全清） | 3（全清，新发 3 warning） | 0 | 3 | 是 |
| iter-4 | 0 | 0（W-8/W-9/W-10 全清） | 0 | 0 | 否 |

## iter-1 finding 处置（4C+4W）

| 编号 | 主题 | 修复位置 |
|-----|------|---------|
| C-1 | callExecutor 兼容签名 | §2.1.2 thin wrapper + §2.1.9 / §2.5.1 调用全改对象参数 |
| C-2 | normalize 顺序 + Haiku alias | §2.1.7 toLowerCase 在剥 prefix 之前；§2.1.8 alias 表补 Haiku 4.5/4.7、Sonnet 4.6 dot/hyphen 变体；§2.2.3 5 case 含 `Codex:GPT-5.5` 大小写归一 |
| C-3 | quota lock 串行化 LLM | §1.2 数据流重画 + §2.3.3 reserveQuota 短锁 + LLM spawn 在锁外 |
| C-4 | inheritance_status 数据来源 + 3 状态 | §0.5（spec FR-037 修订文本）+ §2.4.5 subAgentMeta schema + §2.6.2 三态判定 + §2.6.5 异常分析 |
| W-1 | partial run ABA | §0.2 + §2.3.6 三分类 + §2.3.8 ABA 防护 case |
| W-2 | retry matrix vitest 缺 | §2.1.6 RM-1~RM-4 + dispatcher case 8→12 |
| W-3 | B 隐式串行 | §3 / §7 milestone 拆 B1（与 A 并行）+ B2（A 后） |
| W-4 | fixture 偏斜 | §0.1 frozen 5 ids + 每类型 ≤2 |

## iter-2 残留 + 新发现处置

| 编号 | 主题 | 修复位置 |
|-----|------|---------|
| C-5 | subAgentMeta 双轨优先级 | §2.4.5 mergeSubAgentMeta 算法（self-report > env） + collectIssues + confidence 状态机 |
| W-5 | spawn 失败 stale partial 永久积累 | §2.3.3 catch 兜底写 finalized_at + status:failed + §2.3.6 升级四分类（含 failedFinalized） |
| W-6 | quota-fork-helper 缺 child script | §2.3.8 子脚本路径 + argv 接口 + IPC stdout schema |
| W-7 | const meta scope ReferenceError | §2.3.6 改 let meta = null 提到 try 外 |

## iter-3 新发现处置

| 编号 | 主题 | 修复位置 |
|-----|------|---------|
| W-8 | mergeSubAgentMeta 字段级 fallback 缺 | §2.4.5 改字段级（specDriverVersion / frontmatterTools / loadSource 各自 self ?? env）+ confidence 含 `mixed` |
| W-9 | 兜底写盘失败二级防御 | §2.3.3 nested try-catch + 双 console.error + rethrow originalError + §6.7 风险新条目 |
| W-10 | §10.5 failedFinalized 落点缺 | §2.6.5 新增 §10.5.5 跑批失败统计表 + 5% 阈值 + error.phase 分布分析 |

## 最终结论

- **critical 清零**（iter-4 后 0 critical）
- **warning 清零**（iter-4 后 0 warning）
- **info 全部接受或修复**
- 主线程裁决：**plan 阶段 ready for tasks phase**

## 关键架构决策（implement / verify 阶段须遵守）

通过对抗审查倒逼出的 plan-level 决策（写入 plan.md 多处）：

1. **callExecutor 兼容层**：保留旧签名 `({ model, prompt, baseURL, apiKey })` 作为 thin wrapper，内部 delegate 到 callBackend
2. **normalize 顺序**：`trim → toLowerCase → strip backend prefix → strip vendor prefix → alias 映射`，先 case-fold 再剥前缀
3. **quota lock 短锁**：lock 持有期 < 10ms（仅 reservation），LLM spawn / await 在锁外，450 runs 配额预留累计 < 5s
4. **subAgentMeta 优先级**：self-report > env-injected；字段级 fallback；confidence 三态（self-report-only / mixed / env-only）
5. **catch 兜底 nested**：原 error 始终 rethrow，不被 fallback 写盘失败掩盖
6. **partial 四分类**：finalized / partialRunning / partialStale / failedFinalized
7. **failedFinalized 不归 partial**：写入 `finalized_at + status: failed + error.phase`，跑批续跑时不阻塞
8. **5 fixture frozen**：SWE-L001 / L003 / L005 / L007 / L009，每类型 ≤2，不允许临时随机选取

## spec.md 同步修订

plan iter-2 §0.5 给出的 FR-037 修订文本已由主编排器 Edit 写入 spec.md（2 状态 → 3 状态：available / unavailable / unknown）。

## Vitest case 数

- v1 (iter-1): 21 case
- v2 (iter-2): 26 case（含 retry matrix RM-1~RM-4）
- v3 (iter-3): 27 case（新增 PC-T5 finally 兜底验证）
- v4 (iter-4): 27 case（W-8/9/10 仅扩规约/伪码，不增 case）
