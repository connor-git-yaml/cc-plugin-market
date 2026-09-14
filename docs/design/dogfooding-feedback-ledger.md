# Dogfooding 反馈账本

> 每个需求收尾时，交付报告的「工具使用反馈」节除写在 chat 外，**同步 append 一条到本文件**
> （反馈为"无"则不落账）。`milestone-next` 循环的 §2.5 统一 review 待处理条目、聚类、
> 设计改进计划并回用户拍板；拍板后由 milestone-next 更新条目状态。
>
> 事实源关系：反馈约定的 SSoT 在 `docs/shared/agent-dogfooding-policy.md`（同步进
> CLAUDE.md / AGENTS.md）；本文件只是**账本载体**，不定义约定本身。

## 条目格式

```markdown
### F<NNN> · YYYY-MM-DD
状态：待处理
来源：specs/<NNN>-*/（交付报告反馈节）
- [维度][工具] 问题一句话 + 关键证据；改进方向（如有）
```

- 维度取 dogfooding policy 四维度：`MCP 可用性` / `信息完整性` / `流程顺畅度` / `结果准确性`
- 状态枚举：`待处理` → `已分流 → F<NNN> / M<N> roadmap` / `裁决不做（理由一句话）` / `已修复 → F<NNN>`
- 同一问题被多个需求重复报告时**不去重**，在旧条目上追加 `再现：F<NNN>` —— 复现频次本身是排期信号

---

## 待处理

（无——2026-09-14 两轮 milestone-next：F284 1 + F288–F290/4.6.0 9 + F277 29（补流转）+ F292 6 = 45 条全部流转，见下）

## 已处理

### F279 · 2026-09-02
状态：已处理（5 条：3 已分流 / 2 记录）
来源：specs/279-guardrail-detection-widening/（story 全流程 + 两路异构对抗 + spec/quality 双审查）

- [流程顺畅度][Spec Driver 审查子代理] **`spec-driver:spec-review` 子代理没有 Write/Edit 工具**，
  但编排器按 SKILL 约定要求它产出 `verification/spec-review-report.md` —— 它只能把整份报告作为
  chat 回复交付，由编排器手工转录落盘。这是一个**任务契约与工具配置不匹配**的缺口：
  审查类子代理被要求写文件，却没有写文件的能力。改进方向：给审查类 agent 补受限 Write 权限
  （仅限 `{feature_dir}/verification/`），或把 SKILL 里"产出报告文件"的措辞改为"返回报告正文，
  由编排器落盘"。当前状态下若编排器不主动转录，一份完整的合规审查会**直接随会话流失**。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → F277 移交卡（FR-010~013 承接：审查类 agent 的写盘/证据能力契约）；**F286 已落地**（`spec-review.md` tools 加 Write、仅限 `verification/spec-review-report.md`；artifact output_path 改真实路径）
- [流程顺畅度][Spec Driver 编排] `spec-driver:implement` 子代理在 **63 次工具调用 / 约 19 分钟**后
  遭遇 `API Error: Connection lost mid-response`。代码改动已完整落盘且通过全部验收，但它**未能写出
  实现笔记**，导致"红先行是否真的逐条先见 FAIL"的过程证据**永久丢失、无法追认**。
  再现：F278 的 plan 子代理同轮也断过一次（重试后成功）。
  改进方向：长任务子代理应**边做边落盘取证**（每完成一个 RED 任务就 append 一段），
  而不是把全部证据攒到最后一次性写——否则中断即全失。本卡的补救是改用一种**可复现的替代证明**
  （新测试 × `git show HEAD:` 旧实现 → 观察 FAIL），效果反而更强，可考虑固化为 SOP。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → F277 移交卡（长任务子代理边做边落盘取证；「新测试 × git show HEAD: 旧实现」替代证明固化为 SOP）；**F286 已落地**（`implement.md` RED 级取证逐任务 append；`verify.md` Layer 1.86 F279 SOP）
- [结果准确性][Spec Driver plan 阶段] plan 子代理给出的一条裁决**建立在事实错误的论证上**，
  且该错误**通过了 spec-review**（同构审查），最终被**异构对抗审查**推翻：它主张排除
  `graph.graph.fingerprint`，理由是"已有 `fingerprintUnchanged` 这条独立通道"——但那条通道比的是
  `pinned vs 现算值`，与比较器的 `rebuilt vs pinned` 是**两个不同的事实**。排除的实际后果是
  重建产物 stamp 三处无人读，构成 fail-open 链。**这是"同构审查对门禁类改动结构性漏判"的第六次实证**
  （前五次：F229/F262/F264/F266/F272），进一步支持 2026-09-01 把异构对抗升为常设要求的裁决。
  同轮 plan 还有一处论证机制错误（用"`stageFixture` 不复制 `.git`"推"`sourceCommit` 恒 null"，
  忽略 git 会向上追溯祖先目录）由编排器实跑反例当场拦下。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：记录：同构审查漏判第六次实证——异构对抗已于 2026-09-01 升常设档位，无需再立卡
- [信息完整性][仓库门禁] `tsconfig.json` 的 `include` 只有 `["src/**/*.ts"]`、`exclude` 含 `"tests"`，
  ⇒ `npm run lint` / `npm run build` 对 `scripts/**` 与 `tests/**` **结构性零覆盖**
  （实测 `tsc --listFilesOnly` 对本卡三个改动文件命中数均为 0）；`typecheck:tests` 也只覆盖
  `tests/type-tests/` 下 3 个手挑文件。凡改动面全在这两个目录的卡，收尾清单里的 lint/build
  **跑通不构成任何类型正确性证据**，极易被写成 over-claim。顺带暴露一条既存缺陷：
  `scripts/lib/collector-fingerprint-regen-predicate.mjs` 无类型声明，从 TS 侧 import 是隐式 any
  （TS7016，本卡未处置、超范围）。改进方向：单独立卡评估把 `scripts/`/`tests/` 纳入某条类型门禁。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → **新卡「scripts/tests 类型门禁」**（tsconfig include 只有 src ⇒ scripts/**、tests/** 对 lint/build 结构性零覆盖；含 TS7016 隐式 any 既存缺陷）
- [结果准确性][Spectra MCP graph] 再现：F278/F274 —— `repo:check` 全程告警
  `图产物已 stale（source-commit）`（图记录 `765a9608` vs HEAD `e1105e8b`），
  本卡因此**全程未使用 MCP `impact`/`context`**，caller 分析改用 grep。
  与 F278 记录的张力同源：诚实标注避免误判，但也把工具排除在工作流之外。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：记录：图 stale 期间 MCP 被排除 = P0-C 诚实返回面上线后的真实使用行为证据（与 F278② 同条），进 M10 P0-C 收官证据
### F278 · 2026-09-01
状态：已处理（5 条：3 已分流 / 2 记录）
来源：specs/278-honest-tooling-patches/（编排器验证记录 + 三路异构对抗复审）

- [信息完整性][Spectra MCP graph] `.mjs` 文件里的**顶层具名导出函数**在图中查不到 symbol 级节点：
  返工子代理用 `context`/`impact` 查 `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 新增的
  具名导出 `deriveDelta` 时返回 `symbol-not-found`，`fuzzyMatches` 只能回退到**文件级**候选——
  而那正是它最需要查影响面的那个符号。同批查 `checkJudgeSnapshotDrift`（同文件、同为具名导出）
  则命中。疑为 `.mjs` 采集面的 symbol 粒度缺口（F243 补了 `.mjs` 的**文件/模块**覆盖，
  symbol 层是否同步补齐待查）。改进方向：先确认是采集缺口还是图陈旧导致的（本卡期间图确为 stale），
  再决定是否进 P1-F 多语言 parity 卡。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → P1-F 多语言/采集面 parity 卡（先判 .mjs 顶层具名导出 symbol 缺席是采集缺口还是图陈旧）
- [结果准确性][Spectra MCP impact] 再现：F274 —— 图 stale 时 `impact` 返回**空集**且 `honesty.freshness`
  如实报 `stale` + `builderMismatch: true`。诚实返回面**起了作用**（两个子代理都因此没把空集当唯一证据、
  主动回退 grep 复核），但也直接导致**两个实现子代理明确选择不调用 MCP**（"在一个已过期的图上做影响面判断
  可信度有限"）。即：诚实标注避免了误判，却把工具排除在了工作流之外。这不是缺陷报告，是一条
  产品张力的实证——**诚实返回面本身不解决可用性**，配套的"一键重建"引导（本卡项①改的正是这条 hint）
  才是闭环。建议 M10 P0-C 收官时把这条作为"诚实返回面上线后的实际使用行为"证据记入。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：记录：诚实返回面起效但把工具排除在工作流之外——P0-C 收官证据（再现：F279⑤）；配套「一键重建」hint 即 F278① 已落
- [流程顺畅度][Spec Driver 编排] 编排器给返工子代理**钉死了一个环境依赖的验收常量**（`judge:doctor`
  输出的 sha256），而该常量在会话中途因 `.specify/.spec-driver-path` 由 `4.4.0` 变为 `4.5.0` 而失效；
  子代理**如实反驳并换用同时刻 A/B**（`git show HEAD:` 取改动前实现，与新实现同一时刻各跑一次对比），
  编排器复验后确认反驳成立。教训可泛化：**"逐字节不变"类验收判据不得钉死绝对值快照，必须用同时刻 A/B**
  ——因为被测输出常含本机绝对路径与安装态。改进方向：把这条写进 spec-driver 的 verify 阶段指引
  （"向后兼容类 SC 的验证手段模板"），归口 P1-K 引擎硬化。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → F277 移交卡（verify 阶段「向后兼容类 SC 验证手段模板」：逐字节判据禁钉快照、必用同时刻 A/B）；**F286 已落地**（`verify.md` Layer 1.86）
- [流程顺畅度][Spec Driver spec-review] 再现：M10 §5 P1-K 已登记项 —— `spec-driver:spec-review` 子代理
  frontmatter 只给 Read/Grep/Glob（无 Bash），本卡首次派发时它开口第一句就是"我没有 Bash，无法跑
  `git diff`/`node --test`，只能读文件并标注证据受限"，随即 API 断连。**合规审查的核心工作恰恰是
  核对"声称达成"与"实测证据"的差距，而它拿不到任何实测证据**——只能读代码脑补，这正是它该抓的病。
  编排器改用**预跑注入**（把 `git diff --stat`、Out of Scope 七文件 diff 行数、fixture `git status`、
  `BEHAVIOR_VERSION` 现值、新增用例名、门禁结果、SC-004 的 A/B 结论打成证据包文件让它 Read）后可用。
  → 印证 P1-K 已记的两条方案（只读 git 白名单 / 编排器预跑注入）中**后者可行且成本低**，建议直接采纳
  为 spec-review 的标准前置，而不是给它开 Bash 白名单。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → F277 移交卡（spec-review 标准前置=编排器预跑注入证据包，不开 Bash 白名单）；**F286 已落地**（feature / story / implement / fix 四个 SKILL 派发前置段 + `evidence-pack.md` 路径注入）
- [流程顺畅度][Spec Driver 编排] 子代理长 transcript 的 **API 断连死亡率**在本卡再次凸显：
  plan 阶段的 `spec-driver:plan` 子代理连续两次 `Connection lost mid-response`
  （第一次死在写盘前、第二次死在 plan.md 与 tasks.md 之间），耗掉约 156k + 一轮 SendMessage 恢复；
  最终靠"拆成两次 Write、中途禁止再 Read/Grep 调研"才落盘。改进方向：编排器在派发**产出型**
  子代理时显式要求"先一次性 Write 主制品再做次要制品，中途不插入调研"，归口 P1-K 派发纪律。
  ↳ **处置（2026-09-12 milestone-next，按推荐项处置·可翻案）**：已分流 → F277 移交卡（产出型子代理「先一次性 Write 主制品再做次要制品」派发纪律）


### F272 · 2026-08-31
状态：已处理（5 条：1 已修复 / 3 已分流 / 1 记录）
来源：specs/272-test-guard-asset-cleanup/（story 流程编排器实证 + 异构对抗审查回收）
- [结果准确性][spec-driver 审查档位] **同构审查 1 WARNING vs 异构对抗 3 CRITICAL + 7 WARNING**：
  本卡（守护资产类）同时跑了 spec-driver 内建的 `spec-review` + `quality-review`（同构档位）
  与 2 个 `general-purpose` 异构对抗代理（只给"证伪这段代码"、不给实现思路、指定 2 个切入角）。
  同构侧合计 1 WARNING + 若干 INFO；异构侧报出 **3 CRITICAL + 7 WARNING**，其中 2 条会直接
  导致交付缺陷：①零执行守卫扫描进 `.gitignore` 的 `.claude/worktrees/`，合并回主仓将报
  **2194 条假阳性**（主仓现有 4 个 worktree）；②pinned 陈旧守卫复用的比较器只比 node id 与
  边三元组，`kind`/`metadata`/`confidence`/`fingerprint.behaviorVersion`/`extensionSurface` 全不比——
  而 F249 collector 指纹恰是该资产陈旧的核心信号，守卫对它全盲。这是本仓继 F229/F262/F266 之后
  **第四次**实证同构审查盲区。改进方向：把"守护/门禁类改动必须走异构对抗（换执行者 + 换视角 +
  ≥2 切入角）"从 CLAUDE.local.md 的暂停期临时档位升格为常设约定，不随 Codex 配额恢复而取消
  ↳ **处置（2026-09-01 milestone-next）**：已修复 → 异构对抗升**常设档位**（milestone-next SKILL §5 + CLAUDE.local.md + memory，2026-09-01；第四/五次实证后不随 Codex 配额恢复取消）
- [信息完整性][spec-driver 制品链] **事实基线文档的"结论转述"缺可核验证据**：`verified-facts.md`
  引用 `git show <commit>` 做论据时只写结论（"src 侧断言是 `> 0`、tests 侧被弱化成 `>= 0`"）
  未附原文片段。该结论**是错的**——两侧断言逐字相同（都是 `toBeGreaterThanOrEqual(0)`），
  差异只在 it 名。若按字面执行"修回 `> 0`"会引入确定性红用例（全 mock 管线下 `Date.now()-t0`
  确定性返回 0，实测连续 5 次全 0ms）。这个错误是靠批 A 子代理"全量用例必须绿"的硬判据顺带
  暴露的，判据写宽一点就会直接进 master。改进方向：verified-facts 类"开工前实证"文档引用
  历史内容做论据时，必须附 `git show` 的实际输出片段而非结论转述
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（verified-facts 类文档引用历史内容必附 git show 原文片段）
- [流程顺畅][spec-driver 编排] **子代理在本机休眠 / stall 下的高中断率**：本卡 5 个子代理
  非正常结束——2 次 `API Error: Your computer went to sleep mid-response`（tasks 分解、
  批 C-⑦ 实施）、3 次 `Agent stalled: no progress for 600s`（其中 tasks.md checkbox 同步
  连续 3 次失败，最后触发委派合同的 inline 降级通道）。已登记的教训是"长 transcript 恢复
  高死亡率"，本卡实证**另一类**：纯文档编辑的短任务同样会中断，且 stall 检测要 600s 才触发、
  期间磁盘零产出。改进方向：①派活 prompt 显式要求"尽快落盘、分段 Write 而非最后一次性写"；
  ②编排器侧对纯文档类小任务放宽 inline 降级门槛（三次 Task 失败的成本远高于 inline 完成）
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（子代理「先落盘骨架再逐节 Edit」输出纪律 + 纯文档小任务放宽 inline 降级）
- [流程顺畅][spec-driver spec/tasks] **数字类验收量在多轮修订下反复算错**：本卡的 todo 计数
  被改了**四次**（8 → 7 → 9 → 12），每次都因跨项交互未纳入换算：第一次是纯算术错
  （13+7+1=21 剩 7 却写 8）；第二次漏了 ⑦-B1 把 2 条占位断言转为 `it.todo`；第三次漏了
  对抗审查要求恢复的 3 条 empty-project todo。同期 `inventory-item7.md` 的"35 条"也因
  单位口径不一致（坐标条目 vs 断言行数）被上下游各算错一次。改进方向：spec/tasks 里的
  可观测数量一律写成**换算式 + 各项来源**（如 `21 − 10 − 1 + 2 = 12`），禁止写裸数字；
  且必须显式声明**计数单位**
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（spec/tasks 可观测数量必写换算式+计数单位）
- [MCP 可用性][Spectra] 本卡全程**未使用** Spectra MCP——编排器与全部 9 个子代理独立给出
  同一判断："任务性质是测试文件的文本级比对/删除/断言收紧，不涉及 caller 分析、影响面评估
  或跨包关系，图谱导航不是自然匹配"。唯一的非测试文件改动（`regen-collector-fingerprint-fixtures.ts`
  局部加日志）也不构成 blast radius 场景。如实记录为**适用边界信号**而非工具缺陷：
  测试资产清淤类任务不在 Spectra 的价值区间内
  ↳ **处置（2026-09-01 milestone-next）**：记录：测试资产清淤类任务不在 Spectra 价值区间——适用边界信号，计入 P1-J 定位参考
### F271 · 2026-08-31
状态：已处理（3 条：2 已分流 / 1 记录）
来源：specs/271-product-surface-sweep/（交付报告反馈节 + 两轮实证）
- [结果准确性][Spectra collector-fingerprint 护栏] 护栏比较器是 **metadata 盲**的（`compareGraphOnlyStructure` 只比节点 id multiset + 边 multiset）：F271 给 symbol 节点加 `metadata.lineRange` 后，护栏对真实 fixture 判"一致、无需更新"，但"已 bump 重写"路径序列化全量含新字段 → 该场景 digest 断言失配；pinned 资产经 `--init` 冷启动再生（绕过全部拒绝判据、无留痕通道）后护栏 23/23 复绿——**绿着但对 metadata 面漂移零检测力**，同一盲区在对抗修复轮再次印证（资产含新字段、护栏仍绿）。改进方向：①比较维度加"metadata key 集合"档（不比值、只比 key 全集，捕获字段增删而不引入值级噪声）；②`--init` 冷启动写一条再生审计记录到 fixture README 或独立 sidecar（本卡为手工补记）
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F278 诚实工具面小补**（护栏比较器加 metadata-key 集合档 + --init 冷启动再生审计留痕）
- [流程顺畅度][spec-driver 编排] 宿主机反复休眠时长时后台子代理结构性不可靠：本卡 specify ×2、implement 收口 ×2 共 4 次 Task 死于「computer went to sleep / 600s 看门狗」，两次遗留半成品工作树需主线程盘点接手；~10-17 min 的审查型子代理全部存活。改进方向：编排器对 >15 min 的实现型委派考虑分段化（每段自包含可恢复），或在派发前探测宿主电源管理状态
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（委派按任务时长分流：长文档生成分段落盘或 inline，短分析正常委派；再现：F272③/F270）
- [信息完整性][Spectra 图产物] 再现：F260/F263 —— 边/节点 metadata 无 provenance 标记在本卡再次拖累：撞 id 场景两条生产路径（unified/extraction）取不同 lineRange 被静默合流，逐条目归因"这个值来自哪条路径"只能实跑内存态调试；tree-sitter regex 退化条目也只能靠 `[REGEX] ` signature 前缀这种带内标记识别
  ↳ **处置（2026-09-01 milestone-next）**：记录：边/节点 provenance 缺失再现 +1（F260/F263 同条）→ M10「可信活图审计面」计数
### F275 · 2026-08-31
状态：已处理（2 条：1 记录 / 1 已分流）
来源：specs/275-fix-codex-doctor-hook-trust/（fix 流程主线程实证 + 三个子代理交付报告反馈节）
- [信息完整性][Spectra MCP] 再现：F265（ledger「commit 串从哪读」条目同型）—— plan/implement×2 三个
  子代理独立裁定不用 `context`/`impact`：改动面在 fix-report/plan 里已完全给定（文件+函数级），关键难点是
  "协议事实核对与设计裁决"而非"找 caller"，逐行读源码确认生命周期不可被 symbol 级摘要替代。复现计数 +1
  （改动面给定的 fix 卡上 MCP 结构性零采用），供 M10 检索内核 v1 定位参考：这类卡的真实需求是
  "文件内精读"而非"图导航"
  ↳ **处置（2026-09-01 milestone-next）**：记录：改动面给定的 fix 卡上 MCP 结构性零采用，再现 +1 → P1-J 检索内核定位参考
- [流程顺畅][fix-compliance Stop hook × 后台子代理等待] 变体新现象（与 F262 陈旧快照失明、F267 长异步
  验证 PENDING 两条相邻但不同）：编排器在"四路对抗审查子代理后台运行中、主线程合法等待"状态下两次被
  Stop hook block（要求 verify 闭环产物），但当时流程既未完成也不该产 verification-report——它在等审查
  结论来决定还要修什么。判定器无法区分"流程没走完就想停"与"流程在等后台子代理"。本卡靠继续输出等待
  turn 化解，无实害；但若未来判定器对重复 block 收紧，长后台等待型编排会被卡死。改进方向与 F267 条目
  同向：判定器支持 in-flight 语义（如检测主 transcript 尾部存在未完成的 Task tool_use 时降级为放行+审计）
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F276 P0-A 残余**（判定器 in-flight/等待后台子代理语义——与病根 iii/PENDING 同卡收口）
### F274 · 2026-08-31
状态：已处理（1 条：已分流）
来源：specs/274-fix-global-setup-cross-worktree-freshness/（implement 子代理交付报告反馈节）
- [结果准确][Spectra impact] 再现：F202 —— `impact(tests/global-setup.ts::isDistFresh, upstream)` 对
  "本次新导出/新增的 symbol"返回 symbol-not-found（图是上次构建快照，私有函数不在图中），fuzzy 只给
  低置信候选。改进方向：symbol-not-found 的 hint 当前引导用户"检查 symbol id 格式"，会误导为拼写错误；
  若该文件在图中存在而 symbol 不存在，hint 应提示"可能是新增/新导出符号，建议 `spectra batch
  --mode graph-only` 重建后重试"，把用户导向正确下一步
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F278 诚实工具面小补**（symbol-not-found 且文件在图中 → hint 引导 graph-only 重建而非「检查拼写」）
### F270 · 2026-08-31（spec/plan 阶段交付；implement 待环境恢复）
状态：已处理（4 条：3 已分流 / 1 记录）
来源：specs/270-compliance-evidence-ledger/（spec-driver-story 主线程实证，门禁类第十轮，5 份 research + 3 轮对抗）
- [流程顺畅][spec-driver 子代理编排] **长会话中子代理结构性高死亡**：本卡 spec/plan 阶段 6 次委派子代理死 5 次，全部 API 错误（宿主休眠 ×1 + 连接中断 ×4），且**均在"读完材料准备动笔"阶段零产出死亡**。被迫 specify 修订与 plan 全改主线程 inline（委派合同的合法降级，已标 DEGRADED）。这不是偶发——长 transcript + 大 prompt 的子代理恢复本就高死亡率（memory 已记），本卡把它推到"委派整体不可用"。改进方向：①spec-driver 派发子代理时**强制"先落盘骨架再逐节 Edit"**协议（写进 agents/*.md 的输出纪律，而非靠 prompt 临时叮嘱——本卡两次在 prompt 里叮嘱仍被子代理忽略"Write in one shot"而死）；②编排器对"判定/收口"类必须主线程做的判断，与"可分发的机械填充"更早分层，减少把承重设计塞进易死子代理
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（agents/*.md 落盘纪律为一等输出协议 + 承重判断与机械填充更早分层）
- [流程顺畅][spec-driver GATE] **GATE_DESIGN 无"多轮对抗迭代"的一等表达**：本卡 spec 经历 3 路对抗(22C)→delta 复审(4C)→delta-2 微型对抗，每轮都在**上一轮的修订里**发现新缺陷（FR-025 复活已证伪实现 / FR-046 全称放行 / FR-024 空集条款）。这正是九轮史"修分歧引入新分歧"在 spec 阶段的复现，但 story 模式的 GATE_DESIGN 是单点通过/暂停，没有"对抗-修订-再对抗"的循环结构，全靠主线程手动编排。改进方向：门禁/判定器类改动的 GATE 应内建"delta 复审直到零新 CRITICAL"的收敛循环，而非单轮
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（门禁类 GATE 内建「对抗-修订-再对抗至零新 CRITICAL」收敛循环）
- [信息完整性][spec-driver 反向普查] **护栏表按卡面点名抄=回归根因**（本卡对抗审查的元判断）：spec 初稿的"不回退清单"是按卡面点名的护栏抄的，非按改动影响面反向普查，结果三处最重回归全落在未点名的护栏上（F257 闸门三基线 / F240 US5 零落盘 / F208 非 brick）。改进方向：plan 阶段应有**强制的"关键量反向普查"步骤**（列出被改量的全部消费点），本卡是主线程手动补的（reverse-census.md），应成为 spec-driver-plan 的标准产物
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（plan 阶段强制「关键量反向普查」标准产物）
- [结果准确][Spectra MCP] 本卡**未用 Spectra MCP**（`impact`/`context`/`graph_*`）做判定器改动的影响面分析，全部靠 Explore 子代理 + Grep + 手写 reverse-census。原因：判定器是 `.mjs` 脚本层（plugins/spec-driver/scripts），而 Spectra 图的 caller/callee 覆盖对 `.mjs` 的函数级调用边是否完整未验证（F243 记 CJS module.exports 提取为空是能力边界，`.mjs` 类似存疑）。改进方向：若 Spectra 能可靠给出 `.mjs` 判定器内 `anchorLineIndex` 这类**变量的**消费点（而非仅函数调用边），本卡的五量反向普查本可用 MCP 加速——当前工具面是符号/调用边级，缺"变量数据流"级查询，这类门禁改动最需要的恰是后者（并入 P1-K 值级数据流样本 → P1-J）
  ↳ **处置（2026-09-01 milestone-next）**：记录：值级数据流缺口 → P1-J 定位参考（判定器类代码是符号/调用边图的系统性盲区）
### F270 · 2026-09-01（implement 阶段追加，接 08-31 spec/plan 反馈）
状态：已处理（3 条：2 已分流 / 1 记录）
来源：specs/270-compliance-evidence-ledger/（spec-driver-story implement 六 Phase 实证）
- [流程顺畅][spec-driver 子代理编排] **子代理死亡率随任务长度强相关，但短任务稳定可用**：spec/plan 阶段 6 委派死 5（长任务），implement 阶段改用"短任务形态"子代理（对抗审查、探针，各 <5min）后**存活率接近 100%**（P2/P3/P4 各 2 路对抗 + 环境探针全部完成）。而 implement 的**生产代码红先行+实现**仍全部主线程 inline（判定器接线是承重设计，本就该主线程收口）。改进方向：spec-driver 的委派策略应显式区分"长文档生成"（易死，需分段落盘协议或主线程 inline）与"短分析/审查"（稳定，正常委派）——按任务时长而非任务类型分流。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（委派策略按任务时长显式分流；再现：F271②/F272③）
- [结果准确][spec-driver 门禁自身] **judge:doctor 是承重的 F236 生效时点检测器，但对"本次改动 vs 基线漂移"无区分能力**：本卡改完 judge:doctor 报 drift（4 mismatch + 4 missingInSnapshot），其中 3 个 missingInSnapshot 是本卡新增的账本模块（in-flight-verdict/ledger-reader/ledger-writer）——但 doctor 无法告诉你"哪些 drift 是本次引入 vs 开工前就有"。开工前基线报告手动记了"本机快照停 4.4.0 已 drift"才能区分。改进方向：judge:doctor 增加 `--since <baseline-snapshot>` 或输出"相对某 commit 的增量漂移"，否则每次门禁类改动都要人工记基线。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F278 诚实工具面小补**（judge:doctor 增量漂移视图 --since/基线对比）
- [结果准确][Spectra MCP] 本卡**再次未用 Spectra**——判定器是 .mjs 脚本，且 F270 的核心是"变量级数据流"（anchorLineIndex 的 5 个消费点、saveBlockState 的原样带回合同、JUDGE_FILE_SET 的 import 闭包），Spectra 的符号/调用边级图不覆盖这类查询。本卡靠反向普查子代理 + grep 手工完成。**再现：F270 spec 阶段同条**（值级数据流缺口 → P1-J/P1-K）。复现计数 +1 → 排期信号：判定器/门禁这类"变量数据流承重"的代码是 Spectra 当前工具面的系统性盲区。
  ↳ **处置（2026-09-01 milestone-next）**：记录：值级数据流再现 +1 → P1-J
### F270 · 2026-09-01（集成 review 追加，第 3 次落账）
状态：已处理（2 条：均已分流）
来源：specs/270-compliance-evidence-ledger/verification/integrated-review.md（六 Phase 全 commit 后补做集成审查）
- [流程顺畅][spec-driver 流程结构] 🔴 **plan 阶段可以静默裁剪 spec 范围，而流程没有任何对账点**：F270 卡面 5 病根、spec 49 FR，plan 的 6 个 Phase 实际只覆盖其中一部分——病根 iii/v、PENDING、snapshot-stale 四组在 plan / tasks / 生产码里命中数全为 `0/0/0`，而 `plan.md §8`「spec 与代码现状矛盾记录」也没登记这次裁剪。后果是 tasks 按裁剪后的 plan 写、SC 与 commit 却按未裁剪的 spec 口径报「13/15 达成」，三者对不上且**无人对账**，最终 15 个 SC 的诚实口径是 6 真达成 / 4 部分 / 5 未达成或假达成。改进方向：(a) `spec-driver-plan` 产出时强制生成「FR → Phase」覆盖矩阵，未被任何 Phase 认领的 FR 必须显式落进 §8 的裁剪登记；(b) `spec-driver-verify` 的 SC 核对应以该矩阵为输入，对未认领 FR 自动判「未实现」而非由人填。这是本卡全部 over-claim 的**结构性根源**，不是个案疏忽。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（🔴 头号项：plan 强制「FR → Phase」覆盖矩阵，未认领 FR 显式裁剪登记；verify 以矩阵为输入自动判未实现）
- [流程顺畅][spec-driver 阶段划分] **跨 phase 的「留给下一阶段」承诺无跟踪机制**：P3 的任务卡写「GATE 指纹去重通道预留同路由（随 P4 落）」，P4 实际做的是账本接入、从未接 GATE，而 T311 仍被勾成 `[x]`，导致 `routeNonBlock` 及其两个阈值常量成为**生产零接线的死代码**，其单元测试反而制造了「已达成」假象（变异实验：函数首行改 `return 0` 只红 5 个直接 import 的用例，零端到端失败）。改进方向：tasks 里凡出现「随 Phase N 落」的承诺，应生成一条归属 Phase N 的显式任务，否则该 phase 完成时无从检查。另建议 `spec-driver-verify` 增加「新增导出符号的生产可达性」检查——从真实入口正向追调用链，只被测试 import 的导出应报警。
  ↳ **处置（2026-09-01 milestone-next）**：已分流 → **F277 引擎硬化**（「随 Phase N 落」承诺生成归属 Phase N 的显式任务 + verify 增「新增导出符号生产可达性」检查）


### F240-T062 · 2026-08-31
状态：已处理（4 条：3 已分流 → F275 / 1 记录）
来源：T062 人工验证报告（specs/240-codex-runtime-closeout/verification/t062-manual-report-2026-08-31.md；执行方为 Codex 会话，其硬约束禁改仓库故由 milestone-next 代为落账）
- [结果准确性][codex:doctor] hook-trust 维度在 F264 插件主路径下**结构性假阴性**：只探 `$CODEX_HOME/hooks.json` 存在性，未消费 app-server `hooks/list`，原生 untrusted/trusted/modified 一律误报 not-applicable、remediation=null
  ↳ **处置**：已分流 → **F275**
- [结果准确性][spec 假设] FR-009/_grounding §8.3「信任按脚本内容哈希绑定」被 codex 0.151.0 实测证伪：`currentHash` 只覆盖 hooks.json 声明，脚本改 1 字节仍 trusted——顺带暴露新安全面（受信 hook 脚本可被静默替换）
  ↳ **处置**：已分流 → **F275**（spec 修订 + 评估我方脚本内容指纹核验）
- [信息完整性][codex:doctor] grant-hook-trust remediation 模板缺实测步骤；本次已产出唯一允许回填的实测文案（/hooks → 选事件 → Enter → 小写 t；仅 modified→trusted 完整观察）
  ↳ **处置**：已分流 → **F275**
- [流程顺畅度][T062 骨架] tasks.md §3 步骤骨架写于 F264 之前（依赖全局 hooks.json 路径），与插件主路径不兼容；双注册守卫本身工作正常并给出清晰指引
  ↳ **处置**：记录（骨架已被本次执行实际路径取代，verification-report.md 为准；无需改 shipped tasks.md 正文）


### F264 · 2026-08-24
状态：已处理（2 已修复 / 1 已分流）
来源：specs/264-fix-codex-hooks-distribution/（fix 流程主线程实证 + 对抗审查回收）
- [结果准确性][Spec Driver / spec-driver-fix] **fix 模式没有"前提证伪"环节，这是本卡根因所在的同类缺口**：
  F213 FR-006 与 F240 FR-011 都由一条**未经运行时验证的推断**（"Codex plugin manifest 无 hooks 字段"
  ⇒ "Codex 不读插件 hooks"）承重，两个 feature 的全部门禁（`validate-codex-hooks` /
  `codex-plugin-consistency` / repo:check）却只校验**我方磁盘产物之间的一致性**，没有任何一处去问
  "运行时实际注册了几条"。F240 的 `_grounding.md` 甚至已经记下 `hooks/list` 这条 RPC 是"探测入口"，
  但从未真正跑过。改进方向：spec/plan 阶段对"由推断（而非实测）得出的关键前提"强制显式登记，
  并在 verify 阶段要求至少一条**运行时口径**的验证命令（不是产物一致性口径）
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K「推断前提强制登记 + verify 至少一条运行时口径验证」（fix/feature 模板层）
- [流程顺畅][Spec Driver / 对抗审查档位] 异构对抗档位在本卡**再次抓到同构审查抓不到的东西**：
  实现子代理自审 + 全量单测 296 条全绿的前提下，切入角"绕过面"的独立代理用**完整生产 shell 链**
  实跑出一条真实双注册（symlink 快照绕过），且顺带指出该缺陷的根因是"从 doctor 抄判据时安全方向
  没跟着翻"——这类**方向性**错误恰恰是同构审查（与实现者共享同一心智模型）的结构盲区。
  另一价值点：审查方把 10 条看似互不相干的 WARNING 归因为同一个结构性错误（对等 AND ⇒ 判不出即放行），
  使修法从"逐条打补丁"变成"翻转判据方向"。建议把"要求审查方给出**归因**而非仅列现象"写进对抗审查 prompt 模板
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → 2026-08-31 SKILL §5 新增「对抗审查要求归因而非仅列现象」硬约束
- [返回信息够用][Spectra MCP] 本卡未调用 Spectra MCP：改动面是 shell 脚本 + `.mjs` 插件脚本 + Markdown，
  而知识图谱覆盖的是 `src/**` TypeScript。`plugins/spec-driver/scripts/**`（本仓 hooks / 门禁 / 分发链路的
  实际所在地，且是历史上最容易出静默失效的一层）在图里**没有节点**，`impact` / `context` 对它零可用性，
  只能退回 Grep + Read。这不是本次的偶发，是 F229/F230/F231/F245/F256/F257/F262 一整条门禁卡系的共同处境
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → F265 发布闭环（milestone-next 2026-08-31 实测 scripts/ 层 422 节点在图；当时零节点=旧 4.4.0 全局 MCP 二进制，正是发布断层症状。残留：hooks/*.sh 无解析器不在图，记能力边界不立卡）

### F267 · 2026-08-25
状态：已处理（2 已修复 / 1 已分流）
来源：specs/267-fix-atomic-write-defects/（fix 流程主线程实证 + 两角异构对抗审查回收）
- [结果准确][spec-driver 对抗审查档位] **修复本身引入的新破坏面，只有异构对抗抓得到，测试全绿抓不到**：
  本卡按卡面把「软链跟随」加进 `writeAtomicJson` 后，本卡相关单测全绿（143 个用例）、7 条点名缺陷全部修复，
  但对抗审查用受控 A/B + 真实 `git clone` 实证：跟随把「拆链」升级成「**写穿当前用户可写的任意路径**」
  （git 原生存储软链 mode 120000，克隆即落盘；第三方仓库自带 `specs/_meta/graph.json -> ~/.ssh/authorized_keys`
  跑一次 batch 即写穿），3 个我方产物消费方无任何 JSON 闸。**根因是卡面点名的修复动作本身在
  某些消费方上是净负**——"按卡面修完 + 测试绿"不蕴含"改动是安全的"。改进方向：安全相关卡的
  验收增加一条硬判据「逐消费方问：这个能力对**这个**消费方是收益还是攻击面」，能力默认 opt-in
  而非全局开启；卡面点名的修法在 spec 阶段就要过一遍"谁不该拿到这个能力"
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → 2026-08-31 SKILL §5 新增「安全/权限/软链/子进程类卡逐消费方判能力收益 vs 攻击面 + 默认 opt-in」硬约束（F267 实施已采纳，此为模板化收口）
- [流程顺畅][Claude Agent SDK 子代理] **长 transcript 子代理在本卡连续死亡 3 次**：并发面审查代理
  第一次 API 断连（机器休眠）、重启后第二次 watchdog 停滞 600s 判失败；权限面代理跑满 1890s /
  169k token 才交付。已完成实验的结论可回收（本卡即从死亡代理的 partial transcript 回收了 3 条
  确证结论并全部处置），但**代理死亡时其结论默认丢失**——需要主线程主动去读 partial 输出才捞得回来。
  改进方向：长跑对抗代理改为「分段交付」（每完成一个切入角就落盘一份 partial 报告到 specs/ 下），
  而非全程憋到最后一次性返回；主线程在代理死亡时应默认检查 partial 产出而非直接重启
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → 2026-08-31 SKILL §5 新增「长跑对抗代理分段交付 + 死亡时默认读 partial」硬约束
- [信息完整性][spec-driver fix SKILL] fix 模式 Phase 4「轻量 vs 完整」路径判据只看**改动规模**
  （文件数/行数），不看**改动性质**。本卡若只改 `atomic-write.ts` 一处（<150 行、1 文件）就会判
  轻量路径、跳过 4a/4b 独立审查——而它恰恰是 security-adjacent、且实际引入了 CRITICAL 级破坏面。
  改进方向：路径判据加一条"性质闸"：触及权限/软链/子进程/门禁判定器的改动一律走完整路径，
  规模判据只对性质中立的改动生效
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K「fix 轻量/完整路径判据加性质闸」（触及权限/软链/子进程/门禁判定器一律完整路径）

### F265 · 2026-08-30
状态：已处理（3 已分流）
来源：specs/265-ship-cli-release-gate0/（story 流程编排器实证 + plan/spec-review 子代理交付报告反馈节）
- [流程顺畅][spec-driver 编排] 插件 cache 安装（4.4.0）下 `resolve-project-context.mjs` 与
  `orchestrator-cli.mjs effective-orchestration` 均报 `zod-unavailable` 降级——后者的直接后果是
  **项目级 `orchestration-overrides.yaml` 在缺 zod 时整体不被应用**（diagnostics 原文明说），
  gate 行为解析只能落回 base 默认。源码侧优雅降级已达标（不崩、有诊断），但"配置静默不生效"
  对用户是隐性行为差异；且 4-tier gate 行为链的 user_config 层在 CLI 路径本就恒空（P1-K 已认领
  `orchestrator-cli.mjs:73`），两层叠加后项目级 gate 定制实际全线失效。改进方向：P1-K 修
  userConfig 注入时一并评估 zod 缺失下 overrides 的非 zod 校验路径（手写归一化已有先例）
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K（与 orchestrator-cli.mjs:73 userConfig 恒空同修；zod 缺失下 overrides 的非 zod 校验路径一并评估）
- [流程顺畅][spec-driver 子代理工具面] spec-review 子代理工具清单无 Bash，本卡三处合规核验
  （CHANGELOG `[Unreleased]` 归属的 git 时序、`[推断]` 边界的 commit message 比对、Out of Scope
  的 `.find` 字节级 diff）只能凭文件内容特征间接判断，全部回抛编排器补验。改进方向：spec-review
  的 frontmatter 增加只读 git 白名单（`git log`/`git diff`/`git show`），或在 SKILL 注入块里
  约定"git 考古类证据由编排器预跑并随 prompt 注入"
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K「spec-review 只读 git 白名单，或 git 考古证据由编排器预跑注入」
- [信息完整性][Spectra MCP] plan 子代理反馈（原判"未达落账阈值"，编排器复核后升格落账，
  因同卡 implement/审查子代理全程同样纯 Read/Grep）：本卡核心任务是**值级数据流追踪**
  （"commit 串从哪读、在哪比对、在哪被丢弃、生命周期不跨出哪个函数"），`context`/`impact` 的
  symbol 级 caller/callee 摘要无法替代逐行读代码确认变量生命周期，MCP 在此场景零采用。
  非缺陷定位记录 + 能力缺口候选：若 P1-J 检索内核考虑"符号内数据流"维度，本卡是一个真实需求样本
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-J 需求样本（检索内核若考虑「符号内数据流」维度，本卡为真实样本；非缺陷定位记录）

### F266 · 2026-08-30
状态：已处理（2 已修复 / 2 已分流）
来源：specs/266-honest-graph-quality-gate/（交付报告反馈节）
- [结果准确性][Spectra MCP] 再现：F261 —— MCP context 对广泛被 import 的纯类型 symbol 返回
  不诚实零结果：F266 Phase 1 实施中实测 `context('quality-types.ts::GraphQualityReport')`
  返回 `callers: []`，nextStepHint 提示「无已知调用方，可能为顶层入口」，但该类型实际被 8+
  文件 import（F261 旧条目案例是 `writeKnowledgeGraph`，非同一 symbol，但症状同型：图 stale
  漏边 + 返回体无 freshness 信号 + nextStepHint 误导推论）。备注：该缺陷正是 F266 本卡（诚实
  图质量门）的修复对象——修复后同一查询已返回 boundary-exposed + coverage 缺口 + freshness
  dirty 三态区分，可作为既有分流项（M10 P0 卡③）的验收信号之一，留 milestone-next 裁决是否
  收窄/关闭该分流
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → F266 本卡（修复后同一查询已三态区分；采纳为 M10 P0-③ 验收信号，该分流项关闭）
- [MCP 可用性][Spectra MCP] 子代理会话中 Spectra MCP 工具不可用（新）——F266 的 specify 子代理
  实测调用 `mcp__plugin_spectra_spectra__context` 与 `mcp__spectra__context` 均返回 "No such
  tool available"，而 system-reminder 的 MCP server instructions 声明其可用，spec-driver 的
  5 个子代理 frontmatter 也已授权这些工具。影响：spec-driver 全链「工具优先使用规则」在子代理
  侧实际落空，各 phase 只能靠主线程注入事实兜底。改进方向：排查子代理运行时的 MCP 工具注入
  链路是否与主线程隔离（frontmatter 授权 ≠ 运行时可达）
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K「子代理 MCP 注入链路诊断」（frontmatter 授权 ≠ 运行时可达，spec-driver 全链工具优先规则在子代理侧落空）
- [信息完整性][Spectra 图产物] 本仓 live 图 linkageRatio 仅 3.1%（123767/126411 已探测调用点
  未成边，新）——F266 Phase 3 首次如实暴露该数字（非本卡引入，是长期存量）。含义：coverage-gap
  在本仓任何非导出 symbol 的零结果上恒成立、confirmed-zero 实际不可达；改进方向：M10 P1「边
  stage 标签」（producer 侧 call-site 归因持久化）应按该数量级重估优先级
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-I 卡面优先级论据（linkageRatio 3.1%：coverage-gap 在非导出 symbol 零结果上恒成立、confirmed-zero 不可达 → producer 侧 call-site 归因持久化按此数量级重估）
- [流程顺畅度][Spec Driver] 跨语言外部语料选型验收前须先数目标扩展名文件数（新）——F266 plan
  Q8 纸面推演选了 nanoGPT 验证"非 src 布局告警"，实测其为纯 Python 项目（0 个 TS/JS 文件），
  而 FR-001 判据只对 TS/JS 生效，会跑出"看似通过实则测了另一件事"的假验收；已换 hono（284 个
  真实 .ts 文件）语料。改进方向：验收语料选型 checklist 增加"先用 `find`/`grep -c` 数目标扩展
  名文件数，确认判据适用范围覆盖该语料"一项
  ↳ **处置（2026-08-31 milestone-next）**：已修复 → 2026-08-31 SKILL §5 新增「验收语料先数目标扩展名文件数」硬约束

### F269 · 2026-08-30
状态：已处理（2 已分流）
来源：specs/269-fix-ci-birpc-false-red/（fix 流程编排器实证）
- [流程顺畅][spec-driver fix SKILL] fix 模式复用 `create-new-feature.sh` 会在特性目录落一个
  未填充的 feature `spec.md` 模板（`[FEATURE NAME]` 占位符原样），而 fix 流程制品集是
  fix-report/plan/tasks/verification（F268 先例无 spec.md）——每个 fix 都需手工识别并删除
  该模板，本卡即 `rm` 后才 commit。改进方向：`create-new-feature.sh` 加 `--mode fix` 跳过
  spec.md 脚手架，或 fix SKILL 初始化步骤显式声明删除动作
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → P1-K「create-new-feature.sh 加 --mode fix 跳过 spec.md 脚手架」
- [流程顺畅][fix-compliance Stop hook × 长异步验证] 本卡验收判据是真实 CI 连续 2 次 run
  （30+ 分钟异步等待），而 Stop hook 要求 verification-report.md 先存在才放行 idle——两者
  张力靠「报告先落盘 + 真实 CI 验收节标 PENDING + 完成后回填」的两段式惯例化解。该惯例
  目前无处成文，属编排器现场发明；若判定器未来加「PENDING 节视为未完成」的严格化，这类
  长异步验证流会被卡死。改进方向：把「异步验证 PENDING→回填」惯例写进 fix SKILL，或判定
  器显式支持 in-flight 状态
  ↳ **处置（2026-08-31 milestone-next）**：已分流 → **P0-A spec 必答清单⑤**（判定器显式支持长异步验证的 in-flight/PENDING 语义 + 「报告先落盘、PENDING 节、完成回填」惯例成文）

### F261 · 2026-08-09
状态：已处理（4 条：2 已分流 / 1 已修复 / 1 裁决不做）
来源：specs/261-fix-graph-builder-stamp-notes/（交付报告反馈节）
- [结果准确性][Spectra MCP] `impact(writeKnowledgeGraph, upstream)` 返回 `directCallers: 0` /
  `affected: []`，`context` 返回 `callers: []` 并提示"可能为顶层入口"——实际有 4 个生产调用方。
  根因是在盘图 stale，但**返回体没有任何新鲜度信号**，`callers: []` 与"真的没有调用方"不可区分，
  nextStepHint 还主动往错误推论上引。改进方向：MCP 返回体带 freshness 状态（F261 已把 builder
  这一维 provenance 落进图产物，缺的是接到 MCP 返回面），stale 时对空结果显式降级措辞
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡③**「MCP impact/context 返回面接入图新鲜度状态」（builder 戳 F261 已落图，只差返回面）
- [流程顺畅度][Spec Driver] 子代理无 git 写权限 + plan/spec 只读的组合，导致"主线程裁决推翻了
  plan 口径"只能记在 implementation-notes 偏差节里，plan.md 与实现持续背离（F261 第三/四轮
  D1-D6 裁决实证）。改进方向：给 fix/feature 流程补"裁决回写 plan（就地批注、保留原文）"的显式步骤
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → M10 roadmap「引擎硬化」轨道：fix/feature 流程补"主线程裁决回写 plan（就地批注、保留原文）"显式步骤
- [流程顺畅度][审查派发] 对抗审查子代理默认在主 worktree 做变异测试，与主线程抢文件（触发过
  "file modified on disk"）；主线程审查期间重建 dist 也让两路审查报告"移动靶"困扰。改进方向：
  把"变异/对抗实验必须在 /tmp 副本上做 + 派发前冻结改动面"升格为派发 prompt 模板硬约束
  （F261 第三轮起已在单个 prompt 里手工加此约束，实证有效，缺的是模板化）
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 737075e7 已把"/tmp 副本 + 冻结改动面"写入 milestone-next SKILL §5；本轮追加 stash/checkout 禁令
- [MCP 可用性][harness] 一路对抗审查中途 API 断连（`Connection closed mid-response`），换新代理
  带自包含 prompt 后正常完成。与 memory `feedback_resumed_subagent_api_error_recovery` 一致；
  F261 缺陷②（implement 每 Phase 落 notes）已缓解 implement 侧，审查类子代理的断连损失暂靠
  自包含 prompt 重派。低优先级：harness 层问题，应用侧已有工作缓解
  ↳ **处置（2026-08-23 milestone-next）**：裁决不做：harness 层问题（SDK 断连），应用侧 implement 每 Phase notes + 自包含 prompt 重派已缓解

### F260 · 2026-08-11
状态：已处理（2 条：1 已分流 / 1 记录）
来源：F260 假边面异构对抗审查（主线程派发的独立子代理，交付报告反馈节）
- [信息完整性][Spectra 图产物] 边 `confidence` 落盘为 `EXTRACTED/INFERRED/AMBIGUOUS` 三态，
  而 resolver 内部是 `high/medium/low`，两套词汇要靠 `confidence-mapper.ts` 反查才能对应；
  且边**无 provenance/stage 标记**——审查"哪些边是 F260 新分支产出"时无法从图直接区分
  （F260 边与 Stage 2/3 的 medium 边都塌成 INFERRED），逐边归因只能重跑流水线或读源码补齐。
  改进方向：图边可选带 `resolverStage` 类溯源字段，利于回归审计与逐边 diff 归因
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → M10 roadmap「可信活图审计面」：图边可选 `resolverStage`/provenance 溯源字段 + confidence 双词汇收敛（再现：F263）
- [MCP 可用性][Spectra MCP] 对抗审查场景未走 MCP 工具链——`impact`/`context` 是加工视图，
  证伪需要逐边裸数据，直读 `graph.json` + CLI graph-only（0.1s 建临时图、零认证）更合适。
  非缺陷，属工具定位记录：MCP 面向消费、裸图面向审计，两者互补
  ↳ **处置（2026-08-23 milestone-next）**：裁决不做：非缺陷，定位记录——MCP 面向消费、裸图 + CLI graph-only 面向审计，两者互补

### F263 · 2026-08-11
状态：已处理（2 条：1 已修复 / 1 并入 F260）
来源：specs/263-fix-receiver-shadowing-guard/（交付报告反馈节）
- [结果准确性][Spectra 图产物] 图解析类改动的验收锚点「本仓重建图 method 有 calls 入边数 = 238」
  存在**本仓语料盲区**：F263 三轮判据演进中该锚点始终为 238，但两轮对抗审查各自实测出真实缺陷
  （首版 `total===1` 误伤 TS 声明合并——外部语料 25.5% 的导出类命中该形态；第二版顶层判定
  又放行顶层重赋值假边）。根因是本仓自身不写这些语法形态，**锚点通过 ≠ 判据正确**。
  改进方向：图解析类改动的验收增加第二口径「外部语料抽样 A/B 差分」
  （node_modules 或既有 baseline projects），不单靠自用仓库指标不变
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 2026-08-23 milestone-next SKILL §5 新增硬约束：图解析/采集面类改动验收必须带"外部语料 A/B 差分"第二口径
- [信息完整性][Spectra 图产物] 再现：F260 —— 边无 provenance/stage 标记，
  逐边归因「哪条边是新分支产出」只能重跑流水线或读源码，本次三轮 A/B diff 均受此拖累
  ↳ **处置（2026-08-23 milestone-next）**：并入 F260 条目（同一改进候选，复现计数 +1 → 排期信号）

### F262 · 2026-08-13
状态：已处理（3 条：2 已分流 / 1 已修复+分流）
来源：specs/262-fix-codex-hooks-warnings/（fix 流程主线程实证 + 修复子代理交付报告反馈节）
- [流程顺畅][spec-driver fix-compliance] Stop hook 判定器在 Claude Agent SDK harness 下**结构性失明**：
  主 transcript 懒刷盘（实测滞后 25+ 分钟、停格在 38 行），判定器读到的快照里没有编排器已发生的
  mkdir/Write/委派 tool_use 证据 → 误报「未建立特性目录/缺少诊断报告」并 block（磁盘上两制品俱在；
  A/B 双 project-root 手动跑判定器同结论，排除根目录错配）。blockCount 到 2 后按 F256 有界降级放行，
  DoS 有界但每次 fix 会话结尾必吃 2 次假 block。改进方向：判定器磁盘侧兜底已有（候选历史），
  可考虑对「transcript 尾部时间戳明显早于当前时刻」的陈旧快照显式降级为 indeterminate 放行并记审计，
  而非按"证据缺失"判 block
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡①**「fix-compliance 判定器对陈旧 transcript 快照的处置」——门禁类，须异构对抗档位；方向是"陈旧快照→indeterminate+审计"而非"证据缺失→block"，但任何放宽都是新绕过面（F256/F257 史），spec 阶段须给出被判方无法伪造"陈旧"的判据
- [流程顺畅][spec-driver 编排] 多代理共享同一 worktree 时两处摩擦：①修复子代理用 `git stash push`
  做受控 A/B 隔离，把并行代理的未提交实现一并卷走（即刻 pop + 逐字节 diff 确认恢复；F261 codex-rescue
  stash 教训在内部子代理上再现）——派发 prompt 须显式禁用 stash/checkout 类隔离手段，A/B 改用
  "复制副本→就地改→从副本还原"；②审查后修复轮的派活粒度（单 CRITICAL）与 tasks.md 任务粒度
  （整个 W 条目）不对齐，且共享树上"全量绿"验收对单代理不可达（他人红在途），验收口径应改为
  "目标文件组绿 + 受控 A/B 零 delta"
  ↳ **处置（2026-08-23 milestone-next）**：已修复 → 本轮 SKILL §5：禁 stash/checkout 隔离 + 共享树验收口径"目标文件组绿 + A/B 零 delta"；派活粒度不对齐 → 已分流 → M10 引擎硬化（task right-sizing 卡）
- 指针：本卡审查另产出一批**产品缺陷分流候选**（Claude 侧 hook-installer/atomic-write 问题群、
  doctor `.find` 首匹配漏诊、doctor-io 词法段抽 lexer），已详录于 fix-report「影响范围扫描 · 同源但分流」
  节，milestone 规划时从该处回收，不在本 ledger 重复展开
  ↳ **处置（2026-08-23 milestone-next）**：已分流 → **M10 P0 卡②**「Claude 侧 atomic-write 缺陷群」：`src/utils/atomic-write.ts`（mode 保全 + 软链跟随 + tmp 随机名 + 失败清理）+ `src/hooks/hook-installer.ts`（chmod 0755 放宽 / .bak COPYFILE_EXCL / remove 备份）+ doctor-io `.find` 首匹配漏诊；详单见 specs/262 fix-report「同源但分流」








### F276 · 2026-09-03

- [结果准确][Spectra impact/context] 图过期（sourceCommit 3871dc04 vs HEAD e01611b2）时对函数级 symbol
  （`fix-compliance-judge.mjs::routeNonBlock`）直接 `symbol-not-found`，fuzzy 候选给的是**同文件其他函数**
  （main/parseArgs/buildFeedbackText），对"该函数是否已被删/改名"零区分力，易误导为"函数不存在"；
  `freshness.state=stale` + builderMismatch 的诚实标注到位（好）。改进方向：stale 时对 symbol 查询返回
  "图未收录该 symbol（图陈旧）"而非 not-found，或候选按名字相似度而非同文件排序
- [返回信息不够用][Spectra impact/context] symbol 入参（`io.mjs::saveBlockState`）时 `affected`/callers 坍缩到
  **文件级**节点（judge.mjs 整体，confidence 0.65），`relation:"calls"` 看起来像精确调用边，拿不到
  "judge 里 4 个调用点分别在哪几行"——改返回形状的改动恰恰最需要这一层。规划与实现两个代理各自独立
  报了同一问题，最终都退回 `grep -n`。改进方向：caller 边坍缩到文件级时显式标注粒度，`reason` 里带
  caller 侧 symbol 名与行号
- [流程顺畅][spec-driver 编排] 后台异构对抗子代理在**共享工作树**里做变异实验，与主线程/实现代理的
  `npm run test:plugins` 直接竞态——实现代理第一次全量跑时 `core.mjs` 正处于子代理的变异态，拿到一份
  不可信的"全绿"，靠 sha256 前后对拍才发现。这是 F261 stash 教训的变体（不是卷走文件，是改了文件）。
  改进方向：派发"会改工作树"的审查/变异子代理时给显式互斥约定，或 prompt 硬性要求变异实验一律在
  `/tmp` 副本（本卡后半段已改为此口径，零再现）
- [流程顺畅][spec-driver 编排 · 子代理可靠性] 同一时间窗内 3 个子代理（对抗 ×2 + plan 修订 ×1）连续死于
  `Connection lost mid-response`，且都发生在"读完大量上下文后一次性大写入"那一刻；改为"分段 Edit
  增量修改、禁整文件 Write、回复压到 ≤N 字"后同类失败零再现。目前没有任何机制能把"派出去的代理死了"
  与"根本没派"区分开——恰是本卡组 4（诚实缺席码）要解决的那类问题的近亲。改进方向：Agent 失败时
  自动留一条可判读的缺席痕迹（error 码 + 已读/已写文件清单），供门禁与人工审计区分
- 指针：本卡 GATE_DESIGN 8 轮对抗（拆卡前 3 轮 22C → 拆卡后 5 轮 12C）的方法论收获已落
  `specs/276-fix-compliance-p0a-residue/verification/gate-design-adversarial-round*.md`；
  卡 A / 卡 B 的设计资本与待调研项在 `handoff/README.md`，milestone 规划时从该处回收

### F277 · 2026-09-07
状态：已处理（29 条：19 已分流 / 9 记录 / 1 已修复；2026-09-14 补流转）
来源：specs/277-spec-driver-engine-hardening/（交付报告反馈节；暂存草稿 25 条 + Phase E 新增 2 条 = 27 条，单位：反馈条；按四维度分列 流程顺畅度 13 + 信息完整性 7 + 结果准确性 3 + MCP 可用性 2 + 环境 2 = 27）

- [流程顺畅度][spec-driver agents] specify / plan / tasks 三份 agent frontmatter 缺 `Edit` 与 `Bash`，「先落盘骨架再逐节 Edit」与「取计数」在物理上不可执行；本卡 FR-015 已修，此条记录其暴露过程（长文档子代理只能一次性 Write）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已修复 → F277 FR-015（本条即其暴露过程）
- [流程顺畅度][spec-driver 编排 · 子代理可靠性] 长任务子代理死亡率高：R2 首次三路并发（600 ~ 830 s、27 ~ 55 次工具调用）全部被 API 中断零产出；改「先 Write 骨架 → 边查边 Edit、每路 ≤ 3 方向」后零再现。再现：F276（`Connection lost mid-response`）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（对策「先 Write 骨架 → 边查边 Edit」已固化进 implement 纪律；再现：F276 / 4.6.0 发布准备 reviewer）
- [流程顺畅度][spec-driver 编排 · 子代理可靠性] 后台长任务子代理 600 s watchdog 停摆（Phase B 两次、D-c、γ、BD fix 共五次），全部停在「读完再写」阶段、盘上零增量；对策已固化：首个动作落盘骨架、单段 ≤ 10 条、验证型任务由编排器亲自跑验收命令后勾选。另：「[Request interrupted by user for tool use]」并不等于子代理已停，工作常继续而回传通道丢失，重派前必须先读盘
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（对策已固化；再现：F289 verify / 4.6.0 reviewer——判停摆只认 ListAgents 状态与 watchdog，不认产物 mtime）
- [流程顺畅度][spec-driver orchestrator-cli] `get-phases` 不输出 `gates_before / gates_after`，无法用它判断门挂载；本卡改用 `get-gate-behavior … --format json` 的 `mounted / mounting_violations` 面，未改 `get-phases` 输出
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：`get-phases` 补 `gates_before / gates_after`
- [流程顺畅度][spec-driver plan/tasks] 同 Phase 内后落地的改动使先写死的验证预期失效（A1 D-4 / D-5、A3 T078 vs 裁定 I-1）：plan / tasks 无机制自动发现，只能实现者实跑撞上后手工登记；改进方向：验收命令的期望值写「现取」而非字面量（本卡 SC-002 / SC-014 已按此改）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：验收期望值写「现取」而非字面量
- [流程顺畅度][repo:sync] `repo:sync` 是全量再生、无法只再生 wrapper（A3 D-13 / C D-18 / Phase E 三次再现）：改 SKILL 后 wrapper sha 门禁必红 → 跑 `repo:sync` → 顺带重刷 19 份无关产物（specs/products 时间戳 / adoption 计数 / suggestions）→ 每次须 `git show HEAD:` 逐份回退。改进方向：`repo:sync --only wrappers` 或按 source 变更集裁剪
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑥「repo 引擎：repo:sync 局部再生 + repo:check 断言集下界声明」（M10 §13.3）：`repo:sync --only wrappers` 或按 source 变更集裁剪
- [流程顺畅度][spec-driver tasks 模板] 验收文案「`git diff --exit-code` 零输出」在有未提交改动的工作树里恒非零（A3 (c)）；可执行的幂等判据是「快照 → sync → 逐字节 diff 为空」，模板宜给幂等验收标准写法
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：模板给出幂等验收标准写法（快照 → sync → 逐字节 diff 为空）
- [流程顺畅度][spec-driver tasks 模板] 跨 Phase 乱序执行时「先回 T0xx 补建」指令失效（裁定 I-2 把 C 提前于 B 后，T071 指向的 T054 ~ T056 尚不存在）；模板宜为跨 Phase 依赖增加「前置 Phase 未执行时的处置」栏
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：跨 Phase 依赖增加「前置 Phase 未执行时的处置」栏
- [流程顺畅度][spec-driver 验收判据] FR-049 的代理判据（`git diff -G'暂停'` 为空）与 FR-060 正文语义结构性对撞：任何描述既有门停下行为的散文都被字面量匹配判红，块 3 整块被迫措辞避让；建议改为「新增门定义数」或「AskUserQuestion 调用点计数」
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：代理判据不得与正文语义对撞，改「新增门定义数 / AskUserQuestion 调用点计数」类可数判据
- [流程顺畅度][spec-driver 编排 · 对抗修订] 编排器给出的修法本身可能引入不可证伪的守护项：我要求 FR-053 守护项改调 base 锚定谓词，实现方实证「resolver 已整份回退 base ⇒ 相对判据在强制 mode 上恒真」并拒绝照做（正确）。当前流程没有机制强制子代理对收到的修法做可证伪性核对，靠个体自觉
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）：修法本身列为可证伪性核对项（与「证据链本身受审」同条）
- [流程顺畅度][spec-driver implementation-notes] 覆盖写约定与偏差账本追加需求冲突：文件已超千行，全量覆盖写的成本与丢失风险都在涨；建议定义「当前状态区（覆盖）+ 偏差账本区（追加）」两段结构
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：implementation-notes 定义「当前状态区（覆盖）+ 偏差账本区（追加）」两段结构
- [流程顺畅度][spec-driver implement 纪律] 变异体必须能区分两道闸：12 组攻击构造全红时仍漏掉「截断前缀恰等于冻结快照」这条绕过，只有能区分「解析器 fail-loud」与「护栏逐字相等」的变异体才抓到；建议写进 implement 固定纪律
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）：写进 implement 固定纪律
- [流程顺畅度][git · 显式路径提交] 显式路径 `git add` 整批被 `.gitignore` 目录（`.specify/templates/**` 内已跟踪文件）拒绝且整批零 stage，须对该三份用 `git add -f` 单独加。再现：F253（「被排除父目录内文件只能 `git add -f`」）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（再现 F253；已入 memory）
- [信息完整性][spec-driver 编排 scope] `agents-byte-budget` 候选集不含 CLAUDE.md，编排器 scope 阶段误报口径并传入 spec（R2-SC-C03 抓出）；候选集应从守护项源码 `AGENTS_CANDIDATES` 现取
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：scope 阶段候选集从守护项源码 `AGENTS_CANDIDATES` 现取
- [信息完整性][spec-driver 编排 scope] 「既有注入链恰两条且都硬编码」断言无穷举命令即写入 spec，被证伪（`scripts/sync-agent-docs.mjs` 通用表驱动引擎已存在），用户 Q4 裁定据此改判；教训：清单类断言必须附产生它的命令
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）：清单类断言必须附产生它的命令
- [信息完整性][spec-driver plan] FR-053 守护项对照数写死会陈旧（plan 记「其余 90 / 92」，实测 80）：守护项验收须「以当次实跑为准」而非抄 plan 数字
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑤「plan / tasks 模板与验收判据纪律」（M10 §13.3）：守护项验收「以当次实跑为准」
- [信息完整性][repo:check] 断言集「缩水」没有输出通道（β-C2）：`evidence.total` 12 → 9 时无字段表明射程比预期小；建议引擎级能力：族声明期望断言条数，聚合层比对下界
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇⑥「repo 引擎：repo:sync 局部再生 + repo:check 断言集下界声明」（M10 §13.3）：族声明期望断言条数，聚合层比对下界
- [信息完整性][spec-driver plan · Constitution Check] plan 可用未认领的 FR 为宪法原则背书（D-1 回放：F270 plan `:37` 以 FR-031 背书原则 XI，而 FR-031 零认领）——可机械检测形态：Constitution Check 引用的 FR 必须 ∈ 矩阵已认领集合。后续卡候选
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：Constitution Check 引用的 FR 必须 ∈ 矩阵已认领集合（机械检测）
- [信息完整性][spec-driver verify · 补登] 事后补登本身会收缩范围（D-1 回放：F270 §8 补登 8 条 vs 机械回放 12 条未认领，其中 FR-021 被 F270 自己的 T701 判 CRITICAL 却不在补登内）——补登须由矩阵差集机械生成而非人工列举；本卡 FR-004 口径已覆盖，此条登记为实证
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：补登由矩阵差集机械生成
- [信息完整性][spec-driver prose 手写副本] `agents/plan.md` (ii) 门禁类升格条款在 4 份 SKILL 内是手写副本而非注入块，本卡两轮白名单扩容都靠 sha 抽检守同步（γ-C5 预警面）；候选后续卡：改为第 6 个共享块
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：改为第 6 个共享块
- [结果准确性][spec-driver orchestrator-cli] `generate-template` 输出过不了自家 schema：phase id `0.5 / 3.5 / 5.5 / 6.5` 吐成数字（期望 string），原样存为 override 即 `schema-fallback`；预存 bug，本卡未修
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：phase id 字符串化（明确 bug，小修 + 回归用例）
- [结果准确性][Spectra impact] `impact` 给 BFS 影响面，对「降级一个函数、确认它不再承重」这类审计不如 `grep` 直接（Phase A 对抗修订）：需要的是调用点 + 调用语境，而非可达集合
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 首批 P1-I 诚实工具面（callers / callees 带调用点与语境，M10 §13.3）
- [结果准确性][Spectra graph-quality] 图 stale 与 reverse-census 主证源不匹配：`graph-quality:freshness` 全程 warn（sourceCommit 64b1d72f ≠ HEAD），plan 3.1 的 impact / context 只能作旁证、普查退回 `grep` 主证。再现：F270 / F275
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录；2026-09-14 已 `batch --mode graph-only` 重建、repo:check 转 pass；根治候选 → M11 簇⑦「图新鲜度自动化」（repo:sync 顺带 graph-only，M10 §13.3）
- [MCP 可用性][Spectra] 散文与判定器类改动是工具面系统性空档：A1 / A3 / C / B / D / E 各段均未能用 MCP（对象是 md / yaml / prompt），图只覆盖 ts / mjs 符号面。再现：F270 / F275
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（结构性：图只覆盖 ts / mjs 符号面；md / yaml 入图属 M11 KB / Wiki 方向，不在本簇）
- [MCP 可用性][Spectra] 本卡 Spectra MCP 仅 plan 阶段调用过 impact / context 作旁证（图 stale，未能当主证），specify / implement 各段 / verify / Phase E 均未调用（换算式：有效主证调用 0 ÷ 6 Phase = 0%，单位：Phase）——不是连接失败，是改动面（散文引擎 + 门守护脚本）与图覆盖面不相交；诚实登记而非省略
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（同上条）
- [环境][grep] 本机 `grep` 是 `ugrep -G --ignore-files` 的 shell function：遵守 .gitignore、无 `./` 前缀，输入包里 `grep -v "^./…"` 排除管道全空；影响「命令原文可复现」（FR-027）——本卡产物一律写 `command grep`
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（已入 memory：脚本一律 `command grep`）
- [环境][node --test 取数] `node --test` 汇总行用 `ℹ` 前缀，BSD grep 的 `.` 匹配不到多字节字符，脚本化取数会静默取空（三个变异体结果一度显示为空）；取数脚本须用固定字面前缀
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（已入 memory）
- [结果准确性][spec-driver spec-review · 类别列抽检第二支笔] 本卡新加的「类别列取值抽检」在自身 Phase 5 首次真实命中：矩阵把 FR-016 标约束型，而新建守护代码注释自称实现 FR-016 (ii)，plan 的「承载制品已由别的 FR 认领 ⇒ 本条不新造」论证被从严判据否定 → 追加改判。说明「第二支笔」设计有效，也说明 plan 阶段的类别判定依据需要一条「共享制品」处理规则（候选后续卡）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（机制有效）；「共享制品的类别判定规则」→ 已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）
- [流程顺畅度][spec-driver verify · 角色 prompt 体量] verify.md 已达 582 行，子代理「整读角色 prompt + 68 行对账」组合三次停摆于读完再写；最终靠编排器摘录判定态定义成 151 行简报 + 按行段拆三路 + 每 6 行落盘完成。改进方向：verify 角色 prompt 分层（定义层 / 流程层），或引擎级支持分段对账产物合并
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇④「spec-driver 引擎 / CLI 小补合集」（P1-K 第二卡，M10 §13.3）：verify 角色 prompt 分层（定义层 / 流程层）

### F284 · 2026-09-13
状态：已处理（1 条：已分流）
来源：specs/284-collector-ignore-ssot-guardrail-edges/（两路异构对抗复审子代理的流程反馈）

- [流程顺畅度][对抗审查档位] 变异测试必须整仓 rsync 副本 + 去 `globalSetup` 的独立 vitest config 才跑得动
  （globalSetup 对任一 src 改动都触发 tsc 重建，13 组变异会重建 13 次）；两路审查员各自手搓了一套
  「scratch 副本 + 变异生成 + 逐条断言唯一命中 + 红绿汇总」的运行器。改进方向：给异构对抗档位提供可复用的
  骨架脚本（拷贝 / 变异 / 汇总），归口 P1-K 引擎硬化或 M11 立卡。
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇①「对抗审查纪律」（M10 §13.3）：异构对抗变异运行器骨架（拷贝 / 变异 / 唯一命中断言 / 红绿汇总）作为该卡一项


### F288–F290 · 4.6.0 发布准备 · 2026-09-13/14
状态：已处理（9 条：6 已分流 / 3 记录）
来源：M10 批次 3 门禁串行链（F288/F289/F290）+ 4.6.0 发布准备（主线程 + 两路异构对抗审查）

- [流程顺畅度][对抗审查 · 冻结基线] 门禁类多轮异构对抗时，spec 审查与 implement 并发漂移会让「实现只作对照」的基线变成移动靶（F289 spec 两路审查期间 worktree 处于 rebase 中途 + 归属表从 OWNED 改 Claude-only + spec 6 行改写）：两路 reviewer 各自登记「基线漂移」。改进：派发对抗审查时冻结一个 commit 作审查基线并写进 prompt（F289 implement/delta 阶段起已照此，prompt 显式钉 HEAD）。再现：F289 spec 阶段
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇①「对抗审查纪律」story（M10 §13.3）：派发对抗审查时在 prompt 显式钉冻结 commit
- [流程顺畅度][对抗审查 · fix 会引入反向缺陷] F289 Tier 2 两处 fix 各自引入过反向缺陷、靠后一轮对抗抓出：earliest 锚（修「尾部重展开解绑」）→ 跨目标 fail-open；latest-activity 锚（修跨目标）→ 同目标永久 fail-closed（8 轮零自愈）。教训：门禁类「窗口锚点」改动必须同时构造「同目标重复」与「跨目标切换」两类语料对拍，单侧验证会漏反向；证据/佐证/闸门三窗口方向常相反，不可用单一锚点统一。再现：F289 implement/delta
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：记录（纪律已入 memory + M10 §11）；「同目标重复 + 跨目标切换双语料对拍」随簇① 写进 implement 纪律
- [流程顺畅度][子代理 · 负载卡死] verify 子代理与全量 vitest / gate 并发跑时 stream watchdog 无进展 600s 判死（F289 verify 首派卡死）；同期 vitest 满载 5–18 项 birpc RPC 超时假红（隔离重跑 193/193 全绿）。改进：重活动子代理与全量门禁串行、勿并发；子代理 prompt 内 node/test 命令包 `timeout`、砍 3× 重复与全量语料为抽样。再现：F233/F235/F269 满载假红家族
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：记录；**再现：4.6.0 发布准备**——两路审查 reviewer 与全量 vitest 并发，我按产物文件大小/mtime 误判「停摆」错杀一路（其实正在做 gap-free 重建），恢复后才拿到报告。教训追加：**产物文件大小/mtime 不是子代理进度信号**，判停摆只认 ListAgents 状态与 watchdog

- [结果准确性][冻结型快照 · 版本号诱发漂移] 版本号进入产物内容 ⇒ 每次升版都把 `f220-decomposition-charter` 的 25 处内容 hash 全部改掉，而本仓纪律禁止用 `vitest -u` 再生这类冻结快照（`-u` 会连真实行为漂移一起吸收）。结果是每次升版都必须手搓外科替换脚本 + 手工审计「零非版本诱发内容差异」，且工具面**不提供**任何区分「版本诱发」与「真实漂移」的信号。本轮实测成本：解析 vitest 失败 diff → 按 export 键定位块 → 块内定向替换 43 处（18 版本字面值 + 25 hash），首版脚本因假定「export 键以 `<场景名> 1` 结尾」在场景 8（两个快照、失配的是 ` 2`）上炸掉。改进方向：`charterPayload` 把版本字段排除出被 hash 的内容（或先归一化），升版即不触快照；或提供 `snapshot:rebase --version-only` 之类只允许版本字面值变动的受限再生器。再现：F223 / F259 / 4.6.0 升版
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇②「charterPayload 版本归一化」fix（M10 §13.3）：把 `generatedBy` 版本串归一化出被 hash 的内容，升版不再触快照 → **已修复（2026-09-14）**：`scrubRuntimeNoise` 增 `spectra v<semver>` → `spectra v<VERSION>` 规则 + 场景10c 守护；快照外科替换 18 版本行 + 25 hash，9 个 `full:` hash 由快照自身冻结全文重算全中
- [结果准确性][冻结快照外科替换 · 替换器自身的两个结构性盲区] 上条那个一次性替换脚本经异构对抗复审判「本次产物无缺陷」（三重锁：从 HEAD 出发的字节级重建 sha256 与磁盘完全相同 / 9 个 `full:` hash 有脱离测试的独立算术校验——`moduleSpecs["_index.spec.md"] == "full:"+sha256(scrubRuntimeNoise(_index))` 而 `reporting.indexSpec` 就是同一份清洗全文，故可只用快照自身字节重算，OLD 9/9 + NEW 9/9 成立 / 「vitest 报告 ↔ 实际改动」四元组多重集双射 25≡25），但登记两个**未触发**的盲区，供下次复用前先堵：**(1) `-`/`+` 按 FIFO 配对 + 只断言「两侧键名相同」，在「同一块内同一键出现两次（两个不同旧值）」且 vitest 改为「先集中发 del 再集中发 add」时，键名断言恒真而两个新值互换落位，`c==1` 也挡不住（两处 needle 各自唯一）**——本次不可达仅因 11 个块的 hash 键全部互异；payload 一旦新增第二张以同名文件为键的 hash 表（如 per-file cache digest）该洞即回流，定位键应改为「块内第 N 次出现」或显式断言块内该键唯一。**(2) 切块只以 `Error: Snapshot` 为锚，此后所有 `±` 行都挂到最近一个块**：两个快照块之间若夹一个普通 assertion 失败，其 diff 正文会漏进上一块的替换计划，多数会被「非 hash 行」断言吵醒，但**恰好长得像 hash 行的会静默入计划**。另修正一条口径：25 条替换里 `old==new` 的是 **0** 条，去重后是 **19 个不同三元组**（6 条是跨块重复的同一三元组，语义自洽——场景 8 resume 终态应等于场景 1、场景 6 增量轮未重生成 py），我一度把「19」误读成「19 处变化 / 6 处未变」
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：记录（替换脚本未入库，盲区已写进 memory）；簇② 落地后升版不再需要替换器，此条随之失效
- [信息完整性][release:check publish-gap] `publish-gap` 判定为 `indeterminate`——npm registry 返回体缺 `gitHead` 字段，门禁无法给出「仓库领先已发布 tarball 多少 commit」。后果：写 `[4.6.0]` CHANGELOG 时无法像 `[4.5.0]` 那样用 tarball 实际打包点校准区间起点，只能退回「写入版本号那次 commit」（`3d885d35`）作起点并在条目里显式声明该口径。改进方向：发布时把 commit 写进 tarball 自身可读位置（如 `package.json` 的自定义字段或 `dist/.spectra-build-meta.json`，后者已有），让 gap 判定不依赖 registry 是否回传 `gitHead`
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇③「publish-gap 自证」fix（M10 §13.3）：发布时把 commit 写进 tarball 可读位置，`release:check` 不再依赖 registry `gitHead` → **已修复（2026-09-14）**：`publish-gap-check` 在 registry 缺 `gitHead` 时 `npm pack` + `tar -xOzf` 读 tarball 内 `dist/.spectra-build-meta.json`（F176 盖章已在 tarball 里，无需改发布流程）；新增 c2–c5 用例 + 变异证红；活体：注入无 gitHead 的 npm view 后 677ms 内经 tarball 解析到 6fd45f76。**首版被异构对抗（fail-open / 注入角）判 3 CRITICAL**：白名单放行 `.` ⇒ `npm pack pkg@.` 打包**本地目录**、本地未发布盖章被当已发布锚点 ⇒ pass + 零 warning（C-1）；version 缺失静默回退 `latest` = 身份不明锚点、零留痕、偏 fail-open（C-2）；tar 缺成员抛错被归到 fetch-failed、`missing-build-meta` 的「缺文件」分支不可达而 (c3) 用例认证了生产代码做不出的映射（C-3）——共同病根：**默认实现零测试覆盖（探针证明整套用例从未执行它）**。修法：精确 semver + 首字符禁 `-` 的包名白名单、不回退 latest（`published-version-unknown`）、pack 跑在空临时目录并回验 name/version、env 剥 `npm_config_dry_run`/`npm_config_tag`、pack/tar 两类失败分流（`BuildMetaMissingError`）、`readBuildMetaFromTarball` 拆出用本地 tgz 走真实 tar 覆盖、`sourceDirty` 替代 `dirty`、`unreachable-commit-tarball` 独立文案、`killSignal: SIGKILL`。40 例 + 7 关键变异体全红；活体 4.6.0→解析 / 4.2.0→missing-build-meta / 4.5.0→领先 6 个 src commit warning。**教训：「注入替身把用例做绿」= 生产路径零覆盖的同义词；给外部 argv 的每个片段都要问它能否占据首字符。** 再现 F268（新 helper 回流反模式）
- [流程顺畅度][对抗审查 · 假安全网是最高产的攻击面] F290 四个 CRITICAL **同属一类**：我声称「这条已被测试钉住」而实测没有（上限常量零覆盖、allowlist 双向对当前取值是死代码、剥注释只剥整行不剥行尾、形态③把「定义 + 表登记」两处纯声明性引用算作产出）。共性是**断言写在守护项旁边、但不覆盖守护项真正的失效方向**。改进：每处「已有守护」的声明都必须配一个变异体并实测变红才算成立（本卡 11 项应红 11 项真红）；派发对抗审查时把「找出所有声称有守护但变异不红的点」作为独立切入角。再现：F278（单角复审的「有守护」只覆盖半个变异空间）/ F279（每处修复单独做变异体检查）
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇①「对抗审查纪律」story（M10 §13.3）：「找出所有声称有守护但变异不红的点」列为固定独立切入角
- [结果准确性][冻结快照验收方法论 · 「diff 过滤后为空集」是假绿灯] 我为 4.6.0 升版的快照替换给出三条论据，经两路异构对抗**全部被推翻**（结论本身成立，但不是靠这三条成立的），这三条正是最容易被复用的错误模板：**(1) 基线论据事实错误且循环**——我引「3596acee 门禁 8248 passed 所以升版是唯一 delta」，实测该日志是**升版后 + 快照替换后**那一跑；真正的替换前状态是同目录早 9 分钟的另一份日志「10 failed / 8238 passed」，而 8238+10=8248；`3596acee` 上**从未跑过清洁树门禁**（真正的 4.5.0 清洁基线在 `387a9635` / `5c3f0bbe`）。教训：引门禁数字必须核对该次跑的**盖章 commit + 工作树状态 + 日志 mtime**，否则会拿"修完之后"证明"修得对"。**(2) 「失败输出里除表头全是 hash 行」是循环论证**——因为 18 处版本字面值已在该次跑之前被替换掉了，替换脚本自身的 `assert not bad` 又保证了非 hash 行为零，所以这条对「有没有别的漂移」零信息量。**(3) 「`git diff` 两条 grep 过滤后为空集」实测会吞真实漂移**：`grep -vE '^[-+][[:space:]]+"[^"]+": "(full:)?[0-9a-f]{8,}",$'` 精确命中本 .snap 里真实存在的 `currentHash` / `previousHash`（64-hex，deltaReport 的源码骨架 hash，共 2 行），一次真实 AST 骨架漂移会被静默滤掉；`grep -vE 'v4\.[56]\.0'` 按整行丢弃，「同行既含版本号又含别的变化」也一起消失；构造的 6 行漂移喂进原管线残留 0 行。**正确验收标准（建议固化为此类外科替换的必经步骤）**：回代变更源 + 逐字节比对旧版本，零残差才算证完——(a) 捕获实跑产物（`TMPDIR` 重定向 + 轮询复制，绕过 `afterAll` 清理）现算 hash 自校验命中新快照，(b) 把版本串回代旧值后复算命中**旧** hash（sha256 preimage 匹配，64 bit 不可能偶然撞上），(c) 对新 .snap 做「版本串 + hash 双向回代」重建并与 `git show HEAD:` 逐字节比对零残差。本轮三步均通过（25/25 + 25/25 + rebuilt sha256 == HEAD sha256）。附带确认：每份 spec 里版本串恰好出现 1 次（故无「一份文件多处版本号漏替」风险面），代码面版本出口仅 `frontmatter.ts:102` / `index-generator.ts:140` / `spec-store.ts:81`（spec frontmatter `generatedBy`）与 `batch-readme-generator.ts:49`（README 首行），与 18 行一一对应。
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇②「charterPayload 版本归一化」fix（M10 §13.3）：「回代重建 + 逐字节零残差 + preimage」验收标准随该卡写进 F223/F259 纪律；mainline-focus 共享块措辞已同步改为该口径 → **已修复（2026-09-14，随簇② 落地；此后升版不再触快照，该验收法退为历史方法）**
- [流程顺畅度][对抗审查 · 证据链本身要接受审查] 本轮两路 reviewer 都没能推翻结论，但**一路把我的全部三条论据判为无效**并给出更强证法。价值不在「有没有 CRITICAL」，而在「你用来证明它的东西是否站得住」——纪律：派对抗审查时把**论据本身**列为独立攻击面（「假设我的证明方法有洞，构造一个它会给假绿灯的输入」），而不只是问「结论对不对」。再现：F278（「逐字节不变」判据禁钉快照须同时刻 A/B）/ F257（演绎证明把「进候选历史」当「usable」，穷举没覆盖破绽形态，二者互相背书出假结论）
  ↳ **处置（2026-09-14 milestone-next，主线程代用户判断·可翻案）**：已分流 → M11 roadmap 簇①「对抗审查纪律」story（M10 §13.3）：「假设我的证明方法有洞，构造一个它会给假绿灯的输入」作为固定攻击面写进对抗 prompt 模板

### F292 · 2026-09-14
状态：已处理（6 条：3 已分流 / 1 记录 / 2 已修复）
来源：CI coverage 放行分支 fail-open 收口（另一 session 交付 766c6015；本 header 为 rebase 冲突解决时按账本约定补加，条目原文未动）

- [结果准确性][门禁 · CI 日志判据] **CI 上的 vitest 输出带 ANSI**（tinyrainbow 的 `isColorSupported` 因 `"CI" in env` 为真而开色，与 TTY 无关），任何"对 CI 日志 grep 判定"的门禁若不先剥色就结构性失效：F285b 的 `Tests +[0-9]+ failed` 在真实 CI 上**永远匹配不到**彩色失败行（数字与 `failed` 之间夹着 `\e[39m\e[22m` 等序列）——即"测试真失败 + 一次 birpc 超时"会被一并放行。教训：判定对象是 CI 日志时，样本必须**从真实 CI 取**（`gh run view <id> --job <id> --log`）或在 `CI=true GITHUB_ACTIONS=true` 下采集，本地 TTY 采样会漏掉整条失效面。再现：F292
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已修复 → F292（判定器先剥色）；纪律「对 CI 日志 grep 的门禁必先剥色」→ 已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）
- [信息完整性][门禁 · 语料与生产环境不一致] F292 首版 8 份样本只设了 `CI=true` 而没设 `GITHUB_ACTIONS=true`，于是 vitest 自动挂载的 `github-actions` reporter（把未处理错误原样复制成 `::error ...` 注解行，位置在汇总与覆盖率表之间）在整个守护面上零覆盖——两条 CRITICAL 因此同时逃过 8 份样本 + 变异隔离表 + 前一轮对抗审查。教训：**门禁类卡的样本采集环境必须逐项对齐生产环境的环境变量**，且默认取一次真实 CI run 日志入库对拍（F292 已把 F285 首跑日志裁剪入库为 `tests/fixtures/coverage-gate/ci-run-34710678418-birpc-pass.ansi.txt`）。再现：F292
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已修复 → F292（样本补 `GITHUB_ACTIONS=true`）；纪律「守护语料须复刻生产环境变量」→ 已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）
- [流程顺畅度][变异实证 · 注入点必须先自证落位] F292 中我（主编排器）三次把变异注错位置却险些读成"守护有效"：(1)(2) 在**未剥色**的日志原文里 `replace("Test Files  549 passed", …)` / `replace(" % Coverage report", …)`——目标字面量被 ANSI 序列切开，`String.replace` 静默返回原串；(3) 在 `ci.yml` 上 `replace("          status=$?\n", …, 1)` 改到了上游 typecheck 步（同缩进同名行先出现），coverage 步毫发无损。三次的共同后果都是**"变异没生效"被读成"断言挡住了"**。教训：变异实证的第一步是**断言注入点**（改完先 diff/打印目标区段确认，再解读测试结果）；对含 ANSI 的语料，变异要在剥色后的文本上构造或用容忍转义的正则。再现：F292
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）：变异注入后先断言命中再看红绿
- [流程顺畅度][对抗审查 · 修复本身会引入同类新洞，且「同文件语义不一致」是高产攻击面] F292 共四轮对抗（角 A fail-open / 角 B 误伤面 / delta-2 专攻新判据 / Phase 4b 质量审查），**每一轮都在上一轮刚写出的新判据里挖出 CRITICAL**：全文子串计签名 → 顶格标题行计数（被测试 stdout 伪造 + `Unknown Error:` 真错漏计）→ 分区锚定；`Errors` 正则无行锚被注解劫持；(c) 的三处 `.match()`（取第一处）与同文件其余检查统一的 `lastMatch`（取最后一处）**语义不一致**，同时开出 fail-open（诱饵完整表掩盖真实坍塌表）与镜像误伤（汇总前的相似表致误红）两个方向。教训：把「**同一文件内同类操作是否统一语义**」列为独立审查切入角；新判据落地后必须再审一轮（delta 轮不可省）。再现：F251/F259/F279（delta 轮连抓）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）：delta 轮专攻新判据 + 同文件多处判定的语义一致性核对
- [结果准确性][对抗审查 · 审查结论本身要复核] 角 A 的 C-1 断言「真实 birpc 超时会被 `github-actions` reporter 复制成 2 条签名 ⇒ 该放行的永久判红」——我实跑证伪：真 birpc 错误的栈帧全在 `node_modules`，`GithubActionsReporter` 对拿不到源文件位置的错误**跳过注解**（真实 CI 日志 `::error` 计数为 0）。它用的是测试里手抛、消息恰好含签名的**假** birpc。但同一条发现里「子串计数与错误身份无绑定」的结构性判断成立且必须修。教训：审查结论要分离「构造出来了」与「生产环境会发生」，两者都要单独核，**采信半条、驳回半条**比整条采信或整条驳回更常见。再现：F278（论据被判无效但结论成立）
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：已分流 → M11 簇①「对抗审查 / implement 纪律」story（M10 §13.3）（与「证据链本身受审」合并为一条纪律）
- [MCP 可用性][Spectra] F292 全程零 Spectra MCP 调用（换算式：有效调用 0 ÷ 5 阶段 = 0%，单位：阶段）：改动对象是 GitHub Actions YAML 步骤、新建的独立 .mjs 判定器与日志文本正则，与图覆盖的 ts/mjs 符号关系面不相交；主要成本在实跑 vitest 采样、构造变异语料、拉真实 CI 日志。不是工具故障，是改动面与工具能力面不相交——与 F270/F275 登记的「散文与判定器类改动是工具面系统性空档」同族。再现：F270/F275/F278/F279
  ↳ **处置（2026-09-14 milestone-next 补流转，主线程代用户判断·可翻案）**：记录（同 F277 两条：改动面与图覆盖面不相交）

### spec-driver-sync 补聚合 · 2026-09-14
状态：已处理（5 条：4 已修复 / 1 已分流）
来源：M10 收官盘点「产品活文档 5 个月未聚合」落地（主线程跑 `spec-driver-sync`，98 份未映射 spec）

- [结果准确性][spec-driver sync-merge-engine · FR 抽取零命中] 引擎的 FR 正则要求 `- FR-001:` 形态，而本仓 spec 模板写成 `- **FR-001**: …`（加粗 ID），于是**自 4 月首次聚合起对 190 份 spec 抽出 0 条 FR**，`validation.fr-count` 却报 pass（「活跃 FR 0 ≥ INITIAL 0」——下界是从产物自身读的，空对空恒真）。已修：ID 两侧允许可选 `**`（前瞻同步放宽），新增 `sync-merge-engine-fr-extraction.test.mjs` 红先行 + 变异体证红；修后 spectra 36 / spec-driver 34（+19 superseded）。教训：**校验的下界若取自被校验产物自身，空产物必然自证通过**——`fr-count` 应有绝对下界或与 spec 原文条数对账。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（三轮对抗后终态：条目 = 列表位 / 行首粗体段落 / H3–H6 标题起始位；编号语法覆盖 `FR-1` / `FR-A-001` / `FR-A01` / `FR-1.1` / `FR-003A` / `FR-026-01`；「候选编号未抽取」warning 按编号集合差判定 + 无需求类 H2 时全文兜底）；`fr-count` 绝对下界未做（活跃 ≥ INITIAL 活跃仍恒真）→ M11 簇④。
- [结果准确性][spec-driver sync-merge-engine · FR 按 ID 跨 spec 合并] 引擎把不同 spec 的同号 FR（spec 001 的 FR-001 与 spec 052 的 FR-001）当同一条需求，合并成「FR-001: … [增强 by 052] … [增强 by 053] …」，`supersededBy` 也按同号判定。但本仓 FR 编号是**每份 spec 内局部编号**，跨 spec 同号无语义关系，骨架第 5 章因此是「按编号分桶的拼接」而非按功能分组的需求清单；`no-contradiction` 检查也在错误的桶上跑。本轮聚合改用「逐 spec digest → 按 FR-GROUP 语义合并」绕过，引擎骨架只取 userStories / timeline。改进方向：引擎按 `sourceSpec` 分桶（产品级 FR 由聚合器重新编号），`supersedes` 只认 spec 显式声明。→ M11 簇④ 候选
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（身份键 = `(sourceSpec, id)` 三处同改；四类 handler 一律只追加本 spec 的 FR，同 spec 重复编号交冲突解决器首条胜出并可见登记；真实仓库仅 2 条冲突且都是 spec 157 自身重复）。簇④ 的「按 sourceSpec 分桶」条目由此闭合；产品级重新编号仍由聚合器承担。
- [信息完整性][spec-driver sync · fix 模式产物不进聚合] `sync-merge-engine` 只扫 `spec.md`；本仓 300 个 feature 目录中 **94 个只有 `fix-report.md`**（fix 模式不产 spec.md），另 14 个 spec.md 仍是 `[FEATURE NAME]` 模板占位（F245/246/248/251/253/254/255 等真实交付过的修复卡）。这些行为变化只经 CHANGELOG 进入产品叙事，活文档结构性看不见 fix 卡。本轮把占位 14 份继续排除并在 product-mapping 头部登记。改进方向：sync 增加 fix-report 消费通道（取「修复摘要 / 行为变化」段进变更历史与已知限制），或 fix 模式在收口时生成最小 spec.md 存根。→ M11 簇④ 候选
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已分流 → M11 簇④（fix-report 消费通道），本轮未动。
- [结果准确性][spec-driver sync-merge-engine · 非 dry-run 默认重写映射文件并剥掉注释] `sync-merge-engine.mjs` Phase 7 在非 `--dry-run` 下把「产品名修正」后的映射用 `stringifyYaml` 重新序列化写回 `product-mapping.yaml`——序列化不保留注释，文件头部的「可手动编辑覆盖 / 最后更新 / 未纳入正式映射 ×4」十行注释被**静默删光**（本轮首次跑 `--json` 即触发，`git diff` 才发现）。而 `agents/sync.md` 让子代理跑的正是不带 `--dry-run` 的命令。文件自述「手动添加的条目在重跑 sync 时不会被覆盖」只对条目成立，对注释不成立。改进方向：写回只在映射**语义**有变时执行，且保留原文件注释块（或改为只写条目、注释区独立文件）；sync.md 的命令加 `--dry-run`。→ M11 簇④
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（写回改为语义比对，只在产品名修正时执行，且保留原注释头，含 CRLF 空行）；`agents/sync.md` **不**加 `--dry-run`（引擎现在的写回是安全的，sync 子代理仍需非 dry-run 语义）。残余（记录）：写入时 `parseProductMapping` 仍丢 `name` / `owner` / 行内注释——只在触发写入的那次发生。
- [结果准确性][HAS_LLM_E2E 门后的 4 个 batch 用例结构性跑不通] `feature-180-batch-repro` 的 T-010-1/2/4/5 用 MCP SDK 默认 60s 请求超时调 `batch`，而文件头注释自述「micrograd python-only 全量跑约 3-5 分钟」；本轮 `HAS_LLM_E2E=1` 实跑 4 例全部 `MCP error -32001: Request timed out`（60016ms）。vitest 层 `360_000` 超时对 SDK 请求超时无效——这四条 SC-007 的守护用例在订阅 CLI 路径上**从未可能通过**，只是 keyless CI 永远 skip 所以没人发现。本轮实跑与 8 路子代理并发（同订阅额度），须在安静窗口隔离重跑确认；若仍超时，修法 = `callTool(params, schema, { timeout })` 传 ≥ 360s。→ 本轮修
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`callTool(args, undefined, { timeout: 300_000 })`，it 330s / 720s；首次真跑结果与 T-010-4/5 前提问题见下节「feature-180 LLM e2e 首次真跑」）。

### spec-driver-sync 引擎三轮对抗 · 2026-09-14
状态：已处理（18 条：15 已修复 / 1 已分流 / 2 记录）
来源：sync-merge-engine 身份键修复的第二、三轮异构 delta 审查（角 A 静默丢失 / 角 B 误抽污染）+ 主线程真实仓库对拍

- [结果准确性][引擎 · 后标题覆盖前标题 + 护栏同步失明] 第二轮 delta 抓到：H2 路由是 `if (命中) result.requirements = extract(...)` 无累加，新增的 `需求` 关键词让 `## 非功能需求` / `## 需求模糊点说明` 这类**排在功能需求之后**的标题把已抽出的 FR 归零（20 份 spec / 301 条，含引擎自己的 spec 091 的全部 12 条），而候选计数写在同一个 if 块里被同一次覆盖抹成 0 → `候选 > 抽取` 恒 false，一条 warning 都不出。**护栏与被护对象共用同一条失效路径，护栏等于不存在。**
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（命中即累加；`isRequirementsHeading` 排除 `non-functional` / `nfr` / `非功能` / `模糊`）；纪律 → 簇①：**护栏的失效路径必须与被护对象独立**（同 F270「闸门判据被自家产物恒满足」家族）。
- [结果准确性][引擎 · 子编号目录坍缩] 目录侧 `/^(\d{3})-/` 与 mapping 侧 `/^(\d{3})/` 各写一套，都把 `094-02` 截成 `094`：六份 094-0x 共用一个键，`parsedSpecs` 互相覆盖，最后一份（094-07）被合并六次、其余五份的需求整体消失，产生 75 条「094::FR-00x 多个 active 版本」假冲突。两轮审查和我都把「冲突多」读成 spec 写法问题而不是身份问题。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`extractSpecId` 单一口径 `^\d{3}(?:-\d{2}(?=-\D|$))?`，目录与 mapping 共用）；纪律 → 簇④：**同一标识符在两个解析点各写一套正则迟早分叉**，编号 / 路径类判据须共享 helper。
- [结果准确性][引擎 · 编号语法的真实分布远超模板] 全仓 FR 条目写法：点分子编号 `FR-1.1` 60 行、`FR-N` / `FR-NN` 186 行、字母分组 `FR-A-001` / `FR-A01` 15 行、标题位 `### FR-016：…` 220 行、行首粗体段落 `**FR-001**: …` 214 行、区间标签 `#### FR-001 ~ FR-005:` 5 行。每放宽一档都激活一批此前静默丢失的 spec，也各自带来新撞号（`FR-1.1` 被截成 `FR-1`、区间标签成条目）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（编号语法 `FR-(?:[A-Z]-?)?\d{1,3}(?:\.\d+)*(?:[A-Za-z]|-[A-Za-z0-9]+)?`；标题位条目只认编号在标题起始；区间标签 / 标题中段引用不成条目；fenced code 内不成条目）；改进方向 → 簇④：spec 写法 lint（「候选编号未抽取」warning 已是第一层）。
- [结果准确性][我方统计口径错误 · 自我更正] 本轮此前写进 memory 的「spectra 1232 / spec-driver 620 active，0 superseded，0 候选 warning」是在上两条缺陷存在时得到的：spectra 含 094-07 六倍重复、缺 301 条被覆盖的 FR。终态（第三轮后）：spectra 105 spec / 1586 FR（active 1584，含 170c/170d 32 条）、spec-driver 54 / 792，2 条冲突（157 自身重复）；0 候选 warning，另 15 条提示（8 份 spec 需求节之外的条目写法 / 6 份零 FR spec / 34 份未映射）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：记录（M11 §2 与 memory 已更正）；纪律：**对抗审查未收口前不把中间统计写进文档 / memory**。
- [结果准确性][引擎 · 示例代码块与引用型标题造假条目] 第二轮 W-2 + 主线程实测：需求节里 fenced code 中的 `- **FR-901**: 示例` 会成为真条目（连闭合 fence 都吃进描述）；旧 H3 回退用 `.*?FR-` 懒匹配，`### 澄清 2: FR-006 …` / `### 状态矩阵（…FR-004/005 均引用本表）` 这 16 处引用型标题在 spec 零列表条目时会成条目。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（fence 状态机；标题位判据「编号在起始」）。
- [流程顺畅度][sync 编排 · 派发前机械对拍] 合并子代理回报：编排指令里的「聚合数 103」、mapping 头部的「+46 spectra」、digest 对 `094-02` 的归属（unclassified）三者互不一致，只能由下游代理自行发现并回报。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已分流 → 簇④（sync 编排器派发前做 mapping 条目数 / digest 节数 / 归属判定的机械对拍；本轮按「重构归被重构产品」把 094-02 计入 spectra，活文档 106 = mapping 106）。
- [信息完整性][引擎 · 残余清单] `level` 只在解析层存在、骨架不携带（无消费方）；`fr-count` 下界仍取自产物自身；写回时 parser 丢 `name` / `owner` / 行内注释；`splitByH2` 对 fenced code 内的 `## ` 与重名 H2 无防护；`cleanEntryFirstLine` 只剥首行粗体；`level` 的 `/i` 让 `may be null` 误判 MAY。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：记录 → 簇④ 候选。
- [结果准确性][护栏 · 候选集与抽取集同源] 第三轮角 A C-1：候选编号只从**被路由到的需求节**收集，路由层的丢失对护栏结构性不可见——spec 032 在 `## Clarifications` 下写了 7 条 FR（4 条新增 + 3 条对已抽取条目的「修正」），零 warning；「修正」行的编号已在抽取集合里，按集合差原理上报不出。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（非需求节里的条目写法逐行登记为「需求类 H2 之外」warning，含 H2 位条目；真实仓库 8 份 spec 命中，032 的 7 条全部可见）；纪律 → 簇①：**护栏的取数路径必须独立于被护对象的取数路径**（与本节第 1 条同族，同一天第二次实证）。
- [结果准确性][引擎 · 同名 H2 键冲突 + fenced code 里的 `## `] 第三轮角 A C-2/W-1：`splitByH2` 以标题作对象键，同名 H2 后者覆盖前者——与上一轮「后标题覆盖前标题」同构，但发生在路由之前，累加修法没覆盖到；全局正则不看代码围栏，一个 ```` ```md ```` 示例就把需求节后半段切给伪标题（真实仓 143 有 10 处，当前 unmapped）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（返回数组保留重名与出现序 + fence 感知，与抽取器同源）。
- [结果准确性][引擎 · 字母后缀目录被扫描跳过] 第三轮角 A C-3：`170c-*` / `170d-*`（同族拆卡约定，32 条 FR，本仓在用）连 scannedSpecs 都不进，因此也进不了 unmappedSpecs，零 warning；缺陷早于本轮，但本轮重写了那一行并声称「编号口径统一」。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`extractSpecId` 认字母后缀；170c/170d 登记进 spectra 并补聚合进活文档）。
- [结果准确性][validator · fr-count 基线取自被检对象] 第三轮角 A C-4：`fr-count` 的 INITIAL 基线从骨架自身读，抽取全丢时 0 ≥ 0 恒 pass；`no-contradiction` 跑在 resolver 之后恒真；`changelog-coverage` 与 FR 条数无关恒真——当初「190 份 spec 抽 0 条 FR 而 validation 自证通过」的那道闸门此前一个字没改，全靠新增单测挡复发。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`fr-count` 改为合并守恒：骨架 FR 总数 == 各 spec 抽取条数之和，基线取自合并**前**的解析结果，少了是 handler 吞条目、多了是重复合并）；另两项恒真检查记录 → 簇④。
- [信息完整性][引擎 · 三条缺失的提示] 第三轮角 A W-5/W-6/I-3：映射到产品却抽不出任何 FR 的 spec（真实仓 6 份：100/130/177/221/082/136）此前全程无声；mapping 悬空编号无提示；spec 080 映射到两个产品、FR 双份写入。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：前两条已修复（零 FR 提示；悬空提示区分「无目录」与「有目录无 spec.md」，只有 blueprint.md 的目录豁免）；080 双映射记录（mapping 头部已声明跨产品条目）。
- [结果准确性][引擎 · 我误删了英文 Scope Boundaries 的约束路由] 第三轮角 B C-B2：我以「Edge Cases（边界）不是约束」为由删掉 `boundary` 判据，但旧判据只认英文 `boundary`（`## Scope Boundaries` = In Scope / Out of Scope，是约束），从未认过中文 `边界`——注释里的理由与实际删掉的判据不是同一件事，007/008/009 三份已映射 spec 的约束整段归零。另：constraints 根本没被 strategy 转进骨架（无消费方），sync.md 要求的「Constraints→范围边界」从未有过数据源。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`isConstraintsHeading`：约束 / constraint / 英文 boundary / 范围边界 / 能力边界 / 约束与边界 路由，边界条件 / 边界情况 / 边界场景 / Edge Cases 排除）；constraints 未进骨架记录 → 簇④。纪律 → 簇①：**改判据前先用语料证明「被删的分支到底匹配什么」，不能凭词义推断**。
- [结果准确性][引擎 · 「2 条冲突」是误抽，且语义反了] 第三轮角 B W-B1：157 的 L194/195 是 `**YAGNI-移除条件**：` 下的 `- FR-004（…）：… 标 [YAGNI-移除]` 决议行，被当成第二条 FR-004 → 冲突账说「157 重复编号」（假），移除决议被判 superseded 而被移除的需求仍 active（反）；158/187 的 `**FR-00N 验收信号**：…` 段落同型，一旦映射就多 13 条假冲突。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（同一 spec 内重复编号视为同一条需求的再次陈述：按出现顺序并入首条描述 + warning「N 个 FR 编号重复出现，已并入首条描述」；真实仓库冲突 2 → 0，157 FR-004 描述里可见 `[YAGNI-移除]`；handler 层对同 (spec, id) 仍一律追加、冲突解决器按身份跳过 winner——防御面用 executeMerge 直接单测）。
- [结果准确性][引擎 · 行首注解剥除过宽] 第三轮角 B W-B2：`FR_LEADING_ANNOT` 把编号后任意括号 / 方括号 / 反引号组都当强度注解剥掉，98 处实质短标题被吞（46 处在已映射 spec）：`（离线重判）`、`（monorepo nearest-config 选择规则，C-3 修复）`、`[Story 1, 3]` 溯源标签、`\`[Non-goal]\`` 语义反转标记——而且我的形态测试把这个行为**正向锁死**了。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（只剥纯强度标记 `[必须]` / `\`[可选]\`` / `（MUST · [必须]）` / `[MUST NOT]`，其余保留为描述前缀；形态测试 E/K 期望改为保留括号短标题）。纪律 → 簇①：**测试锁住的行为要先问「这是需求还是实现巧合」**。
- [结果准确性][引擎 · 写回 / 解析的手写形态损失] 第三轮角 B W-B4/W-B5：mapping 里不带引号的 `- 002` 被 YAML 读成数字后整条丢弃（读路径就丢，写回固化）；带 BOM 的文件整份解析成空映射（所有 spec 判未映射）；注释头正则不认 BOM 与 `---` 文档分隔符；CRLF 文件写回成混合行尾；写回仍丢 `name` / `owner` / 行内注释 / 顶层非 products 键（只在触发写入的那次）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：前四条已修复（数字条目补零成编号；解析前剥 BOM；注释头认 BOM / `---`；行尾跟随原文件）；`name` / `owner` / 行内注释 / 顶层键的丢失记录 → 簇④（写回改 in-place 补丁或改掉「可手动编辑」自述；`mergeUnmappedSpecs` 已导出但引擎从不调用，34 份未映射只能靠 agent 手写）。
- [信息完整性][sync 契约 · agent prompt 与引擎裁决相反] 第三轮角 B W-B6：`agents/sync.md` 的「最新优先（冲突时编号更大的 spec 优先）」与引擎「跨 spec 同号各自保留」相反，`conflicts[].subject` 新格式也未写明。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（sync.md 约束改为 FR 身份 = (来源 spec, 编号) 的新口径）。
- [结果准确性][引擎 · 三套 parseProductMapping + 编号口径不对称 + 同编号多目录] 第三轮角 B W-B7/W-B8：`sync-product-mapping` / `product-governance-helpers` / `generate-product-entity-catalog` 各有一份同名解析器，编号口径互不相同（catalog 只吃对象形态，真实文件是字符串形态 → `specCount: 0` 一直是假数）；mapping 侧此前缺「编号后须为 `-` 或结束」守卫（`"1234-foo"` → `123`）；同编号多目录（112×3 等）只靠「只有一个有 spec.md」侥幸不撞。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：口径守卫与同编号多目录 warning 已修复；三套解析器收敛记录 → 簇④（立卡：统一到 `sync-product-mapping.mjs`，catalog 的 `specCount: 0` 假数随之修）。

### publish-gap 第二角（误伤 / 假红）· 2026-09-14
状态：已处理（7 条：6 已修复 / 1 记录）
来源：簇③ publish-gap 自证的第二角异构审查（第一角 fail-open 已在前一节流转）

- [结果准确性][门禁文案 · 假的排除断言] 我在第一轮为了「两种病因两种药方」的对称性**推出**了「fetch-depth: 0 对 tarball 锚点根因无效」，并用 (c11) 把它锁死。审查者用 `--depth 1` 克隆端到端复现：tarball 里的 commit 就是普通仓库提交，浅克隆下同样不可达，`git fetch --unshallow` 后即 resolved——门禁会主动把最常见根因的解药删掉。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（文案 + (c11) 断言反转）；纪律 → 簇①：**排除性断言（「X 对此无效」）必须端到端实测，不得由分类对称性推出**。
- [结果准确性][包名白名单误伤 + 文案说假话] 强制小写拒绝 `JSONStream` 类合法老包名，且复用「读不到 package.json 的 name」文案；白名单卡在 `npm view` 之前，整条判据在这类仓库上永久 indeterminate。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（放开大小写；`package-name-invalid` 与 `package-name-unreadable` 分开）。
- [结果准确性][bare catch 归因] tar 缺失（distroless）/ 超时 / 包损坏全被归成「该版本发布于盖章之前」，运维读到「无事可做」而判据静默哑火。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（`TarballReadError` → `tarball-read-failed`；`Not found in archive` 才是 `missing-build-meta`）。
- [信息完整性][生产实现零覆盖] 40 例单测一律注入替身，`defaultExecNpmPackMeta` 从未执行；两个安全方向的变异体存活，其中「临时目录改成 `process.cwd()`」那个若真执行会 `rmSync(cwd)`——**「变异体安全存活」恰恰证明这段代码在测试里一次都没跑过**。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（PATH 上的 npm shim 离线覆盖生产实现：cwd / argv / env 剥 dry-run / 唯一 tgz 枚举 / name-version 回验 / scoped filename）。
- [结果准确性][空 cwd 绕过项目级 `.npmrc`] 私有源仓库上 tarball 回退要么 E404 假红、要么拉到公网同名包；而这道防线收益≈0（精确 semver + 白名单 + 回验已挡住本地打包）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（cwd = 项目根；本仓根实测 `npm pack spectra-cli@4.5.0` 拉到 6d4e8188 而非本地 dist 的 6fd45f76）。
- [信息完整性][四条 INFO] npm 8 对 scoped 包报带 `/` 的 filename（改枚举唯一 tgz）；`+build` 放行但回验必败（入口拒绝）；registry `gitHead` 不校验 40-hex 而 tarball 侧校验（非 sha 视同缺席）；F265 spec / tasks 的 `missing-git-head` 契约已被实现反证（加换代注）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复。
- [流程顺畅度][审查方法 · vitest alias] 审查者在「变异体跑既有测试但不改仓库文件」时踩到：vitest 3 的 `resolve.alias` 用 RegExp + `process.env` 取 replacement 静默不生效，须字面 specifier + 内联绝对路径 + 自带 config（顺带跳过 globalSetup，单文件 0.9s）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：记录（方法论进 memory）。

### 4.6.0 perf 基线重跑（3 target，安静窗口）· 2026-09-14
状态：已处理（1 条：接受为新基线并归因；2 项改进候选 → M11）
来源：M10 §13.2 收官挂起项「4.6.0 发布后重跑基线」；`npm run baseline:collect -- --targets karpathy/micrograd,karpathy/nanoGPT,self-dogfood --mode full`，无并发负载；旧 fixture 为 4.3.0（2026-07-20，`709777d2`）

- [结果准确性][spectra batch · 同模块数下 LLM 用量翻倍] `baseline:diff` 三档全 red：micrograd 墙钟 +20%（145.7s→175.3s）、输入+输出 token +128%（168k→385k）、估算成本 +130%；nanoGPT 墙钟 +121%（14.4→31.9 min）、token +154%、成本 +142%；self-dogfood 墙钟 +89%（29.9→56.7 min）、token +109%、节点 +38%（5748→7928，仓库自身变大，不可比）。**关键归因事实**（micrograd，同 5 个文件 / 37 节点 / 4 次 LLM 调用两版完全相同）：每次调用输入 token 157k→358k（×2.3）、输出 11k→27k（×2.4）、单次调用 p50 79s→138s、平均 spec 行数 182→270——不是多打了 LLM，是**每次调用的 prompt 与产出都长了一倍多**（4.3.0→4.6.0 之间的 callSites / 方法调用边 / lineRange 等上下文扩张与 spec 模板增长是候选，未定位到具体 commit）。`tokensCacheRead` 仍为 null，无法区分缓存命中。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：**归因已定，接受为 4.6.0 基线入库**。归因实验：一次只回「ok」的 `claude --print --output-format stream-json` 今天的 usage = input 3 + cache_creation 40,747 + cache_read 26,085 ≈ **67k / 次**（Claude Code 2.1.270 的系统提示 + 内建工具 schema + 用户级 MCP），而 `src/core/llm-client.ts`（Fix 134）把三项相加记作 input——4.6.0 micrograd 各模块 input 为 setup.py 70.3k / __init__ 70.4k / nn 71.9k / engine 145.8k，即 **每次调用 ≈ 67k 固定开销 + 3~5k 自身 prompt，engine 那次带了一轮工具迭代（cache_read 计两次）**。翻倍来自 Claude Code 无头调用的 harness 开销自 7 月以来增长，与 spectra 自身 prompt 无关（4.3.0 tarball 对照因 `web-tree-sitter/tree-sitter.wasm` 打包缺失无法运行，未能二分，但上述测量已足够）。墙钟增长（单次调用 p50 79s→138s）与之同源。改进候选 → M11：(a) collector 与 batch-summary 把 cache_creation / cache_read 单列并按各自单价估算成本（现在把缓存读当作全价输入，成本估算虚高约 5×）；(b) `cli-proxy` 的 spec 生成调用不需要工具与 MCP，加 `--max-turns 1` / 禁工具 / `--strict-mcp-config` 可砍掉约 60k/次的固定开销与一轮迭代。

### feature-180 LLM e2e 首次真跑 · 2026-09-14
状态：已处理（2 条：2 已修复，产品侧观察已分流）
来源：`HAS_LLM_E2E=1` 安静窗口复跑 T-010-1/2/4/5（SDK 请求超时补齐后首次真正执行）

- [结果准确性][batch MCP · 两次 LLM full batch 不可能逐字节相同] T-010-4/5 的断言前提不成立：同一 tempRoot 上第二次 full batch 的输入包含第一次写出的 `specs/modules/*.spec.md`（`graph.inputHash` 必变），且 LLM 重生的 spec 文本让 `specs/nn.spec.md → engine.py` 这类 INFERRED `references` 边出现 / 消失。**这两条自 F180 立项起从未跑通过（60s SDK 默认超时），前提从未被检验**；写盘侧 byte-stable（F179）由 `graph-builder-bytestable` 单测与 feature-175 场景10 守护，与「跨 LLM 运行」是两件事。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（T-010-4 改断言代码派生子图跨运行 deepEqual；T-010-5 钉住差异边界只限 inputHash 与 spec 派生 INFERRED 边）。产品侧观察（记录 → M11 簇④/簇⑦候选）：full batch 的图是否含 spec→代码引用边取决于跑批前 specs 是否已存在，同一命令两次结果结构不同，值得让 batch 在建图前统一读取本次生成的 spec（或明确声明图只含代码派生边）。
- [流程顺畅度][batch MCP · 请求预算] T-010-1（incremental）170s 超时而 T-010-2（full）128s 通过；batch 不发 progress 通知，`resetTimeoutOnProgress` 无用。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（单次 batch 统一 300s 绝对预算，it 330s / 720s）；安静窗口复跑 **5/5 通过**（T-010-1 146s / T-010-2 125s / T-010-4 237s / T-010-5 264s，共 12.9 分钟）——该文件自 F180 立项以来首次全绿。

### sync 收尾 · 确定性 helper 链 · 2026-09-14
状态：待处理（2 条）
来源：`spec-driver-sync` 第 4 步六个 helper 在补聚合后的活文档上实跑（角 B 审查顺带发现 + 主线程复核）

- [结果准确性][generator 与已入库 artifact 漂移] `generate-product-entity-catalog.mjs` 当前版本不产出 `qualityReportPath` / `scorecardStatus` / `scorecardScore`（HEAD 的脚本里根本没有这些字段），而已入库的 `catalog-index.yaml` / `entity.yaml` 有——它们是更早一版 generator 的产物；重跑即"字段脱落"，且 `warnings: []`。同时 catalog 自带的 mapping 解析器只吃对象形态条目，真实文件是字符串形态，`specCount: 0` 一直是假数。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：本轮按 helper 当前实现重生成并入库（入库产物应反映当前 generator，而不是保留旧版字段假装仍在产出）；两处漂移 → M11 簇④（三套 `parseProductMapping` 收敛后 `specCount` 自然修；「上轮 artifact 有、本轮产不出」的字段应发 warning）。
- [流程顺畅度][sync 引擎与 helper 链的分母不可见] `--dry-run --json` 的 `validation.allPassed` 此前恒 true，`warnings` 是唯一诚实通道；消费方拿不到「本次抽取覆盖的 spec 数 / 零 FR 贡献的 spec 数」这类可核对分母（角 A 审查工具反馈）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：本轮已在 warnings 里补零 FR / 之外条目 / 重复编号三类提示，`fr-count` 改守恒；输出层加显式分母字段 → 簇④。

### publish-gap 第三轮 delta（修法本身）· 2026-09-14
状态：已处理（6 条：4 已修复 / 2 记录）
来源：簇③ 二轮修法的 delta 审查（双向：假绿 / 假红），11 例恶意输入零抛出零假绿，cwd 声称三种攻法未打穿

- [结果准确性][门禁 · 0 字节 tarball 被判「未盖章」] bsdtar 对空档案与「成员不存在」的 stderr 逐字相同（`Not found in archive`），只看 stderr 会把下载中断 / 磁盘满判成 `missing-build-meta`；重复成员被 `tar -xO` 拼接成非 JSON 也落同一桶。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（先看文件大小；非 JSON 归 `tarball-read-failed`；真实 tar 0 字节 / 重复成员两例）。
- [结果准确性][门禁 · 两条事实源 cwd 不一致] `npm pack` 钉到项目根而 `npm view` 仍用进程 cwd：`--project-root` 与 cwd 不同时 view 打 A 源、pack 打 B 源，name/version 回验抓不到混源。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（view 同样以项目根为 cwd；不注入替身的全默认链路用 npm shim 断言两次调用 cwd 相同）。
- [信息完整性][门禁 · 合取守卫单侧无测试] pack 回验砍掉包名半边 49 例全绿（F270「谓词不对称」形态再现）。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（包名错配 shim 用例；变异复核红）。
- [信息完整性][门禁 · 字面断言锁不住语义] (c11) 用「不含『无效』」钉上一版 bug 的措辞，换个说法重新写进假排除断言测试抓不到。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：记录（用例注释写明残余空间；排除性文案的守护只能靠审查，不能靠字面断言）。
- [信息完整性][门禁 · 死代码与内部文案] `execFileSync` 走 spawnSync 从不设 `killed`（超时只在 `signal`）；ENOBUFS 被报成「超时」。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：已修复（删 `killed`；信号分支文案改为「被 <signal> 终止（超时或输出超过缓冲区）」）。变异复核：删掉信号分支 53 例全绿——超时会落到通用「解压失败」分支，对外 reason 同为 `tarball-read-failed`，属等价变异（只差内部文案），如实登记而非记作守护。
- [信息完整性][门禁 · 不变量靠调用点巧合] `checks/warnings` 不变量成立，但「不得抛出」只是每个外部调用恰好都在 try 里，消费方裸调。
  ↳ **处置（2026-09-14 /goal 落地，主线程代用户判断·可翻案）**：记录进模块头注释 + 畸形输入不抛属性测试（8 例）；结构性 try/catch 兜底未加（加了无法被变异证实，属「声称有守护」）。

### M11 第一批五卡（A/B/C/D/E）· 2026-09-15
状态：待处理（9 条）
来源：五卡实现 + 四路异构对抗（卡 B 两角 / 卡 C 两角）+ 卡 D / 卡 E 两轮 delta 审查；`/goal` 落地

- [结果准确性][sync 引擎 · 缺与上一版的对拍] `--dry-run` 输出有 `totalConflicts` 这种强信号却没有基线机制，卡 C 的 C-1（49 条虚假冲突）靠审查者手工 `git archive HEAD` 双跑才暴露。建议引擎增 `--baseline <old.json>` 或 `repo:check` 钉 stats 快照（与 F249「数字产物必配重算器」同源）。
- [流程顺畅度][sync 引擎 · 同编号多目录三套 tie-break] HEAD 引擎取 readdir 末个、`indexSpecDirectories` 取字典序首个、`parsedSpecs` 取遍历末个。本轮已统一为字典序首个并升 `duplicate-dirs` lint finding；「同编号唯一性」是否应阻断而非告警待拍板。
- [信息完整性][对拍基准须与被对拍路径同源] `--preflight` 被设计成注入子代理 prompt 的对拍基准，却与 Phase 5 不同源（54 vs 56），每次 sync 必产一条假风险项。本轮已同源；原则性教训：凡给另一个代理当对拍基准的数字，取数路径必须与被对拍者相同。
- [信息完整性][orchestrator-cli · get-phases 无 diagnostics] 程序化消费方只读 stdout 看不出 override 被拒。本轮已加 `diagnostics` 字段。
- [流程顺畅度][全局 · 多卡共享工作树时 global-setup 一损俱损] `tests/global-setup.ts` 按 dist 输入指纹重建，另一卡改一行 src 让所有卡的 vitest 卡在同一个 build 失败上（卡 C 审查期间 `graph-builder.ts` TS2339 令 integration project 无法启动）。与「global-setup 跨 worktree 假新鲜」同族的另一面（同 worktree 多会话）。
- [结果准确性][fix-compliance · 改判定器自身的卡结构性失明] 卡 B 有实现 / 测试 / 承重注释却无 `specs/NNN-*` 制品（本轮补 `specs/296-*`），门禁对「改门禁自己」的形态不阻断。建议 milestone-next 把「改判定器自身的卡必须先有制品」列显式前置。
- [信息完整性][Spectra MCP · 缺「变量的所有赋值点 + 各自守卫条件」形状的查询] 卡 B 审查者要追 `resolvedPath` 三条来源只能 `grep` + 读 200 行注释；`context` / `impact` 回答不了「哪条分支让它落回 null」。
- [结果准确性][Spectra MCP · 未提交 diff 不可审 / 图在脏树上建] 卡 D / 卡 E 审查者都因工作树脏、图必然 stale 而放弃调 MCP。卡 D 已让 freshness 标 `builtFromDirtyTree`、`repo:sync` 脏树 skip；「审查未提交改动」这一使用场景仍无工具面。
- [方法学][「改动前 / 后」类结论一律要求同一棵树只换受审文件] 卡 B 审查者纸面读码时把一条残余误判为新回归，受控 A/B（`git show HEAD:` 旧文件替换进同一棵树）才纠正；与 F259「图基线用陈旧 dist 建会造假回归信号」同源。
