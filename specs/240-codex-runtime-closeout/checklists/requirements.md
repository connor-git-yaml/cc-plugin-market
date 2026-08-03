# Feature 240 需求质量检查清单

审查对象：`specs/240-codex-runtime-closeout/spec.md`
事实源：`_grounding.md`（§8 最高权威）、`research/tech-research.md`
审查方式：逐条对照 FR/SC/Edge Case 的来源追溯章节，实际打开 grounding 与 tech-research 原文核对内容是否对应（非仅核对"是否有标注"）。

---

## 1. FR 完备性（A3 四项 + A4 三项）

- [x] ✅ A3① 事件收敛有对应 FR：FR-001（事件白名单收敛到 4 个 PascalCase 事件）+ FR-002（构建期白名单校验）。与 grounding §2「10 事件全集、Worktree 系列不存在」一致。
- [x] ✅ A3② payload E2E 有对应 FR：FR-003，且已按用户决策一收窄为 allow/block/failure-degrade/Stop 四路径、锚定 `tool_name="Bash"`。milestone 原文"四路径"要求（tech-research §5 milestone 引文）被完整覆盖，未偷工减料成两路径。
- [x] ✅ A3③ Stop 判定链有对应 FR：FR-004（`.specify/runs/` 优先、transcript 降级为交叉校验）。
- [x] ✅ A3④ PLUGIN_ROOT 有对应 FR：FR-005，且语义已按 grounding §8.6 修正为"构建期写绝对路径/脚本自推导"，未沿用"消费 Codex 注入变量"这一已被证伪的旧设想。
- [x] ✅ A4① CODEX_HOME helper 有对应 FR：FR-006。
- [x] ✅ A4② 统一消费点改造有对应 FR：FR-007，文件清单与 `tech-research.md` §3.5 逐条比对一致（auth-detector.ts/skill-installer.ts/postinstall.ts/preuninstall.ts/codex-skills.sh）。
- [x] ✅ A4③ 四方一致性诊断有对应 FR：FR-008。
- [x] ✅ 用户决策二（hook 信任诊断 + 不自动绕过）有对应 FR：FR-009（信任探测）+ FR-010（文档 + 禁自动绕过）。
- [x] ✅ 无遗漏项：逐一核对 milestone A3/A4 六个 point（见 `docs/design/milestone-M9-codex-trusted-live-graph.md#A3`，spec frontmatter 已引用）与 FR 编号一一对应，未发现落空的 point。
- [x] ✅ 无越界项：未发现哪条 FR 试图覆盖 Non-Goals 明确排除的范围（详见第 6 节交叉核对）。

## 2. FR 可测性

- [x] ✅ FR-001/002：可测（事件名字符串比对 + 门禁脚本单测）。
- [x] ✅ FR-003：四条路径均给出了具体断言对象（标准字段清单、exit 2+stderr、非 0 非 2 退出、Stop payload 字段），无"合理处理"类模糊措辞；唯二软化措辞是 failure-degrade 路径的"不得导致 turn 挂起或产品级崩溃"——这是可观察的否定式断言（可测：跑一次 turn 看是否挂起/崩溃），不算模糊。
- [x] ✅ FR-004：判定顺序描述为可实现的伪代码级流程（优先读 `.specify/runs/` → 否则回退 transcript），可直接转化为单元测试用例（mock 三种数据可用性组合）。
- [x] ✅ FR-005：MUST NOT 依赖未证实环境变量插值，属于静态可审查约束（grep hooks.json 生成产物即可验证）。
- [x] ✅ FR-006：纯函数签名 + 明确 fallback 规则，可直接单测三种输入组合（设置/未设置/空字符串）。
- [x] ⚠️ FR-007：多数消费点可测（改造前后行为 diff）；但"worktree cache"一项写"本仓库现状下无需改动代码，但接口形状 MUST 保留可扩展性"——"保留可扩展性"本身不是一条可断言的验收条件，只能靠代码评审判断，机械可测性弱于其余各项。不构成阻塞（已明确降级为设计约束而非功能验收），但建议 plan 阶段落成具体的接口签名评审checklist 项，避免评审时无标准可依。
- [x] ✅ FR-008：四方各自的判定规则、indeterminate 触发条件、总体结论计算规则均可写成断言。
- [x] ✅ FR-009：探测失败→indeterminate、命中未信任→remediation 非空，均可断言。
- [x] ✅ FR-010：可用 grep 校验文档字符串存在 + grep 安装脚本确认无 `--dangerously-bypass-hook-trust` 字面量（测试脚本目录除外）。

## 3. Success Criteria 机械可判定性

- [ ] ⚠️ **spec.md 未设置独立的「Success Criteria」章节（无 SC-xxx 编号列表）**。当前验收信号分散在：Functional Requirements 的 MUST 断言、§6 Edge Cases 表、§7 回归护栏五条。这些内容本身大多可机械判定（已在第 2、7 节确认），但缺少一个集中的、面向"这个 feature 到底算不算完成"的顶层判定式清单，与仓库其他 spec 惯例（如本次 grounding/tech-research 引用的既往 feature 常见 `SC-001` 编号）不一致。
  - 影响评估：不是内容缺失（各 FR/Guard 已可测），是**结构缺失**——若下游 plan/tasks/verify 子代理依赖"扫描 SC-xxx 编号"来生成验收任务，会因找不到该章节而漏派生验收任务。
  - 建议：进入 plan 阶段前，建议 specify 子代理补一节「Success Criteria」，把已经隐含在 FR/Edge Cases/回归护栏里的可判定项汇总编号（可以是纯汇总性质，不新增实质内容），或明确说明本 spec 采用"FR 即验收标准"的替代约定并在 frontmatter/正文显式声明。

## 4. 事实追溯完整性（抽样实读核对，非仅查有无标注）

- [x] ✅ FR-001 标注 `_grounding.md §2、§8.1` 应为 §2/§8.2（实读 §2 表格 + §8.2 实测段落）——**已修正核对**：spec 原文写"§2、§8.2"，笔误检查通过，不是错误（本条自查：审查者初读误记为§8.1，核对 spec 原文行 67 确认写的是 §8.2，正确）。
- [x] ✅ FR-002 标注 `_grounding.md §8.2「高危静默失败面」`：实读 §8.2 原文含"🔴 这是一个高危静默失败面"字样，逐字对应。
- [x] ✅ FR-003 标注 `_grounding.md §8.4、§8.7`：§8.4 确实是 `tool_name=Bash` 实测段，§8.7 确实是"实测尚未覆盖"挂账清单，内容与 FR-003 描述完全对应。
- [x] ✅ FR-004 标注 `_grounding.md §3.4、§8.5`：§3.4 含"A3③ 的依据（见 §8.5 实测修正）"字样，§8.5 是 wire format 异构的最终结论——两处引用形成的因果链在原文中确有交叉引导关系，spec 转述准确。
- [x] ✅ FR-005 标注 `_grounding.md §8.6（🔴 高优先级修正）`：实读 §8.6 原文确有"🔴"标记，内容（无 PLUGIN_ROOT 注入、须构建期写绝对路径）逐句对应。
- [x] ✅ FR-006 标注 `_grounding.md §5.2`：实读确认"完全尊重 CODEX_HOME"表述来自该节。
- [x] ✅ FR-007 引用 `tech-research.md §3.5`：实读该节表格，五个改造点与 FR-007 列出的文件清单逐一匹配（含括号内的具体函数名 `resolveTargetDir`/`formatSummary` 等，与 tech-research 原文行 93 一致）。
- [x] ✅ FR-008 标注 `_grounding.md §5.2、§5.3`：§5.2 含 schema 与 18-check 清单，§5.3 是硬编码点初筛表——FR-008 描述的诊断 schema 与 §5.2 的 JSON 样例字段（schemaVersion/overallStatus/checks{id,category,status,summary,details,remediation}）完全一致。
- [x] ✅ FR-009/FR-010 标注 `_grounding.md §8.3`：实读 §8.3，`HookTrustStatus` 取值域、`--dangerously-bypass-hook-trust` 的 help 文案原文均与 FR-010 引用/转述一致（含"DANGEROUS. Intended only for automation that already vets hook sources"逐字引用）。
- [x] ✅ §8 T039 处置一节引用 `tech-research.md §7.6` 的建议（"同一次人工验证 session 一并完成"）：实读 tech-research §7 风险清单第 6 条，表述与 spec §8 转述一致（tech-research 该条实际编号为"风险清单第 6 项"，spec 称"§7.6"，核对 tech-research 目录结构该节标题即为"## 7. 风险与未知"，编号方式对应，无实质错误）。
- [x] 未发现"标注章节号存在但内容不对应"的情况（抽样 10 条 FR 引用全部通过实读核对）。

## 5. Over-claim 检测

- [x] ✅ FR-003 显式禁止"Codex 下也能像 Claude 一样拦截文件编辑操作"表述，且要求挂账具体 issue 号（#16732/#17794/#18491/#20204），与 tech-research §2.1 交叉印证的 issue 列表一致，未夸大。
- [x] ✅ §9 未决问题一节明确要求"实施阶段 MUST 先补齐一手实测，不得将其当作既定事实"，7 条待实测项均如实转录自 grounding §8.7，未把"待实测"包装成"已确认"。
- [x] ✅ FR-005 的语义修正过程（从"消费 Codex 注入变量"改为"构建期写绝对路径"）在 spec 正文中显式标注了"语义已修正"，未静默吞掉这次认知更新，避免了 over-claim。
- [x] ✅ FR-008 plugin build 一方明确"若确认不存在等价机制，MUST 标记该维度为 indeterminate，不得回退为猜最高版本号"——未承诺 Codex 侧一定存在对称的 active 标记机制（tech-research §4 已明确这是"未证实"项）。
- [x] ✅ 未发现把"MCP server 版本自省"包装成本 feature 交付项：§2 Non-Goals 与 FR-008 均明确标注为"尽力而为 + 已知产品缺口"，与 tech-research §6.2 结论一致。

## 6. Non-Goals 与 FR 相互印证

- [x] ✅ "不解析 shell 命令字符串提取路径"（Non-Goals 第 3 条）与 FR-003 的"明令禁止"逐字呼应，无反向越界的 FR。
- [x] ✅ "不自动绕过 hook 信任"（Non-Goals 第 4 条）与 FR-010 呼应一致，且 FR-010 补充了"该 flag 仅允许出现在本 feature 新增的 E2E 测试脚本内部"这一细化边界，未与 Non-Goals 冲突。
- [x] ✅ "不改 F239 graph provenance"（Non-Goals 第 5 条）：FR-001~FR-010 均未触及 `graph-bootstrap-status.json`/`evaluateFreshness`，且该约束在 §7 回归护栏第 2 条重复强调，双重印证一致。
- [x] ✅ "不解决 MCP server 版本自省底层缺口"（Non-Goals 第 6 条）与 FR-008 的"MCP server"一方描述（"只做尽力而为诊断"）完全对应，FR 未越界承诺解决该缺口。
- [x] ✅ "不实现 F238 FU-1 本体"（Non-Goals 第 7 条）与 FR-006 的表述一致：FR-006 只要求 helper "接口形状可被 FU-1 后续复用"，未要求实现惰性读取 `config.toml` 的功能本体。
- [x] ✅ "不重造改名跟随/复合命令劫持判定器"（Non-Goals 第 8 条）：未发现任何 FR 涉及 `worktree-lifecycle.sh` 的 Codex 侧等价实现，FR-001 反而明确"WorktreeCreate/WorktreeRemove 保留为 Claude adapter 独有"，与该 Non-Goal 一致。
- [x] ✅ "不推进版本 SemVer bump 正式发布"（Non-Goals 第 9 条）：spec 全文未出现任何要求本 feature 内执行 `npm publish` 或版本号变更的 FR，一致。

## 7. 回归护栏可执行性

- [x] ✅ 护栏 1（Claude 侧 hooks 行为零变化）：要求"双运行时 E2E 证明二者互不干扰"，是可执行的测试交付物（不是空洞声明）。
- [x] ✅ 护栏 2（F239 状态文件不回归）：要求"第 14/15 族门禁保持全绿"，对应仓库既有 `repo:check` 门禁族，是机械可跑的验证命令。
- [x] ✅ 护栏 3（F238 wrapper/字面量门禁全绿）：要求"model-literal-gate-core.mjs 与 wrapper 完整性校验不受影响"，同样对应现成的可执行门禁脚本，并补充了具体禁止事项（不得硬编码模型版本号如 `gpt-5.6-sol`）。
- [x] ✅ 护栏 4（不碰评测链）：可用 `git diff` 对照文件清单机械核验。
- [x] ✅ 护栏 5（SKILL 改动后 repo:sync）：给出了具体命令 `npm run repo:sync` + `npm run repo:check`，可执行。
- [x] 五条护栏均落到了"可执行检查"而非纯声明，未发现空话式护栏。

## 8. Edge Cases 覆盖度（对照 grounding §8 揭示的失败模式）

- [x] ✅ 事件名静默失效（grounding §8.2）→ Edge Cases 表第 1 行 + 最后一行（PascalCase vs snake_case 同时声明）均覆盖。
- [x] ✅ hook 默认不信任（grounding §8.3）→ Edge Cases 表第 5 行覆盖。
- [x] ✅ 无 PLUGIN_ROOT 注入（grounding §8.6）→ **未在 Edge Cases 表中显式列出独立行**。该风险已被 FR-005 正文用 MUST NOT 约束吸收（"command 字段 MUST NOT 依赖任何未经证实会被 Codex 注入的环境变量展开"），属于设计约束层面已封堵，而非"运行时需要识别并降级处理"的 edge case，因此不在 Edge Cases 表出现有其合理性，不视为遗漏，仅记录供 plan 阶段留意：若 FR-005 的两种实现方式（构建期展开 / 脚本自推导）之一在极端场景下仍可能读到空值，建议在 plan/tasks 阶段补一条对应的降级行为断言。
- [x] ✅ transcript wire format 异构（grounding §8.5）→ 未单列 Edge Case 行，但已被 FR-004 正文完整表述为设计前提（"MUST 不再把 transcript_path 指向的文件作为唯一事实源"），并且 Edge Cases 表的性质是"运行时分支决策表"，FR-004 描述的是"架构级判定顺序"而非条件分支，不强制要求在 Edge Cases 表重复。不构成阻塞。
- [x] ✅ `tool_name=Bash` 无结构化路径（grounding §8.4）→ 已通过 Non-Goals 第 3 条 + FR-003 的"明令禁止"双重覆盖，性质同上（设计约束而非运行时分支），不在 Edge Cases 表单列不构成缺陷。

## 9. 未决项处置（§9 待实测项 vs grounding §8.7）

grounding §8.7 列出 6 条"实测尚未覆盖"：
1. `exit 2` 阻断路径未验证 → spec §9 第 1 条对应 ✅
2. `prompt`/`agent` handler type 未测 → spec §9 第 2 条对应 ✅
3. `matcher` 正则语义未测 → spec §9 第 3 条对应 ✅
4. 信任记录持久化位置未确证 → spec §9 第 4 条对应 ✅
5. `PermissionRequest`/`SubagentStart`/`SubagentStop`/`PreCompact`/`PostCompact` 未触发验证 → spec §9 第 6 条对应 ✅
6. 是否存在独立 `apply_patch` 工具路径未被证伪 → spec §9 第 7 条对应 ✅

- [x] ✅ 6 项一一对应，无遗漏。
- [x] ✅ spec §9 额外新增第 5 条（`.codex-plugin/plugin.json` 是否支持声明 hooks 字段形状未证实），该条实际来自 grounding §6「未确证」分栏第 1 条（非 §8.7），spec 转录时未标错来源——正文写的是"如实转录自 `_grounding.md §8.7`"这一总述，但第 5 条内容确实溢出 §8.7 范围。核对影响：**不算错误标注**，因为该条本身是真实存在于 grounding 文档中的未确证事项（§6 而非 §8.7），只是 spec 的引导句"以下事项如实转录自 §8.7"在字面上把全部 7 条都归为 §8.7 出处，与事实（第 5 条出自 §6）有细微不符。
  - 建议（非阻塞）：plan 阶段前可将 §9 引导句改为"如实转录自 `_grounding.md` §6/§8.7"，避免读者据此误查 §8.7 却找不到第 5 条对应原文。
- [x] ✅ 未发现把待实测项"私自降级为已知事实"的情况——所有 7 条均保留了不确定性措辞（"未测"/"未确证"/"未证伪"）。

---

## 阻塞项汇总

**无强阻塞项**（未发现 FR 缺失、over-claim、Non-Goals 相互矛盾、护栏空转等会导致方向性错误的问题）。

以下 1 项建议在进入 plan 阶段前修复，属于结构性缺口而非内容错误：

1. **【建议修复】spec.md 缺少独立的「Success Criteria」章节**（第 3 节）。当前验收信号分散在 FR/Edge Cases/回归护栏中，内容本身基本可测，但结构上不利于下游 plan/tasks 阶段机械派生验收任务。建议 specify 子代理补一节汇总性 SC 列表，或显式声明"本 spec 采用 FR 即验收标准"的替代约定。

以下 2 项为轻微文档瑕疵，不影响进入 plan 阶段，供实施时顺手修正：

2. §9 引导句"如实转录自 `_grounding.md §8.7`"应改为"§6/§8.7"，因第 5 条实际出自 §6。
3. FR-007 中"worktree cache 接口保留可扩展性"这一条建议在 plan 阶段落成具体的可评审标准（如约定 helper 签名字段清单），避免验收时无量化依据。
