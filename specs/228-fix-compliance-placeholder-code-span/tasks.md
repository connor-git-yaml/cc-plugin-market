# 修复任务清单（F228）

来源：`fix-report.md`（方案 A：语义收口）+ `plan.md`（变更清单 / Q1-Q4）。本清单只承载"做什么 + 怎么验收"，设计论证不重复。

## T1. 实现 `stripInlineCodeSpans(line)` 内部 helper

- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`
- **位置**：紧邻 `stripReconSubblock`（L546 附近），`extractSectionBody` 之后、`checkArtifactSection` 之前（plan.md Q1）
- **内容**：单行「反引号 run 长度精确配对」扫描剥离，按 plan.md Q2 算法实现——起止 run 长度必须相等才配对，配对成功整体替换为单个空格，未闭合反引号原样保留
- **依赖**：无
- **验收判据**：函数不导出（模块内私有），随 T2/T3 一并被单测覆盖，无需单独可执行验收

## T2. 实现并导出 `stripCodeRegions(text)`

- **文件**：同上
- **内容**：逐行应用 `computeFenceMask`（fenced 行整行清空）+ `stripInlineCodeSpans`（非 fenced 行内联剥离），拼回多行文本；复用 `fix-compliance-execution-record.mjs` 导出的 `computeFenceMask`，不新增依赖
- **依赖**：T1
- **验收判据**：新函数可被 `import { stripCodeRegions } from '.../fix-compliance-core.mjs'` 引用（供 T4 测试直接单测）

## T3. 改造 `checkArtifactSection`：拆分长度判据与占位符判据的输入源

- **文件**：同上（L569-584）
- **内容**：
  - `bodyChars`（长度判据）计算源保持 `stripReconSubblock(body)`（即 `proseBody`）**逐字不变**
  - 新增 `const placeholderScanText = stripCodeRegions(proseBody);`
  - `placeholderResidue` 的花括号判据改为对 `placeholderScanText` 测试，与长度判据仍用 `||` 组合
  - JSDoc 补充：`stripCodeRegions` 的语义边界（fenced 块整体清空 / 行内 span 精确长度配对 / 未闭合反引号原样保留 / 不处理跨行 span / 不处理缩进代码块）；`checkArtifactSection` JSDoc 追加"长度判据与占位符判据输入来源不同"一句
- **依赖**：T2
- **验收判据**：函数签名 `(content, requiredHeading) => { nonEmpty, hasRequiredSection, placeholderResidue }` 不变；`grep -n "stripCodeRegions\|placeholderScanText" plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 可见新增调用点

## T4. 新增 `stripCodeRegions` 单元测试（8 例）

- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`
- **新增 describe**：`F228 · stripCodeRegions / checkArtifactSection 代码区豁免`
- **必须覆盖用例**（逐条对应 plan.md Q4 第 1 组，不得省略任何一条）：
  1. 行内单反引号 code span 含花括号 → 返回文本不含 `{`
  2. 行内双反引号 code span（内部含单个反引号）含花括号 → 正确剥离
  3. fenced（\`\`\`）代码块含花括号 → 整块清空
  4. fenced（`~~~`）代码块含花括号 → 整块清空（验证围栏字符切换仍走同一 `computeFenceMask`）
  5. 4 个反引号围栏且内部含 3 个反引号字面量 → 按长度精确配对剥离，不误配
  6. 未闭合反引号后紧跟花括号 → 反引号原样保留，花括号不被剥离
  7. 表格行内 code span 含花括号 → 正确剥离
  8. 跨行"code span"（反引号跨两行不闭合）→ 显式断言当前实现按行独立处理（第一行反引号视为未闭合、第二行反引号视为新的独立起点），并注释标注为已知 non-goal（非缺陷）
- **依赖**：T2
- **验收判据**：`npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs -t "stripCodeRegions"` 8 例全绿

## T5. 新增 `checkArtifactSection` 集成测试（R1/A/B/C/D/E + 2 个新增边界）

- **文件**：同上，同一 describe 块下
- **必须覆盖用例**（逐条对应 plan.md Q4 第 2 组）：
  - **R1**（用户硬性验收①）：还原 F227 报告写法，`## 判定依据` 正文含行内 code span 花括号描述返回值形状 → `placeholderResidue === false`
  - **A**：锚点后散文里含行内 code span 花括号 → `false`
  - **B**：fenced code 块含花括号（同源第二形态）→ `false`
  - **C**（用户硬性验收②，回归锁定）：散文裸花括号、真实未替换占位符 → `true`
  - **D**（回归锁定）：正文过短（≤20 非空白字符）→ `true`
  - **E**：散文空洞但 fenced code 撑长度 → `false`
  - **新增边界 1**：未闭合反引号后紧跟裸花括号（伪装成半个 code span）→ 仍判 `true`，证明伪装不构成绕过
  - **新增边界 2**：行内 code span 与散文裸花括号在同一章节正文中共存 → `true`（code span 部分豁免，裸花括号部分仍命中，二者不互相污染）
- **依赖**：T3
- **验收判据**：`npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs -t "checkArtifactSection"` 全绿，且逐条与 fix-report.md L18-24 复现证据表核对一致

## T6. 新增 `MIN_SECTION_BODY_CHARS` / 代码剥离交互专项断言

- **文件**：同上，同一 describe 块下
- **内容**：构造「散文不足 20 字符 + fenced code 块含大量字符但不含花括号」输入 → 断言 `false`（未过短、非占位）；再构造对照组「同样散文 + 同样字符总量但用不含围栏的纯散文填充」→ 断言效果一致；注释显式说明"长度判据吃剥离前文本、占位符判据吃剥离后文本"分离契约，防止未来误改为共用同一输入
- **依赖**：T3
- **验收判据**：`npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs -t "MIN_SECTION_BODY_CHARS"` 全绿

## T7. 跑复现脚本确认 R1/A/B 从 FAIL 转 ok

- **脚本**：`/private/tmp/claude-501/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/a7dc16b4-c921-4442-aa58-2cf9b4571e4b/scratchpad/repro-f228.mjs`（临时脚本，不入库）
- **依赖**：T3
- **验收判据**：`node /private/tmp/claude-501/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/a7dc16b4-c921-4442-aa58-2cf9b4571e4b/scratchpad/repro-f228.mjs` 输出 7 例全部 `ok`：R1/A/B 三例从 `FAIL` 转为 `ok`（expect=false actual=false），C/D/E 三例保持 `ok` 不退化

## T8. 全量验证

- **依赖**：T4、T5、T6、T7 全部通过
- **验收判据**（三条命令均需零失败/零错误）：
  1. `npx vitest run` —— 全量单测零失败（含 F216 C1/C4 既有断言逐条保留，无退化）
  2. `npm run build` —— 类型检查零错误
  3. `npm run repo:check` —— 仓库级同步与合同校验通过

## FR 覆盖映射

| 验收口径 | 对应任务 |
|---|---|
| 用户硬性验收①：行内 code span 花括号不判 residue | T4(1/2/5/6/7) + T5(R1/A) |
| 用户硬性验收②：散文裸花括号仍判 residue（禁止退化） | T5(C) |
| fenced code 块同源第二形态 | T4(3/4) + T5(B) |
| `MIN_SECTION_BODY_CHARS` 判据不放宽 | T5(D) + T6 |
| 伪装绕过防御（未闭合反引号） | T4(6) + T5(新增边界1) |
| 代码区与散文裸花括号共存不互相污染 | T5(新增边界2) |
| F216 C1/C4 既有断言零回归 | T8-1 |
| 复现脚本实证转绿 | T7 |

## 依赖关系与并行说明

- T1 → T2 → T3：生产代码严格串行（同一文件内的递进改动）
- T4 可在 T2 完成后立即写（不依赖 T3），T5/T6 依赖 T3；T4 与 T5/T6 可并行编写，但建议在同一测试文件同一 PR 内一次性提交
- T7 依赖 T3 落地后才有意义（复现脚本调用的是修复后的 `checkArtifactSection`）
- T8 是收尾闸门，必须在 T4-T7 全部转绿后执行，且不可跳过任意一条命令
