# 技术规划研究记录：Fix 模式流程依从性结构化保障

**特性分支**: `208-fix-mode-process-compliance`
**阶段**: Phase 0（`/spec-driver.plan` 技术决策）
**前置**: `research/tech-research.md`（方案 a+c+d 论证）、`research/harness-verification.md`（三重实锤）、`trace.md`（编排裁决与实测前提）

## 说明

spec.md 的全部 `Clarifications` 已在 specify/clarify 阶段闭合，本文档**不处理产品级歧义**，只处理运行时上下文中明确列出的 9 个"勿手挥"技术难点（a-i）。每条按 Decision / Rationale / Alternatives Considered 记录，供 GATE_DESIGN 审查与 tasks 阶段拆解依据。

---

## D1（对应难点 a+b）：判定窗口锚定与会话→特性目录绑定

**Decision**：
1. 在 transcript（JSONL，逐行一条会话事件）中用正则 `Base directory for this skill:\s*(\S*)\/skills\/spec-driver-(\S+)` 扫描全部 user 消息文本块，提取 `(pluginPath, mode)`；取**索引最大**（最晚出现）的匹配作为"最新一次技能展开"。
2. 若该最新展开的 `mode !== 'fix'` → 判定为非 fix 会话（即便更早出现过 fix 展开），零接触放行，不再执行后续任何判定逻辑。
3. 若 `mode === 'fix'` → 记录该匹配的行索引为 **anchorIndex**，后续仅统计 `index > anchorIndex` 的委派记录（`tool_use.name ∈ {Agent, Task}`）与制品路径提名痕迹。
4. 特性目录候选提名（**[REVISED-BY-ORCHESTRATOR: 采纳 codex plan 审查 W-3，扩展提名源防误伤 Bash 写制品的诚实流程]**）从两类 tool_use 提取：(i) `name ∈ {Write, Edit}` 的 `input.file_path`；(ii) `name === 'Bash'` 的 `input.command` 命令文本（fix SKILL 的目录创建走 Bash 脚本、制品写入未强制限定 Write 工具）。两类来源均用同一正则 `specs/\d+-fix-[a-z0-9-]+/?` 提取候选，取最后一次出现者。**提名仅是候选，不是判据**——候选目录及其制品必须在磁盘上**实际存在**（`fs.existsSync` + 内容锚点校验）才采信；transcript 文本提到路径但磁盘无实物 → 视为"无特性目录"（对应 F206 坍塌 run 连目录都不建的场景）。Bash 命令文本是模型自撰字符串，但其只承担提名角色，磁盘核验才是判据来源，不违反 FR-005。

**Rationale**：直接落实 FR-007/FR-008 与 Edge Case"同一会话内多次/多技能展开"的裁决；用 transcript 索引位置而非时间戳做窗口切分，避免依赖可能缺失的时间字段。特性目录候选取 transcript 内痕迹而非"目录列表最新 mtime"，因为后者在坍塌 run（未建目录）与并发 fix 会话共存时都不可靠。

**[REVISED-BY-ORCHESTRATOR: 反伪造锚点硬化（主编排器复核发现的 Goodhart 洞）]** 展开痕迹扫描**只允许匹配 user 消息中 `type: "text"` 的内容块（或 content 为纯字符串的形态），必须显式排除 `type: "tool_result"` 内容块**。原因：tool_result 在 transcript envelope 中同样挂在 user 角色消息下，若不排除，模型可通过 `Bash(echo "Base directory for this skill: /x/skills/spec-driver-story")` 等自导自演的工具输出，在 transcript 中制造一个"更新的非 fix 展开"假锚点，使判定器按 D1 规则 2 零接触放行，整道门被绕过。真实技能展开是 harness 直接写入的 user 文本块，模型无法在 text 块中注入内容（模型输出只会出现在 assistant 消息或 tool_result 块中）。测试 fixture 必须包含"tool_result 中携带伪造展开痕迹"的对抗样例（`fake-anchor-in-tool-result.jsonl`），断言其不改变锚定结果。

**Alternatives Considered**：
- 用 `specs/*/` 目录 mtime 找最新目录 → 拒绝：坍塌 run 根本不建目录，且并发多会话时 mtime 无法归因到具体会话。
- 用会话开始时间戳过滤 → 拒绝：headless payload 未确认提供稳定会话起始时间，transcript 索引位置是已验证可得的信号（harness-verification.md 实锤）。

---

## D2（对应难点 c）：阻断计数存储与不可写降级语义

**Decision**：
1. 主存储路径：`.specify/runs/.fix-compliance-state/<session_id>.json`（`.specify/runs/` 已被仓库既有 `.gitignore` 规则整段忽略，无需新增规则）；写入前 `fs.mkdirSync(dir, { recursive: true })`。
2. 若主路径写入/读取失败（权限、只读文件系统等）→ 降级尝试 `os.tmpdir()/spec-driver-fix-compliance/<session_id>.json`。**[REVISED-BY-ORCHESTRATOR]** `session_id` 作为文件名组件前必须做白名单化清洗（仅保留 `[A-Za-z0-9._-]`，其余字符替换为 `_`；清洗后为空则用 `unknown-session`）——payload 由 harness 提供通常是 UUID，但防御性清洗杜绝路径穿越/非法文件名，成本一行。
3. 若两级存储均不可用 → 判定为 **state-storage-unavailable**：本次不再尝试维持"阻断计数"这一历史状态（无法可靠区分这是第几次阻断），直接按等同于"已达上限"的方式处理——放行本次收口并标注 `[GATE-DEGRADED]`，同时把不合规缺失项与 `state-storage-unavailable` 诊断一并写入 reason 文本与审计事件。
4. 单次会话内合规判定本身（是否达标）**不受**存储可用性影响——存储只影响"阻断 vs 降级放行"这一路由决策，不影响"合规与否"这一底层结论。

**Rationale**：这是运行时上下文难点 (c) 明确要求平衡的两个约束——"不得因此跳过拦截"与"fail 语义对齐 FR-013（不得崩溃、不得无界阻塞）"。字面上二者在存储永久不可写场景下无法同时以"每次都硬阻断"的方式满足（会制造真实死循环，与 FR-006 立项动机直接冲突）。裁决取"不跳过拦截"= 不静默放行、不吞掉缺失项反馈（信息层面的拦截语义仍然生效，agent 依然会在 reason 文本中看到缺口），但执行层面的"硬阻断（exit 2）"在存储结构性不可用时退化为"信息性放行"，避免把一次环境故障放大成会话级死锁。这一权衡在 plan 阶段显式记录，供 GATE_DESIGN 审查置评。
5. 计数语义：非降级路径下，命中不合规时先读计数 `N`；若 `N < 2` → 阻断（exit 2），随后把计数写为 `N+1`；若 `N >= 2`（此前已阻断满 2 次）→ 本次直接降级放行（不再累加），标注 `[GATE-DEGRADED]`。

**Alternatives Considered**：
- 存储不可用时默认 `N=0`（每次都当作"第一次"）→ 拒绝：在存储持续不可写的环境下会造成每次都判定"未达上限"从而永远阻断，制造真实的无界阻塞，与 FR-006 立项动机（防死循环）直接矛盾。
- 存储不可用时直接判定为非 fix 会话放行（复用 FR-013 fail-open 分支）→ 拒绝：这会掩盖"合规判定本身其实是有效的"这一事实（transcript 解析成功、确实不合规），把两类完全不同性质的失败（判定能力缺失 vs 历史状态丢失）混为一谈，违反 FR-015 判定顺序"禁止用单个 catch-all 同时接住两类失败"的同源精神——即便 FR-015 该条文本身讲的是配置层，但其类型化区分回落原则应类推适用于本处的存储层失败。

---

## D3（对应难点 d）：hook 形态与职责切分

**Decision**：三层职责切分，直接复用仓库既有 `goal-loop-core.mjs`（纯函数）/ `goal-loop-cli.mjs`（I/O 边界）分层惯例：

| 层 | 文件 | 职责 | I/O |
|----|------|------|-----|
| Bash 入口 | `plugins/spec-driver/hooks/stop-fix-compliance-check.sh`（新增） | 读 stdin，调用 Node CLI，按 CLI 退出码原样转发（0/2），任何非 0/2 的异常退出码一律兜底为 0（放行） | 仅 stdin 转发 + 退出码转发，无自身判定逻辑 |
| Node CLI | `plugins/spec-driver/scripts/fix-compliance-judge.mjs`（新增） | 解析参数与 stdin payload，编排 io 层读取（config/transcript/state）→ 调用 core 层纯函数判定 → 编排 io 层写入（audit 事件、阻断计数、必要时的 record-workflow-run 降级事件）→ 决定退出码与 stderr 文本 | 顶层 try/catch 包裹全部逻辑，任何未预期异常 → 视为 FR-013 内部异常，exit 0 |
| Node 纯函数核心 | `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（新增） | `detectFixSkillExpansion` / `extractDelegationsAfter` / `classifyDelegationRole` / `resolveFeatureDirCandidate` / `checkArtifactSection` / `classifyClosureForm` / `judgeCompliance` / `resolveEnforcementFromConfig`（纯函数，仅接收已解析的 transcript 条目数组与配置对象，不碰 fs/环境变量） | 零 I/O，可直接单测 |
| Node I/O 边界 | `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`（新增） | `readHookPayload` / `readTranscriptEntries`（含体积上限与逐行容错解析）/ `findAndParseConfig`（复用 `simple-yaml.mjs`，非 zod 路径）/ `loadBlockState` / `saveBlockState` / `appendAuditEvent` / `checkFeatureDirOnDisk` | 全部 fs 操作与降级捕获collected 于此 |

stdin payload 中的 `stop_hook_active` 字段**不参与**核心判定（阻断计数已用会话级持久状态覆盖其设计意图），仅作为诊断信息透传进审计事件，便于事后观察 Claude Code 是否出现非预期的重复触发模式。

与既有 `stop-task-check.sh` 的区分：两者作为 `hooks.json` `Stop` 数组下的**两个独立条目**并存（不改造既有脚本），输出前缀分别为 `[提醒]`（既有，非阻断）与 `[FIX-COMPLIANCE]`（新增，阻断型正常反馈）/`[GATE-DEGRADED]`（新增，阻断型降级放行反馈），满足 FR-010 的稳定前缀可区分要求。

**Rationale**：复用仓库同作者群体已验证过的纯函数/IO 分层惯例（F201/F204），降低认知负担与测试成本；顶层 try/catch + bash 兜底构成"双保险"的 FR-013 fail-open 实现（即便 Node 判定器自身抛出未捕获异常，bash 层仍能兜底为放行，不会把 Node 的崩溃行为泄漏为 Claude Code 侧的未定义阻断）。

**Alternatives Considered**：
- 单文件承载全部逻辑 → 拒绝：违反"函数/方法保持单一职责"与既有分层惯例，且不利于对判定核心做零 I/O 单测（C-003 的"零 LLM/零委派"更容易在纯函数层面被静态验证）。
- 用 `timeout` bash 命令强制超时 → 拒绝：macOS 默认不带 GNU `timeout`（需 `coreutils` 提供 `gtimeout`），跨平台不可靠；改用体积上限（见 D6）作为主要性能防线。

---

## D4（对应难点 e）：审计事件落盘设计与 record-workflow-run.mjs 升级边界

**Decision**：
1. **新增独立事件类型** `fix-compliance-verdict`，复用 `.specify/runs/YYYY-MM.jsonl` 同一月度文件（与 `workflow-run-summary` 事件共存）。已确认现有消费者 `generate-adoption-insights.mjs` 按 `entry.eventType !== 'workflow-run-summary'` 过滤未知类型，天然兼容新增事件类型，无需改动该文件。
2. 该事件在以下三种情形写入（合规放行的happy path**不**写入，保持零额外 I/O 开销）：不合规且阻断（含 1st/2nd 次）、不合规且 `warn` 档反馈、判定异常/降级（FR-013/D2 触发路径）。
3. **`record-workflow-run.mjs`（FR-014 升级）**：新增可选字段 `complianceVerdict`（对象，含 `closureForm` / `compliant` / `missing[]` / `degraded` / `blockCount`），仅当调用方显式传入对应新增 CLI flag（`--compliance-closure-form` / `--compliance-compliant` / `--compliance-missing` / `--compliance-degraded` / `--compliance-block-count`）或以编程方式传入 `options.complianceVerdict` 时才出现在事件对象中；未传入时事件结构与现状字节级一致（`JSON.stringify` 不含该键，非仅仅值为 `undefined`）。
4. **该新增能力仅有一个调用方**：Stop hook 判定器在"降级放行"（第 3 次及以后不合规仍放行）分支，**直接 `import { recordWorkflowRun } from '.../scripts/record-workflow-run.mjs'` 编程调用**（非再起子进程），补写一条 `workflowId: 'spec-driver-fix'`、`result: 'failed'`、`warnings: ['[GATE-DEGRADED] ...']`、`complianceVerdict.degraded: true` 的 `workflow-run-summary` 事件——这是唯一需要落在"标准工作流运行记录"schema 里的场景，因为它代表一次**真正走到会话终点、但从未合规收口**的 fix 会话，其余 4 个既有 SKILL 调用方与 fix 自身既有的"运行事件记录"步骤**逐字不变**。**[REVISED-BY-ORCHESTRATOR: 降级终态幂等]** 阻断计数状态文件增加 `degradedRecorded: true` 标记：交互式会话在降级放行后若继续对话并再次触发 Stop 且仍不合规，只重复输出 `[GATE-DEGRADED]` reason 与轻量 `fix-compliance-verdict` 审计事件，**不再**重复写 `workflow-run-summary` 终态事件（避免同一会话产生多条 `failed` 终态记录污染 adoption 统计）。
5. **不在 fix SKILL.md 自身的"运行事件记录"步骤引入合规校验自证**：因为该步骤由模型执行 Bash 调用，若让其自行传入委派计数/制品状态作为"合规证据"，等同于重新引入 FR-005 明令禁止的"模型自陈判据"（即便只是信息性字段，也会给未来维护者制造"这个字段能代表真实合规状态"的错觉）。真正的合规判定，只在 harness 触发的 Stop hook 内完成，SKILL.md 侧不新增任何自证式判定文本。

**Rationale**：满足 FR-006 双写要求（reason 文本 + `record-workflow-run.mjs` 事件字段）且不重复实现判定逻辑；避免为满足字面"5 个 SKILL 调用方全部升级"的联想而人为制造第二条判定链路（Constitution III YAGNI + FR-005 精神一致性优先于字面联想）。

**Alternatives Considered**：
- 让 fix SKILL 自身的收口步骤调用判定器并把结果传给 record-workflow-run.mjs（"自检丰富化"）→ 拒绝：该步骤缺少 transcript_path（这是 harness 通过 hook payload 才提供的信息，模型 Bash 调用不具备等价获取路径），若改为模型自报委派计数则直接违反 FR-005；即便标注为"仅信息性、不阻断"，也会制造未来被误用为判据的隐患。留作后续 Feature 候选（如果确认可行的 transcript_path 传递方式）而非本次强行拼凑。
- 为 hook 的每次阻断都写一条 `workflow-run-summary` → 拒绝：1st/2nd 次阻断时会话尚未终结（模型会继续尝试补救），此时写"运行汇总"在语义上不成立（该 schema 代表工作流的终态），故 1st/2nd 次阻断仅写轻量的 `fix-compliance-verdict` 审计事件，不动 `workflow-run-summary`。

---

## D5（对应难点 f）："确认无需改动" 出口的 SKILL.md 设计落点

**Decision**：
1. 在 Phase 1（问题诊断）内新增一个显式判定分支（不是新的独立 Phase 编号，避免打乱既有"4 阶段"心智模型与既有 `--completed-phases` 取值集合）：诊断完成后，若结论为"问题已不存在/无需代码改动"，则：
   - 输出 `[1/4] 诊断结论：无需代码改动，走轻量出口`
   - 写入**精简版** `{feature_dir}/fix-report.md`（no-op 变体模板，见下），必须包含 canonical 标题 `## 判定依据`（判定器按此标题做机械匹配，见 FR-012a）
   - 委派至少 1 次 **verify 类**子代理交叉核实该判断（canonical 调用文本：`Task(description: "交叉核实无需改动判定", ...)`，desc 必须含"核实"以命中 no-op 角色判据；例如委派一次范围有限的 verify/spec-review 子代理确认"该问题相关代码路径确无缺陷"）——**不进入 Phase 2/3**（无需规划/无需修复代码）。制品写入统一使用 Write/Edit 工具（便于判定器从 transcript 提名特性目录，Bash heredoc 写制品仍可被 Bash 命令文本提名兜底，见 D1 修订）
   - 直接进入"运行事件记录"步骤，`--completed-phases` 传 `diagnose,no-op-verify`（区别于修复收口的 `diagnose,plan,implement,verify`，供人工审计一眼区分收口形态）
2. no-op 精简模板：

   ```markdown
   # 问题核实报告（无需改动）

   ## 问题描述
   {用户原始描述}

   ## 判定依据
   {为何判断问题已不存在/无需代码改动的具体证据：如指向已生效的历史修复 commit、
   实际复现测试结果、相关代码路径现状摘录等——不得是空泛的"经检查确认无问题"}

   ## 交叉核实委派
   {委派的子代理角色 + 核实结论摘要}
   ```

3. **Phase 范围过大检测**与**轻量验证路径（4a/4b→4c）**两处既有机制与 no-op 分支互不干扰：no-op 分支在 Phase 1 内部短路收口，根本不会走到 Phase 4 的路径选择逻辑。

**Rationale**：直接落实 FR-003/FR-004 与 Story 2；把判据锚点（`## 判定依据`）显式写死在模板里，使 FR-012a 的机械章节匹配有一个稳定、唯一的字符串依据，避免"语义相近但字面不同"的标题绕过或误判。

**Alternatives Considered**：
- 新增独立 "Phase 0.5" 编号 → 拒绝：与既有 4 阶段编号体系冲突，且该判定天然属于诊断阶段的产出分支，非独立阶段。
- 判据小节标题留给模型自由发挥（不锁定字符串） → 拒绝：FR-012 要求"机械可判"，自由文本标题需要语义匹配（FR-009 可选范畴），不满足"零 LLM"的机械底线要求。

---

## D6（对应难点 g+h）：委派角色类型机械判据与性能防线

**Decision**：
- **角色类型匹配**（FR-012b，级联分类，**[REVISED-BY-ORCHESTRATOR: 基于真实 fix 会话 transcript 实测修订；二次修订堵假阻断洞]**）：
  - **级联规则**：`roleClass = matchRole(subagent_type) ?? matchRole(description) ?? 'other'`——先对 `tool_use.input.subagent_type` 做角色模式匹配（实测交互式会话稳定携带 `spec-driver:implement` 等英文标识）；**命中即为权威结论**；未命中（含字段缺失、或取值为 `general-purpose` 等不含角色信息的类型）时**必须**退化到 `input.description` 匹配，绝不因"subagent_type 存在但无角色信息"就直接归为其他类。
  - **角色模式（对 subagent_type 与 description 共用，双语窄模式）**：`implement` 类 = `/implement|实现|代码修复/i`；`verify` 类 = `/verify|quality-review|spec-review|review|验证|审查/i`。
  - **关键判别依据（源自 fix SKILL.md 的 canonical Task 调用文本实测）**：SKILL 规定的委派 description 为中文——Phase 2 "规划修复方案"、Phase 2 "生成修复任务"、Phase 3 "执行代码修复"、Phase 4c "工具链验证 + 验证证据核查"——且 SKILL 文本**并未要求传 subagent_type**（模型可传可不传）。窄模式必须精确切分这批 canonical 文本："代码修复"（连续四字）只出现在 implement 委派、不出现在 plan/tasks 委派（"规划**修复**方案"/"生成**修复**任务"含"修复"但不含"代码修复"），故**刻意不把裸"修复"二字纳入 implement 模式**（宽模式会把 plan/tasks 误分类为 implement 造成假合规），而以"实现|代码修复"为判别词。
  - **裁量记录**：desc 含"审查"的委派（如 codex 对抗审查）计入 verify 类——对抗审查在语义上是验证行为，Goodhart 经济性不变（凑数仍需真实发出委派）。
  - 测试 fixture 必须覆盖"SKILL canonical 中文 description + 无 subagent_type"的完整合规会话样例（防假阻断回归），以及"plan/tasks 委派 desc 含'修复'字样"的反例。
  - 修复收口要求：委派集合中存在 ≥1 条 implement 类 **且** ≥1 条 verify 类（可为同一子代理调用序列中的不同调用，不要求发生顺序）。
  - no-op 收口要求（**[REVISED-BY-ORCHESTRATOR: 采纳 codex plan 审查 W-2，堵廉价委派 Goodhart]**）：委派集合中存在 ≥1 条 **no-op 核实类**委派——匹配 no-op 专用模式 `/verify|spec-review|quality-review|review|验证|审查|核实|确认/i`（对 subagent_type 与 description 级联匹配，同上）。"任意一次 Read-only 调研委派即可凑数"的原始口径被否决：FR-002/FR-012b 的原文是"用于**交叉核实**该判断的委派"，机械代理判据应至少绑定核实语义词。委派内容与判断结论的深层相关性校验仍属 FR-009 可选范畴，作为已明示的残余风险记录于 contracts/no-op-report-template.md。
  - 委派记录 `name` 字段兼容 `Agent`（当前 CLI 实测记录名）与 `Task`（历史/未来可能记录名），二者等价对待；委派记录只认 assistant 消息中 `type:"tool_use"` 的内容块（envelope type 由 harness 写入，模型在 text 块中伪造的"长得像 tool_use 的 JSON"不会获得该 envelope 类型）。
  - 测试 fixture 须含"中文 description + 无 subagent_type"样例与"plan 委派 desc 含'修复'字样"反例。
- **修复收口的制品章节锚点**（FR-012a，与 D5 no-op 锚点对应）：canonical 锚点定义以 `contracts/no-op-report-template.md` 为单一事实源——修复形态 = fix-report.md 命中 `/Root Cause/i`（既有 Phase 1 模板固有 `**Root Cause Chain**:` 行，实测核对存在）；no-op 形态 = 命中 `/^##\s*判定依据\s*$/m`（D5 新模板）。两个锚点集合刻意互斥，可同时用于收口形态分类（closureForm）与 FR-012a 实质性校验；verification/verification-report.md 存在性另行校验（修复收口必需）。
- **性能防线**（C-003 p95 < 100ms）：
  - transcript 读取设体积上限常量 `MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024`（20MB，**[推断]**——基于"fix 会话通常数千行、单行含较长 SKILL 全文注入"的经验估计，非实测统计值；implement 阶段任务须用真实 fix 会话 transcript 样本校准该常量并记录实测 p95）。超过上限 → 判定为 `transcript-too-large`，走 FR-13 fail-open。
  - 采用同步 `fs.readFileSync` + 单遍 `split('\n')` + 单趟扫描（非二次正则回溯的简单字符串匹配为主），不引入异步流式解析的额外复杂度（体积上限已经是主要防线，规模可控场景下同步解析的 wall-clock 通常为个位数毫秒量级）。
  - 不引入 OS 级超时机制（见 D3 关于 `timeout` 命令跨平台问题的决策）；p95 达标情况通过 implement/verify 阶段的实测基准验证，而非运行时自适应熔断。

**Rationale**：判据必须"机械可判"且零语义理解（FR-012 明确要求），字符串/正则匹配是唯一符合该约束的实现路径；体积上限是唯一在不引入跨平台超时机制复杂度的前提下能够诚实兑现性能目标的手段。

**Alternatives Considered**：
- 委派角色识别引入更复杂的 NLP 相关性分析 → 拒绝：超出 FR-012 的机械可判范畴，属于 FR-009（可选、深度语义识别）的范畴，本次不做。
- 异步流式 + 定时器熔断 → 拒绝：增加实现与测试复杂度，且 Node 单线程同步执行体下定时器无法真正抢占正在运行的同步循环，达不到预期的"硬超时"效果，体积上限是更诚实的防线。

---

## D7（对应难点 i）：测试策略

**Decision**：
1. **纯函数单测**（`plugins/spec-driver/tests/fix-compliance-core.test.mjs`，`node --test` 运行，与仓库既有 `goal-loop-core.test.mjs` 同构）：覆盖 D1/D6 的判定函数，使用 `tests/fixtures/fix-compliance/*.jsonl` 固定样例（模拟 transcript 片段，非真实敏感数据）：
   - 坍塌样例（0 委派、无制品、纯文本收口）
   - 完整合规样例（含 implement+verify 委派、fix-report.md、verification-report.md 路径）
   - no-op 合规样例（含 1 次任意委派、no-op 精简报告）
   - no-op 但 0 委派样例（应判不合规，US2 场景 2）
   - 占位空壚样例（制品文件存在但仅含未填充的 `{...}` 模板占位符，验证 FR-012a）
   - 委派角色不匹配样例（如仅 1 次 tech-research 类委派冒充完整收口，验证 FR-012b）
   - 多技能展开样例（session 中途从 feature 切到 fix，或 fix 展开两次）
   - 非 fix 会话样例（无展开痕迹 / 展开痕迹指向 feature）
   - transcript 损坏/超限样例（验证 FR-013 fail-open 分支与 diagnostics 字段）
2. **配置解析单测**（`fix-compliance-io.test.mjs` 或并入同一测试文件的独立 `describe` 块）：覆盖 FR-015 判定顺序三步（缺失/损坏/非法值 → block+config-degraded；`off` → 立即短路；合法 `block`/`warn` → 进入下一步）。
3. **record-workflow-run.mjs 回归测试**：在既有 `record-workflow-run.mjs` 相关测试基础上补充：新增 `complianceVerdict` 字段仅在显式传参时出现；未传参时事件字节级不变（防 FR-014 向后兼容回归）。
4. **headless E2E spike（非 CI 自动化用例）**：新增手工脚本 `plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs`（或等效 shell 脚本，放在不被 `npm run test:plugins` glob 匹配的位置，如 `scripts/dev/` 而非 `tests/`），复刻 `harness-verification.md` 的插件副本手法：拷贝插件到 scratchpad、注入新 hook、用 `claude --print --plugin-dir <副本>` 跑一次极简坍塌场景与一次合规场景，人工核对 exit code / stderr 前缀。该脚本**不计入** `npm test`（消耗真实 token/账号配额，仅作为 implement/verify 阶段的可重跑手工验收工具，quickstart.md 记录调用方式）。
5. **SC 覆盖映射**：SC-001/SC-002（坍塌不再静默通过）由 `fix-compliance-core.test.mjs` 的坍塌/占位/角色不匹配样例 + E2E spike 共同覆盖；SC-003（p95 <100ms、零新增 LLM/委派）由性能基准任务 + 代码审查（判定路径不含 `Task(` 或模型调用字符串）共同覆盖；SC-004（no-op 一次性合规收口）由 no-op 合规样例覆盖；SC-005（vitest 全量零失败）由既有 CI 命令覆盖，本次改动不触碰 `src/`，回归面仅限新增测试自身与 `config-schema.test.mjs`/`record-workflow-run` 相关测试的增量断言。

**Rationale**：延续仓库现有测试基础设施与命名惯例（`node --test` + `.test.mjs` + `tests/fixtures/`），避免为本次改动引入新测试框架；E2E spike 显式排除在自动化套件外，诚实反映其"消耗真实凭据、非确定性时间开销"的特性，与仓库既有"评测走订阅优先"的成本纪律一致。

---

## 待 implement 阶段确认的事实性前提（非阻塞，标注 [推断]）

- transcript JSONL 单行 envelope 的确切字段路径（`message.content[].type === 'tool_use'` 等）沿用 Claude Code 标准会话日志格式的通行认知，尚未在本次 plan 阶段读取一份完整真实样本逐字段核对（`trace.md` 记录的实测只锚定了展开痕迹文本与 `Agent` 委派工具名两个具体事实，未逐字段核对完整 envelope 结构）。**implement 阶段第一项任务应读取一份真实 fix 会话 transcript 样本，逐字段核对解析器假设**，若结构有出入及时修正 `fix-compliance-io.mjs` 的解析逻辑，不应等到测试失败才发现。
- `MAX_TRANSCRIPT_BYTES` 与性能 p95 目标的具体数值需要实测校准（见 D6）。

## 实测校准记录（T001，2026-07-09，主编排器基于真实 F206 headless 评测 transcript 完成）

样本源：`~/.claude/projects/-Users-connorlu--spec-driver-bench-worktrees-SWE-V008-*-r1/` 与 `SWE-V009-*-r1/`（F206 真实评测留存 transcript 文件，非 stream-json），逐字段核对结论：

1. **headless 评测的 transcript 文件真实落盘**且路径按 cwd slug 组织；同一 slug 目录含多个 session 文件（runId 跨批复用 + 子代理 sidechain 独立成文件）——hook 消费 payload 的 `transcript_path` 指向当前会话单文件，多文件共存不影响判定。
2. **envelope 结构确认**：顶层 `type: "user"|"assistant"`；`message.content` 为字符串（部分 user 消息）或内容块数组；文本块 `{type:"text", text}`；工具调用块 `{type:"tool_use", name, input}`；工具结果在 user 角色消息的 `{type:"tool_result", ...}` 块中（反伪造过滤的排除对象，D1 修订成立）。解析器须同时容纳 `content` 字符串与数组两种形态。
3. **展开痕迹**：合规与坍塌 fix 会话均恰好 1 个锚点（user 文本块，前缀 `Base directory for this skill: <worktree 插件路径>/skills/spec-driver-fix`）——headless `--plugin-dir` 场景锚点路径指向 worktree 源码目录，检测正则（路径尾 `/skills/spec-driver-<mode>`）命中。
4. **委派记录**：合规 V009 r1 三个 fix 会话 = 4-6 次 `name:"Agent"` tool_use，`input.subagent_type` **稳定存在**（`spec-driver:plan/tasks/implement/verify`，完整路径另有 `spec-driver:spec-review`/`spec-driver:quality-review`）→ 修复收口角色配额（implement≥1 + verify≥1）天然满足；V008 r1 坍塌会话 = 0 委派 → 判定器将拦截。desc 存在模型改写现象（见 premise_verification 2），subagent_type 权威层设计必要。
5. **体积分布**：fix 会话 transcript 0.09-0.31MB；同目录最大非 fix 会话 7.6MB。`MAX_TRANSCRIPT_BYTES=20MB` 上限保守合理（≈实测 fix 会话的 60 倍），维持 20MB 不变；p95 实测归 T030。
6. **对实现的影响**：D1/D3/D6 假设全部成立，无需修正；`readTranscriptEntries` 须支持 `content` 字符串形态（见第 2 条）——此点已并入 T009 实现要求。

### 复核补充（T006/T009 实现期，2026-07-09）

实现前抽查 1 份含 spec-driver-fix 展开的真实 transcript（`~/.claude/projects/...SWE-V003...r3/*.jsonl`）复核，前六条结论全部再确认成立。补记一项原记录未显式覆盖的字段形态：

7. **顶层 `type` 非二元**：除 `user`/`assistant` 外，真实 transcript 还存在 `queue-operation`/`attachment`/`last-prompt` 等其他顶层 `type` 条目（这些条目无 `message.content` 或结构不同）。对实现的影响：`normalizeTranscriptEntry` 须对非 `user`/`assistant` 角色与缺失 `message.content` 的条目做**空集容错**（`textBlocks`/`toolUseBlocks` 归空数组，不抛错），并在语义上——展开痕迹只认 `role==='user'` 文本块、委派只认 `role==='assistant'` 的 `tool_use` 块——天然排除这些噪声条目。此容错已落入 T006 core `normalizeTranscriptEntry` 与 T009 io `readTranscriptEntries`。
