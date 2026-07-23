# 任务分解 — F229 占位符「不成对花括号」绕过收口

来源：`fix-report.md`（Root Cause）+ `plan.md`（方案 A 变更清单 §1、回归风险 §3、测试计划 §4、文档同步清单 §5）。
本任务清单严格遵循 TDD 顺序：**先翻转/新增测试看到红 → 再改生产代码常量 → 再改内联注释 → 最后同步两份合同文档 → 收尾全量验证**。

不新增判据分支、不改变 `checkArtifactSection` 函数签名与返回结构、不改动 `MIN_SECTION_BODY_CHARS`、不触碰
`stripCodeRegions` / `stripInlineCodeSpans` / `computeFenceRegions` 三个函数体、不改动另两条 F228
characterization（跨行 code span L2206、4 空格缩进块 L2218）。

---

## Phase 1：测试先行（TDD 红灯）— 串行于 Phase 2 之前，内部任务间部分可并行

### T001 翻转既有 characterization 断言为期望行为

- **目标文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **动作**：
  1. 定位 L2190-2204 的 `describe('存量行为（非本次 F228 R2 回归...）')` 分组中，L2196-2204 的
     `it('存量绕过（characterization，非期望行为）：缺右花括号（\`{未闭合的占位文本\`）→ 当前判 residue=false', ...)` 用例。
  2. 该用例的输入**逐字保留不变**：
     ```
     # 报告

     ## 判定依据
     {为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果
     ```
  3. 断言从 `assert.equal(r.placeholderResidue, false, ...)` 翻转为 `assert.equal(r.placeholderResidue, true, ...)`。
  4. 把该 `it` 整体从"存量行为"分组移出，移入紧邻的 `describe('F228 R3 · Codex 第二轮对抗审查修复反向断言', ...)`
     同级新建一个分组 `describe('F229 · 不成对花括号收口反向断言（fix-report.md 5-Why Root Cause）', ...)`。
  5. `it` 标题改为反映新期望，例如：
     `'F229：缺右花括号（\`{未闭合的占位文本\`）→ 修复后判 residue=true（原 F228 存量绕过已收口）'`。
  6. 在新分组内保留一句指向 `specs/229-fix-placeholder-unpaired-brace/fix-report.md` 的溯源注释。
  7. 原"存量行为"分组标题注释同步说明：三条中的第一条已移出（F229 已修复），剩余两条（跨行 code span 误报、
     4 空格缩进块误报）仍原样保留、不动。
- **完成判据**：`npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs` 此刻应为**红**——
  新断言 `residue === true` 与当前生产代码（尚未修改）行为不符，测试失败且失败原因明确指向该断言。

### T002 [P] 新增 CANONICAL_PLACEHOLDER_REGEX 判别边界表驱动用例（plan §4.2）

- **目标文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **动作**：在 L2121-2138 既有 `canonicalPlaceholderCases` 表驱动数组末尾追加 4 条用例（逐字照抄 plan §4.2，不得改写语料）：

  | text | shouldMatch | 用途 |
  |------|-------------|------|
  | `{根本原因一句话总结`（无右括号） | `true` | canonical 占位符不闭合仍须命中——直接对应 F229 repro |
  | `{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果`（无右括号，全角冒号非 ASCII） | `true` | 锁定全角冒号不触发 ASCII 冒号排除集 |
  | `{"claim":"症状已消除","command":"npx vitest run"`（无右括号，含 ASCII 冒号） | `false` | 证明 `$` 出口不会绕开既有冒号排除集 |
  | `{path: null, ambiguous`（无右括号，含 ASCII 冒号，无 CJK） | `false` | 双重排除（无 CJK + 含冒号）叠加下不闭合代码片段仍豁免 |

  沿用该表既有的 `for` 循环消费方式（`it` 描述由 `shouldMatch` 自动生成"命中/豁免"前缀），无需新增独立 `it` 块。
- **完成判据**：新增的 4 条用例在当前（未修改）生产代码下运行，第 1、2 条应为**红**（旧正则要求闭合，实际
  `shouldMatch` 与旧行为不符），第 3、4 条应为**绿**（旧正则本就不命中，`shouldMatch: false` 与旧行为吻合，
  仅在修复后仍须保持绿——用于后续验证严格超集）。

### T003 [P] 新增 PLACEHOLDER_OPEN_BRACE_REGEX 不闭合边界用例（plan §4.3）

- **目标文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **动作**：在"checkArtifactSection 集成测试"分组内新增一条 `it`：
  - **输入**：
    ```
    **Root Cause**: 待补充字段包括 {field_name 一直没有替换成真实字段名，后续继续补充说明文字凑够长度阈值。
    ```
    （通过 `checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX)` 走真实消费路径，花括号内为纯 ASCII 变量名、
    不含 CJK，确保命中的是通用判据而非 canonical 判据）
  - **期望断言**：`assert.equal(r.placeholderResidue, true, JSON.stringify(r))`
  - **it 标题**：体现"隔离验证 PLACEHOLDER_OPEN_BRACE_REGEX 自身判别力（花括号内容本身不含 CJK）"。
- **完成判据**：修改前运行为**红**（旧 `PLACEHOLDER_BRACE_REGEX` 要求闭合，不命中，实际 `false` ≠ 期望 `true`）。

### T004 [P] 新增"新增风险面"characterization（plan §4.4，对应 plan §3 表第三行）

- **目标文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **动作**：新增一条 characterization `it`（放在 T001 新建的 `F229 · 不成对花括号收口反向断言` 分组内，或紧邻其后）：
  - **输入**：
    ```
    **Root Cause**: 配置项 {database 这里漏打了一个右花括号，后续详细说明数据库连接串的各字段含义与默认值，本段落故意写得足够长以越过最小长度阈值的门槛要求。
    ```
  - **期望断言**：`assert.equal(r.placeholderResidue, true, JSON.stringify(r))`
  - **注释**：需注明"已知设计取舍，非缺陷——闭合与否与其是否为占位符无关，未闭合裸花括号一律计入可疑范围，
    作者应改用行内 code span 包裹花括号语法提及以获得代码区豁免"，供未来复审时避免被误当回归重新"修复"。
- **完成判据**：修改前运行为**红**（旧正则要求闭合，此输入未闭合，旧行为为 `false` ≠ 新期望 `true`）。

### T005（依赖 T001-T004 全部落笔后执行）确认 Phase 1 红灯基线

- **动作**：运行 `npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs`，记录失败用例清单。
- **完成判据**：失败用例精确等于 T001（1 条）+ T002（第 1、2 行，2 条）+ T003（1 条）+ T004（1 条）＝ 5 条红；
  其余全部既有断言（包括 T002 第 3、4 行、L2206/L2218 两条误报 characterization、L1986/L1998/L2291/L2303/L2321
  等既有回归保护）保持原有绿色不受影响。若红灯数量或位置与预期不符，需回头核对 T001-T004 是否逐字照抄
  plan 语料，禁止在此阶段动生产代码。

---

## Phase 2：生产代码收口（依赖 Phase 1 完成，串行执行，任务间有强依赖顺序）

### T006 常量改名 + 收窄正则：`PLACEHOLDER_BRACE_REGEX` → `PLACEHOLDER_OPEN_BRACE_REGEX`

- **目标文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- **动作**：
  1. L139：`const PLACEHOLDER_BRACE_REGEX = /\{[^}]*\}/;` 改为
     `const PLACEHOLDER_OPEN_BRACE_REGEX = /\{/;`。
  2. 全文搜索所有引用 `PLACEHOLDER_BRACE_REGEX` 的消费点（L734、L735 两处），标识符同步改为
     `PLACEHOLDER_OPEN_BRACE_REGEX`，**判据结构、运算符、括号分组逐字不变**，仅改标识符名。
  3. 若模块存在 `export` 该常量或测试文件通过具名 import 引用旧标识符，一并同步改名（先用 grep 全仓确认无遗漏）。
- **完成判据**：`grep -rn "PLACEHOLDER_BRACE_REGEX" plugins/spec-driver/` 应无残留（除 `_OPEN_` 变体外）；
  仅此一步改动后重跑 T003 对应用例应转绿，T002 第 1、2 行仍可能为红（需 T007 一起才转绿，因为 T002 用例
  走的是 canonical 判据，非本步骤覆盖范围——本步骤只影响 `PLACEHOLDER_OPEN_BRACE_REGEX` 相关用例，即 T003
  与 T004）。

### T007（依赖 T006 之后，同文件不可与 T006 并行）放宽 canonical 判据闭合边界

- **目标文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- **动作**：L150：
  `const CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*\}/;`
  改为：
  `const CANONICAL_PLACEHOLDER_REGEX = /\{(?=[^}]*[一-鿿])[^}:]*(?:\}|$)/;`
  **仅改闭合边界，CJK 前置断言 `(?=[^}]*[一-鿿])` 与 ASCII 冒号排除集 `[^}:]*` 逐字保留、不做任何其他改动**。
- **完成判据**：重跑 `npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs`，
  T001、T002（全部 4 行）、T003、T004 五条此前的红灯全部转绿；全量测试文件其余既有断言（含 L2206/L2218 两条
  误报 characterization、L1986/L1998/L2291/L2303/L2321 等回归保护）保持原有绿色不变——这是 plan §4.5"严格超集"
  验证要求的核心判据，不允许出现新的红灯或既有绿灯转红。

### T008（依赖 T006、T007）确认第 4 段 OR 判据无需单独改动

- **目标文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（只读确认，不改代码）
- **动作**：核对 L732-735 四段 OR 判据在 T006/T007 改动后，`checkArtifactSection` 函数签名、参数、返回结构
  `{nonEmpty, hasRequiredSection, placeholderResidue}` 是否逐字未变；第 4 段
  `(PLACEHOLDER_OPEN_BRACE_REGEX.test(proseBody) && strippedChars <= MIN_SECTION_BODY_CHARS)` 是否随常量改名
  自动生效、无需额外分支。
- **完成判据**：确认无需改动（对应 fix-report 结论"无需单独改动，随 L139 常量自动收口"），若发现需要额外分支，
  立即停止并升级到人工复核（不在本任务清单授权范围内）。

---

## Phase 3：内联注释同步（依赖 Phase 2 完成，可与 Phase 4 部分并行，见依赖说明）

### T009 [P] 更新生产代码内联注释

- **目标文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- **动作**：
  1. L138（`PLACEHOLDER_OPEN_BRACE_REGEX` 上方注释）：补充指向 F229 与 Root Cause 结论
     "闭合与否与是否为占位符无关，锚点收窄为存在未替换的模板起始标记 `{`"。
  2. L141-149（`CANONICAL_PLACEHOLDER_REGEX` 上方大段注释）：补充一句说明闭合边界已放宽为 `}` 或**行尾**，
     CJK 前置与冒号排除两项判别力逐字保留，避免未来读者按旧注释里"成对花括号"的措辞重新引入闭合要求。
     （订正注：本任务首版写成"文本结束"是错的——实测发现 `$` 若不带 `/m` 表示整段章节末尾而非行尾，
     会跨围栏误报，此即 R1 回归；已收口为两分支 alternation + `/m` 行锚定，措辞订正为"行尾"，见
     verification-report.md「Codex 对抗审查复审收口」一节。）
  3. L729-735（`checkArtifactSection` 内四段判据注释）：第 4 段注释补充说明"随常量收口自动收紧，无需单独改动"
     这一事实，并同步注释中对 `PLACEHOLDER_BRACE_REGEX` 旧名的引用改为 `PLACEHOLDER_OPEN_BRACE_REGEX`。
- **完成判据**：`grep -n "PLACEHOLDER_BRACE_REGEX" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
  无残留旧标识符引用；注释准确反映当前实现，不含误导性"必须闭合"措辞。

---

## Phase 4：合同文档同步（可与 Phase 3 并行，二者不改同一文件）

### T010 [P] 同步 no-op-report-template.md 合同描述

- **目标文件**：`specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md`
- **动作**：第 28 行表格中"且通用花括号占位符（正则 `/\{[^}]*\}/`）在剥离**闭合**围栏与行内 code span 之后的
  文本上不命中"这一分句，改写为"且通用花括号占位符（正则 `/\{/`，不要求闭合）在剥离**闭合**围栏与行内 code span
  之后的文本上不命中"。"未闭合围栏不剥离，转义反引号不作 code span 定界符"等既有措辞逐字保留，不涉及
  `stripCodeRegions` 相关描述改动。
- **完成判据**：文档措辞与 T006/T007 修改后的实现一致，不再暗示"通用花括号占位符要求闭合"。

### T011 [P] 同步 data-model.md 字段描述

- **目标文件**：`specs/208-fix-mode-process-compliance/data-model.md`
- **动作**：第 80 行 `placeholderResidue` 字段说明中：
  1. "通用花括号占位符仅在剥离**闭合**围栏与行内 code span 之后的文本上扫描命中"改为
     "通用花括号占位符（不要求闭合）仅在剥离**闭合**围栏与行内 code span 之后的文本上扫描命中"。
  2. 在 canonical 占位符描述（`{根本原因一句话总结}` 形态）后补一句
     "闭合边界为 `}` 或**行尾**（不要求实际闭合；不成对形态锚定在同一行内，不跨行匹配）"。
     （订正注：本任务首版写成"章节正文结束"是错的——实测发现 `$` 若不带 `/m` 表示整段章节末尾而非
     行尾，会跨围栏误报，此即 R1 回归；已收口为两分支 alternation + `/m` 行锚定，措辞订正为"行尾"。）
- **完成判据**：文档准确反映 T007 的正则改动语义，与 `contracts/no-op-report-template.md`（T010）表述一致
  （不冲突、不重复矛盾）。

### T012 [P] 同步测试文件分组标题注释（若 T001 未在同一次改动内完成，此处二次确认）

- **目标文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **动作**：确认 T001 中"存量行为"分组标题与注释已同步体现"F229 已修复该条，不再是存量绕过，仅剩两条误报
  characterization（跨行 code span、4 空格缩进块）留在此分组"。若 T001 执行时已一并完成，此任务仅作复核勾选。
- **完成判据**：分组标题、注释与实际剩余用例数量（2 条）一致，无遗留误导性描述。

---

## Phase 5：收尾全量验证（依赖 Phase 1-4 全部完成，串行执行，全部零失败方可视为完成）

### T013 单元测试全量重跑（严格超集验证，plan §4.5）

- **命令**：`npx vitest run`
- **完成判据**：零失败。额外人工核对点：确认 T002 表格第 3 行（`{"claim":"症状已消除",...` 无右括号但含
  ASCII 冒号）用例结果为 `false`（豁免），即 plan §2 中"JSON 含冒号 + CJK 未闭合仍豁免"的论证在真实测试中
  得到复现，不能只停留在计划文字论证层面。

### T014 插件专项测试

- **命令**：`npm run test:plugins`
- **完成判据**：零失败。

### T015 构建验证

- **命令**：`npm run build`
- **完成判据**：类型检查零错误。

### T016 仓库级同步检查

- **命令**：`npm run repo:check`
- **完成判据**：零失败（含 release-contract、docs 同步等全部子检查通过）。

### T017 收尾复核：确认严格超集与不改动项

- **动作**：
  1. `git diff` 核对本次改动范围严格限定在：
     `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（常量改名 + 正则收窄 + 注释）、
     `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（T001-T004 新增/翻转用例 + 分组标题）、
     `specs/208-fix-mode-process-compliance/contracts/no-op-report-template.md`（第 28 行）、
     `specs/208-fix-mode-process-compliance/data-model.md`（第 80 行）。
  2. 确认未触碰：`MIN_SECTION_BODY_CHARS`、`stripCodeRegions`/`stripInlineCodeSpans`/`computeFenceRegions`
     函数体、`checkArtifactSection` 签名与返回结构、另两条 F228 characterization（L2206/L2218 对应内容）、
     `SKILL.md` 模板文案、`MISSING_ACTION_TEXT['artifact:placeholder']` 反馈文案。
- **完成判据**：diff 范围与本清单声明的改动文件完全一致，无越界改动。

---

## 依赖关系总览

```
Phase 1（测试先行，红灯）
  T001 ─┐
  T002 ─┼[P]─→ T005（红灯基线确认，依赖 T001-T004 全部完成）
  T003 ─┤
  T004 ─┘
        │
        ▼
Phase 2（生产代码，串行，同文件）
  T006 → T007 → T008
        │
        ▼
Phase 3 / Phase 4（可并行，不同文件）
  T009 [P]          T010 [P] ─┐
                     T011 [P] ─┼[P]
                     T012 [P] ─┘
        │
        ▼
Phase 5（收尾验证，串行）
  T013 → T014 → T015 → T016 → T017
```

- T002/T003/T004 三条测试任务互相独立（不同用例、可能同一文件不同位置），可并行编写，但都需在 T005 前完成。
- T006 必须先于 T007（同一文件相邻常量定义，避免并发编辑冲突；且 T007 的完成判据依赖 T006 已完成的标识符改名）。
- T008 是只读确认，依赖 T006/T007 均已落地。
- T009（生产代码注释）与 T010/T011/T012（文档/测试标题）分属不同文件，可并行；但均须在 Phase 2 完成后才有
  准确内容可写（注释与文档需描述"改动后"的行为）。
- Phase 5 五个验证命令建议按 T013→T014→T015→T016 顺序串行执行（各自零失败为进入下一步的前提），
  T017 为人工 diff 复核，放最后。
