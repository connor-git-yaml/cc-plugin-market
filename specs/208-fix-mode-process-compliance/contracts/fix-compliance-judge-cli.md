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
| `enforcement=block` 或 `warn` 且不合规，但检出**在途委派**且**两道闸门均通过**（判定时机未到，见下方在途判据） | 0 | （空） | `[FIX-COMPLIANCE][WARN] {反馈文本 + 诊断: delegation-in-flight}` |

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

#### 推迟的两道闸门（缺一不可）

> ⚠️ 本节的前身版本曾断言"每个在途委派最终都会回收完成通知，届时再次 stop 时在途集合已空"，
> 并据此论证推迟无需上界。**该断言已被实测证伪**：实扫本机 `~/.claude/projects` 全部 2466 份
> transcript，202 次 `run_in_background: true` 派发中有 **43 次（21.3%）从未收到匹配
> `<tool-use-id>` 的完成通知**（回执正常，通知就是没到）。即"通知必达"不是平台保证，
> 而是一个自然发生率就有两成反例的假设——无界推迟等于给出一条可被动触发的永久放行通道。
> 因此推迟由下面两道闸门共同约束。

| 闸门 | 判据 | 不满足时 |
|------|------|----------|
| 一 · 可推迟性 | `verdict.missing` 非空，且**每一项**都属于可推迟集合 `{delegation:implement, delegation:verify, delegation:noop-verify, verification-report.md}`（`fix-compliance-core.mjs::DEFERRABLE_MISSING_KEYS`） | 不推迟，落回正常裁决 |
| 二 · 次数预算 | 该会话的 `inFlightDeferCount < 3`（`IN_FLIGHT_DEFER_LIMIT`），且 +1 已成功持久化 | 不推迟，落回正常裁决；预算耗尽时审计事件追加 `delegation-in-flight-budget-exhausted`，持久化失败时追加 `state-storage-unavailable` |

闸门一的存在理由：判定"在途"只说明"还有子代理没回收"，不说明"回收之后缺口会被补上"。
`feature-dir` / `fix-report.md` 是主线程自己该产出的制品，任何子代理回收都不会改变它们
（实测 174 个不合规 fix 会话中有 9 个、5.2% 曾因此被静默推迟）。

`inFlightDeferCount` 与 `blockCount` 存于同一份会话状态文件但**分列**、互不影响；F256 之前写下的
状态文件缺该字段时按 0 起算。合规收口时 `resetBlockState` 删除整份状态文件，两个预算一并清零。

因此本分支的准确表述是：**在证据可能到齐、且缺口确实可由在途工作关闭的前提下，把判定推迟有限次**。
两道闸门任一不满足即恢复完整裁决，故不存在"永久免于裁决"的会话。审计事件的 `degraded` 保持
`false`，以便与"达到阻断上限后的降级放行"在事后审计中可区分。

#### 已知限界（如实登记，非本次消除）

- **规则 2 只认显式 `run_in_background === true`**，而本运行时的 Agent 契约是"缺省即后台"。
  实扫同一批 transcript：1293 次 Agent 派发中有 29.2% 未显式写该字段。本次**刻意不放宽**检测面——
  欠触发方向是 fail-closed（多阻断、不误放行），不破坏单调性；且放宽会把推迟面从 202 次派发
  扩大到 1293 次的 29%，与刚刚有界化的推迟通道同轴叠加。顺序约束：**先有界化，再考虑放宽**。
- 持续向一个真实存在但恒不产出响应的 agent 重复派发，仍可制造"恒在途"，但受闸门二约束，
  最多推迟 3 次即恢复裁决。

## 输出（`--mode report`）

始终 `exit 0`，stdout 打印 `ComplianceVerdict` JSON（见 data-model.md §7），不含任何落盘副作用。用于 quickstart.md 描述的手工验证流程与 headless E2E spike 脚本。

除 `ComplianceVerdict` 字段外，report 输出还含以下判定编排层字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| `mode` / `fixSession` / `enforcement` / `configDegraded` | — | 会话识别与配置解析结果 |
| `transcriptDiagnostics` | `string[]` | transcript 层诊断（fail-open 场景非空） |
| `inFlightDelegations` | `{kind: 'sync'\|'background'\|'send-message', id: string, lineIndex: number}[]` | F256 在途委派事实（上方「在途判据」三条规则的原始命中集合）。**只描述事实，不含闸门判定结果**——两道闸门在 hook 路由中施加，report 模式不落盘也不裁决，故此字段非空**不**等于本次会被推迟 |

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

> F256：当 transcript 提名的主候选目录在磁盘上不可用、且既有候选历史回溯（F227）也未命中时，
> 判定器会按 short-name 在 `specs/` 下重新枚举匹配的 `NNN-fix-<short-name>` 目录（见
> `fix-compliance-core.mjs::extractFixShortName` / `fix-compliance-io.mjs::listFeatureDirCandidatesByShortName`），
> 命中且制品齐全时按该目录继续判定。命中结果仍落在上表既有分支（通常是"合规收口"），不产生新退出码分支。

尾部固定双路径指引（逐字）：

```text
两条合法收口路径任选其一：
(A) 完整修复路径：诊断(fix-report.md) → 委派 implement 修复 → 委派 verify 验证(verification-report.md)
(B) 确认无需改动路径：fix-report.md 写入"## 判定依据"章节(含具体证据) + 委派 1 次 verify 类子代理交叉核实
```

`[GATE-DEGRADED]` 场景在上述文本前追加一行：`已达阻断上限(2 次)，本次降级放行——以下缺口仍未补齐，已落盘降级审计记录：`。实现侧该映射表为 core 层常量，单测断言每个枚举值都有对应 action 行（防新增 missing 枚举时漏配文案）。

## 不变量

- **零 LLM / 零子代理委派**：本 CLI 全程不得出现任何 `Task(` / 模型 API 调用字符串；implement/verify 阶段应静态审查此文件与其 import 链，确认无网络调用。
- **顶层异常兜底**：`main()` 函数整体包裹 try/catch，任何未捕获异常必须转化为 `--mode hook` 下的 exit 0（FR-013），不得让异常穿透到进程默认崩溃退出码。
- **不得读取/依赖任务 ID 或任务描述文本**（FR-011/C-001 精神一致性）：判定输入仅限 transcript 结构化字段与磁盘制品状态。
