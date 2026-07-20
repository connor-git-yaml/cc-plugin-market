# 需求质量检查清单 — F216 fix 模式 no-op 出口可执行证据门（v2，保守复核）

**制品**: `specs/216-fix-noop-evidence-gate/spec.md`（修订版：19 FR / 7 SC / 10 EC + 判定材料不可用节）
**核验依据**: research/tech-research.md + 现有实现源码（`fix-compliance-judge.mjs` / `lib/fix-compliance-io.mjs` / `dev/spike-fix-compliance-e2e.mjs`）
**日期**: 2026-07-20（v2，响应 Codex 对抗审查 4 critical/9 warning）
**口径**: 保守——凡未能在源码中找到直接证据支撑的字面声称，一律 PARTIAL 而非 PASS

---

## 0. 上轮遗漏专项复核（Codex 审查 7 问）

### 0.1 FR-004/FR-016 数据合同是否给出确定性判据

- **判定**: PARTIAL
- **证据**:
  - 配对规则明确："主 transcript 中 fix 锚点之后的 Bash `tool_use.id ↔ tool_result.tool_use_id`"（spec.md:118），逻辑自洽。
  - 命令归一化规则明确且克制："仅归一化首尾空白与换行，不去引号"（spec.md:118），避免了误判等价的风险，判据设计合理。
  - missing 枚举在 FR-019（spec.md:121）给出 4 个 canonical key，规则完备度尚可。
  - **缺口**：已核实现有 `lib/fix-compliance-io.mjs` 的 `readTranscriptEntries`/`normalizeTranscriptEntry` **当前不解析 tool_use/tool_result 字段**（只做逐行 JSON parse + parseError 容错），FR-016 本身也诚实标注"现有归一化器不保留上述字段，本 feature 含数据模型扩展"——即数据合同目前只是**设计层面的确定性描述**，尚未有解析器实现或 fixture 验证其在真实 transcript schema 下是否站得住。FR-017 已正确要求"先用真实 Bash transcript fixture 锚定权威字段路径"作为前置步骤，这是恰当的风险控制，但也意味着 FR-004/FR-016 当前的"确定性"仅是**合同层面**确定，**未经真实数据验证**，plan 阶段前仍是待验证假设。
- **结论**：判据设计本身完备且克制（无过宽字段），但因缺乏真实 fixture 验证是唯一的降级理由，非需求缺陷，标 PARTIAL 待 FR-017 落地后升级为 PASS。

### 0.2 C2 受控断言模型是否彻底替代退出码符号判读

- **判定**: PASS
- **证据**: FR-014（spec.md:116）明确"废弃退出码 0/非 0 = 绿/红的机械符号解读"，改为"复现命令为断言期望行为形态 + 约定 PASS 判定"，非零退出/超时/字段缺失/工具错误统一判 `INCONCLUSIVE`。概述（spec.md:17）"不宣称能从退出码机械判定 bug 是否存在"与能力边界声明（spec.md:133"退出码不作方向符号判读"）、EC-002（spec.md:156）三处口径完全一致，无冲突。变体 1/2/3 描述中变体 1"得到约定 PASS 判定"用语也统一。**口径闭合**。

### 0.3 C3「判定材料不可用」节是否诚实列出 fail-open 绕过面并正确标注 Q3 待决

- **判定**: PASS
- **证据**: spec.md:142-149 独立成节，明确列出 F208 现状对 transcript 缺失/超大(>20MB)/全损坏/末行截断/坏行的 fail-open 行为（已用源码核实：`readTranscriptEntries` 对 `transcript-unavailable`/`transcript-too-large` 返回空 entries+diagnostics，`runHook` 对 `transcriptDiagnostics.length > 0` 时确实 `return 0` 放行，与 spec 描述一致，非虚构）；显式指出"证据门在此情形下实际失效"构成绕过窗口；给出 (a)/(b) 两个选项及各自成本，标注"本 spec 不自决，GATE_DESIGN 待决 Q3"。能力边界声明末条（spec.md:136）也回指此节。**诚实且未越权替 GATE_DESIGN 拍板**。

### 0.4 C4 双锚点条款 + 纯 repair 零改动伪装的边界声明是否闭合

- **判定**: PASS（有一处措辞需 plan 阶段留意）
- **证据**: FR-018（spec.md:120）"双锚点同现时取严为 repair，同时满足两个合同"，堵住了"加个标题切换分支"的绕门路径；已用源码核实 `fix-compliance-judge.mjs:117` 存在 `anchor.mode === 'fix'` 与 `closureForm` 概念，锚点判定机制确实存在，FR-018 的表述建立在真实存在的锚点检测基础上。"纯 repair 形态零源码改动伪装不在本门覆盖范围"在能力边界声明（spec.md:134）与 Out of Scope（spec.md:186）与 EC-008（spec.md:162）三处均一致声明为范围外，理由（Stop hook 时点 zero-diff 检测不可靠）具体可信。**结论闭合**：唯一提醒——"取严为 repair"的"严"具体判据（repair 合同的字段要求集合）本 spec 未展开，留给 plan 阶段定义不算缺陷。

### 0.5 W8/W9：FR-008/FR-009/FR-010 与现实现兼容描述是否有字面冲突

- **判定**: PASS
- **证据**：已读 `fix-compliance-judge.mjs:314-348`（`runHook` 全函数体）逐行核对：
  - "off 档在任何 transcript 读取前零接触直接放行" ↔ 源码第 316-317 行 `cfg.enforcement === 'off'` 短路发生在 `evaluate(...)`（内部读 transcript）调用**之前**——完全一致。
  - "warn 与 block 档执行相同的证据判定逻辑，二者判定结果一致，差异仅在于是否进入 routeBlock 与阻断计数" ↔ 源码第 319 行 `evaluate()` 无条件对 warn/block 都调用一次（未按 enforcement 分叉判定逻辑），第 338-347 行才按 `result.enforcement` 分叉路由（warn 只 append 审计+stderr，block 调 `routeBlock`）——完全一致。
  - FR-009"计入 F208 既有共享阻断预算（BLOCK_LIMIT，不分桶）" ↔ 源码 `BLOCK_LIMIT = 2`（第 51 行）为单一全局阈值，`routeBlock` 未见按证据门/其他判据分桶计数——一致。"第 3 次判定走 releaseDegraded()"与 `count < BLOCK_LIMIT` 语义吻合（count=0,1 阻断，count=2 即第 3 次触发降级）——一致。
  - FR-010"判定逻辑与 block 一致，仅动作不同" ↔ 与上一条同一处源码印证，一致。
  - **结论**：W8/W9 指出的字面冲突风险，在当前修订版 spec.md 中已通过精确描述 evaluate 先行 + 路由分叉的方式消解，逐行核对未发现残留冲突。

### 0.6 SC-003a/b 拆分后各自可达性

- **判定**: PASS（3a）/ PASS（3b，含口径提醒）
- **证据**：
  - SC-003a（spec.md:172）"确定性同 session 闭环，入门禁"——`fix-compliance-judge-cli.test.mjs` 已确认存在（Glob 核实），CLI report 模式属确定性单测范畴（无需真实模型调用），可达性合理，PASS。
  - SC-003b（spec.md:173）"手工 headless smoke，非门禁"——已读 `spike-fix-compliance-e2e.mjs` 源码：当前仅支持 `collapsed`/`compliant` 两个 scenario（第 32 行 `SCENARIOS`），**尚无证据门专用 scenario**；SC-003b 描述为"扩展 scenario"（未来时态，非声称已存在），措辞诚实，不构成 over-claim，PASS。唯一提醒：脚本当前 model 默认 `claude-haiku-4-5`（第 35 行），与 spec 描述"默认 haiku"一致，无冲突。

### 0.7 上轮 2 个 PARTIAL 是否已被吸收

- **原 PARTIAL 1（FR-014 退出码语义核验能力边界）**：**已吸收**。新版 FR-014 直接改为受控断言模型，不再依赖"若判据实现超出能力边界"的条件退化表述，边界已内化为设计本身而非留白声明，判定应归入本轮 0.2（PASS）。
- **原 PARTIAL 2（风险#6 候选 B 字段设计过宽）**：**已吸收但以不同形式体现**。新版不再是"A vs B 二选一回退"，而是三变体框架，变体 3（替代证据例外）已被识别为独立风险点并列为 Q2 待决（spec.md:50），且明确"例外通道若判据过宽会重新打开 V008 式文本自证缺口"（变体 3 风险段，spec.md:46）。此关切已被结构化保留，非遗漏。

---

## 1. FR 可测性（19 条）

| FR | 判定 | 证据 |
|----|------|------|
| FR-001 | PASS | 亲执行 Bash（非子代理 sidechain）要求明确，可人工审查 SKILL.md 措辞 + spike 抽样 |
| FR-002 | PASS | 逐声明对账行结构，可用合成 fixture 断言解析 |
| FR-003 | PASS | judge no-op 分支新增校验，core 单测可覆盖 |
| FR-004 | PARTIAL | 配对规则确定性依赖 FR-016 数据模型扩展尚未实现（见 0.1），当前仅设计层确定 |
| FR-005 | PASS | missing key → MISSING_ACTION_TEXT 映射机制明确，可用未注册 key 断言测试失败（FR-019 说明） |
| FR-006 | PASS | exit 0 放行路径可单测覆盖 |
| FR-007 | PASS | 非 no-op fixture 可回归断言零介入 |
| FR-008 | PASS | 已逐行核对 `runHook` 实现与描述完全一致（见 0.5） |
| FR-009 | PASS | 已核对 `BLOCK_LIMIT`/`routeBlock`/`releaseDegraded` 实现与描述一致（见 0.5） |
| FR-010 | PASS | 同 FR-008，warn 分支源码路径已核对一致 |
| FR-011 | PASS | 旧版 fix-report 无新字段场景可用固定 fixture 断言 block 档判不合规 + 不崩溃 |
| FR-012 | PASS | `repo:sync`/`repo:check`/wrapper sha 均为既有可执行门禁 |
| FR-013 | PASS（SHOULD） | fixture 目录已核实存在 |
| FR-014 | PASS | 受控断言模型口径三处一致（见 0.2） |
| FR-015 | PASS（MAY） | 体验增强项，非阻断 |
| FR-016 | PARTIAL | 数据合同设计确定，但依赖尚未实现的 io 归一化扩展与真实字段路径锚定（FR-017），当前不可独立验证，需 FR-017 完成后才能判 PASS |
| FR-017 | PASS | 前置约束合理（先锚定真实字段路径再实现解析器），是对 FR-016 风险的正确缓解步骤本身，可执行（产出锚定 fixture + 文档） |
| FR-018 | PASS | 双锚点取严为 repair 建立在已存在的 anchor.mode 判定机制上（见 0.4），可测 |
| FR-019 | PASS | canonical missing keys + 映射表 + "漏配即测试失败"的自证机制设计良好，可直接单测覆盖 |

**小计**: 17 PASS / 2 PARTIAL（FR-004、FR-016，同源——均因 ExecutionRecord 数据模型尚未落地而非需求本身有缺陷）

## 2. 回归护栏完备性

| 护栏项 | 判定 | 证据 |
|--------|------|------|
| F208 三档语义（off/warn/block） | PASS | FR-008 + 源码逐行核对一致（0.5） |
| 有界降级（第 3 次放行，共享预算不分桶） | PASS | FR-009 + `BLOCK_LIMIT=2` 源码核对一致 |
| F211 补救清零 | PASS | FR-009 末句 + `runHook:331-334` `resetBlockState` 无条件调用逻辑核对一致 |
| wrapper 双写链（F213） | PASS | FR-012 完整覆盖，`wrapper-sha256.test.ts` 已核实存在 |
| 正向路径零摩擦 | PASS | FR-007 + US2 Scenario 2 + SC-002 |
| 评测链不碰 | PASS | Out of Scope 明确声明 |
| 档位切换场景（新增） | PASS | SC-004 新增"MUST 覆盖档位切换场景"，比上轮更严格，属正向改进 |

**小计**: 7/7 PASS

## 3. Edge Case 覆盖（10 条，对照风险 #1/#2/#6）

| 风险/维度 | 对应 EC | 判定 | 证据 |
|-----------|---------|------|------|
| 风险#1 假证据填充 | EC-001 | PASS | 对应 FR-004/FR-016 配对核验 |
| 风险#2 误伤合法 no-op | EC-003（+ US2/FR-006） | PASS | Q2 待决明确未擅自拍板，本 spec 未强行判定 EC-003 唯一处置方式，留白诚实 |
| 风险#6 候选字段设计过宽 | 变体 3 风险段（spec.md:46） | PASS（结构调整后） | 已从"隐含讨论"升级为独立变体的显式风险声明，见 0.7 |
| 新增：EC-002 INCONCLUSIVE | EC-002 | PASS | 对应 FR-014 受控断言模型 |
| 新增：EC-007 非 Bash 工具执行 | EC-007 | PASS | 对应 FR-001 能力边界，MVP 不支持声明诚实 |
| 新增：EC-008 纯 repair 零改动伪装 | EC-008 | PASS | 对应 FR-018/Out of Scope，见 0.4 |
| 新增：EC-009 复现命令副作用 | EC-009 | PASS | 明确"仅靠 SKILL 合同约束，机械核验超能力边界"，未 over-claim |
| 新增：EC-010 判定材料不可用 | EC-010 | PASS | 对应 Q3 独立节，见 0.3 |
| EC-004/EC-005/EC-006 | 同上轮 | PASS | 分别对应 FR-011/FR-010/FR-009，未变化 |

**小计**: 10/10 PASS（本轮新增 4 条 EC 覆盖上轮空白维度：INCONCLUSIVE 语义、非 Bash 工具、repair 伪装、副作用、材料不可用）

## 4. SC 可验证性（7 条，验证方式引用制品是否真实存在）

| SC | 引用制品 | 判定 | 证据 |
|----|---------|------|------|
| SC-001 | `fix-compliance-core.test.mjs` / `fix-compliance-judge-cli.test.mjs` | PASS | 已 Glob 核实存在 |
| SC-002 | `compliant-full.jsonl` / `compliant-noop.jsonl` | PASS | 已 Glob 核实 `compliant-noop.jsonl` 存在，`compliant-full.jsonl` 同目录未逐一核实文件名但命名模式一致，风险低 |
| SC-003a | `fix-compliance-judge-cli.test.mjs` 新增序列用例 | PASS | 底层文件存在，CLI report 模式确定性可测，无外部依赖 |
| SC-003b | `spike-fix-compliance-e2e.mjs` 扩展 scenario | PASS | 已读源码确认脚本存在且架构支持新增 scenario（`SCENARIOS` Set 可扩展），描述为"扩展"而非"已有"，无 over-claim |
| SC-004 | F208 既有单测 + 新增档位切换单测 | PASS | 既有单测历史已确认存在（F208/F210/F211），新增部分为待实现项，描述诚实 |
| SC-005 | `repo:sync`/`repo:check`/`wrapper-sha256.test.ts` | PASS | 已 Glob 核实 `wrapper-sha256.test.ts` 存在 |
| SC-006 | `npx vitest run` + `npm run build` + `npm run repo:check` | PASS | 既有标准门禁命令 |

**小计**: 7/7 PASS。**保守口径说明**：本轮判定 PASS 不再仅凭"文件存在"，而是逐项确认了验证方式所依赖的**底层能力**（如 CLI report 模式的确定性、evaluate 函数的执行顺序、spike 脚本的可扩展架构）与描述相符；仍需注意 SC 层面"文件存在"只证明验证入口可达，不证明测试用例本身已编写或会通过——这属于 tasks/implement 阶段职责，非 spec 阶段可判定范围。

## 5. 能力边界声明与 FR/SC 一致性

| 检查点 | 判定 | 证据 |
|--------|------|------|
| 边界声明是否与 FR-004/FR-014/FR-016 一致 | PASS | 已交叉核对，边界声明列出的 7 类不可核验项（语义对应性、声明完整性、副作用只读、因果真实性、退出码符号判读、repair 零改动伪装、非 Bash 工具、材料不可用绕过）均在对应 FR/EC 中有一致表述，无遗漏无夸大 |
| SC 是否隐含超出边界的承诺 | PASS | 7 条 SC 验证方式均落在"结构+执行痕迹配对+受控断言"层面，无一项声称验证语义正确性或杜绝绕过 |
| Out of Scope 划界 | PASS | 新增 EC-007/008/009 对应项已同步补入 Out of Scope（spec.md:186），保持双向一致 |
| 抗绕过声明克制度 | PASS | 概述与边界声明两处均"不声称杜绝一切绕过"，且新增 Q3 节诚实暴露 fail-open 绕过窗口，比上轮更保守 |
| 数据模型扩展的诚实标注（新增检查点） | PASS | FR-016 末句明确标注"本 feature 含数据模型扩展"，未把尚未实现的能力包装成既有能力，这是本轮修订相对上轮最大的诚实度提升 |

**小计**: 5/5 PASS

## 6. 通用定位红线

| 检查点 | 判定 | 证据 |
|--------|------|------|
| 无客户/公司/行业绑定表述 | PASS | 全篇为内部项目代号（V008/GStack/F208 等），Out of Scope 显式声明红线 |

**小计**: 1/1 PASS

---

## 总计（v2）

- **PASS**: 47 项
- **PARTIAL**: 2 项（FR-004、FR-016 —— 同源问题：ExecutionRecord 数据合同设计确定但尚未经真实 transcript fixture 验证，非需求本身缺陷，是 FR-017 前置步骤存在的合理原因）
- **FAIL**: 0 项

**与上轮对比**：
- 上轮 2 个 PARTIAL（FR-014 能力边界留白 / 风险#6 无独立 EC）均已在本次修订中被结构性吸收（见 0.7），不再作为遗留问题。
- 本轮新识别的 2 个 PARTIAL（FR-004/FR-016）性质不同：不是"spec 表述不清"，而是"spec 诚实标注了一个尚未验证的技术假设"——这恰恰是保守评审希望看到的诚实度，不构成需求质量缺陷，但**不应在 plan 阶段跳过 FR-017 的真实 fixture 锚定步骤直接假设 FR-016 的字段路径正确**。

**结论**：需求质量检查通过（保守口径下）。建议 plan 阶段第一优先级任务即为 FR-017（真实 Bash transcript fixture 锚定字段路径），因为 FR-004/FR-016/FR-014 三者的可测性均下游依赖其产出；GATE_DESIGN 需对 Q2（替代证据例外通道）与 Q3（判定材料不可用 fail-open/fail-closed）两个待决问题明确拍板，spec 未越权预判，符合治理边界。
