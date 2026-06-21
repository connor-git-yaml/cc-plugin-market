# 问题修复报告 — goal_loop full 轮命令集完整性缺失（F203 CRITICAL-8 follow-up）

> **基线**：本修复 rebase 在 F203（`claude/modest-feistel-b070f5` @ `9bb2ea3`）之上，core 为 729 行新版。
> F203 已把 CRITICAL-8 显式 defer 为 follow-up（[verify.md:284](../../plugins/spec-driver/agents/verify.md)），本 fix（编号 204）即承接该 follow-up。

## 问题描述

goal_loop 的**权威达标门禁**（full 轮 `REACHED_GOAL`）不校验 verify 报告的"命令集完整性"，存在 reward-hacking / fallibility 漏洞：

构造一个 `verify_mode:'full'`、`layer2_commands` 只含一条 `{name:'echo ok', exit_code:0}`、`layer1_fr_coverage.p1_coverage_pct=100`、`layer1_5_evidence.status='COMPLIANT'` 的报告，喂给 `decideStop`：
- `parseReport` 放行（schema 必填字段齐、非空命令集、有 exit_code、verify_mode 合法、无 dist_not_built SKIPPED）
- `evaluateMetric` 判 `true`（单条命令全 PASS + 覆盖 100 + COMPLIANT）
- `decideStop` 走 `verify_mode==='full'` 分支 → 返回 `REACHED_GOAL`

即便 full 契约（[verify.md:261-266](../../plugins/spec-driver/agents/verify.md)）要求的 `npm run build` + `npx vitest run` + `npm run lint` + `npm run repo:check` **一条都没跑**，权威强门禁仍被一条 `echo ok` 满足。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | echo-ok full 报告为何被认证 REACHED_GOAL？ | `decideStop`（[goal-loop-core.mjs:394-398](../../plugins/spec-driver/scripts/lib/goal-loop-core.mjs)）的 full 分支只以 `evaluateMetric(report)` 为门禁，而 `evaluateMetric`（L52-71）只校验三件事：所有命令 PASS、`p1_coverage_pct===100`、`evidence.status==='COMPLIANT'`。单条命令即让"全 PASS"在 1 元素集上 vacuously 成立，另两项是 report 自报字段。 |
| Why 2 | `evaluateMetric` 为何不校验"跑了哪些/几条命令"？ | metric 设计围绕**单命令诚实性**（真实 exit_code provenance）+ 覆盖率 + 证据，从未引入**命令集完整性**维度。C3 空集护栏只拒"零命令"，没有"必需集合"的概念——隐含假设"独立 verify 子代理跑了命令并报真实退出码，则它跑的就是该跑的集合"。 |
| Why 3 | 完整性为何被排除在 core/metric 之外？ | F203 有意决策（verify.md:284，CRITICAL-8）：spec-driver 是通用插件，命令集随项目可配，把 `vitest`/`build` 命令名硬编码进 core 是错的；且被判定"与既有信任 verify 子代理 exit_code 的信任模型一致"。完整性被指派给 verify.md 散文契约（full mandate L261-266），而非 core。 |
| Why 4 | 散文契约指派为何不足（这仍是真实漏洞）？ | verify.md mandate 依赖 verify 子代理（可错的 LLM）阅读并忠实产出完整命令集。但 goal_loop 反 reward-hacking 架构（FR-010 / N-01）的立身之本，正是**权威门禁不依赖 LLM 自律**——这才是"独立 verify 子代理 + 真实退出码"存在的理由。F203 的 full 轮**就是**权威强门禁（smoke 明确非权威）。把权威门禁的完整性单独托给 LLM 散文，与该设计原则自相矛盾：被截断/混淆/过拟合的 verify 子代理可产出 `verify_mode:'full'` 却只含子集（甚至一条）命令的报告，core 结构上无从识别。**"信任 exit_code"被偷换成了"信任命令集完整性"——两者是不同的信任维度（单命令真实性 ≠ 正确的集合选择）。** |
| Why 5（根因） | 信任维度为何会被混淆？ | 因为 full 轮**期望命令集从未被机器形式化**——full mandate 只活在 verify.md 散文（[verify.md:261-266](../../plugins/spec-driver/agents/verify.md)），core 侧没有任何**机器可消费的 expected-command manifest**。缺少机器可校验的"期望"，core 的 metric 只能退化为"信任报告自带的命令集"。这才是根因：不是 core 主动"选择信任"，而是 core **没有可校验的期望对象**。（Codex WARNING-1 深化） |

**Root Cause**：goal_loop 权威 full 门禁的"期望命令集"从未被形式化为机器可消费的 manifest——它只存在于 verify.md 散文契约。缺少任何机器可校验的期望，core 的 metric 退化为信任报告自报的命令集，使强门禁可被单条 trivial 命令满足。（"信任维度混淆"是现象，"期望未机器形式化"是根因——方案 A 即为权威路径**创建**这个机器可消费 manifest。）

**Root Cause Chain**：echo-ok full 报告认证 REACHED_GOAL → `evaluateMetric` 仅查全 PASS+覆盖+证据 → metric 退化为信任报告自带命令集 → 因为期望命令集只活在 verify.md 散文、core 无机器可消费 manifest → 完整性被有意 defer 给该散文（为避免硬编码命令名）→ 散文依赖可错 LLM、权威门禁不该如此 → 无 `kind` 分类 + 无完整性测试 → 漏洞潜伏。

`[ROOT CAUSE REACHED at Why 5]`（Why 4 "信任维度混淆"是设计现象；Why 5 "期望未机器形式化"是根因，直接指向方案 A 的本质——把散文 mandate 升级为机器可消费的 config manifest）

**检测盲区（why-not-caught，与根因正交）**：(a) C3 空集护栏制造"完整性已覆盖"的错觉——只挡零命令、不挡欠完整集，且无测试断言"full 缺 mandated 命令 → 不认证"。(b) 命令无 `kind`/分类字段，core 与测试无"必需类别是否齐"的结构抓手——schema 只记自由文本 `name`。(c) F203 在 `parseReport` 加了 full 契约校验（dist_not_built）但窄化到 build-ordering，完整性被显式 defer（CRITICAL-8）而非实现。

## 影响范围扫描

### 同源问题（需修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| goal-loop-core.mjs | `decideStop` L394-398 / `evaluateMetric` L52-71 | full 权威认证不校验命令集完整性 | 引入 config 驱动的 `kind` 完整性校验，full 缺必需类别 → 降级（见策略 A） |
| goal-loop-core.mjs | `parseReport` L616-678 | full 模式契约校验已有 dist_not_built 先例，但无完整性校验 | 候选接缝：在此（或 decideStop）加完整性校验，缺失 → infra-failure |

### 类似模式（已评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| goal-loop-core.mjs | `evaluateSmokeReadiness` L83-98 | smoke 门禁同样不校验命令集 | **`[类似但安全 — 不修]`**：smoke 是**非权威**门禁，仅触发 `escalate_full`、绝不 REACHED_GOAL（[goal-loop-core.mjs:400-405](../../plugins/spec-driver/scripts/lib/goal-loop-core.mjs)）；escalate 后 SKILL.md 强制 full verify 并校验 `curReportFull.verify_mode==='full'`（[spec-driver-feature/SKILL.md:464-475](../../plugins/spec-driver/skills/spec-driver-feature/SKILL.md)）——smoke kind 误标**无法绕过** full 轮，问题只回到 full 完整性校验（Codex INFO-1 代码证实）。F203 verify.md:283（WARNING #3a）已有意接受。scope 收紧在权威 full 门禁。 |
| goal-loop-core.mjs | `detectRegression` L287 | 按 name 比较同模式命令 | `[安全]`：非认证门禁，不影响达标判定。 |

### 同步更新清单

- **core**：`goal-loop-core.mjs` 新增纯函数 `validateFullCommandKinds(report, requiredKinds)` + `decideStop` full 分支在 `evaluateMetric` 前调用它（不改 `parseReport` 签名）。
- **schema 文档**：`agents/verify.md` 给 `layer2_commands[]` schema 加 `kind` 字段说明 + full mandate 各命令标注 kind；把 CRITICAL-8 段（L284）从"有意不在 core 校验/follow-up"改为"已由 204 实现"，保留诚实残留风险说明（误标残留）。
- **config schema**：`scripts/lib/config-schema.mjs` 的 `goalLoopSchema`（L106）加 `full_required_kinds: z.array(z.enum(['build','test','lint','check'])).default([])`，第 5 字段、带 default、非破坏。
- **config 样例**：`spec-driver.config.yaml` goal_loop 注释段（L133）补 `full_required_kinds` 示例；并在本仓库**取消注释/显式设** `['build','test','lint','check']`（dogfood opt-in，闭合实际敞口）。
- **golden 模板（opt-in 兜底必做）**：`templates/goal-loop-override-template.yaml` 写入 `full_required_kinds` 示例值 + 注释——这是"默认 `[]` 不致空转"的关键：推荐配置入口默认带保护。
- **CLI / 编排散文**：**无需改动**（decideStop 接缝 → `parse-report` CLI 签名不变、`spec-driver-feature/SKILL.md` parse-report/decide-stop 调用不变；config 经 decide-stop payload 自带）。
- **测试**：`tests/goal-loop-core.test.mjs` 加 `validateFullCommandKinds` + `decideStop` 完整性用例（见下方验收标准）。新增正例 fixture（带 kind 的 full 报告）；**不迁移**现有无-kind fixture（默认 `[]` 下其测试不走校验，零回归）。

**范围核查**：~6-8 文件 / 1-2 模块（goal-loop + config），低于 fix 模式范围过大阈值（>10 文件 / >3 模块）→ fix 模式合适，与 F203（同类 core 改动走 fix）先例一致。

## 修复策略

### 方案 A（推荐）：config 驱动的 `kind` 完整性校验，full 缺必需类别 → 不认证 + 降级

1. **schema 扩展**：`layer2_commands[]` 每条加 `kind` 字段，枚举 `build | test | lint | check`（语言无关通用类别，恰好对应 verify.md Layer 2 表的 build/lint/test 列；**非命令名**）。verify 子代理产出时标注。
2. **config 契约**：`goalLoopSchema`（[config-schema.mjs:106](../../plugins/spec-driver/scripts/lib/config-schema.mjs)）加 `full_required_kinds: z.array(z.enum(['build','test','lint','check'])).default([])`。**默认值已锁定 `[]`（Codex CRITICAL 处置——此为阻塞条件，不留 plan 悬置）**：
   - 默认 `[]` 是**通用插件唯一正确的默认**：非空默认（如 `['test']`/`['build','test']`）会把某一语言/工具链的命令分类强加给所有消费者（Python 无 build、纯库无独立 lint），等于在 schema 层硬编码了 F203 警告的同类耦合，只是上移一层。
   - 默认 `[]` **同时保住向后兼容**：现有 11+ 处测试与 `report-full-pass.json`（含 build/test/check、**无 lint、无 kind**）都不配置 `full_required_kinds` → 校验跳过 → **零回归**（实测确认该 fixture 被 `evaluateMetric=true` 断言依赖）。
   - **非"默认无效"**：blessed/dogfood 路径显式 opt-in 兜住实际敞口——(i) `templates/goal-loop-override-template.yaml`（goal_loop 推荐配置入口）写入示例 `full_required_kinds` + 注释；(ii) 本仓库 `spec-driver.config.yaml` 设 `['build','test','lint','check']`。goal_loop 本就是 opt-in 高级编排（仅 orchestration-overrides 启用），要求其使用者一并声明期望命令类别是合理的；裸手搓 goal_loop config 而不声明者，是显式放弃该护栏。
3. **core 校验**：新增纯函数 `validateFullCommandKinds(report, requiredKinds) → { complete, missing }`——对 `verify_mode:'full'` 报告取其 PASS 命令的 `kind` 集合，校验 ⊇ `requiredKinds`。`requiredKinds` 为空 → `complete:true`（跳过，优雅降级到现状）。
4. **接缝（已改定，Codex WARNING-3 处置）**：**新增纯函数 `validateFullCommandKinds` 由 `decideStop` 在 full 分支、`evaluateMetric` 之前调用**。优于先前两选项：
   - 不改 `parseReport(jsonText)` 签名 → 不破坏现有调用方/CLI/SKILL.md L428 散文。
   - `config` 已在 decide-stop payload（[goal-loop-cli.mjs:230](../../plugins/spec-driver/scripts/goal-loop-cli.mjs)）→ `full_required_kinds` 随 config 自动流入，无新接线。
   - 插入点最干净：full 缺必需 kind → `decideStop` 返回非认证决策。**on-incomplete 语义（plan 敲定细节）**：倾向返回 `{ stop:true, exit_reason:'INCOMPLETE_FULL_VERIFY', action:'goto_gate_verify' }`（fail-loud：契约违反立即交人工 GATE_VERIFY，比静默计无进展更诚实）；备选复用 infra-failure 计入 NO_PROGRESS（容忍单轮 glitch、预算内可重试）。两者都绝不 REACHED_GOAL。

**与"职责分离/不信任 report 自带字段"原则的张力评估（核心）**：
- F203 defer 理由①"不能硬编码命令名"——**对硬编码方案成立，对方案 A 不成立**：A 从 config 读期望 kinds，命令名/类别由项目配置，core 零 Spectra 特定名。F203 把"别硬编码命令名"（对）外延成了"干脆不校验完整性"（过度）。
- F203 defer 理由②"与信任 exit_code 模型一致"——**实为两种信任维度混淆**：exit_code 信任的是"子代理对**它跑过的命令**报真实退出码"，**不蕴含**"它跑了**正确的命令集**"。
- **保护等级诚实界定（Codex WARNING-2 处置，避免 over-claim）**：`validateFullCommandKinds` 是**对报告自报 `kind` 类别的机器强制完整性校验**，**不是硬结构不变量**——`kind` 与 exit_code 同源、由 verify 子代理自报。其保护边界：
  - **能挡**：遗漏 / 截断（现实的可错-LLM 威胁——子代理漏跑 lint、输出被截断少了命令）。这正是把散文 mandate 升级为机器校验所**真正**新增的保护。
  - **不能挡**：对抗性自我误标（把 `echo ok` 标 `kind:'test'`）。此残留与既有 `dist_not_built` 校验同**层级**（两者都读报告自报字段），亦与 F201 FR-023 既有残口（"无法阻止 implement 篡改测试本身"）同构，由人工 GATE_VERIFY + Codex 对抗审查兜底。
  - **定性**：与 core 既有的 dist_not_built / 缺-exit_code 降级**同类**（机器校验报告自报字段以挡现实失败模式），但**不**宣称是不可绕过的硬不变量。**显著缩小** CRITICAL-8 敞口（挡住遗漏/截断主路径），**不声称完全消除**——与 goal_loop 诚实护栏叙事一致。

### 方案 B（备选，倾向否决）：按命令 name 子串匹配 config 命令集

匹配报告命令 name 与 `verification.commands` 配置名。更字面但脆弱（name 漂移、顺序、部分匹配），且即便名来自 config 仍让 core 耦合命令名字符串。否决，保留 `kind` 抽象（A）。

### 任务给定的另两方向（评估留档）

- **(b) 报告加 `command_set_complete` 自证字段**：**否决**。这正是 core 一贯拒绝信任的"report 自声明"（如 regression、exit_code），等于把漏洞换个名字，弱于 A。
- **(c) 维持现状仅文档化**：**不足**。对"权威 full 门禁"保护不够；F203 已做了 (c)，本 fix 即要超越它。

## Spec 影响

- **必须更新**：`agents/verify.md`（CRITICAL-8 段 L284：defer → 已实现；`layer2_commands[]` schema 加 `kind`）。这是契约文档，与 core 改动同源。
- **建议标注**：F201 `specs/201-goal-loop-agent-mode/spec.md` 的 FR-008（metric 定义）/ FR-010（provenance）可加一句"命令集完整性"维度注记，指向 204；canonical 记录在 204 制品（fix-report + plan + tasks）。
- 无需新建独立 spec.md（fix 模式产物为 fix-report + plan + tasks）。

## 验收标准（Acceptance Criteria）

> Codex INFO-2 处置：把向后兼容从"悬挂风险"升为显式验收条目。plan/tasks 阶段须将下列逐条编码为测试。

| AC | 场景 | 期望 | 验回归基线 |
|----|------|------|-----------|
| AC-1 | 现有无-kind full fixture（`report-full-pass.json`）+ **未配置** `full_required_kinds`（默认 `[]`） | `evaluateMetric=true` / `decideStop`→REACHED_GOAL **不变** | **零回归**（守住 141 pass baseline；现有 11+ 引用全绿） |
| AC-2 | full 报告缺必需 kind（如配置要求 `lint` 但报告无 `kind:'lint'` 命令） | `validateFullCommandKinds.complete=false`；`decideStop` **不** REACHED_GOAL（按定 on-incomplete 语义降级/交 gate） | 新增用例 |
| AC-3 | full 报告含全部必需 kind | `complete=true`；其余条件满足时 REACHED_GOAL | 新增用例 |
| AC-4 | `full_required_kinds=[]`（空/未配置） | `validateFullCommandKinds` 跳过（`complete=true`），行为同现状 | 新增用例（优雅降级） |
| AC-5 | reward-hacking 复现：`verify_mode:'full'` 仅 `{name:'echo ok',exit_code:0}`（无 build/test/lint/check kind）+ 配置要求这些 kind | **不** REACHED_GOAL（漏洞堵死） | 新增用例（CRITICAL-8 直证） |
| AC-6 | smoke 报告（任意 kind 配置） | 不受 `validateFullCommandKinds` 影响（只作用 full） | 新增用例（scope 隔离） |
| AC-7 | config schema：省略/声明 `full_required_kinds` | `validateConfig` 通过；省略时补默认 `[]` | 新增 schema 用例 |

## Codex 对抗审查处置记录（Phase 1 诊断）

> CLAUDE.local.md 强制：每 phase commit 前跑 codex 对抗审查并留档。本轮 1 CRITICAL + 3 WARNING + 2 INFO，全部成立、全部已并入本报告。

| 档 | 发现 | 处置 |
|----|------|------|
| CRITICAL | 默认值未决会让修复在"默认无效"和"默认破坏兼容"间二选一，是阻塞条件非 plan 细节 | **采纳**。锁定默认 `[]`（通用唯一正确默认 + 向后兼容），golden 模板/dogfood config 显式 opt-in 兜底。见方案 A.2，已从"留 plan"改为"已锁定"。 |
| WARNING-1 | Why 链停早；更深根因是"期望命令集从未机器形式化"，非"信任维度混淆"（后者是现象） | **采纳**。Why 链深化至 Why 5（期望未机器形式化），重述 root cause。 |
| WARNING-2 | `kind` 自报，叙事称"结构不变量"过强 | **采纳**。降级措辞为"对自报类别的机器强制完整性校验"，明列保护边界（挡遗漏/截断、不挡对抗误标），残留同 dist_not_built 层级。 |
| WARNING-3 | parseReport 接缝低估第三选项：新纯函数 `validateFullCommandKinds(report,config)` in decideStop，不破坏签名、config 已就位 | **采纳**。接缝改定为此项（方案 A.4），优于 parseReport+加参。 |
| INFO-1 | smoke 排除 scope 有代码支撑（escalate 不变量 + SKILL full verify_mode 校验） | **采纳**。影响扫描 smoke 行补代码证据。 |
| INFO-2 | 向后兼容应升为验收用例 | **采纳**。新增「验收标准」AC-1（零回归）+ AC-2~7。 |
