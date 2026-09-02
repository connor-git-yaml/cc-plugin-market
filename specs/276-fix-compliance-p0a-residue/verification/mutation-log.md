# 变异实验日志 — F276 卡 C（Phase C1 + C2）

> 逐条**实跑**记录（不接受「应该会红」的推演）。harness：`/tmp/f276-mut/run-mutations.py`——
> 每条变异施加前校验锚点唯一命中、施加后实跑 `node --test`、结束后**逐字节还原并二次校验 sha256**。
> **精确口径**：`M-1..M-12` 中**实际存在的 10 条**在**工作树**上逐条施加并跑，全部跑完后工作树三个源文件
> sha256 与变异前一致（`M-5` / `M-9` 已随 plan 修订撤回、从未跑过，**编号不重排**，见下表两行说明）；
> `M-13` / `M-14` 是计划外补充，在 **`/tmp` 副本**上施加与实跑，**不进**工作树的 sha256 还原校验。
>
> 记录口径：只列**本卡新增/改写**用例与被牵连的既有合同钉的**实际变红用例名**。

| # | 变异 | plan §6 点名 | 实际变红用例 |
|---|---|---|---|
| M-1 | `!saved.ok` 改回直接 releaseDegraded（还原缺陷） | E-a | `state-storage-unavailable → 首次即 exit 2（token stderr）+ 审计事件含 state-storage-unavailable`<br>`存储不可用 → 不推迟（维持不了计数就不能开推迟通道，方向 fail-closed）`<br>`F256 R2 · 在途推迟必须有界且只对「在途工作关得掉的缺口」生效`<br>`E-a 两级不可写 ⟹ 第 1/2 次 exit 2（token stderr + 三条补救口），第 3 次经反馈计数降级放行`<br>`E-a 附：阻断分支的审计事件 blockCount 为 null（预算不可知）且 degraded:false`<br>`E-b assistant 侧写入同一 token ×3 ⟹ 不计数，第 3 次仍 exit 2`<br>`E-b′ skill 展开条目（首块 Base directory for this skill: 起头）正文含 token ×3 ⟹ 第 3 次仍 exit 2`<br>`E-i fix 展开**之前**的 2 条历史反馈条目不得喂饱计数器 ⟹ 首次 Stop 仍 exit 2`<br>`E-j `.specify/runs` 不可写 + tmpdir 占位 ⟹ 退出码序列仍 2,2,0，且终态/审计条数皆为 0（不崩）`<br>`E-m 合规 reset + 重新展开 fix 后，第 1 次 Stop 仍 exit 2（不因会话前半段已攒够 2 条反馈而秒放行）`<br>`E-n 两级不可写但会话合规 ⟹ exit 0、stderr 为空、全文不含 token（合规用户不得被 brick）` |
| M-2 | 计数器去掉 `role === 'user'` 条件 | E-b | `U-2 assistant 角色即便正文含 token 也不计（反伪造：被判方产出面不得投喂计数器）`<br>`E-b assistant 侧写入同一 token ×3 ⟹ 不计数，第 3 次仍 exit 2` |
| M-3 | `>= BLOCK_LIMIT` 改 `> BLOCK_LIMIT` | E-a | `E-a 两级不可写 ⟹ 第 1/2 次 exit 2（token stderr + 三条补救口），第 3 次经反馈计数降级放行`<br>`E-j `.specify/runs` 不可写 + tmpdir 占位 ⟹ 退出码序列仍 2,2,0，且终态/审计条数皆为 0（不崩）`<br>`E-m 合规 reset + 重新展开 fix 后，第 1 次 Stop 仍 exit 2（不因会话前半段已攒够 2 条反馈而秒放行）` |
| M-4 | 删 `startsWith(HOOK_FEEDBACK_PREFIX)` 条件 | E-b′ / P-2 / U-3 | `P-2 四条真实条目：命中 1 / 排除 3（显式基线 -1）`<br>`U-2 首行不是 Stop hook feedback: 但正文含 token → 不计`<br>`U-3 skill 展开条目（首块以 Base directory for this skill: 起头）正文含 token → 计 0`<br>`E-b′ skill 展开条目（首块 Base directory for this skill: 起头）正文含 token ×3 ⟹ 第 3 次仍 exit 2` |
| M-5 | *(已撤回，未跑)* — 随 plan 修订 **R4-1** 撤回：该修订删去 `storage-unavailable-entry-budget-exhausted` 与 420 条目兜底，本条要杀的分支已不存在 | — | —（编号刻意保留不重排，以免与 plan 修订记录对不上号）|
| M-6 | 计数器去掉 `lineIndex > baseline` | E-i | `U-1 lineIndex <= baseline 的条目不计（窗口下界是 latestFixLineIndex）`<br>`E-i fix 展开**之前**的 2 条历史反馈条目不得喂饱计数器 ⟹ 首次 Stop 仍 exit 2`<br>`E-m 合规 reset + 重新展开 fix 后，第 1 次 Stop 仍 exit 2（不因会话前半段已攒够 2 条反馈而秒放行）` |
| M-7 | stderr 首行去掉 token（保留原因行） | E-a | `state-storage-unavailable → 首次即 exit 2（token stderr）+ 审计事件含 state-storage-unavailable`<br>`存储不可用 → 不推迟（维持不了计数就不能开推迟通道，方向 fail-closed）`<br>`F256 R2 · 在途推迟必须有界且只对「在途工作关得掉的缺口」生效`<br>`E-a 两级不可写 ⟹ 第 1/2 次 exit 2（token stderr + 三条补救口），第 3 次经反馈计数降级放行`<br>`E-j `.specify/runs` 不可写 + tmpdir 占位 ⟹ 退出码序列仍 2,2,0，且终态/审计条数皆为 0（不崩）`<br>`E-m 合规 reset + 重新展开 fix 后，第 1 次 Stop 仍 exit 2（不因会话前半段已攒够 2 条反馈而秒放行）`<br>`E-n 两级不可写但会话合规 ⟹ exit 0、stderr 为空、全文不含 token（合规用户不得被 brick）` |
| M-8' | errno 白名单前置放行分支还原（三码明文） | E-p | `E-p judge/core/io 三文件（剔除注释行后）不得出现 ENOSPC / EDQUOT / EROFS 任一字面量` |
| M-9 | *(已撤回，未跑)* — 随 plan 修订 **R5-13** 撤回：其守护点 **E-l**（`ln -s /` 造两级 `EROFS`）依赖 macOS 密封系统卷、在 Linux CI 上守护力为零而被删，errno 放行分支的守护改由 **M-8' + E-p** 源码守卫承担 | — | —（同上，编号不重排）|
| M-10 | 上界命中后不 push 该诊断码 | E-a | `E-a 两级不可写 ⟹ 第 1/2 次 exit 2（token stderr + 三条补救口），第 3 次经反馈计数降级放行`<br>`E-g 合同同步：storage-unavailable-block-budget-exhausted 已登记 ∧ judge 源码含该字面量；撤回码不得回流` |
| M-11 | 窗口基线改回 `earliestFixLineIndex` | E-m | `E-m 合规 reset + 重新展开 fix 后，第 1 次 Stop 仍 exit 2（不因会话前半段已攒够 2 条反馈而秒放行）` |
| M-12 | 基线缺席 `return 0` 改回 `-1` 全量计数 | U-7 | `U-7 基线缺席（null/undefined/非数字）→ 一律返回 0，不是 -1 全量计数` |
| M-13 *(计划外新增)* | 撤掉 `renderPathSegment`，`err.path` 原样进渲染 | 无（本条来自 C1 绕过面对抗审查 WARNING-1） | `E-q 路径段含换行不得在 stderr 里长出伪造行（err.path 是唯一内容形态不受约束的自由段）` |
| M-14 *(计划外新增)* | 删掉 `routeBlock` 第 5 参的默认值与 fail-closed 归一（还原成解构无默认值） | 无（本条来自 C1+C2 实现期对抗审查 IW-1） | `E-r routeBlock 漏传第 5 参 ⟹ 仍 exit 2（顶层 catch 不得把"忘传"兜成放行）` |

## 计划外新增

- **M-13 / E-q** 不在 plan §6 的 10 条清单里，来自 **C1 绕过面异构对抗审查 WARNING-1**：
  `@ <err.path>` 逐字进单行渲染，路径里一个换行即可长出一整行伪造文本（实测可冒充
  `GATE_DEGRADED_PREFIX_LINE`）。该段当前只来自 `projectRoot` 与启动快照 env、被判方在会话内够不到，
  故 E-q 钉的是「路径永远不含控制字符」这个此前**无任何守卫**的隐含前提，不是在关一条已可达的口。

- **M-14 / E-r** 同样不在 plan §6 清单里，来自 **C1+C2 实现期对抗审查 IW-1**：`routeBlock` 第 5 参
  原先刻意无默认值（照搬 F238「required 化让忘传即炸」纪律），但本调用链上 `main` 的顶层是
  `catch { return 0 }`（FR-013 fail-open）——**忘传抛出的 TypeError 会被它兜成 exit 0 静默完全绕过**，
  纪律的方向在这里正好是反的。改为默认 `{}` + 非有限数按 0 记（fail-closed）。

  **实跑结果**（/tmp 副本 `scratchpad/m14/`，只跑 `--test-name-pattern="E-r routeBlock"`）：
  施加变异 ⟹ E-r 变红，断言消息实得 `status=0`（正是 IW-1 描述的静默放行）；
  把 judge 还原成工作树版本后重跑 ⟹ E-r 转绿。变异只在副本上做，工作树源文件全程未被改动。

## 关键结论（承重点的**唯一性**已实证）

- **M-11**（窗口基线 `latestFixLineIndex` → `earliestFixLineIndex`）**只杀死 E-m 一条**——
  E-a / E-i 都是单段会话，earliest 与 latest 取值相同，两者都抓不到。
  这实证了 plan §6 的判断：**E-m 是 M-11 的唯一守护点**，不可因"看起来和 E-a 重复"而删。
- **M-8'**（errno 白名单前置放行分支还原，三码明文）**只杀死 E-p 一条**——E-a 用目录/文件占位
  实跑得 `mkdir EEXIST` / `mkdir ENOTDIR`，不命中白名单分支，行为面完全抓不到。
  E-p（源码守卫）是该变异当前唯一的、且平台无关 / CI 恒执行的守护点。
- **M-12**（基线缺席 `return 0` → `-1` 全量计数）**只杀死 U-7 一条**。该分支当前生产不可达，
  U-7 是前瞻钉；若因"当前不可达"删掉它，方向合同即无守护。
- **M-4**（删 `startsWith` 条件）杀死 **E-b′ + P-2 + U-3 + U-2** 四条——诱饵形态（非 `spec-driver-*`
  的真实 skill 展开）选对了：若诱饵含 `spec-driver-fix`，`latestFixLineIndex` 会被推到诱饵之后
  ⟹ 窗口自塌、计数恒 0 ⟹ 删条件也照绿（假绿）。
- **M-10**（上界命中后不 push 诊断码）除 E-a 外还被 **E-g**（schema 双向守卫的"judge 源码须含该字面量"
  半边）兜住——登记面与产出面同时有守护。

## 变异方法论坑（复现者注意）

`entry.role !== 'user'` 在 `fix-compliance-core.mjs` 里出现**两次**（`detectFixSkillExpansion` 与本计数器）。
用无 `/g` 的整文件替换会打偏到前一个函数上，得到「全绿 ⟹ 变异存活」的**假结论**。
本 harness 用「锚点必须唯一命中，否则跳过并报错」规避（`before.count(old) != 1` 即拒绝执行）。

