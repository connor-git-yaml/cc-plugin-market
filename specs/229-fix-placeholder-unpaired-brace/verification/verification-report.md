# 验证报告 — F229 占位符检测「不成对花括号」存量绕过

## 概述

- feature 目录：`specs/229-fix-placeholder-unpaired-brace/`
- 修复文件：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- 同步测试：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- 同步文档：`specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md`、`specs/208-fix-mode-process-compliance/data-model.md`
- 本报告为 Phase 4c 独立复跑，不采信 4a/4b 转述，所有结论均带真实命令输出。

## Layer 2：原生工具链验证（独立复跑）

| 命令 | 结论 | 真实输出摘要 |
|------|------|-------------|
| `npm run test:plugins` | ✅ PASS（退出码 0） | `tests 721 / suites 142 / pass 721 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 1973.78` |
| `npx vitest run` | ✅ PASS（退出码 0） | `Test Files 483 passed \| 4 skipped (487)` / `Tests 5769 passed \| 18 skipped \| 21 todo (5808)` / `Duration 47.92s` |
| `npm run build` | ✅ PASS（退出码 0） | `tsc` 零输出即通过；postbuild 盖章 `commit=ff784174 (dirty)` 正常写入 |
| `npm run repo:check` | ✅ PASS（退出码 0） | 全部 check 项 `pass`，仅 `graph-quality:freshness` 为 `warn`（图产物 sourceCommit 与当前 HEAD 不一致，属图未重建的既有告警，非本次改动引入，非阻断项） |

`npm run test:plugins` 的 721 通过数高于 fix-report 记录的改动前基线 715（新增 6 条 F229 反向断言，与 tasks.md 计划一致）；`npx vitest run` 的 5769 pass / 0 fail 与改动前基线数字一致（本次改动不涉及 vitest 套件新增用例，仅 node:test 套件新增）。

## 核心验收复核（独立调用，不采信转述）

对给定输入直接调用当前仓库代码（非引用文档转述）：

```js
const content = "# 报告\n\n## 判定依据\n{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果";
checkArtifactSection(content, /^##\s*判定依据\s*$/m);
```

真实返回：

```json
{ "nonEmpty": true, "hasRequiredSection": true, "placeholderResidue": true }
```

**绕过已堵死**：`placeholderResidue: true`，与 fix-report 声明的验收目标一致（修复前应为 `false`，见下节 A/B 对拍）。

## 未误伤对拍（独立执行，非采信）

### 1. 修复前 vs 修复后单点对拍（复现"绕过存在"的反证）

用 `git show HEAD:plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 取旧版文件内容，临时复制到 lib 目录下（与 sibling 模块 `fix-compliance-execution-record.mjs` 共享同一相对导入路径，无需改写 import），对同一输入调用：

| 版本 | `placeholderResidue` |
|------|----------------------|
| 旧版（HEAD 提交前，`\{[^}]*\}` 要求闭合） | `false`（绕过成立，与问题描述一致） |
| 新版（本次修复，`\{` 不要求闭合） | `true`（绕过已堵死） |

验证后立即删除临时文件 `plugins/spec-driver/scripts/lib/f229-tmp-old-fix-compliance-core.mjs`，`git status --porcelain plugins/spec-driver/scripts/lib/` 复核仅剩预期的 1 条 modified 记录，无残留。

### 2. 全仓真实制品新旧对拍

对 `git ls-files "specs/**/fix-report.md" "specs/**/verification-report.md"` 命中的 **215 个已跟踪文件**（4b 报告 216 个，差异来自本次未跟踪的 `specs/229-*/` 目录不计入 `git ls-files`，口径一致），分别用 `NOOP_JUDGMENT_HEADING_REGEX`（`## 判定依据`）与 `ROOT_CAUSE_HEADING_REGEX`（`Root Cause`）两个生产实际使用的锚点跑 `checkArtifactSection` 新旧对拍：

```
total files: 215
total diffs: 0
```

**0 分歧**，与 4b 声明的"216 个真实制品新旧对拍 0 分歧"结论一致（数字口径差异已说明，非矛盾）。

### 3. 边界正/反例复核

独立构造以下用例逐条实测（均通过 `checkArtifactSection` 真实调用，非直接摸内部未导出正则）：

| 用例 | 实测结果 | 说明 |
|------|---------|------|
| canonical 成对占位 `{根本原因一句话总结}` | `placeholderResidue: true` | 正例仍命中 |
| JSON 字面量 `{"claim": "..."}` 未包 code span（裸露在散文中） | `placeholderResidue: true` | **正确行为**：未被结构性剥离（无 code span/fence 包裹），按 F228 设计本就不豁免，非回归 |
| 同一 JSON 字面量包进行内 code span（`` ` `` 包裹）+ 足够长散文 | `placeholderResidue: false` | 代码区结构性豁免生效，无误报 |
| ASCII 对象 `{ path: null, foo: bar }` 包 code span + 足够长散文 | `placeholderResidue: false` | 同上 |
| fenced 代码块 `{ path: null, foo: 1 }` + 短散文（≤20 字符） | `placeholderResidue: true` | 命中 F228 R3-1 第 4 段判据（"剥离代码区后散文不足阈值"），非本次引入的行为，逐字沿用旧判据结构 |
| 同一 fenced 代码块 + 充分长散文（>20 字符） | `placeholderResidue: false` | 第 4 段判据不误触发，豁免正确生效 |
| 全角下划线占位符 `＿＿＿真实commit` | 新旧版本均为 `false` | 已知残余风险（见下），新旧行为一致，非本次引入 |
| 60 万字符对抗输入（30 万个裸 `{` + 30 万个非 CJK 字符） | 耗时 **4ms**，`placeholderResidue: true` | 无 ReDoS，与 4b"5ms"结论一致（同量级） |

### 4. 代码 diff 逐字核对

- `fix-compliance-core.mjs` 的实际 diff（`PLACEHOLDER_BRACE_REGEX` → `PLACEHOLDER_OPEN_BRACE_REGEX = /\{/`；`CANONICAL_PLACEHOLDER_REGEX` 闭合边界 `\}` → 两分支 alternation `…\}|…$` 配 `/m`（见下方「Codex 复审收口」R1，首版单分支 `(?:\}|$)` 无 `/m` 已被证实为回归并修正）；第 4 段判据随常量重命名自动收口，无额外分支）与 fix-report 描述的方案 A 逐字一致。
- `specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md` 第 28 行、`data-model.md` 第 80 行的文档更新内容与 fix-report §"Spec 影响"逐字一致（"正则 `/\{[^}]*\}/`" → "正则 `/\{/`，不要求闭合"；canonical 占位符描述新增"其闭合边界为 `}` 或**行尾**（不要求实际闭合；不成对形态锚定在同一行内，不跨行匹配）"——本行为 R1 收口后的最终态措辞，两份合同文档当前实际内容逐字一致，非首版规划时误写的"章节正文结束"）。
- 测试文件新增/改写位置与 fix-report §"同步更新清单"一致：原 characterization 断言（`residue=false`）已移出"存量行为"分组、翻转为新分组「F229 · 不成对花括号收口反向断言」下的 `residue=true` 断言，并新增边界用例（纯 ASCII 占位不闭合、canonical 正反例矩阵新增 4 条 F229 用例）。

## 对 4a / 4b 结论的抽查复核

| 4a/4b 声称 | 抽查方式 | 复核结果 |
|-----------|---------|---------|
| plan §1 变更清单 6/6 落地 | 逐行核对 diff 与 fix-report/plan 描述 | **一致**：两条常量定义、四段判据引用、两处文档措辞、测试翻转，均在实际 diff 中找到对应改动 |
| 216 个真实制品新旧对拍 0 分歧 | 独立重跑相同口径对拍脚本 | **一致**（215 vs 216 为 git ls-files 是否含未跟踪 specs/229 目录的口径差异，非分歧数字矛盾） |
| 20000 条合成文本旧→新单向蕴含 0 违反 | 未逐条重跑合成语料（4b 脚本未随报告附带），改用等价边界矩阵（正例/反例/CJK/ASCII 冒号排除集）人工构造 8 组代表性用例复现 | **未发现反例**，全部符合"旧 miss → 新 HIT 或旧新皆 miss"单向蕴含方向，未发现"旧 HIT → 新 miss"的反向违规 |
| 60 万字符对抗输入 5ms 无 ReDoS | 独立重跑等量级对抗输入（30 万裸 `{` + 30 万非 CJK 字符） | **一致**：实测 4ms，同量级、无超线性放大迹象 |
| 全角花括号等非 ASCII 占位符可绕过，新旧行为一致、非本次引入 | 独立对拍旧版 vs 新版同一全角占位符输入 | **一致**：新旧版本均返回 `false`，确认为存量缺口 |
| `fix-compliance-core.mjs` 已回涨到 930 行 | `wc -l plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | **一致**：实测输出 `930 plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`，与 4b 声称的 930 行逐字精确一致 |

## Codex 对抗审查复审收口（R1 回归 + R2 覆盖缺口）

Phase 4c 之后的 Codex 对抗审查在已完成的实施上发现两项 CRITICAL，均已收口并重验。

### R1（真实回归）：`$` 无 `/m` 时匹配的是**章节末尾**而非行尾

- **缺陷**：首版 `CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*(?:\}|$)/` 未带 `/m`，`$` 表示整段章节末尾；`[^}:]*` 本身又能吃换行，于是未闭合的 `{` 会**跨闭合围栏、跨段落**一路吞到章节结束。后果是合法 repair 报告"引用一段被截断的代码（含未闭合 `{`）+ 围栏后中文说明"被误判为占位空壳，**违反 F228 已确立的代码区豁免**，也证伪了 plan §3 首版"唯一新增面是散文中的裸花括号"的声称。
- **复现（修复前，实跑）**：输入为 `**Root Cause**: …证据见下方代码片段。` + ` ```js ` / `function demo() {` / ` ``` ` + `该函数进入分支后返回默认结果…`，`checkArtifactSection(content, /Root Cause/i).placeholderResidue` 返回 `true`（应为 `false`）。
- **收口**：改为两分支 alternation `/\{(?=[^}]*[一-鿿])[^}:]*\}|\{(?=[^}\n]*[一-鿿])[^}:\n]*$/m`。分支 1 = F229 之前的成对形态**逐字不变**（保住跨行成对占位符，是旧判据的严格超集）；分支 2 = 不成对形态，lookahead 与字符类均排除 `\n`、配 `/m` 使 `$` 为**行尾**，把匹配硬锚在同一行内。
- **修复后实跑**（`node` 直调生产模块）：

  ```
  R1 (围栏内截断代码+后续中文散文, 期望 false): false
  R1b (跨行成对 canonical, 期望 true): true
  目标绕过 (期望 true): true
  ```

- **新增回归测试（2 条，锁死不复发）**：`F229 R1 · canonical 判据行内锚定回归` 分组下
  - `R1-a`：闭合围栏内含未闭合 `{` 的代码 + 围栏后中文散文 → `residue === false`
  - `R1-b`：跨行**成对** canonical 占位符 `{根本原因\n一句话总结}` → `residue === true`（证明分支 1 未被 `\n` 排除削弱）

### R2（测试覆盖缺口）：无任何用例隔离 `PLACEHOLDER_OPEN_BRACE_REGEX` 的收窄

- **缺陷**：Codex 实测——只做 canonical 改动、**完全不改** `PLACEHOLDER_BRACE_REGEX → /\{/`，F229 新增的全部用例（含号称"隔离验证通用判据"的 `{field_name 一直没有替换成真实字段名…`）仍全绿。因为该输入的 `{` 后同一行就有 CJK 且无 ASCII 冒号，canonical 分支自己就命中了。原用例标题与注释的"隔离验证"声称不成立，已就地订正为"本条**不**隔离通用判据"。
- **收口**：新增分组 `F229 R2 · PLACEHOLDER_OPEN_BRACE_REGEX 隔离断言`，输入 `**Root Cause**: 具体成因待补充，模板字段 {reason: 尚未替换为真实内容，此处补足足够长度的中文说明以越过最小正文阈值。` → 期望 `residue === true`。隔离原理：`{` 后紧跟 ASCII 冒号 ⇒ canonical 成对分支缺 `}` 失败、不成对分支撞冒号提前停止且非行尾亦失败；散文与剥离后散文均远超阈值 ⇒ 长度判据与第 4 段 `strippedChars` 边界判据均不成立。唯一可能命中源即第 3 段的 `/\{/`。
- **反证实跑（把生产代码 `PLACEHOLDER_OPEN_BRACE_REGEX` 临时还原为 `/\{[^}]*\}/`、canonical 保持收口后新值）**：

  ```
  ▶ F229 R2 · PLACEHOLDER_OPEN_BRACE_REGEX 隔离断言（构造成 canonical 分支不可能命中）
    ✖ 不成对 `{` 后紧跟 ASCII 冒号（canonical 两分支均失败）→ 仅通用判据能命中，判 true (0.32425ms)
  ✖ F229 R2 · PLACEHOLDER_OPEN_BRACE_REGEX 隔离断言（构造成 canonical 分支不可能命中） (0.349958ms)
  ...
    actual: false, expected: true, operator: 'strictEqual'
  ```

  同一次运行中 R1-a / R1-b 仍为 `✔`（说明失败被精确隔离到 R2 这一条）。把常量改回 `/\{/` 后该套件 `tests 291 / pass 291 / fail 0`。

### R1/R2 收口后的全仓对拍复核

对全仓 217 份 `specs/**/fix-report.md` + `specs/**/verification-report.md`，以 `git show HEAD:` 取 F229 之前的 `fix-compliance-core.mjs` 作旧版，与收口后新版逐份跑 `checkArtifactSection`（Root Cause / 判定依据两条 heading 探针）对拍：

```
files=217 probes=434 diffs=0
```

## 已知残余风险（如实记录，非本次引入，需另立 feature）

1. **全角花括号 / 非 ASCII 占位符形态可绕过**（`｛｝`、`<占位>`、`[占位]`、`＿＿＿` 等）。已用旧版 vs 新版对拍确认二者行为一致（均为 `false`），证实非 F229 引入。需另立 feature 的理由：这是判据锚点集合本身的覆盖面问题（当前判据锚定 ASCII `{`/`}` 与特定 CJK 占位符形态），扩展到全角标点/其他占位符惯用语需要重新设计判别力矩阵（避免"每发现一种新占位符形态就加一条特判"式的判据膨胀），应作为独立设计任务评估。
2. **`fix-compliance-core.mjs` 跨 feature 累积行数劣化**（F218 拆分后 562 行 → 本次后约 930 行左右）。这是架构层面的技术债，非本次修复引入的缺陷，但修复过程中的注释/常量重命名/测试断言迁移是必要的（保留可追溯的 F228→F229 演进脉络），不应为控制行数而删减必要的溯源注释。需另立 feature 的理由：拆分/精简涉及对 io.mjs / judge.mjs 等消费端的调用面评估，超出本次"堵一个绕过"的范围，混入会放大本次改动的验证面。
3. **裸占位符塞进 `### 复现对账` 子块可漏检**。已确认为 F216 既有设计取舍（`stripReconSubblock` 定向剔除该子块不参与占位符扫描），已用 4b 报告的对拍结论复核非本次引入。需另立 feature 的理由：这涉及是否要让复现对账子块也纳入占位符扫描的产品行为决策（当前子块设计初衷是允许作者填入结构化 JSON 证据、天然含花括号），改动方向可能引入新的误报面，需要独立需求评估。

### Codex 复审新增的残余风险（4–8，均已新旧对拍确认**非本次引入**，本次刻意不修）

4. **非 ASCII 花括号形态的纯占位文本可通过完整 `judgeCompliance`**：全角花括号 `｛｝`、HTML 实体 `&#123;`、`<占位>` / `[占位]` / `＿＿＿` 等形态，新旧行为一致（均放行）。与残余风险 1 同源但作用域更大——1 只讲 `checkArtifactSection`，本条经 Codex 实测确认可穿透**完整** `judgeCompliance` 全链路。**为何另立 feature 而非本次顺手修**：这是判据锚点**字符集合**的覆盖面问题，逐个字符形态加特判正是本仓反复要消灭的"内容启发式"反模式（F228 已确立结构性边界优先）；正确解法是重新设计"什么算未替换模板标记"的判别力矩阵，属独立设计任务，塞进本次会把"堵一个绕过"的验证面放大到整套判据。

5. **闭合 code span + ASCII 冒号 + HTML comment 填充可使四段 OR 全假**：把占位内容包进闭合 code span（躲第 3 段代码区剥离）、在 `{` 后放 ASCII 冒号（躲 canonical 两分支）、再用 HTML 注释把 `strippedChars` 撑过阈值（躲第 4 段边界判据）。新旧行为一致。**为何另立 feature**：这是四段 OR 的**组合式**绕过，修它要动第 4 段阈值判据的判别锚点（例如把 HTML 注释也纳入剥离范围），会直接改变 F228 R3-1 已定型的边界语义并牵动大量既有 characterization，与本次"只放宽闭合边界、不动判别力"的设计约束冲突。

6. **`stripReconSubblock` 被无条件应用于 repair 的 Root Cause 章节**：F216 既有设计——该函数对 `### 复现对账` 子块的剔除不区分 closureForm，repair 报告在 Root Cause 下写一个 `### 复现对账` 子块即可把占位符移出扫描范围。与残余风险 3 同源，但本条强调的是"**无条件**应用"这一额外面。**为何另立 feature**：要按 closureForm 条件化剔除，需要给 `checkArtifactSection` 增加形态入参（改签名），而本次硬约束明确要求签名与返回结构不变。

7. **`extractSectionBody` 只取第一次命中的 required heading**：该函数在第一个命中 heading 处停止、并以下一个 H1/H2 终止，因此重复书写 `## 判定依据` 可把占位符移到**第二个**同名章节里、完全逃出扫描范围。新旧行为一致。**为何另立 feature**：改为"扫描全部同名章节的并集"会改变章节提取的通用语义，波及 F216 C1 / F228 的多条既有断言与 `classifyClosureForm` 的锚点计数，属独立重构。

8. **`CANONICAL_PLACEHOLDER_REGEX` 为 O(n²)，且 artifact 读取无大小上限**：对抗输入 `"{".repeat(n) + "中:"` 下耗时随 n 平方增长；`fix-compliance-io.mjs` 的 `readArtifactFile` 未设 artifact 大小上限，理论上可由超大制品放大该开销。**本次 R1 收口的如实影响（必须写明）**：把 canonical 改为两分支 alternation 后**常数放大约 3×，阶数不变**。实测（同机，单次 `test()`）：

   | n（`{` 个数） | 旧（F229 前，单分支成对） | 新（R1 收口后，两分支） | 比值 |
   |---|---|---|---|
   | 4,000 | 12ms | 29ms | ~2.4× |
   | 8,000 | 34ms | 100ms | ~2.9× |
   | 16,000 | 121ms | 387ms | ~3.2× |

   两列均呈"n 翻倍 → 耗时约 4×"的平方增长，确认阶数未变、仅常数放大。**为何另立 feature**：真正的解法是在 io 层给 `readArtifactFile` 加大小上限（fail-loud 截断或拒读），属 io 层的输入约束设计，不在本次纯 core 判据修复的范围；而在 core 侧为规避回溯改写正则形态，会重新引入"为性能牺牲判别力"的取舍，需独立评估。当前实际风险有限——真实制品远小于该量级，全仓 217 份制品对拍总耗时在秒级。

## 最终结论

**✅ READY — 本次修复真实达成验收**：

- 核心绕过场景（无右花括号的占位文本）经独立复核确认已从 `placeholderResidue: false` 收口为 `true`（真实调用验证，非采信转述）
- 全部四条工具链验证（`test:plugins` / `vitest run` / `build` / `repo:check`）真实执行，退出码均为 0
- 215 个真实制品新旧对拍 0 分歧，确认未误伤既有合规判定
- 8 组独立构造的边界正/反例复核，未发现新引入的误报或漏报
- 4a/4b 的关键结论逐条抽查，均与独立复跑结果一致，无转述与实测不符之处
- Codex 对抗审查发现的 R1（`$` 无 `/m` 跨行吞噬回归）与 R2（通用判据无隔离用例）两项 CRITICAL 均已收口：R1 改为两分支行内锚定 alternation 并补 2 条回归测试，R2 补 1 条真隔离用例并以"临时还原旧常量 → 用例变红"的反证实跑证明其判别力；收口后全仓 434 次新旧对拍差异 0
- 八条已知残余风险均已用旧版 vs 新版对拍确认为存量缺口，非本次引入，已逐条记录为何另立 feature 而非顺手修复（其中第 8 条如实写明本次 R1 收口带来的 ~3× 常数放大、阶数不变）
- git 改动范围核实为预期的 4 个已跟踪文件（2 个 plugins 源文件 + 2 个 specs/208 合同文档）+ 1 个未跟踪的 `specs/229-*/` 目录，无越界改动、无临时文件残留

## 工具使用反馈

- Spectra MCP：本次验证任务是纯正则行为的 A/B 对拍与工具链验证，不涉及跨文件调用链追溯或 blast radius 评估，未调用 Spectra MCP 工具。原因：`checkArtifactSection` 是纯函数，独立可测，Grep/Read 已足够定位改动范围与调用点（`grep -n "checkArtifactSection("` 一次即找全两处生产调用点），引入 impact/context 工具不会带来额外信息增量。
