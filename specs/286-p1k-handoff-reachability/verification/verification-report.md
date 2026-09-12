# F286 · P1-K / F277 移交承接 — 独立验证报告（T010）

本报告分两轮：**首轮**（2026-09-13，判 NEEDS FIX，5 项阻断）与**复核**（2026-09-13 同日，针对协调者转述的"对抗复审 A-C1/A-C2/A-W1~W5、B-C1/B-C2/B-W1~W5"修复做独立复核）。首轮内容原样保留在下方「第一轮」节，不做回填式修改；复核的判断建立在**重新亲跑**之上，不采信首轮结论到复核阶段。终结论见文末。

---

# 第一轮（2026-09-13，判 NEEDS FIX）

## 1. 元信息

- 基线（`--base`）：`9362f1a8`
- 分支：`286-p1k-handoff-reachability`
- worktree：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/f286-p1k-handoff`
- 验证日期：2026-09-13
- 执行者：verify 子代理（claude-sonnet-5），独立于 implement 会话，未读取其推理过程，仅读取制品与代码亲跑复核
- 改动范围核对：`git status --short` 与任务描述一致——18 个已跟踪文件修改（4 个 canonical SKILL + 4 个 skills-codex 镜像 + 4 个 .codex/skills 镜像 + `verify.md`/`verify.artifact.yaml`/`spec-review.md`/`spec-review.artifact.yaml`/`implement.md`/`templates/verification-report-template.md`/`dogfooding-feedback-ledger.md`）+ 4 个未跟踪路径（脚本、2 个测试文件、`specs/286-*/`）

## 2. 声称核对表（§A）

| # | 声称（来源） | 判定 | 证据 |
|---|---|---|---|
| 1 | `--base` 必填无默认，缺席 exit 2（fix-report §2a） | **证实** | 亲跑 `node .../export-reachability.mjs --project-root .`：stderr 含 `--base <ref> 是契约字段...`，`exit=2` |
| 2 | 比较命令与比较范围随报告输出（§2a） | **证实** | md/json 输出均含 `contract.compareCommands`（3 条：`git diff --name-only <base>` / `git ls-files --others --exclude-standard` / 未跟踪文件的 `cat`）与 `contract.scope` |
| 3 | 新增导出符号 = 新增行抽出的名字 − 删除行抽出的名字（§2a） | **证实** | 代码 `analyzeExportReachability` 第 122-125 行：`removedNames` 集合排除法；单测「零新增导出符号」用例（改值不改名）验证「只改值的既有导出不算新增」 |
| 4 | 生产侧使用计数不含 import / re-export 行（§2a） | **证实** | 单测 `deadOnly`：`productionImportCount=1, productionUseCount=0, warning=true`（一行死 import 不洗白）；`isImportLikeLine` 同时识别 `export {...} from` 形态的 re-export 行 |
| 5 | 测试侧扫全仓（§2a） | **证实** | 代码：`testFiles = listScopedFiles(root, ['']).filter(...)`，前缀为空串即扫整个 `projectRoot`，不受 `scope` 限制 |
| 6 | md 与 json 输出均带固定口径句 `HONESTY_BOUNDARY`（§2a） | **证实** | md 尾部 `> ${report.honestyBoundary}`；json 顶层 `honestyBoundary` 字段值与常量逐字相同（亲跑核对） |
| 7 | 零新增符号时附命令与原始输出（§2a，FR-027 同标准） | **证实** | 单测「零新增导出符号」用例：`assert.match(md.stdout, /零新增导出符号/)` 且 `/git diff --name-only/`，并断言 `rawOutputs.changedFiles` 为字符串 |
| 8 | `verify.md` Layer 1.85（6a 执行/6b 处置三支+落点/6c 固定口径）+ Layer 1.86（禁快照+同时刻A/B+替代证明）（§2b） | **证实** | `grep -n` 逐条命中：契约字段/禁止默认 HEAD/三支措辞/`任一报警未处置 ⇒ ... NEEDS FIX`/固定口径行；Layer 1.86 三要点均命中 |
| 9 | 报告结构行 + `verify.artifact.yaml` 两个可选章节 + 报告模板落点（§2b） | **证实** | `verify.md` 377 行报告结构含两层；`verify.artifact.yaml` `optional_sections` 含两行；模板第 49 行含 Layer 1.85 段 |
| 10 | `spec-review.md`/`.artifact.yaml`：tools 加 Write，仅限 `verification/spec-review-report.md`；证据来源改 Read evidence-pack.md；缺席则全局受限声明+FR 归未核验；`output_path` 改真实路径（§2c） | **证实** | frontmatter `tools: [Read, Write, Grep, Glob, ...]`；正文原句核对（见 §A 附注）；`git diff` 显示 `output_path` 由占位符 `"# 无文件输出..."` 改为 `"{feature_dir}/verification/spec-review-report.md"` |
| 11 | `implement.md`：红先行任务转绿即 append 取证段到 `implementation-notes.md`「## 红先行取证」；证据丢失按 F279 SOP（§2d） | **证实** | 逐字核对第 232-237 行，文件名、节名、SOP 描述均命中 |
| 12 | 四个 SKILL：spec-review 派发前置=编排器预跑注入 `evidence-pack.md`，不开 Bash 白名单；story/implement/fix 三个显式派发块注入证据包路径（§2e） | **证实** | 4/4 SKILL 均含 `evidence-pack.md` 前置段与「不开 Bash 白名单」；`feature` 用并行组表（无显式 `Task()` 派发块）故不要求注入行，与测试 `for (const skill of ['story','implement','fix'])` 的取舍一致，非遗漏 |
| 13 | `skills-codex/` 与 `.codex/skills/` 与 canonical 同步（wrapper SHA）（§4） | **证实** | `node plugins/spec-driver/scripts/validate-wrapper-sources.mjs --project-root .` → `status=pass`（6 项全 pass）；`npm run repo:check` 的 `spec-driver-wrappers:*`（6 项）与 `codex-plugin-consistency:*`（spec-driver 相关 6 项）全 pass |
| 14 | 账本 4 处「F286 已落地」标注落在对应条目（T008） | **证实** | `grep -n "F286 已落地" docs/design/dogfooding-feedback-ledger.md` 命中第 41/49/97/106 行，逐条核对 `git diff` 确认标注内容与实际改动一致（spec-review Write / implement RED 取证+verify Layer1.86 / verify Layer1.86 / 四 SKILL 证据包注入） |
| 15 | 默认范围不含 `skills*`、`docs/`（§3 能力边界声明） | **证实** | 亲跑 JSON 输出 `changedFiles` 只含 1 个文件（新脚本自身），18 个 SKILL/agents/docs 改动均不在候选集里 |
| 16 | 脚本自跑：新增导出 5 个符号「均由 CLI main 与测试之外的生产路径消费；处置：非报警」（fix-report §5） | **证伪** | 见 §3；亲跑输出显示 **3/5 报警**（`HONESTY_BOUNDARY`/`extractExportedNames`/`analyzeExportReachability`），且「非报警」不是 Layer 1.85 定义的三支之一 |
| 17 | `node --test ... → 22/0`（fix-report §5） | **证伪** | 亲跑 `node --test` 两文件合计 `tests 16 / pass 16 / fail 0`，非 22 |
| 18 | tasks.md T006：`f286-handoff-contracts.test.mjs 16/16` | **证伪** | 该文件实际 `it()` 数为 10（3+1+1+5，node 自身统计 `tests 16` 减去 `export-reachability.test.mjs` 的 6 得 10），非 16 |

## 3. Layer 1.85 自查（脚本对本卡改动的完整输出）

亲跑命令：`node plugins/spec-driver/scripts/export-reachability.mjs --project-root . --base 9362f1a8`（默认 scope，`--format json` 交叉核对一致）。完整原始输出：

```
## 新增导出符号生产可达性（F277 FR-010~013 · 词法）

### 契约字段
- baseRef: `9362f1a8`
- scope: `src/`, `plugins/spec-driver/scripts/`, `scripts/`
- compareCommands:
  - `git diff --name-only 9362f1a8`
  - `git ls-files --others --exclude-standard`
  - `(untracked) cat plugins/spec-driver/scripts/export-reachability.mjs`

### 新增导出符号
| 符号 | 定义文件 | 生产使用行 | 生产 import 行 | 测试使用行 | 使用点（≤10） | 报警 |
|---|---|---|---|---|---|---|
| `HONESTY_BOUNDARY` | plugins/spec-driver/scripts/export-reachability.mjs | 0 | 0 | 3 | — | ⚠️ |
| `extractExportedNames` | plugins/spec-driver/scripts/export-reachability.mjs | 0 | 0 | 0 | — | ⚠️ |
| `analyzeExportReachability` | plugins/spec-driver/scripts/export-reachability.mjs | 0 | 0 | 5 | — | ⚠️ |
| `renderMarkdown` | plugins/spec-driver/scripts/export-reachability.mjs | 6 | 0 | 46 | (6 处，跨 3 个不相关文件，见下方分析) | — |
| `main` | plugins/spec-driver/scripts/export-reachability.mjs | 182 | 1 | 410 | (182 处，跨全仓，见下方分析) | — |

### 报警处置表 — 报警 3 条（原样留空，未处置）
| 符号 | 处置 | 落点 | 理由 |
|---|---|---|---|
| `HONESTY_BOUNDARY` |  |  |  |
| `extractExportedNames` |  |  |  |
| `analyzeExportReachability` |  |  |  |

> 本检查仅拦无意遗漏，不拦有意规避：判据是词法层「生产侧非 import 行是否出现该符号」，无法区分引用与调用——加一行赋值 / 传参式引用（或一行永不调用的 import 之外再补一处引用）即可绕过，属已知且未修复的构造面（F277 FR-012）。
```

### 3.1 处置表（本报告补做，fix-report 未按三支+落点格式完成）

fix-report §5 的原话是「均由 CLI `main` 与测试之外的生产路径消费（脚本自身即入口；处置：非报警）」——**这句话与脚本自己的输出不一致**（脚本判 3 条 ⚠️，不是 0 条），而且「非报警」不属于 `verify.md` Layer 1.85 定义的三支（接线遗漏 / 有意的预留 / 应删除）之一。按规则原文「仅写理由不给落点视为未处置」「任一报警未处置 ⇒ 合并律判不通过（NEEDS FIX）」，fix-report 目前的写法**不构成有效处置**。本报告代为核实并给出落点：

| 符号 | 三支择一 | 落点 | 理由 |
|---|---|---|---|
| `HONESTY_BOUNDARY` | 接线遗漏（强行套用，见下方说明） | `plugins/spec-driver/scripts/export-reachability.mjs:164`（`honestyBoundary: HONESTY_BOUNDARY` 同文件内已用） | 检测器在 `analyzeExportReachability` 的生产侧扫描里显式跳过定义文件自身（`if (f === file) continue;`），导致同文件内的真实使用永远算不到 `productionUseCount`——这不是「未接线」，是**检测器盲区**，三支里没有精确对应的一支 |
| `extractExportedNames` | 接线遗漏（强行套用，理由同上） | `plugins/spec-driver/scripts/export-reachability.mjs:124-125`（`extractExportedNames(removedLines)` / `extractExportedNames(addedLines)`，同文件内已用） | 同上：同文件自引用盲区 |
| `analyzeExportReachability` | 接线遗漏（强行套用，理由同上） | `plugins/spec-driver/scripts/export-reachability.mjs:227`（`main()` 内 `report = analyzeExportReachability(...)`，同文件内已用） | 同上：同文件自引用盲区 |

**这三条不是死代码**（人工读码可确认三者均在 `main()` 控制流里被真实调用/使用），但也不是「接线遗漏」——现有三支分类无法精确描述「检测器因同文件排除逻辑而误报」这一情形。**建议**（供用户/后续任务裁决，本报告不擅自改判据或加分类）：(a) 在 `verify.md` 的三支之外，为「同文件自引用 + 检测器已知盲区」单独开一支处置口径；或 (b) 修正 `analyzeExportReachability` 的生产侧扫描逻辑——同文件排除只应跳过"导出声明所在的那一行"，而不是整份文件。

### 3.2 一个额外发现：`renderMarkdown` / `main` 的「未报警」不是可靠证据（超出既定变异清单，属亲验意外发现）

抽查 `renderMarkdown` 的 6 处「生产使用」与 `main` 的 182 处「生产使用」中的样本：

- `scripts/eval-report.mjs:477`：`export function renderMarkdown(scanned, agg, insights, repeatAggregatesOverride) {` — **另一个同名函数的定义行**，与本次新增的 `renderMarkdown` 毫无关系。
- `plugins/spec-driver/scripts/generate-adoption-insights.mjs:98`：`writeMarkdownArtifact(markdownPath, renderMarkdown(report));` —— 该文件第 374 行自己定义了本地 `function renderMarkdown(report) {`（未 export），且文件顶部导入清单里没有从 `export-reachability.mjs` 导入任何符号；这里调用的是**它自己的本地同名函数**。
- `plugins/spec-driver/scripts/generate-project-context-suggestions.mjs`：同理，532 行自己定义了本地 `renderMarkdown`，与新增导出无关。
- `src/cli/index.ts:149`：`async function main(): Promise<void> {` — CLI 入口自己的 `main`，与新增导出的 `main` 无关。

**结论**：检测器对「生产侧是否出现该符号」的判定是**跨文件、无归属的裸词匹配**（正则 `(^|[^\w$])name(?![\w$])`，不核对该出现处是否真的从定义文件 import 而来）。这意味着：**只要新增的导出名恰好与仓库里任何一个已有的（哪怕完全无关的）标识符重名，检测器就会给出「未报警」的假阴性结论**——而假阴性正是本检查存在的意义所在（F270 `routeNonBlock` 那类死代码，如果改名为一个常见词如 `run`/`main`/`render`/`validate`，会直接绕过检测且不留报警记录）。这是比脚本自带的 `HONESTY_BOUNDARY`（"无法区分引用与调用"）更严重的一类盲区：`HONESTY_BOUNDARY` 承认"看见了但不知道是不是真调用"，而这里是"看见的根本是另一个东西"。建议登记为独立缺口跟进（见 §6）。

## 4. 套件结果（§B）

| 命令 | 结果 |
|---|---|
| `node --test plugins/spec-driver/tests/export-reachability.test.mjs plugins/spec-driver/tests/f286-handoff-contracts.test.mjs` | `tests 16` / `suites 5` / `pass 16` / `fail 0`（非 fix-report 声称的 22；细分：export-reachability.test.mjs 6 个 it，f286-handoff-contracts.test.mjs 10 个 it） |
| `npm run test:plugins`（全插件测试，含上述两个文件） | `tests 1856` / `suites 325` / `pass 1854` / `fail 0` / `skipped 2`；`grep "F286"` 确认 5 个 F286 suite 均在其中且全绿 |
| `npm run repo:check` | 总状态 `status=warn`；**除 1 项外全部 pass**（`agent-docs:*` 15 项、`spec-driver-wrappers:*` 6 项、`spectra-skills:*`、`codex-plugin-consistency:*`、`release-contract:*`、`namespace-consistency:*`、`gate-mounting:effective-config` 等均 pass）；唯一 warn 为 `graph-quality:freshness`（图记录 sourceCommit 与当前 HEAD 不一致），属已知本地图未重建噪声，不计入功能性失败 |

## 5. 变异矩阵（§C）

每项变异：备份 sha256 `73fb9632321b17f6eb0d7961241d17bb5d2853568513a8904eb6ac6ddd410a03` → 改 → 跑 `node --test export-reachability.test.mjs` → 记录 → `cp` 复原 → `diff` 确认逐字节相同（5/5 复原确认通过）。

| # | 变异 | 预期 | 实测结果 | 判定 |
|---|---|---|---|---|
| 1 | `isImportLikeLine` 恒返回 `false`（import 行算使用） | 「死 import 报警」用例红 | `pass 4 / fail 2`：失败用例含「新增导出符号盘点...死 import 报警...」+ 「CLI：md 输出...」 | **守护有效** |
| 2 | `--base` 缺席时默认 `'HEAD'` 而非 exit 2 | CLI 用例红 | `pass 5 / fail 1`：唯一失败 = 「CLI：--base 缺席 → exit 2...」 | **守护有效** |
| 3 | `TEST_PATH` / `TEST_FILE` 正则改为 `/(?!)/`（恒不匹配） | 「仅测试引用报警」用例红 | `pass 5 / fail 1`：失败 = 「新增导出符号盘点...」（`helperOnly.testUseCount` 断言从 1 变 0，因 `testFiles` 列表因判定恒假而变空） | **守护有效**（红的具体原因是 testUseCount 归零，而非 warning 翻转，但确实拦住了这个变异） |
| 4 | md 输出去掉 `HONESTY_BOUNDARY` 行 | 用例红 | `pass 5 / fail 1`：失败 = 「CLI：md 输出含契约块...诚实口径...」 | **守护有效** |
| 5 | 处置表骨架去掉「落点」列（表头/分隔行/数据行均改为 3 列，只留符号+处置+理由） | 用例红 | **`pass 16 / fail 0`，全绿，未捕获** | **守护缺口（已确认，如实登记）** |

### 5.1 变异 5 的根因（守护缺口）

`export-reachability.test.mjs` 对「落点列」的断言是 `assert.match(md.stdout, /落点/);`——纯子串匹配。但 `renderMarkdown` 在报警处置表**标题行**里本就写着「FR-013：每条在三支择一并给可核对**落点**」，这句话与表格列是否存在无关、恒定输出。所以只要标题行不删，删掉表格里真正的「落点」列**不会让这条断言变红**。这是一处真实的测试断言粒度不足（只验证"文中提到落点"，没有验证"表格结构里有落点列"），与任务描述预判的「变异全绿 = 守护缺口」一致，如实登记，不因为"文档里其实有防御性描述"而免于记录。

## 6. Over-claim / 缺口清单

| # | 严重度 | 描述 | 影响 |
|---|---|---|---|
| 1 | **CRITICAL**（按 Layer 1.85 自身规则的字面后果） | fix-report §5 对脚本自查的结论（"均由 CLI main 消费；处置：非报警"）与脚本亲跑输出（3/5 ⚠️）不一致，且用了 Layer 1.85 三支之外的第四类措辞（"非报警"）。按 `verify.md` 新写的规则原文「任一报警未处置 ⇒ 合并律判不通过（NEEDS FIX）」，本卡自己的自查报警未按三支+落点格式处置，**这份改动依据它自己刚写的规则，处于 NEEDS FIX 状态** | 阻断合并，除非补齐处置或修订规则/脚本（见 §3.1 建议） |
| 2 | **CRITICAL** | 可达性检测器的生产侧扫描是无归属裸词匹配，跨文件同名符号会产生假阴性（"未报警"不代表真的被这份新增导出消费）——`HONESTY_BOUNDARY` 只披露了"引用 vs 调用"的盲区，未披露"同名不同符号"这一类盲区，且后者更危险（会让改名为常见词的死代码悄悄通过检测，正是 F270 `routeNonBlock` 想拦的那类问题的一个逃逸构造）| 检测器核心可靠性存疑，尤其是常见命名的新导出 |
| 3 | WARNING | 测试计数不实：fix-report §5 声称 `22/0`，tasks.md T006 声称 `f286-handoff-contracts.test.mjs 16/16`；亲跑实测总计 `16/0`（该文件单独为 10 个 it） | 不影响功能，但与仓库历史多次登记的"数字产物必配重算器"教训相同模式再犯 |
| 4 | WARNING | 变异 5（处置表去掉"落点"列）未被任何现有断言捕获，`export-reachability.test.mjs` 对表格结构的验证退化成对自由文本子串的验证 | 若未来有人误删表格列，测试不会报警 |
| 5 | INFO（流程状态，非本次亲验发现） | `tasks.md` T009（对抗复审，独立子代理两个切入角）仍未勾选，`fix-report.md` §6 仍写「（待填）」——按 plan.md 的审查档位约定，这是本卡合并前的必做项，目前处于未完成状态 | 本报告范围内不影响，但整体合并就绪度依赖它 |

## 7. 首轮结论

**NEEDS FIX**

阻断项（需在合并前处理，按优先级排序）：

1. 补齐 fix-report §5 的 Layer 1.85 自查处置：把 `HONESTY_BOUNDARY` / `extractExportedNames` / `analyzeExportReachability` 三条报警按三支格式给出正式处置 + 落点（本报告 §3.1 已代为核实底层事实，供决策参考），或者——如果结论是"三支分类本身需要补第四支"——把这个判断报给用户拍板并同步改 `verify.md`（不应由实现或验证阶段自行悄悄新增分类）。
2. 评估 §3.2 提出的「跨文件同名假阴性」缺口：是否需要在本卡内收紧（例如：生产侧匹配前先确认该文件确有 `import ... from '<定义文件>'` 或就是同一文件），还是登记为已知限制追加进 `HONESTY_BOUNDARY` 文案，或分流到后续 Fix。三条路都可以接受，但目前"未提及、未选择"这个状态不行。
3. 修正 fix-report.md §5 与 tasks.md T006 的测试计数（`22/0`→`16/0`；`f286-handoff-contracts.test.mjs 16/16`→`10/10`）。
4. 视情况加固变异 5 暴露的断言粒度（例如改用 `/\|\s*落点/` 或直接断言表头整行字符串），使其能捕获"少一列"的回归；或如实登记为已知覆盖缺口不修（需说明理由）。
5. T009 对抗复审仍需按 plan.md 约定完成（不在本报告范围内，但是合并前置条件）。

非阻断但建议记录：four SKILL 的差异化处理（feature 无显式派发块）经核实是设计一致而非遗漏，无需改动。

## 8. 首轮工具使用反馈（dogfooding）

- **MCP 是否可用**：本次验证任务未使用 Spectra MCP 工具（`mcp__plugin_spectra_spectra__*` / `mcp__spectra__*`）。原因：改动面是 prompt 文档 + 一个自包含的纯词法脚本 + 两个独立单测文件，验证方法是逐条 grep 核对文本、直接跑脚本 CLI、跑测试套件与做源码级变异实验——这些都不需要跨文件依赖图或 symbol 级 impact 分析，Grep + 直接执行就是更直接的证据来源。`npm run repo:check` 仍报告本地图 `sourceCommit` 与 HEAD 不一致（stale），与其他 F28x 报告记录的已知噪声一致，未重建（不在本任务范围内）。
- **返回信息是否够用**：不适用（未调用）。
- **流程是否顺畅**：Spec Driver 制品链路（fix-report / plan / tasks / verification 目录预建）本身顺畅，无卡点。唯一的流程性观察是 §6 #5：T009 与 T010 在 tasks.md 里是并列的两个未完成项，但本次派发只要求完成 T010，导致验证在对抗复审之前发生——这不是工具缺陷，是编排顺序的选择，如实记录供后续参考。
- **结果准确性**：本次验证过程本身就是针对"结果准确性"的检查（export-reachability.mjs 的可达性判定），发现的两类问题（§3.1 同文件自引用盲区、§3.2 跨文件同名假阴性）已经是本报告的主体内容，不重复记录于此。

---

# 复核（2026-09-13，同日二次派发）

协调者转述：F286 已按首轮 NEEDS FIX 与对抗复审（角 A 脚本判据 2C/5W/6I、角 B prompt 合同 2C/5W/6I）修复。本节是**独立重新亲跑**的复核，不采信协调者转述或 fix-report/tasks.md 的自报数字，逐条用命令重新核实；也不采信首轮报告的具体数字（如 sha256、行号）——脚本已整份重写，首轮的行号引用对本轮不再适用。

## 9. 复核范围与改动量核对

`git status --short` 对比首轮：新增 3 个已跟踪文件的改动（`.specify/templates/verification-report-template.md`、`plugins/spec-driver/agents/quality-review.md`、`plugins/spec-driver/agents/quality-review.artifact.yaml`），脚本从 238 行重写为 397 行，两个测试文件从 120+82 行重写为 239+138 行——与协调者转述的改动清单一致（quality-review 对称化、`.specify/templates/` 同步、脚本判据收紧）。

## 10. 声称核对表（复核 §A，逐条重新亲跑）

| # | 声称（来源） | 判定 | 证据 |
|---|---|---|---|
| 1 | 判据收紧为"合格使用行 = 定义文件自身非声明/非注释/非import行，或 import 了定义文件的生产文件里同类行"（fix-report §2a） | **证实** | 读代码 `countUses`/`importsDefiningFile`/`isDeclaration` 三函数逐行核对；见 §12 F270 探针与 §13 变异矩阵的行为级证据 |
| 2 | `classifyLines` 覆盖多行 import 块 / re-export 块 / `module.exports = {…}` 块 / require / 动态 import → import 类；整行注释 / 块注释 → comment（§2a） | **证实** | 亲跑单测 `classifyLines：多行 import 块整块记 import...` PASS；对拍代码逻辑（`inImportBlock` 状态机、块注释 `inBlockComment` 状态机）与断言的 `kinds` 数组逐项吻合 |
| 3 | `extractExportedNames` 覆盖解构 / 多行导出列表 / `const enum` / 装饰器与块注释前缀 / 同行多语句 / CJS，再导出与 `export default` 别名不盘点（§2a） | **证实** | 亲跑单测「声明式 / 解构 / 多行列表 / const enum...」PASS，17 个符号名逐一核对与源码 16 行输入逐条对应 |
| 4 | `--base` 按 `git merge-base <ref> HEAD` 解析；解析后 == HEAD 且树干净 ⇒ exit 2，`--allow-head` 放行，树脏只 WARN（§2a） | **证实** | 亲跑：干净仓库 `--base HEAD` → exit 2 + `/等于 HEAD/`；同仓库加 `--allow-head` → exit 0；本 worktree（树脏）`--base 9362f1a8` → exit 0 且契约块含 `⚠️ 基线解析后等于 HEAD`（见 §12 完整输出） |
| 5 | `--fail-on-warning`、`--base`/`--format` 缺值 fail-loud、已删除文件单列、`--scope` 无尾斜杠归一化（§2a） | **证实**（前三项亲跑；deletedFiles 逻辑读码确认正确但**无专门单测**，见 §16 缺口） | 亲跑 `--base --format json`（`--base` 缺值）→ exit 2 `/--base 缺值/`；`--fail-on-warning` 有报警 → exit 1；`--format yaml` → exit 2；scope `['src']` 归一化为 `['src/']`（单测直接断言） |
| 6 | `verify.md`：适用范围首句 / baseRef 唯一来源=evidence-pack 首行 / 禁自行现推与默认 HEAD / 三支+落点 / 未处置 NEEDS FIX / 固定口径；无削弱词（§2b） | **证实**；且**削弱可被侦测**（见 §14） | `sed -n` 通读 Layer 1.85 全段逐句核对；§14 的安全复现实验证明 WEAKENERS 检测确实生效，非仅声称 |
| 7 | `verify.md` Layer 1.86：先读 `red-first-evidence.md`、禁快照、同时刻 A/B、替代证明（§2b） | **证实** | 通读原文逐句核对 |
| 8 | 合并律映射表 +4 行（11–14）、换算式 10→14；报告结构/返回摘要含 1.85（§2b） | **证实** | `grep -n` 命中第 550、564-567 行；换算式字面为"Layer 1.85 四取值 4 = **14**" |
| 9 | `verify.artifact.yaml` 两可选章节 + 注释如实"无校验器消费"（§2b） | **证实** | 读文件全文，注释原文即"无校验器消费本合同（纯登记，对抗复审 B-W1）" |
| 10 | 两份模板（插件 `templates/` 与项目级 `.specify/templates/`）同步含 Layer 1.85/1.86 槽位且逐字节相同（B-C2，§2f） | **证实** | `diff` 两文件 → 无输出（相同）；`grep` 确认槽位存在 |
| 11 | `spec-review.md` + `quality-review.md` 对称：tools 加 Write，仅限各自 `verification/*-report.md`；artifact `output_path` 真实路径（§2c） | **证实** | 两份 frontmatter 均含 `Write`（quality-review 额外保留 `Bash`，符合其"需要实测证据"的既有定位）；两份正文分别限定 `spec-review-report.md` / `quality-review-report.md`；两份 artifact `output_path` 均为真实路径 |
| 12 | `implement.md`：RED 级取证 append 到**独立** `red-first-evidence.md`（append-only），与覆盖写的 `implementation-notes.md` 分离（B-W3，§2d） | **证实** | 原文含"与下文**覆盖**写入的 `implementation-notes.md` 分离——对抗复审 B-W3"字样，路径确为 `{feature_dir}/verification/red-first-evidence.md` |
| 13 | 四个 SKILL：前置段含 `baseRef: $(git merge-base origin/master HEAD)` 首行、不开 Bash 白名单、返回处理（`test -f` 两份报告 + `git status --porcelain` 越界判定）（B-W4，§2e） | **证实** | 4/4 SKILL 逐条 grep 命中；story/implement/fix 的 spec-review 与 verify 两个派发块均含 `evidence-pack.md` 路径注入；前置段位置早于派发 `Task(` 行（行号核对） |
| 14 | 账本 4 处「F286 已落地」标注仍在且未被误改（T008） | **证实** | 行号与首轮相同（41/49/97/106），内容未变 |
| 15 | wrapper SHA 三副本同步（skills-codex / .codex/skills / canonical）（§4） | **证实** | `validate-wrapper-sources.mjs` → `status=pass`（6 项全 pass） |
| 16 | fix-report §5：脚本自查「新增导出 7 个符号...生产使用行分别 1/3/1/5/4/1/1...报警 0 条」 | **证实**（与首轮相反的结论——见 §12，本轮判据下确实是真实的同文件使用，非首轮那种跨文件同名假阴性） | 亲跑 `--base 9362f1a8` 完整输出（§12）：七符号使用行数逐一为 1/3/1/5/4/1/1，报警 0 条，与 fix-report 字面一致；且抽查全部 use site 均落在 `export-reachability.mjs` 自身文件内的真实调用行，非跨文件同名碰撞 |
| 17 | fix-report §5：`node --test ... → 10 + 13 = 23/0` | **证实** | 亲跑：`ℹ tests 23 / pass 23 / fail 0` |
| 18 | tasks.md T006：两文件各 10/10、13/13 | **证实** | 亲跑分别确认（export-reachability.test.mjs 单独跑 `tests 10 pass 10`；组合跑总数 23，减 10 得 13） |
| 19 | `npm run test:plugins` 全绿、`repo:check` 仅已知 stale-graph 噪声 | **证实** | `tests 1863 / pass 1861 / fail 0 / skipped 2`（较首轮 1856 增 7，与两文件净增 7 个用例一致）；`repo:check` 除 `graph-quality:freshness` 外全 pass，含新增的 `namespace-consistency:agent-frontmatter-quality-review: pass` |

## 11. Over-claim 复核：首轮 5 项阻断是否真正解决

| 首轮阻断项 | 复核结论 | 证据 |
|---|---|---|
| #1 自查 3 条报警未按三支处置、用了非法的"非报警"类别 | **已解决** | 本轮自查报警 0 条（§12），不存在"需要处置但未处置"的报警，问题从根上消失（不是把「非报警」改成合法措辞，而是判据本身改对了，3 条从「假阳性」变回「本来就不该报警」） |
| #2 跨文件同名假阴性（`renderMarkdown`/`main` 被无关同名函数洗白） | **已解决** | `importsDefiningFile` 收紧为"必须真 import 定义文件"；本轮自查 `renderMarkdown`=1、`main`=1（均为脚本自身 `main()` 内对自己的调用），不再是跨文件碰撞的 6/182；§12 逐点核对 use site 全部落在自身文件内；§13 F270 探针进一步验证收紧后**未同时引入新的漏判**（见下） |
| #3 测试计数不实（22/16 实为 16/10） | **已解决** | 本轮 fix-report/tasks.md 的 23/10/13 均与亲跑一致（§10 #17 #18） |
| #4 变异 5（去掉「落点」列）测试全绿未捕获 | **已解决** | 本轮同一变异重跑 → 明确变红（§13 B5）；断言已从"子串含落点"改为"逐字比对整行表头字符串" |
| #5 T009 对抗复审未完成 | **已解决** | `tasks.md` T009 已勾选 `[x]`，`fix-report.md` §6 有完整的角 A（2C/5W/6I）与角 B（2C/5W/6I）发现-处置对照表，且其条目（A-C1 多行 import 块、A-C2 同名不 import、A-W2 自身文件盲区、A-W5 基线==HEAD、B-W5 测试计数与落点列）与本报告首轮**独立发现的问题高度重合**——这是"确有其事的对抗复审"的强旁证，而非套话 |

## 12. Layer 1.85 自查（复核：完整原始输出）

亲跑命令：`node plugins/spec-driver/scripts/export-reachability.mjs --project-root . --base 9362f1a8`（工作树处于 F286 改动中途，脏；默认 scope）。

```
## Layer 1.85: 导出符号生产可达性（F277 FR-010~013 · 词法）

### 契约字段
- baseRef: `9362f1a8`（解析 `9362f1a82c7e70fce288d3363f548ffb75f7e9bc`；merge-base `9362f1a82c7e70fce288d3363f548ffb75f7e9bc`；HEAD `9362f1a82c7e70fce288d3363f548ffb75f7e9bc`）
- scope: `src/`, `plugins/spec-driver/scripts/`, `scripts/`
- compareCommands:
  - `git merge-base 9362f1a8 HEAD  # => 9362f1a82c7e70fce288d3363f548ffb75f7e9bc`
  - `git diff --name-only 9362f1a82c7e70fce288d3363f548ffb75f7e9bc`
  - `git ls-files --others --exclude-standard`
  - `(untracked) cat plugins/spec-driver/scripts/export-reachability.mjs`
- ⚠️ 基线解析后等于 HEAD：只盘点未提交 / 未跟踪改动（已提交的改动全部落在基线内）

### 新增导出符号
| 符号 | 定义文件 | 生产使用行 | 生产 import 行 | 测试使用行 | 使用点（≤10） | 报警 |
|---|---|---|---|---|---|---|
| `HONESTY_BOUNDARY` | plugins/spec-driver/scripts/export-reachability.mjs | 1 | 0 | 4 | export-reachability.mjs:308 | — |
| `extractExportedNames` | plugins/spec-driver/scripts/export-reachability.mjs | 3 | 0 | 2 | export-reachability.mjs:219/228/229 | — |
| `classifyLines` | plugins/spec-driver/scripts/export-reachability.mjs | 1 | 0 | 3 | export-reachability.mjs:240 | — |
| `BaseRefError` | plugins/spec-driver/scripts/export-reachability.mjs | 5 | 0 | 0 | export-reachability.mjs:167/177/185/202/389 | — |
| `analyzeExportReachability` | plugins/spec-driver/scripts/export-reachability.mjs | 4 | 0 | 6 | export-reachability.mjs:177/185/202/386 | — |
| `renderMarkdown` | plugins/spec-driver/scripts/export-reachability.mjs | 1 | 0 | 1 | export-reachability.mjs:391 | — |
| `main` | plugins/spec-driver/scripts/export-reachability.mjs | 1 | 0 | 0 | export-reachability.mjs:396 | — |

### 报警处置表 — 报警 0 条
| 符号 | 处置 | 落点 | 理由 |
|---|---|---|---|
| （无报警） | — | — | — |
```

（完整使用点路径已在上表精简为文件:行号列表，原始命令输出逐字与此一致，`--format json` 交叉核对字段值相同。）

**与 fix-report §5 逐字比对**：声称"生产使用行分别 1 / 3 / 1 / 5 / 4 / 1 / 1...报警 0 条"——亲跑结果 1/3/1/5/4/1/1，报警 0，**完全一致**。exit code = 0（非 2），符合"树脏只 WARN"的设计（本 worktree 有未提交改动）。

**这份"0 报警"与首轮"3 报警"的差异不是脚本变宽松了，而是判据变准了**：首轮的检测器排除整个定义文件（导致 `HONESTY_BOUNDARY` 等 3 个同文件内真使用的符号被误判为无使用），本轮改为只排除声明行本身、扫描该文件其余部分——上表的 use site（如 `export-reachability.mjs:308` 是 `renderMarkdown` 里 `> ${report.honestyBoundary}` 那行）逐一核对均为真实调用/引用，不是声明行重复计数。

## 13. 变异矩阵（复核：针对重写后的判据）

每项变异：备份 sha256 `c1841de75d0946233e6acbf253f60551ba9c1100c657f9ed729b6cbd10c63374` → 改（用一次性 Node 脚本做精确字符串替换，非 sed 正则）→ 跑 `node --test export-reachability.test.mjs` → 记录 → `cp` 复原 → `diff` 确认逐字节相同（5/5 全部复原确认通过，含最后再跑一次全量 23 测试确认 0 残留）。

| # | 变异 | 预期 | 实测结果 | 判定 |
|---|---|---|---|---|
| B1 | `classifyLines` 里 `if (inImportBlock)` 改 `if (false)`（多行 import 续行不再归 import） | 「多行死 import」相关用例红 | `pass 7 / fail 3`：`classifyLines` 单测本身、判据大用例（`deadMultiImport` 断言）、CLI md 输出用例全部红 | **守护有效** |
| B2 | `importsDefiningFile` 恒 `return true`（同名不再要求真 import） | 「同名不 import」用例红 | `pass 8 / fail 2`：判据大用例（`collideOnly` 断言）+ CLI md 输出（warnings 名单变化）红 | **守护有效** |
| B3 | `isDeclaration` 恒 `return false`（声明行不再被排除，等于自己给自己"用过"） | 大量应报警用例翻绿 → 红 | `pass 8 / fail 2`：判据大用例 + CLI md 输出红（`helperOnly`/`deadOnly`/`Color` 等本应报警的符号因声明行被误计为使用而全部翻绿，断言炸裂） | **守护有效** |
| B4 | 基线 == HEAD 且树干净时的 `throw new BaseRefError` 分支加 `if (false && ...)` 短路，永不抛错 | CLI「基线==HEAD」用例红 | `pass 9 / fail 1`：唯一失败正是该 CLI 用例（`clean.status` 从 2 变 0） | **守护有效** |
| B5 | `renderMarkdown` 处置表表头/分隔行/数据行去掉「落点」列（3 列） | 用例红（首轮同一变异曾全绿未捕获） | `pass 22 / fail 1`（23 测试全量跑）：CLI md 输出用例红——`assert.ok(md.stdout.includes('| 符号 | 处置...| 落点...| 理由 |'))` 逐字比对整行失败 | **守护有效（首轮缺口已修复，本轮重验通过）** |

### 13.1 关键新增验证：F270 `routeNonBlock` 形态在判据收紧后是否仍被拦

首轮发现的 A-W2（同文件自引用盲区）修法是"允许定义文件自身的非声明行计入生产使用"——这天然带来一个必须验证的风险：**会不会把"文件里随便哪行提到这个名字"都算成合法使用，从而让真正的死代码也蒙混过关？**

用独立 scratch 仓库（不在本 worktree 内，脚本执行完即删除）直接调用本次真实的 `analyzeExportReachability`：构造 `src/routes.ts` 内 `export function routeNonBlock(req, res) { return dispatch(req) && res; }`——函数体不提及自己的名字、生产侧任何文件都不导入这个符号（另一个生产文件 `server.ts` 确实 import 了同一个 `routes.ts`，但只用了另一个导出 `otherHandler`，从不提 `routeNonBlock`），只有测试文件调用它。亲跑结果：

```json
"routeNonBlock": { "productionUseCount": 0, "testUseCount": 1, "warning": true }
"otherHandler":   { "productionUseCount": 1, "testUseCount": 0, "warning": false }
```

**`routeNonBlock.warning === true`——F270 那类"生产零接线、单测全绿"的死代码，在本轮收紧后的判据下依然被正确拦截**；同时 `otherHandler`（确有生产调用）正确不报警，且"生产文件 import 了同一模块的其它符号"不会连带洗白 `routeNonBlock`——证明 A-C2 的收紧是精确的（按符号名而非按模块导入关系笼统放行），而不是把首轮的漏洞换了个位置重新打开。这是本轮复核里唯一一项超出协调者给定清单、但认为**必须做**的验证（判据收紧类改动如果不反向验证"核心场景仍被拦住"，容易顾此失彼）。

## 14. B-W5 削弱抽查（安全改法说明 + 结果）

协调者原始指令是编辑已跟踪的 `verify.md` 后用 `git checkout -- plugins/spec-driver/agents/verify.md` 复原。**未按字面执行**：`verify.md` 对 HEAD（`9362f1a8`）有 42 行插入 / 2 行删除的**未提交**改动（`git diff --stat` 已先行记录），`git checkout --` 会把该文件整份回退到 HEAD 版本，等于**清空 F286 对 verify.md 的全部真实改动**，而不是只撤销本次探针编辑——这与协调者同一条消息里重申的硬规则"禁 git 写操作 / 已跟踪文件不动"直接冲突。改用等价但无风险的办法：`cp` 备份原文件 → 编辑 → 跑测试 → `cp` 复原 → `diff` 逐字节核对 → 复核 `git diff --stat` 与编辑前记录的完全一致（`1 file changed, 42 insertions(+), 2 deletions(-)`，前后逐字相同）。验证目标达成，且未使用任何 git 写操作。

- 编辑：把 Layer 1.85 段落里的「**禁止自行现推、禁止默认为 `HEAD`**」改成「建议不要默认为 HEAD」。
- 结果：`node --test f286-handoff-contracts.test.mjs` → `pass 12 / fail 1`，唯一失败为"Layer 1.85：适用范围首句...无削弱词"——同时命中两条独立断言（`WEAKENERS` 正则捕获"建议"一词；且逐字断言 `l185.includes('**禁止自行现推、禁止默认为 \`HEAD\`**')` 直接失败）。
- 复原：`cp` 换回备份，sha256 前后一致，`git diff --stat` 前后一致。

**结论**：B-W5 的"削弱词检测"守护确实生效，不是纸面声称。

## 15. 套件结果汇总（复核）

| 命令 | 结果 |
|---|---|
| `node --test export-reachability.test.mjs f286-handoff-contracts.test.mjs` | `tests 23 / suites 7 / pass 23 / fail 0` |
| `npm run test:plugins` | `tests 1863 / suites 327 / pass 1861 / fail 0 / skipped 2`（较首轮 +7，与两文件净增用例数一致） |
| `npm run repo:check` | `status=warn`，唯一 warn 仍是 `graph-quality:freshness`（本地图未重建，已知噪声）；其余含新增的 `namespace-consistency:agent-frontmatter-quality-review` 均 pass |
| `validate-wrapper-sources.mjs` | `status=pass`（6/6） |
| 两份 `verification-report-template.md`（插件 / `.specify/`） | `diff` 无输出，逐字节相同 |

## 16. 复核阶段新发现的非阻断缺口

| # | 严重度 | 描述 |
|---|---|---|
| 1 | INFO | `deletedFiles`（已删除文件单列不进候选）这一新增能力在 `export-reachability.test.mjs` 里**没有专门的单元测试**钉住；读码确认逻辑本身正确（`deletedFiles = scopedChanged.filter(f => !fs.existsSync(...))`，`candidates` 排除它们），但缺回归测试意味着未来重构可能悄悄破坏这条而不被发现。建议后续补一条最小用例（改动含一个已删除文件）。 |
| 2 | INFO | `TEST_PATH` 仍不识别 `e2e/`/`spec/`/`bench/` 目录——fix-report §3 已如实登记为已知限制，本仓当前 scope 内没有这类目录，不构成现实风险，仅记录以防未来目录结构变化。 |

以上均不构成合并阻断，性质是"建议补强"而非"发现缺陷"。

## 17. 复核工具使用反馈（dogfooding）

- **MCP 是否可用**：仍未使用 Spectra MCP——本轮验证对象依旧是 prompt 文档 + 一个自包含脚本 + 两个独立单测文件，逐条 grep/读码/亲跑/变异实验是更直接的证据来源，跨文件依赖图或 impact 分析在此类改动上不增加信息量。`repo:check` 的 `graph-quality:freshness` 告警依旧（本地图未重建），与本次改动无关。
- **返回信息是否够用**：不适用（未调用）。
- **流程是否顺畅**：两轮 verify 之间的交接顺畅——协调者的改动清单与我独立读到的 diff 完全对得上，没有"清单说改了但代码没改"或反之的情况。唯一的流程摩擦是 B-W5 步骤的字面指令与同消息内重申的硬规则冲突（见 §14），已用等价安全方法解决并在此报告说明，不影响验证结论。
- **结果准确性**：本轮复核的核心发现——判据收紧后 F270 场景仍被拦截（§13.1）——依赖我自建的 scratch 仓库对真实模块直接调用验证，而非仅读单测断言；这类"对判据本身做反向探针"的验证方式建议固化进未来同类检查的 verify 流程，而不只是跑现成测试。

---

# 终结论

**PASS**

首轮 5 项阻断（自查处置无效且用非法类别 / 跨文件同名假阴性 / 测试计数不实 / 落点列变异守护缺口 / T009 未完成）经复核**全部证实已解决**，且解决方式经得起独立重新亲跑：判据收紧后 Layer 1.85 自查报警 0 条与 fix-report 字面一致（§12）；跨文件同名假阴性的修复（`importsDefiningFile`）在独立构造的 F270 `routeNonBlock` 探针下验证有效且未反向打开新漏洞（§13.1）；测试计数 23/10/13 与亲跑一致（§10）；「落点」列变异本轮明确变红（§13 B5）；T009 的对抗复审记录与本报告首轮独立发现高度重合，具备真实性佐证（§11）。复核阶段另发现两项 INFO 级非阻断缺口（`deletedFiles` 缺专项测试、`TEST_PATH` 目录覆盖面已知限制），均已如实登记，不影响本次合并判断。

`git status --short`（复核结束，确认脚本与 verify.md 均已逐字节复原、无残留变异）：

```
 M .codex/skills/spec-driver-feature/SKILL.md
 M .codex/skills/spec-driver-fix/SKILL.md
 M .codex/skills/spec-driver-implement/SKILL.md
 M .codex/skills/spec-driver-story/SKILL.md
 M .specify/templates/verification-report-template.md
 M docs/design/dogfooding-feedback-ledger.md
 M plugins/spec-driver/agents/implement.md
 M plugins/spec-driver/agents/quality-review.artifact.yaml
 M plugins/spec-driver/agents/quality-review.md
 M plugins/spec-driver/agents/spec-review.artifact.yaml
 M plugins/spec-driver/agents/spec-review.md
 M plugins/spec-driver/agents/verify.artifact.yaml
 M plugins/spec-driver/agents/verify.md
 M plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md
 M plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md
 M plugins/spec-driver/skills-codex/spec-driver-implement/SKILL.md
 M plugins/spec-driver/skills-codex/spec-driver-story/SKILL.md
 M plugins/spec-driver/skills/spec-driver-feature/SKILL.md
 M plugins/spec-driver/skills/spec-driver-fix/SKILL.md
 M plugins/spec-driver/skills/spec-driver-implement/SKILL.md
 M plugins/spec-driver/skills/spec-driver-story/SKILL.md
 M plugins/spec-driver/templates/verification-report-template.md
?? plugins/spec-driver/scripts/export-reachability.mjs
?? plugins/spec-driver/tests/export-reachability.test.mjs
?? plugins/spec-driver/tests/f286-handoff-contracts.test.mjs
?? specs/286-p1k-handoff-reachability/
```

**后续建议（非阻断，供 T011/T012 参考）**：T011 门禁跑批（build / vitest / test:plugins / repo:check / release:check）与 T012 交付时，可顺带把 §16 的两项 INFO 级建议（deletedFiles 补测试）纳入下一张后续卡，不必阻塞本次交付。
