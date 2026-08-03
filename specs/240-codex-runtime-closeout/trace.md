# F240 执行链路 trace

分支：`claude/codex-hooks-consistency-43ff97`
基线：`2e3a4cd`（≥ 要求基线）
模式：feature（research_mode = tech-only）

---

## Phase 0 — 初始化与基线核对（编排器 inline）

- `git fetch origin master` → HEAD `2e3a4cd` 含要求基线；specs 最大编号 239，240 可用
- `init-project.sh --json` → 全部 ready，无需 constitution
- **降级信号**：插件 cache 路径（`~/.claude/plugins/cache/.../spec-driver/4.4.0`）缺 `zod`，`orchestrator-cli` 回退 fallback 配置。改用**仓内源路径** `plugins/spec-driver/scripts/orchestrator-cli.mjs` 后 `is_fallback: false`、`diagnostics: []`，恢复完整校验。后续所有编排查询均走仓内源路径。
- 项目无 `.specify/orchestration-overrides.yaml` → implement phase 走 single 分派（**不进 goal_loop 闭环**）
- `gate_policy: balanced`

## Phase 0.5 — 调研模式确定（编排器 inline）

判定 `research_mode = tech-only`：需求为内部工程收口，无产品面；但 A3① 依赖"Codex 当前支持哪些 hook event"这一**外部事实**，必须查证。product-research 跳过。

## Phase 1b — 技术调研（委派 `spec-driver:tech-research`，sonnet）

产物：`research/tech-research.md`
- 交叉印证上游 issue（openai/codex#16732 / #17794 / #18491 / #20204），确认 apply_patch hook 覆盖长期不稳定
- 一手复用 F213 实测结论：`.codex-plugin/plugin.json` **不支持** hooks 字段
- 完整 `~/.codex` 硬编码点清单；确认仓库**零处**读取 `CODEX_HOME`
- **诚实标注**：对 `learn.chatgpt.com/docs/hooks` 的 WebFetch 结果判定为可疑（疑似模型用 Claude Code 已知知识填补），**不采信**

## Phase 1b' — 编排器本机端到端实测（inline，上下文扫描）

产物：`_grounding.md` §1~§8

方法：隔离 `CODEX_HOME=$(mktemp -d)` + 探测脚本落盘 payload + 真实 `codex exec` turn。**真实 `~/.codex` 全程未被写入；复制入沙箱的凭据已在实测后删除；沙箱已销毁。**

关键确证：
| 结论 | 方法 |
|---|---|
| `hooks` feature = stable / 默认开启 | `codex features list` |
| 10 个 hook event 全集，**不含** Worktree 系列 | 二进制内嵌枚举 |
| hooks 声明位置 = `$CODEX_HOME/hooks.json`（顶层） | serde 错误消息逐层反推 |
| 顶层字段仅 `description` / `hooks`；handler `type` **必填**，取值 `command\|prompt\|agent` | 同上 |
| **PascalCase 生效、snake_case 静默失效；未知事件名不报错** | 同一文件同时声明两套，观察触发 |
| **hooks 默认不执行**，需持久化信任；`--dangerously-bypass-hook-trust` 可绕过 | 第一次真实 turn 四 hook 全未触发；加 flag 后全触发 |
| **`tool_name` 实测为 `Bash`**，无结构化文件路径 | 真实 turn 捕获 payload |
| Stop payload **无 `tool_name`**，含 `last_assistant_message` / `stop_hook_active` | 同上 |
| hook 进程有 `CODEX_HOME`、**无任何 plugin-root 变量** | hook 内 `env` dump（已声明测量污染判据） |
| Codex rollout transcript 为 `{timestamp,type,payload}`，与 Claude **格式完全不同** | 读真实 rollout 文件 |
| `codex doctor --json` **完全尊重 CODEX_HOME**，18 个 check 与本 feature **零重叠** | 隔离 CODEX_HOME 下实跑 |

**自我更正两处**：早前据 TS 类型推断"handler 无 `type` 字段"被实测证伪；A3③ 的理由由"transcript_path 可能为 null"修正为更强的"wire format 异构"。

## 🔴 用户决策点（需求前提与事实冲突）

实测暴露 A3② 原始表述与 Codex 实际工具模型不匹配（无 Edit/Write 工具、apply_patch 不发 hook、无结构化路径）。**未自行降级**，提交用户拍板：
1. **A3② → 缩范围，诚实挂账上游缺口**（E2E 基于真实 Bash 事件；禁止解析 shell 命令提路径）
2. **hook 信任 → 写进文档 + 诊断给 next-step，不自动绕过**

## Phase 2 — specify（委派 `spec-driver:specify`，sonnet）

产物：`spec.md` rev1（217 行，10 FR）

## Phase 3 — 设计前置并行组 + 对抗审查（三方并行）

| 通道 | 执行体 | 结论 |
|---|---|---|
| clarify | `spec-driver:clarify`（sonnet） | 6 处扫描，3 处真实歧义（#3/#5/#6）需 plan 前消解 |
| checklist | `spec-driver:checklist`（sonnet） | 9 维度约 60 项，**发现 spec 缺独立 Success Criteria 章节** |
| Codex 对抗审查 | `codex:codex-rescue`（后台，7m13s） | **6 CRITICAL + 8 WARNING**，裁定"不能进入下一阶段" |

**编排器补充核对（实读代码，三方均未覆盖）** → `_grounding.md` §9：
- §9.1 `fix-compliance-verdict` 由判定器**自身**写入，作主信号构成**自我印证闭环**；`workflow-run-summary` 由 `record-workflow-run.mjs:160` 独立写入，才是有效信号
- §9.2 `resolveTargetDir` **同一函数两分支语义相反**（global 需 helper / project 绝不能）；仓库内 `.codex/skills/` 是 F238 wrapper 产物，误改**同时打断 `repo:check` 与 F238 门禁**
- §9.3 `$CODEX_HOME/hooks.json` 是**全局单文件**，直接写入摧毁用户既有配置；**且本仓库已有现成可复用模式** `src/hooks/hook-installer.ts`（18 单测全绿），禁止另起炉灶

**编排器裁定**：Codex WARNING 7（建议拆分 A3/A4 为两个 feature）**不采纳** —— 用户需求原文即"A 轨最后两件合一线收口"；但**采纳其折中**：A3/A4 各自独立的验收状态与任务批次。

## Phase 4 — spec 修订（委派 `spec-driver:specify`，**opus**）

产物：`spec.md` rev2（716 行，13 FR，**24 SC**，§12 修订记录）
- CRITICAL 6/6 闭合，WARNING 7 修 + W7 按裁定不采纳，编排器 §9 三项闭合，checklist/clarify 6/6 闭合
- 复杂度自评 **HIGH**（触及 `fix-compliance-judge` 与 wrapper sha 门禁链路）

编排器抽查复核（W1 / O1 / §9.2 / C3 / SC 编号连续性）→ 均真实闭合，非纸面声称。

## GATE_DESIGN

`behavior=always` / `is_hard_gate=true` / `severity=critical` → 暂停等待用户确认（编排器不得自行判定质量良好而跳过硬门禁）。
**用户裁定：放行**，并确认两项人工验证按挂账处理。

## Phase 5 — plan（委派 `spec-driver:plan`，**opus**）

产物：`plan.md` rev1（1140 行）

plan 实读代码后提出**两条 spec 未覆盖、按字面实现必然出错**的发现，编排器逐条独立核验：

| # | plan 的论断 | 编排器核验 |
|---|---|---|
| 1 | `fix-compliance-judge.mjs:334-347` 的 `releaseDegraded()` 自己写 `workflow-run-summary`，`runId === sessionId` | ✅ 属实（实读源码 + 实读 `.specify/runs/` 数据双证） |
| 2 | `record-workflow-run.mjs` 全文无 `sessionId/turnId` | ✅ 属实（grep 零命中） |
| 3 | `JUDGE_FILE_SET` 当前 6 项 | ✅ 属实 |
| 4 | `runHook` 存在 `!isFix → return 0` 静默路径 | ✅ 属实（`:411`） |
| 5 | Codex 下 `pre-tool-use-guard.sh` 的 grep 会误抓命令字符串 | ⚠️ 编排器初判"成立但条件窄"，后被 Codex 审查**证伪**（见下） |

→ 编排器据此**更正 `_grounding.md` §9.1**（新增 §9.1.1）：我先前"`workflow-run-summary` = 编排器独立写入"的二分法**不成立**。方法论教训：判定某数据源是否独立于判定器，必须对**每个**候选 eventType 分别枚举全部写入方，不能因"看起来像编排器的事件"就免检。

## Phase 5' — plan 的 Codex 对抗审查（后台，约 10 分钟）

**5 CRITICAL + 4 WARNING，裁定"不建议通过该 plan"。** 编排器逐条核验：

- **A5 反证成立**：Codex 指出 `tool_input.command` 是 JSON 字符串，命令内引号被序列化为 `\"`，grep 模式 `"file_path"` 无法命中。编排器实跑复现（构造含 `{"file_path": "src/x.ts"}` 的命令 → 脚本退出码 0）→ **plan 与编排器此前共同接受的推论被证伪**，该改动移出本 feature
- **CRITICAL 1 属实**（编排器实测确证）：编排器侧写入的正常 `workflow-run-summary` **无任何合规判定字段**；唯一带 `complianceVerdict` 的恰是判定器自写的那条 → 排除后**无合规信息可读**，主信号方案在数据层面走不通
- **CRITICAL 2 属实**：`.specify/runs/` 是判定进程自身可读写删的普通文件，**不构成可信安全边界**；可构造主动触发的绕过
- CRITICAL 3/4/5 与 WARNING 1~4 均属实

## 🔴 用户决策点二（需求手段与事实再次冲突）

A3③ 指定的手段（读 `.specify/runs/` 作主信号）经证伪不可达，但其**意图**（Codex 下不得静默失效）真实。**未自行降级**，提交用户拍板：

- **决策三：A3③ 改道** —— 从"换主信号源"改为"**判不了就大声报**"：判定器结构性识别出 Codex rollout 格式后**显式落盘 loud 诊断**，取代当前 `:411` 的静默零落盘。放行语义不变（`exit 0`）。**明确不承诺**提供第二事实源或提高安全强度——这是可观测性改进。
- **决策四：分批交付** —— **R1 = A4 先行**完整交付并过全量门禁；**R2 = A3** 同分支随后交付、独立验收。仍属同一 feature，不拆分。

## Phase 6 — tasks（委派 `spec-driver:tasks`，sonnet）

产物：`tasks.md` rev1（63 任务，SC 全覆盖）。其独立建议（"若需分批优先完成 A4"）与用户决策四一致。

## Phase 6' — 三制品定向修订（并行委派）

| 文件 | 执行体 | 轮次 | 处置 |
|---|---|---|---|
| `spec.md` | `spec-driver:specify`（opus） | rev3 | 决策三/四 + C4/C5/W2/W3；FR 13 条、**SC 26 条**（1 废止保号、2 新增、6 改写） |
| `plan.md` + `tasks.md` | `spec-driver:plan`（opus） | rev2 | 决策三/四 + C4/C5/W1/W2/W3/W4；批次重排为 R1/R2 |

**plan 修订期的新发现（rev1 未覆盖）**：新方案**绝不能用"不是 fix 会话"反推格式方言** —— 否则每个正常 Claude 非 fix 会话都会落盘诊断，直接击穿 `fix-compliance-judge.mjs:410` 注释写明的「US5：健康路径不产生任何落盘」不变量。已固化为"正向识别 + 存在任一 Claude role 即判 claude"规则与专项负向用例。

**改道后的实读结论**：改动面缩至三处（`fix-compliance-core.mjs` 新增纯函数、`fix-compliance-judge.mjs` 的 `!isFix` 分支接线 ≤8 行、`runHook` 既有出口逐字不变），**`JUDGE_FILE_SET` 无需变更**（新代码落在已在清单内的文件，不新增 import）。

**验收口径更正（Codex W3）**：仓库完整测试入口是 `npm test`（= `vitest run && npm run test:plugins`），只跑 `npx vitest run` **会漏掉 `.mjs` 插件测试**——而本轮要改的判定链**恰恰只被这批 `.mjs` 覆盖**。全部门禁命令已更正。

---

## 设计阶段交付物

| 文件 | 行数 | 说明 |
|---|---|---|
| `spec.md` | 854 | 13 FR / 26 SC，rev3 |
| `plan.md` | 1228 | 六阶段设计，rev2 |
| `tasks.md` | 646 | 63+ 任务，含 SC 映射表与人工挂账，rev2 |
| `_grounding.md` | 646 | **一手实测事实源**，含两次自我更正 |
| `research/tech-research.md` | 157 | 技术调研 |
| `clarification.md` | 124 | 歧义扫描 |
| `checklists/requirements.md` | 117 | 需求质量清单 |

## 范围外发现（已开独立 follow-up）

`pre-tool-use-guard.sh` 的"禁止直接编辑 src/"守卫**一直空转**：它读顶层 `.file_path`，而真实 payload 里该字段在 `tool_input` 下。编排器实测：嵌套 payload → 退出 0 放行；扁平 payload → 退出 2 阻断。根因是**零测试覆盖**。详见 `_grounding.md` §9.4。**本 feature 明令不修**（修好会让沉默门禁突然生效，属高影响面变更）。

---

## 基线记录（A/B 回归判据）

修订前跑通，作为"后续失败是否自己引入"的对照：
```
npx vitest run tests/unit/{hook-installer,git-hook-installer,worktree-lifecycle-hook,auth-detector,skill-installer}.test.ts
→ 5 files / 69 tests passed
```

## Dogfooding 反馈（累计，收尾汇总用）

1. **Spectra MCP `impact` 参数名**：server instructions 描述为"某 symbol 的 BFS 影响面"，但实际入参是 `target`；传 `symbol` 报 `Invalid arguments ... Required at target`。描述与入参名不一致，首次调用即失败。
2. **Spectra MCP `impact` 返回空**：对 `resolveTargetDir` 查询，fuzzy 正确解析到 `src/installer/skill-installer.ts::resolveTargetDir`（confidence 0.9），但 `affected: []` / `directCallers: 0`。该函数在仓内确有调用方，疑为图陈旧或 caller 边缺失。`nextStepHint` 正确引导改用 `context`。
3. **spec-driver 插件 cache 缺 zod**：`orchestrator-cli` 在插件 cache 路径下静默降级为 fallback 配置（项目级 overrides 不生效）。仓内源路径可规避，但默认路径的降级对使用者不可见。

---

## Phase 7 — implement：R1 批次 / Phase A（T007~T015）

**委派**：`spec-driver:implement`（opus）。首轮子代理在 91 次工具调用后因 API 连接中断，**编排器查磁盘确认产物完整后接手验证**（未用 SendMessage 恢复大 transcript——既往该路径死亡率高）。

**产出**：
- `src/core/codex-home.ts` — `resolveCodexHome` 纯函数（强制显式注入、零 I/O）+ `resolveCodexHomeFromProcess`（全仓唯一读 `process.env`/`homedir()` 处）
- `src/core/codex-home-access.ts` — `probeCodexPath` 经 `statSync` 区分 ENOENT/ENOTDIR 与 EACCES/EPERM
- `plugins/spec-driver/scripts/lib/codex-home.sh` — shell 侧对拍实现
- 5 个测试文件（含 scope-boundary 负向守卫与 global-path-wording 反向守卫）

## Phase 7' — implement 的 Codex 对抗审查

**0 CRITICAL / 4 WARNING**，裁定"不建议原样合入"。**最高优先的 global/project 边界逐点全部合规**（含 Claude global 未被劫持）；断言未被删除或弱化（变异测试思想实验确认守护力）；wrapper sha 自洽；未打红 F236；无越界。

四项 WARNING 全修：
| # | 问题 | 处置 |
|---|---|---|
| W1 | 注释声称「逐字节等价」但实际不等价；消费链产生 `//` | 移除 over-claim，改为明确等价范围 + 3 行已知差异表；消费链改 `codex_path_join`；含换行的 `CODEX_HOME` 两侧 fail-loud 拒绝；dot-segment 如实登记为已知差异（在 bash 重实现 `path.normalize` 等于手写路径解析器 = F231 证伪的逃逸面类型，且词法折叠在 symlink 下反而不正确） |
| W2 | `existsSync`/`[[ -d ]]` 把 EACCES 静默压成"不存在" | 改为可区分 errno 的探测；默认路径保持既有宽松行为 |
| W3 | adapter 文案与 CLI 帮助仍无条件写 `~/.codex`，致 9 个 wrapper 同文件内自相矛盾 | 已修 + `repo:sync` 重生 + 新增反向守卫（已做变异测试验证守护力） |
| W4 | `feature-213` E2E 继承外部 `CODEX_HOME` 却固定清理默认目录 → 假绿 | 显式隔离子进程环境 + 按生效 home 清理 + 残留断言 |

**实施期自行发现的真实缺陷**：shell 的 `${v//\/\//\/}` 在 **bash 3.2（macOS 自带 `/bin/bash`）会产出字面反斜杠**，把 `//x` 损坏为 `\/x`；脚本用 `#!/usr/bin/env bash`，解释器取决于 `PATH`。已重写为零反斜杠转义实现，并让对拍矩阵**对机器上每个 bash 版本各跑一遍**（F232 教训：本地默认解释器全绿 ≠ 其他环境绿）。

## 交付状态（截至 923dd27）

| 批次 | 范围 | 状态 |
|---|---|---|
| 设计 | 调研 / spec / plan / tasks / grounding | ✅ 已交付 `c5337c2` |
| **R1 / A4 Phase A** | A4① `CODEX_HOME` helper、A4② 消费点统一 | ✅ 已交付 `923dd27` |
| R1 / A4 Phase D | A4③ 四方一致性诊断 CLI、脱敏、inventory（T044~T051） | ⬜ 未开始 |
| R2 / A3 | A3①②③④（T016~T043） | ⬜ 未开始 |
| 人工挂账 | T062（hook 信任真实授予）、T063（F239 T039） | ⬜ 待用户执行 |

**门禁基线（923dd27 时点，全部实跑）**：
- `npm test`：vitest **495 files / 6170 passed / 0 failed**；test:plugins **1065 pass / 0 fail**
- 回归基线：69（改动前）→ 77（迁移后）→ **80**（修复后），逐轮只增不减、零断言删改
- `npm run build` ✓ / `npm run repo:check` 仅预存 `graph-quality:freshness` warn / `npm run release:check` valid
- `feature-213` E2E 真跑 2/2 通过
