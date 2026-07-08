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
| 判定过程异常（transcript 缺失/超限/解析失败/内部异常） | 0 | （空） | （可选诊断，非强制） |

stderr 反馈文本前缀 `[FIX-COMPLIANCE]` 用于与既有非阻断型 `stop-task-check.sh` 的 `[提醒]` 前缀相区分（FR-010）。

## 输出（`--mode report`）

始终 `exit 0`，stdout 打印 `ComplianceVerdict` JSON（见 data-model.md §7），不含任何落盘副作用。用于 quickstart.md 描述的手工验证流程与 headless E2E spike 脚本。

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

## 不变量

- **零 LLM / 零子代理委派**：本 CLI 全程不得出现任何 `Task(` / 模型 API 调用字符串；implement/verify 阶段应静态审查此文件与其 import 链，确认无网络调用。
- **顶层异常兜底**：`main()` 函数整体包裹 try/catch，任何未捕获异常必须转化为 `--mode hook` 下的 exit 0（FR-013），不得让异常穿透到进程默认崩溃退出码。
- **不得读取/依赖任务 ID 或任务描述文本**（FR-011/C-001 精神一致性）：判定输入仅限 transcript 结构化字段与磁盘制品状态。
