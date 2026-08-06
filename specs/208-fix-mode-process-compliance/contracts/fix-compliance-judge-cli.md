# 合同：`fix-compliance-judge.mjs` CLI

**新增文件**：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`
**调用方**：`plugins/spec-driver/hooks/stop-fix-compliance-check.sh`（`--mode hook`，唯一生产路径）；单测与手工 E2E spike（`--mode report`，只读辅助）

## 调用方式

```bash
# hook 模式（生产路径，唯一由 hooks.json 挂载调用）
cat <<'EOF' | node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode hook --project-root .
{"session_id":"...", "transcript_path":"...", "stop_hook_active": false}
EOF
```

## 参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `--mode <hook\|report>` | 否，默认 `hook` | `hook`：完整阻断/降级/审计落盘语义；`report`：只读判定，**始终 exit 0**，仅打印 JSON verdict 到 stdout，不写任何落盘记录，供调试/E2E spike 使用，不接入 `hooks.json` |
| `--project-root <path>` | 否，默认 `process.cwd()` | 判定所依据的项目根，`spec-driver.config.yaml` 查找与 `.specify/runs/` 落盘均相对此路径 |
| stdin | 是（`--mode hook` 时） | JSON 格式 `HookPayload`（见 data-model.md §1）；`--mode report` 时可选，缺省时接受 `--transcript-path` 参数直接指定 |
| `--transcript-path <path>` | 否 | 仅 `--mode report` 生效，跳过 stdin payload 解析，直接指定 transcript 路径（便于脚本化测试） |

## 输出与退出码（`--mode hook`）

| 场景 | 退出码 | stdout | stderr |
| ---- | ------ | ------ | ------ |
| 非 fix 会话（无展开痕迹或最新展开非 fix） | 0 | （空） | （空，零接触） |
| `enforcement=off` | 0 | （空） | （空，零接触） |
| 合规收口 | 0 | （空） | （空） |
| `enforcement=warn` 且不合规 | 0 | （空） | `[FIX-COMPLIANCE][WARN] {反馈文本}` |
| `enforcement=block` 且不合规，`blockCount < 2` | **2** | （空） | `[FIX-COMPLIANCE] {反馈文本：缺失项 + 补救指引}` |
| `enforcement=block` 且不合规，`blockCount >= 2`（降级） | 0 | （空） | `[FIX-COMPLIANCE][GATE-DEGRADED] {反馈文本}` |
| 判定过程异常（transcript 缺失/超限/解析失败/payload 非法/内部异常） | 0 | （空） | （可选诊断，非强制）；**必须** best-effort 落盘一条 `fix-compliance-verdict` 事件（`compliant: null` + 具体 diagnostics，FR-013 loud 半边）；仅 `enforcement=off` 例外（零接触优先，off 短路发生在任何 transcript 读取与 fail-open 分支之前——FR-015 判定顺序第 2 步） |
| `enforcement=block` 或 `warn` 且不合规，但检出**在途委派**且**三道闸门均通过**（判定时机未到，见下方在途判据） | 0 | （空） | `[FIX-COMPLIANCE][WARN] {反馈文本 + 诊断: delegation-in-flight}` |

stderr 反馈文本前缀 `[FIX-COMPLIANCE]` 用于与既有非阻断型 `stop-task-check.sh` 的 `[提醒]` 前缀相区分（FR-010）。

### 在途判据（F256）

stop 并非恒为会话终态：verify/review 子代理经后台委派或 `SendMessage` 恢复执行时，主线程的 stop 是
**中途停顿**，会话仍有未回收的在途工作。判定器据 `fix-compliance-core.mjs::extractInFlightDelegationsAfter`
的三条规则识别这一第三态：

1. **同步委派**停在 transcript 末条且无配对 `tool_result`；
2. **后台委派**（`run_in_background === true`）自身已获非错误 `tool_result` 回执、但无匹配
   `<tool-use-id>` 的 `<task-notification>` 完成通知；
3. **`SendMessage(to: A)`** 自身已获非错误 `tool_result` 回执、且最后一次派发晚于 A 的最后一次
   `<task-id>` 通知。

规则 2/3 的"自身须有非错误回执"是**同一道有效性门槛**：不设它，一次被拒或压根没被受理的派发
即可让门禁永久推迟（最廉价的自助绕过）。

命中时对 `block` 与 `warn` 两档一视同仁：**有界推迟**——落审计事件并附诊断码 `delegation-in-flight`、
stderr 输出 WARN 级缺口清单、exit 0，且**不递增阻断计数**（否则在途停顿会白白烧掉阻断预算，
使真正需要阻断时已降级放行；`blockCount` 在该事件中为 `null`）。

F257 起，推迟成功时**另写一条 `record-workflow-run` 终态记录**（`result: 'paused'`，与"降级放行 = `failed`"
区分）；审计事件的 `degraded` 仍为 `false`。改造前推迟是零终态痕迹的通道，事后审计看起来就是
"还有子代理在跑"，与降级放行的可见性不对等，恰好让更安静的那条成为首选绕过面。

> ⚠️ 该终态记录**刻意不设幂等标记**——幂等标记若存于可被删除的状态文件里，正是缺陷 2 的根因；
> 不设标记时"状态被删"的后果是**多写**终态记录（方向安全）。因此**不得**把它读成"单会话最多写 3 条"：
> 被判方每轮删状态时闸门二恒放行、每轮都会写一条，真实上界是"闸门三阈值内还能塞下多少次 stop"。

> ⚠️ **已知副作用：该终态记录的 `runId` 与 fix skill 不同源，会污染 adoption 指标**
> （第 4 轮审查补登记，**本轮刻意不修**）。判定器写入时 `runId = sessionId`，而
> `skills/spec-driver-fix/SKILL.md` 收尾调用 `record-workflow-run` 用的是 `--run-id "{branch_name}"`；
> `scripts/generate-adoption-insights.mjs` 的 `dedupeRunEvents` 按 `(workflowId, runId)` 去重 ⟹
> 二者落在**不同 key**，于是每个发生过推迟的 fix 会话会额外贡献一条独立的 `paused` run
> （同会话内多次推迟被 dedupe 折叠为 1 条，取最晚者），使 `totalRuns` 上浮、
> `successRate = success / totalRuns` 被下压。
> 注：`releaseDegraded`（F208）早有同样写法，**不是本次新引入的模式**；但降级放行罕见、推迟是常规路径，
> 量级不同。本轮不改 `runId`：改它要同时动 adoption 脚本与 skill 的 `--run-id` 契约，超出本次范围。
> **闭合方向（独立跟进项，二选一）**：① `runId` 与 skill 对齐；② 在 adoption 侧排除判定器写入的合成终态。

#### 推迟的三道闸门（缺一不可）

> ⚠️ 本节的前身版本曾断言"每个在途委派最终都会回收完成通知，届时再次 stop 时在途集合已空"，
> 并据此论证推迟无需上界。**该断言已被实测证伪**：实扫本机 `~/.claude/projects` 全部 2466 份
> transcript，202 次 `run_in_background: true` 派发中有 **43 次（21.3%）从未收到匹配
> `<tool-use-id>` 的完成通知**（回执正常，通知就是没到）。即"通知必达"不是平台保证，
> 而是一个自然发生率就有两成反例的假设——无界推迟等于给出一条可被动触发的永久放行通道。
> 因此推迟由下面三道闸门共同约束（F256 立两道，F257 补第三道——理由见闸门三行与其后的量级说明）。

| 闸门 | 判据 | 不满足时 |
|------|------|----------|
| 一 · 可推迟性 | `verdict.missing` 非空，且**每一项**都属于可推迟集合 `{delegation:implement, delegation:verify, delegation:noop-verify, verification-report.md}`（`fix-compliance-core.mjs::DEFERRABLE_MISSING_KEYS`） | 不推迟，落回正常裁决 |
| 二 · 次数预算 | 该会话的 `inFlightDeferCount < 3`（`IN_FLIGHT_DEFER_LIMIT`），且 +1 已成功持久化 | 不推迟，落回正常裁决；预算耗尽时审计事件追加 `delegation-in-flight-budget-exhausted`，持久化失败时追加 `state-storage-unavailable` |
| 三 · 会话长度预算（F257） | 自**最早**一次 `spec-driver-fix` 展开之后的 assistant **entry** 总数 < `EARLIEST_FIX_ENTRY_DEFER_LIMIT = 420`（`fix-compliance-judge.mjs`，已 export）。该量派生自 transcript，**不在 projectRoot 下、被判方不经手写入，且只增不减**；计量缺席时按"预算已耗尽"处理（fail-closed） | 不推迟，落回正常裁决；审计事件追加 `delegation-in-flight-entry-budget-exhausted` |

**三道闸门取合取（AND），任一不满足即不推迟。** 写成 `||` 等于两道预算互相赦免，缺陷 2 原样存活。

闸门三的两处易误读点（均为实现事实，不是笔误）：

- **基线是"最早一次 fix 展开"，不是判定主锚点**。主锚点（`detectFixSkillExpansion` 的 `anchorLineIndex`）
  取的是**最晚**一次展开，agent 自己再调一次 `Skill(spec-driver-fix)` 即可把它推到末尾、同时保持
  `isFix = true`，令锚点后计数归零（对抗审查实跑：攻击组每轮重展开 → 30/30 全 exit 0、计数恒 4）。
  以最早展开为基线后，重展开只是**追加**条目，基线不动。
  该基线由 `detectFixSkillExpansion` 在**同一趟**扫描里顺带产出（增量返回字段 `earliestFixLineIndex`，
  主锚点三字段语义逐字不变），再作为**显式入参**传给
  `fix-compliance-core.mjs::countAssistantEntriesSinceEarliestFixExpansion(entries, earliestFixLineIndex)`；
  该函数自身**不跑任何正则**，只做一趟计数。
  🔴 **不得**把基线扫描搬回计数函数体内（那会恢复"全链扫两趟"，红队 A/B 实测 10188ms → 19785ms）；
  测试 `C-2j` 以结构钉子锁死这一点——断言计数函数体内不出现 `SKILL_EXPANSION_REGEX`、且形参个数为 2。
  两个基线**必须在同一趟里各自累计**（取值规则不同：主锚点每块取最后一次匹配的 mode，最早基线看块内
  任一匹配是否为 `fix`），既不能互相推导，也不能拆成两趟。
- **单位是 assistant entry，不是"轮"**。wire format 里一次助手轮常拆成多条 assistant envelope
  （文本一条、每个 tool_use 一条），"轮"没有稳定边界。语义也不是"等待多久算超时"，
  而是"**会话长度已异常，不再给推迟通道**"——按"在途等待时长"去调它属误用。

**阈值 420 的标定（第 4 轮审查已更正，前身版本的数字取自旧口径）**：

> ⚠️ 本段前身版本写的是 `P75=76 / P99=409 / max=647` 并称"420 覆盖 P99"。**那组数字是"最晚锚点后计数"
> （旧口径）的分布，与闸门三实际比较的量不是同一个**，据此得出的"覆盖 P99"结论偏乐观。

以 `countAssistantEntriesSinceEarliestFixExpansion`（**实际生效的口径**）在同一语料
（`~/.claude/projects/**/*.jsonl` 全量筛出的 149 份 fix 会话）重取数，两方独立复现、逐位一致：

| 口径 | N | P50 | P75 | P90 | P95 | P99 | max | ≥420 |
|------|---|-----|-----|-----|-----|-----|-----|------|
| **新口径（实际生效）** | 149 | 61 | **77** | 244 | 286 | **647** | **801** | **2** |
| 旧口径（前身版本所写，仅存档对照） | 149 | 61 | 76 | 244 | 286 | 409 | 647 | 1 |

故如实表述是：**420 落在约 P98.7**（149 份里 147 份 < 420，2 份越阈），**不是"覆盖 P99"**。

明知落在 P98.7 仍**不上调**取值的理由：按新口径 P99=647 抬到 660，会把"约 140 轮内免于裁决"放宽到
约 220 轮、显著削弱闸门；而两份越阈会话经复算**都不因此受实际影响**——801 那份
`missing=[feature-dir, fix-report.md]` 不属可推迟集合（闸门一先行拦下，本就不走推迟通道），
647 那份 `compliant=true`（在推迟闸门之前已合规早退）。收益远小于代价。

⚠️ **标定语料是活的**：分位数会随会话增长持续漂移——上一轮记录的 `max=647` 在本轮已被 801 超过。
复核时应重跑取数，不要把上表当静态事实。

越界代价有界：越界只是"不推迟、照常裁决"，若判不合规最多阻断 2 次即触达 `BLOCK_LIMIT` 降级放行，
会话不会卡死；若确有在途工作，被判方在下次 stop 前补齐制品即恢复。

闸门一的存在理由：判定"在途"只说明"还有子代理没回收"，不说明"回收之后缺口会被补上"。
`feature-dir` / `fix-report.md` 是主线程自己该产出的制品，任何子代理回收都不会改变它们
（实测 174 个不合规 fix 会话中有 9 个、5.2% 曾因此被静默推迟）。

`inFlightDeferCount` 与 `blockCount` 存于同一份会话状态文件但**分列**、互不影响；F256 之前写下的
状态文件缺该字段时按 0 起算。合规收口时 `resetBlockState` 删除整份状态文件，两个预算一并清零。

因此本分支的准确表述是：**在证据可能到齐、且缺口确实可由在途工作关闭的前提下，把判定推迟有限次**。
三道闸门任一不满足即恢复完整裁决。审计事件的 `degraded` 保持 `false`，以便与"达到阻断上限后的
降级放行"在事后审计中可区分。

> 🔴 **本段前身版本曾断言"两道闸门任一不满足即恢复完整裁决，故不存在『永久免于裁决』的会话"——
> 该无条件断言已被 F257 实测证伪**：`inFlightDeferCount` 的计数**唯一**存放在
> `.specify/runs/.fix-compliance-state/<sessionId>.json`，该路径位于 projectRoot 下、被 gitignore、属
> "本地运行态"，`loadBlockState` 对缺失/损坏一律静默回落初始态。被判方每轮 stop 前 `rm -rf` 该目录
> 即可让闸门二恒不触发——实测 10 轮**全部 exit 0、审计 `degraded=false`、零终态记录**。
> 即闸门二**单独不构成上界**。

F257 后的准确表述（**有前提、可检验**）：**在 transcript 未被外部截断或 compaction 回退的前提下**，
上界由**闸门三**承担——要继续推迟就必须继续产生 assistant entry，该量只增不减且 `rm -rf` 抹不掉，
越过 420 后不再推迟。

🔴 **量级必须如实读**：闸门三**不消除**"删状态文件绕过闸门二"这一手法本身，该手法**仍然有效**；
闸门三只是给它加了一条抹不掉的天花板——把「**永久**免于裁决」降级为「**约 140 轮内**免于裁决」
（420 entry ÷ 每轮约 3 个 entry；420 ≈ 7 倍中位真实会话长度）。**这是有界化，不是消除**，
不得读成"删状态不再有效"。

#### 已知限界（如实登记，非本次消除）

- **规则 2 只认显式 `run_in_background === true`**，而本运行时的 Agent 契约是"缺省即后台"。
  实扫同一批 transcript：1293 次 Agent 派发中有 29.2% 未显式写该字段。本次**刻意不放宽**检测面——
  欠触发方向是 fail-closed（多阻断、不误放行），不破坏单调性；且放宽会把推迟面从 202 次派发
  扩大到 1293 次的 29%，与刚刚有界化的推迟通道同轴叠加。顺序约束：**先有界化，再考虑放宽**。
- 持续向一个真实存在但恒不产出响应的 agent 重复派发，仍可制造"恒在途"。**"最多推迟 3 次即恢复裁决"
  这一前身表述已被实测证伪**（同上：删状态文件即令闸门二归零）。准确表述：状态文件完好时受闸门二
  约束最多 3 次；**状态文件被删除或不可写时闸门二失效**，此时由闸门三兜底——继续推迟必须持续产生
  主线程 assistant entry，越过 420 后不再推迟。即该路径的残余宽度是「约 140 轮」而非「3 次」。
- **闸门三的单调性以 transcript 不被外部回退为前提**：会话 compaction 会重写 transcript，可能使计数
  回退。该路径与"锚点随 compaction 一并消失 → `isFix=false` → 零审计早退"属同一面，另案登记，
  本合同不声称对其有效。
- **阈值 420 的标定语料是单机 149 份样本**，而该常量随 plugin 发版进入所有用户环境——**外推有效性
  未经验证**。若某类真实工作流的会话长度分布显著长于本语料，闸门三会在这些会话上产生误阻断
  （方向 fail-closed，见上方越界代价论证）。
- 🔴 **N2 类逃逸使三道闸门整体不可达**（第 5 轮审查补登记；**既有面、非 F257 引入**，已列为独立
  跟进项）：`detectFixSkillExpansion` 的主锚点取**最晚一次**展开且不区分 mode，故会话末尾展开
  **另一个** spec-driver 技能（如 `Skill(spec-driver-sync)` / `spec-driver-implement`）即令
  `isFix = false`，`runHook` 在任何 `appendAuditEvent` **之前**早退 → exit 0 且事后零审计线索，
  **连三道闸门都不进**。成本仅一次工具调用，且形态完全无恶意（"修完顺手跑个 sync"）。
  ⚠️ **这一条直接决定上方「约 140 轮」这个量级该怎么读**：闸门三只在门禁仍然挂载的前提下构成上界；
  被判方一旦走 N2 面，420 这个天花板根本不适用。判定器层面已实跑证实（伪造 user-role 展开文本即生效），
  但**未**端到端验证 Claude Code 在 agent 自调 `Skill()` 时是否真会注入该 user 文本——若端到端成立，
  上方"删状态文件是最安静的绕过通道"这一说法需相应修订。
  不纳入 F257 的理由：它触及 `runHook` 早退语义与 US5「健康的非 fix 会话零落盘」契约，与 F257 的
  两条改动不同轴。

## 输出（`--mode report`）

始终 `exit 0`，stdout 打印 `ComplianceVerdict` JSON（见 data-model.md §7），不含任何落盘副作用。用于 quickstart.md 描述的手工验证流程与 headless E2E spike 脚本。

除 `ComplianceVerdict` 字段外，report 输出还含以下判定编排层字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| `mode` / `fixSession` / `enforcement` / `configDegraded` | — | 会话识别与配置解析结果 |
| `transcriptDiagnostics` | `string[]` | transcript 层诊断（fail-open 场景非空） |
| `inFlightDelegations` | `{kind: 'sync'\|'background'\|'send-message', id: string, lineIndex: number}[]` | F256 在途委派事实（上方「在途判据」三条规则的原始命中集合）。**只描述事实，不含闸门判定结果**——三道闸门在 hook 路由中施加，report 模式不落盘也不裁决，故此字段非空**不**等于本次会被推迟 |
| `assistantEntriesSinceEarliestFix` | `number \| null` | F257 闸门三的计量源：自**最早**一次 `spec-driver-fix` 展开之后的 assistant entry 总数（`null` = 该轮判定未产出计量，如 transcript 层早退）。与 `inFlightDelegations` 同为**事实字段**——report 模式不施加任何闸门、不落盘，故该值 ≥ 420 **不**等于本次会被阻断 |

## 阻断/警告反馈文本合同（FR-010，missing 枚举 → 固定 action 映射）

reason 文本由稳定前缀 + 缺失项 action 行 + 双路径指引组成，`missing[]` 的每个枚举值映射到固定 action 文案（机械拼装，非自由生成）：

| missing 枚举值 | action 行文案 |
|----------------|--------------|
| `fix-report.md` | `缺少诊断报告：请完成问题诊断并将 fix-report.md 写入 specs/NNN-fix-<name>/（含 Root Cause 章节）` |
| `verification-report.md` | `缺少验证报告：请委派 verify 子代理完成 Phase 4 验证闭环（产出 verification/verification-report.md）` |
| `delegation:implement` | `缺少 implement 类委派：代码修复必须经 Task 委派 implement 子代理执行（禁止编排器行内修改）` |
| `delegation:verify` | `缺少 verify 类委派：验证闭环必须经 Task 委派 verify/review 类子代理执行` |
| `delegation:noop-verify` | `缺少 no-op 交叉核实委派：请委派一次 verify 类子代理核实"确实无需改动"这一判断` |
| `noop:judgment-section` | `no-op 判定记录不完整：fix-report.md 必须含"## 判定依据"章节且给出具体证据（非占位文本）` |
| `artifact:placeholder` | `制品为占位空壳：请把模板占位符替换为真实内容` |
| `feature-dir` | `未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品` |

尾部固定双路径指引（逐字）：

```text
两条合法收口路径任选其一：
(A) 完整修复路径：诊断(fix-report.md) → 委派 implement 修复 → 委派 verify 验证(verification-report.md)
(B) 确认无需改动路径：fix-report.md 写入"## 判定依据"章节(含具体证据) + 委派 1 次 verify 类子代理交叉核实
```

`[GATE-DEGRADED]` 场景在上述文本前追加一行：`已达阻断上限(2 次)，本次降级放行——以下缺口仍未补齐，已落盘降级审计记录：`。实现侧该映射表为 core 层常量，单测断言每个枚举值都有对应 action 行（防新增 missing 枚举时漏配文案）。

## 特性目录解析：short-name 磁盘重锚定（F256 / F257）

> F256：当 transcript 提名的主候选目录在磁盘上不可用、且既有候选历史回溯（F227）也未命中时，
> 判定器会按 short-name 在 `specs/` 下重新枚举匹配的 `NNN-fix-<short-name>` 目录（见
> `fix-compliance-core.mjs::extractFixShortName` / `fix-compliance-io.mjs::listFeatureDirCandidatesByShortName`），
> 命中且制品齐全时按该目录继续判定。命中结果仍落在上表既有分支（通常是"合规收口"），不产生新退出码分支。

### short-name 磁盘重锚定的采信条件（F257 收口）

F256 的采信闸门只有 `usable()`（目标目录含 `fix-report.md`）。`usable()` 是**制品存在性**判据、
不是**会话归属**判据：本会话零产出时，判定器会静默改用磁盘上同 short-name 的另一编号旧目录完成
合规判定 → `compliant: true` → 合规早退（发生在任何审计落盘**之前**）→ exit 0 且事后零线索。
真正的失效模式是**无意**的——本会话老实提名了自己的新编号目录、磁盘上恰好存在同 short-name 的
历史目录即可触发，被判方全程没有任何冒用动作。

F257 起，重锚定采信条件为 `usable()` **∧ 本会话写入见证**。写入见证的合同（充要，见
`fix-compliance-core.mjs::collectArtifactWriteWitnessDirs`）：存在一条 transcript 条目 `E` 与其
`tool_use` 块 `B` 同时满足——

1. `E.role === 'assistant'` 且 `E.lineIndex >` 本会话 fix 锚点行号；
2. `B.name ∈ ARTIFACT_WRITER_TOOL_NAMES = {Write, Edit}`，且 `B.id` 为非空字符串；
3. `B.input.file_path` 经归一化后**全串**匹配 `^(specs/\d+-fix-[a-z0-9-]+)/fix-report\.md$`
   （`ANCHORED_ARTIFACT_PATH_REGEX`），取捕获组 1 为被见证目录。
   ⚠️ 本条前身版本写的是 `(?:fix-report\.md|verification/verification-report\.md)`，与实现不符——
   实现在第 3 轮红队后已收窄为**只认 `fix-report.md`**，以与 judge 侧采信谓词 `usable()` 严格同源
   （脱钩即复活一条"拿到见证但不 usable"的零审计 fail-open，详见该常量的承重不变量注释）；
4. **该 `B.id` 的全部 `tool_result` 回执均非 error**（取全称而非存在：`tool_use.id` 可被复用，
   "存在某条非 error 回执"可被无关工具的成功回执凭空发证）。**无回执 = 不通过**。

比较**在 short-name 家族级**做：被见证目录的 short-name 与重锚定目标的 short-name 相等即可，
**不要求同编号**。这一点是承重的——把家族级"优化"回同编号等于静默删除整个 F256：

> F256 要修的真实场景里，**被见证的目录与重锚定目标本来就不同编号**。会话在旧编号目录
> （如 `specs/251-fix-foo`）里写下 `fix-report.md`（⟹ 见证成立），随后经 `git mv` 把它重编到
> `specs/254-fix-foo`；旧目录在磁盘上已不存在故 `usable()` 为假、F227 历史兜底不命中，控制流才落进
> short-name 重锚定分支，目标是磁盘上的 `specs/254-fix-foo`。二者 short-name 同为 `foo` ⟹
> 家族级比较下见证成立 ⟹ 采信正支可达，F256 的正向用例仍 exit 0。
> 改成"见证目录必须与重锚定目标同编号"后，该正支**不可达**（被见证的 251 已不在磁盘上），
> F256 的修复被整段抵消。

> ⚠️ 本段前身版本用的是另一条理由——「同编号版本的采信正支结构性不可达（见证集合 ⊆ 提名集合 ⟹
> 被见证目录必进候选历史 ⟹ F227 兜底先手命中；576 组穷举 0 命中）」。**该演绎已被第 3 轮红队实证
> 证伪并从实现注释中删除，不得再作为放宽依据**：「进候选历史」**不蕴含**「`usable()` 为真」——
> F227 兜底循环只挑 usable 的历史候选，故存在"被见证但兜底不选它"的目录。所谓 576 组穷举
> **没有覆盖以 `verification/verification-report.md` 作见证的形态**，不构成证明。
> 上方方框内的正向理由才是家族级比较成立的依据。

安全下界没有被家族级放宽：伪造见证仍须真的 `Write` 一份同 short-name 目录的被核验制品并拿到
harness 的成功回执；放宽的只是"哪个编号"，不是"是否真写过"。

配套约束（改动即改变安全下界）：见证工具集**只收 `Write` / `Edit`**——`Read` 零成本（"读过即算见证"
等于没门槛，实测真实会话锚点后 `Read` 触及制品 15 次），`Bash` 的写形态可被 `cat X > /dev/null`
之类满足；回执配对表**只从非 assistant envelope 建**（纵深防御，避免 assistant 自带 `tool_result` 块发证）；
路径归一化对绝对路径要求 `projectRoot + '/'` 的**分段级**前缀，含 `..` 段、尾随斜杠、大小写差异一律
拒收（fail-closed）。

**新诊断码 `feature-dir-witness-absent`**：磁盘上确有可采信的同 short-name 目录、但本会话对该家族
无写入见证时，拒绝重锚定并向 `verdict.diagnostics` 追加此码（经 `buildAuditEvent` 进审计事件），
使这一新增阻断事后可归因——否则只看到 `missing: [feature-dir]`，与"根本没建目录"不可区分。
该码**不进** `transcriptDiagnostics`（该数组非空即触发 FR-013 fail-open 放行）。

#### 已知限界（如实登记，非本次消除）

- **类 X · 家族零写入**：本会话对该 short-name 家族**任一**目录都没有成功写入过被核验制品，却期望
  采信磁盘上的同名目录 → 阻断。补救成本低（对家族内任一目录制品做一次 `Write`/`Edit` 即恢复），
  且 `BLOCK_LIMIT = 2` 保证最坏两次阻断后降级放行，会话不会卡死。
- **类 X-b · 制品经 `Bash` 写入**（第 4 轮审查补登记，前身版本漏登记）：提名侧与见证侧在**两个维度上
  不对称**——工具集上提名侧 `resolveFeatureDirCandidate` 接受 `Bash` 写入
  （`hasBashWriteIndicator`：`>` / `>>` / `<<` / `tee`，配合 `ARTIFACT_PATH_REGEX`），见证侧只接受
  `Write` / `Edit`；制品类上提名侧的 `ARTIFACT_PATH_REGEX` 还收 `verification/verification-report.md`，
  见证侧只收 `fix-report.md`。于是一个**完全无恶意**的流程会翻车。第 4 轮实跑复现：
  `cat > specs/251-fix-bar/fix-report.md <<'EOF'` 写制品 → 委派齐全 → 复合命令 `git mv` 重编到 254 →
  磁盘 254 制品齐备，结果由 `compliant: true` 翻转为
  `compliant: false, missing: [feature-dir, fix-report.md], diagnostics: [feature-dir-witness-absent]`。
  🔴 **这是取舍不是 bug，不得为它放宽见证判据**：把 `Bash` 收进见证侧，`cat X > /dev/null` 之类零成本
  命令即可发证（正是下方 F227 已知限界一的形态），见证从"证据"退化为"格式"；把
  `verification/verification-report.md` 收进见证侧则直接复活第 3 轮红队实证的绕过链。两条放宽都换不回
  等价的安全下界。补救与类 X 相同：对家族内任一目录的 `fix-report.md` 做一次 `Write`/`Edit` 即恢复。
- **类 X-c · 会话中途重新展开 fix skill**（第 5 轮审查补登记，**刻意不修**）：见证窗口的下界是
  **最晚**一次展开（`anchor.anchorLineIndex`），而闸门三的计量基线刻意取**最早**一次 fix 展开——
  两者**方向相反**。故同一会话中途再次 `Skill(spec-driver-fix)` 展开时，此前对制品的**合法** `Write`
  会落到新窗口之外 → 见证清空 → `feature-dir-witness-absent` 阻断。
  🔴 **这个不对称是刻意的、两侧各自 fail-closed，不是需要"对齐"的疏漏**：见证用最晚锚点 ⟹ 重展开
  只**收窄**见证（更难放行）；闸门三用最早展开 ⟹ 重展开无法把计数清零（更难推迟）。两侧都取
  "重展开不能让被判方获益"的那一端。若把见证窗口也改成最早展开，锚点前的陈旧写入事件会重新计入见证，
  放宽的是**放行**方向，与本收口意图相反。补救与类 X 相同：重展开后再对家族内任一目录的
  `fix-report.md` 做一次 `Write`/`Edit` 即恢复。
- **类 Y · 制品由子代理写入**：子代理 transcript 落在**独立**的 `agent-*.jsonl`，而 Stop hook 的
  `payload.transcript_path` 只指向主会话文件，故子代理的 `Write`/`Edit` 在主 transcript 中**不可见**。
  实测本机 1296 份子代理文件中命中被核验制品的 `Write`/`Edit` 共 71 次、覆盖 11 个特性目录；
  全语料 A/B（148 份真实 fix 会话）中有 **2 份**因此由 `compliant:true` 翻转为 `false`。
  子代理写制品是受支持的工作流形态，故这是**真实的新增误阻断**，已接受并如实登记。
- **R11 · 绝对路径见证 + 判定根错位**：以**绝对路径**写下的制品见证，在 hook 被以异于会话 cwd 的
  `--project-root` 调用（或项目中途被移动/改名）时会静默落空 → 误阻断。方向 fail-closed，
  补一次相对路径写入即恢复。生产上 hook 的 projectRoot 恒等于会话 cwd，该错位主要出现在回放/夹具场景。
- **R11-b · 见证路径归一化的 symlink / realpath 分歧**（第 4 轮审查补登记，**刻意不修**）：
  `normalizeArtifactWritePath` 按 core **零 I/O** 契约做纯字符串前缀剥离（`startsWith(rootPrefix)`）、
  不做 `realpath`；而提名侧是 `ARTIFACT_PATH_REGEX` 的**子串**匹配、完全不看根。故 hook 的
  `projectRoot` 与 `file_path` 在**符号链接层面不同源**时（macOS 经典的 `/tmp` ↔ `/private/tmp`、
  `/var` ↔ `/private/var`，或项目挂在软链下），**提名成立而见证恒空** → 误阻断。
  不引入 `realpath` 的理由：那是 fs I/O，会破坏 core 零 I/O 契约（判定器跑在**同步** Stop hook 上，
  该契约本身承重）。生产风险已被压低——`hooks/stop-fix-compliance-check.sh` 以
  `--project-root "$(pwd)"` 调用，与会话 cwd 同源；代价有界（`BLOCK_LIMIT = 2`，补一次相对路径写入即恢复）。
  但语料中确有 `cwd=/private/var/folders/...` 形态的会话，故如实登记而非声称不存在。
- **见证不绑定磁盘终态**：`Write` 拿到成功回执后 `git checkout --` 回滚，或先 `Read` 再写回逐字节
  相同内容，磁盘零变化而见证仍成立（判据看 transcript 历史、制品判据看磁盘终态，二者时间解耦——
  F227「终态存在性 ≠ 历史事件是否发生」的镜像）。伪造成本仍高于下一条既有限界，不构成最廉价路径。
- **F227 已知限界一（主动冒用）本次不消除**：不经过本兜底通道，直接提名磁盘上完好的历史目录并用
  `cat X > /dev/null` 满足 `BASH_WRITE_INDICATOR_REGEX` 仍可放行。本收口的价值在于消除**无意**的
  静默采信，而非阻止主动冒用。
- **写入内容质量不在本判据管辖内**（写一份空壳制品亦构成见证）——属既有判据强度问题，
  由 `classifyClosureForm` / `judgeCompliance` 承担。

## 不变量

- **零 LLM / 零子代理委派**：本 CLI 全程不得出现任何 `Task(` / 模型 API 调用字符串；implement/verify 阶段应静态审查此文件与其 import 链，确认无网络调用。
- **顶层异常兜底**：`main()` 函数整体包裹 try/catch，任何未捕获异常必须转化为 `--mode hook` 下的 exit 0（FR-013），不得让异常穿透到进程默认崩溃退出码。
- **不得读取/依赖任务 ID 或任务描述文本**（FR-011/C-001 精神一致性）：判定输入仅限 transcript 结构化字段与磁盘制品状态。
- **`SKILL_EXPANSION_REGEX` 全链只允许扫一趟**（F257 第 3 轮 WARNING 收口）：该正则含惰性量词
  `([^\n]+?)\/skills\/`，虽无嵌套量词故不存在指数级灾难性回溯，但**不蕴含线性**——同一**行**内重复出现
  `Base directory for this skill:` 诱饵前缀且该行不含 `/skills/` 时，每个诱饵起点都要把 `[^\n]+?`
  扩到行尾才放弃，整体 O(K×N)（实测 K=12000、行长 ~1.3MB 时单趟 ≈ 5s）。判定器跑在**同步** Stop hook 上，
  故扫描**次数**是承重指标：`detectFixSkillExpansion` 已在同一趟里同时产出主锚点与 `earliestFixLineIndex`，
  **任何新增消费方都必须复用它的返回值，不得另起第二遍全量扫描**（第 2 轮实现即因闸门三另扫一遍，
  把红队诱饵语料的最坏耗时从 10188ms 翻到 19785ms）。回归护栏：`C-2j` 结构钉子 +
  「计数趟耗时相对展开趟 < 5%」的比例断言。该正则本身的线性化属独立跟进项，不在 F257 范围。
