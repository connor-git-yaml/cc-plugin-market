# Verification Report: F230 fix 依从性门禁伪造 mv fail-open 修复（第 2 轮修复后 · 最终实现）

**特性分支**: `claude/dazzling-jackson-9457e2`
**验证日期**: 2026-07-23
**验证范围**: Layer 1（Spec-Code 对齐，fix 模式无 spec.md，改走制品一致性核查）+ Layer 1.5（验证铁律证据）+ Layer 1.75/1.8/1.9（深度检查/残留扫描/文档一致性）+ Layer 2（原生工具链）
**说明**：本报告**整份重写**，替换第 1 轮实现（引用已删除符号 `RENAME_COMMAND_HEAD_REGEX` / `hasUnbalancedQuotes`）产出的旧版报告，不保留其任何过时结论。

---

## Layer 1: 制品一致性核查（fix 模式，无 spec.md）

本 feature 为 `fix` 模式（`specs/230-fix-compliance-forged-rename-failopen/`），无 `spec.md`，仅有 `fix-report.md` / `plan.md` / `tasks.md`。核查范围改为「制品间描述与生产代码 diff 是否一致」：

| 制品 | 声称 | 核实结果 |
|------|------|----------|
| `fix-report.md` §修复策略 | 删除 `hasUnbalancedQuotes` / `RENAME_COMMAND_HEAD_REGEX`，新增 `extractRenameCommandParams` + 内部 sticky 正则 `RENAME_COMMAND_AT_POSITION_REGEX`，`applyRename` 改为消费整条命令 | ✅ 与生产代码逐字一致（`fix-compliance-core.mjs` L64-77, 405-457, 530-540） |
| `fix-report.md` §修复策略 | `evaluate()` 降级谓词回到 `d.roleClass === 'verify' \|\| d.noopVerify === true`（撤销 implement 排除项） | ✅ 与 `fix-compliance-judge.mjs` L186-188 逐字一致 |
| `fix-report.md` §同步更新清单 | CLI 三处 `assert.notEqual(status, 0)` 强化为 `assert.equal(status, 2, stderr)` | ✅ 全文件 grep 确认零 `notEqual` 残留；新用例统一用 `assert.equal(run.status, 2, run.stderr)`（见下 §W3 复核，注记一处口径差异） |
| `plan.md` | 「本节已被第 2 轮 Codex 对抗审查（C1）替换」章节 + 最终版命令位锚定设计 | ✅ 已同步为最终版，符号名与生产代码完全对应 |
| `tasks.md` | 顶部显式声明「本文件生成于旧版设计（`scanRenameShellContext`），实际实施以 plan.md 最终版为准」 | ✅ 自我声明与实际实现一致，无「文档声称已改、代码仍是旧设计」的脱节 |
| `fix-report.md` §同步更新清单 | 「fixture：`plugins/spec-driver/tests/fixtures/fix-compliance/` 新增伪造改名 fixture + README 表格补行」 | ⚠️ **不成立**：`git status` 确认本次改动的测试文件仅为 `fix-compliance-core.test.mjs` / `fix-compliance-judge-cli.test.mjs` 两个既有文件的修改，`tests/fixtures/fix-compliance/` 目录下**没有新增任何文件**（该目录现存 8 个 `resolve-*.jsonl` 均为 F224 遗留，非本次新增）。与 `tasks.md`「范围边界」自述的「不新增 fixture 文件（沿用 F224 SC-005/SC-005b 内联构造风格）」直接矛盾——`tasks.md` 的表述才是与实际代码一致的，`fix-report.md` 本条属笔误级 over-claim（WARNING，非功能性缺陷） |

**结论**：制品与最终实现高度一致，仅 1 处笔误级不一致（fixture 声称未落地，但功能测试覆盖本身完整、不影响交付）。

---

## Layer 1.5: 验证铁律合规

本次复核为独立子代理直接对生产代码与真实 CLI 输出执行核验，不依赖 implement/verify 子代理的转述文本，天然满足证据门要求。以下四类必跑命令均已实际执行并采集真实退出码（见 Layer 2 表格），无推测性表述。

**状态：COMPLIANT**

---

## Layer 1.75/1.8/1.9: 深度检查 / 残留扫描 / 文档一致性

- **调用链完整性**：`extractRenameCommandParams` → `applyRename` → `resolveFeatureDirCandidate` → `evaluate()` → `runHook`/`runReport` 全链路已独立复现验证（见下方"独立核查点"），未见参数丢失或异常吞没。
- **数据持久化**：不涉及数据库写入；审计事件通过 `appendAuditEvent` 落盘 `.specify/runs/*.jsonl`，独立复现测试中确认事件真实落盘且字段正确（`feature-dir-unresolvable` 诊断、`degraded:true`）。
- **配置贯穿**：不涉及新增配置项，本次改动未触碰 `enforcement` 配置解析链路。
- **残留扫描**：`RENAME_COMMAND_HEAD_REGEX` / `hasUnbalancedQuotes` 两符号在 `plugins/` 与 `specs/` 全仓 grep 确认**已从生产代码与测试代码删除**，仅在 `specs/229-.../{tasks.md,plan.md,fix-report.md}` 的历史记录性文字中作为「已废弃方案」被提及（如实记录方案演进，非残留代码引用）——符合预期，非需修复的残留。
- **文档一致性**：本次改动不涉及架构级变更（无新增/删除模块、无公共接口变更），`contracts/fix-compliance-judge-cli.md`（F208 原始契约）未描述过"伪造改名"场景，`tasks.md` T012 判定"未新增对外可观察场景，不改动"——核实该契约文件确未提及 `feature-dir-unresolvable` 场景细节，T012 的"无需改动"结论成立，非文档漂移。

---

## 硬性验收复核（用户给定三条，逐条实测）

**复现环境**：`--project-root` 指向全新临时空目录（`/tmp/f230-verify*/empty-root`），stdin 传入合法 hook payload JSON（`{session_id, transcript_path}`）。

### 验收 1：`npm run test:plugins` 零失败

```
$ npm run test:plugins
...
ℹ tests 748
ℹ suites 145
ℹ pass 748
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2258.367042
```

✅ **PASS**：748/748 通过，0 失败。

### 验收 2：伪造序列不得 exit 0（断言恰为 exit 2）

构造：fix 展开锚点 + `Write specs/300-fix-decoy/fix-report.md`（未落盘）+ `Task subagent_type=spec-driver:verify` + `Bash: true # mv specs/300-fix-decoy specs/renamed-nonstandard`，hook 模式（stdin 传 payload JSON，`--project-root` 指向空临时目录）。

实测：

```
$ echo '{"session_id":"sess-verify-1","transcript_path":"/tmp/f230-verify/decoy.jsonl"}' \
  | node plugins/spec-driver/scripts/fix-compliance-judge.mjs --project-root /tmp/f230-verify/empty-root
[FIX-COMPLIANCE] 未建立特性目录：请按 specs/NNN-fix-<short-name>/ 约定创建特性目录并落盘诊断制品
缺少诊断报告：请完成问题诊断并将 fix-report.md 写入 specs/NNN-fix-<name>/（含 Root Cause 章节）
...
EXIT_CODE=2
```

report 模式复核：`{"compliant":false,"missing":["feature-dir","fix-report.md"],"delegationCounts":{"implement":0,"verify":1,"other":0},"transcriptDiagnostics":[]}`（`transcriptDiagnostics` 不含 `feature-dir-unresolvable`，说明本次没有走降级通道，而是被 `judgeCompliance` 正常判定为不合规硬阻断）。

✅ **PASS**：退出码恰为 2。

### 验收 3：真实改名合法降级仍 exit 0 + 审计事件含 `feature-dir-unresolvable`

构造：同上，但末条 Bash 改为 `git mv specs/300-fix-decoy specs/renamed-nonstandard`。

实测：

```
$ echo '{"session_id":"sess-verify-2","transcript_path":"/tmp/f230-verify2/legit.jsonl"}' \
  | node plugins/spec-driver/scripts/fix-compliance-judge.mjs --project-root /tmp/f230-verify2/empty-root
EXIT_CODE=0
--- 落盘审计事件 ---
{"schemaVersion":1,"eventType":"fix-compliance-verdict","recordedAt":"...","sessionId":"sess-verify-2",
 "enforcement":"block","closureForm":"undetermined","compliant":null,"missing":[],
 "blockCount":null,"degraded":true,"diagnostics":["feature-dir-unresolvable"]}
```

✅ **PASS**：exit 0 且审计事件 `diagnostics` 含 `feature-dir-unresolvable`。

---

## 独立核查点（证据导向，逐条实测，不复述制品声称）

### Codex 第 2 轮 C1 是否真的关闭

用户指定的两条转义引号构造，直接调用 `resolveFeatureDirCandidate` 实测：

```
echo "a;mv specs/900-fix-x specs/renamed-nonstandard\""
  → extractRenameCommandParams: []
  → candidate: {"path":"specs/900-fix-x","ambiguous":false}

echo 'a;mv specs/900-fix-x specs/renamed-nonstandard'\''x'
  → extractRenameCommandParams: []
  → candidate: {"path":"specs/900-fix-x","ambiguous":false}
```

✅ **确认关闭**：候选保持原值、`ambiguous===false`，两条转义引号构造均未打开降级通道。

### W1 是否真的修好（裸 `|` / `&` 两跳跟随）

```
mv specs/900-fix-x specs/901-fix-y | mv specs/901-fix-y specs/902-fix-z
  → {"path":"specs/902-fix-z","ambiguous":false}
mv specs/900-fix-x specs/901-fix-y & mv specs/901-fix-y specs/902-fix-z
  → {"path":"specs/902-fix-z","ambiguous":false}
```

✅ **确认修好**：两跳均跟随到最终态，与 F230 前（旧全局匹配）行为一致。

### W2 是否真的撤销

`{subagent_type: null, description: '确认无需代码修复'}` 实测：

```
classifyDelegationRole(null, '确认无需代码修复') → 'implement'
extractDelegationsAfter(...) → [{"roleClass":"implement","noopVerify":true}]
```

该构造 + 真实 `git mv` 端到端实测：`EXIT_CODE=0`（degraded 降级放行）。

✅ **确认撤销**：`roleClass==='implement'` 且 `noopVerify===true` 同时成立，降级下界正确覆盖该合规委派（与 `judgeCompliance` no-op 合同蕴含关系一致）。

### W3 是否真的强化

```
$ grep -n "notEqual.*status" plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs
941:      // 断死 exit 2（阻断）而非 notEqual(0)：后者在 CLI 崩溃返回 1 / status:null 时也会通过，
```

✅ **确认强化**：仅剩注释提及 `notEqual` 用于说明设计理由，代码层零 `assert.notEqual(...status...)` 残留；新用例统一使用 `assert.equal(run.status, 2, run.stderr)`。

⚠️ **口径小注**：`fix-report.md` 称"三处"强化，但 `git diff` 显示该测试文件整段为**纯新增**（无删除行），无法从 diff 直接核实"从 notEqual 改为 equal"这一编辑历史（round 1 从未提交，round 1→round 2 的编辑发生在未落盘的工作区内）。可确认的是：**最终态**代码中 3 个伪造构造（A/D/F1）共享同一 `it()` 循环模板、执行 3 次 `assert.equal(run.status, 2, ...)`，另有 1 处独立用于 E 用例——"三处"若指"3 次断言执行"（循环 3 次）成立，若指"3 处代码行"则实际只有 2 处代码行（循环体 1 处 + E 用例 1 处，循环体因表驱动被复用 3 次）。不构成功能性问题，仅描述精度问题。

### 新增测试是否真的会红（生产代码回退到 HEAD，测试文件保留最终版）

独立副本操作：`git checkout HEAD -- plugins/spec-driver/scripts/fix-compliance-judge.mjs plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（仅回退 2 个生产文件，2 个测试文件维持本次最终版），跑 `node --test`：

```
ℹ tests 69
ℹ suites 18
ℹ pass 63
ℹ fail 6
```

失败归属逐条：

| # | 归属 | 失败模式 | 归因 |
|---|------|---------|------|
| 1 | `fix-compliance-core.test.mjs`（整文件） | `SyntaxError: does not provide an export named 'extractRenameCommandParams'` | HEAD 版本尚无该导出，模块加载失败，导致该文件内**全部**新增/既有测试用例（约 13+ 条 F230 相关用例）**未能执行**（不是"断言失败"而是"根本没跑"），node test runner 仅计为 1 条失败记录，但实际阻塞的测试数远大于 1 |
| 2 | CLI 测试 `A 注释假 mv` | `0 !== 2` | 旧 `applyRename` 仍把注释内 mv 当真实改名跟随，走降级通道 exit 0，新断言要求 2 |
| 3 | CLI 测试 `D 引号内假 mv` | `0 !== 2` | 同上，旧实现引号内 mv 同样被跟随 |
| 4 | CLI 测试 `F1 裸参数假 mv` | `0 !== 2` | 同上 |
| 5 | CLI 测试 `E implement-only 零验证类委派` | `0 !== 2` | 旧 `evaluate()` 用「implement 或 verify 任一为正」并集判据，实现 committed-only 委派即可降级，新断言要求硬阻断 |
| 6 | CLI 测试 `E 对照 1：canonical no-op 委派` | `2 !== 0` | **方向相反**：旧 F224 判据（`roleClass==='verify'` 严格匹配）对该 no-op 委派（`roleClass==='other'`）判定 `hasClosureDelegation=false`，走硬阻断 exit 2；新判据正确识别 `noopVerify===true` 走合规降级 exit 0。此项证明 F230 第 2 层不仅堵漏洞，还修复了一个此前对合规 no-op 会话的**误阻断**回归 |
| — | CLI 测试 `C 真实 mv`、`E2 对照 2` | 通过（未列入失败） | 旧代码在这两个构造上恰好产生与新代码相同的输出（前者是 F224 既有正向行为，后者是旧 implement 计数规则的巧合命中），故不构成"红测试"，与 fix-report 描述一致（这两条本就标注为"应已是绿"的正向保住锚点） |

✅ **确认**：新增测试在生产代码回退后确实以预期方式失败（4 条差分矩阵 + 1 条整文件加载失败 + 1 条方向相反但同样证伪旧代码），未观察到"新测试对新旧代码结果无差异"的空断言问题。

### 已知限界真实性

1. **heredoc 正文首行裸 mv 仍被跟随**：

```
cat > specs/900-fix-x/fix-report.md <<EOF
mv specs/900-fix-x specs/renamed-nonstandard
EOF
  → resolveFeatureDirCandidate: {"path":null,"ambiguous":true}
```

✅ **确认属实**：heredoc 正文内容被误判为真实改名命令，与 `fix-report.md` §已知限界 1 描述一致。

2. **`sudo mv` / `FOO=1 mv` 前缀漏识别，可能误阻断合法收口**：

```
sudo mv specs/900-fix-x specs/901-fix-y
  → {"path":"specs/900-fix-x","ambiguous":false}（未跟随，仍指向旧路径）
FOO=1 mv specs/900-fix-x specs/901-fix-y
  → {"path":"specs/900-fix-x","ambiguous":false}（同上）
```

✅ **确认属实**：两种前缀形态均未被识别为改名命令，候选仍停留在旧路径。若该会话此后无新的制品路径写入痕迹，磁盘核验会拿旧路径核对（该路径已不存在）而误判"未建立特性目录"，与 `fix-report.md` §已知限界 3 描述的风险方向一致（保守方向：宁可误阻断，不可误放行）。

### 是否 over-claim（"10 种伪造构造全部归零、8 种合法形态全部保留"）

- **10 种伪造构造**：`fix-compliance-core.test.mjs` `FORGED_CASES` 数组实测恰好 **10** 条（A/D1/D2/F1/F2/F3/F4/F5/F6/F7），逐条断言 `path==='specs/900-fix-x' && ambiguous===false`，均已随本次 `npx vitest run` 全绿验证通过。✅ 计数准确。
- **8 种合法形态**：`git diff` 中「F230 命令位锚定不得误伤合法改名」describe 块实测共 **9** 条 `it()`（C1-C7 + C6b + C6c），而非声称的 8 条（若改指后续「`extractRenameCommandParams` 直接单测」describe 块则为 7 条）。⚠️ **数字口径存在 1 条误差**，判定为 **WARNING（描述精度问题，非功能缺陷）**——已用直接函数调用逐一复核 C1/C6b/C6c 等条目行为均正确（见上文 W1 复核），故本条不影响交付判断，仅要求后续维护时更正制品措辞。

---

## Layer 2: 原生工具链验证

**检测到**：`package.json`（Node.js / npm）；本仓库为 TypeScript 主线 + `.mjs` 插件脚本混合结构。

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Vitest（TS 主体） | `npx vitest run` | ✅ PASS | `Test Files 483 passed \| 4 skipped (487)`；`Tests 5769 passed \| 18 skipped \| 21 todo (5808)`；耗时 46.47s，**0 失败** |
| Build | `npm run build` | ✅ PASS | `tsc` 类型检查零错误；`postbuild-stamp` 正常盖章（commit=ff784174, dirty） |
| Plugin 测试（.mjs） | `npm run test:plugins` | ✅ PASS | `node --test`：`tests 748, pass 748, fail 0` |
| 仓库级检查 | `npm run repo:check` | ⚠️ WARN（非阻断） | `status=warn`，74 项 check 中 73 项 `pass`，仅 `graph-quality:freshness` 因图产物 `sourceCommit` 落后当前 HEAD 一个 commit 报 warn（与本次 F230 改动无关，属知识图谱陈旧提醒，命令本身 exit 0） |

**flaky 名单核对**：本次 `npx vitest run` 为**全量执行**（非隔离子集），已知易 flaky 用例（`graph-quality-*`、`batch-concurrency.e2e`、`eval-quota-store`、`cli-e2e --version`、`community-analysis`、`watch-command`）均已随全量套件跑过且**全部通过**，无需额外隔离重跑判定。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| 制品一致性 | ✅ 高度一致（1 处 fixture 描述笔误，WARNING） |
| 验证铁律合规 | ✅ COMPLIANT（本报告全部证据为独立子代理真实执行） |
| 硬性验收 3 条 | ✅ 全部 PASS（test:plugins 零失败 / 伪造序列 exit 2 / 合法降级 exit 0 + 审计事件正确） |
| Codex C1/W1/W2/W3 复核 | ✅ 全部确认已按声称处置生效 |
| 红测试反证 | ✅ 确认生产代码回退后新测试确实失败（含 1 条误阻断回归的反向证明） |
| 已知限界 | ✅ 两条限界均实测属实，如实记录未被夸大或隐瞒 |
| over-claim 核查 | ⚠️ "8 种合法形态" 应为 9 种（WARNING，描述精度） |
| Build Status | ✅ PASS |
| Test Status | ✅ PASS（vitest 5769/5769 + plugins 748/748，合计 0 失败） |
| repo:check | ⚠️ WARN（图谱陈旧提醒，与本次改动无关） |
| **Overall** | **✅ READY FOR REVIEW / 可以交付** |

### 分级结论

- **CRITICAL**：无。
- **WARNING**（2 项，均为描述精度问题，不影响功能正确性，建议后续 commit message 或制品勘误时一并修正）：
  1. `fix-report.md` §同步更新清单声称新增 fixture 文件，实际未新增（与 `tasks.md` 自述矛盾，`tasks.md` 表述准确）。
  2. `fix-report.md` 称"8 种合法形态全部保留"，实测为 9 种（`C1-C7 + C6b + C6c`）。
- **INFO**：`repo:check` 的 `graph-quality:freshness` warn 与本次改动无关（知识图谱产物落后 1 个 commit），不阻断交付，建议下次动 Spectra 主链路前重建图。

### 是否可以交付

**可以交付。** 三条用户硬性验收标准全部通过实测确认；Codex 第 2 轮全部 4 条结论（C1/W1/W2/W3）均已独立复现验证确实生效；生产代码回退测试证实新增测试具备真实回归捕获能力（含发现并证明修复了一个此前存在的合规会话误阻断问题）；两条已知限界如实记录、方向保守（宁可误阻断不可误放行）；全部四项强制验证命令（`npx vitest run` / `npm run build` / `npm run test:plugins` / `npm run repo:check`）实测零失败或仅有与本次改动无关的非阻断 warning。仅存在 2 处制品描述层面的精度问题（WARNING 级），不构成阻断交付的理由，建议随下次涉及该 feature 的 commit 顺手勘误。

### 未验证项（工具未安装）

无——本次涉及的全部工具链（vitest / tsc / node --test / repo-check）均已安装并成功执行。
