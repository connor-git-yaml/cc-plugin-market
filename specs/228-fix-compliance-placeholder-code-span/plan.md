# 修复规划（F228）

## 概述

本修复采用 fix-report.md 的**方案 A（语义收口）**：在 `checkArtifactSection` 中把「长度判据」与「占位符判据」的输入来源分离——长度判据继续吃 `stripReconSubblock(body)` 的原文（逐字不变），占位符判据改吃「再剥离 fenced code 块 + 行内 code span」之后的派生文本。新增 `stripCodeRegions(text)` 承担这层剥离，复用 F216 C4 已有的 `computeFenceMask` 做 fence 语义，行内 code span 用一段新写的「反引号 run 长度精确配对」扫描逐行剥离。

不改 `checkArtifactSection` 的函数签名与返回结构，不放宽 `MIN_SECTION_BODY_CHARS`，不采用按占位符形态打补丁的方案 B。

## Codebase Reality Check

| 目标文件 | LOC | 相关方法数 | 已知 debt |
|---|---|---|---|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 约 900+（含 re-export 尾部） | 本次涉及 1 个既有函数 `checkArtifactSection` 改内部实现 + 新增 1 个纯函数 `stripCodeRegions`（含内部 helper `stripInlineCodeSpans`，不导出） | 无 TODO/FIXME；`checkArtifactSection` 本身 15 行，非超长函数；F216/F218/F224 已在同文件多次做过「fence-aware 收口」式修复，属于良性迭代模式，非债务 |
| `plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs` | 约 120+（读取范围内） | 不新增/不修改函数，仅复用其导出的 `computeFenceMask` | 无 debt；该文件是 F218 拆分产物，职责边界清晰（单向底层，core → execution-record 无回边） |

均不触发前置 cleanup 规则（无文件超 500 行 + 新增 >50 行、无 >3 处相关 TODO、无 30+ 行重复逻辑）。本次改动是在既有函数体内替换局部实现 + 新增一个约 30-40 行的纯函数，不需要前置清理 task。

## Impact Assessment

- **影响文件数**：1 个生产文件（`fix-compliance-core.mjs`）直接修改；1 个测试文件（`fix-compliance-core.test.mjs`）新增用例。间接受影响：0——已通过 Grep 核实 `PLACEHOLDER_BRACE_REGEX` 与 `checkArtifactSection` 在全仓的消费点（结果与 fix-report 影响范围扫描一致：`checkArtifactSection` 生产调用方仅 `judgeCompliance` 内的两支 no-op/repair 分支，函数签名与返回结构不变，两支无需改动）。Spectra MCP 对该 symbol 的 impact 查询返回 `symbol-not-found`（该 worktree 图谱未覆盖此文件/未建图），已按 fallback 规则退回 Grep 做双路核实，结论一致。
- **跨包影响**：无——改动完全在 `plugins/spec-driver/` 内部，不涉及 `src/`、`scripts/` 顶层边界。
- **数据迁移**：无——不涉及 schema、配置格式、状态文件格式变更。
- **API/契约变更**：无——`checkArtifactSection` 签名 `(content, requiredHeading) => { nonEmpty, hasRequiredSection, placeholderResidue }` 不变；`missing` 枚举不变；`contracts/fix-compliance-judge-cli.md` 的 canonical 文案不变。
- **风险等级：LOW**（影响文件 < 10，无跨包影响，无数据迁移，无公共 API 契约变更）。按规则不要求强制分阶段，采用单阶段实现 + 单批验证。

## 变更清单

### 1. `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`

- 新增内部 helper `stripInlineCodeSpans(line)`（不导出，单文件内使用）：对单行文本做「反引号 run 长度精确配对」扫描剥离行内 code span。
- 新增导出函数 `stripCodeRegions(text)`：逐行应用 `computeFenceMask`（fenced 行整行清空）+ `stripInlineCodeSpans`（非 fenced 行内联剥离），拼回多行文本。
- 修改 `checkArtifactSection`（L569-584）：
  - `bodyChars` 计算源**不变**，仍是 `stripReconSubblock(body)`（即 `proseBody`）。
  - 新增一步 `const placeholderScanText = stripCodeRegions(proseBody);`
  - `placeholderResidue` 的花括号判据改为对 `placeholderScanText` 测试（长度判据仍用 `bodyChars`，两者用 `||` 组合，逻辑结构不变）。
- JSDoc：为 `stripCodeRegions` 补充语义边界说明（fenced 块整体清空、行内 span 精确长度配对、未闭合反引号原样保留、不处理跨行 span、不处理缩进代码块），并在 `checkArtifactSection` 的 JSDoc 追加一句说明「长度判据与占位符判据输入来源不同」。

### 2. `plugins/spec-driver/tests/fix-compliance-core.test.mjs`

新增 `describe('F228 · stripCodeRegions / checkArtifactSection 代码区豁免（行内 code span + fenced code 不参与占位符扫描）')`，用例见下方「测试计划」。

不修改任何既有断言。

## 关键设计问题（按要求逐一回答）

### Q1：`stripCodeRegions` 放哪个文件？

**放 `fix-compliance-core.mjs`，紧邻 `stripReconSubblock`（L546 附近，`extractSectionBody` 之后、`checkArtifactSection` 之前）。**

理由：
- 该文件已有明确先例——`extractSectionBody`、`stripReconSubblock` 都是「`checkArtifactSection` 专属、单一消费点」的辅助函数，且都依赖 `execution-record.mjs` 的 `computeFenceMask` 这一共享原语，却仍然放在 core 而非下沉。`stripCodeRegions` 与它们同构：单一消费点（`checkArtifactSection`）、依赖同一个共享原语、职责是「章节正文的进一步清洗」。
- `execution-record.mjs` 顶部注释明确定义分区 A 是「被 core 留守函数与本模块证据门**共同**复用」的通用原语（如 `computeFenceMask`、`toSingleMatchProbe`）——判断标准是「是否跨多个消费者复用」，而不是「是否处理 markdown 语法」。`stripCodeRegions` 目前只有 `checkArtifactSection` 一个消费点，不满足下沉到分区 A 的判断标准；勉强下沉反而制造一个只有单一 import back 关系的假共享层，增加不必要的间接层。
- 若未来出现第二个消费点（例如某处也需要「剥离代码区再扫描」），届时再按「两个以上消费者」的实际触发条件下沉，符合本仓库「不预先builds平行抽象」的一贯约定。

### Q2：行内 code span 剥离算法与边界处理

**核心规则（CommonMark 简化版，逐行独立扫描）**：从左到右扫描一行，遇到反引号即读出连续反引号 run 的长度 N；从该 run 结束处继续向右找**长度恰好等于 N** 的下一个反引号 run（长度不符的 run 整体跳过，不消费）；找到即判定为一对 code span 定界符，把「起始 run + 中间内容 + 结束 run」整体替换为单个空格（不是删空，避免跨 span 文本被意外拼接出新的假匹配）；找不到则判定为未闭合，原样保留反引号字符，从 run 结束处继续扫描。

逐项边界处理：

| 情形 | 处理 | 理由 |
|---|---|---|
| 单反引号 `` `{x}` `` | 精确配对剥离 | 最常见形态，对应 fix-report 场景 A/R1 |
| 双反引号 ``` ``{x}`` ``` （允许内部含单个反引号） | 精确配对剥离 | 长度匹配用「run 长度」而非「是否含反引号字符」判断，天然支持 CommonMark「双反引号包单反引号」写法 |
| 4 个以上反引号 `` ````{x}```` `` | 同一算法处理，N=4 时只找长度恰为 4 的闭合 run，长度为 3 的内部反引号不误配 | 算法基于「run 长度精确相等」而非固定枚举 1-3 个反引号，天然覆盖任意长度 |
| 未闭合反引号（如 `` `{x} `` 后续再无反引号） | 反引号原样保留，不剥离；后续裸文本正常参与占位符扫描 | 保证「刻意用反引号伪装但未真正闭合」不会意外掩盖真实占位符；已在测试计划中显式覆盖 |
| 表格内反引号（`\| \`{x}\` \|`） | 与普通段落同等对待——算法按字符流扫描，不感知 `\|` | Markdown 表格单元格内的行内 code span 语法与段落内完全一致，无需特殊分支 |
| `~~~` 围栏 | 由 `computeFenceMask` 统一处理（该函数本就同时识别 `` ` `` 与 `~` 两种围栏字符），`stripCodeRegions` 对 fenced 行整行清空，不再对 fenced 行内容做行内 span 扫描 | 复用既有原语，避免重复实现围栏识别 |
| 跨行 code span（CommonMark 允许 code span 内容跨行，渲染时换行转空格） | **明确不支持**，逐行独立扫描，见下方 Q3 | 见 Q3 non-goal 论证 |

### Q3：缩进代码块（4 空格）与跨行 code span——显式 non-goal

**缩进代码块（4-space indented code block）明确不处理**，理由：

1. `computeFenceMask` 本身就不识别缩进代码块——它只认 ``` /~~~ 围栏。若 `stripCodeRegions` 单方面为缩进代码块加特殊分支，会造成「fence 识别」与「code-region 剥离」两套语义再次不一致，恰是本次修复要消灭的根因模式（Root Cause 原文：「两套语义各自为政无人对账」）。
2. 缩进代码块在 Markdown 列表续行场景下天然存在歧义——一个列表项下缩进 4 空格的续行文本，语法上既可能是"列表项延续"也可能是"缩进代码块"，没有额外的列表上下文追踪无法可靠区分。fix-report.md 模板结构里 `## 判定依据` / `Root Cause` 章节正文极少使用列表嵌套缩进代码块的写法，强行处理这一边界的收益远低于误剥的风险。
3. 方向性安全：不处理缩进代码块，最坏情况是「缩进代码块里的花括号仍参与散文扫描」，即退回今日行为（可能存在的误报不会比修复前更差）；而误剥进列表续行文本，则会把真实占位符藏进"看起来像缩进代码"的散文里，制造新的漏报（对占位符判据而言更危险的方向）。二者权衡下不处理是更安全的选择。

**跨行 code span 同理明确不支持**，理由：

1. 本文件所有既有 fence-aware 判据（`extractSectionBody`、`stripReconSubblock`、`classifyClosureForm`）全部是逐行处理模型，`stripCodeRegions` 沿用同一模型是架构一致性要求，不引入新的"多行缓冲"处理路径。
2. fix-report.md 必填章节正文是简短诊断散文，实践中行内 code span 几乎总是单行内闭合（如 `resolveFeatureDirCandidate 返回 \`{path, ambiguous}\``）；跨行行内 code span 极其罕见，且本身是较差的写作习惯。
3 方向性安全：不处理跨行 span，最坏情况是"跨行 span 内的花括号仍被判为裸散文" → 可能残留极小概率的误报（并非本次要消灭的主要复现场景，且用户验收口径明确只要求"行内 code span 花括号 → 不判 residue"这一单行形态），不产生漏报风险。

### Q4：新增测试用例

新增 `describe` 块，覆盖以下用例（对应 fix-report 复现证据表逐项 + 用户硬性验收 + 边界项）：

1. **`stripCodeRegions` 单元测试**：
   - 行内单反引号 code span 含花括号 → 返回文本不含 `{`
   - 行内双反引号 code span（内部含单个反引号）含花括号 → 正确剥离
   - fenced （` ``` `）代码块含花括号 → 整块清空
   - fenced（`~~~`）代码块含花括号 → 整块清空（验证围栏字符切换仍走同一 `computeFenceMask`）
   - 4 个反引号围栏且内部含 3 个反引号字面量 → 按长度精确配对剥离，不误配
   - 未闭合反引号后紧跟花括号 → 反引号原样保留，花括号**不被剥离**（仍在结果文本中）
   - 表格行内 code span 含花括号 → 正确剥离
   - 跨行"code span"（反引号跨两行不闭合）→ 显式断言当前实现按行独立处理（第一行反引号视为未闭合、第二行的反引号视为新的独立起点），文档化为已知 non-goal，非缺陷

2. **`checkArtifactSection` 集成测试（对应 fix-report 复现证据表 R1/A/B/C/D/E + 新增边界）**：
   - **R1**（对应用户硬性验收①）：还原 F227 报告写法，`## 判定依据` 正文含行内 code span 花括号描述返回值形状 → `placeholderResidue = false`
   - **A**：锚点后散文里含行内 code span 花括号 → `false`
   - **B**：fenced code 块含花括号（同源第二形态）→ `false`
   - **C**（对应用户硬性验收②）：散文裸花括号、真实未替换占位符 → `true`（回归锁定，禁止退化）
   - **D**：正文过短（≤20 非空白字符）→ `true`（回归锁定）
   - **E**：散文空洞但 fenced code 撑长度（既有行为，验证 `MIN_SECTION_BODY_CHARS` 判据与代码剥离解耦，见下）→ `false`
   - **新增边界 1**：未闭合反引号后紧跟裸花括号（真实占位符被"伪装"成半个 code span）→ 仍判 `true`，证明伪装不构成绕过
   - **新增边界 2**：行内 code span 与散文裸花括号在同一章节正文中共存 → `true`（code span 部分被剥离豁免，但裸花括号部分仍命中，二者不互相污染判定）

3. **固定 `MIN_SECTION_BODY_CHARS` 与代码剥离交互预期的专项断言**：
   - 断言用例 E 中 `bodyChars`（长度判据）的计算源头逐字未变——构造一个「散文不足 20 字符 + fenced code 块含大量字符但不含花括号」的输入，断言其判定结果为 `false`（未过短、也非占位）；再构造对照组「同样散文 + 同样字符总量但用不含围栏的纯散文填充」，断言其效果一致，用注释显式说明"长度判据吃剥离前文本、占位符判据吃剥离后文本"这一分离契约，防止未来有人误改为让两个判据共用同一份输入。

## 回归风险评估

逐条核对 F216 C1 / C4 既有断言在新实现下的行为：

| 既有断言（行号） | 涉及函数 | 是否受本次改动影响 | 结论 |
|---|---|---|---|
| F216 C1 H3 子节完整 repair 报告（L1298-1316） | `extractSectionBody` + `stripReconSubblock` | 否——该输入无反引号/围栏，`stripCodeRegions` 对纯散文是恒等变换 | 仍通过 |
| F216 C1 no-op 报告复现对账 JSON 花括号不触发 placeholder（L1318-1330） | `stripReconSubblock` 先剔除整个复现对账子块 | 否——JSON 花括号在进入 `stripCodeRegions` 之前已被 `stripReconSubblock` 整段剔除，不依赖新逻辑 | 仍通过 |
| F216 C1 判定依据散文为空、仅复现对账 JSON → 占位（L1332-1342） | 同上 + 长度判据 | 否——`bodyChars` 计算源不变（仍是 `proseBody`），复现对账剔除后散文为空，长度判据独立命中 | 仍通过 |
| F216 C1 端到端 judgeCompliance 合规（L1344-1368） | `checkArtifactSection` 整体 | 否——纯散文输入，无代码区 | 仍通过 |
| F216 C4 fenced code 内 `## 判定依据` 不算锚点（L1412-1430、L1432-1451） | `classifyClosureForm`（独立函数，不经过 `checkArtifactSection`/`stripCodeRegions`） | 否——本次改动完全不触碰 `classifyClosureForm` | 仍通过 |
| F216 C4 `computeFenceMask` 基础断言（L1453-1457） | `computeFenceMask` 本身 | 否——不修改该函数，只是新增一个调用方 | 仍通过 |
| `checkArtifactSection` 基础断言（L173-195：真实证据/纯占位符/缺章节/过短） | `checkArtifactSection` | 否——均为纯散文输入（无反引号/围栏），`stripCodeRegions` 对这些输入是恒等变换，判定路径与结果不变 | 仍通过 |
| `judgeCompliance` 涉及 `okRepairReport` / `okNoopReport` 的组合断言（L210-305、L340 起 T018） | 间接经过 `checkArtifactSection` | 否——测试用 fixture 均为纯散文/单行 JSON（已被 `stripReconSubblock` 剔除），无裸露反引号 | 仍通过 |

**结论**：本次改动是在 `checkArtifactSection` 内部新增一步"仅影响含反引号/围栏字符输入"的清洗，对不含这些字符的既有输入是恒等变换（no-op）。F216 C1/C4 及 `checkArtifactSection`/`judgeCompliance` 全部既有断言的输入均不含反引号或围栏语法，逻辑路径不变，预期**零回归**。

**残留权衡（沿用 fix-report 已评估结论，不重复展开）**：整段模板占位符包进代码块可绕过占位符判据；已确认为可接受的负收益交易（详见 fix-report「已知残留权衡」段）。

## 验证方案

1. `npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs` —— 确认新增用例全绿 + 全部既有用例（含 F216 C1/C4）零失败。
2. `npx vitest run` —— 全量单测零失败（确认无跨文件隐性依赖）。
3. `npm run build` —— 类型检查零错误（本次为 `.mjs` 纯 JS 文件，仍需确认不破坏工具链其余 TS 部分的构建）。
4. `npm run repo:check` —— 仓库级同步与合同校验。
5. 手动复现 fix-report 复现脚本中 R1/A/B 三个曾失败用例，确认从 `FAIL` 转 `ok`（对照报告 L18-24 表格逐条核对，含 C/D/E 三个"必须仍为 ok"的用例保持不变）。

## Codex 对抗审查提醒

按项目约定，本次 plan 提交前需委派 `codex:codex-rescue` 做对抗性审查，重点核对：
- 反引号 run 长度配对算法是否存在可被构造出的绕过（例如刻意构造的反引号序列让真实占位符逃逸检测）
- 「长度判据 / 占位符判据 输入分离」是否存在被后续误改动合并回同一输入的风险点（建议审查是否需要加内联注释强调）
- 是否存在方案 A 未覆盖但真实存在的第三种代码区形态
