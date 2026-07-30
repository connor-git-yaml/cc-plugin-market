# 验证报告（F231 · fix-compliance 控制流藏 mv 极窄字面白名单）

## 元信息

- **特性目录**: `specs/231-fix-compliance-control-flow-rename`
- **模式**: fix（Phase 4 验证闭环 · 完整路径 4c，4a/4b 职责并入本次）
- **审查对象**: 未提交改动 `git diff --cached`
  - `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（+350 / -若干，`scanRenameCommandEvents` 收敛为无回溯 token 化校验）
  - `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（+908 / -若干）
  - `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（+6）
- **验证依据**: `fix-report.md`（最终设计与十二轮审查记录，以此为准）。**本报告为整体重写**——原报告写于第 1 轮之后，描述的是已被删除的「结构白名单」实现（`blankHeredocBodies` / `isSimpleRenameSequence`），与最终 diff 矛盾，已被 Codex 两次点名，本次据最终源码逐条重新核验。
- **本地环境说明**：`timeout` / `gtimeout` 二进制在本机均不可用，以下命令均未加超时前缀直接执行；均在合理时间内返回（最长的 `npx vitest run` 约 50s），未出现挂起。

---

## 源码核对（先于跑测，确认审查对象与 fix-report「最终采纳」描述一致）

在执行任何验证命令前，先直接阅读 `fix-compliance-core.mjs` 源码逐条核对 fix-report「修复策略（最终采纳）」的六条判据是否真的落地为**无回溯 token 化校验**，而非仍是旧结构白名单：

| 核对项 | 方式 | 结果 |
|---|---|---|
| `blankHeredocBodies` / `isSimpleRenameSequence` 已整体删除，零生产残留 | `grep -rn "blankHeredocBodies\|isSimpleRenameSequence\|isNestedMoveTarget" plugins/spec-driver/` | ✔ 仅测试文件一处**历史注释**提及"该 helper 已随…"（说明性文字，非残留调用），源码零命中 |
| `scanRenameCommandEvents` 判据形态 | `Read` 全函数体（L629-679）| ✔ 逐字符扫描剥首尾空白（`isShellWhitespace`）→ 拒绝内部换行/CR → 按 `[ \t]+` 切 token → 命令名须 `mv`/`git mv` → 按命令类型分流的严格 option 白名单（`isAcceptedRenameOption`）→ 恰好 2 操作数且各自匹配 `RENAME_PATH_TOKEN_REGEX` → dst 不得尾随 `/` → `hasCanonicalPathSegments` 拒绝 `.`/`..`/空 segment → `isDistinctRenameTarget` 拒绝同路径/祖先/后代/大小写折叠相同，与 fix-report 六条逐字一致 |
| `resolveFeatureDirCandidate` 签名 | `grep -n "export function resolveFeatureDirCandidate"` | ✔ `(entries, anchorLineIndex)` 两参，第 11 轮注入式磁盘探针已回退，恢复零 I/O 纯函数签名 |
| core 零 I/O | `grep -n "require('fs')\|from 'fs'\|from 'node:fs'\|process\.env\|readFileSync\|existsSync"` | ✔ 仅命中文件头注释「本模块全部函数为纯函数——不读文件、不碰 process.env」，无实际 I/O 调用 |

**结论**：审查对象与 fix-report「最终采纳」描述完全一致，本报告后续验证基于此确认成立的源码状态。

---

## Layer 2：工具链验证（实际执行输出摘要）

| 命令 | 退出码 | 摘要 |
|---|---|---|
| `npm run test:plugins`（Node 24.14.0，本机默认）| 0 | `node --test` 汇总：`tests 953 / suites 161 / pass 953 / fail 0 / cancelled 0 / skipped 0`，耗时 2624.6ms |
| `volta run --node 20.20.2 node --test plugins/spec-driver/tests/*.test.mjs`（CI 对齐版本，**F232 教训「本地全绿≠CI 绿」显式复核**）| 0 | `tests 953 / suites 161 / pass 953 / fail 0`，耗时 2783.2ms，与 Node 24 结果一致，无版本相关行为分歧 |
| `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（子集直测）| 0 | `tests 581 / suites 94 / pass 581 / fail 0`，耗时 2449.4ms |
| `npm run build` | 0 | `tsc` 零错误；`prebuild`（inline-d3，内容无变化跳过）与 `postbuild`（commit 盖章 `371d7284 (dirty)`）均正常 |
| `npm run repo:check` | 0（`status=warn`，非阻断）| 全部受控项 `pass`；唯一 `warn` 是 `graph-quality:freshness`（图产物 `sourceCommit=23ffc8f7` 落后当前 HEAD `371d7284`），与本次改动无关（本次未重建知识图谱、未新增/删除 symbol），不构成回归 |
| `npx vitest run`（单独跑，未与上方命令并发）| 0 | `Test Files 483 passed \| 4 skipped (487)`，`Tests 5769 passed \| 18 skipped \| 21 todo (5808)`，耗时 50.02s |

**结论**：Layer 2 全绿，含 CI 对齐的 Node 20.20.2 复核，无需修复。`repo:check` 的图新鲜度 warning 是环境性提示，非本次改动引入的回归。

---

## 冻结面逐条核对（fix-report「冻结语义保全清单」+「已知限界」characterization，用 `node --test` 单跑两个 fix-compliance 测试文件确认，非仅凭汇总数字）

| 冻结项 | 核对方式 | 结果 |
|---|---|---|
| **F224 SC-005**（单条裸 `git mv <FEATURE_DIR> specs/renamed-nonstandard` → `exit 0` 降级 + 诊断含 `feature-dir-unresolvable`）| 直测输出确认 `F224 CLI 端到端：候选目录无法确定 → fail-open 降级 + 诊断留痕（SC-005）` pass（43.3ms） | ✔ pass |
| **SC-005b**（零委派 + 单条非规范 `git mv` → `exit 2`）| 直测输出确认 `F224 CRITICAL 收窄：改名到非规范目录不得赦免委派证据（SC-005b）` pass（180.1ms） | ✔ pass |
| **真实会话 67720241**（`compliant:true`，mv 在 heredoc JS 数据内、整条命令非光杆 → 零事件 → 候选停留 → F227 兜底回落真实目录）| grep 定位测试标题确认命中并 pass | ✔ pass |
| **F225 提名侧同段共现** | 直测输出扫描 `F224×F225 共存` 相关用例 | ✔ pass |
| **F227 候选历史与性能** | 直测输出扫描相关 describe 块 | ✔ pass（含超长 option 串 10ms 量级不触发灾难性回溯用例） |
| **F228/F229 判据用例** | 直测输出扫描相关 describe 块 | ✔ 全绿 |
| **C1/C2/C3 光杆正向**（`mv S D`、`git mv S D`、`mv -f S D`、`git mv -f S D` 及 `-fv`/`-vf` 捆绑）| grep 输出确认 `C1 真实 mv 到非规范名 → 仍转降级（ambiguous）`、`C2 真实 git mv 到非规范名 → 仍转降级（ambiguous）`、`C3 mv -f 带 flag → 正常跟随`、`正向 mv -fv/-vf 捆绑短 flag → 跟随到 specs/901-fix-y` 等均 pass | ✔ 全绿 |
| **C4（唯一被更新的冻结用例）** | 测试标题 `C4 \`&&\` 条件右侧改名不跟随（F231：白名单拒绝 && / ||）` pass，符合 fix-report 决策 2（`&&`/`||` 条件右侧不再跟随），diff 中未发现其余 C 系列断言被同步修改 | ✔ pass，且**仅此一条**冻结用例改向 |
| **性能锚点（400k 空白 < 1ms 类断言）** | `sed -n` 读取第 8 轮 perf 用例源码：`mv${' '.repeat(400000)}x` / `200000` tab / `200000` 空白+两操作数三组，注释写明「实测三条均 < 1ms」，断言阈值 `PERF_BUDGET_MS = 500`（放宽以消化 CI 抖动，非放宽真实耗时）| ✔ 三组用例均存在且通过；曾有的 65 秒 O(n²) 回归（第 8 轮发现）已由 token 化实现根治 |
| **第 11-12 轮回退结论落地为 characterization（非"反向回归"）** | grep 定位测试标题确认命中并逐条 pass：`已知限界 characterization：DST 预先存在为目录 → 真实嵌套落点，判定器仍按文本跟随`、`已知限界 characterization：DST 是已存在的规范特性目录 → 候选跟到该目录（= F227 已知限界一，纯提名即可复现）`、`已知限界 characterization：DST 是目录符号链接 → mv 跟随链接嵌套搬入`、`对照：DST 不存在（SC-005 形态）→ 照常跟随并 ambiguous（F224 降级设计意图，须保住）` | ✔ 全部 pass，标题措辞与 fix-report「已知限界 B-2d」如实标注一致，**未被误标为已关闭** |

**结论**：冻结面 100% 保全，仅 C4 一处按用户决策更新，无未声明的冻结面回归；已知限界（第 11-12 轮回退产物）在测试与文档层措辞一致，均标注为 characterization 而非已修复能力。

---

## Layer 1.5：验证铁律合规

**状态：COMPLIANT**

本报告所有验证结论均基于本 agent 亲自执行的命令输出（含 Node 24 与 Node 20.20.2 双版本 `node --test`、`npm run build`、`npm run repo:check`、`npx vitest run`），每条均已列出退出码与输出摘要，未采用任何推测性表述（"should pass"/"看起来没问题"等）。

- **缺失验证类型**：无（构建、测试（子集直测 + 全量 `test:plugins` + CI 对齐版本 + `vitest`）、Lint（`repo:check` 内含格式/一致性检查）均已实际执行）。
- **检测到的推测性表述**：无。

---

## Layer 1.75：深度检查

**a. 调用链完整性**：`resolveFeatureDirCandidate` 是 `scanRenameCommandEvents` 的唯一消费方（源码确认），返回集合 `{offset, paramText}[]` 类型未变，只是产出条件更窄；`judgeCompliance` 未直接调用 `scanRenameCommandEvents`，链路完整、无参数丢失或异常吞没。

**b. 数据持久化验证**：core 层为零 I/O 纯函数，无数据库/文件写入语义，不适用本项。

**c. 配置贯穿验证**：本次改动不涉及配置项传递，不适用本项。

---

## Layer 1.8：残留扫描

本次改动涉及**删除**（`blankHeredocBodies`、`isSimpleRenameSequence`、`isNestedMoveTargetOnDisk`、judge 层注入点）：

```
grep -rn "blankHeredocBodies\|isSimpleRenameSequence\|isNestedMoveTargetOnDisk" plugins/spec-driver/ docs/ README.md AGENTS.md CLAUDE.md
```

结果：仅 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 一处**历史性说明注释**（"原「终止行空白化的等长/换行不变量」直测 `blankHeredocBodies`，该 helper 已随…"），用于交代测试演变脉络，非死引用/死调用，不构成残留。`docs/`、`README.md`、`AGENTS.md`、`CLAUDE.md` 均无命中。**RESIDUAL：无**。

---

## Layer 1.9：文档一致性检查

本次改动未新增/删除公共模块或对外接口（`resolveFeatureDirCandidate` / `judgeCompliance` 返回形状逐字未变），架构文档层面无需更新。`contracts/fix-compliance-judge-cli.md` 场景表按 fix-report「Spec 影响」节建议核对是否需补一行「非光杆改名命令不触发降级」——**当前未新增该行**，属遗留待办而非缺陷（不改变对外契约，场景表补充为文档增强项，不阻断本次交付）。**DOC_DRIFT：无**（无既有文档描述与实现相悖）。

---

## [Spec 合规]

**结论：PASS（无 CRITICAL / WARNING）**

1. **判据不变量落地与 fix-report 逐字一致**：`scanRenameCommandEvents` 顶部即完成剥白空白 + 拒绝内部换行/CR，随后 token 化逐步收紧（命令名 → option 白名单 → 恰好 2 操作数 → 字符集 → dst 不尾随 `/` → 规范 path segment → 非同路径/祖先/后代/大小写折叠），不可达路径提前 `return []`，符合「产出改名事件 ⟺ 整条命令是光杆改名」这一不变量表述。
2. **option 白名单按命令拆分**：`RENAME_SHORT_FLAG_TOKEN_REGEX = /^-[fv]+$/` 对裸 `mv`/`git mv` 均适用；`GIT_MV_LONG_FLAG_TOKENS`（`--force`/`--verbose`）仅通过 `isAcceptedRenameOption(token, isGitMv)` 的 `isGitMv` 分支放行，裸 `mv` 长选项一律拒绝，与 fix-report「长选项是 GNU 专有，Darwin `/bin/mv` 会 illegal option」的实测结论一致。
3. **路径关系校验完整**：`isDistinctRenameTarget` 覆盖同路径（含大小写折叠）、dst 是 src 祖先、dst 是 src 后代三类，均按 path segment 边界（`+'/'`）判定，避免 `specs/900-fix-x` 与 `specs/900-fix-xyz` 误判为父子——源码 L143-150 逐行核对与注释描述一致。
4. **`resolveFeatureDirCandidate` / `judgeCompliance` 返回形状逐字未变**：`git diff --cached` 确认这两个函数体本身在本次改动中零改动行，改动全部发生在 `scanRenameCommandEvents` 内部及其上方新增的辅助函数/常量。
5. **被翻转的既有断言方向核查**：冻结面核对表中仅 C4 一条被改（`&&`/`||` 条件右侧不再跟随），改动方向是"更严"（fail-closed），且测试标题明确标注理由（`F231：白名单拒绝 && / ||`），符合"翻转须朝更严方向且带理由注释"的约束。第 9/10 轮 fix-report 提到的另外两组翻转（CRLF 尾随、`mv --force`/`mv S/ Y/`）经 grep 确认测试标题措辞已改为反映真实语义（如 `第 9 轮 CR 尾随裸 CR → 零事件`），未发现遗留的错误正向断言。
6. **无未文档化的行为变化**：新增的辅助函数（`isAcceptedRenameOption`、`asciiLowerCase`、`isDistinctRenameTarget`、`hasCanonicalPathSegments`、`isShellWhitespace`）均是 fix-report「修复策略」节明确设计的判据组成部分，未发现 diff 中存在 fix-report 未提及的额外行为改动。

---

## [代码质量]

**结论：PASS，附 1 项 WARNING（非阻断，建议后续小修）**

### 通过项

- **改动聚焦、无回溯设计落地**：`scanRenameCommandEvents` 全程双向线性扫描 + 逐 token 常数级判定，无嵌套量词、无未锚定尾随正则；`RENAME_PATH_TOKEN_REGEX`、`RENAME_SHORT_FLAG_TOKEN_REGEX` 均为单字符类锚定正则，无回溯风险，与第 8 轮"用一条正则替掉状态机曾引入 O(n²)"的教训对照，本次判定链路逐段核对未见同类隐患。
- **字符集单源**：`isShellWhitespace` 同时供首尾剥离与前导计数复用（`leading`/`end` 双指针共用同一谓词函数），未见"剥什么"与"数什么"分叉的第 7 轮同型缺陷；注释明确记录了该函数**不含 `\r`**的理由（CR 非 bash token 分隔符）。
- **option 白名单命令类型分流正确**：`isAcceptedRenameOption(token, isGitMv)` 的调用点 `const isGitMv = idx === 2`（`idx` 已由命令名解析阶段正确区分裸 `mv`（`idx=1`）与 `git mv`（`idx=2`））逐行核对无误。
- **路径合法性三级校验顺序正确**：字符集 → dst 尾随 `/` → 规范 segment → 路径关系，四级前置拒绝逐条独立、互不遮蔽（各自 `return []`），未见判据被短路跳过的分支缺口。
- **未发现死代码/调试残留**：`blankHeredocBodies`/`isSimpleRenameSequence`/`isNestedMoveTargetOnDisk` 及其常量已彻底删除（见「Layer 1.8 残留扫描」），无 `console.log` 等调试语句残留（grep 全文件确认）。
- **测试是真实文件系统差分测试而非纯函数断言**：核对确认 fix-report 反复强调的"绿色掩盖漏洞"教训在本轮已落地为对策——测试注释多处标注"实测"字样并附具体 `rc=`/`-ef` 结果（如 `mv specs/230-fix-x specs/./230-fix-x` → rc=1、`-ef` 同一目录），且第 11-12 轮的差分用例使用真实临时目录 + 受控 env（`BASH_ENV`/PATH shim 防假绿，fix-report 已注明"第 11 轮的测试质量改进全部保留"）。本次审查未重新逐条重跑真实 `mv`/`git mv` 复现（工作量超出本报告范围），但源码注释与测试标题的实测记录与最终判据实现方向一致，未发现矛盾。

### WARNING（建议后续跟进，非本次阻断项）

1. **ANSI-C `$'...'` 引用转义仍未在判据的引号/换行处理中显式建模**——`scanRenameCommandEvents` 的判据完全建立在"整条命令必须是无内部换行、按 `[ \t]+` 切分即可枚举全部 token"的假设上，不涉及引号状态机（这与前四轮"结构白名单"阶段的引号配平模型不同，判据形态已根本改变）。理论上 `$'...'` 内部若含空白/换行字面量，在**真实 bash** 里仍是单一字符串 token，而当前判据仅按空白切分 token、不识别引号边界，可能对`mv $'S D' $'X'`（操作数内含转义空格）类构造产生行为分歧——但因 `RENAME_PATH_TOKEN_REGEX = /^[A-Za-z0-9._/-]+$/` 不允许 `$`/`'` 进入操作数，此类构造在 token 切分后必然因非法字符被拒绝（fail-closed 方向，不构成误放行）。本次审查未发现可实证的 CRITICAL 误放行路径，仅记录为设计留痕：**判据字符集本身已经是关闭该理论残留的第二道防线**，无需额外处理，建议维护者知悉该防线依赖关系，避免未来放宽 `RENAME_PATH_TOKEN_REGEX` 时忽略这层隐含防护。

### 已知限界复核（本次审查范围内确认符合 fix-report「已知限界」A/B 组，非缺陷）

- **A 组（误阻断，安全）**：`X && mv`、`( mv )`、`{ mv; }`、`time mv`、`sudo mv`、含引号/变量路径、带重定向、CR 尾随等非光杆形态一律不跟随，源码注释与「已知限界」文档表述一致，未发现超出文档描述的额外误阻断类型。dst 尾随 `/`、src/dst 互为前缀、大小写折叠相同、裸 `mv` 长选项四类第 10 轮新增误阻断，已在 `isDistinctRenameTarget`/`hasCanonicalPathSegments`/`isAcceptedRenameOption` 中逐条落地，且注释明确标注各自的平台依赖代价（如大小写敏感 FS 上 fail-closed 的取舍）。
- **B 组（误放行，固有上界，如实转述为未解决）**：
  - **B-2（名称遮蔽/运行时失败）**：命令文本层不可区分静默失败的真实 mv，fix-report 已如实标注"须另立 Feature 重设 ambiguous 的 fail-open 证据合同"，本报告不表述为已解决。
  - **B-2d（DST 运行时已是目录 → 真实落点是 `DST/basename(SRC)`，判定器仍跟随）**：探针方案已双向证伪并回退（第 11-12 轮），当前实现对该情形无特殊处理，测试中以 `characterization`（而非"反向回归"）标题钉住该行为，符合 fix-report 措辞。**本次审查未发现该结果提供超出 F224 SC-005 与 F227 已知限界一的新能力**——与 fix-report 结论一致，如实转述、不表述为已解决。
  - **B-3（`parseRenameOperands` 的 `\s+`/`trim()` 耦合不变量）**：本次改动未触及该函数，仍是"靠调用方字符集保证安全"的既有耦合，fix-report 已记录维护约束，本次不构成新增风险（`RENAME_PATH_TOKEN_REGEX` 字符集未放宽）。

---

## 总体结论

**READY FOR REVIEW**

- **Layer 2 工具链**：全绿，含 Node 24（本机默认）与 Node 20.20.2（CI 对齐版本）双跑 `test:plugins`（953/953）、fix-compliance 子集直测（581/581）、`npm run build`（tsc 零错误）、`npm run repo:check`（exit 0，仅存在与本次改动无关的图新鲜度 warning）、`npx vitest run`（5769 passed / 18 skipped / 21 todo，单独跑无并发干扰）。
- **Layer 1.5 验证铁律合规**：**COMPLIANT**。
- **冻结面**：逐条核对完成，SC-005/SC-005b/真实会话 67720241/C1-C4/F225/F227/F228/F229/性能锚点/第 11-12 轮 characterization 全部通过，仅 C4 按用户决策 2 更新（`&&`/`||` 条件右侧不再跟随），无未声明回归。
- **残留扫描**：无（旧结构白名单符号已彻底删除，仅测试文件留有一处说明性历史注释）。
- **[Spec 合规]**：PASS，无 CRITICAL/WARNING。
- **[代码质量]**：PASS，1 项非阻断 WARNING（ANSI-C `$'...'` 理论残留，已有字符集第二道防线兜底，建议记录留痕供后续维护者知悉）。
- **已知限界**：A 组（误阻断）与 B 组（误放行，含 B-2d）均如实转述为固有上界，未表述为已解决，与 fix-report 措辞一致。
