---
feature: v008-retest-gstack
feature_number: 237
branch: [待定]
status: Draft
created: 2026-08-01
input: "F237 V008 修复复测：F216 证据门后全池重跑，验证'超 GStack'"
research_basis: "[无独立调研制品] 依据 specs/212-eval-rerun-m8-closeout/、specs/216-fix-noop-evidence-gate/、specs/206-eval-calibrated-harness/ 既有事实直接起草"
---

# Feature Specification: F237 V008 修复复测 — F216 证据门后全池重跑，验证"超 GStack"

## 概述

F212（M8 收官评测）测得 c3（spec-driver+Spectra，driver=claude-sonnet-4-6）= 27/33 = 81.8%，对 GStack 90.9% 存在真实差距；扣除双方共同的 V006 坟场任务后，**差距的全部结构性部分 = V008×2**——两个 run 的 fix-report 自信断言"已历史修复"（方向误读：把 base 态当作已修复态），patch 零源码改动，MCP 调用 ×0，穿着 F208 合规外衣的自信 no-op。

F216 已 ship 结构化修复（[trace](../216-fix-noop-evidence-gate/trace.md)、[verification-report](../216-fix-noop-evidence-gate/verification/verification-report.md)）：给 fix 模式 no-op 出口新增**可执行证据门**——no-op 放行必须携带被主 transcript 记录的真实 Bash 复现命令执行 + 逐声明对账 + 约定 PASS 判定；证据缺失在 block 档判不合规、阻断并给出"补 repro"的 next-step 反馈；warn 档同判定逻辑仅提示不阻断；判定材料不可用时沿用 fail-open（能力边界已声明，残余绕过窗口）。F216 的单测/fixture 回归（SC-001/002/003a/004/005/006）已全绿，但**未在真实评测批中验证过 V008 是否真的被拦下、拦下后是否推动模型转向真实修复**——F216 spec 的 Out of Scope 明确写"真实 V008×N 评测复测（留下一轮评测批）"。

**本 feature 就是那"下一轮评测批"**：在 F216 enforcement=block 下，重跑 F206/F212 同款全池 11 task × 3 repeat = 33 run（cohort c3），口径完全沿用 F212 headline 链（driver=claude-sonnet-4-6、oracle timeout=1.2M ms、pool 链结算口径），逐 run 对 V008 做证据门可审计取证，更新四方终表，诚实回答"c3 能否从 81.8% 逼近/反超 GStack 90.9%"。

**诚实原则声明**：本 feature 不预设"V008 会转化"为唯一合法结局。**"V008 未转化 + 给出机制归因"与"V008 转化 + c3 提升"是同等合法的两种收口结果**——两者都需要完整取证与诚实报告，区别仅在于归因路径不同（见 FR-006、SC-006）。

---

## 前置条件与阻塞项（编排器 preflight 实测，作为事实固化，不得推翻；可标注风险）

| # | 检查项 | 实测结果 | 阻塞级别 | 解除方式（谁来做、如何验证已解） |
|---|---|---|---|---|
| P-1 | `SILICONFLOW_API_KEY` in `.env.local` | ✅ 存在 | 无阻塞 | — |
| P-2 | `~/.codex/auth.json` | ✅ 存在（codex-cli 0.144.6 可用） | 无阻塞（本轮 driver 非 codex，见下方 P-6 说明） | — |
| P-3 | `claude --print` OAuth | ❌ **已过期**（"OAuth session expired and could not be refreshed"，绕过 sandbox 复测同样失败） | **硬阻塞**（driver 无法启动，跑批全链路依赖 claude CLI） | 用户在 host shell 交互式执行 `claude /login`；验证：`echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text` 输出 `ok` |
| P-4 | `npm run judge:doctor` | ❌ **status=drift**：active 快照 = `~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0`，2 mismatch + 1 missingInSnapshot | **警示级**（不阻塞本 feature 的评测链路，见 P-6 归因） | 记录现状，不在本 feature 内修复分发（Non-Goals） |
| P-5 | 4.3.0 快照是否含 F216 证据门 | ❌ **不含**：`noop:repro-fields` 关键词在 `plugins/spec-driver/scripts/` 下精确计量为**仓库共 4 次 occurrence、分布于 3 个文件**（`lib/fix-compliance-core.mjs:367`、`lib/fix-compliance-execution-record.mjs:303`、`dev/spike-fix-compliance-e2e.mjs:27`、`:119`；其中 spike 为开发用探针）、4.3.0 快照 0 处；`fix-compliance-core.mjs` diff 980 行**（非稳定计量指标，仅供参考，不作为语义结论依据）**；`fix-compliance-execution-record.mjs` 快照缺失。**语义结论真正依赖的证据**是 `judge:doctor` 的 `2 mismatch + 1 missingInSnapshot` 输出，以及 F236 verification-report 的记录 | **警示级**（同 P-4） | 同上，不修复；但**必须**确认跑批实际加载的判定器路径不受此 drift 影响（见 P-6） |
| P-6 | 评测判定器加载路径 | `eval-task-runner.mjs:914-916` 将 `specDriverPluginDir` 定为**仓内源** `path.join(PROJECT_ROOT, 'plugins', 'spec-driver')`，经 `--plugin-dir` 显式注入 claude CLI；`hooks.json` 用 `${CLAUDE_PLUGIN_ROOT}` 相对寻址。**结论（条件性，非绝对）：仅当 P-8（全局 spec-driver 已 disable）与 P-9（`FIX_COMPLIANCE_CLI` 未设置）两个前提同时被机械保证时，P-4/P-5 的全局 npm 缓存 4.3.0 drift 才不影响本次评测链路**——本 feature **没有实证**证明"`--plugin-dir` 注入的插件必然压过同名全局插件"：`scripts/lib/local-spectra-plugin.mjs:9-11` 的注释只说明同名共存不崩溃，未回答实际加载了哪个 build；`eval-task-runner.mjs:919` 自称这是"同名加载歧义"，未回答两份同名插件是否都执行 hooks、各自 `CLAUDE_PLUGIN_ROOT` 如何绑定、阻断结果如何合并。**正面支撑证据**：判定器闭包是纯 `.mjs` + Node 内置依赖，不依赖 `dist/`、TypeScript 编译或 node_modules（依据 `specs/236-judge-snapshot-drift-signal/research.md:64,78-79`，hook 直接 `node "$CLI"`），故"源码新但构建产物旧"这一第二重风险不存在 | 无阻塞（在 P-8+P-9 前提机械保证下由架构隔离） | 跑批前仍需按 FR-003 显式核验：(1) 抽查一个 dry-run/单 run 的 `claudeArgs.--plugin-dir` 确实指向仓内 `plugins/spec-driver` 绝对路径；(2) 确认 `FIX_COMPLIANCE_CLI` 未设置（见 P-9） |
| P-7 | 分发链路（4.4.0 push 状态） | ⚠️ 4.4.0 从未推送到 `origin/master`（origin 停在 `ce2c036`，本地 HEAD `0d292e3` 领先 2 commit）；npm latest = 4.3.0；marketplace clone 落后 origin/master 80 个 commit | 与本 feature **无关**（不涉及分发） | 不在本 feature 处理（Non-Goals） |
| P-8 | 全局 `enabledPlugins["spec-driver@cc-plugin-market"]` | `= true` → `eval-task-runner.mjs:917-923` 的同名加载歧义门禁会在跑批 launch 时**硬抛错**（`throw new Error(...)`）拒跑 | **硬阻塞**（起跑前必解） | 跑批前执行 `claude plugin disable spec-driver@cc-plugin-market --scope user`；验证：`args.skillInvocation` 路径下 `globalSpecDriverPluginPresent()` 返回 false（可用一次 dry-run 单 task 验证不抛错） |
| P-9 | `FIX_COMPLIANCE_CLI` 环境变量 | ✅ 当前发射 shell 中 **UNSET**；`~/.zshrc`/`~/.zshenv`/`~/.zprofile`/`~/.bashrc` 均未导出该变量。**风险说明**：`plugins/spec-driver/hooks/stop-fix-compliance-check.sh:17` 写作 `CLI="${FIX_COMPLIANCE_CLI:-$PLUGIN_ROOT/scripts/fix-compliance-judge.mjs}"`，而 `scripts/eval-task-runner.mjs:567` 以 `const env = { ...process.env }` 原样继承父环境；仓库**没有任何起跑门禁**校验该变量。若发射 shell 中该变量指向旧 CLI（例如 4.3.0 快照），即使 P-8（全局 disable）与 P-6（`--plugin-dir` 正确）均满足，Stop hook 仍会执行旧判定器 → 33 run 全部失效且不可察觉 | **硬阻塞（当前已满足，但每次发射前必须重验，不得凭历史结论免检）** | 跑批前显式执行 `unset FIX_COMPLIANCE_CLI`（防御纵深，不依赖"当前恰好没设"）；验证：`env | grep -c FIX_COMPLIANCE_CLI` 输出为 0，记录留档（见 FR-003） |

**与用户原始运维护栏条目的映射**：全局 spectra plugin disable（用户提到"全局 spec-driver plugin"）在此对应 P-8；plugin 守卫 sidecar（放稳定路径 + setsid）、探针整串精确匹配、oracleSpecHash 冻结门等运维实践承 F212 §7 Falsification 附录，本 feature 沿用不重复设计（见 FR-008）。

---

## User Scenarios & Testing

### User Story 1 — 全池复测产出可信 c3 新数（Priority: P1）

作为需要知道"F216 证据门是否真的把 c3 推过 GStack"的决策者，我需要在 F216 enforcement=block 下，用与 F212 完全一致的口径（同 11 task、同 3 repeat、同 driver、同 oracle 结算口径）重跑全池，拿到一份判分零剔除、可与 F212 直接横比的新 c3 数字。

**Why this priority**：这是本 feature 的 headline 问题，没有可信的新数字，后续所有取证与结论都无从谈起。

**Independent Test**：跑批完成后，`f237-headline.json`（或等价聚合产物）中 `n_total=33`，`infra/error/oracle_error/oracle_missing` 计数与 excludedRate 明确可读；口径字段（driver 型号、`--plugin-dir` 路径、oracle timeout 值）逐 run 落盘可审计。

**验收场景**：

1. **Given** P-3（OAuth）与 P-8（全局 plugin disable）已解除、SiliconFlow key 就位，**When** 按 F212 headline 口径（driver=claude-sonnet-4-6、pool 链、oracle timeout=1.2M ms、11 task × 3 repeat）跑批，**Then** 33 run 全部产出 `{classification, failureSource, reason}`，判分口径（driver/plugin-dir/timeout）逐 run 落盘。
2. **Given** 跑批中途 OAuth 过期或配额触顶，**When** 检测到该信号，**Then** 跑批暂停并显式提示用户（不产生静默假阴性），resume 后按 (task, tool, repeat) 幂等续跑（沿用 F212 既有 resume 机制）。

---

### User Story 2 — V008 逐 run 可审计取证（Priority: P1）

作为需要判断"F216 证据门到底有没有拦住 V008 式方向误读"的评审者，我需要针对 V008 的 3 个 run，逐一拿到 fix-report、patch diff、以及证据门审计事件（触发与否、missing key、是否放行、放行理由）的完整记录——无论最终判分是 pass 还是 fail。

**Why this priority**：这是本 feature 相较"单纯重跑一次全池"的核心增量价值——不取证就无法区分"V008 转化是运气好"还是"证据门真的机制性介入了"。

**Independent Test**：对每个 V008 run，能从审计产物中回答三个机械问题：(a) 证据门是否触发（no-op 分支是否被进入）；(b) 若触发，missing key 集合是什么、是否推动了后续补证据或转向真实修复；(c) 最终 closureForm 是 no-op 还是 repair，是否携带 ExecutionRecord。

**验收场景**：

1. **Given** V008 的某个 run 走了 no-op 出口，**When** 查询该 run 的 `.specify/runs/*.jsonl` 审计事件（沿用 F216 `blockState`/missing[] 结构），**Then** 能读到该 no-op 是否因证据缺失被 block 档阻断、阻断后模型是否补证据或转向真实修复、最终放行/降级放行的判定依据。
2. **Given** V008 的某个 run 走了 repair 出口（source 改动），**When** 查该 run 的 patch diff，**Then** 能确认是否为真实修复（非零 diff，非"改标题切分支"式绕门，对照 F216 FR-018 已知边界）。
3. **Given** 3 个 V008 run 全部取证完成，**When** 汇总，**Then** 产出一张逐 run 表：`{run, closureForm, 证据门触发?, missing keys, 最终判定, oracle pass/fail}`，无论 V008 最终是 0/3、1/3、2/3 还是 3/3 都必须完整呈现。

---

### User Story 3 — 四方终表更新与诚实结论（Priority: P1）

作为需要形成 M9 决策依据的读者，我需要一份更新后的四方终表（GStack / c3 / 裸 Claude / SuperPowers）+ 一份不夸大也不回避的结论：c3 是否真的转化、是否逼近或反超 GStack，若未转化则下一步机制归因是什么（不能是"再试一次 prompt 加固"这类已被证伪的路径）。

**Why this priority**：脱离诚实结论，纯数字更新没有决策价值；且用户明确要求"诚实结论"是硬性验收项。

**Independent Test**：`PUBLISH-REPORT-M9-interim.md` 存在，含四方终表更新行、V008 逐 run 取证表、C1 红线声明（本轮只与 F206/F212 全池链横比，不与 133/A-B 链横比）、以及一段不可省略的"诚实结论"段落。

**验收场景**：

1. **Given** 33 run 判分与 V008 取证均完成，**When** 撰写终表，**Then** 表格含 F212（战役后/F208 后）与 F237（本轮）两列 c3 数据 + GStack 90.9% 对照行，若样本量不足以统计区分需显式标注 CI 带。
2. **Given** V008 结果为 X/3（X∈{0,1,2,3}），**When** 撰写结论，**Then** 若 X<3（未完全转化）必须给出"证据门是否触发但仍失败"vs"证据门根本未触发"的区分（决定归因方向：判据不够严 vs 触发路径未覆盖到该场景 vs 其他新失败模式）；若 X=3（完全转化）必须交叉核对是否为其他因素（如任务本身波动、driver 版本差异）导致的巧合，不能不加核验就归功于证据门。

---

### Edge Cases

- **OAuth 中途过期**：跑批前（P-3）与长批/隔夜 resume 前必须 preflight `claude /login`；跑批中若子进程 401，暂停并提示用户，不静默产生假阴性判分（沿用 F212 §7 falsification 附录经验）。
- **配额触顶**：≥30 runs 时每 6 runs 检查一次配额 dashboard；≥60% weekly → 停下询问用户是否继续或分日跑（用户原始运维护栏硬性要求）。
- **单 run 超时**：oracle timeout 沿用 pool 链口径 1.2M ms；生成侧超时（gen_timeout）按 F212 先例记为"未完成生成"，不计入 oracle pass/fail 判分，但计入取证表（无法判定坍塌/方向误读，如 F212 V006）。
- **oracle 假报 vs 真回归的区分**：任何 `classification==='error'` 的 run 必须走 tri-state oracle_error 剔分母口径（F210/T0 语义，不能经 `Boolean()` 归 0=fail 伪装成真实失败）；跑批前需确认本轮沿用的 oracle 语义模块与 F212 冻结版本一致（若 master 侧有语义模块改动导致 `oracleSpecHash` 漂移，需在报告中显式记录，参照 F212 T0 re-freeze 先例）。
- **runId 跨链撞名覆盖取证**：F212 §7-4 已实测发生过（headline 与 A/B 链 runId 同构导致互相覆盖 stdout/patch）；F212 §9-2 的"runId 加后缀"修复方案**未落地**。本轮**手动规避**：V008 相关的 fix-report/patch/审计事件在跑批完成后立即存档到 `specs/237-v008-retest-gstack/evidence/` 下的独立命名路径，再进行任何可能复用 runId 的后续跑批（如有）。
- **判定器加载歧义**：见前置条件 P-6/P-8/P-9；若跑批中意外触发全局 plugin 加载歧义报错，或发现 `FIX_COMPLIANCE_CLI` 被意外设置，视为环境未就绪，需重新执行 P-8/P-9 步骤后重跑该 run，不得静默切换到全局缓存路径或旧判定器继续跑。
- **V008 未转化时的归因路径**：不得简单重复"再调整 prompt"（已被 F206-R3 三版证伪）或"再加流程步骤"（F208 已达成坍塌 0/29 但 V008 未动）。归因必须回答：(a) 证据门是否被实际触发（no-op 路径是否被进入）；(b) 若触发，判据是否因某个能力边界豁免了本次失败形态（对照 F216「能力边界声明」逐条排查，如 EC-003/EC-007/EC-008/EC-009/EC-010 是否命中）；(c) 若未触发，为何模型这次没有走 no-op 出口（例如直接产出了另一种伪造修复形态，需具体描述新形态）。

---

## Requirements

- **FR-001** 系统 MUST 在 F216 enforcement=block 下，用与 F212 headline 完全一致的口径（driver=claude-sonnet-4-6、pool 链结算、oracle timeout=1.2M ms、全池 11 task、cohort c3、每 task 3 repeat）重跑 33 run，判分零剔除（`infra=0 / error=0 / oracle_error=0 / oracle_missing=0`，或若非零需在报告中逐条解释原因，不得沉默丢弃）。（US1）
- **FR-002** 系统 MUST 对 V008 的 3 个 run 逐一产出：fix-report 全文、patch diff、证据门审计事件摘要（触发与否/missing keys/最终判定路径），汇总为一张逐 run 取证表，无论判分结果如何都必须完整呈现（不得因"结果不理想"而省略取证）。（US2）
- **FR-003** 跑批前 MUST 显式核验三项：(1) P-8（全局 spec-driver plugin 已 disable）；(2) P-6（`--plugin-dir` 实际指向仓内源 `plugins/spec-driver`，含 F216 代码）；(3) P-9（`FIX_COMPLIANCE_CLI` 环境变量未设置），发射器脚本 MUST 显式 `unset FIX_COMPLIANCE_CLI`（防御纵深，不依赖"当前恰好没设"）。核验方式为抽查至少一个 run 的 `claudeArgs` 落盘记录**外加**发射前 `env | grep -c FIX_COMPLIANCE_CLI` 输出为 0 的记录留档。（前置条件）
- **FR-004** 系统 MUST 更新四方终表（GStack / c3 本轮 / c3 F212 战役后与 F208 后 / 裸 Claude / SuperPowers 对照），并明确标注本轮结果仅与 F206/F212 全池链横比（C1 红线：不与 133 重判链、A/B opus 链做绝对率横比，沿用 F212 §6 既定红线）。（US3）
- **FR-005** 系统 MUST 产出 `PUBLISH-REPORT-M9-interim.md`（manual 入库），交叉链接 `../212-eval-rerun-m8-closeout/`（PUBLISH-REPORT-M8.md）与 `../216-fix-noop-evidence-gate/`（spec.md + verification-report.md）。（US3）
- **FR-006** 系统 MUST 撰写诚实结论段落，覆盖：(a) V008 X/3 的最终判分；(b) c3 新数 vs GStack 90.9% 的差距是否收窄/持平/扩大；(c) 若 V008 未完全转化（X<3），MUST 按 Edge Cases 归因路径给出具体机制判断，不得笼统归因为"噪声"或不做归因；(d) 若 V008 完全转化（X=3），MUST 交叉核验是否确系证据门介入所致（而非任务本身波动/driver 差异等混淆因素）。（US3）
- **FR-007** 每个 phase（spec/plan/tasks/implement-即跑批/verify）完成后 MUST 立即跑 Codex 对抗审查（`codex:codex-rescue` 子代理），critical/warning 项修复后重新验证再进入下一 phase；push 到 `origin master` 前 MUST 在对话中列出交付报告（commit hash、改动统计、Codex 审查结论、验证结果、rebase 状态、下一步建议）等待用户明确"确认 push"。（运维护栏，用户原文要求）
- **FR-008** 慢验窗口内 MUST NOT 改动 `plugins/**`；评测所用 worktree/仓内源 MUST 冻结基线（跑批开始到结束期间零改动 `scripts/eval-*.mjs`/oracle 语义模块/`plugins/spec-driver`）；plugin 守卫 sidecar MUST 放稳定路径并用 `setsid` 脱离父进程组（沿用 F212 §7-2 falsification 附录已验证的运维手段）；探针输出 MUST 用整串精确匹配（不用宽松 glob，规避 F212 §7-1 已实测的假阳性误发射）。（运维护栏）
- **FR-009** 系统 MUST NOT 用 runner `success` 状态代替 oracle 判分做直播播报（F212 §7-6 已实测教训：runner success ≠ oracle pass）；一切"V008 X/3"式播报 MUST 以 oracle 判分产物为准。（运维护栏）
- **FR-010** 评测产物（run_artifacts、`.swebench-venv` 等）MUST NOT 入库；commit MUST 用显式路径提交，MUST NOT 用 `git add -A`；MUST 排除 `specs/src.spec.md`（若跑批过程中被自动再生）。（运维护栏，Non-Goals 呼应）
- **FR-011** 系统 MUST 遵循成本约束：实付成本 = SiliconFlow jury token 成本，预算 <$10（33 run）；Claude 配额消耗按订阅口径（边际 $0 实付但计入周配额）；跑批达 30 run 后每 6 run 检查一次配额 dashboard，≥60% weekly 时停止跑批并询问用户是否继续或分日跑。（成本约束）
- **FR-012** 系统 MUST 附一节 dogfooding 四维度反馈（MCP 可用性 / 信息完整性 / 流程顺畅度 / 结果准确性），沿用既有政策格式，无问题需显式写"无"。（用户原文要求）
- **FR-013** 跑批发射前 MUST 显式核验 `FIX_COMPLIANCE_CLI` 环境变量未设置（P-9）；若发现该变量被设置为非空值，MUST 视为硬阻塞并停止发射，不得静默沿用该值继续跑批。（前置条件，对应 P-9）

### Key Entities

- **Run**：单次 `(task, tool='spec-driver-spectra-mcp', repeat)` 三元组的一次跑批执行，产出 fixture（含 driver 输出、oracle 判分、`claudeArgs`）。
- **V008 取证记录**：针对 V008 三个 run 的结构化取证条目，字段含 `run id`、`closureForm`、`证据门触发状态`、`missing keys`、`最终判定`、`oracle pass/fail`、`fix-report 摘录`、`patch diff 摘要`。
- **四方终表**：跨 feature（F206/F212/F237）沿用的对照表结构，行 = cohort（GStack/c3/c1/c4），列 = 各评测轮次的 pass rate + CI。

## Success Criteria

- **SC-001**：33/33 run 判分零剔除（`infra=0 / error=0 / oracle_error=0 / oracle_missing=0`），或每一处非零剔除都在报告中有明确的分类与原因说明。**验证方式**：聚合产物（如 `f237-headline.json`）的计数字段可读且与报告叙述一致。
- **SC-002**：V008 三个 run 的取证表完整存在（三行不缺），每行含 `closureForm/证据门触发状态/missing keys/最终判定/oracle 结果` 全部字段非空。**验证方式**：人工核对取证表 + 对应审计事件 JSON 落盘文件存在性。
- **SC-003**：`PUBLISH-REPORT-M9-interim.md` 存在，含四方终表更新、C1 红线声明、诚实结论段落（三要素：V008 结果/差距变化/归因或交叉核验）。**验证方式**：文档存在性 + 三要素逐条可定位到具体段落。
- **SC-004**：每个 phase 均有一次对应 Codex 对抗审查记录（可在 trace.md 或 commit message 中定位），critical/warning 项要么已修复要么有明确的"风格偏好不修"备注。**验证方式**：trace.md 时间线含各 phase 的 codex-rescue 调用记录。
- **SC-005**：Push 到 `origin master` 前的交付报告在对话中出现且等到用户明确确认后才执行 push（若本 feature 最终确实需要 push）。**验证方式**：对话记录可追溯"报告→确认→push"顺序，无跳过。
- **SC-006**：诚实结论不依赖预设立场——报告草稿在 V008=0/3、1/3、2/3、3/3 任一实际结果下都不需要推翻既有段落结构（即结论段落的模板设计对"未转化"与"转化"同等对待）。**验证方式**：结论段落显式包含"若未转化的归因路径"与"若转化的交叉核验"两个子结构，而非仅在转化时才有内容。
- **SC-007**：评测产物零污染仓库——`git status` 在报告完成后仅显示预期的显式路径改动（`specs/237-v008-retest-gstack/**` 相关文件），无 `tests/baseline/tasks/`、`tests/baseline/repeats/`、未预期的 `.gitignore` 外产物混入。**验证方式**：`git status --porcelain` 输出核对。
- **SC-008**：成本与配额约束闭环——实付成本（SiliconFlow token 部分）在报告中有明确数字且 <$10；若触发 ≥60% weekly 配额检查点，报告中记录该次询问与用户答复。**验证方式**：报告成本小节存在且数字来源可追溯。
- **SC-009**：`FIX_COMPLIANCE_CLI` 环境变量核验闭环——每次跑批发射前的核验记录（`env | grep -c FIX_COMPLIANCE_CLI` 输出 0）均已留档，且发射器脚本中可定位到显式 `unset FIX_COMPLIANCE_CLI` 语句。**验证方式**：核验记录文件存在性 + 发射器脚本源码核对。

## Non-Goals

- **不改 `plugins/**`**：本 feature 是纯评测复测，不修复 F237 过程中发现的任何 spec-driver/spectra 源码缺陷（发现的真问题转 Followup 候补，参照 F212 §9 模式）。
- **不做 133（M7-era）链或 A/B（opus）链的横比**：C1 红线沿用 F212 §6，本轮只与 F206/F212 全池 sonnet 链的 c3 数字直接横比。
- **不在本 feature 内修复分发问题**：4.4.0 未推送 origin/master、npm 落后、marketplace clone 落后 80 commit（前置条件 P-7）均不在本 feature 处理范围。
- **不推 4.4.0 到 npm 或 marketplace**：与本 feature 目标无关。
- **不修复全局 npm 缓存 4.3.0 的判定器 drift（P-4/P-5）**：已确认（P-6，条件性成立于 P-8+P-9）不影响评测链路，留待后续 feature 视需要处理。
- **不重跑触发率 A/B（F212 US3 已完成的 SC-002/F176 对照）**：本轮范围仅为全池 headline 复测 + V008 专项取证。
- **不实施 F212 §9-2 的 runId 加后缀基础设施修复**：本轮用手动存档规避（见 Edge Cases），基础设施级修复留 Followup。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OAuth 在长批（预估 4-6h）中途再次过期 | 跑批中断，部分 run 产生假 401 | 沿用 F212 resume 机制（(task,tool,repeat) 幂等续跑）+ 长批前后各 preflight 一次 |
| runId 跨链撞名覆盖取证（若本 feature 后续又跑其他链） | V008 取证被静默覆盖 | 跑批完成后立即存档到独立命名路径（Edge Cases 已定义） |
| V008 结果为 X<3 但报告方倾向性归因（confirmation bias） | 结论失去诚实性价值 | SC-006 强制结论段落模板对称覆盖两种结局；Codex 对抗审查 verify phase 专项检查是否有 over-claim |
| 全局 plugin drift（P-4/P-5）被误判为"影响评测"从而浪费时间修复 | 范围蔓延，偏离 headline 目标 | P-6 已给出条件性架构证据说明（依赖 P-8+P-9），写入前置条件供跑批前二次核验，不在本 feature 修复 |
| 配额消耗超预算（周配额被本批大量占用） | 影响其他并行工作的 Claude/Codex 可用性 | FR-011 每 6 run 检查点硬性执行，≥60% 立即停批询问 |
| `FIX_COMPLIANCE_CLI` 环境变量被意外设置指向旧判定器（P-9） | 33 run 全部实际走旧 CLI 判定，且不可察觉，取证与结论失效 | FR-003/FR-013 强制每次发射前显式 `unset` + 核验留档；核验方式不依赖"当前 shell 恰好未设"这一历史事实 |
