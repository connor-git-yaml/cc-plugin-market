# 技术调研报告：F216 fix 模式"方向误读 no-op"证据门修复

**特性分支**: `claude/f216-noop-evidence-gate-85136d`
**调研模式**: codebase-scan（纯仓内扫描，不做外部 Web 调研）
**产品调研基础**: 无（独立模式；本次调研直接基于任务背景中的 F212 取证结论与候选 A/B 描述）

---

## 1. F208 fix-compliance-judge 现状架构

**judge 核心文件**（均在 `plugins/spec-driver/`）：
- `scripts/fix-compliance-judge.mjs`：I/O 编排层（CLI 入口，唯一由 `hooks.json` 挂载的生产路径）
- `scripts/lib/fix-compliance-core.mjs`：纯函数判定层（零 I/O）
- `scripts/lib/fix-compliance-io.mjs`：全部 fs 操作聚于此（config/transcript/audit/blockState/artifact 读取）
- `hooks/stop-fix-compliance-check.sh`：Stop hook 薄壳
- `hooks/hooks.json` L36-54：`Stop` 数组挂两个 hook——`stop-task-check.sh`（非阻断提醒）与 `stop-fix-compliance-check.sh`（本机制，阻断型）

**Stop hook 接线**（`hooks/stop-fix-compliance-check.sh` 全文 37 行）：
- L17：`CLI="${FIX_COMPLIANCE_CLI:-$PLUGIN_ROOT/scripts/fix-compliance-judge.mjs}"`
- L20-22：`node` 不可用 → 直接 `exit 0`（FR-013 fail-open 第一道保险）
- L25-29：读 stdin 转发给 `node "$CLI" --mode hook --project-root "$(pwd)"`
- L32-36：**退出码转发协议**——CLI 返回 2 → hook `exit 2`（阻断 Stop）；CLI 返回其余任意码（含崩溃/信号）→ hook 兜底 `exit 0`（第二道保险，薄壳自身零判定逻辑）

**off/warn/block 三档语义**：
- 定义：`fix-compliance-core.mjs` L20 `ENFORCEMENT_VALUES = new Set(['block','warn','off'])`
- 消费：`fix-compliance-judge.mjs`
  - `runHook()` L317：`cfg.enforcement === 'off'` → 在**任何 transcript 读取之前**直接 `return 0`（FR-015 判定顺序第 2 步，零接触）
  - L338-344：`warn` 档 → 落审计事件 + stderr 前缀 `[FIX-COMPLIANCE][WARN]` + 恒 `return 0`（从不阻断、从不 bump 阻断计数）
  - L347：`block` 档 → 进入 `routeBlock()`
- 配置解析三步序：`fix-compliance-core.mjs` `resolveEnforcementFromConfig()` L422-434——① 无配置文件→`block`非降级；② 文件存在但解析失败→`block`+降级；③ 缺 `fix_compliance` 字段→`block`非降级；④ 合法取值采用，非法取值→`block`+降级

**有界降级（第 3 次放行）实现**：`fix-compliance-judge.mjs`
- `BLOCK_LIMIT = 2`（L51）
- `routeBlock()` L206-236：`loadBlockState` 读会话阻断计数；`count < BLOCK_LIMIT` 时 `saveBlockState` 写 N+1 并 `return 2`（硬阻断）；`count >= BLOCK_LIMIT`（即第 3 次判定）走 `releaseDegraded()`
- `releaseDegraded()` L242-278：`exit 0` + stderr 前缀 `[FIX-COMPLIANCE][GATE-DEGRADED]` + 幂等终态双写（首次经 `recordWorkflowRun` 写 `result:'failed'` + `saveBlockState` 置 `degradedRecorded:true`；重复降级只落轻量审计事件不重复终态）

**F211 补救清零**：`runHook()` L328-334——判定 `compliant:true` 时无条件调用 `resetBlockState(projectRoot, sessionId)` 清零阻断计数（两级存储：`.specify/runs/.fix-compliance-state/<session>.json` 主路径 + `os.tmpdir()` 降级路径，见 `fix-compliance-io.mjs` L324-335），使"阻断×2→补救成功→额度恢复、下次不合规重新计数"成立。

**no-op 出口当前的结构化判定字段**（`fix-compliance-core.mjs`）：
- `classifyClosureForm()` L327-335：按 `fix-report.md` 内容的两个**互斥锚点**分类收口形态——`NOOP_JUDGMENT_HEADING_REGEX = /^##\s*判定依据\s*$/m`（L45）命中且 `ROOT_CAUSE_HEADING_REGEX` 未命中 → `'no-op'`；两者同命中按 `'repair'`（取严，防借 no-op 更低门槛绕过修复收口的双角色要求）
- `judgeCompliance()` L376-383：`closureForm === 'no-op'` 分支要求：(a) `checkArtifactSection` 命中 `## 判定依据` 章节且正文 >20 非空白字符、无 `{...}` 占位符残留；(b) `noopVerifyCount >= 1`（至少 1 次 `subagentType`/`description` 命中 `NOOP_VERIFY_ROLE_REGEX`——即"verify/核实/确认"等词的委派）
- **关键缺口（本次调研核心发现）**：判据只校验"判定依据"章节**非空且非占位符**、以及"至少委派 1 次带核实字样的子代理"——**完全不校验该章节内容是否包含可执行、可复现的证据**（如命令+输出、测试结果）。F212 V008 r1/r2 的自信断言"报告中的两个症状均已被历史修复消除"+ 引用 `contains.py:50` 这类**纯文本引用型"证据"**能轻松通过当前章节非空+委派计数判据——这正是"穿 F208 合规外衣的自信 no-op"得以成立的结构性原因。

---

## 2. fix mode 诊断阶段合同现状

**SKILL 文件**：`plugins/spec-driver/skills/spec-driver-fix/SKILL.md`（547 行；同步分发到 `.codex/skills/spec-driver-fix/SKILL.md` 与 `plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md`）

**"先核实是否已修"指令原文定位**：Phase 1 收口分支"确认无需代码改动（no-op 一等公民出口）"，L284-311：
- L286-288（原文）：
  > 诊断完成后，若根因分析的结论是**问题已不存在 / 无需任何代码改动**（如指向已生效的历史修复、无法复现、误报），**不要**直接输出"经检查无问题"就结束——这是流程坍塌。改走以下轻量合法出口：
- L296-303：no-op 变体模板，逐字要求 `## 判定依据` 标题，正文示例文案：`{为何判断问题已不存在/无需代码改动的具体证据：如指向已生效的历史修复 commit、实际复现测试结果、相关代码路径现状摘录等——不得是空泛的"经检查确认无问题"}`
- L305：`至少委派 1 次 verify 类子代理交叉核实"确实无需改动"这一判断`
- **关键观察**：模板文案里其实**已经写了**"实际复现测试结果"作为期望证据形态之一，但这只是自然语言提示（prompt 级），**没有任何结构化/机械化约束要求"复现测试结果"必须是可执行、可重跑的命令+输出**——模型可以只写一句"引用 `contains.py:50` 已修正"就满足"非占位符+非空"的机械判据。这与 F206-R3 三版 prompt 级对账合同、F208 依从层"坍塌 0/29 但 V008 纹丝不动"的证伪结论完全吻合（任务背景 + PUBLISH-REPORT-M8.md L59/101，见下）。

**诊断阶段产出制品**：`{feature_dir}/fix-report.md`（L235 起模板，两种变体：修复形态含 `Root Cause` 表格 L237-282；no-op 形态含 `## 判定依据` L292-303）

**no-op 结论表达 → judge 消费链路**：SKILL.md 层面无 schema 强约束，仅靠 Markdown 标题锚点+自然语言提示；judge 侧机械消费方式见第 1 节 `classifyClosureForm`/`checkArtifactSection`。两者之间存在"prompt 期望 vs 机械校验能力"的落差——这正是候选 A/B 要补的缺口。

**委派硬约束背景**（L173-179）：no-op 分支属于"编排器亲自执行"的静态豁免范围之一（Phase 1 问题诊断），SKILL 源码已明确标注，不受候选机制影响（候选不应也不能要求诊断阶段本身改走 Task 委派，只能在诊断产出物与后续 judge 校验之间加约束）。

---

## 3. F212 取证样本可复用性

**取证材料位置**：
- 叙事结论（已入库，可直接引用）：`specs/212-eval-rerun-m8-closeout/PUBLISH-REPORT-M8.md` L40（V008 未转化取证段）、L59（"裸驱动无此流程步骤反而 V008 3/3"）、L101（followup 候补，双向对账合同提法）
- `docs/design/milestone-M9-codex-trusted-live-graph.md` L216-219：M9 产品卡原文，含候选 (a)/(b) 两条路线描述，与本 spec 背景一致
- **原始 run 产物（patch / fix-report 全文 / 判定输出 JSON）不在本仓库中**：`specs/212-eval-rerun-m8-closeout/RUNBOOK.md` L1-3 明确"全部命令在 worktree `.claude/worktrees/m8-closeout-212`"，产物落 `.calibration-output/`（gitignored，见项目 CLAUDE.local.md 的评测产物不入库策略），且该 worktree 大概率已随任务收尾被清理，**本次调研未能定位到 V008 r1/r2 的原始 fix-report.md 全文或 patch diff**

**F212 引用的具体上下文（已知片段，来自 PUBLISH-REPORT-M8.md L40）**：
- 任务：F176 冻结集任务 `V008`（headline 全池批，driver=claude-sonnet-4-6）
- r1 patch：仅改 `gitignore` + `project-context` + `fix-report`（**零源码改动**）
- r2 patch：仅改 `fix-report`（**零源码改动**）
- fix-report 原文自信断言（直接引用）：*"对当前工作树的核实表明，报告中的两个症状均已被历史修复消除，无需任何代码改动"*，并引 `contains.py:50` 断言"已修正"
- 两 run 的 MCP 调用次数均为 0（未进入代码分析即下判断）

**可复用性结论**：**不能直接回放原始 run**（原始 transcript/patch 已丢失且评测重跑成本高、且该跑批凭据/环境依赖多），但可以：
1. 依据 PUBLISH-REPORT-M8.md 引用的原文断言**手工构造一份合成 fixture**（模拟"自信引用行号但零执行证据"的 fix-report.md + transcript），补充进 `plugins/spec-driver/tests/fixtures/fix-compliance/`（该目录现有 fixture 命名与用途见第 7 节），命名建议如 `noop-unverified-citation.jsonl`（无命令执行痕迹，仅文本引用行号）—— 用于单测候选 A/B 的判据是否能拦截此形态
2. F176 任务集本身（`V008` 的题面）若需要更贴近真实场景的端到端回放，需要引用 `specs/176-swe-bench-verified-cross-cohort/` 下的任务定义（未在本次调研范围内深入，因评测链只读引用红线）

---

## 4. 候选 A/B 各自的实现落点面

**候选 A（red-repro-first）**：
- SKILL.md：`spec-driver-fix/SKILL.md` Phase 1 no-op 分支（L284-311）需要新增强制步骤——诊断结论为"无需改动"前，必须先产出一个可执行的"红测试/红命令"并**实际执行**证明当前症状（若历史已修，执行应为绿/无法复现，从而证伪"已历史修复"这一误判路径）；模板 L296-303 的 `## 判定依据` 章节需要新增结构化子字段（如"复现命令"+"执行输出摘录"）
- judge 侧：`fix-compliance-core.mjs` 的 `checkArtifactSection`/`judgeCompliance` no-op 分支（L376-383）需要新增一层"证据结构化校验"——不再只判"非空+非占位符"，还需机械识别章节内是否包含类似"命令 + 输出/退出码"的结构化标记（可能需要新的正则锚点，如要求特定子标题"### 复现命令"/"### 执行结果"）
- `MISSING_ACTION_TEXT` 常量（L70-79）需新增枚举，如 `noop:repro-evidence`
- `contracts/no-op-report-template.md`（若存在，需核实——F208 spec 提到过但本次未在 208 contracts 目录下找到独立文件，"判定依据"模板直接内嵌于 SKILL.md）需要同步更新
- 测试：`fix-compliance-core.test.mjs`（T018(a) no-op 收口组合、T019 反伪造）与 `fix-compliance-judge-cli.test.mjs` 需新增用例覆盖"有判定依据章节但无复现证据"的拦截场景；`tests/fixtures/fix-compliance/` 需新增对应 fixture

**候选 B（双向对账合同）**：
- SKILL.md：Phase 1 需要新增"issue 期望行为 vs 工作树现状"逐条对账步骤，产出结构化对账表（而非自然语言判定依据段落）
- judge 侧：需要新的机械校验——对账表的"结论"字段必须逐条关联到具体证据（命令/文件路径/行号+代码摘录），且要求这些证据字段非占位符
- 与候选 A 的共同落点：**两者最终都要在 `judgeCompliance()` no-op 分支新增"结构化证据字段校验"这一层**，任务背景已指出该落点（"落点方向：fix mode 诊断阶段合同 + F208 fix-compliance-judge 扩展（no-op 出口新增证据字段校验——纯结构化门非 prompt）"）。两候选的差异主要在**SKILL.md 层要求模型产出什么形态的中间产物**（红测试执行记录 vs 结构化对账表），judge 侧的校验器实现模式相似（都是对 `fix-report.md` 做更细粒度的章节/子字段机械解析）

**现有 judge 测试�covered 范围**（详见第 1 节引用文件）：
- `fix-compliance-core.test.mjs`：9 类 describe block，覆盖 transcript 归一化、展开痕迹锚定、委派角色分类、特性目录提名、章节判据、收口形态分类、`judgeCompliance` 三支判据、enforcement 解析、no-op 组合、SKILL.md 静态合同锚点、反伪造/反自陈、角色分类边界、C-2 特性目录提名硬化、W-1 双锚点取严、W-3 含空格路径、W-4 desc 兜底剔除裸"实现"
- `fix-compliance-judge-cli.test.mjs`：退出码矩阵（hook/report 两模式）、FR-013 fail-open loud、FR-015 判定顺序、FR-010 反馈文本拼装、parseArgs、阻断有界化（FR-006）、stop-fix-compliance-check.sh 退出码转发、codex W-2 诊断合并
- `fix-compliance-io.test.mjs`：payload/transcript/config 读取、审计事件、featureDir/artifact 磁盘核验、sessionId 清洗、blockState 读写降级幂等、resetBlockState、C-1 全损坏 transcript
- 这套测试骨架（core 纯函数单测 + io 纯 I/O 单测 + judge-cli 集成单测三层分离）可直接复用为候选 A/B 新增判据的测试骨架，无需另起炉灶

---

## 5. wrapper sha 重算链

**触发的门禁**：`npm run repo:check`（`plugins/spec-driver/skills/spec-driver-fix/SKILL.md` 属于 wrapper source-of-truth，改动后必须先 `repo:sync` 再 `repo:check`）

**source-of-truth 合同**：`plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`
- L8-19：`codexWrappers` 块——`sourceRoot: plugins/spec-driver/skills`，`targetRoot: .codex/skills`，**F213（A1）新增** `pluginDistributionRoot: plugins/spec-driver/skills-codex`（随插件包分发的 tracked Codex 适配目录，与 `.codex/skills` 逐字节相同，copy-after-generate 保证一致）
- L33-35：`spec-driver-fix` 条目——`source: plugins/spec-driver/skills/spec-driver-fix/SKILL.md` → `target: .codex/skills/spec-driver-fix/SKILL.md`
- L17-19 注释：每个 wrapper header 内嵌 `- Source SHA256: <hash>`（source body 的 sha256，由 `scripts/lib/extract-wrapper-body.mjs` 计算）；`validate-wrapper-sources.mjs` 重算比对，不匹配/缺 sha 行 → fail

**repo:sync 重生的产物**（改 fix SKILL.md 后必须跑）：
1. `.codex/skills/spec-driver-fix/SKILL.md`（生成器：`plugins/spec-driver/scripts/codex-skills.sh`，`npm run codex:spec-driver:install`）
2. `plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md`（F213 双写，copy-after-generate）
3. 二者内嵌的 `Source SHA256` header 行需要重算匹配新的 SKILL.md body hash

**校验脚本**：`plugins/spec-driver/scripts/validate-wrapper-sources.mjs`（F186 T2 引入）— 重算 body sha256 与 header 内嵌值比对；单测见 `tests/unit/spec-driver/wrapper-sha256.test.ts`

**结论**：候选 A/B 无论哪个方案，只要动了 `spec-driver-fix/SKILL.md` 正文（Phase 1 no-op 分支），都必须走 `npm run repo:sync` → `npm run repo:check` 全链路，且需注意 F213 引入的双写目标（`.codex/skills/` 与 `skills-codex/`）都要重新生成，不能只改一处。

---

## 6. F208 T029 headless E2E 模式

**脚本**：`plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs`（130 行，手工触发，不计入 `npm test`/CI）

**运行方式**：
```bash
node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario collapsed
node plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs --scenario compliant
```

**骨架（可供 F216 复用）**：
1. `copyPluginTo()`（L46-54）：`fs.cpSync` 递归拷贝 `plugins/spec-driver` 到 scratchpad/`os.tmpdir()` 副本（排除 `node_modules`），不污染源码
2. `mountStopHook()`（L57-71）：在副本 `hooks/hooks.json` 的 `Stop` 数组幂等挂载 `stop-fix-compliance-check.sh`
3. `buildPrompt()`（L82-87）：极简 prompt——`collapsed` 场景诱导模型直接回复"已修复"不调用工具（观测 exit 2）；`compliant` 场景只要求回一个字（非 fix 会话对照）
4. `main()`（L89-128）：`spawnSync('claude', ['--print','--model', args.model,'--plugin-dir', pluginDest,'--permission-mode','acceptEdits','--', prompt])`，打印 exit code + stdout/stderr（关注 `[FIX-COMPLIANCE]`/`[GATE-DEGRADED]` 前缀），默认清理副本（`--keep` 保留供排查）
5. 模型默认 `claude-haiku-4-5`，单次成本 <$0.05（T029 记录约定）

**局限（脚本注释 L73-80 明确标注）**：真正的 fix 展开由 slash 命令 harness 注入，spike 无法在 `--print` 位置参数里完美复刻 SKILL 展开——本 spike 主要观测"hook 是否执行 + 退出码转发是否成立"，不是"opus 真实展开 no-op 分支"的完整语义验证。

**F216 复用建议**：可以照搬此骨架新增第三个 scenario（如 `--scenario noop-unverified`，构造一个"声称已修复但无复现证据"的极简 prompt），验证新证据门是否能拦截；但受限于上述局限，**无法**用此脚本验证"编排器 Phase 1 分支的完整 5-Why + no-op 判断逻辑"，只能验证"hook 层对已落盘 fix-report.md 内容的机械判定"——若要验证候选机制的端到端行为，仍需依赖 `--mode report` + 构造静态 transcript fixture（第一节/第三节提到的路径）作为主要验证手段，`spike-fix-compliance-e2e.mjs` 仅作交互闭环的抽样校验。

---

## 7. 回归护栏面

**现有 fix 模式正向路径测试清单**（判定器侧，`plugins/spec-driver/tests/`）：
- `fix-compliance-core.test.mjs`：纯函数判定逻辑单测（见第 4 节）
- `fix-compliance-io.test.mjs`：I/O 边界单测
- `fix-compliance-judge-cli.test.mjs`：CLI 集成单测（含退出码矩阵、阻断有界化、fail-open）
- fixture 索引：`plugins/spec-driver/tests/fixtures/fix-compliance/README.md` 列出 12 个手工构造 transcript fixture，覆盖：零委派坍塌、完整修复合规、no-op 合规、no-op 零委派不合规、损坏 transcript、占位符残留、角色不匹配、多次展开、非 fix 会话、tool_result 伪造锚点、无 subagent_type 中文合规、plan/tasks 假冒 implement 等边界

**"零额外摩擦"验证方式（现状）**：`compliant-full.jsonl`（真实修复路径）与 `compliant-noop.jsonl`（合法 no-op 路径）两个 fixture 分别验证"正向路径不被误伤"——这是当前唯一覆盖"证据门不阻断诚实收口"的护栏。**F216 若在 no-op 分支新增证据字段校验，必须同步更新/新增这两类 fixture**（尤其 `compliant-noop.jsonl`），确保"诚实的、真的引用了可执行复现证据的 no-op 收口"依然能通过新判据，否则会把合法 no-op 出口也堵死（生成假阴性摩擦）。

**尚未覆盖的缺口（本次调研识别）**：
- 当前 fixture 集**没有**任何一条模拟"自信引用行号但无执行证据"的 no-op 形态（即 F212 V008 的真实失败模式）——这正是 F216 需要新增的核心回归用例
- SKILL.md 层面（编排器 Phase 1 决策逻辑本身）没有可自动化跑的单测，只能靠 `spike-fix-compliance-e2e.mjs` 手工验证或依赖真实评测跑批（成本高），这是候选方案验证面的结构性局限，无法在本次调研范围内解决，需在 plan 阶段显式承认

---

## 候选 A vs B 技术可行性初评

| 维度 | 候选 A：red-repro-first | 候选 B：双向对账合同 |
|------|------------------------|----------------------|
| SKILL.md 改动面 | Phase 1 no-op 分支需新增"必须先执行红命令/红测试"强制步骤 + 模板新增"复现命令/执行输出"结构化子字段 | Phase 1 no-op 分支需新增"issue 期望行为 vs 工作树现状"逐条对账表结构（比 A 更结构化，字段更多） |
| judge 侧改动面 | `checkArtifactSection` 需新增识别"命令+输出"模式的正则/子标题锚点，相对单一 | 需新增对账表逐条解析（表格形态，字段数更多），实现复杂度略高于 A |
| 与现有基建贴合度 | 高——`## 判定依据`章节机制、`NOOP_JUDGMENT_HEADING_REGEX`等锚点可直接扩展，不需新增顶层章节类型 | 中——对账表需要设计新的表格 schema 与解析器，改动面比 A 更大，但与 M10 TDD 引擎化卡"红测试前移"的长期方向不完全重合（B 更偏静态审计） |
| 抗绕过强度（理论） | 强——要求**实际执行**（有命令退出码/输出可核验），比纯文本断言更难伪造；但若判据只查"存在执行痕迹"而不核验退出码语义，仍可能被"执行了一个总是成功的空命令"绕过 | 中——对账表本质仍是结构化文本，若判据只查"字段非空"，模型仍可能填入同样自信但未经验证的断言（与当前"判定依据"章节的失败模式同构风险） |
| 与 M9/M10 路线关系 | 与 M9 doc 提到的"= M10 TDD 引擎化卡的 fix 模式切片**前移**"直接呼应，长期战略一致性更高 | 是 F212 终报 §9-1 原始候选，落点更聚焦当前 no-op 判据本身，短期实现成本可能更低 |
| 测试骨架复用 | 可完全复用现有三层测试骨架（core/io/judge-cli），新增 fixture 覆盖"有章节但无执行证据"场景 | 同样可复用骨架，但对账表解析器需要更多新单测覆盖表格边界（空行、缺列等） |
| 主要实现风险 | 判据需要区分"真的执行了命令"与"文本里写了一句'已执行 xxx 命令'"——若不能机械核验命令**真的跑过**（如比对 transcript 里的 Bash tool_use 记录 + 对应 tool_result），退化为与候选 B 同样的"文本自证"风险 | 对账表字段设计若过于宽松（如只要求"现状摘录"一栏非空），同样可能被"复制粘贴代码片段但不解释因果"绕过；需要更严格的字段级证据标准 |

**共同结论**：无论选 A 或 B，**judge 侧的核心新增逻辑高度重合**——都要在 `judgeCompliance()` 的 `no-op` 分支新增"结构化证据字段级校验"，且都面临同一个根本张力：**机械判据只能核验"文本形态是否符合结构要求"，无法核验"文本内容的事实真实性"**。要让候选 A 真正比候选 B 更抗绕过，**判据必须能关联 transcript 侧的 Bash tool_use / tool_result 记录**（证明命令确实被执行过、且输出与 fix-report 引用一致），而不仅是检查 fix-report.md 文本里"看起来像"有复现命令的字样——这是 plan 阶段需要重点设计的判据升级方向。

---

## 关键风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 新证据门退化为"格式检查"（只查是否有"命令+输出"字样），无法核验内容真实性，重演 V008 病灶——模型学会填充"看起来合规"的假证据 | 高 | 高 | 判据必须交叉核验 transcript 侧 `Bash` tool_use/tool_result 记录（是否真的执行过命令），而非仅解析 fix-report.md 静态文本；候选 A 天然比候选 B 更适合做这层交叉核验 |
| 2 | 新判据误伤合法 no-op 收口（真实的历史已修复场景，但复现验证成本高或场景难以构造红测试），产生假阳性摩擦 | 中 | 中 | 复用 `compliant-noop.jsonl` fixture 并新增覆盖"诚实执行了复现验证"的场景，plan 阶段需明确"什么形态的证据算充分"的最小判据，避免过度收紧 |
| 3 | F212 原始取证材料（V008 r1/r2 完整 fix-report/transcript）已随评测 worktree 清理丢失，无法做端到端回放验证，只能靠合成 fixture 逼近 | 高（已确认发生） | 中 | 依据 PUBLISH-REPORT-M8.md L40 引用原文手工构造合成 fixture；若需要更强证据，需向用户确认是否有其他渠道保留原始 `.calibration-output/f212-headline.json` |
| 4 | 改动 `spec-driver-fix/SKILL.md` 触发 wrapper sha 重算链（`.codex/skills/` + F213 `skills-codex/` 双写），遗漏任一份会导致 `repo:check` 失败或 Codex 侧行为与 Claude 侧不一致 | 中 | 中 | 严格按"改 source → `npm run repo:sync` → `npm run repo:check`"顺序执行，不手改生成产物 |
| 5 | SKILL.md 层面的编排器决策逻辑（Phase 1 是否走红测试/对账步骤）缺乏自动化单测手段，只能靠手工 `spike-fix-compliance-e2e.mjs` 或真实评测跑批验证，验证成本高、反馈周期长 | 中 | 中 | 主要验证面下沉到 judge 侧机械判据（可用现有三层单测骨架快速覆盖）；SKILL.md 行为面接受"设计阶段人工审查 + 有限手工 E2E 抽样"的验证边界，在 plan.md 中显式承认此局限 |
| 6 | 候选 B 的对账表 schema 设计不当（字段过少/过于自由文本）会与当前"判定依据"章节同构，重蹈"非空即通过"的判据弱点 | 中 | 高 | 若选候选 B，字段设计必须逐项要求"证据来源类型"（如枚举：commit-hash / test-output / code-excerpt-with-line）并对每种类型定义对应的机械核验规则，不能只做"非空+非占位符" |
