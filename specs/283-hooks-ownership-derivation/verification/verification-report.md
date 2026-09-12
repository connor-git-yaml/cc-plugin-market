# F283 独立验证报告

## 1. 元信息

- HEAD：`a5def60148b59c863c18574afa701e42d085502f`（分支 `283-hooks-ownership-derivation`，已 rebase 到 `origin/master 1112e18a`）
- 日期：2026-09-13
- 执行者：verify 子代理（sonnet），全程只在指定 worktree 内操作
- 方法：不预设制品声称成立，逐条用亲跑命令 / 亲写探针脚本 / `git show <sha>:<path>` 考古复核；变异实验全部 sed/python 改后跑测试即刻 `git checkout --` 复原并 `git status --short` 确认干净

结论先行：**PASS**（细节见 §6）。核心机制（归属表派生、generator 准入闸、`DELEGATION_TOOL_NAMES` 单源、`parseRenameOperands` 矩阵回归钉）均被独立执行的测试与变异实验证实为真实、有效的防线；发现的问题都是数字口径类的轻微出入，不构成功能或安全缺陷。

## 2. 声称核对表（§A 逐条）

| # | 声称 | 判定 | 证据 |
|---|---|---|---|
| A1 | `OWNED_HOOK_SCRIPT_SUFFIXES` 由 `OWNED_HOOK_EXPECTED_EVENT` 键派生（`deriveOwnedSuffixes`），登记点唯一 | **证实** | `codex-hooks-schema.mjs:160`：`export const OWNED_HOOK_SCRIPT_SUFFIXES = deriveOwnedSuffixes(Object.keys(OWNED_HOOK_EXPECTED_EVENT));`；`grep -rn "new Set(\['Agent'"` 及全文搜索未发现第二份手写后缀表残留 |
| A2 | 畸形键（三段/一段/空段）模块加载即抛 | **证实** | `deriveOwnedSuffixes` 在两段非空校验失败时 `throw`，且在模块顶层被同步调用（第 160 行），故 `OWNED_HOOK_EXPECTED_EVENT` 若含畸形键会在 import 求值时直接抛出；vitest 用例 `schema.deriveOwnedSuffixes(['hooks/sub/three-seg.sh'\|'one-seg.sh'\|'hooks/'])` 三种畸形形态均 `.toThrow(/两段非空/)`，亲跑通过。另外用 `git show a5def601^:...codex-hooks-schema.mjs` 核实：**改动前**手写表与派生源的 6 项逐项、逐序相同——本项是防未来漂移的架构加固，改动前并无实际漂移（印证 fix-report 该表述属实） |
| A3 | generator 准入闸 `isOwnedExecutableEntry(expanded)`，判据落在 `expand()` 之后的产物上 | **证实** | 源码 `codex-hooks-generator.mjs`：`const expanded = expand(handler.command); if (!isOwnedExecutableEntry(expanded)) throw ...`；亲写探针（构造 `${CLAUDE_PLUGIN_ROOT}/hooks/never-registered.sh` 挂到 Stop 下）调用 `generateCodexHooks` 确认抛出 `未登记脚本 (...)` 且文案指向 `OWNED_HOOK_EXPECTED_EVENT`；`git show a5def601^:...codex-hooks-generator.mjs` 全文 grep `isOwnedExecutableEntry`/`未登记脚本` 均零命中，证实改动前该守卫**完全不存在**（红先行成立） |
| A4 | `validate --canonical-source`：产品事件下未登记 handler 判 `canonical-unregistered-script` fail；非产品事件沿用 F264 契约不参与 handler 级判据 | **证实**（两方向均亲测隔离验证） | 用与真实 CLI 一致的选项（`validate-codex-hooks.mjs:363` 的 `checkCommandShape: !args.skipShape && !args.canonicalSource` ⇒ `--canonical-source` 下为 `false`）跑 `validateCodexHooksDocument`：干净 canonical → `ok=true`（仅 claude-only-event 警告）；Stop（产品事件）挂未登记脚本 → `ok=false`，`findings` 含 `{level:fail, code:'canonical-unregistered-script', event:'Stop'}`；PermissionRequest（非产品事件）挂同一未登记脚本 → `ok=true`，无该 code。三态互相印证，判据方向正确 |
| A5 | `delegation-tool-names.mjs` 真不可变（add/delete/clear 抛错） | **证实** | 直接 `node` 探针：`add('X')`/`delete('Agent')`/`clear()` 三者均抛 `TypeError`，内容在尝试后仍为 `['Agent','Task']`；`Object.isFrozen` 为 `true` |
| A6 | core / ledger-writer import 单源模块；ledger-reader 转发导出（非本地重建） | **证实** | diff 显示三文件均新增 `import { DELEGATION_TOOL_NAMES } from './delegation-tool-names.mjs'`，且 core/writer 删除各自的 `new Set([...])` 字面量；ledger-reader 改为 `export { DELEGATION_TOOL_NAMES };`（同一绑定的转发，非重建）；`f283-delegation-single-source.test.mjs` 的 `assert.equal(READER_NAMES, DELEGATION_TOOL_NAMES)`（对象恒等，非值相等）亲跑通过 |
| A7 | `JUDGE_FILE_SET`：10→11，三处钉数量测试改派生 | **证实** | `judge-snapshot-core.mjs` 实际列出 11 条路径（含新增的 `scripts/lib/delegation-tool-names.mjs`）；`judge-snapshot-core.test.mjs`/`judge-snapshot-doctor-cli.test.mjs` 三处硬编码的 "9 unchanged" 已改为 `${JUDGE_FILE_SET.length - 1}` 派生式，不再是脆弱字面量 |
| A8 | (c) `parseRenameOperands` 单元合同矩阵 23 行，且仅 4 行经 `scanRenameCommandEvents` 在生产入口可达 | **部分证伪**（行数正确，可达行数计算有出入） | 见 §5 详细分析：数组长度机械核实为 **23**（与 fix-report 一致），但真正驱动生产入口 `scanRenameCommandEvents(input.command)`（`fix-compliance-core.mjs:1535` 唯一调用点）逐行喂入 23 组输入实测可达 **5 行**，非 4 行——低算的是 `'- b'`（单字符 `-` 作为操作数）这一行。且测试文件自身 `describe` 标题写"22 行"，与同文件 `it` 标题"23 行"及数组真实长度自相矛盾 |
| A9 | commit message：hooks 7 套件 253/253 | **证实**（枚举后精确吻合） | 制品未列出具体是哪 7 个文件；通过枚举全仓 `codex-hooks*`/hook 相关 vitest 套件并求和反推，确认为 `codex-hooks-generator`(13) + `codex-hooks-ownership-derivation`(16) + `codex-hooks-event-gate`(25) + `codex-plugin-registration`(51) + `codex-hooks-installer`(54) + `codex-hooks-list-probe`(34) + `codex-hooks-install-flow`(60, integration) = **253**，亲跑 253/253 全绿，与声称精确一致 |

## 3. 套件亲跑结果（§B）

| 套件 | 结果 |
|---|---|
| `node --test plugins/spec-driver/tests/f283-delegation-single-source.test.mjs` | 5 pass / 0 fail |
| `node --test .../judge-snapshot-core.test.mjs` | 30 pass / 0 fail |
| `node --test .../judge-snapshot-doctor-cli.test.mjs` | 39 pass / 0 fail |
| `node --test .../judge-snapshot-doctor.test.mjs` | 17 pass / 0 fail |
| `node --test .../judge-snapshot-io.test.mjs` | 31 pass / 0 fail |
| `node --test .../ledger-reader.test.mjs` | 22 pass / 0 fail |
| `node --test .../ledger-writer.test.mjs` | 23 pass / 0 fail |
| `npm run test:plugins`（全插件 node:test） | **1844 pass / 0 fail**（1846 total，2 skipped）—— 与 commit message 声称精确一致 |
| `npx vitest run tests/unit/codex-hooks-ownership-derivation.test.ts` | **16 pass / 0 fail** —— fix-report §3 称改动后"8/8 绿"，实测为 16/16（该文件在 T006b 对抗复审响应轮新增多条 W-1/W-2/I-2 用例后，§3 计数未同步更新；方向有利，覆盖比声称更多，但数字本身不准） |
| 上述 7 个 hooks 相关 vitest 套件合计 | **253 pass / 0 fail**（见 A9） |

标记文件 `f283-gate.done` 在本次验证开始前已存在（并发全量 vitest 门禁已完成），故未触发 §C 的等待分支，`git status --short` 在 vitest 运行前后均为空。

## 4. 变异矩阵（§C）

| # | 变异 | 期望 | 实际变红 | 判定 |
|---|---|---|---|---|
| 1 | generator 里 `if (!isOwnedExecutableEntry(expanded))` 改为 `if (false && !isOwnedExecutableEntry(expanded))`（准入闸恒不触发） | ownership-derivation vitest 多条用例变红 | `codex-hooks-ownership-derivation.test.ts`：**6 fail / 10 pass**（恰好是插入未登记脚本的 3 个位置 it.each + 第三方形态 + W-1 判据方向 + W-1 分发链引号形态 6 条，其余 10 条与该守卫无关的用例照常绿） | 防线有效，命中面精确 |
| 2 | `OWNED_HOOK_SCRIPT_SUFFIXES` 改回手写数组且漏掉 `hooks/stop-fix-compliance-check.sh` | 有守护 | 4 个 vitest 文件合计 **56 fail / 52 pass（108 条）**：`ownership-derivation`、`codex-hooks-event-gate`、`codex-hooks-generator`、`codex-hooks-installer` 全部大面积变红 | 防线极强，检测面远超单文件预期 |
| 3 | `fix-compliance-core.mjs:298`（`parseRenameOperands` 内部）`operands.length !== 2` 改为 `< 2` | `f283-delegation-single-source.test.mjs` 变红，记录哪几行矩阵红 | **2 fail / 3 pass**：仅第 3 行矩阵（`'specs/300-fix-a specs/301-fix-b extra'`，3 操作数被误判返回前两个而非 null）+ 「方向钉」测试（3 操作数场景）变红；其余 22 行不受影响（该矩阵是 `for` 循环内单个 `it`，遇首个失败即中止，故理论上同样 4 操作数的 `'a b c d'` 行未被独立验证到，但逻辑上同属该缺陷）。**关键佐证**：同一变异下，既有 **604 条** `fix-compliance-core.test.mjs` 全部保持绿——证实这份新增矩阵填补的是真实、此前完全无人覆盖的检测空白，不是重复保险 | 新增矩阵是本缺陷方向唯一防线，价值证实 |
| 4 | `fix-compliance-core.mjs` 的 import 改回本地字面量 `new Set(['Agent','Task'])`（值相同、失去单源） | 单源守卫 / `JUDGE_FILE_SET` 相关测试变红 | `f283-delegation-single-source.test.mjs`：**1 fail / 4 pass**（仅源码文本扫描断言「不再有第二份 `new Set([...])` 字面量」命中）；全量 `npm run test:plugins`：**1 fail / 1845 pass**（1846 条中仅此 1 条）。`JUDGE_FILE_SET` 相关测试**未变红**（该常量只登记文件路径字符串，不校验 core.mjs 是否真的 import 它） | 符合"文本扫描型单源守卫"的固有边界——因两份副本内容相同，任何行为测试都无法区分，只有源码扫描能捕获；不是缺陷，但也说明单源守卫的唯一防线是这条文本扫描测试，若未来副本内容漂移（而非本次这种同值重复），需要另一层保护 |
| 5 | `delegation-tool-names.mjs` 去掉 `immutableSet` 包装，改回普通可变 `new Set(['Agent','Task'])` | 变红 | `f283-delegation-single-source.test.mjs`：**1 fail / 4 pass**（仅「真不可变」断言：`assert.throws(add/delete/clear)` 三行全部失败，因不再抛错） | 防线有效 |

所有变异均已用 `git checkout -- <file>` 复原；最终 `git diff a5def601 --stat` 与 `git status --short` 均为空，无 `.bak` 或其他残留文件。

## 5. `parseRenameOperands` 矩阵可达性详细分析（对应 A8）

真实生产调用链：`resolveFeatureDirCandidate`（`fix-compliance-core.mjs:1535`）对 `Bash` 工具的 `input.command` 原始字符串直接调用 `scanRenameCommandEvents(input.command)`；只有其返回非空时，`applyRenameEvent` 才会把 `paramText` 交给 `parseRenameOperands`（`fix-compliance-core.mjs:1506`）。`scanRenameCommandEvents` 自身有一套独立的准入过滤（光杆 `mv`/`git mv`、`isAcceptedRenameOption` 白名单、`RENAME_PATH_TOKEN_REGEX` 等）。

亲写脚本对 23 组矩阵输入分别以 `` `mv ${input}` `` 和 `` `git mv ${input}` `` 两种形式直接调用 `scanRenameCommandEvents`（与生产调用方式完全一致），统计返回非空的行数：

- 可达（5 行）：`'specs/300-fix-a specs/301-fix-b'`、`'-f a b'`、`'-fv a b'`、`'- b'`、`'a\tb'`
- 不可达（18 行）：其余全部因 `scanRenameCommandEvents` 自身的操作数计数 / 路径正则 / 选项白名单已先行拒绝（如 `-t dir a` 因 `-t` 不在 `isAcceptedRenameOption` 白名单内、按操作数计数被判 3 个操作数而提前返回 `[]`，`'"a b" c'` 因含引号被 `RENAME_PATH_TOKEN_REGEX` 拒绝等）

`'- b'` 一行能通过 `scanRenameCommandEvents`：单字符 `-` 不匹配 `RENAME_SHORT_FLAG_TOKEN_REGEX`（`^-[fv]+$`）也不在 `GIT_MV_LONG_FLAG_TOKENS` 内，因此被计入"操作数"而非"选项"；而 `-` 本身满足 `RENAME_PATH_TOKEN_REGEX`（字符集含 `-`），凑够 2 个"操作数"通过。这行大概率是 fix-report/测试文件"仅 4 行可达"这一自查结论漏计的一行。

**结论**：该矩阵作为 `parseRenameOperands` 的**单元合同**（回归钉）本身逐行断言全部正确、经变异测试证实真实有效（§4 #3）；唯独"生产可达行数=4"这一附加的自查性描述与机械复核结果（5）不符，且测试文件自身标题的"22 行"与其内部"23 行"/数组真实长度也不一致。这类"如实口径"数字未经二次机械核验的问题，与该仓库既往记录（如 F272 的"数字验收量四次算错"）同属一类模式。

## 6. Over-claim / 缺口清单

| # | 严重度 | 内容 |
|---|---|---|
| 1 | INFO | fix-report §2.3 与测试文件 `describe` 标题均称"矩阵 23/22 行仅 4 行生产可达"，机械复核为 **5 行**（漏计 `'- b'`）。不影响功能正确性，矩阵本身逐行断言仍全部正确（§4 #3 已证实其防线价值） |
| 2 | INFO | 测试文件第 42 行 `describe` 标题写"矩阵 22 行"，与第 70 行 `it` 标题"矩阵逐行（23 行）"及数组真实长度（23，机械核实）自相矛盾，属同一文件内部的数字未同步 |
| 3 | INFO | fix-report §3 称 `codex-hooks-ownership-derivation.test.ts` 改动后"8/8 绿"，机械复核为 **16/16**（T006b 对抗复审响应轮新增用例后未同步更新计数）。方向有利（覆盖比声称更多） |
| 4 | INFO | commit message"hooks 7 套件 253/253"未在制品中列出具体文件名，需靠枚举+求和反推才能复核（本次已反推确认精确一致），建议后续 fix-report 直接列出 7 个文件名以提升可复现性 |
| 5 | INFO | `codex-hooks-ownership-derivation.test.ts` 里"对抗复审 I-2"用例调用 `validateCodexHooksDocument` 时未显式传 `checkCommandShape:false`（真实 CLI `--canonical-source` 会这样传），导致 `expect(result.ok).toBe(false)` 断言对脏文档成立的部分原因夹杂了无关的 `owned-command-interpolated`/`owned-command-not-absolute` finding；该用例更具体的 `findings.some(code==='canonical-unregistered-script')` 断言确实精确隔离验证了目标行为，故测试整体仍然有效，只是不够干净 |
| 6 | 已如实登记，非本次问题 | `product-handler-unregistered` 分支结构性不可达、`--remove` 无条件删用户预存空事件键（A-I5）均系作者自行发现并在 fix-report/代码注释中如实登记为已知遗留，未隐瞒，不计入本次缺口 |

无 CRITICAL / 无功能性或安全性缺陷发现。核心防线（归属表派生的畸形键拒绝、generator 准入闸对「加」方向的拦截、`validate --canonical-source` 的产品/非产品事件分流、`DELEGATION_TOOL_NAMES` 的真不可变与单源、`parseRenameOperands` 的 `!==2` 判据）均被独立执行的测试与变异实验正面证实为真实生效，且变异后除预期用例外无旁支误伤或漏判。

## 7. 结论

**PASS**。

理由：
- §2 九条声称中，八条（A1–A7、A9）机械证实成立，一条（A8）的核心机制（矩阵作为回归钉）证实有效但附带的"仅 4 行可达"这一自查数字有出入（实测 5 行）——该出入不影响判据本身的正确性与防线价值。
- §3 全部指定套件亲跑零失败；`test:plugins` 1844/0 与 hooks 253/253 两个聚合数字均与制品声称精确吻合。
- §4 五个变异全部按预期精确命中相关用例，其中变异 3 额外证实了新增矩阵相对既有 604 条用例是真实增量覆盖（非重复保险），变异 2 证实派生表被大量下游套件依赖。
- §6 的六条发现全部是 INFO 级别的数字/文档口径问题，不构成阻断项。

无阻断项需要在 push 前修复；若希望做到"零瑕疵"，可选（非必须）在下一次同类改动时把 §6 的 #1-3 三处数字更正为机械复核值。

## 8. 工具使用反馈（Dogfooding）

- **MCP 可用性**：本次验证未调用 Spectra MCP 工具（`mcp__plugin_spectra_spectra__*` 均可见于工具列表但未使用）。原因：验证目标是 `plugins/spec-driver/scripts/lib/*.mjs` 纯函数模块间的判据逻辑（归属表派生、准入闸字符串判据、Set 不可变性、正则/tokenizer 边界行为），这类验证的关键动作是"亲手构造输入喂给函数看返回值"与"变异源码后跑测试看谁变红"，属于直接执行验证而非代码导航/影响面探查；graph 类工具（`impact`/`context`/`graph_query`）更适合"这个改动波及哪些调用方"类问题，本次改动的调用方范围已由 `git diff --stat`（15 个文件）与 `JUDGE_FILE_SET` 常量本身完整给出，无需再查图。这与 fix-report 自身 §6 的说明一致（"图不覆盖 plugins/ 调用链"）。
- **返回信息完整性**：不适用（未调用）。
- **流程顺畅度**：并发协调机制（等待 `f283-gate.done` 标记文件）本身工作正常——本次到达时标记已存在，未触发等待分支，未观察到该机制的问题。
- **结果准确性**：不适用（未调用 Spectra）。

若后续要为本类"判据函数级"验证任务积累经验：直接 `node -e`/临时脚本 + `git show <sha>:<path>` 考古，比通过知识图谱工具更快、更精确，这不构成 Spectra 的短板，只是任务类型匹配问题，不建议转化为改进 Feature。
